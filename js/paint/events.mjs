// ============================================================
// Pixaroma Paint Studio — Mouse/keyboard event binding & routing
// ============================================================
import { PaintStudio } from "./core.mjs";

const proto = PaintStudio.prototype;

// ─── Event binding ────────────────────────────────────────

proto._bindEvents = function () {
  const ws = this.el.workspace;
  this._onMouseDown = (e) => this._handleMouseDown(e);
  this._onMouseMove = (e) => this._handleMouseMove(e);
  this._onMouseUp = (e) => this._handleMouseUp(e);
  this._onWheel = (e) => this._handleWheel(e);
  this._onKeyDown = (e) => this._handleKeyDown(e);
  this._onKeyUp = (e) => this._handleKeyUp(e);
  ws.addEventListener("mousedown", this._onMouseDown);
  window.addEventListener("mousemove", this._onMouseMove);
  window.addEventListener("mouseup", this._onMouseUp);
  ws.addEventListener("wheel", this._onWheel, { passive: false });
  window.addEventListener("keydown", this._onKeyDown, { capture: true });
  window.addEventListener("keyup", this._onKeyUp, { capture: true });
  this._bindColorCanvas();
};

proto._unbindEvents = function () {
  const ws = this.el.workspace;
  if (ws) {
    ws.removeEventListener("mousedown", this._onMouseDown);
    ws.removeEventListener("wheel", this._onWheel);
  }
  window.removeEventListener("mousemove", this._onMouseMove);
  window.removeEventListener("mouseup", this._onMouseUp);
  window.removeEventListener("keydown", this._onKeyDown, { capture: true });
  window.removeEventListener("keyup", this._onKeyUp, { capture: true });
  if (this._onColorMove)
    window.removeEventListener("mousemove", this._onColorMove);
  if (this._onColorUp) window.removeEventListener("mouseup", this._onColorUp);
};

