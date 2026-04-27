# AudioReact Pixaroma — Design Spec

**Date:** 2026-04-27
**Author:** brainstorming session
**Status:** approved, ready for implementation plan
**Estimated scope:** ~2500-3500 new lines, multi-session implementation

## 1. Concept

AudioReact Pixaroma is a sibling node to the existing **Audio React Pixaroma**.
Same effect math, very different UX:

- **Audio React Pixaroma** — widgets-only, fast tweak-and-run scripted use (existing,
  unchanged).
- **AudioReact Pixaroma (NEW)** — full live editor in a fullscreen browser overlay.
  Click "Open AudioReact" on the node → WebGL preview canvas + transport bar +
  tabbed sidebar → scrub the audio and watch effects respond in real time → click
  Save → workflow execution renders identical frames in Python.

The two nodes share a single effect engine (`nodes/_audio_react_engine.py`) so
bug fixes and new effects propagate to both. Audio React keeps its current
widget surface; AudioReact exposes the same effect set in a richer interactive
shell, with the registry architecture ready for additional effects in v1.1+.

## 2. Why this, why now

The basic Audio React node ships well, but the iteration loop is "tweak slider →
run workflow → wait 30 s → look → tweak again." For a tool whose value is
audio-driven motion *quality*, that loop is slow. Live preview collapses it to
seconds.

Studio also opens the door for richer features (more motion modes, more overlays,
per-band routing) without bloating the basic node — Audio React stays narrow,
Studio explores.

Why a full overlay instead of an in-node preview: the in-node real estate is too
small for tabbed controls + transport + meaningful canvas. Image Composer and
3D Builder set the precedent — fullscreen overlays ship clean UX without
fighting LiteGraph's node geometry.

## 3. Inputs / Outputs

Same I/O shape as Audio React, intentionally:

### Inputs
| Name    | Type    | Slot       | Description |
|---------|---------|------------|-------------|
| `image` | IMAGE   | optional   | Upstream image. If wired, used as source. If unwired, the editor falls back to an inline-loaded image stored at `input/pixaroma/audio_studio/<node_id>/image.png`. |
| `audio` | AUDIO   | optional   | Same dual-source pattern as image. |
| `studio_json` | STRING | hidden injection | Saved editor state. Not exposed as a slot or visible widget — see §8 "Persistence pattern". |

