import { app } from "/scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import {
  ACCENT_SETTING, BRAND, MAX_SLIDERS,
  readState, normalizeSliders, syncOutputs, addSlider, resolveAutoType,
} from "./core.mjs";
import {
  injectCSS, syncRowWidgets, renderAll, alignOutputsLegacy, watchAlign, unwatchAlign, scheduleAlign,
  ROW_H, ROW_GAP, ADD_H, MIN_W, DEFAULT_W,
} from "./ui.mjs";
import { openSlidersPanel, closeSlidersPanelFor } from "./settings.mjs";

// Sliders Pixaroma - a panel of sliders that drives numbers across the workflow.
//
// One DOM row widget per slider (they render in BOTH renderers), one output per
// slider, and each output dot parked on its own row - by slot.pos in legacy, by
// the nudge in Nodes 2.0 (see ui.mjs for both).
//
// State lives on node.properties.slidersState and is injected into the hidden
// SlidersState input by the graphToPrompt hook at the bottom (Vue Compat #9).

const CLASS = "PixaromaSliders";
const HIDDEN_INPUT = "SlidersState";

// Body height in legacy: our rows only. Without this, LiteGraph's computeSize
// reserves a 20px slot row PER OUTPUT at the top of the node (rows = max(inputs,
// outputs)), so an 8-slider panel would carry 160px of empty slot column above
// the sliders that our dots do not even use.
function bodyHeight(node) {
  const n = readState(node).sliders.length;
  return n * (ROW_H + ROW_GAP) + ADD_H + 12;
}

function refresh(node) {
  syncRowWidgets(node, () => {
    if (addSlider(node)) {
      refresh(node);
      fitNode(node);
    }
  });
  renderAll(node);
  node.setDirtyCanvas?.(true, true);
}

// Grow / shrink the node to its rows. USER ACTIONS ONLY - never on the load
// path, or the saved size gets rewritten and a clean workflow opens "modified"
// (Vue Compat #18).
function fitNode(node) {
  if (isGraphLoading()) return;
  const w = Math.max(node.size?.[0] || DEFAULT_W, MIN_W);
  if (isVueNodes()) {
    // Nodes 2.0 grows to content on its own but never shrinks, so a removed
    // slider would leave a gap. VUE_CHROME = title + the category chip.
    node.setSize?.([w, bodyHeight(node) + 52]);
  } else {
    node.setSize?.([w, bodyHeight(node)]);
  }
  scheduleAlign(node);
}

app.registerExtension({
  name: "Pixaroma.Sliders",

  // A plain hex field: ComfyUI's settings dialog has no colour input, and the
  // pretty picker lives in the node's own settings panel anyway (which also
  // writes this value via its "Colour as default" button).
  settings: [
    {
      id: ACCENT_SETTING,
      name: "Default slider colour (hex)",
      type: "text",
      defaultValue: BRAND,
      tooltip: "The colour new Sliders nodes paint with, e.g. #f66744. Each node can override it in its own settings.",
      category: ["👑 Pixaroma", "Sliders"],
      // Repaint every node that FOLLOWS the default (accent unset), so changing
      // it is visible immediately instead of at the next interaction.
      onChange: () => {
        try {
          for (const n of app.graph?._nodes || []) {
            if (n?.comfyClass === CLASS && !n.properties?.slidersState?.accent) renderAll(n);
          }
        } catch {}
      },
    },
  ],

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;
    if (nodeType.prototype._pixSldPatched) return; // hot-reload guard
    nodeType.prototype._pixSldPatched = true;

    injectCSS();

    // ── Creation ─────────────────────────────────────────────────────────
    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      readState(this);
      syncOutputs(this);
      refresh(this);

      // Pin the rows to the top of the body. WITHOUT this, _arrangeWidgets
      // starts the widgets below the measured slot bounds - and since we park
      // each output ON a row, the slot bounds then depend on widget.y, which
      // depends on the slot bounds... a feedback loop that walks the node
      // taller on every frame (measured: 62 -> 102px and climbing). This is the
      // field litegraph itself points at for custom slot layouts.
      this.widgets_start_y = 2;

      // Legacy reserves a slot row per output; our dots live on the rows, so we
      // own the size. MIN_W (not the live width) keeps the drag-min honest -
      // returning this.size[0] would pin the floor at the current width and the
      // node could then only ever grow.
      if (!isVueNodes()) {
        this.computeSize = function () { return [MIN_W, bodyHeight(this)]; };
      }

      if (!this.size || this.size[0] < MIN_W) {
        this.size[0] = DEFAULT_W;
        this.size[1] = bodyHeight(this) + (isVueNodes() ? 52 : 0);
      }

      queueMicrotask(() => {
        normalizeSliders(this);
        syncOutputs(this);
        refresh(this);
        watchAlign(this);
        scheduleAlign(this);
      });
    };

    // ── Configure (workflow load / undo) ─────────────────────────────────
    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      this._pixSldConfiguring = true;
      try {
        const r = _configure?.apply(this, arguments);
        this.widgets_start_y = 2;   // see onNodeCreated: breaks the slot/widget loop
        normalizeSliders(this);
        syncOutputs(this);
        refresh(this);          // rebuild the rows for the restored sliders
        queueMicrotask(() => {
          watchAlign(this);
          scheduleAlign(this);
        });
        return r;
      } finally {
        this._pixSldConfiguring = false;
      }
    };

    // ── Connections: Auto -> Int / Float on the first wire ───────────────
    // Gated on the configure flag AND isGraphLoading (Vue Compat #17 + #19):
    // the link replay on load must never rewrite a saved type.
    const _conn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, slotIndex, isConnected, link) {
      if (type === 2 /* OUTPUT */ && isConnected && !this._pixSldConfiguring && !isGraphLoading()) {
        if (resolveAutoType(this, slotIndex, link)) refresh(this);
      }
      return _conn?.apply(this, arguments);
    };

    // ── Legacy: park each output dot at its row's Y ──────────────────────
    // arrange() computes widget.y, so we re-run it once the positions are set:
    // the second pass re-measures the slots with our pos in place.
    const _arrange = nodeType.prototype.arrange;
    nodeType.prototype.arrange = function () {
      const r = _arrange?.apply(this, arguments);
      if (!isVueNodes()) {
        alignOutputsLegacy(this);
        _arrange?.apply(this, arguments);
      }
      return r;
    };

    // ── Serialize: keep our render-time slot geometry out of the file ────
    // Legacy writes output.pos into the workflow; that value is meaningless in
    // Nodes 2.0 and would make a file saved in one renderer differ from the
    // other (and flag a clean workflow "modified"). It is rebuilt on every
    // arrange, so strip it.
    const _serialize = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function () {
      const o = _serialize?.apply(this, arguments);
      if (o?.outputs) for (const out of o.outputs) { if (out && out.pos) delete out.pos; }
      return o;
    };

    // Right-click lives on the extension-level getNodeMenuItems hook below (the
    // current context-menu API, Vue Compat #20) - patching getNodeMenuOptions
    // here as well would show the item twice.

    // ── Removal ──────────────────────────────────────────────────────────
    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeSlidersPanelFor(this);
      unwatchAlign(this);
      return _removed?.apply(this, arguments);
    };
  },

  // The extension-level right-click hook (the new context-menu API) so the item
  // shows in both renderers.
  getNodeMenuItems(node) {
    if (node?.comfyClass !== CLASS) return [];
    return [
      {
        content: "⚙ Slider settings",
        callback: () => openSlidersPanel(node, () => { refresh(node); fitNode(node); }),
      },
    ];
  },
});

