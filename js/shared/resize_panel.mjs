// Moved from js/load_image/resize_modes.mjs so Image Resize Pixaroma can reuse
// it. Per-mode builders take a `stateKey` so each node reads/writes its own
// node.properties[...] state. Load Image keeps importing via the thin shim at
// js/load_image/resize_modes.mjs.
import { openPixaromaColorPickerModal } from "./color_picker.mjs";
import { BRAND } from "./utils.mjs";

// The per-mode panels use `pix-li-*` class names. Load Image injects these in
// its own ui.mjs; any OTHER node reusing buildModePanel must call
// injectResizePanelCSS() so the panels are styled. Guarded by a unique id so
// it is a no-op when Load Image (or a previous call) already added equivalent
// rules — the panel CSS is presentational, so the small overlap with Load
// Image's stylesheet is intentional and harmless. If you restyle the panels,
// update BOTH this block and js/load_image/ui.mjs.
let _resizePanelCSSInjected = false;
export function injectResizePanelCSS() {
  if (_resizePanelCSSInjected || document.getElementById("pix-resize-panel-css")) return;
  _resizePanelCSSInjected = true;
  const css = `
    .pix-li-panel {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 8px 10px;
    }
    .pix-li-panel-row { display: flex; align-items: center; gap: 8px; }
    .pix-li-panel-label {
      font-size: 9px;
      color: #999;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      text-align: center;
      margin-bottom: 6px;
    }
    .pix-li-panel input[type="range"] { flex: 1; accent-color: ${BRAND}; }
    .pix-li-panel input[type="text"], .pix-li-panel input[type="number"] {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 3px;
      padding: 4px 6px;
      color: ${BRAND};
      font-size: 12px;
      font-weight: 600;
      text-align: center;
      font-family: inherit;
      box-sizing: border-box;
    }
    .pix-li-panel input[type="text"]:focus, .pix-li-panel input[type="number"]:focus {
      outline: none;
      border-color: ${BRAND};
    }
    .pix-li-panel-readout {
      font-size: 9px;
      color: #888;
      font-family: inherit;
      text-align: center;
      margin-top: 6px;
    }
    .pix-li-quickpicks { display: grid; gap: 3px; margin-bottom: 8px; }
    .pix-li-quickpick {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 3px;
      color: #aaa;
      padding: 4px 0;
      text-align: center;
      font-size: 10px;
      cursor: pointer;
      font-family: inherit;
    }
    .pix-li-quickpick:hover { border-color: #666; color: #ddd; }
    .pix-li-quickpick.active { background: ${BRAND}; color: #fff; border-color: ${BRAND}; }
    .pix-li-ratio-chips {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 3px;
      margin-bottom: 8px;
    }
    .pix-li-ratio-chip {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 3px;
      padding: 4px 0;
      text-align: center;
      font-size: 9px;
      color: #aaa;
      cursor: pointer;
      font-family: inherit;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }
    .pix-li-ratio-chip:hover { border-color: #666; color: #ddd; }
    .pix-li-ratio-chip.active { background: ${BRAND}; color: #fff; border-color: ${BRAND}; }
    .pix-li-cropped {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 6px;
    }
    .pix-li-cropped > div {
      text-align: center;
      font-size: 10px;
      padding: 5px 0;
      color: #aaa;
      cursor: pointer;
      user-select: none;
    }
    .pix-li-cropped > div.active { background: ${BRAND}; color: #fff; }
    .pix-li-pad-row { display: flex; align-items: center; gap: 6px; font-size: 10px; color: #888; }
    .pix-li-pad-swatch {
      width: 22px; height: 22px;
      border-radius: 3px;
      border: 1px solid #444;
      cursor: pointer;
    }
    .pix-li-custom-ratio-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-bottom: 6px;
    }
    .pix-li-custom-ratio-input-wrap { width: 64px; }
    .pix-li-custom-ratio-row .pix-li-custom-ratio-swap {
      width: 28px;
      height: auto;
      align-self: stretch;
      min-height: 22px;
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 3px;
      color: #aaa;
      cursor: pointer;
      position: relative;
      padding: 0;
      display: inline-block;
    }
    .pix-li-custom-ratio-swap::before {
      content: "";
      position: absolute;
      inset: 0;
      background-color: currentColor;
      -webkit-mask: url("/pixaroma/assets/icons/ui/swap.svg") center/14px 14px no-repeat;
              mask: url("/pixaroma/assets/icons/ui/swap.svg") center/14px 14px no-repeat;
      pointer-events: none;
    }
    .pix-li-custom-ratio-swap:hover { color: ${BRAND}; border-color: ${BRAND}; }
    .pix-li-panel-row.pix-li-centered { justify-content: center; }
    .pix-li-input-wide { width: 70% !important; max-width: 200px; }
    .pix-li-numinput {
      display: inline-flex;
      align-items: stretch;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      overflow: hidden;
      box-sizing: border-box;
    }
    .pix-li-numinput:focus-within { border-color: ${BRAND}; }
    .pix-li-numinput input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      padding: 2px 6px;
      color: ${BRAND};
      font-size: 11px;
      font-weight: 600;
      text-align: center;
      font-family: inherit;
      width: 100%;
      min-width: 0;
    }
    .pix-li-spin {
      display: flex;
      flex-direction: column;
      width: 12px;
      border-left: 1px solid #444;
    }
    .pix-li-spin > button {
      flex: 1;
      background: #232323;
      border: none;
      padding: 0;
      cursor: pointer;
      color: #aaa;
      font-size: 8px;
      line-height: 1;
      position: relative;
    }
    .pix-li-spin > button:hover { background: #333; color: ${BRAND}; }
    .pix-li-spin-up { border-bottom: 1px solid #444; }
    .pix-li-spin-up::before,
    .pix-li-spin-down::before {
      content: "";
      position: absolute;
      left: 50%;
      top: 50%;
      width: 6px;
      height: 6px;
      transform: translate(-50%, -50%) rotate(-45deg);
      border-top: 1px solid currentColor;
      border-right: 1px solid currentColor;
    }
    .pix-li-spin-up::before { transform: translate(-50%, -25%) rotate(-45deg); }
    .pix-li-spin-down::before { transform: translate(-50%, -75%) rotate(135deg); }
    .pix-li-wh-row {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 6px;
      align-items: end;
    }
    .pix-li-wh-field { display: flex; flex-direction: column; gap: 3px; }
    .pix-li-wh-label {
      font-size: 9px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      text-align: center;
    }
    .pix-li-wh-input-wrap { width: 100%; }
    .pix-li-swap {
      width: 26px;
      height: 22px;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #aaa;
      cursor: pointer;
      padding: 0;
      position: relative;
      align-self: end;
    }
    .pix-li-swap::before {
      content: "";
      position: absolute;
      inset: 0;
      background-color: currentColor;
      -webkit-mask: url("/pixaroma/assets/icons/ui/swap.svg") center/12px 12px no-repeat;
              mask: url("/pixaroma/assets/icons/ui/swap.svg") center/12px 12px no-repeat;
      pointer-events: none;
    }
    .pix-li-swap:hover { color: ${BRAND}; border-color: ${BRAND}; }
    .pix-li-wh-preview {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      margin-top: 8px;
    }
    .pix-li-wh-rect {
      background: rgba(246,103,68,0.18);
      border: 1px solid ${BRAND};
      border-radius: 2px;
      transition: width 0.12s ease, height 0.12s ease;
    }
    .pix-li-wh-rect-label { font-size: 9px; color: #999; font-family: inherit; }
    /* Fit-inside nested preview: gray target-box frame + orange actual output. */
    .pix-li-wh-frame {
      border: 1px solid rgba(200,200,200,0.45);
      border-radius: 2px;
      display: flex; align-items: center; justify-content: center;
      transition: width 0.12s ease, height 0.12s ease;
    }
    .pix-li-wh-out {
      background: rgba(246,103,68,0.35);
      border: 1px solid ${BRAND};
      border-radius: 1px;
      transition: width 0.12s ease, height 0.12s ease;
    }
    .pix-li-shape {
      display: inline-block;
      background: rgba(180,180,180,0.25);
      border: 1px solid #888;
      border-radius: 1px;
      box-sizing: border-box;
      flex-shrink: 0;
    }
    .pix-li-ratio-chip.active .pix-li-shape {
      background: rgba(255,255,255,0.4);
      border-color: rgba(255,255,255,0.85);
    }
    /* Custom chip is text-only (no shape) — keep the base flex centering so
       "Custom" sits dead-center like every other chip (display:block left it
       top-aligned within the stretched grid cell). */
    .pix-li-ratio-chip.pix-li-ratio-custom-chip { width: 100%; }
    /* Pad panel — per-side pixel boxes in a cross around a live size readout. */
    .pix-li-padgrid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      grid-template-rows: auto auto auto;
      gap: 6px;
      align-items: center;
      justify-items: center;
    }
    .pix-li-pad-top { grid-column: 2; grid-row: 1; }
    .pix-li-pad-left { grid-column: 1; grid-row: 2; }
    .pix-li-pad-right { grid-column: 3; grid-row: 2; }
    .pix-li-pad-bottom { grid-column: 2; grid-row: 3; }
    .pix-li-pad-mid {
      grid-column: 2; grid-row: 2;
      min-height: 40px;
      display: flex; align-items: center; justify-content: center;
      text-align: center;
    }
    .pix-li-pad-input-wrap { width: 100%; max-width: 82px; }
    .pix-li-pad-inlabel {
      display: flex; align-items: center;
      color: ${BRAND}; font-size: 9px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.5px;
      padding: 0 2px 0 7px; flex: none;
    }
    .pix-li-pad-labeled input { text-align: right !important; padding-right: 6px !important; }
    .pix-li-pad-outdims { font-size: 11px; font-weight: 600; color: ${BRAND}; }
    .pix-li-pad-outhint { font-size: 8px; color: #777; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1.3; }
    .pix-li-pad-colorcell { grid-column: 3; grid-row: 3; display: flex; align-items: center; justify-content: center; }
    .pix-li-pad-colorcell .pix-li-pad-swatch { width: 26px; height: 26px; }
  `;
  const s = document.createElement("style");
  s.id = "pix-resize-panel-css";
  s.textContent = css;
  document.head.appendChild(s);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Recursive-descent math evaluator copied from Resolution Pixaroma. Supports
// `+ - * / ( )` and decimals only. NEVER use eval()/Function() — a shared
// workflow could otherwise execute arbitrary code on import. Returns NaN for
// any invalid input. Examples: "1024", "1024+128", "512*2", "(1024+128)/2".
function safeMathEval(str) {
  if (typeof str !== "string") return NaN;
  const s = str.trim();
  if (!s) return NaN;
  if (!/^[0-9+\-*/().\s]+$/.test(s)) return NaN;
  if (s.length > 256) return NaN;
  let pos = 0;
  const MAX_DEPTH = 64;
  let depth = 0;
  const skipWs = () => { while (pos < s.length && s[pos] === " ") pos++; };
  const eat = (ch) => { skipWs(); if (s[pos] === ch) { pos++; return true; } return false; };
  function parseExpr() {
    let v = parseTerm();
    for (;;) {
      skipWs();
      if (eat("+")) v += parseTerm();
      else if (eat("-")) v -= parseTerm();
      else break;
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    for (;;) {
      skipWs();
      if (eat("*")) v *= parseFactor();
      else if (eat("/")) {
        const d = parseFactor();
        if (d === 0) return NaN;
        v /= d;
      } else break;
    }
    return v;
  }
  function parseFactor() {
    if (++depth > MAX_DEPTH) return NaN;
    skipWs();
    if (eat("+"))  { const r = parseFactor(); depth--; return r; }
    if (eat("-"))  { const r = -parseFactor(); depth--; return r; }
    if (eat("(")) {
      const v = parseExpr();
      if (!eat(")")) { depth--; return NaN; }
      depth--;
      return v;
    }
    let num = "";
    while (pos < s.length && /[0-9.]/.test(s[pos])) num += s[pos++];
    depth--;
    if (!num) return NaN;
    if ((num.match(/\./g) || []).length > 1) return NaN;
    return parseFloat(num);
  }
  const v = parseExpr();
  skipWs();
  if (pos !== s.length) return NaN;
  return v;
}

// Round `v` to the precision implied by `step`. step=1 → integer, step=0.1
// → 1 decimal, step=0.05 → 2 decimals. Prevents floating-point drift like
// 1.0 + 0.1 = 1.0999999999999999 after repeated arrow steps.
function roundToStep(v, step) {
  if (!Number.isFinite(v)) return v;
  if (step >= 1) return Math.round(v);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const m = Math.pow(10, decimals);
  return Math.round(v * m) / m;
}

// Shared text-input factory with math eval, arrow stepping, custom +/-
// spinners, and proper event isolation so ComfyUI's canvas shortcuts don't
// steal Enter/Tab/Arrow keys while the user is typing.
//
// Returns `{ wrap, input }`: `wrap` is the outer flex container (input +
// stacked +/- buttons), `input` is the <input> itself. Callers can apply
// utility classes to either.
//
//   opts: { value, min, max, step, format(v)->string, parse(s)->number, onCommit(num) }
function makeNumericInput(opts) {
  const wrap = document.createElement("div");
  wrap.className = "pix-li-numinput";

  const inp = document.createElement("input");
  inp.type = "text";
  inp.inputMode = "decimal";
  inp.spellcheck = false;
  inp.autocomplete = "off";
  inp.title = "Math allowed: 1024+64, 512*2, (1024+128)/2";
  const fmt = opts.format || ((v) => String(v));
  const parse = opts.parse || ((s) => {
    const v = safeMathEval(s);
    return Number.isFinite(v) ? v : NaN;
  });
  inp.value = fmt(opts.value);

  const spin = document.createElement("div");
  spin.className = "pix-li-spin";
  const upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.className = "pix-li-spin-up";
  upBtn.tabIndex = -1; // skip in Tab traversal so W → H goes directly
  upBtn.setAttribute("aria-label", "Increase");
  const downBtn = document.createElement("button");
  downBtn.type = "button";
  downBtn.className = "pix-li-spin-down";
  downBtn.tabIndex = -1;
  downBtn.setAttribute("aria-label", "Decrease");
  spin.append(upBtn, downBtn);

  wrap.append(inp, spin);

  function clamp(v) {
    return Math.max(opts.min ?? -Infinity, Math.min(opts.max ?? Infinity, v));
  }

  const step = opts.step ?? 1;

  function step1(dir, mult = 1) {
    const raw = parse(inp.value);
    const base = Number.isFinite(raw) ? raw : opts.value;
    const next = clamp(roundToStep(base + dir * step * mult, step));
    inp.value = fmt(next);
    opts.value = next;
    opts.onCommit?.(next);
  }

  function commit() {
    const raw = parse(inp.value);
    let v = Number.isFinite(raw) ? clamp(roundToStep(raw, step)) : opts.value;
    inp.value = fmt(v);
    opts.value = v;
    opts.onCommit?.(v);
  }

  inp.addEventListener("blur", commit);
  inp.addEventListener("keydown", (e) => {
    // stopImmediatePropagation — needed because LiteGraph / ComfyUI Vue
    // listen at the document level with capture phase and would otherwise
    // grab Arrow / Tab / Enter to pan the canvas or switch workflow tabs.
    e.stopImmediatePropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      inp.blur();
      return;
    }
    if (e.key === "Tab") {
      commit();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      step1(e.key === "ArrowUp" ? 1 : -1, e.shiftKey ? 10 : 1);
    }
  });

  // Click handlers for the visible +/- spinner buttons. Same step / shift
  // behavior as the keyboard arrows so the two stay in sync.
  upBtn.addEventListener("mousedown", (e) => {
    e.preventDefault(); // don't steal focus from the input
    e.stopPropagation();
    step1(1, e.shiftKey ? 10 : 1);
  });
  downBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    step1(-1, e.shiftKey ? 10 : 1);
  });

  return { wrap, input: inp };
}

