// ============================================================
// Pixaroma Paint Studio — Core + Full UI  v4 (Framework)
// ============================================================
import { BrushEngine, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, rgbToHsl, hslToRgb } from "./engine.js";
import { PaintAPI } from "./api.js";
import {
    createEditorLayout, createPanel, createButton, createSliderRow,
    createRow, createNumberInput, createSelectInput, createColorInput,
    createButtonRow, createCheckbox, createDivider, createCanvasSettings,
    createLayerPanel, createLayerItem, createCanvasToolbar, createTransformPanel, BRAND
} from "../framework/index.js";

const PAINT_STYLE_ID = "pixaroma-paint-extra-styles-v4";

function injectPaintExtraStyles() {
    if (document.getElementById(PAINT_STYLE_ID)) return;
    // remove old versions
    document.getElementById("pixaroma-paint-styles-v3")?.remove();
    document.getElementById("pixaroma-paint-styles-v2")?.remove();
    const s = document.createElement("style");
    s.id = PAINT_STYLE_ID;
    s.textContent = `
/* Paint workspace — same dark bg as Composer (unified) */
/* Paint-specific: canvas viewport */
.ppx-canvas-viewport { position:absolute; top:0; left:0; transform-origin:0 0; }
.ppx-canvas-viewport canvas { display:block; box-shadow:0 4px 32px rgba(0,0,0,.7); border:2px solid rgba(249,115,22,0.45); }
.ppx-cursor-canvas { position:absolute; top:0; left:0; pointer-events:none; }
/* (zoom bar now provided by editor framework) */
/* Paint-specific: SV/Hue color picker canvases */
.ppx-sv-canvas { width:100%; cursor:crosshair; border-radius:3px; display:block; border:1px solid #333; flex-shrink:0; }
.ppx-hue-canvas { width:100%; height:14px; cursor:crosshair; border-radius:3px; display:block; border:1px solid #333; flex-shrink:0; }
/* Paint-specific: FG/BG color swatches */
.ppx-swatches-fg-bg { display:flex; gap:4px; align-items:center; flex-shrink:0; }
.ppx-fg-swatch, .ppx-bg-swatch {
    width:38px; height:38px; border-radius:5px; cursor:pointer; border:2px solid #555;
    transition:border-color .12s; flex-shrink:0;
}
.ppx-fg-swatch { border-color:#f66744; }
.ppx-fg-swatch:hover, .ppx-bg-swatch:hover { border-color:#f66744; }
.ppx-swap-btn { background:none; border:none; color:#999; cursor:pointer; font-size:13px; padding:2px; }
.ppx-swap-btn:hover { color:#f66744; }
/* Paint-specific: swatch grid */
.ppx-swatches-grid { display:grid; grid-template-columns:repeat(8,1fr); gap:2px; flex-shrink:0; }
.ppx-swatch { aspect-ratio:1; border-radius:2px; cursor:pointer; border:1px solid #222; transition:transform .1s; }
.ppx-swatch:hover { transform:scale(1.25); border-color:#f66744; z-index:2; }
/* Paint-specific: hex row */
.ppx-hex-row { display:flex; align-items:center; gap:4px; }
.ppx-hex-row input {
    flex:1; background:#111; color:#e0e0e0; border:1px solid #3a3d40;
    border-radius:3px; padding:2px 5px; font-size:11px; font-family:monospace;
}
/* Paint-specific: HSL slider rows */
.ppx-hsl-row { display:flex; align-items:center; gap:4px; margin-bottom:3px; }
.ppx-hsl-row label { font-size:9px; color:#888; width:10px; flex-shrink:0; }
.ppx-hsl-row input[type=range] { flex:1; min-width:0; }
.ppx-hsl-row input[type=number] {
    width:38px; background:#111; color:#e0e0e0; border:1px solid #3a3d40;
    border-radius:3px; padding:2px 3px; font-size:10px; font-family:monospace;
}
/* Paint-specific: shape buttons in top options bar */
.ppx-shape-btn {
    width:24px; height:22px; cursor:pointer; border:1px solid #3a3d40;
    background:#1c1e1f; color:#ccc; border-radius:3px; font-size:12px;
    display:flex; align-items:center; justify-content:center; flex-shrink:0;
    transition:all .12s;
}
.ppx-shape-btn:hover, .ppx-shape-btn.active { background:#f66744; color:#fff; border-color:#f66744; }
/* Paint-specific: top options bar extra styling */
.pxf-top-options label { font-size:10px; color:#999; white-space:nowrap; }
.pxf-top-options input[type=range] { width:60px; cursor:pointer; flex-shrink:0; }
.pxf-top-options input[type=number] {
    width:40px; background:#111; color:#e0e0e0; border:1px solid #3a3d40;
    border-radius:3px; padding:2px 3px; font-size:11px; font-family:monospace; flex-shrink:0;
}
/* Paint-specific: BG preview swatch */
.ppx-bg-preview { width:20px; height:20px; border-radius:3px; border:1px solid #444; cursor:pointer; flex-shrink:0; }
/* Paint-specific: transform panel elements */
.ppx-transform-warn {
    background:#431407; border:1px solid #c2410c; border-radius:3px;
    padding:4px 7px; font-size:9px; color:#fca97b; text-align:center;
    margin-bottom:4px; line-height:1.4;
}
/* Paint-specific: layer item drag states (old class compat) */
.pxf-layer-item.ppx-drag-over-top    { border-top:2px solid #f66744 !important; }
.pxf-layer-item.ppx-drag-over-bottom { border-bottom:2px solid #f66744 !important; }
.pxf-layer-item.ppx-dragging { opacity:0.35; }
/* Paint-specific: help strip (now uses framework status bar) */
.ppx-help-strip-unused {
}
/* Paint-specific: BG color popup */
.ppx-color-popup {
    position:fixed; z-index:20000; background:#1a1c1d;
    border:1px solid #f66744; border-radius:6px;
    padding:8px; display:flex; flex-direction:column; gap:6px;
    box-shadow:0 8px 24px rgba(0,0,0,.6);
}
    `;
    document.head.appendChild(s);
}

