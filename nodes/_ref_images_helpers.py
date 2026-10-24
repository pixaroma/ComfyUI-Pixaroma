"""Reference Images Pixaroma - the pure part: the saved state, the model's tag
for "picture N", the prompt the node sends, and which model the prompt goes to.

No ComfyUI import at module level, so the parity harness can load it with no
ComfyUI on the path (D:\\Claude Tests\\_ref_images\\parity.py). The browser
builds the SAME prompt for its live "Prompt sent" box (js/reference_images/
core.mjs); the harness runs both on the same cases and they must match byte for
byte. Change one, change the other, then re-run the harness.

Every model names its reference pictures its own way (checked in the user's own
workflows, 2026-10-24):
    Qwen Image 2.1       <image1>, <image2> ...      (Ep36)
    FLUX 3 Image Klein   <ref_image_0>, <ref_image_1> ... COUNTS FROM 0 (Ep39)
    MiniMax H3           <Picture 1>, <Picture 2> ... (core node text, Ep41)
    everything else      image 1, image 2 ...        (plain words: Flux 2 Klein)
"""

import json
import re

MAX_CARDS = 8
MAX_NAME = 120
MAX_TEXT = 20000
MAX_PHRASE = 200
MAX_CUSTOM = 60

MODELS = ("auto", "qwen21", "flux3", "h3", "plain", "custom")
MODEL_LABELS = {
    "auto": "Auto",
    "qwen21": "Qwen Image 2.1",
    "flux3": "FLUX 3 Image Klein",
    "h3": "MiniMax H3",
    "plain": "Plain words",
    "custom": "Custom",
}
DEFAULT_CUSTOM = "<image{n}>"

# key -> (the words used when the card has no name, the phrase). {name} is the
# card's own name or those default words, {ref} is the model's tag. A phrase
# whose {name} comes out empty is just the tag.
ROLES = (
    ("character", "the character", "{name} from {ref}"),
    ("person", "the person", "{name} from {ref}"),
    ("face", "the face", "{name} from {ref}"),
    ("outfit", "the outfit", "{name} from {ref}"),
    ("pose", "the pose", "{name} from {ref}"),
    ("object", "the object", "{name} from {ref}"),
    ("product", "the product", "{name} from {ref}"),
    ("background", "the background", "{name} from {ref}"),
    ("style", "the art style", "{name} of {ref}"),
    ("lighting", "the lighting", "{name} from {ref}"),
    ("colors", "the colors", "{name} of {ref}"),
    ("other", "", "{name} from {ref}"),
)
ROLE_KEYS = tuple(r[0] for r in ROLES)
_ROLE_NOUN = {r[0]: r[1] for r in ROLES}
_ROLE_PHRASE = {r[0]: r[2] for r in ROLES}

LIST_POSITIONS = ("before", "after", "off")
FILLS = ("white", "grey", "black")
SIZES = ("keep", "1mp", "2mp")
MULTIPLES = ("auto", "off", "16", "32", "64")

# What the prompt output is wired into says which model reads it. Nearest wins.
_CLASS_MODEL = {
    "TextEncodeQwenImage21": "qwen21",
    "ReferenceMultiLatent": "flux3",
    "Flux3LayoutPrompt": "flux3",
    # Known plain-words readers: a hit here stops the search, so a Klein graph
    # that ALSO holds a FLUX 3 branch further away is not taken for FLUX 3.
    "ReferenceLatent": "plain",
    "TextEncodeQwenImageEdit": "plain",
    "TextEncodeQwenImageEditPlus": "plain",
}
_DETECT_DEPTH = 6


def class_model(class_type):
    """The model a node class tells us about, or None."""
    if not isinstance(class_type, str):
        return None
    if class_type in _CLASS_MODEL:
        return _CLASS_MODEL[class_type]
    if class_type.startswith("MiniMaxH3"):
        return "h3"
    return None


def _pick(value, allowed, default):
    return value if isinstance(value, str) and value in allowed else default


def _text(value, cap):
    return value[:cap] if isinstance(value, str) else ""


# ONE whitespace set in both languages: Python's strip() and JS's trim() disagree
# on a few rare characters (U+FEFF, \x1c-\x1f), which would split the parity.
_WS = " \t\n\r\f\v"


def _strip(s):
    return s.strip(_WS)


def parse_state(raw):
    """A healed copy of the node's state. Never raises: a broken or hostile
    blob comes back as an empty node."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw.strip() else {}
        except (ValueError, TypeError):
            raw = {}
    if not isinstance(raw, dict):
        raw = {}
    cards = []
    for c in raw.get("cards") or []:
        if not isinstance(c, dict):
            continue
        cards.append({
            "file": _text(c.get("file"), 260),
            "sub": _text(c.get("sub"), 260),
            "role": _pick(c.get("role"), ROLE_KEYS, "other"),
            "name": _text(c.get("name"), MAX_NAME),
        })
        if len(cards) >= MAX_CARDS:
            break
    phrases = {}
    raw_phrases = raw.get("phrases")
    if isinstance(raw_phrases, dict):
        for k in ROLE_KEYS:
            v = raw_phrases.get(k)
            if isinstance(v, str) and _strip(v):
                phrases[k] = v[:MAX_PHRASE]
    return {
        "model": _pick(raw.get("model"), MODELS, "auto"),
        "custom": _text(raw.get("custom"), MAX_CUSTOM),
        "cards": cards,
        "text": _text(raw.get("text"), MAX_TEXT),
        "list": _pick(raw.get("list"), LIST_POSITIONS, "before"),
        "fill": _pick(raw.get("fill"), FILLS, "white"),
        "size": _pick(raw.get("size"), SIZES, "keep"),
        "multiple": _pick(raw.get("multiple"), MULTIPLES, "auto"),
        "phrases": phrases,
    }


def tag(model, n, custom=""):
    """How `model` names picture n (1-based)."""
    if model == "qwen21":
        return "<image%d>" % n
    if model == "flux3":
        return "<ref_image_%d>" % (n - 1)
    if model == "h3":
        return "<Picture %d>" % n
    if model == "custom":
        pat = _strip(custom) or DEFAULT_CUSTOM
        return pat.replace("{n}", str(n)).replace("{i}", str(n - 1))
    return "image %d" % n


def phrase_for(card, ref, phrases=None):
    """One picture's part of the list sentence."""
    role = card.get("role") if card.get("role") in ROLE_KEYS else "other"
    template = (phrases or {}).get(role) or _ROLE_PHRASE[role]
    name = _strip(card.get("name") or "") or _ROLE_NOUN[role]
    if "{name}" in template and not name:
        return ref
    return _strip(template.replace("{name}", name).replace("{ref}", ref))


