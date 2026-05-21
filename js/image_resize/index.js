import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { hideJsonWidget, BRAND } from "../shared/index.mjs";
import { buildModePanel, previewResize, injectResizePanelCSS } from "../shared/resize_panel.mjs";
import {
  injectCSS, buildModeChips, buildFooter, buildResampleAndUpscale,
  openResamplePopup, closeResamplePopup, RESAMPLE_IDS, resampleLabel,
} from "./ui.mjs";

injectCSS();
injectResizePanelCSS();

const STATE_PROP = "imageResizeState";
const HIDDEN_INPUT = "ImageResizeState";
const DEFAULT_STATE = {
  mode: "off", max_mp: 1.0, longest_side: 1024, scale_factor: 1.0,
  fit_w: 1024, fit_h: 1024, cover_w: 1024, cover_h: 1024,
  ratio_preset: "1:1", ratio_w: 1, ratio_h: 1, ratio_action: "crop",
  pad_color: "#808080", pad_top: 0, pad_bottom: 0, pad_left: 0, pad_right: 0,
  crop_anchor: "center", crop_scale: true,
  snap: 0, resample: "auto", allow_upscale: true,
};
const WH_MODES = new Set(["fit_inside", "cover"]);
const MIN_W = 360; // minimum node width (the two IN/OUT cards need the room)

// True while a workflow is loading. The per-node _pixIrConfiguring flag does
// NOT cover connection restoration: LiteGraph restores links at the GRAPH level
// AFTER each node's onConfigure has returned (and cleared its flag), so the
// auto-swap in onConnectionsChange would see the restored wires as fresh user
// connections and disconnect the saved longest_side / width / height wire on
// every open. Wrapping app.loadGraphData (the funnel for workflow open, tab
// switch, and Ctrl+Z undo - same pattern as Connection FX) gives a load-wide
// guard with a trailing window for link restoration that settles a tick later.
let _irLoadingGraph = false;
if (app && app.loadGraphData && !app._pixIrLoadWrapped) {
  app._pixIrLoadWrapped = true;
  const _origLoadGraphData = app.loadGraphData.bind(app);
  app.loadGraphData = function (...args) {
    _irLoadingGraph = true;
    let r;
    try { r = _origLoadGraphData(...args); }
    finally {
      Promise.resolve(r).finally(() => setTimeout(() => { _irLoadingGraph = false; }, 300));
    }
    return r;
  };
}

function readState(node) {
  const v = node.properties?.[STATE_PROP];
  if (typeof v === "string" && v) {
    try { return { ...DEFAULT_STATE, ...JSON.parse(v) }; } catch {}
  }
  return { ...DEFAULT_STATE };
}
function writeState(node, state) {
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = JSON.stringify(state);
}

// Sum children intrinsic heights (NOT scrollHeight — LiteGraph stretches the
// root, so scrollHeight feeds back; see Load Image Pattern #4). Root is a flex
// column with 8px gap + 8px padding top/bottom.
function measureContentHeight(root) {
  if (!root) return 120;
  let h = 0;
  for (const c of root.children) h += c.offsetHeight;
  h += Math.max(0, root.children.length - 1) * 8; // row gaps
  h += 16; // root padding (top + bottom)
  return Math.max(120, h);
}

// Refit node height to content. ONLY call on genuine user actions — never on
// the load path (Vue Compat #18: resizing during configure dirties the saved
// workflow). rAF so the freshly-rendered panel has laid out before measuring.
function refit(node) {
  if (!node._pixIrRoot) return;
  requestAnimationFrame(() => {
    if (!node._pixIrRoot) return;
    const sz = node.computeSize();
    if (Math.abs(node.size[1] - sz[1]) > 1) {
      node.size[1] = sz[1];
      node.setDirtyCanvas(true, true);
    }
  });
}

function getInputDims(node) {
  const inp = node.inputs?.find((i) => i.name === "image");
  if (!inp || inp.link == null) return null;
  let l = node.graph?.links?.[inp.link];
  if (!l && typeof node.graph?.links?.get === "function") l = node.graph.links.get(inp.link);
  if (!l) return null;
  const up = node.graph.getNodeById(l.origin_id);
  const img = up?.imgs?.[0];
  if (img?.naturalWidth) return { w: img.naturalWidth, h: img.naturalHeight };
  return null;
}

function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = b; b = a % b; a = t; } return a || 1; }
function ratioLabel(w, h) {
  const g = gcd(w, h);
  const rw = w / g, rh = h / g;
  const known = ["1:1","16:9","9:16","2:1","1:2","3:2","2:3","4:3","3:4","4:5","5:4","21:9"];
  const s = `${rw}:${rh}`;
  if (known.includes(s)) return s;
  const r = w / h;
  return r >= 1 ? `~${r.toFixed(2)}:1` : `~1:${(1 / r).toFixed(2)}`;
}

