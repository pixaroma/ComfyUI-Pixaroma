// LoRA Loader Pixaroma - shared state + helpers (imported by every module here).
//
// State lives on node.properties.loraLoaderState (LiteGraph serializes it natively)
// and is injected into the hidden LoraLoaderState input by the graphToPrompt hook
// in index.js (Vue Compat #9). Python reads the loras + separator back and applies
// each switched-on LoRA, and joins the picked trigger words into the triggers output.

import { app } from "/scripts/app.js";

export const BRAND = "#f66744";
export const STATE_PROP = "loraLoaderState";
export const HIDDEN_INPUT = "LoraLoaderState"; // matches the Python INPUT_TYPES key
export const DEFAULTS_SETTING = "Pixaroma.LoraLoader.Defaults";

export const MAX_LORAS = 64;
export const MIN_STRENGTH = -10;
export const MAX_STRENGTH = 10;

// Per-node preferences that new nodes inherit from the saved default (one JSON blob
// in the DEFAULTS_SETTING). Everything else in the state is per-node data.
export const DEFAULT_PREFS = {
  sep: ", ",          // how trigger words are joined for the output
  step: 0.05,         // arrow / scrub step for the weight
  defStrength: 1.0,   // strength a freshly added LoRA starts at
  linkStrength: true, // one strength drives both model + clip
  civitai: true,      // allow the optional Civitai lookup button
  thumbs: true,       // show preview thumbnails in the info panel
  accent: null,       // highlight colour; null = the Pixaroma orange
};

export const DEFAULT_STATE = {
  version: 1,
  loras: [], // { id, name, on, sm, sc, triggers:[] }
  ...DEFAULT_PREFS,
};

let _idc = 0;
export function newId() {
  try { if (crypto?.randomUUID) return "l" + crypto.randomUUID().slice(0, 8); } catch {}
  return "l" + Date.now().toString(36) + (_idc++).toString(36);
}

function num(v, dflt) {
  const f = parseFloat(v);
  if (!Number.isFinite(f)) return dflt;
  return f;
}
export function clampStrength(v) {
  const f = num(v, 0);
  return Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, f));
}
// Round a strength to 2 decimals for display / storage (kills float dust).
export function roundStrength(v) {
  return Math.round(clampStrength(v) * 100) / 100;
}

function normLora(e, prefs) {
  if (!e || typeof e !== "object") return null;
  const name = typeof e.name === "string" ? e.name : "";
  const sm = roundStrength(e.sm != null ? e.sm : (e.strength != null ? e.strength : prefs.defStrength));
  const sc = roundStrength(e.sc != null ? e.sc : sm);
  return {
    id: typeof e.id === "string" && e.id ? e.id : newId(),
    name,
    on: e.on == null ? true : !!e.on,
    sm,
    sc,
    triggers: Array.isArray(e.triggers)
      ? e.triggers.map((w) => String(w)).filter((w) => w.trim()).slice(0, 64)
      : [],
  };
}

function normalize(raw) {
  const st = { ...DEFAULT_STATE, ...(raw && typeof raw === "object" ? raw : {}) };
  if (typeof st.sep !== "string") st.sep = DEFAULT_PREFS.sep;
  st.step = num(st.step, DEFAULT_PREFS.step);
  if (st.step <= 0) st.step = DEFAULT_PREFS.step;
  st.defStrength = roundStrength(st.defStrength);
  st.linkStrength = st.linkStrength == null ? true : !!st.linkStrength;
  st.civitai = st.civitai == null ? true : !!st.civitai;
  st.thumbs = st.thumbs == null ? true : !!st.thumbs;
  if (st.accent != null && typeof st.accent !== "string") st.accent = null;
  st.loras = (Array.isArray(st.loras) ? st.loras : [])
    .map((e) => normLora(e, st))
    .filter(Boolean)
    .slice(0, MAX_LORAS);
  // Linked-strength invariant: when a single strength drives both, clip ALWAYS equals
  // model. Enforced on every write/load, so toggling "separate" off can never leave a
  // stale clip strength that would silently apply a mismatched CLIP weight at run time.
  if (st.linkStrength) st.loras.forEach((e) => { e.sc = e.sm; });
  // De-dup ids so a hand-edited / duplicated state can't make a row unreachable by id
  // (every id-based op uses find(), which would otherwise always hit the first match).
  const seenIds = new Set();
  for (const e of st.loras) {
    if (seenIds.has(e.id)) e.id = newId();
    seenIds.add(e.id);
  }
  return st;
}

