"""Mute Switch Pixaroma - terminal control node that toggles whole branches
of a workflow on/off.

The user wires the last node of each "scene" into a row. The JS frontend
paints per-row pills and, on click, walks upstream and sets node.mode = 2
(mute) or 4 (bypass) on every reached upstream node. This Python class is
a no-op - it exists only to declare the 32 optional ANY input slots and
the category for menu placement.
"""
from ._type_helpers import ANY


MAX_INPUTS = 32


class PixaromaMuteSwitch:
    DESCRIPTION = (
        "Mute Switch Pixaroma - toggle whole branches of your workflow on "
        "and off with one node. Wire the last node of each scene (usually a "
        "KSampler) into a row, then click the row's pill to skip or enable "
        "that scene on the next Run.\n\n"
        "The pill at top-left switches between Single mode (exactly one "
        "scene runs at a time, like a radio button) and Multi mode (any "
        "combination of scenes can run). The pill at top-right switches "
        "between Mute (the scene does not run at all) and Bypass (each "
        "node in the scene passes its input through unchanged).\n\n"
        "When several scenes share an upstream node, that node only gets "
        "muted when every scene that depends on it is OFF - so you never "
        "accidentally break a scene that is still active."
    )

    @classmethod
    def INPUT_TYPES(cls):
        optional = {
            f"input_{i}": (
                ANY,
                {
                    "forceInput": True,
                    "tooltip": (
                        "Wire any node from a scene here. Clicking this "
                        "row's pill on the node body toggles the whole "
                        "branch upstream of this wire on or off."
                    ),
                },
            )
            for i in range(1, MAX_INPUTS + 1)
        }
        return {"required": {}, "optional": optional}

    # Phantom output for chaining: wire this into another Mute Switch's
    # input so the outer switch can cascade through this one. The value is
    # always None at runtime - muting is JS-side, the output exists only as
    # a canvas-side hook.
    #
    # The custom type "PIXAROMA_MUTE_CHAIN" prevents accidentally wiring
    # 'out' into a non-Mute-Switch consumer (which would receive None and
    # crash at runtime). Mute Switch's own ANY inputs still accept it
    # because ANY matches anything.
    RETURN_TYPES = ("PIXAROMA_MUTE_CHAIN",)
    RETURN_NAMES = ("out",)
    OUTPUT_TOOLTIPS = (
        "Phantom pass-through used to CHAIN Mute Switches. Wire this into "
        "another Mute Switch's input row; toggling that outer row OFF will "
        "then also mute every node THIS switch controls (cascade). For "
        "normal data flow, wire your real nodes directly into Mute Switch "
        "rows - this output carries no real data.",
    )
    FUNCTION = "noop"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma"

    def noop(self, **kwargs):
        # All muting happens in the JS frontend BEFORE this node is reached.
        # The (None,) return matches RETURN_TYPES arity; downstream consumers
        # that aren't Mute Switches will receive None.
        return (None,)


NODE_CLASS_MAPPINGS = {"PixaromaMuteSwitch": PixaromaMuteSwitch}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaMuteSwitch": "Mute Switch Pixaroma"}
