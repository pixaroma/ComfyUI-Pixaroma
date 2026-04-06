// ============================================================
// Pixaroma Paint Studio — Transform handles, hit-test, zoom/pan, view math
// ============================================================
import { PaintStudio } from "./core.mjs";

const proto = PaintStudio.prototype;

// ─── Transform Handles ────────────────────────────────────

proto._getLayerCorners = function (ly) {
  const t = ly.transform;
  const b = this._getContentBounds(ly);
  const bx = b.x,
    by = b.y,
    bw = b.w,
    bh = b.h;
  const sx = t.scaleX * (t.flipX ? -1 : 1);
  const sy = t.scaleY * (t.flipY ? -1 : 1);
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad),
    sin = Math.sin(rad);
  const pox = t.pivotOffX || 0,
    poy = t.pivotOffY || 0;
  const pivX = this.docW / 2 + pox,
    pivY = this.docH / 2 + poy;
  // Final screen position = (tx + pivX) + rotate+scale(point - pivot)
  const tp = (lx, ly2) => {
    const ax = (lx - pivX) * sx;
    const ay = (ly2 - pivY) * sy;
    return {
      x: t.x + pivX + ax * cos - ay * sin,
      y: t.y + pivY + ax * sin + ay * cos,
    };
  };
  return [tp(bx, by), tp(bx + bw, by), tp(bx + bw, by + bh), tp(bx, by + bh)];
};

