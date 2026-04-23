class PixaromaPreview:
    """Preview an image inline in the node body, with buttons for Save-to-Disk
    and Save-to-Output. Implementation of the preview tensor-to-temp logic
    is completed in Task 2; save flows live in the JS side (Tasks 7-8) and
    backend routes (Tasks 4-5)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": "Preview"}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "preview"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/Utils"

    def preview(self, image, filename_prefix):
        # Task 2 replaces this stub with temp-save + UI dict.
        return {"ui": {"images": []}, "result": (image,)}


NODE_CLASS_MAPPINGS = {"PixaromaPreview": PixaromaPreview}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPreview": "Preview Pixaroma"}
