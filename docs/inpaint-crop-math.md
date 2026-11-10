# Inpaint Crop / Stitch math

Single source of truth for the Inpaint Crop Pixaroma + Inpaint Stitch Pixaroma geometry and seam math. The Python in `nodes/_inpaint_helpers.py` is authoritative (runs at execute time); the JS mirrors it for the editor's live preview. Update this doc first, then both sides.

## 1. Crop region (`compute_region`)

Mirrored 1:1 by `js/inpaint_crop/geometry.mjs::computeRegion`. From the painted mask's bounding box and the image size:

1. Context expand: `rw = bw + 2*max(context_px, blend) + bw*context_pct/100` (same for height). Using `max(context_px, blend)` rather than just `context_px` gives the seam feather room to reach 0 inside the crop, so a big softness grows the crop instead of leaving a hard seam (Option B; see section 3).
2. Place + clamp the SOURCE crop rect inside the image (centred on the mask). In `force` mode the wanted region is first grown to the `target_w/target_h` aspect, then AFTER the clamp the source aspect is re-imposed to that aspect (the W/H clamp can clip one axis and not the other - shrink the over-long axis to the largest aspect-correct rect that fits).
3. Compute the OUTPUT size FROM the clamped source rect (NEVER the un-clamped wanted region), so the crop is resized at its real aspect and is never stretched when the image edge clipped the region (e.g. a big softness on a mask near the border - the source clamps to the image, so the output must too, or the crop/mask comes out squished):
   - `keep`: scale the cropped rect's long side to `target` (respecting `allow_upscale`); then `min_size` FIRST (bump both sides up so the short side reaches `min_size`), then `max_size` LAST as a hard ceiling (so an extreme-aspect crop can't blow the long side past `max_size` into an OOM tensor; the short side may then end below `min_size` - acceptable). Round each side to `multiple`.
   - `force`: the fixed `target_w x target_h` (the source was already re-imposed to that aspect in step 2).
   - `free`: the cropped size rounded to `multiple`, capped at `max_size`.

No accepted drift: the editor's box, rect and output size equal the node's exactly. Two rules make that true. Every rounding in the JS is half-to-even, like Python's `round()` (half-up once made the editor read 904 where the node made 896). And the editor's mask box counts only pixels at alpha >= 128, the node's `mask > 0.5`; counting the brush's faint anti-aliased rim made it 1 px wider each side (728 vs 720).

## 2. Conditioning mask (`apply_inpaint_crop`)

The mask the MODEL sees. `softm` (the `fill_holes`-cleaned + `mask_grow`-dilated core, max'd with the raw painted mask) is cropped to the region, resized NEAREST, then softened by a Gaussian of radius `mask_blur`. NEAREST avoids a second gradient halo; `mask_blur` is the one intended conditioning softening.

`fill_holes` closes only SMALL enclosed specks/gaps (a hole up to ~0.5% of the image: `max(256, 0.005*H*W)` px) — NEVER a large subject-shaped hole. Otherwise a cut-out / background mask (white around a subject) would have its subject hole filled by scipy's `binary_fill_holes` and the whole mask would collapse to solid (so the crop bbox becomes the whole image and the model repaints everything). The no-scipy fallback (a 9px PIL close) is already naturally limited to small holes.

If `invert_mask` is on, `raw` is flipped (`1 - raw`) right after `mask_to_np`, before fill-holes/grow — so the bbox, the conditioning out-mask, AND `crop_info["mask"]` (the stitch blend) all target the OPPOSITE area. It is a no-op when no mask is connected (`mask is None`). It is a mask-processing knob, NOT a geometry param, so it lives in `DEFAULTS` but not in `geometry.mjs`'s `GEO_DEFAULTS` (the editor's live preview does not reflect it - node-only).

