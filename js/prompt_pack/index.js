import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import {
  STATE_PROP,
  readState,
  restoreFromProperties,
  parsePrompts,
  findFirstPromptPackNode,
} from "./core.mjs";
import { injectCSS, buildRoot, applyState, updateCounter } from "./render.mjs";
import { wireEvents, showNoPromptsToast } from "./interaction.mjs";

const DEFAULT_W = 400;
const DEFAULT_H = 320;

app.registerExtension({
  name: "Pixaroma.PromptPack",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPromptPack") return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      const node = this;
      // queueMicrotask defers until after ComfyUI's configure() has merged
      // saved widget values - see Vue Compat #8 in CLAUDE.md. Without it,
      // we render from Python defaults and then flash to the saved state.
      queueMicrotask(() => {
        injectCSS();
        restoreFromProperties(node);

        const root = buildRoot();
        node._pixPpRoot = root;

        // canvasOnly: true keeps the widget OUT of the right-sidebar
        // Parameters panel (Vue Compat #15). Without it, the textarea +
        // pills would render in the panel AND its draw call would corrupt
        // node-body layout.
        node.addDOMWidget("promptpack", "div", root, {
          serialize: false,
          canvasOnly: true,
          getMinHeight: () => 100,
        });

        wireEvents(node, root);

        // Initial render from current state.
        applyState(root, readState(node));

        // Default size on fresh-on-canvas. Saved workflows win because
        // LiteGraph's configure() runs after onNodeCreated and overwrites
        // node.size from the saved JSON.
        if (node.size[0] < DEFAULT_W) node.size[0] = DEFAULT_W;
        if (node.size[1] < DEFAULT_H) node.size[1] = DEFAULT_H;
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

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
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
// finishes executing (NOT just gets accepted into the queue). The
// queuePrompt patch captures the prompt_id from each _origQueuePrompt
// response and adds it to _batch.promptIds. The api 'executing' listener
// below removes a prompt_id when its workflow finishes, then refreshes the
// counter from the new Set size.
//
// Filtering by prompt_id avoids miscounting if the user has other workflows
// running concurrently (their executing events fire too but their prompt_ids
// aren't in our Set so we ignore them).
//
// If the user clicks Run mid-batch, _batch gets reset to the new batch.
// Any still-running old workflows fire executing events that we ignore
// (their prompt_ids no longer match) - the counter tracks the new batch
// cleanly.

const _batch = {
  node: null,
  total: 0,
  promptIds: new Set(),
  activeCapture: false,  // true while our queuePrompt loop is running
};

// Patch api.queuePrompt (the lower-level API call, NOT app.queuePrompt) so
// we always get a response object with .prompt_id regardless of how
// app.queuePrompt's return shape differs across ComfyUI versions. Only
// captures while our batch loop is actively submitting (activeCapture
// flag), so unrelated queue submissions don't end up in our Set.
const _origApiQueuePrompt = api.queuePrompt.bind(api);
api.queuePrompt = async function (...args) {
  const res = await _origApiQueuePrompt(...args);
  if (_batch.activeCapture && res) {
    const pid = res.prompt_id != null ? String(res.prompt_id) : null;
    if (pid) _batch.promptIds.add(pid);
  }
  return res;
};

function _refreshBatchCounter() {
  const node = _batch.node;
  if (!node || !node._pixPpRoot) return;
  const state = node.properties?.[STATE_PROP];
  if (!state) return;
  const remaining = _batch.promptIds.size;
  if (remaining === 0) {
    _batch.node = null;
    _batch.total = 0;
    updateCounter(node._pixPpRoot, state);
  } else {
    updateCounter(node._pixPpRoot, state, { running: true, remaining, total: _batch.total });
  }
  node.setDirtyCanvas(true, true);
}

api.addEventListener("executing", (event) => {
  const detail = event?.detail;
  // ComfyUI fires 'executing' with detail.node === null when a workflow
  // finishes. Same event also fires per-node during execution (detail.node
  // is the running node-id string) - we skip those.
  if (detail == null) return;
  if (detail.node !== null && detail.node !== undefined) return;
  const pid = detail.prompt_id != null ? String(detail.prompt_id) : null;
  if (!pid || !_batch.promptIds.has(pid)) return;
  _batch.promptIds.delete(pid);
  _refreshBatchCounter();
});

// Some ComfyUI versions emit execution_success / execution_error instead of
// (or in addition to) the executing-null signal. Catch those too so the
// counter doesn't get stuck at "X left" forever on error or on newer builds.
api.addEventListener("execution_success", (event) => {
  const detail = event?.detail;
  const pid = detail?.prompt_id != null ? String(detail.prompt_id) : null;
  if (!pid || !_batch.promptIds.has(pid)) return;
  _batch.promptIds.delete(pid);
  _refreshBatchCounter();
});
api.addEventListener("execution_error", (event) => {
  const detail = event?.detail;
  const pid = detail?.prompt_id != null ? String(detail.prompt_id) : null;
  if (!pid || !_batch.promptIds.has(pid)) return;
  _batch.promptIds.delete(pid);
  _refreshBatchCounter();
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
// _batch.promptIds so the api 'executing' listener can count it down when
// the workflow actually finishes rendering.
//
// Edge cases:
// - No Prompt Pack node in graph -> fall through unchanged (hot path).
// - 0 parsed prompts (empty or whitespace-only) -> toast warning, bail.
// - 1 prompt -> 1 queue item.
// - Multiple Prompt Pack nodes -> only the first drives the count.
// - Per-iteration error -> log and continue (don't abort the batch).

const _origQueuePrompt = app.queuePrompt.bind(app);
app.queuePrompt = async function (num, batchCount) {
  const ppNode = findFirstPromptPackNode(app);
  if (!ppNode) return _origQueuePrompt(num, batchCount);

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
  _batch.promptIds.clear();

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
  _batch.activeCapture = true;
  try {
    for (let i = 0; i < prompts.length; i++) {
      ppNode.properties = ppNode.properties || {};
      if (!ppNode.properties[STATE_PROP]) ppNode.properties[STATE_PROP] = state;
      ppNode.properties[STATE_PROP].activePrompt = prompts[i];

      try {
        // The api.queuePrompt wrapper above captures the prompt_id from
        // the API response into _batch.promptIds.
        const r = await _origQueuePrompt(num, 1);
        results.push(r);
      } catch (err) {
        console.error("Pixaroma.PromptPack: per-prompt enqueue failed", err);
      }
    }
  } finally {
    _batch.activeCapture = false;
  }

  // Safety net: if no prompt_ids ended up captured (unsupported ComfyUI
  // version with a different api shape), reset the counter to idle so it
  // doesn't hang at "N left" forever. Healthy path: the executing /
  // execution_success listeners will count down the captured Set.
  if (_batch.promptIds.size === 0 && root) {
    _batch.node = null;
    _batch.total = 0;
    updateCounter(root, ppNode.properties[STATE_PROP]);
    ppNode.setDirtyCanvas(true, true);
  }

  return results[results.length - 1];
};
