import torch
import torch.nn.functional as F


# Must match the constant emitted by node_crop.py's crop_info output. Kept as a
# plain duplicated string (not a cross-file import) to avoid an import chain.
PIXAROMA_CROP_INFO = "PIXAROMA_CROP_INFO"


class PixaromaUncrop:
    DESCRIPTION = (
        "Image Uncrop Pixaroma - paste an edited crop back onto the original "
        "image at the exact spot it came from. The classic crop, fix or upscale, "
        "then put it back workflow.\n\n"
        "Wire the 'crop_info' output of Image Crop Pixaroma into 'crop_info' "
        "here, and wire your edited crop (after upscaling, inpainting, color "
        "work, anything) into 'image'. The node resizes the edited crop to the "
        "original crop region if needed and composites it onto the full original "
        "image, leaving everything outside the crop untouched.\n\n"
        "Optional 'mask' limits the paste to part of the crop (white = paste, "
        "black = keep original). 'feather' softens the edge of the pasted area "
        "in pixels for a seamless blend.\n\n"
        "Outputs the recombined full image plus a mask marking where the paste "
        "landed."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # Slot order is image, mask, crop_info so they line up under Image Crop
        # Pixaroma's image/mask/crop_info outputs (wires run straight across).
        # ComfyUI always draws required inputs before optional ones, so to keep
        # that order with mask staying optional, crop_info is optional too - it
        # degrades to a clean passthrough if left unwired (handled in uncrop()).
        return {
            "required": {
                "image": ("IMAGE", {
                    "tooltip": (
                        "The edited crop to paste back (after upscaling, "
                        "inpainting, color work, etc). It is resized to the "
                        "original crop region automatically if its size differs."
                    ),
                }),
            },
            "optional": {
                "mask": ("MASK", {
                    "tooltip": (
                        "Optional. Limits the paste to part of the crop region "
                        "(white = paste the edited crop, black = keep the "
                        "original). Resized to the crop region automatically."
                    ),
                }),
                "crop_info": (PIXAROMA_CROP_INFO, {
                    "tooltip": (
                        "Wire the 'crop_info' output of Image Crop Pixaroma here. "
                        "It carries the original image and where the crop came "
                        "from, so the edited crop can be placed back exactly. "
                        "If left unwired, the edited image just passes through."
                    ),
                }),
                "feather": ("INT", {
                    "default": 0, "min": 0, "max": 1024, "step": 1,
                    "tooltip": (
                        "Softens the edge of the pasted area by this many pixels "
                        "so it blends into the original. 0 = hard edge."
                    ),
                }),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", PIXAROMA_CROP_INFO)
    RETURN_NAMES = ("image", "mask", "crop_info")
    OUTPUT_TOOLTIPS = (
        "The original image with the edited crop pasted back in place.",
        "A full-size mask marking where the paste landed (white = pasted area, "
        "including any feather falloff).",
        "The same crop_info passed straight through, so you can forward it to "
        "another node without re-routing the wire from Image Crop.",
    )
    FUNCTION = "uncrop"
    CATEGORY = "👑 Pixaroma"

    # ─────────────────────────────────────────────────────────────────────────

    def _resize_bhwc(self, t, target_w, target_h):
        """Resize an image tensor [B,H,W,3] to [B,target_h,target_w,3]."""
        x = t.permute(0, 3, 1, 2)  # [B,3,H,W]
        x = F.interpolate(x, size=(int(target_h), int(target_w)),
                          mode="bilinear", align_corners=False)
        return x.permute(0, 2, 3, 1).contiguous()

    def _resize_mask(self, m, target_w, target_h):
        """Resize a mask tensor [B,H,W] to [B,target_h,target_w]."""
        x = m[:, None, ...]  # [B,1,H,W]
        x = F.interpolate(x, size=(int(target_h), int(target_w)),
                          mode="bilinear", align_corners=False)
        return x[:, 0, ...].contiguous()

    def _feather_alpha(self, alpha, feather):
        """Soften the edges of an alpha map [ch,cw] by ~feather px. A box blur
        with zero-padding makes the border fall off to 0, which softens both a
        full-rectangle paste and a provided mask's edges."""
        k = int(feather)
        if k <= 0:
            return alpha
        ch, cw = int(alpha.shape[-2]), int(alpha.shape[-1])
        ksize = k * 2 + 1
        ksize = min(ksize, ch, cw)
        if ksize % 2 == 0:
            ksize -= 1
        if ksize < 3:
            return alpha
        pad = ksize // 2
        a = alpha[None, None, ...]  # [1,1,ch,cw]
        a = F.avg_pool2d(a, kernel_size=ksize, stride=1, padding=pad, count_include_pad=True)
        a = a[0, 0, :ch, :cw]
        return a.clamp(0.0, 1.0)

    def _build_alpha(self, mask, cw, ch, feather):
        """Alpha map [ch,cw] in 0..1 for the paste: from the optional mask (else
        all-ones), with the edges feathered by `feather` px."""
        if isinstance(mask, torch.Tensor):
            m = mask
            if m.dim() == 2:
                m = m[None, ...]
            if m.dim() == 3:
                a = self._resize_mask(m[:1], cw, ch)[0]  # [ch,cw]
            else:
                a = torch.ones((ch, cw), dtype=torch.float32)
        else:
            a = torch.ones((ch, cw), dtype=torch.float32)
        a = a.to(torch.float32)
        return self._feather_alpha(a.clamp(0.0, 1.0), feather)

    def uncrop(self, image, crop_info=None, mask=None, feather=0):
        # Defensive: bad crop_info -> pass the edited image straight through so a
        # mis-wire never crashes the whole workflow.
        if not isinstance(crop_info, dict) or not isinstance(crop_info.get("image"), torch.Tensor):
            print("[PixaromaUncrop] missing/invalid crop_info - passing image through")
            h = int(image.shape[1]) if image.dim() == 4 else 1
            w = int(image.shape[2]) if image.dim() == 4 else 1
            return (image, torch.zeros((1, h, w), dtype=torch.float32), crop_info)

        base = crop_info["image"]
        if base.dim() != 4:
            return (image, torch.zeros((1, 1, 1), dtype=torch.float32), crop_info)

        H, W = int(base.shape[1]), int(base.shape[2])
        x = int(crop_info.get("x", 0))
        y = int(crop_info.get("y", 0))
        cw = int(crop_info.get("w", image.shape[2] if image.dim() == 4 else W))
        ch = int(crop_info.get("h", image.shape[1] if image.dim() == 4 else H))

        # Clamp the paste region to the base image bounds (defensive against a
        # hand-edited / stale crop_info).
        x = max(0, min(x, W - 1))
        y = max(0, min(y, H - 1))
        cw = max(1, min(cw, W - x))
        ch = max(1, min(ch, H - y))

        # Resize the edited crop to exactly fill the original crop region. This
        # handles the common upscale-then-paste-back case (and is a no-op when
        # the crop was edited at its original size).
        patch = image
        if patch.dim() != 4:
            patch = base.new_zeros((1, ch, cw, base.shape[3]))
        if int(patch.shape[1]) != ch or int(patch.shape[2]) != cw:
            patch = self._resize_bhwc(patch, cw, ch)

        # Match the patch's channels to the base (drop alpha, pad gray if needed).
        if patch.shape[3] != base.shape[3]:
            if patch.shape[3] > base.shape[3]:
                patch = patch[..., :base.shape[3]]
            else:
                pad_c = base.shape[3] - patch.shape[3]
                patch = torch.cat([patch, patch[..., -1:].repeat(1, 1, 1, pad_c)], dim=-1)

        # Alpha for the paste, on the base device/dtype.
        alpha = self._build_alpha(mask, cw, ch, feather).to(base.device, base.dtype)
        a = alpha[None, ..., None]  # [1,ch,cw,1] broadcasts over batch + channels

        out = base.clone()
        B = int(out.shape[0])

        # Align the patch batch to the base batch.
        if patch.shape[0] != B:
            if patch.shape[0] == 1:
                patch = patch.repeat(B, 1, 1, 1)
            elif B == 1:
                out = out.repeat(patch.shape[0], 1, 1, 1)
                B = patch.shape[0]
            else:
                n = min(B, patch.shape[0])
                out = out[:n]
                patch = patch[:n]
                B = n

        patch = patch.to(out.device, out.dtype)
        region = out[:, y:y + ch, x:x + cw, :]
        out[:, y:y + ch, x:x + cw, :] = patch * a + region * (1.0 - a)

        out_mask = torch.zeros((1, H, W), dtype=torch.float32)
        out_mask[:, y:y + ch, x:x + cw] = alpha.detach().to("cpu", torch.float32)

        # Pass crop_info straight through so it can be forwarded downstream.
        return (out.clamp(0.0, 1.0), out_mask, crop_info)


NODE_CLASS_MAPPINGS = {
    "PixaromaUncrop": PixaromaUncrop,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaUncrop": "Image Uncrop Pixaroma",
}
