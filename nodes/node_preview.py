import os
import uuid

import folder_paths
import numpy as np
from PIL import Image

from ._save_helpers import _build_pnginfo, _safe_prefix


def _tensor_to_pil(tensor):
    """Convert a HxWxC float [0,1] tensor frame to a PIL.Image."""
    arr = (tensor.cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
    return Image.fromarray(arr)


class PixaromaPreview:
    """Preview an image (or batch) inline in the node body, with buttons for
    Save-to-Disk and Save-to-Output. The image is also exposed on the output
    edge.

    Modes:
      preview (default): all batch frames are written to ComfyUI's temp/
        directory and shown in the node strip; nothing is saved permanently.
      save:              all batch frames are saved to output/ with embedded
        workflow metadata, exactly like the native SaveImage node, AND still
        shown in the strip preview.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": "Preview"}),
                "save_mode": (["preview", "save"], {"default": "preview"}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "preview"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma"

    def preview(
        self,
        image,
        filename_prefix,
        save_mode,
        prompt=None,
        extra_pnginfo=None,
    ):
        prefix = _safe_prefix(filename_prefix) or "Preview"

        results = []
        if save_mode == "save":
            output_dir = folder_paths.get_output_directory()
            full_folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
                prefix, output_dir, image.shape[2], image.shape[1]
            )
            os.makedirs(full_folder, exist_ok=True)
            for i, tensor in enumerate(image):
                pil = _tensor_to_pil(tensor)
                pnginfo = _build_pnginfo(prompt=prompt, extra_pnginfo=extra_pnginfo)
                fname = f"{name}_{counter + i:05}_.png"
                pil.save(os.path.join(full_folder, fname), "PNG", pnginfo=pnginfo)
                results.append({
                    "filename": fname,
                    "subfolder": subfolder,
                    "type": "output",
                })
        else:  # preview mode
            temp_dir = folder_paths.get_temp_directory()
            os.makedirs(temp_dir, exist_ok=True)
            for tensor in image:
                pil = _tensor_to_pil(tensor)
                fname = f"pixaroma_preview_{uuid.uuid4().hex}.png"
                pil.save(os.path.join(temp_dir, fname), "PNG")
                results.append({
                    "filename": fname,
                    "subfolder": "",
                    "type": "temp",
                })

        return {
            "ui": {"pixaroma_preview_frames": results},
            "result": (image,),
        }


NODE_CLASS_MAPPINGS = {"PixaromaPreview": PixaromaPreview}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPreview": "Preview Image Pixaroma"}
