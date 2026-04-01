import { app } from "/scripts/app.js";

const BRAND = "#f66744";
const MODES = ["Left Right", "Up Down", "Overlay", "Difference"];
const SLIDER_PAD = 50; // "Opacity" label width
const MODE_HINTS = [
    "↔  Hover image to slide left / right",
    "↕  Hover image to slide up / down",
    "",
    "Shows pixel differences between images",
];

// Layout constants
const BTN_GAP = 3;
const BTN_H = 18;
const BTN_W = 56;
const BTN_X = 80;       // start X (right of input labels)
const ROW1_Y = 10;
const ROW2_Y = 30;
const IMG_Y = 54;        // image area starts here
const INIT_W = 400;
const INIT_H = INIT_W + IMG_Y; // square preview area
const MIN_W = BTN_X + BTN_W * 4 + BTN_GAP * 3 + 6;
const MIN_H = IMG_Y + 100;

// Button rect helpers
function modeRect(i) { return { x: BTN_X + i * (BTN_W + BTN_GAP), y: ROW1_Y, w: BTN_W, h: BTN_H }; }
function hintRect() {
    return { x: BTN_X, y: ROW2_Y, w: BTN_W * 4 + BTN_GAP * 3, h: BTN_H };
}
function inside(pos, r) {
    return pos[0] >= r.x && pos[0] <= r.x + r.w && pos[1] >= r.y && pos[1] <= r.y + r.h;
}
function paintBtn(ctx, r, label, on) {
    ctx.fillStyle = on ? BRAND : "#2a2c2e";
    ctx.strokeStyle = on ? BRAND : "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, 3);
    else ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = on ? "#fff" : "#999";
    ctx.font = "9px 'Segoe UI',sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
}