proto._handleMouseDown = function (e) {
  // Space+drag panning, middle-click panning, or Alt+drag when NOT on a brush tool
  const altForEyedrop =
    e.altKey && ["brush", "pencil", "eraser", "smudge"].includes(this.tool);
  if (
    e.button === 1 ||
    (e.button === 0 && this._spaceDown) ||
    (e.button === 0 && e.altKey && !altForEyedrop)
  ) {
    this.isPanning = true;
    this.panStart = { x: e.clientX - this.panX, y: e.clientY - this.panY };
    this.el.workspace.style.cursor = "grabbing";
    return;
  }
  if (e.button !== 0) return;
  // Click on workspace background (not canvas) = deselect
  if (
    e.target === this.el.workspace ||
    e.target.classList.contains("pxf-tool-info") ||
    e.target.classList.contains("pxf-drop-overlay")
  ) {
    this.selectedIndices.clear();
    if (this.layers.length > 0) {
      this.activeIdx = 0;
      this.selectedIndices.add(0);
    }
    this._updateLayersPanel();
    this._renderDisplay();
    return;
  }
  if (e.target !== this.el.displayCanvas) return;
  const { x, y } = this._screenToDoc(e.clientX, e.clientY);

  // Transform tool: check handles first, then click-to-select layer
  if (this.tool === "transform") {
    const ly = this.layers[this.activeIdx];
    if (ly) {
      const hit = this._hitTestHandle(x, y, ly);
      if (hit) {
        this._pushHistory();
        this.isDrawing = true;
        const t = ly.transform;
        if (hit.type === "move") {
          this._handleMode = "move";
          // Store all selected layers' positions for multi-move
          const allOrig = new Map();
          this.selectedIndices.forEach((idx) => {
            const sl = this.layers[idx];
            if (sl) allOrig.set(idx, { x: sl.transform.x, y: sl.transform.y });
          });
          if (!allOrig.has(this.activeIdx))
            allOrig.set(this.activeIdx, { x: t.x, y: t.y });
          this._handleDrag = {
            startX: x,
            startY: y,
            origX: t.x,
            origY: t.y,
            allOrig,
          };
        } else if (hit.type === "pivot") {
          this._handleMode = "pivot";
          this._handleDrag = {
            startX: x,
            startY: y,
            origPivX: t.pivotOffX || 0,
            origPivY: t.pivotOffY || 0,
            origX: t.x,
            origY: t.y,
          };
        } else if (hit.type === "scale") {
          this._handleMode = "scale";
          const dist = Math.hypot(
            hit.corner.x - hit.center.x,
            hit.corner.y - hit.center.y,
          );
          this._handleDrag = {
            center: hit.center,
            initDist: dist,
            origSX: t.scaleX,
            origSY: t.scaleY,
          };
        } else if (hit.type === "rotate") {
          this._handleMode = "rotate";
          const initAngle = Math.atan2(y - hit.center.y, x - hit.center.x);
          this._handleDrag = {
            center: hit.center,
            initAngle,
            origRot: t.rotation,
          };
        }
        return;
      }
    }
    // If multi-selected, check if click is inside any other selected layer for multi-move
    if (this.selectedIndices.size > 1) {
      for (const idx of this.selectedIndices) {
        const sl = this.layers[idx];
        if (!sl) continue;
        const corners = this._getLayerCorners(sl);
        if (this._pointInQuad(x, y, corners)) {
          this._pushHistory();
          this.isDrawing = true;
          this._handleMode = "move";
          const t = ly ? ly.transform : sl.transform;
          const allOrig = new Map();
          this.selectedIndices.forEach((si) => {
            const s = this.layers[si];
            if (s) allOrig.set(si, { x: s.transform.x, y: s.transform.y });
          });
          this._handleDrag = {
            startX: x,
            startY: y,
            origX: t.x,
            origY: t.y,
            allOrig,
          };
          return;
        }
      }
    }
    // Click outside handles: try to select topmost layer with pixel at this position
    for (let i = 0; i < this.layers.length; i++) {
      const l = this.layers[i];
      if (!l.visible) continue;
      try {
        // Inverse-transform click coords to raw canvas space for accurate hit detection
        const hasT = this._hasTransform(l);
        const cp = hasT ? this._docToLayerCanvas(l, x, y) : { x, y };
        const cx = Math.round(cp.x),
          cy = Math.round(cp.y);
        if (cx < 0 || cx >= this.docW || cy < 0 || cy >= this.docH) continue;
        const d = l.ctx.getImageData(cx, cy, 1, 1).data;
        if (d[3] > 8) {
          if (e.ctrlKey || e.metaKey) {
            // Ctrl+click: toggle in multi-selection
            if (this.selectedIndices.has(i)) {
              this.selectedIndices.delete(i);
              if (this.activeIdx === i)
                this.activeIdx =
                  this.selectedIndices.size > 0
                    ? [...this.selectedIndices][0]
                    : i;
            } else {
              this.selectedIndices.add(i);
            }
            this.activeIdx = i;
          } else {
            // Normal click: single select
            this.selectedIndices.clear();
            this.selectedIndices.add(i);
            this.activeIdx = i;
          }
          this._syncLayerProps();
          this._updateLayersPanel();
          this._autoSetPivot();
          this._setStatus(
            `Selected: ${l.name}${this.selectedIndices.size > 1 ? ` (+${this.selectedIndices.size - 1} more)` : ""}`,
          );
          this._renderDisplay();
          return;
        }
      } catch (e2) {}
    }
    return;
  }

  // Alt key → temporary eyedropper
  if (e.altKey && ["brush", "pencil", "eraser", "smudge"].includes(this.tool)) {
    this._altPicking = true;
    const color = this.engine.sampleColor(this.el.displayCanvas, x, y);
    this._setColorFromHex(color, false);
    this._setStatus(`Picked: ${color}`);
    return;
  }

  // Shift+click for line drawing (brush/pencil)
  if (
    e.shiftKey &&
    ["brush", "pencil"].includes(this.tool) &&
    this._lineStart
  ) {
    this._drawLineTo(x, y);
    this._lineStart = { x, y };
    return;
  }

  this._toolMouseDown(x, y, e);
};

