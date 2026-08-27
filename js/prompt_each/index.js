import { app } from "/scripts/app.js";
import {
  readState, writeState, restoreFromProperties, DEFAULT_CAP,
} from "./core.mjs";
import { injectCSS, buildRoot, applyState, updateCount, placeBand,
  contentHeight, WIDGET_MIN_H } from "./ui.mjs";
import { textToRows, rowsToText, renderRows, rowToPrompt } from "./rows.mjs";
import { buildFromPieces } from "./expand.mjs";
import { openSettingsPanel, closeSettingsPanelFor, isPanelOpenFor } from "./settings.mjs";
import { PROMPT_EACH_HELP } from "./help.mjs";
import {
  applyAdaptiveCanvasOnly, installResizeFloor, isVueNodes,
  installCanvasZoomPassthrough, installNativeTextMenu, installNodeAccent,
  registerNodeAccent, registerNodeSettings, registerNodeHelp, notifyGraphChanged,
  onRendererChange,
} from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { pixConfirm } from "../shared/confirm_dialog.mjs";

const CLASS = "PixaromaPromptEach";

// Default = minimum (node UI convention #5): a fresh drop is the smallest
// comfortable size and the user grows it. When default > min, dragging the
// corner inward visibly grows the node before clamping, which reads as a bug.
//
// Width is sized off the action row: 3 buttons at min-width 86 border-box + the
// 28px gear + 3 gaps of 4 + 16 of root padding is ~314, plus margin.
//
// Height is MEASURED, not picked: one empty row is 112 of body (row 79 + the -6
// it is pulled up by + gap 6 + action bar 23 + 8 root padding, rounded up to the
// 4px grid) and the chrome is 86 - which is the
// three 20px slot rows plus LiteGraph's own padding, NOT the 90 you get by
// adding NODE_TITLE_HEIGHT, because the title sits above node.pos and is not
// inside size[1] at all. A fixed 250 left 36px of dead space under the buttons
// on a one-row node, which is exactly what a fresh drop is.
//
// What remains below the buttons is 18px: 8 of the root's own bottom padding
// (the same as every other node in the pack) and 10 of LiteGraph's margin under
// a DOM widget, which is not ours to remove - Prompt Stack measures 48 in the
// same place. Re-measure if a row's padding or the slot count changes.
const DEFAULT_W = 340;
const DEFAULT_H = 198;
const MIN_W = 340;
const MIN_H = 198;
// The tallest this node will GROW ITSELF to. Auto-growth is a convenience,
// not an instruction to become a wall: MEASURED, 50 rows wanted a 4330px node
// and 200 wanted 16978, which is taller than any screen and unusable on a
// canvas. Past this the rows list scrolls instead (it already can, so nothing
// is hidden), and the user can still drag the node as tall as they like -
// this only bounds what WE do on our own.
//
// 704 = one row (198) plus six more at 84 each, so SEVEN rows show without a
// scrollbar. 620 was one row too tight and put a scrollbar on a six-prompt
// list, which is an ordinary size to work at.
const MAX_AUTO_H = 704;

registerNodeHelp(CLASS, PROMPT_EACH_HELP);

// The settings live on the NODE INSTANCE, not on the node type: two Prompt Each
// nodes in one workflow can legitimately split differently. So this registers a
// custom panel rather than `rows` (which write ComfyUI settings, i.e. per-type
// defaults). ownMenuItem stops the central right-click entry doubling our own.
registerNodeSettings(CLASS, {
  title: "Prompt Each",
  ownMenuItem: true,
  open: (node) => openPanel(node),
});
registerNodeAccent(CLASS, { title: "Prompt Each" });

function openPanel(node) {
  if (isPanelOpenFor(node)) {
    closeSettingsPanelFor(node);
    return;
  }
  openSettingsPanel(node, () => refresh(node));
}

// Is the optional `text` input wired? Purely ADDITIVE now: whatever arrives is
// split into extra prompts and run AFTER the rows. It used to be able to replace
// them, which meant the rows on screen were not what ran - invisible, and the
// first thing anyone asked about the input. To run ONLY the wired prompts, press
// Reset: the one empty row left behind is skipped as empty.
function isWired(node) {
  const slot = node?.inputs?.find((i) => i && i.name === "text");
  return !!(slot && slot.link != null);
}

