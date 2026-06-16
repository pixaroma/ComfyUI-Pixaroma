// ============================================================
// Inpaint Crop Pixaroma — canvas render + region preview + save
// ============================================================
import { InpaintCropEditor, BRAND, InpaintAPI } from "./core.mjs";
import { computeRegion, maskBBoxFromImageData, growBBox, seamAlphaFromAlpha } from "./geometry.mjs";

const proto = InpaintCropEditor.prototype;

// ── image load ──────────────────────────────────────────────────────────────
proto._loadImageFromURL = function (url, onDone) {
  const token = (this._loadToken = (this._loadToken || 0) + 1);   // newest load wins
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    if (token !== this._loadToken) return;   // a newer open/load superseded this one
    this.img = img;
    this.imgW = img.naturalWidth;
    this.imgH = img.naturalHeight;
    this._ensureMaskCanvas();
    this._fitCanvas();
    this._rescanBBox();
    this._recomputeRegion();
    this._draw();
    this._setStatus(`Loaded: ${this.imgW}×${this.imgH}`);
    onDone?.();
  };
  img.onerror = () => this._setStatus("Failed to load the source image.");
  img.src = url;
};

proto._loadImageFromDataURL = function (dataURL) {
  const token = (this._loadToken = (this._loadToken || 0) + 1);   // newest load wins
  const img = new Image();
  img.onload = () => {
    if (token !== this._loadToken) return;   // a newer open/load superseded this one
    this.img = img;
    this.imgW = img.naturalWidth;
    this.imgH = img.naturalHeight;
    this._pendingSrcDataURL = dataURL;
    this._maskPath = "";
    this._mask = null;
    this._ensureMaskCanvas();
    this._fitCanvas();
    this._rescanBBox();
    this._recomputeRegion();
    this._draw();
    this._setStatus(`Loaded: ${this.imgW}×${this.imgH}`);
  };
  img.src = dataURL;
};

// ── fit + draw ────────────────────────────────────────────────────────────
proto._fitCanvas = function () {
  if (!this.img) return;
  const ws = this.el.workspace, pad = 40;
  const maxW = ws.clientWidth - pad * 2, maxH = ws.clientHeight - pad * 2;
  if (maxW <= 0 || maxH <= 0) return;
  const asp = this.imgW / this.imgH;
  let dw, dh;
  if (maxW / maxH > asp) { dh = maxH; dw = dh * asp; } else { dw = maxW; dh = dw / asp; }
  this._baseScale = dw / this.imgW;
  this._zoom = 1; this._panX = 0; this._panY = 0;   // (re)fit resets the view
  this._scale = this._baseScale;
  this._dispW = Math.round(dw); this._dispH = Math.round(dh);
  // backing store at devicePixelRatio so the painting canvas stays crisp on
  // high-DPI screens; all drawing is in logical px (the ctx is scaled by dpr).
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  for (const c of [this.el.canvas, this.el.cursor]) {
    c.width = Math.round(this._dispW * dpr); c.height = Math.round(this._dispH * dpr);
    c.style.width = this._dispW + "px"; c.style.height = this._dispH + "px";
  }
  this.el.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  this.el.curCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  this.el.canvas.style.cursor = "none";
};

// keep the image covering the viewport (no empty gaps); at zoom 1 this forces pan 0
proto._clampPan = function () {
  const iw = this.imgW * this._scale, ih = this.imgH * this._scale;
  const minX = Math.min(0, this._dispW - iw), minY = Math.min(0, this._dispH - ih);
  this._panX = Math.min(0, Math.max(minX, this._panX));
  this._panY = Math.min(0, Math.max(minY, this._panY));
};

// zoom by `factor` keeping the source point under (ancX,ancY display px) fixed
proto._applyZoom = function (factor, ancX, ancY) {
  const nz = Math.max(1, Math.min(8, this._zoom * factor));
  if (nz === this._zoom) return;
  const sx = (ancX - this._panX) / this._scale;   // source point under the cursor
  const sy = (ancY - this._panY) / this._scale;
  this._zoom = nz;
  this._scale = this._baseScale * nz;
  this._panX = ancX - sx * this._scale;
  this._panY = ancY - sy * this._scale;
  this._clampPan();
  this._draw();
  if (this._lastCursorPos) this._drawCursor(this._lastCursorPos);
};

