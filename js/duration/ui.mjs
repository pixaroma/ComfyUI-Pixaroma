// Duration Pixaroma - the node face.
//
// One DOM widget, so a single implementation serves both renderers. Two rows:
// the picker (chips, slider or a number box, whichever the settings say) and a
// readout that always states what will be SENT, because snapping to the model's
// pattern changes the length and that must never be hidden.

import { pixAsset } from "../shared/api_url.mjs";
import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/nodes2.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { installNodeAccent, ACC } from "../shared/node_settings.mjs";
import { passComfyShortcut } from "../shared/text_shortcuts.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import {
  ROW_H, READOUT_H, BODY_PAD, PICK_CHIPS, PICK_SLIDER,
  readState, writeState, clampToPick,
} from "./core.mjs";
import { computeLocal } from "./compute.mjs";
import { previewCustom } from "./api.mjs";

const ROOT_CLASS = "pix-dur-root";
const WIDGET_NAME = "duration_ui";
// Namespaced so a future frontend cannot claim the type name and render its own
// widget instead of our element (the Show Text bug).
const WIDGET_TYPE = "pixaroma_duration";

let _cssDone = false;

// Classic stacks one 20px slot row per output ABOVE the widgets, and our two
// output labels are right-aligned - so the left half of that 40px band is dead
// space, and the body used to start 46px down with a visible gap. We lift the
// widget over the band (widgets_start_y in index.js) and put the READOUT there,
// reserving the right for the labels. Nodes 2.0 renders the dots in their own
// block, so it has no band to reclaim and keeps the plain stacked layout.
export const SLOT_BAND = 40;
// Room for the longest right-aligned output label plus its dot.
//
// DERIVED FROM A PIXEL SCAN of the drawn node, not from arithmetic - two
// guesses (92, then 74) both left a gap the user could see. Scanning the canvas
// for the first light pixel on each output row put "seconds" (the wider label)
// at node-x 264 on a 330-wide node, i.e. 66 in from the right edge.
//
// The picker's content edge lands at `nodeW - 16 - LABEL_RESERVE`, so
//     gap = LABEL_RESERVE - 50
// and it is INDEPENDENT of node width, because both the labels and our content
// are anchored to the right edge. 58 leaves 8px. Re-derive by re-scanning if the
// output names or the node font ever change.
export const LABEL_RESERVE = 58;
// Classic hands the DOM widget `node.size[1] - widgets_start_y - 2*margin`, so
// the node has to be that much taller than the content. Measured, not guessed.
const CLASSIC_CHROME = 22;

export function bodyHeight(vue = isVueNodes()) {
  const content = ROW_H + 4 + READOUT_H + BODY_PAD + 2;
  return vue ? ROW_H + READOUT_H + BODY_PAD * 2 + 6 : content + CLASSIC_CHROME;
}

