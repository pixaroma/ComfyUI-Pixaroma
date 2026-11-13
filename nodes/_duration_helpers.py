"""Duration Pixaroma - turning a length in seconds into a frame count.

Pure module: no torch, no ComfyUI, no I/O, so the maths can be tested on its own
and mirrored in the browser (js/duration/compute.mjs) with a parity check.

Every video model wants the same three things and disagrees only on the numbers:

    frames = round(seconds * fps)          how many frames that long is
    frames = max(frames, min_frames)       never below the model's floor
    frames = snap up to  step*n + plus     the shape the sampler demands

MiniMax H3 is step 17 plus 5 at 24 fps, which is where 5 s -> 124 frames comes
from. Wan is 4n+1 at 16 fps, LTX is 8n+1, Hunyuan is 4n+1. `step = 1` disables
snapping entirely, so "just frames = seconds x fps" needs no special mode.

A `custom` formula is the escape hatch for a model none of that fits. It is
evaluated with simpleeval - the SAME library and the same function allow-list
ComfyUI core uses for its own Math Expression node (comfy_extras/nodes_math.py).
Never use dynamic evaluation: /prompt takes any text as sent, so this string can be anything
(see .claude/patterns/path-containment.md #0).
"""

import json
import math

# Guard rails for the custom-formula path. Core caps the exponent for the same
# reason (a huge ** is a cheap way to hang the worker); the length cap keeps a
# pathological expression from reaching the parser at all.
MAX_EXPONENT = 4000
MAX_FORMULA_LEN = 500

# What the numbers may be. Wide enough for any real model, tight enough that a
# hand-edited API call cannot ask for a billion-frame allocation downstream.
MAX_FPS = 1000.0
MAX_STEP = 100000
MAX_FRAMES = 1000000
MAX_SECONDS = 100000.0

DEFAULTS = {
    "seconds": 5.0,
    "fps": 24.0,
    "step": 17,
    "plus": 5,
    "minFrames": 5,
    "mode": "recipe",      # "recipe" (fps/step/plus) or "custom" (formula)
    "formula": "",
}


def _safe_pow(base, exp):
    if abs(exp) > MAX_EXPONENT:
        raise ValueError("exponent too large")
    return pow(base, exp)


# Mirrors core's MATH_FUNCTIONS so a formula that works in Math Expression works
# here unchanged - the whole point of the escape hatch is that you can paste the
# expression you already had.
FORMULA_FUNCTIONS = {
    "min": min, "max": max, "abs": abs, "round": round, "pow": _safe_pow,
    "sqrt": math.sqrt, "ceil": math.ceil, "floor": math.floor,
    "log": math.log, "log2": math.log2, "log10": math.log10,
    "sin": math.sin, "cos": math.cos, "tan": math.tan,
    "int": int, "float": float,
}


def _num(value, fallback, lo, hi):
    """One JSON field -> a finite number inside [lo, hi], or the fallback."""
    try:
        # OverflowError matters: a 400-digit integer in hand-written JSON parses
        # as an arbitrary-precision int and float() then raises rather than
        # returning inf.
        out = float(value)
    except (TypeError, ValueError, OverflowError):
        return fallback
    if not math.isfinite(out):
        return fallback
    return max(lo, min(hi, out))


def snap_frames(raw, step, plus):
    """Round `raw` UP to the next value of the form step*n + plus.

    `step <= 1` means the model has no shape requirement, so nothing moves.
    Snapping UP (never down) is deliberate: a clip that is a few frames long
    is always safer than one the sampler refuses, and it matches the expression
    people already use for H3.
    """
    step = int(step)
    plus = int(plus)
    raw = int(raw)
    if step <= 1:
        return raw
    # Python's % is already non-negative for a negative left operand. The JS
    # mirror is NOT - it needs ((x % n) + n) % n - which is exactly the kind of
    # difference the parity test exists to catch.
    remainder = (raw - plus) % step
    if remainder:
        raw += step - remainder
    return raw


