// Switch Source Pixaroma - state + slot management (DOM-free).
//
// Two stacked banks: inputs are ordered a_1..a_N (A block) then b_1..b_N (B
// block); outputs are output_1..output_N. So a_r and output_r share band r-1
// (they line up); b_r is band N+r-1. Input labels are native "A"/"B"; output
// labels are the editable row name (falling back to the wire type, then
// "out r"). The visible row count is set by the Rows field, NOT by wiring.
//
// State: node.properties.switchSourceState =
//   { version, active:"A"|"B", rows:N, missing:"connected"|"strict",
//     labels:{ [rowIndex1]: "name" } }

import { app } from "/scripts/app.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";

export const STATE_PROP = "switchSourceState";
export const MAX_ROWS = 16;
export const ROW_H = 20;   // LiteGraph NODE_SLOT_HEIGHT
export const TOP_PAD = 4;  // LiteGraph body top-padding
const BOT_PAD = 8;
export const CONTROL_BAND = 95; // reserved height for the DOM control strip
                                // (label stacked above the toggle = 1 extra row)
const DEFAULT_W = 250;

const A_NAME = (r) => `a_${r}`;
const B_NAME = (r) => `b_${r}`;
const OUT_NAME = (r) => `output_${r}`;

function defaultState() {
  return { version: 1, active: "A", rows: 1, missing: "connected", labels: {} };
}

export function readState(node) {
  if (!node.properties) node.properties = {};
  let s = node.properties[STATE_PROP];
  if (!s || typeof s !== "object") {
    s = defaultState();
    node.properties[STATE_PROP] = s;
  }
  // Defensive normalisation (hand-edited JSON / older saves).
  if (s.active !== "A" && s.active !== "B") s.active = "A";
  if (typeof s.rows !== "number" || s.rows < 1) s.rows = 1;
  s.rows = Math.min(MAX_ROWS, Math.round(s.rows));
  if (s.missing !== "connected" && s.missing !== "strict") s.missing = "connected";
  if (!s.labels || typeof s.labels !== "object") s.labels = {};
  return s;
}

export function writeState(node, state) {
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = state;
}

function linked(slot) {
  return slot != null && slot.link != null;
}
// Output slots hold their connections in slot.links (an array), NOT slot.link.
function outputLinked(slot) {
  return slot != null && Array.isArray(slot.links) && slot.links.length > 0;
}
function inputByName(node, name) {
  return (node.inputs || []).find((s) => s.name === name) || null;
}
function outputByName(node, name) {
  return (node.outputs || []).find((s) => s.name === name) || null;
}

// Row count = number of output slots (one output per row).
export function rowCount(node) {
  return node.outputs?.length || 0;
}

// Highest row index that has any wire (A input, B input, or output). The Rows
// field can never shrink below this (disconnect first to remove a row).
export function highestWiredRow(node) {
  let hi = 0;
  const n = rowCount(node);
  for (let r = 1; r <= n; r++) {
    if (linked(inputByName(node, A_NAME(r))) ||
        linked(inputByName(node, B_NAME(r))) ||
        outputLinked(outputByName(node, OUT_NAME(r)))) {
      hi = r;
    }
  }
  return hi;
}

// Vue Compat #3: graph.links may be a Map.
function getLink(graph, linkId) {
  if (linkId == null) return null;
  let link = graph?.links?.[linkId];
  if (!link && typeof graph?.links?.get === "function") link = graph.links.get(linkId);
  return link || null;
}

function upstreamType(node, slotName) {
  const slot = inputByName(node, slotName);
  const link = getLink(node.graph, slot?.link);
  if (!link) return null;
  const up = node.graph?.getNodeById?.(link.origin_id);
  return up?.outputs?.[link.origin_slot]?.type || null;
}

export function updateInputLabels(node) {
  const n = rowCount(node);
  for (let r = 1; r <= n; r++) {
    const a = inputByName(node, A_NAME(r));
    const aLabel = `A${r}`;
    if (a && a.label !== aLabel) a.label = aLabel;
    const b = inputByName(node, B_NAME(r));
    const bLabel = `B${r}`;
    if (b && b.label !== bLabel) b.label = bLabel;
  }
}