proto._handleMouseMove = function (e) {
  // Always update cursor overlay
  if (this.el.displayCanvas) {
    const docPt = this._screenToDoc(e.clientX, e.clientY);
    this._updateCursorOverlay(docPt.x, docPt.y);
  }

  // Alt key live eyedropper while button held
  if (this._altPicking && this.isDrawing === false) {
    const { x, y } = this._screenToDoc(e.clientX, e.clientY);
    const color = this.engine.sampleColor(this.el.displayCanvas, x, y);
    this._setColorFromHex(color, true);
    return;
  }

  if (this.isPanning) {
    this.panX = e.clientX - this.panStart.x;
    this.panY = e.clientY - this.panStart.y;
    this._applyViewTransform();
    return;
  }

  // Transform handle drag
  if (this.isDrawing && this._handleMode && this._handleDrag) {
    const { x, y } = this._screenToDoc(e.clientX, e.clientY);
    const ly = this.layers[this.activeIdx];
    if (!ly) return;
    const d = this._handleDrag;

    if (this._handleMode === "move") {
      const mdx = x - d.startX,
        mdy = y - d.startY;
      // Move all selected layers together
      if (d.allOrig) {
        d.allOrig.forEach((orig, idx) => {
          const sl = this.layers[idx];
          if (sl) {
            sl.transform.x = orig.x + mdx;
            sl.transform.y = orig.y + mdy;
          }
        });
      } else {
        ly.transform.x = d.origX + mdx;
        ly.transform.y = d.origY + mdy;
      }
      this._setStatus(
        `X: ${Math.round(ly.transform.x)}  Y: ${Math.round(ly.transform.y)}`,
      );
    } else if (this._handleMode === "pivot") {
      const mdx = x - d.startX,
        mdy = y - d.startY;
      const rad = (ly.transform.rotation * Math.PI) / 180;
      const cr = Math.cos(rad),
        sr = Math.sin(rad);
      const sx = ly.transform.scaleX * (ly.transform.flipX ? -1 : 1);
      const sy = ly.transform.scaleY * (ly.transform.flipY ? -1 : 1);
      // Inverse-transform mouse delta so pivot follows cursor regardless of rotation/scale
      const dpx = (cr * mdx + sr * mdy) / sx;
      const dpy = (-sr * mdx + cr * mdy) / sy;
      ly.transform.pivotOffX = d.origPivX + dpx;
      ly.transform.pivotOffY = d.origPivY + dpy;
      // Compensate t.x/t.y so the image stays visually in place
      ly.transform.x = d.origX + dpx * (sx * cr - 1) - dpy * sy * sr;
      ly.transform.y = d.origY + dpx * sx * sr + dpy * (sy * cr - 1);
      this._setStatus(
        `Pivot: ${Math.round(ly.transform.pivotOffX)}, ${Math.round(ly.transform.pivotOffY)}`,
      );
    } else if (this._handleMode === "scale") {
      const newDist = Math.hypot(x - d.center.x, y - d.center.y);
      const ratio = d.initDist > 0 ? newDist / d.initDist : 1;
      ly.transform.scaleX = Math.max(0.01, d.origSX * ratio);
      ly.transform.scaleY = Math.max(0.01, d.origSY * ratio);
      this._setStatus(
        `Scale: ${ly.transform.scaleX.toFixed(2)} \u00d7 ${ly.transform.scaleY.toFixed(2)}`,
      );
    } else if (this._handleMode === "rotate") {
      const newAngle = Math.atan2(y - d.center.y, x - d.center.x);
      let angleDiff = ((newAngle - d.initAngle) * 180) / Math.PI;
      if (e.shiftKey) angleDiff = Math.round(angleDiff / 15) * 15;
      ly.transform.rotation = d.origRot + angleDiff;
      this._setStatus(`Rotation: ${Math.round(ly.transform.rotation)}\u00b0`);
    }
    this._syncTransformPanel();
    this._renderDisplay();
    return;
  }

  if (!this.isDrawing) return;
  const { x, y } = this._screenToDoc(e.clientX, e.clientY);
  this._toolMouseMove(x, y);
};

proto._handleMouseUp = function (e) {
  this._altPicking = false;
  if (this.isPanning) {
    this.isPanning = false;
    this.el.workspace.style.cursor = "";
  }
  if (this.isDrawing) {
    if (this._handleMode) {
      this._handleMode = null;
      this._handleDrag = null;
      this.isDrawing = false;
      this._contentBoundsCache.delete(this.layers[this.activeIdx]?.id);
      this._syncTransformPanel();
      this._updateTransformWarn();
      this._renderDisplay();
      return;
    }
    const { x, y } = this._screenToDoc(e.clientX, e.clientY);
    this._toolMouseUp(x, y);
  }
};

