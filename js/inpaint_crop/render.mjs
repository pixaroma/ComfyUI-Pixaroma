// ============================================================
// Inpaint Crop Pixaroma — canvas render + region preview + save
// ============================================================
import { InpaintCropEditor, BRAND, InpaintAPI } from "./core.mjs";
import { computeRegion, maskBBoxFromImageData, growBBox } from "./geometry.mjs";

const proto = InpaintCropEditor.prototype;

// ── image load ──────────────────────────────────────────────────────────────
proto._loadImageFromURL = function (url, onDone) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
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
  const img = new Image();
  img.onload = () => {
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
  this._scale = dw / this.imgW;
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

// Feathered seam alpha at display resolution: an outward blur of the mask over
// (blend * scale) px, with the interior forced opaque - the canvas mirror of the
// Python no-scipy _blur_alpha fallback. Approximate preview (F2), not pixel-exact.
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
  const blendDisp = Math.max(0, (this.params.blend ?? 16) * (this._scale || 1) * dpr);
  if (blendDisp < 0.5) { ctx.drawImage(src, 0, 0, W, H); return c; }
  ctx.filter = `blur(${(blendDisp / 1.7).toFixed(1)}px)`;
  ctx.drawImage(src, 0, 0, W, H);          // outward falloff
  ctx.filter = "none";
  ctx.drawImage(src, 0, 0, W, H);          // interior -> opaque
  return c;
};

proto._draw = function () {
  if (!this.img || !this._dispW) return;  // _fitCanvas sets _dispW before any draw
  const ctx = this.el.ctx, s = this._scale;
  const W = this._dispW, H = this._dispH;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(this.img, 0, 0, W, H);

  // seam preview: tint the FEATHERED seam alpha (Softness) in the chosen color,
  // clipped to the crop region. DPR-backed (crisp on HiDPI). Approximate (mirrors
  // the Python no-scipy fallback).
  if (this.maskVisible && this._mask) {
    if (!this._tint) this._tint = document.createElement("canvas");
    const t = this._tint;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const tw = Math.round(W * dpr), th = Math.round(H * dpr);
    if (t.width !== tw || t.height !== th) { t.width = tw; t.height = th; }
    const tc = t.getContext("2d");
    tc.setTransform(1, 0, 0, 1, 0, 0);
    tc.clearRect(0, 0, tw, th);
    tc.drawImage(this._seamAlphaCanvas(), 0, 0, tw, th);
    tc.globalCompositeOperation = "source-in";
    tc.fillStyle = this.previewColor || "#f6303a";
    tc.fillRect(0, 0, tw, th);
    tc.globalCompositeOperation = "source-over";
    ctx.save();
    if (this._region) {                       // clip the seam tint to the crop box
      const r = this._region;
      ctx.beginPath();
      ctx.rect(r.rx * s, r.ry * s, r.rw * s, r.rh * s);
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
    ctx.strokeRect(x0 * s + 0.5, y0 * s + 0.5, (x1 - x0) * s, (y1 - y0) * s);
    ctx.setLineDash([]);
  }

  // crop region (orange dashed) + handles + size badge
  if (this._region) {
    const r = this._region;
    const rx = r.rx * s, ry = r.ry * s, rw = r.rw * s, rh = r.rh * s;
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
  this._region = computeRegion(grown, this.imgW, this.imgH, this.params);
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