// The size info is painted in the dead space between the input and output
// slot columns (onDrawForeground), not as a body row — saves height and uses
// empty space. Returns either a two-line INPUT/OUTPUT block or a message.
function getReadoutInfo(node, wi) {
  const state = readState(node);
  const cached = node.properties?.pixIrDims;       // {in_w,in_h,out_w,out_h} from last run
  const live = getInputDims(node);
  const info = wi || wireInfo(node);

  // Wired inputs: predict via the wired mirror so the card matches Python.
  // longest_side wins over width/height (precedence), so when it's wired only
  // its readability matters.
  if ((info.count > 0 || info.wiredLongest) && live) {
    const needL = info.wiredLongest && info.valLongest == null;
    const needW = !info.wiredLongest && info.wiredW && info.valW == null;
    const needH = !info.wiredLongest && info.wiredH && info.valH == null;
    if (!needW && !needH && !needL) {
      const eff = effectiveWiredState(state, info, live.w, live.h);
      const { w, h } = previewResize(live.w, live.h, eff);
      return { mode: "dual", inW: live.w, inH: live.h, outW: w, outH: h };
    }
    // Wired from a source we can't read at edit time (math/reroute): show the
    // real dims if a run happened, else say it's wire-driven (no wrong number).
    if (cached) return { mode: "dual", inW: live.w, inH: live.h, outW: cached.out_w, outH: cached.out_h };
    return { mode: "msg", text: "Output set by wired inputs" };
  }

  if (live) {
    const { w, h } = previewResize(live.w, live.h, state);
    return { mode: "dual", inW: live.w, inH: live.h, outW: w, outH: h };
  }
  if (cached) {
    return { mode: "dual", inW: cached.in_w, inH: cached.in_h, outW: cached.out_w, outH: cached.out_h };
  }
  if (!isWired(node, "image")) return { mode: "msg", text: "Connect an image" };
  return { mode: "msg", text: "Run once to read size" };
}

// Rectangle scaled to a w:h aspect inside a max box (the little ratio shape).
function aspectRectDims(w, h, maxW, maxH) {
  const a = w / h;
  let rw, rh;
  if (a >= maxW / maxH) { rw = maxW; rh = maxW / a; }
  else { rh = maxH; rw = maxH * a; }
  return { rw: Math.max(2, Math.round(rw)), rh: Math.max(2, Math.round(rh)) };
}

// Rounded rectangle (all corners).
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function isWired(node, name) {
  const inp = node.inputs?.find((i) => i.name === name);
  return !!(inp && inp.link != null);
}

// Small toast (Image Resize). Silent no-op if the toast API isn't present
// (older Easy Install builds), so it never throws on a connect.
function toast(msg) {
  const t = app?.extensionManager?.toast;
  if (t?.add) t.add({ severity: "info", summary: "Image Resize Pixaroma", detail: msg, life: 2500 });
}

// Disconnect a named input if it currently has a wire. Returns true if it did.
function disconnectInputByName(node, name) {
  const i = node.inputs?.findIndex((inp) => inp?.name === name);
  if (i != null && i >= 0 && node.inputs[i]?.link != null) {
    node.disconnectInput(i);
    return true;
  }
  return false;
}

// Best-effort read of a wired INT input's value at edit time. Works for
// Resolution Pixaroma (value lives in properties.resolutionState; the link's
// origin_slot picks w vs h) and plain INT widget nodes. Returns null for
// sources we can't read (math/reroute/computed) — callers then fall back to a
// "set by wires" state / post-run dims.
function readWiredInt(node, name) {
  const inp = node.inputs?.find((i) => i.name === name);
  if (!inp || inp.link == null) return null;
  let l = node.graph?.links?.[inp.link];
  if (!l && typeof node.graph?.links?.get === "function") l = node.graph.links.get(inp.link);
  if (!l) return null;
  const up = node.graph.getNodeById(l.origin_id);
  if (!up) return null;
  if (up.comfyClass === "PixaromaResolution" || up.type === "PixaromaResolution") {
    try {
      const s = JSON.parse(up.properties.resolutionState);
      const v = l.origin_slot === 1 ? s.h : s.w; // slot 0 = width, 1 = height
      return Number.isFinite(v) ? Math.round(v) : null;
    } catch { return null; }
  }
  // Plain INT source: only trust it when there's exactly ONE numeric widget
  // (unambiguous). Multi-widget nodes (seed/steps/cfg…) would give a wrong
  // guess — return null so the card shows "set by wires" rather than a lie.
  const nums = (up.widgets || []).filter((x) => typeof x.value === "number");
  return nums.length === 1 && Number.isFinite(nums[0].value) ? Math.round(nums[0].value) : null;
}

