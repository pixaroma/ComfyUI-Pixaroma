// ============================================================
// Pixaroma Paint Studio — Color panel, tool options bar, layer panel sync,
//   document properties, cursor overlay, save, BG color popup
// ============================================================
import {
  PaintStudio,
  PaintAPI,
  hexToRgb,
  rgbToHex,
  rgbToHsv,
  hsvToRgb,
  rgbToHsl,
  hslToRgb,
  createLayerItem,
  createDivider,
} from "./core.mjs";

const proto = PaintStudio.prototype;

// ─── Color UI ─────────────────────────────────────────────

proto._bindColorCanvas = function () {
  this._drawSVGradient();
  this._drawHueBar();
  let dragSV = false,
    dragH = false;
  this.el.svCvs.addEventListener("pointerdown", (e) => {
    dragSV = true;
    this._pickSV(e);
  });
  this.el.hCvs.addEventListener("pointerdown", (e) => {
    dragH = true;
    this._pickHue(e);
  });
  this._onColorMove = (e) => {
    if (dragSV) this._pickSV(e);
    if (dragH) this._pickHue(e);
  };
  this._onColorUp = () => {
    dragSV = false;
    dragH = false;
  };
  window.addEventListener("pointermove", this._onColorMove);
  window.addEventListener("pointerup", this._onColorUp);
};

proto._drawSVGradient = function () {
  const cvs = this.el.svCvs;
  const ctx = cvs.getContext("2d");
  const w = cvs.width,
    h = cvs.height;
  const hColor = this._hsvStr(this.hsv.h, 1, 1);
  const gH = ctx.createLinearGradient(0, 0, w, 0);
  gH.addColorStop(0, "#fff");
  gH.addColorStop(1, hColor);
  ctx.fillStyle = gH;
  ctx.fillRect(0, 0, w, h);
  const gV = ctx.createLinearGradient(0, 0, 0, h);
  gV.addColorStop(0, "rgba(0,0,0,0)");
  gV.addColorStop(1, "#000");
  ctx.fillStyle = gV;
  ctx.fillRect(0, 0, w, h);
  const cx = this.hsv.s * w,
    cy = (1 - this.hsv.v) * h;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.stroke();
};

