class PixaromaNote:
    """Rich annotation note — pure UI node, no image processing."""

    DESCRIPTION = (
        "Note Pixaroma - a rich-text annotation editor that lives on the canvas. "
        "Open the fullscreen editor to write multi-paragraph notes with bold / "
        "italic / underline / strikethrough, headings (H1 / H2 / H3), bulleted "
        "and numbered lists, code blocks (with copy button), inline icons (CLIP, "
        "LORA, GGUF, model versions, plus 30+ more), tables, separators, "
        "custom-colored buttons (Download / View Page / Read More / plain), "
        "folder hints, plus pre-styled YouTube and Discord buttons.\n\n"
        "Each block carries its own color, picked from a centered modal that "
        "opens over the canvas. A Code view lets you hand-edit the underlying "
        "HTML; a drop-in LLM prompt at assets/note-pixaroma-llm-prompt.txt lets "
        "ChatGPT or Gemini generate Code-view-ready HTML for you.\n\n"
        "Pure annotation - no image processing, no inputs to wire, no outputs "
        "to chain. Saves and restores exactly how you styled it."
    )

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "note_json": (
                    "STRING",
                    {
                        # NOTE: keep in sync with js/note/index.js DEFAULT_CFG.
                        # backgroundColor is INTENTIONALLY omitted — fresh
                        # notes get an `undefined` bg so renderContent
                        # doesn't override ComfyUI's native right-click
                        # Colors menu. parseCfg migrates the legacy
                        # "transparent" / "#111111" values on load.
                        "default": '{"version":1,"content":"","buttonColor":"#f66744","lineColor":"#f66744","width":420,"height":320}',
                        "multiline": True,
                        "tooltip": "Internal serialized HTML + style state for the note. Do not edit directly - click the pencil button on the note to open the editor.",
                    },
                ),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "noop"
    # OUTPUT_NODE intentionally NOT set (defaults to False) so ComfyUI's
    # executor skips Note entirely on Run. The note is pure annotation
    # rendered in JS; there is no Python-side work to do. Skipping
    # execution also stops ComfyUI from drawing an "X.Xs" timing badge
    # above the note on every run, which looks weird on a decorative
    # rich-text annotation.
    CATEGORY = "👑 Pixaroma/📝 Notes & Overlay"

    def noop(self, note_json):
        return {}


NODE_CLASS_MAPPINGS = {
    "PixaromaNote": PixaromaNote,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaNote": "Note Pixaroma",
}
