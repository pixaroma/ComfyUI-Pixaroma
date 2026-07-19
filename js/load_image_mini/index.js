// Load Image Mini Pixaroma - the slim (Version B "toolbar minimal") face.
//
// It REUSES Load Image's proven picker backend verbatim: the upload / paste /
// drag-drop / clipspace / native-preview / defensive-cache machinery in
// ../load_image/api.mjs is all keyed on node._pixLi* fields (class-agnostic), so
// this node sets those fields and gets the whole thing - including Mask Editor
// and Copy/Paste (Clipspace) - for free. The RESIZE controls live in the gear
// panel (./settings.mjs), which in turn reuses Load Image's own resize UI. This
// file only paints the compact face (cards + toolbar + file row + preview) and
// wires the picks.
//
// State lives on node.properties.loadImagePixState (see core.mjs for why that
// key) and is injected into the hidden LoadImageMiniState input by the
// graphToPrompt hook at the bottom (Vue Compat #9).

import { app } from "/scripts/app.js";
import { hideJsonWidget, installResizeFloor, installCanvasZoomPassthrough } from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { applyAdaptiveCanvasOnly, isVueNodes, canvasBackingScale, installZoomRepaint } from "../shared/nodes2.mjs";
import {
  setSelectedImage, updateNativePreview, pickAndUploadFile, pasteFromClipboard,
  uploadImageToInput, splitFilenameSubfolder,
} from "../load_image/api.mjs";
import { openImageDropdown } from "../load_image/ui.mjs";
import { previewResize } from "../load_image/resize_modes.mjs";
import {
  ACCENT_SETTING, BRAND, CLASS, DEFAULT_STATE, HIDDEN_INPUT, STATE_PROP,
  accentOf, readState, writeState,
} from "./core.mjs";
import { openMiniSettings, closeMiniSettingsFor } from "./settings.mjs";

const MINI_WIDGET = "pixaroma_load_image_mini_ui";
const MIN_W = 232;
const DEFAULT_W = 262;
const DEFAULT_H = 300;
// Nodes 2.0 preview canvas floor (fills any extra node height) + the smaller
// manual-resize floor so the node can be dragged compact (Load Image pattern).
const LM_PREVIEW_FILL_MIN = 164;
const LM_PREVIEW_FLOOR_MIN = 56;
// INPUT->OUTPUT cards: painted in the LEFT slot dead-space in Classic (like
// Outpaint), or on a canvas row in Nodes 2.0. CARDS_MID_Y centres them across
// the two output rows; RIGHT_RESERVE keeps them clear of the right-aligned
// output labels ("image_info" is the longest).
const CARDS_H = 36;
const CARDS_MID_Y = 24;
const CARDS_LEFT = 12;
const CARDS_RIGHT_RESERVE = 96;

let _activeMiniNode = null;

// ── inline icons (self-contained, no dependency on a bundled SVG file) ───────
const ICONS = {
  upload: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M12 3l4.2 4.2h-3.2V13h-2V7.2H7.8L12 3z" fill="currentColor"/><path d="M5 14.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  paste: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><rect x="6" y="4.2" width="12" height="16" rx="2.2" stroke="currentColor" stroke-width="2"/><rect x="9" y="2.6" width="6" height="3.4" rx="1.2" fill="currentColor"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19.4 13a7.8 7.8 0 0 0 .05-1 7.8 7.8 0 0 0-.05-1l2-1.55a.5.5 0 0 0 .12-.62l-1.9-3.28a.5.5 0 0 0-.6-.22l-2.36 1a7 7 0 0 0-1.72-1l-.36-2.5a.5.5 0 0 0-.5-.42h-3.8a.5.5 0 0 0-.5.42l-.36 2.5a7 7 0 0 0-1.72 1l-2.36-1a.5.5 0 0 0-.6.22L2.48 8.2a.5.5 0 0 0 .12.62L4.6 11a7.8 7.8 0 0 0 0 2l-2 1.56a.5.5 0 0 0-.12.62l1.9 3.28a.5.5 0 0 0 .6.22l2.36-1a7 7 0 0 0 1.72 1l.36 2.5a.5.5 0 0 0 .5.42h3.8a.5.5 0 0 0 .5-.42l.36-2.5a7 7 0 0 0 1.72-1l2.36 1a.5.5 0 0 0 .6-.22l1.9-3.28a.5.5 0 0 0-.12-.62L19.4 13zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>',
};

