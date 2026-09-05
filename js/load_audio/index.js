// Load Audio Pixaroma - wiring.
//
// core.mjs holds the state, api.mjs talks to the server, waveform.mjs turns the
// file into a picture, ui.mjs is the face, settings.mjs the gear panel.

import { app } from "/scripts/app.js";
import { isVueNodes, applyAdaptiveCanvasOnly, installZoomRepaint } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { installNodeAccent, registerNodeSettings, repaintAccent } from "../shared/node_settings.mjs";
import { CLASS, HIDDEN_INPUT, MIN_W, DEFAULT_W, injectedState, readState, writeState } from "./core.mjs";
import { buildFace, renderFace, destroyFace, injectCSS, stopPlay, repaintWave } from "./ui.mjs";
import { openLoadAudioPanel, closeLoadAudioPanelFor } from "./settings.mjs";
import { LOAD_AUDIO_HELP } from "./help.mjs";

// A CONSTANT, never a live measurement. getMinHeight drives node.size, and a
// measured value comes back a pixel or two different between save and reload,
// which rewrites node.size and flags an untouched workflow "modified"
// (Vue Compat #18).
const WIDGET_MIN_H = 190;
const MIN_H = 234;
const DEFAULT_H = 250;

registerNodeHelp(CLASS, LOAD_AUDIO_HELP);

// ── follow the upstream length ─────────────────────────────────────────────
// Nothing notifies us when the node feeding `seconds` changes its number, and
// there is no connection hook that fires for "the upstream recalculated". One
// shared 400ms poll, running ONLY while a Load Audio node is on the canvas, and
// repainting only when a value actually differs from last time - so an idle
// graph does the walk below and no paint at all.
//
// The tick walks the graph (including subgraphs) rather than reading
// app.graph._nodes, so a node nested in a subgraph is not left with a lying
// readout. That is a Map plus a Set plus an array spread, 2.5 times a second:
// negligible next to a frame, but no longer the "one link lookup" this comment
// used to claim, and worth knowing before anyone profiles it.
let _watch = 0;
const _lastSeen = new WeakMap();

function watchUpstream() {
  if (_watch) return;
  _watch = setInterval(() => {
    // buildIndex, not app.graph._nodes: the latter is the ROOT graph only, so
    // a Load Audio inside a subgraph never repaints and its readout keeps
    // reporting an old length while execution is perfectly correct - the
    // hardest kind of report to diagnose. (The tick writes nothing serialized,
    // so this cannot dirty a workflow.)
    const nodes = [...buildIndex().values()];
    if (!nodes.length) { clearInterval(_watch); _watch = 0; return; }
    for (const n of nodes) {
      // The LINK id is part of the key: dragging the wire to a different source
      // must count as a change even when the two happen to agree on a number
      // (the rewire trap from patterns, reference_upstream_preview_is_not_output).
      const slot = n.inputs?.find((i) => i && i.name === "seconds");
      const key = `${slot?.link ?? "none"}|${upstreamLength(n)}`;
      if (_lastSeen.get(n) === key) continue;
      _lastSeen.set(n, key);
      renderFace(n);
    }
  }, 400);
}

function secondsWired(node) {
  const s = node?.inputs?.find((i) => i && i.name === "seconds");
  return !!(s && s.link != null);
}

/**
 * Unplugging the length wire must not leave an impossible request behind.
 *
 * The stored length can easily be one only the WIRE could satisfy - or, as
 * reported, one captured when the start was somewhere else. Left alone the node
 * then sits there warning "file ends first, will pad with silence" about a
 * length nobody asked for, which reads as the node having broken itself.
 *
 * Clamping (rather than resetting to the whole file) keeps a length the user
 * DID choose by dragging an edge, while turning a leftover into the obvious
 * thing: everything from the start point to the end of the file.
 */
function releaseWiredLength(node) {
  if (secondsWired(node)) return;                 // already re-wired elsewhere
  const dur = node._pixLaDur || 0;
  if (dur <= 0) return;                           // not decoded yet, nothing to clamp against
  const st = readState(node);
  if (st.whenUnwired !== "length") return;
  const fits = Math.max(0, dur - st.start);
  if (st.length <= fits + 0.005) return;          // it already fits: leave the choice alone
  writeState(node, { length: Math.round(fits * 100) / 100 });
  renderFace(node);
}

/** The upstream's published length, or null. Mirrors ui.mjs's own reader. */
function upstreamLength(node) {
  const slot = node.inputs?.find((i) => i && i.name === "seconds");
  if (!slot || slot.link == null || !node.graph) return null;
  const g = node.graph;
  let link = g.links?.[slot.link];
  if (!link && typeof g.links?.get === "function") link = g.links.get(slot.link);
  const src = link ? g.getNodeById?.(link.origin_id) : null;
  if (!src || src.mode === 2 || src.mode === 4) return null;
  const v = src._pixLiveSeconds;
  return Number.isFinite(v) ? v : null;
}

registerNodeSettings(CLASS, {
  title: "Load Audio",
  ownMenuItem: false,
  open: (node) => openPanel(node),
  closeFor: (node) => closeLoadAudioPanelFor(node),
  // The face paints its waveform on its own canvas, which no shared repaint can
  // reach - so a change to a DEFAULT colour needs this hook or every follower
  // keeps the old accent until something unrelated redraws
  // (node-settings-accent.md invariant 2).
  onChange: (node) => renderFace(node),
});

