"""Number Pixaroma - one number field, INT + FLOAT outputs."""

import math


class PixaromaNumber:
    DESCRIPTION = (
        "Number Pixaroma - a tiny node with one number field. Outputs the "
        "same value twice: once as INT (rounded to the nearest whole "
        "number) and once as FLOAT (kept as-is with decimals).\n\n"
        "Useful when one downstream node wants an INT and another wants a "
        "FLOAT from the same value, or when you want to convert a decimal "
        "to an integer cleanly in the middle of a workflow.\n\n"
        "The number field accepts whole numbers (42), decimals (3.14), "
        "and math expressions (1024+64, 1024/3, 512*2).\n\n"
        "Float-to-int rounds to the nearest whole number: 3.5 becomes 4, "
        "3.4 becomes 3, -2.5 becomes -2."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (
                    "FLOAT",
                    {
                        # Wide enough to accept very large numbers (e.g.
                        # seeds, IDs, big counts) without triggering
                        # ComfyUI's out-of-range "Value" popup. 1e15 is
                        # ~1 quadrillion and stays well inside
                        # JavaScript's safe integer range.
                        "default": 1.0,
                        "min": -1.0e15,
                        "max": 1.0e15,
                        "step": 0.1,
                        "tooltip": (
                            "The number to output. Accepts whole numbers, "
                            "decimals, and math expressions like 1024+64 "
                            "or 1024/3. Range is roughly +/- 1 quadrillion."
                        ),
                    },
                ),
            }
        }

    RETURN_TYPES = ("INT", "FLOAT")
    RETURN_NAMES = ("int", "float")
    FUNCTION = "out"
    CATEGORY = "👑 Pixaroma"

    def out(self, value):
        # Defensive: ComfyUI normally guarantees a numeric `value`, but if a
        # wired upstream node sends something unusual (a string, None, NaN,
        # or infinity) we fall back to 0 instead of crashing the workflow.
        try:
            v = float(value)
        except (TypeError, ValueError):
            v = 0.0
        if math.isnan(v) or math.isinf(v):
            v = 0.0
        return (int(round(v)), v)


NODE_CLASS_MAPPINGS = {"PixaromaNumber": PixaromaNumber}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaNumber": "Number Pixaroma"}
