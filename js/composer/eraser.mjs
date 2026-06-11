// Eraser mode methods — mixed into PixaromaEditor.prototype
import { PixaromaEditor } from "./core.mjs";
import { BRAND } from "../framework/index.mjs";

PixaromaEditor.prototype.setupEraserOnSelection = function () {
  const layer = this.getActiveLayer();
  if (layer && !layer.eraserMaskCanvas_internal) {
    this.prepareLayerMask(layer);
  }
};

// Effective brush direction: the pill's sub-mode, flipped while Alt is held.
PixaromaEditor.prototype.eraserIsRestore = function () {
  return (this.eraserSubMode === "restore") !== !!this._eraserAltHeld;
};

// The Erase | Restore pills are a sub-control of the eraser TOOL: they only
// make sense once the eraser is enabled. When it's off, dim + disable them so
// they don't read as "active" (orange) while a canvas click still just moves
// the layer (select mode). Funnelled through setMode + the panel refresh so
// the pills always track the real tool state.
PixaromaEditor.prototype._syncEraserPillsEnabled = function () {
  if (!this.eraserModePills) return;
  const on = this.activeMode === "eraser";
  const el = this.eraserModePills.el;
  el.style.opacity = on ? "1" : "0.4";
  // pointer-events:none also blocks hover, so a title here wouldn't show -
  // the dim state is the cue that the eraser must be enabled first.
  el.style.pointerEvents = on ? "auto" : "none";
};

// Repaint the brush ring at its last known position. Keyboard-only changes
// (X swap / Alt hold-release) have no mousemove to recolor the cursor, so the
// pill click, X handler, and Alt handlers call this directly.
PixaromaEditor.prototype._refreshEraserPreview = function () {
  if (this.activeMode === "eraser" && this._lastEraserCoords) {
    this._pendingEraserPreview = this._lastEraserCoords;
  }
  this.draw();
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
  const restore = this.eraserIsRestore();
  // Restoring a layer with no mask: nothing to recover, and we must NOT mark
  // the mask dirty or existing (a no-op stroke would otherwise create one).
  if (restore && !layer.hasMask_internal) return;
  const ctx = layer.eraserMaskCtx_internal;
  // De-scale the brush by the geometric mean of BOTH axes so the erased size
  // matches the cursor on non-uniformly-scaled layers (the cursor is de-scaled
  // on X and Y, so a scaleX-only divisor mis-sizes the brush when scaleX≠scaleY).
  const scaleDivisor = Math.max(0.01, Math.sqrt(Math.abs(layer.scaleX * layer.scaleY)));
  ctx.save();
  // Restore brushes the mask AWAY (destination-out on the mask itself), so the
  // destination-out render in render.mjs has less to punch out -> image returns.
  if (restore) ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.moveTo(start.lx, start.ly);
  ctx.lineTo(end.lx, end.ly);
  ctx.lineWidth = (this.brushSize * 2) / scaleDivisor;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "black";

  // BUG FIX: Cap the blur radius to prevent canvas crashing at extreme distances or tiny scales
  if (this.brushHardness < 0.95) {
    let blurRad = (this.brushSize * (1 - this.brushHardness)) / scaleDivisor;
    blurRad = Math.min(blurRad, 100);
    ctx.filter = `blur(${blurRad}px)`;
  }
  ctx.stroke();
  ctx.restore();

  // Mark the mask dirty so Save re-uploads it (and ONLY when it changed —
  // see the save handler's dirty/never-uploaded check that prevents a new
  // mask file being written on every Save).
  layer.maskDirty_internal = true;
  if (!restore && !layer.hasMask_internal) {
    layer.hasMask_internal = true;
    this.ui.updateActiveLayerUI();
  }
};

PixaromaEditor.prototype.drawEraserPreview = function (coords) {
  const restore = this.eraserIsRestore();
  this.ctx.save();
  this.ctx.translate(coords.x, coords.y);
  this.ctx.beginPath();
  this.ctx.arc(0, 0, this.brushSize, 0, Math.PI * 2);
  // Orange ring = restore (paints pixels back); white ring = erase.
  this.ctx.strokeStyle = restore ? BRAND : "rgba(255,255,255,0.8)";
  this.ctx.lineWidth = restore ? 1.5 : 1;
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
    if (restore) {
      radGrad.addColorStop(this.brushHardness, "rgba(246, 103, 68, 0.45)");
      radGrad.addColorStop(1, "rgba(246, 103, 68, 0)");
    } else {
      radGrad.addColorStop(this.brushHardness, "rgba(0,0,0,0.6)");
      radGrad.addColorStop(1, "rgba(0,0,0,0)");
    }
    this.ctx.fillStyle = radGrad;
    this.ctx.fill();
  }
  this.ctx.restore();
};
