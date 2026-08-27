import { app } from "/scripts/app.js";
import {
  readState, writeState, restoreFromProperties, DEFAULT_CAP, VIEW_ROWS,
} from "./core.mjs";
import { injectCSS, buildRoot, applyState, updateCount, placeBand, setView,
  contentHeight, WIDGET_MIN_H } from "./ui.mjs";
import { textToRows, rowsToText, renderRows } from "./rows.mjs";
import { buildPrompts } from "./expand.mjs";
import { openSettingsPanel, closeSettingsPanelFor, isPanelOpenFor } from "./settings.mjs";
import { PROMPT_EACH_HELP } from "./help.mjs";
import {
  applyAdaptiveCanvasOnly, installResizeFloor, isVueNodes,
  installCanvasZoomPassthrough, installNativeTextMenu, installNodeAccent,
  registerNodeAccent, registerNodeSettings, registerNodeHelp, notifyGraphChanged,
} from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { attachLineNumbers } from "../shared/line_numbers.mjs";

const CLASS = "PixaromaPromptEach";

// Default = minimum (node UI convention #5): a fresh drop is the smallest
// comfortable size and the user grows it. When default > min, dragging the
// corner inward visibly grows the node before clamping, which reads as a bug.
// Width is sized off the action row: 3 buttons at min-width 86 border-box + the
// 28px gear + 3 gaps of 4 + 16 of root padding is ~318, plus margin.
const DEFAULT_W = 340;
const DEFAULT_H = 250;
const MIN_W = 340;
const MIN_H = 250;

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

// Is the optional `text` input wired? Returns the mode that applies ("replace"
// or "add"), or null when nothing is connected.
function wiredState(node) {
  const slot = node?.inputs?.find((i) => i && i.name === "text");
  if (!slot || slot.link == null) return null;
  return readState(node).wiredMode;
}

// Grow the node so the rendered body fits. Mirrors Prompt Stack: the rows list
// is content-height rather than a scroll area, so the NODE is what has to give.
//
// NEVER call this on the load path - node.size is serialised, and writing it
// while a workflow opens flags an untouched file "modified" (Vue Compat #18).
// Every caller is a user action, and isGraphLoading is the belt.
function setNodeHeight(node, h) {
  node.size[1] = h;
  // A bare size[1] write is silently reverted by Nodes 2.0's reactive layout
  // when the node was last sized in the OTHER renderer; setSize commits through
  // the official path. Keep both.
  node.setSize?.([node.size[0], h]);
}

function chromeAllowance(node) {
  const LG = window.LiteGraph || {};
  const titleH = LG.NODE_TITLE_HEIGHT || 30;
  const slotH = LG.NODE_SLOT_HEIGHT || 20;
  const slots = Math.max(node.outputs?.length || 0, node.inputs?.length || 0);
  return titleH + slots * slotH;
}

// Grow only, so a node the user made taller keeps the size they chose.
function growNodeToContent(node) {
  const parts = node?._pixEachParts;
  if (!parts || isGraphLoading()) return;
  const desired = contentHeight(parts.root, readState(node).view) + chromeAllowance(node);
  if (desired > node.size[1]) setNodeHeight(node, desired);
}

// Shrink AND grow, for actions where the user is saying "make this fit" - a
// delete, or switching back to the compact Text view. Never below the default.
function fitNodeToContent(node) {
  const parts = node?._pixEachParts;
  if (!parts || isGraphLoading()) return;
  setNodeHeight(node, Math.max(DEFAULT_H,
    contentHeight(parts.root, readState(node).view) + chromeAllowance(node)));
}

// SYNCHRONOUS on purpose. renderRows finishes sizing every row box before it
// returns, so the content height is already final here - and hanging the node's
// size off a requestAnimationFrame made it depend on a frame landing, which
// left the action row outside the node whenever one was dropped.
function reflow(node, fit) {
  if (fit) fitNodeToContent(node);
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
    if (readState(node).view !== VIEW_ROWS) return;
    const settled = contentHeight(parts.root, VIEW_ROWS) + chromeAllowance(node);
    if (settled < wrote) setNodeHeight(node, Math.max(DEFAULT_H, settled));
  }, 0);
}

// Re-render the face from current state. Cheap, and safe to call on the load
// path: it writes only DOM, never node.size / properties / slots (Vue Compat
// #18), so opening an untouched workflow cannot flag it modified.
function refresh(node, rebuildRows = true) {
  const parts = node?._pixEachParts;
  if (!parts) return;
  const st = readState(node);
  const ws = wiredState(node);
  applyState(parts, st, ws);
  setView(parts, st.view);
  // Rebuilding the row list steals focus mid-word, so a keystroke passes
  // rebuildRows=false: the state is already correct, only the count needs to
  // move. Structural changes (add, delete, toggle, reorder, view switch) do
  // rebuild.
  if (st.view === VIEW_ROWS && rebuildRows) {
    renderRows(parts, st, { wireRow: (el, i, refs) => wireRow(node, el, i, refs) });
  }
  const result = buildPrompts(st.text, {
    split: st.split,
    expand: st.expand,
    trim: st.trim,
    skipEmpty: st.skipEmpty,
    cap: st.cap,
  });
  updateCount(parts, result, st.split, ws);
}

