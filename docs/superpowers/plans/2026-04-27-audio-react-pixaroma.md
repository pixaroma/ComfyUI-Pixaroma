# Audio React Pixaroma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Dispatch each task subagent with `model: "sonnet"` (heavy code-writing) or `model: "opus"` (planning/review). Do not use cheaper default models — quality matters.**

**Goal:** Add a single ComfyUI node (Audio React Pixaroma) that turns an image + audio into an audio-reactive video clip. No depth model. 6 motion modes (`scale_pulse`, `zoom_punch`, `shake`, `ripple`, `slit_scan`, `kaleidoscope`) + 4 stackable overlays (`glitch`, `bloom`, `vignette`, `hue_shift`) + sizing controls mirroring `audio_depth`.

**Architecture:** Single Python file `nodes/node_audio_react.py` (~600 lines). Mirrors the structure of `nodes/node_audio_depth.py`: helpers up top (`_bandpass_fft`, `_audio_envelope`, `_onset_track`, `_process_aspect`), then a `PixaromaAudioReact` class with `INPUT_TYPES` and `generate(...)`. Per-frame motion is computed via `F.grid_sample` over a normalized `[-1, 1]` `base_grid` (same pattern as `audio_depth`). Overlays operate in-place on the warped frame tensor before crop. No JS, no extra Python deps (only `torch` + `comfy.utils` + `comfy.model_management`, all already imported by ComfyUI).

**Tech Stack:** Python 3, PyTorch (existing ComfyUI dep), `torch.nn.functional` for `grid_sample` / FFT / interpolate / `pad`. No NumPy needed (everything torch).

**Spec:** `docs/superpowers/specs/2026-04-27-audio-react-pixaroma-design.md` (read it before starting — defines the contract).

**Testing context:** This project has no pytest/test framework. Smoke tests use `python -c "..."` inline assertions where the unit is testable in isolation, and `load ComfyUI → drop the node → run → screenshot` for end-to-end visual verification. Always print a clear `"DONE: <task name>"` line at the end of each task so the user knows when to test.

---

## File Structure

| File | Action | Notes |
|------|--------|-------|
| `nodes/node_audio_react.py` | NEW | Full node implementation |
| `__init__.py` | MODIFY | Register `_MAPS_AUDIO_REACT` / `_NAMES_AUDIO_REACT` (mirrors lines 7-8, 42, 61) |
| `CLAUDE.md` | MODIFY | Add to "Token-Saving Rules" file-task table; one-line mention in Architecture entry-points |
| `README.md` | MODIFY | Add an "Audio React Pixaroma" section parallel to "Audio Depth Pixaroma" |

No JS, no `server_routes.py` changes, no asset files.

---

## Task 1: Scaffold the node — empty class, registered, visible in ComfyUI menu

**Files:**
- Create: `nodes/node_audio_react.py`
- Modify: `__init__.py`

**Goal:** The node appears in the ComfyUI Add-Node menu under `👑 Pixaroma` with all 15 widgets visible, but the `generate()` function just passes the image through (one frame, ignores audio). Establishes the contract.

- [ ] **Step 1: Create `nodes/node_audio_react.py` with the full INPUT_TYPES and a stub generate()**

```python
# nodes/node_audio_react.py
import math

import torch
import torch.nn.functional as F

import comfy.utils
import comfy.model_management


_AUDIO_BANDS_HZ = {
    "full":   (None, None),
    "bass":   (20, 250),
    "mids":   (250, 4000),
    "treble": (4000, 20000),
}

_ASPECT_OPTIONS = [
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

_MOTION_MODES = [
    "scale_pulse",
    "zoom_punch",
    "shake",
    "ripple",
    "slit_scan",
    "kaleidoscope",
]


class PixaromaAudioReact:
    """Audio-reactive image-to-video without depth. One opinionated node:
    pick a motion mode, optionally stack overlay effects, get an animated
    clip whose motion follows the audio envelope."""

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Source still image to animate."}),
                "audio": ("AUDIO", {"tooltip": "Driver audio. Clip length = audio_duration × fps."}),
                "aspect_ratio": (_ASPECT_OPTIONS, {"default": "Original",
                    "tooltip": "Output framing. 'Original' keeps the input image's ratio. Fixed presets crop+resize to that exact size. 'Custom Ratio …' uses custom_width and computes height from the ratio. 'Custom (W & H)' uses both as-is."}),
                "custom_width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8,
                    "tooltip": "Used by 'Custom Ratio …' presets and 'Custom (W & H)'. Ignored by 'Original' and fixed-size presets."}),
                "custom_height": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8,
                    "tooltip": "Used only by 'Custom (Use Width & Height below)'. Other presets compute or ignore it."}),
                "motion_mode": (_MOTION_MODES, {"default": "scale_pulse",
                    "tooltip": (
                        "scale_pulse = uniform breathing zoom on audio amplitude (default — universal, looks good on any image).\n"
                        "zoom_punch = fast zoom-in spike on each transient, slow ease back. Drum-hit / drop aesthetic.\n"
                        "shake = translation jitter on transients, no rotation. Aggressive, hip-hop / rock.\n"
                        "ripple = concentric ripples expand from center on each beat. Electronic / ambient.\n"
                        "slit_scan = rows time-displaced by audio envelope. Distinctive, modern, experimental.\n"
                        "kaleidoscope = radial 6-segment mirror; segment rotation reactive to audio. Club / abstract."
                    )}),
                "intensity": ("FLOAT", {"default": 0.8, "min": 0.0, "max": 2.0, "step": 0.05,
                    "tooltip": "Master strength. 0 = still, 0.8 = default (cinematic), 2 = extreme."}),
                "audio_band": (list(_AUDIO_BANDS_HZ.keys()), {"default": "full",
                    "tooltip": "Frequency band that drives the motion envelope. full = whole spectrum (default). bass = drum-driven (20–250 Hz). mids = vocal-driven (250–4000 Hz). treble = cymbals/hi-hats (4000–20000 Hz)."}),
                "motion_speed": ("FLOAT", {"default": 0.2, "min": 0.05, "max": 1.0, "step": 0.05,
                    "tooltip": "Base oscillation frequency in Hz for modes that need it (ripple, kaleidoscope, slit_scan). 0.2 = one cycle every 5s (cinematic)."}),
                "smoothing": ("INT", {"default": 5, "min": 1, "max": 15, "step": 1,
                    "tooltip": "Audio envelope moving-average window in frames. 1 = punchy. 5 = balanced default. 8–15 = fluid / cinematic."}),
                "loop_safe": ("BOOLEAN", {"default": True,
                    "tooltip": "Ramp the first and last 0.5s of motion to zero so the clip loops with no visible jump. Default ON."}),
                "fps": ("INT", {"default": 24, "min": 8, "max": 60, "step": 1,
                    "tooltip": "Output frames per second."}),
                "edge_headroom": ("FLOAT", {"default": 1.05, "min": 1.0, "max": 1.3, "step": 0.01,
                    "tooltip": "Render slightly larger then center-crop, giving motion a safety zone. 1.0 = none. 1.05 = default (kills edge-clipping). 1.2 = wide margin for strong motion."}),
                "glitch_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05,
                    "tooltip": "RGB-channel offset spikes on transients + occasional scanline tear. 0 = off."}),
                "bloom_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05,
                    "tooltip": "Gaussian glow that pulses with bass. 0 = off."}),
                "vignette_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05,
                    "tooltip": "Edges darken in pulses with audio. 0 = off."}),
                "hue_shift_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05,
                    "tooltip": "Color rotation cycles with audio amplitude. 0 = off."}),
            }
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "FLOAT")
    RETURN_NAMES = ("video_frames", "audio", "fps")
    FUNCTION = "generate"
    CATEGORY = "👑 Pixaroma"

    def generate(self, image, audio, aspect_ratio, custom_width, custom_height,
                 motion_mode, intensity, audio_band, motion_speed, smoothing,
                 loop_safe, fps, edge_headroom,
                 glitch_strength, bloom_strength, vignette_strength, hue_shift_strength):
        # STUB: passthrough one frame, ignore everything else for now.
        # Each subsequent task fleshes this out.
        return (image, audio, float(fps))


NODE_CLASS_MAPPINGS = {
    "PixaromaAudioReact": PixaromaAudioReact,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaAudioReact": "Audio React Pixaroma",
}
```

