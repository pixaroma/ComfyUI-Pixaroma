// ============================================================
// Inpaint Crop Pixaroma — mask painting (brush, erase, cursor, undo, keys)
// Mask canvas = white RGB + per-pixel alpha (strength) on a transparent bg, so
// the red overlay tints via destination-in and the export bakes soft edges by
// compositing over black. Self-contained - no dependency on js/paint/.
// ============================================================
import { InpaintCropEditor, BRAND } from "./core.mjs";

const proto = InpaintCropEditor.prototype;
const MAX_UNDO = 15;

proto._ensureMaskCanvas = function () {
  if (this._mask && this._mask.width === this.imgW && this._mask.height === this.imgH) return;
  const m = document.createElement("canvas");
  m.width = this.imgW; m.height = this.imgH;
  this._mask = m;
  this._mctx = m.getContext("2d");
  this._undo = []; this._redo = [];
  this.layout?.setUndoState({ canUndo: false, canRedo: false });
};

// ── pointer ──────────────────────────────────────────────────────────────
proto._displayPos = function (e) {
  const r = this.el.canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

proto._bindMouse = function (cvs) {
  let winMove = null, winUp = null;
  const detach = () => {
    if (winMove) window.removeEventListener("mousemove", winMove), (winMove = null);
    if (winUp) window.removeEventListener("mouseup", winUp), (winUp = null);
  };
  cvs.addEventListener("mousedown", (e) => {
    if (!this.img || e.button !== 0) return;
    e.preventDefault();
    this._beginStroke(e);
    detach();
    winMove = (ev) => this._strokeMove(ev);
    winUp = () => { this._endStroke(); detach(); };
    window.addEventListener("mousemove", winMove);
    window.addEventListener("mouseup", winUp);
  });
  cvs.addEventListener("mousemove", (e) => { if (!this._painting) this._drawCursor(this._displayPos(e)); });
  cvs.addEventListener("mouseleave", () => { if (!this._painting) this.el.curCtx?.clearRect(0, 0, this.el.cursor.width, this.el.cursor.height); });
  cvs.addEventListener("wheel", (e) => {
    e.preventDefault();
    const d = e.deltaY < 0 ? 4 : -4;
    this.brushSize = Math.max(2, Math.min(300, this.brushSize + d));
    this.el.sizeSlider?.setValue(this.brushSize);
    this._drawCursor(this._displayPos(e));
  }, { passive: false });
};

proto._effectiveTool = function () {
  // hold X to temporarily flip to erase
  return this._xHeld ? (this.tool === "erase" ? "add" : "erase") : this.tool;
};

proto._beginStroke = function (e) {
  this._pushUndo();
  this._painting = true;
  this._lastPt = null;
  this._strokeMove(e);
};

proto._strokeMove = function (e) {
  const p = this._displayPos(e);
  const s = this._scale || 1;
  const sx = p.x / s, sy = p.y / s;
  if (this._lastPt) this._stampLine(this._lastPt.x, this._lastPt.y, sx, sy);
  else this._stampDab(sx, sy);
  this._lastPt = { x: sx, y: sy };
  this._draw();
  this._drawCursor(p);
};

proto._endStroke = function () {
  this._painting = false;
  this._lastPt = null;
  this._recomputeRegion();
  this._draw();
};

// ── brush stamps (source-space coords on the mask canvas) ──────────────────
proto._stampDab = function (sx, sy) {
  const ctx = this._mctx;
  const r = Math.max(0.5, (this.brushSize / 2) / (this._scale || 1));
  const erase = this._effectiveTool() === "erase";
  ctx.save();
  ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
  const core = Math.max(0, 1 - this.softness);
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(Math.min(0.999, core), "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
};

proto._stampLine = function (x0, y0, x1, y1) {
  const r = Math.max(0.5, (this.brushSize / 2) / (this._scale || 1));
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(1, r * 0.25);
  const n = Math.ceil(dist / step);
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    this._stampDab(x0 + dx * t, y0 + dy * t);
  }
};

// ── cursor ring ────────────────────────────────────────────────────────────
proto._drawCursor = function (p) {
  const ctx = this.el.curCtx;
  if (!ctx) return;
  ctx.clearRect(0, 0, this.el.cursor.width, this.el.cursor.height);
  const r = this.brushSize / 2;
  const erase = this._effectiveTool() === "erase";
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = erase ? "#ffffff" : BRAND;
  if (erase) ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = erase ? "#ffffff" : BRAND;
  ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill();
};

// ── mask ops ────────────────────────────────────────────────────────────────
proto._clearMask = function () {
  if (!this._mask) return;
  this._pushUndo();
  this._mctx.clearRect(0, 0, this.imgW, this.imgH);
  this._endStroke();
};

proto._invertMask = function () {
  if (!this._mask) return;
  this._pushUndo();
  const id = this._mctx.getImageData(0, 0, this.imgW, this.imgH);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255 - d[i + 3]; }
  this._mctx.putImageData(id, 0, 0);
  this._endStroke();
};