// Write a row list back into the single source of truth: state.text.
function commitRows(node, rows, rebuild = true, fit = false) {
  const st = readState(node);
  st.text = rowsToText(rows, st.split);
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
    const rows = textToRows(st.text, st.split);
    if (!rows[i]) return;
    rows[i].text = ta.value;
    // rebuild=false: keep the caret where the user is typing.
    commitRows(node, rows, false);
    ta.style.height = "auto";
    ta.style.height = Math.min(Math.max(ta.scrollHeight, 30), 140) + "px";
    // the box just got taller, so the node has to keep up; this no-ops
    // unless the content genuinely outgrew the node
    growNodeToContent(node);
  });

  tog.addEventListener("click", () => {
    const st = readState(node);
    const rows = textToRows(st.text, st.split);
    if (!rows[i]) return;
    rows[i].enabled = rows[i].enabled === false;
    commitRows(node, rows);
  });

  del.addEventListener("click", () => {
    const st = readState(node);
    const rows = textToRows(st.text, st.split);
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
    const rows = textToRows(st.text, st.split);
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
  const { ta, copyBtn, replaceBtn, clearBtn, addBtn, gearBtn, textPill, rowsPill } = parts;

  const setViewTo = (view) => {
    const st = readState(node);
    if (st.view === view) return;
    st.view = view;
    writeState(node, st);
    refresh(node);
    // GROW only. Fitting here would shrink a node the user had deliberately
    // made taller, and switching back to Text needs no resize at all since
    // that box simply fills whatever room there is.
    reflow(node, false);
    notifyGraphChanged();
  };
  textPill.addEventListener("click", () => setViewTo("text"));
  rowsPill.addEventListener("click", () => setViewTo(VIEW_ROWS));

  addBtn.addEventListener("click", () => {
    if (ta.readOnly) {
      toast("Text is wired in. Unplug it, or switch to Add in the settings.");
      return;
    }
    const st = readState(node);
    const rows = textToRows(st.text, st.split);
    rows.push({ text: "", enabled: true });
    commitRows(node, rows);
    // put the caret straight into the box that was just added
    const boxes = parts.rows.querySelectorAll(".pix-each-rowta");
    boxes[boxes.length - 1]?.focus();
  });

  ta.addEventListener("input", () => {
    if (ta.readOnly) return;
    const st = readState(node);
    st.text = ta.value;
    writeState(node, st);
    refresh(node);
  });
  // A DOM control commits on `click`/`input`, which is strictly AFTER the
  // mouseup ComfyUI snapshots on, so the change would never be recorded and the
  // user would silently lose it (convention #31). The pack-wide change net
  // covers clicks inside our own UI; typing needs saying explicitly.
  ta.addEventListener("change", () => notifyGraphChanged());

  copyBtn.addEventListener("click", async () => {
    const st = readState(node);
    if (!st.text.trim()) {
      toast("Nothing to copy");
      return;
    }
    try {
      await navigator.clipboard.writeText(st.text);
      flash(copyBtn, "Copied");
    } catch {
      toast("Could not copy to the clipboard");
    }
  });

  replaceBtn.addEventListener("click", async () => {
    if (ta.readOnly) {
      toast("Text is wired in. Unplug it, or switch to Add in the settings.");
      return;
    }
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast("Could not paste from the clipboard");
      return;
    }
    // Chrome returns "" for both an empty clipboard and an image-only one, so
    // this single check covers both - and NOT wiping the box is the important
    // half: silently erasing somebody's list on a failed paste is unforgivable.
    if (!text) {
      toast("Nothing to paste");
      return;
    }
    const st = readState(node);
    st.text = text;
    writeState(node, st);
    refresh(node);
    notifyGraphChanged();
    flash(replaceBtn, "Pasted");
  });

  clearBtn.addEventListener("click", () => {
    if (ta.readOnly) {
      toast("Text is wired in. Unplug it, or switch to Add in the settings.");
      return;
    }
    const st = readState(node);
    st.text = "";
    writeState(node, st);
    refresh(node);
    notifyGraphChanged();
  });

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
        node._pixEachFloorOff = installResizeFloor(root,
          (r) => contentHeight(r, readState(node).view));

        // Must run AFTER the box is in the document - the gutter measures it.
        node._pixEachLnOff = attachLineNumbers(parts.ta, { minDigits: 2 });

        // MEASURED in both renderers: the same offset lands the pill on the
        // `total` row, clear of every slot label, so there is no branch here.
        // The July note saying Nodes 2.0 clips content above the widget top
        // was stale - the only clipping ancestors are the canvas container
        // and the app body, neither of which is inside the node.
        placeBand(parts, true);
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
      // attachLineNumbers installs a ResizeObserver, and a Document holds its
      // observers strongly - without this the textarea, wrap, gutter and mirror
      // stay pinned for the rest of the session.
      this._pixEachLnOff?.();
      this._pixEachLnOff = null;
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
          version: 1,
          text: st.text,
          split: st.split,
          expand: st.expand,
          trim: st.trim,
          skipEmpty: st.skipEmpty,
          cap: st.cap ?? DEFAULT_CAP,
          wiredMode: st.wiredMode,
        });
      }
    }
  } catch (err) {
    console.error("Pixaroma.PromptEach: graphToPrompt hook failed", err);
  }
  return result;
};
