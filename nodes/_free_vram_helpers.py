"""Free VRAM Pixaroma - pure helpers.

No torch, no ComfyUI imports and no I/O, so every decision this node makes can
be tested on a machine with no GPU (harness: D:\\Claude Tests\\_free_vram_test.py).

The node itself only reads memory numbers and calls comfy.model_management;
what to free, whether to free at all, and what the face should say are all
decided here.
"""

import json

GB = 1024 ** 3

# What the chips on the node face pick between.
MODE_ALL = "all"        # unload the models AND hand the cache back
MODE_MODELS = "models"  # unload the models, keep torch's cache reserved
MODE_CACHE = "cache"    # keep the models, hand torch's spare blocks back
MODES = (MODE_ALL, MODE_MODELS, MODE_CACHE)

DEFAULT_STATE = {
    "mode": MODE_ALL,
    "gc": True,            # collect Python garbage before measuring again
    "everyRun": True,      # drives IS_CHANGED - see should_always_run()
    "useThreshold": False,
    "thresholdGb": 8.0,    # only free when LESS than this much is already free
}

# The threshold slider's range. Kept here so the browser mirror and the Python
# clamp cannot drift apart.
THRESHOLD_MIN_GB = 0.5
THRESHOLD_MAX_GB = 128.0


def _as_bool(value, fallback):
    if isinstance(value, bool):
        return value
    if value is None:
        return fallback
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        low = value.strip().lower()
        if low in ("true", "1", "yes", "on"):
            return True
        if low in ("false", "0", "no", "off"):
            return False
    return fallback


def _as_float(value, fallback, lo, hi):
    try:
        out = float(value)
    except (TypeError, ValueError):
        return fallback
    if out != out or out in (float("inf"), float("-inf")):  # NaN / inf
        return fallback
    return max(lo, min(hi, out))


def parse_state(raw):
    """Turn whatever arrived in the hidden input into a clean settings dict.

    /prompt takes any value as sent, so this may be any JSON value, a broken string,
    or missing entirely. Every bad shape falls back to the defaults rather than
    raising - a malformed blob must not be able to fail somebody's run.
    """
    data = raw
    if isinstance(data, (bytes, bytearray)):
        try:
            data = data.decode("utf-8", "replace")
        except Exception:
            data = ""
    if isinstance(data, str):
        try:
            data = json.loads(data) if data.strip() else {}
        except (ValueError, TypeError):
            data = {}
    if not isinstance(data, dict):
        data = {}

    st = dict(DEFAULT_STATE)
    mode = data.get("mode", st["mode"])
    st["mode"] = mode if mode in MODES else MODE_ALL
    st["gc"] = _as_bool(data.get("gc"), DEFAULT_STATE["gc"])
    st["everyRun"] = _as_bool(data.get("everyRun"), DEFAULT_STATE["everyRun"])
    st["useThreshold"] = _as_bool(data.get("useThreshold"), DEFAULT_STATE["useThreshold"])
    st["thresholdGb"] = _as_float(
        data.get("thresholdGb"), DEFAULT_STATE["thresholdGb"],
        THRESHOLD_MIN_GB, THRESHOLD_MAX_GB,
    )
    return st


def plan(state):
    """Which of the three cleanup steps this mode runs.

    `gc` rides along with either real action: collecting Python garbage on its
    own is free but pointless, and it is what lets an unloaded model's tensors
    actually be released before the cache is handed back.
    """
    mode = state.get("mode", MODE_ALL)
    return {
        "models": mode in (MODE_ALL, MODE_MODELS),
        "cache": mode in (MODE_ALL, MODE_CACHE),
        "gc": bool(state.get("gc", True)),
    }


def threshold_bytes(state):
    """The free-memory line under which this node acts, or None if always."""
    if not state.get("useThreshold"):
        return None
    return int(_as_float(state.get("thresholdGb"), DEFAULT_STATE["thresholdGb"],
                         THRESHOLD_MIN_GB, THRESHOLD_MAX_GB) * GB)


