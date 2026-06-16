"""Shared geometry + mask + blend helpers for Inpaint Crop / Inpaint Stitch
Pixaroma.

This module is the SINGLE Python source of truth for the inpaint region math.
`js/inpaint_crop/geometry.mjs` mirrors `compute_region` 1:1 so the editor's live
crop-rectangle preview matches what the node actually produces. The narrative
spec is `docs/inpaint-crop-math.md` - update the doc first, then BOTH
implementations, then eyeball-verify the editor preview against a real run.

Zero extra dependencies: torch + PIL + numpy all come from ComfyUI's environment.
scipy is used ONLY for true hole-filling when present; a PIL morphological close
is the fallback (wrapped in try/except per the offline-first rule).
"""

import math
import numpy as np
import torch
from PIL import Image, ImageFilter

try:
    from scipy import ndimage as _ndimage  # optional, for true binary_fill_holes
    _HAS_SCIPY = True
except Exception:
    _ndimage = None
    _HAS_SCIPY = False


# Must match the constant emitted by node_inpaint_crop.py / consumed by
# node_inpaint_stitch.py - and it is deliberately the SAME string the Image Crop
# / Image Uncrop pair uses, so the two pairs are cross-compatible. Duplicated as a
# plain string (no cross-file import chain), exactly like node_crop / node_uncrop.
PIXAROMA_CROP_INFO = "PIXAROMA_CROP_INFO"

_RESAMPLE = {
    "lanczos": Image.LANCZOS,
    "bicubic": Image.BICUBIC,
    "bilinear": Image.BILINEAR,
    "nearest": Image.NEAREST,
}

# Default knob values. The JS DEFAULT_STATE in js/inpaint_crop/index.js MUST stay
# in sync with these (same risk class as every other Pixaroma node).
DEFAULTS = {
    "size_mode": "keep",        # keep | force | free
    "target": 1024,             # long-side target for keep mode
    "target_w": 1024,           # force mode
    "target_h": 1024,           # force mode
    "multiple": 8,              # 8 | 16 | 32 | 64
    "context_px": 24,           # absolute padding added each side
    "context_pct": 10.0,        # extra padding as a fraction of the bbox (total %)
    "mask_grow": 4,             # dilate the mask before measuring the bbox
    "mask_blur": 4,             # soften the OUTPUT mask edge (conditioning), px
    "fill_holes": True,
    "min_size": 256,
    "max_size": 2048,
    "resample": "lanczos",
    "allow_upscale": True,
}


# ─────────────────────────────────────────────────────────────────────────────
# small utils

def _round_mult(v, m):
    m = max(1, int(m))
    return int(max(m, round(float(v) / m) * m))


def _clampi(v, lo, hi):
    return int(max(lo, min(hi, int(round(v)))))


def merge_params(p):
    """Fill any missing keys from DEFAULTS and coerce types."""
    out = dict(DEFAULTS)
    if isinstance(p, dict):
        out.update({k: p[k] for k in p if k in DEFAULTS})
    out["size_mode"] = str(out["size_mode"]).lower()
    if out["size_mode"] not in ("keep", "force", "free"):
        out["size_mode"] = "keep"
    out["resample"] = str(out["resample"]).lower()
    if out["resample"] not in _RESAMPLE:
        out["resample"] = "lanczos"
    for k in ("target", "target_w", "target_h", "multiple", "context_px",
              "mask_grow", "mask_blur", "min_size", "max_size"):
        out[k] = int(round(float(out[k])))
    out["context_pct"] = float(out["context_pct"])
    out["fill_holes"] = bool(out["fill_holes"])
    out["allow_upscale"] = bool(out["allow_upscale"])
    out["multiple"] = max(1, out["multiple"])
    out["min_size"] = max(8, out["min_size"])
    out["max_size"] = max(out["min_size"], out["max_size"])
    return out


# ─────────────────────────────────────────────────────────────────────────────
# mask helpers (numpy float HxW, 1 = the area to inpaint)

