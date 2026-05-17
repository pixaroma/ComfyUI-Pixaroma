"""Remove Background Pixaroma - one-node background removal with a built-in
model dropdown.

All the heavy lifting (BiRefNet loader, LRU cache, filename->resolution
rule, sentinel + install message) lives in nodes/_bg_removal_helpers.py
so the /pixaroma/remove_bg route used by Image Composer + Paint can reuse
the exact same code path.
"""

import os

import torch
import folder_paths

from ._bg_removal_helpers import (
    SENTINEL_NO_MODELS,
    _INSTALL_MESSAGE,
    _get_cached_model,
    _list_models,
    _resolution_for_filename,
)


class PixaromaRemoveBackground:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "model": (_list_models(),),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "MASK")
    RETURN_NAMES = ("image", "mask", "inverted_mask")
    FUNCTION = "execute"
    CATEGORY = "👑 Pixaroma"
    DESCRIPTION = (
        "Remove an image background with a BiRefNet model and return the "
        "cutout (RGBA), the foreground mask, and the inverted mask in one "
        "node.\n\n"
        "Models load from ComfyUI/models/background_removal/. Filename "
        "controls preprocessing resolution: 'matt' or 'hr' in the name "
        "(case-insensitive) preprocesses at 2048; all others at 1024. "
        "Recommended names: birefnet.safetensors (standard), "
        "birefnet-hr.safetensors (HR), birefnet-matting.safetensors "
        "(HR matting for hair / fur).\n\n"
        "Downloads:\n"
        "  https://huggingface.co/Comfy-Org/BiRefNet/tree/main/background_removal\n"
        "  https://huggingface.co/ZhengPeng7/BiRefNet_HR\n"
        "  https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting"
    )

    def execute(self, image, model):
        if model == SENTINEL_NO_MODELS:
            raise ValueError(_INSTALL_MESSAGE)

        ckpt_path = folder_paths.get_full_path("background_removal", model)
        if not ckpt_path or not os.path.isfile(ckpt_path):
            raise ValueError(
                f"Remove Background Pixaroma: model file {model!r} not found "
                "in ComfyUI/models/background_removal/. The dropdown may be "
                "stale - reload the page to refresh it."
            )

        image_size = _resolution_for_filename(model)
        bg_model = _get_cached_model(ckpt_path, image_size)

        mask = bg_model.encode_image(image)
        if mask.ndim == 4 and mask.shape[1] == 1:
            mask = mask.squeeze(1)
        elif mask.ndim == 4 and mask.shape[-1] == 1:
            mask = mask.squeeze(-1)

        mask = mask.to(device=image.device, dtype=image.dtype)

        image_rgba = torch.cat([image[..., :3], mask.unsqueeze(-1)], dim=-1)

        inverted = 1.0 - mask
        return (image_rgba, mask, inverted)


NODE_CLASS_MAPPINGS = {
    "PixaromaRemoveBackground": PixaromaRemoveBackground,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaRemoveBackground": "Remove Background Pixaroma",
}
