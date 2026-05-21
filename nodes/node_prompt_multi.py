"""Prompt Multi Pixaroma - prompt list with two run modes.

Two outputs (both always visible):
- text (STRING): the active row's prompt this queue iteration. Use in
  Queue mode - wire to CLIP Text Encode for one image per enabled row.
- prompts (PIXAROMA_PROMPT_LIST): the list of enabled non-empty rows.
  Use in List mode - wire into Prompt From List Pixaroma nodes
  downstream so different parts of the same workflow can pull different
  prompts from the same library.

Mode toggle (pills at the top of the node body) only controls the queue
loop behavior:
- QUEUE mode (default): click Run -> queue fires N times, one per ON row.
- LIST mode: click Run -> queue fires once normally.

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
        "individually. Wire the `text` output to CLIP Text Encode. Use "
        "this when you want to compare prompt variants (one image per "
        "prompt).\n\n"
        "List mode: click Run once and the node sends ALL enabled prompts "
        "as a list (no queue loop). Wire the `prompts` output into one "
        "or more Prompt From List Pixaroma nodes downstream; each grabs "
        "a different prompt by number. Use this when you want different "
        "parts of the same workflow (scene 1, scene 2, ...) to each pull "
        "a different prompt from the same library, without extra nodes "
        "everywhere.\n\n"
        "Both outputs are always visible - the mode pill just controls "
        "whether the queue loops or not. Click + Add prompt to add a row. "
        "Toggle ON/OFF to include/exclude. Drag the handle to reorder. "
        "Clear prompts wipes text but keeps rows. Reset goes back to two "
        "empty rows."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {"PromptMultiState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("STRING", PIXAROMA_PROMPT_LIST)
    RETURN_NAMES = ("text", "prompts")
    OUTPUT_TOOLTIPS = (
        "The active row's prompt for this queue run. Use in Queue mode - wire to CLIP Text Encode.",
        "The list of all enabled prompts. Use in List mode - wire into Prompt From List Pixaroma nodes.",
    )
    FUNCTION = "build"
    CATEGORY = "👑 Pixaroma"

    @classmethod
    def IS_CHANGED(cls, PromptMultiState="{}", **kwargs):
        # Return NaN so every Run re-executes this node, even when the JSON
        # payload happens to be identical between iterations (e.g. two rows
        # with the same text in queue mode would otherwise hit ComfyUI's
        # cache and return the prior iteration's image instead of rendering
        # again). Same pattern as Notify Pixaroma.
        return float("nan")

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
