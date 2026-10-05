import { app } from "../../../scripts/app.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import { capComputeSizeInNodes2 } from "../shared/core_min_size.mjs";
import {
  setupNode, restoreFromProperties,
  handleConnect, handleDisconnect,
  togglePillRow, setSelectMode, setMuteMode,
  setAllRowsEnabled, restoreAllOnRemove,
  computeNodeHeight, refreshRendererLabels, legacyBodyHeight,
  applyLegacySlotPositions,
} from "./core.mjs";
import {
  drawMuteSwitch, hideTooltip,
  hitSelectModePill, hitMutePill, hitRowPill, hitLabel, labelScreenRect,
} from "./render.mjs";
import { openLabelEditor, cancelEditorForNode } from "./editor.mjs";
import { buildMuteSwitchVueList, teardownMuteSwitchVueList } from "./vue_list.mjs";
import { registerNodeAccent } from "../shared/node_settings.mjs";
import { onRendererChange, refreshVueNodeSlots } from "../shared/renderer_switch.mjs";

// Give the chain output a NEW slot object after a switch into Nodes 2.0, so its
// "out" caption shows (mute-switch.md #21). Nodes 2.0 mounts the node the moment
// the setting flips, before onRendererChange's poll runs, so it mounts the output
// while it still carries the Classic zero-width space. It then never re-reads a
// field inside that slot: OutputSlot.vue is keyed by name + index, and
// refreshVueNodeSlots hands it the SAME object back. So the caption stayed blank
// until the workflow was reopened. The copy is built by the slot's own class,
// the constructor core's configure() uses (toClass(NodeOutputSlot, o, node)).
// MEASURED: same own keys in the same order, byte-identical serialize(), the
// links array and LLink origin untouched, connect/disconnect work through it.
function remountOutputSlot(node) {
  const out = node.outputs?.[0];
  const Ctor = out?.constructor;
  // A plain-object slot (a very old frontend) has no class to rebuild it with.
  if (!out || typeof Ctor !== "function" || Ctor === Object) return;
  try {
    node.outputs[0] = new Ctor(out, node);
  } catch (err) {
    console.warn("[Pixaroma] Mute Switch could not refresh its output caption", err);
  }
}

// Rebuild one node's UI for the renderer it is NOW in, after the user flipped
// the Nodes 2.0 setting with the page still open. Same shape (and same
// reasoning) as applyRenderer in js/switch/index.js - see
// shared/renderer_switch.mjs for why this is needed at all.
function applyRenderer(node, vue) {
  try {
    if (vue) {
      // Remember the legacy height so a round trip does not shrink a node the
      // user had made taller. Runtime-only, never serialized.
      node._pixMsLegacyH = node.size?.[1];
      buildMuteSwitchVueList(node);
    } else {
      teardownMuteSwitchVueList(node);
      // Never below the row count's minimum: a row may have been added while
      // in 2.0, and the stashed height would then cut the bottom row off.
      const h = Math.max(legacyBodyHeight(node), node._pixMsLegacyH || 0);
      // setSize, not `size[1] = h`: a raw index write is silently reverted when
      // the layout was last committed under the other renderer.
      if (node.setSize) node.setSize([node.size[0], h]);
      else node.size[1] = h;
      // Core parked each input at its Nodes 2.0 row widget's position, which
      // is below this node in Classic - put the dots back on our painted rows.
      applyLegacySlotPositions(node);
    }
    refreshRendererLabels(node);
    if (vue) {
      remountOutputSlot(node);
      // The markers are fields INSIDE the slots of a node Nodes 2.0 has already
      // mounted, which it never notices (see refreshVueNodeSlots): without this
      // the rebuilt node kept its input dot in the top column until the workflow
      // was reopened (measured 2026-09-26, flip_audit_lib.js).
      refreshVueNodeSlots(node);
    }
    node.setDirtyCanvas?.(true, true);
  } catch (err) {
    console.warn("[Pixaroma] Mute Switch renderer rebuild failed", err);
  }
}

// Mute Switch Pixaroma - dynamic N-row mute control. See:
//   js/switch/index.js     for the structural reference
//   docs/superpowers/specs/2026-05-28-mute-switch-pixaroma-design.md

