"""AI Prompt Pixaroma - the pure half.

No torch, no ComfyUI imports, so the whole of the text handling can be
exercised with a bare python and no model on disk
(harness: D:\\Claude Tests\\_ai_prompt_test.py).

Two jobs live here:

1. Reading the state blob the browser injects. Every value in it can be
   anything, in the same sense every widget value can (/prompt takes any
   value as sent), so nothing is assumed and everything is clamped.

2. Deciding what string the model is asked, and what comes out when there is
   no model to ask. That second case is the whole reason this node can be
   dropped into a live chain: a node with no model is a working pass-through,
   not an error.

THE FORMULA LIVES ON THE NODE, not in a file. That is the deliberate
difference from Video Prompt, whose formulas are shared files on disk. Three
nodes in a chain must be able to hold three different instructions, a
duplicate must get its own copy, and a shared workflow should carry its
instructions with it. It also removes a whole bug class Video Prompt had to
fix afterwards: a formula in a FILE is not part of the node's cache
signature, so editing one changed nothing until something else did
(video-prompt.md #8). A formula in the state blob re-runs by itself.
"""

import re

# ---------------------------------------------------------------------------
# Joining
# ---------------------------------------------------------------------------
# Mirrors Prompt Pixaroma's SEP_OPTIONS so the two nodes behave the same way
# when you wire text into either of them. The keys are what the state carries;
# the values are what actually goes between the pieces.
SEP_MAP = {
    "newline": "\n",
    "blank": "\n\n",
    "space": " ",
    "comma": ", ",
    "period": ". ",
    "pipe": " | ",
    "break": " BREAK ",
    "none": "",
}
DEFAULT_SEP = "newline"

ORDER_IDEA = "idea"
ORDER_WIRED = "wired"

# The formula is an INSTRUCTION, not content, so it is always first and always
# separated by a plain newline regardless of the user's separator choice -
# which is about how the idea and the wired text meet each other. This is the
# same contract Video Prompt uses ("\n".join of formula, idea, length block),
# and it is why a formula that ends in a label like "IDEA:" reads correctly.
FORMULA_SEP = "\n"

DEFAULT_STATE = {
    "idea": "",
    "formula": "",
    "model": "",
    "clip_type": "minimax",
    "order": ORDER_IDEA,
    "sep": DEFAULT_SEP,
    "seed": 0,
    "temperature": 0.7,
    "max_length": 512,
    "top_k": 64,
    "top_p": 0.95,
    "min_p": 0.05,
    "repetition_penalty": 1.05,
    "presence_penalty": 0.0,
    "do_sample": True,
    "thinking": False,
    "use_default_template": True,
    "release_model": False,
    # Send the formula as the model's SYSTEM message instead of inside the
    # prompt, the way core's TextGenerate sends its system_prompt (2026-10-16,
    # Ep39: BFL's FLUX 3 prompt upsampler was trained that way). See
    # plan_prompt() for when it can and cannot happen.
    "system_formula": False,
    # Multi-token prediction, the `mtp` of core's Generate Text (auto / off). On
    # = core's default, and the generate call is exactly as before. Off asks
    # core not to draft with the model's MTP head: a Discord report (2026-10-17)
    # had a CUDA "illegal memory access" on an int8 Qwen3.5 that went away with
    # mtp off in core's node (ai-prompt.md #34). Machine-specific, so NOT a
    # preset setting: a preset or Reset must never turn it back on.
    "mtp": True,
}
# NOTE: there is deliberately no "passthrough" flag. Passing the text through
# is what the node does when there is no model or nothing to send, and a switch
# to turn that OFF could only mean "error instead", which is strictly worse.
# The key existed unread on both sides for a while; it is gone rather than
# wired up.


def _clamp(value, fallback, lo, hi):
    try:
        out = float(value)
    # OverflowError is NOT a subclass of either of the others, and it is the one
    # a huge value actually raises: json.loads turns a 310-digit literal into an
    # arbitrary-precision int, and float() on that raises rather than returning
    # inf. (A huge STRING or "1e400" does return inf, which the check below
    # already catches - so only the bare-int path was exposed.) /prompt takes
    # any value as sent, so this reached both nodes' parse_state as a raw
    # traceback instead of clamping like every other out-of-range value.
    except (TypeError, ValueError, OverflowError):
        return fallback
    if out != out or out in (float("inf"), float("-inf")):
        return fallback
    return max(lo, min(hi, out))


