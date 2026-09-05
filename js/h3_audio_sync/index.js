// H3 Audio Sync Pixaroma - wiring.
//
// No hand-built settings panel: the three choices are plain preferences, so
// they ride on the SHARED generic panel as rows (the toolbar gear and the
// right-click entry both open it). core.mjs turns those rows into the blob
// Python reads.

import { app } from "/scripts/app.js";
import { isVueNodes, applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { installNodeAccent, registerNodeAccent } from "../shared/node_settings.mjs";
import {
  CLASS, HIDDEN_INPUT, MIN_W, DEFAULT_W, injectedState,
  SET_LIMIT, SET_OVER, SET_SHORT,
  LIMIT_OPTIONS, LIMIT_DEFAULT, OVER_OPTIONS, OVER_DEFAULT, SHORT_OPTIONS, SHORT_DEFAULT,
} from "./core.mjs";
import { buildFace, renderFace, destroyFace, injectCSS } from "./ui.mjs";
import { H3_SYNC_HELP } from "./help.mjs";

// A CONSTANT height, never a measurement: a live one differs by a pixel or two
// between save and reload, rewrites node.size and flags an untouched workflow
// "modified" (Vue Compat #18).
const WIDGET_MIN_H = 58;
const MIN_H = 150;
const DEFAULT_H = 162;

registerNodeHelp(CLASS, H3_SYNC_HELP);

registerNodeAccent(CLASS, {
  title: "H3 Audio Sync",
  rows: [
    {
      kind: "combo", setting: SET_LIMIT, options: LIMIT_OPTIONS, defaultValue: LIMIT_DEFAULT,
      label: "Longest clip",
      hint: "MiniMax H3 was only trained to about 15 seconds and usually falls apart past it.",
    },
    {
      kind: "combo", setting: SET_OVER, options: OVER_OPTIONS, defaultValue: OVER_DEFAULT,
      label: "If the clip is longer",
      hint: "Stop the run catches it before anything is rendered.",
    },
    {
      kind: "combo", setting: SET_SHORT, options: SHORT_OPTIONS, defaultValue: SHORT_DEFAULT,
      label: "If the track runs out",
      hint: "What to do when your recording is shorter than the clip.",
    },
  ],
  onChange: (node) => renderFace(node),
});

app.registerExtension({
  name: "Pixaroma.H3AudioSync",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    // Without this a re-registration (hot reload) double-wraps every hook.
    if (nodeType.prototype._pixH3sPatched) return;
    nodeType.prototype._pixH3sPatched = true;

    injectCSS();

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      const root = buildFace(this);
      const w = this.addDOMWidget(HIDDEN_INPUT + "_ui", "pixaroma_h3_sync", root, {
        serialize: false,
        getMinHeight: () => WIDGET_MIN_H,
      });
      applyAdaptiveCanvasOnly(w);
      installCanvasZoomPassthrough(root);
      installNodeAccent(this, root);

      // Fresh size SYNCHRONOUSLY - configure() runs straight after and restores
      // a saved size, so a deferred write clobbers the user's own size on every
      // reload and duplicate (convention #9).
      if (!Array.isArray(this.size)) this.size = [DEFAULT_W, DEFAULT_H];
      this.size[0] = DEFAULT_W;
      this.size[1] = DEFAULT_H;

      queueMicrotask(() => renderFace(this));
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      renderFace(this);           // DOM ONLY - never node.size, never slots
      queueMicrotask(() => renderFace(this));
      return r;
    };

    // What the last run found. Runtime-only: writing a run result to
    // node.properties would dirty a clean workflow on every execution.
    const _executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const r = _executed?.apply(this, arguments);
      const info = message?.pixaroma_h3_sync?.[0];
      if (info) { this._pixH3sRun = info; renderFace(this); }
      return r;
    };

    // Classic-only. In Nodes 2.0 the rendered size lives in the Vue layout
    // store, so clamping node.size desyncs them and the node jumps on a switch.
    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes() && !isGraphLoading()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (size[1] < MIN_H) size[1] = MIN_H;
      }
      return _resize?.apply(this, arguments);
    };

    const _draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      // A draw hook runs on the FIRST frame of a load, so without the load gate
      // this is the one clamp that can rewrite a saved size on a clean open.
      if (!isVueNodes() && !isGraphLoading()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      return _draw?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      destroyFace(this);
      return _removed?.apply(this, arguments);
    };
  },
});

// ── graphToPrompt: inject the state ────────────────────────────────────────
// INJECT ONLY - a prune here would strip the settings out of Export (API) too.
const _origGraphToPrompt_fn = app.graphToPrompt;
const _origGraphToPrompt = (...a) => _origGraphToPrompt_fn.apply(app, a);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  try {
    const out = result?.output;
    if (out) {
      let blob = null;
      for (const id in out) {
        const entry = out[id];
        if (!entry || entry.class_type !== CLASS) continue;
        // The three values are settings, not per-node state, so one read serves
        // every copy of the node in the graph.
        if (!blob) blob = JSON.stringify(injectedState());
        entry.inputs = entry.inputs || {};
        entry.inputs[HIDDEN_INPUT] = blob;
      }
    }
  } catch (e) {
    console.error("[Pixaroma.H3AudioSync] inject failed", e);
  }
  return result;
};
