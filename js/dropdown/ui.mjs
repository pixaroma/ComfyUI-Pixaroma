// Dropdown Pixaroma - the node face (one DOM row) and the output-dot alignment
// that puts the dot ON that row in BOTH renderers.
//
// A DOM widget renders in both renderers, so one row implementation serves each.
// Getting the dot onto the row is two entirely separate mechanisms:
//
//   CLASSIC    LiteGraph honours a hard-coded `output.pos` (getConnectionPos
//              returns node.pos + slot.pos verbatim) and skips positioned
//              outputs in its auto-stacker, so we park the dot at the row's Y.
//
//   NODES 2.0  There is NO official way to move an output - NodeSlots.vue
//              renders every output in the top-right column and there is no
//              output equivalent of the widget-socket model that inputs have.
//              So we NUDGE the DOM. Cosmetic and wrapped in try/catch: if a
//              future frontend defeats it, the dot simply returns to the corner
//              and the node keeps working.
//
// Both are lifted from Control Panel (js/sliders/ui.mjs), which is the only
// other node in the pack doing this. Every trap it documents applies here.

import { app } from "../../../scripts/app.js";
import { pixAsset } from "../shared/api_url.mjs";
import { isVueNodes, applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { placeZoomedPopup } from "../shared/popup_zoom.mjs";
import { removeNodeWidget } from "../shared/remove_widget.mjs";
import { installNodeAccent, accentOf, ACC } from "../shared/node_settings.mjs";
import {
  ROW_H, MIN_W, BODY_PAD, readState, writeState, shownIndex, MODE_LETTERS, MODE_LABELS, MODES,
  valuesOf,
} from "./core.mjs";
import { SOCKET_LABELS, previewText, readable } from "./coerce.mjs";

// What Classic inserts above the row: node.widgets_start_y (2, set in index.js)
// plus BaseDOMWidgetImpl.DEFAULT_MARGIN (10). Read the margin off the live
// widget where it matters (alignOutputLegacy); this constant is only for
// reserving the matching space below.
const TOP_INSET = 12;

// MEASURED, not assumed: Classic stacks widgets 30px apart, not ROW_H - it adds
// a 4px gap between them (five rows landed at y = 2, 32, 62, 92, 122). Counting
// ROW_H per row under-counted the body by 4px each and the last value row was
// clipped by the node frame. Nodes 2.0 spaces its widget rows by the same 30.
const ROW_PITCH = 30;
// The Nodes 2.0 body height with no value rows, measured on the rendered node.
// Its chrome differs from Classic's, so it gets its own number rather than
// being assembled from ROW_H + BODY_PAD.
const VUE_BASE = 68;
// Shaved off the bottom once there ARE value rows. The 12px the base carries
// reads right under a single row but a touch loose under a stack of them, so a
// multi-output node sits on 8. User's call, by eye, on the rendered node.
// Applies to the value-row case ONLY - a one-output Dropdown keeps its 12.
const MULTI_TRIM = 4;

const ROW_CLASS = "pix-dd-row";
// One read-only row per output, shown only when the node has more than one.
const VROW_CLASS = "pix-dd-vrow";
const WIDGET_NAME = "dropdown_ui";
// Namespaced so a future frontend cannot start claiming the type name and
// render its OWN widget instead of our element (the Show Text bug).
const WIDGET_TYPE = "pixaroma_dropdown";

let _cssDone = false;

export function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const css = `
  .${ROW_CLASS}{
    /* DEFINITE height, never 100%. The Nodes 2.0 widget row is a min-content
       grid track, so a row whose height is not definite collapses (measured: a
       2px row). Legacy hides the bug by setting an explicit element height. */
    height:${ROW_H}px; min-height:${ROW_H}px; box-sizing:border-box;
    display:flex; align-items:center; gap:5px;
    font:12px 'Segoe UI',sans-serif; user-select:none;
    /* The output dot sits on the node's right EDGE, which is already outboard
       of this row (Classic insets a DOM widget by widget.margin). Reserving
       another 16px here put a visible hole between the type word and the dot. */
    padding-right:2px;
  }
  /* A value row is a READ-ONLY readout, so it deliberately does NOT wear the
     sunken #1d1d1d field surface the picker uses - in this pack that surface
     means "you can type here" (node UI convention #3). A raised translucent
     panel reads as "look only", and being translucent it still adapts to a
     recoloured node (convention #1). */
  .${VROW_CLASS}{
    height:${ROW_H}px; min-height:${ROW_H}px; box-sizing:border-box;
    display:flex; align-items:center; gap:5px; padding-right:2px;
    font:12px 'Segoe UI',sans-serif; user-select:none;
  }
  .pix-dd-vbox{
    flex:1 1 auto; min-width:0; height:${ROW_H - 6}px; box-sizing:border-box;
    display:flex; align-items:center; gap:6px;
    background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.12);
    border-radius:4px; padding:0 6px; cursor:default;
  }
  .pix-dd-vname{ flex:none; color:${ACC}; font-size:11px; opacity:.92; white-space:nowrap; }
  .pix-dd-vval{
    flex:1 1 auto; min-width:0; text-align:right; color:#ddd;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }
  .pix-dd-vval.empty{ color:#888; font-style:italic; }
  /* Same warning colour the settings panel uses for a value that will not read
     as its type - a row silently sending the fallback must not look identical
     to a working one. */
  .pix-dd-vval.bad{ color:#e0855f; }

  .pix-dd-arrow{
    flex:none; width:13px; text-align:center; cursor:pointer;
    color:${ACC}; font-size:10px; line-height:1; background:none; border:none; padding:0;
  }
  .pix-dd-arrow:hover{ filter:brightness(1.35); }
  .pix-dd-arrow.dim{ opacity:.28; cursor:default; }
  .pix-dd-arrow.dim:hover{ filter:none; }

  .pix-dd-field{
    flex:1 1 auto; min-width:0; height:${ROW_H - 4}px; box-sizing:border-box;
    display:flex; align-items:center; justify-content:space-between; gap:5px;
    background:#1d1d1d; border:1px solid #444; border-radius:4px;
    padding:0 6px; cursor:pointer;
  }
  .pix-dd-field:hover{ border-color:${ACC}; }
  .pix-dd-field.open{ border-color:${ACC}; }
  .pix-dd-name{
    /* 12px, matching Show Text's readout and the native node widgets. At 11px
       this row read visibly smaller than every node beside it. */
    flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; color:#ddd; font-size:12px;
  }
  .pix-dd-name.empty{ color:#777; font-style:italic; }
  .pix-dd-caret{ flex:none; color:${ACC}; font-size:8px; }

  /* The bundled gear SVG as a mask, so it matches the ⚙ on the node selection
     toolbar instead of being an emoji that renders differently per platform. */
  .pix-dd-gear{
    flex:none; width:14px; height:14px; padding:0; margin:0;
    background:none; border:none; cursor:pointer; line-height:0;
  }
  .pix-dd-gear::before{
    content:""; display:block; width:100%; height:100%; background:#aaa;
    -webkit-mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
    mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
  }
  .pix-dd-gear:hover::before{ background:${ACC}; }

  /* Always shown, and clickable: it cycles F -> I -> R. Fixed is the quiet
     default so a normal node is not shouting an orange badge; the two modes
     that will change the value on you are filled, because a node that sends
     something different on the next Run has to say so. */
  .pix-dd-mode{
    flex:none; width:16px; height:16px; padding:0; box-sizing:border-box;
    display:flex; align-items:center; justify-content:center;
    border-radius:3px; border:1px solid #4a4a4a; background:none; color:#999;
    font:11px 'Segoe UI',sans-serif; cursor:pointer; line-height:1;
  }
  .pix-dd-mode:hover{ border-color:${ACC}; color:#ddd; }
  .pix-dd-mode.on{ background:${ACC}; border-color:${ACC}; color:#fff; }
  .pix-dd-mode.on:hover{ filter:brightness(1.12); color:#fff; }

  .pix-dd-type{
    flex:none; color:${ACC}; font-size:11px; letter-spacing:.02em;
    max-width:50px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }

  /* ── The option popup (lives on document.body, outside the node) ────────── */
  /* Inner sizes and paddings are em ON PURPOSE: openPopup sets the root
     font-size from the canvas zoom, and em lets that one number scale the
     rows, gaps and padding together. Do not put px back on the rows. */
  .pix-dd-pop{
    position:fixed; z-index:1200; box-sizing:border-box;
    background:#1d1d1d; border:1px solid #555; border-radius:6px; padding:.35em;
    max-height:320px; overflow-y:auto; overflow-x:hidden;
    font:12px 'Segoe UI',sans-serif; box-shadow:0 6px 20px rgba(0,0,0,.45);
  }
  .pix-dd-opt{
    display:flex; align-items:baseline; gap:.85em;
    padding:.5em .75em; border-radius:4px; cursor:pointer;
  }
  .pix-dd-opt:hover{ background:#2a2a2a; }
  .pix-dd-opt.sel{ background:${ACC}; }
  .pix-dd-oname{
    /* The NAME wins the row: it shows in full and the value peek takes what is
       left. It was capped at 45%, which cut "summer background" to "summer
       bac..." while the peek kept space the name needed. A name longer than
       the whole popup still ellipsizes - the popup opens at the field's width,
       so widening the NODE is how you give a long name more room. */
    flex:none; max-width:100%; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; color:#ddd; font-size:1em;
  }
  .pix-dd-opt.sel .pix-dd-oname{ color:#fff; }
  /* The warning suffix on a row whose value does not read as the type. */
  .pix-dd-obad{ flex:none; color:#e0703a; font-size:.9em; }
  .pix-dd-opt.sel .pix-dd-obad{ color:#fff; }
  .pix-dd-pop-empty{ padding:.7em .85em; color:#777; font-size:.92em; font-style:italic; }

  /* ── Nodes 2.0 only ─────────────────────────────────────────────────────
     Every widget row reserves a 12px column for a widget-INPUT dot. This node
     has no inputs, so collapse it or the row is indented by 12px for nothing. */
  .lg-node:has(.${ROW_CLASS}) .lg-node-widget > div:first-child{
    width:0 !important; min-width:0 !important; overflow:hidden !important;
  }
  /* The moved output slot must paint no label (our row already shows the type)
     and must not swallow pointer events over the row - only its dot may. */
  .lg-node:has(.${ROW_CLASS}) .lg-slot--output{ padding-left:0 !important; pointer-events:none; }
  .lg-node:has(.${ROW_CLASS}) .lg-slot--output > div:first-child{ display:none !important; }
  .lg-node:has(.${ROW_CLASS}) .lg-slot--output [data-testid="slot-connection-dot"]{ pointer-events:auto; }
  `;
  const tag = document.createElement("style");
  tag.id = "pix-dd-css";
  tag.textContent = css;
  document.head.appendChild(tag);
}