def listed_name(name, available):
    """The entry of `available` (ComfyUI's own list of model names) that `name`
    means, or None. A workflow saved on Windows names qwen\\x, Linux and Mac list
    qwen/x, and the other way round: the folder separators are the only
    difference allowed. The exact name wins. Used by AI / Music Prompt; Video
    Prompt's pick_model folds the same way inline, so keep the two in step."""
    if not isinstance(name, str) or not name:
        return None
    names = [n for n in (available or ()) if isinstance(n, str)]
    if name in names:
        return name
    want = name.replace("\\", "/")
    for n in names:
        if n.replace("\\", "/") == want:
            return n
    return None


def as_text(value):
    """A string, whatever arrived.

    A wired STRING can reach a node as a length-1 list from some upstream
    packs, and an ANY-type passthrough (our own Switch Pixaroma included) can
    put anything at all on an optional input - see
    reference_optional_input_is_not_type_guaranteed. Everything that is not
    usable text becomes empty rather than raising, because this node's whole
    promise is that it keeps a graph running.
    """
    if isinstance(value, (list, tuple)):
        value = value[0] if value else ""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    return ""


def parse_state(raw):
    """The injected blob as a dict with every value present and in range."""
    import json

    data = {}
    if isinstance(raw, str) and raw.strip():
        try:
            loaded = json.loads(raw)
            if isinstance(loaded, dict):
                data = loaded
        except (ValueError, TypeError):
            data = {}
    elif isinstance(raw, dict):
        data = raw

    st = dict(DEFAULT_STATE)
    st.update({k: v for k, v in data.items() if k in DEFAULT_STATE})

    st["idea"] = as_text(st["idea"])
    st["formula"] = as_text(st["formula"])
    st["model"] = as_text(st["model"]).strip()
    st["clip_type"] = as_text(st["clip_type"]).strip() or "minimax"
    st["order"] = ORDER_WIRED if st["order"] == ORDER_WIRED else ORDER_IDEA
    # isinstance FIRST: `x in SEP_MAP` hashes x, so a list or a dict here raised
    # TypeError straight out of parse_state - which run() calls unguarded, so a
    # hand-edited workflow or a crafted /prompt body killed the node with a raw
    # traceback instead of being clamped like every other field.
    st["sep"] = st["sep"] if isinstance(st["sep"], str) and st["sep"] in SEP_MAP \
        else DEFAULT_SEP

    st["seed"] = int(_clamp(st["seed"], 0, 0, 0xFFFFFFFFFFFFFFFF))
    st["temperature"] = _clamp(st["temperature"], 0.7, 0.01, 2.0)
    st["max_length"] = int(_clamp(st["max_length"], 512, 1, 32768))
    st["top_k"] = int(_clamp(st["top_k"], 64, 0, 1000))
    st["top_p"] = _clamp(st["top_p"], 0.95, 0.0, 1.0)
    st["min_p"] = _clamp(st["min_p"], 0.05, 0.0, 1.0)
    st["repetition_penalty"] = _clamp(st["repetition_penalty"], 1.05, 0.0, 5.0)
    st["presence_penalty"] = _clamp(st["presence_penalty"], 0.0, 0.0, 5.0)

    st["do_sample"] = st["do_sample"] is not False
    st["thinking"] = st["thinking"] is True
    st["use_default_template"] = st["use_default_template"] is not False
    st["release_model"] = st["release_model"] is True
    st["system_formula"] = st["system_formula"] is True
    st["mtp"] = st["mtp"] is not False
    return st


def generate_kwargs(st, accepts_mtp):
    """Extra keyword arguments for clip.generate: only `mtp=False`, and only when
    the switch is off AND this ComfyUI's generate takes `mtp`.

    MTP on sends NOTHING extra, so the call stays byte-identical to the one
    before the switch existed (core's own default is mtp=True). An older
    ComfyUI without the argument has no MTP at all, so there is nothing to turn
    off and passing it would raise.
    """
    if st.get("mtp", True) is not False or not accepts_mtp:
        return {}
    return {"mtp": False}


