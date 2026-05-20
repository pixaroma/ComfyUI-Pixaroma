"""Load Image Pixaroma — native LoadImage parity + inline resize.

Architecture mirrors Resolution Pixaroma (hidden input + graphToPrompt
injection of state JSON from node.properties). See CLAUDE.md
'Load Image Pixaroma Patterns' for the full design.

The resize engine lives in nodes/_resize_helpers.py (shared with Image Resize
Pixaroma) so the two nodes can never drift apart.
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


DEFAULT_STATE = {
    "version": 1,
    "mode": "off",
    "max_mp": 1.0,
    "longest_side": 1024,
    "scale_factor": 1.0,
    "fit_w": 1024, "fit_h": 1024,
    "cover_w": 1024, "cover_h": 1024,
    "ratio_preset": "1:1",
    "ratio_w": 1, "ratio_h": 1,
    "ratio_action": "crop",
    "pad_color": "#000000",
    "snap": 0,
    "resample": "auto",
    "allow_upscale": True,
}


def _parse_state(state_json: str) -> dict:
    """Parse the hidden LoadImagePixState JSON. Falls back to DEFAULT_STATE
    on any parse error (CLAUDE.md Vue Compat #9 — state may be missing or
    malformed in subgraph / partial-prompt cases)."""
    if not state_json:
        return dict(DEFAULT_STATE)
    try:
        parsed = json.loads(state_json)
        merged = dict(DEFAULT_STATE)
        merged.update({k: v for k, v in parsed.items() if k in DEFAULT_STATE})
        return merged
    except Exception:
        print("[PixaromaLoadImage] Malformed state JSON, using defaults")
        return dict(DEFAULT_STATE)


# ── Node class ───────────────────────────────────────────────────────────────


class PixaromaLoadImage:
    DESCRIPTION = (
        "Load Image Pixaroma - native LoadImage parity (upload, drag-drop, "
        "paste, multi-frame, alpha to mask) plus inline resize: max "
        "megapixels, longest side, scale by, fit inside, crop to fill, "
        "match aspect ratio. Snap chips, resample picker, upscale guard. "
        "Outputs: image, mask, width, height, filename, original_width, "
        "original_height.\n\n"
        "Eliminates the need for downstream Get Image Size + Image Scale + "
        "Image Resize chains in most workflows."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # Walk input/ recursively so subfolders are visible in the dropdown.
        # Native ComfyUI's LoadImage uses os.listdir (root only), which means
        # files inside e.g. input/Studio1/ never appear. Users on shared input
        # folders accumulate subfolders fast, so recursive listing is the
        # expected behaviour. Paths are reported relative to input/, with
        # forward slashes, matching what folder_paths.get_annotated_filepath
        # expects on the read side.
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
                "image": (sorted(files), {"image_upload": True}),
            },
            "hidden": {
                "LoadImagePixState": (
                    "STRING",
                    {"default": json.dumps(DEFAULT_STATE)},
                ),
            },
        }

    CATEGORY = "👑 Pixaroma"
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "STRING", "INT", "INT")
    RETURN_NAMES = (
        "image", "mask", "width", "height",
        "filename", "original_width", "original_height",
    )
    FUNCTION = "load_image"

    def load_image(self, image: str, LoadImagePixState: str = ""):
        image_path = folder_paths.get_annotated_filepath(image)
        img = node_helpers.pillow(Image.open, image_path)

        output_images = []
        output_masks = []
        orig_w = orig_h = None
        final_w = final_h = None

        # Match native LoadImage's tensor dtype so fp16 / bf16 pipelines
        # don't need an extra cast downstream. Fall back to float32 if the
        # comfy import isn't available (unit-test or non-Comfy runtime).
        try:
            import comfy.model_management as _mm
            tensor_dtype = _mm.intermediate_dtype()
        except Exception:
            tensor_dtype = torch.float32

        state = _parse_state(LoadImagePixState)

        for frame in ImageSequence.Iterator(img):
            frame = node_helpers.pillow(ImageOps.exif_transpose, frame)
            if frame.mode == "I":
                frame = frame.point(lambda px: px * (1 / 255))
            rgb = frame.convert("RGB")

            if orig_w is None:
                orig_w, orig_h = rgb.size
            if rgb.size != (orig_w, orig_h):
                continue

            # Build the PIL mask (1 - alpha, or zeros if none).
            if "A" in frame.getbands():
                alpha = np.array(frame.getchannel("A")).astype(np.float32) / 255.0
                mask_pil = Image.fromarray(
                    ((1.0 - alpha) * 255).astype(np.uint8), mode="L"
                )
            elif frame.mode == "P" and "transparency" in frame.info:
                alpha = np.array(
                    frame.convert("RGBA").getchannel("A")
                ).astype(np.float32) / 255.0
                mask_pil = Image.fromarray(
                    ((1.0 - alpha) * 255).astype(np.uint8), mode="L"
                )
            else:
                mask_pil = Image.new("L", rgb.size, 0)

            # Apply resize (Off-mode passthrough until modes fill in).
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
                break  # native LoadImage same: only first frame for MPO

        if len(output_images) == 0:
            # Defensive — never happens for valid PIL images but keeps tensor
            # shapes consistent if we ever hit a pathological file.
            zeros = torch.zeros((1, 64, 64, 3), dtype=tensor_dtype)
            zeros_mask = torch.zeros((1, 64, 64), dtype=tensor_dtype)
            basename = os.path.splitext(os.path.basename(image_path))[0]
            return (zeros, zeros_mask, 64, 64, basename, 64, 64)

        if len(output_images) > 1:
            out_img = torch.cat(output_images, dim=0)
            out_mask = torch.cat(output_masks, dim=0)
        else:
            out_img = output_images[0]
            out_mask = output_masks[0]

        # `final_w` / `final_h` are set by the last frame's resize call. All
        # frames must produce the same dims by construction (same input dims +
        # same state), so this is safe.
        if final_w is None:
            final_w, final_h = orig_w, orig_h

        basename = os.path.splitext(os.path.basename(image_path))[0]
        return (out_img, out_mask, final_w, final_h, basename, orig_w, orig_h)

    @classmethod
    def IS_CHANGED(cls, image, LoadImagePixState=""):
        image_path = folder_paths.get_annotated_filepath(image)
        m = hashlib.sha256()
        with open(image_path, "rb") as f:
            m.update(f.read())
        m.update((LoadImagePixState or "").encode("utf-8"))
        return m.hexdigest()

    @classmethod
    def VALIDATE_INPUTS(cls, image, LoadImagePixState=""):
        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True


NODE_CLASS_MAPPINGS = {"PixaromaLoadImage": PixaromaLoadImage}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaLoadImage": "Load Image Pixaroma"}