export function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const css = `
  .${ROOT_CLASS}{
    box-sizing:border-box; display:flex; flex-direction:column; gap:4px;
    padding:${BODY_PAD}px; font:12px 'Segoe UI',sans-serif; user-select:none;
    /* Transparent, not a panel colour: an opaque root would cover the slot
       labels the node paints in the same band. */
    background:transparent;
  }
  /* Classic: the body is lifted over the output-slot band, and the PICKER takes
     the empty left half of it - putting the buttons themselves ~50px higher,
     which is the point. It reserves the right for the "frames" / "seconds"
     labels the node paints there. The readout then runs full width underneath,
     where it has room for the longer text. */
  .${ROOT_CLASS}.classic{ padding-top:2px; }
  .${ROOT_CLASS}.classic .pix-dur-pickrow{
    order:-1; padding-right:${LABEL_RESERVE}px;
  }
  /* The readout lands on the SECOND slot row, where "seconds" is painted, so it
     needs the same reserve - otherwise a long readout on a narrow node runs
     straight under the label. It already ellipsises, so it shortens instead. */
  .${ROOT_CLASS}.classic .pix-dur-readout{ padding-right:${LABEL_RESERVE}px; }
  .pix-dur-pickrow{ display:flex; align-items:center; gap:5px; min-height:${ROW_H}px; }

  /* NEVER wrap. Wrapping pushed a second row of buttons down into the readout
     and the two drew on top of each other as soon as the node was dragged
     narrow. The buttons shrink together instead, which is what someone
     deliberately making the node smaller is asking for; overflow:hidden is the
     backstop for a chip list long enough that even that runs out. */
  .pix-dur-chips{
    display:flex; gap:4px; flex:1 1 auto; min-width:0;
    flex-wrap:nowrap; overflow:hidden;
  }
  .pix-dur-chip{
    flex:1 1 auto; min-width:28px; box-sizing:border-box;
    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14);
    border-radius:4px; color:rgba(255,255,255,0.72); font-size:12px;
    padding:4px 6px; cursor:pointer; text-align:center; line-height:1.1;
  }
  .pix-dur-chip:hover{ border-color:${ACC}; color:#ddd; }
  .pix-dur-chip.on, .pix-dur-chip.on:hover{
    background:${ACC}; border-color:${ACC}; color:#fff;
  }

  .pix-dur-slider{
    flex:1 1 auto; min-width:0; height:${ROW_H - 4}px; box-sizing:border-box;
    position:relative; overflow:hidden; cursor:ew-resize;
    background:#1d1d1d; border:1px solid #444; border-radius:4px;
  }
  .pix-dur-slider:hover{ border-color:${ACC}; }
  .pix-dur-fill{ position:absolute; left:0; top:0; bottom:0; background:${ACC}; pointer-events:none; }
  .pix-dur-sval{
    position:absolute; inset:0; display:flex; align-items:center;
    justify-content:space-between; padding:0 7px; pointer-events:none;
    font-size:12px; color:#ddd;
  }
  .pix-dur-slabel{ color:rgba(255,255,255,0.75); }

  /* Type it: the field is the BOX, the input inside it is borderless, so the
     range can sit in the same field on the right (the Image Resize look). The
     range is shown because a value outside it snaps back, and without it the
     snap looked like a hard limit of 10 (Discord, 2026-10-30). */
  .pix-dur-numbox{
    flex:1 1 auto; min-width:0; height:${ROW_H - 4}px; box-sizing:border-box;
    display:flex; align-items:center; gap:6px; padding:0 7px; cursor:text;
    background:#1d1d1d; border:1px solid #444; border-radius:4px;
  }
  .pix-dur-numbox:focus-within{ border-color:${ACC}; }
  .pix-dur-num{
    flex:1 1 auto; min-width:0; height:100%; box-sizing:border-box;
    background:transparent; border:none; padding:0; outline:none;
    color:#ddd; font:12px 'Segoe UI',sans-serif;
  }
  .pix-dur-range{
    flex:none; font-size:11px; color:#8c8c8c; white-space:nowrap;
    pointer-events:none;
  }

  /* The bundled gear SVG as a mask, never the emoji: an emoji is drawn by the
     OS, so it is a different shape and baseline on every platform. */
  .pix-dur-gear{
    flex:none; width:16px; height:16px; padding:0; margin:0; line-height:0;
    background:none; border:none; cursor:pointer;
  }
  .pix-dur-gear::before{
    content:""; display:block; width:14px; height:14px; background:#bbb;
    -webkit-mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
    mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
  }
  .pix-dur-gear:hover::before{ background:${ACC}; }

  .pix-dur-readout{
    min-height:${READOUT_H}px; display:flex; align-items:center; gap:5px;
    font-size:11px; color:${ACC}; white-space:nowrap; overflow:hidden;
    text-overflow:ellipsis;
  }
  .pix-dur-readout .dim{ color:rgba(255,255,255,0.42); }
  .pix-dur-readout.bad{ color:#e8694a; }
  `;
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
}