proto._loadMaskFromURL = function (url) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    this._ensureMaskCanvas();
    const tmp = document.createElement("canvas");
    tmp.width = this.imgW; tmp.height = this.imgH;
    const tctx = tmp.getContext("2d");
    tctx.drawImage(img, 0, 0, this.imgW, this.imgH);
    const id = tctx.getImageData(0, 0, this.imgW, this.imgH);
    const d = id.data;
    // grayscale (white = masked) -> white RGB + alpha = luminance
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i]; // grayscale, r==g==b
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = a;
    }
    this._mctx.putImageData(id, 0, 0);
    this._undo = []; this._redo = [];
    this.layout?.setUndoState({ canUndo: false, canRedo: false });
    this._recomputeRegion();
    this._draw();
  };
  img.onerror = () => {};
  img.src = url;
};

// composite the mask over black -> grayscale dataURL (white = masked)
proto._exportMaskDataURL = function () {
  const out = document.createElement("canvas");
  out.width = this.imgW; out.height = this.imgH;
  const o = out.getContext("2d");
  o.fillStyle = "#000"; o.fillRect(0, 0, this.imgW, this.imgH);
  if (this._mask) o.drawImage(this._mask, 0, 0);
  return out.toDataURL("image/png");
};

// ── undo / redo ──────────────────────────────────────────────────────────
proto._pushUndo = function () {
  if (!this._mask) return;
  try { this._undo.push(this._mctx.getImageData(0, 0, this.imgW, this.imgH)); } catch (e) { return; }
  if (this._undo.length > MAX_UNDO) this._undo.shift();
  this._redo = [];
  this.layout?.setUndoState({ canUndo: this._undo.length > 0, canRedo: false });
};

proto._doUndo = function () {
  if (!this._mask || !this._undo.length) return;
  this._redo.push(this._mctx.getImageData(0, 0, this.imgW, this.imgH));
  this._mctx.putImageData(this._undo.pop(), 0, 0);
  this._recomputeRegion(); this._draw();
  this.layout?.setUndoState({ canUndo: this._undo.length > 0, canRedo: this._redo.length > 0 });
};

proto._doRedo = function () {
  if (!this._mask || !this._redo.length) return;
  this._undo.push(this._mctx.getImageData(0, 0, this.imgW, this.imgH));
  this._mctx.putImageData(this._redo.pop(), 0, 0);
  this._recomputeRegion(); this._draw();
  this.layout?.setUndoState({ canUndo: this._undo.length > 0, canRedo: this._redo.length > 0 });
};

// ── keys ────────────────────────────────────────────────────────────────────
proto._bindKeys = function () {
  this._keyHandler = (e) => {
    const ae = document.activeElement;
    if ((ae?.tagName === "INPUT" || ae?.tagName === "TEXTAREA" || ae?.tagName === "SELECT") && !ae?.dataset?.pixaromaTrap) return;
    const key = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (key === "escape") { e.preventDefault(); e.stopImmediatePropagation(); this._close(); return; }
    if (ctrl && key === "s") { e.preventDefault(); this._save(); return; }
    if (ctrl && key === "z" && !e.shiftKey) { e.preventDefault(); this._doUndo(); return; }
    if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) { e.preventDefault(); this._doRedo(); return; }
    if (ctrl) return;
    if (key === "b") { e.preventDefault(); this._setTool("add"); this._toolGrid?.setActive?.("add"); return; }
    if (key === "e") { e.preventDefault(); this._setTool("erase"); this._toolGrid?.setActive?.("erase"); return; }
    if (key === "h") { e.preventDefault(); this._toggleMaskVisible(); return; }
    if (key === "x") { this._xHeld = true; return; }
    if (key === "[") { e.preventDefault(); this.brushSize = Math.max(2, this.brushSize - 4); this.el.sizeSlider?.setValue(this.brushSize); return; }
    if (key === "]") { e.preventDefault(); this.brushSize = Math.min(300, this.brushSize + 4); this.el.sizeSlider?.setValue(this.brushSize); return; }
  };
  this._keyUpHandler = (e) => { if (e.key.toLowerCase() === "x") this._xHeld = false; };
  window.addEventListener("keydown", this._keyHandler, { capture: true });
  window.addEventListener("keyup", this._keyUpHandler, { capture: true });
};

proto._unbindKeys = function () {
  if (this._keyHandler) window.removeEventListener("keydown", this._keyHandler, { capture: true });
  if (this._keyUpHandler) window.removeEventListener("keyup", this._keyUpHandler, { capture: true });
};