// ── Preview math (mirrors Python _resize_frame in node_load_image.py) ───────

// JS mirror of Python's resize math. Returns post-resize (W, H) WITHOUT
// actually transforming any image. Used for the live preview badge.
export function previewResize(W, H, state) {
  if (!W || !H) return { w: W, h: H };
  const mode = state.mode || "off";
  const allowUp = !!state.allow_upscale;
  let nw = W, nh = H;

  function applyFactor(f) {
    if (!allowUp) f = Math.min(f, 1.0);
    f = Math.min(f, 8.0);
    return { w: Math.round(W * f), h: Math.round(H * f) };
  }

  if (mode === "max_mp") {
    const tgt = +state.max_mp || 1.0;
    // ComfyUI binary-MP convention: 1 MP = 1024*1024 = 1,048,576 pixels.
    // Matches native ImageScaleToTotalPixels so 1024² at 1 MP is unchanged.
    const targetPx = tgt * 1024 * 1024;
    const currentPx = W * H;
    const f = currentPx > 0 ? Math.sqrt(targetPx / currentPx) : 1.0;
    ({ w: nw, h: nh } = applyFactor(f));
  } else if (mode === "longest_side") {
    const tgt = +state.longest_side || 1024;
    const f = tgt / Math.max(W, H);
    ({ w: nw, h: nh } = applyFactor(f));
  } else if (mode === "scale_factor") {
    let f = +state.scale_factor || 1.0;
    ({ w: nw, h: nh } = applyFactor(f));
  } else if (mode === "fit_inside") {
    const tw = +state.fit_w || 1024, th = +state.fit_h || 1024;
    const f = Math.min(tw / W, th / H);
    ({ w: nw, h: nh } = applyFactor(f));
  } else if (mode === "cover") {
    const tw = +state.cover_w || 1024, th = +state.cover_h || 1024;
    if (state.crop_scale === false) {
      // Normal crop, no scaling — output clamps to the image size.
      nw = Math.min(tw, W); nh = Math.min(th, H);
    } else {
      const f = Math.max(tw / W, th / H);
      if (!allowUp && f > 1) {
        const f2 = Math.min(tw / W, th / H, 1.0);
        ({ w: nw, h: nh } = applyFactor(f2));
      } else {
        nw = tw; nh = th;
      }
    }
  } else if (mode === "match_ratio") {
    const rw = Math.max(1, +state.ratio_w || 1);
    const rh = Math.max(1, +state.ratio_h || 1);
    const action = state.ratio_action || "crop";
    const tgt = rw / rh, cur = W / H;
    if (action === "crop") {
      if (cur > tgt) { nw = Math.round(H * tgt); nh = H; }
      else           { nw = W; nh = Math.round(W / tgt); }
    } else {
      if (cur > tgt) { nw = W; nh = Math.round(W / tgt); }
      else           { nw = Math.round(H * tgt); nh = H; }
    }
  } else if (mode === "pad") {
    const pl = Math.max(0, +state.pad_left || 0);
    const pr = Math.max(0, +state.pad_right || 0);
    const pt = Math.max(0, +state.pad_top || 0);
    const pb = Math.max(0, +state.pad_bottom || 0);
    nw = W + pl + pr;
    nh = H + pt + pb;
  }

  // Snap post-modifier — FLOOR to nearest multiple, not round-to-nearest.
  // Floor guarantees the snap step never pushes a dim ABOVE the cap of a
  // cap-bounded mode (max_mp, longest_side, fit_inside). Mirrors Python's
  // _apply_snap in node_load_image.py.
  const snap = +state.snap || 0;
  if (snap > 0) {
    nw = Math.max(8, Math.floor(nw / snap) * snap);
    nh = Math.max(8, Math.floor(nh / snap) * snap);
  }
  nw = Math.max(8, Math.min(nw, 16384));
  nh = Math.max(8, Math.min(nh, 16384));
  return { w: nw, h: nh };
}