/**
 * The node body height. One row, but the two renderers inset it differently.
 *
 * CLASSIC puts the row at `widgets_start_y + widget.margin` from the top (2 + 10
 * here), so the body has to reserve the same again underneath or the row sits
 * visibly high in the node - measured 12px of space above and 2px below before
 * this was matched.
 *
 * NODES 2.0 applies no such margin; its own chrome is added at the call site.
 */
export function bodyHeight(node) {
  const extra = node?._pixDdVRows?.length || 0;
  // Nodes 2.0 wraps the rows in its own chrome, so the base is MEASURED rather
  // than assembled from ROW_H and BODY_PAD: a node with no value rows settles
  // at 68, and each value row adds exactly one pitch (68 / 128 / 158 / 188 for
  // 0 / 2 / 3 / 4 rows, confirmed twice by independent measurement).
  //
  // This is computed, NOT read back from the rendered node, and that is the
  // whole point. The frame FOLLOWS node.size whenever node.size is the larger
  // of the two, so measuring it only ever hands back what the node already is -
  // a ratchet that grows and never shrinks, which is what left a node stuck
  // tall after going from four outputs down to one.
  if (isVueNodes()) return VUE_BASE + extra * ROW_PITCH;
  // One row per output on top of the picker row. The base already carries the
  // SAME 12px below the last row as it does above the first: a one-output node
  // is 50 tall with its row's element spanning 12..38, so 12 top and 12 bottom.
  // Adding a pitch per value row keeps that bottom breathing space instead of
  // ending flush against the frame - which the user spotted as "cut too abrupt"
  // when the height was derived to land exactly on the last row's edge.
  //
  // Called with no node in a couple of places that predate multi-output, and
  // with no value rows for every plain one-output Dropdown; BOTH still get the
  // historic height byte-for-byte, because extra is 0 there.
  return TOP_INSET * 2 + ROW_H + extra * ROW_PITCH - (extra ? MULTI_TRIM : 0);
}

