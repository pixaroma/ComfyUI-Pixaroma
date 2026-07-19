"""Load Image Mini Pixaroma - a slimmed-down Load Image.

Same engine as Load Image Pixaroma (upload / drag-drop / paste / multi-frame /
alpha-to-mask, plus the full inline resize suite minus Pad), but a minimalist
face: a small toolbar, the file picker, the preview, and just TWO outputs -
`image` and a small `image_info` bundle. Wire the bundle into Image Info
Pixaroma when you need mask / width / height / filename, so the loader itself
stays compact.

The resize engine lives in nodes/_resize_helpers.py (shared with Load Image and
Image Resize), and the state parsing is imported from node_load_image so the two
loaders can never drift apart. See .claude/patterns/load-image.md.
"""

import hashlib
import json
import os

import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

import folder_paths
import node_helpers

from ._resize_helpers import _resize_frame
# Reuse Load Image's state parsing verbatim so the resize behaviour is identical
# (_parse_state merges against its DEFAULT_STATE; _parse_orig_name reads the
# non-clipspace name the frontend injects for a stable Filename after masking).
from .node_load_image import _parse_state, _parse_orig_name


class PixaromaLoadImageMini:
    DESCRIPTION = (
        "Load Image Mini Pixaroma - a compact Load Image. Upload, drag-drop, "
        "paste, or pick a file; the same inline resize suite as Load Image "
        "(max megapixels, longest side, scale by, fit inside, crop to fill, "
        "match ratio) lives in the gear settings panel so the node face stays "
        "minimal. Mask Editor and Copy/Paste (Clipspace) work as usual.\n\n"
        "Outputs just image and a small image_info bundle. Wire image_info "
        "into Image Info Pixaroma when you need the mask, width, height, or "
        "filename - that keeps this loader small."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # Walk input/ recursively so subfolders show in the dropdown (same as
        # Load Image Pixaroma - native LoadImage lists the root only).
        input_dir = folder_paths.get_input_directory()
        files = []
        if os.path.isdir(input_dir):
            for root, _dirs, fnames in os.walk(input_dir):
                rel_root = os.path.relpath(root, input_dir)
                for fname in fnames:
                    rel = fname if rel_root == "." else os.path.join(rel_root, fname)
                    files.append(rel.replace("\\", "/"))
        files = folder_paths.filter_files_content_types(files, ["image"])
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True, "tooltip": "The image to load from ComfyUI's input folder. Use the Upload button, the paste button, drag a file onto the node, or pick one from the dropdown."}),
            },
            "hidden": {
                "LoadImageMiniState": (
                    "STRING",
                    {"default": ""},
                ),
            },
        }

    CATEGORY = "👑 Pixaroma/🖼️ Image"
    RETURN_TYPES = ("IMAGE", "PIX_IMAGE_INFO")
    RETURN_NAMES = ("image", "image_info")
    OUTPUT_TOOLTIPS = (
        "The loaded image, after any resize set in the gear panel.",
        "A small bundle (mask, width, height, filename) for Image Info Pixaroma.",
    )
    FUNCTION = "load_image"

    def load_image(self, image: str, LoadImageMiniState: str = ""):
        image_path = folder_paths.get_annotated_filepath(image)
        img = node_helpers.pillow(Image.open, image_path)

        output_images = []
        output_masks = []
        orig_w = orig_h = None
        final_w = final_h = None

        try:
            import comfy.model_management as _mm
            tensor_dtype = _mm.intermediate_dtype()
        except Exception:
            tensor_dtype = torch.float32

        state = _parse_state(LoadImageMiniState)

        # Stable Filename across masking (issue #51 parity): a clipspace copy
        # loads as "clipspace-mask-NNNN.png"; the frontend passes the original
        # name in orig_name so we report THAT instead.
        orig_name = _parse_orig_name(LoadImageMiniState)
        is_clipspace = "clipspace" in image.replace("\\", "/").lower()
        if is_clipspace and orig_name:
            basename = os.path.splitext(os.path.basename(orig_name.replace("\\", "/")))[0]
        else:
            basename = os.path.splitext(os.path.basename(image_path))[0]

        for frame in ImageSequence.Iterator(img):
            frame = node_helpers.pillow(ImageOps.exif_transpose, frame)
            if frame.mode == "I":
                frame = frame.point(lambda px: px * (1 / 255))
            rgb = frame.convert("RGB")

            if orig_w is None:
                orig_w, orig_h = rgb.size
            if rgb.size != (orig_w, orig_h):
                continue

            if "A" in frame.getbands():
                alpha = np.array(frame.getchannel("A")).astype(np.float32) / 255.0
                mask_pil = Image.fromarray(((1.0 - alpha) * 255).astype(np.uint8), mode="L")
            elif frame.mode == "P" and "transparency" in frame.info:
                alpha = np.array(frame.convert("RGBA").getchannel("A")).astype(np.float32) / 255.0
                mask_pil = Image.fromarray(((1.0 - alpha) * 255).astype(np.uint8), mode="L")
            else:
                mask_pil = Image.new("L", rgb.size, 0)

            rgb_resized, mask_resized, frame_w, frame_h = _resize_frame(
                rgb, mask_pil, state, orig_w, orig_h,
            )
            final_w, final_h = frame_w, frame_h

            arr = np.array(rgb_resized).astype(np.float32) / 255.0
            tensor = torch.from_numpy(arr)[None,].to(dtype=tensor_dtype)
            mask_arr = np.array(mask_resized).astype(np.float32) / 255.0
            mask_tensor = torch.from_numpy(mask_arr).unsqueeze(0).to(dtype=tensor_dtype)

            output_images.append(tensor)
            output_masks.append(mask_tensor)

            if img.format == "MPO":
                break

        if len(output_images) == 0:
            zeros = torch.zeros((1, 64, 64, 3), dtype=tensor_dtype)
            zeros_mask = torch.zeros((1, 64, 64), dtype=tensor_dtype)
            info = {"image": zeros, "mask": zeros_mask, "width": 64, "height": 64, "filename": basename}
            return (zeros, info)

        if len(output_images) > 1:
            out_img = torch.cat(output_images, dim=0)
            out_mask = torch.cat(output_masks, dim=0)
        else:
            out_img = output_images[0]
            out_mask = output_masks[0]

        if final_w is None:
            final_w, final_h = orig_w, orig_h

        # The bundle carries everything Image Info Pixaroma needs to unpack.
        # Tensors are references, so this is cheap (no copy).
        info = {
            "image": out_img,
            "mask": out_mask,
            "width": int(final_w),
            "height": int(final_h),
            "filename": basename,
        }
        return (out_img, info)

    @classmethod
    def IS_CHANGED(cls, image, LoadImageMiniState=""):
        image_path = folder_paths.get_annotated_filepath(image)
        m = hashlib.sha256()
        with open(image_path, "rb") as f:
            m.update(f.read())
        # Hash only the RESIZE-relevant state (canonical) + the original-name
        # field, NOT the raw string. A purely-cosmetic frontend key (the accent
        # colour) lives inside the state object; hashing the raw string would let
        # a colour pick invalidate the cache and force a needless re-decode +
        # full downstream re-run. _parse_state keeps only backend keys (accent is
        # not among them); _parse_orig_name preserves the filename-output field.
        state = _parse_state(LoadImageMiniState)
        m.update(json.dumps(state, sort_keys=True).encode("utf-8"))
        m.update((_parse_orig_name(LoadImageMiniState) or "").encode("utf-8"))
        return m.hexdigest()

    @classmethod
    def VALIDATE_INPUTS(cls, image, LoadImageMiniState=""):
        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True


NODE_CLASS_MAPPINGS = {"PixaromaLoadImageMini": PixaromaLoadImageMini}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaLoadImageMini": "Load Image Mini Pixaroma"}
