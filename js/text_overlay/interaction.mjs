// ╔═══════════════════════════════════════════════════════════════╗
// ║  Text Overlay canvas interaction                             ║
// ║  Adds prototype methods to TextOverlayEditor (mixin pattern). ║
// ╚═══════════════════════════════════════════════════════════════╝

import { TextOverlayEditor } from "./core.mjs";

const HANDLE_SIZE = 10;
const ROT_HANDLE_OFFSET = 25;

TextOverlayEditor.prototype._installInteractions = function () {
  this.canvas.style.cursor = "default";
  this._onCanvasMouseDownBound = (e) => this._onCanvasMouseDown(e);
  this._onMouseMoveBound = (e) => this._onCanvasMouseMove(e);
  this._onMouseUpBound = (e) => this._onCanvasMouseUp(e);
  this._onCanvasDblClickBound = (e) => this._onCanvasDblClick(e);
  this._onKeyDownBound = (e) => this._onKeyDown(e);

  this.canvas.addEventListener("mousedown", this._onCanvasMouseDownBound);
  window.addEventListener("mousemove", this._onMouseMoveBound);
  window.addEventListener("mouseup", this._onMouseUpBound);
  this.canvas.addEventListener("dblclick", this._onCanvasDblClickBound);
  // Listen on overlay so we get keys regardless of focus
  this.layout.overlay.addEventListener("keydown", this._onKeyDownBound);
  // Tab the overlay so it can receive key events
  this.layout.overlay.tabIndex = -1;
  this.layout.overlay.focus();
};

TextOverlayEditor.prototype._uninstallInteractions = function () {
  if (this.canvas) this.canvas.removeEventListener("mousedown", this._onCanvasMouseDownBound);
  window.removeEventListener("mousemove", this._onMouseMoveBound);
  window.removeEventListener("mouseup", this._onMouseUpBound);
  if (this.canvas) this.canvas.removeEventListener("dblclick", this._onCanvasDblClickBound);
  if (this.layout?.overlay) this.layout.overlay.removeEventListener("keydown", this._onKeyDownBound);
};

TextOverlayEditor.prototype._canvasCoords = function (e) {
  const r = this.canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / this._zoom,
    y: (e.clientY - r.top) / this._zoom,
  };
};

// Approximate bbox using offscreen measureText. Not exact (real bbox uses
// actualBoundingBoxAscent etc. via the async loaded font), but close enough
// for hit-testing and handle placement.
TextOverlayEditor.prototype._layerBbox = function (layer) {
  if (!this._measureCtx) {
    const c = document.createElement("canvas"); c.width = 1; c.height = 1;
    this._measureCtx = c.getContext("2d");
  }
  const ctx = this._measureCtx;
  const fam = `Pix-${layer.font}${layer.italic ? "-Italic" : ""}`;
  ctx.font = `${layer.italic ? "italic " : ""}${layer.weight || 400} ${layer.fontSize}px "${fam}"`;
  const lines = String(layer.text ?? "").split("\n");
  const widths = lines.map((ln) => ctx.measureText(ln).width + Math.max(0, ln.length - 1) * (layer.letterSpacing || 0));
  const lineHeightPx = Math.round(layer.fontSize * (layer.lineHeight || 1.2));
  let w = Math.max(0, ...widths);
  let h = lines.length * lineHeightPx;
  if (layer.background) {
    w += 2 * (layer.background.paddingX || 12);
    h += 2 * (layer.background.paddingY || 8);
  }
  return { x: layer.x, y: layer.y, w: Math.max(20, w), h: Math.max(20, h) };
};

