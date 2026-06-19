import { app } from "/scripts/app.js";
import { applyAdaptiveCanvasOnly, isVueNodes, installResizeFloor } from "../shared/index.mjs";

// Portrait Landscape Pixaroma - two pill buttons (Portrait | Landscape) that
// choose the orientation of the width/height the node outputs. The node's
// width/height are native INT widgets (type a value OR wire one in); the
// Portrait/Landscape choice lives on node.properties.portraitLandscapeState
// and is injected into the hidden PortraitLandscapeState input by the
// app.graphToPrompt hook below (Switch WH / Resolution pattern, Vue Compat #9).

const BRAND = "#f66744";
const STATE_PROP = "portraitLandscapeState";
const HIDDEN_INPUT_NAME = "PortraitLandscapeState";
const DEFAULT_STATE = "portrait";

const BTN_H = 30;
const PAD = 6;
const GAP = 6;
const WIDGET_H = BTN_H + PAD * 2;

// Fresh-drop WIDTH (CLAUDE.md UI conventions #5) - wide enough that the two
// pills don't crowd. The HEIGHT is auto-fit to the content (title + the two
// number fields + the pill row) via node.computeSize(), so there's no empty
// gap under the pills and no over-tall default.
const DEFAULT_W = 240;
const MIN_W = 240;

function injectCSS() {
  if (document.getElementById("pix-portrait-landscape-css")) return;
  const style = document.createElement("style");
  style.id = "pix-portrait-landscape-css";
  style.textContent = `
    .pix-pl-root {
      display: flex;
      gap: ${GAP}px;
      padding: ${PAD}px;
      box-sizing: border-box;
      width: 100%;
      align-items: stretch;
    }
    .pix-pl-btn {
      flex: 1;
      min-width: 0;
      height: ${BTN_H}px;
      border-radius: 6px;
      /* Semi-transparent white overlay (not fixed dark grey) so the inactive
         button adapts when the user recolours the node via right-click ->
         Colors. Matches Switch WH / Text Pixaroma button style. */
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.05);
      color: rgba(255, 255, 255, 0.85);
      font-weight: 600;
      font-size: 13px;
      letter-spacing: 0.3px;
      cursor: pointer;
      transition: background 0.1s, border-color 0.1s, color 0.1s;
      font-family: inherit;
      padding: 0 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pix-pl-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.35);
      color: #fff;
    }
    .pix-pl-btn.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }
  `;
  document.head.appendChild(style);
}

function readState(node) {
  const v = node.properties?.[STATE_PROP];
  return v === "portrait" || v === "landscape" ? v : DEFAULT_STATE;
}

function writeState(node, state) {
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = state;
}

function buildRoot(node) {
  const root = document.createElement("div");
  root.className = "pix-pl-root";

  const btnP = document.createElement("button");
  btnP.className = "pix-pl-btn";
  btnP.textContent = "Portrait";
  btnP.title = "Tall: the smaller number becomes the width";
  btnP.dataset.value = "portrait";

  const btnL = document.createElement("button");
  btnL.className = "pix-pl-btn";
  btnL.textContent = "Landscape";
  btnL.title = "Wide: the larger number becomes the width";
  btnL.dataset.value = "landscape";

  root.appendChild(btnP);
  root.appendChild(btnL);

  function refresh() {
    const s = readState(node);
    btnP.classList.toggle("active", s === "portrait");
    btnL.classList.toggle("active", s === "landscape");
  }

  for (const b of [btnP, btnL]) {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      writeState(node, b.dataset.value);
      refresh();
      node.graph?.setDirtyCanvas?.(true, true);
    });
  }

  refresh();
  return { root, refresh };
}