`apply_inpaint_crop` first coerces an RGBA input to RGB (premultiply over black: `rgb * alpha`), so `crop_info["image"]` is always 3-channel. A 4-channel cut-out (e.g. Remove Background Pixaroma's `image`) would otherwise make Inpaint Stitch's paste throw on a 3-vs-4 channel mismatch, and the stitch node's `except` silently passes the result through as the "original". Premultiplying over black makes the cut-out read as the subject on black (matching the editor/preview), not the leftover background still under the alpha.

## 3. Seam feather (`_blur_alpha`) — the paste-back blend

This is what the Inpaint Stitch `blend` (the editor's `Softness`) controls. It is an OUTWARD-only feather of the (crisp, grown) mask, NOT a centred one (a centred feather makes the masked content semi-transparent at its own edge = a ghost/halo of the old content).

- Let `k = blend` (px). `k <= 0` returns the mask unchanged (hard seam).
- Binary core `mb = alpha > 0.5`. Empty or full mask returns unchanged.
- With scipy: `signed = dist_in(mb) - dist_out(~mb)`; `t = clip(signed/k + 1, 0, 1)`; `feather = smoothstep(t) = t*t*(3 - 2t)`. So alpha is 1 inside + at the edge, ramping to 0 over `k` px OUTSIDE.
- Without scipy (fallback): `feather = where(mb, 1, gaussian_blur(mb, k/1.7))` — same outward shape, approximate.

The feather is opaque inside by construction (`signed >= 0` -> `t >= 1` -> `smoothstep = 1`), so there is NO core-opaque clamp.

### The feather always has room (Option B)

A feather wider than the context margin used to leave a nonzero alpha at the crop rectangle border = a hard straight line ("high blend = straight edge"). That is now prevented at the SOURCE: `compute_region` expands the context to `max(context_px, blend)` (section 1), so the mask always sits at least `blend` px from the crop edge and the outward feather reaches 0 before the border on its own. The old rect-edge guard (`min(feather, smoothstep(de/k))` plus a `max(.., mask)` core clamp) was removed - growing the crop is cleaner and avoids the guard's failure modes (crushing a too-wide feather; ghosting a mask that sits near the crop edge). Trade-off: a big softness makes the crop a bit larger (visible as the crop box growing in the editor; a small inpaint-resolution cost).

`whole_crop` blend mode uses `_feather_alpha` instead (distance-to-rectangle fade of the whole crop). `_feather_alpha` caps the feather at `~(min(ch,cw)-1)//2` so the interior stays fully opaque: a feather wider than half the crop never reaches 1 anywhere, which would make the WHOLE paste translucent and ghost the original through (reachable on a small crop + a large Stitch softness override).

## 4. Editor live preview (matches the scipy result)

`js/inpaint_crop/render.mjs::_seamAlphaCanvas` mirrors the **scipy smoothstep** of section 3 (not the old no-scipy gaussian): it draws the mask into a downscaled buffer, runs `geometry.mjs::seamAlphaFromAlpha` (a 2-pass `(1, √2)` chamfer distance transform of the OUTSIDE distance, then `alpha = inside ? 1 : smoothstep(clip(1 - d_out/k))`), writes the feathered alpha back, and upscales to the display-res seam canvas. So the editor preview MATCHES the stitched result — a moderate softness no longer looks tighter in the editor than the real seam. The chamfer DT approximates the node's exact Euclidean EDT within a few % (invisible on a soft seam). Downscaled (long side capped at 480px) and computed only on `_draw` (strokes / slider drags, never idle mouse-move), so it stays fast without caching. The tint is filled via `source-in` in the chosen preview color and clipped to the crop region (so it can't spill past the box). The preview color is display-only (never written into the mask, state, or crop_info). In `whole_crop` blend mode `_seamAlphaCanvas` takes a separate branch that paints the inward rectangle-edge ramp of the crop REGION (mirror of `_feather_alpha`), not the mask-edge feather, so the tint matches a whole-crop stitch. The Softness slider calls `_recomputeRegion()` (not just `_draw`) because softness grows the crop box (Option B).

## 5. The settings flow

`softness` (the seam feather = `blend`) is a Crop node INT widget (0-150), mirrored by the editor's Softness slider; `node_inpaint_crop.py::run` feeds it into the crop geometry as `params["blend"]` (so the crop context grows to fit the feather - section 1) AND injects it into `crop_info["blend"]` (clamped 0-150) for the stitch. `blend_mode` (`mask` / `whole crop`) is ALSO a Crop node combo widget now (mirrored by the editor's Blend mode pill, same as the other seam knobs - the node widget is the source of truth; `_BLEND_MODE` maps the friendly label to the internal key). `run` sets `crop_info["blend_mode"]` from the widget (NOT `state_json`). `mask` = only the painted area is replaced; `whole crop` = the entire crop rectangle is replaced (the `_feather_alpha` rectangle fade in `stitch_back`). `node_inpaint_stitch.py` reads `blend` + `blend_mode` from `crop_info` (defaults `16` / `mask` for an Image Crop `crop_info` that lacks them), BUT the Stitch node now has its OWN `softness` (-1 = inherit) + `blend_mode` (`from crop` = inherit) widgets that OVERRIDE crop_info via `resolve_seam(crop_info, softness, blend_mode)`. Because Stitch is downstream of the sampler, changing them re-runs only Stitch (the KSampler stays cached on a fixed seed) - so the seam can be tuned without re-sampling. No room-clamp: a Stitch softness larger than the crop's room may show a slightly harder edge (raise the Crop node's softness for more room); dialing down from the crop's value is always clean.