proto._drawHueBar = function () {
  const cvs = this.el.hCvs;
  const ctx = cvs.getContext("2d");
  const w = cvs.width,
    h = cvs.height;
  const g = ctx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 360; i += 30)
    g.addColorStop(i / 360, `hsl(${i},100%,50%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const cx = (this.hsv.h / 360) * w;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cx - 3, 1, 6, h - 2);
};

proto._hsvStr = function (h, s, v) {
  const { r, g, b } = hsvToRgb(h, s, v);
  return `rgb(${r},${g},${b})`;
};

proto._pickSV = function (e) {
  const rect = this.el.svCvs.getBoundingClientRect();
  this.hsv.s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  this.hsv.v = Math.max(
    0,
    Math.min(1, 1 - (e.clientY - rect.top) / rect.height),
  );
  this._applyHSV();
};

proto._pickHue = function (e) {
  const rect = this.el.hCvs.getBoundingClientRect();
  this.hsv.h = Math.max(
    0,
    Math.min(360, ((e.clientX - rect.left) / rect.width) * 360),
  );
  this._applyHSV();
};

proto._applyHSV = function () {
  const { r, g, b } = hsvToRgb(this.hsv.h, this.hsv.s, this.hsv.v);
  const hex = rgbToHex(r, g, b);
  if (this.colorMode === "fg") this.fgColor = hex;
  else this.bgColor2 = hex;
  this._updateColorUI(true);
};

proto._setColorFromHex = function (hex, noHsvUpdate) {
  if (this.colorMode === "fg") this.fgColor = hex;
  else this.bgColor2 = hex;
  if (!noHsvUpdate) {
    const { r, g, b } = hexToRgb(hex);
    this.hsv = rgbToHsv(r, g, b);
  }
  this._updateColorUI();
  this._addToSwatchHistory(hex);
};

proto._applyHSLAdjust = function () {
  if (!this._hslBaseColor) return;
  const { r, g, b } = hexToRgb(this._hslBaseColor);
  let { h, s, l } = rgbToHsl(r, g, b);
  const dh = parseFloat(this.el.hsl_h?.slider.value || 0);
  const ds = parseFloat(this.el.hsl_s?.slider.value || 0);
  const dl = parseFloat(this.el.hsl_l?.slider.value || 0);
  h = (h + dh + 360) % 360;
  s = Math.max(0, Math.min(1, s + ds / 100));
  l = Math.max(0, Math.min(1, l + dl / 100));
  const { r: nr, g: ng, b: nb } = hslToRgb(h, s, l);
  const newHex = rgbToHex(nr, ng, nb);
  if (this.colorMode === "fg") this.fgColor = newHex;
  else this.bgColor2 = newHex;
  const { r: r2, g: g2, b: b2 } = hexToRgb(newHex);
  this.hsv = rgbToHsv(r2, g2, b2);
  this._updateColorUI(true);
};

proto._updateColorUI = function (preserveHSV) {
  const hex = this.colorMode === "fg" ? this.fgColor : this.bgColor2;
  if (this.el.fgSwatch) this.el.fgSwatch.style.background = this.fgColor;
  if (this.el.bgSwatch) this.el.bgSwatch.style.background = this.bgColor2;
  if (this.el.fgSwatch)
    this.el.fgSwatch.style.borderColor =
      this.colorMode === "fg" ? "#f66744" : "#555";
  if (this.el.bgSwatch)
    this.el.bgSwatch.style.borderColor =
      this.colorMode === "bg" ? "#f66744" : "#555";
  if (this.el.hexInput) this.el.hexInput.value = hex.slice(1).toUpperCase();
  if (!preserveHSV) {
    const { r, g, b } = hexToRgb(hex);
    this.hsv = rgbToHsv(r, g, b);
    // Reset HSL sliders when color changes from a non-HSL source
    this._hslBaseColor = hex;
    if (this.el.hsl_h) { this.el.hsl_h.slider.value = 0; this.el.hsl_h.num.value = 0; }
    if (this.el.hsl_s) { this.el.hsl_s.slider.value = 0; this.el.hsl_s.num.value = 0; }
    if (this.el.hsl_l) { this.el.hsl_l.slider.value = 0; this.el.hsl_l.num.value = 0; }
  }
  this._drawSVGradient();
  this._drawHueBar();
};

proto._swapColors = function () {
  [this.fgColor, this.bgColor2] = [this.bgColor2, this.fgColor];
  this._updateColorUI();
};

proto._initDefaultSwatches = function () {
  // Recent swatches start empty — they fill as the user picks colors
};

proto._addToSwatchHistory = function (hex) {
  if (!hex || this.swatchHistory[0] === hex) return;
  this.swatchHistory = [
    hex,
    ...this.swatchHistory.filter((c) => c !== hex),
  ].slice(0, 8);
  const swatches = this.el.swatchGrid?.children;
  if (!swatches) return;
  this.swatchHistory.forEach((c, i) => {
    if (swatches[i]) {
      swatches[i].style.background = c;
      swatches[i].dataset.color = c;
    }
  });
};

// ─── BG color picker popup ────────────────────────────────

proto._showBgColorPicker = function (e, anchor) {
  document.querySelector(".ppx-color-popup")?.remove();
  const rect = anchor.getBoundingClientRect();
  const popup = document.createElement("div");
  popup.className = "ppx-color-popup";
  let top = rect.bottom + 6;
  let left = rect.left;
  if (top + 120 > window.innerHeight) top = rect.top - 120;
  if (left + 160 > window.innerWidth) left = window.innerWidth - 166;
  popup.style.cssText = `position:fixed;top:${top}px;left:${left}px;z-index:20000;background:#1a1c1d;border:1px solid #f66744;border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:6px;box-shadow:0 8px 24px rgba(0,0,0,.7);min-width:150px;`;

  const inp = document.createElement("input");
  inp.type = "color";
  inp.value = this.bgColor;
  inp.style.cssText =
    "width:100%;height:28px;cursor:pointer;border:none;background:none;";
  inp.addEventListener("input", () => {
    this.bgColor = inp.value;
    anchor.style.background = inp.value;
    hexInp.value = inp.value.slice(1).toUpperCase();
    this._renderDisplay();
  });

  const hexRow2 = document.createElement("div");
  hexRow2.style.cssText = "display:flex;align-items:center;gap:4px;";
  const hLbl = document.createElement("span");
  hLbl.textContent = "#";
  hLbl.style.color = "#888";
  const hexInp = document.createElement("input");
  hexInp.type = "text";
  hexInp.maxLength = 6;
  hexInp.value = this.bgColor.slice(1).toUpperCase();
  hexInp.style.cssText =
    "flex:1;background:#111;color:#e0e0e0;border:1px solid #444;border-radius:3px;padding:2px 4px;font-family:monospace;font-size:11px;";
  hexInp.addEventListener("change", () => {
    const v =
      "#" +
      hexInp.value
        .replace(/[^0-9a-fA-F]/g, "")
        .padEnd(6, "0")
        .slice(0, 6);
    this.bgColor = v;
    inp.value = v;
    anchor.style.background = v;
    this._renderDisplay();
  });
  hexRow2.append(hLbl, hexInp);

  const closeP = this._mkBtn("\u2715 Close", () => popup.remove(), "ppx-btn");
  closeP.style.fontSize = "10px";
  popup.append(inp, hexRow2, closeP);
  document.body.appendChild(popup);

  setTimeout(() => {
    const handler = (ev) => {
      if (!popup.contains(ev.target) && ev.target !== anchor) {
        popup.remove();
        document.removeEventListener("click", handler);
      }
    };
    document.addEventListener("click", handler);
  }, 100);
};

// ─── Tool options bar ─────────────────────────────────────

