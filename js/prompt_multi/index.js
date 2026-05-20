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

const BRAND = "#f66744";

// Default == minimum, so fresh-on-canvas drops are compact and the node
// grows itself via growNodeToContent when the user adds rows. Matches
// the convention used by Text Pixaroma + Show Text Pixaroma. Values
// verified empirically with the sizer console snippet.
const DEFAULT_W = 380;
const DEFAULT_H = 292;
const MIN_W = 380;
const MIN_H = 292;
// Slot-row space at the top of the body (where the canvas-painted Queue
// Text / List Prompts pills live: PILL_Y 20 + PILL_H 22 + margin ~ 50)
// plus a buffer for DOM widget padding. Earlier 44 was too small: with
// pills at Y=20 the DOM widget got `size[1] - 50` of space, but we only
// budgeted 44 above contentH so action buttons overlapped the textareas
// when the user typed enough to autogrow a row to its max height. Sized
// so both rows hitting their 120px textarea cap still leaves a clean
// gap above the action buttons.
const CHROME_ALLOWANCE = 68;

// Mode-pill geometry. Painted on the canvas at the slot-row Y so the
// DOM widget below stays compact. Dimensions and corner radius match
// the bottom action buttons (Prompt Pack convention - same design
// language across Pixaroma nodes).
const PILL_Y = 20;
const PILL_H = 22;
const PILL_GAP = 4;
const PILL_LEFT = 20;
const PILL_W = 86;
const PILL_RADIUS = 4;

function pillQueueRect() {
  return { x: PILL_LEFT, y: PILL_Y, w: PILL_W, h: PILL_H };
}
function pillListRect() {
  return { x: PILL_LEFT + PILL_W + PILL_GAP, y: PILL_Y, w: PILL_W, h: PILL_H };
}
function insideRect(pos, r) {
  return pos[0] >= r.x && pos[0] <= r.x + r.w && pos[1] >= r.y && pos[1] <= r.y + r.h;
}
function paintPill(ctx, r, label, active, hover) {
  const isHot = active || hover;
  ctx.fillStyle = isHot ? BRAND : "rgba(255,255,255,0.05)";
  ctx.strokeStyle = isHot ? BRAND : "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, PILL_RADIUS);
  else ctx.rect(r.x, r.y, r.w, r.h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = isHot ? "#fff" : "rgba(255,255,255,0.85)";
  ctx.font = "11px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
}

// Floating tooltip for the canvas-painted pills. One shared element on
// document.body, follows the cursor via a window mousemove listener
// while a pill is hovered. Same pattern as Prompt Pack.
let _tooltipEl = null;
let _tooltipMoveHandler = null;
function ensureTooltip() {
  if (_tooltipEl) return _tooltipEl;
  _tooltipEl = document.createElement("div");
  _tooltipEl.className = "pix-pm-tooltip";
  _tooltipEl.style.cssText = [
    "position: fixed",
    "background: #1d1d1d",
    "color: #ddd",
    "padding: 6px 10px",
    "border-radius: 4px",
    "border: 1px solid #444",
    "font: 11px 'Segoe UI', sans-serif",
    "line-height: 1.35",
    "pointer-events: none",
    "z-index: 99999",
    "max-width: 260px",
    "box-shadow: 0 4px 12px rgba(0,0,0,0.4)",
    "display: none",
    "white-space: normal",
  ].join("; ");
  document.body.appendChild(_tooltipEl);
  return _tooltipEl;
}
function showTooltip(text) {
  const el = ensureTooltip();
  el.textContent = text;
  el.style.display = "block";
  if (!_tooltipMoveHandler) {
    _tooltipMoveHandler = (e) => {
      el.style.left = `${e.clientX + 14}px`;
      el.style.top = `${e.clientY + 18}px`;
    };
    document.addEventListener("mousemove", _tooltipMoveHandler);
  }
}
function hideTooltip() {
  if (_tooltipEl) _tooltipEl.style.display = "none";
  if (_tooltipMoveHandler) {
    document.removeEventListener("mousemove", _tooltipMoveHandler);
    _tooltipMoveHandler = null;
  }
}

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

    // Clamp manual resize so the canvas pills (top row) and the action
    // buttons (bottom row) never overflow the node frame. Mutate BOTH the
    // parameter AND this.size defensively (some LiteGraph forks treat the
    // param as the new size, others have already written to this.size).
    const origOnResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (size[0] < MIN_W) size[0] = MIN_W;
      if (size[1] < MIN_H) size[1] = MIN_H;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      if (origOnResize) return origOnResize.apply(this, arguments);
    };

    // Paint Queue Text / List Prompts pills on the canvas at the slot-row Y.
    // Same approach Prompt Pack uses for Paragraph / Line. Hover state shows
    // BRAND orange (preview what the active state will look like). Tooltip
    // text covers what each mode does so we can drop the inline hint.
    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;

      // Self-heal min size on every paint (Preview Image Pattern #11).
      // Catches resize paths that bypass onResize per Vue Compat #13.
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;

      const state = readState(this);
      const gm = app.canvas?.graph_mouse;
      let hoverQueue = false, hoverList = false;
      if (gm) {
        const mx = gm[0] - this.pos[0];
        const my = gm[1] - this.pos[1];
        const local = [mx, my];
        hoverQueue = insideRect(local, pillQueueRect());
        hoverList = insideRect(local, pillListRect());
      }
      ctx.save();
      paintPill(ctx, pillQueueRect(), "Queue Text",
                state.mode === MODE_QUEUE, hoverQueue);
      paintPill(ctx, pillListRect(), "List Prompts",
                state.mode === MODE_LIST, hoverList);
      ctx.restore();

      // Tooltip on hover transitions only (not every frame).
      const newHover = hoverQueue ? "queue" : hoverList ? "list" : null;
      if (this._pixPmHoverPill !== newHover) {
        this._pixPmHoverPill = newHover;
        if (newHover === "queue") {
          showTooltip("Queue Text: click Run and the workflow runs once per enabled prompt (N images). Wire the `text` output to a CLIP Text Encode.");
        } else if (newHover === "list") {
          showTooltip("List Prompts: click Run and the workflow runs ONCE. Wire the `prompts` output into Prompt From List Pixaroma nodes downstream to grab specific rows.");
        } else {
          hideTooltip();
        }
      }
    };

    // Pill click → toggle mode. Hit-test first so the click never accidentally
    // lands on anything else. Rects don't overlap each other; they sit on the
    // slot row where nothing else lives (output dots are on the right).
    const origDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (e, pos) {
      if (insideRect(pos, pillQueueRect())) {
        const state = readState(this);
        if (state.mode !== MODE_QUEUE) {
          setMode(this, MODE_QUEUE);
          if (this._pixPmRerender) this._pixPmRerender();
        }
        this.setDirtyCanvas(true, true);
        return true;
      }
      if (insideRect(pos, pillListRect())) {
        const state = readState(this);
        if (state.mode !== MODE_LIST) {
          setMode(this, MODE_LIST);
          if (this._pixPmRerender) this._pixPmRerender();
        }
        this.setDirtyCanvas(true, true);
        return true;
      }
      return origDown ? origDown.call(this, e, pos) : false;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixPmRoot = null;
      this._pixPmRerender = null;
      this._pixPmGrow = null;
      this._pixPmRefreshClear = null;
      // Hide tooltip if this node was the one being hovered; otherwise it
      // can linger after a hovered node is deleted.
      if (this._pixPmHoverPill) {
        this._pixPmHoverPill = null;
        hideTooltip();
      }
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
  return isClass && isMultiNodeActive(node) && isMultiNodeConnected(node);
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
