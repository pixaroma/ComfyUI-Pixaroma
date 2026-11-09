# nodes/_video_prompt_helpers.py
"""Pure helpers for Video Prompt Pixaroma.

NO torch, NO ComfyUI imports at module scope, so the whole assembly can be
unit-tested with a bare python (harness: D:\\Claude Tests\\_video_prompt_test.py).
Anything that needs a tensor lives in node_video_prompt.py instead.

WHAT THIS REPLACES
------------------
Three workflows, each about ten nodes, that differed only in which formula text
went into a Text Join Three. The formulas themselves were extracted verbatim
from those workflows on 2026-08-12, so a prompt built here is byte-identical to
one the tested workflows produced. The two things that make that true and are
easy to break:

  * the join is a SINGLE newline with empty parts skipped (the Text Join Three
    was configured `{"sep":"newline","skipEmpty":true}`), and
  * each formula already ENDS with "IDEA:\\n", so the join adds the blank line
    that the tested prompts had between that label and the idea.

Change either and every formula in the pack is being fed a shape it was never
measured against.
"""
from __future__ import annotations

import json
import os
import re

# ---------------------------------------------------------------------------
# Modes. A FIXED tuple, deliberately: the mode is the only thing that reaches a
# filename here, and validating it against this tuple means no request can ever
# name a file we did not ship. That is cheaper and stronger than sanitising a
# free string (.claude/patterns/path-containment.md).
# ---------------------------------------------------------------------------
TEXT_TO_VIDEO = "text_to_video"
FIRST_FRAME = "first_frame"
FIRST_LAST = "first_last"
MODES = (TEXT_TO_VIDEO, FIRST_FRAME, FIRST_LAST)

MODE_LABELS = {
    TEXT_TO_VIDEO: "Text to video",
    FIRST_FRAME: "First frame",
    FIRST_LAST: "First and last frame",
}

_PACK_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SHIPPED_DIR = os.path.join(_PACK_DIR, "assets", "video_prompt_formulas")

_DEFAULT_MODEL = "qwen3-vl-8b-heretic-1.3.0_fp8_e4m3fn.safetensors"

# Mirrors the TextGenerate widget values in the three tested workflows. Changing
# any of these changes every prompt the pack produces, so they are named here
# rather than scattered as literals.
DEFAULT_SAMPLING = {
    "model": _DEFAULT_MODEL,
    "clip_type": "minimax",
    "temperature": 0.3,
    "max_length": 512,
    "top_k": 64,
    "top_p": 0.95,
    "min_p": 0.05,
    "repetition_penalty": 1.05,
    "presence_penalty": 0.0,
    "thinking": False,
    "use_default_template": True,
}

# MiniMax H3's frame shape: 24 fps, snap up to 17n + 5, which is where the
# familiar 5 s -> 124 frames comes from. Carried here so the node can hand out a
# FRAME COUNT as well as a length, and the video can no longer be rendered at a
# different duration than the prompt was written for - the exact mismatch that
# spoiled the first real clip (project_h3_first_real_clips).
DEFAULT_VIDEO = {
    "fps": 24.0,
    "step": 17,
    "plus": 5,
    # 5, matching Duration Pixaroma's MiniMax H3 recipe, so the settings
    # picker recognises the defaults instead of reporting "Custom".
    "min_frames": 5,
}


def valid_mode(mode) -> bool:
    return isinstance(mode, str) and mode in MODES


# ---------------------------------------------------------------------------
# Choosing a model when the user has not
# ---------------------------------------------------------------------------
# The shipped default names ONE file. Anybody who does not happen to have that
# exact file - which is nearly everybody - would drop the node, type an idea,
# press Run and get a failure, having never opened the settings. So when the
# named file is absent we pick the best VISION model on disk instead.
#
# Vision is not optional: the first-frame modes have to see the picture, and a
# text-only model silently ignores it.
def _score_model(name: str) -> int:
    """Higher is better. 0 means 'not a vision LLM, do not use'."""
    n = name.lower()
    if "vl" not in n:                     # qwen3-VL, Qwen3-VL-Instruct, ...
        return 0
    # A tuned/uncensored build follows these formulas more closely, and 8B beats
    # 4B on every measure we have. Beyond that, leave the order alone.
    score = 10
    if "qwen3-vl" in n or "qwen3vl" in n:
        score += 40
    if "8b" in n:
        score += 20
    elif "4b" in n:
        score += 10
    if "heretic" in n or "abliterated" in n:
        score += 5
    return score


