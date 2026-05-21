"""Prompt Stack Pixaroma - ordered list of toggle-able prompt chunks joined into one STRING.

Backend contract:
- 1 hidden STRING input (PromptStackState) carrying the row schema + resolved separator.
- 1 STRING output (text) carrying the joined result.

Joining rules (mirrors js/prompt_stack/core.mjs):
- Iterate rows in current visual order (top to bottom).
- Skip disabled rows.
- Use the row's typed text.
- Trim leading/trailing whitespace; strip a single trailing comma so the user can be sloppy.
- Skip empty after cleanup.
- Join with state['separator'] (default ", ").
"""
import json


class PixaromaPromptStack:
    DESCRIPTION = (
        "Prompt Stack Pixaroma - hold an ordered list of prompt chunks you "
        "can toggle on or off, label, and reorder. All enabled chunks are "
        "joined into one STRING output using your chosen separator (default "
        "comma+space, configurable in settings).\n\n"
        "Click + Add row to add a chunk. Click the toggle pill to mute or "
        "unmute a chunk. Drag the handle on the left to reorder."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {"PromptStackState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("All enabled chunks joined into one string using your separator.",)
    FUNCTION = "build"
    CATEGORY = "👑 Pixaroma"

    def build(self, PromptStackState="{}"):
        state = self._parse_state(PromptStackState)
        out_parts = []
        for row in state.get("rows", []):
            if not row.get("enabled"):
                continue
            txt = row.get("text", "") or ""
            txt = txt.strip()
            if txt.endswith(","):
                txt = txt[:-1].rstrip()
            if not txt:
                continue
            out_parts.append(txt)
        sep = state.get("separator", ", ")
        return (sep.join(out_parts),)

    @staticmethod
    def _parse_state(raw):
        try:
            s = json.loads(raw) if isinstance(raw, str) else {}
            return s if isinstance(s, dict) else {}
        except (ValueError, TypeError):
            return {}


NODE_CLASS_MAPPINGS = {"PixaromaPromptStack": PixaromaPromptStack}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPromptStack": "Prompt Stack Pixaroma"}
