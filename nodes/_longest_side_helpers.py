"""Longest Side Pixaroma - the pure maths.

No torch, no PIL, no ComfyUI: everything here is integers in, integers out, so
it can be unit-tested with the plain system Python and mirrored exactly in the
browser (js/longest_side/core.mjs). The browser copy paints the size preview on
the node face, and the face must never promise a size the run will not produce,
so the two have to agree on every value - which is why there is not a single
float division below.

The job, in order:
  1. crop_rect  - the largest rectangle of the wanted shape that fits the image
  2. target_size- scale that rectangle so its LONGER side hits the target
  3. snap       - round both sides to the step, if one is set
"""

import json

# What the step button cycles through. 0 is Off. Anything else that arrives
# (a hand-written API call can send anything) is treated as Off rather than
# refused, so a typo cannot fail a whole run.
ALLOWED_STEPS = (0, 8, 16, 32, 64)

ANCHORS = (
    "top-left", "top", "top-right",
    "left", "center", "right",
    "bottom-left", "bottom", "bottom-right",
)

RESAMPLES = ("auto", "lanczos", "bicubic", "bilinear", "nearest")

MIN_DIM = 8
MAX_DIM = 16384

# The face defaults. The lists are UI-only - see strip_ui_keys - and are kept
# here only so Python and the browser document the same starting point.
DEFAULT_SIZES = [864, 1024, 1216, 1536, 2048]
DEFAULT_RATIOS = ["keep", "1:1", "16:9", "9:16", "2:3"]

# How many tabs / chips a row may hold.
MAX_ROW_ITEMS = 5

DEFAULT_STATE = {
    "size": 1216,
    "ratio": "keep",
    "step": 0,
    "anchor": "center",
    "allow_upscale": True,
    "resample": "auto",
}

# Keys that exist only so the face can draw itself. They must NEVER reach the
# injected state: a cosmetic key that changes invalidates ComfyUI's cache and
# re-runs the node for no reason.
UI_ONLY_KEYS = ("sizes", "ratios")


# Every numeric conversion below catches THIS tuple, not just (TypeError,
# ValueError). `int(float("inf"))` raises OverflowError, which subclasses
# ArithmeticError and slips straight past a TypeError/ValueError handler - and
# Python's json.loads accepts the bare literals `Infinity`, `-Infinity` and
# `1e999` by default, so `{"size": Infinity}` reached int() and aborted the whole
# run. Reachable from any /prompt request. Reproduced before
# fixing; locked by the harness.
_NUM_ERRORS = (TypeError, ValueError, OverflowError)


