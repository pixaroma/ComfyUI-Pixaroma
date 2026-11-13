"""Save 3D Pixaroma - pure helpers: the state blob, the format choice, the check line.

No torch and no ComfyUI imports, so D:\\Claude Tests\\_save3d_test.py checks them directly.
"""
import json
import re

FORMATS = ("auto", "obj", "glb", "stl")
MODES = ("preview", "save")
UPS = ("auto", "y", "z")
# The print sizes an STL can be written at ("model" keeps the model's own units).
STL_SIZES = ("model", 50, 100, 150, 200, 300)
MAX_TURNS = 64
NAME_MAX = 200
FOLDER_MAX = 1024
DEFAULT_NAME = "3d/pixaroma"

DEFAULT_STATE = {
    "mode": "preview", "turns": [], "center": True, "ground": True, "format": "auto",
    "name": DEFAULT_NAME, "up": "auto", "stlSize": 100, "folder": "", "wf": "",
}
# The workflow key the browser adds at Run (a hash of the workflow's path), so two workflows that
# use the same node id keep their own preview file. It becomes part of a file name, so nothing but
# this exact shape is accepted.
_WF_KEY = re.compile(r"[0-9a-f]{8}")

_BAD_CHARS = re.compile(r'[<>:"|?*\x00-\x1f]')
# Save Image's %date:yyyy-MM-dd% token. It holds a colon (and may hold a slash),
# so it is set aside before the name is cleaned and put back after.
_DATE_TOKEN = re.compile(r"%date:[^%]*%")
_KEPT = re.compile("\ue000(\\d+)\ue001")


def clean_name(raw):
    """A subfolder/prefix typed on the node -> a relative name with no way out.

    /prompt takes any value as sent, so anything can arrive here. Core's
    get_save_image_path refuses a folder outside output/ on its own, and the node
    runs the name through Save Image's _safe_prefix as well; this keeps the stored
    name tidy before it gets there: no drive letter, no leading slash, no '..'
    step and none of the characters Windows refuses in a file name. Date tokens
    are kept as they are, for the node to fill in at save time.
    """
    if not isinstance(raw, str):
        return DEFAULT_NAME
    tokens = []

    def keep(match):
        tokens.append(match.group(0))
        return "\ue000{}\ue001".format(len(tokens) - 1)

    text = _DATE_TOKEN.sub(keep, raw[:NAME_MAX].replace("\\", "/").strip())
    text = re.sub(r"^[A-Za-z]:", "", text)
    parts = []
    for part in text.split("/"):
        part = _BAD_CHARS.sub("", part).strip()
        if part in ("", ".", ".."):
            continue
        parts.append(part)

    def put_back(match):
        i = int(match.group(1))
        return tokens[i] if i < len(tokens) else ""

    return _KEPT.sub(put_back, "/".join(parts)) or DEFAULT_NAME


def _as_bool(value, default):
    return value if isinstance(value, bool) else default


def parse_state(raw):
    """The hidden Save3DState -> a clean dict. Never raises; every key falls back
    to its own default, so one bad value never throws the others away."""
    data = raw
    if isinstance(data, (bytes, bytearray)):
        data = bytes(data).decode("utf-8", "replace")
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception:
            data = None
    if not isinstance(data, dict):
        data = {}

    state = dict(DEFAULT_STATE)
    state["turns"] = []
    mode = str(data.get("mode", "")).lower()
    if mode in MODES:
        state["mode"] = mode
    turns = data.get("turns")
    if isinstance(turns, list):
        state["turns"] = [t.lower() for t in turns
                          if isinstance(t, str) and t.lower() in ("x", "y", "z")][:MAX_TURNS]
    state["center"] = _as_bool(data.get("center"), True)
    state["ground"] = _as_bool(data.get("ground"), True)
    fmt = str(data.get("format", "")).lower()
    if fmt in FORMATS:
        state["format"] = fmt
    up = str(data.get("up", "")).lower()
    if up in UPS:
        state["up"] = up
    size = data.get("stlSize")
    if not isinstance(size, bool) and size in STL_SIZES:
        state["stlSize"] = size
    if "name" in data:
        state["name"] = clean_name(data.get("name"))
    folder = data.get("folder")
    if isinstance(folder, str):
        # Kept as typed (quotes, ~ and variables included): node_save_3d screens,
        # resolves and approves it with Save Image's rules before any use.
        state["folder"] = folder.strip()[:FOLDER_MAX]
    wf = data.get("wf")
    if isinstance(wf, str) and _WF_KEY.fullmatch(wf):
        state["wf"] = wf
    return state


def pick_format(state_format, mesh):
    """Auto keeps polygons as OBJ, because GLB and STL hold triangles only, and
    writes a triangle model as GLB, which keeps its colours and textures."""
    if state_format in ("obj", "glb", "stl"):
        return state_format
    counts = getattr(mesh, "counts", None)
    if counts is not None and len(counts):
        biggest = int(counts.max()) if hasattr(counts, "max") else max(counts)
        if biggest > 3:
            return "obj"
    return "glb"


def check_line(flags):
    """The line under the Fix row. It says only what can be measured: whether the
    model floats, sinks or sits off center. What its front should be, nobody can
    measure, which is what the FRONT arrow on the node is for."""
    parts = []
    if flags.get("floating"):
        parts.append("Floating above the ground")
    if flags.get("sunk"):
        parts.append("Sunk into the ground")
    if flags.get("off_center"):
        parts.append("Off center")
    if not parts:
        return {"level": "good", "text": "On the ground · centered"}
    return {"level": "warn", "text": " · ".join(parts)}
