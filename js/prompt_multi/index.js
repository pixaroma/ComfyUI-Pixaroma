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
import { installResizeFloor, isVueNodes } from "../shared/index.mjs";
import { pixConfirm, autoGrowTextareas } from "./interaction.mjs";
import { isQueueLoopActive, runQueueLoop, feedsOnlyInactiveSwitch } from "../shared/queue_drivers.mjs";
import { applyAdaptiveCanvasOnly } from "../shared/index.mjs";

const BRAND = "#f66744";

// Default == minimum, so fresh-on-canvas drops are compact and the node
// grows itself via growNodeToContent when the user adds rows. Matches
// the convention used by Text Pixaroma + Show Text Pixaroma. Values
// verified empirically with the sizer console snippet.
const DEFAULT_W = 380;
const DEFAULT_H = 292;
const MIN_W = 380;
const MIN_H = 292;
// Space above the DOM body (title bar + small gap; Prompt Multi has no
// input slots). The Queue Text / List Prompts pills moved from the canvas
// slot-row INTO the DOM body (measured by measureContentHeight) for Nodes
// 2.0, so this no longer needs to budget for canvas pills.
const CHROME_ALLOWANCE = 40;

// Commit a new node height. A bare `node.size[1] = h` array-index write can
// be reverted by Nodes 2.0's reactive layout when the node was last sized in
// the OTHER renderer (cross-renderer shrink bug; see CLAUDE.md Nodes 2.0 +
// Prompt Stack). setSize() commits through LiteGraph's official resize path.
function setNodeHeight(node, h) {
  node.size[1] = h;
  node.setSize?.([node.size[0], h]);
}

function growNodeToContent(node) {
  const root = node._pixPmRoot;
  if (!root) return;
  const contentH = measureContentHeight(root);
  const desired = contentH + CHROME_ALLOWANCE;
  if (desired > node.size[1]) setNodeHeight(node, desired);
}

function fitNodeToContent(node) {
  const root = node._pixPmRoot;
  if (!root) return;
  const contentH = measureContentHeight(root);
  const desired = Math.max(DEFAULT_H, contentH + CHROME_ALLOWANCE);
  setNodeHeight(node, desired);
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

      // Size assignment runs SYNCHRONOUSLY in onNodeCreated (UI conventions
      // #9). configure() runs AFTER nodeCreated (Vue Compat #8) and
      // overwrites with the saved JSON size for workflow reload + node
      // duplication. Putting this inside queueMicrotask was the bug: the
      // microtask fired AFTER configure() and clobbered the restored size
      // with the default. Mutate size[0/1] in place for any reactive proxy.
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
        const { handlers, rerender } = makeHandlers(node, root);
        node._pixPmRoot = root;
        node._pixPmRerender = rerender;
        // DOM-only render (no auto-grow). Used on workflow load so the saved
        // node.size is trusted - the grow path rewrites node.size by a few px
        // (DOM measurement rounding) which would falsely flag the workflow
        // "modified" on a plain open. Auto-grow stays on user-action paths
        // (add/delete/toggle/mode pill) where a size change is legitimate.
        node._pixPmRenderOnly = () => renderRows(node, root, handlers);

        const _pmWidget = node.addDOMWidget("promptmulti", "div", root, {
          serialize: false,
          // canvasOnly set adaptively (CLAUDE.md Nodes 2.0): true in legacy
          // (out of Parameters tab), false in Nodes 2.0 (renders in Vue body).
          getMinHeight: () => measureContentHeight(root),
        });
        applyAdaptiveCanvasOnly(_pmWidget);
        // Floor the node at its content height while a resize handle is dragged
        // (Nodes 2.0) so the bottom button row can't be squished out of frame.
        node._pixPmFloorOff = installResizeFloor(root, measureContentHeight);

        // Re-grow textareas whenever the body becomes visible again (workflow
        // load / tab switch / collapse-expand) or the node width changes. The
        // one-shot rAF in attachTextareaEditor measures once and reads
        // scrollHeight 0 while the body is hidden, so multi-line fields collapse
        // to min height until the user pokes them - this restores them
        // deterministically. Gated on a WIDTH change so our own height edits
        // don't re-trigger it (no feedback loop); never touches node.size, so it
        // is dirty-on-load safe (the abandoned setSize-from-ResizeObserver path
        // is what desynced Align - we only resize the textarea elements).
        let _pmLastW = -1;
        const _pmRO = new ResizeObserver(() => {
          const w = root.clientWidth;
          if (w === _pmLastW) return;
          _pmLastW = w;
          autoGrowTextareas(root);
        });
        _pmRO.observe(root);
        node._pixPmRO = _pmRO;

        node._pixPmGrow = () => {
          growNodeToContent(node);
          node.setDirtyCanvas(true, true);
        };

        node._pixPmRenderOnly();
        node.setDirtyCanvas(true, true);
      });
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure ? origConfigure.apply(this, arguments) : undefined;
      restoreFromProperties(this);
      // DOM-only render on load (no auto-grow) so the saved node.size is
      // preserved and the workflow isn't falsely flagged "modified".
      if (this._pixPmRenderOnly) this._pixPmRenderOnly();
      return r;
    };

    // Clamp manual resize so the canvas pills (top row) and the action
    // buttons (bottom row) never overflow the node frame. Mutate BOTH the
    // parameter AND this.size defensively (some LiteGraph forks treat the
    // param as the new size, others have already written to this.size).
    const origOnResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      // LEGACY ONLY - in Nodes 2.0 the rendered size lives in the Vue layout
      // store, not node.size; clamping node.size here desyncs them and the node
      // jumps to the clamped size on a workflow switch.
      if (!isVueNodes()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (size[1] < MIN_H) size[1] = MIN_H;
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      if (origOnResize) return origOnResize.apply(this, arguments);
    };

    // Min-size self-heal so the body controls never overflow the node frame.
    // LEGACY ONLY (see onResize) - it would desync node.size from the Vue layout.
    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      if (isVueNodes()) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixPmFloorOff?.();
      this._pixPmFloorOff = null;
      this._pixPmRO?.disconnect();
      this._pixPmRO = null;
      this._pixPmRoot = null;
      this._pixPmRerender = null;
      this._pixPmRenderOnly = null;
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
// Subgraph-safe node lookup: ComfyUI flattens subgraph-contained nodes into the
// prompt with composite IDs ("5:12") that app.graph.getNodeById (top-level only)
// can't resolve, so a plain parseInt(tail)+getNodeById silently missed any node
// inside a subgraph (state never injected). Walk every nested subgraph instead
// (mirrors js/text_overlay/index.js + js/find_replace/index.js).
function buildPixPmNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === "PixaromaPromptMulti" || n.type === "PixaromaPromptMulti") index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}
function findPixPmNode(index, promptId) {
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (tail && index.has(tail)) return index.get(tail);
  return null;
}