function openPanel(node) {
  openLoadAudioPanel(node, (n) => {
    renderFace(n);
    repaintAccent(n);
    n.setDirtyCanvas?.(true, true);
  });
}

app.registerExtension({
  name: "Pixaroma.LoadAudio",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    // Without this a re-registration (hot reload) double-wraps every hook.
    if (nodeType.prototype._pixLaPatched) return;
    nodeType.prototype._pixLaPatched = true;

    injectCSS();

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      const root = buildFace(this, openPanel);
      // A UNIQUE widget type: any name in ComfyUI's widget registry (textarea,
      // string, combo...) makes Nodes 2.0 render ITS OWN widget and leave our
      // element orphaned off-screen.
      const w = this.addDOMWidget(HIDDEN_INPUT + "_ui", "pixaroma_load_audio", root, {
        serialize: false,
        getMinHeight: () => WIDGET_MIN_H,
      });
      applyAdaptiveCanvasOnly(w);
      // Or the mouse wheel stops zooming the canvas while the cursor is over
      // this node - silent, and easy to miss (convention #17).
      installCanvasZoomPassthrough(root);
      installNodeAccent(this, root);
      this._pixLaFloorOff = installResizeFloor(root, () => WIDGET_MIN_H);
      // The waveform's backing buffer is sized dpr x zoom, so a pure ZOOM
      // change (no resize, so the ResizeObserver stays quiet) would leave it
      // blurry until something else redrew it.
      this._pixLaZoomOff = installZoomRepaint(this, null, () => repaintWave(this), "_pixLaRaf");

      // Fresh size, SYNCHRONOUSLY: configure() runs straight after this and
      // restores a saved size, so a deferred write would clobber the user's own
      // size on every reload and every duplicate (convention #9).
      if (!Array.isArray(this.size)) this.size = [DEFAULT_W, DEFAULT_H];
      this.size[0] = DEFAULT_W;
      this.size[1] = DEFAULT_H;

      queueMicrotask(() => renderFace(this));
      watchUpstream();
    };

    // The gate has to sit on `configure` itself, NOT on the onConfigure HOOK:
    // LGraphNode.configure fires onConnectionsChange for every saved input and
    // only THEN calls onConfigure, so a flag raised in the hook gates nothing
    // (Vue Compat #17's correction).
    const _origConfigureFn = nodeType.prototype.configure;
    nodeType.prototype.configure = function () {
      this._pixLaConfiguring = true;
      try { return _origConfigureFn.apply(this, arguments); }
      finally { this._pixLaConfiguring = false; }
    };

    // Writing `length` is writing SERIALIZED state, so it must never happen
    // during a load or an untouched workflow opens flagged "modified"
    // (Vue Compat #18/#19). isGraphLoading covers the graph-level link restore
    // that runs after every node's configure has already returned.
    const _origConnChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, index, connected, link, ioSlot) {
      const r = _origConnChange?.apply(this, arguments);
      const INPUT = window.LiteGraph?.INPUT ?? 1;
      if (type === INPUT && !connected && ioSlot?.name === "seconds"
          && !this._pixLaConfiguring && !isGraphLoading()) {
        // Deferred: the link is not fully torn down until this handler returns,
        // so secondsWired would still say true.
        queueMicrotask(() => releaseWiredLength(this));
      }
      return r;
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      // DOM ONLY. Nothing here may write node.size or touch slots, or an
      // untouched workflow opens flagged "modified" (Vue Compat #18).
      renderFace(this);
      queueMicrotask(() => renderFace(this));
      watchUpstream();
      return r;
    };

    // What the last run actually did. Runtime-only: writing this to
    // node.properties would dirty a clean workflow on every execution.
    const _executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const r = _executed?.apply(this, arguments);
      const info = message?.pixaroma_load_audio?.[0];
      if (info) {
        this._pixLaRun = info;
        renderFace(this);
      }
      return r;
    };

    // Classic-only clamps. In Nodes 2.0 the rendered size lives in the Vue
    // layout store rather than node.size, so clamping here desyncs the two and
    // the node jumps back to the clamped size on a workflow switch.
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
      // The load gate matters here more than anywhere: a draw hook runs on the
      // FIRST frame of a load, earlier than any other clamp, so an ungated
      // write is the one thing that can rewrite a saved node.size on a clean
      // open (convention #7).
      if (!isVueNodes() && !isGraphLoading()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      return _draw?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeLoadAudioPanelFor(this);
      stopPlay(this);
      this._pixLaFloorOff?.();
      this._pixLaFloorOff = null;
      this._pixLaZoomOff?.();
      this._pixLaZoomOff = null;
      destroyFace(this);
      return _removed?.apply(this, arguments);
    };
  },
});

// ── graphToPrompt: inject the state ────────────────────────────────────────
// INJECT ONLY - never prune here. Export (API) serialises this same output, and
// a prune would silently strip the node's settings out of it.
function buildIndex() {
  const index = new Map();
  const seen = new Set();
  const visit = (graph) => {
    if (!graph || seen.has(graph)) return;      // a subgraph cycle would recurse forever
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
    console.error("[Pixaroma.LoadAudio] inject failed", e);
  }
  return result;
};