def mask_to_np(mask, h, w):
    """Coerce a ComfyUI MASK ([1,H,W] / [H,W]) to a float HxW numpy in 0..1,
    resized to (h, w) if needed. None -> all zeros."""
    if mask is None:
        return np.zeros((h, w), dtype=np.float32)
    m = mask
    if isinstance(m, torch.Tensor):
        if m.dim() == 4:
            m = m[:, 0] if m.shape[1] == 1 else m[..., 0]
        if m.dim() == 3:
            m = m[0]
        m = m.detach().cpu().float().clamp(0, 1).numpy()
    m = np.asarray(m, dtype=np.float32)
    if m.ndim != 2:
        return np.zeros((h, w), dtype=np.float32)
    if m.shape != (h, w):
        pim = Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8), "L")
        pim = pim.resize((w, h), Image.NEAREST)
        m = np.asarray(pim, dtype=np.float32) / 255.0
    return np.clip(m, 0.0, 1.0)


def _max1d(a, k):
    """1D max filter along axis 1, odd window k, edge-padded. Separable building
    block for a fast box dilation: O(W*H*k) instead of PIL MaxFilter's O(W*H*k^2),
    which hung for ~50s on a large mask_grow."""
    r = k // 2
    ap = np.pad(a, ((0, 0), (r, r)), mode="edge")
    win = np.lib.stride_tricks.sliding_window_view(ap, k, axis=1)
    return win.max(axis=2)


def _dilate(m_bool, px):
    if px <= 0:
        return m_bool
    k = 2 * int(px) + 1
    if _HAS_SCIPY:
        # separable max filter -> O(W*H), fast even for a huge kernel
        return _ndimage.maximum_filter(m_bool, size=k) > 0
    # no-scipy: two separable numpy max passes (rows then cols)
    a = m_bool.astype(np.uint8)
    a = _max1d(a, k)
    a = _max1d(np.ascontiguousarray(a.T), k).T
    return a > 0


def fill_holes(m_bool):
    """Fill enclosed holes in a boolean mask. scipy when available (true fill);
    otherwise a PIL morphological close that fills small/medium holes."""
    if _HAS_SCIPY:
        try:
            return _ndimage.binary_fill_holes(m_bool)
        except Exception:
            pass
    pim = Image.fromarray((m_bool * 255).astype(np.uint8), "L")
    k = 9
    pim = pim.filter(ImageFilter.MaxFilter(k)).filter(ImageFilter.MinFilter(k))
    return np.asarray(pim, dtype=np.uint8) > 127


def gaussian_blur_np(m, px):
    if px <= 0:
        return m
    pim = Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8), "L")
    pim = pim.filter(ImageFilter.GaussianBlur(radius=float(px)))
    return np.asarray(pim, dtype=np.float32) / 255.0


def preprocess_mask(m, p):
    """fill-holes + grow on a 0..1 float mask -> a float mask used for the bbox
    AND carried full-frame into crop_info (the stitch blend feathers it)."""
    mb = m > 0.5
    if p["fill_holes"]:
        mb = fill_holes(mb)
    if p["mask_grow"] > 0:
        mb = _dilate(mb, p["mask_grow"])
    return mb.astype(np.float32)


def mask_bbox(m_bool):
    ys, xs = np.where(m_bool)
    if xs.size == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


# ─────────────────────────────────────────────────────────────────────────────
# THE GEOMETRY (mirror of js/inpaint_crop/geometry.mjs)

