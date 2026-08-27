// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Monitor Pixaroma - a live readout of what the computer is doing         ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Frontend-only node (never runs in Python), TITLE-LESS like Label and Run
// Timer: the whole node is the readout, with no title bar, no category chip and
// no frame. That is done the only way that works in both renderers, and the
// recipe is .claude/patterns/run-timer.md #4:
//
//   • nodeType.title_mode = NO_TITLE, set ONCE on the node TYPE. A per-node live
//     toggle does NOT work: Nodes 2.0 caches title_mode in a reactive copy that
//     only re-reads on remount, so it keeps reserving the 30px.
//   • CLASSIC: NO DOM widget. The face is painted onto the node canvas, so
//     LiteGraph keeps the drag and the right-click. A DOM element on top of the
//     canvas cannot be a node: click-through hands its clicks to the BROWSER.
//   • NODES 2.0: a DOM widget, with the frame hidden by CSS and the subtree made
//     click-through - except the buttons, which are the one thing you press.
//
// SIZE. The scale lives in two places on purpose, because the two renderers
// disagree about who owns a node's height:
//   • CLASSIC owns it, so the scale is DERIVED from node.size[1] every frame - a
//     pure read, no write, so dragging cannot dirty a workflow and a saved size
//     restores itself. The derived value is written into the state once, when
//     the drag ENDS, which is a real user gesture and allowed to.
//   • NODES 2.0 does not: a height write there is silently discarded (measured
//     on Run Timer) because the layout store derives it from the content. So the
//     scale comes from the state and is handed to the CSS as --pm-s; the node
//     then grows by itself.
// Both read the same stored number, so a monitor keeps its size across a
// renderer switch.
//
// NOTHING about a READING is ever serialized. The numbers, the peak and the run
// state live on runtime fields and in poll.mjs. A node that wrote a value into
// node.properties every second would mark the workflow modified forever and bury
// the undo history (Vue Compat #18).

import { app } from "/scripts/app.js";
import { isVueNodes, applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { onRendererChange } from "../shared/renderer_switch.mjs";
import { notifyGraphChanged } from "../shared/graph_changed.mjs";
import { registerNodeSettings, installNodeAccent } from "../shared/node_settings.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import {
  NODE_NAME, readState, writeState, contentHeight, MIN_W, BASE_W, MIN_S, MAX_S,
  stripUnitWidth,
} from "./core.mjs";
import { injectCSS, el, renderFace, flashButton } from "./ui.mjs";
import { paintFace, hitButton, localMouse } from "./paint.mjs";
import {
  openSettingsPanel, closeSettingsPanelFor, justClosedByOutsideClick,
} from "./settings.mjs";
import {
  addNode, removeNode, lastSample, peakFor, freeMemory, resetPeak, kick, isRunning,
} from "./poll.mjs";
import { HELP } from "./help.mjs";

const SCREEN_BG = "#0c0c0e";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── is the cursor actually over the canvas? ─────────────────────────────────
// The classic face computes its button hover from app.canvas.graph_mouse, which
// only moves while the pointer is over the canvas and KEEPS ITS LAST VALUE after
// that. So moving the cursor off onto the settings panel leaves a button lit up
// as though it were still hovered - the same family as the tooltip that lingers
// when the cursor leaves a canvas-painted pill (node UI convention #8), and it
// cannot be fixed from the draw loop alone because the draw loop is exactly what
// stops running.
let _pointerOnCanvas = true;

function installPointerWatch() {
  if (typeof window === "undefined" || window._pixPmPointerWatch) return;
  window._pixPmPointerWatch = true;
  window.addEventListener(
    "pointermove",
    (e) => {
      const on = e.target === app.canvas?.canvas;
      if (on === _pointerOnCanvas) return;
      _pointerOnCanvas = on;
      // repaint at once rather than waiting for the next sample, or the button
      // stays lit for up to a second after the cursor has gone
      if (!on) app.canvas?.setDirty?.(true, true);
    },
    true,
  );
}

