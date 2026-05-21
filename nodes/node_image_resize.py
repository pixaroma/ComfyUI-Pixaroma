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
    "pad_color": "#808080",  # gray default for Pad (Load Image keeps black)
}

# Modes that consume an explicit W x H target. Wired width/height feed these.
_WH_MODES = ("fit_inside", "cover")


def _tensor_to_pils(image_t):
    """BHWC float tensor -> list of RGB PIL images. Defensive about channel
    count: ComfyUI IMAGE is normally 3-channel, but a stray 1-channel image
    (grayscale, or a mask rewired into the image slot) or a 4-channel RGBA
    tensor must not crash the run. 1ch -> replicated to RGB; 4ch -> alpha
    dropped (the node has a separate mask output)."""
    arr = (image_t.clamp(0, 1).cpu().numpy() * 255.0).round().astype(np.uint8)
    out = []
    for frame in arr:
        if frame.ndim == 2:
            frame = np.stack([frame] * 3, axis=-1)
        elif frame.shape[-1] == 1:
            frame = np.repeat(frame, 3, axis=-1)
        elif frame.shape[-1] >= 4:
            frame = frame[..., :3]
        out.append(Image.fromarray(frame, "RGB"))
    return out


def _mask_to_pils(mask_t, count, size):
    """BHW float tensor -> list of L PIL images, each conformed to `size` (the
    image size) so the mask always matches the image. Blank (zeros) when mask_t
    is None. ComfyUI's LoadImage emits a 64x64 zero mask when the image has no
    alpha, so an incoming mask is frequently the wrong size; resize it (NEAREST,
    to keep crisp edges) up front, otherwise the output mask won't match the
    output image."""
    if mask_t is None:
        return [Image.new("L", size, 0) for _ in range(count)]
    arr = (mask_t.clamp(0, 1).cpu().numpy() * 255.0).round().astype(np.uint8)
    out = []
    for m in arr:
        pim = Image.fromarray(m, "L")
        if pim.size != size:
            pim = pim.resize(size, Image.NEAREST)
        out.append(pim)
    while len(out) < count:
        out.append(Image.new("L", size, 0))
    return out[:count]


def _apply_wired_size(state: dict, width, height, orig_w: int, orig_h: int) -> dict:
    """Wired width/height drive the target size. ONE axis wired = aspect-
    preserving scale to that dimension (the other axis is computed). BOTH wired
    = exact W x H box via the active mode (Fit inside keeps its fit, anything
    else is forced to Crop to fill). Mirrored in JS `effectiveWiredState` -
    keep the two in lockstep."""
    has_w = width is not None
    has_h = height is not None
    if not has_w and not has_h:
        return state

    if has_w != has_h:
        # Exactly one wired -> aspect-preserving scale to that dimension. Reuse
        # the scale_factor path; force allow_upscale since the wire is an
        # explicit target the user asked to hit exactly.
        if has_w:
            factor = (int(width) / orig_w) if orig_w else 1.0
        else:
            factor = (int(height) / orig_h) if orig_h else 1.0
        state["mode"] = "scale_factor"
        state["scale_factor"] = factor
        state["allow_upscale"] = True
        return state

    # Both wired -> exact box.
    if state.get("mode", "off") == "fit_inside":
        state["fit_w"] = int(width)
        state["fit_h"] = int(height)
    else:
        state["mode"] = "cover"
        state["cover_w"] = int(width)
        state["cover_h"] = int(height)
    return state


class PixaromaImageResize:
    DESCRIPTION = (
        "Resize an image (and its mask) mid-workflow. Pick a mode - Off, Max "
        "megapixels, Longest side, Scale by, Fit inside, Crop to fill, Match "
        "aspect ratio, or Pad (add a border for outpainting). Optionally wire a "
        "width/height (e.g. from Resolution Pixaroma) to drive the size. Outputs "
        "image, mask, width, height."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "The image to resize."}),
            },
            "optional": {
                "mask": ("MASK", {"tooltip": "Optional mask. Resized alongside the image with crisp (nearest) edges. In Pad mode the added border becomes white (the inpaint region)."}),
                "width": ("INT", {"forceInput": True, "tooltip": "Optional target width (e.g. from Resolution Pixaroma). Wire only width OR only height to scale keeping aspect ratio; wire both for an exact size. While wired, the matching field is locked."}),
                "height": ("INT", {"forceInput": True, "tooltip": "Optional target height (e.g. from Resolution Pixaroma). Wire only width OR only height to scale keeping aspect ratio; wire both for an exact size. While wired, the matching field is locked."}),
            },
            "hidden": {
                "ImageResizeState": ("STRING", {"default": json.dumps(DEFAULT_STATE)}),
            },
        }

    CATEGORY = "👑 Pixaroma"
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "width", "height")
    OUTPUT_TOOLTIPS = (
        "The resized image.",
        "The resized mask (white = the padded / inpaint area when using Pad).",
        "Final output width in pixels.",
        "Final output height in pixels.",
    )
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
