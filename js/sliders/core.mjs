// Sliders Pixaroma - state, output slots and the Auto type resolver.
//
// State lives on node.properties.slidersState (Vue Compat #9) and is injected
// into the hidden SlidersState input at submit time by index.js.
//
//   { version, accent, sliders: [ { name, type, min, max, step, value } ] }
//
//   type   "auto" until first connected, then "int" | "float" (a number slider),
//          or "toggle" (an on/off switch). A toggle row also carries: value 0/1,
//          def 0/1 (reset target), out "auto"|"bool"|"int" (adopted output kind),
//          onLabel / offLabel (display-only state words). min/max/step are ignored
//          for a toggle.
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
  const v = Number(s.value), d = Number(s.def);
  // Non-finite / garbage -> Off, matching Python's _value_of (a hand-edited file
  // could carry "Infinity"; normal UI writes only 0/1).
  s.value = (Number.isFinite(v) && v !== 0) ? 1 : 0;
  s.def = (Number.isFinite(d) && d !== 0) ? 1 : 0;
  if (typeof s.onLabel !== "string") s.onLabel = "On";
  if (typeof s.offLabel !== "string") s.offLabel = "Off";
  if (s.out !== "bool" && s.out !== "int") s.out = "auto";
}

// A combo (dropdown) row is created by wiring an Auto row to a picker input
// (sampler, scheduler, checkpoint, ...); it adopts that picker's whole option
// list into `options`. `allowed` is the subset the user ticked to show (empty =
// show all); `value` is the current pick, `def` the default. All are strings.
export function comboVisible(s) {
  const opts = Array.isArray(s.options) ? s.options : [];
  const allow = Array.isArray(s.allowed) ? s.allowed.filter((o) => opts.includes(o)) : [];
  return allow.length ? allow : opts;
}

export function ensureCombo(s) {
  if (!Array.isArray(s.options)) s.options = [];
  if (!Array.isArray(s.allowed)) s.allowed = [];
  const vis = comboVisible(s);
  // Keep the current pick if it is still a VALID option, even when it has been
  // filtered out of the visible list - narrowing the Show-options filter must not
  // silently change what the workflow runs. Only fall back when it is not an
  // option at all (e.g. the picker's list changed on a re-wire).
  if (typeof s.value !== "string" || !s.options.includes(s.value)) s.value = vis[0] || s.options[0] || "";
  if (typeof s.def !== "string" || !s.options.includes(s.def)) s.def = vis[0] || s.options[0] || "";
}

// Read a target input's dropdown option list, whether it is still a live combo
// widget or a converted combo input (options then live in the node definition).
export function comboOptionsOf(target, inputName) {
  if (!target || !inputName) return null;
  const w = target.widgets?.find((x) => x.name === inputName);
  if (Array.isArray(w?.options?.values) && w.options.values.length) return w.options.values.slice();
  const def = target.constructor?.nodeData?.input;
  const spec = def?.required?.[inputName] || def?.optional?.[inputName];
  if (Array.isArray(spec) && Array.isArray(spec[0]) && spec[0].length) return spec[0].slice();
  return null;
}

// A seed control is an INT row (name like "seed") with a randomize mode. `value`
// is the current seed; `mode` is "fixed" (keep it) or "random" (a fresh seed each
// run, rolled at submit time - see graphToPrompt). Kept < 1e12 so Python's value
// clamp never touches it, while still giving billions of seeds.
export function randomSeed() { return Math.floor(Math.random() * 0x100000000); }

export function ensureSeed(s) {
  let v = Number(s.value);
  if (!Number.isFinite(v) || v < 0) v = randomSeed();
  // Cap at Python's own value clamp (1e12) so a hand-typed huge seed shows the
  // same number JS serialises and Python actually runs with.
  s.value = Math.min(Math.floor(v), 1e12);
  if (s.mode !== "random") s.mode = "fixed";
}

// A text control is a STRING row: `value` is the typed text (single line).
export function ensureText(s) {
  if (typeof s.value !== "string") s.value = s.value == null ? "" : String(s.value);
}

