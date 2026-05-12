"""Text Pixaroma - a multi-line text field with a STRING output."""


class PixaromaText:
    DESCRIPTION = (
        "Text Pixaroma - a multi-line text field with a STRING output. "
        "Useful for prompts and any other long text you want to author "
        "in one place and wire into multiple downstream nodes (positive "
        "prompt, negative prompt, captions, instructions, etc.).\n\n"
        "The text field grows with the node: drag the bottom-right "
        "corner to make the field taller or wider when working on a "
        "long prompt."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "tooltip": (
                            "The text to output. Supports multiple lines. "
                            "Type a prompt or any other text here. The "
                            "field grows as you resize the node."
                        ),
                    },
                ),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "out"
    CATEGORY = "👑 Pixaroma"

    def out(self, text):
        return (text,)


NODE_CLASS_MAPPINGS = {"PixaromaText": PixaromaText}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaText": "Text Pixaroma"}
