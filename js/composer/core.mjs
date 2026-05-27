import { PixaromaUI } from "./ui.mjs";
import { PixaromaLayers } from "./layers.mjs";
import { installFocusTrap } from "../shared/index.mjs";
import { NEUTRAL } from "./fx_engine.mjs";
import { renderTextToCanvas } from "../framework/text_render.mjs";

// Default style for a fresh text layer. Field names match the shared text panel
// (js/framework/text_editor.mjs) so setLayer(layer.textState) edits these directly.
const DEFAULT_TEXT_STATE = {
  text: "Your text", font: "Roboto", weight: 400, italic: false,
  fontSize: 96, lineHeight: 1.2, letterSpacing: 0, align: "center",
  color: "#FFFFFF", bgColor: null,
};

export class PixaromaEditor {
  constructor(node) {
    this.node = node;
    this.layers = [];
    this.selectedLayerIds = new Set();
    this.activeLayerIndex = -1;
    this.projectID = "proj_" + Date.now();

    this.docWidth = 1024;
    this.docHeight = 1024;
    this.ratioLock = false;
    this.ratioValue = 1;

    this.interactionMode = null;
    this.activeMode = null;
    this.brushSize = 25;
    this.brushHardness = 0.5;
    this.handleSize = 12;
    this.isMouseDown = false;
    this.startX = 0;
    this.startY = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.tempTransList = [];

    this.viewZoom = 1.0;
    this.viewPanX = 0;
    this.viewPanY = 0;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.spacePressed = false;

    this.history = [];
    this.historyIndex = -1;
    this.isRestoringHistory = false;

    this.ui = new PixaromaUI(this);
    this.ui.build();

    this.renderCanvas = document.createElement("canvas");
    this.renderCtx = this.renderCanvas.getContext("2d");

    this.attachEvents();
    installFocusTrap(this.overlay);
    // Save the restore promise so external callers can await editor
    // readiness before mutating layers (e.g. drop-on-closed-node in
    // index.js needs to add its layer AFTER restore finishes, otherwise
    // the new layer would race the async image loads in attemptRestore
    // and the stack order would be unpredictable).
    this.ready = this.attemptRestore();
  }

