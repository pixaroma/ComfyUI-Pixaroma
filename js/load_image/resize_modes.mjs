import { BRAND } from "../shared/index.mjs";

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
    const mp = (W * H) / 1_000_000;
    const f = mp > 0 ? Math.sqrt(tgt / mp) : 1.0;
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
    const f = Math.max(tw / W, th / H);
    if (!allowUp && f > 1) {
      const f2 = Math.min(tw / W, th / H, 1.0);
      ({ w: nw, h: nh } = applyFactor(f2));
    } else {
      nw = tw; nh = th;
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
  }

  // Snap post-modifier
  const snap = +state.snap || 0;
  if (snap > 0) {
    nw = Math.max(8, Math.round(nw / snap) * snap);
    nh = Math.max(8, Math.round(nh / snap) * snap);
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

function buildMaxMPPanel(node, state, writeState, onChange) {
  const panel = document.createElement("div");
  panel.className = "pix-li-panel";
  panel.appendChild(makePanelHeader("Max Megapixels"));

  const quickWrap = document.createElement("div");
  quickWrap.className = "pix-li-quickpicks";
  quickWrap.style.gridTemplateColumns = "repeat(3, 1fr)";
  const QUICK = [0.25, 0.5, 1.0, 2.0, 4.0, 8.0];
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
      const s = JSON.parse(node.properties?.loadImagePixState || "{}");
      writeState(node, { ...s, max_mp: v });
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
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
    writeState(node, { ...s, max_mp: v });
    onChange?.();
  });
  return panel;
}

function buildLongestSidePanel(node, state, writeState, onChange) {
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
      const s = JSON.parse(node.properties?.loadImagePixState || "{}");
      writeState(node, { ...s, longest_side: v });
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
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
    writeState(node, { ...s, longest_side: v });
    onChange?.();
  });
  return panel;
}

function buildScalePanel(node, state, writeState, onChange) {
  const panel = document.createElement("div");
  panel.className = "pix-li-panel";
  panel.appendChild(makePanelHeader("Scale by ×"));

  const quickWrap = document.createElement("div");
  quickWrap.className = "pix-li-quickpicks";
  quickWrap.style.gridTemplateColumns = "repeat(4, 1fr)";
  const QUICK = [0.25, 0.5, 2, 4];
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
      const s = JSON.parse(node.properties?.loadImagePixState || "{}");
      writeState(node, { ...s, scale_factor: v });
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
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
    writeState(node, { ...s, scale_factor: v });
    onChange?.();
  });
  return panel;
}

// W × H panels (Fit inside + Crop to fill) share this builder. Adds a swap
// button between the W and H fields and a small ratio-preview rectangle
// below them.
function buildWHPanel(node, state, writeState, onChange, opts) {
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
        const s = JSON.parse(node.properties?.loadImagePixState || "{}");
        writeState(node, { ...s, [key]: v });
        wh[key] = v;
        refreshPreview();
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

  // Aspect-ratio preview rectangle + readout
  const previewWrap = document.createElement("div");
  previewWrap.className = "pix-li-wh-preview";
  const previewRect = document.createElement("div");
  previewRect.className = "pix-li-wh-rect";
  const previewLabel = document.createElement("div");
  previewLabel.className = "pix-li-wh-rect-label";
  previewWrap.append(previewRect, previewLabel);
  panel.appendChild(previewWrap);

  const PREVIEW_MAX_W = 90;
  const PREVIEW_MAX_H = 40;
  function refreshPreview() {
    const w = wh[opts.wKey] || 1, h = wh[opts.hKey] || 1;
    const a = w / h;
    let pw, ph;
    if (a >= PREVIEW_MAX_W / PREVIEW_MAX_H) {
      pw = PREVIEW_MAX_W; ph = PREVIEW_MAX_W / a;
    } else {
      ph = PREVIEW_MAX_H; pw = PREVIEW_MAX_H * a;
    }
    previewRect.style.width = `${Math.max(2, Math.round(pw))}px`;
    previewRect.style.height = `${Math.max(2, Math.round(ph))}px`;
    previewLabel.textContent = `${w} × ${h}`;
  }
  refreshPreview();

  swap.addEventListener("click", (e) => {
    e.stopPropagation();
    const a = wh[opts.wKey], b = wh[opts.hKey];
    wh[opts.wKey] = b; wh[opts.hKey] = a;
    wField.inp.value = String(b);
    hField.inp.value = String(a);
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
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
  { id: "custom", w: null, h: null, label: "Custom" },
];

function buildMatchRatioPanel(node, state, writeState, onChange) {
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
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
    writeState(node, { ...s, ratio_w: w, ratio_h: h });
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
  panel.appendChild(seg);

  // Pad color row
  const padRow = document.createElement("div");
  padRow.className = "pix-li-pad-row";
  padRow.innerHTML = `<span>Pad color</span>`;
  const swatch = document.createElement("div");
  swatch.className = "pix-li-pad-swatch";
  swatch.style.background = state.pad_color || "#000000";
  padRow.appendChild(swatch);
  padRow.style.display = state.ratio_action === "pad" ? "flex" : "none";
  panel.appendChild(padRow);

  panel.appendChild(makeReadout(""));

  // Wire chip clicks
  chipsWrap.addEventListener("click", (e) => {
    const el = e.target.closest(".pix-li-ratio-chip");
    if (!el) return;
    e.stopPropagation();
    const rid = el.dataset.rid;
    const preset = RATIO_PRESETS.find((r) => r.id === rid);
    if (!preset) return;
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
    const updates = { ...s, ratio_preset: rid };
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
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
    writeState(node, { ...s, ratio_action: action });
    cropOpt.classList.toggle("active", action === "crop");
    padOpt.classList.toggle("active", action === "pad");
    padRow.style.display = action === "pad" ? "flex" : "none";
    onChange?.();
  });

  // Native color picker for v1; the Pixaroma compact picker can be wired
  // later if a swatch row is wanted.
  swatch.addEventListener("click", (e) => {
    e.stopPropagation();
    const cp = document.createElement("input");
    cp.type = "color";
    cp.value = state.pad_color || "#000000";
    cp.style.display = "none";
    document.body.appendChild(cp);
    cp.addEventListener("input", () => {
      swatch.style.background = cp.value;
      const s = JSON.parse(node.properties?.loadImagePixState || "{}");
      writeState(node, { ...s, pad_color: cp.value });
      onChange?.();
    });
    cp.addEventListener("change", () => cp.remove());
    cp.click();
  });

  return panel;
}

function buildFitInsidePanel(node, state, writeState, onChange) {
  return buildWHPanel(node, state, writeState, onChange, {
    headerLabel: "Fit Inside (no crop)",
    wKey: "fit_w", hKey: "fit_h",
  });
}

function buildCoverPanel(node, state, writeState, onChange) {
  return buildWHPanel(node, state, writeState, onChange, {
    headerLabel: "Crop to Fill",
    wKey: "cover_w", hKey: "cover_h",
  });
}

export function buildModePanel(mode, node, state, writeState, onChange) {
  if (mode === "off") return null;
  if (mode === "max_mp") return buildMaxMPPanel(node, state, writeState, onChange);
  if (mode === "longest_side") return buildLongestSidePanel(node, state, writeState, onChange);
  if (mode === "scale_factor") return buildScalePanel(node, state, writeState, onChange);
  if (mode === "fit_inside") return buildFitInsidePanel(node, state, writeState, onChange);
  if (mode === "cover") return buildCoverPanel(node, state, writeState, onChange);
  if (mode === "match_ratio") return buildMatchRatioPanel(node, state, writeState, onChange);
  return null;
}
