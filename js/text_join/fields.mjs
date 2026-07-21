// Text Join Pixaroma - the text-field face. One multi-line box PER piece, EACH
// with a real input dot ON ITS ROW so another node's text can be wired in, plus
// a per-field copy/paste that appears on hover. A gear footer row opens the
// settings panel.
//
// The fields FILL the node body and GROW when the node is resized (like a native
// multiline / concatenate widget): each field box shares the body height equally.
//   LEGACY     each field widget's `computeSize` returns node-size-driven height,
//              and sets its DOM wrap height to match, so the boxes fill + grow.
//   NODES 2.0  each field widget is an 'auto' grid row (computeLayoutSize defined)
//              so the rows split the node's spare height; a :has() rule keeps the
//              always-on input dot visible.
// Dot-on-row + value-flow machinery is ported from Outpaint Stitch Pixaroma. The
// value flows through the node's own hidden STRING widget + a graphToPrompt inject
// (index.js), so the dot gymnastics never touch the text reaching Python.

import { app } from "/scripts/app.js";
import { widgetOf, BRAND } from "./core.mjs";
import { applyAdaptiveCanvasOnly, isVueNodes, installResizeFloor } from "../shared/index.mjs";

export const MIN_FIELD_H = 56;     // smallest a single field box can shrink to
const DEF_FIELD_H = 84;            // comfortable default per field on a fresh node
// Legacy vertical budget, measured against ComfyUI's DOM-widget layout (it places
// the first widget ~10px below widgets_start_y and adds a small gap between rows).
// Reserving these keeps the field boxes INSIDE the node frame (no spill).
const TOP_RESERVE = 34;            // node body top -> first field box
const ROW_GAP = 4;                 // gap between field boxes
const BOTTOM_RESERVE = 12;         // keep the last field off the frame's bottom edge
export const MIN_W = 220;
export const DEFAULT_W = 264;
export const ZW = "​";          // zero-width space: suppress the slot label paint
const DOT_X = 10;                    // legacy input-dot x (matches native slots)
const LEFT_INSET = 15;               // legacy: room on the row's left for the dot
const WIDGET_TYPE = "pixaroma_tj_row";
const ROW_WIDGET_NAME = (name) => `pixtj_row_${name}`;

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

// Fresh-node default height (fields at the comfortable size).
export function defaultNodeHeight(n) {
  return TOP_RESERVE + n * DEF_FIELD_H + (n - 1) * ROW_GAP + BOTTOM_RESERVE;
}
// Minimum node height (fields at MIN_FIELD_H) - the node can't be dragged smaller.
function minNodeHeight(n) {
  return TOP_RESERVE + n * MIN_FIELD_H + (n - 1) * ROW_GAP + BOTTOM_RESERVE;
}
// Height each field box gets for the current node size: the body's spare height
// shared equally across the fields, never below MIN_FIELD_H. Grows with the node.
function fieldSlotH(node) {
  const n = fieldsOf(node).length || 1;
  const avail = (node.size?.[1] || 0) - TOP_RESERVE - (n - 1) * ROW_GAP - BOTTOM_RESERVE;
  return Math.max(MIN_FIELD_H, Math.floor(avail / n));
}

