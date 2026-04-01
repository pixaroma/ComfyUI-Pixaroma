// ============================================================
// Pixaroma 3D Editor — Three.js WebGL Scene Editor  v5
// ============================================================
import { ThreeDAPI } from "./pixaroma_3d_api.js";
import { installFocusTrap } from "./pixaroma_node_utils.js";

let THREE = null, OrbitControls = null, TransformControls = null;
const ESM = "https://esm.sh/three@0.170.0";
async function loadThree() {
    if (THREE) return;
    THREE = await import(ESM);
    OrbitControls = (await import(ESM + "/examples/jsm/controls/OrbitControls.js")).OrbitControls;
    TransformControls = (await import(ESM + "/examples/jsm/controls/TransformControls.js")).TransformControls;
}

const STYLE_ID = "pixaroma-3d-v6";
function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    for (const old of ["pixaroma-3d-styles","pixaroma-3d-styles-v3","pixaroma-3d-v4","pixaroma-3d-v5"]) document.getElementById(old)?.remove();
    const s = document.createElement("style"); s.id = STYLE_ID;
    s.textContent = `
.p3d-overlay{position:fixed;inset:0;z-index:11000;display:flex;flex-direction:column;background:#171718;font-family:'Segoe UI',system-ui,monospace;color:#e0e0e0;overflow:hidden;user-select:none;}
.p3d-titlebar{display:flex;align-items:center;padding:0 14px;background:#131415;border-bottom:1px solid #2e3033;height:38px;flex-shrink:0;}
.p3d-title{color:#fff;font-size:14px;font-weight:bold;flex:1;display:flex;align-items:center;gap:6px;font-family:monospace;}
.p3d-body{display:flex;flex:1;overflow:hidden;min-height:0;}
.p3d-left{width:260px;min-width:260px;flex-shrink:0;background:#181a1b;border-right:1px solid #2a2c2e;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;}
.p3d-viewport{flex:1;position:relative;overflow:hidden;background:#000;min-width:0;}
.p3d-viewport canvas{display:block;}
.p3d-right{width:260px;min-width:260px;flex-shrink:0;background:#181a1b;border-left:1px solid #2a2c2e;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;}
.p3d-section{padding:10px 12px;border-bottom:1px solid #2a2c2e;}
.p3d-section-title{font-size:10px;font-weight:bold;color:#777;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;font-family:monospace;}
.p3d-btn{display:inline-flex;align-items:center;justify-content:center;padding:5px 12px;background:#242628;color:#ccc;border:1px solid #3a3d40;border-radius:5px;cursor:pointer;font-size:11px;font-family:inherit;transition:all .12s;white-space:nowrap;}
.p3d-btn:hover{background:#2a2c2e;border-color:#666;}
.p3d-btn.active{background:#f66744;border-color:#f66744;color:#fff;}
.p3d-btn-accent{background:#f66744;border-color:#f66744;color:#fff;font-size:13px;padding:7px 18px;font-weight:bold;border-radius:6px;}
.p3d-btn-accent:hover{background:#e05535;}
.p3d-btn-danger{background:#3a1515;border-color:#cc3333;color:#ff6666;}
.p3d-btn-danger:hover{background:#551a1a;}
.p3d-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;}
.p3d-grid4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;}
.p3d-obj-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;height:54px;cursor:pointer;border:1px solid #3a3d40;background:#242628;color:#ccc;border-radius:5px;font-size:10px;gap:3px;transition:all .12s;}
.p3d-obj-btn:hover{background:#2a2c2e;border-color:#f66744;}
.p3d-obj-btn.selected{background:#2a1800;border-color:#f66744;color:#fff;}
.p3d-obj-btn .icon{font-size:18px;}
.p3d-shape-params{margin-top:8px;padding:6px 0;border-top:1px solid #2a2c2e;}
.p3d-tool-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;height:46px;cursor:pointer;border:1px solid #3a3d40;background:#242628;color:#ccc;border-radius:5px;font-size:10px;gap:2px;transition:all .12s;}
.p3d-tool-btn:hover{background:#2a2c2e;border-color:#666;}
.p3d-tool-btn.active{background:#f66744;border-color:#f66744;color:#fff;}
.p3d-tool-btn .icon{font-size:15px;line-height:1;}
.p3d-layer-item{display:flex;align-items:center;gap:5px;padding:4px 6px;border:1px solid transparent;border-radius:4px;cursor:pointer;font-size:11px;transition:all .1s;min-height:26px;}
.p3d-layer-item:hover{background:#222426;}
.p3d-layer-item.active{background:#2a1800;border-color:#f66744;}
.p3d-layer-item.multi{background:#0a1a2a;border-color:#0ea5e9;}
.p3d-layer-vis,.p3d-layer-lock{cursor:pointer;font-size:12px;width:16px;text-align:center;flex-shrink:0;}
.p3d-layer-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.p3d-layer-color{width:14px;height:14px;border-radius:3px;border:1px solid #555;flex-shrink:0;}
.p3d-name-input{background:#111;color:#e0e0e0;border:1px solid #f66744;border-radius:3px;padding:2px 5px;font-size:11px;font-family:inherit;width:100%;box-sizing:border-box;}
.p3d-row{display:flex;align-items:center;gap:6px;margin-bottom:5px;}
.p3d-label{font-size:10px;color:#999;min-width:56px;flex-shrink:0;font-family:monospace;}
.p3d-input{flex:1;background:#111;color:#e0e0e0;border:1px solid #3a3d40;border-radius:4px;padding:3px 6px;font-size:11px;font-family:monospace;min-width:0;}
.p3d-range{flex:1;accent-color:#f66744;cursor:pointer;}
.p3d-range-val{width:36px;text-align:right;font-size:10px;color:#aaa;flex-shrink:0;font-family:monospace;}
.p3d-mat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;}
.p3d-mat-btn{display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 2px;cursor:pointer;border:1px solid #3a3d40;background:#242628;border-radius:5px;font-size:9px;color:#999;transition:all .12s;}
.p3d-mat-btn:hover,.p3d-mat-btn.active{border-color:#f66744;background:#2a2c2e;}
.p3d-mat-preview{width:28px;height:28px;border-radius:50%;border:1px solid #555;}
.p3d-dir-ctrl{display:flex;gap:12px;align-items:center;margin-top:6px;}
.p3d-dir-label{font-size:9px;color:#888;text-align:center;margin-top:2px;}
.p3d-help{display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a1c1d;border:1px solid #f66744;border-radius:10px;padding:18px 22px;z-index:100;max-width:520px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 28px rgba(0,0,0,.7);}
.p3d-bottom-bar{position:absolute;bottom:12px;right:12px;display:flex;gap:8px;z-index:5;}
.p3d-frame{position:absolute;pointer-events:none;z-index:2;box-sizing:border-box;border:2px solid rgba(249,115,22,0.45);}
.p3d-frame-label{position:absolute;bottom:-16px;right:0;font-size:9px;color:rgba(249,115,22,0.6);font-family:monospace;}
.p3d-frame-mask{position:absolute;pointer-events:none;z-index:1;}
.p3d-tool-info{position:absolute;bottom:12px;left:12px;background:rgba(0,0,0,.75);color:#ccc;padding:5px 12px;border-radius:5px;font-size:10px;pointer-events:none;z-index:5;max-width:340px;font-family:monospace;}
.p3d-layer-item.drag-over-top{border-top:2px solid #f66744!important;}
.p3d-layer-item.drag-over-bottom{border-bottom:2px solid #f66744!important;}
.p3d-layer-item.dragging{opacity:0.35;}
.p3d-hsl-row{display:flex;align-items:center;gap:4px;margin-bottom:3px;}
.p3d-hsl-row label{font-size:9px;color:#888;width:14px;flex-shrink:0;font-family:monospace;}
.p3d-hsl-row input[type=range]{flex:1;accent-color:#f66744;height:6px;}
.p3d-hsl-row .val{font-size:9px;color:#aaa;width:28px;text-align:right;font-family:monospace;flex-shrink:0;}
.p3d-check{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:10px;color:#ccc;}
.p3d-check input{accent-color:#f66744;width:14px;height:14px;cursor:pointer;}
.p3d-bg-container{position:absolute;inset:0;overflow:hidden;z-index:0;pointer-events:none;}
.p3d-bg-container img{position:absolute;top:50%;left:50%;transform-origin:center center;image-rendering:auto;pointer-events:none;}
.p3d-viewport canvas{position:relative;z-index:1;}
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
        injectStyles();
        this._buildUI();
        document.body.appendChild(this.el.overlay);
        installFocusTrap(this.el.overlay);
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
        const ov = document.createElement("div"); ov.className = "p3d-overlay"; this.el.overlay = ov;
        const tb = document.createElement("div"); tb.className = "p3d-titlebar";
        const title = document.createElement("div"); title.className = "p3d-title";
        title.innerHTML = `<img src="/pixaroma/assets/pixaroma_logo.svg" style="width:20px;height:20px;vertical-align:middle;margin-right:6px;">3D Builder <span style="color:#f66744">Pixaroma</span>`;
        tb.appendChild(title); ov.appendChild(tb);

        const body = document.createElement("div"); body.className = "p3d-body";
        body.appendChild(this._buildLeft());
        const vp = document.createElement("div"); vp.className = "p3d-viewport"; this.el.viewport = vp;
        // Background image container (behind canvas)
        const bgCont = document.createElement("div"); bgCont.className = "p3d-bg-container"; this.el.bgContainer = bgCont; vp.appendChild(bgCont);
        // (Save/Close/Help buttons are added to the right sidebar in _buildRight)
        // Tool info
        const ti = document.createElement("div"); ti.className = "p3d-tool-info";
        ti.textContent = "Move (M) \u2014 Drag arrows to move object"; this.el.toolInfo = ti; vp.appendChild(ti);
        vp.appendChild(this._buildHelp());
        body.appendChild(vp);
        body.appendChild(this._buildRight());
        ov.appendChild(body);
    }

    _buildLeft() {
        const left = document.createElement("div"); left.className = "p3d-left";

        // Canvas Settings
        const cs = this._section("Canvas Settings");
        const ratioSel = document.createElement("select"); ratioSel.className = "p3d-input"; ratioSel.style.marginBottom = "5px";
        // Ratios: label only, value stores the aspect ratio (w:h)
        this._ratios = [
            {v:"16:9",l:"Landscape 16:9",w:1280,h:720},
            {v:"9:16",l:"Portrait 9:16",w:720,h:1280},
            {v:"4:3",l:"Landscape 4:3",w:1024,h:768},
            {v:"3:4",l:"Portrait 3:4",w:768,h:1024},
            {v:"1:1",l:"Square 1:1",w:1024,h:1024},
            {v:"custom",l:"Custom (no lock)"},
        ];
        this._ratios.forEach(r => {
            const o = document.createElement("option"); o.value = r.v; o.textContent = r.l; ratioSel.appendChild(o);
        });
        this.el.ratioSel = ratioSel;
        cs.appendChild(this._row("Ratio", ratioSel));
        const wIn = this._numInput(this.docW); const hIn = this._numInput(this.docH);
        this.el.wIn = wIn; this.el.hIn = hIn;
        cs.appendChild(this._row("Width", wIn)); cs.appendChild(this._row("Height", hIn));

        this._activeRatio = this._ratios[4]; // default 1:1
        ratioSel.value = "1:1";

        ratioSel.addEventListener("change", () => {
            const r = this._ratios.find(x => x.v === ratioSel.value);
            if (!r || r.v === "custom") { this._ratioLocked = false; this._activeRatio = null; return; }
            this._ratioLocked = true;
            this._activeRatio = r;
            this.docW = r.w; this.docH = r.h;
            wIn.value = r.w; hIn.value = r.h;
            this._updateFrame();
        });
        wIn.addEventListener("change", () => {
            this.docW = Math.max(64, parseInt(wIn.value) || 1280); wIn.value = this.docW;
            if (this._ratioLocked && this._activeRatio) {
                const [rw, rh] = this._activeRatio.v.split(":").map(Number);
                this.docH = Math.round(this.docW * rh / rw); hIn.value = this.docH;
            }
            this._updateFrame();
        });
        hIn.addEventListener("change", () => {
            this.docH = Math.max(64, parseInt(hIn.value) || 720); hIn.value = this.docH;
            if (this._ratioLocked && this._activeRatio) {
                const [rw, rh] = this._activeRatio.v.split(":").map(Number);
                this.docW = Math.round(this.docH * rw / rh); wIn.value = this.docW;
            }
            this._updateFrame();
        });

        const bgIn = document.createElement("input"); bgIn.type = "color"; bgIn.value = this.bgColor;
        bgIn.style.cssText = "width:50px;height:22px;cursor:pointer;border:1px solid #3a3d40;border-radius:4px;background:#111;";
        bgIn.addEventListener("input", () => { this.bgColor = bgIn.value; if (this.scene && !this.el.bgImgEl) this.scene.background = new THREE.Color(bgIn.value); });
        this.el.bgColor = bgIn; cs.appendChild(this._row("BG", bgIn));

        // Background Image (inside Canvas Settings)
        const bgTitle = document.createElement("div"); bgTitle.style.cssText = "font-size:9px;color:#888;margin-top:6px;margin-bottom:3px;"; bgTitle.textContent = "Background Image"; cs.appendChild(bgTitle);
        const bgBtnRow = document.createElement("div"); bgBtnRow.style.cssText = "display:flex;gap:5px;margin-bottom:6px;";
        const loadBgBtn = this._mkBtn("Load", () => this._loadBgImage(), "p3d-btn", "Load a background image");
        const removeBgBtn = this._mkBtn("Remove", () => this._removeBgImage(), "p3d-btn p3d-btn-danger", "Remove background image");
        loadBgBtn.style.flex = "1"; removeBgBtn.style.flex = "1";
        bgBtnRow.append(loadBgBtn, removeBgBtn); cs.appendChild(bgBtnRow);
        const fitRow = document.createElement("div"); fitRow.style.cssText = "display:flex;gap:5px;margin-bottom:6px;";
        const fitWBtn = this._mkBtn("Fit Width", () => this._fitBg("width"), "p3d-btn", "Fit to canvas width (keep ratio)");
        const fitHBtn = this._mkBtn("Fit Height", () => this._fitBg("height"), "p3d-btn", "Fit to canvas height (keep ratio)");
        const fitFillBtn = this._mkBtn("Fill", () => this._fitBg("fill"), "p3d-btn", "Fill canvas (cover, keep ratio)");
        fitWBtn.style.flex = "1"; fitHBtn.style.flex = "1"; fitFillBtn.style.flex = "1";
        fitRow.append(fitWBtn, fitHBtn, fitFillBtn); cs.appendChild(fitRow);
        const bgXR = this._sliderRow("X", -100, 100, 0, v => { this._bgImg.x = v; this._updateBgCSS(); });
        const bgYR = this._sliderRow("Y", -100, 100, 0, v => { this._bgImg.y = v; this._updateBgCSS(); });
        const bgScR = this._sliderRow("Scale", 1, 300, 100, v => { this._bgImg.scale = v; this._updateBgCSS(); });
        const bgRotR = this._sliderRow("Rotate", -180, 180, 0, v => { this._bgImg.rotation = v; this._updateBgCSS(); });
        const bgOpR = this._sliderRow("Opacity", 0, 100, 100, v => { this._bgImg.opacity = v; this._updateBgCSS(); });
        this.el.bgX = bgXR.slider; this.el.bgXV = bgXR.val;
        this.el.bgY = bgYR.slider; this.el.bgYV = bgYR.val;
        this.el.bgSc = bgScR.slider; this.el.bgScV = bgScR.val;
        this.el.bgRot = bgRotR.slider; this.el.bgRotV = bgRotR.val;
        this.el.bgOp = bgOpR.slider; this.el.bgOpV = bgOpR.val;
        cs.append(bgXR.row, bgYR.row, bgScR.row, bgRotR.row, bgOpR.row);
        left.appendChild(cs);

        // 3D Objects — select shape, configure, then add
        const obs = this._section("3D Objects");
        const og = document.createElement("div"); og.className = "p3d-grid3";
        const shapes = [{id:"cube",icon:"\u25a3",l:"Cube"},{id:"sphere",icon:"\u25cf",l:"Sphere"},{id:"cylinder",icon:"\u25ae",l:"Cylinder"},
         {id:"cone",icon:"\u25b2",l:"Cone"},{id:"torus",icon:"\u25ef",l:"Torus"},{id:"plane",icon:"\u25ad",l:"Plane"}];
        this._selectedShape = "cube";
        shapes.forEach(sh => {
            const b = document.createElement("div"); b.className = "p3d-obj-btn" + (sh.id === "cube" ? " selected" : ""); b.title = "Select " + sh.l;
            b.innerHTML = `<span class="icon">${sh.icon}</span>${sh.l}`;
            b.addEventListener("click", () => { this._selectedShape = sh.id; og.querySelectorAll(".p3d-obj-btn").forEach(x=>x.classList.remove("selected")); b.classList.add("selected"); this._updateShapeParams(); });
            og.appendChild(b);
        });
        obs.appendChild(og);

        // Shape parameters panel
        const paramBox = document.createElement("div"); paramBox.className = "p3d-shape-params";
        this.el.shapeParams = paramBox;
        obs.appendChild(paramBox);

        // Add to Scene button
        const addBtn = this._mkBtn("+ Add to Scene", () => this._addObjectWithParams(), "p3d-btn p3d-btn-accent", "Add the selected shape with current parameters");
        addBtn.style.cssText = "width:100%;margin-top:8px;";
        obs.appendChild(addBtn);
        left.appendChild(obs);

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
        const tt = this._section("Transform Tools");
        const tg = document.createElement("div"); tg.className = "p3d-grid3";
        this._toolDefs = [
            {id:"move",icon:"✥",l:"Move",key:"M",tip:"Move (M) \u2014 Drag colored arrows to translate along X/Y/Z"},
            {id:"rotate",icon:"\u21bb",l:"Rotate",key:"R",tip:"Rotate (R) \u2014 Drag colored rings to rotate around X/Y/Z"},
            {id:"scale",icon:"\u2922",l:"Scale",key:"S",tip:"Scale (S) \u2014 Drag colored boxes to resize along X/Y/Z"},
        ];
        this._toolDefs.forEach(t => {
            const b = document.createElement("div"); b.className = "p3d-tool-btn" + (this.toolMode === t.id ? " active" : "");
            b.title = t.tip; b.innerHTML = `<span class="icon">${t.icon}</span>${t.l}`;
            b.addEventListener("click", () => this._setToolMode(t.id));
            this.el[`tool_${t.id}`] = b; tg.appendChild(b);
        });
        tt.appendChild(tg); left.appendChild(tt);

        // Camera
        const cam = this._section("Camera");
        const cRow1 = document.createElement("div"); cRow1.className = "p3d-grid4";
        [{id:"front",l:"Front",tip:"Front view (F / 1)"},{id:"side",l:"Side",tip:"Right side view (2)"},
         {id:"back",l:"Back",tip:"Back view (B / 3)"},{id:"top",l:"Top",tip:"Top view (T / 4)"}].forEach(t => {
            const b = document.createElement("div"); b.className = "p3d-tool-btn"; b.title = t.tip;
            b.innerHTML = `<span class="icon">${t.l[0]}</span>${t.l}`;
            b.addEventListener("click", () => this._camView(t.id)); cRow1.appendChild(b);
        });
        cam.appendChild(cRow1);
        const cRow2 = document.createElement("div"); cRow2.style.cssText = "display:flex;gap:5px;margin-top:5px;";
        // Perspective / Isometric switch
        const perspBtn = this._mkBtn("Perspective", () => this._setPerspective(true), "p3d-btn active", "Standard perspective camera");
        const isoBtn = this._mkBtn("Isometric", () => this._setPerspective(false), "p3d-btn", "Orthographic/isometric camera");
        this.el.perspBtn = perspBtn; this.el.isoBtn = isoBtn;
        perspBtn.style.flex = "1"; isoBtn.style.flex = "1";
        cRow2.append(perspBtn, isoBtn);
        cam.appendChild(cRow2);
        const focusBtn = this._mkBtn("\ud83d\udd0d Focus Selected (0)", () => this._camView("focus"), "p3d-btn", "Center camera on selected object (0 key)");
        focusBtn.style.cssText = "width:100%;margin-top:5px;margin-bottom:8px;"; cam.appendChild(focusBtn);
        // FOV
        const fovR = this._sliderRow("FOV", 15, 120, this._fov, v => {
            this._fov = v;
            if (this.camera && this.camera.fov !== undefined) { this.camera.fov = v; this.camera.updateProjectionMatrix(); }
        });
        this.el.fovSlider = fovR.slider; this.el.fovVal = fovR.val;
        cam.appendChild(fovR.row);
        // Shadows toggle
        const shCheck = document.createElement("label"); shCheck.className = "p3d-check"; shCheck.title = "Toggle ground shadows";
        const shInp = document.createElement("input"); shInp.type = "checkbox"; shInp.checked = this._shadows;
        shInp.addEventListener("change", () => { this._shadows = shInp.checked; if (this._groundMesh) this._groundMesh.visible = shInp.checked; });
        this.el.shadowCheck = shInp;
        shCheck.append(shInp, document.createTextNode("Ground Shadows"));
        shCheck.style.marginTop = "8px";
        cam.appendChild(shCheck);
        // Grid toggle
        const gridCheck = document.createElement("label"); gridCheck.className = "p3d-check"; gridCheck.title = "Show/hide grid";
        const gridInp = document.createElement("input"); gridInp.type = "checkbox"; gridInp.checked = this._showGrid;
        gridInp.addEventListener("change", () => { this._showGrid = gridInp.checked; if (this.gridHelper) this.gridHelper.visible = gridInp.checked; });
        this.el.gridCheck = gridInp;
        gridCheck.append(gridInp, document.createTextNode("Show Grid"));
        gridCheck.style.marginTop = "6px"; cam.appendChild(gridCheck);
        // Gizmo toggle
        const gizCheck = document.createElement("label"); gizCheck.className = "p3d-check"; gizCheck.title = "Show/hide transform gizmo";
        const gizInp = document.createElement("input"); gizInp.type = "checkbox"; gizInp.checked = this._showGizmo;
        gizInp.addEventListener("change", () => { this._showGizmo = gizInp.checked; if (this._gizmoHelper) this._gizmoHelper.visible = gizInp.checked; });
        this.el.gizmoCheck = gizInp;
        gizCheck.append(gizInp, document.createTextNode("Show Gizmo"));
        gizCheck.style.marginTop = "6px"; cam.appendChild(gizCheck);
        left.appendChild(cam);

        // Status
        const status = document.createElement("div");
        status.style.cssText = "padding:8px 12px;font-size:9px;color:#555;border-top:1px solid #2a2c2e;margin-top:auto;flex-shrink:0;font-family:monospace;";
        this.el.status = status; left.appendChild(status);
        return left;
    }

    _buildRight() {
        const right = document.createElement("div"); right.className = "p3d-right";

        // 1) Layers (first)
        const layers = this._section("Layers");
        const ll = document.createElement("div"); ll.style.cssText = "max-height:200px;overflow-y:auto;";
        this.el.layerList = ll; layers.appendChild(ll);
        const lb = document.createElement("div"); lb.style.cssText = "display:flex;gap:4px;margin-top:6px;";
        lb.append(
            this._mkBtn("+ Add", () => this._addObject("cube"), "p3d-btn", "Add cube"),
            this._mkBtn("\u2398 Dup", () => this._dupSelected(), "p3d-btn", "Duplicate (Ctrl+D)"),
            this._mkBtn("\ud83d\uddd1 Del", () => this._deleteSelected(), "p3d-btn p3d-btn-danger", "Delete (Del)")
        );
        layers.appendChild(lb); right.appendChild(layers);

        // 2) Object Color + HSL
        const colSec = this._section("Object Color");
        const colorIn = document.createElement("input"); colorIn.type = "color"; colorIn.value = "#c4a882";
        colorIn.style.cssText = "width:100%;height:28px;cursor:pointer;border:1px solid #3a3d40;border-radius:4px;background:#111;";
        colorIn.addEventListener("input", () => this._setObjColor(colorIn.value));
        this.el.objColor = colorIn; colSec.appendChild(colorIn);
        // HSL sliders
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
        colSec.appendChild(hslWrap);
        // Name
        const nameIn = document.createElement("input"); nameIn.className = "p3d-input"; nameIn.placeholder = "name";
        nameIn.addEventListener("change", () => { if (this.activeObj) { this.activeObj.userData.name = nameIn.value; this._updateLayers(); } });
        this.el.objName = nameIn;
        colSec.appendChild(this._row("Name", nameIn));
        const delBtn = this._mkBtn("Delete Object", () => this._deleteSelected(), "p3d-btn p3d-btn-danger", "Delete selected");
        delBtn.style.width = "100%"; colSec.appendChild(delBtn);
        right.appendChild(colSec);

        // 3) Materials
        const mats = this._section("Materials");
        const mg = document.createElement("div"); mg.className = "p3d-mat-grid";
        [{id:"clay",l:"Clay",c:"#c4a882",r:0.85,m:0},{id:"matte",l:"Matte",c:"#888",r:0.95,m:0},
         {id:"glossy",l:"Glossy",c:"#6688cc",r:0.08,m:0.15},{id:"metal",l:"Metal",c:"#b0b0cc",r:0.12,m:1}].forEach(p => {
            const b = document.createElement("div"); b.className = "p3d-mat-btn"; b.title = p.l + " material";
            const pv = document.createElement("div"); pv.className = "p3d-mat-preview";
            pv.style.background = `radial-gradient(circle at 35% 35%, ${p.c}, #1a1a1a)`;
            b.append(pv, document.createTextNode(p.l));
            b.addEventListener("click", () => this._applyMat(p)); mg.appendChild(b);
        });
        mats.appendChild(mg);
        const rR = this._sliderRow("Rough", 0, 100, 85, v => { for (const o of this.selectedObjs) o.material.roughness = v/100; if(this.el.glossS){const g=100-v;this.el.glossS.value=g;this.el.glossV.textContent=g;} });
        const gR = this._sliderRow("Gloss", 0, 100, 15, v => { for (const o of this.selectedObjs) o.material.roughness = 1-v/100; if(this.el.roughS){const r=100-v;this.el.roughS.value=r;this.el.roughV.textContent=r;} });
        const oR = this._sliderRow("Opacity", 0, 100, 100, v => { for (const o of this.selectedObjs) { o.material.opacity=v/100; o.material.transparent=v<100; } });
        this.el.roughS=rR.slider;this.el.roughV=rR.val;
        this.el.glossS=gR.slider;this.el.glossV=gR.val;
        this.el.opacS=oR.slider;this.el.opacV=oR.val;
        mats.append(rR.row, gR.row, oR.row); right.appendChild(mats);

        // 4) Lighting
        const lp = this._section("Lighting");
        const lcIn = document.createElement("input"); lcIn.type = "color"; lcIn.value = "#ffffff";
        lcIn.style.cssText = "width:50px;height:22px;cursor:pointer;border:1px solid #3a3d40;border-radius:4px;background:#111;";
        lcIn.addEventListener("input", () => { if (this.light) this.light.color.set(lcIn.value); });
        this.el.lightColor = lcIn; lp.appendChild(this._row("Color", lcIn));
        const iR = this._sliderRow("Intensity", 0, 200, 85, v => { if (this.light) this.light.intensity = v/100*2; });
        const sR = this._sliderRow("Ambient", 0, 100, 60, v => { if (this.ambientLight) this.ambientLight.intensity = v/100; });
        lp.append(iR.row, sR.row);
        // Light direction: two sliders (horizontal angle + height)
        const dirLabel = document.createElement("div"); dirLabel.style.cssText = "font-size:9px;color:#888;margin-top:4px;margin-bottom:3px;";
        dirLabel.textContent = "Light Direction"; lp.appendChild(dirLabel);
        const angR = this._sliderRow("Angle", 0, 360, 45, v => { this._lightDir.theta = v * Math.PI / 180; this._applyLightDir(); });
        const hgtR = this._sliderRow("Height", 5, 90, 55, v => { this._lightDir.phi = (90 - v) * Math.PI / 180; this._applyLightDir(); });
        this.el.lightAngle = angR.slider; this.el.lightAngleVal = angR.val;
        this.el.lightHeight = hgtR.slider; this.el.lightHeightVal = hgtR.val;
        lp.append(angR.row, hgtR.row);
        const resetLightBtn = this._mkBtn("Reset Light", () => {
            this._lightDir = { theta: 0.8, phi: 1.0 };
            this._applyLightDir();
            if (this.el.lightAngle) { this.el.lightAngle.value = 45; this.el.lightAngleVal.textContent = 45; }
            if (this.el.lightHeight) { this.el.lightHeight.value = 55; this.el.lightHeightVal.textContent = 55; }
            if (this.light) { this.light.color.set("#ffffff"); this.light.intensity = 1.7; }
            if (this.el.lightColor) this.el.lightColor.value = "#ffffff";
            if (this.ambientLight) this.ambientLight.intensity = 0.6;
        }, "p3d-btn", "Reset lighting to defaults");
        resetLightBtn.style.cssText = "width:100%;margin-top:5px;";
        lp.appendChild(resetLightBtn);
        right.appendChild(lp);

        // Action buttons (bottom of right sidebar)
        const actSec = document.createElement("div");
        actSec.style.cssText = "padding:10px 12px;margin-top:auto;border-top:1px solid #2a2c2e;display:flex;flex-direction:column;gap:6px;flex-shrink:0;";
        const helpB = this._mkBtn("? Help", () => this._toggleHelp(), "p3d-btn", "Keyboard shortcuts & tips");
        helpB.style.cssText = "width:100%;padding:7px 0;font-size:13px;border-radius:5px;";
        const btnRow = document.createElement("div"); btnRow.style.cssText = "display:flex;gap:6px;";
        const saveB = this._mkBtn("Save", () => this._save(), "p3d-btn-accent", "Render & save");
        saveB.style.cssText = "flex:1;padding:7px 0;font-size:13px;border-radius:5px;";
        const closeB = this._mkBtn("Close", () => this._close(), "p3d-btn", "Close without saving");
        closeB.style.cssText = "flex:1;padding:7px 0;font-size:13px;border-radius:5px;";
        btnRow.append(saveB, closeB);
        actSec.append(helpB, btnRow);
        right.appendChild(actSec);

        return right;
    }

    _buildHelp() {
        const h = document.createElement("div"); h.className = "p3d-help";
        h.innerHTML = `
<div style="color:#f66744;font-weight:bold;margin-bottom:10px;font-size:13px;padding-right:60px;">3D Pixaroma \u2014 Shortcuts & Tips</div>
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
        const cb = this._mkBtn("\u2715 Close", () => { h.style.display = "none"; }, "p3d-btn");
        cb.style.cssText = "position:absolute;top:8px;right:8px;"; h.appendChild(cb);
        this.el.helpOverlay = h; return h;
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

        // Canvas frame + gray masks
        this._createFrame();

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

    _createFrame() {
        const vp = this.el.viewport;
        // Gray-out masks (top, bottom, left, right)
        this._masks = [];
        for (let i = 0; i < 4; i++) {
            const m = document.createElement("div"); m.className = "p3d-frame-mask";
            m.style.background = "rgba(0,0,0,0.4)";
            vp.appendChild(m); this._masks.push(m);
        }
        // Orange border
        const f = document.createElement("div"); f.className = "p3d-frame";
        vp.appendChild(f); this._frame = f;
        this._updateFrame();
    }

    _updateFrame() {
        const vp = this.el.viewport, vpW = vp.clientWidth, vpH = vp.clientHeight;
        if (!vpW || !this._frame) return;
        const s = Math.min(vpW/this.docW, vpH/this.docH, 1);
        const fw = this.docW*s, fh = this.docH*s;
        const fl = (vpW-fw)/2, ft = (vpH-fh)/2;
        Object.assign(this._frame.style, {left:fl+"px",top:ft+"px",width:fw+"px",height:fh+"px"});
        this._frame.innerHTML = `<div class="p3d-frame-label">${this.docW}\u00d7${this.docH}</div>`;
        // Masks
        if (this._masks) {
            const [mT,mB,mL,mR] = this._masks;
            Object.assign(mT.style, {left:"0",top:"0",width:vpW+"px",height:ft+"px"});
            Object.assign(mB.style, {left:"0",top:(ft+fh)+"px",width:vpW+"px",height:(vpH-ft-fh)+"px"});
            Object.assign(mL.style, {left:"0",top:ft+"px",width:fl+"px",height:fh+"px"});
            Object.assign(mR.style, {left:(fl+fw)+"px",top:ft+"px",width:(vpW-fl-fw)+"px",height:fh+"px"});
        }
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
        if(this.el.roughS){const v=Math.round(o.material.roughness*100);this.el.roughS.value=v;this.el.roughV.textContent=v;}
        if(this.el.glossS){const v=Math.round((1-o.material.roughness)*100);this.el.glossS.value=v;this.el.glossV.textContent=v;}
        if(this.el.opacS){const v=Math.round(o.material.opacity*100);this.el.opacS.value=v;this.el.opacV.textContent=v;}
        this._syncHSLFromColor();
    }

    _updateLayers() {
        const list = this.el.layerList; if (!list) return;
        list.innerHTML = "";
        this.objects.forEach((obj, i) => {
            const isActive = obj===this.activeObj, isMulti = this.selectedObjs.has(obj)&&!isActive;
            const item = document.createElement("div");
            item.className = "p3d-layer-item"+(isActive?" active":"")+(isMulti?" multi":"");
            item.draggable = true;

            const vis = document.createElement("div"); vis.className = "p3d-layer-vis"; vis.title = "Visibility";
            vis.textContent = obj.visible?"\ud83d\udc41":"\u25cc";
            vis.addEventListener("click", e=>{e.stopPropagation();obj.visible=!obj.visible;vis.textContent=obj.visible?"\ud83d\udc41":"\u25cc";});

            const dot = document.createElement("div"); dot.className = "p3d-layer-color";
            dot.style.background = obj.userData.colorHex||"#888";

            const name = document.createElement("div"); name.className = "p3d-layer-name";
            name.textContent = obj.userData.name||"Object";
            name.addEventListener("dblclick", e=>{
                e.stopPropagation();
                const inp=document.createElement("input");inp.className="p3d-name-input";inp.value=obj.userData.name;
                name.replaceWith(inp);inp.focus();inp.select();
                const fin=()=>{obj.userData.name=inp.value.trim()||obj.userData.name;inp.replaceWith(name);name.textContent=obj.userData.name;this._syncProps();};
                inp.addEventListener("blur",fin);
                inp.addEventListener("keydown",ev=>{if(ev.key==="Enter"||ev.key==="Escape"){ev.preventDefault();fin();}});
            });

            const lock = document.createElement("div"); lock.className = "p3d-layer-lock";
            lock.title = obj.userData.locked?"Unlock":"Lock";
            lock.textContent = obj.userData.locked?"\ud83d\udd12":"\ud83d\udd13";
            lock.addEventListener("click", e=>{
                e.stopPropagation(); obj.userData.locked=!obj.userData.locked;
                lock.textContent=obj.userData.locked?"\ud83d\udd12":"\ud83d\udd13";
                lock.title=obj.userData.locked?"Unlock":"Lock";
                if(obj.userData.locked&&obj===this.activeObj)this.transformCtrl.detach();
            });

            item.append(vis, dot, name, lock);
            item.addEventListener("click", e=>{if(e.detail>1)return;this._select(obj,e.shiftKey||e.ctrlKey);});

            // Drag reorder
            item.addEventListener("dragstart", e=>{this._dragIdx=i;e.dataTransfer.effectAllowed="move";setTimeout(()=>item.classList.add("dragging"),0);});
            item.addEventListener("dragend",()=>{item.classList.remove("dragging");});
            item.addEventListener("dragover",e=>{
                e.preventDefault();e.dataTransfer.dropEffect="move";
                list.querySelectorAll(".p3d-layer-item").forEach(it=>{it.classList.remove("drag-over-top","drag-over-bottom");});
                const mid=item.getBoundingClientRect().top+item.getBoundingClientRect().height/2;
                item.classList.add(e.clientY<mid?"drag-over-top":"drag-over-bottom");
            });
            item.addEventListener("dragleave",()=>{item.classList.remove("drag-over-top","drag-over-bottom");});
            item.addEventListener("drop",e=>{
                e.preventDefault();item.classList.remove("drag-over-top","drag-over-bottom");
                const from=this._dragIdx;if(from===undefined||from===i)return;
                const mid=item.getBoundingClientRect().top+item.getBoundingClientRect().height/2;
                const before=e.clientY<mid;
                const dragged=this.objects.splice(from,1)[0];
                let target=before?i:i+1; if(from<i)target--;
                this.objects.splice(target,0,dragged);
                this._dragIdx=undefined; this._updateLayers();
            });

            list.appendChild(item);
        });
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
        if (!jsonStr||jsonStr==="{}"){this._addObject("cube");this._undoStack=[];this._redoStack=[];return;}
        this._isRestoring = true;
        try {
            const d=JSON.parse(jsonStr);
            if(d.doc_w){this.docW=d.doc_w;if(this.el.wIn)this.el.wIn.value=d.doc_w;}
            if(d.doc_h){this.docH=d.doc_h;if(this.el.hIn)this.el.hIn.value=d.doc_h;}
            // Sync ratio dropdown to match saved dimensions
            if (this.el.ratioSel && this._ratios) {
                const ratio = this.docW / this.docH;
                const match = this._ratios.find(r => r.v !== "custom" && Math.abs(r.w / r.h - ratio) < 0.01);
                if (match) { this.el.ratioSel.value = match.v; this._activeRatio = match; this._ratioLocked = true; }
                else { this.el.ratioSel.value = "custom"; this._activeRatio = null; this._ratioLocked = false; }
            }
            if(d.bgColor){this.bgColor=d.bgColor;if(this.el.bgColor)this.el.bgColor.value=d.bgColor;this.scene.background=new THREE.Color(d.bgColor);}
            if(d.fov!==undefined){this._fov=d.fov;if(this.el.fovSlider)this.el.fovSlider.value=d.fov;if(this.el.fovVal)this.el.fovVal.textContent=d.fov;if(this.camera.fov!==undefined){this.camera.fov=d.fov;this.camera.updateProjectionMatrix();}}
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
        this._setStatus("Saving...");
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
            if(this._frame)this._frame.style.display="none";
            if(this._masks)this._masks.forEach(m=>m.style.display="none");
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
            if(this._frame)this._frame.style.display="";
            if(this._masks)this._masks.forEach(m=>m.style.display="");
            if(this.activeObj)this.activeObj.material.emissive?.setHex(0x3a1f00);
            this.renderer.setPixelRatio(pr);
            this._onResize();

            const res=await ThreeDAPI.saveRender(this.projectId,dataURL);
            if(res.status==="success"){
                const sd=this._serializeScene();sd.composite_path=res.composite_path;
                if(this.onSave)this.onSave(JSON.stringify(sd),dataURL);
                this._setStatus("Saved!"); setTimeout(()=>this._close(),400);
            } else this._setStatus("Save failed");
        } catch(e){console.error("[P3D]",e);this._setStatus("Save error");}
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
        if(this.el.overlay?.parentNode)this.el.overlay.parentNode.removeChild(this.el.overlay);
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
            if (autoFit) this._fitBg("fill");
            else this._updateBgCSS();
        };
        img.onerror = () => { this._setStatus("Failed to load bg image"); };
        this.el.bgImgEl = img;
        cont.appendChild(img);
        // Make canvas transparent so bg shows through
        if (this.scene) this.scene.background = null;
        if (this.renderer) this.renderer.setClearColor(0x000000, 0);
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
        img.style.transform = `translate(-50%,-50%) rotate(${this._bgImg.rotation}deg)`;
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
        if (this.el.bgX) { this.el.bgX.value = this._bgImg.x; this.el.bgXV.textContent = this._bgImg.x; }
        if (this.el.bgY) { this.el.bgY.value = this._bgImg.y; this.el.bgYV.textContent = this._bgImg.y; }
        if (this.el.bgSc) { this.el.bgSc.value = this._bgImg.scale; this.el.bgScV.textContent = this._bgImg.scale; }
        if (this.el.bgRot) { this.el.bgRot.value = this._bgImg.rotation; this.el.bgRotV.textContent = this._bgImg.rotation; }
        if (this.el.bgOp) { this.el.bgOp.value = this._bgImg.opacity; this.el.bgOpV.textContent = this._bgImg.opacity; }
    }

    _removeBgImage() {
        const cont = this.el.bgContainer; if (cont) cont.innerHTML = "";
        this.el.bgImgEl = null;
        this._bgImg = { path: null, x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, _natW: 0, _natH: 0 };
        // Restore scene background
        if (this.scene) this.scene.background = new THREE.Color(this.bgColor);
        this._syncBgSliders();
        this._setStatus("Background removed");
    }

    // ─── Helpers ──────────────────────────────────────────────
    _section(t){const s=document.createElement("div");s.className="p3d-section";const h=document.createElement("div");h.className="p3d-section-title";h.textContent=t;s.appendChild(h);return s;}
    _row(l,el){const r=document.createElement("div");r.className="p3d-row";const lb=document.createElement("div");lb.className="p3d-label";lb.textContent=l;r.appendChild(lb);if(el)r.appendChild(el);return r;}
    _numInput(v){const i=document.createElement("input");i.type="number";i.className="p3d-input";i.value=v;return i;}
    _sliderRow(label,min,max,val,onChange){const row=document.createElement("div");row.className="p3d-row";const lbl=document.createElement("div");lbl.className="p3d-label";lbl.textContent=label;const slider=document.createElement("input");slider.type="range";slider.className="p3d-range";slider.min=min;slider.max=max;slider.value=val;const valEl=document.createElement("div");valEl.className="p3d-range-val";valEl.textContent=val;slider.addEventListener("input",()=>{valEl.textContent=slider.value;onChange(+slider.value);});row.append(lbl,slider,valEl);return{row,slider,val:valEl};}
    _mkBtn(text,onClick,cls="p3d-btn",tip=""){const b=document.createElement("button");b.className=cls;b.textContent=text;if(tip)b.title=tip;b.addEventListener("click",onClick);return b;}
    _setStatus(msg){if(this.el.status)this.el.status.textContent=msg;}
    _toggleHelp(){if(!this.el.helpOverlay)return;const v=this.el.helpOverlay.style.display;this.el.helpOverlay.style.display=(v==="none"||!v)?"block":"none";}
}
