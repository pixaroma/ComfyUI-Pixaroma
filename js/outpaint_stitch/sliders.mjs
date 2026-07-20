// Outpaint Stitch Pixaroma - the slider face. Two recess-style sliders (Feather,
// Color Match) matching Sliders Pixaroma's look, bound to the node's native INT
// widgets, EACH with a real input dot ON ITS ROW so a number node can be wired in.
//
// One DOM widget PER slider (needed so each input's dot lands on its own row):
//   NODES 2.0  the widget-socket model (js/switch/vue_list.mjs): input.widget =
//              {name: rowWidget} moves the real dot onto the row.
//   LEGACY     the Sliders output-dot recipe mirrored for inputs
//              (.claude/patterns/sliders.md): the widget marker is REMOVED (so the
//              dot draws), input.pos parks it on the row, widgets_start_y pins the
//              rows, and computeSize owns the height so no slot row is reserved.
// The value always flows through the native hidden widget + a graphToPrompt inject
// (index.js), so the dot gymnastics never touch the number that reaches Python.

import { app } from "/scripts/app.js";
import { widgetOf, accentOf } from "./core.mjs";
import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/nodes2.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";

export const ROW_H = 23;
export const ROW_GAP = 6;
export const PAD = 5;
export const MIN_W = 210;
export const DEFAULT_W = 274;
export const ZW = "​";          // zero-width space: suppress the slot label paint
const DOT_X = 10;                    // legacy input-dot x (matches image/outpaint_info)
const LEFT_INSET = 15;               // legacy: room on the row's left for the dot

const WIDGET_TYPE = "pixaroma_ops_row";

// Each slider drives one native INT widget + one input of the same name.
const SLIDERS = [
  { name: "feather", label: "Feather", min: 0, max: 1024 },
  { name: "color_match", label: "Color Match", min: 0, max: 200 },
];
const ROW_WIDGET_NAME = (name) => `pixops_row_${name}`;

export function bodyHeight() {
  return SLIDERS.length * ROW_H + (SLIDERS.length - 1) * ROW_GAP + PAD * 2;
}

export function injectCSS() {
  if (document.getElementById("pix-ops-css")) return;
  const s = document.createElement("style");
  s.id = "pix-ops-css";
  s.textContent = `
    .pix-ops-row-w { width:100%; box-sizing:border-box; }
    /* Heights must be DEFINITE (Sliders Pattern #2) or the min-content Vue row
       collapses (content is absolutely positioned). */
    .pix-ops-row { position:relative; width:100%; height:${ROW_H}px; min-height:${ROW_H}px; box-sizing:border-box; }

    .pix-ops-sl {
      position:relative; width:100%; height:${ROW_H}px; border-radius:5px; overflow:hidden;
      background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.14);
      cursor:ew-resize; box-sizing:border-box; user-select:none;
    }
    .pix-ops-sl:hover { border-color:var(--acc,#f66744); }
    .pix-ops-fill { position:absolute; left:0; top:0; bottom:0; width:0; background:var(--acc,#f66744); }
    .pix-ops-lay {
      position:absolute; inset:0; display:flex; align-items:center; gap:6px; padding:0 8px;
      pointer-events:none; font:11.5px 'Segoe UI',-apple-system,sans-serif;
    }
    .pix-ops-lay .nm { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pix-ops-lay .nu { flex:none; font-weight:600; font-variant-numeric:tabular-nums; }
    .pix-ops-base { clip-path:inset(0 0 0 var(--p,0%)); }
    .pix-ops-over { clip-path:inset(0 calc(100% - var(--p,0%)) 0 0); }
    .pix-ops-base .nm { color:rgba(255,255,255,0.72); }
    .pix-ops-base .nu { color:var(--acc,#f66744); }
    .pix-ops-over .nm, .pix-ops-over .nu { color:#fff; }
    .pix-ops-edit {
      position:absolute; inset:0; width:100%; height:100%; box-sizing:border-box; display:none;
      background:#1d1d1d; border:1px solid var(--acc,#f66744); border-radius:5px; outline:none;
      color:#e8e8e8; font:11.5px 'Segoe UI',sans-serif; text-align:right; padding:0 8px;
      font-variant-numeric:tabular-nums;
    }
    .pix-ops-sl.editing .pix-ops-edit { display:block; }

    /* NODES 2.0: the widget-socket paints a dot in column 1 of the row, at opacity
       0 until hovered/wired. Our rows ARE inputs, so keep the dot always visible. */
    .lg-node-widget:has(.pix-ops-row) > div:first-child { opacity:1 !important; }
  `;
  document.head.appendChild(s);
}

function hideNativeWidget(w) {
  if (!w) return;
  w.hidden = true;
  w.computeSize = () => [0, -4];
  if (!w.options) w.options = {};
  w.options.canvasOnly = true;
}

