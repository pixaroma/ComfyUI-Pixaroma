// Video Tools Pixaroma - the input pairs, where the dots sit, and the node's size.
//
// Inputs: fps, then one PAIR per clip (v1 = video_1, a1 = audio_1, ...): the
// clips you wired plus one free pair (at least two pairs, at most 8). Python
// declares all 8 pairs; the node shows only these (the user, 2026-10-25: "v1 a1
// and so on so it doesn't grow node, it go down in left").
//
// Dots: the inputs stay ComfyUI's own column on the LEFT edge, and the face
// starts under the 5 OUTPUT rows instead of under the last input, so a new pair
// never pushes the face down; the face keeps a left gutter for the dots' labels
// (the Reference Images recipe, _node-ui-conventions #45: Classic
// widgets_start_y in BOTH renderers, Nodes 2.0 lifts the slot block, stamped).
//
// Size: the result picture (the stage) takes the extra height; the floor is the
// content with the stage at its smallest, measured. Nothing here writes on the
// load path except DOM style and the runtime labels (VC#18).

import { app } from "../../../scripts/app.js";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import { MAX_CLIPS } from "./core.mjs";

export const GUTTER_L = 34;       // left of the face: room for the dots' "fps", "v1", "a1"
export const STAGE_MIN = 90;      // the result picture at its smallest
export const ROW_STEP = 30;       // one clip row: 26 + the 4 px row gap
const OUT_ROWS = 5;               // video_frames, audio, frame_count, fps, duration
const SLOT_H = 20;
// Classic: the face starts under the 5th output row (4 + 5 x 20 = 104, less the
// 2 litegraph adds), and its DOM element sits another widget margin lower.
const CLASSIC_START_Y = 102;
const CLASSIC_MARGIN = 10;
const VUE_CHROME = 142;           // measured on frontend 1.55.18: 5 slot rows + paddings

export const MIN_PAIRS = 2;
const NAME = (kind, k) => `${kind === "v" ? "video" : "audio"}_${k}`;
const TYPE = (kind) => (kind === "v" ? "IMAGE" : "AUDIO");

const findInput = (node, name) => (node.inputs || []).findIndex((i) => i && i.name === name);
const linked = (node, name) => {
  const i = findInput(node, name);
  return i >= 0 && node.inputs[i].link != null;
};

/** The highest clip number with a wire in (its video or its sound), 0 for none. */
export function lastWiredClip(node) {
  let last = 0;
  for (let k = 1; k <= MAX_CLIPS; k++) if (linked(node, NAME("v", k)) || linked(node, NAME("a", k))) last = k;
  return last;
}

/** How many pairs the node shows: the wired clips + one free pair. */
export function pairsWanted(node) {
  return Math.max(MIN_PAIRS, Math.min(MAX_CLIPS, lastWiredClip(node) + 1));
}

/** How many pairs the node HAS now (video_k present). */
export function pairsShown(node) {
  let n = 0;
  for (let k = 1; k <= MAX_CLIPS; k++) if (findInput(node, NAME("v", k)) >= 0) n = k;
  return n;
}

/** The dot's label: "v1", "a1", the short form the user asked for. Runtime
 *  only (index.js strips it from the saved file); a label the user typed stays. */
export function shortLabel(name) {
  const m = /^(video|audio)_(\d+)$/.exec(name || "");
  return m ? `${m[1][0]}${m[2]}` : null;
}
export const isOurLabel = (inp) => inp.label == null || inp.label === "" || inp.label === shortLabel(inp.name)
  || (inp.name === "fps" && inp.label === "fps");

/** The pairs a SAVED node had (configure's info): on an open, a paste or a
 *  Ctrl+Z the node keeps exactly those. Its wires are restored only AFTER
 *  configure (VC#19), so counting wires there would trim a wired pair. */
export function savedPairs(info) {
  const ins = Array.isArray(info?.inputs) ? info.inputs : null;
  if (!ins) return null;
  let n = 0;
  for (const i of ins) {
    const m = /^video_(\d+)$/.exec(i?.name || "");
    if (m) n = Math.max(n, Number(m[1]));
  }
  return n ? Math.max(MIN_PAIRS, Math.min(MAX_CLIPS, n)) : null;
}

