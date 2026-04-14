// ============================================================
// Pixaroma 3D Editor — Core class, constructor, UI building
// ============================================================
import { ThreeDAPI } from "./api.mjs";
import { SHAPES, SHAPE_GRID, loadTeapotGeometry } from "./shapes.mjs";
import {
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
} from "../framework/index.mjs";

// Shared Three.js module references — populated by loadThree()
export let THREE = null,
  OrbitControls = null,
  TransformControls = null,
  EffectComposer = null,
  RenderPass = null,
  OutlinePass = null,
  OutputPass = null;
const ESM = "https://esm.sh/three@0.170.0";
export async function loadThree() {
  if (THREE) return;
  // Parallel module loads — serial awaits added round-trip latency
  // that showed as a gray flash when the editor first opened.
  const [threeMod, orbitMod, transformMod, composerMod, renderMod, outlineMod, outputMod] =
    await Promise.all([
      import(ESM),
      import(ESM + "/examples/jsm/controls/OrbitControls.js"),
      import(ESM + "/examples/jsm/controls/TransformControls.js"),
      import(ESM + "/examples/jsm/postprocessing/EffectComposer.js"),
      import(ESM + "/examples/jsm/postprocessing/RenderPass.js"),
      import(ESM + "/examples/jsm/postprocessing/OutlinePass.js"),
      import(ESM + "/examples/jsm/postprocessing/OutputPass.js"),
    ]);
  THREE = threeMod;
  OrbitControls = orbitMod.OrbitControls;
  TransformControls = transformMod.TransformControls;
  EffectComposer = composerMod.EffectComposer;
  RenderPass = renderMod.RenderPass;
  OutlinePass = outlineMod.OutlinePass;
  OutputPass = outputMod.OutputPass;
}
// Allow other modules to access the lazy-loaded THREE refs
export function getTHREE() {
  return THREE;
}
export function getOrbitControls() {
  return OrbitControls;
}
export function getTransformControls() {
  return TransformControls;
}
export function getPostprocessing() {
  return { EffectComposer, RenderPass, OutlinePass, OutputPass };
}

