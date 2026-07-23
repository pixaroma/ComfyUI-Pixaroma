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
import { resolveAllMutes, getUpstreamNode } from "./upstream.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";

export const STATE_PROP = "muteSwitchState";
export const ORIGINAL_MODES_PROP = "muteSwitchOriginalModes";
export const MAX_INPUTS = 32;
// Bump this whenever the schema of muteSwitchState changes. _migrateState
// is the single point where old versions get upgraded to current.
export const STATE_VERSION = 1;

const SLOT_NAME = (i) => `input_${i}`; // 1-based

const BOT_PAD = 8;
const DEFAULT_W = 280;
const MIN_BODY_H = MODE_BAR_H + ROW_H + BOT_PAD;

// Label LiteGraph / Vue shows next to an INPUT dot.
//  - Legacy: a zero-width space (truthy + invisible) so LiteGraph does NOT draw
//    a native label over the row content we canvas-paint ourselves.
//  - Nodes 2.0: a STABLE "input N". Vue renders slot.label next to the dot and
//    we paint nothing there, so a blank dot looks unfinished. Deliberately NOT
//    the wire type / custom name: Vue only re-reads a dot label on (re)load
//    (shallowReactive), so those would go stale after a live rewire/rename. The
//    live type + name live in the DOM row instead (vue_list.mjs).
export function slotDisplayLabel(slotIdx1) {
  return isVueNodes() ? `input ${slotIdx1}` : "​";
}

// Label for the phantom chain OUTPUT.
//  - Nodes 2.0: "out" so chaining one Mute Switch into another stays
//    discoverable (Vue draws the label; we paint nothing there).
//  - Legacy: a zero-width space - the "out" caption is canvas-painted next to
//    the dot in drawMuteSwitch, so a native label would double up.
function outputDisplayLabel() {
  return isVueNodes() ? "out" : "​";
}

export function defaultState() {
  return {
    version: STATE_VERSION,
    selectMode: "multi",
    muteMode: "mute",
    rows: [],
  };
}

// Forward-migrate an older state to the current schema. Called from
// readState so every read goes through migration. Currently a no-op
// because we are at v1 - when a future version ships, add the migration
// branches HERE rather than scattering defaults across every reader.
function _migrateState(s) {
  if (typeof s.version !== "number") s.version = STATE_VERSION;
  // Example shape for future migrations:
  //   if (s.version < 2) { s.newField = "default"; s.version = 2; }
  return s;
}

export function readState(node) {
  if (!node.properties) node.properties = {};
  if (!node.properties[STATE_PROP]) {
    node.properties[STATE_PROP] = defaultState();
  }
  const s = node.properties[STATE_PROP];
  if (!Array.isArray(s.rows)) s.rows = [];
  if (typeof s.selectMode !== "string") s.selectMode = "multi";
  if (typeof s.muteMode !== "string") s.muteMode = "mute";
  return _migrateState(s);
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
  slot.label = slotDisplayLabel(idx1); // "​" in legacy, "input N" in 2.0
  return slot;
}