function setupNode(node) {
  injectCSS();
  const { root, refresh } = buildRoot(node);
  node._pixPlRoot = root;
  node._pixPlRefresh = refresh;

  const measureHeight = () => WIDGET_H;

  const _plWidget = node.addDOMWidget("pixaroma_portrait_landscape_ui", "pixaroma_portrait_landscape", root, {
    // canvasOnly set adaptively below (CLAUDE.md Nodes 2.0): true in legacy
    // (out of the Parameters tab), false in Nodes 2.0 (renders in Vue body).
    getValue: () => null,
    setValue: () => {},
    getMinHeight: measureHeight,
    getMaxHeight: measureHeight,
    margin: 4,
    serialize: false,
  });
  applyAdaptiveCanvasOnly(_plWidget);

  // Nodes 2.0 drag floor: pin the pill row's min-height ONLY while a resize
  // handle is dragged so it can't be dragged out of the node frame (the Vue
  // renderer's drag floor is a live DOM measurement, not getMinHeight). No-op
  // in legacy. Uninstalled in onRemoved.
  node._pixPlFloorOff = installResizeFloor(root, () => WIDGET_H);

  // Fresh-drop size: width = DEFAULT_W, height = LiteGraph's natural content
  // height (title + the two number fields + the pill row) so the node hugs its
  // content with no empty gap. configure() runs AFTER nodeCreated (Vue Compat
  // #8) and overwrites both on workflow restore + duplicate, so existing
  // workflows keep their saved size; only fresh drops use this. Mutate the
  // array rather than replacing it (plays nicer with any reactive proxy).
  const snugH = node.computeSize()[1];
  node.size[0] = DEFAULT_W;
  node.size[1] = snugH;
  node.setDirtyCanvas(true, true);
}

app.registerExtension({
  name: "Pixaroma.PortraitLandscape",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPortraitLandscape") return;

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure?.apply(this, arguments);
      // Defer so node.properties is settled before we read it.
      queueMicrotask(() => this._pixPlRefresh?.());
      return r;
    };

    // Clamp manual resize WIDTH so the two pills never clip past the right
    // edge. Height is left to LiteGraph (its content-based min floors it, so
    // the node can't be dragged shorter than the pills + fields, and there's
    // no forced empty space). LEGACY-ONLY: in Nodes 2.0 the rendered size
    // lives in the Vue layout store, so clamping node.size there desyncs and
    // makes the node jump on a workflow switch (CLAUDE.md "Nodes 2.0
    // manual-resize MINIMUM").
    const _origOnResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      }
      if (_origOnResize) return _origOnResize.apply(this, arguments);
    };

    // Self-heal min size on every paint (Preview Image Pattern #11 + UI
    // conventions #7), catching resize paths that bypass onResize (Vue
    // Compat #13). Also legacy-only for the reason above.
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (_origDraw) _origDraw.call(this, ctx);
      if (isVueNodes()) return;
      if (this.flags?.collapsed) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
    };

    const _origOnRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixPlFloorOff?.();
      this._pixPlFloorOff = null;
      return _origOnRemoved?.apply(this, arguments);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaPortraitLandscape") return;
    setupNode(node);
  },
});

// ── app.graphToPrompt hook (subgraph-safe) ──────────────────────────────
// Same walk-and-inject pattern as Switch WH / Resolution Pixaroma. Required
// because PortraitLandscapeState is `hidden` (no widget) so the workflow JSON
// doesn't carry it; we inject from node.properties at submission time.

function buildPixaromaNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === "PixaromaPortraitLandscape" || n.type === "PixaromaPortraitLandscape") {
        index.set(String(n.id), n);
      }
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findPixaromaNode(index, promptId) {
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
      if (!entry || entry.class_type !== "PixaromaPortraitLandscape") continue;
      if (!index) index = buildPixaromaNodeIndex();
      const node = findPixaromaNode(index, id);
      const state = node?.properties?.[STATE_PROP] || DEFAULT_STATE;
      entry.inputs = entry.inputs || {};
      entry.inputs[HIDDEN_INPUT_NAME] = state;
    }
  }
  return result;
};
