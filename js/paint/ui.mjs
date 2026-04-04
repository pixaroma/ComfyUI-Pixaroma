// ============================================================
// Pixaroma Paint Studio — Color panel, tool options bar, layer panel sync,
//   document properties, cursor overlay, save, BG color popup
// ============================================================
import { PaintStudio, PaintAPI, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, rgbToHsl, hslToRgb, createLayerItem, createDivider } from "./core.mjs";

const proto = PaintStudio.prototype;

// ─── Color UI ─────────────────────────────────────────────

proto._bindColorCanvas = function() {
    this._drawSVGradient(); this._drawHueBar();
    let dragSV = false, dragH = false;
    this.el.svCvs.addEventListener("mousedown", (e) => { dragSV = true; this._pickSV(e); });
    this.el.hCvs.addEventListener("mousedown",  (e) => { dragH  = true; this._pickHue(e); });
    this._onColorMove = (e) => { if (dragSV) this._pickSV(e); if (dragH) this._pickHue(e); };
    this._onColorUp   = () => { dragSV = false; dragH = false; };
    window.addEventListener("mousemove", this._onColorMove);
    window.addEventListener("mouseup",   this._onColorUp);
};

proto._drawSVGradient = function() {
    const cvs = this.el.svCvs; const ctx = cvs.getContext("2d"); const w = cvs.width, h = cvs.height;
    const hColor = this._hsvStr(this.hsv.h, 1, 1);
    const gH = ctx.createLinearGradient(0,0,w,0);
    gH.addColorStop(0,"#fff"); gH.addColorStop(1,hColor);
    ctx.fillStyle = gH; ctx.fillRect(0,0,w,h);
    const gV = ctx.createLinearGradient(0,0,0,h);
    gV.addColorStop(0,"rgba(0,0,0,0)"); gV.addColorStop(1,"#000");
    ctx.fillStyle = gV; ctx.fillRect(0,0,w,h);
    const cx = this.hsv.s * w, cy = (1 - this.hsv.v) * h;
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.stroke();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.stroke();
};

proto._drawHueBar = function() {
    const cvs = this.el.hCvs; const ctx = cvs.getContext("2d"); const w = cvs.width, h = cvs.height;
    const g = ctx.createLinearGradient(0,0,w,0);
    for (let i=0; i<=360; i+=30) g.addColorStop(i/360,`hsl(${i},100%,50%)`);
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
    const cx = (this.hsv.h/360)*w;
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.strokeRect(cx-3,1,6,h-2);
};

proto._hsvStr = function(h,s,v) { const {r,g,b} = hsvToRgb(h,s,v); return `rgb(${r},${g},${b})`; };

proto._pickSV = function(e) {
    const rect = this.el.svCvs.getBoundingClientRect();
    this.hsv.s = Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
    this.hsv.v = Math.max(0,Math.min(1,1-(e.clientY-rect.top)/rect.height));
    this._applyHSV();
};

proto._pickHue = function(e) {
    const rect = this.el.hCvs.getBoundingClientRect();
    this.hsv.h = Math.max(0,Math.min(360,(e.clientX-rect.left)/rect.width*360));
    this._applyHSV();
};

proto._applyHSV = function() {
    const {r,g,b} = hsvToRgb(this.hsv.h, this.hsv.s, this.hsv.v);
    const hex = rgbToHex(r,g,b);
    if (this.colorMode === "fg") this.fgColor = hex; else this.bgColor2 = hex;
    this._updateColorUI(true);
};

proto._setColorFromHex = function(hex, noHsvUpdate) {
    if (this.colorMode === "fg") this.fgColor = hex; else this.bgColor2 = hex;
    if (!noHsvUpdate) {
        const {r,g,b} = hexToRgb(hex); this.hsv = rgbToHsv(r,g,b);
    }
    this._updateColorUI();
    this._addToSwatchHistory(hex);
};

proto._applyHSLAdjust = function(field, val) {
    const hex = this.colorMode === "fg" ? this.fgColor : this.bgColor2;
    const { r, g, b } = hexToRgb(hex);
    let { h, s, l } = rgbToHsl(r, g, b);
    if (field === "h") h = (h + val + 360) % 360;
    else if (field === "s") s = Math.max(0, Math.min(1, s + val / 100));
    else if (field === "l") l = Math.max(0, Math.min(1, l + val / 100));
    const { r: nr, g: ng, b: nb } = hslToRgb(h, s, l);
    const newHex = rgbToHex(nr, ng, nb);
    if (this.colorMode === "fg") this.fgColor = newHex; else this.bgColor2 = newHex;
    const { r: r2, g: g2, b: b2 } = hexToRgb(newHex);
    this.hsv = rgbToHsv(r2, g2, b2);
    this._updateColorUI();
};

