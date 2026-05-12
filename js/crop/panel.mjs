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

import { BRAND } from "../shared/index.mjs";
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
.pix-cropp-cell:hover { border-color: #888; }
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
.pix-cropp-combo {
  flex: 1;
  min-width: 0;
  background: #1d1d1d;
  color: #ccc;
  border: 1px solid #666;
  border-radius: 4px;
  outline: 0;
  padding: 4px 4px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  min-height: 24px;
  transition: border-color 0.08s;
  text-align: center;
  text-align-last: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}
.pix-cropp-combo:hover { border-color: #888; }
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

  const ratioSelect = document.createElement("select");
  ratioSelect.className = "pix-cropp-combo";
  for (let i = 0; i < RATIOS.length; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = ratioLabel(RATIOS[i]);
    ratioSelect.appendChild(opt);
  }

  const alignSelect = document.createElement("select");
  alignSelect.className = "pix-cropp-combo";
  for (const a of ALIGNMENTS) {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = a.label;
    alignSelect.appendChild(opt);
  }

  row3.append(ratioSelect, alignSelect);

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
  ratioSelect.addEventListener("change", onRatioCommit);
  alignSelect.addEventListener("change", onAlignmentCommit);

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
  for (const el of [wInput.input, hInput.input, xInput.input, yInput.input, ratioSelect, alignSelect]) {
    el.addEventListener("keydown", (e) => e.stopPropagation());
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

  return { el: root, refresh };
}

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
  if (defaultVal != null) input.value = String(defaultVal);
  cell.append(lbl, input);
  return { cell, input };
}
