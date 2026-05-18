// ╔═══════════════════════════════════════════════════════════════╗
// ║  Text Overlay Pixaroma — extension entry (simplified v2)     ║
// ║  Node body hosts the full text_editor.mjs panel + Open btn.  ║
// ║  Same panel re-mounted in editor right sidebar on open.      ║
// ╚═══════════════════════════════════════════════════════════════╝

import { app } from "/scripts/app.js";
import { TextOverlayEditor } from "./core.mjs";
import { createTextEditorPanel } from "../framework/text_editor.mjs";
import { loadFontForLayer, canvasFontString } from "../framework/fonts.mjs";
import { DEFAULT_STATE, resetStateInPlace } from "./defaults.mjs";
import "./interaction.mjs"; // side-effect: registers prototype methods

const NODE_CLASS = "PixaromaTextOverlay";
const STATE_PROP = "textOverlayState";
const HIDDEN_INPUT_NAME = "TextOverlayState";

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
      ensureValidState(this);
      // After configure, push current state into the body panel UI
      if (this._textOverlayBodyPanel) {
        this._textOverlayBodyPanel.setLayer(this.properties[STATE_PROP]);
      }
      return r;
    };
  },
});

function ensureValidState(node) {
  if (!node.properties) node.properties = {};
  const cur = node.properties[STATE_PROP];
  // Reset to defaults when version is missing or older than current.
  // v1 (multi-layer) and v2 (bad defaults) both replaced wholesale.
  if (!cur || cur.version !== 3) {
    node.properties[STATE_PROP] = { ...DEFAULT_STATE };
  }
}

function setupTextOverlayNode(node) {
  ensureValidState(node);

  const root = document.createElement("div");
  root.style.cssText = "display:flex; flex-direction:column; gap:6px; padding:4px 0;";

  // Open Text Editor button at the top
  const btn = document.createElement("button");
  btn.textContent = "Open Text Editor";
  btn.style.cssText = "background:#f66744; color:#fff; border:none; padding:8px; border-radius:4px; font:600 13px system-ui; cursor:pointer;";
  btn.addEventListener("click", () => openEditor(node));
  root.appendChild(btn);

  // The shared text_editor.mjs panel mounted on the node body
  const panelMount = document.createElement("div");
  panelMount.style.cssText = "padding:0 4px;";
  root.appendChild(panelMount);

  const bodyPanel = createTextEditorPanel({
    mount: panelMount,
    onChange: () => {
      // Sync the editor's panel (if editor is open) + re-render its canvas
      if (node._textOverlayEditor && node._textOverlayEditor.layout?.overlay?.isConnected) {
        node._textOverlayEditor.editorPanel?.setLayer?.(node.properties[STATE_PROP]);
        node._textOverlayEditor.requestRender?.();
      }
      node.setDirtyCanvas?.(true, true);
    },
    // Reset to DEFAULT_STATE in-place so both the body panel + (if open)
    // editor sidebar point at the same restored object. We mutate keys
    // rather than replace the object so existing references stay valid.
    onReset: (layer) => resetStateInPlace(layer),
  });
  node._textOverlayBodyPanel = bodyPanel;
  node._textOverlayBodyRoot = root;

  // Intrinsic content-height measurement, mirrors Load Image's
  // measureContentHeight pattern: sum children's offsetHeight + the panel's
  // padding (8px top + 8px bottom = 16px) + flex gaps (5px between visible
  // children). Do NOT use root.scrollHeight: LiteGraph stretches root when
  // the node is taller than minimum and that creates a feedback loop where
  // every paint reports a larger height. Children offsetHeight is intrinsic
  // and stable.
  function measureContentHeight() {
    let totalH = 0;
    let visible = 0;
    for (const child of root.children) {
      const style = window.getComputedStyle(child);
      if (style.position === "absolute" || style.position === "fixed") continue;
      if (style.display === "none") continue;
      totalH += child.offsetHeight;
      visible += 1;
    }
    const padding = 16;            // 8px top + 8px bottom (matches CSS)
    const gaps    = Math.max(0, visible - 1) * 5; // flex gap: 5px in CSS
    return Math.max(320, totalH + padding + gaps);
  }

  node.addDOMWidget("pix_text_overlay_ui", "div", root, {
    canvasOnly: true,
    serialize: false,
    getMinHeight: measureContentHeight,
    // Cap height at content size so manual node resize gives the slack to
    // ComfyUI's input slot area / blank space, not stretches this panel.
    // Without getMaxHeight the layout engine treats this widget as
    // stretchable and the bottom of the panel sits below where the
    // background ends, leaving the Reset button visually outside the node.
    getMaxHeight: measureContentHeight,
  });

  // Default size for new nodes; LiteGraph restores saved sizes via configure.
  // The compact v2 layout fits comfortably in ~430 px.
  if (!node.size || node.size[0] < 320) {
    node.size = [340, 430];
  }

  // Enforce a minimum node width so the user can't drag-shrink so narrow
  // that the input values get clipped and labels overlap. 320 px is the
  // smallest width where two number cells (LABEL value spinner) still
  // render without overflow. Override computeSize (LiteGraph polls this
  // when computing layout bounds) and self-heal on draw (Vue Compat #13
  // says onResize is unreliable for DOM widget resizes).
  const MIN_W = 320;
  const _origComputeSize = node.computeSize?.bind(node);
  node.computeSize = function () {
    const s = _origComputeSize ? _origComputeSize() : [MIN_W, measureContentHeight()];
    return [Math.max(MIN_W, s[0] || MIN_W), s[1]];
  };
  const _origOnDrawForeground = node.onDrawForeground?.bind(node);
  node.onDrawForeground = function (ctx) {
    if (this.size[0] < MIN_W) {
      this.size[0] = MIN_W;
      this.setDirtyCanvas?.(true, true);
    }
    return _origOnDrawForeground?.(ctx);
  };

  // Defer panel population past configure() so saved state is restored first
  queueMicrotask(() => {
    bodyPanel.setLayer(node.properties[STATE_PROP]);
  });
}

