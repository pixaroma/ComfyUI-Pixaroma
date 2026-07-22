import { app } from "/scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import {
  ACCENT_SETTING, BRAND, MAX_SLIDERS,
  readState, normalizeSliders, syncOutputs, addSlider, resolveAutoType, resetRowOnDisconnect,
  comboOptionsOf, randomSeed,
} from "./core.mjs";

// A Control Panel can only drive widget-style value inputs. STRING is deliberately
// left out until the Text control ships (Phase 3).
function isValueTarget(node, link) {
  const target = node.graph?.getNodeById?.(link.target_id);
  const inp = target?.inputs?.[link.target_slot];
  const t = String(inp?.type || "").toUpperCase();
  if (t === "INT" || t === "FLOAT" || t === "BOOLEAN" || t === "COMBO") return true;
  return !!comboOptionsOf(target, inp?.widget?.name || inp?.name);
}

// A small self-contained toast (no dependency on ComfyUI's toast API, which varies).
function showPanelToast(msg) {
  let t = document.getElementById("pix-sld-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "pix-sld-toast";
    t.style.cssText =
      "position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:11000;background:#1d1d1d;" +
      "border:1px solid #f66744;border-radius:8px;color:#fff;font:13px 'Segoe UI',sans-serif;padding:10px 16px;" +
      "box-shadow:0 8px 30px rgba(0,0,0,0.5);max-width:80vw;text-align:center;pointer-events:none;opacity:0;transition:opacity .2s;";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = "1";
  clearTimeout(t._hideT);
  t._hideT = setTimeout(() => { t.style.opacity = "0"; }, 3500);
}
import {
  injectCSS, syncRowWidgets, renderAll, alignOutputsLegacy, watchAlign, unwatchAlign, scheduleAlign,
  closeComboPopup, ROW_H, ROW_GAP, ADD_H, MIN_W, DEFAULT_W,
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
      name: "Default control colour (hex)",
      type: "text",
      defaultValue: BRAND,
      tooltip: "The colour new Control Panel nodes paint with, e.g. #f66744. Each node can override it in its own settings.",
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

      // Always snap a FRESH node to its content height. (Gating this on width let
      // ComfyUI's default size through whenever its default width was >= MIN_W,
      // leaving a giant empty body - user-reported.) configure() restores a saved
      // size immediately after onNodeCreated, so saved / duplicated nodes keep theirs.
      if (!Array.isArray(this.size)) this.size = [DEFAULT_W, DEFAULT_W];
      this.size[0] = DEFAULT_W;
      this.size[1] = bodyHeight(this) + (isVueNodes() ? 52 : 0);

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
        // Heal a node saved with the old oversized default (sizing bug, 2026-07-22).
        // Only fires when the saved height is way past the content, so a correctly
        // sized node is untouched (no dirty); a buggy one snaps down once.
        const wantH = bodyHeight(this) + (isVueNodes() ? 52 : 0);
        if (Array.isArray(this.size) && this.size[1] > wantH + 24) this.size[1] = wantH;
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
      if (type === 2 /* OUTPUT */ && !this._pixSldConfiguring && !isGraphLoading()) {
        if (isConnected) {
          if (resolveAutoType(this, slotIndex, link)) {
            refresh(this);
          } else if (link && !isValueTarget(this, link)) {
            // Refuse a wire to an input the panel can't drive (MODEL, LATENT,
            // CONDITIONING, ...); drop it on the next tick and tell the user.
            const self = this, lk = link;
            setTimeout(() => {
              try {
                self.graph?.getNodeById?.(lk.target_id)?.disconnectInput?.(lk.target_slot);
                self.setDirtyCanvas?.(true, true);
              } catch {}
              showPanelToast("A Control Panel drives numbers, on/off switches, and dropdowns - not that kind of input.");
            }, 0);
          }
        } else {
          // Unplugged: a number slider drops back to auto so it can be re-wired
          // to a boolean (and become a switch) or a different number. LiteGraph
          // clears output.links AFTER this callback returns, so defer the check
          // one tick until the slot's remaining connections have settled.
          const self = this;
          setTimeout(() => {
            if (!self.graph || isGraphLoading()) return;
            if (resetRowOnDisconnect(self, slotIndex)) refresh(self);
          }, 0);
        }
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
      closeComboPopup();
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
        content: "⚙ Control settings",
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
        let seedRolled = false;
        entry.inputs = entry.inputs || {};
        entry.inputs[HIDDEN_INPUT] = JSON.stringify({
          version: 1,
          // Only what changes the OUTPUT goes in here - a toggle also sends its
          // adopted kind (out). The state words / default / dropdown options are
          // display-only and are deliberately left out, so renaming never re-runs.
          sliders: st.sliders.slice(0, MAX_SLIDERS).map((s, i) => {
            if (s.type === "toggle") return { type: "toggle", value: s.value ? 1 : 0, out: s.out || "auto" };
            if (s.type === "seed") {
              // Random mode rolls a fresh seed each run; the rolled value lives in
              // a RUNTIME field (never node.properties) so a run can't dirty the
              // saved workflow - only shown on the node face.
              let v = Math.floor(Number(s.value) || 0);
              if (s.mode === "random") {
                v = randomSeed();
                (node._pixSeedRun = node._pixSeedRun || {})[i] = v;
                seedRolled = true;
              }
              return { type: "seed", value: v };
            }
            return { type: s.type, value: s.value };
          }),
        });
        if (seedRolled) queueMicrotask(() => { try { renderAll(node); } catch {} });
      }
    }
  } catch (e) {
    console.warn("[Sliders Pixaroma] could not inject slider values:", (e && e.message) || e);
  }
  return result;
};

registerNodeHelp(CLASS, {
  title: "Control Panel Pixaroma",
  tagline: "Every dial and switch you care about, gathered into one panel that drives your whole workflow.",
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
        "the default for every new Control Panel node you add.",
    },
  ],
  footer: "Up to 16 rows per node - sliders and switches, mixed freely. Add as many panels as you like.",
});
