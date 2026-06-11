// ╔═══════════════════════════════════════════════════════════════╗
// ║  Text Watermark Pixaroma — extension entry                   ║
// ║  Node body hosts the shared text_editor.mjs panel in          ║
// ║  watermarkMode (anchor + margin + Pixels/%-width). No editor. ║
// ║  Renderer + colors are reused from Text Overlay.              ║
// ╚═══════════════════════════════════════════════════════════════╝

import { app } from "/scripts/app.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { applyAdaptiveCanvasOnly } from "../shared/index.mjs";
import { createTextEditorPanel } from "../framework/text_editor.mjs";
import { DEFAULT_STATE, resetStateInPlace } from "./defaults.mjs";

const NODE_CLASS = "PixaromaTextWatermark";
const STATE_PROP = "textWatermarkState";
const HIDDEN_INPUT_NAME = "TextWatermarkState";

// Fixed panel height (Vue Compat #18 / Text Overlay Pattern #8): a constant
// keeps node.size byte-identical on every save/load, so a plain open+close
// never falsely flags the workflow "modified". BASE_H is the panel content
// height with the text-lock hint hidden; if the panel layout changes
// (add/remove a row), update BASE_H to match. HINT_H is the extra height when
// the `text` input is wired (the lock-hint row appears).
const BASE_H = 464;   // (was 412; +52 for the Text Direction caption + chip row)
const HINT_H = 18;
const MIN_W = 320;

app.registerExtension({
  name: "Pixaroma.TextWatermark",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_CLASS) return;

    const origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = origCreated?.apply(this, arguments);
      setupWatermarkNode(this);
      return r;
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      // Gate the text-lock resize during load. LGraphNode.configure() replays
      // onConnectionsChange for every wired slot (Vue Compat #17); without the
      // flag that replay could resize the node and falsely mark the workflow
      // modified on a plain open. Cleared in finally so it always resets.
      this._watermarkConfiguring = true;
      try {
        const r = origConfigure?.apply(this, arguments);
        ensureValidState(this);
        if (this._watermarkBodyPanel) {
          this._watermarkBodyPanel.setLayer(this.properties[STATE_PROP]);
        }
        refreshTextLock(this); // allowResize defaults false - no resize on load
        return r;
      } finally {
        this._watermarkConfiguring = false;
      }
    };

    const origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = origOnConnectionsChange?.apply(this, arguments);
      // Allow the resize only for REAL user wire changes - not the per-node
      // configure window NOR the graph-level connection replay during load
      // (Switch #40 / Image Resize bug class). Panel height is constant, so
      // this is belt-and-braces, but the guard keeps it robust.
      refreshTextLock(this, !this._watermarkConfiguring && !isGraphLoading());
      return r;
    };

    // Tear down the DOM panel when the node is deleted so its element + any
    // internal listeners are released (the panel's destroy() removes its root).
    const origOnRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try { this._watermarkBodyPanel?.destroy?.(); } catch { /* no-op */ }
      this._watermarkBodyPanel = null;
      this._watermarkBodyRoot = null;
      return origOnRemoved?.apply(this, arguments);
    };
  },
});

function ensureValidState(node) {
  if (!node.properties) node.properties = {};
  const cur = node.properties[STATE_PROP];
  if (!cur || cur.version !== DEFAULT_STATE.version) {
    node.properties[STATE_PROP] = { ...DEFAULT_STATE };
  }
}

function setupWatermarkNode(node) {
  ensureValidState(node);

  const root = document.createElement("div");
  root.style.cssText = "display:flex; flex-direction:column; gap:6px; padding:4px 0;";

  const panelMount = document.createElement("div");
  panelMount.style.cssText = "padding:0 4px;";
  root.appendChild(panelMount);

  const bodyPanel = createTextEditorPanel({
    mount: panelMount,
    watermarkMode: true,
    onChange: () => { node.setDirtyCanvas?.(true, true); },
    onReset: (state) => resetStateInPlace(state),
  });
  node._watermarkBodyPanel = bodyPanel;
  node._watermarkBodyRoot = root;

  function panelHeight() {
    const wired = node.inputs?.find((i) => i.name === "text")?.link != null;
    return BASE_H + (wired ? HINT_H : 0);
  }

  const _wmWidget = node.addDOMWidget("pix_text_watermark_ui", "div", root, {
    // canvasOnly set adaptively below (CLAUDE.md Nodes 2.0): true in legacy
    // (out of the Parameters tab), false in Nodes 2.0 (renders in Vue body).
    serialize: false,
    getMinHeight: panelHeight,
    getMaxHeight: panelHeight,
  });
  applyAdaptiveCanvasOnly(_wmWidget);

  // Default size for fresh nodes; LiteGraph restores saved sizes via configure.
  // +58 = node chrome (title bar + image/text input rows) measured for this
  // node, so a fresh drop fits exactly with no initial resize jump. Mutate the
  // array in place rather than replacing it (UI convention #9 - plays nicer
  // with any Vue reactive proxy on node.size).
  if (!node.size) {
    node.size = [340, BASE_H + 58];
  } else if (node.size[0] < 320) {
    node.size[0] = 340;
    node.size[1] = BASE_H + 58;
  }

  // Min-width self-heal on draw (Preview Image Pattern #11 / Vue Compat #13:
  // onResize is unreliable for DOM-widget resizes). setDirtyCanvas is a redraw
  // flag, not a change-tracker trip, so this does not dirty the workflow.
  const _origOnDrawForeground = node.onDrawForeground?.bind(node);
  node.onDrawForeground = function (ctx) {
    if (this.size && this.size[0] < MIN_W) {
      this.size[0] = MIN_W;
      this.setDirtyCanvas?.(true, true);
    }
    return _origOnDrawForeground ? _origOnDrawForeground(ctx) : undefined;
  };

  // Defer panel population past configure() so saved state is restored first
  // (Vue Compat #8: onNodeCreated fires before configure()).
  queueMicrotask(() => {
    bodyPanel.setLayer(node.properties[STATE_PROP]);
    refreshTextLock(node);
  });
}

// Gray out the textarea when the `text` input is wired (upstream value
// overrides the typed text). Resizes the node only for REAL user wire changes
// so a plain load can't dirty the workflow (Vue Compat #18).
function refreshTextLock(node, allowResize = false) {
  const panel = node._watermarkBodyPanel;
  if (!panel || typeof panel.setTextReadOnly !== "function") return;
  const wired = node.inputs?.find((i) => i.name === "text")?.link != null;
  panel.setTextReadOnly(wired, wired ? "Text input is wired - upstream value is used" : "");
  if (!allowResize) return;
  requestAnimationFrame(() => {
    if (typeof node.computeSize === "function" && node.size) {
      const min = node.computeSize();
      if (Array.isArray(min) && typeof min[1] === "number" && Math.abs(node.size[1] - min[1]) > 1) {
        node.size[1] = min[1];
        node.setDirtyCanvas?.(true, true);
        node.graph?.setDirtyCanvas?.(true, true);
      }
    }
  });
}

// ── Pattern #9: graphToPrompt hook injects the hidden state ──────────────────

function buildPixNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === NODE_CLASS || n.type === NODE_CLASS) index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findPixNode(index, promptId) {
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
      if (!entry || entry.class_type !== NODE_CLASS) continue;
      if (!index) index = buildPixNodeIndex();
      const node = findPixNode(index, id);
      const state = node?.properties?.[STATE_PROP] || DEFAULT_STATE;
      entry.inputs = entry.inputs || {};
      entry.inputs[HIDDEN_INPUT_NAME] = JSON.stringify(state);
    }
  }
  return result;
};
