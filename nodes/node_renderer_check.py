class PixaromaRendererCheck:
    """Diagnostic label — shows which ComfyUI node renderer is active."""

    DESCRIPTION = (
        "Renderer Check Pixaroma - a small on-canvas badge that shows which "
        "node renderer ComfyUI is currently using: the new Nodes 2.0 (Vue) "
        "renderer or the classic legacy (LiteGraph) renderer. The badge "
        "updates live when you switch the setting.\n\n"
        "Pure diagnostic - no inputs to wire, no outputs to chain, no Python "
        "work on Run. Handy while testing whether a node behaves correctly in "
        "both renderers."
    )

    @classmethod
    def INPUT_TYPES(s):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    # OUTPUT_NODE intentionally NOT set: ComfyUI skips this node on Run, so no
    # "X.Xs" timing badge is drawn over what is just a status caption. All the
    # work happens in js/renderer_check/index.js.
    CATEGORY = "👑 Pixaroma"

    def noop(self):
        return {}


NODE_CLASS_MAPPINGS = {
    "PixaromaRendererCheck": PixaromaRendererCheck,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaRendererCheck": "Renderer Check Pixaroma",
}