function injectCSS() {
  if (document.getElementById("pix-lm-css")) return;
  const s = document.createElement("style");
  s.id = "pix-lm-css";
  s.textContent = `
    .pix-lm-root { width:100%; box-sizing:border-box; position:relative; background:#2a2a2a;
      border-radius:4px; color:#ddd; font-family: ui-sans-serif, system-ui, sans-serif; font-size:11px; }
    .pix-lm-inner { position:absolute; inset:0; overflow:hidden; display:flex; flex-direction:column;
      gap:7px; padding:6px 8px 8px; box-sizing:border-box; }

    /* INPUT -> OUTPUT size cards. In Classic they are PAINTED in the slot
       dead-space (onDrawForeground); in Nodes 2.0 this canvas carries the same
       pixels as a row. display:none in Classic so it takes no body height. */
    .pix-lm-cards { flex:0 0 auto; width:100%; height:44px; display:block; }

    /* Toolbar: [Upload] [paste] [gear], each a proper button that hovers to the
       node accent with white text (Pixaroma convention: hover = full accent). */
    .pix-lm-toolbar { display:flex; align-items:stretch; gap:6px; flex:0 0 auto; flex-wrap:wrap; }
    .pix-lm-upload { flex:1 1 auto; min-width:104px; display:flex; align-items:center; justify-content:center; gap:8px;
      background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.14); border-radius:7px;
      color:var(--pix-lm-acc,${BRAND}); height:34px;
      font:600 12px ui-sans-serif, system-ui, sans-serif; cursor:pointer;
      transition:background .1s, border-color .1s, color .1s; }
    .pix-lm-upload .lbl { color:#dcdce0; transition:color .1s; }
    .pix-lm-upload:hover { background:var(--pix-lm-acc,${BRAND}); border-color:var(--pix-lm-acc,${BRAND}); color:#fff; }
    .pix-lm-upload:hover .lbl { color:#fff; }
    .pix-lm-ibtn { width:34px; height:34px; flex:0 0 auto; display:flex; align-items:center; justify-content:center;
      background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.14); border-radius:7px;
      color:#c2c2c8; cursor:pointer; transition:background .1s, border-color .1s, color .1s; }
    .pix-lm-ibtn:hover { background:var(--pix-lm-acc,${BRAND}); border-color:var(--pix-lm-acc,${BRAND}); color:#fff; }
    .pix-lm-toolbar svg { display:block; pointer-events:none; }

    /* File row [<] [ dropdown ] [>] - reuses the visual language of Load Image. */
    .pix-lm-filerow { display:flex; gap:6px; align-items:stretch; flex:0 0 auto; }
    .pix-lm-nav { flex:0 0 auto; width:30px; background:#1d1d1d; border:1px solid #444; border-radius:4px;
      color:var(--pix-lm-acc,${BRAND}); font-size:11px; font-weight:700; cursor:pointer; display:flex;
      align-items:center; justify-content:center; user-select:none; transition:border-color .08s; }
    .pix-lm-nav:hover:not(.disabled) { border-color:var(--pix-lm-acc,${BRAND}); }
    .pix-lm-nav.disabled { opacity:.3; cursor:default; }
    .pix-lm-dropdown { flex:1; min-width:0; background:#1d1d1d; border:1px solid #444; border-radius:4px;
      padding:6px 10px; color:#ccc; cursor:pointer; display:flex; justify-content:space-between; align-items:center; user-select:none; }
    .pix-lm-dropdown:hover { border-color:var(--pix-lm-acc,${BRAND}); }
    .pix-lm-dropdown .name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pix-lm-dropdown .counter { color:#777; font-size:9px; margin-left:6px; flex-shrink:0;
      font-family: ui-monospace, monospace; }
    .pix-lm-dropdown .arrow { color:var(--pix-lm-acc,${BRAND}); font-size:13px; margin-left:6px; line-height:1; }

    /* Nodes 2.0 preview canvas (fills the remaining node height). */
    .pix-lm-preview-canvas { display:block; width:100%; box-sizing:border-box; flex:1 1 0;
      min-height:${LM_PREVIEW_FILL_MIN}px; border-radius:4px; }
  `;
  document.head.appendChild(s);
}

// Nodes 2.0: hide ComfyUI's native input image-preview + collapse the native
// flex:1 preview CONTAINER for this node - we draw our own preview canvas
// instead. Scoped to .pix-lm-root so it is a no-op elsewhere and in legacy.
function injectNodes2CSS() {
  if (document.getElementById("pix-lm-nodes2-css")) return;
  const s = document.createElement("style");
  s.id = "pix-lm-nodes2-css";
  s.textContent =
    ".lg-node:has(.pix-lm-root) .image-preview{display:none !important;}" +
    ".lg-node:has(.pix-lm-root) .lg-node-widgets + div.flex-1{display:none !important;}";
  document.head.appendChild(s);
}