proto._setTool = function (tool) {
  const prevTool = this.tool;

  // Save current brush settings to per-tool storage
  const brushTools = ["brush", "pencil", "eraser", "smudge"];
  if (brushTools.includes(prevTool) && this._toolSettings) {
    this._toolSettings[prevTool] = { ...this.brush };
    if (prevTool === "smudge")
      this._toolSettings.smudge.strength = this.smudgeStrength || 50;
  }

  this.tool = tool;

  // Restore per-tool brush settings
  if (brushTools.includes(tool) && this._toolSettings?.[tool]) {
    this.brush = { ...this._toolSettings[tool] };
    if (tool === "smudge")
      this.smudgeStrength = this._toolSettings.smudge.strength || 50;
    this.engine._stampKey = "";
  }

  Object.keys(this.el)
    .filter((k) => k.startsWith("toolBtn_"))
    .forEach((k) => {
      this.el[k].classList.toggle("active", k === `toolBtn_${tool}`);
    });

  // Cursor style per tool
  // Drawing tools hide OS cursor on the canvas only (custom overlay drawn instead)
  // Workspace always shows a cursor so it doesn't disappear outside the canvas
  // Tools that draw their own cursor overlay on the canvas — hide OS cursor there
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
    this.el.workspace.style.cursor = cursorMap[tool] || "default";
  }
  if (this.el.displayCanvas) {
    this.el.displayCanvas.style.cursor = overlayTools.includes(tool)
      ? "none"
      : "";
  }
  // Transform panel always visible (no toggle needed)

  // Auto-apply transform when switching to any drawing tool
  const drawingTools = ["brush", "pencil", "eraser", "smudge", "fill", "shape"];
  if (drawingTools.includes(tool) && tool !== prevTool) {
    const ly = this.layers[this.activeIdx];
    if (ly && this._hasTransform(ly)) {
      this._applyLayerTransform();
    }
  }

  // Clear overlay canvas when leaving transform (handles are drawn there)
  if (prevTool === "transform" && tool !== "transform" && this.el.overlayCvs) {
    this.el.overlayCvs.getContext("2d").clearRect(0, 0, this.el.overlayCvs.width, this.el.overlayCvs.height);
  }

  // When entering transform mode, auto-set pivot to content center
  if (tool === "transform" && prevTool !== "transform") {
    this._autoSetPivot();
    this._updateTransformWarn();
  }

  this._updateToolOptions();
  this._renderDisplay();
};

proto._autoSetPivot = function () {
  const ly = this.layers[this.activeIdx];
  if (!ly) return;
  const t = ly.transform;
  // Only auto-set if no transform is currently active (avoid disrupting existing transforms)
  if (
    t.scaleX === 1 &&
    t.scaleY === 1 &&
    t.rotation === 0 &&
    !t.flipX &&
    !t.flipY
  ) {
    const b = this._getContentBounds(ly);
    if (b.w > 1 && b.h > 1) {
      t.pivotOffX = b.x + b.w / 2 - this.docW / 2;
      t.pivotOffY = b.y + b.h / 2 - this.docH / 2;
    }
  }
};

proto._hasTransform = function (ly) {
  const t = ly.transform;
  return !!(
    t.x ||
    t.y ||
    t.scaleX !== 1 ||
    t.scaleY !== 1 ||
    t.rotation ||
    t.flipX ||
    t.flipY
  );
};

proto._updateTransformWarn = function () {
  const ly = this.layers[this.activeIdx];
  const pending = ly && this._hasTransform(ly);
  if (this.el.transformWarn)
    this.el.transformWarn.style.display = pending ? "block" : "none";
};

proto._syncBrushSizeUI = function () {
  const v = this.brush.size;
  if (this.el._sizeRange) {
    this.el._sizeRange.value = v;
    if (window._pxfUpdateFill) window._pxfUpdateFill(this.el._sizeRange);
  }
  if (this.el._sizeNum) this.el._sizeNum.value = v;
  // Immediately redraw cursor circle at last known position
  if (this._lastCursorDoc) {
    this._updateCursorOverlay(this._lastCursorDoc.x, this._lastCursorDoc.y);
  }
  this._setStatus(`Size: ${v}`);
};

