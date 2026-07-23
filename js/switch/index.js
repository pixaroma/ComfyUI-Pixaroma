import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import {
  setupNode, restoreFromProperties,
  handleConnect, handleDisconnect, setActiveRow,
  STATE_PROP,
} from "./core.mjs";
import { drawSwitchRows, hitToggle, hitLabel, labelScreenRect } from "./render.mjs";
import { openLabelEditor, cancelEditorForNode } from "./editor.mjs";
import { buildSwitchVueList } from "./vue_list.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";

// Switch Pixaroma - dynamic N-to-1 switch with per-row toggles.
// Rendering follows the Image Compare Pixaroma pattern: onDrawForeground
// paints row content at the same Y as LiteGraph's native input-dot positions;
// onMouseDown hit-tests those same rects and updates state.
//
// Vue Compat #9 pattern: state on node.properties, hidden SwitchState
// input populated by the graphToPrompt hook below.

const HIDDEN_INPUT_NAME = "SwitchState";

// True while a workflow is loading. The per-node _pixSwitchConfiguring flag
// (now raised by the `configure` wrapper below, not the onConfigure hook) does
// NOT cover connection restoration: LiteGraph restores links at the GRAPH level
// AFTER every node's configure has returned and cleared its flag, so
// handleConnect runs for every restored wire and
// overwrites the saved activeIndex (issue #40 - "switch resets on tab switch /
// reload"). Wrapping app.loadGraphData (the funnel for workflow open, tab
// switch, and Ctrl+Z undo - same fix as Image Resize) gives a load-wide guard,
// with a 300ms trailing window for the link restore that settles a tick later.
let _swLoadingGraph = false;
if (app && app.loadGraphData && !app._pixSwLoadWrapped) {
  app._pixSwLoadWrapped = true;
  const _origLoadGraphData = app.loadGraphData.bind(app);
  app.loadGraphData = function (...args) {
    _swLoadingGraph = true;
    let r;
    try { r = _origLoadGraphData(...args); }
    finally {
      Promise.resolve(r).finally(() => setTimeout(() => { _swLoadingGraph = false; }, 300));
    }
    return r;
  };
}

