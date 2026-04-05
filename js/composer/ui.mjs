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
      const firstId = Array.from(core.selectedLayerIds)[0];
      const layer = core.layers.find((l) => l.id === firstId);
      if (layer) {
        core.opacitySlider.value = Math.round(layer.opacity * 100);
        core.opacityNum.value = Math.round(layer.opacity * 100);
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

        // Show/hide placeholder fill mode, preview, convert button
        if (layer.isPlaceholder) {
          if (core._phFillRow) core._phFillRow.style.display = "";
          if (core._phFillSelect) core._phFillSelect.value = layer.fillMode || "cover";
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
        } else {
          if (core._phFillRow) core._phFillRow.style.display = "none";
          if (core._phPreviewBtn) core._phPreviewBtn.style.display = "none";
          if (core._convertPhBtn) {
            core._convertPhBtn.style.opacity = "1";
            core._convertPhBtn.style.pointerEvents = "auto";
          }
        }
      }
    }
    this.refreshLayersPanel();
  }

  refreshLayersPanel() {
    const core = this.core;
    // Display layers top-to-bottom (reversed from array order, since last = top)
    const items = [...core.layers].reverse().map((layer, visualIndex) => {
      const isSelected = core.selectedLayerIds.has(layer.id);
      const isFirst =
        core.selectedLayerIds.size > 0 &&
        Array.from(core.selectedLayerIds)[0] === layer.id;

      // Build thumbnail canvas
      const tCvs = document.createElement("canvas");
      tCvs.width = 26;
      tCvs.height = 26;
      if (layer.img) {
        const tCtx = tCvs.getContext("2d");
        const iw = layer.img.naturalWidth || layer.img.width;
        const ih = layer.img.naturalHeight || layer.img.height;
        if (iw && ih) {
          const scale = Math.min(26 / iw, 26 / ih);
          const dw = iw * scale,
            dh = ih * scale;
          tCtx.drawImage(layer.img, (26 - dw) / 2, (26 - dh) / 2, dw, dh);
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
                <b>Canvas Navigation</b><br>
                &bull; <b>Space + Drag</b> or <b>Middle-Click</b> to Pan.<br>
                &bull; <b>Scroll Wheel</b> to Zoom In/Out.<br><br>
                <b>Selection</b><br>
                &bull; Click any layer on canvas or in the Layers panel to select it.<br>
                &bull; <b>Shift / Ctrl + Click</b> to multi-select.<br>
                &bull; <b>Alt + Drag</b> to duplicate a layer.<br>
                &bull; <b>Drag Corners</b> to scale uniformly.<br><br>
                <b>Eraser</b><br>
                &bull; Select a layer first, then click <b>Enable Eraser</b> (or press <kbd>E</kbd>).<br>
                &bull; Press <kbd>E</kbd> again (or click the button) to switch back to Select.<br>
                &bull; <b>Reset Mask</b> fully restores the layer's original pixels.<br><br>
                <b>Keyboard Shortcuts</b><br>
                &bull; <kbd>E</kbd>: Toggle Eraser on/off<br>
                &bull; <kbd>V</kbd>: Return to Select mode<br>
                &bull; <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd>: Undo / Redo<br>
                &bull; <kbd>Delete</kbd>: Remove selected layer(s)<br><br>
                <b>Layers Panel</b><br>
                &bull; Click to select, <b>Ctrl+Click</b> for multi-select.<br>
                &bull; <b>Double-click</b> name to rename.<br>
                &bull; <b>Drag</b> to reorder layers.<br>
                &bull; Use <b>\u25b2/\u25bc</b> buttons to move up/down.
            `,
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

    // --- 2. Canvas Toolbar (Add Image + BG Color + Clear) ---
    core.uploadBtn = document.createElement("input");
    core.uploadBtn.type = "file";
    core.uploadBtn.accept = "image/*";
    core.uploadBtn.style.display = "none";
    layout.leftSidebar.appendChild(core.uploadBtn);

    this._canvasToolbar = createCanvasToolbar({
      onAddImage: (file) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.crossOrigin = "Anonymous";
          img.onload = async () => {
            const { PixaromaLayers } = await import("./layers.mjs");
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
            core.draw();
            core.pushHistory();
          };
          img.src = event.target.result;
        };
        reader.readAsDataURL(file);
      },
      onBgColorChange: (hex) => {
        core._bgColor = hex;
        core.draw();
      },
      onClear: () => {
        core.layers = [];
        core.selectedLayerIds.clear();
        core.syncActiveLayerIndex();
        this.updateActiveLayerUI();
        core.draw();
        core.pushHistory();
      },
      bgColor: "#1e1e1e",
      onReset: () => {
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
        if (this._canvasToolbar) this._canvasToolbar.setBgColor("#1e1e1e");
        if (core._dimLabel) core._dimLabel.textContent = "1024\u00d71024";
        core.syncActiveLayerIndex();
        this.updateActiveLayerUI();
        core.draw();
        core.fitViewToWorkspace();
      },
    });
    layout.leftSidebar.appendChild(this._canvasToolbar.el);

    // --- Placeholder panel (add, convert, fill mode) ---
    const phPanel = createPanel("Placeholder", { collapsible: true, collapsed: false });

    const addPhBtn = createButton("Add Placeholder", { variant: "full" });
    addPhBtn.title = "Add a placeholder layer — connect an image input at workflow execution";
    addPhBtn.onclick = () => core.addPlaceholderLayer();
    phPanel.content.appendChild(addPhBtn);

    const convertPhBtn = createButton("Convert to Placeholder", { variant: "full" });
    convertPhBtn.title = "Convert the selected layer to a placeholder input";
    convertPhBtn.style.marginTop = "4px";
    convertPhBtn.onclick = () => {
      const firstId = Array.from(core.selectedLayerIds)[0];
      if (firstId) core.convertLayerToPlaceholder(firstId);
    };
    core._convertPhBtn = convertPhBtn;
    phPanel.content.appendChild(convertPhBtn);

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
    const previewBtn = createButton("Load Now", { variant: "full" });
    previewBtn.title = "Load the connected image into the placeholder";
    previewBtn.style.marginTop = "4px";
    previewBtn.style.display = "none";
    previewBtn.onclick = () => {
      const firstId = Array.from(core.selectedLayerIds)[0];
      if (firstId) core.previewPlaceholderInput(firstId);
    };
    core._phPreviewBtn = previewBtn;
    phPanel.content.appendChild(previewBtn);

    // Auto Preview checkbox
    const autoRow = document.createElement("div");
    autoRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:6px;";
    const autoCb = document.createElement("input");
    autoCb.type = "checkbox";
    autoCb.id = "pxf-auto-preview";
    autoCb.style.cssText = "accent-color:var(--pxf-accent);";
    if (core.node._pixaromaAutoPreview === undefined) core.node._pixaromaAutoPreview = true;
    autoCb.checked = core.node._pixaromaAutoPreview;
    autoCb.addEventListener("change", () => {
      core.node._pixaromaAutoPreview = autoCb.checked;
    });
    const autoLabel = document.createElement("label");
    autoLabel.htmlFor = "pxf-auto-preview";
    autoLabel.textContent = "Auto load on connect";
    autoLabel.style.cssText = "font-size:10px;color:#aaa;cursor:pointer;user-select:none;";
    autoRow.append(autoCb, autoLabel);
    core._phAutoPreview = autoCb;
    core._phAutoRow = autoRow;
    phPanel.content.appendChild(autoRow);

    core._phPanel = phPanel;
    layout.leftSidebar.appendChild(phPanel.el);

    // --- 3. Transform Properties (unified framework component) ---
    const tp = createTransformPanel({
      onReset: () => {},
      showRotateSlider: true,
      showScaleSlider: true,
      showStretchSliders: true,
      showOpacitySlider: true,
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
    core.canvasContainer.style.border = "2px solid rgba(249,115,22,0.45)";
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
    const eraserPanel = createPanel("Eraser");
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

    // Separator
    const sep1 = createDivider();
    sep1.style.margin = "8px 10px";
    layout.rightSidebar.insertBefore(sep1, layout.sidebarFooter);

    // --- 3. AI Remove Background ---
    core.removeBgBtn = createButton("AI Remove Background", {
      variant: "accent",
    });
    core.removeBgBtn.style.opacity = "0.3";
    core.removeBgBtn.style.pointerEvents = "none";
    core.removeBgBtn.style.margin = "0 10px";
    layout.rightSidebar.insertBefore(core.removeBgBtn, layout.sidebarFooter);

    // Separator before footer
    const sep2 = createDivider();
    sep2.style.margin = "8px 10px";
    layout.rightSidebar.insertBefore(sep2, layout.sidebarFooter);

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
