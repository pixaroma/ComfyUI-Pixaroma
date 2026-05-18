// ╔═══════════════════════════════════════════════════════════════╗
// ║  Text Overlay canvas interaction (single-text version)       ║
// ╚═══════════════════════════════════════════════════════════════╝

import { TextOverlayEditor } from "./core.mjs";

const HANDLE_SIZE = 10;
const ROT_HANDLE_OFFSET = 25;

TextOverlayEditor.prototype._installInteractions = function () {
  this.canvas.style.cursor = "default";
  this._onCanvasMouseDownBound = (e) => this._onCanvasMouseDown(e);
  this._onMouseMoveBound = (e) => this._onCanvasMouseMove(e);
  this._onMouseUpBound = (e) => this._onCanvasMouseUp(e);
  this._onKeyDownBound = (e) => this._onKeyDown(e);
  this._onWheelBound = (e) => this._onCanvasWheel(e);

  // Listen on selCanvas (the larger overlay canvas, SEL_PAD px around
  // the main canvas) so handles outside the visible canvas are still
  // clickable. Falls back to this.canvas if selCanvas wasn't built.
  this._mouseDownTarget = this.selCanvas || this.canvas;
  this._mouseDownTarget.addEventListener("mousedown", this._onCanvasMouseDownBound);
  window.addEventListener("mousemove", this._onMouseMoveBound);
  window.addEventListener("mouseup", this._onMouseUpBound);
  this.layout.overlay.addEventListener("keydown", this._onKeyDownBound);
  if (this.canvasHost) this.canvasHost.addEventListener("wheel", this._onWheelBound, { passive: false });
  this.layout.overlay.tabIndex = -1;
  this.layout.overlay.focus();
};

TextOverlayEditor.prototype._uninstallInteractions = function () {
  if (this._mouseDownTarget) this._mouseDownTarget.removeEventListener("mousedown", this._onCanvasMouseDownBound);
  window.removeEventListener("mousemove", this._onMouseMoveBound);
  window.removeEventListener("mouseup", this._onMouseUpBound);
  if (this.layout?.overlay) this.layout.overlay.removeEventListener("keydown", this._onKeyDownBound);
  if (this.canvasHost && this._onWheelBound) this.canvasHost.removeEventListener("wheel", this._onWheelBound);
};

TextOverlayEditor.prototype._onCanvasWheel = function (e) {
  e.preventDefault();
  if (e.shiftKey) {
    const s = this.state; if (!s || !s.text) return;
    // Capture the bbox CENTER before the resize so we can re-pin the
    // center after. fontSize bumps grow/shrink bbox.w and .h; without
    // explicit re-anchoring the bbox grows down-right from x/y. Pinning
    // the center makes the text grow/shrink in place around the same
    // visual point on the canvas.
    const beforeBbox = this._textBbox(s);
    const centerX = beforeBbox.x + beforeBbox.w / 2;
    const centerY = beforeBbox.y + beforeBbox.h / 2;
    const step = e.altKey ? 10 : 5;
    const dir = e.deltaY > 0 ? -1 : 1;
    s.fontSize = Math.max(8, Math.min(512, (s.fontSize || 96) + dir * step));
    const afterBbox = this._textBbox(s);
    s.x = Math.round(centerX - afterBbox.w / 2);
    s.y = Math.round(centerY - afterBbox.h / 2);
    this._snapshotMaybe();
    this.editorPanel.setLayer(s);
    if (this.node._textOverlayBodyPanel) this.node._textOverlayBodyPanel.setLayer(s);
    this.requestRender();
    return;
  }
  const factor = Math.exp(-e.deltaY * 0.0015);
  this.zoomBy(factor);
};

TextOverlayEditor.prototype._canvasCoords = function (e) {
  const r = this.canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / this._zoom, y: (e.clientY - r.top) / this._zoom };
};