export function injectCSS() {
  if (document.getElementById("pix-tj-css")) return;
  const s = document.createElement("style");
  s.id = "pix-tj-css";
  s.textContent = `
    /* The wrap is sized by the renderer (legacy: we set its height in computeSize;
       Vue: it flex-fills its grid row). The field fills it with an absolute layer. */
    .pix-tj-row { position:relative; width:100%; box-sizing:border-box; }
    /* Nodes 2.0: flex-fill the grid row, but with a REAL min-height floor (not 0):
       the field is absolute (no in-flow content) so min-height:0 would collapse it.
       N such rows split the node's spare height equally and grow with the node. */
    .pix-tj-row.pix-tj-vue { flex:1 1 auto; min-height:${MIN_FIELD_H}px; }
    .pix-tj-field { position:absolute; top:0; right:0; bottom:0; left:0; box-sizing:border-box;
      background:#1d1d1d; border:1px solid #333; border-radius:5px; overflow:hidden; }
    .pix-tj-field:focus-within { border-color:${BRAND}; }
    .pix-tj-lbl { position:absolute; top:4px; left:9px; z-index:2; pointer-events:none;
      font:10px 'Segoe UI',-apple-system,sans-serif; color:#8f8f8f; }
    .pix-tj-ta { position:absolute; inset:0; width:100%; height:100%; box-sizing:border-box;
      background:transparent; color:#e0e0e0; border:0; outline:none; resize:none;
      font:12px monospace; padding:19px 8px 7px; }
    .pix-tj-ta::placeholder { color:#5c5c5c; font-style:italic; }
    .pix-tj-icons { position:absolute; top:3px; right:5px; z-index:3; display:none; gap:3px; }
    .pix-tj-field:hover .pix-tj-icons { display:flex; }
    .pix-tj-ic { width:19px; height:19px; border-radius:4px; display:flex; align-items:center;
      justify-content:center; cursor:pointer; background:rgba(255,255,255,0.06);
      border:1px solid rgba(255,255,255,0.14); color:rgba(255,255,255,0.72); }
    .pix-tj-ic:hover { background:${BRAND}; border-color:${BRAND}; color:#fff; }
    .pix-tj-ic.ok, .pix-tj-ic.ok:hover { background:#3ec371; border-color:#3ec371; color:#fff; }
    /* Wire-driven: locked + grayed (the wired node drives it; the box is a dimmed,
       disabled fallback showing the typed text the wire overrides). */
    .pix-tj-field.wired { opacity:0.5; filter:grayscale(0.9); }
    .pix-tj-field.wired .pix-tj-ta { cursor:default; }
    .pix-tj-field.wired .pix-tj-icons { display:none !important; }
    .pix-tj-field.wired:focus-within { border-color:#333; }

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

// True when this field's input is wired - then another node drives the text.
function isWired(node, name) {
  const inp = node.inputs?.find((i) => i.name === name);
  return !!(inp && inp.link != null);
}

// Hide the native STRING widget (its own DOM textarea too) - it stays the VALUE
// store, but the pretty box replaces its face. Value then reaches Python via the
// graphToPrompt inject (index.js).
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
    ta.focus();                                  // readText needs the document focused
    const txt = await navigator.clipboard.readText();
    // Empty covers BOTH an empty clipboard AND an image-only one (Chrome returns
    // "" there) - bail instead of wiping the field.
    if (!txt) { toast("info", "Nothing to paste"); return; }
    ta.value = txt;
    mirror(node, cfg, ta);
    node.graph?.setDirtyCanvas?.(true, true);
    flashIcon(iconEl);
  } catch {
    // The clipboard-read permission can be blocked (denied, or a locked-down
    // preview browser). Native paste is NOT gated by it, so focus the field and
    // point the user at Ctrl+V, which always works.
    ta.focus();
    toast("warn", "Can't read the clipboard - click the field and press Ctrl+V");
  }
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
  wrap.className = "pix-tj-row";
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
  wrap.appendChild(field);
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

// Refresh per-row state (wired lock, legacy dot inset). Does NOT touch the
// textarea text - that is seeded on install/configure only, so typing is safe.
export function paintRows(node) {
  const wraps = node._pixTjWraps || [];
  const vue = isVueNodes();
  for (const wrap of wraps) {
    const cfg = wrap._cfg;
    // Legacy: inset the field so the dot on the left has room. Vue: the socket
    // owns the left column, so no inset.
    wrap._field.style.left = vue ? "0px" : LEFT_INSET + "px";
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

// LEGACY: park each field's input dot at the vertical CENTRE of its (growing) box,
// at a STABLE node-local Y (widget.y + boxHeight/2). widget.y changes only on
// relayout, so the dot holds still on pan/zoom.
export function alignInputsLegacy(node) {
  if (isVueNodes() || !node._pixTjRowWidgets) return;
  const h = fieldSlotH(node);
  for (const cfg of fieldsOf(node)) {
    const inp = node.inputs?.find((i) => i.name === cfg.name);
    const w = node._pixTjRowWidgets[cfg.name];
    if (!inp || !w || !Number.isFinite(w.y)) continue;
    const y = w.y + h * 0.5;
    if (!inp.pos || inp.pos[0] !== DOT_X || Math.abs(inp.pos[1] - y) > 0.25) {
      inp.pos = [DOT_X, y];
    }
  }
}

export function installFields(node) {
  if (node._pixTjWraps) { paintRows(node); return; }
  const fields = fieldsOf(node);
  for (const cfg of fields) hideNativeWidget(widgetOf(node, cfg.name));

  node._pixTjWraps = [];
  node._pixTjRowWidgets = {};
  node._pixTjFloorOffs = [];
  fields.forEach((cfg) => {
    const wrap = makeFieldRow(node, cfg);
    const w = node.addDOMWidget(ROW_WIDGET_NAME(cfg.name), WIDGET_TYPE, wrap, {
      serialize: false,
      getMinHeight: () => MIN_FIELD_H,
    });
    w.serialize = false;
    // The two renderers fill differently (renderer is fixed per page load):
    if (isVueNodes()) {
      // Nodes 2.0: an 'auto' grid row (via computeLayoutSize) + a minHeight floor;
      // the element flex-fills its row. N such rows split the spare height equally.
      // NO custom computeSize here - it makes the row fixed-height in the grid.
      wrap.classList.add("pix-tj-vue");
      w.computeLayoutSize = () => ({ minHeight: MIN_FIELD_H, minWidth: 1 });
    } else {
      // Legacy: drive the slot AND the DOM wrap height from node.size so the box
      // fills the body and grows with it (computeSize is called each draw).
      w.computeSize = () => {
        const h = fieldSlotH(node);
        if (wrap.style.height !== h + "px") wrap.style.height = h + "px";
        return [node.size?.[0] || MIN_W, h];
      };
    }
    applyAdaptiveCanvasOnly(w);
    node._pixTjWraps.push(wrap);
    node._pixTjRowWidgets[cfg.name] = w;
    node._pixTjFloorOffs.push(installResizeFloor(wrap, () => MIN_FIELD_H));
    seedField(node, wrap);
  });

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

// Legacy: the node's MIN size (fields at MIN_FIELD_H). node.size can be larger
// (user drag); the fields fill it via their computeSize. MIN_W, never live width.
export function bodyComputeSize(node) {
  const n = fieldsOf(node).length || 1;
  return [MIN_W, minNodeHeight(n)];
}