def frames_from_seconds(seconds, fps, step, plus, min_frames):
    """The recipe path: seconds -> a frame count the model will accept."""
    seconds = _num(seconds, DEFAULTS["seconds"], -MAX_SECONDS, MAX_SECONDS)
    fps = _num(fps, DEFAULTS["fps"], 0.0, MAX_FPS)
    step = int(_num(step, DEFAULTS["step"], 0, MAX_STEP))
    plus = int(_num(plus, DEFAULTS["plus"], 0, MAX_STEP))
    min_frames = int(_num(min_frames, DEFAULTS["minFrames"], 0, MAX_FRAMES))

    raw = int(round(seconds * fps))
    if raw < min_frames:
        raw = min_frames
    raw = snap_frames(raw, step, plus)
    # The floor is applied again: snapping only ever moves UP, but a min_frames
    # that is not itself on the step*n+plus grid would otherwise be reported as
    # the floor when the snapped value is the truth.
    return max(0, min(MAX_FRAMES, raw))


def frames_from_formula(formula, seconds, fps):
    """The custom path. Returns None when the formula cannot be evaluated.

    `a` is the seconds value, matching the variable name ComfyUI's Math
    Expression gives its first input, so an expression can be pasted across.
    `seconds` and `fps` are available under their own names too.
    """
    if not isinstance(formula, str):
        return None
    text = formula.strip()
    if not text or len(text) > MAX_FORMULA_LEN:
        return None
    try:
        from simpleeval import simple_eval
    except ImportError:
        # Core depends on simpleeval, so this should not happen - but a missing
        # optional import must degrade to "no custom formula", never take the
        # whole run down.
        return None
    names = {"a": float(seconds), "seconds": float(seconds), "fps": float(fps)}
    try:
        result = simple_eval(text, names=names, functions=FORMULA_FUNCTIONS)
    except Exception:
        # simpleeval raises a wide family (syntax, name, type, its own guards).
        # Any of them means "this formula does not work", which the caller shows
        # on the node rather than failing the workflow.
        return None
    if isinstance(result, bool) or not isinstance(result, (int, float)):
        return None
    try:
        value = float(result)
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(value):
        return None
    return max(0, min(MAX_FRAMES, int(round(value))))


def parse_state(raw):
    """The hidden DurationState string -> a dict with every key present."""
    state = {}
    if isinstance(raw, dict):
        state = raw
    elif isinstance(raw, str) and raw.strip():
        try:
            loaded = json.loads(raw)
        except (ValueError, TypeError, RecursionError):
            loaded = None
        if isinstance(loaded, dict):
            state = loaded
    out = dict(DEFAULTS)
    for key in DEFAULTS:
        if key in state and state[key] is not None:
            out[key] = state[key]
    return out


def compute(raw_state):
    """The node's whole job: state -> (frames, seconds_actual).

    `seconds_actual` is frames / fps, NOT the number the user picked. Snapping
    changes the real length (5.0 s at 24 fps becomes 124 frames = 5.17 s) and
    anything timed against the video - audio, captions - needs the true figure
    or it drifts. The node face shows both so the difference is never hidden.
    """
    state = parse_state(raw_state)
    seconds = _num(state["seconds"], DEFAULTS["seconds"], -MAX_SECONDS, MAX_SECONDS)
    fps = _num(state["fps"], DEFAULTS["fps"], 0.0, MAX_FPS)

    frames = None
    if str(state.get("mode") or "recipe").lower() == "custom":
        frames = frames_from_formula(state.get("formula"), seconds, fps)
    if frames is None:
        # Either the recipe path, or a custom formula that does not evaluate.
        # Falling back to the recipe keeps a typo from failing the whole run.
        frames = frames_from_seconds(
            seconds, fps, state["step"], state["plus"], state["minFrames"]
        )

    actual = (frames / fps) if fps > 0 else 0.0
    return int(frames), float(actual)