proto._updateToolOptions = function () {
  const bar = this.el.topOpts;
  if (!bar) return;
  bar.innerHTML = "";

  // After rebuilding, refresh slider fills (deferred to next frame so DOM is ready)
  requestAnimationFrame(() => {
    bar.querySelectorAll("input[type=range]").forEach((s) => {
      if (window._pxfUpdateFill) window._pxfUpdateFill(s);
    });
  });

  const add = (label, el) => {
    const lbl = document.createElement("label");
    lbl.textContent = label;
    bar.appendChild(lbl);
    bar.appendChild(el);
  };

  const mkRange = (min, max, val, cb) => {
    const inp = document.createElement("input");
    inp.type = "range";
    inp.min = min;
    inp.max = max;
    inp.value = val;
    inp.style.cssText = "width:100px;max-width:100px;flex:0 0 auto;";
    const numEl = document.createElement("input");
    numEl.type = "number";
    numEl.min = min;
    numEl.max = max;
    numEl.value = val;
    inp.addEventListener("input", () => {
      numEl.value = inp.value;
      cb(+inp.value);
    });
    numEl.addEventListener("change", () => {
      const v = Math.max(min, Math.min(max, +numEl.value));
      inp.value = v;
      numEl.value = v;
      cb(v);
    });
    return { range: inp, num: numEl };
  };

  const sep = () => {
    const d = document.createElement("div");
    d.className = "ppx-sep";
    bar.appendChild(d);
  };

  if (
    this.tool === "brush" ||
    this.tool === "pencil" ||
    this.tool === "eraser" ||
    this.tool === "smudge"
  ) {
    const UI = "/pixaroma/assets/icons/ui/";

    // Helper: create an SVG icon button (white when inactive, white-on-orange when active)
    const mkIconBtn = (svgName, title, active, extraClass) => {
      const btn = document.createElement("div");
      btn.className = "ppx-shape-btn " + (extraClass || "") + (active ? " active" : "");
      btn.title = title;
      btn.style.cssText += "padding:3px;user-select:none;";
      const img = document.createElement("img");
      img.src = UI + svgName;
      img.style.cssText = "width:100%;height:100%;filter:invert(1);";
      btn.appendChild(img);
      return btn;
    };

    // ── Brush shapes (left) ──
    if (this.tool === "brush" || this.tool === "pencil") {
      const SHAPES = [
        { id: "round", svg: "round.svg" },
        { id: "square", svg: "square.svg" },
        { id: "triangle", svg: "triangle.svg" },
        { id: "diamond", svg: "diamond.svg" },
        { id: "star", svg: "star.svg" },
        { id: "flat", svg: "flat.svg" },
      ];
      SHAPES.forEach((sh) => {
        const btn = mkIconBtn(sh.svg, sh.id, this.brush.shape === sh.id, "ppx-brush-shape");
        btn.addEventListener("click", () => {
          this.brush.shape = sh.id;
          this.engine._stampKey = "";
          bar.querySelectorAll(".ppx-brush-shape").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
        });
        bar.appendChild(btn);
      });
    }

    // ── Pen pressure toggles ──
    if (["brush", "pencil", "eraser"].includes(this.tool)) {
      sep();
      const mkPenToggle = (svgName, title, active, onToggle) => {
        const btn = mkIconBtn(svgName, title, active, "ppx-pen-toggle");
        btn.addEventListener("click", () => {
          const newVal = !btn.classList.contains("active");
          btn.classList.toggle("active", newVal);
          onToggle(newVal);
        });
        return btn;
      };
      bar.appendChild(mkPenToggle("pen-size.svg", "Pen pressure \u2192 Size", this.pressureSize, (v) => { this.pressureSize = v; }));
      bar.appendChild(mkPenToggle("pen-opacity.svg", "Pen pressure \u2192 Opacity", this.pressureOpacity, (v) => { this.pressureOpacity = v; }));
    }

    // ── Reset button ──
    sep();
    const resetBtn = document.createElement("button");
    resetBtn.className = "pxf-btn-sm";
    resetBtn.title = "Reset brush to defaults";
    resetBtn.textContent = "\u21ba";
    resetBtn.style.cssText = "width:24px;height:22px;font-size:13px;flex-shrink:0;";
    resetBtn.addEventListener("click", () => {
      const defaults = {
        brush: { size: 20, opacity: 100, flow: 80, hardness: 80, shape: "round", angle: 0, spacing: 10, scatter: 0 },
        pencil: { size: 4, opacity: 100, flow: 100, hardness: 100, shape: "square", angle: 0, spacing: 5, scatter: 0 },
        eraser: { size: 30, opacity: 100, flow: 100, hardness: 80, shape: "round", angle: 0, spacing: 10, scatter: 0 },
        smudge: { size: 20, opacity: 100, flow: 50, hardness: 80, shape: "round", angle: 0, spacing: 10, scatter: 0 },
      };
      this.brush = { ...(defaults[this.tool] || defaults.brush) };
      if (this.tool === "smudge") this.smudgeStrength = 50;
      this.engine._stampKey = "";
      this._updateToolOptions();
    });
    bar.appendChild(resetBtn);
    sep();

    // ── Sliders ──
    const sz = mkRange(1, 500, this.brush.size, (v) => {
      this.brush.size = v;
      this.engine._stampKey = "";
    });
    this.el._sizeRange = sz.range;
    this.el._sizeNum = sz.num;
    add("Size", sz.range);
    bar.appendChild(sz.num);
    if (this.tool !== "smudge") {
      const op = mkRange(0, 100, this.brush.opacity, (v) => (this.brush.opacity = v));
      add("Opacity%", op.range);
      bar.appendChild(op.num);
      const fl = mkRange(0, 100, this.brush.flow, (v) => (this.brush.flow = v));
      add("Flow%", fl.range);
      bar.appendChild(fl.num);
      const hd = mkRange(0, 100, this.brush.hardness, (v) => {
        this.brush.hardness = v;
        this.engine._stampKey = "";
      });
      add("Hardness%", hd.range);
      bar.appendChild(hd.num);
    }

    if (this.tool === "brush" || this.tool === "pencil") {
      const sp = mkRange(1, 200, this.brush.spacing, (v) => (this.brush.spacing = v));
      add("Spacing%", sp.range);
      bar.appendChild(sp.num);
      const sc = mkRange(0, 100, this.brush.scatter, (v) => (this.brush.scatter = v));
      add("Scatter", sc.range);
      bar.appendChild(sc.num);
      // Angle is handcrafted (signed -180..180 range + bidirectional
      // link between slider and number input) so it can't use mkRange.
      // But the style MUST match the mkRange sliders' inline flex
      // declaration — otherwise Chrome grows the angle slider to
      // consume the remaining flex space, making it visibly much
      // longer than Size / Opacity / Spacing / Scatter / etc.
      const angSlide = document.createElement("input");
      angSlide.type = "range";
      angSlide.min = -180;
      angSlide.max = 180;
      angSlide.value = this.brush.angle;
      angSlide.style.cssText = "width:100px;max-width:100px;flex:0 0 auto;cursor:pointer;";
      const angN = document.createElement("input");
      angN.type = "number";
      angN.min = -180;
      angN.max = 180;
      angN.value = this.brush.angle;
      const angUpdate = (v) => {
        this.brush.angle = +v;
        angSlide.value = v;
        angN.value = v;
        this.engine._stampKey = "";
      };
      angSlide.addEventListener("input", () => angUpdate(angSlide.value));
      angN.addEventListener("change", () => angUpdate(angN.value));
      add("Angle\u00b0", angSlide);
      bar.appendChild(angN);
    }
  }

  if (this.tool === "smudge") {
    sep();
    const st = mkRange(
      1,
      100,
      this.smudgeStrength || 50,
      (v) => (this.smudgeStrength = v),
    );
    add("Strength%", st.range);
    bar.appendChild(st.num);
  }

  if (this.tool === "fill") {
    const tl = mkRange(0, 255, this.fillTol, (v) => (this.fillTol = v));
    add("Tolerance", tl.range);
    bar.appendChild(tl.num);
  }

  if (this.tool === "pick") {
    const lbl = document.createElement("label");
    lbl.style.color = "#f66744";
    lbl.textContent =
      "Click or drag to sample color  \u00b7  Alt+click picks to background color";
    bar.appendChild(lbl);
  }

  if (this.tool === "transform") {
    sep();
    const lbl = document.createElement("label");
    lbl.style.cssText = "color:#aaa;font-size:10px;";
    lbl.textContent =
      "Drag=Move  \u00b7  Corner=Scale  \u00b7  Top circle=Rotate  \u00b7  Shift=15\u00b0 snap  \u00b7  Esc=Reset";
    bar.appendChild(lbl);
  }

  if (this.tool === "shape") {
    const shapeBtns = [
      { id: "rect", sym: "\u25ad", label: "Rectangle" },
      { id: "ellipse", sym: "\u25ef", label: "Ellipse/Circle" },
      { id: "triangle", sym: "\u25b3", label: "Triangle" },
      { id: "poly", sym: "\u2b21", label: "Polygon (3-12 sides)" },
      { id: "line", sym: "\u2571", label: "Line" },
    ];
    let activeShapeBtn = null;
    shapeBtns.forEach((s) => {
      const btn = document.createElement("div");
      btn.className =
        "ppx-shape-btn" + (this._shapeTool === s.id ? " active" : "");
      btn.title = s.label;
      btn.textContent = s.sym;
      if (this._shapeTool === s.id) activeShapeBtn = btn;
      btn.addEventListener("click", () => {
        this._shapeTool = s.id;
        bar
          .querySelectorAll(".ppx-shape-btn")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        updateShapeOptions();
      });
      bar.appendChild(btn);
    });
    sep();

    // Fill/Stroke toggle (not shown for Line)
    const fillStrokeArea = document.createElement("span");
    fillStrokeArea.style.cssText = "display:flex;align-items:center;gap:4px;";
    bar.appendChild(fillStrokeArea);

    // Polygon sides slider (shown only for poly)
    const polyArea = document.createElement("span");
    polyArea.style.cssText = "display:flex;align-items:center;gap:4px;";
    bar.appendChild(polyArea);

    // Stroke width (shown when not fill or for line)
    const strokeArea = document.createElement("span");
    strokeArea.style.cssText = "display:flex;align-items:center;gap:4px;";
    bar.appendChild(strokeArea);

    const updateShapeOptions = () => {
      fillStrokeArea.innerHTML = "";
      polyArea.innerHTML = "";
      strokeArea.innerHTML = "";

      if (this._shapeTool !== "line") {
        // Fill/Stroke toggle button
        const fillBtn = document.createElement("div");
        fillBtn.className = "ppx-shape-btn" + (this.shapeFill ? " active" : "");
        fillBtn.textContent = "\u25cf Fill";
        fillBtn.style.cssText = "width:48px;font-size:10px;";
        const strokeBtn = document.createElement("div");
        strokeBtn.className =
          "ppx-shape-btn" + (!this.shapeFill ? " active" : "");
        strokeBtn.textContent = "\u25cb Stroke";
        strokeBtn.style.cssText = "width:54px;font-size:10px;";
        fillBtn.addEventListener("click", () => {
          this.shapeFill = true;
          fillBtn.classList.add("active");
          strokeBtn.classList.remove("active");
          updateShapeOptions();
        });
        strokeBtn.addEventListener("click", () => {
          this.shapeFill = false;
          strokeBtn.classList.add("active");
          fillBtn.classList.remove("active");
          updateShapeOptions();
        });
        fillStrokeArea.append(fillBtn, strokeBtn);
        const sepEl = document.createElement("div");
        sepEl.className = "ppx-sep";
        fillStrokeArea.appendChild(sepEl);
      }

      // Polygon sides
      if (this._shapeTool === "poly") {
        const sidesLbl = document.createElement("label");
        sidesLbl.textContent = "Sides";
        sidesLbl.style.cssText = "font-size:10px;color:#888;";
        const sidesSlide = document.createElement("input");
        sidesSlide.type = "range";
        sidesSlide.min = 3;
        sidesSlide.max = 12;
        sidesSlide.value = this.polySlides || 5;
        sidesSlide.style.cssText = "width:60px;";
        const sidesNum = document.createElement("input");
        sidesNum.type = "number";
        sidesNum.min = 3;
        sidesNum.max = 12;
        sidesNum.value = this.polySlides || 5;
        sidesNum.style.cssText =
          "width:36px;background:#111;color:#e0e0e0;border:1px solid #3a3d40;border-radius:3px;padding:2px 3px;font-size:10px;font-family:monospace;";
        sidesSlide.addEventListener("input", () => {
          this.polySlides = +sidesSlide.value;
          sidesNum.value = sidesSlide.value;
        });
        sidesNum.addEventListener("change", () => {
          const v = Math.max(3, Math.min(12, +sidesNum.value));
          this.polySlides = v;
          sidesSlide.value = v;
          sidesNum.value = v;
        });
        const sepEl = document.createElement("div");
        sepEl.className = "ppx-sep";
        polyArea.append(sidesLbl, sidesSlide, sidesNum, sepEl);
      }

      // Stroke width (for stroke mode or line)
      if (!this.shapeFill || this._shapeTool === "line") {
        const swLbl = document.createElement("label");
        swLbl.textContent = "Width";
        swLbl.style.cssText = "font-size:10px;color:#888;";
        const swSlide = document.createElement("input");
        swSlide.type = "range";
        swSlide.min = 1;
        swSlide.max = 50;
        swSlide.value = this.shapeLineWidth || 3;
        swSlide.style.cssText = "width:60px;";
        const swNum = document.createElement("input");
        swNum.type = "number";
        swNum.min = 1;
        swNum.max = 50;
        swNum.value = this.shapeLineWidth || 3;
        swNum.style.cssText =
          "width:36px;background:#111;color:#e0e0e0;border:1px solid #3a3d40;border-radius:3px;padding:2px 3px;font-size:10px;font-family:monospace;";
        swSlide.addEventListener("input", () => {
          this.shapeLineWidth = +swSlide.value;
          swNum.value = swSlide.value;
        });
        swNum.addEventListener("change", () => {
          const v = Math.max(1, Math.min(50, +swNum.value));
          this.shapeLineWidth = v;
          swSlide.value = v;
          swNum.value = v;
        });
        strokeArea.append(swLbl, swSlide, swNum);
      }
      // Refresh slider fills for dynamically created sliders
      requestAnimationFrame(() => {
        [fillStrokeArea, polyArea, strokeArea].forEach((area) => {
          area.querySelectorAll("input[type=range]").forEach((s) => {
            if (window._pxfUpdateFill) window._pxfUpdateFill(s);
          });
        });
      });
    };
    updateShapeOptions();
  }

  // Update help strip
  const helpTexts = {
    brush:
      "Drag to paint  \u00b7  [ / ] resize  \u00b7  Shift+click = straight line  \u00b7  Alt+drag = temp eyedropper  \u00b7  \u21ba resets defaults",
    pencil:
      "Hard-edge pencil  \u00b7  [ / ] resize  \u00b7  Shift+click = straight line  \u00b7  Alt+drag = eyedropper",
    eraser:
      "Drag to erase pixels  \u00b7  Opacity controls how much is erased  \u00b7  [ / ] resize",
    fill: "Click to flood-fill with FG color  \u00b7  Adjust Tolerance for color spread",
    pick: "Click or drag to sample color  \u00b7  Alt+drag while painting = quick eyedropper",
    smudge:
      "Drag to smear pixels  \u00b7  Adjust Strength slider  \u00b7  Smaller brush = finer detail",
    transform:
      "Drag = move  \u00b7  Corner = scale  \u00b7  Top circle = rotate  \u00b7  Center dot = move pivot  \u00b7  Click canvas = select layer  \u00b7  Enter = Apply",
    shape:
      "Drag to draw shape  \u00b7  Fill = solid, Stroke = outline  \u00b7  Polygon: adjust sides 3-12  \u00b7  Line ignores fill toggle",
  };
  if (this.el.helpStrip)
    this.el.helpStrip.textContent =
      helpTexts[this.tool] ||
      "B=Brush  P=Pencil  E=Eraser  G=Fill  I=Eyedrop  R=Smudge  V=Move  Space+Drag=Pan  Scroll=Zoom  Ctrl+Z=Undo";
};