export function computeNodeHeight(slotCount) {
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
    const lbl = slotDisplayLabel(i + 1);
    if (node.inputs[i].label !== lbl) node.inputs[i].label = lbl;
  }

  // Push each input dot down by MODE_BAR_H so it aligns with our row paint.
  // slot.pos = [x, y] is body-local. Vue Compat #16: this LG fork reads
  // slot.pos via calculateInputSlotPosFromSlot.
  // Diff-gated to avoid dirtying a saved workflow on plain open (Compat #18) -
  // LG serialises slot.pos so unconditional writes count as a modification.
  for (let i = 0; i < node.inputs.length; i++) {
    const y = MODE_BAR_H + TOP_PAD + i * ROW_H + ROW_H / 2;
    const cur = node.inputs[i].pos;
    if (!cur || cur[0] !== 10 || cur[1] !== y) {
      node.inputs[i].pos = [10, y];
    }
  }

  // Schema migration: workflows saved before the phantom "out" output was
  // added still have outputs: []. Re-add it. One-time dirty for legacy
  // workflows; once re-saved, the migration branch never fires again.
  // Use the custom PIXAROMA_MUTE_CHAIN type so LG type-checking blocks the
  // user from wiring 'out' into non-Mute-Switch consumers (which would
  // crash at runtime - the output carries None).
  if (!node.outputs || node.outputs.length === 0) {
    node.addOutput("out", "PIXAROMA_MUTE_CHAIN");
  } else if (node.outputs[0] && node.outputs[0].type === "*") {
    // One-time migration from the v2.0 wildcard output to the typed one.
    node.outputs[0].type = "PIXAROMA_MUTE_CHAIN";
  }
  // Output label: "out" in Nodes 2.0 (Vue draws it - keeps chaining
  // discoverable), zero-width space in Legacy (the "out" caption is
  // canvas-painted in drawMuteSwitch, so a native label would double up).
  for (const out of node.outputs) {
    const lbl = outputDisplayLabel();
    if (out.label !== lbl) out.label = lbl;
  }
  // Pin the dot just below the mode bar, diff-gated (Compat #18).
  if (node.outputs[0]) {
    const ox = node.size[0] - OUTPUT_X_INSET;
    const oy = MODE_BAR_H + TOP_PAD + ROW_H / 2;
    const cur = node.outputs[0].pos;
    if (!cur || cur[0] !== ox || cur[1] !== oy) {
      node.outputs[0].pos = [ox, oy];
    }
  }

  // Sync state.rows length to slot count.
  while (state.rows.length < node.inputs.length) {
    // New row default: ON in multi mode, OFF in single mode.
    const enabled = state.selectMode === "single" ? false : true;
    state.rows.push({ enabled, label: null });
  }
  // Only DROP rows when the slot count is authoritative, i.e. at least one wire
  // is present. With zero wires we may be inside the clone() window that backs
  // copy/paste, Ctrl+D duplicate AND alt-drag clone: LGraphNode.clone() nulls
  // EVERY input link before calling configure, so this pass momentarily sees a
  // one-row node and would pop rows 2..N off the saved state - taking each
  // row's name AND its on/off pill with it (a pasted Mute Switch came back with
  // every branch re-enabled, silently changing what runs). The rows are rebuilt
  // from the wires that land straight after; until then a longer rows array is
  // inert, because every consumer either iterates node.inputs (drawMuteSwitch,
  // vue_list) or guards its slot lookup with `node.inputs?.[i]` + a link check
  // (cascadeMuteSet, setSelectMode, setAllRowsEnabled, the self-heal sweep).
  // A genuinely over-long array still heals on the next pass that sees a wire.
  if (connected > 0) {
    while (state.rows.length > node.inputs.length) {
      state.rows.pop();
    }
  }

  // Width: do NOT clobber a user-resized width back up to DEFAULT_W
  // (Compat #18). Fresh-node default is handled in setupNode; here we
  // just leave node.size[0] alone unless slot count actually changed.

  if (node.inputs.length !== beforeLen) {
    const h = computeNodeHeight(node.inputs.length);
    if (node.size[1] !== h) node.size[1] = h;
  }

  app.graph?.setDirtyCanvas?.(true, true);
  node._pixMsRefresh?.(); // re-render the Nodes 2.0 DOM list (no-op in legacy)
}

export function setupNode(node) {
  clearNativeInputs(node);
  normalizeSlots(node);
  // Fresh-node defaults. LG configure() runs AFTER onNodeCreated and
  // overwrites these from the saved workflow JSON, so this only affects
  // brand-new drops on the canvas.
  if (!node.size[0] || node.size[0] < DEFAULT_W) node.size[0] = DEFAULT_W;
  node.size[1] = Math.max(node.size[1], MIN_BODY_H);
}