export function formatMP(w, h) {
  return ((w * h) / 1_000_000).toFixed(2);
}

// ── Aspect-ratio chip shape (tiny rectangle scaled to W:H) ──────────────────

function makeAspectShape(rw, rh, maxW = 14, maxH = 11) {
  const shape = document.createElement("span");
  shape.className = "pix-li-shape";
  const aspect = rw / rh;
  let w, h;
  if (aspect >= maxW / maxH) {
    w = maxW; h = maxW / aspect;
  } else {
    h = maxH; w = maxH * aspect;
  }
  shape.style.width = `${Math.max(1, Math.round(w))}px`;
  shape.style.height = `${Math.max(1, Math.round(h))}px`;
  return shape;
}

// ── Panel-section helpers ───────────────────────────────────────────────────

function makePanelHeader(text) {
  const lbl = document.createElement("div");
  lbl.className = "pix-li-panel-label";
  lbl.textContent = text;
  return lbl;
}

function makeReadout(text) {
  const ro = document.createElement("div");
  ro.className = "pix-li-panel-readout";
  ro.textContent = text;
  return ro;
}

function makeSwapButton(title) {
  const swap = document.createElement("button");
  swap.type = "button";
  swap.className = "pix-li-swap";
  swap.title = title || "Swap";
  swap.setAttribute("aria-label", title || "Swap");
  return swap;
}

