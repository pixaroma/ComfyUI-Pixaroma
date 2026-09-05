// Video Prompt Pixaroma - wiring.
//
// One node in place of three workflows. core.mjs holds the state, ui.mjs the
// face, settings.mjs the gear panel, api.mjs the formula files, help.mjs the
// help text.
//
// The mode is DERIVED from which image inputs are connected, so the
// onConnectionsChange handler below writes NO serialized state - it only asks
// the face to redraw. That is why this node needs none of the configure-replay
// gating the Switch family carries (Vue Compat #17 / #19): there is nothing for
// a replayed connection event to corrupt.

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { registerNodeSettings, repaintAccent } from "../shared/node_settings.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import {
  CLASS, DEFAULT_H, DEFAULT_W, HIDDEN_INPUT, MIN_H, MIN_W, injectedState,
} from "./core.mjs";
// NO onRendererChange here, deliberately - see ui.mjs's note on destroyFace.
// This node has ONE DOM widget in both renderers, so a live renderer flip has
// nothing to swap and ComfyUI re-parents the element itself. Measured against
// Show Text and Save Video as controls: all three stay connected and correctly
// sized across a flip in both directions.
import {
  applyError, applyResult, buildFace, destroyFace, injectCSS, renderFace,
} from "./ui.mjs";
import { closeVideoPromptPanelFor, openVideoPromptPanel, refreshVideoPromptPanel } from "./settings.mjs";
import { VIDEO_PROMPT_HELP } from "./help.mjs";

registerNodeHelp(CLASS, VIDEO_PROMPT_HELP);

function openPanel(node) {
  openVideoPromptPanel(node, (n) => {
    renderFace(n);
    repaintAccent(n);
    n.setDirtyCanvas?.(true, true);
  });
}

// Its own panel, so it registers as a custom settings host. ownMenuItem stays
// false because the node adds no right-click line of its own - the central one
// in help_toolbar is the only entry, and setting this true would remove it.
registerNodeSettings(CLASS, {
  title: "Video Prompt",
  ownMenuItem: false,
  open: (node) => openPanel(node),
  closeFor: (node) => closeVideoPromptPanelFor(node),
  // The face paints its banner from --pix-acc on the widget root, which the
  // shared repaint reaches, but the readout meta and the chips are re-derived
  // in renderFace - so a DEFAULT colour change needs this hook to land
  // (node-settings-accent invariant 2).
  onChange: (node) => renderFace(node),
});

app.registerExtension({
  name: "Pixaroma.VideoPrompt",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    // A re-registration (hot reload) would otherwise double-wrap every hook.
    if (nodeType.prototype._pixVpPatched) return;
    nodeType.prototype._pixVpPatched = true;

    injectCSS();

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      buildFace(this, openPanel);

      // Fresh size, SYNCHRONOUSLY. configure() runs right after this and
      // restores a saved size, so a deferred write here would clobber the
      // user's own size on every reload and every duplicate (convention #9).
      if (!Array.isArray(this.size)) this.size = [DEFAULT_W, DEFAULT_H];
      this.size[0] = DEFAULT_W;
      this.size[1] = DEFAULT_H;

      // Vue Compat #8: nodeCreated fires BEFORE configure, so reading the state
      // now would render the defaults and then flash to the saved values.
      queueMicrotask(() => renderFace(this));

    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      // DOM ONLY. Nothing here may write node.size, properties or slots, or an
      // untouched workflow opens flagged "modified" (Vue Compat #18).
      renderFace(this);
      queueMicrotask(() => renderFace(this));
      return r;
    };

    // The mode lives in the wires, so a connection change is the one thing that
    // must repaint the banner. This writes nothing serialized, which is exactly
    // why it needs no configure-replay guard.
    const _conn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = _conn?.apply(this, arguments);
      renderFace(this);
      // Wiring or pulling the clip input changes which model actually runs, so
      // an OPEN panel has to stop offering a picker that no longer matters.
      // Still writes nothing serialized, so it needs no load gate.
      refreshVideoPromptPanel(this);
      return r;
    };

    // Classic-only clamps. In Nodes 2.0 the RENDERED size lives in the Vue
    // layout store, not in node.size, so clamping here desyncs the two and the
    // node jumps back to the clamped size on a workflow switch.
    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes() && !isGraphLoading()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (size[1] < MIN_H) size[1] = MIN_H;
      }
      return _resize?.apply(this, arguments);
    };

    const _draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      // The load gate is load-bearing: a draw hook runs on the FIRST frame of a
      // workflow load, earlier than any other clamp, so an ungated write here
      // is the one place that can rewrite a saved node.size on a clean open
      // (convention #7).
      if (!isVueNodes() && !isGraphLoading()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      return _draw?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeVideoPromptPanelFor(this);
      // No renderer-change handle to release - see ui.mjs on why that hook was
      // tried and reverted. Leaving a teardown for it here read as an
      // invitation to re-add it.
      destroyFace(this);
      return _removed?.apply(this, arguments);
    };
  },
});