/** Trim float dust for display: 5 -> "5", 5.5 -> "5.5", 5.1667 -> "5.17". */
function fmt(value, places = 2) {
  const rounded = Math.round(value * 10 ** places) / 10 ** places;
  return String(rounded);
}

export function buildFace(node, openPanel) {
  const root = document.createElement("div");
  root.className = ROOT_CLASS + (isVueNodes() ? "" : " classic");

  const pickRow = document.createElement("div");
  pickRow.className = "pix-dur-pickrow";
  const readout = document.createElement("div");
  readout.className = "pix-dur-readout";
  root.append(pickRow, readout);

  node._pixDurRoot = root;
  node._pixDurPickRow = pickRow;
  node._pixDurReadout = readout;
  node._pixDurOpenPanel = openPanel;

  const widget = node.addDOMWidget(WIDGET_NAME, WIDGET_TYPE, root, {
    serialize: false,
    getMinHeight: () => bodyHeight(),
  });
  // BOTH flags, they are not the same one: options.serialize keeps the widget
  // out of the PROMPT, widget.serialize (top level) keeps it out of the saved
  // WORKFLOW. With only the first, the node wrote widgets_values: [""] into
  // every saved file - state that means nothing and can differ between
  // renderers, which is how a clean workflow starts opening "modified".
  widget.serialize = false;
  // canvasOnly must be TRUE in Classic (keeps it out of the Parameters tab) and
  // FALSE in Nodes 2.0 (or the Vue body renders nothing) - hence the live getter.
  applyAdaptiveCanvasOnly(widget);
  // Without this the wheel stops zooming the canvas whenever the cursor is over
  // this node, because the DOM widget swallows it (convention #17).
  installCanvasZoomPassthrough(root);
  installNodeAccent(node, root);
  // Pins a content floor ONLY while a resize handle is dragged, so the rows
  // cannot be squashed out of the frame - and node.size is never written, so a
  // clean workflow cannot open "modified".
  node._pixDurFloorOff = installResizeFloor(root, () => bodyHeight());

  return widget;
}

function renderChips(node, st, pickRow) {
  const wrap = document.createElement("div");
  wrap.className = "pix-dur-chips";
  for (const v of st.values) {
    const b = document.createElement("button");
    b.className = "pix-dur-chip" + (Math.abs(v - st.seconds) < 1e-6 ? " on" : "");
    b.textContent = fmt(v) + "s";
    b.title = `Make the video ${fmt(v)} seconds long`;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      writeState(node, { seconds: v });
      renderFace(node);
    });
    wrap.appendChild(b);
  }
  pickRow.appendChild(wrap);
}

function renderSlider(node, st, pickRow) {
  const lo = Math.min(st.min, st.max);
  const hi = Math.max(st.min, st.max);
  const box = document.createElement("div");
  box.className = "pix-dur-slider";
  const frac = hi > lo ? (st.seconds - lo) / (hi - lo) : 0;
  const fill = document.createElement("div");
  fill.className = "pix-dur-fill";
  fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  const val = document.createElement("div");
  val.className = "pix-dur-sval";
  val.innerHTML = "";
  const lab = document.createElement("span");
  lab.className = "pix-dur-slabel";
  lab.textContent = "duration";
  const num = document.createElement("span");
  num.textContent = fmt(st.seconds) + " s";
  val.append(lab, num);
  box.append(fill, val);
  box.title = `Drag to set the length (${fmt(lo)} to ${fmt(hi)} seconds)`;

  // Update IN PLACE - never renderFace from here. renderFace rebuilds the row,
  // which would replace this very element under the user's finger: the drag
  // listeners and the pointer capture would go with it, so the slider moved
  // once on pointerdown and then stopped following the cursor.
  const setFromEvent = (ev) => {
    const r = box.getBoundingClientRect();
    if (r.width <= 0) return;
    const f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const next = clampToPick(readState(node), lo + f * (hi - lo));
    const st2 = writeState(node, { seconds: next });
    fill.style.width = `${Math.max(0, Math.min(1, hi > lo ? (next - lo) / (hi - lo) : 0)) * 100}%`;
    num.textContent = fmt(next) + " s";
    paintReadout(node, st2, node._pixDurReadout);
    node.setDirtyCanvas?.(true, false);
  };
  const end = () => {
    box.onpointermove = null;
    try { box.releasePointerCapture?.(box._pixCap); } catch {}
    box._pixCap = null;
  };
  box.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    // setPointerCapture AND the buttons guard (convention #20): without both, a
    // release that goes missing leaves the slider stuck to the cursor.
    box._pixCap = ev.pointerId;
    try { box.setPointerCapture(ev.pointerId); } catch {}
    setFromEvent(ev);
    box.onpointermove = (mv) => {
      if (!(mv.buttons & 1)) { end(); return; }
      setFromEvent(mv);
    };
  });
  box.addEventListener("pointerup", end);
  box.addEventListener("pointercancel", end);
  box.addEventListener("lostpointercapture", end);
  pickRow.appendChild(box);
}

