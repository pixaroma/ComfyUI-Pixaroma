// Mute Switch Pixaroma - state, slot management, and mute application.
//
// State shape: node.properties.muteSwitchState = {
//   version: 1,
//   selectMode: "single" | "multi",
//   muteMode:   "mute"   | "bypass",
//   rows: [{ enabled: boolean, label: string | null }, ...]
// }
//
// node.properties.muteSwitchOriginalModes = { "<nodeId>": <originalMode> }
//   captured at first mute; deleted on restore.

import { app } from "/scripts/app.js";
import { ROW_H, TOP_PAD, MODE_BAR_H, OUTPUT_X_INSET } from "./render.mjs";
import { resolveAllMutes } from "./upstream.mjs";

export const STATE_PROP = "muteSwitchState";
export const ORIGINAL_MODES_PROP = "muteSwitchOriginalModes";
export const MAX_INPUTS = 32;

const SLOT_NAME = (i) => `input_${i}`; // 1-based

const BOT_PAD = 8;
const DEFAULT_W = 280;
const MIN_BODY_H = MODE_BAR_H + ROW_H + BOT_PAD;

export function defaultState() {
  return {
    version: 1,
    selectMode: "multi",
    muteMode: "mute",
    rows: [],
  };
}

export function readState(node) {
  if (!node.properties) node.properties = {};
  if (!node.properties[STATE_PROP]) {
    node.properties[STATE_PROP] = defaultState();
  }
  const s = node.properties[STATE_PROP];
  if (!Array.isArray(s.rows)) s.rows = [];
  return s;
}

export function readOriginalModes(node) {
  if (!node.properties) node.properties = {};
  if (!node.properties[ORIGINAL_MODES_PROP]) {
    node.properties[ORIGINAL_MODES_PROP] = {};
  }
  return node.properties[ORIGINAL_MODES_PROP];
}

// Walk backwards to avoid index shifts.
function clearNativeInputs(node) {
  if (!node.inputs) return;
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    node.removeInput(i);
  }
}

function addInputSlot(node, idx1) {
  const slot = node.addInput(SLOT_NAME(idx1), "*");
  slot.label = "​"; // zero-width space: truthy, invisible
  return slot;
}

function computeNodeHeight(slotCount) {
  return MODE_BAR_H + TOP_PAD + slotCount * ROW_H + BOT_PAD;
}

// Idempotent normaliser. Trims trailing empties down to one, fills missing
// rows in state.rows, applies zero-width labels, sets size.
export function normalizeSlots(node) {
  if (!node.inputs) return;
  const state = readState(node);

  const beforeLen = node.inputs.length;

  let connected = 0;
  for (const s of node.inputs) if (s.link != null) connected++;

  const target = Math.min(
    Math.max(connected + (connected < MAX_INPUTS ? 1 : 0), 1),
    MAX_INPUTS,
  );

  while ((node.inputs.length || 0) > target) {
    const last = node.inputs[node.inputs.length - 1];
    if (last && last.link != null) break;
    node.removeInput(node.inputs.length - 1);
  }
  while ((node.inputs.length || 0) < target) {
    addInputSlot(node, node.inputs.length + 1);
  }

  for (let i = 0; i < node.inputs.length; i++) {
    const nm = SLOT_NAME(i + 1);
    if (node.inputs[i].name !== nm) node.inputs[i].name = nm;
    if (node.inputs[i].label !== "​") node.inputs[i].label = "​";
  }

  // Push each input dot down by MODE_BAR_H so it aligns with our row paint.
  // slot.pos = [x, y] is body-local. Vue Compat #16: this LG fork reads
  // slot.pos via calculateInputSlotPosFromSlot.
  for (let i = 0; i < node.inputs.length; i++) {
    const y = MODE_BAR_H + TOP_PAD + i * ROW_H + ROW_H / 2;
    node.inputs[i].pos = [10, y];
  }

  // Schema migration: workflows saved before the phantom "out" output was
  // added still have outputs: []. Re-add it. LiteGraph happily appends.
  if (!node.outputs || node.outputs.length === 0) {
    node.addOutput("out", "*");
  }
  // Suppress the "out" label (it would otherwise overlap with the mode bar
  // pill text) and pin the dot just below the mode bar.
  for (const out of node.outputs) {
    if (out.label !== "​") out.label = "​";
  }
  if (node.outputs[0]) {
    node.outputs[0].pos = [
      node.size[0] - OUTPUT_X_INSET,
      MODE_BAR_H + TOP_PAD + ROW_H / 2,
    ];
  }

  // Sync state.rows length to slot count.
  while (state.rows.length < node.inputs.length) {
    // New row default: ON in multi mode, OFF in single mode.
    const enabled = state.selectMode === "single" ? false : true;
    state.rows.push({ enabled, label: null });
  }
  while (state.rows.length > node.inputs.length) {
    state.rows.pop();
  }

  const w = Math.max(node.size[0] || 0, DEFAULT_W);
  if (node.size[0] !== w) node.size[0] = w;

  if (node.inputs.length !== beforeLen) {
    const h = computeNodeHeight(node.inputs.length);
    if (node.size[1] !== h) node.size[1] = h;
  }

  app.graph?.setDirtyCanvas?.(true, true);
}