// Grow the node so the rendered body fits. Mirrors Prompt Stack: the rows list
// is content height, so the NODE is what has to give.
//
// NEVER call this on the load path - node.size is serialised, and writing it
// while a workflow opens flags an untouched file "modified" (Vue Compat #18).
// Every caller is a user action, and isGraphLoading is the belt.
function setNodeHeight(node, h) {
  node.size[1] = h;
  // Remember what WE set, so ownsHeight can tell our height from the user's.
  node._pixEachOwnH = h;
  // A bare size[1] write is silently reverted by Nodes 2.0's reactive layout
  // when the node was last sized in the OTHER renderer; setSize commits through
  // the official path. Keep both.
  node.setSize?.([node.size[0], h]);
}

// Everything of node.size that is NOT the widget body: the slot rows above it
// and LiteGraph's own margin below it.
//
// MEASURED off the live node rather than computed from NODE_TITLE_HEIGHT and
// NODE_SLOT_HEIGHT. The computed version came to 90 where the real figure is 86
// (the title sits ABOVE node.pos, so it is not inside size[1] at all), and that
// 4px error is the difference between the node hugging its content and carrying
// a visible strip of dead space under the buttons. The constant stays as the
// fallback for the moment before the widget has a rendered height.
function chromeAllowance(node) {
  const root = node?._pixEachParts?.root;
  const rootH = root ? root.offsetHeight : 0;
  if (rootH > 0 && node.size[1] > rootH) return node.size[1] - rootH;
  const LG = window.LiteGraph || {};
  const slotH = LG.NODE_SLOT_HEIGHT || 20;
  const slots = Math.max(node.outputs?.length || 0, node.inputs?.length || 0);
  return slots * slotH + 26;
}

// Does the node still have the height WE last gave it? If so we may shrink it
// back when the content shrinks; if the user has dragged it since, we must not.
// Runtime-only (never serialised): after a reload it is unset, so a saved size
// is respected until onConfigure decides it looks like a fitted one.
function ownsHeight(node) {
  return node._pixEachOwnH != null && Math.abs(node.size[1] - node._pixEachOwnH) < 1.5;
}

// Grow only, so a node the user made taller keeps the size they chose.
function growNodeToContent(node) {
  const parts = node?._pixEachParts;
  if (!parts || isGraphLoading()) return;
  const desired = Math.min(MAX_AUTO_H, contentHeight(parts.root) + chromeAllowance(node));
  if (desired > node.size[1]) setNodeHeight(node, desired);
}

// Shrink AND grow, for actions where the user is saying "make this fit" - a
// delete or a reset. Never below the default.
function fitNodeToContent(node) {
  const parts = node?._pixEachParts;
  if (!parts || isGraphLoading()) return;
  setNodeHeight(node, Math.min(MAX_AUTO_H, Math.max(DEFAULT_H,
    contentHeight(parts.root) + chromeAllowance(node))));
}

// SYNCHRONOUS on purpose. renderRows finishes sizing every row box before it
// returns, so the content height is already final here - and hanging the node's
// size off a requestAnimationFrame made it depend on a frame landing, which
// left the action row outside the node whenever one was dropped.
function reflow(node, fit) {
  // Fit whenever the height is ours: otherwise a row that SHRINKS (deleting a
  // line from its box) leaves the node tall and a gap under the buttons, which
  // is exactly what "typing makes extra space at the bottom" was.
  if (fit || ownsHeight(node)) fitNodeToContent(node);
  else growNodeToContent(node);
  node.setDirtyCanvas(true, true);

  // ...and one deferred correction, because a structural change that lands in
  // the same tick as another layout change can measure a row box a line taller
  // than it settles at (seen: 60px and 94px where the box ends up 44px). That
  // only ever makes the node too TALL, never clipped, but it is visible.
  //
  // It shrinks ONLY back toward the real content, only while the rows view is
  // still showing, and only if the height is still exactly what we just wrote -
  // so it can never fight a resize the user did in between, and never runs on
  // the load path.
  const wrote = node.size[1];
  setTimeout(() => {
    const parts = node?._pixEachParts;
    if (!parts || isGraphLoading()) return;
    if (node.size[1] !== wrote) return;                 // the user moved it: leave it alone
    // ...and it must still be OUR height. Without this the correction shrank a
    // node the user had deliberately dragged taller, the moment they typed.
    if (!ownsHeight(node)) return;
    const settled = contentHeight(parts.root) + chromeAllowance(node);
    if (settled < wrote) setNodeHeight(node, Math.min(MAX_AUTO_H, Math.max(DEFAULT_H, settled)));
  }, 0);
}