def _join(parts):
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts[:-1]) + " and " + parts[-1]


def list_sentence(state, model):
    cards = state["cards"]
    if not cards:
        return ""
    parts = [phrase_for(c, tag(model, i + 1, state["custom"]), state["phrases"])
             for i, c in enumerate(cards)]
    parts = [p for p in parts if p]
    if not parts:
        return ""
    return "Use " + _join(parts) + "."


# @1 .. @8 in the user's text. Not inside a word (mail@1x) and not @12 read as @1.
_AT = re.compile(r"(?<![A-Za-z0-9_@])@([0-9]{1,2})(?![0-9])")


def convert_tags(text, model, count, custom=""):
    """@N becomes the model's tag for picture N; an @N with no picture N stays."""
    def sub(m):
        n = int(m.group(1))
        return tag(model, n, custom) if 1 <= n <= count else m.group(0)
    return _AT.sub(sub, text or "")


def missing_tags(text, count):
    """The @N numbers in the text that have no picture (the face warns)."""
    out = []
    for m in _AT.finditer(text or ""):
        n = int(m.group(1))
        if not 1 <= n <= count and n not in out:
            out.append(n)
    return out


def build_prompt(state, model, text=None):
    """The prompt the node sends. `text` = a wired text, which replaces the
    node's own box; None = use the box."""
    own = state["text"] if text is None else str(text)
    count = len(state["cards"])
    body = _strip(convert_tags(own, model, count, state["custom"]))
    lst = list_sentence(state, model) if state["list"] != "off" else ""
    if state["list"] == "after":
        parts = [body, lst]
    else:
        parts = [lst, body]
    return " ".join(p for p in parts if p)


def detect_model(prompt, node_id):
    """Follow our `prompt` output (slot 0) downstream through any nodes, up to
    _DETECT_DEPTH steps, and return the model of the nearest node that names
    one, or "plain" when none does. `prompt` is the API prompt ComfyUI runs."""
    if not isinstance(prompt, dict) or node_id is None:
        return "plain"
    me = str(node_id)
    first, any_slot = [], {}
    nodes = {str(k): v for k, v in prompt.items()}
    for nid in sorted(nodes):
        entry = nodes[nid]
        if not isinstance(entry, dict):
            continue
        inputs = entry.get("inputs")
        if not isinstance(inputs, dict):
            continue
        for v in inputs.values():
            if not (isinstance(v, (list, tuple)) and len(v) == 2):
                continue
            src, slot = str(v[0]), v[1]
            any_slot.setdefault(src, [])
            if nid not in any_slot[src]:
                any_slot[src].append(nid)
            if src == me and slot == 0 and nid not in first:
                first.append(nid)
    seen = {me}
    level = first
    for _ in range(_DETECT_DEPTH):
        nxt = []
        for nid in level:
            if nid in seen:
                continue
            seen.add(nid)
            entry = nodes.get(nid)
            hit = class_model(entry.get("class_type") if isinstance(entry, dict) else None)
            if hit:
                return hit
            nxt.extend(any_slot.get(nid, []))
        if not nxt:
            break
        level = nxt
    return "plain"


def effective_multiple(state, model):
    m = state["multiple"]
    if m == "auto":
        # Qwen Image 2.1's encoder STRETCHES every picture onto a 32 grid, so an
        # edit comes back a little wider or narrower. Trimming first avoids it.
        return 32 if model == "qwen21" else 1
    if m == "off":
        return 1
    return int(m)


def target_size(width, height, state, model):
    """(scale_to_w, scale_to_h, crop_w, crop_h) for one picture: first scaled
    down (never up) to the size cap, then the edges trimmed evenly to a
    multiple. Never a stretch."""
    w, h = int(width), int(height)
    cap = {"1mp": 1024 * 1024, "2mp": 2048 * 1024}.get(state["size"])
    if cap and w * h > cap:
        k = (cap / float(w * h)) ** 0.5
        w, h = max(1, int(round(w * k))), max(1, int(round(h * k)))
    m = effective_multiple(state, model)
    cw = (w // m) * m if m > 1 and w >= m else w
    ch = (h // m) * m if m > 1 and h >= m else h
    return w, h, cw, ch


def fill_value(state):
    return {"white": 1.0, "grey": 0.5, "black": 0.0}[state["fill"]]
