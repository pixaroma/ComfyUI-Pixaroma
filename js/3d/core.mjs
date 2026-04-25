// ============================================================
// Pixaroma 3D Editor — Core class, constructor, UI building
// ============================================================
import { ThreeDAPI } from "./api.mjs";
import { openShapePicker } from "./picker.mjs";
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
// Local vendored three.js (served by server_routes.py @ /pixaroma/vendor/three/)
// keeps the 3D Builder working offline and pins the version so upstream
// Three.js breaking changes can't silently break saved scenes.
export const THREE_VENDOR = "/pixaroma/vendor/three";
export async function loadThree() {
  if (THREE) return;
  // Parallel module loads — serial awaits added round-trip latency
  // that showed as a gray flash when the editor first opened.
  const [threeMod, orbitMod, transformMod, composerMod, renderMod, outlineMod, outputMod] =
    await Promise.all([
      import(THREE_VENDOR + "/three.mjs"),
      import(THREE_VENDOR + "/examples/jsm/controls/OrbitControls.mjs"),
      import(THREE_VENDOR + "/examples/jsm/controls/TransformControls.mjs"),
      import(THREE_VENDOR + "/examples/jsm/postprocessing/EffectComposer.mjs"),
      import(THREE_VENDOR + "/examples/jsm/postprocessing/RenderPass.mjs"),
      import(THREE_VENDOR + "/examples/jsm/postprocessing/OutlinePass.mjs"),
      import(THREE_VENDOR + "/examples/jsm/postprocessing/OutputPass.mjs"),
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
const STYLE_ID = "pixaroma-3d-extra-v4";
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
/* Scoped to .p3d-workspace so Paint's cursor-overlay canvas (position:absolute) isn't
   stomped by position:relative after 3D's stylesheet is injected globally. */
.p3d-workspace canvas{display:block;position:relative;z-index:1;}
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
.p3d-ad-btn{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid #3a3d40;background:#242628;border-radius:4px;cursor:pointer;transition:all .12s;flex:0 0 auto;}
.p3d-ad-btn:hover{background:#2a2c2e;border-color:#f66744;}
.p3d-ad-btn.disabled{opacity:0.3;cursor:not-allowed;pointer-events:auto;}
.p3d-ad-btn.disabled:hover{background:#242628;border-color:#3a3d40;}
.p3d-row{display:flex;align-items:center;gap:5px;margin-bottom:4px;}
.p3d-label{font-size:10px;color:#888;width:72px;flex-shrink:0;}
.p3d-range{flex:1;min-width:0;}
.p3d-input{width:50px;background:#111;color:#e0e0e0;border:1px solid #3a3d40;border-radius:3px;padding:3px 4px;font-size:10px;font-family:monospace;text-align:center;}
.p3d-btn{background:#1e2022;color:#ccc;border:1px solid #3a3d40;border-radius:4px;cursor:pointer;transition:all .12s;font-family:inherit;}
.p3d-btn:hover{background:#2e3033;color:#f66744;border-color:#f66744;}
.p3d-camera-disabled{opacity:.35;pointer-events:none;}
.p3d-preset-row{display:grid;grid-template-columns:1fr auto auto auto;gap:4px;margin-top:6px;align-items:center;}
.p3d-bg-preset-row{margin-bottom:20px;}
.p3d-preset-select{min-width:0;background:#111;color:#e0e0e0;border:1px solid #3a3d40;border-radius:4px;padding:4px 5px;font-size:10px;}
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
    this._keyLock = false;
    this._camLock = false;
    this._fineMode = false;
    this._orbitBaseSpeeds = null;
    this.getSharedState = null;
    this.setSharedState = null;
    this._sharedPresetFallback = { camera_templates: [], background_templates: [] };
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
<div class="pxf-help-section">
  <h4>Navigation</h4>
  <div class="pxf-help-grid">
    <b>Left drag</b><span>Orbit camera around target</span>
    <b>Right drag</b><span>Pan camera</span>
    <b>Scroll wheel</b><span>Zoom in / out</span>
  </div>
</div>
<div class="pxf-help-section">
  <h4>Camera Views</h4>
  <div class="pxf-help-grid">
    <b>1</b><span>Front view</span>
    <b>2</b><span>Right side view</span>
    <b>3</b><span>Back view</span>
    <b>4</b><span>Top view</span>
    <b>5</b><span>Perspective (3/4 angle)</span>
    <b>6</b><span>Isometric (orthographic)</span>
    <b>7</b><span>Left side view</span>
    <b>0 / .</b><span>Focus on selected object (Blender: Numpad .)</span>
  </div>
</div>
<div class="pxf-help-section">
  <h4>Transform Tools</h4>
  <div class="pxf-help-grid">
    <b>M / G</b><span>Move tool (Blender: Grab)</span>
    <b>R</b><span>Rotate tool (around X/Y/Z)</span>
    <b>S</b><span>Scale tool (per-axis or uniform)</span>
  </div>
</div>
<div class="pxf-help-section">
  <h4>Selection</h4>
  <div class="pxf-help-grid">
    <b>Click</b><span>Select object under cursor</span>
    <b>Shift+Click</b><span>Add / remove from multi-selection</span>
    <b>Ctrl+A</b><span>Select all unlocked objects</span>
    <b>Alt+A</b><span>Deselect all (Blender)</span>
    <b>Esc</b><span>Deselect all (or close this help)</span>
  </div>
</div>
<div class="pxf-help-section">
  <h4>Align &amp; Distribute</h4>
  <div class="pxf-help-grid">
    <b>2+ objects</b><span>Enables the Align buttons in the titlebar</span>
    <b>3+ objects</b><span>Enables Distribute buttons</span>
    <b>X / Y / Z</b><span>Each axis group has Min / Center / Max</span>
  </div>
</div>
<div class="pxf-help-section">
  <h4>Actions</h4>
  <div class="pxf-help-grid">
    <b>Ctrl+D / Shift+D</b><span>Duplicate selected (Shift+D = Blender)</span>
    <b>Shift+A</b><span>Add object — open shape picker (Blender)</span>
    <b>Delete</b><span>Delete selected</span>
    <b>Ctrl+Z</b><span>Undo</span>
    <b>Ctrl+Y</b><span>Redo</span>
    <b>Ctrl+S</b><span>Save scene</span>
  </div>
</div>
<div class="pxf-help-section">
  <h4>Layers Panel</h4>
  <div class="pxf-help-grid">
    <b>Click</b><span>Select layer</span>
    <b>Drag</b><span>Reorder layers</span>
    <b>Double-click</b><span>Rename layer</span>
    <b>Eye icon</b><span>Toggle visibility</span>
    <b>Lock icon</b><span>Prevent transforms / edits</span>
    <b>Drop icon</b><span>Drop object to floor (y = 0)</span>
  </div>
</div>
<div class="pxf-help-section">
  <h4>Viewport</h4>
  <div class="pxf-help-grid">
    <b>Show Grid</b><span>Toggle the ground grid</span>
    <b>Show Gizmo</b><span>Toggle the transform gizmo</span>
    <b>Show Axes</b><span>Toggle the corner X/Y/Z indicator</span>
  </div>
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

    // ── Align & Distribute bar (titlebar center) ─────────────
    // Matches the Image Composer pattern: compact horizontal bar of
    // icon buttons in the top titlebar. 3D has THREE axes so the bar
    // is grouped: [X row] [Y row] [Z row] [Distribute row]. Each row
    // is 1 axis label + 3 min/center/max align buttons. The fourth
    // group holds one distribute button per axis. Icons are reused
    // from assets/icons/ui/ — the axis label before each group makes
    // the reused icons unambiguous (e.g. align-left means "min" on
    // whichever axis owns that group). Greys out when the selection
    // is too small (<2 for align, <3 for distribute).
    this._buildAlignDistributeBar(layout.titlebarCenter);

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
      window.removeEventListener("keyup", this._onKeyUp, { capture: true });
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
      // Release the secondary WebGL context used for layer-panel
      // thumbnails. Without forceContextLoss the browser can hold on
      // to the GL context after editor close and eventually refuse
      // to create more (Chrome caps at ~16).
      if (this._thumbRenderer) {
        this._thumbRenderer.dispose();
        this._thumbRenderer.forceContextLoss();
        this._thumbRenderer = null;
      }
      // Free axis HUD resources (sprite textures, arrow materials).
      if (this._axisHud) {
        this._axisHud.scene.traverse((o) => {
          if (o.material) {
            if (o.material.map) o.material.map.dispose();
            o.material.dispose?.();
          }
          o.geometry?.dispose?.();
          if (o.line?.material) o.line.material.dispose?.();
          if (o.cone?.material) o.cone.material.dispose?.();
          if (o.line?.geometry) o.line.geometry.dispose?.();
          if (o.cone?.geometry) o.cone.geometry.dispose?.();
        });
        this._axisHud = null;
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
    // Scope 3D-only canvas CSS (position:relative for bg-container stacking)
    // to this workspace; otherwise it bleeds into Paint and kills its cursor overlay.
    vp.classList.add("p3d-workspace");
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

      const bgPresetRow = document.createElement("div");
      bgPresetRow.className = "p3d-preset-row p3d-bg-preset-row";
      bgPresetRow.style.marginBottom = "20px";
      const bgPresetSelect = document.createElement("select");
      bgPresetSelect.className = "p3d-preset-select";
      const bgSaveBtn = createButton("Save", {
        variant: "standard",
        onClick: async (e) => {
          e?.preventDefault?.();
          e?.stopPropagation?.();
          await this._saveBackgroundTemplate();
        },
        title: "Save current background image and settings as a workflow preset",
      });
      const bgApplyBtn = createButton("Apply", {
        variant: "standard",
        onClick: (e) => {
          e?.preventDefault?.();
          e?.stopPropagation?.();
          this._applyBackgroundTemplate();
        },
        title: "Apply selected background preset",
      });
      const bgDeleteBtn = createButton("Delete", {
        variant: "standard",
        onClick: (e) => {
          e?.preventDefault?.();
          e?.stopPropagation?.();
          this._deleteBackgroundTemplate();
        },
        title: "Delete selected background preset",
      });
      bgDeleteBtn.classList.add("pxf-btn-danger");
      this.el.bgPresetSelect = bgPresetSelect;
      bgPresetRow.append(bgPresetSelect, bgSaveBtn, bgApplyBtn, bgDeleteBtn);
      pc.insertBefore(bgPresetRow, uploadBtn.nextSibling);
      this._refreshBackgroundTemplateUI?.();

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

    // 3D Objects — two big primary buttons side by side.
    // Add 3D Object opens a modal picker with every shape/primitive/
    // composite, organised by category. Load 3D Model opens the
    // native file picker for user-supplied GLB/OBJ bundles. Icons
    // for both buttons match the rest of the shape iconography (same
    // mask-image treatment, same brand hover color).
    const obs = createPanel("3D Objects", { collapsible: true });
    const actRow = document.createElement("div");
    actRow.style.cssText =
      "display:grid;grid-template-columns:1fr 1fr;gap:6px;";

    // Hidden file input — reused by the Load button.
    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.multiple = true;
    importInput.accept =
      ".glb,.gltf,.obj,.mtl,.jpg,.jpeg,.png,.bmp,.tga,.webp";
    importInput.style.display = "none";
    importInput.addEventListener("change", async () => {
      const files = importInput.files;
      if (!files || !files.length) return;
      const selected = Array.from(files);
      importInput.value = "";
      try {
        const { importFromFiles } = await import("./importer.mjs");
        await importFromFiles(this, selected);
      } catch (e) {
        console.error("[P3D] import failed", e);
        this._setStatus?.("Import error: " + (e.message || e));
      }
    });
    obs.content.appendChild(importInput);

    // Shared builder for both big buttons — same tile style used in
    // the picker modal but sized up (88px tall) so the two actions
    // read as top-level entry points.
    const buildActionBtn = (iconFile, label, title, onClick) => {
      const b = document.createElement("div");
      b.className = "p3d-shape-btn";
      b.style.cssText = "height:78px;gap:6px;";
      b.title = title;
      const ico = document.createElement("span");
      ico.className = "p3d-shape-ico";
      ico.style.cssText = "width:30px;height:30px;";
      ico.setAttribute("role", "img");
      ico.setAttribute("aria-label", label);
      const iconUrl = `url("/pixaroma/assets/icons/3D/${iconFile}")`;
      ico.style.webkitMaskImage = iconUrl;
      ico.style.maskImage = iconUrl;
      const lbl = document.createElement("span");
      lbl.textContent = label;
      lbl.style.cssText = "font-size:11px;font-weight:500;";
      b.append(ico, lbl);
      b.addEventListener("click", onClick);
      return b;
    };

    const addBtn = buildActionBtn(
      "add-3d-object.svg",
      "Add 3D Object",
      "Browse and add a built-in shape (primitives, vessels, nature, furniture, architecture).",
      () => openShapePicker(this),
    );
    const loadBtn = buildActionBtn(
      "load-3d-model.svg",
      "Load 3D Model",
      "Load a local 3D model (max 50 MB per file). " +
      "For textured OBJ, select the .obj, .mtl, AND all texture " +
      "images together in the file picker. GLB embeds textures " +
      "and only needs one file.",
      () => importInput.click(),
    );
    actRow.append(addBtn, loadBtn);
    obs.content.appendChild(actRow);

    const importHint = document.createElement("div");
    importHint.style.cssText =
      "font-size:10px;color:#888;margin-top:6px;line-height:1.4;";
    importHint.textContent =
      "GLB: 1 file. Textured OBJ: select .obj + .mtl + textures " +
      "together. Max 50 MB each.";
    obs.content.appendChild(importHint);

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

    // Per-axis X / Y / Z sliders under the tool buttons. They
    // reconfigure themselves based on the current Move / Rotate /
    // Scale mode: translate range, degree range, or scale range.
    // They drive the active object directly AND refresh from the
    // gizmo when the user drags the 3D handles, so the two input
    // methods stay in sync.
    const xformBlock = document.createElement("div");
    xformBlock.style.cssText =
      "margin-top:8px;padding-top:6px;border-top:1px solid #2a2c2e;";
    this.el.xformSliders = [];
    // A flag shared by all three rows so dragging any slider only
    // pushes a SINGLE undo entry per drag session (not one per tick).
    const dragState = { snapshotted: false };
    for (const axis of ["X", "Y", "Z"]) {
      const row = document.createElement("div");
      row.className = "p3d-row";
      const lbl = document.createElement("div");
      lbl.className = "p3d-label";
      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "p3d-range";
      const numIn = document.createElement("input");
      numIn.type = "number";
      numIn.className = "p3d-input";
      row.append(lbl, slider, numIn);
      xformBlock.appendChild(row);
      this.el.xformSliders.push({ label: lbl, slider, numIn, axis });

      const axLower = axis.toLowerCase();
      this._wireFineSlider?.(slider, numIn);
      const apply = (v) => {
        v = this._getFineSliderValue?.(slider, v) ?? v;
        if (!this.activeObj || this.activeObj.userData.locked) return;
        if (!dragState.snapshotted) {
          this._pushUndo();
          dragState.snapshotted = true;
        }
        const val = +v;
        const mode = this.toolMode;
        const obj = this.activeObj;
        if (mode === "move") {
          obj.position[axLower] = val;
        } else if (mode === "rotate") {
          obj.rotation[axLower] = (val * Math.PI) / 180;
        } else if (mode === "scale") {
          // Clamp away from zero so the object can't collapse and
          // then fail to come back (scale 0 is irrecoverable via slider).
          const clamped = Math.max(0.01, val);
          if (this.el.xformUniform?.checked) {
            // Lock Proportions: drive all three axes together. Also
            // sync the OTHER two sliders visually so the UI matches
            // what the geometry is doing.
            obj.scale.set(clamped, clamped, clamped);
            for (const s of this.el.xformSliders) {
              if (s.axis === axis) continue;
              s.slider.value = clamped;
              s.numIn.value = this._formatXformValue(clamped);
            }
          } else {
            obj.scale[axLower] = clamped;
          }
        }
        // Keep this row's number input in sync if apply() fired from the slider.
        numIn.value = this._formatXformValue(val);
        this._updateShadowFrustum?.();
      };
      slider.addEventListener("input", () => apply(slider.value));
      // Reset the per-drag flag on pointer-up so the next drag
      // creates a fresh undo entry.
      const endDrag = () => { dragState.snapshotted = false; };
      slider.addEventListener("change", endDrag);
      slider.addEventListener("mouseup", endDrag);
      numIn.addEventListener("change", () => {
        let v = +numIn.value;
        if (isNaN(v)) v = +slider.value;
        slider.value = v;
        apply(v);
        dragState.snapshotted = false;
      });
    }
    tt.content.appendChild(xformBlock);

    // Uniform-scale toggle — when checked, dragging ANY of the
    // X/Y/Z sliders in scale mode sets all three to the same value
    // so the object scales proportionally. Hidden outside scale
    // mode (see _updateTransformSliders).
    const uniformRow = document.createElement("label");
    uniformRow.style.cssText =
      "display:flex;align-items:center;gap:6px;font-size:11px;" +
      "color:#ccc;margin:4px 0;cursor:pointer;";
    const uniformCb = document.createElement("input");
    uniformCb.type = "checkbox";
    uniformCb.checked = true;
    uniformRow.append(uniformCb, document.createTextNode(" Lock Proportions"));
    tt.content.appendChild(uniformRow);
    this.el.xformUniform = uniformCb;
    this.el.xformUniformRow = uniformRow;

    // Reset Transform button — fully resets translation + rotation
    // + scale, then drops the object onto the floor so it doesn't
    // land underground after the reset (its local pivot may not be
    // at its visual bottom).
    const xformReset = createButton("Reset Transform", {
      variant: "standard",
      onClick: () => {
        const THREE = getTHREE();
        const targets = this.selectedObjs.size
          ? [...this.selectedObjs]
          : (this.activeObj ? [this.activeObj] : []);
        const movable = targets.filter((o) => !o.userData.locked);
        if (!movable.length) return;
        this._pushUndo();
        for (const o of movable) {
          o.position.set(0, 0, 0);
          o.rotation.set(0, 0, 0);
          o.scale.set(1, 1, 1);
          // Refresh world matrix before measuring so the bbox sees
          // the just-reset transform, then snap the base to y=0.
          o.updateMatrixWorld(true);
          const bb = new THREE.Box3().setFromObject(o);
          if (isFinite(bb.min.y)) o.position.y -= bb.min.y;
        }
        this._updateTransformSliders?.();
        this._syncProps?.();
        this._updateShadowFrustum?.();
      },
      title: "Reset position / rotation / scale of the selected object",
    });
    xformReset.style.cssText = "width:100%;margin-top:4px;font-size:10px;padding:4px 8px;";
    tt.content.appendChild(xformReset);

    // Prime the transform sliders with the current mode's labels /
    // ranges even when no object is selected yet. Without this initial
    // call the labels were blank and the sliders sat at range defaults
    // (0 → 100) until the first selection triggered _syncProps, which
    // looked like a rendering bug on empty editor open.
    this._updateTransformSliders?.();

    left.appendChild(tt.el);

    // Camera
    const cam = createPanel("Camera", { collapsible: true });
    const cRow1 = document.createElement("div");
    cRow1.style.cssText =
      "display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;";
    [
      { id: "front", l: "Front", ico: "front.svg", tip: "Front view (1)" },
      { id: "side",  l: "Side",  ico: "side.svg",  tip: "Right side view (2) — press 7 for the opposite side" },
      { id: "back",  l: "Back",  ico: "back.svg",  tip: "Back view (3)" },
      { id: "top",   l: "Top",   ico: "top.svg",   tip: "Top view (4)" },
    ].forEach((t) => {
      const b = document.createElement("div");
      b.className = "pxf-tool-btn";
      b.title = t.tip;
      // Render SVG via mask-image so the icon's color is driven by
      // our CSS (#ccc — matches .pxf-tool-btn text), not whatever
      // color the SVG file itself happens to use. invert-filter on
      // a <img> would also work but mask-image is the cleanest and
      // lets hover tinting to orange drop in via CSS later.
      const iconEl = document.createElement("span");
      iconEl.className = "pxf-tool-btn-icon";
      const iconUrl = `url("/pixaroma/assets/icons/3D/${t.ico}")`;
      iconEl.style.cssText =
        `display:block;width:22px;height:22px;margin:0 auto 2px;` +
        `background-color:#ccc;` +
        `-webkit-mask-image:${iconUrl};mask-image:${iconUrl};` +
        `-webkit-mask-size:contain;mask-size:contain;` +
        `-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;` +
        `-webkit-mask-position:center;mask-position:center;` +
        `transition:background-color .12s;`;
      // Hover tint to Pixaroma orange — matches shape-picker tiles
      b.addEventListener("mouseenter", () => {
        iconEl.style.backgroundColor = "#f66744";
      });
      b.addEventListener("mouseleave", () => {
        iconEl.style.backgroundColor = "#ccc";
      });
      const labelEl = document.createElement("span");
      labelEl.className = "pxf-tool-btn-label";
      labelEl.textContent = t.l;
      b.append(iconEl, labelEl);
      b.addEventListener("click", () => this._camView(t.id));
      cRow1.appendChild(b);
    });
    cam.content.appendChild(cRow1);
    this.el.cameraViewButtons = [...cRow1.children];

    const keyLockBtn = createButton("Key Lock", {
      variant: "standard",
      iconSrc: "/pixaroma/assets/icons/layers/lock-unlocked.svg",
      onClick: () => this._setKeyLock(!this._keyLock),
      title: "Lock numeric camera shortcuts (0–7, numpad, period focus)",
    });
    const camLockBtn = createButton("Cam Lock", {
      variant: "standard",
      iconSrc: "/pixaroma/assets/icons/layers/lock-unlocked.svg",
      onClick: () => this._setCamLock(!this._camLock),
      title: "Lock camera orbit, pan, zoom, view buttons, and camera shortcuts",
    });
    keyLockBtn.style.flex = "1";
    camLockBtn.style.flex = "1";
    this.el.keyLockBtn = keyLockBtn;
    this.el.camLockBtn = camLockBtn;
    const lockRow = createButtonRow([keyLockBtn, camLockBtn]);
    lockRow.style.marginTop = "5px";
    cam.content.appendChild(lockRow);

    const perspBtn = createButton("Perspective", {
      variant: "standard",
      onClick: () => {
        this._setPerspective(true);
        this._camView("perspective3q");
      },
      title: "Perspective camera — 3/4 viewing angle (5)",
    });
    const isoBtn = createButton("Isometric", {
      variant: "standard",
      onClick: () => {
        this._setPerspective(false);
        this._camView("iso");
      },
      title: "Orthographic camera — isometric viewing angle (6)",
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
    this.el.focusBtn = focusBtn;
    cam.content.appendChild(focusBtn);
    // FOV
    let fovSliderEl = null;
    const fovR = createSliderRow("FOV", 15, 120, this._fov, (v) => {
      v = this._getFineSliderValue?.(fovSliderEl, v) ?? v;
      this._fov = v;
      if (this.camera && this.camera.fov !== undefined) {
        this.camera.fov = v;
        this.camera.updateProjectionMatrix();
      }
    });
    fovSliderEl = fovR.slider;
    this._wireFineSlider?.(fovR.slider, fovR.numInput);
    this.el.fovSlider = fovR.slider;
    this.el.fovVal = fovR.numInput;
    this.el.fovRow = fovR.el;
    cam.content.appendChild(fovR.el);

    const camPresetRow = document.createElement("div");
    camPresetRow.className = "p3d-preset-row";
    const camPresetSelect = document.createElement("select");
    camPresetSelect.className = "p3d-preset-select";
    const camSaveBtn = createButton("Save", {
      variant: "standard",
      onClick: (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        this._saveCameraTemplate();
      },
      title: "Save current camera view as a workflow preset",
    });
    const camApplyBtn = createButton("Apply", {
      variant: "standard",
      onClick: (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        this._applyCameraTemplate();
      },
      title: "Apply selected camera view preset",
    });
    const camDeleteBtn = createButton("Delete", {
      variant: "standard",
      onClick: (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        this._deleteCameraTemplate();
      },
      title: "Delete selected camera view preset",
    });
    camDeleteBtn.classList.add("pxf-btn-danger");
    this.el.cameraPresetSelect = camPresetSelect;
    camPresetRow.append(camPresetSelect, camSaveBtn, camApplyBtn, camDeleteBtn);
    cam.content.appendChild(camPresetRow);
    this._refreshCameraTemplateUI?.();

    this._refreshLockButtons?.();
    this._applyCamLockState?.();

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
    // Show Axes — toggles the little X/Y/Z orientation HUD that draws
    // in the top-right corner of the viewport. Off doesn't change the
    // main render at all — the HUD pass is just skipped in _animate.
    const showAxesInit = this._axisHud ? this._axisHud.visible !== false : true;
    const axesCb = createCheckbox("Show Axes", showAxesInit, (v) => {
      if (this._axisHud) this._axisHud.visible = v;
    });
    this.el.axesCheck = axesCb.checkbox;
    axesCb.el.style.marginTop = "6px";
    cam.content.appendChild(axesCb.el);
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
      onDropToFloor: () => this._dropToFloor(),
      dropToFloorTitle: "Drop to floor — snap the selected object's base to the ground plane",
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
      collapsed: true,
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
    const lp = createPanel("Lighting", { collapsible: true, collapsed: true });
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

// ─── Align & Distribute titlebar bar ──────────────────────────
// Added as a prototype method (kept out of the huge _buildUI method
// to keep that readable). Populates layout.titlebarCenter with a
// horizontal icon-button bar. Stores the buttons in this.el.adButtons
// so _updateAlignButtons can grey them in/out as the selection grows
// or shrinks.
Pixaroma3DEditor.prototype._buildAlignDistributeBar = function (titlebarCenter) {
  if (!titlebarCenter) return;
  const AD_ICON_PATH = "/pixaroma/assets/icons/ui/";

  // Build one icon button. Mask-image approach so the icon color is
  // driven by CSS — matches the other tool/camera buttons and gives
  // us a clean brand-orange hover tint via JS.
  const makeBtn = (iconFile, title, onClick) => {
    const b = document.createElement("div");
    b.className = "p3d-ad-btn";
    b.title = title;
    const ico = document.createElement("span");
    ico.className = "p3d-ad-ico";
    const url = `url("${AD_ICON_PATH}${iconFile}")`;
    ico.style.cssText =
      `display:block;width:18px;height:18px;` +
      `background-color:#ccc;` +
      `-webkit-mask-image:${url};mask-image:${url};` +
      `-webkit-mask-size:contain;mask-size:contain;` +
      `-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;` +
      `-webkit-mask-position:center;mask-position:center;` +
      `transition:background-color .12s;`;
    b.appendChild(ico);
    b.addEventListener("mouseenter", () => {
      if (!b.classList.contains("disabled"))
        ico.style.backgroundColor = "#f66744";
    });
    b.addEventListener("mouseleave", () => {
      ico.style.backgroundColor = "#ccc";
    });
    b.addEventListener("click", () => {
      if (!b.classList.contains("disabled")) onClick();
    });
    return b;
  };

  // Axis-group config. X and Z reuse the horizontal-align icons (they
  // share the "sideways" semantic). Y uses the vertical set. The axis
  // letter label in front of each group disambiguates.
  const axes = [
    {
      axis: "X", tip: "X axis — left / right",
      align: [
        ["align-left.svg",     "Align X Min (left)"],
        ["align-center-h.svg", "Align X Center"],
        ["align-right.svg",    "Align X Max (right)"],
      ],
      distribute: ["distribute-horizontal.svg", "Distribute along X"],
    },
    {
      axis: "Y", tip: "Y axis — bottom / top",
      align: [
        ["align-bottom.svg",   "Align Y Min (bottom)"],
        ["align-center-v.svg", "Align Y Center"],
        ["align-top.svg",      "Align Y Max (top)"],
      ],
      distribute: ["distribute-vertical.svg", "Distribute along Y"],
    },
    {
      // Z uses the VERTICAL align icons (top/center-v/bottom) because
      // depth reads more naturally as "push up = away/back" / "push
      // down = near/front" — horizon metaphor. Same min/center/max
      // semantics as the other axes; only the icon choice differs.
      axis: "Z", tip: "Z axis — back (-Z) / center / front (+Z, toward viewer)",
      align: [
        ["align-top.svg",      "Align Z Min (back, away from viewer)"],
        ["align-center-v.svg", "Align Z Center"],
        ["align-bottom.svg",   "Align Z Max (front, toward viewer)"],
      ],
      distribute: ["distribute-vertical.svg", "Distribute along Z"],
    },
  ];

  this.el.adButtons = { align: [], distribute: [] };
  const bar = document.createElement("div");
  bar.className = "p3d-ad-bar";
  bar.style.cssText =
    "display:flex;align-items:center;gap:4px;";

  const modes = ["min", "center", "max"];
  // One axis group (label + 3 align buttons) per axis
  axes.forEach((a, idx) => {
    if (idx > 0) {
      const sep = document.createElement("div");
      sep.className = "p3d-ad-sep";
      sep.style.cssText =
        "width:1px;height:20px;background:#3a3d40;margin:0 4px;";
      bar.appendChild(sep);
    }
    const lbl = document.createElement("div");
    lbl.textContent = a.axis;
    lbl.title = a.tip;
    lbl.style.cssText =
      "font-size:11px;font-weight:700;color:#888;padding:0 4px 0 2px;" +
      "min-width:12px;text-align:center;";
    bar.appendChild(lbl);
    a.align.forEach(([icon, title], i) => {
      const btn = makeBtn(icon, title, () =>
        this._alignSelected(a.axis, modes[i]),
      );
      this.el.adButtons.align.push(btn);
      bar.appendChild(btn);
    });
  });

  // Distribute group — separator, then one button per axis
  const sepD = document.createElement("div");
  sepD.className = "p3d-ad-sep";
  sepD.style.cssText =
    "width:1px;height:20px;background:#3a3d40;margin:0 6px 0 4px;";
  bar.appendChild(sepD);
  axes.forEach((a) => {
    const [icon, titleBase] = a.distribute;
    const title = titleBase + " (3+ objects)";
    const btn = makeBtn(icon, title, () => this._distributeSelected(a.axis));
    // Small axis letter overlay so all three distribute buttons are
    // visually distinct (they use the same two icons otherwise).
    btn.style.position = "relative";
    const tag = document.createElement("span");
    tag.textContent = a.axis;
    tag.style.cssText =
      "position:absolute;bottom:0;right:1px;font-size:8px;font-weight:700;" +
      "color:#888;pointer-events:none;line-height:1;";
    btn.appendChild(tag);
    this.el.adButtons.distribute.push(btn);
    bar.appendChild(btn);
  });

  titlebarCenter.appendChild(bar);
  // Prime enabled/disabled state
  this._updateAlignButtons();
};

// Grey out align buttons when <2 objects selected, distribute when <3.
// Called from _select (any selection change) so the bar stays in sync.
Pixaroma3DEditor.prototype._updateAlignButtons = function () {
  const btns = this.el?.adButtons;
  if (!btns) return;
  const n = this.selectedObjs?.size ?? 0;
  const alignEnabled = n >= 2;
  const distribEnabled = n >= 3;
  for (const b of btns.align) {
    b.classList.toggle("disabled", !alignEnabled);
  }
  for (const b of btns.distribute) {
    b.classList.toggle("disabled", !distribEnabled);
  }
};


// ─── Workflow Presets (Camera / Background) ─────────────────
// Defined in core as well as persistence so the UI buttons are never left
// without handlers if the browser serves a stale mixin module.
Pixaroma3DEditor.prototype._presetState = function () {
  let state = null;
  try { state = this.getSharedState?.(); } catch {}
  if (!state || typeof state !== "object") state = this._sharedPresetFallback;
  if (!state || typeof state !== "object") state = {};
  if (!Array.isArray(state.camera_templates)) state.camera_templates = [];
  if (!Array.isArray(state.background_templates)) state.background_templates = [];
  return state;
};

Pixaroma3DEditor.prototype._setPresetState = function (patch = {}) {
  const prev = this._presetState();
  const next = {
    ...prev,
    ...patch,
    camera_templates: Array.isArray(patch.camera_templates)
      ? patch.camera_templates
      : (prev.camera_templates || []),
    background_templates: Array.isArray(patch.background_templates)
      ? patch.background_templates
      : (prev.background_templates || []),
  };
  this._sharedPresetFallback = next;
  try { this.setSharedState?.(next); } catch {}
  this._refreshCameraTemplateUI?.();
  this._refreshBackgroundTemplateUI?.();
};

Pixaroma3DEditor.prototype._syncPresetStateToSceneJson = function () {
  if (this._isRestoring || !this.onSave || typeof this._serializeScene !== "function") return;
  try {
    const sd = this._serializeScene();
    this.onSave(JSON.stringify(sd), null);
  } catch (e) {
    console.warn("[P3D] preset state sync failed", e);
  }
};

Pixaroma3DEditor.prototype._makePresetId = function (prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

Pixaroma3DEditor.prototype._nextTemplateName = function (base, templates) {
  const names = new Set((templates || []).map((t) => String(t.name || "")));
  let i = 1;
  let name = `${base} ${i}`;
  while (names.has(name)) {
    i += 1;
    name = `${base} ${i}`;
  }
  return name;
};

Pixaroma3DEditor.prototype._promptTemplateName = function (label, fallback) {
  let name = fallback || "Preset";
  try {
    const entered = window.prompt(`${label} name`, name);
    if (entered === null) return null;
    name = String(entered).trim();
  } catch {}
  if (!name) {
    this._setStatus?.(`${label} name missing`);
    return null;
  }
  return name;
};

Pixaroma3DEditor.prototype._refreshTemplateSelect = function (select, templates, emptyLabel) {
  if (!select) return;
  const old = select.value;
  select.innerHTML = "";
  if (!templates.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = emptyLabel;
    select.appendChild(opt);
    return;
  }
  for (const t of templates) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name || "Preset";
    select.appendChild(opt);
  }
  if (templates.some((t) => t.id === old)) select.value = old;
};

Pixaroma3DEditor.prototype._refreshCameraTemplateUI = function () {
  const templates = this._presetState().camera_templates || [];
  this._refreshTemplateSelect(this.el.cameraPresetSelect, templates, "No views");
};

Pixaroma3DEditor.prototype._refreshBackgroundTemplateUI = function () {
  const templates = this._presetState().background_templates || [];
  this._refreshTemplateSelect(this.el.bgPresetSelect, templates, "No BG presets");
};

Pixaroma3DEditor.prototype._cameraSnapshot = function (name, id = null) {
  if (!this.camera || !this.orbitCtrl) return null;
  return {
    id: id || this._makePresetId("cam"),
    name,
    position: {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
    },
    target: {
      x: this.orbitCtrl.target.x,
      y: this.orbitCtrl.target.y,
      z: this.orbitCtrl.target.z,
    },
    isOrtho: !!this._isOrtho,
    fov: this._fov,
    zoom: this.camera.zoom ?? 1,
  };
};

Pixaroma3DEditor.prototype._saveCameraTemplate = function () {
  const templates = [...(this._presetState().camera_templates || [])];
  const fallback = this._nextTemplateName?.("View", templates) || `View ${templates.length + 1}`;
  const name = this._promptTemplateName?.("Camera preset", fallback);
  if (!name) return;
  const existingIdx = templates.findIndex((t) => (t.name || "") === name);
  const snap = this._cameraSnapshot(name, existingIdx >= 0 ? templates[existingIdx].id : null);
  if (!snap) {
    this._setStatus?.("Camera preset save failed");
    return;
  }
  if (existingIdx >= 0) templates[existingIdx] = snap;
  else templates.push(snap);
  this._setPresetState({ camera_templates: templates });
  if (this.el.cameraPresetSelect) this.el.cameraPresetSelect.value = snap.id;
  this._syncPresetStateToSceneJson();
  this._setStatus?.(existingIdx >= 0 ? "Camera preset updated" : "Camera preset saved");
};

Pixaroma3DEditor.prototype._selectedCameraTemplate = function () {
  const id = this.el.cameraPresetSelect?.value;
  return (this._presetState().camera_templates || []).find((t) => t.id === id) || null;
};

Pixaroma3DEditor.prototype._applyCameraTemplate = function () {
  if (this._camLock) {
    this._setStatus?.("Camera locked");
    return;
  }
  const t = this._selectedCameraTemplate();
  if (!t || !this.camera || !this.orbitCtrl) return;
  this._setPerspective?.(!t.isOrtho, { force: true });
  if (t.position) this.camera.position.set(t.position.x, t.position.y, t.position.z);
  if (t.target) this.orbitCtrl.target.set(t.target.x, t.target.y, t.target.z);
  if (t.fov !== undefined) {
    this._fov = t.fov;
    if (this.el.fovSlider) this.el.fovSlider.value = t.fov;
    if (this.el.fovVal) this.el.fovVal.value = t.fov;
    if (this.camera.fov !== undefined) this.camera.fov = t.fov;
  }
  if (t.zoom !== undefined && this.camera.zoom !== undefined) this.camera.zoom = t.zoom;
  this.camera.lookAt(this.orbitCtrl.target);
  this.camera.updateProjectionMatrix?.();
  this.camera.updateMatrixWorld?.();
  this.orbitCtrl.update();
  this._setStatus?.("Camera preset applied");
};

Pixaroma3DEditor.prototype._deleteCameraTemplate = function () {
  const id = this.el.cameraPresetSelect?.value;
  if (!id) return;
  const templates = (this._presetState().camera_templates || []).filter((t) => t.id !== id);
  this._setPresetState({ camera_templates: templates });
  this._syncPresetStateToSceneJson();
  this._setStatus?.("Camera preset deleted");
};

Pixaroma3DEditor.prototype._bgTemplateSnapshot = function (name, path, id = null) {
  return {
    id: id || this._makePresetId("bg"),
    name,
    path,
    x: this._bgImg.x || 0,
    y: this._bgImg.y || 0,
    scale: this._bgImg.scale || 100,
    rotation: this._bgImg.rotation || 0,
    opacity: this._bgImg.opacity ?? 100,
    flipH: !!this._bgImg._flipH,
    flipV: !!this._bgImg._flipV,
  };
};

Pixaroma3DEditor.prototype._bgPathToSrc = function (path) {
  if (!path) return null;
  const parts = path.replace(/\\/g, "/").split("/");
  const fname = parts.pop();
  const subfolder = parts.join("/") || "pixaroma";
  return "/view?filename=" +
    encodeURIComponent(fname) +
    "&type=input&subfolder=" +
    encodeURIComponent(subfolder) +
    "&t=" +
    Date.now();
};

Pixaroma3DEditor.prototype._bgImageDataURL = async function () {
  const img = this.el.bgImgEl;
  if (!img?.src) return null;
  if (img.src.startsWith("data:image")) return img.src;
  try {
    const res = await fetch(img.src, { cache: "no-store" });
    if (res.ok) {
      const blob = await res.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
  } catch {}
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || this._bgImg._natW;
    canvas.height = img.naturalHeight || this._bgImg._natH;
    if (!canvas.width || !canvas.height) return null;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  } catch (e) {
    console.warn("[P3D] background preset copy failed", e);
    return null;
  }
};

Pixaroma3DEditor.prototype._saveBackgroundTemplate = async function () {
  if (!this.el.bgImgEl || !this._bgImg.path) {
    this._setStatus?.("Background image missing");
    return;
  }
  const templates = [...(this._presetState().background_templates || [])];
  const fallback = this._nextTemplateName?.("Background", templates) || `Background ${templates.length + 1}`;
  const name = this._promptTemplateName?.("Background preset", fallback);
  if (!name) return;
  this._setStatus?.("Saving background preset...");
  const dataURL = await this._bgImageDataURL();
  if (!dataURL) {
    this._setStatus?.("Background image missing");
    return;
  }
  const uploadId = `${this.projectId}_${this._makePresetId("bgpreset")}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  try {
    const res = await ThreeDAPI.uploadBgImage(uploadId, dataURL);
    if (res.status !== "success" || !res.path) {
      this._setStatus?.("Background preset save failed");
      return;
    }
    const existingIdx = templates.findIndex((t) => (t.name || "") === name);
    const snap = this._bgTemplateSnapshot(name, res.path, existingIdx >= 0 ? templates[existingIdx].id : null);
    if (existingIdx >= 0) templates[existingIdx] = snap;
    else templates.push(snap);
    this._setPresetState({ background_templates: templates });
    if (this.el.bgPresetSelect) this.el.bgPresetSelect.value = snap.id;
    this._syncPresetStateToSceneJson();
    this._setStatus?.(existingIdx >= 0 ? "Background preset updated" : "Background preset saved");
  } catch (e) {
    console.warn("[P3D] bg preset upload", e);
    this._setStatus?.("Background preset save error");
  }
};

Pixaroma3DEditor.prototype._selectedBackgroundTemplate = function () {
  const id = this.el.bgPresetSelect?.value;
  return (this._presetState().background_templates || []).find((t) => t.id === id) || null;
};

Pixaroma3DEditor.prototype._applyBgTemplateState = function (t) {
  if (!t?.path) return;
  this._bgImg = {
    path: t.path,
    x: t.x || 0,
    y: t.y || 0,
    scale: t.scale || 100,
    rotation: t.rotation || 0,
    opacity: t.opacity ?? 100,
    _flipH: !!t.flipH,
    _flipV: !!t.flipV,
    _natW: 0,
    _natH: 0,
  };
  this._syncBgSliders?.();
  const src = this._bgPathToSrc(t.path);
  if (src) this._showBgImage?.(src, false);
};

Pixaroma3DEditor.prototype._applyBackgroundTemplate = function () {
  const t = this._selectedBackgroundTemplate();
  if (!t) return;
  this._applyBgTemplateState(t);
  this._setStatus?.("Background preset applied");
};

Pixaroma3DEditor.prototype._deleteBackgroundTemplate = function () {
  const id = this.el.bgPresetSelect?.value;
  if (!id) return;
  const templates = (this._presetState().background_templates || []).filter((t) => t.id !== id);
  this._setPresetState({ background_templates: templates });
  this._syncPresetStateToSceneJson();
  this._setStatus?.("Background preset deleted");
};