// Re-render the face from current state. Cheap, and safe to call on the load
// path: it writes only DOM, never node.size / properties / slots (Vue Compat
// #18), so opening an untouched workflow cannot flag it modified.
function refresh(node, rebuildRows = true) {
  const parts = node?._pixEachParts;
  if (!parts) return;
  const st = readState(node);
  const ws = isWired(node);
  applyState(parts, st, ws);
  // Rebuilding the row list steals focus mid-word, so a keystroke passes
  // rebuildRows=false: the state is already correct, only the count needs to
  // move. Structural changes (add, delete, toggle, reorder) do rebuild.
  if (rebuildRows) {
    renderRows(parts, st, { wireRow: (el, i, refs) => wireRow(node, el, i, refs) });
  }
  // Clear all / Reset grey out when there is nothing to do, same as Prompt
  // Stack's. Reset stays live while anything differs from the default, which
  // includes a switched-off row even if no text is typed.
  if (parts.clearAllBtn && parts.resetBtn) {
    const rows = st.rows;
    const anyText = rows.some((r) => r.text && r.text.trim());
    const anyOff = rows.some((r) => r.enabled === false);
    parts.clearAllBtn.disabled = !anyText;
    parts.resetBtn.disabled = !(anyText || anyOff || rows.length !== 1);
  }

  const result = buildFromPieces(st.rows.filter((r) => r.enabled !== false).map((r) => rowToPrompt(r.text, st.trim)), {
    expand: st.expand,
    trim: st.trim,
    skipEmpty: st.skipEmpty,
    cap: st.cap,
  });
  updateCount(parts, result, st.split, ws);
}

// Write the row list back. Rows ARE the state - never joined into a string and
// re-split, which is what duplicated content on every keystroke.
function commitRows(node, rows, rebuild = true, fit = false) {
  const st = readState(node);
  st.rows = (rows && rows.length ? rows : [{ text: "", enabled: true }])
    .map((r) => ({ text: typeof r.text === "string" ? r.text : "", enabled: r.enabled !== false }));
  writeState(node, st);
  refresh(node, rebuild);
  // A rebuild means the list changed shape, so the node has to be resized
  // to match. A keystroke does not rebuild and handles its own growth.
  if (rebuild) reflow(node, fit);
  notifyGraphChanged();
}

function wireRow(node, rowEl, i, refs) {
  const { ta, tog, del, handle } = refs;
  const parts = node._pixEachParts;

  ta.addEventListener("input", () => {
    const st = readState(node);
    const rows = st.rows.map((r) => ({ ...r }));
    if (!rows[i]) return;
    rows[i].text = ta.value;
    // rebuild=false: keep the caret where the user is typing.
    commitRows(node, rows, false);
    ta.style.height = "auto";
    ta.style.height = Math.min(Math.max(ta.scrollHeight, 30), 140) + "px";
    // the box changed height, so the node follows it - in BOTH directions when
    // the height is ours (see reflow)
    reflow(node, false);
  });

  tog.addEventListener("click", () => {
    const st = readState(node);
    const rows = st.rows.map((r) => ({ ...r }));
    if (!rows[i]) return;
    rows[i].enabled = rows[i].enabled === false;
    commitRows(node, rows);
  });

  del.addEventListener("click", () => {
    const st = readState(node);
    const rows = st.rows.map((r) => ({ ...r }));
    if (!rows[i]) return;
    rows.splice(i, 1);
    if (!rows.length) rows.push({ text: "", enabled: true });
    commitRows(node, rows, true, true);   // a delete should compact the node
  });

  // Reorder. `draggable` is on the HANDLE (see rows.mjs) but the drop targets
  // are the rows, so these listeners live here and the handle's dragstart
  // bubbles up to them.
  handle.addEventListener("dragstart", (e) => {
    node._pixEachDragFrom = i;
    rowEl.classList.add("is-dragging");
    try {
      e.dataTransfer.effectAllowed = "move";
      // Firefox will not start a drag without some data set.
      e.dataTransfer.setData("text/plain", String(i));
    } catch {}
  });
  handle.addEventListener("dragend", () => {
    node._pixEachDragFrom = null;
    for (const r of parts.rows.querySelectorAll(".pix-each-row")) {
      r.classList.remove("is-dragging", "is-drop-above", "is-drop-below");
    }
  });
  rowEl.addEventListener("dragover", (e) => {
    if (node._pixEachDragFrom == null) return;
    e.preventDefault();
    const r = rowEl.getBoundingClientRect();
    const above = e.clientY < r.top + r.height / 2;
    rowEl.classList.toggle("is-drop-above", above);
    rowEl.classList.toggle("is-drop-below", !above);
  });
  rowEl.addEventListener("dragleave", () => {
    rowEl.classList.remove("is-drop-above", "is-drop-below");
  });
  rowEl.addEventListener("drop", (e) => {
    const from = node._pixEachDragFrom;
    if (from == null) return;
    e.preventDefault();
    const r = rowEl.getBoundingClientRect();
    const above = e.clientY < r.top + r.height / 2;
    let to = above ? i : i + 1;
    const st = readState(node);
    const rows = st.rows.map((r) => ({ ...r }));
    if (from < to) to -= 1;
    if (from === to) return;
    const [moved] = rows.splice(from, 1);
    rows.splice(to, 0, moved);
    node._pixEachDragFrom = null;
    commitRows(node, rows);
  });
}