// ── The row ────────────────────────────────────────────────────────────────

export function ensureRow(node) {
  if (node._pixDdRow?.isConnected) return node._pixDdRow;
  // Fall back to the held element even when it is not connected yet: the first
  // render runs before the element is in the DOM, and bailing here would leave
  // the body permanently empty (the Sizes bug).
  return node._pixDdRow || null;
}

export function buildRow(node, onOpenSettings) {
  injectCSS();

  const row = document.createElement("div");
  row.className = ROW_CLASS;

  const prev = document.createElement("button");
  prev.className = "pix-dd-arrow pix-dd-prev";
  prev.textContent = "◀";
  prev.title = "Previous entry";

  const field = document.createElement("div");
  field.className = "pix-dd-field";
  field.title = "Click to choose from your list";
  const name = document.createElement("span");
  name.className = "pix-dd-name";
  const caret = document.createElement("span");
  caret.className = "pix-dd-caret";
  caret.textContent = "▼";
  field.append(name, caret);

  const next = document.createElement("button");
  next.className = "pix-dd-arrow pix-dd-next";
  next.textContent = "▶";
  next.title = "Next entry";

  const gear = document.createElement("button");
  gear.className = "pix-dd-gear";
  gear.title = "Edit the list and what it sends out";

  const mode = document.createElement("button");
  mode.className = "pix-dd-mode";

  const type = document.createElement("span");
  type.className = "pix-dd-type";

  // Order: step arrows, the list, the run-mode badge, then settings, then the
  // type word beside its dot. The gear sits after the badge by request.
  row.append(prev, field, next, mode, gear, type);

  node._pixDdRow = row;
  node._pixDdParts = { prev, field, name, next, gear, mode, type };

  // ONE delegated listener. Every branch stops propagation so the click does
  // not reach the canvas and start a node drag.
  row.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const t = e.target;
    if (t.closest(".pix-dd-prev")) { e.stopPropagation(); step(node, -1); return; }
    if (t.closest(".pix-dd-next")) { e.stopPropagation(); step(node, +1); return; }
    // The gear closes the popup itself. Only the FIELD is exempt from the
    // outside-click handler, so nothing else would.
    if (t.closest(".pix-dd-gear")) { e.stopPropagation(); closePopup(); onOpenSettings?.(node); return; }
    if (t.closest(".pix-dd-mode")) { e.stopPropagation(); cycleMode(node); return; }
    if (t.closest(".pix-dd-field")) {
      e.stopPropagation();
      // An empty list has nothing to show, so send the user where they can fix
      // that instead of opening a popup that says nothing.
      if (!readState(node).options.length) onOpenSettings?.(node);
      else togglePopup(node);
    }
  });

  const w = node.addDOMWidget(WIDGET_NAME, WIDGET_TYPE, row, {
    serialize: false,                       // keeps it out of the API prompt
    getValue: () => "",
    setValue: () => {},
  });
  if (w) {
    // A DIFFERENT flag from options.serialize above: this one keeps the widget
    // out of the SAVED WORKFLOW, so the file does not gain a widgets_values slot.
    w.serialize = false;
    // Fixes the height in legacy.
    w.computeSize = () => [node.size?.[0] || MIN_W, ROW_H];
    // Own-property shadow of the DOMWidget prototype method. With it defined the
    // row becomes an 'auto' grid track in Nodes 2.0 and eats the node's spare
    // height instead of hugging its content.
    w.computeLayoutSize = undefined;
    applyAdaptiveCanvasOnly(w);
    node._pixDdWidget = w;
  }

  // Without this the wheel over the row stops zooming the canvas in Classic.
  installCanvasZoomPassthrough(row);
  installNodeAccent(node, row);

  return row;
}

