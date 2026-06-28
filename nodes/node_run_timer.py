class PixaromaRunTimer:
    """Run Timer Pixaroma - a frontend-only stopwatch for the whole workflow.

    Resets to zero the moment a run begins, counts up live while the workflow
    runs, freezes on the total time when it finishes, and plays a chime. All
    behaviour lives in js/run_timer/index.js (it listens to ComfyUI's run
    events, so the node does not need to be wired into the graph). Settings
    (chime sound, volume, decimals, clock color) are stored on node.properties
    and restored from the workflow on load - the node never runs in Python, so
    it is skipped on every Run: no inputs to wire, no outputs to chain.
    """

    DESCRIPTION = (
        "Run Timer Pixaroma - a clock that times how long a workflow takes. It "
        "resets to zero when you press Run, counts up while the workflow is "
        "working, and freezes on the total time the moment it finishes, then "
        "plays a chime so you know it is done even when you are in another tab.\n\n"
        "The node face shows only the clock. Right-click the node for settings: "
        "turn the chime on or off, pick the sound and volume (with a Preview "
        "button), choose how many decimals to show, and set the clock color.\n\n"
        "Chime sounds are the same library as Notify Pixaroma - drop a .mp3, "
        ".wav, or .ogg with a simple name (letters, numbers, dashes) into "
        "assets/sounds/ to add more (restart ComfyUI to pick up new files). A "
        "master mute for all run-timer chimes lives in Settings -> Pixaroma -> "
        "Run Timer."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    # OUTPUT_NODE intentionally NOT set: ComfyUI skips this node on Run, so it
    # never appears in the prompt and draws no timing badge. It is a pure
    # frontend control - all of the work happens in js/run_timer/index.js.
    CATEGORY = "👑 Pixaroma/🔀 Logic & Flow"

    def noop(self):
        return ()


NODE_CLASS_MAPPINGS = {
    "PixaromaRunTimer": PixaromaRunTimer,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaRunTimer": "Run Timer Pixaroma",
}
