// Music Prompt Pixaroma - wiring.
//
// One idea in, a caption and lyrics out for MiniMax Music 3. The face is a
// single DOM widget (ui.mjs), the state lives on node.properties and is injected
// at graphToPrompt time (core.mjs), and the gear panel is settings.mjs.

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";

import {
  CLASS,
  DEFAULT_H,
  DEFAULT_W,
  HIDDEN_INPUT,
  MIN_H,
  MIN_W,
  injectedState,
} from "./core.mjs";
import {
  applyError,
  applyResult,
  applyShare,
  buildFace,
  destroyFace,
  renderFace,
} from "./ui.mjs";
import {
  closeMusicPromptPanelFor,
  openIdeaEditor,
  openMusicPromptPanel,
} from "./settings.mjs";
// The @tag layer, shared with Prompt Pixaroma. beginPickBuild + makeRunResolvers are
// what let a *category / #list in the idea roll a fresh pick per run and still be
// held until a queue is actually accepted (prompt.md #31).
import { beginPickBuild } from "../prompt/cursors.mjs";
import { makeRunResolvers } from "../prompt/tag_field.mjs";
import { expandAll } from "../prompt/expand.mjs";
import "./help.mjs";

// ---------------------------------------------------------------------------
// The node
// ---------------------------------------------------------------------------
app.registerExtension({
  name: "Pixaroma.MusicPrompt",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    // A re-registration would wrap every hook a second time and build the face
    // twice. Only reachable on a dev hot-reload, but the guard is free.
    if (nodeType.prototype._pixMpPatched) return;
    nodeType.prototype._pixMpPatched = true;

    const origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = origCreated?.apply(this, arguments);
      // SYNCHRONOUS, never inside a queueMicrotask: configure() runs AFTER
      // onNodeCreated and restores the saved size for a reloaded or duplicated
      // node, so a deferred write would clobber it and every user-resized node
      // would snap back to the default on each tab switch (house convention #9).
      this.size[0] = Math.max(DEFAULT_W, this.size[0] || 0);
      this.size[1] = Math.max(DEFAULT_H, this.size[1] || 0);
      buildFace(
        this,
        (node) => openMusicPromptPanel(node, () => renderFace(node)),
        (node) => openIdeaEditor(node, () => renderFace(node)),
      );
      // So the settings panel can repaint the face after a change without
      // importing ui.mjs (which imports settings.mjs for nothing else).
      this._pixMpRender = () => renderFace(this);
      // Vue Compat #8: nodeCreated fires BEFORE configure, so the paint inside
      // buildFace above reads the DEFAULTS. Without this the face shows an empty
      // idea and "No model" for a moment before flipping to the saved content.
      // Style and DOM only, so it cannot dirty a workflow.
      queueMicrotask(() => renderFace(this));
      return r;
    };

    // Opening a different workflow into an already-constructed node has to
    // repaint from the restored properties. DOM only - it must never write
    // node.size, slots or properties, or an untouched workflow would flag
    // itself modified merely by being opened (Vue Compat #18).
    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = origConfigure?.apply(this, arguments);
      applyShare(this);
      renderFace(this);
      // Backup for the Nodes 2.0 case, where the restore settles a tick later.
      queueMicrotask(() => renderFace(this));
      return r;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      // Deleting a node mid-edit must take its panel with it, or an orphan
      // floats over the canvas pointing at something that is gone.
      try { closeMusicPromptPanelFor(this); } catch (_) { /* already gone */ }
      try { destroyFace(this); } catch (_) { /* already gone */ }
      return origRemoved?.apply(this, arguments);
    };

    // A wire arriving or leaving changes what the banner should say. DOM only,
    // so it needs no isGraphLoading() gate: it writes nothing serialized, which
    // is the whole test in Vue Compat #19.
    const origConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = origConn?.apply(this, arguments);
      try { renderFace(this); } catch (_) { /* face not built yet */ }
      return r;
    };

    // Legacy only. In Nodes 2.0 the rendered size lives in the Vue layout
    // store, not in node.size, so clamping here would desync the two and the
    // node would JUMP to the clamped size on the next workflow switch.
    //
    // ⚠️ AND the load gate is not optional. onResize is NOT only a user drag -
    // it is called from setSize, which the frontend also invokes on workflow
    // restore. Without the gate: save a node below the minimum in Nodes 2.0
    // (which has no live width clamp, so it genuinely can be), reopen it in
    // Classic, and the clamp rewrites node.size on load - so an untouched
    // workflow opens flagged "modified" and offers to save itself.
    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes() && !isGraphLoading()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (size[1] < MIN_H) size[1] = MIN_H;
      }
      return origResize?.apply(this, arguments);
    };

    // Belt and braces: onResize does not fire for every resize path. Same gate,
    // and here it matters even more - a draw hook runs on the FIRST frame of a
    // load, earlier than any other clamp, so an ungated write is the one place
    // that can rewrite a saved node.size on a clean open.
    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function () {
      if (!isVueNodes() && !isGraphLoading()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      return origDraw?.apply(this, arguments);
    };
  },
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
// ComfyUI's per-token progress bar drives the tab title during generation, so
// the node inherits progress for free. What it does not give is a wall-clock
// number, and since generation stops early on the end token the bar fills only
// part way - so the elapsed seconds beside the readout is the more useful one.
const STARTED = new Map();   // node id -> ms

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

// ComfyUI's toast for a node failure says only "This node threw an error during
// execution", with the real message behind a View details click. Somebody who
// picked a model that cannot write text would learn nothing from that, so put
// the message where they are already looking.
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
  const payload = detail?.output?.pixaroma_music_prompt?.[0];
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
const _origGraphToPrompt_fn = app.graphToPrompt;
const _origGraphToPrompt = (...a) => _origGraphToPrompt_fn.apply(app, a);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  try {
    const out = result?.output;
    if (out) {
      // Open the pick build BEFORE anything rolls. Prompt Pixaroma's hook does the
      // same and beginPickBuild is idempotent per prompt OBJECT, so whichever of the
      // hooks runs first opens the build and the others reuse it - extension load
      // order is not stable, so none may assume it goes first. Get this wrong and one
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
          // the seed works.
          //
          // Only the IDEA is expanded. The two FORMULAS are prose written for a
          // model and people write things like "step #1" in them, which would be
          // scanned as a token; the idea box is where tags belong and where the
          // highlight shows you what they did.
          const res = expandAll(st.idea, makeRunResolvers());
          st.idea = res.out;
          entry.inputs = entry.inputs || {};
          entry.inputs[HIDDEN_INPUT] = JSON.stringify(st);
        } catch (nodeErr) {
          // Per-node guard: one bad node must not stop the others being injected.
          console.error("[Pixaroma.MusicPrompt] inject failed for node", id, nodeErr);
        }
      }
    }
  } catch (e) {
    console.error("[Pixaroma.MusicPrompt] inject failed", e);
  }
  return result;
};
