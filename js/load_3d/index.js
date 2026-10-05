// Load 3D Pixaroma - wiring.
//
// core.mjs holds the state, engine.mjs is the one shared three.js renderer,
// ui.mjs is the face, settings.mjs the gear panel, help.mjs the help page.

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { isVueNodes, applyAdaptiveCanvasOnly, installZoomRepaint } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { onRendererChange } from "../shared/renderer_switch.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { installNodeAccent, registerNodeSettings, repaintAccent } from "../shared/node_settings.mjs";
import { installRefreshHook, onNodeDefsRefresh } from "../shared/refresh.mjs";
import {
  CLASS, HIDDEN_INPUT, MODEL_WIDGET, UI_WIDGET, NONE, CAPTURE_SUBFOLDER, renderKey,
} from "./core.mjs";
import {
  buildFace, renderFace, placeBand, destroyFace, hideModelWidget, modelWidget, flash, VP_MIN,
} from "./ui.mjs";
import {
  setModel, statusOf, captureModel, detach, requestDraw, modelVersion, clearCaches,
  knownNodes, canvasAttached, refreshIfReplaced,
} from "./engine.mjs";
import { openLoad3DPanel, closeLoad3DPanelFor, isLoad3DPanelOpenFor } from "./settings.mjs";
import { LOAD_3D_HELP } from "./help.mjs";
import {
  SIZE_INPUTS, placeSizeInputs, sizeSources, sizeSignature, effectiveState,
} from "./size.mjs";

// CONSTANTS, never live measurements: getMinHeight drives node.size, and a
// measured value comes back a pixel or two different between save and reload,
// which flags an untouched workflow "modified" (Vue Compat #18). The fixed rows
// are file 28, views 24, looks 24, size 26 and info 22, with five 6px gaps and
// 2 + 8 of padding; the view fills whatever is left above its floor.
const WIDGET_MIN_H = 28 + 24 + 24 + 26 + 22 + 5 * 6 + 10 + VP_MIN;
const MIN_W = 330;
const MIN_H = 400;
const DEFAULT_W = 360;
// 40 more than before the width and height outputs: their two slot rows push the
// body down, so a fresh node keeps the view it always had.
const DEFAULT_H = 620;

function slotHeight() {
  return window.LiteGraph?.NODE_SLOT_HEIGHT || 20;
}

registerNodeHelp(CLASS, LOAD_3D_HELP);

registerNodeSettings(CLASS, {
  title: "Load 3D",
  ownMenuItem: false,
  open: (node) => openPanel(node),
  closeFor: (node) => closeLoad3DPanelFor(node),
  // The face paints its own canvas, which no shared repaint reaches, so a change
  // to a DEFAULT colour needs this or the node keeps the old accent
  // (node-settings-accent.md invariant 2).
  onChange: (node) => renderFace(node),
});

function openPanel(node) {
  openLoad3DPanel(node, (n) => {
    renderFace(n);
    repaintAccent(n);
    n.setDirtyCanvas?.(true, true);
  });
}

function toggleSettings(node) {
  if (isLoad3DPanelOpenFor(node)) closeLoad3DPanelFor(node);
  else openPanel(node);
}

function syncModel(node) {
  setModel(node, String(modelWidget(node)?.value ?? NONE));
}

// ── keep the view in step with the widget ──────────────────────────────────
// The model name can change without any of our clicks: an undo, XY Plot
// sweeping it, a workflow reload into a live node. One shared 500ms check,
// running only while a Load 3D node exists, compares the widget with what is
// drawn. It also lets go of nodes that are gone (a tab switch rebuilds every
// node object, Vue Compat #11), so their GPU copies are freed.
let _poll = 0;

function liveNodes() {
  return [...new Set(buildIndex().values())];
}

function isLoad3D(n) {
  return n?.comfyClass === CLASS || n?.type === CLASS;
}

function watchModels() {
  if (_poll) return;
  _poll = setInterval(() => {
    const live = liveNodes();
    const liveSet = new Set(live);
    for (const n of knownNodes()) {
      // The engine is shared with Save 3D, and liveNodes() holds Load 3D nodes only: without this
      // check every Save 3D view that was out of the page for a moment (a workflow opening, a tab
      // switch) lost its model and said "Loading ..." until a refresh, in any session where a
      // Load 3D node had ever been opened (2026-09-17). Save 3D releases its own records.
      if (!isLoad3D(n)) continue;
      if (!liveSet.has(n) && !canvasAttached(n)) detach(n);
    }
    if (!live.length && !knownNodes().some(isLoad3D)) {
      clearInterval(_poll);
      _poll = 0;
      return;
    }
    for (const n of live) {
      if (!n._pixL3dEls) continue;
      const want = String(modelWidget(n)?.value ?? NONE);
      if (statusOf(n).value !== want) {
        setModel(n, want);
        renderFace(n);
      }
      // A wired size follows its source: pick another size in Sizes Pixaroma and
      // the frame and the fields change with it, with nothing clicked on this node.
      const sig = sizeSignature(sizeSources(n));
      if (n._pixL3dSizeSig !== sig) {
        n._pixL3dSizeSig = sig;
        renderFace(n);
      }
    }
  }, 500);
}