// Output label = custom row name, else the active-side (then other-side) wire
// type, else "out r". Output type adopts the resolved wire type so downstream
// type checks pass. Load-race guard (Vue Compat #18): never downgrade a wired
// output to "*" when the type can't be resolved yet.
// Clip a long display label so it can't overflow the node frame. Native output
// labels are right-aligned and otherwise extend past both edges of the node
// (a long custom row name spilled across the whole graph). The FULL name stays
// in state.labels[r]; only the on-canvas text is clipped. Width-aware so a
// wider node shows more, and deterministic for a given size (so recomputing it
// on load matches the saved value and never falsely dirties the workflow).
function clipLabel(node, s) {
  if (typeof s !== "string") return s;
  const w = node.size?.[0] || DEFAULT_W;
  const maxChars = Math.max(8, Math.floor((w - 95) / 8));
  return s.length > maxChars ? s.slice(0, maxChars - 1) + "…" : s;
}

export function updateOutputLabels(node) {
  const state = readState(node);
  const active = state.active;
  const n = rowCount(node);
  for (let r = 1; r <= n; r++) {
    const out = outputByName(node, OUT_NAME(r));
    if (!out) continue;
    const activeName = active === "A" ? A_NAME(r) : B_NAME(r);
    const otherName = active === "A" ? B_NAME(r) : A_NAME(r);
    const hasLink = linked(inputByName(node, activeName)) || linked(inputByName(node, otherName));
    const t = upstreamType(node, activeName) || upstreamType(node, otherName);
    const custom = state.labels?.[r];

    if (t && t !== "*") {
      if (out.type !== t) out.type = t;
      const lbl = clipLabel(node, custom || t);
      if (out.label !== lbl) out.label = lbl;
    } else if (!hasLink) {
      if (out.type !== "*") out.type = "*";
      const lbl = clipLabel(node, custom || `out ${r}`);
      if (out.label !== lbl) out.label = lbl;
    } else {
      // Wired but type unresolved (load race): keep saved type; only fix label.
      const lbl = clipLabel(node, custom || out.label || `out ${r}`);
      if (out.label !== lbl) out.label = lbl;
    }
  }
}

// Min node height for a given row count. ONE place for the formula so the
// resizeToRows write and the onDrawForeground/onResize self-heal (index.js)
// can never disagree.
export function minNodeHeight(rows) {
  return TOP_PAD + rows * 2 * ROW_H + CONTROL_BAND + BOT_PAD;
}

function resizeToRows(node, rows) {
  // Never write node.size during a workflow load / tab switch / Ctrl+Z undo:
  // configure() restores the saved size, and a write here would falsely flag
  // the workflow "modified" so just opening+closing it pops "Save Changes?"
  // (Vue Compat #18/#19). Fresh drops + genuine Rows-field changes still size.
  if (isGraphLoading()) return;
  const h = minNodeHeight(rows);
  const w = Math.max(node.size[0] || 0, DEFAULT_W);
  if (node.size[0] !== w) node.size[0] = w;
  if (node.size[1] !== h) node.size[1] = h;
}

export function clearAllSlots(node) {
  if (node.inputs) for (let i = node.inputs.length - 1; i >= 0; i--) node.removeInput(i);
  if (node.outputs) for (let i = node.outputs.length - 1; i >= 0; i--) node.removeOutput(i);
}