proto._handleWheel = function (e) {
  e.preventDefault();
  // Unified zoom: scroll = zoom in/out, centered (like Composer)
  const ws = this.el.workspace;
  if (!ws) return;
  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  const oldZ = this.zoom;
  this.zoom = Math.max(0.05, Math.min(8, this.zoom * factor));
  // Adjust pan to keep canvas centered during zoom
  const wsW = ws.clientWidth,
    wsH = ws.clientHeight;
  const cx = wsW / 2,
    cy = wsH / 2;
  this.panX = cx - (cx - this.panX) * (this.zoom / oldZ);
  this.panY = cy - (cy - this.panY) * (this.zoom / oldZ);
  this._applyViewTransform();
};

proto._handleKeyDown = function (e) {
  const ae = document.activeElement;
  if (
    (ae?.tagName === "INPUT" ||
      ae?.tagName === "TEXTAREA" ||
      ae?.tagName === "SELECT") &&
    !ae?.dataset?.pixaromaTrap
  )
    return;
  const key = e.key.toLowerCase();
  if (key === " ") {
    e.preventDefault();
    this._spaceDown = true;
    if (this.el.workspace) this.el.workspace.style.cursor = "grab";
    return;
  }
  const handled = e.ctrlKey
    ? ["z", "y", "d", "s", "a"].includes(key)
    : [
        "b",
        "p",
        "e",
        "g",
        "i",
        "r",
        "v",
        "t",
        "u",
        "x",
        "d",
        "[",
        "]",
        "delete",
        "enter",
        "escape",
        "?",
      ].includes(key);
  if (handled) e.preventDefault();
  if (e.ctrlKey) {
    if (key === "z") {
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (key === "y") {
      this.redo();
      return;
    }
    if (key === "d") {
      this._duplicateLayer();
      return;
    }
    if (key === "s") {
      this._save();
      return;
    }
    if (key === "a") {
      this.selectedIndices.clear();
      this.layers.forEach((_, idx) => this.selectedIndices.add(idx));
      this._updateLayersPanel();
      this._renderDisplay();
      this._setStatus(`Selected all ${this.layers.length} layers`);
      return;
    }
  }
  if (key === "b") this._setTool("brush");
  else if (key === "p") this._setTool("pencil");
  else if (key === "e") this._setTool("eraser");
  else if (key === "g") this._setTool("fill");
  else if (key === "i") this._setTool("pick");
  else if (key === "r") this._setTool("smudge");
  else if (key === "v")
    this._setTool("transform"); // Photoshop: V = move/transform
  else if (key === "t")
    this._setTool("transform"); // keep T as alias
  else if (key === "u")
    this._setTool("shape"); // U = shape tool
  else if (key === "enter") {
    if (this.tool === "transform") this._applyLayerTransform();
  } else if (key === "escape") {
    if (this.tool === "transform") {
      const ly = this.layers[this.activeIdx];
      if (ly) {
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
        this._syncTransformPanel();
        this._updateTransformWarn();
        this._renderDisplay();
      }
    }
  } else if (key === "x") this._swapColors();
  else if (key === "d") {
    this.fgColor = "#000000";
    this.bgColor2 = "#ffffff";
    this.colorMode = "fg";
    this._updateColorUI();
  } else if (key === "[") {
    e.preventDefault();
    this.brush.size = Math.max(1, this.brush.size - (e.shiftKey ? 10 : 2));
    this._updateToolOptions();
  } else if (key === "]") {
    e.preventDefault();
    this.brush.size = Math.min(500, this.brush.size + (e.shiftKey ? 10 : 2));
    this._updateToolOptions();
  } else if (key === "delete") {
    // If multiple layers selected, delete them; otherwise clear active layer pixels
    if (this.selectedIndices.size > 1) this._deleteLayer();
    else this._clearLayer();
  } else if (key === "?") this._toggleHelp();
};

proto._handleKeyUp = function (e) {
  if (e.key === " ") {
    this._spaceDown = false;
    if (!this.isPanning && this.el.workspace) {
      const noCursor = ["brush", "pencil", "eraser", "smudge"];
      const cursorMap = {
        fill: "copy",
        pick: "none",
        transform: "move",
        shape: "crosshair",
      };
      const cur = noCursor.includes(this.tool)
        ? "none"
        : cursorMap[this.tool] || "crosshair";
      this.el.workspace.style.cursor = cur;
    }
  }
};
