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

proto._draw = function () {
  if (!this.img) return;
  const ctx = this.el.ctx, s = this._scale;
  const W = this._dispW || this.el.canvas.width, H = this._dispH || this.el.canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(this.img, 0, 0, W, H);

  // red mask overlay (tint the mask alpha)
  if (this.maskVisible && this._mask) {
    if (!this._tint) this._tint = document.createElement("canvas");
    const t = this._tint;
    if (t.width !== W || t.height !== H) { t.width = W; t.height = H; }
    const tc = t.getContext("2d");
    tc.clearRect(0, 0, t.width, t.height);
    tc.drawImage(this._effectiveMaskCanvas(), 0, 0, t.width, t.height);
    tc.globalCompositeOperation = "source-in";
    tc.fillStyle = "#f6303a";
    tc.fillRect(0, 0, t.width, t.height);
    tc.globalCompositeOperation = "source-over";
    ctx.globalAlpha = this.maskOpacity;
    ctx.drawImage(t, 0, 0);
    ctx.globalAlpha = 1;
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
    ctx.strokeStyle = BRAND; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]);
    ctx.fillStyle = BRAND;
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
    };
    const preview = this._buildPreview();
    if (this.onSave) this.onSave(JSON.stringify(state), { context_px: this.params.context_px }, preview);
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
