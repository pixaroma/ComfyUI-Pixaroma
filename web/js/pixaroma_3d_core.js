// ============================================================
// Pixaroma 3D Editor — Three.js WebGL Scene Editor  v5
// ============================================================
import { ThreeDAPI } from "./pixaroma_3d_api.js";
import { installFocusTrap } from "./pixaroma_shared.js";
import {
    BRAND,
    createEditorLayout,
    createPanel,
    createButton,
    createSliderRow,
    createRow,
    createNumberInput,
    createSelectInput,
    createColorInput,
    createCheckbox,
    createInfo,
    createButtonRow,
    createCanvasSettings,
    createCanvasFrame,
    createLayerPanel,
    createLayerItem,
    createCanvasToolbar,
    createTransformPanel,
} from "./pixaroma_editor_framework.js";

let THREE = null, OrbitControls = null, TransformControls = null;
const ESM = "https://esm.sh/three@0.170.0";
async function loadThree() {
    if (THREE) return;
    THREE = await import(ESM);
    OrbitControls = (await import(ESM + "/examples/jsm/controls/OrbitControls.js")).OrbitControls;
    TransformControls = (await import(ESM + "/examples/jsm/controls/TransformControls.js")).TransformControls;
}

// Editor-specific CSS for 3D viewport elements not covered by framework
const STYLE_ID = "pixaroma-3d-extra-v1";
function injectExtraStyles() {
    if (document.getElementById(STYLE_ID)) return;
    // Remove ALL old 3D-specific style sheets
    for (const old of ["pixaroma-3d-styles","pixaroma-3d-styles-v3","pixaroma-3d-v4","pixaroma-3d-v5","pixaroma-3d-v6"]) document.getElementById(old)?.remove();
    const s = document.createElement("style"); s.id = STYLE_ID;
    s.textContent = `
/* 3D-specific: viewport, frame, masks, background, materials, shape buttons, layers (kept for _updateLayers) */
.p3d-viewport canvas, .pxf-workspace canvas{display:block;position:relative;z-index:1;}
.p3d-bg-container{position:absolute;inset:0;overflow:hidden;z-index:0;pointer-events:none;}
.p3d-bg-container img{position:absolute;top:50%;left:50%;transform-origin:center center;image-rendering:auto;pointer-events:none;}
/* p3d-frame, p3d-frame-label, p3d-frame-mask — removed, now using shared createCanvasFrame */
/* p3d-tool-info — removed, now using shared pxf-tool-info from framework */
.p3d-obj-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;height:54px;cursor:pointer;border:1px solid #3a3d40;background:#242628;color:#ccc;border-radius:5px;font-size:10px;gap:3px;transition:all .12s;}
.p3d-obj-btn:hover{background:#2a2c2e;border-color:#f66744;}
.p3d-obj-btn.selected{background:#2a1800;border-color:#f66744;color:#fff;}
.p3d-obj-btn .icon{font-size:18px;}
.p3d-shape-params{margin-top:8px;padding:6px 0;border-top:1px solid #2a2c2e;}
.p3d-mat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;}
.p3d-mat-btn{display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 2px;cursor:pointer;border:1px solid #3a3d40;background:#242628;border-radius:5px;font-size:9px;color:#999;transition:all .12s;}
.p3d-mat-btn:hover,.p3d-mat-btn.active{border-color:#f66744;background:#2a2c2e;}
.p3d-mat-preview{width:28px;height:28px;border-radius:50%;border:1px solid #555;}
.p3d-hsl-row{display:flex;align-items:center;gap:4px;margin-bottom:3px;}
.p3d-hsl-row label{font-size:9px;color:#888;width:14px;flex-shrink:0;font-family:monospace;}
.p3d-hsl-row input[type=range]{flex:1;min-width:0;}
.p3d-hsl-row .val{font-size:9px;color:#aaa;width:28px;text-align:right;font-family:monospace;flex-shrink:0;}
/* Layer styles now provided by the editor framework (pxf-layer-*) */
.p3d-layer-color{width:14px;height:14px;border-radius:3px;border:1px solid #555;flex-shrink:0;}
.p3d-row{display:flex;align-items:center;gap:5px;margin-bottom:4px;}
.p3d-label{font-size:10px;color:#888;width:72px;flex-shrink:0;}
.p3d-range{flex:1;min-width:0;}
.p3d-input{width:50px;background:#111;color:#e0e0e0;border:1px solid #3a3d40;border-radius:3px;padding:3px 4px;font-size:10px;font-family:monospace;text-align:center;}
.p3d-btn{background:#1e2022;color:#ccc;border:1px solid #3a3d40;border-radius:4px;cursor:pointer;transition:all .12s;font-family:inherit;}
.p3d-btn:hover{background:#2e3033;color:#f66744;border-color:#f66744;}
`;
    document.head.appendChild(s);
}

// ─── Editor ──────────────────────────────────────────────────
export class Pixaroma3DEditor {
    constructor() {
        this.onSave = null;
        this.onClose = null;
        this.docW = 1024; this.docH = 1024;
        this.bgColor = "#000000";
        this.objects = [];
        this.selectedObjs = new Set();
        this.activeObj = null;
        this.scene = null; this.camera = null; this.renderer = null;
        this.orbitCtrl = null; this.transformCtrl = null;
        this.light = null; this.ambientLight = null;
        this.gridHelper = null;
        this.toolMode = "move";
        this.projectId = "p3d_" + Date.now();
        this.el = {};
        this._id = 0;
        this._lightDir = { theta: 0.8, phi: 1.0 };
        this._gizmoHelper = null;
        this._gizmoDragging = false;
        this._multiDragStart = null;
        this._ptr = null;
        this._undoStack = []; this._redoStack = []; this.MAX_UNDO = 30;
        this._ratioLocked = true;
        this._fov = 50;
        this._shadows = true;
        this._isOrtho = false;
        this._groundMesh = null;
        this._showGrid = true;
        this._showGizmo = true;
        // bg image: x/y in % offset from center, scale in %, rotation in deg, opacity 0-100
        this._bgImg = { path: null, x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, _natW: 0, _natH: 0 };
    }

    async open(jsonStr) {
        injectExtraStyles();
        this._buildUI();
        this._layout.mount();
        this._setStatus("Loading Three.js...");
        try { await loadThree(); } catch (e) { this._setStatus("ERROR: load failed"); return; }
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        this._initThree();
        this._restoreScene(jsonStr);
        this._animate();
        this._updateLayers();
        this._setStatus("Ready");
    }

    // ─── UI ──────────────────────────────────────────────────

    _buildUI() {
        const helpHTML = `
<div style="display:grid;grid-template-columns:auto 1fr;gap:3px 14px;color:#ccc;font-size:11px;">
<b style="color:#f66744;">Navigation</b><span></span>
<b>Left drag</b><span>Orbit camera</span>
<b>Right drag</b><span>Pan camera</span>
<b>Scroll</b><span>Zoom</span>
<b style="color:#f66744;">Camera Views</b><span></span>
<b>F / 1</b><span>Front view</span>
<b>2</b><span>Right side view</span>
<b>B / 3</b><span>Back view</span>
<b>T / 4</b><span>Top view</span>
<b>0</b><span>Focus on selected object</span>
<b style="color:#f66744;">Transform</b><span></span>
<b>M</b><span>Move tool</span>
<b>R</b><span>Rotate tool</span>
<b>S</b><span>Scale tool</span>
<b style="color:#f66744;">Selection</b><span></span>
<b>Click</b><span>Select object</span>
<b>Shift+Click</b><span>Multi-select</span>
<b>Ctrl+A</b><span>Select all</span>
<b style="color:#f66744;">Actions</b><span></span>
<b>Ctrl+D</b><span>Duplicate</span>
<b>Delete</b><span>Delete selected</span>
<b>Ctrl+Z / Y</b><span>Undo / Redo</span>
<b>Ctrl+S</b><span>Save</span>
<b style="color:#f66744;">Layers</b><span></span>
<b>Drag layers</b><span>Reorder</span>
<b>Double-click</b><span>Rename</span>
<b>Lock icon</b><span>Prevent transforms</span>
</div>`;

        const layout = createEditorLayout({
            editorName: "3D Builder",
            editorId: "pixaroma-3d-editor",
            showUndoRedo: true,
            showStatusBar: false,
            showZoomBar: false,
            onSave: () => this._save(),
            onClose: () => this._close(),
            onUndo: () => this._undo(),
            onRedo: () => this._redo(),
            helpContent: helpHTML,
        });
        this._layout = layout;
        layout.onCleanup = () => {
            window.removeEventListener("keydown", this._onKey, { capture: true });
            window.removeEventListener("keyup", this._onKeyUp, { capture: true });
            window.removeEventListener("keypress", this._onKeyUp, { capture: true });
            if (this._resizeObs) this._resizeObs.disconnect();
            if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
            if (this.transformCtrl) { this.transformCtrl.detach(); this.transformCtrl.dispose(); }
            if (this.orbitCtrl) this.orbitCtrl.dispose();
            if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss(); }
            this.objects.forEach(o => { o.geometry?.dispose(); o.material?.dispose(); });
            this.scene = null; this.camera = null; this.renderer = null;
            this._closed = true;
        };
        this.el.overlay = layout.overlay;
        this.el.helpOverlay = layout.helpPanel;