// ─── PaintStudio ─────────────────────────────────────────────────────────────

export class PaintStudio {
    constructor() {
        this.onSave = null;
        this.onClose = null;
        this.docW = 1024; this.docH = 1024;
        this.bgColor = "#ffffff";
        this.layers = [];
        this.activeIdx = 0;
        this.strokeCanvas = null; this.strokeCtx = null;
        this.zoom = 1.0; this.panX = 0; this.panY = 0;
        this.tool = "brush";
        this.brush = { size:20, opacity:100, flow:80, hardness:80, shape:"round", angle:0, spacing:25, scatter:0 };
        this.fillTol = 30;
        this.fgColor = "#000000"; this.bgColor2 = "#ffffff"; this.colorMode = "fg";
        this.hsv = { h:0, s:0, v:0 };
        this.swatchHistory = [];
        this.isDrawing = false; this.isPanning = false; this.panStart = null; this._spaceDown = false;
        this.showGrid = false; this.projectId = null;
        this.engine = new BrushEngine();
        this.history = []; this.historyIndex = -1; this.MAX_HISTORY = 40;
        this.el = {};
        this._transformDrag = null;
        this._handleMode = null; // 'move','scale','rotate'
        this._handleDrag = null;
        this._lastSmudgePt = null;
        this._dragLayerIdx = null;
        this._altPicking = false;
        this._lineStart = null;
        this._shapeStart = null;
        this._shapeTool = "rect"; // rect, ellipse, line, triangle, poly
        this._selectionRect = null;
        this.shapeFill = true;
        this.shapeLineWidth = 3;
        this.polySlides = 5;
        this._toolSettings = {
            brush:  { size:20, opacity:100, flow:80, hardness:80, shape:"round", angle:0, spacing:25, scatter:0 },
            pencil: { size:4,  opacity:100, flow:100, hardness:100, shape:"square", angle:0, spacing:5, scatter:0 },
            eraser: { size:30, opacity:100, flow:100, hardness:80, shape:"round", angle:0, spacing:10, scatter:0 },
            smudge: { size:20, opacity:100, flow:50, hardness:80, shape:"round", angle:0, spacing:10, scatter:0, strength:50 },
        };
        this._contentBoundsCache = new Map();
        this.selectedIndices = new Set(); // multi-layer selection (stores layer indices)
    }

    // ─── Open / Close ─────────────────────────────────────────

