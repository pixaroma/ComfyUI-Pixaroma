// Info Pixaroma - a title-less button that opens a note in a reading window.
//
//   core.mjs      state (the note_json widget), icons, sizes, canvas icon images
//   face.mjs      the button: classic canvas paint + body hook, Nodes 2.0 DOM face
//   reader.mjs    the reading window
//   editor.mjs    Note Pixaroma's editor + the title / icon / colour strip
//   starters.mjs  starter buttons + the "start from" popup
//   help.mjs      help text
//
// Title-less recipe: run-timer.md #4 and label.md (title_mode on the TYPE,
// flags.no_title for Align, drawBadges off, classic paints, Nodes 2.0 DOM).

import { app } from "../../../scripts/app.js";
import { hideJsonWidget } from "../shared/utils.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { onRendererChange } from "../shared/renderer_switch.mjs";
import { isLiveNode } from "../shared/live_node.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { registerNodeSettings } from "../shared/node_settings.mjs";
import { NODE, M, DEFAULT_INFO, unitWidth, readCfg } from "./core.mjs";
import { isInfo, isEmptyNote, installInfoBodyHook, paintClassic, applyResizeAspect, repairClassicHeight,
  buildVueFace, teardownVueFace, renderVueFace, classicComputeSize, heightForWidth } from "./face.mjs";
import { openReader, closeReader, readerNode, setReaderEditHandler, setReaderDeleteHandler } from "./reader.mjs";
import { openInfoEditor } from "./editor.mjs";
import { showStarterPopup, closeStarterPopup, starterPopupOpen } from "./starters.mjs";
import { INFO_HELP } from "./help.mjs";
import { infoAt } from "./hit.mjs";
import { hidePeek } from "./peek.mjs";

registerNodeHelp(NODE, INFO_HELP);

let _socketlessOk = false;

function edit(node, opts = {}) {
  closeReader();
  closeStarterPopup();
  openInfoEditor(node, { ...opts, onReopen: (n) => { if (isLiveNode(n)) openReader(n); } });
}
setReaderEditHandler((node, opts) => edit(node, opts));

// Delete a button the way core's own Delete does (LGraphCanvas.deleteSelected):
// inside the canvas and graph before/after-change events, so Ctrl+Z brings it
// back. People could not find core's entry in the menu (user, 2026-10-02),
// hence our own line next to Open / Edit.
//  - Right-click Delete on a button that is part of the selection deletes the
//    whole selection, exactly like core's Delete.
//  - `only` (the reading window): THIS button and nothing else. Its question
//    names one button, and the window stays open while the selection changes
//    underneath: with Ctrl+A on, it deleted the whole graph (reproduced, review
//    2026-10-02).
function deleteInfo(node, { only = false } = {}) {
  const g = node?.graph;
  if (!g || !isLiveNode(node) || node.block_delete) return;
  const c = app.canvas;
  const selected = !!(c && c.graph === g &&
    (c.selectedItems?.has?.(node) || c.selected_nodes?.[node.id] === node));
  if (selected && !only && typeof c.deleteSelected === "function") {
    c.deleteSelected();
    return;
  }
  try { c?.emitBeforeChange?.(); } catch (_e) {}
  try { g.beforeChange?.(); } catch (_e) {}
  try {
    g.remove(node);
  } finally {
    // graph.remove takes the node out of the selection with deselect(), which
    // does not announce it (info.md #6b): tell ComfyUI's selection store.
    if (selected) { try { c.onSelectionChange?.(c.selected_nodes); } catch (_e) {} }
    try { c?.setDirty?.(true, true); } catch (_e) {}
    try { g.afterChange?.(); } catch (_e) {}
    try { c?.emitAfterChange?.(); } catch (_e) {}
  }
}
setReaderDeleteHandler((node) => deleteInfo(node, { only: true }));

// The gear in the selection toolbar opens the editor: the strip on top of it IS
// this node's settings (title, icon, colour). ownMenuItem: Edit is our own line.
registerNodeSettings(NODE, {
  title: "Info",
  ownMenuItem: true,
  menuLabel: "Edit",
  open: (node) => edit(node),
});

