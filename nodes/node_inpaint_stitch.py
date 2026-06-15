import torch
from ._inpaint_helpers import stitch_back, PIXAROMA_CROP_INFO


class PixaromaInpaintStitch:
    DESCRIPTION = (
        "Inpaint Stitch Pixaroma - paste your inpainted crop back onto the "
        "original image at the exact spot it came from, blended so the seam "
        "disappears.\n\n"
        "Wire the crop_info output of Inpaint Crop Pixaroma into crop_info here, "
        "and wire your inpainted crop (after the model) into image. The node "
        "resizes the crop back to the region and blends only the painted area by "
        "default, so everything outside the mask stays pixel-perfect. 'blend' "
        "feathers the seam; 'color match' nudges the new pixels toward the "
        "original colors to kill any color shift.\n\n"
        "Outputs the finished full image, plus the original uncropped image - wire "
        "both into Image Compare Pixaroma for an instant before / after."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # Slot order image, mask, crop_info lines up under Inpaint Crop's
        # image / mask / crop_info outputs so the wires run straight across.
        return {
            "required": {
                "image": ("IMAGE", {
                    "tooltip": (
                        "Your inpainted crop (after the model). Resized back to the "
                        "original crop region automatically if its size differs."
                    ),
                }),
            },
            "optional": {
                "mask": ("MASK", {
                    "tooltip": (
                        "Optional. Limits the blend to this area (resized to the "
                        "crop region). If omitted, the painted mask carried in "
                        "crop_info is used for the mask-aware blend."
                    ),
                }),
                "crop_info": (PIXAROMA_CROP_INFO, {
                    "tooltip": (
                        "Wire the crop_info output of Inpaint Crop Pixaroma here. "
                        "If left unwired, the image passes straight through."
                    ),
                }),
                "blend": ("INT", {
                    "default": 16, "min": 0, "max": 512, "step": 1,
                    "tooltip": "Feather the seam by this many pixels. 0 = hard edge.",
                }),
                "blend_mode": (["mask", "whole_crop"], {
                    "default": "mask",
                    "tooltip": (
                        "mask: only the painted area changes (rest stays pixel-"
                        "perfect). whole_crop: feather the entire crop rectangle in."
                    ),
                }),
                "color_match": (["off", "subtle", "strong"], {
                    "default": "off",
                    "tooltip": (
                        "Nudge the inpainted colors toward the original region so "
                        "the seam vanishes even on flat skies / walls."
                    ),
                }),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("image", "original")
    OUTPUT_TOOLTIPS = (
        "The original image with the inpainted crop blended back in place.",
        "The full original uncropped image (from crop_info) - wire it together "
        "with the result into Image Compare Pixaroma for a before / after.",
    )
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma"

    def run(self, image, crop_info=None, mask=None, blend=16,
            blend_mode="mask", color_match="off"):
        # No valid crop_info -> nothing to paste back; pass the image through as
        # both the result and the "original" so downstream wiring still works.
        # Require the geometry keys too, so a malformed dict doesn't silently
        # paste at (0,0) full-size instead of erroring visibly.
        if (not isinstance(crop_info, dict)
                or not isinstance(crop_info.get("image"), torch.Tensor)
                or any(k not in crop_info for k in ("x", "y", "w", "h"))):
            print("[PixaromaInpaintStitch] no valid crop_info wired - passing image through")
            return (image, image)

        try:
            result, original = stitch_back(
                crop_info, image, mask, int(blend), str(blend_mode), str(color_match))
        except Exception as e:
            print(f"[PixaromaInpaintStitch] stitch error: {e}")
            return (image, image)
        return (result, original)


NODE_CLASS_MAPPINGS = {
    "PixaromaInpaintStitch": PixaromaInpaintStitch,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaInpaintStitch": "Inpaint Stitch Pixaroma",
}
