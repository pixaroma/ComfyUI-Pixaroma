import { app } from "/scripts/app.js";
import { PixaromaUI } from "./pixaroma_composer_ui.js";
import { PixaromaLayers } from "./pixaroma_composer_layers.js";
import { PixaromaAPI } from "./pixaroma_composer_api.js";
import { installFocusTrap } from "./pixaroma_shared.js";

const BASE_WIDTH = 380;

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
        this.startX = 0; this.startY = 0;
        this.lastX = 0; this.lastY = 0;
        this.tempTransList = []; 

        this.viewZoom = 1.0;
        this.viewPanX = 0; this.viewPanY = 0;
        this.isPanning = false;
        this.panStartX = 0; this.panStartY = 0;
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
            if (this._layout) this._layout.setStatus("Eraser mode \u00b7 Drag to erase \u00b7 [ / ] resize \u00b7 E to toggle off");
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
                    this._layout.setStatus("Add an image to get started \u2014 click Add Image or drag & drop");
                } else if (this.selectedLayerIds.size === 0) {
                    this._layout.setStatus("Click to select \u00b7 Shift+Click multi-select \u00b7 Alt+Drag duplicate \u00b7 Space+Drag pan \u00b7 Scroll zoom");
                } else if (this.selectedLayerIds.size === 1) {
                    this._layout.setStatus("Click to select \u00b7 Shift+Click multi-select \u00b7 Alt+Drag duplicate \u00b7 Drag corners to resize");
                } else {
                    this._layout.setStatus("Multiple layers selected \u00b7 Use Align tools \u00b7 Ctrl+A select all \u00b7 Delete to remove");
                }
            }
        }
        this.verifySelection(); this.draw();
    }

    setupEraserOnSelection() {
        const targetId = Array.from(this.selectedLayerIds)[0];
        const layer = this.layers.find(l => l.id === targetId);
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
        if(layer.eraserMaskCtx_internal) {
             layer.eraserMaskCtx_internal.clearRect(0,0,layer.eraserMaskCanvas_internal.width, layer.eraserMaskCanvas_internal.height);
             layer.hasMask_internal = false;
             layer.savedMaskPath_internal = null;
             if (!skipRefresh) { this.ui.updateActiveLayerUI(); this.draw(); this.pushHistory(); }
        }
    }

    captureState() { return PixaromaLayers.captureState(this.layers); }

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
            this.layers = this.history[this.historyIndex].map(l => ({ ...l }));
            this.verifySelection();
            this.isRestoringHistory = true; this.ui.updateActiveLayerUI(); this.draw(); this.isRestoringHistory = false;
            this.ui.updateHistoryUI();
        }
    }

    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.layers = this.history[this.historyIndex].map(l => ({ ...l }));
            this.verifySelection();
            this.isRestoringHistory = true; this.ui.updateActiveLayerUI(); this.draw(); this.isRestoringHistory = false;
            this.ui.updateHistoryUI();
        }
    }

    verifySelection() {
        const validIds = new Set(this.layers.map(l => l.id));
        for (let id of this.selectedLayerIds) { if (!validIds.has(id)) this.selectedLayerIds.delete(id); }
        this.syncActiveLayerIndex();
    }

    syncActiveLayerIndex() {
        if (this.selectedLayerIds.size === 1) {
            const id = Array.from(this.selectedLayerIds)[0];
            this.activeLayerIndex = this.layers.findIndex(l => l.id === id);
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
        this.viewPanX = 0; this.viewPanY = 0;
        this.updateViewTransform();
    }

    applyToSelection(actionFn) {
        let changed = false;
        this.layers.forEach(layer => {
            if (this.selectedLayerIds.has(layer.id) && !layer.locked) { actionFn(layer); changed = true; }
        });
        if (changed) { this.ui.updateActiveLayerUI(); this.draw(); this.pushHistory(); }
    }

    getCanvasCoordinates(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: (e.clientX - rect.left) * (this.canvas.width / rect.width), y: (e.clientY - rect.top) * (this.canvas.height / rect.height) };
    }

    getCoordinatesInLayerImage(layer, mainX, mainY) {
        const dx = mainX - layer.cx; const dy = mainY - layer.cy;
        const rad = -layer.rotation * Math.PI / 180;
        const rotatedX = dx * Math.cos(rad) - dy * Math.sin(rad); 
        const rotatedY = dx * Math.sin(rad) + dy * Math.cos(rad);
        const flippedX = rotatedX * (layer.flippedX ? -1 : 1); 
        const flippedY = rotatedY * (layer.flippedY ? -1 : 1);
        const scaledX = flippedX / layer.scaleX; 
        const scaledY = flippedY / layer.scaleY;
        return { lx: scaledX + layer.img.width/2, ly: scaledY + layer.img.height/2 };
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
        if(this.brushHardness < 0.95) {
            let blurRad = (this.brushSize * (1-this.brushHardness)) / Math.max(0.01, Math.abs(layer.scaleX));
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
        
        if (this.isMouseDown && this.activeMode === 'eraser') {
            const radGrad = this.ctx.createRadialGradient(0,0,0, 0,0,this.brushSize);
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
            const xs = pts.map(p => p.x); const ys = pts.map(p => p.y);
            return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), cx: layer.cx, cy: layer.cy };
        };

        const alignSelection = (type) => {
            if (this.selectedLayerIds.size < 2) return;
            const selectedLayers = this.layers.filter(l => this.selectedLayerIds.has(l.id) && !l.locked);
            if (selectedLayers.length === 0) return;

            const boundsList = selectedLayers.map(l => ({ layer: l, bounds: getBounds(l) }));
            const globalMinX = Math.min(...boundsList.map(b => b.bounds.minX));
            const globalMaxX = Math.max(...boundsList.map(b => b.bounds.maxX));
            const globalMinY = Math.min(...boundsList.map(b => b.bounds.minY));
            const globalMaxY = Math.max(...boundsList.map(b => b.bounds.maxY));
            const globalCx = (globalMinX + globalMaxX) / 2;
            const globalCy = (globalMinY + globalMaxY) / 2;

            boundsList.forEach(({ layer, bounds }) => {
                if (type === 'L') layer.cx -= (bounds.minX - globalMinX);
                if (type === 'R') layer.cx += (globalMaxX - bounds.maxX);
                if (type === 'T') layer.cy -= (bounds.minY - globalMinY);
                if (type === 'B') layer.cy += (globalMaxY - bounds.maxY);
                if (type === 'CH') layer.cx += (globalCx - (bounds.minX + bounds.maxX) / 2);
                if (type === 'CV') layer.cy += (globalCy - (bounds.minY + bounds.maxY) / 2);
            });

            if (type === 'DistH' && selectedLayers.length >= 2) {
                boundsList.sort((a, b) => a.bounds.cx - b.bounds.cx);
                if (selectedLayers.length === 2) {
                    // 2 layers: center both horizontally on canvas
                    const step = this.docWidth / 3;
                    boundsList[0].layer.cx = step;
                    boundsList[1].layer.cx = step * 2;
                } else {
                    const first = boundsList[0]; const last = boundsList[boundsList.length - 1];
                    const step = (last.bounds.cx - first.bounds.cx) / (boundsList.length - 1);
                    boundsList.forEach((b, i) => { if (i > 0 && i < boundsList.length - 1) b.layer.cx = first.bounds.cx + step * i; });
                }
            }

            if (type === 'DistV' && selectedLayers.length >= 2) {
                boundsList.sort((a, b) => a.bounds.cy - b.bounds.cy);
                if (selectedLayers.length === 2) {
                    // 2 layers: center both vertically on canvas
                    const step = this.docHeight / 3;
                    boundsList[0].layer.cy = step;
                    boundsList[1].layer.cy = step * 2;
                } else {
                    const first = boundsList[0]; const last = boundsList[boundsList.length - 1];
                    const step = (last.bounds.cy - first.bounds.cy) / (boundsList.length - 1);
                    boundsList.forEach((b, i) => { if (i > 0 && i < boundsList.length - 1) b.layer.cy = first.bounds.cy + step * i; });
                }
            }

            this.pushHistory(); this.draw();
        };

        // Align buttons are in titlebar center (set via framework)
        const ab = this._layout?.titlebarCenter || this.workspace;
        const qb = (id) => ab.querySelector(id) || this.overlay.querySelector(id);
        const alignBtn = qb('#btnAlignL'); if (alignBtn) alignBtn.onclick = () => alignSelection('L');
        const alignCH = qb('#btnAlignCH'); if (alignCH) alignCH.onclick = () => alignSelection('CH');
        const alignR = qb('#btnAlignR'); if (alignR) alignR.onclick = () => alignSelection('R');
        const alignT = qb('#btnAlignT'); if (alignT) alignT.onclick = () => alignSelection('T');
        const alignCV = qb('#btnAlignCV'); if (alignCV) alignCV.onclick = () => alignSelection('CV');
        const alignB = qb('#btnAlignB'); if (alignB) alignB.onclick = () => alignSelection('B');
        const distH = qb('#btnDistH'); if (distH) distH.onclick = () => alignSelection('DistH');
        const distV = qb('#btnDistV'); if (distV) distV.onclick = () => alignSelection('DistV');

        this.workspace.addEventListener("wheel", (e) => { e.preventDefault(); this.viewZoom *= e.deltaY > 0 ? 0.9 : 1.1; this.updateViewTransform(); });

        this._composerKeyDown = (e) => {
            // Block keyboard events from reaching ComfyUI, but let Ctrl+V through for paste
            const isCtrlV = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v';
            if (!isCtrlV) { e.stopPropagation(); e.stopImmediatePropagation(); }
            else { e.stopPropagation(); } // stop propagation but don't stop immediate (let paste fire)
            const tag = e.target?.tagName;
            if ((tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") && !e.target?.dataset?.pixaromaTrap) return;
            if (e.code === "Space") { e.preventDefault(); this.spacePressed = true; }
            if (e.code === 'KeyE') { e.preventDefault(); if (this.activeMode === 'eraser') { this.setMode(null); } else if (this.selectedLayerIds.size === 1) { this.setMode('eraser'); } else if (this.selectedLayerIds.size > 1) { if (this._layout) this._layout.setStatus("Eraser requires a single layer selected", "warn"); } }
            if (e.code === 'KeyV' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); this.setMode(null); }
            const key = e.key.toLowerCase();
            if (e.ctrlKey && key === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
            if (e.ctrlKey && key === 'y') { e.preventDefault(); this.redo(); }
            if (e.ctrlKey && key === 's') { e.preventDefault(); if (this.saveBtn) this.saveBtn.click(); }
            if (e.ctrlKey && key === 'a') {
                e.preventDefault();
                // Select all layers
                this.selectedLayerIds.clear();
                this.layers.forEach(l => this.selectedLayerIds.add(l.id));
                this.syncActiveLayerIndex(); this.ui.updateActiveLayerUI(); this.draw();
            }
            if ((e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); this.btnDelLayer.click(); }
        };
        this._composerKeyBlock = (e) => { e.stopPropagation(); e.stopImmediatePropagation(); };
        this._composerKeyUp = (e) => {
            e.stopPropagation(); e.stopImmediatePropagation();
            if (e.code === "Space") { this.spacePressed = false; this.workspace.classList.remove("panning"); }
        };
        // Ctrl+V paste is handled by the framework's setupDropZone paste handler
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
                e.preventDefault(); this.isPanning = true; this.panStartX = e.clientX - this.viewPanX; this.panStartY = e.clientY - this.viewPanY; this.workspace.classList.add("panning");
            }
            // Click on workspace background (not on canvas or layers) deselects all
            if (e.target === this.workspace) {
                this.selectedLayerIds.clear();
                this.syncActiveLayerIndex(); this.ui.updateActiveLayerUI(); this.draw();
            }
        });

        const syncSliderStandard = (slider, num, prop, multiplier = 1) => {
            const updateBrush = (val) => {
                if(prop === 'hardness') this.brushHardness = val/multiplier;
                if(prop === 'size') this.brushSize = val;
            };
            slider.addEventListener("input", (e) => { num.value = e.target.value; updateBrush(parseFloat(e.target.value)); });
            num.addEventListener("change", (e) => { let v = parseFloat(e.target.value); v = Math.max(slider.min, Math.min(slider.max, v)); num.value = v; slider.value = v; updateBrush(v); });
        };
        syncSliderStandard(this.brushSizeSlider, this.brushSizeNum, 'size');
        syncSliderStandard(this.brushHardnessSlider, this.brushHardnessNum, 'hardness', 100);

        // Canvas size changes are now handled by the shared createCanvasSettings
        // component via its onChange callback (set up in pixaroma_composer_ui.js).

        this.uploadBtn.addEventListener("change", (e) => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.crossOrigin = "Anonymous";
                img.onload = async () => {
                    const layerObj = { id: Date.now().toString(), name: `Layer ${this.layers.length+1} (${file.name})`, img: img, cx: this.docWidth/2, cy: this.docHeight/2, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, flippedX: false, flippedY: false, rawB64_internal: event.target.result, rawServerPath: "", savedOnServer: false };
                    PixaromaLayers.fitLayerToCanvas(layerObj, this.docWidth, this.docHeight, "width"); 
                    this.layers.push(layerObj); 
                    this.selectedLayerIds.clear(); this.selectedLayerIds.add(layerObj.id);
                    this.syncActiveLayerIndex(); this.ui.updateActiveLayerUI(); this.draw(); this.pushHistory();
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file); this.uploadBtn.value = "";
        });

        const syncSliderTrans = (slider, num, prop, multiplier = 1) => {
            const updateCanvas = (val) => {
                this.layers.forEach(layer => {
                    if (this.selectedLayerIds.has(layer.id) && !layer.locked) {
                        if (prop === 'scale') { layer.scaleX = val/multiplier; layer.scaleY = val/multiplier; }
                        else layer[prop] = val / multiplier;
                    }
                });
                this.draw();
            };
            slider.addEventListener("input", (e) => { num.value = e.target.value; updateCanvas(parseFloat(e.target.value)); });
            slider.addEventListener("change", () => this.pushHistory());
            num.addEventListener("change", (e) => { 
                let v = parseFloat(e.target.value); v = Math.max(slider.min, Math.min(slider.max, v)); 
                num.value = v; slider.value = v; updateCanvas(v); this.pushHistory(); 
            });
        };

        syncSliderTrans(this.opacitySlider, this.opacityNum, 'opacity', 100);
        syncSliderTrans(this.rotateSlider, this.rotateNum, 'rotation', 1);
        syncSliderTrans(this.scaleSlider, this.scaleNum, 'scale', 100);

        const syncSliderStretch = (slider, num, prop, multiplier = 100) => {
            const updateCanvas = (val) => {
                this.layers.forEach(layer => {
                    if (this.selectedLayerIds.has(layer.id) && !layer.locked) { layer[prop] = val / multiplier; }
                });
                this.draw();
            };
            slider.addEventListener("input", (e) => { num.value = e.target.value; updateCanvas(parseFloat(e.target.value)); });
            slider.addEventListener("change", () => this.pushHistory());
            num.addEventListener("change", (e) => { let v = parseFloat(e.target.value); v = Math.max(slider.min, Math.min(slider.max, v)); num.value = v; slider.value = v; updateCanvas(v); this.pushHistory(); });
        };
        
        syncSliderStretch(this.stretchHSlider, this.stretchHNum, 'scaleX', 100);
        syncSliderStretch(this.stretchVSlider, this.stretchVNum, 'scaleY', 100);

        this.btnFitW.onclick = () => this.applyToSelection(l => PixaromaLayers.fitLayerToCanvas(l, this.docWidth, this.docHeight, "width"));
        this.btnFitH.onclick = () => this.applyToSelection(l => PixaromaLayers.fitLayerToCanvas(l, this.docWidth, this.docHeight, "height"));
        this.btnFlipH.onclick = () => this.applyToSelection(l => l.flippedX = !l.flippedX);
        this.btnFlipV.onclick = () => this.applyToSelection(l => l.flippedY = !l.flippedY);
        this.btnRotLeft.onclick = () => this.applyToSelection(l => l.rotation = (l.rotation - 90 + 360) % 360);
        this.btnRotRight.onclick = () => this.applyToSelection(l => l.rotation = (l.rotation + 90) % 360);
        this.btnReset.onclick = () => this.applyToSelection(l => { l.rotation = 0; l.flippedX = false; l.flippedY = false; l.opacity = 1; PixaromaLayers.fitLayerToCanvas(l, this.docWidth, this.docHeight, "width"); });

        this.btnDupLayer.onclick = () => {
            if (this.selectedLayerIds.size === 0) return;
            const newLayers = [];
            this.layers.forEach(layer => {
                if (this.selectedLayerIds.has(layer.id)) newLayers.push({ ...layer, id: Date.now().toString() + Math.random(), name: layer.name + " copy", cx: layer.cx + 20, cy: layer.cy + 20 });
            });
            this.layers.push(...newLayers);
            this.selectedLayerIds.clear(); newLayers.forEach(l => this.selectedLayerIds.add(l.id));
            this.syncActiveLayerIndex(); this.ui.updateActiveLayerUI(); this.draw(); this.pushHistory();
        };

        this.btnDelLayer.addEventListener("click", () => {
            if (this.selectedLayerIds.size === 0) return;
            this.layers = this.layers.filter(l => !this.selectedLayerIds.has(l.id));
            this.selectedLayerIds.clear(); this.syncActiveLayerIndex(); this.ui.updateActiveLayerUI(); this.draw(); this.pushHistory();
        });

        this.removeBgBtn.addEventListener("click", async () => {
            if (this.selectedLayerIds.size === 0) return;
            const targetId = Array.from(this.selectedLayerIds)[0];
            const layer = this.layers.find(l => l.id === targetId);
            if (!layer || !layer.img) {
                if (this._layout) this._layout.setStatus("Cannot remove background: no layer selected");
                return;
            }
            // Check if layer is empty (fully transparent)
            const checkCvs = document.createElement("canvas");
            checkCvs.width = layer.img.width; checkCvs.height = layer.img.height;
            const checkCtx = checkCvs.getContext("2d");
            checkCtx.drawImage(layer.img, 0, 0);
            const pixels = checkCtx.getImageData(0, 0, checkCvs.width, checkCvs.height).data;
            let hasContent = false;
            for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] > 0) { hasContent = true; break; } }
            if (!hasContent) {
                if (this._layout) this._layout.setStatus("Layer is empty — nothing to remove");
                return;
            }
            const originalText = this.removeBgBtn.innerText;
            this.removeBgBtn.innerText = "Processing... please wait";
            this.removeBgBtn.disabled = true;
            if (this._layout) this._layout.setStatus("AI Remove Background: processing selected layer...");
            console.log("[Pixaroma] AI Remove Background: starting...");

            const tempCanvas = document.createElement("canvas"); tempCanvas.width = layer.img.width; tempCanvas.height = layer.img.height; tempCanvas.getContext("2d").drawImage(layer.img, 0, 0);
            try {
                const data = await PixaromaAPI.removeBg(tempCanvas.toDataURL("image/png"));
                if (data.code === 'REMBG_MISSING') {
                    if (this._layout) this._layout.setStatus("rembg not installed — see Help for instructions");
                    console.warn("[Pixaroma] rembg library not installed. Run: python.exe -m pip install rembg");
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
                    if (this._layout) this._layout.setStatus("AI Remove Background failed: " + data.error);
                    console.error("[Pixaroma] AI Remove BG error:", data.error);
                } else {
                    console.log("[Pixaroma] AI Remove Background: success, applying result...");
                    const newImg = new Image(); newImg.crossOrigin = "Anonymous";
                    newImg.onload = () => {
                        layer.img = newImg; layer.rawB64_internal = data.image; layer.savedOnServer = false;
                        this.draw(); this.pushHistory();
                        if (this._layout) this._layout.setStatus("Background removed successfully");
                        console.log("[Pixaroma] AI Remove Background: done");
                    };
                    newImg.src = data.image;
                }
            } catch (err) {
                if (this._layout) this._layout.setStatus("AI Remove Background failed");
                console.error("[Pixaroma] AI Remove BG error:", err);
            } finally {
                this.removeBgBtn.innerText = originalText;
                this.removeBgBtn.disabled = false;
            }
        });

        this.saveBtn.addEventListener("click", async () => {
            this._layout.setSaving();
            
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
                        id: layer.id, name: layer.name, cx: layer.cx, cy: layer.cy, 
                        scaleX: layer.scaleX, scaleY: layer.scaleY, rotation: layer.rotation, 
                        opacity: layer.opacity, visible: layer.visible, locked: layer.locked, 
                        flippedX: layer.flippedX, flippedY: layer.flippedY, 
                        src: finalSrcPath, maskSrc: finalMaskPath 
                    });
                }
                
                this.draw(true);
                const finalRenderCanvas = document.createElement("canvas");
                finalRenderCanvas.width = this.canvas.width; finalRenderCanvas.height = this.canvas.height;
                const rCtx = finalRenderCanvas.getContext("2d");
                rCtx.fillStyle = "#1e1e1e"; 
                rCtx.fillRect(0,0,finalRenderCanvas.width, finalRenderCanvas.height);
                rCtx.drawImage(this.canvas, 0, 0); 
                const finalDataURL = finalRenderCanvas.toDataURL("image/png");
                this.draw(); 

                const finalMeta = { doc_w: this.docWidth, doc_h: this.docHeight, layers: layerMeta, composite_path: null, session_ver: 5.0 };
                const dFin = await PixaromaAPI.saveProject(this.projectID, finalDataURL);

                if (dFin.status === "success") {
                    finalMeta.composite_path = dFin.composite_path;
                    
                    const jsonString = JSON.stringify(finalMeta);
                    
                    if (this.onSave) {
                        this.onSave(jsonString, finalDataURL);
                    }
                    if (this._diskSavePending) { this._diskSavePending = false; if (this.onSaveToDisk) this.onSaveToDisk(finalDataURL); }

                    this._layout.setSaved();
                } else { 
                    alert("Server save failure: " + dFin.error); 
                }
            } catch (err) {
                console.error("Pixaroma Save Error:", err);
                this._layout.setSaveError("Save failed");
            }
        });

        this.canvas.addEventListener("mousedown", (e) => {
            if (e.button === 1 || this.spacePressed || this.overlay.id !== "pixaroma-editor-instance" || e.target !== this.canvas) return;
            const coords = this.getCanvasCoordinates(e);
            this.isMouseDown = true; this.startX = coords.x; this.startY = coords.y; this.lastX = coords.x; this.lastY = coords.y;
            this.interactionMode = null; this.canvas.style.cursor = 'default';

            if (this.activeMode === 'eraser') {
                 if(this.selectedLayerIds.size === 1) { 
                     this.setupEraserOnSelection(); this.ui.updateActiveLayerUI();
                 } else { this.isMouseDown = false; this.canvas.style.cursor = 'default'; }
            } else { this.onSelectMouseDown(e, coords); }
            this.draw();
        });

        // BUG FIX: When the mouse leaves the canvas element while erasing, commit the stroke
        // and reset isMouseDown. This prevents the eraser from continuing to draw out-of-bounds
        // strokes (which the mousemove bounds check stops), and ensures the tool never gets
        // stuck because the mouseup may have fired over another element that swallowed the event.
        this.canvas.addEventListener("mouseleave", () => {
            if (this.activeMode === 'eraser' && this.isMouseDown) {
                this.isMouseDown = false;
                this.canvas.style.cursor = 'crosshair';
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
                    this.canvas.style.cursor = 'default';
                    this.verifySelection();
                    this.ui.updateActiveLayerUI();
                    this.draw();
                    this.pushHistory();
                    return;
                }

                // BUG FIX: Handle pan separately so viewPanX/Y actually updates, and
                // so e.buttons===0 (mouse released outside browser) can escape the stuck state.
                if (this.isPanning) {
                    if (e.buttons === 0) { this.isPanning = false; this.workspace.classList.remove("panning"); }
                    else { this.viewPanX = e.clientX - this.panStartX; this.viewPanY = e.clientY - this.panStartY; this.updateViewTransform(); }
                    return;
                }
                if (this.overlay.id !== "pixaroma-editor-instance" || e.target.tagName === 'INPUT') return;
                
                const coords = this.getCanvasCoordinates(e);
                
                if(this.activeMode === 'eraser') {
                     this.ctx.setTransform(1, 0, 0, 1, 0, 0); 
                     this.draw(); 
                     this.drawEraserPreview(coords);
                     
                     if(this.isMouseDown && this.selectedLayerIds.size === 1) {
                          // BUG FIX: Only draw eraser stroke when the mouse is actually over the canvas
                          // element. Without this check, moving outside the canvas while erasing sends
                          // extreme out-of-bounds coordinates to drawEraserLine, causing heavy blur
                          // operations that lock up the browser and make the tool appear "stuck".
                          const canvasRect = this.canvas.getBoundingClientRect();
                          const isOverCanvas = e.clientX >= canvasRect.left && e.clientX <= canvasRect.right &&
                                               e.clientY >= canvasRect.top  && e.clientY <= canvasRect.bottom;
                          if (isOverCanvas) {
                              const layer = this.layers.find(l => l.id === Array.from(this.selectedLayerIds)[0]);
                              const startLayerCoords = this.getCoordinatesInLayerImage(layer, this.lastX, this.lastY);
                              const endLayerCoords = this.getCoordinatesInLayerImage(layer, coords.x, coords.y);
                              this.drawEraserLine(layer, startLayerCoords, endLayerCoords); 
                              this.draw();
                              this.lastX = coords.x; this.lastY = coords.y;
                          }
                          // When outside canvas, don't update lastX/lastY so the stroke resumes
                          // cleanly from the last valid in-canvas position if the mouse returns.
                     } else {
                         this.lastX = coords.x; this.lastY = coords.y;
                     }
                } else { this.onSelectMouseMove(e, coords); }
                
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
             if(this.isPanning) { this.isPanning = false; this.workspace.classList.remove("panning"); }
             if(this.isMouseDown) { this.isMouseDown = false; this.interactionMode = null; this.canvas.style.cursor = 'default'; this.verifySelection(); this.ui.updateActiveLayerUI(); this.draw(); this.pushHistory(); }
        };
        window.addEventListener("mouseup", this._composerMouseUp);
        // BUG FIX: If the browser window loses focus (alt-tab, clicking outside) while Space
        // is held or a drag is in progress, keyup/mouseup never fire. Reset all interaction
        // flags on blur so the tool is never stuck when focus returns.
        this._composerBlur = () => {
            this.spacePressed = false;
            if (this.isPanning) { this.isPanning = false; this.workspace.classList.remove("panning"); }
            if (this.isMouseDown) { this.isMouseDown = false; this.interactionMode = null; this.canvas.style.cursor = 'default'; }
        };
        window.addEventListener("blur", this._composerBlur);
    }

    onSelectMouseDown(e, coords) {
        if (this.selectedLayerIds.size === 1) {
            const layer = this.layers.find(l => l.id === Array.from(this.selectedLayerIds)[0]);
            if (layer && !layer.locked) {
                const pts = PixaromaLayers.getTransformedPoints(layer);
                if (Math.hypot(coords.x - pts[8].x, coords.y - pts[8].y) <= 15) this.interactionMode = 'rotate';
                else if (Math.hypot(coords.x - pts[4].x, coords.y - pts[4].y) <= 12) this.interactionMode = 'stretchL';
                else if (Math.hypot(coords.x - pts[5].x, coords.y - pts[5].y) <= 12) this.interactionMode = 'stretchR';
                else if (Math.hypot(coords.x - pts[6].x, coords.y - pts[6].y) <= 12) this.interactionMode = 'stretchT';
                else if (Math.hypot(coords.x - pts[7].x, coords.y - pts[7].y) <= 12) this.interactionMode = 'stretchB';
                else { for (let i = 0; i < 4; i++) if (Math.hypot(coords.x - pts[i].x, coords.y - pts[i].y) <= 15) this.interactionMode = 'scale'; }
                
                if (this.interactionMode) {
                    this.tempTransList = [{ id: layer.id, cx: layer.cx, cy: layer.cy, scaleX: layer.scaleX, scaleY: layer.scaleY, rotation: layer.rotation, startAngle: Math.atan2(coords.y - layer.cy, coords.x - layer.cx) * 180 / Math.PI, startDist: Math.hypot(coords.x - layer.cx, coords.y - layer.cy) }];
                    return;
                }
            }
        }

        let clickedLayerIndex = -1;
        for (let i = this.layers.length - 1; i >= 0; i--) { 
            const l = this.layers[i];
            if (l.visible && !l.locked && PixaromaLayers.isPointInLayer(coords.x, coords.y, l)) { clickedLayerIndex = i; break; } 
        }
        
        if (clickedLayerIndex !== -1) {
            const clickedLayer = this.layers[clickedLayerIndex];
            if (e.shiftKey || e.ctrlKey) {
                if (this.selectedLayerIds.has(clickedLayer.id)) this.selectedLayerIds.delete(clickedLayer.id);
                else this.selectedLayerIds.add(clickedLayer.id);
            } else if (e.altKey) {
                if (!this.selectedLayerIds.has(clickedLayer.id)) { this.selectedLayerIds.clear(); this.selectedLayerIds.add(clickedLayer.id); }
                const newLayers = [];
                this.layers.forEach(layer => {
                    if (this.selectedLayerIds.has(layer.id)) newLayers.push({ ...layer, id: Date.now().toString() + Math.random(), name: layer.name + " copy", cx: layer.cx + 20, cy: layer.cy + 20 });
                });
                this.layers.push(...newLayers);
                this.selectedLayerIds.clear(); newLayers.forEach(l => this.selectedLayerIds.add(l.id));
                this.pushHistory();
            } else {
                if (!this.selectedLayerIds.has(clickedLayer.id)) { this.selectedLayerIds.clear(); this.selectedLayerIds.add(clickedLayer.id); }
            }
        } else {
            if (!e.shiftKey && !e.ctrlKey && !e.altKey) this.selectedLayerIds.clear();
        }

        this.syncActiveLayerIndex();
        this.ui.updateActiveLayerUI();
        
        if (this.selectedLayerIds.size > 0 && clickedLayerIndex !== -1) {
            this.interactionMode = 'move'; 
            this.tempTransList = this.layers.filter(l => this.selectedLayerIds.has(l.id)).map(l => ({id: l.id, cx: l.cx, cy: l.cy}));
            this.canvas.style.cursor = 'move';
        }
    }

    onSelectMouseMove(e, coords) {
        if (!this.isMouseDown) {
            if (this.selectedLayerIds.size === 1) {
                const layer = this.layers.find(l => l.id === Array.from(this.selectedLayerIds)[0]);
                if (layer && !layer.locked) {
                    const pts = PixaromaLayers.getTransformedPoints(layer);
                    if (Math.hypot(coords.x - pts[8].x, coords.y - pts[8].y) <= 15) { this.canvas.style.cursor = 'crosshair'; return; } 
                    for (let i=0; i<4; i++) {
                        if (Math.hypot(coords.x - pts[i].x, coords.y - pts[i].y) <= 15) { 
                             this.canvas.style.cursor = (layer.rotation + 45) % 180 < 90 ? 'nwse-resize' : 'nesw-resize'; return; 
                        }
                    }
                    if (Math.hypot(coords.x - pts[4].x, coords.y - pts[4].y) <= 12) { this.canvas.style.cursor = 'w-resize'; return; }
                    if (Math.hypot(coords.x - pts[5].x, coords.y - pts[5].y) <= 12) { this.canvas.style.cursor = 'e-resize'; return; }
                    if (Math.hypot(coords.x - pts[6].x, coords.y - pts[6].y) <= 12) { this.canvas.style.cursor = 'n-resize'; return; }
                    if (Math.hypot(coords.x - pts[7].x, coords.y - pts[7].y) <= 12) { this.canvas.style.cursor = 's-resize'; return; }
                }
            }
            this.canvas.style.cursor = 'default'; return;
        }

        const dx = coords.x - this.startX; const dy = coords.y - this.startY;

        this.tempTransList.forEach(t => {
            const layer = this.layers.find(l => l.id === t.id);
            if (!layer || layer.locked) return;

            if (this.interactionMode === 'move') {
                layer.cx = t.cx + dx; layer.cy = t.cy + dy;
            } else if (this.interactionMode === 'rotate') {
                const currentAngle = Math.atan2(coords.y - t.cy, coords.x - t.cx) * 180 / Math.PI;
                let newAngle = t.rotation + (currentAngle - t.startAngle);
                if (e.shiftKey) newAngle = Math.round(newAngle / 15) * 15;
                layer.rotation = Math.round((newAngle + 360) % 360); 
                this.rotateSlider.value = layer.rotation; this.rotateNum.value = layer.rotation;
            } else if (this.interactionMode === 'scale') {
                const currentDist = Math.hypot(coords.x - t.cx, coords.y - t.cy);
                const scaleFactor = Math.max(0.01, currentDist / t.startDist);
                if (e.shiftKey) { 
                     layer.scaleX = Math.max(0.01, (t.cx - coords.x) * (layer.flippedX ? 1 : -1) / (layer.img.width / 2));
                     layer.scaleY = Math.max(0.01, (t.cy - coords.y) * (layer.flippedY ? 1 : -1) / (layer.img.height / 2));
                } else { 
                    layer.scaleX = t.scaleX * scaleFactor; layer.scaleY = t.scaleY * scaleFactor;
                }
                this.scaleSlider.value = Math.round(layer.scaleX * 100); this.scaleNum.value = Math.round(layer.scaleX * 100);
            } 
            else if (this.interactionMode.startsWith('stretch')) {
                const currentDist = Math.hypot(coords.x - t.cx, coords.y - t.cy);
                const scaleFactor = Math.max(0.01, currentDist / t.startDist);
                
                if (this.interactionMode === 'stretchL' || this.interactionMode === 'stretchR') {
                    layer.scaleX = t.scaleX * scaleFactor;
                    this.stretchHSlider.value = Math.round(layer.scaleX * 100);
                    this.stretchHNum.value = Math.round(layer.scaleX * 100);
                } else if (this.interactionMode === 'stretchT' || this.interactionMode === 'stretchB') {
                    layer.scaleY = t.scaleY * scaleFactor;
                    this.stretchVSlider.value = Math.round(layer.scaleY * 100);
                    this.stretchVNum.value = Math.round(layer.scaleY * 100);
                }
            }
        });
        
        this.draw();
    }

    draw(cleanRender = false) {
        const bg = this._bgColor || "#1e1e1e";
        if (cleanRender) {
             this.ctx.fillStyle = bg;
             this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        } else {
             this.ctx.fillStyle = bg;
             this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
        
        this.ctx.imageSmoothingEnabled = true; this.ctx.imageSmoothingQuality = 'high';

        this.layers.forEach((layer) => {
            if (!layer.visible) return; 

            const isSelected = this.selectedLayerIds.has(layer.id);
            this.ctx.save(); this.ctx.globalAlpha = layer.opacity;
            // Blend mode support (maps to canvas globalCompositeOperation)
            const blendMap = { "Normal":"source-over", "Multiply":"multiply", "Screen":"screen", "Overlay":"overlay", "Darken":"darken", "Lighten":"lighten", "Color Dodge":"color-dodge", "Color Burn":"color-burn", "Hard Light":"hard-light", "Soft Light":"soft-light", "Difference":"difference", "Exclusion":"exclusion", "Hue":"hue", "Saturation":"saturation", "Color":"color", "Luminosity":"luminosity" };
            if (layer.blendMode && blendMap[layer.blendMode]) this.ctx.globalCompositeOperation = blendMap[layer.blendMode];

            this.ctx.translate(layer.cx, layer.cy);
            this.ctx.rotate(layer.rotation * Math.PI / 180);
            
            this.ctx.save();
            this.ctx.scale(layer.flippedX ? -1 : 1, layer.flippedY ? -1 : 1); 
            const w = layer.img.width * layer.scaleX; const h = layer.img.height * layer.scaleY;
            
            // NON-DESTRUCTIVE MASK RENDER
            if (layer.hasMask_internal && layer.eraserMaskCanvas_internal) {
                this.renderCanvas.width = layer.img.width; this.renderCanvas.height = layer.img.height;
                this.renderCtx.clearRect(0, 0, this.renderCanvas.width, this.renderCanvas.height);
                
                this.renderCtx.drawImage(layer.img, 0, 0); 
                this.renderCtx.globalCompositeOperation = 'destination-out';
                this.renderCtx.drawImage(layer.eraserMaskCanvas_internal, 0, 0); 
                this.renderCtx.globalCompositeOperation = 'source-over';
                
                this.ctx.drawImage(this.renderCanvas, -w/2, -h/2, w, h);
            } else {
                 this.ctx.drawImage(layer.img, -w/2, -h/2, w, h);
            }
            
            this.ctx.restore();
            
            if (!cleanRender && isSelected) {
                this.ctx.strokeStyle = layer.locked ? '#888' : (this.selectedLayerIds.size > 1 ? '#0ea5e9' : '#f66744'); 
                this.ctx.lineWidth = 1.5;
                this.ctx.strokeRect(-w/2, -h/2, w, h);
                
                if (!layer.locked && this.selectedLayerIds.size === 1 && this.activeMode !== 'eraser') {
                    const sz = this.handleSize;
                    this.ctx.fillStyle = '#fff'; this.ctx.strokeStyle = '#f66744'; this.ctx.lineWidth = 1;
                    
                    const corners = [ {x:-w/2, y:-h/2}, {x:w/2, y:-h/2}, {x:w/2, y:h/2}, {x:-w/2, y:h/2} ];
                    corners.forEach(p => {
                        this.ctx.beginPath(); this.ctx.arc(p.x, p.y, sz/2, 0, Math.PI * 2); this.ctx.fill(); this.ctx.stroke();
                    });
                    
                    this.ctx.fillStyle = '#fff'; this.ctx.lineWidth = 1;
                    this.ctx.beginPath(); this.ctx.moveTo(0, -h/2); this.ctx.lineTo(0, -h/2 - 30); this.ctx.stroke();
                    this.ctx.beginPath(); this.ctx.arc(0, -h/2 - 30, sz/1.2, 0, Math.PI * 2);
                    this.ctx.fillStyle = '#f66744'; this.ctx.fill(); this.ctx.stroke();
                    this.ctx.fillStyle = '#fff'; this.ctx.font = '12px Arial'; this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle';
                    this.ctx.fillText('↻', 0, -h/2 - 29);
                    
                    this.ctx.fillStyle = '#f66744'; this.ctx.strokeStyle = '#fff'; this.ctx.lineWidth = 1;
                    const sides = [ {x:-w/2, y:0}, {x:w/2, y:0}, {x:0, y:-h/2}, {x:0, y:h/2} ];
                    sides.forEach(p => {
                        this.ctx.beginPath(); this.ctx.arc(p.x, p.y, sz/2, 0, Math.PI * 2); this.ctx.fill(); this.ctx.stroke();
                    });
                }
            }
            this.ctx.restore();
        });
        this.ctx.globalAlpha = 1.0;
    }

    async attemptRestore() {
        let savedData = null;
        const composerWidget = (this.node.widgets || []).find(w => w.name === "ComposerWidget");
        if (composerWidget && composerWidget.value && composerWidget.value.project_json) {
            savedData = composerWidget.value.project_json;
        }

        if (!savedData || savedData === "{}" || savedData === "") return;
        
        // BUG FIX: this.statusText was referenced here but never created in ui.build(),
        // causing an uncaught TypeError that silently aborted the entire restore function
        // before the try/catch block below. Guard with optional chaining.
        if (this.statusText) this.statusText.innerText = "⏳ Restoring session...";
        this.overlay.style.pointerEvents = "none"; this.overlay.style.opacity = "0.5";

        try {
            if (typeof savedData !== "string") savedData = JSON.stringify(savedData);
            const meta = JSON.parse(savedData);
            
            this.docWidth = meta.doc_w; this.docHeight = meta.doc_h;
            if (this._canvasSettings) this._canvasSettings.setSize(meta.doc_w, meta.doc_h);
            
            this.canvasContainer.style.width = this.docWidth + "px";
            this.canvasContainer.style.height = this.docHeight + "px";
            this.canvas.width = this.docWidth; this.canvas.height = this.docHeight;

            const layersToLoad = meta.layers;
            let loadedCount = 0;
            if (!layersToLoad || layersToLoad.length === 0) { this.finishRestore(); return; }

            this.layers = new Array(layersToLoad.length);

            layersToLoad.forEach((mLayer, i) => {
                const img = new Image();
                img.crossOrigin = "Anonymous";
                const fileNameOnly = mLayer.src ? mLayer.src.split(/[\\/]/).pop() : '';
                
                img.onload = () => {
                    this.layers[i] = { id: mLayer.id, name: mLayer.name, img: img, cx: mLayer.cx, cy: mLayer.cy, scaleX: mLayer.scaleX, scaleY: mLayer.scaleY, rotation: mLayer.rotation, opacity: mLayer.opacity, visible: mLayer.visible, locked: mLayer.locked, flippedX: mLayer.flippedX, flippedY: mLayer.flippedY, rawB64_internal: null, rawServerPath: mLayer.src, savedOnServer: true, savedMaskPath_internal: mLayer.maskSrc || null };
                    loadedCount++; if (loadedCount === layersToLoad.length) this.finishRestore();
                };

                img.onerror = () => {
                    const tempCanvas = document.createElement("canvas"); tempCanvas.width=512; tempCanvas.height=512; const tCtx = tempCanvas.getContext("2d");
                    tCtx.fillStyle = "#333"; tCtx.fillRect(0,0,512,512); tCtx.strokeStyle = "red"; tCtx.lineWidth = 10; tCtx.strokeRect(0,0,512,512);
                    tCtx.fillStyle = "white"; tCtx.font = "bold 30px Arial"; tCtx.fillText("Missing Image", 150, 256);
                    const placeholder = new Image();
                    placeholder.onload = () => {
                         this.layers[i] = { id: mLayer.id, name: mLayer.name + " (Missing)", img: placeholder, cx: mLayer.cx, cy: mLayer.cy, scaleX: mLayer.scaleX, scaleY: mLayer.scaleY, rotation: mLayer.rotation, opacity: mLayer.opacity, visible: mLayer.visible, locked: mLayer.locked, flippedX: mLayer.flippedX, flippedY: mLayer.flippedY, rawB64_internal: null, rawServerPath: mLayer.src, savedOnServer: true, savedMaskPath_internal: mLayer.maskSrc || null };
                         loadedCount++; if (loadedCount === layersToLoad.length) this.finishRestore(true);
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

    finishRestore(hadError=false) {
        this.layers.forEach(l => {
            if(l.savedMaskPath_internal) {
                const maskFileName = l.savedMaskPath_internal.split(/[\\/]/).pop();
                const maskUrl = `/view?filename=${encodeURIComponent(maskFileName)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
                this.prepareLayerMask(l, maskUrl);
            }
        });
        
        this.overlay.style.pointerEvents = "auto"; this.overlay.style.opacity = "1";
        if (this.statusText) this.statusText.innerText = hadError ? "Ready (Some images missing)." : "Session restored.";
        this.fitViewToWorkspace(); this.ui.updateActiveLayerUI(); this.draw();
        
        this.history = []; this.historyIndex = -1; this.pushHistory();
    }
}