// Central wired-input state: which axes are wired + their best-effort values.
function wireInfo(node) {
  const wiredW = isWired(node, "width");
  const wiredH = isWired(node, "height");
  const wiredLongest = isWired(node, "longest_side");
  return {
    wiredW, wiredH, wiredLongest,
    count: (wiredW ? 1 : 0) + (wiredH ? 1 : 0),
    valW: wiredW ? readWiredInt(node, "width") : null,
    valH: wiredH ? readWiredInt(node, "height") : null,
    valLongest: wiredLongest ? readWiredInt(node, "longest_side") : null,
  };
}

// JS mirror of Python `_apply_wired_size` (keep in lockstep). Returns the
// effective state to feed previewResize so the OUTPUT card matches Python.
// Single wire = aspect scale to that dim; both = exact box (Fit/Crop).
function effectiveWiredState(state, info, ow, oh) {
  // longest_side wins over width/height (mirrors Python _apply_wired_size).
  if (info.wiredLongest) {
    if (info.valLongest == null) return state; // unreadable wire — caller falls back
    if (info.valLongest <= 0) return { ...state, mode: "off" }; // 0/neg = no target, passthrough
    // Respect the Upscaling toggle (state.allow_upscale flows through via ...state).
    return { ...state, mode: "longest_side", longest_side: info.valLongest };
  }
  if (!info.wiredW && !info.wiredH) return state;
  if (info.wiredW !== info.wiredH) { // exactly one wired
    const v = info.wiredW ? info.valW : info.valH;
    const od = info.wiredW ? ow : oh;
    if (v == null || !od) return state; // unreadable wire — caller falls back
    if (v <= 0) return { ...state, mode: "off" }; // 0/neg = no target, passthrough
    // Respect the Upscaling toggle (state.allow_upscale flows through via ...state).
    return { ...state, mode: "scale_factor", scale_factor: v / od };
  }
  if (info.valW == null || info.valH == null) return state; // unreadable wire
  if (state.mode === "fit_inside") return { ...state, mode: "fit_inside", fit_w: info.valW, fit_h: info.valH };
  return { ...state, mode: "cover", cover_w: info.valW, cover_h: info.valH };
}

// Lock the W/H field(s) of the active Fit/Crop panel to the wire(s) (both-wired
// case). buildWHPanel renders Width then Height as the first two text inputs.
// Only the fit/cover panels have these inputs, so this is a no-op elsewhere
// (single-wire shows a summary panel; no-wire modes have no wires).
function applyWiredLocks(node, root) {
  const info = wireInfo(node);
  const numEls = [...root.querySelectorAll(".pix-li-numinput input")];
  const wInp = info.wiredW ? numEls[0] : null;
  const hInp = info.wiredH ? numEls[1] : null;
  if (wInp) lockField(wInp, info.valW);
  if (hInp) lockField(hInp, info.valH);
  // Cache so onDrawForeground can refresh the shown value live (the upstream
  // wired value can change after render — same staleness class as the summary).
  if (wInp || hInp) node._pixIrLockedInputs = { wInp, hInp };
}
function lockField(inp, val) {
  inp.readOnly = true;
  inp.title = "Driven by wired input";
  if (val != null) inp.value = String(val); // show the actual wired number
  // Dim the whole field (input + spinner arrows) so it reads as disabled; the
  // arrows are also made inert by the readOnly guard in makeNumericInput.step1.
  const wrap = inp.closest(".pix-li-numinput");
  if (wrap) { wrap.style.opacity = "0.55"; wrap.title = "Driven by wired input"; }
}

// NOTE: there is intentionally no "auto-switch mode on connect". When both
// width/height are wired the RENDER forces a Crop-to-fill display (dispMode)
// and Python/effectiveWiredState force cover at run time - all WITHOUT writing
// state.mode. That keeps the user's chosen mode intact so disconnecting the
// wires restores it (and avoids dirtying the workflow on a connect/disconnect).

// Single-wire summary panel: shows the wired dimension + the auto-computed
// other dimension (keeps aspect). Read-only — no mode applies here.
function buildSingleWirePanel(node, info, live) {
  const panel = document.createElement("div");
  panel.className = "pix-li-panel pix-ir-wirepanel";
  const wv = info.wiredW ? info.valW : info.valH;
  let aw = null, ah = null;
  if (live && wv != null) {
    // Compute via the same path as the OUTPUT card (snap-aware) so the first
    // render matches the value onDrawForeground will paint — no one-frame flash.
    const r = previewResize(live.w, live.h, effectiveWiredState(readState(node), info, live.w, live.h));
    aw = r.w; ah = r.h;
  } else if (info.wiredW) { aw = wv; } else { ah = wv; }
  const mkRow = (label, val, tag) => {
    const r = document.createElement("div");
    r.className = "pix-ir-wirerow";
    const l = document.createElement("span"); l.className = "pix-ir-wirelbl"; l.textContent = label;
    const v = document.createElement("span"); v.className = "pix-ir-wireval"; v.textContent = val == null ? "—" : String(val);
    const t = document.createElement("span"); t.className = "pix-ir-wiretag"; t.textContent = tag;
    r.append(l, v, t);
    return { row: r, valEl: v };
  };
  const wRow = mkRow("W", aw, info.wiredW ? "from wire" : "auto · keeps aspect");
  const hRow = mkRow("H", ah, info.wiredW ? "auto · keeps aspect" : "from wire");
  panel.append(wRow.row, hRow.row);
  // Cache the value cells so onDrawForeground can refresh them live when the
  // upstream wired value changes (DOM has no event for that; the draw loop is
  // the only signal, same one the OUTPUT card already rides).
  node._pixIrWireCells = { wEl: wRow.valEl, hEl: hRow.valEl };
  return panel;
}

