import { app } from "/scripts/app.js";
import {
  readState,
  restoreFromProperties,
  addRow,
  deleteRow,
  toggleEnabled,
  reorderRows,
  enabledRowsWithIndex,
  clearAllText,
  resetToDefault,
  setMode,
  STATE_PROP,
  MODE_QUEUE,
  MODE_LIST,
} from "./core.mjs";
import { injectCSS, buildRoot, renderRows, measureContentHeight } from "./render.mjs";
import { pixConfirm } from "./interaction.mjs";

const DEFAULT_W = 420;
const DEFAULT_H = 290;
// Title bar + body padding + the two output dots on the right side.
const CHROME_ALLOWANCE = 70;

function growNodeToContent(node) {
  const root = node._pixPmRoot;
  if (!root) return;
  const contentH = measureContentHeight(root);
  const desired = contentH + CHROME_ALLOWANCE;
  if (desired > node.size[1]) node.size[1] = desired;
}

function fitNodeToContent(node) {
  const root = node._pixPmRoot;
  if (!root) return;
  const contentH = measureContentHeight(root);
  const desired = Math.max(DEFAULT_H, contentH + CHROME_ALLOWANCE);
  node.size[1] = desired;
}

// Multi always exposes BOTH outputs (text + list). The mode toggle only
// controls the queue loop behavior, not which output exists. This avoids
// the buggy dynamic-slot-renaming approach where Python's fixed slot order
// (text=0, list=1) would conflict with frontend slot juggling. User wires
// whichever output they need; the mode pill clarifies intent (N runs vs
// one run).

function makeHandlers(node, root) {
  const rerender = () => {
    renderRows(node, root, handlers);
    requestAnimationFrame(() => {
      growNodeToContent(node);
      node.setDirtyCanvas(true, true);
    });
  };
  const handlers = {
    onToggleEnabled: (id) => { toggleEnabled(node, id); rerender(); },
    onLabelChange: (_id, _v) => { /* inline */ },
    onTextChange: (_id, _v) => { /* inline */ },
    onSetMode: (newMode) => {
      const state = readState(node);
      if (state.mode === newMode) return;
      setMode(node, newMode);
      rerender();
    },
    onDelete: async (id) => {
      const state = readState(node);
      const row = state.rows.find((r) => r.id === id);
      const hasContent = row && ((row.text && row.text.trim()) || (row.label && row.label.trim()));
      if (hasContent) {
        const labelOrIdx = (row.label && row.label.trim()) || `Prompt ${state.rows.indexOf(row) + 1}`;
        const ok = await pixConfirm({
          title: "Delete row?",
          message: `Are you sure you want to delete "${labelOrIdx}"?`,
          okText: "Delete",
          cancelText: "Cancel",
        });
        if (!ok) return;
      }
      deleteRow(node, id);
      rerender();
      requestAnimationFrame(() => {
        fitNodeToContent(node);
        node.setDirtyCanvas(true, true);
      });
    },
    onAdd: () => { addRow(node); rerender(); },
    onClearAll: async () => {
      const state = readState(node);
      const filled = state.rows.filter((r) => r.text && r.text.trim()).length;
      if (filled === 0) return;
      const ok = await pixConfirm({
        title: "Clear all prompts?",
        message: `This will empty the text in all ${state.rows.length} row${state.rows.length === 1 ? "" : "s"}. Labels and ON/OFF toggles are kept.`,
        okText: "Clear",
        cancelText: "Cancel",
      });
      if (!ok) return;
      clearAllText(node);
      rerender();
    },
    onReset: async () => {
      const ok = await pixConfirm({
        title: "Reset to default?",
        message: "This will replace all rows with two empty prompts, both ON, no labels, in Queue mode. Your current rows will be lost.",
        okText: "Reset",
        cancelText: "Cancel",
      });
      if (!ok) return;
      resetToDefault(node);
      rerender();
      requestAnimationFrame(() => {
        fitNodeToContent(node);
        node.setDirtyCanvas(true, true);
      });
    },
    onDragStart: (_id, _ev) => { /* drag state is held inside interaction.mjs */ },
    onDragOver: (_id, _ev) => { /* drag state is held inside interaction.mjs */ },
    onDrop: (fromId, toId, above) => {
      const state = readState(node);
      const fromIdx = state.rows.findIndex((r) => r.id === fromId);
      const toIdxRaw = state.rows.findIndex((r) => r.id === toId);
      if (fromIdx < 0 || toIdxRaw < 0) return;
      let destIdx = above ? toIdxRaw : toIdxRaw + 1;
      if (fromIdx < destIdx) destIdx -= 1;
      if (destIdx === fromIdx) return;
      reorderRows(node, fromIdx, destIdx);
      rerender();
    },
    onDragEnd: (_ev) => { /* no-op */ },
  };
  return { handlers, rerender };
}

