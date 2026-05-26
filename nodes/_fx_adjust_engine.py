"""Composer FX adjustment engine (Python side).

Single source of truth for the math is docs/composer-fx-math.md.
Mirrored 1:1 by js/composer/fx_engine.mjs. Keep them in lockstep and run
scripts/fx_parity_check.py after any change. numpy only (already in ComfyUI).
"""

import math
import numpy as np

NEUTRAL = {
    "brightness": 0, "contrast": 0, "exposure": 0, "highlights": 0, "shadows": 0,
    "whites": 0, "blacks": 0, "saturation": 0, "vibrance": 0, "temperature": 0,
    "tint": 0, "hue": 0, "sharpness": 0, "clarity": 0, "grain": 0, "vignette": 0,
    "fade": 0,
}

# 15 cinematic looks (Original + 14), in grid order (5 across x 3 down).
# Keep IN LOCKSTEP with PRESETS in js/composer/fx_engine.mjs and the table in
# docs/composer-fx-math.md. Only non-zero fields listed; all others default 0.
PRESETS = {
    "Original": {},
    "Cinema": {"contrast": 22, "saturation": 8, "vibrance": 14, "temperature": -10, "tint": 4, "clarity": 8, "blacks": 8},
    "Vivid": {"saturation": 30, "vibrance": 22, "contrast": 14, "clarity": 8},
    "Teal": {"temperature": -30, "tint": 6, "saturation": 14, "vibrance": 12, "contrast": 8},
    "Amber": {"temperature": 30, "contrast": 14, "saturation": 6, "highlights": -8, "grain": 22, "fade": 8},
    "Sienna": {"temperature": 26, "saturation": -6, "contrast": 6, "fade": 24, "blacks": 10, "highlights": -10},
    "Safari": {"temperature": 18, "contrast": 16, "saturation": 8, "vibrance": 8, "clarity": 12},
    "Tropic": {"temperature": -8, "saturation": 24, "vibrance": 18, "contrast": 12, "clarity": 6, "exposure": 3},
    "Bloom": {"temperature": 8, "saturation": 18, "vibrance": 16, "contrast": 10, "clarity": 6},
    "Forest": {"contrast": 24, "blacks": 18, "shadows": -10, "saturation": -16, "tint": 8, "temperature": -6, "vignette": 22, "clarity": 8},
    "Emerald": {"contrast": 14, "saturation": -10, "tint": 14, "temperature": -6, "blacks": 10, "fade": 8},
    "Nordic": {"contrast": 10, "saturation": -8, "temperature": -12, "tint": 10, "fade": 16, "blacks": 8, "highlights": -6},
    "Airy": {"exposure": 6, "brightness": 8, "contrast": -8, "fade": 18, "blacks": 12, "highlights": -8, "saturation": -4},
    "Crisp": {"contrast": 16, "clarity": 16, "sharpness": 12, "saturation": 10, "vibrance": 8},
    "Street": {"contrast": 26, "blacks": 20, "saturation": -14, "clarity": 12, "sharpness": 8, "vignette": 14},
}

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def merge_adjustments(adj):
    out = dict(NEUTRAL)
    if isinstance(adj, dict):
        for k in NEUTRAL:
            if k in adj and adj[k] is not None:
                out[k] = adj[k]
    return out


def is_neutral(adj, amount01):
    if amount01 <= 0:
        return True
    a = merge_adjustments(adj)
    return all(v == 0 for v in a.values())


def _luma(arr):
    return (arr * LUMA).sum(axis=2, keepdims=True)


