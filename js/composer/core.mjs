import { PixaromaUI } from "./ui.mjs";
import { PixaromaLayers } from "./layers.mjs";
import { installFocusTrap } from "../shared/index.mjs";

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
    this.attemptRestore();
  }

  setMode(mode) {
    this.activeMode = mode;
    if (mode === "eraser") {
      // Eraser mode: crosshair cursor, highlight the toggle button
      this.canvas.style.cursor = "crosshair";
      if (this.btnEraserToggle) {
        this.btnEraserToggle.classList.add("pxf-btn-accent");
        this.btnEraserToggle.innerText = "Disable  [E]";
      }
      if (this.selectedLayerIds.size === 1) this.setupEraserOnSelection();
      if (this._layout)
        this._layout.setStatus(
          "Eraser mode \u00b7 Drag to erase \u00b7 [ / ] resize \u00b7 E to toggle off",
        );
    } else {
      // Select mode: default cursor, reset toggle button
      this.canvas.style.cursor = "default";
      if (this.btnEraserToggle) {
        this.btnEraserToggle.classList.remove("pxf-btn-accent");
        this.btnEraserToggle.innerText = "Enable  [E]";
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
      const id = Array.from(this.selectedLayerIds)[0];
      this.activeLayerIndex = this.layers.findIndex((l) => l.id === id);
    } else {
      this.activeLayerIndex = -1;
    }
  }

  updateViewTransform() {
    this.canvasContainer.style.transform = `translate(calc(-50% + ${this.viewPanX}px), calc(-50% + ${this.viewPanY}px)) scale(${this.viewZoom})`;
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
      this.pushHistory();
    }
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
}