// Rebuild the slot set to exactly `rows` rows in two-bank order, PRESERVING
// existing links by snapshotting each wired slot's endpoint (by name) and
// reconnecting after. addInput/addOutput only append, so re-adding in the
// desired order is the only way to keep a_1..a_N then b_1..b_N; reconnecting by
// name keeps the user's wires. Gated by _pixSsRebuilding so the disconnect/
// connect events fired here don't re-enter onConnectionsChange on this node.
export function rebuildSlots(node, targetRows) {
  // Self-enforce the no-drop-a-wired-row invariant here (not just in the UI
  // handler) so any caller is safe: never shrink below the highest wired row.
  const hw = highestWiredRow(node);
  const rows = Math.min(MAX_ROWS, Math.max(1, Math.round(targetRows) || 1, hw));
  node._pixSsRebuilding = true;
  try {
    // Snapshot input links by slot name.
    const inSnap = [];
    for (const s of (node.inputs || [])) {
      const link = getLink(node.graph, s.link);
      if (link) inSnap.push({ name: s.name, originId: link.origin_id, originSlot: link.origin_slot });
    }
    // Snapshot output links by slot name.
    const outSnap = [];
    for (const o of (node.outputs || [])) {
      const links = Array.isArray(o.links) ? o.links : [];
      const targets = [];
      for (const lid of links) {
        const link = getLink(node.graph, lid);
        if (link) targets.push({ targetId: link.target_id, targetSlot: link.target_slot });
      }
      if (targets.length) outSnap.push({ name: o.name, targets });
    }

    clearAllSlots(node);

    for (let r = 1; r <= rows; r++) { const s = node.addInput(A_NAME(r), "*"); s.label = `A${r}`; }
    for (let r = 1; r <= rows; r++) { const s = node.addInput(B_NAME(r), "*"); s.label = `B${r}`; }
    for (let r = 1; r <= rows; r++) { node.addOutput(OUT_NAME(r), "*"); }

    // Reconnect inputs whose slot still exists.
    for (const e of inSnap) {
      const idx = (node.inputs || []).findIndex((s) => s.name === e.name);
      if (idx < 0) continue;
      const up = node.graph?.getNodeById?.(e.originId);
      if (up && typeof up.connect === "function") up.connect(e.originSlot, node, idx);
    }
    // Reconnect outputs whose slot still exists.
    for (const e of outSnap) {
      const oidx = (node.outputs || []).findIndex((o) => o.name === e.name);
      if (oidx < 0) continue;
      for (const t of e.targets) {
        const down = node.graph?.getNodeById?.(t.targetId);
        if (down && typeof node.connect === "function") node.connect(oidx, down, t.targetSlot);
      }
    }
  } finally {
    node._pixSsRebuilding = false;
  }

  const state = readState(node);
  if (state.rows !== rows) { state.rows = rows; writeState(node, state); }
  // Drop custom labels for rows that no longer exist.
  if (state.labels) {
    for (const k of Object.keys(state.labels)) {
      const ri = parseInt(k, 10);
      if (!Number.isFinite(ri) || ri < 1 || ri > rows) delete state.labels[k];
    }
  }
  updateInputLabels(node);
  updateOutputLabels(node);
  resizeToRows(node, rows);
  app.graph?.setDirtyCanvas?.(true, true);
}

// Build exactly `rows` rows of bare slots in two-bank order (no link work).
function buildBareRows(node, rows) {
  node._pixSsRebuilding = true;
  try {
    for (let r = 1; r <= rows; r++) { const s = node.addInput(A_NAME(r), "*"); s.label = `A${r}`; }
    for (let r = 1; r <= rows; r++) { const s = node.addInput(B_NAME(r), "*"); s.label = `B${r}`; }
    for (let r = 1; r <= rows; r++) { node.addOutput(OUT_NAME(r), "*"); }
  } finally {
    node._pixSsRebuilding = false;
  }
  updateInputLabels(node);
  updateOutputLabels(node);
  resizeToRows(node, rows);
}