/** On an open, a paste or a Ctrl+Z: drop the pairs core added beyond what was
 *  SAVED (always the trailing, unwired ones) straight from the array. Not
 *  removeInput: that re-registers EVERY wire of the node in the link store,
 *  which re-ordered the graph's links and its run order, so the next click
 *  recorded a change (an undo jam, measured: links 1..10 came back 6..10,3,1,2,4,5).
 *  Then the short labels. Nothing else. */
export function trimToSaved(node, saved) {
  if (!node?.inputs || !saved) return;
  const extra = (inp) => {
    const m = /^(video|audio)_(\d+)$/.exec(inp?.name || "");
    return !!m && Number(m[2]) > saved && inp.link == null;
  };
  for (let i = node.inputs.length - 1; i >= 0; i--) if (extra(node.inputs[i])) node.inputs.splice(i, 1);
  labelInputs(node);
}

function labelInputs(node) {
  for (const inp of node.inputs || []) {
    if (!inp) continue;
    const short = inp.name === "fps" ? "fps" : shortLabel(inp.name);
    if (short && isOurLabel(inp) && inp.label !== short) inp.label = short;
  }
}

/** Trim / add the clip pairs to `want` (default: the wired clips + 1), in
 *  order, and put the short labels on. Trailing pairs only, never one with a
 *  wire. localized_name on every slot it adds (VC#32). Diff-gated: an untouched
 *  node is left exactly as it is. */
export function syncInputs(node, want = pairsWanted(node)) {
  if (!node) return;
  if (!node.inputs) node.inputs = [];
  want = Math.max(want, lastWiredClip(node));
  for (let k = MAX_CLIPS; k > want; k--) {
    for (const kind of ["a", "v"]) {
      const i = findInput(node, NAME(kind, k));
      if (i >= 0 && node.inputs[i].link == null) node.removeInput(i);
    }
  }
  // The same dot shape core gives the def's optional inputs (7, hollow): core
  // re-creates a slot with it on every open / undo, and a slot added without it
  // reopened different (an undo jam, measured: `.inputs.6.shape null -> 7`).
  const shape = node.inputs.find((i) => i && /^video_\d+$/.test(i.name) && i.shape != null)?.shape ?? 7;
  for (let k = 1; k <= want; k++) {
    for (const kind of ["v", "a"]) {
      const nm = NAME(kind, k);
      if (findInput(node, nm) < 0) node.addInput(nm, TYPE(kind), { localized_name: nm, shape });
    }
  }
  labelInputs(node);
  node.setDirtyCanvas?.(true, true);
}

// ── where the face starts ────────────────────────────────────────────────────
/** litegraph's own field for custom slot layouts, not serialized; set in BOTH
 *  renderers (Nodes 2.0 ignores it, and core's computeSize then takes the larger
 *  of slot rows and widgets instead of their sum: VC#33). */
export function liftClassic(node) {
  node.widgets_start_y = CLASSIC_START_Y;
}

function slotBlockOf(node) {
  const root = node?._pixVdtFace?.root;
  const el = root?.closest?.(".lg-node");
  if (!el || !el.contains(root)) return null;
  const slot = el.querySelector(".lg-slot--output");
  return slot?.parentElement?.parentElement || null;
}

/** Nodes 2.0: pull the slot block up so the face starts under the 5th output
 *  row; the input column runs on down the face's left gutter. Stamped with the
 *  block height: a new pair (a taller block) or a re-render re-lifts. */
export function liftVue(node) {
  if (!isVueNodes()) return false;
  try {
    const block = slotBlockOf(node);
    if (!block) return false;
    const h = block.offsetHeight;
    if (!h || block.dataset.pixVdtLift === String(h)) return false;
    const outs = block.querySelectorAll(".lg-slot--output");
    const last = outs[Math.min(OUT_ROWS, outs.length) - 1];
    const b = block.getBoundingClientRect();
    const r = last.getBoundingClientRect();
    if (!b.height) return false;
    const keep = Math.round((r.bottom - b.top) * (h / b.height));
    block.style.marginBottom = `${-Math.max(0, h - keep)}px`;
    block.dataset.pixVdtLift = String(h);
    return true;
  } catch {
    return false;   // a future frontend: the dots stay above the face, still works
  }
}