def compute_region(bbox, W, H, p):
    """From a mask bbox (x0,y0,x1,y1) and the image size, return the source crop
    region + the model-friendly output size.

    Returns {rx, ry, rw, rh, out_w, out_h}. `r*` are integer SOURCE pixels (the
    rectangle that gets cropped); `out_*` is the size the crop is resized to (and
    the node's width/height outputs). If bbox is None the whole image is used.
    """
    p = merge_params(p)
    W = int(W); H = int(H)
    if bbox is None:
        x0, y0, x1, y1 = 0, 0, W, H
    else:
        x0, y0, x1, y1 = bbox
    bw = max(1.0, float(x1 - x0))
    bh = max(1.0, float(y1 - y0))
    cx = (x0 + x1) / 2.0
    cy = (y0 + y1) / 2.0

    # context expand: context_px each side (total 2*px) + context_pct of bbox total
    rw = bw + 2.0 * p["context_px"] + bw * p["context_pct"] / 100.0
    rh = bh + 2.0 * p["context_px"] + bh * p["context_pct"] / 100.0

    mode = p["size_mode"]
    mult = p["multiple"]

    if mode == "force":
        tw = max(mult, _round_mult(p["target_w"], mult))
        th = max(mult, _round_mult(p["target_h"], mult))
        # grow the region to the target aspect so nothing is stretched
        target_aspect = tw / float(th)
        if rw / rh < target_aspect:
            rw = rh * target_aspect
        else:
            rh = rw / target_aspect
        out_w, out_h = tw, th
    elif mode == "free":
        out_w = _round_mult(rw, mult)
        out_h = _round_mult(rh, mult)
        out_w = min(out_w, _round_mult(p["max_size"], mult))
        out_h = min(out_h, _round_mult(p["max_size"], mult))
    else:  # keep shape, long side -> target
        long_side = max(rw, rh)
        s = p["target"] / long_side if long_side > 0 else 1.0
        if not p["allow_upscale"]:
            s = min(s, 1.0)
        ow = rw * s
        oh = rh * s
        # min_size bump FIRST (scale both up so the short side reaches min_size)...
        small = min(ow, oh)
        if small < p["min_size"]:
            k = p["min_size"] / small
            ow *= k; oh *= k
        # ...then the max_size clamp LAST, as the HARD ceiling. For an extreme-aspect
        # (thin-line) mask the min_size bump can scale the long side far past
        # max_size; clamping after caps it (the short side may then end up < min_size,
        # which is acceptable and far better than an out-of-memory tensor).
        big = max(ow, oh)
        if big > p["max_size"]:
            k = p["max_size"] / big
            ow *= k; oh *= k
        out_w = _round_mult(ow, mult)
        out_h = _round_mult(oh, mult)

    # place + clamp the SOURCE region inside the image
    rw_i = min(int(round(rw)), W)
    rh_i = min(int(round(rh)), H)
    rw_i = max(1, rw_i)
    rh_i = max(1, rh_i)
    if mode == "force":
        # the crop is resized to out_w x out_h, so the SOURCE rect must keep that
        # aspect or an oblong image gets stretched. The image-bound clamp above can
        # break it (one axis clipped, the other not) - shrink the over-long axis back
        # to the target aspect (the largest aspect-correct rect that fits the bounds).
        aspect = out_w / float(out_h)
        if rw_i > rh_i * aspect:
            rw_i = max(1, int(round(rh_i * aspect)))
        else:
            rh_i = max(1, int(round(rw_i / aspect)))
    rx = _clampi(cx - rw_i / 2.0, 0, W - rw_i)
    ry = _clampi(cy - rh_i / 2.0, 0, H - rh_i)

    out_w = max(mult, int(out_w))
    out_h = max(mult, int(out_h))
    return {"rx": rx, "ry": ry, "rw": rw_i, "rh": rh_i,
            "out_w": out_w, "out_h": out_h}


# ─────────────────────────────────────────────────────────────────────────────
# image / mask resize (PIL for quality + Lanczos support)

def resize_image_tensor(t, w, h, resample="lanczos"):
    """[B,H,W,3] float 0..1 -> [B,h,w,3]. PIL per frame (handles Lanczos).
    Short-circuits when the size already matches so an identity crop stays
    pixel-exact (PIL resize to the same size still resamples)."""
    if int(w) == int(t.shape[2]) and int(h) == int(t.shape[1]):
        return t
    filt = _RESAMPLE.get(resample, Image.LANCZOS)
    frames = []
    for i in range(int(t.shape[0])):
        arr = (t[i].clamp(0, 1).cpu().numpy() * 255.0 + 0.5).astype(np.uint8)
        pim = Image.fromarray(arr, "RGB").resize((int(w), int(h)), filt)
        frames.append(np.asarray(pim, dtype=np.float32) / 255.0)
    return torch.from_numpy(np.stack(frames, 0))


def resize_mask_np(m, w, h, resample="bilinear"):
    if int(w) == int(m.shape[1]) and int(h) == int(m.shape[0]):
        return np.clip(m, 0, 1).astype(np.float32)
    filt = _RESAMPLE.get(resample, Image.BILINEAR)
    pim = Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8), "L")
    pim = pim.resize((int(w), int(h)), filt)
    return np.asarray(pim, dtype=np.float32) / 255.0


