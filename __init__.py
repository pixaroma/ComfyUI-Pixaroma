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
from .nodes.node_uncrop import NODE_CLASS_MAPPINGS as _MAPS_UNCROP
from .nodes.node_uncrop import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_UNCROP
from .nodes.node_inpaint_crop import NODE_CLASS_MAPPINGS as _MAPS_INPAINT_CROP
from .nodes.node_inpaint_crop import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_INPAINT_CROP
from .nodes.node_inpaint_stitch import NODE_CLASS_MAPPINGS as _MAPS_INPAINT_STITCH
from .nodes.node_inpaint_stitch import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_INPAINT_STITCH
from .nodes.node_label import NODE_CLASS_MAPPINGS as _MAPS_LABEL
from .nodes.node_label import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_LABEL
from .nodes.node_load_image import NODE_CLASS_MAPPINGS as _MAPS_LOAD_IMAGE
from .nodes.node_load_image import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_LOAD_IMAGE
from .nodes.node_paint import NODE_CLASS_MAPPINGS as _MAPS_PAINT
from .nodes.node_paint import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_PAINT
from .nodes.node_preview import NODE_CLASS_MAPPINGS as _MAPS_PREVIEW
from .nodes.node_preview import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_PREVIEW
from .nodes.node_prompt_reader import NODE_CLASS_MAPPINGS as _MAPS_PROMPT_READER
from .nodes.node_prompt_reader import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_PROMPT_READER
from .nodes.node_resolution import NODE_CLASS_MAPPINGS as _MAPS_RESOLUTION
from .nodes.node_resolution import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_RESOLUTION
from .nodes.node_show_text import NODE_CLASS_MAPPINGS as _MAPS_SHOW_TEXT
from .nodes.node_show_text import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_SHOW_TEXT
from .nodes.node_note import NODE_CLASS_MAPPINGS as _MAPS_NOTE
from .nodes.node_note import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_NOTE
from .nodes.node_notify import NODE_CLASS_MAPPINGS as _MAPS_NOTIFY
from .nodes.node_notify import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_NOTIFY
from .nodes.node_switch import NODE_CLASS_MAPPINGS as _MAPS_SWITCH
from .nodes.node_switch import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_SWITCH
from .nodes.node_switch_wh import NODE_CLASS_MAPPINGS as _MAPS_SWITCH_WH
from .nodes.node_switch_wh import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_SWITCH_WH
from .nodes.node_switch_source import NODE_CLASS_MAPPINGS as _MAPS_SWITCH_SOURCE
from .nodes.node_switch_source import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_SWITCH_SOURCE
from .nodes.node_mute_switch import NODE_CLASS_MAPPINGS as _MAPS_MUTE_SWITCH
from .nodes.node_mute_switch import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_MUTE_SWITCH
from .nodes.node_wh import NODE_CLASS_MAPPINGS as _MAPS_WH
from .nodes.node_wh import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_WH
from .nodes.node_portrait_landscape import NODE_CLASS_MAPPINGS as _MAPS_PORTRAIT_LANDSCAPE
from .nodes.node_portrait_landscape import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_PORTRAIT_LANDSCAPE
from .nodes.node_number import NODE_CLASS_MAPPINGS as _MAPS_NUMBER
from .nodes.node_number import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_NUMBER
from .nodes.node_seed import NODE_CLASS_MAPPINGS as _MAPS_SEED
from .nodes.node_seed import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_SEED
from .nodes.node_text import NODE_CLASS_MAPPINGS as _MAPS_TEXT
from .nodes.node_text import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_TEXT
from .nodes.node_prompt_stack import NODE_CLASS_MAPPINGS as _MAPS_PROMPT_STACK
from .nodes.node_prompt_stack import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_PROMPT_STACK
from .nodes.node_prompt_multi import NODE_CLASS_MAPPINGS as _MAPS_PROMPT_MULTI
from .nodes.node_prompt_multi import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_PROMPT_MULTI
from .nodes.node_prompt_from_list import NODE_CLASS_MAPPINGS as _MAPS_PROMPT_FROM_LIST
from .nodes.node_prompt_from_list import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_PROMPT_FROM_LIST
from .nodes.node_prompt_pack import NODE_CLASS_MAPPINGS as _MAPS_PROMPT_PACK
from .nodes.node_prompt_pack import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_PROMPT_PACK
from .nodes.node_remove_background import NODE_CLASS_MAPPINGS as _MAPS_REMOVE_BG
from .nodes.node_remove_background import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_REMOVE_BG
from .nodes.node_text_overlay import NODE_CLASS_MAPPINGS as _MAPS_TEXT_OVERLAY
from .nodes.node_text_overlay import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_TEXT_OVERLAY
from .nodes.node_image_resize import NODE_CLASS_MAPPINGS as _MAPS_IMAGE_RESIZE
from .nodes.node_image_resize import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_IMAGE_RESIZE
from .nodes.node_resize_crop import NODE_CLASS_MAPPINGS as _MAPS_RESIZE_CROP
from .nodes.node_resize_crop import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_RESIZE_CROP
from .nodes.node_text_watermark import NODE_CLASS_MAPPINGS as _MAPS_TEXT_WATERMARK
from .nodes.node_text_watermark import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_TEXT_WATERMARK
from .nodes.node_version_check import NODE_CLASS_MAPPINGS as _MAPS_VERSION_CHECK
from .nodes.node_version_check import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_VERSION_CHECK
from .nodes.node_pause_image import NODE_CLASS_MAPPINGS as _MAPS_PAUSE_IMAGE
from .nodes.node_pause_image import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_PAUSE_IMAGE
from .nodes.node_xy_plot import NODE_CLASS_MAPPINGS as _MAPS_XY_PLOT
from .nodes.node_xy_plot import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_XY_PLOT
from .nodes.node_find_replace import NODE_CLASS_MAPPINGS as _MAPS_FIND_REPLACE
from .nodes.node_find_replace import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_FIND_REPLACE
from .nodes.node_load_images_folder import NODE_CLASS_MAPPINGS as _MAPS_LIF
from .nodes.node_load_images_folder import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_LIF
from .nodes.node_set_get import NODE_CLASS_MAPPINGS as _MAPS_SET_GET
from .nodes.node_set_get import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_SET_GET
from .nodes.node_load_video import NODE_CLASS_MAPPINGS as _MAPS_LOAD_VIDEO
from .nodes.node_load_video import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_LOAD_VIDEO

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
    **_MAPS_PROMPT_READER,
    **_MAPS_RESOLUTION,
    **_MAPS_COMPARE,
    **_MAPS_CROP,
    **_MAPS_UNCROP,
    **_MAPS_INPAINT_CROP,
    **_MAPS_INPAINT_STITCH,
    **_MAPS_LABEL,
    **_MAPS_LOAD_IMAGE,
    **_MAPS_NOTE,
    **_MAPS_NOTIFY,
    **_MAPS_SAVE_MP4,
    **_MAPS_SWITCH,
    **_MAPS_SWITCH_WH,
    **_MAPS_SWITCH_SOURCE,
    **_MAPS_MUTE_SWITCH,
    **_MAPS_WH,
    **_MAPS_PORTRAIT_LANDSCAPE,
    **_MAPS_NUMBER,
    **_MAPS_SEED,
    **_MAPS_TEXT,
    **_MAPS_PROMPT_STACK,
    **_MAPS_PROMPT_MULTI,
    **_MAPS_PROMPT_FROM_LIST,
    **_MAPS_PROMPT_PACK,
    **_MAPS_UTILS,
    **_MAPS_SHOW_TEXT,
    **_MAPS_REMOVE_BG,
    **_MAPS_TEXT_OVERLAY,
    **_MAPS_IMAGE_RESIZE,
    **_MAPS_RESIZE_CROP,
    **_MAPS_TEXT_WATERMARK,
    **_MAPS_VERSION_CHECK,
    **_MAPS_PAUSE_IMAGE,
    **_MAPS_XY_PLOT,
    **_MAPS_FIND_REPLACE,
    **_MAPS_LIF,
    **_MAPS_SET_GET,
    **_MAPS_LOAD_VIDEO,
}

