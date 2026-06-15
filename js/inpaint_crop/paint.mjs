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
  // per-stroke buffer: stamps accumulate here, then bake onto the mask with a
  // blur-on-bake soft edge (so overlapping stamps can't stack into a hard rim).
  const sc = document.createElement("canvas");
  sc.width = this.imgW; sc.height = this.imgH;
  this._stroke = sc;
  this._sctx = sc.getContext("2d");
  this._strokeHasContent = false;
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
  cvs.addEventListener("mouseleave", () => { if (!this._painting) { this.el.curCtx?.clearRect(0, 0, this._dispW || this.el.cursor.width, this._dispH || this.el.cursor.height); this._lastCursorPos = null; } });
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
  // lock the add/erase choice for the whole stroke (X can be released mid-drag)
  this._strokeTool = this._effectiveTool();
  this._sctx.clearRect(0, 0, this.imgW, this.imgH);
  this._strokeHasContent = false;
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

// soft-edge feather width (source px) baked onto the stroke. 0 = crisp.
proto._bakeBlurPx = function () {
  const rSrc = (this.brushSize / 2) / (this._scale || 1);
  return Math.round(this.softness * rSrc);
};

// composite the (blurred) stroke buffer onto a target ctx using the locked tool
proto._compositeStroke = function (ctx) {
  const blur = this._bakeBlurPx();
  ctx.save();
  if (blur > 0) ctx.filter = `blur(${blur}px)`;
  ctx.globalCompositeOperation = this._strokeTool === "erase" ? "destination-out" : "source-over";
  ctx.drawImage(this._stroke, 0, 0);
  ctx.restore();
};

proto._endStroke = function () {
  this._painting = false;
  this._lastPt = null;
  if (this._strokeHasContent) {
    this._compositeStroke(this._mctx);   // bake into the mask
    this._sctx.clearRect(0, 0, this.imgW, this.imgH);
    this._strokeHasContent = false;
  }
  this._rescanBBox();
  this._recomputeRegion();
  this._draw();
};

// the mask as it should DISPLAY right now (mask + the live stroke during a drag)
proto._effectiveMaskCanvas = function () {
  if (!this._painting || !this._strokeHasContent) return this._mask;
  if (!this._effMask) this._effMask = document.createElement("canvas");
  const c = this._effMask;
  if (c.width !== this.imgW || c.height !== this.imgH) { c.width = this.imgW; c.height = this.imgH; }
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, this.imgW, this.imgH);
  ctx.drawImage(this._mask, 0, 0);
  this._compositeStroke(ctx);
  return c;
};

// ── brush stamps: a crisp anti-aliased disc on the STROKE buffer. The soft edge
//    is the blur-on-bake (_bakeBlurPx), so overlapping stamps never stack hard.
proto._stampDab = function (sx, sy) {
  const ctx = this._sctx;
  const r = Math.max(0.5, (this.brushSize / 2) / (this._scale || 1));
  const g = ctx.createRadialGradient(sx, sy, Math.max(0, r - 1.2), sx, sy, r);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  // "lighten" = max-blend, so overlapping stamps in one stroke can't stack alpha
  // (no slow-stroke darkening); the soft edge is the blur-on-bake at stroke end.
  ctx.globalCompositeOperation = "lighten";
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  this._strokeHasContent = true;
};

proto._stampLine = function (x0, y0, x1, y1) {
  const r = Math.max(0.5, (this.brushSize / 2) / (this._scale || 1));
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(1, r * 0.12);  // tight enough to avoid gaps on fast, zoomed-out strokes
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
  this._lastCursorPos = p;
  ctx.clearRect(0, 0, this._dispW || this.el.cursor.width, this._dispH || this.el.cursor.height);
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
    this._rescanBBox();
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
  this._rescanBBox(); this._recomputeRegion(); this._draw();
  this.layout?.setUndoState({ canUndo: this._undo.length > 0, canRedo: this._redo.length > 0 });
};

proto._doRedo = function () {
  if (!this._mask || !this._redo.length) return;
  this._undo.push(this._mctx.getImageData(0, 0, this.imgW, this.imgH));
  this._mctx.putImageData(this._redo.pop(), 0, 0);
  this._rescanBBox(); this._recomputeRegion(); this._draw();
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
    if (key === "[" || key === "]") {
      e.preventDefault();
      const dir = key === "[" ? -1 : 1;
      // ignore OS auto-repeat (laggy) - drive a smooth ramp ourselves while held
      if (!e.repeat) { this._adjustBrush(dir * 4); this._startBrushHold(dir); }
      return;
    }
  };
  this._keyUpHandler = (e) => {
    const k = e.key.toLowerCase();
    if (k === "x") this._xHeld = false;
    if (k === "[" || k === "]") this._stopBrushHold();
  };
  window.addEventListener("keydown", this._keyHandler, { capture: true });
  window.addEventListener("keyup", this._keyUpHandler, { capture: true });
};

// brush resize: instant on tap, smooth-accelerating while held (no OS-repeat lag)
proto._adjustBrush = function (delta) {
  this.brushSize = Math.max(2, Math.min(300, this.brushSize + delta));
  this.el.sizeSlider?.setValue(this.brushSize);
  if (this._lastCursorPos) this._drawCursor(this._lastCursorPos);
};

proto._startBrushHold = function (dir) {
  this._stopBrushHold();
  this._holdDir = dir;
  let rate = 0.5, accum = 0;
  const tick = () => {
    if (!this.el.overlay?.isConnected) { this._stopBrushHold(); return; }
    rate = Math.min(3.4, rate + 0.12);
    accum += this._holdDir * rate;
    const step = Math.trunc(accum);
    if (step !== 0) { accum -= step; this._adjustBrush(step); }
    this._holdRaf = requestAnimationFrame(tick);
  };
  this._holdRaf = requestAnimationFrame(tick);
};

proto._stopBrushHold = function () {
  if (this._holdRaf) { cancelAnimationFrame(this._holdRaf); this._holdRaf = null; }
};

proto._unbindKeys = function () {
  this._stopBrushHold();
  if (this._keyHandler) window.removeEventListener("keydown", this._keyHandler, { capture: true });
  if (this._keyUpHandler) window.removeEventListener("keyup", this._keyUpHandler, { capture: true });
};
