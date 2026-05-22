// Crop mode methods — mixed into PixaromaEditor.prototype.
// Per-layer non-destructive rectangular crop. The full source is preserved on
// layer.sourceImg (and the untouched server src); a cropped copy is baked into
// layer.img so all existing render/handle/eraser math keeps working unchanged.
import { PixaromaEditor } from "./core.mjs";

// Forward-transform a SOURCE-space point (lx,ly) to main-canvas coords, given
// where the source center sits on canvas (srcCenter). Mirrors the render chain
// in render.mjs _drawImpl. srcCenter must be the source center, NOT layer.cx/cy
// (those coincide only before the first crop; after a crop layer.cx/cy is the
// cropped center).
function srcPointToCanvas(layer, lx, ly, sw, sh, srcCenter) {
  let x = (lx - sw / 2) * layer.scaleX;
  let y = (ly - sh / 2) * layer.scaleY;
  if (layer.flippedX) x = -x;
  if (layer.flippedY) y = -y;
  const rad = (layer.rotation * Math.PI) / 180;
  return {
    x: x * Math.cos(rad) - y * Math.sin(rad) + srcCenter.cx,
    y: x * Math.sin(rad) + y * Math.cos(rad) + srcCenter.cy,
  };
}

function srcSize(img) {
  return { w: img.width || img.naturalWidth, h: img.height || img.naturalHeight };
}

// (Re)bake layer.img from sourceImg + cropRect. Does NOT touch cx/cy — callers
// re-center first (exitCropMode / resetCrop know the source center via
// _cropFullCenter; restore keeps the saved cx/cy).
// remapMask=true → a live edit; re-map any existing in-memory eraser mask to
//                  the new cropped size. (Restore loads the mask fresh, so it
//                  passes false.)
PixaromaEditor.prototype.applyCropToLayer = function (layer, remapMask = false) {
  if (!layer.sourceImg) layer.sourceImg = layer.img;
  const cr = layer.cropRect;

  if (!cr) {
    // Back to full source. Expand any eraser mask to source size, keeping its
    // painted content at the previous crop origin (crop + erase + reset).
    if (
      remapMask &&
      layer.eraserMaskCanvas_internal &&
      layer.hasMask_internal &&
      layer.sourceImg
    ) {
      const old = layer.eraserMaskCanvas_internal;
      const prevX = layer._cropMaskOriginX || 0;
      const prevY = layer._cropMaskOriginY || 0;
      const { w: sw0, h: sh0 } = srcSize(layer.sourceImg);
      const nm = document.createElement("canvas");
      nm.width = sw0;
      nm.height = sh0;
      const nmCtx = nm.getContext("2d");
      nmCtx.drawImage(old, prevX, prevY);
      layer.eraserMaskCanvas_internal = nm;
      layer.eraserMaskCtx_internal = nmCtx;
    }
    layer.img = layer.sourceImg;
    layer._cropMaskOriginX = 0;
    layer._cropMaskOriginY = 0;
    return;
  }

  const src = layer.sourceImg;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cr.w));
  canvas.height = Math.max(1, Math.round(cr.h));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(src, cr.x, cr.y, cr.w, cr.h, 0, 0, canvas.width, canvas.height);

  // Re-map an existing in-memory eraser mask to the new cropped size. The old
  // mask is sized to the PREVIOUS layer.img, whose origin in source coords is
  // the previous crop origin (or 0,0 if previously uncropped).
  if (remapMask && layer.eraserMaskCanvas_internal && layer.hasMask_internal) {
    const oldMask = layer.eraserMaskCanvas_internal;
    const prevX = layer._cropMaskOriginX || 0;
    const prevY = layer._cropMaskOriginY || 0;
    const newMask = document.createElement("canvas");
    newMask.width = canvas.width;
    newMask.height = canvas.height;
    const nmCtx = newMask.getContext("2d");
    nmCtx.drawImage(oldMask, prevX - cr.x, prevY - cr.y);
    layer.eraserMaskCanvas_internal = newMask;
    layer.eraserMaskCtx_internal = nmCtx;
  }
  layer._cropMaskOriginX = cr.x;
  layer._cropMaskOriginY = cr.y;

  layer.img = canvas;
};

// The full source's center on canvas such that the current cropRect region
// coincides with the layer's current placement (inverse-offset of recenter).
PixaromaEditor.prototype._computeFullSourceCenter = function (layer, sw, sh) {
  const cr = layer.cropRect;
  if (!cr) return { cx: layer.cx, cy: layer.cy };
  let dx = (sw / 2 - (cr.x + cr.w / 2)) * layer.scaleX;
  let dy = (sh / 2 - (cr.y + cr.h / 2)) * layer.scaleY;
  if (layer.flippedX) dx = -dx;
  if (layer.flippedY) dy = -dy;
  const rad = (layer.rotation * Math.PI) / 180;
  return {
    cx: layer.cx + (dx * Math.cos(rad) - dy * Math.sin(rad)),
    cy: layer.cy + (dx * Math.sin(rad) + dy * Math.cos(rad)),
  };
};