app.registerExtension({
  name: "Pixaroma.Switch",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaSwitch") return;

    // ── Creation ─────────────────────────────────────────────────────────
    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _origCreated?.apply(this, arguments);
      setupNode(this);
      // Nodes 2.0 only: build the DOM row list (one row per input). It wires
      // itself as node._pixSwRefresh, which core.mjs calls on every slot/state
      // change. Legacy paints the rows on the canvas instead (onDrawForeground).
      if (isVueNodes()) buildSwitchVueList(this);
      // Defer restore so node.properties is populated from workflow JSON
      // before we read it (Vue Compat #8).
      queueMicrotask(() => restoreFromProperties(this));
    };

    // ── Serialize (keep the render-time widget marker out of the file) ───
    // In Nodes 2.0 each input is marked widget-backed (vue_list.mjs) so its dot
    // is drawn on the row instead of in the top column. LiteGraph WOULD write
    // that marker into the workflow (inputAsSerialisable emits `widget: {name}`),
    // which would (a) change every saved file, (b) travel into the legacy
    // renderer, where it would hide the dots we paint ourselves, and (c) flag a
    // clean workflow "modified" on open. The marker is purely a render-time
    // concern - syncRowWidgets rebuilds it on load - so strip it from the
    // serialized copy. The change-tracker snapshots via serialize() too, so this
    // also keeps a plain open+close clean (Vue Compat #18).
    const _origSerialize = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function () {
      const o = _origSerialize?.apply(this, arguments);
      if (o?.inputs) {
        for (const inp of o.inputs) {
          if (inp && inp.widget) delete inp.widget;
        }
      }
      return o;
    };

    // ── Removal ──────────────────────────────────────────────────────────
    // Cancel any open label editor so the DOM <input> is not left orphaned
    // in document.body after the node is deleted.
    // Also clear any pending disconnect timers - actuallyDisconnect already
    // guards on !node.graph, but cancelling the timers is cleaner and avoids
    // the deferred calls firing at all.
    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      cancelEditorForNode(this);
      if (this._pixSwRestoreTimer) {
        clearTimeout(this._pixSwRestoreTimer);
        this._pixSwRestoreTimer = null;
        this._pixSwRestoring = false;
      }
      if (this._pendingDisconnects?.size) {
        for (const timerId of this._pendingDisconnects.values()) {
          clearTimeout(timerId);
        }
        this._pendingDisconnects.clear();
      }
      return _origRemoved?.apply(this, arguments);
    };

    // ── Configure gate (MUST wrap `configure`, NOT the `onConfigure` hook) ──
    // LiteGraph calls the onConfigure HOOK at the very END of configure(), long
    // after it has restored node.inputs and replayed onConnectionsChange for
    // every slot. Verified live (2026-07-23): by the time our onConfigure hook
    // ran, the node already carried all 32 Python-def slots AND a row per slot,
    // because every one of those replayed events reached handleConnect, whose
    // grow-on-trailing-connect logic then cascaded the list to the MAX_INPUTS
    // cap. So the long-standing `_pixSwitchConfiguring` flag (Vue Compat #17)
    // never actually covered the replay it was written for - normalizeSlots
    // just cleaned up the mess immediately afterwards, hiding it. Once the
    // copy/paste fix stopped that cleanup from discarding saved row state, the
    // junk rows survived into the clipboard. Wrapping `configure` raises the
    // flag BEFORE the replay, so handleConnect never sees it.
    const _origConfigureFn = nodeType.prototype.configure;
    nodeType.prototype.configure = function () {
      this._pixSwitchConfiguring = true;
      try {
        // Deliberately NOT `_origConfigureFn?.apply(...)`: a silent no-op here
        // would load every Switch with zero saved state and report nothing.
        if (typeof _origConfigureFn !== "function") {
          console.error("[Switch Pixaroma] node configure() is missing - saved state was not restored");
          return undefined;
        }
        return _origConfigureFn.apply(this, arguments);
      } finally {
        this._pixSwitchConfiguring = false;
        // Paste / Ctrl+D duplicate / alt-drag clone all run through
        // LGraphCanvas._deserializeItems, which adds + configures every node
        // FIRST and reconnects all the links afterwards - later than this
        // finally block, but still inside the SAME tick. Those replayed
        // connects have to grow the row list back (clone() nulled every link,
        // so configure left us with a single row), but they must not hijack the
        // active row that was copied. Keep a flag up across that burst;
        // handleConnect reads it. A 0ms timer drops it the moment the tick
        // ends, so a real user wire right after still activates its row.
        this._pixSwRestoring = true;
        clearTimeout(this._pixSwRestoreTimer);
        this._pixSwRestoreTimer = setTimeout(() => {
          this._pixSwRestoring = false;
          this._pixSwRestoreTimer = null;
        }, 0);
      }
    };

    // ── Configure hook (runs INSIDE configure, with the gate above still up) ──
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      // No flag handling here - the `configure` wrapper above already holds
      // _pixSwitchConfiguring up for the whole of configure, INCLUDING this
      // hook, so the removeInput calls inside restoreFromProperties are gated
      // too. (Setting/clearing it here as well would drop the gate early,
      // since this hook runs partway through configure, not after it.)
      const r = _origConfigure?.apply(this, arguments);
      // Run normalize synchronously - node.properties and node.inputs are
      // already restored by now. Synchronous means the cleanup lands BEFORE the
      // next paint, so there's no visible flash of the 32 raw INPUT_TYPES slots
      // LiteGraph re-creates from the Python def.
      restoreFromProperties(this);
      return r;
    };

    // ── Connection changes ────────────────────────────────────────────────
    // Skip handleConnect / handleDisconnect while _pixSwitchConfiguring is
    // set (workflow load and Ctrl+Z undo replay). Outside configure,
    // isConnected is the canonical signal: true means a fresh user wire just
    // landed, false means a user wire just left.
    //
    // We no longer gate on ioSlot.link != null. That check was a stale
    // defense from before _pixSwitchConfiguring existed. It now actively
    // breaks the grow-on-connect behaviour: LiteGraph sets ioSlot.link just
    // AFTER firing the event for a new wire, so the gate was silently
    // skipping handleConnect and no new empty trailing row appeared.
    const _origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (
      type, slotIndex, isConnected, link, ioSlot
    ) {
      // Two guards: _pixSwitchConfiguring (this node's onConfigure window) and
      // _swLoadingGraph (the graph-level link-restore window that fires AFTER
      // onConfigure - this is the one that was overwriting the saved
      // activeIndex on reload / tab switch, issue #40).
      if (type === 1 /* INPUT */ && !this._pixSwitchConfiguring && !_swLoadingGraph) {
        if (isConnected) handleConnect(this, slotIndex + 1);
        else handleDisconnect(this, slotIndex + 1);
      }
      return _origOnConnectionsChange?.apply(this, arguments);
    };

    // ── Drawing (Image Compare pattern) ──────────────────────────────────
    // onDrawForeground receives ctx already translated so (0,0) = node body
    // top-left. We paint row content (label + toggle) at the same Y that
    // LiteGraph paints its native input dots.
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (_origDraw) _origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      // Nodes 2.0 renders the rows via the DOM list widget, not the canvas.
      if (isVueNodes()) return;
      drawSwitchRows(this, ctx);
    };

    // ── Clicks (Image Compare pattern) ───────────────────────────────────
    // pos is node-body-local [x, y], same coordinate space as our rects.
    const _origDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (e, pos) {
      // Canvas hit-testing is legacy-only: in Nodes 2.0 the rows are a DOM list
      // (clicks handled there) and these painted rects don't exist.
      if (!this.flags?.collapsed && !isVueNodes()) {
        const inputs = this.inputs;
        if (inputs) {
          const w = this.size[0];

          // Toggle hit-test takes priority over label. setActiveRow handles the
          // connected / trailing / already-active checks (mutex no-op).
          for (let i = 0; i < inputs.length; i++) {
            if (hitToggle(pos, w, i)) {
              setActiveRow(this, i + 1);
              return true; // consume the click even if no-op
            }
          }

          // Label area: left-click now ACTIVATES the row (routes this input), so the
          // WHOLE row is one big activate target. Renaming moved to double-click
          // (below) — a near-miss on the toggle used to drop you into label edit and
          // could replace the wrong label (user feedback).
          for (let i = 0; i < inputs.length; i++) {
            if (hitLabel(pos, w, i)) {
              setActiveRow(this, i + 1);
              return true;
            }
          }
        }
      }
      if (_origDown) return _origDown.call(this, e, pos);
    };

    // Double-click a row's label to RENAME it (left-click activates — see above).
    const _origDbl = nodeType.prototype.onDblClick;
    nodeType.prototype.onDblClick = function (e, pos) {
      if (!this.flags?.collapsed && !isVueNodes() && this.inputs) {
        const w = this.size[0];
        for (let i = 0; i < this.inputs.length; i++) {
          if (hitLabel(pos, w, i)) {
            openLabelEditor(this, i + 1, labelScreenRect(this, i + 1));
            return true;
          }
        }
      }
      if (_origDbl) return _origDbl.call(this, e, pos);
    };
  },
});

