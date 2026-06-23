import { app } from "/scripts/app.js";
import { hideJsonWidget, BRAND, installResizeFloor } from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { applyAdaptiveCanvasOnly, isVueNodes, canvasBackingScale, installZoomRepaint } from "../shared/nodes2.mjs";
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

// Nodes 2.0: render the WHOLE preview (INPUT→OUTPUT cards at top + the selected
// image fitted below + a dims line) into ONE canvas that fills the flex-grower
// root - the EXACT shape Preview Image's strip uses (single absolute canvas in a
// flex:1 root), which is the only DOM-widget layout proven to fill without
// collapsing. Backing store at dpr x graph-zoom so the preview image stays
// crisp when the user zooms IN (a plain-dpr canvas gets CSS-stretched by the
// zoom = blurry/pixelated, the same bug native ComfyUI's <img> dodges).
function _liSizeCanvas(cv, cssW, cssH) {
  const s = canvasBackingScale(cssW, cssH);
  const bw = Math.round(cssW * s), bh = Math.round(cssH * s);
  if (cv.width !== bw) cv.width = bw;
  if (cv.height !== bh) cv.height = bh;
  const ctx = cv.getContext("2d");
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return ctx;
}

function _liCurrentImage(node) {
  return (node.imgs?.[0]?.complete && node.imgs[0].naturalWidth) ? node.imgs[0]
       : (node._pixLiPreviewImgEl?.complete && node._pixLiPreviewImgEl.naturalWidth) ? node._pixLiPreviewImgEl
       : null;
}

// Draw both Nodes 2.0 canvases: the INPUT→OUTPUT cards (top, fixed band) and the
// image + dims (bottom, height = image aspect at node width). Each lives inside
// the controls panel root, so their explicit heights grow the node to fit.
function renderLoadPreviewCanvas(node) {
  // --- Cards canvas (top) ---
  const cardsCv = node._pixLiCardsCanvas;
  if (cardsCv && cardsCv.clientWidth > 0) {
    const cssW = cardsCv.clientWidth;
    const ctx = _liSizeCanvas(cardsCv, cssW, LI_CARDS_H);
    paintCardsInto(ctx, node, 10, LI_CARDS_H / 2, cssW - 20);
  }

  // --- Image canvas (bottom) ---
  // Height is controlled by flex (the canvas is `flex:1` inside the controls
  // panel), so we READ the resolved clientHeight rather than setting it - the
  // ResizeObserver re-renders when the node is dragged, so the image fills
  // whatever height the canvas is given (contained / letterboxed).
  const imgCv = node._pixLiImageCanvas;
  if (imgCv && imgCv.clientWidth > 0 && imgCv.clientHeight > 0) {
    const cssW = imgCv.clientWidth;
    const cssH = imgCv.clientHeight;
    const DIMS_H = 18;
    const imgAreaH = Math.max(20, cssH - DIMS_H);
    const ctx = _liSizeCanvas(imgCv, cssW, cssH);
    const im = _liCurrentImage(node);
    if (im) {
      const scale = Math.min((cssW - 16) / im.naturalWidth, imgAreaH / im.naturalHeight, 1);
      const w = Math.round(im.naturalWidth * scale), h = Math.round(im.naturalHeight * scale);
      ctx.drawImage(im, Math.round((cssW - w) / 2), Math.round((imgAreaH - h) / 2), w, h);
      ctx.fillStyle = "#9a9a9a";
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`${im.naturalWidth} × ${im.naturalHeight}`, cssW / 2, cssH - DIMS_H / 2);
    }
  }
}