export function setupNode(node) {
  clearNativeInputs(node);
  normalizeSlots(node);
  node.size[1] = Math.max(node.size[1], MIN_BODY_H);
}

export function restoreFromProperties(node) {
  normalizeSlots(node);
}

// Connect to a fresh slot. If the slot was just-disconnected (wire-replace),
// cancel that pending disconnect.
export function handleConnect(node, slotIdx1) {
  const state = readState(node);

  let wasReplace = false;
  if (node._pendingDisconnects?.has(slotIdx1)) {
    clearTimeout(node._pendingDisconnects.get(slotIdx1));
    node._pendingDisconnects.delete(slotIdx1);
    wasReplace = true;
  }

  // New row default: ON in multi mode, OFF in single mode. Only on a
  // fresh connect, not a wire-replace (which keeps existing enabled state).
  if (!wasReplace) {
    const row = state.rows[slotIdx1 - 1];
    if (row) {
      row.enabled = state.selectMode === "single" ? false : true;
    }

    // Grow the slot list if this was the trailing empty slot.
    const isLast = slotIdx1 === (node.inputs?.length || 0);
    if (isLast && (node.inputs?.length || 0) < MAX_INPUTS) {
      const newIdx1 = (node.inputs?.length || 0) + 1;
      addInputSlot(node, newIdx1);
      const enabled = state.selectMode === "single" ? false : true;
      state.rows.push({ enabled, label: null });
      // Update slot.pos for the freshly-added trailing slot too.
      const y = MODE_BAR_H + TOP_PAD + (newIdx1 - 1) * ROW_H + ROW_H / 2;
      node.inputs[newIdx1 - 1].pos = [10, y];
      node.size[1] = computeNodeHeight(node.inputs.length);
    }
  }

  applyMuteState(node);
  app.graph?.setDirtyCanvas?.(true, true);
}

export function handleDisconnect(node, slotIdx1) {
  if (!node._pendingDisconnects) node._pendingDisconnects = new Map();
  if (node._pendingDisconnects.has(slotIdx1)) {
    clearTimeout(node._pendingDisconnects.get(slotIdx1));
  }
  const timer = setTimeout(() => {
    node._pendingDisconnects.delete(slotIdx1);
    actuallyDisconnect(node, slotIdx1);
  }, 0);
  node._pendingDisconnects.set(slotIdx1, timer);
}

// ── Toggle helpers ───────────────────────────────────────────────────────
// These mutate state.rows / state.selectMode / state.muteMode and trigger
// applyMuteState. Task 5 ships a stub applyMuteState; Task 7 wires the real
// upstream walk + mode write.

export function togglePillRow(node, slotIdx1) {
  const state = readState(node);
  const row = state.rows[slotIdx1 - 1];
  if (!row) return;

  // Only operate on connected slots - clicking a trailing-empty pill is a no-op.
  const slot = node.inputs?.[slotIdx1 - 1];
  if (slot == null || slot.link == null) return;

  if (state.selectMode === "single") {
    // Single mode: clicking the currently-ON row is a no-op (invariant
    // forbids zero-ON). Clicking a different row turns it ON and turns
    // every other row OFF.
    if (row.enabled) return;
    for (let i = 0; i < state.rows.length; i++) {
      state.rows[i].enabled = (i === slotIdx1 - 1);
    }
  } else {
    row.enabled = !row.enabled;
  }
  applyMuteState(node);
  app.graph?.setDirtyCanvas?.(true, true);
}