// longest_side wired summary: one row "LONGEST SIDE | value | from wire". The
// OUTPUT card paints the resulting W×H; this just confirms the wired target.
// Read-only (the value comes from the wire). Reuses the single-wire row CSS.
function buildLongestWirePanel(node, info) {
  const panel = document.createElement("div");
  panel.className = "pix-li-panel pix-ir-wirepanel";
  const row = document.createElement("div");
  row.className = "pix-ir-wirerow";
  const l = document.createElement("span"); l.className = "pix-ir-wirelbl is-wide"; l.textContent = "LONGEST SIDE";
  const v = document.createElement("span"); v.className = "pix-ir-wireval";
  v.textContent = info.valLongest == null ? "—" : String(info.valLongest);
  const t = document.createElement("span"); t.className = "pix-ir-wiretag"; t.textContent = "from wire";
  row.append(l, v, t);
  panel.append(row);
  // Cache the value cell so onDrawForeground can refresh it live when the
  // upstream wired value changes (same draw-loop pattern as the single-wire panel).
  node._pixIrLongestCell = v;
  return panel;
}

// Single-input modes: drop the section header and move its name INTO the
// input (orange, left), value pushed right next to the arrows. Saves vertical
// space. Multi-input modes (Fit/Crop/Match ratio) keep their headers.
const INLINE_LABELS = {
  max_mp: "Max megapixels",
  longest_side: "Longest side",
  scale_factor: "Scale by ×",
};
function applyInlineLabel(panel, mode) {
  const label = INLINE_LABELS[mode];
  if (!label) return;
  panel.querySelector(".pix-li-panel-label")?.remove();
  const num = panel.querySelector(".pix-li-numinput");
  if (!num || num.querySelector(".pix-ir-inline-label")) return;
  const lab = document.createElement("span");
  lab.className = "pix-ir-inline-label";
  lab.textContent = label;
  num.insertBefore(lab, num.firstChild);
  num.classList.add("pix-ir-num-labeled");
}

// Fit / Crop (W x H) panels: drop the per-field WIDTH/HEIGHT labels and put
// short W / H labels INSIDE each input, and remove the redundant size text
// under the aspect rectangle. (The mode title row is removed by the caller.)
function applyWHLayout(panel) {
  const fields = [...panel.querySelectorAll(".pix-li-wh-field")];
  const tags = ["W", "H"];
  fields.forEach((f, i) => {
    f.querySelector(".pix-li-wh-label")?.remove();
    const num = f.querySelector(".pix-li-numinput");
    if (num && !num.querySelector(".pix-ir-inline-label")) {
      const lab = document.createElement("span");
      lab.className = "pix-ir-inline-label";
      lab.textContent = tags[i] || "";
      num.insertBefore(lab, num.firstChild);
      num.classList.add("pix-ir-num-labeled");
    }
  });
  panel.querySelector(".pix-li-wh-rect-label")?.remove();

  // Reflow into two columns: W / H / swap stacked on the left, ratio rect right.
  const row = panel.querySelector(".pix-li-wh-row");
  const swap = panel.querySelector(".pix-li-swap");
  const preview = panel.querySelector(".pix-li-wh-preview");
  if (row && fields.length === 2 && preview && !panel.querySelector(".pix-ir-wh-grid")) {
    const grid = document.createElement("div");
    grid.className = "pix-ir-wh-grid";
    const col = document.createElement("div");
    col.className = "pix-ir-wh-col";
    col.append(fields[0], fields[1]);
    if (swap) col.append(swap);
    grid.append(col, preview);
    row.replaceWith(grid);
  }
}

