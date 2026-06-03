import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import {
  STATE_PROP,
  readState,
  restoreFromProperties,
  parsePrompts,
  findFirstPromptPackNode,
  setMode,
  MODE_PARAGRAPH,
  MODE_LINE,
} from "./core.mjs";
import { injectCSS, buildRoot, applyState, updateCounter } from "./render.mjs";
import { wireEvents, showNoPromptsToast } from "./interaction.mjs";
import { isQueueLoopActive, beginQueueLoop, endQueueLoop } from "../shared/queue_drivers.mjs";
import { applyAdaptiveCanvasOnly, installResizeFloor, measureRootContent } from "../shared/index.mjs";

const BRAND = "#f66744";

// Default = minimum size (CLAUDE.md UI conventions #5). Fresh-on-canvas
// drops at the compact size; user grows when they need more textarea
// room. Was DEFAULT_H = 280 vs MIN_H = 180 which let user-shrunken
// nodes grow back to 280 on reload.
const DEFAULT_W = 400;
const DEFAULT_H = 210;
// Minimum size the user is allowed to shrink the node to via the resize
// handle. Sized so the bottom bar (three action buttons at min-width 86
// each border-box + 4px gaps + counter pill + root padding) fits without
// crowding AND the textarea is wide enough for the default placeholder
// text to read cleanly. Enforced in onResize and self-healed in
// onDrawForeground.
//   3 * 86 (buttons) + 2 * 4 (gaps) + 8 (gap to counter) + ~78 (counter
//   pill width) + 12 (root padding) ~= 364, plus margin = 400.
const MIN_W = 400;
const MIN_H = 210;
// Widget min-height seen by LiteGraph's layout. Body content is now:
// mode-pill bar (~28) + textarea min (~80) + bottom bar (~30) + root
// padding (~12) = ~150. Round up. (The Paragraph/Line pills moved from the
// canvas slot-row into the DOM body for Nodes 2.0 — see render.mjs.)
const WIDGET_MIN_H = 160;

app.registerExtension({
  name: "Pixaroma.PromptPack",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPromptPack") return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      const node = this;

      // Size assignment runs SYNCHRONOUSLY in onNodeCreated (UI conventions
      // #9). configure() runs AFTER nodeCreated (Vue Compat #8) and restores
      // the saved size from JSON, overwriting whatever we set here - that's
      // exactly what we want for workflow reload + node duplication. Putting
      // this inside queueMicrotask was the bug: the microtask fired AFTER
      // configure() and clobbered the restored size with the default.
      // Mutate size[0/1] in place to play nicely with any reactive proxy.
      if (node.size[0] < MIN_W) node.size[0] = DEFAULT_W;
      if (node.size[1] < MIN_H) node.size[1] = DEFAULT_H;

      // DOM widget creation + initial render stay in queueMicrotask
      // because Vue Compat #8 says nodeCreated fires BEFORE configure()
      // for widget value restoration; without the microtask, we'd render
      // from Python defaults and flash to the saved state.
      queueMicrotask(() => {
        injectCSS();
        restoreFromProperties(node);

        const root = buildRoot();
        node._pixPpRoot = root;

        // canvasOnly: true keeps the widget OUT of the right-sidebar
        // Parameters panel (Vue Compat #15). Without it, the textarea +
        // pills would render in the panel AND its draw call would corrupt
        // node-body layout.
        const _ppWidget = node.addDOMWidget("promptpack", "div", root, {
          serialize: false,
          // canvasOnly set adaptively (CLAUDE.md Nodes 2.0): true in legacy
          // (out of Parameters tab), false in Nodes 2.0 (renders in Vue body).
          getMinHeight: () => WIDGET_MIN_H,
        });
        applyAdaptiveCanvasOnly(_ppWidget);
        // Floor the node at its content height while a resize handle is dragged
        // (Nodes 2.0) so the bottom button row can't be squished out of frame.
        node._pixPpFloorOff = installResizeFloor(root, measureRootContent);

        wireEvents(node, root);

        // Initial render from current state.
        applyState(root, readState(node));

        node.setDirtyCanvas(true, true);
      });
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure ? origConfigure.apply(this, arguments) : undefined;
      restoreFromProperties(this);
      if (this._pixPpRoot) applyState(this._pixPpRoot, readState(this));
      return r;
    };

    // Clamp node size so the user can't drag the resize handle below the
    // point where the widget content overflows past the node frame. Vue
    // Compat #13 notes onResize doesn't always fire reliably for DOM
    // widget resizes, but for the resize handle (the visible drag corner)
    // it does, which is the path users hit when accidentally over-shrinking.
    // Mutate BOTH the `size` parameter AND `this.size` defensively because
    // some LiteGraph forks treat the param as the new size while others
    // already wrote it to this.size by the time the hook fires.
    const origOnResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (size[0] < MIN_W) size[0] = MIN_W;
      if (size[1] < MIN_H) size[1] = MIN_H;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      if (origOnResize) return origOnResize.apply(this, arguments);
    };

    // Min-width self-heal so the body controls never overflow the node
    // frame. (The Paragraph/Line pills are DOM now — see render.mjs — so
    // there's no canvas painting or click hit-testing here anymore.)
    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixPpFloorOff?.();
      this._pixPpFloorOff = null;
      this._pixPpRoot = null;
      if (origRemoved) return origRemoved.apply(this, arguments);
    };
  },
});

