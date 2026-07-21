// LoRA Loader Pixaroma - stack many LoRAs in one node. One DOM widget (Add / All /
// gear + a row per LoRA), fixed MODEL + CLIP inputs and MODEL + CLIP + triggers
// outputs. Works in BOTH renderers.
//
// Architecture mirrors Sizes / Resolution: state on node.properties.loraLoaderState,
// injected into the hidden LoraLoaderState input by the graphToPrompt hook below
// (Vue Compat #9). Info panel, gear panel, dropdown, and row menu live in siblings.

import { app } from "/scripts/app.js";
import { hideJsonWidget, applyAdaptiveCanvasOnly } from "../shared/index.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import {
  HIDDEN_INPUT, DEFAULT_STATE, MAX_LORAS,
  readState, loadDefaults, promptState,
} from "./core.mjs";
import { injectCSS, renderNode, contentHeight } from "./render.mjs";
import { attachInteractions } from "./interaction.mjs";
import { openLoraPanel, closeLoraPanelFor } from "./settings.mjs";
import { closeInfoPanelFor } from "./info_panel.mjs";
import { closeLoraDropdown } from "./dropdown.mjs";
import { closeRowMenu } from "./interaction.mjs";

const CLASS = "PixaromaLoraLoader";
const MIN_W = 300;
const CHROME = 66;      // legacy fallback: title + 2 input + 3 output slot rows
const VUE_CHROME = 96;  // Nodes 2.0 fallback

function widgetH(node) { return contentHeight(readState(node)); }

// The node height that shows every row with no scrollbar. Delegate the chrome
// (title + the input/output slot rows) to LiteGraph's computeSize; fall back to a
// constant estimate only if it's unavailable.
function fitNodeH(node) {
  try {
    const cs = node.computeSize?.();
    if (cs && cs[1] > 0) return Math.round(cs[1]);
  } catch (_e) { /* fall through */ }
  return widgetH(node) + (isVueNodes() ? VUE_CHROME : CHROME);
}

// Auto-fit the node height to its content. USER ACTIONS ONLY (never on the load
// path, or a saved size gets rewritten and a clean workflow opens "modified" -
// Vue Compat #18). Preserves the current width so a manual widen sticks.
function fitToContent(node) {
  if (isGraphLoading()) return;
  const w = Math.max(node.size?.[0] || MIN_W, MIN_W);
  const h = fitNodeH(node);
  if (node.setSize) node.setSize([w, h]);
  else node.size = [w, h];
}

function makeRefresh(node) {
  return (structural) => {
    renderNode(node);
    if (structural) fitToContent(node);
    node.setDirtyCanvas?.(true, true);
  };
}

function setupNode(node) {
  hideJsonWidget(node.widgets, HIDDEN_INPUT); // no-op: the Python input is hidden

  const root = document.createElement("div");
  root.className = "pix-ll-root";
  const inner = document.createElement("div");
  inner.className = "pix-ll-inner";
  root.appendChild(inner);

  const widget = node.addDOMWidget("loras_ui", "pixaroma_lora_loader", root, {
    getValue: () => readState(node),
    setValue: () => {},
    getMinHeight: () => widgetH(node),
    getMaxHeight: () => widgetH(node),
    margin: 4,
    serialize: false,
  });
  widget.computeLayoutSize = () => ({ minHeight: widgetH(node), minWidth: 1 });
  applyAdaptiveCanvasOnly(widget);

  node._pixLlRoot = root;
  node._pixLlInner = inner;

  // Fresh default size (configure() overrides this for a loaded node, Vue Compat #8).
  // Mutate in place rather than replacing the array (Vue may hold a reactive proxy).
  if (!Array.isArray(node.size)) node.size = [336, 0];
  node.size[0] = Math.max(node.size[0] || 0, 336);
  node.size[1] = fitNodeH(node);

  attachInteractions(node, widget.element || root, makeRefresh(node));

  // Defer the first populate past configure() so a restored workflow renders its
  // saved rows, not the default (Vue Compat #8). fitToContent bails on the load path.
  queueMicrotask(() => { renderNode(node); fitToContent(node); });
}

