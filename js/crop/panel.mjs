// ============================================================
// Pixaroma Image Crop — On-Node Panel
// ============================================================
// Compact custom DOM widget for the node body. Exposes W, H, X, Y,
// Ratio combo, and an Alignment combo (replaces the one-shot Center
// button — when ≠ Free, X/Y are auto-computed and locked).
// Source of truth = cropJson (read in refresh(), written on every commit).
// Inputs are <input type=text> so the user can type math expressions
// like "1024+256" or "1024*2" — evaluated safely on commit.
// ============================================================

import { ACC, notifyGraphChanged, placeZoomedPopup } from "../shared/index.mjs";
import { RATIOS } from "./core.mjs";
import { ALIGNMENTS, computeAlignedXY, defaultAlignForMeta } from "./alignments.mjs";

// Build the ratio combo label. The "Free" entry becomes "Free Ratio" so it's
// distinguishable from the alignment dropdown's Free; other entries get a
// " Square" / " Landscape" / " Portrait" suffix so users can scan by orientation.
function ratioLabel(r) {
  if (r.label === "Free") return "Free Ratio";
  if (r.w === 0 || r.h === 0) return r.label;
  if (r.w === r.h) return r.label + " Square";
  return r.label + (r.w > r.h ? " Landscape" : " Portrait");
}

// Safe arithmetic-only expression evaluator. Allows digits, whitespace,
// + - * / ( ) and . / , (decimals). Anything else → NaN. No identifiers,
// no property access, no function calls — `Function()` body is just
// "return (sanitised_expr)".
function evalExpr(s) {
  s = String(s).trim();
  if (!s) return NaN;
  if (!/^[\d\s+\-*/().,]+$/.test(s)) return NaN;
  // Allow comma as decimal separator (EU locales).
  s = s.replace(/,/g, ".");
  try {
    const r = Function(`"use strict"; return (${s})`)();
    return typeof r === "number" && isFinite(r) ? r : NaN;
  } catch {
    return NaN;
  }
}

const PANEL_CSS = `
.pix-cropp {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 5px 8px;
  font-family: 'Segoe UI', sans-serif;
  font-size: 11px;
  color: #ccc;
  user-select: none;
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}
.pix-cropp-row { display: flex; gap: 5px; align-items: stretch; }
.pix-cropp-cell {
  flex: 1;
  background: #1d1d1d;
  border: 1px solid #666;
  border-radius: 4px;
  padding: 4px 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  box-sizing: border-box;
  transition: border-color 0.08s;
}
.pix-cropp-cell:hover { border-color: ${ACC}; }
/* The input draws no outline of its own, so the cell's border IS the focus
   ring (node UI convention #13: inputs use :focus-within). */
.pix-cropp-cell:focus-within { border-color: ${ACC}; }
.pix-cropp-cell label {
  font-size: 10px;
  color: #777;
  letter-spacing: 0.4px;
  flex: 0 0 auto;
}
.pix-cropp-cell input[type=text] {
  flex: 1;
  background: transparent;
  color: #fff;
  border: 0;
  outline: 0;
  width: 100%;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  padding: 0;
  font-family: inherit;
  text-align: center;
}
/* The Pixaroma dropdown (node UI convention #14), never a native <select>.
   No side arrows HERE: two dropdowns share one row, and 24px arrow buttons
   (the WCAG 2.5.8 minimum) left too little room, cutting "16:9 Landscape"
   and "Bottom Right" short at the default width. Full names win; the arrow
   KEYS still step through the options. Same 24px height as the cells. */
.pix-cropp-combo { flex: 1; min-width: 0; display: flex; }
.pix-cropp-combo button {
  background: #1d1d1d;
  border: 1px solid #666;
  border-radius: 4px;
  min-height: 24px;
  box-sizing: border-box;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.08s;
}
.pix-cropp-combo button:hover,
.pix-cropp-combo button:focus-visible { border-color: ${ACC}; outline: 0; }
.pix-cropp-dd {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 6px;
  color: #ccc;
  font-size: 11px;
}
.pix-cropp-dd-val { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pix-cropp-dd-arrow { flex: none; color: ${ACC}; font-size: 9px; }
/* The list lives on document.body, so it is NOT scoped to .pix-cropp. Inner
   sizes in em: placeZoomedPopup scales the root font with the canvas zoom. */
.pix-cropp-pop {
  position: fixed;
  z-index: 10900;
  background: #181818;
  border: 1px solid #555;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,.5);
  max-height: 320px;
  overflow: auto;
  font-family: 'Segoe UI', sans-serif;
}
.pix-cropp-pop-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1.2em;
  padding: 0.55em 1em;
  cursor: pointer;
  border-bottom: 1px solid #2a2a2a;
  white-space: nowrap;
}
.pix-cropp-pop-item:last-child { border-bottom: none; }
.pix-cropp-pop-item:hover { background: #2a2a2a; }
.pix-cropp-pop-label { font-size: 1.08em; color: #ddd; }
.pix-cropp-pop-item.active .pix-cropp-pop-label { color: ${ACC}; font-weight: 600; }
.pix-cropp-pop-hint { font-size: 0.92em; color: #888; }
`;

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  const style = document.createElement("style");
  style.id = "pix-crop-panel-css";
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
  _cssInjected = true;
}