function ibtn(kind, title) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pix-lm-ibtn";
  b.title = title;
  b.innerHTML = ICONS[kind];
  return b;
}

// Build the DOM face (one widget). renderUI is deliberately NOT needed - the
// only dynamic part is the cards, rebuilt in-place by updateCards.
function buildRoot() {
  const root = document.createElement("div");
  root.className = "pix-lm-root";
  const inner = document.createElement("div");
  inner.className = "pix-lm-inner";
  root.appendChild(inner);

  // Cards canvas. In Classic the cards are painted in the slot dead-space
  // instead (display:none here so they take no body height); in Nodes 2.0 this
  // canvas carries them as a row.
  const cards = document.createElement("canvas");
  cards.className = "pix-lm-cards";
  cards.style.display = isVueNodes() ? "block" : "none";
  inner.appendChild(cards);

  // Toolbar.
  const bar = document.createElement("div");
  bar.className = "pix-lm-toolbar";
  const up = document.createElement("button");
  up.type = "button";
  up.className = "pix-lm-upload";
  up.dataset.role = "upload";
  up.innerHTML = ICONS.upload + '<span class="lbl">Upload</span>';
  const paste = ibtn("paste", "Paste from clipboard (Ctrl+V)");
  paste.dataset.role = "paste";
  const gear = ibtn("gear", "Resize & settings");
  gear.dataset.role = "gear";
  bar.append(up, paste, gear);
  inner.appendChild(bar);

  // File row.
  const fileRow = document.createElement("div");
  fileRow.className = "pix-lm-filerow";
  const prev = document.createElement("button");
  prev.type = "button"; prev.className = "pix-lm-nav"; prev.dataset.role = "prev";
  prev.title = "Previous image (PageUp)"; prev.textContent = "◀";
  const dd = document.createElement("div");
  dd.className = "pix-lm-dropdown"; dd.dataset.role = "dropdown";
  dd.innerHTML = '<span class="name">— no image —</span><span class="counter" data-role="counter"></span><span class="arrow">▼</span>';
  const next = document.createElement("button");
  next.type = "button"; next.className = "pix-lm-nav"; next.dataset.role = "next";
  next.title = "Next image (PageDown)"; next.textContent = "▶";
  fileRow.append(prev, dd, next);
  inner.appendChild(fileRow);

  return { root, inner, cards };
}

function applyAccent(node) {
  const inner = node._pixLmInner;
  if (inner) inner.style.setProperty("--pix-lm-acc", accentOf(node));
}

// The current preview/source image (loaded pick, or a fetched /view on restore).
function currentImage(node) {
  const a = node.imgs?.[0];
  if (a?.complete && a.naturalWidth) return a;
  const b = node._pixLmPreviewImgEl;
  return (b?.complete && b.naturalWidth) ? b : null;
}

// ── INPUT -> OUTPUT cards (painted, Outpaint style) ──────────────────────────
function cardsInfo(node) {
  const img = currentImage(node);
  if (!img) return { mode: "msg", text: "Upload or pick an image" };
  const inW = img.naturalWidth, inH = img.naturalHeight;
  const { w: outW, h: outH } = previewResize(inW, inH, readState(node));
  return { mode: "dual", inW, inH, outW, outH, changed: inW !== outW || inH !== outH };
}

