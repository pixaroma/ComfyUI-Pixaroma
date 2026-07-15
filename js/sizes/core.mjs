// Sizes Pixaroma - shared state + helpers (imported by index.js and settings.mjs).
//
// State lives on node.properties.sizesState (LiteGraph serializes it natively)
// and is injected into the hidden SizesState input by the graphToPrompt hook in
// index.js (Vue Compat #9). JS computes the final oriented + snapped width and
// height and stores them as state.w / state.h so Python just reads them back.

import { app } from "/scripts/app.js";

export const BRAND = "#f66744";
export const STATE_PROP = "sizesState";
export const HIDDEN_INPUT = "SizesState"; // matches the Python INPUT_TYPES key
export const ACCENT_SETTING = "Pixaroma.Sizes.AccentColor";

export const MAX_SIZES = 40;
// 0 = off (new nodes start here, per the spec); else a VAE-friendly multiple.
export const SNAP_OPTIONS = [0, 8, 16, 32, 64];
// Loaded by the "Add common sizes" button. Squares cover the usual SD/Flux runs.
export const COMMON_SIZES = [
  [512, 512], [768, 768], [1024, 1024],
  [1280, 1280], [1536, 1536], [2048, 2048],
];

export const DEFAULT_STATE = {
  version: 1,
  sizes: [[1024, 1024]], // fresh node starts with one size
  selected: 0,
  orientation: "portrait", // "portrait" | "landscape"
  snap: 0,                 // 0 = off; else 8 / 16 / 32 / 64
  accent: null,            // per-node override; null = follow the global default
  w: 1024,
  h: 1024,
};

function clampDim(n) {
  return Math.max(64, Math.min(16384, Math.round(n)));
}

export function snapDim(n, step) {
  if (!step) return Math.round(n);
  return Math.round(n / step) * step;
}

// Orientation forces which of the two numbers is width vs height: portrait =
// taller (min, max), landscape = wider (max, min). A square is unaffected. This
// is what makes "add a size once, flip it" work.
export function orient(pair, orientation) {
  const a = Number(pair?.[0]) || 0;
  const b = Number(pair?.[1]) || 0;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return orientation === "landscape" ? [hi, lo] : [lo, hi];
}

// A sane [w, h] pair — validated + snapped to at least 1 px each. Used both to
// clean up user-typed add-size input and to compute the final output.
export function sanitizePair(w, h) {
  const a = clampDim(Number.isFinite(+w) && +w > 0 ? +w : 1024);
  const b = clampDim(Number.isFinite(+h) && +h > 0 ? +h : 1024);
  return [a, b];
}

// Final output for a state: orient the selected size, then snap both dims.
export function finalWH(state) {
  const sizes = Array.isArray(state.sizes) && state.sizes.length ? state.sizes : [[1024, 1024]];
  let idx = state.selected | 0;
  if (idx < 0 || idx >= sizes.length) idx = 0;
  let [w, h] = orient(sizes[idx], state.orientation);
  w = clampDim(snapDim(w, state.snap));
  h = clampDim(snapDim(h, state.snap));
  return [w, h];
}

// Format a stored pair for the on-node list (oriented + snapped = WYSIWYG).
export function fmtRow(pair, state) {
  let [w, h] = orient(pair, state.orientation);
  w = clampDim(snapDim(w, state.snap));
  h = clampDim(snapDim(h, state.snap));
  return `${w} × ${h}`;
}

export function readState(node) {
  const v = node.properties?.[STATE_PROP];
  if (typeof v === "string" && v) {
    try {
      const parsed = JSON.parse(v);
      const st = { ...DEFAULT_STATE, ...parsed };
      // Never trust a persisted structure blindly (hand-edited / corrupt JSON).
      if (!Array.isArray(st.sizes) || !st.sizes.length) st.sizes = [[1024, 1024]];
      st.sizes = st.sizes
        .map((p) => sanitizePair(p?.[0], p?.[1]))
        .slice(0, MAX_SIZES);
      if (st.selected < 0 || st.selected >= st.sizes.length) st.selected = 0;
      if (st.orientation !== "landscape") st.orientation = "portrait";
      if (!SNAP_OPTIONS.includes(st.snap)) st.snap = 0;
      return st;
    } catch { /* fall through to default */ }
  }
  return { ...DEFAULT_STATE, sizes: [[1024, 1024]] };
}

// Merge + normalize + recompute the final w/h, then persist. Every caller writes
// through this so state.w / state.h can never drift from the selection.
export function writeState(node, state) {
  if (!node.properties) node.properties = {};
  const st = { ...DEFAULT_STATE, ...state };
  if (!Array.isArray(st.sizes) || !st.sizes.length) st.sizes = [[1024, 1024]];
  st.sizes = st.sizes.map((p) => sanitizePair(p?.[0], p?.[1])).slice(0, MAX_SIZES);
  if (st.selected < 0 || st.selected >= st.sizes.length) st.selected = 0;
  if (st.orientation !== "landscape") st.orientation = "portrait";
  if (!SNAP_OPTIONS.includes(st.snap)) st.snap = 0;
  const [w, h] = finalWH(st);
  st.w = w; st.h = h;
  node.properties[STATE_PROP] = JSON.stringify(st);
  return st;
}

export function addSize(node, w, h) {
  const st = readState(node);
  if (st.sizes.length >= MAX_SIZES) return null;
  const pair = sanitizePair(w, h);
  st.sizes.push(pair);
  st.selected = st.sizes.length - 1; // select the freshly added one
  return writeState(node, st);
}

export function removeSize(node, idx) {
  const st = readState(node);
  if (st.sizes.length <= 1) return null; // always keep at least one
  if (idx < 0 || idx >= st.sizes.length) return null;
  st.sizes.splice(idx, 1);
  if (st.selected >= st.sizes.length) st.selected = st.sizes.length - 1;
  else if (st.selected > idx) st.selected -= 1;
  return writeState(node, st);
}

export function reorderSize(node, from, to) {
  const st = readState(node);
  const n = st.sizes.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return null;
  const sel = st.selected;
  const [moved] = st.sizes.splice(from, 1);
  st.sizes.splice(to, 0, moved);
  // Keep the same PAIR selected after a reorder.
  if (sel === from) st.selected = to;
  else if (from < sel && to >= sel) st.selected = sel - 1;
  else if (from > sel && to <= sel) st.selected = sel + 1;
  return writeState(node, st);
}

export function addCommonSizes(node) {
  const st = readState(node);
  const seen = new Set(st.sizes.map((p) => `${p[0]}x${p[1]}`));
  for (const [w, h] of COMMON_SIZES) {
    const key = `${w}x${h}`;
    if (seen.has(key)) continue;
    if (st.sizes.length >= MAX_SIZES) break;
    st.sizes.push([w, h]);
    seen.add(key);
  }
  return writeState(node, st);
}

export function accentOf(node) {
  const st = readState(node);
  if (st.accent) return st.accent;
  try {
    const g = app.ui?.settings?.getSettingValue(ACCENT_SETTING);
    if (g) return g;
  } catch { /* ignore */ }
  return BRAND;
}
