"""Sizes Pixaroma — an editable list of exact resolutions with a Portrait /
Landscape flip. Outputs width + height ints chosen via the JS UI, plus an empty
latent at that size.

All UI lives on the JS side; the only Python input is a hidden serialized state
string injected at execution time via app.graphToPrompt (same pattern as
Resolution Pixaroma). JS already computes the final oriented + snapped width and
height and stores them as state.w / state.h, so Python just reads them back.
"""

import json

DEFAULT_STATE = {
    "version": 1,
    "sizes": [[1024, 1024]],
    "selected": 0,
    "orientation": "portrait",  # "portrait" | "landscape"
    "snap": 0,                  # 0 = off; else 8 / 16 / 32 / 64
    "accent": None,
    "collapsed": False,         # UI-only; Python ignores it
    "w": 1024,
    "h": 1024,
}


def _clamp(n: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, n))


def _orient(pair, orientation):
    a, b = int(pair[0]), int(pair[1])
    lo, hi = min(a, b), max(a, b)
    return (hi, lo) if orientation == "landscape" else (lo, hi)


def _snap(n: int, step: int) -> int:
    if not step:
        return n
    return round(n / step) * step


class PixaromaSizes:
    DESCRIPTION = (
        "Sizes Pixaroma - your own list of favourite resolutions. Add the exact "
        "width x height sizes you use, pick one from the list, and it outputs "
        "width and height as INT, plus an empty latent at that size.\n\n"
        "The latent output is the same as ComfyUI's Empty Latent Image, so it "
        "can go straight into a KSampler for image models (SD 1.5, SDXL, SD3, "
        "Flux, Flux 2, Qwen Image and others). The batch box beside it sets how "
        "many pictures one run makes (1 to 64). For video models, use width and "
        "height with that model's own latent node.\n\n"
        "The Portrait / Landscape buttons flip the chosen size, so you add a "
        "size like 1024 x 1536 once and reuse it in either orientation (square "
        "sizes are unaffected). A fresh node starts with just 1024 x 1024; open "
        "the settings (the gear) to add, remove, and reorder sizes, load a set "
        "of common sizes, or snap width and height to a multiple of 8, 16, 32, "
        "or 64 for VAE-friendly dimensions.\n\n"
        "State saves and restores with the workflow."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # SizesState is `hidden` (no widget, no input dot). The JS frontend
        # stores state in node.properties.sizesState and injects it into the
        # API prompt at execution time via app.graphToPrompt.
        return {
            "required": {},
            "hidden": {
                "SizesState": ("STRING", {"default": json.dumps(DEFAULT_STATE)}),
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
    FUNCTION = "get_size"
    CATEGORY = "👑 Pixaroma/🔢 Values"

    # The default matters: ComfyUI never fills a missing hidden input from
    # INPUT_TYPES, so an API prompt built without the browser (curl, scripts,
    # comfy-mcp) has no SizesState and a required parameter crashed the run
    # with a TypeError. Without it the node gives the default 1024 x 1024.
    def get_size(self, SizesState: str = json.dumps(DEFAULT_STATE)):
        w, h = sizes_wh(SizesState)
        # Imported here, not at the top: the size maths (sizes_wh, below) stays
        # loadable as a plain file (the parity harness loads it outside the package).
        from ._empty_latent import batch_of, empty_latent
        return (w, h, empty_latent(w, h, batch_of(SizesState)))


def sizes_wh(SizesState: str):
    """The (width, height) the node outputs for a serialized state.

    js/load_3d/size.mjs mirrors this function so Load 3D can read the size in
    the browser before Run. Keep the two in step; the harness
    D:/Claude Tests/_load3d_size_parity.py runs both on the same states.
    """
    try:
        state = json.loads(SizesState)
        # JS keeps state.w / state.h as the final oriented + snapped values;
        # trust them when present, otherwise recompute defensively (e.g. an
        # API prompt hand-built without the JS layer).
        if "w" in state and "h" in state:
            w = int(state.get("w", 1024))
            h = int(state.get("h", 1024))
        else:
            sizes = state.get("sizes") or [[1024, 1024]]
            idx = int(state.get("selected", 0))
            if idx < 0 or idx >= len(sizes):
                idx = 0
            w, h = _orient(sizes[idx], state.get("orientation", "portrait"))
            step = int(state.get("snap", 0) or 0)
            w, h = _snap(w, step), _snap(h, step)
    except Exception:
        print("[PixaromaSizes] Malformed state, falling back to 1024x1024")
        w, h = 1024, 1024
    w = _clamp(int(w), 64, 16384)
    h = _clamp(int(h), 64, 16384)
    return w, h


NODE_CLASS_MAPPINGS = {"PixaromaSizes": PixaromaSizes}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSizes": "Sizes Pixaroma"}