function roundRectP(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Paint the cards into ctx within [leftPad .. leftPad+pairW], centred on midY.
// CSS-pixel space, so it is renderer-agnostic: the same function paints the
// Classic dead-space AND the Nodes 2.0 canvas (the Outpaint pattern).
function paintCardsInto(ctx, node, leftPad, midY, pairW) {
  const info = cardsInfo(node);
  const acc = accentOf(node);
  const fam = "ui-sans-serif, system-ui, sans-serif";
  ctx.save();
  ctx.textBaseline = "middle";
  if (info.mode === "msg") {
    ctx.font = "11px " + fam;
    ctx.textAlign = "left";
    ctx.fillStyle = acc;
    ctx.fillText(info.text, leftPad, midY, pairW);
    ctx.restore();
    return;
  }
  const GAP = 16; // room for the chevron between the two cards
  const cardW = (pairW - GAP) / 2;
  const y = midY - CARDS_H / 2;
  const card = (x, label, w, h, accent) => {
    roundRectP(ctx, x + 0.5, y + 0.5, cardW - 1, CARDS_H - 1, 5);
    ctx.fillStyle = "#1d1d1d"; ctx.fill();
    ctx.strokeStyle = accent ? acc : "#444"; ctx.lineWidth = 1; ctx.stroke();
    const cx = x + cardW / 2;
    ctx.textAlign = "center";
    ctx.font = "8.5px " + fam; ctx.fillStyle = "#8a8a8a";
    ctx.fillText(label, cx, y + 11, cardW - 8);
    ctx.font = "bold 11px " + fam; ctx.fillStyle = accent ? acc : "#cfcfcf";
    ctx.fillText(w + " × " + h, cx, y + 25, cardW - 8);
  };
  card(leftPad, "INPUT", info.inW, info.inH, false);
  card(leftPad + cardW + GAP, "OUTPUT", info.outW, info.outH, info.changed);
  const ax = leftPad + cardW + GAP / 2;
  ctx.strokeStyle = info.changed ? acc : "#8a8a8a"; ctx.lineWidth = 1.5;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(ax - 2.5, midY - 4); ctx.lineTo(ax + 2.5, midY); ctx.lineTo(ax - 2.5, midY + 4);
  ctx.stroke();
  ctx.restore();
}

// Nodes 2.0: paint the cards canvas row. Classic hides that canvas and paints in
// the slot dead-space via onDrawForeground instead.
function renderCardsCanvas(node) {
  const cv = node._pixLmCards;
  if (!cv || cv.style.display === "none") return;
  const cssW = cv.clientWidth, cssH = cv.clientHeight;
  if (cssW <= 0 || cssH <= 0) return;
  const ctx = sizeCanvas(cv, cssW, cssH);
  paintCardsInto(ctx, node, 4, cssH / 2, cssW - 8);
}

// Refresh the cards on whichever surface applies.
function renderCards(node) {
  if (isVueNodes()) renderCardsCanvas(node);
  node.setDirtyCanvas?.(true, true); // Classic repaints via onDrawForeground
}

function refreshFace(node) {
  applyAccent(node);
  renderCards(node);
  if (isVueNodes()) renderPreviewCanvas(node);
  node.setDirtyCanvas?.(true, true);
}

// ── dropdown label + arrows (mirrors Load Image) ─────────────────────────────
function refreshDropdown(node) {
  const root = node._pixLmRoot;
  if (!root) return;
  const w = node._pixLiImageWidget;
  const ddName = root.querySelector('[data-role="dropdown"] .name');
  const counter = root.querySelector('[data-role="counter"]');
  const value = w?.value || "";
  if (ddName) ddName.textContent = value ? splitFilenameSubfolder(value).filename : "— no image —";
  const values = w?.options?.values || [];
  if (counter) {
    if (value && values.length > 1) {
      const idx = values.indexOf(value);
      counter.textContent = idx >= 0 ? `${idx + 1} / ${values.length}` : "";
    } else counter.textContent = "";
  }
  const disabled = values.length < 2;
  root.querySelector('[data-role="prev"]')?.classList.toggle("disabled", disabled);
  root.querySelector('[data-role="next"]')?.classList.toggle("disabled", disabled);
}

function pickByOffset(node, offset) {
  const w = node._pixLiImageWidget;
  if (!w) return;
  const values = w.options?.values || [];
  if (values.length === 0) return;
  const cur = values.indexOf(w.value);
  let next;
  if (cur < 0) next = offset > 0 ? 0 : values.length - 1;
  else next = ((cur + offset) % values.length + values.length) % values.length;
  setSelectedImage(node, values[next]);
}

// ── Nodes 2.0 preview canvas ─────────────────────────────────────────────────
function sizeCanvas(cv, cssW, cssH) {
  const s = canvasBackingScale(cssW, cssH);
  const bw = Math.round(cssW * s), bh = Math.round(cssH * s);
  if (cv.width !== bw) cv.width = bw;
  if (cv.height !== bh) cv.height = bh;
  const ctx = cv.getContext("2d");
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return ctx;
}

function renderPreviewCanvas(node) {
  const cv = node._pixLmImageCanvas;
  if (!cv || cv.clientWidth <= 0 || cv.clientHeight <= 0) return;
  const cssW = cv.clientWidth, cssH = cv.clientHeight;
  const DIMS_H = 18;
  const areaH = Math.max(20, cssH - DIMS_H);
  const ctx = sizeCanvas(cv, cssW, cssH);
  const im = currentImage(node);
  if (im) {
    const scale = Math.min((cssW - 12) / im.naturalWidth, areaH / im.naturalHeight, 1);
    const w = Math.round(im.naturalWidth * scale), h = Math.round(im.naturalHeight * scale);
    ctx.drawImage(im, Math.round((cssW - w) / 2), Math.round((areaH - h) / 2), w, h);
    ctx.fillStyle = "#9a9a9a";
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(`${im.naturalWidth} × ${im.naturalHeight}`, cssW / 2, cssH - DIMS_H / 2);
  } else {
    ctx.fillStyle = "#151515";
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.strokeStyle = "#3a3a3a"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.strokeRect(4.5, 4.5, cssW - 9, cssH - 9); ctx.setLineDash([]);
  }
}

// Ensure an image is loaded for the preview (fetch /view on restore), then draw.
function updatePreview(node) {
  if (!isVueNodes()) return;
  const im = node.imgs?.[0];
  if (!(im?.complete && im.naturalWidth)) {
    const fn = node._pixLiImageWidget?.value;
    if (fn) {
      const { subfolder, filename } = splitFilenameSubfolder(fn);
      const src = `/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=${encodeURIComponent(subfolder)}&t=${Date.now()}`;
      let elImg = node._pixLmPreviewImgEl;
      if (!elImg) { elImg = new Image(); node._pixLmPreviewImgEl = elImg; }
      elImg.onload = () => { renderCards(node); renderPreviewCanvas(node); node.setDirtyCanvas?.(true, true); };
      if (elImg.src !== src) elImg.src = src;
    }
  }
  renderPreviewCanvas(node);
  node.setDirtyCanvas?.(true, true);
}

function createPreviewCanvas(node) {
  const inner = node._pixLmInner;
  if (!inner) return;
  const cv = document.createElement("canvas");
  cv.className = "pix-lm-preview-canvas";
  inner.appendChild(cv);
  node._pixLmImageCanvas = cv;

  // Both canvases are full-width, so a node resize changes both - repaint the
  // cards row alongside the preview.
  const repaint = () => { renderCardsCanvas(node); renderPreviewCanvas(node); };
  const ro = new ResizeObserver(repaint);
  ro.observe(cv);
  node._pixLmPreviewRO = ro;

  node._pixLmZoomOff = installZoomRepaint(
    node,
    () => [cv.clientWidth || 0, cv.clientHeight || 0],
    repaint,
    "_pixLmZoomRaf",
  );
  requestAnimationFrame(() => { updatePreview(node); renderCardsCanvas(node); });
}

// ── no inputs (Load Image Pattern #17) ───────────────────────────────────────
function stripInputs(node) {
  if (!node?.inputs || node.inputs.length === 0) return false;
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    if (node.inputs[i]?.link != null) { try { node.disconnectInput(i); } catch (_e) { /* ignore */ } }
    node.removeInput(i);
  }
  node.setDirtyCanvas?.(true, true);
  return true;
}