// `live` is true only for a flip of the setting (a user action); the first call
// is on the creation path and writes nothing serialized.
function applyRenderer(node, vue, live) {
  vue = !!vue;
  if (node._pixInfoVue === vue) return;
  node._pixInfoVue = vue;
  if (vue) {
    buildVueFace(node);
  } else {
    teardownVueFace(node);
    // A live switch to Classic: Nodes 2.0 left a short stored height, so set
    // it from the width, which carries the scale in both renderers
    // (run-timer.md #13: derive from node.size[0], never from a value an
    // observer on the old face may have rewritten during the switch).
    if (live) node.size[1] = heightForWidth(node);
  }
  try { node.setDirtyCanvas?.(true, true); } catch (_e) {}
}

function setupNode(node) {
  hideJsonWidget(node.widgets, "note_json");
  node.badges = [];
  if (!node.flags) node.flags = {};
  if (!node.flags.no_title) node.flags.no_title = true;
  node._pixInfoRefresh = () => {
    if (node._pixInfoRoot) renderVueFace(node);
    try { node.setDirtyCanvas?.(true, false); } catch (_e) {}
  };
  applyRenderer(node, isVueNodes(), false);
  node._pixInfoRendererOff = onRendererChange((vue) => {
    if (node.graph && isLiveNode(node)) applyRenderer(node, vue, true);
  });
}

