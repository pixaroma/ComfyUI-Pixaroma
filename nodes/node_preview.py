import os
import uuid
import numpy as np
from PIL import Image
import folder_paths


class PixaromaPreview:
    """Preview an image inline in the node body, with buttons for Save-to-Disk
    and Save-to-Output. The image is also exposed on the output edge."""

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
    CATEGORY = "👑 Pixaroma"

    def preview(self, image, filename_prefix):
        # Only the first frame of the batch is previewed (matches Image Compare).
        # The full batch is still passed through via `result`.
        tensor = image[0]
        arr = (tensor.cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
        pil = Image.fromarray(arr)

        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)
        fname = f"pixaroma_preview_{uuid.uuid4().hex}.png"
        pil.save(os.path.join(temp_dir, fname), "PNG")

        return {
            "ui": {
                "images": [{"filename": fname, "subfolder": "", "type": "temp"}]
            },
            "result": (image,),
        }


NODE_CLASS_MAPPINGS = {"PixaromaPreview": PixaromaPreview}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPreview": "Preview Image Pixaroma"}