# ─────────────────────────────────────────────────────────────────────────────
# CROP (called by node_inpaint_crop.py)

def apply_inpaint_crop(image, mask, p):
    """image [B,H,W,3], mask [1,H,W]|None, p = knob dict.

    Returns (cropped_image[B,out_h,out_w,3], out_mask[1,out_h,out_w], crop_info,
    out_w, out_h). out_mask is the conditioning mask (grown + blurred) at output
    resolution; crop_info carries the full original image + full-frame processed
    mask so stitch can paste back + produce a full-frame result.
    """
    p = merge_params(p)
    B, H, W = int(image.shape[0]), int(image.shape[1]), int(image.shape[2])

    raw = mask_to_np(mask, H, W)
    proc = preprocess_mask(raw, p)            # binary core (fill-holes + grow) for the bbox
    bbox = mask_bbox(proc > 0.5)
    # Keep the brush's painted soft edge: the filled+grown core is opaque, the
    # softly-painted rim outside it is preserved (so the soft-edge brush + mask_blur
    # actually reach the conditioning mask instead of being thresholded away).
    softm = np.maximum(raw, proc)
    region = compute_region(bbox, W, H, p)
    rx, ry, rw, rh = region["rx"], region["ry"], region["rw"], region["rh"]
    out_w, out_h = region["out_w"], region["out_h"]

    # crop + resize the image (all batch frames, same rect). Keep the result on
    # the input's device/dtype (the resize routes through PIL on the CPU).
    crop = image[:, ry:ry + rh, rx:rx + rw, :].contiguous()
    cropped_image = resize_image_tensor(crop, out_w, out_h, p["resample"]).to(image.device, image.dtype)

    # resize the mask with NEAREST (bilinear would add its own gradient halo);
    # the mask_blur Gaussian is the ONLY intended softening of the conditioning.
    mreg = softm[ry:ry + rh, rx:rx + rw]
    mout = resize_mask_np(mreg, out_w, out_h, "nearest")
    mout = gaussian_blur_np(mout, p["mask_blur"])
    out_mask = torch.from_numpy(np.clip(mout, 0, 1)[None, ...].astype(np.float32)).to(image.device)

    full_mask = torch.from_numpy(softm[None, ...].astype(np.float32)).to(image.device, image.dtype)
    crop_info = {
        "image": image, "mask": full_mask,
        "x": rx, "y": ry, "w": rw, "h": rh,
        "orig_w": W, "orig_h": H,
    }
    return cropped_image, out_mask, crop_info, out_w, out_h


# ─────────────────────────────────────────────────────────────────────────────
# STITCH (called by node_inpaint_stitch.py)

def _feather_alpha(alpha, feather):
    """Ramp the alpha to 0 at the rectangle edge over `feather` px (distance-to-
    edge), so a pasted crop dissolves into the original. Same idea as Image
    Uncrop's _feather_alpha but operating on an arbitrary [ch,cw] alpha."""
    k = int(feather)
    if k <= 0:
        return alpha
    ch, cw = int(alpha.shape[-2]), int(alpha.shape[-1])
    ys = torch.arange(ch, dtype=torch.float32).view(ch, 1)
    xs = torch.arange(cw, dtype=torch.float32).view(1, cw)
    dist = torch.minimum(torch.minimum(ys, (ch - 1) - ys),
                         torch.minimum(xs, (cw - 1) - xs))
    ramp = (dist / float(k)).clamp(0.0, 1.0)
    return (alpha * ramp).clamp(0.0, 1.0)