/** The face's height at scale 1 for this node's CURRENT settings. */
function unitH(node) {
  const st = readState(node);
  return contentHeight(node, st, lastSample(), peakFor(st));
}

function stateScale(node) {
  return clamp(Number(readState(node).scale) || 1, MIN_S, MAX_S);
}

/** Read-only: work out the scale the classic node's height is asking for. */
function scaleFromHeight(node) {
  const u = unitH(node);
  if (!(u > 0)) return 1;
  return clamp((node.size?.[1] || u) / u, MIN_S, MAX_S);
}

/**
 * LiteGraph's resize floor for the classic node - and the ONLY thing that can
 * actually stop a corner drag going too narrow.
 *
 * ⚠️ THE WIDTH FLOOR MUST FOLLOW THE SCALE (reported with a screenshot, then
 * reproduced, 2026-08-24). It used to be the flat scale-1 `MIN_W`, so a node
 * dragged to 5x could still be squeezed to 215px while its contents needed
 * 1075: the bars went, the labels went, the buttons truncated to "Free…" and
 * "Rese…", and the temp / power / peak line ran straight out over the canvas.
 *
 * A direct `node.size[0] = …` write from the draw hook does NOT fix this, which
 * is why one was there and did nothing: LiteGraph recomputes the size from the
 * POINTER on every move (absolute, not a delta), so our write is overwritten on
 * the very next frame and the pointer always wins. `computeSize` is the hook
 * LiteGraph itself clamps against, so it is the one that holds.
 *
 * The HEIGHT floor deliberately stays at scale 1: the height is what carries the
 * scale, so a floor of `unitH * scale` would be the current height and the node
 * could never be made smaller again. Dragging the height down lowers the scale,
 * which lowers the width floor with it.
 */
function installClassicComputeSize(node) {
  node.computeSize = function () {
    const s = scaleFromHeight(this);
    // strip: the drag floor is what the TEXT needs at this scale, so a strip
    // can never be dragged (or scaled) into clipping its own readouts; wider
    // than that is the user's parking choice (see scaledWidth)
    const stCS = readState(this);
    if (stCS.layout === "strip") return [Math.round(stripUnitWidth(stCS) * s), unitH(this)];
    return [Math.round(MIN_W * s), unitH(this)];
  };
}

// ── repaint ─────────────────────────────────────────────────────────────────

function repaint(node) {
  const st = readState(node);
  const sample = lastSample();
  const peak = peakFor(st, sample);
  node._pmRunning = isRunning();
  node._pmOffline = !sample;
  if (isVueNodes()) {
    if (node._pmRoot) {
      renderFace(node, st, sample, peak, (key, btn) => runButton(node, key, btn));
    }
  } else {
    // FOREGROUND ONLY. paintFace runs in onDrawForeground and the body hook
    // wraps drawNode, so the face is entirely foreground work - the background
    // canvas only carries the GRID and the GROUPS, which a changing reading
    // cannot affect. This fires on EVERY sample (about 3 a second during a run,
    // see #12), and asking for the background made each one cost 15.4 ms on an
    // 80-node graph instead of 3.7 (measured for the same fix on Run Timer).
    // The hover repaint below has always passed false; this matches it.
    node.setDirtyCanvas?.(true, false);
  }
}