// app.graphToPrompt hook - injects activePrompt into the hidden
// PromptPackState input at workflow-submit time. Pattern #9 (Vue Frontend
// Compatibility). Subgraph-safe via tail-id matching. Called once per
// queuePrompt() - the queuePrompt patch below is what changes activePrompt
// between calls so each enqueue sees a different value.
const _origGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt.apply(this, args);
  try {
    const prompt = result?.output;
    if (prompt && typeof prompt === "object") {
      for (const key of Object.keys(prompt)) {
        const entry = prompt[key];
        if (!entry || entry.class_type !== "PixaromaPromptPack") continue;
        const nodeId = parseInt(String(key).split(":").pop(), 10);
        const node = app.graph?.getNodeById?.(nodeId);
        if (!node) continue;
        const state = node.properties?.[STATE_PROP];
        if (!state) continue;
        const activePrompt = (state.activePrompt || "").trim();
        const payload = JSON.stringify({
          version: 1,
          activePrompt,
        });
        entry.inputs = entry.inputs || {};
        entry.inputs.PromptPackState = payload;
      }
    }
  } catch (err) {
    console.error("Pixaroma.PromptPack: graphToPrompt hook failed", err);
  }
  return result;
};

// Batch tracking - counts down "X left" as each queued workflow actually
// finishes executing (NOT just gets accepted into the queue).
//
// Race-safe two-set design (fixed May 2026): for trivial workflows like
// Prompt Pack -> Text Pixaroma (no real rendering work) ComfyUI can
// finish executing the workflow and fire the executing-null event
// BEFORE the queuePrompt HTTP response returns with its prompt_id. The
// naive "add pid on response, remove pid on finish" approach loses
// those races and gets stuck at "N left". We handle this by tracking
// finishes via a completedCount and stashing pids that arrive early in
// earlyFinishedPids so the queuePrompt response handler can match them
// retroactively.

const _batch = {
  node: null,
  total: 0,
  pendingPids: new Set(),       // captured from queuePrompt response, waiting for finish event
  earlyFinishedPids: new Set(), // finish event arrived before we saw the pid in a queuePrompt response
  completedCount: 0,            // total finishes processed (so remaining = total - completedCount)
  activeCapture: false,         // true while our queuePrompt loop is running
};

