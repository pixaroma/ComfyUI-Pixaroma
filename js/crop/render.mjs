// ============================================================
// Pixaroma Image Crop Editor — Render (canvas rendering, aspect ratio, save)
// ============================================================
import { CropEditor, BRAND, RATIOS, SNAPS, CropAPI } from "./core.mjs";

const proto = CropEditor.prototype;

// --- Load Image ---
proto._promptLoadImage = function () {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) =>
      this._loadImageFromDataURL(ev.target.result, file.name);
    reader.readAsDataURL(file);
  };
  input.click();
};

proto._loadImageFromDataURL = function (dataURL, filename) {
  const img = new Image();
  img.onload = () => {
    this.img = img;
    this.imgW = img.naturalWidth;
    this.imgH = img.naturalHeight;
    this._pendingSrcDataURL = dataURL;
    if (this._canvasSettings)
      this._canvasSettings.setSize(this.imgW, this.imgH);
    this._resetCrop();
    this._setStatus(`Loaded: ${this.imgW}\u00d7${this.imgH}`);
  };
  img.src = dataURL;
};

proto._loadImageFromURL = function (url, onDone) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    this.img = img;
    this.imgW = img.naturalWidth;
    this.imgH = img.naturalHeight;
    this._fitCanvas();
    this._draw();
    this._updateInfo();
    if (onDone) onDone();
  };
  img.onerror = () => console.warn("[Crop] Failed to load:", url);
  img.src = url;
};

proto._uploadSourceImage = async function (dataURL) {
  try {
    const { api } = await import("/scripts/api.js");
    const res = await api.fetchApi("/pixaroma/api/crop/upload_src", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: this.projectId, image: dataURL }),
    });
    const data = await res.json();
    this._srcPath = data.path || "";
  } catch (e) {
    console.warn("[Crop] Source upload failed:", e);
  }
};

// --- Canvas fit & draw ---
proto._fitCanvas = function () {
  if (!this.img) return;
  const ws = this.el.workspace;
  const pad = 40,
    maxW = ws.clientWidth - pad * 2,
    maxH = ws.clientHeight - pad * 2;
  if (maxW <= 0 || maxH <= 0) return;
  const imgAsp = this.imgW / this.imgH;
  let dispW, dispH;
  if (maxW / maxH > imgAsp) {
    dispH = maxH;
    dispW = dispH * imgAsp;
  } else {
    dispW = maxW;
    dispH = dispW / imgAsp;
  }
  this._scale = dispW / this.imgW;
  const cvs = this.el.canvas;
  cvs.width = Math.round(dispW);
  cvs.height = Math.round(dispH);
  cvs.style.cursor = "crosshair";
  if (this._canvasFrame) this._canvasFrame.update(this.imgW, this.imgH);
};

proto._draw = function () {
  if (!this.img) return;
  this._fitCanvas();
  const ctx = this.el.ctx,
    cvs = this.el.canvas,
    s = this._scale;
  ctx.drawImage(this.img, 0, 0, cvs.width, cvs.height);

  // Dark overlay outside crop
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  const cx = this.cropX * s,
    cy = this.cropY * s,
    cw = this.cropW * s,
    ch = this.cropH * s;
  ctx.fillRect(0, 0, cvs.width, cy);
  ctx.fillRect(0, cy + ch, cvs.width, cvs.height - cy - ch);
  ctx.fillRect(0, cy, cx, ch);
  ctx.fillRect(cx + cw, cy, cvs.width - cx - cw, ch);

  // Crop border
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);

  // Rule of thirds
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 0.5;
  for (let i = 1; i <= 2; i++) {
    const gx = cx + (cw * i) / 3,
      gy = cy + (ch * i) / 3;
    ctx.beginPath();
    ctx.moveTo(gx, cy);
    ctx.lineTo(gx, cy + ch);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, gy);
    ctx.lineTo(cx + cw, gy);
    ctx.stroke();
  }

  // Handles
  this._drawHandles(ctx, cx, cy, cw, ch);

  // Dimension label
  if (cw > 80 && ch > 30) {
    const label = `${Math.round(this.cropW)} \u00d7 ${Math.round(this.cropH)}`;
    ctx.font = "bold 11px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.beginPath();
    if (ctx.roundRect)
      ctx.roundRect(cx + cw / 2 - tw / 2, cy + ch / 2 - 10, tw, 20, 4);
    else ctx.rect(cx + cw / 2 - tw / 2, cy + ch / 2 - 10, tw, 20);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(label, cx + cw / 2, cy + ch / 2);
  }
};

