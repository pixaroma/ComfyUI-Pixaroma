import { app } from "/scripts/app.js";
import {
  setupNode, restoreFromProperties,
  handleConnect, handleDisconnect,
  togglePillRow, setSelectMode, setMuteMode,
} from "./core.mjs";
import {
  drawMuteSwitch,
  hitSelectModePill, hitMutePill, hitRowPill,
} from "./render.mjs";

// Mute Switch Pixaroma - dynamic N-row mute control. See:
//   js/switch/index.js     for the structural reference
//   docs/superpowers/specs/2026-05-28-mute-switch-pixaroma-design.md

app.registerExtension({
  name: "Pixaroma.MuteSwitch",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaMuteSwitch") return;

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

    // Connection changes - minimal version for Task 2.
    const _origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (
      type, slotIndex, isConnected, link, ioSlot
    ) {
      if (type === 1 /* INPUT */ && !this._pixMsConfiguring) {
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
        }
      }
      if (_origDown) return _origDown.call(this, e, pos);
    };
  },
});
