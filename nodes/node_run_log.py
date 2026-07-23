class PixaromaRunLog:
    """Run Log Pixaroma - keeps the last 10 run times for this workflow on the canvas.

    Frontend-only node (never runs in Python, like Run Timer Pixaroma). All of the
    behaviour lives in js/run_log/index.js: it listens to ComfyUI's run events,
    times how long each whole run takes, and shows the last 10 finished times as a
    list right on the node face. The list is stored on node.properties, so it
    travels with the workflow and is still there after a reload. There are no
    inputs and no outputs - it is skipped on every Run, so it never appears in the
    prompt and does not affect the graph. Just drop it on the canvas.
    """

    DESCRIPTION = (
        "Run Log Pixaroma - a companion to Run Timer that keeps the last 10 run "
        "times for the current workflow visible right on the node. Every time you "
        "press Run it times the whole workflow and adds the finished time to the "
        "top of the list, newest first, so you can watch a workflow get faster or "
        "notice when it suddenly slows down.\n\n"
        "The most recent run is highlighted and the fastest one is marked. Double-click "
        "any row to write a short note about that run, such as with style lora or "
        "seed 12345, so you can tell the times apart; the note travels with its own "
        "run as newer ones push it down the list. The list is for this workflow only. "
        "Right-click the node to copy the times or clear the list.\n\n"
        "It does not need to be wired to anything. The list is saved with the "
        "workflow, so it is still there after you switch tabs, reload the page, or "
        "restart ComfyUI. Only completed runs are logged; a run you stop or that "
        "errors out is skipped."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    # OUTPUT_NODE intentionally NOT set: ComfyUI skips this node on Run, so it never
    # enters the prompt and draws no output badge. It is a pure frontend control -
    # all of the work happens in js/run_log/index.js.
    CATEGORY = "👑 Pixaroma/🔀 Logic & Flow"

    def noop(self):
        return ()


NODE_CLASS_MAPPINGS = {
    "PixaromaRunLog": PixaromaRunLog,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaRunLog": "Run Log Pixaroma",
}
