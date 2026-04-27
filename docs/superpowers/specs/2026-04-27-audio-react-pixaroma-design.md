# Audio React Pixaroma — Design Spec

**Date:** 2026-04-27
**Author:** brainstorming session
**Status:** approved, ready for implementation plan

## 1. Concept

A new ComfyUI node that turns a single still image plus an audio track into an
audio-reactive video clip — without needing a depth model. Sits next to
`audio_depth` (which is the depth-based parallax variant) and fills the
"audio-reactive image animation" slot for users who don't have a depth map and
just want fast, opinionated, plug-and-play motion.

Single node, opinionated defaults, sensible widget count (~15 — comparable to
`audio_depth`).

## 2. Why this, why now

The ComfyUI audio-reactive ecosystem (Yvann-Nodes, RyanOnTheInside, KJNodes
SoundReactive) is dominated by Lego-kit packs: the user wires audio analysis
through several intermediary nodes to drive parameters on a transform node.
That's powerful but high-friction. `audio_depth` proved there's appetite for
opinionated single-node solutions that "just work". This node extends that
pattern to the non-depth use case (and avoids the Depth Anything V2 download
and inference cost).

## 3. Inputs / Outputs

### Inputs

| Name    | Type    | Description                                    |
|---------|---------|------------------------------------------------|
| `image` | IMAGE   | Source still to animate                        |
| `audio` | AUDIO   | Driver track (clip length = audio length × fps) |

### Outputs

| Name           | Type   | Description                              |
|----------------|--------|------------------------------------------|
| `video_frames` | IMAGE  | Frame batch, ready for `save_mp4`        |
| `audio`        | AUDIO  | Passthrough (aligned to frame count)     |
| `fps`          | FLOAT  | Passthrough (matches input)              |

## 4. Widgets (15 total)

### Sizing — exact mirror of `audio_depth`

| Widget          | Type     | Default                          |
|-----------------|----------|----------------------------------|
| `aspect_ratio`  | dropdown | `Original`                       |
| `custom_width`  | INT      | 1024 (range 64–4096, step 8)     |
| `custom_height` | INT      | 1024 (range 64–4096, step 8)     |

The `aspect_ratio` dropdown carries the same 21 options as `audio_depth`:
`Original`, `Custom (Use Width & Height below)`, `Custom Ratio 16:9 (Uses Width)`,
`Custom Ratio 9:16 (Uses Width)`, `Custom Ratio 4:3 (Uses Width)`,
`Custom Ratio 1:1 (Uses Width)`, `512x512 (Square)`, `768x512 (Landscape)`,
`512x768 (Portrait)`, `832x480 (Landscape)`, `480x832 (Portrait)`,
`1024x576 (Landscape 16:9)`, `576x1024 (Portrait 9:16)`,
`1280x720 (Landscape HD)`, `720x1280 (Portrait HD)`,
`1920x1080 (Landscape FHD)`, `1080x1920 (Portrait FHD)`,
`2560x1440 (Landscape 2K)`, `1440x2560 (Portrait 2K)`,
`3840x2160 (Landscape 4K)`, `2160x3840 (Portrait 4K)`.

### Primary motion — pick ONE per render

| Widget        | Type     | Options                                                                 | Default       |
|---------------|----------|-------------------------------------------------------------------------|---------------|
| `motion_mode` | dropdown | `scale_pulse`, `zoom_punch`, `shake`, `ripple`, `slit_scan`, `kaleidoscope` | `scale_pulse` |

**Mode descriptions** (also surfaced as tooltips):
- `scale_pulse` — uniform breathing zoom on audio amplitude. Universal default,
  looks good on any image.
- `zoom_punch` — fast zoom-in spike on each transient, slow ease back.
  Drum-hit / drop aesthetic.
- `shake` — translation jitter on transients, no rotation. Aggressive,
  hip-hop / rock.
- `ripple` — concentric ripples expand from center on each beat. Electronic /
  ambient.
- `slit_scan` — rows time-displaced by audio envelope. Distinctive, modern,
  experimental.
- `kaleidoscope` — radial mirror; segment rotation reactive to audio. Club /
  abstract.

### Stackable overlays (slider 0 = effect skipped entirely, no perf cost)

| Widget                | Type  | Range  | Default |
|-----------------------|-------|--------|---------|
| `glitch_strength`     | FLOAT | 0–1    | 0       |
| `bloom_strength`      | FLOAT | 0–1    | 0       |
| `vignette_strength`   | FLOAT | 0–1    | 0       |
| `hue_shift_strength`  | FLOAT | 0–1    | 0       |

Overlay descriptions:
- `glitch_strength` — RGB-channel offset spikes on transients + occasional
  scanline tear.
- `bloom_strength` — gaussian glow that pulses with bass (highlights bloom
  outward on bass hits).
- `vignette_strength` — edges darken in pulses with audio.
- `hue_shift_strength` — color rotation cycles with audio amplitude.

### Shared params