proto._drawHandles = function (ctx, cx, cy, cw, ch) {
  const sz = 10;
  const positions = this._getHandleDrawPositions(cx, cy, cw, ch, sz);
  for (const h of positions) {
    ctx.fillStyle = BRAND;
    ctx.fillRect(h.dx, h.dy, sz, sz);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(h.dx, h.dy, sz, sz);
  }
};

proto._getHandleDrawPositions = function (cx, cy, cw, ch, sz) {
  const s = sz;
  return [
    { id: "tl", dx: cx, dy: cy },
    { id: "tr", dx: cx + cw - s, dy: cy },
    { id: "bl", dx: cx, dy: cy + ch - s },
    { id: "br", dx: cx + cw - s, dy: cy + ch - s },
    { id: "t", dx: cx + cw / 2 - s / 2, dy: cy },
    { id: "b", dx: cx + cw / 2 - s / 2, dy: cy + ch - s },
    { id: "l", dx: cx, dy: cy + ch / 2 - s / 2 },
    { id: "r", dx: cx + cw - s, dy: cy + ch / 2 - s / 2 },
  ];
};

proto._getHandlePositions = function (cx, cy, cw, ch) {
  return [
    { id: "tl", x: cx, y: cy },
    { id: "tr", x: cx + cw, y: cy },
    { id: "bl", x: cx, y: cy + ch },
    { id: "br", x: cx + cw, y: cy + ch },
    { id: "t", x: cx + cw / 2, y: cy },
    { id: "b", x: cx + cw / 2, y: cy + ch },
    { id: "l", x: cx, y: cy + ch / 2 },
    { id: "r", x: cx + cw, y: cy + ch / 2 },
  ];
};

// --- Ratio & Snap ---
proto._getActiveRatio = function () {
  const r = RATIOS[this.ratioIdx];
  if (!r || r.w === 0) return 0;
  return r.w / r.h;
};

proto._snapVal = function (v, snap) {
  if (snap <= 1) return Math.round(v);
  return Math.max(snap, Math.round(v / snap) * snap);
};

proto._computeWH = function (targetW, ratio, snap) {
  let w = snap > 1 ? this._snapVal(targetW, snap) : Math.round(targetW);
  w = Math.max(snap > 1 ? snap : 1, Math.min(w, this.imgW));
  let h;
  if (ratio > 0) {
    h = snap > 1 ? this._snapVal(w / ratio, snap) : Math.round(w / ratio);
    while (h > this.imgH && w > (snap > 1 ? snap : 1)) {
      w -= snap > 1 ? snap : 1;
      h = snap > 1 ? this._snapVal(w / ratio, snap) : Math.round(w / ratio);
    }
    h = Math.min(h, this.imgH);
  } else {
    h = snap > 1 ? this._snapVal(this.cropH, snap) : Math.round(this.cropH);
    h = Math.max(1, Math.min(h, this.imgH));
  }
  return { w, h };
};

proto._computeWHfromH = function (targetH, ratio, snap) {
  let h = snap > 1 ? this._snapVal(targetH, snap) : Math.round(targetH);
  h = Math.max(snap > 1 ? snap : 1, Math.min(h, this.imgH));
  let w;
  if (ratio > 0) {
    w = snap > 1 ? this._snapVal(h * ratio, snap) : Math.round(h * ratio);
    while (w > this.imgW && h > (snap > 1 ? snap : 1)) {
      h -= snap > 1 ? snap : 1;
      w = snap > 1 ? this._snapVal(h * ratio, snap) : Math.round(h * ratio);
    }
    w = Math.min(w, this.imgW);
  } else {
    w = snap > 1 ? this._snapVal(this.cropW, snap) : Math.round(this.cropW);
    w = Math.max(1, Math.min(w, this.imgW));
  }
  return { w, h };
};

