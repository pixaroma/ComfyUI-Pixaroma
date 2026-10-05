// Number Pick Pixaroma - wiring.
//
// One number, picked from buttons the user defines, sent with the type the wire
// wants. core.mjs holds the state, ui.mjs the face, settings.mjs the gear panel,
// adopt.mjs the type-from-the-wire logic.

import { app } from "../../../scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { capComputeSizeInNodes2 } from "../shared/core_min_size.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { registerNodeSettings, repaintAccent } from "../shared/node_settings.mjs";
import { CLASS, HIDDEN_INPUT, MIN_W, DEFAULT_W, injectedState, readState } from "./core.mjs";
import { buildFace, renderFace, destroyFace, bodyHeight, minWidthFor, injectCSS,
  nudgeIntoSlots, trimToContent, settleNudge, watchNudge, unwatchNudge } from "./ui.mjs";
import { openSettingsPanel, closeSettingsPanelFor } from "./settings.mjs";
import { ensureSlotType, refreshOut } from "./adopt.mjs";
import { NUMBER_PICK_HELP } from "./help.mjs";

registerNodeHelp(CLASS, NUMBER_PICK_HELP);

// Its own panel, so it registers as a custom settings host rather than taking
// the generic accent-only one.
registerNodeSettings(CLASS, {
  title: "Number Pick",
  ownMenuItem: false,
  open: (node) => openPanel(node),
  closeFor: (node) => closeSettingsPanelFor(node),
});

// Pull the widget body up over Classic's output-slot band. Not serialized (it is
// litegraph's own field for custom slot layouts), Classic-only, and re-asserted
// on configure because a saved node arrives without it.
function liftOverSlots(node) {
  if (!isVueNodes()) node.widgets_start_y = 2;
}

// The two layouts are NOT interchangeable - Classic lays the buttons into the
// output-slot band, which does not exist in Nodes 2.0 - and the renderer can
// flip under a live node with no reload (the Nodes 2.0 notes: a one-time
// isVueNodes() in onNodeCreated does not survive it). One boolean compare a
// second, only while a node of this type is on the canvas.
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
    // renderFace re-asserts the `classic` class itself, so this only has to
    // fix the slot lift and ask for a repaint.
    for (const n of nodes) { liftOverSlots(n); renderFace(n); nudgeIntoSlots(n); }
  }, 1000);
}

// The narrowest this node may be: never below MIN_W, and never narrower than
// its own buttons need. Read live from the state, so adding buttons in the
// settings raises the floor immediately.
function widthFloor(node) {
  try { return Math.max(MIN_W, minWidthFor(readState(node).values)); }
  catch { return MIN_W; }
}

function openPanel(node) {
  openSettingsPanel(node, () => {
    renderFace(node);
    repaintAccent(node);
    // Adding buttons must WIDEN the node, or the new ones have nowhere to go and
    // the last one ends up under the gear. This is a user action (they are in
    // the settings panel), never the load path, so writing node.size here cannot
    // flag a clean workflow modified.
    const floor = widthFloor(node);
    if (node.size?.[0] < floor) node.setSize?.([floor, node.size[1]]);
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
  });
}

