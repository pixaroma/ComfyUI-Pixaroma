// Prompt Multi Pixaroma - state module.
//
// State lives on node.properties.promptMultiState.
// Shape: {
//   version: 2,
//   mode: "queue" | "list",
//   rows: [ { id, enabled, label, text } ],
//   activeIndex
// }
//
// LiteGraph serializes node.properties natively into workflow JSON, so save and
// reload are automatic. The graphToPrompt hook in index.js packs mode +
// activePrompt + rowTexts (only enabled rows) into the hidden
// PromptMultiState input at workflow-submit time. The queuePrompt patch in
// index.js mutates activeIndex right before each per-row enqueue (queue mode
// only) and short-circuits to one run in list mode.
//
// activeIndex is an absolute index into rows[] (not the enabled-filtered
// position), because the graphToPrompt hook does state.rows[activeIndex].text.
// The saved value on disk is whatever the last loop iteration left behind and
// is not relied on at workflow load - the next Run overwrites it before any
// prompt is captured.

export const STATE_PROP = "promptMultiState";
export const MODE_QUEUE = "queue";
export const MODE_LIST = "list";

let _idCounter = 0;
function nextId() {
  _idCounter += 1;
  return `r${Date.now().toString(36)}_${_idCounter}`;
}

export function freshRow(overrides = {}) {
  return {
    id: nextId(),
    enabled: true,
    label: "",
    text: "",
    ...overrides,
  };
}

export function defaultState() {
  // Two empty rows on a fresh node, both ON, so the "multi" idea is
  // immediately visible (matches the design doc).
  return {
    version: 2,
    mode: MODE_QUEUE,
    rows: [freshRow(), freshRow()],
    activeIndex: 0,
  };
}

export function readState(node) {
  const s = node.properties?.[STATE_PROP];
  if (!s || typeof s !== "object") return defaultState();
  if (!Array.isArray(s.rows) || s.rows.length === 0) return defaultState();
  // Defensive normalisation against hand-edited workflow JSON.
  for (const row of s.rows) {
    if (typeof row.id !== "string" || !row.id) row.id = nextId();
    if (typeof row.enabled !== "boolean") row.enabled = true;
    if (typeof row.label !== "string") row.label = "";
    if (typeof row.text !== "string") row.text = "";
  }
  if (typeof s.activeIndex !== "number" || s.activeIndex < 0 || s.activeIndex >= s.rows.length) {
    s.activeIndex = 0;
  }
  // Migration from v1 (no mode field): default to queue mode.
  if (s.mode !== MODE_QUEUE && s.mode !== MODE_LIST) s.mode = MODE_QUEUE;
  s.version = 2;
  return s;
}

export function setMode(node, mode) {
  if (mode !== MODE_QUEUE && mode !== MODE_LIST) return;
  const state = readState(node);
  state.mode = mode;
  writeState(node, state);
}

export function writeState(node, state) {
  node.properties = node.properties || {};
  node.properties[STATE_PROP] = state;
}

export function addRow(node) {
  const state = readState(node);
  state.rows.push(freshRow());
  writeState(node, state);
}

export function deleteRow(node, id) {
  const state = readState(node);
  if (state.rows.length <= 1) return;
  state.rows = state.rows.filter((r) => r.id !== id);
  if (state.activeIndex >= state.rows.length) state.activeIndex = state.rows.length - 1;
  writeState(node, state);
}

export function toggleEnabled(node, id) {
  const state = readState(node);
  const row = state.rows.find((r) => r.id === id);
  if (row) row.enabled = !row.enabled;
  writeState(node, state);
}

export function setLabel(node, id, label) {
  const state = readState(node);
  const row = state.rows.find((r) => r.id === id);
  if (row) row.label = String(label || "");
  writeState(node, state);
}

export function setText(node, id, text) {
  const state = readState(node);
  const row = state.rows.find((r) => r.id === id);
  if (row) row.text = String(text || "");
  writeState(node, state);
}

export function clearAllText(node) {
  const state = readState(node);
  for (const row of state.rows) row.text = "";
  writeState(node, state);
}

export function resetToDefault(node) {
  writeState(node, defaultState());
}

export function reorderRows(node, fromIdx, toIdx) {
  const state = readState(node);
  if (fromIdx === toIdx) return;
  if (fromIdx < 0 || fromIdx >= state.rows.length) return;
  if (toIdx < 0 || toIdx >= state.rows.length) return;
  const [moved] = state.rows.splice(fromIdx, 1);
  state.rows.splice(toIdx, 0, moved);
  writeState(node, state);
}

// Returns the rows whose enabled flag is true AND whose text has at least
// one non-whitespace character, paired with their absolute index in the rows
// array. Used by the queuePrompt loop in index.js. Empty/whitespace-only rows
// are silently skipped at queue time so users can leave placeholder rows in
// place without queuing meaningless runs.
export function enabledRowsWithIndex(node) {
  const state = readState(node);
  return state.rows
    .map((r, i) => ({ row: r, index: i }))
    .filter((x) => x.row.enabled && x.row.text && x.row.text.trim());
}

// restoreFromProperties: ensures node.properties.promptMultiState exists with
// defaults and applies the readState normalization.
export function restoreFromProperties(node) {
  writeState(node, readState(node));
}