onNodeDefsRefresh(() => {
  clearCaches();
  for (const n of liveNodes()) if (n._pixL3dEls) renderFace(n);
});

app.registerExtension({
  name: "Pixaroma.Load3D",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    // A re-registration (hot reload) must not double-wrap every hook.
    if (nodeType.prototype._pixL3dPatched) return;
    nodeType.prototype._pixL3dPatched = true;
    installRefreshHook(nodeType);

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = _created?.apply(this, arguments);
      const node = this;
      hideModelWidget(node);
      const root = buildFace(node, { openSettings: (n) => toggleSettings(n) });
      // A UNIQUE widget type, or Nodes 2.0 renders its own widget and orphans
      // ours. Added LAST, after the native combo, so saved widgets_values keep
      // their order (Vue Compat #23).
      const w = node.addDOMWidget(UI_WIDGET, "pixaroma_load3d", root, {
        serialize: false,
        getMinHeight: () => WIDGET_MIN_H,
      });
      w.serialize = false;
      applyAdaptiveCanvasOnly(w);
      w.computeLayoutSize = () => ({ minHeight: WIDGET_MIN_H, minWidth: 1 });
      installCanvasZoomPassthrough(root); // convention #17
      installNodeAccent(node, root);
      node._pixL3dFloorOff = installResizeFloor(root, () => WIDGET_MIN_H);
      // The view's backing store is sized dpr x zoom: a pure zoom resizes
      // nothing, so the ResizeObserver stays quiet and the view would go soft.
      node._pixL3dZoomOff = installZoomRepaint(node, null, () => requestDraw(node), "_pixL3dRaf");
      try {
        node._pixL3dRo = new ResizeObserver(() => requestDraw(node));
        node._pixL3dRo.observe(node._pixL3dEls.vp);
      } catch (_e) { /* no ResizeObserver: redraws still come from every change */ }
      placeSizeInputs(node, slotHeight());
      placeBand(node);
      node._pixL3dRendererOff = onRendererChange(() => {
        placeSizeInputs(node, slotHeight());
        placeBand(node);
        requestDraw(node);
      });

      // Fresh size, SYNCHRONOUSLY: configure() runs straight after and restores
      // a saved size, which a deferred write would clobber (convention #9).
      if (!Array.isArray(node.size)) node.size = [DEFAULT_W, DEFAULT_H];
      node.size[0] = DEFAULT_W;
      node.size[1] = DEFAULT_H;

      queueMicrotask(() => {
        if (node.graph) syncModel(node);
        renderFace(node);
      });
      watchModels();
      return r;
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      // DOM and the engine only. Nothing here writes node.properties or node.size,
      // and the one slot field it sets (the size inputs' pos) is stripped from
      // every save, so an untouched workflow never opens "modified" (Vue Compat #18).
      hideModelWidget(this);
      // configure() rebuilt the inputs from the saved workflow, which carries no pos.
      placeSizeInputs(this, slotHeight());
      // Only a node that is IN a graph loads its model. Copy, clone and Convert
      // to Subgraph configure a throwaway copy that is never added, and loading
      // for it downloaded and parsed the whole model for nothing (measured: a
      // GET and a full load on every clone). Paste and workflow load add the
      // node before configuring it, and the 500 ms poll catches anything else.
      if (this.graph) syncModel(this);
      renderFace(this);
      queueMicrotask(() => {
        if (this.graph) syncModel(this);
        renderFace(this);
      });
      watchModels();
      return r;
    };

    // The size inputs' pos is layout, rebuilt on every load, so it never goes
    // into a saved workflow. LGraphNode.serialize copies each slot
    // (inputAsSerialisable), so deleting it here cannot touch the live input.
    // onSerialize, not a serialize() wrapper: from frontend 1.53 the graph saves
    // each node from its store and never calls node.serialize() (Vue Compat #29).
    const _onSerialize = nodeType.prototype.onSerialize;
    nodeType.prototype.onSerialize = function (data) {
      const r = _onSerialize?.apply(this, arguments);
      try {
        for (const inp of data?.inputs || []) {
          if (inp && SIZE_INPUTS.includes(inp.name)) delete inp.pos;
        }
      } catch (_e) { /* a save must never fail over layout */ }
      return r;
    };

    // Plugging a wire into width or height, or pulling one out, changes the frame
    // and the fields at once (the 500 ms poll would catch it a moment later). DOM
    // only, so it is safe during the connection replay of a workflow load.
    const _connections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = _connections?.apply(this, arguments);
      const node = this;
      if (node._pixL3dEls) queueMicrotask(() => renderFace(node));
      return r;
    };

    // Classic-only clamps; in Nodes 2.0 the rendered size lives in the Vue
    // layout store and clamping node.size desyncs the two.
    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes() && !isGraphLoading()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (size[1] < MIN_H) size[1] = MIN_H;
      }
      return _resize?.apply(this, arguments);
    };

    const _draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function () {
      // The load gate matters most here: a draw hook runs on the first frame of
      // a load, earlier than any other clamp (convention #7).
      if (!isVueNodes() && !isGraphLoading()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      return _draw?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeLoad3DPanelFor(this);
      this._pixL3dFloorOff?.();
      this._pixL3dFloorOff = null;
      this._pixL3dZoomOff?.();
      this._pixL3dZoomOff = null;
      this._pixL3dRendererOff?.();
      this._pixL3dRendererOff = null;
      try { this._pixL3dRo?.disconnect(); } catch (_e) { /* already gone */ }
      this._pixL3dRo = null;
      destroyFace(this);
      detach(this);
      return _removed?.apply(this, arguments);
    };
  },
});