export function restoreFromProperties(node) {
  normalizeSlots(node);
  // Re-apply mute state on load so the canvas reflects the saved Mute Switch
  // pill state. Every node.mode write inside applyAllMuteSwitches is diff-
  // gated, so when the saved JSON already has the correct modes (the common
  // case for a user who toggled and then saved), this is a no-op - no dirty.
  // When the saved JSON has mute STATE but no matching node.mode values
  // (e.g. workflows generated by scripts, or hand-edited), this brings the
  // canvas + the about-to-be-submitted prompt into sync. Trade-off: one-
  // time dirty for those inconsistent workflows on first save.
  //
  // Skipped during the onConfigure window via the _pixMsConfiguring gate
  // inside applyMuteState. The queueMicrotask in onNodeCreated runs AFTER
  // configure resolves and clears the flag, so the apply takes effect then.
  applyMuteState(node);
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
    // A wire landing during the restore burst that FOLLOWS configure is not a
    // user action - it is the node's own wiring coming back (paste / duplicate /
    // alt-drag clone all add + configure the node first and only then reconnect
    // every link, in the same tick). Such a row keeps the on/off state it was
    // copied with; only a genuinely new wire gets the mode default.
    if (!node._pixMsRestoring) {
      const row = state.rows[slotIdx1 - 1];
      if (row) {
        row.enabled = state.selectMode === "single" ? false : true;
      }
    }

    // Grow the slot list if this was the trailing empty slot.
    const isLast = slotIdx1 === (node.inputs?.length || 0);
    if (isLast && (node.inputs?.length || 0) < MAX_INPUTS) {
      const newIdx1 = (node.inputs?.length || 0) + 1;
      addInputSlot(node, newIdx1);
      // Only mint a row model when the saved state doesn't already carry one
      // for this slot. On a paste the rows survive (see normalizeSlots) and are
      // waiting for exactly these wires, so an unconditional push would stack a
      // second set of rows on top of them.
      if (state.rows.length < node.inputs.length) {
        const enabled = state.selectMode === "single" ? false : true;
        state.rows.push({ enabled, label: null });
      }
      // Update slot.pos for the freshly-added trailing slot too.
      const y = MODE_BAR_H + TOP_PAD + (newIdx1 - 1) * ROW_H + ROW_H / 2;
      node.inputs[newIdx1 - 1].pos = [10, y];
      node.size[1] = computeNodeHeight(node.inputs.length);
    }
  }

  applyMuteState(node);
  app.graph?.setDirtyCanvas?.(true, true);
  node._pixMsRefresh?.(); // re-render the Nodes 2.0 DOM list (no-op in legacy)
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
  node._pixMsRefresh?.(); // re-render the Nodes 2.0 DOM list (no-op in legacy)
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
  node._pixMsRefresh?.(); // re-render the Nodes 2.0 DOM list (no-op in legacy)
}

// Bulk-toggle helper for the right-click "Enable all rows" / "Disable all rows"
// menu items. Only flips WIRED rows (unwired rows can't meaningfully mute
// anything anyway). Only valid in Multi mode - in Single the "exactly one
// ON" invariant forbids all-ON or all-OFF, so the caller must gate.
export function setAllRowsEnabled(node, enabled) {
  const state = readState(node);
  if (state.selectMode !== "multi") return;
  let changed = false;
  for (let i = 0; i < state.rows.length; i++) {
    const slot = node.inputs?.[i];
    if (!slot || slot.link == null) continue;
    if (state.rows[i].enabled !== enabled) {
      state.rows[i].enabled = enabled;
      changed = true;
    }
  }
  if (!changed) return;
  applyMuteState(node);
  app.graph?.setDirtyCanvas?.(true, true);
  node._pixMsRefresh?.(); // re-render the Nodes 2.0 DOM list (no-op in legacy)
}