    open(jsonStr) {
        injectPaintExtraStyles();
        this._buildModal();
        this._layout.mount();
        this._bindEvents();

        let data = {};
        try { data = jsonStr && jsonStr !== "{}" ? JSON.parse(jsonStr) : {}; } catch (e) {}

        this.docW = data.doc_w || 1024;
        this.docH = data.doc_h || 1024;
        this.bgColor = data.background_color || "#ffffff";
        this.projectId = data.project_id || ("pnt_" + Date.now());

        this._initCanvases();
        this._applyDocSize();

        if (data.layers && data.layers.length > 0) {
            this._loadLayers(data.layers).then(() => {
                this.selectedIndices.clear(); this.selectedIndices.add(this.activeIdx);
                this._renderDisplay();
                this._updateLayersPanel();
                requestAnimationFrame(() => requestAnimationFrame(() => this._fitToView()));
            });
        } else {
            this._addLayer("Background");
            this._renderDisplay();
            requestAnimationFrame(() => requestAnimationFrame(() => this._fitToView()));
        }

        this._updateColorUI();
        this._updateToolOptions();
        this._updateDocProps();
    }

    _close() {
        if (this._layout) this._layout.unmount();
        this._unbindEvents();
        if (this.onClose) this.onClose();
    }

    // ─── Build Modal ──────────────────────────────────────────

    _buildModal() {
        // ── Create editor layout using the shared framework ──
        const helpHTML = `
<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 12px;color:#ccc;font-size:10px;">
<b style="color:#f66744;">--- Tools ---</b><span></span>
<b>B</b><span>Brush — soft-edge paint</span>
<b>P</b><span>Pencil — hard-edge precise drawing</span>
<b>E</b><span>Eraser — erase pixels on active layer</span>
<b>G</b><span>Fill bucket — flood fill area</span>
<b>I</b><span>Eyedropper — sample color from canvas</span>
<b>R</b><span>Smudge — blend/smear pixels</span>
<b>U</b><span>Shape tool — rectangle, ellipse, line, triangle, polygon</span>
<b>V / T</b><span>Move/Transform — move, scale, rotate, flip layer</span>
<b style="color:#f66744;">--- Brush ---</b><span></span>
<b>[ / ]</b><span>Brush size \u00b12px (Shift = \u00b110px)</span>
<b>Alt+drag</b><span>Temp eyedropper while painting</span>
<b>Shift+click</b><span>Draw straight line from last point</span>
<b style="color:#f66744;">--- Transform ---</b><span></span>
<b>Drag inside</b><span>Move layer(s)</span>
<b>Corner handles</b><span>Scale (uniform)</span>
<b>Top circle</b><span>Rotate (Shift = snap 15\u00b0)</span>
<b>Center dot</b><span>Move pivot point</span>
<b>Enter</b><span>Apply (bake) transform</span>
<b>Esc</b><span>Reset transform to identity</span>
<b style="color:#f66744;">--- Selection ---</b><span></span>
<b>Click canvas</b><span>Select topmost layer at pixel</span>
<b>Ctrl+click</b><span>Add/remove layer from multi-selection</span>
<b>Ctrl+A</b><span>Select all layers</span>
<b style="color:#f66744;">--- General ---</b><span></span>
<b>X</b><span>Swap foreground/background colors</span>
<b>D</b><span>Reset to Black/White</span>
<b>Ctrl+Z</b><span>Undo</span>
<b>Ctrl+Shift+Z / Ctrl+Y</b><span>Redo</span>
<b>Ctrl+D</b><span>Duplicate layer</span>
<b>Ctrl+S</b><span>Save & close</span>
<b>Space+drag</b><span>Pan canvas</span>
<b>Scroll wheel</b><span>Zoom in/out at cursor</span>
<b>Ctrl+scroll</b><span>Pan vertically</span>
<b>Delete</b><span>Clear active layer pixels</span>
<b>?</b><span>Toggle this help</span>
</div>
<div style="color:#888;font-size:9px;margin-top:8px;border-top:1px solid #333;padding-top:6px;">
Layers: click in panel to select, Ctrl+click for multi-select, drag to reorder, double-click to rename<br>
Multi-move: select multiple layers with Ctrl+click, then drag to move them all together<br>
Blend modes: Normal, Multiply, Screen, Overlay, Soft/Hard Light, Color Dodge/Burn, and more
</div>`;

        const layout = createEditorLayout({
            editorName: "Paint",
            showUndoRedo: true,
            showTopOptionsBar: true,
            showStatusBar: true,
            showZoomBar: true,
            onSave: () => this._save(),
            onClose: () => this._close(),
            onUndo: () => this.undo(),
            onRedo: () => this.redo(),
            onZoomIn: () => { this._zoomAt(null, 0.15); },
            onZoomOut: () => { this._zoomAt(null, -0.15); },
            onZoomFit: () => { this._fitToView(); },
            helpContent: helpHTML,
        });

        this._layout = layout;
        layout.onSaveToDisk = () => { this._diskSavePending = true; this._save(); };
        layout.onCleanup = () => this._unbindEvents();
        this.el.overlay = layout.overlay;
        this.el.undoBtn = layout.undoBtn;
        this.el.redoBtn = layout.redoBtn;
        this.el.saveBtn = layout.saveBtn;
        this.el.topOpts = layout.topOptionsBar;

        // ── Help strip content goes into the framework status bar ──
        this.el.helpStrip = layout.statusText;
        if (layout.statusText) layout.statusText.textContent = "Drag to paint \u00b7 [ / ] resize \u00b7 Shift+click = straight line \u00b7 Alt+drag = temp eyedropper \u00b7 \u00dc resets defaults";

        // ── Build left sidebar content ──
        this._buildLeftContent(layout.leftSidebar);

        // ── Build workspace content ──
        this._buildWorkspaceContent(layout.workspace);

        // Enable drag & drop on workspace
        if (this._canvasToolbar) this._canvasToolbar.setupDropZone(layout.workspace);

        // ── Build right sidebar content (before sidebarFooter) ──
        this._buildRightContent(layout.rightSidebar, layout.sidebarFooter);
    }

