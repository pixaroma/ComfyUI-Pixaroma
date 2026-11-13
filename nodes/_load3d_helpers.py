"""Load 3D Pixaroma - pure helpers, no torch and no ComfyUI imports.

Kept apart from the node so the harnesses can drive them with plain Python
(D:\\Claude Tests\\_load3d_test.py, and _load3d_size_test.py for the width and
height inputs and outputs).
"""
from __future__ import annotations

import json
import math
import numbers
import os
import re

MODEL_EXTS = (".glb", ".gltf", ".obj", ".fbx", ".stl", ".ply")
CAPTURE_SUBFOLDER = "pixaroma_load3d"
NONE = "none"
MIN_SIDE = 64
MAX_SIDE = 4096

# The width and height outputs, by their place in RETURN_TYPES:
# model_3d 0, image 1, mask 2, width 3, height 4.
SIZE_OUTPUTS = (3, 4)

# A deep or enormous 3d folder must not hang the model list.
MAX_DEPTH = 8
MAX_FILES = 5000

# A picture reference is EXACTLY what the browser's own upload produces and
# nothing else. /prompt takes any text as sent, so a strict pattern refuses
# anything unexpected before a path is even built.
_CAPTURE_RE = re.compile(r"^pixaroma_load3d/[A-Za-z0-9_-]{8,80}\.png \[temp\]$")

_ANNOTATIONS = (" [input]", " [output]", " [temp]")


def strip_annotation(name):
    """("3d/a.glb", "output") for "3d/a.glb [output]"; the folder defaults to input."""
    if not isinstance(name, str):
        return "", "input"
    for tag in _ANNOTATIONS:
        if name.endswith(tag):
            return name[: -len(tag)], tag[2:-1]
    return name, "input"


def is_model_name(name):
    bare, _kind = strip_annotation(name)
    return os.path.splitext(bare)[1].lower() in MODEL_EXTS


def list_models(root_dir, suffix=""):
    """Model files under <root_dir>/3d, named relative to root_dir.

    Forward slashes plus the annotation `suffix` (" [output]" for the output
    folder), which is exactly the shape folder_paths.get_annotated_filepath
    reads. followlinks stays False so a link inside the folder cannot turn the
    list into a walk of some other drive.
    """
    out = []
    if not root_dir:
        return out
    base = os.path.join(root_dir, "3d")
    if not os.path.isdir(base):
        return out
    base_depth = os.path.normpath(base).count(os.sep)
    for cur, dirs, files in os.walk(base, followlinks=False):
        if os.path.normpath(cur).count(os.sep) - base_depth >= MAX_DEPTH:
            dirs[:] = []
        dirs.sort(key=str.lower)
        for name in sorted(files, key=str.lower):
            if os.path.splitext(name)[1].lower() not in MODEL_EXTS:
                continue
            rel = os.path.relpath(os.path.join(cur, name), root_dir).replace(os.sep, "/")
            out.append(rel + suffix)
            if len(out) >= MAX_FILES:
                return out
    return out


def _finite(value):
    """A real, finite number. JSON numbers arrive as int or float; a bool is not one."""
    return (isinstance(value, numbers.Real) and not isinstance(value, bool)
            and math.isfinite(float(value)))


def _side(value, default):
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError, OverflowError):
        return default
    return max(MIN_SIDE, min(MAX_SIDE, n))


def parse_state(raw):
    """The injected state, reduced to what Python may use, every field checked.

    `sized` says whether the browser sent the width and height at all. It sends
    them only when something reads the width or height outputs, so a run that
    does not use them never carries them into the cache key.
    """
    st = {}
    if isinstance(raw, str) and raw:
        try:
            st = json.loads(raw)
        except (ValueError, TypeError):
            st = {}
    if not isinstance(st, dict):
        st = {}
    out = {
        "w": _side(st.get("w"), 1024),
        "h": _side(st.get("h"), 1024),
        "sized": _finite(st.get("w")) and _finite(st.get("h")),
    }
    for key in ("image", "mask"):
        value = st.get(key)
        out[key] = value if isinstance(value, str) and _CAPTURE_RE.match(value) else ""
    return out


def outputs_consumed(prompt, unique_id, indexes):
    """True when any node in the API prompt reads one of this node's `indexes` outputs.

    Used so a run that only wants model_3d (a script, the API) does not fail for
    lack of a picture it never needed. When it cannot tell, it says yes, which
    keeps the strict behaviour.
    """
    if not isinstance(prompt, dict) or unique_id is None:
        return True
    uid = str(unique_id)
    for entry in prompt.values():
        inputs = entry.get("inputs") if isinstance(entry, dict) else None
        if not isinstance(inputs, dict):
            continue
        for value in inputs.values():
            if (isinstance(value, (list, tuple)) and len(value) == 2
                    and str(value[0]) == uid and value[1] in indexes):
                return True
    return False


def _short(value):
    text = repr(value)
    return text if len(text) <= 40 else text[:37] + "..."


def wired_side(value, name):
    """A width or height wired into the node -> whole pixels, or None when nothing is wired.

    An optional input is not type-guaranteed (a pass-through node can deliver a
    string or a tensor), so anything but a plain finite number is refused with a
    message instead of being guessed at.
    """
    if value is None:
        return None
    if not _finite(value):
        raise ValueError(
            "[Pixaroma] Load 3D: the {} wired in is not a number ({}). Wire in a whole "
            "number of pixels, for example from Sizes Pixaroma.".format(name, _short(value))
        )
    return int(value)


def output_size(wired, state):
    """The width and height outputs when no picture was drawn.

    A wired side wins, then the size the browser sent; None for a side that
    nobody knows (a run started without the browser, with nothing wired in).
    """
    wired_w, wired_h = wired
    sent = bool(state.get("sized"))
    w = wired_w if wired_w is not None else (state.get("w") if sent else None)
    h = wired_h if wired_h is not None else (state.get("h") if sent else None)
    return w, h


def unknown_size_read(size, prompt, unique_id):
    """True when a width or height output that nobody knows is read downstream.

    Per side: a width wired in still comes out when the height is unknown and
    nothing reads it (measured: the first version refused the whole node).
    """
    w, h = size
    return bool((w is None and outputs_consumed(prompt, unique_id, (SIZE_OUTPUTS[0],)))
                or (h is None and outputs_consumed(prompt, unique_id, (SIZE_OUTPUTS[1],))))


def size_mismatch_message(picture, wired):
    """None when the picture agrees with every wired side, else what to tell the user.

    The browser draws the picture at the wired size whenever it can read it, so a
    disagreement means a size it could not know before Run, or one outside the
    sizes a picture can be drawn at.
    """
    pic_w, pic_h = picture
    wired_w, wired_h = wired
    if (wired_w is None or wired_w == pic_w) and (wired_h is None or wired_h == pic_h):
        return None
    want_w = pic_w if wired_w is None else wired_w
    want_h = pic_h if wired_h is None else wired_h
    message = "[Pixaroma] Load 3D: the picture came out {} x {}, but the size wired in asks for {} x {}. ".format(
        pic_w, pic_h, want_w, want_h)
    if any(v is not None and not MIN_SIDE <= v <= MAX_SIDE for v in (wired_w, wired_h)):
        return message + "Load 3D draws pictures from {} to {} pixels on each side, so pick a size inside that range.".format(
            MIN_SIDE, MAX_SIDE)
    return message + (
        "The node reads the size from Sizes Pixaroma before Run, and a size that is only worked out "
        "while the workflow runs cannot reach the picture in time. Wire the size from Sizes Pixaroma, "
        "or unplug the wire and type the size on the node."
    )
