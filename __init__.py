import os
from . import server_routes  # noqa: E402  (side-effect import for route registration)
from .nodes import NODE_CLASS_MAPPINGS as _MAPS_COMPOSITION
from .nodes import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_COMPOSITION
from .nodes_3d import NODE_CLASS_MAPPINGS as _MAPS_3D
from .nodes_3d import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_3D
from .nodes_compare import NODE_CLASS_MAPPINGS as _MAPS_COMPARE
from .nodes_compare import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_COMPARE
from .nodes_crop import NODE_CLASS_MAPPINGS as _MAPS_CROP
from .nodes_crop import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_CROP
from .nodes_label import NODE_CLASS_MAPPINGS as _MAPS_LABEL
from .nodes_label import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_LABEL

dev_mode = True
if dev_mode:
    from .nodes_utils import NODE_CLASS_MAPPINGS as _MAPS_UTILS
    from .nodes_utils import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_UTILS
else:
    _MAPS_UTILS = {}
    _NAMES_UTILS = {}

# Naming convention: all class keys must use the "Pixaroma" prefix
# (e.g. "PixaromaEffectBlur") to avoid collisions with other packs.
NODE_CLASS_MAPPINGS = {
    **_MAPS_COMPOSITION,
    **_MAPS_3D,
    **_MAPS_COMPARE,
    **_MAPS_CROP,
    **_MAPS_LABEL,
    **_MAPS_UTILS,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    **_NAMES_COMPOSITION,
    **_NAMES_3D,
    **_NAMES_COMPARE,
    **_NAMES_CROP,
    **_NAMES_LABEL,
    **_NAMES_UTILS,
}


WEB_DIRECTORY = "./web"


# ─── Startup banner ──────────────────────────────────────────
VERSION = "1.0.0"
_O = "\033[38;2;246;103;68m"  # #f66744
_W = "\033[1;37m"
_G = "\033[0;37m"
_R = "\033[0m"

_sorted_nodes = sorted(NODE_DISPLAY_NAME_MAPPINGS.values())
_MAX_LINE = 110  # visible chars per line (inside the 120-char bar)
_node_lines = []
_cur = ""
for _n in _sorted_nodes:
    _entry = f"{_n}, " if _n != _sorted_nodes[-1] else _n
    if _cur and len(_cur) + len(_entry) > _MAX_LINE:
        _node_lines.append(_cur.rstrip(", "))
        _cur = ""
    _cur += _entry
if _cur:
    _node_lines.append(_cur.rstrip(", "))

_bar = f"{_O}{'━' * 120}{_R}"
print(_bar)
print(
    f"  {_W}Pixaroma{_R} v{VERSION}  |  {_O}{len(NODE_DISPLAY_NAME_MAPPINGS)} nodes{_R} Loaded"
)
for _ln in _node_lines:
    print(f"  {_G}{_ln}{_R}")
print(f"  {_G}ComfyUI Tutorials: https://www.youtube.com/@pixaroma{_R}")
print(
    f"  {_O}⚠  Pixaroma Nodes does not support Nodes 2.0 — Turn it Off from ComfyUI Menu.{_R}"
)
print(_bar)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