    // ─── Left Sidebar: Canvas Settings + Tools + Color ──────────

    _buildLeftContent(container) {


        // Tools section
        const toolPanel = createPanel("Tools");
        const toolbox = document.createElement("div");
        toolbox.style.cssText = "display:grid;grid-template-columns:repeat(4,1fr);gap:4px;";
        const UI_ICON = "/pixaroma/assets/icons/ui/";
        const TOOLS = [
            { id:"transform", icon:"move.svg",        label:"Move",     tip:"Move/Transform (V or T) \u2014 Move, scale, rotate layer\nDrag = move \u00b7 Corner = scale \u00b7 Top = rotate\nEnter = Apply \u00b7 Esc = Reset" },
            { id:"brush",     icon:"brush.svg",       label:"Brush",    tip:"Brush (B) \u2014 Soft-edge paint brush" },
            { id:"pencil",    icon:"pencil.svg",      label:"Pencil",   tip:"Pencil (P) \u2014 Hard-edge precise drawing" },
            { id:"eraser",    icon:"eraser.svg",      label:"Eraser",   tip:"Eraser (E) \u2014 Erase pixels on active layer" },
            { id:"smudge",    icon:"smudge.svg",      label:"Smudge",   tip:"Smudge (R) \u2014 Smudge/blend brush" },
            { id:"fill",      icon:"fill.svg",        label:"Fill",     tip:"Fill (G) \u2014 Flood fill with foreground color" },
            { id:"shape",     icon:"shape.svg",       label:"Shape",    tip:"Shape (U) \u2014 Draw shapes: Rectangle, Ellipse, Line, Triangle" },
            { id:"pick",      icon:"eyedropper.svg",  label:"Eyedrop",  tip:"Eyedropper (I) \u2014 Sample color from canvas (Alt+brush for temp)" },
        ];
        TOOLS.forEach(t => {
            const btn = document.createElement("div");
            btn.className = "pxf-tool-btn" + (this.tool === t.id ? " active" : "");
            btn.title = t.tip;
            btn.innerHTML = `<span class="pxf-tool-btn-icon"><img src="${UI_ICON}${t.icon}" style="width:18px;height:18px;pointer-events:none;filter:brightness(0) invert(1);"></span><span class="pxf-tool-btn-label">${t.label}</span>`;
            btn.addEventListener("click", () => this._setTool(t.id));
            this.el[`toolBtn_${t.id}`] = btn;
            toolbox.appendChild(btn);
        });
        toolPanel.content.appendChild(toolbox);
        container.appendChild(toolPanel.el);
        container.appendChild(createDivider());

        // Canvas section
        container.appendChild(this._buildCanvasSection());
        container.appendChild(createDivider());

        // Color section
        const colorPanel = createPanel("Color");
        const colorArea = colorPanel.content;
        colorArea.style.cssText = "display:flex;flex-direction:column;gap:6px;";

        const svCvs = document.createElement("canvas");
        svCvs.className = "ppx-sv-canvas"; svCvs.width = 160; svCvs.height = 100;
        this.el.svCvs = svCvs; colorArea.appendChild(svCvs);

        const hCvs = document.createElement("canvas");
        hCvs.className = "ppx-hue-canvas"; hCvs.width = 160; hCvs.height = 14;
        this.el.hCvs = hCvs; colorArea.appendChild(hCvs);

        const fgbgRow = document.createElement("div");
        fgbgRow.className = "ppx-swatches-fg-bg";
        const fgSwatch = document.createElement("div");
        fgSwatch.className = "ppx-fg-swatch"; fgSwatch.title = "Foreground (active)";
        fgSwatch.style.background = this.fgColor;
        fgSwatch.addEventListener("click", () => { this.colorMode = "fg"; this._updateColorUI(); });
        this.el.fgSwatch = fgSwatch;
        const bgSwatch = document.createElement("div");
        bgSwatch.className = "ppx-bg-swatch"; bgSwatch.title = "Background color (X to swap)";
        bgSwatch.style.background = this.bgColor2;
        bgSwatch.addEventListener("click", () => { this.colorMode = "bg"; this._updateColorUI(); });
        this.el.bgSwatch = bgSwatch;
        const swapBtn = document.createElement("button");
        swapBtn.className = "ppx-swap-btn"; swapBtn.title = "Swap FG/BG (X)"; swapBtn.textContent = "\u21c4";
        swapBtn.addEventListener("click", () => this._swapColors());
        const resetColorBtn = document.createElement("button");
        resetColorBtn.className = "ppx-swap-btn"; resetColorBtn.title = "Reset to Black/White (D)"; resetColorBtn.textContent = "\u2b1b";
        resetColorBtn.addEventListener("click", () => { this.fgColor = "#000000"; this.bgColor2 = "#ffffff"; this.colorMode = "fg"; this._updateColorUI(); });
        fgbgRow.append(fgSwatch, bgSwatch, swapBtn, resetColorBtn);
        colorArea.appendChild(fgbgRow);

        const hexRow = document.createElement("div");
        hexRow.className = "ppx-hex-row";
        const hexLbl = document.createElement("label"); hexLbl.textContent = "#";
        const hexInput = document.createElement("input");
        hexInput.type = "text"; hexInput.maxLength = 6; hexInput.value = this.fgColor.slice(1).toUpperCase();
        hexInput.addEventListener("input", (e) => {
            const v = e.target.value.replace(/[^0-9a-fA-F]/g, "");
            if (v.length === 6) this._setColorFromHex("#" + v);
        });
        hexInput.addEventListener("change", (e) => {
            const v = e.target.value.replace(/[^0-9a-fA-F]/g, "").padEnd(6, "0").slice(0, 6);
            this._setColorFromHex("#" + v);
        });
        this.el.hexInput = hexInput;
        hexRow.append(hexLbl, hexInput); colorArea.appendChild(hexRow);

        // HSL sliders
        const hslLbl = document.createElement("div");
        hslLbl.style.cssText = "font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.06em;margin-top:2px;";
        hslLbl.textContent = "HSL Adjust";
        colorArea.appendChild(hslLbl);

        const mkHslRow = (label, min, max, field) => {
            const row = document.createElement("div"); row.className = "ppx-hsl-row";
            const lbl = document.createElement("label"); lbl.textContent = label;
            const slider = document.createElement("input"); slider.type = "range"; slider.min = min; slider.max = max; slider.value = 0;
            const num = document.createElement("input"); num.type = "number"; num.min = min; num.max = max; num.value = 0;
            const update = (v) => {
                slider.value = v; num.value = v;
                this._applyHSLAdjust(field, parseFloat(v));
            };
            slider.addEventListener("input", () => update(slider.value));
            num.addEventListener("change", () => update(num.value));
            row.append(lbl, slider, num);
            colorArea.appendChild(row);
            this.el[`hsl_${field}`] = { slider, num };
        };
        mkHslRow("H", -180, 180, "h");
        mkHslRow("S", -100, 100, "s");
        mkHslRow("L", -100, 100, "l");

        const swatchLbl = document.createElement("div");
        swatchLbl.style.cssText = "font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.06em;margin-top:2px;";
        swatchLbl.textContent = "Recent";
        colorArea.appendChild(swatchLbl);
        const swatchGrid = document.createElement("div");
        swatchGrid.className = "ppx-swatches-grid";
        this.el.swatchGrid = swatchGrid;
        for (let i = 0; i < 16; i++) {
            const sw = document.createElement("div");
            sw.className = "ppx-swatch";
            sw.addEventListener("click", () => { if (sw.dataset.color) this._setColorFromHex(sw.dataset.color); });
            swatchGrid.appendChild(sw);
        }
        this._initDefaultSwatches();
        colorArea.appendChild(swatchGrid);

        container.appendChild(colorPanel.el);
    }