  setMode(mode) {
    // Eraser + crop are image-only — never enter them on a text, FX, or
    // placeholder layer (the panels are dimmed + [E]/[C] are gated, but guard
    // the entry too; a placeholder's mask would misapply to the real image).
    if (mode === "eraser" || mode === "crop") {
      const al = this.getActiveLayer();
      if (al && (al.isText || al.isAdjustment || al.isPlaceholder)) {
        if (this._layout)
          this._layout.setStatus(
            (mode === "eraser" ? "Eraser" : "Crop") + " doesn't apply to this layer",
            "warn",
          );
        return;
      }
    }
    // Leaving crop mode applies the in-progress crop before anything else.
    if (this.activeMode === "crop" && mode !== "crop") this.exitCropMode();
    this.activeMode = mode;
    if (mode === "eraser") {
      // Eraser mode: crosshair cursor, highlight the toggle button
      this.canvas.style.cursor = "crosshair";
      if (this.btnEraserToggle) {
        this.btnEraserToggle.classList.add("pxf-btn-accent");
        this.btnEraserToggle.innerText = "Disable  [E]";
      }
      if (this.btnCropToggle) {
        this.btnCropToggle.classList.remove("pxf-btn-accent");
        this.btnCropToggle.innerText = "Enable  [C]";
      }
      if (this.selectedLayerIds.size === 1) this.setupEraserOnSelection();
      if (this._layout)
        this._layout.setStatus(
          "Eraser mode \u00b7 Drag to erase \u00b7 [ / ] resize \u00b7 E to toggle off",
        );
    } else if (mode === "crop") {
      // enterCropMode may bail (placeholder / no image) and reset activeMode.
      if (this.selectedLayerIds.size === 1) this.enterCropMode();
      if (this.activeMode === "crop") {
        // Crop mode active: crosshair cursor, highlight the toggle button.
        this.canvas.style.cursor = "crosshair";
        if (this.btnCropToggle) {
          this.btnCropToggle.classList.add("pxf-btn-accent");
          this.btnCropToggle.innerText = "Done  [C]";
        }
        if (this.btnEraserToggle) {
          this.btnEraserToggle.classList.remove("pxf-btn-accent");
          this.btnEraserToggle.innerText = "Enable  [E]";
        }
        if (this._layout)
          this._layout.setStatus(
            "Crop mode \u00b7 Drag the box / handles \u00b7 Shift = lock aspect \u00b7 C to apply",
          );
      } else {
        // Bailed \u2014 fall back to select-mode visuals.
        this.canvas.style.cursor = "default";
        if (this.btnCropToggle) {
          this.btnCropToggle.classList.remove("pxf-btn-accent");
          this.btnCropToggle.innerText = "Enable  [C]";
        }
      }
    } else {
      // Select mode: default cursor, reset toggle buttons
      this.canvas.style.cursor = "default";
      if (this.btnEraserToggle) {
        this.btnEraserToggle.classList.remove("pxf-btn-accent");
        this.btnEraserToggle.innerText = "Enable  [E]";
      }
      if (this.btnCropToggle) {
        this.btnCropToggle.classList.remove("pxf-btn-accent");
        this.btnCropToggle.innerText = "Enable  [C]";
      }
      // Context-aware tooltip on returning to select mode
      if (this._layout) {
        if (this.layers.length === 0) {
          this._layout.setStatus(
            "Add an image to get started \u2014 click Add Image or drag & drop",
          );
        } else if (this.selectedLayerIds.size === 0) {
          this._layout.setStatus(
            "Click to select \u00b7 Shift+Click multi-select \u00b7 Alt+Drag duplicate \u00b7 Space+Drag pan \u00b7 Scroll zoom",
          );
        } else if (this.selectedLayerIds.size === 1) {
          this._layout.setStatus(
            "Click to select \u00b7 Shift+Click multi-select \u00b7 Alt+Drag duplicate \u00b7 Drag corners to resize",
          );
        } else {
          this._layout.setStatus(
            "Multiple layers selected \u00b7 Use Align tools \u00b7 Ctrl+A select all \u00b7 Delete to remove",
          );
        }
      }
    }
    this.verifySelection();
    this.draw();
  }

  verifySelection() {
    const validIds = new Set(this.layers.map((l) => l.id));
    for (let id of this.selectedLayerIds) {
      if (!validIds.has(id)) this.selectedLayerIds.delete(id);
    }
    this.syncActiveLayerIndex();
  }

  syncActiveLayerIndex() {
    if (this.selectedLayerIds.size === 1) {
      const id = this.selectedLayerIds.values().next().value;
      this.activeLayerIndex = this.layers.findIndex((l) => l.id === id);
      this._cachedActiveLayer = this.activeLayerIndex >= 0 ? this.layers[this.activeLayerIndex] : null;
    } else {
      this.activeLayerIndex = -1;
      this._cachedActiveLayer = null;
    }
  }

  // Fast path: returns the single selected layer (or null)
  getActiveLayer() {
    if (this.selectedLayerIds.size !== 1) return null;
    if (this._cachedActiveLayer && this.selectedLayerIds.has(this._cachedActiveLayer.id)) {
      return this._cachedActiveLayer;
    }
    // Cache miss — rebuild
    const id = this.selectedLayerIds.values().next().value;
    this._cachedActiveLayer = this.layers.find((l) => l.id === id) || null;
    return this._cachedActiveLayer;
  }

  updateViewTransform() {
    this.canvasContainer.style.transform = `translate(calc(-50% + ${this.viewPanX}px), calc(-50% + ${this.viewPanY}px)) scale(${this.viewZoom})`;
    if (this._dimLabel) {
      const inv = 1 / this.viewZoom;
      this._dimLabel.style.transform = `scale(${inv})`;
      this._dimLabel.style.bottom = `${-18 * inv}px`;
    }
  }