// Crop-to-fill extras (cover mode only): a Fill/Crop scale toggle next to a
// shrunk swap button, and a 3×3 anchor picker replacing the aspect-rect
// preview. Anchor sets WHICH part is kept (works for both Fill and Crop);
// Fill scales then trims, Crop cuts a 1:1-pixel piece (no scaling).
function applyCoverControls(node, panel) {
  const state = readState(node);

  const swap = panel.querySelector(".pix-li-swap");
  if (swap && !panel.querySelector(".pix-ir-fillcrop")) {
    const row = document.createElement("div");
    row.className = "pix-ir-swaprow";
    const toggle = document.createElement("div");
    toggle.className = "pix-ir-fillcrop";
    const fillOpt = document.createElement("div");
    fillOpt.textContent = "Fill";
    fillOpt.dataset.cropScale = "1";
    fillOpt.title = "Scale to fill exactly, trim overflow";
    const cropOpt = document.createElement("div");
    cropOpt.textContent = "Crop";
    cropOpt.dataset.cropScale = "0";
    cropOpt.title = "Cut a 1:1-pixel piece, no scaling";
    const scaleOn = state.crop_scale !== false;
    fillOpt.classList.toggle("active", scaleOn);
    cropOpt.classList.toggle("active", !scaleOn);
    toggle.append(fillOpt, cropOpt);
    swap.replaceWith(row);
    row.append(swap, toggle);
    toggle.addEventListener("click", (e) => {
      const opt = e.target.closest("[data-crop-scale]");
      if (!opt) return;
      const on = opt.dataset.cropScale === "1";
      writeState(node, { ...readState(node), crop_scale: on });
      fillOpt.classList.toggle("active", on);
      cropOpt.classList.toggle("active", !on);
      node.setDirtyCanvas(true, true); // OUTPUT card reflects the new size
    });
  }

  const preview = panel.querySelector(".pix-li-wh-preview");
  if (preview && !panel.querySelector(".pix-ir-anchor")) {
    const ANCHORS = [
      "top-left", "top", "top-right",
      "left", "center", "right",
      "bottom-left", "bottom", "bottom-right",
    ];
    const cur = state.crop_anchor || "center";
    const grid = document.createElement("div");
    grid.className = "pix-ir-anchor";
    grid.title = "Where to crop from";
    for (const a of ANCHORS) {
      const cell = document.createElement("div");
      cell.className = "pix-ir-anchor-cell" + (a === cur ? " active" : "");
      cell.dataset.anchor = a;
      cell.title = a.replace("-", " ");
      grid.appendChild(cell);
    }
    preview.replaceWith(grid);
    grid.addEventListener("click", (e) => {
      const cell = e.target.closest(".pix-ir-anchor-cell");
      if (!cell) return;
      writeState(node, { ...readState(node), crop_anchor: cell.dataset.anchor });
      for (const c of grid.children) c.classList.toggle("active", c === cell);
    });
  }
}