- [ ] **Step 2: Modify `__init__.py` to import + merge the new mappings**

In `__init__.py` add the import (alphabetical with existing audio_depth import, line 7-8 area):

```python
from .nodes.node_audio_react import NODE_CLASS_MAPPINGS as _MAPS_AUDIO_REACT
from .nodes.node_audio_react import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_AUDIO_REACT
```

Add `**_MAPS_AUDIO_REACT,` to `NODE_CLASS_MAPPINGS` (around line 42, next to `_MAPS_AUDIO_DEPTH`).

Add `**_NAMES_AUDIO_REACT,` to `NODE_DISPLAY_NAME_MAPPINGS` (around line 61).

- [ ] **Step 3: Smoke test — Python parses cleanly + ComfyUI loads the node**

Run from project root:

```bash
python -c "from nodes.node_audio_react import PixaromaAudioReact; n = PixaromaAudioReact(); print(n.INPUT_TYPES())" 2>&1 | head -20
```

Expected: prints `INPUT_TYPES` dict without exception.

Then restart ComfyUI. In the browser, double-click the canvas → search "Audio React" → confirm "Audio React Pixaroma" appears with all 15 widgets visible. **Take a screenshot to confirm.**

- [ ] **Step 4: Commit**

```bash
git add nodes/node_audio_react.py __init__.py
git -c user.name=pixaroma -c user.email=pixaromadesign@gmail.com commit -m "audio_react: scaffold node with INPUT_TYPES + register

15 widgets defined matching the spec:
- sizing (3): aspect_ratio + custom_width + custom_height
- motion (1): motion_mode dropdown
- shared (7): intensity, audio_band, motion_speed, smoothing,
  loop_safe, fps, edge_headroom
- overlays (4): glitch, bloom, vignette, hue_shift strengths

generate() is a stub passthrough — subsequent tasks add the
audio envelope, motion modes, and overlays."
```

Print `DONE: Task 1 — node scaffolded and registered. Test by adding the node in ComfyUI.`

---

## Task 2: Audio envelope — bandpass + RMS + smoothing

**Files:**
- Modify: `nodes/node_audio_react.py`

**Goal:** Add `_bandpass_fft` and `_audio_envelope` (and method) so we can derive a per-frame `[0, 1]` envelope tensor from any AUDIO input. Same code as `audio_depth`'s helpers — duplicate locally, no cross-file import.

- [ ] **Step 1: Add the `_bandpass_fft` module-level helper above the class**

Insert after the `_MOTION_MODES` constant, before the class:

```python
def _bandpass_fft(waveform, sample_rate, low_hz, high_hz):
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
```

- [ ] **Step 2: Add `_audio_envelope` as a method on `PixaromaAudioReact`**

```python
    def _audio_envelope(self, audio, target_frames, fps, device, audio_band, smoothing):
        """Returns a [target_frames] tensor in [0, 1] — per-frame audio energy."""
        waveform = audio["waveform"]
        sample_rate = audio["sample_rate"]
        if waveform.shape[1] > 1:
            waveform = waveform.mean(dim=1, keepdim=True)

        if audio_band != "full":
            low_hz, high_hz = _AUDIO_BANDS_HZ[audio_band]
            waveform = _bandpass_fft(waveform, sample_rate, low_hz, high_hz)

        total_samples = waveform.shape[-1]
        samples_per_frame = sample_rate // fps
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
```

- [ ] **Step 3: Smoke test the envelope with synthetic audio**

```bash
python -c "
import torch
from nodes.node_audio_react import PixaromaAudioReact

# 2-second 440Hz sine at 44.1kHz, mono
sr = 44100
t = torch.linspace(0, 2.0, sr * 2)
wave = torch.sin(2 * 3.14159 * 440 * t).unsqueeze(0).unsqueeze(0)  # [1, 1, samples]
audio = {'waveform': wave, 'sample_rate': sr}

n = PixaromaAudioReact()
env = n._audio_envelope(audio, target_frames=48, fps=24, device='cpu', audio_band='full', smoothing=5)
print('shape:', env.shape, 'min:', env.min().item(), 'max:', env.max().item())
assert env.shape == (48,), f'expected (48,), got {env.shape}'
assert 0 <= env.min().item() <= env.max().item() <= 1, 'envelope must be in [0, 1]'
print('OK')
"
```

Expected: `shape: torch.Size([48]) min: 0.0 max: 1.0` then `OK`.

- [ ] **Step 4: Commit**

```bash
git add nodes/node_audio_react.py
git -c user.name=pixaroma -c user.email=pixaromadesign@gmail.com commit -m "audio_react: add _bandpass_fft + _audio_envelope helpers

Duplicates audio_depth's pattern locally — FFT bandpass on the
configured frequency range, RMS per frame window, peak-normalized
to [0, 1], then smoothed by a moving-average kernel of size
'smoothing' frames."
```

Print `DONE: Task 2 — audio envelope working.`

---

## Task 3: Onset/transient detection

**Files:**
- Modify: `nodes/node_audio_react.py`

**Goal:** Add `_onset_track(envelope)` that returns a `[total_frames]` tensor of spike-shaped values (0 outside transients, 0..1 on transients with exponential decay). Used by `zoom_punch`, `shake`, `glitch_strength`.

- [ ] **Step 1: Add the helper as a module-level function near `_bandpass_fft`**

```python
def _onset_track(envelope, decay=0.85):
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
```

- [ ] **Step 2: Smoke test with a synthetic envelope that has clear spikes**

