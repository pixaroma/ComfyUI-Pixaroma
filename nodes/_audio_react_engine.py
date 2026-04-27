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
# Helper functions — populated in subsequent tasks (A3).
# ---------------------------------------------------------------------

def bandpass_fft(waveform, sample_rate, low_hz, high_hz):
    raise NotImplementedError("Implemented in Task A3")


def audio_envelope(audio, target_frames, fps, device, audio_band, smoothing):
    raise NotImplementedError("Implemented in Task A3")


def onset_track(envelope, decay=0.85):
    raise NotImplementedError("Implemented in Task A3")


def process_aspect(image, aspect_ratio, custom_w, custom_h, headroom=1.0):
    raise NotImplementedError("Implemented in Task A3")


# ---------------------------------------------------------------------
# Generate entry point — populated in Task A6.
# ---------------------------------------------------------------------

def generate_video(image, audio, params: Params) -> torch.Tensor:
    """Render the full audio-reactive clip. Returns [F, H, W, 3] in [0, 1]."""
    raise NotImplementedError("Implemented in Task A6")