function renderUI(node) {
  const root = node._pixIrRoot;
  // Render even when the root is not yet attached to the document: on a fresh
  // drop the DOM widget element can still be detached at queueMicrotask time,
  // and building into a detached node is fine (Vue mounts it moments later).
  // Bailing on !isConnected here left the body blank until the first wire/edit.
  if (!root) return;
  const state = readState(node);
  // Null the live-refresh caches BEFORE wiping the DOM (their old elements are
  // about to be detached); the panels below re-set whichever applies.
  node._pixIrWireCells = null;
  node._pixIrLockedInputs = null;
  node._pixIrLongestCell = null;
  root.innerHTML = "";

  const info = wireInfo(node);
  const live = getInputDims(node);

  const chips = buildModeChips(state);
  root.appendChild(chips);

  // When width/height are wired, restrict the modes (Wired W/H design):
  //  1 wired -> fixed aspect scale, NO mode applies (all chips disabled).
  //  2 wired -> exact box, only Fit inside / Crop to fill apply (others disabled).
  // Display mode for 2-wired: honour Fit if active, else show Crop to fill.
  let dispMode = state.mode;
  if (info.wiredLongest) {
    // longest_side wire wins: force Longest side display, lock every chip.
    dispMode = "longest_side";
    for (const c of chips.querySelectorAll(".pix-ir-chip")) {
      c.classList.add("disabled");
      c.classList.toggle("active", c.dataset.mode === "longest_side");
    }
  } else if (info.count === 1) {
    for (const c of chips.querySelectorAll(".pix-ir-chip")) { c.classList.add("disabled"); c.classList.remove("active"); }
  } else if (info.count === 2) {
    dispMode = WH_MODES.has(state.mode) ? state.mode : "cover";
    for (const c of chips.querySelectorAll(".pix-ir-chip")) {
      const m = c.dataset.mode;
      c.classList.toggle("disabled", m !== "fit_inside" && m !== "cover");
      c.classList.toggle("active", m === dispMode);
    }
  }

  let panel = null;
  if (info.wiredLongest) {
    panel = buildLongestWirePanel(node, info);
  } else if (info.count === 1) {
    panel = buildSingleWirePanel(node, info, live);
  } else {
    panel = buildModePanel(dispMode, node, state, writeState,
      () => node.setDirtyCanvas(true, true), STATE_PROP,
      { previewMaxW: 134, previewMaxH: 96, cropOnly: true, inputDims: live, oneLine: true });
    if (panel) {
      applyInlineLabel(panel, dispMode);
      if (dispMode === "fit_inside" || dispMode === "cover") applyWHLayout(panel);
      if (dispMode === "cover") applyCoverControls(node, panel);
      // No redundant title row — the highlighted button names the mode. Saves a
      // row of height; matches the Pad panel which never had a title.
      panel.querySelector(".pix-li-panel-label")?.remove();
    }
  }
  if (panel) root.appendChild(panel);

  const footer = buildFooter(state);
  root.appendChild(footer);

  const { wrap: ruWrap, upBtn, prev, dd, next, valueEl } = buildResampleAndUpscale(state);
  root.appendChild(ruWrap);

  applyWiredLocks(node, root);
  node.setDirtyCanvas(true, true); // repaint the canvas-painted size readout

  // ── wiring ──
  chips.addEventListener("click", (e) => {
    const c = e.target.closest(".pix-ir-chip");
    if (!c || c.classList.contains("disabled")) return; // disabled while wired
    writeState(node, { ...readState(node), mode: c.dataset.mode });
    renderUI(node);
    refit(node);
  });
  footer.addEventListener("click", (e) => {
    const s = e.target.closest(".pix-ir-schip");
    if (!s) return;
    writeState(node, { ...readState(node), snap: parseInt(s.dataset.snap, 10) });
    // snap doesn't change panel height — update active chip + readout only.
    for (const el of footer.querySelectorAll(".pix-ir-schip")) {
      el.classList.toggle("active", el === s);
    }
    node.setDirtyCanvas(true, true);
  });
  const setResample = (id) => {
    writeState(node, { ...readState(node), resample: id });
    valueEl.textContent = "Resample: " + resampleLabel(id);
    node.setDirtyCanvas(true, true);
  };
  const cycleResample = (delta) => {
    const cur = readState(node).resample || "auto";
    let i = RESAMPLE_IDS.indexOf(cur);
    if (i < 0) i = 0;
    i = (i + delta + RESAMPLE_IDS.length) % RESAMPLE_IDS.length;
    setResample(RESAMPLE_IDS[i]);
  };
  dd.addEventListener("click", () => openResamplePopup(dd, readState(node).resample || "auto", setResample));
  prev.addEventListener("click", () => cycleResample(-1));
  next.addEventListener("click", () => cycleResample(1));
  upBtn.addEventListener("click", () => {
    const on = !(readState(node).allow_upscale !== false); // flip current state
    writeState(node, { ...readState(node), allow_upscale: on });
    upBtn.classList.toggle("is-on", on);
    upBtn.textContent = on ? "Upscaling: On" : "Upscaling: Off";
    node.setDirtyCanvas(true, true);
  });
}