proto._updateColorUI = function(preserveHSV) {
    const hex = this.colorMode === "fg" ? this.fgColor : this.bgColor2;
    if (this.el.fgSwatch) this.el.fgSwatch.style.background = this.fgColor;
    if (this.el.bgSwatch) this.el.bgSwatch.style.background = this.bgColor2;
    if (this.el.fgSwatch) this.el.fgSwatch.style.borderColor = this.colorMode === "fg" ? "#f66744" : "#555";
    if (this.el.bgSwatch) this.el.bgSwatch.style.borderColor = this.colorMode === "bg" ? "#f66744" : "#555";
    if (this.el.hexInput) this.el.hexInput.value = hex.slice(1).toUpperCase();
    if (!preserveHSV) {
        const {r,g,b} = hexToRgb(hex); this.hsv = rgbToHsv(r,g,b);
    }
    this._drawSVGradient(); this._drawHueBar();
};

proto._swapColors = function() { [this.fgColor, this.bgColor2] = [this.bgColor2, this.fgColor]; this._updateColorUI(); };

proto._initDefaultSwatches = function() {
    const defaults = [
        "#000000","#333333","#666666","#999999","#cccccc","#ffffff","#f66744","#dc2626",
        "#16a34a","#2563eb","#7c3aed","#db2777","#ca8a04","#fed7aa","#fecdd3","#bbf7d0",
    ];
    const swatches = this.el.swatchGrid?.children;
    if (!swatches) return;
    defaults.forEach((c,i) => { if (swatches[i]) { swatches[i].style.background = c; swatches[i].dataset.color = c.startsWith("#") ? c : "#" + c; } });
    this.swatchHistory = [...defaults];
};

proto._addToSwatchHistory = function(hex) {
    if (!hex || this.swatchHistory[0] === hex) return;
    this.swatchHistory = [hex, ...this.swatchHistory.filter(c => c !== hex)].slice(0, 16);
    const swatches = this.el.swatchGrid?.children;
    if (!swatches) return;
    this.swatchHistory.forEach((c,i) => { if (swatches[i]) { swatches[i].style.background = c; swatches[i].dataset.color = c; } });
};

// ─── BG color picker popup ────────────────────────────────

proto._showBgColorPicker = function(e, anchor) {
    document.querySelector(".ppx-color-popup")?.remove();
    const rect = anchor.getBoundingClientRect();
    const popup = document.createElement("div");
    popup.className = "ppx-color-popup";
    let top = rect.bottom + 6;
    let left = rect.left;
    if (top + 120 > window.innerHeight) top = rect.top - 120;
    if (left + 160 > window.innerWidth)  left = window.innerWidth - 166;
    popup.style.cssText = `position:fixed;top:${top}px;left:${left}px;z-index:20000;background:#1a1c1d;border:1px solid #f66744;border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:6px;box-shadow:0 8px 24px rgba(0,0,0,.7);min-width:150px;`;

    const inp = document.createElement("input");
    inp.type = "color"; inp.value = this.bgColor; inp.style.cssText = "width:100%;height:28px;cursor:pointer;border:none;background:none;";
    inp.addEventListener("input", () => {
        this.bgColor = inp.value;
        anchor.style.background = inp.value;
        hexInp.value = inp.value.slice(1).toUpperCase();
        this._renderDisplay();
    });

    const hexRow2 = document.createElement("div");
    hexRow2.style.cssText = "display:flex;align-items:center;gap:4px;";
    const hLbl = document.createElement("span"); hLbl.textContent = "#"; hLbl.style.color = "#888";
    const hexInp = document.createElement("input");
    hexInp.type = "text"; hexInp.maxLength = 6; hexInp.value = this.bgColor.slice(1).toUpperCase();
    hexInp.style.cssText = "flex:1;background:#111;color:#e0e0e0;border:1px solid #444;border-radius:3px;padding:2px 4px;font-family:monospace;font-size:11px;";
    hexInp.addEventListener("change", () => {
        const v = "#" + hexInp.value.replace(/[^0-9a-fA-F]/g,"").padEnd(6,"0").slice(0,6);
        this.bgColor = v; inp.value = v; anchor.style.background = v; this._renderDisplay();
    });
    hexRow2.append(hLbl, hexInp);

    const closeP = this._mkBtn("\u2715 Close", () => popup.remove(), "ppx-btn"); closeP.style.fontSize = "10px";
    popup.append(inp, hexRow2, closeP);
    document.body.appendChild(popup);

    setTimeout(() => {
        const handler = (ev) => { if (!popup.contains(ev.target) && ev.target !== anchor) { popup.remove(); document.removeEventListener("click", handler); } };
        document.addEventListener("click", handler);
    }, 100);
};

