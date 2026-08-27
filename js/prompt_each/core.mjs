// Prompt Each Pixaroma - state.
//
// Everything the node remembers lives on node.properties.promptEachState, which
// LiteGraph serialises into the workflow for free (Vue Compat #9). The Python
// side receives it as the hidden PromptEachState string, injected by the
// graphToPrompt hook in index.js.
//
// readState NEVER writes. It hands back a healed COPY, so opening a workflow
// whose blob is old or hand-edited cannot flag the file modified (Vue Compat
// #18) - the same read-only shape Save Text uses.

export const STATE_PROP = "promptEachState";

export const SPLIT_LINE = "line";
export const SPLIT_BLANK = "blank";
const SPLITS = [SPLIT_LINE, SPLIT_BLANK];

export const WIRED_REPLACE = "replace";
export const WIRED_ADD = "add";
const WIRED = [WIRED_REPLACE, WIRED_ADD];

export const DEFAULT_CAP = 200;
export const MAX_CAP = 4096;

export function defaultState() {
  return {
    version: 1,
    text: "",
    split: SPLIT_LINE,
    expand: true,
    trim: true,
    skipEmpty: true,
    cap: DEFAULT_CAP,
    wiredMode: WIRED_REPLACE,
  };
}

// Returns a healed copy. Every field is type-checked: the blob is serialised
// into a file people edit by hand and share, so a wrong type must produce the
// default rather than a broken node.
export function readState(node) {
  const st = defaultState();
  const raw = node?.properties?.[STATE_PROP];
  if (!raw || typeof raw !== "object") return st;

  if (typeof raw.text === "string") st.text = raw.text;
  if (SPLITS.indexOf(raw.split) !== -1) st.split = raw.split;
  if (WIRED.indexOf(raw.wiredMode) !== -1) st.wiredMode = raw.wiredMode;
  for (const key of ["expand", "trim", "skipEmpty"]) {
    if (typeof raw[key] === "boolean") st[key] = raw[key];
  }
  if (typeof raw.cap === "number" && isFinite(raw.cap)) {
    st.cap = Math.max(0, Math.min(MAX_CAP, Math.floor(raw.cap)));
  }
  return st;
}

export function writeState(node, st) {
  if (!node) return;
  node.properties = node.properties || {};
  node.properties[STATE_PROP] = st;
}

// Seed the default ONLY when the property is absent. A saved workflow always
// carries it, so this can never write on the load path.
export function restoreFromProperties(node) {
  if (!node) return;
  node.properties = node.properties || {};
  if (!node.properties[STATE_PROP] || typeof node.properties[STATE_PROP] !== "object") {
    node.properties[STATE_PROP] = defaultState();
  }
}
