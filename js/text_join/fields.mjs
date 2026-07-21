// Text Join Pixaroma - the text-field face. One multi-line box PER piece, EACH
// with a real input dot ON ITS ROW so another node's text can be wired in, plus
// a per-field copy/paste that appears on hover. A gear footer row opens the
// settings panel.
//
// The dot-on-row + value-flow machinery is ported straight from Outpaint Stitch
// Pixaroma (js/outpaint_stitch/sliders.mjs):
//   NODES 2.0  the widget-socket model - input.widget = {name: rowWidget} moves
//              the real dot onto the row; a :has() rule keeps it always visible.
//   LEGACY     the marker is REMOVED (so the dot draws), input.pos parks it on
//              the row, widgets_start_y pins the rows, computeSize owns height.
// The value flows through the node's own hidden STRING widget + a graphToPrompt
// inject (index.js), so the dot gymnastics never touch the text reaching Python.

import { app } from "/scripts/app.js";
import { widgetOf, BRAND } from "./core.mjs";
import { applyAdaptiveCanvasOnly, isVueNodes, installResizeFloor } from "../shared/index.mjs";

export const ROW_H = 64;             // one field box (label + a few lines of text)
export const ROW_GAP = 6;
export const PAD = 6;
export const FOOTER_H = 24;          // the gear row
export const MIN_W = 220;
export const DEFAULT_W = 250;
export const ZW = "​";          // zero-width space: suppress the slot label paint
const DOT_X = 10;                    // legacy input-dot x (matches native slots)
const LEFT_INSET = 15;               // legacy: room on the row's left for the dot
const LEGACY_PULL = 7;               // legacy: tuck the rows up under the output slot
const WIDGET_TYPE = "pixaroma_tj_row";
const FOOTER_TYPE = "pixaroma_tj_footer";
const ROW_WIDGET_NAME = (name) => `pixtj_row_${name}`;
const FOOTER_WIDGET_NAME = "pixtj_footer";

const COPY_SVG =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="9" y="9" width="11" height="11" rx="2"/>' +
  '<path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const PASTE_SVG =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="8" y="2" width="8" height="4" rx="1"/>' +
  '<path d="M16 4h1a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1"/></svg>';

export function fieldsOf(node) { return node._pixTjFields || []; }

export function bodyHeight(node) {
  const n = fieldsOf(node).length || 1;
  return n * ROW_H + (n - 1) * ROW_GAP + PAD * 2 + FOOTER_H;
}

export function injectCSS() {
  if (document.getElementById("pix-tj-css")) return;
  const s = document.createElement("style");
  s.id = "pix-tj-css";
  s.textContent = `
    .pix-tj-row-w { width:100%; box-sizing:border-box; }
    /* Heights must be DEFINITE or the min-content Vue row collapses. */
    .pix-tj-row { position:relative; width:100%; height:${ROW_H}px; min-height:${ROW_H}px; box-sizing:border-box; }
    .pix-tj-field { position:relative; width:100%; height:100%; box-sizing:border-box;
      background:#1d1d1d; border:1px solid #333; border-radius:5px; overflow:hidden; }
    .pix-tj-field:focus-within { border-color:${BRAND}; }
    .pix-tj-lbl { position:absolute; top:3px; left:8px; z-index:2; pointer-events:none;
      font:10px 'Segoe UI',-apple-system,sans-serif; color:#8f8f8f; }
    .pix-tj-ta { position:absolute; inset:0; width:100%; height:100%; box-sizing:border-box;
      background:transparent; color:#e0e0e0; border:0; outline:none; resize:none;
      font:12px monospace; padding:17px 8px 6px; }
    .pix-tj-ta::placeholder { color:#5c5c5c; font-style:italic; }
    .pix-tj-icons { position:absolute; top:2px; right:4px; z-index:3; display:none; gap:3px; }
    .pix-tj-field:hover .pix-tj-icons { display:flex; }
    .pix-tj-ic { width:19px; height:19px; border-radius:4px; display:flex; align-items:center;
      justify-content:center; cursor:pointer; background:rgba(255,255,255,0.06);
      border:1px solid rgba(255,255,255,0.14); color:rgba(255,255,255,0.72); }
    .pix-tj-ic:hover { background:${BRAND}; border-color:${BRAND}; color:#fff; }
    .pix-tj-ic.ok, .pix-tj-ic.ok:hover { background:#3ec371; border-color:#3ec371; color:#fff; }
    /* Wire-driven: locked + grayed. A number/text node drives it; the box is a
       dimmed, disabled fallback (the typed text the wire overrides). */
    .pix-tj-field.wired { opacity:0.5; filter:grayscale(0.9); }
    .pix-tj-field.wired .pix-tj-ta { cursor:default; }
    .pix-tj-field.wired .pix-tj-icons { display:none !important; }
    .pix-tj-field.wired:focus-within { border-color:#333; }

    .pix-tj-foot-w { width:100%; box-sizing:border-box; }
    .pix-tj-foot { display:flex; align-items:center; justify-content:flex-end; height:${FOOTER_H}px; }
    .pix-tj-gear { width:22px; height:22px; border-radius:5px; display:flex; align-items:center;
      justify-content:center; cursor:pointer; font-size:14px; color:#bdbdbd;
      background:#232323; border:1px solid #3a3a3a; }
    .pix-tj-gear:hover { border-color:${BRAND}; color:#fff; }

    /* NODES 2.0: the widget-socket paints a dot in column 1 of the row at opacity
       0 until hovered/wired. Our rows ARE inputs, so keep the dot always visible. */
    .lg-node-widget:has(.pix-tj-row) > div:first-child { opacity:1 !important; }
  `;
  document.head.appendChild(s);
}

