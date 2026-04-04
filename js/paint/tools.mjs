// ============================================================
// Pixaroma Paint Studio — Tool dispatch: brush, pencil, eraser, smudge, fill, pick, shape
// ============================================================
import { PaintStudio } from "./core.mjs";

const proto = PaintStudio.prototype;

proto._toolMouseDown = function (x, y, e) {
  const ly = this.layers[this.activeIdx];
  if (!ly) return;

  if (this.tool === "pick") {
    this.isDrawing = true;
    const color = this.engine.sampleColor(this.el.displayCanvas, x, y);
    this._setColorFromHex(color, true);
    this._setStatus(`Sampled: ${color}`);
    return;
  }

  if (this.tool === "fill") {
    if (ly.locked) {
      this._setStatus("Layer is locked");
      return;
    }
    this._pushHistory();
    this.engine.floodFill(ly.canvas, x, y, this.fgColor, this.fillTol);
    this._contentBoundsCache.delete(ly.id);
    this._updateLayerThumb(this.activeIdx);
    this._renderDisplay();
    return;
  }

  if (this.tool === "transform") return;

  if (this.tool === "shape") {
    if (ly.locked) {
      this._setStatus("Layer is locked");
      return;
    }
    this._shapeStart = { x, y };
    this.isDrawing = true;
    return;
  }

  if (ly.locked) {
    this._setStatus("Layer is locked");
    return;
  }

  if (
    this.tool === "brush" ||
    this.tool === "pencil" ||
    this.tool === "eraser"
  ) {
    this.isDrawing = true;
    this.strokeCtx.clearRect(0, 0, this.docW, this.docH);
    // Shift = line from last point (_drawLineTo handles its own history push)
    if (e.shiftKey && this._lineStart) {
      this._drawLineTo(x, y);
      this._lineStart = { x, y };
      this.isDrawing = false;
      return;
    }
    this._pushHistory();
    this._lineStart = { x, y };
    const pts = this.engine.beginStroke(x, y);
    pts.forEach((pt) => this._applyBrushStamp(pt.x, pt.y, pt.pressure || 1));
    this._renderDisplay();
    return;
  }

  if (this.tool === "smudge") {
    this._pushHistory();
    this.isDrawing = true;
    this._lastSmudgePt = { x, y };
    this.engine.smudgeBegin(ly.ctx, x, y, this.brush.size);
    this._renderDisplay();
  }
};