/** Repaint the row from state. DOM only - never touches serialized node state. */
export function renderRow(node) {
  const parts = node._pixDdParts;
  if (!parts) return;
  const st = readState(node);
  // The pick that is queued or last ran, not blindly the stored one: in Random
  // or In-order the node would otherwise keep showing an entry it is not going
  // to send.
  const opt = st.options[shownIndex(node)];

  if (!st.options.length) {
    parts.name.textContent = "No options yet, press the gear";
    parts.name.classList.add("empty");
    parts.field.title = "Open the settings and add your first entry";
  } else {
    parts.name.textContent = opt?.name?.trim() || "(unnamed)";
    parts.name.classList.remove("empty");
    // Above one output this must list them ALL - "Sends: euler" on a node
    // that sends three things is simply untrue.
    parts.field.title = opt
      ? (st.outs.length > 1
        ? "Sends:\n" + st.outs.map((out, k) =>
            `  ${out.name}: ${previewText(valuesOf(opt, st.outs.length)[k], out.type)}`).join("\n")
        : `Sends: ${previewText(opt.value, st.type)}`)
      : "";
  }

  parts.mode.textContent = MODE_LETTERS[st.mode] || "F";
  parts.mode.title = `${MODE_LABELS[st.mode] || ""}\nClick to change`;
  parts.mode.classList.toggle("on", st.mode !== "fixed");

  // The chip names output 1's type. Above one output each value row carries its
  // own type, so saying "this node sends text" would be flatly wrong on a mixed
  // node - name the output it actually describes instead.
  parts.type.textContent = SOCKET_LABELS[st.type] || st.type;
  parts.type.title = st.outs.length > 1
    ? `${st.outs[0].name} sends ${SOCKET_LABELS[st.type]}. Each output has its own type, set in the settings.`
    : `This node sends ${SOCKET_LABELS[st.type]}. Change it in the settings.`;

  const many = st.options.length > 1;
  parts.prev.classList.toggle("dim", !many);
  parts.next.classList.toggle("dim", !many);

  // The value rows show what the picked entry will SEND, so they must never be
  // able to disagree with the picker above them. Repainting them from here -
  // rather than from each caller - is what guarantees it: the arrows, the mode
  // badge, the popup and the post-run commit all call renderRow and none of
  // them called renderValueRows, so picking B left the rows showing A's values
  // while the node sent B's. Visible on the first click a user makes.
  renderValueRows(node);
}

