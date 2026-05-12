import { BRAND } from "../shared/index.mjs";

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
      // Degrade to fit_inside
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

// Each builder returns a DOM element representing the per-mode controls.
// All take (node, state, writeState, onChange) — onChange is called when the
// user mutates a value and the parent re-renders the preview readout.

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

function buildMaxMPPanel(node, state, writeState, onChange) {
  const panel = document.createElement("div");
  panel.className = "pix-li-panel";
  panel.appendChild(makePanelHeader("Max Megapixels"));

  const row = document.createElement("div");
  row.className = "pix-li-panel-row";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0.1";
  slider.max = "16";
  slider.step = "0.1";
  slider.value = String(state.max_mp || 1.0);
  const valEl = document.createElement("span");
  valEl.className = "pix-li-value";
  valEl.textContent = (state.max_mp || 1.0).toFixed(2);
  row.append(slider, valEl);
  panel.appendChild(row);

  const ro = makeReadout("");
  panel.appendChild(ro);

  slider.addEventListener("input", () => {
    const v = parseFloat(slider.value);
    valEl.textContent = v.toFixed(2);
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

  // Quick chips
  const quickWrap = document.createElement("div");
  quickWrap.className = "pix-li-quickpicks";
  quickWrap.style.gridTemplateColumns = "repeat(5, 1fr)";
  const QUICK = [512, 768, 1024, 1536, 2048];
  const cur = state.longest_side || 1024;
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

  // Numeric input
  const row = document.createElement("div");
  row.className = "pix-li-panel-row";
  const inp = document.createElement("input");
  inp.type = "number";
  inp.min = "256";
  inp.max = "8192";
  inp.step = "1";
  inp.value = String(cur);
  row.appendChild(inp);
  panel.appendChild(row);

  panel.appendChild(makeReadout(""));

  function commit(v) {
    v = Math.max(256, Math.min(8192, Math.round(v)));
    inp.value = String(v);
    for (const q of qpEls) q.classList.toggle("active", parseInt(q.dataset.v, 10) === v);
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
    writeState(node, { ...s, longest_side: v });
    onChange?.();
  }
  inp.addEventListener("change", () => commit(parseFloat(inp.value) || 1024));
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
  });
  quickWrap.addEventListener("click", (e) => {
    const q = e.target.closest(".pix-li-quickpick");
    if (!q) return;
    e.stopPropagation();
    commit(parseInt(q.dataset.v, 10));
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
  const cur = state.scale_factor || 1.0;
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
  row.className = "pix-li-panel-row";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0.1";
  slider.max = "4";
  slider.step = "0.05";
  slider.value = String(cur);
  const valEl = document.createElement("span");
  valEl.className = "pix-li-value";
  valEl.textContent = `${cur.toFixed(2)}×`;
  row.append(slider, valEl);
  panel.appendChild(row);

  panel.appendChild(makeReadout(""));

  function commit(v) {
    v = Math.max(0.1, Math.min(4.0, v));
    slider.value = String(v);
    valEl.textContent = `${v.toFixed(2)}×`;
    for (const q of qpEls) q.classList.toggle("active", Math.abs(parseFloat(q.dataset.v) - v) < 0.001);
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
    writeState(node, { ...s, scale_factor: v });
    onChange?.();
  }
  slider.addEventListener("input", () => commit(parseFloat(slider.value)));
  quickWrap.addEventListener("click", (e) => {
    const q = e.target.closest(".pix-li-quickpick");
    if (!q) return;
    e.stopPropagation();
    commit(parseFloat(q.dataset.v));
  });
  return panel;
}

function buildWHPanel(node, state, writeState, onChange, opts) {
  // opts: { headerLabel, wKey, hKey }
  const panel = document.createElement("div");
  panel.className = "pix-li-panel";
  panel.appendChild(makePanelHeader(opts.headerLabel));

  const row = document.createElement("div");
  row.className = "pix-li-panel-row";
  row.style.gap = "6px";

  function makeField(labelText, value, onCommit) {
    const wrap = document.createElement("div");
    wrap.style.flex = "1";
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "3px";
    const lbl = document.createElement("div");
    lbl.style.fontSize = "9px";
    lbl.style.color = "#888";
    lbl.style.textTransform = "uppercase";
    lbl.style.letterSpacing = "0.5px";
    lbl.style.textAlign = "center";
    lbl.textContent = labelText;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = "8";
    inp.max = "16384";
    inp.step = "1";
    inp.value = String(value);
    inp.style.width = "100%";
    inp.addEventListener("change", () => onCommit(Math.max(8, Math.min(16384, Math.round(parseFloat(inp.value) || 1024)))));
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
    });
    wrap.append(lbl, inp);
    return { wrap, inp };
  }

  const wField = makeField("Width", state[opts.wKey] ?? 1024, (v) => {
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
    writeState(node, { ...s, [opts.wKey]: v });
    wField.inp.value = String(v);
    onChange?.();
  });
  const hField = makeField("Height", state[opts.hKey] ?? 1024, (v) => {
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
    writeState(node, { ...s, [opts.hKey]: v });
    hField.inp.value = String(v);
    onChange?.();
  });
  row.append(wField.wrap, hField.wrap);
  panel.appendChild(row);
  panel.appendChild(makeReadout(""));
  return panel;
}

