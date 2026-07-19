// Load Image Mini Pixaroma - shared state + accent. Kept tiny and separate from
// index.js so settings.mjs can import it without a circular dependency.
//
// The resize STATE is stored under node.properties.loadImagePixState - the SAME
// key Load Image uses. Properties are per-node-instance, so there is no
// collision with a real Load Image node, and it lets us drive Load Image's
// importable resize UI (buildModePanel / renderGlobalControls, whose internal
// readers are hard-wired to that key) verbatim. The accent lives inside the
// same object under `accent`; Python's _parse_state filters it out, so it never
// reaches the backend - it is a pure frontend concern.

import { app } from "/scripts/app.js";

export const BRAND = "#f66744";
export const CLASS = "PixaromaLoadImageMini";
export const STATE_PROP = "loadImagePixState";       // reuse Load Image's key (see above)
export const HIDDEN_INPUT = "LoadImageMiniState";    // matches node_load_image_mini.py
export const ACCENT_SETTING = "Pixaroma.LoadImageMini.AccentColor";

// Mirror Load Image's DEFAULT_STATE so every reused resize control has the keys
// it expects. Pad is deliberately absent from the chip set (Outpaint owns that),
// but the pad_* keys are harmless if a hand-edited state carries them.
export const DEFAULT_STATE = {
  version: 1,
  mode: "off",
  max_mp: 1.0,
  longest_side: 1024,
  scale_factor: 1.0,
  fit_w: 1024, fit_h: 1024,
  cover_w: 1024, cover_h: 1024,
  ratio_preset: "1:1",
  ratio_w: 1, ratio_h: 1,
  ratio_action: "crop",
  pad_color: "#808080",
  pad_top: 0, pad_bottom: 0, pad_left: 0, pad_right: 0,
  crop_anchor: "center", crop_scale: true,
  snap: 0,
  resample: "auto",
  allow_upscale: true,
};

export function readState(node) {
  const v = node.properties?.[STATE_PROP];
  if (typeof v === "string" && v) {
    try { return { ...DEFAULT_STATE, ...JSON.parse(v) }; }
    catch { /* fall through */ }
  }
  return { ...DEFAULT_STATE };
}

// FULL-object write, matching Load Image's convention (buildModePanel /
// renderGlobalControls call writeState(node, {...state, key: val})).
export function writeState(node, state) {
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = JSON.stringify(state);
}

// The node's accent: its own saved colour, else the global default, else BRAND.
export function accentOf(node) {
  const st = readState(node);
  if (st.accent) return st.accent;
  try {
    const g = app.ui?.settings?.getSettingValue(ACCENT_SETTING);
    if (g) return g;
  } catch (_e) { /* settings not ready */ }
  return BRAND;
}
