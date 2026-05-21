"""Switch WH Pixaroma - pick width/height from one of two input sources."""


class PixaromaSwitchWH:
    DESCRIPTION = (
        "Switch WH Pixaroma - pick width/height from one of two input "
        "sources with a single click. Wire two W/H pairs (for example a "
        "Load Image Pixaroma's WIDTH/HEIGHT and a Resolution Pixaroma's "
        "width/height) into the A and B inputs, then click A or B on the "
        "node to choose which pair flows through to the output. Lets you "
        "flip between the source image's native size and a manually "
        "chosen resolution without rewiring cables.\n\n"
        "If only one pair is wired, that pair is used regardless of the "
        "toggle - so you can leave the unused inputs disconnected during "
        "early workflow setup."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # All four W/H inputs are optional + forceInput so they show as
        # slots (not widgets) and the node still executes when only one
        # pair is wired. SwitchWHState is `hidden` (Resolution Pixaroma
        # pattern, CLAUDE.md Vue Compat #9) so no input slot is exposed
        # for the toggle - state lives on node.properties.switchWhState
        # and is injected at execution time by the JS graphToPrompt hook.
        return {
            "required": {},
            "optional": {
                "width_a": ("INT", {"forceInput": True}),
                "height_a": ("INT", {"forceInput": True}),
                "width_b": ("INT", {"forceInput": True}),
                "height_b": ("INT", {"forceInput": True}),
            },
            "hidden": {
                "SwitchWHState": ("STRING", {"default": "A"}),
            },
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    OUTPUT_TOOLTIPS = ("The width from the active (highlighted) source.", "The height from the active (highlighted) source.")
    FUNCTION = "pick"
    CATEGORY = "👑 Pixaroma"

    def pick(
        self,
        width_a=None,
        height_a=None,
        width_b=None,
        height_b=None,
        SwitchWHState="A",
    ):
        source = SwitchWHState if SwitchWHState in ("A", "B") else "A"

        # A pair is COMPLETE only if both width and height are wired.
        # We never mix wires across A and B - that would silently produce
        # a wrong-shape image when the user forgets one cable.
        a_complete = width_a is not None and height_a is not None
        b_complete = width_b is not None and height_b is not None

        if source == "A":
            if a_complete:
                return (int(width_a), int(height_a))
            if b_complete:
                print(
                    "[PixaromaSwitchWH] A is incomplete (one or both "
                    "cables missing); using B instead."
                )
                return (int(width_b), int(height_b))
        else:  # source == "B"
            if b_complete:
                return (int(width_b), int(height_b))
            if a_complete:
                print(
                    "[PixaromaSwitchWH] B is incomplete (one or both "
                    "cables missing); using A instead."
                )
                return (int(width_a), int(height_a))

        # Neither side has a complete W+H pair.
        raise ValueError(
            "Switch WH Pixaroma: needs both width AND height wired on at "
            "least one side (A or B). One cable alone is not enough - "
            "wire the matching one too."
        )


NODE_CLASS_MAPPINGS = {"PixaromaSwitchWH": PixaromaSwitchWH}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSwitchWH": "Switch WH Pixaroma"}