`color_match` (off/subtle/strong) is the STITCH node's OWN widget, not in `crop_info` (a post-result tweak with no live preview). It shifts the inpainted crop's color stats toward the original over the UNMASKED CONTEXT (the surroundings OUTSIDE the mask) — subtle = match mean, strong = match mean + std. NOT the mask and NOT the whole crop: both include the masked area, so they drag the inpaint's DELIBERATELY changed colors back toward the original (a red->white dress goes pink). Matching the context corrects only the lighting/tone drift in the unchanged surroundings. Falls back to uniform if the mask ~fills the crop (no context). So it is for blending an inpaint INTO the scene, not for deliberate recolors (keep it off for those).

## 6. Notes / caveats

- **MASK is single-frame.** `mask_to_np` collapses a `[B,H,W]` mask to frame 0, so a video / batch crop uses ONE mask (the first frame's) for every frame. The image batch is cropped per-frame with the same rect; only the mask is shared.
- **"Pixel-exact round-trip" is conditional.** Cropping an UN-edited region and stitching it straight back is pixel-exact ONLY in `free` size mode (no resize - and only when the source rect dims are already a `multiple`, so `resize_image_tensor` short-circuits) with `whole_crop` blend mode and `blend = 0` (alpha = 1 everywhere, no feather). `keep` / `force` always resize the crop (so the paste resamples), and any `blend > 0` or `mask` mode feathers the seam - both are intended, not bugs.
- **`crop_info["mask"]` is float32** regardless of the image dtype (the image tensor keeps its own dtype; the carried mask matches `out_mask`).
- **Stitch with no mask edge feathers the whole crop.** If the resolved paste alpha has no edge to soften - an Image Crop `crop_info` whose mask is all-zeros (no mask was wired into Image Crop), an all-ones mask, or a whole-image inpaint with nothing painted - `stitch_back` falls back to the `whole_crop` rectangle feather over the full crop, so the edited crop is still pasted (with a soft seam) instead of pasting nothing (all-zeros) or a hard rectangle (all-ones).
- **The editor's `temp/` source PNG accumulates.** `node_inpaint_crop.py::_save_source_temp` writes one PNG to ComfyUI's `temp/` per run (so the editor can load the upstream pixels of a generative chain). These are cleared on the normal ComfyUI `temp/` lifecycle (restart), not per run.
