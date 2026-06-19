"""Resize Crop Pixaroma — force an image to an exact width x height by
crop-to-fill (cover). Scales the image so it completely fills the target box,
then center-crops the overflow, so the output is ALWAYS exactly width x height
with no stretching or letterboxing. Width/height are plain number widgets you
can type into OR wire from another node. An optional mask is cropped in sync.

Reuses the shared, JS-mirrored resize engine (_resize_helpers._apply_cover via
_resize_frame) so the crop math matches Image Resize Pixaroma's Crop-to-fill
mode exactly. No custom JS — native widgets render in both Classic and
Nodes 2.0 renderers automatically."""

import numpy as np
import torch
from PIL import Image

from ._resize_helpers import _resize_frame


def _tensor_to_pils(image_t):
    """BHWC float tensor -> list of RGB PIL images. Defensive about channel
    count (1ch grayscale -> RGB, 4ch RGBA -> alpha dropped) so a stray image
    can't crash the run. Mirrors Image Resize Pixaroma's converter."""
    arr = (image_t.clamp(0, 1).cpu().numpy() * 255.0).round().astype(np.uint8)
    out = []
    for frame in arr:
        if frame.ndim == 2:                       # (H,W) grayscale
            frame = np.stack([frame] * 3, axis=-1)
        elif frame.shape[-1] >= 3:                 # RGB / RGBA (drop alpha)
            frame = frame[..., :3]
        else:                                      # 1- or 2-channel -> grayscale
            frame = np.repeat(frame[..., :1], 3, axis=-1)
        out.append(Image.fromarray(frame, "RGB"))
    return out


def _mask_to_pils(mask_t, count, size):
    """BHW float tensor -> list of L PIL images, each conformed to `size` (the
    image size) so the mask always matches the image. Blank (zeros) when
    mask_t is None. NEAREST resize keeps mask edges crisp."""
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


class PixaromaResizeCrop:
    DESCRIPTION = (
        "Crop an image to an exact width and height. The image is scaled to "
        "completely fill the target size, then the overflow is cropped away "
        "from the center, so the result is always exactly the width and height "
        "you set, with no stretching or letterboxing. Smaller images are scaled "
        "up to fill. Type the size into the width and height fields, or wire "
        "them from another node (e.g. Resolution Pixaroma or a Number node). An "
        "optional mask is cropped the same way. Outputs image, mask, width, and "
        "height - handy for forcing image or video frames to a fixed size like "
        "512x896 or 704x1280."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "The image (or batch / video frames) to crop to size."}),
                "width": ("INT", {"default": 1024, "min": 8, "max": 16384, "step": 8, "tooltip": "Target width in pixels. Type a value or wire a number from another node. The arrows step by 8 (AI/video sizes are usually multiples of 8) but you can type any value."}),
                "height": ("INT", {"default": 1024, "min": 8, "max": 16384, "step": 8, "tooltip": "Target height in pixels. Type a value or wire a number from another node. The arrows step by 8 but you can type any value."}),
            },
            "optional": {
                "mask": ("MASK", {"tooltip": "Optional mask. Cropped to the same width and height as the image, with crisp (nearest) edges."}),
            },
        }

    CATEGORY = "👑 Pixaroma/✂️ Resize & Crop"
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "width", "height")
    OUTPUT_TOOLTIPS = (
        "The cropped image, exactly width x height pixels.",
        "The cropped mask, matching the output image size (blank when no mask is wired in).",
        "The output width in pixels.",
        "The output height in pixels.",
    )
    FUNCTION = "run"

    def run(self, image, width, height, mask=None):
        tw = max(8, min(int(width), 16384))
        th = max(8, min(int(height), 16384))

        # Crop-to-fill (cover) via the shared engine: scale to cover, then
        # center-crop the overflow. allow_upscale True so small sources fill
        # the box; snap 0 so the output is EXACTLY tw x th.
        state = {
            "mode": "cover",
            "cover_w": tw,
            "cover_h": th,
            "crop_anchor": "center",
            "crop_scale": True,
            "allow_upscale": True,
            "snap": 0,
            "resample": "auto",
        }

        rgb_frames = _tensor_to_pils(image)
        orig_w, orig_h = rgb_frames[0].size
        mask_frames = _mask_to_pils(mask, len(rgb_frames), (orig_w, orig_h))

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
        # Match the input device so both outputs pair cleanly with GPU-resident
        # tensors downstream (CLAUDE.md Image Crop/Uncrop Pattern #6). No-op for
        # the usual CPU IMAGE case.
        out_image = out_image.to(image.device)
        out_mask = out_mask.to(image.device)
        if final_w is None:
            final_w, final_h = tw, th

        return (out_image, out_mask, final_w, final_h)


NODE_CLASS_MAPPINGS = {"PixaromaResizeCrop": PixaromaResizeCrop}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaResizeCrop": "Resize Crop Pixaroma"}