```bash
python -c "
import torch
from nodes.node_audio_react import _onset_track

# envelope with spikes at frames 10, 30, 50 (24fps → ~0.4s, 1.25s, 2.1s)
env = torch.zeros(60)
for spike_idx in [10, 30, 50]:
    env[spike_idx] = 1.0
    env[spike_idx + 1] = 0.5  # quick decay in the envelope itself

onset = _onset_track(env, decay=0.85)
print('onset shape:', onset.shape)
print('peaks at:', [i for i in range(60) if onset[i] > 0.5])
assert onset.shape == env.shape
assert 0 <= onset.min().item() <= onset.max().item() <= 1
# spikes should produce onset>0.5 at spike frames
assert onset[10].item() > 0.5 and onset[30].item() > 0.5 and onset[50].item() > 0.5
# between spikes (frame 20) should have decayed
assert onset[20].item() < onset[10].item()
print('OK')
"
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add nodes/node_audio_react.py
git -c user.name=pixaroma -c user.email=pixaromadesign@gmail.com commit -m "audio_react: add _onset_track helper

Spike-shaped per-frame transient track derived from envelope
positive-derivative thresholded at top-quartile, then exponential
decay between hits. Peak-normalized to [0, 1]. Used by zoom_punch,
shake, and glitch overlay."
```

Print `DONE: Task 3 — onset detection working.`

---

## Task 4: Aspect/sizing helper

**Files:**
- Modify: `nodes/node_audio_react.py`

**Goal:** Port `_process_aspect` verbatim from `audio_depth`. Returns `(image_at_render_size, base_w, base_h)` and supports headroom-padded rendering.

- [ ] **Step 1: Add `_process_aspect` as a method on `PixaromaAudioReact`**

```python
    def _process_aspect(self, image, aspect_ratio, custom_w, custom_h, headroom=1.0):
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

        if aspect_ratio == "Original" and headroom <= 1.0:
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
```

- [ ] **Step 2: Smoke test with a fake image tensor**

```bash
python -c "
import torch
from nodes.node_audio_react import PixaromaAudioReact

img = torch.rand(1, 480, 640, 3)  # 640×480 (landscape)
n = PixaromaAudioReact()

# Original keeps shape
out, bw, bh = n._process_aspect(img, 'Original', 1024, 1024, 1.0)
assert out.shape == (1, 480, 640, 3) and bw == 640 and bh == 480

# Original with 1.05 headroom → upscaled
out, bw, bh = n._process_aspect(img, 'Original', 1024, 1024, 1.05)
assert bw == 640 and bh == 480
assert out.shape[1] >= 480 and out.shape[2] >= 640

# 16:9 ratio at 1024 wide → 576 tall
out, bw, bh = n._process_aspect(img, 'Custom Ratio 16:9 (Uses Width)', 1024, 1024, 1.0)
assert bw == 1024 and bh == 576, f'got {bw}x{bh}'

# Fixed 1280x720
out, bw, bh = n._process_aspect(img, '1280x720 (Landscape HD)', 1024, 1024, 1.0)
assert bw == 1280 and bh == 720
print('OK')
"
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add nodes/node_audio_react.py
git -c user.name=pixaroma -c user.email=pixaromadesign@gmail.com commit -m "audio_react: add _process_aspect helper

Ported verbatim from audio_depth — supports Original / Custom W&H /
Custom Ratio NN:NN / fixed-size presets, with optional headroom
padding for motion safety zone."
```

Print `DONE: Task 4 — aspect helper working.`

---

## Task 5: Motion mode `scale_pulse` + first end-to-end render

**Files:**
- Modify: `nodes/node_audio_react.py`

**Goal:** Implement the full `generate()` skeleton (envelope → time grid → per-frame loop → grid_sample → crop → stack) with `scale_pulse` as the only working motion. Other modes raise NotImplemented for now. After this task, you can plug the node into a workflow with audio + image and get a real audio-reactive video out.

- [ ] **Step 1: Implement `generate()` with the per-frame loop and `scale_pulse` motion**

Replace the stub `generate()` with:

```python
    def generate(self, image, audio, aspect_ratio, custom_width, custom_height,
                 motion_mode, intensity, audio_band, motion_speed, smoothing,
                 loop_safe, fps, edge_headroom,
                 glitch_strength, bloom_strength, vignette_strength, hue_shift_strength):
        # Input validation — clear actionable messages over crashes.
        if image is None:
            raise ValueError(
                "[Pixaroma] Audio React — no image connected. Wire an "
                "IMAGE source (e.g. Load Image) to the 'image' input."
            )
        if (audio is None or not isinstance(audio, dict)
                or "waveform" not in audio or "sample_rate" not in audio
                or audio["waveform"] is None
                or not isinstance(audio["sample_rate"], (int, float))
                or audio["sample_rate"] <= 0):
            raise ValueError(
                "[Pixaroma] Audio React — no valid audio connected. Wire "
                "a Load Audio (or any AUDIO source with non-empty "
                "waveform and sample_rate > 0) to the 'audio' input."
            )

        device = comfy.model_management.get_torch_device()

        image, out_w, out_h = self._process_aspect(
            image, aspect_ratio, custom_width, custom_height, edge_headroom,
        )
        img_tensor = image[0].permute(2, 0, 1).unsqueeze(0).to(device)
        _, _, H, W = img_tensor.shape

        crop_h_off = max(0, (H - out_h) // 2)
        crop_w_off = max(0, (W - out_w) // 2)
        needs_crop = (H != out_h) or (W != out_w)

        audio_duration = audio["waveform"].shape[-1] / audio["sample_rate"]
        total_frames = int(audio_duration * fps)
        if total_frames <= 0:
            raise ValueError(
                f"Audio is too short to produce any frames at {fps} fps "
                f"(audio_duration={audio_duration:.3f}s)."
            )

        envelope = self._audio_envelope(audio, total_frames, fps, device, audio_band, smoothing)

        # loop_safe ramp (applied after motion modes wire it later in Task 15;
        # for now we apply unconditionally so the basic shape is in place).
        loop_ramp = None
        if loop_safe:
            fade_n = max(1, min(int(fps * 0.5), total_frames // 2))
            loop_ramp = torch.linspace(0.0, 1.0, fade_n, device=device)
            envelope = envelope.detach().clone()
            envelope[:fade_n] = envelope[:fade_n] * loop_ramp
            envelope[-fade_n:] = envelope[-fade_n:] * loop_ramp.flip(0)

        onset = _onset_track(envelope)

        # Time vector for periodic motion (ripple / kaleidoscope / slit_scan).
        t_vec = torch.arange(total_frames, device=device, dtype=torch.float32) / fps

        # Normalized base sampling grid in [-1, 1]. grid_sample reads x first.
        y, x = torch.meshgrid(
            torch.linspace(-1, 1, H, device=device),
            torch.linspace(-1, 1, W, device=device),
            indexing="ij",
        )
        base_grid = torch.stack([x, y], dim=-1).unsqueeze(0)  # [1, H, W, 2]

        print(f"[Pixaroma] Audio React: {total_frames} frames @ {fps}fps, "
              f"{W}x{H} → {out_w}x{out_h}, mode={motion_mode}, band={audio_band}, "
              f"intensity={intensity}, smooth={smoothing}")
        pbar = comfy.utils.ProgressBar(total_frames)

        frames = []
        for i in range(total_frames):
            env_t = envelope[i].item()
            onset_t = onset[i].item()

            if motion_mode == "scale_pulse":
                grid = self._motion_scale_pulse(base_grid, env_t, intensity)
            elif motion_mode == "zoom_punch":
                grid = self._motion_zoom_punch(base_grid, onset_t, intensity)
            elif motion_mode == "shake":
                grid = self._motion_shake(base_grid, i, total_frames, onset, intensity, fps)
            elif motion_mode == "ripple":
                grid = self._motion_ripple(base_grid, t_vec[i].item(), env_t, intensity, motion_speed, H, W)
            elif motion_mode == "slit_scan":
                grid = self._motion_slit_scan(base_grid, t_vec[i].item(), env_t, intensity, motion_speed, H, W)
            elif motion_mode == "kaleidoscope":
                grid = self._motion_kaleidoscope(base_grid, t_vec[i].item(), env_t, intensity, motion_speed, H, W)
            else:
                raise ValueError(f"[Pixaroma] Audio React — unhandled motion_mode {motion_mode!r}.")

            warped = F.grid_sample(
                img_tensor, grid,
                mode="bilinear", padding_mode="border", align_corners=False,
            )
            frame = warped.squeeze(0).permute(1, 2, 0)  # [H, W, 3]

            # Overlays (each is a no-op when strength == 0).
            if glitch_strength > 0.0:
                frame = self._overlay_glitch(frame, onset_t, glitch_strength, H, W)
            if bloom_strength > 0.0:
                frame = self._overlay_bloom(frame, env_t, bloom_strength)
            if vignette_strength > 0.0:
                frame = self._overlay_vignette(frame, env_t, vignette_strength, H, W, device)
            if hue_shift_strength > 0.0:
                frame = self._overlay_hue_shift(frame, env_t, hue_shift_strength)

            if needs_crop:
                frame = frame[crop_h_off:crop_h_off + out_h, crop_w_off:crop_w_off + out_w, :]
            frames.append(frame.cpu())
            pbar.update(1)

        output_video = torch.stack(frames, dim=0)
        return (output_video, audio, float(fps))
```

