import { app } from "/scripts/app.js";

// State lives on node.properties.switchState. LiteGraph serializes
// node.properties natively into the workflow JSON, so labels and the
// active index survive workflow save/load and tab switching.
const STATE_PROP = "switchState";
const MAX_INPUTS = 32;
const SLOT_NAME = (i) => `input_${i}`;  // 1-based

function defaultState() {
  return { activeIndex: 0, labels: {}, visibleCount: 1 };
}

function readState(node) {
  if (!node.properties) node.properties = {};
  if (!node.properties[STATE_PROP]) {
    node.properties[STATE_PROP] = defaultState();
  }
  return node.properties[STATE_PROP];
}

function isSlotConnected(node, slotIdx /* 1-based */) {
  const slot = node.inputs?.[slotIdx - 1];
  return slot != null && slot.link != null;
}

function connectedCount(node) {
  let n = 0;
  for (let i = 1; i <= MAX_INPUTS; i++) {
    if (isSlotConnected(node, i)) n++;
  }
  return n;
}

// Strip every native input slot that ComfyUI auto-created from the 32
// pre-declared optional inputs. We rebuild only the slots we want
// (connected + one trailing empty) ourselves.
function clearNativeInputs(node) {
  if (!node.inputs) return;
  // Walk backwards so removeInput's array shift doesn't skip entries.
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    node.removeInput(i);
  }
}

// Add a single empty input slot at the bottom (1-based index = current
// length + 1). slot.name is the contiguous input_N string and must stay
// intact - it becomes the workflow JSON key that Python reads via kwargs.
function addInputSlot(node, idx) {
  const slot = node.addInput(SLOT_NAME(idx), "*");
  // Hide LiteGraph's native slot label rendering without touching
  // slot.name. LiteGraph reads slot.label first for display and only
  // falls back to slot.name when label is undefined; setting label to
  // empty string suppresses the visible text while leaving the kwarg key
  // (slot.name = "input_N") intact so Python routing works correctly.
  slot.label = "";
  return slot;
}

export function setupNode(node) {
  const state = readState(node);
  clearNativeInputs(node);
  // Rebuild: connected slots first, then one trailing empty.
  // (For a fresh node, state.visibleCount = 1, so just one empty slot.)
  const target = Math.max(1, Math.min(state.visibleCount || 1, MAX_INPUTS));
  for (let i = 1; i <= target; i++) {
    addInputSlot(node, i);
  }
  state.visibleCount = target;
  // Recompute node height from the actual slot/widget count now that we
  // have stripped the 32 auto-created inputs down to just `target`.
  // Without this the node body stays at the ~1100 px height LiteGraph
  // computed before we called clearNativeInputs.
  node.setSize(node.computeSize());
  node.graph?.setDirtyCanvas?.(true, true);
}

// Called from index.js's onConfigure to re-render after workflow load
// restores node.properties + node.inputs from JSON.
export function restoreFromProperties(node) {
  const state = readState(node);
  // The slots themselves are restored by LiteGraph from the saved JSON.
  // Re-apply the label-hiding policy (slot.label = "") to every slot so
  // the native LiteGraph label text stays suppressed. Do NOT touch
  // slot.name - LiteGraph already restored it from the workflow JSON and
  // Python depends on it as the kwarg key ("input_1", "input_2", ...).
  if (node.inputs) {
    for (const slot of node.inputs) slot.label = "";
  }
  state.visibleCount = node.inputs?.length || 1;
  node.setSize(node.computeSize());
  node.graph?.setDirtyCanvas?.(true, true);
}

export { STATE_PROP, MAX_INPUTS };