/**
 * The width the Size control should move this node to: the CURRENT width,
 * scaled proportionally from the previous scale to the new one, floored at
 * MIN_W * scale.
 *
 * ⚠️ NO OWNERSHIP HEURISTIC - the second width-ratchet report proved one
 * cannot work (2026-08-24, reproduced both times before fixing).
 * - Ratchet v1: the width only ever went UP with the scale and never came
 *   back (305 -> 645 and stuck).
 * - Ratchet v2, the fix's own bug: v1's fix scaled the width both ways ONLY
 *   for a node still wearing `BASE_W * scale`, treating everything else as a
 *   user-chosen width to preserve. But the SYSTEM creates other widths too - a
 *   corner drag floors the width to MIN_W * scale - and those were mistaken
 *   for user choices: reproduced, a floored 323 node wiggled 1 -> 2 -> 1 on
 *   the slider ended 430 wide at scale 1, forever.
 * Proportional needs no guess about whose width it is: up-then-down lands back
 * where it started (rounding self-corrects, verified 305 -> 610 -> 915 -> 610
 * -> 305), a user-widened node keeps its PROPORTION (2x means twice the node
 * you shaped, matching what the corner drag does), and the floor still stops
 * the widest line from clipping.
 */
function scaledWidth(node, s) {
  const prev = clamp(Number(node._pmScale) || s, MIN_S, MAX_S);
  const w = Math.round(node.size?.[0] || BASE_W * prev);
  // A STRIP always HUGS ITS CONTENT: width = what the enabled readouts need at
  // this scale, exactly - nothing more to remember. Three user reports, one per
  // cleverer attempt (all 2026-08-24), led here:
  //   - proportional width LUNGED ("it moves the bar");
  //   - pinned width CLIPPED when scaled up ("it start to cut");
  //   - a remembered parked width kept a bar LONG at small sizes ("even when
  //     is small is still long") - the user expects small = compact.
  // Exact-fit satisfies all three: compact when small, grown only as much as
  // the text needs when big, symmetric by construction. Someone who wants a
  // wide dashboard has the Bars layout.
  const st = readState(node);
  if (st.layout === "strip") return Math.round(stripUnitWidth(st) * s);
  const minW = Math.round(MIN_W * s);
  return Math.max(Math.round((w * s) / prev), minW);
}

/**
 * End-of-resize-gesture width work, shared by the classic drag-end frame and
 * the Nodes 2.0 release hook. A REAL GESTURE ONLY - it writes.
 *
 * Bars: snap the width up to MIN_W * scale (the one-frame clamp lag, see the
 * caller). Strip: snap up to the CONTENT floor so no gesture can end clipped.
 */
function commitWidthAfterGesture(node, s) {
  const st = readState(node);
  if (st.layout === "strip") {
    // only ever snap UP to the content floor: a drag below it would clip, and
    // a drag above it is left alone until the Size control next runs (which
    // re-hugs - the strip owns no remembered width, see scaledWidth)
    const fl = Math.round(stripUnitWidth(st) * s);
    if (node.size[0] < fl) node.setSize?.([fl, node.size[1]]);
    return;
  }
  const minW = Math.round(MIN_W * s);
  if (node.size[0] < minW) node.setSize?.([minW, node.size[1]]);
}

/** Put the node's size back in step with its settings. USER ACTIONS ONLY. */
function syncSize(node) {
  const s = stateScale(node);
  const w = scaledWidth(node, s);
  node._pmScale = s;
  if (isVueNodes()) {
    node._pmRoot?.style.setProperty("--pm-s", String(s));
    // The HEIGHT is the layout store's here and a write to it is discarded, but
    // the WIDTH does take (measured on Run Timer). The height follows the
    // content by itself.
    if (Math.round(node.size[0]) !== w) node.setSize?.([w, node.size[1]]);
  } else if (typeof node.setSize === "function") {
    // Diff-gated like the Vue branch above: a syncSize that changes nothing
    // must WRITE nothing, or any future no-op caller re-dirties the workflow.
    const h = Math.round(unitH(node) * s);
    if (Math.round(node.size[0]) !== w || Math.round(node.size[1]) !== h) {
      node.setSize([w, h]);
    }
  }
  repaint(node);
}

// ── the buttons ─────────────────────────────────────────────────────────────

