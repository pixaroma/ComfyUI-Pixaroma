"""Shared image-resize engine for Pixaroma nodes.

Single source of truth for resize math used by Load Image Pixaroma AND
Image Resize Pixaroma. Operates on PIL images + a plain state dict so it is
framework-agnostic. JS mirror lives in js/shared/resize_panel.mjs
(previewResize) — keep the two in lockstep (CLAUDE.md Pattern #3 family).
"""

import json
import math
from typing import Tuple

from PIL import Image

# Resize-related defaults shared by both nodes. Each node owns its own
# DEFAULT_STATE that spreads these in (Image Resize adds preview_open + cached
# dims; Load Image keeps its own copy with version/etc).
RESIZE_DEFAULTS = {
    "mode": "off",
    "max_mp": 1.0,
    "longest_side": 1024,
    "scale_factor": 1.0,
    "fit_w": 1024, "fit_h": 1024,
    "cover_w": 1024, "cover_h": 1024,
    "ratio_preset": "1:1",
    "ratio_w": 1, "ratio_h": 1,
    "ratio_action": "crop",
    "pad_color": "#000000",
    "pad_top": 0, "pad_bottom": 0, "pad_left": 0, "pad_right": 0,
    "snap": 0,
    "resample": "auto",
    "allow_upscale": True,
}


def parse_resize_state(state_json: str, defaults: dict) -> dict:
    """Parse a hidden-state JSON string, merging known keys over `defaults`.
    Falls back to a copy of `defaults` on any error (subgraph / partial-prompt
    cases per CLAUDE.md Vue Compat #9)."""
    if not state_json:
        return dict(defaults)
    try:
        parsed = json.loads(state_json)
        merged = dict(defaults)
        merged.update({k: v for k, v in parsed.items() if k in defaults})
        return merged
    except Exception:
        return dict(defaults)


# ── Helpers ─────────────────────────────────────────────────────────────────


def _hex_to_rgb(hex_str: str) -> Tuple[int, int, int]:
    """Parse '#RRGGBB' or '#RGB' into an (R, G, B) int tuple. Falls back to
    black on malformed input."""
    s = (hex_str or "").lstrip("#")
    try:
        if len(s) == 3:
            return tuple(int(c * 2, 16) for c in s)  # type: ignore[return-value]
        if len(s) == 6:
            return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
    except Exception:
        pass
    return (0, 0, 0)


def _pick_resample(mode: str, factor: float):
    """Map state.resample + computed scale factor to a PIL resampling const.
    Auto = Lanczos when shrinking, Bilinear when growing or equal."""
    table = {
        "nearest": Image.NEAREST,
        "bilinear": Image.BILINEAR,
        "bicubic": Image.BICUBIC,
        "lanczos": Image.LANCZOS,
    }
    if mode in table:
        return table[mode]
    return Image.LANCZOS if factor < 1.0 else Image.BILINEAR


def _clamp_dims(w: int, h: int) -> Tuple[int, int]:
    """Final post-resize safety clamp. Floor at 8 (avoid 0-pixel images from
    extreme snap rounding); ceiling at 16384 (prevent OOM crashes)."""
    return (max(8, min(int(w), 16384)), max(8, min(int(h), 16384)))


def _round_half_up(x: float) -> int:
    """JS-parity rounding (always rounds 0.5 UP). Python's built-in round()
    uses banker's rounding (round half to even) so e.g. round(62.5) returns
    62 not 63. JS Math.round always rounds 0.5 toward +infinity. Using this
    helper for factor*dim math keeps the on-canvas preview (JS) and the
    actual workflow output (Python) in sync at exact .5 boundaries."""
    return int(math.floor(x + 0.5))