function toast(severity, msg) {
  const t = app?.extensionManager?.toast;
  if (t?.add) t.add({ severity, summary: "Text Join Pixaroma", detail: msg, life: 2000 });
  else console.warn("[Text Join Pixaroma]", msg);
}

function flashIcon(iconEl) {
  iconEl.classList.add("ok");
  setTimeout(() => iconEl.classList.remove("ok"), 700);
}

// True when this field's input is wired - then another node drives the text and
// the box is a locked, grayed-out fallback display.
function isWired(node, name) {
  const inp = node.inputs?.find((i) => i.name === name);
  return !!(inp && inp.link != null);
}

// Hide the native STRING widget (its own DOM textarea too) - it stays the VALUE
// store, but the pretty box replaces its face AND a real input dot sits on the
// row. Value then reaches Python via the graphToPrompt inject (index.js).
function hideNativeWidget(w) {
  if (!w) return;
  w.hidden = true;
  w.computeSize = () => [0, -4];
  if (!w.options) w.options = {};
  w.options.canvasOnly = true;
  const elx = w.element || w.inputEl;
  if (elx) elx.style.display = "none";
}

function mirror(node, cfg, ta) {
  const w = widgetOf(node, cfg.name);
  if (!w) return;
  if (w.value !== ta.value) {
    w.value = ta.value;
    try { w.callback?.(w.value, app?.canvas, node); } catch { /* ignore */ }
  }
}

function seedField(node, wrap) {
  const w = widgetOf(node, wrap._cfg.name);
  const v = (w && typeof w.value === "string") ? w.value : "";
  if (wrap._ta.value !== v) wrap._ta.value = v;
}

export function reseedFields(node) {
  for (const wrap of node._pixTjWraps || []) seedField(node, wrap);
}

async function doCopy(iconEl, ta) {
  const txt = ta.value || "";
  if (!txt) { toast("info", "Nothing to copy"); return; }
  try {
    if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
    await navigator.clipboard.writeText(txt);
    flashIcon(iconEl);
  } catch { toast("warn", "Could not copy to clipboard"); }
}

async function doPaste(node, cfg, iconEl, ta) {
  try {
    if (!navigator.clipboard?.readText) throw new Error("no clipboard");
    const txt = await navigator.clipboard.readText();
    // Empty covers BOTH an empty clipboard AND an image-only one (Chrome returns
    // "" there) - bail instead of wiping the field.
    if (!txt) { toast("info", "Nothing to paste"); return; }
    ta.value = txt;
    mirror(node, cfg, ta);
    node.graph?.setDirtyCanvas?.(true, true);
    flashIcon(iconEl);
  } catch { toast("warn", "Could not paste from clipboard"); }
}

