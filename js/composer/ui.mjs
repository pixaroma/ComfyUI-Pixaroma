import { app } from "../../../../scripts/app.js";
import {
  createEditorLayout,
  createPanel,
  createButton,
  createSliderRow,
  createDivider,
  createCanvasSettings,
  createLayerPanel,
  createLayerItem,
  createCanvasToolbar,
  createTransformPanel,
  createSelectInput,
  createRow,
} from "../framework/index.mjs";
// PixaromaAPI is used below to query rembg install status when the
// AI Background Removal panel builds. Without this import the whole
// right sidebar fails to build and the editor won't open.
import { PixaromaAPI } from "./api.mjs";

// Legacy values that predate the multi-model dropdown — remapped to
// whatever the modern dropdown calls the same quality tier, so an
// older saved layer doesn't make the <select> go blank on restore.
const _LEGACY_BG_QUALITY_MAP = {
  normal: "isnet-general-use",
  high: "birefnet-general",
};

// Safely set the bg-quality dropdown's value. If the stored value
// doesn't match any current option (legacy save, or the picked model
// was greyed out by rembg version check), fall back to "auto" so the
// select never shows empty.
function _applyBgQualityToSelect(selectEl, stored) {
  if (!selectEl) return;
  let v = stored || "auto";
  if (_LEGACY_BG_QUALITY_MAP[v]) v = _LEGACY_BG_QUALITY_MAP[v];
  const hasOption = Array.from(selectEl.options).some(
    (o) => o.value === v && !o.disabled,
  );
  selectEl.value = hasOption ? v : "auto";
}