# comfy-kitchen's fast decode kernel (ComfyUI 0.42, `FixedKVCache.attend`) can
# REFUSE its tensors with this RuntimeError on some GPU / PyTorch setups (a
# 5070 Ti on PyTorch 2.8, Discord 2026-10-21); every Qwen3.5 run then stops at
# its first written word (ai-prompt.md #36).
KITCHEN_REFUSAL = "Unsupported Flash Attention"
# Any non-None `comfy_attention.method` makes Qwen3.5's attention decode with
# ComfyUI's regular attention over the cache instead of that kernel; core reads
# the value only to compare it with None and "comfy_kitchen_int8".
PLAIN_DECODE = "pixaroma_plain_decode"
_plain_decode_on = [False]   # remembered for the process after one fallback worked


def kitchen_refused(err):
    """True for the comfy-kitchen decode kernel refusing its tensors."""
    return isinstance(err, RuntimeError) and KITCHEN_REFUSAL in str(err)


def decode_switches(model):
    """The ComfyAttention objects whose decode path ComfyUI picks by `.method`:
    attention layers with a `kv_cache_type` (Qwen3.5's GatedAttention) still on
    the default (method None). Empty for any other model, which this fallback
    cannot help."""
    modules = getattr(model, "modules", None)
    if not callable(modules):
        return []
    found = []
    try:
        for m in modules():
            ca = getattr(m, "comfy_attention", None)
            if ca is not None and hasattr(m, "kv_cache_type") and getattr(ca, "method", 0) is None:
                found.append(ca)
    except Exception:
        return []
    return found


def _with_plain_decode(switches, generate):
    for s in switches:
        s.method = PLAIN_DECODE
    try:
        return generate()
    finally:
        # The model is shared (our cache, or a wired CLIPLoader that core nodes
        # use too): never leave it switched.
        for s in switches:
            s.method = None


def generate_with_fallback(generate, model, reset, log=print):
    """Call `generate()`; when comfy-kitchen's decode kernel refuses, run it ONCE
    more with ComfyUI's regular attention on `model`'s attention layers.

    The first call is untouched, so every setup the kernel works on behaves
    exactly as before. `reset` runs between the two calls: the failed one left
    the per-node runtime half used, and a second generation in one node without
    the reset can abort ComfyUI (ai-prompt.md #25). After one fallback worked,
    later calls in this process go straight to the regular attention instead of
    failing first every time.
    """
    if _plain_decode_on[0]:
        switches = decode_switches(model)
        if switches:
            return _with_plain_decode(switches, generate)
    try:
        return generate()
    except RuntimeError as e:
        if not kitchen_refused(e):
            raise
        switches = decode_switches(model)
        if not switches:
            raise
        log("[Pixaroma] ComfyUI's fast text-writing kernel (comfy-kitchen) refused "
            "this GPU / PyTorch setup (%s). Writing with ComfyUI's regular attention "
            "instead, a little slower, until ComfyUI restarts." % e)
    # Outside the except: the failed attempt's traceback, and the KV cache and
    # buffers its frames hold, are released before the retry allocates its own.
    reset()
    out = _with_plain_decode(switches, generate)
    _plain_decode_on[0] = True
    return out


def _join(parts, sep):
    """Join, dropping blank pieces so a missing one takes its separator too.

    Same rule as Prompt Pixaroma and Text Join: a piece that is whitespace-only
    contributes nothing, and never leaves a stray separator behind.
    """
    kept = [p for p in parts if isinstance(p, str) and p.strip()]
    return sep.join(kept)


def content_text(idea, wired, order, sep):
    """The user's own words: the idea and the wired text, in the chosen order.

    This is also EXACTLY what a pass-through returns. The formula is left out
    on purpose - it is an instruction to a model, so emitting it as content
    when there is no model to read it would put "describe this image in ten
    words" into somebody's positive prompt.
    """
    separator = SEP_MAP.get(sep, SEP_MAP[DEFAULT_SEP])
    pieces = [wired, idea] if order == ORDER_WIRED else [idea, wired]
    return _join(pieces, separator)


