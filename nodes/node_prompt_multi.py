"""Prompt Multi Pixaroma - row-based prompt list, queues one workflow run per enabled row.

Backend contract:
- 1 hidden STRING input (PromptMultiState) carrying the per-queue-item active prompt as JSON.
- 1 STRING output (text) carrying that active prompt for the current queue item.

All row state, ordering, enabled flags, and the queue-loop logic live in JS
(js/prompt_multi/index.js). Python sees only the resolved active prompt for
the current queue item via the hidden PromptMultiState payload, which is
injected at submission time by app.graphToPrompt (see Vue Compat #9 in CLAUDE.md).

If multiple Prompt Multi nodes exist in one workflow, the JS queue-loop reads
the count from the first one found (by app.graph._nodes iteration order); other
Prompt Multi nodes each use their own currently-selected active row. This is a
v1 decision documented in the design doc.
"""
import json


class PixaromaPromptMulti:
    DESCRIPTION = (
        "Prompt Multi Pixaroma - hold an ordered list of prompt variants you "
        "can toggle on or off, label, and reorder. When you click Run, the "
        "workflow runs once for each enabled prompt that has text in it, and "
        "you get one image per prompt. Each prompt becomes its own item in "
        "the queue panel so you can cancel them individually. Empty rows are "
        "silently skipped even if their toggle is ON.\n\n"
        "Click + Add prompt to add a row. Click the toggle pill to mute or "
        "unmute. Drag the handle on the left to reorder. Clear prompts wipes "
        "all text but keeps rows and toggles. Reset goes back to two empty "
        "rows. If only one row is enabled and non-empty, the node behaves "
        "like a normal prompt. If no enabled rows have text, you will see a "
        "warning and the workflow will not run.\n\n"
        "If you put more than one Prompt Multi node in a workflow, only the "
        "first one (by insertion order) drives the run count; the others use "
        "their currently selected prompt."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {"PromptMultiState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "build"
    CATEGORY = "👑 Pixaroma"

    @classmethod
    def IS_CHANGED(cls, PromptMultiState="{}", **kwargs):
        return PromptMultiState

    def build(self, PromptMultiState="{}"):
        try:
            state = json.loads(PromptMultiState) if PromptMultiState else {}
            if not isinstance(state, dict):
                state = {}
        except (ValueError, TypeError):
            print("[Pixaroma] Prompt Multi: invalid PromptMultiState JSON, returning empty")
            state = {}
        return (state.get("activePrompt", ""),)


NODE_CLASS_MAPPINGS = {"PixaromaPromptMulti": PixaromaPromptMulti}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPromptMulti": "Prompt Multi Pixaroma"}
