"""Sizes Pixaroma — an editable list of exact resolutions with a Portrait /
Landscape flip. Outputs width + height ints chosen via the JS UI.

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
        "width and height as INT.\n\n"
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

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    OUTPUT_TOOLTIPS = ("The chosen width in pixels.", "The chosen height in pixels.")
    FUNCTION = "get_size"
    CATEGORY = "👑 Pixaroma/🔢 Values"

    def get_size(self, SizesState: str):
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
        return (w, h)


NODE_CLASS_MAPPINGS = {"PixaromaSizes": PixaromaSizes}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSizes": "Sizes Pixaroma"}