    // ─── Canvas Settings Section ──────────────────────────────

    _buildCanvasSection() {
        // Use a wrapper div to hold canvas settings + extra controls
        const wrapper = document.createElement("div");

        // Canvas Settings — unified component (FIRST in left sidebar)
        this._canvasSettings = createCanvasSettings({
            width: this.docW,
            height: this.docH,
            ratioIndex: 0,
            onChange: ({ width, height, ratioIndex }) => {
                this.el.docW.value = width;
                this.el.docH.value = height;
                this._resizeDoc();
            },
        });
        wrapper.appendChild(this._canvasSettings.el);

        // Hidden inputs to keep _resizeDoc working (it reads el.docW / el.docH)
        const wInput = document.createElement("input"); wInput.type = "hidden"; wInput.value = this.docW;
        const hInput = document.createElement("input"); hInput.type = "hidden"; hInput.value = this.docH;
        this.el.docW = wInput; this.el.docH = hInput;
        wrapper.append(wInput, hInput);

        // Canvas Toolbar (BG color + Load Image + Clear All)
        this._canvasToolbar = createCanvasToolbar({
            onAddImage: (file) => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const img = new Image();
                    img.onload = () => {
                        const ly = this._makeLayer(file.name.replace(/\.[^.]+$/, ""));
                        const scale = Math.min(this.docW / img.width, this.docH / img.height, 1);
                        const dw = img.width * scale, dh = img.height * scale;
                        const dx = (this.docW - dw) / 2, dy = (this.docH - dh) / 2;
                        ly.ctx.drawImage(img, dx, dy, dw, dh);
                        this.layers.unshift(ly);
                        this.activeIdx = 0;
                        this.selectedIndices.clear(); this.selectedIndices.add(this.activeIdx);
                        this._pushHistory();
                        this._updateLayersPanel(); this._renderDisplay();
                        this._setStatus(`Image "${file.name}" loaded \u2014 Move tool selected`);
                        this._setTool("transform");
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(file);
            },
            onBgColorChange: (hex) => { this.bgColor = hex; if (this.el.bgPreview) this.el.bgPreview.style.background = hex; this._renderDisplay(); },
            onClear: () => {
                this._pushFullSnapshot();
                this.layers = [];
                this._contentBoundsCache.clear();
                const bg = this._makeLayer("Background");
                this.layers.unshift(bg);
                this.activeIdx = 0;
                this.selectedIndices = new Set([0]);
                this._updateLayersPanel(); this._renderDisplay();
                this._setStatus("Canvas cleared");
            },
            bgColor: this.bgColor || "#ffffff",
            onReset: () => {
                this._pushFullSnapshot(); // save BEFORE reset so single undo restores
                // Reset canvas size
                this.docW = 1024; this.docH = 1024;
                if (this.el.docW) this.el.docW.value = 1024;
                if (this.el.docH) this.el.docH.value = 1024;
                if (this._canvasSettings) { this._canvasSettings.setSize(1024, 1024); this._canvasSettings.setRatio(0); }
                // Reset bg color
                this.bgColor = "#ffffff";
                if (this._canvasToolbar) this._canvasToolbar.setBgColor("#ffffff");
                if (this.el.bgPreview) this.el.bgPreview.style.background = "#ffffff";
                // Clear layers and create fresh background (no history push)
                this.layers = [];
                this._contentBoundsCache.clear();
                this._applyDocSize();
                const bg = this._makeLayer("Background");
                this.layers.unshift(bg);
                this.activeIdx = 0;
                this.selectedIndices = new Set([0]);
                this._updateLayersPanel(); this._renderDisplay();
                this._fitToView();
                this._setStatus("Reset to default");
            },
        });
        // ── Transform Panel (unified, applies to selected layer) ──
        this._transformPanel = createTransformPanel({
            onFitWidth: () => {
                const ly = this.layers[this.activeIdx]; if (!ly) return;
                this._fitLayerToCanvas(ly, "w"); this._syncTransformPanel(); this._updateTransformWarn(); this._renderDisplay();
            },
            onFitHeight: () => {
                const ly = this.layers[this.activeIdx]; if (!ly) return;
                this._fitLayerToCanvas(ly, "h"); this._syncTransformPanel(); this._updateTransformWarn(); this._renderDisplay();
            },
            onFlipH: () => { const ly = this.layers[this.activeIdx]; if (ly) { ly.transform.flipX = !ly.transform.flipX; this._renderDisplay(); } },
            onFlipV: () => { const ly = this.layers[this.activeIdx]; if (ly) { ly.transform.flipY = !ly.transform.flipY; this._renderDisplay(); } },
            onRotateCCW: () => {
                const ly = this.layers[this.activeIdx]; if (!ly) return;
                ly.transform.rotation = ((ly.transform.rotation || 0) - 90 + 360) % 360;
                this._syncTransformPanel(); this._renderDisplay();
            },
            onRotateCW: () => {
                const ly = this.layers[this.activeIdx]; if (!ly) return;
                ly.transform.rotation = ((ly.transform.rotation || 0) + 90) % 360;
                this._syncTransformPanel(); this._renderDisplay();
            },
            onReset: () => {
                const ly = this.layers[this.activeIdx];
                if (ly) { ly.transform = {x:0,y:0,scaleX:1,scaleY:1,rotation:0,flipX:false,flipY:false,pivotOffX:0,pivotOffY:0}; this._syncTransformPanel(); this._updateTransformWarn(); this._renderDisplay(); }
            },
            onRotateChange: (deg) => {
                const ly = this.layers[this.activeIdx]; if (!ly) return;
                ly.transform.rotation = parseInt(deg);
                this._renderDisplay();
            },
            onScaleChange: (pct) => {
                const ly = this.layers[this.activeIdx]; if (!ly) return;
                const v = parseFloat(pct) / 100;
                ly.transform.scaleX = v; ly.transform.scaleY = v;
                if (this._transformPanel.setStretchH) this._transformPanel.setStretchH(pct);
                if (this._transformPanel.setStretchV) this._transformPanel.setStretchV(pct);
                this._renderDisplay();
            },
            onStretchHChange: (pct) => {
                const ly = this.layers[this.activeIdx]; if (!ly) return;
                ly.transform.scaleX = parseFloat(pct) / 100;
                this._renderDisplay();
            },
            onStretchVChange: (pct) => {
                const ly = this.layers[this.activeIdx]; if (!ly) return;
                ly.transform.scaleY = parseFloat(pct) / 100;
                this._renderDisplay();
            },
            onOpacityChange: (pct) => {
                const ly = this.layers[this.activeIdx]; if (!ly) return;
                ly.opacity = parseFloat(pct);
                this._updateLayerThumb(this.activeIdx); this._renderDisplay();
            },
            showRotateSlider: true,
            showScaleSlider: true,
            showStretchSliders: true,
            showOpacitySlider: true,
        });

        // Transform auto-applies when switching tools — no Apply button needed.
        // Warning shown when transform is pending (Enter to apply manually)
        const warnDiv = document.createElement("div");
        warnDiv.className = "ppx-transform-warn";
        warnDiv.textContent = "Transform auto-applies when switching tools. Enter = apply now.";
        warnDiv.style.display = "none";
        this.el.transformWarn = warnDiv;
        this._transformPanel.content.insertBefore(warnDiv, this._transformPanel.content.firstChild);

        // Store ref for old code that checks this.el.transformPanel
        this.el.transformPanel = this._transformPanel.el;
        wrapper.appendChild(this._transformPanel.el);

        // Keep bgPreview reference for existing code that updates it
        this.el.bgPreview = null; // toolbar manages BG color now
        wrapper.appendChild(this._canvasToolbar.el);

        return wrapper;
    }