// Nodes 2.0: refresh our own preview (native .image-preview is hidden because it
// goes stale on programmatic picks). Ensures an Image is loaded (node.imgs[0]
// when present, else fetch the /view URL for restore), grows the node, repaints.
function updateLoadPreview(node) {
  if (!isVueNodes()) return;
  const im = node.imgs?.[0];
  if (!(im?.complete && im.naturalWidth)) {
    // node.imgs not ready (e.g. workflow restore) - load the selected file into
    // our own Image so the canvas + cards have real dims to draw/measure.
    const fn = node._pixLiImageWidget?.value;
    if (fn) {
      const { subfolder, filename } = splitFilenameSubfolder(fn);
      const src = `/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=${encodeURIComponent(subfolder)}&t=${Date.now()}`;
      let el = node._pixLiPreviewImgEl;
      if (!el) { el = new Image(); node._pixLiPreviewImgEl = el; }
      el.onload = () => { renderLoadPreviewCanvas(node); node.setDirtyCanvas?.(true, true); };
      if (el.src !== src) el.src = src;
    }
  }
  renderLoadPreviewCanvas(node);
  // The preview canvas lives inside the controls panel; setting its height grows
  // the panel's content, which grows the node (same mechanism that sizes the
  // controls). Nudge a repaint.
  node.setDirtyCanvas?.(true, true);
}

// The size readout is painted by onDrawForeground (legacy) / the DOM cards
// canvas (Nodes 2.0). Toggle the upload hint by image presence, refresh the
// Nodes 2.0 cards, then request a canvas repaint for the legacy cards.
function updateInfoBar(node) {
  const hint = node._pixLiRoot?.querySelector('[data-role="hint"]');
  if (hint) {
    // Hide the "or drag here" hint when an image is loaded OR a file is selected.
    // A selected filename is known synchronously (after configure), whereas
    // node.imgs[0] loads ASYNC on a rebuild and is briefly unavailable on a
    // collapse-expand — so checking only the loaded image made the hint flash
    // visible for a fraction of a second on every expand / workflow-switch (the
    // panel measured ~47px taller with the hint, then settled when it loaded).
    // The filename is stable across both, so the hint never flashes.
    const hasImageOrFile = !!(
      node.imgs?.[0]?.naturalWidth ||
      node._pixLiImageWidget?.value ||
      node._pixLiSelectedFilename
    );
    hint.style.display = hasImageOrFile ? "none" : "";
  }
  if (isVueNodes()) renderLoadPreviewCanvas(node);
  node.setDirtyCanvas?.(true, true);
}

function renderUI(node) {
  // Operate on the inner flex layer (chips / panel / globals / canvases all live
  // there); root holds only `inner`. querySelector still works (it searches
  // descendants), and every append/insert below targets inner. See setup.
  const root = node._pixLiInner || node._pixLiRoot;
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

  // Nodes 2.0: keep the cards canvas FIRST (above the controls) and the image
  // canvas LAST (renderUI re-appends chips/panel/globals each render).
  if (node._pixLiCardsCanvas && root.firstChild !== node._pixLiCardsCanvas) {
    root.insertBefore(node._pixLiCardsCanvas, root.firstChild);
  }
  if (node._pixLiImageCanvas) root.appendChild(node._pixLiImageCanvas);

  // Refresh dims info bar (input + output dims).
  updateInfoBar(node);

  // NOTE: node-height fitting is NOT done here. renderUI runs on the load path
  // (configure / initial microtask) too, and resizing there dirties the saved
  // workflow (Vue Compat #18). Height fitting happens only on genuine user
  // actions via fitPreview() (mode-chip click + fresh drop), gated on
  // !isGraphLoading().
  node.graph?.setDirtyCanvas?.(true, true);
}

