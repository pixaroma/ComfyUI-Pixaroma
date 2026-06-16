# Inpaint Crop / Stitch math

Single source of truth for the Inpaint Crop Pixaroma + Inpaint Stitch Pixaroma geometry and seam math. The Python in `nodes/_inpaint_helpers.py` is authoritative (runs at execute time); the JS mirrors it for the editor's live preview. Update this doc first, then both sides.

## 1. Crop region (`compute_region`)

Mirrored 1:1 by `js/inpaint_crop/geometry.mjs::computeRegion`. From the painted mask's bounding box and the image size:

1. Context expand: `rw = bw + 2*context_px + bw*context_pct/100` (same for height).
2. Size mode:
   - `keep`: scale the long side to `target` (respecting `allow_upscale`). Then apply `min_size` FIRST (bump both sides up so the short side reaches `min_size`), then `max_size` LAST as a hard ceiling. Order matters: for an extreme-aspect (thin-line) mask the `min_size` bump can scale the long side far past `max_size`, so clamping after caps it (the short side may then end up below `min_size` - acceptable, and far better than an out-of-memory tensor). Round each side to `multiple`.
   - `force`: grow the region to the target's aspect (no stretch), output `target_w x target_h` rounded to `multiple`.
   - `free`: natural size rounded to `multiple`, capped at `max_size`.
3. Place + clamp the source rectangle inside the image. In `force` mode, after the image-bound clamp the source rect's aspect is re-imposed to match `out_w/out_h` (shrink the over-long axis to the largest aspect-correct rect that fits) - the independent W/H clamp can otherwise break the aspect on an oblong image, and the resize to `out_w x out_h` would then stretch.

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

## 5. The settings flow

`softness` (the seam feather = `blend`) is a Crop node INT widget (0-150), mirrored by the editor's Softness slider; `node_inpaint_crop.py::run` injects it into `crop_info["blend"]` (clamped 0-150). `blend_mode` is editor-only `state_json` -> `crop_info["blend_mode"]`. `node_inpaint_stitch.py` reads `blend` + `blend_mode` from `crop_info` (defaults `16` / `mask` for an Image Crop `crop_info` that lacks them).

`color_match` (off/subtle/strong) is the STITCH node's OWN widget, not in `crop_info` (a post-result tweak with no live preview). It shifts the inpainted crop's color stats toward the original over the UNMASKED CONTEXT (the surroundings OUTSIDE the mask) — subtle = match mean, strong = match mean + std. NOT the mask and NOT the whole crop: both include the masked area, so they drag the inpaint's DELIBERATELY changed colors back toward the original (a red->white dress goes pink). Matching the context corrects only the lighting/tone drift in the unchanged surroundings. Falls back to uniform if the mask ~fills the crop (no context). So it is for blending an inpaint INTO the scene, not for deliberate recolors (keep it off for those).