// ---------------------------------------------------------------------------
// Results, and how long they took
// ---------------------------------------------------------------------------
// ComfyUI already emits a real per-token progress bar during generation (there
// is a ProgressBar inside the generate loop in comfy/text_encoders/llama.py), so
// the node inherits that for free. What it does NOT give is a wall-clock number,
// and since generation stops early on the end token the bar fills only part way
// - so the elapsed seconds beside the readout is the more useful of the two.
const STARTED = new Map();   // node id -> ms

// Reuses the SAME index the graphToPrompt hook builds, which recurses into
// subgraphs and guards cycles. A top-level-only scan meant a node inside a
// subgraph generated correctly but its readout stayed empty forever, and a
// tail-id match could write one node's result into another's readout.
function findById(id) {
  return findNode(buildIndex(), id);
}

// A run that is interrupted leaves its start time behind, and the next CACHED
// run (which fires no "executing") would then print an absurd elapsed time.
api.addEventListener("execution_start", () => STARTED.clear());

api.addEventListener("executing", (e) => {
  const id = e?.detail?.node ?? e?.detail;
  if (id == null) return;
  if (findById(id)) STARTED.set(String(id), Date.now());
});

// ComfyUI's toast for a node failure says only "This node threw an error during
// execution", with the actual message behind a View details click. Somebody who
// picked a model that cannot write text would learn nothing from that, so put
// the message where they are already looking: the node's own readout.
api.addEventListener("execution_error", (e) => {
  const d = e?.detail;
  if (!d) return;
  const node = findById(d.node_id ?? d.node);
  if (!node) return;
  STARTED.delete(String(d.node_id ?? d.node));
  applyError(node, d.exception_message);
});

api.addEventListener("executed", (e) => {
  const detail = e?.detail;
  const payload = detail?.output?.pixaroma_video_prompt?.[0];
  if (!payload) return;
  const node = findById(detail.node);
  if (!node) return;
  const t0 = STARTED.get(String(detail.node));
  STARTED.delete(String(detail.node));
  const elapsed = t0 ? Math.max(0, Math.round((Date.now() - t0) / 100) / 10) : null;
  applyResult(node, payload, elapsed);
});

// ---------------------------------------------------------------------------
// graphToPrompt: inject the state
// ---------------------------------------------------------------------------
// INJECT ONLY - never prune here, because Export (API) serialises this same
// output and a prune would silently strip the node's settings from it.
//
// This is also where a Random seed is BAKED IN for the run, so the value the
// model actually used is the value that went into the queued workflow.
function buildIndex() {
  const index = new Map();
  const seen = new Set();
  const visit = (graph) => {
    if (!graph || seen.has(graph)) return;   // a subgraph cycle would recurse forever
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
    console.error("[Pixaroma.VideoPrompt] inject failed", e);
  }
  return result;
};

export { openPanel };
