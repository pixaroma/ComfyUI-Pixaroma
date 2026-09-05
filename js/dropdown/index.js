// Dropdown Pixaroma - wiring.
//
// A list you write, one output, and the value type belongs to the NODE rather
// than to whatever it is plugged into. See core.mjs for the state, ui.mjs for
// the face and the output-dot alignment, settings.mjs for the panel.

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { isQueueLoopActive } from "../shared/queue_drivers.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { registerNodeSettings, repaintAccent } from "../shared/node_settings.mjs";
import {
  CLASS, HIDDEN_INPUT, MIN_W, DEFAULT_W, readState, writeState,
  syncOutput, injectedState, commitPick, outCount,
} from "./core.mjs";
import {
  buildRow, renderRow, bodyHeight, alignOutputLegacy, scheduleAlign,
  syncValueRows, renderValueRows,
  watchAlign, unwatchAlign, closePopupFor, injectCSS,
} from "./ui.mjs";
import { WIRE_SUFFIX } from "./coerce.mjs";
import { openDropdownPanel, closeDropdownPanelFor } from "./settings.mjs";
import { DROPDOWN_HELP } from "./help.mjs";
import "./sweep.mjs";   // side-effect: registers the XY Plot sweep provider

// ── Help + settings registration ───────────────────────────────────────────
registerNodeHelp(CLASS, DROPDOWN_HELP);

// This node has its OWN panel, so it registers as a custom settings host rather
// than taking the generic accent-only one. ownMenuItem stops the central
// right-click entry adding a second line beside ours.
registerNodeSettings(CLASS, {
  title: "Dropdown",
  ownMenuItem: false,
  open: (node) => openPanel(node),
  closeFor: (node) => closeDropdownPanelFor(node),
});

/**
 * Re-fit the node after the number of outputs changed. A REAL USER ACTION only
 * - never on the load path, where writing node.size would flag an untouched
 * workflow modified (Vue Compat #18/#19).
 */
function resizeToBody(node) {
  if (isGraphLoading()) return;
  const apply = () => {
    if (isGraphLoading()) return;
    const h = bodyHeight(node);
    if (Math.abs((node.size?.[1] ?? 0) - h) > 0.5) node.setSize?.([node.size[0], h]);
  };
  apply();
  // Nodes 2.0 can clamp the write UP the FIRST time a row count is laid out -
  // measured 188 asked for and 248 landed, then correct on the second visit to
  // the same count. Re-assert once its layout has settled. Safe to repeat: the
  // height is COMPUTED, not measured, so re-applying it cannot drift, and the
  // load gate is re-checked inside.
  if (isVueNodes()) setTimeout(apply, 260);
}


function openPanel(node) {
  openDropdownPanel(node, (n) => {
    syncOutput(n);
    syncValueRows(n);
    renderRow(n);
    renderValueRows(n);
    // ONLY when the output count actually moved. This callback runs on every
    // keystroke in a name or value box, and re-fitting there had two costs:
    // in Nodes 2.0 the height clamp is Classic-only, so a node the user had
    // dragged taller snapped back to its content height on the next character
    // typed; and each keystroke scheduled its own 260ms re-assert timer.
    // Height depends only on the value-row count, so nothing else can need it.
    const now = outCount(n);
    if (n._pixDdOutN !== now) { n._pixDdOutN = now; resizeToBody(n); }
    repaintAccent(n);
    n.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
  });
}