TextOverlayEditor.prototype._inverseRotate = function (px, py, cx, cy, rotDeg) {
  const rad = (-(rotDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return {
    x: (px - cx) * cos - (py - cy) * sin + cx,
    y: (px - cx) * sin + (py - cy) * cos + cy,
  };
};

TextOverlayEditor.prototype._hitTestText = function (px, py) {
  const s = this.state; if (!s || !s.text) return false;
  const b = this._textBbox(s);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const p = this._inverseRotate(px, py, cx, cy, s.rotation);
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
};

TextOverlayEditor.prototype._hitTestHandle = function (px, py) {
  const s = this.state; if (!s || !s.text) return null;
  const b = this._textBbox(s);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const p = this._inverseRotate(px, py, cx, cy, s.rotation);
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
  if (typeof this._focusOverlay === "function") this._focusOverlay();

  const p = this._canvasCoords(e);
  const handle = this._hitTestHandle(p.x, p.y);
  if (handle) {
    this._dragMode = handle === "rot" ? "rotate" : "scale";
    this._dragHandle = handle;
    this._dragOrigin = { x: p.x, y: p.y, state: { ...this.state } };
    this._snapshotMaybe();
    e.preventDefault();
    return;
  }
  if (this._hitTestText(p.x, p.y)) {
    this._dragMode = "move";
    this._dragOrigin = { x: p.x, y: p.y, state: { ...this.state } };
    this._snapshotMaybe();
    e.preventDefault();
  }
};

TextOverlayEditor.prototype._onCanvasMouseMove = function (e) {
  if (!this._dragMode) return;
  const p = this._canvasCoords(e);
  const s = this.state; if (!s) { this._dragMode = null; return; }
  const orig = this._dragOrigin.state;

  if (this._dragMode === "move") {
    s.x = orig.x + (p.x - this._dragOrigin.x);
    s.y = orig.y + (p.y - this._dragOrigin.y);
    if (!e.shiftKey) this._applySnap(s);
    else this._snapGuides = null;
  } else if (this._dragMode === "scale") {
    const origBox = this._textBbox(orig);
    const cx = origBox.x + origBox.w / 2;
    const cy = origBox.y + origBox.h / 2;
    const origDist = Math.hypot(this._dragOrigin.x - cx, this._dragOrigin.y - cy);
    const newDist = Math.hypot(p.x - cx, p.y - cy);
    const factor = Math.max(0.1, newDist / Math.max(1, origDist));
    s.fontSize = Math.max(8, Math.round(orig.fontSize * factor));
    if (e.altKey) {
      // Alt held: anchor the OPPOSITE corner — Photoshop-style stretch
      // from one corner toward / away from another. Useful when you
      // want one edge of the text to stay put.
      const newBox = this._textBbox(s);
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
      s.x = a.x - o.dx;
      s.y = a.y - o.dy;
    } else {
      // Default: anchor the bbox CENTER. Text grows / shrinks in place
      // around the same visual point. Matches the shift+wheel resize.
      const newBox = this._textBbox(s);
      s.x = Math.round(cx - newBox.w / 2);
      s.y = Math.round(cy - newBox.h / 2);
    }
  } else if (this._dragMode === "rotate") {
    const origBox = this._textBbox(orig);
    const cx = origBox.x + origBox.w / 2;
    const cy = origBox.y + origBox.h / 2;
    let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    s.rotation = Math.round(deg);
  }
  this.editorPanel.setLayer(s);
  if (this.node._textOverlayBodyPanel) this.node._textOverlayBodyPanel.setLayer(s);
  this.requestRender();
};

TextOverlayEditor.prototype._onCanvasMouseUp = function () {
  this._dragMode = null;
  this._snapGuides = null;
  this.requestRender();
};

TextOverlayEditor.prototype._applySnap = function (s) {
  const SNAP_PX = 8 / Math.max(0.0001, this._zoom);
  const bbox = this._textBbox(s);
  const cw = this.canvasWidth, ch = this.canvasHeight;
  const xTargets = [0, cw, cw / 2, cw / 3, cw * 2 / 3];
  const yTargets = [0, ch, ch / 2, ch / 3, ch * 2 / 3];
  const guides = [];
  let bestX = null;
  for (const t of xTargets) {
    for (const val of [s.x, s.x + bbox.w, s.x + bbox.w / 2]) {
      const d = Math.abs(val - t);
      if (d <= SNAP_PX && (!bestX || d < bestX.dist)) bestX = { dist: d, delta: t - val, at: t };
    }
  }
  let bestY = null;
  for (const t of yTargets) {
    for (const val of [s.y, s.y + bbox.h, s.y + bbox.h / 2]) {
      const d = Math.abs(val - t);
      if (d <= SNAP_PX && (!bestY || d < bestY.dist)) bestY = { dist: d, delta: t - val, at: t };
    }
  }
  if (bestX) { s.x += bestX.delta; guides.push({ axis: "v", at: bestX.at }); }
  if (bestY) { s.y += bestY.delta; guides.push({ axis: "h", at: bestY.at }); }
  this._snapGuides = guides.length ? guides : null;
};

TextOverlayEditor.prototype._onKeyDown = function (e) {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;

  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") {
    this.undo(); e.preventDefault(); e.stopImmediatePropagation(); return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && (e.key === "z" || e.key === "Z")))) {
    this.redo(); e.preventDefault(); e.stopImmediatePropagation(); return;
  }

  const s = this.state; if (!s) return;
  const step = e.shiftKey ? 10 : 1;
  if (e.key === "ArrowLeft")  { s.x -= step; this._snapshotMaybe(); this.editorPanel.setLayer(s); if (this.node._textOverlayBodyPanel) this.node._textOverlayBodyPanel.setLayer(s); this.requestRender(); e.preventDefault(); }
  else if (e.key === "ArrowRight") { s.x += step; this._snapshotMaybe(); this.editorPanel.setLayer(s); if (this.node._textOverlayBodyPanel) this.node._textOverlayBodyPanel.setLayer(s); this.requestRender(); e.preventDefault(); }
  else if (e.key === "ArrowUp")    { s.y -= step; this._snapshotMaybe(); this.editorPanel.setLayer(s); if (this.node._textOverlayBodyPanel) this.node._textOverlayBodyPanel.setLayer(s); this.requestRender(); e.preventDefault(); }
  else if (e.key === "ArrowDown")  { s.y += step; this._snapshotMaybe(); this.editorPanel.setLayer(s); if (this.node._textOverlayBodyPanel) this.node._textOverlayBodyPanel.setLayer(s); this.requestRender(); e.preventDefault(); }
  else if (e.key === "Delete" || e.key === "Backspace") {
    s.text = "";
    this._snapshotMaybe(); this.editorPanel.setLayer(s);
    if (this.node._textOverlayBodyPanel) this.node._textOverlayBodyPanel.setLayer(s);
    this.requestRender(); e.preventDefault();
  }
};

