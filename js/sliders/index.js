import { app } from "/scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import {
  ACCENT_SETTING, BRAND, MAX_SLIDERS,
  readState, normalizeSliders, syncOutputs, addSlider, resolveAutoType, resetRowOnDisconnect,
  comboOptionsOf, randomSeed,
} from "./core.mjs";

// A Control Panel can only drive widget-style value inputs (numbers, on/off,
// dropdowns, seeds, text) - never structural pipes (MODEL, LATENT, ...).
function isValueTarget(node, link) {
  const target = node.graph?.getNodeById?.(link.target_id);
  const inp = target?.inputs?.[link.target_slot];
  const t = String(inp?.type || "").toUpperCase();
  if (t === "INT" || t === "FLOAT" || t === "BOOLEAN" || t === "COMBO" || t === "STRING") return true;
  // "*" or no type = a pass-through / any input (Reroute, Set, Preview) - a valid,
  // common routing target, so never sever it.
  if (t === "*" || t === "") return true;
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
import { openSlidersPanel, closeSlidersPanelFor, rebuildSlidersPanelFor } from "./settings.mjs";

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

      // Pin the rows to the top of the body - set BEFORE the first refresh
      // (matching onConfigure) so no synchronous legacy layout pass can compute
      // widget.y from the old slot-bound formula. WITHOUT this, _arrangeWidgets
      // starts the widgets below the measured slot bounds - and since we park
      // each output ON a row, the slot bounds then depend on widget.y, which
      // depends on the slot bounds... a feedback loop that walks the node taller
      // on every frame (measured: 62 -> 102px and climbing). This is the field
      // litegraph itself points at for custom slot layouts.
      this.widgets_start_y = 2;

      refresh(this);

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
            rebuildSlidersPanelFor(this);   // the row just became wired: relock its type in the open panel
          } else if (link && !isValueTarget(this, link)) {
            // Refuse a wire to an input the panel can't drive (MODEL, LATENT,
            // CONDITIONING, ...); drop it on the next tick and tell the user.
            const self = this, lk = link;
            setTimeout(() => {
              if (!self.graph || isGraphLoading()) return;   // node gone / a load replay - leave it
              try {
                const tgt = self.graph.getNodeById?.(lk.target_id);
                const inp = tgt?.inputs?.[lk.target_slot];
                // Only sever if that slot STILL holds the exact link we refused - a
                // fast rewire / undo could have put a VALID wire there meanwhile.
                if (tgt && inp && inp.link === lk.id) {
                  tgt.disconnectInput(lk.target_slot);
                  self.setDirtyCanvas?.(true, true);
                  showPanelToast("A Control Panel drives numbers, on/off switches, and dropdowns - not that kind of input.");
                }
              } catch {}
            }, 0);
          } else {
            // A valid connection that did not re-type the row (re-wired to the
            // SAME kind, or a "*" pass-through): re-narrow the freed output slot
            // and repaint (it may have shown as an auto slider while unplugged).
            syncOutputs(this);
            refresh(this);
            rebuildSlidersPanelFor(this);
          }
        } else if (!this._pixSldRemovingRow) {
          // Unplugged BY THE USER (not our own removeOutput during a row delete,
          // whose stale slotIndex would reset whatever row shifted into it).
          // A number slider drops back to auto so it can be re-wired to a boolean
          // (and become a switch) or a different number. LiteGraph clears
          // output.links AFTER this callback returns, so defer the check one tick
          // until the slot's remaining connections have settled.
          // Capture the input we were just unplugged from (LiteGraph hands us the
          // removed link here) so a replug to the SAME input keeps the value while
          // a re-wire to a DIFFERENT input re-adopts it (pattern #19).
          const self = this;
          const prevTarget = link ? { id: link.target_id, slot: link.target_slot } : null;
          // The reported slotIndex is UNRELIABLE on a disconnect: disconnectInput
          // and removeLink (both real unwire paths) report the origin output as
          // slot 0 no matter which row was actually unwired - only disconnectOutput
          // reports it correctly. The link object carries the true origin_slot, so
          // trust that. Then capture the ROW object (not the index) so a later row
          // delete can't retarget the deferred reset onto a shifted-in row.
          const outSlot = (link && Number.isInteger(link.origin_slot)) ? link.origin_slot : slotIndex;
          const row = readState(this).sliders[outSlot] || null;
          setTimeout(() => {
            if (!self.graph || isGraphLoading()) return;
            if (resetRowOnDisconnect(self, row, prevTarget)) refresh(self);
            rebuildSlidersPanelFor(self);   // the row dropped to auto: unlock its type in the open panel
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
  const seen = new Set();
  const visit = (graph) => {
    if (!graph || seen.has(graph)) return;   // guard against a subgraph-reference cycle (would stack-overflow)
    seen.add(graph);
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === CLASS || n.type === CLASS) index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner) visit(inner);
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
              // Clamp to the seed contract (0 .. 1e12) - matches ensureSeed, in
              // case a value slipped past normalize (e.g. an external script wrote
              // node.properties directly). Python clamps magnitude but not sign.
              let v = Math.max(0, Math.min(Math.floor(Number(s.value) || 0), 1e12));
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
        "Gather every dial, switch and setting you care about into one node and wire each straight to where it " +
        "belongs, instead of hunting through the graph. Add a control, name it, then connect its output to any " +
        "input. Each control becomes whatever you plug it into, and changes to match if you re-wire it elsewhere.",
    },
    {
      heading: "The kinds of control",
      defs: [
        ["Slider", "For a number: steps, cfg, denoise, a LoRA strength, a width. Drag it (hold Shift for fine control) or double-click to type. Whole number or decimal is decided by the input you plug it into."],
        ["Switch", "For a true / false setting. Click to flip it. Sends true / false, or 1 / 0 for a number input. You can rename its two states and set which one it starts in."],
        ["Dropdown", "For a picker: sampler, scheduler, checkpoint, VAE, a LoRA name. It learns the whole list from the input; in the settings you tick which options to show, so it only offers the ones you actually use."],
        ["Seed", "For a seed input. R randomizes it on every run, N rolls a new fixed one, or click the number to type an exact seed."],
        ["Text", "For words: a prompt, a filename, a style tag. Type straight into it on the node."],
      ],
    },
    {
      heading: "It matches whatever you plug it into",
      body:
        "A fresh control is blank until you connect it. Wire it to a number and it is a slider, to a true / false " +
        "and it is a switch, to a picker and it is a dropdown, to a seed and it is a seed, to a text box and it is " +
        "a text field. Unplug it and wire it somewhere else and it changes to match. It will not connect to things " +
        "it cannot drive, like a model or an image - it tells you if you try.",
    },
    {
      heading: "Settings",
      body:
        "Right-click the node for the settings panel: add and remove controls, rename them, set a slider's range, " +
        "choose which options a dropdown shows, and pick the colour the node paints with (per node, and you can save " +
        "it as the default for every new Control Panel node). Reset values sends the sliders to the middle of their " +
        "range and the switches and dropdowns to their default, leaving seeds and text as they are. Once a control " +
        "is wired its type is fixed to match that input, so unplug it if you want to change the type.",
    },
  ],
  footer: "Up to 16 controls per node - sliders, switches, dropdowns, seeds and text, mixed freely.",
});