// Legacy node-height fitting. STABLE preview area (issue #1): the node must NOT
// resize itself to the loaded image's aspect ratio (that ballooned the node for
// tall / wide images and overlapped neighbouring nodes). Instead we PRESERVE the
// current preview area, so loading a different-shaped image leaves the node
// height where it is - the native bottom preview just contains the new image
// inside the existing area, exactly like native Load Image. Only a CONTROLS
// height change (a mode switch) shifts the node, and the user can still drag the
// node taller to enlarge the preview (the new size is then preserved). Gated on
// !isGraphLoading so it never resizes during a workflow load (Vue Compat #18/#19).
const LI_LEGACY_PREVIEW_MIN = 120;     // below this there is no real preview area yet -> use the default
const LI_LEGACY_PREVIEW_DEFAULT = 260; // comfortable preview area for a fresh / too-short node
function fitPreview(node) {
  // Legacy only: in Nodes 2.0 the preview is a flex-grower canvas child of the
  // controls panel (it fills the node body), so sizing is handled by the panel there.
  if (isVueNodes()) return;
  if (isGraphLoading()) return;
  requestAnimationFrame(() => {
    if (!node._pixLiRoot || isGraphLoading()) return;
    const SLOT_H = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_SLOT_HEIGHT) || 20;
    const aboveControls = (node.outputs?.length || 7) * SLOT_H + 6; // slot area above the controls
    const controlsH = node._pixLiMeasureHeight?.() || 280;
    // Keep whatever preview area the node already has (so image swaps don't
    // resize it, and a manual drag-taller sticks); fall back to a default only
    // when there is no sensible area yet (fresh / collapsed node).
    const curPreviewH = (node.size?.[1] || 0) - aboveControls - controlsH;
    const previewH = curPreviewH >= LI_LEGACY_PREVIEW_MIN ? curPreviewH : LI_LEGACY_PREVIEW_DEFAULT;
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
// instead (createLoadImagePreviewCanvas). Scoped to our node via :has(.pix-li-root)
// so it's a no-op for every other node and in the legacy renderer.
function injectLoadImageNodes2CSS() {
  if (document.getElementById("pix-li-nodes2-css")) return;
  const s = document.createElement("style");
  s.id = "pix-li-nodes2-css";
  s.textContent =
    // Hide ComfyUI's native input image-preview for this node (we draw our own).
    ".lg-node:has(.pix-li-root) .image-preview{display:none !important;}" +
    // CRITICAL (issue #1 Nodes 2.0 fill): the Vue node ALSO renders a native
    // image-preview CONTAINER (a `flex:1` box) right after the widget grid on
    // image_upload nodes. It is a SECOND `flex:1` child of the node content, so
    // it SPLITS the free vertical height with our widget area (also `flex:1`),
    // leaving a large empty gap below our preview when the node is dragged tall.
    // Collapse that container so our widget area is the SOLE grower and fills the
    // node, like native Load Image. It is the only `flex:1` div immediately after
    // the widget grid; we render our own preview, so hiding it loses nothing.
    ".lg-node:has(.pix-li-root) .lg-node-widgets + div.flex-1{display:none !important;}";
  document.head.appendChild(s);
}

// Cards strip height for the Nodes 2.0 preview.
const LI_CARDS_H = 124;
// Nodes 2.0 preview-canvas FLOOR (issue #1). The preview canvas is a flex
// grower inside the controls panel (the node's sole grower widget), so it fills
// any extra node height: drag the node taller and the preview grows instead of
// leaving an empty gap, exactly like native Load Image; at the smallest node
// size it sits at this floor. It never grows the node on its OWN (loading a
// different-shaped image keeps the node put), and the image is contained (fit +
// letterboxed) inside whatever height the canvas ends up at. Value = image area
// (~240) + the dims label row (18). A constant floor is dirty-proof on reload
// (Vue Compat #18). Tune for a bigger / smaller minimum preview.
const LI_PREVIEW_FILL_MIN = 258;
// Smaller preview allowance for the MANUAL-RESIZE floor only, so a Nodes 2.0 node can
// be dragged compact. The old floor counted the full 258 preview, so the node's min was
// ~full-size and it could never shrink ("goes full size"). The default/natural size
// still uses LI_PREVIEW_FILL_MIN, so a fresh node opens with the big preview; this only
// lowers how SMALL the user can drag it. (overflow:hidden on .pix-li-inner clips the
// preview when the node is smaller than the full content, so nothing spills.)
const LI_PREVIEW_FLOOR_MIN = 72;


// Nodes 2.0 preview: a second DOM widget's host collapses to 0 on this node (the
// 7 outputs / hidden image-upload widgets break the second widget's grid row,
// even with Preview Image's exact strip shape). So we render into TWO <canvas>
// children of the CONTROLS panel root (which renders fine and drives node height
// via measureContentHeight). To match Legacy: the INPUT→OUTPUT CARDS canvas goes
// at the TOP (prepended, above the Upload button), the IMAGE canvas at the
// BOTTOM. Both have explicit heights so the panel grows to include them.
function createLoadImagePreviewCanvas(node) {
  // Append the canvases into the inner flex layer (the cards canvas first, the
  // image canvas last), not the root — root holds only `inner` (see setup).
  const root = node._pixLiInner || node._pixLiRoot;
  if (!root) return;

  // Cards canvas — at the TOP of the node body (like Legacy's top-right cards).
  const cardsCv = document.createElement("canvas");
  cardsCv.className = "pix-li-cards-canvas";
  cardsCv.style.cssText = `display:block;width:100%;height:${LI_CARDS_H}px;box-sizing:border-box;`;
  root.insertBefore(cardsCv, root.firstChild);
  node._pixLiCardsCanvas = cardsCv;

  // Image canvas — at the BOTTOM. flex:1 so it FILLS the controls panel's free
  // vertical space (the panel is the node's grower widget): dragging the node
  // taller grows the preview instead of leaving an empty gap, like native Load
  // Image. min-height is the floor.
  const imgCv = document.createElement("canvas");
  imgCv.className = "pix-li-preview-canvas";
  imgCv.style.cssText = `display:block;width:100%;box-sizing:border-box;flex:1 1 0;min-height:${LI_PREVIEW_FILL_MIN}px;`;
  root.appendChild(imgCv);
  node._pixLiImageCanvas = imgCv;

  // Width changes (node resize) → repaint at the new width (onResize unreliable
  // for DOM widgets, Compat #13).
  const ro = new ResizeObserver(() => renderLoadPreviewCanvas(node));
  ro.observe(imgCv);
  node._pixLiPreviewRO = ro;

  // The ResizeObserver doesn't fire on graph zoom (clientWidth is unchanged), so
  // re-render when the zoom (= backing scale) changes to keep the image crisp.
  installZoomRepaint(
    node,
    () => [imgCv.clientWidth || 0, imgCv.clientHeight || 0],
    () => renderLoadPreviewCanvas(node),
    "_pixLiZoomRaf",
  );

  requestAnimationFrame(() => updateLoadPreview(node));
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

  // Inner flex layer (same fix as the video nodes). ComfyUI's DOM-widget manager
  // forces the widget ROOT to inline display:block on rebuild / collapse-expand
  // (verified via a live measurement: the root's computed display became "block",
  // media_h 0 while media_grow 1). A flex column ON the root would therefore die
  // there — the 7px row gaps collapse and the flex:1 image canvas drops to its
  // min height, then visibly grows back when restored (the flicker). So the flex
  // column lives on an inner layer (position:absolute; inset:0, .pix-li-inner)
  // that ComfyUI never touches → the layout is ALWAYS flex, no transition, no
  // flicker. The root keeps its background/border and is content-measured via
  // inner.children (measureContentHeight). buildRoot's children are moved into
  // inner; all later appends (renderUI + the preview canvases) target inner too.
  const inner = document.createElement("div");
  inner.className = "pix-li-inner";
  while (root.firstChild) inner.appendChild(root.firstChild);
  root.appendChild(inner);
  node._pixLiInner = inner;

  // Intrinsic content-height measurement. We DO NOT use root.scrollHeight
  // or root.offsetHeight here: LiteGraph stretches root vertically when the
  // node is taller than minimum, and reading the stretched value creates a
  // feedback loop (every paint reports the new larger height → node grows
  // → next paint reports even larger → user can never shrink, and a
  // duplicated node inherits the inflated minimum). Instead, sum each
  // child's natural offsetHeight (which is intrinsic to the child, NOT
  // influenced by root's stretched size) plus flex gaps and root padding.
  // Sum the controls' heights + the preview canvas counted at `previewMin` (NOT its
  // grown size, or the grown canvas would re-inflate the min and the node could never
  // shrink). measureContentHeight uses the FULL preview min (the natural/default size);
  // measureFloorHeight uses a SMALLER one (the manual-resize floor) so the node can be
  // dragged compact. Children live on the inner flex layer, so measure inner.children.
  function measureH(previewMin) {
    let totalH = 0;
    let visible = 0;
    for (const child of inner.children) {
      const style = window.getComputedStyle(child);
      if (style.position === "absolute" || style.position === "fixed") continue;
      if (style.display === "none") continue;
      if (child === node._pixLiImageCanvas) { totalH += previewMin; visible += 1; continue; }
      totalH += child.offsetHeight;
      visible += 1;
    }
    const padding = 10; // root padding: 2px top + 8px bottom
    const gaps = Math.max(0, visible - 1) * 7; // flex `gap: 7px` between children
    // Before the DOM widget is attached to the document, every child's offsetHeight
    // is 0 (queueMicrotask renders before LiteGraph's first paint), so return a sane
    // placeholder in that pre-layout case ONLY. Once laid out, hug the real content.
    if (totalH < 20) return 280;
    return totalH + padding + gaps;
  }
  const measureContentHeight = () => measureH(LI_PREVIEW_FILL_MIN);
  const measureFloorHeight = () => measureH(LI_PREVIEW_FLOOR_MIN);
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

  // The controls now live on an absolute inner layer (.pix-li-inner), so the
  // node's height no longer tracks its content. In Nodes 2.0 the manual-resize
  // floor is a live "collapse to 0" measurement (NOT computeLayoutSize.minHeight),
  // which reads the absolute layer as ~0 and would let the user drag the node
  // BELOW its content → the image spills out the bottom of the frame. Pin a real
  // floor (= the content height) only while a resize handle is dragged. No-op in
  // legacy (it has no .lg-node resize handle) and outside a drag.
  node._pixLiFloorOff = installResizeFloor(root, measureFloorHeight);

  // Nodes 2.0 preview rebuild: the controls panel becomes a FIXED (min-content)
  // row so it's not a grower, then add the fill preview widget (sole grower) and
  // hide the stale native preview. (Legacy is untouched: the panel keeps its
  // getMinHeight/getMaxHeight and the native bottom preview fills.) The renderer
  // is fixed per page load, so this branch runs once per node instance.
  if (isVueNodes()) {
    // Make the controls panel the node's GROWER (auto row). Its min is the
    // content floor (controls + the preview floor); any extra node height (user
    // drags the node taller) is absorbed here, and the image canvas inside
    // (flex:1) fills that slack so the preview grows instead of leaving an empty
    // gap, like native Load Image. minWidth:1 so the saved node width round-trips
    // (Compare gotcha 2). It is the node's only visible widget, so it is safely
    // the sole grower.
    widget.computeLayoutSize = () => ({ minHeight: measureContentHeight(), minWidth: 1 });
    createLoadImagePreviewCanvas(node);
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
  // pending fit, which now keeps a STABLE preview area instead of resizing to
  // the loaded image's aspect (issue #1; onImageReady consumes _pixLiFitPending).
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
  // a workflow restore — re-fit the node to a STABLE preview area (it no longer
  // resizes to the image's aspect, issue #1). _pixLiFitPending guards against
  // firing on restore (the saved height is trusted then; Vue Compat #18).
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
    // Nodes 2.0: the node frame does NOT auto-grow to the controls panel, so a fresh
    // node opens too short and clips the body (console: node H 219 vs content 631).
    // Size it to the content once, AFTER layout (so the measure is real). Fresh drops
    // ONLY - a saved workflow keeps its size (Vue Compat #18: never resize on load).
    if (isVueNodes() && !wasConfigured) {
      requestAnimationFrame(() => {
        if (isGraphLoading()) return;
        const h = node._pixLiMeasureHeight?.();
        if (h && typeof node.setSize === "function") node.setSize([node.size[0], h]);
      });
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
      try { cancelAnimationFrame(this._pixLiZoomRaf); } catch {}
      this._pixLiZoomRaf = null;
      try { this._pixLiFloorOff?.(); } catch {}
      this._pixLiFloorOff = null;
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