app.registerExtension({
  name: "Pixaroma.ImageResize",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaImageResize") return;

    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = _origCreated?.apply(this, arguments);
      hideJsonWidget(this.widgets, HIDDEN_INPUT);
      const root = document.createElement("div");
      root.className = "pix-ir-root";
      this.addDOMWidget("image_resize_ui", "custom", root, {
        canvasOnly: true,
        serialize: false,
        getMinHeight: () => measureContentHeight(root),
      });
      this._pixIrRoot = root;
      // Fresh-node default size (saved workflows restore their own via configure).
      if (!this.size || this.size[0] < MIN_W) this.size = [360, 340];
      // Deferred initial render so configure() can land the saved state first
      // (Vue Compat #8). By microtask time, configure() has already run for a
      // loaded node, so node.properties[STATE_PROP] is set — we use that to
      // refit ONLY on a genuine fresh drop, never on load (Vue Compat #18).
      queueMicrotask(() => {
        const wasConfigured = this.properties?.[STATE_PROP] !== undefined;
        renderUI(this);
        if (!wasConfigured) refit(this);
      });
      return r;
    };

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      this._pixIrConfiguring = true;
      try {
        const res = _origConfigure?.apply(this, arguments);
        if (this._pixIrRoot) renderUI(this); // render only — no refit (Vue Compat #18)
        return res;
      } finally {
        this._pixIrConfiguring = false;
      }
    };

    const INPUT_TYPE = (typeof LiteGraph !== "undefined" && LiteGraph.INPUT != null) ? LiteGraph.INPUT : 1;
    const _origConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, idx, connected, link, ioSlot) {
      const r = _origConn?.apply(this, arguments);
      // Auto-swap sizing sources: longest_side and width/height are competing
      // ways to set the size, so connecting one drops the other(s). width and
      // height may coexist (exact box) - only longest_side is exclusive vs them.
      // Only on a genuine user connect; never during configure/load. Three
      // guards: _pixIrConfiguring (this node's onConfigure window),
      // _irLoadingGraph (the graph-level link-restore window that fires AFTER
      // onConfigure - this is the one that was disconnecting saved wires on
      // open), and _pixIrAutoSwapping (re-entrancy from the disconnectInput
      // calls below).
      if (type === INPUT_TYPE && connected && !this._pixIrConfiguring && !this._pixIrAutoSwapping && !_irLoadingGraph) {
        const name = this.inputs?.[idx]?.name || ioSlot?.name;
        this._pixIrAutoSwapping = true;
        try {
          if (name === "longest_side") {
            const dW = disconnectInputByName(this, "width");
            const dH = disconnectInputByName(this, "height");
            if (dW || dH) toast("longest_side now drives the size, so width/height was disconnected.");
          } else if (name === "width" || name === "height") {
            if (disconnectInputByName(this, "longest_side"))
              toast("width/height now drive the size, so longest_side was disconnected.");
          }
        } finally {
          this._pixIrAutoSwapping = false;
        }
      }
      if (!this._pixIrConfiguring && !this._pixIrAutoSwapping && this._pixIrRoot) {
        renderUI(this); // re-render for the new wire count (no state mutation)
        refit(this);
        // Upstream loader may populate its image a tick after the wire lands;
        // re-read the size shortly after so the readout updates without a run.
        setTimeout(() => this.setDirtyCanvas(true, true), 200);
      }
      return r;
    };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixIrRoot = null;
      this._pixIrWireCells = null;
      this._pixIrLockedInputs = null;
      this._pixIrLongestCell = null;
      closeResamplePopup(); // tear down popup + its document listeners if open
      return _origRemoved?.apply(this, arguments);
    };

    // Belt-and-braces minimum width: onResize is unreliable in the Vue
    // frontend (Vue Compat #13) and Align Pixaroma writes node.size directly,
    // so clamp here too (Pixaroma UI conventions #7).
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      return _origResize?.apply(this, arguments);
    };

    // Paint the size readout in the empty space between the input and output
    // slot columns, on a dark panel, so it uses dead space and costs no body
    // height. Vertical center of the 4 slot rows is y=44 (TOP_PAD 4 + 4*20/2).
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const r = _origDraw?.apply(this, arguments);
      if (this.flags?.collapsed) return r;
      if (this.size[0] < MIN_W) { this.size[0] = MIN_W; this.setDirtyCanvas(true, true); }
      // Compute wire info ONCE per repaint (readWiredInt parses upstream JSON);
      // reuse it for the readout and the live field refreshes below.
      const wi = wireInfo(this);
      const info = getReadoutInfo(this, wi);
      // Keep the single-wire summary panel's numbers live: the draw loop re-reads
      // the wired value every repaint, so mirror the result into the cells when
      // it changes (DOM has no event for an upstream widget value change).
      if (this._pixIrWireCells && info.mode === "dual") {
        const c = this._pixIrWireCells, w = String(info.outW), h = String(info.outH);
        if (c.wEl.textContent !== w) c.wEl.textContent = w;
        if (c.hEl.textContent !== h) c.hEl.textContent = h;
      }
      // Keep the longest_side summary value live (upstream wired value can change).
      if (this._pixIrLongestCell && wi.valLongest != null) {
        const s = String(wi.valLongest);
        if (this._pixIrLongestCell.textContent !== s) this._pixIrLongestCell.textContent = s;
      }
      // Locked W/H fields (both-wired): keep the shown value in sync with the
      // live upstream value (it can change after render).
      if (this._pixIrLockedInputs) {
        const li = this._pixIrLockedInputs;
        if (li.wInp && wi.valW != null && li.wInp.value !== String(wi.valW)) li.wInp.value = String(wi.valW);
        if (li.hInp && wi.valH != null && li.hInp.value !== String(wi.valH)) li.hInp.value = String(wi.valH);
      }
      const cx = this.size[0] / 2;
      const fam = "ui-sans-serif, system-ui, sans-serif";
      const capFont = `8px ${fam}`;
      const dimsFont = `bold 10px ${fam}`;
      const ratioFont = `8px ${fam}`;
      const midY = 54; // vertical center of the 5 slot rows (TOP_PAD 4 + 5*20/2)
      ctx.save();
      ctx.textBaseline = "middle";

      if (info.mode === "msg") {
        ctx.font = `13px ${fam}`;
        const tw = ctx.measureText(info.text).width;
        const bw = tw + 26, bh = 28;
        roundRectPath(ctx, cx - bw / 2, midY - bh / 2, bw, bh, 8);
        ctx.fillStyle = "#1d1d1d"; ctx.fill();
        ctx.textAlign = "center"; ctx.fillStyle = BRAND;
        ctx.fillText(info.text, cx, midY);
        ctx.restore();
        return r;
      }

      // Two mini cards (INPUT -> OUTPUT) side by side with an arrow between.
      // Tall (span the slot rows) + grow with node width to use the middle
      // space, clamped so they never crowd the slot labels. Each card stacks
      // label / dims / aspect rect / ratio.
      const arrowW = 16, gap = 8, cardH = 76;
      let cardW = (this.size[0] - 184 - arrowW - gap * 2) / 2;
      cardW = Math.max(66, Math.min(cardW, 120));
      const totalW = cardW * 2 + gap * 2 + arrowW;
      const startX = cx - totalW / 2;
      const cardY = midY - cardH / 2;
      const rectMaxW = 40, rectMaxH = 18;

      const drawCard = (x, label, w, h, accent) => {
        roundRectPath(ctx, x, cardY, cardW, cardH, 6);
        ctx.fillStyle = "#1d1d1d"; ctx.fill();
        roundRectPath(ctx, x + 0.5, cardY + 0.5, cardW - 1, cardH - 1, 6);
        ctx.strokeStyle = "#444"; ctx.lineWidth = 1; ctx.stroke();
        const ccx = x + cardW / 2;
        ctx.textAlign = "center";
        const maxTxt = cardW - 8; // keep text inside the card (5-digit dims, etc.)
        ctx.font = capFont; ctx.fillStyle = "#9a9a9a";
        ctx.fillText(label, ccx, cardY + 13, maxTxt);
        ctx.font = dimsFont; ctx.fillStyle = BRAND;
        ctx.fillText(`${w}×${h}`, ccx, cardY + 27, maxTxt);
        const { rw, rh } = aspectRectDims(w, h, rectMaxW, rectMaxH);
        const rx = Math.round(ccx - rw / 2) + 0.5, ry = Math.round(cardY + 47 - rh / 2) + 0.5;
        if (accent) { ctx.fillStyle = "rgba(246,103,68,0.20)"; ctx.fillRect(rx, ry, rw, rh); }
        ctx.strokeStyle = accent ? BRAND : "rgba(200,200,200,0.7)"; ctx.lineWidth = 1;
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.font = ratioFont; ctx.fillStyle = "#9a9a9a";
        ctx.fillText(ratioLabel(w, h), ccx, cardY + 67, maxTxt);
      };

      // Output rect goes orange only when the size actually changed; if input
      // and output match it stays gray like the input (nothing happened).
      const changed = info.inW !== info.outW || info.inH !== info.outH;
      drawCard(startX, "INPUT", info.inW, info.inH, false);
      ctx.font = `14px ${fam}`; ctx.fillStyle = "#9a9a9a"; ctx.textAlign = "center";
      ctx.fillText("→", startX + cardW + gap + arrowW / 2, midY);
      drawCard(startX + cardW + gap + arrowW + gap, "OUTPUT", info.outW, info.outH, changed);

      ctx.restore();
      return r;
    };
  },
});