// Returns { el, refresh } where el is the container DOM element (mount it
// via node.addDOMWidget) and refresh() re-reads cropJson + image dims.
//
// Required callbacks:
//   getCropJson()    -> string   (the hidden CropWidget's crop_json value)
//   setCropJson(s)   -> void     (write back to the hidden widget + state)
//   getImageDims()   -> {w,h}|null  (last loaded mini-preview image dims)
//   onChange()       -> void     (after a commit; trigger preview rebuild)
export function createCropPanel(callbacks) {
  injectCSS();
  const { getCropJson, setCropJson, getImageDims, onChange } = callbacks;

  const root = document.createElement("div");
  root.className = "pix-cropp";

  // ── Row 1: W / H ──
  const row1 = document.createElement("div");
  row1.className = "pix-cropp-row";
  const wInput = makeTextInput("W");
  const hInput = makeTextInput("H");
  row1.append(wInput.cell, hInput.cell);

  // ── Row 2: X / Y ──
  const row2 = document.createElement("div");
  row2.className = "pix-cropp-row";
  const xInput = makeTextInput("X", 0);
  const yInput = makeTextInput("Y", 0);
  row2.append(xInput.cell, yInput.cell);

  // ── Row 3: Ratio + Alignment ──
  const row3 = document.createElement("div");
  row3.className = "pix-cropp-row";

  // Both keep the old <select>'s contract: `.value` is the option's string
  // value, and picking one runs the same commit the "change" event did.
  const ratioSelect = makeCombo({
    name: "Crop ratio",
    title: "Lock the crop to a shape. Click to pick from the list.",
    options: RATIOS.map((r, i) => ({ value: String(i), label: ratioLabel(r), item: r.label, hint: ratioHint(r) })),
    onPick: () => onRatioCommit(),
  });
  const alignSelect = makeCombo({
    name: "Crop alignment",
    title: "Where the crop sits on the picture. Any choice except Free sets X and Y for you.",
    options: ALIGNMENTS.map((a) => ({ value: a.id, label: a.label, hint: a.id === "free" ? "type X and Y" : "" })),
    onPick: () => onAlignmentCommit(),
  });

  row3.append(ratioSelect.el, alignSelect.el);

  root.append(row1, row2, row3);

  // ── State sync helpers ──

  function readMeta() {
    let meta = {};
    try { meta = JSON.parse(getCropJson() || "{}") || {}; } catch {}
    return typeof meta === "object" && meta ? meta : {};
  }

  // Commit a partial update to cropJson. Stamps original_w/h from current
  // image dims so Python's proportional-rescale logic stays correct.
  function commit(partial) {
    const meta = readMeta();
    const dims = getImageDims?.() || null;
    Object.assign(meta, partial);
    if (dims) {
      meta.original_w = dims.w;
      meta.original_h = dims.h;
    }
    setCropJson(JSON.stringify(meta));
    onChange?.();
  }

  // Image dims with fallback to cropJson's saved original_w/h. The runtime
  // field _pixaromaLastImageDims (the source of getImageDims()) is set when
  // the upstream image actually loads, but that field doesn't survive Vue
  // workflow tab switches / page reloads (only node.properties survives).
  // commit() stamps meta.original_w/h on every save though, so cropJson
  // carries the dims forward. Without this fallback, opening a saved
  // workflow and immediately editing W/H would compute alignment with
  // dims=null, fall back to {x:0, y:0}, and silently produce a top-left
  // crop even with "Center crop" still selected — exactly the bug the
  // user hit (May 2026).
  function dimsWithFallback() {
    const dims = getImageDims?.() || null;
    if (dims) return dims;
    const meta = readMeta();
    if (meta.original_w && meta.original_h) {
      return { w: Math.round(meta.original_w), h: Math.round(meta.original_h) };
    }
    return null;
  }

  function clampW(w) {
    const dims = dimsWithFallback();
    let v = Math.max(1, Math.round(w || 1));
    if (dims) v = Math.min(v, dims.w);
    return v;
  }
  function clampH(h) {
    const dims = dimsWithFallback();
    let v = Math.max(1, Math.round(h || 1));
    if (dims) v = Math.min(v, dims.h);
    return v;
  }
  function clampX(x, w) {
    const dims = dimsWithFallback();
    let v = Math.max(0, Math.round(x || 0));
    if (dims) v = Math.min(v, Math.max(0, dims.w - w));
    return v;
  }
  function clampY(y, h) {
    const dims = dimsWithFallback();
    let v = Math.max(0, Math.round(y || 0));
    if (dims) v = Math.min(v, Math.max(0, dims.h - h));
    return v;
  }

  // Apply ratio lock to (w, h) given ratioIdx; returns adjusted {w, h}.
  // Mirrors the editor's _computeWH: when the OTHER dimension would overflow
  // the image bounds (e.g. typing W=1024 with 9:16 on a 1024×1024 image), the
  // DRIVEN dimension is shrunk so the cropped rect fits — otherwise picking a
  // portrait ratio on a square source silently collapsed to a square crop.
  function applyRatio(targetW, targetH, ratioIdx, driven) {
    const r = RATIOS[ratioIdx];
    if (!r || r.w === 0) return { w: targetW, h: targetH };
    const ratio = r.w / r.h;
    const dims = dimsWithFallback();
    const maxW = dims ? dims.w : Infinity;
    const maxH = dims ? dims.h : Infinity;

    if (driven === "w") {
      let w = Math.max(1, Math.round(targetW));
      w = Math.min(w, maxW, Math.floor(maxH * ratio));
      const h = Math.round(w / ratio);
      return { w, h };
    } else {
      let h = Math.max(1, Math.round(targetH));
      h = Math.min(h, maxH, Math.floor(maxW / ratio));
      const w = Math.round(h * ratio);
      return { w, h };
    }
  }

  // Compute final X/Y honoring the active alignment. Falls back to existing
  // values from cropJson when alignment is "free" or dims are missing.
  function resolveXY(alignId, w, h, fallbackMeta) {
    const aligned = computeAlignedXY(alignId, w, h, dimsWithFallback());
    if (aligned) return aligned;
    return {
      x: clampX(fallbackMeta.crop_x ?? 0, w),
      y: clampY(fallbackMeta.crop_y ?? 0, h),
    };
  }

  // Read a numeric value from a text input, supporting math expressions.
  // Falls back to the supplied default when expression evaluation fails.
  function readNum(inputEl, dflt) {
    const v = evalExpr(inputEl.value);
    return Number.isFinite(v) ? v : dflt;
  }

  // ── Event handlers ──

  function onWHCommit(driven) {
    const meta = readMeta();
    const ratioIdx = parseInt(ratioSelect.value, 10) || 0;
    const alignId = meta.crop_align || defaultAlignForMeta(meta);
    const wRaw = readNum(wInput.input, meta.crop_w ?? 1);
    const hRaw = readNum(hInput.input, meta.crop_h ?? 1);
    const adjusted = applyRatio(wRaw, hRaw, ratioIdx, driven);
    const w = clampW(adjusted.w);
    const h = clampH(adjusted.h);
    const xy = resolveXY(alignId, w, h, meta);
    commit({ crop_w: w, crop_h: h, crop_x: xy.x, crop_y: xy.y, ratio_idx: ratioIdx, crop_align: alignId });
    refresh();
  }

  function onXYCommit() {
    // Editing X or Y is treated as overriding the lock — alignment
    // automatically switches to Free so the user's typed coords stick.
    const meta = readMeta();
    const w = clampW(meta.crop_w ?? readNum(wInput.input, 1));
    const h = clampH(meta.crop_h ?? readNum(hInput.input, 1));
    const x = clampX(readNum(xInput.input, 0), w);
    const y = clampY(readNum(yInput.input, 0), h);
    commit({ crop_x: x, crop_y: y, crop_align: "free" });
    refresh();
  }

  function onRatioCommit() {
    const meta = readMeta();
    const ratioIdx = parseInt(ratioSelect.value, 10) || 0;
    const alignId = meta.crop_align || defaultAlignForMeta(meta);
    const wRaw = clampW(meta.crop_w ?? readNum(wInput.input, 1));
    const hRaw = clampH(meta.crop_h ?? readNum(hInput.input, 1));
    const adjusted = applyRatio(wRaw, hRaw, ratioIdx, "w");
    const w = clampW(adjusted.w);
    const h = clampH(adjusted.h);
    const xy = resolveXY(alignId, w, h, meta);
    commit({ ratio_idx: ratioIdx, crop_w: w, crop_h: h, crop_x: xy.x, crop_y: xy.y, crop_align: alignId });
    refresh();
  }

  function onAlignmentCommit() {
    const meta = readMeta();
    const alignId = alignSelect.value;
    const w = clampW(meta.crop_w ?? readNum(wInput.input, 1));
    const h = clampH(meta.crop_h ?? readNum(hInput.input, 1));
    const xy = resolveXY(alignId, w, h, meta);
    commit({ crop_align: alignId, crop_w: w, crop_h: h, crop_x: xy.x, crop_y: xy.y });
    refresh();
  }

  wInput.input.addEventListener("change", () => onWHCommit("w"));
  hInput.input.addEventListener("change", () => onWHCommit("h"));
  xInput.input.addEventListener("change", onXYCommit);
  yInput.input.addEventListener("change", onXYCommit);

  // Up/Down arrows act as numeric spinners on the text inputs (since
  // type=text doesn't get them natively). Shift = ×8 step for fast nudges.
  function attachArrowSpinner(inputEl) {
    inputEl.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const cur = evalExpr(inputEl.value);
      if (!Number.isFinite(cur)) return;
      const step = e.shiftKey ? 8 : 1;
      const delta = e.key === "ArrowUp" ? step : -step;
      inputEl.value = String(Math.max(0, Math.round(cur + delta)));
      inputEl.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  for (const el of [wInput.input, hInput.input, xInput.input, yInput.input]) {
    attachArrowSpinner(el);
  }

  // Block keyboard from bubbling to ComfyUI canvas (would otherwise pan/zoom).
  for (const el of [wInput.input, hInput.input, xInput.input, yInput.input, ...ratioSelect.keyTargets, ...alignSelect.keyTargets]) {
    el.addEventListener("keydown", (e) => e.stopImmediatePropagation());
  }

  // ── Refresh: read cropJson + image dims, populate inputs ──
  // Always force-updates input values (no activeElement guard) so a typed
  // expression like "1024+512" gets replaced with its evaluated result on
  // commit, even if the input is still focused after pressing Enter.
  function refresh() {
    const meta = readMeta();
    const dims = dimsWithFallback();
    const alignId = meta.crop_align || defaultAlignForMeta(meta);

    let w, h, x, y;
    if (meta.crop_w) {
      w = Math.round(meta.crop_w);
      h = Math.round(meta.crop_h);
      x = Math.round(meta.crop_x ?? 0);
      y = Math.round(meta.crop_y ?? 0);
    } else if (dims) {
      w = dims.w; h = dims.h; x = 0; y = 0;
    } else {
      w = 1024; h = 1024; x = 0; y = 0;
    }

    wInput.input.value = w;
    hInput.input.value = h;
    xInput.input.value = x;
    yInput.input.value = y;
    ratioSelect.value = String(meta.ratio_idx ?? 0);
    alignSelect.value = alignId;
  }

  // dispose: close a list left open when the node goes away (its document
  // listeners would otherwise stay until the next outside click).
  // Only THIS panel's list: another Crop's open list is not ours to close.
  const dispose = () => { if (ratioSelect.isOpen() || alignSelect.isOpen()) closeComboPopup(); };
  return { el: root, refresh, dispose };
}

// "Square" / "Landscape" / "Portrait", shown at the right of a ratio's row in
// the list (the closed dropdown carries it in the label already).
function ratioHint(r) {
  if (r.w === 0 || r.h === 0) return "any shape";
  if (r.w === r.h) return "Square";
  return r.w > r.h ? "Landscape" : "Portrait";
}

// Names a screen reader announces for the four fields (the visible "W" / "H" /
// "X" / "Y" label is not tied to its input).
const FIELD_NAMES = { W: "Crop width", H: "Crop height", X: "Crop left edge (X)", Y: "Crop top edge (Y)" };

// Internal helper — builds a labelled cell with a text input.
// type=text (not number) so the user can type math expressions like
// "1024+512" — evalExpr is called on commit.
function makeTextInput(label, defaultVal) {
  const cell = document.createElement("div");
  cell.className = "pix-cropp-cell";
  const lbl = document.createElement("label");
  lbl.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.spellcheck = false;
  input.setAttribute("aria-label", FIELD_NAMES[label] || label);
  if (defaultVal != null) input.value = String(defaultVal);
  cell.append(lbl, input);
  return { cell, input };
}

// ── The dropdown: [ value v ] + a list on document.body ──
// One list open at a time across every Crop node; its close() is tracked so
// dispose() and a second open both tear the document listeners down.
let _closeActivePopup = null;
function closeComboPopup() { _closeActivePopup?.(); }

// options: [{ value, label, item?, hint? }] - `label` shows on the closed
// dropdown, `item` (default label) + `hint` on the list row.
// onPick runs after a USER choice only; setting `.value` from code is silent,
// exactly like assigning a <select>'s value.
function makeCombo({ name, title, options, onPick }) {
  let value = options[0].value;
  const el = document.createElement("div");
  el.className = "pix-cropp-combo";
  const dd = document.createElement("button");
  dd.type = "button";
  dd.className = "pix-cropp-dd";
  dd.title = title;
  dd.setAttribute("aria-haspopup", "listbox");
  const val = document.createElement("span");
  val.className = "pix-cropp-dd-val";
  const arrow = document.createElement("span");
  arrow.className = "pix-cropp-dd-arrow";
  arrow.textContent = "▼";
  arrow.setAttribute("aria-hidden", "true");
  dd.append(val, arrow);
  el.append(dd);

  const indexOf = (v) => Math.max(0, options.findIndex((o) => o.value === v));
  function paint() {
    const o = options[indexOf(value)];
    val.textContent = o.label;
    dd.setAttribute("aria-label", `${name}: ${o.label}`);
  }
  function pick(v) {
    if (v === value) return;
    value = v;
    paint();
    onPick?.(v);
  }
  const step = (d) => pick(options[(indexOf(value) + d + options.length) % options.length].value);
  // Arrow keys step through the options, as they did on the <select>.
  dd.addEventListener("keydown", (e) => {
    const d = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
    if (!d) return;
    e.preventDefault();
    step(d);
    // A key step fires no click or change, so the pack-wide change net
    // (node UI convention #31) cannot see it; the <select> sent `change` here.
    notifyGraphChanged();
  });
  dd.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_closeActivePopup && dd.getAttribute("aria-expanded") === "true") { closeComboPopup(); return; }
    openList();
  });

  function openList() {
    closeComboPopup();
    const pop = document.createElement("div");
    pop.className = "pix-cropp-pop";
    pop.setAttribute("role", "listbox");
    pop.setAttribute("aria-label", name);
    for (const o of options) {
      const row = document.createElement("div");
      row.className = "pix-cropp-pop-item" + (o.value === value ? " active" : "");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", o.value === value ? "true" : "false");
      const l = document.createElement("span");
      l.className = "pix-cropp-pop-label";
      l.textContent = o.item || o.label;
      row.appendChild(l);
      if (o.hint) {
        const h = document.createElement("span");
        h.className = "pix-cropp-pop-hint";
        h.textContent = o.hint;
        row.appendChild(h);
      }
      row.addEventListener("click", (e) => { e.stopPropagation(); close(); pick(o.value); });
      pop.appendChild(row);
    }
    document.body.appendChild(pop);
    placeZoomedPopup(pop, dd, { baseFontPx: 12, minWidthPx: 150, baseMaxHeightPx: 320 });
    dd.setAttribute("aria-expanded", "true");

    // Outside press / wheel / Esc close it, all in the CAPTURE phase; a wheel
    // or press INSIDE the list must not (it scrolls when the canvas is zoomed).
    const outside = (e) => { if (!pop.contains(e.target) && !dd.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    function close() {
      pop.remove();
      dd.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("mousedown", outside, true);
      document.removeEventListener("wheel", outside, true);
      document.removeEventListener("keydown", onKey, true);
      if (_closeActivePopup === close) _closeActivePopup = null;
    }
    _closeActivePopup = close;
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("mousedown", outside, true);
    document.addEventListener("wheel", outside, true);
    document.addEventListener("keydown", onKey, true);
  }

  paint();
  return {
    el,
    keyTargets: [dd],
    isOpen: () => dd.getAttribute("aria-expanded") === "true",
    get value() { return value; },
    // A value that is not an option reads back "" (it shows the first one),
    // as a <select> did: the commits then fall back to Free exactly as before.
    set value(v) { v = String(v); value = options.some((o) => o.value === v) ? v : ""; paint(); },
  };
}
