import { app } from "/scripts/app.js";
import { isVueNodes, registerNodeHelp } from "../shared/index.mjs";
import { HIDDEN_INPUT, promptState, widgetOf } from "./core.mjs";
import {
  injectCSS, installFields, uninstallFields, reseedFields, paintRows,
  bindInputDots, alignInputsLegacy, bodyComputeSize, defaultNodeHeight,
  MIN_W, DEFAULT_W, ZW,
} from "./fields.mjs";
import { openTextJoinPanel, closeTextJoinPanelFor } from "./settings.mjs";

// Text Join Two / Three Pixaroma - two or three multi-line text boxes, EACH with
// a real input dot on its row (type OR wire), joined into one `text` output with
// a separator picked in the gear panel. Value + settings flow through hidden
// widgets + a graphToPrompt inject, so wiring a text node overrides the box.
// Structural recipe ported from Outpaint Stitch Pixaroma.

const NODE_SLOT_H = 20;

// class_type -> the ordered list of its text fields ({name, label}).
const CLASSES = {
  PixaromaTextJoinTwo: [
    { name: "text_1", label: "text 1" },
    { name: "text_2", label: "text 2" },
  ],
  PixaromaTextJoinThree: [
    { name: "text_1", label: "text 1" },
    { name: "text_2", label: "text 2" },
    { name: "text_3", label: "text 3" },
  ],
};

function fieldNamesFor(className) {
  return (CLASSES[className] || []).map((f) => f.name);
}
function isFieldName(className, name) {
  return fieldNamesFor(className).includes(name);
}

// Legacy layout: reserve one slot row for the `text` output, own the height, and
// park each field's input dot on its row. USER-action safe (never resizes on load).
function applyLegacyLayout(node) {
  if (isVueNodes()) return;
  node.widgets_start_y = Math.max((node.outputs || []).length, 1) * NODE_SLOT_H + 4;
  node.computeSize = function () { return bodyComputeSize(this); };
}

function scheduleAlignLegacy(node) {
  if (isVueNodes()) return;
  const go = () => { if (node.graph) { alignInputsLegacy(node); node.setDirtyCanvas?.(true, true); } };
  requestAnimationFrame(go);
  setTimeout(go, 150);
}

app.registerExtension({
  name: "Pixaroma.TextJoin",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!CLASSES[nodeData.name]) return;
    if (nodeType.prototype._pixTjPatched) return;
    nodeType.prototype._pixTjPatched = true;
    const CLASS = nodeData.name;
    const FIELDS = CLASSES[CLASS];

    injectCSS();

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      this._pixTjFields = FIELDS;
      installFields(this);
      applyLegacyLayout(this);
      // Fresh-node default size (configure overrides it for saved workflows).
      if (!this.size || this.size[0] < MIN_W) this.size[0] = DEFAULT_W;
      const defH = defaultNodeHeight(FIELDS.length);
      if (!this.size[1] || this.size[1] < defH) this.size[1] = defH;
      queueMicrotask(() => {
        bindInputDots(this); paintRows(this); scheduleAlignLegacy(this);
        this.setDirtyCanvas?.(true, true);
      });
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _configure?.apply(this, arguments);
      this._pixTjFields = FIELDS;
      installFields(this);
      applyLegacyLayout(this);
      queueMicrotask(() => {
        reseedFields(this); bindInputDots(this); paintRows(this); scheduleAlignLegacy(this);
        this.setDirtyCanvas?.(true, true);
      });
      return r;
    };

    // Re-bind + repaint on connect/disconnect of a field input. Never mutates
    // serialized state, so no loading guard is needed.
    const _conn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, slotIndex, isConnected, link, ioSlot) {
      const res = _conn?.apply(this, arguments);
      if (type === 1 /* INPUT */ && ioSlot && isFieldName(CLASS, ioSlot.name)) {
        bindInputDots(this);
        paintRows(this);
      }
      return res;
    };

    // Legacy: re-run our dot parking after arrange recomputes widget.y.
    const _arrange = nodeType.prototype.arrange;
    nodeType.prototype.arrange = function () {
      const r = _arrange?.apply(this, arguments);
      if (!isVueNodes()) alignInputsLegacy(this);
      return r;
    };

    // Legacy: as the node is resized the fields grow (via each row widget's
    // computeSize); re-park the dots at their new centres. Never resizes on load.
    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      const r = _resize?.apply(this, arguments);
      if (!isVueNodes()) alignInputsLegacy(this);
      return r;
    };

    // Keep our render-time slot geometry / marker out of the saved file (rebuilt
    // on load): legacy writes input.pos, Nodes 2.0 writes the widget marker;
    // either would differ per renderer and flag a clean workflow "modified".
    const _serialize = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function () {
      const o = _serialize?.apply(this, arguments);
      if (o?.inputs) {
        for (const inp of o.inputs) {
          if (inp && isFieldName(CLASS, inp.name)) {
            delete inp.pos;
            delete inp.widget;
            if (inp.label === ZW) delete inp.label;
          }
        }
      }
      return o;
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeTextJoinPanelFor(this);
      uninstallFields(this);
      return _removed?.apply(this, arguments);
    };
  },

  getNodeMenuItems(node) {
    if (!node || !CLASSES[node.comfyClass]) return [];
    return [
      {
        content: "⚙ Text Join settings",
        callback: () => openTextJoinPanel(node, () => node.setDirtyCanvas?.(true, true)),
      },
    ];
  },
});

