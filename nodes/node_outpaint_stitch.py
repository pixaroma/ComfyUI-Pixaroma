"""
Outpaint Stitch Pixaroma - put the pristine original back onto an outpaint
result, keeping only the newly generated area from the model.

Outpaint Pixaroma pads an image and (for big sources) scales it DOWN so the
model can work, which softens the ORIGINAL part of the picture on the way
through the VAE encode/decode and the downscale. This node undoes that loss on
the part that never needed to change: it scales the outpaint result back up to
the full padded size and pastes the pristine original back over its own area,
feathering ONLY the edges that border the newly generated region so the seam
blends. The new area stays as the model made it; the original comes back
pixel-for-pixel at full resolution.

Wire the 'outpaint_info' output of Outpaint Pixaroma into 'outpaint_info' here,
and the decoded outpaint result (after VAE Decode) into 'image'.

Pure torch, no disk, no JS - native slots like Image Uncrop Pixaroma. The paste
math + feather ramp mirror node_uncrop.py so the two behave the same.
"""
import torch
import torch.nn.functional as F


# Must match the constant emitted by node_outpaint.py's outpaint_info output.
# Kept as a plain duplicated string (not a cross-file import) to avoid an import
# chain, exactly like PIXAROMA_CROP_INFO across node_crop.py / node_uncrop.py.
PIXAROMA_OUTPAINT_INFO = "PIXAROMA_OUTPAINT_INFO"

# Depth (px) of the seam band sampled for colour matching: a thin strip of the
# pristine original just inside each padded edge vs the generated strip just
# outside it. Deep enough to average out noise on a flat background, shallow
# enough to stay local to the seam. Clamped per side to the pad / original size.
_MATCH_BAND = 24


