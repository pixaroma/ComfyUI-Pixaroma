# AudioReact Pixaroma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Dispatch each task subagent with `model: "sonnet"` (heavy code-writing) or `model: "opus"` (planning/review). Do not use cheaper default models — quality matters.**

**Goal:** Add a sibling node (AudioReact Pixaroma) to Audio React Pixaroma. Same effect math; full live editor in a fullscreen browser overlay (WebGL preview + transport bar + tabbed sidebar). Both nodes share a registry-based effect engine. ~3500 LOC across multiple files.

**Architecture:** Three pieces: (1) Python — extract effect math from `nodes/node_audio_react.py` into `nodes/_audio_react_engine.py` (registries + helpers + `Params` dataclass + `generate_video()`); add thin `nodes/node_audio_studio.py` wrapper; refactor existing Audio React node to delegate to the engine. (2) JS — new `js/audio_studio/` directory mirroring the Image Composer / 3D Builder editor pattern (mixin-class shell, fullscreen overlay, tabbed sidebar, transport bar, WebGL renderer). (3) Parity — `docs/audio-react-math.md` (math doc), `scripts/audio_parity_check.py` (Python golden test), 64 reference PNGs, `assets/audio_studio_parity/index.html` (manual browser parity harness).

**Tech Stack:** Python 3 + PyTorch (existing). JS: vanilla, no bundler, no deps. WebGL2 for rendering. Web Audio API for decode + playback. Persistence Pattern #9 (`hidden` Python input + `node.properties` + `app.graphToPrompt` injection — same as Resolution Pixaroma).

**Spec:** `docs/superpowers/specs/2026-04-27-audio-studio-pixaroma-design.md` — read first.

**Testing context:** No pytest framework in this project. The Python engine has a parity-script test (`scripts/audio_parity_check.py`) — golden frames committed under `tests/audio_parity_goldens/`. JS / WebGL / UI work has manual smoke-test verification steps. Always print a clear `"DONE: <task name>"` line at the end of each task so the user knows when to test.

**Multi-session execution:** Milestones A–I are natural session break-points. The plan assumes execution can pause between any two milestones and resume cold. Each task within a milestone is also self-contained — exact files, exact code, exact commands.

