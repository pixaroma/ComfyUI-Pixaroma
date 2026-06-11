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
        "Dynamic prompts switch (OFF by default): when off, the text is "
        "sent exactly as typed and every curly brace is kept, which is what "
        "you want for JSON prompts. Turn the switch on to enable {a|b} "
        "wildcards (one option picked at random each queue, nest freely like "
        "{a|{b|c}}), use \\{ and \\} for literal braces, and strip comments "
        "(// to end of line and /* ... */ blocks)."
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
                        # NOTE: ComfyUI's native `dynamicPrompts: True` is
                        # deliberately NOT set here. It processed EVERY Text
                        # Pixaroma unconditionally and stripped curly braces at
                        # queue time, which silently destroyed JSON prompts.
                        # Dynamic prompts are now an opt-in per-node switch
                        # (default OFF) handled entirely on the frontend - see
                        # the "Dynamic prompts" switch + the graphToPrompt
                        # resolver in js/text/index.js + js/text/dynamic_prompts.mjs.
                        "tooltip": (
                            "The text to output. Supports multiple lines. Sent "
                            "exactly as typed unless the Dynamic prompts switch "
                            "is on - then {a|b} picks one at random each queue "
                            "and // /* */ comments are stripped."
                        ),
                    },
                ),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = (
        "The text from the field, with {a|b} dynamic prompts resolved if the "
        "Dynamic prompts switch is on (otherwise sent exactly as typed).",
    )
    FUNCTION = "out"
    CATEGORY = "👑 Pixaroma"

    def out(self, text):
        return (text,)


NODE_CLASS_MAPPINGS = {"PixaromaText": PixaromaText}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaText": "Text Pixaroma"}