// ─── Tool options bar ─────────────────────────────────────

proto._setTool = function(tool) {
    const prevTool = this.tool;

    // Save current brush settings to per-tool storage
    const brushTools = ["brush","pencil","eraser","smudge"];
    if (brushTools.includes(prevTool) && this._toolSettings) {
        this._toolSettings[prevTool] = { ...this.brush };
        if (prevTool === "smudge") this._toolSettings.smudge.strength = this.smudgeStrength || 50;
    }

    this.tool = tool;

    // Restore per-tool brush settings
    if (brushTools.includes(tool) && this._toolSettings?.[tool]) {
        this.brush = { ...this._toolSettings[tool] };
        if (tool === "smudge") this.smudgeStrength = this._toolSettings.smudge.strength || 50;
        this.engine._stampKey = "";
    }

    Object.keys(this.el).filter(k => k.startsWith("toolBtn_")).forEach(k => {
        this.el[k].classList.toggle("active", k === `toolBtn_${tool}`);
    });

    // Cursor style per tool
    const noCursor = ["brush","pencil","eraser","smudge"];
    const cursorMap = { fill:"copy", pick:"none", transform:"move", shape:"crosshair" };
    const cur = noCursor.includes(tool) ? "none" : (cursorMap[tool] || "crosshair");
    if (this.el.workspace) this.el.workspace.style.cursor = cur;
    // Transform panel always visible (no toggle needed)

    // Auto-apply transform when switching to any drawing tool
    const drawingTools = ["brush","pencil","eraser","smudge","fill","shape"];
    if (drawingTools.includes(tool) && tool !== prevTool) {
        const ly = this.layers[this.activeIdx];
        if (ly && this._hasTransform(ly)) {
            this._applyLayerTransform();
        }
    }

    // When entering transform mode, auto-set pivot to content center
    if (tool === "transform" && prevTool !== "transform") {
        this._autoSetPivot();
        this._updateTransformWarn();
    }

    this._updateToolOptions();
    this._renderDisplay();
};

proto._autoSetPivot = function() {
    const ly = this.layers[this.activeIdx];
    if (!ly) return;
    const t = ly.transform;
    // Only auto-set if no transform is currently active (avoid disrupting existing transforms)
    if (t.scaleX === 1 && t.scaleY === 1 && t.rotation === 0 && !t.flipX && !t.flipY) {
        const b = this._getContentBounds(ly);
        if (b.w > 1 && b.h > 1) {
            t.pivotOffX = b.x + b.w / 2 - this.docW / 2;
            t.pivotOffY = b.y + b.h / 2 - this.docH / 2;
        }
    }
};

proto._hasTransform = function(ly) {
    const t = ly.transform;
    return !!(t.x || t.y || t.scaleX !== 1 || t.scaleY !== 1 || t.rotation || t.flipX || t.flipY);
};

proto._updateTransformWarn = function() {
    const ly = this.layers[this.activeIdx];
    const pending = ly && this._hasTransform(ly);
    if (this.el.transformWarn) this.el.transformWarn.style.display = pending ? "block" : "none";
};