function flash(btn, label) {
  const original = btn.textContent;
  btn.textContent = label;
  btn.classList.add("is-flashing");
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove("is-flashing");
  }, 700);
}

function toast(text) {
  try {
    app.extensionManager?.toast?.add({ severity: "warn", detail: text, life: 2600 });
    return;
  } catch {}
  // Older Easy Install builds have no extensionManager.toast - Prompt Multi
  // carries the same fallback for the same reason.
  const d = document.createElement("div");
  d.textContent = text;
  d.style.cssText =
    "position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:2000;" +
    "background:#1d1d1d;color:#eee;border:1px solid #f66744;border-radius:6px;" +
    "padding:8px 14px;font:12px sans-serif;pointer-events:none;";
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2600);
}

function wireEvents(node, parts) {
  const { copyBtn, pasteBtn, addBtn, clearAllBtn, resetBtn, gearBtn } = parts;


  // The Rows trio is word-for-word Prompt Stack's, behaviour included, because
  // people already have the habit: Add row appends, Clear all empties the text
  // but KEEPS the rows and their switches, Reset goes back to one empty row.
  // Both destructive ones confirm first, like Prompt Stack's do.
  const rowsNow = () => readState(node).rows.map((r) => ({ ...r }));

  // Every handler that opens a confirm dialog needs this. pixConfirm has no
  // singleton guard of its own - each call appends its own full-screen backdrop
  // - so a double-click (an ordinary action, no modifiers) stacks two identical
  // dialogs exactly on top of each other. Answering one reveals the other, which
  // reads as the node asking the same question twice for no reason. The guard is
  // a closure flag rather than btn.disabled so it cannot be clobbered by
  // refresh(), which owns the disabled state of these same buttons.
  let busy = false;
  const guarded = (fn) => async (...a) => {
    if (busy) return;
    busy = true;
    try { await fn(...a); } finally { busy = false; }
  };

  addBtn.addEventListener("click", () => {
    const rows = rowsNow();
    rows.push({ text: "", enabled: true });
    commitRows(node, rows);
    const boxes = parts.rows.querySelectorAll(".pix-each-rowta");
    boxes[boxes.length - 1]?.focus();
  });

  clearAllBtn.addEventListener("click", guarded(async () => {
    const rows = rowsNow();
    if (!rows.some((r) => r.text && r.text.trim())) return;
    const ok = await pixConfirm({
      title: "Clear all text?",
      message: `This will empty the text in all ${rows.length} row${rows.length === 1 ? "" : "s"}. The ON/OFF switches are kept.`,
      okText: "Clear",
      cancelText: "Cancel",
    });
    if (!ok) return;
    // RE-READ after the confirm. `rows` above is only used to decide whether to
    // ASK and to word the question; writing it back would resurrect rows that
    // a Ctrl+Z removed while the dialog was open (ComfyUI's undo listener is on
    // window from page startup, and pixConfirm only intercepts Escape and
    // Enter). Same defect the Paste handler was fixed for; Reset is immune
    // because it always writes one fixed row rather than a snapshot.
    commitRows(node, rowsNow().map((r) => ({ ...r, text: "" })), true, true);
  }));

  resetBtn.addEventListener("click", guarded(async () => {
    const ok = await pixConfirm({
      title: "Reset to default?",
      message: "This will replace all rows with one empty row, switched on. Your current prompts will be lost.",
      okText: "Reset",
      cancelText: "Cancel",
    });
    if (!ok) return;
    commitRows(node, [{ text: "", enabled: true }], true, true);
  }));

  copyBtn.addEventListener("click", async () => {
    const st = readState(node);
    const asText = rowsToText(st.rows, st.split);
    if (!asText.trim()) {
      toast("Nothing to copy");
      return;
    }
    try {
      // the rows as a person would write them: one prompt per line, and a
      // switched-off one keeps its "#" so pasting it back restores the switches
      await navigator.clipboard.writeText(asText);
      flash(copyBtn, "Copied");
    } catch {
      toast("Could not copy to the clipboard");
    }
  });

  // This is the bulk path, and the reason the node does not need a second view:
  // paste a hundred lines and you get a hundred rows.
  pasteBtn.addEventListener("click", guarded(async () => {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast("Could not paste from the clipboard");
      return;
    }
    // Chrome returns "" for an empty clipboard AND an image-only one, so this
    // covers both - and NOT wiping the rows is the important half.
    if (!text) {
      toast("Nothing to paste");
      return;
    }
    const st = readState(node);
    if (st.rows.some((r) => r.text && r.text.trim())) {
      const ok = await pixConfirm({
        title: "Replace every prompt?",
        message: "The rows on this node will be replaced by what is on the clipboard, one prompt per line.",
        okText: "Replace",
        cancelText: "Cancel",
      });
      if (!ok) return;
    }
    // RE-READ after the confirm, never reuse the snapshot taken before it
    // ([[reference_requery_dont_guard_after_await]]). writeState writes the
    // WHOLE blob, so a stale snapshot would silently roll back split / expand /
    // trim / skipEmpty / cap / wiredAt as well as the rows - and a Ctrl+Z while
    // the dialog is open really can change them underneath us, since ComfyUI's
    // undo listener is on window from page startup and pixConfirm only
    // intercepts Escape and Enter.
    const cur = readState(node);
    cur.rows = textToRows(text, cur.split);
    writeState(node, cur);
    refresh(node);
    reflow(node, true);
    notifyGraphChanged();
    flash(pasteBtn, "Pasted");
  }));

  gearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openPanel(node);
  });
}