// ── Per-mode panel builders ─────────────────────────────────────────────────

function buildMaxMPPanel(node, state, writeState, onChange, stateKey, extra = {}) {
  const panel = document.createElement("div");
  panel.className = "pix-li-panel";
  panel.appendChild(makePanelHeader("Max Megapixels"));

  const quickWrap = document.createElement("div");
  quickWrap.className = "pix-li-quickpicks";
  const QUICK = [0.25, 0.5, 1.0, 2.0, 4.0, 8.0];
  quickWrap.style.gridTemplateColumns = `repeat(${extra.oneLine ? QUICK.length : 3}, 1fr)`;
  const cur = +state.max_mp || 1.0;
  const qpEls = [];
  for (const v of QUICK) {
    const q = document.createElement("div");
    q.className = "pix-li-quickpick" + (Math.abs(v - cur) < 0.001 ? " active" : "");
    q.textContent = v % 1 === 0 ? `${v.toFixed(0)} MP` : `${v} MP`;
    q.dataset.v = String(v);
    quickWrap.appendChild(q);
    qpEls.push(q);
  }
  panel.appendChild(quickWrap);

  const row = document.createElement("div");
  row.className = "pix-li-panel-row pix-li-centered";
  const { wrap: inpWrap, input: inp } = makeNumericInput({
    value: cur,
    min: 0.1, max: 64, step: 0.1,
    format: (v) => String(v),
    onCommit: (v) => {
      v = parseFloat(v.toFixed(2));
      for (const q of qpEls) {
        q.classList.toggle("active", Math.abs(parseFloat(q.dataset.v) - v) < 0.001);
      }
      const s = JSON.parse(node.properties?.[stateKey] || "{}");
      writeState(node, { ...s, max_mp: v });
      onChange?.();
    },
  });
  inpWrap.classList.add("pix-li-input-wide");
  row.appendChild(inpWrap);
  panel.appendChild(row);
  panel.appendChild(makeReadout(""));

  quickWrap.addEventListener("click", (e) => {
    const q = e.target.closest(".pix-li-quickpick");
    if (!q) return;
    e.stopPropagation();
    const v = parseFloat(q.dataset.v);
    inp.value = String(v);
    for (const el of qpEls) {
      el.classList.toggle("active", Math.abs(parseFloat(el.dataset.v) - v) < 0.001);
    }
    const s = JSON.parse(node.properties?.[stateKey] || "{}");
    writeState(node, { ...s, max_mp: v });
    onChange?.();
  });
  return panel;
}