export function setMuteMode(node, newMode /* "mute" | "bypass" */) {
  const state = readState(node);
  if (state.muteMode === newMode) return;
  state.muteMode = newMode;
  applyMuteState(node);
  app.graph?.setDirtyCanvas?.(true, true);
  node._pixMsRefresh?.(); // re-render the Nodes 2.0 DOM list (no-op in legacy)
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

  // Build nodesById with String keys to match wantMuted's String keys
  // (resolveAllMutes uses String(id)) and originalModes' String keys (LG
  // stringifies object keys at JSON serialize). JS auto-coerces on read
  // either way; explicit String() avoids surprise for future maintainers.
  const allNodes = graph._nodes || graph.nodes || [];
  const nodesById = {};
  for (const n of allNodes) {
    if (n && n.id != null) nodesById[String(n.id)] = n;
  }

  // Prune stale originalModes entries on every switch (their upstream node
  // was deleted from the graph). Without this, deleted-node ids accumulate
  // on every switch's originalModes forever.
  for (const sw of switches) {
    pruneOrphanedOriginalModes(sw);
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

    // Save the original mode so untoggle can restore. CRITICAL: when the
    // node is ALREADY at target mode (something other than us muted it -
    // e.g. user manual right-click, a previous buggy save, or a leftover
    // from a deleted Mute Switch), we save 0 as a FALLBACK rather than
    // saving the actual mode. Saving the actual mode (2) would mean
    // restoring to 2 on untoggle - silently re-muting the node despite
    // the pill being ON. The self-heal sweep below catches this anyway,
    // but the fallback prevents the orphaned-mute state from being
    // written in the first place. Trade-off: a pre-existing manual mute
    // is lost on first toggle cycle (the user can re-mute manually if
    // they want).
    if (!alreadySaved && switches.length > 0) {
      const sw = switches[0];
      if (!sw.properties[ORIGINAL_MODES_PROP]) sw.properties[ORIGINAL_MODES_PROP] = {};
      const savedOriginal = (n.mode === targetMode) ? 0 : n.mode;
      sw.properties[ORIGINAL_MODES_PROP][key] = savedOriginal;
    }

    if (n.mode !== targetMode) n.mode = targetMode;
  }

  // ── Self-heal phase ────────────────────────────────────────────────────
  // For every switch's ON+wired rows, if the directly-wired upstream node
  // is currently muted (mode != 0) but NO switch tracks it in originalModes,
  // it's an ORPHANED MUTE. Un-mute it (set mode = 0). Catches:
  //   1. External mutes the user later forgot about (right-click → Set Mode
  //      → Mute on a node that's now wired to an ON row).
  //   2. State corruption from previous buggy saves (the bug class that
  //      prompted this fix: a previous save stored originalModes[X] = 2,
  //      restore wrote 2 back, deleted the entry, leaving X stuck muted
  //      with no way to recover via the pill).
  //   3. Cross-switch consistency violations.
  // Mute Switch IS the source of truth for nodes wired to it - so if the
  // pill says ON, the canvas should match.
  for (const sw of switches) {
    const swState = sw.properties?.[STATE_PROP];
    if (!swState || !Array.isArray(swState.rows)) continue;
    for (let i = 0; i < swState.rows.length; i++) {
      if (!swState.rows[i].enabled) continue;       // OFF row: don't heal
      const slot = sw.inputs?.[i];
      if (!slot || slot.link == null) continue;     // empty slot: nothing to heal
      const upstream = getUpstreamNode(slot, nodesById, graph.links);
      if (!upstream || upstream.mode === 0) continue;

      const keyU = String(upstream.id);
      // Don't heal: we want it muted (mute phase already handled it).
      if (wantMuted.has(keyU)) continue;
      // Don't heal: some switch tracks the original (restore will handle it
      // correctly on the next toggle cycle).
      let tracked = false;
      for (const sw2 of switches) {
        const om = sw2.properties?.[ORIGINAL_MODES_PROP];
        if (om && om[keyU] !== undefined) { tracked = true; break; }
      }
      if (tracked) continue;

      // Orphan: un-mute.
      upstream.mode = 0;
    }
  }

  // Drop empty originalModes objects so they don't bloat the saved JSON.
  // Lazy-recreated on the next write at line 391.
  for (const sw of switches) {
    const om = sw.properties?.[ORIGINAL_MODES_PROP];
    if (om && Object.keys(om).length === 0) {
      delete sw.properties[ORIGINAL_MODES_PROP];
    }
  }

  graph.setDirtyCanvas?.(true, true);
}

function actuallyDisconnect(node, slotIdx1) {
  if (!node.graph) return;

  const state = readState(node);
  const slotCount = node.inputs?.length || 0;

  // Defensive against a disconnect -> connect -> disconnect timing race
  // where the deferred call fires after the slot has been re-wired.
  // handleConnect's pending-cancel should prevent this, but cheap insurance.
  const slot = node.inputs?.[slotIdx1 - 1];
  if (slot && slot.link != null) return;

  // 1. Remove the slot.
  if (slotIdx1 >= 1 && slotIdx1 <= slotCount) {
    node.removeInput(slotIdx1 - 1);
  }

  // 2. Rename remaining slots so suffixes stay contiguous AND re-apply slot.pos
  //    so dots stay aligned with our row paint after the shift. Diff-gated
  //    to avoid spurious serialized-state writes (Compat #18).
  if (node.inputs) {
    for (let i = 0; i < node.inputs.length; i++) {
      const expectedName = `input_${i + 1}`;
      if (node.inputs[i].name !== expectedName) node.inputs[i].name = expectedName;
      const lbl = slotDisplayLabel(i + 1);
      if (node.inputs[i].label !== lbl) node.inputs[i].label = lbl;
      const y = MODE_BAR_H + TOP_PAD + i * ROW_H + ROW_H / 2;
      const cur = node.inputs[i].pos;
      if (!cur || cur[0] !== 10 || cur[1] !== y) {
        node.inputs[i].pos = [10, y];
      }
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
  node._pixMsRefresh?.(); // re-render the Nodes 2.0 DOM list (no-op in legacy)
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
