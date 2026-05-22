"""Text Pixaroma - a multi-line text field with a STRING output."""


class PixaromaText:
    DESCRIPTION = (
        "Text Pixaroma - a multi-line text field with a STRING output. "
        "Useful for prompts and any other long text you want to author "
        "in one place and wire into multiple downstream nodes (positive "
        "prompt, negative prompt, captions, instructions, etc.).\n\n"
        "The text field grows with the node: drag the bottom-right "
        "corner to make the field taller or wider when working on a "
        "long prompt.\n\n"
        "Dynamic prompts: write {day|night} and one option is picked at "
        "random each time you queue (nest freely, e.g. {a|{b|c}}). To keep "
        "literal braces in the text, escape them as \\{ and \\}. Comments "
        "are stripped at queue time: // to end of line, and /* ... */ "
        "blocks. The field always shows your raw text; the random pick and "
        "comment removal happen only in what gets sent downstream."
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
                        # Enable ComfyUI's wildcard/dynamic-prompt processing
                        # (resolves {a|b|c} to a random pick + strips // and
                        # /* */ comments) at queue time. Works with our custom
                        # textarea because the raw value is mirrored into this
                        # native (hidden) widget, and ComfyUI applies the
                        # transform during graphToPrompt - no extra wiring.
                        "dynamicPrompts": True,
                        "tooltip": (
                            "The text to output. Supports multiple lines. "
                            "Dynamic prompts: {a|b|c} picks one at random each "
                            "queue; escape literal braces as \\{ \\}. // and "
                            "/* */ comments are stripped when queued. The field "
                            "shows your raw text; resolution happens downstream."
                        ),
                    },
                ),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("The text typed into the field.",)
    FUNCTION = "out"
    CATEGORY = "👑 Pixaroma"

    def out(self, text):
        return (text,)


NODE_CLASS_MAPPINGS = {"PixaromaText": PixaromaText}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaText": "Text Pixaroma"}