function buildLongestSidePanel(node, state, writeState, onChange, stateKey) {
  const panel = document.createElement("div");
  panel.className = "pix-li-panel";
  panel.appendChild(makePanelHeader("Longest Side"));

  const quickWrap = document.createElement("div");
  quickWrap.className = "pix-li-quickpicks";
  quickWrap.style.gridTemplateColumns = "repeat(5, 1fr)";
  const QUICK = [512, 768, 1024, 1536, 2048];
  const cur = +state.longest_side || 1024;
  const qpEls = [];
  for (const v of QUICK) {
    const q = document.createElement("div");
    q.className = "pix-li-quickpick" + (v === cur ? " active" : "");
    q.textContent = String(v);
    q.dataset.v = String(v);
    quickWrap.appendChild(q);
    qpEls.push(q);
  }
  panel.appendChild(quickWrap);

  const row = document.createElement("div");
  row.className = "pix-li-panel-row pix-li-centered";
  const { wrap: inpWrap, input: inp } = makeNumericInput({
    value: cur,
    min: 8, max: 16384, step: 1,
    onCommit: (v) => {
      v = Math.round(v);
      for (const q of qpEls) {
        q.classList.toggle("active", parseInt(q.dataset.v, 10) === v);
      }
      const s = JSON.parse(node.properties?.[stateKey] || "{}");
      writeState(node, { ...s, longest_side: v });
      onChange?.();
    },
  });
  inpWrap.classList.add("pix-li-input-wide");
  row.appendChild(inpWrap);
  panel.appendChild(row);
  panel.appendChild(makeReadout(""));

  quickWrap.addEventListener("click", (e) => {
    const q = e.target.closest(".pix-li-quickpick");
    if (!q) return;
    e.stopPropagation();
    const v = parseInt(q.dataset.v, 10);
    inp.value = String(v);
    for (const el of qpEls) {
      el.classList.toggle("active", parseInt(el.dataset.v, 10) === v);
    }
    const s = JSON.parse(node.properties?.[stateKey] || "{}");
    writeState(node, { ...s, longest_side: v });
    onChange?.();
  });
  return panel;
}

function buildScalePanel(node, state, writeState, onChange, stateKey, extra = {}) {
  const panel = document.createElement("div");
  panel.className = "pix-li-panel";
  panel.appendChild(makePanelHeader("Scale by ×"));

  const quickWrap = document.createElement("div");
  quickWrap.className = "pix-li-quickpicks";
  const QUICK = extra.oneLine ? [0.25, 0.5, 1, 2, 4] : [0.25, 0.5, 2, 4];
  quickWrap.style.gridTemplateColumns = `repeat(${QUICK.length}, 1fr)`;
  const cur = +state.scale_factor || 1.0;
  const qpEls = [];
  for (const v of QUICK) {
    const q = document.createElement("div");
    q.className = "pix-li-quickpick" + (Math.abs(v - cur) < 0.001 ? " active" : "");
    q.textContent = `${v}×`;
    q.dataset.v = String(v);
    quickWrap.appendChild(q);
    qpEls.push(q);
  }
  panel.appendChild(quickWrap);

  const row = document.createElement("div");
  row.className = "pix-li-panel-row pix-li-centered";
  const { wrap: inpWrap, input: inp } = makeNumericInput({
    value: cur,
    min: 0.1, max: 4, step: 0.05,
    format: (v) => String(v),
    onCommit: (v) => {
      v = parseFloat(v.toFixed(2));
      for (const q of qpEls) {
        q.classList.toggle("active", Math.abs(parseFloat(q.dataset.v) - v) < 0.001);
      }
      const s = JSON.parse(node.properties?.[stateKey] || "{}");
      writeState(node, { ...s, scale_factor: v });
      onChange?.();
    },
  });
  inpWrap.classList.add("pix-li-input-wide");
  row.appendChild(inpWrap);
  panel.appendChild(row);
  panel.appendChild(makeReadout(""));

  quickWrap.addEventListener("click", (e) => {
    const q = e.target.closest(".pix-li-quickpick");
    if (!q) return;
    e.stopPropagation();
    const v = parseFloat(q.dataset.v);
    inp.value = String(v);
    for (const el of qpEls) {
      el.classList.toggle("active", Math.abs(parseFloat(el.dataset.v) - v) < 0.001);
    }
    const s = JSON.parse(node.properties?.[stateKey] || "{}");
    writeState(node, { ...s, scale_factor: v });
    onChange?.();
  });
  return panel;
}