async function runButton(node, key, domBtn) {
  const flash = (label) => {
    if (domBtn) {
      flashButton(domBtn, label);
    } else {
      // classic: the painter reads this and draws the button green
      clearTimeout(node._pmFlashT);
      node._pmFlash = { key, label };
      node.setDirtyCanvas?.(true, false);   // foreground only, as above
      node._pmFlashT = setTimeout(() => {
        node._pmFlash = null;
        node.setDirtyCanvas?.(true, false);
      }, 900);
    }
  };
  if (key === "settings") {
    // A TOGGLE, and getting that right differs by renderer. In classic the
    // button is painted on the canvas, so the pointerdown that presses it is a
    // canvas pointerdown - which the panel's own outside-close guard has ALREADY
    // acted on by the time LiteGraph routes the click to us. Without this check
    // the panel would close and instantly reopen, so it could never be shut from
    // the button that opened it. In Nodes 2.0 the button is a real DOM element
    // inside our own subtree, the guard exempts it, and openSettingsPanel's own
    // was-open check does the toggling.
    if (!justClosedByOutsideClick(node)) openPanel(node);
    return;
  }
  if (key === "reset") {
    resetPeak(readState(node));
    flash("Reset");
    return;
  }
  const res = await freeMemory({ unloadOnly: key === "unload" });
  flash(res.ok ? "Done" : "Failed");
}

// ── classic: match the node body to the face ────────────────────────────────
// LiteGraph paints the node body (fill + drop shadow) BEFORE onDrawForeground.
// On a title-less node that leaves a soft frame around the face, so for a
// Monitor the body is painted AS the face's dark screen and the shadow is
// switched off for the duration. Everything is restored in the finally, and it
// composes with Label's and Run Timer's own drawNode wraps: each checks its own
// node type and passes everything else straight through.
function installPmBodyHook() {
  if (typeof window === "undefined" || window._pixPmBodyWrapped) return;
  const proto = window.LGraphCanvas && window.LGraphCanvas.prototype;
  if (!proto || typeof proto.drawNode !== "function") return;
  window._pixPmBodyWrapped = true;
  const orig = proto.drawNode;
  proto.drawNode = function (node, ctx) {
    if (ctx && node && (node.type === NODE_NAME || node.comfyClass === NODE_NAME)) {
      const sBg = node.bgcolor;
      const sCol = node.color;
      const sShadow = ctx.shadowColor;
      const LG = window.LiteGraph || {};
      const sR = LG.ROUND_RADIUS;
      node.bgcolor = SCREEN_BG;
      node.color = SCREEN_BG;
      if (LG) LG.ROUND_RADIUS = 8;
      ctx.shadowColor = "rgba(0,0,0,0)";
      try {
        return orig.apply(this, arguments);
      } finally {
        node.bgcolor = sBg;
        node.color = sCol;
        ctx.shadowColor = sShadow;
        if (LG) LG.ROUND_RADIUS = sR;
      }
    }
    return orig.apply(this, arguments);
  };
}

// ── building and tearing down the Nodes 2.0 face ────────────────────────────
// A node that builds a DIFFERENT UI per renderer MUST rebuild when the renderer
// changes under it: the setting carries no reload flag, so ComfyUI never tells
// anyone to refresh, and core's own nodes do swap live. Without this, flipping
// to Nodes 2.0 leaves an empty body (the DOM was never built) and flipping back
// leaves the canvas paint drawn on top of leftover DOM rows.