- [ ] **Step 2: Add `_motion_scale_pulse` method (other modes will be `NotImplementedError` stubs)**

Add as methods on `PixaromaAudioReact`:

```python
    def _motion_scale_pulse(self, base_grid, env_t, intensity):
        """Uniform breathing zoom. env_t in [0,1], intensity in [0,2]."""
        s = env_t * intensity * 0.15  # max 30% zoom at intensity=2, env=1
        # Scaling about origin: sample from coords (1 + s) further out → zoom in.
        # Since base_grid is in [-1, 1], multiply both x and y by (1 - s) to
        # PULL coords inward → image looks zoomed-in.
        return base_grid * (1.0 - s)

    def _motion_zoom_punch(self, base_grid, onset_t, intensity):
        raise NotImplementedError("zoom_punch — Task 6")

    def _motion_shake(self, base_grid, i, total_frames, onset, intensity, fps):
        raise NotImplementedError("shake — Task 7")

    def _motion_ripple(self, base_grid, t, env_t, intensity, motion_speed, H, W):
        raise NotImplementedError("ripple — Task 8")

    def _motion_slit_scan(self, base_grid, t, env_t, intensity, motion_speed, H, W):
        raise NotImplementedError("slit_scan — Task 9")

    def _motion_kaleidoscope(self, base_grid, t, env_t, intensity, motion_speed, H, W):
        raise NotImplementedError("kaleidoscope — Task 10")

    def _overlay_glitch(self, frame, onset_t, strength, H, W):
        return frame  # Task 11

    def _overlay_bloom(self, frame, env_t, strength):
        return frame  # Task 12

    def _overlay_vignette(self, frame, env_t, strength, H, W, device):
        return frame  # Task 13

    def _overlay_hue_shift(self, frame, env_t, strength):
        return frame  # Task 14
```

- [ ] **Step 3: End-to-end smoke test in ComfyUI**

Restart ComfyUI. In a workflow:
1. `Load Image` → wire to `Audio React Pixaroma.image`
2. `Load Audio` (any short MP3 / WAV) → wire to `audio`
3. `Audio React Pixaroma.video_frames` → `Save Mp4 Pixaroma.video_frames`
4. `Audio React Pixaroma.audio` → `Save Mp4 Pixaroma.audio`
5. `Audio React Pixaroma.fps` → `Save Mp4 Pixaroma.fps`

Defaults (motion_mode = `scale_pulse`, all overlays = 0). Run.

Expected: an MP4 plays in the Save Mp4 preview, image gently breathes/zooms with audio amplitude, no errors. **Take a screenshot of the playing preview.**

- [ ] **Step 4: Commit**

```bash
git add nodes/node_audio_react.py
git -c user.name=pixaroma -c user.email=pixaromadesign@gmail.com commit -m "audio_react: full generate() loop + scale_pulse motion

Implements the per-frame pipeline: envelope + onset + time vector,
base sampling grid, motion-mode dispatch, grid_sample warp, overlay
hooks (no-ops for now), center-crop back to base size, stack to
[T, H, W, 3] output.

Only scale_pulse is implemented — uniform breathing zoom. Other
motion modes raise NotImplementedError; overlays return frame
unchanged. Subsequent tasks fill them in."
```

Print `DONE: Task 5 — first end-to-end render working with scale_pulse. Test in ComfyUI now.`

---

## Task 6: Motion mode `zoom_punch`

**Files:**
- Modify: `nodes/node_audio_react.py`

**Goal:** Drum-hit-style zoom-in spike on transients, slow ease back. Same shape as `scale_pulse` but driven by `onset_t` (which already has spike+decay shape from Task 3) instead of `env_t`. Slightly stronger amplitude since onset peaks are sparser.

- [ ] **Step 1: Replace `_motion_zoom_punch` body**

```python
    def _motion_zoom_punch(self, base_grid, onset_t, intensity):
        """Fast zoom-in spike on each transient, ease back."""
        s = onset_t * intensity * 0.30  # bigger amplitude than scale_pulse
        return base_grid * (1.0 - s)
```

- [ ] **Step 2: Smoke test in ComfyUI**

Same workflow as Task 5; switch `motion_mode` to `zoom_punch`. Expected: image punches in on each beat then eases out. Verify with a short drum-heavy audio sample.

- [ ] **Step 3: Commit**

```bash
git add nodes/node_audio_react.py
git -c user.name=pixaroma -c user.email=pixaromadesign@gmail.com commit -m "audio_react: implement zoom_punch motion mode"
```

Print `DONE: Task 6 — zoom_punch working.`

---

## Task 7: Motion mode `shake`

**Files:**
- Modify: `nodes/node_audio_react.py`

