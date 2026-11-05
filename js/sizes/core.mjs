// Sizes Pixaroma - shared state + helpers (imported by index.js and settings.mjs).
//
// State lives on node.properties.sizesState (LiteGraph serializes it natively)
// and is injected into the hidden SizesState input by the graphToPrompt hook in
// index.js (Vue Compat #9). JS computes the final oriented + snapped width and
// height and stores them as state.w / state.h so Python just reads them back.

import { app } from "../../../scripts/app.js";
import { globalAccent } from "../shared/node_settings.mjs";

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
// The labels a size can carry, in picker order. A closed list, so a label always
// fits the space beside the numbers on the node.
export const SIZE_TAGS = ["1K", "HD", "Full HD", "2K", "4K", "8K"];

export const DEFAULT_STATE = {
  version: 1,
  sizes: [[1024, 1024]], // fresh node starts with one size
  selected: 0,
  orientation: "portrait", // "portrait" | "landscape"
  snap: 0,                 // 0 = off; else 8 / 16 / 32 / 64
  accent: null,            // per-node override; null = follow the global default
  collapsed: false,        // folded down to show only the selected size
  // Sizes marked "recommended", stored as pairKey STRINGS (see starredKeys).
  starred: [],
  // Labels (HD, 4K...) as { pairKey: label }, keyed like the stars (see tagMap).
  tags: {},
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

// Unordered key so 1024×1536 and 1536×1024 count as the SAME size — orientation
// decides which number is width vs height, so the stored order is irrelevant.
export function pairKey(w, h) {
  const a = Math.round(Number(w) || 0), b = Math.round(Number(h) || 0);
  return `${Math.min(a, b)}x${Math.max(a, b)}`;
}

// ── Recommended ("starred") sizes ────────────────────────────────────────────
//
// Stored as pairKey STRINGS, never row indices. Rows are drag-reorderable and
// deletable, so an index list would silently drift and star the WRONG size the
// first time the user reordered - the same class of bug as Switch's per-row
// labels. pairKey is already the canonical unordered identity, so a star also
// survives an orientation flip (1024x1536 and 1536x1024 are one size).
//
// Deliberately NOT pruned when a size is deleted: a key with no matching row is
// inert (every reader iterates `sizes` and asks "is this one starred", never the
// other way round), so deleting a size and adding it back keeps its star. Same
// reasoning as Switch's label map. The cap is the only hygiene applied.
export function starredKeys(state) {
  const raw = Array.isArray(state?.starred) ? state.starred : [];
  return raw.filter((k) => typeof k === "string").slice(0, MAX_SIZES);
}

// Is this [w, h] pair marked recommended?
export function isStarredPair(state, pair) {
  if (!pair) return false;
  return starredKeys(state).includes(pairKey(pair[0], pair[1]));
}

// Flip the star on the size at `index`. Returns true when something changed.
export function toggleStarAt(node, index) {
  const st = readState(node);
  const pair = st.sizes?.[index];
  if (!pair) return false;
  const key = pairKey(pair[0], pair[1]);
  const list = starredKeys(st);
  const at = list.indexOf(key);
  if (at >= 0) list.splice(at, 1);
  else list.push(key);
  st.starred = list;
  writeState(node, st);
  return true;
}

// ── Labels ("tags") ──────────────────────────────────────────────────────────
//
// { pairKey: label }, for the same reasons as the stars above: rows can be
// reordered and deleted, so a label follows the SIZE, never a row number, and a
// deleted size that is added back keeps its label. A key with no row is inert.
// Only known labels on well-formed keys survive, so a hand-edited file cannot
// put anything else on the node. The cap keeps the NEWEST keys: a label is
// always written last, so a pile of old unused keys can never swallow it.
export function tagMap(state) {
  const raw = state?.tags;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const good = Object.entries(raw).filter(([k, v]) => /^\d+x\d+$/.test(k) && SIZE_TAGS.includes(v));
  return Object.fromEntries(good.slice(-MAX_SIZES));
}

// The label on this [w, h] pair, "" when it has none.
export function tagOfPair(state, pair) {
  if (!pair) return "";
  return tagMap(state)[pairKey(pair[0], pair[1])] || "";
}

// Put `tag` on the size at `index`, or take the label off with "". Returns true
// when something changed.
export function setTagAt(node, index, tag) {
  const st = readState(node);
  const pair = st.sizes?.[index];
  if (!pair) return false;
  const key = pairKey(pair[0], pair[1]);
  const tags = tagMap(st);
  if ((tags[key] || "") === tag) return false;
  delete tags[key];              // re-added below, so it counts as the newest
  if (tag) tags[key] = tag;
  st.tags = tags;
  writeState(node, st);
  return true;
}

// Index of an existing size matching w×h (unordered, sanitized), else -1.
export function findSizeIndex(state, w, h) {
  const [pw, ph] = sanitizePair(w, h);
  const key = pairKey(pw, ph);
  const sizes = Array.isArray(state?.sizes) ? state.sizes : [];
  for (let i = 0; i < sizes.length; i++) {
    if (pairKey(sizes[i]?.[0], sizes[i]?.[1]) === key) return i;
  }
  return -1;
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
      st.collapsed = !!st.collapsed;
      // Absent on every workflow saved before stars / labels existed - reads as
      // "none", so old files load unchanged with no migration.
      st.starred = starredKeys(st);
      st.tags = tagMap(st);
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
  st.collapsed = !!st.collapsed;
  st.starred = starredKeys(st);
  st.tags = tagMap(st);
  const [w, h] = finalWH(st);
  st.w = w; st.h = h;
  node.properties[STATE_PROP] = JSON.stringify(st);
  return st;
}

// Adds a size, refusing exact (unordered) duplicates. Returns a result object:
//   { ok:true,  state, index }              added — index is its new row
//   { ok:false, reason:"duplicate", index } already present — NOT added
//   { ok:false, reason:"max" }              the list is full
export function addSize(node, w, h) {
  const st = readState(node);
  const [pw, ph] = sanitizePair(w, h);
  const dup = findSizeIndex(st, pw, ph);
  if (dup >= 0) {
    // Still land the user on the size they typed, but don't clutter the list.
    if (st.selected !== dup) writeState(node, { ...st, selected: dup });
    return { ok: false, reason: "duplicate", index: dup };
  }
  if (st.sizes.length >= MAX_SIZES) return { ok: false, reason: "max" };
  st.sizes.push([pw, ph]);
  st.selected = st.sizes.length - 1; // select the freshly added one
  return { ok: true, state: writeState(node, st), index: st.selected };
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
  const seen = new Set(st.sizes.map((p) => pairKey(p[0], p[1])));
  for (const [w, h] of COMMON_SIZES) {
    const key = pairKey(w, h);
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
  return globalAccent() || BRAND;   // then the master Pixaroma default
}