proto._drawTransformHandles = function (ctx, ly) {
  const corners = this._getLayerCorners(ly);
  const t = ly.transform;
  const pox = t.pivotOffX || 0,
    poy = t.pivotOffY || 0;
  const pivot = { x: t.x + this.docW / 2 + pox, y: t.y + this.docH / 2 + poy };

  // Dashed bounding box
  ctx.save();
  ctx.strokeStyle = "#f66744";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  // Corner handles (scale)
  const HR = 7;
  corners.forEach((c) => {
    ctx.beginPath();
    ctx.arc(c.x, c.y, HR, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#f66744";
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // Rotation handle (above top center, direction away from pivot)
  const topMid = {
    x: (corners[0].x + corners[1].x) / 2,
    y: (corners[0].y + corners[1].y) / 2,
  };
  const dx = topMid.x - pivot.x,
    dy = topMid.y - pivot.y;
  const len = Math.hypot(dx, dy) || 1;
  const rotH = { x: topMid.x + (dx / len) * 30, y: topMid.y + (dy / len) * 30 };

  ctx.beginPath();
  ctx.moveTo(topMid.x, topMid.y);
  ctx.lineTo(rotH.x, rotH.y);
  ctx.strokeStyle = "#f66744";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rotH.x, rotH.y, HR, 0, Math.PI * 2);
  ctx.fillStyle = "#f66744";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("\u21bb", rotH.x, rotH.y);

  // Pivot point handle (draggable center)
  ctx.beginPath();
  ctx.arc(pivot.x, pivot.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fill();
  ctx.strokeStyle = "#f66744";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Crosshair lines on pivot
  ctx.beginPath();
  ctx.moveTo(pivot.x - 8, pivot.y);
  ctx.lineTo(pivot.x + 8, pivot.y);
  ctx.moveTo(pivot.x, pivot.y - 8);
  ctx.lineTo(pivot.x, pivot.y + 8);
  ctx.strokeStyle = "#f66744";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
};

proto._hitTestHandle = function (docX, docY, ly) {
  const HR = 12;
  const corners = this._getLayerCorners(ly);
  const t = ly.transform;
  const pox = t.pivotOffX || 0,
    poy = t.pivotOffY || 0;
  const pivot = { x: t.x + this.docW / 2 + pox, y: t.y + this.docH / 2 + poy };

  // Pivot handle (highest priority)
  if (Math.hypot(docX - pivot.x, docY - pivot.y) <= HR)
    return { type: "pivot" };

  // Rotation handle
  const topMid = {
    x: (corners[0].x + corners[1].x) / 2,
    y: (corners[0].y + corners[1].y) / 2,
  };
  const dx = topMid.x - pivot.x,
    dy = topMid.y - pivot.y;
  const len = Math.hypot(dx, dy) || 1;
  const rotH = { x: topMid.x + (dx / len) * 30, y: topMid.y + (dy / len) * 30 };
  if (Math.hypot(docX - rotH.x, docY - rotH.y) <= HR)
    return { type: "rotate", center: pivot };

  // Corner handles
  for (let i = 0; i < 4; i++) {
    if (Math.hypot(docX - corners[i].x, docY - corners[i].y) <= HR) {
      return { type: "scale", center: pivot, cornerIdx: i, corner: corners[i] };
    }
  }

  // Inside bounds (move)
  if (this._pointInQuad(docX, docY, corners)) return { type: "move" };

  return null;
};

// Convert document-space coordinates to raw layer canvas coordinates (inverse transform)
proto._docToLayerCanvas = function (ly, x, y) {
  const t = ly.transform;
  const pox = t.pivotOffX || 0,
    poy = t.pivotOffY || 0;
  const pivX = this.docW / 2 + pox,
    pivY = this.docH / 2 + poy;
  const dx = x - (t.x + pivX),
    dy = y - (t.y + pivY);
  const rad = (-t.rotation * Math.PI) / 180;
  const cr = Math.cos(rad),
    sr = Math.sin(rad);
  const udx = dx * cr - dy * sr;
  const udy = dx * sr + dy * cr;
  const sx = t.scaleX * (t.flipX ? -1 : 1);
  const sy = t.scaleY * (t.flipY ? -1 : 1);
  return { x: udx / sx + pivX, y: udy / sy + pivY };
};

proto._pointInQuad = function (px, py, pts) {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = pts[i].x,
      yi = pts[i].y,
      xj = pts[j].x,
      yj = pts[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
};

// ─── View transform ───────────────────────────────────────

proto._fitToView = function () {
  const wsRect = this.el.workspace.getBoundingClientRect();
  if (!wsRect.width || !wsRect.height) return;
  const wsW = wsRect.width,
    wsH = wsRect.height - 48;
  this.zoom = Math.min(wsW / this.docW, wsH / this.docH, 2.0);
  this.panX = (wsW - this.docW * this.zoom) / 2;
  this.panY = (wsH - this.docH * this.zoom) / 2;
  this._applyViewTransform();
};

proto._zoomAt = function (center, delta) {
  const wsRect = this.el.workspace.getBoundingClientRect();
  const mx = center ? center.x - wsRect.left : wsRect.width / 2;
  const my = center ? center.y - wsRect.top : (wsRect.height - 48) / 2;
  const oldZ = this.zoom;
  this.zoom = Math.max(0.05, Math.min(8, this.zoom + delta));
  const scale = this.zoom / oldZ;
  this.panX = mx - (mx - this.panX) * scale;
  this.panY = my - (my - this.panY) * scale;
  this._applyViewTransform();
};

proto._applyViewTransform = function () {
  this.el.viewport.style.transform = `translate(${this.panX}px,${this.panY}px) scale(${this.zoom})`;
  if (this.el.dimLabel) {
    const inv = 1 / this.zoom;
    this.el.dimLabel.style.transform = `scale(${inv})`;
    this.el.dimLabel.style.bottom = `${-18 * inv}px`;
  }
  const label = Math.round(this.zoom * 100) + "%";
  if (this.el.zoomLabel) this.el.zoomLabel.textContent = label;
  if (this._layout) this._layout.setZoomLabel(label);
};

proto._screenToDoc = function (ex, ey) {
  const vpRect = this.el.displayCanvas.getBoundingClientRect();
  return {
    x: (ex - vpRect.left) * (this.docW / vpRect.width),
    y: (ey - vpRect.top) * (this.docH / vpRect.height),
  };
};

// ─── Transform apply ──────────────────────────────────────

proto._applyLayerTransform = function (idx) {
  const i = idx !== undefined ? idx : this.activeIdx;
  const ly = this.layers[i];
  if (!ly) return;
  if (!this._hasTransform(ly)) {
    this._setStatus("No transform to apply");
    return;
  }
  this._pushHistory();
  const tmp = document.createElement("canvas");
  tmp.width = this.docW;
  tmp.height = this.docH;
  this._drawLayerWithTransform(tmp.getContext("2d"), ly);
  ly.ctx.clearRect(0, 0, this.docW, this.docH);
  ly.ctx.drawImage(tmp, 0, 0);
  ly.transform = {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
    pivotOffX: 0,
    pivotOffY: 0,
  };
  this._contentBoundsCache.delete(ly.id);
  this._syncTransformPanel();
  this._updateTransformWarn();
  this._updateLayerThumb(i);
  this._renderDisplay();
  this._setStatus("\u2713 Transform applied \u2014 ready to draw");
};

proto._fitLayerToCanvas = function (ly, dir) {
  const b = this._getContentBounds(ly);
  if (b.w < 1 || b.h < 1) return;
  // Compute scale so content fills the requested dimension, keep aspect ratio
  const s = dir === "w" ? this.docW / b.w : this.docH / b.h;
  ly.transform.scaleX = s;
  ly.transform.scaleY = s;
  ly.transform.rotation = 0;
  ly.transform.flipX = false;
  ly.transform.flipY = false;
  // Reset pivot to canvas center so the centering math below is correct
  ly.transform.pivotOffX = 0;
  ly.transform.pivotOffY = 0;
  // Center the content on the canvas
  ly.transform.x = -(b.x + b.w / 2 - this.docW / 2) * s;
  ly.transform.y = -(b.y + b.h / 2 - this.docH / 2) * s;
};

// ─── Content bounds (tight pixel bounding box) ────────────

proto._getContentBounds = function (ly) {
  if (this._contentBoundsCache.has(ly.id))
    return this._contentBoundsCache.get(ly.id);
  const w = this.docW,
    h = this.docH;
  try {
    const data = ly.ctx.getImageData(0, 0, w, h).data;
    let minY = -1, maxY = -1;

    // Scan top-down for first non-transparent row
    for (let y = 0; y < h; y++) {
      const rowOff = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (data[rowOff + x * 4 + 3] > 0) { minY = y; break; }
      }
      if (minY >= 0) break;
    }
    if (minY < 0) {
      const bounds = { x: 0, y: 0, w, h };
      this._contentBoundsCache.set(ly.id, bounds);
      return bounds;
    }

    // Scan bottom-up for last non-transparent row
    for (let y = h - 1; y >= minY; y--) {
      const rowOff = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (data[rowOff + x * 4 + 3] > 0) { maxY = y; break; }
      }
      if (maxY >= 0) break;
    }

    // Scan only the relevant rows for X bounds
    let minX = w, maxX = 0;
    for (let y = minY; y <= maxY; y++) {
      const rowOff = y * w * 4;
      // Scan from left for this row's minX
      for (let x = 0; x < minX; x++) {
        if (data[rowOff + x * 4 + 3] > 0) { minX = x; break; }
      }
      // Scan from right for this row's maxX
      for (let x = w - 1; x > maxX; x--) {
        if (data[rowOff + x * 4 + 3] > 0) { maxX = x; break; }
      }
      // Early exit: can't improve further
      if (minX === 0 && maxX === w - 1) break;
    }

    const bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    this._contentBoundsCache.set(ly.id, bounds);
    return bounds;
  } catch (e) {
    return { x: 0, y: 0, w, h };
  }
};
