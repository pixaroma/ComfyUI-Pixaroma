// ============================================================
// Pixaroma Paint Studio — Layer rendering, grid drawing
// ============================================================
import { PaintStudio } from "./core.mjs";

const proto = PaintStudio.prototype;

proto._drawLayerWithTransform = function (ctx, ly) {
  const t = ly.transform;
  const pox = t.pivotOffX || 0;
  const poy = t.pivotOffY || 0;
  const pivX = this.docW / 2 + pox;
  const pivY = this.docH / 2 + poy;
  const hasTransform =
    t.x !== 0 ||
    t.y !== 0 ||
    t.scaleX !== 1 ||
    t.scaleY !== 1 ||
    t.rotation !== 0 ||
    t.flipX ||
    t.flipY ||
    pox !== 0 ||
    poy !== 0;
  if (hasTransform) {
    ctx.save();
    ctx.translate(t.x + pivX, t.y + pivY);
    ctx.rotate((t.rotation * Math.PI) / 180);
    ctx.scale(t.scaleX * (t.flipX ? -1 : 1), t.scaleY * (t.flipY ? -1 : 1));
    ctx.drawImage(ly.canvas, -pivX, -pivY);
    ctx.restore();
  } else {
    ctx.drawImage(ly.canvas, 0, 0);
  }
};

proto._renderDisplay = function () {
  const ctx = this.el.displayCanvas.getContext("2d");
  ctx.clearRect(0, 0, this.docW, this.docH);
  ctx.fillStyle = this.bgColor;
  ctx.fillRect(0, 0, this.docW, this.docH);

  for (let i = this.layers.length - 1; i >= 0; i--) {
    const ly = this.layers[i];
    if (!ly.visible) continue;
    ctx.save();
    ctx.globalAlpha = ly.opacity / 100;
    ctx.globalCompositeOperation = ly.blendMode;
    this._drawLayerWithTransform(ctx, ly);
    ctx.restore();
  }

  // Stroke overlay (during drawing) — brush/pencil show accumulation, eraser shows preview
  if (
    this.isDrawing &&
    this.strokeCanvas &&
    (this.tool === "brush" || this.tool === "pencil")
  ) {
    ctx.save();
    ctx.globalAlpha = this.brush.opacity / 100;
    ctx.drawImage(this.strokeCanvas, 0, 0);
    ctx.restore();
  }
  if (this.isDrawing && this.strokeCanvas && this.tool === "eraser") {
    // Show eraser preview as semi-transparent darkening
    ctx.save();
    ctx.globalAlpha = (this.brush.opacity / 100) * 0.4;
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(this.strokeCanvas, 0, 0);
    ctx.restore();
  }

  // Transform handles + multi-select outlines
  if (this.tool === "transform") {
    // Draw blue outlines for other selected layers
    this.selectedIndices.forEach((idx) => {
      if (idx === this.activeIdx) return;
      const sl = this.layers[idx];
      if (!sl) return;
      const corners = this._getLayerCorners(sl);
      ctx.save();
      ctx.strokeStyle = "#0ea5e9";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    });
    // Draw full handles for the active layer
    const ly = this.layers[this.activeIdx];
    if (ly) this._drawTransformHandles(ctx, ly);
  }

  if (this.showGrid) this._drawGrid(ctx);
};

proto._drawGrid = function (ctx) {
  const gs = 64;
  ctx.save();
  ctx.strokeStyle = "rgba(200,200,255,0.12)";
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= this.docW; x += gs) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.docH);
    ctx.stroke();
  }
  for (let y = 0; y <= this.docH; y += gs) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(this.docW, y);
    ctx.stroke();
  }
  ctx.restore();
};