app.registerExtension({
  name: "Pixaroma.PromptEach",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      const node = this;

      // SYNCHRONOUS (node UI convention #9). configure() runs after
      // nodeCreated and restores the saved size, which is exactly what we want
      // for a reload or a duplicate; deferring this into the microtask below
      // would run it AFTER configure and clobber the restored size.
      if (node.size[0] < MIN_W) node.size[0] = DEFAULT_W;
      if (node.size[1] < MIN_H) node.size[1] = DEFAULT_H;
      // A fresh drop is ours, so it keeps hugging its content from the start.
      node._pixEachOwnH = node.size[1];

      // The DOM build stays deferred: nodeCreated fires BEFORE configure (Vue
      // Compat #8), so rendering now would show the default and flash to the
      // saved state a moment later.
      queueMicrotask(() => {
        injectCSS();
        restoreFromProperties(node);

        const parts = buildRoot();
        node._pixEachParts = parts;
        const root = parts.root;

        installCanvasZoomPassthrough(root); // convention #17
        installNativeTextMenu(root);        // right-click Paste in the box
        installNodeAccent(node, root);      // the face follows this node's accent

        const widget = node.addDOMWidget("prompteach", "pixaroma_prompteach", root, {
          serialize: false,
          // A CONSTANT, never the live content measure. getMinHeight drives
          // LiteGraph's node sizing, so a content-derived value rewrites
          // node.size on the LOAD path for any node saved smaller than its
          // rows - measured 470 -> 578 - which flags an untouched workflow
          // modified (Vue Compat #18). Growth happens on user actions via
          // growNodeToContent; a node deliberately dragged smaller than its
          // rows simply clips them, which is the correct failure.
          getMinHeight: () => WIDGET_MIN_H,
        });
        applyAdaptiveCanvasOnly(widget);
        node._pixEachFloorOff = installResizeFloor(root, contentHeight);

        // The band floats up into the slot dead space in BOTH renderers (the
        // July note saying Nodes 2.0 clips content above the widget top was
        // stale - the only clipping ancestors are the canvas container and the
        // app body, neither of which is inside the node). The OFFSET differs
        // per renderer though, so the setting can change what this needs to
        // write while the node is alive: re-place on every flip rather than
        // leaving the other renderer's number behind (Nodes 2.0 section, "the
        // renderer can change under a live node"). placeBand writes only DOM
        // style, so re-running it can never dirty a workflow.
        placeBand(parts, true);
        node._pixEachRendererOff = onRendererChange(() => {
          if (!node._pixEachParts) return;
          placeBand(node._pixEachParts, true);
        });
        wireEvents(node, parts);
        refresh(node);
        node.setDirtyCanvas(true, true);
      });
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure ? origConfigure.apply(this, arguments) : undefined;
      restoreFromProperties(this);
      refresh(this);
      return r;
    };

    // Re-render when the text input is plugged or unplugged. This writes DOM
    // only - no node.properties, no size, no slots - so it needs no
    // isGraphLoading gate (Vue Compat #19 exempts runtime-only handlers).
    const origConnChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = origConnChange ? origConnChange.apply(this, arguments) : undefined;
      refresh(this);
      return r;
    };

    // LEGACY ONLY. In Nodes 2.0 the rendered size lives in the Vue layout store,
    // not node.size, so clamping here desyncs the two and the node jumps to the
    // clamped size on a workflow switch.
    const origOnResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      // A real drag of the resize handle means the size is theirs from now on.
      if (app.canvas?.resizing_node === this) this._pixEachOwnH = null;
      if (!isVueNodes() && !isGraphLoading()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (size[1] < MIN_H) size[1] = MIN_H;
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      if (origOnResize) return origOnResize.apply(this, arguments);
    };

    // Min-width self-heal, because onResize does not fire for every resize path
    // (Vue Compat #13). The isGraphLoading gate is NOT optional: node.size is
    // serialised and a draw hook runs on the very first frame of a load, so
    // ungated this is the one place that can rewrite the size of an untouched
    // workflow and flag it modified (convention #7).
    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;
      if (isVueNodes() || isGraphLoading()) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeSettingsPanelFor(this);
      this._pixEachFloorOff?.();
      this._pixEachFloorOff = null;
      this._pixEachRendererOff?.();
      this._pixEachRendererOff = null;
      this._pixEachParts = null;
      if (origRemoved) return origRemoved.apply(this, arguments);
    };
  },
});

