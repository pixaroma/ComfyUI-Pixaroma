// Rendering, history/undo, restore — mixed into PixaromaEditor.prototype
import { PixaromaEditor } from "./core.mjs";

PixaromaEditor.prototype.pushHistory = function () {
  if (this.isRestoringHistory) return;
  this.history = this.history.slice(0, this.historyIndex + 1);
  this.history.push(this.captureState());
  this.historyIndex++;
  this.ui.updateHistoryUI();
};

PixaromaEditor.prototype.undo = function () {
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
};

PixaromaEditor.prototype.redo = function () {
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
};

PixaromaEditor.prototype.draw = function (cleanRender = false) {
  const bg = this._bgColor || "#1e1e1e";
  this.ctx.fillStyle = bg;
  this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

  this.ctx.imageSmoothingEnabled = true;
  this.ctx.imageSmoothingQuality = "high";

  // Clear selection overlay
  const oc = this.selCtx;
  const pad = this.selPad || 0;
  if (oc && !cleanRender) {
    oc.clearRect(0, 0, this.selCanvas.width, this.selCanvas.height);
  }

  this.layers.forEach((layer) => {
    if (!layer.visible) return;

    const isSelected = this.selectedLayerIds.has(layer.id);
    this.ctx.save();
    this.ctx.globalAlpha = layer.opacity;
    // Blend mode support (maps to canvas globalCompositeOperation)
    const blendMap = {
      Normal: "source-over",
      Multiply: "multiply",
      Screen: "screen",
      Overlay: "overlay",
      Darken: "darken",
      Lighten: "lighten",
      "Color Dodge": "color-dodge",
      "Color Burn": "color-burn",
      "Hard Light": "hard-light",
      "Soft Light": "soft-light",
      Difference: "difference",
      Exclusion: "exclusion",
      Hue: "hue",
      Saturation: "saturation",
      Color: "color",
      Luminosity: "luminosity",
    };
    if (layer.blendMode && blendMap[layer.blendMode])
      this.ctx.globalCompositeOperation = blendMap[layer.blendMode];

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
      this.renderCtx.clearRect(
        0,
        0,
        this.renderCanvas.width,
        this.renderCanvas.height,
      );

      this.renderCtx.drawImage(layer.img, 0, 0);
      this.renderCtx.globalCompositeOperation = "destination-out";
      this.renderCtx.drawImage(layer.eraserMaskCanvas_internal, 0, 0);
      this.renderCtx.globalCompositeOperation = "source-over";

      this.ctx.drawImage(this.renderCanvas, -w / 2, -h / 2, w, h);
    } else {
      this.ctx.drawImage(layer.img, -w / 2, -h / 2, w, h);
    }

    this.ctx.restore();
    this.ctx.restore();

    // Draw selection border & handles on overlay canvas (not clipped by main canvas)
    if (!cleanRender && isSelected && oc) {
      oc.save();
      oc.translate(layer.cx + pad, layer.cy + pad);
      oc.rotate((layer.rotation * Math.PI) / 180);

      oc.strokeStyle = layer.locked
        ? "#888"
        : this.selectedLayerIds.size > 1
          ? "#0ea5e9"
          : "#f66744";
      oc.lineWidth = 1.5;
      oc.strokeRect(-w / 2, -h / 2, w, h);

      if (
        !layer.locked &&
        this.selectedLayerIds.size === 1 &&
        this.activeMode !== "eraser"
      ) {
        const sz = this.handleSize;
        oc.fillStyle = "#fff";
        oc.strokeStyle = "#f66744";
        oc.lineWidth = 1;

        const corners = [
          { x: -w / 2, y: -h / 2 },
          { x: w / 2, y: -h / 2 },
          { x: w / 2, y: h / 2 },
          { x: -w / 2, y: h / 2 },
        ];
        corners.forEach((p) => {
          oc.beginPath();
          oc.arc(p.x, p.y, sz / 2, 0, Math.PI * 2);
          oc.fill();
          oc.stroke();
        });

        oc.fillStyle = "#fff";
        oc.lineWidth = 1;
        oc.beginPath();
        oc.moveTo(0, -h / 2);
        oc.lineTo(0, -h / 2 - 30);
        oc.stroke();
        oc.beginPath();
        oc.arc(0, -h / 2 - 30, sz / 1.2, 0, Math.PI * 2);
        oc.fillStyle = "#f66744";
        oc.fill();
        oc.stroke();
        oc.fillStyle = "#fff";
        oc.font = "12px Arial";
        oc.textAlign = "center";
        oc.textBaseline = "middle";
        oc.fillText("\u21bb", 0, -h / 2 - 29);

        oc.fillStyle = "#f66744";
        oc.strokeStyle = "#fff";
        oc.lineWidth = 1;
        const sides = [
          { x: -w / 2, y: 0 },
          { x: w / 2, y: 0 },
          { x: 0, y: -h / 2 },
          { x: 0, y: h / 2 },
        ];
        sides.forEach((p) => {
          oc.beginPath();
          oc.arc(p.x, p.y, sz / 2, 0, Math.PI * 2);
          oc.fill();
          oc.stroke();
        });
      }
      oc.restore();
    }
  });
  this.ctx.globalAlpha = 1.0;
};

PixaromaEditor.prototype.attemptRestore = async function () {
  let savedData = null;
  const composerWidget = (this.node.widgets || []).find(
    (w) => w.name === "ComposerWidget",
  );
  if (
    composerWidget &&
    composerWidget.value &&
    composerWidget.value.project_json
  ) {
    savedData = composerWidget.value.project_json;
  }

  if (!savedData || savedData === "{}" || savedData === "") return;

  if (this.statusText)
    this.statusText.innerText = "\u23f3 Restoring session...";
  this.overlay.style.pointerEvents = "none";
  this.overlay.style.opacity = "0.5";

  try {
    if (typeof savedData !== "string") savedData = JSON.stringify(savedData);
    const meta = JSON.parse(savedData);

    this.docWidth = meta.doc_w;
    this.docHeight = meta.doc_h;
    if (this._canvasSettings)
      this._canvasSettings.setSize(meta.doc_w, meta.doc_h);

    this.canvasContainer.style.width = this.docWidth + "px";
    this.canvasContainer.style.height = this.docHeight + "px";
    this.canvas.width = this.docWidth;
    this.canvas.height = this.docHeight;
    if (this.selCanvas) {
      this.selCanvas.width = this.docWidth + 2 * this.selPad;
      this.selCanvas.height = this.docHeight + 2 * this.selPad;
    }
    if (this.selHitArea) {
      this.selHitArea.style.width = this.docWidth + 2 * this.selPad + "px";
      this.selHitArea.style.height = this.docHeight + 2 * this.selPad + "px";
    }

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
};

PixaromaEditor.prototype.finishRestore = function (hadError = false) {
  this.layers.forEach((l) => {
    if (l.savedMaskPath_internal) {
      const maskFileName = l.savedMaskPath_internal.split(/[\\/]/).pop();
      const maskUrl = `/view?filename=${encodeURIComponent(maskFileName)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
      this.prepareLayerMask(l, maskUrl);
    }
  });

  this.overlay.style.pointerEvents = "auto";
  this.overlay.style.opacity = "1";
  if (this.statusText)
    this.statusText.innerText = hadError
      ? "Ready (Some images missing)."
      : "Session restored.";
  this.fitViewToWorkspace();
  this.ui.updateActiveLayerUI();
  this.draw();

  this.history = [];
  this.historyIndex = -1;
  this.pushHistory();
};