// ─── Editor-specific CSS (layer items, eraser, etc.) ────────
const COMPOSER_STYLE_ID = "pixaroma-composer-styles";
function injectComposerStyles() {
  if (document.getElementById(COMPOSER_STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = COMPOSER_STYLE_ID;
  s.textContent = `
        /* Layer styles now provided by the editor framework (pxf-layer-*) */
        .pix-canvas-container { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(1); transform-origin: center center; box-shadow: 0 10px 50px rgba(0,0,0,0.8); }
        .pix-canvas { width: 100%; height: 100%; display: block; background-color: #1e1e1e; position: relative; z-index: 1; }
        /* align bar now in titlebar center */
        /* zoom controls now provided by editor framework */
        .pix-view-btn { background: transparent; border: none; color: white; cursor: pointer; font-size: 16px; padding: 5px 10px; border-radius: 4px; transition: 0.2s; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 5px; }
        .pix-view-btn:hover { background: #3a3d40; color: #f66744; }
        .pix-view-btn:disabled { opacity: 0.3 !important; cursor: not-allowed; }
        .pxf-workspace.panning, .pxf-workspace.panning * { cursor: grabbing !important; }
    `;
  document.head.appendChild(s);
}

export class PixaromaUI {
  constructor(core) {
    this.core = core;
  }

  updateHistoryUI() {
    const core = this.core;
    if (core._layout && core._layout.undoBtn)
      core._layout.undoBtn.disabled = !(core.historyIndex > 0);
    if (core._layout && core._layout.redoBtn)
      core._layout.redoBtn.disabled = !(
        core.historyIndex <
        core.history.length - 1
      );
  }

  updateActiveLayerUI() {
    const core = this.core;

    // Context-aware tooltips based on current state
    if (core._layout && core.activeMode !== "eraser") {
      if (core.layers.length === 0) {
        core._layout.setStatus(
          "Add an image to get started \u2014 click Add Image or drag & drop",
        );
      } else if (core.selectedLayerIds.size === 0) {
        core._layout.setStatus(
          "Click to select \u00b7 Shift+Click multi-select \u00b7 Alt+Drag duplicate \u00b7 Space+Drag pan \u00b7 Scroll zoom",
        );
      } else if (core.selectedLayerIds.size === 1) {
        core._layout.setStatus(
          "Click to select \u00b7 Shift+Click multi-select \u00b7 Alt+Drag duplicate \u00b7 Drag corners to resize",
        );
      } else {
        core._layout.setStatus(
          "Multiple layers selected \u00b7 Use Align tools \u00b7 Ctrl+A select all \u00b7 Delete to remove",
        );
      }
    }

    // --- Align bar: only usable with multi-selection ---
    const alignBtns =
      core._layout?.titlebarCenter?.querySelectorAll(".pxf-btn-sm") || [];
    if (core.selectedLayerIds.size > 1) {
      alignBtns.forEach((btn) => {
        btn.disabled = false;
      });
      if (core._layout?.titlebarCenter)
        core._layout.titlebarCenter.style.opacity = "1";
    } else {
      alignBtns.forEach((btn) => {
        btn.disabled = true;
      });
      if (core._layout?.titlebarCenter)
        core._layout.titlebarCenter.style.opacity = "0.3";
    }

    if (core.selectedLayerIds.size === 0) {
      // Dim all selection-dependent panels
      core.toolsPanel.style.opacity = "0.3";
      core.toolsPanel.style.pointerEvents = "none";
      core.btnDelLayer.style.opacity = "0.3";
      core.btnDupLayer.style.opacity = "0.3";
      core.removeBgBtn.style.opacity = "0.3";
      core.removeBgBtn.style.pointerEvents = "none";
      if (core._phFillRow) core._phFillRow.style.display = "none";
      if (core._phPreviewBtn) core._phPreviewBtn.style.display = "none";
      if (core._convertPhBtn) {
        core._convertPhBtn.style.opacity = "0.3";
        core._convertPhBtn.style.pointerEvents = "none";
      }
      if (core._autoBgRow) {
        core._autoBgRow.style.opacity = "0.3";
        core._autoBgRow.style.pointerEvents = "none";
      }

      // Dim eraser panel and force eraser off
      if (core.eraserPanel) {
        core.eraserPanel.style.opacity = "0.3";
        core.eraserPanel.style.pointerEvents = "none";
      }
      if (core.activeMode === "eraser") core.setMode(null);
    } else {
      core.toolsPanel.style.opacity = "1";
      core.toolsPanel.style.pointerEvents = "auto";
      core.btnDelLayer.style.opacity = "1";
      core.btnDupLayer.style.opacity = "1";
      core.removeBgBtn.style.opacity = "1";
      core.removeBgBtn.style.pointerEvents = "auto";

      if (core.eraserPanel) {
        core.eraserPanel.style.opacity = "1";
        core.eraserPanel.style.pointerEvents = "auto";
      }

      // Eraser requires exactly one layer selected
      if (core.selectedLayerIds.size > 1 && core.activeMode === "eraser") {
        core.setMode(null);
        if (core._layout)
          core._layout.setStatus(
            "Eraser requires a single layer selected",
            "warn",
          );
      }

      // Sync transform sliders to the first selected layer
      const layer = core.getActiveLayer();
      if (layer) {
        if (core._layerPanel && core._layerPanel.setBlend)
          core._layerPanel.setBlend(layer.blendMode || "Normal");
        core.opacitySlider.value = Math.round(layer.opacity * 100);
        core.opacityNum.value = Math.round(layer.opacity * 100);
        core.blurSlider.value = layer.blur || 0;
        core.blurNum.value = layer.blur || 0;
        core.rotateSlider.value = layer.rotation;
        core.rotateNum.value = layer.rotation;
        core.scaleSlider.value = Math.round(layer.scaleX * 100);
        core.scaleNum.value = Math.round(layer.scaleX * 100);
        core.stretchHSlider.value = Math.round(layer.scaleX * 100);
        core.stretchHNum.value = Math.round(layer.scaleX * 100);
        core.stretchVSlider.value = Math.round(layer.scaleY * 100);
        core.stretchVNum.value = Math.round(layer.scaleY * 100);

        // Reset Mask button: enabled when ANY selected layer has a mask
        if (core.btnResetEraser) {
          const anyMask = [...core.selectedLayerIds].some((id) => {
            const l = core.layers.find((ly) => ly.id === id);
            return l && l.hasMask_internal;
          });
          core.btnResetEraser.style.opacity = anyMask ? "1" : "0.3";
          core.btnResetEraser.disabled = !anyMask;
        }

        // Show/hide placeholder fill mode, ratio, preview, convert button
        if (layer.isPlaceholder) {
          if (core._phFillRow) core._phFillRow.style.display = "";
          if (core._phFillSelect)
            core._phFillSelect.value = layer.fillMode || "cover";
          if (core._phRatioRow) core._phRatioRow.style.display = "";
          if (core._phRatioSelect)
            core._phRatioSelect.value = layer.phRatio || "canvas";
          const connected = core.isPlaceholderConnected(layer);
          if (core._phPreviewBtn) {
            core._phPreviewBtn.style.display = "";
            core._phPreviewBtn.disabled = !connected;
            core._phPreviewBtn.style.opacity = connected ? "1" : "0.3";
          }
          if (core._convertPhBtn) {
            core._convertPhBtn.style.opacity = "0.3";
            core._convertPhBtn.style.pointerEvents = "none";
          }
          if (core._autoBgRow) {
            core._autoBgRow.style.opacity = "1";
            core._autoBgRow.style.pointerEvents = "auto";
            core._autoBgCheck.checked = !!layer.removeBgOnExec;
          }
          _applyBgQualityToSelect(core._bgQualitySelect, layer.bgRemovalQuality);
        } else {
          if (core._phFillRow) core._phFillRow.style.display = "none";
          if (core._phRatioRow) core._phRatioRow.style.display = "none";
          if (core._phPreviewBtn) core._phPreviewBtn.style.display = "none";
          if (core._convertPhBtn) {
            core._convertPhBtn.style.opacity = "1";
            core._convertPhBtn.style.pointerEvents = "auto";
          }
          if (core._autoBgRow) {
            core._autoBgRow.style.opacity = "1";
            core._autoBgRow.style.pointerEvents = "auto";
            core._autoBgCheck.checked = !!layer.removeBgOnExec;
          }
          _applyBgQualityToSelect(core._bgQualitySelect, layer.bgRemovalQuality);
        }
      }
    }
    this.refreshLayersPanel();
  }

  refreshLayersPanel() {
    const core = this.core;
    // Reuse a single offscreen canvas for thumbnail generation
    if (!this._thumbCanvas) {
      this._thumbCanvas = document.createElement("canvas");
      this._thumbCanvas.width = 26;
      this._thumbCanvas.height = 26;
      this._thumbCtx = this._thumbCanvas.getContext("2d");
    }
    const firstSelectedId = core.selectedLayerIds.size > 0
      ? core.selectedLayerIds.values().next().value : null;
    // Display layers top-to-bottom (reversed from array order, since last = top)
    const items = [...core.layers].reverse().map((layer) => {
      const isSelected = core.selectedLayerIds.has(layer.id);
      const isFirst = layer.id === firstSelectedId;

      // Build thumbnail: draw into shared canvas, then copy to a per-item canvas
      const tCvs = document.createElement("canvas");
      tCvs.width = 26;
      tCvs.height = 26;
      if (layer.img) {
        this._thumbCtx.clearRect(0, 0, 26, 26);
        const iw = layer.img.naturalWidth || layer.img.width;
        const ih = layer.img.naturalHeight || layer.img.height;
        if (iw && ih) {
          const scale = Math.min(26 / iw, 26 / ih);
          const dw = iw * scale,
            dh = ih * scale;
          this._thumbCtx.drawImage(layer.img, (26 - dw) / 2, (26 - dh) / 2, dw, dh);
          tCvs.getContext("2d").drawImage(this._thumbCanvas, 0, 0);
        }
      }

      const layerItem = createLayerItem({
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        active: isFirst,
        multiSelected: isSelected && !isFirst,
        thumbnail: tCvs,
        onVisibilityToggle: () => {
          layer.visible = !layer.visible;
          core.pushHistory();
          core.draw();
          this.refreshLayersPanel();
        },
        onLockToggle: () => {
          layer.locked = !layer.locked;
          core.pushHistory();
          core.draw();
          this.refreshLayersPanel();
        },
        onClick: (e) => {
          if (e.detail > 1) return;
          if (e.shiftKey || e.ctrlKey || e.metaKey) {
            if (core.selectedLayerIds.has(layer.id))
              core.selectedLayerIds.delete(layer.id);
            else core.selectedLayerIds.add(layer.id);
          } else {
            core.selectedLayerIds.clear();
            core.selectedLayerIds.add(layer.id);
          }
          core.syncActiveLayerIndex();
          this.updateActiveLayerUI();
          core.draw();
        },
        onRename: (newName) => {
          layer.name = newName;
          core.pushHistory();
        },
      });

      return layerItem.el;
    });
    core._layerPanel.refresh(items);
  }

  moveLayer(dir) {
    const core = this.core;
    if (core.selectedLayerIds.size === 0) return;
    const firstId = Array.from(core.selectedLayerIds)[0];
    const idx = core.layers.findIndex((l) => l.id === firstId);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= core.layers.length) return;
    [core.layers[idx], core.layers[newIdx]] = [
      core.layers[newIdx],
      core.layers[idx],
    ];
    core.pushHistory();
    core.syncActiveLayerIndex();
    this.updateActiveLayerUI();
    core.draw();
  }

  build() {
    const core = this.core;
    const existingEditor = document.getElementById("pixaroma-editor-instance");
    if (existingEditor) existingEditor.remove();

    injectComposerStyles();

    // ─── Create layout via framework ────────────────────────
    const layout = createEditorLayout({
      editorName: "Image Composer",
      editorId: "pixaroma-editor-instance",
      showUndoRedo: true,
      showStatusBar: false,
      showZoomBar: true,
      onSave: () => core.saveBtn?.click(),
      onClose: () => {
        if (core._cleanupKeys) core._cleanupKeys();
        core._layout.unmount();
        if (core.onClose) core.onClose();
        if (app.graph) app.graph.setDirtyCanvas(true, true);
      },
      onUndo: () => core.undo(),
      onRedo: () => core.redo(),
      onZoomIn: () => {
        core.viewZoom *= 1.2;
        core.updateViewTransform();
        layout.setZoomLabel(Math.round(core.viewZoom * 100) + "%");
      },
      onZoomOut: () => {
        core.viewZoom *= 0.8;
        core.updateViewTransform();
        layout.setZoomLabel(Math.round(core.viewZoom * 100) + "%");
      },
      onZoomFit: () => {
        core.fitViewToWorkspace();
        layout.setZoomLabel(Math.round(core.viewZoom * 100) + "%");
      },
      helpContent: `
<div class="pxf-help-section">
  <h4>Canvas Navigation</h4>
  <div class="pxf-help-grid">
    <b>Space+drag</b><span>Pan the canvas</span>
    <b>Middle-click</b><span>Pan the canvas</span>
    <b>Scroll wheel</b><span>Zoom in / out at cursor</span>
  </div>
</div>
<div class="pxf-help-section">
  <h4>Selection</h4>
  <div class="pxf-help-grid">
    <b>Click</b><span>Select a layer (canvas or panel)</span>
    <b>Shift+click</b><span>Add / remove from multi-selection</span>
    <b>Ctrl+click</b><span>Add / remove from multi-selection</span>
    <b>Alt+drag</b><span>Duplicate the layer while moving</span>
  </div>
</div>
<div class="pxf-help-section">
  <h4>Transform</h4>
  <div class="pxf-help-grid">
    <b>Drag layer</b><span>Move</span>
    <b>Drag corners</b><span>Scale uniformly</span>
    <b>Drag edges</b><span>Scale single axis</span>
    <b>Drag outside</b><span>Rotate (Shift = snap 15°)</span>
  </div>
</div>
<div class="pxf-help-section">
  <h4>Align &amp; Distribute</h4>
  <div class="pxf-help-grid">
    <b>2+ layers</b><span>Enables Align buttons in the titlebar</span>
    <b>3+ layers</b><span>Enables Distribute buttons</span>
  </div>
</div>
<div class="pxf-help-section">
  <h4>Eraser</h4>
  <div class="pxf-help-grid">
    <b>E</b><span>Toggle eraser on / off</span>
    <b>V</b><span>Return to select mode</span>
    <b>Enable Eraser</b><span>Select a layer first, then click the button</span>
    <b>Reset Mask</b><span>Restore the layer's original pixels</span>
  </div>
</div>
<div class="pxf-help-section">
  <h4>Layers Panel</h4>
  <div class="pxf-help-grid">
    <b>Click</b><span>Select layer</span>
    <b>Ctrl+click</b><span>Multi-select</span>
    <b>Double-click</b><span>Rename layer</span>
    <b>Drag</b><span>Reorder layers</span>
    <b>▲ / ▼</b><span>Move layer up / down</span>
  </div>
</div>
<div class="pxf-help-section">
  <h4>General</h4>
  <div class="pxf-help-grid">
    <b>Ctrl+Z</b><span>Undo</span>
    <b>Ctrl+Y</b><span>Redo</span>
    <b>Delete</b><span>Remove selected layer(s)</span>
    <b>Ctrl+S</b><span>Save</span>
  </div>
</div>`,
    });

    core._layout = layout;
    layout.onSaveToDisk = () => {
      core._diskSavePending = true;
      core.saveBtn?.click();
    };
    layout.onCleanup = () => {
      if (core._cleanupKeys) core._cleanupKeys();
    };
    core.overlay = layout.overlay;
    core.overlay.addEventListener("contextmenu", (e) => e.preventDefault());

    // =====================================================================
    // LEFT SIDEBAR
    // =====================================================================

    // --- 1. Canvas Settings (FIRST panel -- unified ratio/size component) ---
    core._canvasSettings = createCanvasSettings({
      width: core.docWidth,
      height: core.docHeight,
      ratioIndex: 0,
      startCollapsed: false,
      onChange: ({ width, height, ratioIndex }) => {
        core.docWidth = width;
        core.docHeight = height;
        core.canvasContainer.style.width = core.docWidth + "px";
        core.canvasContainer.style.height = core.docHeight + "px";
        core.canvas.width = core.docWidth;
        core.canvas.height = core.docHeight;
        if (core.selCanvas) {
          core.selCanvas.width = width + 2 * core.selPad;
          core.selCanvas.height = height + 2 * core.selPad;
        }
        if (core.selHitArea) {
          core.selHitArea.style.width = width + 2 * core.selPad + "px";
          core.selHitArea.style.height = height + 2 * core.selPad + "px";
        }
        if (core._dimLabel)
          core._dimLabel.textContent = `${core.docWidth}\u00d7${core.docHeight}`;
        core.fitViewToWorkspace();
        core.draw();
        core.pushHistory();
      },
    });
    layout.leftSidebar.appendChild(core._canvasSettings.el);

    // --- 2. Images panel (Add Image + Convert to Placeholder) ---
    const _onAddImage = (file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = async () => {
          const { PixaromaLayers } = await import("./layers.mjs");

          // Auto-size canvas to the image on an empty composer so users don't
          // have to manually match dimensions before composing.
          const isFirstImage = core.layers.length === 0;
          if (isFirstImage) {
            const newW = Math.max(64, Math.min(8192, img.width));
            const newH = Math.max(64, Math.min(8192, img.height));
            core.docWidth = newW;
            core.docHeight = newH;
            core.canvas.width = newW;
            core.canvas.height = newH;
            if (core.selCanvas) {
              core.selCanvas.width = newW + 2 * core.selPad;
              core.selCanvas.height = newH + 2 * core.selPad;
            }
            if (core.selHitArea) {
              core.selHitArea.style.width = newW + 2 * core.selPad + "px";
              core.selHitArea.style.height = newH + 2 * core.selPad + "px";
            }
            if (core._dimLabel)
              core._dimLabel.textContent = `${newW}\u00d7${newH}`;
            if (core._canvasSettings) {
              core._canvasSettings.setSize(newW, newH);
              core._canvasSettings.setRatio(0);
            }
          }

          const layerObj = {
            id: Date.now().toString(),
            name: `Layer ${core.layers.length + 1} (${file.name})`,
            img: img,
            cx: core.docWidth / 2,
            cy: core.docHeight / 2,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
            flippedX: false,
            flippedY: false,
            rawB64_internal: event.target.result,
            rawServerPath: "",
            savedOnServer: false,
          };
          PixaromaLayers.fitLayerToCanvas(
            layerObj,
            core.docWidth,
            core.docHeight,
            "width",
          );
          core.layers.push(layerObj);
          core.selectedLayerIds.clear();
          core.selectedLayerIds.add(layerObj.id);
          core.syncActiveLayerIndex();
          this.updateActiveLayerUI();
          if (isFirstImage) core.fitViewToWorkspace();
          core.draw();
          core.pushHistory();
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    };

    // Hidden canvas toolbar for file input + drop zone + paste handling
    this._canvasToolbar = createCanvasToolbar({
      onAddImage: _onAddImage,
      showBgColor: false,
      showClear: false,
      showReset: false,
    });
    this._canvasToolbar.el.style.display = "none";
    layout.leftSidebar.appendChild(this._canvasToolbar.el);

    core.uploadBtn = this._canvasToolbar.fileInput;

    const imagesPanel = createPanel("Images", {
      collapsible: true,
      collapsed: false,
    });

    const addImgBtn = createButton("Add Image", { variant: "full" });
    addImgBtn.title = "Browse for an image file";
    addImgBtn.onclick = () => this._canvasToolbar.fileInput.click();
    imagesPanel.content.appendChild(addImgBtn);

    const convertPhBtn = createButton("Convert to Placeholder", {
      variant: "full",
    });
    convertPhBtn.title = "Convert the selected layer to a placeholder input";
    convertPhBtn.style.marginTop = "4px";
    convertPhBtn.style.opacity = "0.3";
    convertPhBtn.style.pointerEvents = "none";
    convertPhBtn.onclick = () => {
      const firstId = Array.from(core.selectedLayerIds)[0];
      if (firstId) core.convertLayerToPlaceholder(firstId);
    };
    core._convertPhBtn = convertPhBtn;
    imagesPanel.content.appendChild(convertPhBtn);

    layout.leftSidebar.appendChild(imagesPanel.el);

    // --- BG Color + Clear/Reset in Canvas Settings ---
    const canvasActionsRow = document.createElement("div");
    canvasActionsRow.className = "pxf-canvas-toolbar-row";
    canvasActionsRow.style.cssText = "margin-top:6px;";

    const bgLabel = document.createElement("span");
    bgLabel.style.cssText = "font-size:10px;color:#888;flex-shrink:0;";
    bgLabel.textContent = "BG:";
    const bgColorInput = document.createElement("input");
    bgColorInput.type = "color";
    bgColorInput.value = "#1e1e1e";
    bgColorInput.className = "pxf-color-input";
    bgColorInput.style.cssText = "width:36px;height:28px;flex-shrink:0;";
    bgColorInput.addEventListener("input", () => {
      core._bgColor = bgColorInput.value;
      core.draw();
    });
    this._bgColorInput = bgColorInput;

    const clearBtn = createButton("Clear Canvas", { variant: "full" });
    clearBtn.classList.add("pxf-btn-danger");
    clearBtn.style.flex = "1";
    clearBtn.onclick = () => {
      core.layers = [];
      core.selectedLayerIds.clear();
      core.syncActiveLayerIndex();
      this.updateActiveLayerUI();
      core.draw();
      core.pushHistory();
    };

    const resetBtn = createButton("Reset", { variant: "full" });
    resetBtn.classList.add("pxf-btn-danger");
    resetBtn.style.flex = "1";
    resetBtn.onclick = () => {
      core.pushHistory();
      core.layers = [];
      core.selectedLayerIds.clear();
      core.docWidth = 1024;
      core.docHeight = 1024;
      core.canvasContainer.style.width = "1024px";
      core.canvasContainer.style.height = "1024px";
      core.canvas.width = 1024;
      core.canvas.height = 1024;
      if (core.selCanvas) {
        core.selCanvas.width = 1024 + 2 * core.selPad;
        core.selCanvas.height = 1024 + 2 * core.selPad;
      }
      if (core.selHitArea) {
        core.selHitArea.style.width = 1024 + 2 * core.selPad + "px";
        core.selHitArea.style.height = 1024 + 2 * core.selPad + "px";
      }
      core._bgColor = "#1e1e1e";
      if (core._canvasSettings) core._canvasSettings.setSize(1024, 1024);
      if (core._canvasSettings) core._canvasSettings.setRatio(0);
      bgColorInput.value = "#1e1e1e";
      if (core._dimLabel) core._dimLabel.textContent = "1024\u00d71024";
      core.syncActiveLayerIndex();
      this.updateActiveLayerUI();
      core.draw();
      core.fitViewToWorkspace();
    };

    canvasActionsRow.append(bgLabel, bgColorInput, clearBtn, resetBtn);
    core._canvasSettings.el
      .querySelector(".pxf-panel-content")
      .appendChild(canvasActionsRow);

    const transpRow = document.createElement("label");
    transpRow.className = "pxf-check-row";
    transpRow.title = "Save to Disk with transparent background (no background color)";
    transpRow.style.cssText = "margin:4px 0 0 2px;font-size:11px;opacity:0.85;";
    const transpCb = document.createElement("input");
    transpCb.type = "checkbox";
    transpCb.addEventListener("change", () => { core._transparentBg = transpCb.checked; });
    transpRow.appendChild(transpCb);
    transpRow.append("Transparent BG (Save to Disk)");
    core._canvasSettings.el
      .querySelector(".pxf-panel-content")
      .appendChild(transpRow);

    // --- Placeholders panel (add, fill mode, preview) ---
    const phPanel = createPanel("Placeholders", {
      collapsible: true,
      collapsed: false,
    });

    const addPhBtn = createButton("Add Placeholder", { variant: "full" });
    addPhBtn.title =
      "Add a placeholder layer — connect an image input at workflow execution";
    addPhBtn.onclick = () => core.addPlaceholderLayer();
    phPanel.content.appendChild(addPhBtn);

    const ratioSelect = createSelectInput({
      options: [
        { value: "canvas", label: "Canvas ratio" },
        { value: "1:1",    label: "1:1 Square" },
        { value: "4:3",    label: "4:3" },
        { value: "3:4",    label: "3:4" },
        { value: "16:9",   label: "16:9 Wide" },
        { value: "9:16",   label: "9:16 Tall" },
        { value: "3:2",    label: "3:2" },
        { value: "2:3",    label: "2:3" },
        { value: "2:1",    label: "2:1" },
        { value: "1:2",    label: "1:2" },
        { value: "21:9",   label: "21:9 Ultra" },
      ],
      value: "canvas",
      onChange: (val) => {
        const firstId = Array.from(core.selectedLayerIds)[0];
        const layer = core.layers.find((l) => l.id === firstId);
        if (layer && layer.isPlaceholder) {
          core.changePlaceholderRatio(layer, val);
        }
      },
    });
    ratioSelect.style.width = "100%";
    const ratioRow = createRow("Ratio", ratioSelect);
    ratioRow.style.marginTop = "4px";
    ratioRow.style.display = "none";
    core._phRatioRow = ratioRow;
    core._phRatioSelect = ratioSelect;
    phPanel.content.appendChild(ratioRow);

    const fillSelect = createSelectInput({
      options: [
        { value: "cover", label: "Cover" },
        { value: "contain", label: "Contain" },
        { value: "fill", label: "Fill (stretch)" },
      ],
      value: "cover",
      onChange: (val) => {
        const firstId = Array.from(core.selectedLayerIds)[0];
        const layer = core.layers.find((l) => l.id === firstId);
        if (layer && layer.isPlaceholder) {
          layer.fillMode = val;
          core.pushHistory();
        }
      },
    });
    fillSelect.style.width = "100%";
    const fillRow = createRow("Fill Mode", fillSelect);
    fillRow.style.marginTop = "4px";
    fillRow.style.display = "none";
    core._phFillRow = fillRow;
    core._phFillSelect = fillSelect;
    phPanel.content.appendChild(fillRow);

    // Load Now button
    const previewBtn = createButton("Update Preview", { variant: "full" });
    previewBtn.title = "Load the connected image into the placeholder";
    previewBtn.style.marginTop = "4px";
    previewBtn.style.display = "none";
    previewBtn.onclick = () => {
      const firstId = Array.from(core.selectedLayerIds)[0];
      if (firstId) core.previewPlaceholderInput(firstId);
    };
    core._phPreviewBtn = previewBtn;
    phPanel.content.appendChild(previewBtn);

    core._phPanel = phPanel;
    layout.leftSidebar.appendChild(phPanel.el);

    // --- 3. Transform Properties (unified framework component) ---
    const tp = createTransformPanel({
      onReset: () => {},
      showRotateSlider: true,
      showScaleSlider: true,
      showStretchSliders: true,
      showOpacitySlider: true,
      showBlurSlider: true,
      onBlurChange: (val) => {
        for (const id of core.selectedLayerIds) {
          const layer = core.layers.find((l) => l.id === id);
          if (layer) layer.blur = val;
        }
        core.draw();
        core.pushHistory();
      },
      startCollapsed: false,
    });

    core.toolsPanel = tp.el;
    core.toolsPanel.style.opacity = "0.3";
    core.toolsPanel.style.pointerEvents = "none";

    core.btnFitW = tp.fitW;
    core.btnFitH = tp.fitH;
    core.btnFlipH = tp.flipH;
    core.btnFlipV = tp.flipV;
    core.btnRotLeft = tp.rotCCW;
    core.btnRotRight = tp.rotCW;
    core.btnReset = tp.resetBtn;

    core.rotateSlider = tp.rotateSlider;
    core.rotateNum = tp.rotateNum;
    core.scaleSlider = tp.scaleSlider;
    core.scaleNum = tp.scaleNum;
    core.stretchHSlider = tp.stretchHSlider;
    core.stretchHNum = tp.stretchHNum;
    core.stretchVSlider = tp.stretchVSlider;
    core.stretchVNum = tp.stretchVNum;
    core.opacitySlider = tp.opacitySlider;
    core.opacityNum = tp.opacityNum;
    core.blurSlider = tp.blurSlider;
    core.blurNum = tp.blurNum;

    layout.leftSidebar.appendChild(core.toolsPanel);

    // Status tooltip
    core.statusText = layout.statusText;
    layout.setStatus(
      "Add an image to get started \u2014 click Add Image or drag & drop",
    );

    // =====================================================================
    // WORKSPACE
    // =====================================================================
    core.workspace = layout.workspace;
    core.canvasContainer = document.createElement("div");
    core.canvasContainer.className = "pix-canvas-container";
    core.canvasContainer.style.width = core.docWidth + "px";
    core.canvasContainer.style.height = core.docHeight + "px";
    core.canvas = document.createElement("canvas");
    core.canvas.className = "pix-canvas";
    core.canvas.width = core.docWidth;
    core.canvas.height = core.docHeight;
    core.ctx = core.canvas.getContext("2d");
    core.canvasContainer.appendChild(core.canvas);

    // Selection overlay — extends beyond main canvas so resize border/handles stay visible outside bounds
    core.selPad = 500;
    // Hit-area div captures mouse events in the extended area (behind canvas, in front of workspace)
    core.selHitArea = document.createElement("div");
    core.selHitArea.className = "pix-sel-hitarea";
    core.selHitArea.style.cssText = `position:absolute;left:${-core.selPad}px;top:${-core.selPad}px;width:${core.docWidth + 2 * core.selPad}px;height:${core.docHeight + 2 * core.selPad}px;z-index:0;`;
    core.canvasContainer.insertBefore(core.selHitArea, core.canvas);
    // Overlay canvas renders selection UI (no pointer events — clicks go to hitarea/canvas)
    core.selCanvas = document.createElement("canvas");
    core.selCanvas.style.cssText = `position:absolute;left:${-core.selPad}px;top:${-core.selPad}px;pointer-events:none;z-index:2;`;
    core.selCanvas.width = core.docWidth + 2 * core.selPad;
    core.selCanvas.height = core.docHeight + 2 * core.selPad;
    core.selCtx = core.selCanvas.getContext("2d");
    core.canvasContainer.style.overflow = "visible";
    core.canvasContainer.appendChild(core.selCanvas);

    // Orange frame border + dimension label on the canvas container
    // Use box-shadow (not border) so the frame doesn't push the selection overlay off by 2px
    core.canvasContainer.style.boxShadow = "0 0 0 2px rgba(249,115,22,0.45)";
    const dimLabel = document.createElement("div");
    dimLabel.className = "pxf-canvas-frame-label";
    dimLabel.textContent = `${core.docWidth}\u00d7${core.docHeight}`;
    core.canvasContainer.appendChild(dimLabel);
    core._dimLabel = dimLabel;

    core.workspace.appendChild(core.canvasContainer);

    // Enable drag & drop on workspace
    if (this._canvasToolbar) this._canvasToolbar.setupDropZone(core.workspace);

    // Align bar (in titlebar center) -- using SVG icons
    const _ai = "/pixaroma/assets/icons/ui/";
    const alignBar = document.createElement("div");
    alignBar.style.cssText = "display:flex;align-items:center;gap:4px;";
    const alignBtns = [
      { id: "btnAlignL", icon: "align-left.svg", title: "Align Left" },
      { id: "btnAlignCH", icon: "align-center-h.svg", title: "Align Center H" },
      { id: "btnAlignR", icon: "align-right.svg", title: "Align Right" },
      null,
      { id: "btnAlignT", icon: "align-top.svg", title: "Align Top" },
      { id: "btnAlignCV", icon: "align-center-v.svg", title: "Align Center V" },
      { id: "btnAlignB", icon: "align-bottom.svg", title: "Align Bottom" },
      null,
      {
        id: "btnDistH",
        icon: "distribute-horizontal.svg",
        title: "Distribute Horizontally",
      },
      {
        id: "btnDistV",
        icon: "distribute-vertical.svg",
        title: "Distribute Vertically",
      },
    ];
    alignBtns.forEach((cfg) => {
      if (!cfg) {
        const sep = document.createElement("div");
        sep.style.cssText =
          "width:1px;height:16px;background:#3a3d40;margin:0 2px;";
        alignBar.appendChild(sep);
        return;
      }
      const btn = createButton("", {
        variant: "sm",
        iconSrc: _ai + cfg.icon,
        title: cfg.title,
      });
      btn.id = cfg.id;
      alignBar.appendChild(btn);
    });
    layout.titlebarCenter.appendChild(alignBar);

    // Help panel ref
    core.helpPanel = layout.helpPanel;
    core.btnHelp = null;

    // =====================================================================
    // RIGHT SIDEBAR
    // =====================================================================

    // --- 1. Layers Stack (unified layer panel from framework) ---
    core._layerPanel = createLayerPanel({
      showBlendMode: true,
      showOpacity: true,
      onBlendChange: (mode) => {
        if (core.selectedLayerIds.size > 0) {
          const id = Array.from(core.selectedLayerIds)[0];
          const layer = core.layers.find((l) => l.id === id);
          if (layer) {
            layer.blendMode = mode;
            core.draw();
            core.pushHistory();
          }
        }
      },
      onOpacityChange: (val) => {
        for (const id of core.selectedLayerIds) {
          const layer = core.layers.find((l) => l.id === id);
          if (layer) {
            layer.opacity = val / 100;
          }
        }
        core.draw();
        core.pushHistory();
      },
      onAdd: () => core.uploadBtn.click(),
      addIcon: "upload",
      addTitle: "Add image layer",
      onDuplicate: () => core.btnDupLayer.click(),
      onDelete: () => core.btnDelLayer.click(),
      onMoveUp: () => this.moveLayer(1),
      onMoveDown: () => this.moveLayer(-1),
      onFlatten: () => {
        if (core.layers.length < 2) return;
        const cvs = document.createElement("canvas");
        cvs.width = core.docWidth;
        cvs.height = core.docHeight;
        const ctx = cvs.getContext("2d");
        core.layers.forEach((l) => {
          if (l.visible && l.img) {
            ctx.globalAlpha = l.opacity ?? 1;
            ctx.drawImage(l.img, 0, 0);
          }
        });
        const img = new Image();
        img.src = cvs.toDataURL();
        img.onload = () => {
          core.layers = [
            {
              id: Date.now().toString(),
              name: "Flattened",
              img,
              visible: true,
              locked: false,
              opacity: 1,
              cx: core.docWidth / 2,
              cy: core.docHeight / 2,
              scaleX: 1,
              scaleY: 1,
              rotation: 0,
              flippedX: false,
              flippedY: false,
            },
          ];
          core.selectedLayerIds.clear();
          core.selectedLayerIds.add(core.layers[0].id);
          core.syncActiveLayerIndex();
          this.updateActiveLayerUI();
          core.draw();
          core.pushHistory();
        };
      },
      onReorder: (fromIdx, toIdx) => {
        const fromActual = core.layers.length - 1 - fromIdx;
        const toActual = core.layers.length - 1 - toIdx;
        const moved = core.layers.splice(fromActual, 1)[0];
        core.layers.splice(Math.max(0, toActual), 0, moved);
        core.pushHistory();
        core.syncActiveLayerIndex();
        this.updateActiveLayerUI();
        core.draw();
      },
    });
    core._layerPanel.el.style.flex = "1";
    core._layerPanel.el.style.display = "flex";
    core._layerPanel.el.style.flexDirection = "column";
    core.layersListPanel = core._layerPanel.el;
    core.layersList = core._layerPanel.list;

    // Lightweight proxies for dup/del
    function _btnProxy() {
      const p = {
        style: { opacity: "0.3" },
        disabled: false,
        classList: {
          add() {},
          remove() {},
          toggle() {},
          contains() {
            return false;
          },
        },
        _listeners: [],
        _onclick: null,
        set onclick(fn) {
          p._onclick = fn;
        },
        get onclick() {
          return p._onclick;
        },
        addEventListener(evt, fn) {
          if (evt === "click") p._listeners.push(fn);
        },
        click() {
          if (p._onclick) p._onclick();
          p._listeners.forEach((fn) => fn());
        },
      };
      return p;
    }
    core.btnDupLayer = _btnProxy();
    core.btnDelLayer = _btnProxy();

    // Insert layers panel before the sidebar footer
    layout.rightSidebar.insertBefore(core._layerPanel.el, layout.sidebarFooter);

    // --- 2. Eraser Panel ---
    const eraserPanel = createPanel("Eraser", {
      collapsible: true,
      collapsed: true,
    });
    core.eraserPanel = eraserPanel.el;
    core.eraserPanel.style.opacity = "0.3";
    core.eraserPanel.style.pointerEvents = "none";

    core.btnEraserToggle = createButton("Enable  [E]", {
      variant: "standard",
      onClick: () => {
        if (core.activeMode === "eraser") {
          core.setMode(null);
        } else {
          if (core.selectedLayerIds.size !== 1) {
            layout.setStatus("Eraser requires a single layer selected", "warn");
            return;
          }
          core.setMode("eraser");
        }
      },
    });
    core.btnEraserToggle.style.width = "100%";
    core.btnEraserToggle.style.marginBottom = "8px";
    eraserPanel.content.appendChild(core.btnEraserToggle);

    // Brush Size
    const sizeRow = createSliderRow("Size", 1, 200, core.brushSize, null, {
      labelWidth: "52px",
    });
    core.brushSizeSlider = sizeRow.slider;
    core.brushSizeNum = sizeRow.numInput;
    eraserPanel.content.appendChild(sizeRow.el);

    // Brush Hardness
    const hardRow = createSliderRow(
      "Hard",
      0,
      100,
      Math.round(core.brushHardness * 100),
      null,
      { labelWidth: "52px" },
    );
    core.brushHardnessSlider = hardRow.slider;
    core.brushHardnessNum = hardRow.numInput;
    eraserPanel.content.appendChild(hardRow.el);

    // Reset Eraser Mask
    eraserPanel.content.appendChild(createDivider());
    core.btnResetEraser = createButton("Reset Eraser Mask", {
      variant: "full",
      onClick: () => {
        if (core.selectedLayerIds.size === 0) return;
        let cleared = false;
        for (const id of core.selectedLayerIds) {
          const layer = core.layers.find((l) => l.id === id);
          if (layer && layer.hasMask_internal) {
            core.clearEraserMask(layer, true);
            cleared = true;
          }
        }
        if (cleared) {
          this.updateActiveLayerUI();
          core.draw();
          core.pushHistory();
        }
      },
    });
    core.btnResetEraser.style.opacity = "0.3";
    core.btnResetEraser.disabled = true;
    core.btnResetEraser.title = "Restore all erased pixels on this layer";
    eraserPanel.content.appendChild(core.btnResetEraser);

    layout.rightSidebar.insertBefore(core.eraserPanel, layout.sidebarFooter);

    // --- 3. Background Removal panel ---
    const bgRemovalPanel = createPanel("AI Background Removal", {
      collapsible: true,
      collapsed: false,
    });

    core.removeBgBtn = createButton("Remove Background", {
      variant: "accent",
    });
    core.removeBgBtn.style.opacity = "0.3";
    core.removeBgBtn.style.width = "100%";
    core.removeBgBtn.style.marginBottom = "8px";
    core.removeBgBtn.style.pointerEvents = "none";
    bgRemovalPanel.content.appendChild(core.removeBgBtn);

    // Model dropdown — starts with a conservative default set (works
    // even before the /remove_bg_info call comes back). The list is
    // replaced with the real server-reported catalog once the info
    // request resolves (models greyed if not available, annotated
    // with size, ✓ if already downloaded).
    const bgQualitySelect = createSelectInput({
      options: [
        { value: "auto", label: "Auto (recommended)" },
        { value: "u2net", label: "Fast" },
        { value: "isnet-general-use", label: "Balanced" },
        { value: "birefnet-general", label: "Best" },
      ],
      value: "auto",
      onChange: (val) => {
        core._bgRemovalQuality = val;
        const firstId = Array.from(core.selectedLayerIds)[0];
        const layer = core.layers.find((l) => l.id === firstId);
        if (layer) {
          layer.bgRemovalQuality = val;
          core.pushHistory();
        }
      },
    });
    bgQualitySelect.style.width = "100%";
    const bgQualityRow = createRow("Model", bgQualitySelect, { labelWidth: "80px" });
    core._bgQualityRow = bgQualityRow;
    core._bgQualitySelect = bgQualitySelect;
    bgRemovalPanel.content.appendChild(bgQualityRow);

    // Status line — tells the user if rembg is installed, which version,
    // and gives a quick hint about what the selected model will do on
    // first use (download size). Populated by _refreshRembgInfo() below.
    const bgStatusLine = document.createElement("div");
    bgStatusLine.style.cssText =
      "font-size:10px;color:#888;margin:4px 2px 2px;line-height:1.4;";
    bgStatusLine.textContent = "Checking rembg installation...";
    bgRemovalPanel.content.appendChild(bgStatusLine);
    core._bgStatusLine = bgStatusLine;

    // Async: fetch real model catalog from the server and refresh
    // the dropdown + status line with proper labels & availability.
    PixaromaAPI.removeBgInfo().then((info) => {
      core._rembgInfo = info;
      if (!info.rembgInstalled) {
        bgStatusLine.innerHTML =
          '<span style="color:#e57">✗ rembg not installed</span> — ' +
          'run <code style="background:#1c1c1c;padding:1px 4px;border-radius:2px;">python.exe -m pip install rembg</code> ' +
          'in ComfyUI\'s python_embeded folder, then restart ComfyUI.';
        // Grey out all controls so the user can't click into an error.
        core.removeBgBtn.style.opacity = "0.3";
        core.removeBgBtn.style.pointerEvents = "none";
        bgQualitySelect.disabled = true;
        return;
      }

      // Rebuild dropdown with real model names + annotations.
      const models = Array.isArray(info.models) ? info.models : [];
      bgQualitySelect.innerHTML = "";
      for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m.id;
        let label = m.label;
        if (m.id !== "auto") {
          // Annotate real models with size + downloaded mark so the
          // user knows what a first click will cost.
          const parts = [];
          if (m.sizeMB) parts.push(`${m.sizeMB} MB`);
          if (m.downloaded) parts.push("✓ downloaded");
          else if (m.available) parts.push("will download");
          if (parts.length) label += ` — ${parts.join(", ")}`;
        }
        opt.textContent = label;
        opt.disabled = !m.available;
        if (!m.available) opt.title = `Needs rembg ${m.minRembg}+ (you have ${info.rembgVersion || "unknown"})`;
        bgQualitySelect.appendChild(opt);
      }
      // Preserve existing selection if it's still a valid option,
      // otherwise fall back to auto.
      const current = core._bgRemovalQuality || "auto";
      const hasCurrent = models.some((m) => m.id === current && m.available);
      bgQualitySelect.value = hasCurrent ? current : "auto";

      // Status line — green check + version + dir
      const firstMissing = models.find((m) => m.available && !m.downloaded && m.id !== "auto");
      const hint = firstMissing
        ? `First use of a new model will download to <code style="background:#1c1c1c;padding:1px 4px;border-radius:2px;">${info.modelDir || "rembg"}</code>.`
        : `Models: <code style="background:#1c1c1c;padding:1px 4px;border-radius:2px;">${info.modelDir || "rembg"}</code>`;
      bgStatusLine.innerHTML =
        `<span style="color:#4a7">✓ rembg ${info.rembgVersion || ""}</span> · ${hint}`;
    }).catch(() => {
      bgStatusLine.textContent = "Couldn't query rembg status — backend unreachable.";
    });

    // Auto Remove BG checkbox
    const autoBgRow = document.createElement("label");
    autoBgRow.style.cssText =
      "display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;color:#aaa;cursor:pointer;user-select:none;opacity:0.3;pointer-events:none;";
    const autoBgCheck = document.createElement("input");
    autoBgCheck.type = "checkbox";
    autoBgCheck.style.cssText = "accent-color:#f66744;cursor:pointer;";
    autoBgCheck.addEventListener("change", () => {
      const firstId = Array.from(core.selectedLayerIds)[0];
      const layer = core.layers.find((l) => l.id === firstId);
      if (layer) {
        layer.removeBgOnExec = autoBgCheck.checked;
        core.pushHistory();
      }
    });
    autoBgRow.appendChild(autoBgCheck);
    autoBgRow.appendChild(document.createTextNode("Auto Remove on Execute"));
    core._autoBgRow = autoBgRow;
    core._autoBgCheck = autoBgCheck;
    bgRemovalPanel.content.appendChild(autoBgRow);

    layout.rightSidebar.insertBefore(bgRemovalPanel.el, layout.sidebarFooter);

    // --- Save button ref for the onSave delegate ---
    core.saveBtn = layout.saveBtn;

    // =====================================================================
    // MOUNT
    // =====================================================================
    layout.mount();

    // Keep brushPanel alias so core.js setMode() references still work
    core.brushPanel = core.eraserPanel;

    setTimeout(() => {
      core.fitViewToWorkspace();
      core.pushHistory();
    }, 100);
  }
}