def should_free(state, free_before):
    """(do_it, reason). `reason` is empty when it goes ahead."""
    limit = threshold_bytes(state)
    if limit is None:
        return True, ""
    try:
        already = float(free_before)
    except (TypeError, ValueError):
        return True, ""
    if already >= limit:
        return False, "enough free already"
    return True, ""


def should_always_run(state):
    """Whether IS_CHANGED must report 'changed' on every single run.

    True is the default and it is the honest one for a node whose whole job is a
    side effect: ComfyUI would otherwise cache the node away in exactly the case
    the node exists for (you changed only the SECOND stage, so the first is
    cached, so nothing frees the model the first stage left resident).

    The cost, and the reason this is a switch rather than a hard-coded NaN: a
    node's cache key includes every ancestor's key (comfy_execution/caching.py
    get_node_signature), so a node that never matches its previous key forces
    everything DOWNSTREAM of it to re-run too.
    """
    return bool(state.get("everyRun", True))


def format_bytes(value, places=1):
    """Human bytes. Always GB above a gigabyte, because that is the unit people
    have in their heads for VRAM and a jump between MB and GB across runs makes
    two readings hard to compare."""
    try:
        num = float(value)
    except (TypeError, ValueError):
        return "-"
    if num != num:
        return "-"
    sign = "-" if num < 0 else ""
    num = abs(num)
    if num >= GB:
        return "%s%.*f GB" % (sign, places, num / GB)
    if num >= 1024 * 1024:
        return "%s%.0f MB" % (sign, num / (1024 * 1024))
    if num >= 1024:
        return "%s%.0f KB" % (sign, num / 1024)
    return "%s%d B" % (sign, int(num))


def uses_driver_view(state):
    """Whether this mode's meaningful 'free' number is the DRIVER's, not ComfyUI's.

    THE single decision behind the whole readout, and every consumer must ask
    it - the threshold gate, the headline and the bar alike. Getting it right in
    one place and wrong in the others is exactly how the face ended up able to
    claim "returned 6 GB" above a bar with no orange in it at all.

    * Unloading models raises what ComfyUI can see as free, so ComfyUI's own
      number is the meaningful one there.
    * Emptying the cache does NOT move it: get_free_memory already counts
      torch's spare reserved blocks as free. What actually changes is how much
      the DRIVER has back - the number nvidia-smi shows, and the one that
      matters when something outside ComfyUI wants the card, which is the whole
      reason Cache mode exists.
    """
    return not plan(state)["models"]


def reading_pair(state, before, after, driver_before, driver_after):
    """The (before, after) pair that means something for this mode."""
    if uses_driver_view(state):
        return driver_before, driver_after
    return before, after


def headline_label(state):
    return "returned" if uses_driver_view(state) else "freed"


def headline_freed(state, before, after, driver_before, driver_after):
    """(bytes, label) - the one number the node face leads with.

    Picked from the MODE, never from which delta happens to be bigger: a guess
    like that misreads a run where there was simply nothing to free.
    """
    lo, hi = reading_pair(state, before, after, driver_before, driver_after)
    return _delta(lo, hi), headline_label(state)


def _delta(before, after):
    try:
        out = float(after) - float(before)
    except (TypeError, ValueError):
        return 0
    if out != out:
        return 0
    return int(max(0, out))


def bar_segments(total, before, after):
    """The three widths of the face's bar, as fractions of the card, in order:
    still in use, just released, already free before we ran.

    They sum to 1 by construction so the bar can never render a gap or overrun,
    even if a reading arrives inconsistent (two samples taken a moment apart
    while another process is also allocating).
    """
    try:
        cap = float(total)
        was_free = max(0.0, float(before))
        now_free = max(0.0, float(after))
    except (TypeError, ValueError):
        return (0.0, 0.0, 0.0)
    if not cap or cap <= 0 or cap != cap:
        return (0.0, 0.0, 0.0)
    now_free = min(now_free, cap)
    was_free = min(was_free, now_free)
    used = max(0.0, cap - now_free)
    just = max(0.0, now_free - was_free)
    return (used / cap, just / cap, was_free / cap)