function mkIcon(svg, title) {
  const b = document.createElement("span");
  b.className = "pix-tj-ic";
  b.innerHTML = svg;
  b.title = title;
  return b;
}

function makeFieldRow(node, cfg) {
  const wrap = document.createElement("div");
  wrap.className = "pix-tj-row-w";
  const row = document.createElement("div");
  row.className = "pix-tj-row";
  const field = document.createElement("div");
  field.className = "pix-tj-field";

  const lbl = document.createElement("span");
  lbl.className = "pix-tj-lbl";
  lbl.textContent = cfg.label;

  const icons = document.createElement("div");
  icons.className = "pix-tj-icons";
  const copyBtn = mkIcon(COPY_SVG, "Copy this text");
  const pasteBtn = mkIcon(PASTE_SVG, "Paste into this field (replaces it)");
  icons.append(copyBtn, pasteBtn);

  const ta = document.createElement("textarea");
  ta.className = "pix-tj-ta";
  ta.spellcheck = false;
  ta.placeholder = "type here or wire";

  field.append(lbl, icons, ta);
  row.appendChild(field);
  wrap.appendChild(row);
  wrap._cfg = cfg;
  wrap._field = field;
  wrap._ta = ta;

  ta.addEventListener("input", () => mirror(node, cfg, ta));
  ta.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") return;  // let run-workflow through
    e.stopPropagation();                                        // don't fire canvas shortcuts
  });
  ta.addEventListener("pointerdown", (e) => e.stopPropagation());
  ta.addEventListener("mousedown", (e) => e.stopPropagation());

  copyBtn.addEventListener("click", (e) => { e.stopPropagation(); doCopy(copyBtn, ta); });
  pasteBtn.addEventListener("click", (e) => { e.stopPropagation(); doPaste(node, cfg, pasteBtn, ta); });
  for (const b of [copyBtn, pasteBtn]) {
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("mousedown", (e) => e.stopPropagation());
  }
  return wrap;
}

function makeFooter(node, openPanel) {
  const wrap = document.createElement("div");
  wrap.className = "pix-tj-foot-w";
  const foot = document.createElement("div");
  foot.className = "pix-tj-foot";
  const gear = document.createElement("div");
  gear.className = "pix-tj-gear";
  gear.textContent = "⚙";
  gear.title = "Text Join settings (separator, skip empty)";
  gear.addEventListener("pointerdown", (e) => e.stopPropagation());
  gear.addEventListener("click", (e) => { e.stopPropagation(); openPanel?.(); });
  foot.appendChild(gear);
  wrap.appendChild(foot);
  return wrap;
}

// Refresh per-row state (wired lock, legacy inset/pull). Does NOT touch the
// textarea text - that is seeded on install/configure only, so typing is safe.
export function paintRows(node) {
  const wraps = node._pixTjWraps || [];
  const vue = isVueNodes();
  for (const wrap of wraps) {
    const cfg = wrap._cfg;
    // Legacy: leave room on the left for the dot + pull the row up under the
    // output slot. Nodes 2.0: the socket owns the left column, no margin.
    wrap.style.paddingLeft = vue ? "0px" : LEFT_INSET + "px";
    wrap.style.marginTop = vue ? "0px" : (-LEGACY_PULL) + "px";
    const wired = isWired(node, cfg.name);
    wrap._field.classList.toggle("wired", wired);
    wrap._ta.disabled = wired;
    wrap._ta.placeholder = wired ? "text comes from the wired node" : "type here or wire";
    wrap._field.title = wired
      ? `${cfg.label} is set by the connected node - unplug the wire to type here (the dimmed text is this box's own value)`
      : "";
  }
}

// Bind each field's input dot to its row. Opposite marker treatment per renderer.
export function bindInputDots(node) {
  const vue = isVueNodes();
  let changed = false;
  for (const cfg of fieldsOf(node)) {
    const inp = node.inputs?.find((i) => i.name === cfg.name);
    const w = node._pixTjRowWidgets?.[cfg.name];
    if (!inp || !w) continue;
    if (vue) {
      const nm = ROW_WIDGET_NAME(cfg.name);
      if (inp.widget?.name !== nm) { inp.widget = { name: nm }; changed = true; }
      if (inp._widget !== w) inp._widget = w;
      if (inp.label) inp.label = undefined;
    } else {
      if (inp.widget) { delete inp.widget; changed = true; }
      if (inp._widget) delete inp._widget;
      if (inp.label !== ZW) inp.label = ZW;   // suppress the "text_1" name paint
    }
  }
  // shallowReactive tracks only the array, not a field inside a slot.
  if (vue && changed && node.inputs) node.inputs = node.inputs.slice();
}