// Feathered seam alpha at display resolution: the outward signed-distance smoothstep
// of the mask over (blend * scale) px - the canvas mirror of the Python _blur_alpha
// SCIPY path, so the editor preview MATCHES the stitched seam (preview == result).
// Computed on a downscaled buffer (the seam is soft, so a chamfer DT + upscale is
// invisible) to stay fast on every _draw - brush strokes + softness drags. _draw is
// NOT called on idle mouse-move (the cursor draws separately), so no cache is needed.
proto._seamAlphaCanvas = function () {
  const dpr = Math.max(1, window.devicePixelRatio || 1);   // DPR-backed for HiDPI crispness
  const W = Math.round(this._dispW * dpr), H = Math.round(this._dispH * dpr);
  if (!this._seamCv) this._seamCv = document.createElement("canvas");
  const c = this._seamCv;
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const ctx = c.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const src = this._effectiveMaskCanvas();
  if (!src) return c;

  // WHOLE CROP mode: the stitch feathers the whole crop RECTANGLE (Python
  // _feather_alpha) - an inward linear ramp from the region edges - NOT the mask
  // edge. Show that instead of the mask feather so the preview matches the result.
  if (this.params.blend_mode === "whole_crop" && this._region) {
    // _baseScale (NOT _scale): the seam canvas is fit-res then drawn at the zoomed
    // view rect, which applies the zoom - using _scale would double-count it.
    const blendD = Math.max(0, (this.params.blend ?? 16) * (this._baseScale || 1) * dpr);
    const CAP = 480;
    const sc = Math.min(1, CAP / Math.max(W, H));
    const bw = Math.max(1, Math.round(W * sc)), bh = Math.max(1, Math.round(H * sc));
    const r = this._region;
    const rx = r.rx / this.imgW * bw, ry = r.ry / this.imgH * bh;
    const rw = Math.max(1, r.rw / this.imgW * bw), rh = Math.max(1, r.rh / this.imgH * bh);
    const kBuf = blendD * (bw / W);
    const kEff = Math.min(kBuf, Math.max(0.5, Math.min(rw, rh) / 2 - 0.5));  // keep interior opaque
    const b = this._seamBuf || (this._seamBuf = document.createElement("canvas"));
    if (b.width !== bw || b.height !== bh) { b.width = bw; b.height = bh; }
    const bctx = b.getContext("2d");
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    const id = bctx.createImageData(bw, bh);
    const d = id.data;
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        let a = 0;
        if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) {
          const dist = Math.min(x - rx, rx + rw - 1 - x, y - ry, ry + rh - 1 - y);
          a = kEff <= 0 ? 1 : Math.max(0, Math.min(1, dist / kEff));
        }
        const p = (y * bw + x) * 4;
        d[p] = 255; d[p + 1] = 255; d[p + 2] = 255; d[p + 3] = Math.round(a * 255);
      }
    }
    bctx.putImageData(id, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(b, 0, 0, bw, bh, 0, 0, W, H);
    return c;
  }

  // _baseScale (NOT _scale): fit-res seam canvas, zoom applied later at the view draw.
  const blendDisp = Math.max(0, (this.params.blend ?? 16) * (this._baseScale || 1) * dpr);
  if (blendDisp < 0.5) { ctx.drawImage(src, 0, 0, W, H); return c; }   // crisp seam

  // draw the mask into a small buffer, distance-transform its alpha, write the
  // feathered alpha back, then upscale to the display-res seam canvas.
  const CAP = 480;
  const sc = Math.min(1, CAP / Math.max(W, H));
  const bw = Math.max(1, Math.round(W * sc)), bh = Math.max(1, Math.round(H * sc));
  const kBuf = blendDisp * (bw / W);          // feather width in buffer px
  const b = this._seamBuf || (this._seamBuf = document.createElement("canvas"));
  if (b.width !== bw || b.height !== bh) { b.width = bw; b.height = bh; }
  const bctx = b.getContext("2d");
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.clearRect(0, 0, bw, bh);
  bctx.drawImage(src, 0, 0, bw, bh);
  const id = bctx.getImageData(0, 0, bw, bh);
  const alpha = seamAlphaFromAlpha(id.data, bw, bh, kBuf);
  const dpx = id.data;
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    dpx[p] = 255; dpx[p + 1] = 255; dpx[p + 2] = 255;
    dpx[p + 3] = Math.round(alpha[i] * 255);
  }
  bctx.putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(b, 0, 0, bw, bh, 0, 0, W, H);   // upscale the soft alpha
  return c;
};

