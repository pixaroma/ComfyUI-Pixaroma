// ============================================================
// Pixaroma Paint Studio — Mouse/keyboard event binding & routing
// ============================================================
import { PaintStudio } from "./core.mjs";

const proto = PaintStudio.prototype;

// ─── Event binding ────────────────────────────────────────

proto._bindEvents = function () {
  const ws = this.el.workspace;
  // Prevent browser from intercepting pen/touch gestures
  ws.style.touchAction = "none";
  if (this.el.viewport) this.el.viewport.style.touchAction = "none";
  if (this.el.displayCanvas) this.el.displayCanvas.style.touchAction = "none";

  this._onPointerDown = (e) => {
    // Don't capture pointer if clicking inside help overlay or other UI panels
    if (e.target.closest(".pxf-help-overlay")) return;
    e.preventDefault();
    e.stopPropagation();
    // Blur any focused input so keyboard shortcuts work immediately
    if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "SELECT")
      document.activeElement.blur();
    // Safety: clear Alt-eyedropper if it got stuck (missed keyup)
    if (this._altDown && !e.altKey) {
      this._altDown = false;
      this._restoreToolCursor();
    }
    ws.setPointerCapture(e.pointerId);
    this._handleMouseDown(e);
  };
  this._onPointerMove = (e) => {
    // Use coalesced events for higher-resolution input (smoother fast strokes)
    if (this.isDrawing && e.getCoalescedEvents) {
      const coalesced = e.getCoalescedEvents();
      if (coalesced.length > 1) {
        for (const ce of coalesced) {
          this._handleMouseMove(ce);
        }
        return;
      }
    }
    this._handleMouseMove(e);
  };
  this._onPointerUp = (e) => {
    try { ws.releasePointerCapture(e.pointerId); } catch {}
    this._handleMouseUp(e);
  };
  this._onWheel = (e) => this._handleWheel(e);
  this._onKeyDown = (e) => this._handleKeyDown(e);
  this._onKeyUp = (e) => this._handleKeyUp(e);
  // Reset modifier states when window loses focus (e.g. Alt+Tab)
  this._onWindowBlur = () => {
    if (this._altDown) {
      this._altDown = false;
      this._restoreToolCursor();
    }
    this._spaceDown = false;
  };
  ws.addEventListener("pointerdown", this._onPointerDown);
  window.addEventListener("pointermove", this._onPointerMove);
  window.addEventListener("pointerup", this._onPointerUp);
  ws.addEventListener("wheel", this._onWheel, { passive: false });
  window.addEventListener("keydown", this._onKeyDown, { capture: true });
  window.addEventListener("keyup", this._onKeyUp, { capture: true });
  window.addEventListener("blur", this._onWindowBlur);
  this._bindColorCanvas();
};

proto._unbindEvents = function () {
  const ws = this.el.workspace;
  if (ws) {
    ws.removeEventListener("pointerdown", this._onPointerDown);
    ws.removeEventListener("wheel", this._onWheel);
  }
  window.removeEventListener("pointermove", this._onPointerMove);
  window.removeEventListener("pointerup", this._onPointerUp);
  window.removeEventListener("keydown", this._onKeyDown, { capture: true });
  window.removeEventListener("keyup", this._onKeyUp, { capture: true });
  if (this._onWindowBlur) window.removeEventListener("blur", this._onWindowBlur);
  if (this._onColorMove)
    window.removeEventListener("pointermove", this._onColorMove);
  if (this._onColorUp) window.removeEventListener("pointerup", this._onColorUp);
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
        if (ly.locked) {
          this._setStatus("Layer is locked");
          return;
        }
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
    this._lastCursorDoc = docPt;
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
  this._toolMouseMove(x, y, e);
};

