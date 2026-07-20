import { app } from "/scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { CLASS, BRAND, ACCENT_SETTING, ACCENT_PROP, widgetOf } from "./core.mjs";
import {
  injectCSS, installSliders, uninstallSliders, paintRows, bindInputDots,
  alignInputsLegacy, bodyComputeSize, bodyHeight, MIN_W, DEFAULT_W, SLIDERS,
} from "./sliders.mjs";
import { openOpsPanel, closeOpsPanelFor } from "./settings.mjs";

// Outpaint Stitch Pixaroma - the two native INT widgets (feather, color_match)
// become Sliders-Pixaroma-style sliders, EACH with a real input dot on its row
// (widget-socket in Nodes 2.0, the Sliders output-dot recipe mirrored for inputs
// in legacy). Value flows through the native hidden widget + a graphToPrompt
// inject, so wiring a number node overrides the slider.

const NODE_SLOT_H = 20;
// widgets start right after the two REAL inputs (image, outpaint_info); the two
// slider inputs live ON the slider rows, not in the top column.
const WIDGETS_START_Y = 2 * NODE_SLOT_H + 4;

function isSliderInput(name) {
  return SLIDERS.some((s) => s.name === name);
}

// Legacy layout: pin the rows under the real inputs and own the height, then park
// each slider input's dot on its row. USER-action safe (never resizes on load).
function applyLegacyLayout(node) {
  if (isVueNodes()) return;
  node.widgets_start_y = WIDGETS_START_Y;
  node.computeSize = function () { return bodyComputeSize(this); };
}

// LEGACY: the dot Y = widget.y + a constant, so it only needs (re)setting when
// widget.y changes - which is on layout, NOT on pan/zoom. The wrapped arrange
// covers relayout; this one-shot just settles the FIRST paint (widget.y is set by
// then). NO continuous poll - a poll re-parks the dots every tick and, because the
// old measure-based version read the live canvas transform, made them wiggle.
function scheduleAlignLegacy(node) {
  if (isVueNodes()) return;
  const go = () => { if (node.graph) { alignInputsLegacy(node); node.setDirtyCanvas?.(true, true); } };
  requestAnimationFrame(go);
  setTimeout(go, 150);
}

app.registerExtension({
  name: "Pixaroma.OutpaintStitch",

  settings: [
    {
      id: ACCENT_SETTING,
      name: "Default slider colour (hex)",
      type: "text",
      defaultValue: BRAND,
      tooltip: "The colour new Outpaint Stitch sliders paint with, e.g. #f66744. Each node can override it in its own settings.",
      category: ["👑 Pixaroma", "Outpaint Stitch"],
      onChange: () => {
        try {
          for (const n of app.graph?._nodes || []) {
            if (n?.comfyClass === CLASS && !n.properties?.[ACCENT_PROP]) paintRows(n);
          }
        } catch {}
      },
    },
  ],

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;
    if (nodeType.prototype._pixOpsPatched) return;
    nodeType.prototype._pixOpsPatched = true;

    injectCSS();

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      installSliders(this);
      applyLegacyLayout(this);
      if (!this.size || this.size[0] < MIN_W) this.size[0] = DEFAULT_W;
      queueMicrotask(() => { bindInputDots(this); paintRows(this); scheduleAlignLegacy(this); this.setDirtyCanvas?.(true, true); });
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _configure?.apply(this, arguments);
      installSliders(this);
      applyLegacyLayout(this);
      queueMicrotask(() => { bindInputDots(this); paintRows(this); scheduleAlignLegacy(this); this.setDirtyCanvas?.(true, true); });
      return r;
    };

    // Re-bind when a slider input is connected/disconnected so its dot state (and,
    // in Nodes 2.0, the reactive marker) stays fresh. Never mutates serialized
    // state here, so no configure/loading guard is needed - but keep it cheap.
    const _conn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, slotIndex, isConnected, link, ioSlot) {
      const res = _conn?.apply(this, arguments);
      if (type === 1 /* INPUT */ && ioSlot && isSliderInput(ioSlot.name)) {
        bindInputDots(this);
        paintRows(this);
      }
      return res;
    };

    // LEGACY: arrange() computes widget.y; re-run it once the dot positions are set
    // so the slots re-measure with our pos in place.
    const _arrange = nodeType.prototype.arrange;
    nodeType.prototype.arrange = function () {
      const r = _arrange?.apply(this, arguments);
      if (!isVueNodes()) alignInputsLegacy(this);   // best-effort; the poll heals
      return r;
    };

    // Keep our render-time slot geometry + marker out of the saved file (rebuilt on
    // load): legacy writes input.pos, Nodes 2.0 writes the widget marker; either
    // would differ per renderer and flag a clean workflow "modified".
    const _serialize = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function () {
      const o = _serialize?.apply(this, arguments);
      if (o?.inputs) {
        for (const inp of o.inputs) {
          if (inp && isSliderInput(inp.name)) {
            delete inp.pos;
            delete inp.widget;
            if (inp.label === "​") delete inp.label;
          }
        }
      }
      return o;
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeOpsPanelFor(this);
      uninstallSliders(this);
      return _removed?.apply(this, arguments);
    };
  },

  getNodeMenuItems(node) {
    if (node?.comfyClass !== CLASS) return [];
    return [
      {
        content: "⚙ Slider colour",
        callback: () => openOpsPanel(node, () => paintRows(node)),
      },
    ];
  },
});

// ── graphToPrompt: feed the slider value unless the input is wired ───────────
function buildIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === CLASS || n.type === CLASS) index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
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
        if (!node) continue;
        entry.inputs = entry.inputs || {};
        for (const cfg of SLIDERS) {
          const inp = node.inputs?.find((i) => i.name === cfg.name);
          const connected = inp && inp.link != null;
          if (connected) continue;                 // leave ComfyUI's link in place
          const w = widgetOf(node, cfg.name);
          let v = Math.round(Number(w?.value));
          if (!Number.isFinite(v)) v = cfg.name === "feather" ? 64 : 100;
          entry.inputs[cfg.name] = v;               // inject the slider value
        }
      }
    }
  } catch (e) {
    console.warn("[Outpaint Stitch Pixaroma] could not inject slider values:", (e && e.message) || e);
  }
  return result;
};