app.registerExtension({
  name: "Pixaroma.Dropdown",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    // Without this, a re-registration (hot reload) double-wraps every hook.
    if (nodeType.prototype._pixDdPatched) return;
    nodeType.prototype._pixDdPatched = true;

    injectCSS();

    // ── Creation ─────────────────────────────────────────────────────────
    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);

      // Pin the row to the top of the body, BEFORE anything measures. Without
      // it, _arrangeWidgets starts the widget below the measured slot bounds -
      // and since we park the output ON the row, the slot bounds then depend on
      // widget.y, which depends on the slot bounds. The node walks taller every
      // frame. This is litegraph's own field for custom slot layouts, and it is
      // not serialized.
      this.widgets_start_y = 2;

      buildRow(this, openPanel);
      syncOutput(this);
      syncValueRows(this);
      renderRow(this);
      renderValueRows(this);
      // Runtime only (never serialized): what the panel callback compares
      // against to know the output count really moved.
      this._pixDdOutN = outCount(this);

      // Legacy reserves a 20px slot row per output; our dot lives on the row, so
      // we own the size. MIN_W and NEVER this.size[0]: computeSize()[0] is also
      // the drag MINIMUM, so returning the live width would ratchet the floor up
      // on every widen and the node could then only ever grow.
      if (!isVueNodes()) {
        this.computeSize = function () { return [MIN_W, bodyHeight(this)]; };
      }

      // Fresh size, SYNCHRONOUSLY. configure() runs right after onNodeCreated
      // and restores a saved size, so a deferred write here would clobber the
      // user's size on every reload and every duplicate (convention #9).
      if (!Array.isArray(this.size)) this.size = [DEFAULT_W, 60];
      this.size[0] = DEFAULT_W;
      // No renderer fudge any more: bodyHeight's Nodes 2.0 base is the MEASURED
      // body height including Vue's own chrome, so it is already the real
      // number. The old "+52 in Vue" was a guess on top of a base that only
      // described Classic, and it left a fresh node 24px taller than its body.
      this.size[1] = bodyHeight(this);

      queueMicrotask(() => {
        renderRow(this);
        syncOutput(this);
        syncValueRows(this);
        renderValueRows(this);
        watchAlign(this);
        scheduleAlign(this);
      });
    };

    // ── Load ─────────────────────────────────────────────────────────────
    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      this.widgets_start_y = 2;
      // Nothing here may write node.size, or an untouched workflow opens
      // flagged "modified" (Vue Compat #18).
      //
      // The slot COUNT is reconciled here ON PURPOSE, and this call is NOT
      // removable: ComfyUI hands a saved one-output Dropdown four slots (the
      // constructor builds all four from the node def and nothing on the load
      // path shrinks them back), so without the trim the node serializes four
      // against a file holding one and dirties every workflow on open. See the
      // note in core.mjs syncOutputs.
      syncOutput(this);
      syncValueRows(this);
      renderRow(this);
      renderValueRows(this);
      this._pixDdOutN = outCount(this);
      queueMicrotask(() => {
        renderRow(this);
        renderValueRows(this);
        watchAlign(this);
        scheduleAlign(this);
      });
      return r;
    };

    // ── Legacy: park the dot on the row ──────────────────────────────────
    // arrange() computes widget.y, which we need to place the dot; the second
    // pass re-measures the slots with the position in place.
    const _arrange = nodeType.prototype.arrange;
    nodeType.prototype.arrange = function () {
      const r = _arrange?.apply(this, arguments);
      if (!isVueNodes()) {
        alignOutputLegacy(this);
        _arrange?.apply(this, arguments);
      }
      return r;
    };

    // ── Keep the geometry out of the saved file ──────────────────────────
    // Legacy WRITES output.pos into the workflow. It means nothing in Nodes 2.0,
    // so a file saved in one renderer differs from the other and a clean
    // workflow opens "modified". It is rebuilt on every arrange, so nothing is
    // lost by stripping it.
    const _serialize = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function () {
      const out = _serialize?.apply(this, arguments);
      try {
        for (const o of out?.outputs || []) {
          delete o.pos;
          // The ",COMBO" the live slot carries is a DRAG-TIME affordance only
          // (coerce.mjs explains why it has to be there). Strip it so the saved
          // file keeps the exact type it always had - otherwise every existing
          // Dropdown would be rewritten on open and flag a clean workflow
          // "modified" (Vue Compat #18).
          if (typeof o.type === "string" && o.type.endsWith(WIRE_SUFFIX)) {
            o.type = o.type.slice(0, -WIRE_SUFFIX.length);
          }
        }
      } catch {}
      return out;
    };

    // ── Size clamps (Classic only) ───────────────────────────────────────
    // In Nodes 2.0 the RENDERED size lives in the Vue layout store, not in
    // node.size, so clamping node.size there desyncs the two: the node renders
    // at the dragged size while node.size holds the clamped one, and a workflow
    // switch rebuilds it at the wrong size.
    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        size[1] = bodyHeight(this);   // the rows own the height, not the drag
      }
      return _resize?.apply(this, arguments);
    };

    const _draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      // The load gate matters: a draw hook runs on the FIRST frame of a workflow
      // load, earlier than any other clamp, so an ungated write here is the one
      // place that can rewrite a saved node.size on a clean open.
      if (!isVueNodes() && !isGraphLoading() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return _draw?.apply(this, arguments);
    };

    // ── Removal ──────────────────────────────────────────────────────────
    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      unwatchAlign(this);
      closePopupFor(this);
      closeDropdownPanelFor(this);
      return _removed?.apply(this, arguments);
    };
  },
});

// ── graphToPrompt: inject the chosen value ─────────────────────────────────
// INJECT ONLY - never prune here (Export (API) serialises this same output).
function buildIndex() {
  const index = new Map();
  const seen = new Set();
  const visit = (graph) => {
    if (!graph || seen.has(graph)) return;   // a subgraph-reference cycle would stack-overflow
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
  // A node inside a subgraph arrives with a composite id like "5:12".
  const tail = s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : null;
  return tail && index.has(tail) ? index.get(tail) : null;
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
        if (!node) continue;
        entry.inputs = entry.inputs || {};
        // A queue-driver sweep (XY Plot) may already have written this cell's
        // value. Hook order between two graphToPrompt wrappers is load-order
        // dependent, so defer to a value that is already there rather than
        // clobbering it. Outside a sweep loop nothing else ever writes this
        // input, so an ordinary run is untouched.
        if (isQueueLoopActive() && typeof entry.inputs[HIDDEN_INPUT] === "string"
            && entry.inputs[HIDDEN_INPUT]) continue;
        entry.inputs[HIDDEN_INPUT] = JSON.stringify(injectedState(node));
      }
    }
  } catch (e) {
    console.error("[Pixaroma.Dropdown] inject failed", e);
  }
  return result;
};

// ── Spend the run's pick, ONLY when a queue is actually accepted ────────────
// graphToPrompt also runs for Export, for workflow sharing, for several Save
// buttons, and for a queue that then fails validation. None of those should
// move an "In order" list on, so the pick is HELD until this fires and the same
// entry is handed out again until then.
if (!app._pixDdQueuePatched && api && typeof api.queuePrompt === "function") {
  app._pixDdQueuePatched = true;
  const _origQueuePrompt_fn = api.queuePrompt;
  const _origQueuePrompt = (...a) => _origQueuePrompt_fn.apply(api, a);
  api.queuePrompt = async function (...args) {
    const res = await _origQueuePrompt(...args);   // throws on a rejected queue -> pick kept
    try {
      const index = buildIndex();
      for (const node of index.values()) {
        commitPick(node);
        // Show what actually ran. DOM only - this must never write serialized
        // state, or every Run would flag the workflow modified.
        renderRow(node);
      }
      app.graph?.setDirtyCanvas?.(true, false);
    } catch (err) {
      console.error("[Pixaroma.Dropdown] commit failed", err);
    }
    return res;
  };
}

export { openPanel, readState, writeState };