// Patch api.queuePrompt (the lower-level API call, NOT app.queuePrompt) so
// we always get a response object with .prompt_id regardless of how
// app.queuePrompt's return shape differs across ComfyUI versions. Only
// captures while our batch loop is actively submitting (activeCapture
// flag), so unrelated queue submissions don't end up in our tracker.
//
// The capture cap (completedCount + pendingPids.size < total) defends
// against the niche case where a PromptMulti node ALSO lives in the same
// workflow: its app.queuePrompt patch wraps each of our PP iterations in
// an extra inner loop, which would otherwise dump PM's prompt_ids into
// our tracker too and bloat the "X left" counter.
const _origApiQueuePrompt = api.queuePrompt.bind(api);
api.queuePrompt = async function (...args) {
  const res = await _origApiQueuePrompt(...args);
  if (_batch.activeCapture && res &&
      _batch.completedCount + _batch.pendingPids.size < _batch.total) {
    const pid = res.prompt_id != null ? String(res.prompt_id) : null;
    if (pid) {
      if (_batch.earlyFinishedPids.has(pid)) {
        // Workflow finished before we got the queue response (race).
        // Don't add to pendingPids; just count it as complete now.
        _batch.earlyFinishedPids.delete(pid);
        _batch.completedCount++;
        _refreshBatchCounter();
      } else {
        _batch.pendingPids.add(pid);
      }
    }
  }
  return res;
};

function _refreshBatchCounter() {
  const node = _batch.node;
  if (!node || !node._pixPpRoot) return;
  const state = node.properties?.[STATE_PROP];
  if (!state) return;
  const remaining = Math.max(0, _batch.total - _batch.completedCount);
  if (remaining === 0) {
    _batch.node = null;
    _batch.total = 0;
    _batch.pendingPids.clear();
    _batch.earlyFinishedPids.clear();
    _batch.completedCount = 0;
    updateCounter(node._pixPpRoot, state);
  } else {
    updateCounter(node._pixPpRoot, state, { running: true, remaining, total: _batch.total });
  }
  node.setDirtyCanvas(true, true);
}

function _handleFinish(pid) {
  if (!pid) return;
  if (_batch.pendingPids.has(pid)) {
    _batch.pendingPids.delete(pid);
    _batch.completedCount++;
    _refreshBatchCounter();
  } else if (_batch.activeCapture &&
             _batch.completedCount + _batch.pendingPids.size < _batch.total) {
    // Race: finish arrived before we captured the pid. Stash it for the
    // queuePrompt response handler to claim retroactively. Only stashes
    // while our submission loop is still running AND we haven't yet
    // accounted for `total` workflows, so unrelated finishes from other
    // workflows don't get stashed.
    _batch.earlyFinishedPids.add(pid);
  }
}

api.addEventListener("executing", (event) => {
  const detail = event?.detail;
  // ComfyUI fires 'executing' with detail.node === null when a workflow
  // finishes. Same event also fires per-node during execution (detail.node
  // is the running node-id string) - we skip those.
  if (detail == null) return;
  if (detail.node !== null && detail.node !== undefined) return;
  const pid = detail.prompt_id != null ? String(detail.prompt_id) : null;
  _handleFinish(pid);
});

// Some ComfyUI versions emit execution_success / execution_error instead of
// (or in addition to) the executing-null signal. Catch those too so the
// counter doesn't get stuck at "X left" forever on error or on newer builds.
api.addEventListener("execution_success", (event) => {
  const pid = event?.detail?.prompt_id != null ? String(event.detail.prompt_id) : null;
  _handleFinish(pid);
});
api.addEventListener("execution_error", (event) => {
  const pid = event?.detail?.prompt_id != null ? String(event.detail.prompt_id) : null;
  _handleFinish(pid);
});

// app.queuePrompt patch.
//
// On every Run click: find the first PixaromaPromptPack node in the graph,
// parse its text into an array, and submit one workflow per non-empty
// prompt. Each iteration mutates state.activePrompt BEFORE calling the
// original queuePrompt, so the graphToPrompt hook above captures the right
// prompt for each enqueue.
//
// After each successful enqueue we capture the response's prompt_id into
// _batch.pendingPids so the api 'executing' listener can count it down when
// the workflow actually finishes rendering.
//
// Edge cases:
// - No Prompt Pack node in graph -> fall through unchanged (hot path).
// - 0 parsed prompts (empty or whitespace-only) -> toast warning, bail.
// - 1 prompt -> 1 queue item.
// - Multiple Prompt Pack nodes -> only the first drives the count.
// - Per-iteration error -> log and continue (don't abort the batch).
//
// Known limitation: right-click "Queue (Batch Count: N)" submits with
// batchCount=N. We pass batchCount=1 inside our loop because each enqueue
// is its own prompt; the user-requested batchCount is effectively dropped.
// Same trade-off Prompt Multi makes; matches user expectation that the
// node "owns" the queue count.

