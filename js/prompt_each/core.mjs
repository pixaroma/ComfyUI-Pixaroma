import { textToRows } from "./rows.mjs";

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

// Where wired prompts go relative to the rows. They are always ADDED, never a
// replacement; this only decides the order, which matters because `index` and
// the order images come out in follow it.
export const WIRED_AFTER = "after";
export const WIRED_BEFORE = "before";
const WIREDS = [WIRED_AFTER, WIRED_BEFORE];

export const SPLIT_LINE = "line";
export const SPLIT_BLANK = "blank";
const SPLITS = [SPLIT_LINE, SPLIT_BLANK];

// ROWS ARE THE STATE. They were briefly stored as one newline-delimited string
// with "#" marking a switched-off row, which worked while there was a Text view
// to justify it - and then quietly corrupted data once there was not: newline
// was the ROW SEPARATOR, so pressing Enter inside a row spawned phantom rows,
// typing wrote to the wrong index, and the content DUPLICATED on every keystroke
// (one row reading "cat" then Enter then "dog" became five prompts, then
// fifteen). A row's text is its own value and must never be joined and re-split.
//
// The string form survives only where it belongs: Copy, Paste, and the wired
// text input, all of which genuinely are one block of text.

export const DEFAULT_CAP = 200;
export const MAX_CAP = 4096;

export function defaultRow(text = "") {
  return { text, enabled: true };
}

export function defaultState() {
  return {
    version: 2,
    rows: [defaultRow()],
    split: SPLIT_LINE,
    expand: true,
    trim: true,
    skipEmpty: true,
    cap: DEFAULT_CAP,
    wiredAt: WIRED_AFTER,
  };
}

// Returns a healed copy. Every field is type-checked: the blob is serialised
// into a file people edit by hand and share, so a wrong type must produce the
// default rather than a broken node.
export function readState(node) {
  const st = defaultState();
  const raw = node?.properties?.[STATE_PROP];
  if (!raw || typeof raw !== "object") return st;

  if (Array.isArray(raw.rows)) {
    const rows = raw.rows
      .filter((r) => r && typeof r === "object")
      .map((r) => ({ text: typeof r.text === "string" ? r.text : "",
                     enabled: r.enabled !== false }));
    st.rows = rows.length ? rows : [defaultRow()];
  } else if (typeof raw.text === "string" && raw.text) {
    // a workflow saved by the very first build of this node
    st.rows = textToRows(raw.text, SPLITS.indexOf(raw.split) !== -1 ? raw.split : SPLIT_LINE);
  }
  if (SPLITS.indexOf(raw.split) !== -1) st.split = raw.split;
  if (WIREDS.indexOf(raw.wiredAt) !== -1) st.wiredAt = raw.wiredAt;
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
