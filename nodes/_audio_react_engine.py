# nodes/_audio_react_engine.py
"""Shared effect engine for Audio React Pixaroma and Audio Pulse Pixaroma.

This module is the single source of truth for the audio-reactive video math.
Both nodes are thin wrappers that build a `Params` dataclass and call
`generate_video()` here. See docs/audio-react-math.md for formal definitions.

Design notes:
- MOTION_MODES and OVERLAYS are registries — drop a new function and register
  it; both nodes pick it up automatically.
- Helpers (audio_envelope, onset_track, bandpass_fft, process_aspect) are pure
  functions — easy to test in isolation, easy to call from the parity script.
- No JS or browser deps reach this file. It's torch-only.
"""
from __future__ import annotations

import gc
import math
from dataclasses import dataclass, fields

import torch
import torch.nn.functional as F

import comfy.utils
import comfy.model_management


# ---------------------------------------------------------------------
# Constants — MUST stay in sync with docs/audio-react-math.md.
# ---------------------------------------------------------------------

AUDIO_BANDS_HZ: dict[str, tuple[float | None, float | None]] = {
    "full":   (None, None),
    "bass":   (20, 250),
    "mids":   (250, 4000),
    "treble": (4000, 20000),
}

ASPECT_OPTIONS: list[str] = [
    "Original",
    "Custom (Use Width & Height below)",
    "Custom Ratio 16:9 (Uses Width)",
    "Custom Ratio 9:16 (Uses Width)",
    "Custom Ratio 4:3 (Uses Width)",
    "Custom Ratio 1:1 (Uses Width)",
    "512x512 (Square)",
    "768x512 (Landscape)",
    "512x768 (Portrait)",
    "832x480 (Landscape)",
    "480x832 (Portrait)",
    "1024x576 (Landscape 16:9)",
    "576x1024 (Portrait 9:16)",
    "1280x720 (Landscape HD)",
    "720x1280 (Portrait HD)",
    "1920x1080 (Landscape FHD)",
    "1080x1920 (Portrait FHD)",
    "2560x1440 (Landscape 2K)",
    "1440x2560 (Portrait 2K)",
    "3840x2160 (Landscape 4K)",
    "2160x3840 (Portrait 4K)",
]

# Registries — populated below by static dict (functions register themselves
# at module-bottom in tasks A4 / A5). Both registries: name -> callable.
# Adding a new effect = drop a function + register it. Both
# PixaromaAudioReact and PixaromaAudioStudio pick it up automatically.
MOTION_MODES: dict[str, callable] = {}
OVERLAYS: dict[str, callable] = {}


# ---------------------------------------------------------------------
# Params dataclass — typed schema for both nodes.
# ---------------------------------------------------------------------

@dataclass
class Params:
    motion_mode: str = "scale_pulse"
    intensity: float = 0.8
    audio_band: str = "full"
    motion_speed: float = 0.2
    smoothing: int = 5
    loop_safe: bool = True
    fps: int = 24
    glitch_strength: float = 0.6
    bloom_strength: float = 0.0
    vignette_strength: float = 0.0
    hue_shift_strength: float = 0.0
    aspect_ratio: str = "Original"
    custom_width: int = 1024
    custom_height: int = 1024
    # Sign of the directional axis for motion modes that have one
    # (drift / rotate_pulse / swirl / ripple / slit_scan). +1.0 keeps the
    # original behavior; -1.0 flips the rotation / pan / wave direction.
    # Modes with no directional axis (scale_pulse / zoom_punch / shake)
    # ignore this. Default is the no-op value so existing workflows and
    # parity goldens stay valid.
    motion_direction: float = 1.0

    # ── Per-mode params ─────────────────────────────────────────
    # Each only affects its named mode; defaults are no-op so existing
    # workflows + parity goldens stay valid.
    #
    # shake: lock the random jitter to one axis. "both" = current behavior,
    # "x" = horizontal jitter only, "y" = vertical jitter only.
    shake_axis: str = "both"
    # ripple: multiplier on the spatial frequency `k`. Higher = tighter
    # ripples (more concentric rings visible). 1.0 keeps the original look.
    ripple_density: float = 1.0
    # slit_scan: same idea — multiplier on the row-wave frequency. Higher
    # = more horizontal bars visible at once.
    slit_density: float = 1.0