proto._toolMouseMove = function (x, y) {
  const ly = this.layers[this.activeIdx];
  if (!ly || !this.isDrawing) return;

  if (this.tool === "pick") {
    const color = this.engine.sampleColor(this.el.displayCanvas, x, y);
    this._setColorFromHex(color, true);
    return;
  }

  if (
    this.tool === "brush" ||
    this.tool === "pencil" ||
    this.tool === "eraser"
  ) {
    const spacing = Math.max(1, this.brush.size * (this.brush.spacing / 100));
    const pts = this.engine.continueStroke(x, y, spacing);
    pts.forEach((pt) => this._applyBrushStamp(pt.x, pt.y, pt.pressure || 1));
    this._renderDisplay();
    this._setStatus(`X: ${Math.round(x)}  Y: ${Math.round(y)}`);
    return;
  }

  if (this.tool === "smudge") {
    if (this._lastSmudgePt) {
      this._applySmudge(x, y, this._lastSmudgePt.x, this._lastSmudgePt.y);
      this._renderDisplay();
    }
    this._lastSmudgePt = { x, y };
    return;
  }

  if (this.tool === "shape" && this._shapeStart) {
    this._renderDisplay(); // re-render base
    // Draw shape preview on cursor canvas
    const cvs = this.el.cursorCvs;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.save();
    const sx = this._shapeStart.x,
      sy = this._shapeStart.y;
    ctx.beginPath();
    this._buildShapePath(ctx, sx, sy, x, y);
    if (this._shapeTool !== "line" && this.shapeFill) {
      ctx.fillStyle = this.fgColor + "55";
      ctx.fill();
      ctx.strokeStyle = this.fgColor;
      ctx.lineWidth = Math.max(1, 1 / this.zoom);
      ctx.stroke();
    } else {
      ctx.setLineDash([4 / this.zoom, 4 / this.zoom]);
      ctx.strokeStyle = this.fgColor;
      ctx.lineWidth = Math.max(1, (this.shapeLineWidth || 3) / this.zoom);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    return;
  }
};

proto._toolMouseUp = function (x, y) {
  if (!this.isDrawing) return;
  this.isDrawing = false;
  this._handleMode = null;
  this._handleDrag = null;

  if (this.tool === "brush" || this.tool === "pencil") {
    const ly = this.layers[this.activeIdx];
    if (ly) {
      const ops = this.brush.opacity / 100;
      ly.ctx.save();
      ly.ctx.globalAlpha = ops;
      ly.ctx.drawImage(this.strokeCanvas, 0, 0);
      ly.ctx.restore();
      this.strokeCtx.clearRect(0, 0, this.docW, this.docH);
    }
  }

  if (this.tool === "eraser") {
    const ly = this.layers[this.activeIdx];
    if (ly) {
      const ops = this.brush.opacity / 100;
      ly.ctx.save();
      ly.ctx.globalAlpha = ops;
      ly.ctx.globalCompositeOperation = "destination-out";
      ly.ctx.drawImage(this.strokeCanvas, 0, 0);
      ly.ctx.restore();
      this.strokeCtx.clearRect(0, 0, this.docW, this.docH);
    }
  }

  if (this.tool === "shape" && this._shapeStart) {
    const ly = this.layers[this.activeIdx];
    if (ly) {
      this._pushHistory();
      const ctx = ly.ctx;
      ctx.save();
      ctx.lineWidth = this.shapeLineWidth || 3;
      ctx.beginPath();
      this._buildShapePath(ctx, this._shapeStart.x, this._shapeStart.y, x, y);
      if (this._shapeTool === "line") {
        ctx.strokeStyle = this.fgColor;
        ctx.stroke();
      } else if (this.shapeFill) {
        ctx.fillStyle = this.fgColor;
        ctx.fill();
      } else {
        ctx.strokeStyle = this.fgColor;
        ctx.stroke();
      }
      ctx.restore();
    }
    this._shapeStart = null;
    // Clear cursor canvas preview
    if (this.el.cursorCvs)
      this.el.cursorCvs.getContext("2d").clearRect(0, 0, this.docW, this.docH);
  }

  this.engine.endStroke();
  const ly = this.layers[this.activeIdx];
  if (ly) this._contentBoundsCache.delete(ly.id);
  this._updateLayerThumb(this.activeIdx);
  this._renderDisplay();
};

proto._applyBrushStamp = function (x, y, pressure) {
  const s = this.brush;
  const hard = this.tool === "pencil" ? 100 : s.hardness;
  const stamp = this.engine.getStamp(s.size, hard, s.shape, s.angle);
  const flow = (s.flow / 100) * (pressure || 1);

  // Both brush/pencil and eraser accumulate to strokeCanvas; eraser uses black (destination-out on commit)
  this.engine.applyStampToCtx(
    this.strokeCtx,
    stamp,
    x,
    y,
    s.size,
    this.fgColor,
    flow,
    false,
    s.scatter > 0,
    s.scatter,
  );
};

proto._applySmudge = function (x, y, lastX, lastY) {
  const ly = this.layers[this.activeIdx];
  if (!ly) return;
  const str = this.smudgeStrength !== undefined ? this.smudgeStrength : 50;
  this.engine.smudge(
    ly.ctx,
    x,
    y,
    lastX ?? x,
    lastY ?? y,
    this.brush.size,
    str,
  );
};

proto._drawLineTo = function (x2, y2) {
  if (!this._lineStart) return;
  const { x: x1, y: y1 } = this._lineStart;
  this._pushHistory();
  const spacing = Math.max(1, this.brush.size * (this.brush.spacing / 100));
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.floor(dist / spacing));
  this.strokeCtx.clearRect(0, 0, this.docW, this.docH);
  this.engine.beginStroke(x1, y1);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = x1 + (x2 - x1) * t,
      py = y1 + (y2 - y1) * t;
    this._applyBrushStamp(px, py, 1);
  }
  this.engine.endStroke();
  const ly = this.layers[this.activeIdx];
  if (ly) {
    const ops = this.brush.opacity / 100;
    ly.ctx.save();
    ly.ctx.globalAlpha = ops;
    if (this.tool === "eraser")
      ly.ctx.globalCompositeOperation = "destination-out";
    ly.ctx.drawImage(this.strokeCanvas, 0, 0);
    ly.ctx.restore();
    this.strokeCtx.clearRect(0, 0, this.docW, this.docH);
    this._contentBoundsCache.delete(ly.id);
    this._updateLayerThumb(this.activeIdx);
  }
  this._renderDisplay();
};

proto._buildShapePath = function (ctx, x1, y1, x2, y2) {
  const dx = x2 - x1,
    dy = y2 - y1;
  switch (this._shapeTool) {
    case "rect":
      ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(dx), Math.abs(dy));
      break;
    case "ellipse":
      ctx.ellipse(
        (x1 + x2) / 2,
        (y1 + y2) / 2,
        Math.max(1, Math.abs(dx) / 2),
        Math.max(1, Math.abs(dy) / 2),
        0,
        0,
        Math.PI * 2,
      );
      break;
    case "line":
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      break;
    case "triangle":
      ctx.moveTo((x1 + x2) / 2, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x1, y2);
      ctx.closePath();
      break;
    case "poly": {
      const cx = (x1 + x2) / 2,
        cy = (y1 + y2) / 2;
      const r = Math.max(Math.abs(dx), Math.abs(dy)) / 2;
      const sides = this.polySlides || 5;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
        const px = cx + r * Math.cos(a),
          py = cy + r * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
  }
};