def build_prompt(formula, idea, wired, order, sep):
    """The whole string the model is asked."""
    return _join([formula, content_text(idea, wired, order, sep)], FORMULA_SEP)


def will_generate(state, wired_text, has_clip):
    """True when there is both something to ask with and something to ask.

    ONE condition causes a pass-through: no model, or nothing to send. A
    missing formula is not a failure - it just means the model gets the idea by
    itself, which is exactly what a quick "rewrite this" wants.
    """
    if not (has_clip or state.get("model")):
        return False
    return bool(build_prompt(
        state.get("formula", ""),
        state.get("idea", ""),
        wired_text,
        state.get("order", ORDER_IDEA),
        state.get("sep", DEFAULT_SEP),
    ).strip())


def status_line(state, wired_text, has_clip, generated):
    """A SHORT note for the readout, or "" when there is nothing worth saying.

    It deliberately does NOT name the model on a normal run: the banner at the
    top of the node already does, and repeating a 48-character filename beside
    the word count wrapped onto a second line and crowded the PROMPT label.

    The pass-through wordings stay, because those explain something the user
    cannot otherwise see - why the text came back unchanged.
    """
    if generated:
        return ""
    if not (has_clip or state.get("model")):
        return "no model, text passed through"
    return "nothing to send, text passed through"


# A REASONING model narrates its working before it answers, and that narration
# is not the prompt. Qwen3 (the plain one, as used by Z-Image) does it even
# with thinking off, because the template that would suppress it is not the one
# a lumina2-type encoder applies. Without this the node hands back 380 words of
# "Okay, the user wants me to ..." and the image model renders that.
#
# Core's own text node strips a CLOSED block, and these two patterns are copied
# from it so the behaviour matches. What core does not cover is the case this
# was reported from: the reasoning ran past max_length, so there is an opening
# tag and no closing one and NOTHING was ever answered. Core leaves the raw
# reasoning in place there; see reasoning_only() for why that has to be told
# apart rather than passed on.
_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)
_THINK_TAGS = re.compile(r"</?think>|<\|channel>\w*\n?|<channel\|>|<\|turn>\w*\n?")


def strip_reasoning(text):
    """The answer, with any reasoning block removed. Never raises."""
    if not isinstance(text, str):
        return ""
    out = _THINK_BLOCK.sub("", text)
    if "</think>" in out:
        # Truncated: keep whatever follows the last close.
        out = out.rsplit("</think>", 1)[-1]
    elif "<think>" in out:
        # An opening tag and NO closing one: the model ran out of room in the
        # middle of thinking, so everything from that tag onward is unfinished
        # reasoning and none of it is an answer. Core strips the bare tag and
        # hands the reasoning back as though it were one, which is precisely
        # how "Okay, the user wants me to..." reached a user's image.
        out = out.split("<think>", 1)[0]
    return _THINK_TAGS.sub("", out).strip()


def reasoning_only(raw):
    """True when the model spent the whole budget thinking and never answered.

    Told apart from an ordinary empty answer because the fix is different and
    specific: raise Max len, or pick a model that does not reason. Returning
    the reasoning instead - which is what core does here - puts "Okay, the user
    wants me to..." into somebody's image.
    """
    if not isinstance(raw, str) or "<think>" not in raw:
        return False
    # A CLOSED block means the model FINISHED thinking and then chose to write
    # nothing, so it cannot have run out of room - and telling that user to
    # raise Max len sends them to change the one setting that will not help.
    # Only an unclosed block is evidence of truncation.
    if "</think>" in raw:
        return False
    return not strip_reasoning(raw)


# Qwen3 reads /think and /no_think out of the USER turn. That matters because
# the `thinking` argument handed to tokenize only reaches a chat template some
# encoder paths never apply: a Qwen3 loaded as type lumina2 (Z-Image's encoder)
# reasons at length with thinking FALSE, so the toggle said one thing and did
# nothing, and a run took 59s instead of 17s.
_QWEN3 = re.compile(r"qwen[_\-\s]?3", re.I)


