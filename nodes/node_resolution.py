"""Resolution Pixaroma — outputs width + height ints chosen via the JS UI."""

import json

DEFAULT_STATE = {
    "mode": "preset",
    "ratio": "1:1",
    "w": 1024,
    "h": 1024,
    "custom_w": 1024,
    "custom_h": 1024,
}


def _clamp(n: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, n))


class PixaromaResolution:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "ResolutionState": (
                    "STRING",
                    {
                        "default": json.dumps(DEFAULT_STATE),
                        "multiline": False,
                    },
                ),
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    FUNCTION = "get_resolution"
    CATEGORY = "👑 Pixaroma/Utils"

    def get_resolution(self, ResolutionState: str):
        try:
            state = json.loads(ResolutionState)
            w = int(state.get("w", 1024))
            h = int(state.get("h", 1024))
        except Exception:
            print("[PixaromaResolution] Malformed state, falling back to 1024x1024")
            w, h = 1024, 1024
        w = _clamp(w, 64, 16384)
        h = _clamp(h, 64, 16384)
        return (w, h)


NODE_CLASS_MAPPINGS = {"PixaromaResolution": PixaromaResolution}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaResolution": "Resolution Pixaroma"}