**Reference patterns from CLAUDE.md (consult often):**
- Vue Frontend Compatibility (#1–#9) — apply to every JS file that touches a node
- Note Pixaroma Patterns #5, #11 — for editor undo + neutering Ctrl+Z escape
- Resolution Pixaroma — for Pattern #9 (hidden state via `node.properties` + `graphToPrompt`)
- Image Composer — for upstream-input resolution pattern
- 3D Builder — for fullscreen overlay shell + Three.js style lazy import

**Git workflow:** Each task ends with a local commit on `Ioan` branch. Push to GitHub only when the user explicitly says so. Commit message format: `audio_studio: <imperative summary>` for new code, `audio_react: <summary>` for engine-extraction commits that touch only the existing node.

---

## File Structure

| File | Action | Lines | Notes |
|------|--------|-------|-------|
| `nodes/_audio_react_engine.py` | NEW | ~550 | Shared engine — registries, helpers, Params, generate_video |
| `nodes/node_audio_studio.py` | NEW | ~150 | Thin wrapper — parses studio_json, resolves sources, calls engine |
| `nodes/node_audio_react.py` | MODIFY | 600 → ~100 | Refactor to use engine — mechanical move, identical output |
| `js/audio_studio/index.js` | NEW | ~250 | Extension entry, button on node, app.graphToPrompt hook, queueMicrotask init |
| `js/audio_studio/core.mjs` | NEW | ~400 | AudioStudioEditor class shell — open/close/save/discard, undo, Vue-compat |
| `js/audio_studio/transport.mjs` | NEW | ~300 | Transport bar UI + Web Audio playback + sparkline |
| `js/audio_studio/audio_analysis.mjs` | NEW | ~300 | Decode, inline FFT, 4-band envelope + onset, WAV writer |
| `js/audio_studio/render.mjs` | NEW | ~350 | WebGL2 init, framebuffers, motion + overlay passes, render(frame) |
| `js/audio_studio/shaders.mjs` | NEW | ~600 | VERTEX_SHADER + 8 motion shaders + 1 combined-overlay shader |
| `js/audio_studio/ui.mjs` | NEW | ~400 | Sidebar tabs, controls, header pills, modals |
| `js/audio_studio/api.mjs` | NEW | ~80 | Backend wrappers — uploadSource, fetchUpstreamPath helpers |
| `scripts/audio_parity_check.py` | NEW | ~250 | Golden test runner for Python engine |
| `docs/audio-react-math.md` | NEW | ~400 | Single source of truth for every formula |
| `tests/audio_parity_goldens/manifest.json` | NEW | ~80 | Test manifest (mode/frame/params) |
| `tests/audio_parity_goldens/*.png` | NEW | 64 PNGs | Reference frames |
| `assets/audio_studio_parity/index.html` | NEW | ~350 | Manual browser parity harness |
| `assets/audio_studio_parity/test_image.png` | NEW | 1 file | Fixed parity test image (committed) |
| `server_routes.py` | MODIFY | +120 | New `/pixaroma/api/audio_studio/upload` route |
| `__init__.py` | MODIFY | +5 | Register `PixaromaAudioStudio` |
| `CLAUDE.md` | MODIFY | +200 | AudioReact section + new "do not regress" patterns |
| `README.md` | MODIFY | +30 | AudioReact feature blurb |

---

## Milestone A — Engine extraction (Python)

**Goal:** Refactor `nodes/node_audio_react.py` into a thin wrapper around a new shared engine module `nodes/_audio_react_engine.py`. Mechanical move only, **zero algorithmic changes**. After this milestone, current Audio React workflows render byte-identical output.

**Critical: Capture a parity baseline FIRST so the refactor can be regression-tested.**

### Task A1: Test image + parity script skeleton (no engine yet)

**Files:**
- Create: `assets/audio_studio_parity/test_image.png` — committed 512×512 fixed test image
- Create: `tests/audio_parity_goldens/manifest.json` — defines what to test
- Create: `scripts/audio_parity_check.py` — runs the current `PixaromaAudioReact.generate()` against fixed inputs, saves PNGs

**Goal:** Establish reproducible Python golden tests against the *current* Audio React node, BEFORE the engine refactor. These goldens become the regression test.

- [ ] **Step 1: Create the test image**

Take any 512×512 image with high-frequency detail (e.g. a crop of a busy photograph, or a synthesized noise pattern) and save it to `assets/audio_studio_parity/test_image.png`. The image needs visible texture so motion warps are observable.

If no source available, generate one programmatically:
```python
# Run once at the project root:
import numpy as np
from PIL import Image
np.random.seed(0)
arr = np.random.rand(512, 512, 3) * 255
arr = arr.astype(np.uint8)
# Add a few sharp edges for parity sensitivity
arr[100:110, :, :] = 255  # white horizontal stripe
arr[:, 200:210, :] = 0    # black vertical stripe
arr[300:340, 300:340, 0] = 255   # red square
Image.fromarray(arr).save("assets/audio_studio_parity/test_image.png")
```

- [ ] **Step 2: Create the manifest**

Write `tests/audio_parity_goldens/manifest.json`:
```json
{
  "version": 1,
  "test_image": "assets/audio_studio_parity/test_image.png",
  "audio": {
    "duration_s": 4.0,
    "sample_rate": 22050,
    "fps": 30,
    "seed": 42,
    "description": "Sine sweep 100-2000 Hz + onset spikes at frames 30, 60, 90"
  },
  "motion_tests": [
    {"mode": "scale_pulse",  "frames": [0, 6, 12, 18, 24, 30]},
    {"mode": "zoom_punch",   "frames": [0, 6, 12, 18, 24, 30]},
    {"mode": "shake",        "frames": [0, 6, 12, 18, 24, 30], "approximate": true},
    {"mode": "drift",        "frames": [0, 6, 12, 18, 24, 30]},
    {"mode": "rotate_pulse", "frames": [0, 6, 12, 18, 24, 30]},
    {"mode": "ripple",       "frames": [0, 6, 12, 18, 24, 30]},
    {"mode": "swirl",        "frames": [0, 6, 12, 18, 24, 30]},
    {"mode": "slit_scan",    "frames": [0, 6, 12, 18, 24, 30]}
  ],
  "overlay_tests": [
    {"name": "glitch",    "strength": 0.7, "frames": [12, 30, 60, 90]},
    {"name": "bloom",     "strength": 0.7, "frames": [12, 30, 60, 90]},
    {"name": "vignette",  "strength": 0.7, "frames": [12, 30, 60, 90]},
    {"name": "hue_shift", "strength": 0.7, "frames": [12, 30, 60, 90]}
  ],
  "shared_params": {
    "intensity": 0.8,
    "audio_band": "full",
    "motion_speed": 0.2,
    "smoothing": 5,
    "loop_safe": false,
    "fps": 30,
    "aspect_ratio": "Original",
    "custom_width": 512,
    "custom_height": 512
  },
  "tolerance": {
    "rmse_max_pre_refactor_to_post_refactor": 0.0,
    "rmse_max_python_to_python_release": 1.0
  }
}
```

- [ ] **Step 3: Write `scripts/audio_parity_check.py`**

This script renders frames using the *currently-installed* `PixaromaAudioReact.generate()` (pre-engine-extraction). Write it so the import path works regardless of where the script is invoked from:

```python
# scripts/audio_parity_check.py
"""Audio React / AudioReact parity check.

Renders 64 reference frames using PixaromaAudioReact and compares against
committed goldens in tests/audio_parity_goldens/.

Usage:
    python scripts/audio_parity_check.py              # diff vs goldens, exit non-zero on fail
    python scripts/audio_parity_check.py --regenerate # overwrite goldens (intentional, never default)
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT.parent))  # custom_nodes/ on path
# Adjust the import below if your custom_nodes parent layout differs.
from ComfyUI_Pixaroma.nodes.node_audio_react import PixaromaAudioReact

MANIFEST_PATH = REPO_ROOT / "tests" / "audio_parity_goldens" / "manifest.json"
GOLDENS_DIR  = REPO_ROOT / "tests" / "audio_parity_goldens"


def load_test_image(path):
    img = np.array(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0
    return torch.from_numpy(img).unsqueeze(0)  # [1, H, W, 3]


def synthesize_audio(duration_s, sample_rate, seed):
    """Deterministic test audio: sine sweep + onset spikes at known frames."""
    n = int(duration_s * sample_rate)
    t = np.arange(n) / sample_rate
    # Sine sweep 100-2000 Hz
    f0, f1 = 100.0, 2000.0
    phase = 2 * np.pi * (f0 * t + (f1 - f0) * t * t / (2 * duration_s))
    sweep = 0.3 * np.sin(phase)
    # Onset spikes at known timestamps (frames 30, 60, 90 at 30 fps)
    fps = 30
    spike_envelope = np.zeros(n, dtype=np.float32)
    for fr in (30, 60, 90):
        center = int(fr / fps * sample_rate)
        for i in range(max(0, center - 200), min(n, center + 200)):
            x = (i - center) / 200.0
            spike_envelope[i] += np.exp(-x * x * 8.0) * 0.7
    spikes = spike_envelope * np.random.RandomState(seed).randn(n) * 0.5
    waveform = (sweep + spikes).astype(np.float32)
    waveform = np.clip(waveform, -1.0, 1.0)
    return {
        "waveform": torch.from_numpy(waveform).view(1, 1, -1),
        "sample_rate": sample_rate,
    }


def render_frames(node, image, audio, params, motion_mode, glitch=0.0, bloom=0.0,
                  vignette=0.0, hue_shift=0.0):
    """Run PixaromaAudioReact.generate() once and return the full [F, H, W, 3]
    tensor. params is a dict mirroring the node's widget kwargs."""
    out = node.generate(
        image=image, audio=audio,
        aspect_ratio=params["aspect_ratio"],
        custom_width=params["custom_width"],
        custom_height=params["custom_height"],
        motion_mode=motion_mode,
        intensity=params["intensity"],
        audio_band=params["audio_band"],
        motion_speed=params["motion_speed"],
        smoothing=params["smoothing"],
        loop_safe=params["loop_safe"],
        fps=params["fps"],
        glitch_strength=glitch,
        bloom_strength=bloom,
        vignette_strength=vignette,
        hue_shift_strength=hue_shift,
    )
    return out[0]  # [F, H, W, 3]


def save_frame(tensor_hw3, path):
    arr = (tensor_hw3.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
    Image.fromarray(arr).save(path)


def diff_rmse(a_path, b_tensor_hw3):
    a = np.array(Image.open(a_path).convert("RGB"), dtype=np.float32)
    b = b_tensor_hw3.cpu().numpy() * 255.0
    return float(np.sqrt(((a - b) ** 2).mean()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--regenerate", action="store_true",
                    help="Overwrite goldens instead of diffing.")
    args = ap.parse_args()

    manifest = json.loads(MANIFEST_PATH.read_text())
    image = load_test_image(REPO_ROOT / manifest["test_image"])
    audio = synthesize_audio(
        manifest["audio"]["duration_s"],
        manifest["audio"]["sample_rate"],
        manifest["audio"]["seed"],
    )

    node = PixaromaAudioReact()
    params = manifest["shared_params"]

    fails = []
    GOLDENS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"== Audio parity check: {len(manifest['motion_tests'])} motion modes "
          f"+ {len(manifest['overlay_tests'])} overlay tests ==")

    # Motion tests
    for test in manifest["motion_tests"]:
        mode = test["mode"]
        approximate = test.get("approximate", False)
        frames = render_frames(node, image, audio, params, motion_mode=mode)
        for fr in test["frames"]:
            golden_path = GOLDENS_DIR / f"motion_{mode}_{fr:03d}.png"
            if args.regenerate:
                save_frame(frames[fr], golden_path)
                print(f"  WROTE {golden_path.name}")
            else:
                if not golden_path.exists():
                    fails.append(f"MISSING {golden_path.name}")
                    continue
                rmse = diff_rmse(golden_path, frames[fr])
                tol = manifest["tolerance"]["rmse_max_python_to_python_release"]
                marker = " (approximate)" if approximate else ""
                if rmse > tol:
                    fails.append(f"FAIL {golden_path.name}: rmse={rmse:.3f} > {tol}{marker}")
                    print(f"  FAIL {golden_path.name}: rmse={rmse:.3f}{marker}")
                else:
                    print(f"  OK   {golden_path.name}: rmse={rmse:.3f}{marker}")

    # Overlay tests (each overlay alone, scale_pulse motion underneath)
    for test in manifest["overlay_tests"]:
        name = test["name"]
        strength = test["strength"]
        kwargs = {f"{name}": strength}
        # The render_frames signature uses bare arg names — map by name.
        frames = render_frames(
            node, image, audio, params, motion_mode="scale_pulse",
            glitch=kwargs.get("glitch", 0.0),
            bloom=kwargs.get("bloom", 0.0),
            vignette=kwargs.get("vignette", 0.0),
            hue_shift=kwargs.get("hue_shift", 0.0),
        )
        for fr in test["frames"]:
            golden_path = GOLDENS_DIR / f"overlay_{name}_{fr:03d}.png"
            if args.regenerate:
                save_frame(frames[fr], golden_path)
                print(f"  WROTE {golden_path.name}")
            else:
                if not golden_path.exists():
                    fails.append(f"MISSING {golden_path.name}")
                    continue
                rmse = diff_rmse(golden_path, frames[fr])
                tol = manifest["tolerance"]["rmse_max_python_to_python_release"]
                if rmse > tol:
                    fails.append(f"FAIL {golden_path.name}: rmse={rmse:.3f} > {tol}")
                    print(f"  FAIL {golden_path.name}: rmse={rmse:.3f}")
                else:
                    print(f"  OK   {golden_path.name}: rmse={rmse:.3f}")

    print("==", "ALL OK" if not fails else f"{len(fails)} FAILS", "==")
    if fails and not args.regenerate:
        sys.exit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Generate the goldens against the CURRENT (unrefactored) node**

```bash
cd /path/to/ComfyUI/custom_nodes/ComfyUI-Pixaroma
python scripts/audio_parity_check.py --regenerate
```

Expected: 64 PNG files written to `tests/audio_parity_goldens/`. Verify with:
```bash
ls tests/audio_parity_goldens/*.png | wc -l
# Expected: 64
```

- [ ] **Step 5: Verify the diff path works**

```bash
python scripts/audio_parity_check.py
```

Expected: prints `OK` for all 64 tests, exits 0. If anything fails here it's a script bug — fix before continuing.

- [ ] **Step 6: Commit**

```bash
git add scripts/audio_parity_check.py tests/audio_parity_goldens/ assets/audio_studio_parity/test_image.png
git commit -m "audio_studio: add parity test script + 64 pre-refactor golden frames

These goldens lock the current PixaromaAudioReact output. Running the
parity script after the upcoming engine extraction must produce zero diffs
— that's the regression test for the refactor."
```

Print: `DONE: A1 (parity baseline captured — 64 PNG goldens, regression target locked)`

### Task A2: Engine module skeleton

**Files:**
- Create: `nodes/_audio_react_engine.py`

**Goal:** Empty engine module with imports, `Params` dataclass, empty registries, and a `generate_video` stub that just raises `NotImplementedError`. Registers no math yet — that lands in subsequent tasks. This task is the structural skeleton.

- [ ] **Step 1: Write the skeleton**

```python
# nodes/_audio_react_engine.py
"""Shared effect engine for Audio React Pixaroma and AudioReact Pixaroma.

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

# Registries — populated below by helper @register decorators (or static dicts).
# Both registries: name → callable. Adding a new effect = drop a function +
# register it. Both PixaromaAudioReact and PixaromaAudioStudio pick it up.
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
```

- [ ] **Step 2: Verify import works**

```bash
cd /path/to/ComfyUI/custom_nodes/ComfyUI-Pixaroma
python -c "from nodes._audio_react_engine import Params, MOTION_MODES, OVERLAYS, params_from_dict; p = Params(); print('motion_mode:', p.motion_mode, 'intensity:', p.intensity); print('regs:', len(MOTION_MODES), 'motion +', len(OVERLAYS), 'overlays')"
```

Expected output:
```
motion_mode: scale_pulse intensity: 0.8
regs: 0 motion + 0 overlays
```

- [ ] **Step 3: Verify parity script still works (sanity)**

```bash
python scripts/audio_parity_check.py
```

Expected: 64 OK lines (no engine references yet — script still uses `PixaromaAudioReact` directly).

- [ ] **Step 4: Commit**

```bash
git add nodes/_audio_react_engine.py
git commit -m "audio_react: add empty engine module skeleton

Defines Params dataclass, MOTION_MODES / OVERLAYS empty registries, and
stubs for the helpers + generate_video. All math lives in node_audio_react.py
still — extraction happens in subsequent commits to keep diffs reviewable."
```

Print: `DONE: A2 (engine skeleton landed; no behavior change)`

### Task A3: Move helpers (bandpass / envelope / onset / aspect) to engine

**Files:**
- Modify: `nodes/_audio_react_engine.py` — implement the four helpers
- Modify: `nodes/node_audio_react.py` — replace local helpers with `from ._audio_react_engine import ...`

**Goal:** Move the four helper functions from `node_audio_react.py` to the engine, verbatim. The node imports from the engine instead of defining them locally. Output must be byte-identical.

- [ ] **Step 1: Move `_bandpass_fft` to engine**

In `nodes/_audio_react_engine.py`, replace the `bandpass_fft` stub with the body of `_bandpass_fft` from `nodes/node_audio_react.py:55-66` (verbatim — keep exact docstring):

```python
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
```

- [ ] **Step 2: Move `_onset_track` to engine**

Replace the stub. The body is at `nodes/node_audio_react.py:69-91` (verbatim).

- [ ] **Step 3: Move `_process_aspect` to engine — convert from method to function**

The current method has `self` as first arg. In the engine, it's a free function (no `self`). The body at `nodes/node_audio_react.py:150-207` is otherwise unchanged:

```python
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
```

- [ ] **Step 4: Move `_audio_envelope` to engine — convert from method to function**

The body at `nodes/node_audio_react.py:209-251` is unchanged except for the `self` removal. Note: it calls `_bandpass_fft(...)` — change to `bandpass_fft(...)` (now a module-local name in the engine). It also references `_AUDIO_BANDS_HZ` — change to `AUDIO_BANDS_HZ`.

- [ ] **Step 5: Update `nodes/node_audio_react.py` to import from engine**

At the top of `node_audio_react.py`, after the existing torch / comfy imports, add:
```python
from ._audio_react_engine import (
    AUDIO_BANDS_HZ,
    bandpass_fft,
    onset_track,
    process_aspect,
    audio_envelope,
)
```

Then delete the local definitions of `_AUDIO_BANDS_HZ`, `_bandpass_fft`, `_onset_track` (lines 12-17, 55-91 of the current file).

Replace `self._process_aspect(...)` calls with `process_aspect(...)` (no self), and `self._audio_envelope(...)` calls with `audio_envelope(...)`. The `_onset_track(envelope)` call at line 535 becomes `onset_track(envelope)`.

The local methods `_process_aspect` and `_audio_envelope` (lines 150-207, 209-251) in the class can be DELETED.

- [ ] **Step 6: Run parity check — must show zero diffs**

```bash
python scripts/audio_parity_check.py
```

Expected: 64 `OK` lines, all `rmse=0.000`. **If any non-zero RMSE shows up, the move is not byte-identical — bisect by reverting one helper at a time.**

- [ ] **Step 7: Commit**

```bash
git add nodes/_audio_react_engine.py nodes/node_audio_react.py
git commit -m "audio_react: extract helpers (bandpass / envelope / onset / aspect) to engine

Mechanical move — helpers now live in nodes/_audio_react_engine.py and the
node imports them. Parity check confirms byte-identical output (rmse=0.000
on all 64 goldens)."
```

Print: `DONE: A3 (helpers extracted, byte-identical)`

### Task A4: Move motion modes to engine

**Files:**
- Modify: `nodes/_audio_react_engine.py` — register all 8 motion functions
- Modify: `nodes/node_audio_react.py` — replace `if/elif` dispatch with registry lookup

**Goal:** Move the 8 `_motion_*` methods to the engine as free functions registered in `MOTION_MODES`. The node's per-frame loop dispatches via `MOTION_MODES[mode](...)`.

- [ ] **Step 1: Define motion-function signature contract in engine**

Add a comment block in `nodes/_audio_react_engine.py` documenting the contract (motion functions must accept `(base_grid, env_t, onset_t, t, intensity, motion_speed, H, W, total_frames, frame_index, fps, onset_track_arr)` as a kwargs blob and return a `[1, H, W, 2]` tensor). Use a dataclass-like helper to make caller code clean:

```python
@dataclass
class MotionContext:
    """All possible inputs a motion function might need. Functions ignore
    fields they don't care about — keeps the dispatch uniform."""
    base_grid: torch.Tensor   # [1, H, W, 2]
    env_t: float
    onset_t: float
    t: float                   # seconds since clip start
    intensity: float
    motion_speed: float
    H: int
    W: int
    total_frames: int
    frame_index: int
    fps: int
    onset_arr: torch.Tensor   # [F] — full onset track (used by shake)
```

- [ ] **Step 2: Move each `_motion_*` method to engine**

For each of the 8 methods at `nodes/node_audio_react.py:253-386` (`_motion_scale_pulse`, `_motion_zoom_punch`, `_motion_shake`, `_motion_drift`, `_motion_rotate_pulse`, `_motion_swirl`, `_motion_ripple`, `_motion_slit_scan`):
1. Convert to free function `motion_<name>(ctx: MotionContext) -> torch.Tensor`.
2. Translate `self._shake_dx_cache` → use a function-local cache via `motion_shake.cache` attribute (since it's a module-level function not a class).
3. Drop `self.` prefixes on internal calls.
4. Register at module bottom: `MOTION_MODES["scale_pulse"] = motion_scale_pulse`, etc.

Concrete: `motion_scale_pulse` becomes:
```python
def motion_scale_pulse(ctx: MotionContext) -> torch.Tensor:
    """Uniform breathing zoom. env_t in [0,1], intensity in [0,2]."""
    s = ctx.env_t * ctx.intensity * 0.15
    return ctx.base_grid * (1.0 - s)

MOTION_MODES["scale_pulse"] = motion_scale_pulse
```

`motion_shake` is the trickiest because of the cache. Use a module-level cache dict keyed by `total_frames`:
```python
_SHAKE_CACHE: dict[int, tuple[torch.Tensor, torch.Tensor]] = {}

def motion_shake(ctx: MotionContext) -> torch.Tensor:
    """Translation jitter. Random direction per onset, exponential settle."""
    if ctx.total_frames not in _SHAKE_CACHE:
        g = torch.Generator().manual_seed(0)
        dx_raw = torch.randn(ctx.total_frames, generator=g) * ctx.onset_arr.cpu()
        dy_raw = torch.randn(ctx.total_frames, generator=g) * ctx.onset_arr.cpu()
        dx = torch.zeros_like(dx_raw); dy = torch.zeros_like(dy_raw)
        decay = 0.7
        for k in range(ctx.total_frames):
            if k == 0:
                dx[k] = dx_raw[k]; dy[k] = dy_raw[k]
            else:
                dx[k] = dx[k-1] * decay + dx_raw[k] * (1.0 - decay)
                dy[k] = dy[k-1] * decay + dy_raw[k] * (1.0 - decay)
        _SHAKE_CACHE[ctx.total_frames] = (dx.to(ctx.base_grid.device),
                                          dy.to(ctx.base_grid.device))
    dx_arr, dy_arr = _SHAKE_CACHE[ctx.total_frames]
    amp = ctx.intensity * 0.04
    dx = dx_arr[ctx.frame_index] * amp
    dy = dy_arr[ctx.frame_index] * amp
    grid = ctx.base_grid.clone()
    grid[..., 0] = grid[..., 0] - dx
    grid[..., 1] = grid[..., 1] - dy
    return grid

MOTION_MODES["shake"] = motion_shake


def reset_motion_caches():
    """Called by generate_video at the top of each render; the shake cache
    depends on total_frames, which differs per audio length."""
    _SHAKE_CACHE.clear()
```

The other six follow the same pattern — translate `self._motion_X(args)` to `motion_X(ctx)` and pull args from ctx fields.

- [ ] **Step 3: Update `node_audio_react.py` per-frame loop**

In `node_audio_react.py:557-578`, the `if motion_mode == "scale_pulse": ... elif ...` chain becomes:

```python
ctx = MotionContext(
    base_grid=base_grid,
    env_t=env_t,
    onset_t=onset_t,
    t=t_vec[i].item(),
    intensity=intensity,
    motion_speed=motion_speed,
    H=H, W=W,
    total_frames=total_frames,
    frame_index=i,
    fps=fps,
    onset_arr=onset,
)
grid = MOTION_MODES[motion_mode](ctx)
```

At the top of `generate()`, after the `total_frames` is computed, replace the existing shake-cache-clear block with `reset_motion_caches()`.

Update imports in `node_audio_react.py`:
```python
from ._audio_react_engine import (
    AUDIO_BANDS_HZ, MOTION_MODES, MotionContext,
    bandpass_fft, onset_track, process_aspect, audio_envelope,
    reset_motion_caches,
)
```

Delete the 8 `_motion_*` methods from the `PixaromaAudioReact` class.

- [ ] **Step 4: Run parity — must be zero diffs**

```bash
python scripts/audio_parity_check.py
```

Expected: 64 `OK` lines with `rmse=0.000`. If shake breaks (likely candidate due to cache key changes), check that `total_frames` is the same value on both sides of the move.

- [ ] **Step 5: Commit**

```bash
git add nodes/_audio_react_engine.py nodes/node_audio_react.py
git commit -m "audio_react: extract motion modes to engine via MOTION_MODES registry

Each _motion_* method becomes motion_<name>(ctx) in the engine, registered
in MOTION_MODES. Per-frame dispatch is now a single dictionary lookup
instead of an if/elif chain. Parity confirms byte-identical output."
```

Print: `DONE: A4 (8 motion modes registered in engine)`

### Task A5: Move overlays to engine

**Files:**
- Modify: `nodes/_audio_react_engine.py` — register the 4 overlays
- Modify: `nodes/node_audio_react.py` — replace overlay if-chain with registry iteration

**Goal:** Move `_overlay_glitch` / `_overlay_bloom` / `_overlay_vignette` / `_overlay_hue_shift` to engine. Per-frame loop iterates `for name, fn in OVERLAYS.items(): if strength > 0: frame = fn(...)`.

- [ ] **Step 1: Define overlay-function contract**

Add to engine:
```python
@dataclass
class OverlayContext:
    frame: torch.Tensor   # [H, W, 3] in [0, 1]
    env_t: float
    onset_t: float
    strength: float
    H: int
    W: int
    device: torch.device
```

- [ ] **Step 2: Move each `_overlay_*` to engine**

Same pattern as A4. `_overlay_glitch` body from `node_audio_react.py:388-416` becomes `overlay_glitch(ctx) -> torch.Tensor`. Register: `OVERLAYS["glitch"] = overlay_glitch`. Repeat for bloom / vignette / hue_shift.

- [ ] **Step 3: Update `node_audio_react.py` per-frame overlay block**

The block at `node_audio_react.py:586-594` becomes:
```python
strengths = {
    "glitch": glitch_strength,
    "bloom": bloom_strength,
    "vignette": vignette_strength,
    "hue_shift": hue_shift_strength,
}
for name, fn in OVERLAYS.items():
    s = strengths.get(name, 0.0)
    if s > 0.0:
        ov_ctx = OverlayContext(frame=frame, env_t=env_t, onset_t=onset_t,
                                 strength=s, H=H, W=W, device=device)
        frame = fn(ov_ctx)
```

Add `OVERLAYS, OverlayContext` to the engine import line.

Delete the 4 `_overlay_*` methods from the class.

- [ ] **Step 4: Parity check**

```bash
python scripts/audio_parity_check.py
```

Expected: 64 `OK rmse=0.000` lines.

- [ ] **Step 5: Commit**

```bash
git add nodes/_audio_react_engine.py nodes/node_audio_react.py
git commit -m "audio_react: extract overlays to engine via OVERLAYS registry

4 overlays now live in _audio_react_engine.py registered in OVERLAYS.
Per-frame loop iterates the registry; strengths come from a small dict.
Parity confirms byte-identical output."
```

Print: `DONE: A5 (4 overlays registered in engine)`

### Task A6: Move generate() loop to engine

**Files:**
- Modify: `nodes/_audio_react_engine.py` — implement `generate_video()`
- Modify: `nodes/node_audio_react.py` — class becomes ~100-line thin wrapper

**Goal:** Final extraction step. The full per-frame loop from `node_audio_react.py:471-600` moves to `engine.generate_video(image, audio, params: Params)`. The node's `generate()` becomes a 10-line wrapper that builds Params, calls engine, returns the tuple.

- [ ] **Step 1: Implement `engine.generate_video()`**

Replace the `generate_video` stub:

```python
def generate_video(image: torch.Tensor, audio: dict, params: Params) -> torch.Tensor:
    """Render the full audio-reactive clip. Returns [F, H, W, 3] in [0, 1].

    Hard errors (no image, no audio, audio too short) raise ValueError with
    actionable messages. Soft warnings (unusual params) are returned by
    validate_params(); caller logs them.
    """
    if image is None:
        raise ValueError(
            "[Pixaroma] Audio engine — no image. Wire an IMAGE input or "
            "use AudioReact's inline-image picker."
        )
    if (audio is None or not isinstance(audio, dict)
            or "waveform" not in audio or "sample_rate" not in audio
            or audio["waveform"] is None
            or not isinstance(audio["sample_rate"], (int, float))
            or audio["sample_rate"] <= 0):
        raise ValueError(
            "[Pixaroma] Audio engine — no valid audio. Wire AUDIO input or "
            "use AudioReact's inline-audio picker."
        )

    device = comfy.model_management.get_torch_device()

    image, out_w, out_h = process_aspect(
        image, params.aspect_ratio, params.custom_width, params.custom_height,
    )
    img_tensor = image[0].permute(2, 0, 1).unsqueeze(0).to(device)
    _, _, H, W = img_tensor.shape

    audio_duration = audio["waveform"].shape[-1] / audio["sample_rate"]
    total_frames = int(audio_duration * params.fps)
    if total_frames <= 0:
        raise ValueError(
            f"Audio is too short to produce any frames at {params.fps} fps "
            f"(audio_duration={audio_duration:.3f}s)."
        )

    reset_motion_caches()

    envelope = audio_envelope(
        audio, total_frames, params.fps, device,
        params.audio_band, params.smoothing,
    )

    if params.loop_safe and total_frames >= 4:
        fade_n = max(2, min(int(params.fps * 0.5), total_frames // 2))
        loop_ramp = torch.linspace(0.0, 1.0, fade_n, device=device)
        envelope = envelope.detach().clone()
        envelope[:fade_n] = envelope[:fade_n] * loop_ramp
        envelope[-fade_n:] = envelope[-fade_n:] * loop_ramp.flip(0)

    onset = onset_track(envelope)

    comfy.model_management.soft_empty_cache()
    gc.collect()

    t_vec = torch.arange(total_frames, device=device, dtype=torch.float32) / params.fps

    y, x = torch.meshgrid(
        torch.linspace(-1, 1, H, device=device),
        torch.linspace(-1, 1, W, device=device),
        indexing="ij",
    )
    base_grid = torch.stack([x, y], dim=-1).unsqueeze(0)

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
            H=H, W=W,
            total_frames=total_frames, frame_index=i, fps=params.fps,
            onset_arr=onset,
        )
        grid = motion_fn(ctx)

        warped = F.grid_sample(
            img_tensor, grid,
            mode="bilinear", padding_mode="border", align_corners=False,
        )
        frame = warped.squeeze(0).permute(1, 2, 0)

        for name, fn in OVERLAYS.items():
            s = overlay_strengths.get(name, 0.0)
            if s > 0.0:
                ov_ctx = OverlayContext(frame=frame, env_t=env_t, onset_t=onset_t,
                                         strength=s, H=H, W=W, device=device)
                frame = fn(ov_ctx)

        frames.append(frame.cpu())
        pbar.update(1)

    return torch.stack(frames, dim=0)
```

- [ ] **Step 2: Refactor `node_audio_react.py` to thin wrapper**

The new file:
```python
# nodes/node_audio_react.py
"""Audio-reactive image-to-video without depth — widgets-only narrow surface.

Effect math lives in nodes/_audio_react_engine.py. This file is a thin
wrapper that surfaces the widget UI and delegates to the engine.
"""
from ._audio_react_engine import (
    ASPECT_OPTIONS, AUDIO_BANDS_HZ, MOTION_MODES,
    Params, generate_video, validate_params,
)


_MOTION_MODE_NAMES = list(MOTION_MODES.keys()) or [
    # Fallback in case MOTION_MODES is registered after import. Listed
    # explicitly so the dropdown's order is stable.
    "scale_pulse", "zoom_punch", "shake", "drift", "rotate_pulse",
    "ripple", "swirl", "slit_scan",
]


class PixaromaAudioReact:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Source still image to animate."}),
                "audio": ("AUDIO", {"tooltip": "Driver audio. Clip length = audio_duration × fps."}),
                "aspect_ratio": (ASPECT_OPTIONS, {"default": "Original", "tooltip": "..."}),
                "custom_width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8, "tooltip": "..."}),
                "custom_height": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8, "tooltip": "..."}),
                "motion_mode": (_MOTION_MODE_NAMES, {"default": "scale_pulse", "tooltip": "..."}),
                "intensity": ("FLOAT", {"default": 0.8, "min": 0.0, "max": 2.0, "step": 0.05, "tooltip": "..."}),
                "audio_band": (list(AUDIO_BANDS_HZ.keys()), {"default": "full", "tooltip": "..."}),
                "motion_speed": ("FLOAT", {"default": 0.2, "min": 0.05, "max": 1.0, "step": 0.05, "tooltip": "..."}),
                "smoothing": ("INT", {"default": 5, "min": 1, "max": 15, "step": 1, "tooltip": "..."}),
                "loop_safe": ("BOOLEAN", {"default": True, "tooltip": "..."}),
                "fps": ("INT", {"default": 24, "min": 8, "max": 60, "step": 1, "tooltip": "..."}),
                "glitch_strength": ("FLOAT", {"default": 0.6, "min": 0.0, "max": 1.0, "step": 0.05, "tooltip": "..."}),
                "bloom_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05, "tooltip": "..."}),
                "vignette_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05, "tooltip": "..."}),
                "hue_shift_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05, "tooltip": "..."}),
            }
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "FLOAT")
    RETURN_NAMES = ("video_frames", "audio", "fps")
    FUNCTION = "generate"
    CATEGORY = "👑 Pixaroma"

    def generate(self, image, audio, aspect_ratio, custom_width, custom_height,
                 motion_mode, intensity, audio_band, motion_speed, smoothing,
                 loop_safe, fps,
                 glitch_strength, bloom_strength, vignette_strength, hue_shift_strength):
        params = Params(
            motion_mode=motion_mode, intensity=intensity, audio_band=audio_band,
            motion_speed=motion_speed, smoothing=smoothing, loop_safe=loop_safe,
            fps=fps,
            glitch_strength=glitch_strength, bloom_strength=bloom_strength,
            vignette_strength=vignette_strength, hue_shift_strength=hue_shift_strength,
            aspect_ratio=aspect_ratio,
            custom_width=custom_width, custom_height=custom_height,
        )
        for diag in validate_params(params):
            print(f"[Pixaroma] Audio React — {diag}")
        frames = generate_video(image, audio, params)
        return (frames, audio, float(params.fps))


NODE_CLASS_MAPPINGS = {"PixaromaAudioReact": PixaromaAudioReact}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaAudioReact": "Audio React Pixaroma"}
```

**Important — preserve the long tooltip strings.** The placeholder `"..."` above is just to keep this plan readable. When refactoring, copy the full tooltip text from the current file (`nodes/node_audio_react.py:101-141`) verbatim into each widget's `tooltip` value. Tooltip language is documentation — don't lose it.

- [ ] **Step 3: Run parity — final byte-identical check**

```bash
python scripts/audio_parity_check.py
```

Expected: 64 `OK rmse=0.000` lines. **This is the regression test for the entire Milestone A refactor.** If anything fails here, bisect by `git diff HEAD~5` to find which extraction broke the math.

- [ ] **Step 4: Sanity test — open ComfyUI, drop the node, run a real workflow**

In ComfyUI: drop a Load Image + Load Audio + Audio React Pixaroma + Save Image (or Save Mp4 Pixaroma) chain. Use a 5-10s audio file. Run the workflow. Verify output frames look identical to what they did before the refactor (the user has previously-rendered MP4s for comparison).

If the smoke test fails but the parity script passes, the parity script's `synthesize_audio` likely doesn't cover the failure case — note the discrepancy and add a regression case to the manifest.

- [ ] **Step 5: Commit**

```bash
git add nodes/_audio_react_engine.py nodes/node_audio_react.py
git commit -m "audio_react: extract generate() to engine.generate_video()

Audio React node is now a ~100-line thin wrapper. All math lives in
_audio_react_engine.py. Parity confirms byte-identical output across all
64 goldens.

This is the foundation for the upcoming AudioReact Pixaroma sibling
node, which will share the same engine."
```

Print: `DONE: A6 (engine extraction complete; node_audio_react.py is now a thin wrapper)`

---

## Milestone B — AudioReact Python node + upload route

**Goal:** Land the Python side of AudioReact: a new node `PixaromaAudioStudio` that takes optional image / audio inputs + a hidden `studio_json` config, resolves sources, and calls the engine. Plus the new upload server route.

After this milestone, the node is registered in ComfyUI but has no JS yet — dropping it onto the canvas shows just the input slots and runs the engine on whatever is wired upstream + default params (since `studio_json` is empty).

### Task B1: `nodes/node_audio_studio.py` skeleton

**Files:**
- Create: `nodes/node_audio_studio.py`
- Modify: `__init__.py`

- [ ] **Step 1: Write the node**

```python
# nodes/node_audio_studio.py
"""AudioReact Pixaroma — sibling to Audio React Pixaroma.

Same effect math (shared engine in _audio_react_engine.py). Different UX:
a fullscreen browser editor with live WebGL preview replaces the
widgets-only surface. The editor saves config to a hidden `studio_json`
input via Pattern #9 (extension-scope app.graphToPrompt injection).

Source resolution at exec time:
- image: optional upstream IMAGE input. If unwired, loaded from disk at
  input/pixaroma/audio_studio/<node_id>/image.<ext>.
- audio: same dual-source pattern. Disk-stored audio is always WAV
  (browser converts before upload — see js/audio_studio/audio_analysis.mjs).
"""
from __future__ import annotations

import json
import os
import wave
from pathlib import Path

import numpy as np
import torch
from PIL import Image

import folder_paths

from ._audio_react_engine import (
    Params, generate_video, params_from_dict, validate_params,
)


PIXAROMA_INPUT_ROOT = Path(folder_paths.get_input_directory()) / "pixaroma"
AUDIO_STUDIO_DIR = PIXAROMA_INPUT_ROOT / "audio_studio"


def _migrate_cfg(cfg: dict) -> dict:
    """Apply schema_version migrations. v1 is the only version at ship —
    this is here so future migrations have an obvious home."""
    version = cfg.get("schema_version", 1)
    # Future: if version < N: ... apply migration ...
    return cfg


def _load_inline_image(rel_path: str) -> torch.Tensor:
    """Load PNG/JPG/WebP from input/pixaroma/audio_studio/... → IMAGE tensor
    [1, H, W, 3] in [0, 1]."""
    abs_path = PIXAROMA_INPUT_ROOT / rel_path
    if not abs_path.exists():
        raise ValueError(
            f"[Pixaroma] AudioReact — inline image missing at {abs_path}. "
            f"Re-open the editor and re-pick the image."
        )
    arr = np.array(Image.open(abs_path).convert("RGB"), dtype=np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


def _load_inline_audio(rel_path: str) -> dict:
    """Load WAV from input/pixaroma/audio_studio/... → AUDIO dict
    {waveform: [1, C, S], sample_rate: int}. WAV-only — browser converts
    other formats before upload."""
    abs_path = PIXAROMA_INPUT_ROOT / rel_path
    if not abs_path.exists():
        raise ValueError(
            f"[Pixaroma] AudioReact — inline audio missing at {abs_path}. "
            f"Re-open the editor and re-pick the audio."
        )
    with wave.open(str(abs_path), "rb") as wf:
        sample_rate = wf.getframerate()
        n_channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)
    if sample_width == 2:
        data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sample_width == 4:
        data = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    elif sample_width == 1:
        data = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise ValueError(
            f"[Pixaroma] AudioReact — unsupported WAV sample width "
            f"{sample_width} bytes. Re-encode to 16-bit PCM WAV."
        )
    if n_channels > 1:
        data = data.reshape(-1, n_channels).T  # [C, S]
    else:
        data = data.reshape(1, -1)             # [1, S]
    waveform = torch.from_numpy(data).unsqueeze(0)  # [1, C, S]
    return {"waveform": waveform, "sample_rate": sample_rate}


class PixaromaAudioStudio:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "optional": {
                "image": ("IMAGE", {"tooltip": "Optional upstream image. If wired, used as the source. If unwired, the editor's inline-loaded image is used."}),
                "audio": ("AUDIO", {"tooltip": "Optional upstream audio. Same dual-source pattern as image."}),
            },
            "hidden": {
                "studio_json": ("STRING", {"default": "{}"}),
            },
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "FLOAT")
    RETURN_NAMES = ("video_frames", "audio", "fps")
    FUNCTION = "generate"
    CATEGORY = "👑 Pixaroma"

    def generate(self, studio_json="{}", image=None, audio=None):
        try:
            cfg = json.loads(studio_json or "{}")
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"[Pixaroma] AudioReact — could not parse studio_json: {exc}. "
                f"Open the editor and re-save."
            ) from exc
        cfg = _migrate_cfg(cfg)

        params = params_from_dict(cfg)

        # Source resolution.
        image_source = cfg.get("image_source", "upstream")
        if image_source == "inline":
            image_path = cfg.get("image_path")
            if not image_path:
                raise ValueError(
                    "[Pixaroma] AudioReact — image_source is 'inline' but "
                    "image_path is empty. Open the editor and re-pick."
                )
            image = _load_inline_image(image_path)
        elif image_source == "upstream":
            if image is None:
                raise ValueError(
                    "[Pixaroma] AudioReact — image_source is 'upstream' but "
                    "no image is wired. Wire an IMAGE input or open the editor "
                    "and switch to 'Inline'."
                )
        else:
            raise ValueError(
                f"[Pixaroma] AudioReact — unknown image_source {image_source!r}."
            )

        audio_source = cfg.get("audio_source", "upstream")
        if audio_source == "inline":
            audio_path = cfg.get("audio_path")
            if not audio_path:
                raise ValueError(
                    "[Pixaroma] AudioReact — audio_source is 'inline' but "
                    "audio_path is empty. Open the editor and re-pick."
                )
            audio = _load_inline_audio(audio_path)
        elif audio_source == "upstream":
            if audio is None:
                raise ValueError(
                    "[Pixaroma] AudioReact — audio_source is 'upstream' but "
                    "no audio is wired. Wire an AUDIO input or open the editor "
                    "and switch to 'Inline'."
                )
        else:
            raise ValueError(
                f"[Pixaroma] AudioReact — unknown audio_source {audio_source!r}."
            )

        for diag in validate_params(params):
            print(f"[Pixaroma] AudioReact — {diag}")
        frames = generate_video(image, audio, params)
        return (frames, audio, float(params.fps))


NODE_CLASS_MAPPINGS = {"PixaromaAudioStudio": PixaromaAudioStudio}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaAudioStudio": "AudioReact Pixaroma"}
```

- [ ] **Step 2: Register in `__init__.py`**

Open `__init__.py` and find the existing pattern for merging mappings (look for `_MAPS_AUDIO_REACT` or similar). Add an analogous block:

```python
# At the top, alongside existing imports:
from .nodes.node_audio_studio import (
    NODE_CLASS_MAPPINGS as _MAPS_AUDIO_STUDIO,
    NODE_DISPLAY_NAME_MAPPINGS as _NAMES_AUDIO_STUDIO,
)
```

```python
# Inside the merged-mappings block:
NODE_CLASS_MAPPINGS = {
    ...,  # existing entries
    **_MAPS_AUDIO_STUDIO,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    ...,  # existing entries
    **_NAMES_AUDIO_STUDIO,
}
```

The exact structure depends on the current `__init__.py` — open it first, mirror the closest existing pattern (Audio React's registration is the model).

- [ ] **Step 3: Smoke test**

Restart ComfyUI. In the Add-Node menu, navigate to `👑 Pixaroma`. Verify "AudioReact Pixaroma" appears.

Drop the node onto the canvas. Verify: shows two optional input slots (`image`, `audio`) + no other widgets. The hidden `studio_json` input must NOT show as a slot — Pattern #9 is wired in JS later (Milestone D), so for now the input isn't injected and Python receives the default `"{}"`. **Expected error if you try to run the node** (since `image` is None and `studio_json` defaults to `{}` so `image_source` defaults to `"upstream"`): clear actionable message about wiring an IMAGE input.

Wire a Load Image + Load Audio (matching ones from a previous Audio React workflow). Run. The node should produce frames using the engine defaults (motion_mode="scale_pulse", intensity=0.8, etc.).

- [ ] **Step 4: Commit**

```bash
git add nodes/node_audio_studio.py __init__.py
git commit -m "audio_studio: add Python node skeleton

PixaromaAudioStudio takes optional IMAGE/AUDIO inputs + hidden studio_json
config. Resolves sources (upstream or inline-from-disk) and delegates to
the shared engine. JS editor + Pattern #9 graphToPrompt injection land in
Milestone D — for now the node runs against engine defaults."
```

Print: `DONE: B1 (PixaromaAudioStudio registered, runs on engine defaults)`

### Task B2: Upload server route

**Files:**
- Modify: `server_routes.py`

**Goal:** New `/pixaroma/api/audio_studio/upload` endpoint accepts `node_id` + `kind` (`image` | `audio`) + file bytes, validates, saves to `input/pixaroma/audio_studio/<node_id>/<kind>.<ext>`, returns the relative path.

- [ ] **Step 1: Add helper + route in `server_routes.py`**

Locate the existing routes (e.g. `/pixaroma/api/layer/upload`, `/pixaroma/api/3d/bg_upload`). Add this block following the same style:

```python
# Toward the top of server_routes.py, near other constants:
ALLOWED_IMAGE_EXTS = {"png", "jpg", "jpeg", "webp"}
ALLOWED_AUDIO_EXTS = {"wav"}  # WAV-only — browser converts before upload
NODE_ID_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")
AUDIO_STUDIO_MAX_FILE_BYTES = 50 * 1024 * 1024
AUDIO_STUDIO_MAX_DIR_BYTES  = 100 * 1024 * 1024


def _audio_studio_dir_size(dir_path: Path) -> int:
    if not dir_path.exists():
        return 0
    return sum(f.stat().st_size for f in dir_path.iterdir() if f.is_file())


@routes.post("/pixaroma/api/audio_studio/upload")
async def audio_studio_upload(request):
    reader = await request.multipart()

    node_id = None
    kind = None
    file_field = None
    file_bytes = None
    file_filename = None

    while True:
        field = await reader.next()
        if field is None:
            break
        if field.name == "node_id":
            node_id = (await field.text()).strip()
        elif field.name == "kind":
            kind = (await field.text()).strip()
        elif field.name == "file":
            file_field = field
            file_filename = field.filename or ""
            file_bytes = await field.read(decode=False)

    if not node_id or not NODE_ID_RE.match(node_id) or len(node_id) > 64:
        return web.json_response(
            {"error": "Invalid node_id (must match [a-zA-Z0-9_-]{1,64})."},
            status=400,
        )
    if kind not in ("image", "audio"):
        return web.json_response(
            {"error": "kind must be 'image' or 'audio'."}, status=400,
        )
    if not file_bytes or not file_filename:
        return web.json_response({"error": "file field is missing."}, status=400)
    if len(file_bytes) > AUDIO_STUDIO_MAX_FILE_BYTES:
        return web.json_response(
            {"error": f"file too large (>{AUDIO_STUDIO_MAX_FILE_BYTES} bytes)."},
            status=400,
        )

    ext = file_filename.rsplit(".", 1)[-1].lower() if "." in file_filename else ""
    if kind == "image" and ext not in ALLOWED_IMAGE_EXTS:
        return web.json_response(
            {"error": f"image extension {ext!r} not allowed; use one of {sorted(ALLOWED_IMAGE_EXTS)}."},
            status=400,
        )
    if kind == "audio" and ext not in ALLOWED_AUDIO_EXTS:
        return web.json_response(
            {"error": f"audio extension {ext!r} not allowed; only WAV is accepted "
                      f"(the browser converts other formats before upload)."},
            status=400,
        )

    target_dir = PIXAROMA_INPUT_ROOT / "audio_studio" / node_id
    target_dir.mkdir(parents=True, exist_ok=True)

    safe_dir = _safe_path(target_dir)
    if safe_dir is None:
        return web.json_response({"error": "path traversal blocked."}, status=400)

    # Replace any existing files of the same kind with potentially different ext.
    for existing in target_dir.glob(f"{kind}.*"):
        try:
            existing.unlink()
        except OSError:
            pass

    target_path = target_dir / f"{kind}.{ext}"
    safe_target = _safe_path(target_path)
    if safe_target is None:
        return web.json_response({"error": "path traversal blocked."}, status=400)

    # Combined-size cap: file we're about to write + everything else in the dir.
    other_size = sum(f.stat().st_size for f in target_dir.iterdir()
                     if f.is_file() and f.name != target_path.name)
    if other_size + len(file_bytes) > AUDIO_STUDIO_MAX_DIR_BYTES:
        return web.json_response(
            {"error": f"per-node combined size cap ({AUDIO_STUDIO_MAX_DIR_BYTES} bytes) exceeded."},
            status=400,
        )

    safe_target.write_bytes(file_bytes)

    rel = f"audio_studio/{node_id}/{kind}.{ext}"
    return web.json_response({"path": rel})
```

If `re`, `web`, `_safe_path`, `PIXAROMA_INPUT_ROOT`, or `routes` are not already imported / defined in `server_routes.py`, follow the existing patterns (these symbols are already present from earlier routes — open the file and confirm).

- [ ] **Step 2: Smoke test the route**

Restart ComfyUI. Hit the route from a console:
```js
// In the browser console with ComfyUI open:
const fd = new FormData();
fd.append("node_id", "test_node");
fd.append("kind", "image");
fd.append("file", new File([new Uint8Array(100)], "x.png"));
fetch("/pixaroma/api/audio_studio/upload", {method: "POST", body: fd}).then(r => r.json()).then(console.log);
// Expected: {path: "audio_studio/test_node/image.png"}
```

Test rejection of WAV-only constraint:
```js
const fd = new FormData();
fd.append("node_id", "test_node");
fd.append("kind", "audio");
fd.append("file", new File([new Uint8Array(100)], "song.mp3"));
fetch("/pixaroma/api/audio_studio/upload", {method: "POST", body: fd}).then(r => r.json()).then(console.log);
// Expected: {error: "audio extension 'mp3' not allowed; only WAV is accepted..."}
```

Test bad node_id:
```js
const fd = new FormData();
fd.append("node_id", "../escape");
fd.append("kind", "image");
fd.append("file", new File([new Uint8Array(100)], "x.png"));
fetch("/pixaroma/api/audio_studio/upload", {method: "POST", body: fd}).then(r => r.json()).then(console.log);
// Expected: {error: "Invalid node_id (must match [a-zA-Z0-9_-]{1,64})."}
```

Verify the file lands at `input/pixaroma/audio_studio/test_node/image.png`. Clean up with `rm -rf input/pixaroma/audio_studio/test_node` after.

- [ ] **Step 3: Commit**

```bash
git add server_routes.py
git commit -m "audio_studio: add /pixaroma/api/audio_studio/upload server route

Multipart POST endpoint for the editor's inline image / audio uploads.
Validates node_id (regex), kind (image | audio), extension (allowlist —
WAV-only for audio), 50MB per file / 100MB per node combined cap.
Same security pattern as the existing /pixaroma/api/layer/upload."
```

Print: `DONE: B2 (upload route smoke-tested)`

---

## Milestone C — Math doc + parity infrastructure for AudioReact

**Goal:** Author `docs/audio-react-math.md` (single source of truth for every formula), expand the parity script to include AudioReact's Python entry point, and lock the goldens against the post-refactor engine. After this milestone the Python side is shippable on its own — JS work in Milestone D+ proceeds against a stable target.

### Task C1: Write `docs/audio-react-math.md`

**Files:**
- Create: `docs/audio-react-math.md`

**Goal:** Document every formula with enough precision that an engineer (or LLM) can write GLSL in Milestone E that exactly mirrors the Python.

- [ ] **Step 1: Write the math doc**

```markdown
# Audio React / AudioReact — Math Reference

Single source of truth for every formula in the Pixaroma audio-reactive
nodes (Audio React, AudioReact). Both the Python engine
(`nodes/_audio_react_engine.py`) and the WebGL preview shaders
(`js/audio_studio/shaders.mjs`) implement the formulas defined here.

When you change a formula, change it here FIRST, then update both
implementations and re-run the parity check.

## 1. Audio envelope pipeline

Input: AUDIO dict `{waveform: [B, C, S] tensor, sample_rate: int}`,
`fps: int`, `audio_band: str`, `smoothing: int`.

Output: `Float32Array` (Python: `torch.Tensor`) of length `total_frames =
floor(audio_duration * fps)`, values in `[0, 1]`.

Pipeline:
1. Mono-mix: if `C > 1`, average channels.
2. Bandpass FFT — see §3.
3. Resample: split waveform into `total_frames` non-overlapping chunks of
   `samples_per_frame = max(1, sample_rate // fps)` samples each. If the
   waveform is shorter than `total_frames * samples_per_frame`, repeat-pad.
4. Per-frame RMS: `rms[t] = sqrt(mean(chunk_t ** 2))`.
5. Min-max normalize: `rms = (rms - rms.min()) / (rms.max() - rms.min())`
   (returns zeros if `rms.max() == rms.min()`).
6. Moving-average smoothing: convolve `rms` with a `kernel = ones(sw) / sw`
   where `sw` is `smoothing` rounded UP to the nearest odd integer (so the
   kernel is centered). `replicate`-pad by `sw // 2` on each side first.
7. (Loop-safe ramp — applied separately by the caller, not part of the
   envelope helper. See §6.)

## 2. Onset track

Input: `envelope: Float32Array[T]` in `[0, 1]`.
Output: `Float32Array[T]` in `[0, 1]`.

Algorithm:
1. `diff[t] = max(0, env[t] - env[t-1])` for `t >= 1`; `diff[0] = 0`.
2. `thresh = max(0.05, quantile(diff, 0.75))`.
3. `spikes[t] = diff[t] if diff[t] > thresh else 0`.
4. Sequential decay: `out[0] = spikes[0]; out[t] = max(spikes[t],
   out[t-1] * 0.85)`.
5. Peak-normalize: `out = out / out.max()` (returns zeros if `out.max() == 0`).

The decay rate `0.85` is hand-tuned. Faster decay (lower) makes onsets
spikier; slower (higher) makes them smear into envelopes. Don't change
without re-running parity.

## 3. Bandpass FFT

Input: `waveform: Tensor[..., S]`, `sample_rate: int`,
`low_hz: float | None`, `high_hz: float | None`.
Output: `Tensor[..., S]` (real).

```
spec  = rfft(waveform, dim=-1)
freqs = rfftfreq(S, d=1/sample_rate)
mask  = ones_like(freqs)
if low_hz  is not None: mask *= (freqs >= low_hz)
if high_hz is not None: mask *= (freqs <= high_hz)
spec *= mask
return irfft(spec, n=S, dim=-1)
```

`AUDIO_BANDS_HZ`:
- `full`:   (None, None)   — no bandpass
- `bass`:   (20, 250)
- `mids`:   (250, 4000)
- `treble`: (4000, 20000)

The JS implementation must use the same boundaries. The JS FFT is a small
inlined real-FFT (radix-2 Cooley-Tukey on real input), zero-padding to the
next power-of-2; trim back to `S` after `irfft`.

## 4. Loop-safe ramp

If `loop_safe == True` AND `total_frames >= 4`:
1. `fade_n = max(2, min(int(fps * 0.5), total_frames // 2))`.
2. `loop_ramp = linspace(0.0, 1.0, fade_n)` — note: starts AT 0.
3. `envelope[:fade_n] *= loop_ramp` (envelope[0] becomes 0).
4. `envelope[-fade_n:] *= flip(loop_ramp)` (envelope[-1] becomes 0).

The `linspace(0, 1, fade_n)` deliberately starts at 0 — that's what makes
the loop seamless (motion is fully frozen at boundaries).

## 5. Base sampling grid

Normalized `[-1, 1]` grid, `[1, H, W, 2]` with x-first ordering (ready for
`F.grid_sample`):
```
y, x = meshgrid(linspace(-1, 1, H), linspace(-1, 1, W), indexing="ij")
base_grid = stack([x, y], dim=-1).unsqueeze(0)  # [1, H, W, 2]
```

## 6. Motion modes

All 8 motion functions accept the canonical `MotionContext` (or its
shader-uniform equivalent) and return a transformed sampling grid in the
same shape as `base_grid`. The renderer then samples the source image
through the grid (`F.grid_sample` in Python with `mode="bilinear"`,
`padding_mode="border"`, `align_corners=False`; `texture()` on a clamp-to-edge
texture in GLSL).

### 6.1 `scale_pulse`

```
s = env_t * intensity * 0.15
grid' = grid * (1.0 - s)
```

Maximum zoom: `intensity=2.0, env_t=1.0` → `s=0.3` → 30% zoom-in.

### 6.2 `zoom_punch`

```
s = onset_t * intensity * 0.30
grid' = grid * (1.0 - s)
```

Same shape as `scale_pulse` but driven by `onset_t` instead of `env_t`,
and with double the multiplier.

### 6.3 `shake`

```
# Pre-render: build cumulative random walk for the whole clip
gen     = Generator().manual_seed(0)
dx_raw  = randn(total_frames, gen=gen) * onset_array
dy_raw  = randn(total_frames, gen=gen) * onset_array
decay   = 0.7
dx[0]   = dx_raw[0];  dy[0] = dy_raw[0]
dx[k]   = dx[k-1] * decay + dx_raw[k] * (1 - decay)
dy[k]   = dy[k-1] * decay + dy_raw[k] * (1 - decay)

# Per-frame:
amp     = intensity * 0.04
grid'   = grid - (dx[i] * amp, dy[i] * amp)
```

**Approximation note (shader):** the WebGL preview cannot bit-match this —
torch `Generator(seed=0)` produces a specific sequence that JS cannot
reproduce, and float-precision drift over hundreds of frames diverges
trajectories. Shader uses a deterministic same-seeded JS RNG (e.g.
`mulberry32(0)`) approximating the same characteristic motion. **Final
MP4 output is authoritative; preview is approximate for `shake` only.**

### 6.4 `drift`

```
sway = sin(2π * motion_speed * t)
bob  = cos(2π * motion_speed * t)
amp  = env_t * intensity * 0.04
grid' = grid - (sway * amp, bob * amp)
```

`t` in seconds since clip start.

### 6.5 `rotate_pulse`

```
aspect = W / H
sway   = sin(2π * motion_speed * t)
angle  = sway * env_t * intensity * (π / 12)   # max ±15°

xs = grid[..., 0] * aspect
ys = grid[..., 1]
new_x = (xs * cos(angle) - ys * sin(angle)) / aspect
new_y =  xs * sin(angle) + ys * cos(angle)
```

Aspect correction prevents non-square frames from producing visually
elliptical rotation.

### 6.6 `swirl`

```
aspect = W / H
xs     = grid[..., 0] * aspect
ys     = grid[..., 1]
r      = sqrt(xs² + ys²)
θ      = atan2(ys, xs)
twist  = env_t * intensity * (π / 2) * max(0, 1 - r)
θ'     = θ + twist
new_x  = r * cos(θ') / aspect
new_y  = r * sin(θ')
```

Outside the unit disk (`r >= 1`), `twist = 0` so the corners are stationary.

### 6.7 `ripple`

```
aspect = W / H
ys     = linspace(-1, 1, H) (broadcast)
xs     = linspace(-1, 1, W) (broadcast)
r      = sqrt((xs * aspect)² + ys²)

k      = 6π
omega  = 2π * max(motion_speed * 4.0, 0.5)
A      = env_t * intensity * 0.015 * 2.0   # normalized [-1,1] grid units

dr     = A * sin(k * r - omega * t)
r_safe = max(r, 1e-3)
dx     = dr * (xs * aspect) / r_safe / aspect
dy     = dr * ys / r_safe

grid' = grid + (dx, dy)
```

### 6.8 `slit_scan`

```
ys     = linspace(-1, 1, H) (broadcast across W)
k      = 4π
omega  = 2π * max(motion_speed * 2.0, 0.4)
A      = env_t * intensity * 0.04

dy     = A * sin(k * ys - omega * t)
dx     = A * 0.5 * cos(k * ys - omega * t)
grid' = grid + (dx, dy)
```

The horizontal displacement at half-amplitude with cos phase keeps the
distortion from looking like a single 1D wave.

## 7. Overlays

All 4 overlays read `frame: [H, W, 3] in [0, 1]` and return the modified
frame. Each is gated by its strength uniform — `if strength <= 0: skip`.

### 7.1 `glitch`

```
if onset_t <= 0.001 or strength <= 0: return frame
max_px = max(1, int(onset_t * strength * 0.012 * min(H, W)))

# Per-channel R/G/B horizontal offsets (random sign, ±max_px), seeded
# deterministically by the onset value for reproducibility.
seed   = int(onset_t * 1e6) & 0xFFFF
gen    = Generator().manual_seed(seed)
signs  = randint(0, 2, (3,), gen=gen) * 2 - 1   # ±1 per channel
offsets = signs * max_px

for c in 0..2:
    ox = offsets[c]
    if ox > 0: shift channel c right by ox px (replicate left edge)
    elif ox < 0: shift left by |ox| (replicate right edge)

# Big-spike scanline tear:
if onset_t * strength > 0.7:
    n_swap = max(1, H // 20)
    pick n_swap random row indices, swap row[i] with row[i+1].
```

GLSL implementation samples each channel from a horizontally-shifted UV
coord. Scanline tear can be approximated by per-row pseudo-random
amplitude added to the UV.x — a row that's "swapped" effectively reads
from the row above or below.

### 7.2 `bloom`

```
if env_t <= 0.001 or strength <= 0: return frame
weight = env_t * strength * 0.6

# Downsample 4x → 9-tap separable Gaussian blur (sigma=2.0) → upsample
small = downsample(frame, 0.25)
small = blur_horizontal(small, kernel=gauss_9, sigma=2.0)
small = blur_vertical(small, kernel=gauss_9, sigma=2.0)
big   = upsample(small, frame.size)
bloom_layer = clip(big * weight, 0, 1)

# Screen blend
out = 1 - (1 - frame) * (1 - bloom_layer)
return clip(out, 0, 1)
```

GLSL: same multi-pass — downsample to a 1/4-size FBO, two blur passes,
upsample, screen-blend. The 9-tap separable Gaussian: weights `g[i] =
exp(-(i - 4)² / 8)`, normalized to sum 1.

### 7.3 `vignette`

```
if env_t <= 0.001 or strength <= 0: return frame
ys = linspace(-1, 1, H); xs = linspace(-1, 1, W)
r  = sqrt(xs² + ys²).clip(0, 1.4)
v  = (r / 1.414).clip(0, 1)
mask = 1 - v * env_t * strength * 0.5
return frame * mask
```

GLSL: compute `r` from gl_FragCoord normalized to [-1, 1], same formula.

### 7.4 `hue_shift`

```
if env_t <= 0.001 or strength <= 0: return frame
angle = env_t * strength * (30° in radians)
c, s  = cos(angle), sin(angle)
m = [
    [0.299 + 0.701*c + 0.168*s,  0.587 - 0.587*c + 0.330*s,  0.114 - 0.114*c - 0.497*s],
    [0.299 - 0.299*c - 0.328*s,  0.587 + 0.413*c + 0.035*s,  0.114 - 0.114*c + 0.292*s],
    [0.299 - 0.299*c + 1.250*s,  0.587 - 0.587*c - 1.050*s,  0.114 + 0.886*c - 0.203*s],
]
return clip(frame @ m^T, 0, 1)
```

The 0.299 / 0.587 / 0.114 luma triples MUST be exact in every row — typos
drift the gray axis and produce a tint on neutrals at high angles.

## 8. Constants reference

| Constant | Value | Used by | Rationale |
|----------|-------|---------|-----------|
| `scale_pulse` multiplier | 0.15 | scale_pulse | 30% max zoom feels punchy without distortion |
| `zoom_punch` multiplier | 0.30 | zoom_punch | 2× scale_pulse for spike feel |
| `shake` amplitude | 0.04 | shake | 4% half-frame at intensity=1, raw=±1 |
| `shake` decay | 0.7 | shake | smooths random walk into believable motion |
| `drift` amplitude | 0.04 | drift | matches `shake` amplitude |
| `rotate_pulse` max angle | π/12 (15°) | rotate_pulse | bigger angles look gimmicky |
| `ripple` k | 6π | ripple | 6 full radial cycles within unit disk |
| `ripple` omega coefficient | max(motion_speed*4, 0.5) | ripple | floor prevents stalling at 0 motion_speed |
| `ripple` amplitude | 0.015 * 2.0 | ripple | 1.5% of grid range = 1.5% pixel displacement |
| `slit_scan` k | 4π | slit_scan | 2 full vertical cycles |
| `slit_scan` omega | max(motion_speed*2, 0.4) | slit_scan | floor matches ripple’s rationale |
| `slit_scan` amplitude | 0.04 | slit_scan | matches shake/drift |
| `glitch` px coefficient | 0.012 | glitch | 720p → 9px max, 4K → 26px max |
| `glitch` tear threshold | 0.7 | glitch | only big spikes tear |
| `glitch` tear row count | H // 20 | glitch | 5% of rows |
| `bloom` weight coefficient | 0.6 | bloom | screen-blend weight at full env*strength |
| `bloom` blur sigma | 2.0 | bloom | matches 9-tap kernel coverage |
| `bloom` downsample | 0.25 | bloom | 1/16 area, 16× compute saving |
| `vignette` weight | 0.5 | vignette | 50% darken at corners on full env*strength |
| `hue_shift` max angle | 30° | hue_shift | bigger looks gimmicky |
| `onset` decay | 0.85 | onset_track | balances spike vs smear |
| `onset` thresh floor | 0.05 | onset_track | minimum sensitivity for quiet music |
| `loop_safe` fade | 0.5s | loop_safe ramp | invisible on clips ≥ 5s |

## 9. Where preview is approximate

Listed here so users / engineers know what to expect.

- **`shake`** — JS RNG cannot reproduce torch's `Generator(seed=0)`. Browser
  uses `mulberry32(0)` as a deterministic-but-different stand-in. Final
  MP4 output (Python) is authoritative.

All other modes are exact-bit-pattern bound (within shader-precision
rounding — `highp` floats throughout).

## 10. Parity check

Two layers of test:

1. **Python parity** (`scripts/audio_parity_check.py`) — renders 64 reference
   frames from the engine, diffs against committed PNGs. Tolerance: pixel
   RMSE ≤ 1.0. Run before each release.
2. **Browser parity harness** (`assets/audio_studio_parity/index.html`) —
   loads the same goldens, runs the WebGL pipeline against the same source,
   computes per-pair ΔE in JS. Mean ΔE ≤ 5.0 for non-shake tests. Run
   manually in Chrome / Firefox / Safari before release.
```

- [ ] **Step 2: Commit**

```bash
git add docs/audio-react-math.md
git commit -m "docs: add Audio React / Studio math reference

Single source of truth for every motion mode + overlay formula. The
Python engine and the WebGL shaders both implement what's specified
here; future formula changes start in this doc, then propagate to both
implementations."
```

Print: `DONE: C1 (math doc committed)`

### Task C2: Re-baseline goldens against the post-refactor engine

**Goal:** The goldens captured in A1 came from the un-refactored Audio React. After Milestone A, the engine produces (still byte-identical) frames. To make AudioReact's own parity story crisp, regenerate the goldens through the explicit engine entry point and verify they match the A1 snapshot.

- [ ] **Step 1: Modify the parity script to call the engine directly (cleaner)**

Edit `scripts/audio_parity_check.py`. Replace the `from ComfyUI_Pixaroma.nodes.node_audio_react import PixaromaAudioReact` line with:

```python
from ComfyUI_Pixaroma.nodes._audio_react_engine import (
    Params, generate_video,
)
```

Replace `render_frames` with a function that calls `generate_video` directly:

```python
def render_frames(image, audio, params_dict, motion_mode, glitch=0.0, bloom=0.0,
                  vignette=0.0, hue_shift=0.0):
    p = Params(
        motion_mode=motion_mode,
        intensity=params_dict["intensity"],
        audio_band=params_dict["audio_band"],
        motion_speed=params_dict["motion_speed"],
        smoothing=params_dict["smoothing"],
        loop_safe=params_dict["loop_safe"],
        fps=params_dict["fps"],
        glitch_strength=glitch,
        bloom_strength=bloom,
        vignette_strength=vignette,
        hue_shift_strength=hue_shift,
        aspect_ratio=params_dict["aspect_ratio"],
        custom_width=params_dict["custom_width"],
        custom_height=params_dict["custom_height"],
    )
    return generate_video(image, audio, p)
```

Drop the `node = PixaromaAudioReact()` line from `main()` and update calls accordingly (drop the `node` arg).

- [ ] **Step 2: Run parity in default mode — must show zero diffs**

```bash
python scripts/audio_parity_check.py
```

Expected: 64 OK lines, all `rmse=0.000`. The goldens were generated against the same code path (just via the node wrapper), so the engine entry point produces identical output.

If anything fails, the engine extraction in Milestone A introduced a regression — bisect.

- [ ] **Step 3: Commit**

```bash
git add scripts/audio_parity_check.py
git commit -m "audio_studio: parity script now calls engine.generate_video directly

Cleaner entry point for the parity test — no need to instantiate a
PixaromaAudioReact node. Goldens unchanged (same math)."
```

Print: `DONE: C2 (parity script targets engine; goldens locked)`

---

## Milestone D — JS editor scaffolding (no rendering yet)

**Goal:** Build the editor shell — extension entry, fullscreen overlay, header, sidebar tabs, persistence Pattern #9. After this milestone, clicking "Open AudioReact" on the node opens the editor, you can switch tabs, drag sliders (state updates locally), and save/discard buttons work — but there's no canvas rendering yet (added in Milestone E) and no audio playback (Milestone G).

### Task D1: `js/audio_studio/index.js` — extension entry

**Files:**
- Create: `js/audio_studio/index.js`

**Goal:** Register the extension, add an "Open AudioReact" button to the node, wire up Pattern #9 persistence (`graphToPrompt` injection of `studio_json` from `node.properties.audioStudioState`).

- [ ] **Step 1: Write the extension entry**

```js
// js/audio_studio/index.js
import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";

import { AudioStudioEditor } from "./core.mjs";
// Mixin imports — must be side-effect imports BEFORE first AudioStudioEditor use
import "./ui.mjs";
import "./transport.mjs";
import "./render.mjs";

const STATE_KEY = "audioStudioState";

// Default config — must match Params() defaults in _audio_react_engine.py.
// When updating one, update the other (CLAUDE.md Pattern #3 calls this out
// for Note Pixaroma; same risk applies here).
const DEFAULT_CFG = {
  schema_version: 1,
  motion_mode: "scale_pulse",
  intensity: 0.8,
  audio_band: "full",
  motion_speed: 0.2,
  smoothing: 5,
  loop_safe: true,
  fps: 24,
  glitch_strength: 0.6,
  bloom_strength: 0.0,
  vignette_strength: 0.0,
  hue_shift_strength: 0.0,
  aspect_ratio: "Original",
  custom_width: 1024,
  custom_height: 1024,
  image_source: "upstream",
  image_path: null,
  audio_source: "upstream",
  audio_path: null,
};

// Vue compat — see CLAUDE.md "Editor overlay removal" pattern (#2).
function isEditorOpen(node) {
  if (!node._audioStudioEditor) return false;
  const overlay = node._audioStudioEditor.overlay;
  if (!overlay || !overlay.isConnected) {
    node._audioStudioEditor = null;
    return false;
  }
  return true;
}

app.registerExtension({
  name: "Pixaroma.AudioStudio",

  // Pattern #9: extension-scope monkey-patch app.graphToPrompt to inject
  // studio_json from node.properties.audioStudioState into the request body
  // right before submission. Same pattern as Resolution Pixaroma.
  async setup() {
    const original = app.graphToPrompt.bind(app);
    app.graphToPrompt = async function (...args) {
      const result = await original(...args);
      try {
        const graph = app.graph;
        if (!graph || !result?.output) return result;
        for (const node of graph._nodes) {
          if (node.comfyClass !== "PixaromaAudioStudio") continue;
          const id = String(node.id);
          if (!result.output[id]) continue;
          const state = node.properties?.[STATE_KEY] ?? DEFAULT_CFG;
          // Ensure inputs object exists
          result.output[id].inputs = result.output[id].inputs || {};
          result.output[id].inputs.studio_json = JSON.stringify(state);
        }
      } catch (e) {
        console.warn("[Pixaroma] AudioStudio graphToPrompt hook failed:", e);
      }
      return result;
    };
  },

  async nodeCreated(node) {
    if (node.comfyClass !== "PixaromaAudioStudio") return;

    // Initialize properties cache to default if not yet set
    if (!node.properties) node.properties = {};
    if (!node.properties[STATE_KEY]) {
      node.properties[STATE_KEY] = { ...DEFAULT_CFG };
    }

    // Pattern #8: defer to queueMicrotask so configure() has restored
    // node.properties[STATE_KEY] from saved workflow JSON before we read it.
    queueMicrotask(() => {
      // Nothing to render yet — node has only the "Open AudioReact" button.
      // Adding the DOM widget for status / preview happens in Milestone H
      // (source resolution adds an upstream-aware preview).
    });

    node.size = node.size || [240, 100];

    node.addWidget("button", "Open AudioReact", null, () => {
      const cfg = node.properties[STATE_KEY] || { ...DEFAULT_CFG };
      const editor = new AudioStudioEditor(node, cfg);
      node._audioStudioEditor = editor;

      editor.onSave = (newCfg) => {
        node.properties[STATE_KEY] = newCfg;
        node.setDirtyCanvas(true, true);
      };
      editor.onClose = () => {
        node._audioStudioEditor = null;
      };

      editor.open();
    });

    // CLAUDE.md Pattern #6 resurrection-close — safety net if Vue removes
    // the node while editor is open.
    const origRemoved = node.onRemoved;
    node.onRemoved = function () {
      if (isEditorOpen(this)) {
        try { this._audioStudioEditor.forceClose(); } catch {}
      }
      origRemoved?.call(this);
    };
  },
});

// Re-export for other modules
export { AudioStudioEditor, isEditorOpen, DEFAULT_CFG, STATE_KEY };
```

- [ ] **Step 2: Add stubs for the modules referenced**

The mixin imports above (`./ui.mjs`, `./transport.mjs`, `./render.mjs`) and the class (`./core.mjs`) don't exist yet — Tasks D2 / D4 / E1 / G1 land them. To avoid an import error in the meantime, create stub files NOW that just export an empty function each. This lets ComfyUI load the extension without errors:

`js/audio_studio/core.mjs`:
```js
export class AudioStudioEditor {
  constructor(node, cfg) {
    this.node = node;
    this.cfg = JSON.parse(JSON.stringify(cfg));
    this.overlay = null;
  }
  open() {
    console.log("[Pixaroma] AudioStudio: open() — stub. Implemented in D2.");
  }
  forceClose() {}
}
```

`js/audio_studio/ui.mjs`:
```js
// Mixin file — adds methods to AudioStudioEditor.prototype.
// Implemented in D4.
```

`js/audio_studio/transport.mjs`:
```js
// Mixin file — adds methods to AudioStudioEditor.prototype.
// Implemented in G1.
```

`js/audio_studio/render.mjs`:
```js
// Mixin file — adds methods to AudioStudioEditor.prototype.
// Implemented in E2.
```

`js/audio_studio/api.mjs`: not imported yet — created in D3.

`js/audio_studio/audio_analysis.mjs`: not imported yet — created in F1.

`js/audio_studio/shaders.mjs`: not imported yet — created in E1.

- [ ] **Step 3: Smoke test**

Restart ComfyUI. Drop the AudioReact node. Verify:
- "Open AudioReact" button appears.
- Clicking it logs `[Pixaroma] AudioStudio: open() — stub.` to console (no editor opens yet — that's D2).
- No errors in the console.

Save the workflow JSON. Re-open. Verify the node still appears with the button (no JS errors during load).

- [ ] **Step 4: Test Pattern #9 hook (manual)**

In the browser console with ComfyUI open:
```js
// After the node is on canvas:
const node = app.graph._nodes.find(n => n.comfyClass === "PixaromaAudioStudio");
node.properties.audioStudioState.intensity = 1.5;
const prompt = await app.graphToPrompt();
console.log("studio_json injected:", prompt.output[node.id].inputs.studio_json);
// Expected: a JSON string with intensity: 1.5
```

This confirms the `graphToPrompt` hook runs. If `studio_json` is missing in the prompt, debug — Pattern #9 is the persistence backbone for the rest of the milestone.

- [ ] **Step 5: Commit**

```bash
git add js/audio_studio/index.js js/audio_studio/core.mjs js/audio_studio/ui.mjs js/audio_studio/transport.mjs js/audio_studio/render.mjs
git commit -m "audio_studio: extension entry + Pattern #9 persistence hook

js/audio_studio/index.js wires the 'Open AudioReact' button on the node
and monkey-patches app.graphToPrompt to inject studio_json from
node.properties.audioStudioState. Stub files for the mixin modules so
imports resolve while subsequent tasks land the real implementations."
```

Print: `DONE: D1 (extension entry + Pattern #9 graphToPrompt hook landed)`

### Task D2: `js/audio_studio/core.mjs` editor shell

**Files:**
- Modify: `js/audio_studio/core.mjs` — replace stub with real implementation

**Goal:** Fullscreen overlay opens with header (title, close X, save button placeholder, upstream pill placeholders) and an empty body area. Vue-compat patches active during open. × close prompts discard if dirty.

- [ ] **Step 1: Implement the editor class**

Replace the stub `js/audio_studio/core.mjs` with:

```js
// js/audio_studio/core.mjs
import { app } from "../../../../scripts/app.js";

const BRAND_ORANGE = "#f66744";
const BRAND_RED    = "#e74c3c";

function injectCSS() {
  if (document.getElementById("pix-audiostudio-css")) return;
  const css = `
    .pix-as-overlay {
      position: fixed; inset: 0;
      background: #1c1c1c;
      z-index: 9999;
      display: flex; flex-direction: column;
      color: #e0e0e0;
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 13px;
    }
    .pix-as-header {
      display: flex; align-items: center;
      gap: 12px;
      padding: 6px 12px;
      background: #2a2a2a;
      border-bottom: 1px solid #1a1a1a;
      height: 32px;
      flex-shrink: 0;
    }
    .pix-as-close-x {
      cursor: pointer;
      width: 22px; height: 22px;
      display: inline-flex; align-items: center; justify-content: center;
      color: #aaa;
      border-radius: 3px;
      user-select: none;
    }
    .pix-as-close-x:hover { background: #3a3a3a; color: #fff; }
    .pix-as-title {
      color: ${BRAND_ORANGE};
      font-weight: bold;
      font-size: 14px;
    }
    .pix-as-pill {
      display: inline-flex; align-items: center;
      padding: 3px 10px; border-radius: 12px;
      background: #3a3a3a; color: #aaa;
      font-size: 11px;
      cursor: pointer; user-select: none;
    }
    .pix-as-pill.connected { background: #2d5a3d; color: #c8e6c9; }
    .pix-as-pill:hover { filter: brightness(1.2); }
    .pix-as-spacer { flex: 1; }
    .pix-as-save-btn {
      background: ${BRAND_ORANGE}; color: #fff;
      padding: 5px 16px; border-radius: 4px;
      font-weight: bold; cursor: pointer; user-select: none;
      border: none; font-size: 13px;
    }
    .pix-as-save-btn:disabled,
    .pix-as-save-btn.disabled {
      background: #555; color: #888;
      cursor: not-allowed;
    }
    .pix-as-save-btn:not(:disabled):not(.disabled):hover { filter: brightness(1.1); }
    .pix-as-body {
      display: flex; flex: 1; min-height: 0;
    }
    .pix-as-canvas-area {
      flex: 1;
      background: #111;
      display: flex; flex-direction: column;
      min-width: 0;
    }
    .pix-as-canvas-host {
      flex: 1;
      display: flex; align-items: center; justify-content: center;
      color: #555;
      position: relative;
    }
    .pix-as-canvas-host canvas {
      display: block;
      max-width: 100%; max-height: 100%;
    }
    .pix-as-transport {
      flex-shrink: 0;
      background: #232323;
      border-top: 1px solid #1a1a1a;
      padding: 6px 12px;
      display: flex; align-items: center; gap: 10px;
      height: 36px;
    }
    .pix-as-sidebar {
      width: 280px;
      background: #232323;
      border-left: 1px solid #1a1a1a;
      display: flex; flex-direction: column;
      flex-shrink: 0;
    }
    .pix-as-confirm-backdrop {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 10000;
      display: flex; align-items: center; justify-content: center;
    }
    .pix-as-confirm-modal {
      background: #2a2a2a;
      padding: 20px 24px;
      border-radius: 6px;
      max-width: 400px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.6);
    }
    .pix-as-confirm-modal h3 {
      margin: 0 0 12px 0;
      color: ${BRAND_ORANGE};
      font-size: 16px;
    }
    .pix-as-confirm-modal p {
      margin: 0 0 16px 0;
      color: #ccc;
      line-height: 1.4;
    }
    .pix-as-confirm-actions {
      display: flex; gap: 8px; justify-content: flex-end;
    }
    .pix-as-btn {
      padding: 6px 14px; border-radius: 3px;
      cursor: pointer; user-select: none;
      border: none; font-size: 13px; font-weight: bold;
    }
    .pix-as-btn-cancel { background: ${BRAND_ORANGE}; color: #fff; }
    .pix-as-btn-discard { background: ${BRAND_RED}; color: #fff; }
    .pix-as-btn:hover { filter: brightness(1.1); }
  `;
  const style = document.createElement("style");
  style.id = "pix-audiostudio-css";
  style.textContent = css;
  document.head.appendChild(style);
}


export class AudioStudioEditor {
  constructor(node, cfg) {
    this.node = node;
    // Deep-clone the cfg so live edits don't mutate node.properties until Save.
    this.cfg = JSON.parse(JSON.stringify(cfg));
    this.savedSnapshot = JSON.stringify(cfg);   // for dirty detection
    this.overlay = null;
    this.onSave = null;
    this.onClose = null;
  }

  isDirty() {
    return JSON.stringify(this.cfg) !== this.savedSnapshot;
  }

  open() {
    injectCSS();

    // Vue-compat: neuter Ctrl+Z escape (Pattern #6).
    this._savedLoadGraphData = app.loadGraphData.bind(app);
    app.loadGraphData = () => Promise.resolve();
    this._savedGraphConfigure = app.graph.configure.bind(app.graph);
    app.graph.configure = () => {};

    const overlay = document.createElement("div");
    overlay.className = "pix-as-overlay";
    this.overlay = overlay;

    overlay.appendChild(this._buildHeader());

    const body = document.createElement("div");
    body.className = "pix-as-body";

    const canvasArea = document.createElement("div");
    canvasArea.className = "pix-as-canvas-area";
    this.canvasArea = canvasArea;

    const canvasHost = document.createElement("div");
    canvasHost.className = "pix-as-canvas-host";
    canvasHost.textContent = "(canvas — WebGL preview lands in Milestone E)";
    this.canvasHost = canvasHost;

    const transport = document.createElement("div");
    transport.className = "pix-as-transport";
    transport.textContent = "(transport bar — lands in Milestone G)";
    this.transportEl = transport;

    canvasArea.appendChild(canvasHost);
    canvasArea.appendChild(transport);

    const sidebar = document.createElement("div");
    sidebar.className = "pix-as-sidebar";
    sidebar.textContent = "(sidebar — tabs land in D4)";
    this.sidebar = sidebar;

    body.appendChild(canvasArea);
    body.appendChild(sidebar);
    overlay.appendChild(body);

    document.body.appendChild(overlay);

    // Esc handler — top-level so the editor traps Escape.
    this._keyHandler = (e) => {
      // Don't intercept Esc if a confirm modal is open
      if (document.querySelector(".pix-as-confirm-backdrop")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        e.stopImmediatePropagation();
        this._save();
      }
    };
    window.addEventListener("keydown", this._keyHandler, true);

    // Block clicks on overlay backdrop from accidentally closing
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay && document.querySelector(".pix-as-confirm-backdrop")) {
        e.stopImmediatePropagation();
      }
    }, true);
  }

  _buildHeader() {
    const header = document.createElement("div");
    header.className = "pix-as-header";

    const closeX = document.createElement("span");
    closeX.className = "pix-as-close-x";
    closeX.textContent = "×";
    closeX.style.fontSize = "18px";
    closeX.addEventListener("click", () => this.close());
    header.appendChild(closeX);

    const title = document.createElement("span");
    title.className = "pix-as-title";
    title.textContent = "AudioReact Pixaroma";
    header.appendChild(title);

    // Image / Audio source pills — full behavior in Milestone H
    this.imgPill = this._buildPill(
      `Image: ${this.cfg.image_source === "upstream" ? "Upstream" : "Inline"}`,
      this.cfg.image_source === "upstream",
    );
    this.audioPill = this._buildPill(
      `Audio: ${this.cfg.audio_source === "upstream" ? "Upstream" : "Inline"}`,
      this.cfg.audio_source === "upstream",
    );
    header.appendChild(this.imgPill);
    header.appendChild(this.audioPill);

    const spacer = document.createElement("span");
    spacer.className = "pix-as-spacer";
    header.appendChild(spacer);

    const saveBtn = document.createElement("button");
    saveBtn.className = "pix-as-save-btn disabled";
    saveBtn.textContent = "SAVE";
    saveBtn.disabled = true;   // enabled by ui.mjs when dirty
    saveBtn.addEventListener("click", () => this._save());
    this.saveBtn = saveBtn;
    header.appendChild(saveBtn);

    return header;
  }

  _buildPill(label, connected) {
    const pill = document.createElement("span");
    pill.className = "pix-as-pill" + (connected ? " connected" : "");
    pill.textContent = label;
    return pill;
  }

  _refreshSaveBtnState() {
    const dirty = this.isDirty();
    this.saveBtn.disabled = !dirty;
    this.saveBtn.classList.toggle("disabled", !dirty);
  }

  _save() {
    if (!this.isDirty()) return;
    this.onSave?.(JSON.parse(JSON.stringify(this.cfg)));
    this.savedSnapshot = JSON.stringify(this.cfg);
    this._refreshSaveBtnState();
    this.close();
  }

  close() {
    if (this.isDirty()) {
      this._showDiscardConfirm();
      return;
    }
    this.forceClose();
  }

  _showDiscardConfirm() {
    const backdrop = document.createElement("div");
    backdrop.className = "pix-as-confirm-backdrop";
    const modal = document.createElement("div");
    modal.className = "pix-as-confirm-modal";
    modal.innerHTML = `
      <h3>Discard changes?</h3>
      <p>You have unsaved changes to the AudioReact. Discard them and close?</p>
      <div class="pix-as-confirm-actions">
        <button class="pix-as-btn pix-as-btn-cancel">Cancel</button>
        <button class="pix-as-btn pix-as-btn-discard">Discard</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    modal.querySelector(".pix-as-btn-cancel").focus();
    modal.querySelector(".pix-as-btn-cancel").addEventListener("click", () => {
      backdrop.remove();
    });
    modal.querySelector(".pix-as-btn-discard").addEventListener("click", () => {
      backdrop.remove();
      this.forceClose();
    });
  }

  forceClose() {
    // Restore Vue-compat patches
    if (this._savedLoadGraphData) {
      app.loadGraphData = this._savedLoadGraphData;
      this._savedLoadGraphData = null;
    }
    if (this._savedGraphConfigure) {
      app.graph.configure = this._savedGraphConfigure;
      this._savedGraphConfigure = null;
    }
    window.removeEventListener("keydown", this._keyHandler, true);
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;
    this.onClose?.();
  }
}
```

- [ ] **Step 2: Smoke test**

Restart ComfyUI. Drop the node. Click "Open AudioReact".
- ✅ Fullscreen overlay opens.
- ✅ Header shows × close + "AudioReact Pixaroma" + Image/Audio pills + grayed-out SAVE button.
- ✅ Body shows canvas placeholder + transport placeholder + sidebar placeholder.
- Click × → editor closes (no dirty changes, no prompt).
- Reopen, mutate `editor.cfg.intensity = 1.5` from console:
  ```js
  app.graph._nodes.find(n => n.comfyClass === "PixaromaAudioStudio")._audioStudioEditor.cfg.intensity = 1.5;
  ```
  Then re-call `_refreshSaveBtnState()`:
  ```js
  app.graph._nodes.find(n => n.comfyClass === "PixaromaAudioStudio")._audioStudioEditor._refreshSaveBtnState();
  ```
- ✅ SAVE button becomes enabled (orange).
- Click ×.
- ✅ "Discard changes?" modal appears with Cancel/Discard.
- Click Cancel → modal closes, editor stays open.
- Click × → modal again → click Discard → editor closes.
- Press Ctrl+Z while editor is open → workflow JSON should NOT be reloaded (Vue-compat patches working).

- [ ] **Step 3: Commit**

```bash
git add js/audio_studio/core.mjs
git commit -m "audio_studio: editor shell (overlay + header + discard prompt)

AudioStudioEditor opens a fullscreen overlay with the locked Layout B
header (× close, title, source pills, save button) and stub canvas /
transport / sidebar areas. Esc + Ctrl+S handlers wired. Vue-compat
patches block Ctrl+Z escape during open (Pattern #6). Discard-changes
modal appears when closing with dirty state."
```

Print: `DONE: D2 (editor shell opens, closes, dirty-discard works)`

### Task D3: `js/audio_studio/api.mjs`

**Files:**
- Create: `js/audio_studio/api.mjs`

- [ ] **Step 1: Write API helpers**

```js
// js/audio_studio/api.mjs
"use strict";

const UPLOAD_ENDPOINT = "/pixaroma/api/audio_studio/upload";

/**
 * Upload an inline image / audio source for a node.
 * @param {string} nodeId
 * @param {"image"|"audio"} kind
 * @param {Blob} blob
 * @param {string} filename - the filename to attach (drives extension validation server-side)
 * @returns {Promise<{path: string}>} - relative path under input/pixaroma/
 */
export async function uploadSource(nodeId, kind, blob, filename) {
  const fd = new FormData();
  fd.append("node_id", String(nodeId));
  fd.append("kind", kind);
  fd.append("file", blob, filename);
  const res = await fetch(UPLOAD_ENDPOINT, { method: "POST", body: fd });
  if (!res.ok) {
    let msg = `upload failed: HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

/**
 * Resolve the URL to fetch upstream image bytes for the editor.
 * Handles LoadImage (widget["image"] with filename) and any node with
 * cached imgs[].
 *
 * @param {LGraph} graph
 * @param {LGraphNode} node — the AudioStudio node
 * @returns {string|null}
 */
export function getUpstreamImageUrl(graph, node) {
  if (!graph || !node) return null;
  const inp = (node.inputs || []).find(i => i.name === "image");
  if (!inp || inp.link == null) return null;
  // graph.links may be a Map or plain object (CLAUDE.md Vue point #3)
  let link = graph.links?.[inp.link];
  if (!link && typeof graph.links?.get === "function") link = graph.links.get(inp.link);
  if (!link) return null;
  const src = graph.getNodeById(link.origin_id);
  if (!src) return null;

  if (src.comfyClass === "LoadImage" || src.type === "LoadImage") {
    const w = src.widgets?.find(w => w.name === "image");
    if (w && w.value) {
      const fn = String(w.value).split(/[\\/]/).pop();
      return `/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=&t=${Date.now()}`;
    }
  }
  if (Array.isArray(src.imgs) && src.imgs.length) {
    const img = src.imgs[link.origin_slot] || src.imgs[0];
    return typeof img === "string" ? img : (img?.src || null);
  }
  return null;
}

/**
 * Inline-stored source URL via ComfyUI's /view route (no custom endpoint
 * needed). path is the relative path returned by uploadSource (e.g.
 * "audio_studio/<node_id>/image.png").
 */
export function getInlineSourceUrl(path) {
  if (!path) return null;
  // path looks like "audio_studio/<id>/image.png" — split into subfolder + filename
  const parts = path.split("/");
  const filename = parts.pop();
  const subfolder = ["pixaroma", ...parts].join("/");
  return `/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=${encodeURIComponent(subfolder)}&t=${Date.now()}`;
}
```

- [ ] **Step 2: Smoke test from console**

```js
import("/extensions/ComfyUI-Pixaroma/js/audio_studio/api.mjs").then(m => {
  // create a tiny PNG blob
  const blob = new Blob([new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])], {type: "image/png"});
  m.uploadSource("test_console", "image", blob, "x.png").then(console.log);
});
// Expected: {path: "audio_studio/test_console/image.png"}
```

Then clean up: `rm -rf input/pixaroma/audio_studio/test_console`.

- [ ] **Step 3: Commit**

```bash
git add js/audio_studio/api.mjs
git commit -m "audio_studio: add api.mjs (upload + upstream URL helpers)

Three exports: uploadSource() POSTs to the new server route; getUpstreamImageUrl()
walks graph.links to a LoadImage or cached imgs[]; getInlineSourceUrl() builds
the /view URL for files saved under input/pixaroma/audio_studio/."
```

Print: `DONE: D3 (api.mjs landed and smoke-tested)`

### Task D4: `js/audio_studio/ui.mjs` — sidebar tabs

**Files:**
- Modify: `js/audio_studio/ui.mjs` — replace the stub with real implementation
- Modify: `js/audio_studio/core.mjs` — call `_buildSidebar()` from `open()`

**Goal:** Sidebar has 4 tabs (Motion / Overlays / Audio / Output). Switching tabs swaps the visible control panel. Sliders / dropdowns / toggles update `this.cfg` live and call `_refreshSaveBtnState()`. No rendering yet.

- [ ] **Step 1: Implement `ui.mjs`**

```js
// js/audio_studio/ui.mjs
import { AudioStudioEditor } from "./core.mjs";

const ASPECT_OPTIONS = [
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
];
const MOTION_MODES = [
  "scale_pulse", "zoom_punch", "shake", "drift",
  "rotate_pulse", "ripple", "swirl", "slit_scan",
];
const AUDIO_BANDS = ["full", "bass", "mids", "treble"];

function injectSidebarCSS() {
  if (document.getElementById("pix-as-sidebar-css")) return;
  const css = `
    .pix-as-tabs {
      display: flex;
      background: #1c1c1c;
      border-bottom: 1px solid #1a1a1a;
    }
    .pix-as-tab {
      flex: 1;
      padding: 8px 6px;
      text-align: center;
      color: #888;
      font-size: 11px;
      cursor: pointer;
      user-select: none;
    }
    .pix-as-tab.active {
      color: #f66744;
      border-bottom: 2px solid #f66744;
    }
    .pix-as-tab:hover:not(.active) { color: #ccc; }
    .pix-as-controls {
      padding: 12px;
      flex: 1;
      overflow-y: auto;
    }
    .pix-as-control { margin-bottom: 12px; }
    .pix-as-control-row {
      display: flex; align-items: baseline; justify-content: space-between;
      margin-bottom: 4px;
    }
    .pix-as-label {
      color: #aaa;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .pix-as-value {
      color: #ccc;
      font-size: 11px;
      font-family: ui-monospace, monospace;
    }
    .pix-as-slider {
      width: 100%;
      -webkit-appearance: none;
      appearance: none;
      height: 4px;
      background: #1a1a1a;
      border-radius: 2px;
      outline: none;
    }
    .pix-as-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 14px; height: 14px;
      background: #f66744;
      border-radius: 50%;
      cursor: pointer;
    }
    .pix-as-slider::-moz-range-thumb {
      width: 14px; height: 14px;
      background: #f66744;
      border-radius: 50%;
      border: none;
      cursor: pointer;
    }
    .pix-as-dropdown,
    .pix-as-input {
      width: 100%;
      background: #1a1a1a;
      color: #ccc;
      border: 1px solid #333;
      padding: 4px 6px;
      border-radius: 3px;
      font-size: 12px;
      outline: none;
    }
    .pix-as-dropdown:focus,
    .pix-as-input:focus { border-color: #f66744; }
    .pix-as-toggle {
      display: inline-flex; align-items: center; gap: 6px;
      cursor: pointer;
    }
    .pix-as-toggle input { cursor: pointer; }
  `;
  const style = document.createElement("style");
  style.id = "pix-as-sidebar-css";
  style.textContent = css;
  document.head.appendChild(style);
}

AudioStudioEditor.prototype._buildSidebar = function () {
  injectSidebarCSS();
  const sidebar = this.sidebar;
  sidebar.textContent = "";
  sidebar.style.display = "flex";
  sidebar.style.flexDirection = "column";

  const tabs = document.createElement("div");
  tabs.className = "pix-as-tabs";
  this._tabs = {};
  this._tabPanels = {};

  const tabNames = ["Motion", "Overlays", "Audio", "Output"];
  for (const name of tabNames) {
    const tab = document.createElement("span");
    tab.className = "pix-as-tab";
    tab.textContent = name;
    tab.addEventListener("click", () => this._activateTab(name));
    tabs.appendChild(tab);
    this._tabs[name] = tab;
  }
  sidebar.appendChild(tabs);

  for (const name of tabNames) {
    const panel = document.createElement("div");
    panel.className = "pix-as-controls";
    panel.style.display = "none";
    sidebar.appendChild(panel);
    this._tabPanels[name] = panel;
  }

  this._buildMotionTab(this._tabPanels.Motion);
  this._buildOverlaysTab(this._tabPanels.Overlays);
  this._buildAudioTab(this._tabPanels.Audio);
  this._buildOutputTab(this._tabPanels.Output);

  this._activateTab("Motion");
};

AudioStudioEditor.prototype._activateTab = function (name) {
  for (const k of Object.keys(this._tabs)) {
    this._tabs[k].classList.toggle("active", k === name);
    this._tabPanels[k].style.display = k === name ? "block" : "none";
  }
};

AudioStudioEditor.prototype._addSlider = function (panel, label, key, min, max, step, fmt) {
  const ctl = document.createElement("div");
  ctl.className = "pix-as-control";
  const row = document.createElement("div");
  row.className = "pix-as-control-row";
  const lab = document.createElement("span");
  lab.className = "pix-as-label";
  lab.textContent = label;
  const val = document.createElement("span");
  val.className = "pix-as-value";
  const refresh = () => { val.textContent = fmt ? fmt(this.cfg[key]) : String(this.cfg[key]); };
  refresh();
  row.appendChild(lab);
  row.appendChild(val);
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "pix-as-slider";
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(this.cfg[key]);
  slider.addEventListener("input", () => {
    const v = step % 1 === 0 ? parseInt(slider.value, 10) : parseFloat(slider.value);
    this.cfg[key] = v;
    refresh();
    this._onCfgChanged();
  });
  ctl.appendChild(row);
  ctl.appendChild(slider);
  panel.appendChild(ctl);
};

AudioStudioEditor.prototype._addDropdown = function (panel, label, key, options) {
  const ctl = document.createElement("div");
  ctl.className = "pix-as-control";
  const lab = document.createElement("div");
  lab.className = "pix-as-label";
  lab.textContent = label;
  ctl.appendChild(lab);
  const sel = document.createElement("select");
  sel.className = "pix-as-dropdown";
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt; o.textContent = opt;
    sel.appendChild(o);
  }
  sel.value = String(this.cfg[key]);
  sel.addEventListener("change", () => {
    this.cfg[key] = sel.value;
    this._onCfgChanged();
  });
  ctl.appendChild(sel);
  panel.appendChild(ctl);
};

AudioStudioEditor.prototype._addToggle = function (panel, label, key) {
  const ctl = document.createElement("div");
  ctl.className = "pix-as-control";
  const wrap = document.createElement("label");
  wrap.className = "pix-as-toggle";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = !!this.cfg[key];
  cb.addEventListener("change", () => {
    this.cfg[key] = cb.checked;
    this._onCfgChanged();
  });
  const lab = document.createElement("span");
  lab.className = "pix-as-label";
  lab.textContent = label;
  wrap.appendChild(cb);
  wrap.appendChild(lab);
  ctl.appendChild(wrap);
  panel.appendChild(ctl);
};

AudioStudioEditor.prototype._addNumberInput = function (panel, label, key, min, max, step) {
  const ctl = document.createElement("div");
  ctl.className = "pix-as-control";
  const lab = document.createElement("div");
  lab.className = "pix-as-label";
  lab.textContent = label;
  ctl.appendChild(lab);
  const inp = document.createElement("input");
  inp.type = "number";
  inp.className = "pix-as-input";
  inp.min = String(min);
  inp.max = String(max);
  inp.step = String(step);
  inp.value = String(this.cfg[key]);
  inp.addEventListener("change", () => {
    let v = step % 1 === 0 ? parseInt(inp.value, 10) : parseFloat(inp.value);
    if (isNaN(v)) v = this.cfg[key];
    v = Math.max(min, Math.min(max, v));
    this.cfg[key] = v;
    inp.value = String(v);
    this._onCfgChanged();
  });
  ctl.appendChild(inp);
  panel.appendChild(ctl);
};

AudioStudioEditor.prototype._onCfgChanged = function () {
  this._refreshSaveBtnState();
  // Render hook lands in Milestone E
  this._render?.();
};

AudioStudioEditor.prototype._buildMotionTab = function (panel) {
  this._addDropdown(panel, "Motion mode", "motion_mode", MOTION_MODES);
  this._addSlider(panel, "Intensity", "intensity", 0.0, 2.0, 0.05, v => v.toFixed(2));
  this._addSlider(panel, "Motion speed", "motion_speed", 0.05, 1.0, 0.05, v => v.toFixed(2));
  this._addSlider(panel, "Smoothing", "smoothing", 1, 15, 1);
  this._addToggle(panel, "Loop safe", "loop_safe");
};

AudioStudioEditor.prototype._buildOverlaysTab = function (panel) {
  this._addSlider(panel, "Glitch", "glitch_strength", 0.0, 1.0, 0.05, v => v.toFixed(2));
  this._addSlider(panel, "Bloom", "bloom_strength", 0.0, 1.0, 0.05, v => v.toFixed(2));
  this._addSlider(panel, "Vignette", "vignette_strength", 0.0, 1.0, 0.05, v => v.toFixed(2));
  this._addSlider(panel, "Hue shift", "hue_shift_strength", 0.0, 1.0, 0.05, v => v.toFixed(2));
};

AudioStudioEditor.prototype._buildAudioTab = function (panel) {
  // Image/audio source pills are in the header — this tab carries the
  // band selector + a status row reflecting the pill state for visibility.
  this._addDropdown(panel, "Audio band", "audio_band", AUDIO_BANDS);
  // Source-status rows (read-only, mirror header pills)
  const status = document.createElement("div");
  status.style.color = "#888"; status.style.fontSize = "11px"; status.style.marginTop = "20px";
  status.innerHTML = `
    Image source: <code>${this.cfg.image_source}</code><br>
    Audio source: <code>${this.cfg.audio_source}</code><br>
    <em style="color:#666;font-size:10px">(Click pills in header to change)</em>
  `;
  panel.appendChild(status);
};

AudioStudioEditor.prototype._buildOutputTab = function (panel) {
  this._addDropdown(panel, "Aspect ratio", "aspect_ratio", ASPECT_OPTIONS);
  this._addNumberInput(panel, "Custom width",  "custom_width",  64, 4096, 8);
  this._addNumberInput(panel, "Custom height", "custom_height", 64, 4096, 8);
  this._addNumberInput(panel, "FPS",           "fps",            8,   60, 1);
};
```

- [ ] **Step 2: Wire `_buildSidebar()` into `open()`**

In `js/audio_studio/core.mjs`, in the `open()` method, replace the line:
```js
sidebar.textContent = "(sidebar — tabs land in D4)";
```
with:
```js
this._buildSidebar();
```

The `sidebar` variable is already cached as `this.sidebar` — `_buildSidebar` reads from there.

- [ ] **Step 3: Smoke test**

Restart ComfyUI. Open the editor.
- ✅ Sidebar shows tabs Motion / Overlays / Audio / Output.
- ✅ Click a tab → controls swap.
- ✅ Drag a slider (e.g. Intensity) → SAVE button becomes enabled (orange).
- ✅ Click SAVE → editor closes, mutation persists in `node.properties.audioStudioState`.
- ✅ Reopen editor → slider reflects the saved value.
- ✅ Click ×, change, click × → discard prompt; Cancel keeps editor open.

- [ ] **Step 4: Commit**

```bash
git add js/audio_studio/ui.mjs js/audio_studio/core.mjs
git commit -m "audio_studio: tabbed sidebar with all 16 controls

Sidebar tabs (Motion / Overlays / Audio / Output) land with sliders /
dropdowns / toggles / number inputs. Param changes update editor.cfg
live and toggle the SAVE button's dirty state. Render hook (_render)
called on every change — currently a no-op, wired in Milestone E."
```

Print: `DONE: D4 (tabbed sidebar — all 16 controls present and functional)`

---

## Milestone E — WebGL rendering pipeline

**Goal:** Live WebGL preview canvas with all 8 motion modes + 4 overlays. After this milestone, the editor renders the source image in real time, tweaks to sliders update the canvas immediately. Audio data is still placeholder zeros (audio analysis lands in F).

### Task E1: `js/audio_studio/shaders.mjs` — vertex shader + scale_pulse + pass-through overlay

**Files:**
- Modify: `js/audio_studio/shaders.mjs`

**Goal:** First shader landed: `scale_pulse` motion + pass-through overlay (no actual overlays applied yet, just sample input → output). Subsequent E-tasks add the other 7 motion modes and the real overlay shader.

- [ ] **Step 1: Write the shader module**

Replace `js/audio_studio/shaders.mjs` with:

```js
// js/audio_studio/shaders.mjs
"use strict";

/* All shaders use:
 *   uniform sampler2D u_image;       — source image (RGBA8 or RGB8)
 *   uniform sampler2D u_envelope;    — RGBA32F texture, 1×N, R/G/B/A = full/bass/mids/treble
 *   uniform sampler2D u_onset;       — RGBA32F texture, same shape as envelope
 *   uniform int   u_total_frames;    — size of the envelope/onset texture
 *   uniform int   u_frame_index;     — current frame [0, u_total_frames)
 *   uniform int   u_audio_band_idx;  — 0=full, 1=bass, 2=mids, 3=treble
 *   uniform float u_intensity;
 *   uniform float u_motion_speed;
 *   uniform float u_t;               — current frame_index / fps
 *   uniform float u_aspect;          — W / H
 *   uniform vec2  u_resolution;      — (W, H) in pixels
 */

export const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;     // [-1,1] → [0,1]
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const COMMON_PRELUDE = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_image;
uniform sampler2D u_envelope;
uniform sampler2D u_onset;
uniform int   u_total_frames;
uniform int   u_frame_index;
uniform int   u_audio_band_idx;
uniform float u_intensity;
uniform float u_motion_speed;
uniform float u_t;
uniform float u_aspect;
uniform vec2  u_resolution;

float read_band(vec4 sample, int idx) {
    if (idx == 0) return sample.r;
    if (idx == 1) return sample.g;
    if (idx == 2) return sample.b;
    return sample.a;
}

float env_at(int frame_idx) {
    float u = (float(frame_idx) + 0.5) / float(u_total_frames);
    return read_band(texture(u_envelope, vec2(u, 0.5)), u_audio_band_idx);
}

float onset_at(int frame_idx) {
    float u = (float(frame_idx) + 0.5) / float(u_total_frames);
    return read_band(texture(u_onset, vec2(u, 0.5)), u_audio_band_idx);
}

vec4 sample_image(vec2 uv) {
    return texture(u_image, clamp(uv, 0.0, 1.0));
}
`;

// --- Motion shaders -----------------------------------------------------

export const MOTION_SHADERS = {
  // §6.1 of math doc: grid' = grid * (1 - env_t * intensity * 0.15)
  // In UV space (0..1), zoom-in is: uv' = (uv - 0.5) * (1 - s) + 0.5
  scale_pulse: COMMON_PRELUDE + `
void main() {
    float env_t = env_at(u_frame_index);
    float s = env_t * u_intensity * 0.15;
    vec2 centered = v_uv - 0.5;
    vec2 uv = centered * (1.0 - s) + 0.5;
    fragColor = sample_image(uv);
}
`,
};

// --- Overlay shader (pass-through stub for now) -------------------------

export const OVERLAY_SHADER = COMMON_PRELUDE + `
uniform sampler2D u_intermediate;
uniform float u_glitch_strength;
uniform float u_bloom_strength;
uniform float u_vignette_strength;
uniform float u_hue_shift_strength;

void main() {
    // Pass-through stub. Real overlays land in Task E10.
    fragColor = texture(u_intermediate, v_uv);
}
`;

// --- Compile + cache ----------------------------------------------------

const _programCache = new WeakMap();   // gl → {[key: program]}

export function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log}\n--- src ---\n${src}`);
  }
  return sh;
}

export function compileProgram(gl, vsSrc, fsSrc, key) {
  let cache = _programCache.get(gl);
  if (!cache) { cache = {}; _programCache.set(gl, cache); }
  if (key && cache[key]) return cache[key];

  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`program link failed: ${log}`);
  }
  if (key) cache[key] = prog;
  return prog;
}
```

- [ ] **Step 2: Smoke test in console**

Open ComfyUI in a browser, F12 console:
```js
const m = await import("/extensions/ComfyUI-Pixaroma/js/audio_studio/shaders.mjs");
const c = document.createElement("canvas");
const gl = c.getContext("webgl2");
const prog = m.compileProgram(gl, m.VERTEX_SHADER, m.MOTION_SHADERS.scale_pulse, "scale_pulse");
console.log("compile ok:", !!prog);
```
Expected: `compile ok: true`. If it throws, fix the shader source before continuing.

- [ ] **Step 3: Commit**

```bash
git add js/audio_studio/shaders.mjs
git commit -m "audio_studio: shaders.mjs scaffold + scale_pulse motion shader

VERTEX_SHADER + COMMON_PRELUDE + MOTION_SHADERS['scale_pulse'] + a
pass-through OVERLAY_SHADER. compileProgram() with WeakMap cache. Other
7 motion shaders + real overlay shader land in subsequent E-tasks."
```

Print: `DONE: E1 (shader scaffold + scale_pulse compile-clean)`

### Task E2: `js/audio_studio/render.mjs` — pipeline

**Files:**
- Modify: `js/audio_studio/render.mjs`

**Goal:** WebGL2 init, framebuffer setup, render(frameIndex) entry point. Two-pass: motion → intermediate FBO → overlay → screen. Placeholder envelope/onset textures (1×16 RGBA32F filled with zeros). Render is called from `_onCfgChanged()` and on canvas resize.

- [ ] **Step 1: Implement render.mjs**

Replace `js/audio_studio/render.mjs` with:

```js
// js/audio_studio/render.mjs
import { AudioStudioEditor } from "./core.mjs";
import {
  VERTEX_SHADER, MOTION_SHADERS, OVERLAY_SHADER, compileProgram,
} from "./shaders.mjs";

const QUAD_VERTS = new Float32Array([
  -1, -1,  1, -1, -1,  1,
  -1,  1,  1, -1,  1,  1,
]);

AudioStudioEditor.prototype._initRenderer = function () {
  if (this._gl) return;
  const canvas = document.createElement("canvas");
  canvas.style.maxWidth = "100%";
  canvas.style.maxHeight = "100%";
  this.canvasHost.textContent = "";
  this.canvasHost.appendChild(canvas);
  this.canvas = canvas;

  const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false });
  if (!gl) {
    this.canvasHost.textContent = "WebGL2 unavailable — AudioReact requires WebGL2. Use the basic Audio React node instead.";
    return;
  }
  // Required for R32F / RGBA32F texture filtering (renderable). Audio
  // textures use NEAREST so we don't actually need linear-float; still
  // good to enable defensively for future.
  gl.getExtension("EXT_color_buffer_float");

  this._gl = gl;

  // Quad VBO + VAO
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);
  this._quadVAO = vao;
  this._quadVBO = vbo;

  // Compile motion programs lazily — first use of a mode compiles.
  this._motionPrograms = {};
  this._overlayProgram = compileProgram(gl, VERTEX_SHADER, OVERLAY_SHADER, "overlay");
  this._wireQuadAttrib(this._overlayProgram);

  // Image texture — populated on source load (Milestone H)
  this._imageTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, this._imageTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array([128, 128, 128, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Audio textures — placeholder zero arrays of length 16 until F lands
  this._envTex = gl.createTexture();
  this._onsetTex = gl.createTexture();
  this._uploadAudioTexture(this._envTex, new Float32Array(16 * 4));    // 16 frames × 4 bands
  this._uploadAudioTexture(this._onsetTex, new Float32Array(16 * 4));
  this._totalFrames = 16;

  // Intermediate framebuffer + texture (resized in _resizeRenderTargets)
  this._fbo = gl.createFramebuffer();
  this._intermediateTex = gl.createTexture();

  this._resizeRenderTargets(512, 512);

  // Default canvas size — actual size set during _render based on canvasHost dims
  this._canvasW = 512; this._canvasH = 512;
};

AudioStudioEditor.prototype._wireQuadAttrib = function (program) {
  const gl = this._gl;
  gl.useProgram(program);
  const loc = gl.getAttribLocation(program, "a_position");
  if (loc >= 0) {
    gl.bindVertexArray(this._quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadVBO);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }
};

AudioStudioEditor.prototype._uploadAudioTexture = function (tex, rgbaArr) {
  const gl = this._gl;
  const len = rgbaArr.length / 4;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, len, 1, 0, gl.RGBA, gl.FLOAT, rgbaArr);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
};

AudioStudioEditor.prototype._resizeRenderTargets = function (w, h) {
  const gl = this._gl;
  gl.bindTexture(gl.TEXTURE_2D, this._intermediateTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._intermediateTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
};

AudioStudioEditor.prototype._setImage = function (imageEl) {
  // imageEl is an HTMLImageElement or HTMLCanvasElement, fully loaded.
  const gl = this._gl;
  gl.bindTexture(gl.TEXTURE_2D, this._imageTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageEl);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  this._imageW = imageEl.naturalWidth || imageEl.width;
  this._imageH = imageEl.naturalHeight || imageEl.height;
  this._render();
};

AudioStudioEditor.prototype._setAudioTextures = function (envRgbaArr, onsetRgbaArr, totalFrames) {
  this._uploadAudioTexture(this._envTex, envRgbaArr);
  this._uploadAudioTexture(this._onsetTex, onsetRgbaArr);
  this._totalFrames = totalFrames;
  this._render();
};

AudioStudioEditor.prototype._getMotionProgram = function (mode) {
  const gl = this._gl;
  if (this._motionPrograms[mode]) return this._motionPrograms[mode];
  const src = MOTION_SHADERS[mode];
  if (!src) {
    console.warn(`[Pixaroma] AudioReact: motion mode ${mode} has no shader yet — using scale_pulse fallback`);
    return this._getMotionProgram("scale_pulse");
  }
  const prog = compileProgram(gl, VERTEX_SHADER, src, `motion_${mode}`);
  this._wireQuadAttrib(prog);
  this._motionPrograms[mode] = prog;
  return prog;
};

AudioStudioEditor.prototype._currentFrameIndex = function () {
  return Math.min(Math.max(0, this._currentFrame || 0), Math.max(0, this._totalFrames - 1));
};

AudioStudioEditor.prototype._audioBandIndex = function () {
  return ({ full: 0, bass: 1, mids: 2, treble: 3 })[this.cfg.audio_band] ?? 0;
};

AudioStudioEditor.prototype._render = function () {
  if (!this._gl) return;
  const gl = this._gl;

  // Resize backing buffer to canvas host size, preserving aspect.
  const hostRect = this.canvasHost.getBoundingClientRect();
  const maxW = Math.max(64, hostRect.width  | 0);
  const maxH = Math.max(64, hostRect.height | 0);
  let outW, outH;
  if (this._imageW && this._imageH) {
    const ar = this._imageW / this._imageH;
    if (maxW / maxH > ar) { outH = maxH; outW = Math.round(maxH * ar); }
    else                  { outW = maxW; outH = Math.round(maxW / ar); }
  } else {
    outW = maxW; outH = maxH;
  }
  // Cap at 1024 for perf
  if (outW > 1024) { outH = Math.round(outH * (1024 / outW)); outW = 1024; }
  if (outH > 1024) { outW = Math.round(outW * (1024 / outH)); outH = 1024; }
  if (this._canvasW !== outW || this._canvasH !== outH) {
    this.canvas.width = outW;
    this.canvas.height = outH;
    this._canvasW = outW;
    this._canvasH = outH;
    this._resizeRenderTargets(outW, outH);
  }

  const fps = this.cfg.fps || 24;
  const frameIdx = this._currentFrameIndex();
  const t = frameIdx / fps;
  const aspect = outW / outH;

  // -------- Motion pass — render to intermediate FBO --------
  const motionProg = this._getMotionProgram(this.cfg.motion_mode);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
  gl.viewport(0, 0, outW, outH);
  gl.useProgram(motionProg);
  gl.bindVertexArray(this._quadVAO);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this._imageTex);
  gl.uniform1i(gl.getUniformLocation(motionProg, "u_image"), 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, this._envTex);
  gl.uniform1i(gl.getUniformLocation(motionProg, "u_envelope"), 1);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, this._onsetTex);
  gl.uniform1i(gl.getUniformLocation(motionProg, "u_onset"), 2);

  gl.uniform1i(gl.getUniformLocation(motionProg, "u_total_frames"), this._totalFrames);
  gl.uniform1i(gl.getUniformLocation(motionProg, "u_frame_index"), frameIdx);
  gl.uniform1i(gl.getUniformLocation(motionProg, "u_audio_band_idx"), this._audioBandIndex());
  gl.uniform1f(gl.getUniformLocation(motionProg, "u_intensity"), this.cfg.intensity);
  gl.uniform1f(gl.getUniformLocation(motionProg, "u_motion_speed"), this.cfg.motion_speed);
  gl.uniform1f(gl.getUniformLocation(motionProg, "u_t"), t);
  gl.uniform1f(gl.getUniformLocation(motionProg, "u_aspect"), aspect);
  gl.uniform2f(gl.getUniformLocation(motionProg, "u_resolution"), outW, outH);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // -------- Overlay pass — render intermediate to screen --------
  const ovProg = this._overlayProgram;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, outW, outH);
  gl.useProgram(ovProg);
  gl.bindVertexArray(this._quadVAO);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this._intermediateTex);
  gl.uniform1i(gl.getUniformLocation(ovProg, "u_intermediate"), 0);
  // Same audio bindings (in case overlays read them — they do, in E10)
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, this._envTex);
  gl.uniform1i(gl.getUniformLocation(ovProg, "u_envelope"), 1);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, this._onsetTex);
  gl.uniform1i(gl.getUniformLocation(ovProg, "u_onset"), 2);

  gl.uniform1i(gl.getUniformLocation(ovProg, "u_total_frames"), this._totalFrames);
  gl.uniform1i(gl.getUniformLocation(ovProg, "u_frame_index"), frameIdx);
  gl.uniform1i(gl.getUniformLocation(ovProg, "u_audio_band_idx"), this._audioBandIndex());
  gl.uniform1f(gl.getUniformLocation(ovProg, "u_intensity"), this.cfg.intensity);
  gl.uniform1f(gl.getUniformLocation(ovProg, "u_motion_speed"), this.cfg.motion_speed);
  gl.uniform1f(gl.getUniformLocation(ovProg, "u_t"), t);
  gl.uniform1f(gl.getUniformLocation(ovProg, "u_aspect"), aspect);
  gl.uniform2f(gl.getUniformLocation(ovProg, "u_resolution"), outW, outH);

  gl.uniform1f(gl.getUniformLocation(ovProg, "u_glitch_strength"), this.cfg.glitch_strength);
  gl.uniform1f(gl.getUniformLocation(ovProg, "u_bloom_strength"), this.cfg.bloom_strength);
  gl.uniform1f(gl.getUniformLocation(ovProg, "u_vignette_strength"), this.cfg.vignette_strength);
  gl.uniform1f(gl.getUniformLocation(ovProg, "u_hue_shift_strength"), this.cfg.hue_shift_strength);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
};

AudioStudioEditor.prototype._destroyRenderer = function () {
  if (!this._gl) return;
  const gl = this._gl;
  for (const prog of Object.values(this._motionPrograms)) gl.deleteProgram(prog);
  if (this._overlayProgram) gl.deleteProgram(this._overlayProgram);
  if (this._imageTex) gl.deleteTexture(this._imageTex);
  if (this._envTex) gl.deleteTexture(this._envTex);
  if (this._onsetTex) gl.deleteTexture(this._onsetTex);
  if (this._intermediateTex) gl.deleteTexture(this._intermediateTex);
  if (this._fbo) gl.deleteFramebuffer(this._fbo);
  if (this._quadVAO) gl.deleteVertexArray(this._quadVAO);
  if (this._quadVBO) gl.deleteBuffer(this._quadVBO);
  // forceContextLoss to be polite
  const ext = gl.getExtension("WEBGL_lose_context");
  if (ext) try { ext.loseContext(); } catch {}
  this._gl = null;
};
```

- [ ] **Step 2: Wire renderer init + destroy into core.mjs**

In `js/audio_studio/core.mjs`:

1. After `document.body.appendChild(overlay);` in `open()`, add:
   ```js
   this._initRenderer();
   ```
2. In `forceClose()`, before the `this.overlay = null;` line, add:
   ```js
   this._destroyRenderer();
   ```
3. In `_buildSidebar`'s `_onCfgChanged` flow — already calls `this._render?.()` per D4. No change needed.

Also: load a hardcoded test image into the renderer for now, before audio sources land. Add this temp helper at the end of `open()` (just for E2 verification — Milestone H replaces it):

```js
// E2 temp: load a fixed test image so we have something to render
const testImg = new Image();
testImg.crossOrigin = "Anonymous";
testImg.onload = () => this._setImage(testImg);
testImg.onerror = () => console.warn("test image fetch failed");
testImg.src = "/extensions/ComfyUI-Pixaroma/assets/audio_studio_parity/test_image.png";
```

Mark this with a `// TEMP — remove in H1` comment so we can find and delete in Milestone H.

- [ ] **Step 3: Smoke test**

Restart ComfyUI. Drop the node. Click Open AudioReact.
- ✅ Canvas area shows the parity test image.
- ✅ Drag the Intensity slider in the sidebar — image very subtly zooms (env=0 means s=0, so no change). To force visible motion, temporarily edit `_render` to use `env_t = 1.0` or similar — verify the formula triggers.

If the canvas is blank: open DevTools → check for shader compile errors in the console. The most common bug is a uniform name mismatch (look for `u_image` / `u_envelope` etc. spelled differently between shaders.mjs and render.mjs).

- [ ] **Step 4: Commit**

```bash
git add js/audio_studio/render.mjs js/audio_studio/core.mjs
git commit -m "audio_studio: WebGL2 render pipeline (motion pass + pass-through overlay)

WebGL2 init, framebuffer + intermediate texture, motion pass dispatches
to MOTION_SHADERS[mode] (currently only scale_pulse). Overlay pass is
pass-through. Audio textures are 16-frame zero placeholders until F lands.
Test image temporarily hardcoded to verify renderer works end-to-end —
removed in H1."
```

Print: `DONE: E2 (WebGL pipeline rendering scale_pulse against test image)`

### Tasks E3-E9: Add the other 7 motion shaders

For each shader: write the GLSL implementing the formula in `docs/audio-react-math.md` §6.{N}, register in `MOTION_SHADERS`, smoke-test in editor.

For shaders 3-9, reference the math doc §6.2 through §6.8 — the formula transcription is bite-sized (~10-30 lines of GLSL each).

### Task E3: `zoom_punch`

- [ ] Add to `MOTION_SHADERS` (math doc §6.2):
  ```glsl
  zoom_punch: COMMON_PRELUDE + `
  void main() {
      float onset_t = onset_at(u_frame_index);
      float s = onset_t * u_intensity * 0.30;
      vec2 centered = v_uv - 0.5;
      vec2 uv = centered * (1.0 - s) + 0.5;
      fragColor = sample_image(uv);
  }`,
  ```
- [ ] Pick `zoom_punch` in sidebar, smoke test (with envelope still 0, no motion — but compile should succeed, mode should not fall back).
- [ ] Commit: `audio_studio: add zoom_punch motion shader`

Print: `DONE: E3 (zoom_punch)`

### Task E4: `shake` (approximate per math doc §9)

- [ ] Add to `MOTION_SHADERS` — use a tiny inline `mulberry32(0)` deterministic RNG to approximate the cumulative random walk. Sample envelope at the current frame, scale by intensity*0.04. The shader version is intentionally simpler than Python's pre-rendered cumulative walk (preview is approximate; see math doc §9):
  ```glsl
  shake: COMMON_PRELUDE + `
  // Hash-based deterministic noise as a stand-in for torch.Generator(seed=0).
  // See math doc §9 — preview is approximate; final MP4 (Python) is authoritative.
  float hash11(float x) {
      x = fract(x * 0.1031);
      x *= x + 33.33;
      x *= x + x;
      return fract(x);
  }
  void main() {
      float onset_t = onset_at(u_frame_index);
      float fi = float(u_frame_index) + 1.0;
      // Pseudo-walk: blend two hashes seeded by frame index, like the Python
      // exponential decay output — visually similar at a glance.
      float dxRaw = (hash11(fi * 7.0 + 1.0) - 0.5) * 2.0 * onset_t;
      float dyRaw = (hash11(fi * 7.0 + 2.0) - 0.5) * 2.0 * onset_t;
      float amp = u_intensity * 0.04;
      vec2 uv = v_uv - vec2(dxRaw * amp, dyRaw * amp);
      fragColor = sample_image(uv);
  }`,
  ```
- [ ] Smoke test.
- [ ] Commit: `audio_studio: add shake motion shader (approximate; see math doc §9)`

Print: `DONE: E4 (shake)`

### Task E5: `drift` (math doc §6.4)

- [ ] Add to MOTION_SHADERS:
  ```glsl
  drift: COMMON_PRELUDE + `
  void main() {
      float env_t = env_at(u_frame_index);
      float sway = sin(6.28318530718 * u_motion_speed * u_t);
      float bob  = cos(6.28318530718 * u_motion_speed * u_t);
      float amp = env_t * u_intensity * 0.04;
      vec2 uv = v_uv - vec2(sway * amp, bob * amp);
      fragColor = sample_image(uv);
  }`,
  ```
- [ ] Commit: `audio_studio: add drift motion shader`

Print: `DONE: E5 (drift)`

### Task E6: `rotate_pulse` (math doc §6.5)

- [ ] Add (note: shader uses `v_uv` in [0,1], math doc uses grid in [-1,1] — convert):
  ```glsl
  rotate_pulse: COMMON_PRELUDE + `
  void main() {
      float env_t = env_at(u_frame_index);
      float sway = sin(6.28318530718 * u_motion_speed * u_t);
      float angle = sway * env_t * u_intensity * (3.14159265359 / 12.0);
      float c = cos(angle), s = sin(angle);
      // Rotate around (0.5, 0.5) with aspect correction
      vec2 p = (v_uv - 0.5);
      float xs = p.x * u_aspect;
      float ys = p.y;
      float nx = (xs * c - ys * s) / u_aspect;
      float ny = xs * s + ys * c;
      vec2 uv = vec2(nx, ny) + 0.5;
      fragColor = sample_image(uv);
  }`,
  ```
- [ ] Commit: `audio_studio: add rotate_pulse motion shader`

Print: `DONE: E6 (rotate_pulse)`

### Task E7: `ripple` (math doc §6.7)

- [ ] Add:
  ```glsl
  ripple: COMMON_PRELUDE + `
  void main() {
      float env_t = env_at(u_frame_index);
      vec2 p = (v_uv - 0.5) * 2.0;     // [-1,1]
      float xs = p.x * u_aspect;
      float ys = p.y;
      float r = sqrt(xs*xs + ys*ys);
      float k = 6.0 * 3.14159265359;
      float omega = 6.28318530718 * max(u_motion_speed * 4.0, 0.5);
      float A = env_t * u_intensity * 0.015 * 2.0;
      float dr = A * sin(k * r - omega * u_t);
      float r_safe = max(r, 1e-3);
      float dx = dr * (xs) / r_safe / u_aspect;
      float dy = dr * (ys) / r_safe;
      vec2 uv = v_uv + vec2(dx, dy) * 0.5;   // /2 to convert back to [0,1] half-range
      fragColor = sample_image(uv);
  }`,
  ```
- [ ] Smoke test — with envelope=0 should be identity.
- [ ] Commit: `audio_studio: add ripple motion shader`

Print: `DONE: E7 (ripple)`

### Task E8: `swirl` (math doc §6.6)

- [ ] Add:
  ```glsl
  swirl: COMMON_PRELUDE + `
  void main() {
      float env_t = env_at(u_frame_index);
      vec2 p = (v_uv - 0.5) * 2.0;
      float xs = p.x * u_aspect;
      float ys = p.y;
      float r = sqrt(xs*xs + ys*ys);
      float theta = atan(ys, xs);
      float twist = env_t * u_intensity * (3.14159265359 / 2.0) * max(0.0, 1.0 - r);
      float thp = theta + twist;
      float nx = r * cos(thp) / u_aspect;
      float ny = r * sin(thp);
      vec2 uv = vec2(nx, ny) * 0.5 + 0.5;
      fragColor = sample_image(uv);
  }`,
  ```
- [ ] Commit: `audio_studio: add swirl motion shader`

Print: `DONE: E8 (swirl)`

### Task E9: `slit_scan` (math doc §6.8)

- [ ] Add:
  ```glsl
  slit_scan: COMMON_PRELUDE + `
  void main() {
      float env_t = env_at(u_frame_index);
      float yn = (v_uv.y - 0.5) * 2.0;       // y in [-1,1]
      float k = 4.0 * 3.14159265359;
      float omega = 6.28318530718 * max(u_motion_speed * 2.0, 0.4);
      float A = env_t * u_intensity * 0.04;
      float dy = A * sin(k * yn - omega * u_t);
      float dx = A * 0.5 * cos(k * yn - omega * u_t);
      vec2 uv = v_uv + vec2(dx, dy) * 0.5;
      fragColor = sample_image(uv);
  }`,
  ```
- [ ] Commit: `audio_studio: add slit_scan motion shader`

Print: `DONE: E9 (slit_scan — all 8 motion shaders landed)`

### Task E10: Replace pass-through overlay with combined-overlay shader

**Files:**
- Modify: `js/audio_studio/shaders.mjs` — `OVERLAY_SHADER`

**Goal:** Replace the pass-through overlay shader with the real combined shader implementing all 4 overlays (glitch / bloom / vignette / hue_shift) inline, each gated by its strength uniform. Math doc §7.

**Note:** Bloom needs sub-passes (downsample → blur → upsample). For v1 we approximate with an in-shader 9-tap blur sampled at offsets — fast enough at sub-1024 canvas sizes and avoids needing a separate blur framebuffer. Acknowledge in the parity carve-out: bloom is "approximate" in browser preview; Python renders proper separable blur. Add to math doc §9 alongside `shake`.

- [ ] **Step 1: Add bloom to the "approximate" carve-out in math doc**

Open `docs/audio-react-math.md` §9. Add:
```markdown
- **`bloom`** — Python uses downsample → 2-pass separable Gaussian blur →
  upsample → screen blend (3 framebuffer passes). Browser approximates with
  a single in-shader 9-tap radial blur — visually similar but the falloff
  shape and strength are not bit-exact. Final MP4 (Python) is authoritative.
```

Commit the doc edit separately:
```bash
git add docs/audio-react-math.md
git commit -m "docs: bloom is also approximate in browser preview"
```

- [ ] **Step 2: Replace OVERLAY_SHADER**

```js
export const OVERLAY_SHADER = COMMON_PRELUDE + `
uniform sampler2D u_intermediate;
uniform float u_glitch_strength;
uniform float u_bloom_strength;
uniform float u_vignette_strength;
uniform float u_hue_shift_strength;

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec3 hueRotate(vec3 c, float angleRad) {
    float co = cos(angleRad), si = sin(angleRad);
    mat3 m = mat3(
        0.299 + 0.701*co + 0.168*si,  0.299 - 0.299*co - 0.328*si,  0.299 - 0.299*co + 1.250*si,
        0.587 - 0.587*co + 0.330*si,  0.587 + 0.413*co + 0.035*si,  0.587 - 0.587*co - 1.050*si,
        0.114 - 0.114*co - 0.497*si,  0.114 - 0.114*co + 0.292*si,  0.114 + 0.886*co - 0.203*si
    );
    // GLSL mat3 is column-major; m * c expands the same way as Python frame @ m.T
    return clamp(m * c, 0.0, 1.0);
}

void main() {
    float env_t = env_at(u_frame_index);
    float onset_t = onset_at(u_frame_index);

    // ----- GLITCH (math doc §7.1) -----
    vec2 uvR = v_uv, uvG = v_uv, uvB = v_uv;
    if (u_glitch_strength > 0.0 && onset_t > 0.001) {
        float maxPx = max(1.0, onset_t * u_glitch_strength * 0.012 * min(u_resolution.x, u_resolution.y));
        float seed = floor(onset_t * 1e6);
        float sR = (hash12(vec2(seed, 1.0)) > 0.5 ? 1.0 : -1.0);
        float sG = (hash12(vec2(seed, 2.0)) > 0.5 ? 1.0 : -1.0);
        float sB = (hash12(vec2(seed, 3.0)) > 0.5 ? 1.0 : -1.0);
        float dx = maxPx / u_resolution.x;
        uvR.x += sR * dx;
        uvG.x += sG * dx;
        uvB.x += sB * dx;
        // Scanline tear when onset_t * strength > 0.7
        if (onset_t * u_glitch_strength > 0.7) {
            float row = floor(v_uv.y * u_resolution.y);
            // Random 5% of rows snap to neighbor — simulates tear
            if (hash12(vec2(seed, row)) < 0.05) {
                float dy = 1.0 / u_resolution.y;
                uvR.y += dy; uvG.y += dy; uvB.y += dy;
            }
        }
    }
    vec4 base = vec4(
        texture(u_intermediate, clamp(uvR, 0.0, 1.0)).r,
        texture(u_intermediate, clamp(uvG, 0.0, 1.0)).g,
        texture(u_intermediate, clamp(uvB, 0.0, 1.0)).b,
        1.0
    );
    vec3 col = base.rgb;

    // ----- BLOOM (math doc §7.2; approximate per §9) -----
    if (u_bloom_strength > 0.0 && env_t > 0.001) {
        float weight = env_t * u_bloom_strength * 0.6;
        // 9-tap radial blur as cheap stand-in for separable Gaussian
        vec3 acc = vec3(0.0);
        const float OFF = 0.004;
        for (int dx = -1; dx <= 1; dx++) {
            for (int dy = -1; dy <= 1; dy++) {
                vec2 o = vec2(float(dx), float(dy)) * OFF;
                acc += texture(u_intermediate, clamp(v_uv + o, 0.0, 1.0)).rgb;
            }
        }
        acc /= 9.0;
        vec3 bloomLayer = clamp(acc * weight, 0.0, 1.0);
        col = 1.0 - (1.0 - col) * (1.0 - bloomLayer);
        col = clamp(col, 0.0, 1.0);
    }

    // ----- VIGNETTE (math doc §7.3) -----
    if (u_vignette_strength > 0.0 && env_t > 0.001) {
        vec2 p = (v_uv - 0.5) * 2.0;
        float r = clamp(length(p), 0.0, 1.4);
        float v = clamp(r / 1.4142135, 0.0, 1.0);
        float mask = 1.0 - v * env_t * u_vignette_strength * 0.5;
        col *= mask;
    }

    // ----- HUE_SHIFT (math doc §7.4) -----
    if (u_hue_shift_strength > 0.0 && env_t > 0.001) {
        float angle = env_t * u_hue_shift_strength * (30.0 * 3.14159265359 / 180.0);
        col = hueRotate(col, angle);
    }

    fragColor = vec4(col, 1.0);
}
`;
```

- [ ] **Step 3: Smoke test**

Restart ComfyUI. Open editor.
- Drag `glitch_strength` to 1.0 — image should NOT change (envelope is still 0). Override `_currentFrame` from console to 1, manually upload a non-zero envelope:
  ```js
  const ed = app.graph._nodes.find(n => n.comfyClass === "PixaromaAudioStudio")._audioStudioEditor;
  const env = new Float32Array(16 * 4); for (let i = 0; i < 16; i++) env[i*4] = 1.0;
  const ons = new Float32Array(16 * 4); for (let i = 0; i < 16; i++) ons[i*4] = 1.0;
  ed._setAudioTextures(env, ons, 16);
  ```
- ✅ Glitch: visible RGB-channel split.
- Set `vignette_strength=1.0` → corners darken.
- Set `hue_shift_strength=1.0` → image hue rotates ~30°.
- Set `bloom_strength=1.0` → image gets glow.

- [ ] **Step 4: Commit**

```bash
git add js/audio_studio/shaders.mjs
git commit -m "audio_studio: combined-overlay shader (glitch + bloom + vignette + hue_shift)

All 4 overlays inline in OVERLAY_SHADER, each gated by its strength
uniform. Bloom uses an in-shader 9-tap blur (approximate vs Python's
separable Gaussian — documented in math doc §9). Glitch + vignette +
hue_shift are exact-match formulas."
```

Print: `DONE: E10 (all 4 overlays render in WebGL preview)`

---

## Milestone F — Audio analysis (decode + envelope + onset + WAV writer)

**Goal:** When the editor receives audio bytes, decode via Web Audio API → compute 4-band envelope + onset (matching `docs/audio-react-math.md`) → upload as RGBA32F textures to the renderer. Plus a small inline WAV writer so non-WAV uploads can be converted client-side before POSTing to `/pixaroma/api/audio_studio/upload`.

### Task F1: `audio_analysis.mjs` — decode + RMS + bandpass + envelope

**Files:**
- Create: `js/audio_studio/audio_analysis.mjs`

- [ ] **Step 1: Write the module**

```js
// js/audio_studio/audio_analysis.mjs
"use strict";

// ----- Web Audio API decode --------------------------------------------

let _audioCtx = null;

export function getAudioContext() {
  if (_audioCtx) return _audioCtx;
  _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

/** Decode any supported audio format to AudioBuffer. */
export async function decodeAudio(arrayBuffer) {
  const ctx = getAudioContext();
  return await ctx.decodeAudioData(arrayBuffer.slice(0));   // .slice is required per spec on some browsers
}

// ----- Real FFT (Cooley-Tukey radix-2, in-place, complex) ---------------

/** In-place complex FFT. re, im are Float32Array of length n (power of 2). */
function fftComplex(re, im, inverse = false) {
  const n = re.length;
  // Bit reversal permute
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (inverse ? 2 : -2) * Math.PI / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1.0, curIm = 0.0;
      for (let k = 0; k < half; k++) {
        const idx2 = i + k + half;
        const aRe = re[i + k], aIm = im[i + k];
        const bRe = re[idx2] * curRe - im[idx2] * curIm;
        const bIm = re[idx2] * curIm + im[idx2] * curRe;
        re[i + k]   = aRe + bRe;
        im[i + k]   = aIm + bIm;
        re[idx2]    = aRe - bRe;
        im[idx2]    = aIm - bIm;
        const tRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = tRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

/** Bandpass on a real-valued waveform via FFT. lowHz/highHz can be null. */
export function bandpass(real, sampleRate, lowHz, highHz) {
  // Pad to next power of 2
  const origLen = real.length;
  let n = 1; while (n < origLen) n <<= 1;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  re.set(real);
  fftComplex(re, im, false);
  // Mask
  for (let k = 0; k < n; k++) {
    const f = k <= n / 2 ? (k * sampleRate / n) : ((n - k) * sampleRate / n);
    const inLow  = lowHz  == null || f >= lowHz;
    const inHigh = highHz == null || f <= highHz;
    if (!(inLow && inHigh)) { re[k] = 0; im[k] = 0; }
  }
  fftComplex(re, im, true);
  return re.subarray(0, origLen);
}

const BANDS = {
  full:   [null, null],
  bass:   [20, 250],
  mids:   [250, 4000],
  treble: [4000, 20000],
};

// ----- Envelope + onset (mirrors Python math doc §1, §2) ---------------

/** Per-frame RMS → moving-average smooth → peak-normalize. */
function envelopeOneBand(monoWave, sampleRate, fps, smoothing) {
  const totalSamples = monoWave.length;
  const totalFrames = Math.floor((totalSamples / sampleRate) * fps);
  if (totalFrames <= 0) return new Float32Array(0);
  const samplesPerFrame = Math.max(1, Math.floor(sampleRate / fps));
  const required = totalFrames * samplesPerFrame;
  const buf = new Float32Array(required);
  // Repeat-pad if waveform is shorter than required
  for (let i = 0; i < required; i++) buf[i] = monoWave[i % totalSamples];

  const rms = new Float32Array(totalFrames);
  for (let f = 0; f < totalFrames; f++) {
    let sum = 0;
    const off = f * samplesPerFrame;
    for (let i = 0; i < samplesPerFrame; i++) {
      const v = buf[off + i];
      sum += v * v;
    }
    rms[f] = Math.sqrt(sum / samplesPerFrame);
  }

  // Min-max normalize
  let lo = +Infinity, hi = -Infinity;
  for (const v of rms) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi > lo) {
    for (let i = 0; i < totalFrames; i++) rms[i] = (rms[i] - lo) / (hi - lo);
  } else {
    rms.fill(0);
  }

  // Moving-average smooth — kernel of `smoothing` rounded up to odd
  let sw = Math.max(1, smoothing | 0);
  if (sw % 2 === 0) sw += 1;
  if (sw === 1) return rms;
  const half = sw >> 1;
  const out = new Float32Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    let acc = 0, cnt = 0;
    for (let k = -half; k <= half; k++) {
      const idx = Math.min(totalFrames - 1, Math.max(0, i + k));   // replicate-pad
      acc += rms[idx]; cnt++;
    }
    out[i] = acc / cnt;
  }
  return out;
}

/** Onset track (math doc §2). */
export function computeOnsetTrack(envelope) {
  const n = envelope.length;
  if (n === 0) return new Float32Array(0);
  const diff = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const d = envelope[i] - envelope[i - 1];
    diff[i] = d > 0 ? d : 0;
  }
  // Quantile 0.75
  const sorted = Float32Array.from(diff).sort();
  const q75 = sorted[Math.floor((n - 1) * 0.75)];
  const thresh = Math.max(0.05, q75);
  const spikes = new Float32Array(n);
  for (let i = 0; i < n; i++) spikes[i] = diff[i] > thresh ? diff[i] : 0;
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    prev = Math.max(spikes[i], prev * 0.85);
    out[i] = prev;
  }
  let mx = 0;
  for (const v of out) if (v > mx) mx = v;
  if (mx > 0) for (let i = 0; i < n; i++) out[i] /= mx;
  return out;
}

/**
 * Compute per-frame envelopes for ALL 4 audio bands at once + onset for
 * each. Returns arrays packed into RGBA32F texture order:
 *   envelope: Float32Array(totalFrames * 4)  — R=full, G=bass, B=mids, A=treble
 *   onset:    Float32Array(totalFrames * 4)
 *   totalFrames: int
 *
 * @param {AudioBuffer} audioBuffer
 * @param {number} fps
 * @param {number} smoothing
 * @param {boolean} loopSafe
 * @returns {{envelope: Float32Array, onset: Float32Array, totalFrames: number}}
 */
export function computeAll(audioBuffer, fps, smoothing, loopSafe) {
  const sampleRate = audioBuffer.sampleRate;
  // Mono-mix
  const ch = audioBuffer.numberOfChannels;
  const N = audioBuffer.length;
  const mono = new Float32Array(N);
  for (let c = 0; c < ch; c++) {
    const arr = audioBuffer.getChannelData(c);
    for (let i = 0; i < N; i++) mono[i] += arr[i] / ch;
  }

  const totalFrames = Math.floor((N / sampleRate) * fps);
  if (totalFrames <= 0) {
    return { envelope: new Float32Array(0), onset: new Float32Array(0), totalFrames: 0 };
  }

  const envelope = new Float32Array(totalFrames * 4);
  const onset    = new Float32Array(totalFrames * 4);
  const bandKeys = ["full", "bass", "mids", "treble"];

  for (let b = 0; b < 4; b++) {
    const [lo, hi] = BANDS[bandKeys[b]];
    const filtered = (lo == null && hi == null) ? mono : bandpass(mono, sampleRate, lo, hi);
    let env = envelopeOneBand(filtered, sampleRate, fps, smoothing);
    if (loopSafe && totalFrames >= 4) {
      const fadeN = Math.max(2, Math.min(Math.floor(fps * 0.5), Math.floor(totalFrames / 2)));
      // start ramp 0..1
      for (let i = 0; i < fadeN; i++) env[i] *= i / (fadeN - 1);
      // end ramp 1..0
      for (let i = 0; i < fadeN; i++) env[totalFrames - 1 - i] *= i / (fadeN - 1);
    }
    const ons = computeOnsetTrack(env);
    for (let i = 0; i < totalFrames; i++) {
      envelope[i * 4 + b] = env[i];
      onset   [i * 4 + b] = ons[i];
    }
  }

  return { envelope, onset, totalFrames };
}

// ----- WAV writer (16-bit PCM, used by source upload conversion) -------

/**
 * Encode an AudioBuffer to a WAV blob (16-bit PCM, mono or stereo).
 * Used by the editor to convert decoded audio (any format) to WAV before
 * uploading — server only accepts WAV (Python decode via stdlib `wave`).
 */
export function encodeWav(audioBuffer) {
  const numCh = audioBuffer.numberOfChannels;
  const sr = audioBuffer.sampleRate;
  const len = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const byteRate = sr * blockAlign;
  const dataLen = len * blockAlign;

  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  let p = 0;
  function writeStr(s) { for (const c of s) view.setUint8(p++, c.charCodeAt(0)); }
  function u32(v) { view.setUint32(p, v, true); p += 4; }
  function u16(v) { view.setUint16(p, v, true); p += 2; }
  // RIFF header
  writeStr("RIFF"); u32(36 + dataLen); writeStr("WAVE");
  // fmt chunk
  writeStr("fmt "); u32(16); u16(1); u16(numCh); u32(sr); u32(byteRate); u16(blockAlign); u16(16);
  // data chunk
  writeStr("data"); u32(dataLen);

  const channels = [];
  for (let c = 0; c < numCh; c++) channels.push(audioBuffer.getChannelData(c));
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      p += 2;
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}
```

- [ ] **Step 2: Smoke test from console**

```js
const m = await import("/extensions/ComfyUI-Pixaroma/js/audio_studio/audio_analysis.mjs");
// fetch a sample audio file
const r = await fetch("/path/to/some/test.wav");   // adjust path
const ab = await r.arrayBuffer();
const buf = await m.decodeAudio(ab);
const { envelope, onset, totalFrames } = m.computeAll(buf, 24, 5, true);
console.log("frames:", totalFrames, "first 8 env (full band):",
  Array.from(envelope.slice(0, 8 * 4)).filter((_, i) => i % 4 === 0));
```

Verify envelope is non-zero, totalFrames matches `audio_duration * 24`, loop_safe ramps the first frames toward 0.

- [ ] **Step 3: Compare against Python**

Run the parity script's audio synthesizer, dump the envelope, then load the same waveform in browser and compare. Use the math-doc-defined synthesizer directly. Diff should be ≤ 1e-3 (FFT precision differences are normal between platforms).

(This is a sanity check for parity — drives down the risk of WebGL preview drifting from MP4 output.)

- [ ] **Step 4: Commit**

```bash
git add js/audio_studio/audio_analysis.mjs
git commit -m "audio_studio: audio decode + 4-band envelope/onset + WAV writer

audio_analysis.mjs lands with:
- decodeAudio (Web Audio API)
- inline real FFT (radix-2 Cooley-Tukey, no deps)
- bandpass() per band
- computeAll() — 4-band envelope + onset packed for RGBA32F upload
- encodeWav() — 16-bit PCM writer, used to convert non-WAV uploads"
```

Print: `DONE: F1 (audio analysis matches Python within FFT precision)`

### Task F2: Wire audio analysis into the editor open flow

**Files:**
- Modify: `js/audio_studio/core.mjs`

**Goal:** When audio is loaded (whether upstream or inline), call `computeAll` and feed `_setAudioTextures(envelope, onset, totalFrames)`. Source-loading is its own milestone (H), so for now wire a manual `loadAudioBlob(blob)` helper that we can call from console / via the file picker once Milestone H lands.

- [ ] **Step 1: Add helper to AudioStudioEditor**

In `core.mjs`, add the import at the top:
```js
import { decodeAudio, computeAll } from "./audio_analysis.mjs";
```

Add a method on the prototype:
```js
AudioStudioEditor.prototype.loadAudioBlob = async function (blob) {
  this._audioBlob = blob;
  const ab = await blob.arrayBuffer();
  const buf = await decodeAudio(ab);
  this._audioBuffer = buf;
  this._recomputeAudio();
};

AudioStudioEditor.prototype._recomputeAudio = function () {
  if (!this._audioBuffer) return;
  const { envelope, onset, totalFrames } = computeAll(
    this._audioBuffer, this.cfg.fps, this.cfg.smoothing, this.cfg.loop_safe,
  );
  if (totalFrames > 0) {
    this._setAudioTextures(envelope, onset, totalFrames);
    this._currentFrame = 0;
    this._render();
  }
};
```

In `_onCfgChanged()`, call `this._recomputeAudio()` so changing `fps` / `smoothing` / `loop_safe` regenerates the envelope:
```js
AudioStudioEditor.prototype._onCfgChanged = function () {
  this._refreshSaveBtnState();
  // Recompute envelope if fps/smoothing/loop_safe changed
  if (this._audioBuffer) this._recomputeAudio();
  this._render?.();
};
```

- [ ] **Step 2: Smoke test**

Restart ComfyUI. Open editor. Load audio from console:
```js
const ed = app.graph._nodes.find(n => n.comfyClass === "PixaromaAudioStudio")._audioStudioEditor;
const r = await fetch("/path/to/test.wav");
const blob = await r.blob();
await ed.loadAudioBlob(blob);
console.log("totalFrames:", ed._totalFrames);
```

Override `_currentFrame` to a frame with high envelope, re-render:
```js
ed._currentFrame = Math.floor(ed._totalFrames / 2);
ed._render();
```

- ✅ Image visibly responds to motion mode now (envelope > 0).

- [ ] **Step 3: Commit**

```bash
git add js/audio_studio/core.mjs
git commit -m "audio_studio: wire audio analysis into editor (loadAudioBlob, _recomputeAudio)

When an audio Blob is loaded, decodeAudio + computeAll feed the renderer's
RGBA32F envelope/onset textures. fps / smoothing / loop_safe changes
recompute on the fly. Source-loading UX lands in Milestone H — this task
wires the plumbing for it."
```

Print: `DONE: F2 (audio analysis pipeline drives renderer)`

---

## Milestone G — Transport bar + playback + keyboard + undo

**Goal:** Below-canvas transport bar with play/pause, scrub, time display, fps, frame stepper, and the inline 1px envelope sparkline. Web Audio API plays the audio in sync with the playhead. Keyboard shortcuts. Undo/redo for params.

### Task G1: `transport.mjs` — UI shell

**Files:**
- Modify: `js/audio_studio/transport.mjs`

- [ ] **Step 1: Build the transport DOM**

Replace the stub with:

```js
// js/audio_studio/transport.mjs
import { AudioStudioEditor } from "./core.mjs";

function injectTransportCSS() {
  if (document.getElementById("pix-as-transport-css")) return;
  const css = `
    .pix-as-play-btn {
      width: 22px; height: 22px;
      background: #f66744; color: #fff;
      border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; user-select: none;
      font-size: 11px;
      flex-shrink: 0;
    }
    .pix-as-play-btn:hover { filter: brightness(1.1); }
    .pix-as-time {
      color: #aaa;
      font-family: ui-monospace, monospace;
      font-size: 11px;
      min-width: 32px;
      text-align: center;
      flex-shrink: 0;
    }
    .pix-as-scrub {
      flex: 1;
      height: 8px;
      background: #1a1a1a;
      border-radius: 4px;
      position: relative;
      cursor: pointer;
    }
    .pix-as-scrub-spark {
      position: absolute;
      left: 0; right: 0; top: 50%;
      height: 1px;
      pointer-events: none;
      background: #f66744;
      opacity: 0.4;
      transform: translateY(-0.5px);
    }
    .pix-as-scrub-fill {
      position: absolute; left: 0; top: 0; bottom: 0;
      background: #f66744;
      border-radius: 4px;
      pointer-events: none;
      width: 0%;
    }
    .pix-as-scrub-handle {
      position: absolute; top: -3px;
      width: 14px; height: 14px;
      background: #fff;
      border-radius: 50%;
      transform: translateX(-50%);
      pointer-events: none;
      box-shadow: 0 0 4px rgba(0,0,0,0.5);
    }
    .pix-as-fps {
      color: #888; font-size: 11px;
      font-family: ui-monospace, monospace;
      flex-shrink: 0;
    }
    .pix-as-frame-step {
      color: #aaa;
      cursor: pointer; user-select: none;
      padding: 2px 6px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .pix-as-frame-step:hover { background: #3a3a3a; color: #fff; }
  `;
  const style = document.createElement("style");
  style.id = "pix-as-transport-css";
  style.textContent = css;
  document.head.appendChild(style);
}

AudioStudioEditor.prototype._buildTransport = function () {
  injectTransportCSS();
  const t = this.transportEl;
  t.textContent = "";

  const playBtn = document.createElement("span");
  playBtn.className = "pix-as-play-btn";
  playBtn.textContent = "▶";
  playBtn.addEventListener("click", () => this._togglePlay());
  t.appendChild(playBtn);
  this._playBtn = playBtn;

  const curTime = document.createElement("span");
  curTime.className = "pix-as-time";
  curTime.textContent = "0:00";
  t.appendChild(curTime);
  this._curTimeEl = curTime;

  const scrub = document.createElement("div");
  scrub.className = "pix-as-scrub";
  this._scrubEl = scrub;

  const spark = document.createElement("canvas");
  spark.className = "pix-as-scrub-spark";
  this._sparkCanvas = spark;
  scrub.appendChild(spark);

  const fill = document.createElement("div");
  fill.className = "pix-as-scrub-fill";
  scrub.appendChild(fill);
  this._scrubFill = fill;

  const handle = document.createElement("div");
  handle.className = "pix-as-scrub-handle";
  handle.style.left = "0%";
  scrub.appendChild(handle);
  this._scrubHandle = handle;

  t.appendChild(scrub);

  const totalTime = document.createElement("span");
  totalTime.className = "pix-as-time";
  totalTime.textContent = "0:00";
  t.appendChild(totalTime);
  this._totalTimeEl = totalTime;

  const fpsEl = document.createElement("span");
  fpsEl.className = "pix-as-fps";
  fpsEl.textContent = `${this.cfg.fps}fps`;
  t.appendChild(fpsEl);
  this._fpsEl = fpsEl;

  const stepBack = document.createElement("span");
  stepBack.className = "pix-as-frame-step";
  stepBack.textContent = "◀";
  stepBack.title = "Frame back";
  stepBack.addEventListener("click", () => this._stepFrame(-1));
  t.appendChild(stepBack);

  const stepFwd = document.createElement("span");
  stepFwd.className = "pix-as-frame-step";
  stepFwd.textContent = "▶";
  stepFwd.title = "Frame forward";
  stepFwd.addEventListener("click", () => this._stepFrame(1));
  t.appendChild(stepFwd);

  // Scrub interaction
  let dragging = false;
  const seekFromEvent = (ev) => {
    const rect = scrub.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
    const ratio = rect.width > 0 ? x / rect.width : 0;
    const total = Math.max(1, this._totalFrames - 1);
    this._currentFrame = Math.round(ratio * total);
    this._refreshTransport();
    this._render();
    if (this._isPlaying) this._restartPlayback();
  };
  scrub.addEventListener("mousedown", (e) => {
    dragging = true;
    seekFromEvent(e);
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => { if (dragging) seekFromEvent(e); });
  window.addEventListener("mouseup", () => { dragging = false; });
};

AudioStudioEditor.prototype._stepFrame = function (delta) {
  const total = Math.max(1, this._totalFrames);
  this._currentFrame = ((this._currentFrame || 0) + delta + total) % total;
  this._refreshTransport();
  this._render();
};

AudioStudioEditor.prototype._formatTime = function (seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

AudioStudioEditor.prototype._refreshTransport = function () {
  if (!this._playBtn) return;
  const fps = this.cfg.fps || 24;
  const cur = this._currentFrame || 0;
  const total = this._totalFrames || 0;
  const ratio = total > 0 ? cur / Math.max(1, total - 1) : 0;
  this._scrubFill.style.width = (ratio * 100).toFixed(2) + "%";
  this._scrubHandle.style.left = (ratio * 100).toFixed(2) + "%";
  this._curTimeEl.textContent = this._formatTime(cur / fps);
  this._totalTimeEl.textContent = this._formatTime(total / fps);
  this._fpsEl.textContent = `${fps}fps`;
};

AudioStudioEditor.prototype._drawSparkline = function () {
  if (!this._sparkCanvas || !this._totalFrames) return;
  const c = this._sparkCanvas;
  const rect = this._scrubEl.getBoundingClientRect();
  c.width = Math.max(64, rect.width | 0);
  c.height = 1;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  // Pull current band from envelope
  const idx = ({ full: 0, bass: 1, mids: 2, treble: 3 })[this.cfg.audio_band] ?? 0;
  // Need access to the source envelope array — cache from F2
  const env = this._envArray;
  if (!env) return;
  ctx.fillStyle = "rgba(246, 103, 68, 0.7)";
  for (let x = 0; x < c.width; x++) {
    const f = Math.floor(x / c.width * this._totalFrames);
    const v = env[f * 4 + idx];
    // 1px tall — just paint rather than line
    if (v > 0.05) ctx.fillRect(x, 0, 1, 1);
  }
};
```

- [ ] **Step 2: Cache envelope array in F2's `_recomputeAudio` so the sparkline can read it**

In `core.mjs` `_recomputeAudio`:
```js
this._envArray = envelope;       // for sparkline draw
this._setAudioTextures(envelope, onset, totalFrames);
this._totalFrames = totalFrames;
```

- [ ] **Step 3: Call `_buildTransport` from `open()`**

In `core.mjs` `open()`, replace:
```js
transport.textContent = "(transport bar — lands in Milestone G)";
```
with:
```js
this._buildTransport();
```

After `_recomputeAudio` and after `_setAudioTextures`, also call `this._refreshTransport(); this._drawSparkline();`.

- [ ] **Step 4: Smoke test**

Open editor. Load audio from console (per F2 step 2). Verify:
- Total time shows correct duration.
- Click on scrub bar → seeks; canvas updates.
- Click frame step buttons → advances 1 frame.
- Sparkline visible in scrub bar (faint orange).

- [ ] **Step 5: Commit**

```bash
git add js/audio_studio/transport.mjs js/audio_studio/core.mjs
git commit -m "audio_studio: transport bar UI (play, scrub, time, fps, sparkline)

Transport bar lays out per Layout B: play button + current time + scrub
bar with inline 1px envelope sparkline + total duration + fps + frame
stepper. Scrub is interactive (click + drag); play button is a stub
(audio playback wires in G3)."
```

Print: `DONE: G1 (transport bar UI + scrubbing wired)`

### Task G2: Web Audio API playback synced to playhead

**Files:**
- Modify: `js/audio_studio/transport.mjs` — add play/pause + animation loop

- [ ] **Step 1: Add play/pause + animation loop**

Append to `transport.mjs`:

```js
import { getAudioContext } from "./audio_analysis.mjs";

AudioStudioEditor.prototype._togglePlay = function () {
  if (!this._audioBuffer) return;
  if (this._isPlaying) this._pausePlayback();
  else this._startPlayback();
};

AudioStudioEditor.prototype._startPlayback = function () {
  const fps = this.cfg.fps || 24;
  const offsetSec = (this._currentFrame || 0) / fps;
  const ctx = getAudioContext();
  if (ctx.state === "suspended") ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = this._audioBuffer;
  src.connect(ctx.destination);
  src.start(0, offsetSec);
  this._sourceNode = src;
  this._playStartCtxTime = ctx.currentTime;
  this._playStartOffsetSec = offsetSec;
  this._isPlaying = true;
  this._playBtn.textContent = "⏸";

  const loop = () => {
    if (!this._isPlaying) return;
    const elapsed = ctx.currentTime - this._playStartCtxTime;
    const sec = this._playStartOffsetSec + elapsed;
    const newFrame = Math.floor(sec * fps);
    if (newFrame >= this._totalFrames) {
      this._pausePlayback();
      this._currentFrame = 0;
      this._refreshTransport();
      this._render();
      return;
    }
    this._currentFrame = newFrame;
    this._refreshTransport();
    this._render();
    this._rafId = requestAnimationFrame(loop);
  };
  this._rafId = requestAnimationFrame(loop);
};

AudioStudioEditor.prototype._pausePlayback = function () {
  if (this._sourceNode) {
    try { this._sourceNode.stop(); } catch {}
    try { this._sourceNode.disconnect(); } catch {}
    this._sourceNode = null;
  }
  if (this._rafId) cancelAnimationFrame(this._rafId);
  this._rafId = 0;
  this._isPlaying = false;
  if (this._playBtn) this._playBtn.textContent = "▶";
};

AudioStudioEditor.prototype._restartPlayback = function () {
  // Called when user scrubs while playing — stop + start at new offset.
  this._pausePlayback();
  this._startPlayback();
};
```

In `forceClose()` of core.mjs, add:
```js
this._pausePlayback?.();
```

- [ ] **Step 2: Smoke test**

Open editor, load audio. Click play → audio plays + canvas animates frame-by-frame in sync. Click pause → both stop. Drag scrub during playback → seeks + restarts from new offset. Let it play to the end → auto-rewinds to frame 0.

- [ ] **Step 3: Commit**

```bash
git add js/audio_studio/transport.mjs js/audio_studio/core.mjs
git commit -m "audio_studio: Web Audio API playback synced to playhead

Play/pause toggles a single AudioBufferSourceNode (Web Audio quirk:
sources can't be restarted, so each play creates a fresh one starting
at the current offset). RAF loop derives current_frame from
audioContext.currentTime - start_offset. Auto-rewind on end."
```

Print: `DONE: G2 (audio plays in sync with WebGL preview)`

### Task G3: Keyboard shortcuts

**Files:**
- Modify: `js/audio_studio/core.mjs`

**Goal:** Space / arrows / Shift+arrows wired. Esc + Ctrl+S already done in D2.

- [ ] **Step 1: Extend the existing keyboard handler in core.mjs**

In `open()`, the existing `_keyHandler` only handles Esc + Ctrl+S. Extend it:

```js
this._keyHandler = (e) => {
  if (document.querySelector(".pix-as-confirm-backdrop")) return;
  if (e.key === "Escape") {
    e.preventDefault(); e.stopImmediatePropagation();
    this.close();
  } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault(); e.stopImmediatePropagation();
    this._save();
  } else if (e.code === "Space") {
    // Don't intercept space inside text inputs / textareas
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    e.preventDefault(); e.stopImmediatePropagation();
    this._togglePlay?.();
  } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const sign = e.code === "ArrowLeft" ? -1 : 1;
    const stepFrames = e.shiftKey ? Math.max(1, this.cfg.fps) : 1;
    this._stepFrame?.(sign * stepFrames);
  } else if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
    e.preventDefault(); e.stopImmediatePropagation();
    this._undo?.();
  } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "Z"))) {
    e.preventDefault(); e.stopImmediatePropagation();
    this._redo?.();
  }
};
```

- [ ] **Step 2: Smoke test**

Open editor, load audio. Test each shortcut:
- Space: play / pause (verify it doesn't trigger when focus is in a number input)
- ←: step back 1 frame
- →: step forward 1 frame
- Shift+←: step back fps frames (1s)
- Shift+→: step forward fps frames

Ctrl+Z and Ctrl+Y do nothing yet (G4).

- [ ] **Step 3: Commit**

```bash
git add js/audio_studio/core.mjs
git commit -m "audio_studio: keyboard shortcuts (space / arrows / shift+arrows)

Spacebar plays/pauses, arrows step a frame, Shift+arrows step 1s. Inputs
and dropdowns keep their default behavior (we check tag name before
intercepting). Ctrl+Z/Ctrl+Y wired but undo stack lands in G4."
```

Print: `DONE: G3 (keyboard shortcuts working)`

### Task G4: Param undo / redo

**Files:**
- Modify: `js/audio_studio/core.mjs`
- Modify: `js/audio_studio/ui.mjs` — debounced snapshot on slider settle

**Goal:** ~50-level param undo. Debounced snap (200ms after last change) so dragging a slider doesn't flood the stack. Source-file changes (load image / load audio) snap immediately. Shortcuts already wired in G3.

- [ ] **Step 1: Add undo state + helpers in core.mjs**

```js
// In AudioStudioEditor constructor:
this._undoStack = [];
this._redoStack = [];
this._snapTimer = null;
```

```js
// Methods:
AudioStudioEditor.prototype._snapForUndo = function (immediate) {
  const snapshot = JSON.stringify(this.cfg);
  if (this._lastSnapshot === snapshot) return;
  if (this._snapTimer) clearTimeout(this._snapTimer);
  if (immediate) {
    this._undoStack.push(this._lastSnapshot ?? snapshot);
    this._lastSnapshot = snapshot;
    if (this._undoStack.length > 50) this._undoStack.shift();
    this._redoStack.length = 0;
  } else {
    this._snapTimer = setTimeout(() => {
      this._undoStack.push(this._lastSnapshot ?? snapshot);
      this._lastSnapshot = JSON.stringify(this.cfg);
      if (this._undoStack.length > 50) this._undoStack.shift();
      this._redoStack.length = 0;
      this._snapTimer = null;
    }, 200);
  }
};

AudioStudioEditor.prototype._undo = function () {
  if (this._undoStack.length === 0) return;
  const cur = JSON.stringify(this.cfg);
  this._redoStack.push(cur);
  const prev = this._undoStack.pop();
  this.cfg = JSON.parse(prev);
  this._lastSnapshot = prev;
  this._refreshAfterRestore();
};

AudioStudioEditor.prototype._redo = function () {
  if (this._redoStack.length === 0) return;
  const cur = JSON.stringify(this.cfg);
  this._undoStack.push(cur);
  const nxt = this._redoStack.pop();
  this.cfg = JSON.parse(nxt);
  this._lastSnapshot = nxt;
  this._refreshAfterRestore();
};

AudioStudioEditor.prototype._refreshAfterRestore = function () {
  // Rebuild the sidebar (cheap, ensures UI reflects this.cfg)
  this._buildSidebar();
  this._refreshSaveBtnState();
  if (this._audioBuffer) this._recomputeAudio();
  this._render();
};
```

In `open()`, after building UI:
```js
this._lastSnapshot = JSON.stringify(this.cfg);
```

- [ ] **Step 2: Hook `_snapForUndo` into ui.mjs `_onCfgChanged`**

Modify `_onCfgChanged` in core.mjs (already exists) to call `this._snapForUndo(false)` on every change:
```js
AudioStudioEditor.prototype._onCfgChanged = function () {
  this._snapForUndo(false);
  this._refreshSaveBtnState();
  if (this._audioBuffer) this._recomputeAudio();
  this._render?.();
};
```

For source-file changes (added in Milestone H), the source-load helper should call `this._snapForUndo(true)` immediately.

- [ ] **Step 3: Smoke test**

Open editor. Drag intensity slider from 0.8 → 1.5. Wait 250ms. Press Ctrl+Z. Slider should jump back to 0.8.

Drag intensity 0.8 → 1.0 → 1.2 → 1.4 (in quick succession within 200ms each). Wait 250ms after the last drag. Press Ctrl+Z — should jump back to 0.8 (one snap, not four).

Press Ctrl+Y — should jump forward to 1.4.

Drag through 50+ unique snaps. Verify the oldest gets discarded.

- [ ] **Step 4: Commit**

```bash
git add js/audio_studio/core.mjs js/audio_studio/ui.mjs
git commit -m "audio_studio: param undo/redo (~50 levels, debounced)

_snapForUndo(immediate=false) debounces by 200ms so slider drags don't
flood the stack. Source-file changes (Milestone H) call with
immediate=true. Ctrl+Z / Ctrl+Y restore the cfg, rebuild the sidebar to
reflect it, and rerender. Keyboard shortcuts were already wired in G3."
```

Print: `DONE: G4 (param undo/redo working)`

---

## Milestone H — Source loading + persistence end-to-end

**Goal:** Connect the editor to real upstream / inline image and audio sources. Source pills in the header become interactive (click to switch / pick). File picker + drag-drop on canvas. Inline files upload via api.mjs. Save flushes everything to disk + writes JSON.

### Task H1: Image source resolution (upstream + file picker + drag-drop)

**Files:**
- Modify: `js/audio_studio/core.mjs`
- Modify: `js/audio_studio/ui.mjs`

- [ ] **Step 1: Replace the temp test-image load from E2 with real source resolution**

In `core.mjs` `open()`, REMOVE the `// E2 temp:` block.

Add a new method:
```js
import { getUpstreamImageUrl, getInlineSourceUrl, uploadSource } from "./api.mjs";

AudioStudioEditor.prototype._resolveImageSource = async function () {
  if (this.cfg.image_source === "upstream") {
    const url = getUpstreamImageUrl(app.graph, this.node);
    if (!url) {
      this._showCanvasMessage(
        "Upstream image not ready — wire a Load Image, run the workflow once, or switch to Inline."
      );
      return;
    }
    await this._loadImageFromUrl(url);
    this._updatePill(this.imgPill, "Image: Upstream", true);
  } else if (this.cfg.image_source === "inline") {
    if (!this.cfg.image_path) {
      this._showCanvasMessage("Click 'Image: Inline' pill to load an image.");
      return;
    }
    const url = getInlineSourceUrl(this.cfg.image_path);
    await this._loadImageFromUrl(url);
    this._updatePill(this.imgPill, `Image: Inline (${this.cfg.image_path.split("/").pop()})`, false);
  }
};

AudioStudioEditor.prototype._loadImageFromUrl = function (url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => { this._setImage(img); resolve(); };
    img.onerror = () => { this._showCanvasMessage("Image load failed: " + url); reject(); };
    img.src = url;
  });
};

AudioStudioEditor.prototype._showCanvasMessage = function (msg) {
  this.canvasHost.textContent = msg;
};

AudioStudioEditor.prototype._updatePill = function (pillEl, text, connected) {
  pillEl.textContent = text;
  pillEl.classList.toggle("connected", connected);
};

AudioStudioEditor.prototype._pickInlineImage = async function () {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/png,image/jpeg,image/webp";
  inp.addEventListener("change", async () => {
    const file = inp.files?.[0];
    if (!file) return;
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const filename = `image.${ext === "jpg" ? "jpg" : ext}`;
      const { path } = await uploadSource(this.node.id, "image", file, filename);
      this.cfg.image_source = "inline";
      this.cfg.image_path = path;
      this._snapForUndo(true);
      this._refreshSaveBtnState();
      this._resolveImageSource();
    } catch (e) {
      alert("Image upload failed: " + e.message);
    }
  });
  inp.click();
};
```

- [ ] **Step 2: Wire the image pill click**

In `_buildHeader()`:
```js
this.imgPill = this._buildPill(...);
this.imgPill.addEventListener("click", () => this._onImagePillClick());
```

```js
AudioStudioEditor.prototype._onImagePillClick = function () {
  // 3-state cycle: Upstream → Inline (picker) → Inline (already loaded? → swap)
  if (this.cfg.image_source === "upstream") {
    this._pickInlineImage();
  } else {
    // Already inline — offer: re-pick, or revert to upstream if input is wired
    const upstreamWired = !!getUpstreamImageUrl(app.graph, this.node);
    if (upstreamWired) {
      this.cfg.image_source = "upstream";
      this._snapForUndo(true);
      this._refreshSaveBtnState();
      this._resolveImageSource();
    } else {
      this._pickInlineImage();
    }
  }
};
```

(Same pattern for audio — wired in H2.)

- [ ] **Step 3: Drag-drop image onto canvas**

In `_initRenderer()` (render.mjs), after `this.canvas` is created, add drag-drop handlers (need access to editor `this`):

Actually, this fits better in core.mjs `open()`. Add after the canvas host is appended:

```js
this.canvasHost.addEventListener("dragover", (e) => { e.preventDefault(); });
this.canvasHost.addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (file.type.startsWith("image/")) {
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const filename = `image.${ext === "jpg" ? "jpg" : ext}`;
    try {
      const { path } = await uploadSource(this.node.id, "image", file, filename);
      this.cfg.image_source = "inline";
      this.cfg.image_path = path;
      this._snapForUndo(true);
      this._refreshSaveBtnState();
      await this._resolveImageSource();
    } catch (err) { alert("Image upload failed: " + err.message); }
  } else if (file.type.startsWith("audio/")) {
    await this._handleAudioFile(file);   // implemented in H2
  }
});
```

- [ ] **Step 4: Call `_resolveImageSource` from `open()`**

After `_initRenderer()`:
```js
this._resolveImageSource();
```

- [ ] **Step 5: Smoke test**

In ComfyUI, drop the AudioReact node + Load Image upstream + connect. Click button to open.
- ✅ Image visible (upstream).
- Disconnect Load Image. Reopen.
- ✅ Canvas shows "Upstream image not ready" message.
- Click Image pill → file picker → pick an image.
- ✅ Image visible. Pill shows "Image: Inline (filename)".
- Drag-drop a different image onto canvas → swaps inline source.

- [ ] **Step 6: Commit**

```bash
git add js/audio_studio/core.mjs
git commit -m "audio_studio: image source resolution (upstream + inline + drag-drop)

Editor walks node.inputs[image].link to LoadImage / cached imgs[]. Inline
images go through /pixaroma/api/audio_studio/upload + ComfyUI's /view
route. Image pill click cycles upstream<->inline; drag-drop onto canvas
also switches to inline."
```

Print: `DONE: H1 (image sources work end-to-end)`

### Task H2: Audio source resolution + WAV conversion

**Files:**
- Modify: `js/audio_studio/core.mjs`
- Modify: `js/audio_studio/api.mjs`

**Goal:** Same dual-source logic for audio. When user picks a non-WAV audio file, browser decodes via `decodeAudio` then re-encodes via `encodeWav` from F1 before uploading.

- [ ] **Step 1: Add helpers**

In `core.mjs`, import the WAV writer:
```js
import { encodeWav } from "./audio_analysis.mjs";
```

```js
AudioStudioEditor.prototype._resolveAudioSource = async function () {
  if (this.cfg.audio_source === "upstream") {
    // Upstream resolution: walk links to a Load Audio (or cached audio path)
    const audioInputIdx = (this.node.inputs || []).findIndex(i => i.name === "audio");
    if (audioInputIdx < 0) {
      this._showCanvasMessage("(no audio input slot)");
      return;
    }
    const link = this.node.inputs[audioInputIdx].link;
    if (link == null) {
      this._showCanvasMessage("Upstream audio not wired — switch to Inline or wire a Load Audio.");
      return;
    }
    // Walk to source. Load Audio nodes typically have a widget["audio"] or
    // similar — fall back to the cached preview if available.
    let l = app.graph.links?.[link];
    if (!l && typeof app.graph.links?.get === "function") l = app.graph.links.get(link);
    if (!l) { this._showCanvasMessage("Upstream link unresolvable."); return; }
    const src = app.graph.getNodeById(l.origin_id);
    let url = null;
    if (src) {
      const w = src.widgets?.find(w => w.name === "audio" || w.name === "audio_file");
      if (w && w.value) {
        const fn = String(w.value).split(/[\\/]/).pop();
        url = `/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=&t=${Date.now()}`;
      }
    }
    if (!url) {
      this._showCanvasMessage("Upstream audio source not previewable yet — switch to Inline or run the workflow once.");
      return;
    }
    const r = await fetch(url);
    const blob = await r.blob();
    await this.loadAudioBlob(blob);
    this._updatePill(this.audioPill, "Audio: Upstream", true);
  } else if (this.cfg.audio_source === "inline") {
    if (!this.cfg.audio_path) {
      this._updatePill(this.audioPill, "Audio: Inline (load…)", false);
      return;
    }
    const r = await fetch(getInlineSourceUrl(this.cfg.audio_path));
    const blob = await r.blob();
    await this.loadAudioBlob(blob);
    this._updatePill(this.audioPill, `Audio: Inline (${this.cfg.audio_path.split("/").pop()})`, false);
  }
};

AudioStudioEditor.prototype._handleAudioFile = async function (file) {
  // Decode → re-encode WAV → upload.
  let wavBlob;
  if (file.type === "audio/wav" || file.name.toLowerCase().endsWith(".wav")) {
    wavBlob = file;
  } else {
    const ab = await file.arrayBuffer();
    const buf = await getAudioContext().decodeAudioData(ab.slice(0));
    wavBlob = encodeWav(buf);
  }
  try {
    const { path } = await uploadSource(this.node.id, "audio", wavBlob, "audio.wav");
    this.cfg.audio_source = "inline";
    this.cfg.audio_path = path;
    this._snapForUndo(true);
    this._refreshSaveBtnState();
    await this._resolveAudioSource();
  } catch (e) {
    alert("Audio upload failed: " + e.message);
  }
};

AudioStudioEditor.prototype._pickInlineAudio = async function () {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "audio/*";
  inp.addEventListener("change", async () => {
    const file = inp.files?.[0];
    if (!file) return;
    await this._handleAudioFile(file);
  });
  inp.click();
};

AudioStudioEditor.prototype._onAudioPillClick = function () {
  if (this.cfg.audio_source === "upstream") {
    this._pickInlineAudio();
  } else {
    // Toggle back to upstream if wired
    const audioInputIdx = (this.node.inputs || []).findIndex(i => i.name === "audio");
    if (audioInputIdx >= 0 && this.node.inputs[audioInputIdx].link != null) {
      this.cfg.audio_source = "upstream";
      this._snapForUndo(true);
      this._refreshSaveBtnState();
      this._resolveAudioSource();
    } else {
      this._pickInlineAudio();
    }
  }
};
```

In `_buildHeader()`:
```js
this.audioPill.addEventListener("click", () => this._onAudioPillClick());
```

In `open()`, after `_resolveImageSource`:
```js
this._resolveAudioSource();
```

Also: in `decodeAudio` import, get audio context lazily — already in audio_analysis.mjs.

Reference `getAudioContext` import in core.mjs:
```js
import { getAudioContext } from "./audio_analysis.mjs";
```

- [ ] **Step 2: Smoke test**

In ComfyUI, wire a Load Audio upstream → open editor → audio loads + plays. Click audio pill → file picker → pick MP3 → uploads as WAV → playback works. Drag-drop an audio file onto canvas → also switches to inline.

- [ ] **Step 3: Commit**

```bash
git add js/audio_studio/core.mjs
git commit -m "audio_studio: audio source resolution + browser WAV conversion

Inline audio: decodeAudioData → encodeWav (PCM 16-bit) → upload to
/pixaroma/api/audio_studio/upload. Server only accepts WAV — Python side
stays dependency-free (stdlib wave). Drag-drop audio onto canvas works
the same as the Audio pill picker."
```

Print: `DONE: H2 (audio sources work end-to-end, MP3/OGG/AAC convert to WAV)`

### Task H3: Save flow end-to-end

**Files:**
- (No new files — verifying existing wiring.)

**Goal:** Confirm the full Save → Run-workflow → Render-MP4 path works. Save commits `studio_json` via Pattern #9, Python reads it, engine runs, MP4 produced via Save Mp4 Pixaroma.

- [ ] **Step 1: Manual smoke test**

In ComfyUI:
1. Drop: Load Image → AudioReact Pixaroma ← Load Audio
2. Drop: Save Mp4 Pixaroma, wire AudioReact's outputs (frames, audio, fps) to it.
3. Click "Open AudioReact" on the node.
4. Tweak motion mode, intensity, an overlay or two.
5. Click Save.
6. ✅ Editor closes. The node's `properties.audioStudioState` reflects the config.
7. Save the workflow JSON (Ctrl+S in ComfyUI).
8. Open the workflow JSON in a text editor — verify the AudioStudio node has `properties: { audioStudioState: { ... } }` with the saved config.
9. Reload the workflow. Reopen the editor — verify all params + sources restored.
10. Click Run Workflow.
11. ✅ Workflow runs without errors. Save Mp4 Pixaroma produces an MP4. Verify MP4 motion + overlays match the editor preview reasonably (modulo `shake` and `bloom` carve-outs).

- [ ] **Step 2: Commit (only if any fixes were needed)**

If smoke test passed without code changes, no commit. If you found bugs, commit fixes:
```bash
git add <files>
git commit -m "audio_studio: H3 smoke-test fixes — <specifics>"
```

Print: `DONE: H3 (end-to-end Save → workflow run produces MP4)`

### Task H4: Edge cases — disconnect upstream while editor open, schema migration

**Files:**
- Modify: `js/audio_studio/core.mjs`
- Modify: `nodes/node_audio_studio.py`

**Goal:** Handle the rough edges:
1. User opens editor with upstream wired, then disconnects Load Image while editor is open. Editor doesn't crash; canvas shows the "switch to inline" message.
2. Old saved configs (lacking `schema_version` or new keys) load with defaults.

- [ ] **Step 1: Listen for connection changes in core.mjs**

In `open()`, after building UI, save a reference to the original `onConnectionsChange`:
```js
const origOnConn = this.node.onConnectionsChange?.bind(this.node);
this.node.onConnectionsChange = (type, slotIndex, connected) => {
  origOnConn?.(type, slotIndex, connected);
  if (type !== LiteGraph.INPUT) return;
  const inputName = this.node.inputs?.[slotIndex]?.name;
  if (inputName === "image" && this.cfg.image_source === "upstream") {
    this._resolveImageSource();
  } else if (inputName === "audio" && this.cfg.audio_source === "upstream") {
    this._resolveAudioSource();
  }
};
```

In `forceClose`:
```js
if (origOnConn) this.node.onConnectionsChange = origOnConn;
```

(Cache origOnConn on `this._origOnConnectionsChange` so forceClose can restore.)

- [ ] **Step 2: Add a migration test in node_audio_studio.py**

In `_migrate_cfg`, add a basic migration sketch (no-op for v1 — just locks the structure):
```python
def _migrate_cfg(cfg: dict) -> dict:
    version = cfg.get("schema_version", 1)
    # v1 — current. Future migrations chain here, e.g.:
    # if version < 2: cfg = _migrate_v1_to_v2(cfg); version = 2
    cfg["schema_version"] = version
    return cfg
```

Add a test in JS-land that an empty or partial cfg loads cleanly. From browser console:
```js
const ed = new (await import("/extensions/ComfyUI-Pixaroma/js/audio_studio/core.mjs")).AudioStudioEditor(
  app.graph._nodes.find(n => n.comfyClass === "PixaromaAudioStudio"),
  {}   // empty config
);
ed.open();
// Verify defaults applied — sidebar shows scale_pulse, intensity 0.8, etc.
ed.forceClose();
```

(Manually copy this verification, no automated test framework.)

- [ ] **Step 3: Commit**

```bash
git add js/audio_studio/core.mjs nodes/node_audio_studio.py
git commit -m "audio_studio: handle upstream disconnect + lock schema_version

Editor's onConnectionsChange listener re-resolves image/audio source when
upstream wiring changes mid-edit. _migrate_cfg sketch in Python ensures
schema_version is always present; future migrations chain there."
```

Print: `DONE: H4 (upstream disconnect + schema_version migration)`

---

## Milestone I — Browser parity harness + docs + final smoke test

**Goal:** Land the manual browser parity verification page, update CLAUDE.md + README, and run a final end-to-end smoke test before declaring v1 shippable.

### Task I1: Browser parity harness page

**Files:**
- Create: `assets/audio_studio_parity/index.html`

**Goal:** Standalone HTML page that loads the committed test image + golden PNGs from `tests/audio_parity_goldens/`, runs the WebGL pipeline against the same params, displays each (golden, WebGL) pair side-by-side with a per-pair ΔE badge.

- [ ] **Step 1: Write the harness**

```html
<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>AudioReact — WebGL Parity Harness</title>
<style>
  body { font-family: system-ui, sans-serif; background: #1c1c1c; color: #ddd; padding: 16px; }
  h1 { color: #f66744; }
  .pair { display: flex; gap: 8px; margin-bottom: 12px; align-items: flex-start; }
  .pair img, .pair canvas { width: 256px; height: 256px; image-rendering: pixelated; background: #000; }
  .info { font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.6; }
  .pass { color: #6c6; }
  .fail { color: #e66; }
  .approx { color: #db5; }
  #goldensDir { width: 480px; padding: 4px; background: #2a2a2a; color: #ddd; border: 1px solid #444; border-radius: 3px; }
</style>
</head><body>

<h1>AudioReact — WebGL Parity Harness</h1>
<p>Compares Python golden frames vs the live WebGL pipeline using the same
params. Mean ΔE ≤ 5.0 = pass for non-shake / non-bloom tests; shake + bloom
are flagged as approximate (math doc §9).</p>

<p><label>Goldens path: <input id="goldensDir" value="../../tests/audio_parity_goldens/"></label>
<button id="run">Run Parity</button></p>

<div id="results"></div>

<script type="module">
// Inline harness — duplicates a SUBSET of the editor's render pipeline to keep
// this page standalone (no ComfyUI server needed).

import { VERTEX_SHADER, MOTION_SHADERS, OVERLAY_SHADER, compileProgram }
  from "../../js/audio_studio/shaders.mjs";
import { decodeAudio, computeAll } from "../../js/audio_studio/audio_analysis.mjs";

const canvas = document.createElement("canvas");
canvas.width = canvas.height = 512;
const gl = canvas.getContext("webgl2");
if (!gl) throw new Error("WebGL2 unavailable");
gl.getExtension("EXT_color_buffer_float");

const QUAD = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]);
const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
const vao = gl.createVertexArray(); gl.bindVertexArray(vao);

function wireQuad(prog) {
  gl.useProgram(prog);
  const loc = gl.getAttribLocation(prog, "a_position");
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

const overlayProg = compileProgram(gl, VERTEX_SHADER, OVERLAY_SHADER, "ovh"); wireQuad(overlayProg);

// Synthesize the same test audio as scripts/audio_parity_check.py
function synthAudio(durationS, sampleRate, seed) {
  const n = (durationS * sampleRate) | 0;
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const f0 = 100, f1 = 2000;
    const phase = 2 * Math.PI * (f0 * t + (f1 - f0) * t * t / (2 * durationS));
    w[i] = 0.3 * Math.sin(phase);
  }
  // mulberry32 with `seed` (matches numpy RandomState only in spirit — math
  // doc §9 calls out that audio onset envelopes can drift slightly across
  // platforms; for parity tests we accept the drift in onset textures).
  let s = seed >>> 0;
  function rng() { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  const fps = 30;
  for (const fr of [30, 60, 90]) {
    const center = ((fr / fps) * sampleRate) | 0;
    for (let i = Math.max(0, center - 200); i < Math.min(n, center + 200); i++) {
      const x = (i - center) / 200;
      w[i] += Math.exp(-x * x * 8) * 0.7 * (rng() - 0.5) * 0.5;
    }
  }
  for (let i = 0; i < n; i++) w[i] = Math.max(-1, Math.min(1, w[i]));
  return { sampleRate, waveform: w };
}

function buildAudioBuffer({ waveform, sampleRate }) {
  const ctx = new AudioContext();
  const buf = ctx.createBuffer(1, waveform.length, sampleRate);
  buf.getChannelData(0).set(waveform);
  return buf;
}

async function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image(); img.crossOrigin = "Anonymous";
    img.onload = () => res(img); img.onerror = rej; img.src = url;
  });
}

function makeImageTexture(img) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
function makeAudioTex(arr) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, arr.length / 4, 1, 0, gl.RGBA, gl.FLOAT, arr);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function renderToCanvas(motionMode, frameIdx, totalFrames, envTex, onsetTex, imgTex,
                        intensity, motionSpeed, fps, ovStr) {
  const fbo = gl.createFramebuffer();
  const intermediate = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, intermediate);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, intermediate, 0);

  const motionProg = compileProgram(gl, VERTEX_SHADER, MOTION_SHADERS[motionMode], "m_" + motionMode);
  wireQuad(motionProg); gl.useProgram(motionProg);
  gl.viewport(0, 0, 512, 512);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, imgTex); gl.uniform1i(gl.getUniformLocation(motionProg, "u_image"), 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, envTex); gl.uniform1i(gl.getUniformLocation(motionProg, "u_envelope"), 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, onsetTex); gl.uniform1i(gl.getUniformLocation(motionProg, "u_onset"), 2);
  gl.uniform1i(gl.getUniformLocation(motionProg, "u_total_frames"), totalFrames);
  gl.uniform1i(gl.getUniformLocation(motionProg, "u_frame_index"), frameIdx);
  gl.uniform1i(gl.getUniformLocation(motionProg, "u_audio_band_idx"), 0);
  gl.uniform1f(gl.getUniformLocation(motionProg, "u_intensity"), intensity);
  gl.uniform1f(gl.getUniformLocation(motionProg, "u_motion_speed"), motionSpeed);
  gl.uniform1f(gl.getUniformLocation(motionProg, "u_t"), frameIdx / fps);
  gl.uniform1f(gl.getUniformLocation(motionProg, "u_aspect"), 1.0);
  gl.uniform2f(gl.getUniformLocation(motionProg, "u_resolution"), 512, 512);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Overlay pass to default FBO
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, 512, 512);
  gl.useProgram(overlayProg); wireQuad(overlayProg);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, intermediate); gl.uniform1i(gl.getUniformLocation(overlayProg, "u_intermediate"), 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, envTex); gl.uniform1i(gl.getUniformLocation(overlayProg, "u_envelope"), 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, onsetTex); gl.uniform1i(gl.getUniformLocation(overlayProg, "u_onset"), 2);
  gl.uniform1i(gl.getUniformLocation(overlayProg, "u_total_frames"), totalFrames);
  gl.uniform1i(gl.getUniformLocation(overlayProg, "u_frame_index"), frameIdx);
  gl.uniform1i(gl.getUniformLocation(overlayProg, "u_audio_band_idx"), 0);
  gl.uniform1f(gl.getUniformLocation(overlayProg, "u_intensity"), intensity);
  gl.uniform1f(gl.getUniformLocation(overlayProg, "u_motion_speed"), motionSpeed);
  gl.uniform1f(gl.getUniformLocation(overlayProg, "u_t"), frameIdx / fps);
  gl.uniform1f(gl.getUniformLocation(overlayProg, "u_aspect"), 1.0);
  gl.uniform2f(gl.getUniformLocation(overlayProg, "u_resolution"), 512, 512);
  gl.uniform1f(gl.getUniformLocation(overlayProg, "u_glitch_strength"), ovStr.glitch || 0);
  gl.uniform1f(gl.getUniformLocation(overlayProg, "u_bloom_strength"), ovStr.bloom || 0);
  gl.uniform1f(gl.getUniformLocation(overlayProg, "u_vignette_strength"), ovStr.vignette || 0);
  gl.uniform1f(gl.getUniformLocation(overlayProg, "u_hue_shift_strength"), ovStr.hue_shift || 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  return canvas.toDataURL("image/png");
}

// Naive per-pixel CIE76 ΔE (mean) — RGB→Lab approximation good enough for a rough check.
async function deltaE(urlA, urlB) {
  const [a, b] = await Promise.all([loadImage(urlA), loadImage(urlB)]);
  const w = Math.min(a.naturalWidth, b.naturalWidth, 256);
  const h = Math.min(a.naturalHeight, b.naturalHeight, 256);
  const ca = document.createElement("canvas"); ca.width = w; ca.height = h;
  const cb = document.createElement("canvas"); cb.width = w; cb.height = h;
  ca.getContext("2d").drawImage(a, 0, 0, w, h);
  cb.getContext("2d").drawImage(b, 0, 0, w, h);
  const da = ca.getContext("2d").getImageData(0, 0, w, h).data;
  const db = cb.getContext("2d").getImageData(0, 0, w, h).data;
  let sum = 0;
  function rgbToLab(r, g, blu) {
    // Simplified — just delta luminance + Cb/Cr differences. Enough for parity flagging.
    const Y = 0.299 * r + 0.587 * g + 0.114 * blu;
    return [Y, r - Y, blu - Y];
  }
  for (let i = 0; i < da.length; i += 4) {
    const [aL, aA, aB] = rgbToLab(da[i], da[i+1], da[i+2]);
    const [bL, bA, bB] = rgbToLab(db[i], db[i+1], db[i+2]);
    sum += Math.sqrt((aL-bL)**2 + (aA-bA)**2 + (aB-bB)**2);
  }
  return sum / (w * h);
}

document.getElementById("run").addEventListener("click", async () => {
  const goldensDir = document.getElementById("goldensDir").value.replace(/\/$/, "") + "/";
  const manifestUrl = goldensDir + "manifest.json";
  const m = await (await fetch(manifestUrl)).json();
  const testImg = await loadImage(`../../${m.test_image}`);
  const imgTex = makeImageTexture(testImg);

  const audioRaw = synthAudio(m.audio.duration_s, m.audio.sample_rate, m.audio.seed);
  const audioBuf = buildAudioBuffer(audioRaw);
  const { envelope, onset, totalFrames } = computeAll(audioBuf, m.audio.fps,
    m.shared_params.smoothing, m.shared_params.loop_safe);
  const envTex = makeAudioTex(envelope);
  const onsetTex = makeAudioTex(onset);

  const root = document.getElementById("results");
  root.textContent = "";

  for (const test of m.motion_tests) {
    for (const fr of test.frames) {
      const goldenPath = `${goldensDir}motion_${test.mode}_${String(fr).padStart(3, "0")}.png`;
      const webglDataURL = renderToCanvas(test.mode, fr, totalFrames, envTex, onsetTex, imgTex,
        m.shared_params.intensity, m.shared_params.motion_speed, m.shared_params.fps, {});
      const dE = await deltaE(goldenPath, webglDataURL);
      const ok = test.approximate ? "approximate" : (dE <= 5.0 ? "pass" : "fail");
      const div = document.createElement("div");
      div.className = "pair";
      div.innerHTML = `
        <img src="${goldenPath}" title="Python golden">
        <img src="${webglDataURL}" title="WebGL render">
        <div class="info">
          <div>${test.mode} frame ${fr}</div>
          <div class="${ok === "pass" ? "pass" : ok === "approximate" ? "approx" : "fail"}">
            ΔE ≈ ${dE.toFixed(2)} (${ok})
          </div>
        </div>`;
      root.appendChild(div);
    }
  }

  for (const test of m.overlay_tests) {
    for (const fr of test.frames) {
      const goldenPath = `${goldensDir}overlay_${test.name}_${String(fr).padStart(3, "0")}.png`;
      const ovStr = { [test.name]: test.strength };
      const webglDataURL = renderToCanvas("scale_pulse", fr, totalFrames, envTex, onsetTex, imgTex,
        m.shared_params.intensity, m.shared_params.motion_speed, m.shared_params.fps, ovStr);
      const dE = await deltaE(goldenPath, webglDataURL);
      const approxName = test.name === "bloom";
      const ok = approxName ? "approximate" : (dE <= 5.0 ? "pass" : "fail");
      const div = document.createElement("div");
      div.className = "pair";
      div.innerHTML = `
        <img src="${goldenPath}" title="Python golden">
        <img src="${webglDataURL}" title="WebGL render">
        <div class="info">
          <div>${test.name} (overlay) frame ${fr}</div>
          <div class="${ok === "pass" ? "pass" : ok === "approximate" ? "approx" : "fail"}">
            ΔE ≈ ${dE.toFixed(2)} (${ok})
          </div>
        </div>`;
      root.appendChild(div);
    }
  }
});
</script>
</body></html>
```

- [ ] **Step 2: Manual verification**

In any Chromium / Firefox / Safari browser, open the file:
```
file:///path/to/ComfyUI-Pixaroma/assets/audio_studio_parity/index.html
```

Click "Run Parity". Verify:
- Golden + WebGL pairs render side-by-side.
- Most non-shake / non-bloom tests pass ΔE ≤ 5.0.
- Shake tests show "approximate" badge.
- Bloom tests show "approximate" badge.

Note: file:// has restrictions on fetching local PNGs. If running into CORS issues, run:
```bash
cd ComfyUI-Pixaroma && python -m http.server 8080
# then open http://localhost:8080/assets/audio_studio_parity/index.html
```

- [ ] **Step 3: Commit**

```bash
git add assets/audio_studio_parity/index.html
git commit -m "audio_studio: bundled browser parity harness page

Standalone HTML — loads goldens + runs WebGL pipeline against same params,
displays side-by-side with ΔE per pair. Shake + bloom flagged as
approximate per math doc §9. Run manually in Chrome / Firefox / Safari
before each release."
```

Print: `DONE: I1 (browser parity harness landed)`

### Task I2: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Goal:** Three additions: (1) Frontend Directory Structure entry; (2) Token-Saving Rules row; (3) "do not regress" patterns section.

- [ ] **Step 1: Add to Frontend Directory Structure tree**

Find the section `### Frontend Directory Structure` in `CLAUDE.md`. After the `compare/` block (or wherever fits the alphabetical ordering), add:

```
├── audio_studio/       # AudioReact Pixaroma — fullscreen editor for Audio React effects
│   ├── index.js        # Entry: button on node, app.graphToPrompt hook (Pattern #9)
│   ├── core.mjs        # AudioStudioEditor class — open/close/save/discard, Vue-compat
│   ├── transport.mjs   # Mixin — transport bar UI, Web Audio playback, sparkline
│   ├── audio_analysis.mjs # Decode, inline FFT, 4-band envelope/onset, WAV writer
│   ├── render.mjs      # Mixin — WebGL2 pipeline (motion + overlay passes)
│   ├── shaders.mjs     # 8 motion shaders + combined-overlay shader
│   ├── ui.mjs          # Mixin — tabbed sidebar, controls, header pills
│   └── api.mjs         # Backend wrappers — uploadSource, getUpstreamImageUrl
```

- [ ] **Step 2: Add Token-Saving Rules table row**

Find the Token-Saving Rules table. Add:
```
| AudioReact Pixaroma — change effect math | `nodes/_audio_react_engine.py` (shared engine — math is here, not in nodes_audio_*.py) + sync update to `docs/audio-react-math.md` (single source of truth) + matching change to `js/audio_studio/shaders.mjs` (GLSL mirror) + browser parity harness (Task I1) re-run |
| AudioReact Pixaroma — editor UI / sidebar | `js/audio_studio/ui.mjs` (controls / tabs) + `js/audio_studio/core.mjs` (open/close/save flow) |
| AudioReact Pixaroma — transport / playback | `js/audio_studio/transport.mjs` |
| AudioReact Pixaroma — WebGL pipeline | `js/audio_studio/render.mjs` (orchestration) + `js/audio_studio/shaders.mjs` (per-mode shaders) |
| AudioReact Pixaroma — Python entry point | `nodes/node_audio_studio.py` (thin wrapper); engine math lives in `nodes/_audio_react_engine.py` |
| AudioReact Pixaroma — upload route | `server_routes.py` `/pixaroma/api/audio_studio/upload` |
| AudioReact Pixaroma — config schema | `nodes/node_audio_studio.py` `_migrate_cfg` + `js/audio_studio/index.js` `DEFAULT_CFG` (keep these in sync — Pattern #3 risk) |
```

- [ ] **Step 3: Add "AudioReact Patterns (do not regress)" section**

Add a new patterns section after the "Audio React Patterns (do not regress)" block:

```markdown
### AudioReact Patterns (do not regress)

These patterns were hard-won during AudioReact v1 development. Regressing
any of them reintroduces specific bugs.

1. **`DEFAULT_CFG` in `js/audio_studio/index.js` MUST stay in sync with
   `Params` defaults in `nodes/_audio_react_engine.py`.** ComfyUI doesn't
   pre-fill a hidden input's value; the JS extension is the source of
   truth for first-time-on-canvas defaults. If the two diverge, the editor
   opens with one set of defaults and the workflow runs with another. Same
   Pattern #3 risk Note Pixaroma documented.

2. **Engine math lives in `nodes/_audio_react_engine.py` ONLY** —
   `node_audio_react.py` and `node_audio_studio.py` are thin wrappers that
   build a `Params` and call `generate_video()`. If you ever feel the urge
   to "just inline this one helper" in either node file, don't — every
   formula must travel through the engine so both nodes stay in sync.

3. **Math doc (`docs/audio-react-math.md`) is the single source of truth
   for formulas.** When changing a formula:
   1. Update the doc first.
   2. Update the Python implementation.
   3. Update the matching GLSL shader.
   4. Run `scripts/audio_parity_check.py --regenerate` to refresh goldens.
   5. Run the browser parity harness manually to confirm the WebGL side
      still matches.
   Skipping any step risks editor preview drifting from MP4 output.

4. **Approximate-preview carve-outs are documented, not silent.** Math
   doc §9 lists `shake` and `bloom` explicitly. The browser harness
   exempts these from the ΔE check. If you add a new "the WebGL side
   can't bit-match this" effect, update §9 AND the harness — silently
   exempting tests has misled debugging in the past.

5. **Audio is WAV-only on disk.** The browser converts MP3 / OGG / AAC /
   etc. via `decodeAudio` + `encodeWav` BEFORE upload. Server only
   accepts `.wav` — keeps Python dependency-free (stdlib `wave` module).
   Don't add server-side ffmpeg / pydub / etc. to "support more formats."
   Adding a heavy dep ripple-effects through the project's
   "no extra deps" promise.

6. **WebGL2 required, no fallback.** If `getContext("webgl2")` returns
   null, the editor shows a clear error suggesting the basic Audio React
   node. Don't add WebGL1 fallback — none of the modern browsers we
   target lack WebGL2, and the fallback complexity buys nothing.

7. **Pattern #9 persistence** (CLAUDE.md Vue Frontend Compatibility
   point #9) — `studio_json` is declared `hidden` in INPUT_TYPES, state
   lives on `node.properties.audioStudioState`, `app.graphToPrompt` hook
   injects it at submission. Same as Resolution Pixaroma. If the input
   ever shows up as a slot dot, Pattern #9 has been broken — likely by
   `removeInput()` or by re-declaring as `required STRING`.

8. **`shake` motion shader uses a deterministic JS RNG (mulberry32 seeded
   by frame index) — NOT a port of `torch.Generator(0)`.** Browser
   preview is approximate for shake. This is documented behavior — if
   you "fix" the shader to use Python's exact sequence, you'll discover
   torch's RNG cannot be reproduced cross-platform and break parity in a
   different way.

9. **Audio analysis runs ONCE per audio load**, packing all 4 bands into
   one RGBA32F texture (R=full, G=bass, B=mids, A=treble). Toggling
   `audio_band` in the sidebar is a free uniform swap, not a recompute.
   Don't add a "recompute on band change" path — it slows the editor and
   adds latency to a click that should be instant.

10. **Save flow flushes inline source files BEFORE updating
    `studio_json`.** Order matters: if the JSON references
    `image_path: "audio_studio/<id>/image.png"` and the file isn't on
    disk yet, the next workflow run errors. The save flow uploads first,
    then commits — atomic failure means the JSON stays at its previous
    state.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md updates for AudioReact Pixaroma

Adds Frontend Directory Structure entry, Token-Saving Rules table rows,
and 'AudioReact Patterns (do not regress)' section with 10 patterns
that surfaced during v1 development."
```

Print: `DONE: I2 (CLAUDE.md updated)`

### Task I3: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add AudioReact feature blurb**

Find the Audio React Pixaroma section in `README.md`. Add a parallel section right after it:

```markdown
### AudioReact Pixaroma

Sibling node to **Audio React Pixaroma** with the same effect math but a
full live editor. Click **Open AudioReact** on the node to launch a
fullscreen overlay:

- **WebGL preview canvas** — renders effects in real time as you scrub
  the audio. Tweak motion mode / intensity / overlay strengths and watch
  the result update instantly.
- **Tabbed sidebar** — Motion / Overlays / Audio / Output groups all 16
  effect controls.
- **Transport bar** — play / pause / scrub / frame stepper, with the
  audio envelope shown as an inline sparkline so you can scrub straight
  to a beat.
- **Image + Audio sources** — connect an upstream IMAGE / AUDIO input,
  or load files from inside the editor (drag-drop or pick-file). Inline
  files are stored under `input/pixaroma/audio_studio/<node_id>/` so
  they survive workflow reloads.
- **Same engine as Audio React** — the workflow renders identical frames
  in Python, ready for **Save Mp4 Pixaroma**. Use Audio React for fast
  scripted runs; use AudioReact when you want to dial in the look
  interactively.

Requires WebGL2 (universal in modern browsers since 2017).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README — AudioReact Pixaroma feature section"
```

Print: `DONE: I3 (README updated)`

### Task I4: Final integration smoke test

**Goal:** End-to-end verification that v1 ships.

- [ ] **Step 1: Run Python parity check**

```bash
python scripts/audio_parity_check.py
```
Expected: 64 OK lines, all `rmse=0.000`.

- [ ] **Step 2: Run browser parity harness**

Open `assets/audio_studio_parity/index.html` in a browser (file:// or via local server). Click Run Parity. Verify all non-approximate tests pass.

- [ ] **Step 3: Full workflow smoke test**

1. ComfyUI: drop Load Image + Load Audio + AudioReact Pixaroma + Save Mp4 Pixaroma. Wire them.
2. Open AudioReact. Tweak motion mode, intensity, an overlay or two.
3. Click Save.
4. Run workflow.
5. ✅ MP4 produced. Frames look like the editor preview.
6. Edit the workflow JSON manually to remove the `audioStudioState` property entirely.
7. Reload workflow → reopen editor → verify defaults restored cleanly.

- [ ] **Step 4: Acceptance criteria walkthrough**

Open `docs/superpowers/specs/2026-04-27-audio-studio-pixaroma-design.md` §12. Confirm each bullet:

- [ ] Editor opens / restores state / defaults match
- [ ] All 8 motion modes + 4 overlays render at ≥30 fps
- [ ] Scrubbing responsive (within 1 frame), spacebar/arrows work, audio plays in sync
- [ ] Source switching (upstream ↔ inline) works without restart
- [ ] Save / reopen restores state; discard prompt appears when dirty
- [ ] Workflow execution matches Audio React for identical config (parity check)
- [ ] Vue compat (Ctrl+Z trapped, onRemoved safety net)
- [ ] Browser parity harness ≤ ΔE 5.0 mean for non-approximate tests
- [ ] README + CLAUDE.md updated

If everything passes, we ship.

- [ ] **Step 5: Final commit (if any tweaks)**

If acceptance criteria walkthrough surfaced bugs, fix and commit:
```bash
git add <files>
git commit -m "audio_studio: final acceptance-criteria fixes — <specifics>"
```

Print: `DONE: I4 (v1 acceptance criteria pass — AudioReact Pixaroma is ready to ship)`

---

## Self-review

After completing all milestones, run through this checklist before declaring v1 done:

1. **Spec coverage** — every section in `docs/superpowers/specs/2026-04-27-audio-studio-pixaroma-design.md` has at least one task implementing it. Specifically:
   - §1-3 (concept / motivation / I/O): B1 + design-locked file structure.
   - §4 (file layout): all milestones contribute files per the table.
   - §5 (Python engine): A2-A6.
   - §6 (JS WebGL + audio): D2-D4, E1-E10, F1-F2, G1-G4.
   - §7 (Editor UI — Layout B): D2 + D4 + G1.
   - §8 (Data flow + persistence): D1 (Pattern #9) + H1-H4.
   - §9 (Server route): B2.
   - §10 (Parity strategy): A1 + C1 + I1.
   - §11 (Out of scope): respected — no `overlay_preset`, no WebGL1 fallback, no waveform strip beyond inline sparkline, no headless WebGL CI.
   - §12 (Acceptance criteria): I4 walkthrough.
   - §13 (Risks): mitigations baked into tasks (e.g. Web Audio drift acknowledged via per-play AudioBufferSourceNode restart in G2).
   - §14 (File touch list): matches plan's File Structure table.

2. **Placeholder scan** — no "TBD" / "TODO" / "implement later" / "fill in details" left in the plan. Reference patterns ("see CLAUDE.md Pattern #N") are explicit, not vague.

3. **Type consistency** — names used across tasks:
   - Engine: `MOTION_MODES`, `OVERLAYS`, `Params`, `MotionContext`, `OverlayContext`, `generate_video`, `audio_envelope`, `onset_track`, `bandpass_fft`, `process_aspect`, `reset_motion_caches`, `validate_params`, `params_from_dict`.
   - Editor class: `AudioStudioEditor`, `_initRenderer`, `_render`, `_setImage`, `_setAudioTextures`, `_buildSidebar`, `_buildTransport`, `_buildHeader`, `_resolveImageSource`, `_resolveAudioSource`, `_pickInlineImage`, `_pickInlineAudio`, `_handleAudioFile`, `_loadImageFromUrl`, `loadAudioBlob`, `_recomputeAudio`, `_render`, `_save`, `close`, `forceClose`, `_undo`, `_redo`, `_snapForUndo`, `_togglePlay`, `_startPlayback`, `_pausePlayback`, `_restartPlayback`, `_stepFrame`, `_refreshTransport`, `_drawSparkline`, `_currentFrameIndex`, `_audioBandIndex`.
   - JSON schema keys: match `Params` field names + `image_source`, `image_path`, `audio_source`, `audio_path`, `schema_version`.
   - Persistence: `node.properties.audioStudioState` everywhere.
   - Server route: `/pixaroma/api/audio_studio/upload`.

4. **Scope check** — single feature (AudioReact + engine refactor + parity infra). Multi-session execution is built into the milestone structure.

5. **Cross-file consistency** — `DEFAULT_CFG` in `js/audio_studio/index.js` must mirror `Params` defaults in `_audio_react_engine.py`. Called out as Pattern #1 in the new "AudioReact Patterns" CLAUDE.md section.

If the implementer encounters a discrepancy or undefined name, that's a plan bug — note it, fix it inline, continue.

---

## Execution handoff

**Plan complete.** Spec at `docs/superpowers/specs/2026-04-27-audio-studio-pixaroma-design.md`. Plan at `docs/superpowers/plans/2026-04-27-audio-studio-pixaroma.md`.

**Per the user's stated intent ("Stop there. I'll execute over multiple subsequent sessions"), this session ends here.** No execution this session.

When ready to start implementation in a future session, the user can pick:

- **Subagent-Driven (recommended for this scale).** Use `superpowers:subagent-driven-development`. Each task → fresh subagent (model: `sonnet` for code-heavy tasks, `opus` for review). Plan checkboxes track progress.
- **Inline Execution.** Use `superpowers:executing-plans`. Batch milestone-by-milestone; pause for review between milestones.

Either way, the natural session breaks are at milestone boundaries (A → B → C → D → E → F → G → H → I). Milestone A (engine extraction) is the highest-priority foundation — it makes the existing Audio React workflow byte-identical regression-tested, and it's a complete, shippable improvement on its own even if AudioReact is paused after.




