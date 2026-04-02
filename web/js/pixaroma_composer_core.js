import { PixaromaUI, injectComposerStyles } from "./pixaroma_composer_ui.js";
import { PixaromaLayers } from "./pixaroma_composer_layers.js";
import { PixaromaAPI } from "./pixaroma_composer_api.js";
import { PixaromaEditorBase } from "./pixaroma_base_editor.js";

export class PixaromaEditor extends PixaromaEditorBase {
  constructor(node) {
    super();
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
    this.open(); // _buildUI() → hooks → DOM mount → _onOpen()

    this.renderCanvas = document.createElement("canvas");
    this.renderCtx = this.renderCanvas.getContext("2d");
  }

  // ── Base hook overrides ────────────────────────────────────

  _editorTitle() {
    return `Image Composer <span class="pxb-brand">Pixaroma</span>`;
  }

  _buildTitlebarActions() {
    injectComposerStyles();
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;gap:4px;align-items:center;";

    this.btnUndo = document.createElement("button");
    this.btnUndo.className = "pxb-hdr-btn";
    this.btnUndo.innerHTML = "↩ Undo";
    this.btnRedo = document.createElement("button");
    this.btnRedo.className = "pxb-hdr-btn";
    this.btnRedo.innerHTML = "↪ Redo";
    this.btnHelp = document.createElement("button");
    this.btnHelp.className = "pxb-hdr-btn";
    this.btnHelp.innerHTML = "❓ Help";
    this.btnUndo.onclick = () => this.undo();
    this.btnRedo.onclick = () => this.redo();

    wrap.append(this.btnUndo, this.btnRedo, this.btnHelp);
    return wrap;
  }

  _buildLeftSidebar() {
    const sidebarLeft = document.createElement("div");
    sidebarLeft.className = "pix-sidebar-left";

    // --- 1. Document Setup ---
    const docPanel = document.createElement("div");
    docPanel.className = "pix-panel";
    docPanel.innerHTML = `<div class="pix-panel-title">Document Setup</div>`;

    const ratioRow = document.createElement("div");
    ratioRow.className = "pix-row";
    this.ratioSelect = document.createElement("select");
    this.ratioSelect.className = "pix-input";
    this.ratioSelect.innerHTML = `
            <option value="custom">Custom (Free)</option>
            <option value="1:1">1:1 Square</option>
            <option value="16:9">16:9 Landscape</option>
            <option value="9:16">9:16 Portrait</option>
            <option value="3:2">3:2 Photo</option>
            <option value="2:3">2:3 Poster</option>`;
    ratioRow.appendChild(this.ratioSelect);

    const docRow = document.createElement("div");
    docRow.className = "pix-row";
    const colW = document.createElement("div");
    colW.className = "pix-col";
    colW.innerHTML = `<div class="pix-label">Width (px)</div>`;
    this.docWInput = document.createElement("input");
    this.docWInput.type = "number";
    this.docWInput.className = "pix-input";
    this.docWInput.value = this.docWidth;
    colW.appendChild(this.docWInput);
    const colH = document.createElement("div");
    colH.className = "pix-col";
    colH.innerHTML = `<div class="pix-label">Height (px)</div>`;
    this.docHInput = document.createElement("input");
    this.docHInput.type = "number";
    this.docHInput.className = "pix-input";
    this.docHInput.value = this.docHeight;
    colH.appendChild(this.docHInput);
    docRow.append(colW, colH);
    docPanel.append(ratioRow, docRow);
    sidebarLeft.appendChild(docPanel);

    // --- 2. Workspace Content ---
    const addPanel = document.createElement("div");
    addPanel.className = "pix-panel";
    addPanel.innerHTML = `<div class="pix-panel-title">Workspace Content</div>`;
    this.uploadBtn = document.createElement("input");
    this.uploadBtn.type = "file";
    this.uploadBtn.accept = "image/*";
    this.uploadBtn.style.display = "none";
    const uploadTrigger = document.createElement("button");
    uploadTrigger.className = "pix-btn";
    uploadTrigger.style.width = "100%";
    uploadTrigger.innerHTML = `🖼️ Add Image Layer`;
    uploadTrigger.onclick = () => this.uploadBtn.click();
    const clearBtn = document.createElement("button");
    clearBtn.className = "pix-btn";
    clearBtn.style.width = "100%";
    clearBtn.style.marginTop = "8px";
    clearBtn.innerHTML = `🗑️ Clear Canvas`;
    clearBtn.onclick = () => {
      this.layers = [];
      this.selectedLayerIds.clear();
      this.syncActiveLayerIndex();
      this.ui.updateActiveLayerUI();
      this.draw();
      this.pushHistory();
    };
    addPanel.append(this.uploadBtn, uploadTrigger, clearBtn);
    sidebarLeft.appendChild(addPanel);

    // --- 3. Transform Properties ---
    this.toolsPanel = document.createElement("div");
    this.toolsPanel.className = "pix-panel";
    this.toolsPanel.style.opacity = "0.3";
    this.toolsPanel.style.pointerEvents = "none";
    this.toolsPanel.innerHTML = `<div class="pix-panel-title">Transform Properties</div>`;

    const fitRow = document.createElement("div");
    fitRow.className = "pix-row";
    this.btnFitW = document.createElement("button");
    this.btnFitW.className = "pix-btn";
    this.btnFitW.innerText = "↔ Fit Width";
    this.btnFitH = document.createElement("button");
    this.btnFitH.className = "pix-btn";
    this.btnFitH.innerText = "↕ Fit Height";
    fitRow.append(this.btnFitW, this.btnFitH);

    const flipRow = document.createElement("div");
    flipRow.className = "pix-row";
    this.btnFlipH = document.createElement("button");
    this.btnFlipH.className = "pix-btn";
    this.btnFlipH.innerText = "◧ Flip H";
    this.btnFlipV = document.createElement("button");
    this.btnFlipV.className = "pix-btn";
    this.btnFlipV.innerText = "⬒ Flip V";
    flipRow.append(this.btnFlipH, this.btnFlipV);

    const rotRow = document.createElement("div");
    rotRow.className = "pix-row";
    this.btnRotLeft = document.createElement("button");
    this.btnRotLeft.className = "pix-btn";
    this.btnRotLeft.innerText = "↺ -90°";
    this.btnRotRight = document.createElement("button");
    this.btnRotRight.className = "pix-btn";
    this.btnRotRight.innerText = "↻ +90°";
    rotRow.append(this.btnRotLeft, this.btnRotRight);

    this.btnReset = document.createElement("button");
    this.btnReset.className = "pix-btn";
    this.btnReset.innerText = "🔄 Reset Transform";
    this.btnReset.style.width = "100%";
    this.btnReset.style.marginBottom = "15px";

    const rangeRow = document.createElement("div");
    rangeRow.className = "pix-panel";
    rangeRow.style.padding = "10px";
    rangeRow.style.background = "#131415";

    const rotateLabel = document.createElement("div");
    rotateLabel.className = "pix-label";
    rotateLabel.innerText = "Rotate (degrees)";
    const rotWrap = document.createElement("div");
    rotWrap.className = "pix-row";
    this.rotateSlider = document.createElement("input");
    this.rotateSlider.type = "range";
    this.rotateSlider.min = "0";
    this.rotateSlider.max = "360";
    this.rotateSlider.step = "1";
    this.rotateSlider.value = "0";
    this.rotateNum = document.createElement("input");
    this.rotateNum.type = "number";
    this.rotateNum.className = "pix-input pix-input-num";
    this.rotateNum.min = "0";
    this.rotateNum.max = "360";
    rotWrap.append(this.rotateSlider, this.rotateNum);

    const scaleLabel = document.createElement("div");
    scaleLabel.className = "pix-label";
    scaleLabel.innerText = "Uniform Scale (%)";
    scaleLabel.style.marginTop = "10px";
    const scaleWrap = document.createElement("div");
    scaleWrap.className = "pix-row";
    this.scaleSlider = document.createElement("input");
    this.scaleSlider.type = "range";
    this.scaleSlider.min = "5";
    this.scaleSlider.max = "300";
    this.scaleSlider.step = "1";
    this.scaleSlider.value = "100";
    this.scaleNum = document.createElement("input");
    this.scaleNum.type = "number";
    this.scaleNum.className = "pix-input pix-input-num";
    this.scaleNum.min = "5";
    this.scaleNum.max = "300";
    scaleWrap.append(this.scaleSlider, this.scaleNum);

    const stretchRow = document.createElement("div");
    stretchRow.className = "pix-row";
    stretchRow.style.marginTop = "10px";
    stretchRow.style.borderTop = "1px solid #3a3d40";
    stretchRow.style.paddingTop = "10px";
    const colSH = document.createElement("div");
    colSH.className = "pix-col";
    colSH.innerHTML = `<div class="pix-label">Stretch Horiz (%)</div>`;
    const wrapSH = document.createElement("div");
    wrapSH.className = "pix-row";
    this.stretchHSlider = document.createElement("input");
    this.stretchHSlider.type = "range";
    this.stretchHSlider.min = "5";
    this.stretchHSlider.max = "300";
    this.stretchHSlider.step = "1";
    this.stretchHSlider.value = "100";
    this.stretchHNum = document.createElement("input");
    this.stretchHNum.type = "number";
    this.stretchHNum.className = "pix-input pix-input-num";
    this.stretchHNum.value = "100";
    wrapSH.append(this.stretchHSlider, this.stretchHNum);
    colSH.appendChild(wrapSH);
    stretchRow.append(colSH);

    const stretchRowV = document.createElement("div");
    stretchRowV.className = "pix-row";
    const colSV = document.createElement("div");
    colSV.className = "pix-col";
    colSV.innerHTML = `<div class="pix-label">Stretch Vert (%)</div>`;
    const wrapSV = document.createElement("div");
    wrapSV.className = "pix-row";
    this.stretchVSlider = document.createElement("input");
    this.stretchVSlider.type = "range";
    this.stretchVSlider.min = "5";
    this.stretchVSlider.max = "300";
    this.stretchVSlider.step = "1";
    this.stretchVSlider.value = "100";
    this.stretchVNum = document.createElement("input");
    this.stretchVNum.type = "number";
    this.stretchVNum.className = "pix-input pix-input-num";
    this.stretchVNum.value = "100";
    wrapSV.append(this.stretchVSlider, this.stretchVNum);
    colSV.appendChild(wrapSV);
    stretchRowV.append(colSV);

    const opacityLabel = document.createElement("div");
    opacityLabel.className = "pix-label";
    opacityLabel.innerText = "Opacity (%)";
    opacityLabel.style.marginTop = "10px";
    const opWrap = document.createElement("div");
    opWrap.className = "pix-row";
    this.opacitySlider = document.createElement("input");
    this.opacitySlider.type = "range";
    this.opacitySlider.min = "0";
    this.opacitySlider.max = "100";
    this.opacitySlider.step = "1";
    this.opacitySlider.value = "100";
    this.opacityNum = document.createElement("input");
    this.opacityNum.type = "number";
    this.opacityNum.className = "pix-input pix-input-num";
    this.opacityNum.min = "0";
    this.opacityNum.max = "100";
    opWrap.append(this.opacitySlider, this.opacityNum);

    rangeRow.append(rotateLabel, rotWrap, scaleLabel, scaleWrap, stretchRow, stretchRowV, opacityLabel, opWrap);
    this.toolsPanel.append(fitRow, flipRow, rotRow, this.btnReset, rangeRow);
    sidebarLeft.appendChild(this.toolsPanel);

    // Status bar (bottom of left sidebar)
    this.statusText = document.createElement("div");
    this.statusText.style.cssText =
      "font-size:11px; color:#888; padding:10px 4px 4px 4px; text-align:center; margin-top:auto; border-top:1px solid #3a3d40;";
    this.statusText.innerText = "Ready.";
    sidebarLeft.appendChild(this.statusText);

    return sidebarLeft;
  }

