// Reference Images Pixaroma - the node's size and where its output dots sit.
//
// The pictures' outputs (1, 2, 3...) stay ComfyUI's own column of dots on the
// right edge, and the face moves UP beside them instead of starting below the
// last one: adding a picture never makes the top of the node taller (the user,
// 2026-10-25). Classic does it with litegraph's widgets_start_y, Nodes 2.0 with
// the Load Image Mini / Number Pick block-nudge, lifting the body by all but the
// first slot row (text / prompt). The bar and the pictures keep a right GUTTER
// so the dots' labels never sit on a picture.
//
// The size: the pictures take exactly the rows they need (wider node = bigger
// pictures, up to 4 a row), "Your prompt" takes whatever height is left, and
// the node is never smaller than its content. All of it from ONE height model
// (gridHeight + FIXED_H), so Classic's drag clamp, Nodes 2.0's drag floor and
// the grow / shrink on a picture added or removed agree. Nothing here runs on
// the load path except DOM style (VC#18).

import { app } from "../../../scripts/app.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import { MAX_CARDS, readState } from "./core.mjs";

export const GUTTER = 26;      // right of the bar + pictures: room for the dots' "1" .. "12"
export const GAP = 8;          // between pictures (the grid's CSS gap)
export const MIN_CARD = 84;    // a picture is never narrower (the narrowest node keeps 3 a row)
export const MAX_COLS = 4;     // never more a row: a wider node gets bigger pictures
export const CARD_EXTRA = 52;  // under the square picture: 4 + role 22 + 4 + name 22
export const STRIP_H = 30;     // "+ Add pictures" under a full row
export const EMPTY_H = 110;    // the drop zone of an empty node
export const TEXT_MIN = 64;    // "Your prompt" at its smallest
// Everything but the pictures, in the inner layer: padding 6 + 8, bar 26, six
// gaps of 6, two heads of 16, "Your prompt" 64, warning 14, "Prompt sent" 58.
export const FIXED_H = 14 + 26 + 36 + 16 + 16 + TEXT_MIN + 14 + 58;
export const FLOOR = FIXED_H + EMPTY_H;   // the smallest content (an empty node): a constant (#39 E)
// Inner layer width minus the picture grid's: padding 8 + 8 and the gutter.
const GRID_INSET = 16 + GUTTER;
// What lies between node.size[1] and the inner layer (measured 2026-10-25,
// frontend 1.55): Classic = widgets_start_y + the DOM widget's margins.
const CLASSIC_START_Y = 22;
const CLASSIC_MARGIN = 10;
const SLOT_H = 20;

export function columnsFor(w) {
  return Math.max(1, Math.min(MAX_COLS, Math.floor((w + GAP) / (MIN_CARD + GAP))));
}

/** Where the Add button goes: "wide" (empty node), "tile" (the free place in
 *  the last row), "strip" (a slim row under a full row), or null (all 12 pictures). */
export function addMode(n, cols) {
  if (n === 0) return "wide";
  if (n >= MAX_CARDS) return null;
  return n % cols ? "tile" : "strip";
}

/** The picture grid's height for `n` pictures in a grid `w` px wide: what the
 *  CSS lays out (square pictures, the role + name under each). */
export function gridHeight(w, n) {
  if (n <= 0) return EMPTY_H;
  const cols = columnsFor(w);
  const cw = (w - GAP * (cols - 1)) / cols;
  const rows = Math.ceil(n / cols);
  const strip = addMode(n, cols) === "strip";
  return rows * (cw + CARD_EXTRA) + (rows - 1) * GAP + (strip ? GAP + STRIP_H : 0);
}

const cardCount = (node) => readState(node).cards.length;

const laidOut = (f) => !!(f?.root?.isConnected && f.root.offsetWidth >= 100 && f.grid.clientWidth > 0);

/** The picture grid's width when the node is `nodeW` wide. Classic: from the
 *  width alone (onResize runs with node.size already new and the DOM still
 *  old), with the paddings + gutter measured when laid out. Nodes 2.0: the
 *  grid's own width (called with the current width). */
export function gridWidthFor(node, nodeW) {
  const f = node._pixRfiFace;
  if (isVueNodes()) return laidOut(f) ? f.grid.clientWidth + (nodeW - node.size[0]) : nodeW - GRID_INSET;
  const inset = laidOut(f) ? f.root.offsetWidth - f.grid.clientWidth : GRID_INSET;
  const margin = Number.isFinite(f?.widget?.margin) ? f.widget.margin : CLASSIC_MARGIN;
  return nodeW - 2 * margin - inset;
}

/** node.size[1] minus the inner layer's height. Classic: the widget's start +
 *  its two margins (no DOM: see gridWidthFor). Nodes 2.0: measured. */
function chrome(node) {
  const f = node._pixRfiFace;
  if (isVueNodes()) {
    const h = frameBodyHeight(node);
    if (h && f?.root?.offsetHeight > 0) return h - f.root.offsetHeight;
    return 2 * SLOT_H;
  }
  const w = f?.widget;
  const y = Number.isFinite(w?.y) && w.y > 0 ? w.y : CLASSIC_START_Y;
  const margin = Number.isFinite(w?.margin) ? w.margin : CLASSIC_MARGIN;
  return y + 2 * margin;
}

