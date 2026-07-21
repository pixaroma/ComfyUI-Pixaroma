// Text Join Pixaroma - shared state + constants (imported by index.js / fields.mjs
// / settings.mjs).
//
// The separator + skip-empty choice lives on node.properties.textJoinState
// (LiteGraph serializes it natively) and is injected into the hidden JoinState
// input by the graphToPrompt hook in index.js (Vue Compat #9). The text VALUES
// live on the node's own hidden STRING widgets (text_1..) and are injected the
// same way, exactly like Outpaint Stitch Pixaroma's sliders.

import { app } from "/scripts/app.js";

export const BRAND = "#f66744";
export const STATE_PROP = "textJoinState";
export const HIDDEN_INPUT = "JoinState";                 // matches the Python key
export const DEFAULTS_SETTING = "Pixaroma.TextJoin.Defaults";

// The separator picker options. `key` is stored; the actual string put between
// pieces is resolved in Python (_SEP_MAP) so the two never drift.
export const SEP_OPTIONS = [
  { key: "comma", label: "Comma", hint: "a comma and a space" },
  { key: "space", label: "Space", hint: "a single space" },
  { key: "newline", label: "New line", hint: "a line break" },
  { key: "none", label: "None", hint: "joined with nothing between" },
  { key: "custom", label: "Custom", hint: "type your own separator" },
];

export const MAX_FIELDS = 4;          // Text Join Four is the largest
// `labels` are per-field custom names (cosmetic, UI-only). They live in the
// persisted state but are DROPPED from promptState (below), so renaming a field
// never changes the injected JoinState and never re-runs the node.
export const DEFAULT_STATE = { sep: "comma", customSep: "", skipEmpty: true, labels: [] };

// Normalize to a clean state. The execution keys (sep/customSep/skipEmpty) plus
// the cosmetic `labels` array; promptState (below) keeps only the execution keys
// so the injected JoinState stays cache-stable
// (reference_cosmetic_key_in_injected_state_recaches).
function normalize(st) {
  const s = { ...DEFAULT_STATE, ...(st || {}) };
  if (!SEP_OPTIONS.some((o) => o.key === s.sep)) s.sep = "comma";
  const labels = Array.isArray(s.labels)
    ? s.labels.slice(0, MAX_FIELDS).map((x) => (typeof x === "string" ? x : ""))
    : [];
  return {
    sep: s.sep,
    customSep: typeof s.customSep === "string" ? s.customSep : "",
    skipEmpty: !!s.skipEmpty,
    labels,
  };
}

// The custom label for field index i (0-based), else the given default ("text N").
export function labelFor(state, i, fallback) {
  const v = state && state.labels ? state.labels[i] : null;
  return (typeof v === "string" && v.trim()) ? v.trim() : fallback;
}

// Fresh-node defaults: the user's saved global default, else the built-ins.
export function defaultState() {
  try {
    const g = app.ui?.settings?.getSettingValue?.(DEFAULTS_SETTING);
    if (typeof g === "string" && g) return normalize(JSON.parse(g));
  } catch { /* ignore */ }
  return { ...DEFAULT_STATE };
}

// Read a node's state. Falls back to the global default when the node has no
// saved state yet - and NEVER writes on the read/load path, so a clean workflow
// stays clean (Vue Compat #18).
export function readState(node) {
  const v = node?.properties?.[STATE_PROP];
  if (typeof v === "string" && v) {
    try { return normalize(JSON.parse(v)); } catch { /* fall through */ }
  }
  return defaultState();
}

export function writeState(node, state) {
  if (!node.properties) node.properties = {};
  const st = normalize(state);
  node.properties[STATE_PROP] = JSON.stringify(st);
  return st;
}

// The state to INJECT / cache on (index.js graphToPrompt). Drops customSep when
// the separator isn't "custom" so two comma nodes with different leftover custom
// text still hash identically and don't needlessly re-run. node.properties keeps
// the full customSep so switching back to Custom restores what you typed.
export function promptState(node) {
  const st = readState(node);
  return {
    sep: st.sep,
    customSep: st.sep === "custom" ? st.customSep : "",
    skipEmpty: st.skipEmpty,
  };
}

export async function saveGlobalDefault(state) {
  try {
    await app.ui.settings.setSettingValueAsync(
      DEFAULTS_SETTING, JSON.stringify(normalize(state)));
  } catch { /* ignore */ }
}

// The node's own STRING widget behind a field name (text_1 / text_2 / text_3),
// hidden by fields.mjs but still the value store.
export function widgetOf(node, name) {
  return node.widgets?.find((w) => w.name === name) || null;
}