// Hide the auto-created image/upload widgets. Own copy (not Load Image's) so the
// late re-hide pass skips THIS node's DOM widget by name.
function hideNativeCombo(node) {
  let imageWidget = null;
  for (const w of (node.widgets || [])) {
    if (!w) continue;
    if (w.name === "image") imageWidget = w;
    w.hidden = true;
    w.computeSize = () => [0, -4];
    if (!w.options) w.options = {};
    w.options.canvasOnly = true;
    if (w.element) w.element.style.display = "none";
  }
  requestAnimationFrame(() => {
    for (const w of (node.widgets || [])) {
      if (!w || w.name === MINI_WIDGET) continue;
      const el = w.element || w.inputEl;
      if (el) el.style.display = "none";
    }
  });
  return imageWidget;
}

function setupNode(node) {
  injectCSS();
  hideJsonWidget(node.widgets, HIDDEN_INPUT);

  const imageWidget = hideNativeCombo(node);
  node._pixLiImageWidget = imageWidget;   // api.mjs field name (shared backend)
  stripInputs(node);

  const { root, inner, cards } = buildRoot();
  node._pixLmRoot = root;
  node._pixLmInner = inner;
  node._pixLmCards = cards;
  applyAccent(node);

  // Content-height measure (Load Image pattern): sum inner.children, counting
  // the preview canvas at its MIN (never its grown height). Cache the last good
  // measure so a hidden node (folded group) doesn't inflate.
  const _lastGoodH = {};
  function measureH(previewMin) {
    let totalH = 0, visible = 0;
    for (const child of inner.children) {
      const st = window.getComputedStyle(child);
      if (st.position === "absolute" || st.position === "fixed") continue;
      if (st.display === "none") continue;
      if (child === node._pixLmImageCanvas) { totalH += previewMin; visible += 1; continue; }
      totalH += child.offsetHeight;
      visible += 1;
    }
    const padding = 14;                    // 6 top + 8 bottom
    const gaps = Math.max(0, visible - 1) * 7;
    if (totalH < 20) return _lastGoodH[previewMin] || 200;
    // Coarse-round to a 4px grid so sub-pixel font metrics can't creep node.size
    // taller on every workflow open (grow-to-content is grow-only; Vue Compat #18).
    const result = Math.round((totalH + padding + gaps) / 4) * 4;
    _lastGoodH[previewMin] = result;
    return result;
  }
  const measureContentHeight = () => measureH(LM_PREVIEW_FILL_MIN);
  const measureFloorHeight = () => measureH(LM_PREVIEW_FLOOR_MIN);
  node._pixLmMeasureHeight = measureContentHeight;

  installCanvasZoomPassthrough(root);
  const widget = node.addDOMWidget(MINI_WIDGET, "custom", root, {
    getValue: () => null,
    setValue: () => {},
    getMinHeight: measureContentHeight,
    getMaxHeight: measureContentHeight,
    margin: 0,
    serialize: false,
  });
  applyAdaptiveCanvasOnly(widget);
  node._pixLmWidget = widget;

  node._pixLmFloorOff = installResizeFloor(root, measureFloorHeight);

  if (isVueNodes()) {
    widget.computeLayoutSize = () => ({ minHeight: measureContentHeight(), minWidth: 1 });
    createPreviewCanvas(node);
    injectNodes2CSS();
  }

  // Fresh-node default size. SYNCHRONOUS so configure() overrides for saved
  // workflows (Vue Compat #8 / node UI convention #9).
  if (!node.size || node.size[0] < DEFAULT_W) node.size[0] = DEFAULT_W;
  if (!node.size[1] || node.size[1] < DEFAULT_H) node.size[1] = DEFAULT_H;

  // Ctrl+V routing.
  node._pixLmOnSelected = () => { _activeMiniNode = node; };
  node._pixLmOnDeselected = () => { if (_activeMiniNode === node) _activeMiniNode = null; };

  // api.mjs hooks: fired when a freshly-picked image's natural dims arrive, and
  // when a filename changes.
  node._pixLiOnImageLoaded = () => onImageReady();
  node._pixLiOnFilenameChanged = () => refreshDropdown(node);

  function onImageReady() {
    renderCards(node);
    updatePreview(node);
    node.setDirtyCanvas?.(true, true);
  }
  function refreshAfterImageReady() {
    if (node._pixLmImgPoll) { clearInterval(node._pixLmImgPoll); node._pixLmImgPoll = null; }
    if (node.imgs?.[0]?.naturalWidth) { onImageReady(); return; }
    let ticks = 0;
    const poll = setInterval(() => {
      if (node.imgs?.[0]?.naturalWidth) { clearInterval(poll); node._pixLmImgPoll = null; onImageReady(); }
      else if (++ticks > 30) { clearInterval(poll); node._pixLmImgPoll = null; }
    }, 100);
    node._pixLmImgPoll = poll;
  }
  refreshAfterImageReady();

  // Wrap the image widget callback (native drag-drop path) + track the original
  // (non-clipspace) name for the Filename output (issue #51 parity).
  if (imageWidget) {
    const origCallback = imageWidget.callback;
    imageWidget.callback = function () {
      const ret = origCallback?.apply(this, arguments);
      if (imageWidget.value) {
        node._pixLiSelectedFilename = imageWidget.value;
        if (!/clipspace/i.test(imageWidget.value)) node._pixLiOrigName = imageWidget.value;
      }
      refreshAfterImageReady();
      refreshDropdown(node);
      return ret;
    };
    if (imageWidget.value) {
      node._pixLiSelectedFilename = imageWidget.value;
      if (!/clipspace/i.test(imageWidget.value)) node._pixLiOrigName = imageWidget.value;
    }
    // Catch EXTERNAL writes (Mask Editor, Copy/Paste Clipspace) that bypass the
    // callback - keeps the defensive cache in lockstep so graphToPrompt never
    // reverts to a stale file (issue #50 parity).
    try {
      const desc = Object.getOwnPropertyDescriptor(imageWidget, "value");
      if (!desc || desc.configurable) {
        const origGet = desc && desc.get, origSet = desc && desc.set;
        let stored = imageWidget.value;
        Object.defineProperty(imageWidget, "value", {
          configurable: true,
          enumerable: desc ? desc.enumerable !== false : true,
          get() { return origGet ? origGet.call(this) : stored; },
          set(v) {
            if (origSet) origSet.call(this, v); else stored = v;
            if (v && !isGraphLoading()) {
              node._pixLiSelectedFilename = v;
              if (!/clipspace/i.test(v)) node._pixLiOrigName = v;
            }
          },
        });
      }
    } catch (e) { console.warn("[Load Image Mini] could not intercept image value", e); }
  }

  // Toolbar: upload / paste / gear.
  root.querySelector('[data-role="upload"]')?.addEventListener("click", async (e) => {
    e.stopPropagation();
    try { const saved = await pickAndUploadFile(node); if (saved) refreshDropdown(node); }
    catch (err) { console.error("[Load Image Mini] upload failed", err); alert("Upload failed: " + err.message); }
  });
  root.querySelector('[data-role="paste"]')?.addEventListener("click", async (e) => {
    e.stopPropagation();
    try { const saved = await pasteFromClipboard(node); if (saved) refreshDropdown(node); }
    catch (err) { console.error("[Load Image Mini] paste failed", err); alert("Paste failed: " + err.message); }
  });
  root.querySelector('[data-role="gear"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    openMiniSettings(node, { onChange: () => refreshFace(node) });
  });

  // Drop fallback on the widget root.
  root.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault(); e.stopPropagation();
  });
  root.addEventListener("drop", async (e) => {
    e.preventDefault(); e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    try { await uploadImageToInput(node, file); refreshDropdown(node); }
    catch (err) { console.error("[Load Image Mini] drop failed", err); alert("Upload failed: " + err.message); }
  });

  // Dropdown + arrows.
  const dd = root.querySelector('[data-role="dropdown"]');
  dd?.addEventListener("click", (e) => {
    e.stopPropagation();
    openImageDropdown(node, dd, () => refreshDropdown(node));
  });
  const prevBtn = root.querySelector('[data-role="prev"]');
  const nextBtn = root.querySelector('[data-role="next"]');
  prevBtn?.addEventListener("click", (e) => { e.stopPropagation(); if (!prevBtn.classList.contains("disabled")) pickByOffset(node, -1); });
  nextBtn?.addEventListener("click", (e) => { e.stopPropagation(); if (!nextBtn.classList.contains("disabled")) pickByOffset(node, +1); });

  // Initial paint - deferred past configure() so a restored workflow shows its
  // saved state, not the defaults.
  queueMicrotask(() => {
    refreshDropdown(node);
    renderCards(node);
    applyAccent(node);
    if (isVueNodes() && node._pixLiImageWidget?.value && !node.imgs?.[0]?.naturalWidth) {
      updateNativePreview(node, node._pixLiImageWidget.value);
    }
    // Nodes 2.0 fresh node: grow to fit the clipped content once (never on the
    // load path - Vue Compat #18).
    if (isVueNodes()) {
      const settle = (tries) => requestAnimationFrame(() => {
        if (isGraphLoading() || !inner || typeof node.setSize !== "function") return;
        const clipped = inner.scrollHeight - inner.clientHeight;
        if (clipped > 1 && tries > 0) { node.setSize([node.size[0], (node.size[1] || 0) + clipped + 2]); settle(tries - 1); }
      });
      settle(6);
    }
  });
}

