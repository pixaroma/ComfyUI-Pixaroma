// AI Prompt Pixaroma - wiring.
//
// core.mjs holds the state, ui.mjs the face, settings.mjs the gear panel and
// the full-screen editor, api.mjs the model list, help.mjs the help text.
//
// Nothing about this node is derived from a stored mode, and the connection
// handler below writes NO serialized state - it only asks the face to redraw
// and lets an open panel re-read the clip wire. That is why it needs none of
// the configure-replay gating the Switch family carries (Vue Compat #17/#19):
// there is nothing for a replayed connection event to corrupt.

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { registerNodeSettings, repaintAccent } from "../shared/node_settings.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import {
  CLASS, DEFAULT_H, DEFAULT_W, HIDDEN_INPUT, MIN_H, MIN_W,
  injectedState, readState, rollSeed, writeState,
} from "./core.mjs";
import { registerSeedRoller } from "../shared/seed_roll.mjs";
// The @tag layer, shared with Prompt Pixaroma. beginPickBuild + makeRunResolvers are
// what let a *category / #list in the idea roll a fresh pick per run and still be
// held until a queue is actually accepted (prompt.md #31).
import { beginPickBuild } from "../prompt/cursors.mjs";
import { makeRunResolvers } from "../prompt/tag_field.mjs";
import { expandAll } from "../prompt/expand.mjs";
// The renderer hook here TOGGLES ONE CSS CLASS. It does NOT rebuild the face:
// this node has one DOM widget in both renderers, and a rebuild hook on Video
// Prompt leaked a widget root per flip and was reverted (video-prompt.md #13).
//
// It is needed because the band's placement is the one thing that genuinely
// differs: Classic floats it up into the slot band, and Nodes 2.0 CLIPS
// anything above the widget top. Measured on a live flip - the band stayed
// floated and the gear, seed and join segment were invisible and unreachable
// until a page refresh (reference_renderer_flip_breaks_per_renderer_ui).
import { onRendererChange } from "../shared/renderer_switch.mjs";
import {
  applyError, applyResult, buildFace, destroyFace, injectCSS, placeBand,
  renderFace,
} from "./ui.mjs";
import {
  closeAIPromptPanelFor, openAIPromptPanel, openEditor, refreshAIPromptPanel,
} from "./settings.mjs";
import { AI_PROMPT_HELP } from "./help.mjs";

registerNodeHelp(CLASS, AI_PROMPT_HELP);

// Pause Text's Regenerate re-rolls every upstream widget called /seed/i. This
// node's seed is not a widget - it lives in the injected state (Vue Compat #9)
// - so that walk used to pass straight over it and, with the mode on Fixed, the
// model stayed cached and handed back the SAME text (reported 2026-08-16).
//
// Writing the stored number is the right move rather than a one-shot override:
// it is exactly what the walk already does to a Seed Pixaroma widget, and in
// Random mode seedForRun rolls per run anyway, so this only has to rescue Fixed.
registerSeedRoller(CLASS, (node) => {
  writeState(node, { seed: rollSeed() });
  renderFace(node);
});

function openPanel(node) {
  openAIPromptPanel(node, (n) => {
    renderFace(n);
    repaintAccent(n);
    n.setDirtyCanvas?.(true, true);
  });
}

/** The face's Expand button. Reuses the panel's editor rather than a second
 *  one that would drift from it; `owner` means deleting the node closes it. */
function openIdeaEditor(node) {
  openEditor("Your idea — " + (node.title || "AI Prompt"), readState(node).idea,
    (text) => {
      writeState(node, { idea: text });
      renderFace(node);
      return true;
    }, { spellcheck: true, owner: node });
}

// Its own panel, so it registers as a custom settings host. ownMenuItem stays
// false because the node adds no right-click line of its own - the central one
// in help_toolbar is the only entry, and true would remove it.
registerNodeSettings(CLASS, {
  title: "AI Prompt",
  ownMenuItem: false,
  open: (node) => openPanel(node),
  closeFor: (node) => closeAIPromptPanelFor(node),
  // The face paints its banner from --pix-acc on the widget root, which the
  // shared repaint reaches, but the readout and the chips are re-derived in
  // renderFace - so a DEFAULT colour change needs this hook to land
  // (node-settings-accent invariant 2).
  onChange: (node) => renderFace(node),
});