proto._setCropCentered = function (nw, nh) {
  const ccx = this.cropX + this.cropW / 2;
  const ccy = this.cropY + this.cropH / 2;
  this.cropW = nw;
  this.cropH = nh;
  this.cropX = ccx - nw / 2;
  this.cropY = ccy - nh / 2;
  this._clampPosition();
};

proto._clampPosition = function () {
  if (this.cropX < 0) this.cropX = 0;
  if (this.cropY < 0) this.cropY = 0;
  if (this.cropX + this.cropW > this.imgW) this.cropX = this.imgW - this.cropW;
  if (this.cropY + this.cropH > this.imgH) this.cropY = this.imgH - this.cropH;
};

proto._applyRatio = function () {
  if (!this.img) return;
  const ratio = this._getActiveRatio();
  if (ratio <= 0) {
    this._draw();
    this._updateInfo();
    return;
  }
  const snap = SNAPS[this.snapIdx].val;
  const { w, h } = this._computeWH(this.cropW || this.imgW, ratio, snap);
  this._setCropCentered(w, h);
  this._draw();
  this._updateInfo();
};

proto._swapRatio = function () {
  if (!this.img) return;
  // Delegate to the shared canvas settings component -- it updates ratioIdx internally
  this._canvasSettings.swap();
  // Sync local ratioIdx from the component
  this.ratioIdx = this._canvasSettings.getRatioIndex();

  const oldW = Math.round(this.cropW),
    oldH = Math.round(this.cropH);
  const r = RATIOS[this.ratioIdx];
  const snap = SNAPS[this.snapIdx].val;

  if (r && r.w > 0) {
    const newRatio = this._getActiveRatio();
    const result = this._computeWH(oldH, newRatio, snap);
    this._setCropCentered(result.w, result.h);
  } else {
    let nw = Math.min(oldH, this.imgW);
    let nh = Math.min(oldW, this.imgH);
    if (snap > 1) {
      nw = this._snapVal(nw, snap);
      nh = this._snapVal(nh, snap);
    }
    nw = Math.min(nw, this.imgW);
    nh = Math.min(nh, this.imgH);
    this._setCropCentered(nw, nh);
  }
  this._draw();
  this._updateInfo();
  this._setStatus(
    `Swapped \u2192 ${Math.round(this.cropW)}\u00d7${Math.round(this.cropH)}`,
  );
};

proto._applySnap = function () {
  if (!this.img) return;
  const ratio = this._getActiveRatio();
  const snap = SNAPS[this.snapIdx].val;
  if (snap <= 1) {
    this._draw();
    this._updateInfo();
    return;
  }
  const { w, h } = this._computeWH(this.cropW, ratio, snap);
  this._setCropCentered(w, h);
  this._draw();
  this._updateInfo();
};

proto._applyConstraints = function () {
  if (this.cropX < 0) this.cropX = 0;
  if (this.cropY < 0) this.cropY = 0;
  if (this.cropW > this.imgW) this.cropW = this.imgW;
  if (this.cropH > this.imgH) this.cropH = this.imgH;
  if (this.cropX + this.cropW > this.imgW) this.cropX = this.imgW - this.cropW;
  if (this.cropY + this.cropH > this.imgH) this.cropY = this.imgH - this.cropH;
};

proto._resetCrop = function () {
  if (!this.img) return;
  this.ratioIdx = 0;
  this.snapIdx = 0;
  this._canvasSettings.setRatio(0);
  this._canvasSettings.setSize(this.imgW, this.imgH);
  this._snapGrid.setActive(0);
  this.cropX = 0;
  this.cropY = 0;
  this.cropW = this.imgW;
  this.cropH = this.imgH;
  this._fitCanvas();
  this._draw();
  this._updateInfo();
  this._setStatus("Crop reset to full image");
};

