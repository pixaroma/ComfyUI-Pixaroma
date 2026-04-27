import os
from . import server_routes  # side-effect import for route registration
from .nodes.node_composition import NODE_CLASS_MAPPINGS as _MAPS_COMPOSITION
from .nodes.node_composition import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_COMPOSITION
from .nodes.node_3d import NODE_CLASS_MAPPINGS as _MAPS_3D
from .nodes.node_3d import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_3D
from .nodes.node_audio_studio import NODE_CLASS_MAPPINGS as _MAPS_AUDIO_STUDIO
from .nodes.node_audio_studio import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_AUDIO_STUDIO
from .nodes.node_save_mp4 import NODE_CLASS_MAPPINGS as _MAPS_SAVE_MP4
from .nodes.node_save_mp4 import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_SAVE_MP4
from .nodes.node_compare import NODE_CLASS_MAPPINGS as _MAPS_COMPARE
from .nodes.node_compare import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_COMPARE
from .nodes.node_crop import NODE_CLASS_MAPPINGS as _MAPS_CROP
from .nodes.node_crop import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_CROP
from .nodes.node_label import NODE_CLASS_MAPPINGS as _MAPS_LABEL
from .nodes.node_label import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_LABEL
from .nodes.node_paint import NODE_CLASS_MAPPINGS as _MAPS_PAINT
from .nodes.node_paint import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_PAINT
from .nodes.node_preview import NODE_CLASS_MAPPINGS as _MAPS_PREVIEW
from .nodes.node_preview import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_PREVIEW
from .nodes.node_resolution import NODE_CLASS_MAPPINGS as _MAPS_RESOLUTION
from .nodes.node_resolution import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_RESOLUTION
from .nodes.node_show_text import NODE_CLASS_MAPPINGS as _MAPS_SHOW_TEXT
from .nodes.node_show_text import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_SHOW_TEXT
from .nodes.node_note import NODE_CLASS_MAPPINGS as _MAPS_NOTE
from .nodes.node_note import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_NOTE

# development mode for loading additional refrence nodes
dev_mode = False
if dev_mode:
    from .nodes.node_ref import NODE_CLASS_MAPPINGS as _MAPS_UTILS
    from .nodes.node_ref import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_UTILS
else:
    _MAPS_UTILS = {}
    _NAMES_UTILS = {}

# combine all node mappings
NODE_CLASS_MAPPINGS = {
    **_MAPS_3D,
    **_MAPS_AUDIO_STUDIO,
    **_MAPS_COMPOSITION,
    **_MAPS_PAINT,
    **_MAPS_PREVIEW,
    **_MAPS_RESOLUTION,
    **_MAPS_COMPARE,
    **_MAPS_CROP,
    **_MAPS_LABEL,
    **_MAPS_NOTE,
    **_MAPS_SAVE_MP4,
    **_MAPS_UTILS,
    **_MAPS_SHOW_TEXT,
}

# combine all node display name mappings
NODE_DISPLAY_NAME_MAPPINGS = {
    **_NAMES_COMPOSITION,
    **_NAMES_3D,
    **_NAMES_AUDIO_STUDIO,
    **_NAMES_COMPARE,
    **_NAMES_CROP,
    **_NAMES_LABEL,
    **_NAMES_NOTE,
    **_NAMES_SAVE_MP4,
    **_NAMES_UTILS,
    **_NAMES_PAINT,
    **_NAMES_PREVIEW,
    **_NAMES_RESOLUTION,
    **_NAMES_SHOW_TEXT,
}

# web directory for loading js files
WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]


# console print banner
def display_pixaroma_banner(node_mappings, list_all_nodes=False):
    """
    Displays a styled startup banner in the terminal with version and node info.
    """

    # --- 1. Get Version from pyproject.toml ---
    version = "Unknown"
    try:
        import toml

        toml_path = os.path.join(os.path.dirname(__file__), "pyproject.toml")
        with open(toml_path, "r", encoding="utf-8") as f:
            version = toml.load(f).get("project", {}).get("version", "Unknown")
    except Exception:
        pass

    # --- 2. Define ANSI Color Constants ---
    CLR_ORANGE = "\033[38;2;246;103;68m"
    CLR_WHITE_BOLD = "\033[1;37m"
    CLR_GREY = "\033[0;37m"
    CLR_RESET = "\033[0m"

    # --- 3. Format Node List for Wrapping ---
    sorted_node_names = sorted(node_mappings.values())
    max_chars_per_line = 110
    lines_to_print = []
    current_line = ""

    for i, name in enumerate(sorted_node_names):
        # Add comma unless it's the last item
        entry = f"{name}, " if i != len(sorted_node_names) - 1 else name

        if current_line and len(current_line) + len(entry) > max_chars_per_line:
            lines_to_print.append(current_line.rstrip(", "))
            current_line = ""
        current_line += entry

    if current_line:
        lines_to_print.append(current_line.rstrip(", "))

    # --- 4. Print the Banner ---
    horizontal_bar = f"{CLR_ORANGE}{'━' * 120}{CLR_RESET}"

    print(horizontal_bar)
    print(
        f"  {CLR_WHITE_BOLD}Pixaroma{CLR_RESET} v{version}  |  "
        f"{CLR_ORANGE}{len(node_mappings)} nodes{CLR_RESET} Loaded"
    )

    if list_all_nodes:
        for line in lines_to_print:
            print(f"  {CLR_GREY}{line}{CLR_RESET}")

    print(
        f"  {CLR_GREY}ComfyUI Tutorials: https://www.youtube.com/@pixaroma{CLR_RESET}"
    )
    print(
        f"  {CLR_ORANGE}Some Pixaroma nodes conflict with Nodes 2.0 — "
        f"consider turning it off from ComfyUI Menu.{CLR_RESET}"
    )
    print(horizontal_bar)


# display the banner when the module is loaded
display_pixaroma_banner(NODE_DISPLAY_NAME_MAPPINGS)