// ─── Layers panel ─────────────────────────────────────────

proto._updateLayersPanel = function () {
  if (!this._layerPanel) return;
  // Reuse a shared offscreen canvas for thumbnail generation
  if (!this._thumbCanvas) {
    this._thumbCanvas = document.createElement("canvas");
    this._thumbCanvas.width = 26;
    this._thumbCanvas.height = 26;
    this._thumbCtx = this._thumbCanvas.getContext("2d");
  }
  const items = this.layers.map((ly, i) => {
    // Build thumbnail: render into shared canvas, copy to per-item canvas
    this._thumbCtx.clearRect(0, 0, 26, 26);
    this._thumbCtx.drawImage(ly.canvas, 0, 0, 26, 26);
    const tCvs = document.createElement("canvas");
    tCvs.width = 26;
    tCvs.height = 26;
    tCvs.getContext("2d").drawImage(this._thumbCanvas, 0, 0);

    return createLayerItem({
      name: ly.name,
      visible: ly.visible,
      locked: ly.locked,
      active: i === this.activeIdx,
      multiSelected: this.selectedIndices.has(i) && i !== this.activeIdx,
      thumbnail: tCvs,
      onVisibilityToggle: () => {
        ly.visible = !ly.visible;
        this._renderDisplay();
        this._updateLayersPanel();
      },
      onLockToggle: () => {
        ly.locked = !ly.locked;
        this._updateLayersPanel();
      },
      onClick: (e) => {
        if (e.detail > 1) return;
        if (e.ctrlKey || e.metaKey) {
          if (this.selectedIndices.has(i)) this.selectedIndices.delete(i);
          else this.selectedIndices.add(i);
          this.activeIdx = i;
        } else {
          this.selectedIndices.clear();
          this.selectedIndices.add(i);
          this.activeIdx = i;
        }
        this._syncLayerProps();
        this._updateLayersPanel();
        this._renderDisplay();
      },
      onRename: (newName) => {
        ly.name = newName;
      },
    }).el;
  });
  this._layerPanel.refresh(items);
  this._syncLayerProps();
};