def apply_no_think(prompt, thinking, clip_name):
    """Append Qwen3's soft switch when the user has Thinking off.

    Scoped to Qwen3 by name because on any other model the line is not a switch
    at all, just a stray token that could end up quoted back in the answer.
    Left alone when the formula already carries it, so a preset written before
    this existed cannot end up saying it twice.
    """
    if thinking:
        return prompt
    if not isinstance(prompt, str) or not prompt.strip():
        return prompt
    if not _QWEN3.search(str(clip_name or "")):
        return prompt
    if "/no_think" in prompt:
        return prompt
    # A formula carrying chat markers writes its OWN turns, and the tokenizer
    # then passes the text through verbatim - core skips its template when
    # `use_default_template` is off AND, separately, whenever the text starts
    # with `<|im_start|>`. Appending here would land the switch after the final
    # `<|im_start|>assistant`, making it the opening words of the model's reply
    # rather than an instruction in the user's. That is in the PROMPT, so
    # strip_reasoning cannot rescue it; the user just gets an odd answer.
    if "<|im_start|>" in prompt:
        return prompt
    return prompt.rstrip() + "\n\n/no_think"


# ---------------------------------------------------------------------------
# The formula as a SYSTEM message (2026-10-16)
# ---------------------------------------------------------------------------
# By default the formula goes INSIDE the prompt, above the idea (build_prompt).
# Core's TextGenerate can instead send an instruction as the model's system
# message (its `system_prompt` input, ComfyUI 0.38.0+), and a model TRAINED that
# way - BFL's FLUX 3 prompt upsampler - writes a different caption when the
# same words arrive in the user turn (measured, Ep39 jobs14.py). The switch
# makes this node ask exactly what TextGenerate asks.
#
# It can only happen when the model has a system turn to put it in, and an
# older ComfyUI would not say so: every tokenizer ends in **kwargs, so an
# unknown system_prompt is accepted and silently DROPPED - the formula would
# vanish from the request. So support is TESTED (tokenize_honours), and anything
# that cannot take it falls back to today's prompt WITH a note.
NOTE_NO_SYSTEM = "no system message on this model, formula sent in the prompt"
NOTE_TEMPLATE_OFF = "template off, formula sent in the prompt"
NOTE_ONLY_FORMULA = "only the formula to send, so it went in the prompt"

# The fixed tokenize arguments of a system-mode run (the template is on there),
# so a probe builds exactly what the real call will.
_PROBE_BASE = {"skip_template": False, "min_length": 1}


def tokenize_honours(clip, kwarg, on_value, off_value, base=None):
    """True when passing `kwarg` CHANGES what the clip's tokenizer builds.

    Found out by doing it: a one-letter probe is tokenized both ways and the
    results compared (text only, no model runs - a few milliseconds). Reading
    the tokenizer's SIGNATURE was the first version and it was wrong (review
    2026-10-16, reproduced live): Gemma 4's tokenizer and the Qwen3-VL types
    krea2 / flux3 take only **kwargs on the outside and hand them to an inner
    tokenizer that DOES build the system turn, so a working model was reported
    as having none - while an older ComfyUI, also **kwargs, really drops it.
    Only the tokens tell those apart. Never raises: any failure means False,
    which falls back to the formula inside the prompt.
    """
    tokenize = getattr(clip, "tokenize", None)
    if not callable(tokenize):
        return False
    args = dict(_PROBE_BASE if base is None else base)
    try:
        off = tokenize("a", **dict(args, **{kwarg: off_value}))
        on = tokenize("a", **dict(args, **{kwarg: on_value}))
        return repr(off) != repr(on)
    except Exception:
        return False


