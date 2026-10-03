"""Prompt Pack Pixaroma - paste-a-block-of-prompts node.

User pastes a block of prompts in the textarea, picks how to split them
via the pill toggle, and clicks Run. The three split modes mirror Save
Text Pixaroma's three separators one for one (see MODES in
js/prompt_pack/core.mjs), so a .txt collected by that node pastes
straight in. The
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
        "Pick how your prompts are separated with the buttons at the top: "
        "Blank line (default, good for long prompts), New line (one prompt "
        "per line, good for short lists), or --- line (a line of dashes "
        "between prompts, for when your prompts contain blank lines of "
        "their own).\n\n"
        "These are the same three choices, with the same names, as the "
        "Separator setting on Save Text Pixaroma. Collect prompts there, "
        "paste the file here, pick the matching button, and you can run them "
        "all again.\n\n"
        "The counter in the bottom-right corner of the textarea shows how "
        "many prompts it found, and counts down as the run works through "
        "them. A number you did not expect means the wrong button is "
        "selected.\n\n"
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
    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"

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
