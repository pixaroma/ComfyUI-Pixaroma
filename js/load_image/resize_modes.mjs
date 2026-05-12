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
  // match_ratio added in Task 18.
  return null;
}