// W × H panels (Fit inside + Crop to fill) share this builder. Adds a swap
// button between the W and H fields and a small ratio-preview rectangle
// below them.
function buildWHPanel(node, state, writeState, onChange, opts, stateKey) {
  const panel = document.createElement("div");
  panel.className = "pix-li-panel";
  panel.appendChild(makePanelHeader(opts.headerLabel));

  const row = document.createElement("div");
  row.className = "pix-li-wh-row";

  function makeField(labelText, value, key) {
    const wrap = document.createElement("div");
    wrap.className = "pix-li-wh-field";
    const lbl = document.createElement("div");
    lbl.className = "pix-li-wh-label";
    lbl.textContent = labelText;
    const { wrap: inpWrap, input: inp } = makeNumericInput({
      value,
      min: 8, max: 16384, step: 1,
      onCommit: (v) => {
        v = Math.round(v);
        const s = JSON.parse(node.properties?.[stateKey] || "{}");
        writeState(node, { ...s, [key]: v });
        wh[key] = v;
        refreshPreview();
        onChange?.();
      },
    });
    inpWrap.classList.add("pix-li-wh-input-wrap");
    inp.classList.add("pix-li-wh-input");
    wrap.append(lbl, inpWrap);
    return { wrap, inp };
  }

  const wh = {
    [opts.wKey]: state[opts.wKey] ?? 1024,
    [opts.hKey]: state[opts.hKey] ?? 1024,
  };
  const wField = makeField("Width", wh[opts.wKey], opts.wKey);
  const swap = makeSwapButton("Swap Width ↔ Height");
  const hField = makeField("Height", wh[opts.hKey], opts.hKey);
  row.append(wField.wrap, swap, hField.wrap);
  panel.appendChild(row);

  // Aspect-ratio preview. For Fit inside (nestedFit + a known input aspect) the
  // target box is a GRAY frame and the ACTUAL output (input aspect, fitted
  // inside) is an orange rect within it — so the user sees the real result is
  // smaller than the box on one axis. Other panels keep the single orange rect
  // (their output equals the box).
  const nested = !!(opts.nestedFit && opts.inputAspect && opts.inputAspect.w && opts.inputAspect.h);
  const previewWrap = document.createElement("div");
  previewWrap.className = "pix-li-wh-preview";
  let previewRect, innerRect = null;
  if (nested) {
    previewRect = document.createElement("div");
    previewRect.className = "pix-li-wh-frame";
    innerRect = document.createElement("div");
    innerRect.className = "pix-li-wh-out";
    previewRect.appendChild(innerRect);
  } else {
    previewRect = document.createElement("div");
    previewRect.className = "pix-li-wh-rect";
  }
  const previewLabel = document.createElement("div");
  previewLabel.className = "pix-li-wh-rect-label";
  previewWrap.append(previewRect, previewLabel);
  panel.appendChild(previewWrap);

  const PREVIEW_MAX_W = opts.previewMaxW ?? 90;
  const PREVIEW_MAX_H = opts.previewMaxH ?? 40;
  function refreshPreview() {
    const w = wh[opts.wKey] || 1, h = wh[opts.hKey] || 1;
    const a = w / h;
    let pw, ph;
    if (a >= PREVIEW_MAX_W / PREVIEW_MAX_H) {
      pw = PREVIEW_MAX_W; ph = PREVIEW_MAX_W / a;
    } else {
      ph = PREVIEW_MAX_H; pw = PREVIEW_MAX_H * a;
    }
    pw = Math.max(2, Math.round(pw)); ph = Math.max(2, Math.round(ph));
    previewRect.style.width = `${pw}px`;
    previewRect.style.height = `${ph}px`;
    previewLabel.textContent = `${w} × ${h}`;
    if (nested) {
      const ia = opts.inputAspect.w / opts.inputAspect.h;
      let iw, ih;
      if (ia >= pw / ph) { iw = pw; ih = pw / ia; }
      else { ih = ph; iw = ph * ia; }
      innerRect.style.width = `${Math.max(2, Math.round(iw))}px`;
      innerRect.style.height = `${Math.max(2, Math.round(ih))}px`;
    }
  }
  refreshPreview();

  swap.addEventListener("click", (e) => {
    e.stopPropagation();
    const a = wh[opts.wKey], b = wh[opts.hKey];
    wh[opts.wKey] = b; wh[opts.hKey] = a;
    wField.inp.value = String(b);
    hField.inp.value = String(a);
    const s = JSON.parse(node.properties?.[stateKey] || "{}");
    writeState(node, { ...s, [opts.wKey]: b, [opts.hKey]: a });
    refreshPreview();
    onChange?.();
  });

  return panel;
}

// ── Match aspect ratio panel ────────────────────────────────────────────────

// 9 presets to match Resolution Pixaroma's chip grid + Custom in slot 10.
// Each chip renders a tiny aspect-shape rectangle next to its label, so the
// user recognises the shape of every preset at a glance.
const RATIO_PRESETS = [
  { id: "1:1",  w: 1,  h: 1,  label: "1:1" },
  { id: "16:9", w: 16, h: 9,  label: "16:9" },
  { id: "9:16", w: 9,  h: 16, label: "9:16" },
  { id: "2:1",  w: 2,  h: 1,  label: "2:1" },
  { id: "3:2",  w: 3,  h: 2,  label: "3:2" },
  { id: "2:3",  w: 2,  h: 3,  label: "2:3" },
  { id: "4:3",  w: 4,  h: 3,  label: "4:3" },
  { id: "3:4",  w: 3,  h: 4,  label: "3:4" },
  { id: "4:5",  w: 4,  h: 5,  label: "4:5" },
  { id: "21:9", w: 21, h: 9,  label: "21:9" },
  { id: "5:4",  w: 5,  h: 4,  label: "5:4" },
  { id: "custom", w: null, h: null, label: "Custom" },
];