TextOverlayEditor.prototype._inverseRotate = function (px, py, cx, cy, rotDeg) {
  const rad = (-(rotDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return {
    x: (px - cx) * cos - (py - cy) * sin + cx,
    y: (px - cx) * sin + (py - cy) * cos + cy,
  };
};

TextOverlayEditor.prototype._hitTestLayer = function (px, py) {
  for (let i = this.layers.length - 1; i >= 0; i--) {
    const layer = this.layers[i];
    if (layer.visible === false) continue;
    const b = this._layerBbox(layer);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const p = this._inverseRotate(px, py, cx, cy, layer.rotation);
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i;
  }
  return -1;
};

TextOverlayEditor.prototype._hitTestHandle = function (px, py) {
  const i = this.selectedIndex;
  if (i < 0) return null;
  const layer = this.layers[i];
  const b = this._layerBbox(layer);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const p = this._inverseRotate(px, py, cx, cy, layer.rotation);
  const handles = {
    nw: { x: b.x, y: b.y },
    ne: { x: b.x + b.w, y: b.y },
    sw: { x: b.x, y: b.y + b.h },
    se: { x: b.x + b.w, y: b.y + b.h },
    rot: { x: b.x + b.w / 2, y: b.y - ROT_HANDLE_OFFSET },
  };
  const hs = HANDLE_SIZE / this._zoom;
  for (const [name, hp] of Object.entries(handles)) {
    if (Math.abs(p.x - hp.x) <= hs && Math.abs(p.y - hp.y) <= hs) return name;
  }
  return null;
};

TextOverlayEditor.prototype._onCanvasMouseDown = function (e) {
  if (e.button !== 0) return;
  const p = this._canvasCoords(e);
  const handle = this._hitTestHandle(p.x, p.y);
  if (handle) {
    this._dragMode = handle === "rot" ? "rotate" : "scale";
    this._dragHandle = handle;
    this._dragOrigin = { x: p.x, y: p.y, layer: { ...this.layers[this.selectedIndex] } };
    this._snapshotMaybe();
    e.preventDefault();
    return;
  }
  const idx = this._hitTestLayer(p.x, p.y);
  if (idx >= 0) {
    this.selectedIndex = idx;
    this._syncLayerSelection();
    this._rebuildLayersPanel();
    this._dragMode = "move";
    this._dragOrigin = { x: p.x, y: p.y, layer: { ...this.layers[idx] } };
    this._snapshotMaybe();
    this.requestRender();
    e.preventDefault();
  } else {
    if (this.selectedIndex >= 0) {
      this.selectedIndex = -1;
      this._syncLayerSelection();
      this._rebuildLayersPanel();
      this.requestRender();
    }
  }
};

TextOverlayEditor.prototype._onCanvasMouseMove = function (e) {
  if (!this._dragMode) return;
  const p = this._canvasCoords(e);
  const layer = this.layers[this.selectedIndex];
  if (!layer) { this._dragMode = null; return; }
  const origLayer = this._dragOrigin.layer;

  if (this._dragMode === "move") {
    layer.x = origLayer.x + (p.x - this._dragOrigin.x);
    layer.y = origLayer.y + (p.y - this._dragOrigin.y);
  } else if (this._dragMode === "scale") {
    const origBox = this._layerBbox(origLayer);
    const cx = origBox.x + origBox.w / 2;
    const cy = origBox.y + origBox.h / 2;
    const origDist = Math.hypot(this._dragOrigin.x - cx, this._dragOrigin.y - cy);
    const newDist = Math.hypot(p.x - cx, p.y - cy);
    const factor = Math.max(0.1, newDist / Math.max(1, origDist));
    layer.fontSize = Math.max(8, Math.round(origLayer.fontSize * factor));
    if (!e.altKey) {
      const newBox = this._layerBbox(layer);
      const opp = { nw: "se", ne: "sw", sw: "ne", se: "nw" }[this._dragHandle];
      const anchors = {
        nw: { x: origBox.x, y: origBox.y },
        ne: { x: origBox.x + origBox.w, y: origBox.y },
        sw: { x: origBox.x, y: origBox.y + origBox.h },
        se: { x: origBox.x + origBox.w, y: origBox.y + origBox.h },
      };
      const newOffsets = {
        nw: { dx: 0, dy: 0 },
        ne: { dx: newBox.w, dy: 0 },
        sw: { dx: 0, dy: newBox.h },
        se: { dx: newBox.w, dy: newBox.h },
      };
      const a = anchors[opp];
      const o = newOffsets[opp];
      layer.x = a.x - o.dx;
      layer.y = a.y - o.dy;
    }
  } else if (this._dragMode === "rotate") {
    const origBox = this._layerBbox(origLayer);
    const cx = origBox.x + origBox.w / 2;
    const cy = origBox.y + origBox.h / 2;
    let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    layer.rotation = Math.round(deg);
  }
  this.textPanel.setLayer(layer);
  this.requestRender();
};

TextOverlayEditor.prototype._onCanvasMouseUp = function () {
  this._dragMode = null;
};

TextOverlayEditor.prototype._onCanvasDblClick = function (e) {
  const p = this._canvasCoords(e);
  if (this._hitTestLayer(p.x, p.y) < 0) {
    this.addLayer({ x: p.x - 50, y: p.y - 18 });
  }
};

TextOverlayEditor.prototype._onKeyDown = function (e) {
  // Skip when typing in a form field
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;

  // Ctrl/Cmd Z / Y
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") {
    this.undo(); e.preventDefault(); e.stopImmediatePropagation(); return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z" || e.key === "Z"))) {
    this.redo(); e.preventDefault(); e.stopImmediatePropagation(); return;
  }

  const layer = this.layers[this.selectedIndex];
  if (!layer) return;
  const step = e.shiftKey ? 10 : 1;
  if (e.key === "ArrowLeft") { layer.x -= step; this._snapshotMaybe(); this.textPanel.setLayer(layer); this.requestRender(); e.preventDefault(); }
  else if (e.key === "ArrowRight") { layer.x += step; this._snapshotMaybe(); this.textPanel.setLayer(layer); this.requestRender(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { layer.y -= step; this._snapshotMaybe(); this.textPanel.setLayer(layer); this.requestRender(); e.preventDefault(); }
  else if (e.key === "ArrowDown") { layer.y += step; this._snapshotMaybe(); this.textPanel.setLayer(layer); this.requestRender(); e.preventDefault(); }
  else if (e.key === "Delete" || e.key === "Backspace") { this.deleteSelected(); e.preventDefault(); }
};

TextOverlayEditor.prototype._drawSelectionOverlay = function (ctx) {
  const idx = this.selectedIndex;
  if (idx < 0) return;
  const layer = this.layers[idx];
  if (!layer || layer.visible === false) return;
  const b = this._layerBbox(layer);
  ctx.save();
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  ctx.translate(cx, cy);
  ctx.rotate(((layer.rotation || 0) * Math.PI) / 180);
  ctx.translate(-cx, -cy);

  ctx.strokeStyle = "#f66744";
  ctx.lineWidth = 2 / this._zoom;
  ctx.setLineDash([6 / this._zoom, 4 / this._zoom]);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);

  const hs = HANDLE_SIZE / this._zoom;
  const corners = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x, y: b.y + b.h },
    { x: b.x + b.w, y: b.y + b.h },
  ];
  ctx.fillStyle = "#f66744";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1 / this._zoom;
  for (const p of corners) {
    ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
    ctx.strokeRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
  }

  // Rotation handle (line + circle)
  const rh = { x: cx, y: b.y - ROT_HANDLE_OFFSET };
  ctx.strokeStyle = "#f66744";
  ctx.beginPath(); ctx.moveTo(cx, b.y); ctx.lineTo(rh.x, rh.y); ctx.stroke();
  ctx.beginPath(); ctx.arc(rh.x, rh.y, hs / 2, 0, Math.PI * 2);
  ctx.fillStyle = "#f66744"; ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.stroke();

  ctx.restore();
};