// ── graphToPrompt: feed each unwired field's typed text + the JoinState ───────
function buildIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (CLASSES[n.comfyClass] || CLASSES[n.type]) index.set(String(n.id), n);
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
        if (!entry || !CLASSES[entry.class_type]) continue;
        if (!index) index = buildIndex();
        const node = findNode(index, id);
        if (!node) continue;
        entry.inputs = entry.inputs || {};
        // Typed text for each UNWIRED field (a wire keeps ComfyUI's link).
        for (const cfg of CLASSES[entry.class_type]) {
          const inp = node.inputs?.find((i) => i.name === cfg.name);
          if (inp && inp.link != null) continue;
          const w = widgetOf(node, cfg.name);
          entry.inputs[cfg.name] = (w && typeof w.value === "string") ? w.value : "";
        }
        // Separator / skip-empty (cache-stable: customSep dropped unless custom).
        entry.inputs[HIDDEN_INPUT] = JSON.stringify(promptState(node));
      }
    }
  } catch (e) {
    console.warn("[Text Join Pixaroma] could not inject values:", (e && e.message) || e);
  }
  return result;
};

// ── Help (selection-toolbar ? popup) ─────────────────────────────────────────
const HELP_SECTIONS = [
  {
    heading: "What it does",
    body: "Joins your text pieces into one string. Type in a box, or drag a wire "
      + "onto its dot to pull text from another node - the wire wins when connected "
      + "and the box greys out. Wire the `text` output into any node that takes text.",
  },
  {
    heading: "Each field",
    bullets: [
      "Type directly, or wire a text source onto the dot on its row.",
      "Hover a field for a copy and a paste button in its corner.",
      "A wired field locks and greys - unplug the wire to type again.",
    ],
  },
  {
    heading: "The gear (settings)",
    defs: [
      ["Separator", "What goes between the pieces: comma, space, new line, none, or your own custom text."],
      ["Skip empty fields", "On by default, so a blank piece never leaves a stray separator."],
      ["Set as default", "Remember these settings for every new Text Join node."],
    ],
  },
];

registerNodeHelp("PixaromaTextJoinTwo", {
  title: "Text Join Two Pixaroma",
  tagline: "Join two pieces of text into one (type or wire each).",
  sections: HELP_SECTIONS,
  footer: "Need three pieces? Use Text Join Three Pixaroma.",
});
registerNodeHelp("PixaromaTextJoinThree", {
  title: "Text Join Three Pixaroma",
  tagline: "Join three pieces of text into one (type or wire each).",
  sections: HELP_SECTIONS,
  footer: "Only need two pieces? Use Text Join Two Pixaroma.",
});
