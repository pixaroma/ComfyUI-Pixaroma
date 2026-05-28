import { app } from "/scripts/app.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import {
  setupNode, restoreFromProperties,
  handleConnect, handleDisconnect,
  togglePillRow, setSelectMode, setMuteMode,
  restoreAllOnRemove,
} from "./core.mjs";
import {
  drawMuteSwitch, hideTooltip,
  hitSelectModePill, hitMutePill, hitRowPill, hitLabel, labelScreenRect,
} from "./render.mjs";
import { openLabelEditor, cancelEditorForNode } from "./editor.mjs";

// Mute Switch Pixaroma - dynamic N-row mute control. See:
//   js/switch/index.js     for the structural reference
//   docs/superpowers/specs/2026-05-28-mute-switch-pixaroma-design.md

app.registerExtension({
  name: "Pixaroma.MuteSwitch",

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
      queueMicrotask(() => restoreFromProperties(this));
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
      // Self-heal min width / height (Vue Compat #13 + Preview Image #11).
      // MIN_W = 260 leaves clear horizontal headroom between the right-side
      // pill and the phantom output dot at the right edge.
      const MIN_W = 260;
      const MIN_H = 80;
      let changed = false;
      if (this.size[0] < MIN_W) { this.size[0] = MIN_W; changed = true; }
      if (this.size[1] < MIN_H) { this.size[1] = MIN_H; changed = true; }
      if (changed) this.graph?.setDirtyCanvas?.(true, true);

      if (_origDraw) _origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      drawMuteSwitch(this, ctx);
    };

    // Mouse clicks
    const _origDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (e, pos) {
      if (!this.flags?.collapsed) {
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

    // Removal - hide tooltip + restore muted nodes + cancel editor + clear pending.
    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this._pixMsHover) hideTooltip();
      restoreAllOnRemove(this);
      cancelEditorForNode(this);
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