PixaromaEditor.prototype.enterCropMode = function () {
  const layer = this.getActiveLayer();
  if (!layer || layer.isPlaceholder || !layer.img) {
    if (this._layout)
      this._layout.setStatus("Crop needs a single image layer selected", "warn");
    this.activeMode = null;
    return;
  }
  if (!layer.sourceImg) layer.sourceImg = layer.img;
  const { w: sw, h: sh } = srcSize(layer.sourceImg);
  if (layer.cropRect) {
    // Re-editing: start from the existing crop (already inset, grabbable).
    const cr = layer.cropRect;
    this._cropDraft = { x: cr.x, y: cr.y, w: cr.w, h: cr.h };
  } else {
    // Fresh crop: seed an inset box so the corner handles start INSIDE the
    // canvas and are easy to grab. A full-bounds box would put handles on the
    // canvas edge (half-clipped, hard to reach). Drag outward to the edges to
    // recover the full image; doing nothing + Done applies no crop.
    const mx = Math.round(sw * 0.08);
    const my = Math.round(sh * 0.08);
    this._cropDraft = { x: mx, y: my, w: sw - 2 * mx, h: sh - 2 * my };
  }
  this._cropLayer = layer;
  this._cropFullCenter = this._computeFullSourceCenter(layer, sw, sh);
  this._cropDragHandle = null;
  this._cropDraftTouched = false;
  this.draw();
};

PixaromaEditor.prototype.exitCropMode = function () {
  const layer = this._cropLayer;
  const draft = this._cropDraft;
  const touched = this._cropDraftTouched;
  const srcCenter =
    this._cropFullCenter || (layer ? { cx: layer.cx, cy: layer.cy } : null);
  this._cropLayer = null;
  this._cropDraft = null;
  this._cropFullCenter = null;
  this._cropDragHandle = null;
  this._cropDraftTouched = false;
  if (!layer || !draft) return;
  // The box was never dragged → leave the layer's crop exactly as it was
  // (so "enable crop, change mind, Done" applies nothing).
  if (!touched) {
    this.draw();
    return;
  }
  const { w: sw, h: sh } = srcSize(layer.sourceImg);
  const isFull =
    Math.round(draft.x) <= 0 &&
    Math.round(draft.y) <= 0 &&
    Math.round(draft.w) >= sw &&
    Math.round(draft.h) >= sh;
  layer.cropRect = isFull
    ? null
    : { x: draft.x, y: draft.y, w: draft.w, h: draft.h };
  // Re-center: the new image center (crop center, or source center if full)
  // mapped to its current canvas position so the kept region does not jump.
  const ccX = isFull ? sw / 2 : draft.x + draft.w / 2;
  const ccY = isFull ? sh / 2 : draft.y + draft.h / 2;
  const cc = srcPointToCanvas(layer, ccX, ccY, sw, sh, srcCenter);
  layer.cx = cc.x;
  layer.cy = cc.y;
  this.applyCropToLayer(layer, true);
  this.ui.updateActiveLayerUI();
  this.draw();
  this.pushHistory();
};

PixaromaEditor.prototype.resetCrop = function () {
  const layer = this.getActiveLayer();
  if (!layer || !layer.cropRect) return;
  const { w: sw, h: sh } = srcSize(layer.sourceImg || layer.img);
  // Where the source center currently sits on canvas (keep the view stable).
  const srcCenter = this._computeFullSourceCenter(layer, sw, sh);
  if (this.activeMode === "crop") {
    // Drop crop-mode state WITHOUT re-applying the in-progress draft.
    this._cropLayer = null;
    this._cropDraft = null;
    this._cropFullCenter = null;
    this._cropDragHandle = null;
    this.activeMode = null;
    if (this.btnCropToggle) {
      this.btnCropToggle.classList.remove("pxf-btn-accent");
      this.btnCropToggle.innerText = "Enable  [C]";
    }
    this.canvas.style.cursor = "default";
  }
  layer.cropRect = null;
  layer.cx = srcCenter.cx;
  layer.cy = srcCenter.cy;
  this.applyCropToLayer(layer, true);
  this.ui.updateActiveLayerUI();
  this.draw();
  this.pushHistory();
};