  fitViewToWorkspace() {
    const rect = this.workspace.getBoundingClientRect();
    if (rect.width === 0) return;
    const scaleX = (rect.width - 80) / this.docWidth;
    const scaleY = (rect.height - 80) / this.docHeight;
    this.viewZoom = Math.min(scaleX, scaleY);
    this.viewPanX = 0;
    this.viewPanY = 0;
    this.updateViewTransform();
  }

  applyToSelection(actionFn) {
    let changed = false;
    this.layers.forEach((layer) => {
      if (this.selectedLayerIds.has(layer.id) && !layer.locked) {
        actionFn(layer);
        changed = true;
      }
    });
    if (changed) {
      this.ui.updateActiveLayerUI();
      this.draw();
      // Text layers: re-bake the bitmap crisp at its new size (fold scale into
      // font size), matching the canvas handles + sliders. Returns true if it
      // handled the history commit; otherwise commit normally.
      if (!this._commitTextScaleFold()) this.pushHistory();
    }
  }

  // Create a Photoshop-style FX/adjustment layer on top of the stack. It has no
  // image; it grades every layer beneath it at render time (see render.mjs +
  // node_composition.py). opacity doubles as the effect Amount.
  addFxLayer() {
    const id = "fx_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const layer = {
      id,
      name: "Color Grade",
      isAdjustment: true,
      adjustments: { ...NEUTRAL },
      presetId: "Original",
      visible: true,
      opacity: 1, // = Amount
      locked: false,
    };
    this.layers.push(layer);
    this.selectedLayerIds = new Set([id]);
    this.syncActiveLayerIndex();
    this.ui.updateActiveLayerUI();
    this.draw();
    this.pushHistory();
  }

  // Create an editable text layer on top of the stack. Its rendered-text bitmap
  // lives in layer.img so it reuses the whole image-layer pipeline (move/scale/
  // rotate/blend/save). textState holds the content + style.
  async addTextLayer() {
    const id = "txt_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const layer = {
      id,
      name: "Text",
      isText: true,
      textState: { ...DEFAULT_TEXT_STATE },
      img: null,
      cx: this.canvas.width / 2,
      cy: this.canvas.height / 2,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      flippedX: false,
      flippedY: false,
      blendMode: "Normal",
      blur: 0,
      rawB64_internal: null,
      rawServerPath: null,
      savedOnServer: false,
      savedMaskPath_internal: null,
      cropRect: null,
    };
    this.layers.push(layer);
    this.selectedLayerIds = new Set([id]);
    this.syncActiveLayerIndex();
    await this.rebuildTextLayer(layer);
    this.ui.updateActiveLayerUI();
    this.draw();
    this.pushHistory();
  }

  // (Re)render a text layer's bitmap from its textState into layer.img and mark
  // it for re-upload. Keeps cx/cy (center) so the text never jumps when resized.
  async rebuildTextLayer(layer) {
    if (!layer || !layer.isText) return;
    const canvas = await renderTextToCanvas(layer.textState);
    if (!this.layers.includes(layer)) return; // deleted mid-await
    layer.img = canvas;
    layer.rawB64_internal = canvas.toDataURL("image/png");
    layer.savedOnServer = false;
    layer.rawServerPath = null;
  }

  getCanvasCoordinates(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height),
    };
  }

  getCoordinatesInLayerImage(layer, mainX, mainY) {
    const dx = mainX - layer.cx;
    const dy = mainY - layer.cy;
    const rad = (-layer.rotation * Math.PI) / 180;
    const rotatedX = dx * Math.cos(rad) - dy * Math.sin(rad);
    const rotatedY = dx * Math.sin(rad) + dy * Math.cos(rad);
    const flippedX = rotatedX * (layer.flippedX ? -1 : 1);
    const flippedY = rotatedY * (layer.flippedY ? -1 : 1);
    const scaledX = flippedX / layer.scaleX;
    const scaledY = flippedY / layer.scaleY;
    return {
      lx: scaledX + layer.img.width / 2,
      ly: scaledY + layer.img.height / 2,
    };
  }

  captureState() {
    return PixaromaLayers.captureState(this.layers);
  }

  // Is this editor's fullscreen overlay still in the DOM? Used by the
  // self-healing graph patches to detect a teardown that bypassed cleanup
  // (Vue Compat #2).
  _overlayAlive() {
    return !!(this.overlay && this.overlay.isConnected);
  }

  // Vue Compat #6: neuter the Ctrl+Z escape. ComfyUI's change-tracker undo runs
  // via requestAnimationFrame and reaches the graph through app.loadGraphData ->
  // app.graph.configure; preventDefault on the keydown does NOT stop it. While
  // the editor is open we no-op both so Ctrl+Z can only drive the editor's own
  // undo, never tear down the workflow underneath. The patches SELF-HEAL: if
  // they are ever called while our overlay is gone (tab closed mid-edit, etc),
  // they restore the originals and pass through - otherwise loadGraphData would
  // stay disabled forever and brick the whole UI until a page refresh.
  _installGraphPatches() {
    const app = window.app;
    if (!app || !app.graph) return;
    // REFCOUNTED across all open Composer editors. Two Composer nodes can both
    // have an editor open; the patch must stay installed (Ctrl+Z blocked) until
    // EVERY overlay is gone, so closing one editor never un-blocks another.
    if (!app._pixComposerEditors) app._pixComposerEditors = new Set();
    app._pixComposerEditors.add(this);

    // Install the wrapper exactly ONCE, capturing the REAL originals. The guard
    // flag prevents a second editor from saving the no-op wrapper as "original".
    if (app._pixComposerPatchInstalled) return;
    app._pixComposerOrigLoad = app.loadGraphData.bind(app);
    app._pixComposerOrigConfigure = app.graph.configure.bind(app.graph);
    app._pixComposerPatchInstalled = true;

    const anyOverlayAlive = () => {
      if (!app._pixComposerEditors) return false;
      for (const ed of app._pixComposerEditors) {
        try { if (ed._overlayAlive && ed._overlayAlive()) return true; } catch {}
      }
      return false;
    };
    // SELF-HEAL: if called while NO overlay is alive (all editors torn down
    // without cleanup, e.g. tab closed mid-edit), restore the originals + clear
    // state so loadGraphData/configure can never stay bricked. Returns the
    // originals captured before clearing so the call still passes through.
    const heal = () => {
      const ol = app._pixComposerOrigLoad, oc = app._pixComposerOrigConfigure;
      if (ol) app.loadGraphData = ol;
      if (app.graph && oc) app.graph.configure = oc;
      app._pixComposerOrigLoad = null;
      app._pixComposerOrigConfigure = null;
      app._pixComposerPatchInstalled = false;
      if (app._pixComposerEditors) app._pixComposerEditors.clear();
      return { ol, oc };
    };
    app.loadGraphData = function (...args) {
      if (anyOverlayAlive()) return Promise.resolve();
      const { ol } = heal();
      return (ol || window.app.loadGraphData)(...args);
    };
    app.graph.configure = function (...args) {
      if (anyOverlayAlive()) return undefined;
      const { oc } = heal();
      return oc ? oc(...args) : window.app.graph.configure(...args);
    };
  }

  // Drop THIS editor from the live set. Only truly restore the originals when NO
  // Composer overlay remains alive (closing one of two open editors keeps the
  // block intact for the other). Idempotent; safe from cleanup AND self-heal.
  _restoreGraphPatches() {
    const app = window.app;
    if (!app) return;
    if (app._pixComposerEditors) app._pixComposerEditors.delete(this);
    const stillAlive =
      app._pixComposerEditors &&
      [...app._pixComposerEditors].some((ed) => {
        try { return ed._overlayAlive && ed._overlayAlive(); } catch { return false; }
      });
    if (stillAlive) return; // another editor is still open — keep the patch
    if (app._pixComposerOrigLoad) {
      app.loadGraphData = app._pixComposerOrigLoad;
      app._pixComposerOrigLoad = null;
    }
    if (app.graph && app._pixComposerOrigConfigure) {
      app.graph.configure = app._pixComposerOrigConfigure;
      app._pixComposerOrigConfigure = null;
    }
    app._pixComposerPatchInstalled = false;
    if (app._pixComposerEditors) app._pixComposerEditors.clear();
  }
}