function makeSliderRow(node, cfg) {
  const wrap = document.createElement("div");
  wrap.className = "pix-ops-row-w";
  const row = document.createElement("div");
  row.className = "pix-ops-row";
  const sl = document.createElement("div");
  sl.className = "pix-ops-sl";
  const fill = document.createElement("div");
  fill.className = "pix-ops-fill";
  const base = document.createElement("div");
  base.className = "pix-ops-lay pix-ops-base";
  base.innerHTML = '<span class="nm"></span><span class="nu"></span>';
  const over = document.createElement("div");
  over.className = "pix-ops-lay pix-ops-over";
  over.innerHTML = '<span class="nm"></span><span class="nu"></span>';
  const edit = document.createElement("input");
  edit.className = "pix-ops-edit";
  edit.type = "text";
  edit.spellcheck = false;
  sl.append(fill, base, over, edit);
  row.appendChild(sl);
  wrap.appendChild(row);
  wrap._cfg = cfg;
  wrap._sl = sl;

  const getW = () => widgetOf(node, cfg.name);
  const setVal = (v, live) => {
    const w = getW();
    if (!w) return;
    let n = Math.round(Number(v));
    if (!Number.isFinite(n)) n = cfg.min;
    n = Math.min(cfg.max, Math.max(cfg.min, n));
    if (w.value !== n) {
      w.value = n;
      try { w.callback?.(n, app?.canvas, node); } catch {}
    }
    paintRows(node);
    if (!live) node.graph?.setDirtyCanvas?.(true, true);
  };

  let startX = 0, startV = 0;
  const valFromX = (clientX, shift) => {
    const r = sl.getBoundingClientRect();
    if (shift) {
      const dx = (clientX - startX) / Math.max(1, r.width);
      return startV + dx * (cfg.max - cfg.min) * 0.25;
    }
    const p = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
    return cfg.min + p * (cfg.max - cfg.min);
  };

  sl.addEventListener("pointerdown", (e) => {
    if (sl.classList.contains("editing") || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const w = getW();
    if (!w) return;
    startX = e.clientX;
    startV = Number(w.value) || 0;
    sl.setPointerCapture(e.pointerId);
    setVal(valFromX(e.clientX, e.shiftKey), true);
    const move = (ev) => setVal(valFromX(ev.clientX, ev.shiftKey), true);
    const up = () => {
      sl.removeEventListener("pointermove", move);
      sl.removeEventListener("pointerup", up);
      sl.removeEventListener("pointercancel", up);
      setVal(getW()?.value, false);
    };
    sl.addEventListener("pointermove", move);
    sl.addEventListener("pointerup", up);
    sl.addEventListener("pointercancel", up);
  });

  sl.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const w = getW();
    if (!w) return;
    edit.value = String(Math.round(Number(w.value) || 0));
    sl.classList.add("editing");
    edit.focus();
    edit.select();
  });
  const closeEdit = (apply) => {
    if (!sl.classList.contains("editing")) return;
    if (apply) {
      const v = parseFloat(edit.value);
      if (Number.isFinite(v)) setVal(v, false);
    }
    sl.classList.remove("editing");
    paintRows(node);
  };
  edit.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); closeEdit(true); }
    else if (e.key === "Escape") { e.preventDefault(); closeEdit(false); }
  });
  edit.addEventListener("blur", () => closeEdit(true));
  edit.addEventListener("pointerdown", (e) => e.stopPropagation());
  return wrap;
}

export function paintRows(node) {
  const wraps = node._pixOpsWraps || [];
  const vue = isVueNodes();
  const acc = accentOf(node);
  for (const wrap of wraps) {
    const cfg = wrap._cfg;
    // Legacy: leave room on the left for the input dot (the computeSize override
    // already tucks the rows under the slots). Nodes 2.0: the socket owns the
    // left column, so no inset.
    wrap.style.paddingLeft = vue ? "0px" : LEFT_INSET + "px";
    const w = widgetOf(node, cfg.name);
    let val = Math.round(Number(w?.value));
    if (!Number.isFinite(val)) val = cfg.min;
    val = Math.min(cfg.max, Math.max(cfg.min, val));
    const span = (cfg.max - cfg.min) || 1;
    const p = Math.min(100, Math.max(0, ((val - cfg.min) / span) * 100));
    const sl = wrap._sl;
    sl.style.setProperty("--p", p + "%");
    sl.style.setProperty("--acc", acc);
    wrap.querySelector(".pix-ops-fill").style.width = p + "%";
    wrap.querySelectorAll(".pix-ops-lay").forEach((lay) => {
      lay.querySelector(".nm").textContent = cfg.label;
      lay.querySelector(".nu").textContent = String(val);
    });
    sl.title = `${cfg.label}  ${cfg.min} - ${cfg.max}   (drag, Shift for fine, double-click to type; the dot on the left takes a number wire)`;
  }
}

