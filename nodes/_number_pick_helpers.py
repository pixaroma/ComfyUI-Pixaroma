"""Number Pick Pixaroma - the pure half.

No ComfyUI imports, so it can be tested on its own
(harness: D:\\Claude Tests\\_number_pick_test.py).

The node holds one number, picked from buttons the user defines, and sends it
out with whatever type the input it is wired to expects. The browser decides
the TYPE by looking at that input (js/number_pick/adopt.mjs) and sends it here
as `out`; this file only has to honour it.
"""

import json

# The two kinds a number can be sent as, plus "auto" for a node that is not
# wired yet (or is wired to a pass-through, which dictates no type).
OUT_AUTO = "auto"
OUT_INT = "int"
OUT_FLOAT = "float"
OUT_KINDS = (OUT_AUTO, OUT_INT, OUT_FLOAT)

# Big enough for any sane graph value, small enough that nothing downstream has
# to worry about a number arriving from a widget. Mirrored in core.mjs.
LIMIT = 1e12

DEFAULT_VALUE = 4
# A fresh node has no subject of its own (Duration has seconds; this has
# nothing), so it starts on the doubling run every ComfyUI user already reaches
# for: batch sizes, steps, and most "how many" inputs live here.
DEFAULT_VALUES = [1, 2, 4, 8, 16, 32]


def _clamp(raw, fallback):
    """A number from a JSON blob (any shape) -> a finite float, or the fallback."""
    try:
        out = float(raw)
    except (TypeError, ValueError):
        return fallback
    # NaN fails every comparison, so test it rather than relying on the clamp.
    if out != out or out in (float("inf"), float("-inf")):
        return fallback
    return max(-LIMIT, min(LIMIT, out))


def parse_state(raw):
    """The hidden state blob -> {value, out}. Never raises, always usable."""
    data = {}
    if isinstance(raw, dict):
        data = raw
    elif isinstance(raw, (str, bytes)):
        try:
            loaded = json.loads(raw or "{}")
            if isinstance(loaded, dict):
                data = loaded
        except (ValueError, TypeError):
            data = {}

    value = _clamp(data.get("value"), float(DEFAULT_VALUE))
    kind = str(data.get("out", OUT_AUTO)).strip().lower()
    if kind not in OUT_KINDS:
        kind = OUT_AUTO
    return {"value": value, "out": kind}


def coerce(value, kind):
    """The number + the kind the wire wants -> the Python value to emit.

    `auto` is what an UNWIRED node sends, and it is decided by the number
    itself: 4 goes out as a whole number, 4.5 as a decimal. That is the least
    surprising answer for a node nobody has told what to be yet, and it means a
    plain integer never arrives somewhere as `4.0`.
    """
    if kind == OUT_INT:
        # Round rather than truncate: a chip of 7.6 wired into a whole-number
        # input should give 8, not 7. int() alone would quietly floor it.
        return int(round(value))
    if kind == OUT_FLOAT:
        return float(value)
    return int(round(value)) if float(value).is_integer() else float(value)


def compute(raw):
    """The whole node: state blob -> the one value it sends."""
    st = parse_state(raw)
    return coerce(st["value"], st["out"])
