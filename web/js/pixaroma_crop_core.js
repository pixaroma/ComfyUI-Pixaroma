// ============================================================
// Pixaroma Image Crop Editor — Core + Full UI  v2
// ============================================================
import { PixaromaEditorBase } from "./pixaroma_base_editor.js";

const STYLE_ID = "pixaroma-crop-styles-v2";
const BRAND = "#f66744";

const RATIOS = [
  { label: "Free", w: 0, h: 0 },
  { label: "1:1", w: 1, h: 1 },
  { label: "4:3", w: 4, h: 3 },
  { label: "3:2", w: 3, h: 2 },
  { label: "16:9", w: 16, h: 9 },
  { label: "4:5", w: 4, h: 5 },
  { label: "3:4", w: 3, h: 4 },
  { label: "2:3", w: 2, h: 3 },
  { label: "9:16", w: 9, h: 16 },
  { label: "5:4", w: 5, h: 4 },
];

const SNAPS = [
  { label: "None", val: 1 },
  { label: "×8", val: 8 },
  { label: "×16", val: 16 },
  { label: "×32", val: 32 },
  { label: "×64", val: 64 },
];

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  document.getElementById("pixaroma-crop-styles-v1")?.remove();
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
.pcrop-sidebar {
    width:220px; flex-shrink:0; background:#181a1b;
    border-right:1px solid #2a2c2e;
    display:flex; flex-direction:column; overflow-y:auto; overflow-x:hidden;
}
.pcrop-section { padding:8px 10px; border-bottom:1px solid #2a2c2e; }
.pcrop-section-title {
    font-size:9px; color:${BRAND}; font-weight:bold; text-transform:uppercase;
    letter-spacing:.06em; margin-bottom:6px;
}
.pcrop-btn {
    background:#353535; border:1px solid #3a3d40; color:#ccc;
    border-radius:5px; padding:7px 18px; font-size:13px; font-family:inherit;
    cursor:pointer; transition:all .12s; white-space:nowrap;
}
.pcrop-btn:hover { background:#2e3033; color:${BRAND}; border-color:${BRAND}; }
.pcrop-btn-accent { background:${BRAND}; border-color:${BRAND}; color:#fff; font-weight:bold; }
.pcrop-btn-accent:hover { background:#e05535; border-color:#e05535; }
.pcrop-btn-full {
    width:100%; padding:8px; font-size:12px; text-align:center;
    background:#1e2022; border:1px solid #3a3d40; color:#ccc;
    border-radius:4px; cursor:pointer; transition:all .12s;
}
.pcrop-btn-full:hover { background:${BRAND}; border-color:${BRAND}; color:#fff; }
.pcrop-pill-grid { display:grid; grid-template-columns:repeat(5, 1fr); gap:4px; }
.pcrop-pill {
    font-size:10px; background:#1e2022; border:1px solid #3a3d40; color:#aaa;
    border-radius:3px; padding:4px 0; cursor:pointer; transition:all .1s;
    text-align:center;
}
.pcrop-pill:hover { background:#444; color:#fff; }
.pcrop-pill.active { background:${BRAND}; border-color:${BRAND}; color:#fff; }
.pcrop-info { font-size:10px; color:#888; line-height:1.6; }
.pcrop-info b { color:#ccc; font-weight:600; }
.pcrop-workspace {
    flex:1; position:relative; overflow:hidden; background:#111315;
    display:flex; align-items:center; justify-content:center;
}
.pcrop-canvas-wrap { position:relative; display:inline-block; }
.pcrop-canvas-wrap canvas { display:block; }
.pcrop-bottombar {
    display:flex; align-items:center; gap:8px;
    padding:6px 12px; background:#131415;
    border-top:1px solid #2e3033; flex-shrink:0;
}
.pcrop-status { font-size:10px; color:#888; flex:1; }
.pcrop-help-overlay {
    display:none; position:absolute; top:50%; left:50%;
    transform:translate(-50%,-50%);
    background:rgba(15,16,17,.97); border:1px solid ${BRAND};
    border-radius:8px; padding:20px 24px; min-width:340px; max-width:480px;
    z-index:100; font-size:11px; line-height:1.8; color:#ccc;
}
.pcrop-help-overlay h3 { color:${BRAND}; margin:0 0 8px; font-size:14px; }
.pcrop-help-overlay kbd {
    background:#2a2c2e; border:1px solid #444; border-radius:3px;
    padding:1px 5px; font-size:10px; color:#e0e0e0;
}
.pcrop-slider-row {
    display:flex; align-items:center; gap:5px; margin-bottom:5px;
}
.pcrop-slider-row label {
    font-size:10px; color:#888; width:16px; flex-shrink:0;
}
.pcrop-slider-row input[type=range] {
    flex:1; accent-color:${BRAND}; cursor:pointer; min-width:0;
}
.pcrop-slider-row input[type=number] {
    width:52px; background:#111; color:#e0e0e0; border:1px solid #3a3d40;
    border-radius:3px; padding:2px 4px; font-size:10px; font-family:monospace;
    flex-shrink:0;
}
.pcrop-sidebar::-webkit-scrollbar { width:5px; }
.pcrop-sidebar::-webkit-scrollbar-track { background:#111; }
.pcrop-sidebar::-webkit-scrollbar-thumb { background:#3a3d40; border-radius:3px; }
.pcrop-sidebar::-webkit-scrollbar-thumb:hover { background:${BRAND}; }
`;
  document.head.appendChild(s);
}

const CropAPI = {
  async saveComposite(projectId, dataURL) {
    const { api } = await import("/scripts/api.js");
    const res = await api.fetchApi("/pixaroma/api/crop/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, image_merged: dataURL }),
    });
    return await res.json();
  },
};

// ═════════════════════════════════════════════════════════════
export class CropEditor extends PixaromaEditorBase {
  constructor() {
    super();
    this.img = null;
    this.imgW = 0;
    this.imgH = 0;
    this.projectId = null;
    this.cropX = 0;
    this.cropY = 0;
    this.cropW = 0;
    this.cropH = 0;
    this.ratioIdx = 0;
    this.snapIdx = 0;
    this._drag = null;
    this._scale = 1;
    this._srcPath = "";
  }

  // ─── Base class hooks ────────────────────────────────────

  _editorTitle() {
    return `Image Crop <span class="pxb-brand">Pixaroma</span>`;
  }

  _buildWorkspace() {
    const ws = document.createElement("div");
    ws.className = "pcrop-workspace";
    this.el.workspace = ws;
    const wrap = document.createElement("div");
    wrap.className = "pcrop-canvas-wrap";
    this.el.canvasWrap = wrap;
    const cvs = document.createElement("canvas");
    cvs.width = 100;
    cvs.height = 100;
    this.el.canvas = cvs;
    this.el.ctx = cvs.getContext("2d");
    wrap.appendChild(cvs);

    const help = document.createElement("div");
    help.className = "pcrop-help-overlay";
    help.innerHTML = `
<div style="display:flex;align-items:center;margin-bottom:8px;">
<h3 style="flex:1;margin:0;">Image Crop — Shortcuts</h3>
<button onclick="this.closest('.pcrop-help-overlay').style.display='none'" style="background:none;border:1px solid #555;color:#ccc;border-radius:4px;width:24px;height:24px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;">✕</button>
</div>
<b>Load image:</b> Click <kbd>Load Image</kbd> in sidebar<br>
<b>Drag crop region:</b> Click & drag inside the crop area<br>
<b>Resize crop:</b> Drag orange corner/edge handles<br>
<b>Reset crop:</b> Press <kbd>R</kbd> or click Reset<br>
<b>Swap ratio:</b> Press <kbd>X</kbd> to flip W↔H ratio<br>
<b>Free ratio:</b> Press <kbd>F</kbd><br>
<b>Save:</b> <kbd>Ctrl+S</kbd><br>
<b>Close:</b> <kbd>Escape</kbd>
`;
    this.el.help = help;
    ws.appendChild(help);
    ws.appendChild(wrap);
    this._bindMouse(cvs);
    return ws;
  }

  _buildBottomBar() {
    const bb = document.createElement("div");
    bb.className = "pcrop-bottombar";
    const status = document.createElement("span");
    status.className = "pcrop-status";
    status.textContent = "Load an image to begin";
    this.el.status = status;
    bb.appendChild(status);
    return bb;
  }

  // ─── Open / Close ────────────────────────────────────────
  _onOpen(jsonStr) {
    injectStyles();

    let data = {};
    try {
      data = jsonStr && jsonStr !== "{}" ? JSON.parse(jsonStr) : {};
    } catch (e) {}

    this.projectId = data.project_id || "crop_" + Date.now();
    this._srcPath = data.src_path || "";

    if (this._srcPath) {
      const fn = this._srcPath.split(/[\\/]/).pop();
      const url = `/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
      this._loadImageFromURL(url, () => {
        if (data.crop_x != null) {
          this.cropX = data.crop_x;
          this.cropY = data.crop_y;
          this.cropW = data.crop_w;
          this.cropH = data.crop_h;
        }
        if (data.ratio_idx != null) {
          this.ratioIdx = data.ratio_idx;
          this._updateRatioPills();
        }
        if (data.snap_idx != null) {
          this.snapIdx = data.snap_idx;
          this._updateSnapPills();
        }
        this._draw();
        this._updateInfo();
      });
    }
    this._bindKeys();
  }

  _close() {
    this._unbindKeys();
    super._close();
  }

  // ─── Left Sidebar ─────────────────────────────────────────
  _buildLeftSidebar() {
    const sb = document.createElement("div");
    sb.className = "pcrop-sidebar";

    // Load Image
    const secLoad = this._mkSection("Image");
    secLoad.appendChild(this._mkBtn("📂 Load Image", () => this._promptLoadImage(), "pcrop-btn-full"));
    sb.appendChild(secLoad);

    // Aspect Ratio
    const secRatio = this._mkSection("Aspect Ratio");
    const ratioGrid = document.createElement("div");
    ratioGrid.className = "pcrop-pill-grid";
    this.el.ratioPills = [];
    RATIOS.forEach((r, i) => {
      const pill = document.createElement("button");
      pill.className = "pcrop-pill" + (i === 0 ? " active" : "");
      pill.textContent = r.label;
      pill.onclick = () => {
        this.ratioIdx = i;
        this.ratioSwapped = false;
        this._applyRatio();
        this._updateRatioPills();
      };
      ratioGrid.appendChild(pill);
      this.el.ratioPills.push(pill);
    });
    secRatio.appendChild(ratioGrid);
    const swapBtn = document.createElement("button");
    swapBtn.className = "pcrop-pill";
    swapBtn.textContent = "⇄ Swap W↔H";
    swapBtn.style.marginTop = "6px";
    swapBtn.onclick = () => this._swapRatio();
    secRatio.appendChild(swapBtn);
    sb.appendChild(secRatio);

    // Pixel Snap
    const secSnap = this._mkSection("Pixel Snap");
    const snapGrid = document.createElement("div");
    snapGrid.className = "pcrop-pill-grid";
    this.el.snapPills = [];
    SNAPS.forEach((s, i) => {
      const pill = document.createElement("button");
      pill.className = "pcrop-pill" + (i === 0 ? " active" : "");
      pill.textContent = s.label;
      pill.onclick = () => {
        this.snapIdx = i;
        this._applySnap();
        this._updateSnapPills();
      };
      snapGrid.appendChild(pill);
      this.el.snapPills.push(pill);
    });
    secSnap.appendChild(snapGrid);
    sb.appendChild(secSnap);

    // Crop Size sliders
    const secSize = this._mkSection("Crop Size");
    const mkSlider = (label, key) => {
      const row = document.createElement("div");
      row.className = "pcrop-slider-row";
      const lbl = document.createElement("label");
      lbl.textContent = label;
      row.appendChild(lbl);
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "1";
      slider.max = "4096";
      slider.value = "1024";
      const num = document.createElement("input");
      num.type = "number";
      num.min = "1";
      num.max = "4096";
      slider.addEventListener("input", () => {
        num.value = slider.value;
        this._onSliderChange(key);
      });
      num.addEventListener("input", () => {
        slider.value = num.value;
        this._onSliderChange(key);
      });
      row.appendChild(slider);
      row.appendChild(num);
      return { row, slider, num };
    };
    const sW = mkSlider("W", "w");
    const sH = mkSlider("H", "h");
    const sX = mkSlider("X", "x");
    const sY = mkSlider("Y", "y");
    this.el.sliderW = sW;
    this.el.sliderH = sH;
    this.el.sliderX = sX;
    this.el.sliderY = sY;
    secSize.appendChild(sW.row);
    secSize.appendChild(sH.row);
    secSize.appendChild(sX.row);
    secSize.appendChild(sY.row);
    sb.appendChild(secSize);

    // Info
    const secInfo = this._mkSection("Info");
    const infoDiv = document.createElement("div");
    infoDiv.className = "pcrop-info";
    infoDiv.innerHTML = "No image loaded";
    this.el.info = infoDiv;
    secInfo.appendChild(infoDiv);
    sb.appendChild(secInfo);

    // Actions
    const secAct = this._mkSection("Actions");
    secAct.appendChild(this._mkBtn("↺ Reset Crop", () => this._resetCrop(), "pcrop-btn-full"));
    sb.appendChild(secAct);

    // Save / Close / Help — at bottom of sidebar, pushed down
    const actSec = document.createElement("div");
    actSec.style.cssText =
      "padding:10px 12px;margin-top:auto;border-top:1px solid #2e3033;display:flex;flex-direction:column;gap:6px;flex-shrink:0;";
    const helpB = this._mkBtn("? Help", () => this._toggleHelp(), "pcrop-btn");
    helpB.style.cssText =
      "width:100%;padding:7px 0;font-size:13px;border-radius:5px;background:#353535;border:1px solid #3a3d40;color:#ccc;text-align:center;";
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:6px;";
    const saveB = this._mkBtn("Save", () => this._save(), "pcrop-btn pcrop-btn-accent");
    saveB.style.cssText = "flex:1;padding:7px 0;font-size:13px;border-radius:5px;text-align:center;";
    this.el.saveBtn = saveB;
    const closeB = this._mkBtn("Close", () => this._close(), "pcrop-btn");
    closeB.style.cssText =
      "flex:1;padding:7px 0;font-size:13px;border-radius:5px;background:#353535;border:1px solid #3a3d40;color:#ccc;text-align:center;";
    btnRow.append(saveB, closeB);
    actSec.append(helpB, btnRow);
    sb.appendChild(actSec);

    return sb;
  }

  _mkSection(title) {
    const sec = document.createElement("div");
    sec.className = "pcrop-section";
    const t = document.createElement("div");
    t.className = "pcrop-section-title";
    t.textContent = title;
    sec.appendChild(t);
    return sec;
  }

  _mkBtn(text, onClick, cls = "pcrop-btn") {
    const btn = document.createElement("button");
    btn.className = cls;
    btn.textContent = text;
    btn.addEventListener("click", onClick);
    return btn;
  }

  _updateRatioPills() {
    this.el.ratioPills.forEach((p, i) => p.classList.toggle("active", i === this.ratioIdx));
  }
  _updateSnapPills() {
    this.el.snapPills.forEach((p, i) => p.classList.toggle("active", i === this.snapIdx));
  }

  // ─── Load Image ──────────────────────────────────────────
  _promptLoadImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => this._loadImageFromDataURL(ev.target.result, file.name);
      reader.readAsDataURL(file);
    };
    input.click();
  }

  _loadImageFromDataURL(dataURL, filename) {
    const img = new Image();
    img.onload = () => {
      this.img = img;
      this.imgW = img.naturalWidth;
      this.imgH = img.naturalHeight;
      this._pendingSrcDataURL = dataURL; // Don't upload until save
      this._resetCrop();
      this._setStatus(`Loaded: ${this.imgW}×${this.imgH}`);
    };
    img.src = dataURL;
  }

  _loadImageFromURL(url, onDone) {
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
  }

  async _uploadSourceImage(dataURL) {
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
  }

  // ─── Canvas fit & draw ───────────────────────────────────
  _fitCanvas() {
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
  }

  _draw() {
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

    // Handles — orange filled squares
    this._drawHandles(ctx, cx, cy, cw, ch);

    // Dimension label
    if (cw > 80 && ch > 30) {
      const label = `${Math.round(this.cropW)} × ${Math.round(this.cropH)}`;
      ctx.font = "bold 11px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cx + cw / 2 - tw / 2, cy + ch / 2 - 10, tw, 20, 4);
      else ctx.rect(cx + cw / 2 - tw / 2, cy + ch / 2 - 10, tw, 20);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(label, cx + cw / 2, cy + ch / 2);
    }
  }

  _drawHandles(ctx, cx, cy, cw, ch) {
    const sz = 10; // full handle size in px
    const positions = this._getHandleDrawPositions(cx, cy, cw, ch, sz);
    for (const h of positions) {
      ctx.fillStyle = BRAND;
      ctx.fillRect(h.dx, h.dy, sz, sz);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(h.dx, h.dy, sz, sz);
    }
  }

  // Draw positions: handles are placed INSIDE the crop area so they're never clipped
  _getHandleDrawPositions(cx, cy, cw, ch, sz) {
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
  }

  // Hit-test positions stay centered on edges for intuitive grabbing
  _getHandlePositions(cx, cy, cw, ch) {
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
  }

  // ─── Mouse ───────────────────────────────────────────────
  _bindMouse(cvs) {
    cvs.addEventListener("mousedown", (e) => this._onMouseDown(e));
    cvs.addEventListener("mousemove", (e) => this._onMouseMove(e));
    cvs.addEventListener("mouseup", () => this._onMouseUp());
    cvs.addEventListener("mouseleave", () => {
      this._drag = null;
      cvs.style.cursor = "crosshair";
    });
  }

  _canvasPos(e) {
    const r = this.el.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _onMouseDown(e) {
    if (!this.img) return;
    const pos = this._canvasPos(e),
      s = this._scale;
    const cx = this.cropX * s,
      cy = this.cropY * s,
      cw = this.cropW * s,
      ch = this.cropH * s;
    const handle = this._hitHandle(pos.x, pos.y, cx, cy, cw, ch);
    if (handle) {
      this._drag = {
        type: "handle",
        handle,
        startMx: pos.x,
        startMy: pos.y,
        startCrop: { x: this.cropX, y: this.cropY, w: this.cropW, h: this.cropH },
      };
      return;
    }
    if (pos.x >= cx && pos.x <= cx + cw && pos.y >= cy && pos.y <= cy + ch) {
      this._drag = {
        type: "move",
        startMx: pos.x,
        startMy: pos.y,
        startCrop: { x: this.cropX, y: this.cropY, w: this.cropW, h: this.cropH },
      };
      return;
    }
    // Click outside → new crop
    this.cropX = Math.max(0, Math.min(pos.x / s, this.imgW));
    this.cropY = Math.max(0, Math.min(pos.y / s, this.imgH));
    this.cropW = 0;
    this.cropH = 0;
    this._drag = {
      type: "handle",
      handle: "br",
      startMx: pos.x,
      startMy: pos.y,
      startCrop: { x: this.cropX, y: this.cropY, w: 0, h: 0 },
    };
  }

  _onMouseMove(e) {
    if (!this.img) return;
    const pos = this._canvasPos(e),
      s = this._scale;
    if (this._drag) {
      const dx = (pos.x - this._drag.startMx) / s,
        dy = (pos.y - this._drag.startMy) / s;
      const sc = this._drag.startCrop;
      if (this._drag.type === "move") {
        this.cropX = Math.max(0, Math.min(sc.x + dx, this.imgW - sc.w));
        this.cropY = Math.max(0, Math.min(sc.y + dy, this.imgH - sc.h));
      } else {
        this._resizeByHandle(this._drag.handle, dx, dy, sc);
      }
      this._applyConstraints();
      this._draw();
      this._updateInfo();
      return;
    }
    // Hover cursor
    const cx = this.cropX * s,
      cy = this.cropY * s,
      cw = this.cropW * s,
      ch = this.cropH * s;
    const handle = this._hitHandle(pos.x, pos.y, cx, cy, cw, ch);
    if (handle) this.el.canvas.style.cursor = this._handleCursor(handle);
    else if (pos.x >= cx && pos.x <= cx + cw && pos.y >= cy && pos.y <= cy + ch) this.el.canvas.style.cursor = "move";
    else this.el.canvas.style.cursor = "crosshair";
  }

  _onMouseUp() {
    if (!this._drag) return;
    if (this.cropW < 0) {
      this.cropX += this.cropW;
      this.cropW = -this.cropW;
    }
    if (this.cropH < 0) {
      this.cropY += this.cropH;
      this.cropH = -this.cropH;
    }
    if (this.cropW < 2 || this.cropH < 2) {
      this._drag = null;
      this._resetCrop();
      return;
    }
    // Final snap enforcement — ensures values are always clean after drag
    const snap = SNAPS[this.snapIdx].val;
    const ratio = this._getActiveRatio();
    if (snap > 1 || ratio > 0) {
      const { w, h } = this._computeWH(this.cropW, ratio, snap);
      // Keep the anchor edge (don't re-center, adjust from the dragged edge)
      if (this._drag.handle) {
        const handle = this._drag.handle;
        if (handle.includes("l")) this.cropX = this.cropX + this.cropW - w;
        if (handle.includes("t")) this.cropY = this.cropY + this.cropH - h;
      }
      this.cropW = w;
      this.cropH = h;
    }
    this._applyConstraints();
    this._drag = null;
    this._draw();
    this._updateInfo();
  }

  _hitHandle(mx, my, cx, cy, cw, ch) {
    const handles = this._getHandlePositions(cx, cy, cw, ch);
    const cThr = 22,
      eThr = 16;
    for (const h of handles) {
      if (h.id.length === 2 && Math.abs(mx - h.x) <= cThr && Math.abs(my - h.y) <= cThr) return h.id;
    }
    for (const h of handles) {
      if (h.id.length === 1 && Math.abs(mx - h.x) <= eThr && Math.abs(my - h.y) <= eThr) return h.id;
    }
    const d = 8;
    if (my >= cy - d && my <= cy + ch + d) {
      if (Math.abs(mx - cx) <= d) return "l";
      if (Math.abs(mx - (cx + cw)) <= d) return "r";
    }
    if (mx >= cx - d && mx <= cx + cw + d) {
      if (Math.abs(my - cy) <= d) return "t";
      if (Math.abs(my - (cy + ch)) <= d) return "b";
    }
    return null;
  }

  _handleCursor(id) {
    return (
      {
        tl: "nwse-resize",
        br: "nwse-resize",
        tr: "nesw-resize",
        bl: "nesw-resize",
        t: "ns-resize",
        b: "ns-resize",
        l: "ew-resize",
        r: "ew-resize",
      }[id] || "default"
    );
  }

  _resizeByHandle(handle, dx, dy, sc) {
    const ratio = this._getActiveRatio();
    const snap = SNAPS[this.snapIdx].val;
    let nx = sc.x,
      ny = sc.y,
      nw = sc.w,
      nh = sc.h;
    const moveL = handle.includes("l"),
      moveR = handle.includes("r");
    const moveT = handle.includes("t"),
      moveB = handle.includes("b");
    if (moveL) {
      nx = sc.x + dx;
      nw = sc.w - dx;
    }
    if (moveR) {
      nw = sc.w + dx;
    }
    if (moveT) {
      ny = sc.y + dy;
      nh = sc.h - dy;
    }
    if (moveB) {
      nh = sc.h + dy;
    }

    // Snap W and H to grid
    if (snap > 1) {
      nw = this._snapVal(Math.abs(nw), snap) * (nw >= 0 ? 1 : -1);
      nh = this._snapVal(Math.abs(nh), snap) * (nh >= 0 ? 1 : -1);
      // Recompute position for left/top edge moves
      if (moveL) nx = sc.x + sc.w - Math.abs(nw);
      if (moveT) ny = sc.y + sc.h - Math.abs(nh);
    }

    // Apply ratio
    if (ratio > 0 && handle.length === 2) {
      const absW = Math.abs(nw);
      let absH = snap > 1 ? this._snapVal(absW / ratio, snap) : absW / ratio;
      nh = nw >= 0 ? absH : -absH;
      if (moveT) ny = sc.y + sc.h - absH;
    }
    if (ratio > 0 && handle.length === 1) {
      if (moveL || moveR) {
        nh = snap > 1 ? this._snapVal(Math.abs(nw) / ratio, snap) : Math.abs(nw) / ratio;
        ny = sc.y + (sc.h - nh) / 2;
      } else {
        nw = snap > 1 ? this._snapVal(Math.abs(nh) * ratio, snap) : Math.abs(nh) * ratio;
        nx = sc.x + (sc.w - nw) / 2;
      }
    }

    // Clamp to image bounds
    if (nx < 0) {
      nw += nx;
      nx = 0;
    }
    if (ny < 0) {
      nh += ny;
      ny = 0;
    }
    if (nx + nw > this.imgW) nw = this.imgW - nx;
    if (ny + nh > this.imgH) nh = this.imgH - ny;
    this.cropX = nx;
    this.cropY = ny;
    this.cropW = nw;
    this.cropH = nh;
  }

  // ─── Ratio & Snap ────────────────────────────────────────

  // Returns W/H ratio, or 0 for free
  _getActiveRatio() {
    const r = RATIOS[this.ratioIdx];
    if (!r || r.w === 0) return 0;
    return r.w / r.h;
  }

  // Snap a single value to nearest multiple of snap (min = snap)
  _snapVal(v, snap) {
    if (snap <= 1) return Math.round(v);
    return Math.max(snap, Math.round(v / snap) * snap);
  }

  // Given a target W, compute {w, h} that satisfies ratio + snap + image bounds.
  // Returns the best valid pair, or null if impossible.
  _computeWH(targetW, ratio, snap) {
    let w = snap > 1 ? this._snapVal(targetW, snap) : Math.round(targetW);
    w = Math.max(snap > 1 ? snap : 1, Math.min(w, this.imgW));
    let h;
    if (ratio > 0) {
      h = snap > 1 ? this._snapVal(w / ratio, snap) : Math.round(w / ratio);
      // If h doesn't fit, reduce w step by step
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
  }

  // Given a target H, compute {w, h} that satisfies ratio + snap + image bounds.
  _computeWHfromH(targetH, ratio, snap) {
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
  }

  _setCropCentered(nw, nh) {
    const ccx = this.cropX + this.cropW / 2;
    const ccy = this.cropY + this.cropH / 2;
    this.cropW = nw;
    this.cropH = nh;
    this.cropX = ccx - nw / 2;
    this.cropY = ccy - nh / 2;
    this._clampPosition();
  }

  _clampPosition() {
    if (this.cropX < 0) this.cropX = 0;
    if (this.cropY < 0) this.cropY = 0;
    if (this.cropX + this.cropW > this.imgW) this.cropX = this.imgW - this.cropW;
    if (this.cropY + this.cropH > this.imgH) this.cropY = this.imgH - this.cropH;
  }

  // Called when user picks a ratio preset
  _applyRatio() {
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
  }

  // Swap: literally swap W and H, then fit to image bounds + snap
  _swapRatio() {
    if (!this.img) return;
    const oldW = Math.round(this.cropW),
      oldH = Math.round(this.cropH);
    const r = RATIOS[this.ratioIdx];
    const snap = SNAPS[this.snapIdx].val;

    if (r && r.w > 0) {
      // Find the inverse ratio in RATIOS list (e.g. 4:3 → 3:4)
      const invIdx = RATIOS.findIndex((p) => p.w === r.h && p.h === r.w);
      if (invIdx >= 0) {
        // Switch to the inverse ratio preset
        this.ratioIdx = invIdx;
        this._updateRatioPills();
        const newRatio = this._getActiveRatio();
        // Compute new size: use oldH as target W
        const result = this._computeWH(oldH, newRatio, snap);
        this._setCropCentered(result.w, result.h);
      } else {
        // No inverse preset (e.g. 21:9 has no 9:21) — just swap dimensions directly
        const invRatio = r.h / r.w;
        const result = this._computeWH(oldH, invRatio, snap);
        this._setCropCentered(result.w, result.h);
      }
    } else {
      // Free ratio: just swap W and H
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
    this._setStatus(`Swapped → ${Math.round(this.cropW)}×${Math.round(this.cropH)}`);
  }

  _applySnap() {
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
  }

  _applyConstraints() {
    if (this.cropX < 0) this.cropX = 0;
    if (this.cropY < 0) this.cropY = 0;
    if (this.cropW > this.imgW) this.cropW = this.imgW;
    if (this.cropH > this.imgH) this.cropH = this.imgH;
    if (this.cropX + this.cropW > this.imgW) this.cropX = this.imgW - this.cropW;
    if (this.cropY + this.cropH > this.imgH) this.cropY = this.imgH - this.cropH;
  }

  _resetCrop() {
    if (!this.img) return;
    this.ratioIdx = 0;
    this.snapIdx = 0;
    this._updateRatioPills();
    this._updateSnapPills();
    this.cropX = 0;
    this.cropY = 0;
    this.cropW = this.imgW;
    this.cropH = this.imgH;
    this._fitCanvas();
    this._draw();
    this._updateInfo();
    this._setStatus("Crop reset to full image");
  }

  // ─── Info & Sliders ──────────────────────────────────────
  _updateInfo() {
    if (!this.img) {
      this.el.info.innerHTML = "No image loaded";
      return;
    }
    const cw = Math.round(Math.abs(this.cropW)),
      ch = Math.round(Math.abs(this.cropH));
    const cx = Math.round(Math.max(0, this.cropX)),
      cy = Math.round(Math.max(0, this.cropY));
    const r = RATIOS[this.ratioIdx];
    const rLabel = r.w === 0 ? "Free" : r.label;
    this.el.info.innerHTML =
      `<b>Original:</b> ${this.imgW}×${this.imgH}<br>` +
      `<b>Ratio:</b> ${rLabel}<br>` +
      `<b>Snap:</b> ${SNAPS[this.snapIdx].label}`;

    // Update sliders
    this._updatingSliders = true;
    const ratio = this._getActiveRatio();
    let maxW = this.imgW,
      maxH = this.imgH;
    if (ratio > 0) {
      maxW = Math.min(this.imgW, Math.floor(this.imgH * ratio));
      maxH = Math.min(this.imgH, Math.floor(this.imgW / ratio));
    }
    this._setSlider(this.el.sliderW, cw, 1, maxW);
    this._setSlider(this.el.sliderH, ch, 1, maxH);
    this._setSlider(this.el.sliderX, cx, 0, Math.max(0, this.imgW - cw));
    this._setSlider(this.el.sliderY, cy, 0, Math.max(0, this.imgH - ch));
    this._updatingSliders = false;
  }

  _setSlider(s, val, min, max) {
    s.slider.min = min;
    s.slider.max = max;
    s.slider.value = val;
    s.num.min = min;
    s.num.max = max;
    s.num.value = val;
  }

  _onSliderChange(key) {
    if (this._updatingSliders || !this.img) return;
    const ratio = this._getActiveRatio();
    const snap = SNAPS[this.snapIdx].val;

    if (key === "w" || key === "h") {
      let nw, nh;
      if (key === "w") {
        const target = parseInt(this.el.sliderW.num.value) || 1;
        const result = this._computeWH(target, ratio, snap);
        nw = result.w;
        nh = result.h;
      } else {
        const target = parseInt(this.el.sliderH.num.value) || 1;
        const result = this._computeWHfromH(target, ratio, snap);
        nw = result.w;
        nh = result.h;
      }
      this._setCropCentered(nw, nh);
    } else {
      const nx = parseInt(this.el.sliderX.num.value) || 0;
      const ny = parseInt(this.el.sliderY.num.value) || 0;
      this.cropX = Math.max(0, Math.min(nx, this.imgW - this.cropW));
      this.cropY = Math.max(0, Math.min(ny, this.imgH - this.cropH));
    }
    this._applyConstraints();
    this._draw();
    this._updateInfo();
  }

  // ─── Keyboard ────────────────────────────────────────────
  _bindKeys() {
    this._keyHandler = (e) => {
      // Block ALL keyboard events from reaching ComfyUI while crop editor is open
      e.stopPropagation();
      e.stopImmediatePropagation();
      const ae = document.activeElement;
      if (
        (ae?.tagName === "INPUT" || ae?.tagName === "TEXTAREA" || ae?.tagName === "SELECT") &&
        !ae?.dataset?.pixaromaTrap
      )
        return;
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;

      if (key === "escape") {
        this._close();
        return;
      }
      if (key === "r" && !ctrl) {
        e.preventDefault();
        this._resetCrop();
        return;
      }
      if (key === "x" && !ctrl) {
        e.preventDefault();
        this._swapRatio();
        return;
      }
      if (key === "f" && !ctrl) {
        e.preventDefault();
        this.ratioIdx = 0;
        this._updateRatioPills();
        this._draw();
        this._updateInfo();
        return;
      }
      if (ctrl && key === "s") {
        e.preventDefault();
        this._save();
        return;
      }
    };
    // Capture + keydown/keyup/keypress to block everything
    this._keyBlocker = (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", this._keyHandler, { capture: true });
    window.addEventListener("keyup", this._keyBlocker, { capture: true });
    window.addEventListener("keypress", this._keyBlocker, { capture: true });
  }
  _unbindKeys() {
    if (this._keyHandler) window.removeEventListener("keydown", this._keyHandler, { capture: true });
    if (this._keyBlocker) {
      window.removeEventListener("keyup", this._keyBlocker, { capture: true });
      window.removeEventListener("keypress", this._keyBlocker, { capture: true });
    }
  }

  _toggleHelp() {
    const h = this.el.help;
    h.style.display = h.style.display === "block" ? "none" : "block";
  }
  _setStatus(msg) {
    if (this.el.status) this.el.status.textContent = msg;
  }

  // ─── Save ────────────────────────────────────────────────
  async _save() {
    if (!this.img) {
      this._setStatus("No image to save");
      return;
    }
    this.el.saveBtn.disabled = true;
    this.el.saveBtn.textContent = "⏳ Saving...";
    this._setStatus("⏳ Saving...");
    try {
      // Upload source image now (deferred from load so cancel doesn't corrupt state)
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
      this._setStatus("✅ Saved!");
      if (this.onSave) this.onSave(JSON.stringify(meta), dataURL);
      setTimeout(() => this._close(), 500);
    } catch (err) {
      console.error("[Crop] Save error:", err);
      this._setStatus("❌ Save failed: " + err.message);
      this.el.saveBtn.disabled = false;
      this.el.saveBtn.textContent = "Save";
    }
  }
}