// Bind each slider's input dot to its row. Branches on renderer (opposite marker
// treatment). Called on create/configure and from the self-heal poll.
export function bindInputDots(node) {
  const vue = isVueNodes();
  let changed = false;
  for (const cfg of SLIDERS) {
    const inp = node.inputs?.find((i) => i.name === cfg.name);
    const w = node._pixOpsRowWidgets?.[cfg.name];
    if (!inp || !w) continue;
    if (vue) {
      const nm = ROW_WIDGET_NAME(cfg.name);
      if (inp.widget?.name !== nm) { inp.widget = { name: nm }; changed = true; }
      if (inp._widget !== w) inp._widget = w;
      if (inp.label) { inp.label = undefined; }
    } else {
      if (inp.widget) { delete inp.widget; changed = true; }
      if (inp._widget) delete inp._widget;
      if (inp.label !== ZW) inp.label = ZW;   // suppress the "feather" name paint
      // pos is set in alignInputsLegacy (needs widget.y from arrange)
    }
  }
  // shallowReactive tracks only the array, not a field inside a slot.
  if (vue && changed && node.inputs) node.inputs = node.inputs.slice();
}

// LEGACY: park each slider's input dot on its row. The DOM-widget offset is not a
// clean constant (margin + row-reserve interplay), so MEASURE the rendered slider
// centre and place the dot there - robust at any zoom (pos is node-local, so it is
// zoom-independent once set). Returns true when both dots are already aligned, so
// the self-heal poll settles to a no-op. Feather/color_match carry an explicit pos
// so LiteGraph does NOT stack them, hence setting pos can't feed back into widget.y.
export function alignInputsLegacy(node) {
  if (isVueNodes()) return true;
  const c = app.canvas;
  if (!c?.canvas || !node?.pos || !node._pixOpsWraps) return false;
  let rect;
  try { rect = c.canvas.getBoundingClientRect(); } catch (_e) { return false; }
  const s = c.ds?.scale || 1;
  const oy = c.ds?.offset?.[1] || 0;
  const toLocalY = (screenY) => (screenY - rect.top) / s - oy - node.pos[1];
  let aligned = true;
  for (const cfg of SLIDERS) {
    const inp = node.inputs?.find((i) => i.name === cfg.name);
    const wrap = node._pixOpsWraps.find((w) => w._cfg === cfg);
    const sl = wrap?.querySelector(".pix-ops-sl");
    if (!inp || !sl) continue;
    const b = sl.getBoundingClientRect();
    if (!b.height) { aligned = false; continue; }
    const cy = (toLocalY(b.top) + toLocalY(b.bottom)) / 2;
    if (!inp.pos || inp.pos[0] !== DOT_X || Math.abs(inp.pos[1] - cy) > 0.75) {
      inp.pos = [DOT_X, cy];
      aligned = false;
    }
  }
  return aligned;
}

export function installSliders(node) {
  if (node._pixOpsWraps) { paintRows(node); return; }
  for (const cfg of SLIDERS) hideNativeWidget(widgetOf(node, cfg.name));

  node._pixOpsWraps = [];
  node._pixOpsRowWidgets = {};
  for (const cfg of SLIDERS) {
    const wrap = makeSliderRow(node, cfg);
    const w = node.addDOMWidget(ROW_WIDGET_NAME(cfg.name), WIDGET_TYPE, wrap, {
      serialize: false,
      getMinHeight: () => ROW_H + (cfg === SLIDERS[0] ? PAD : ROW_GAP),
    });
    w.serialize = false;
    w.computeLayoutSize = undefined;   // hug content (Nodes 2.0)
    applyAdaptiveCanvasOnly(w);
    node._pixOpsWraps.push(wrap);
    node._pixOpsRowWidgets[cfg.name] = w;
    node._pixOpsFloorOff = installResizeFloor(wrap, () => ROW_H + PAD);
  }
  bindInputDots(node);
  paintRows(node);
}

export function uninstallSliders(node) {
  try { node._pixOpsFloorOff?.(); } catch {}
  node._pixOpsFloorOff = null;
}

// Legacy: our two slider rows own the widget area, but the node still has the two
// REAL input slots (image, outpaint_info) above them - feather/color_match are on
// the slider rows, so they must NOT reserve a slot row too. Return
// max(real-inputs, outputs) slot rows + the slider area. MIN_W, never the live
// width (that would pin the drag-min at the current width so the node only grows).
export function bodyComputeSize(node) {
  const realInputs = (node.inputs || []).filter(
    (i) => !SLIDERS.some((s) => s.name === i.name)).length;
  const slotRows = Math.max(realInputs, (node.outputs || []).length, 1);
  return [MIN_W, slotRows * 20 + bodyHeight()];
}

export { SLIDERS };