// ── Value rows (multi-output only) ─────────────────────────────────────────
//
// With one output the face is exactly what it has always been: the picker row,
// with the dot on it. Above one, the picker keeps the top row and each output
// gains a read-only row beneath showing `name: value`, with that output's dot
// on its own row. So a pick visibly resolves to the values it is about to send
// before anything runs, which is the whole point of holding a pair together.

function buildValueRow(node, idx) {
  injectCSS();
  const el = document.createElement("div");
  el.className = VROW_CLASS;
  const box = document.createElement("div");
  box.className = "pix-dd-vbox";
  const nm = document.createElement("span");
  nm.className = "pix-dd-vname";
  const vl = document.createElement("span");
  vl.className = "pix-dd-vval";
  box.append(nm, vl);
  el.appendChild(box);

  const w = node.addDOMWidget(`${WIDGET_NAME}_v${idx}`, WIDGET_TYPE, el, {
    serialize: false,
    getValue: () => "",
    setValue: () => {},
  });
  if (w) {
    w.serialize = false;                    // stays out of the saved workflow
    w.computeSize = () => [node.size?.[0] || MIN_W, ROW_H];
    w.computeLayoutSize = undefined;        // hug the content, do not grow
    applyAdaptiveCanvasOnly(w);
  }
  installCanvasZoomPassthrough(el);
  installNodeAccent(node, el);
  return { widget: w, el, name: nm, value: vl };
}

/**
 * Make the number of value rows match the number of outputs. Idempotent, so it
 * is safe to call on every render.
 *
 * A removed widget MUST have onRemove() called: ComfyUI's own widget store
 * re-mounts a DOM widget that was dropped without it, which is how Monitor
 * ended up with six orphaned faces after three renderer flips.
 */
export function syncValueRows(node) {
  const want = readState(node).outs.length;
  const rows = (node._pixDdVRows = node._pixDdVRows || []);
  const target = want > 1 ? want : 0;

  while (rows.length > target) {
    const r = rows.pop();
    // node.removeWidget: onRemove + splice + the 1.54 widget-store entry.
    removeNodeWidget(node, r.widget);
    r.el?.remove();
  }
  while (rows.length < target) rows.push(buildValueRow(node, rows.length));
  return rows;
}

/** Repaint the value rows. DOM only - never touches serialized node state. */
export function renderValueRows(node) {
  const rows = node._pixDdVRows;
  if (!rows || !rows.length) return;
  const st = readState(node);
  const opt = st.options[shownIndex(node)];
  const vals = valuesOf(opt, st.outs.length);

  rows.forEach((r, i) => {
    const o = st.outs[i];
    if (!o || !r) return;
    r.name.textContent = o.name;
    const raw = vals[i];
    const blank = raw === "";
    // NO free pass for blank. An empty box on a Whole number output really does
    // send 0, and the settings panel already says so - excusing it here was the
    // face and the panel telling two different stories about one value, and it
    // is the face you read while wiring. `readable("")` is TRUE for text, so an
    // empty text row stays quiet, which is correct: there the empty value IS
    // what gets sent.
    const ok = readable(raw, o.type);
    r.value.textContent = blank ? "(empty)" : previewText(raw, o.type);
    r.value.classList.toggle("empty", blank);
    r.value.classList.toggle("bad", !ok);
    r.el.title = ok
      ? `${o.name} sends ${blank ? "an empty value" : previewText(raw, o.type)}`
      : (blank
        ? `${o.name} is empty, so it sends ${previewText(raw, o.type)}`
        : `${o.name}: "${raw}" does not read as ${SOCKET_LABELS[o.type]}, so it sends the fallback`);
  });
}

/** Step the selection. Wraps, so a short list is quick to cycle. */
export function step(node, delta) {
  const st = readState(node);
  if (st.options.length < 2) return;
  const n = st.options.length;
  // Step from what the node is SHOWING. In Random or In-order that is the
  // queued/last-run pick, not the stored one, so the arrow moves from where the
  // user's eye is.
  writeState(node, { index: ((shownIndex(node) + delta) % n + n) % n });
  // A pick by hand wins over any sequence in flight, or the next Run would
  // ignore what was just chosen.
  node._pixDdPending = null;
  node._pixDdCursor = null;
  renderRow(node);
  closePopup();
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
}