  _buildWorkspace() {
    this.workspace = document.createElement("div");
    this.workspace.className = "pix-workspace";
    this.canvasContainer = document.createElement("div");
    this.canvasContainer.className = "pix-canvas-container";
    this.canvasContainer.style.width = this.docWidth + "px";
    this.canvasContainer.style.height = this.docHeight + "px";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "pix-canvas";
    this.canvas.width = this.docWidth;
    this.canvas.height = this.docHeight;
    this.ctx = this.canvas.getContext("2d");
    this.canvasContainer.appendChild(this.canvas);
    this.workspace.appendChild(this.canvasContainer);

    // Align bar (top-center of workspace)
    const alignBar = document.createElement("div");
    alignBar.className = "pix-align-bar";
    alignBar.innerHTML = `
            <span class="pix-label" style="margin:0 10px 0 0; color:#fff;">Align:</span>
            <button class="pix-view-btn" id="btnAlignL" title="Align Left">⇤</button>
            <button class="pix-view-btn" id="btnAlignCH" title="Align Center Horizontally">⬌</button>
            <button class="pix-view-btn" id="btnAlignR" title="Align Right">⇥</button>
            <div style="width:1px; height:20px; background:#3a3d40; margin:0 5px;"></div>
            <button class="pix-view-btn" id="btnAlignT" title="Align Top">⤒</button>
            <button class="pix-view-btn" id="btnAlignCV" title="Align Center Vertically">⬍</button>
            <button class="pix-view-btn" id="btnAlignB" title="Align Bottom">⤓</button>
            <div style="width:1px; height:20px; background:#3a3d40; margin:0 5px;"></div>
            <button class="pix-view-btn" id="btnDistH" title="Distribute Horizontally" style="font-size:11px; letter-spacing:2px; font-weight:900;">|||</button>
            <button class="pix-view-btn" id="btnDistV" title="Distribute Vertically" style="font-size:16px; font-weight:900;">☰</button>
        `;
    this.workspace.appendChild(alignBar);

    // Help panel (shown via btnHelp in titlebar)
    this.helpPanel = document.createElement("div");
    this.helpPanel.style.cssText =
      "display: none; position: absolute; top: 10px; right: 20px; width: 300px; background: rgba(36,38,40,0.95); border: 1px solid #3a3d40; border-radius: 8px; padding: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); z-index: 100; backdrop-filter: blur(5px);";
    this.helpPanel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #555; padding-bottom:5px;">
                <strong style="color:#f66744; font-size:14px;">Editor Guide & Shortcuts</strong>
                <button id="pix-close-help" style="background:none; border:none; color:#aaa; cursor:pointer; font-size:14px;">✖</button>
            </div>
            <div style="font-size:12px; line-height:1.6; color:#ececec;">
                <b>🖱️ Canvas Navigation</b><br>
                • <b>Space + Drag</b> or <b>Middle-Click</b> to Pan.<br>
                • <b>Scroll Wheel</b> to Zoom In/Out.<br><br>
                <b>🔲 Selection</b><br>
                • Click any layer on canvas or in the Layers panel to select it.<br>
                • <b>Shift / Ctrl + Click</b> to multi-select.<br>
                • <b>Alt + Drag</b> to duplicate a layer.<br>
                • <b>Drag Corners</b> to scale uniformly.<br><br>
                <b>✖️ Eraser</b><br>
                • Select a layer first, then click <b>Enable Eraser</b> (or press <b>E</b>).<br>
                • Press <b>E</b> again (or click the button) to switch back to Select.<br>
                • <b>Reset Mask</b> fully restores the layer's original pixels.<br><br>
                <b>⌨️ Keyboard Shortcuts</b><br>
                • <b>E</b>: Toggle Eraser on/off<br>
                • <b>V</b>: Return to Select mode<br>
                • <b>Ctrl + Z / Ctrl + Y</b>: Undo / Redo<br>
                • <b>Delete</b>: Remove selected layer(s)<br><br>
                <b>📑 Layers Panel</b><br>
                • Click to select, <b>Ctrl+Click</b> for multi-select.<br>
                • <b>Double-click</b> name to rename.<br>
                • <b>Drag</b> to reorder layers.<br>
                • Use <b>▲/▼</b> buttons to move up/down.
            </div>
        `;
    this.workspace.appendChild(this.helpPanel);
    if (this.btnHelp) {
      this.btnHelp.onclick = () => {
        this.helpPanel.style.display = this.helpPanel.style.display === "none" ? "block" : "none";
      };
      this.helpPanel.querySelector("#pix-close-help").onclick = () => {
        this.helpPanel.style.display = "none";
      };
    }

    // Zoom controls (bottom-center of workspace)
    const viewControls = document.createElement("div");
    viewControls.className = "pix-view-controls";
    const btnZoomOut = document.createElement("button");
    btnZoomOut.className = "pix-view-btn";
    btnZoomOut.innerHTML = "➖";
    btnZoomOut.title = "Zoom Out";
    const btnZoomFit = document.createElement("button");
    btnZoomFit.className = "pix-view-btn";
    btnZoomFit.innerHTML = "🔲 Fit View";
    btnZoomFit.title = "Fit to Screen";
    const btnZoomIn = document.createElement("button");
    btnZoomIn.className = "pix-view-btn";
    btnZoomIn.innerHTML = "➕";
    btnZoomIn.title = "Zoom In";
    btnZoomOut.onclick = () => {
      this.viewZoom *= 0.8;
      this.updateViewTransform();
    };
    btnZoomIn.onclick = () => {
      this.viewZoom *= 1.2;
      this.updateViewTransform();
    };
    btnZoomFit.onclick = () => this.fitViewToWorkspace();
    viewControls.append(btnZoomOut, btnZoomFit, btnZoomIn);
    this.workspace.appendChild(viewControls);

    return this.workspace;
  }

  _buildRightSidebar() {
    const sidebarRight = document.createElement("div");
    sidebarRight.className = "pix-sidebar-right";

    // --- 1. Layers Stack ---
    this.layersListPanel = document.createElement("div");
    this.layersListPanel.className = "pix-panel";
    this.layersListPanel.style.flex = "1";
    this.layersListPanel.style.display = "flex";
    this.layersListPanel.style.flexDirection = "column";
    this.layersListPanel.innerHTML = `<div class="pix-panel-title">Layers</div>`;
    this.layersList = document.createElement("div");
    this.layersList.className = "pix-layers-list";
    this.layersListPanel.appendChild(this.layersList);

    const actRow = document.createElement("div");
    actRow.className = "pix-layer-actions";
    const mkBtn = (label, fn, cls) => {
      const b = document.createElement("button");
      b.className = cls || "pix-btn";
      b.innerHTML = label;
      b.addEventListener("click", fn);
      return b;
    };
    const addBtn = mkBtn("+", () => this.uploadBtn.click());
    addBtn.title = "Add image layer";
    this.btnDupLayer = mkBtn("\u2398", () => {});
    this.btnDupLayer.title = "Duplicate layer";
    this.btnDupLayer.style.opacity = "0.3";
    this.btnDelLayer = mkBtn("\ud83d\uddd1", () => {}, "pix-btn pix-btn-danger");
    this.btnDelLayer.title = "Delete layer";
    this.btnDelLayer.style.opacity = "0.3";
    const upBtn = mkBtn("\u25b2", () => this.ui.moveLayer(1));
    upBtn.title = "Move layer up";
    const dnBtn = mkBtn("\u25bc", () => this.ui.moveLayer(-1));
    dnBtn.title = "Move layer down";
    actRow.append(addBtn, this.btnDupLayer, this.btnDelLayer, upBtn, dnBtn);
    this.layersListPanel.appendChild(actRow);
    sidebarRight.appendChild(this.layersListPanel);

    // --- 2. Eraser Panel ---
    this.eraserPanel = document.createElement("div");
    this.eraserPanel.className = "pix-panel";
    this.eraserPanel.style.opacity = "0.3";
    this.eraserPanel.style.pointerEvents = "none";
    this.eraserPanel.style.marginBottom = "0";

    const eraserTitleRow = document.createElement("div");
    eraserTitleRow.style.display = "flex";
    eraserTitleRow.style.justifyContent = "space-between";
    eraserTitleRow.style.alignItems = "center";
    eraserTitleRow.style.marginBottom = "12px";
    const eraserTitle = document.createElement("div");
    eraserTitle.className = "pix-panel-title";
    eraserTitle.style.margin = "0";
    eraserTitle.innerText = "ERASER";
    this.btnEraserToggle = document.createElement("button");
    this.btnEraserToggle.className = "pix-btn";
    this.btnEraserToggle.style.flex = "0 0 auto";
    this.btnEraserToggle.style.fontSize = "11px";
    this.btnEraserToggle.style.padding = "4px 10px";
    this.btnEraserToggle.innerText = "Enable  [E]";
    this.btnEraserToggle.onclick = () => {
      if (this.activeMode === "eraser") {
        this.setMode(null);
      } else {
        this.setMode("eraser");
      }
    };
    eraserTitleRow.append(eraserTitle, this.btnEraserToggle);
    this.eraserPanel.appendChild(eraserTitleRow);

    const sizeLabel = document.createElement("div");
    sizeLabel.className = "pix-label";
    sizeLabel.innerText = "Brush Size";
    const sizeWrap = document.createElement("div");
    sizeWrap.className = "pix-row";
    sizeWrap.style.marginBottom = "10px";
    this.brushSizeSlider = document.createElement("input");
    this.brushSizeSlider.type = "range";
    this.brushSizeSlider.min = "1";
    this.brushSizeSlider.max = "200";
    this.brushSizeSlider.value = this.brushSize;
    this.brushSizeNum = document.createElement("input");
    this.brushSizeNum.type = "number";
    this.brushSizeNum.className = "pix-input pix-input-num";
    this.brushSizeNum.value = this.brushSize;
    sizeWrap.append(this.brushSizeSlider, this.brushSizeNum);

    const hardLabel = document.createElement("div");
    hardLabel.className = "pix-label";
    hardLabel.innerText = "Hardness";
    const hardnessWrap = document.createElement("div");
    hardnessWrap.className = "pix-row";
    hardnessWrap.style.marginBottom = "10px";
    this.brushHardnessSlider = document.createElement("input");
    this.brushHardnessSlider.type = "range";
    this.brushHardnessSlider.min = "0";
    this.brushHardnessSlider.max = "100";
    this.brushHardnessSlider.value = Math.round(this.brushHardness * 100);
    this.brushHardnessNum = document.createElement("input");
    this.brushHardnessNum.type = "number";
    this.brushHardnessNum.className = "pix-input pix-input-num";
    this.brushHardnessNum.value = Math.round(this.brushHardness * 100);
    hardnessWrap.append(this.brushHardnessSlider, this.brushHardnessNum);

    const eraserDivider = document.createElement("div");
    eraserDivider.className = "pix-eraser-divider";
    this.btnResetEraser = document.createElement("button");
    this.btnResetEraser.className = "pix-btn";
    this.btnResetEraser.innerText = "🔄 Reset Eraser Mask";
    this.btnResetEraser.style.width = "100%";
    this.btnResetEraser.style.marginTop = "2px";
    this.btnResetEraser.style.opacity = "0.3";
    this.btnResetEraser.disabled = true;
    this.btnResetEraser.title = "Restore all erased pixels on this layer";
    this.btnResetEraser.onclick = () => {
      if (this.selectedLayerIds.size === 0) return;
      let cleared = false;
      for (const id of this.selectedLayerIds) {
        const layer = this.layers.find((l) => l.id === id);
        if (layer && layer.hasMask_internal) {
          this.clearEraserMask(layer, true);
          cleared = true;
        }
      }
      if (cleared) {
        this.ui.updateActiveLayerUI();
        this.draw();
        this.pushHistory();
      }
    };

    this.eraserPanel.append(sizeLabel, sizeWrap, hardLabel, hardnessWrap, eraserDivider, this.btnResetEraser);
    sidebarRight.appendChild(this.eraserPanel);

    // Keep brushPanel alias (referenced by setMode)
    this.brushPanel = this.eraserPanel;

    // --- 3. AI Remove Background ---
    this.removeBgBtn = document.createElement("button");
    this.removeBgBtn.className = "pix-btn-accent";
    this.removeBgBtn.style.opacity = "0.3";
    this.removeBgBtn.style.pointerEvents = "none";
    this.removeBgBtn.innerText = "✨ AI Remove Background";
    sidebarRight.appendChild(this.removeBgBtn);

    // --- 4. Save / Close ---
    const saveGroup = document.createElement("div");
    saveGroup.style.display = "flex";
    saveGroup.style.flexDirection = "column";
    saveGroup.style.gap = "8px";
    this.saveBtn = document.createElement("button");
    this.saveBtn.className = "pix-btn-accent";
    this.saveBtn.innerText = "💾 Save to Node";
    const closeBtn = document.createElement("button");
    closeBtn.className = "pix-btn";
    closeBtn.innerText = "✖ Close Editor";
    closeBtn.style.background = "#3a3d40";
    closeBtn.onclick = () => this._close();
    saveGroup.append(this.saveBtn, closeBtn);
    sidebarRight.appendChild(saveGroup);

    return sidebarRight;
  }

  // ── Lifecycle hooks ────────────────────────────────────────

  _onOpen() {
    // Remove any stale instance before activating this one
    const existing = document.getElementById("pixaroma-editor-instance");
    if (existing && existing !== this.el.overlay) existing.remove();

    // Alias this.overlay → this.el.overlay for backward compatibility
    this.overlay = this.el.overlay;
    this.overlay.id = "pixaroma-editor-instance";
    this.overlay.addEventListener("contextmenu", (e) => e.preventDefault());

    this.attachEvents();
    this.attemptRestore();
    setTimeout(() => {
      this.fitViewToWorkspace();
      this.pushHistory();
    }, 100);
  }

  _save() {
    // Delegate to the sidebar save button which holds the full async save logic.
    if (this.saveBtn) this.saveBtn.click();
  }

  _close() {
    if (this._cleanupKeys) this._cleanupKeys();
    super._close();
  }

  setMode(mode) {
    this.activeMode = mode;
    if (mode === "eraser") {
      // Eraser mode: crosshair cursor, highlight the toggle button
      this.canvas.style.cursor = "crosshair";
      if (this.btnEraserToggle) {
        this.btnEraserToggle.classList.add("pix-btn-active");
        this.btnEraserToggle.innerText = "Disable  [E]";
      }
      if (this.selectedLayerIds.size === 1) this.setupEraserOnSelection();
    } else {
      // Select mode: default cursor, reset toggle button
      this.canvas.style.cursor = "default";
      if (this.btnEraserToggle) {
        this.btnEraserToggle.classList.remove("pix-btn-active");
        this.btnEraserToggle.innerText = "Enable  [E]";
      }
    }
    this.verifySelection();
    this.draw();
  }

  setupEraserOnSelection() {
    const targetId = Array.from(this.selectedLayerIds)[0];
    const layer = this.layers.find((l) => l.id === targetId);
    if (layer && !layer.eraserMaskCanvas_internal) {
      this.prepareLayerMask(layer);
    }
  }

  prepareLayerMask(layer, existingMaskUrl = null) {
    layer.eraserMaskCanvas_internal = document.createElement("canvas");
    layer.eraserMaskCanvas_internal.width = layer.img.width;
    layer.eraserMaskCanvas_internal.height = layer.img.height;
    layer.eraserMaskCtx_internal = layer.eraserMaskCanvas_internal.getContext("2d");
    layer.eraserMaskCtx_internal.fillStyle = "black";
    layer.hasMask_internal = false;

    if (existingMaskUrl) {
      const maskImg = new Image();
      maskImg.crossOrigin = "Anonymous";
      maskImg.onload = () => {
        layer.eraserMaskCtx_internal.drawImage(maskImg, 0, 0);
        layer.hasMask_internal = true;
        this.ui.updateActiveLayerUI();
        this.draw();
      };
      maskImg.src = existingMaskUrl;
    }
  }

  clearEraserMask(layer, skipRefresh) {
    if (layer.eraserMaskCtx_internal) {
      layer.eraserMaskCtx_internal.clearRect(
        0,
        0,
        layer.eraserMaskCanvas_internal.width,
        layer.eraserMaskCanvas_internal.height
      );
      layer.hasMask_internal = false;
      layer.savedMaskPath_internal = null;
      if (!skipRefresh) {
        this.ui.updateActiveLayerUI();
        this.draw();
        this.pushHistory();
      }
    }
  }

  captureState() {
    return PixaromaLayers.captureState(this.layers);
  }

  pushHistory() {
    if (this.isRestoringHistory) return;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(this.captureState());
    this.historyIndex++;
    this.ui.updateHistoryUI();
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.layers = this.history[this.historyIndex].map((l) => ({ ...l }));
      this.verifySelection();
      this.isRestoringHistory = true;
      this.ui.updateActiveLayerUI();
      this.draw();
      this.isRestoringHistory = false;
      this.ui.updateHistoryUI();
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.layers = this.history[this.historyIndex].map((l) => ({ ...l }));
      this.verifySelection();
      this.isRestoringHistory = true;
      this.ui.updateActiveLayerUI();
      this.draw();
      this.isRestoringHistory = false;
      this.ui.updateHistoryUI();
    }
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
    return { lx: scaledX + layer.img.width / 2, ly: scaledY + layer.img.height / 2 };
  }

  drawEraserLine(layer, start, end) {
    const ctx = layer.eraserMaskCtx_internal;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(start.lx, start.ly);
    ctx.lineTo(end.lx, end.ly);
    ctx.lineWidth = (this.brushSize * 2) / Math.max(0.01, Math.abs(layer.scaleX));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "black";

    // BUG FIX: Cap the blur radius to prevent canvas crashing at extreme distances or tiny scales
    if (this.brushHardness < 0.95) {
      let blurRad = (this.brushSize * (1 - this.brushHardness)) / Math.max(0.01, Math.abs(layer.scaleX));
      blurRad = Math.min(blurRad, 100);
      ctx.filter = `blur(${blurRad}px)`;
    }
    ctx.stroke();
    ctx.restore();

    if (!layer.hasMask_internal) {
      layer.hasMask_internal = true;
      this.ui.updateActiveLayerUI();
    }
  }

  drawEraserPreview(coords) {
    this.ctx.save();
    this.ctx.translate(coords.x, coords.y);
    this.ctx.beginPath();
    this.ctx.arc(0, 0, this.brushSize, 0, Math.PI * 2);
    this.ctx.strokeStyle = "rgba(255,255,255,0.8)";
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    if (this.isMouseDown && this.activeMode === "eraser") {
      const radGrad = this.ctx.createRadialGradient(0, 0, 0, 0, 0, this.brushSize);
      radGrad.addColorStop(this.brushHardness, "rgba(0,0,0,0.6)");
      radGrad.addColorStop(1, "rgba(0,0,0,0)");
      this.ctx.fillStyle = radGrad;
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  attachEvents() {
    const getBounds = (layer) => {
      const pts = PixaromaLayers.getTransformedPoints(layer).slice(0, 4);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        cx: layer.cx,
        cy: layer.cy,
      };
    };

    const alignSelection = (type) => {
      if (this.selectedLayerIds.size < 2) return;
      const selectedLayers = this.layers.filter((l) => this.selectedLayerIds.has(l.id) && !l.locked);
      if (selectedLayers.length === 0) return;

      const boundsList = selectedLayers.map((l) => ({ layer: l, bounds: getBounds(l) }));
      const globalMinX = Math.min(...boundsList.map((b) => b.bounds.minX));
      const globalMaxX = Math.max(...boundsList.map((b) => b.bounds.maxX));
      const globalMinY = Math.min(...boundsList.map((b) => b.bounds.minY));
      const globalMaxY = Math.max(...boundsList.map((b) => b.bounds.maxY));
      const globalCx = (globalMinX + globalMaxX) / 2;
      const globalCy = (globalMinY + globalMaxY) / 2;

      boundsList.forEach(({ layer, bounds }) => {
        if (type === "L") layer.cx -= bounds.minX - globalMinX;
        if (type === "R") layer.cx += globalMaxX - bounds.maxX;
        if (type === "T") layer.cy -= bounds.minY - globalMinY;
        if (type === "B") layer.cy += globalMaxY - bounds.maxY;
        if (type === "CH") layer.cx += globalCx - (bounds.minX + bounds.maxX) / 2;
        if (type === "CV") layer.cy += globalCy - (bounds.minY + bounds.maxY) / 2;
      });

      if (type === "DistH" && selectedLayers.length > 2) {
        boundsList.sort((a, b) => a.bounds.cx - b.bounds.cx);
        const first = boundsList[0];
        const last = boundsList[boundsList.length - 1];
        const step = (last.bounds.cx - first.bounds.cx) / (boundsList.length - 1);
        boundsList.forEach((b, i) => {
          if (i > 0 && i < boundsList.length - 1) b.layer.cx = first.bounds.cx + step * i;
        });
      }

      if (type === "DistV" && selectedLayers.length > 2) {
        boundsList.sort((a, b) => a.bounds.cy - b.bounds.cy);
        const first = boundsList[0];
        const last = boundsList[boundsList.length - 1];
        const step = (last.bounds.cy - first.bounds.cy) / (boundsList.length - 1);
        boundsList.forEach((b, i) => {
          if (i > 0 && i < boundsList.length - 1) b.layer.cy = first.bounds.cy + step * i;
        });
      }

      this.pushHistory();
      this.draw();
    };

    this.workspace.querySelector("#btnAlignL").onclick = () => alignSelection("L");
    this.workspace.querySelector("#btnAlignCH").onclick = () => alignSelection("CH");
    this.workspace.querySelector("#btnAlignR").onclick = () => alignSelection("R");
    this.workspace.querySelector("#btnAlignT").onclick = () => alignSelection("T");
    this.workspace.querySelector("#btnAlignCV").onclick = () => alignSelection("CV");
    this.workspace.querySelector("#btnAlignB").onclick = () => alignSelection("B");
    this.workspace.querySelector("#btnDistH").onclick = () => alignSelection("DistH");
    this.workspace.querySelector("#btnDistV").onclick = () => alignSelection("DistV");

    this.workspace.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.viewZoom *= e.deltaY > 0 ? 0.9 : 1.1;
      this.updateViewTransform();
    });

    this._composerKeyDown = (e) => {
      // Block ALL keyboard events from reaching ComfyUI while composer is open
      e.stopPropagation();
      e.stopImmediatePropagation();
      const tag = e.target?.tagName;
      if ((tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") && !e.target?.dataset?.pixaromaTrap) return;
      if (e.code === "Space") {
        e.preventDefault();
        this.spacePressed = true;
      }
      if (e.code === "KeyE") {
        e.preventDefault();
        if (this.activeMode === "eraser") {
          this.setMode(null);
        } else if (this.selectedLayerIds.size > 0) {
          this.setMode("eraser");
        }
      }
      if (e.code === "KeyV") {
        e.preventDefault();
        this.setMode(null);
      }
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        this.undo();
      }
      if (e.ctrlKey && e.key === "y") {
        e.preventDefault();
        this.redo();
      }
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        if (this.saveBtn) this.saveBtn.click();
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        this.btnDelLayer.click();
      }
    };
    this._composerKeyBlock = (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    this._composerKeyUp = (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.code === "Space") {
        this.spacePressed = false;
        this.workspace.classList.remove("panning");
      }
    };
    window.addEventListener("keydown", this._composerKeyDown, { capture: true });
    window.addEventListener("keyup", this._composerKeyUp, { capture: true });
    window.addEventListener("keypress", this._composerKeyBlock, { capture: true });

    // Store references for cleanup
    this._composerMouseMove = null;
    this._composerMouseUp = null;
    this._composerBlur = null;

    // Store cleanup function for use by close/save
    this._cleanupKeys = () => {
      window.removeEventListener("keydown", this._composerKeyDown, { capture: true });
      window.removeEventListener("keyup", this._composerKeyUp, { capture: true });
      window.removeEventListener("keypress", this._composerKeyBlock, { capture: true });
      if (this._composerMouseMove) window.removeEventListener("mousemove", this._composerMouseMove);
      if (this._composerMouseUp) window.removeEventListener("mouseup", this._composerMouseUp);
      if (this._composerBlur) window.removeEventListener("blur", this._composerBlur);
    };

    this.workspace.addEventListener("mousedown", (e) => {
      if (e.button === 1 || this.spacePressed || e.target === this.workspace) {
        e.preventDefault();
        this.isPanning = true;
        this.panStartX = e.clientX - this.viewPanX;
        this.panStartY = e.clientY - this.viewPanY;
        this.workspace.classList.add("panning");
      }
    });

    const syncSliderStandard = (slider, num, prop, multiplier = 1) => {
      const updateBrush = (val) => {
        if (prop === "hardness") this.brushHardness = val / multiplier;
        if (prop === "size") this.brushSize = val;
      };
      slider.addEventListener("input", (e) => {
        num.value = e.target.value;
        updateBrush(parseFloat(e.target.value));
      });
      num.addEventListener("change", (e) => {
        let v = parseFloat(e.target.value);
        v = Math.max(slider.min, Math.min(slider.max, v));
        num.value = v;
        slider.value = v;
        updateBrush(v);
      });
    };
    syncSliderStandard(this.brushSizeSlider, this.brushSizeNum, "size");
    syncSliderStandard(this.brushHardnessSlider, this.brushHardnessNum, "hardness", 100);

    const syncDocResize = () => {
      this.canvasContainer.style.width = this.docWidth + "px";
      this.canvasContainer.style.height = this.docHeight + "px";
      this.canvas.width = this.docWidth;
      this.canvas.height = this.docHeight;
      this.fitViewToWorkspace();
      this.draw();
      this.pushHistory();
    };

    this.ratioSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      if (val === "custom") {
        this.ratioLock = false;
      } else {
        this.ratioLock = true;
        const [rw, rh] = val.split(":").map(Number);
        this.ratioValue = rw / rh;
        this.docHeight = Math.round(this.docWidth / this.ratioValue);
        this.docHInput.value = this.docHeight;
        syncDocResize();
      }
    });

    this.docWInput.addEventListener("change", () => {
      this.docWidth = parseInt(this.docWInput.value) || 1024;
      if (this.ratioLock) {
        this.docHeight = Math.round(this.docWidth / this.ratioValue);
        this.docHInput.value = this.docHeight;
      }
      syncDocResize();
    });

    this.docHInput.addEventListener("change", () => {
      this.docHeight = parseInt(this.docHInput.value) || 1024;
      if (this.ratioLock) {
        this.docWidth = Math.round(this.docHeight * this.ratioValue);
        this.docWInput.value = this.docWidth;
      }
      syncDocResize();
    });

    this.uploadBtn.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = async () => {
          const layerObj = {
            id: Date.now().toString(),
            name: `Layer ${this.layers.length + 1} (${file.name})`,
            img: img,
            cx: this.docWidth / 2,
            cy: this.docHeight / 2,
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
          PixaromaLayers.fitLayerToCanvas(layerObj, this.docWidth, this.docHeight, "width");
          this.layers.push(layerObj);
          this.selectedLayerIds.clear();
          this.selectedLayerIds.add(layerObj.id);
          this.syncActiveLayerIndex();
          this.ui.updateActiveLayerUI();
          this.draw();
          this.pushHistory();
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
      this.uploadBtn.value = "";
    });

    const syncSliderTrans = (slider, num, prop, multiplier = 1) => {
      const updateCanvas = (val) => {
        this.layers.forEach((layer) => {
          if (this.selectedLayerIds.has(layer.id) && !layer.locked) {
            if (prop === "scale") {
              layer.scaleX = val / multiplier;
              layer.scaleY = val / multiplier;
            } else layer[prop] = val / multiplier;
          }
        });
        this.draw();
      };
      slider.addEventListener("input", (e) => {
        num.value = e.target.value;
        updateCanvas(parseFloat(e.target.value));
      });
      slider.addEventListener("change", () => this.pushHistory());
      num.addEventListener("change", (e) => {
        let v = parseFloat(e.target.value);
        v = Math.max(slider.min, Math.min(slider.max, v));
        num.value = v;
        slider.value = v;
        updateCanvas(v);
        this.pushHistory();
      });
    };

    syncSliderTrans(this.opacitySlider, this.opacityNum, "opacity", 100);
    syncSliderTrans(this.rotateSlider, this.rotateNum, "rotation", 1);
    syncSliderTrans(this.scaleSlider, this.scaleNum, "scale", 100);

    const syncSliderStretch = (slider, num, prop, multiplier = 100) => {
      const updateCanvas = (val) => {
        this.layers.forEach((layer) => {
          if (this.selectedLayerIds.has(layer.id) && !layer.locked) {
            layer[prop] = val / multiplier;
          }
        });
        this.draw();
      };
      slider.addEventListener("input", (e) => {
        num.value = e.target.value;
        updateCanvas(parseFloat(e.target.value));
      });
      slider.addEventListener("change", () => this.pushHistory());
      num.addEventListener("change", (e) => {
        let v = parseFloat(e.target.value);
        v = Math.max(slider.min, Math.min(slider.max, v));
        num.value = v;
        slider.value = v;
        updateCanvas(v);
        this.pushHistory();
      });
    };

    syncSliderStretch(this.stretchHSlider, this.stretchHNum, "scaleX", 100);
    syncSliderStretch(this.stretchVSlider, this.stretchVNum, "scaleY", 100);

    this.btnFitW.onclick = () =>
      this.applyToSelection((l) => PixaromaLayers.fitLayerToCanvas(l, this.docWidth, this.docHeight, "width"));
    this.btnFitH.onclick = () =>
      this.applyToSelection((l) => PixaromaLayers.fitLayerToCanvas(l, this.docWidth, this.docHeight, "height"));
    this.btnFlipH.onclick = () => this.applyToSelection((l) => (l.flippedX = !l.flippedX));
    this.btnFlipV.onclick = () => this.applyToSelection((l) => (l.flippedY = !l.flippedY));
    this.btnRotLeft.onclick = () => this.applyToSelection((l) => (l.rotation = (l.rotation - 90 + 360) % 360));
    this.btnRotRight.onclick = () => this.applyToSelection((l) => (l.rotation = (l.rotation + 90) % 360));
    this.btnReset.onclick = () =>
      this.applyToSelection((l) => {
        l.rotation = 0;
        l.flippedX = false;
        l.flippedY = false;
        l.opacity = 1;
        PixaromaLayers.fitLayerToCanvas(l, this.docWidth, this.docHeight, "width");
      });

    this.btnDupLayer.onclick = () => {
      if (this.selectedLayerIds.size === 0) return;
      const newLayers = [];
      this.layers.forEach((layer) => {
        if (this.selectedLayerIds.has(layer.id))
          newLayers.push({
            ...layer,
            id: Date.now().toString() + Math.random(),
            name: layer.name + " copy",
            cx: layer.cx + 20,
            cy: layer.cy + 20,
          });
      });
      this.layers.push(...newLayers);
      this.selectedLayerIds.clear();
      newLayers.forEach((l) => this.selectedLayerIds.add(l.id));
      this.syncActiveLayerIndex();
      this.ui.updateActiveLayerUI();
      this.draw();
      this.pushHistory();
    };

    this.btnDelLayer.addEventListener("click", () => {
      if (this.selectedLayerIds.size === 0) return;
      this.layers = this.layers.filter((l) => !this.selectedLayerIds.has(l.id));
      this.selectedLayerIds.clear();
      this.syncActiveLayerIndex();
      this.ui.updateActiveLayerUI();
      this.draw();
      this.pushHistory();
    });

    this.removeBgBtn.addEventListener("click", async () => {
      if (this.selectedLayerIds.size === 0) return;
      const originalText = this.removeBgBtn.innerText;
      this.removeBgBtn.innerText = "⏳ ML Processing...";
      this.removeBgBtn.disabled = true;
      const targetId = Array.from(this.selectedLayerIds)[0];
      const layer = this.layers.find((l) => l.id === targetId);
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = layer.img.width;
      tempCanvas.height = layer.img.height;
      tempCanvas.getContext("2d").drawImage(layer.img, 0, 0);
      try {
        const data = await PixaromaAPI.removeBg(tempCanvas.toDataURL("image/png"));
        if (data.code === "REMBG_MISSING") {
          alert(
            "Remove BG — Missing Dependency\n\n" +
              "The rembg library is not installed. To install it:\n\n" +
              "1. Open your main ComfyUI folder and go inside the  python_embeded  folder.\n" +
              "2. Click in the file path/address bar at the top of the folder window.\n" +
              "3. Type  cmd  and press Enter. A black command prompt window will open directly in that folder.\n" +
              "4. Copy and paste the following command, then press Enter:\n\n" +
              "       python.exe -m pip install rembg\n\n" +
              "After installation is complete, restart ComfyUI and try again."
          );
        } else if (data.error) {
          alert("ML Error: " + data.error);
        } else {
          const newImg = new Image();
          newImg.crossOrigin = "Anonymous";
          newImg.onload = () => {
            layer.img = newImg;
            layer.rawB64_internal = data.image;
            layer.savedOnServer = false;
            this.draw();
            this.pushHistory();
          };
          newImg.src = data.image;
        }
      } catch (err) {
        alert("Failed ML backend.");
      } finally {
        this.removeBgBtn.innerText = originalText;
        this.removeBgBtn.disabled = false;
      }
    });

    this.saveBtn.addEventListener("click", async () => {
      this.saveBtn.innerText = "⏳ Step 1: Prep Layers & Masks...";
      this.saveBtn.disabled = true;

      try {
        const layerMeta = [];
        for (const layer of this.layers) {
          let finalSrcPath = layer.rawServerPath || null;
          if (!layer.savedOnServer && layer.rawB64_internal) {
            const dRaw = await PixaromaAPI.uploadLayer(layer.id, layer.rawB64_internal);
            finalSrcPath = dRaw.path;
            layer.rawServerPath = finalSrcPath;
            layer.savedOnServer = true;
          }

          let finalMaskPath = layer.savedMaskPath_internal || null;
          if (layer.hasMask_internal && layer.eraserMaskCanvas_internal) {
            const maskB64 = layer.eraserMaskCanvas_internal.toDataURL("image/png");
            const dMask = await PixaromaAPI.uploadLayer(layer.id + "_mask_" + Date.now(), maskB64);
            finalMaskPath = dMask.path;
            layer.savedMaskPath_internal = finalMaskPath;
          }

          layerMeta.push({
            id: layer.id,
            name: layer.name,
            cx: layer.cx,
            cy: layer.cy,
            scaleX: layer.scaleX,
            scaleY: layer.scaleY,
            rotation: layer.rotation,
            opacity: layer.opacity,
            visible: layer.visible,
            locked: layer.locked,
            flippedX: layer.flippedX,
            flippedY: layer.flippedY,
            src: finalSrcPath,
            maskSrc: finalMaskPath,
          });
        }

        this.saveBtn.innerText = "⏳ Step 2: Render Canvas...";
        this.draw(true);
        const finalRenderCanvas = document.createElement("canvas");
        finalRenderCanvas.width = this.canvas.width;
        finalRenderCanvas.height = this.canvas.height;
        const rCtx = finalRenderCanvas.getContext("2d");
        rCtx.fillStyle = "#1e1e1e";
        rCtx.fillRect(0, 0, finalRenderCanvas.width, finalRenderCanvas.height);
        rCtx.drawImage(this.canvas, 0, 0);
        const finalDataURL = finalRenderCanvas.toDataURL("image/png");
        this.draw();

        this.saveBtn.innerText = "⏳ Step 3: Save to ComfyUI...";
        const finalMeta = {
          doc_w: this.docWidth,
          doc_h: this.docHeight,
          layers: layerMeta,
          composite_path: null,
          session_ver: 5.0,
        };
        const dFin = await PixaromaAPI.saveProject(this.projectID, finalDataURL);

        if (dFin.status === "success") {
          finalMeta.composite_path = dFin.composite_path;

          const jsonString = JSON.stringify(finalMeta);

          if (this.onSave) {
            this.onSave(jsonString, finalDataURL);
          }

          this.saveBtn.innerText = "✅ Saved Successfully!";
          setTimeout(() => {
            this._close();
          }, 600);
        } else {
          alert("Server save failure: " + dFin.error);
        }
      } catch (err) {
        console.error("Pixaroma Save Error:", err);
        alert("Save failed. Please check the browser console.");
      } finally {
        if (this.saveBtn.innerText !== "✅ Saved Successfully!") this.saveBtn.innerText = "💾 Save to Node";
        this.saveBtn.disabled = false;
      }
    });

    this.canvas.addEventListener("mousedown", (e) => {
      if (
        e.button === 1 ||
        this.spacePressed ||
        this.overlay.id !== "pixaroma-editor-instance" ||
        e.target !== this.canvas
      )
        return;
      const coords = this.getCanvasCoordinates(e);
      this.isMouseDown = true;
      this.startX = coords.x;
      this.startY = coords.y;
      this.lastX = coords.x;
      this.lastY = coords.y;
      this.interactionMode = null;
      this.canvas.style.cursor = "default";

      if (this.activeMode === "eraser") {
        if (this.selectedLayerIds.size === 1) {
          this.setupEraserOnSelection();
          this.ui.updateActiveLayerUI();
        } else {
          this.isMouseDown = false;
          this.canvas.style.cursor = "default";
        }
      } else {
        this.onSelectMouseDown(e, coords);
      }
      this.draw();
    });

    // BUG FIX: When the mouse leaves the canvas element while erasing, commit the stroke
    // and reset isMouseDown. This prevents the eraser from continuing to draw out-of-bounds
    // strokes (which the mousemove bounds check stops), and ensures the tool never gets
    // stuck because the mouseup may have fired over another element that swallowed the event.
    this.canvas.addEventListener("mouseleave", () => {
      if (this.activeMode === "eraser" && this.isMouseDown) {
        this.isMouseDown = false;
        this.canvas.style.cursor = "crosshair";
        this.draw();
        this.pushHistory();
      }
    });

    this._composerMouseMove = (e) => {
      try {
        // BUG FIX: If mouse button is physically released (even outside browser window), cancel draw mode immediately.
        if (this.isMouseDown && e.buttons !== 1) {
          this.isMouseDown = false;
          this.interactionMode = null;
          this.canvas.style.cursor = "default";
          this.verifySelection();
          this.ui.updateActiveLayerUI();
          this.draw();
          this.pushHistory();
          return;
        }

        // BUG FIX: Handle pan separately so viewPanX/Y actually updates, and
        // so e.buttons===0 (mouse released outside browser) can escape the stuck state.
        if (this.isPanning) {
          if (e.buttons === 0) {
            this.isPanning = false;
            this.workspace.classList.remove("panning");
          } else {
            this.viewPanX = e.clientX - this.panStartX;
            this.viewPanY = e.clientY - this.panStartY;
            this.updateViewTransform();
          }
          return;
        }
        if (this.overlay.id !== "pixaroma-editor-instance" || e.target.tagName === "INPUT") return;

        const coords = this.getCanvasCoordinates(e);

        if (this.activeMode === "eraser") {
          this.ctx.setTransform(1, 0, 0, 1, 0, 0);
          this.draw();
          this.drawEraserPreview(coords);

          if (this.isMouseDown && this.selectedLayerIds.size === 1) {
            // BUG FIX: Only draw eraser stroke when the mouse is actually over the canvas
            // element. Without this check, moving outside the canvas while erasing sends
            // extreme out-of-bounds coordinates to drawEraserLine, causing heavy blur
            // operations that lock up the browser and make the tool appear "stuck".
            const canvasRect = this.canvas.getBoundingClientRect();
            const isOverCanvas =
              e.clientX >= canvasRect.left &&
              e.clientX <= canvasRect.right &&
              e.clientY >= canvasRect.top &&
              e.clientY <= canvasRect.bottom;
            if (isOverCanvas) {
              const layer = this.layers.find((l) => l.id === Array.from(this.selectedLayerIds)[0]);
              const startLayerCoords = this.getCoordinatesInLayerImage(layer, this.lastX, this.lastY);
              const endLayerCoords = this.getCoordinatesInLayerImage(layer, coords.x, coords.y);
              this.drawEraserLine(layer, startLayerCoords, endLayerCoords);
              this.draw();
              this.lastX = coords.x;
              this.lastY = coords.y;
            }
            // When outside canvas, don't update lastX/lastY so the stroke resumes
            // cleanly from the last valid in-canvas position if the mouse returns.
          } else {
            this.lastX = coords.x;
            this.lastY = coords.y;
          }
        } else {
          this.onSelectMouseMove(e, coords);
        }
      } catch (err) {
        // Failsafe to prevent the editor from locking up forever if a math error occurs during dragging
        console.error("Pixaroma Intercepted Mouse Error:", err);
        this.isMouseDown = false;
      }
    };
    window.addEventListener("mousemove", this._composerMouseMove);

    this._composerMouseUp = () => {
      // BUG FIX: Always reset isPanning on mouseup so releasing outside the canvas
      // (or the browser window) never leaves the editor in a permanently locked state.
      if (this.isPanning) {
        this.isPanning = false;
        this.workspace.classList.remove("panning");
      }
      if (this.isMouseDown) {
        this.isMouseDown = false;
        this.interactionMode = null;
        this.canvas.style.cursor = "default";
        this.verifySelection();
        this.ui.updateActiveLayerUI();
        this.draw();
        this.pushHistory();
      }
    };
    window.addEventListener("mouseup", this._composerMouseUp);
    // BUG FIX: If the browser window loses focus (alt-tab, clicking outside) while Space
    // is held or a drag is in progress, keyup/mouseup never fire. Reset all interaction
    // flags on blur so the tool is never stuck when focus returns.
    this._composerBlur = () => {
      this.spacePressed = false;
      if (this.isPanning) {
        this.isPanning = false;
        this.workspace.classList.remove("panning");
      }
      if (this.isMouseDown) {
        this.isMouseDown = false;
        this.interactionMode = null;
        this.canvas.style.cursor = "default";
      }
    };
    window.addEventListener("blur", this._composerBlur);
  }

  onSelectMouseDown(e, coords) {
    if (this.selectedLayerIds.size === 1) {
      const layer = this.layers.find((l) => l.id === Array.from(this.selectedLayerIds)[0]);
      if (layer && !layer.locked) {
        const pts = PixaromaLayers.getTransformedPoints(layer);
        if (Math.hypot(coords.x - pts[8].x, coords.y - pts[8].y) <= 15) this.interactionMode = "rotate";
        else if (Math.hypot(coords.x - pts[4].x, coords.y - pts[4].y) <= 12) this.interactionMode = "stretchL";
        else if (Math.hypot(coords.x - pts[5].x, coords.y - pts[5].y) <= 12) this.interactionMode = "stretchR";
        else if (Math.hypot(coords.x - pts[6].x, coords.y - pts[6].y) <= 12) this.interactionMode = "stretchT";
        else if (Math.hypot(coords.x - pts[7].x, coords.y - pts[7].y) <= 12) this.interactionMode = "stretchB";
        else {
          for (let i = 0; i < 4; i++)
            if (Math.hypot(coords.x - pts[i].x, coords.y - pts[i].y) <= 15) this.interactionMode = "scale";
        }

        if (this.interactionMode) {
          this.tempTransList = [
            {
              id: layer.id,
              cx: layer.cx,
              cy: layer.cy,
              scaleX: layer.scaleX,
              scaleY: layer.scaleY,
              rotation: layer.rotation,
              startAngle: (Math.atan2(coords.y - layer.cy, coords.x - layer.cx) * 180) / Math.PI,
              startDist: Math.hypot(coords.x - layer.cx, coords.y - layer.cy),
            },
          ];
          return;
        }
      }
    }

    let clickedLayerIndex = -1;
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const l = this.layers[i];
      if (l.visible && !l.locked && PixaromaLayers.isPointInLayer(coords.x, coords.y, l)) {
        clickedLayerIndex = i;
        break;
      }
    }

    if (clickedLayerIndex !== -1) {
      const clickedLayer = this.layers[clickedLayerIndex];
      if (e.shiftKey || e.ctrlKey) {
        if (this.selectedLayerIds.has(clickedLayer.id)) this.selectedLayerIds.delete(clickedLayer.id);
        else this.selectedLayerIds.add(clickedLayer.id);
      } else if (e.altKey) {
        if (!this.selectedLayerIds.has(clickedLayer.id)) {
          this.selectedLayerIds.clear();
          this.selectedLayerIds.add(clickedLayer.id);
        }
        const newLayers = [];
        this.layers.forEach((layer) => {
          if (this.selectedLayerIds.has(layer.id))
            newLayers.push({
              ...layer,
              id: Date.now().toString() + Math.random(),
              name: layer.name + " copy",
              cx: layer.cx + 20,
              cy: layer.cy + 20,
            });
        });
        this.layers.push(...newLayers);
        this.selectedLayerIds.clear();
        newLayers.forEach((l) => this.selectedLayerIds.add(l.id));
        this.pushHistory();
      } else {
        if (!this.selectedLayerIds.has(clickedLayer.id)) {
          this.selectedLayerIds.clear();
          this.selectedLayerIds.add(clickedLayer.id);
        }
      }
    } else {
      if (!e.shiftKey && !e.ctrlKey && !e.altKey) this.selectedLayerIds.clear();
    }

    this.syncActiveLayerIndex();
    this.ui.updateActiveLayerUI();

    if (this.selectedLayerIds.size > 0 && clickedLayerIndex !== -1) {
      this.interactionMode = "move";
      this.tempTransList = this.layers
        .filter((l) => this.selectedLayerIds.has(l.id))
        .map((l) => ({ id: l.id, cx: l.cx, cy: l.cy }));
      this.canvas.style.cursor = "move";
    }
  }

  onSelectMouseMove(e, coords) {
    if (!this.isMouseDown) {
      if (this.selectedLayerIds.size === 1) {
        const layer = this.layers.find((l) => l.id === Array.from(this.selectedLayerIds)[0]);
        if (layer && !layer.locked) {
          const pts = PixaromaLayers.getTransformedPoints(layer);
          if (Math.hypot(coords.x - pts[8].x, coords.y - pts[8].y) <= 15) {
            this.canvas.style.cursor = "crosshair";
            return;
          }
          for (let i = 0; i < 4; i++) {
            if (Math.hypot(coords.x - pts[i].x, coords.y - pts[i].y) <= 15) {
              this.canvas.style.cursor = (layer.rotation + 45) % 180 < 90 ? "nwse-resize" : "nesw-resize";
              return;
            }
          }
          if (Math.hypot(coords.x - pts[4].x, coords.y - pts[4].y) <= 12) {
            this.canvas.style.cursor = "w-resize";
            return;
          }
          if (Math.hypot(coords.x - pts[5].x, coords.y - pts[5].y) <= 12) {
            this.canvas.style.cursor = "e-resize";
            return;
          }
          if (Math.hypot(coords.x - pts[6].x, coords.y - pts[6].y) <= 12) {
            this.canvas.style.cursor = "n-resize";
            return;
          }
          if (Math.hypot(coords.x - pts[7].x, coords.y - pts[7].y) <= 12) {
            this.canvas.style.cursor = "s-resize";
            return;
          }
        }
      }
      this.canvas.style.cursor = "default";
      return;
    }

    const dx = coords.x - this.startX;
    const dy = coords.y - this.startY;

    this.tempTransList.forEach((t) => {
      const layer = this.layers.find((l) => l.id === t.id);
      if (!layer || layer.locked) return;

      if (this.interactionMode === "move") {
        layer.cx = t.cx + dx;
        layer.cy = t.cy + dy;
      } else if (this.interactionMode === "rotate") {
        const currentAngle = (Math.atan2(coords.y - t.cy, coords.x - t.cx) * 180) / Math.PI;
        let newAngle = t.rotation + (currentAngle - t.startAngle);
        if (e.shiftKey) newAngle = Math.round(newAngle / 15) * 15;
        layer.rotation = Math.round((newAngle + 360) % 360);
        this.rotateSlider.value = layer.rotation;
        this.rotateNum.value = layer.rotation;
      } else if (this.interactionMode === "scale") {
        const currentDist = Math.hypot(coords.x - t.cx, coords.y - t.cy);
        const scaleFactor = Math.max(0.01, currentDist / t.startDist);
        if (e.shiftKey) {
          layer.scaleX = Math.max(0.01, ((t.cx - coords.x) * (layer.flippedX ? 1 : -1)) / (layer.img.width / 2));
          layer.scaleY = Math.max(0.01, ((t.cy - coords.y) * (layer.flippedY ? 1 : -1)) / (layer.img.height / 2));
        } else {
          layer.scaleX = t.scaleX * scaleFactor;
          layer.scaleY = t.scaleY * scaleFactor;
        }
        this.scaleSlider.value = Math.round(layer.scaleX * 100);
        this.scaleNum.value = Math.round(layer.scaleX * 100);
      } else if (this.interactionMode.startsWith("stretch")) {
        const currentDist = Math.hypot(coords.x - t.cx, coords.y - t.cy);
        const scaleFactor = Math.max(0.01, currentDist / t.startDist);

        if (this.interactionMode === "stretchL" || this.interactionMode === "stretchR") {
          layer.scaleX = t.scaleX * scaleFactor;
          this.stretchHSlider.value = Math.round(layer.scaleX * 100);
          this.stretchHNum.value = Math.round(layer.scaleX * 100);
        } else if (this.interactionMode === "stretchT" || this.interactionMode === "stretchB") {
          layer.scaleY = t.scaleY * scaleFactor;
          this.stretchVSlider.value = Math.round(layer.scaleY * 100);
          this.stretchVNum.value = Math.round(layer.scaleY * 100);
        }
      }
    });

    this.draw();
  }

  draw(cleanRender = false) {
    if (cleanRender) {
      this.ctx.fillStyle = "#1e1e1e";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    } else {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";

    this.layers.forEach((layer) => {
      if (!layer.visible) return;

      const isSelected = this.selectedLayerIds.has(layer.id);
      this.ctx.save();
      this.ctx.globalAlpha = layer.opacity;

      this.ctx.translate(layer.cx, layer.cy);
      this.ctx.rotate((layer.rotation * Math.PI) / 180);

      this.ctx.save();
      this.ctx.scale(layer.flippedX ? -1 : 1, layer.flippedY ? -1 : 1);
      const w = layer.img.width * layer.scaleX;
      const h = layer.img.height * layer.scaleY;

      // NON-DESTRUCTIVE MASK RENDER
      if (layer.hasMask_internal && layer.eraserMaskCanvas_internal) {
        this.renderCanvas.width = layer.img.width;
        this.renderCanvas.height = layer.img.height;
        this.renderCtx.clearRect(0, 0, this.renderCanvas.width, this.renderCanvas.height);

        this.renderCtx.drawImage(layer.img, 0, 0);
        this.renderCtx.globalCompositeOperation = "destination-out";
        this.renderCtx.drawImage(layer.eraserMaskCanvas_internal, 0, 0);
        this.renderCtx.globalCompositeOperation = "source-over";

        this.ctx.drawImage(this.renderCanvas, -w / 2, -h / 2, w, h);
      } else {
        this.ctx.drawImage(layer.img, -w / 2, -h / 2, w, h);
      }

      this.ctx.restore();

      if (!cleanRender && isSelected) {
        this.ctx.strokeStyle = layer.locked ? "#888" : this.selectedLayerIds.size > 1 ? "#0ea5e9" : "#f66744";
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeRect(-w / 2, -h / 2, w, h);

        if (!layer.locked && this.selectedLayerIds.size === 1 && this.activeMode !== "eraser") {
          const sz = this.handleSize;
          this.ctx.fillStyle = "#fff";
          this.ctx.strokeStyle = "#f66744";
          this.ctx.lineWidth = 1;

          const corners = [
            { x: -w / 2, y: -h / 2 },
            { x: w / 2, y: -h / 2 },
            { x: w / 2, y: h / 2 },
            { x: -w / 2, y: h / 2 },
          ];
          corners.forEach((p) => {
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, sz / 2, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
          });

          this.ctx.fillStyle = "#fff";
          this.ctx.lineWidth = 1;
          this.ctx.beginPath();
          this.ctx.moveTo(0, -h / 2);
          this.ctx.lineTo(0, -h / 2 - 30);
          this.ctx.stroke();
          this.ctx.beginPath();
          this.ctx.arc(0, -h / 2 - 30, sz / 1.2, 0, Math.PI * 2);
          this.ctx.fillStyle = "#f66744";
          this.ctx.fill();
          this.ctx.stroke();
          this.ctx.fillStyle = "#fff";
          this.ctx.font = "12px Arial";
          this.ctx.textAlign = "center";
          this.ctx.textBaseline = "middle";
          this.ctx.fillText("↻", 0, -h / 2 - 29);

          this.ctx.fillStyle = "#f66744";
          this.ctx.strokeStyle = "#fff";
          this.ctx.lineWidth = 1;
          const sides = [
            { x: -w / 2, y: 0 },
            { x: w / 2, y: 0 },
            { x: 0, y: -h / 2 },
            { x: 0, y: h / 2 },
          ];
          sides.forEach((p) => {
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, sz / 2, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
          });
        }
      }
      this.ctx.restore();
    });
    this.ctx.globalAlpha = 1.0;
  }

  async attemptRestore() {
    let savedData = null;
    const composerWidget = (this.node.widgets || []).find((w) => w.name === "ComposerWidget");
    if (composerWidget && composerWidget.value && composerWidget.value.project_json) {
      savedData = composerWidget.value.project_json;
    }

    if (!savedData || savedData === "{}" || savedData === "") return;

    // BUG FIX: this.statusText was referenced here but never created in ui.build(),
    // causing an uncaught TypeError that silently aborted the entire restore function
    // before the try/catch block below. Guard with optional chaining.
    if (this.statusText) this.statusText.innerText = "⏳ Restoring session...";
    this.overlay.style.pointerEvents = "none";
    this.overlay.style.opacity = "0.5";

    try {
      if (typeof savedData !== "string") savedData = JSON.stringify(savedData);
      const meta = JSON.parse(savedData);

      this.docWidth = meta.doc_w;
      this.docHeight = meta.doc_h;
      this.docWInput.value = meta.doc_w;
      this.docHInput.value = meta.doc_h;

      this.canvasContainer.style.width = this.docWidth + "px";
      this.canvasContainer.style.height = this.docHeight + "px";
      this.canvas.width = this.docWidth;
      this.canvas.height = this.docHeight;

      const layersToLoad = meta.layers;
      let loadedCount = 0;
      if (!layersToLoad || layersToLoad.length === 0) {
        this.finishRestore();
        return;
      }

      this.layers = new Array(layersToLoad.length);

      layersToLoad.forEach((mLayer, i) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        const fileNameOnly = mLayer.src ? mLayer.src.split(/[\\/]/).pop() : "";

        img.onload = () => {
          this.layers[i] = {
            id: mLayer.id,
            name: mLayer.name,
            img: img,
            cx: mLayer.cx,
            cy: mLayer.cy,
            scaleX: mLayer.scaleX,
            scaleY: mLayer.scaleY,
            rotation: mLayer.rotation,
            opacity: mLayer.opacity,
            visible: mLayer.visible,
            locked: mLayer.locked,
            flippedX: mLayer.flippedX,
            flippedY: mLayer.flippedY,
            rawB64_internal: null,
            rawServerPath: mLayer.src,
            savedOnServer: true,
            savedMaskPath_internal: mLayer.maskSrc || null,
          };
          loadedCount++;
          if (loadedCount === layersToLoad.length) this.finishRestore();
        };

        img.onerror = () => {
          const tempCanvas = document.createElement("canvas");
          tempCanvas.width = 512;
          tempCanvas.height = 512;
          const tCtx = tempCanvas.getContext("2d");
          tCtx.fillStyle = "#333";
          tCtx.fillRect(0, 0, 512, 512);
          tCtx.strokeStyle = "red";
          tCtx.lineWidth = 10;
          tCtx.strokeRect(0, 0, 512, 512);
          tCtx.fillStyle = "white";
          tCtx.font = "bold 30px Arial";
          tCtx.fillText("Missing Image", 150, 256);
          const placeholder = new Image();
          placeholder.onload = () => {
            this.layers[i] = {
              id: mLayer.id,
              name: mLayer.name + " (Missing)",
              img: placeholder,
              cx: mLayer.cx,
              cy: mLayer.cy,
              scaleX: mLayer.scaleX,
              scaleY: mLayer.scaleY,
              rotation: mLayer.rotation,
              opacity: mLayer.opacity,
              visible: mLayer.visible,
              locked: mLayer.locked,
              flippedX: mLayer.flippedX,
              flippedY: mLayer.flippedY,
              rawB64_internal: null,
              rawServerPath: mLayer.src,
              savedOnServer: true,
              savedMaskPath_internal: mLayer.maskSrc || null,
            };
            loadedCount++;
            if (loadedCount === layersToLoad.length) this.finishRestore(true);
          };
          placeholder.src = tempCanvas.toDataURL();
        };
        img.src = `/view?filename=${encodeURIComponent(fileNameOnly)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
      });
    } catch (err) {
      console.error("Pixaroma Restore Error:", err);
      this.finishRestore(true);
    }
  }

  finishRestore(hadError = false) {
    this.layers.forEach((l) => {
      if (l.savedMaskPath_internal) {
        const maskFileName = l.savedMaskPath_internal.split(/[\\/]/).pop();
        const maskUrl = `/view?filename=${encodeURIComponent(
          maskFileName
        )}&type=input&subfolder=pixaroma&t=${Date.now()}`;
        this.prepareLayerMask(l, maskUrl);
      }
    });

    this.overlay.style.pointerEvents = "auto";
    this.overlay.style.opacity = "1";
    if (this.statusText) this.statusText.innerText = hadError ? "Ready (Some images missing)." : "Session restored.";
    this.fitViewToWorkspace();
    this.ui.updateActiveLayerUI();
    this.draw();

    this.history = [];
    this.historyIndex = -1;
    this.pushHistory();
  }
}