def _blur_alpha(alpha, blend):
    """Soften a MASK's edge by `blend` px so the masked paste fades smoothly into
    the surroundings (mask-aware blend). Distinct from _feather_alpha, which fades
    the rectangle boundary (whole-crop mode).

    OUTWARD-only feather: alpha is 1.0 everywhere INSIDE the mask and AT its edge,
    ramping to 0 over `blend` px OUTSIDE. So the new content fully covers the
    masked area (the old content can NEVER show through at the new object's own
    edge) and only the transition into the surroundings is softened. A centred
    feather made the masked edge itself semi-transparent, which read as a soft
    ghost/halo of the old content. Coverage/grow is the crop node's mask_grow
    job; this only softens the outer seam.

    Rect-edge guard: after the outward feather, the OUTWARD part is faded to 0
    within `blend` px of the crop rectangle border (`min(feather, rect_ramp)`), so
    a feather wider than the surrounding context can't leave a hard nonzero alpha
    at the rectangle edge (the "high blend = straight line" bug). The MASK CORE
    stays fully opaque (`max(.., mask)`) - the guard limits only the feather, it
    must never dim the inpaint where the mask sits near the crop edge (the crop
    hugs the mask, so otherwise a big blend would ghost the whole masked object).
    """
    k = int(blend)
    if k <= 0:
        return alpha
    a_np = np.clip(alpha.detach().cpu().numpy(), 0.0, 1.0)
    mb = a_np > 0.5
    if not mb.any() or mb.all():
        return torch.from_numpy(a_np.astype(np.float32))
    if _HAS_SCIPY:
        # signed distance to the mask edge (+ inside, - outside, in px). Map so
        # signed >= 0 -> 1.0 and signed in [-k,0] ramps 1 -> 0 (smoothstep).
        signed = (_ndimage.distance_transform_edt(mb)
                  - _ndimage.distance_transform_edt(~mb))
        t = np.clip(signed / float(k) + 1.0, 0.0, 1.0)
        soft = (t * t * (3.0 - 2.0 * t)).astype(np.float32)
    else:
        # fallback (no scipy): gaussian-blur the binary mask for an outward
        # falloff, then force the interior back to 1.0 (outward-only).
        mbf = mb.astype(np.float32)
        blurred = gaussian_blur_np(mbf, max(1, int(k / 1.7)))
        soft = np.where(mbf > 0.5, 1.0, blurred).astype(np.float32)
    # rect-edge guard (see docstring): fade the feather to 0 within k px of the
    # crop border so it can't paint a hard line along the rectangle edge.
    ch, cw = soft.shape
    ys = np.minimum(np.arange(ch), (ch - 1) - np.arange(ch)).reshape(ch, 1)
    xs = np.minimum(np.arange(cw), (cw - 1) - np.arange(cw)).reshape(1, cw)
    de = np.minimum(ys, xs).astype(np.float32)
    r = np.clip(de / float(k), 0.0, 1.0)
    rect = (r * r * (3.0 - 2.0 * r)).astype(np.float32)
    soft = np.minimum(soft, rect)
    # the rect guard limits only the OUTWARD feather; the mask core stays fully
    # opaque so the inpaint is never dimmed/ghosted near the crop edge.
    soft = np.maximum(soft, mb.astype(np.float32))
    return torch.from_numpy(np.clip(soft, 0.0, 1.0).astype(np.float32))


def _color_match(patch, ref, region_mask, strength):
    """Shift patch color stats toward `ref` within the masked area. strength:
    'subtle' = match mean, 'strong' = match mean + std. patch/ref [ch,cw,3]."""
    if strength == "off":
        return patch
    w = region_mask.reshape(-1, 1)
    wsum = float(w.sum()) + 1e-6
    pf = patch.reshape(-1, 3)
    rf = ref.reshape(-1, 3)
    pm = (pf * w).sum(0) / wsum
    rm = (rf * w).sum(0) / wsum
    if strength == "strong":
        pv = ((pf - pm) ** 2 * w).sum(0) / wsum
        rv = ((rf - rm) ** 2 * w).sum(0) / wsum
        scale = (rv.clamp_min(1e-6).sqrt()) / (pv.clamp_min(1e-6).sqrt())
        scale = scale.clamp(0.5, 2.0)
        out = (pf - pm) * scale + rm
    else:
        out = pf - pm + rm
    return out.reshape(patch.shape).clamp(0.0, 1.0)


