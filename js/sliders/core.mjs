// Sliders Pixaroma - state, output slots and the Auto type resolver.
//
// State lives on node.properties.slidersState (Vue Compat #9) and is injected
// into the hidden SlidersState input at submit time by index.js.
//
//   { version, accent, sliders: [ { name, type, min, max, step, value } ] }
//
//   type   "auto" until the slider is first connected, then "int" | "float".
//   accent null = follow the global default setting; a hex string overrides it.

import { app } from "/scripts/app.js";

export const STATE_PROP = "slidersState";
export const MAX_SLIDERS = 16;          // must match MAX_SLIDERS in node_sliders.py
export const BRAND = "#f66744";
export const ACCENT_SETTING = "Pixaroma.Sliders.AccentColor";

// A zero-width space: truthy, so neither renderer falls back to drawing the raw
// slot name ("value_1") on top of our row, but nothing is actually painted.
export const ZW = "​";

const OUT_NAME = (idx1) => `value_${idx1}`;

export function defaultSlider(idx1) {
  return { name: `Value ${idx1}`, type: "auto", min: 0, max: 1, step: 0.01, value: 0.5 };
}

function defaultState() {
  return { version: 1, accent: null, sliders: [defaultSlider(1)] };
}

export function readState(node) {
  if (!node.properties) node.properties = {};
  let st = node.properties[STATE_PROP];
  if (!st || typeof st !== "object") {
    st = defaultState();
    node.properties[STATE_PROP] = st;
  }
  if (!Array.isArray(st.sliders) || !st.sliders.length) st.sliders = [defaultSlider(1)];
  if (st.accent === undefined) st.accent = null;
  return st;
}