def _apply_snap(w: int, h: int, snap: int) -> Tuple[int, int]:
    """Floor each dim to a multiple of snap (0 = off). FLOOR not round-to-
    nearest, so the snap step can never push a dim above the cap of a cap-
    bounded mode (max_mp, longest_side, fit_inside). Without floor, snap=64
    on a 1024² source with max 1MP would round 1000 up to 1024, producing
    1.05 MP output and violating the 'Max' promise."""
    if not snap or snap <= 0:
        return (w, h)
    return (max(8, (int(w) // snap) * snap), max(8, (int(h) // snap) * snap))


# ── Per-mode resize functions ────────────────────────────────────────────────


def _resize_frame(
    pil_rgb: Image.Image,
    pil_mask: Image.Image,
    state: dict,
    orig_w: int,
    orig_h: int,
) -> Tuple[Image.Image, Image.Image, int, int]:
    """Apply state['mode'] resize to (pil_rgb, pil_mask). Returns the resized
    PIL images and the final (W, H). pil_mask is always resized with NEAREST
    to preserve hard edges; pil_rgb uses the state['resample'] picker."""

    mode = state.get("mode", "off")

    # Each mode function is responsible for producing (pil_rgb, pil_mask, w, h)
    # already snapped + clamped. Off is the passthrough baseline.
    dispatch = {
        "off": _apply_off,
        "max_mp": _apply_max_mp,
        "longest_side": _apply_longest_side,
        "scale_factor": _apply_scale_factor,
        "fit_inside": _apply_fit_inside,
        "cover": _apply_cover,
        "match_ratio": _apply_match_ratio,
        "pad": _apply_pad,
    }
    fn = dispatch.get(mode, _apply_off)
    return fn(pil_rgb, pil_mask, state, orig_w, orig_h)


def _apply_off(pil_rgb, pil_mask, state, orig_w, orig_h):
    # Even Off honors snap, so the user can use Snap alone as a rounding mode.
    w, h = _apply_snap(orig_w, orig_h, state.get("snap", 0))
    w, h = _clamp_dims(w, h)
    if (w, h) == (orig_w, orig_h):
        return pil_rgb, pil_mask, w, h
    factor = w / orig_w
    resample = _pick_resample(state.get("resample", "auto"), factor)
    return (
        pil_rgb.resize((w, h), resample),
        pil_mask.resize((w, h), Image.NEAREST),
        w, h,
    )


def _apply_max_mp(pil_rgb, pil_mask, state, orig_w, orig_h):
    target = float(state.get("max_mp", 1.0))
    target = max(0.01, min(target, 64.0))  # sanity bounds
    # ComfyUI binary-MP convention: 1 MP = 1024*1024 = 1,048,576 pixels,
    # NOT 1,000,000 (SI MP). Matches native ImageScaleToTotalPixels so a
    # 1024² source at 1 MP passes through unchanged (factor=1.0), keeping
    # latent dimensions on 1024-friendly multiples for SDXL/Flux/etc.
    target_px = target * 1024.0 * 1024.0
    current_px = float(orig_w * orig_h)

    factor = math.sqrt(target_px / current_px) if current_px > 0 else 1.0
    if not state.get("allow_upscale", False):
        factor = min(factor, 1.0)
    factor = min(factor, 8.0)  # sanity ceiling

    new_w = _round_half_up(orig_w * factor)
    new_h = _round_half_up(orig_h * factor)
    new_w, new_h = _apply_snap(new_w, new_h, state.get("snap", 0))
    new_w, new_h = _clamp_dims(new_w, new_h)

    if (new_w, new_h) == (orig_w, orig_h):
        return pil_rgb, pil_mask, new_w, new_h
    resample = _pick_resample(state.get("resample", "auto"), factor)
    return (
        pil_rgb.resize((new_w, new_h), resample),
        pil_mask.resize((new_w, new_h), Image.NEAREST),
        new_w, new_h,
    )


def _apply_longest_side(pil_rgb, pil_mask, state, orig_w, orig_h):
    target = int(state.get("longest_side", 1024))
    target = max(8, min(target, 16384))
    long_dim = max(orig_w, orig_h)
    factor = target / long_dim if long_dim > 0 else 1.0
    if not state.get("allow_upscale", False):
        factor = min(factor, 1.0)
    factor = min(factor, 8.0)

    new_w = _round_half_up(orig_w * factor)
    new_h = _round_half_up(orig_h * factor)
    new_w, new_h = _apply_snap(new_w, new_h, state.get("snap", 0))
    new_w, new_h = _clamp_dims(new_w, new_h)

    if (new_w, new_h) == (orig_w, orig_h):
        return pil_rgb, pil_mask, new_w, new_h
    resample = _pick_resample(state.get("resample", "auto"), factor)
    return (
        pil_rgb.resize((new_w, new_h), resample),
        pil_mask.resize((new_w, new_h), Image.NEAREST),
        new_w, new_h,
    )


def _apply_scale_factor(pil_rgb, pil_mask, state, orig_w, orig_h):
    factor = float(state.get("scale_factor", 1.0))
    factor = max(0.01, factor)
    if not state.get("allow_upscale", False):
        factor = min(factor, 1.0)
    factor = min(factor, 8.0)

    new_w = _round_half_up(orig_w * factor)
    new_h = _round_half_up(orig_h * factor)
    new_w, new_h = _apply_snap(new_w, new_h, state.get("snap", 0))
    new_w, new_h = _clamp_dims(new_w, new_h)

    if (new_w, new_h) == (orig_w, orig_h):
        return pil_rgb, pil_mask, new_w, new_h
    resample = _pick_resample(state.get("resample", "auto"), factor)
    return (
        pil_rgb.resize((new_w, new_h), resample),
        pil_mask.resize((new_w, new_h), Image.NEAREST),
        new_w, new_h,
    )


def _apply_fit_inside(pil_rgb, pil_mask, state, orig_w, orig_h):
    tw = int(state.get("fit_w", 1024))
    th = int(state.get("fit_h", 1024))
    tw = max(8, min(tw, 16384))
    th = max(8, min(th, 16384))

    factor = min(tw / orig_w, th / orig_h)
    if not state.get("allow_upscale", False):
        factor = min(factor, 1.0)
    factor = min(factor, 8.0)

    new_w = _round_half_up(orig_w * factor)
    new_h = _round_half_up(orig_h * factor)
    new_w, new_h = _apply_snap(new_w, new_h, state.get("snap", 0))
    new_w, new_h = _clamp_dims(new_w, new_h)

    if (new_w, new_h) == (orig_w, orig_h):
        return pil_rgb, pil_mask, new_w, new_h
    resample = _pick_resample(state.get("resample", "auto"), factor)
    return (
        pil_rgb.resize((new_w, new_h), resample),
        pil_mask.resize((new_w, new_h), Image.NEAREST),
        new_w, new_h,
    )


def _apply_cover(pil_rgb, pil_mask, state, orig_w, orig_h):
    tw = int(state.get("cover_w", 1024))
    th = int(state.get("cover_h", 1024))
    tw = max(8, min(tw, 16384))
    th = max(8, min(th, 16384))

    factor = max(tw / orig_w, th / orig_h)
    allow_upscale = state.get("allow_upscale", False)

    if not allow_upscale and factor > 1.0:
        # Degrade: image too small to fill target without upscaling. Fall
        # back to Fit-inside math so the user gets a clean output instead of
        # an error. MUST pass cover_w/cover_h as the target via a fit_w/fit_h
        # alias — _apply_fit_inside reads fit_w/fit_h, NOT cover_w/cover_h.
        # Without this aliasing the user's Crop-to-fill target dims were
        # silently replaced by their separate Fit-inside settings, causing
        # the JS preview readout to disagree with the Python output.
        fallback_state = {**state, "fit_w": tw, "fit_h": th}
        return _apply_fit_inside(pil_rgb, pil_mask, fallback_state, orig_w, orig_h)

    factor = min(factor, 8.0)

    # Step 1: resize the source up/down by `factor` so one dim matches the
    # target and the other overflows.
    scaled_w = _round_half_up(orig_w * factor)
    scaled_h = _round_half_up(orig_h * factor)
    resample = _pick_resample(state.get("resample", "auto"), factor)
    rgb_scaled = pil_rgb.resize((scaled_w, scaled_h), resample)
    mask_scaled = pil_mask.resize((scaled_w, scaled_h), Image.NEAREST)

    # Step 2: center-crop scaled image to (tw, th).
    left = (scaled_w - tw) // 2
    top = (scaled_h - th) // 2
    right = left + tw
    bottom = top + th
    rgb_cropped = rgb_scaled.crop((left, top, right, bottom))
    mask_cropped = mask_scaled.crop((left, top, right, bottom))

    # Snap on final dims (post-crop). Snap may further resize.
    final_w, final_h = _apply_snap(tw, th, state.get("snap", 0))
    final_w, final_h = _clamp_dims(final_w, final_h)
    if (final_w, final_h) != (tw, th):
        rgb_cropped = rgb_cropped.resize((final_w, final_h), resample)
        mask_cropped = mask_cropped.resize((final_w, final_h), Image.NEAREST)

    return rgb_cropped, mask_cropped, final_w, final_h


def _apply_match_ratio(pil_rgb, pil_mask, state, orig_w, orig_h):
    rw = max(1, int(state.get("ratio_w", 1)))
    rh = max(1, int(state.get("ratio_h", 1)))
    action = state.get("ratio_action", "crop")

    target_aspect = rw / rh
    current_aspect = orig_w / orig_h

    if action == "crop":
        if current_aspect > target_aspect:
            # Wider than target — crop sides
            new_w = _round_half_up(orig_h * target_aspect)
            new_h = orig_h
        else:
            # Taller than target — crop top/bottom
            new_w = orig_w
            new_h = _round_half_up(orig_w / target_aspect)
        new_w = max(1, new_w)
        new_h = max(1, new_h)
        left = (orig_w - new_w) // 2
        top = (orig_h - new_h) // 2
        rgb_out = pil_rgb.crop((left, top, left + new_w, top + new_h))
        mask_out = pil_mask.crop((left, top, left + new_w, top + new_h))
    else:
        # action == "pad"
        if current_aspect > target_aspect:
            # Wider than target — pad top/bottom
            new_w = orig_w
            new_h = _round_half_up(orig_w / target_aspect)
        else:
            # Taller than target — pad sides
            new_w = _round_half_up(orig_h * target_aspect)
            new_h = orig_h
        new_w = max(1, new_w)
        new_h = max(1, new_h)
        pad_color = _hex_to_rgb(state.get("pad_color", "#000000"))
        rgb_out = Image.new("RGB", (new_w, new_h), pad_color)
        # Mask gets opaque (mask=1, since fill is non-image area; matches
        # native LoadImageMask convention that 1=masked/opaque-area).
        mask_out = Image.new("L", (new_w, new_h), 255)
        offset_x = (new_w - orig_w) // 2
        offset_y = (new_h - orig_h) // 2
        rgb_out.paste(pil_rgb, (offset_x, offset_y))
        # The original image area gets the original mask values pasted on top.
        mask_out.paste(pil_mask, (offset_x, offset_y))

    # Snap to final dims (may slightly drift ratio, documented in spec).
    final_w, final_h = _apply_snap(new_w, new_h, state.get("snap", 0))
    final_w, final_h = _clamp_dims(final_w, final_h)

    if (final_w, final_h) != (new_w, new_h):
        # Snap nudged dims — resize the crop/pad result.
        factor = final_w / new_w
        resample = _pick_resample(state.get("resample", "auto"), factor)
        rgb_out = rgb_out.resize((final_w, final_h), resample)
        mask_out = mask_out.resize((final_w, final_h), Image.NEAREST)

    return rgb_out, mask_out, final_w, final_h


def _apply_pad(pil_rgb, pil_mask, state, orig_w, orig_h):
    """Pixel padding for inpainting / outpainting. Adds the requested pixel
    counts to each side, fills the new border with pad_color, and marks the
    padded border white (255 = 1.0, the inpaint region) while the original
    image area keeps its own mask values. Snap / clamp applied to final dims."""
    pt = max(0, int(state.get("pad_top", 0)))
    pb = max(0, int(state.get("pad_bottom", 0)))
    pl = max(0, int(state.get("pad_left", 0)))
    pr = max(0, int(state.get("pad_right", 0)))

    new_w = orig_w + pl + pr
    new_h = orig_h + pt + pb

    if pl == pr == pt == pb == 0:
        # Nothing to pad — honor snap like Off, otherwise passthrough.
        sw, sh = _apply_snap(orig_w, orig_h, state.get("snap", 0))
        sw, sh = _clamp_dims(sw, sh)
        if (sw, sh) == (orig_w, orig_h):
            return pil_rgb, pil_mask, sw, sh
        factor = sw / orig_w
        resample = _pick_resample(state.get("resample", "auto"), factor)
        return (
            pil_rgb.resize((sw, sh), resample),
            pil_mask.resize((sw, sh), Image.NEAREST),
            sw, sh,
        )

    pad_color = _hex_to_rgb(state.get("pad_color", "#000000"))
    rgb_out = Image.new("RGB", (new_w, new_h), pad_color)
    # Padded border = 255 (inpaint region); original area keeps its own mask.
    mask_out = Image.new("L", (new_w, new_h), 255)
    rgb_out.paste(pil_rgb, (pl, pt))
    mask_out.paste(pil_mask, (pl, pt))

    final_w, final_h = _apply_snap(new_w, new_h, state.get("snap", 0))
    final_w, final_h = _clamp_dims(final_w, final_h)
    if (final_w, final_h) != (new_w, new_h):
        factor = final_w / new_w
        resample = _pick_resample(state.get("resample", "auto"), factor)
        rgb_out = rgb_out.resize((final_w, final_h), resample)
        mask_out = mask_out.resize((final_w, final_h), Image.NEAREST)

    return rgb_out, mask_out, final_w, final_h