// ── app.graphToPrompt hook (subgraph-safe) ────────────────────────────────
// Injects the active slot index into the hidden SwitchState input at
// submission time. Pattern #9 (same as Resolution Pixaroma / Switch WH).

function buildSwitchNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === "PixaromaSwitch" || n.type === "PixaromaSwitch") {
        index.set(String(n.id), n);
      }
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findSwitchNode(index, promptId) {
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (tail && index.has(tail)) return index.get(tail);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt hooks. TWO different jobs, deliberately on TWO different hooks:
//
//   graphToPrompt  -> INJECT SwitchState only.   Runs for a RUN *and* for
//                     "Export (API)" (ComfyUI's workflowService.exportWorkflow
//                     calls app.graphToPrompt() and serialises .output).
//   api.queuePrompt -> PRUNE the inactive links. Runs ONLY when a prompt is
//                     actually submitted from the browser.
//
// WHY THE SPLIT (bug reported 2026-07-11): the prune used to live in
// graphToPrompt, so the API EXPORT was pruned too - the exported JSON contained
// only the active input_N and the user could not re-point SwitchState at another
// row (ComfyUI errored: input_1 not supplied). Export now carries EVERY wired
// input_N plus SwitchState, so it can be edited freely and submitted headlessly.
//
// Branch selection itself is NO LONGER the prune's job: node_switch.py declares
// the inputs "lazy" and check_lazy_status() asks ComfyUI for only the active row,
// so the unselected branches do not execute - server-side, which is the only way
// it can work for an API submission (our JS never runs there). The prune is kept
// for BROWSER runs purely as an optimisation: it keeps the unused branches out of
// the prompt, and therefore out of the cache signature (editing an unused branch
// can't invalidate everything downstream) and out of validation (a missing model
// in a branch you are not using can't fail the run) - exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

// The active row for a Switch entry, or null when the live node cannot be resolved
// (a foreign//stale prompt, or a subgraph id that misses the index). Callers must
// treat null as "I don't know": the PRUNE must then delete NOTHING (deleting on a
// guessed row would drop the user's real wires - Python's lazy inputs still keep
// only the active branch running), while the INJECT path may fall back to row 1,
// which is what Python defaults to anyway.
// activeIndex 0 means nothing is connected yet -> 1, so Python surfaces its clear
// "not connected" error rather than a crash.
function switchActiveIndex(index, id) {
  const node = findSwitchNode(index, id);
  if (!node) return null;
  return node.properties?.[STATE_PROP]?.activeIndex || 1;
}

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  const out = result?.output;
  if (out) {
    let index = null;
    for (const id in out) {
      const entry = out[id];
      if (!entry || entry.class_type !== "PixaromaSwitch") continue;
      if (!index) index = buildSwitchNodeIndex();
      entry.inputs = entry.inputs || {};
      entry.inputs[HIDDEN_INPUT_NAME] = String(switchActiveIndex(index, id) ?? 1);
    }
  }
  return result;
};