app.registerExtension({
  name: "Pixaroma.LoadImageMini",

  settings: [{
    id: ACCENT_SETTING,
    name: "Default button colour",
    type: "text",
    defaultValue: BRAND,
    tooltip: "The accent for new Load Image Mini nodes. Each node can override it in its own gear settings.",
    category: ["👑 Pixaroma", "Load Image Mini"],
  }],

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;
    if (nodeType.prototype._pixLmPatched) return;
    nodeType.prototype._pixLmPatched = true;

    nodeType.prototype.onConnectInput = function () { return false; };

    const _origConn = nodeType.prototype.onConnectionsChange;
    const INPUT_T = (typeof LiteGraph !== "undefined" && LiteGraph.INPUT != null) ? LiteGraph.INPUT : 1;
    nodeType.prototype.onConnectionsChange = function (type) {
      const r = _origConn?.apply(this, arguments);
      if (type === INPUT_T && !isGraphLoading()) stripInputs(this);
      return r;
    };

    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return _origResize?.apply(this, arguments);
    };

    // Classic: paint the INPUT->OUTPUT cards in the LEFT slot dead-space (like
    // Outpaint) + a min-width self-heal (Vue Compat #18: setDirtyCanvas is a
    // redraw flag, not a dirty-tracker trip). Nodes 2.0 skips body painting and
    // carries the cards on the DOM canvas instead.
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const r = _origDraw?.apply(this, arguments);
      if (isVueNodes() || this.flags?.collapsed) return r;
      if (this.size[0] < MIN_W) { this.size[0] = MIN_W; this.setDirtyCanvas(true, true); }
      const pairW = this.size[0] - CARDS_LEFT - CARDS_RIGHT_RESERVE;
      // Too narrow to say anything useful - better blank than clipped smears.
      if (pairW >= 120) paintCardsInto(ctx, this, CARDS_LEFT, CARDS_MID_Y, pairW);
      return r;
    };

    const _origSel = nodeType.prototype.onSelected;
    const _origDes = nodeType.prototype.onDeselected;
    nodeType.prototype.onSelected = function () { this._pixLmOnSelected?.(); return _origSel?.apply(this, arguments); };
    nodeType.prototype.onDeselected = function () { this._pixLmOnDeselected?.(); return _origDes?.apply(this, arguments); };

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _origConfigure?.apply(this, arguments);
      stripInputs(this);
      queueMicrotask(() => {
        refreshDropdown(this);
        const w = this._pixLiImageWidget;
        if (w?.value) {
          this._pixLiSelectedFilename = w.value;
          if (!/clipspace/i.test(w.value)) this._pixLiOrigName = w.value;
        }
        renderCards(this);
        applyAccent(this);
      });
      setTimeout(() => { renderCards(this); if (isVueNodes()) updatePreview(this); }, 600);
      return r;
    };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      document.querySelector(".pix-li-popup")?._pixClose?.();
      closeMiniSettingsFor(this);
      if (this._pixLmImgPoll) clearInterval(this._pixLmImgPoll);
      this._pixLmImgPoll = null;
      try { this._pixLmPreviewRO?.disconnect(); } catch {}
      this._pixLmPreviewRO = null;
      try { this._pixLmZoomOff?.(); } catch {}
      this._pixLmZoomOff = null;
      try { cancelAnimationFrame(this._pixLmZoomRaf); } catch {}
      this._pixLmZoomRaf = null;
      try { this._pixLmFloorOff?.(); } catch {}
      this._pixLmFloorOff = null;
      if (_activeMiniNode === this) _activeMiniNode = null;
      return _origRemoved?.apply(this, arguments);
    };
  },

  getNodeMenuItems(node) {
    if (node?.comfyClass !== CLASS) return [];
    return [null, { content: "⚙ Resize & settings", callback: () => openMiniSettings(node, { onChange: () => refreshFace(node) }) }];
  },

  nodeCreated(node) {
    if (node.comfyClass !== CLASS) return;
    setupNode(node);
  },
});