app.registerExtension({
  name: "Pixaroma.Info",

  setup() { installInfoBodyHook(); },

  // The saved-state widget, made by us so it can be SOCKETLESS: the frontend
  // creates no input socket for a widget whose options say so, and ITS STRING
  // constructor does not pass the flag through (measured on 1.53.6). A socket
  // on a title-less button sat under the top-left corner, where a press dragged
  // a wire out of it. Selected by "widgetType" in nodes/node_info.py.
  getCustomWidgets() {
    return {
      PIXAROMA_INFO_STATE(node, inputName, inputData) {
        const spec = (Array.isArray(inputData) ? inputData[1] : inputData) || {};
        const def = typeof spec.default === "string" ? spec.default : "";
        const widget = node.addWidget("text", inputName, def, () => {}, { socketless: true });
        widget.options = widget.options || {};
        widget.options.socketless = true;
        return { widget };
      },
    };
  },

  getNodeMenuItems(node) {
    if (!isInfo(node)) return [];
    return [
      null,
      { content: "📖 Open", callback: () => openReader(node) },
      { content: "✏️ Edit", callback: () => edit(node) },
      { content: "✨ Start from...", callback: () => showStarterPopup(node) },
      // Straight away, like core's Delete (Ctrl+Z undoes it). The reading
      // window's Delete asks first.
      { content: "🗑️ Delete", callback: () => deleteInfo(node) },
    ];
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE) return;
    const LG = window.LiteGraph || {};
    nodeType.title_mode = (LG.NO_TITLE != null) ? LG.NO_TITLE : 1;
    // No pack badge above a title-less node (frontend 1.53.6 draws it from a
    // central provider; label.md, the last section).
    nodeType.prototype.drawBadges = function () {};

    // A copy / paste / duplicate / load runs configure; a fresh drop does not.
    // The flag is raised by a wrapper on configure ITSELF (Vue Compat #17).
    const _origConfigureFn = nodeType.prototype.configure;
    nodeType.prototype.configure = function () {
      this._pixInfoConfigured = true;
      return _origConfigureFn.apply(this, arguments);
    };

    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = _origCreated?.apply(this, arguments);
      // Before configure, the inputs are the def's: none means this frontend
      // honours "socketless" (older ones still make a socket).
      if (!(this.inputs || []).some((i) => i && i.name === "note_json")) _socketlessOk = true;
      // A fresh node opens at the scale-1 size of the default button. Set
      // synchronously: configure (load, paste) overwrites it with the saved size.
      this.size[0] = Math.round(unitWidth(DEFAULT_INFO));
      this.size[1] = M.h;
      this._pixInfoBorn = performance.now();
      setupNode(this);
      // Offer the starters on a FRESH drop only. Read the load flag NOW, not in
      // the timer (CLAUDE.md Vue Compat #19: it is a 300 ms window).
      const bornInLoad = isGraphLoading();
      setTimeout(() => {
        if (bornInLoad || this._pixInfoConfigured || isGraphLoading()) return;
        if (!this.graph || !isLiveNode(this)) return;
        if (String(readCfg(this).content || "").trim()) return;
        showStarterPopup(this);
      }, 120);
      return r;
    };

    const _origCfg = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _origCfg?.apply(this, arguments);
      // Re-assert the flag configure just restored (Align reads it). Idempotent,
      // so an unchanged workflow stays clean (Vue Compat #18).
      if (!this.flags) this.flags = {};
      if (!this.flags.no_title) this.flags.no_title = true;
      // A button saved before the input became socketless still carries the
      // socket in its saved inputs. Drop it (only where this frontend makes
      // none itself, so an older one is not rewritten on every open). Saved
      // before the node was released, so only test workflows ever hit this.
      if (_socketlessOk && Array.isArray(this.inputs)) {
        const i = this.inputs.findIndex((x) => x && x.name === "note_json" && x.link == null);
        if (i >= 0) { try { this.removeInput(i); } catch (_e) {} }
      }
      this._pixInfoRaw = null;
      this._pixInfoRefresh?.();
      return r;
    };

    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      // Only a real corner drag (onResize also fires from setSize on restore,
      // fit-to-content, creation: convention #7).
      if (!isVueNodes() && !isGraphLoading()) {
        try {
          if (app.canvas?.resizing_node === this) {
            // The corner being dragged, read on the gesture's FIRST call: the
            // canvas clears pointer.resizeDirection after that (measured).
            applyResizeAspect(this, this._pixInfoDir);
          } else if (!this._pixInfoDir && app.canvas?.pointer?.resizeDirection) {
            // Fallback for a press our hit test missed (a corner zone can sit
            // just outside the node): the gesture's first call still has it.
            this._pixInfoDir = String(app.canvas.pointer.resizeDirection);
          }
        } catch (_e) {}
      }
      return _origResize?.apply(this, arguments);
    };

    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const r = _origDraw?.apply(this, arguments);
      if (isVueNodes() || this.flags?.collapsed) return r;
      try {
        if (app.canvas?.resizing_node === this && !isGraphLoading()) applyResizeAspect(this, this._pixInfoDir);
        else repairClassicHeight(this);
        paintClassic(this, ctx);
      } catch (e) {
        if (!this._pixInfoWarned) { this._pixInfoWarned = true; console.warn("[Pixaroma Info] paint failed", e); }
      }
      return r;
    };

    // The button's own floor, in BOTH renderers. Measured: with ComfyUI's
    // default computeSize left in place for Nodes 2.0, a workflow reload grew
    // every small button to that default (188x34 -> 210x58), which changed its
    // scale and its saved size on a plain open. computeSize is a minimum only.
    // Nodes 2.0 also caps it at the CURRENT size (label.md #12): the frame stores
    // a height 30 short of what it draws (#5), so the Classic height grew a 4 to
    // 20 on open and the workflow read "modified" after one click.
    nodeType.prototype.computeSize = function (out) {
      const sz = classicComputeSize(this);
      if (isVueNodes() && this.size) {
        if (Number.isFinite(this.size[0])) sz[0] = Math.min(sz[0], this.size[0]);
        if (Number.isFinite(this.size[1])) sz[1] = Math.min(sz[1], this.size[1]);
      }
      if (out) { out[0] = sz[0]; out[1] = sz[1]; return out; }
      return sz;
    };

    // Opening is a single click (index.js below), not a double click.
    nodeType.prototype.onDblClick = function () { return true; };

    // The only input is the hidden saved-state widget. Classic draws a widget's
    // input dot whenever the mouse is over that widget, which put a stray dot
    // on the button's corner; and a dropped STRING wire would plug into it.
    // Nothing connects to an Info button, so draw no slots and refuse wires.
    nodeType.prototype.drawSlots = function () {};
    nodeType.prototype.onConnectInput = function () { return false; };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try { this._pixInfoRendererOff?.(); } catch (_e) {}
      this._pixInfoRendererOff = null;
      if (readerNode() === this) closeReader();
      try { this._noteEditor?.close?.(true); } catch (_e) {}
      teardownVueFace(this);
      return _origRemoved?.apply(this, arguments);
    };
  },
});

// ── A click opens the note ──────────────────────────────────────────────────
// One window-capture pair for both renderers; the hit test is hit.mjs.
//
// A click = down and up on the same button, moving under 5 px, within 700 ms,
// and the node did not move (that was a drag). Modifier keys are left to
// ComfyUI (multi-select). An EMPTY note opens the editor straight away.
//
// The click is a "read this", not a "select this": afterwards the button is
// deselected again, so ComfyUI's selection toolbar (delete, colour, help...)
// does not pop up over the canvas each time a note is opened (user's call
// 2026-10-01). Dragging still selects, and so do Shift/Ctrl-click, a marquee
// and right-click, for when the button itself is what you want.

