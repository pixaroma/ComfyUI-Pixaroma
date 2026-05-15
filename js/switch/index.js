import { app } from "/scripts/app.js";
import { setupNode, restoreFromProperties, STATE_PROP } from "./core.mjs";

// Switch Pixaroma - dynamic N-to-1 switch with per-row labels and
// toggles. Vue Compat #9 pattern: state on node.properties, hidden
// SwitchState input populated by the graphToPrompt hook below.

const HIDDEN_INPUT_NAME = "SwitchState";

app.registerExtension({
  name: "Pixaroma.Switch",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaSwitch") return;
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure?.apply(this, arguments);
      // Vue Compat #8: defer initial restore so node.properties has
      // been populated from the workflow JSON.
      queueMicrotask(() => restoreFromProperties(this));
      return r;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaSwitch") return;
    setupNode(node);
  },
});

// app.graphToPrompt hook (subgraph-safe). Same shape as Switch WH and
// Resolution. Injects the active slot index into the hidden SwitchState
// input at submission time, since no widget carries it through the
// normal workflow JSON path (Pattern #9).
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
      // activeIndex 0 = "no row connected yet" (Task 6 sets it to 1
      // on the first connect). The || 1 fallback prevents a Python
      // error on a fresh-drop run where the user runs the workflow
      // without wiring anything (the run will still error correctly
      // in Python with a clear "no input connected" message).
      const activeIdx = state?.activeIndex || 1;
      entry.inputs = entry.inputs || {};
      entry.inputs[HIDDEN_INPUT_NAME] = String(activeIdx);
    }
  }
  return result;
};
