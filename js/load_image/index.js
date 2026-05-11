import { app } from "/scripts/app.js";
import { BRAND, hideJsonWidget } from "../shared/index.mjs";

// State pattern mirrors Resolution Pixaroma (CLAUDE.md Vue Compat #9):
// hidden Python input + node.properties + app.graphToPrompt injection.
const STATE_PROP = "loadImagePixState";
const HIDDEN_INPUT_NAME = "LoadImagePixState";

export const DEFAULT_STATE = {
  version: 1,
  mode: "off",
  max_mp: 1.0,
  longest_side: 1024,
  scale_factor: 1.0,
  fit_w: 1024, fit_h: 1024,
  cover_w: 1024, cover_h: 1024,
  ratio_preset: "1:1",
  ratio_w: 1, ratio_h: 1,
  ratio_action: "crop",
  pad_color: "#000000",
  snap: 0,
  resample: "auto",
  allow_upscale: false,
};

export function readState(node) {
  const v = node.properties?.[STATE_PROP];
  if (typeof v === "string" && v) {
    try { return { ...DEFAULT_STATE, ...JSON.parse(v) }; }
    catch { /* fall through */ }
  }
  return { ...DEFAULT_STATE };
}

export function writeState(node, state) {
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = JSON.stringify(state);
}

function setupLoadImageNode(node) {
  // Defensive: hide the hidden STRING widget if one was created (stale Python,
  // or workflow loaded under an older architecture).
  hideJsonWidget(node.widgets, HIDDEN_INPUT_NAME);

  // Branded default colors (match Resolution Pixaroma).
  if (!node.color) node.color = "#1d1d1d";
  if (!node.bgcolor) node.bgcolor = "#2a2a2a";

  // Skeleton only — full UI build added in subsequent tasks.
  console.log("[PixaromaLoadImage] node created", node.id);
}

app.registerExtension({
  name: "Pixaroma.LoadImage",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaLoadImage") return;
    // onConfigure / onResize patches added in later tasks.
  },

  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaLoadImage") return;
    setupLoadImageNode(node);
  },
});

// ── app.graphToPrompt hook (subgraph-safe) ──────────────────────────────
// Same walk-and-inject pattern as Resolution Pixaroma's index.js. Required
// because LoadImagePixState is `hidden` (no widget) so the workflow JSON
// doesn't carry it; we inject from node.properties at submission time.

function buildPixaromaNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === "PixaromaLoadImage" || n.type === "PixaromaLoadImage") {
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
      if (!entry || entry.class_type !== "PixaromaLoadImage") continue;
      if (!index) index = buildPixaromaNodeIndex();
      const node = findPixaromaNode(index, id);
      const state = node?.properties?.[STATE_PROP] || JSON.stringify(DEFAULT_STATE);
      entry.inputs = entry.inputs || {};
      entry.inputs[HIDDEN_INPUT_NAME] = state;
    }
  }
  return result;
};