def stitch_back(crop_info, image, mask, blend, blend_mode, color_match):
    """Paste the inpainted `image` back onto crop_info['image'] at the recorded
    region, blended seamlessly. Returns (result[B,H,W,3], original[B,H,W,3])."""
    base = crop_info["image"]
    H, W = int(base.shape[1]), int(base.shape[2])
    x = _clampi(crop_info.get("x", 0), 0, W - 1)
    y = _clampi(crop_info.get("y", 0), 0, H - 1)
    cw = int(max(1, min(int(crop_info.get("w", W)), W - x)))
    ch = int(max(1, min(int(crop_info.get("h", H)), H - y)))

    patch = image
    if not isinstance(patch, torch.Tensor) or patch.dim() != 4:
        patch = base.new_zeros((1, ch, cw, base.shape[3]))
    if int(patch.shape[1]) != ch or int(patch.shape[2]) != cw:
        patch = resize_image_tensor(patch, cw, ch, "lanczos").to(base.device, base.dtype)

    # region alpha (1 = take the patch)
    if blend_mode == "whole_crop":
        a = torch.ones((ch, cw), dtype=torch.float32)
    else:  # mask-aware: prefer the wired mask, else the painted mask from crop_info
        if isinstance(mask, torch.Tensor):
            # mask_to_np already resizes to (ch,cw) with NEAREST - keep it crisp;
            # the seam softening is _blur_alpha's job (a bilinear resize here would
            # smear a second gradient on top of the feather = a visible halo).
            a = torch.from_numpy(np.ascontiguousarray(mask_to_np(mask, ch, cw), dtype=np.float32))
        elif isinstance(crop_info.get("mask"), torch.Tensor):
            fm = mask_to_np(crop_info["mask"], H, W)[y:y + ch, x:x + cw]
            a = torch.from_numpy(np.ascontiguousarray(fm, dtype=np.float32))
        else:
            a = torch.ones((ch, cw), dtype=torch.float32)
    # whole_crop: fade the rectangle boundary. mask: soften the mask's OWN edge.
    if blend_mode == "whole_crop":
        a = _feather_alpha(a.clamp(0, 1), blend)
    else:
        a = _blur_alpha(a.clamp(0, 1), blend)

    out = base.clone()
    B = int(out.shape[0])
    if patch.shape[0] != B:
        if patch.shape[0] == 1:
            patch = patch.repeat(B, 1, 1, 1)
        elif B == 1:
            out = out.repeat(patch.shape[0], 1, 1, 1)
            B = patch.shape[0]
        else:
            n = min(B, patch.shape[0])
            print(f"[PixaromaInpaintStitch] batch mismatch: original {B} vs inpainted "
                  f"{patch.shape[0]} - using {n} frames")
            out, patch = out[:n], patch[:n]
            B = n
    patch = patch.to(out.device, out.dtype)

    if color_match and color_match != "off":
        # Reference = the UNMASKED context (the surroundings OUTSIDE the mask), NOT
        # the masked area or the whole crop. Matching to anything that includes the
        # masked area drags the inpaint's DELIBERATELY changed colors back toward the
        # original (a red->white dress goes pink). Matching to the context corrects
        # only the lighting/tone drift the model introduced in the unchanged
        # surroundings, which is what actually makes the seam vanish.
        am = np.clip(a.detach().cpu().numpy(), 0.0, 1.0)
        ctx = (am < 0.5).astype(np.float32)
        if ctx.sum() < 0.02 * ctx.size:   # mask ~fills the crop -> no context to match
            ctx = np.ones_like(am, dtype=np.float32)
        ac = torch.from_numpy(np.ascontiguousarray(ctx))
        for b in range(B):  # match EVERY frame, not just frame 0 (video / batch)
            region_b = out[b, y:y + ch, x:x + cw, :3].detach().cpu()
            p_b = patch[b, :, :, :3].detach().cpu()
            matched = _color_match(p_b, region_b, ac, color_match)
            patch[b, :, :, :3] = matched.to(patch.device, patch.dtype)

    av = a[None, ..., None].to(out.device, out.dtype)
    region = out[:, y:y + ch, x:x + cw, :]
    out[:, y:y + ch, x:x + cw, :] = patch[..., :region.shape[-1]] * av + region * (1.0 - av)

    original = base
    if original.shape[0] != out.shape[0]:
        if original.shape[0] == 1:
            original = original.repeat(out.shape[0], 1, 1, 1)
        else:
            # the result was trimmed to min(B,C) above - trim original to match,
            # or the two outputs would have mismatched batch sizes.
            original = original[:out.shape[0]]
    return out.clamp(0, 1), original.clamp(0, 1)