def _hue_matrix(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([
        [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
        [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283],
        [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072],
    ], dtype=np.float32)


def _box_blur_3x3(arr):
    # edge-replicate 3x3 mean, per channel
    p = np.pad(arr, ((1, 1), (1, 1), (0, 0)), mode="edge")
    acc = np.zeros_like(arr)
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            acc += p[dy:dy + arr.shape[0], dx:dx + arr.shape[1], :]
    return acc / 9.0


def apply_fx(arr, adj, amount01, seed=0):
    """arr: float32 (H,W,3) in 0..1. Returns new float32 (H,W,3) in 0..1."""
    a = merge_adjustments(adj)
    amount01 = max(0.0, min(1.0, float(amount01)))
    if amount01 <= 0.0:
        return arr.copy()
    orig = arr
    c = arr.astype(np.float32).copy()
    H, W = c.shape[0], c.shape[1]

    # Pass A - per pixel
    # Tone ops are applied to LUMINANCE, then re-applied to every channel as a
    # single per-pixel GAIN, preserving the R:G:B ratio (like a real exposure
    # control). The old per-channel tone + final-only clamp could push one noisy
    # shadow channel past the others and clamp the rest to black, turning sparse
    # source noise into saturated speckle dots; a ratio-preserving gain can't
    # isolate a channel, so the dots are gone. See docs/composer-fx-math.md.
    if (a["exposure"] or a["brightness"] or a["contrast"] or a["blacks"]
            or a["shadows"] or a["highlights"] or a["whites"]):
        L = _luma(c)
        Lt = L
        if a["exposure"]:   Lt = Lt * (2.0 ** (a["exposure"] / 100.0))
        if a["brightness"]: Lt = Lt + a["brightness"] / 200.0
        if a["contrast"]:   Lt = (Lt - 0.5) * (1 + a["contrast"] / 100.0) + 0.5
        if a["blacks"]:     Lt = Lt + (a["blacks"] / 100.0) * 0.5 * np.clip(1 - 2 * Lt, 0, 1)
        if a["shadows"]:    Lt = Lt + (a["shadows"] / 100.0) * 0.5 * ((1 - Lt) ** 2)
        if a["highlights"]: Lt = Lt + (a["highlights"] / 100.0) * 0.5 * (Lt ** 2)
        if a["whites"]:     Lt = Lt + (a["whites"] / 100.0) * 0.5 * np.clip(2 * Lt - 1, 0, 1)
        c = c * np.clip(Lt / np.maximum(L, 1e-4), 0.0, 4.0)
    if a["temperature"]:
        c[:, :, 0] += a["temperature"] / 100.0 * 0.10
        c[:, :, 2] -= a["temperature"] / 100.0 * 0.10
    if a["tint"]:       c[:, :, 1] += a["tint"] / 100.0 * 0.10
    if a["saturation"]:
        L = _luma(c); c = L + (c - L) * (1 + a["saturation"] / 100.0)
    if a["vibrance"]:
        mx = c.max(axis=2, keepdims=True); mn = c.min(axis=2, keepdims=True)
        sat = np.where(mx <= 0, 0.0, (mx - mn) / np.maximum(mx, 1e-6))
        amt = (a["vibrance"] / 100.0) * (1 - sat)
        L = _luma(c); c = L + (c - L) * (1 + amt)
    if a["hue"]:
        M = _hue_matrix(a["hue"]); c = c @ M.T
    if a["clarity"]:
        # midtone contrast, also ratio-preserving (luma gain) so it can't speckle
        L = _luma(c); m = 1 - np.abs(2 * L - 1)
        Lt = (L - 0.5) * (1 + (a["clarity"] / 100.0) * 0.5 * m) + 0.5
        c = c * np.clip(Lt / np.maximum(L, 1e-4), 0.0, 4.0)

    # Pass B - spatial sharpness
    if a["sharpness"]:
        blur = _box_blur_3x3(c)
        c = c + (a["sharpness"] / 100.0) * (c - blur)

    # Pass C - coord
    if a["grain"]:
        ys, xs = np.meshgrid(np.arange(H), np.arange(W), indexing="ij")
        d = xs * 12.9898 + ys * 78.233 + seed * 37.719
        n = np.sin(d) * 43758.5453
        n = n - np.floor(n)
        n = (n - 0.5).astype(np.float32)[:, :, None]
        c = c + n * (a["grain"] / 100.0) * 0.2
    if a["vignette"]:
        ys, xs = np.meshgrid(np.arange(H), np.arange(W), indexing="ij")
        dx = (xs + 0.5) / W - 0.5
        dy = (ys + 0.5) / H - 0.5
        rr = np.sqrt(dx * dx + dy * dy) / 0.70710678
        v = np.clip((rr - 0.5) / 0.5, 0, 1)[:, :, None]
        c = c * (1 - (a["vignette"] / 100.0) * v * v)
    if a["fade"]:
        c = c * (1 - (a["fade"] / 100.0) * 0.15) + (a["fade"] / 100.0) * 0.10

    # Clamp processed FIRST, then blend by amount (matches JS).
    c = np.clip(c, 0.0, 1.0)
    out = orig * (1 - amount01) + c * amount01
    return np.clip(out, 0.0, 1.0).astype(np.float32)


def _fx_seed(layer_id):
    """Stable per-layer grain seed from id. Same 31-multiplier hash as JS _fxSeed."""
    h = 0
    for ch in str(layer_id):
        h = (h * 31 + ord(ch)) & 0x7FFFFFFF
    return h % 100000