export function setSelectMode(node, newMode /* "single" | "multi" */) {
  const state = readState(node);
  if (state.selectMode === newMode) return;
  state.selectMode = newMode;

  if (newMode === "single") {
    // Enforce "exactly one ON" invariant. Keep LOWEST-INDEX wired ON row;
    // turn every other row OFF.
    let firstOnIdx = -1;
    for (let i = 0; i < state.rows.length; i++) {
      const connected = node.inputs?.[i]?.link != null;
      if (connected && state.rows[i].enabled) {
        firstOnIdx = i;
        break;
      }
    }
    if (firstOnIdx === -1) {
      // No row was ON - activate the first WIRED row.
      for (let i = 0; i < state.rows.length; i++) {
        if (node.inputs?.[i]?.link != null) {
          firstOnIdx = i;
          break;
        }
      }
    }
    for (let i = 0; i < state.rows.length; i++) {
      state.rows[i].enabled = (i === firstOnIdx);
    }
  }
  applyMuteState(node);
  app.graph?.setDirtyCanvas?.(true, true);
}

export function setMuteMode(node, newMode /* "mute" | "bypass" */) {
  const state = readState(node);
  if (state.muteMode === newMode) return;
  state.muteMode = newMode;
  applyMuteState(node);
  app.graph?.setDirtyCanvas?.(true, true);
}

// v2: mute ONLY the directly wired upstream node (not the whole upstream
// chain). ComfyUI's executor is lazy - it skips any node whose output is
// not consumed by a non-muted output node, so the rest of the upstream
// branch is skipped automatically.
//
// Chaining: when the directly wired upstream IS another Mute Switch,
// cascade through it - mute that switch AND every node wired into IT.
// Recursive, cycle-protected (see upstream.mjs::cascadeMuteSet).
//
// Coordination across multiple Mute Switches in the same graph:
// resolveAllMutes computes the UNION of every switch's wantMuted set, so
// any switch's "OFF" wins over another switch's "ON" for the same node.
// originalModes is distributed across switches - whichever switch first
// muted a node owns its original mode. The cleanup pass restores nodes
// no longer wanted by ANY switch.
export function applyMuteState(node) {
  if (!node.graph) return;
  if (node._pixMsConfiguring) return;
  applyAllMuteSwitches(node.graph);
}

function isMuteSwitchNode(n) {
  return n != null && (n.type === "PixaromaMuteSwitch" || n.comfyClass === "PixaromaMuteSwitch");
}

function findAllMuteSwitches(graph, excludeId /* optional */) {
  const out = [];
  const nodes = graph?._nodes || graph?.nodes || [];
  for (const n of nodes) {
    if (!n || !isMuteSwitchNode(n)) continue;
    if (excludeId != null && n.id === excludeId) continue;
    out.push(n);
  }
  return out;
}

// Graph-wide recompute. Walks every Mute Switch in the graph, computes the
// union of want-muted node IDs, then writes node.mode for every affected
// node. originalModes is preserved across switches via the "first one to
// save wins" rule below.
export function applyAllMuteSwitches(graph, excludeId /* optional */) {
  if (!graph) return;
  const switches = findAllMuteSwitches(graph, excludeId);

  const allNodes = graph._nodes || graph.nodes || [];
  const nodesById = {};
  for (const n of allNodes) {
    if (n && n.id != null) nodesById[n.id] = n;
  }

  // Compute the union of want-muted sets across every Mute Switch.
  const wantMuted = resolveAllMutes(switches, nodesById, graph.links, isMuteSwitchNode);

  // ── Restore phase ──────────────────────────────────────────────────────
  // For each switch's saved originalModes, restore any entry whose node is
  // no longer wanted muted by ANY switch.
  for (const sw of switches) {
    const om = sw.properties?.[ORIGINAL_MODES_PROP];
    if (!om) continue;
    for (const key of Object.keys(om)) {
      if (wantMuted.has(key)) continue;
      const n = nodesById[key];
      if (n) n.mode = om[key];
      delete om[key];
    }
  }

  // ── Mute phase ─────────────────────────────────────────────────────────
  // For each node wanted muted: ensure its mode matches the target. Save
  // its true original on the FIRST switch that doesn't already have it.
  for (const [key, targetMode] of wantMuted) {
    const n = nodesById[key];
    if (!n) continue;

    // Find a switch holding the original, if any.
    let alreadySaved = false;
    for (const sw of switches) {
      const om = sw.properties?.[ORIGINAL_MODES_PROP];
      if (om && om[key] !== undefined) { alreadySaved = true; break; }
    }

    if (!alreadySaved && n.mode !== targetMode && switches.length > 0) {
      const sw = switches[0];
      if (!sw.properties[ORIGINAL_MODES_PROP]) sw.properties[ORIGINAL_MODES_PROP] = {};
      sw.properties[ORIGINAL_MODES_PROP][key] = n.mode;
    }

    if (n.mode !== targetMode) n.mode = targetMode;
  }

  graph.setDirtyCanvas?.(true, true);
}

