"""Image Resize Pixaroma — resize a wired image (+ optional mask) using the
shared resize engine. Optional wired width/height drive the target-size modes.
Returns IMAGE, MASK, WIDTH, HEIGHT and ships an `executed` UI payload with
input/output dims + a temp preview PNG so the on-node UI can show the result.
See CLAUDE.md 'Image Resize Pixaroma Patterns'."""

import json
import os
import uuid

import numpy as np
import torch
from PIL import Image

import folder_paths

from ._resize_helpers import _resize_frame, RESIZE_DEFAULTS, parse_resize_state

DEFAULT_STATE = {
    **RESIZE_DEFAULTS,
    "preview_open": False,
}

# Modes that consume an explicit W x H target. Wired width/height feed these.
_WH_MODES = ("fit_inside", "cover")


def _tensor_to_pils(image_t):
    """BHWC float tensor -> list of RGB PIL images."""
    arr = (image_t.clamp(0, 1).cpu().numpy() * 255.0).round().astype(np.uint8)
    return [Image.fromarray(frame, "RGB") for frame in arr]


def _mask_to_pils(mask_t, count, size):
    """BHW float tensor -> list of L PIL images; blank (zeros) if mask_t is None."""
    if mask_t is None:
        return [Image.new("L", size, 0) for _ in range(count)]
    arr = (mask_t.clamp(0, 1).cpu().numpy() * 255.0).round().astype(np.uint8)
    out = [Image.fromarray(m, "L") for m in arr]
    while len(out) < count:
        out.append(Image.new("L", size, 0))
    return out[:count]


def _apply_wired_size(state: dict, width, height, orig_w: int, orig_h: int) -> dict:
    """If width/height INT inputs are wired, override the target size of the
    active W x H mode. Force 'cover' (exact-size, crop overflow) when the active
    mode does not consume W x H. Mirrors the JS auto-switch on connect."""
    if width is None and height is None:
        return state
    mode = state.get("mode", "off")
    if mode == "fit_inside":
        if width is not None:
            state["fit_w"] = int(width)
        if height is not None:
            state["fit_h"] = int(height)
    elif mode == "cover":
        if width is not None:
            state["cover_w"] = int(width)
        if height is not None:
            state["cover_h"] = int(height)
    else:
        state["mode"] = "cover"
        state["cover_w"] = int(width) if width is not None else orig_w
        state["cover_h"] = int(height) if height is not None else orig_h
    return state


class PixaromaImageResize:
    DESCRIPTION = (
        "Image Resize Pixaroma - resize any image mid-workflow with one compact "
        "node. Modes: Off, Max megapixels, Longest side, Scale by, Fit inside, "
        "Crop to fill, Match aspect ratio. Resizes an optional mask alongside "
        "(crisp). Wire a width/height in (e.g. from Resolution Pixaroma) to "
        "resize to an exact size. Foldable result preview. Outputs image, mask, "
        "width, height."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
            },
            "optional": {
                "mask": ("MASK",),
                "width": ("INT", {"forceInput": True}),
                "height": ("INT", {"forceInput": True}),
            },
            "hidden": {
                "ImageResizeState": ("STRING", {"default": json.dumps(DEFAULT_STATE)}),
            },
        }

    CATEGORY = "👑 Pixaroma"
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "width", "height")
    FUNCTION = "resize"

    def resize(self, image, mask=None, width=None, height=None, ImageResizeState=""):
        state = parse_resize_state(ImageResizeState, DEFAULT_STATE)

        rgb_frames = _tensor_to_pils(image)
        orig_w, orig_h = rgb_frames[0].size
        mask_frames = _mask_to_pils(mask, len(rgb_frames), (orig_w, orig_h))

        state = _apply_wired_size(state, width, height, orig_w, orig_h)

        out_imgs, out_masks = [], []
        final_w = final_h = None
        for rgb, m in zip(rgb_frames, mask_frames):
            r_rgb, r_mask, fw, fh = _resize_frame(rgb, m, state, orig_w, orig_h)
            final_w, final_h = fw, fh
            out_imgs.append(
                torch.from_numpy(np.array(r_rgb).astype(np.float32) / 255.0)[None,]
            )
            out_masks.append(
                torch.from_numpy(np.array(r_mask).astype(np.float32) / 255.0)[None,]
            )

        out_image = torch.cat(out_imgs, dim=0) if len(out_imgs) > 1 else out_imgs[0]
        out_mask = torch.cat(out_masks, dim=0) if len(out_masks) > 1 else out_masks[0]
        if final_w is None:
            final_w, final_h = orig_w, orig_h

        ui = self._build_preview_payload(out_imgs[0], orig_w, orig_h, final_w, final_h)
        return {"ui": ui, "result": (out_image, out_mask, final_w, final_h)}

    def _build_preview_payload(self, first_frame_t, in_w, in_h, out_w, out_h):
        """Stash the first resized frame to temp/ and return the executed UI
        payload the JS side reads (Pixaroma-private key, NOT ui.images)."""
        try:
            arr = (first_frame_t[0].clamp(0, 1).cpu().numpy() * 255.0).round().astype(np.uint8)
            pil = Image.fromarray(arr, "RGB")
            temp_dir = folder_paths.get_temp_directory()
            os.makedirs(temp_dir, exist_ok=True)
            fname = f"pixaroma_image_resize_{uuid.uuid4().hex}.png"
            pil.save(os.path.join(temp_dir, fname))
            return {
                "pixaroma_image_resize": [{
                    "in_w": in_w, "in_h": in_h, "out_w": out_w, "out_h": out_h,
                    "filename": fname, "subfolder": "", "type": "temp",
                }]
            }
        except Exception as e:
            print(f"[PixaromaImageResize] preview payload failed: {e}")
            return {
                "pixaroma_image_resize": [{
                    "in_w": in_w, "in_h": in_h, "out_w": out_w, "out_h": out_h,
                }]
            }


NODE_CLASS_MAPPINGS = {"PixaromaImageResize": PixaromaImageResize}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaImageResize": "Image Resize Pixaroma"}