// Coalesce high-frequency redraws (brush strokes) to one per animation frame, so
// fast mouse-moves on a big image don't pile up synchronous full redraws (the lag).
proto._requestRedraw = function () {
  if (this._drawRaf) return;
  this._drawRaf = requestAnimationFrame(() => { this._drawRaf = null; this._draw(); });
};

proto._draw = function () {
  if (!this.img || !this._dispW) return;  // _fitCanvas sets _dispW before any draw
  const ctx = this.el.ctx, s = this._scale;
  const W = this._dispW, H = this._dispH;
  ctx.clearRect(0, 0, W, H);
  // pan/zoom: the image is drawn at (_panX,_panY) scaled by _scale (= base*zoom);
  // at fit (zoom 1) this is (0,0,W,H). Everything below offsets by the same pan.
  ctx.drawImage(this.img, this._panX, this._panY, this.imgW * s, this.imgH * s);

  // seam preview: tint the FEATHERED seam alpha (Softness) in the chosen color,
  // clipped to the crop region. DPR-backed (crisp on HiDPI). Mirrors the Python
  // _blur_alpha SCIPY smoothstep, so the tint matches the stitched seam.
  if (this.maskVisible && this._mask) {
    if (!this._tint) this._tint = document.createElement("canvas");
    const t = this._tint;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const tw = Math.round(W * dpr), th = Math.round(H * dpr);
    if (t.width !== tw || t.height !== th) { t.width = tw; t.height = th; }
    const tc = t.getContext("2d");
    tc.setTransform(1, 0, 0, 1, 0, 0);
    tc.clearRect(0, 0, tw, th);
    // While a stroke is active, skip the distance-transform seam preview (a
    // getImageData readback + per-pixel pass = the big-image lag) and tint the mask
    // directly; the feathered seam preview is computed on stroke end. Big speedup.
    const alphaSrc = this._painting ? this._effectiveMaskCanvas() : this._seamAlphaCanvas();
    // draw the mask at the same pan/zoom rect as the image (backing px) so it aligns
    tc.drawImage(alphaSrc, this._panX * dpr, this._panY * dpr, this.imgW * s * dpr, this.imgH * s * dpr);
    tc.globalCompositeOperation = "source-in";
    tc.fillStyle = this.previewColor || "#f6303a";
    tc.fillRect(0, 0, tw, th);
    tc.globalCompositeOperation = "source-over";
    ctx.save();
    // Clip the seam tint to the crop box - BUT NOT while actively painting: the crop
    // box only grows on stroke end, so clipping mid-stroke hides any mask you paint
    // beyond the current box ("interrupted by the context margin" until you release).
    // During a stroke show the full mask everywhere; the clipped seam returns on end.
    if (this._region && !this._painting) {
      const r = this._region;
      ctx.beginPath();
      ctx.rect(r.rx * s + this._panX, r.ry * s + this._panY, r.rw * s, r.rh * s);
      ctx.clip();
    }
    ctx.globalAlpha = this.maskOpacity;
    ctx.drawImage(t, 0, 0, W, H);             // backing-res tint at logical size = crisp
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // tight painted bbox (white dashed)
  if (this._bbox) {
    const [x0, y0, x1, y1] = this._bbox;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.strokeRect(x0 * s + this._panX + 0.5, y0 * s + this._panY + 0.5, (x1 - x0) * s, (y1 - y0) * s);
    ctx.setLineDash([]);
  }

  // crop region (orange dashed) + handles + size badge
  if (this._region) {
    const r = this._region;
    const rx = r.rx * s + this._panX, ry = r.ry * s + this._panY, rw = r.rw * s, rh = r.rh * s;
    const boxColor = this._cropBoxColor || BRAND;   // white when the orange tint is active
    ctx.strokeStyle = boxColor; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]);
    ctx.fillStyle = boxColor;
    for (const [hx, hy] of [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]])
      ctx.fillRect(hx - 4, hy - 4, 8, 8);
    const label = `${r.out_w} × ${r.out_h}`;
    ctx.font = "bold 12px 'Segoe UI', sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const tw = ctx.measureText(label).width + 12;
    const by = Math.max(10, ry - 11);
    ctx.fillStyle = BRAND;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(rx, by - 9, tw, 18, 3); ctx.fill(); }
    else ctx.fillRect(rx, by - 9, tw, 18);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, rx + 6, by);
  }
};