function actuallyDisconnect(node, slotIdx1) {
  if (!node.graph) return;

  const state = readState(node);
  const slotCount = node.inputs?.length || 0;

  // 1. Remove the slot.
  if (slotIdx1 >= 1 && slotIdx1 <= slotCount) {
    node.removeInput(slotIdx1 - 1);
  }

  // 2. Rename remaining slots so suffixes stay contiguous AND re-apply slot.pos
  //    so dots stay aligned with our row paint after the shift.
  if (node.inputs) {
    for (let i = 0; i < node.inputs.length; i++) {
      node.inputs[i].name = `input_${i + 1}`;
      node.inputs[i].label = "​";
      const y = MODE_BAR_H + TOP_PAD + i * ROW_H + ROW_H / 2;
      node.inputs[i].pos = [10, y];
    }
  }

  // 3. Shift state.rows: drop the removed entry; entries after it shift up.
  state.rows.splice(slotIdx1 - 1, 1);

  // 4. Maintain the empty-trailing invariant.
  const inputs = node.inputs || [];
  const last = inputs[inputs.length - 1];
  if (inputs.length === 0) {
    addInputSlot(node, 1);
    const enabled = state.selectMode === "single" ? false : true;
    state.rows.push({ enabled, label: null });
    inputs[0].pos = [10, MODE_BAR_H + TOP_PAD + ROW_H / 2];
  } else if (last && last.link != null && inputs.length < MAX_INPUTS) {
    addInputSlot(node, inputs.length + 1);
    const enabled = state.selectMode === "single" ? false : true;
    state.rows.push({ enabled, label: null });
    const newIdx0 = inputs.length - 1;
    inputs[newIdx0].pos = [10, MODE_BAR_H + TOP_PAD + newIdx0 * ROW_H + ROW_H / 2];
  }

  // 5. Resize.
  node.size[1] = computeNodeHeight(node.inputs.length);

  applyMuteState(node);
  node.graph?.setDirtyCanvas?.(true, true);
}

// Called from onRemoved. Restores every node we saved an original for,
// then re-runs the global apply so any OTHER Mute Switch in the graph
// can re-mute nodes it still wants muted (taking over ownership of the
// originalModes since we're going away).
//
// Two-step restore-then-reapply is needed because the originalModes that
// LIVED on this switch is about to be deleted with the node. If another
// switch still wants those nodes muted, applyAllMuteSwitches (excluding
// this node) will re-save the originals on the next surviving switch.
export function restoreAllOnRemove(node) {
  if (!node.graph) return;
  const originalModes = node.properties?.[ORIGINAL_MODES_PROP];
  if (originalModes) {
    const allNodes = node.graph._nodes || node.graph.nodes || [];
    const nodesById = {};
    for (const n of allNodes) {
      if (n && n.id != null) nodesById[String(n.id)] = n;
    }
    for (const key of Object.keys(originalModes)) {
      const n = nodesById[key];
      if (n) n.mode = originalModes[key];
    }
    node.properties[ORIGINAL_MODES_PROP] = {};
  }

  // Re-run global apply, excluding the about-to-be-removed node. Any
  // surviving switch that still wants any of these nodes muted will
  // re-mute them and save the original on itself.
  applyAllMuteSwitches(node.graph, node.id);
}

// Drop originalModes entries whose node no longer exists in the graph.
// Called at the start of applyMuteState so deleted upstream nodes do not
// accumulate stale entries that would later try to "restore" something
// that isn't there.
export function pruneOrphanedOriginalModes(node) {
  if (!node.graph) return;
  const originalModes = node.properties?.[ORIGINAL_MODES_PROP];
  if (!originalModes) return;
  const allNodes = node.graph._nodes || node.graph.nodes || [];
  const liveIds = new Set();
  for (const n of allNodes) if (n && n.id != null) liveIds.add(String(n.id));
  for (const key of Object.keys(originalModes)) {
    if (!liveIds.has(key)) {
      delete originalModes[key];
    }
  }
}