# combine all node display name mappings
NODE_DISPLAY_NAME_MAPPINGS = {
    **_NAMES_COMPOSITION,
    **_NAMES_3D,
    **_NAMES_AUDIO_STUDIO,
    **_NAMES_COMPARE,
    **_NAMES_CROP,
    **_NAMES_UNCROP,
    **_NAMES_INPAINT_CROP,
    **_NAMES_INPAINT_STITCH,
    **_NAMES_LABEL,
    **_NAMES_LOAD_IMAGE,
    **_NAMES_NOTE,
    **_NAMES_NOTIFY,
    **_NAMES_SAVE_MP4,
    **_NAMES_SWITCH,
    **_NAMES_SWITCH_WH,
    **_NAMES_SWITCH_SOURCE,
    **_NAMES_MUTE_SWITCH,
    **_NAMES_WH,
    **_NAMES_PORTRAIT_LANDSCAPE,
    **_NAMES_NUMBER,
    **_NAMES_SEED,
    **_NAMES_TEXT,
    **_NAMES_PROMPT_STACK,
    **_NAMES_PROMPT_MULTI,
    **_NAMES_PROMPT_FROM_LIST,
    **_NAMES_PROMPT_PACK,
    **_NAMES_UTILS,
    **_NAMES_PAINT,
    **_NAMES_PREVIEW,
    **_NAMES_PROMPT_READER,
    **_NAMES_RESOLUTION,
    **_NAMES_SHOW_TEXT,
    **_NAMES_REMOVE_BG,
    **_NAMES_TEXT_OVERLAY,
    **_NAMES_IMAGE_RESIZE,
    **_NAMES_RESIZE_CROP,
    **_NAMES_TEXT_WATERMARK,
    **_NAMES_VERSION_CHECK,
    **_NAMES_PAUSE_IMAGE,
    **_NAMES_XY_PLOT,
    **_NAMES_FIND_REPLACE,
    **_NAMES_LIF,
    **_NAMES_SET_GET,
    **_NAMES_LOAD_VIDEO,
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
        f"  {CLR_GREY}This is a notice, not an error. All {CLR_ORANGE}Pixaroma"
        f"{CLR_GREY} nodes work in both Classic and Nodes 2.0 mode.{CLR_RESET}"
    )
    print(
        f"  {CLR_GREY}If something looks off right after switching the Node UI "
        f"mode, hard-refresh the page (Ctrl+Shift+R).{CLR_RESET}"
    )
    print(horizontal_bar)


# display the banner when the module is loaded
display_pixaroma_banner(NODE_DISPLAY_NAME_MAPPINGS)