**Goal:** Translation jitter on transients. Random walk of (dx, dy) seeded by onset spikes, decays between. Each frame jitters in a different direction. Pre-compute the shake track once per render (deterministic from frame index).

- [ ] **Step 1: Replace `_motion_shake` body**

```python
    def _motion_shake(self, base_grid, i, total_frames, onset, intensity, fps):
        """Translation jitter. Random direction per onset, exponential settle."""
        # Lazily compute (and cache) the dx/dy track on the instance once per
        # call to generate(). i==0 builds it; later calls reuse.
        if (not hasattr(self, "_shake_dx_cache")
                or self._shake_dx_cache.shape[0] != total_frames):
            g = torch.Generator().manual_seed(0)
            # Per-frame random unit-ish direction, scaled by onset envelope.
            dx_raw = torch.randn(total_frames, generator=g) * onset.cpu()
            dy_raw = torch.randn(total_frames, generator=g) * onset.cpu()
            # Exponential smoothing so jitter decays smoothly between hits.
            dx = torch.zeros_like(dx_raw)
            dy = torch.zeros_like(dy_raw)
            decay = 0.7
            for k in range(total_frames):
                if k == 0:
                    dx[k] = dx_raw[k]
                    dy[k] = dy_raw[k]
                else:
                    dx[k] = dx[k-1] * decay + dx_raw[k] * (1.0 - decay)
                    dy[k] = dy[k-1] * decay + dy_raw[k] * (1.0 - decay)
            self._shake_dx_cache = dx.to(base_grid.device)
            self._shake_dy_cache = dy.to(base_grid.device)

        # Convert to grid units. Grid is in [-1, 1], so a shift of `s` units
        # moves sampled image by s/2 of the frame width.
        amp = intensity * 0.04  # 4% of half-frame at intensity=1, raw=±1
        dx = self._shake_dx_cache[i].item() * amp
        dy = self._shake_dy_cache[i].item() * amp

        grid = base_grid.clone()
        grid[..., 0] = grid[..., 0] - dx
        grid[..., 1] = grid[..., 1] - dy
        return grid
```

**Note:** The cache lives on `self` and is rebuilt when `total_frames` changes. Each `generate()` call rebuilds (since `total_frames` differs per audio length).

- [ ] **Step 2: Add a cache-clear at the top of `generate()` so subsequent runs with a different total_frames don't reuse stale data**

In `generate()`, right after computing `total_frames` and before the per-frame loop, add:

```python
        # Clear motion-mode caches that depend on total_frames.
        if hasattr(self, "_shake_dx_cache"):
            del self._shake_dx_cache
            del self._shake_dy_cache
```

- [ ] **Step 3: Smoke test in ComfyUI**

`motion_mode = shake`, beat-heavy audio. Expected: image jitters direction on each beat, settles between. **Screenshot a few frames showing different translations.**

- [ ] **Step 4: Commit**

```bash
git add nodes/node_audio_react.py
git -c user.name=pixaroma -c user.email=pixaromadesign@gmail.com commit -m "audio_react: implement shake motion mode

Deterministic random-walk translation seeded by onset envelope,
exponentially smoothed so jitter decays between hits. Cache
rebuilt per generate() call (depends on total_frames)."
```

Print `DONE: Task 7 — shake working.`

---

## Task 8: Motion mode `ripple`

**Files:**
- Modify: `nodes/node_audio_react.py`

**Goal:** Radial sine displacement that pulses outward from frame center on audio. `dr = A · sin(k·r − ω·t)` where `A = env_t · intensity · 0.015 · min(W, H)` (px, resolution-relative).

- [ ] **Step 1: Replace `_motion_ripple` body**

```python
    def _motion_ripple(self, base_grid, t, env_t, intensity, motion_speed, H, W):
        """Concentric radial sine ripple from center."""
        device = base_grid.device
        # Pixel-space radius from center.
        ys = torch.linspace(-1, 1, H, device=device).unsqueeze(1).expand(H, W)
        xs = torch.linspace(-1, 1, W, device=device).unsqueeze(0).expand(H, W)
        # Aspect-correct distance.
        aspect = W / H
        r = torch.sqrt((xs * aspect) ** 2 + ys ** 2)  # in [0, sqrt(aspect^2 + 1)]

        # Ripple wavelength: 6 visible rings across the diagonal.
        k = 6.0 * math.pi
        # Time advance: motion_speed Hz wave outward.
        omega = 2.0 * math.pi * max(motion_speed * 4.0, 0.5)
        # Amplitude as fraction of grid (grid spans [-1, 1], i.e. 2 units).
        # Spec: 0.015 of min(W, H) px → in grid units = 0.015 * 2 / 2 = 0.015.
        A = env_t * intensity * 0.015 * 2.0  # ×2 because grid range is 2

        dr = A * torch.sin(k * r - omega * t)

        # Convert radial displacement back into x/y components.
        # Avoid div-by-zero at exact center.
        r_safe = r.clamp(min=1e-3)
        dx = dr * (xs * aspect) / r_safe / aspect  # divide aspect back out
        dy = dr * ys / r_safe

        grid = base_grid.clone()
        grid[0, ..., 0] = grid[0, ..., 0] + dx
        grid[0, ..., 1] = grid[0, ..., 1] + dy
        return grid
```

- [ ] **Step 2: Smoke test in ComfyUI**

`motion_mode = ripple`. Expected: visible concentric ripples expand from center, pulsing with audio. **Screenshot.**

- [ ] **Step 3: Commit**

```bash
git add nodes/node_audio_react.py
git -c user.name=pixaroma -c user.email=pixaromadesign@gmail.com commit -m "audio_react: implement ripple motion mode

Radial sine displacement field, resolution-relative amplitude,
6 visible rings across the frame diagonal, time-advanced at
motion_speed × 4 Hz."
```

Print `DONE: Task 8 — ripple working.`

---

## Task 9: Motion mode `slit_scan`

**Files:**
- Modify: `nodes/node_audio_react.py`

**Goal:** Vertical wave displacement where each row's offset depends on its row index AND the audio envelope at a row-shifted time index. Visually: image looks like it's vertically wobbling with horizontal time-shift, scrolling through audio history.

**Note (vs spec):** Spec described "rows pull from past frames in a buffer". That requires storing N×H×W×3 frames in memory. Implementation here uses a simpler technique that's just as visually distinctive without the memory cost: per-row vertical displacement modulated by time-of-row. Document this in CLAUDE.md in Task 16.

- [ ] **Step 1: Replace `_motion_slit_scan` body**