/**
 * Cycle the run mode F -> I -> R -> F from the node face, so it can be changed
 * without opening the settings at all.
 *
 * Drops the held pick and the sequence position, exactly as the panel's buttons
 * do: switching mode should start from the entry the node is showing rather
 * than continuing a sequence the user has just abandoned.
 */
export function cycleMode(node) {
  const cur = readState(node).mode;
  const next = MODES[(Math.max(0, MODES.indexOf(cur)) + 1) % MODES.length];
  writeState(node, { mode: next });
  node._pixDdPending = null;
  node._pixDdCursor = null;
  renderRow(node);
  node.setDirtyCanvas?.(true, true);
  // No need to repaint the settings panel: the badge is OUTSIDE it, so the
  // panel's own outside-click guard has already closed it - the same as
  // clicking anywhere else on the node.
}

// ── The option popup ───────────────────────────────────────────────────────

let _pop = null;
let _popNode = null;

export function closePopup() {
  if (_pop) {
    _pop.remove();
    document.removeEventListener("pointerdown", _outsidePointer, true);
    document.removeEventListener("wheel", _outsideWheel, true);
    document.removeEventListener("keydown", _onKey, true);
  }
  _popNode?._pixDdParts?.field?.classList?.remove("open");
  _pop = null;
  _popNode = null;
}

export function closePopupFor(node) {
  if (_popNode === node) closePopup();
}

// A CLICK anywhere that is not the list itself or the field that owns it.
//
// Only the FIELD is exempt, NOT the whole row. This handler runs in the CAPTURE
// phase, so it fires before the row's own pointerdown: exempting the field is
// what lets a second click on it toggle the list shut instead of this closing it
// and the row handler instantly reopening it (which looked like the click doing
// nothing). Exempting the whole ROW went too far - the type label, the gaps
// between controls and the padding reserved for the output dot are all genuinely
// outside, and the row's handler has no branch for them, so clicking there left
// the list stuck open.
function _outsidePointer(e) {
  if (!_pop) return;
  if (_pop.contains(e.target)) return;
  if (_popNode?._pixDdParts?.field?.contains(e.target)) return;
  closePopup();
}

// A WHEEL anywhere that is not the list itself.
//
// Deliberately has NO field/row exemption. The popup is position:fixed and its
// coordinates are written once, from the field's rect, so anything that moves
// the canvas leaves it stranded beside a node that is no longer there. A wheel
// over the row zooms the canvas (the zoom passthrough), so the row must close it
// too - only scrolling the LIST is exempt, or the list could not be scrolled.
function _outsideWheel(e) {
  if (!_pop) return;
  if (_pop.contains(e.target)) return;
  closePopup();
}

function _onKey(e) {
  if (e.key === "Escape") { e.stopPropagation(); closePopup(); }
}

function togglePopup(node) {
  if (_popNode === node) { closePopup(); return; }
  openPopup(node);
}

