import { app } from "/scripts/app.js";

// Switch WH Pixaroma - two big A/B buttons that pick which width/height
// pair flows through. State lives on node.properties.switchWhState and is
// injected into the hidden SwitchWHState input by the app.graphToPrompt
// hook below (Resolution Pixaroma pattern, CLAUDE.md Vue Compat #9).

const BRAND = "#f66744";
const STATE_PROP = "switchWhState";
const HIDDEN_INPUT_NAME = "SwitchWHState";
const DEFAULT_STATE = "A";

const BTN_H = 30;
const PAD = 6;
const GAP = 6;
const WIDGET_H = BTN_H + PAD * 2;

function injectCSS() {
  if (document.getElementById("pix-switchwh-css")) return;
  const style = document.createElement("style");
  style.id = "pix-switchwh-css";
  style.textContent = `
    .pix-swh-root {
      display: flex;
      gap: ${GAP}px;
      padding: ${PAD}px;
      box-sizing: border-box;
      width: 100%;
      align-items: stretch;
    }
    .pix-swh-btn {
      flex: 1;
      height: ${BTN_H}px;
      border-radius: 6px;
      border: 1px solid #444;
      background: #2a2a2a;
      color: #cfcfcf;
      font-weight: 600;
      font-size: 13px;
      letter-spacing: 0.5px;
      cursor: pointer;
      transition: background 0.1s, border-color 0.1s, color 0.1s;
      font-family: inherit;
      padding: 0;
    }
    .pix-swh-btn:hover { border-color: #888; color: #fff; }
    .pix-swh-btn.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }
  `;
  document.head.appendChild(style);
}

function readState(node) {
  const v = node.properties?.[STATE_PROP];
  return v === "A" || v === "B" ? v : DEFAULT_STATE;
}

function writeState(node, state) {
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = state;
}

function buildRoot(node) {
  const root = document.createElement("div");
  root.className = "pix-swh-root";

  const btnA = document.createElement("button");
  btnA.className = "pix-swh-btn";
  btnA.textContent = "A";
  btnA.dataset.value = "A";

  const btnB = document.createElement("button");
  btnB.className = "pix-swh-btn";
  btnB.textContent = "B";
  btnB.dataset.value = "B";

  root.appendChild(btnA);
  root.appendChild(btnB);

  function refresh() {
    const s = readState(node);
    btnA.classList.toggle("active", s === "A");
    btnB.classList.toggle("active", s === "B");
  }

  for (const b of [btnA, btnB]) {
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
  node._pixSwhRoot = root;
  node._pixSwhRefresh = refresh;

  const measureHeight = () => WIDGET_H;

  node.addDOMWidget("pixaroma_switch_wh_ui", "custom", root, {
    canvasOnly: true,  // Vue Compat #15 - hide from Parameters tab
    getValue: () => null,
    setValue: () => {},
    getMinHeight: measureHeight,
    getMaxHeight: measureHeight,
    margin: 4,
    serialize: false,
  });
}

app.registerExtension({
  name: "Pixaroma.SwitchWH",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaSwitchWH") return;
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure?.apply(this, arguments);
      // Defer so node.properties is settled before we read it.
      queueMicrotask(() => this._pixSwhRefresh?.());
      return r;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaSwitchWH") return;
    setupNode(node);
  },
});

// ── app.graphToPrompt hook (subgraph-safe) ──────────────────────────────
// Same walk-and-inject pattern as Resolution Pixaroma's index.js. Required
// because SwitchWHState is `hidden` (no widget) so the workflow JSON
// doesn't carry it; we inject from node.properties at submission time.

function buildPixaromaNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === "PixaromaSwitchWH" || n.type === "PixaromaSwitchWH") {
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
      if (!entry || entry.class_type !== "PixaromaSwitchWH") continue;
      if (!index) index = buildPixaromaNodeIndex();
      const node = findPixaromaNode(index, id);
      const state = node?.properties?.[STATE_PROP] || DEFAULT_STATE;
      entry.inputs = entry.inputs || {};
      entry.inputs[HIDDEN_INPUT_NAME] = state;
    }
  }
  return result;
};
