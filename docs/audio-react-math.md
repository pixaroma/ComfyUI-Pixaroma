# Audio React / Audio Pulse — Math Reference

Single source of truth for every formula in the Pixaroma audio-reactive
nodes (Audio React, Audio Pulse). Both the Python engine
(`nodes/_audio_react_engine.py`) and the WebGL preview shaders
(`js/audio_studio/shaders.mjs` — landed in Milestone E) implement the
formulas defined here.

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
   envelope helper. See §4.)

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
| `slit_scan` omega | max(motion_speed*2, 0.4) | slit_scan | floor matches ripple's rationale |
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
- **`bloom`** — Python uses downsample → 2-pass separable Gaussian blur →
  upsample → screen blend (3 framebuffer passes). Browser approximates with
  a single in-shader 9-tap radial blur — visually similar but the falloff
  shape and strength are not bit-exact. Final MP4 (Python) is authoritative.

All other modes are exact-bit-pattern bound (within shader-precision
rounding — `highp` floats throughout).

## 10. Parity check

Two layers of test:

1. **Python parity** (`scripts/audio_parity_check.py`) — renders 64 reference
   frames from the engine, diffs against committed PNGs. Tolerance: pixel
   RMSE ≤ 1.0 (covers PyTorch float-precision drift across releases). Run
   before each release.
2. **Browser parity harness** (`assets/audio_studio_parity/index.html`,
   landing in Milestone I) — loads the same goldens, runs the WebGL
   pipeline against the same source, computes per-pair ΔE in JS. Mean
   ΔE ≤ 5.0 for non-shake / non-bloom tests. Run manually in Chrome /
   Firefox / Safari before release.
