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
export function setupNode(node) {
  const state = readState(node);
  clearNativeInputs(node);

  // Fresh node: 1 empty trailing slot. Restored node: rebuild to match
  // visibleCount saved in properties (restored slots come back via JSON
  // but we still need to re-apply the zero-width label).
  const target = Math.max(1, Math.min(state.visibleCount || 1, MAX_INPUTS));
  for (let i = 1; i <= target; i++) {
    addInputSlot(node, i);
  }
  state.visibleCount = target;

  // Size: fixed width, height derived from slot count.
  node.size[0] = Math.max(node.size[0] || 0, DEFAULT_W);
  node.size[1] = computeNodeHeight(target);

  app.graph?.setDirtyCanvas?.(true, true);
}

// Called from onConfigure (via queueMicrotask) after workflow JSON restores
// node.inputs and node.properties.
export function restoreFromProperties(node) {
  const state = readState(node);
  // Re-apply zero-width label (not serialized in workflow JSON).
  if (node.inputs) {
    for (const slot of node.inputs) slot.label = "​";
  }
  state.visibleCount = node.inputs?.length || 1;

  // Recalculate height in case slotCount changed since last save.
  node.size[1] = computeNodeHeight(state.visibleCount);
  node.size[0] = Math.max(node.size[0] || 0, DEFAULT_W);

  app.graph?.setDirtyCanvas?.(true, true);
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

// Task 8 stub: full cascade + slot rename logic lands later.
export function handleDisconnect(node, _slotIdx1) {
  app.graph?.setDirtyCanvas?.(true, true);
}