// `extra.cropOnly` hides the Crop/Pad toggle + pad color so Match ratio just
// crops (Image Resize splits Pad into its own mode). Load Image omits the flag
// and keeps the toggle.
function buildMatchRatioPanel(node, state, writeState, onChange, stateKey, extra = {}) {
  const panel = document.createElement("div");
  panel.className = "pix-li-panel";
  panel.appendChild(makePanelHeader("Match Aspect Ratio"));

  const chipsWrap = document.createElement("div");
  chipsWrap.className = "pix-li-ratio-chips";
  const chipEls = [];
  for (const r of RATIO_PRESETS) {
    const el = document.createElement("div");
    el.className = "pix-li-ratio-chip" + (state.ratio_preset === r.id ? " active" : "");
    el.dataset.rid = r.id;
    if (r.id === "custom") {
      el.classList.add("pix-li-ratio-custom-chip");
      el.textContent = r.label;
    } else {
      const shape = makeAspectShape(r.w, r.h);
      const labelEl = document.createElement("span");
      labelEl.textContent = r.label;
      el.append(shape, labelEl);
    }
    chipsWrap.appendChild(el);
    chipEls.push(el);
  }
  panel.appendChild(chipsWrap);

  // Custom ratio row — larger inputs + swap button between them.
  const customRow = document.createElement("div");
  customRow.className = "pix-li-custom-ratio-row";
  const cwBuilt = makeNumericInput({
    value: state.ratio_w || 1,
    min: 1, max: 999, step: 1,
    onCommit: (v) => commitCustomRatio(Math.round(v), parseFloat(chBuilt.input.value) || 1),
  });
  const cwIn = cwBuilt.input;
  cwBuilt.wrap.classList.add("pix-li-custom-ratio-input-wrap");
  const swapRatio = makeSwapButton("Swap ratio W ↔ H");
  swapRatio.classList.add("pix-li-custom-ratio-swap");
  const chBuilt = makeNumericInput({
    value: state.ratio_h || 1,
    min: 1, max: 999, step: 1,
    onCommit: (v) => commitCustomRatio(parseFloat(cwIn.value) || 1, Math.round(v)),
  });
  const chIn = chBuilt.input;
  chBuilt.wrap.classList.add("pix-li-custom-ratio-input-wrap");
  customRow.append(cwBuilt.wrap, swapRatio, chBuilt.wrap);
  customRow.style.display = state.ratio_preset === "custom" ? "flex" : "none";
  panel.appendChild(customRow);

  function commitCustomRatio(rw, rh) {
    const w = Math.max(1, Math.min(999, Math.round(rw || 1)));
    const h = Math.max(1, Math.min(999, Math.round(rh || 1)));
    cwIn.value = String(w);
    chIn.value = String(h);
    const s = JSON.parse(node.properties?.[stateKey] || "{}");
    writeState(node, { ...s, ratio_w: w, ratio_h: h });
    onChange?.();
  }

  swapRatio.addEventListener("click", (e) => {
    e.stopPropagation();
    commitCustomRatio(parseFloat(chIn.value) || 1, parseFloat(cwIn.value) || 1);
  });

  // Crop / Pad segmented toggle
  const seg = document.createElement("div");
  seg.className = "pix-li-cropped";
  const cropOpt = document.createElement("div");
  cropOpt.textContent = "Crop";
  cropOpt.dataset.action = "crop";
  if (state.ratio_action === "crop") cropOpt.classList.add("active");
  const padOpt = document.createElement("div");
  padOpt.textContent = "Pad";
  padOpt.dataset.action = "pad";
  if (state.ratio_action === "pad") padOpt.classList.add("active");
  seg.append(cropOpt, padOpt);
  if (!extra.cropOnly) panel.appendChild(seg);

  // Pad color row
  const padRow = document.createElement("div");
  padRow.className = "pix-li-pad-row";
  padRow.innerHTML = `<span>Pad color</span>`;
  const swatch = document.createElement("div");
  swatch.className = "pix-li-pad-swatch";
  swatch.style.background = state.pad_color || "#000000";
  padRow.appendChild(swatch);
  padRow.style.display = state.ratio_action === "pad" ? "flex" : "none";
  if (!extra.cropOnly) panel.appendChild(padRow);

  panel.appendChild(makeReadout(""));

  // Wire chip clicks
  chipsWrap.addEventListener("click", (e) => {
    const el = e.target.closest(".pix-li-ratio-chip");
    if (!el) return;
    e.stopPropagation();
    const rid = el.dataset.rid;
    const preset = RATIO_PRESETS.find((r) => r.id === rid);
    if (!preset) return;
    const s = JSON.parse(node.properties?.[stateKey] || "{}");
    const updates = { ...s, ratio_preset: rid };
    if (extra.cropOnly) updates.ratio_action = "crop";
    if (rid !== "custom") {
      updates.ratio_w = preset.w;
      updates.ratio_h = preset.h;
    }
    writeState(node, updates);
    for (const c of chipEls) c.classList.toggle("active", c.dataset.rid === rid);
    customRow.style.display = rid === "custom" ? "flex" : "none";
    if (rid !== "custom") {
      cwIn.value = String(preset.w);
      chIn.value = String(preset.h);
    }
    onChange?.();
  });

  seg.addEventListener("click", (e) => {
    const opt = e.target.closest("[data-action]");
    if (!opt) return;
    e.stopPropagation();
    const action = opt.dataset.action;
    const s = JSON.parse(node.properties?.[stateKey] || "{}");
    writeState(node, { ...s, ratio_action: action });
    cropOpt.classList.toggle("active", action === "crop");
    padOpt.classList.toggle("active", action === "pad");
    padRow.style.display = action === "pad" ? "flex" : "none";
    onChange?.();
  });

  // Photoshop-style modal picker - same one Text Overlay Pixaroma uses
  // for text and behind colors. Swatches + SV plane + hue strip + hex
  // input + Apply / Cancel. Modal backdrop locks the page so clicking
  // the node body / canvas can't dismiss the picker mid-pick. showClear
  // false because there's no meaningful "transparent pad" for crop-to-fill
  // or match-aspect-ratio padding.
  swatch.addEventListener("click", (e) => {
    e.stopPropagation();
    const cur = (node.properties?.[stateKey] ?
      (JSON.parse(node.properties[stateKey]).pad_color) : null)
      || state.pad_color || "#000000";
    openPixaromaColorPickerModal({
      title: "Pad color",
      initialColor: cur,
      showClear: false,
      onPick: (color) => {
        const c = color || "#000000";
        swatch.style.background = c;
        const s = JSON.parse(node.properties?.[stateKey] || "{}");
        writeState(node, { ...s, pad_color: c });
      },
    });
  });

  return panel;
}

