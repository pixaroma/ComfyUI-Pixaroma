// Event binding, alignment, keyboard, mouse, transforms — mixed into PixaromaEditor.prototype
import { PixaromaEditor } from "./core.mjs";
import { PixaromaLayers } from "./layers.mjs";
import { PixaromaAPI } from "./api.mjs";

PixaromaEditor.prototype.attachEvents = function () {
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
    const selectedLayers = this.layers.filter(
      (l) => this.selectedLayerIds.has(l.id) && !l.locked && !l.isAdjustment,
    );
    if (selectedLayers.length === 0) return;

    const boundsList = selectedLayers.map((l) => ({
      layer: l,
      bounds: getBounds(l),
    }));
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

    if (type === "DistH" && selectedLayers.length >= 2) {
      boundsList.sort((a, b) => a.bounds.cx - b.bounds.cx);
      if (selectedLayers.length === 2) {
        const step = this.docWidth / 3;
        boundsList[0].layer.cx = step;
        boundsList[1].layer.cx = step * 2;
      } else {
        const first = boundsList[0];
        const last = boundsList[boundsList.length - 1];
        const step =
          (last.bounds.cx - first.bounds.cx) / (boundsList.length - 1);
        boundsList.forEach((b, i) => {
          if (i > 0 && i < boundsList.length - 1)
            b.layer.cx = first.bounds.cx + step * i;
        });
      }
    }

    if (type === "DistV" && selectedLayers.length >= 2) {
      boundsList.sort((a, b) => a.bounds.cy - b.bounds.cy);
      if (selectedLayers.length === 2) {
        const step = this.docHeight / 3;
        boundsList[0].layer.cy = step;
        boundsList[1].layer.cy = step * 2;
      } else {
        const first = boundsList[0];
        const last = boundsList[boundsList.length - 1];
        const step =
          (last.bounds.cy - first.bounds.cy) / (boundsList.length - 1);
        boundsList.forEach((b, i) => {
          if (i > 0 && i < boundsList.length - 1)
            b.layer.cy = first.bounds.cy + step * i;
        });
      }
    }

    this.pushHistory();
    this.draw();
  };

  // Align buttons are in titlebar center (set via framework)
  const ab = this._layout?.titlebarCenter || this.workspace;
  const qb = (id) => ab.querySelector(id) || this.overlay.querySelector(id);
  const alignBtn = qb("#btnAlignL");
  if (alignBtn) alignBtn.onclick = () => alignSelection("L");
  const alignCH = qb("#btnAlignCH");
  if (alignCH) alignCH.onclick = () => alignSelection("CH");
  const alignR = qb("#btnAlignR");
  if (alignR) alignR.onclick = () => alignSelection("R");
  const alignT = qb("#btnAlignT");
  if (alignT) alignT.onclick = () => alignSelection("T");
  const alignCV = qb("#btnAlignCV");
  if (alignCV) alignCV.onclick = () => alignSelection("CV");
  const alignB = qb("#btnAlignB");
  if (alignB) alignB.onclick = () => alignSelection("B");
  const distH = qb("#btnDistH");
  if (distH) distH.onclick = () => alignSelection("DistH");
  const distV = qb("#btnDistV");
  if (distV) distV.onclick = () => alignSelection("DistV");

  this.workspace.addEventListener("wheel", (e) => {
    e.preventDefault();

    // Shift+Wheel: uniformly scale the selected (unlocked) layers, mirroring
    // the Scale slider's behaviour. ±5% per tick. Slider range is 5..300% so
    // clamp the result to that.
    if (e.shiftKey && this.selectedLayerIds.size > 0) {
      const factor = e.deltaY > 0 ? 0.95 : 1.05;
      let touched = false;
      this.layers.forEach((layer) => {
        if (this.selectedLayerIds.has(layer.id) && !layer.locked) {
          layer.scaleX = Math.max(0.05, Math.min(3.0, layer.scaleX * factor));
          layer.scaleY = Math.max(0.05, Math.min(3.0, layer.scaleY * factor));
          touched = true;
        }
      });
      if (touched) {
        // Sync the Transform Properties sliders to the first selected layer
        const firstId = Array.from(this.selectedLayerIds)[0];
        const layer = this.layers.find((l) => l.id === firstId);
        if (layer) {
          const sx = Math.round(layer.scaleX * 100);
          const sy = Math.round(layer.scaleY * 100);
          this.scaleSlider.value = sx;
          this.scaleNum.value = sx;
          this.stretchHSlider.value = sx;
          this.stretchHNum.value = sx;
          this.stretchVSlider.value = sy;
          this.stretchVNum.value = sy;
        }
        if (!this._wheelRAF) {
          this._wheelRAF = requestAnimationFrame(() => {
            this._wheelRAF = null;
            this.draw();
          });
        }
        // Debounce history push so a wheel-burst is one undo step. Text layers
        // re-bake the bitmap crisp (fold scale into font size) once it settles.
        clearTimeout(this._scaleWheelTimer);
        this._scaleWheelTimer = setTimeout(() => {
          if (!this._commitTextScaleFold()) this.pushHistory();
        }, 300);
      }
      return;
    }

    this.viewZoom *= e.deltaY > 0 ? 0.9 : 1.1;
    // Throttle transform updates to once per frame
    if (!this._wheelRAF) {
      this._wheelRAF = requestAnimationFrame(() => {
        this._wheelRAF = null;
        this.updateViewTransform();
      });
    }
  });

  this._composerKeyDown = (e) => {
    const tag = e.target?.tagName;
    if (
      (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") &&
      !e.target?.dataset?.pixaromaTrap
    ) {
      // After dragging a range slider it keeps focus, which would swallow
      // Ctrl+Z/Y. Range sliders have no native undo, so let those specific
      // shortcuts fall through to the editor handler.
      const isRangeSlider = tag === "INPUT" && e.target.type === "range";
      const k = e.key?.toLowerCase();
      const isUndoRedo = e.ctrlKey && (k === "z" || k === "y");
      if (!(isRangeSlider && isUndoRedo)) return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      this.spacePressed = true;
    }
    if (e.code === "KeyE") {
      e.preventDefault();
      if (this.activeMode === "eraser") {
        this.setMode(null);
      } else if (this.selectedLayerIds.size === 1) {
        // Eraser is image-only: text + FX have no editable pixels, and a
        // placeholder is a UI tile whose mask would misapply to the real image.
        const al = this.getActiveLayer();
        if (al && (al.isText || al.isAdjustment || al.isPlaceholder)) {
          if (this._layout)
            this._layout.setStatus("Eraser doesn't apply to this layer", "warn");
        } else {
          this.setMode("eraser");
        }
      } else if (this.selectedLayerIds.size > 1) {
        if (this._layout)
          this._layout.setStatus(
            "Eraser requires a single layer selected",
            "warn",
          );
      }
    }
    if (e.code === "KeyC" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (this.activeMode === "crop") {
        this.setMode(null);
      } else if (this.selectedLayerIds.size === 1) {
        // Crop is image-only: not for text, FX, or placeholder layers.
        const al = this.getActiveLayer();
        if (al && (al.isText || al.isAdjustment || al.isPlaceholder)) {
          if (this._layout)
            this._layout.setStatus("Crop doesn't apply to this layer", "warn");
        } else {
          this.setMode("crop");
        }
      } else if (this.selectedLayerIds.size > 1) {
        if (this._layout)
          this._layout.setStatus(
            "Crop requires a single layer selected",
            "warn",
          );
      }
    }
    if (e.code === "KeyV" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this.setMode(null);
    }
    // X swaps Erase <-> Restore while the eraser tool is active.
    if (e.code === "KeyX" && !e.ctrlKey && !e.metaKey) {
      if (this.activeMode === "eraser") {
        e.preventDefault();
        this.eraserSubMode =
          this.eraserSubMode === "erase" ? "restore" : "erase";
        if (this.eraserModePills)
          this.eraserModePills.setActive(this.eraserSubMode);
        this._refreshEraserPreview();
      }
    }
    // Holding Alt temporarily flips the brush (erase <-> restore). The
    // preventDefault stops the browser's menu-bar focus on a bare Alt tap.
    if (e.key === "Alt" && this.activeMode === "eraser") {
      e.preventDefault();
      if (!this._eraserAltHeld) {
        this._eraserAltHeld = true;
        this._refreshEraserPreview();
      }
    }
    const key = e.key.toLowerCase();
    if (e.ctrlKey && key === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    }
    if (e.ctrlKey && key === "y") {
      e.preventDefault();
      this.redo();
    }
    if (e.ctrlKey && key === "s") {
      e.preventDefault();
      if (this.saveBtn) this.saveBtn.click();
    }
    if (e.ctrlKey && key === "a") {
      e.preventDefault();
      this.selectedLayerIds.clear();
      this.layers.forEach((l) => this.selectedLayerIds.add(l.id));
      this.syncActiveLayerIndex();
      this.ui.updateActiveLayerUI();
      this.draw();
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.btnDelLayer.click();
    }
  };
  this._composerKeyUp = (e) => {
    if (e.code === "Space") {
      this.spacePressed = false;
      this.workspace.classList.remove("panning");
    }
    if (e.key === "Alt" && this._eraserAltHeld) {
      this._eraserAltHeld = false;
      // Only repaint when the eraser is live (Alt can be released after
      // exiting eraser mode - clearing the flag is all that's needed then).
      if (this.activeMode === "eraser") this._refreshEraserPreview();
    }
  };
  window.addEventListener("keydown", this._composerKeyDown, { capture: true });
  window.addEventListener("keyup", this._composerKeyUp, { capture: true });

  this._composerMouseMove = null;
  this._composerMouseUp = null;
  this._composerBlur = null;

  this._cleanupKeys = () => {
    window.removeEventListener("keydown", this._composerKeyDown, {
      capture: true,
    });
    window.removeEventListener("keyup", this._composerKeyUp, { capture: true });
    if (this._composerMouseMove)
      window.removeEventListener("mousemove", this._composerMouseMove);
    if (this._composerMouseUp)
      window.removeEventListener("mouseup", this._composerMouseUp);
    if (this._composerBlur)
      window.removeEventListener("blur", this._composerBlur);
    // Restore the Ctrl+Z graph-undo neutering installed at open (Vue Compat #6).
    this._restoreGraphPatches?.();
  };

  // Handle hover cursor + clicks on the extended hit area outside canvas bounds
  if (this.selHitArea) {
    this.selHitArea.addEventListener("mousemove", (e) => {
      // Crop mode: show resize cursors based on the crop box, not the layer's
      // transform handles.
      if (this.activeMode === "crop") {
        this.selHitArea.style.cursor = this.cropCursorFor(
          this.getCanvasCoordinates(e),
        );
        return;
      }
      if (
        this.isMouseDown ||
        this.selectedLayerIds.size !== 1 ||
        this.activeMode === "eraser"
      ) {
        this.selHitArea.style.cursor = "default";
        return;
      }
      const coords = this.getCanvasCoordinates(e);
      const layer = this.getActiveLayer();
      if (layer && !layer.locked && layer.img) {
        const pts = PixaromaLayers.getTransformedPoints(layer);
        if (Math.hypot(coords.x - pts[8].x, coords.y - pts[8].y) <= 15) {
          this.selHitArea.style.cursor = "crosshair";
          return;
        }
        for (let i = 0; i < 4; i++) {
          if (Math.hypot(coords.x - pts[i].x, coords.y - pts[i].y) <= 15) {
            this.selHitArea.style.cursor =
              (layer.rotation + 45) % 180 < 90 ? "nwse-resize" : "nesw-resize";
            return;
          }
        }
        if (Math.hypot(coords.x - pts[4].x, coords.y - pts[4].y) <= 12) {
          this.selHitArea.style.cursor = "w-resize";
          return;
        }
        if (Math.hypot(coords.x - pts[5].x, coords.y - pts[5].y) <= 12) {
          this.selHitArea.style.cursor = "e-resize";
          return;
        }
        if (Math.hypot(coords.x - pts[6].x, coords.y - pts[6].y) <= 12) {
          this.selHitArea.style.cursor = "n-resize";
          return;
        }
        if (Math.hypot(coords.x - pts[7].x, coords.y - pts[7].y) <= 12) {
          this.selHitArea.style.cursor = "s-resize";
          return;
        }
      }
      this.selHitArea.style.cursor = "default";
    });

    this.selHitArea.addEventListener("mousedown", (e) => {
      if (e.button === 1 || this.spacePressed) return; // let it bubble for pan
      // Crop mode: grab a crop handle if the box extends into the padding
      // region. Never pan/deselect here (that would exit crop).
      if (this.activeMode === "crop" && e.button === 0) {
        const cc = this.getCanvasCoordinates(e);
        const p = this._cropPointInSource(cc);
        const hd = this._cropHitTest(p.lx, p.ly);
        if (hd) {
          e.preventDefault();
          e.stopPropagation();
          this._cropDragHandle = hd;
          this._cropDragStart = { lx: p.lx, ly: p.ly, rect: { ...this._cropDraft } };
          this.isMouseDown = true;
        }
        return;
      }
      // Check for handle grab
      if (
        e.button === 0 &&
        this.selectedLayerIds.size === 1 &&
        this.activeMode !== "eraser"
      ) {
        const coords = this.getCanvasCoordinates(e);
        const layer = this.getActiveLayer();
        if (layer && !layer.locked && layer.img) {
          const pts = PixaromaLayers.getTransformedPoints(layer);
          let hitHandle = false;
          if (Math.hypot(coords.x - pts[8].x, coords.y - pts[8].y) <= 15)
            hitHandle = true;
          for (let i = 0; i < 4; i++)
            if (Math.hypot(coords.x - pts[i].x, coords.y - pts[i].y) <= 15)
              hitHandle = true;
          for (let i = 4; i < 8; i++)
            if (Math.hypot(coords.x - pts[i].x, coords.y - pts[i].y) <= 12)
              hitHandle = true;
          if (hitHandle) {
            e.preventDefault();
            e.stopPropagation();
            this.isMouseDown = true;
            this.startX = coords.x;
            this.startY = coords.y;
            this.lastX = coords.x;
            this.lastY = coords.y;
            this.interactionMode = null;
            this.canvas.style.cursor = "default";
            this.onSelectMouseDown(e, coords);
            this.draw();
            return;
          }
        }
      }
      // No handle — act like workspace click (deselect + pan)
      e.preventDefault();
      e.stopPropagation();
      this.isPanning = true;
      this.panStartX = e.clientX - this.viewPanX;
      this.panStartY = e.clientY - this.viewPanY;
      this.workspace.classList.add("panning");
      this.selectedLayerIds.clear();
      this.syncActiveLayerIndex();
      this.ui.updateActiveLayerUI();
      this.draw();
    });
  }

  this.workspace.addEventListener("mousedown", (e) => {
    if (e.button === 1 || this.spacePressed || e.target === this.workspace) {
      e.preventDefault();
      this.isPanning = true;
      this.panStartX = e.clientX - this.viewPanX;
      this.panStartY = e.clientY - this.viewPanY;
      this.workspace.classList.add("panning");
    }
    if (e.target === this.workspace) {
      this.selectedLayerIds.clear();
      this.syncActiveLayerIndex();
      this.ui.updateActiveLayerUI();
      this.draw();
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
  syncSliderStandard(
    this.brushHardnessSlider,
    this.brushHardnessNum,
    "hardness",
    100,
  );

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
          blur: 0,
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
          this.docWidth,
          this.docHeight,
          "width",
        );
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
    slider.addEventListener("change", () => {
      // Text layers: a scale change re-renders the bitmap crisp (fold into font
      // size), matching the canvas corner handles. Other props just commit.
      if (prop === "scale" && this._commitTextScaleFold()) return;
      this.pushHistory();
    });
    num.addEventListener("change", (e) => {
      let v = parseFloat(e.target.value);
      v = Math.max(slider.min, Math.min(slider.max, v));
      num.value = v;
      slider.value = v;
      updateCanvas(v);
      if (prop === "scale" && this._commitTextScaleFold()) return;
      this.pushHistory();
    });
  };

  syncSliderTrans(this.opacitySlider, this.opacityNum, "opacity", 100);
  syncSliderTrans(this.rotateSlider, this.rotateNum, "rotation", 1);
  syncSliderTrans(this.scaleSlider, this.scaleNum, "scale", 100);
  syncSliderTrans(this.blurSlider, this.blurNum, "blur", 1);

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
    slider.addEventListener("change", () => {
      if (this._commitTextScaleFold()) return; // text: re-render crisp at new size
      this.pushHistory();
    });
    num.addEventListener("change", (e) => {
      let v = parseFloat(e.target.value);
      v = Math.max(slider.min, Math.min(slider.max, v));
      num.value = v;
      slider.value = v;
      updateCanvas(v);
      if (this._commitTextScaleFold()) return;
      this.pushHistory();
    });
  };

  syncSliderStretch(this.stretchHSlider, this.stretchHNum, "scaleX", 100);
  syncSliderStretch(this.stretchVSlider, this.stretchVNum, "scaleY", 100);

  this.btnFitW.onclick = () =>
    this.applyToSelection((l) =>
      PixaromaLayers.fitLayerToCanvas(
        l,
        this.docWidth,
        this.docHeight,
        "width",
      ),
    );
  this.btnFitH.onclick = () =>
    this.applyToSelection((l) =>
      PixaromaLayers.fitLayerToCanvas(
        l,
        this.docWidth,
        this.docHeight,
        "height",
      ),
    );
  this.btnFlipH.onclick = () =>
    this.applyToSelection((l) => (l.flippedX = !l.flippedX));
  this.btnFlipV.onclick = () =>
    this.applyToSelection((l) => (l.flippedY = !l.flippedY));
  this.btnRotLeft.onclick = () =>
    this.applyToSelection((l) => (l.rotation = (l.rotation - 90 + 360) % 360));
  this.btnRotRight.onclick = () =>
    this.applyToSelection((l) => (l.rotation = (l.rotation + 90) % 360));
  this.btnReset.onclick = () => {
    this.applyToSelection((l) => {
      l.rotation = 0;
      l.flippedX = false;
      l.flippedY = false;
      l.opacity = 1;
      l.blur = 0;
      PixaromaLayers.fitLayerToCanvas(
        l,
        this.docWidth,
        this.docHeight,
        "width",
      );
    });
    // Sync the Transform Properties sliders (rotate/scale/opacity/blur)
    // to the reset values. applyToSelection only redraws + pushes history.
    this.ui.updateActiveLayerUI();
  };

  this.btnDupLayer.onclick = () => {
    if (this.selectedLayerIds.size === 0) return;
    // Commit any in-progress crop first so the duplicate captures the applied
    // result (and _cropLayer doesn't dangle onto the original after the spread).
    if (this.activeMode === "crop") this.setMode(null);
    const usedPH = new Set(this.layers.filter((l) => l.isPlaceholder).map((l) => l.inputIndex));
    const nextPHIdx = () => { let i = 1; while (usedPH.has(i)) i++; usedPH.add(i); return i; };
    const newLayers = [];
    this.layers.forEach((layer) => {
      if (this.selectedLayerIds.has(layer.id)) {
        const dup = { ...layer, id: Date.now().toString() + Math.random(), cx: layer.cx + 20, cy: layer.cy + 20 };
        // Deep-copy cropRect so re-cropping one copy can't alias the other.
        if (layer.cropRect) dup.cropRect = { ...layer.cropRect };
        // Deep-copy FX adjustments + text state so editing one copy doesn't
        // alias the other (they're objects; {...layer} shares them by reference).
        if (layer.adjustments) dup.adjustments = { ...layer.adjustments };
        if (layer.textState) dup.textState = { ...layer.textState };
        // Deep-copy eraser mask so edits don't affect the original
        if (layer.eraserMaskCanvas_internal) {
          const mc = document.createElement("canvas");
          mc.width = layer.eraserMaskCanvas_internal.width;
          mc.height = layer.eraserMaskCanvas_internal.height;
          const mctx = mc.getContext("2d");
          mctx.drawImage(layer.eraserMaskCanvas_internal, 0, 0);
          dup.eraserMaskCanvas_internal = mc;
          dup.eraserMaskCtx_internal = mctx;
        }
        if (layer.isPlaceholder) {
          const newIdx = nextPHIdx();
          const newName = `image_${newIdx}`;
          dup.inputIndex = newIdx;
          dup.name = newName;
          dup.img = this._makePlaceholderImage(layer.img.width, layer.img.height, layer.placeholderColor, newName, (bitmapImg) => {
            dup.img = bitmapImg;
          });
        } else {
          dup.name = layer.name + " copy";
        }
        newLayers.push(dup);
      }
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
    // Keep locked layers even if they're part of the selection.
    this.layers = this.layers.filter((l) => !this.selectedLayerIds.has(l.id) || l.locked);
    this.selectedLayerIds.clear();
    this.syncActiveLayerIndex();
    this.ui.updateActiveLayerUI();
    this.draw();
    this.pushHistory();
  });

  this.removeBgBtn.addEventListener("click", async () => {
    if (this.selectedLayerIds.size === 0) return;
    // Commit any in-progress crop so we operate on the applied (cropped) image,
    // and so the post-rembg crop reset below has a settled starting point.
    if (this.activeMode === "crop") this.setMode(null);
    const layer = this.getActiveLayer();
    if (!layer || !layer.img) {
      if (this._layout)
        this._layout.setStatus("Cannot remove background: no layer selected");
      return;
    }
    const checkCvs = document.createElement("canvas");
    checkCvs.width = layer.img.width;
    checkCvs.height = layer.img.height;
    const checkCtx = checkCvs.getContext("2d");
    checkCtx.drawImage(layer.img, 0, 0);
    const pixels = checkCtx.getImageData(
      0,
      0,
      checkCvs.width,
      checkCvs.height,
    ).data;
    let hasContent = false;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] > 0) {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) {
      if (this._layout)
        this._layout.setStatus("Layer is empty \u2014 nothing to remove");
      return;
    }
    const originalText = this.removeBgBtn.innerText;
    this.removeBgBtn.innerText = "Processing... please wait";
    this.removeBgBtn.disabled = true;
    if (this._layout)
      this._layout.setStatus(
        "AI Remove Background: processing selected layer...",
      );
    console.log("[Pixaroma] AI Remove Background: starting...");

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = layer.img.width;
    tempCanvas.height = layer.img.height;
    tempCanvas.getContext("2d").drawImage(layer.img, 0, 0);
    try {
      const data = await PixaromaAPI.removeBg(
        tempCanvas.toDataURL("image/png"),
        // Prefer per-layer model choice, then the panel selection,
        // then fall back to auto (server picks best).
        layer.bgRemovalQuality || this._bgRemovalQuality || "auto",
      );
      if (data.code === "REMBG_MISSING") {
        if (this._layout)
          this._layout.setStatus(
            "rembg not installed \u2014 see Help for instructions",
          );
        console.warn(
          "[Pixaroma] rembg library not installed. Run: python.exe -m pip install rembg",
        );
        alert(
          "Remove BG \u2014 Missing Dependency\n\n" +
            "The rembg library is not installed. To install it:\n\n" +
            "1. Open your main ComfyUI folder and go inside the  python_embeded  folder.\n" +
            "2. Click in the file path/address bar at the top of the folder window.\n" +
            "3. Type  cmd  and press Enter. A black command prompt window will open directly in that folder.\n" +
            "4. Copy and paste the following command, then press Enter:\n\n" +
            "       python.exe -m pip install rembg\n\n" +
            "After installation is complete, restart ComfyUI and try again.",
        );
      } else if (data.error) {
        if (this._layout)
          this._layout.setStatus("AI Remove Background failed: " + data.error);
        console.error("[Pixaroma] AI Remove BG error:", data.error);
      } else {
        console.log(
          "[Pixaroma] AI Remove Background: success, applying result...",
        );
        const newImg = new Image();
        newImg.crossOrigin = "Anonymous";
        newImg.onload = () => {
          // The POST + decode is async: bail if the editor was closed or the
          // layer deleted meanwhile, so we don't write to a dead layer or fire
          // draw()/pushHistory() onto a stale (or freshly-reopened) session.
          if (!this.overlay?.isConnected || !this.layers.some((l) => l.id === layer.id)) {
            return;
          }
          layer.img = newImg;
          layer.rawB64_internal = data.image;
          layer.savedOnServer = false;
          // The bg-removed result is the cropped pixels with background gone.
          // Make it the new full source and clear the crop so the invariant
          // (layer.img === crop(sourceImg, cropRect)) holds - otherwise a later
          // re-crop or Reset Crop would re-bake from the pre-rembg source and
          // silently discard the background removal.
          layer.sourceImg = newImg;
          layer.cropRect = null;
          layer._cropMaskOriginX = 0;
          layer._cropMaskOriginY = 0;
          this.draw();
          this.pushHistory();
          // Surface the real model name the server used — on "auto"
          // this tells the user whether BiRefNet / isnet / u2net won
          // the fallback chain, so they know what quality to expect.
          const used = data.modelUsed ? ` (${data.modelUsed})` : "";
          if (this._layout)
            this._layout.setStatus("Background removed" + used);
          console.log("[Pixaroma] AI Remove Background: done" + used);
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
    // Commit any in-progress crop before serializing so a mid-crop Save
    // captures the dragged box (setMode(null) → exitCropMode applies it).
    if (this.activeMode === "crop") this.setMode(null);
    this._layout.setSaving();

    try {
      // Upload all unsaved layers and masks in parallel
      const uploadPromises = this.layers.map(async (layer) => {
        // FX adjustment layer: no image to upload — serialize just its values.
        if (layer.isAdjustment) {
          return {
            id: layer.id,
            name: layer.name,
            isAdjustment: true,
            adjustments: { ...layer.adjustments },
            presetId: layer.presetId || "Custom",
            visible: layer.visible,
            opacity: layer.opacity ?? 1,
            locked: !!layer.locked,
          };
        }
        let finalSrcPath = layer.rawServerPath || null;
        if (!layer.savedOnServer && layer.rawB64_internal) {
          const dRaw = await PixaromaAPI.uploadLayer(
            layer.id,
            layer.rawB64_internal,
          );
          finalSrcPath = dRaw.path;
          layer.rawServerPath = finalSrcPath;
          layer.savedOnServer = true;
        }

        let finalMaskPath = layer.savedMaskPath_internal || null;
        if (layer.hasMask_internal && layer.eraserMaskCanvas_internal) {
          // Only re-upload when the mask actually changed (or was never
          // uploaded). Otherwise every Save would write a new timestamped
          // mask file forever, none of them ever cleaned up.
          if (layer.maskDirty_internal || !layer.savedMaskPath_internal) {
            const maskB64 =
              layer.eraserMaskCanvas_internal.toDataURL("image/png");
            const dMask = await PixaromaAPI.uploadLayer(
              layer.id + "_mask_" + Date.now(),
              maskB64,
            );
            layer.savedMaskPath_internal = dMask.path;
            layer.maskDirty_internal = false;
          }
          finalMaskPath = layer.savedMaskPath_internal;
        }

        const layerEntry = {
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
        };
        if (layer.removeBgOnExec) layerEntry.removeBgOnExec = true;
        if (layer.bgRemovalQuality && layer.bgRemovalQuality !== "normal") layerEntry.bgRemovalQuality = layer.bgRemovalQuality;
        if (layer.blendMode && layer.blendMode !== "Normal") layerEntry.blendMode = layer.blendMode;
        if (layer.blur && layer.blur > 0) layerEntry.blur = layer.blur;
        // cropRect is in SOURCE-image pixels. src above is the full uncropped
        // source (rawServerPath is never overwritten by cropping), so the crop
        // stays re-editable after reload.
        if (layer.cropRect) layerEntry.cropRect = layer.cropRect;
        if (layer.isPlaceholder) {
          layerEntry.isPlaceholder = true;
          layerEntry.placeholderColor = layer.placeholderColor;
          layerEntry.inputIndex = layer.inputIndex;
          layerEntry.fillMode = layer.fillMode || "cover";
          if (layer.phRatio) layerEntry.phRatio = layer.phRatio;
          layerEntry.naturalWidth = layer.img.width;
          layerEntry.naturalHeight = layer.img.height;
        }
        // Text layer: its baked bitmap uploads via the normal image path above
        // (src). Persist the text-ness + content so the round-trip doesn't
        // downgrade it to a plain image, and so it stays re-editable on reopen.
        if (layer.isText) {
          layerEntry.isText = true;
          layerEntry.textState = { ...layer.textState };
        }
        return layerEntry;
      });
      const layerMeta = await Promise.all(uploadPromises);

      this.draw(true);
      const finalRenderCanvas = document.createElement("canvas");
      finalRenderCanvas.width = this.canvas.width;
      finalRenderCanvas.height = this.canvas.height;
      const rCtx = finalRenderCanvas.getContext("2d");
      // Use the user's chosen bg (this.canvas is already opaque-filled by
      // draw(true), so this is mostly defensive against a future transparent
      // path - but it must not hardcode #1e1e1e when the user picked another bg).
      rCtx.fillStyle = this._bgColor || "#1e1e1e";
      rCtx.fillRect(0, 0, finalRenderCanvas.width, finalRenderCanvas.height);
      rCtx.drawImage(this.canvas, 0, 0);
      const finalDataURL = finalRenderCanvas.toDataURL("image/png");
      this.draw();

      const finalMeta = {
        doc_w: this.docWidth,
        doc_h: this.docHeight,
        // Scope live-preview events to THIS node so a 2nd composer node in the
        // same workflow doesn't pick up this one's preview (read by the Python
        // node + the JS preview matcher).
        project_id: this.projectID,
        // Save the user's chosen canvas BG so the dynamic-compose path
        // (Python composer when there are placeholders / auto-rembg /
        // masks) and the JS rebuildPreview can fill the canvas with it
        // before drawing layers. Without this the BG was only baked
        // into the saved composite_path PNG, which the dynamic path
        // doesn't load - so the workflow output and mini preview
        // would silently flip from your chosen colour to black on Run.
        bg_color: this._bgColor || "#1e1e1e",
        layers: layerMeta,
        composite_path: null,
        session_ver: 6.0,
      };
      const dFin = await PixaromaAPI.saveProject(this.projectID, finalDataURL);

      if (dFin.status === "success") {
        finalMeta.composite_path = dFin.composite_path;

        const jsonString = JSON.stringify(finalMeta);

        if (this.onSave) {
          this.onSave(jsonString, finalDataURL);
        }
        this.syncNodeInputs();
        if (this._diskSavePending) {
          this._diskSavePending = false;
          if (this.onSaveToDisk) {
            if (this._transparentBg) {
              this._transparentExport = true;
              this._drawImpl(true);
              this._transparentExport = false;
              const transDataURL = this.canvas.toDataURL("image/png");
              this.draw(true);
              this.onSaveToDisk(transDataURL);
            } else {
              this.onSaveToDisk(finalDataURL);
            }
          }
        }

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
        // Restore with nothing erased is a no-op - tell the user why. Skip the
        // hint when savedMaskPath_internal is set: a workflow-restored mask
        // loads async (prepareLayerMask), so for a moment hasMask is false
        // even though a mask exists - "nothing erased" would be a lie there.
        const al = this.getActiveLayer();
        if (
          this.eraserIsRestore() &&
          al &&
          !al.hasMask_internal &&
          !al.savedMaskPath_internal &&
          this._layout
        ) {
          this._layout.setStatus("Nothing erased on this layer yet", "warn");
        }
        this.ui.updateActiveLayerUI();
      } else {
        this.isMouseDown = false;
        this.canvas.style.cursor = "default";
      }
    } else if (this.activeMode === "crop") {
      this.handleCropMouseDown(coords);
    } else {
      this.onSelectMouseDown(e, coords);
    }
    this.draw();
  });

  // NOTE: we deliberately do NOT end the eraser stroke when the cursor leaves
  // the canvas. Leaving and re-entering while the button is held continues the
  // SAME stroke (the window-level mouseup commits + pushes history when the
  // button is actually released, anywhere on screen). Ending here was a bug:
  // dragging the brush off-canvas and back stopped erasing mid-stroke.

  this._composerMouseMove = (e) => {
    try {
      // Crop mode owns its own drag lifecycle (apply happens on exit, not here).
      if (this.activeMode === "crop") {
        if (this.overlay.id !== "pixaroma-editor-instance") return;
        const cc = this.getCanvasCoordinates(e);
        if (this.isMouseDown && e.buttons & 1) {
          this.handleCropMouseMove(cc, e.shiftKey);
        } else if (this.isMouseDown) {
          this.handleCropMouseUp();
        } else {
          // Hover over the canvas: show the matching resize cursor.
          this.canvas.style.cursor = this.cropCursorFor(cc);
        }
        return;
      }
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
      if (
        this.overlay.id !== "pixaroma-editor-instance" ||
        e.target.tagName === "INPUT"
      )
        return;

      const coords = this.getCanvasCoordinates(e);

      if (this.activeMode === "eraser") {
        // Mouse events carry the live Alt state - keeps the temp-flip honest
        // even if a keydown/keyup was swallowed by another handler.
        if (this._eraserAltHeld !== e.altKey) this._eraserAltHeld = e.altKey;
        this._lastEraserCoords = coords;
        if (this.isMouseDown && this.selectedLayerIds.size === 1) {
          const canvasRect = this.canvas.getBoundingClientRect();
          const isOverCanvas =
            e.clientX >= canvasRect.left &&
            e.clientX <= canvasRect.right &&
            e.clientY >= canvasRect.top &&
            e.clientY <= canvasRect.bottom;
          if (isOverCanvas) {
            const layer = this.getActiveLayer();
            const startLayerCoords = this.getCoordinatesInLayerImage(
              layer,
              this.lastX,
              this.lastY,
            );
            const endLayerCoords = this.getCoordinatesInLayerImage(
              layer,
              coords.x,
              coords.y,
            );
            this.drawEraserLine(layer, startLayerCoords, endLayerCoords);
          }
          // Advance the last position EVERY move (even off-canvas) so a quick
          // excursion off the canvas and back resumes the same stroke without
          // erasing a long straight chord across the gap.
          this.lastX = coords.x;
          this.lastY = coords.y;
        } else {
          this.lastX = coords.x;
          this.lastY = coords.y;
        }
        // Single draw + eraser preview per frame (batched via rAF)
        this._pendingEraserPreview = coords;
        this.draw();
      } else {
        this.onSelectMouseMove(e, coords);
      }
    } catch (err) {
      console.error("Pixaroma Intercepted Mouse Error:", err);
      this.isMouseDown = false;
    }
  };
  window.addEventListener("mousemove", this._composerMouseMove);

  this._composerMouseUp = () => {
    if (this.isPanning) {
      this.isPanning = false;
      this.workspace.classList.remove("panning");
    }
    if (this.activeMode === "crop") {
      this.handleCropMouseUp();
      return;
    }
    if (this.isMouseDown) {
      this.isMouseDown = false;
      this.interactionMode = null;
      this.canvas.style.cursor = "default";
      this.verifySelection();
      // Text layer resized via handles: fold scale into font size + re-render
      // crisp (async; commits history itself). See _commitTextScaleFold.
      if (this._commitTextScaleFold()) return;
      this.ui.updateActiveLayerUI();
      this.draw();
      this.pushHistory();
    }
  };
  window.addEventListener("mouseup", this._composerMouseUp);

  this._composerBlur = () => {
    this.spacePressed = false;
    this._eraserAltHeld = false; // Alt+Tab leaves keyup unseen - don't stick
    if (this.isPanning) {
      this.isPanning = false;
      this.workspace.classList.remove("panning");
    }
    if (this.isMouseDown) {
      const wasErasing = this.activeMode === "eraser";
      const wasCropping = this.activeMode === "crop";
      // Only an ACTUAL drag pushes history. A bare mousedown (select a layer)
      // then alt-tab leaves interactionMode null - pushing then would add a
      // no-op duplicate undo step.
      const wasTransforming = !!this.interactionMode;
      this.isMouseDown = false;
      this.interactionMode = null;
      if (this.canvas) this.canvas.style.cursor =
        wasErasing || wasCropping ? "crosshair" : "default";
      // Commit the in-progress action so focus loss mid-gesture (e.g. alt-tab)
      // doesn't strand it: an eraser stroke or a transform drag needs an undo
      // snapshot; a crop drag just needs its handle released (crop applies on
      // Done, not here).
      if (wasCropping) {
        this._cropDragHandle = null;
      } else if (wasErasing || wasTransforming) {
        this.pushHistory();
      }
    }
  };
  window.addEventListener("blur", this._composerBlur);
};

// If the active layer is a text layer that was scaled (via canvas handles OR
// the Transform Scale/Horiz/Vert sliders), fold the scale into font size and
// re-render the bitmap SHARP at its new displayed size, so text never blurs.
// Uniform via the geometric mean so any handle/slider produces clean text.
// Async rebuild -> commits history + redraws in the .then(). Returns true if it
// handled the commit (caller should NOT also pushHistory), false otherwise.
PixaromaEditor.prototype._commitTextScaleFold = function () {
  const tl = this.getActiveLayer();
  if (!tl || !tl.isText || (tl.scaleX === 1 && tl.scaleY === 1)) return false;
  const factor = Math.sqrt(Math.abs(tl.scaleX * tl.scaleY)) || 1;
  tl.textState.fontSize = Math.min(512, Math.max(4, Math.round(tl.textState.fontSize * factor)));
  tl.scaleX = 1;
  tl.scaleY = 1;
  this.rebuildTextLayer(tl).then(() => {
    this.ui.updateActiveLayerUI();
    this.draw();
    this.pushHistory();
  });
  return true;
};

PixaromaEditor.prototype.onSelectMouseDown = function (e, coords) {
  if (this.selectedLayerIds.size === 1) {
    const layer = this.getActiveLayer();
    if (layer && !layer.locked && layer.img) {
      const pts = PixaromaLayers.getTransformedPoints(layer);
      if (Math.hypot(coords.x - pts[8].x, coords.y - pts[8].y) <= 15)
        this.interactionMode = "rotate";
      else if (Math.hypot(coords.x - pts[4].x, coords.y - pts[4].y) <= 12)
        this.interactionMode = "stretchL";
      else if (Math.hypot(coords.x - pts[5].x, coords.y - pts[5].y) <= 12)
        this.interactionMode = "stretchR";
      else if (Math.hypot(coords.x - pts[6].x, coords.y - pts[6].y) <= 12)
        this.interactionMode = "stretchT";
      else if (Math.hypot(coords.x - pts[7].x, coords.y - pts[7].y) <= 12)
        this.interactionMode = "stretchB";
      else {
        for (let i = 0; i < 4; i++)
          if (Math.hypot(coords.x - pts[i].x, coords.y - pts[i].y) <= 15)
            this.interactionMode = "scale";
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
            startAngle:
              (Math.atan2(coords.y - layer.cy, coords.x - layer.cx) * 180) /
              Math.PI,
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
    if (
      l.visible &&
      !l.locked &&
      PixaromaLayers.isPointInLayer(coords.x, coords.y, l)
    ) {
      clickedLayerIndex = i;
      break;
    }
  }

  if (clickedLayerIndex !== -1) {
    const clickedLayer = this.layers[clickedLayerIndex];
    if (e.shiftKey || e.ctrlKey) {
      if (this.selectedLayerIds.has(clickedLayer.id))
        this.selectedLayerIds.delete(clickedLayer.id);
      else this.selectedLayerIds.add(clickedLayer.id);
    } else if (e.altKey) {
      if (!this.selectedLayerIds.has(clickedLayer.id)) {
        this.selectedLayerIds.clear();
        this.selectedLayerIds.add(clickedLayer.id);
      }
      const usedPH2 = new Set(this.layers.filter((l) => l.isPlaceholder).map((l) => l.inputIndex));
      const nextPHIdx2 = () => { let i = 1; while (usedPH2.has(i)) i++; usedPH2.add(i); return i; };
      const newLayers = [];
      this.layers.forEach((layer) => {
        if (this.selectedLayerIds.has(layer.id)) {
          const dup = { ...layer, id: Date.now().toString() + Math.random(), cx: layer.cx + 20, cy: layer.cy + 20 };
          if (layer.cropRect) dup.cropRect = { ...layer.cropRect };
          if (layer.adjustments) dup.adjustments = { ...layer.adjustments };
          if (layer.textState) dup.textState = { ...layer.textState };
          // Deep-copy eraser mask so edits don't affect the original
          if (layer.eraserMaskCanvas_internal) {
            const mc = document.createElement("canvas");
            mc.width = layer.eraserMaskCanvas_internal.width;
            mc.height = layer.eraserMaskCanvas_internal.height;
            const mctx = mc.getContext("2d");
            mctx.drawImage(layer.eraserMaskCanvas_internal, 0, 0);
            dup.eraserMaskCanvas_internal = mc;
            dup.eraserMaskCtx_internal = mctx;
          }
          if (layer.isPlaceholder) {
            const newIdx = nextPHIdx2();
            const newName = `image_${newIdx}`;
            dup.inputIndex = newIdx;
            dup.name = newName;
            dup.img = this._makePlaceholderImage(layer.img.width, layer.img.height, layer.placeholderColor, newName, (bitmapImg) => {
              dup.img = bitmapImg;
            });
          } else {
            dup.name = layer.name + " copy";
          }
          newLayers.push(dup);
        }
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
};

PixaromaEditor.prototype.onSelectMouseMove = function (e, coords) {
  if (!this.isMouseDown) {
    if (this.selectedLayerIds.size === 1) {
      const layer = this.getActiveLayer();
      if (layer && !layer.locked && layer.img) {
        const pts = PixaromaLayers.getTransformedPoints(layer);
        if (Math.hypot(coords.x - pts[8].x, coords.y - pts[8].y) <= 15) {
          this.canvas.style.cursor = "crosshair";
          return;
        }
        for (let i = 0; i < 4; i++) {
          if (Math.hypot(coords.x - pts[i].x, coords.y - pts[i].y) <= 15) {
            this.canvas.style.cursor =
              (layer.rotation + 45) % 180 < 90 ? "nwse-resize" : "nesw-resize";
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
      const currentAngle =
        (Math.atan2(coords.y - t.cy, coords.x - t.cx) * 180) / Math.PI;
      let newAngle = t.rotation + (currentAngle - t.startAngle);
      if (e.shiftKey) newAngle = Math.round(newAngle / 15) * 15;
      layer.rotation = Math.round((newAngle + 360) % 360);
      this.rotateSlider.value = layer.rotation;
      this.rotateNum.value = layer.rotation;
    } else if (this.interactionMode === "scale") {
      const currentDist = Math.hypot(coords.x - t.cx, coords.y - t.cy);
      const scaleFactor = Math.max(0.01, currentDist / t.startDist);
      if (e.shiftKey) {
        layer.scaleX = Math.max(
          0.01,
          ((t.cx - coords.x) * (layer.flippedX ? 1 : -1)) /
            (layer.img.width / 2),
        );
        layer.scaleY = Math.max(
          0.01,
          ((t.cy - coords.y) * (layer.flippedY ? 1 : -1)) /
            (layer.img.height / 2),
        );
      } else {
        layer.scaleX = t.scaleX * scaleFactor;
        layer.scaleY = t.scaleY * scaleFactor;
      }
      this.scaleSlider.value = Math.round(layer.scaleX * 100);
      this.scaleNum.value = Math.round(layer.scaleX * 100);
    } else if (this.interactionMode.startsWith("stretch")) {
      const currentDist = Math.hypot(coords.x - t.cx, coords.y - t.cy);
      const scaleFactor = Math.max(0.01, currentDist / t.startDist);

      if (
        this.interactionMode === "stretchL" ||
        this.interactionMode === "stretchR"
      ) {
        layer.scaleX = t.scaleX * scaleFactor;
        this.stretchHSlider.value = Math.round(layer.scaleX * 100);
        this.stretchHNum.value = Math.round(layer.scaleX * 100);
      } else if (
        this.interactionMode === "stretchT" ||
        this.interactionMode === "stretchB"
      ) {
        layer.scaleY = t.scaleY * scaleFactor;
        this.stretchVSlider.value = Math.round(layer.scaleY * 100);
        this.stretchVNum.value = Math.round(layer.scaleY * 100);
      }
    }
  });

  this.draw();
};