TextOverlayEditor.prototype._drawSelectionOverlay = function (ctx) {
  const pad = TextOverlayEditor.SEL_PAD;

  if (this._snapGuides && this._snapGuides.length) {
    ctx.save();
    ctx.translate(pad, pad);
    ctx.strokeStyle = "#f66744";
    ctx.lineWidth = 1 / this._zoom;
    ctx.setLineDash([4 / this._zoom, 4 / this._zoom]);
    for (const g of this._snapGuides) {
      ctx.beginPath();
      if (g.axis === "v") { ctx.moveTo(g.at, -pad); ctx.lineTo(g.at, this.canvasHeight + pad); }
      else                { ctx.moveTo(-pad, g.at); ctx.lineTo(this.canvasWidth + pad, g.at); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  const s = this.state; if (!s || !s.text) return;
  const b = this._textBbox(s);
  ctx.save();
  ctx.translate(pad, pad);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  ctx.translate(cx, cy);
  ctx.rotate(((s.rotation || 0) * Math.PI) / 180);
  ctx.translate(-cx, -cy);

  ctx.strokeStyle = "#f66744";
  ctx.lineWidth = 2 / this._zoom;
  ctx.setLineDash([6 / this._zoom, 4 / this._zoom]);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);

  const hs = HANDLE_SIZE / this._zoom;
  const corners = [
    { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
    { x: b.x, y: b.y + b.h }, { x: b.x + b.w, y: b.y + b.h },
  ];
  ctx.fillStyle = "#f66744";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1 / this._zoom;
  for (const p of corners) {
    ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
    ctx.strokeRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
  }

  const rh = { x: cx, y: b.y - ROT_HANDLE_OFFSET };
  ctx.strokeStyle = "#f66744";
  ctx.beginPath(); ctx.moveTo(cx, b.y); ctx.lineTo(rh.x, rh.y); ctx.stroke();
  ctx.beginPath(); ctx.arc(rh.x, rh.y, hs / 2, 0, Math.PI * 2);
  ctx.fillStyle = "#f66744"; ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.stroke();

  ctx.restore();
};
