import { app } from "/scripts/app.js";
import {
  setupNode, restoreFromProperties, readState,
  handleConnect, handleDisconnect,
  STATE_PROP,
} from "./core.mjs";
import { drawSwitchRows, hitToggle } from "./render.mjs";

// Switch Pixaroma - dynamic N-to-1 switch with per-row toggles.
// Rendering follows the Image Compare Pixaroma pattern: onDrawForeground
// paints row content at the same Y as LiteGraph's native input-dot positions;
// onMouseDown hit-tests those same rects and updates state.
//
// Vue Compat #9 pattern: state on node.properties, hidden SwitchState
// input populated by the graphToPrompt hook below.

const HIDDEN_INPUT_NAME = "SwitchState";

app.registerExtension({
  name: "Pixaroma.Switch",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaSwitch") return;

    // ── Creation ─────────────────────────────────────────────────────────
    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _origCreated?.apply(this, arguments);
      setupNode(this);
      // Defer restore so node.properties is populated from workflow JSON
      // before we read it (Vue Compat #8).
      queueMicrotask(() => restoreFromProperties(this));
    };

    // ── Configure (workflow load / tab switch) ────────────────────────────
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure?.apply(this, arguments);
      queueMicrotask(() => restoreFromProperties(this));
      return r;
    };

    // ── Connection changes ────────────────────────────────────────────────
    nodeType.prototype.onConnectionsChange = function (
      type, slotIndex, isConnected, link, ioSlot
    ) {
      if (type === 1 /* INPUT */) {
        if (isConnected) handleConnect(this, slotIndex + 1);
        else handleDisconnect(this, slotIndex + 1);
      }
    };

    // ── Drawing (Image Compare pattern) ──────────────────────────────────
    // onDrawForeground receives ctx already translated so (0,0) = node body
    // top-left. We paint row content (label + toggle) at the same Y that
    // LiteGraph paints its native input dots.
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (_origDraw) _origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      drawSwitchRows(this, ctx);
    };

    // ── Clicks (Image Compare pattern) ───────────────────────────────────
    // pos is node-body-local [x, y], same coordinate space as our rects.
    const _origDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (e, pos) {
      if (!this.flags?.collapsed) {
        const inputs = this.inputs;
        if (inputs) {
          const w = this.size[0];
          for (let i = 0; i < inputs.length; i++) {
            if (hitToggle(pos, w, i)) {
              const slotIdx1 = i + 1;
              const slot = inputs[i];
              const connected = slot != null && slot.link != null;
              const isTrailing = !connected && slotIdx1 === inputs.length;
              if (connected && !isTrailing) {
                const state = readState(this);
                // Clicking the already-active toggle is a no-op (mutex:
                // only one row can be active, so there's nothing to switch to).
                if (state.activeIndex !== slotIdx1) {
                  state.activeIndex = slotIdx1;
                  app.graph?.setDirtyCanvas?.(true, true);
                }
              }
              return true; // consume the click even if no-op
            }
          }
        }
      }
      if (_origDown) return _origDown.call(this, e, pos);
    };
  },
});

// ── app.graphToPrompt hook (subgraph-safe) ────────────────────────────────
// Injects the active slot index into the hidden SwitchState input at
// submission time. Pattern #9 (same as Resolution Pixaroma / Switch WH).

function buildSwitchNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === "PixaromaSwitch" || n.type === "PixaromaSwitch") {
        index.set(String(n.id), n);
      }
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findSwitchNode(index, promptId) {
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (tail && index.has(tail)) return index.get(tail);
  return null;
}

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  const out = result?.output;
  if (out) {
    let index = null;
    for (const id in out) {
      const entry = out[id];
      if (!entry || entry.class_type !== "PixaromaSwitch") continue;
      if (!index) index = buildSwitchNodeIndex();
      const node = findSwitchNode(index, id);
      const state = node?.properties?.[STATE_PROP];
      // activeIndex 0 means nothing is connected yet - fall back to 1 so
      // Python surfaces a clear "not connected" error rather than a crash.
      const activeIdx = state?.activeIndex || 1;
      entry.inputs = entry.inputs || {};
      entry.inputs[HIDDEN_INPUT_NAME] = String(activeIdx);
    }
  }
  return result;
};
