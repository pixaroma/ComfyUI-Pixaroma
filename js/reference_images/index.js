// Reference Images Pixaroma - wiring.
//
// Up to 8 reference pictures on one node, each with a role, and a prompt that
// names every picture the way the model expects it (<image1> for Qwen Image
// 2.1, <ref_image_0> for FLUX 3 Image Klein, <Picture 1> for MiniMax H3,
// "image 1" for the rest). Classic and Nodes 2.0 alike.
//
// core.mjs state + the prompt (pure) | actions.mjs every change, the output
// dots, uploads | ui.mjs the face | popup.mjs the dropdown | settings.mjs the
// gear panel | css.mjs | help.mjs

import { app } from "../../../scripts/app.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { isLiveNode } from "../shared/live_node.mjs";
import { registerNodeSettings } from "../shared/node_settings.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import { onRendererChange } from "../shared/renderer_switch.mjs";
import { runTab, eachRestoredOutput } from "../shared/run_tab.mjs";
import { CLASS, HIDDEN_INPUT, detectModel, injectedState } from "./core.mjs";
import { addFiles, isPicture, syncOutputs } from "./actions.mjs";
import { REFERENCE_IMAGES_HELP } from "./help.mjs";
import { closeSettingsPanelFor, openSettingsPanel } from "./settings.mjs";
import { FLOOR, MIN_W, buildFace, destroyFace, renderFace } from "./ui.mjs";

const DEFAULT_W = 480;
const DEFAULT_H = 640;
const POLL_MS = 800;

registerNodeHelp(CLASS, REFERENCE_IMAGES_HELP);
registerNodeSettings(CLASS, {
  title: "Reference Images",
  open: (node) => openSettingsPanel(node),
  closeFor: (node) => closeSettingsPanelFor(node),
});

// The graph the node sits in, in the API prompt's shape, so Auto can use the
// SAME walk as the run (core.mjs detectModel = _ref_images_helpers.detect_model).
function graphAsPrompt(graph) {
  const out = {};
  const links = graph?.links;
  const linkOf = (id) => (links?.get ? links.get(id) : links?.[id]);
  for (const n of graph?._nodes || graph?.nodes || []) {
    if (!n) continue;
    const inputs = {};
    for (const inp of n.inputs || []) {
      if (!inp || inp.link == null) continue;
      const l = linkOf(inp.link);
      if (l) inputs[inp.name] = [String(l.origin_id), l.origin_slot];
    }
    out[String(n.id)] = { class_type: n.comfyClass || n.type, inputs };
  }
  return out;
}

function liveModel(node) {
  try {
    return detectModel(graphAsPrompt(node.graph), node.id);
  } catch {
    return "plain";
  }
}

function refreshLive(node) {
  if (!node?._pixRfiFace) return;
  const m = liveModel(node);
  const wired = node.inputs?.find((i) => i?.name === "text")?.link != null;
  const sig = `${m}|${wired}`;
  if (sig === node._pixRfiLiveSig) return;
  node._pixRfiLiveSig = sig;
  node._pixRfiLive = m;
  renderFace(node, false);
}

function applyRun(node, message) {
  const entry = message?.pixaroma_ref_images?.[0];
  if (!entry) return;
  // Runtime only, never serialized.
  node._pixRfiRun = { model: entry.model, prompt: entry.prompt };
  renderFace(node, false);
}

