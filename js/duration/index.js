// Duration Pixaroma - wiring.
//
// Pick a length in seconds, send the frame count the model will accept.
// core.mjs holds the state, compute.mjs the browser mirror of the maths,
// ui.mjs the face, settings.mjs the gear panel, recipes.mjs the model presets.

import { app } from "/scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { registerNodeSettings, repaintAccent } from "../shared/node_settings.mjs";
import { CLASS, HIDDEN_INPUT, MIN_W, DEFAULT_W, injectedState } from "./core.mjs";
import { buildFace, renderFace, destroyFace, bodyHeight, injectCSS } from "./ui.mjs";
import { openDurationPanel, closeDurationPanelFor } from "./settings.mjs";
import { DURATION_HELP } from "./help.mjs";

registerNodeHelp(CLASS, DURATION_HELP);

// Its own panel, so it registers as a custom settings host rather than taking
// the generic accent-only one.
registerNodeSettings(CLASS, {
  title: "Duration",
  ownMenuItem: false,
  open: (node) => openPanel(node),
  closeFor: (node) => closeDurationPanelFor(node),
});

// Pull the widget body up over Classic's output-slot band. Not serialized (it is
// litegraph's own field for custom slot layouts), Classic-only, and re-asserted
// on configure because a saved node arrives without it.
function liftOverSlots(node) {
  if (!isVueNodes()) node.widgets_start_y = 2;
}

// The two layouts are NOT interchangeable - Classic lays the picker into the
// output-slot band, which does not exist in Nodes 2.0 - and switching renderer
// fires no hook we can hang off: verified live that an existing node kept the
// Classic class (and so the Classic layout) after the toggle, while a node
// created afterwards was correct. So watch the flag. One boolean compare a
// second, only while a Duration node is on the canvas, and it stops again when
// the last one goes.
let _rendererWatch = 0;
let _lastVue = null;
function watchRenderer() {
  if (_rendererWatch) return;
  _lastVue = isVueNodes();
  _rendererWatch = setInterval(() => {
    const nodes = (app.graph?._nodes || app.graph?.nodes || [])
      .filter((n) => n.comfyClass === CLASS);
    if (!nodes.length) { clearInterval(_rendererWatch); _rendererWatch = 0; return; }
    const now = isVueNodes();
    if (now === _lastVue) return;
    _lastVue = now;
    for (const n of nodes) { liftOverSlots(n); renderFace(n); }
  }, 1000);
}

function openPanel(node) {
  openDurationPanel(node, (n) => {
    renderFace(n);
    repaintAccent(n);
    n.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
  });
}

app.registerExtension({
  name: "Pixaroma.Duration",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    // Without this a re-registration (hot reload) double-wraps every hook.
    if (nodeType.prototype._pixDurPatched) return;
    nodeType.prototype._pixDurPatched = true;

    injectCSS();

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      liftOverSlots(this);
      buildFace(this, openPanel);

      // Classic reserves a 20px slot row per output above the widgets. We lift
      // the body over that band and lay the readout into its empty left half, so
      // the node owns its own height - hence the instance computeSize. MIN_W and
      // never this.size[0]: computeSize()[0] is also the drag MINIMUM, so
      // returning the live width would ratchet the floor up on every widen.
      if (!isVueNodes()) {
        this.computeSize = function () { return [MIN_W, bodyHeight(false)]; };
      }

      // Fresh size, SYNCHRONOUSLY. configure() runs right after onNodeCreated
      // and restores a saved size, so a deferred write here would clobber the
      // user's own size on every reload and every duplicate (convention #9).
      if (!Array.isArray(this.size)) this.size = [DEFAULT_W, bodyHeight()];
      this.size[0] = DEFAULT_W;
      this.size[1] = isVueNodes() ? bodyHeight(true) + 56 : bodyHeight(false);

      queueMicrotask(() => renderFace(this));
      watchRenderer();
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      liftOverSlots(this);
      // DOM ONLY. Nothing here may write node.size or add/remove slots, or an
      // untouched workflow opens flagged "modified" (Vue Compat #18).
      renderFace(this);
      queueMicrotask(() => renderFace(this));
      watchRenderer();
      return r;
    };

    // Classic-only clamps. In Nodes 2.0 the RENDERED size lives in the Vue
    // layout store, not in node.size, so clamping here desyncs the two and the
    // node jumps back on a workflow switch.
    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        // A FLOOR, not a fixed height: the chip row wraps when there are many
        // durations, and forcing the height would clip the extra rows with no
        // way to get them back.
        if (size[1] < bodyHeight(false)) size[1] = bodyHeight(false);
      }
      return _resize?.apply(this, arguments);
    };

    const _draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      // The load gate matters: a draw hook runs on the FIRST frame of a load,
      // earlier than any other clamp, so an ungated write here is the one place
      // that can rewrite a saved node.size on a clean open.
      if (!isVueNodes() && !isGraphLoading() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return _draw?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeDurationPanelFor(this);
      destroyFace(this);
      return _removed?.apply(this, arguments);
    };
  },
});

// ── graphToPrompt: inject the state ────────────────────────────────────────
// INJECT ONLY - never prune here, because Export (API) serialises this same
// output and a prune would silently strip the node's settings from it.
function buildIndex() {
  const index = new Map();
  const seen = new Set();
  const visit = (graph) => {
    if (!graph || seen.has(graph)) return;   // a subgraph cycle would stack-overflow
    seen.add(graph);
    for (const n of graph._nodes || graph.nodes || []) {
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
        entry.inputs[HIDDEN_INPUT] = JSON.stringify(injectedState(node));
      }
    }
  } catch (e) {
    console.error("[Pixaroma.Duration] inject failed", e);
  }
  return result;
};

export { openPanel };