        // Viewport: use framework workspace but add 3D-specific elements
        const vp = layout.workspace;
        vp.style.background = "#000";
        this.el.viewport = vp;

        // Background image container (behind canvas)
        const bgCont = document.createElement("div"); bgCont.className = "p3d-bg-container";
        this.el.bgContainer = bgCont; vp.appendChild(bgCont);

        // Tool info (uses framework's floating tooltip)
        this.el.toolInfo = layout.statusText;
        layout.setStatus("Move (M) \u2014 Drag arrows to move object");

        // Populate sidebars
        this._buildLeft(layout.leftSidebar);
        this._buildRight(layout.rightSidebar, layout.sidebarFooter);

        // Enable drag & drop on workspace
        if (this._canvasToolbar) this._canvasToolbar.setupDropZone(layout.workspace);
    }

    _buildLeft(left) {
        // Canvas Settings — unified component (FIRST panel in left sidebar)
        this._canvasSettings = createCanvasSettings({
            width: this.docW,
            height: this.docH,
            ratioIndex: 1, // default 1:1
            startCollapsed: false,
            onChange: ({ width, height, ratioIndex }) => {
                this.docW = width;
                this.docH = height;
                this._updateFrame();
            },
        });
        left.appendChild(this._canvasSettings.el);

        // Canvas Toolbar (BG color + Add Image + Clear Scene)
        this._canvasToolbar = createCanvasToolbar({
            onAddImage: (file) => {
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    const dataURL = ev.target.result;
                    this._setStatus("Uploading background...");
                    try {
                        const res = await ThreeDAPI.uploadBgImage(this.projectId, dataURL);
                        if (res.status === "success" && res.path) {
                            this._bgImg.path = res.path;
                            this._showBgImage(dataURL, true);
                            this._setStatus("Background loaded");
                        } else { this._setStatus("Upload failed"); }
                    } catch (e) { console.warn("[P3D] bg upload", e); this._setStatus("Upload error"); }
                };
                reader.readAsDataURL(file);
            },
            onBgColorChange: (hex) => {
                this.bgColor = hex;
                // Always update workspace background so color is visible behind/around bg image
                if (this.el.viewport) this.el.viewport.style.backgroundColor = hex;
                if (this.scene && !this.el.bgImgEl) this.scene.background = new THREE.Color(hex);
            },
            onClear: () => {
                this.objects.forEach(o => { o.geometry?.dispose(); o.material?.dispose(); this.scene.remove(o); });
                this.objects = []; this.selectedObjs.clear(); this.activeObj = null; this._updateLayers();
            },
            bgColor: "#000000",
            addImageLabel: "Background Image",
            clearLabel: "Clear Scene",
            onReset: () => {
                // Clear all objects
                this.objects.forEach(o => { o.geometry?.dispose(); o.material?.dispose(); this.scene?.remove(o); });
                this.objects = []; this.selectedObjs.clear(); this.activeObj = null;
                // Remove bg image
                this._removeBgImage();
                // Reset canvas size
                this.docW = 1024; this.docH = 1024;
                if (this._canvasSettings) this._canvasSettings.setSize(1024, 1024);
                if (this._canvasSettings) this._canvasSettings.setRatio(0);
                this._canvasToolbar.setBgColor("#000000");
                this.bgColor = "#000000";
                if (this.scene) this.scene.background = new THREE.Color("#000000");
                this._updateFrame(); this._updateLayers();
                this._setStatus("Reset to default");
            },
        });
        left.appendChild(this._canvasToolbar.el);

        // Background Image Transform (unified transform panel)
        if (!this._bgImg._flipH) this._bgImg._flipH = false;
        if (!this._bgImg._flipV) this._bgImg._flipV = false;
        const bgTP = createTransformPanel({
            onFitWidth: () => this._fitBg("width"),
            onFitHeight: () => this._fitBg("height"),
            onFlipH: () => { this._bgImg._flipH = !this._bgImg._flipH; this._updateBgCSS(); },
            onFlipV: () => { this._bgImg._flipV = !this._bgImg._flipV; this._updateBgCSS(); },
            onRotateCCW: () => { this._bgImg.rotation = (this._bgImg.rotation - 90) % 360; this._updateBgCSS(); this._syncBgSliders(); },
            onRotateCW: () => { this._bgImg.rotation = (this._bgImg.rotation + 90) % 360; this._updateBgCSS(); this._syncBgSliders(); },
            onReset: () => {
                this._bgImg = { ...this._bgImg, x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, _flipH: false, _flipV: false };
                this._updateBgCSS(); this._syncBgSliders();
            },
            showRotateSlider: false,
            showScaleSlider: false,
            showStretchSliders: false,
            showOpacitySlider: false,
        });
        const bgTitleEl = bgTP.el.querySelector(".pxf-panel-title");
        if (bgTitleEl) bgTitleEl.textContent = "BACKGROUND IMAGE";

        // X/Y/Scale/Rotate/Opacity sliders
        const bgXR = createSliderRow("X", -100, 100, 0, v => { this._bgImg.x = v; this._updateBgCSS(); });
        const bgYR = createSliderRow("Y", -100, 100, 0, v => { this._bgImg.y = v; this._updateBgCSS(); });
        const bgScR = createSliderRow("Scale", 1, 300, 100, v => { this._bgImg.scale = v; this._updateBgCSS(); });
        const bgRotR = createSliderRow("Rotate", -180, 180, 0, v => { this._bgImg.rotation = v; this._updateBgCSS(); });
        const bgOpR = createSliderRow("Opacity", 0, 100, 100, v => { this._bgImg.opacity = v; this._updateBgCSS(); });
        this.el.bgX = bgXR.slider; this.el.bgXV = bgXR.numInput;
        this.el.bgY = bgYR.slider; this.el.bgYV = bgYR.numInput;
        this.el.bgSc = bgScR.slider; this.el.bgScV = bgScR.numInput;
        this.el.bgRot = bgRotR.slider; this.el.bgRotV = bgRotR.numInput;
        this.el.bgOp = bgOpR.slider; this.el.bgOpV = bgOpR.numInput;

        // Hide/Remove BG buttons
        let _bgHidden = false;
        const hideBtn = createButton("Hide BG", { variant: "standard", onClick: () => {
            if (!this.el.bgImgEl) return;
            _bgHidden = !_bgHidden;
            if (this.el.bgContainer) this.el.bgContainer.style.display = _bgHidden ? "none" : "";
            hideBtn.textContent = _bgHidden ? "Show BG" : "Hide BG";
        }});
        const removeBtn = createButton("Remove BG", { variant: "standard", onClick: () => {
            this._removeBgImage();
            _updateBgPanelState();
        }});
        hideBtn.style.flex = "1"; removeBtn.style.flex = "1";
        removeBtn.classList.add("pxf-btn-danger");

        const pc = bgTP.content || bgTP.el.querySelector(".pxf-panel-content");
        if (pc) {
            pc.append(bgXR.el, bgYR.el, bgScR.el, bgRotR.el, bgOpR.el);
            const actRow = createButtonRow([hideBtn, removeBtn]); actRow.style.marginTop = "6px";
            pc.appendChild(actRow);
        }
        left.appendChild(bgTP.el);

        // Gray out BG panel when no background image
        const _updateBgPanelState = () => {
            const hasBg = !!this.el.bgImgEl;
            bgTP.el.style.opacity = hasBg ? "1" : "0.3";
            bgTP.el.style.pointerEvents = hasBg ? "auto" : "none";
        };
        this._updateBgPanelState = _updateBgPanelState;
        _updateBgPanelState();

        // 3D Objects — select shape, configure, then add
        const obs = createPanel("3D Objects");
        const og = document.createElement("div"); og.className = "p3d-grid3"; og.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;";
        const shapes = [{id:"cube",icon:"\u25a3",l:"Cube"},{id:"sphere",icon:"\u25cf",l:"Sphere"},{id:"cylinder",icon:"\u25ae",l:"Cylinder"},
         {id:"cone",icon:"\u25b2",l:"Cone"},{id:"torus",icon:"\u25ef",l:"Torus"},{id:"plane",icon:"\u25ad",l:"Plane"}];
        this._selectedShape = "cube";
        shapes.forEach(sh => {
            const b = document.createElement("div"); b.className = "p3d-obj-btn" + (sh.id === "cube" ? " selected" : ""); b.title = "Select " + sh.l;
            b.innerHTML = `<span class="icon">${sh.icon}</span>${sh.l}`;
            b.addEventListener("click", () => { this._selectedShape = sh.id; og.querySelectorAll(".p3d-obj-btn").forEach(x=>x.classList.remove("selected")); b.classList.add("selected"); this._updateShapeParams(); });
            og.appendChild(b);
        });
        obs.content.appendChild(og);

        const paramBox = document.createElement("div"); paramBox.className = "p3d-shape-params";
        this.el.shapeParams = paramBox;
        obs.content.appendChild(paramBox);

        const addBtn = createButton("+ Add to Scene", { variant: "accent", onClick: () => this._addObjectWithParams(), title: "Add the selected shape" });
        addBtn.style.cssText = "width:100%;margin-top:8px;";
        obs.content.appendChild(addBtn);
        left.appendChild(obs.el);

        // Initialize shape params for default (cube)
        this._shapeDefaults = {
            cube:    { width:1, height:1, depth:1 },
            sphere:  { radius:0.6, widthSegs:16, heightSegs:16 },
            cylinder:{ radiusTop:0.5, radiusBottom:0.5, height:1.2, sides:16 },
            cone:    { radius:0.5, height:1.2, sides:16 },
            torus:   { radius:0.5, tube:0.2, radialSegs:12, tubeSegs:32 },
            plane:   { width:2, height:2 },
        };
        this._shapeParams = {};
        for (const [k,v] of Object.entries(this._shapeDefaults)) this._shapeParams[k] = {...v};
        this._updateShapeParams();

        // Transform Tools
        const tt = createPanel("Transform Tools");
        const tg = document.createElement("div"); tg.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;";
        this._toolDefs = [
            {id:"move",icon:"✥",l:"Move",key:"M",tip:"Move (M) \u2014 Drag colored arrows to translate along X/Y/Z"},
            {id:"rotate",icon:"\u21bb",l:"Rotate",key:"R",tip:"Rotate (R) \u2014 Drag colored rings to rotate around X/Y/Z"},
            {id:"scale",icon:"\u2922",l:"Scale",key:"S",tip:"Scale (S) \u2014 Drag colored boxes to resize along X/Y/Z"},
        ];
        this._toolDefs.forEach(t => {
            const b = document.createElement("div"); b.className = "pxf-tool-btn" + (this.toolMode === t.id ? " active" : "");
            b.title = t.tip; b.innerHTML = `<span class="pxf-tool-btn-icon">${t.icon}</span><span class="pxf-tool-btn-label">${t.l}</span>`;
            b.addEventListener("click", () => this._setToolMode(t.id));
            this.el[`tool_${t.id}`] = b; tg.appendChild(b);
        });
        tt.content.appendChild(tg); left.appendChild(tt.el);

        // Camera
        const cam = createPanel("Camera");
        const cRow1 = document.createElement("div"); cRow1.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;";
        [{id:"front",l:"Front",tip:"Front view (F / 1)"},{id:"side",l:"Side",tip:"Right side view (2)"},
         {id:"back",l:"Back",tip:"Back view (B / 3)"},{id:"top",l:"Top",tip:"Top view (T / 4)"}].forEach(t => {
            const b = document.createElement("div"); b.className = "pxf-tool-btn"; b.title = t.tip;
            b.innerHTML = `<span class="pxf-tool-btn-icon">${t.l[0]}</span><span class="pxf-tool-btn-label">${t.l}</span>`;
            b.addEventListener("click", () => this._camView(t.id)); cRow1.appendChild(b);
        });
        cam.content.appendChild(cRow1);
        const perspBtn = createButton("Perspective", { variant: "standard", onClick: () => this._setPerspective(true), title: "Standard perspective camera" });
        const isoBtn = createButton("Isometric", { variant: "standard", onClick: () => this._setPerspective(false), title: "Orthographic/isometric camera" });
        this.el.perspBtn = perspBtn; this.el.isoBtn = isoBtn;
        perspBtn.classList.add("active"); perspBtn.style.flex = "1"; isoBtn.style.flex = "1";
        const perspRow = createButtonRow([perspBtn, isoBtn]); perspRow.style.marginTop = "5px";
        cam.content.appendChild(perspRow);
        const focusBtn = createButton("\ud83d\udd0d Focus Selected (0)", { variant: "standard", onClick: () => this._camView("focus"), title: "Center camera on selected object" });
        focusBtn.style.cssText = "width:100%;margin-top:5px;margin-bottom:8px;"; cam.content.appendChild(focusBtn);
        // FOV
        const fovR = createSliderRow("FOV", 15, 120, this._fov, v => {
            this._fov = v;
            if (this.camera && this.camera.fov !== undefined) { this.camera.fov = v; this.camera.updateProjectionMatrix(); }
        });
        this.el.fovSlider = fovR.slider; this.el.fovVal = fovR.numInput;
        cam.content.appendChild(fovR.el);
        // Checkboxes
        const shCb = createCheckbox("Ground Shadows", this._shadows, (v) => { this._shadows = v; if (this._groundMesh) this._groundMesh.visible = v; });
        this.el.shadowCheck = shCb.checkbox; shCb.el.style.marginTop = "8px"; cam.content.appendChild(shCb.el);
        const gridCb = createCheckbox("Show Grid", this._showGrid, (v) => { this._showGrid = v; if (this.gridHelper) this.gridHelper.visible = v; });
        this.el.gridCheck = gridCb.checkbox; gridCb.el.style.marginTop = "6px"; cam.content.appendChild(gridCb.el);
        const gizCb = createCheckbox("Show Gizmo", this._showGizmo, (v) => { this._showGizmo = v; if (this._gizmoHelper) this._gizmoHelper.visible = v; });
        this.el.gizmoCheck = gizCb.checkbox; gizCb.el.style.marginTop = "6px"; cam.content.appendChild(gizCb.el);
        left.appendChild(cam.el);

        // Status
        const status = document.createElement("div");
        status.style.cssText = "padding:8px 12px;font-size:9px;color:#555;border-top:1px solid #2a2c2e;margin-top:auto;flex-shrink:0;font-family:monospace;";
        this.el.status = status; left.appendChild(status);
    }

    _buildRight(right, footer) {
        // 1) Layers (unified layer panel from framework, no blend/opacity for 3D)
        this._layerPanel = createLayerPanel({
            showBlendMode: false,
            showOpacity: false,
            onDuplicate: () => this._dupSelected(),
            onDelete: () => this._deleteSelected(),
            onReorder: (fromIdx, toIdx) => {
                const dragged = this.objects.splice(fromIdx, 1)[0];
                this.objects.splice(toIdx, 0, dragged);
                this._updateLayers();
            },
        });
        this.el.layerList = this._layerPanel.list;
        right.insertBefore(this._layerPanel.el, footer);

        // 2) Object Color + HSL
        const colSec = createPanel("Object Color");
        const colorIn = createColorInput({ value: "#c4a882", onChange: (v) => this._setObjColor(v) });
        colorIn.style.cssText = "width:100%;height:28px;";
        this.el.objColor = colorIn; colSec.content.appendChild(colorIn);
        const hslWrap = document.createElement("div"); hslWrap.style.marginTop = "6px";
        ["H","S","L"].forEach((ch, idx) => {
            const r = document.createElement("div"); r.className = "p3d-hsl-row";
            const lbl = document.createElement("label"); lbl.textContent = ch;
            const sl = document.createElement("input"); sl.type = "range"; sl.min = 0; sl.max = idx === 0 ? 360 : 100; sl.value = 0;
            const val = document.createElement("span"); val.className = "val"; val.textContent = "0";
            sl.addEventListener("input", () => { val.textContent = sl.value; this._hslToColor(); });
            this.el[`hsl${ch}`] = sl; this.el[`hsl${ch}V`] = val;
            r.append(lbl, sl, val); hslWrap.appendChild(r);
        });
        colSec.content.appendChild(hslWrap);
        const nameIn = createNumberInput({}); nameIn.type = "text"; nameIn.placeholder = "name"; nameIn.style.width = "100%";
        nameIn.addEventListener("change", () => { if (this.activeObj) { this.activeObj.userData.name = nameIn.value; this._updateLayers(); } });
        this.el.objName = nameIn;
        colSec.content.appendChild(createRow("Name", nameIn));
        const delBtn = createButton("Delete Object", { variant: "danger", onClick: () => this._deleteSelected(), title: "Delete selected" });
        delBtn.style.width = "100%"; colSec.content.appendChild(delBtn);
        right.insertBefore(colSec.el, footer);

        // 3) Materials
        const mats = createPanel("Materials");
        const mg = document.createElement("div"); mg.className = "p3d-mat-grid";
        [{id:"clay",l:"Clay",c:"#c4a882",r:0.85,m:0},{id:"matte",l:"Matte",c:"#888",r:0.95,m:0},
         {id:"glossy",l:"Glossy",c:"#6688cc",r:0.08,m:0.15},{id:"metal",l:"Metal",c:"#b0b0cc",r:0.12,m:1}].forEach(p => {
            const b = document.createElement("div"); b.className = "p3d-mat-btn"; b.title = p.l + " material";
            const pv = document.createElement("div"); pv.className = "p3d-mat-preview";
            pv.style.background = `radial-gradient(circle at 35% 35%, ${p.c}, #1a1a1a)`;
            b.append(pv, document.createTextNode(p.l));
            b.addEventListener("click", () => this._applyMat(p)); mg.appendChild(b);
        });
        mats.content.appendChild(mg);
        const rR = createSliderRow("Rough", 0, 100, 85, v => { for (const o of this.selectedObjs) o.material.roughness = v/100; if(this.el.glossS){const g=100-v;this.el.glossS.value=g;this.el.glossV.value=g;} });
        const gR = createSliderRow("Gloss", 0, 100, 15, v => { for (const o of this.selectedObjs) o.material.roughness = 1-v/100; if(this.el.roughS){const r=100-v;this.el.roughS.value=r;this.el.roughV.value=r;} });
        const oR = createSliderRow("Opacity", 0, 100, 100, v => { for (const o of this.selectedObjs) { o.material.opacity=v/100; o.material.transparent=v<100; } });
        this.el.roughS=rR.slider;this.el.roughV=rR.numInput;
        this.el.glossS=gR.slider;this.el.glossV=gR.numInput;
        this.el.opacS=oR.slider;this.el.opacV=oR.numInput;
        mats.content.append(rR.el, gR.el, oR.el);
        right.insertBefore(mats.el, footer);

        // 4) Lighting
        const lp = createPanel("Lighting");
        const lcIn = createColorInput({ value: "#ffffff", onChange: (v) => { if (this.light) this.light.color.set(v); } });
        this.el.lightColor = lcIn; lp.content.appendChild(createRow("Color", lcIn));
        const iR = createSliderRow("Intensity", 0, 200, 85, v => { if (this.light) this.light.intensity = v/100*2; });
        const sR = createSliderRow("Ambient", 0, 100, 60, v => { if (this.ambientLight) this.ambientLight.intensity = v/100; });
        lp.content.append(iR.el, sR.el);
        const dirLabel = document.createElement("div"); dirLabel.style.cssText = "font-size:9px;color:#888;margin-top:4px;margin-bottom:3px;";
        dirLabel.textContent = "Light Direction"; lp.content.appendChild(dirLabel);
        const angR = createSliderRow("Angle", 0, 360, 45, v => { this._lightDir.theta = v * Math.PI / 180; this._applyLightDir(); });
        const hgtR = createSliderRow("Height", 5, 90, 55, v => { this._lightDir.phi = (90 - v) * Math.PI / 180; this._applyLightDir(); });
        this.el.lightAngle = angR.slider; this.el.lightAngleVal = angR.numInput;
        this.el.lightHeight = hgtR.slider; this.el.lightHeightVal = hgtR.numInput;
        lp.content.append(angR.el, hgtR.el);
        const resetLightBtn = createButton("Reset Light", { variant: "standard", onClick: () => {
            this._lightDir = { theta: 0.8, phi: 1.0 };
            this._applyLightDir();
            if (this.el.lightAngle) { this.el.lightAngle.value = 45; this.el.lightAngleVal.value = 45; }
            if (this.el.lightHeight) { this.el.lightHeight.value = 55; this.el.lightHeightVal.value = 55; }
            if (this.light) { this.light.color.set("#ffffff"); this.light.intensity = 1.7; }
            if (this.el.lightColor) this.el.lightColor.value = "#ffffff";
            if (this.ambientLight) this.ambientLight.intensity = 0.6;
        }, title: "Reset lighting to defaults" });
        resetLightBtn.style.cssText = "width:100%;margin-top:5px;";
        lp.content.appendChild(resetLightBtn);
        right.insertBefore(lp.el, footer);
    }

    // ─── Three.js ─────────────────────────────────────────────

    _initThree() {
        const vp = this.el.viewport, w = vp.clientWidth||800, h = vp.clientHeight||600;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.bgColor);
        this.camera = new THREE.PerspectiveCamera(this._fov, w/h, 0.1, 1000);
        this.camera.position.set(4, 3, 5);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        vp.insertBefore(this.renderer.domElement, vp.firstChild);

        this.orbitCtrl = new OrbitControls(this.camera, this.renderer.domElement);
        this.orbitCtrl.enableDamping = true; this.orbitCtrl.dampingFactor = 0.08;
        this.orbitCtrl.target.set(0, 0.5, 0);

        this.transformCtrl = new TransformControls(this.camera, this.renderer.domElement);
        this.transformCtrl.setMode("translate"); this.transformCtrl.setSize(0.85);
        this.transformCtrl.addEventListener("dragging-changed", e => {
            this.orbitCtrl.enabled = !e.value; this._gizmoDragging = e.value;
            if (e.value && this.activeObj && this.selectedObjs.size > 1) {
                // Starting drag — record initial positions/rotations/scales of all selected
                this._multiDragStart = new Map();
                for (const o of this.selectedObjs) {
                    if (o === this.activeObj) continue;
                    this._multiDragStart.set(o, {
                        pos: o.position.clone(), rot: o.rotation.clone(), scl: o.scale.clone(),
                    });
                }
                this._activeStartPos = this.activeObj.position.clone();
                this._activeStartRot = this.activeObj.rotation.clone();
                this._activeStartScl = this.activeObj.scale.clone();
            }
            if (!e.value) this._multiDragStart = null;
        });
        this.transformCtrl.addEventListener("objectChange", () => {
            // Multi-select: apply delta from activeObj to all selected objects
            if (!this._multiDragStart || !this.activeObj) return;
            const mode = this.transformCtrl.getMode();
            for (const [o, start] of this._multiDragStart) {
                if (mode === "translate") {
                    o.position.set(
                        start.pos.x + (this.activeObj.position.x - this._activeStartPos.x),
                        start.pos.y + (this.activeObj.position.y - this._activeStartPos.y),
                        start.pos.z + (this.activeObj.position.z - this._activeStartPos.z),
                    );
                } else if (mode === "rotate") {
                    o.rotation.set(
                        start.rot.x + (this.activeObj.rotation.x - this._activeStartRot.x),
                        start.rot.y + (this.activeObj.rotation.y - this._activeStartRot.y),
                        start.rot.z + (this.activeObj.rotation.z - this._activeStartRot.z),
                    );
                } else if (mode === "scale") {
                    const sx = this._activeStartScl.x ? this.activeObj.scale.x / this._activeStartScl.x : 1;
                    const sy = this._activeStartScl.y ? this.activeObj.scale.y / this._activeStartScl.y : 1;
                    const sz = this._activeStartScl.z ? this.activeObj.scale.z / this._activeStartScl.z : 1;
                    o.scale.set(start.scl.x * sx, start.scl.y * sy, start.scl.z * sz);
                }
            }
        });
        this.transformCtrl.addEventListener("mouseUp", () => this._pushUndo());
        const helper = typeof this.transformCtrl.getHelper === "function" ? this.transformCtrl.getHelper() : this.transformCtrl;
        this.scene.add(helper); this._gizmoHelper = helper;

        this.gridHelper = new THREE.GridHelper(20, 20, 0x333344, 0x222233);
        this.scene.add(this.gridHelper);

        // Canvas frame + gray masks (using shared framework component)
        this._canvasFrame = createCanvasFrame(vp);
        this._canvasFrame.update(this.docW, this.docH);

        // Lights
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6); this.scene.add(this.ambientLight);
        this.light = new THREE.DirectionalLight(0xffffff, 1.7);
        this.light.position.set(3, 5, 4); this.light.castShadow = true;
        this.light.shadow.mapSize.set(1024, 1024);
        this.light.shadow.camera.near=0.1; this.light.shadow.camera.far=50;
        this.light.shadow.camera.left=-10; this.light.shadow.camera.right=10;
        this.light.shadow.camera.top=10; this.light.shadow.camera.bottom=-10;
        this.scene.add(this.light);

        this._groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(20,20), new THREE.ShadowMaterial({opacity:0.35}));
        this._groundMesh.rotation.x = -Math.PI/2; this._groundMesh.receiveShadow = true;
        this.scene.add(this._groundMesh);

        // Pointer
        this.renderer.domElement.addEventListener("pointerdown", e => { if (e.button===0) this._ptr={x:e.clientX,y:e.clientY,t:Date.now()}; });
        this.renderer.domElement.addEventListener("pointerup", e => {
            if (e.button!==0||!this._ptr) return;
            const dx=e.clientX-this._ptr.x, dy=e.clientY-this._ptr.y, dt=Date.now()-this._ptr.t;
            this._ptr=null;
            if (Math.hypot(dx,dy)<6 && dt<500 && !this._gizmoDragging) this._onClick(e);
        });

        this._onKey = e => this._handleKey(e);
        this._onKeyUp = e => { if (this.el.overlay?.parentNode) { e.stopPropagation(); e.stopImmediatePropagation(); } };
        window.addEventListener("keydown", this._onKey, { capture: true });
        window.addEventListener("keyup", this._onKeyUp, { capture: true });
        window.addEventListener("keypress", this._onKeyUp, { capture: true });
        this._resizeObs = new ResizeObserver(() => this._onResize());
        this._resizeObs.observe(vp);
        this._applyLightDir();
    }

    _updateFrame() {
        if (this._canvasFrame) this._canvasFrame.update(this.docW, this.docH);
    }

    _onResize() {
        const vp = this.el.viewport; if (!vp||!this.renderer) return;
        const w = vp.clientWidth, h = vp.clientHeight; if (!w||!h) return;
        this.camera.aspect = w/h; this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h); this._updateFrame(); this._updateBgCSS();
    }

    _animate() {
        if (!this.renderer) return;
        this._animId = requestAnimationFrame(() => this._animate());
        this.orbitCtrl.update();
        this.renderer.render(this.scene, this.camera);
    }

    // ─── Shape Parameter UI ─────────────────────────────────

    _updateShapeParams() {
        const box = this.el.shapeParams; if (!box) return;
        box.innerHTML = "";
        const type = this._selectedShape;
        const p = this._shapeParams[type];
        if (!p) return;

        const defs = {
            cube: [
                {key:"width", label:"Width", min:0.1, max:5, step:0.1},
                {key:"height", label:"Height", min:0.1, max:5, step:0.1},
                {key:"depth", label:"Depth", min:0.1, max:5, step:0.1},
            ],
            sphere: [
                {key:"radius", label:"Radius", min:0.1, max:3, step:0.1},
                {key:"widthSegs", label:"Sides", min:3, max:64, step:1},
                {key:"heightSegs", label:"Rings", min:2, max:64, step:1},
            ],
            cylinder: [
                {key:"radiusTop", label:"Top Radius", min:0, max:3, step:0.05},
                {key:"radiusBottom", label:"Btm Radius", min:0.05, max:3, step:0.05},
                {key:"height", label:"Height", min:0.1, max:5, step:0.1},
                {key:"sides", label:"Sides", min:3, max:64, step:1},
            ],
            cone: [
                {key:"radius", label:"Radius", min:0.1, max:3, step:0.1},
                {key:"height", label:"Height", min:0.1, max:5, step:0.1},
                {key:"sides", label:"Sides", min:3, max:64, step:1},
            ],
            torus: [
                {key:"radius", label:"Radius", min:0.1, max:3, step:0.1},
                {key:"tube", label:"Tube", min:0.01, max:1.5, step:0.01},
                {key:"radialSegs", label:"Radial Segs", min:3, max:32, step:1},
                {key:"tubeSegs", label:"Tube Segs", min:3, max:64, step:1},
            ],
            plane: [
                {key:"width", label:"Width", min:0.1, max:10, step:0.1},
                {key:"height", label:"Height", min:0.1, max:10, step:0.1},
            ],
        };

        const fields = defs[type] || [];
        fields.forEach(f => {
            const row = document.createElement("div"); row.className = "p3d-row";
            const lbl = document.createElement("div"); lbl.className = "p3d-label"; lbl.textContent = f.label;
            const slider = document.createElement("input"); slider.type = "range"; slider.className = "p3d-range";
            slider.min = f.min; slider.max = f.max; slider.step = f.step; slider.value = p[f.key];
            const numIn = document.createElement("input"); numIn.type = "number"; numIn.className = "p3d-input";
            numIn.style.cssText = "width:50px;text-align:center;font-size:10px;padding:3px 4px;flex:none;border-radius:3px;";
            numIn.min = f.min; numIn.max = f.max; numIn.step = f.step;
            numIn.value = Number.isInteger(f.step) ? p[f.key] : p[f.key].toFixed(1);
            const sync = (v) => {
                p[f.key] = +v;
                slider.value = v;
                numIn.value = Number.isInteger(f.step) ? v : (+v).toFixed(1);
            };
            slider.addEventListener("input", () => sync(slider.value));
            numIn.addEventListener("change", () => { const v = Math.max(f.min, Math.min(f.max, +numIn.value || f.min)); sync(v); });
            row.append(lbl, slider, numIn);
            box.appendChild(row);
        });

        // Reset to defaults button
        const resetBtn = document.createElement("button"); resetBtn.className = "p3d-btn";
        resetBtn.style.cssText = "width:100%;margin-top:4px;font-size:10px;padding:4px 8px;";
        resetBtn.textContent = "\u21ba Reset " + type.charAt(0).toUpperCase() + type.slice(1) + " Defaults";
        resetBtn.title = "Reset parameters to default values";
        resetBtn.addEventListener("click", () => {
            this._shapeParams[type] = {...this._shapeDefaults[type]};
            this._updateShapeParams();
        });
        box.appendChild(resetBtn);
    }

    _addObjectWithParams() {
        const type = this._selectedShape;
        const p = this._shapeParams[type] ? {...this._shapeParams[type]} : {};
        this._addObject(type, p);
    }

    // ─── Objects ──────────────────────────────────────────────

    _makeGeo(type, gp) {
        switch(type) {
            case "cube":    return new THREE.BoxGeometry(gp.width||1, gp.height||1, gp.depth||1);
            case "sphere":  return new THREE.SphereGeometry(gp.radius||0.6, gp.widthSegs||16, gp.heightSegs||16);
            case "cylinder":return new THREE.CylinderGeometry(gp.radiusTop??0.5, gp.radiusBottom??0.5, gp.height||1.2, gp.sides||16);
            case "cone":    return new THREE.ConeGeometry(gp.radius||0.5, gp.height||1.2, gp.sides||16);
            case "torus":   return new THREE.TorusGeometry(gp.radius||0.5, gp.tube||0.2, gp.radialSegs||12, gp.tubeSegs||32);
            case "plane":   return new THREE.PlaneGeometry(gp.width||2, gp.height||2);
            default:        return new THREE.BoxGeometry(1,1,1);
        }
    }

    _addObject(type, gp) {
        this._pushUndo(); this._id++;
        if (!gp) gp = this._defaultGeoParams(type);
        const geo = this._makeGeo(type, gp);
        const color = new THREE.Color().setHSL(Math.random()*0.1+0.06, 0.45, 0.62);
        const mat = new THREE.MeshStandardMaterial({color, roughness:0.85, metalness:0, transparent:true, opacity:1});
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.position.y = type==="plane"?0.01:0.6;
        if (type==="plane") mesh.rotation.x = -Math.PI/2;
        mesh.userData = {id:this._id, name:type.charAt(0).toUpperCase()+type.slice(1)+" "+this._id, type, colorHex:"#"+color.getHexString(), locked:false, geoParams:{...gp}};
        this.scene.add(mesh); this.objects.push(mesh);
        this._select(mesh, false); this._updateLayers();
    }

    _defaultGeoParams(type) {
        const d = {
            cube:{width:1,height:1,depth:1}, sphere:{radius:0.6,widthSegs:16,heightSegs:16},
            cylinder:{radiusTop:0.5,radiusBottom:0.5,height:1.2,sides:16}, cone:{radius:0.5,height:1.2,sides:16},
            torus:{radius:0.5,tube:0.2,radialSegs:12,tubeSegs:32}, plane:{width:2,height:2},
        };
        return d[type] || {width:1,height:1,depth:1};
    }

    _deleteSelected() {
        if (!this.selectedObjs.size) return;
        this._pushUndo(); this.transformCtrl.detach();
        for (const o of this.selectedObjs) { this.scene.remove(o); o.geometry.dispose(); o.material.dispose(); this.objects = this.objects.filter(x=>x!==o); }
        this.selectedObjs.clear(); this.activeObj = null;
        this._updateLayers(); this._syncProps();
    }

    _dupSelected() {
        if (!this.activeObj) return;
        this._pushUndo();
        const src = this.activeObj;
        const m = new THREE.Mesh(src.geometry.clone(), src.material.clone());
        m.position.copy(src.position); m.position.x += 1;
        m.rotation.copy(src.rotation); m.scale.copy(src.scale);
        m.castShadow=true; m.receiveShadow=true;
        this._id++;
        m.userData = {...src.userData, id:this._id, name:src.userData.name+" copy", locked:false};
        this.scene.add(m); this.objects.push(m);
        this._select(m, false); this._updateLayers();
    }

    _select(mesh, additive) {
        if (!additive) { for (const o of this.selectedObjs) o.material.emissive?.setHex(0x000000); this.selectedObjs.clear(); }
        if (mesh) {
            if (this.selectedObjs.has(mesh) && additive) {
                mesh.material.emissive?.setHex(0x000000); this.selectedObjs.delete(mesh);
                this.activeObj = this.selectedObjs.size > 0 ? [...this.selectedObjs][0] : null;
            } else { this.selectedObjs.add(mesh); mesh.material.emissive?.setHex(0x3a1f00); this.activeObj = mesh; }
        } else { this.activeObj = null; }
        if (this.activeObj && !this.activeObj.userData.locked) this.transformCtrl.attach(this.activeObj);
        else this.transformCtrl.detach();
        this._syncProps(); this._updateLayers();
    }

    _setObjColor(hex) {
        if (!this.activeObj) return;
        for (const o of this.selectedObjs) { o.material.color.set(hex); o.userData.colorHex = hex; }
        this._syncHSLFromColor(); this._updateLayers();
    }

    _hslToColor() {
        if (!this.activeObj) return;
        const h = (this.el.hslH?.value||0)/360, s = (this.el.hslS?.value||0)/100, l = (this.el.hslL?.value||0)/100;
        const c = new THREE.Color().setHSL(h, s, l);
        const hex = "#"+c.getHexString();
        for (const o of this.selectedObjs) { o.material.color.copy(c); o.userData.colorHex = hex; }
        if (this.el.objColor) this.el.objColor.value = hex;
        this._updateLayers();
    }

    _syncHSLFromColor() {
        if (!this.activeObj) return;
        const hsl = {}; this.activeObj.material.color.getHSL(hsl);
        if (this.el.hslH) { this.el.hslH.value = Math.round(hsl.h*360); this.el.hslHV.textContent = Math.round(hsl.h*360); }
        if (this.el.hslS) { this.el.hslS.value = Math.round(hsl.s*100); this.el.hslSV.textContent = Math.round(hsl.s*100); }
        if (this.el.hslL) { this.el.hslL.value = Math.round(hsl.l*100); this.el.hslLV.textContent = Math.round(hsl.l*100); }
    }

    // ─── Materials ────────────────────────────────────────────

    _applyMat(p) {
        if (!this.activeObj) return;
        for (const o of this.selectedObjs) {
            o.material.color.set(p.c); o.material.roughness = p.r; o.material.metalness = p.m;
            o.userData.colorHex = p.c;
        }
        this._syncProps();
    }

    // ─── Tools & Camera ───────────────────────────────────────

    _setToolMode(mode) {
        this.toolMode = mode;
        if (this.transformCtrl) this.transformCtrl.setMode({move:"translate",rotate:"rotate",scale:"scale"}[mode]||"translate");
        ["move","rotate","scale"].forEach(m => this.el[`tool_${m}`]?.classList.toggle("active", m===mode));
        const def = this._toolDefs.find(t=>t.id===mode);
        if (this.el.toolInfo && def) this.el.toolInfo.textContent = def.tip;
    }

    _camView(id) {
        const dist = 6;
        if (id==="front") { this.camera.position.set(0,1,dist); this.orbitCtrl.target.set(0,1,0); }
        else if (id==="side") { this.camera.position.set(dist,1,0); this.orbitCtrl.target.set(0,1,0); }
        else if (id==="back") { this.camera.position.set(0,1,-dist); this.orbitCtrl.target.set(0,1,0); }
        else if (id==="top") { this.camera.position.set(0,dist+2,0.01); this.orbitCtrl.target.set(0,0,0); }
        else if (id==="focus" && this.activeObj) {
            const p = this.activeObj.position;
            this.orbitCtrl.target.set(p.x,p.y,p.z);
            this.camera.position.set(p.x+3,p.y+2,p.z+3);
        }
        this.orbitCtrl.update();
    }

    _setPerspective(persp) {
        if (persp === !this._isOrtho) return; // Already in this mode
        const vp = this.el.viewport, w = vp.clientWidth, h = vp.clientHeight;
        const pos = this.camera.position.clone(), tgt = this.orbitCtrl.target.clone();
        if (persp) {
            this.camera = new THREE.PerspectiveCamera(this._fov, w/h, 0.1, 1000);
            this._isOrtho = false;
        } else {
            this.camera = new THREE.OrthographicCamera(-5*w/h, 5*w/h, 5, -5, 0.1, 1000);
            this._isOrtho = true;
        }
        this.camera.position.copy(pos); this.camera.lookAt(tgt);
        if (this._isOrtho) this.camera.updateProjectionMatrix();
        this.orbitCtrl.object = this.camera; this.orbitCtrl.update();
        this.transformCtrl.camera = this.camera;
        this.el.perspBtn?.classList.toggle("active", !this._isOrtho);
        this.el.isoBtn?.classList.toggle("active", this._isOrtho);
    }

    // ─── Lighting ─────────────────────────────────────────────

    _applyLightDir() {
        if (!this.light) return;
        const d = 6, {theta, phi} = this._lightDir;
        this.light.position.set(d*Math.sin(phi)*Math.sin(theta), d*Math.cos(phi), d*Math.sin(phi)*Math.cos(theta));
    }

    // ─── Interaction ──────────────────────────────────────────

    _onClick(e) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1, -((e.clientY-rect.top)/rect.height)*2+1);
        const ray = new THREE.Raycaster(); ray.setFromCamera(mouse, this.camera);
        const hits = ray.intersectObjects(this.objects);
        if (hits.length > 0) this._select(hits[0].object, e.shiftKey);
        else {
            for (const o of this.selectedObjs) o.material.emissive?.setHex(0x000000);
            this.selectedObjs.clear(); this.activeObj = null;
            this.transformCtrl.detach(); this._syncProps(); this._updateLayers();
        }
    }

    _handleKey(e) {
        if (!this.el.overlay?.parentNode) return;
        // Block ALL key events from reaching ComfyUI while overlay is open
        e.stopPropagation();
        e.stopImmediatePropagation();
        // Check if focus is on an input element inside our overlay
        const ae = document.activeElement;
        const tag = ae?.tagName;
        const isTrap = ae?.dataset?.pixaromaTrap;
        // For Ctrl+A: always handle it if our overlay is open (prevent selecting input text)
        const k = e.key, kl = k.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && kl === "a") {
            e.preventDefault();
            // Blur any focused input first
            if ((tag === "INPUT" || tag === "TEXTAREA") && !isTrap) ae.blur();
            this._selectAll();
            return;
        }
        // For other shortcuts, skip if inside input fields (but not our focus trap)
        if ((tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") && !isTrap) return;
        const handled = ctrl ? ["z","y","d","s"].includes(kl) : ["m","r","s","f","b","t","0","1","2","3","4","delete","backspace","escape"].includes(kl);
        if (handled) e.preventDefault();
        if (ctrl && kl === "z") { this._undo(); return; }
        if (ctrl && kl === "y") { this._redo(); return; }
        if (ctrl && kl === "d") { this._dupSelected(); return; }
        if (ctrl && kl === "s") { this._save(); return; }
        if (kl === "delete" || kl === "backspace") { this._deleteSelected(); return; }
        if (kl === "escape") { if (this.el.helpOverlay?.style.display === "block") this.el.helpOverlay.style.display = "none"; return; }
        if (kl === "m") this._setToolMode("move");
        else if (kl === "r") this._setToolMode("rotate");
        else if (kl === "s") this._setToolMode("scale");
        else if (kl === "f" || k === "1") this._camView("front");
        else if (k === "2") this._camView("side");
        else if (kl === "b" || k === "3") this._camView("back");
        else if (kl === "t" || k === "4") this._camView("top");
        else if (k === "0") this._camView("focus");
    }

    _selectAll() {
        for (const o of this.selectedObjs) o.material.emissive?.setHex(0x000000);
        this.selectedObjs.clear();
        this.objects.forEach(o => { this.selectedObjs.add(o); o.material.emissive?.setHex(0x3a1f00); });
        // Set active to first unlocked object for gizmo
        this.activeObj = this.objects.find(o => !o.userData.locked) || this.objects[0] || null;
        if (this.activeObj) {
            this.activeObj.material.emissive?.setHex(0x4a2800);
            this.transformCtrl.attach(this.activeObj);
        }
        this._updateLayers(); this._syncProps();
        this._setStatus(`Selected all ${this.objects.length} objects`);
    }

    // ─── Undo ─────────────────────────────────────────────────

    _snap() { return this.objects.map(o=>({id:o.userData.id,name:o.userData.name,type:o.userData.type,colorHex:o.userData.colorHex,locked:o.userData.locked,gp:o.userData.geoParams?{...o.userData.geoParams}:null,pos:o.position.toArray(),rot:[o.rotation.x,o.rotation.y,o.rotation.z],scl:o.scale.toArray(),rough:o.material.roughness,metal:o.material.metalness,opac:o.material.opacity,vis:o.visible})); }
    _pushUndo() { if(this._isRestoring)return; this._undoStack.push(this._snap()); if(this._undoStack.length>this.MAX_UNDO)this._undoStack.shift(); this._redoStack=[]; }
    _undo() { if(!this._undoStack.length)return; this._redoStack.push(this._snap()); this._applySnap(this._undoStack.pop()); }
    _redo() { if(!this._redoStack.length)return; this._undoStack.push(this._snap()); this._applySnap(this._redoStack.pop()); }
    _applySnap(state) {
        this.transformCtrl.detach();
        this.objects.forEach(o=>{this.scene.remove(o);o.geometry.dispose();o.material.dispose();});
        this.objects=[]; this.selectedObjs.clear(); this.activeObj=null;
        state.forEach(d=>{
            const gp = d.gp || this._defaultGeoParams(d.type);
            const g = this._makeGeo(d.type, gp);
            const mat=new THREE.MeshStandardMaterial({color:d.colorHex||"#888",roughness:d.rough??0.85,metalness:d.metal??0,transparent:true,opacity:d.opac??1});
            const m=new THREE.Mesh(g,mat);m.castShadow=true;m.receiveShadow=true;
            if(d.pos)m.position.fromArray(d.pos);if(d.rot)m.rotation.set(d.rot[0],d.rot[1],d.rot[2]);if(d.scl)m.scale.fromArray(d.scl);
            m.visible=d.vis!==false;m.userData={id:d.id,name:d.name,type:d.type,colorHex:d.colorHex,locked:d.locked||false,geoParams:gp};
            if(d.id>this._id)this._id=d.id;
            this.scene.add(m);this.objects.push(m);
        });
        if(this.objects.length)this._select(this.objects[0],false);
        this._updateLayers();
    }

    // ─── Panels ───────────────────────────────────────────────

    _syncProps() {
        const o = this.activeObj;
        if (!o) { if(this.el.objColor)this.el.objColor.value="#888"; if(this.el.objName)this.el.objName.value=""; return; }
        if(this.el.objColor)this.el.objColor.value=o.userData.colorHex||"#"+o.material.color.getHexString();
        if(this.el.objName)this.el.objName.value=o.userData.name||"";
        if(this.el.roughS){const v=Math.round(o.material.roughness*100);this.el.roughS.value=v;this.el.roughV.value=v;}
        if(this.el.glossS){const v=Math.round((1-o.material.roughness)*100);this.el.glossS.value=v;this.el.glossV.value=v;}
        if(this.el.opacS){const v=Math.round(o.material.opacity*100);this.el.opacS.value=v;this.el.opacV.value=v;}
        this._syncHSLFromColor();
    }

    _updateLayers() {
        if (!this._layerPanel) return;
        const items = this.objects.map((obj, i) => {
            const isActive = obj === this.activeObj;
            const isMulti = this.selectedObjs.has(obj) && !isActive;

            // Color swatch thumbnail
            const dot = document.createElement("div");
            dot.className = "p3d-layer-color";
            dot.style.background = obj.userData.colorHex || "#888";

            return createLayerItem({
                name: obj.userData.name || "Object",
                visible: obj.visible,
                locked: !!obj.userData.locked,
                active: isActive,
                multiSelected: isMulti,
                thumbnail: dot,
                onVisibilityToggle: () => {
                    obj.visible = !obj.visible;
                    this._updateLayers();
                },
                onLockToggle: () => {
                    obj.userData.locked = !obj.userData.locked;
                    if (obj.userData.locked && obj === this.activeObj) this.transformCtrl.detach();
                    this._updateLayers();
                },
                onClick: (e) => {
                    if (e.detail > 1) return;
                    this._select(obj, e.shiftKey || e.ctrlKey);
                },
                onRename: (newName) => {
                    obj.userData.name = newName;
                    this._syncProps();
                },
            }).el;
        });
        this._layerPanel.refresh(items);
    }

    // ─── Save / Restore ───────────────────────────────────────

    _serializeScene() {
        return {
            doc_w:this.docW,doc_h:this.docH,project_id:this.projectId,bgColor:this.bgColor,fov:this._fov,shadows:this._shadows,isOrtho:this._isOrtho,
            objects:this.objects.map(o=>({id:o.userData.id,name:o.userData.name,type:o.userData.type,colorHex:o.userData.colorHex,locked:o.userData.locked,
                geoParams:o.userData.geoParams||null,
                position:{x:o.position.x,y:o.position.y,z:o.position.z},rotation:{x:o.rotation.x,y:o.rotation.y,z:o.rotation.z},
                scale:{x:o.scale.x,y:o.scale.y,z:o.scale.z},roughness:o.material.roughness,metalness:o.material.metalness,opacity:o.material.opacity,visible:o.visible})),
            camera:{position:{x:this.camera.position.x,y:this.camera.position.y,z:this.camera.position.z},target:{x:this.orbitCtrl.target.x,y:this.orbitCtrl.target.y,z:this.orbitCtrl.target.z}},
            light:{color:this.el.lightColor?.value||"#fff",intensity:this.light?.intensity||1.7,ambient:this.ambientLight?.intensity||0.6,dir:{...this._lightDir}},
            showGrid:this._showGrid,showGizmo:this._showGizmo,
            bgImage: this._bgImg.path ? { path: this._bgImg.path, x: this._bgImg.x, y: this._bgImg.y, scale: this._bgImg.scale, rotation: this._bgImg.rotation, opacity: this._bgImg.opacity } : null,
        };
    }

    _restoreScene(jsonStr) {
        if (!jsonStr||jsonStr==="{}"){this._undoStack=[];this._redoStack=[];this._updateLayers();return;}
        this._isRestoring = true;
        try {
            const d=JSON.parse(jsonStr);
            if(d.doc_w){this.docW=d.doc_w;}
            if(d.doc_h){this.docH=d.doc_h;}
            // Sync canvas settings component with restored dimensions
            if (this._canvasSettings) {
                this._canvasSettings.setSize(this.docW, this.docH);
            }
            if(d.bgColor){this.bgColor=d.bgColor;if(this.el.bgColor)this.el.bgColor.value=d.bgColor;this.scene.background=new THREE.Color(d.bgColor);}
            if(d.fov!==undefined){this._fov=d.fov;if(this.el.fovSlider)this.el.fovSlider.value=d.fov;if(this.el.fovVal)this.el.fovVal.value=d.fov;if(this.camera.fov!==undefined){this.camera.fov=d.fov;this.camera.updateProjectionMatrix();}}
            if(d.shadows!==undefined){this._shadows=d.shadows;if(this.el.shadowCheck)this.el.shadowCheck.checked=d.shadows;if(this._groundMesh)this._groundMesh.visible=d.shadows;}
            if(d.isOrtho)this._setPerspective(false);
            if(d.project_id)this.projectId=d.project_id;
            this._updateFrame();
            if(d.objects)d.objects.forEach(od=>this._addObjFromData(od));
            if(d.camera){if(d.camera.position)this.camera.position.set(d.camera.position.x,d.camera.position.y,d.camera.position.z);if(d.camera.target)this.orbitCtrl.target.set(d.camera.target.x,d.camera.target.y,d.camera.target.z);}
            if(d.light){
                if(d.light.color&&this.el.lightColor){this.el.lightColor.value=d.light.color;this.light.color.set(d.light.color);}
                if(d.light.intensity)this.light.intensity=d.light.intensity;
                if(d.light.ambient)this.ambientLight.intensity=d.light.ambient;
                if(d.light.dir){this._lightDir={...d.light.dir};this._applyLightDir();
                    if(this.el.lightAngle)this.el.lightAngle.value=Math.round(this._lightDir.theta*180/Math.PI);
                    if(this.el.lightHeight)this.el.lightHeight.value=Math.round(90-this._lightDir.phi*180/Math.PI);
                }
            }
            if(d.showGrid!==undefined){this._showGrid=d.showGrid;if(this.el.gridCheck)this.el.gridCheck.checked=d.showGrid;if(this.gridHelper)this.gridHelper.visible=d.showGrid;}
            if(d.showGizmo!==undefined){this._showGizmo=d.showGizmo;if(this.el.gizmoCheck)this.el.gizmoCheck.checked=d.showGizmo;if(this._gizmoHelper)this._gizmoHelper.visible=d.showGizmo;}
            if(d.bgImage&&d.bgImage.path){
                this._bgImg={path:d.bgImage.path, x:d.bgImage.x||0, y:d.bgImage.y||0, scale:d.bgImage.scale||100, rotation:d.bgImage.rotation||0, opacity:d.bgImage.opacity??100, _natW:0, _natH:0};
                this._syncBgSliders();
                // Load from server path — split into filename + subfolder for ComfyUI /view
                const parts = d.bgImage.path.replace(/\\/g, "/").split("/");
                const fname = parts.pop();
                const subfolder = parts.join("/") || "pixaroma";
                const imgSrc="/view?filename="+encodeURIComponent(fname)+"&type=input&subfolder="+encodeURIComponent(subfolder)+"&t="+Date.now();
                this._showBgImage(imgSrc, false);
            }
            if(this.objects.length)this._select(this.objects[0],false);
            this._updateLayers();
            this._isRestoring = false;
            this._undoStack = []; this._redoStack = [];
        } catch(e){console.warn("[P3D]",e);this._isRestoring=false;this._addObject("cube");}
    }

    _addObjFromData(od) {
        const gp = od.geoParams || this._defaultGeoParams(od.type||"cube");
        this._addObject(od.type||"cube", gp);
        const m=this.objects[this.objects.length-1];
        m.userData.name=od.name||m.userData.name;m.userData.id=od.id||m.userData.id;m.userData.colorHex=od.colorHex;m.userData.locked=od.locked||false;
        if(od.colorHex)m.material.color.set(od.colorHex);
        if(od.position)m.position.set(od.position.x,od.position.y,od.position.z);
        if(od.rotation)m.rotation.set(od.rotation.x,od.rotation.y,od.rotation.z);
        if(od.scale)m.scale.set(od.scale.x,od.scale.y,od.scale.z);
        if(od.roughness!==undefined)m.material.roughness=od.roughness;
        if(od.metalness!==undefined)m.material.metalness=od.metalness;
        if(od.opacity!==undefined){m.material.opacity=od.opacity;m.material.transparent=od.opacity<1;}
        m.visible=od.visible!==false;
    }

    async _save() {
        this._layout.setSaving();
        try {
            const pr=this.renderer.getPixelRatio();
            const vp = this.el.viewport;
            const vpW = vp.clientWidth, vpH = vp.clientHeight;
            // Get frame rect (what the user sees as the canvas area)
            const fr = this._getFrameRect();

            // Use setViewOffset to render exactly the frame area at docW×docH output
            // This gives true WYSIWYG: objects appear the same size relative to frame
            this.renderer.setPixelRatio(1);
            this.renderer.setSize(this.docW, this.docH);
            this.camera.aspect = vpW / vpH; // keep live preview aspect
            this.camera.setViewOffset(vpW, vpH, fr.x, fr.y, fr.w, fr.h);
            this.camera.updateProjectionMatrix();

            if(this.gridHelper)this.gridHelper.visible=false;
            if(this._gizmoHelper)this._gizmoHelper.visible=false;
            if(this._canvasFrame)this._canvasFrame.setVisible(false);
            this.objects.forEach(o=>o.material.emissive?.setHex(0x000000));

            // For save render: temporarily restore scene bg if no bg image
            const hadBgImage = this.el.bgImgEl && this._bgImg.path;
            if (!hadBgImage && this.scene.background === null) this.scene.background = new THREE.Color(this.bgColor);
            this.renderer.render(this.scene,this.camera);

            let dataURL;
            if (hadBgImage) {
                // Composite bg image behind 3D render at canvas resolution
                const compCanvas = document.createElement("canvas");
                compCanvas.width = this.docW; compCanvas.height = this.docH;
                const ctx = compCanvas.getContext("2d");
                ctx.fillStyle = this.bgColor; ctx.fillRect(0, 0, this.docW, this.docH);
                const img = this.el.bgImgEl;
                const aspect = this._bgImg._natW / this._bgImg._natH;
                // Base: image width = canvas width, height preserves aspect
                const baseW = this.docW;
                const baseH = baseW / aspect;
                const sc = this._bgImg.scale / 100;
                const iw = baseW * sc, ih = baseH * sc;
                const cx = this.docW / 2 + (this._bgImg.x / 100) * this.docW;
                const cy = this.docH / 2 + (this._bgImg.y / 100) * this.docH;
                ctx.save();
                ctx.globalAlpha = this._bgImg.opacity / 100;
                ctx.translate(cx, cy);
                ctx.rotate(this._bgImg.rotation * Math.PI / 180);
                ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
                ctx.restore();
                ctx.drawImage(this.renderer.domElement, 0, 0);
                dataURL = compCanvas.toDataURL("image/png");
            } else {
                dataURL = this.renderer.domElement.toDataURL("image/png");
            }
            // Restore transparent bg for live preview if bg image active
            if (hadBgImage) { this.scene.background = null; this.renderer.setClearColor(0x000000, 0); }

            // Restore camera: clear view offset and restore live preview state
            this.camera.clearViewOffset();
            if(this.gridHelper)this.gridHelper.visible=this._showGrid;
            if(this._gizmoHelper)this._gizmoHelper.visible=this._showGizmo;
            if(this._canvasFrame)this._canvasFrame.setVisible(true);
            if(this.activeObj)this.activeObj.material.emissive?.setHex(0x3a1f00);
            this.renderer.setPixelRatio(pr);
            this._onResize();

            const res=await ThreeDAPI.saveRender(this.projectId,dataURL);
            if(res.status==="success"){
                const sd=this._serializeScene();sd.composite_path=res.composite_path;
                if(this.onSave)this.onSave(JSON.stringify(sd),dataURL);
                this._layout.setSaved();
            } else this._layout.setSaveError("Save failed");
        } catch(e){console.error("[P3D]",e);this._layout.setSaveError("Save error");}
    }

    _close() {
        if (this._closed) return;
        this._closed = true;
        if(this._animId)cancelAnimationFrame(this._animId);this._animId=null;
        window.removeEventListener("keydown",this._onKey,{capture:true});
        window.removeEventListener("keyup",this._onKeyUp,{capture:true});
        window.removeEventListener("keypress",this._onKeyUp,{capture:true});
        if(this._resizeObs)this._resizeObs.disconnect();
        if(this.transformCtrl){this.transformCtrl.detach();this.transformCtrl.dispose();}
        if(this.orbitCtrl)this.orbitCtrl.dispose();
        if(this.renderer){this.renderer.dispose();this.renderer.forceContextLoss();}
        this.objects.forEach(o=>{o.geometry?.dispose();o.material?.dispose();});
        if(this._layout)this._layout.unmount(); else if(this.el.overlay?.parentNode)this.el.overlay.parentNode.removeChild(this.el.overlay);
        this.scene=null;this.camera=null;this.renderer=null;
        if (this.onClose) this.onClose();
    }

    // ─── Background Image (CSS 2D) ─────────────────────────────

    _loadBgImage() {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "image/*";
        input.addEventListener("change", () => {
            const file = input.files?.[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const dataURL = ev.target.result;
                this._setStatus("Uploading background...");
                try {
                    const res = await ThreeDAPI.uploadBgImage(this.projectId, dataURL);
                    if (res.status === "success" && res.path) {
                        this._bgImg.path = res.path;
                        this._showBgImage(dataURL, true);
                        this._setStatus("Background loaded");
                    } else { this._setStatus("Upload failed"); }
                } catch (e) { console.warn("[P3D] bg upload", e); this._setStatus("Upload error"); }
            };
            reader.readAsDataURL(file);
        });
        input.click();
    }

    _showBgImage(src, autoFit) {
        const cont = this.el.bgContainer; if (!cont) return;
        cont.innerHTML = "";
        const img = document.createElement("img");
        img.crossOrigin = "anonymous";
        img.src = src;
        img.onload = () => {
            this._bgImg._natW = img.naturalWidth;
            this._bgImg._natH = img.naturalHeight;
            if (autoFit) this._fitBg("width");
            else this._updateBgCSS();
        };
        img.onerror = () => { this._setStatus("Failed to load bg image"); };
        this.el.bgImgEl = img;
        cont.appendChild(img);
        // Make canvas transparent so bg shows through
        if (this.scene) this.scene.background = null;
        if (this.renderer) this.renderer.setClearColor(0x000000, 0);
        if (this._updateBgPanelState) this._updateBgPanelState();
    }

    // Compute the pixel rect of the canvas frame inside the viewport
    _getFrameRect() {
        const vp = this.el.viewport; if (!vp) return { x: 0, y: 0, w: 800, h: 600 };
        const vpW = vp.clientWidth, vpH = vp.clientHeight;
        const s = Math.min(vpW / this.docW, vpH / this.docH, 1);
        const fw = this.docW * s, fh = this.docH * s;
        return { x: (vpW - fw) / 2, y: (vpH - fh) / 2, w: fw, h: fh };
    }

    _updateBgCSS() {
        const img = this.el.bgImgEl; if (!img) return;
        if (!this._bgImg._natW || !this._bgImg._natH) return;
        const fr = this._getFrameRect();
        const aspect = this._bgImg._natW / this._bgImg._natH;
        // Base size: fit width of canvas frame, preserving aspect
        const baseW = fr.w;
        const baseH = baseW / aspect;
        // Apply scale
        const sc = this._bgImg.scale / 100;
        const iw = baseW * sc, ih = baseH * sc;
        // Position: center of frame + offset (offset in % of frame size)
        const cx = fr.x + fr.w / 2 + (this._bgImg.x / 100) * fr.w;
        const cy = fr.y + fr.h / 2 + (this._bgImg.y / 100) * fr.h;
        img.style.width = iw + "px";
        img.style.height = ih + "px";
        img.style.left = cx + "px";
        img.style.top = cy + "px";
        const fh = this._bgImg._flipH ? " scaleX(-1)" : "";
        const fv = this._bgImg._flipV ? " scaleY(-1)" : "";
        img.style.transform = `translate(-50%,-50%) rotate(${this._bgImg.rotation}deg)${fh}${fv}`;
        img.style.opacity = this._bgImg.opacity / 100;
    }

    _fitBg(mode) {
        if (!this._bgImg._natW || !this._bgImg._natH) return;
        const natW = this._bgImg._natW, natH = this._bgImg._natH;
        const aspect = natW / natH;
        const fr = this._getFrameRect();
        // Base size is fit-width, so scale=100 means image width == frame width
        if (mode === "width") {
            this._bgImg.scale = 100;
        } else if (mode === "height") {
            // Scale so image height == frame height
            const baseH = fr.w / aspect;
            this._bgImg.scale = Math.round((fr.h / baseH) * 100);
        } else {
            // fill: cover the entire frame
            const baseH = fr.w / aspect;
            const scaleW = 100; // width fits at 100
            const scaleH = Math.round((fr.h / baseH) * 100);
            this._bgImg.scale = Math.max(scaleW, scaleH);
        }
        this._bgImg.x = 0; this._bgImg.y = 0;
        this._syncBgSliders();
        this._updateBgCSS();
    }

    _syncBgSliders() {
        if (this.el.bgX) { this.el.bgX.value = this._bgImg.x; this.el.bgXV.value = this._bgImg.x; }
        if (this.el.bgY) { this.el.bgY.value = this._bgImg.y; this.el.bgYV.value = this._bgImg.y; }
        if (this.el.bgSc) { this.el.bgSc.value = this._bgImg.scale; this.el.bgScV.value = this._bgImg.scale; }
        if (this.el.bgRot) { this.el.bgRot.value = this._bgImg.rotation; this.el.bgRotV.value = this._bgImg.rotation; }
        if (this.el.bgOp) { this.el.bgOp.value = this._bgImg.opacity; this.el.bgOpV.value = this._bgImg.opacity; }
    }

    _removeBgImage() {
        const cont = this.el.bgContainer; if (cont) cont.innerHTML = "";
        this.el.bgImgEl = null;
        this._bgImg = { path: null, x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, _natW: 0, _natH: 0 };
        // Restore scene background
        if (this.scene) this.scene.background = new THREE.Color(this.bgColor);
        this._syncBgSliders();
        if (this._updateBgPanelState) this._updateBgPanelState();
        this._setStatus("Background removed");
    }

    // ─── Helpers ──────────────────────────────────────────────
    // Helpers — _section/_row/_sliderRow/_numInput still used by _updateShapeParams for dynamic shape parameter panels
    _section(t){const p=createPanel(t);return p.content;}
    _row(l,el){return createRow(l,el);}
    _numInput(v){return createNumberInput({value:v});}
    _sliderRow(label,min,max,val,onChange){const sr=createSliderRow(label,min,max,val,onChange);return{row:sr.el,slider:sr.slider,val:sr.numInput};}
    _mkBtn(text,onClick,cls="pxf-btn",tip=""){return createButton(text,{variant:cls.includes("accent")?"accent":cls.includes("danger")?"danger":"standard",onClick,title:tip});}
    _setStatus(msg){if(this.el.status)this.el.status.textContent=msg;}
    _toggleHelp(){if(this._layout)this._layout.toggleHelp();}
}
