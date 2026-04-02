class PixaromaLabel:
    """Annotation label — pure UI node, no image processing."""

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "label_json": ("STRING", {"default": '{"text":"Label Pixaroma","fontSize":18,"fontFamily":"Arial"}', "multiline": True}),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "noop"
    OUTPUT_NODE = True
    CATEGORY = "Pixaroma"

    def noop(self, label_json):
        return {}


NODE_CLASS_MAPPINGS = {
    "PixaromaLabel": PixaromaLabel,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaLabel": "Label Pixaroma",
}