def pick_model(available, wanted):
    """(chosen, auto) - `auto` is True when we substituted for a missing file.

    Returns (None, False) when nothing on disk looks like a vision LLM, so the
    caller can say what to download rather than failing deep inside a loader.
    """
    names = [n for n in (available or []) if isinstance(n, str)]
    if isinstance(wanted, str) and wanted in names:
        return wanted, False
    # A workflow saved on Windows names qwen\x, Linux and Mac list qwen/x (and
    # the other way round). The same file, so not a substitution: without this
    # Linux silently picked whatever scored best instead.
    if isinstance(wanted, str) and wanted:
        want = wanted.replace("\\", "/")
        for n in names:
            if n.replace("\\", "/") == want:
                return n, False
    scored = [(s, n) for s, n in ((_score_model(n), n) for n in names) if s > 0]
    if not scored:
        return None, False
    # Sort by score, then by name, so the choice is STABLE run to run - an
    # unstable pick would change the output for no visible reason.
    scored.sort(key=lambda p: (-p[0], p[1].lower()))
    return scored[0][1], True


def mode_for(has_first: bool, has_last: bool) -> str:
    """Which formula to run, derived purely from which images arrived.

    Nothing here is stored on the node, which is the whole point: a mode that is
    computed can never go stale on a workflow load, and a connection handler
    that writes no serialized state needs none of the configure-replay gating
    that has bitten the Switch family twice (Vue Compat #17 / #19).

    A last frame with NO first frame is treated as first-frame-only rather than
    refused: the picture is still a real anchor, and refusing would mean a wire
    that silently does nothing.
    """
    if has_first and has_last:
        return FIRST_LAST
    if has_first or has_last:
        return FIRST_FRAME
    return TEXT_TO_VIDEO


# ---------------------------------------------------------------------------
# Where the editable copies live
# ---------------------------------------------------------------------------
def user_dir() -> str:
    """<ComfyUI user dir>/pixaroma/video_prompt_formulas.

    NOT inside the plugin folder. The plugin is a git working tree, so an edited
    formula there is one `git add -A` from being published, and a Manager
    reinstall would wipe it. Same reasoning as the Civitai key sidecar and the
    path guard's own allowlist.

    No makedirs here - this is called on every read. Creating it is the writer's
    job (_path_guard._config_path does the same and for the same reason).
    """
    base = None
    try:
        import folder_paths

        base = folder_paths.get_user_directory()
    except Exception:
        base = None
    if not base:
        base = os.path.join(os.path.expanduser("~"), ".pixaroma")
    return os.path.join(base, "pixaroma", "video_prompt_formulas")


def _shipped(mode: str, suffix: str) -> str:
    return os.path.join(_SHIPPED_DIR, mode + suffix)


def _override(mode: str, suffix: str) -> str:
    return os.path.join(user_dir(), mode + suffix)


def _read_text(path: str):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return None


def _write_text(path: str, text: str) -> bool:
    """Atomic write. A half-written formula is worse than an old one: the node
    would still run and would quietly produce a truncated prompt."""
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
        return True
    except Exception:
        return False


def load_formula(mode: str) -> str:
    """The user's edited formula if there is one, else the shipped default."""
    if not valid_mode(mode):
        return ""
    text = _read_text(_override(mode, ".txt"))
    if text is None:
        text = _read_text(_shipped(mode, ".txt"))
    return text or ""


def shipped_formula(mode: str) -> str:
    if not valid_mode(mode):
        return ""
    return _read_text(_shipped(mode, ".txt")) or ""