export function openPopup(node) {
  closePopup();
  const parts = node._pixDdParts;
  if (!parts) return;
  const st = readState(node);

  const pop = document.createElement("div");
  pop.className = "pix-dd-pop";
  // The popup lives on document.body, outside the node, so it does not inherit
  // the node's accent variable - set it here or the selected row is orange when
  // the node is not.
  pop.style.setProperty("--pix-acc", accentOf(node));
  // The zoom-tracking font + grow-to-fit + placement all live in the shared
  // helper now (js/shared/popup_zoom.mjs, node UI convention #27) so every
  // other node's picker gets the same behaviour instead of re-deriving it. It
  // is applied AFTER the rows are in, at the placeZoomedPopup call below -
  // which is also where the measuring happens, so the order is right by
  // construction. This node's numbers were the original ones.

  if (!st.options.length) {
    const empty = document.createElement("div");
    empty.className = "pix-dd-pop-empty";
    empty.textContent = "Nothing in the list yet.";
    pop.appendChild(empty);
  } else {
    const shown = shownIndex(node);
    st.options.forEach((o, i) => {
      const item = document.createElement("div");
      // shownIndex, NOT st.index: in In-order or Random the face shows the
      // entry that is queued or last ran, and the list highlighting a
      // different one made the node look like it was ignoring the mode.
      // EVERY output, not just the first. With the check on `o.value`/`st.type`
      // alone, an entry whose SECOND value did not read as its type showed the
      // warning mark in the settings panel and on the node's value row, but sat
      // clean in this popup - three surfaces built together, one disagreeing.
      const vals = valuesOf(o, st.outs.length);
      const badAt = st.outs.findIndex((out, k) => !readable(vals[k], out.type));
      const ok = badAt === -1;
      item.className = "pix-dd-opt" + (i === shown ? " sel" : "") + (ok ? "" : " bad");
      const nm = document.createElement("span");
      nm.className = "pix-dd-oname";
      nm.textContent = o.name?.trim() || "(unnamed)";
      item.append(nm);
      // Names ONLY - the value peek was tried and removed the same day (user:
      // it complicated the list). The value is one hover away via the title
      // below, and always in the settings. A bad row keeps a mark though: an
      // entry silently sending the fallback must not look identical to one
      // that works.
      if (!ok) item.append(Object.assign(document.createElement("span"), {
        className: "pix-dd-obad", textContent: "⚠",
      }));
      // Above one output the title has to NAME the culprit, or it points at the
      // wrong value: "does not read as whole number" is useless on an entry
      // carrying four values of three different types.
      const multi = st.outs.length > 1;
      item.title = ok
        ? (multi ? st.outs.map((out, k) => `${out.name}: ${vals[k]}`).join("\n") : (o.value || ""))
        : (multi
          ? `${st.outs[badAt].name} does not read as ${SOCKET_LABELS[st.outs[badAt].type]}, `
            + `so it sends ${previewText(vals[badAt], st.outs[badAt].type)}.`
          : `Does not read as ${SOCKET_LABELS[st.type]}, so this one sends ${previewText(o.value, st.type)}.`);
      item.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        writeState(node, { index: i });
        // Same rule as the arrows: choosing by hand overrides a sequence.
        node._pixDdPending = null;
        node._pixDdCursor = null;
        renderRow(node);
        closePopup();
        node.setDirtyCanvas?.(true, true);
      });
      pop.appendChild(item);
    });
  }

  document.body.appendChild(pop);
  // Zoom font + grow-to-fit + on-screen placement, in the one order that works.
  // The field's width is the MINIMUM, not the width: with the zoom-scaled font
  // a popup locked to the field re-cut the very names pattern #1 freed. The
  // popup grows to fit its longest row, bounded by the viewport, and a grown
  // popup is clamped so it cannot poke past the window's right edge.
  placeZoomedPopup(pop, parts.field, {
    baseMaxHeightPx: 320,
    baseMaxWidthPx: 640,
    minWidthPx: 200,
  });

  parts.field.classList.add("open");
  _pop = pop;
  _popNode = node;

  // Deferred, or the click that opened it immediately closes it.
  setTimeout(() => {
    document.addEventListener("pointerdown", _outsidePointer, true);
    document.addEventListener("wheel", _outsideWheel, true);
    document.addEventListener("keydown", _onKey, true);
  }, 0);
}

// ── Output-dot alignment ───────────────────────────────────────────────────

/**
 * CLASSIC: park the dot at the row's Y.
 *
 * MIND THE MARGIN. Legacy insets a DOM widget's ELEMENT by widget.margin
 * (default 10): the element draws at node.pos + margin + widget.y while
 * widget.y carries NO margin. A dot at widget.y + ROW_H/2 therefore lands a
 * full 10px ABOVE the row's real centre - on a 26px row that is nearly its top
 * edge. Control Panel shipped exactly that bug and the user spotted it at once.
 * Nodes 2.0 has no such margin, which is why the same maths looks right there.
 */
export function alignOutputLegacy(node) {
  const nx = node.size?.[0];
  if (!Number.isFinite(nx)) return;

  const park = (out, w) => {
    if (!out || !w) return;
    const y = w.y;
    if (!Number.isFinite(y)) return;
    const margin = Number.isFinite(w.margin) ? w.margin : 10;
    const ny = y + margin + ROW_H * 0.5;
    const pos = out.pos;
    // Diff-gated: output.pos is serialized, and rewriting an identical value
    // still counts as a change on some builds (Vue Compat #18).
    if (!pos || pos[0] !== nx || Math.abs(pos[1] - ny) > 0.5) out.pos = [nx, ny];
  };

  const n = readState(node).outs.length;
  if (n <= 1) { park(node.outputs?.[0], node._pixDdWidget); return; }
  // Above one output the dots follow the VALUE rows, not the picker.
  const rows = node._pixDdVRows || [];
  for (let i = 0; i < n; i++) park(node.outputs?.[i], rows[i]?.widget);
}

function isAligned(rowEl, dot) {
  const rr = rowEl.getBoundingClientRect();
  const dd = dot.getBoundingClientRect();
  return Math.abs((rr.top + rr.height / 2) - (dd.top + dd.height / 2)) < 1;
}