export function readState(node) {
  const v = node.properties?.[STATE_PROP];
  if (typeof v === "string" && v) {
    try { return normalize(JSON.parse(v)); } catch { /* fall through */ }
  }
  return normalize({ ...DEFAULT_STATE, ...loadDefaults() });
}

export function writeState(node, state) {
  if (!node.properties) node.properties = {};
  const st = normalize(state);
  node.properties[STATE_PROP] = JSON.stringify(st);
  return st;
}

// ── mutations (each returns the fresh state) ─────────────────────────────────
export function addLora(node, name) {
  const st = readState(node);
  if (st.loras.length >= MAX_LORAS) return { ok: false, reason: "max", state: st };
  st.loras.push({
    id: newId(),
    name: name || "",
    on: true,
    sm: st.defStrength,
    sc: st.defStrength,
    triggers: [],
  });
  return { ok: true, state: writeState(node, st), index: st.loras.length - 1 };
}

export function removeLora(node, id) {
  const st = readState(node);
  const i = st.loras.findIndex((e) => e.id === id);
  if (i < 0) return null;
  st.loras.splice(i, 1);
  return writeState(node, st);
}

export function duplicateLora(node, id) {
  const st = readState(node);
  const i = st.loras.findIndex((e) => e.id === id);
  if (i < 0 || st.loras.length >= MAX_LORAS) return null;
  const clone = { ...st.loras[i], id: newId(), triggers: [...st.loras[i].triggers] };
  st.loras.splice(i + 1, 0, clone);
  return writeState(node, st);
}

export function moveLora(node, id, dir) {
  const st = readState(node);
  const i = st.loras.findIndex((e) => e.id === id);
  if (i < 0) return null;
  const j = i + dir;
  if (j < 0 || j >= st.loras.length) return null;
  const [m] = st.loras.splice(i, 1);
  st.loras.splice(j, 0, m);
  return writeState(node, st);
}

export function reorderLora(node, from, to) {
  const st = readState(node);
  const n = st.loras.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return null;
  const [m] = st.loras.splice(from, 1);
  st.loras.splice(to, 0, m);
  return writeState(node, st);
}

export function patchLora(node, id, patch) {
  const st = readState(node);
  const e = st.loras.find((x) => x.id === id);
  if (!e) return null;
  const oldName = e.name;
  const keepId = e.id;
  Object.assign(e, patch);
  e.id = keepId; // a patch must never change the row's identity
  if (patch.sm != null) e.sm = roundStrength(patch.sm);
  if (patch.sc != null) e.sc = roundStrength(patch.sc);
  // Picking a DIFFERENT LoRA clears the trigger words - they belonged to the old file
  // and would otherwise flow into the triggers output describing the wrong LoRA.
  if (patch.name != null && patch.name !== oldName) e.triggers = [];
  // When strengths are linked, a model-strength change mirrors to clip.
  if (st.linkStrength && patch.sm != null && patch.sc == null) e.sc = e.sm;
  return writeState(node, st);
}

export function setAllOn(node, on) {
  const st = readState(node);
  st.loras.forEach((e) => { e.on = !!on; });
  return writeState(node, st);
}

export function countOn(state) {
  return state.loras.reduce((a, e) => a + (e.on ? 1 : 0), 0);
}

// ── global defaults (one JSON blob so "Set as default" captures every pref) ──
export function loadDefaults() {
  try {
    const raw = app.ui?.settings?.getSettingValue(DEFAULTS_SETTING);
    if (raw) {
      const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (obj && typeof obj === "object") return obj;
    }
  } catch { /* ignore */ }
  return {};
}

export async function saveDefaults(prefs) {
  try {
    const keep = {};
    for (const k of Object.keys(DEFAULT_PREFS)) if (prefs[k] !== undefined) keep[k] = prefs[k];
    await app.ui.settings.setSettingValueAsync(DEFAULTS_SETTING, JSON.stringify(keep));
    return true;
  } catch { return false; }
}

// The EXECUTION-relevant subset that goes into the prompt. Python only reads the
// loras (name/on/sm/sc/triggers) and the separator, so cosmetic prefs (accent,
// thumbs, civitai, step, defStrength, linkStrength, id) are stripped - otherwise a
// colour pick or a settings toggle would change the node's cache signature and
// needlessly re-run it (documented recurring trap).
export function promptState(state) {
  return {
    version: 1,
    sep: state.sep,
    loras: state.loras.map((e) => ({
      name: e.name, on: !!e.on, sm: e.sm, sc: e.sc, triggers: e.triggers,
    })),
  };
}

export function accentOf(node) {
  const st = readState(node);
  if (st.accent) return st.accent;
  const d = loadDefaults();
  return (d && d.accent) || BRAND;
}