app.registerExtension({
  name: "Pixaroma.PromptMulti",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPromptMulti") return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      const node = this;
      queueMicrotask(() => {
        injectCSS();
        restoreFromProperties(node);

        const root = buildRoot();
        const { handlers, rerender } = makeHandlers(node, root);
        node._pixPmRoot = root;
        node._pixPmRerender = rerender;

        node.addDOMWidget("promptmulti", "div", root, {
          serialize: false,
          canvasOnly: true,
          getMinHeight: () => measureContentHeight(root),
        });

        node._pixPmGrow = () => {
          growNodeToContent(node);
          node.setDirtyCanvas(true, true);
        };

        rerender();

        if (node.size[0] < DEFAULT_W) node.size[0] = DEFAULT_W;
        if (node.size[1] < DEFAULT_H) node.size[1] = DEFAULT_H;
        node.setDirtyCanvas(true, true);
      });
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure ? origConfigure.apply(this, arguments) : undefined;
      restoreFromProperties(this);
      if (this._pixPmRerender) this._pixPmRerender();
      return r;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixPmRoot = null;
      this._pixPmRerender = null;
      this._pixPmGrow = null;
      this._pixPmRefreshClear = null;
      if (origRemoved) return origRemoved.apply(this, arguments);
    };
  },
});

// app.graphToPrompt hook - injects mode + activePrompt + rowTexts (enabled
// rows only) into the hidden PromptMultiState input at workflow-submit
// time. Pattern #9 (Vue Frontend Compatibility). Subgraph-safe via tail-id
// matching. Called once per queuePrompt() - the queuePrompt patch below is
// what changes activeIndex between calls in queue mode so each enqueue sees
// a different active prompt.
const _origGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt.apply(this, args);
  try {
    const prompt = result?.output;
    if (prompt && typeof prompt === "object") {
      for (const key of Object.keys(prompt)) {
        const entry = prompt[key];
        if (!entry || entry.class_type !== "PixaromaPromptMulti") continue;
        const nodeId = parseInt(String(key).split(":").pop(), 10);
        const node = app.graph?.getNodeById?.(nodeId);
        if (!node) continue;
        const state = node.properties?.[STATE_PROP];
        if (!state || !Array.isArray(state.rows) || state.rows.length === 0) continue;
        const mode = (state.mode === MODE_LIST) ? MODE_LIST : MODE_QUEUE;
        const idx = (typeof state.activeIndex === "number" && state.activeIndex >= 0 && state.activeIndex < state.rows.length)
          ? state.activeIndex
          : 0;
        const activePrompt = (state.rows[idx]?.text || "").trim();
        // List of enabled, non-empty rows' text, in display order. Empty /
        // disabled rows are skipped so downstream From List indices map to
        // meaningful prompts.
        const rowTexts = state.rows
          .filter((r) => r.enabled && r.text && r.text.trim())
          .map((r) => r.text);
        const payload = JSON.stringify({
          version: 2,
          mode,
          activePrompt,
          rowTexts,
        });
        entry.inputs = entry.inputs || {};
        entry.inputs.PromptMultiState = payload;
      }
    }
  } catch (err) {
    console.error("Pixaroma.PromptMulti: graphToPrompt hook failed", err);
  }
  return result;
};