| Widget          | Type    | Range       | Default | Notes                                              |
|-----------------|---------|-------------|---------|----------------------------------------------------|
| `intensity`     | FLOAT   | 0.0–2.0     | 0.8     | Master strength (parallel to `pulse_intensity`)    |
| `audio_band`    | dropdown| `full`/`bass`/`mids`/`treble` | `full` | Which band drives the envelope |
| `motion_speed`  | FLOAT   | 0.05–1.0    | 0.2     | Base oscillation frequency for modes that use it   |
| `smoothing`     | INT     | 1–15        | 5       | Moving-average window for audio envelope (frames)  |
| `loop_safe`     | BOOL    | —           | True    | Ramp first/last 0.5s to zero for seamless loop     |
| `fps`           | INT     | 8–60        | 24      | Output frames per second                           |
| `edge_headroom` | FLOAT   | 1.0–1.3     | 1.05    | Render slightly larger then center-crop            |

## 5. Architecture

Single Python node file, no JS, no extra dependencies.

```
nodes/node_audio_react.py            (~600 lines)
    _AUDIO_BANDS_HZ                  duplicated locally (matches audio_depth values; no cross-file import)
    _bandpass_fft(...)               FFT bandpass helper (re-implemented locally, same logic as audio_depth)
    _process_aspect(...)             same shape as audio_depth's helper
    _onset_envelope(...)             numpy onset-derivative (no librosa)
    _audio_envelope(...)             bandpass → abs → moving-avg → loop ramp

    PixaromaAudioReact
        INPUT_TYPES                  defines all 15 widgets
        generate(image, audio, ...)  main entry
            1. resolve render dims via _process_aspect
            2. compute envelope_t, onset_t (per-frame floats)
            3. for t in range(num_frames):
                 a. frame = base_image
                 b. apply motion_mode(frame, t, env_t, onset_t, params)
                 c. for each overlay with strength > 0:
                      frame = overlay(frame, t, env_t, onset_t, strength, params)
                 d. center-crop edge_headroom back to base size
                 e. frames.append(frame)
            4. return (torch.stack(frames), audio, float(fps))

    # Per-mode implementations (~30–60 lines each)
    _motion_scale_pulse(frame, env_t, intensity)         affine sample
    _motion_zoom_punch(frame, onset_t, intensity)        decaying scale spike
    _motion_shake(frame, onset_t, intensity)             translation field
    _motion_ripple(frame, t, env_t, intensity)           radial sine warp
    _motion_slit_scan(frame_buffer, env_t, t)            per-row time pull
    _motion_kaleidoscope(frame, env_t, intensity)        polar warp + mirror

    # Overlay implementations (~20–40 lines each)
    _overlay_glitch(frame, onset_t, strength)            RGB shift + tear
    _overlay_bloom(frame, env_t, strength)               gaussian add-blend
    _overlay_vignette(frame, env_t, strength)            radial mask multiply
    _overlay_hue_shift(frame, env_t, strength)           HSV rotate

NODE_CLASS_MAPPINGS = { "PixaromaAudioReact": PixaromaAudioReact }
NODE_DISPLAY_NAME_MAPPINGS = { "PixaromaAudioReact": "Audio React Pixaroma" }
```

`__init__.py` merges those mappings (existing pattern). No JS file needed.

### Audio envelope pipeline

1. Read AUDIO dict → `waveform` tensor `[batch, channels, samples]`, mono-mix
   if needed.
2. Apply `_bandpass_fft` according to `audio_band`.
3. Take per-sample magnitude → resample to `num_frames` (one value per frame).
4. Apply moving-average with `smoothing` window.
5. If `loop_safe`: multiply by a 0.5s ramp at start and end (cosine).
6. Normalize to `[0, 1]` (peak-normalize per clip).
7. Yields `env_t` — used by every mode and overlay.

### Onset/transient track

Separate from envelope — used by `zoom_punch`, `shake`, `glitch_strength`.
Computed as: positive-rectified derivative of envelope, threshold at top
quartile, then exponential decay between hits. Yields `onset_t` —
spike-shaped per-frame floats.

### Per-mode behavior summary

| Mode          | Reads        | Output transform               | Notes |
|---------------|--------------|--------------------------------|-------|
| scale_pulse   | env_t        | uniform scale = 1 + env_t·intensity·0.15 | smoothest |
| zoom_punch    | onset_t      | uniform scale = 1 + onset_t·intensity·0.3 | spiky |
| shake         | onset_t      | translate(dx, dy) where vector is random walk seeded by onsets | seeded by frame index |
| ripple        | env_t, t     | radial sine: dr = A·sin(k·r − ω·t), A = env_t·intensity·0.015·min(W, H) (px). Resolution-relative so amplitude looks the same at 720p and 4K. |  |
| slit_scan     | env_t (vec)  | output row y pulls from input frame at time = t − f(env_t[y]) | needs frame buffer |
| kaleidoscope  | env_t        | polar warp + 6-segment mirror; segment rotation = env_t·intensity·π/3 |  |