// While a press that started on an Info button is down, ComfyUI's selection
// toolbar is hidden: the press selects the node at once, and the deselect can
// only come after the release, so a plain click flashed the toolbar for a few
// frames (measured: 3 of 60). A drag or a long press shows it on release.
const PRESSING = "pix-info-pressing";
let _pressTok = 0;
function pressing(on) {
  _pressTok++;
  try { document.documentElement.classList.toggle(PRESSING, !!on); } catch (_e) {}
}
if (typeof document !== "undefined" && !document.querySelector("style[data-pixaroma-info-press]")) {
  const st = document.createElement("style");
  st.setAttribute("data-pixaroma-info-press", "1");
  st.textContent = `html.${PRESSING} .selection-toolbox{visibility:hidden!important;}`;
  document.head.appendChild(st);
}

function deselectAfterClick(n) {
  // After ComfyUI's own handlers, which select on this same release.
  setTimeout(() => {
    try {
      const c = app.canvas;
      if (n.selected || c?.selected_nodes?.[n.id]) {
        if (typeof c.deselect === "function") c.deselect(n);
        else c.deselectNode?.(n);
        // deselect() does not announce the change; processSelect announces it
        // after calling it (LGraphCanvas.ts). Without this ComfyUI's selection
        // store keeps the node: Nodes 2.0 kept the selection ring on it and
        // the selection toolbar stayed (measured).
        c.onSelectionChange?.(c.selected_nodes);
        c.setDirty?.(true, true);
      }
      // Nodes 2.0 focuses the node element on press, and the Esc that closes
      // the reader then makes Chrome draw its keyboard-focus ring round the
      // button (core nodes do the same after a click + Esc). Drop that focus.
      const a = document.activeElement;
      if (a && a !== document.body && n._pixInfoRoot && a.contains?.(n._pixInfoRoot)) a.blur?.();
    } catch (_e) {}
    // The toolbar fades out over a few frames after the deselect (measured: 2
    // frames still showed when the class came off here), so keep it hidden a
    // moment longer. Any new press clears it at once.
    const mine = ++_pressTok;
    setTimeout(() => { if (mine === _pressTok) pressing(false); }, 300);
  }, 0);
}

// A release that completes a read: same button, under 5 px of travel, within
// 700 ms, the node did not move (that was a drag).
function isReadClick(d, e) {
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return false;
  if (performance.now() - d.t > 700) return false;
  const n = d.node;
  if (n.pos[0] !== d.px || n.pos[1] !== d.py) return false;
  // The click that PLACES a just-added node is not a request to read it.
  if (performance.now() - (n._pixInfoBorn || 0) < 500) return false;
  if (d.pop || starterPopupOpen() || !isLiveNode(n)) return false;
  return infoAt(e) === n;
}

if (typeof window !== "undefined" && !window._pixInfoClickWired) {
  window._pixInfoClickWired = true;
  let down = null;
  window.addEventListener("pointerdown", (e) => {
    down = null;
    pressing(false);
    if (e.button !== 0) return;
    const n = infoAt(e);
    if (!n) return;
    // A new gesture. If it starts on a resize corner, remember which one, with
    // LiteGraph's own test: the canvas sets pointer.resizeDirection after this
    // listener and clears it again after the first move (measured).
    n._pixInfoDir = null;
    if (!isVueNodes()) {
      try {
        const p = app.canvas.convertEventToCanvasOffset(e);
        n._pixInfoDir = n.findResizeDirection?.(p[0], p[1]) || null;
      } catch (_e) {}
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    // The starter popup closes itself on this same press (its listener runs
    // after ours), so whether it was open must be read NOW, not at the release:
    // a click that dismisses the popup is not a request to read (reproduced).
    down = { node: n, x: e.clientX, y: e.clientY, t: performance.now(), px: n.pos[0], py: n.pos[1],
      pop: starterPopupOpen() };
    pressing(true);
  }, true);
  // A press that never gets its release must not leave the toolbar hidden.
  const release = () => { down = null; pressing(false); };
  window.addEventListener("pointercancel", release, true);
  window.addEventListener("blur", release);
  window.addEventListener("pointerup", (e) => {
    const d = down;
    down = null;
    if (!d || e.button !== 0 || !isReadClick(d, e)) { pressing(false); return; }
    const n = d.node;
    hidePeek();
    if (isEmptyNote(n)) edit(n);
    else openReader(n);
    deselectAfterClick(n);
  }, true);
}
