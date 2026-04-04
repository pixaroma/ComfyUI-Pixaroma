// Eraser mode methods — mixed into PixaromaEditor.prototype
import { PixaromaEditor } from "./core.mjs";

PixaromaEditor.prototype.setupEraserOnSelection = function () {
  const targetId = Array.from(this.selectedLayerIds)[0];
  const layer = this.layers.find((l) => l.id === targetId);
  if (layer && !layer.eraserMaskCanvas_internal) {
    this.prepareLayerMask(layer);
  }
};

PixaromaEditor.prototype.prepareLayerMask = function (
  layer,
  existingMaskUrl = null,
) {
  layer.eraserMaskCanvas_internal = document.createElement("canvas");
  layer.eraserMaskCanvas_internal.width = layer.img.width;
  layer.eraserMaskCanvas_internal.height = layer.img.height;
  layer.eraserMaskCtx_internal =
    layer.eraserMaskCanvas_internal.getContext("2d");
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
};

PixaromaEditor.prototype.clearEraserMask = function (layer, skipRefresh) {
  if (layer.eraserMaskCtx_internal) {
    layer.eraserMaskCtx_internal.clearRect(
      0,
      0,
      layer.eraserMaskCanvas_internal.width,
      layer.eraserMaskCanvas_internal.height,
    );
    layer.hasMask_internal = false;
    layer.savedMaskPath_internal = null;
    if (!skipRefresh) {
      this.ui.updateActiveLayerUI();
      this.draw();
      this.pushHistory();
    }
  }
};

PixaromaEditor.prototype.drawEraserLine = function (layer, start, end) {
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
    let blurRad =
      (this.brushSize * (1 - this.brushHardness)) /
      Math.max(0.01, Math.abs(layer.scaleX));
    blurRad = Math.min(blurRad, 100);
    ctx.filter = `blur(${blurRad}px)`;
  }
  ctx.stroke();
  ctx.restore();

  if (!layer.hasMask_internal) {
    layer.hasMask_internal = true;
    this.ui.updateActiveLayerUI();
  }
};

PixaromaEditor.prototype.drawEraserPreview = function (coords) {
  this.ctx.save();
  this.ctx.translate(coords.x, coords.y);
  this.ctx.beginPath();
  this.ctx.arc(0, 0, this.brushSize, 0, Math.PI * 2);
  this.ctx.strokeStyle = "rgba(255,255,255,0.8)";
  this.ctx.lineWidth = 1;
  this.ctx.stroke();

  if (this.isMouseDown && this.activeMode === "eraser") {
    const radGrad = this.ctx.createRadialGradient(
      0,
      0,
      0,
      0,
      0,
      this.brushSize,
    );
    radGrad.addColorStop(this.brushHardness, "rgba(0,0,0,0.6)");
    radGrad.addColorStop(1, "rgba(0,0,0,0)");
    this.ctx.fillStyle = radGrad;
    this.ctx.fill();
  }
  this.ctx.restore();
};