@dataclass
class MotionContext:
    """Inputs a motion function might need. Functions ignore fields they
    don't care about — keeps the dispatch uniform."""
    base_grid: torch.Tensor   # [1, H, W, 2]
    env_t: float
    onset_t: float
    t: float                   # seconds since clip start
    intensity: float
    motion_speed: float
    direction: float           # +1 or -1, see Params.motion_direction
    H: int
    W: int
    total_frames: int
    frame_index: int
    fps: int
    onset_arr: torch.Tensor   # [F] — full onset track (used by shake)
    # Per-mode params (all default to a no-op for non-target modes).
    shake_axis: str = "both"
    ripple_density: float = 1.0
    slit_density: float = 1.0


@dataclass
class OverlayContext:
    """Per-frame inputs for an overlay function. Functions ignore fields
    they don't care about — keeps the dispatch uniform."""
    frame: torch.Tensor   # [H, W, 3] in [0, 1]
    env_t: float
    onset_t: float
    strength: float
    H: int
    W: int
    device: torch.device


def params_from_dict(cfg: dict) -> Params:
    """Build a Params from a dict, ignoring unknown keys, filling missing
    keys with defaults."""
    valid = {f.name for f in fields(Params)}
    return Params(**{k: v for k, v in cfg.items() if k in valid})


def validate_params(params: Params) -> list[str]:
    """Return a list of human-readable diagnostic strings. Hard errors raise
    in generate_video(); this returns soft warnings (e.g. unusual values)."""
    out = []
    if params.intensity > 1.5:
        out.append(f"intensity={params.intensity:.2f} is high (>1.5); motion may look cartoony.")
    if params.motion_mode not in MOTION_MODES:
        out.append(f"motion_mode={params.motion_mode!r} is unknown; will fail at generate.")
    if params.audio_band not in AUDIO_BANDS_HZ:
        out.append(f"audio_band={params.audio_band!r} is unknown; will fail at generate.")
    return out


# ---------------------------------------------------------------------
# Helper functions — pure, side-effect-free.
# ---------------------------------------------------------------------

def bandpass_fft(waveform, sample_rate, low_hz, high_hz):
    """FFT-based bandpass on the last dim. waveform: [..., samples]."""
    n = waveform.shape[-1]
    spec = torch.fft.rfft(waveform, dim=-1)
    freqs = torch.fft.rfftfreq(n, d=1.0 / sample_rate, device=waveform.device)
    mask = torch.ones_like(freqs)
    if low_hz is not None:
        mask = mask * (freqs >= low_hz).float()
    if high_hz is not None:
        mask = mask * (freqs <= high_hz).float()
    spec = spec * mask
    return torch.fft.irfft(spec, n=n, dim=-1)


def onset_track(envelope, decay=0.85):
    """From a [T] envelope in [0,1], produce a [T] onset/transient track.
    Detects positive spikes (env increases above its 75th percentile by
    >0.05), then exponential-decays between hits. Output in [0, 1]."""
    if envelope.numel() == 0:
        return envelope.clone()
    diff = torch.cat([torch.zeros(1, device=envelope.device), envelope[1:] - envelope[:-1]])
    diff = torch.clamp(diff, min=0.0)
    # Threshold at top quartile of derivative + a small floor so quiet music
    # still produces some onsets.
    thresh = max(0.05, torch.quantile(diff, 0.75).item())
    spikes = (diff > thresh).float() * diff  # keep magnitude on hit frames

    # Exponential decay: onset[t] = max(spikes[t], onset[t-1] * decay)
    out = torch.zeros_like(envelope)
    prev = 0.0
    for i in range(envelope.numel()):
        prev = max(spikes[i].item(), prev * decay)
        out[i] = prev
    out_max = out.max().item()
    if out_max > 0:
        out = out / out_max  # peak-normalize to [0, 1]
    return out