// Global Ctrl+V + PageUp/PageDown for the active mini node.
window.addEventListener("keydown", async (e) => {
  if (!_activeMiniNode) return;
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "v") return;
  const tag = (e.target?.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
  e.preventDefault(); e.stopPropagation();
  try { const saved = await pasteFromClipboard(_activeMiniNode); if (saved) refreshDropdown(_activeMiniNode); }
  catch (err) { console.error("[Load Image Mini] paste failed", err); }
}, true);
window.addEventListener("keydown", (e) => {
  if (!_activeMiniNode) return;
  if (e.key !== "PageUp" && e.key !== "PageDown") return;
  const tag = (e.target?.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
  e.preventDefault(); e.stopPropagation();
  pickByOffset(_activeMiniNode, e.key === "PageUp" ? -1 : +1);
}, true);

// ── graphToPrompt: inject state + orig_name + clipspace-safe filename sync ───
function buildIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    for (const n of graph._nodes || graph.nodes || []) {
      if (!n) continue;
      if (n.comfyClass === CLASS || n.type === CLASS) index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}
function findNode(index, id) {
  const s = String(id);
  if (index.has(s)) return index.get(s);
  const tail = s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : null;
  return tail && index.has(tail) ? index.get(tail) : null;
}

if (!app._pixLmPromptPatched) {
  app._pixLmPromptPatched = true;
  const _orig = app.graphToPrompt.bind(app);
  app.graphToPrompt = async function (...args) {
    const result = await _orig(...args);
    try {
      const out = result?.output;
      if (out) {
        let index = null;
        for (const id in out) {
          const entry = out[id];
          if (!entry || entry.class_type !== CLASS) continue;
          if (!index) index = buildIndex();
          const node = findNode(index, id);
          const stateStr = node?.properties?.[STATE_PROP] || JSON.stringify(DEFAULT_STATE);
          entry.inputs = entry.inputs || {};
          if (node?._pixLiOrigName) {
            let obj; try { obj = JSON.parse(stateStr); } catch { obj = { ...DEFAULT_STATE }; }
            obj.orig_name = node._pixLiOrigName;
            entry.inputs[HIDDEN_INPUT] = JSON.stringify(obj);
          } else {
            entry.inputs[HIDDEN_INPUT] = stateStr;
          }
          const w = node?._pixLiImageWidget;
          const live = entry.inputs.image;
          if (typeof live === "string" && /clipspace/i.test(live)) {
            if (node) node._pixLiSelectedFilename = live;
          } else {
            const cached = node?._pixLiSelectedFilename;
            if (cached && w && live !== cached) { w.value = cached; entry.inputs.image = cached; }
          }
        }
      }
    } catch (e) { console.warn("[Load Image Mini] could not inject state:", (e && e.message) || e); }
    return result;
  };
}
