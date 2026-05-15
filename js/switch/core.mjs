// Switch Pixaroma - slot management and state helpers.
//
// Drawing happens in onDrawForeground (patched in index.js).
// Clicks are handled in onMouseDown (patched in index.js).
// No custom widgets; no slot.pos overrides.
//
// State shape: node.properties.switchState = { activeIndex, labels, visibleCount }
//   activeIndex  - 1-based index of the currently active slot (0 = none)
//   labels       - map of { [slotIdx1]: labelString }
//   visibleCount - number of input slots currently shown

import { app } from "/scripts/app.js";
import { ROW_H, TOP_PAD } from "./render.mjs";

export const STATE_PROP = "switchState";
export const MAX_INPUTS = 32;

const SLOT_NAME = (i) => `input_${i}`; // 1-based

// LiteGraph's default node height formula:
//   body height = TOP_PAD + slotCount * ROW_H + BOT_PAD
// We keep BOT_PAD=8 so the node doesn't feel cramped at the bottom.
const BOT_PAD = 8;
const DEFAULT_W = 260;

function defaultState() {
  return { activeIndex: 0, labels: {}, visibleCount: 1 };
}

export function readState(node) {
  if (!node.properties) node.properties = {};
  if (!node.properties[STATE_PROP]) {
    node.properties[STATE_PROP] = defaultState();
  }
  return node.properties[STATE_PROP];
}

export function isSlotConnected(node, slotIdx1) {
  const slot = node.inputs?.[slotIdx1 - 1];
  return slot != null && slot.link != null;
}

// Strip every native input slot. Walk backwards to avoid index shifts.
function clearNativeInputs(node) {
  if (!node.inputs) return;
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    node.removeInput(i);
  }
}

// Idempotent slot normaliser - safe to call from BOTH onNodeCreated AND
// onConfigure (the undo-restore path). Ensures:
//   - Exactly `target` slots exist (no more, no less).
//   - All slots named input_1..input_N contiguously.
//   - All slot.label = zero-width space (suppresses LiteGraph label rendering).
//   - state.visibleCount === node.inputs.length.
//   - Node height matches the slot count.
//
// target = max(connected_count + 1 trailing, state.visibleCount, 1), capped at MAX_INPUTS.
// Trailing empty slots beyond target are removed; missing slots are appended.
export function normalizeSlots(node) {
  if (!node.inputs) return;
  const state = readState(node);

  // Count how many slots currently carry a live wire.
  let connected = 0;
  for (const s of node.inputs) {
    if (s.link != null) connected++;
  }

  // Target: connected slot count + 1 empty trailing row, capped at MAX_INPUTS.
  // state.visibleCount is NOT used here - it can be stale from old snapshots
  // (e.g. an undo target taken before our cleanup logic existed had 32 slots
  // saved). The wire-state in node.inputs is the canonical source of truth.
  const target = Math.min(
    Math.max(connected + (connected < MAX_INPUTS ? 1 : 0), 1),
    MAX_INPUTS,
  );

  // Remove unconnected trailing slots until we reach target.
  // Walk from the end; stop if the slot is connected (never remove a live wire).
  while ((node.inputs.length || 0) > target) {
    const last = node.inputs[node.inputs.length - 1];
    if (last && last.link != null) break; // last slot is wired - don't remove
    node.removeInput(node.inputs.length - 1);
  }

  // Append empty trailing slots until we reach target.
  while ((node.inputs.length || 0) < target) {
    addInputSlot(node, node.inputs.length + 1);
  }

  // Re-apply correct names and zero-width labels to every slot.
  for (let i = 0; i < node.inputs.length; i++) {
    node.inputs[i].name = SLOT_NAME(i + 1);
    node.inputs[i].label = "​"; // zero-width space
  }

  state.visibleCount = node.inputs.length;
  node.size[0] = Math.max(node.size[0] || 0, DEFAULT_W);
  node.size[1] = computeNodeHeight(state.visibleCount);

  app.graph?.setDirtyCanvas?.(true, true);
}

// Add a single input slot. slot.label = zero-width space so LiteGraph's
// label rendering chain (label || localized_name || name) shows nothing
// while the input name (input_N) stays intact for Python kwarg routing.
function addInputSlot(node, idx1) {
  const slot = node.addInput(SLOT_NAME(idx1), "*");
  slot.label = "​"; // zero-width space: truthy, invisible
  return slot;
}

