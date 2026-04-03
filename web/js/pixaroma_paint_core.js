// ============================================================
// Pixaroma Paint Studio — Core + Full UI  v4 (Framework)
// ============================================================
import { BrushEngine, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, rgbToHsl, hslToRgb } from "./pixaroma_paint_engine.js";
import { PaintAPI } from "./pixaroma_paint_api.js";
// installFocusTrap is used internally by the editor framework's layout.mount()
import {
    createEditorLayout, createPanel, createButton, createSliderRow,
    createRow, createNumberInput, createSelectInput, createColorInput,
    createButtonRow, createCheckbox, createDivider, createCanvasSettings,
    createLayerPanel, createLayerItem, createCanvasToolbar, createTransformPanel, BRAND
} from "./pixaroma_editor_framework.js";

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
<b>[ / ]</b><span>Brush size ±2px (Shift = ±10px)</span>
<b>Alt+drag</b><span>Temp eyedropper while painting</span>
<b>Shift+click</b><span>Draw straight line from last point</span>
<b style="color:#f66744;">--- Transform ---</b><span></span>
<b>Drag inside</b><span>Move layer(s)</span>
<b>Corner handles</b><span>Scale (uniform)</span>
<b>Top circle</b><span>Rotate (Shift = snap 15°)</span>
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
        if (layout.statusText) layout.statusText.textContent = "Drag to paint · [ / ] resize · Shift+click = straight line · Alt+drag = temp eyedropper · Ü resets defaults";

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
                        this._setStatus(`Image "${file.name}" loaded — Move tool selected`);
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

    // ─── Canvas init ──────────────────────────────────────────

    _initCanvases() {
        this.el.displayCanvas.width = this.docW; this.el.displayCanvas.height = this.docH;
        this.strokeCanvas = document.createElement("canvas");
        this.strokeCanvas.width = this.docW; this.strokeCanvas.height = this.docH;
        this.strokeCtx = this.strokeCanvas.getContext("2d");
    }

    _applyDocSize() {
        this.el.displayCanvas.width = this.docW; this.el.displayCanvas.height = this.docH;
        if (this.el.cursorCvs) { this.el.cursorCvs.width = this.docW; this.el.cursorCvs.height = this.docH; }
        if (this.strokeCanvas) { this.strokeCanvas.width = this.docW; this.strokeCanvas.height = this.docH; }
    }

    // ─── Layer management ─────────────────────────────────────

    _makeLayer(name) {
        const cvs = document.createElement("canvas");
        cvs.width = this.docW; cvs.height = this.docH;
        const id = "pylyr_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
        return {
            id, name: name || "Layer " + (this.layers.length + 1),
            canvas: cvs, ctx: cvs.getContext("2d"),
            visible: true, locked: false, opacity: 100, blendMode: "source-over",
            transform: { x:0, y:0, scaleX:1, scaleY:1, rotation:0, flipX:false, flipY:false, pivotOffX:0, pivotOffY:0 },
        };
    }

    _addLayer(name) {
        const ly = this._makeLayer(name);
        this.layers.unshift(ly); this.activeIdx = 0;
        this.selectedIndices.clear(); this.selectedIndices.add(0);
        this._pushHistory();
        this._updateLayersPanel(); this._renderDisplay();
        this._setStatus(`Layer "${ly.name}" added`);
    }

    _deleteLayer() {
        if (this.layers.length <= 1) { this._setStatus("Cannot delete last layer"); return; }
        this._pushFullSnapshot();
        // Delete all selected layers (or just active if no multi-select)
        const toDelete = this.selectedIndices.size > 0 ? [...this.selectedIndices].sort((a,b) => b-a) : [this.activeIdx];
        if (toDelete.length >= this.layers.length) {
            // Delete all but create a fresh empty layer
            this.layers = [];
            const bg = this._makeLayer("Background");
            this.layers.push(bg);
            this.activeIdx = 0;
            this.selectedIndices = new Set([0]);
            this._updateLayersPanel(); this._renderDisplay();
            this._setStatus("All layers deleted — fresh background created");
            return;
        }
        toDelete.forEach(idx => this.layers.splice(idx, 1));
        this.selectedIndices.clear();
        this.activeIdx = Math.max(0, Math.min(this.activeIdx, this.layers.length - 1));
        this.selectedIndices.add(this.activeIdx);
        this._updateLayersPanel(); this._renderDisplay();
    }

    _duplicateLayer() {
        const src = this.layers[this.activeIdx]; if (!src) return;
        const ly = this._makeLayer(src.name + " copy");
        ly.blendMode = src.blendMode; ly.opacity = src.opacity;
        ly.transform = { ...src.transform };
        ly.ctx.drawImage(src.canvas, 0, 0);
        this._pushFullSnapshot();
        this.layers.splice(this.activeIdx, 0, ly);
        this.selectedIndices.clear(); this.selectedIndices.add(this.activeIdx);
        this._updateLayersPanel(); this._renderDisplay();
    }

    _moveLayer(dir) {
        const i = this.activeIdx, j = i + dir;
        if (j < 0 || j >= this.layers.length) return;
        [this.layers[i], this.layers[j]] = [this.layers[j], this.layers[i]];
        this.activeIdx = j;
        this.selectedIndices.clear(); this.selectedIndices.add(j);
        this._updateLayersPanel(); this._renderDisplay();
    }

    _clearLayer() {
        const ly = this.layers[this.activeIdx]; if (!ly || ly.locked) return;
        this._pushHistory();
        ly.ctx.clearRect(0, 0, this.docW, this.docH);
        this._contentBoundsCache.delete(ly.id);
        this._updateLayerThumb(this.activeIdx); this._renderDisplay();
        this._setStatus("Layer cleared");
    }

    _mergeDown() {
        const i = this.activeIdx;
        if (i >= this.layers.length - 1) { this._setStatus("No layer below"); return; }
        this._pushFullSnapshot();
        const top = this.layers[i], bot = this.layers[i + 1];
        bot.ctx.save();
        bot.ctx.globalAlpha = top.opacity / 100;
        bot.ctx.globalCompositeOperation = top.blendMode;
        this._drawLayerWithTransform(bot.ctx, top);
        bot.ctx.restore();
        this.layers.splice(i, 1);
        this.activeIdx = Math.min(i, this.layers.length - 1);
        this.selectedIndices.clear(); this.selectedIndices.add(this.activeIdx);
        this._contentBoundsCache.delete(bot.id);
        this._updateLayersPanel(); this._renderDisplay();
    }

    _flattenAll() {
        if (this.layers.length <= 1) return;
        // Save full layer stack for undo (destructive operation)
        this._pushFullSnapshot();
        const merged = this._makeLayer("Merged");
        merged.ctx.fillStyle = this.bgColor; merged.ctx.fillRect(0, 0, this.docW, this.docH);
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const ly = this.layers[i]; if (!ly.visible) continue;
            merged.ctx.save();
            merged.ctx.globalAlpha = ly.opacity / 100;
            merged.ctx.globalCompositeOperation = ly.blendMode;
            this._drawLayerWithTransform(merged.ctx, ly);
            merged.ctx.restore();
        }
        this.layers = [merged]; this.activeIdx = 0;
        this._contentBoundsCache.clear();
        this._updateLayersPanel(); this._renderDisplay();
    }

    async _loadLayers(layersData) {
        this.layers = [];
        for (const ld of layersData) {
            const ly = this._makeLayer(ld.name || "Layer");
            ly.id = ld.id || ly.id;
            ly.visible  = ld.visible !== false;
            ly.locked   = ld.locked  === true;
            ly.opacity  = ld.opacity  ?? 100;
            ly.blendMode = ld.blend_mode || "source-over";
            ly.transform = ld.transform ? { pivotOffX:0, pivotOffY:0, ...ld.transform } : {x:0,y:0,scaleX:1,scaleY:1,rotation:0,flipX:false,flipY:false,pivotOffX:0,pivotOffY:0};
            if (ld.src) {
                await new Promise(res => {
                    const img = new Image(); img.crossOrigin = "anonymous";
                    img.onload  = () => { ly.ctx.drawImage(img, 0, 0); res(); };
                    img.onerror = () => { console.warn("[Paint] Failed to load layer:", ld.src); res(); };
                    const fileNameOnly = ld.src.split(/[\\/]/).pop();
                    img.src = `/view?filename=${encodeURIComponent(fileNameOnly)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
                });
            }
            this.layers.push(ly);
        }
        if (this.layers.length === 0) this._addLayer("Layer 1");
        this.activeIdx = 0;
    }

    // ─── Rendering ────────────────────────────────────────────

    _drawLayerWithTransform(ctx, ly) {
        const t = ly.transform;
        const pox = t.pivotOffX || 0;
        const poy = t.pivotOffY || 0;
        const pivX = this.docW / 2 + pox;
        const pivY = this.docH / 2 + poy;
        const hasTransform = t.x !== 0 || t.y !== 0 || t.scaleX !== 1 || t.scaleY !== 1 || t.rotation !== 0 || t.flipX || t.flipY || pox !== 0 || poy !== 0;
        if (hasTransform) {
            ctx.save();
            ctx.translate(t.x + pivX, t.y + pivY);
            ctx.rotate(t.rotation * Math.PI / 180);
            ctx.scale(t.scaleX * (t.flipX ? -1:1), t.scaleY * (t.flipY ? -1:1));
            ctx.drawImage(ly.canvas, -pivX, -pivY);
            ctx.restore();
        } else {
            ctx.drawImage(ly.canvas, 0, 0);
        }
    }

    _renderDisplay() {
        const ctx = this.el.displayCanvas.getContext("2d");
        ctx.clearRect(0, 0, this.docW, this.docH);
        ctx.fillStyle = this.bgColor; ctx.fillRect(0, 0, this.docW, this.docH);

        for (let i = this.layers.length - 1; i >= 0; i--) {
            const ly = this.layers[i]; if (!ly.visible) continue;
            ctx.save();
            ctx.globalAlpha = ly.opacity / 100;
            ctx.globalCompositeOperation = ly.blendMode;
            this._drawLayerWithTransform(ctx, ly);
            ctx.restore();
        }

        // Stroke overlay (during drawing) — brush/pencil show accumulation, eraser shows preview
        if (this.isDrawing && this.strokeCanvas && (this.tool === "brush" || this.tool === "pencil")) {
            ctx.save();
            ctx.globalAlpha = this.brush.opacity / 100;
            ctx.drawImage(this.strokeCanvas, 0, 0);
            ctx.restore();
        }
        if (this.isDrawing && this.strokeCanvas && this.tool === "eraser") {
            // Show eraser preview as semi-transparent darkening
            ctx.save();
            ctx.globalAlpha = (this.brush.opacity / 100) * 0.4;
            ctx.globalCompositeOperation = "destination-out";
            ctx.drawImage(this.strokeCanvas, 0, 0);
            ctx.restore();
        }

        // Transform handles + multi-select outlines
        if (this.tool === "transform") {
            // Draw blue outlines for other selected layers
            this.selectedIndices.forEach(idx => {
                if (idx === this.activeIdx) return;
                const sl = this.layers[idx]; if (!sl) return;
                const corners = this._getLayerCorners(sl);
                ctx.save();
                ctx.strokeStyle = "#0ea5e9"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(corners[0].x, corners[0].y);
                for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
                ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
                ctx.restore();
            });
            // Draw full handles for the active layer
            const ly = this.layers[this.activeIdx];
            if (ly) this._drawTransformHandles(ctx, ly);
        }

        if (this.showGrid) this._drawGrid(ctx);
    }

    _drawGrid(ctx) {
        const gs = 64;
        ctx.save(); ctx.strokeStyle = "rgba(200,200,255,0.12)"; ctx.lineWidth = 0.5;
        for (let x = 0; x <= this.docW; x += gs) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,this.docH); ctx.stroke(); }
        for (let y = 0; y <= this.docH; y += gs) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(this.docW,y); ctx.stroke(); }
        ctx.restore();
    }

    // ─── Transform Handles ────────────────────────────────────

    _getLayerCorners(ly) {
        const t = ly.transform;
        const b = this._getContentBounds(ly);
        const bx = b.x, by = b.y, bw = b.w, bh = b.h;
        const sx = t.scaleX * (t.flipX ? -1 : 1);
        const sy = t.scaleY * (t.flipY ? -1 : 1);
        const rad = t.rotation * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const pox = t.pivotOffX || 0, poy = t.pivotOffY || 0;
        const pivX = this.docW / 2 + pox, pivY = this.docH / 2 + poy;
        // Final screen position = (tx + pivX) + rotate+scale(point - pivot)
        const tp = (lx, ly2) => {
            const ax = (lx - pivX) * sx;
            const ay = (ly2 - pivY) * sy;
            return {
                x: t.x + pivX + ax * cos - ay * sin,
                y: t.y + pivY + ax * sin + ay * cos
            };
        };
        return [ tp(bx, by), tp(bx+bw, by), tp(bx+bw, by+bh), tp(bx, by+bh) ];
    }

    _drawTransformHandles(ctx, ly) {
        const corners = this._getLayerCorners(ly);
        const t = ly.transform;
        const pox = t.pivotOffX || 0, poy = t.pivotOffY || 0;
        const pivot = { x: t.x + this.docW / 2 + pox, y: t.y + this.docH / 2 + poy };

        // Dashed bounding box
        ctx.save();
        ctx.strokeStyle = "#f66744"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath(); ctx.stroke();
        ctx.setLineDash([]);

        // Corner handles (scale)
        const HR = 7;
        corners.forEach(c => {
            ctx.beginPath(); ctx.arc(c.x, c.y, HR, 0, Math.PI * 2);
            ctx.fillStyle = "#fff"; ctx.fill();
            ctx.strokeStyle = "#f66744"; ctx.lineWidth = 2; ctx.stroke();
        });

        // Rotation handle (above top center, direction away from pivot)
        const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
        const dx = topMid.x - pivot.x, dy = topMid.y - pivot.y;
        const len = Math.hypot(dx, dy) || 1;
        const rotH = { x: topMid.x + (dx / len) * 30, y: topMid.y + (dy / len) * 30 };

        ctx.beginPath(); ctx.moveTo(topMid.x, topMid.y); ctx.lineTo(rotH.x, rotH.y);
        ctx.strokeStyle = "#f66744"; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(rotH.x, rotH.y, HR, 0, Math.PI * 2);
        ctx.fillStyle = "#f66744"; ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = "bold 9px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("\u21bb", rotH.x, rotH.y);

        // Pivot point handle (draggable center)
        ctx.beginPath(); ctx.arc(pivot.x, pivot.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fill();
        ctx.strokeStyle = "#f66744"; ctx.lineWidth = 1.5; ctx.stroke();
        // Crosshair lines on pivot
        ctx.beginPath();
        ctx.moveTo(pivot.x - 8, pivot.y); ctx.lineTo(pivot.x + 8, pivot.y);
        ctx.moveTo(pivot.x, pivot.y - 8); ctx.lineTo(pivot.x, pivot.y + 8);
        ctx.strokeStyle = "#f66744"; ctx.lineWidth = 1; ctx.stroke();

        ctx.restore();
    }

    _hitTestHandle(docX, docY, ly) {
        const HR = 12;
        const corners = this._getLayerCorners(ly);
        const t = ly.transform;
        const pox = t.pivotOffX || 0, poy = t.pivotOffY || 0;
        const pivot = { x: t.x + this.docW / 2 + pox, y: t.y + this.docH / 2 + poy };

        // Pivot handle (highest priority)
        if (Math.hypot(docX - pivot.x, docY - pivot.y) <= HR) return { type: "pivot" };

        // Rotation handle
        const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
        const dx = topMid.x - pivot.x, dy = topMid.y - pivot.y;
        const len = Math.hypot(dx, dy) || 1;
        const rotH = { x: topMid.x + (dx / len) * 30, y: topMid.y + (dy / len) * 30 };
        if (Math.hypot(docX - rotH.x, docY - rotH.y) <= HR) return { type: "rotate", center: pivot };

        // Corner handles
        for (let i = 0; i < 4; i++) {
            if (Math.hypot(docX - corners[i].x, docY - corners[i].y) <= HR) {
                return { type: "scale", center: pivot, cornerIdx: i, corner: corners[i] };
            }
        }

        // Inside bounds (move)
        if (this._pointInQuad(docX, docY, corners)) return { type: "move" };

        return null;
    }

    // Convert document-space coordinates to raw layer canvas coordinates (inverse transform)
    _docToLayerCanvas(ly, x, y) {
        const t = ly.transform;
        const pox = t.pivotOffX || 0, poy = t.pivotOffY || 0;
        const pivX = this.docW / 2 + pox, pivY = this.docH / 2 + poy;
        const dx = x - (t.x + pivX), dy = y - (t.y + pivY);
        const rad = -t.rotation * Math.PI / 180;
        const cr = Math.cos(rad), sr = Math.sin(rad);
        const udx = dx * cr - dy * sr;
        const udy = dx * sr + dy * cr;
        const sx = t.scaleX * (t.flipX ? -1 : 1);
        const sy = t.scaleY * (t.flipY ? -1 : 1);
        return { x: udx / sx + pivX, y: udy / sy + pivY };
    }

    _pointInQuad(px, py, pts) {
        let inside = false;
        for (let i = 0, j = 3; i < 4; j = i++) {
            const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
            if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }

    // ─── View transform ───────────────────────────────────────

    _fitToView() {
        const wsRect = this.el.workspace.getBoundingClientRect();
        if (!wsRect.width || !wsRect.height) return;
        const wsW = wsRect.width, wsH = wsRect.height - 48;
        this.zoom = Math.min(wsW / this.docW, wsH / this.docH, 2.0);
        this.panX = (wsW - this.docW * this.zoom) / 2;
        this.panY = (wsH - this.docH * this.zoom) / 2;
        this._applyViewTransform();
    }

    _zoomAt(center, delta) {
        const wsRect = this.el.workspace.getBoundingClientRect();
        const mx = center ? center.x - wsRect.left : wsRect.width / 2;
        const my = center ? center.y - wsRect.top  : (wsRect.height - 48) / 2;
        const oldZ = this.zoom;
        this.zoom = Math.max(0.05, Math.min(8, this.zoom + delta));
        const scale = this.zoom / oldZ;
        this.panX = mx - (mx - this.panX) * scale;
        this.panY = my - (my - this.panY) * scale;
        this._applyViewTransform();
    }

    _applyViewTransform() {
        this.el.viewport.style.transform = `translate(${this.panX}px,${this.panY}px) scale(${this.zoom})`;
        const label = Math.round(this.zoom * 100) + "%";
        if (this.el.zoomLabel) this.el.zoomLabel.textContent = label;
        if (this._layout) this._layout.setZoomLabel(label);
    }

    _screenToDoc(ex, ey) {
        const vpRect = this.el.displayCanvas.getBoundingClientRect();
        return {
            x: (ex - vpRect.left) * (this.docW / vpRect.width),
            y: (ey - vpRect.top)  * (this.docH / vpRect.height),
        };
    }

    // ─── Event binding ────────────────────────────────────────

    _bindEvents() {
        const ws = this.el.workspace;
        this._onMouseDown  = (e) => this._handleMouseDown(e);
        this._onMouseMove  = (e) => this._handleMouseMove(e);
        this._onMouseUp    = (e) => this._handleMouseUp(e);
        this._onWheel      = (e) => this._handleWheel(e);
        this._onKeyDown    = (e) => this._handleKeyDown(e);
        this._onKeyUp      = (e) => this._handleKeyUp(e);
        this._onKeyPress   = (e) => { e.stopPropagation(); e.stopImmediatePropagation(); };
        ws.addEventListener("mousedown", this._onMouseDown);
        window.addEventListener("mousemove", this._onMouseMove);
        window.addEventListener("mouseup",   this._onMouseUp);
        ws.addEventListener("wheel", this._onWheel, { passive: false });
        window.addEventListener("keydown", this._onKeyDown, { capture: true });
        window.addEventListener("keyup", this._onKeyUp, { capture: true });
        window.addEventListener("keypress", this._onKeyPress, { capture: true });
        this._bindColorCanvas();
    }

    _unbindEvents() {
        const ws = this.el.workspace;
        if (ws) {
            ws.removeEventListener("mousedown", this._onMouseDown);
            ws.removeEventListener("wheel",     this._onWheel);
        }
        window.removeEventListener("mousemove", this._onMouseMove);
        window.removeEventListener("mouseup",   this._onMouseUp);
        window.removeEventListener("keydown",   this._onKeyDown, { capture: true });
        window.removeEventListener("keyup",     this._onKeyUp,   { capture: true });
        window.removeEventListener("keypress",  this._onKeyPress, { capture: true });
        if (this._onColorMove) window.removeEventListener("mousemove", this._onColorMove);
        if (this._onColorUp)   window.removeEventListener("mouseup",   this._onColorUp);
    }

    _handleMouseDown(e) {
        // Space+drag panning, middle-click panning, or Alt+drag when NOT on a brush tool
        const altForEyedrop = e.altKey && ["brush","pencil","eraser","smudge"].includes(this.tool);
        if (e.button === 1 || (e.button === 0 && this._spaceDown) || (e.button === 0 && e.altKey && !altForEyedrop)) {
            this.isPanning = true;
            this.panStart = { x: e.clientX - this.panX, y: e.clientY - this.panY };
            this.el.workspace.style.cursor = "grabbing";
            return;
        }
        if (e.button !== 0) return;
        // Click on workspace background (not canvas) = deselect
        if (e.target === this.el.workspace || e.target.classList.contains("pxf-tool-info") || e.target.classList.contains("pxf-drop-overlay")) {
            this.selectedIndices.clear();
            if (this.layers.length > 0) { this.activeIdx = 0; this.selectedIndices.add(0); }
            this._updateLayersPanel(); this._renderDisplay();
            return;
        }
        if (e.target !== this.el.displayCanvas) return;
        const { x, y } = this._screenToDoc(e.clientX, e.clientY);

        // Transform tool: check handles first, then click-to-select layer
        if (this.tool === "transform") {
            const ly = this.layers[this.activeIdx];
            if (ly) {
                const hit = this._hitTestHandle(x, y, ly);
                if (hit) {
                    this._pushHistory();
                    this.isDrawing = true;
                    const t = ly.transform;
                    if (hit.type === "move") {
                        this._handleMode = "move";
                        // Store all selected layers' positions for multi-move
                        const allOrig = new Map();
                        this.selectedIndices.forEach(idx => {
                            const sl = this.layers[idx];
                            if (sl) allOrig.set(idx, { x: sl.transform.x, y: sl.transform.y });
                        });
                        if (!allOrig.has(this.activeIdx)) allOrig.set(this.activeIdx, { x: t.x, y: t.y });
                        this._handleDrag = { startX: x, startY: y, origX: t.x, origY: t.y, allOrig };
                    } else if (hit.type === "pivot") {
                        this._handleMode = "pivot";
                        this._handleDrag = { startX: x, startY: y, origPivX: t.pivotOffX || 0, origPivY: t.pivotOffY || 0, origX: t.x, origY: t.y };
                    } else if (hit.type === "scale") {
                        this._handleMode = "scale";
                        const dist = Math.hypot(hit.corner.x - hit.center.x, hit.corner.y - hit.center.y);
                        this._handleDrag = { center: hit.center, initDist: dist, origSX: t.scaleX, origSY: t.scaleY };
                    } else if (hit.type === "rotate") {
                        this._handleMode = "rotate";
                        const initAngle = Math.atan2(y - hit.center.y, x - hit.center.x);
                        this._handleDrag = { center: hit.center, initAngle, origRot: t.rotation };
                    }
                    return;
                }
            }
            // If multi-selected, check if click is inside any other selected layer for multi-move
            if (this.selectedIndices.size > 1) {
                for (const idx of this.selectedIndices) {
                    const sl = this.layers[idx]; if (!sl) continue;
                    const corners = this._getLayerCorners(sl);
                    if (this._pointInQuad(x, y, corners)) {
                        this._pushHistory();
                        this.isDrawing = true;
                        this._handleMode = "move";
                        const t = ly ? ly.transform : sl.transform;
                        const allOrig = new Map();
                        this.selectedIndices.forEach(si => {
                            const s = this.layers[si];
                            if (s) allOrig.set(si, { x: s.transform.x, y: s.transform.y });
                        });
                        this._handleDrag = { startX: x, startY: y, origX: t.x, origY: t.y, allOrig };
                        return;
                    }
                }
            }
            // Click outside handles: try to select topmost layer with pixel at this position
            for (let i = 0; i < this.layers.length; i++) {
                const l = this.layers[i]; if (!l.visible) continue;
                try {
                    // Inverse-transform click coords to raw canvas space for accurate hit detection
                    const hasT = this._hasTransform(l);
                    const cp = hasT ? this._docToLayerCanvas(l, x, y) : { x, y };
                    const cx = Math.round(cp.x), cy = Math.round(cp.y);
                    if (cx < 0 || cx >= this.docW || cy < 0 || cy >= this.docH) continue;
                    const d = l.ctx.getImageData(cx, cy, 1, 1).data;
                    if (d[3] > 8) {
                        if (e.ctrlKey || e.metaKey) {
                            // Ctrl+click: toggle in multi-selection
                            if (this.selectedIndices.has(i)) {
                                this.selectedIndices.delete(i);
                                if (this.activeIdx === i) this.activeIdx = this.selectedIndices.size > 0 ? [...this.selectedIndices][0] : i;
                            } else {
                                this.selectedIndices.add(i);
                            }
                            this.activeIdx = i;
                        } else {
                            // Normal click: single select
                            this.selectedIndices.clear();
                            this.selectedIndices.add(i);
                            this.activeIdx = i;
                        }
                        this._syncLayerProps();
                        this._updateLayersPanel();
                        this._autoSetPivot();
                        this._setStatus(`Selected: ${l.name}${this.selectedIndices.size > 1 ? ` (+${this.selectedIndices.size - 1} more)` : ""}`);
                        this._renderDisplay();
                        return;
                    }
                } catch(e2) {}
            }
            return;
        }

        // Alt key → temporary eyedropper
        if (e.altKey && ["brush","pencil","eraser","smudge"].includes(this.tool)) {
            this._altPicking = true;
            const color = this.engine.sampleColor(this.el.displayCanvas, x, y);
            this._setColorFromHex(color, false);
            this._setStatus(`Picked: ${color}`);
            return;
        }

        // Shift+click for line drawing (brush/pencil)
        if (e.shiftKey && ["brush","pencil"].includes(this.tool) && this._lineStart) {
            this._drawLineTo(x, y);
            this._lineStart = { x, y };
            return;
        }

        this._toolMouseDown(x, y, e);
    }

    _handleMouseMove(e) {
        // Always update cursor overlay
        if (this.el.displayCanvas) {
            const docPt = this._screenToDoc(e.clientX, e.clientY);
            this._updateCursorOverlay(docPt.x, docPt.y);
        }

        // Alt key live eyedropper while button held
        if (this._altPicking && this.isDrawing === false) {
            const { x, y } = this._screenToDoc(e.clientX, e.clientY);
            const color = this.engine.sampleColor(this.el.displayCanvas, x, y);
            this._setColorFromHex(color, true);
            return;
        }

        if (this.isPanning) {
            this.panX = e.clientX - this.panStart.x;
            this.panY = e.clientY - this.panStart.y;
            this._applyViewTransform(); return;
        }

        // Transform handle drag
        if (this.isDrawing && this._handleMode && this._handleDrag) {
            const { x, y } = this._screenToDoc(e.clientX, e.clientY);
            const ly = this.layers[this.activeIdx]; if (!ly) return;
            const d = this._handleDrag;

            if (this._handleMode === "move") {
                const mdx = x - d.startX, mdy = y - d.startY;
                // Move all selected layers together
                if (d.allOrig) {
                    d.allOrig.forEach((orig, idx) => {
                        const sl = this.layers[idx];
                        if (sl) { sl.transform.x = orig.x + mdx; sl.transform.y = orig.y + mdy; }
                    });
                } else {
                    ly.transform.x = d.origX + mdx;
                    ly.transform.y = d.origY + mdy;
                }
                this._setStatus(`X: ${Math.round(ly.transform.x)}  Y: ${Math.round(ly.transform.y)}`);
            } else if (this._handleMode === "pivot") {
                const mdx = x - d.startX, mdy = y - d.startY;
                const rad = ly.transform.rotation * Math.PI / 180;
                const cr = Math.cos(rad), sr = Math.sin(rad);
                const sx = ly.transform.scaleX * (ly.transform.flipX ? -1 : 1);
                const sy = ly.transform.scaleY * (ly.transform.flipY ? -1 : 1);
                // Inverse-transform mouse delta so pivot follows cursor regardless of rotation/scale
                const dpx = (cr * mdx + sr * mdy) / sx;
                const dpy = (-sr * mdx + cr * mdy) / sy;
                ly.transform.pivotOffX = d.origPivX + dpx;
                ly.transform.pivotOffY = d.origPivY + dpy;
                // Compensate t.x/t.y so the image stays visually in place
                ly.transform.x = d.origX + dpx * (sx * cr - 1) - dpy * sy * sr;
                ly.transform.y = d.origY + dpx * sx * sr + dpy * (sy * cr - 1);
                this._setStatus(`Pivot: ${Math.round(ly.transform.pivotOffX)}, ${Math.round(ly.transform.pivotOffY)}`);
            } else if (this._handleMode === "scale") {
                const newDist = Math.hypot(x - d.center.x, y - d.center.y);
                const ratio = d.initDist > 0 ? newDist / d.initDist : 1;
                ly.transform.scaleX = Math.max(0.01, d.origSX * ratio);
                ly.transform.scaleY = Math.max(0.01, d.origSY * ratio);
                this._setStatus(`Scale: ${ly.transform.scaleX.toFixed(2)} \u00d7 ${ly.transform.scaleY.toFixed(2)}`);
            } else if (this._handleMode === "rotate") {
                const newAngle = Math.atan2(y - d.center.y, x - d.center.x);
                let angleDiff = (newAngle - d.initAngle) * 180 / Math.PI;
                if (e.shiftKey) angleDiff = Math.round(angleDiff / 15) * 15;
                ly.transform.rotation = d.origRot + angleDiff;
                this._setStatus(`Rotation: ${Math.round(ly.transform.rotation)}\u00b0`);
            }
            this._syncTransformPanel();
            this._renderDisplay();
            return;
        }

        if (!this.isDrawing) return;
        const { x, y } = this._screenToDoc(e.clientX, e.clientY);
        this._toolMouseMove(x, y);
    }

    _handleMouseUp(e) {
        this._altPicking = false;
        if (this.isPanning) { this.isPanning = false; this.el.workspace.style.cursor = ""; }
        if (this.isDrawing) {
            if (this._handleMode) {
                this._handleMode = null;
                this._handleDrag = null;
                this.isDrawing = false;
                this._contentBoundsCache.delete(this.layers[this.activeIdx]?.id);
                this._syncTransformPanel();
                this._updateTransformWarn();
                this._renderDisplay();
                return;
            }
            const { x, y } = this._screenToDoc(e.clientX, e.clientY);
            this._toolMouseUp(x, y);
        }
    }

    _handleWheel(e) {
        e.preventDefault();
        // Unified zoom: scroll = zoom in/out, centered (like Composer)
        const ws = this.el.workspace; if (!ws) return;
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const oldZ = this.zoom;
        this.zoom = Math.max(0.05, Math.min(8, this.zoom * factor));
        // Adjust pan to keep canvas centered during zoom
        const wsW = ws.clientWidth, wsH = ws.clientHeight;
        const cx = wsW / 2, cy = wsH / 2;
        this.panX = cx - (cx - this.panX) * (this.zoom / oldZ);
        this.panY = cy - (cy - this.panY) * (this.zoom / oldZ);
        this._applyViewTransform();
    }

    _handleKeyDown(e) {
        // Block ALL keyboard events from reaching ComfyUI while painter is open
        e.stopPropagation();
        e.stopImmediatePropagation();
        const ae = document.activeElement;
        if ((ae?.tagName === "INPUT" || ae?.tagName === "TEXTAREA" || ae?.tagName === "SELECT") && !ae?.dataset?.pixaromaTrap) return;
        const key = e.key.toLowerCase();
        if (key === " ") { e.preventDefault(); this._spaceDown = true; if (this.el.workspace) this.el.workspace.style.cursor = "grab"; return; }
        const handled = e.ctrlKey ? ["z","y","d","s","a"].includes(key) :
            ["b","p","e","g","i","r","v","t","u","x","d","[","]","delete","enter","escape","?"].includes(key);
        if (handled) e.preventDefault();
        if (e.ctrlKey) {
            if (key === "z") { if (e.shiftKey) this.redo(); else this.undo(); return; }
            if (key === "y") { this.redo(); return; }
            if (key === "d") { this._duplicateLayer(); return; }
            if (key === "s") { this._save(); return; }
            if (key === "a") { this.selectedIndices.clear(); this.layers.forEach((_, idx) => this.selectedIndices.add(idx)); this._updateLayersPanel(); this._renderDisplay(); this._setStatus(`Selected all ${this.layers.length} layers`); return; }
        }
        if (key === "b") this._setTool("brush");
        else if (key === "p") this._setTool("pencil");
        else if (key === "e") this._setTool("eraser");
        else if (key === "g") this._setTool("fill");
        else if (key === "i") this._setTool("pick");
        else if (key === "r") this._setTool("smudge");
        else if (key === "v") this._setTool("transform"); // Photoshop: V = move/transform
        else if (key === "t") this._setTool("transform"); // keep T as alias
        else if (key === "u") this._setTool("shape"); // U = shape tool
        else if (key === "enter") { if (this.tool === "transform") this._applyLayerTransform(); }
        else if (key === "escape") { if (this.tool === "transform") { const ly=this.layers[this.activeIdx]; if(ly){ly.transform={x:0,y:0,scaleX:1,scaleY:1,rotation:0,flipX:false,flipY:false,pivotOffX:0,pivotOffY:0};this._syncTransformPanel();this._updateTransformWarn();this._renderDisplay();} } }
        else if (key === "x") this._swapColors();
        else if (key === "d") { this.fgColor = "#000000"; this.bgColor2 = "#ffffff"; this.colorMode = "fg"; this._updateColorUI(); }
        else if (key === "[") { e.preventDefault(); this.brush.size = Math.max(1, this.brush.size - (e.shiftKey ? 10 : 2)); this._updateToolOptions(); }
        else if (key === "]") { e.preventDefault(); this.brush.size = Math.min(500, this.brush.size + (e.shiftKey ? 10 : 2)); this._updateToolOptions(); }
        else if (key === "delete") {
            // If multiple layers selected, delete them; otherwise clear active layer pixels
            if (this.selectedIndices.size > 1) this._deleteLayer();
            else this._clearLayer();
        }
        else if (key === "?") this._toggleHelp();
    }

    _handleKeyUp(e) {
        // Block ALL keyup events from reaching ComfyUI while painter is open
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (e.key === " ") {
            this._spaceDown = false;
            if (!this.isPanning && this.el.workspace) {
                const noCursor = ["brush","pencil","eraser","smudge"];
                const cursorMap = { fill:"copy", pick:"none", transform:"move", shape:"crosshair" };
                const cur = noCursor.includes(this.tool) ? "none" : (cursorMap[this.tool] || "crosshair");
                this.el.workspace.style.cursor = cur;
            }
        }
    }

    // ─── Tool dispatch ────────────────────────────────────────

    _toolMouseDown(x, y, e) {
        const ly = this.layers[this.activeIdx];
        if (!ly) return;

        if (this.tool === "pick") {
            this.isDrawing = true;
            const color = this.engine.sampleColor(this.el.displayCanvas, x, y);
            this._setColorFromHex(color, true); this._setStatus(`Sampled: ${color}`); return;
        }

        if (this.tool === "fill") {
            if (ly.locked) { this._setStatus("Layer is locked"); return; }
            this._pushHistory();
            this.engine.floodFill(ly.canvas, x, y, this.fgColor, this.fillTol);
            this._contentBoundsCache.delete(ly.id);
            this._updateLayerThumb(this.activeIdx); this._renderDisplay(); return;
        }

        if (this.tool === "transform") return;

        if (this.tool === "shape") {
            if (ly.locked) { this._setStatus("Layer is locked"); return; }
            this._shapeStart = { x, y };
            this.isDrawing = true;
            return;
        }

        if (ly.locked) { this._setStatus("Layer is locked"); return; }

        if (this.tool === "brush" || this.tool === "pencil" || this.tool === "eraser") {
            this.isDrawing = true;
            this.strokeCtx.clearRect(0, 0, this.docW, this.docH);
            // Shift = line from last point (_drawLineTo handles its own history push)
            if (e.shiftKey && this._lineStart) {
                this._drawLineTo(x, y);
                this._lineStart = { x, y };
                this.isDrawing = false;
                return;
            }
            this._pushHistory();
            this._lineStart = { x, y };
            const pts = this.engine.beginStroke(x, y);
            pts.forEach(pt => this._applyBrushStamp(pt.x, pt.y, pt.pressure || 1));
            this._renderDisplay(); return;
        }

        if (this.tool === "smudge") {
            this._pushHistory();
            this.isDrawing = true;
            this._lastSmudgePt = { x, y };
            this.engine.smudgeBegin(ly.ctx, x, y, this.brush.size);
            this._renderDisplay();
        }
    }

    _toolMouseMove(x, y) {
        const ly = this.layers[this.activeIdx];
        if (!ly || !this.isDrawing) return;

        if (this.tool === "pick") {
            const color = this.engine.sampleColor(this.el.displayCanvas, x, y);
            this._setColorFromHex(color, true); return;
        }

        if (this.tool === "brush" || this.tool === "pencil" || this.tool === "eraser") {
            const spacing = Math.max(1, this.brush.size * (this.brush.spacing / 100));
            const pts = this.engine.continueStroke(x, y, spacing);
            pts.forEach(pt => this._applyBrushStamp(pt.x, pt.y, pt.pressure || 1));
            this._renderDisplay();
            this._setStatus(`X: ${Math.round(x)}  Y: ${Math.round(y)}`);
            return;
        }

        if (this.tool === "smudge") {
            if (this._lastSmudgePt) {
                this._applySmudge(x, y, this._lastSmudgePt.x, this._lastSmudgePt.y);
                this._renderDisplay();
            }
            this._lastSmudgePt = { x, y };
            return;
        }

        if (this.tool === "shape" && this._shapeStart) {
            this._renderDisplay(); // re-render base
            // Draw shape preview on cursor canvas
            const cvs = this.el.cursorCvs; if (!cvs) return;
            const ctx = cvs.getContext("2d");
            ctx.clearRect(0, 0, cvs.width, cvs.height);
            ctx.save();
            const sx = this._shapeStart.x, sy = this._shapeStart.y;
            ctx.beginPath();
            this._buildShapePath(ctx, sx, sy, x, y);
            if (this._shapeTool !== "line" && this.shapeFill) {
                ctx.fillStyle = this.fgColor + "55"; ctx.fill();
                ctx.strokeStyle = this.fgColor; ctx.lineWidth = Math.max(1, 1 / this.zoom); ctx.stroke();
            } else {
                ctx.setLineDash([4 / this.zoom, 4 / this.zoom]);
                ctx.strokeStyle = this.fgColor; ctx.lineWidth = Math.max(1, (this.shapeLineWidth || 3) / this.zoom);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.restore();
            return;
        }
    }

    _toolMouseUp(x, y) {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        this._handleMode = null;
        this._handleDrag = null;

        if (this.tool === "brush" || this.tool === "pencil") {
            const ly = this.layers[this.activeIdx];
            if (ly) {
                const ops = this.brush.opacity / 100;
                ly.ctx.save();
                ly.ctx.globalAlpha = ops;
                ly.ctx.drawImage(this.strokeCanvas, 0, 0);
                ly.ctx.restore();
                this.strokeCtx.clearRect(0, 0, this.docW, this.docH);
            }
        }

        if (this.tool === "eraser") {
            const ly = this.layers[this.activeIdx];
            if (ly) {
                const ops = this.brush.opacity / 100;
                ly.ctx.save();
                ly.ctx.globalAlpha = ops;
                ly.ctx.globalCompositeOperation = "destination-out";
                ly.ctx.drawImage(this.strokeCanvas, 0, 0);
                ly.ctx.restore();
                this.strokeCtx.clearRect(0, 0, this.docW, this.docH);
            }
        }

        if (this.tool === "shape" && this._shapeStart) {
            const ly = this.layers[this.activeIdx];
            if (ly) {
                this._pushHistory();
                const ctx = ly.ctx;
                ctx.save();
                ctx.lineWidth = this.shapeLineWidth || 3;
                ctx.beginPath();
                this._buildShapePath(ctx, this._shapeStart.x, this._shapeStart.y, x, y);
                if (this._shapeTool === "line") {
                    ctx.strokeStyle = this.fgColor; ctx.stroke();
                } else if (this.shapeFill) {
                    ctx.fillStyle = this.fgColor; ctx.fill();
                } else {
                    ctx.strokeStyle = this.fgColor; ctx.stroke();
                }
                ctx.restore();
            }
            this._shapeStart = null;
            // Clear cursor canvas preview
            if (this.el.cursorCvs) this.el.cursorCvs.getContext("2d").clearRect(0, 0, this.docW, this.docH);
        }

        this.engine.endStroke();
        const ly = this.layers[this.activeIdx];
        if (ly) this._contentBoundsCache.delete(ly.id);
        this._updateLayerThumb(this.activeIdx);
        this._renderDisplay();
    }

    _applyBrushStamp(x, y, pressure) {
        const s = this.brush;
        const hard  = this.tool === "pencil" ? 100 : s.hardness;
        const stamp = this.engine.getStamp(s.size, hard, s.shape, s.angle);
        const flow  = (s.flow / 100) * (pressure || 1);

        // Both brush/pencil and eraser accumulate to strokeCanvas; eraser uses black (destination-out on commit)
        this.engine.applyStampToCtx(this.strokeCtx, stamp, x, y, s.size, this.fgColor, flow, false, s.scatter > 0, s.scatter);
    }

    _applySmudge(x, y, lastX, lastY) {
        const ly = this.layers[this.activeIdx]; if (!ly) return;
        const str = this.smudgeStrength !== undefined ? this.smudgeStrength : 50;
        this.engine.smudge(ly.ctx, x, y, lastX ?? x, lastY ?? y, this.brush.size, str);
    }

    _drawLineTo(x2, y2) {
        if (!this._lineStart) return;
        const { x: x1, y: y1 } = this._lineStart;
        this._pushHistory();
        const spacing = Math.max(1, this.brush.size * (this.brush.spacing / 100));
        const dist = Math.hypot(x2 - x1, y2 - y1);
        const steps = Math.max(1, Math.floor(dist / spacing));
        this.strokeCtx.clearRect(0, 0, this.docW, this.docH);
        this.engine.beginStroke(x1, y1);
        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t;
            this._applyBrushStamp(px, py, 1);
        }
        this.engine.endStroke();
        const ly = this.layers[this.activeIdx];
        if (ly) {
            const ops = this.brush.opacity / 100;
            ly.ctx.save();
            ly.ctx.globalAlpha = ops;
            if (this.tool === "eraser") ly.ctx.globalCompositeOperation = "destination-out";
            ly.ctx.drawImage(this.strokeCanvas, 0, 0);
            ly.ctx.restore();
            this.strokeCtx.clearRect(0, 0, this.docW, this.docH);
            this._contentBoundsCache.delete(ly.id);
            this._updateLayerThumb(this.activeIdx);
        }
        this._renderDisplay();
    }

    _buildShapePath(ctx, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        switch (this._shapeTool) {
            case "rect":
                ctx.rect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(dx), Math.abs(dy));
                break;
            case "ellipse":
                ctx.ellipse((x1+x2)/2, (y1+y2)/2, Math.max(1,Math.abs(dx)/2), Math.max(1,Math.abs(dy)/2), 0, 0, Math.PI*2);
                break;
            case "line":
                ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
                break;
            case "triangle":
                ctx.moveTo((x1+x2)/2, y1); ctx.lineTo(x2, y2); ctx.lineTo(x1, y2); ctx.closePath();
                break;
            case "poly": {
                const cx = (x1+x2)/2, cy = (y1+y2)/2;
                const r = Math.max(Math.abs(dx), Math.abs(dy)) / 2;
                const sides = this.polySlides || 5;
                for (let i = 0; i < sides; i++) {
                    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
                    const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
                    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
                }
                ctx.closePath();
                break;
            }
        }
    }

    // ─── History ──────────────────────────────────────────────

    _pushHistory() {
        const ly = this.layers[this.activeIdx]; if (!ly) return;
        const id = ly.ctx.getImageData(0, 0, this.docW, this.docH);
        if (this.historyIndex < this.history.length - 1)
            this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push({ layerIdx: this.activeIdx, data: id, transform: { ...ly.transform } });
        if (this.history.length > this.MAX_HISTORY) this.history.shift();
        this.historyIndex = this.history.length - 1;
    }

    // Full snapshot for destructive ops (flatten, merge, delete layer)
    // Saves ALL layers' pixel data so the entire state can be restored
    _pushFullSnapshot() {
        const snapshot = this.layers.map(ly => ({
            name: ly.name, id: ly.id, visible: ly.visible, locked: ly.locked,
            opacity: ly.opacity, blendMode: ly.blendMode,
            transform: { ...ly.transform },
            imageData: ly.ctx.getImageData(0, 0, this.docW, this.docH),
        }));
        if (this.historyIndex < this.history.length - 1)
            this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push({ type: "full", activeIdx: this.activeIdx, snapshot });
        if (this.history.length > this.MAX_HISTORY) this.history.shift();
        this.historyIndex = this.history.length - 1;
    }

    undo() {
        if (this.historyIndex < 0) { this._setStatus("Nothing to undo"); return; }
        const entry = this.history[this.historyIndex];

        if (entry.type === "full") {
            // Full snapshot: save current state for redo, then restore all layers
            entry._afterSnapshot = this.layers.map(ly => ({
                name: ly.name, id: ly.id, visible: ly.visible, locked: ly.locked,
                opacity: ly.opacity, blendMode: ly.blendMode,
                transform: { ...ly.transform },
                imageData: ly.ctx.getImageData(0, 0, this.docW, this.docH),
            }));
            entry._afterActiveIdx = this.activeIdx;
            // Restore layers from snapshot
            this.layers = entry.snapshot.map(s => {
                const ly = this._makeLayer(s.name);
                ly.id = s.id; ly.visible = s.visible; ly.locked = s.locked;
                ly.opacity = s.opacity; ly.blendMode = s.blendMode;
                ly.transform = { ...s.transform };
                ly.ctx.putImageData(s.imageData, 0, 0);
                return ly;
            });
            this.activeIdx = entry.activeIdx;
        } else {
            const ly = this.layers[entry.layerIdx];
            if (ly) {
                entry._afterData = ly.ctx.getImageData(0, 0, this.docW, this.docH);
                entry._afterTransform = { ...ly.transform };
                ly.ctx.putImageData(entry.data, 0, 0);
                if (entry.transform) ly.transform = { ...entry.transform };
            }
        }
        this.historyIndex--;
        this._contentBoundsCache.clear();
        this._updateLayersPanel(); this._syncTransformPanel(); this._renderDisplay();
        this._setStatus("Undo");
    }

    redo() {
        if (this.historyIndex >= this.history.length - 1) { this._setStatus("Nothing to redo"); return; }
        this.historyIndex++;
        const entry = this.history[this.historyIndex];

        if (entry.type === "full") {
            // Restore the state after the destructive operation
            if (entry._afterSnapshot) {
                this.layers = entry._afterSnapshot.map(s => {
                    const ly = this._makeLayer(s.name);
                    ly.id = s.id; ly.visible = s.visible; ly.locked = s.locked;
                    ly.opacity = s.opacity; ly.blendMode = s.blendMode;
                    ly.transform = { ...s.transform };
                    ly.ctx.putImageData(s.imageData, 0, 0);
                    return ly;
                });
                this.activeIdx = entry._afterActiveIdx;
            }
        } else {
            const ly = this.layers[entry.layerIdx];
            if (ly) {
                if (entry._afterData) {
                    ly.ctx.putImageData(entry._afterData, 0, 0);
                    if (entry._afterTransform) ly.transform = { ...entry._afterTransform };
                } else {
                    ly.ctx.putImageData(entry.data, 0, 0);
                    if (entry.transform) ly.transform = { ...entry.transform };
                }
            }
        }
        this._contentBoundsCache.clear();
        this._updateLayersPanel(); this._syncTransformPanel(); this._renderDisplay();
        this._setStatus("Redo");
    }

    // ─── Color UI ─────────────────────────────────────────────

    _bindColorCanvas() {
        this._drawSVGradient(); this._drawHueBar();
        let dragSV = false, dragH = false;
        this.el.svCvs.addEventListener("mousedown", (e) => { dragSV = true; this._pickSV(e); });
        this.el.hCvs.addEventListener("mousedown",  (e) => { dragH  = true; this._pickHue(e); });
        this._onColorMove = (e) => { if (dragSV) this._pickSV(e); if (dragH) this._pickHue(e); };
        this._onColorUp   = () => { dragSV = false; dragH = false; };
        window.addEventListener("mousemove", this._onColorMove);
        window.addEventListener("mouseup",   this._onColorUp);
    }

    _drawSVGradient() {
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
    }

    _drawHueBar() {
        const cvs = this.el.hCvs; const ctx = cvs.getContext("2d"); const w = cvs.width, h = cvs.height;
        const g = ctx.createLinearGradient(0,0,w,0);
        for (let i=0; i<=360; i+=30) g.addColorStop(i/360,`hsl(${i},100%,50%)`);
        ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
        const cx = (this.hsv.h/360)*w;
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.strokeRect(cx-3,1,6,h-2);
    }

    _hsvStr(h,s,v) { const {r,g,b} = hsvToRgb(h,s,v); return `rgb(${r},${g},${b})`; }

    _pickSV(e) {
        const rect = this.el.svCvs.getBoundingClientRect();
        this.hsv.s = Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
        this.hsv.v = Math.max(0,Math.min(1,1-(e.clientY-rect.top)/rect.height));
        this._applyHSV();
    }

    _pickHue(e) {
        const rect = this.el.hCvs.getBoundingClientRect();
        this.hsv.h = Math.max(0,Math.min(360,(e.clientX-rect.left)/rect.width*360));
        this._applyHSV();
    }

    _applyHSV() {
        const {r,g,b} = hsvToRgb(this.hsv.h, this.hsv.s, this.hsv.v);
        const hex = rgbToHex(r,g,b);
        if (this.colorMode === "fg") this.fgColor = hex; else this.bgColor2 = hex;
        this._updateColorUI(true);
    }

    _setColorFromHex(hex, noHsvUpdate) {
        if (this.colorMode === "fg") this.fgColor = hex; else this.bgColor2 = hex;
        if (!noHsvUpdate) {
            const {r,g,b} = hexToRgb(hex); this.hsv = rgbToHsv(r,g,b);
        }
        this._updateColorUI();
        this._addToSwatchHistory(hex);
    }

    _applyHSLAdjust(field, val) {
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
    }

    _updateColorUI(preserveHSV) {
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
    }

    _swapColors() { [this.fgColor, this.bgColor2] = [this.bgColor2, this.fgColor]; this._updateColorUI(); }

    _initDefaultSwatches() {
        const defaults = [
            "#000000","#333333","#666666","#999999","#cccccc","#ffffff","#f66744","#dc2626",
            "#16a34a","#2563eb","#7c3aed","#db2777","#ca8a04","#fed7aa","#fecdd3","#bbf7d0",
        ];
        const swatches = this.el.swatchGrid?.children;
        if (!swatches) return;
        defaults.forEach((c,i) => { if (swatches[i]) { swatches[i].style.background = c; swatches[i].dataset.color = c.startsWith("#") ? c : "#" + c; } });
        this.swatchHistory = [...defaults];
    }

    _addToSwatchHistory(hex) {
        if (!hex || this.swatchHistory[0] === hex) return;
        this.swatchHistory = [hex, ...this.swatchHistory.filter(c => c !== hex)].slice(0, 16);
        const swatches = this.el.swatchGrid?.children;
        if (!swatches) return;
        this.swatchHistory.forEach((c,i) => { if (swatches[i]) { swatches[i].style.background = c; swatches[i].dataset.color = c; } });
    }

    // ─── BG color picker popup ────────────────────────────────

    _showBgColorPicker(e, anchor) {
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
    }

    // ─── Tool options bar ─────────────────────────────────────

    _setTool(tool) {
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
    }

    _autoSetPivot() {
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
    }

    _hasTransform(ly) {
        const t = ly.transform;
        return !!(t.x || t.y || t.scaleX !== 1 || t.scaleY !== 1 || t.rotation || t.flipX || t.flipY);
    }

    _updateTransformWarn() {
        const ly = this.layers[this.activeIdx];
        const pending = ly && this._hasTransform(ly);
        if (this.el.transformWarn) this.el.transformWarn.style.display = pending ? "block" : "none";
    }

    _updateToolOptions() {
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
            resetBtn.textContent = "↺"; resetBtn.style.cssText = "width:24px;height:22px;font-size:13px;flex-shrink:0;";
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
            lbl.textContent = "Click or drag to sample color  ·  Alt+click picks to background color"; bar.appendChild(lbl);
        }

        if (this.tool === "transform") {
            sep();
            const lbl = document.createElement("label"); lbl.style.cssText = "color:#aaa;font-size:10px;";
            lbl.textContent = "Drag=Move  ·  Corner=Scale  ·  Top circle=Rotate  ·  Shift=15° snap  ·  Esc=Reset";
            bar.appendChild(lbl);
        }

        if (this.tool === "shape") {
            const shapeBtns = [
                { id:"rect",     sym:"▭", label:"Rectangle" },
                { id:"ellipse",  sym:"◯", label:"Ellipse/Circle" },
                { id:"triangle", sym:"△", label:"Triangle" },
                { id:"poly",     sym:"⬡", label:"Polygon (3-12 sides)" },
                { id:"line",     sym:"╱", label:"Line" },
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
                    fillBtn.textContent = "● Fill"; fillBtn.style.cssText = "width:48px;font-size:10px;";
                    const strokeBtn = document.createElement("div");
                    strokeBtn.className = "ppx-shape-btn" + (!this.shapeFill ? " active" : "");
                    strokeBtn.textContent = "○ Stroke"; strokeBtn.style.cssText = "width:54px;font-size:10px;";
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
            brush:     "Drag to paint  ·  [ / ] resize  ·  Shift+click = straight line  ·  Alt+drag = temp eyedropper  ·  ↺ resets defaults",
            pencil:    "Hard-edge pencil  ·  [ / ] resize  ·  Shift+click = straight line  ·  Alt+drag = eyedropper",
            eraser:    "Drag to erase pixels  ·  Opacity controls how much is erased  ·  [ / ] resize",
            fill:      "Click to flood-fill with FG color  ·  Adjust Tolerance for color spread",
            pick:      "Click or drag to sample color  ·  Alt+drag while painting = quick eyedropper",
            smudge:    "Drag to smear pixels  ·  Adjust Strength slider  ·  Smaller brush = finer detail",
            transform: "Drag = move  ·  Corner = scale  ·  Top circle = rotate  ·  Center dot = move pivot  ·  Click canvas = select layer  ·  Enter = Apply",
            shape:     "Drag to draw shape  ·  Fill = solid, Stroke = outline  ·  Polygon: adjust sides 3-12  ·  Line ignores fill toggle",
        };
        if (this.el.helpStrip) this.el.helpStrip.textContent = helpTexts[this.tool] ||
            "B=Brush  P=Pencil  E=Eraser  G=Fill  I=Eyedrop  R=Smudge  V=Move  Space+Drag=Pan  Scroll=Zoom  Ctrl+Z=Undo";
    }

    // ─── Layers panel ─────────────────────────────────────────

    _updateLayersPanel() {
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
    }

    _syncLayerProps() {
        const ly = this.layers[this.activeIdx]; if (!ly) return;
        if (this.el.blendSel)    this.el.blendSel.value    = ly.blendMode;
        if (this.el.layerOpRange) this.el.layerOpRange.value = ly.opacity;
        if (this.el.layerOpNum) this.el.layerOpNum.value = ly.opacity;
        this._syncTransformPanel();
        this._updateTransformWarn();
    }

    _syncTransformPanel() {
        const ly = this.layers[this.activeIdx]; if (!ly) return;
        const t = ly.transform;
        const tp = this._transformPanel; if (!tp) return;
        if (tp.setRotate) tp.setRotate(Math.round(t.rotation));
        if (tp.setScale) tp.setScale(Math.round(t.scaleX * 100));
        if (tp.setStretchH) tp.setStretchH(Math.round(t.scaleX * 100));
        if (tp.setStretchV) tp.setStretchV(Math.round(t.scaleY * 100));
        if (tp.setOpacity) tp.setOpacity(Math.round(ly.opacity));
    }

    _updateLayerThumb(idx) {
        const list = this.el.layerList; if (!list) return;
        const item = list.children[idx]; if (!item) return;
        const tCvs = item.querySelector("canvas"); if (!tCvs) return;
        const ly = this.layers[idx]; if (!ly) return;
        tCvs.getContext("2d").clearRect(0, 0, 26, 26);
        tCvs.getContext("2d").drawImage(ly.canvas, 0, 0, 26, 26);
    }

    // ─── Document ─────────────────────────────────────────────

    _updateDocProps() {
        if (this.el.docW) this.el.docW.value = this.docW;
        if (this.el.docH) this.el.docH.value = this.docH;
        if (this._canvasSettings) this._canvasSettings.setSize(this.docW, this.docH);
        if (this.el.bgPreview) this.el.bgPreview.style.background = this.bgColor;
    }

    _resizeDoc() {
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
    }

    // ─── Save ─────────────────────────────────────────────────

    async _save() {
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

    // ─── Transform apply ──────────────────────────────────────

    _applyLayerTransform(idx) {
        const i = (idx !== undefined) ? idx : this.activeIdx;
        const ly = this.layers[i]; if (!ly) return;
        if (!this._hasTransform(ly)) { this._setStatus("No transform to apply"); return; }
        this._pushHistory();
        const tmp = document.createElement("canvas");
        tmp.width = this.docW; tmp.height = this.docH;
        this._drawLayerWithTransform(tmp.getContext("2d"), ly);
        ly.ctx.clearRect(0, 0, this.docW, this.docH);
        ly.ctx.drawImage(tmp, 0, 0);
        ly.transform = { x:0, y:0, scaleX:1, scaleY:1, rotation:0, flipX:false, flipY:false, pivotOffX:0, pivotOffY:0 };
        this._contentBoundsCache.delete(ly.id);
        this._syncTransformPanel();
        this._updateTransformWarn();
        this._updateLayerThumb(i);
        this._renderDisplay();
        this._setStatus("✓ Transform applied — ready to draw");
    }

    _fitLayerToCanvas(ly, dir) {
        const b = this._getContentBounds(ly);
        if (b.w < 1 || b.h < 1) return;
        // Compute scale so content fills the requested dimension, keep aspect ratio
        const s = dir === "w" ? this.docW / b.w : this.docH / b.h;
        ly.transform.scaleX = s;
        ly.transform.scaleY = s;
        ly.transform.rotation = 0;
        ly.transform.flipX = false;
        ly.transform.flipY = false;
        // Reset pivot to canvas center so the centering math below is correct
        ly.transform.pivotOffX = 0;
        ly.transform.pivotOffY = 0;
        // Center the content on the canvas
        // After transform, content center (bx+bw/2, by+bh/2) should map to (docW/2, docH/2)
        // Screen_x = docW/2 + t.x + (bx+bw/2 - docW/2)*s = docW/2 → t.x = -(bx+bw/2-docW/2)*s
        ly.transform.x = -(b.x + b.w / 2 - this.docW / 2) * s;
        ly.transform.y = -(b.y + b.h / 2 - this.docH / 2) * s;
    }

    // ─── Cursor overlay ───────────────────────────────────────

    _updateCursorOverlay(docX, docY) {
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
    }

    _drawCursorShape(ctx, x, y, r, shape, outerColor, innerColor, lw, dashed) {
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
    }

    // ─── Content bounds (tight pixel bounding box) ────────────

    _getContentBounds(ly) {
        if (this._contentBoundsCache.has(ly.id)) return this._contentBoundsCache.get(ly.id);
        const w = this.docW, h = this.docH;
        try {
            const data = ly.ctx.getImageData(0, 0, w, h).data;
            let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
            // Scan every pixel for accuracy (alpha > 0 catches all visible content)
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    if (data[(y * w + x) * 4 + 3] > 0) {
                        if (x < minX) minX = x; if (y < minY) minY = y;
                        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
                        found = true;
                    }
                }
            }
            const bounds = found ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : { x: 0, y: 0, w, h };
            this._contentBoundsCache.set(ly.id, bounds);
            return bounds;
        } catch(e) {
            return { x: 0, y: 0, w, h };
        }
    }

    _toggleHelp() {
        if (this._layout) this._layout.toggleHelp();
    }
}
