"""Prompt Pack Pixaroma - paste-a-block-of-prompts node.

User pastes a block of prompts in the textarea, picks how to split them
(blank line or single newline) via the pill toggle, and clicks Run. The
JS app.queuePrompt patch in js/prompt_pack/index.js loops the queue, one
workflow per non-empty parsed prompt, setting state.activePrompt before
each call. The graphToPrompt hook bakes activePrompt into the hidden
PromptPackState input. Python reads it back and returns it as `text`.

If multiple Prompt Pack nodes exist in one workflow, the JS queue-loop
reads the count from the first one found (by app.graph._nodes iteration
order); other Prompt Pack nodes each use their own last-set activePrompt.
Documented behavior, same as Prompt Multi.
"""
import json


class PixaromaPromptPack:
    DESCRIPTION = (
        "Prompt Pack Pixaroma - paste a block of prompts and queue one "
        "workflow run per prompt.\n\n"
        "Pick how to split them with the pill at the top: Paragraph "
        "(default, splits on blank lines, good for long prompts) or Line "
        "(splits on every newline, good for short prompt lists).\n\n"
        "The counter in the bottom-right corner of the textarea shows the "
        "total number of prompts. During a run it switches to current / "
        "total so you can see progress.\n\n"
        "Empty prompts (whitespace only) are silently skipped. If the "
        "textarea is empty when you click Run, nothing queues and a toast "
        "warns you."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {"PromptPackState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("The current prompt for this queue run (one prompt from the block). Wire to CLIP Text Encode.",)
    FUNCTION = "build"
    CATEGORY = "👑 Pixaroma"

    @classmethod
    def IS_CHANGED(cls, PromptPackState="{}", **kwargs):
        return PromptPackState

    def build(self, PromptPackState="{}"):
        try:
            state = json.loads(PromptPackState) if PromptPackState else {}
            if not isinstance(state, dict):
                state = {}
        except (ValueError, TypeError):
            print("[Pixaroma] Prompt Pack: invalid PromptPackState JSON, returning empty")
            state = {}

        active = state.get("activePrompt", "")
        if not isinstance(active, str):
            active = ""

        return (active,)


NODE_CLASS_MAPPINGS = {"PixaromaPromptPack": PixaromaPromptPack}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPromptPack": "Prompt Pack Pixaroma"}