app.registerExtension({
  name: "Pixaroma.LoraLoader",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;
    if (nodeType.prototype._pixLlPatched) return;
    nodeType.prototype._pixLlPatched = true;

    injectCSS();

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure?.apply(this, arguments);
      if (this._pixLlRoot) { renderNode(this); fitToContent(this); }
      return r;
    };

    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      // Legacy ONLY: in Nodes 2.0 the rendered size lives in the Vue layout store and
      // getMinHeight/computeLayoutSize already lock the height - clamping node.size
      // here would desync and pop on a workflow-tab switch (Nodes 2.0 resize rule).
      if (!isVueNodes()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        this.size[1] = fitNodeH(this);
      }
      if (_origResize) return _origResize.call(this, size);
    };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeLoraPanelFor(this);
      closeInfoPanelFor(this);
      closeLoraDropdown(); // transient - also auto-closes on the canvas click that deletes
      closeRowMenu();
      return _origRemoved?.apply(this, arguments);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== CLASS) return;
    setupNode(node);
  },

  getNodeMenuItems(node) {
    if (node?.comfyClass !== CLASS) return [];
    return [
      { content: "⚙ LoRA Loader settings", callback: () => openLoraPanel(node, makeRefresh(node)) },
    ];
  },
});

// ── graphToPrompt: inject the per-node state (INJECT ONLY, never prune) ──────
function buildIndex() {
  const index = new Map();
  const visit = (graph, prefix) => {
    if (!graph) return;
    for (const n of graph._nodes || graph.nodes || []) {
      if (!n) continue;
      // Composite id (prefix "" at top level, "5:"-style inside a subgraph) so a
      // subgraph node exact-matches its "5:3" prompt id and can't collide with a
      // top-level node that happens to share the bare id (Load Image Mini fix).
      const cid = String(prefix) + n.id;
      if (n.comfyClass === CLASS || n.type === CLASS) {
        index.set(cid, n);
        // Bare id, FIRST-write-wins (top level visited first) so a subgraph node
        // never clobbers a top-level node's exact-id resolution.
        if (!index.has(String(n.id))) index.set(String(n.id), n);
      }
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner, cid + ":");
    }
  };
  visit(app.graph, "");
  return index;
}
function findNode(index, id) {
  const s = String(id);
  if (index.has(s)) return index.get(s);
  const tail = s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : null;
  return tail && index.has(tail) ? index.get(tail) : null;
}

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  try {
    const out = result?.output;
    if (out) {
      let index = null;
      for (const id in out) {
        const entry = out[id];
        if (!entry || entry.class_type !== CLASS) continue;
        if (!index) index = buildIndex();
        const node = findNode(index, id);
        const st = node ? readState(node) : { ...DEFAULT_STATE, ...loadDefaults(), loras: [] };
        entry.inputs = entry.inputs || {};
        entry.inputs[HIDDEN_INPUT] = JSON.stringify(promptState(st));
      }
    }
  } catch (e) {
    console.warn("[LoRA Loader Pixaroma] could not inject state:", (e && e.message) || e);
  }
  return result;
};

registerNodeHelp(CLASS, {
  title: "LoRA Loader Pixaroma",
  tagline: "Stack many LoRAs in one node, with trigger words read straight from each file.",
  sections: [
    {
      heading: "What it does",
      body:
        "Add as many LoRAs as you want, each on its own line with its own on/off switch and strength. " +
        "Wire your model (and clip) in the top, and the modified model and clip come out. You can chain " +
        "several of these nodes if you like.",
    },
    {
      heading: "Model and CLIP",
      body:
        "A LoRA can change two things: the image model (the drawing side, the required " +
        "model input) and CLIP (the part that reads your prompt words, the optional clip " +
        "input). Most of a LoRA's look comes from the model side, so it works with only " +
        "model connected. Connect clip too (checkpoint clip through this node and on to " +
        "your text encode) when you want the LoRA to also tune how its trigger words are " +
        "read - it matters most for trigger-word LoRAs. Leave clip unwired only in " +
        "model-only setups.",
    },
    {
      heading: "Each row",
      bullets: [
        "The name box opens a searchable list of your LoRAs (grouped by subfolder).",
        "The strength box: type a number, or use the small up/down arrows.",
        "The i button opens the info panel.",
        "The switch on the right turns that LoRA on or off; an off row dims.",
      ],
    },
    {
      heading: "Trigger words",
      body:
        "Click the i on a row to see the LoRA's info and its trigger words, read straight from the file - " +
        "no internet needed. Tap the words you want; the switched-on picks come out of the triggers output " +
        "as plain text you can wire into your prompt. If a LoRA has no words in its file, the optional " +
        "Civitai button can look them up online (only when you click it) and save them for next time.",
    },
    {
      heading: "Buttons and settings",
      body:
        "Add LoRA, the all on/off switch, and the gear sit in the middle of the node. The gear opens the " +
        "settings (default strength, step size, separate model and clip strengths, the trigger separator, " +
        "the Civitai button, thumbnails, and the highlight colour). Right-click a row to move it, duplicate " +
        "it, or remove it.",
    },
  ],
  footer: "Trigger words are read from the file, so it works offline. Civitai is optional and off until you click it.",
});