// Submit-time prune. api.queuePrompt(number, {output, workflow}, options) is the
// single funnel every browser run goes through (normal Run, partial "Execute
// Node", and the Prompt Multi / Prompt Pack / XY Plot queue loops, which all call
// app.queuePrompt -> api.queuePrompt). Forward ...args untouched so
// partialExecutionTargets and any future option survive.
if (!api._pixSwQueueWrapped) {
  api._pixSwQueueWrapped = true;
  const _origQueuePrompt = api.queuePrompt.bind(api);
  api.queuePrompt = async function (...args) {
    try {
      const out = args[1]?.output;
      if (out) {
        let index = null;
        for (const id in out) {
          const entry = out[id];
          if (!entry || entry.class_type !== "PixaromaSwitch") continue;
          if (!index) index = buildSwitchNodeIndex();
          const activeIdx = switchActiveIndex(index, id);
          // null = we could not resolve the live node, so we do NOT know which row
          // is active. Prune nothing rather than guess row 1 and delete real wires.
          if (activeIdx == null || !entry.inputs) continue;
          for (const inputName of Object.keys(entry.inputs)) {
            if (!inputName.startsWith("input_")) continue;
            const slot = Number(inputName.slice("input_".length));
            if (!Number.isFinite(slot) || slot !== activeIdx) {
              delete entry.inputs[inputName];
            }
          }
        }
      }
    } catch (e) {
      // Never block a run over a pruning failure - Python's lazy inputs already
      // guarantee only the active branch executes.
      console.warn("[Switch Pixaroma] could not prune inactive inputs:", (e && e.message) || e);
    }
    return _origQueuePrompt(...args);
  };
}
