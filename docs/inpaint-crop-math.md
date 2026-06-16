# Inpaint Crop / Stitch math

Single source of truth for the Inpaint Crop Pixaroma + Inpaint Stitch Pixaroma geometry and seam math. The Python in `nodes/_inpaint_helpers.py` is authoritative (runs at execute time); the JS mirrors it for the editor's live preview. Update this doc first, then both sides.

## 1. Crop region (`compute_region`)

Mirrored 1:1 by `js/inpaint_crop/geometry.mjs::computeRegion`. From the painted mask's bounding box and the image size:

1. Context expand: `rw = bw + 2*context_px + bw*context_pct/100` (same for height).
2. Size mode:
   - `keep`: scale the long side to `target` (respecting `allow_upscale`, `min_size`, `max_size`), round each side to `multiple`.
   - `force`: grow the region to the target square's aspect (no stretch), output `target x target` rounded to `multiple`.
   - `free`: natural size rounded to `multiple`, capped at `max_size`.
3. Place + clamp the source rectangle inside the image.

Only accepted drift: sub-pixel rect placement (Python banker's rounding vs JS round-half-up = +/-1 px on `rx`/`ry`).

## 2. Conditioning mask (`apply_inpaint_crop`)

The mask the MODEL sees. `softm` (filled + `mask_grow`-dilated core) is cropped to the region, resized NEAREST, then softened by a Gaussian of radius `mask_blur`. NEAREST avoids a second gradient halo; `mask_blur` is the one intended conditioning softening.

## 3. Seam feather (`_blur_alpha`) — the paste-back blend

This is what the Inpaint Stitch `blend` (the editor's `Softness`) controls. It is an OUTWARD-only feather of the (crisp, grown) mask, NOT a centred one (a centred feather makes the masked content semi-transparent at its own edge = a ghost/halo of the old content).

- Let `k = blend` (px). `k <= 0` returns the mask unchanged (hard seam).
- Binary core `mb = alpha > 0.5`. Empty or full mask returns unchanged.
- With scipy: `signed = dist_in(mb) - dist_out(~mb)`; `t = clip(signed/k + 1, 0, 1)`; `feather = smoothstep(t) = t*t*(3 - 2t)`. So alpha is 1 inside + at the edge, ramping to 0 over `k` px OUTSIDE.
- Without scipy (fallback): `feather = where(mb, 1, gaussian_blur(mb, k/1.7))` — same outward shape, approximate.

### Rect-edge guard (the high-blend fix)

A feather wider than the surrounding context margin would otherwise leave a nonzero alpha right at the crop rectangle border = a hard straight line in the result ("high blend = straight edge"). After the feather:

```
de   = distance to the nearest crop-rectangle edge (px)
rect = smoothstep(clip(de / k, 0, 1))
alpha = min(feather, rect)
```

This forces the alpha to 0 within `k` px of the border, so the feather always completes inside the crop. It is a no-op when the feather already reaches 0 before the border (the normal small-blend case); only a mask that genuinely runs to the crop edge is faded there, and only at very large blend.

`whole_crop` blend mode uses `_feather_alpha` instead (distance-to-rectangle fade of the whole crop) and is unaffected by the guard.

## 4. Editor live preview (approximate — F2)

`js/inpaint_crop/render.mjs::_seamAlphaCanvas` mirrors the **no-scipy fallback** of section 3 in canvas: blur the mask by `(blend * displayScale)/1.7`, then draw the crisp mask on top (interior opaque). The tint is filled via `source-in` in the chosen preview color and clipped to the crop region (so it can't spill past the box). It is APPROXIMATE versus the exact scipy run-time path — it shows the seam's softness and width truthfully; exact pixels differ. Do not chase pixel-exactness here. The preview color is display-only (never written into the mask, state, or crop_info).

## 5. The blend settings flow

`blend`, `blend_mode`, `color_match` are set in the editor, saved into the `InpaintCropWidget` `state_json`, read by `node_inpaint_crop.py::run` and injected into `crop_info` (after `apply_inpaint_crop`, which stays geometry-only). `node_inpaint_stitch.py` reads them from `crop_info` (with defaults `blend=16, mask, off` for an Image Crop `crop_info` that lacks them) — the Stitch node has no blend widgets.