class PixaromaOutpaintStitch:
    DESCRIPTION = (
        "Puts the pristine original image back onto an outpaint result, keeping "
        "only the part the model newly generated. Use it after Outpaint "
        "Pixaroma when you had to scale a large image down for the model: the "
        "original half comes back at full quality instead of the softened, "
        "downscaled version that went through the model.\n\n"
        "Wire the 'outpaint_info' output of Outpaint Pixaroma into 'outpaint_info' "
        "here, and the finished image (after VAE Decode) into 'image'. The node "
        "scales the result back up to the full padded size, drops the original "
        "back exactly where it was, and blends the join.\n\n"
        "'feather' softens the seam between the original and the new area. The "
        "seam will not be perfectly invisible, because the new area was blended "
        "to a re-encoded copy of the original rather than the pristine one, so a "
        "little feather usually looks best. Only the edges next to the new area "
        "are softened; the real picture edges stay sharp.\n\n"
        "'color match' fixes the faint tone step you can sometimes see where the "
        "new area meets the original on a plain background. It reads the colour "
        "of the original right along the seam and gently shifts the generated "
        "area to match, so the join disappears. 0 turns it off; higher matches "
        "more strongly. It only evens out overall tone, never texture or detail, "
        "so it cannot add artefacts.\n\n"
        "Outputs the recombined full-resolution image, plus a mask marking the "
        "newly generated area (white) versus the untouched original (black) - "
        "handy if you want to run a light refine pass on just the new part later."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # Slot order image, outpaint_info, feather so they line up under Outpaint
        # Pixaroma's image / outpaint_info outputs (wires run straight across).
        # outpaint_info is optional so a mis-wire degrades to a clean passthrough
        # instead of crashing (handled in stitch()).
        return {
            "required": {
                "image": ("IMAGE", {
                    "tooltip": (
                        "The finished outpaint result, after VAE Decode. It is "
                        "scaled back up to the full padded size automatically, so "
                        "it can be the downscaled generation size."
                    ),
                }),
            },
            "optional": {
                "outpaint_info": (PIXAROMA_OUTPAINT_INFO, {
                    "tooltip": (
                        "Wire the 'outpaint_info' output of Outpaint Pixaroma "
                        "here. It carries the pristine original image and where "
                        "it sits in the padded canvas, so the original can be "
                        "put back exactly. If left unwired, the image just "
                        "passes through unchanged."
                    ),
                }),
                "feather": ("INT", {
                    "default": 32, "min": 0, "max": 1024, "step": 1,
                    "tooltip": (
                        "Softens the seam between the original and the newly "
                        "generated area by this many pixels, fading the original "
                        "edge into the new area. 0 = hard edge (fully pristine "
                        "original up to the seam). Higher blends more but eats a "
                        "little of the original at the join."
                    ),
                }),
                "color_match": ("INT", {
                    "default": 60, "min": 0, "max": 100, "step": 1,
                    "display": "slider",
                    "tooltip": (
                        "Removes the faint colour/tone step that can show where "
                        "the newly generated area meets the original on a plain "
                        "background. Samples the original's colour along the seam "
                        "and shifts the generated area to match. 0 = off (leave "
                        "the model's colours untouched), 100 = match fully. It "
                        "only evens out overall tone, so it never changes texture "
                        "or detail and cannot add artefacts."
                    ),
                }),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    OUTPUT_TOOLTIPS = (
        "The full-resolution image: the newly generated area from the model with "
        "the pristine original pasted back over its own region.",
        "A mask of the newly generated area (white = generated, black = the "
        "untouched original), with the seam feathered to match. Feed it into a "
        "refine/inpaint pass if you want to sharpen just the new part.",
    )
    FUNCTION = "stitch"
    CATEGORY = "👑 Pixaroma/✂️ Resize & Crop"

    # ─────────────────────────────────────────────────────────────────────────

    def _resize_bhwc(self, t, target_w, target_h):
        """Resize an image tensor [B,H,W,C] to [B,target_h,target_w,C]. Bilinear,
        matching node_uncrop.py so the two nodes scale identically."""
        x = t.permute(0, 3, 1, 2)  # [B,C,H,W]
        x = F.interpolate(x, size=(int(target_h), int(target_w)),
                          mode="bilinear", align_corners=False)
        return x.permute(0, 2, 3, 1).contiguous()

    def _feather_sides(self, h, w, feather, left, top, right, bottom):
        """Alpha map [h,w] in 0..1: 1.0 in the interior, ramping down to 0 over
        `feather` px inward ONLY from the sides flagged True (the padded edges
        that border the newly generated area). Sides flagged False stay hard -
        they are the real image border, where the original's content runs to the
        edge and must NOT fade into the generated region.

        Same distance-to-edge INWARD ramp as node_uncrop._feather_alpha (which a
        box blur got wrong - it bottomed out at ~0.5 at the edge, a visible 50%
        step), restricted to the chosen sides so the true picture edges stay
        crisp. feather<=0 (or no padded side) = all-ones (hard everywhere)."""
        a = torch.ones((int(h), int(w)), dtype=torch.float32)
        k = int(feather)
        if k <= 0 or not (left or top or right or bottom):
            return a
        hh, ww = int(h), int(w)
        ys = torch.arange(hh, dtype=torch.float32).view(hh, 1)
        xs = torch.arange(ww, dtype=torch.float32).view(1, ww)
        # A distance the ramp can never reach, so an unflagged side never fades.
        big = float(max(hh, ww) + k + 1)
        d_left = xs if left else torch.full((1, ww), big)
        d_right = ((ww - 1) - xs) if right else torch.full((1, ww), big)
        d_top = ys if top else torch.full((hh, 1), big)
        d_bottom = ((hh - 1) - ys) if bottom else torch.full((hh, 1), big)
        # [1,w] min [1,w] -> [1,w]; [h,1] min [h,1] -> [h,1]; then broadcast [h,w].
        dist = torch.minimum(torch.minimum(d_left, d_right),
                             torch.minimum(d_top, d_bottom))
        ramp = (dist / float(k)).clamp(0.0, 1.0)  # 0 at a padded edge -> 1 at k px in
        return (a * ramp).clamp(0.0, 1.0)

    def _passthrough_mask(self, image):
        """All-zero (black = 'original everywhere', nothing generated) mask sized
        to the image, on its device, for the no-info passthrough case."""
        dev = image.device if isinstance(image, torch.Tensor) else "cpu"
        if isinstance(image, torch.Tensor) and image.dim() == 4:
            b, h, w = int(image.shape[0]), int(image.shape[1]), int(image.shape[2])
            return torch.zeros((b, h, w), dtype=torch.float32, device=dev)
        return torch.zeros((1, 1, 1), dtype=torch.float32, device=dev)

    def _seam_color_delta(self, canvas, orig_use, left, top, right, bottom, band):
        """Per-channel tone offset [b,1,1,C] that makes the GENERATED area match
        the PRISTINE original along the seams. For every padded side, sample a
        thin band of the pristine original just INSIDE the seam and the generated
        strip just OUTSIDE it, then return (mean_original - mean_generated) per
        channel per batch item. Adding this to the generated area removes the
        soft tone step that shows on flat backgrounds (the model blended the new
        strip to a re-encoded, downscaled copy of the original, not the pristine
        one). Mean only - no contrast/texture change, so it cannot add artefacts.

        One GLOBAL offset from all seams (not per-side): the tone step on a flat
        fill is uniform, and a single offset keeps left/right/top/bottom in step
        with each other. Longer sides contribute more pixels, so they weigh more.
        Returns None when there is no padded side to sample from.

        Both bands are read from tensors already channel-matched and batch-paired
        to `canvas`, and every slice is clamped to the pad / original size so it
        can never run off the edge. `orig_use` is the pristine original at native
        size sitting at (left, top) in the canvas; its own edges ARE the seam."""
        b = int(canvas.shape[0])
        oh, ow = int(orig_use.shape[1]), int(orig_use.shape[2])
        ch = int(canvas.shape[3])
        gen_parts, orig_parts = [], []
        if left > 0:
            bw = max(1, min(int(band), int(left), ow))
            gen_parts.append(canvas[:, top:top + oh, left - bw:left, :])
            orig_parts.append(orig_use[:, :, 0:bw, :])
        if right > 0:
            bw = max(1, min(int(band), int(right), ow))
            gen_parts.append(canvas[:, top:top + oh, left + ow:left + ow + bw, :])
            orig_parts.append(orig_use[:, :, ow - bw:ow, :])
        if top > 0:
            bh = max(1, min(int(band), int(top), oh))
            gen_parts.append(canvas[:, top - bh:top, left:left + ow, :])
            orig_parts.append(orig_use[:, 0:bh, :, :])
        if bottom > 0:
            bh = max(1, min(int(band), int(bottom), oh))
            gen_parts.append(canvas[:, top + oh:top + oh + bh, left:left + ow, :])
            orig_parts.append(orig_use[:, oh - bh:oh, :, :])
        if not gen_parts:
            return None
        gen_flat = torch.cat([p.reshape(b, -1, ch) for p in gen_parts], dim=1)
        orig_flat = torch.cat([p.reshape(b, -1, ch) for p in orig_parts], dim=1)
        if gen_flat.shape[1] == 0 or orig_flat.shape[1] == 0:
            return None
        delta = orig_flat.mean(dim=1) - gen_flat.mean(dim=1)  # [b, ch]
        return delta.view(b, 1, 1, ch)

    def stitch(self, image, outpaint_info=None, feather=32, color_match=60):
        # No/invalid outpaint_info -> nothing to stitch, so pass the image through
        # with a black mask (never crash on a mis-wire, matching Uncrop).
        if (not isinstance(outpaint_info, dict)
                or not isinstance(outpaint_info.get("original"), torch.Tensor)):
            print("[PixaromaOutpaintStitch] no outpaint_info wired - passing image through")
            return (image, self._passthrough_mask(image))

        original = outpaint_info["original"]
        if original.dim() != 4 or not isinstance(image, torch.Tensor) or image.dim() != 4:
            return (image, self._passthrough_mask(image))

        oh, ow = int(original.shape[1]), int(original.shape[2])  # original H, W
        left = max(0, int(outpaint_info.get("left", 0)))
        top = max(0, int(outpaint_info.get("top", 0)))
        right = max(0, int(outpaint_info.get("right", 0)))
        bottom = max(0, int(outpaint_info.get("bottom", 0)))

        # The full padded canvas the result maps back onto. Computed from the
        # original + the (already _fit_pad-clamped) pads, so it is exactly what
        # _apply_pad built and the paste at (left, top) always lands right. With
        # the megapixel limit ON (the reason this node exists) the pad pass runs
        # unsnapped, so this is pixel-exact; the only drift is the rare no-limit +
        # snap combo, which the feather covers.
        canvas_w = ow + left + right
        canvas_h = oh + top + bottom

        # Upscale the result to the full padded size - the "recover resolution"
        # step. A no-op when the result already IS that size (e.g. no megapixel
        # limit was used).
        canvas = image
        if int(canvas.shape[1]) != canvas_h or int(canvas.shape[2]) != canvas_w:
            canvas = self._resize_bhwc(canvas, canvas_w, canvas_h)

        # Match channels (drop alpha etc.) so the paste lines up.
        orig_use = original
        if canvas.shape[3] != orig_use.shape[3]:
            c = min(int(canvas.shape[3]), int(orig_use.shape[3]))
            canvas = canvas[..., :c]
            orig_use = orig_use[..., :c]

        canvas = canvas.clone()  # we paste into it

        # Batch pairing (Uncrop's approach): align the original batch to the
        # result batch so multi-frame runs pair up instead of crashing.
        b = int(canvas.shape[0])
        ob = int(orig_use.shape[0])
        if ob != b:
            if ob == 1:
                orig_use = orig_use.repeat(b, 1, 1, 1)
            elif b == 1:
                canvas = canvas.repeat(ob, 1, 1, 1)
                b = ob
            else:
                n = min(b, ob)
                canvas = canvas[:n]
                orig_use = orig_use[:n]
                b = n
        orig_use = orig_use.to(canvas.device, canvas.dtype)

        # Optional colour match: BEFORE the paste, nudge the generated area's
        # tone to the pristine original along the seams, killing the soft tone
        # step that shows on flat backgrounds. Mean offset only (see the helper),
        # so no texture/detail change and no artefacts; the feather smooths the
        # rest. strength 0 -> skipped entirely, so the output is byte-identical
        # to the pre-feature node. Shifting the WHOLE canvas is fine: the paste
        # overwrites the original's interior with the pristine copy, and in the
        # feather band the shifted (now tone-matched) generated pixels are
        # exactly what should show through.
        cm = max(0, min(100, int(color_match)))
        if cm > 0:
            delta = self._seam_color_delta(
                canvas, orig_use, left, top, right, bottom, _MATCH_BAND)
            if delta is not None:
                canvas = canvas + delta * (cm / 100.0)

        # Edge-selective feather: fade ONLY the padded sides into the new area.
        alpha = self._feather_sides(oh, ow, feather,
                                    left > 0, top > 0, right > 0, bottom > 0)  # [oh,ow] cpu
        a = alpha[None, ..., None].to(canvas.device, canvas.dtype)  # [1,oh,ow,1]

        region = canvas[:, top:top + oh, left:left + ow, :]
        canvas[:, top:top + oh, left:left + ow, :] = orig_use * a + region * (1.0 - a)

        # Mask: 1 = generated (safe to refine), 0 = pristine original. Over the
        # original rectangle the mask is 1 - alpha, so its interior is 0 and it
        # ramps up to 1 at the generated seam, matching the image blend exactly.
        mask = torch.ones((1, canvas_h, canvas_w), dtype=torch.float32)
        mask[:, top:top + oh, left:left + ow] = (1.0 - alpha)[None, ...]
        mask = mask.clamp(0.0, 1.0).to(canvas.device)
        # [1,H,W] -> [b,H,W]. repeat must take exactly dim() args, or a 4th 1
        # would prepend a dimension and yield a wrong [b,1,H,W] mask.
        if mask.shape[0] == 1 and b > 1:
            mask = mask.repeat(b, 1, 1)

        return (canvas.clamp(0.0, 1.0), mask)


NODE_CLASS_MAPPINGS = {
    "PixaromaOutpaintStitch": PixaromaOutpaintStitch,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaOutpaintStitch": "Outpaint Stitch Pixaroma",
}
