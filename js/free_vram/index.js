// Free VRAM Pixaroma - wiring.
//
// Hand the card's memory back at the exact point in the graph you wire it into.
// core.mjs holds the state and the geometry, ui.mjs the face, settings.mjs the
// gear panel, help.mjs the written help.

import { app } from "/scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { registerNodeSettings, repaintAccent } from "../shared/node_settings.mjs";
import { onRendererChange } from "../shared/renderer_switch.mjs";
import {
  CLASS, DEFAULT_W, HIDDEN_INPUT, MIN_W,
  contentHeight, injectedState, readState, writeReport,
} from "./core.mjs";
import { buildFace, destroyFace, injectCSS, renderFace } from "./ui.mjs";
import { closeSettingsPanelFor, openSettingsPanel } from "./settings.mjs";
import { FREE_VRAM_HELP } from "./help.mjs";

registerNodeHelp(CLASS, FREE_VRAM_HELP);

// Its own panel, so it registers as a custom settings host rather than taking
// the generic accent-only one. ownMenuItem stays false: this node adds no
// right-click entry of its own, so the central one in help_toolbar is wanted.
registerNodeSettings(CLASS, {
  title: "Free VRAM",
  ownMenuItem: false,
  open: (node) => openPanel(node),
  closeFor: (node) => closeSettingsPanelFor(node),
});

// ── the legacy height arithmetic (nodes2-preview-fill.md) ───────────────────
// LiteGraph's computeSize reserves `minHeight + LG_COMPUTE_PAD` for a DOM
// widget while the element itself only ever receives `node.size[1] -
// NODE_CHROME_H`. Reserve more than you hand back and the node sits that much
// taller than its own content and cannot be dragged smaller.
//
// So computeLayoutSize - the ONE number computeSize consumes - reports the
// content height minus the difference, while getMinHeight and the resize floor
// keep the TRUE content height, which is what stops the body being squeezed.
// ⚠️ BOTH NUMBERS ARE MEASURED ON THIS NODE, NOT COPIED. nodes2-preview-fill.md
// spells out the formula for a node with NO slots and says to re-derive; this
// node has one input and one output, so LiteGraph stacks a 20px slot row above
// the widgets and `widgets_start_y` grows with it.
//
// Measured live at six heights (90, 100, 120, 150, 200, 260): the element always
// receives exactly `node.size[1] - 46`, and `computeSize` always returns
// `computeLayoutSize().minHeight + 38`. Copying the slot-less node's 22 made the
// Classic face 24px short of its own content - clipped, and invisible to every
// check that measured a detached clone instead of the live element.
//
// Re-measure if a slot is ever added or removed: set the node to a few known
// heights and read `node.size[1] - root.offsetHeight`; it is a constant.
const LG_COMPUTE_PAD = 38;   // what computeSize adds to computeLayoutSize().minHeight
const NODE_CHROME_H = 46;    // what the element actually loses (slot row + margins)
const LAYOUT_TRIM = LG_COMPUTE_PAD - NODE_CHROME_H;   // -8: here it ADDS

/** The whole node's height for a given content height, in the legacy renderer. */
function nodeHeight(node) {
  return contentHeight(readState(node).showBar) + NODE_CHROME_H;
}

/**
 * ⚠️ THE TWO RENDERERS WANT OPPOSITE THINGS FROM `computeLayoutSize`, and the
 * difference is not the NUMBER - it is whether the method EXISTS.
 *
 * Nodes 2.0 builds the node body as a CSS grid, one row per widget, and picks
 * the track type from `hasLayoutSize = typeof w.computeLayoutSize === "function"`:
 * a widget that HAS the method becomes an `auto` (GROWING) row and absorbs all
 * the node's spare height. That is right for a preview that should fill the
 * body, and wrong for this node, whose face is three fixed rows. With it
 * defined, every pixel the node was taller than its content was pumped into our
 * widget - which is what produced BOTH reported symptoms at once: a big empty
 * band between the input dots and the buttons, and the readout pushed down out
 * through the bottom of the node.
 * So in Nodes 2.0 we SHADOW the DOMWidget prototype's method with `undefined`,
 * which makes the row `min-content` and the face hug its own height exactly.
 *
 * LEGACY has no such grid: there, `computeLayoutSize().minHeight` is simply the
 * number `LGraphNode.computeSize` consumes, and it then ADDS `LG_COMPUTE_PAD` -
 * so it must be handed the PRE-TRIMMED height or the node ends up 16px taller
 * than its content and cannot be dragged smaller.
 *
 * Re-applied on a renderer flip, because the answer differs per renderer.
 */
function applyLayoutSizing(node, widget) {
  const w = widget || node?._pixFvWidget;
  if (!w) return;
  if (isVueNodes()) {
    w.computeLayoutSize = undefined;
  } else {
    w.computeLayoutSize = () => ({
      minHeight: contentHeight(readState(node).showBar) - LAYOUT_TRIM,
      minWidth: 1,
    });
  }
}