// ---------------------------------------------------------------------------
// graphToPrompt: inject the state into the hidden PromptEachState input at
// submit time (Vue Compat #9).
//
// Subgraph-safe: ComfyUI flattens subgraph nodes into the prompt with composite
// ids ("5:12") that app.graph.getNodeById cannot resolve, so a plain lookup
// silently misses any node inside a subgraph and the state never arrives.
// ---------------------------------------------------------------------------
function buildNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === CLASS || n.type === CLASS) index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findNode(index, promptId) {
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
        if (!entry || entry.class_type !== CLASS) continue;
        if (!index) index = buildNodeIndex();
        const node = findNode(index, key);
        if (!node) continue;
        const st = readState(node);
        entry.inputs = entry.inputs || {};
        entry.inputs.PromptEachState = JSON.stringify({
          version: 2,
          // ALREADY SEPARATED. Never a joined blob: a row may contain
          // newlines and Python would split it back into several prompts.
          prompts: st.rows.filter((r) => r.enabled !== false).map((r) => rowToPrompt(r.text, st.trim)),
          split: st.split,
          expand: st.expand,
          trim: st.trim,
          skipEmpty: st.skipEmpty,
          cap: st.cap ?? DEFAULT_CAP,
          wiredAt: st.wiredAt,

        });
      }
    }
  } catch (err) {
    console.error("Pixaroma.PromptEach: graphToPrompt hook failed", err);
  }
  return result;
};