// LEGACY: park each field's input dot on its row at a STABLE node-local Y (never
// measures the live DOM, whose screen->local conversion jitters on pan/zoom).
export function alignInputsLegacy(node) {
  if (isVueNodes() || !node._pixTjRowWidgets) return;
  for (const cfg of fieldsOf(node)) {
    const inp = node.inputs?.find((i) => i.name === cfg.name);
    const w = node._pixTjRowWidgets[cfg.name];
    if (!inp || !w || !Number.isFinite(w.y)) continue;
    const margin = Number.isFinite(w.margin) ? w.margin : 10;
    const y = w.y + margin + ROW_H * 0.5 - LEGACY_PULL;   // dot centre, follows the pull
    if (!inp.pos || inp.pos[0] !== DOT_X || Math.abs(inp.pos[1] - y) > 0.25) {
      inp.pos = [DOT_X, y];
    }
  }
}

export function installFields(node, openPanel) {
  if (node._pixTjWraps) { paintRows(node); return; }
  const fields = fieldsOf(node);
  for (const cfg of fields) hideNativeWidget(widgetOf(node, cfg.name));

  node._pixTjWraps = [];
  node._pixTjRowWidgets = {};
  node._pixTjFloorOffs = [];
  fields.forEach((cfg, i) => {
    const wrap = makeFieldRow(node, cfg);
    const w = node.addDOMWidget(ROW_WIDGET_NAME(cfg.name), WIDGET_TYPE, wrap, {
      serialize: false,
      getMinHeight: () => ROW_H + (i === 0 ? PAD : ROW_GAP),
    });
    w.serialize = false;
    w.computeLayoutSize = undefined;   // hug content (Nodes 2.0)
    applyAdaptiveCanvasOnly(w);
    node._pixTjWraps.push(wrap);
    node._pixTjRowWidgets[cfg.name] = w;
    node._pixTjFloorOffs.push(installResizeFloor(wrap, (root) => root.offsetHeight || ROW_H));
    seedField(node, wrap);
  });

  // Gear footer row (no input dot).
  const footWrap = makeFooter(node, openPanel);
  const fw = node.addDOMWidget(FOOTER_WIDGET_NAME, FOOTER_TYPE, footWrap, {
    serialize: false,
    getMinHeight: () => FOOTER_H + PAD,
  });
  fw.serialize = false;
  fw.computeLayoutSize = undefined;
  applyAdaptiveCanvasOnly(fw);
  node._pixTjFooter = footWrap;
  node._pixTjFloorOffs.push(installResizeFloor(footWrap, (root) => root.offsetHeight || FOOTER_H));

  // Vue can rebuild a hidden multiline widget's DOM a frame later - re-hide it.
  requestAnimationFrame(() => {
    for (const cfg of fields) {
      const w = widgetOf(node, cfg.name);
      const elx = w && (w.element || w.inputEl);
      if (elx) elx.style.display = "none";
    }
  });

  bindInputDots(node);
  paintRows(node);
}

export function uninstallFields(node) {
  try { (node._pixTjFloorOffs || []).forEach((off) => off?.()); } catch { /* ignore */ }
  node._pixTjFloorOffs = [];
}

// Legacy: our field rows own the widget area; the node's only slots are the
// text_* inputs (which live ON the rows) + the single `text` output. So reserve
// max(non-field inputs, outputs) slot rows + the body. MIN_W, never live width.
export function bodyComputeSize(node) {
  const fieldNames = new Set(fieldsOf(node).map((f) => f.name));
  const realInputs = (node.inputs || []).filter((i) => !fieldNames.has(i.name)).length;
  const slotRows = Math.max(realInputs, (node.outputs || []).length, 1);
  return [MIN_W, slotRows * 20 + bodyHeight(node) - LEGACY_PULL];
}