```python
    def _motion_slit_scan(self, base_grid, t, env_t, intensity, motion_speed, H, W):
        """Vertical wave: each row offsets by sin(k·y_norm + omega·t) · audio.
        Looks like a slit-scan time-displacement without needing a frame
        buffer."""
        device = base_grid.device
        ys = torch.linspace(-1, 1, H, device=device).unsqueeze(1).expand(H, W)
        # Number of waves visible vertically.
        k = 4.0 * math.pi
        omega = 2.0 * math.pi * max(motion_speed * 2.0, 0.4)
        A = env_t * intensity * 0.04  # grid units, ~4% of frame at full

        dy = A * torch.sin(k * ys - omega * t)
        # Add a small horizontal shimmer too so it doesn't look like a 1D wobble.
        dx = A * 0.5 * torch.cos(k * ys - omega * t)

        grid = base_grid.clone()
        grid[0, ..., 0] = grid[0, ..., 0] + dx
        grid[0, ..., 1] = grid[0, ..., 1] + dy
        return grid
```

- [ ] **Step 2: Smoke test in ComfyUI**

`motion_mode = slit_scan`. Expected: image rows offset in a traveling sine wave pattern, amplitude reactive to audio. **Screenshot.**

- [ ] **Step 3: Commit**

```bash
git add nodes/node_audio_react.py
git -c user.name=pixaroma -c user.email=pixaromadesign@gmail.com commit -m "audio_react: implement slit_scan motion mode

Per-row vertical sine displacement traveling at motion_speed×2 Hz,
amplitude modulated by audio envelope. Simpler than a full
frame-buffer slit-scan but visually distinctive and zero extra
memory cost."
```

Print `DONE: Task 9 — slit_scan working.`

---

## Task 10: Motion mode `kaleidoscope`

**Files:**
- Modify: `nodes/node_audio_react.py`

**Goal:** Polar-coordinate 6-segment radial mirror. Audio drives segment rotation (`theta_offset = env_t · intensity · π/3`). Sample from the source by:
1. Convert grid `(x, y)` → polar `(r, theta)`
2. Wrap `theta` into a single segment (0..π/3) by mirror-reflecting
3. Add `theta_offset` (rotation)
4. Convert back to `(x, y)` and use as sample coords

- [ ] **Step 1: Replace `_motion_kaleidoscope` body**

```python
    def _motion_kaleidoscope(self, base_grid, t, env_t, intensity, motion_speed, H, W):
        """6-segment radial mirror, segment rotation driven by audio + slow
        time advance. Renders best on roughly-square aspects; tooltip says so."""
        device = base_grid.device
        segments = 6
        seg_angle = 2.0 * math.pi / segments  # π/3

        # Aspect-correct so the mirror stays radial on non-square frames.
        ys = base_grid[0, ..., 1]   # in [-1, 1]
        xs = base_grid[0, ..., 0]
        aspect = W / H

        x_corr = xs * aspect
        r = torch.sqrt(x_corr ** 2 + ys ** 2)
        theta = torch.atan2(ys, x_corr)

        # Slow time rotation + audio-driven additional rotation.
        rot = motion_speed * t * 0.5 + env_t * intensity * seg_angle * 0.5
        theta_shifted = theta - rot

        # Wrap theta into [0, seg_angle] using a triangle-wave (mirror).
        theta_mod = torch.remainder(theta_shifted, 2.0 * seg_angle)
        # theta_mod in [0, 2·seg]: first half forward, second half mirrored.
        mask = theta_mod > seg_angle
        theta_mirror = torch.where(mask, 2.0 * seg_angle - theta_mod, theta_mod)
        # Center the wedge around the original theta direction.
        theta_final = theta_mirror

        x_new = r * torch.cos(theta_final) / aspect
        y_new = r * torch.sin(theta_final)

        grid = base_grid.clone()
        grid[0, ..., 0] = x_new
        grid[0, ..., 1] = y_new
        # Clamp into valid sampling range; padding_mode="border" handles the rest.
        grid = grid.clamp(-1.0, 1.0)
        return grid
```

- [ ] **Step 2: Smoke test in ComfyUI**

`motion_mode = kaleidoscope`. Expected: 6-fold symmetry visible, segments rotate slowly, additional snap rotation on audio peaks. **Screenshot at three different time points to show rotation.**

- [ ] **Step 3: Commit**

```bash
git add nodes/node_audio_react.py
git -c user.name=pixaroma -c user.email=pixaromadesign@gmail.com commit -m "audio_react: implement kaleidoscope motion mode

6-segment radial mirror with slow time rotation + audio-driven
rotation overlay. Aspect-correct so non-square frames still render
radial symmetry."
```

Print `DONE: Task 10 — kaleidoscope working. All 6 motion modes done.`

---

## Task 11: Overlay `glitch_strength`

**Files:**
- Modify: `nodes/node_audio_react.py`

**Goal:** RGB-channel offset spikes on transients (`onset_t`), occasional row swap on big spikes. Resolution-relative offset (`onset_t · strength · 0.012 · min(W, H)` px).

- [ ] **Step 1: Replace `_overlay_glitch` body**

```python
    def _overlay_glitch(self, frame, onset_t, strength, H, W):
        """RGB shift on transients + scanline swap on big spikes."""
        if onset_t <= 0.001 or strength <= 0:
            return frame
        # Resolution-relative pixel offset.
        max_px = max(1, int(onset_t * strength * 0.012 * min(H, W)))
        # Random per-channel sign each call. Determinism would over-stabilize.
        # Use the onset value to seed for repeatability across re-runs.
        g = torch.Generator().manual_seed(int(onset_t * 1e6) & 0xFFFF)
        signs = torch.randint(0, 2, (3,), generator=g) * 2 - 1
        offsets = signs * max_px
        # frame shape [H, W, 3]; shift each channel along width.
        out = frame.clone()
        for c in range(3):
            ox = offsets[c].item()
            if ox > 0:
                out[:, ox:, c] = frame[:, :W - ox, c]
                out[:, :ox, c] = frame[:, :ox, c]  # leave edge column as-is
            elif ox < 0:
                ox = -ox
                out[:, :W - ox, c] = frame[:, ox:, c]
                out[:, W - ox:, c] = frame[:, W - ox:, c]

        # Scanline swap on big spikes.
        if onset_t * strength > 0.7:
            # Swap ~5% of rows with their neighbors (blocky tear).
            n_swap = max(1, H // 20)
            row_idx = torch.randint(0, H - 1, (n_swap,), generator=g)
            for ri in row_idx.tolist():
                tmp = out[ri].clone()
                out[ri] = out[ri + 1]
                out[ri + 1] = tmp
        return out
```

- [ ] **Step 2: Smoke test in ComfyUI**

`motion_mode = scale_pulse`, `glitch_strength = 0.6`. Expected: visible RGB-shift fringes on bass hits, occasional scanline tears. **Screenshot a frame with active glitch.**

- [ ] **Step 3: Commit**

```bash
git add nodes/node_audio_react.py
git -c user.name=pixaroma -c user.email=pixaromadesign@gmail.com commit -m "audio_react: implement glitch overlay

RGB-channel offset spikes on transients with resolution-relative
amplitude, occasional 5% scanline-row swap on big onsets. Seeded
by onset value so the same audio re-renders identically."
```

Print `DONE: Task 11 — glitch overlay working.`

---

## Task 12: Overlay `bloom_strength`