// ── graphToPrompt: inject the slider values ─────────────────────────────────
// INJECT ONLY - never prune here (Export (API) serialises this same output).
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
        const st = readState(node);
        entry.inputs = entry.inputs || {};
        entry.inputs[HIDDEN_INPUT] = JSON.stringify({
          version: 1,
          // Only what changes the OUTPUT goes in here - a toggle also sends its
          // adopted kind (out). The state words / default are display-only and
          // are deliberately left out, so renaming a state never re-runs the node.
          sliders: st.sliders.slice(0, MAX_SLIDERS).map((s) => (
            s.type === "toggle"
              ? { type: "toggle", value: s.value ? 1 : 0, out: s.out || "auto" }
              : { type: s.type, value: s.value }
          )),
        });
      }
    }
  } catch (e) {
    console.warn("[Sliders Pixaroma] could not inject slider values:", (e && e.message) || e);
  }
  return result;
};

registerNodeHelp(CLASS, {
  title: "Sliders Pixaroma",
  tagline: "One panel of sliders and on / off switches that drives your whole workflow.",
  sections: [
    {
      heading: "What it does",
      body:
        "Add a row, name it, then wire its output to any input: steps, cfg, denoise, a LoRA strength, a width " +
        "for the sliders, or an on / off setting for the switches. Instead of hunting through the graph for the " +
        "value you want to tweak, you keep every dial and switch you care about in one place. A row can be a " +
        "slider or a toggle (a boolean switch), and you can mix both in the same node.",
    },
    {
      heading: "Using a slider",
      bullets: [
        "Drag across a slider to set it. Hold Shift while dragging for fine control.",
        "Double-click a slider to type an exact value.",
        "Each row has its own output dot, sitting on its own row.",
      ],
    },
    {
      heading: "Using a switch (on / off)",
      body:
        "In the settings, set a row's type to Toggle and it becomes an on / off switch instead of a slider. " +
        "Click the row to flip it. Like a slider it adopts what it is plugged into: wire it to a true / false " +
        "input and it sends a boolean, wire it to a number input and it sends 1 or 0. You can rename its two " +
        "states (for example Yes / No) and set which state it starts in.",
    },
    {
      heading: "Whole numbers or decimals",
      body:
        "A new slider is set to Auto. The first input you connect it to decides: plug it into steps and it " +
        "sends whole numbers, plug it into denoise and it sends decimals. That way it can never send the " +
        "wrong kind of number. You can also set it by hand in the settings.",
    },
    {
      heading: "Settings",
      body:
        "Right-click the node for the settings panel. There you can add and remove rows, rename them, choose " +
        "each row's type (Auto, Int, Float, or Toggle), set a slider's range and step or a switch's two labels " +
        "and default, and pick the colour the node paints with. That colour is per node, and you can save it as " +
        "the default for every new Sliders node you add.",
    },
  ],
  footer: "Up to 16 rows per node - sliders and switches, mixed freely. Add as many panels as you like.",
});