function renderNumber(node, st, pickRow) {
  const lo = Math.min(st.min, st.max);
  const hi = Math.max(st.min, st.max);
  const box = document.createElement("div");
  box.className = "pix-dur-numbox";
  box.title = `Type the length in seconds, from ${fmt(lo)} to ${fmt(hi)}. Change the range with the gear.`;
  const input = document.createElement("input");
  input.className = "pix-dur-num";
  input.type = "text";
  input.value = fmt(st.seconds);
  input.setAttribute("aria-label", `Length in seconds, ${fmt(lo)} to ${fmt(hi)}`);
  const range = document.createElement("span");
  range.className = "pix-dur-range";
  range.textContent = `${fmt(lo)} to ${fmt(hi)} s`;
  box.append(input, range);
  box.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    // A click on the range text still lands in the field.
    if (e.target !== input) { e.preventDefault(); input.focus(); }
  });
  const commit = () => {
    const parsed = parseFloat(input.value);
    const next = Number.isFinite(parsed) ? clampToPick(readState(node), parsed) : readState(node).seconds;
    writeState(node, { seconds: next });
    renderFace(node);
    // Say WHY a value came back different, or it reads as a hard limit.
    if (Number.isFinite(parsed) && Math.abs(next - parsed) > 1e-6) {
      showNote(node, parsed > next
        ? `Max is ${fmt(next)} s: raise MAX in the gear`
        : `Min is ${fmt(next)} s: lower MIN in the gear`);
    }
  };
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (passComfyShortcut(e, input, { blur: true })) return;   // save / run after the commit (UI#44)
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
  });
  pickRow.appendChild(box);
}

// How long the snap-back note replaces the readout. Any other change to the
// node (the gear, a renderer flip) clears it sooner, through renderFace.
const NOTE_MS = 5000;

function showNote(node, text) {
  const readout = node?._pixDurReadout;
  if (!readout) return;
  clearTimeout(node._pixDurNoteTimer);
  node._pixDurNote = text;
  applyNote(node, readout);
  node._pixDurNoteTimer = setTimeout(() => {
    node._pixDurNoteTimer = 0;
    node._pixDurNote = null;
    if (node._pixDurReadout === readout) paintReadout(node, null, readout);
  }, NOTE_MS);
}

// DOM only, never node state: the note must not reach a saved workflow.
function applyNote(node, readout) {
  if (!node._pixDurNote) return;
  readout.className = "pix-dur-readout bad";
  readout.textContent = node._pixDurNote;
}

function clearNote(node) {
  clearTimeout(node._pixDurNoteTimer);
  node._pixDurNoteTimer = 0;
  node._pixDurNote = null;
}