### Per-overlay behavior summary

| Overlay      | Reads         | Operation |
|--------------|---------------|-----------|
| glitch       | onset_t       | R/G/B channels shifted independently by onset_t·strength·0.012·min(W, H) (px, resolution-relative); ~5% rows swapped on onset_t > 0.7 |
| bloom        | env_t         | downsample → blur → add-blend with weight = env_t·strength·0.6 |
| vignette     | env_t         | radial mask `1 − env_t·strength·0.5·(1 − r)` |
| hue_shift    | env_t         | HSV rotate by env_t·strength·30° |

## 6. Defaults / "just works"

Drop the node in, wire image + audio, hit run:
- `motion_mode` = `scale_pulse` — universal motion that flatters any subject
- `intensity` = 0.8 — same default as `audio_depth`'s `pulse_intensity`
- `audio_band` = `full`
- All overlays = 0 — user opts in when they want aggressive looks
- `smoothing` = 5 — balanced
- `motion_speed` = 0.2
- `loop_safe` = True
- `edge_headroom` = 1.05

## 7. Performance budget

- Render time per frame should be similar to `audio_depth` (~30–80 ms on a
  typical GPU at 1024×576), since the heaviest modes (`ripple`,
  `kaleidoscope`, `slit_scan`) are torch grid-sample operations of comparable
  cost to depth-driven parallax.
- No Depth Anything V2 inference → no model load, no model download. This
  node should feel snappier on first run than `audio_depth`.
- All overlays use vectorized torch ops; total overhead at full strength
  (all four overlays at 1.0) should be ≤ 30% over baseline.
- VRAM: same envelope as `audio_depth` (frames × resolution × 4 bytes per
  channel). 4K renders need careful memory handling.

## 8. Out of scope (v1)

- Multi-image input — covered by a future "Audio Beat Mix Pixaroma" node if
  there's demand. v1 stays single-image to keep the design crisp.
- Custom beat-detection ML model — numpy envelope-derivative is fast and
  sounds good enough on most music; user can adjust `smoothing` to tune
  responsiveness.
- Real-time preview in the node UI — renders run on workflow execute, same
  as `audio_depth`.
- Configurable per-band motion (e.g., bass drives scale, treble drives
  glitch). Could be added later as v2 if requested; v1 keeps a single
  `audio_band` for simplicity.
- Custom segment count for kaleidoscope — fixed at 6 segments in v1.

## 9. File touch list (implementation scope)

| File | Change |
|------|--------|
| `nodes/node_audio_react.py` | NEW — full node implementation |
| `__init__.py` | merge `PixaromaAudioReact` into `NODE_CLASS_MAPPINGS` and `NODE_DISPLAY_NAME_MAPPINGS` |
| `CLAUDE.md` | add `Audio React Pixaroma` to the Token-Saving Rules table; brief mention in Architecture / Entry Points |
| `README.md` | add a short feature blurb (parallel to the existing `Audio Depth Pixaroma` section) |

No frontend JS, no `server_routes.py` changes, no asset files, no JS folder.

## 10. Risks / open questions

- **Onset detection quality** — numpy envelope-derivative isn't as accurate as
  librosa onset detection; might miss subtle hi-hat hits on quiet tracks. If
  users complain in v1, switch to librosa onset (already a transitive dep of
  some ComfyUI builds — check before adding).
- **Slit-scan needs a frame buffer** — pulls rows from past frames, so memory
  is `num_frames × H × W × 3`. For a 30s clip at 30fps and 1024×576 that's
  ~5GB. Plan: clamp slit-scan max look-back to the last 0.5s only, drop
  earlier frames from the buffer as we render forward.
- **Kaleidoscope at non-square aspect** — radial warp on a 16:9 frame can
  produce visible seams at the boundary. Plan: render kaleidoscope mode at a
  square inscribed in the output, then center-crop / letterbox. Document
  this in the tooltip.
- **Loop-safe ramp interaction with overlays** — overlays use the same
  envelope, so they also fade at start/end when `loop_safe=True`. That's
  expected behavior, but worth confirming in implementation review.

## 11. Acceptance criteria

A v1 release is shippable when:
1. All 6 motion modes render without crashing on a 1024×576, 10s, 24fps clip.
2. All 4 overlays compose cleanly on top of every motion mode (24 combos
   smoke-tested).
3. `loop_safe=True` produces a clip whose first and last frames are visually
   indistinguishable from each other (within compression noise) for a clip
   ≥ 5s.
4. Default render (drop the node, wire image + audio, click run) produces a
   visibly audio-reactive clip that doesn't look broken or static — i.e.,
   the out-of-the-box result is good without any widget tweaks.
5. Render time per frame at 1024×576 is within 1.5× `audio_depth`'s
   per-frame cost on the same hardware.
6. Tooltips on every widget match audio_depth's verbosity standard
   (multi-sentence with concrete examples).