function buildVueFace(node) {
  if (node._pmRoot) return;
  const root = el("div", "pix-mon-root");
  const screen = el("div", "pix-mon-screen");
  root.appendChild(screen);
  node._pmRoot = root;
  node._pmScreen = screen;
  node._pmSig = null;
  installNodeAccent(node, root);
  installCanvasZoomPassthrough(root);
  root.style.setProperty("--pm-s", String(stateScale(node)));

  const widget = node.addDOMWidget("monitor_ui", "pixaroma_monitor", root, {
    getValue: () => readState(node),
    setValue: () => {},
    // Computed from the SETTINGS, never measured from the DOM: a live
    // measurement creeps node.size bigger on every workflow switch (Vue Compat
    // #18). Same number every load for the same settings.
    getMinHeight: () => Math.round(unitH(node) * stateScale(node)),
    serialize: false,
  });
  node._pmWidget = widget;
  applyAdaptiveCanvasOnly(widget);
  widget.computeLayoutSize = () => ({
    minHeight: Math.round(unitH(node) * stateScale(node)),
    minWidth: 1,
  });
  // Pinned only WHILE a resize handle is dragged, which is exactly when the
  // frontend takes its collapse measurement - so the node cannot be dragged
  // shorter than its own contents, and nothing is pinned the rest of the time.
  // The onRelease is the WIDTH floor: Nodes 2.0 ignores min-width and
  // computeLayoutSize.minWidth for the width drag (the helper's own comment -
  // this hook exists for exactly this), so a node dragged too narrow is
  // snapped back out once, on release. A real gesture, so the write is
  // legitimate; diff-gated so a normal release writes nothing (review
  // finding, 2026-08-24).
  node._pmFloorOff = installResizeFloor(
    root,
    () => Math.round(unitH(node) * stateScale(node)),
    () => commitWidthAfterGesture(node, stateScale(node)),
  );
  node._pmSig = null;
  repaint(node);
}

function teardownVueFace(node) {
  try {
    node._pmFloorOff?.();
  } catch (_e) {}
  node._pmFloorOff = null;
  // ⚠️ CALL THE WIDGET'S OWN onRemove FIRST. Splicing it out of node.widgets and
  // calling element.remove() is NOT enough: ComfyUI's DOMWidgetImpl also lives in
  // its own widget store, and the Vue layer re-mounts every widget in that store
  // into a fresh .dom-widget wrapper - so the element comes straight back.
  // MEASURED before this line existed: three renderer round trips left 6 orphaned
  // faces in the document, all still visible and still owning their observers,
  // while node.widgets correctly read 0. Scope any such count to the node's own
  // root or you will also be counting another workflow TAB's mounted widgets.
  try {
    node._pmWidget?.onRemove?.();
  } catch (_e) {}
  if (node._pmWidget && Array.isArray(node.widgets)) {
    const i = node.widgets.indexOf(node._pmWidget);
    if (i >= 0) node.widgets.splice(i, 1);
  }
  try {
    node._pmRoot?.closest?.(".dom-widget")?.remove();
    node._pmRoot?.remove();
  } catch (_e) {}
  node._pmWidget = null;
  node._pmRoot = null;
  node._pmScreen = null;
  node._pmEls = null;
  node._pmSig = null;
}

function applyRenderer(node, vue) {
  if (node._pmVue === !!vue) return;
  node._pmVue = !!vue;
  if (vue) {
    buildVueFace(node);
  } else {
    teardownVueFace(node);
    // Classic derives its scale from the height, so put the height where the
    // stored scale says it should be - otherwise the node keeps whatever Vue's
    // layout left behind and comes back the wrong size.
    installClassicComputeSize(node);
    if (typeof node.setSize === "function") {
      node.setSize([Math.max(node.size[0] || MIN_W, MIN_W), Math.round(unitH(node) * stateScale(node))]);
    }
  }
  repaint(node);
}

// ── node lifecycle ──────────────────────────────────────────────────────────