def plan_prompt(state, wired_text, clip_name, clip):
    """(prompt, extra tokenize kwargs, note) for a generating run.

    Switch OFF, or no formula: EXACTLY what the node always asked - the formula
    above the idea, plus the name-scoped /no_think - and no extra kwargs, so the
    tokenize call stays byte-identical to before the switch existed.

    Switch ON and possible: the idea (+ wired text) alone as the prompt and the
    formula VERBATIM as `system_prompt`, which is what TextGenerate sends. No
    /no_think where the template handles thinking itself (Qwen3.5 / Qwen3-VL add
    the empty think block), or the request would no longer match core's; plain
    Qwen3 (Z-Image's encoder) has no such control, so it keeps the switch in the
    user turn - otherwise Thinking off would reason for a minute (#14c).

    Switch ON but impossible: today's prompt and a note for the readout.
    """
    st = state
    formula = st.get("formula", "")
    thinking = st.get("thinking", False)
    user_turn = content_text(st.get("idea", ""), wired_text,
                             st.get("order", ORDER_IDEA), st.get("sep", DEFAULT_SEP))
    note = ""
    if st.get("system_formula") and formula.strip():
        if not st.get("use_default_template", True):
            note = NOTE_TEMPLATE_OFF
        elif not user_turn.strip():
            note = NOTE_ONLY_FORMULA
        elif not tokenize_honours(clip, "system_prompt", "x", "",
                                  dict(_PROBE_BASE, thinking=bool(thinking))):
            note = NOTE_NO_SYSTEM
        else:
            prompt = user_turn
            if not tokenize_honours(clip, "thinking", True, False):
                prompt = apply_no_think(prompt, thinking, clip_name)
            return prompt, {"system_prompt": formula}, ""
    prompt = build_prompt(formula, st.get("idea", ""), wired_text,
                          st.get("order", ORDER_IDEA), st.get("sep", DEFAULT_SEP))
    return apply_no_think(prompt, thinking, clip_name), {}, note


def word_count(text):
    return len([w for w in str(text or "").split() if w.strip()])


# ---------------------------------------------------------------------------
# Extra pictures: image_2 ... image_8
# ---------------------------------------------------------------------------
# The browser adds these sockets one at a time as pictures are wired (2026-09-29,
# asked for on Discord: a batch crops every picture to the first one's size). They
# are NOT declared in the node's schema, so ComfyUI never adds them to a node that
# was saved before they existed - an old workflow opens exactly as it was saved.
MAX_IMAGES = 8  # `image` plus image_2 ... image_8
_EXTRA_IMAGE = re.compile(r"image_(\d+)")


def is_extra_image_key(name):
    """True for image_2 ... image_<MAX_IMAGES>, and for nothing else."""
    if not isinstance(name, str):
        return False
    m = _EXTRA_IMAGE.fullmatch(name)
    return bool(m) and 2 <= int(m.group(1)) <= MAX_IMAGES


def extra_image_keys(values):
    """The image_N keys present in `values`, in picture order (image_2 first)."""
    try:
        keys = [k for k in values if is_extra_image_key(k)]
    except TypeError:
        return []
    return sorted(keys, key=lambda k: int(k.split("_")[1]))


def bytes_or_none(value):
    """A recorded model size from a stored or sent payload (checked), or None.

    Shared by both preset stores rather than copied: the same concept living in
    two files is exactly how the vision heuristic drifted (js/shared/model_kinds
    .mjs records that one).

    Purely cosmetic - it labels a row in a picker - so anything odd becomes None
    rather than raising. Bounded at 1 TB because a size is only useful while it
    is plausible, and bools are refused explicitly or `int(True)` would sneak
    through as 1 byte.
    """
    if isinstance(value, bool):
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if 0 < n <= (1 << 40) else None


class AIPromptInputs(dict):
    """The node's optional inputs: the five declared ones, exactly as before,
    PLUS image_2 ... image_8, which the browser adds one at a time as pictures
    are wired.

    Iterating this dict yields ONLY the five, so they are all the schema lists -
    ComfyUI therefore never adds image_2 to a node saved before it existed, and
    an old workflow opens exactly as it was. `in` and `[]` still answer for the
    extra names, so a prompt carrying them links its upstream and hands the
    picture to run(). They are NOT pre-flight validated (core's validate_inputs
    iterates the declared keys only), so a broken source on image_2 fails when
    it runs, with a clear error on THAT node, rather than before the run starts
    - measured with a missing-file Load Image. Deliberately NARROW (only image_N) rather than
    the "contains everything" FlexibleOptionalInputType: that one would also
    claim the HIDDEN AIPromptState input as optional."""

    def __contains__(self, key):
        return dict.__contains__(self, key) or is_extra_image_key(key)

    def __getitem__(self, key):
        if dict.__contains__(self, key):
            return dict.__getitem__(self, key)
        if is_extra_image_key(key):
            return ("IMAGE", {"tooltip": "Another picture for the model to look at, "
                              "at its own size. Wiring one adds the next slot."})
        raise KeyError(key)
