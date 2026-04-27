// js/audio_studio/index.js
import { app } from "../../../../scripts/app.js";

import { AudioStudioEditor } from "./core.mjs";
// Mixin imports — must be side-effect imports BEFORE the first
// AudioStudioEditor instantiation. Each mixin file extends
// AudioStudioEditor.prototype with its methods (D4 / E2 / G1+).
import "./ui.mjs";
import "./transport.mjs";
import "./render.mjs";

const STATE_KEY = "audioStudioState";

// Default config — MUST stay in sync with Params() defaults in
// nodes/_audio_react_engine.py. When updating one, update the other
// (CLAUDE.md "AudioReact Patterns" #1 calls this risk out).
const DEFAULT_CFG = {
  schema_version: 1,
  motion_mode: "scale_pulse",
  intensity: 0.8,
  audio_band: "full",
  motion_speed: 0.2,
  // +1 = original direction, -1 = reversed (only affects rotational/wave
  // motion modes — see Params.motion_direction in _audio_react_engine.py).
  motion_direction: 1.0,
  // Per-mode params — each is no-op for non-target modes. Defaults match
  // Params(...) in nodes/_audio_react_engine.py (Pattern #1).
  shake_axis: "both",       // "both" / "x" / "y" — Camera Shake only
  ripple_density: 1.0,      // multiplier on Ripple's wave frequency
  slit_density: 1.0,        // multiplier on Time Slice's bar count
  glitch_bands: 30,         // Glitch motion — horizontal slice count (5-100)
  wave_density: 1.0,        // multiplier on Wave's spatial frequency
  pixelate_blocks: 24,      // Pixelate motion — block count at peak onset
  squeeze_axis: "x",        // "x" or "y" — Squeeze motion only
  smoothing: 5,
  loop_safe: true,
  fps: 24,
  // All overlays default off — user enables what they want via sliders.
  glitch_strength: 0.0,
  bloom_strength: 0.0,
  vignette_strength: 0.0,
  hue_shift_strength: 0.0,
  grade_strength: 0.0,
  letterbox_strength: 0.0,
  scanline_strength: 0.0,
  grain_strength: 0.0,
  aspect_ratio: "Original",
  custom_width: 1024,
  custom_height: 1024,
  image_source: "upstream",
  image_path: null,
  audio_source: "upstream",
  audio_path: null,
  // Force-inline override flags. Set to true when the user explicitly picks
  // an inline file inside the editor — that upload then overrides any
  // upstream wire (matches the user expectation: "I just picked this, use
  // it"). When false, upstream wins if wired and inline is the fallback.
  image_force_inline: false,
  audio_force_inline: false,
  // Upload timestamps, bumped on every editor upload. They serialize into
  // studio_json so re-uploading to the same path (same node id + same
  // extension overwrites in place) still produces a different prompt JSON
  // — otherwise ComfyUI's prompt cache hits the previous result and
  // returns the old MP4 unchanged. The Python side ignores these fields.
  image_uploaded_at: 0,
  audio_uploaded_at: 0,
};

// Vue-compat: the editor overlay can be removed from the DOM by Vue
// without our close handler firing (CLAUDE.md Pattern #2). Always
// re-derive open-ness from `overlay.isConnected`.
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
  // studio_json from node.properties.audioStudioState into the request
  // body right before submission. Same pattern as Resolution Pixaroma.
  async setup() {
    const original = app.graphToPrompt.bind(app);
    app.graphToPrompt = async function (...args) {
      const result = await original(...args);
      try {
        const out = result?.output;
        if (!out) return result;
        for (const id in out) {
          const entry = out[id];
          if (!entry || entry.class_type !== "PixaromaAudioStudio") continue;
          // Resolve the node from the graph by id (subgraph-safe: try both
          // exact id and parseInt fallback, same defensive pattern as Resolution).
          let node = null;
          const graph = app.graph;
          if (graph) {
            const nodes = graph._nodes || graph.nodes || [];
            for (const n of nodes) {
              if (!n) continue;
              if (String(n.id) === String(id) || parseInt(n.id, 10) === parseInt(id, 10)) {
                node = n;
                break;
              }
            }
          }
          const state = node?.properties?.[STATE_KEY] ?? DEFAULT_CFG;
          entry.inputs = entry.inputs || {};
          entry.inputs.studio_json = JSON.stringify(state);
        }
      } catch (e) {
        console.warn("[Pixaroma] AudioStudio graphToPrompt hook failed:", e);
      }
      return result;
    };
  },

  async nodeCreated(node) {
    if (node.comfyClass !== "PixaromaAudioStudio") return;

    if (!node.properties) node.properties = {};
    if (!node.properties[STATE_KEY]) {
      node.properties[STATE_KEY] = { ...DEFAULT_CFG };
    }

    // CLAUDE.md Pattern #8: defer to queueMicrotask so configure() has
    // restored node.properties[STATE_KEY] from saved workflow JSON
    // before we read it (otherwise the editor opens with defaults on a
    // workflow reload).
    queueMicrotask(() => {
      // Currently no DOM widget to populate — the node is button-only
      // until Milestone H adds the upstream-aware preview.
    });

    node.size = node.size || [240, 100];

    node.addWidget("button", "Open AudioReact", null, () => {
      if (isEditorOpen(node)) return; // guard double-open
      // Forward-compat: spread DEFAULT_CFG under the saved state so any
      // keys added after this workflow was last saved get sane defaults
      // instead of leaving sliders blank. Saved values still win.
      const saved = node.properties[STATE_KEY] || {};
      const cfg = { ...DEFAULT_CFG, ...saved };
      const editor = new AudioStudioEditor(node, cfg, DEFAULT_CFG);
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