proto._syncLayerProps = function () {
  const ly = this.layers[this.activeIdx];
  if (!ly) return;
  if (this.el.blendSel) this.el.blendSel.value = ly.blendMode;
  if (this.el.layerOpRange) this.el.layerOpRange.value = ly.opacity;
  if (this.el.layerOpNum) this.el.layerOpNum.value = ly.opacity;
  this._syncTransformPanel();
  this._updateTransformWarn();
  if (typeof this._syncBgRemovalButton === "function")
    this._syncBgRemovalButton();
};

proto._syncTransformPanel = function () {
  const ly = this.layers[this.activeIdx];
  if (!ly) return;
  const t = ly.transform;
  const tp = this._transformPanel;
  if (!tp) return;
  if (tp.setRotate) tp.setRotate(Math.round(t.rotation));
  if (tp.setScale) tp.setScale(Math.round(t.scaleX * 100));
  if (tp.setStretchH) tp.setStretchH(Math.round(t.scaleX * 100));
  if (tp.setStretchV) tp.setStretchV(Math.round(t.scaleY * 100));
  if (tp.setOpacity) tp.setOpacity(Math.round(ly.opacity));
};

proto._updateLayerThumb = function (idx) {
  const list = this.el.layerList;
  if (!list) return;
  const item = list.children[idx];
  if (!item) return;
  const tCvs = item.querySelector("canvas");
  if (!tCvs) return;
  const ly = this.layers[idx];
  if (!ly) return;
  tCvs.getContext("2d").clearRect(0, 0, 26, 26);
  tCvs.getContext("2d").drawImage(ly.canvas, 0, 0, 26, 26);
};