// ── graphToPrompt: draw the picture, upload it, inject the names ───────────
// INJECT ONLY - never prune here (reference_never_prune_in_graphtoprompt).

// Keyed by everything that changes the picture, so an unchanged view is not
// drawn and uploaded again on every Run. The names are deterministic, so the
// prompt is identical run to run and ComfyUI's cache holds. Cleared when the
// server reconnects, because a restart empties the temp folder.
const _uploaded = new Map();
api.addEventListener("reconnected", () => _uploaded.clear());

function buildIndex() {
  const index = new Map();
  const seen = new Set();
  const visit = (graph, prefix) => {
    if (!graph || seen.has(graph)) return; // a subgraph cycle would recurse forever
    seen.add(graph);
    for (const n of graph._nodes || graph.nodes || []) {
      if (!n) continue;
      if (n.comfyClass === CLASS || n.type === CLASS) {
        // Keyed by the COMPOSITE id ("5:12" inside a subgraph), so a top-level
        // node and a subgraph node sharing a local id cannot swap pictures.
        index.set(prefix + String(n.id), n);
        if (!index.has(String(n.id))) index.set(String(n.id), n);
      }
      if (n.subgraph) visit(n.subgraph, prefix + String(n.id) + ":");
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

function outputLinked(node, i) {
  const o = node?.outputs?.[i];
  return !!(o && Array.isArray(o.links) && o.links.length);
}

async function uploadPicture(blob, filename) {
  const body = new FormData();
  body.append("image", blob, filename);
  body.append("type", "temp");
  body.append("subfolder", CAPTURE_SUBFOLDER);
  body.append("overwrite", "true");
  const res = await api.fetchApi("/upload/image", { method: "POST", body });
  if (res.status !== 200) throw new Error(`the upload answered ${res.status}`);
  const data = await res.json();
  return `${data?.subfolder || CAPTURE_SUBFOLDER}/${data?.name || filename} [temp]`;
}

// Only what something downstream reads is sent, so nothing else can change this
// node's cache key: the picture's two names when image or mask is wired, the
// width and height when either of those outputs is wired. Sending the size with
// nothing reading it re-ran a model-only graph, and everything after it,
// whenever Width or Height was touched.
async function pictureState(node, model) {
  if (!node) return {};
  const wantPicture = outputLinked(node, 1) || outputLinked(node, 2);
  const wantSize = outputLinked(node, 3) || outputLinked(node, 4);
  if (!wantPicture && !wantSize) return {};
  // Read ONCE: this same state names the files, is what gets drawn, and is the
  // size sent. It is the EFFECTIVE state, so a size wired in from Sizes counts.
  const st = effectiveState(node);
  const size = wantSize ? { w: st.w, h: st.h } : {};
  if (!wantPicture || !model || model === NONE) return size;
  try {
    // A file replaced on disk under the same name must not reuse its old picture.
    await refreshIfReplaced(node, model);
    const key = renderKey(`${model}#${modelVersion(model)}`, st);
    const hit = _uploaded.get(key);
    if (hit) return { ...hit, ...size };
    const shot = await captureModel(node, model, st);
    const base = `l3d_${key}`;
    const names = {
      image: await uploadPicture(shot.image, `${base}.png`),
      mask: await uploadPicture(shot.mask, `${base}_mask.png`),
    };
    _uploaded.set(key, names);
    while (_uploaded.size > 64) _uploaded.delete(_uploaded.keys().next().value);
    return { ...names, ...size };
  } catch (e) {
    console.warn("[Pixaroma.Load3D] the picture could not be made", e);
    flash(node, `The picture could not be made: ${e?.message || e}`, true, 8000);
    return size;
  }
}

const _origGraphToPrompt_fn = app.graphToPrompt;
const _origGraphToPrompt = (...a) => _origGraphToPrompt_fn.apply(app, a);
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
        entry.inputs = entry.inputs || {};
        const st = await pictureState(node, entry.inputs[MODEL_WIDGET]);
        entry.inputs[HIDDEN_INPUT] = JSON.stringify(st);
      }
    }
  } catch (e) {
    console.error("[Pixaroma.Load3D] inject failed", e);
  }
  return result;
};