// Editor-specific CSS for 3D viewport elements not covered by framework
const STYLE_ID = "pixaroma-3d-extra-v1";
function injectExtraStyles() {
  if (document.getElementById(STYLE_ID)) return;
  // Remove ALL old 3D-specific style sheets
  for (const old of [
    "pixaroma-3d-styles",
    "pixaroma-3d-styles-v3",
    "pixaroma-3d-v4",
    "pixaroma-3d-v5",
    "pixaroma-3d-v6",
  ])
    document.getElementById(old)?.remove();
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
/* 3D-specific: viewport, frame, masks, background, materials, shape buttons, layers (kept for _updateLayers) */
.p3d-viewport canvas, .pxf-workspace canvas{display:block;position:relative;z-index:1;}
.p3d-bg-container{position:absolute;inset:0;overflow:hidden;z-index:0;pointer-events:none;}
.p3d-bg-container img{position:absolute;top:50%;left:50%;transform-origin:center center;image-rendering:auto;pointer-events:none;}
/* p3d-frame, p3d-frame-label, p3d-frame-mask — removed, now using shared createCanvasFrame */
/* p3d-tool-info — removed, now using shared pxf-tool-info from framework */
.p3d-shape-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;height:54px;cursor:pointer;border:1px solid #3a3d40;background:#242628;color:#ccc;border-radius:5px;font-size:10px;gap:3px;transition:all .12s;padding:4px;}
.p3d-shape-btn:hover{background:#2a2c2e;border-color:#f66744;transform:scale(1.05);}
.p3d-shape-btn .p3d-shape-ico{width:22px;height:22px;background-color:#ccc;-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;transition:background-color .12s;}
.p3d-shape-btn:hover .p3d-shape-ico{background-color:#f66744;}
.p3d-shape-btn.p3d-shape-todo{opacity:0.45;}
.p3d-shape-btn.p3d-shape-todo:hover{opacity:0.7;}
.p3d-range:disabled,.p3d-input:disabled{opacity:0.4;cursor:not-allowed;}
.p3d-row:has(> .p3d-range:disabled) .p3d-label{opacity:0.5;}
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

// Re-export framework utilities so mixin files can import from core
export {
  ThreeDAPI,
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
};

// ─── Editor ──────────────────────────────────────────────────
export class Pixaroma3DEditor {
  constructor() {
    this.onSave = null;
    this.onClose = null;
    this.docW = 1024;
    this.docH = 1024;
    this.bgColor = "#6e6e6e";
    this._defaultBgColor = this.bgColor;
    this.objects = [];
    this.selectedObjs = new Set();
    this.activeObj = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.orbitCtrl = null;
    this.transformCtrl = null;
    this.light = null;
    this.ambientLight = null;
    this.gridHelper = null;
    this.toolMode = "move";
    this.projectId = "p3d_" + Date.now();
    this.el = {};
    this._id = 0;
    this._lightDir = { theta: (81 * Math.PI) / 180, phi: (65 * Math.PI) / 180 };
    this._gizmoHelper = null;
    this._gizmoDragging = false;
    this._multiDragStart = null;
    this._ptr = null;
    this._shadowFitInterval = null;
    this._undoStack = [];
    this._redoStack = [];
    this.MAX_UNDO = 30;
    this._ratioLocked = true;
    this._fov = 50;
    this._shadows = true;
    this._isOrtho = false;
    this._groundMesh = null;
    this._showGrid = true;
    this._showGizmo = true;
    // bg image: x/y in % offset from center, scale in %, rotation in deg, opacity 0-100
    this._bgImg = {
      path: null,
      x: 0,
      y: 0,
      scale: 100,
      rotation: 0,
      opacity: 100,
      _natW: 0,
      _natH: 0,
    };
  }

  async open(jsonStr) {
    injectExtraStyles();
    this._buildUI();
    this._layout.mount();
    this._setStatus("Loading Three.js...");
    try {
      await loadThree();
    } catch (e) {
      this._setStatus("ERROR: load failed");
      return;
    }
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
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
    layout.onSaveToDisk = () => {
      this._diskSavePending = true;
      this._save();
    };
    layout.onCleanup = () => {
      if (this._shadowFitInterval) {
        clearInterval(this._shadowFitInterval);
        this._shadowFitInterval = null;
      }
      if (this._studioEnvTexture) {
        this._studioEnvTexture.dispose();
        this._studioEnvTexture = null;
      }
      if (this.scene) this.scene.environment = null;
      window.removeEventListener("keydown", this._onKey, { capture: true });
      if (this._resizeObs) this._resizeObs.disconnect();
      if (this._animId) {
        cancelAnimationFrame(this._animId);
        this._animId = null;
      }
      if (this.transformCtrl) {
        this.transformCtrl.detach();
        this.transformCtrl.dispose();
      }
      if (this.orbitCtrl) this.orbitCtrl.dispose();
      if (this.renderer) {
        this.renderer.dispose();
        this.renderer.forceContextLoss();
      }
      this.objects.forEach((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      this.scene = null;
      this.camera = null;
      this.renderer = null;
      this._closed = true;
    };
    this.el.overlay = layout.overlay;
    this.el.helpOverlay = layout.helpPanel;

    // Viewport: use framework workspace but add 3D-specific elements
    const vp = layout.workspace;
    // Seed the viewport with the final bgColor so we don't flash the
    // hardcoded default gray before Three.js sets scene.background.
    vp.style.background = this.bgColor;
    this.el.viewport = vp;

    // Background image container (behind canvas)
    const bgCont = document.createElement("div");
    bgCont.className = "p3d-bg-container";
    this.el.bgContainer = bgCont;
    vp.appendChild(bgCont);

    // Tool info (uses framework's floating tooltip)
    this.el.toolInfo = layout.statusText;
    layout.setStatus("Move (M) \u2014 Drag arrows to move object");

    // Populate sidebars
    this._buildLeft(layout.leftSidebar);
    this._buildRight(layout.rightSidebar, layout.sidebarFooter);

    // Enable drag & drop on workspace
    if (this._canvasToolbar)
      this._canvasToolbar.setupDropZone(layout.workspace);
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
    // Add BG color, Clear Scene, Reset to Default into Canvas Settings panel
    const csContent = this._canvasSettings.el.querySelector(".pxf-panel-content");
    if (csContent) {
      // BG color + Clear Scene + Reset to Default in one row
      const bgColorInput = document.createElement("input");
      bgColorInput.type = "color";
      bgColorInput.value = this.bgColor;
      bgColorInput.className = "pxf-color-input";
      bgColorInput.style.cssText = "width:36px;height:28px;flex-shrink:0;";
      bgColorInput.addEventListener("input", () => {
        this.bgColor = bgColorInput.value;
        if (this.el.viewport) this.el.viewport.style.backgroundColor = bgColorInput.value;
        if (this.scene && !this.el.bgImgEl)
          this.scene.background = new THREE.Color(bgColorInput.value);
      });

      const clearBtn = createButton("Clear Scene", {
        variant: "full",
        onClick: () => {
          this.objects.forEach((o) => {
            o.geometry?.dispose();
            o.material?.dispose();
            this.scene.remove(o);
          });
          this.objects = [];
          this.selectedObjs.clear();
          this.activeObj = null;
          this.transformCtrl?.detach();
          this._updateLayers();
          if (this._rebuildShapePanel) this._rebuildShapePanel();
          this._syncProps?.();
        },
      });
      clearBtn.classList.add("pxf-btn-danger");
      clearBtn.style.flex = "1";

      const resetBtn = createButton("Reset", {
        variant: "full",
        onClick: () => {
          this.objects.forEach((o) => {
            o.geometry?.dispose();
            o.material?.dispose();
            this.scene?.remove(o);
          });
          this.objects = [];
          this.selectedObjs.clear();
          this.activeObj = null;
          this.transformCtrl?.detach();
          this._removeBgImage();
          this.docW = 1024;
          this.docH = 1024;
          if (this._canvasSettings) this._canvasSettings.setSize(1024, 1024);
          if (this._canvasSettings) this._canvasSettings.setRatio(0);
          const dbg = this._defaultBgColor || "#6e6e6e";
          bgColorInput.value = dbg;
          this.bgColor = dbg;
          if (this.scene) this.scene.background = new THREE.Color(dbg);
          if (this.el.viewport) this.el.viewport.style.backgroundColor = dbg;
          this._updateFrame();
          this._updateLayers();
          if (this._rebuildShapePanel) this._rebuildShapePanel();
          this._syncProps?.();
          this._setStatus("Reset to default");
        },
      });
      resetBtn.classList.add("pxf-btn-danger");
      resetBtn.style.flex = "1";

      const actionRow = document.createElement("div");
      actionRow.style.cssText = "display:flex;gap:4px;align-items:center;margin-top:8px;";
      const bgLabel = document.createElement("span");
      bgLabel.style.cssText = "font-size:10px;color:#888;flex-shrink:0;";
      bgLabel.textContent = "BG:";
      actionRow.append(bgLabel, bgColorInput, clearBtn, resetBtn);
      csContent.appendChild(actionRow);

      const transpRow = document.createElement("label");
      transpRow.className = "pxf-check-row";
      transpRow.title = "Save to Disk with transparent background (no background color)";
      transpRow.style.cssText = "margin:4px 0 0 2px;font-size:11px;opacity:0.85;";
      const transpCb = document.createElement("input");
      transpCb.type = "checkbox";
      transpCb.addEventListener("change", () => { this._transparentBg = transpCb.checked; });
      transpRow.appendChild(transpCb);
      transpRow.append("Transparent BG (Save to Disk)");
      csContent.appendChild(transpRow);

      // Store ref so persistence can update the color input
      this._bgColorInput = bgColorInput;
      this.el.bgColor = bgColorInput;
    }
    left.appendChild(this._canvasSettings.el);

    // Background Image (collapsible, starts collapsed, NOT disabled)
    if (!this._bgImg._flipH) this._bgImg._flipH = false;
    if (!this._bgImg._flipV) this._bgImg._flipV = false;

    // onAddImage handler for upload button and drag/drop
    const _onAddImage = (file) => {
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
          } else {
            this._setStatus("Upload failed");
          }
        } catch (e) {
          console.warn("[P3D] bg upload", e);
          this._setStatus("Upload error");
        }
      };
      reader.readAsDataURL(file);
    };

    // Create a canvas toolbar just for drag/drop setup (hidden, no visible UI)
    this._canvasToolbar = createCanvasToolbar({
      onAddImage: _onAddImage,
      showBgColor: false,
      showClear: false,
      showReset: false,
    });
    this._canvasToolbar.el.style.display = "none";
    left.appendChild(this._canvasToolbar.el);

    const bgTP = createTransformPanel({
      onFitWidth: () => this._fitBg("width"),
      onFitHeight: () => this._fitBg("height"),
      onFlipH: () => {
        this._bgImg._flipH = !this._bgImg._flipH;
        this._updateBgCSS();
      },
      onFlipV: () => {
        this._bgImg._flipV = !this._bgImg._flipV;
        this._updateBgCSS();
      },
      onRotateCCW: () => {
        this._bgImg.rotation = (this._bgImg.rotation - 90) % 360;
        this._updateBgCSS();
        this._syncBgSliders();
      },
      onRotateCW: () => {
        this._bgImg.rotation = (this._bgImg.rotation + 90) % 360;
        this._updateBgCSS();
        this._syncBgSliders();
      },
      onReset: () => {
        this._bgImg = {
          ...this._bgImg,
          x: 0,
          y: 0,
          scale: 100,
          rotation: 0,
          opacity: 100,
          _flipH: false,
          _flipV: false,
        };
        this._updateBgCSS();
        this._syncBgSliders();
      },
      showRotateSlider: false,
      showScaleSlider: false,
      showStretchSliders: false,
      showOpacitySlider: false,
    });
    const bgTitleEl = bgTP.el.querySelector(".pxf-panel-title");
    if (bgTitleEl) {
      const textNode = [...bgTitleEl.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
      if (textNode) textNode.textContent = "BACKGROUND IMAGE";
    }

    // X/Y/Scale/Rotate/Opacity sliders
    const bgXR = createSliderRow("X", -100, 100, 0, (v) => {
      this._bgImg.x = v;
      this._updateBgCSS();
    });
    const bgYR = createSliderRow("Y", -100, 100, 0, (v) => {
      this._bgImg.y = v;
      this._updateBgCSS();
    });
    const bgScR = createSliderRow("Scale", 1, 300, 100, (v) => {
      this._bgImg.scale = v;
      this._updateBgCSS();
    });
    const bgRotR = createSliderRow("Rotate", -180, 180, 0, (v) => {
      this._bgImg.rotation = v;
      this._updateBgCSS();
    });
    const bgOpR = createSliderRow("Opacity", 0, 100, 100, (v) => {
      this._bgImg.opacity = v;
      this._updateBgCSS();
    });
    this.el.bgX = bgXR.slider;
    this.el.bgXV = bgXR.numInput;
    this.el.bgY = bgYR.slider;
    this.el.bgYV = bgYR.numInput;
    this.el.bgSc = bgScR.slider;
    this.el.bgScV = bgScR.numInput;
    this.el.bgRot = bgRotR.slider;
    this.el.bgRotV = bgRotR.numInput;
    this.el.bgOp = bgOpR.slider;
    this.el.bgOpV = bgOpR.numInput;

    // Hide/Remove BG buttons
    let _bgHidden = false;
    const hideBtn = createButton("Hide BG", {
      variant: "standard",
      onClick: () => {
        if (!this.el.bgImgEl) return;
        _bgHidden = !_bgHidden;
        if (this.el.bgContainer)
          this.el.bgContainer.style.display = _bgHidden ? "none" : "";
        hideBtn.textContent = _bgHidden ? "Show BG" : "Hide BG";
      },
    });
    const removeBtn = createButton("Remove BG", {
      variant: "standard",
      onClick: () => {
        this._removeBgImage();
      },
    });
    hideBtn.style.flex = "1";
    removeBtn.style.flex = "1";
    removeBtn.classList.add("pxf-btn-danger");

    const pc = bgTP.content || bgTP.el.querySelector(".pxf-panel-content");
    if (pc) {
      // Upload button at the top of the panel
      const bgFileInput = document.createElement("input");
      bgFileInput.type = "file";
      bgFileInput.accept = "image/*";
      bgFileInput.style.display = "none";
      bgFileInput.addEventListener("change", () => {
        const file = bgFileInput.files?.[0];
        if (file) _onAddImage(file);
        bgFileInput.value = "";
      });
      pc.insertBefore(bgFileInput, pc.firstChild);
      const uploadBtn = createButton("Upload Background Image", {
        variant: "full",
        iconSrc: "/pixaroma/assets/icons/ui/upload.svg",
        onClick: () => bgFileInput.click(),
        title: "Browse for a background image",
      });
      uploadBtn.style.cssText = "width:100%;margin-bottom:6px;";
      pc.insertBefore(uploadBtn, bgFileInput.nextSibling);

      // Sliders with consistent spacing
      const sliderGroup = document.createElement("div");
      sliderGroup.style.cssText = "margin-top:6px;display:flex;flex-direction:column;gap:2px;";
      sliderGroup.append(bgXR.el, bgYR.el, bgScR.el, bgRotR.el, bgOpR.el);
      pc.appendChild(sliderGroup);

      const actRow = createButtonRow([hideBtn, removeBtn]);
      actRow.style.marginTop = "6px";
      pc.appendChild(actRow);
    }
    left.appendChild(bgTP.el);

    // 3D Objects — click a shape to add it instantly (params editable on right sidebar)
    const obs = createPanel("3D Objects", { collapsible: true });
    const og = document.createElement("div");
    og.className = "p3d-grid3";
    og.style.cssText =
      "display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;";
    // Placeholder metadata for shapes not yet implemented — allows the
    // full 18-button grid to render during migration. Clicking one of
    // these adds a cube (using cube defaults so the Shape/Transform
    // panels stay fully functional) and logs a warning.
    // Types that aren't in the parametric SHAPES registry but are
    // still real buttons in the grid — loaded via the importer
    // module (bunny ships as GLB; user imports handled in Task 8).
    const IMPORTED = { bunny: { icon: "bunny.svg", label: "Bunny" } };
    const shapes = SHAPE_GRID.map((id) => {
      const s = SHAPES[id];
      const imp = IMPORTED[id];
      return {
        id,
        icon: s ? s.icon : imp ? imp.icon : "cube.svg",
        label: s ? s.label : imp ? imp.label : id.charAt(0).toUpperCase() + id.slice(1),
        implemented: !!s || !!imp,
      };
    });
    shapes.forEach((sh) => {
      const b = document.createElement("div");
      b.className = "p3d-shape-btn";
      if (!sh.implemented) b.classList.add("p3d-shape-todo");
      b.title = sh.implemented
        ? "Add " + sh.label
        : sh.label + " (coming soon)";
      const ico = document.createElement("span");
      ico.className = "p3d-shape-ico";
      ico.setAttribute("role", "img");
      ico.setAttribute("aria-label", sh.label);
      const iconUrl = `url("/pixaroma/assets/icons/3D/${sh.icon}")`;
      ico.style.webkitMaskImage = iconUrl;
      ico.style.maskImage = iconUrl;
      const lbl = document.createElement("span");
      lbl.textContent = sh.label;
      b.append(ico, lbl);
      b.addEventListener("click", async () => {
        if (sh.implemented) {
          // Teapot geometry is fetched from a separate ESM module on
          // first use so the editor's first-open stays fast. Await it
          // before calling _addObject so the mesh appears with the
          // real geometry rather than the placeholder-sphere fallback.
          if (sh.id === "teapot") {
            await loadTeapotGeometry();
            this._addObject(sh.id, { ...SHAPES[sh.id].defaults });
            return;
          }
          // Bunny ships as a GLB asset. Load through the importer
          // module (cached after first call) and add via the common
          // imported-group plumbing.
          if (sh.id === "bunny") {
            const { loadGLBFromURL } = await import("./importer.mjs");
            try {
              const group = await loadGLBFromURL(
                "/pixaroma/assets/models/bunny.glb",
              );
              this._addImportedGroup(group, "bunny", { name: "Bunny" });
            } catch (e) {
              console.error("[P3D] bunny load failed", e);
              this._setStatus?.("Bunny file missing — added placeholder sphere");
              this._addObject("sphere", { radius: 0.5, widthSegs: 32, heightSegs: 32 });
              if (this.activeObj) this.activeObj.userData.type = "bunny";
            }
            return;
          }
          this._addObject(sh.id, { ...SHAPES[sh.id].defaults });
        } else {
          // Placeholder button: log and spawn an honest-to-goodness cube
          // (type "cube") so the Shape panel + sliders all work. Keeps
          // UX consistent while the real shape is still being migrated.
          console.warn(
            `[P3D] shape "${sh.id}" not yet implemented — adding a cube.`);
          this._addObject("cube", { ...SHAPES.cube.defaults });
        }
      });
      og.appendChild(b);
    });
    obs.content.appendChild(og);

    // Import 3D Model button — opens a native file picker, then the
    // importer module uploads to the backend and loads the resulting
    // model into the scene.
    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = ".glb,.gltf,.obj";
    importInput.style.display = "none";
    importInput.addEventListener("change", async () => {
      const file = importInput.files?.[0];
      importInput.value = "";
      if (!file) return;
      try {
        const { importFromFile } = await import("./importer.mjs");
        await importFromFile(this, file);
      } catch (e) {
        console.error("[P3D] import failed", e);
        this._setStatus?.("Import error: " + (e.message || e));
      }
    });
    obs.content.appendChild(importInput);
    const importBtn = createButton("Import 3D Model (.glb / .obj, max 50 MB)", {
      variant: "standard",
      onClick: () => importInput.click(),
      title: "Import a local GLB, GLTF, or OBJ file (max 50 MB)",
    });
    importBtn.style.cssText = "width:100%;margin-top:8px;";
    obs.content.appendChild(importBtn);

    left.appendChild(obs.el);

    // Transform Tools
    const tt = createPanel("Transform Tools", { collapsible: true });
    const tg = document.createElement("div");
    tg.style.cssText =
      "display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;";
    this._toolDefs = [
      {
        id: "move",
        icon: "✥",
        l: "Move",
        key: "M",
        tip: "Move (M) \u2014 Drag colored arrows to translate along X/Y/Z",
      },
      {
        id: "rotate",
        icon: "\u21bb",
        l: "Rotate",
        key: "R",
        tip: "Rotate (R) \u2014 Drag colored rings to rotate around X/Y/Z",
      },
      {
        id: "scale",
        icon: "\u2922",
        l: "Scale",
        key: "S",
        tip: "Scale (S) \u2014 Drag colored boxes to resize along X/Y/Z",
      },
    ];
    this._toolDefs.forEach((t) => {
      const b = document.createElement("div");
      b.className = "pxf-tool-btn" + (this.toolMode === t.id ? " active" : "");
      b.title = t.tip;
      b.innerHTML = `<span class="pxf-tool-btn-icon">${t.icon}</span><span class="pxf-tool-btn-label">${t.l}</span>`;
      b.addEventListener("click", () => this._setToolMode(t.id));
      this.el[`tool_${t.id}`] = b;
      tg.appendChild(b);
    });
    tt.content.appendChild(tg);
    left.appendChild(tt.el);

    // Camera
    const cam = createPanel("Camera", { collapsible: true });
    const cRow1 = document.createElement("div");
    cRow1.style.cssText =
      "display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;";
    [
      { id: "front", l: "Front", tip: "Front view (F / 1)" },
      { id: "side", l: "Side", tip: "Right side view (2)" },
      { id: "back", l: "Back", tip: "Back view (B / 3)" },
      { id: "top", l: "Top", tip: "Top view (T / 4)" },
    ].forEach((t) => {
      const b = document.createElement("div");
      b.className = "pxf-tool-btn";
      b.title = t.tip;
      b.innerHTML = `<span class="pxf-tool-btn-icon">${t.l[0]}</span><span class="pxf-tool-btn-label">${t.l}</span>`;
      b.addEventListener("click", () => this._camView(t.id));
      cRow1.appendChild(b);
    });
    cam.content.appendChild(cRow1);
    const perspBtn = createButton("Perspective", {
      variant: "standard",
      onClick: () => this._setPerspective(true),
      title: "Standard perspective camera",
    });
    const isoBtn = createButton("Isometric", {
      variant: "standard",
      onClick: () => this._setPerspective(false),
      title: "Orthographic/isometric camera",
    });
    this.el.perspBtn = perspBtn;
    this.el.isoBtn = isoBtn;
    perspBtn.classList.add("active");
    perspBtn.style.flex = "1";
    isoBtn.style.flex = "1";
    const perspRow = createButtonRow([perspBtn, isoBtn]);
    perspRow.style.marginTop = "5px";
    cam.content.appendChild(perspRow);
    const focusBtn = createButton("Focus Selected (0)", {
      variant: "standard",
      iconSrc: "/pixaroma/assets/icons/3D/focus.svg",
      onClick: () => this._camView("focus"),
      title: "Center camera on selected object",
    });
    focusBtn.style.cssText = "width:100%;margin-top:5px;margin-bottom:8px;";
    cam.content.appendChild(focusBtn);
    // FOV
    const fovR = createSliderRow("FOV", 15, 120, this._fov, (v) => {
      this._fov = v;
      if (this.camera && this.camera.fov !== undefined) {
        this.camera.fov = v;
        this.camera.updateProjectionMatrix();
      }
    });
    this.el.fovSlider = fovR.slider;
    this.el.fovVal = fovR.numInput;
    cam.content.appendChild(fovR.el);
    // Checkboxes
    const shCb = createCheckbox("Ground Shadows", this._shadows, (v) => {
      this._shadows = v;
      if (this._groundMesh) this._groundMesh.visible = v;
    });
    this.el.shadowCheck = shCb.checkbox;
    shCb.el.style.marginTop = "8px";
    cam.content.appendChild(shCb.el);
    const gridCb = createCheckbox("Show Grid", this._showGrid, (v) => {
      this._showGrid = v;
      if (this.gridHelper) this.gridHelper.visible = v;
    });
    this.el.gridCheck = gridCb.checkbox;
    gridCb.el.style.marginTop = "6px";
    cam.content.appendChild(gridCb.el);
    const gizCb = createCheckbox("Show Gizmo", this._showGizmo, (v) => {
      this._showGizmo = v;
      if (this._gizmoHelper) this._gizmoHelper.visible = v;
    });
    this.el.gizmoCheck = gizCb.checkbox;
    gizCb.el.style.marginTop = "6px";
    cam.content.appendChild(gizCb.el);
    left.appendChild(cam.el);

    // Status
    const status = document.createElement("div");
    status.style.cssText =
      "padding:8px 12px;font-size:9px;color:#555;border-top:1px solid #2a2c2e;margin-top:auto;flex-shrink:0;font-family:monospace;";
    this.el.status = status;
    left.appendChild(status);
  }

  _buildRight(right, footer) {
    right.style.overflowY = "auto";
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

    // 1.5) Shape — per-object geometry parameters (mixin from shape_params.mjs)
    right.insertBefore(this._createShapePanel(createPanel), footer);

    // 2) Object Color + HSL
    const colSec = createPanel("Object Color", {
      collapsible: true,
      collapsed: false,
    });
    const colorIn = createColorInput({
      value: "#c4a882",
      onChange: (v) => this._setObjColor(v),
    });
    colorIn.style.cssText = "width:100%;height:28px;";
    this.el.objColor = colorIn;
    colSec.content.appendChild(colorIn);
    const hslWrap = document.createElement("div");
    hslWrap.style.marginTop = "6px";
    ["H", "S", "L"].forEach((ch, idx) => {
      const r = document.createElement("div");
      r.className = "p3d-hsl-row";
      const lbl = document.createElement("label");
      lbl.textContent = ch;
      const sl = document.createElement("input");
      sl.type = "range";
      sl.min = 0;
      sl.max = idx === 0 ? 360 : 100;
      sl.value = 0;
      const val = document.createElement("span");
      val.className = "val";
      val.textContent = "0";
      sl.addEventListener("input", () => {
        val.textContent = sl.value;
        this._hslToColor();
      });
      this.el[`hsl${ch}`] = sl;
      this.el[`hsl${ch}V`] = val;
      r.append(lbl, sl, val);
      hslWrap.appendChild(r);
    });
    colSec.content.appendChild(hslWrap);
    const nameIn = createNumberInput({});
    nameIn.type = "text";
    nameIn.placeholder = "name";
    nameIn.style.width = "100%";
    nameIn.addEventListener("change", () => {
      if (this.activeObj) {
        this.activeObj.userData.name = nameIn.value;
        this._updateLayers();
      }
    });
    this.el.objName = nameIn;
    colSec.content.appendChild(createRow("Name", nameIn));
    const delBtn = createButton("Delete Object", {
      variant: "danger",
      onClick: () => this._deleteSelected(),
      title: "Delete selected",
    });
    delBtn.style.width = "100%";
    this.el.delBtn = delBtn;
    colSec.content.appendChild(delBtn);
    right.insertBefore(colSec.el, footer);

    // 3) Materials
    const mats = createPanel("Materials", {
      collapsible: true,
      collapsed: false,
    });
    const mg = document.createElement("div");
    mg.className = "p3d-mat-grid";
    this.el.matBtns = [];
    [
      { id: "clay", l: "Clay", c: "#c4a882", r: 0.85, m: 0 },
      { id: "matte", l: "Matte", c: "#888", r: 0.95, m: 0 },
      { id: "glossy", l: "Glossy", c: "#6688cc", r: 0.08, m: 0.15 },
      { id: "metal", l: "Metal", c: "#b0b0cc", r: 0.12, m: 1 },
    ].forEach((p) => {
      const b = document.createElement("div");
      b.className = "p3d-mat-btn";
      b.title = p.l + " material";
      const pv = document.createElement("div");
      pv.className = "p3d-mat-preview";
      pv.style.background = `radial-gradient(circle at 35% 35%, ${p.c}, #1a1a1a)`;
      b.append(pv, document.createTextNode(p.l));
      b.addEventListener("click", () => {
        if (!this.activeObj) return; // no-op when disabled
        this._applyMat(p);
      });
      mg.appendChild(b);
      this.el.matBtns.push(b);
    });
    mats.content.appendChild(mg);
    // Helper: imported Groups don't have a top-level .material, so
    // material tweaks have to reach into every mesh in the hierarchy.
    const forEachMat = (o, fn) => {
      if (o.material) fn(o.material);
      else if (o.isGroup) {
        o.traverse((c) => {
          if (c.isMesh && c.material) fn(c.material);
        });
      }
    };
    const rR = createSliderRow("Rough", 0, 100, 85, (v) => {
      for (const o of this.selectedObjs) {
        forEachMat(o, (m) => { if ("roughness" in m) m.roughness = v / 100; });
      }
      if (this.el.glossS) {
        const g = 100 - v;
        this.el.glossS.value = g;
        this.el.glossV.value = g;
      }
    });
    const gR = createSliderRow("Gloss", 0, 100, 15, (v) => {
      for (const o of this.selectedObjs) {
        forEachMat(o, (m) => { if ("roughness" in m) m.roughness = 1 - v / 100; });
      }
      if (this.el.roughS) {
        const r = 100 - v;
        this.el.roughS.value = r;
        this.el.roughV.value = r;
      }
    });
    const oR = createSliderRow("Opacity", 0, 100, 100, (v) => {
      for (const o of this.selectedObjs) {
        forEachMat(o, (m) => {
          m.opacity = v / 100;
          m.transparent = v < 100;
        });
      }
    });
    this.el.roughS = rR.slider;
    this.el.roughV = rR.numInput;
    this.el.glossS = gR.slider;
    this.el.glossV = gR.numInput;
    this.el.opacS = oR.slider;
    this.el.opacV = oR.numInput;
    mats.content.append(rR.el, gR.el, oR.el);
    right.insertBefore(mats.el, footer);

    // 4) Lighting
    const lp = createPanel("Lighting", { collapsible: true, collapsed: false });
    const lcIn = createColorInput({
      value: "#ffffff",
      onChange: (v) => {
        if (this.light) this.light.color.set(v);
      },
    });
    this.el.lightColor = lcIn;
    lp.content.appendChild(createRow("Color", lcIn));
    const studioCb = createCheckbox("Studio Lighting", true, (v) => {
      this._studioEnvOn = v;
      if (this.scene) {
        this.scene.environment = v ? this._studioEnvTexture : null;
      }
    });
    this.el.studioCheck = studioCb.checkbox;
    studioCb.el.style.marginTop = "4px";
    studioCb.el.style.marginBottom = "4px";
    lp.content.appendChild(studioCb.el);
    const iR = createSliderRow("Intensity", 0, 200, 50, (v) => {
      if (this.light) this.light.intensity = (v / 100) * 2;
    });
    const sR = createSliderRow("Ambient", 0, 100, 15, (v) => {
      if (this.ambientLight) this.ambientLight.intensity = v / 100;
    });
    this.el.lightIntS = iR.slider;
    this.el.lightIntV = iR.numInput;
    this.el.lightAmbS = sR.slider;
    this.el.lightAmbV = sR.numInput;
    lp.content.append(iR.el, sR.el);
    const dirLabel = document.createElement("div");
    dirLabel.style.cssText =
      "font-size:9px;color:#888;margin-top:4px;margin-bottom:3px;";
    dirLabel.textContent = "Light Direction";
    lp.content.appendChild(dirLabel);
    const angR = createSliderRow("Angle", 0, 360, 81, (v) => {
      this._lightDir.theta = (v * Math.PI) / 180;
      this._applyLightDir();
    });
    const hgtR = createSliderRow("Height", 5, 90, 25, (v) => {
      this._lightDir.phi = ((90 - v) * Math.PI) / 180;
      this._applyLightDir();
    });
    this.el.lightAngle = angR.slider;
    this.el.lightAngleVal = angR.numInput;
    this.el.lightHeight = hgtR.slider;
    this.el.lightHeightVal = hgtR.numInput;
    lp.content.append(angR.el, hgtR.el);
    const resetLightBtn = createButton("Reset Light", {
      variant: "standard",
      onClick: () => {
        this._lightDir = {
          theta: (81 * Math.PI) / 180,
          phi: (65 * Math.PI) / 180,
        };
        this._applyLightDir();
        if (this.el.lightAngle) {
          this.el.lightAngle.value = 81;
          this.el.lightAngleVal.value = 81;
        }
        if (this.el.lightHeight) {
          this.el.lightHeight.value = 25;
          this.el.lightHeightVal.value = 25;
        }
        if (this.light) {
          this.light.color.set("#ffffff");
          this.light.intensity = 1.0;
        }
        if (this.el.lightColor) this.el.lightColor.value = "#ffffff";
        if (this.ambientLight) this.ambientLight.intensity = 0.15;
        if (this.el.lightIntS) {
          this.el.lightIntS.value = 50;
          this.el.lightIntV.value = 50;
        }
        if (this.el.lightAmbS) {
          this.el.lightAmbS.value = 15;
          this.el.lightAmbV.value = 15;
        }
      },
      title: "Reset lighting to defaults",
    });
    resetLightBtn.style.cssText = "width:100%;margin-top:5px;";
    lp.content.appendChild(resetLightBtn);
    right.insertBefore(lp.el, footer);
  }

  // ─── Helpers ──────────────────────────────────────────────
  _section(t) {
    const p = createPanel(t);
    return p.content;
  }
  _row(l, el) {
    return createRow(l, el);
  }
  _numInput(v) {
    return createNumberInput({ value: v });
  }
  _sliderRow(label, min, max, val, onChange) {
    const sr = createSliderRow(label, min, max, val, onChange);
    return { row: sr.el, slider: sr.slider, val: sr.numInput };
  }
  _mkBtn(text, onClick, cls = "pxf-btn", tip = "") {
    return createButton(text, {
      variant: cls.includes("accent")
        ? "accent"
        : cls.includes("danger")
          ? "danger"
          : "standard",
      onClick,
      title: tip,
    });
  }
  _setStatus(msg) {
    if (this.el.status) this.el.status.textContent = msg;
  }
  _toggleHelp() {
    if (this._layout) this._layout.toggleHelp();
  }
}