proto._handleMouseUp = function (e) {
  this._altPicking = false;
  if (this.isPanning) {
    this.isPanning = false;
    this._restoreToolCursor();
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
  const key = e.key.toLowerCase();
  // Allow shortcuts even when an input is focused (blur it first to prevent typing)
  const alwaysAllow = ["alt", " ", "[", "]"];
  if (
    (ae?.tagName === "INPUT" ||
      ae?.tagName === "TEXTAREA" ||
      ae?.tagName === "SELECT") &&
    !ae?.dataset?.pixaromaTrap
  ) {
    if (alwaysAllow.includes(key)) {
      ae.blur();
    } else {
      return;
    }
  }
  if (key === " ") {
    e.preventDefault();
    this._spaceDown = true;
    if (this.el.workspace) this.el.workspace.style.cursor = "grab";
    return;
  }
  if (key === "alt") {
    e.preventDefault();
    if (["brush", "pencil", "eraser", "smudge"].includes(this.tool)) {
      this._altDown = true;
      const eyedropperSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 64 64'><path fill='white' stroke='black' stroke-width='2' d='M44.344,34.025l-8.3-8.371c-2.259-2.279-4.562-4.364-6.612-6.83-1.947-2.342-1.195-5.903,1.032-7.668,2.424-1.92,5.755-1.59,7.857.732.463-.189.666-.577.987-.896l7.088-7.039c2.095-2.08,5.11-2.749,8.081-2.168,4.555.891,7.864,5.37,7.496,9.833-.176,2.134-.749,4.229-2.278,5.781l-7.874,7.99c1.699,1.471,2.425,3.306,2.185,5.49-.27,2.459-2.329,4.584-4.806,4.814-1.869.174-3.496-.298-4.856-1.669Z'/><path fill='white' stroke='black' stroke-width='2' d='M33.173,38.938l5.163-5.211,3.029,2.982-17.675,18.008c-4.818,4.894-8.077,2.493-10.576,3.721-1.095.538-1.823,1.506-2.627,2.318-1.936,1.953-4.665,2.244-6.73.545-1.978-1.627-2.426-4.755-.633-6.755l1.307-1.458c.724-.807,1.527-1.67,1.585-2.829l.131-2.64c.115-2.306.807-4.496,2.469-6.181l16.783-17.013c.66-.669,1.124-1.33,1.969-1.874l2.856,3.12-17.271,17.482c-.761.769-1.543,1.502-1.976,2.479-1.358,3.064.972,5.329-2.818,9.838l-1.738,2.068c-.079.094.151.431.238.406l.526-.15c1.002-1.042,1.977-1.977,3.112-2.862,1.685-1.045,3.578-1.426,5.587-1.31,1.596.092,3.099-.296,4.267-1.48l13.023-13.204Z'/></svg>`;
      const pickCursor = `url("data:image/svg+xml,${encodeURIComponent(eyedropperSvg)}") 1 23, crosshair`;
      if (this.el.workspace) this.el.workspace.style.cursor = pickCursor;
      if (this.el.displayCanvas) this.el.displayCanvas.style.cursor = pickCursor;
    }
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
    this.engine._stampKey = "";
    this._syncBrushSizeUI();
  } else if (key === "]") {
    e.preventDefault();
    this.brush.size = Math.min(500, this.brush.size + (e.shiftKey ? 10 : 2));
    this.engine._stampKey = "";
    this._syncBrushSizeUI();
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
      this._restoreToolCursor();
    }
  }
  if (e.key === "Alt") {
    this._altDown = false;
    this._restoreToolCursor();
  }
};

