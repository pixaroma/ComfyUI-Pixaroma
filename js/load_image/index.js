import { app } from "/scripts/app.js";
import { hideJsonWidget, BRAND } from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/nodes2.mjs";
import {
  injectCSS, buildRoot, hideNativeImageCombo, openImageDropdown,
  renderChips, renderGlobalControls,
} from "./ui.mjs";
import { pickAndUploadFile, pasteFromClipboard, uploadImageToInput, setSelectedImage, updateNativePreview, splitFilenameSubfolder } from "./api.mjs";
import { buildModePanel, previewResize } from "./resize_modes.mjs";
import { applyInlineLabel, applyWHLayout, applyCoverControls } from "./panel_polish.mjs";

let _activeLoadImageNode = null;

function refreshDropdown(node) {
  const root = node._pixLiRoot;
  if (!root) return;
  const w = node._pixLiImageWidget;
  const ddName = root.querySelector('[data-role="dropdown"] .name');
  const counter = root.querySelector('[data-role="counter"]');
  const value = w?.value || "";
  if (ddName) ddName.textContent = value ? value : "— no image —";
  // Counter "3 / 247" tells the user where they are when arrow-stepping.
  // Hidden when no images are uploaded yet.
  if (counter) {
    const values = w?.options?.values || [];
    if (value && values.length > 1) {
      const idx = values.indexOf(value);
      counter.textContent = idx >= 0 ? `${idx + 1} / ${values.length}` : "";
    } else {
      counter.textContent = "";
    }
  }
  // Disable arrow buttons when there's nothing to step through.
  const values = w?.options?.values || [];
  const prev = root.querySelector('[data-role="prev"]');
  const next = root.querySelector('[data-role="next"]');
  const disabled = values.length < 2;
  if (prev) prev.classList.toggle("disabled", disabled);
  if (next) next.classList.toggle("disabled", disabled);
}

// Step the selected image by `offset` (+1 or -1), wrapping at the ends.
// Used by the arrow buttons and PageUp/PageDown shortcuts.
function pickByOffset(node, offset) {
  const w = node._pixLiImageWidget;
  if (!w) return;
  const values = w.options?.values || [];
  if (values.length === 0) return;
  const cur = values.indexOf(w.value);
  // If nothing currently selected, "next" → first, "prev" → last.
  let next;
  if (cur < 0) next = offset > 0 ? 0 : values.length - 1;
  else next = ((cur + offset) % values.length + values.length) % values.length;
  node._pixLiFitPending = true; // user pick → re-fit preview to the new image's aspect
  setSelectedImage(node, values[next]);
}

const MIN_W = 360; // node needs room for the two IN/OUT cards

// Load Image loads from disk and takes NO inputs. The Vue frontend's
// "widget-is-a-socket" model (1.43+) auto-creates connectable input slots for
// the hidden `image` / `upload` combo widgets, leaving a dangling dot you can
// wire any COMBO/* output into (it re-converts the combo widget to an input on
// drop). We never want that. Remove every input slot. Returns true if it
// removed anything. See Load Image Pixaroma Pattern #17.
function stripInputs(node) {
  if (!node?.inputs || node.inputs.length === 0) return false;
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    if (node.inputs[i]?.link != null) { try { node.disconnectInput(i); } catch (_e) { /* ignore */ } }
    node.removeInput(i);
  }
  node.setDirtyCanvas?.(true, true);
  return true;
}