def is_edited(mode: str) -> bool:
    """True when a user override exists, so the panel can mark the row."""
    if not valid_mode(mode):
        return False
    return os.path.exists(_override(mode, ".txt")) or os.path.exists(
        _override(mode, ".durations.json")
    )


def save_formula(mode: str, text: str) -> bool:
    if not valid_mode(mode) or not isinstance(text, str):
        return False
    return _write_text(_override(mode, ".txt"), text)


def reset_formula(mode: str) -> bool:
    """Delete the override so the shipped formula is used again."""
    if not valid_mode(mode):
        return False
    ok = True
    for suffix in (".txt", ".durations.json"):
        p = _override(mode, suffix)
        if os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                ok = False
    return ok


def formulas_fingerprint() -> str:
    """A value that changes whenever any formula or tier file changes.

    ⚠️ WITHOUT THIS THE SETTINGS PANEL APPEARS BROKEN. The formulas are read
    from DISK at execution time, so they are not part of the node's inputs and
    therefore not part of ComfyUI's cache key. Measured 2026-08-12: edit the
    active tier, press Run, and the run completes in 1.0s from cache with the
    identical text - the edit silently ignored. Only Random-seed users escaped,
    because their state changed anyway.

    mtime_ns + size, not a content hash: it has to be STABLE when nothing
    changed, or the node would re-run a 20-second model load on every queue.
    Both the override AND the shipped file are stamped, because deleting an
    override (Reset) changes which one is read.

    All six files, not just the active mode's: IS_CHANGED cannot know the mode,
    which is derived from the image wires. The cost is that editing one mode's
    formula also re-runs a node using another - which is the correct outcome
    anyway, since you edited a formula to see what it does.
    """
    parts = []
    for mode in MODES:
        for suffix in (".txt", ".durations.json"):
            for tag, path in (("u", _override(mode, suffix)),
                              ("s", _shipped(mode, suffix))):
                try:
                    st = os.stat(path)
                    parts.append("%s%s%s:%d:%d" % (tag, mode, suffix,
                                                   st.st_mtime_ns, st.st_size))
                except OSError:
                    # Absent is a state too: an override appearing or vanishing
                    # must change the fingerprint.
                    parts.append("%s%s%s:-" % (tag, mode, suffix))
    return "|".join(parts)


def _coerce_tiers(obj):
    """Keep only well-formed {name, value} entries.

    A damaged override must degrade to the shipped list, never raise in the
    middle of a render and never hand the model a half-list.
    """
    if not isinstance(obj, list):
        return None
    out = []
    for item in obj:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        value = item.get("value")
        if isinstance(name, str) and isinstance(value, str) and name.strip():
            out.append({"name": name, "value": value})
    return out or None


def load_durations(mode: str) -> list:
    if not valid_mode(mode):
        return []
    raw = _read_text(_override(mode, ".durations.json"))
    if raw is not None:
        try:
            tiers = _coerce_tiers(json.loads(raw))
            if tiers:
                return tiers
        except Exception:
            pass
    raw = _read_text(_shipped(mode, ".durations.json"))
    try:
        return _coerce_tiers(json.loads(raw)) or []
    except Exception:
        return []


def save_durations(mode: str, tiers) -> bool:
    if not valid_mode(mode):
        return False
    clean = _coerce_tiers(tiers)
    if clean is None:
        return False
    return _write_text(
        _override(mode, ".durations.json"),
        json.dumps(clean, ensure_ascii=False, indent=2),
    )


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------
_SECONDS_RE = re.compile(r"(\d+(?:\.\d+)?)")


def seconds_from_tier(name) -> float:
    """'8 seconds' -> 8.0. Returns 0.0 when there is no number to find, so a
    hand-renamed tier degrades to 'unknown' rather than to a wrong number."""
    if not isinstance(name, str):
        return 0.0
    m = _SECONDS_RE.search(name)
    if not m:
        return 0.0
    try:
        return float(m.group(1))
    except (TypeError, ValueError):
        return 0.0