// Ctrl+V with exactly one Reference Images node selected adds the picture to
// it. Capture phase on window, so ComfyUI does not ALSO paste it as a new
// Load Image node (the same shape as js/load_image/api.mjs installLoaderPaste).
let _shiftPaste = false;
function selectedRefNode() {
  const sel = app.canvas?.selected_nodes;
  const list = sel ? Object.values(sel) : [];
  if (list.length !== 1) return null;
  const n = list[0];
  return n && (n.comfyClass === CLASS || n.type === CLASS) && n.graph ? n : null;
}
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && String(e.key || "").toLowerCase() === "v") _shiftPaste = e.shiftKey;
}, true);
window.addEventListener("paste", (e) => {
  const shift = _shiftPaste;
  _shiftPaste = false;
  const node = selectedRefNode();
  if (!node || shift) return;
  const t = e.target;
  const tag = String(t?.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
  const files = [];
  for (const item of e.clipboardData?.items || []) {
    if (item.kind === "file" && String(item.type || "").startsWith("image/")) {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  if (!files.length) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  addFiles(node, files);
}, true);

app.registerExtension({
  name: "Pixaroma.ReferenceImages",

  onNodeOutputsUpdated(nodeOutputs) {
    eachRestoredOutput(nodeOutputs, CLASS, (node, output) => applyRun(node, output));
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    if (nodeType.prototype._pixRfiPatched) return;
    nodeType.prototype._pixRfiPatched = true;

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      const node = this;
      // Read ONCE, here (Vue Compat #19): a deferred frame cannot tell.
      const bornInLoad = isGraphLoading();
      buildFace(node, { onGear: () => openSettingsPanel(node) });
      node._pixRfiRefresh = () => renderFace(node, false);

      // Fresh size, SYNCHRONOUSLY: configure() runs next and restores a saved
      // size, so a deferred write would clobber it on every reload (#9).
      if (!Array.isArray(node.size)) node.size = [DEFAULT_W, DEFAULT_H];
      node.size[0] = DEFAULT_W;
      node.size[1] = DEFAULT_H;

      queueMicrotask(() => {
        // A fresh drop starts with prompt + image_1 instead of all 9 outputs.
        // A loaded node keeps exactly what it was saved with (Vue Compat #18).
        if (!bornInLoad && node.graph) syncOutputs(node);
        node._pixRfiLive = liveModel(node);
        renderFace(node, true);
      });

      // LiteGraph fires nothing when a wire FURTHER downstream changes (the
      // prompt going through Prompt Pixaroma into a new encoder), so Auto asks
      // again now and then. Stops by itself for a copy that never joins a graph.
      node._pixRfiIdle = 0;
      node._pixRfiPoll = setInterval(() => {
        if (!node.graph) {
          if (++node._pixRfiIdle > 6) { clearInterval(node._pixRfiPoll); node._pixRfiPoll = null; }
          return;
        }
        node._pixRfiIdle = 0;
        if (isLiveNode(node)) refreshLive(node);
      }, POLL_MS);

      node._pixRfiRendererOff = onRendererChange(() => renderFace(node, true));
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      // ComfyUI puts back every output the Python def has (all 8 image_N) when
      // it restores a node, on every open AND every Ctrl+Z: a saved node with 3
      // pictures came back with 9 outputs and the next click recorded that as a
      // change (undo jammed, measured 2026-10-24). This hook is the LAST step of
      // configure(), so trimming here leaves the node exactly as it was saved
      // (the Sliders recipe). syncOutputs is diff-gated and never resizes during
      // a load. Nothing else here may write node.size, properties or slots (VC#18).
      syncOutputs(this);
      delete this._pixRfiRun;
      renderFace(this, true);
      return r;
    };

    const _conn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = _conn?.apply(this, arguments);
      queueMicrotask(() => refreshLive(this));
      return r;
    };

    const _executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      _executed?.apply(this, arguments);
      queueMicrotask(() => {
        if (runTab(message) === "other") return;
        applyRun(this, message);
      });
    };

    // Pictures dropped on the node's title or edges (the canvas part, Classic).
    nodeType.prototype.onDragOver = function (e) {
      return [...(e?.dataTransfer?.items || [])].some((i) => i.kind === "file");
    };
    nodeType.prototype.onDragDrop = function (e) {
      const files = [...(e?.dataTransfer?.files || [])].filter(isPicture);
      if (!files.length) return false;
      addFiles(this, files);
      return true;
    };

    // Classic-only clamps, never during a load (#7 + VC#18).
    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes() && !isGraphLoading() && this._pixRfiFace) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        const w = this._pixRfiFace.widget;
        const y = w && w.y > 0 ? w.y : 70;
        const floor = y + FLOOR + 20;
        if (size[1] < floor) size[1] = floor;
      }
      return _resize?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this._pixRfiPoll) { clearInterval(this._pixRfiPoll); this._pixRfiPoll = null; }
      try { this._pixRfiRendererOff?.(); } catch {}
      this._pixRfiRendererOff = null;
      try { closeSettingsPanelFor(this); } catch {}
      destroyFace(this);
      return _removed?.apply(this, arguments);
    };
  },
});

// ── graphToPrompt: put the cards into the hidden input ─────────────────────
// Inject only - never prune: Export (API) serialises this same output.
function buildIndex() {
  const index = new Map();
  const seen = new Set();
  const visit = (graph) => {
    if (!graph || seen.has(graph)) return;
    seen.add(graph);
    for (const n of graph._nodes || graph.nodes || []) {
      if (!n) continue;
      if (n.comfyClass === CLASS || n.type === CLASS) index.set(String(n.id), n);
      const inner = n.subgraph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  for (const sg of app.graph?.subgraphs?.values?.() || []) visit(sg);
  return index;
}

function findNode(index, id) {
  const s = String(id);
  if (index.has(s)) return index.get(s);
  const tail = s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : null;
  return tail && index.has(tail) ? index.get(tail) : null;
}

const _origGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt.apply(this, args);
  try {
    const out = result?.output;
    if (out) {
      let index = null;
      for (const id in out) {
        const entry = out[id];
        if (!entry || entry.class_type !== CLASS) continue;
        if (!index) index = buildIndex();
        const node = findNode(index, id);
        if (!node) continue;
        entry.inputs = entry.inputs || {};
        entry.inputs[HIDDEN_INPUT] = JSON.stringify(injectedState(node));
      }
    }
  } catch (e) {
    console.error("[Pixaroma.ReferenceImages] could not add the pictures to the prompt", e);
  }
  return result;
};