function gcdLi(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = b; b = a % b; a = t; } return a || 1; }
function ratioLabelLi(w, h) {
  const g = gcdLi(w, h); const rw = w / g, rh = h / g;
  const known = ["1:1","16:9","9:16","2:1","1:2","3:2","2:3","4:3","3:4","4:5","5:4","21:9"];
  const s = `${rw}:${rh}`;
  if (known.includes(s)) return s;
  const r = w / h;
  return r >= 1 ? `~${r.toFixed(2)}:1` : `~1:${(1 / r).toFixed(2)}`;
}
function aspectRectDimsLi(w, h, maxW, maxH) {
  const a = w / h; let rw, rh;
  if (a >= maxW / maxH) { rw = maxW; rh = maxW / a; } else { rh = maxH; rw = maxH * a; }
  return { rw: Math.max(2, Math.round(rw)), rh: Math.max(2, Math.round(rh)) };
}
function roundRectPathLi(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// What the painter should show: dual cards (image loaded) or a message.
function getCardInfo(node) {
  const img = node.imgs?.[0];
  const W = img?.naturalWidth || 0;
  const H = img?.naturalHeight || 0;
  if (!W || !H) return { mode: "msg", text: "Upload or pick an image" };
  const state = readState(node);
  const { w: outW, h: outH } = previewResize(W, H, state);
  return { mode: "dual", inW: W, inH: H, outW, outH };
}

// Paint the INPUT → OUTPUT size cards (or the "upload" message) into `ctx`
// within the rect [leftPad .. leftPad+pairW] vertically centered on `midY`.
// Shared by BOTH the legacy onDrawForeground (painting in the node's left dead
// space) AND the Nodes 2.0 DOM cards canvas (where node-body painting is
// skipped). All coordinates are in the ctx's own CSS-pixel space.
function paintCardsInto(ctx, node, leftPad, midY, pairW) {
  const info = getCardInfo(node);
  const fam = "ui-sans-serif, system-ui, sans-serif";
  ctx.save();
  ctx.textBaseline = "middle";

  if (info.mode === "msg") {
    ctx.font = `12px ${fam}`;
    const tw = ctx.measureText(info.text).width;
    const bw = tw + 24, bh = 26;
    const bx = leftPad, by = midY - bh / 2;
    roundRectPathLi(ctx, bx, by, bw, bh, 8);
    ctx.fillStyle = "#1d1d1d"; ctx.fill();
    ctx.textAlign = "left"; ctx.fillStyle = BRAND;
    ctx.fillText(info.text, bx + 12, midY);
    ctx.restore();
    return;
  }

  const NECK_INSET = 3, COL_GAP = 6;
  const cardW = (pairW - COL_GAP) / 2 - NECK_INSET / 2;
  const cardH = 118;
  const L1 = leftPad;                 // INPUT left
  const R1 = L1 + cardW;               // INPUT right
  const R2 = leftPad + pairW;          // OUTPUT right
  const L2 = R2 - cardW;               // OUTPUT left
  const arrowCx = (R1 + L2) / 2;
  const cardY = midY - cardH / 2, T = cardY, Bm = cardY + cardH;
  const R = 6, bridgeH = 22, bT = midY - bridgeH / 2, bB = midY + bridgeH / 2;
  const rectMaxW = 54, rectMaxH = 40;

  // Single joined outline (two rounded cards + center bridge).
  ctx.beginPath();
  ctx.moveTo(L1 + R, T);
  ctx.lineTo(R1 - R, T); ctx.arcTo(R1, T, R1, T + R, R);
  ctx.lineTo(R1, bT); ctx.lineTo(L2, bT); ctx.lineTo(L2, T + R);
  ctx.arcTo(L2, T, L2 + R, T, R);
  ctx.lineTo(R2 - R, T); ctx.arcTo(R2, T, R2, T + R, R);
  ctx.lineTo(R2, Bm - R); ctx.arcTo(R2, Bm, R2 - R, Bm, R);
  ctx.lineTo(L2 + R, Bm); ctx.arcTo(L2, Bm, L2, Bm - R, R);
  ctx.lineTo(L2, bB); ctx.lineTo(R1, bB); ctx.lineTo(R1, Bm - R);
  ctx.arcTo(R1, Bm, R1 - R, Bm, R);
  ctx.lineTo(L1 + R, Bm); ctx.arcTo(L1, Bm, L1, Bm - R, R);
  ctx.lineTo(L1, T + R); ctx.arcTo(L1, T, L1 + R, T, R);
  ctx.closePath();
  ctx.fillStyle = "#1d1d1d"; ctx.fill();
  ctx.strokeStyle = "#444"; ctx.lineWidth = 1; ctx.stroke();

  const drawContent = (x, label, w, h, accent) => {
    const ccx = x + cardW / 2;
    ctx.textAlign = "center";
    const maxTxt = cardW - 8;
    ctx.font = `9px ${fam}`; ctx.fillStyle = "#9a9a9a";
    ctx.fillText(label, ccx, cardY + 18, maxTxt);
    ctx.font = `bold 11px ${fam}`; ctx.fillStyle = BRAND;
    ctx.fillText(`${w}×${h}`, ccx, cardY + 36, maxTxt);
    const { rw, rh } = aspectRectDimsLi(w, h, rectMaxW, rectMaxH);
    const rx = Math.round(ccx - rw / 2) + 0.5, ry = Math.round(cardY + 72 - rh / 2) + 0.5;
    if (accent) { ctx.fillStyle = "rgba(246,103,68,0.20)"; ctx.fillRect(rx, ry, rw, rh); }
    ctx.strokeStyle = accent ? BRAND : "rgba(200,200,200,0.7)"; ctx.lineWidth = 1;
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.font = `8px ${fam}`; ctx.fillStyle = "#9a9a9a";
    ctx.fillText(ratioLabelLi(w, h), ccx, cardY + 104, maxTxt);
  };

  const changed = info.inW !== info.outW || info.inH !== info.outH;
  drawContent(L1, "INPUT", info.inW, info.inH, false);
  drawContent(L2, "OUTPUT", info.outW, info.outH, changed);

  ctx.strokeStyle = "#9a9a9a"; ctx.lineWidth = 1;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(arrowCx - 2.5, midY - 4);
  ctx.lineTo(arrowCx + 2.5, midY);
  ctx.lineTo(arrowCx - 2.5, midY + 4);
  ctx.stroke();
  ctx.restore();
}

// Nodes 2.0: render the INPUT→OUTPUT cards into the DOM cards canvas (the
// legacy node-body painting is skipped by the Vue renderer). DPR-aware.
function renderLoadCards(node) {
  const cv = node._pixLiCardsCanvas;
  if (!cv) return;
  const cssW = cv.clientWidth, cssH = cv.clientHeight;
  if (cssW <= 0 || cssH <= 0) return;
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
  if (cv.width !== bw) cv.width = bw;
  if (cv.height !== bh) cv.height = bh;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const pad = 10;
  paintCardsInto(ctx, node, pad, cssH / 2, cssW - 2 * pad);
}

// Nodes 2.0: refresh our own image preview (the native .image-preview is hidden
// because it goes stale on programmatic picks) + the cards. Reuses the already-
// loaded node.imgs[0] (no second fetch).
function updateLoadPreview(node) {
  if (!isVueNodes()) return;
  const img = node._pixLiPreviewImg;
  const im = node.imgs?.[0];
  // Prefer the already-loaded node.imgs[0] (no second fetch); otherwise build the
  // /view URL straight from the selected filename. The latter covers workflow
  // restore in Nodes 2.0, where the native image path may feed its own internal
  // state without populating node.imgs.
  let src = im?.src;
  if (!src) {
    const fn = node._pixLiImageWidget?.value;
    if (fn) {
      const { subfolder, filename } = splitFilenameSubfolder(fn);
      src = `/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=${encodeURIComponent(subfolder)}&t=${Date.now()}`;
    }
  }
  if (img) {
    if (src) { img.src = src; img.style.display = ""; }
    else { img.removeAttribute("src"); img.style.display = "none"; }
  }
  // Size the image area to the image's aspect at the node width (content-sizing;
  // see liPreviewImgH). Setting the DOM height reflows the min-content row so the
  // node grows/shrinks to fit.
  const wrap = node._pixLiPreviewImgWrap;
  if (wrap) wrap.style.height = liPreviewImgH(node) + "px";
  const dims = node._pixLiPreviewDims;
  if (dims) dims.textContent = im?.naturalWidth ? `${im.naturalWidth} × ${im.naturalHeight}` : "";
  renderLoadCards(node);
  node.setDirtyCanvas?.(true, true);
}

// The size readout is painted by onDrawForeground (legacy) / the DOM cards
// canvas (Nodes 2.0). Toggle the upload hint by image presence, refresh the
// Nodes 2.0 cards, then request a canvas repaint for the legacy cards.
function updateInfoBar(node) {
  const hint = node._pixLiRoot?.querySelector('[data-role="hint"]');
  if (hint) hint.style.display = node.imgs?.[0]?.naturalWidth ? "none" : "";
  if (isVueNodes()) renderLoadCards(node);
  node.setDirtyCanvas?.(true, true);
}

function renderUI(node) {
  const root = node._pixLiRoot;
  if (!root) return;
  // No `isConnected` check: queueMicrotask fires BEFORE LiteGraph's first
  // canvas paint, so the DOM widget root isn't attached to the document yet.
  // We still want to append chips to root (in memory). When LiteGraph paints
  // the node, root + chips will be visible. Same pattern as Resolution
  // Pixaroma's deferred initial render.
  const state = readState(node);

  // We keep the upload button + hint + dropdown stable across renders.
  // Re-render only the dynamic parts: chip grid and the per-mode panel.

  let chipsEl = root.querySelector(".pix-li-chips");
  const newChips = renderChips(state);
  if (chipsEl) chipsEl.replaceWith(newChips);
  else root.appendChild(newChips);

  // Remove the previous panel (if any) and append the new one for the
  // current mode. onChange is the non-destructive "update info bar"
  // call — leaf events (input commit / quick-pick / color pick) need
  // the info bar to refresh but MUST NOT destroy the panel itself, or
  // Arrow / Tab break (the focused input would disappear).
  const oldPanel = root.querySelector(".pix-li-panel");
  if (oldPanel) oldPanel.remove();
  // Match Image Resize's panel options so the quick-pick rows render one-line
  // (oneLine), Match ratio is crop-only (Pad is its own mode), and the Fit/Crop
  // + Pad previews use the same sizes + live input dims.
  const live = node.imgs?.[0]?.naturalWidth
    ? { w: node.imgs[0].naturalWidth, h: node.imgs[0].naturalHeight }
    : null;
  const panel = buildModePanel(state.mode, node, state, writeState, () => updateInfoBar(node),
    "loadImagePixState",
    { previewMaxW: 134, previewMaxH: 96, cropOnly: true, inputDims: live, oneLine: true });
  if (panel) {
    applyInlineLabel(panel, state.mode);
    if (state.mode === "fit_inside" || state.mode === "cover") applyWHLayout(panel);
    if (state.mode === "cover") {
      applyCoverControls(node, panel, readState, writeState, () => updateInfoBar(node));
    }
    // No redundant title row — the highlighted button names the mode.
    panel.querySelector(".pix-li-panel-label")?.remove();
    // Insert AFTER the chip grid.
    const chips = root.querySelector(".pix-li-chips");
    chips.after(panel);
  }

  // Remove old global controls (if any) and re-render. onChange here is
  // the lightweight "non-destructive update" — used by snap chips,
  // resample dropdown, allow-upscale toggle. They don't change panel
  // structure but DO change the output dimensions, so the info bar
  // needs to refresh.
  const oldGlobal = root.querySelector(".pix-li-global");
  if (oldGlobal) oldGlobal.remove();
  const globals = renderGlobalControls(node, state, writeState, () => updateInfoBar(node));
  root.appendChild(globals);

  // Refresh dims info bar (input + output dims).
  updateInfoBar(node);

  // NOTE: node-height fitting is NOT done here. renderUI runs on the load path
  // (configure / initial microtask) too, and resizing there dirties the saved
  // workflow (Vue Compat #18). Height fitting happens only on genuine user
  // actions via fitPreview() (mode-chip click + fresh drop), gated on
  // !isGraphLoading().
  node.graph?.setDirtyCanvas?.(true, true);
}

// Auto-fit the node height so the native image preview hugs the controls with
// a small, consistent gap in every mode (the "Hug the controls" choice). The
// native preview reserves a FIXED minimum (~220px), so a square/landscape image
// floats inside it. Instead we size the node so the preview area matches the
// image's ASPECT (previewTop + width x aspect), so the picture fills the area
// in every shape — square, portrait, landscape. Deterministic (same image +
// mode + node width => same height) so a reload recomputes the saved height and
// never dirties (Vue Compat #18). Layout (measured): slot area above the
// controls widget = outputs * NODE_SLOT_HEIGHT + 6; controls height =
// measureContentHeight; preview area = the rest. Deferred to rAF so the
// freshly-rendered panel has laid out before measuring; gated on
// !isGraphLoading so it never resizes during a workflow load (Vue Compat #19).
function fitPreview(node) {
  // Legacy only: resizes node.size to hug the native bottom preview. In Nodes
  // 2.0 our preview widget flex-fills, so this would fight the Vue layout.
  if (isVueNodes()) return;
  if (isGraphLoading()) return;
  requestAnimationFrame(() => {
    if (!node._pixLiRoot || isGraphLoading()) return;
    const SLOT_H = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_SLOT_HEIGHT) || 20;
    const aboveControls = (node.outputs?.length || 7) * SLOT_H + 6; // slot area above the controls
    const controlsH = node._pixLiMeasureHeight?.() || 280;
    const img = node.imgs?.[0];
    let previewH;
    if (img?.naturalWidth) {
      const innerW = Math.max(40, (node.size[0] || 360) - 16); // preview spans node width minus side margin
      previewH = Math.round(innerW * img.naturalHeight / img.naturalWidth) + 22; // + dims label row
      previewH = Math.max(90, Math.min(previewH, 1400));
    } else {
      previewH = 180; // no image yet — modest default
    }
    const target = aboveControls + controlsH + previewH;
    if (Math.abs((node.size?.[1] || 0) - target) > 1) {
      node.size[1] = target;
      node.setDirtyCanvas?.(true, true);
    }
  });
}

