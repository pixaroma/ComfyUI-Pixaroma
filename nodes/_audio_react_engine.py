# nodes/_audio_react_engine.py
"""Shared effect engine for Audio React Pixaroma and Audio Studio Pixaroma.

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

import math
from dataclasses import dataclass, fields

import torch
import torch.nn.functional as F


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


# ---------------------------------------------------------------------
# Generate entry point — populated in Task A6.
# ---------------------------------------------------------------------

def generate_video(image, audio, params: Params) -> torch.Tensor:
    """Render the full audio-reactive clip. Returns [F, H, W, 3] in [0, 1]."""
    raise NotImplementedError("Implemented in Task A6")