export function renderFace(node) {
  const pickRow = node?._pixDurPickRow;
  const readout = node?._pixDurReadout;
  if (!pickRow || !readout) return;
  clearNote(node);
  // Re-asserted every render, not just at build: the renderer can be switched
  // while the node is on the canvas, and the two layouts are not interchangeable.
  node._pixDurRoot?.classList.toggle("classic", !isVueNodes());
  const st = readState(node);

  pickRow.textContent = "";
  if (st.pick === PICK_CHIPS) renderChips(node, st, pickRow);
  else if (st.pick === PICK_SLIDER) renderSlider(node, st, pickRow);
  else renderNumber(node, st, pickRow);

  const gear = document.createElement("button");
  gear.className = "pix-dur-gear";
  gear.title = "Duration settings";
  gear.addEventListener("click", (e) => {
    e.stopPropagation();
    node._pixDurOpenPanel?.(node);
  });
  pickRow.appendChild(gear);

  paintReadout(node, st, readout);
  node.setDirtyCanvas?.(true, false);
}

function writeReadout(readout, seconds, frames, actual, note) {
  readout.className = "pix-dur-readout";
  readout.textContent = "";
  const main = document.createElement("span");
  main.textContent = `${fmt(seconds)} s → ${frames} frames`;
  readout.appendChild(main);
  const dim = document.createElement("span");
  dim.className = "dim";
  // Only mention the true length when snapping actually MOVED it; saying
  // "(5 s)" after "5 s" is noise.
  dim.textContent = note || (Math.abs(actual - seconds) > 0.005 ? `(really ${fmt(actual)} s)` : "");
  if (dim.textContent) readout.appendChild(dim);
}

/**
 * Publish the length this node will really send, for any node downstream that
 * wants to show it BEFORE a run (Load Audio sizes its selection from this).
 *
 * A plain runtime field, defined non-enumerable so no serializer can pick it up
 * and dirty a saved workflow (Vue Compat #18). It is a courtesy, not a
 * contract: a reader must cope with it being absent, because it only exists
 * once this node has painted at least once.
 */
function publishSeconds(node, actual) {
  if (!node || !Number.isFinite(actual)) return;
  try {
    if (!Object.prototype.hasOwnProperty.call(node, "_pixLiveSeconds")) {
      Object.defineProperty(node, "_pixLiveSeconds",
        { value: actual, writable: true, enumerable: false, configurable: true });
    } else {
      node._pixLiveSeconds = actual;
    }
  } catch (_e) { /* a frozen node is not worth failing a paint over */ }
}

export function paintReadout(node, st, readout) {
  const local = computeLocal(st || readState(node));
  const state = st || readState(node);
  if (!local.custom) {
    publishSeconds(node, local.actual);
    writeReadout(readout, state.seconds, local.frames, local.actual);
    applyNote(node, readout);
    return;
  }
  // A custom formula is evaluated by PYTHON, never re-implemented here - a
  // second expression language would agree with the real one right up until it
  // did not, and a confidently wrong number is worse than a pending one.
  readout.className = "pix-dur-readout";
  readout.textContent = `${fmt(state.seconds)} s → working it out...`;
  previewCustom(node, state).then((res) => {
    const live = node._pixDurReadout;
    if (!live || live !== readout) return;   // node re-rendered or went away
    if (!res || !res.ok) {
      readout.className = "pix-dur-readout bad";
      readout.textContent = `${fmt(state.seconds)} s → formula does not work, using ${res?.frames ?? local.frames} frames`;
      applyNote(node, readout);
      return;
    }
    publishSeconds(node, res.actual);
    writeReadout(readout, state.seconds, res.frames, res.actual);
    // The answer can arrive while a snap-back note is up: keep the note.
    applyNote(node, readout);
  });
}

export function destroyFace(node) {
  clearNote(node);
  try { node._pixDurFloorOff?.(); } catch {}
  node._pixDurFloorOff = null;
  node._pixDurRoot = null;
  node._pixDurPickRow = null;
  node._pixDurReadout = null;
}