const RATIO_PRESETS = [
  { id: "1:1",  w: 1, h: 1, label: "1:1" },
  { id: "16:9", w: 16, h: 9, label: "16:9" },
  { id: "9:16", w: 9, h: 16, label: "9:16" },
  { id: "4:3",  w: 4, h: 3, label: "4:3" },
  { id: "3:4",  w: 3, h: 4, label: "3:4" },
  { id: "custom", w: null, h: null, label: "Custom" },
];

function buildMatchRatioPanel(node, state, writeState, onChange) {
  const panel = document.createElement("div");
  panel.className = "pix-li-panel";
  panel.appendChild(makePanelHeader("Match Aspect Ratio"));

  // Ratio chips
  const chipsWrap = document.createElement("div");
  chipsWrap.className = "pix-li-ratio-chips";
  const chipEls = [];
  for (const r of RATIO_PRESETS) {
    const el = document.createElement("div");
    el.className = "pix-li-ratio-chip" + (state.ratio_preset === r.id ? " active" : "");
    el.dataset.rid = r.id;
    el.textContent = r.label;
    chipsWrap.appendChild(el);
    chipEls.push(el);
  }
  panel.appendChild(chipsWrap);

  // Custom ratio row (only visible when preset = custom)
  const customRow = document.createElement("div");
  customRow.className = "pix-li-custom-ratio-row";
  const cwIn = document.createElement("input");
  cwIn.type = "number"; cwIn.min = "1"; cwIn.max = "999"; cwIn.step = "1";
  cwIn.value = String(state.ratio_w || 1);
  const colon = document.createElement("span");
  colon.textContent = ":";
  const chIn = document.createElement("input");
  chIn.type = "number"; chIn.min = "1"; chIn.max = "999"; chIn.step = "1";
  chIn.value = String(state.ratio_h || 1);
  customRow.append(cwIn, colon, chIn);
  customRow.style.display = state.ratio_preset === "custom" ? "flex" : "none";
  panel.appendChild(customRow);

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

  // Pad color row (visible when action = pad)
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

  // Wire events
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

  function commitCustom() {
    const cw = Math.max(1, Math.min(999, Math.round(parseFloat(cwIn.value) || 1)));
    const ch = Math.max(1, Math.min(999, Math.round(parseFloat(chIn.value) || 1)));
    cwIn.value = String(cw);
    chIn.value = String(ch);
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
    writeState(node, { ...s, ratio_w: cw, ratio_h: ch });
    onChange?.();
  }
  cwIn.addEventListener("change", commitCustom);
  chIn.addEventListener("change", commitCustom);
  for (const inp of [cwIn, chIn]) {
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
    });
  }

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

  // Simple native color picker for v1 (Pixaroma compact picker can be wired
  // in v2 if needed). Click swatch → spawn hidden <input type="color">.
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