**Files:**
- Modify: `nodes/node_audio_react.py`

**Goal:** Gaussian-blurred copy add-blended back onto frame, weight tracks audio envelope. Implementation: downsample by 4× → Gaussian blur via `F.conv2d` with a separable kernel → upsample back → screen-blend with frame using weight `env_t · strength · 0.6`.

- [ ] **Step 1: Replace `_overlay_bloom` body**

```python
    def _overlay_bloom(self, frame, env_t, strength):
        """Gaussian-glow add-blend pulsing with audio envelope."""
        if env_t <= 0.001 or strength <= 0:
            return frame
        weight = env_t * strength * 0.6
        # frame: [H, W, 3] → [1, 3, H, W]
        x = frame.permute(2, 0, 1).unsqueeze(0)
        # Downsample 4× for speed, then blur, then upsample back.
        small = F.interpolate(x, scale_factor=0.25, mode="bilinear", align_corners=False)
        # Separable Gaussian kernel size 9, sigma 2.
        ksize = 9
        sigma = 2.0
        coords = torch.arange(ksize, dtype=torch.float32, device=x.device) - (ksize - 1) / 2
        g1 = torch.exp(-(coords ** 2) / (2 * sigma ** 2))
        g1 = g1 / g1.sum()
        # Apply per-channel: build a [3, 1, ksize, 1] then [3, 1, 1, ksize] kernel
        kx = g1.view(1, 1, 1, ksize).expand(3, 1, 1, ksize)
        ky = g1.view(1, 1, ksize, 1).expand(3, 1, ksize, 1)
        small = F.conv2d(small, kx, padding=(0, ksize // 2), groups=3)
        small = F.conv2d(small, ky, padding=(ksize // 2, 0), groups=3)
        big = F.interpolate(small, size=x.shape[-2:], mode="bilinear", align_corners=False)
        # Screen-like blend: out = 1 - (1 - frame) * (1 - weight * blurred)
        bloom_layer = (big * weight).clamp(0, 1)
        out = 1.0 - (1.0 - x).clamp(0, 1) * (1.0 - bloom_layer)
        out = out.clamp(0, 1).squeeze(0).permute(1, 2, 0)
        return out
```

- [ ] **Step 2: Smoke test in ComfyUI**

`motion_mode = scale_pulse`, `bloom_strength = 0.7`. Expected: highlights bloom out softly, pulse with bass. **Screenshot.**

- [ ] **Step 3: Commit**

```bash
git add nodes/node_audio_react.py
git -c user.name=pixaroma -c user.email=pixaromadesign@gmail.com commit -m "audio_react: implement bloom overlay

Downsample 4× → separable Gaussian blur (kernel 9, sigma 2) →
upsample → screen-blend with frame at weight env_t × strength × 0.6.
Cheap (4× downsample) and pulses cleanly with audio envelope."
```

Print `DONE: Task 12 — bloom overlay working.`

---

## Task 13: Overlay `vignette_strength`

**Files:**
- Modify: `nodes/node_audio_react.py`

**Goal:** Radial mask that darkens edges; mask strength `env_t · strength · 0.5`.

- [ ] **Step 1: Replace `_overlay_vignette` body**

```python
    def _overlay_vignette(self, frame, env_t, strength, H, W, device):
        """Audio-pulsing vignette."""
        if env_t <= 0.001 or strength <= 0:
            return frame
        ys = torch.linspace(-1, 1, H, device=device).unsqueeze(1).expand(H, W)
        xs = torch.linspace(-1, 1, W, device=device).unsqueeze(0).expand(H, W)
        r = torch.sqrt(xs ** 2 + ys ** 2).clamp(0, 1.4)
        # Smoothstep from 0 at center to 1 at corners (sqrt(2) ≈ 1.414).
        v = (r / 1.414).clamp(0, 1)
        # Mask: 1 in center, (1 - strength·env) at edges.
        mask = 1.0 - (v * env_t * strength * 0.5)
        return frame * mask.unsqueeze(-1)
```

- [ ] **Step 2: Smoke test in ComfyUI**

`vignette_strength = 0.7`. Expected: corners pulse darker on bass. **Screenshot.**

- [ ] **Step 3: Commit**

```bash
git add nodes/node_audio_react.py
git -c user.name=pixaroma -c user.email=pixaromadesign@gmail.com commit -m "audio_react: implement vignette overlay

Radial darkening mask, strength tracks audio envelope. Smoothstep
from center to corners (√2 normalization); peak darkening at
corners is env_t × strength × 0.5."
```

Print `DONE: Task 13 — vignette overlay working.`

---

## Task 14: Overlay `hue_shift_strength`

**Files:**
- Modify: `nodes/node_audio_react.py`

**Goal:** HSV hue rotation by `env_t · strength · 30°`. Simple matrix-rotation in YIQ-like space avoids needing an HSV roundtrip; we'll use the standard hue-rotation matrix.

- [ ] **Step 1: Replace `_overlay_hue_shift` body**

```python
    def _overlay_hue_shift(self, frame, env_t, strength):
        """Rotate hue by env_t · strength · 30° using the standard
        rotation-around-grayscale-axis matrix."""
        if env_t <= 0.001 or strength <= 0:
            return frame
        angle = env_t * strength * (30.0 * math.pi / 180.0)
        c = math.cos(angle)
        s = math.sin(angle)
        # Rotation around the (1,1,1) gray axis. Standard formula.
        m = torch.tensor([
            [0.299 + 0.701 * c + 0.168 * s, 0.587 - 0.587 * c + 0.330 * s, 0.114 - 0.114 * c - 0.497 * s],
            [0.299 - 0.299 * c - 0.328 * s, 0.587 + 0.413 * c + 0.035 * s, 0.114 - 0.114 * c + 0.292 * s],
            [0.299 - 0.300 * c + 1.250 * s, 0.587 - 0.588 * c - 1.050 * s, 0.114 + 0.886 * c - 0.203 * s],
        ], device=frame.device, dtype=frame.dtype)
        # frame [H, W, 3] · m^T → [H, W, 3]
        out = frame @ m.T
        return out.clamp(0, 1)
```

- [ ] **Step 2: Smoke test in ComfyUI**

`hue_shift_strength = 0.8`. Expected: colors gently cycle with audio (max 30° rotation at full env+strength). **Screenshot.**

- [ ] **Step 3: Commit**

```bash
git add nodes/node_audio_react.py
git -c user.name=pixaroma -c user.email=pixaromadesign@gmail.com commit -m "audio_react: implement hue_shift overlay

Color rotation around the (1,1,1) gray axis by env_t × strength × 30°.
Standard hue-rotation matrix in linear RGB — fast (one matrix
multiply per frame) and visually clean."
```

Print `DONE: Task 14 — hue_shift overlay working. All 4 overlays done.`

---

## Task 15: Final QA — combo smoke test + edge cases

**Files:** none changed; verification only.

**Goal:** Run a matrix of combinations to confirm nothing regressed and the "drop-in defaults" produce something good.