function setupNode(node) {
  injectCSS();
  node.badges = [];            // no pack badge: this node has no title bar
  node.flags = node.flags || {};
  // title_mode on the TYPE handles the RENDER; this FLAG is what other features
  // read - Align zeroes the title height only when it is set, so top and centre
  // alignment line up on a title-less node. Idempotent, so no dirty-on-load.
  if (!node.flags.no_title) node.flags.no_title = true;
  node._pmScale = stateScale(node);
  node._pmRepaint = () => repaint(node);
  node._pmVue = null;

  applyRenderer(node, isVueNodes());
  node._pmRendererOff = onRendererChange((vue) => applyRenderer(node, vue));

  // A FRESH node opens at its natural size. Assigned SYNCHRONOUSLY: configure()
  // runs after this and restores the saved size for a saved or duplicated node,
  // so this only ever decides what a brand-new drop looks like. Deferring it
  // into a microtask would flatten every user-resized monitor back to small
  // (node UI convention #9).
  const fresh = [Math.round(BASE_W * node._pmScale), Math.round(unitH(node) * node._pmScale)];
  if (Array.isArray(node.size)) {
    node.size[0] = fresh[0];
    node.size[1] = fresh[1];
  } else {
    node.size = fresh;
  }

  addNode(node);
  // nodeCreated fires BEFORE configure() restores node.properties (Vue Compat
  // #8), so the first paint from the restored settings has to wait a tick.
  queueMicrotask(() => {
    node._pmScale = isVueNodes() ? stateScale(node) : scaleFromHeight(node);
    node._pmRoot?.style.setProperty("--pm-s", String(node._pmScale));
    repaint(node);
    kick();
  });
}