app.registerExtension({
  name: "Pixaroma.AIPrompt",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    // A re-registration (hot reload) would otherwise double-wrap every hook.
    if (nodeType.prototype._pixApPatched) return;
    nodeType.prototype._pixApPatched = true;

    injectCSS();

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      buildFace(this, openPanel, openIdeaEditor);

      // Fresh size, SYNCHRONOUSLY. configure() runs right after this and
      // restores a saved size, so a deferred write here would clobber the
      // user's own size on every reload and every duplicate (convention #9).
      if (!Array.isArray(this.size)) this.size = [DEFAULT_W, DEFAULT_H];
      this.size[0] = DEFAULT_W;
      this.size[1] = DEFAULT_H;

      // Vue Compat #8: nodeCreated fires BEFORE configure, so reading the
      // state now would render the defaults and then flash to the saved ones.
      queueMicrotask(() => renderFace(this));

      // Class toggle only - see the import note. Released in onRemoved.
      this._pixApRendererOff = onRendererChange(() => placeBand(this));
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

    // Wiring the clip input changes which model runs, and wiring text makes
    // the join segment appear. Both are pure repaints - nothing serialized is
    // written - so this needs no load gate.
    const _conn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = _conn?.apply(this, arguments);
      renderFace(this);
      refreshAIPromptPanel(this);
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
    nodeType.prototype.onDrawForeground = function () {
      // The load gate is load-bearing: a draw hook runs on the FIRST frame of
      // a workflow load, earlier than any other clamp, so an ungated write
      // here is the one place that can rewrite a saved node.size on a clean
      // open (convention #7).
      if (!isVueNodes() && !isGraphLoading()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      return _draw?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeAIPromptPanelFor(this);
      try { this._pixApRendererOff?.(); } catch (e) { /* already gone */ }
      this._pixApRendererOff = null;
      destroyFace(this);
      return _removed?.apply(this, arguments);
    };
  },
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
// ComfyUI already emits a real per-token progress bar during generation (there
// is a ProgressBar inside the generate loop in comfy/text_encoders/llama.py),
// so the node inherits that for free. What it does not give is a wall-clock
// number, and since generation stops early on the end token the bar fills only
// part way - so the elapsed seconds beside the readout is the more useful one.
const STARTED = new Map();   // node id -> ms

function findById(id) {
  return findNode(buildIndex(), id);
}

// An interrupted run leaves its start time behind, and the next CACHED run
// (which fires no "executing") would then print an absurd elapsed time.
api.addEventListener("execution_start", () => STARTED.clear());

api.addEventListener("executing", (e) => {
  const id = e?.detail?.node ?? e?.detail;
  if (id == null) return;
  if (findById(id)) STARTED.set(String(id), Date.now());
});

// ComfyUI's toast for a node failure says only "This node threw an error
// during execution", with the real message behind a View details click.
// Somebody who picked a model that cannot write text would learn nothing from
// that, so put the message where they are already looking.
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
  const payload = detail?.output?.pixaroma_ai_prompt?.[0];
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
      // Open the pick build BEFORE anything rolls. Prompt Pixaroma's hook does the
      // same and beginPickBuild is idempotent per prompt OBJECT, so whichever of the
      // two runs first opens the build and the other reuses it - extension load order
      // is not stable, so neither may assume it goes first. Get this wrong and one
      // node's picks carry a build id the commit will skip, and its "In order" list
      // never advances again.
      beginPickBuild(out);
      let index = null;
      for (const id in out) {
        const entry = out[id];
        if (!entry || entry.class_type !== CLASS) continue;
        if (!index) index = buildIndex();
        const node = findNode(index, id);
        if (!node) continue;
        try {
          const st = injectedState(node);
          // Expand @tags, and roll every *category and #list NOW, at queue time, so
          // each run gets a fresh pick. A different pick changes this string, so the
          // cache key changes and the model runs again - no nonce needed, exactly as
          // the seed works (ai-prompt.md #1: this node must never grow an IS_CHANGED).
          //
          // The FORMULA is deliberately left alone. It is prose written for a model
          // and people write things like "step #1" in it, which would be scanned as a
          // token; the idea box is where tags belong and where the highlight shows
          // you what they did.
          const res = expandAll(st.idea, makeRunResolvers());
          st.idea = res.out;
          entry.inputs = entry.inputs || {};
          entry.inputs[HIDDEN_INPUT] = JSON.stringify(st);
        } catch (nodeErr) {
          // Per-node guard: one bad node must not stop the others being injected.
          console.error("[Pixaroma.AIPrompt] inject failed for node", id, nodeErr);
        }
      }
    }
  } catch (e) {
    console.error("[Pixaroma.AIPrompt] inject failed", e);
  }
  return result;
};

export { openPanel };