def process_aspect(image, aspect_ratio, custom_w, custom_h, headroom=1.0):
    """Returns (image_at_render_size, base_w, base_h). Caller center-crops
    the warped frames back to base_w × base_h after warping."""
    _, h, w, _ = image.shape

    if aspect_ratio == "Original":
        base_w, base_h = w, h
    elif aspect_ratio == "Custom (Use Width & Height below)":
        base_w, base_h = custom_w, custom_h
    elif "Custom Ratio" in aspect_ratio:
        base_w = custom_w
        if "16:9" in aspect_ratio:
            base_h = int(base_w * 9 / 16)
        elif "9:16" in aspect_ratio:
            base_h = int(base_w * 16 / 9)
        elif "4:3" in aspect_ratio:
            base_h = int(base_w * 3 / 4)
        elif "1:1" in aspect_ratio:
            base_h = base_w
        else:
            base_h = custom_h
    else:
        dim = aspect_ratio.split(" ")[0]
        base_w, base_h = map(int, dim.split("x"))

    base_w = (base_w // 8) * 8
    base_h = (base_h // 8) * 8

    if headroom > 1.0:
        target_w = ((int(base_w * headroom) + 7) // 8) * 8
        target_h = ((int(base_h * headroom) + 7) // 8) * 8
    else:
        target_w, target_h = base_w, base_h

    # Fast path: input already at the snapped size, no work to do.
    # Without the `w == base_w and h == base_h` guard, an "Original"
    # input with odd dims (e.g. 1672x941) returns the un-snapped image
    # but advertises base_w/base_h that don't match — Save Mp4 then
    # rejects the odd height. Falling through here center-crops to the
    # nearest mult-of-8.
    if aspect_ratio == "Original" and headroom <= 1.0 and w == base_w and h == base_h:
        return image, base_w, base_h

    target_ratio = target_w / target_h
    current_ratio = w / h
    if current_ratio > target_ratio:
        new_w = int(h * target_ratio)
        left = (w - new_w) // 2
        image = image[:, :, left:left + new_w, :]
    elif current_ratio < target_ratio:
        new_h = int(w / target_ratio)
        top = (h - new_h) // 2
        image = image[:, top:top + new_h, :, :]

    image = image.permute(0, 3, 1, 2)
    image = F.interpolate(image, size=(target_h, target_w), mode="bilinear", align_corners=False)
    image = image.permute(0, 2, 3, 1)
    return image, base_w, base_h


def audio_envelope(audio, target_frames, fps, device, audio_band, smoothing):
    """Returns a [target_frames] tensor in [0, 1] — per-frame audio energy."""
    waveform = audio["waveform"]
    # Coerce sample_rate to int — the validation guard accepts float, but
    # `view()` and integer divisions below need an int.
    sample_rate = int(audio["sample_rate"])
    # Take the first batch entry only — multi-batch AUDIO is out of scope
    # and would silently double-count samples below.
    if waveform.shape[0] > 1:
        waveform = waveform[:1]
    if waveform.shape[1] > 1:
        waveform = waveform.mean(dim=1, keepdim=True)

    if audio_band != "full":
        low_hz, high_hz = AUDIO_BANDS_HZ[audio_band]
        waveform = bandpass_fft(waveform, sample_rate, low_hz, high_hz)

    total_samples = waveform.shape[-1]
    samples_per_frame = max(1, sample_rate // int(fps))
    required_samples = target_frames * samples_per_frame
    if total_samples < required_samples:
        repeats = math.ceil(required_samples / total_samples)
        waveform = waveform.repeat(1, 1, repeats)
    waveform = waveform[:, :, :required_samples]
    waveform = waveform.view(-1, samples_per_frame)

    rms = torch.sqrt(torch.mean(waveform ** 2, dim=1))
    rms_min, rms_max = rms.min(), rms.max()
    if rms_max > rms_min:
        rms = (rms - rms_min) / (rms_max - rms_min)
    else:
        rms = torch.zeros_like(rms)

    sw = max(1, int(smoothing))
    if sw % 2 == 0:
        sw += 1
    if sw == 1:
        return rms.to(device)
    pad = sw // 2
    kernel = torch.ones(1, 1, sw, device=rms.device) / sw
    rms_padded = F.pad(rms.unsqueeze(0).unsqueeze(0), (pad, pad), mode="replicate")
    rms_smoothed = F.conv1d(rms_padded, kernel).view(-1)
    return rms_smoothed.to(device)


# Module-level cache for shake's cumulative random walk. Keyed by
# total_frames because the walk depends on clip length. generate_video()
# (Task A6) calls reset_motion_caches() once per render — necessary because
# switching audio clips changes total_frames and stale entries would either
# hit the wrong walk or OOB on indexing.
_SHAKE_CACHE: dict[int, tuple[torch.Tensor, torch.Tensor]] = {}


def reset_motion_caches():
    """Clear all motion-mode caches. Called by generate_video() at the
    top of each render."""
    _SHAKE_CACHE.clear()


# ---------------------------------------------------------------------
# Motion modes — registered in MOTION_MODES at module bottom.
# Each function takes a MotionContext and returns a [1, H, W, 2]
# sampling grid for F.grid_sample.
# ---------------------------------------------------------------------

def motion_scale_pulse(ctx: MotionContext) -> torch.Tensor:
    """Uniform breathing zoom. env_t in [0,1], intensity in [0,2]."""
    s = ctx.env_t * ctx.intensity * 0.15  # max 30% zoom at intensity=2, env=1
    return ctx.base_grid * (1.0 - s)


def motion_zoom_punch(ctx: MotionContext) -> torch.Tensor:
    """Fast zoom-in spike on each transient, ease back."""
    s = ctx.onset_t * ctx.intensity * 0.30  # bigger amplitude than scale_pulse
    return ctx.base_grid * (1.0 - s)


def motion_shake(ctx: MotionContext) -> torch.Tensor:
    """Translation jitter. Random direction per onset, exponential settle.

    Pre-renders a deterministic dx/dy walk for the whole clip on first call,
    then samples it per-frame. Cache keyed by total_frames; call
    reset_motion_caches() between distinct generate_video() invocations.
    """
    if ctx.total_frames not in _SHAKE_CACHE:
        g = torch.Generator().manual_seed(0)
        dx_raw = torch.randn(ctx.total_frames, generator=g) * ctx.onset_arr.cpu()
        dy_raw = torch.randn(ctx.total_frames, generator=g) * ctx.onset_arr.cpu()
        dx = torch.zeros_like(dx_raw)
        dy = torch.zeros_like(dy_raw)
        decay = 0.7
        for k in range(ctx.total_frames):
            if k == 0:
                dx[k] = dx_raw[k]
                dy[k] = dy_raw[k]
            else:
                dx[k] = dx[k-1] * decay + dx_raw[k] * (1.0 - decay)
                dy[k] = dy[k-1] * decay + dy_raw[k] * (1.0 - decay)
        _SHAKE_CACHE[ctx.total_frames] = (
            dx.to(ctx.base_grid.device),
            dy.to(ctx.base_grid.device),
        )

    dx_arr, dy_arr = _SHAKE_CACHE[ctx.total_frames]
    amp = ctx.intensity * 0.04  # 4% of half-frame at intensity=1, raw=±1
    # Tensor-only path: avoid .item() to keep the full per-frame loop
    # GPU-resident on CUDA devices (no GPU↔CPU sync per frame).
    dx = dx_arr[ctx.frame_index] * amp
    dy = dy_arr[ctx.frame_index] * amp

    grid = ctx.base_grid.clone()
    # Axis lock: "both" → both X and Y jitter, "x" → horizontal-only,
    # "y" → vertical-only. Unknown values fall back to "both".
    axis = ctx.shake_axis if ctx.shake_axis in ("both", "x", "y") else "both"
    if axis != "y":
        grid[..., 0] = grid[..., 0] - dx
    if axis != "x":
        grid[..., 1] = grid[..., 1] - dy
    return grid


def motion_drift(ctx: MotionContext) -> torch.Tensor:
    """Slow Ken Burns circular pan — sway × bob with audio amplitude.
    env_t=0 → no drift, so loop_safe collapses to identity at boundaries."""
    phase = 2.0 * math.pi * ctx.motion_speed * ctx.t * ctx.direction
    sway = math.sin(phase)
    bob = math.cos(phase)
    amp = ctx.env_t * ctx.intensity * 0.04  # ~4% of half-frame at intensity=1
    dx = sway * amp
    dy = bob * amp
    grid = ctx.base_grid.clone()
    grid[..., 0] = grid[..., 0] - dx
    grid[..., 1] = grid[..., 1] - dy
    return grid


def motion_rotate_pulse(ctx: MotionContext) -> torch.Tensor:
    """Image rocks CW↔CCW. sway×env drives angle, max ±15° at full
    intensity+envelope. Aspect-corrected so non-square frames still
    rotate visually circularly."""
    aspect = ctx.W / ctx.H
    sway = math.sin(2.0 * math.pi * ctx.motion_speed * ctx.t)
    angle = sway * ctx.env_t * ctx.intensity * (math.pi / 12.0) * ctx.direction  # max ±15°
    c = math.cos(angle)
    s = math.sin(angle)
    xs = ctx.base_grid[0, ..., 0] * aspect
    ys = ctx.base_grid[0, ..., 1]
    new_x = (xs * c - ys * s) / aspect
    new_y = xs * s + ys * c
    grid = ctx.base_grid.clone()
    grid[0, ..., 0] = new_x
    grid[0, ..., 1] = new_y
    return grid


def motion_swirl(ctx: MotionContext) -> torch.Tensor:
    """Polar twist: rotation amount = (1-r)·intensity·env so center
    twists hard and edges (r >= 1) don't twist at all. Vortex /
    whirlpool look. env_t=0 → identity → loop_safe-friendly."""
    aspect = ctx.W / ctx.H
    xs = ctx.base_grid[0, ..., 0] * aspect
    ys = ctx.base_grid[0, ..., 1]
    r = torch.sqrt(xs ** 2 + ys ** 2)
    theta = torch.atan2(ys, xs)
    twist = ctx.env_t * ctx.intensity * (math.pi / 2.0) * (1.0 - r).clamp(min=0.0) * ctx.direction
    new_theta = theta + twist
    new_x = r * torch.cos(new_theta) / aspect
    new_y = r * torch.sin(new_theta)
    grid = ctx.base_grid.clone()
    grid[0, ..., 0] = new_x
    grid[0, ..., 1] = new_y
    return grid


def motion_ripple(ctx: MotionContext) -> torch.Tensor:
    """Concentric radial sine ripple from center."""
    device = ctx.base_grid.device
    ys = torch.linspace(-1, 1, ctx.H, device=device).unsqueeze(1).expand(ctx.H, ctx.W)
    xs = torch.linspace(-1, 1, ctx.W, device=device).unsqueeze(0).expand(ctx.H, ctx.W)
    aspect = ctx.W / ctx.H
    r = torch.sqrt((xs * aspect) ** 2 + ys ** 2)

    k = 6.0 * math.pi * ctx.ripple_density
    omega = 2.0 * math.pi * max(ctx.motion_speed * 4.0, 0.5) * ctx.direction
    # Spec: amplitude is 0.015·min(W,H) px → in normalized [-1,1] grid
    # units (full range = 2 units across the smaller dim) → 0.015 * 2 / 2.
    A = ctx.env_t * ctx.intensity * 0.015 * 2.0

    dr = A * torch.sin(k * r - omega * ctx.t)

    r_safe = r.clamp(min=1e-3)
    dx = dr * (xs * aspect) / r_safe / aspect
    dy = dr * ys / r_safe

    grid = ctx.base_grid.clone()
    grid[0, ..., 0] = grid[0, ..., 0] + dx
    grid[0, ..., 1] = grid[0, ..., 1] + dy
    return grid


def motion_slit_scan(ctx: MotionContext) -> torch.Tensor:
    """Vertical wave: each row offsets by sin(k·y_norm + omega·t) · audio.
    Looks like a slit-scan time-displacement without needing a frame
    buffer."""
    device = ctx.base_grid.device
    ys = torch.linspace(-1, 1, ctx.H, device=device).unsqueeze(1).expand(ctx.H, ctx.W)
    k = 4.0 * math.pi * ctx.slit_density
    omega = 2.0 * math.pi * max(ctx.motion_speed * 2.0, 0.4) * ctx.direction
    A = ctx.env_t * ctx.intensity * 0.04

    dy = A * torch.sin(k * ys - omega * ctx.t)
    dx = A * 0.5 * torch.cos(k * ys - omega * ctx.t)

    grid = ctx.base_grid.clone()
    grid[0, ..., 0] = grid[0, ..., 0] + dx
    grid[0, ..., 1] = grid[0, ..., 1] + dy
    return grid


# Register in MOTION_MODES — order here drives the dropdown order in both
# Audio React's widget and Audio Pulse's sidebar.
MOTION_MODES["scale_pulse"]  = motion_scale_pulse
MOTION_MODES["zoom_punch"]   = motion_zoom_punch
MOTION_MODES["shake"]        = motion_shake
MOTION_MODES["drift"]        = motion_drift
MOTION_MODES["rotate_pulse"] = motion_rotate_pulse
MOTION_MODES["ripple"]       = motion_ripple
MOTION_MODES["swirl"]        = motion_swirl
MOTION_MODES["slit_scan"]    = motion_slit_scan


# ---------------------------------------------------------------------
# Overlays — registered in OVERLAYS at module bottom.
# Each function takes an OverlayContext and returns the modified
# [H, W, 3] frame tensor.
# ---------------------------------------------------------------------

def overlay_glitch(ctx: OverlayContext) -> torch.Tensor:
    """RGB shift on transients + scanline swap on big spikes."""
    frame = ctx.frame
    onset_t = ctx.onset_t
    strength = ctx.strength
    H, W = ctx.H, ctx.W
    if onset_t <= 0.001 or strength <= 0:
        return frame
    max_px = max(1, int(onset_t * strength * 0.012 * min(H, W)))
    g = torch.Generator().manual_seed(int(onset_t * 1e6) & 0xFFFF)
    signs = torch.randint(0, 2, (3,), generator=g) * 2 - 1
    offsets = signs * max_px
    out = frame.clone()
    for c in range(3):
        ox = int(offsets[c].item())
        if ox > 0:
            out[:, ox:, c] = frame[:, :W - ox, c]
            # Replicate the leftmost moved-into column so the new edge
            # doesn't leave a "frozen sliver" of the original frame.
            out[:, :ox, c] = frame[:, 0:1, c].expand(-1, ox)
        elif ox < 0:
            ox = -ox
            out[:, :W - ox, c] = frame[:, ox:, c]
            out[:, W - ox:, c] = frame[:, W - 1:W, c].expand(-1, ox)

    if onset_t * strength > 0.7:
        n_swap = max(1, H // 20)
        row_idx = torch.randint(0, H - 1, (n_swap,), generator=g)
        for ri in row_idx.tolist():
            tmp = out[ri].clone()
            out[ri] = out[ri + 1]
            out[ri + 1] = tmp
    return out


def overlay_bloom(ctx: OverlayContext) -> torch.Tensor:
    """Gaussian-glow add-blend pulsing with audio envelope."""
    frame = ctx.frame
    env_t = ctx.env_t
    strength = ctx.strength
    if env_t <= 0.001 or strength <= 0:
        return frame
    weight = env_t * strength * 0.6
    x = frame.permute(2, 0, 1).unsqueeze(0)
    small = F.interpolate(x, scale_factor=0.25, mode="bilinear", align_corners=False)
    ksize = 9
    sigma = 2.0
    coords = torch.arange(ksize, dtype=torch.float32, device=x.device) - (ksize - 1) / 2
    g1 = torch.exp(-(coords ** 2) / (2 * sigma ** 2))
    g1 = g1 / g1.sum()
    kx = g1.view(1, 1, 1, ksize).expand(3, 1, 1, ksize)
    ky = g1.view(1, 1, ksize, 1).expand(3, 1, ksize, 1)
    small = F.conv2d(small, kx, padding=(0, ksize // 2), groups=3)
    small = F.conv2d(small, ky, padding=(ksize // 2, 0), groups=3)
    big = F.interpolate(small, size=x.shape[-2:], mode="bilinear", align_corners=False)
    bloom_layer = (big * weight).clamp(0, 1)
    out = 1.0 - (1.0 - x).clamp(0, 1) * (1.0 - bloom_layer)
    out = out.clamp(0, 1).squeeze(0).permute(1, 2, 0)
    return out


def overlay_vignette(ctx: OverlayContext) -> torch.Tensor:
    """Audio-pulsing vignette."""
    frame = ctx.frame
    env_t = ctx.env_t
    strength = ctx.strength
    H, W = ctx.H, ctx.W
    device = ctx.device
    if env_t <= 0.001 or strength <= 0:
        return frame
    ys = torch.linspace(-1, 1, H, device=device).unsqueeze(1).expand(H, W)
    xs = torch.linspace(-1, 1, W, device=device).unsqueeze(0).expand(H, W)
    r = torch.sqrt(xs ** 2 + ys ** 2).clamp(0, 1.4)
    v = (r / 1.414).clamp(0, 1)
    mask = 1.0 - (v * env_t * strength * 0.5)
    return frame * mask.unsqueeze(-1)


def overlay_hue_shift(ctx: OverlayContext) -> torch.Tensor:
    """Rotate hue by env_t · strength · 30° using the standard
    rotation-around-grayscale-axis matrix."""
    frame = ctx.frame
    env_t = ctx.env_t
    strength = ctx.strength
    if env_t <= 0.001 or strength <= 0:
        return frame
    angle = env_t * strength * (30.0 * math.pi / 180.0)
    c = math.cos(angle)
    s = math.sin(angle)
    # Canonical YIQ-derived hue rotation around the (1,1,1) gray axis.
    # The 0.299 / 0.587 / 0.114 luma triples MUST be exact in every row
    # — typos drift the gray axis and produce a tint on neutrals at high
    # angles (review caught 0.300 / 0.588 / 0.302 typos here previously).
    m = torch.tensor([
        [0.299 + 0.701 * c + 0.168 * s, 0.587 - 0.587 * c + 0.330 * s, 0.114 - 0.114 * c - 0.497 * s],
        [0.299 - 0.299 * c - 0.328 * s, 0.587 + 0.413 * c + 0.035 * s, 0.114 - 0.114 * c + 0.292 * s],
        [0.299 - 0.299 * c + 1.250 * s, 0.587 - 0.587 * c - 1.050 * s, 0.114 + 0.886 * c - 0.203 * s],
    ], device=frame.device, dtype=frame.dtype)
    out = frame @ m.T
    return out.clamp(0, 1)


# Register OVERLAYS — order here drives the per-frame iteration order in
# generate_video(). Glitch reads onset_t (transients), the rest read env_t.
OVERLAYS["glitch"]    = overlay_glitch
OVERLAYS["bloom"]     = overlay_bloom
OVERLAYS["vignette"]  = overlay_vignette
OVERLAYS["hue_shift"] = overlay_hue_shift


# ---------------------------------------------------------------------
# Generate entry point — populated in Task A6.
# ---------------------------------------------------------------------

def generate_video(image: torch.Tensor, audio: dict, params: Params) -> torch.Tensor:
    """Render the full audio-reactive clip. Returns [F, H, W, 3] in [0, 1].

    Hard errors (no image, no audio, audio too short) raise ValueError with
    actionable messages. Soft warnings (unusual params) are surfaced by
    validate_params(); caller should log them before calling generate_video.
    """
    if image is None:
        raise ValueError(
            "[Pixaroma] Audio engine — no image. Wire an IMAGE input or "
            "use Audio Pulse's inline-image picker."
        )
    if (audio is None or not isinstance(audio, dict)
            or "waveform" not in audio or "sample_rate" not in audio
            or audio["waveform"] is None
            or not isinstance(audio["sample_rate"], (int, float))
            or audio["sample_rate"] <= 0):
        raise ValueError(
            "[Pixaroma] Audio engine — no valid audio. Wire AUDIO input or "
            "use Audio Pulse's inline-audio picker."
        )

    device = comfy.model_management.get_torch_device()

    # process_aspect snaps to mult-of-8 and crops if needed
    image_proc, out_w, out_h = process_aspect(
        image, params.aspect_ratio, params.custom_width, params.custom_height,
    )
    img_tensor = image_proc[0].permute(2, 0, 1).unsqueeze(0).to(device)
    _, _, H, W = img_tensor.shape

    audio_duration = audio["waveform"].shape[-1] / audio["sample_rate"]
    total_frames = int(audio_duration * params.fps)
    if total_frames <= 0:
        raise ValueError(
            f"[Pixaroma] Audio engine — audio is too short to produce any "
            f"frames at {params.fps} fps (audio_duration={audio_duration:.3f}s)."
        )

    # Caches that depend on total_frames must be cleared per render.
    reset_motion_caches()

    envelope = audio_envelope(
        audio, total_frames, params.fps, device,
        params.audio_band, params.smoothing,
    )

    # loop_safe needs at least 4 frames so fade_n is >= 2 — otherwise
    # linspace(0, 1, 1) = [0] and the only frame gets zeroed out.
    # Skip silently below 4 frames; user's tiny clip won't loop but
    # also won't be all-zero. linspace(0, 1, fade_n) DELIBERATELY
    # starts at 0 so envelope[0] and envelope[-1] become exactly 0 —
    # that's what makes the playback loop seamless (motion is fully
    # frozen at both ends, so the wrap-around looks identical to a
    # held still frame).
    if params.loop_safe and total_frames >= 4:
        fade_n = max(2, min(int(params.fps * 0.5), total_frames // 2))
        loop_ramp = torch.linspace(0.0, 1.0, fade_n, device=device)
        envelope = envelope.detach().clone()
        envelope[:fade_n] = envelope[:fade_n] * loop_ramp
        envelope[-fade_n:] = envelope[-fade_n:] * loop_ramp.flip(0)

    onset = onset_track(envelope)

    comfy.model_management.soft_empty_cache()
    gc.collect()

    # Time vector for periodic motion (ripple / slit_scan).
    t_vec = torch.arange(total_frames, device=device, dtype=torch.float32) / params.fps

    # Normalized base sampling grid in [-1, 1]. grid_sample reads x first.
    y, x = torch.meshgrid(
        torch.linspace(-1, 1, H, device=device),
        torch.linspace(-1, 1, W, device=device),
        indexing="ij",
    )
    base_grid = torch.stack([x, y], dim=-1).unsqueeze(0)  # [1, H, W, 2]

    print(f"[Pixaroma] engine: {total_frames} frames @ {params.fps}fps, "
          f"{W}x{H} -> {out_w}x{out_h}, mode={params.motion_mode}, "
          f"band={params.audio_band}, intensity={params.intensity}, "
          f"smooth={params.smoothing}")
    pbar = comfy.utils.ProgressBar(total_frames)

    motion_fn = MOTION_MODES.get(params.motion_mode)
    if motion_fn is None:
        raise ValueError(
            f"[Pixaroma] engine — unhandled motion_mode {params.motion_mode!r}. "
            f"Known: {list(MOTION_MODES.keys())}"
        )
    overlay_strengths = {
        "glitch":    params.glitch_strength,
        "bloom":     params.bloom_strength,
        "vignette":  params.vignette_strength,
        "hue_shift": params.hue_shift_strength,
    }

    frames = []
    for i in range(total_frames):
        env_t = envelope[i].item()
        onset_t = onset[i].item()

        ctx = MotionContext(
            base_grid=base_grid, env_t=env_t, onset_t=onset_t,
            t=t_vec[i].item(),
            intensity=params.intensity, motion_speed=params.motion_speed,
            direction=1.0 if params.motion_direction >= 0 else -1.0,
            H=H, W=W,
            total_frames=total_frames, frame_index=i, fps=params.fps,
            onset_arr=onset,
            shake_axis=params.shake_axis,
            ripple_density=params.ripple_density,
            slit_density=params.slit_density,
        )
        grid = motion_fn(ctx)

        warped = F.grid_sample(
            img_tensor, grid,
            mode="bilinear", padding_mode="border", align_corners=False,
        )
        frame = warped.squeeze(0).permute(1, 2, 0)  # [H, W, 3]

        for ov_name, ov_fn in OVERLAYS.items():
            s = overlay_strengths.get(ov_name, 0.0)
            if s > 0.0:
                frame = ov_fn(OverlayContext(
                    frame=frame, env_t=env_t, onset_t=onset_t,
                    strength=s, H=H, W=W, device=device,
                ))

        frames.append(frame.cpu())
        pbar.update(1)

    return torch.stack(frames, dim=0)