proto._restoreToolCursor = function () {
  const overlayTools = ["brush", "pencil", "eraser", "smudge"];
  const fillSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 64 64'><path fill='white' stroke='black' stroke-width='2' d='M43.221,27.554c-4.543-3.009-8.089-6.117-11.744-10.108-1.217-1.329-2.28-2.705-3.211-4.226-.911-1.489-2.389-4.058-1.551-4.962.183-.197.724-.426,1.037-.388,3.849.471,8.306,3.402,11.345,5.864l3.066,2.484c.46.373.803.318,1.33.307l5.494-.119c-1.859-2.25-3.909-3.863-6.024-5.64-3.931-3.302-9.837-7.082-14.873-7.583-2.71-.27-4.751,1.047-6.328,3.104l-3.542,4.619c-1.168.301-2.363.137-3.554.273l-2.884.331-1.813.331c-2.473.452-4.89,1.28-6.869,2.823C.889,16.391-.067,19.241.795,21.957c.833,2.625,2.898,3.557,4.731,5.188l-3.572,4.466c-1.375,1.719-2.036,3.825-1.23,6.02.991,2.698,2.654,4.988,4.573,7.183,4.359,4.985,9.412,9.218,15.063,12.679,3.135,1.92,7.05,3.924,10.609,3.211,1.403-.281,2.441-1.346,3.312-2.455l11.797-14.905,2.122-2.908c.154-3.072.293-6.684-1.134-9.322-.875-1.617-2.368-2.581-3.847-3.561Z'/><path fill='white' stroke='black' stroke-width='2' d='M63.495,35.496c-.023-2.331-.919-4.339-1.938-6.371-1.034-2.062-2.612-3.701-4.433-5.16-2.129-1.706-4.693-2.594-7.391-3.082h-7.236l-.386.146c-.08.03-.06.257-.049.395l5.17,3.559c2.599,1.767,4.224,4.335,4.863,7.418.54,2.602.696,5.224.507,7.887v9.518c.134,2.406,1.568,4.419,3.665,5.124,2.368.797,4.634.056,6.179-1.869,1.083-1.35,1.195-2.985,1.178-4.727l-.129-12.837Z'/></svg>`;
  const fillCursor = `url("data:image/svg+xml,${encodeURIComponent(fillSvg)}") 2 20, crosshair`;
  const eyedropperSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 64 64'><path fill='white' stroke='black' stroke-width='2' d='M44.344,34.025l-8.3-8.371c-2.259-2.279-4.562-4.364-6.612-6.83-1.947-2.342-1.195-5.903,1.032-7.668,2.424-1.92,5.755-1.59,7.857.732.463-.189.666-.577.987-.896l7.088-7.039c2.095-2.08,5.11-2.749,8.081-2.168,4.555.891,7.864,5.37,7.496,9.833-.176,2.134-.749,4.229-2.278,5.781l-7.874,7.99c1.699,1.471,2.425,3.306,2.185,5.49-.27,2.459-2.329,4.584-4.806,4.814-1.869.174-3.496-.298-4.856-1.669Z'/><path fill='white' stroke='black' stroke-width='2' d='M33.173,38.938l5.163-5.211,3.029,2.982-17.675,18.008c-4.818,4.894-8.077,2.493-10.576,3.721-1.095.538-1.823,1.506-2.627,2.318-1.936,1.953-4.665,2.244-6.73.545-1.978-1.627-2.426-4.755-.633-6.755l1.307-1.458c.724-.807,1.527-1.67,1.585-2.829l.131-2.64c.115-2.306.807-4.496,2.469-6.181l16.783-17.013c.66-.669,1.124-1.33,1.969-1.874l2.856,3.12-17.271,17.482c-.761.769-1.543,1.502-1.976,2.479-1.358,3.064.972,5.329-2.818,9.838l-1.738,2.068c-.079.094.151.431.238.406l.526-.15c1.002-1.042,1.977-1.977,3.112-2.862,1.685-1.045,3.578-1.426,5.587-1.31,1.596.092,3.099-.296,4.267-1.48l13.023-13.204Z'/></svg>`;
  const pickCursor = `url("data:image/svg+xml,${encodeURIComponent(eyedropperSvg)}") 1 23, crosshair`;
  const cursorMap = {
    fill: fillCursor,
    pick: pickCursor,
    transform: "move",
    shape: "crosshair",
  };
  if (this.el.workspace) {
    this.el.workspace.style.cursor = cursorMap[this.tool] || "default";
  }
  if (this.el.displayCanvas) {
    this.el.displayCanvas.style.cursor = overlayTools.includes(this.tool)
      ? "none"
      : "";
  }
};