    // ─── Workspace Content ────────────────────────────────────

    _buildWorkspaceContent(ws) {
        // Workspace uses framework's default dark background (unified with Composer)
        this.el.workspace = ws;

        const vp = document.createElement("div");
        vp.className = "ppx-canvas-viewport";
        this.el.viewport = vp;
        ws.appendChild(vp);

        const disp = document.createElement("canvas");
        disp.width = this.docW; disp.height = this.docH;
        this.el.displayCanvas = disp;
        vp.appendChild(disp);

        const cursorCvs = document.createElement("canvas");
        cursorCvs.className = "ppx-cursor-canvas";
        cursorCvs.width = this.docW; cursorCvs.height = this.docH;
        this.el.cursorCvs = cursorCvs;
        vp.appendChild(cursorCvs);

        // Dimension label (bottom-right of viewport, like other editors)
        const dimLabel = document.createElement("div");
        dimLabel.className = "pxf-canvas-frame-label";
        dimLabel.style.cssText = "position:absolute;bottom:-18px;right:0;";
        dimLabel.textContent = `${this.docW}\u00d7${this.docH}`;
        vp.appendChild(dimLabel);
        this.el.dimLabel = dimLabel;

        ws.addEventListener("mouseleave", () => {
            if (this.el.cursorCvs) this.el.cursorCvs.getContext("2d").clearRect(0, 0, this.docW, this.docH);
        });

        // Use framework zoom bar — store reference for zoom label updates
        this.el.zoomLabel = null; // now managed by framework via _layout.setZoomLabel()

        // Help overlay is already created by the framework — store reference
        this.el.helpOverlay = this._layout.helpPanel;
    }