// Global Ctrl+V handler for the active load-image node.
window.addEventListener("keydown", async (e) => {
  if (!_activeLoadImageNode) return;
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "v") return;
  const tag = (e.target?.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.target?.isContentEditable) return;
  e.preventDefault();
  e.stopPropagation();
  try {
    _activeLoadImageNode._pixLiFitPending = true;
    const saved = await pasteFromClipboard(_activeLoadImageNode);
    if (saved) refreshDropdown(_activeLoadImageNode);
  } catch (err) {
    console.error("[PixaromaLoadImage] paste failed", err);
    alert("Paste failed: " + err.message);
  }
}, true);

// Global PageUp / PageDown for the active load-image node - matches native
// ComfyUI LoadImage's arrow-key stepping convention.
window.addEventListener("keydown", (e) => {
  if (!_activeLoadImageNode) return;
  if (e.key !== "PageUp" && e.key !== "PageDown") return;
  const tag = (e.target?.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (e.target?.isContentEditable) return;
  e.preventDefault();
  e.stopPropagation();
  pickByOffset(_activeLoadImageNode, e.key === "PageUp" ? -1 : +1);
}, true);

// State pattern mirrors Resolution Pixaroma (CLAUDE.md Vue Compat #9):
// hidden Python input + node.properties + app.graphToPrompt injection.
const STATE_PROP = "loadImagePixState";
const HIDDEN_INPUT_NAME = "LoadImagePixState";

export const DEFAULT_STATE = {
  version: 1,
  mode: "off",
  max_mp: 1.0,
  longest_side: 1024,
  scale_factor: 1.0,
  fit_w: 1024, fit_h: 1024,
  cover_w: 1024, cover_h: 1024,
  ratio_preset: "1:1",
  ratio_w: 1, ratio_h: 1,
  ratio_action: "crop",
  pad_color: "#808080",
  pad_top: 0, pad_bottom: 0, pad_left: 0, pad_right: 0,
  crop_anchor: "center", crop_scale: true,
  snap: 0,
  resample: "auto",
  allow_upscale: true,
};

export function readState(node) {
  const v = node.properties?.[STATE_PROP];
  if (typeof v === "string" && v) {
    try { return { ...DEFAULT_STATE, ...JSON.parse(v) }; }
    catch { /* fall through */ }
  }
  return { ...DEFAULT_STATE };
}

export function writeState(node, state) {
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = JSON.stringify(state);
}

// Nodes 2.0: hide ComfyUI's native output-image preview for this node. It's fed
// by ComfyUI's internal node-output state (NOT node.imgs), goes stale on our
// programmatic picks, and bottom-aligns with a gap. We render our own preview
// instead (createLoadImagePreviewWidget). Scoped to our node via :has(.pix-li-root)
// so it's a no-op for every other node and in the legacy renderer.
function injectLoadImageNodes2CSS() {
  if (document.getElementById("pix-li-nodes2-css")) return;
  const s = document.createElement("style");
  s.id = "pix-li-nodes2-css";
  s.textContent = ".lg-node:has(.pix-li-root) .image-preview{display:none !important;}";
  document.head.appendChild(s);
}

// Cards strip height + image-area clamp constants for the Nodes 2.0 preview.
const LI_CARDS_H = 132;
const LI_PREVIEW_MIN_IMG_H = 90;
const LI_PREVIEW_MAX_IMG_H = 1200;

// Compute the image-area height for the Nodes 2.0 preview: fit the selected
// image to the node's content width at its OWN aspect (so the picture fills the
// width with no letterbox), clamped. Deterministic (same image + node width =>
// same height) so a reload recomputes the same value and never dirties (Vue
// Compat #18). Falls back to a square assumption before the image dims arrive.
function liPreviewImgH(node) {
  const cw = Math.max(80, (node.size?.[0] || 400) - 24);
  const im = node.imgs?.[0];
  const aspect = im?.naturalWidth ? im.naturalHeight / im.naturalWidth : 1;
  return Math.max(LI_PREVIEW_MIN_IMG_H, Math.min(Math.round(cw * aspect), LI_PREVIEW_MAX_IMG_H));
}

// Nodes 2.0 preview widget: a content-sized (min-content row) DOM widget holding
// the INPUT→OUTPUT cards (fixed canvas) + our own <img> (height = image aspect
// at node width) + a dims label. We do NOT flex-fill here: a flex:1 root
// collapsed to 0 inside ComfyUI's nested WidgetDOM flex host (verified via the
// liDbg console probe). Content-sizing (like the controls panel, which renders
// fine) is robust and matches the legacy aspect-fit. Only created in Nodes 2.0.
function createLoadImagePreviewWidget(node) {
  const root = document.createElement("div");
  root.className = "pix-li-preview-root";
  root.style.cssText =
    "position:relative;width:100%;display:flex;flex-direction:column;gap:4px;box-sizing:border-box;";

  const cardsCv = document.createElement("canvas");
  cardsCv.className = "pix-li-cards";
  cardsCv.style.cssText = `display:block;width:100%;height:${LI_CARDS_H}px;`;
  root.appendChild(cardsCv);

  const imgWrap = document.createElement("div");
  imgWrap.style.cssText = "position:relative;width:100%;height:200px;"; // height set in updateLoadPreview
  const img = document.createElement("img");
  img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none;";
  imgWrap.appendChild(img);
  root.appendChild(imgWrap);

  const dims = document.createElement("div");
  dims.className = "pix-li-preview-dims";
  dims.style.cssText = "text-align:center;color:#9a9a9a;font:11px sans-serif;padding:0 0 2px;";
  root.appendChild(dims);

  // Deterministic content height = cards + image area + dims + gaps. Drives the
  // node height (min-content row). Same formula as the imgWrap height set in
  // updateLoadPreview, so they stay in lockstep.
  const measureH = () => LI_CARDS_H + liPreviewImgH(node) + 18 + 8;

  const widget = node.addDOMWidget("pixaroma_load_image_preview", "custom", root, {
    getMinHeight: measureH,
    serialize: false,
  });
  // CRITICAL: addDOMWidget assigns a DEFAULT computeLayoutSize (a grower, since
  // we pass no getMaxHeight) which collapses to 0 here. Set it to undefined so
  // this is a fixed min-content row that renders by its DOM content height -
  // EXACTLY what makes the controls panel render correctly. (Removing my custom
  // computeLayoutSize wasn't enough; the default one has to be cleared too.)
  applyAdaptiveCanvasOnly(widget);
  widget.computeLayoutSize = undefined;

  node._pixLiPreviewImg = img;
  node._pixLiPreviewImgWrap = imgWrap;
  node._pixLiPreviewDims = dims;
  node._pixLiCardsCanvas = cardsCv;

  // The cards canvas width tracks the node width, so its ResizeObserver is the
  // signal for "node width changed" → re-render cards AND re-fit the image area
  // height to the new width (onResize is unreliable for DOM widgets, Compat #13).
  const ro = new ResizeObserver(() => {
    renderLoadCards(node);
    if (node._pixLiPreviewImgWrap) node._pixLiPreviewImgWrap.style.height = liPreviewImgH(node) + "px";
  });
  ro.observe(cardsCv);
  node._pixLiPreviewRO = ro;

  // Initial paint once laid out.
  requestAnimationFrame(() => { renderLoadCards(node); updateLoadPreview(node); });
  return widget;
}

function setupLoadImageNode(node) {
  injectCSS();
  hideJsonWidget(node.widgets, HIDDEN_INPUT_NAME);

  // Hide the native `image` combo — our custom dropdown replaces it visually
  // but reads/writes through its `.value`.
  const imageWidget = hideNativeImageCombo(node);
  node._pixLiImageWidget = imageWidget;

  // Remove the auto-created widget-input slots (image / upload) so the node
  // shows no connectable input dot (Load Image Pixaroma Pattern #17).
  stripInputs(node);

  // Brand default colors applied globally by js/brand/index.js.

  const root = buildRoot();
  node._pixLiRoot = root;

  // Intrinsic content-height measurement. We DO NOT use root.scrollHeight
  // or root.offsetHeight here: LiteGraph stretches root vertically when the
  // node is taller than minimum, and reading the stretched value creates a
  // feedback loop (every paint reports the new larger height → node grows
  // → next paint reports even larger → user can never shrink, and a
  // duplicated node inherits the inflated minimum). Instead, sum each
  // child's natural offsetHeight (which is intrinsic to the child, NOT
  // influenced by root's stretched size) plus flex gaps and root padding.
  function measureContentHeight() {
    let totalH = 0;
    let visible = 0;
    for (const child of root.children) {
      const style = window.getComputedStyle(child);
      if (style.position === "absolute" || style.position === "fixed") continue;
      if (style.display === "none") continue;
      totalH += child.offsetHeight;
      visible += 1;
    }
    const padding = 10; // root padding: 2px top + 8px bottom
    const gaps = Math.max(0, visible - 1) * 7; // flex `gap: 7px` between children
    // Before the DOM widget is attached to the document, every child's
    // offsetHeight is 0 (queueMicrotask renders before LiteGraph's first paint),
    // so return a sane placeholder in that pre-layout case ONLY. Once laid out,
    // hug the REAL content height with no floor. A 280px floor made short modes
    // (e.g. "Off", which has no settings panel ≈ 220px of content) pad the
    // controls widget taller than its content, leaving dead space between the
    // "Upscaling" button and the image preview — that was the Off-mode gap.
    if (totalH < 20) return 280;
    return totalH + padding + gaps;
  }
  node._pixLiMeasureHeight = measureContentHeight;

  const widget = node.addDOMWidget("pixaroma_load_image_ui", "custom", root, {
    // canvasOnly made adaptive below (applyAdaptiveCanvasOnly): true in legacy
    // (hide from Parameters tab, Vue Compat #15), false in Nodes 2.0 (else the
    // whole panel is excluded from the Vue body → empty node).
    getValue: () => null,
    setValue: () => {},
    getMinHeight: measureContentHeight,
    // Cap height at content size so extra vertical space (when the user
    // resizes the node taller) flows to ComfyUI's IMAGE_PREVIEW widget
    // instead of stretching this controls panel. Without getMaxHeight,
    // the layout engine treats both widgets as stretchable and gives our
    // panel the slack, leaving the image preview at its 220px minimum
    // anchored at the bottom with an awkward gap above. Verified against
    // the frontend bundle: DOMWidget.computeLayoutSize reads getMaxHeight
    // and the IMAGE_PREVIEW widget has no maxHeight so it absorbs slack.
    getMaxHeight: measureContentHeight,
    margin: 0,
    serialize: false,
  });
  applyAdaptiveCanvasOnly(widget);
  node._pixLiWidget = widget;

  // Nodes 2.0 preview rebuild: the controls panel becomes a FIXED (min-content)
  // row so it's not a grower, then add the fill preview widget (sole grower) and
  // hide the stale native preview. (Legacy is untouched: the panel keeps its
  // getMinHeight/getMaxHeight and the native bottom preview fills.) The renderer
  // is fixed per page load, so this branch runs once per node instance.
  if (isVueNodes()) {
    widget.computeLayoutSize = undefined; // min-content row (CSS grid), not a flex grower
    createLoadImagePreviewWidget(node);
    injectLoadImageNodes2CSS();
  }

  // Default node width for fresh-on-canvas placements. Wider than the
  // LiteGraph default so the [Input → Output] info bar and the 3-column
  // chip grid fit comfortably side-by-side. LiteGraph's configure runs
  // AFTER nodeCreated and overwrites with the saved value, so existing
  // workflows keep whatever width the user had.
  if (!node.size || node.size[0] < MIN_W) node.size[0] = MIN_W;

  // Track the currently-focused load-image node for Ctrl+V routing.
  // (One global listener; nodes register/unregister themselves on selection.)
  node._pixLiOnSelected = () => { _activeLoadImageNode = node; };
  node._pixLiOnDeselected = () => {
    if (_activeLoadImageNode === node) _activeLoadImageNode = null;
  };

  // Called by api.mjs updateNativePreview() once a freshly-loaded image has
  // its naturalWidth/naturalHeight available (arrow / dropdown / upload / paste
  // picks all route through here). Refreshes the dims readout AND runs the
  // pending auto-fit so the preview re-sizes to the NEW image's aspect — this
  // is the path that was missing the fit, so a portrait picked after a square
  // stayed squeezed (onImageReady consumes _pixLiFitPending).
  node._pixLiOnImageLoaded = () => onImageReady();

  // Refresh info bar once node.imgs[0] is loaded — covers both the
  // workflow-restore path (image_upload hook fetches the saved image
  // AFTER nodeCreated runs, so node.imgs starts empty and arrives
  // asynchronously) and the native-drop path (ComfyUI's bottom preview
  // area drop also fetches asynchronously). Reuses node._pixLiImgPoll
  // so a new call cancels any in-flight poll, and the existing onRemoved
  // cleanup picks up the same handle.
  // When the image is ready, refresh the readout and — only if a fit was
  // requested by a user action (fresh drop / pick / upload / paste / drop), not
  // a workflow restore — auto-fit the node so the preview hugs the controls at
  // the image's aspect. _pixLiFitPending guards against firing on restore (the
  // saved height is trusted then; Vue Compat #18).
  function onImageReady() {
    updateInfoBar(node);
    // Nodes 2.0: refresh our own DOM image preview (native one is hidden/stale).
    updateLoadPreview(node);
    if (node._pixLiFitPending) {
      node._pixLiFitPending = false;
      // fitPreview resizes node.size to hug the native bottom preview - a legacy
      // concept. In Nodes 2.0 our preview widget flex-fills, so node-height
      // fitting would fight the Vue layout (and re-introduce growth). Skip it.
      if (!isVueNodes()) fitPreview(node);
    }
  }
  function refreshAfterImageReady() {
    if (node._pixLiImgPoll) {
      clearInterval(node._pixLiImgPoll);
      node._pixLiImgPoll = null;
    }
    if (node.imgs?.[0]?.naturalWidth) {
      onImageReady();
      return;
    }
    let ticks = 0;
    const poll = setInterval(() => {
      if (node.imgs?.[0]?.naturalWidth) {
        clearInterval(poll);
        node._pixLiImgPoll = null;
        onImageReady();
      } else if (++ticks > 30) {
        clearInterval(poll);
        node._pixLiImgPoll = null;
      }
    }, 100);
    node._pixLiImgPoll = poll;
  }
  refreshAfterImageReady();

  // Wrap imageWidget.callback so we get notified when ComfyUI's native
  // drag-drop on the bottom preview area sets the value. ComfyUI's
  // image_upload setter does its own fetch but doesn't go through our
  // updateNativePreview path, so without this hook the dims info bar
  // would show stale dimensions from the previous image after a native
  // drop. Also refreshes the file dropdown's displayed name so the user
  // sees the new filename in our custom dropdown. Wraps any existing
  // callback (post-decoration) so other extensions still work. Also
  // updates the defensive `_pixLiSelectedFilename` cache so an external
  // pick (native drag-drop) is treated the same as one of ours.
  if (imageWidget) {
    const origCallback = imageWidget.callback;
    imageWidget.callback = function () {
      const ret = origCallback?.apply(this, arguments);
      if (imageWidget.value) {
        node._pixLiSelectedFilename = imageWidget.value;
        // Track the original (non-clipspace) name so the Filename output stays
        // the original even after a Mask Editor / clipspace swap (issue #51).
        if (!/clipspace/i.test(imageWidget.value)) node._pixLiOrigName = imageWidget.value;
      }
      // Native drag-drop onto the bottom preview is a user pick → re-fit. Gated
      // so it never fires during a workflow load (Vue Compat #18).
      if (!isGraphLoading()) node._pixLiFitPending = true;
      refreshAfterImageReady();
      refreshDropdown(node);
      return ret;
    };
    // Seed the cache from whatever value the widget has at setup time
    // (covers saved-workflow restore, where configure() landed before us).
    if (imageWidget.value) {
      node._pixLiSelectedFilename = imageWidget.value;
      if (!/clipspace/i.test(imageWidget.value)) node._pixLiOrigName = imageWidget.value;
    }
  }

  // Catch EXTERNAL writes to the image widget value that bypass our callback.
  // ComfyUI core sets imageWidget.value DIRECTLY (no callback) in two paths:
  // the Mask Editor, and "Copy/Paste (Clipspace)" - pasteFromClipspace's first
  // block assigns widget.value with no callback, especially when pasting an
  // OUTPUT image copied from another node (its name e.g. "img_0001_.png
  // [output]" has no "clipspace" substring). Without catching these, the
  // `_pixLiSelectedFilename` cache stays stale and the graphToPrompt override
  // (issue #38) reverts the widget to the old file -> wrong image loaded
  // (issue #50 / clipspace report). A value setter keeps the cache in lockstep
  // with ANY write EXCEPT writes during a graph load, which are Vue's
  // config-replay (issue #38) and must NOT update the cache so the override
  // can still restore the user's session pick. Chains any existing descriptor;
  // no-op if the property is locked non-configurable.
  if (imageWidget) {
    try {
      const initialVal = imageWidget.value;
      const desc = Object.getOwnPropertyDescriptor(imageWidget, "value");
      if (!desc || desc.configurable) {
        const origGet = desc && desc.get;
        const origSet = desc && desc.set;
        let stored = initialVal;
        Object.defineProperty(imageWidget, "value", {
          configurable: true,
          enumerable: desc ? desc.enumerable !== false : true,
          get() { return origGet ? origGet.call(this) : stored; },
          set(v) {
            if (origSet) origSet.call(this, v); else stored = v;
            if (v && !isGraphLoading()) {
              node._pixLiSelectedFilename = v;
              // A clipspace copy (Mask Editor / Copy-Paste Clipspace) is NOT a
              // real filename — keep the last real pick so the Filename output
              // stays the original (issue #51).
              if (!/clipspace/i.test(v)) node._pixLiOrigName = v;
            }
          },
        });
      }
    } catch (e) {
      console.warn("[PixaromaLoadImage] could not intercept image value", e);
    }
  }

  // Wire upload button.
  const btn = root.querySelector(".pix-li-upload-btn");
  btn?.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const saved = await pickAndUploadFile(node);
      if (saved) { node._pixLiFitPending = true; refreshDropdown(node); }
    } catch (err) {
      console.error("[PixaromaLoadImage] upload failed", err);
      alert("Upload failed: " + err.message);
    }
  });

  // Silent drop fallback on the DOM widget root. ComfyUI's native
  // image_upload extension wires a node-level drop handler that covers
  // the bottom preview area, but it's not guaranteed to reach over our
  // DOM widget — so we keep this minimal pair (dragover for preventDefault
  // so the drop event fires, then drop to upload) as a safety net. No
  // visual overlay: the orange "Drop to upload" panel was misleading
  // because it implied this was the only drop target when the whole
  // node accepts drops via the native handler. Drop anywhere on the
  // node now feels uniform.
  root.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
  });
  root.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      node._pixLiFitPending = true;
      await uploadImageToInput(node, file);
      refreshDropdown(node);
    } catch (err) {
      console.error("[PixaromaLoadImage] drop upload failed", err);
      alert("Upload failed: " + err.message);
    }
  });

  // Custom dropdown click → popup.
  const dd = root.querySelector('[data-role="dropdown"]');
  dd?.addEventListener("click", (e) => {
    e.stopPropagation();
    openImageDropdown(node, dd, () => { node._pixLiFitPending = true; refreshDropdown(node); });
  });

  // Prev / Next arrow buttons - flip through the image list visually,
  // matching native ComfyUI LoadImage behaviour the user is comparing
  // against. Wraps around at both ends. setSelectedImage updates the
  // bottom preview automatically so the user sees each image as they step.
  const prevBtn = root.querySelector('[data-role="prev"]');
  const nextBtn = root.querySelector('[data-role="next"]');
  prevBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (prevBtn.classList.contains("disabled")) return;
    pickByOffset(node, -1);
  });
  nextBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (nextBtn.classList.contains("disabled")) return;
    pickByOffset(node, +1);
  });

  // Filename-change hook used by setSelectedImage (api.mjs). Centralised
  // here so all pick paths (dropdown / arrows / upload / paste / drop)
  // funnel into one update.
  node._pixLiOnFilenameChanged = () => refreshDropdown(node);

  // Initial dropdown sync (defer so the native combo's `value` is restored).
  queueMicrotask(() => refreshDropdown(node));

  // Chip click → update state + re-render.
  root.addEventListener("click", (e) => {
    const chip = e.target.closest(".pix-li-chip");
    if (!chip) return;
    e.stopPropagation();
    const mode = chip.dataset.modeId;
    if (!mode) return;
    const cur = readState(node);
    if (cur.mode === mode) return;
    writeState(node, { ...cur, mode });
    renderUI(node);
    fitPreview(node); // re-snug the preview under the new (taller/shorter) panel
  });

  // Initial render — defer so configure() has time to land state. Fit the
  // height ONLY on a fresh drop (no saved state yet); a loaded workflow keeps
  // its saved size (Vue Compat #18 — never resize on the load path).
  queueMicrotask(() => {
    const wasConfigured = node.properties?.[STATE_PROP] !== undefined;
    renderUI(node);
    // Fresh drop: fit once the default image loads (the image-ready path reads
    // this flag). A restored workflow keeps its saved size (Vue Compat #18).
    if (!wasConfigured) node._pixLiFitPending = true;
    // Nodes 2.0: explicitly fetch the selected image into node.imgs so our DOM
    // preview + the cards' INPUT dims populate on restore (the native image path
    // may feed internal state without setting node.imgs there).
    if (isVueNodes() && node._pixLiImageWidget?.value && !node.imgs?.[0]?.naturalWidth) {
      updateNativePreview(node, node._pixLiImageWidget.value);
    }
  });
}