// Compute the node height that matches our paint layout.
function computeNodeHeight(slotCount) {
  return TOP_PAD + slotCount * ROW_H + BOT_PAD;
}

// Called on fresh node creation (nodeCreated in index.js).
// Strips the 32 auto-created Python INPUT_TYPES slots, then calls
// normalizeSlots to bring the node to the correct starting state.
export function setupNode(node) {
  clearNativeInputs(node);
  normalizeSlots(node);
}

// Called from onConfigure (via queueMicrotask) after workflow JSON restores
// node.inputs and node.properties.
// Also covers the undo-restore path where onNodeCreated may NOT fire:
// Ctrl+Z triggers changeTracker.undo -> app.loadGraphData -> graph.clear
// -> re-creates each node from Python class definition (32 slots back), then
// calls onConfigure to restore saved state. Without normalizeSlots here the
// 32 raw slots stay visible.
export function restoreFromProperties(node) {
  normalizeSlots(node);
}

// Called when a wire is connected (slotIdx1 = 1-based slot that just got connected).
export function handleConnect(node, slotIdx1) {
  const state = readState(node);
  state.activeIndex = slotIdx1;

  const isLast = slotIdx1 === (node.inputs?.length || 0);
  if (isLast && (node.inputs?.length || 0) < MAX_INPUTS) {
    addInputSlot(node, (node.inputs?.length || 0) + 1);
    state.visibleCount = node.inputs.length;
    node.size[1] = computeNodeHeight(state.visibleCount);
  }

  app.graph?.setDirtyCanvas?.(true, true);
}

export function handleDisconnect(node, slotIdx /* 1-based */) {
  const state = readState(node);
  const wasActive = state.activeIndex === slotIdx;
  const slotCount = node.inputs?.length || 0;

  // 1. Remove the slot. LiteGraph shifts later entries down by one.
  if (slotIdx >= 1 && slotIdx <= slotCount) {
    node.removeInput(slotIdx - 1);
  }

  // 2. Rename every remaining slot so suffixes stay contiguous.
  if (node.inputs) {
    for (let i = 0; i < node.inputs.length; i++) {
      node.inputs[i].name = `input_${i + 1}`;
      node.inputs[i].label = "​"; // zero-width space
    }
  }

  // 3. Shift labels in state.labels down.
  const oldLabels = state.labels || {};
  const newLabels = {};
  for (const key in oldLabels) {
    const k = parseInt(key, 10);
    if (!Number.isFinite(k)) continue;
    if (k < slotIdx) newLabels[k] = oldLabels[key];
    else if (k > slotIdx) newLabels[k - 1] = oldLabels[key];
    // k === slotIdx: dropped (label of the removed slot is gone)
  }
  state.labels = newLabels;

  // 4. Active cascade.
  const inputs = node.inputs || [];
  if (wasActive) {
    // Try the row directly above (new index = slotIdx - 1).
    const above = slotIdx - 1;
    // Try the row directly below the removed one (shifted up to slotIdx).
    const below = slotIdx;
    if (above >= 1 && inputs[above - 1]?.link != null) {
      state.activeIndex = above;
    } else if (below >= 1 && below <= inputs.length && inputs[below - 1]?.link != null) {
      state.activeIndex = below;
    } else {
      state.activeIndex = 0; // no connected row - Python will error on next run
    }
  } else if (state.activeIndex > slotIdx) {
    // The active row shifted up by one.
    state.activeIndex -= 1;
  }

  // 5. Maintain the empty-trailing invariant.
  const last = inputs[inputs.length - 1];
  if (inputs.length === 0) {
    // No rows left at all - add one empty trailing slot.
    addInputSlot(node, 1);
  } else if (last && last.link != null && inputs.length < MAX_INPUTS) {
    // Last slot is connected and we have room - add an empty trailing slot.
    addInputSlot(node, inputs.length + 1);
  }
  // Otherwise last slot is already empty (or at 32 cap) - leave as is.

  // 6. Update visibleCount and resize.
  state.visibleCount = node.inputs?.length || 1;
  node.size[1] = computeNodeHeight(state.visibleCount);

  // 7. Redraw.
  node.graph?.setDirtyCanvas?.(true, true);
}