// ── Pad panel (pixel padding for inpainting / outpainting) ──────────────────
// Per-side pixel boxes in a cross around a live output-size readout, plus a pad
// color. Output = input + left+right (W) and top+bottom (H); the padded border
// becomes the white inpaint-mask region (Python _apply_pad). `extra.inputDims`
// ({w,h} or null) lets the center show the live result size.
function buildPadPanel(node, state, writeState, onChange, stateKey, extra = {}) {
  const panel = document.createElement("div");
  panel.className = "pix-li-panel";

  const grid = document.createElement("div");
  grid.className = "pix-li-padgrid";

  const center = document.createElement("div");
  center.className = "pix-li-pad-mid";
  const inDims = extra.inputDims || null;
  function updateCenter() {
    if (inDims && inDims.w && inDims.h) {
      const s = JSON.parse(node.properties?.[stateKey] || "{}");
      const { w, h } = previewResize(inDims.w, inDims.h, { ...s, mode: "pad" });
      center.innerHTML = `<div class="pix-li-pad-outdims">${w} × ${h}</div>`;
    } else {
      center.innerHTML = `<div class="pix-li-pad-outhint">output<br>size</div>`;
    }
  }

  // Letter label sits INSIDE each input (T/L/R/B) to save node height; the
  // cross position reinforces which side. Full name in the hover title.
  function makePadField(letter, title, key, placeClass) {
    const { wrap, input } = makeNumericInput({
      value: state[key] ?? 0,
      min: 0, max: 8192, step: 1,
      onCommit: (v) => {
        v = Math.max(0, Math.round(v));
        const s = JSON.parse(node.properties?.[stateKey] || "{}");
        writeState(node, { ...s, [key]: v });
        input.value = String(v);
        updateCenter();
        onChange?.();
      },
    });
    wrap.classList.add("pix-li-pad-input-wrap", "pix-li-pad-labeled", placeClass);
    wrap.title = title;
    const lab = document.createElement("span");
    lab.className = "pix-li-pad-inlabel";
    lab.textContent = letter;
    wrap.insertBefore(lab, wrap.firstChild);
    return wrap;
  }

  const topW = makePadField("T", "Top padding (px)", "pad_top", "pix-li-pad-top");
  const leftW = makePadField("L", "Left padding (px)", "pad_left", "pix-li-pad-left");
  const rightW = makePadField("R", "Right padding (px)", "pad_right", "pix-li-pad-right");
  const botW = makePadField("B", "Bottom padding (px)", "pad_bottom", "pix-li-pad-bottom");

  // Pad color lives in the otherwise-empty bottom-right cell.
  const colorCell = document.createElement("div");
  colorCell.className = "pix-li-pad-colorcell";
  const swatch = document.createElement("div");
  swatch.className = "pix-li-pad-swatch";
  swatch.title = "Pad color";
  swatch.style.background = state.pad_color || "#000000";
  colorCell.appendChild(swatch);

  grid.append(topW, leftW, center, rightW, botW, colorCell);
  panel.appendChild(grid);
  updateCenter();

  swatch.addEventListener("click", (e) => {
    e.stopPropagation();
    const cur = (node.properties?.[stateKey]
      ? JSON.parse(node.properties[stateKey]).pad_color : null)
      || state.pad_color || "#000000";
    openPixaromaColorPickerModal({
      title: "Pad color",
      initialColor: cur,
      showClear: false,
      onPick: (color) => {
        const c = color || "#000000";
        swatch.style.background = c;
        const s = JSON.parse(node.properties?.[stateKey] || "{}");
        writeState(node, { ...s, pad_color: c });
        onChange?.();
      },
    });
  });

  return panel;
}

function buildFitInsidePanel(node, state, writeState, onChange, stateKey, extra) {
  return buildWHPanel(node, state, writeState, onChange, {
    headerLabel: "Fit Inside (no crop)",
    wKey: "fit_w", hKey: "fit_h",
    previewMaxW: extra?.previewMaxW, previewMaxH: extra?.previewMaxH,
    nestedFit: true,
    inputAspect: extra?.inputDims || null,
  }, stateKey);
}

function buildCoverPanel(node, state, writeState, onChange, stateKey, extra) {
  return buildWHPanel(node, state, writeState, onChange, {
    headerLabel: "Crop to Fill",
    wKey: "cover_w", hKey: "cover_h",
    previewMaxW: extra?.previewMaxW, previewMaxH: extra?.previewMaxH,
  }, stateKey);
}

// `extra` (optional): { previewMaxW, previewMaxH } lets a node enlarge the Fit/
// Crop aspect rectangle. Defaults (90x40) keep Load Image unchanged.
export function buildModePanel(mode, node, state, writeState, onChange, stateKey = "loadImagePixState", extra = {}) {
  if (mode === "off") return null;
  if (mode === "max_mp") return buildMaxMPPanel(node, state, writeState, onChange, stateKey, extra);
  if (mode === "longest_side") return buildLongestSidePanel(node, state, writeState, onChange, stateKey);
  if (mode === "scale_factor") return buildScalePanel(node, state, writeState, onChange, stateKey, extra);
  if (mode === "fit_inside") return buildFitInsidePanel(node, state, writeState, onChange, stateKey, extra);
  if (mode === "cover") return buildCoverPanel(node, state, writeState, onChange, stateKey, extra);
  if (mode === "match_ratio") return buildMatchRatioPanel(node, state, writeState, onChange, stateKey, extra);
  if (mode === "pad") return buildPadPanel(node, state, writeState, onChange, stateKey, extra);
  return null;
}