// ── executed payload: learn real in/out dims + result preview ──
api.addEventListener("executed", ({ detail }) => {
  const frames = detail?.output?.pixaroma_image_resize;
  if (!frames || !frames.length) return;
  let node = app.graph.getNodeById(detail.node);
  if (!node && typeof detail.node === "string") node = app.graph.getNodeById(parseInt(detail.node, 10));
  if (!node || node.comfyClass !== "PixaromaImageResize") return;
  const f = frames[0];
  if (!node.properties) node.properties = {};
  node.properties.pixIrDims = { in_w: f.in_w, in_h: f.in_h, out_w: f.out_w, out_h: f.out_h };
  node.setDirtyCanvas(true, true);
});

// ── graphToPrompt: inject state into the hidden input (subgraph-safe) ──
const _origG2P = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origG2P(...args);
  const out = result?.output;
  if (out) {
    let index = null;
    const buildIndex = () => {
      const m = new Map();
      const visit = (g) => {
        if (!g) return;
        for (const n of (g._nodes || g.nodes || [])) {
          if (!n) continue;
          if (n.comfyClass === "PixaromaImageResize" || n.type === "PixaromaImageResize")
            m.set(String(n.id), n);
          const inner = n.subgraph || n.graph || n._graph;
          if (inner && inner !== g) visit(inner);
        }
      };
      visit(app.graph);
      return m;
    };
    for (const id in out) {
      if (out[id]?.class_type !== "PixaromaImageResize") continue;
      if (!index) index = buildIndex();
      const sId = String(id);
      let node = index.get(sId);
      if (!node && sId.includes(":")) node = index.get(sId.slice(sId.lastIndexOf(":") + 1));
      const state = node?.properties?.[STATE_PROP] || JSON.stringify(DEFAULT_STATE);
      out[id].inputs = out[id].inputs || {};
      out[id].inputs[HIDDEN_INPUT] = state;
    }
  }
  return result;
};