def _round_div(a, b):
    """`a / b` rounded half UP, in integers only.

    Deliberately not `round(a / b)`: that brings float representation into a
    whole-pixel decision, and Python's round() is banker's rounding, so 2.5 and
    3.5 would go opposite ways from JavaScript's Math.round. This form is exact
    and the browser mirror is a character-for-character match.
    """
    b = int(b)
    if b == 0:
        return 0
    return (int(a) + b // 2) // b


def snap_to_multiple(value, multiple):
    """Round `value` to the NEAREST `multiple`, ties going up.

    Never returns 0: snapping a small side down to nothing would hand a
    zero-pixel image to whatever is downstream.
    """
    try:
        value = int(value)
        multiple = int(multiple)
    except _NUM_ERRORS:
        return value
    if multiple <= 1:
        return value
    return max(multiple, (value + multiple // 2) // multiple * multiple)


def parse_ratio(name):
    """'16:9' -> (16, 9). 'keep' (or anything unparseable) -> None, meaning
    'do not crop, use the image's own shape'."""
    if not name or not isinstance(name, str):
        return None
    text = name.strip().lower()
    if text in ("keep", "", "off", "none", "original"):
        return None
    for sep in (":", "x", "/"):
        if sep in text:
            a, _, b = text.partition(sep)
            try:
                rw, rh = int(float(a.strip())), int(float(b.strip()))
            except _NUM_ERRORS:
                return None
            if rw > 0 and rh > 0:
                return (rw, rh)
            return None
    return None


def crop_rect(w, h, ratio, anchor="center"):
    """The largest `ratio`-shaped rectangle that fits inside `w` x `h`, placed
    by `anchor`. Returns (x, y, cw, ch). `ratio` None means the whole image.

    Integer comparison rather than comparing two float aspects, so a source that
    is already exactly the wanted shape is never cropped by a rounding hair.
    """
    w, h = int(w), int(h)
    if w <= 0 or h <= 0:
        return (0, 0, max(0, w), max(0, h))
    if not ratio:
        return (0, 0, w, h)

    rw, rh = ratio
    if w * rh > h * rw:          # source is wider than wanted -> trim the width
        ch = h
        cw = _round_div(h * rw, rh)
    else:                        # source is taller -> trim the height
        cw = w
        ch = _round_div(w * rh, rw)

    cw = max(1, min(cw, w))
    ch = max(1, min(ch, h))
    x, y = _anchor_offset(anchor, w, cw, h, ch)
    return (x, y, cw, ch)


def _anchor_offset(anchor, outer_w, inner_w, outer_h, inner_h):
    """Top-left offset for an inner box inside an outer box, per a 9-position
    anchor name. Mirrors _anchor_offsets in _resize_helpers.py; kept here so
    this module stays importable with no dependencies at all."""
    a = (anchor or "center").lower()
    if "left" in a:
        x = 0
    elif "right" in a:
        x = outer_w - inner_w
    else:
        x = (outer_w - inner_w) // 2
    if "top" in a:
        y = 0
    elif "bottom" in a:
        y = outer_h - inner_h
    else:
        y = (outer_h - inner_h) // 2
    return max(0, x), max(0, y)


def target_size(cw, ch, longest, allow_upscale=True):
    """Scale a `cw` x `ch` rectangle so its LONGER side becomes `longest`.

    With `allow_upscale` off, a target bigger than the source is pulled back to
    the source's own longest side: the shape is still honoured, only the growing
    is refused. The crop has already happened by this point, so turning
    upscaling off never silently skips the crop as well.
    """
    cw, ch = int(cw), int(ch)
    if cw <= 0 or ch <= 0:
        return (MIN_DIM, MIN_DIM)

    try:
        longest = int(longest)
    except _NUM_ERRORS:
        longest = MIN_DIM
    if longest <= 0:
        longest = MIN_DIM

    src_longest = max(cw, ch)
    if not allow_upscale and longest > src_longest:
        longest = src_longest

    if cw >= ch:
        out_w = longest
        out_h = _round_div(longest * ch, cw)
    else:
        out_h = longest
        out_w = _round_div(longest * cw, ch)

    return (max(1, out_w), max(1, out_h))


def clamp_dims(w, h):
    """Final safety clamp. Floor at 8 so an extreme step can never produce a
    zero-pixel image; ceiling at 16384 so a silly target cannot OOM the box."""
    return (max(MIN_DIM, min(int(w), MAX_DIM)), max(MIN_DIM, min(int(h), MAX_DIM)))


def compute(in_w, in_h, state):
    """The whole calculation for one image.

    Returns a dict:
      crop  (x, y, w, h)  the rectangle to take from the input
      size  (w, h)        what to resize that rectangle to
      cropped  bool       whether the crop is smaller than the input

    This is THE function the node and the browser preview both go through, so
    there is one description of the behaviour rather than two that drift.
    """
    st = normalize_state(state)
    in_w, in_h = int(in_w or 0), int(in_h or 0)
    if in_w <= 0 or in_h <= 0:
        return {"crop": (0, 0, 0, 0), "size": (MIN_DIM, MIN_DIM), "cropped": False}

    ratio = parse_ratio(st["ratio"])
    x, y, cw, ch = crop_rect(in_w, in_h, ratio, st["anchor"])
    out_w, out_h = target_size(cw, ch, st["size"], st["allow_upscale"])

    step = st["step"]
    if step > 0:
        out_w = snap_to_multiple(out_w, step)
        out_h = snap_to_multiple(out_h, step)

    out_w, out_h = clamp_dims(out_w, out_h)
    return {
        "crop": (x, y, cw, ch),
        "size": (out_w, out_h),
        "cropped": (cw != in_w or ch != in_h),
    }


def normalize_state(raw):
    """Any dict -> a state with every key present and legal.

    Defensive on purpose: /prompt takes any value as sent, so every value here
    can be anything, and an unknown anchor or resample must degrade to the
    default rather than raise inside a running workflow.
    """
    data = raw if isinstance(raw, dict) else {}
    st = dict(DEFAULT_STATE)

    try:
        size = int(data.get("size", st["size"]))
    except _NUM_ERRORS:
        size = st["size"]
    st["size"] = max(MIN_DIM, min(size, MAX_DIM))

    ratio = data.get("ratio", st["ratio"])
    st["ratio"] = ratio if isinstance(ratio, str) and ratio.strip() else "keep"

    try:
        step = int(data.get("step", 0))
    except _NUM_ERRORS:
        step = 0
    st["step"] = step if step in ALLOWED_STEPS else 0

    anchor = data.get("anchor", st["anchor"])
    st["anchor"] = anchor if anchor in ANCHORS else "center"

    st["allow_upscale"] = bool(data.get("allow_upscale", True))

    resample = data.get("resample", st["resample"])
    st["resample"] = resample if resample in RESAMPLES else "auto"

    return st


def parse_state(raw):
    """The hidden LongestSideState (a JSON string, a dict, or nothing) -> a
    normalized state. Never raises."""
    if isinstance(raw, dict):
        return normalize_state(raw)
    if isinstance(raw, str) and raw.strip().startswith("{"):
        try:
            loaded = json.loads(raw)
        except (ValueError, TypeError, RecursionError):
            loaded = None
        if isinstance(loaded, dict):
            return normalize_state(loaded)
    return dict(DEFAULT_STATE)


def strip_ui_keys(state):
    """What actually goes into the hidden input: the execution keys only.

    The size-tab and shape-chip LISTS live in the same state blob so the face
    can draw itself, but they change nothing about the run. Sending them would
    make editing the list (or reordering it) change the injected string, which
    invalidates ComfyUI's cache and re-runs the node for no reason.
    """
    return {k: v for k, v in (state or {}).items() if k not in UI_ONLY_KEYS}
