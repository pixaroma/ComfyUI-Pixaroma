import { app } from "/scripts/app.js";
import {
  setupNode, restoreFromProperties, readState,
  handleConnect, handleDisconnect, updateOutputType,
  STATE_PROP,
} from "./core.mjs";
import { drawSwitchRows, hitToggle, hitLabel, labelScreenRect } from "./render.mjs";
import { openLabelEditor, cancelEditorForNode } from "./editor.mjs";

// Switch Pixaroma - dynamic N-to-1 switch with per-row toggles.
// Rendering follows the Image Compare Pixaroma pattern: onDrawForeground
// paints row content at the same Y as LiteGraph's native input-dot positions;
// onMouseDown hit-tests those same rects and updates state.
//
// Vue Compat #9 pattern: state on node.properties, hidden SwitchState
// input populated by the graphToPrompt hook below.

const HIDDEN_INPUT_NAME = "SwitchState";

// True while a workflow is loading. The per-node _pixSwitchConfiguring flag
// (set in onConfigure) does NOT cover connection restoration: LiteGraph
// restores links at the GRAPH level AFTER each node's onConfigure has returned
// and cleared its flag, so handleConnect runs for every restored wire and
// overwrites the saved activeIndex (issue #40 - "switch resets on tab switch /
// reload"). Wrapping app.loadGraphData (the funnel for workflow open, tab
// switch, and Ctrl+Z undo - same fix as Image Resize) gives a load-wide guard,
// with a 300ms trailing window for the link restore that settles a tick later.
let _swLoadingGraph = false;
if (app && app.loadGraphData && !app._pixSwLoadWrapped) {
  app._pixSwLoadWrapped = true;
  const _origLoadGraphData = app.loadGraphData.bind(app);
  app.loadGraphData = function (...args) {
    _swLoadingGraph = true;
    let r;
    try { r = _origLoadGraphData(...args); }
    finally {
      Promise.resolve(r).finally(() => setTimeout(() => { _swLoadingGraph = false; }, 300));
    }
    return r;
  };
}

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

    // ── Removal ──────────────────────────────────────────────────────────
    // Cancel any open label editor so the DOM <input> is not left orphaned
    // in document.body after the node is deleted.
    // Also clear any pending disconnect timers - actuallyDisconnect already
    // guards on !node.graph, but cancelling the timers is cleaner and avoids
    // the deferred calls firing at all.
    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      cancelEditorForNode(this);
      if (this._pendingDisconnects?.size) {
        for (const timerId of this._pendingDisconnects.values()) {
          clearTimeout(timerId);
        }
        this._pendingDisconnects.clear();
      }
      return _origRemoved?.apply(this, arguments);
    };

    // ── Configure (workflow load / tab switch) ────────────────────────────
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      // Gate onConnectionsChange during configure so that LiteGraph's
      // connection-replay calls don't overwrite the saved activeIndex.
      // LGraphNode.configure() fires onConnectionsChange(INPUT, idx, true,
      // link, slot) for every restored connected slot - those calls would
      // route through handleConnect and unconditionally set
      // state.activeIndex = slotIdx, clobbering the value we're about to
      // restore from node.properties. The flag is cleared in `finally` so it
      // is always reset even if configure or restoreFromProperties throws.
      this._pixSwitchConfiguring = true;
      try {
        const r = _origConfigure?.apply(this, arguments);
        // Run normalize synchronously - by the time _origConfigure returns,
        // node.properties and node.inputs are already restored. Synchronous
        // call means the cleanup happens BEFORE the next paint frame, so
        // there's no visible flash of the 32 raw INPUT_TYPES slots that LG
        // creates before configure() applies the saved state.
        // (Vue Compat #8's queueMicrotask requirement is for onNodeCreated,
        // not onConfigure - in onConfigure, configure has already finished.)
        restoreFromProperties(this);
        return r;
      } finally {
        this._pixSwitchConfiguring = false;
      }
    };

    // ── Connection changes ────────────────────────────────────────────────
    // Skip handleConnect / handleDisconnect while _pixSwitchConfiguring is
    // set (workflow load and Ctrl+Z undo replay). Outside configure,
    // isConnected is the canonical signal: true means a fresh user wire just
    // landed, false means a user wire just left.
    //
    // We no longer gate on ioSlot.link != null. That check was a stale
    // defense from before _pixSwitchConfiguring existed. It now actively
    // breaks the grow-on-connect behaviour: LiteGraph sets ioSlot.link just
    // AFTER firing the event for a new wire, so the gate was silently
    // skipping handleConnect and no new empty trailing row appeared.
    const _origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (
      type, slotIndex, isConnected, link, ioSlot
    ) {
      // Two guards: _pixSwitchConfiguring (this node's onConfigure window) and
      // _swLoadingGraph (the graph-level link-restore window that fires AFTER
      // onConfigure - this is the one that was overwriting the saved
      // activeIndex on reload / tab switch, issue #40).
      if (type === 1 /* INPUT */ && !this._pixSwitchConfiguring && !_swLoadingGraph) {
        if (isConnected) handleConnect(this, slotIndex + 1);
        else handleDisconnect(this, slotIndex + 1);
      }
      return _origOnConnectionsChange?.apply(this, arguments);
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

          // Toggle hit-test takes priority over label.
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
                  updateOutputType(this);
                  app.graph?.setDirtyCanvas?.(true, true);
                }
              }
              return true; // consume the click even if no-op
            }
          }

          // Label hit-test: click anywhere on the label area opens the inline editor.
          for (let i = 0; i < inputs.length; i++) {
            if (hitLabel(pos, w, i)) {
              const rect = labelScreenRect(this, i + 1); // 1-based
              openLabelEditor(this, i + 1, rect);
              return true;
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
