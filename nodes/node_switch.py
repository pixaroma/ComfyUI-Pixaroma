"""Switch Pixaroma - dynamic-input switch that passes one active input through.

The user wires multiple upstream sources, picks which one is active via a
per-row toggle in the JS frontend, and the active value flows through to
the single output unchanged. Works for any wire type (MODEL, CLIP, IMAGE,
STRING, AUDIO, etc) via the shared AnyType from _type_helpers.

INPUT_TYPES pre-declares 32 optional input slots so ComfyUI's workflow
validation accepts whatever subset of slots the JS frontend exposes at
runtime. The active slot index is carried via the hidden SwitchState
input (Pattern #9 - injected by the JS app.graphToPrompt hook).
"""
from ._type_helpers import ANY


MAX_INPUTS = 32


class PixaromaSwitch:
    DESCRIPTION = (
        "Switch Pixaroma - pass-through switch that lets you pick one of "
        "many wired-in inputs to flow through the output. Wire any number "
        "of upstream nodes (up to 32) into the rows, then click a row's "
        "toggle to make it active. The active row's wire flows out "
        "unchanged - works for any wire type (MODEL, CLIP, IMAGE, STRING, "
        "AUDIO, etc).\n\n"
        "The node grows automatically as you connect wires: there is "
        "always one empty trailing row at the bottom waiting for the "
        "next connection. Disconnect a wire to remove its row. Each row "
        "has a label you can click to rename, so you remember which "
        "input is which."
    )

    @classmethod
    def INPUT_TYPES(cls):
        optional = {
            f"input_{i}": (ANY, {"forceInput": True, "tooltip": "An input to route. Wire any node here; click a row's toggle on the node to make it the active one, and that row's value flows out unchanged."})
            for i in range(1, MAX_INPUTS + 1)
        }
        return {
            "required": {},
            "optional": optional,
            "hidden": {
                "SwitchState": ("STRING", {"default": "1"}),
            },
        }

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("output",)
    OUTPUT_TOOLTIPS = ("The input from the active (highlighted) row, passed through unchanged.",)
    FUNCTION = "pick"
    CATEGORY = "👑 Pixaroma"

    def pick(self, SwitchState="1", **kwargs):
        try:
            idx = int(SwitchState)
        except (TypeError, ValueError):
            idx = 1
        if idx < 1 or idx > MAX_INPUTS:
            idx = 1
        key = f"input_{idx}"
        val = kwargs.get(key)
        if val is None:
            raise ValueError(
                "Switch Pixaroma: no input is connected to the active "
                "row. Wire at least one upstream node into a row, then "
                "click that row's toggle to make it active."
            )
        return (val,)


NODE_CLASS_MAPPINGS = {"PixaromaSwitch": PixaromaSwitch}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSwitch": "Switch Pixaroma"}
