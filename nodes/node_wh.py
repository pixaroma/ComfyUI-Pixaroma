"""WH Pixaroma - tiny node with two manual fields (width + height) and matching outputs."""


class PixaromaWH:
    DESCRIPTION = (
        "WH Pixaroma - a tiny node with just two number fields for width "
        "and height, and matching width/height outputs. No inputs. Type "
        "the size you want directly on the node.\n\n"
        "Use it when you want to type a target resolution manually and "
        "feed it into something like Switch WH Pixaroma to flip between "
        "manual values and the size coming from another node (for "
        "example, a Load Image's WIDTH/HEIGHT outputs)."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": (
                    "INT",
                    {
                        "default": 1024,
                        "min": 64,
                        "max": 16384,
                        "step": 8,
                        "tooltip": "Output width in pixels. Most AI models work best with multiples of 8.",
                    },
                ),
                "height": (
                    "INT",
                    {
                        "default": 1024,
                        "min": 64,
                        "max": 16384,
                        "step": 8,
                        "tooltip": "Output height in pixels. Most AI models work best with multiples of 8.",
                    },
                ),
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    FUNCTION = "out"
    CATEGORY = "👑 Pixaroma"

    def out(self, width, height):
        return (int(width), int(height))


NODE_CLASS_MAPPINGS = {"PixaromaWH": PixaromaWH}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaWH": "WH Pixaroma"}