// ─── Document ─────────────────────────────────────────────

proto._updateDocProps = function () {
  if (this.el.docW) this.el.docW.value = this.docW;
  if (this.el.docH) this.el.docH.value = this.docH;
  if (this._canvasSettings) this._canvasSettings.setSize(this.docW, this.docH);
  if (this.el.bgPreview) this.el.bgPreview.style.background = this.bgColor;
};

proto._resizeDoc = function () {
  const nw = Math.max(64, Math.min(4096, +this.el.docW.value || this.docW));
  const nh = Math.max(64, Math.min(4096, +this.el.docH.value || this.docH));
  if (nw === this.docW && nh === this.docH) return;
  // Compute anchor offset so existing content stays top-left
  const offX = 0,
    offY = 0;
  this.layers.forEach((ly) => {
    const tmp = document.createElement("canvas");
    tmp.width = nw;
    tmp.height = nh;
    tmp.getContext("2d").drawImage(ly.canvas, offX, offY);
    ly.canvas.width = nw;
    ly.canvas.height = nh;
    ly.ctx.drawImage(tmp, 0, 0);
  });
  this.docW = nw;
  this.docH = nh;
  this._contentBoundsCache.clear();
  this._applyDocSize();
  this._renderDisplay();
  requestAnimationFrame(() => this._fitToView());
  this._updateLayersPanel();
  if (this.el.dimLabel) this.el.dimLabel.textContent = `${nw}\u00d7${nh}`;
  this._setStatus(`Canvas resized to ${nw}\u00d7${nh}`);
};

// ─── Save ─────────────────────────────────────────────────