app.registerExtension({
  name: "Pixaroma.LoadImage",

  settings: [
    {
      id: "Pixaroma.LoadImage.ThumbSize",
      name: "Dropdown thumbnail size",
      type: "combo",
      defaultValue: "Large",
      options: ["Small", "Large"],
      tooltip: "Thumbnail size shown in the Load Image Pixaroma file dropdown.",
      category: ["👑 Pixaroma", "Load Image"],
    },
  ],

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaLoadImage") return;

    // Reject ALL input connections — the node has no inputs we want, and the
    // hidden image/upload combo widgets must not be drivable from outside
    // (Load Image Pixaroma Pattern #17).
    nodeType.prototype.onConnectInput = function () { return false; };

    // Belt-and-braces: if a connection still slips in via the frontend's
    // "connect to widget input" path, strip every input slot. Gated on
    // !isGraphLoading so it never mutates serialized state during a workflow
    // load (Vue Compat #19) — load-time cleanup is handled by onConfigure.
    const _origConn = nodeType.prototype.onConnectionsChange;
    const INPUT_T = (typeof LiteGraph !== "undefined" && LiteGraph.INPUT != null) ? LiteGraph.INPUT : 1;
    nodeType.prototype.onConnectionsChange = function (type) {
      const r = _origConn?.apply(this, arguments);
      if (type === INPUT_T && !isGraphLoading()) stripInputs(this);
      return r;
    };

    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      return _origResize?.apply(this, arguments);
    };

    // Paint INPUT → OUTPUT size cards in the empty space left of the 7 output
    // dots (same technique as Image Resize). Read-only re: serialized state
    // except the min-width self-heal (Vue Compat #18); setDirtyCanvas is only a
    // redraw flag, not a dirty-tracker trip.
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const r = _origDraw?.apply(this, arguments);
      if (this.flags?.collapsed) return r;
      if (this.size[0] < MIN_W) { this.size[0] = MIN_W; this.setDirtyCanvas(true, true); }
      // Nodes 2.0 skips node-body painting AND renders the cards in the DOM
      // preview widget instead, so don't paint here.
      if (isVueNodes()) return r;
      // Legacy: paint the cards in the LEFT dead space (vertical center of the
      // 7 output slot rows = 74). pairW stops clear of the longest output label
      // ("original_height") via the 120px reserve.
      const pairW = Math.max(120, this.size[0] - 12 - 120);
      paintCardsInto(ctx, this, 12, 74, pairW);
      return r;
    };

    const _origSel = nodeType.prototype.onSelected;
    const _origDes = nodeType.prototype.onDeselected;
    nodeType.prototype.onSelected = function () {
      this._pixLiOnSelected?.();
      return _origSel?.apply(this, arguments);
    };
    nodeType.prototype.onDeselected = function () {
      this._pixLiOnDeselected?.();
      return _origDes?.apply(this, arguments);
    };
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure?.apply(this, arguments);
      // Drop any saved widget-input slots on load (Pattern #17). Synchronous so
      // it lands before the change-tracker snapshots the loaded graph.
      stripInputs(this);
      // Wait a microtask so widget values are settled.
      queueMicrotask(() => {
        refreshDropdown(this);
        // Refresh the defensive cache from the restored widget.value.
        // Saved workflows should also benefit from the cache - it prevents
        // any later Vue tab-switch / configure replay from drifting the
        // value mid-session.
        const w = this._pixLiImageWidget;
        if (w?.value) {
          this._pixLiSelectedFilename = w.value;
          if (!/clipspace/i.test(w.value)) this._pixLiOrigName = w.value;
        }
      });
      // Refresh info bar after a short delay so the image (set async by
      // ComfyUI's image_upload hook on workflow restore) has a chance to
      // populate node.imgs[0]. The poll inside setupLoadImageNode covers
      // initial creation; this catches re-configure on workflow switch.
      setTimeout(() => updateInfoBar(this), 600);
      return r;
    };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      // Close any open dropdown popup so its document-level capture listeners
      // are detached — otherwise deleting the node (or reload / Ctrl+Z, which
      // fires onRemoved per node) leaves a floating popup + leaked listeners
      // (mirrors Prompt Reader Pixaroma Pattern #4).
      document.querySelector(".pix-li-popup")?._pixClose?.();
      if (this._pixLiImgPoll) clearInterval(this._pixLiImgPoll);
      this._pixLiImgPoll = null;
      try { this._pixLiPreviewRO?.disconnect(); } catch {}
      this._pixLiPreviewRO = null;
      if (_activeLoadImageNode === this) _activeLoadImageNode = null;
      return _origRemoved?.apply(this, arguments);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaLoadImage") return;
    setupLoadImageNode(node);
  },
});

