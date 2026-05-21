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

    DESCRIPTION = (
        "Preview Image Pixaroma - inline image preview with Save Disk, Save Output, Copy, and Open buttons, "
        "batch-aware. Wire any IMAGE source into the input. All batch frames render in the node body; click any "
        "thumbnail to expand it inline. Arrow keys flip through the batch, click anywhere on the open image to "
        "advance, Esc or X collapses. Toggle Grid / Strip layout via the small icon in the top-right corner of "
        "the preview area.\n\n"
        "Save Disk picks any folder on your computer; the suggested filename auto-increments per click. Save "
        "Output writes to ComfyUI's output/ folder. Copy puts the selected frame on your OS clipboard as PNG so "
        "you can paste straight into another node, paint app, message, etc. Open opens the selected frame in a "
        "new browser tab for full-screen viewing or comparing multiple side by side. All four buttons act on the "
        "currently selected frame; Save Disk and Save Output embed the workflow into the PNG so you can drag it "
        "back into ComfyUI later.\n\n"
        "Flip save_mode to 'save' and the node becomes a drop-in replacement for SaveImage: every batch frame is "
        "automatically written to output/ on each Run with embedded workflow metadata. The preview also survives "
        "workflow tab switching, so you can leave it on a specific frame and come back to it.\n\n"
        "The filename_prefix field supports subfolder syntax with '/' (e.g. 'SDXL/portrait'), date tokens like "
        "VHS / VideoHelperSuite (e.g. '%date:yyyy-MM-dd%/img' -> 'output/2026-05-10/img_00001_.png'), and native "
        "ComfyUI tokens (%year%, %month%, %day%, %hour%, %minute%, %second%, %width%, %height%). Date format codes "
        "are yyyy yy MM dd HH mm ss. See the project README for the full token reference."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Image (or batch) to preview. Each frame appears as a thumbnail in the strip; click one to expand it inline. Wire any IMAGE source here."}),
                "filename_prefix": ("STRING", {"default": "img", "tooltip": (
                    "Filename stem written to output/. The node adds a 5-digit counter and .png. "
                    "Use '/' for subfolders (e.g. 'SDXL/portrait'). "
                    "Supports date tokens like %date:yyyy-MM-dd% (same syntax as VHS / VideoHelperSuite) "
                    "and native ComfyUI tokens like %year%, %month%, %day%. "
                    "See the node's Info panel (right sidebar) for the full token reference and examples."
                )}),
                "save_mode": (["preview", "save"], {"default": "preview", "tooltip": "preview: write each batch frame to ComfyUI's temp/ folder, auto-cleared on restart. Use this while iterating so you don't clutter output/. save: write every batch frame to output/ with embedded workflow metadata, exactly like the native SaveImage node. The on-node preview strip works the same in both modes; the manual Save to Disk / Save to Output buttons are independent of save_mode."}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    OUTPUT_TOOLTIPS = ("The image(s) passed through unchanged, so you can chain a preview inline without breaking the wire.",)
    FUNCTION = "preview"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Always re-execute so each Run re-saves the file and emits fresh
        # frame URLs. Without this, if the user deletes the saved file on
        # disk and clicks Run, ComfyUI's input-hash cache skips execution
        # and the preview shows stale URLs pointing to the deleted file.
        return float("nan")

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
