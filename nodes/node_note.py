class PixaromaNote:
    """Rich annotation note — pure UI node, no image processing."""

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
                    },
                ),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "noop"
    OUTPUT_NODE = True
    CATEGORY = "Pixaroma"

    def noop(self, note_json):
        return {}


NODE_CLASS_MAPPINGS = {
    "PixaromaNote": PixaromaNote,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaNote": "Note Pixaroma",
}