// Strip the raw Python-declared slots (a_1..a_16, b_1..b_16, 16 outputs). Safe
// here: onNodeCreated runs before any links are restored.
//
// On a workflow LOAD / tab switch / undo, leave the node EMPTY and let
// LGraphNode.configure() restore the saved slots (a_1..a_N, b_1..b_N,
// output_1..N) in their saved two-bank order, with their links. Pre-building
// stub rows here (state.rows defaults to 1 before properties are restored)
// would make configure MERGE the saved extras onto the stubs and scramble the
// order to A B A B - which is why the old code wiped slots in onConfigure, and
// that wipe was destroying the just-restored wires on every tab switch. With
// onConfigure no longer wiping, the load path must not pre-create conflicting
// slots. Fresh drops (not loading) build immediately.
export function setupNode(node) {
  clearAllSlots(node);
  // ALWAYS defer the build to a microtask - never build synchronously here.
  // If this node is being restored from saved data (workflow load, tab switch,
  // undo, OR copy-paste), LGraphNode.configure() runs synchronously right after
  // onNodeCreated and re-adds the saved slots in their saved two-bank order onto
  // the now-empty node (so no A-B-A-B scramble), setting _pixSsConfigureRan.
  // The microtask then no-ops. Only a genuine fresh drop (no configure follows)
  // reaches the build. Microtasks flush before the first paint, so the build is
  // in place before the node is ever drawn - no visible flash. (Paste does NOT
  // go through app.loadGraphData, so an isGraphLoading() gate could not cover it;
  // letting configure win via the flag covers every restore path uniformly.)
  queueMicrotask(() => {
    if (node._pixSsConfigureRan) return;          // configure restored the slots
    if (node.inputs && node.inputs.length) return; // already populated
    buildBareRows(node, readState(node).rows);
    node.graph?.setDirtyCanvas?.(true, true);
  });
}

// Workflow load / undo restore: configure() already restored node.inputs,
// node.outputs (in two-bank order) and node.properties. Just re-assert labels
// and types - do NOT rebuild (that would disturb the restored links).
export function restoreFromProperties(node) {
  updateInputLabels(node);
  updateOutputLabels(node);
}

// ── Geometry for the editable output label (used by editor.mjs + index.js) ──

// Y centre (node-body-local) of output row's band. rowIdx0 = 0-based.
export function outputBandY(rowIdx0) {
  return TOP_PAD + rowIdx0 * ROW_H + ROW_H / 2;
}

// Node-body-local rect of the clickable output-label area for row rowIdx1
// (1-based). Sits left of the output dot on the right edge.
export function outputLabelRect(node, rowIdx1) {
  const cy = outputBandY(rowIdx1 - 1);
  const w = node.size?.[0] || DEFAULT_W;
  const right = w - 18; // just left of the output dot's drag zone
  // Native output labels are right-aligned, so hug the text from the right
  // edge rather than spanning the whole right half (which left dead space on
  // the left with no visible label to click). Width is estimated from the
  // label string (~7px/char at the default slot font): short names get a
  // small target, long type names a wider one. Floored so it never reaches
  // across into the A-input dot on the left of the same band.
  const out = outputByName(node, OUT_NAME(rowIdx1));
  const text = (out && out.label) || `out ${rowIdx1}`;
  const approx = text.length * 7 + 14;
  const floor = Math.max(w * 0.45, 60);
  let left = right - approx;
  if (left < floor) left = floor;
  return { x: left, y: cy - ROW_H / 2, w: Math.max(0, right - left), h: ROW_H };
}

export function pointInRect(pos, r) {
  return pos[0] >= r.x && pos[0] <= r.x + r.w && pos[1] >= r.y && pos[1] <= r.y + r.h;
}

// Convert an output-label rect to viewport pixels for the DOM editor overlay.
export function outputLabelScreenRect(node, rowIdx1) {
  const r = outputLabelRect(node, rowIdx1);
  const ds = app.canvas?.ds;
  const scale = ds?.scale || 1;
  const offX = ds?.offset?.[0] || 0;
  const offY = ds?.offset?.[1] || 0;
  const canvasEl = app.canvas?.canvas;
  const cr = canvasEl ? canvasEl.getBoundingClientRect() : { left: 0, top: 0 };
  const baseLeft = cr.left + offX * scale;
  const baseTop = cr.top + offY * scale;
  return {
    x: baseLeft + (node.pos[0] + r.x) * scale,
    y: baseTop + (node.pos[1] + r.y) * scale,
    w: r.w * scale,
    h: r.h * scale,
  };
}