// ── app.graphToPrompt hook (subgraph-safe) ──────────────────────────────
// Same walk-and-inject pattern as Resolution Pixaroma's index.js. Required
// because LoadImagePixState is `hidden` (no widget) so the workflow JSON
// doesn't carry it; we inject from node.properties at submission time.

function buildPixaromaNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === "PixaromaLoadImage" || n.type === "PixaromaLoadImage") {
        index.set(String(n.id), n);
      }
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findPixaromaNode(index, promptId) {
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (tail && index.has(tail)) return index.get(tail);
  return null;
}

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  const out = result?.output;
  if (out) {
    let index = null;
    for (const id in out) {
      const entry = out[id];
      if (!entry || entry.class_type !== "PixaromaLoadImage") continue;
      if (!index) index = buildPixaromaNodeIndex();
      const node = findPixaromaNode(index, id);
      const stateStr = node?.properties?.[STATE_PROP] || JSON.stringify(DEFAULT_STATE);
      entry.inputs = entry.inputs || {};
      // Augment the injected state with the original (non-clipspace) filename so
      // the Python FILENAME output stays the original even when the Mask Editor /
      // clipspace swap loads a clipspace copy (issue #51). Submission-time only —
      // node.properties is never touched, so saved workflows aren't dirtied and
      // orig_name is not persisted.
      if (node?._pixLiOrigName) {
        let stateObj;
        try { stateObj = JSON.parse(stateStr); } catch { stateObj = { ...DEFAULT_STATE }; }
        stateObj.orig_name = node._pixLiOrigName;
        entry.inputs[HIDDEN_INPUT_NAME] = JSON.stringify(stateObj);
      } else {
        entry.inputs[HIDDEN_INPUT_NAME] = stateStr;
      }
      const w = node?._pixLiImageWidget;
      const live = entry.inputs.image;
      // Mask Editor / "Copy (Clipspace)" / "Paste (Clipspace)" write the
      // edited image (with the painted mask baked into its alpha channel) to
      // input/clipspace/ and point the image widget there. That's a fresh,
      // legitimate pick the user just made — ADOPT it into the cache and never
      // override it. Without this, issue #50: the cache still holds the
      // pre-edit filename, the sync below reverts the widget to it, the
      // backend loads the maskless original, and the MASK output comes back
      // blank. Detected by the canonical "clipspace" location ComfyUI uses.
      if (typeof live === "string" && /clipspace/i.test(live)) {
        node._pixLiSelectedFilename = live;
      } else {
        // Defensive image filename sync (issue #38 hardening). If a Vue
        // configure replay or autosave snapshot drifted widget.value back
        // to a previously-saved filename, our cache `_pixLiSelectedFilename`
        // holds whatever the user last picked in this session. Use it for
        // both the widget AND the submitted entry so the workflow sees
        // what the user actually chose. No-op when the cache matches
        // (the normal case) or when the user hasn't picked anything yet.
        const cached = node?._pixLiSelectedFilename;
        if (cached && w && live !== cached) {
          w.value = cached;
          entry.inputs.image = cached;
        }
      }
    }
  }
  return result;
};
