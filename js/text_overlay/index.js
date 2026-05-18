// ╔═══════════════════════════════════════════════════════════════╗
// ║  Text Overlay Pixaroma — extension entry                     ║
// ║  - In-node button + preview thumbnail                        ║
// ║  - Opens fullscreen editor                                   ║
// ║  - Pattern #9 graphToPrompt hook                             ║
// ╚═══════════════════════════════════════════════════════════════╝

import { app } from "/scripts/app.js";
import { TextOverlayEditor } from "./core.mjs";
import "./interaction.mjs"; // side-effect import to register prototype methods

const NODE_CLASS = "PixaromaTextOverlay";
const STATE_PROP = "textOverlayState";
const HIDDEN_INPUT_NAME = "TextOverlayState";
const DEFAULT_STATE = {
  version: 1,
  canvasWidth: 1024,
  canvasHeight: 1024,
  bgColor: "#000000",
  layers: [],
  previewUrl: "",
};

const BTN_HEIGHT = 32;
const PREVIEW_MAX_H = 200;

app.registerExtension({
  name: "Pixaroma.TextOverlay",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_CLASS) return;

    const origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = origCreated?.apply(this, arguments);
      setupTextOverlayNode(this);
      return r;
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = origConfigure?.apply(this, arguments);
      restoreFromProperties(this);
      return r;
    };
  },
});

function setupTextOverlayNode(node) {
  if (!node.properties) node.properties = {};
  if (!node.properties[STATE_PROP]) {
    node.properties[STATE_PROP] = { ...DEFAULT_STATE };
  }

  const root = document.createElement("div");
  root.style.cssText = "display:flex; flex-direction:column; gap:6px; padding:4px 0;";

  const btn = document.createElement("button");
  btn.textContent = "Open Text Overlay";
  btn.style.cssText = `background:#f66744; color:#fff; border:none; padding:8px; border-radius:4px; font:600 13px system-ui; cursor:pointer; height:${BTN_HEIGHT}px;`;
  btn.addEventListener("click", () => openEditor(node));
  root.appendChild(btn);

  const previewImg = document.createElement("img");
  previewImg.alt = "Text Overlay preview";
  previewImg.style.cssText = `width:100%; max-height:${PREVIEW_MAX_H}px; object-fit:contain; background:#0d0d0d; border:1px solid #333; border-radius:4px; display:none;`;
  root.appendChild(previewImg);

  node.addDOMWidget("pix_text_overlay_ui", "div", root, {
    canvasOnly: true,
    serialize: false,
    getMinHeight: () => BTN_HEIGHT + (previewImg.style.display === "none" ? 8 : PREVIEW_MAX_H + 12),
  });

  node._textOverlayPreviewImg = previewImg;
  node._textOverlayRoot = root;

  // Default size for new nodes; LiteGraph configure() restores saved sizes
  if (!node.size || node.size[0] < 280) { node.size = [320, 280]; }

  // Vue Compat #8 + Preview Image Pattern #4: defer restore past configure
  queueMicrotask(() => restoreFromProperties(node));
}

function restoreFromProperties(node) {
  const url = node.properties?.[STATE_PROP]?.previewUrl;
  if (!url || !node._textOverlayPreviewImg) return;
  if (node._textOverlayPreviewImg.src === url) return; // idempotent
  node._textOverlayPreviewImg.src = url;
  node._textOverlayPreviewImg.style.display = "block";
}

function openEditor(node) {
  // If editor already open and connected, focus it
  if (node._textOverlayEditor && node._textOverlayEditor.layout?.overlay?.isConnected) return;
  const editor = new TextOverlayEditor(node);
  node._textOverlayEditor = editor;
  editor.open().catch((e) => {
    console.error("[Text Overlay] open failed", e);
    try { editor.close(); } catch {}
  });
}

// ── Pattern #9: graphToPrompt hook ────────────────────────────────────────────

function buildPixNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === NODE_CLASS || n.type === NODE_CLASS) {
        index.set(String(n.id), n);
      }
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
