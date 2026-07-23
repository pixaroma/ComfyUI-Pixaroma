import { app } from "/scripts/app.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import {
  setupNode, restoreFromProperties,
  handleConnect, handleDisconnect,
  togglePillRow, setSelectMode, setMuteMode,
  setAllRowsEnabled, restoreAllOnRemove,
  computeNodeHeight,
} from "./core.mjs";
import {
  drawMuteSwitch, hideTooltip,
  hitSelectModePill, hitMutePill, hitRowPill, hitLabel, labelScreenRect,
} from "./render.mjs";
import { openLabelEditor, cancelEditorForNode } from "./editor.mjs";
import { buildMuteSwitchVueList } from "./vue_list.mjs";

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

    // Creation
    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _origCreated?.apply(this, arguments);
      setupNode(this);
      // Nodes 2.0 only: build the DOM body (mode bar + scene rows). It wires
      // itself as node._pixMsRefresh, which core.mjs calls on every state/slot
      // change. Legacy paints the body on the canvas instead (onDrawForeground).
      if (isVueNodes()) buildMuteSwitchVueList(this);
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
    const _origSerialize = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function () {
      const o = _origSerialize?.apply(this, arguments);
      if (o?.inputs) {
        for (const inp of o.inputs) {
          if (inp && inp.widget) delete inp.widget;
        }
      }
      return o;
    };

    // Configure (workflow load / undo restore)
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      this._pixMsConfiguring = true;
      try {
        const r = _origConfigure?.apply(this, arguments);
        restoreFromProperties(this);
        return r;
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