// ─── Interaction ──────────────────────────────────────────────
// Map a main-canvas point to SOURCE-image coordinates, using the full-source
// placement shown during crop mode (_cropFullCenter + source dims). This is the
// crop-mode analogue of getCoordinatesInLayerImage, which instead uses the
// CROPPED img + cx/cy and would give wrong coords when re-editing a crop.
PixaromaEditor.prototype._cropPointInSource = function (coords) {
  const layer = this._cropLayer;
  const fc = this._cropFullCenter || { cx: layer.cx, cy: layer.cy };
  const { w: sw, h: sh } = srcSize(layer.sourceImg);
  const dx = coords.x - fc.cx;
  const dy = coords.y - fc.cy;
  const rad = (-layer.rotation * Math.PI) / 180;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  const fx = rx * (layer.flippedX ? -1 : 1);
  const fy = ry * (layer.flippedY ? -1 : 1);
  return { lx: fx / layer.scaleX + sw / 2, ly: fy / layer.scaleY + sh / 2 };
};

// Returns which part of the draft the source-space point (lx,ly) hits:
// 'nw','ne','sw','se','n','s','e','w','inside', or null.
PixaromaEditor.prototype._cropHitTest = function (lx, ly) {
  const d = this._cropDraft;
  if (!d) return null;
  const tol = 10 / (this.viewZoom * Math.abs(this._cropLayer.scaleX || 1));
  const nearX = (v) => Math.abs(lx - v) <= tol;
  const nearY = (v) => Math.abs(ly - v) <= tol;
  const inX = lx >= d.x - tol && lx <= d.x + d.w + tol;
  const inY = ly >= d.y - tol && ly <= d.y + d.h + tol;
  const L = nearX(d.x) && inY;
  const R = nearX(d.x + d.w) && inY;
  const T = nearY(d.y) && inX;
  const B = nearY(d.y + d.h) && inX;
  if (T && L) return "nw";
  if (T && R) return "ne";
  if (B && L) return "sw";
  if (B && R) return "se";
  if (L) return "w";
  if (R) return "e";
  if (T) return "n";
  if (B) return "s";
  if (lx > d.x && lx < d.x + d.w && ly > d.y && ly < d.y + d.h) return "inside";
  return null;
};

PixaromaEditor.prototype.handleCropMouseDown = function (coords) {
  if (!this._cropLayer || !this._cropDraft) return;
  const p = this._cropPointInSource(coords);
  this._cropDragHandle = this._cropHitTest(p.lx, p.ly) || "inside";
  this._cropDragStart = { lx: p.lx, ly: p.ly, rect: { ...this._cropDraft } };
  this.isMouseDown = true;
};

PixaromaEditor.prototype.handleCropMouseMove = function (coords, shiftKey) {
  if (!this.isMouseDown || !this._cropDragHandle || !this._cropLayer) return;
  this._cropDraftTouched = true;
  const p = this._cropPointInSource(coords);
  const start = this._cropDragStart.rect;
  const dx = p.lx - this._cropDragStart.lx;
  const dy = p.ly - this._cropDragStart.ly;
  const { w: sw, h: sh } = srcSize(this._cropLayer.sourceImg);
  const MIN = 8;
  const hd = this._cropDragHandle;

  if (hd === "inside") {
    // Move the whole box; clamp within the source (size unchanged).
    const nx = Math.max(0, Math.min(start.x + dx, sw - start.w));
    const ny = Math.max(0, Math.min(start.y + dy, sh - start.h));
    this._cropDraft = { x: nx, y: ny, w: start.w, h: start.h };
    this.draw();
    return;
  }

  // Work in absolute edges so the NON-dragged edges stay pinned. (Deriving
  // size from a clamped position used to push the opposite edge when dragging
  // top/left past the boundary.)
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (hd.includes("w")) left = start.x + dx;
  if (hd.includes("e")) right = start.x + start.w + dx;
  if (hd.includes("n")) top = start.y + dy;
  if (hd.includes("s")) bottom = start.y + start.h + dy;

  // Shift = lock aspect (corners only): derive height from the new width,
  // moving the dragged vertical edge.
  if (
    shiftKey &&
    start.w > 0 &&
    start.h > 0 &&
    (hd === "nw" || hd === "ne" || hd === "sw" || hd === "se")
  ) {
    const ar = start.w / start.h;
    const newH = (right - left) / ar;
    if (hd.includes("n")) top = bottom - newH;
    else bottom = top + newH;
  }

  // Clamp each DRAGGED edge to the source bounds, keeping the opposite (fixed)
  // edge put and enforcing the minimum size against it.
  left = Math.max(0, Math.min(left, right - MIN));
  top = Math.max(0, Math.min(top, bottom - MIN));
  right = Math.min(sw, Math.max(right, left + MIN));
  bottom = Math.min(sh, Math.max(bottom, top + MIN));

  this._cropDraft = {
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
  };
  this.draw();
};

PixaromaEditor.prototype.handleCropMouseUp = function () {
  this.isMouseDown = false;
  this._cropDragHandle = null;
};

