// ============================================================
// Pixaroma Image Crop Editor — Interaction (mouse/keyboard events, handle dragging)
// ============================================================
import { CropEditor, SNAPS } from "./core.mjs";

const proto = CropEditor.prototype;

// --- Mouse ---
proto._bindMouse = function (cvs) {
  cvs.addEventListener("mousedown", (e) => this._onMouseDown(e));
  cvs.addEventListener("mousemove", (e) => this._onMouseMove(e));
  cvs.addEventListener("mouseup", () => this._onMouseUp());
  cvs.addEventListener("mouseleave", () => {
    this._drag = null;
    cvs.style.cursor = "crosshair";
  });
};

proto._canvasPos = function (e) {
  const r = this.el.canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

proto._onMouseDown = function (e) {
  if (!this.img) return;
  const pos = this._canvasPos(e),
    s = this._scale;
  const cx = this.cropX * s,
    cy = this.cropY * s,
    cw = this.cropW * s,
    ch = this.cropH * s;
  const handle = this._hitHandle(pos.x, pos.y, cx, cy, cw, ch);
  if (handle) {
    this._drag = {
      type: "handle",
      handle,
      startMx: pos.x,
      startMy: pos.y,
      startCrop: { x: this.cropX, y: this.cropY, w: this.cropW, h: this.cropH },
    };
    return;
  }
  if (pos.x >= cx && pos.x <= cx + cw && pos.y >= cy && pos.y <= cy + ch) {
    this._drag = {
      type: "move",
      startMx: pos.x,
      startMy: pos.y,
      startCrop: { x: this.cropX, y: this.cropY, w: this.cropW, h: this.cropH },
    };
    return;
  }
  this.cropX = Math.max(0, Math.min(pos.x / s, this.imgW));
  this.cropY = Math.max(0, Math.min(pos.y / s, this.imgH));
  this.cropW = 0;
  this.cropH = 0;
  this._drag = {
    type: "handle",
    handle: "br",
    startMx: pos.x,
    startMy: pos.y,
    startCrop: { x: this.cropX, y: this.cropY, w: 0, h: 0 },
  };
};

proto._onMouseMove = function (e) {
  if (!this.img) return;
  const pos = this._canvasPos(e),
    s = this._scale;
  if (this._drag) {
    const dx = (pos.x - this._drag.startMx) / s,
      dy = (pos.y - this._drag.startMy) / s;
    const sc = this._drag.startCrop;
    if (this._drag.type === "move") {
      this.cropX = Math.max(0, Math.min(sc.x + dx, this.imgW - sc.w));
      this.cropY = Math.max(0, Math.min(sc.y + dy, this.imgH - sc.h));
    } else {
      this._resizeByHandle(this._drag.handle, dx, dy, sc);
    }
    this._applyConstraints();
    this._draw();
    this._updateInfo();
    return;
  }
  const cx = this.cropX * s,
    cy = this.cropY * s,
    cw = this.cropW * s,
    ch = this.cropH * s;
  const handle = this._hitHandle(pos.x, pos.y, cx, cy, cw, ch);
  if (handle) this.el.canvas.style.cursor = this._handleCursor(handle);
  else if (pos.x >= cx && pos.x <= cx + cw && pos.y >= cy && pos.y <= cy + ch)
    this.el.canvas.style.cursor = "move";
  else this.el.canvas.style.cursor = "crosshair";
};

proto._onMouseUp = function () {
  if (!this._drag) return;
  if (this.cropW < 0) {
    this.cropX += this.cropW;
    this.cropW = -this.cropW;
  }
  if (this.cropH < 0) {
    this.cropY += this.cropH;
    this.cropH = -this.cropH;
  }
  if (this.cropW < 2 || this.cropH < 2) {
    this._drag = null;
    this._resetCrop();
    return;
  }
  const snap = SNAPS[this.snapIdx].val;
  const ratio = this._getActiveRatio();
  if (snap > 1 || ratio > 0) {
    const { w, h } = this._computeWH(this.cropW, ratio, snap);
    if (this._drag.handle) {
      const handle = this._drag.handle;
      if (handle.includes("l")) this.cropX = this.cropX + this.cropW - w;
      if (handle.includes("t")) this.cropY = this.cropY + this.cropH - h;
    }
    this.cropW = w;
    this.cropH = h;
  }
  this._applyConstraints();
  this._drag = null;
  this._draw();
  this._updateInfo();
};

proto._hitHandle = function (mx, my, cx, cy, cw, ch) {
  const handles = this._getHandlePositions(cx, cy, cw, ch);
  const cThr = 22,
    eThr = 16;
  for (const h of handles) {
    if (
      h.id.length === 2 &&
      Math.abs(mx - h.x) <= cThr &&
      Math.abs(my - h.y) <= cThr
    )
      return h.id;
  }
  for (const h of handles) {
    if (
      h.id.length === 1 &&
      Math.abs(mx - h.x) <= eThr &&
      Math.abs(my - h.y) <= eThr
    )
      return h.id;
  }
  const d = 8;
  if (my >= cy - d && my <= cy + ch + d) {
    if (Math.abs(mx - cx) <= d) return "l";
    if (Math.abs(mx - (cx + cw)) <= d) return "r";
  }
  if (mx >= cx - d && mx <= cx + cw + d) {
    if (Math.abs(my - cy) <= d) return "t";
    if (Math.abs(my - (cy + ch)) <= d) return "b";
  }
  return null;
};

proto._handleCursor = function (id) {
  return (
    {
      tl: "nwse-resize",
      br: "nwse-resize",
      tr: "nesw-resize",
      bl: "nesw-resize",
      t: "ns-resize",
      b: "ns-resize",
      l: "ew-resize",
      r: "ew-resize",
    }[id] || "default"
  );
};

proto._resizeByHandle = function (handle, dx, dy, sc) {
  const ratio = this._getActiveRatio();
  const snap = SNAPS[this.snapIdx].val;
  let nx = sc.x,
    ny = sc.y,
    nw = sc.w,
    nh = sc.h;
  const moveL = handle.includes("l"),
    moveR = handle.includes("r");
  const moveT = handle.includes("t"),
    moveB = handle.includes("b");
  if (moveL) {
    nx = sc.x + dx;
    nw = sc.w - dx;
  }
  if (moveR) {
    nw = sc.w + dx;
  }
  if (moveT) {
    ny = sc.y + dy;
    nh = sc.h - dy;
  }
  if (moveB) {
    nh = sc.h + dy;
  }

  if (snap > 1) {
    nw = this._snapVal(Math.abs(nw), snap) * (nw >= 0 ? 1 : -1);
    nh = this._snapVal(Math.abs(nh), snap) * (nh >= 0 ? 1 : -1);
    if (moveL) nx = sc.x + sc.w - Math.abs(nw);
    if (moveT) ny = sc.y + sc.h - Math.abs(nh);
  }

  if (ratio > 0 && handle.length === 2) {
    const absW = Math.abs(nw);
    let absH = snap > 1 ? this._snapVal(absW / ratio, snap) : absW / ratio;
    nh = nw >= 0 ? absH : -absH;
    if (moveT) ny = sc.y + sc.h - absH;
  }
  if (ratio > 0 && handle.length === 1) {
    if (moveL || moveR) {
      nh =
        snap > 1
          ? this._snapVal(Math.abs(nw) / ratio, snap)
          : Math.abs(nw) / ratio;
      ny = sc.y + (sc.h - nh) / 2;
    } else {
      nw =
        snap > 1
          ? this._snapVal(Math.abs(nh) * ratio, snap)
          : Math.abs(nh) * ratio;
      nx = sc.x + (sc.w - nw) / 2;
    }
  }

  if (nx < 0) {
    nw += nx;
    nx = 0;
  }
  if (ny < 0) {
    nh += ny;
    ny = 0;
  }
  if (nx + nw > this.imgW) nw = this.imgW - nx;
  if (ny + nh > this.imgH) nh = this.imgH - ny;
  this.cropX = nx;
  this.cropY = ny;
  this.cropW = nw;
  this.cropH = nh;
};

// --- Keyboard ---
proto._bindKeys = function () {
  this._keyHandler = (e) => {
    const ae = document.activeElement;
    if (
      (ae?.tagName === "INPUT" ||
        ae?.tagName === "TEXTAREA" ||
        ae?.tagName === "SELECT") &&
      !ae?.dataset?.pixaromaTrap
    )
      return;
    const key = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;

    if (key === "escape") {
      this._close();
      return;
    }
    if (key === "r" && !ctrl) {
      e.preventDefault();
      this._resetCrop();
      return;
    }
    if (key === "x" && !ctrl) {
      e.preventDefault();
      this._swapRatio();
      return;
    }
    if (key === "f" && !ctrl) {
      e.preventDefault();
      this.ratioIdx = 0;
      this._canvasSettings.setRatio(0);
      this._draw();
      this._updateInfo();
      return;
    }
    if (ctrl && key === "s") {
      e.preventDefault();
      this._save();
      return;
    }
  };
  window.addEventListener("keydown", this._keyHandler, { capture: true });
};

proto._unbindKeys = function () {
  if (this._keyHandler)
    window.removeEventListener("keydown", this._keyHandler, { capture: true });
};