/**
 * NODES 2.0: the nudge. Pull the slots block out of the flow so it stops
 * pushing the row down, then translate the dot onto the row.
 *
 * ORDER MATTERS: sizing the slot changes the block's height, so the block must
 * be measured AFTER. Measuring first pulls up by one slot-row too little and
 * the dot sits mysteriously high - a bug Control Panel chased for rounds.
 */
export function alignOutput(node) {
  if (!isVueNodes()) return;
  try {
    const el = document.querySelector(`.lg-node[data-node-id="${node.id}"]`);
    if (!el) return;
    // Above one output the dots ride the VALUE rows; at one, the picker row.
    const n = readState(node).outs.length;
    const rowEls = n > 1
      ? Array.from(el.querySelectorAll(`.${VROW_CLASS}`))
      : [el.querySelector(`.${ROW_CLASS}`)].filter(Boolean);
    const rowEl = rowEls[0];
    const outs = el.querySelectorAll(".lg-slot--output");
    if (!rowEl || !outs.length) return;
    // Vue can render a newly added row a frame after the slots; aligning
    // against a half-built body bakes in a wrong offset the poll would then
    // early-return on. Wait for the counts to agree.
    if (n > 1 && (rowEls.length < n || outs.length < n)) return;
    if (isAligned(rowEl, outs[0])) return;

    const col = outs[0].parentElement;
    const block = col?.parentElement;
    if (!col || !block) return;

    // Reset first: every measurement below must be taken against the natural
    // layout, not against a previous nudge, or the correction compounds.
    block.style.marginBottom = "0px";
    col.style.transform = "none";
    col.style.gap = "0px";
    block.style.pointerEvents = "none";
    col.style.pointerEvents = "auto";

    // The styles we write are LAYOUT px; getBoundingClientRect returns SCREEN px
    // because the node is CSS-scaled by the graph zoom. Measure the ratio off an
    // element whose layout height we already know rather than trusting ds.scale -
    // correct at any zoom, however the zoom happens to be applied.
    const rowH = rowEl.offsetHeight || ROW_H;
    const toLayout = rowH / (rowEl.getBoundingClientRect().height || rowH);

    // The gap between consecutive value rows, measured rather than assumed:
    // Nodes 2.0 puts its own spacing between widget rows, so a dot pitch of
    // rowH alone would drift further out of line with every extra output.
    const pitch = rowEls[1]
      ? Math.max(rowH, (rowEls[1].getBoundingClientRect().top
                        - rowEls[0].getBoundingClientRect().top) * toLayout)
      : rowH;

    // STEP ONE: size each dot's slot to one row and space it by the row pitch.
    // Changes the block's height, which is why it must come before the measure.
    for (const o of outs) {
      o.style.height = rowH + "px";
      o.style.minHeight = rowH + "px";
      o.style.marginBottom = (pitch - rowH) + "px";
    }
    // STEP TWO: take the now-correctly-sized block out of the flow.
    block.style.marginBottom = (-block.offsetHeight) + "px";
    // STEP THREE: drop the dot onto the row.
    const delta =
      (rowEl.getBoundingClientRect().top - outs[0].getBoundingClientRect().top) * toLayout;
    col.style.transform = `translateY(${delta}px)`;
  } catch {
    /* nudge failed - the dot stays in the corner and the node still works */
  }
}

/**
 * The row is not laid out yet on the frame the node is built, so measuring
 * straight away yields a stale offset that nothing would ever correct.
 */
export function scheduleAlign(node) {
  alignOutput(node);
  requestAnimationFrame(() => {
    alignOutput(node);
    setTimeout(() => alignOutput(node), 120);
  });
}

/**
 * A MutationObserver is not enough: Vue REPLACES the node element when it
 * re-renders, silently orphaning any observer bound to the old one. Hence a
 * self-healing poll, like the pack's other canvas features. alignOutput
 * early-returns when nothing has moved, so the steady-state cost is one rect
 * read every 350ms.
 */
export function watchAlign(node) {
  if (node._pixDdPoll) return;
  // Deliberately NOT gated on isVueNodes(). The renderer can be switched while
  // the node already exists, and that switch does not re-run onNodeCreated or
  // onConfigure - so a node built in Classic and then switched to Nodes 2.0 was
  // left with no aligner at all and its dot stayed in the corner forever
  // (observed, not theorised). alignOutput early-returns in Classic, so the
  // steady-state cost of running the poll either way is one boolean check.
  node._pixDdPoll = setInterval(() => {
    if (!node.graph) { unwatchAlign(node); return; }
    alignOutput(node);
  }, 350);
  scheduleAlign(node);
}

export function unwatchAlign(node) {
  if (node._pixDdPoll) clearInterval(node._pixDdPoll);
  node._pixDdPoll = null;
}