app.registerExtension({
  name: "Pixaroma.NumberPick",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    // Without this a re-registration (hot reload) double-wraps every hook.
    if (nodeType.prototype._pixNpPatched) return;
    nodeType.prototype._pixNpPatched = true;
    capComputeSizeInNodes2(nodeType); // Nodes 2.0 Ctrl+Z grow on frontend 1.53 (number-pick.md)

    injectCSS();

    // Vue Compat #17: the flag has to be raised in a wrapper on `configure`
    // ITSELF, not in the onConfigure HOOK - LGraphNode.configure runs the whole
    // connection replay BEFORE it calls onConfigure, so a flag raised there
    // gates nothing.
    const _origConfigureFn = nodeType.prototype.configure;
    if (_origConfigureFn) {
      nodeType.prototype.configure = function () {
        this._pixNpConfiguring = true;
        try { return _origConfigureFn.apply(this, arguments); }
        finally { this._pixNpConfiguring = false; }
      };
    }

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      liftOverSlots(this);
      buildFace(this, openPanel);
      // A fresh node: its slot still carries the def's "*", so say what it
      // really accepts. Safe here because a brand-new node has nothing saved to
      // contradict (the load path is gated inside ensureSlotType's caller).
      ensureSlotType(this);

      // Classic reserves a 20px slot row for the output above the widgets. We
      // lift the body over that band and lay the buttons into its empty left
      // half, so the node owns its own height - hence the instance computeSize.
      // MIN_W and never this.size[0]: computeSize()[0] is also the drag MINIMUM,
      // so returning the live width would ratchet the floor up on every widen.
      if (!isVueNodes()) {
        this.computeSize = function () { return [widthFloor(this), bodyHeight()]; };
      }

      // Fresh size, SYNCHRONOUSLY. configure() runs right after onNodeCreated
      // and restores a saved size, so a deferred write here would clobber the
      // user's own size on every reload and every duplicate (convention #9).
      if (!Array.isArray(this.size)) this.size = [DEFAULT_W, bodyHeight()];
      this.size[0] = Math.max(DEFAULT_W, widthFloor(this));
      // CLASSIC ONLY. There we own the height and pin it (see onResize). In
      // Nodes 2.0 the Vue layout owns it and settles on its own value from the
      // widget's height; writing our own number there just gives it something
      // to disagree with, and node.size then oscillated 28 <-> 66 across
      // reloads, which flips a workflow dirty and back.
      if (!isVueNodes()) this.size[1] = bodyHeight();

      queueMicrotask(() => { renderFace(this); settleNudge(this); });
      watchRenderer();
      watchNudge(this);
    };

    // NO onAdded SIZE CORRECTION HERE, AND THAT IS DELIBERATE.
    //
    // There used to be one, because a node added from the node search came out
    // [320, 100] and rendered 130px tall with a hole under the buttons. That was
    // a SYMPTOM of bodyHeight() returning 44 in Nodes 2.0 and 28 in Classic, not
    // a problem with the add path. Once bodyHeight became one number, a real
    // search-box add settles to [320, 67] rendering 97 ON ITS OWN - verified by
    // neutralising the hook and adding through the real dialog.
    //
    // The hook then became the DEFECT: on the drag-to-place path the node
    // follows the cursor while you position it, so a correction that fires while
    // it is on screen is watched happening ("a fraction of the second after i
    // picked to add to canvas is resizing before my eyes"). Doing it
    // synchronously did not help, because the size it was correcting arrives
    // after the hook returns.
    //
    // Nothing here writes node.size in Nodes 2.0 at all: that renderer's layout
    // owns the height, and every attempt to hold it to a different number
    // produced either an oscillation or a visible resize. Classic owns its own
    // height through onResize + the draw clamp, which is where the pin lives.

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      liftOverSlots(this);
      // DOM ONLY. Nothing here may write node.size, node.properties or a slot,
      // or an untouched workflow opens flagged "modified" (Vue Compat #18) - so
      // the slot type is deliberately NOT corrected here. A node saved before
      // the type existed is corrected on its first real connection instead.
      renderFace(this);
      queueMicrotask(() => { renderFace(this); settleNudge(this); });
      watchRenderer();
      watchNudge(this);
      return r;
    };

    // The type follows the wire. Vue Compat #17 + #19: the per-node configure
    // flag covers the replay INSIDE configure, and isGraphLoading() (checked
    // inside refreshOut) covers the graph-level link restore that fires after
    // every node's configure has already returned. Both are needed.
    const _conn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, index, connected, link, ioSlot) {
      const r = _conn?.apply(this, arguments);
      try {
        if (type === LiteGraph.OUTPUT) {
          // Defer: inside the callback the link is not fully settled, so
          // reading node.outputs[0].links here can miss the one just made
          // (the same timing family as sliders.md #13's disconnect reset).
          setTimeout(() => {
            if (!this.graph) return;             // deleted meanwhile
            if (ensureSlotType(this, { allowWrite: !isGraphLoading() })) {
              this.setDirtyCanvas?.(true, true);
            }
            if (refreshOut(this)) renderFace(this);
          }, 0);
        }
      } catch (e) {
        console.error("[Pixaroma.NumberPick] connection handling failed", e);
      }
      return r;
    };

    // Classic-only clamps. In Nodes 2.0 the RENDERED size lives in the Vue
    // layout store, not in node.size, so clamping here desyncs the two and the
    // node jumps back on a workflow switch.
    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes()) {
        const floor = widthFloor(this);
        if (size[0] < floor) size[0] = floor;
        // PINNED, not floored. The body is one row and nothing in it fills
        // spare space, so a taller node is a big empty box - reported as
        // "it let me do this which dont make sense". Width is still free
        // above the floor, because a wider node spreads the buttons out.
        size[1] = bodyHeight();
      }
      return _resize?.apply(this, arguments);
    };

    const _draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      // The load gate matters: a draw hook runs on the FIRST frame of a load,
      // earlier than any other clamp, so an ungated write here is the one place
      // that can rewrite a saved node.size on a clean open (convention #7).
      if (!isVueNodes() && !isGraphLoading()) {
        const floor = widthFloor(this);
        if (this.size[0] < floor) this.size[0] = floor;
        // Convention #7: onResize does not fire for every path, so the pin
        // needs this belt too - a node that came back from Nodes 2.0 carries
        // that renderer's taller layout height and nothing else would reset it.
        // Both writes are idempotent after the first frame.
        const h = bodyHeight();
        if (this.size[1] !== h) this.size[1] = h;
      }
      return _draw?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeSettingsPanelFor(this);
      unwatchNudge(this);
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
    console.error("[Pixaroma.NumberPick] inject failed", e);
  }
  return result;
};

export { openPanel };