proto._updateToolOptions = function() {
    const bar = this.el.topOpts; if (!bar) return;
    bar.innerHTML = "";

    // After rebuilding, refresh slider fills (deferred to next frame so DOM is ready)
    requestAnimationFrame(() => {
        bar.querySelectorAll("input[type=range]").forEach(s => {
            if (window._pxfUpdateFill) window._pxfUpdateFill(s);
        });
    });

    const add = (label, el) => {
        const lbl = document.createElement("label"); lbl.textContent = label;
        bar.appendChild(lbl); bar.appendChild(el);
    };

    const mkRange = (min, max, val, cb) => {
        const inp = document.createElement("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.value = val;
        const numEl = document.createElement("input"); numEl.type = "number"; numEl.min = min; numEl.max = max; numEl.value = val;
        inp.addEventListener("input", () => { numEl.value = inp.value; cb(+inp.value); });
        numEl.addEventListener("change", () => { const v = Math.max(min, Math.min(max, +numEl.value)); inp.value = v; numEl.value = v; cb(v); });
        return { range: inp, num: numEl };
    };

    const sep = () => { const d = document.createElement("div"); d.className = "ppx-sep"; bar.appendChild(d); };

    if (this.tool === "brush" || this.tool === "pencil" || this.tool === "eraser" || this.tool === "smudge") {
        const resetBtn = document.createElement("button");
        resetBtn.className = "pxf-btn-sm"; resetBtn.title = "Reset brush to defaults";
        resetBtn.textContent = "\u21ba"; resetBtn.style.cssText = "width:24px;height:22px;font-size:13px;flex-shrink:0;";
        resetBtn.addEventListener("click", () => {
            const defaults = {
                brush:  { size:20, opacity:100, flow:80, hardness:80, shape:"round", angle:0, spacing:25, scatter:0 },
                pencil: { size:4,  opacity:100, flow:100, hardness:100, shape:"square", angle:0, spacing:5, scatter:0 },
                eraser: { size:30, opacity:100, flow:100, hardness:80, shape:"round", angle:0, spacing:10, scatter:0 },
                smudge: { size:20, opacity:100, flow:50, hardness:80, shape:"round", angle:0, spacing:10, scatter:0 },
            };
            this.brush = { ...(defaults[this.tool] || defaults.brush) };
            if (this.tool === "smudge") this.smudgeStrength = 50;
            this.engine._stampKey = ""; this._updateToolOptions();
        });
        bar.appendChild(resetBtn);
        sep();
        const sz = mkRange(1, 500, this.brush.size, v => { this.brush.size = v; this.engine._stampKey = ""; });
        add("Size", sz.range); bar.appendChild(sz.num);
        // Opacity shown for brush/pencil/eraser only (not smudge)
        if (this.tool !== "smudge") {
            const op = mkRange(0, 100, this.brush.opacity, v => this.brush.opacity = v);
            add("Opacity%", op.range); bar.appendChild(op.num);
            const fl = mkRange(0, 100, this.brush.flow, v => this.brush.flow = v);
            add("Flow%", fl.range); bar.appendChild(fl.num);
            const hd = mkRange(0, 100, this.brush.hardness, v => { this.brush.hardness = v; this.engine._stampKey = ""; });
            add("Hardness%", hd.range); bar.appendChild(hd.num);
        }

        if (this.tool === "brush" || this.tool === "pencil") {
            const sp = mkRange(1, 200, this.brush.spacing, v => this.brush.spacing = v);
            add("Spacing%", sp.range); bar.appendChild(sp.num);
            const sc = mkRange(0, 100, this.brush.scatter, v => this.brush.scatter = v);
            add("Scatter", sc.range); bar.appendChild(sc.num);
            const angSlide = document.createElement("input"); angSlide.type = "range"; angSlide.min = -180; angSlide.max = 180; angSlide.value = this.brush.angle; angSlide.style.cssText = "width:60px;cursor:pointer;flex-shrink:0;";
            const angN = document.createElement("input"); angN.type = "number"; angN.min = -180; angN.max = 180; angN.value = this.brush.angle;
            const angUpdate = (v) => { this.brush.angle = +v; angSlide.value = v; angN.value = v; this.engine._stampKey = ""; };
            angSlide.addEventListener("input", () => angUpdate(angSlide.value));
            angN.addEventListener("change", () => angUpdate(angN.value));
            add("Angle\u00b0", angSlide); bar.appendChild(angN);
            sep();
            const SHAPES = [{id:"round",sym:"\u25cf"},{id:"square",sym:"\u25a0"},{id:"triangle",sym:"\u25b2"},{id:"diamond",sym:"\u25c6"},{id:"star",sym:"\u2605"},{id:"flat",sym:"\u2b2c"},{id:"leaf",sym:"\ud83c\udf43"}];
            SHAPES.forEach(sh => {
                const btn = document.createElement("div");
                btn.className = "ppx-shape-btn" + (this.brush.shape === sh.id ? " active" : "");
                btn.title = sh.id; btn.textContent = sh.sym;
                btn.addEventListener("click", () => {
                    this.brush.shape = sh.id; this.engine._stampKey = "";
                    bar.querySelectorAll(".ppx-shape-btn").forEach(b => b.classList.remove("active")); btn.classList.add("active");
                });
                bar.appendChild(btn);
            });
        }
    }

    if (this.tool === "smudge") {
        sep();
        const st = mkRange(1, 100, this.smudgeStrength || 50, v => this.smudgeStrength = v);
        add("Strength%", st.range); bar.appendChild(st.num);
    }

    if (this.tool === "fill") {
        const tl = mkRange(0, 255, this.fillTol, v => this.fillTol = v);
        add("Tolerance", tl.range); bar.appendChild(tl.num);
    }

    if (this.tool === "pick") {
        const lbl = document.createElement("label"); lbl.style.color = "#f66744";
        lbl.textContent = "Click or drag to sample color  \u00b7  Alt+click picks to background color"; bar.appendChild(lbl);
    }

    if (this.tool === "transform") {
        sep();
        const lbl = document.createElement("label"); lbl.style.cssText = "color:#aaa;font-size:10px;";
        lbl.textContent = "Drag=Move  \u00b7  Corner=Scale  \u00b7  Top circle=Rotate  \u00b7  Shift=15\u00b0 snap  \u00b7  Esc=Reset";
        bar.appendChild(lbl);
    }

    if (this.tool === "shape") {
        const shapeBtns = [
            { id:"rect",     sym:"\u25ad", label:"Rectangle" },
            { id:"ellipse",  sym:"\u25ef", label:"Ellipse/Circle" },
            { id:"triangle", sym:"\u25b3", label:"Triangle" },
            { id:"poly",     sym:"\u2b21", label:"Polygon (3-12 sides)" },
            { id:"line",     sym:"\u2571", label:"Line" },
        ];
        let activeShapeBtn = null;
        shapeBtns.forEach(s => {
            const btn = document.createElement("div");
            btn.className = "ppx-shape-btn" + (this._shapeTool === s.id ? " active" : "");
            btn.title = s.label; btn.textContent = s.sym;
            if (this._shapeTool === s.id) activeShapeBtn = btn;
            btn.addEventListener("click", () => {
                this._shapeTool = s.id;
                bar.querySelectorAll(".ppx-shape-btn").forEach(b => b.classList.remove("active")); btn.classList.add("active");
                updateShapeOptions();
            });
            bar.appendChild(btn);
        });
        sep();

        // Fill/Stroke toggle (not shown for Line)
        const fillStrokeArea = document.createElement("span"); fillStrokeArea.style.cssText = "display:flex;align-items:center;gap:4px;";
        bar.appendChild(fillStrokeArea);

        // Polygon sides slider (shown only for poly)
        const polyArea = document.createElement("span"); polyArea.style.cssText = "display:flex;align-items:center;gap:4px;";
        bar.appendChild(polyArea);

        // Stroke width (shown when not fill or for line)
        const strokeArea = document.createElement("span"); strokeArea.style.cssText = "display:flex;align-items:center;gap:4px;";
        bar.appendChild(strokeArea);

        const updateShapeOptions = () => {
            fillStrokeArea.innerHTML = ""; polyArea.innerHTML = ""; strokeArea.innerHTML = "";

            if (this._shapeTool !== "line") {
                // Fill/Stroke toggle button
                const fillBtn = document.createElement("div");
                fillBtn.className = "ppx-shape-btn" + (this.shapeFill ? " active" : "");
                fillBtn.textContent = "\u25cf Fill"; fillBtn.style.cssText = "width:48px;font-size:10px;";
                const strokeBtn = document.createElement("div");
                strokeBtn.className = "ppx-shape-btn" + (!this.shapeFill ? " active" : "");
                strokeBtn.textContent = "\u25cb Stroke"; strokeBtn.style.cssText = "width:54px;font-size:10px;";
                fillBtn.addEventListener("click", () => {
                    this.shapeFill = true; fillBtn.classList.add("active"); strokeBtn.classList.remove("active");
                    updateShapeOptions();
                });
                strokeBtn.addEventListener("click", () => {
                    this.shapeFill = false; strokeBtn.classList.add("active"); fillBtn.classList.remove("active");
                    updateShapeOptions();
                });
                fillStrokeArea.append(fillBtn, strokeBtn);
                const sepEl = document.createElement("div"); sepEl.className = "ppx-sep"; fillStrokeArea.appendChild(sepEl);
            }

            // Polygon sides
            if (this._shapeTool === "poly") {
                const sidesLbl = document.createElement("label"); sidesLbl.textContent = "Sides"; sidesLbl.style.cssText = "font-size:10px;color:#888;";
                const sidesSlide = document.createElement("input"); sidesSlide.type = "range"; sidesSlide.min = 3; sidesSlide.max = 12; sidesSlide.value = this.polySlides || 5; sidesSlide.style.cssText = "width:60px;";
                const sidesNum = document.createElement("input"); sidesNum.type = "number"; sidesNum.min = 3; sidesNum.max = 12; sidesNum.value = this.polySlides || 5; sidesNum.style.cssText = "width:36px;background:#111;color:#e0e0e0;border:1px solid #3a3d40;border-radius:3px;padding:2px 3px;font-size:10px;font-family:monospace;";
                sidesSlide.addEventListener("input", () => { this.polySlides = +sidesSlide.value; sidesNum.value = sidesSlide.value; });
                sidesNum.addEventListener("change", () => { const v = Math.max(3,Math.min(12,+sidesNum.value)); this.polySlides = v; sidesSlide.value = v; sidesNum.value = v; });
                const sepEl = document.createElement("div"); sepEl.className = "ppx-sep";
                polyArea.append(sidesLbl, sidesSlide, sidesNum, sepEl);
            }

            // Stroke width (for stroke mode or line)
            if (!this.shapeFill || this._shapeTool === "line") {
                const swLbl = document.createElement("label"); swLbl.textContent = "Width"; swLbl.style.cssText = "font-size:10px;color:#888;";
                const swSlide = document.createElement("input"); swSlide.type = "range"; swSlide.min = 1; swSlide.max = 50; swSlide.value = this.shapeLineWidth || 3; swSlide.style.cssText = "width:60px;";
                const swNum = document.createElement("input"); swNum.type = "number"; swNum.min = 1; swNum.max = 50; swNum.value = this.shapeLineWidth || 3; swNum.style.cssText = "width:36px;background:#111;color:#e0e0e0;border:1px solid #3a3d40;border-radius:3px;padding:2px 3px;font-size:10px;font-family:monospace;";
                swSlide.addEventListener("input", () => { this.shapeLineWidth = +swSlide.value; swNum.value = swSlide.value; });
                swNum.addEventListener("change", () => { const v = Math.max(1,Math.min(50,+swNum.value)); this.shapeLineWidth = v; swSlide.value = v; swNum.value = v; });
                strokeArea.append(swLbl, swSlide, swNum);
            }
        };
        updateShapeOptions();
    }

    // Update help strip
    const helpTexts = {
        brush:     "Drag to paint  \u00b7  [ / ] resize  \u00b7  Shift+click = straight line  \u00b7  Alt+drag = temp eyedropper  \u00b7  \u21ba resets defaults",
        pencil:    "Hard-edge pencil  \u00b7  [ / ] resize  \u00b7  Shift+click = straight line  \u00b7  Alt+drag = eyedropper",
        eraser:    "Drag to erase pixels  \u00b7  Opacity controls how much is erased  \u00b7  [ / ] resize",
        fill:      "Click to flood-fill with FG color  \u00b7  Adjust Tolerance for color spread",
        pick:      "Click or drag to sample color  \u00b7  Alt+drag while painting = quick eyedropper",
        smudge:    "Drag to smear pixels  \u00b7  Adjust Strength slider  \u00b7  Smaller brush = finer detail",
        transform: "Drag = move  \u00b7  Corner = scale  \u00b7  Top circle = rotate  \u00b7  Center dot = move pivot  \u00b7  Click canvas = select layer  \u00b7  Enter = Apply",
        shape:     "Drag to draw shape  \u00b7  Fill = solid, Stroke = outline  \u00b7  Polygon: adjust sides 3-12  \u00b7  Line ignores fill toggle",
    };
    if (this.el.helpStrip) this.el.helpStrip.textContent = helpTexts[this.tool] ||
        "B=Brush  P=Pencil  E=Eraser  G=Fill  I=Eyedrop  R=Smudge  V=Move  Space+Drag=Pan  Scroll=Zoom  Ctrl+Z=Undo";
};

// ─── Layers panel ─────────────────────────────────────────

proto._updateLayersPanel = function() {
    if (!this._layerPanel) return;
    const items = this.layers.map((ly, i) => {
        // Build thumbnail canvas
        const tCvs = document.createElement("canvas"); tCvs.width = 26; tCvs.height = 26;
        tCvs.getContext("2d").drawImage(ly.canvas, 0, 0, 26, 26);

        return createLayerItem({
            name: ly.name,
            visible: ly.visible,
            locked: ly.locked,
            active: i === this.activeIdx,
            multiSelected: this.selectedIndices.has(i) && i !== this.activeIdx,
            thumbnail: tCvs,
            onVisibilityToggle: () => {
                ly.visible = !ly.visible;
                this._renderDisplay();
                this._updateLayersPanel();
            },
            onLockToggle: () => {
                ly.locked = !ly.locked;
                this._updateLayersPanel();
            },
            onClick: (e) => {
                if (e.detail > 1) return;
                if (e.ctrlKey || e.metaKey) {
                    if (this.selectedIndices.has(i)) this.selectedIndices.delete(i);
                    else this.selectedIndices.add(i);
                    this.activeIdx = i;
                } else {
                    this.selectedIndices.clear();
                    this.selectedIndices.add(i);
                    this.activeIdx = i;
                }
                this._syncLayerProps();
                this._updateLayersPanel();
                this._renderDisplay();
            },
            onRename: (newName) => {
                ly.name = newName;
            },
        }).el;
    });
    this._layerPanel.refresh(items);
    this._syncLayerProps();
};

proto._syncLayerProps = function() {
    const ly = this.layers[this.activeIdx]; if (!ly) return;
    if (this.el.blendSel)    this.el.blendSel.value    = ly.blendMode;
    if (this.el.layerOpRange) this.el.layerOpRange.value = ly.opacity;
    if (this.el.layerOpNum) this.el.layerOpNum.value = ly.opacity;
    this._syncTransformPanel();
    this._updateTransformWarn();
};

proto._syncTransformPanel = function() {
    const ly = this.layers[this.activeIdx]; if (!ly) return;
    const t = ly.transform;
    const tp = this._transformPanel; if (!tp) return;
    if (tp.setRotate) tp.setRotate(Math.round(t.rotation));
    if (tp.setScale) tp.setScale(Math.round(t.scaleX * 100));
    if (tp.setStretchH) tp.setStretchH(Math.round(t.scaleX * 100));
    if (tp.setStretchV) tp.setStretchV(Math.round(t.scaleY * 100));
    if (tp.setOpacity) tp.setOpacity(Math.round(ly.opacity));
};

proto._updateLayerThumb = function(idx) {
    const list = this.el.layerList; if (!list) return;
    const item = list.children[idx]; if (!item) return;
    const tCvs = item.querySelector("canvas"); if (!tCvs) return;
    const ly = this.layers[idx]; if (!ly) return;
    tCvs.getContext("2d").clearRect(0, 0, 26, 26);
    tCvs.getContext("2d").drawImage(ly.canvas, 0, 0, 26, 26);
};

// ─── Document ─────────────────────────────────────────────

proto._updateDocProps = function() {
    if (this.el.docW) this.el.docW.value = this.docW;
    if (this.el.docH) this.el.docH.value = this.docH;
    if (this._canvasSettings) this._canvasSettings.setSize(this.docW, this.docH);
    if (this.el.bgPreview) this.el.bgPreview.style.background = this.bgColor;
};

proto._resizeDoc = function() {
    const nw = Math.max(64, Math.min(4096, +this.el.docW.value || this.docW));
    const nh = Math.max(64, Math.min(4096, +this.el.docH.value || this.docH));
    if (nw === this.docW && nh === this.docH) return;
    // Compute anchor offset so existing content stays top-left
    const offX = 0, offY = 0;
    this.layers.forEach(ly => {
        const tmp = document.createElement("canvas"); tmp.width = nw; tmp.height = nh;
        tmp.getContext("2d").drawImage(ly.canvas, offX, offY);
        ly.canvas.width = nw; ly.canvas.height = nh;
        ly.ctx.drawImage(tmp, 0, 0);
    });
    this.docW = nw; this.docH = nh;
    this._contentBoundsCache.clear();
    this._applyDocSize(); this._renderDisplay();
    requestAnimationFrame(() => this._fitToView());
    this._updateLayersPanel();
    if (this.el.dimLabel) this.el.dimLabel.textContent = `${nw}\u00d7${nh}`;
    this._setStatus(`Canvas resized to ${nw}\u00d7${nh}`);
};

// ─── Save ─────────────────────────────────────────────────

proto._save = async function() {
    this._layout.setSaving();
    try {
        const finalCvs = document.createElement("canvas");
        finalCvs.width = this.docW; finalCvs.height = this.docH;
        const fCtx = finalCvs.getContext("2d");
        fCtx.fillStyle = this.bgColor; fCtx.fillRect(0, 0, this.docW, this.docH);
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const ly = this.layers[i]; if (!ly.visible) continue;
            fCtx.save();
            fCtx.globalAlpha = ly.opacity / 100;
            fCtx.globalCompositeOperation = ly.blendMode;
            this._drawLayerWithTransform(fCtx, ly);
            fCtx.restore();
        }
        const compositeDataURL = finalCvs.toDataURL("image/png");

        const layersMeta = [];
        for (const ly of this.layers) {
            let src = "";
            try {
                const res = await PaintAPI.uploadLayer(ly.id, ly.canvas.toDataURL("image/png"));
                src = res.path || "";
            } catch (e) { console.warn("[Paint] Layer upload failed:", e); }
            layersMeta.push({ id:ly.id, name:ly.name, visible:ly.visible, locked:ly.locked, opacity:ly.opacity, blend_mode:ly.blendMode, transform:ly.transform, src });
        }

        let compositePath = "";
        try {
            const res = await PaintAPI.saveComposite(this.projectId, compositeDataURL);
            compositePath = res.composite_path || "";
        } catch (e) { console.warn("[Paint] Composite save failed:", e); }

        const meta = { doc_w:this.docW, doc_h:this.docH, background_color:this.bgColor, project_id:this.projectId, layers:layersMeta, composite_path:compositePath, session_ver:3.0 };
        if (this.onSave) this.onSave(JSON.stringify(meta), compositeDataURL);
        if (this._diskSavePending) { this._diskSavePending = false; if (this.onSaveToDisk) this.onSaveToDisk(compositeDataURL); }
        this._layout.setSaved();
    } catch (err) {
        console.error("[Paint] Save error:", err);
        this._layout.setSaveError("Save failed: " + err.message);
    }
};

