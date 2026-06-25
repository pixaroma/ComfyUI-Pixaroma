class PixaromaGroupSwitch:
    """Group Switch - a frontend-only control panel for Pixaroma Groups.

    Lists the Pixaroma Groups you choose and gives each one an on/off switch
    that mutes or bypasses every node in that group. All behaviour lives in
    js/group_switch/index.js; the node itself never runs in Python (state is
    stored on node.properties and restored from the workflow on load), so it
    is skipped on every Run - no inputs to wire, no outputs to chain.
    """

    DESCRIPTION = (
        "Group Switch Pixaroma - a compact panel of on/off switches for your "
        "Pixaroma Groups. Each switch mutes or bypasses every node inside that "
        "group, so you can turn whole sections of a workflow on and off without "
        "wiring anything.\n\n"
        "Open the panel (the gear, or right-click the node) to choose whether "
        "this switch mutes or bypasses, which groups it controls (all of them, "
        "or a hand-picked set you search and sort), and the switching rule (any "
        "number on, only one on at a time, or always keep one on).\n\n"
        "Drop several of these for different jobs - one to mute, one to bypass. "
        "They stay in sync with each other and with the group's own header "
        "buttons, because they all read and set the live group state."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    # OUTPUT_NODE intentionally NOT set: ComfyUI skips this node on Run, so it
    # never appears in the prompt and draws no timing badge. It is a pure
    # frontend control - all of the work happens in js/group_switch/index.js.
    CATEGORY = "👑 Pixaroma/🔀 Logic & Flow"

    def noop(self):
        return {}


NODE_CLASS_MAPPINGS = {
    "PixaromaGroupSwitch": PixaromaGroupSwitch,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaGroupSwitch": "Group Switch Pixaroma",
}
