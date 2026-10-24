// Video Tools Pixaroma - wiring.
//
// Join, trim, reverse, loop and fade up to three clips (frames + sound) from
// any video model. Classic and Nodes 2.0 alike.
//
// core.mjs state + the plan (pure) | actions.mjs changes | ui.mjs the face |
// settings.mjs the gear panel | css.mjs | help.mjs

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { registerNodeSettings } from "../shared/node_settings.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import { onRendererChange } from "../shared/renderer_switch.mjs";
import { runTab, eachRestoredOutput } from "../shared/run_tab.mjs";
import { CLASS, HIDDEN_INPUT, injectedState } from "./core.mjs";
import { VIDEO_TOOLS_HELP } from "./help.mjs";
import { closeSettingsPanelFor, openSettingsPanel } from "./settings.mjs";
import { FLOOR, MIN_W, buildFace, destroyFace, renderFace, setPlaying } from "./ui.mjs";

const DEFAULT_W = 560;
const DEFAULT_H = 660;

registerNodeHelp(CLASS, VIDEO_TOOLS_HELP);
registerNodeSettings(CLASS, {
  title: "Video Tools",
  open: (node) => openSettingsPanel(node),
  closeFor: (node) => closeSettingsPanelFor(node),
});

function applyRun(node, message) {
  const entry = message?.pixaroma_video_tools?.[0];
  if (!entry) return;
  // Runtime only, never serialized: the temp files do not outlive the server.
  node._pixVdtRun = entry;
  node._pixVdtPlaying = false;
  renderFace(node);
}

// A new Run stops every moving preview, so nothing animates while it works.
api.addEventListener("execution_start", () => {
  for (const n of app.graph?._nodes || []) {
    if ((n.comfyClass === CLASS || n.type === CLASS) && n._pixVdtPlaying) setPlaying(n, false);
  }
});

app.registerExtension({
  name: "Pixaroma.VideoTools",

  onNodeOutputsUpdated(nodeOutputs) {
    eachRestoredOutput(nodeOutputs, CLASS, (node, output) => applyRun(node, output));
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    if (nodeType.prototype._pixVdtPatched) return;
    nodeType.prototype._pixVdtPatched = true;

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      const node = this;
      buildFace(node, { onGear: () => openSettingsPanel(node) });
      node._pixVdtRefresh = () => renderFace(node);

      // The seconds shown next to the frame counts follow the fps box.
      const w = (node.widgets || []).find((x) => x.name === "fps");
      if (w) {
        const cb = w.callback;
        w.callback = function () {
          const r = cb?.apply(this, arguments);
          queueMicrotask(() => renderFace(node));
          return r;
        };
      }

      // Fresh size, SYNCHRONOUSLY (configure() restores a saved one next, #9).
      if (!Array.isArray(node.size)) node.size = [DEFAULT_W, DEFAULT_H];
      node.size[0] = DEFAULT_W;
      node.size[1] = DEFAULT_H;

      queueMicrotask(() => renderFace(node));
      node._pixVdtRendererOff = onRendererChange(() => renderFace(node));
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      // DOM only: nothing here may write node.size, properties or slots (VC#18).
      delete this._pixVdtRun;
      this._pixVdtPlaying = false;
      renderFace(this);
      return r;
    };

    const _conn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = _conn?.apply(this, arguments);
      queueMicrotask(() => renderFace(this));
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

    // Classic-only clamps, never during a load (#7 + VC#18).
    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes() && !isGraphLoading() && this._pixVdtFace) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        const w = this._pixVdtFace.widget;
        const y = w && w.y > 0 ? w.y : 150;
        const floor = y + FLOOR + 20;
        if (size[1] < floor) size[1] = floor;
      }
      return _resize?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try { this._pixVdtRendererOff?.(); } catch {}
      this._pixVdtRendererOff = null;
      try { closeSettingsPanelFor(this); } catch {}
      destroyFace(this);
      return _removed?.apply(this, arguments);
    };
  },
});

// ── graphToPrompt: put the settings into the hidden input ──────────────────
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
    console.error("[Pixaroma.VideoTools] could not add the settings to the prompt", e);
  }
  return result;
};