app.registerExtension({
  name: "Pixaroma.Monitor",

  setup() {
    installPmBodyHook();
    installPointerWatch();
  },

  getNodeMenuItems(node) {
    // node.type fallback: comfyClass is not populated on every build or at every
    // timing, which is the case Label's own hook guards.
    if (!node || (node.type !== NODE_NAME && node.comfyClass !== NODE_NAME)) return [];
    return [
      null,
      { content: "⚙ Monitor settings", callback: () => openPanel(node) },
    ];
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;

    // Title-less, set ONCE on the TYPE so both renderers read NO_TITLE from the
    // first mount and never reserve the title height. See the note at the top.
    const LG = (typeof window !== "undefined" && window.LiteGraph) || {};
    nodeType.title_mode = LG.NO_TITLE != null ? LG.NO_TITLE : 1;

    if (nodeType.prototype._pixPmPatched) return;   // hot reload: never double-wrap
    nodeType.prototype._pixPmPatched = true;

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure ? _origConfigure.apply(this, arguments) : undefined;
      this.flags = this.flags || {};
      if (!this.flags.no_title) this.flags.no_title = true;
      // READ ONLY on this path: the restored size carries the chosen scale in
      // classic, and the stored scale carries it in Nodes 2.0. Writing anything
      // here would flag an untouched workflow modified (Vue Compat #18).
      this._pmScale = isVueNodes() ? stateScale(this) : scaleFromHeight(this);
      this._pmRoot?.style.setProperty("--pm-s", String(this._pmScale));
      this._pmSig = null;   // settings may have changed the row set
      repaint(this);
      return r;
    };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      removeNode(this);
      closeSettingsPanelFor(this);
      clearTimeout(this._pmFlashT);
      try {
        this._pmRendererOff?.();
      } catch (_e) {}
      this._pmRendererOff = null;
      teardownVueFace(this);
      if (_origRemoved) return _origRemoved.apply(this, arguments);
    };

    // Classic: paint the face onto the node canvas. Nodes 2.0 skips this
    // entirely (its DOM face renders instead, and body paint is not called).
    const _origFg = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const r = _origFg ? _origFg.apply(this, arguments) : undefined;
      if (!ctx || isVueNodes()) return r;
      if (this.flags?.collapsed) return r;   // else the face paints over the collapsed bar

      // THE isGraphLoading GATE IS NOT OPTIONAL (node UI convention #7):
      // node.size is serialized and a draw hook runs on the FIRST frame of a
      // workflow load, so an ungated write here is the one thing that could
      // flag an untouched workflow as modified.
      if (!isGraphLoading()) {
        const resizing = app.canvas?.resizing_node === this;
        if (resizing) {
          // The height IS the scale, so the face always fills the node exactly
          // and there is nothing to write back for it.
          this._pmScale = scaleFromHeight(this);
          // NOTE: there is deliberately NO width write here any more. One used
          // to sit on this line and did nothing, because LiteGraph recomputes
          // the size from the pointer every move and overwrites it on the next
          // frame. The width floor lives in computeSize, which LiteGraph clamps
          // against itself - see installClassicComputeSize.
        } else if (this._pmWasResizing) {
          // The drag just ended: remember the size the user chose, so it
          // survives a switch to the other renderer. A real gesture, so it is
          // allowed to mark the workflow modified.
          const s = Math.round(scaleFromHeight(this) * 100) / 100;
          if (Math.abs(s - stateScale(this)) > 0.01) {
            writeState(this, { scale: s });
            notifyGraphChanged();
          }
          this._pmScale = s;
          // The drag clamp reads computeSize() BEFORE it applies the frame, so
          // the width floor is always one frame behind the height (verified in
          // the frontend's own resize handler). Mid-drag that is invisible and
          // self-correcting, but a drag that ENDS on such a frame would leave
          // the node narrower than its contents. Catch it once, here, where we
          // are already inside a real gesture and allowed to write.
          commitWidthAfterGesture(this, s);
        } else {
          const u = unitH(this);
          const want = Math.round(u * stateScale(this));
          // A height that is out of range is not a size anyone chose: it is what
          // a monitor saved in Nodes 2.0 leaves behind (the layout store keeps
          // the real height and parks a stub in node.size). Repair it from the
          // stored scale. A legitimately sized node is always in range, so this
          // cannot fire on a normal open.
          const h = this.size[1] || 0;
          if (h < u * MIN_S - 2 || h > u * MAX_S + 2) {
            this.setSize?.([Math.max(this.size[0] || MIN_W, MIN_W), want]);
            this._pmScale = stateScale(this);
          } else {
            this._pmScale = scaleFromHeight(this);
          }
        }
        this._pmWasResizing = resizing;
      }

      // Free per-frame hover: LiteGraph already redraws the node on every
      // pointermove, so anything computed here is implicitly per-frame
      // (Vue Compat #12).
      const lm = _pointerOnCanvas ? localMouse(this) : null;
      const hov = lm ? hitButton(this, lm[0], lm[1]) : null;
      if (hov !== this._pmHoverBtn) {
        this._pmHoverBtn = hov;
        this.setDirtyCanvas?.(true, false);
      }

      try {
        const st = readState(this);
        paintFace(this, ctx, st, lastSample(), peakFor(st));
      } catch (_e) {
        /* a broken frame must not take the canvas down */
      }
      return r;
    };

    // Classic: the painted buttons are hit-tested against the SAME rects the
    // painter just laid down (the Compare / Preview pattern for canvas
    // controls). Return true ONLY on a hit, or the node could never be dragged.
    const _origDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (e, pos) {
      if (!isVueNodes() && pos) {
        const key = hitButton(this, pos[0], pos[1]);
        if (key) {
          runButton(this, key, null);
          return true;
        }
      }
      return _origDown ? _origDown.apply(this, arguments) : undefined;
    };
  },

  nodeCreated(node) {
    if (node.type !== NODE_NAME && node.comfyClass !== NODE_NAME) return;
    setupNode(node);
  },
});

function openPanel(node) {
  openSettingsPanel(node, () => {
    node._pmSig = null;   // the row set may have changed: rebuild the face
    syncSize(node);
  });
}

registerNodeHelp(NODE_NAME, HELP);

// The gear in the node selection toolbar opens the same panel the right-click
// entry does. ownMenuItem: this node already adds its own menu line.
registerNodeSettings(NODE_NAME, {
  title: "Monitor",
  ownMenuItem: true,
  open: (node) => openPanel(node),
  // The face paints from accentOf() on its own canvas in classic, which no
  // shared repaint can reach, so the accent chain calls this after a default
  // changes (node-settings-accent.md invariant 2).
  onChange: (node) => repaint(node),
});