function openPanel(node) {
  // The panel calls this back with NO arguments, so close over `node` - taking
  // it as a parameter silently hands every line an undefined and the panel's
  // controls stop reaching the face.
  openSettingsPanel(node, () => {
    renderFace(node);
    repaintAccent(node);
    syncSize(node);
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
  });
}

/**
 * Grow or shrink the node when a setting changed its content height (only the
 * bar can do that today).
 *
 * Diff-gated and legacy-only. In Nodes 2.0 the RENDERED size lives in the Vue
 * layout store rather than in node.size, so writing here would desync the two
 * and the node would jump back on the next workflow switch.
 */
function syncSize(node) {
  if (!node?.size || isVueNodes() || isGraphLoading()) return;
  const want = nodeHeight(node);
  if (Math.abs((node.size?.[1] ?? 0) - want) < 1) return;
  node.setSize?.([Math.max(MIN_W, node.size?.[0] ?? DEFAULT_W), want]);
}

app.registerExtension({
  name: "Pixaroma.FreeVram",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    // Without this a re-registration (hot reload) double-wraps every hook.
    if (nodeType.prototype._pixFvPatched) return;
    nodeType.prototype._pixFvPatched = true;

    injectCSS();

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      const widget = buildFace(this, openPanel);
      // Makes the widget an 'auto' row in Nodes 2.0 so it can take the body,
      // and feeds LiteGraph's computeSize in legacy - which is why it reports
      // the TRIMMED height and getMinHeight does not.
      applyLayoutSizing(this, widget);

      // Fresh size, SYNCHRONOUSLY. configure() runs right after onNodeCreated
      // and restores a saved size, so a deferred write here would clobber the
      // user's own size on every reload and every duplicate (convention #9).
      if (!Array.isArray(this.size)) this.size = [DEFAULT_W, nodeHeight(this)];
      this.size[0] = DEFAULT_W;
      this.size[1] = nodeHeight(this);

      queueMicrotask(() => renderFace(this));

      // The face is the SAME DOM widget in both renderers, so there is nothing
      // to rebuild on a flip - but Nodes 2.0 writes its own taller layout height
      // into node.size (measured: 95 becomes 135), and that height stays behind
      // when the user flips back, leaving a band of empty body in Classic.
      // Repairing it here is safe because a renderer flip is a real user action;
      // syncSize is diff-gated, Classic-only and load-gated, so it can never
      // dirty a clean open. The accepted cost: a node someone had deliberately
      // dragged TALLER in Classic goes back to its content height after a flip.
      // Nothing on this face grows with height, so the extra was empty band
      // anyway - which is the wart this is here to remove.
      this._pixFvRendererOff = onRendererChange(() => {
        applyLayoutSizing(this);
        renderFace(this);
        syncSize(this);
      });
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      // DOM ONLY. Nothing here may write node.size or add/remove slots, or an
      // untouched workflow opens flagged "modified" (Vue Compat #18).
      renderFace(this);
      queueMicrotask(() => renderFace(this));
      return r;
    };

    // The face tells you when the output goes nowhere, because in that state
    // the node can never run. Repainting on a wire change is how that hint
    // keeps up. Safe on the load path: renderFace writes DOM and nothing else.
    const _conn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = _conn?.apply(this, arguments);
      renderFace(this);
      return r;
    };

    /**
     * A run's report. Runtime only, deliberately never serialized (core.mjs
     * writeReport says why).
     *
     * A CACHED node still replays its executed event with the SAME payload, so
     * an unchanged stamp means nothing was actually freed this time and the
     * face must not claim otherwise. Only reachable with "Free on every run"
     * switched off, which is exactly when it would mislead.
     */
    const _executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      _executed?.apply(this, arguments);
      const report = message?.pixaroma_free_vram?.[0];
      if (!report || typeof report !== "object") return;
      const previous = this._pixFvReport;
      const replayed = previous && previous.stamp != null && previous.stamp === report.stamp;
      writeReport(this, { ...report, cached: !!replayed });
      renderFace(this);
    };

    // Classic-only clamps. In Nodes 2.0 the RENDERED size lives in the Vue
    // layout store, not in node.size, so clamping here desyncs the two and the
    // node jumps back on a workflow switch.
    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes() && !isGraphLoading()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        const floor = nodeHeight(this);
        if (size[1] < floor) size[1] = floor;
      }
      return _resize?.apply(this, arguments);
    };

    const _draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      // The load gate matters: a draw hook runs on the FIRST frame of a load,
      // earlier than any other clamp, so an ungated write here is the one place
      // that can rewrite a saved node.size on a clean open (convention #7).
      if (!isVueNodes() && !isGraphLoading() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return _draw?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeSettingsPanelFor(this);
      // Release the renderer watcher, or a deleted node keeps a callback alive
      // on the shared poll for the rest of the session.
      try { this._pixFvRendererOff?.(); } catch {}
      this._pixFvRendererOff = null;
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
    console.error("[Pixaroma.FreeVram] inject failed", e);
  }
  return result;
};

export { openPanel };