- [ ] **Step 1: Smoke test all 6 modes individually**

For each `motion_mode`, run the workflow with `intensity = 0.8`, all overlays = 0. Save the 6 output MP4s. Verify each one:
- runs without error
- produces visually-different motion from the others
- envelope visibly drives the motion (silence = no motion, hits = motion peaks)

- [ ] **Step 2: Smoke test all 4 overlays stacked at 0.5 each**

`motion_mode = scale_pulse`, `glitch_strength = 0.5`, `bloom_strength = 0.5`, `vignette_strength = 0.5`, `hue_shift_strength = 0.5`. Run. Expected: visible glitch on hits, soft bloom, vignette pulse, hue cycle — all composable, no crashes.

- [ ] **Step 3: Smoke test extreme values**

- `intensity = 2.0`, `motion_mode = ripple` — strong ripple
- `intensity = 0.0`, `motion_mode = scale_pulse` — completely still output (no motion at all)
- `audio_band = bass`, `motion_mode = zoom_punch` — only bass drum hits trigger zoom
- `loop_safe = True`, run, verify first-frame and last-frame are visually identical (within compression noise)
- `aspect_ratio = 1920x1080 (Landscape FHD)` with a portrait input image — should crop+resize cleanly
- `aspect_ratio = Custom Ratio 16:9 (Uses Width)` with `custom_width = 1280` — should produce 1280×720

- [ ] **Step 4: Smoke test "default-just-works"**

Drop a fresh node. Touch nothing except wiring image + audio. Run. Expected: a watchable cinematic clip with `scale_pulse` at intensity 0.8, no overlays, audio-driven. **Screenshot the final preview.**

- [ ] **Step 5: Commit anything that broke + got fixed; if nothing changed, no-op**

If issues surfaced, fix inline and:

```bash
git add nodes/node_audio_react.py
git -c user.name=pixaroma -c user.email=pixaromadesign@gmail.com commit -m "audio_react: QA fixes from final smoke test"
```

Print `DONE: Task 15 — full QA done. All modes + overlays + edge cases pass.`

---

## Task 16: Docs — CLAUDE.md and README.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Goal:** Document the new node so future agents and users know it exists and where to find it.

- [ ] **Step 1: Add row to the "Token-Saving Rules" file-task table in `CLAUDE.md`**

Find the table headed `| Task | Read this file |` (under "Use the file names to find code"). Add a row alphabetically near the existing audio-related rows:

```markdown
| Add / change Audio React Pixaroma motion or overlay | `nodes/node_audio_react.py` (single file — helpers, motion-mode functions `_motion_*`, overlay functions `_overlay_*`, and `generate()` per-frame loop) |
```

- [ ] **Step 2: Add brief mention to the Architecture / Entry Points section of `CLAUDE.md`**

In the "Architecture" → "Entry Points" or "Backend Routes" area, find the line that mentions the existing nodes; add:
- `nodes/node_audio_react.py` — Audio React Pixaroma (image + audio → audio-reactive video, no depth model). 6 motion modes, 4 overlay effects.

- [ ] **Step 3: Add a one-paragraph "Audio React Pixaroma" section to `README.md`**

Find the existing "Audio Depth Pixaroma" section. Add a similar block right below it:

```markdown
### Audio React Pixaroma

Single image + audio → audio-reactive video. **No depth model needed** — opinionated, drop-in, fast. Pick from 6 motion modes (scale pulse, zoom punch, shake, ripple, slit-scan, kaleidoscope) and stack up to 4 overlay effects (glitch, bloom, vignette, hue shift). Sizing controls and audio-band filter mirror Audio Depth Pixaroma. Pairs with Save Mp4 Pixaroma for one-shot rendering.
```

- [ ] **Step 4: Note the slit_scan implementation choice in CLAUDE.md "Audio React Patterns" subsection**

Add a new subsection "Audio React Patterns (do not regress)" near the existing "Audio Depth" patterns area, with one entry:

```markdown
1. **slit_scan is a per-row time-evolving sine wave, NOT a frame-buffer pull** — the spec at `docs/superpowers/specs/2026-04-27-audio-react-pixaroma-design.md` originally described slit_scan as pulling rows from past frames in a buffer (`num_frames × H × W × 3` memory). The implementation simplifies this to per-row vertical sine displacement at row-shifted phase, audio-modulated amplitude — visually the same kind of "time-displaced rows" effect at zero extra memory cost. If you ever switch to a real frame buffer, clamp lookback to ≤ 0.5s of frames or memory blows up at high fps / 4K.
```

- [ ] **Step 5: Commit docs**

```bash
git add CLAUDE.md README.md
git -c user.name=pixaroma -c user.email=pixaromadesign@gmail.com commit -m "docs: add Audio React Pixaroma to CLAUDE.md + README

- Token-saving file-task table row pointing to node_audio_react.py
- Entry-points mention in Architecture section
- README feature blurb parallel to Audio Depth Pixaroma
- New 'Audio React Patterns (do not regress)' subsection
  documenting the simplified slit_scan implementation choice"
```

Print `DONE: Task 16 — docs updated. Audio React Pixaroma feature is fully shipped.`

---

## Self-Review Notes (for the executing engineer)

**Spec coverage check** — every spec section has at least one task:

| Spec section | Implementing task |
|--------------|-------------------|
| 3. Inputs/Outputs | Task 1 (declares); Task 5 (wires up) |
| 4. Sizing widgets | Task 1 (declared) + Task 4 (uses) + Task 5 (applies in generate) |
| 4. Motion modes | Tasks 5–10 (one per mode) |
| 4. Overlays | Tasks 11–14 (one per overlay) |
| 4. Shared params | Task 1 (declared) + Task 5 (envelope, smoothing, fps, intensity) + Task 15 (loop_safe, edge_headroom, audio_band combos) |
| 5. Architecture | Tasks 2–14 build the file structure described |
| 6. Defaults | Task 1 sets defaults; Task 15 step 4 verifies "drop-in" works |
| 7. Performance budget | Task 15 step 1 (smoke confirms render time visually) |
| 8. Out of scope | not implemented (correctly) |
| 9. File touch list | Tasks 1, 16 (matches the table exactly) |
| 10. Risks | Task 9 documents the slit_scan choice; Task 16 step 4 records it for future agents |
| 11. Acceptance criteria | Task 15 (the 6 acceptance items map to its smoke-test steps) |

**Type / signature consistency check**:
- `_motion_*` signatures vary by mode, but all return a `[1, H, W, 2]` grid in `[-1, 1]`. The dispatcher in `generate()` calls each with the right args.
- Overlay signatures all take `frame` (`[H, W, 3]`) and return `[H, W, 3]`. Consistent.
- `env_t` (Python float) vs `envelope` (`[T]` tensor) vs `onset` (`[T]` tensor) vs `onset_t` (Python float): consistent; `_t` suffix means scalar at frame `t`.

**Placeholder scan**: zero TBDs, zero "implement later", zero "similar to". Every step has complete code or exact verification commands.