    // ─── Right Sidebar Content ────────────────────────────────

    _buildRightContent(container, sidebarFooter) {
        // Unified layer panel (blend mode + opacity + layers list + action buttons)
        this._layerPanel = createLayerPanel({
            showBlendMode: true,
            showOpacity: true,
            blendModes: [
                {value:"source-over",label:"Normal"},{value:"multiply",label:"Multiply"},
                {value:"screen",label:"Screen"},{value:"overlay",label:"Overlay"},
                {value:"soft-light",label:"Soft Light"},{value:"hard-light",label:"Hard Light"},
                {value:"color-dodge",label:"Color Dodge"},{value:"color-burn",label:"Color Burn"},
                {value:"darken",label:"Darken"},{value:"lighten",label:"Lighten"},
                {value:"difference",label:"Difference"},{value:"exclusion",label:"Exclusion"},
                {value:"hue",label:"Hue"},{value:"saturation",label:"Saturation"},
                {value:"color",label:"Color"},{value:"luminosity",label:"Luminosity"},
            ],
            onBlendChange: (val) => {
                const ly = this.layers[this.activeIdx]; if (ly) { ly.blendMode = val; this._renderDisplay(); }
            },
            onOpacityChange: (val) => {
                const ly = this.layers[this.activeIdx]; if (!ly) return;
                ly.opacity = val;
                this._updateLayerThumb(this.activeIdx); this._renderDisplay();
            },
            onAdd: () => this._addLayer(),
            onDuplicate: () => this._duplicateLayer(),
            onDelete: () => this._deleteLayer(),
            onMoveUp: () => this._moveLayer(-1),
            onMoveDown: () => this._moveLayer(1),
            onMerge: () => this._mergeDown(),
            onFlatten: () => this._flattenAll(),
            onReorder: (fromIdx, toIdx) => {
                const dragged = this.layers.splice(fromIdx, 1)[0];
                this.layers.splice(toIdx, 0, dragged);
                this.activeIdx = toIdx;
                this._updateLayersPanel(); this._renderDisplay();
            },
        });
        // Keep backward-compatible refs for _syncLayerProps
        this.el.blendSel = this._layerPanel.blendSelect;
        this.el.layerOpRange = this._layerPanel.opacitySlider;
        this.el.layerOpNum = this._layerPanel.opacityNum;
        this.el.layerList = this._layerPanel.list;
        container.insertBefore(this._layerPanel.el, sidebarFooter);

        // Clear layer (flatten is now an icon in the layer action bar)
        const actsPanel = createPanel("Actions");
        const clearLyrBtn = createButton("Clear Layer", { variant: "danger", title: "Erase all pixels on the active layer", onClick: () => this._clearLayer() });
        clearLyrBtn.style.cssText = "width:100%;font-size:11px;padding:5px 6px;";
        actsPanel.content.appendChild(clearLyrBtn);
        container.insertBefore(actsPanel.el, sidebarFooter);
    }

    // ─── Helpers ──────────────────────────────────────────────

    _mkBtn(text, onClick, cls = "pxf-btn", title = "") {
        // Map old ppx- classes to framework pxf- classes
        const mapped = cls
            .replace(/\bppx-btn-accent\b/g, "pxf-btn-accent")
            .replace(/\bppx-btn-danger\b/g, "pxf-btn-danger")
            .replace(/\bppx-btn-sm\b/g, "pxf-btn-sm")
            .replace(/\bppx-btn\b/g, "pxf-btn");
        const btn = document.createElement("button");
        btn.className = mapped; btn.textContent = text;
        if (title) btn.title = title;
        btn.addEventListener("click", onClick);
        return btn;
    }
    _sep()  { return createDivider(); }
    _wsep() { const d = document.createElement("div"); d.className = "ppx-sep"; return d; }
    _setStatus(msg) { if (this._layout) this._layout.setStatus(msg); }
}

// Re-export dependencies that mixin files need
export { PaintAPI, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, rgbToHsl, hslToRgb };
export { createDivider, createLayerItem, createPanel, createButton };
