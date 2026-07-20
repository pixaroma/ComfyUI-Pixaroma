// Outpaint Stitch Pixaroma - shared bits for the slider face + colour settings.
//
// The node is otherwise pure-Python with two native INT widgets (feather,
// color_match). Those widgets stay the SOURCE OF TRUTH - they serialize into the
// workflow and go into the prompt exactly as before - and the custom sliders
// just read and write their `.value`. So there is no hidden state, no
// graphToPrompt hook, and no risk to the Python contract; this file only adds a
// prettier face + a per-node accent colour (matching Sliders Pixaroma).

import { app } from "/scripts/app.js";

export const CLASS = "PixaromaOutpaintStitch";
export const BRAND = "#f66744";
export const ACCENT_SETTING = "Pixaroma.OutpaintStitch.AccentColor";
export const ACCENT_PROP = "outpaintStitchAccent";

// The colour the sliders paint with: this node's own choice, else the user's
// global default, else the Pixaroma orange. Nobody is forced into the brand
// (node UI convention: users recolour nodes, so no fixed accent).
export function accentOf(node) {
  const own = node?.properties?.[ACCENT_PROP];
  if (own && typeof own === "string" && own.trim()) return own.trim();
  try {
    const v = app.ui?.settings?.getSettingValue?.(ACCENT_SETTING);
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch {}
  return BRAND;
}

// Written ONLY when the user actually picks a colour (never on the load path),
// so a clean saved workflow never opens "modified" from an added property key
// (Vue Compat #18). Clearing (falsy) removes the key -> follow the global default.
export function setAccent(node, hex) {
  if (!node.properties) node.properties = {};
  if (hex) node.properties[ACCENT_PROP] = hex;
  else delete node.properties[ACCENT_PROP];
}

// The native INT widget behind a slider name (feather / color_match).
export function widgetOf(node, name) {
  return node.widgets?.find((w) => w.name === name) || null;
}