export function settleLift(node) {
  if (!isVueNodes()) return;
  const once = () => liftVue(node);
  try { requestAnimationFrame(once); } catch { once(); }
  for (const ms of [0, 16, 48, 120, 300, 700]) setTimeout(once, ms);
}

export function watchLift(node) {
  if (node._pixVdtLiftPoll) return;
  node._pixVdtLiftPoll = setInterval(() => {
    if (!node.graph) { unwatchLift(node); return; }
    liftVue(node);
  }, 350);
}

export function unwatchLift(node) {
  if (node._pixVdtLiftPoll) clearInterval(node._pixVdtLiftPoll);
  node._pixVdtLiftPoll = null;
}

// ── size ─────────────────────────────────────────────────────────────────────
/** The face's content height with the stage at its smallest: every other part
 *  measured (the Join / Loop rows wrap at narrow widths), the stage at
 *  STAGE_MIN. Null until laid out (UI#39). */
export function contentMin(node) {
  const inner = node?._pixVdtFace?.inner;
  if (!inner?.isConnected || inner.offsetWidth < 100) return null;
  const cs = getComputedStyle(inner);
  const gap = parseFloat(cs.rowGap || cs.gap) || 0;
  let h = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  let count = 0;
  for (const c of inner.children) {
    if (c.offsetParent === null) continue;
    h += c.classList.contains("pix-vdt-stage") ? STAGE_MIN : c.offsetHeight;
    count += 1;
  }
  return Math.ceil(h + gap * Math.max(0, count - 1));
}

function frameBodyHeight(node) {
  if (!isVueNodes()) return node.size[1];
  const root = node._pixVdtFace?.root;
  const frame = root?.closest?.(".lg-node");
  if (!frame || !frame.contains(root)) return 0;
  const scale = Number(app.canvas?.ds?.scale) || 1;
  return frame.getBoundingClientRect().height / scale - 30;
}

function chrome(node) {
  const f = node._pixVdtFace;
  if (isVueNodes()) {
    const h = frameBodyHeight(node);
    if (h && f?.root?.offsetHeight > 0) return h - f.root.offsetHeight;
    return VUE_CHROME;
  }
  const w = f?.widget;
  const y = Number.isFinite(w?.y) && w.y > 0 ? w.y : CLASSIC_START_Y;
  const margin = Number.isFinite(w?.margin) ? w.margin : CLASSIC_MARGIN;
  return y + 2 * margin;
}

/** The smallest node.size[1] that shows every row, or null before layout. */
export function nodeFloor(node) {
  const c = contentMin(node);
  return c == null ? null : Math.ceil(chrome(node) + c);
}

/** A fresh node: two clip rows and the picture at 268 px, in the renderer it
 *  is born in (measured at 560 wide: everything but the picture is 258 px). */
export function defaultHeight() {
  return (isVueNodes() ? VUE_CHROME : CLASSIC_START_Y + 2 * CLASSIC_MARGIN) + 258 + 268;
}

/** A pair added or removed (a user action): one clip row more or less, so the
 *  picture keeps its size. Taken BEFORE the change (core's addInput resizes the
 *  node mid-change: VC#33). */
export function sizeBefore(node) {
  return { pairs: pairsShown(node), h: frameBodyHeight(node) || node.size?.[1] || 0 };
}

export function fitAfterPairs(node, before) {
  if (!node?.size || !before?.h || isGraphLoading()) return;
  const d = pairsShown(node) - before.pairs;
  if (!d) return;
  node.setSize?.([node.size[0], Math.round(before.h + d * ROW_STEP)]);
  node.setDirtyCanvas?.(true, true);
}

/** Nodes 2.0, after a corner drag (the floor is pinned only at the press). */
export function growToFloor(node) {
  if (!node?.graph || isGraphLoading()) return;
  const floor = nodeFloor(node);
  const h = frameBodyHeight(node) || node.size[1];
  if (floor != null && h < floor - 0.5) node.setSize?.([node.size[0], floor]);
}
