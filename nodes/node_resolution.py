"""Resolution Pixaroma: outputs width + height ints chosen via the JS UI, plus an
empty latent at that size."""

import json

DEFAULT_STATE = {
    "mode": "preset",
    "ratio": "1:1",
    "w": 1024,
    "h": 1024,
    "custom_w": 1024,
    "custom_h": 1024,
    # Custom Ratio mode — kept in sync with DEFAULT_STATE in
    # js/resolution/index.js (CLAUDE.md Pattern #3).
    "custom_ratio_w": 4,
    "custom_ratio_h": 3,
    "snap": 16,
}


def _clamp(n: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, n))


class PixaromaResolution:
    DESCRIPTION = (
        "Resolution Pixaroma - a one-click resolution picker. The on-node UI "
        "shows a 3x3 ratio chip grid (1:1, 16:9, 9:16, 2:1, 3:2, 2:3, 4:3, 3:4, "
        "4:5) with the 8 most-popular sizes for each ratio. Covers SDXL, AI "
        "video, and social-media-ready dimensions. Click a chip, click a size, "
        "done.\n\n"
        "Custom Ratio mode lets you type any W:H (21:9, 16:10, anything) and "
        "get auto-computed AI-friendly sizes. Custom Resolution mode lets you "
        "type exact dimensions; math expressions like '1024+128' or '512*2' "
        "work in the W / H fields. In both custom modes the Snap chips "
        "(8 / 16 / 32 / 64) round outputs to multiples that VAE encoders "
        "prefer.\n\n"
        "Outputs width and height as INT, plus an empty latent at that size. "
        "The latent output is the same as ComfyUI's Empty Latent Image, so it "
        "can go straight into a KSampler for image models (SD 1.5, SDXL, SD3, "
        "Flux, Flux 2, Qwen Image and others). The batch box beside it sets how "
        "many pictures one run makes (1 to 64). For video models, use width and "
        "height with that model's own latent node. State saves and restores "
        "with the workflow.\n\n"
        "All UI lives on the JS side; the only Python input is a hidden "
        "serialized state string that gets injected at execution time."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # ResolutionState is `hidden`, NOT `required`. Hidden inputs do NOT
        # produce a widget OR an input slot in the Vue frontend (the auto-
        # created input dot for required STRING widgets is what the original
        # implementation had to fight against). The JS frontend stores state
        # in node.properties.resolutionState and injects it into the API
        # prompt at execution time via app.graphToPrompt.
        return {
            "required": {},
            "hidden": {
                "ResolutionState": (
                    "STRING",
                    {"default": json.dumps(DEFAULT_STATE)},
                ),
            },
        }

    # latent is appended LAST: a saved workflow keeps its width / height wires
    # by slot index, and an old file shows the new dot (the frontend copies
    # the saved outputs over the def-built list by index).
    RETURN_TYPES = ("INT", "INT", "LATENT")
    RETURN_NAMES = ("width", "height", "latent")
    OUTPUT_TOOLTIPS = (
        "The chosen width in pixels.",
        "The chosen height in pixels.",
        "An empty latent at this size: the same as ComfyUI's Empty Latent "
        "Image. The batch box beside this output sets how many pictures it "
        "makes per run (1 to 64). A KSampler adapts it to most image models.",
    )
    FUNCTION = "get_resolution"
    CATEGORY = "👑 Pixaroma/🔢 Values"

    # The default matters: ComfyUI never fills a missing hidden input from
    # INPUT_TYPES, so an API prompt built without the browser (curl, scripts,
    # comfy-mcp) has no ResolutionState and a required parameter crashed the
    # run with a TypeError. Without it the node gives the default 1024 x 1024.
    def get_resolution(self, ResolutionState: str = json.dumps(DEFAULT_STATE)):
        w, h = resolution_wh(ResolutionState)
        # Imported here, not at the top, so the size maths stays loadable as a
        # plain file outside the package (same as node_sizes).
        from ._empty_latent import batch_of, empty_latent
        return (w, h, empty_latent(w, h, batch_of(ResolutionState)))


def resolution_wh(ResolutionState: str):
    """The (width, height) the node outputs for a serialized state."""
    try:
        state = json.loads(ResolutionState)
        w = int(state.get("w", 1024))
        h = int(state.get("h", 1024))
    except Exception:
        print("[PixaromaResolution] Malformed state, falling back to 1024x1024")
        w, h = 1024, 1024
    w = _clamp(w, 64, 16384)
    h = _clamp(h, 64, 16384)
    return w, h


NODE_CLASS_MAPPINGS = {"PixaromaResolution": PixaromaResolution}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaResolution": "Resolution Pixaroma"}