// Re-clamp every slider (after a range or type edit in the settings panel).
export function normalizeSliders(node) {
  const st = readState(node);
  if (st.sliders.length > MAX_SLIDERS) st.sliders.length = MAX_SLIDERS;
  for (const s of st.sliders) {
    if (s.type === "toggle") { ensureToggle(s); continue; }
    if (s.type === "combo") { ensureCombo(s); continue; }
    if (s.type === "seed") { ensureSeed(s); continue; }
    if (s.type === "text") { ensureText(s); continue; }
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

// The runtime, index-keyed hint maps (value-preservation on re-wire, the rolled
// seed shown on the face) must shift with the rows when one is removed, or a
// stale entry leaks onto whatever row later lands on that index (a fresh row
// wired after a delete could inherit the deleted row's type or seed). Runtime
// only - never serialized, so this never touches the saved workflow.
function reindexRuntimeMaps(node, removedIndex) {
  for (const key of ["_pixWasType", "_pixWasTarget", "_pixSeedRun"]) {
    const m = node[key];
    if (!m || typeof m !== "object") continue;
    const next = {};
    for (const k of Object.keys(m)) {
      const ki = Number(k);
      if (!Number.isInteger(ki)) continue;
      if (ki < removedIndex) next[ki] = m[k];
      else if (ki > removedIndex) next[ki - 1] = m[k];
      // ki === removedIndex: the deleted row's entry is dropped
    }
    node[key] = next;
  }
}

export function removeSlider(node, index) {
  const st = readState(node);
  if (index < 0 || index >= st.sliders.length) return false;
  if (st.sliders.length <= 1) return false; // always keep one
  // Drop the matching output (and any wire on it) before the state shifts down.
  if (node.outputs && index < node.outputs.length) node.removeOutput(index);
  st.sliders.splice(index, 1);
  reindexRuntimeMaps(node, index);
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
    } else if (s.type === "combo") {
      // A dropdown sends a validated option string; "*" so it connects to any
      // picker input (each picker's type is its own option list).
      want_t = "*";
    } else if (s.type === "seed") {
      want_t = "INT";
    } else if (s.type === "text") {
      want_t = "STRING";
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
  const pristine = s.name === `Value ${slotIndex + 1}`;
  // The name follows the new target unless the user named it themselves.
  if (wname && (pristine || s.autoName)) {
    s.name = String(wname).replace(/_/g, " ");
    s.autoName = true;
  }
  // Only a pristine toggle adopts the target's current on/off, so re-wiring never
  // silently flips a switch the user set.
  if (t === "BOOLEAN" && pristine) {
    const w = target?.widgets?.find((x) => x.name === wname);
    if (w && typeof w.value === "boolean") { s.value = w.value ? 1 : 0; s.def = s.value; }
  }

  ensureToggle(s);
  syncOutputs(node);
  return true;
}

// An existing dropdown re-wired to another picker re-adopts its option list,
// drops any filtered options that no longer exist, and fixes the current pick.
function resolveComboOptions(node, s, slotIndex, link) {
  const target = node.graph?.getNodeById?.(link.target_id);
  const inp = target?.inputs?.[link.target_slot];
  const wname = inp?.widget?.name || inp?.name;
  const opts = comboOptionsOf(target, wname);
  if (!opts || !opts.length) return false;
  s.options = opts;
  if (Array.isArray(s.allowed)) s.allowed = s.allowed.filter((o) => opts.includes(o));
  if (wname && (s.name === `Value ${slotIndex + 1}` || s.autoName)) {
    s.name = String(wname).replace(/_/g, " ");
    s.autoName = true;
  }
  ensureCombo(s);
  syncOutputs(node);
  return true;
}

// A seed re-wired to another input just re-adopts the name (it stays a seed).
function resolveSeedRewire(node, s, slotIndex, link) {
  const target = node.graph?.getNodeById?.(link.target_id);
  const inp = target?.inputs?.[link.target_slot];
  const wname = inp?.widget?.name || inp?.name;
  if (wname && (s.name === `Value ${slotIndex + 1}` || s.autoName)) {
    s.name = String(wname).replace(/_/g, " ");
    s.autoName = true;
  }
  ensureSeed(s);
  syncOutputs(node);
  return true;
}

export function resolveAutoType(node, slotIndex, link) {
  const st = readState(node);
  const s = st.sliders[slotIndex];
  if (!s || !link) return false;

  const target = node.graph?.getNodeById?.(link.target_id);
  const inp = target?.inputs?.[link.target_slot];
  const t = String(inp?.type || "").toUpperCase();
  const twname = inp?.widget?.name || inp?.name;

  // The control ALWAYS follows its target: decide the kind the target calls for,
  // re-adopt in place when the row is already that kind, else let the branches
  // below re-type it. (So a switch unplugged and dropped on a seed becomes a
  // Seed, not a leftover switch - user-reported.)
  const twombo = comboOptionsOf(target, twname);
  const twant = t === "BOOLEAN" ? "toggle"
    : (twombo && twombo.length) ? "combo"
    : (t === "INT" && /seed/i.test(twname || "")) ? "seed"
    : (t === "INT" || t === "FLOAT") ? "number"
    : t === "STRING" ? "text"
    : null;
  if (!twant) return false;   // not a value input - refused in onConnectionsChange

  // Keep the value the user set ONLY when the SAME wire is replugged - i.e. the
  // row is re-connected to the exact same target input it was just unplugged
  // from. Then restore its type (a runtime hint from resetRowOnDisconnect, never
  // serialized) so the branch below RE-ADOPTS in place instead of a fresh
  // conversion that would overwrite the value. A re-wire to a DIFFERENT input
  // (even of the same kind - steps -> cfg, one boolean -> another) must fully
  // re-adopt that input's name, range and value (pattern #19), so it is left
  // "auto" and converts fresh. When the previous target is unknown (older builds
  // don't hand us the removed link on disconnect), fall back to the same-kind
  // restore so value-preservation still works.
  const wasType = node._pixWasType && node._pixWasType[slotIndex];
  const wasTarget = node._pixWasTarget && node._pixWasTarget[slotIndex];
  if (node._pixWasType) delete node._pixWasType[slotIndex];
  if (node._pixWasTarget) delete node._pixWasTarget[slotIndex];
  const sameKind =
    (twant === "toggle" && wasType === "toggle") ||
    (twant === "combo" && wasType === "combo") ||
    (twant === "seed" && wasType === "seed") ||
    (twant === "text" && wasType === "text") ||
    (twant === "number" && (wasType === "int" || wasType === "float"));
  const sameTarget = !!(wasTarget && wasTarget.id != null &&
    String(wasTarget.id) === String(link.target_id) && wasTarget.slot === link.target_slot);
  if (s.type === "auto" && wasType && sameKind && (sameTarget || !wasTarget)) {
    s.type = wasType;
  }

  if (s.type === "toggle" && twant === "toggle") return resolveToggleOut(node, s, slotIndex, link);
  if (s.type === "combo" && twant === "combo") return resolveComboOptions(node, s, slotIndex, link);
  if (s.type === "seed" && twant === "seed") return resolveSeedRewire(node, s, slotIndex, link);
  // Kind mismatch: a seed or number target only re-types an "auto" row, so drop a
  // non-matching row to auto first (a toggle/combo target's branch converts any row).
  if (twant === "seed" || (twant === "number" && s.type !== "int" && s.type !== "float")) {
    s.type = "auto"; s.min = 0; s.max = 1; s.step = 0.01;
  }

  // A BOOLEAN target turns ANY slider row (auto / int / float) into a Toggle - a
  // slider makes no sense for true / false. It adopts the target's name (while
  // untouched) and its current on/off state, so connecting never flips the flag.
  if (t === "BOOLEAN") {
    s.type = "toggle";
    ensureToggle(s);
    s.out = "bool";
    const wname = inp?.widget?.name || inp?.name;
    const w = target?.widgets?.find((x) => x.name === wname);
    s.value = (w && typeof w.value === "boolean") ? (w.value ? 1 : 0) : 0;
    s.def = s.value;
    if (wname && (s.name === `Value ${slotIndex + 1}` || s.autoName)) {
      s.name = String(wname).replace(/_/g, " ");
      s.autoName = true;
    }
    syncOutputs(node);
    return true;
  }

  // A STRING target turns the row into a Text field. A fresh conversion adopts
  // the input's current text (so connecting never wipes a running prompt); a
  // re-wire keeps the text the user typed.
  if (t === "STRING") {
    const fresh = s.type !== "text";
    s.type = "text";
    ensureText(s);
    if (fresh) {
      const w = target?.widgets?.find((x) => x.name === twname);
      if (typeof w?.value === "string") s.value = w.value;
    }
    if (twname && (s.name === `Value ${slotIndex + 1}` || s.autoName)) {
      s.name = String(twname).replace(/_/g, " ");
      s.autoName = true;
    }
    ensureText(s);
    syncOutputs(node);
    return true;
  }

  // A picker (combo) target turns the row into a Dropdown that adopts the
  // picker's whole option list (samplers, schedulers, checkpoints, ...).
  const cwname = inp?.widget?.name || inp?.name;
  const comboOpts = comboOptionsOf(target, cwname);
  if (comboOpts && comboOpts.length) {
    s.type = "combo";
    s.options = comboOpts;
    if (!Array.isArray(s.allowed)) s.allowed = [];
    const cw = target?.widgets?.find((x) => x.name === cwname);
    const cur = (cw && typeof cw.value === "string" && comboOpts.includes(cw.value)) ? cw.value : comboOpts[0];
    s.value = cur;
    s.def = cur;
    ensureCombo(s);
    if (cwname && (s.name === `Value ${slotIndex + 1}` || s.autoName)) {
      s.name = String(cwname).replace(/_/g, " ");
      s.autoName = true;
    }
    syncOutputs(node);
    return true;
  }

  // Number target: only an as-yet-untyped (auto) row resolves; a row already set
  // to int/float keeps its type and range. A disconnect drops a number slider
  // back to auto (resetRowOnDisconnect), so re-wiring it re-resolves cleanly.
  if (s.type !== "auto") return false;
  if (t !== "INT" && t !== "FLOAT") return false;

  // An INT input named like "seed" becomes a Seed control (randomize), not a slider.
  if (t === "INT" && /seed/i.test(cwname || "")) {
    s.type = "seed";
    const cur = Number(target?.widgets?.find((x) => x.name === cwname)?.value);
    s.value = Number.isFinite(cur) ? Math.floor(cur) : randomSeed();
    s.mode = "fixed";
    ensureSeed(s);
    if (cwname && (s.name === `Value ${slotIndex + 1}` || s.autoName)) {
      s.name = String(cwname).replace(/_/g, " ");
      s.autoName = true;
    }
    syncOutputs(node);
    return true;
  }

  s.type = t === "INT" ? "int" : "float";

  // The widget behind that input carries the real limits.
  const wname = inp?.widget?.name || inp?.name;
  const w = target?.widgets?.find((x) => x.name === wname);
  const o = w?.options || {};

  // Adopt the target's range only when the row's range is still the default
  // 0..1 / 0.01 - NAME-INDEPENDENT (a name adopted from an earlier connection
  // must not block range adoption on a later number conversion).
  if (Number(s.min) === 0 && Number(s.max) === 1 && Number(s.step) === 0.01) {
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
  } else if (s.type === "int") {
    if (!Number.isFinite(Number(s.step)) || Number(s.step) < 1) s.step = 1;
    s.min = Math.round(Number(s.min) || 0);
    s.max = Math.round(Number(s.max) || 0);
  }

  // The name follows whatever the row is plugged into, unless the user set their
  // own (autoName is cleared when they rename it in the settings). This is why
  // re-wiring a "seed" slider onto a boolean renames it to that input, not "seed".
  if (wname && (s.name === `Value ${slotIndex + 1}` || s.autoName)) {
    s.name = String(wname).replace(/_/g, " ");
    s.autoName = true;
  }

  s.value = clampValue(s, s.value);
  syncOutputs(node);
  return true;
}

// When an output loses its LAST wire, free the row so it can be re-wired to a
// different kind of input: a slider you unplug from a number can then go onto a
// boolean and become a switch. A number slider drops back to "auto" (its output
// slot returns to "*", so a boolean input will now accept it); a toggle stays a
// toggle but forgets its adopted bool/int so it re-adopts on the next wire. Only
// the type/out is touched - never the name, range, value or labels the user set.
// Gated by the caller on !configuring && !isGraphLoading, so a workflow load
// (which never replays disconnects) can't trip it.
export function resetRowOnDisconnect(node, slotIndex, prevTarget) {
  const st = readState(node);
  const s = st.sliders[slotIndex];
  if (!s) return false;
  const o = node.outputs?.[slotIndex];
  if (o && Array.isArray(o.links) && o.links.length > 0) return false; // still wired elsewhere
  if (s.type === "auto") return false;
  // Remember the kind AND the exact input we were unplugged from (RUNTIME only,
  // never serialized) so a replug to that SAME input restores the type and KEEPS
  // the value the user set (resolveAutoType reads both); a re-wire elsewhere
  // re-adopts fresh. Then drop the row to "auto" so its output slot returns to
  // "*" and it can be re-wired to ANY input - a seed's INT slot / a toggle's
  // BOOLEAN slot would otherwise refuse a wire to a different family. All the
  // OTHER fields (value, labels, options, seed mode) are left untouched.
  (node._pixWasType = node._pixWasType || {})[slotIndex] = s.type;
  (node._pixWasTarget = node._pixWasTarget || {})[slotIndex] =
    prevTarget && prevTarget.id != null ? { id: prevTarget.id, slot: prevTarget.slot } : null;
  s.type = "auto";
  syncOutputs(node);
  return true;
}