app.registerExtension({
  name: "Pixaroma.MuteSwitch",

  // Bulk row toggles in the node right-click menu — new context-menu API (replaces
  // the deprecated getNodeMenuOptions monkey-patch). Both items always show (for
  // discoverability) but are disabled in Single mode (the "exactly one ON" invariant)
  // and when no rows are wired (nothing to flip).
  getNodeMenuItems(node) {
    if (!node || (node.type !== "PixaromaMuteSwitch"
                  && node.comfyClass !== "PixaromaMuteSwitch")) {
      return [];
    }
    const state = node.properties?.muteSwitchState;
    const isSingle = state?.selectMode === "single";
    let hasWired = false;
    if (node.inputs) {
      for (const s of node.inputs) {
        if (s && s.link != null) { hasWired = true; break; }
      }
    }
    const disabled = isSingle || !hasWired;
    return [
      null, // separator
      { content: "Enable all rows", disabled, callback: () => setAllRowsEnabled(node, true) },
      { content: "Disable all rows", disabled, callback: () => setAllRowsEnabled(node, false) },
    ];
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaMuteSwitch") return;
    // Idempotent guard - if the extension is hot-reloaded, beforeRegisterNodeDef
    // can fire more than once for the same nodeType. Without this flag every
    // re-fire would wrap each hook over the last (each "original" is the
    // previous wrap), producing exponential call chains.
    if (nodeType.prototype._pixMsPatched) return;
    nodeType.prototype._pixMsPatched = true;
    capComputeSizeInNodes2(nodeType); // Nodes 2.0 Ctrl+Z grow on frontend 1.53 (mute-switch.md #22)

    // Creation
    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _origCreated?.apply(this, arguments);
      setupNode(this);
      // Nodes 2.0 only: build the DOM body (mode bar + scene rows). It wires
      // itself as node._pixMsRefresh, which core.mjs calls on every state/slot
      // change. Legacy paints the body on the canvas instead (onDrawForeground).
      if (isVueNodes()) buildMuteSwitchVueList(this);
      // The renderer can be switched WITHOUT a page reload, and the choice
      // above was made once. Rebuild when that happens, or the node is left
      // empty (legacy -> 2.0) or doubled (2.0 -> legacy).
      this._pixMsRendererOff = onRendererChange((vue) => applyRenderer(this, vue));
      queueMicrotask(() => restoreFromProperties(this));
    };

    // Serialize - keep the render-time widget marker out of the file.
    // In Nodes 2.0 each input is marked widget-backed (vue_list.mjs) so its dot
    // is drawn on its row instead of in the top column. LiteGraph WOULD write
    // that marker into the workflow (inputAsSerialisable emits `widget: {name}`),
    // which would change every saved file, follow the workflow into the legacy
    // renderer (hiding the dots we paint there), and flag a clean workflow
    // "modified" on open. The marker is purely a render-time concern that
    // syncRowWidgets rebuilds on load, so strip it from the serialized copy.
    // onSerialize, not a serialize() wrapper: from frontend 1.53 the graph saves
    // each node from its store and never calls node.serialize() (Vue Compat #29).
    const _onSerialize = nodeType.prototype.onSerialize;
    nodeType.prototype.onSerialize = function (o) {
      const r = _onSerialize?.apply(this, arguments);
      if (o?.inputs) {
        for (const inp of o.inputs) {
          if (inp && inp.widget) delete inp.widget;
        }
      }
      return r;
    };

    // Configure gate (MUST wrap `configure`, NOT the `onConfigure` hook).
    // LiteGraph calls the onConfigure HOOK at the very END of configure(), long
    // after it has restored node.inputs and replayed onConnectionsChange for
    // every slot. Verified live (2026-07-23): by the time our onConfigure hook
    // ran, the node already carried all 32 Python-def slots AND a row per slot,
    // because every replayed event reached handleConnect, whose
    // grow-on-trailing-connect logic cascaded the list to the MAX_INPUTS cap.
    // So `_pixMsConfiguring` (Pattern #11 / Vue Compat #17) never actually
    // covered the replay it was written for - normalizeSlots just cleaned up
    // immediately afterwards, hiding it. Once the copy/paste fix stopped that
    // cleanup from discarding saved rows, 28 junk rows survived into the
    // clipboard and a pasted node lost a row name. Wrapping `configure` raises
    // the flag BEFORE the replay, so handleConnect never sees it.
    const _origConfigureFn = nodeType.prototype.configure;
    nodeType.prototype.configure = function () {
      this._pixMsConfiguring = true;
      try {
        return _origConfigureFn?.apply(this, arguments);
      } finally {
        this._pixMsConfiguring = false;
        // Paste / Ctrl+D duplicate / alt-drag clone all run through
        // LGraphCanvas._deserializeItems, which adds + configures every node
        // FIRST and reconnects all the links afterwards - later than this
        // finally block, but still inside the SAME tick. Those replayed
        // connects have to grow the row list back (clone() nulled every link,
        // so configure left us with a single row), but they must not reset each
        // row's on/off pill to the mode default. Keep a flag up across that
        // burst; handleConnect reads it. A 0ms timer drops it the moment the
        // tick ends, so a real user wire right after still takes the default.
        this._pixMsRestoring = true;
        clearTimeout(this._pixMsRestoreTimer);
        this._pixMsRestoreTimer = setTimeout(() => {
          this._pixMsRestoring = false;
          this._pixMsRestoreTimer = null;
        }, 0);
      }
    };

    // Configure hook - runs INSIDE configure, with the gate above still up, so
    // the removeInput calls in restoreFromProperties are gated too. Do NOT
    // set/clear _pixMsConfiguring here as well: this hook runs partway through
    // configure, so clearing it here would drop the gate early.
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure?.apply(this, arguments);
      restoreFromProperties(this);
      return r;
    };

    // Connection changes - gated on BOTH the per-node configure flag AND
    // the load-wide isGraphLoading guard (Vue Compat #17 + #19). The
    // per-node flag covers onConfigure; isGraphLoading covers the graph-
    // level link restore that fires AFTER each node's onConfigure has
    // cleared its flag.
    const _origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (
      type, slotIndex, isConnected, link, ioSlot
    ) {
      if (
        type === 1 /* INPUT */ &&
        !this._pixMsConfiguring &&
        !isGraphLoading()
      ) {
        if (isConnected) handleConnect(this, slotIndex + 1);
        else handleDisconnect(this, slotIndex + 1);
      }
      return _origOnConnectionsChange?.apply(this, arguments);
    };

    // Draw
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (_origDraw) _origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      // Nodes 2.0 renders the body via the DOM widget (mode bar + rows), not
      // the canvas. Skip the canvas paint AND the legacy min-size self-heal -
      // there the DOM widget drives the body size.
      if (isVueNodes()) return;

      // Self-heal min width / height (Vue Compat #13 + Preview Image #11).
      // MIN_W = 260 leaves clear horizontal headroom between the right-side
      // pill and the phantom output dot at the right edge. MIN_H tracks the
      // ACTUAL row count (mode bar + N rows + pad) so the node can never be
      // dragged shorter than its content - which let the bottom rows + their
      // toggles spill below the frame.
      const MIN_W = 260;
      const MIN_H = computeNodeHeight(this.inputs?.length || 1);
      let changed = false;
      if (this.size[0] < MIN_W) { this.size[0] = MIN_W; changed = true; }
      if (this.size[1] < MIN_H) { this.size[1] = MIN_H; changed = true; }
      if (changed) this.graph?.setDirtyCanvas?.(true, true);

      drawMuteSwitch(this, ctx);
    };

    // Mouse clicks
    // Canvas hit-testing is legacy-only: in Nodes 2.0 the mode bar + rows are a
    // DOM widget (clicks handled there) and these painted rects don't exist.
    const _origDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (e, pos) {
      if (!this.flags?.collapsed && !isVueNodes()) {
        const w = this.size[0];

        // Mode bar pills first.
        if (hitSelectModePill(pos, w)) {
          const state = this.properties?.muteSwitchState;
          const cur = state?.selectMode || "multi";
          setSelectMode(this, cur === "single" ? "multi" : "single");
          return true;
        }
        if (hitMutePill(pos, w)) {
          const state = this.properties?.muteSwitchState;
          const cur = state?.muteMode || "mute";
          setMuteMode(this, cur === "mute" ? "bypass" : "mute");
          return true;
        }

        const inputs = this.inputs;
        if (inputs) {
          // Row pill hit-test.
          for (let i = 0; i < inputs.length; i++) {
            if (hitRowPill(pos, w, i)) {
              togglePillRow(this, i + 1);
              return true;
            }
          }
          // Row label hit-test (only on connected rows).
          for (let i = 0; i < inputs.length; i++) {
            const slot = inputs[i];
            if (slot == null || slot.link == null) continue;
            if (hitLabel(pos, w, i)) {
              const rect = labelScreenRect(this, i + 1);
              openLabelEditor(this, i + 1, rect);
              return true;
            }
          }
        }
      }
      if (_origDown) return _origDown.call(this, e, pos);
    };

    // Resize clamp (legacy only) - belt-and-braces with the onDrawForeground
    // self-heal (Pixaroma UI convention #7). Clamping here stops the resize-
    // handle drag at the minimum, so the node FRAME is never drawn narrower
    // than the mode-bar content (which let the pills spill past the frame for a
    // frame during an active drag). In Nodes 2.0 the DOM widget drives the
    // body size, so leave it alone there.
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes()) {
        const MIN_W = 260;
        const MIN_H = computeNodeHeight(this.inputs?.length || 1);
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      return _origResize?.apply(this, arguments);
    };

    // Removal - hide tooltip + restore muted nodes + cancel editor + clear pending.
    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this._pixMsHover) hideTooltip();
      restoreAllOnRemove(this);
      cancelEditorForNode(this);
      // Stop listening for renderer flips, or a deleted node keeps a live
      // handler (and the shared timer never stops).
      this._pixMsRendererOff?.();
      this._pixMsRendererOff = null;
      if (this._pixMsRestoreTimer) {
        clearTimeout(this._pixMsRestoreTimer);
        this._pixMsRestoreTimer = null;
        this._pixMsRestoring = false;
      }
      if (this._pendingDisconnects?.size) {
        for (const timerId of this._pendingDisconnects.values()) {
          clearTimeout(timerId);
        }
        this._pendingDisconnects.clear();
      }
      return _origRemoved?.apply(this, arguments);
    };
  },
});

// (Bulk row toggles are now the getNodeMenuItems hook on the extension above —
// no getNodeMenuOptions monkey-patch.)

// The colour option: a right-click "Mute Switch settings" entry, the gear in the
// selection toolbar, and the shared colour panel behind both.
registerNodeAccent("PixaromaMuteSwitch", { title: "Mute Switch" });