def pick_tier(tiers, index, name=None):
    """Resolve the chosen tier, preferring the NAME over the index.

    The name survives a reordered or edited tier list; the index does not. A
    saved workflow that picked '8 seconds' should still get 8 seconds after the
    user inserts a 6-second tier above it.
    """
    tiers = tiers or []
    if not tiers:
        return None
    if isinstance(name, str) and name:
        for t in tiers:
            if t.get("name") == name:
                return t
    try:
        i = int(index)
    except (TypeError, ValueError):
        i = 0
    if 0 <= i < len(tiers):
        return tiers[i]
    return tiers[0]


def join_parts(parts, sep="\n") -> str:
    """The Text Join Three contract: skipEmpty, single separator.

    Whitespace-only parts count as empty, matching the node it replaces.
    """
    kept = [p for p in parts if isinstance(p, str) and p.strip()]
    return sep.join(kept)


def build_prompt(formula: str, idea: str, length_block: str) -> str:
    """Formula + idea + length, in that order. See the module docstring for why
    the order and the separator are not free choices."""
    return join_parts([formula, idea, length_block], "\n")


def word_count(text) -> int:
    if not isinstance(text, str):
        return 0
    return len(text.split())


def parse_state(raw):
    """Defensive read of the hidden state blob.

    request.json() and a widget value can both be ANY type, so this never
    assumes a dict (reference_request_json_returns_any_type).
    """
    if isinstance(raw, dict):
        obj = raw
    else:
        try:
            obj = json.loads(raw) if isinstance(raw, str) and raw.strip() else {}
        except Exception:
            obj = {}
    if not isinstance(obj, dict):
        obj = {}
    out = dict(DEFAULT_SAMPLING)
    out.update(DEFAULT_VIDEO)
    out.update(
        {
            "idea": "",
            "tier_index": 1,
            "tier_name": "",
            "seed": 0,
            "release_model": False,
            # ON by default: the shipped formulas are written to be paired with
            # a length block. Off is for somebody running their own wording.
            "length_block": True,
            # Multi-token prediction, core Generate Text's `mtp` (ai-prompt.md
            # #34). On = the generate call exactly as before.
            "mtp": True,
        }
    )
    # Only keys we already know about: an unknown key in a hand-edited blob must
    # not become a kwarg further down.
    for k, v in obj.items():
        if k in out:
            out[k] = v
    # Types the caller relies on. A string seed from a hand-edited blob would
    # reach torch and raise deep inside generation instead of here.
    out["idea"] = out["idea"] if isinstance(out["idea"], str) else ""
    out["tier_name"] = out["tier_name"] if isinstance(out["tier_name"], str) else ""
    for key, cast, default in (
        # 1, matching the browser's default of "8 seconds". It was 0 here, so a
        # hand-built API call with no state blob silently picked 5 seconds - the
        # one tier that cannot write a talking prompt.
        ("tier_index", int, 1),
        ("seed", int, 0),
        ("max_length", int, 512),
        ("top_k", int, 64),
        ("temperature", float, 0.3),
        ("top_p", float, 0.95),
        ("min_p", float, 0.05),
        ("repetition_penalty", float, 1.05),
        ("presence_penalty", float, 0.0),
        ("fps", float, 24.0),
        ("step", int, 17),
        ("plus", int, 5),
        ("min_frames", int, 5),
    ):
        try:
            out[key] = cast(out[key])
        except (TypeError, ValueError):
            out[key] = default
    out["thinking"] = out["thinking"] is True
    out["use_default_template"] = out["use_default_template"] is not False
    out["release_model"] = out["release_model"] is True
    out["length_block"] = out["length_block"] is not False
    out["mtp"] = out["mtp"] is not False
    if not isinstance(out["model"], str) or not out["model"].strip():
        out["model"] = _DEFAULT_MODEL
    if not isinstance(out["clip_type"], str) or not out["clip_type"].strip():
        out["clip_type"] = "minimax"
    # Clamps. /prompt is UNAUTHENTICATED and the browser is not the only caller,
    # so every sampling value is clamped here too, mirroring core.mjs. The
    # ranges are byte-for-byte core's own TextGenerate schema.
    #
    # (An earlier comment here claimed temperature 0 divides by zero and dies in
    # torch.multinomial. That is WRONG - comfy/text_encoders/llama.py's
    # sample_token returns argmax at exactly 0.0, i.e. greedy decoding. The
    # clamp stays because it matches core's declared minimum, not because 0
    # crashes. Recorded so nobody "hardens" the wrong thing later.)
    #
    # max_length matters most: the abliterated models do not emit a stop token
    # reliably, so an absurd value is a multi-minute run. fps is floored at 1
    # rather than 0.01 because a sub-1-fps video is not a thing, and 0.01 would
    # turn 5 frames into a reported 500 seconds on the `seconds` output.
    out["max_length"] = max(1, min(32768, out["max_length"]))
    out["seed"] = max(0, min(0xFFFFFFFFFFFFFFFF, out["seed"]))
    out["temperature"] = max(0.01, min(2.0, out["temperature"]))
    out["top_p"] = max(0.0, min(1.0, out["top_p"]))
    out["min_p"] = max(0.0, min(1.0, out["min_p"]))
    out["top_k"] = max(0, min(1000, out["top_k"]))
    out["repetition_penalty"] = max(0.0, min(5.0, out["repetition_penalty"]))
    out["presence_penalty"] = max(0.0, min(5.0, out["presence_penalty"]))
    out["fps"] = max(1.0, min(1000.0, out["fps"]))
    return out


