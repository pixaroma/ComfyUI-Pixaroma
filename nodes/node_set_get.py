"""Set Pixaroma / Get Pixaroma - metadata-only backend definitions.

These two nodes are pure FRONTEND virtual nodes; all of their behavior lives in
js/set_get/. They are declared here ONLY so the node library shows a proper
display name ("Set Pixaroma" / "Get Pixaroma"), the correct category, brand
colors, the Help panel, the Info panel, and good search ranking (a pure
frontend node would otherwise show up under "__frontend_only__" with its raw
class id as the name).

At run time the frontend marks every instance virtual (isVirtualNode), so
ComfyUI prunes them from the prompt and reroutes Get nodes straight to the real
upstream source. These Python classes are therefore NEVER executed; the noop
functions exist only so the class is a valid node definition. The order of
frontend registration (registerCustomNodes runs after the backend defs are
registered) means the JS class is what actually gets instantiated.
"""

from ._type_helpers import ANY

_CATEGORY = "👑 Pixaroma/🔀 Logic & Flow"


class PixaromaSetNode:
    DESCRIPTION = (
        "Store any connection under a name, then read it back anywhere with a "
        "Get Pixaroma node. A wireless wire that keeps the canvas clean. It also "
        "has a passthrough output, so a nearby node can wire to it directly while "
        "far ones read it with a Get. It lives only in the editor: at run time "
        "the value flows straight from the original source, so it never changes "
        "the result or slows anything down. Wire anything in, type a name, and "
        "keep the node collapsed to stay tidy."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "name": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": "The variable name. A Get Pixaroma node reads this value by picking this name.",
                    },
                ),
            },
            "optional": {
                "value": (
                    ANY,
                    {"tooltip": "Connect anything here. The node takes on that wire's type."},
                ),
            },
        }

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("*",)
    OUTPUT_TOOLTIPS = (
        "The same value you wired in. Connect a nearby node directly here, or read it from anywhere with Get Pixaroma.",
    )
    FUNCTION = "noop"
    CATEGORY = _CATEGORY

    def noop(self, **kwargs):
        return (None,)


class PixaromaGetNode:
    DESCRIPTION = (
        "Read a value that a Set Pixaroma node stored under a name, with no "
        "cable. Pick the name from the dropdown and the output carries that "
        "Set's value, matching its type. Like Set Pixaroma it exists only in "
        "the editor and resolves straight to the original source at run time, "
        "so there is no extra cost. Add as many Get nodes as you like for the "
        "same name to fan one value out."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("*",)
    OUTPUT_TOOLTIPS = ("The value of the chosen Set Pixaroma node, matching its type.",)
    FUNCTION = "noop"
    CATEGORY = _CATEGORY

    def noop(self, **kwargs):
        return (None,)


NODE_CLASS_MAPPINGS = {
    "PixaromaSetNode": PixaromaSetNode,
    "PixaromaGetNode": PixaromaGetNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaSetNode": "Set Pixaroma",
    "PixaromaGetNode": "Get Pixaroma",
}