// The colour the sliders paint with: this node's own choice, else the user's
// global default, else the Pixaroma orange. Nobody is forced into the brand.
export function accentOf(node) {
  const own = readState(node).accent;
  if (own) return own;
  try {
    const v = app.ui?.settings?.getSettingValue?.(ACCENT_SETTING);
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch {}
  return BRAND;
}

// Decimal places implied by a slider's step (0.01 -> 2). Used for display and
// for rounding, so a float slider never shows 0.30000000000000004.
export function decimalsOf(s) {
  if (s.type === "int") return 0;
  const step = Math.abs(Number(s.step) || 0);
  if (!step || !Number.isFinite(step)) return 2;
  const txt = String(step);
  const dot = txt.indexOf(".");
  if (dot < 0) return 0;
  return Math.min(6, txt.length - dot - 1);
}

// The slider's range, always low-to-high. A user can type Min 100 / Max 0 in the
// settings, and EVERY reader has to agree on what that means - otherwise the
// fill paints from the wrong end and the drag runs backwards.
export function rangeOf(s) {
  let lo = Number(s.min);
  let hi = Number(s.max);
  if (!Number.isFinite(lo)) lo = 0;
  if (!Number.isFinite(hi)) hi = 1;
  if (hi < lo) { const t = lo; lo = hi; hi = t; }
  return [lo, hi];
}

// Snap to the step grid, clamp to the range, and kill float drift.
export function clampValue(s, v) {
  const [min, max] = rangeOf(s);
  let step = Math.abs(Number(s.step) || 0);
  if (!Number.isFinite(step) || step <= 0) step = s.type === "int" ? 1 : 0.01;

  let n = Number(v);
  if (!Number.isFinite(n)) n = min;
  n = Math.round((n - min) / step) * step + min;
  n = Math.min(max, Math.max(min, n));
  if (s.type === "int") return Math.round(n);
  return Number(n.toFixed(decimalsOf(s)));
}

// A toggle row is a slider row with type "toggle". It stores its live state in
// `value` (0 / 1), the state it resets to in `def` (0 / 1), its two state words
// in onLabel / offLabel, and the output kind it has adopted in `out` ("auto"
// until it is wired, then "bool" | "int"). min / max / step are ignored for it.
export function ensureToggle(s) {
  s.value = Number(s.value) ? 1 : 0;
  s.def = Number(s.def) ? 1 : 0;
  if (typeof s.onLabel !== "string") s.onLabel = "On";
  if (typeof s.offLabel !== "string") s.offLabel = "Off";
  if (s.out !== "bool" && s.out !== "int") s.out = "auto";
}

// Re-clamp every slider (after a range or type edit in the settings panel).
export function normalizeSliders(node) {
  const st = readState(node);
  if (st.sliders.length > MAX_SLIDERS) st.sliders.length = MAX_SLIDERS;
  for (const s of st.sliders) {
    if (s.type === "toggle") { ensureToggle(s); continue; }
    if (s.type === "int") {
      // A whole-number slider stepping by 0.1 makes no sense.
      if (!Number.isFinite(Number(s.step)) || Number(s.step) < 1) s.step = 1;
      s.min = Math.round(Number(s.min) || 0);
      s.max = Math.round(Number(s.max) || 0);
    }
    s.value = clampValue(s, s.value);
  }
  return st;
}

export function addSlider(node) {
  const st = readState(node);
  if (st.sliders.length >= MAX_SLIDERS) return false;
  st.sliders.push(defaultSlider(st.sliders.length + 1));
  syncOutputs(node);
  return true;
}

export function removeSlider(node, index) {
  const st = readState(node);
  if (index < 0 || index >= st.sliders.length) return false;
  if (st.sliders.length <= 1) return false; // always keep one
  // Drop the matching output (and any wire on it) before the state shifts down.
  if (node.outputs && index < node.outputs.length) node.removeOutput(index);
  st.sliders.splice(index, 1);
  syncOutputs(node);
  return true;
}

// One output slot per slider, named to match Python's RETURN_NAMES so ComfyUI's
// node-def reconciliation never re-adds a phantom. Every write is diff-gated:
// re-writing an identical value still counts as a change on some builds and
// would flag a clean workflow "modified" on open (Vue Compat #18).
export function syncOutputs(node) {
  const st = readState(node);
  const want = Math.min(st.sliders.length, MAX_SLIDERS);
  if (!node.outputs) node.outputs = [];

  while (node.outputs.length > want) node.removeOutput(node.outputs.length - 1);
  while (node.outputs.length < want) node.addOutput(OUT_NAME(node.outputs.length + 1), "*");

  for (let i = 0; i < want; i++) {
    const o = node.outputs[i];
    const s = st.sliders[i];
    if (!o || !s) continue;
    const nm = OUT_NAME(i + 1);
    if (o.name !== nm) o.name = nm;
    // The slider row already shows the name, so the slot must draw no text of
    // its own - it would land on top of the row.
    if (o.label !== ZW) o.label = ZW;
    // A toggle narrows to BOOLEAN or INT once it has adopted an output kind;
    // a slider narrows to INT / FLOAT. Anything still "auto" stays "*" so it can
    // connect to either family, and the wire itself refuses a wrong target.
    let want_t;
    if (s.type === "toggle") {
      want_t = s.out === "bool" ? "BOOLEAN" : s.out === "int" ? "INT" : "*";
    } else {
      want_t = s.type === "int" ? "INT" : s.type === "float" ? "FLOAT" : "*";
    }
    if (o.type !== want_t) o.type = want_t;
  }
}

// A slider still exactly as it was created - the user has not renamed it or
// touched its range, so adopting the target input's is a favour, not a stomp.
function isUntouched(s, idx) {
  return (
    s.name === `Value ${idx + 1}` &&
    Number(s.min) === 0 && Number(s.max) === 1 && Number(s.step) === 0.01
  );
}

// Pick a range that is actually draggable. A steps input allows 1..10000, and a
// slider across that span moves ~40 steps per pixel - useless. So we keep the
// input's own minimum and step, and cap the top at four times its current value
// (never above the input's real maximum). Wire a slider to steps=20 and you get
// 1..80, not 1..10000.
function usefulRange(min, max, step, value) {
  const span = (max - min) / (step || 1);
  if (Number.isFinite(span) && span <= 400) return [min, max];
  const v = Number.isFinite(value) ? value : min;
  let top = Math.max(v * 4, min + 10 * step);
  if (Number.isFinite(max)) top = Math.min(top, max);
  return [min, top];
}

// Auto -> Int / Float, decided by the first thing the slider is plugged into.
// It also adopts that input's name, range, step and CURRENT VALUE (when the
// slider is still untouched), so connecting never silently changes the number
// the workflow was already running with.
//
// Only ever called for a real user connection (index.js gates it on
// isGraphLoading), so a workflow load can never rewrite the saved type.
// A toggle -> bool / 1-0, decided by the first thing it is plugged into: a
// BOOLEAN input makes it send true / false, a numeric input makes it send 1 / 0.
// While the row is still untouched it also adopts that input's name (and, for a
// boolean, its current state) so connecting never silently flips a flag.
function resolveToggleOut(node, s, slotIndex, link) {
  if (s.out === "bool" || s.out === "int") return false;   // already resolved

  const target = node.graph?.getNodeById?.(link.target_id);
  const inp = target?.inputs?.[link.target_slot];
  const t = String(inp?.type || "").toUpperCase();
  if (t === "BOOLEAN") s.out = "bool";
  else if (t === "INT" || t === "FLOAT") s.out = "int";
  else return false;   // unknown target family: leave it auto

  const wname = inp?.widget?.name || inp?.name;
  if (s.name === `Value ${slotIndex + 1}` && wname) {
    s.name = String(wname).replace(/_/g, " ");
    if (t === "BOOLEAN") {
      const w = target?.widgets?.find((x) => x.name === wname);
      if (w && typeof w.value === "boolean") { s.value = w.value ? 1 : 0; s.def = s.value; }
    }
  }

  ensureToggle(s);
  syncOutputs(node);
  return true;
}

export function resolveAutoType(node, slotIndex, link) {
  const st = readState(node);
  const s = st.sliders[slotIndex];
  if (!s || !link) return false;
  if (s.type === "toggle") return resolveToggleOut(node, s, slotIndex, link);
  if (s.type !== "auto") return false;

  const target = node.graph?.getNodeById?.(link.target_id);
  const inp = target?.inputs?.[link.target_slot];
  const t = String(inp?.type || "").toUpperCase();

  // A BOOLEAN target turns an Auto row into a Toggle switch - a slider makes no
  // sense for true / false. It adopts the target's name (while untouched) and its
  // current on/off state, so connecting never silently flips the flag.
  if (t === "BOOLEAN") {
    s.type = "toggle";
    ensureToggle(s);
    s.out = "bool";
    const wname = inp?.widget?.name || inp?.name;
    const w = target?.widgets?.find((x) => x.name === wname);
    s.value = (w && typeof w.value === "boolean") ? (w.value ? 1 : 0) : 0;
    s.def = s.value;
    if (wname && s.name === `Value ${slotIndex + 1}`) s.name = String(wname).replace(/_/g, " ");
    syncOutputs(node);
    return true;
  }

  if (t !== "INT" && t !== "FLOAT") return false;

  s.type = t === "INT" ? "int" : "float";

  // The widget behind that input carries the real limits.
  const wname = inp?.widget?.name || inp?.name;
  const w = target?.widgets?.find((x) => x.name === wname);
  const o = w?.options || {};

  if (isUntouched(s, slotIndex)) {
    // step2 is the true increment; `step` is inflated x10 by ComfyUI.
    let step = Number(o.step2);
    if (!Number.isFinite(step) || step <= 0) step = s.type === "int" ? 1 : 0.01;
    if (s.type === "int") step = Math.max(1, Math.round(step));

    let min = Number(o.min);
    if (!Number.isFinite(min)) min = 0;
    let max = Number(o.max);
    if (!Number.isFinite(max)) max = s.type === "int" ? 100 : 1;

    const cur = Number(w?.value);
    const [lo, hi] = usefulRange(min, max, step, cur);

    s.min = s.type === "int" ? Math.round(lo) : lo;
    s.max = s.type === "int" ? Math.round(hi) : hi;
    s.step = step;
    if (Number.isFinite(cur)) s.value = cur;      // adopt what it is running now
    if (wname) s.name = String(wname).replace(/_/g, " ");
  } else if (s.type === "int") {
    if (!Number.isFinite(Number(s.step)) || Number(s.step) < 1) s.step = 1;
    s.min = Math.round(Number(s.min) || 0);
    s.max = Math.round(Number(s.max) || 0);
  }

  s.value = clampValue(s, s.value);
  syncOutputs(node);
  return true;
}