const _origGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt.apply(this, args);
  try {
    const prompt = result?.output;
    if (prompt && typeof prompt === "object") {
      let index = null;
      for (const key of Object.keys(prompt)) {
        const entry = prompt[key];
        if (!entry || entry.class_type !== "PixaromaPromptMulti") continue;
        if (!index) index = buildPixPmNodeIndex();
        const node = findPixPmNode(index, key);
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

// A node only "drives the queue" if it is actually part of the workflow
// being run. A Prompt Multi node that is muted/bypassed OR not wired to
// anything must NOT intercept the Run - otherwise a leftover node sitting on
// the canvas with no enabled rows blocks every unrelated workflow with the
// "Enable at least one non-empty prompt to run" toast (GitHub issue #39).
//
// mode 2 = muted (LiteGraph NEVER), mode 4 = bypass (ComfyUI). Anything else
// (0 / undefined) counts as active.
function isMultiNodeActive(node) {
  return node.mode !== 2 && node.mode !== 4;
}

// Connected = at least one output slot (text or prompts) has a live link.
// An unwired Prompt Multi feeds nothing and should be ignored by the loop.
function isMultiNodeConnected(node) {
  const outs = node.outputs || [];
  for (const o of outs) {
    if (o && Array.isArray(o.links) && o.links.length > 0) return true;
  }
  return false;
}

function isMultiNodeDriving(node) {
  if (!node) return false;
  const isClass = node.comfyClass === "PixaromaPromptMulti" || node.type === "PixaromaPromptMulti";
  // feedsOnlyInactiveSwitch: when this node is wired ONLY into a Switch
  // Pixaroma input that the Switch isn't currently routing, its rows can't
  // reach any output this run, so it must NOT drive the queue (otherwise
  // every driver wired into one Switch loops and the counts multiply).
  return isClass && isMultiNodeActive(node) && isMultiNodeConnected(node)
    && !feedsOnlyInactiveSwitch(node);
}

// Find the first PixaromaPromptMulti node that actually drives the queue
// (active + connected). Returns null when no participating node exists, so
// the patch falls through to a normal single run.
function findFirstPromptMultiNode() {
  const graph = app.graph;
  if (!graph) return null;
  const top = graph._nodes || graph.nodes || [];
  for (const n of top) {
    if (isMultiNodeDriving(n)) return n;
  }
  function walk(nodes) {
    for (const n of nodes || []) {
      if (isMultiNodeDriving(n)) return n;
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
// Forward ALL arguments. ComfyUI's queuePrompt is (number, batchCount=1,
// queueNodeIds): the 3rd arg carries the "Execute to selected output nodes"
// partial-execution targets. Dropping it makes a partial run execute the FULL
// graph (issue: per-node Execute button ran everything). Only batchCount is
// overridden (to 1) inside the per-row loop; number, queueNodeIds, and any
// future args are preserved.
app.queuePrompt = async function (...args) {
  // Another Pixaroma queue-driver (e.g. Prompt Pack) is already looping this
  // Run - pass straight through so the two loops don't multiply (3 rows * 3
  // prompts = 9). The shared lock makes the drivers mutually exclusive.
  if (isQueueLoopActive()) return _origQueuePrompt.apply(app, args);

  const pmNode = findFirstPromptMultiNode();
  if (!pmNode) return _origQueuePrompt.apply(app, args);

  // List mode: don't loop. The workflow runs once with the full enabled-rows
  // list shipped to downstream From List nodes via the graphToPrompt hook.
  const mode = pmNode.properties?.[STATE_PROP]?.mode;
  if (mode === MODE_LIST) {
    return _origQueuePrompt.apply(app, args);
  }

  // Queue mode: loop one queue item per enabled row.
  const enabled = enabledRowsWithIndex(pmNode);
  if (enabled.length === 0) {
    showNoEnabledToast();
    return;
  }

  // Hold the shared lock for the whole loop so a nested driver wrapper falls
  // through to a single call instead of looping again.
  return runQueueLoop(async () => {
    const results = [];
    for (const { index } of enabled) {
      pmNode.properties = pmNode.properties || {};
      if (!pmNode.properties[STATE_PROP]) pmNode.properties[STATE_PROP] = { rows: [], activeIndex: 0 };
      pmNode.properties[STATE_PROP].activeIndex = index;
      try {
        const loopArgs = args.slice(); loopArgs[1] = 1; // batchCount=1, keep number + queueNodeIds
        const r = await _origQueuePrompt.apply(app, loopArgs);
        results.push(r);
      } catch (err) {
        console.error("Pixaroma.PromptMulti: per-row enqueue failed", err);
      }
    }
    return results[results.length - 1];
  });
};