// ─── Overlay render ───────────────────────────────────────────
// Draw the full source (dimmed outside the draft) + the draft box + handles,
// in the layer's local frame, onto the main canvas. Called from _drawImpl
// while in crop mode (the active layer is skipped in the normal layer loop).
PixaromaEditor.prototype.drawCropOverlay = function () {
  const layer = this._cropLayer;
  const d = this._cropDraft;
  if (!layer || !d || !layer.sourceImg) return;
  const src = layer.sourceImg;
  const { w: sw, h: sh } = srcSize(src);
  const fc = this._cropFullCenter || { cx: layer.cx, cy: layer.cy };
  const ctx = this.ctx;

  ctx.save();
  ctx.translate(fc.cx, fc.cy);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.scale(layer.flippedX ? -1 : 1, layer.flippedY ? -1 : 1);
  const W = sw * layer.scaleX;
  const H = sh * layer.scaleY;

  // Full source, dimmed.
  ctx.globalAlpha = 0.4;
  ctx.drawImage(src, -W / 2, -H / 2, W, H);
  ctx.globalAlpha = 1;

  // Bright kept region.
  const kx = -W / 2 + d.x * layer.scaleX;
  const ky = -H / 2 + d.y * layer.scaleY;
  const kw = d.w * layer.scaleX;
  const kh = d.h * layer.scaleY;
  ctx.drawImage(src, d.x, d.y, d.w, d.h, kx, ky, kw, kh);

  // ── Photoshop-style overlay (all sizes in screen px via viewZoom) ──
  const z = this.viewZoom || 1;
  const px = (n) => n / z; // screen px → local units

  // Rule-of-thirds grid (faint white).
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = px(1);
  ctx.beginPath();
  for (let i = 1; i <= 2; i++) {
    const gx = kx + (kw * i) / 3;
    ctx.moveTo(gx, ky);
    ctx.lineTo(gx, ky + kh);
    const gy = ky + (kh * i) / 3;
    ctx.moveTo(kx, gy);
    ctx.lineTo(kx + kw, gy);
  }
  ctx.stroke();

  // Thin box outline (brand orange) so it still reads as a Pixaroma crop.
  ctx.strokeStyle = "#f66744";
  ctx.lineWidth = px(1.5);
  ctx.strokeRect(kx, ky, kw, kh);

  // Chunky white corner brackets + edge bars (the grab affordances).
  const bt = px(3); // bracket / bar thickness
  const bl = Math.min(px(20), kw / 3, kh / 3); // corner arm length
  const eb = Math.min(px(26), kw / 2, kh / 2); // edge bar length
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = bt;
  ctx.lineCap = "butt";

  ctx.beginPath();
  // Top-left
  ctx.moveTo(kx, ky); ctx.lineTo(kx + bl, ky);
  ctx.moveTo(kx, ky); ctx.lineTo(kx, ky + bl);
  // Top-right
  ctx.moveTo(kx + kw, ky); ctx.lineTo(kx + kw - bl, ky);
  ctx.moveTo(kx + kw, ky); ctx.lineTo(kx + kw, ky + bl);
  // Bottom-left
  ctx.moveTo(kx, ky + kh); ctx.lineTo(kx + bl, ky + kh);
  ctx.moveTo(kx, ky + kh); ctx.lineTo(kx, ky + kh - bl);
  // Bottom-right
  ctx.moveTo(kx + kw, ky + kh); ctx.lineTo(kx + kw - bl, ky + kh);
  ctx.moveTo(kx + kw, ky + kh); ctx.lineTo(kx + kw, ky + kh - bl);
  // Edge bars (centered on each side)
  ctx.moveTo(kx + kw / 2 - eb / 2, ky); ctx.lineTo(kx + kw / 2 + eb / 2, ky);
  ctx.moveTo(kx + kw / 2 - eb / 2, ky + kh); ctx.lineTo(kx + kw / 2 + eb / 2, ky + kh);
  ctx.moveTo(kx, ky + kh / 2 - eb / 2); ctx.lineTo(kx, ky + kh / 2 + eb / 2);
  ctx.moveTo(kx + kw, ky + kh / 2 - eb / 2); ctx.lineTo(kx + kw, ky + kh / 2 + eb / 2);
  ctx.stroke();

  ctx.restore();
};

// Resize-cursor for the crop handle under the cursor (Photoshop affordance).
const CROP_CURSORS = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  inside: "move",
};

PixaromaEditor.prototype.cropCursorFor = function (coords) {
  if (!this._cropLayer || !this._cropDraft) return "crosshair";
  let hd;
  if (this.isMouseDown && this._cropDragHandle) {
    hd = this._cropDragHandle;
  } else {
    const p = this._cropPointInSource(coords);
    hd = this._cropHitTest(p.lx, p.ly);
  }
  return CROP_CURSORS[hd] || "crosshair";
};
