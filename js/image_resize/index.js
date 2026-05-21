import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { hideJsonWidget, BRAND } from "../shared/index.mjs";
import { buildModePanel, previewResize, injectResizePanelCSS } from "../shared/resize_panel.mjs";
import {
  injectCSS, buildModeChips, buildFooter, buildResampleAndUpscale,
  buildPreview, openResamplePopup, RESAMPLE_IDS, resampleLabel,
} from "./ui.mjs";

injectCSS();
injectResizePanelCSS();

const STATE_PROP = "imageResizeState";
const HIDDEN_INPUT = "ImageResizeState";
const DEFAULT_STATE = {
  mode: "off", max_mp: 1.0, longest_side: 1024, scale_factor: 1.0,
  fit_w: 1024, fit_h: 1024, cover_w: 1024, cover_h: 1024,
  ratio_preset: "1:1", ratio_w: 1, ratio_h: 1, ratio_action: "crop",
  pad_color: "#000000", pad_top: 0, pad_bottom: 0, pad_left: 0, pad_right: 0,
  crop_anchor: "center", crop_scale: true,
  snap: 0, resample: "auto", allow_upscale: true,
  preview_open: false,
};
const WH_MODES = new Set(["fit_inside", "cover"]);
const MIN_W = 360; // minimum node width (the two IN/OUT cards need the room)

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
function getReadoutInfo(node) {
  const state = readState(node);
  const cached = node.properties?.pixIrDims;       // {in_w,in_h,out_w,out_h} from last run
  const live = getInputDims(node);
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

function renderPreviewThumb(node) {
  const body = node._pixIrEls?.body;
  if (!body) return;
  const p = node.properties?.pixIrPreview; // {url, out_w, out_h}
  if (!p?.url) {
    body.innerHTML = `<div class="pix-ir-hint">Run the workflow to see the result</div>`;
    return;
  }
  body.innerHTML = `<img src="${p.url}"><div class="pix-ir-badge">${p.out_w} × ${p.out_h}</div>`;
}

function isWired(node, name) {
  const inp = node.inputs?.find((i) => i.name === name);
  return !!(inp && inp.link != null);
}

// Lock the matching W/H field in the active panel when its wire is connected.
// buildWHPanel renders Width then Height as the first two text inputs.
function applyWiredLocks(node, root) {
  const state = readState(node);
  if (!WH_MODES.has(state.mode)) return;
  const numEls = [...root.querySelectorAll(".pix-li-numinput input")];
  if (isWired(node, "width") && numEls[0]) lockField(numEls[0]);
  if (isWired(node, "height") && numEls[1]) lockField(numEls[1]);
}
function lockField(inp) {
  inp.readOnly = true;
  inp.style.opacity = "0.55";
  inp.title = "Driven by wired input";
}

// On connect of width/height while NOT in a W×H mode, switch to Crop to fill
// (the "make it exactly this size" default). User-intent only — gated by the
// configuring flag at the call site (Vue Compat #17).
function maybeAutoSwitch(node) {
  const state = readState(node);
  if ((isWired(node, "width") || isWired(node, "height")) && !WH_MODES.has(state.mode)) {
    writeState(node, { ...state, mode: "cover" });
  }
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
  root.innerHTML = "";

  const chips = buildModeChips(state);
  root.appendChild(chips);

  const panel = buildModePanel(state.mode, node, state, writeState,
    () => node.setDirtyCanvas(true, true), STATE_PROP,
    { previewMaxW: 134, previewMaxH: 86, cropOnly: true, inputDims: getInputDims(node), oneLine: true });
  if (panel) {
    applyInlineLabel(panel, state.mode);
    if (state.mode === "fit_inside" || state.mode === "cover") applyWHLayout(panel);
    if (state.mode === "cover") applyCoverControls(node, panel);
    // No redundant title row — the highlighted button names the mode. Saves a
    // row of height; matches the Pad panel which never had a title.
    panel.querySelector(".pix-li-panel-label")?.remove();
    root.appendChild(panel);
  }

  const footer = buildFooter(state);
  root.appendChild(footer);

  const { wrap: ruWrap, box, prev, dd, next, valueEl } = buildResampleAndUpscale(state);
  root.appendChild(ruWrap);

  const { wrap: prevWrap, bar, body } = buildPreview(state);
  root.appendChild(prevWrap);

  node._pixIrEls = { body, bar };
  applyWiredLocks(node, root);
  node.setDirtyCanvas(true, true); // repaint the canvas-painted size readout
  if (state.preview_open) renderPreviewThumb(node);

  // ── wiring ──
  chips.addEventListener("click", (e) => {
    const c = e.target.closest(".pix-ir-chip");
    if (!c) return;
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
  box.addEventListener("change", () => {
    writeState(node, { ...readState(node), allow_upscale: box.checked });
    node.setDirtyCanvas(true, true);
  });
  bar.addEventListener("click", () => {
    const s = readState(node);
    writeState(node, { ...s, preview_open: !s.preview_open });
    renderUI(node);
    refit(node);
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

    const _origConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, idx, connected, link, ioSlot) {
      const r = _origConn?.apply(this, arguments);
      if (!this._pixIrConfiguring && this._pixIrRoot) {
        if (connected) maybeAutoSwitch(this); // user intent only (Vue Compat #17)
        renderUI(this);
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
      this._pixIrEls = null;
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
      const info = getReadoutInfo(this);
      const cx = this.size[0] / 2;
      const fam = "ui-sans-serif, system-ui, sans-serif";
      const capFont = `8px ${fam}`;
      const dimsFont = `bold 10px ${fam}`;
      const ratioFont = `8px ${fam}`;
      const midY = 44; // vertical center of the 4 slot rows
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
        ctx.font = capFont; ctx.fillStyle = "#9a9a9a";
        ctx.fillText(label, ccx, cardY + 13);
        ctx.font = dimsFont; ctx.fillStyle = BRAND;
        ctx.fillText(`${w}×${h}`, ccx, cardY + 27);
        const { rw, rh } = aspectRectDims(w, h, rectMaxW, rectMaxH);
        const rx = Math.round(ccx - rw / 2) + 0.5, ry = Math.round(cardY + 47 - rh / 2) + 0.5;
        if (accent) { ctx.fillStyle = "rgba(246,103,68,0.20)"; ctx.fillRect(rx, ry, rw, rh); }
        ctx.strokeStyle = accent ? BRAND : "rgba(200,200,200,0.7)"; ctx.lineWidth = 1;
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.font = ratioFont; ctx.fillStyle = "#9a9a9a";
        ctx.fillText(ratioLabel(w, h), ccx, cardY + 67);
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
  if (f.filename) {
    const url = `/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || "")}&type=${f.type || "temp"}&t=${Date.now()}`;
    node.properties.pixIrPreview = { url, out_w: f.out_w, out_h: f.out_h };
  }
  node.setDirtyCanvas(true, true);
  if (readState(node).preview_open) renderPreviewThumb(node);
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