const _origQueuePrompt = app.queuePrompt.bind(app);
// Forward ALL arguments. ComfyUI's queuePrompt is (number, batchCount=1,
// queueNodeIds): the 3rd arg carries the "Execute to selected output nodes"
// partial-execution targets. Dropping it makes a partial run execute the FULL
// graph. Only batchCount is overridden (to 1) per prompt inside the loop;
// number, queueNodeIds, and any future args are preserved.
app.queuePrompt = async function (...args) {
  // Another Pixaroma queue-driver (e.g. Prompt Multi) is already looping this
  // Run - pass straight through so the two loops don't multiply (3 prompts * 3
  // rows = 9). The shared lock makes the drivers mutually exclusive.
  if (isQueueLoopActive()) return _origQueuePrompt(...args);

  const ppNode = findFirstPromptPackNode(app);
  if (!ppNode) return _origQueuePrompt(...args);

  const state = readState(ppNode);
  const prompts = parsePrompts(state.text, state.mode);

  if (prompts.length === 0) {
    showNoPromptsToast(app);
    return;
  }

  const root = ppNode._pixPpRoot;
  const total = prompts.length;

  // Reset batch tracking for the new submission. Any in-flight prompt_ids
  // from a previous batch are dropped - their workflows will still complete
  // but we no longer follow them in the counter.
  _batch.node = ppNode;
  _batch.total = total;
  _batch.pendingPids.clear();
  _batch.earlyFinishedPids.clear();
  _batch.completedCount = 0;

  // Show "N left" immediately so the user has feedback while the queue
  // submission loop runs (which only takes ms, but the first workflow
  // execution can take seconds-minutes).
  if (root) {
    ppNode.properties = ppNode.properties || {};
    if (!ppNode.properties[STATE_PROP]) ppNode.properties[STATE_PROP] = state;
    updateCounter(root, ppNode.properties[STATE_PROP], { running: true, remaining: total, total });
    ppNode.setDirtyCanvas(true, true);
  }

  const results = [];
  // Hold the shared queue-driver lock for the whole loop so a nested driver
  // wrapper (Prompt Multi) falls through to a single call instead of looping
  // again and multiplying the submission count.
  beginQueueLoop();
  _batch.activeCapture = true;
  try {
    for (let i = 0; i < prompts.length; i++) {
      ppNode.properties = ppNode.properties || {};
      if (!ppNode.properties[STATE_PROP]) ppNode.properties[STATE_PROP] = state;
      ppNode.properties[STATE_PROP].activePrompt = prompts[i];

      try {
        // The api.queuePrompt wrapper above captures the prompt_id from
        // the API response into _batch.pendingPids. Preserve number +
        // queueNodeIds; force batchCount=1 per prompt.
        const loopArgs = args.slice(); loopArgs[1] = 1;
        const r = await _origQueuePrompt(...loopArgs);
        results.push(r);
      } catch (err) {
        console.error("Pixaroma.PromptPack: per-prompt enqueue failed", err);
      }
    }
  } finally {
    _batch.activeCapture = false;
    endQueueLoop();
  }

  // Safety net: if nothing ended up tracked (unsupported ComfyUI version
  // with a different api shape), reset the counter to idle so it doesn't
  // hang at "N left" forever. Healthy path: the executing /
  // execution_success listeners will count down via _handleFinish.
  if (_batch.pendingPids.size === 0 &&
      _batch.completedCount === 0 &&
      _batch.earlyFinishedPids.size === 0 &&
      root) {
    _batch.node = null;
    _batch.total = 0;
    updateCounter(root, ppNode.properties[STATE_PROP]);
    ppNode.setDirtyCanvas(true, true);
  }

  return results[results.length - 1];
};
