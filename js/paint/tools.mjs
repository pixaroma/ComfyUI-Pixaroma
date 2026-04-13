// ============================================================
// Pixaroma Paint Studio — Tool dispatch: brush, pencil, eraser, smudge, fill, pick, shape
// ============================================================
import { PaintStudio } from "./core.mjs";

const proto = PaintStudio.prototype;

proto._toolMouseDown = function (x, y, e) {
  const ly = this.layers[this.activeIdx];
  if (!ly) return;

  // Auto-apply any pending transform before drawing on the layer
  const drawTools = ["brush", "pencil", "eraser", "smudge", "fill", "shape"];
  if (drawTools.includes(this.tool) && this._hasTransform(ly)) {
    this._applyLayerTransform();
  }

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
    this._currentPointerType = e.pointerType || "mouse";
    const penPressure = e.pointerType === "pen" ? e.pressure : null;
    const pts = this.engine.beginStroke(x, y, penPressure);
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

proto._toolMouseMove = function (x, y, e) {
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
    const penPressure = e?.pointerType === "pen" ? e.pressure : null;
    // Adaptive spacing: scale with pressure-adjusted size for smooth strokes
    const isPen = this._currentPointerType === "pen";
    const sp = this.brush.spacing / 100;
    let estSize = this.brush.size;
    if (isPen && this.pressureSize) {
      const ep = this.engine._smoothPressure || 1;
      estSize = Math.max(1, this.brush.size * (0.15 + 0.85 * ep));
    }
    const spacing = Math.max(1, estSize * sp);
    const pts = this.engine.continueStroke(x, y, spacing, penPressure);
    pts.forEach((pt) => this._applyBrushStamp(pt.x, pt.y, pt.pressure || 1));
    this._renderDisplay();
    this._setStatus(`X: ${Math.round(x)}  Y: ${Math.round(y)}`);
    return;
  }

  if (this.tool === "smudge") {
    if (this._lastSmudgePt) {
      // Interpolate between last point and current for smooth smudging
      const lx = this._lastSmudgePt.x, ly2 = this._lastSmudgePt.y;
      const dist = Math.hypot(x - lx, y - ly2);
      const step = Math.max(2, this.brush.size * 0.3);
      if (dist > step) {
        const steps = Math.ceil(dist / step);
        let px = lx, py = ly2;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const nx = lx + (x - lx) * t;
          const ny = ly2 + (y - ly2) * t;
          this._applySmudge(nx, ny, px, py);
          px = nx;
          py = ny;
        }
      } else {
        this._applySmudge(x, y, lx, ly2);
      }
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
      this.el.cursorCvs.getContext("2d").clearRect(0, 0, this.el.cursorCvs.width, this.el.cursorCvs.height);
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

  // Only apply pressure from pen strokes, not mouse
  const isPen = this._currentPointerType === "pen";
  let drawSize = s.size;
  let flow = s.flow / 100;

  if (isPen && pressure != null) {
    const p = pressure;
    if (this.pressureSize) {
      drawSize = Math.max(1, s.size * (0.15 + 0.85 * p));
    }
    if (this.pressureOpacity) {
      // Scale flow by pressure squared for visible variation
      // (linear pressure builds up too fast with overlapping stamps)
      flow *= p * p;
    }
  }

  this.engine.applyStampToCtx(
    this.strokeCtx,
    stamp,
    x,
    y,
    drawSize,
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
