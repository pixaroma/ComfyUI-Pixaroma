// ============================================================
// Pixaroma Image Crop Editor — Core + Full UI  v3
// Uses pixaroma_editor_framework for consistent layout/styling
// ============================================================
import { installFocusTrap } from "./pixaroma_shared.js";
import {
  BRAND,
  createEditorLayout,
  createPanel,
  createButton,
  createPillGrid,
  createSliderRow,
  createInfo,
  createCanvasSettings,
  createCanvasFrame,
  createCanvasToolbar,
} from "./pixaroma_editor_framework.js";

const RATIOS = [
    { label: "Free",  w: 0,  h: 0  },
    { label: "1:1",   w: 1,  h: 1  },
    { label: "4:3",   w: 4,  h: 3  },
    { label: "3:2",   w: 3,  h: 2  },
    { label: "16:9",  w: 16, h: 9  },
    { label: "4:5",   w: 4,  h: 5  },
    { label: "3:4",   w: 3,  h: 4  },
    { label: "2:3",   w: 2,  h: 3  },
    { label: "9:16",  w: 9,  h: 16 },
    { label: "5:4",   w: 5,  h: 4  },
];

const SNAPS = [
    { label: "None", val: 1  },
    { label: "×8",   val: 8  },
    { label: "×16",  val: 16 },
    { label: "×32",  val: 32 },
    { label: "×64",  val: 64 },
];

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
export class CropEditor {
    constructor() {
        this.onSave = null;
        this.onClose = null;
        this.el = {};
        this.layout = null;
        this.img = null;
        this.imgW = 0;
        this.imgH = 0;
        this.projectId = null;
        this.cropX = 0; this.cropY = 0; this.cropW = 0; this.cropH = 0;
        this.ratioIdx = 0;
        this.snapIdx = 0;
        this._drag = null;
        this._scale = 1;
        this._srcPath = "";
    }