function openEditor(node) {
  if (node._textOverlayEditor && node._textOverlayEditor.layout?.overlay?.isConnected) return;
  const editor = new TextOverlayEditor(node);
  node._textOverlayEditor = editor;
  editor.open().catch((e) => {
    console.error("[Text Overlay] open failed", e);
    try { editor.close(); } catch {}
  });
}

// ── Pattern #9: graphToPrompt hook (mostly unchanged, simpler payload) ───

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

      // First-run auto-center: if the node has never been centered (fresh
      // node, _autoCenterPending flag still set) and the upstream image is
      // available, compute centered x/y now so the first workflow render
      // shows the text in the middle of the image instead of top-left.
      // Mirrors the same logic the editor's _autoCenter() runs on open.
      if (state._autoCenterPending && state.text && node) {
        try {
          const img = getUpstreamImage(node);
          if (img && img.naturalWidth && img.naturalHeight) {
            const bbox = await measureTextBbox(state);
            state.x = Math.max(0, Math.round((img.naturalWidth - bbox.w) / 2));
            state.y = Math.max(0, Math.round((img.naturalHeight - bbox.h) / 2));
            delete state._autoCenterPending;
            // Sync body panel + repaint so user sees the new position
            if (node._textOverlayBodyPanel) node._textOverlayBodyPanel.setLayer(state);
            node.setDirtyCanvas?.(true, true);
          }
        } catch (e) {
          console.warn("[Text Overlay] auto-center on submit failed", e);
        }
      }

      entry.inputs = entry.inputs || {};
      entry.inputs[HIDDEN_INPUT_NAME] = JSON.stringify(state);
    }
  }
  return result;
};

// Resolve the upstream image wired to this node's `image` input, returning
// the HTMLImageElement on the upstream node (e.g. Load Image's preview) or
// null. Same shape as core.mjs::_tryLoadUpstreamImage.
function getUpstreamImage(node) {
  const link = node.inputs?.find((i) => i.name === "image")?.link;
  if (!link) return null;
  const graph = window.app.graph;
  let linkObj = graph.links?.[link];
  if (!linkObj && typeof graph.links?.get === "function") linkObj = graph.links.get(link);
  if (!linkObj) return null;
  const upstream = graph.getNodeById(linkObj.origin_id);
  return upstream?.imgs?.[0] || null;
}

// Measure the rendered bbox of the state's text using the same canvas-text
// math as the live editor (and the Python renderer). Returns { w, h }.
let _measureCanvas = null;
async function measureTextBbox(state) {
  const variant = await loadFontForLayer(state.font || "Inter", state.weight || 400, !!state.italic);
  const fontStr = canvasFontString(variant, state.fontSize || 96);
  if (!_measureCanvas) {
    _measureCanvas = document.createElement("canvas");
    _measureCanvas.width = 1;
    _measureCanvas.height = 1;
  }
  const ctx = _measureCanvas.getContext("2d");
  ctx.font = fontStr;
  const lines = String(state.text ?? "").split("\n");
  const letterSpacing = state.letterSpacing || 0;
  const lineWidths = lines.map((ln) => {
    if (letterSpacing === 0) return ctx.measureText(ln).width;
    let w = 0; for (const c of ln) w += ctx.measureText(c).width;
    return w + Math.max(0, ln.length - 1) * letterSpacing;
  });
  const maxLineW = Math.max(0, ...lineWidths);
  const m = ctx.measureText("Mg");
  const ascender = m.actualBoundingBoxAscent || (state.fontSize || 96) * 0.78;
  const descender = m.actualBoundingBoxDescent || (state.fontSize || 96) * 0.22;
  const lineHeightPx = Math.round((state.fontSize || 96) * (state.lineHeight || 1.2));
  const padX = state.bgColor ? 16 : 0;
  const padY = state.bgColor ? 10 : 0;
  return {
    w: Math.ceil(maxLineW + 2 * padX),
    h: Math.ceil(ascender + descender + Math.max(0, lines.length - 1) * lineHeightPx + 2 * padY),
  };
}
