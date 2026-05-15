"""Remove Background Pixaroma - one-node replacement for ComfyUI's
RemoveBackground + InvertMask + JoinImageWithAlpha chain.

Wire a BACKGROUND_REMOVAL model (from native LoadBackgroundRemovalModel) and
an IMAGE into this node and get three outputs:
    image          - RGBA (foreground opaque, background transparent)
    mask           - foreground=1.0, background=0.0  (BiRefNet sigmoid output)
    inverted_mask  - foreground=0.0, background=1.0  (1.0 - mask)

The model wrapper exposes `encode_image(image)` which does the full
preprocess -> forward -> resize -> sigmoid pipeline. We just normalize the
mask shape and build the RGBA tensor.
"""

import torch


class PixaromaRemoveBackground:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "bg_removal_model": ("BACKGROUND_REMOVAL",),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "MASK")
    RETURN_NAMES = ("image", "mask", "inverted_mask")
    FUNCTION = "execute"
    CATEGORY = "👑 Pixaroma"
    DESCRIPTION = (
        "Remove an image background with a BACKGROUND_REMOVAL model and "
        "return the cutout (RGBA), the foreground mask, and the inverted "
        "mask in one node. Replaces the native Remove Background -> Invert "
        "Mask -> Join Image with Alpha chain."
    )

    def execute(self, image, bg_removal_model):
        # encode_image returns (B, 1, H, W) per ComfyUI's wrapper - normalize
        # to the canonical MASK shape (B, H, W) so downstream consumers don't
        # have to branch on it. (resize_mask in nodes_compositing handles both
        # shapes, but plain mask-math nodes don't always.)
        mask = bg_removal_model.encode_image(image)
        if mask.ndim == 4 and mask.shape[1] == 1:
            mask = mask.squeeze(1)
        elif mask.ndim == 4 and mask.shape[-1] == 1:
            mask = mask.squeeze(-1)

        # Match image device + dtype before concat so the RGBA tensor stays
        # on one device and avoids a float64 promotion on CPU.
        mask = mask.to(device=image.device, dtype=image.dtype)

        # Build RGBA: keep image RGB (drop any pre-existing alpha) and stack
        # the foreground mask as the alpha channel. fg=1 -> opaque, bg=0 ->
        # transparent, matching the standard PNG alpha convention.
        image_rgba = torch.cat([image[..., :3], mask.unsqueeze(-1)], dim=-1)

        inverted = 1.0 - mask
        return (image_rgba, mask, inverted)


NODE_CLASS_MAPPINGS = {
    "PixaromaRemoveBackground": PixaromaRemoveBackground,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaRemoveBackground": "Remove Background Pixaroma",
}