    // ─── Open / Close ────────────────────────────────────────
    open(jsonStr) {
        this._buildUI();
        this.layout.mount();

        let data = {};
        try { data = jsonStr && jsonStr !== "{}" ? JSON.parse(jsonStr) : {}; } catch (e) {}

        this.projectId = data.project_id || ("crop_" + Date.now());
        this._srcPath = data.src_path || "";

        if (this._srcPath) {
            const fn = this._srcPath.split(/[\\/]/).pop();
            const url = `/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
            this._loadImageFromURL(url, () => {
                if (data.crop_x != null) {
                    this.cropX = data.crop_x; this.cropY = data.crop_y;
                    this.cropW = data.crop_w; this.cropH = data.crop_h;
                }
                if (data.ratio_idx != null) { this.ratioIdx = data.ratio_idx; this._canvasSettings.setRatio(data.ratio_idx); }
                if (data.snap_idx != null) { this.snapIdx = data.snap_idx; this._snapGrid.setActive(data.snap_idx); }
                this._draw(); this._updateInfo();
            });
        }
        this._bindKeys();
    }

    _close() {
        this.layout?.unmount();
        this._unbindKeys();
        if (this.onClose) this.onClose();
    }

    // ─── Build UI ────────────────────────────────────────────
    _buildUI() {
        const layout = createEditorLayout({
            editorName: "Image Crop",
            editorId: "pixaroma-crop-editor",
            showUndoRedo: false,
            showStatusBar: true,
            showZoomBar: false,
            onSave: () => this._save(),
            onClose: () => this._close(),
            helpContent: `
                <b>Load image:</b> Click <kbd>Load Image</kbd> in sidebar<br>
                <b>Drag crop region:</b> Click & drag inside the crop area<br>
                <b>Resize crop:</b> Drag orange corner/edge handles<br>
                <b>Reset crop:</b> Press <kbd>R</kbd> or click Reset<br>
                <b>Swap ratio:</b> Press <kbd>X</kbd> to flip W↔H ratio<br>
                <b>Free ratio:</b> Press <kbd>F</kbd><br>
                <b>Save:</b> <kbd>Ctrl+S</kbd><br>
                <b>Close:</b> <kbd>Escape</kbd>
            `,
        });
        this.layout = layout;
        layout.onCleanup = () => this._unbindKeys();
        this.el.overlay = layout.overlay;
        this.el.workspace = layout.workspace;
        this.el.status = layout.statusText;
        this.el.saveBtn = layout.saveBtn;

        // ── Populate sidebars ──
        this._buildLeftSidebar(layout.leftSidebar);
        this._buildRightSidebar(layout.rightSidebar, layout.sidebarFooter);

        // ── Canvas in workspace ──
        const wrap = document.createElement("div");
        wrap.style.cssText = "position:relative;display:inline-block;";
        this.el.canvasWrap = wrap;

        const cvs = document.createElement("canvas");
        cvs.width = 100; cvs.height = 100;
        this.el.canvas = cvs; this.el.ctx = cvs.getContext("2d");
        wrap.appendChild(cvs);
        layout.workspace.appendChild(wrap);

        // Canvas frame overlay (orange border + gray masks + dimension label)
        this._canvasFrame = createCanvasFrame(layout.workspace);

        this._bindMouse(cvs);

        // Enable drag & drop on workspace
        if (this._canvasToolbar) this._canvasToolbar.setupDropZone(layout.workspace);
    }

    _buildLeftSidebar(sidebar) {
        // ── Canvas Settings (FIRST panel — unified ratio/size component) ──
        this._canvasSettings = createCanvasSettings({
            width: this.imgW || 1024,
            height: this.imgH || 1024,
            ratioIndex: 0,
            onChange: ({ width, height, ratioIndex }) => {
                this.ratioIdx = ratioIndex;
                this.ratioSwapped = false;
                if (!this.img) return;
                // Clamp to image bounds
                const nw = Math.min(width, this.imgW);
                const nh = Math.min(height, this.imgH);
                this._setCropCentered(nw, nh);
                this._applyConstraints();
                this._draw();
                this._updateInfo();
                // Sync back if clamped
                this._canvasSettings.setSize(Math.round(this.cropW), Math.round(this.cropH));
            },
        });
        sidebar.appendChild(this._canvasSettings.el);

        // ── Canvas Toolbar (Load Image) ──
        this._canvasToolbar = createCanvasToolbar({
            onAddImage: (file) => {
                const reader = new FileReader();
                reader.onload = (ev) => this._loadImageFromDataURL(ev.target.result, file.name);
                reader.readAsDataURL(file);
            },
            showBgColor: false,
            showClear: false,
            addImageLabel: "Load Image",
            onReset: () => {
                this.img = null; this.imgW = 0; this.imgH = 0;
                this.cropX = 0; this.cropY = 0; this.cropW = 0; this.cropH = 0;
                this.ratioIdx = 0; this.snapIdx = 0;
                this._canvasSettings.setRatio(0);
                this._canvasSettings.setSize(1024, 1024);
                this._snapGrid.setActive(0);
                if (this.el.canvas) { this.el.ctx.clearRect(0, 0, this.el.canvas.width, this.el.canvas.height); }
                this._updateInfo();
                this._setStatus("Reset to default");
            },
        });
        sidebar.appendChild(this._canvasToolbar.el);
    }

    _buildRightSidebar(sidebar, footer) {
        // ── Pixel Snap ──
        const secSnap = createPanel("Pixel Snap");
        this._snapGrid = createPillGrid(
            SNAPS.map((s, i) => ({ label: s.label, value: i })),
            5,
            (idx) => { this.snapIdx = idx; this._applySnap(); },
            { activeValue: 0 },
        );
        secSnap.content.appendChild(this._snapGrid.el);
        sidebar.insertBefore(secSnap.el, footer);

        // ── Crop Size sliders ──
        const secSize = createPanel("Crop Size");
        this.el.sliderW = createSliderRow("W", 1, 4096, 1024, () => this._onSliderChange("w"));
        this.el.sliderH = createSliderRow("H", 1, 4096, 1024, () => this._onSliderChange("h"));
        this.el.sliderX = createSliderRow("X", 0, 4096, 0, () => this._onSliderChange("x"));
        this.el.sliderY = createSliderRow("Y", 0, 4096, 0, () => this._onSliderChange("y"));
        secSize.content.append(this.el.sliderW.el, this.el.sliderH.el, this.el.sliderX.el, this.el.sliderY.el);
        sidebar.insertBefore(secSize.el, footer);

        // ── Info ──
        const secInfo = createPanel("Info");
        this._infoBlock = createInfo("No image loaded");
        this.el.info = this._infoBlock.el;
        secInfo.content.appendChild(this._infoBlock.el);
        sidebar.insertBefore(secInfo.el, footer);

        // ── Actions ──
        const secAct = createPanel("Actions");
        secAct.content.appendChild(createButton("↺ Reset Crop", { variant: "full", onClick: () => this._resetCrop() }));
        sidebar.insertBefore(secAct.el, footer);
    }

    // ─── Load Image ──────────────────────────────────────────
    _promptLoadImage() {
        const input = document.createElement("input"); input.type = "file"; input.accept = "image/*";
        input.onchange = () => {
            const file = input.files?.[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => this._loadImageFromDataURL(ev.target.result, file.name);
            reader.readAsDataURL(file);
        };
        input.click();
    }

    _loadImageFromDataURL(dataURL, filename) {
        const img = new Image();
        img.onload = () => {
            this.img = img; this.imgW = img.naturalWidth; this.imgH = img.naturalHeight;
            this._pendingSrcDataURL = dataURL;
            if (this._canvasSettings) this._canvasSettings.setSize(this.imgW, this.imgH);
            this._resetCrop();
            this._setStatus(`Loaded: ${this.imgW}×${this.imgH}`);
        };
        img.src = dataURL;
    }

    _loadImageFromURL(url, onDone) {
        const img = new Image(); img.crossOrigin = "anonymous";
        img.onload = () => {
            this.img = img; this.imgW = img.naturalWidth; this.imgH = img.naturalHeight;
            this._fitCanvas(); this._draw(); this._updateInfo();
            if (onDone) onDone();
        };
        img.onerror = () => console.warn("[Crop] Failed to load:", url);
        img.src = url;
    }

    async _uploadSourceImage(dataURL) {
        try {
            const { api } = await import("/scripts/api.js");
            const res = await api.fetchApi("/pixaroma/api/crop/upload_src", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ project_id: this.projectId, image: dataURL }),
            });
            const data = await res.json();
            this._srcPath = data.path || "";
        } catch (e) { console.warn("[Crop] Source upload failed:", e); }
    }

    // ─── Canvas fit & draw ───────────────────────────────────
    _fitCanvas() {
        if (!this.img) return;
        const ws = this.el.workspace;
        const pad = 40, maxW = ws.clientWidth - pad * 2, maxH = ws.clientHeight - pad * 2;
        if (maxW <= 0 || maxH <= 0) return;
        const imgAsp = this.imgW / this.imgH;
        let dispW, dispH;
        if (maxW / maxH > imgAsp) { dispH = maxH; dispW = dispH * imgAsp; }
        else { dispW = maxW; dispH = dispW / imgAsp; }
        this._scale = dispW / this.imgW;
        const cvs = this.el.canvas;
        cvs.width = Math.round(dispW); cvs.height = Math.round(dispH);
        cvs.style.cursor = "crosshair";
        if (this._canvasFrame) this._canvasFrame.update(this.imgW, this.imgH);
    }

    _draw() {
        if (!this.img) return;
        this._fitCanvas();
        const ctx = this.el.ctx, cvs = this.el.canvas, s = this._scale;
        ctx.drawImage(this.img, 0, 0, cvs.width, cvs.height);

        // Dark overlay outside crop
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        const cx = this.cropX * s, cy = this.cropY * s, cw = this.cropW * s, ch = this.cropH * s;
        ctx.fillRect(0, 0, cvs.width, cy);
        ctx.fillRect(0, cy + ch, cvs.width, cvs.height - cy - ch);
        ctx.fillRect(0, cy, cx, ch);
        ctx.fillRect(cx + cw, cy, cvs.width - cx - cw, ch);

        // Crop border
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
        ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);

        // Rule of thirds
        ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 0.5;
        for (let i = 1; i <= 2; i++) {
            const gx = cx + (cw * i) / 3, gy = cy + (ch * i) / 3;
            ctx.beginPath(); ctx.moveTo(gx, cy); ctx.lineTo(gx, cy + ch); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx, gy); ctx.lineTo(cx + cw, gy); ctx.stroke();
        }

        // Handles
        this._drawHandles(ctx, cx, cy, cw, ch);

        // Dimension label
        if (cw > 80 && ch > 30) {
            const label = `${Math.round(this.cropW)} × ${Math.round(this.cropH)}`;
            ctx.font = "bold 11px 'Segoe UI', sans-serif";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            const tw = ctx.measureText(label).width + 12;
            ctx.fillStyle = "rgba(0,0,0,0.7)";
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(cx + cw / 2 - tw / 2, cy + ch / 2 - 10, tw, 20, 4);
            else ctx.rect(cx + cw / 2 - tw / 2, cy + ch / 2 - 10, tw, 20);
            ctx.fill();
            ctx.fillStyle = "#fff"; ctx.fillText(label, cx + cw / 2, cy + ch / 2);
        }
    }

    _drawHandles(ctx, cx, cy, cw, ch) {
        const sz = 10;
        const positions = this._getHandleDrawPositions(cx, cy, cw, ch, sz);
        for (const h of positions) {
            ctx.fillStyle = BRAND;
            ctx.fillRect(h.dx, h.dy, sz, sz);
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
            ctx.strokeRect(h.dx, h.dy, sz, sz);
        }
    }

    _getHandleDrawPositions(cx, cy, cw, ch, sz) {
        const s = sz;
        return [
            { id: "tl", dx: cx,              dy: cy               },
            { id: "tr", dx: cx + cw - s,     dy: cy               },
            { id: "bl", dx: cx,              dy: cy + ch - s      },
            { id: "br", dx: cx + cw - s,     dy: cy + ch - s      },
            { id: "t",  dx: cx + cw/2 - s/2, dy: cy               },
            { id: "b",  dx: cx + cw/2 - s/2, dy: cy + ch - s      },
            { id: "l",  dx: cx,              dy: cy + ch/2 - s/2  },
            { id: "r",  dx: cx + cw - s,     dy: cy + ch/2 - s/2  },
        ];
    }

    _getHandlePositions(cx, cy, cw, ch) {
        return [
            { id: "tl", x: cx,          y: cy          },
            { id: "tr", x: cx + cw,     y: cy          },
            { id: "bl", x: cx,          y: cy + ch     },
            { id: "br", x: cx + cw,     y: cy + ch     },
            { id: "t",  x: cx + cw / 2, y: cy          },
            { id: "b",  x: cx + cw / 2, y: cy + ch     },
            { id: "l",  x: cx,          y: cy + ch / 2 },
            { id: "r",  x: cx + cw,     y: cy + ch / 2 },
        ];
    }

    // ─── Mouse ───────────────────────────────────────────────
    _bindMouse(cvs) {
        cvs.addEventListener("mousedown", (e) => this._onMouseDown(e));
        cvs.addEventListener("mousemove", (e) => this._onMouseMove(e));
        cvs.addEventListener("mouseup",   ()  => this._onMouseUp());
        cvs.addEventListener("mouseleave", () => { this._drag = null; cvs.style.cursor = "crosshair"; });
    }

    _canvasPos(e) { const r = this.el.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

    _onMouseDown(e) {
        if (!this.img) return;
        const pos = this._canvasPos(e), s = this._scale;
        const cx = this.cropX * s, cy = this.cropY * s, cw = this.cropW * s, ch = this.cropH * s;
        const handle = this._hitHandle(pos.x, pos.y, cx, cy, cw, ch);
        if (handle) {
            this._drag = { type: "handle", handle, startMx: pos.x, startMy: pos.y, startCrop: { x: this.cropX, y: this.cropY, w: this.cropW, h: this.cropH } };
            return;
        }
        if (pos.x >= cx && pos.x <= cx + cw && pos.y >= cy && pos.y <= cy + ch) {
            this._drag = { type: "move", startMx: pos.x, startMy: pos.y, startCrop: { x: this.cropX, y: this.cropY, w: this.cropW, h: this.cropH } };
            return;
        }
        this.cropX = Math.max(0, Math.min(pos.x / s, this.imgW));
        this.cropY = Math.max(0, Math.min(pos.y / s, this.imgH));
        this.cropW = 0; this.cropH = 0;
        this._drag = { type: "handle", handle: "br", startMx: pos.x, startMy: pos.y, startCrop: { x: this.cropX, y: this.cropY, w: 0, h: 0 } };
    }

    _onMouseMove(e) {
        if (!this.img) return;
        const pos = this._canvasPos(e), s = this._scale;
        if (this._drag) {
            const dx = (pos.x - this._drag.startMx) / s, dy = (pos.y - this._drag.startMy) / s;
            const sc = this._drag.startCrop;
            if (this._drag.type === "move") {
                this.cropX = Math.max(0, Math.min(sc.x + dx, this.imgW - sc.w));
                this.cropY = Math.max(0, Math.min(sc.y + dy, this.imgH - sc.h));
            } else {
                this._resizeByHandle(this._drag.handle, dx, dy, sc);
            }
            this._applyConstraints(); this._draw(); this._updateInfo();
            return;
        }
        const cx = this.cropX * s, cy = this.cropY * s, cw = this.cropW * s, ch = this.cropH * s;
        const handle = this._hitHandle(pos.x, pos.y, cx, cy, cw, ch);
        if (handle) this.el.canvas.style.cursor = this._handleCursor(handle);
        else if (pos.x >= cx && pos.x <= cx + cw && pos.y >= cy && pos.y <= cy + ch) this.el.canvas.style.cursor = "move";
        else this.el.canvas.style.cursor = "crosshair";
    }

    _onMouseUp() {
        if (!this._drag) return;
        if (this.cropW < 0) { this.cropX += this.cropW; this.cropW = -this.cropW; }
        if (this.cropH < 0) { this.cropY += this.cropH; this.cropH = -this.cropH; }
        if (this.cropW < 2 || this.cropH < 2) { this._drag = null; this._resetCrop(); return; }
        const snap = SNAPS[this.snapIdx].val;
        const ratio = this._getActiveRatio();
        if (snap > 1 || ratio > 0) {
            const { w, h } = this._computeWH(this.cropW, ratio, snap);
            if (this._drag.handle) {
                const handle = this._drag.handle;
                if (handle.includes("l")) this.cropX = this.cropX + this.cropW - w;
                if (handle.includes("t")) this.cropY = this.cropY + this.cropH - h;
            }
            this.cropW = w; this.cropH = h;
        }
        this._applyConstraints(); this._drag = null; this._draw(); this._updateInfo();
    }

    _hitHandle(mx, my, cx, cy, cw, ch) {
        const handles = this._getHandlePositions(cx, cy, cw, ch);
        const cThr = 22, eThr = 16;
        for (const h of handles) { if (h.id.length === 2 && Math.abs(mx - h.x) <= cThr && Math.abs(my - h.y) <= cThr) return h.id; }
        for (const h of handles) { if (h.id.length === 1 && Math.abs(mx - h.x) <= eThr && Math.abs(my - h.y) <= eThr) return h.id; }
        const d = 8;
        if (my >= cy - d && my <= cy + ch + d) { if (Math.abs(mx - cx) <= d) return "l"; if (Math.abs(mx - (cx + cw)) <= d) return "r"; }
        if (mx >= cx - d && mx <= cx + cw + d) { if (Math.abs(my - cy) <= d) return "t"; if (Math.abs(my - (cy + ch)) <= d) return "b"; }
        return null;
    }

    _handleCursor(id) { return { tl:"nwse-resize", br:"nwse-resize", tr:"nesw-resize", bl:"nesw-resize", t:"ns-resize", b:"ns-resize", l:"ew-resize", r:"ew-resize" }[id] || "default"; }

    _resizeByHandle(handle, dx, dy, sc) {
        const ratio = this._getActiveRatio();
        const snap = SNAPS[this.snapIdx].val;
        let nx = sc.x, ny = sc.y, nw = sc.w, nh = sc.h;
        const moveL = handle.includes("l"), moveR = handle.includes("r");
        const moveT = handle.includes("t"), moveB = handle.includes("b");
        if (moveL) { nx = sc.x + dx; nw = sc.w - dx; }
        if (moveR) { nw = sc.w + dx; }
        if (moveT) { ny = sc.y + dy; nh = sc.h - dy; }
        if (moveB) { nh = sc.h + dy; }

        if (snap > 1) {
            nw = this._snapVal(Math.abs(nw), snap) * (nw >= 0 ? 1 : -1);
            nh = this._snapVal(Math.abs(nh), snap) * (nh >= 0 ? 1 : -1);
            if (moveL) nx = sc.x + sc.w - Math.abs(nw);
            if (moveT) ny = sc.y + sc.h - Math.abs(nh);
        }

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

        if (nx < 0) { nw += nx; nx = 0; }
        if (ny < 0) { nh += ny; ny = 0; }
        if (nx + nw > this.imgW) nw = this.imgW - nx;
        if (ny + nh > this.imgH) nh = this.imgH - ny;
        this.cropX = nx; this.cropY = ny; this.cropW = nw; this.cropH = nh;
    }

    // ─── Ratio & Snap ────────────────────────────────────────
    _getActiveRatio() {
        const r = RATIOS[this.ratioIdx];
        if (!r || r.w === 0) return 0;
        return r.w / r.h;
    }

    _snapVal(v, snap) {
        if (snap <= 1) return Math.round(v);
        return Math.max(snap, Math.round(v / snap) * snap);
    }

    _computeWH(targetW, ratio, snap) {
        let w = snap > 1 ? this._snapVal(targetW, snap) : Math.round(targetW);
        w = Math.max(snap > 1 ? snap : 1, Math.min(w, this.imgW));
        let h;
        if (ratio > 0) {
            h = snap > 1 ? this._snapVal(w / ratio, snap) : Math.round(w / ratio);
            while (h > this.imgH && w > (snap > 1 ? snap : 1)) {
                w -= (snap > 1 ? snap : 1);
                h = snap > 1 ? this._snapVal(w / ratio, snap) : Math.round(w / ratio);
            }
            h = Math.min(h, this.imgH);
        } else {
            h = snap > 1 ? this._snapVal(this.cropH, snap) : Math.round(this.cropH);
            h = Math.max(1, Math.min(h, this.imgH));
        }
        return { w, h };
    }

    _computeWHfromH(targetH, ratio, snap) {
        let h = snap > 1 ? this._snapVal(targetH, snap) : Math.round(targetH);
        h = Math.max(snap > 1 ? snap : 1, Math.min(h, this.imgH));
        let w;
        if (ratio > 0) {
            w = snap > 1 ? this._snapVal(h * ratio, snap) : Math.round(h * ratio);
            while (w > this.imgW && h > (snap > 1 ? snap : 1)) {
                h -= (snap > 1 ? snap : 1);
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
        this.cropW = nw; this.cropH = nh;
        this.cropX = ccx - nw / 2; this.cropY = ccy - nh / 2;
        this._clampPosition();
    }

    _clampPosition() {
        if (this.cropX < 0) this.cropX = 0;
        if (this.cropY < 0) this.cropY = 0;
        if (this.cropX + this.cropW > this.imgW) this.cropX = this.imgW - this.cropW;
        if (this.cropY + this.cropH > this.imgH) this.cropY = this.imgH - this.cropH;
    }

    _applyRatio() {
        if (!this.img) return;
        const ratio = this._getActiveRatio();
        if (ratio <= 0) { this._draw(); this._updateInfo(); return; }
        const snap = SNAPS[this.snapIdx].val;
        const { w, h } = this._computeWH(this.cropW || this.imgW, ratio, snap);
        this._setCropCentered(w, h);
        this._draw(); this._updateInfo();
    }

    _swapRatio() {
        if (!this.img) return;
        // Delegate to the shared canvas settings component — it updates ratioIdx internally
        this._canvasSettings.swap();
        // Sync local ratioIdx from the component
        this.ratioIdx = this._canvasSettings.getRatioIndex();

        const oldW = Math.round(this.cropW), oldH = Math.round(this.cropH);
        const r = RATIOS[this.ratioIdx];
        const snap = SNAPS[this.snapIdx].val;

        if (r && r.w > 0) {
            const newRatio = this._getActiveRatio();
            const result = this._computeWH(oldH, newRatio, snap);
            this._setCropCentered(result.w, result.h);
        } else {
            let nw = Math.min(oldH, this.imgW);
            let nh = Math.min(oldW, this.imgH);
            if (snap > 1) { nw = this._snapVal(nw, snap); nh = this._snapVal(nh, snap); }
            nw = Math.min(nw, this.imgW); nh = Math.min(nh, this.imgH);
            this._setCropCentered(nw, nh);
        }
        this._draw(); this._updateInfo();
        this._setStatus(`Swapped → ${Math.round(this.cropW)}×${Math.round(this.cropH)}`);
    }

    _applySnap() {
        if (!this.img) return;
        const ratio = this._getActiveRatio();
        const snap = SNAPS[this.snapIdx].val;
        if (snap <= 1) { this._draw(); this._updateInfo(); return; }
        const { w, h } = this._computeWH(this.cropW, ratio, snap);
        this._setCropCentered(w, h);
        this._draw(); this._updateInfo();
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
        this._canvasSettings.setRatio(0);
        this._canvasSettings.setSize(this.imgW, this.imgH);
        this._snapGrid.setActive(0);
        this.cropX = 0; this.cropY = 0; this.cropW = this.imgW; this.cropH = this.imgH;
        this._fitCanvas(); this._draw(); this._updateInfo(); this._setStatus("Crop reset to full image");
    }

    // ─── Info & Sliders ──────────────────────────────────────
    _updateInfo() {
        if (!this.img) { this._infoBlock.setHTML("No image loaded"); return; }
        const cw = Math.round(Math.abs(this.cropW)), ch = Math.round(Math.abs(this.cropH));
        const cx = Math.round(Math.max(0, this.cropX)), cy = Math.round(Math.max(0, this.cropY));
        const r = RATIOS[this.ratioIdx];
        const rLabel = r.w === 0 ? "Free" : r.label;
        this._infoBlock.setHTML(
            `<b>Original:</b> ${this.imgW}×${this.imgH}<br>` +
            `<b>Ratio:</b> ${rLabel}<br>` +
            `<b>Snap:</b> ${SNAPS[this.snapIdx].label}`
        );

        this._updatingSliders = true;
        const ratio = this._getActiveRatio();
        let maxW = this.imgW, maxH = this.imgH;
        if (ratio > 0) {
            maxW = Math.min(this.imgW, Math.floor(this.imgH * ratio));
            maxH = Math.min(this.imgH, Math.floor(this.imgW / ratio));
        }
        this.el.sliderW.setRange(1, maxW); this.el.sliderW.setValue(cw);
        this.el.sliderH.setRange(1, maxH); this.el.sliderH.setValue(ch);
        this.el.sliderX.setRange(0, Math.max(0, this.imgW - cw)); this.el.sliderX.setValue(cx);
        this.el.sliderY.setRange(0, Math.max(0, this.imgH - ch)); this.el.sliderY.setValue(cy);
        this._updatingSliders = false;
        // Sync canvas settings display with current crop dimensions
        if (this._canvasSettings) this._canvasSettings.setSize(cw, ch);
    }

    _onSliderChange(key) {
        if (this._updatingSliders || !this.img) return;
        const ratio = this._getActiveRatio();
        const snap = SNAPS[this.snapIdx].val;

        if (key === "w" || key === "h") {
            let nw, nh;
            if (key === "w") {
                const target = parseFloat(this.el.sliderW.numInput.value) || 1;
                const result = this._computeWH(target, ratio, snap);
                nw = result.w; nh = result.h;
            } else {
                const target = parseFloat(this.el.sliderH.numInput.value) || 1;
                const result = this._computeWHfromH(target, ratio, snap);
                nw = result.w; nh = result.h;
            }
            this._setCropCentered(nw, nh);
        } else {
            const nx = parseFloat(this.el.sliderX.numInput.value) || 0;
            const ny = parseFloat(this.el.sliderY.numInput.value) || 0;
            this.cropX = Math.max(0, Math.min(nx, this.imgW - this.cropW));
            this.cropY = Math.max(0, Math.min(ny, this.imgH - this.cropH));
        }
        this._applyConstraints(); this._draw(); this._updateInfo();
    }

    // ─── Keyboard ────────────────────────────────────────────
    _bindKeys() {
        this._keyHandler = (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            const ae = document.activeElement;
            if ((ae?.tagName === "INPUT" || ae?.tagName === "TEXTAREA" || ae?.tagName === "SELECT") && !ae?.dataset?.pixaromaTrap) return;
            const key = e.key.toLowerCase();
            const ctrl = e.ctrlKey || e.metaKey;

            if (key === "escape") { this._close(); return; }
            if (key === "r" && !ctrl) { e.preventDefault(); this._resetCrop(); return; }
            if (key === "x" && !ctrl) { e.preventDefault(); this._swapRatio(); return; }
            if (key === "f" && !ctrl) { e.preventDefault(); this.ratioIdx = 0; this._canvasSettings.setRatio(0); this._draw(); this._updateInfo(); return; }
            if (ctrl && key === "s") { e.preventDefault(); this._save(); return; }
        };
        this._keyBlocker = (e) => { e.stopPropagation(); e.stopImmediatePropagation(); };
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

    _setStatus(msg) { this.layout?.setStatus(msg); }

    // ─── Save ────────────────────────────────────────────────
    async _save() {
        if (!this.img) { this._setStatus("No image to save"); return; }
        this.layout.setSaving();
        try {
            if (this._pendingSrcDataURL) {
                await this._uploadSourceImage(this._pendingSrcDataURL);
                this._pendingSrcDataURL = null;
            }

            const cw = Math.round(Math.abs(this.cropW)), ch = Math.round(Math.abs(this.cropH));
            const cx = Math.round(Math.max(0, this.cropX)), cy = Math.round(Math.max(0, this.cropY));
            const outCvs = document.createElement("canvas"); outCvs.width = cw; outCvs.height = ch;
            outCvs.getContext("2d").drawImage(this.img, cx, cy, cw, ch, 0, 0, cw, ch);
            const dataURL = outCvs.toDataURL("image/png");

            let compositePath = "";
            try { const res = await CropAPI.saveComposite(this.projectId, dataURL); compositePath = res.composite_path || ""; }
            catch (e) { console.warn("[Crop] Composite save failed:", e); }

            const meta = {
                doc_w: cw, doc_h: ch, original_w: this.imgW, original_h: this.imgH,
                crop_x: cx, crop_y: cy, crop_w: cw, crop_h: ch,
                ratio_idx: this.ratioIdx, snap_idx: this.snapIdx,
                project_id: this.projectId, composite_path: compositePath, src_path: this._srcPath,
            };
            if (this.onSave) this.onSave(JSON.stringify(meta), dataURL);
            this.layout.setSaved();
        } catch (err) {
            console.error("[Crop] Save error:", err);
            this.layout.setSaveError("Save failed: " + err.message);
        }
    }
}