// ─── Cursor overlay ───────────────────────────────────────

proto._updateCursorOverlay = function(docX, docY) {
    const cvs = this.el.cursorCvs; if (!cvs) return;
    const ctx = cvs.getContext("2d");
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    // Only draw within canvas bounds (with margin)
    const margin = this.brush.size;
    if (docX < -margin || docX > this.docW + margin || docY < -margin || docY > this.docH + margin) return;

    const lw = Math.max(0.4, 1 / this.zoom); // 1 screen-pixel line

    if (this.tool === "brush" || this.tool === "pencil" || this.tool === "smudge") {
        const r = Math.max(1, this.brush.size / 2);
        const shape = this.tool === "pencil" ? "square" : (this.brush.shape || "round");
        ctx.save();
        this._drawCursorShape(ctx, docX, docY, r, shape, "rgba(255,255,255,0.9)", "rgba(0,0,0,0.7)", lw, false);
        // Center dot
        ctx.beginPath(); ctx.arc(docX, docY, lw * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fill();
        ctx.restore();
    } else if (this.tool === "eraser") {
        const r = Math.max(1, this.brush.size / 2);
        const shape = this.brush.shape || "round";
        ctx.save();
        this._drawCursorShape(ctx, docX, docY, r, shape, "rgba(200,200,200,0.85)", "rgba(0,0,0,0.4)", lw, true);
        ctx.beginPath(); ctx.arc(docX, docY, lw * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(200,200,200,0.8)"; ctx.fill();
        ctx.restore();
    } else if (this.tool === "pick") {
        const cl = 8 / this.zoom;
        ctx.save();
        ctx.strokeStyle = "#f66744"; ctx.lineWidth = lw * 1.5;
        // Crosshair
        ctx.beginPath(); ctx.moveTo(docX - cl, docY); ctx.lineTo(docX + cl, docY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(docX, docY - cl); ctx.lineTo(docX, docY + cl); ctx.stroke();
        // Small circle
        ctx.beginPath(); ctx.arc(docX, docY, 3/this.zoom, 0, Math.PI*2);
        ctx.strokeStyle = "#fff"; ctx.lineWidth = lw; ctx.stroke();
        ctx.restore();
    }
    // For fill, transform, etc. — use OS cursor, no overlay needed
};

proto._drawCursorShape = function(ctx, x, y, r, shape, outerColor, innerColor, lw, dashed) {
    const drawOutline = () => {
        ctx.strokeStyle = outerColor; ctx.lineWidth = lw * 1.5;
        if (dashed) ctx.setLineDash([Math.max(2, 4/this.zoom), Math.max(2, 4/this.zoom)]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = innerColor; ctx.lineWidth = lw * 0.8; ctx.stroke();
    };
    ctx.beginPath();
    if (shape === "square") {
        ctx.rect(x - r, y - r, r * 2, r * 2);
    } else if (shape === "flat") {
        // ellipse() takes rotation angle natively — no need for save/restore
        ctx.ellipse(x, y, r, r * 0.35, (this.brush.angle || 0) * Math.PI / 180, 0, Math.PI * 2);
    } else if (shape === "triangle") {
        const h = r * 1.2;
        ctx.moveTo(x, y - h); ctx.lineTo(x + r, y + r * 0.5); ctx.lineTo(x - r, y + r * 0.5); ctx.closePath();
    } else if (shape === "diamond") {
        ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
    } else {
        ctx.arc(x, y, r, 0, Math.PI * 2); // round, star, leaf, etc.
    }
    drawOutline();
};

proto._toggleHelp = function() {
    if (this._layout) this._layout.toggleHelp();
};