app.registerExtension({
    name: "Pixaroma.Compare",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "PixaromaCompare") return;

        // ── Creation ─────────────────────────────────────────
        const _origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            _origCreated?.apply(this, arguments);
            this._cmpMode = 0;
            this._cmpSplitX = 0;
            this._cmpSplitY = 0;
            this._cmpOpacity = 0.5;
            this._cmpImg1 = null;
            this._cmpImg2 = null;
            this.size[0] = INIT_W;
            this.size[1] = INIT_H;
        };

        // ── Execution — DO NOT call origExecuted (it creates preview widgets that shift layout)
        nodeType.prototype.onExecuted = function (output) {
            // Suppress default preview
            this.imgs = null;

            if (!output?.images || output.images.length < 2) return;
            const load = (d, idx) => {
                const url = `/view?filename=${encodeURIComponent(d.filename)}&type=${encodeURIComponent(d.type)}&subfolder=${encodeURIComponent(d.subfolder || "")}&t=${Date.now()}`;
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => {
                    if (idx === 0) this._cmpImg1 = img; else this._cmpImg2 = img;
                    this.imgs = null; // keep suppressing
                    app.graph.setDirtyCanvas(true, true);
                };
                img.src = url;
            };
            load(output.images[0], 0);
            load(output.images[1], 1);
        };

        // Suppress default background image rendering
        nodeType.prototype.onDrawBackground = function () {
            if (this.imgs) this.imgs = null;
        };

        // ── Drawing ──────────────────────────────────────────
        const _origDraw = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            if (_origDraw) _origDraw.call(this, ctx);

            // Enforce min size
            if (this.size[0] < MIN_W) this.size[0] = MIN_W;
            if (this.size[1] < MIN_H) this.size[1] = MIN_H;
            const w = this.size[0], h = this.size[1];

            // ── Row 1: mode buttons ──
            ctx.save();
            for (let i = 0; i < 4; i++) paintBtn(ctx, modeRect(i), MODES[i], this._cmpMode === i);
            ctx.restore();

            // ── Row 2: opacity slider or hint text (same height) ──
            ctx.save();
            const r2 = hintRect();
            if (this._cmpMode === 2) {
                // Slider track
                const trackX = r2.x + SLIDER_PAD;
                const trackW = r2.w - SLIDER_PAD - 36;
                const trackY = r2.y + r2.h / 2 - 3;
                const trackH = 6;
                const pct = this._cmpOpacity;
                const thumbX = trackX + trackW * pct;

                // Label
                ctx.font = "9px 'Segoe UI',sans-serif";
                ctx.fillStyle = "#999"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
                ctx.fillText("Opacity", r2.x, r2.y + r2.h / 2);

                // Track bg
                ctx.fillStyle = "#2a2c2e";
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(trackX, trackY, trackW, trackH, 3);
                else ctx.rect(trackX, trackY, trackW, trackH);
                ctx.fill();

                // Track fill
                ctx.fillStyle = BRAND;
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(trackX, trackY, Math.max(0, trackW * pct), trackH, 3);
                else ctx.rect(trackX, trackY, trackW * pct, trackH);
                ctx.fill();

                // Thumb
                ctx.fillStyle = BRAND;
                ctx.beginPath(); ctx.arc(thumbX, r2.y + r2.h / 2, 6, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = "#fff";
                ctx.beginPath(); ctx.arc(thumbX, r2.y + r2.h / 2, 2.5, 0, Math.PI * 2); ctx.fill();

                // Value
                ctx.fillStyle = "#ccc"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
                ctx.fillText(`${Math.round(pct * 100)}%`, trackX + trackW + 6, r2.y + r2.h / 2);

                // Store geometry for hit testing
                this._cmpSliderGeo = { x: trackX, y: trackY - 6, w: trackW, h: trackH + 12 };
            } else {
                this._cmpSliderGeo = null;
                ctx.fillStyle = "#999"; ctx.font = "9px 'Segoe UI',sans-serif";
                ctx.textAlign = "left"; ctx.textBaseline = "middle";
                ctx.fillText(MODE_HINTS[this._cmpMode] || "", r2.x, r2.y + r2.h / 2);
            }
            ctx.restore();

            // ── Image area ──
            const imgH = h - IMG_Y;
            if (!this._cmpImg1 && !this._cmpImg2) {
                ctx.save();
                ctx.fillStyle = "#171718"; ctx.fillRect(0, IMG_Y, w, imgH);
                ctx.fillStyle = "#555"; ctx.font = "12px 'Segoe UI',sans-serif";
                ctx.textAlign = "center"; ctx.textBaseline = "middle";
                ctx.fillText("Connect images & run to compare", w / 2, IMG_Y + imgH / 2);
                ctx.restore();
                return;
            }

            const fit = (img) => {
                if (!img) return { x: 0, y: IMG_Y, w, h: imgH };
                const a = img.naturalWidth / img.naturalHeight;
                const fh = w / a;
                if (fh <= imgH) return { x: 0, y: IMG_Y + (imgH - fh) / 2, w, h: fh };
                const fw = imgH * a;
                return { x: (w - fw) / 2, y: IMG_Y, w: fw, h: imgH };
            };
            const fr1 = fit(this._cmpImg1), fr2 = fit(this._cmpImg2);

            ctx.save();
            ctx.beginPath(); ctx.rect(0, IMG_Y, w, imgH); ctx.clip();
            ctx.fillStyle = "#111"; ctx.fillRect(0, IMG_Y, w, imgH);
            const m = this._cmpMode;
            if (m === 0) {
                const sx = w * this._cmpSplitX;
                if (this._cmpImg1) { ctx.save(); ctx.beginPath(); ctx.rect(sx, IMG_Y, w - sx, imgH); ctx.clip(); ctx.drawImage(this._cmpImg1, fr1.x, fr1.y, fr1.w, fr1.h); ctx.restore(); }
                if (this._cmpImg2) { ctx.save(); ctx.beginPath(); ctx.rect(0, IMG_Y, sx, imgH); ctx.clip(); ctx.drawImage(this._cmpImg2, fr2.x, fr2.y, fr2.w, fr2.h); ctx.restore(); }
                if (this._cmpSplitX > 0.01 && this._cmpSplitX < 0.99) { ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sx, IMG_Y); ctx.lineTo(sx, IMG_Y + imgH); ctx.stroke(); }
            } else if (m === 1) {
                const sy = IMG_Y + imgH * this._cmpSplitY;
                if (this._cmpImg1) { ctx.save(); ctx.beginPath(); ctx.rect(0, sy, w, IMG_Y + imgH - sy); ctx.clip(); ctx.drawImage(this._cmpImg1, fr1.x, fr1.y, fr1.w, fr1.h); ctx.restore(); }
                if (this._cmpImg2) { ctx.save(); ctx.beginPath(); ctx.rect(0, IMG_Y, w, sy - IMG_Y); ctx.clip(); ctx.drawImage(this._cmpImg2, fr2.x, fr2.y, fr2.w, fr2.h); ctx.restore(); }
                if (this._cmpSplitY > 0.01 && this._cmpSplitY < 0.99) { ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke(); }
            } else if (m === 2) {
                if (this._cmpImg1) ctx.drawImage(this._cmpImg1, fr1.x, fr1.y, fr1.w, fr1.h);
                if (this._cmpImg2) { ctx.globalAlpha = this._cmpOpacity; ctx.drawImage(this._cmpImg2, fr2.x, fr2.y, fr2.w, fr2.h); ctx.globalAlpha = 1; }
            } else {
                if (this._cmpImg1) ctx.drawImage(this._cmpImg1, fr1.x, fr1.y, fr1.w, fr1.h);
                if (this._cmpImg2) { ctx.globalCompositeOperation = "difference"; ctx.drawImage(this._cmpImg2, fr2.x, fr2.y, fr2.w, fr2.h); ctx.globalCompositeOperation = "source-over"; }
            }
            ctx.restore();
        };

        // ── Mouse ────────────────────────────────────────────
        const _origDown = nodeType.prototype.onMouseDown;
        nodeType.prototype.onMouseDown = function (e, pos) {
            // Mode buttons
            for (let i = 0; i < 4; i++) if (inside(pos, modeRect(i))) { this._cmpMode = i; app.graph.setDirtyCanvas(true, true); return true; }

            // Opacity slider drag start
            if (this._cmpMode === 2 && this._cmpSliderGeo) {
                const sg = this._cmpSliderGeo;
                if (pos[0] >= sg.x - 8 && pos[0] <= sg.x + sg.w + 8 && pos[1] >= sg.y && pos[1] <= sg.y + sg.h) {
                    this._cmpOpacity = Math.max(0, Math.min(1, (pos[0] - sg.x) / sg.w));
                    this._cmpDragging = true;
                    app.graph.setDirtyCanvas(true, true);
                    return true;
                }
            }
            if (_origDown) return _origDown.call(this, e, pos);
        };

        const _origMove = nodeType.prototype.onMouseMove;
        nodeType.prototype.onMouseMove = function (e, pos) {
            // Slider drag (node-level, works while mouse is inside node)
            if (this._cmpDragging && this._cmpSliderGeo) {
                const sg = this._cmpSliderGeo;
                this._cmpOpacity = Math.max(0, Math.min(1, (pos[0] - sg.x) / sg.w));
                app.graph.setDirtyCanvas(true, true);
                return;
            }
            if ((this._cmpMode === 0 || this._cmpMode === 1) && (this._cmpImg1 || this._cmpImg2)) {
                const imgW = this.size[0], imgH = this.size[1] - IMG_Y;
                if (this._cmpMode === 0) this._cmpSplitX = Math.max(0, Math.min(1, pos[0] / imgW));
                else this._cmpSplitY = Math.max(0, Math.min(1, (pos[1] - IMG_Y) / imgH));
                app.graph.setDirtyCanvas(true, true);
            }
            if (_origMove) return _origMove.call(this, e, pos);
        };

        const _origUp = nodeType.prototype.onMouseUp;
        nodeType.prototype.onMouseUp = function (e, pos) {
            this._cmpDragging = false;
            if (_origUp) return _origUp.call(this, e, pos);
        };

        const _origWheel = nodeType.prototype.onMouseWheel;
        nodeType.prototype.onMouseWheel = function (e, pos) {
            if (this._cmpMode === 2 && pos[1] > ROW1_Y) {
                this._cmpOpacity = Math.max(0, Math.min(1, this._cmpOpacity + (e.deltaY > 0 ? -0.05 : 0.05)));
                app.graph.setDirtyCanvas(true, true);
                return true;
            }
            if (_origWheel) return _origWheel.call(this, e, pos);
        };

        const _origLeave = nodeType.prototype.onMouseLeave;
        nodeType.prototype.onMouseLeave = function (e) {
            this._cmpDragging = false;
            if (this._cmpMode === 0) { this._cmpSplitX = 0; app.graph.setDirtyCanvas(true, true); }
            else if (this._cmpMode === 1) { this._cmpSplitY = 0; app.graph.setDirtyCanvas(true, true); }
            if (_origLeave) return _origLeave.call(this, e);
        };
    },
});