// --- Info & Sliders ---
proto._updateInfo = function () {
  if (!this.img) {
    this._infoBlock.setHTML("No image loaded");
    return;
  }
  const cw = Math.round(Math.abs(this.cropW)),
    ch = Math.round(Math.abs(this.cropH));
  const cx = Math.round(Math.max(0, this.cropX)),
    cy = Math.round(Math.max(0, this.cropY));
  const r = RATIOS[this.ratioIdx];
  const rLabel = r.w === 0 ? "Free" : r.label;
  this._infoBlock.setHTML(
    `<b>Original:</b> ${this.imgW}\u00d7${this.imgH}<br>` +
      `<b>Ratio:</b> ${rLabel}<br>` +
      `<b>Snap:</b> ${SNAPS[this.snapIdx].label}`,
  );

  this._updatingSliders = true;
  const ratio = this._getActiveRatio();
  let maxW = this.imgW,
    maxH = this.imgH;
  if (ratio > 0) {
    maxW = Math.min(this.imgW, Math.floor(this.imgH * ratio));
    maxH = Math.min(this.imgH, Math.floor(this.imgW / ratio));
  }
  this.el.sliderW.setRange(1, maxW);
  this.el.sliderW.setValue(cw);
  this.el.sliderH.setRange(1, maxH);
  this.el.sliderH.setValue(ch);
  this.el.sliderX.setRange(0, Math.max(0, this.imgW - cw));
  this.el.sliderX.setValue(cx);
  this.el.sliderY.setRange(0, Math.max(0, this.imgH - ch));
  this.el.sliderY.setValue(cy);
  this._updatingSliders = false;
  // Sync canvas settings display with current crop dimensions
  if (this._canvasSettings) this._canvasSettings.setSize(cw, ch);
};

proto._onSliderChange = function (key) {
  if (this._updatingSliders || !this.img) return;
  const ratio = this._getActiveRatio();
  const snap = SNAPS[this.snapIdx].val;

  if (key === "w" || key === "h") {
    let nw, nh;
    if (key === "w") {
      const target = parseFloat(this.el.sliderW.numInput.value) || 1;
      const result = this._computeWH(target, ratio, snap);
      nw = result.w;
      nh = result.h;
    } else {
      const target = parseFloat(this.el.sliderH.numInput.value) || 1;
      const result = this._computeWHfromH(target, ratio, snap);
      nw = result.w;
      nh = result.h;
    }
    this._setCropCentered(nw, nh);
  } else {
    const nx = parseFloat(this.el.sliderX.numInput.value) || 0;
    const ny = parseFloat(this.el.sliderY.numInput.value) || 0;
    this.cropX = Math.max(0, Math.min(nx, this.imgW - this.cropW));
    this.cropY = Math.max(0, Math.min(ny, this.imgH - this.cropH));
  }
  this._applyConstraints();
  this._draw();
  this._updateInfo();
};

proto._setStatus = function (msg) {
  this.layout?.setStatus(msg);
};

// --- Save ---
proto._save = async function () {
  if (!this.img) {
    this._setStatus("No image to save");
    return;
  }
  this.layout.setSaving();
  try {
    if (this._pendingSrcDataURL) {
      await this._uploadSourceImage(this._pendingSrcDataURL);
      this._pendingSrcDataURL = null;
    }

    const cw = Math.round(Math.abs(this.cropW)),
      ch = Math.round(Math.abs(this.cropH));
    const cx = Math.round(Math.max(0, this.cropX)),
      cy = Math.round(Math.max(0, this.cropY));
    const outCvs = document.createElement("canvas");
    outCvs.width = cw;
    outCvs.height = ch;
    outCvs.getContext("2d").drawImage(this.img, cx, cy, cw, ch, 0, 0, cw, ch);
    const dataURL = outCvs.toDataURL("image/png");

    let compositePath = "";
    try {
      const res = await CropAPI.saveComposite(this.projectId, dataURL);
      compositePath = res.composite_path || "";
    } catch (e) {
      console.warn("[Crop] Composite save failed:", e);
    }

    const meta = {
      doc_w: cw,
      doc_h: ch,
      original_w: this.imgW,
      original_h: this.imgH,
      crop_x: cx,
      crop_y: cy,
      crop_w: cw,
      crop_h: ch,
      ratio_idx: this.ratioIdx,
      snap_idx: this.snapIdx,
      project_id: this.projectId,
      composite_path: compositePath,
      src_path: this._srcPath,
    };
    if (this.onSave) this.onSave(JSON.stringify(meta), dataURL);
    if (this._diskSavePending) {
      this._diskSavePending = false;
      if (this.onSaveToDisk) this.onSaveToDisk(dataURL);
    }
    this.layout.setSaved();
  } catch (err) {
    console.error("[Crop] Save error:", err);
    this.layout.setSaveError("Save failed: " + err.message);
  }
};
