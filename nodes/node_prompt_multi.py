"""Prompt Multi Pixaroma - prompt list with two run modes.

Two modes (toggled by the pill at the top of the node body):

QUEUE mode (default):
- One click on Run queues one workflow per ON row, in a loop. Each queue
  item bakes that row's text into the `text` output, so you get N images.
- The `text` output is visible. The `list` output is hidden.

LIST mode:
- One click on Run queues exactly one workflow. The `list` output emits
  the ON rows' prompts as a PIXAROMA_PROMPT_LIST wire. Pair with one or
  more Prompt From List Pixaroma nodes downstream to send different rows
  to different parts of the same workflow.
- The `list` output is visible. The `text` output is hidden.

Backend contract:
- 1 hidden STRING input (PromptMultiState) carrying mode + activePrompt +
  rowTexts (only enabled rows) as JSON. Injected at submission time by
  app.graphToPrompt (Vue Compat #9).
"""
import json


# Custom wire type shared with Prompt From List Pixaroma.
PIXAROMA_PROMPT_LIST = "PIXAROMA_PROMPT_LIST"


class PixaromaPromptMulti:
    DESCRIPTION = (
        "Prompt Multi Pixaroma - one node, two run modes you switch with "
        "the pill at the top.\n\n"
        "Queue mode: click Run and the workflow runs once per enabled "
        "prompt, in a loop. Empty rows are silently skipped. Each prompt "
        "becomes its own item in the queue panel so you can cancel "
        "individually. Use this when you want to compare prompt variants "
        "(one image per prompt).\n\n"
        "List mode: click Run once and the node sends ALL enabled prompts "
        "as a list (no queue loop). Pair with one or more Prompt From "
        "List Pixaroma nodes downstream; each grabs a different prompt by "
        "number. Use this when you want different parts of the same "
        "workflow (scene 1, scene 2, ...) to each pull a different prompt "
        "from the same library, without extra nodes everywhere.\n\n"
        "Click + Add prompt to add a row. Toggle ON/OFF to include/exclude. "
        "Drag the handle to reorder. Clear prompts wipes text but keeps "
        "rows. Reset goes back to two empty rows."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {"PromptMultiState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("STRING", PIXAROMA_PROMPT_LIST)
    RETURN_NAMES = ("text", "list")
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

        active = state.get("activePrompt", "")
        if not isinstance(active, str):
            active = ""

        rows = state.get("rowTexts")
        if not isinstance(rows, list):
            rows = []
        rows = [r if isinstance(r, str) else "" for r in rows]

        return (active, rows)


NODE_CLASS_MAPPINGS = {"PixaromaPromptMulti": PixaromaPromptMulti}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPromptMulti": "Prompt Multi Pixaroma"}