# A duration tier does TWO jobs, and only one of them is "length instructions".
# Besides our word-count guidance it carries, in first_last mode, the ALIGNMENT
# LINE that the formula orders the model to copy as its very first output line -
# and that line has to name THIS tier's end second ("...aligns with the
# 8.00-second mark").
#
# So the switch keeps the alignment part. Without this the tier was dropped
# whole, and the only alignment line left anywhere in the prompt was the one
# inside the formula's own EXAMPLE section, fixed at 5.00 seconds - so an 8, 10
# or 15 second render silently told the model its last picture lands at 5.00s,
# with no error and a prompt that looks complete. The example beats the rules
# for a small model, so it WOULD be copied. Reproduced 2026-08-12 across all
# four tiers; 5 seconds passed only because the example happens to be 5s, and
# the default tier is 8.
_STRUCTURAL_RE = re.compile(r"^ALIGNMENT LINE\b", re.I | re.M)


def structural_tail(value) -> str:
    """The part of a tier the FORMULA requires, independent of our length text.

    Empty when a tier has no such part - which is every tier of text_to_video
    and first_frame - so switching the length block off still removes the whole
    tier there, exactly as before.
    """
    if not isinstance(value, str):
        return ""
    match = _STRUCTURAL_RE.search(value)
    return value[match.start():].strip() if match else ""


def assemble(state, mode: str):
    """The whole text side of a run, in one testable call.

    Returns (prompt, seconds, tier_name). Kept separate from the node so the
    harness can diff a generated prompt against the tested workflows without
    ComfyUI, torch or a model on disk.

    `length_block` off means the tier's LENGTH text is not appended, so somebody
    running their own wording is not handed our H3 length instructions. Anything
    the formula structurally requires survives the switch - see structural_tail.
    The tier still sets the DURATION: the seconds come from its NAME, so
    `frames` and `seconds` keep working and the chips simply become "how long is
    this video" rather than "how much to write".
    """
    st = parse_state(state)
    tiers = load_durations(mode)
    tier = pick_tier(tiers, st["tier_index"], st["tier_name"])
    tier_name = tier.get("name", "") if tier else ""
    raw_tier = tier.get("value", "") if tier else ""
    length_block = raw_tier if st["length_block"] else structural_tail(raw_tier)
    prompt = build_prompt(load_formula(mode), st["idea"], length_block)
    return prompt, seconds_from_tier(tier_name), tier_name