The two real inputs are declared `optional` in `INPUT_TYPES` so a workflow with
no upstream wiring still validates — the node uses inline-loaded sources at
exec time. `studio_json` is delivered to Python via the `app.graphToPrompt`
injection hook (CLAUDE.md Pattern #9) so it has no visible input dot.

### Outputs
| Name           | Type   | Description |
|----------------|--------|-------------|
| `video_frames` | IMAGE  | Frame batch (identical shape to Audio React) |
| `audio`        | AUDIO  | Passthrough (sourced from upstream OR inline at exec time) |
| `fps`          | FLOAT  | Passthrough |

Routing into Save Mp4 Pixaroma is identical to the basic Audio React flow.

## 4. File layout

### New files

| File | Purpose |
|------|---------|
| `nodes/_audio_react_engine.py` | Shared effect engine: registries, helpers, `Params` dataclass, `generate_video()`. |
| `nodes/node_audio_studio.py` | Thin Python node — parses `studio_json`, resolves sources, calls engine. |
| `js/audio_studio/index.js` | Extension entry point — `app.registerExtension`, button on node, opens editor. |
| `js/audio_studio/core.mjs` | `AudioStudioEditor` class shell — open/close/save/discard, undo stack, Vue-compat neutering. |
| `js/audio_studio/transport.mjs` | Mixin — transport bar UI (play/pause, scrub, time, frame stepper, sparkline). |
| `js/audio_studio/audio_analysis.mjs` | Web Audio API decode + envelope + onset (matches Python math). |
| `js/audio_studio/render.mjs` | Mixin — WebGL pipeline orchestration (motion pass + overlay pass). |
| `js/audio_studio/shaders.mjs` | GLSL fragment shader strings (8 motion + 1 combined-overlay) + compile cache. |
| `js/audio_studio/ui.mjs` | Mixin — sidebar tab construction, control widgets, header pills, modals. |
| `js/audio_studio/api.mjs` | Backend calls (upload sources, fetch upstream paths). |
| `scripts/audio_parity_check.py` | Python golden test runner. |
| `docs/audio-react-math.md` | Single-source-of-truth formal math doc for every motion mode + overlay. |
| `tests/audio_parity_goldens/` | Committed reference PNGs + `manifest.json`. |
| `assets/audio_studio_parity/index.html` | Bundled browser-side parity harness (manual, not CI). |
| `assets/audio_studio_parity/test_image.png` | Fixed reference image for parity tests. |

### Modified files

| File | Change |
|------|--------|
| `nodes/node_audio_react.py` | Refactor: import `_audio_react_engine`, drop inlined math. ~600 → ~100 lines. **No algorithmic changes** — extraction is mechanical. |
| `__init__.py` | Register `PixaromaAudioStudio` in `NODE_CLASS_MAPPINGS` / `NODE_DISPLAY_NAME_MAPPINGS`; add `js/audio_studio/index.js` to the extension load list (auto-loaded by ComfyUI from `WEB_DIRECTORY`). |
| `server_routes.py` | Adds `/pixaroma/api/audio_studio/upload` route. |
| `CLAUDE.md` | Adds AudioReact entries to: Architecture / Frontend Directory Structure, Vue Frontend Compatibility (any new patterns discovered), Token-Saving Rules table, "do not regress" patterns section. |
| `README.md` | Adds AudioReact Pixaroma feature blurb. |

## 5. Architecture — Python engine

### `_audio_react_engine.py` exports

```python
# Registries (extensible — drop a function + register it)
MOTION_MODES: dict[str, callable]   # 8 entries in v1
OVERLAYS: dict[str, callable]       # 4 entries in v1

# Helpers (ported as-is from current node_audio_react.py)
audio_envelope(audio_dict, total_frames, fps, audio_band, smoothing) -> torch.Tensor
onset_track(envelope, decay=0.85) -> torch.Tensor
bandpass_fft(waveform, sample_rate, low_hz, high_hz) -> torch.Tensor
process_aspect(image, aspect_ratio, custom_w, custom_h, headroom=1.0) -> (image, base_w, base_h)

# Constants
AUDIO_BANDS_HZ: dict[str, tuple[float | None, float | None]]
ASPECT_OPTIONS: list[str]   # 21 entries
MOTION_MODE_NAMES: list[str]   # = list(MOTION_MODES.keys())

# Typed params
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

def validate_params(params: Params) -> list[str]: ...
def generate_video(image: torch.Tensor, audio: dict, params: Params) -> torch.Tensor:
    """Full per-frame loop. Returns [F, H, W, 3] tensor in [0, 1]."""
```

### Both nodes are thin wrappers

`PixaromaAudioReact` (refactored):
```python
class PixaromaAudioReact:
    @classmethod
    def INPUT_TYPES(s):
        # Existing widget layout + tooltips, unchanged.
        ...
    RETURN_TYPES = ("IMAGE", "AUDIO", "FLOAT")
    RETURN_NAMES = ("video_frames", "audio", "fps")
    FUNCTION = "generate"
    CATEGORY = "👑 Pixaroma"

    def generate(self, image, audio, **widget_kwargs):
        from ._audio_react_engine import Params, generate_video, validate_params
        params = Params(**widget_kwargs)   # widget kwargs match Params field names
        for diag in validate_params(params):
            print(f"[Pixaroma] Audio React — {diag}")
        frames = generate_video(image, audio, params)
        return (frames, audio, float(params.fps))
```

`PixaromaAudioStudio`:
```python
class PixaromaAudioStudio:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "optional": {
                "image": ("IMAGE",),
                "audio": ("AUDIO",),
            },
            "hidden": {
                "studio_json": ("STRING", {"default": "{}"}),
            },
        }
    # same RETURN_TYPES / RETURN_NAMES / FUNCTION / CATEGORY

    def generate(self, studio_json="{}", image=None, audio=None):
        from ._audio_react_engine import Params, generate_video, validate_params
        cfg = json.loads(studio_json or "{}")
        # schema_version migration here when needed
        params = build_params_from_cfg(cfg)
        # Source resolution
        if cfg.get("image_source") == "inline":
            image = _load_inline_image(cfg["image_path"])
        if cfg.get("audio_source") == "inline":
            audio = _load_inline_audio(cfg["audio_path"])
        if image is None: raise ValueError("[Pixaroma] AudioReact — no image (no upstream wired and no inline image saved). Open the editor to load one.")
        if audio is None: raise ValueError("[Pixaroma] AudioReact — no audio (no upstream wired and no inline audio saved). Open the editor to load one.")
        for diag in validate_params(params):
            print(f"[Pixaroma] AudioReact — {diag}")
        frames = generate_video(image, audio, params)
        return (frames, audio, float(params.fps))
```

The Audio React refactor is **mechanical**: every `_motion_*` and `_overlay_*`
method becomes a registered function in the engine module; `_audio_envelope` /
`_onset_track` / `_bandpass_fft` / `_process_aspect` move verbatim. The current
`generate()` per-frame loop becomes `generate_video()` in the engine. **No
algorithmic changes**, no rendering output differences for existing workflows
saved against Audio React.

### Validation behavior

`validate_params` produces non-fatal diagnostic strings the caller logs. Hard
errors (no audio, audio too short to produce frames, image is `None`) raise
`ValueError` directly inside `generate_video()` with actionable messages.

## 6. Architecture — JS WebGL pipeline + audio analysis

### Per-frame pipeline (2 passes)

```
                                 ┌──────────────────┐
[ source image texture ]         │  motion shader   │     ┌─ R32F envelope tex
        │                        │  (per mode)      │ ◀───┤
        ▼                        │                  │     └─ R32F onset tex
   uniform image_tex   ────▶     │  uniforms:       │
                                 │   frame_index    │
                                 │   intensity      │
                                 │   motion_speed   │
                                 │   audio_band_idx │ (for selecting which env
                                 │                  │  channel — single tex,
                                 │                  │  4 channels = 4 bands)
                                 └────────┬─────────┘
                                          │
                                          ▼
                              ┌─ intermediate framebuffer ─┐
                              │                             │
                                          ▼
                                 ┌──────────────────┐
                                 │  combined-overlay│
                                 │  shader          │
                                 │  (4 overlays     │
                                 │   inline, each   │
                                 │   gated by       │
                                 │   strength > 0)  │
                                 └────────┬─────────┘
                                          ▼
                                       screen
```

Audio analysis precomputes envelope **for all 4 audio bands** (full / bass /
mids / treble) once on audio load — uploaded as a single 1D `RGBA32F` texture
where R = full, G = bass, B = mids, A = treble. Onset uses the same multi-band
strategy. The shader picks the active channel by an `audio_band_idx` uniform
(0..3). Trade-off: 4× audio compute on load (~50 ms total for a 30s clip),
**zero** lag when the user toggles `audio_band` in the sidebar. Worth it for
an interactive tool.

Scrubbing is instant: "set `current_frame = i`, sample
`envelope_tex[i].<channel>` in shader."

### `shaders.mjs` exports

```js
export const VERTEX_SHADER = "...";   // shared full-screen quad

export const MOTION_SHADERS = {
  scale_pulse:  "...",
  zoom_punch:   "...",
  shake:        "...",
  drift:        "...",
  rotate_pulse: "...",
  ripple:       "...",
  swirl:        "...",
  slit_scan:    "...",
};

export const OVERLAY_SHADER = "...";  // 4 overlays inline, gated by strength uniforms

export function compileAndCache(gl, src) -> WebGLProgram;
```

Each motion shader implements the same formula as the corresponding Python
function in `MOTION_MODES`. The math doc is the bridge.

### `audio_analysis.mjs`

```js
export async function decodeAudio(arrayBuffer) -> AudioBuffer;
// Web Audio API; supports MP3/WAV/OGG/AAC; FLAC partial in Chrome.

export function computeEnvelopes(audioBuffer, fps, smoothing, loop_safe) -> {
  full: Float32Array, bass: Float32Array, mids: Float32Array, treble: Float32Array
};
// Replicates Python _audio_envelope four times (one per band):
//   1. mono-mix
//   2. FFT bandpass per band ("full" = no bandpass)
//   3. per-frame RMS (samples_per_frame = sample_rate / fps)
//   4. moving-average smoothing
//   5. peak-normalize to [0, 1]
//   6. loop-safe ramp at start/end (if loop_safe)
// Returns four arrays packed into RGBA32F texture by caller.

export function computeOnsets(envelopes) -> {
  full: Float32Array, bass: Float32Array, mids: Float32Array, treble: Float32Array
};
// Replicates Python _onset_track:
//   diff[t] = max(0, env[t] - env[t-1])
//   thresh = max(0.05, quantile(diff, 0.75))
//   spikes[t] = (diff[t] > thresh) ? diff[t] : 0
//   onset[t] = max(spikes[t], onset[t-1] * 0.85)
//   peak-normalize
```

A small **inlined real FFT** (≤200 LOC, no dep) handles the bandpass; written
to match Python's `torch.fft.rfft` numerical conventions. Math doc covers the
edge cases (window length, padding, normalization).

### WebGL2 required

If `canvas.getContext("webgl2")` returns null, the editor's button-click handler
shows a clear error in a modal:
> "AudioReact requires WebGL2, which is not available in this browser. Use
> the basic Audio React Pixaroma node — it has the same effects, runs entirely
> in Python, and is shipped alongside this node."

No WebGL1 fallback. Realistic ComfyUI users are on Chrome / Firefox / Safari 15+,
where WebGL2 has been universal since 2017.

### Highp precision throughout

Fragment shaders declare `precision highp float;` and use `highp` for sampler
coords + audio sample reads. Required because mediump can't represent envelope
values at ≥1000-frame indices precisely enough to avoid stepping artifacts in
slow-motion modes.

## 7. Editor UI

### Layout (locked option B)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ × AudioReact Pixaroma   [Image: Upstream] [Audio: Inline]    [SAVE]   │  ← header (32px)
├──────────────────────────────────────────┬──────────────────────────────┤
│                                          │  Motion / Overlays / Audio   │  ← sidebar tabs
│                                          │  / Output                    │
│             WebGL preview canvas         ├──────────────────────────────┤
│             (fits area, letterboxed      │  motion_mode: scale_pulse ▼  │
│              if aspect mismatch)         │  intensity:    [============-]│
│                                          │  motion_speed: [==-          ]│
│                                          │  smoothing:    [====         ]│
│                                          │  loop_safe:    [✓]           │
│                                          │                              │
├──────────────────────────────────────────┤                              │
│ ▶  0:03 [══════•─────────] 0:08  24fps ◀▶│                              │  ← transport (36px)
└──────────────────────────────────────────┴──────────────────────────────┘
```

### Header

- × close button (left)
- Title "AudioReact Pixaroma" — orange (`#f66744`) accent
- Two upstream pills:
  - `Image: Upstream` (green when wired) / `Image: Inline (load…)` (gray) / `Image: Inline ✓` (with thumbnail mini-icon when loaded)
  - Same three states for audio. Click pill → toggle source mode (with file picker if switching to Inline).
- Save button (orange, right) — disabled when state matches saved JSON.

### Canvas

- Fits available area, preserves output aspect ratio (letterbox horizontally
  or vertically as needed). `canvas.width / .height` set to canvas's CSS pixel
  size (or 1024 max for perf, with internal upscale on display).
- Renders at canvas size, NOT full output size — performance is constant
  regardless of output resolution.
- Drag-and-drop image OR audio onto the canvas → identical to clicking the pill
  to switch to inline + opening the file picker.

### Transport bar (~36px tall, full width below canvas)

- Play / pause button (orange, 22px circle)
- Current time `m:ss`
- Scrub bar — full available width, 8px tall, with:
  - 1px-tall **inline envelope sparkline** (faint orange) showing envelope
    amplitude across the full audio
  - Filled portion (orange) up to playhead
  - Draggable playhead handle (10px circle)
  - Click anywhere on bar → seek
  - Drag → continuous scrub
- Total duration `m:ss`
- FPS indicator `24fps`
- Frame stepper buttons `◀` and `▶` (single-frame back/forward)

Playback plays the audio synchronously via Web Audio API. On Play: create a
new `AudioBufferSourceNode`, `start(0, current_offset)` it. The shader's
`current_frame` is derived from `audioContext.currentTime - start_time +
start_offset` (the offset is the position when Play was clicked). On Pause:
stop the node, capture the offset. Web Audio sources cannot be restarted —
each Play creates a fresh source from the current offset. A
`requestAnimationFrame` loop computes `current_frame` and triggers a render
each frame.

Scrubbing during playback: stops the source, seeks to the dragged position,
restarts on release (or stays paused if the user clicked the play button to
pause). Scrubbing while paused: just updates `current_frame`, no audio.

### Right sidebar (~280px wide, tabbed)

**Motion tab:**
- `motion_mode` dropdown — 8 options
- `intensity` slider — 0.0..2.0, step 0.05
- `motion_speed` slider — 0.05..1.0, step 0.05
- `smoothing` slider — 1..15, step 1, integer
- `loop_safe` toggle

**Overlays tab:**
- 4 sliders — glitch / bloom / vignette / hue_shift, each 0.0..1.0, step 0.05
- Each has a 16×16 mini-preview swatch showing the effect at current strength
  (just the upper-left 16×16 of the canvas, rerendered when slider settles)

**Audio tab:**
- Image source pill (mirrors header pill, with full filename when inline)
- Audio source pill (same)
- `audio_band` dropdown — full / bass / mids / treble

**Output tab:**
- `aspect_ratio` dropdown — 21 options (same as Audio React)
- `custom_width` input — 64..4096, step 8
- `custom_height` input — 64..4096, step 8
- `fps` input — 8..60, step 1

Sliders show current value next to label, click value to type exact, drag to
adjust. Same pattern as `js/framework/components.mjs`.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| Space | Play / pause |
| ← / → | Frame step backward / forward |
| Shift+← / Shift+→ | 1-second skip |
| Esc | Close (with discard prompt if dirty) |
| Ctrl+S | Save |
| Ctrl+Z | Param undo |
| Ctrl+Shift+Z / Ctrl+Y | Param redo |

### Undo stack

Param-level snap stack (in-memory `[{params: {...}}, ...]`, ~50 levels), same
pattern as Note Pixaroma's `_undo` / `_redo`. Snaps after slider settles
(debounced 200ms) — not on every drag tick. Lives in `core.mjs`. Source-file
changes (load image / load audio) snap immediately.

### Vue compatibility patterns to apply (CLAUDE.md)

- Pattern #2 — `isEditorOpen(node)` helper for editor-overlay-still-connected check.
- Pattern #4 — execution detection via `api.addEventListener("execution_start" / "executing", null)`.
- Pattern #5 — guard widget references against Vue tear-down via re-lookup from `node.widgets`.
- Pattern #6 — Ctrl+Z escape: patch `app.loadGraphData` + `app.graph.configure` while editor open.
  Resurrection-close safety net via `node.onRemoved`.
- Pattern #7 — `installFocusTrap` IS appropriate here (no contenteditable; sliders / dropdowns are INPUT/SELECT which the focus trap respects).
- Pattern #8 — `nodeCreated → queueMicrotask` for the initial DOM widget population so `studio_json` restored value is visible.
- Pattern #9 — `hidden` Python input + `node.properties.audioStudioState` + `app.graphToPrompt` injection. Locked. Mirrors `js/resolution/index.js`.

## 8. Data flow + persistence schema

### `studio_json` schema (v1)

```jsonc
{
  "schema_version": 1,

  // Effect params (mirror engine Params dataclass)
  "motion_mode": "scale_pulse",
  "intensity": 0.8,
  "audio_band": "full",
  "motion_speed": 0.2,
  "smoothing": 5,
  "loop_safe": true,
  "fps": 24,
  "glitch_strength": 0.6,
  "bloom_strength": 0.0,
  "vignette_strength": 0.0,
  "hue_shift_strength": 0.0,
  "aspect_ratio": "Original",
  "custom_width": 1024,
  "custom_height": 1024,

  // Source modes
  "image_source": "upstream",     // "upstream" | "inline"
  "image_path":   null,           // "audio_studio/<node_id>/image.png" if inline
  "audio_source": "upstream",     // "upstream" | "inline"
  "audio_path":   null            // "audio_studio/<node_id>/audio.wav" if inline
}
```

`schema_version` is the migration anchor. v1 is the only version at ship.
Future migrations: parse JSON → check `schema_version` → run migration steps →
write back.

### Defaults when JSON is empty / invalid

Use `Params()` defaults from the engine. Sources default to `"upstream"` —
i.e., on first open the editor expects upstream wiring; switching to Inline is
explicit.

### Persistence pattern

**Locked: Pattern #9 from CLAUDE.md.** Declare `studio_json` as a `hidden`
input in `INPUT_TYPES` (no widget, no slot dot). Store state on
`node.properties.audioStudioState` (LiteGraph serializes `properties` natively
in workflow JSON). Monkey-patch `app.graphToPrompt` at extension scope to
inject `inputs.studio_json = JSON.stringify(node.properties.audioStudioState)`
right before submission to the backend. This is the same pattern Resolution
Pixaroma already uses successfully (`js/resolution/index.js`) — it's
production-proven in this codebase.

The fallback (required STRING + `hideJsonWidget`) was considered. We're not
using it because it leaves a visible input dot on the node and Resolution
Pixaroma already proved Pattern #9 works for hidden state with optional input
slots — there's no reason to expect AudioReact to behave differently.

### Open-editor flow

1. User clicks **"Open AudioReact"** button on the node.
2. JS reads `node.properties.audioStudioState` → parses → fills missing keys
   with defaults. (Includes a one-time migration that scans `node.widgets_values`
   for any older format if the persistence layer is ever revised.)
3. **Image resolution:**
   - If `image_source == "upstream"`:
     - Walk `node.inputs[0].link` to upstream node.
     - If `LoadImage` (or any node with `widgets[name="image"]`) → fetch via
       `/view?filename=...&type=input&subfolder=`.
     - If `src.imgs?.length` is non-empty (a node that has cached executed
       output preview) → use `src.imgs[link.origin_slot]?.src` (data URL or
       view URL) directly.
     - Else (e.g. a generator node with no cached preview yet) → display an
       in-canvas message: "Upstream node hasn't been executed yet — run the
       workflow once first, or switch to Inline." Disable the canvas render
       loop until the user resolves it. The header pill shows
       `Image: Upstream (waiting)`. Same `graph.links?.[id]` / `Map.get`
       fallback pattern from Image Composer (CLAUDE.md Vue point #3).
   - If `image_source == "inline"`: GET via the existing `/pixaroma/assets/`
     route (extended to serve `audio_studio/<node_id>/image.png`) or via
     `/view?filename=...&subfolder=pixaroma/audio_studio/<node_id>&type=input`
     (preferred — uses ComfyUI's existing input-fetch route, no server-side
     change needed).
4. **Audio resolution:** same dual logic.
5. Image bytes → WebGL texture; audio bytes → Web Audio API `decodeAudioData` →
   `computeEnvelope` + `computeOnset` → R32F textures.
6. Render preview at frame 0.

### Save flow

1. User clicks **Save**.
2. For each inline-loaded source that's been changed since open:
   - POST file bytes (multipart form) to `/pixaroma/api/audio_studio/upload`
     with `node_id` + `kind` (`image` or `audio`).
   - Server saves to `input/pixaroma/audio_studio/<node_id>/<kind>.<ext>`.
   - Server returns the relative path.
3. Update `studio_json` with all params + the resolved source paths.
4. Commit to `node.properties.audioStudioState`. The extension-scope
   `app.graphToPrompt` hook will inject `inputs.studio_json =
   JSON.stringify(state)` on the next workflow submission.
5. Close editor.

### Discard flow

- × Close (or Esc) with `state != saved_state` → modal:
  - Title: "Discard changes?"
  - Body: "You have unsaved changes to the AudioReact. Discard them and close?"
  - Buttons: **Cancel** (orange, default focus, keeps editor open) / **Discard** (red, closes without saving)
- No dirty changes → close immediately, no modal.

### Workflow execution flow (Python)

1. `PixaromaAudioStudio.generate(studio_json, image=None, audio=None)`.
2. Parse JSON. Apply schema migrations if needed.
3. Build `Params`.
4. Resolve image:
   - If `image_source == "upstream"`: use `image` param (must be non-None;
     raise actionable error if missing AND no inline path saved).
   - If `image_source == "inline"`: load from disk at
     `input/pixaroma/audio_studio/<node_id>/image.png` via PIL → torch
     conversion.
5. Resolve audio: same dual logic, returning AUDIO dict
   (`{waveform: torch.Tensor, sample_rate: int}`). Inline audio is **always
   stored as WAV on disk** — the browser converts whatever the user picked
   (MP3, OGG, AAC, WAV, etc.) to WAV before upload by:
   1. Running the file through `audioContext.decodeAudioData()` (Web Audio API,
      built-in, no deps), which yields a `Float32Array` per channel + a
      sample rate.
   2. Encoding that to a 16-bit PCM WAV with a small inlined writer (~50 LOC,
      no deps).
   3. POSTing the WAV bytes to `/pixaroma/api/audio_studio/upload`.
   Python loads the WAV via the stdlib `wave` module + numpy → torch — same
   pattern Save Mp4 Pixaroma already uses for its WAV writer
   (`_write_wav_pcm16`). No ffmpeg or audio-codec deps on the Python side.
6. Call `engine.generate_video(image, audio, params)`.
7. Return `(video_frames, audio, float(params.fps))`.

## 9. Server route

### `/pixaroma/api/audio_studio/upload` (POST)

Multipart form with fields:
- `node_id`: string, regex `^[a-zA-Z0-9_\-]+$`, max 64 chars
- `kind`: `"image"` | `"audio"`
- `file`: file bytes

Behavior:
- Validate `node_id` (reject otherwise with 400).
- For `kind == "image"`: accept png / jpg / jpeg / webp (extension picked from
  the upload's filename / MIME, validated against this allowlist).
- For `kind == "audio"`: **WAV only**. The browser does the format conversion
  before upload (see §8 audio resolution). Reject other extensions / MIME
  with 400. This keeps the Python side dependency-free (only stdlib `wave`).
- Compute target path: `input/pixaroma/audio_studio/<node_id>/<kind>.<ext>`.
- Use `_safe_path()` to validate the target stays under `PIXAROMA_INPUT_ROOT`.
- Cap each file at 50 MB; combined per node at 100 MB (sum of all files in the
  per-node directory after the new file lands).
- Replace any existing file with same `kind` (different extension is OK —
  remove old `<kind>.*` first).
- Return JSON `{"path": "audio_studio/<node_id>/<kind>.<ext>"}`.

Same security pattern as `/pixaroma/api/layer/upload` and `/pixaroma/api/3d/bg_upload`.

## 10. Parity strategy

### Math doc — `docs/audio-react-math.md`

Single source of truth for every formula. Sections:

1. Audio envelope pipeline — bandpass FFT, RMS per frame, moving-average,
   loop-safe ramp, peak normalize.
2. Onset track — derivative thresholding, exponential decay, peak normalize.
3. Motion modes — for each of the 8, the exact mathematical operation in
   normalized grid coordinates (`[-1, 1] × [-1, 1]`):
   - `scale_pulse`: `grid' = grid * (1 - env_t * intensity * 0.15)`
   - `zoom_punch`: `grid' = grid * (1 - onset_t * intensity * 0.30)`
   - `shake`: cumulative random walk, **note: deterministic seed required for parity; preview is approximate due to float-precision drift over long sequences**
   - `drift`: `grid' = grid - (sin(2π·motion_speed·t)·env_t·intensity·0.04, cos(...))`
   - `rotate_pulse`: angle = `sin(2π·motion_speed·t) * env_t * intensity * π/12` (max ±15°), aspect-corrected rotation
   - `ripple`: radial sine — `dr = A·sin(k·r - ω·t)`, `A = env_t·intensity·0.015·2.0` (normalized)
   - `swirl`: polar twist — `θ' = θ + env_t·intensity·(π/2)·max(0, 1 - r)`, aspect-corrected
   - `slit_scan`: per-row vertical sine displacement — `dy = A·sin(k·y_norm - ω·t)`, `A = env_t·intensity·0.04`, plus 0.5×amp horizontal displacement at phase offset
4. Overlays — for each of the 4:
   - `glitch`: per-channel R/G/B horizontal shift, `max_px = onset_t·strength·0.012·min(W,H)`, plus 5%-row swap when `onset_t·strength > 0.7`
   - `bloom`: downsample 4x → 9-tap separable Gaussian blur (sigma=2.0) → upsample → screen blend with `weight = env_t·strength·0.6`
   - `vignette`: radial mask `1 - (r/√2)·env_t·strength·0.5`
   - `hue_shift`: rotation around the (1,1,1) gray axis using exact YIQ-derived 3×3 matrix, angle = `env_t·strength·30°`
5. Constants table — every magic number used in any formula, with rationale.
6. Where preview ≠ MP4 — explicit list of approximations (currently: `shake` only).

### Python parity script — `scripts/audio_parity_check.py`

Runs locally before releases. Inputs: fixed test image (committed at
`assets/audio_studio_parity/test_image.png`, suggested 512×512 with high-frequency
content for sensitivity) + a deterministic synthetic audio (computed from a seed:
sine sweep + onset spikes at known timestamps).

For each motion mode (8) → renders 6 frames at known timestamps (frames 0, 6, 12, 18, 24, 30 of a 30fps clip with intensity=0.8, motion_speed=0.2, audio_band=full, smoothing=5, loop_safe=False). Saves to `tests/audio_parity_goldens/motion_<mode>_<frame>.png`.

For each overlay-stack combo (4 — single overlay at strength=0.7, scale_pulse motion underneath) → renders 4 frames. Saves to `tests/audio_parity_goldens/overlay_<name>_<frame>.png`.

64 PNGs total at v1 ship.

Script behavior:
- First run: regenerate goldens from current engine output.
- Subsequent runs: render same set, diff against committed goldens, report
  per-test pixel-RMSE and ΔE. Exits non-zero if any diff exceeds tolerance.
- Regeneration mode: explicit `--regenerate` flag (intentional, never default).

Tolerance: pixel RMSE ≤ 1.0 (out of 255) per test. (Engine is deterministic;
this just guards against accidental refactors in helper functions.)

### Browser parity harness — `assets/audio_studio_parity/index.html`

Single bundled HTML page — no external server, no node deps. Loads the same
test image + the same goldens (committed PNGs, fetched via relative paths).
Renders WebGL pipeline against same params. Displays:
- Each (golden, WebGL) pair side by side
- ΔE per pair (mean perpixel CIE76 in JS, ≤200 LOC)
- Pass/fail badge (green if mean ΔE ≤ 5.0, red otherwise)

Run manually by the developer before each release. Documented in
`docs/audio-react-math.md`'s parity section.

### Where preview is approximate (carve-out)

`shake` motion mode's cumulative random walk over hundreds of frames diverges
between Python's `torch.Generator` and any deterministic JS RNG seeded
identically (the iterations differ in float ordering by frame). Math doc notes:
"shake's PREVIEW is approximate. Final MP4 (Python output) is authoritative."
Browser harness exempts shake from ΔE check or uses a looser ≤ ΔE 15 tolerance
specifically for shake. All other modes are exact-bit-pattern bound (within
shader-precision rounding).

## 11. Out of scope (v1)

- **`overlay_preset` widget** — deferred to its own follow-up spec; will apply
  to Audio React AND AudioReact uniformly.
- **WebGL1 fallback** — WebGL2 is universal in modern browsers.
- **Per-band routing** (e.g., bass→motion, treble→glitch) — interesting v2.
- **Custom param keyframe / curve editing** — v2+.
- **Multi-image input** — separate "Audio Beat Mix" node concept.
- **Real-time waveform strip** — Layout C from the brainstorm; deferred to v1.1.
- **Headless WebGL CI** — manual parity harness is sufficient at this scale.
- **Audio playback latency calibration** — v1 uses Web Audio API as-is; users
  may notice ~50ms delay on some browsers. v1.1 can add a calibration step.
- **Output to disk button (separate from Save)** — Save commits to JSON; the
  workflow run produces the actual MP4 via Save Mp4 Pixaroma.
- **Shader hot-reload during dev** — drop-in nice-to-have but not v1.

## 12. Acceptance criteria

A v1 release is shippable when:

1. **Editor opens** from the node's "Open AudioReact" button. Restores all
   params + sources from saved `studio_json`. Defaults match Audio React's
   widget defaults when JSON is empty / missing.
2. **WebGL preview** renders all 8 motion modes + 4 overlays at ≥30 fps on a
   1024×576 canvas (target hardware: integrated GPU laptop running ComfyUI).
3. **Scrubbing** is responsive: dragging the scrub bar updates the preview
   within 1 frame. Spacebar play/pause works. Arrow-key frame stepping works.
   Audio plays synchronized with the playhead (Web Audio API).
4. **Source switching** (upstream ↔ inline) works without restart. Inline-loaded
   files persist via `/pixaroma/api/audio_studio/upload` and survive workflow
   reload.
5. **Save** writes valid JSON; reopening the workflow restores all state;
   discard prompt appears when closing dirty.
6. **Workflow execution** produces `(video_frames, audio, fps)` matching basic
   Audio React's output for an identical config — verified by Python parity
   check.
7. **Vue compatibility**: Ctrl+Z does not delete the node while editor is open;
   right-click "Remove" while editor open is handled cleanly via
   `node.onRemoved` resurrection-close; reopening after a close + reopen cycle
   works.
8. **Browser parity harness** shows ≤ ΔE 5.0 mean for each non-shake test;
   shake tests show "approximate" badge with no ΔE assertion.
9. **README + CLAUDE.md** updated with the new node, file layout, and Studio
   patterns section.

## 13. Risks

- **Audio decoding format support** — Web Audio API supports MP3 / WAV / OGG /
  AAC consistently across modern browsers; FLAC support is partial in Chrome.
  On decode failure, show user-facing error: "Audio decode failed — try
  re-encoding to WAV or MP3."
- **Memory at 4K outputs** — Python side is unchanged from current Audio React
  (~1.5 GB VRAM for 30s 4K). Editor preview always at canvas size, not output
  size — VRAM-light.
- **WebGL precision across drivers** — `highp` is required but driver behavior
  varies. Parity harness should be run on Chrome / Firefox / Safari at minimum
  before each release.
- **Web Audio API audio playback drift** — `AudioBufferSourceNode` cannot be
  stopped and resumed; we restart from offset on each play. May accumulate
  ~10-20ms drift over long sessions; acceptable for v1.
- **Engine extraction risk** — refactoring `node_audio_react.py` to use the
  shared engine MUST produce identical output for existing workflows. Plan: run
  Python parity script BEFORE the refactor (capture goldens from current
  output) AND AFTER (verify identical). Parity goldens become the regression
  test.
- **Studio JSON schema growth** — `schema_version` is in place from v1. Future
  param additions must include a migration path that preserves saved
  configurations.

## 14. File touch list

| File | New / Modified | Approx lines |
|------|----------------|--------------|
| `nodes/_audio_react_engine.py` | NEW | ~550 (the math) |
| `nodes/node_audio_studio.py` | NEW | ~150 |
| `nodes/node_audio_react.py` | MODIFIED (refactor) | ~600 → ~100 |
| `js/audio_studio/index.js` | NEW | ~250 |
| `js/audio_studio/core.mjs` | NEW | ~400 |
| `js/audio_studio/transport.mjs` | NEW | ~300 |
| `js/audio_studio/audio_analysis.mjs` | NEW | ~300 (incl FFT) |
| `js/audio_studio/render.mjs` | NEW | ~350 |
| `js/audio_studio/shaders.mjs` | NEW | ~600 (8 motion + overlay GLSL) |
| `js/audio_studio/ui.mjs` | NEW | ~400 |
| `js/audio_studio/api.mjs` | NEW | ~80 |
| `scripts/audio_parity_check.py` | NEW | ~250 |
| `docs/audio-react-math.md` | NEW | ~400 |
| `tests/audio_parity_goldens/manifest.json` | NEW | ~80 |
| `assets/audio_studio_parity/index.html` | NEW | ~350 |
| `server_routes.py` | MODIFIED (+upload route) | +120 |
| `__init__.py` | MODIFIED (+register node + JS) | +5 |
| `CLAUDE.md` | MODIFIED (Studio sections) | +200 |
| `README.md` | MODIFIED (feature blurb) | +30 |

**Total new code:** ~3500 lines (close to the upper end of the user's estimate).
**Goldens:** 64 small PNGs (~3 MB total committed assets).

---