// app.queuePrompt patch.
//
// In QUEUE mode: for every queuePrompt call, find the first PixaromaPromptMulti
// node in the graph, read its enabled rows, and submit one workflow per
// enabled row. Each iteration mutates activeIndex BEFORE calling the original
// queuePrompt, so the graphToPrompt hook above captures the right row's text.
//
// In LIST mode: skip the loop entirely - the workflow runs once normally,
// and the From List downstream picker grabs whichever row it wants from the
// full enabled-rows list shipped via the `prompts` output.
//
// Edge cases (queue mode):
// - 0 enabled non-empty rows -> toast warning, bail (no queue activity).
// - 1 enabled row -> 1 queue item.
// - Multiple Prompt Multi nodes -> only the first drives the count.
//
// If no Prompt Multi node exists, the patch falls through to the original.

function findFirstPromptMultiNode() {
  const graph = app.graph;
  if (!graph) return null;
  const top = graph._nodes || graph.nodes || [];
  for (const n of top) {
    if (n?.comfyClass === "PixaromaPromptMulti" || n?.type === "PixaromaPromptMulti") return n;
  }
  function walk(nodes) {
    for (const n of nodes || []) {
      if (n?.comfyClass === "PixaromaPromptMulti" || n?.type === "PixaromaPromptMulti") return n;
      const sub = n?.subgraph?._nodes || n?.subgraph?.nodes;
      if (sub) {
        const hit = walk(sub);
        if (hit) return hit;
      }
    }
    return null;
  }
  return walk(top);
}

function showNoEnabledToast() {
  const msg = "Enable at least one non-empty prompt to run.";
  const tm = app.extensionManager?.toast;
  if (tm && typeof tm.add === "function") {
    try {
      tm.add({ severity: "warn", summary: "Prompt Multi", detail: msg, life: 4000 });
      return;
    } catch (_e) { /* fall through to console */ }
  }
  console.warn("[Pixaroma.PromptMulti] " + msg);
  try {
    const banner = document.createElement("div");
    banner.textContent = msg;
    banner.style.cssText = "position:fixed;top:60px;right:20px;background:#1d1d1d;color:#fff;font:14px sans-serif;padding:10px 14px;border-radius:6px;border:2px solid #f66744;z-index:99999;";
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 4000);
  } catch (_e) {}
}

// Save the original WITHOUT pre-binding (matches the Switch graphToPrompt
// hook pattern in this project). Using `.call(app, ...)` per invocation
// keeps the chain consistent with extensions that monkey-patch
// app.queuePrompt themselves, instead of locking in a bound reference at
// extension-load time.
const _origQueuePrompt = app.queuePrompt;
app.queuePrompt = async function (num, batchCount) {
  const pmNode = findFirstPromptMultiNode();
  if (!pmNode) return _origQueuePrompt.call(app, num, batchCount);

  // List mode: don't loop. The workflow runs once with the full enabled-rows
  // list shipped to downstream From List nodes via the graphToPrompt hook.
  const mode = pmNode.properties?.[STATE_PROP]?.mode;
  if (mode === MODE_LIST) {
    return _origQueuePrompt.call(app, num, batchCount);
  }

  // Queue mode: loop one queue item per enabled row.
  const enabled = enabledRowsWithIndex(pmNode);
  if (enabled.length === 0) {
    showNoEnabledToast();
    return;
  }

  const results = [];
  for (const { index } of enabled) {
    pmNode.properties = pmNode.properties || {};
    if (!pmNode.properties[STATE_PROP]) pmNode.properties[STATE_PROP] = { rows: [], activeIndex: 0 };
    pmNode.properties[STATE_PROP].activeIndex = index;
    try {
      const r = await _origQueuePrompt.call(app, num, 1);
      results.push(r);
    } catch (err) {
      console.error("Pixaroma.PromptMulti: per-row enqueue failed", err);
    }
  }
  return results[results.length - 1];
};
