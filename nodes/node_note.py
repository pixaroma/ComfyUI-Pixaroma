class PixaromaNote:
    """Rich annotation note — pure UI node, no image processing."""

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "note_json": (
                    "STRING",
                    {
                        # NOTE: keep backgroundColor in sync with
                        # js/note/index.js DEFAULT_CFG so freshly-added notes
                        # render in the same dark gray as the editor interior.
                        "default": '{"version":1,"content":"","accentColor":"#f66744","backgroundColor":"#0a0a0a","width":420,"height":320}',
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