proto._save = async function () {
  this._layout.setSaving();
  try {
    const finalCvs = document.createElement("canvas");
    finalCvs.width = this.docW;
    finalCvs.height = this.docH;
    const fCtx = finalCvs.getContext("2d");
    fCtx.fillStyle = this.bgColor;
    fCtx.fillRect(0, 0, this.docW, this.docH);
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const ly = this.layers[i];
      if (!ly.visible) continue;
      fCtx.save();
      fCtx.globalAlpha = ly.opacity / 100;
      fCtx.globalCompositeOperation = ly.blendMode;
      this._drawLayerWithTransform(fCtx, ly);
      fCtx.restore();
    }
    const compositeDataURL = finalCvs.toDataURL("image/png");

    // Upload all layers in parallel
    const layersMeta = await Promise.all(this.layers.map(async (ly) => {
      let src = "";
      try {
        const res = await PaintAPI.uploadLayer(
          ly.id,
          ly.canvas.toDataURL("image/png"),
        );
        src = res.path || "";
      } catch (e) {
        console.warn("[Paint] Layer upload failed:", e);
      }
      return {
        id: ly.id,
        name: ly.name,
        visible: ly.visible,
        locked: ly.locked,
        opacity: ly.opacity,
        blend_mode: ly.blendMode,
        source_kind: ly.sourceKind,
        transform: ly.transform,
        src,
      };
    }));

    let compositePath = "";
    try {
      const res = await PaintAPI.saveComposite(
        this.projectId,
        compositeDataURL,
      );
      compositePath = res.composite_path || "";
    } catch (e) {
      console.warn("[Paint] Composite save failed:", e);
    }

    const meta = {
      doc_w: this.docW,
      doc_h: this.docH,
      background_color: this.bgColor,
      project_id: this.projectId,
      layers: layersMeta,
      composite_path: compositePath,
      session_ver: 3.0,
    };
    if (this.onSave) this.onSave(JSON.stringify(meta), compositeDataURL);
    if (this._diskSavePending) {
      this._diskSavePending = false;
      if (this.onSaveToDisk) {
        if (this._canvasToolbar?.transparentBg) {
          const transCvs = document.createElement("canvas");
          transCvs.width = this.docW;
          transCvs.height = this.docH;
          const tCtx = transCvs.getContext("2d");
          for (let i = this.layers.length - 1; i >= 0; i--) {
            const ly = this.layers[i];
            if (!ly.visible) continue;
            tCtx.save();
            tCtx.globalAlpha = ly.opacity / 100;
            tCtx.globalCompositeOperation = ly.blendMode;
            this._drawLayerWithTransform(tCtx, ly);
            tCtx.restore();
          }
          this.onSaveToDisk(transCvs.toDataURL("image/png"));
        } else {
          this.onSaveToDisk(compositeDataURL);
        }
      }
    }
    this._layout.setSaved();
  } catch (err) {
    console.error("[Paint] Save error:", err);
    this._layout.setSaveError("Save failed: " + err.message);
  }
};

// ─── Cursor overlay ───────────────────────────────────────

proto._updateCursorOverlay = function (docX, docY) {
  const cvs = this.el.cursorCvs;
  if (!cvs) return;
  const ctx = cvs.getContext("2d");

  ctx.clearRect(0, 0, cvs.width, cvs.height);

  // Hide brush cursor while Alt is held (eyedropper mode)
  if (this._altDown) return;

  const lw = Math.max(0.4, 1 / this.zoom); // 1 screen-pixel line

  if (
    this.tool === "brush" ||
    this.tool === "pencil" ||
    this.tool === "smudge"
  ) {
    const r = Math.max(1, this.brush.size / 2);
    const shape =
      this.tool === "pencil" ? "square" : this.brush.shape || "round";
    ctx.save();
    this._drawCursorShape(
      ctx,
      docX,
      docY,
      r,
      shape,
      "rgba(255,255,255,0.9)",
      "rgba(0,0,0,0.7)",
      lw,
      false,
    );
    // Center dot
    ctx.beginPath();
    ctx.arc(docX, docY, lw * 1.2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fill();
    ctx.restore();
  } else if (this.tool === "eraser") {
    const r = Math.max(1, this.brush.size / 2);
    const shape = this.brush.shape || "round";
    ctx.save();
    this._drawCursorShape(
      ctx,
      docX,
      docY,
      r,
      shape,
      "rgba(200,200,200,0.85)",
      "rgba(0,0,0,0.4)",
      lw,
      true,
    );
    ctx.beginPath();
    ctx.arc(docX, docY, lw * 1.2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(200,200,200,0.8)";
    ctx.fill();
    ctx.restore();
  }
  // For pick, fill, transform, etc. — use OS/SVG cursor, no overlay needed
};

proto._drawCursorShape = function (
  ctx,
  x,
  y,
  r,
  shape,
  outerColor,
  innerColor,
  lw,
  dashed,
) {
  const drawOutline = () => {
    ctx.strokeStyle = outerColor;
    ctx.lineWidth = lw * 1.5;
    if (dashed)
      ctx.setLineDash([Math.max(2, 4 / this.zoom), Math.max(2, 4 / this.zoom)]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = innerColor;
    ctx.lineWidth = lw * 0.8;
    ctx.stroke();
  };
  ctx.beginPath();
  if (shape === "square") {
    ctx.rect(x - r, y - r, r * 2, r * 2);
  } else if (shape === "flat") {
    // ellipse() takes rotation angle natively — no need for save/restore
    ctx.ellipse(
      x,
      y,
      r,
      r * 0.35,
      ((this.brush.angle || 0) * Math.PI) / 180,
      0,
      Math.PI * 2,
    );
  } else if (shape === "triangle") {
    const h = r * 1.2;
    ctx.moveTo(x, y - h);
    ctx.lineTo(x + r, y + r * 0.5);
    ctx.lineTo(x - r, y + r * 0.5);
    ctx.closePath();
  } else if (shape === "diamond") {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2); // round, star, leaf, etc.
  }
  drawOutline();
};

proto._toggleHelp = function () {
  if (this._layout) this._layout.toggleHelp();
};