/** The smallest node.size[1] that shows everything at width `nodeW`. */
export function nodeFloor(node, nodeW = node.size[0]) {
  return Math.ceil(chrome(node) + FIXED_H + gridHeight(gridWidthFor(node, nodeW), cardCount(node)));
}

/** The node's real body height: Nodes 2.0 keeps node.size only as a floor. */
function frameBodyHeight(node) {
  if (!isVueNodes()) return node.size[1];
  const root = node._pixRfiFace?.root;
  const frame = root?.closest?.(".lg-node");
  if (!frame || !frame.contains(root)) return 0;
  const scale = Number(app.canvas?.ds?.scale) || 1;
  return frame.getBoundingClientRect().height / scale - 30;
}

/** What fitAfterCards starts from: taken BEFORE a change, because adding an
 *  output already resizes the node (core's addOutput -> expandToFitContent ->
 *  setSize -> our Classic clamp to the NEW floor), and adding the picture
 *  grid's growth on top of that counted it twice (measured: +42 px). */
export function sizeBefore(node) {
  return { n: cardCount(node), h: frameBodyHeight(node) || node.size?.[1] || 0 };
}

/** After pictures were added or removed (a user action): the node grows or
 *  shrinks by exactly what the picture grid did, so "Your prompt" keeps its
 *  height, and never below the floor. */
export function fitAfterCards(node, before) {
  if (!node?.size || !before || isGraphLoading()) return;
  const n = cardCount(node);
  if (n === before.n || !before.h) return;
  const w = gridWidthFor(node, node.size[0]);
  const h = before.h + gridHeight(w, n) - gridHeight(w, before.n);
  node.setSize?.([node.size[0], Math.round(Math.max(h, nodeFloor(node)))]);
  node.setDirtyCanvas?.(true, true);
}

/** Nodes 2.0 grows the node to its floor after a corner drag (the drag itself
 *  pins the floor only at the press, and a wider node has taller pictures). */
export function growToFloor(node) {
  if (!node?.graph || isGraphLoading()) return;
  const floor = nodeFloor(node);
  const h = frameBodyHeight(node) || node.size[1];
  if (h < floor - 0.5) node.setSize?.([node.size[0], floor]);
}

// ── Classic: the face starts under the first slot row ────────────────────────
// litegraph's own field for custom slot layouts, not serialized; set at
// creation and re-asserted on configure (a saved node arrives without it). Set
// in BOTH renderers: Nodes 2.0 lays widgets out itself and ignores it, and
// core's computeSize then takes the larger of the slot rows and the widgets
// instead of their sum, in either renderer (no 160 px phantom for 8 dots on
// a reopen). Setting it per renderer raced a live flip (measured 2026-10-25:
// back in Classic it was still deleted, the face sat under all 7 dots, cut off).
export function liftClassic(node) {
  node.widgets_start_y = CLASSIC_START_Y;
}

// ── Nodes 2.0: lift the face beside the dots ─────────────────────────────────
// Pull the output block up by all but its first row with a negative bottom
// margin. Writes ONLY inline DOM style (VC#18). Proves the element is ours
// (`.lg-node[data-node-id]` is not page-unique, load-image-mini.md). The block's
// height is stamped on it: a picture added (a new dot) or a re-render (a fresh
// element, no stamp) re-lifts; otherwise the poll is two reads.
function slotBlockOf(node) {
  const root = node?._pixRfiFace?.root;
  const el = root?.closest?.(".lg-node");
  if (!el || !el.contains(root)) return null;
  const slot = el.querySelector(".lg-slot--output");
  return slot?.parentElement?.parentElement || null;
}

export function liftVue(node) {
  if (!isVueNodes()) return false;
  try {
    const block = slotBlockOf(node);
    if (!block) return false;
    const h = block.offsetHeight;
    if (!h || block.dataset.pixRfiLift === String(h)) return false;
    const first = block.querySelector(".lg-slot--output");
    const b = block.getBoundingClientRect();
    const r = first.getBoundingClientRect();
    if (!b.height) return false;
    const keep = Math.round((r.bottom - b.top) * (h / b.height));
    block.style.marginBottom = `${-Math.max(0, h - keep)}px`;
    block.dataset.pixRfiLift = String(h);
    return true;
  } catch {
    return false;   // a future frontend: the dots stay above the face, still works
  }
}

/** Land the lift on the first laid-out frames (a node being placed follows the
 *  cursor), then the 350 ms self-heal poll: Vue replaces the node element on a
 *  re-render, dropping our inline style (Number Pick's settleNudge + watchNudge). */
export function settleLift(node) {
  if (!isVueNodes()) return;
  const once = () => liftVue(node);
  try { requestAnimationFrame(once); } catch { once(); }
  for (const ms of [0, 16, 48, 120, 300, 700]) setTimeout(once, ms);
}

export function watchLift(node) {
  if (node._pixRfiLiftPoll) return;
  node._pixRfiLiftPoll = setInterval(() => {
    if (!node.graph) { unwatchLift(node); return; }
    liftVue(node);
  }, 350);
}

export function unwatchLift(node) {
  if (node._pixRfiLiftPoll) clearInterval(node._pixRfiLiftPoll);
  node._pixRfiLiftPoll = null;
}