// ── geometry preview ──────────────────────────────────────────────────────
// Scan the mask for its painted bounding box. This is the expensive part
// (full-image getImageData + per-pixel scan), so it only runs when the mask
// actually changes (stroke end / clear / invert / undo / load), NOT on every
// context-slider tick.
proto._rescanBBox = function () {
  if (!this.img || !this._mask) { this._bbox = null; return; }
  const id = this._mctx.getImageData(0, 0, this.imgW, this.imgH);
  this._bbox = maskBBoxFromImageData(id.data, this.imgW, this.imgH);
};

// Compute the crop region from the CACHED bbox + current knobs. Cheap, so it is
// safe to call on every context-slider tick without re-scanning the mask.
proto._recomputeRegion = function () {
  if (!this.img) { this._region = null; this._bbox = null; return; }
  const grow = this.params.mask_grow != null ? this.params.mask_grow : 0;
  const grown = growBBox(this._bbox, grow, this.imgW, this.imgH);
  // force mode is a square of `target` (the node has a single Target knob), so
  // mirror Python's _params: target_w = target_h = target, or the preview would
  // wrongly show the default 1024 in force mode.
  const p = { ...this.params, target_w: this.params.target, target_h: this.params.target };
  this._region = computeRegion(grown, this.imgW, this.imgH, p);
  this._updateInfo(this._bbox);
};

proto._updateInfo = function (bbox) {
  if (!this._infoBlock) return;
  if (!bbox) { this._infoBlock.setHTML("Paint a mask to begin.<br>The whole image will be used until you do."); return; }
  const r = this._region;
  this._infoBlock.setHTML(
    `<b>Crop out:</b> ${r.out_w} × ${r.out_h}<br>` +
    `<b>Region:</b> ${r.rw} × ${r.rh}px<br>` +
    `<b>Context:</b> ${this.params.context_px ?? 0}px`,
  );
};

// ── save ────────────────────────────────────────────────────────────────────
proto._buildPreview = function () {
  if (!this.img || !this._region) return null;
  const r = this._region;
  const c = document.createElement("canvas");
  c.width = r.out_w; c.height = r.out_h;
  c.getContext("2d").drawImage(this.img, r.rx, r.ry, r.rw, r.rh, 0, 0, r.out_w, r.out_h);
  return c.toDataURL("image/png");
};

proto._save = async function () {
  if (!this.img) { this._setStatus("No image to save"); return; }
  this.layout.setSaving();
  try {
    if (this._pendingSrcDataURL) {
      try {
        const d = await InpaintAPI.uploadSrc(this.projectId, this._pendingSrcDataURL);
        this._srcPath = d.path || this._srcPath;
      } catch (e) { console.warn("[InpaintCrop] src upload failed:", e); }
      this._pendingSrcDataURL = null;
    }
    try {
      const d = await InpaintAPI.saveMask(this.projectId, this._exportMaskDataURL());
      this._maskPath = d.path || this._maskPath;
    } catch (e) { console.warn("[InpaintCrop] mask save failed:", e); }

    const state = {
      project_id: this.projectId,
      src_path: this._srcPath,
      mask_path: this._maskPath,
      doc_w: this.imgW,
      doc_h: this.imgH,
      blend_mode: this.params.blend_mode || "mask",
    };
    const extra = {
      context_px: this.params.context_px,
      mask_grow: this.params.mask_grow,
      mask_blur: this.params.mask_blur,
      softness: this.params.blend,
      size_mode: this.params.size_mode,
      target: this.params.target,
      multiple: this.params.multiple,
      blend_mode: this.params.blend_mode,   // mirror the editor pill back to the node widget
    };
    const preview = this._buildPreview();
    if (this.onSave) this.onSave(JSON.stringify(state), extra, preview);
    if (this._diskSavePending) {
      this._diskSavePending = false;
      if (this.onSaveToDisk && preview) this.onSaveToDisk(preview);
    }
    this.layout.setSaved();
  } catch (err) {
    console.error("[InpaintCrop] Save error:", err);
    this.layout.setSaveError("Save failed: " + err.message);
  }
};
