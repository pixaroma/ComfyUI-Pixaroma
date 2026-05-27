// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Text Editor Panel (compact v2 layout)              ║
// ║  Properties UI for ONE text overlay.                         ║
// ║  Mounted twice: on the node body AND in the editor sidebar.  ║
// ║                                                              ║
// ║  Self-contained CSS (no dependency on .pxf-overlay scope)    ║
// ║  so the body panel looks the same as inside the editor.      ║
// ║  Mirrors js/load_image/ui.mjs styling for consistency        ║
// ║  with other Pixaroma nodes.                                  ║
// ║                                                              ║
// ║  v2 design: no section headers, number inputs in a 2-column  ║
// ║  grid (larger value text, more compact than sliders), Font   ║
// ║  picker shows the font name in its own typeface so users     ║
// ║  recognise the control without a FONT label, etc.            ║
// ╚═══════════════════════════════════════════════════════════════╝

import { getFontCatalog, loadFontForLayer, refreshFontCatalog } from "./fonts.mjs";
import { openPixaromaColorPickerModal } from "../shared/color_picker.mjs";

const BRAND = "#f66744";

/** Create the text editor panel.
 *  @param {Object} opts
 *  @param {HTMLElement} opts.mount  - container to render into
 *  @param {Function} opts.onChange  - called with (layer) on any property change
 *  @param {Function} [opts.onReset] - called with (layer) when Reset is clicked
 *  @returns {{ setLayer(layer), setCanvasBounds(w,h), destroy() }}
 */
export function createTextEditorPanel({ mount, onChange, onReset, onAlignCanvas, composerMode = false, watermarkMode = false }) {
  injectCSS();
  let currentLayer = null;
  let suspendChange = false;
  let fontCatalog = null;

  const root = document.createElement("div");
  // composerMode mounts in a narrow sidebar — force single-column grids so the
  // number/color cells get full width and don't clip (see .pix-to-narrow CSS).
  root.className = "pix-to-root" + (composerMode ? " pix-to-narrow" : "");
  mount.appendChild(root);

  function fireChange() {
    if (suspendChange || !currentLayer) return;
    onChange(currentLayer);
  }
  function layerNow() { return currentLayer; }

  const ui = {};

  // Text content
  ui.textArea = el("textarea", "pix-to-textarea");
  ui.textArea.placeholder = "Your text here";
  root.appendChild(ui.textArea);
  ui.textArea.addEventListener("input", () => { const l = layerNow(); if (l) l.text = ui.textArea.value; fireChange(); });
  ui.textArea.addEventListener("keydown", (e) => e.stopImmediatePropagation());

  // Font picker + Bold/Italic toggles in one row. The font dropdown grows
  // to fill, B and I sit on the right as compact square toggle buttons.
  // Drop the "Regular" button: B off == regular, so a separate Regular chip
  // would be redundant. B and I are independent toggles, both can be on.
  const fontRow = el("div", "pix-to-font-row");
  root.appendChild(fontRow);

  ui.fontDropdown = el("div", "pix-to-dropdown pix-to-dropdown-grow");
  ui.fontDropdown.innerHTML = `<span class="name">Roboto</span><span class="arrow">${chevronDown()}</span>`;
  ui.fontDropdownName = ui.fontDropdown.querySelector(".name");
  ui.fontDropdown.addEventListener("click", (e) => {
    e.stopPropagation();
    openFontPopup(ui.fontDropdown, fontCatalog || [], layerNow()?.font || "Roboto", (id) => {
      const l = layerNow(); if (!l) return;
      l.font = id;
      ui.fontDropdownName.textContent = labelForFont(fontCatalog, id);
      ui.fontDropdownName.style.fontFamily = `"Pix-${id}", system-ui`;
      fireChange();
    }, (cat) => {
      fontCatalog = cat;
      const l = layerNow();
      if (l) ui.fontDropdownName.textContent = labelForFont(cat, l.font);
    });
  });
  fontRow.appendChild(ui.fontDropdown);

  ui.boldBtn = chipBtn("B", "pix-to-style-btn pix-to-bold-btn", () => {
    const l = layerNow(); if (!l) return;
    l.weight = l.weight === 700 ? 400 : 700;
    ui.boldBtn.classList.toggle("active", l.weight === 700);
    fireChange();
  });
  ui.boldBtn.title = "Bold";
  fontRow.appendChild(ui.boldBtn);

  ui.italicBtn = chipBtn("I", "pix-to-style-btn pix-to-italic-btn", () => {
    const l = layerNow(); if (!l) return;
    l.italic = !l.italic;
    ui.italicBtn.classList.toggle("active", l.italic);
    fireChange();
  });
  ui.italicBtn.title = "Italic";
  fontRow.appendChild(ui.italicBtn);

  // Text align: 3 icon buttons. This aligns the LINES *within* the text
  // block relative to each other (left / centered / right) - it does NOT
  // move the text on the canvas. With a single line of text there is no
  // visible change, which is exactly what confused users in issue #39, so
  // the caption + the separate "Position on canvas" row below make the
  // distinction clear.
  const ALIGN_ICON = {
    left:   "/pixaroma/assets/icons/ui/align-left.svg",
    center: "/pixaroma/assets/icons/ui/align-center-h.svg",
    right:  "/pixaroma/assets/icons/ui/align-right.svg",
  };
  root.appendChild(caption("Text align (within block)"));
  const alignRow = el("div", "pix-to-row3");
  root.appendChild(alignRow);
  ui.alignChips = ["left", "center", "right"].map((a) => {
    const b = el("button", "pix-to-chip pix-to-align-chip");
    b.type = "button"; b.dataset.align = a; b.title = `Text align ${a} (lines within the text block)`;
    const img = document.createElement("img");
    img.src = ALIGN_ICON[a]; img.alt = a; img.draggable = false;
    b.appendChild(img);
    b.addEventListener("click", () => {
      const l = layerNow(); if (!l) return;
      l.align = a;
      ui.alignChips.forEach((c) => c.classList.toggle("active", c.dataset.align === a));
      fireChange();
    });
    alignRow.appendChild(b);
    return b;
  });

  // Typography + position number inputs, 2-column grid.
  // Each cell renders [LABEL  value] with the label small/grey on the left
  // and the value larger/orange on the right, inside a bordered cell.
  const typoGrid = el("div", "pix-to-grid2");
  root.appendChild(typoGrid);
  ui.sizeInput    = inputCell(typoGrid, "Size",          8,  512,   96, 1,   (v) => { const l = layerNow(); if (l) { l.fontSize = v;       fireChange(); }});
  ui.lineInput    = inputCell(typoGrid, "Line height", 0.5,    4,  1.2, 0.1, (v) => { const l = layerNow(); if (l) { l.lineHeight = v;     fireChange(); }});
  ui.letterInput  = inputCell(typoGrid, "Letter sp",   -10,   50,    0, 0.5, (v) => { const l = layerNow(); if (l) { l.letterSpacing = v;  fireChange(); }});
  // Opacity + transform (Rotate/X/Y) are omitted in composerMode: the Image
  // Composer owns position/rotation/opacity via the canvas + layer controls.
  if (!composerMode) {
    ui.opacityInput = inputCell(typoGrid, "Opacity",       0,  100,  100, 1,   (v) => { const l = layerNow(); if (l) { l.opacity = v / 100;  fireChange(); }});

    if (watermarkMode) {
      // Watermark mode: a Pixels / %-width size-unit toggle, then a position
      // row that puts Rotate + Margin X / Y on the left and a compact 3x3
      // anchor square (mirrors Load Image's crop anchor) on the right. Sitting
      // them side by side saves vertical height vs. a separate anchor row.
      // Margin X / Y are the inset from the anchored edge (replace absolute
      // X / Y). The renderer is shared with Text Overlay; the node computes the
      // final x/y from anchor + margin + size mode at render time.
      buildSizeModeToggle();
      const posRow = el("div", "pix-to-wm-posrow");
      root.appendChild(posRow);
      const posFields = el("div", "pix-to-wm-posfields");
      posRow.appendChild(posFields);
      ui.rotateInput  = inputCell(posFields, "Rotate", -180, 180,  0, 1, (v) => { const l = layerNow(); if (l) { l.rotation = v; fireChange(); }});
      ui.marginXInput = inputCell(posFields, "Marg X",    0, 4096, 20, 1, (v) => { const l = layerNow(); if (l) { l.marginX  = v; fireChange(); }});
      ui.marginYInput = inputCell(posFields, "Marg Y",    0, 4096, 20, 1, (v) => { const l = layerNow(); if (l) { l.marginY  = v; fireChange(); }});
      ui.marginXInput.el.title = "Horizontal inset from the anchored edge, in pixels";
      ui.marginYInput.el.title = "Vertical inset from the anchored edge, in pixels";
      buildAnchorGrid(posRow);
    } else {
      // Transform row: Rotate + X + Y in a 3-column grid. Keeps the rows
      // balanced (no empty cell next to Rotate) and saves a row of height.
      const transformGrid = el("div", "pix-to-grid3");
      root.appendChild(transformGrid);
      ui.rotateInput = inputCell(transformGrid, "Rotate", -180, 180,  0, 1, (v) => { const l = layerNow(); if (l) { l.rotation = v; fireChange(); }});
      ui.posXInput   = inputCell(transformGrid, "X",         0, 4096, 0, 1, (v) => { const l = layerNow(); if (l) { l.x = v;        fireChange(); }});
      ui.posYInput   = inputCell(transformGrid, "Y",         0, 4096, 0, 1, (v) => { const l = layerNow(); if (l) { l.y = v;        fireChange(); }});
    }
  }

  // Position on canvas: snap the WHOLE text block to a canvas edge / center.
  // This is the control most users reach for ("move the text to the left/
  // middle/right of the image"). Only rendered when the owner provides an
  // onAlignCanvas callback (the owner knows the canvas dimensions + how to
  // measure the text bbox). Horizontal trio (left / center / right) + vertical
  // trio (top / middle / bottom).
  if (typeof onAlignCanvas === "function") {
    const POS_ICON = {
      left:    "/pixaroma/assets/icons/ui/align-left.svg",
      centerH: "/pixaroma/assets/icons/ui/align-center-h.svg",
      right:   "/pixaroma/assets/icons/ui/align-right.svg",
      top:     "/pixaroma/assets/icons/ui/align-top.svg",
      centerV: "/pixaroma/assets/icons/ui/align-center-v.svg",
      bottom:  "/pixaroma/assets/icons/ui/align-bottom.svg",
    };
    const POS_TITLE = {
      left: "Move text to left edge", centerH: "Center text horizontally", right: "Move text to right edge",
      top: "Move text to top edge", centerV: "Center text vertically", bottom: "Move text to bottom edge",
    };
    root.appendChild(caption("Position on canvas (whole text)"));
    const posRow = el("div", "pix-to-row6");
    root.appendChild(posRow);
    for (const mode of ["left", "centerH", "right", "top", "centerV", "bottom"]) {
      const b = el("button", "pix-to-chip pix-to-align-chip");
      b.type = "button"; b.title = POS_TITLE[mode];
      const img = document.createElement("img");
      img.src = POS_ICON[mode]; img.alt = mode; img.draggable = false;
      b.appendChild(img);
      b.addEventListener("click", () => {
        const l = layerNow(); if (!l) return;
        onAlignCanvas(mode);
        // Momentary action (snap to position), not a persistent mode like
        // the text-align chips - so flash orange briefly to acknowledge the
        // press instead of staying lit.
        b.classList.add("is-flashing");
        setTimeout(() => b.classList.remove("is-flashing"), 450);
      });
      posRow.appendChild(b);
    }
  }

  // Colors: two clickable cells in one row. Each shows [swatch  LABEL  hex].
  // Click opens the compact color picker.
  const colorGrid = el("div", "pix-to-grid2");
  root.appendChild(colorGrid);
  ui.textColorCell = colorCell(colorGrid, "Text",   "#FFFFFF",
    () => layerNow()?.color || "#FFFFFF",
    (c) => {
      const l = layerNow(); if (!l || !c) return;
      l.color = c;
      ui.textColorCell.setValue(c);
      fireChange();
    },
    /* withClear= */ false,
  );
  ui.bgColorCell = colorCell(colorGrid, "Behind", null,
    () => layerNow()?.bgColor || "#000000",
    (c) => {
      const l = layerNow(); if (!l) return;
      l.bgColor = c || null;
      ui.bgColorCell.setValue(c || null);
      fireChange();
    },
    /* withClear= */ true,
  );

  // Reset to defaults: centered chip the same size as one of the align
  // buttons. Lives in a 3-column row so it sits in the middle column.
  if (onReset) {
    const resetRow = el("div", "pix-to-reset-row");
    const resetBtn = el("button", "pix-to-reset-btn");
    resetBtn.type = "button";
    resetBtn.textContent = "RESET";
    resetBtn.title = "Restore all settings to their defaults";
    resetBtn.addEventListener("click", () => {
      const l = layerNow(); if (!l) return;
      onReset(l);
      setLayer(l);
      fireChange();
    });
    resetRow.appendChild(resetBtn);
    root.appendChild(resetRow);
  }

  // Load font catalog. Only the CURRENT font is eagerly loaded (for the
  // dropdown label); popup rows load their own face lazily on scroll.
  getFontCatalog().then(async (cat) => {
    fontCatalog = cat;
    if (currentLayer) {
      ui.fontDropdownName.textContent = labelForFont(cat, currentLayer.font);
      ui.fontDropdownName.style.fontFamily = `"Pix-${currentLayer.font}", system-ui`;
      if (cat.some((f) => f.id === currentLayer.font)) {
        loadFontForLayer(currentLayer.font, currentLayer.weight ?? 400, !!currentLayer.italic).catch(() => {});
      }
    }
  }).catch((e) => console.warn("[text_editor] font catalog load failed", e));

  // ── watermark-mode builders (hoisted; called from the !composerMode block) ──

  // Pixels / %-width size-unit toggle. In % mode the Size field is read as a
  // percentage of each image's width (consistent across mixed-size batches).
  function buildSizeModeToggle() {
    const row = el("div", "pix-to-sizemode");
    const segPx  = el("button", "pix-to-seg"); segPx.type  = "button"; segPx.textContent  = "Pixels";  segPx.title  = "Size in pixels";
    const segPct = el("button", "pix-to-seg"); segPct.type = "button"; segPct.textContent = "% width"; segPct.title = "Size as a percentage of each image's width (good for mixed-size batches)";
    row.append(segPx, segPct);
    root.appendChild(row);
    function apply(mode, fromUser) {
      segPx.classList.toggle("active", mode === "px");
      segPct.classList.toggle("active", mode === "pct");
      if (ui.sizeInput) ui.sizeInput.setRange(mode === "pct" ? 1 : 4, mode === "pct" ? 100 : 2048);
      if (fromUser) {
        const l = layerNow(); if (!l) return;
        let v = l.fontSize;
        if (mode === "pct" && (!(v >= 1) || v > 100)) v = 10;   // px value would be nonsense as a %
        if (mode === "px"  && !(v >= 4)) v = 64;                 // % value would be tiny as px
        l.sizeMode = mode;
        l.fontSize = v;
        if (ui.sizeInput) ui.sizeInput.setValue(v);
        fireChange();
      }
    }
    segPx.addEventListener("click", () => apply("px", true));
    segPct.addEventListener("click", () => apply("pct", true));
    ui.applySizeMode = apply;
  }

  // Compact 3x3 anchor square (mirrors Load Image's crop anchor). Grid
  // position == image position (top-left cell = top-left anchor); the chosen
  // cell stays orange. Appended into the caller's parent so it can sit beside
  // the Rotate / Margin inputs.
  function buildAnchorGrid(parent) {
    const grid = el("div", "pix-to-anchor");
    grid.title = "Watermark position";
    const ANCHORS = [
      ["top-left", "Top left"],     ["top-center", "Top center"],     ["top-right", "Top right"],
      ["middle-left", "Middle left"], ["center", "Center"],            ["middle-right", "Middle right"],
      ["bottom-left", "Bottom left"], ["bottom-center", "Bottom center"], ["bottom-right", "Bottom right"],
    ];
    ui.anchorCells = ANCHORS.map(([id, title]) => {
      const c = el("div", "pix-to-anchor-cell"); c.dataset.anchor = id; c.title = title;
      c.addEventListener("click", () => {
        const l = layerNow(); if (!l) return;
        l.anchor = id;
        ui.anchorCells.forEach((x) => x.classList.toggle("active", x.dataset.anchor === id));
        fireChange();
      });
      grid.appendChild(c);
      return c;
    });
    parent.appendChild(grid);
  }

  function setLayer(layer) {
    currentLayer = layer;
    suspendChange = true;
    try {
      if (!layer) { root.classList.add("pix-to-empty"); return; }
      root.classList.remove("pix-to-empty");
      ui.textArea.value = layer.text ?? "";
      const fontId = layer.font ?? "Roboto";
      ui.fontDropdownName.textContent = labelForFont(fontCatalog, fontId);
      ui.fontDropdownName.style.fontFamily = `"Pix-${fontId}", system-ui`;
      ui.boldBtn.classList.toggle("active", (layer.weight ?? 400) === 700);
      ui.italicBtn.classList.toggle("active", !!layer.italic);
      ui.alignChips.forEach((c) => c.classList.toggle("active", c.dataset.align === (layer.align ?? "center")));
      ui.sizeInput.setValue(layer.fontSize ?? 96);
      ui.lineInput.setValue(layer.lineHeight ?? 1.2);
      ui.letterInput.setValue(layer.letterSpacing ?? 0);
      // These four are absent in composerMode — guard each.
      ui.opacityInput && ui.opacityInput.setValue(Math.round((layer.opacity ?? 1) * 100));
      ui.rotateInput && ui.rotateInput.setValue(layer.rotation ?? 0);
      ui.posXInput && ui.posXInput.setValue(layer.x ?? 0);
      ui.posYInput && ui.posYInput.setValue(layer.y ?? 0);
      ui.textColorCell.setValue(layer.color ?? "#FFFFFF");
      ui.bgColorCell.setValue(layer.bgColor || null);
      // Watermark-mode controls (present only when watermarkMode === true).
      if (ui.applySizeMode) ui.applySizeMode(layer.sizeMode === "pct" ? "pct" : "px", false);
      ui.marginXInput && ui.marginXInput.setValue(layer.marginX ?? 20);
      ui.marginYInput && ui.marginYInput.setValue(layer.marginY ?? 20);
      if (ui.anchorCells) {
        const a = layer.anchor ?? "bottom-right";
        ui.anchorCells.forEach((c) => c.classList.toggle("active", c.dataset.anchor === a));
      }
    } finally {
      suspendChange = false;
    }
  }

  /** Set position input ranges based on the canvas dimensions. */
  function setCanvasBounds(canvasWidth, canvasHeight) {
    // No-op in composerMode (no position inputs).
    if (!ui.posXInput || !ui.posYInput) return;
    ui.posXInput.setRange(-canvasWidth, canvasWidth * 2);
    ui.posYInput.setRange(-canvasHeight, canvasHeight * 2);
  }

  /** Lock or unlock the text textarea. Used by the editor + body panel
   *  when the Text Overlay node has its `text` input wired - the
   *  upstream value overrides whatever the user types here, so disable
   *  the field to avoid silent edits being thrown away. Pass a hint
   *  string to show under the textarea while locked. */
  function setTextReadOnly(isReadOnly, hint) {
    ui.textArea.readOnly = !!isReadOnly;
    ui.textArea.classList.toggle("pix-to-textarea-locked", !!isReadOnly);
    ui.textArea.title = isReadOnly && hint ? hint : "";
    if (!ui.textLockHint) {
      ui.textLockHint = el("div", "pix-to-text-lockhint");
      ui.textArea.after(ui.textLockHint);
    }
    ui.textLockHint.textContent = isReadOnly && hint ? hint : "";
    ui.textLockHint.style.display = isReadOnly && hint ? "block" : "none";
  }

  function destroy() { root.remove(); }

  return { setLayer, setCanvasBounds, setTextReadOnly, destroy };
}

// ── stateless helpers ─────────────────────────────────────────────────────────

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

// Small grey row caption used to disambiguate the two align controls
// ("Text align" vs "Position on canvas"). Kept intentionally tiny so it
// doesn't read like a heavy section header (v2 panel is header-light).
function caption(text) {
  const c = el("div", "pix-to-caption");
  c.textContent = text;
  return c;
}

function chipBtn(text, className, onClick) {
  const b = el("button", className);
  b.type = "button";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

function chevronDown() {
  // Single-character chevron, same as Load Image's .arrow
  return "▾";
}

function labelForFont(catalog, id) {
  if (!catalog) return id || "Roboto";
  const f = catalog.find((x) => x.id === id);
  return f?.label || id || "Roboto";
}

// One cell in the 2-column number-input grid. Returns { el, input, setValue, setRange }.
// Layout: [LABEL  value  ▲/▼] inside a single bordered box.
// The input is type=text (not number) so users can type math expressions
// like "100+12" or "512*2" — evaluated on blur/Enter via safeMathEval.
// Live onChange still fires while typing plain numbers (so the preview
// updates as you type), but math expressions wait for commit.
// +/- spinner buttons mirror Load Image's pix-li-spin pattern (Shift = 10x).
function inputCell(parent, label, min, max, value, step, onChange) {
  let curMin = min, curMax = max;
  let currentValue = value;

  const cell = el("div", "pix-to-input-cell");
  const lbl = el("span", "pix-to-input-label"); lbl.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.className = "pix-to-input-val";
  input.value = fmtStep(value, step);
  input.title = "Math allowed: 100+12, 512*2, (1024+128)/2";

  const spin = el("div", "pix-to-spin");
  const upBtn = el("button", "pix-to-spin-up");   upBtn.type = "button";   upBtn.tabIndex = -1;
  const downBtn = el("button", "pix-to-spin-down"); downBtn.type = "button"; downBtn.tabIndex = -1;
  spin.append(upBtn, downBtn);
  cell.append(lbl, input, spin);

  function clamp(v) { return Math.max(curMin, Math.min(curMax, v)); }

  function commit() {
    const raw = safeMathEval(input.value);
    const v = Number.isFinite(raw) ? clamp(roundToStep(raw, step)) : currentValue;
    input.value = fmtStep(v, step);
    if (v !== currentValue) {
      currentValue = v;
      onChange(v);
    }
  }

  function step1(dir, mult) {
    const raw = safeMathEval(input.value);
    const base = Number.isFinite(raw) ? raw : currentValue;
    const next = clamp(roundToStep(base + dir * step * mult, step));
    input.value = fmtStep(next, step);
    currentValue = next;
    onChange(next);
  }

  upBtn.addEventListener("mousedown",   (e) => { e.preventDefault(); e.stopPropagation(); step1(+1, e.shiftKey ? 10 : 1); });
  downBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); step1(-1, e.shiftKey ? 10 : 1); });

  // Live update while typing a plain number, so the canvas preview tracks
  // typing. For math expressions (with operators), wait for blur/Enter.
  input.addEventListener("input", () => {
    if (/^-?\d+(\.\d+)?$/.test(input.value.trim())) {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) {
        currentValue = v;
        onChange(v);
      }
    }
  });
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    e.stopImmediatePropagation();
    if (e.key === "Enter") { e.preventDefault(); input.blur(); return; }
    if (e.key === "Tab") { commit(); return; }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      step1(e.key === "ArrowUp" ? 1 : -1, e.shiftKey ? 10 : 1);
    }
  });

  parent.appendChild(cell);
  return {
    el: cell, input,
    setValue(v) { currentValue = v; input.value = fmtStep(v, step); },
    setRange(mn, mx) { curMin = mn; curMax = mx; },
  };
}

// Whitelist-only math eval. Accepts only digits, + - * / ( ) . and
// whitespace; everything else returns NaN. Uses the Function constructor
// inside strict mode for evaluation.
function safeMathEval(expr) {
  if (typeof expr !== "string") return NaN;
  const s = expr.trim();
  if (!s) return NaN;
  if (!/^[\d+\-*/().\s]+$/.test(s)) return NaN;
  try {
    const v = Function(`"use strict"; return (${s});`)();
    return typeof v === "number" && Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}

// Round v to the precision implied by step (step=0.1 -> 1 decimal, step=1 -> int).
function roundToStep(v, step) {
  if (!step) return v;
  const decimals = (String(step).split(".")[1] || "").length;
  const m = Math.pow(10, decimals);
  return Math.round(v * m) / m;
}

// Format v as a string with the precision implied by step.
function fmtStep(v, step) {
  if (!step) return String(v);
  const decimals = (String(step).split(".")[1] || "").length;
  return decimals ? Number(v).toFixed(decimals) : String(Math.round(v));
}

// One cell in the colors grid. Returns { el, setValue }.
// setValue(hex) updates the swatch; setValue(null) for "no pill" shows
// the checker pattern + "(none)" text.
function colorCell(parent, label, initialHex, getInitial, onPick, withClear) {
  const cell = el("div", "pix-to-color-cell");
  cell.title = `${label} color`;
  const swatch = el("div", "pix-to-color-cell-swatch");
  const lbl = el("span", "pix-to-input-label"); lbl.textContent = label;
  const val = el("span", "pix-to-color-cell-val");
  cell.append(swatch, lbl, val);
  parent.appendChild(cell);

  function setValue(hex) {
    if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
      swatch.style.background = hex;
      swatch.classList.remove("pix-to-swatch-checker");
      val.textContent = hex.toUpperCase();
    } else {
      swatch.style.background = "";
      swatch.classList.add("pix-to-swatch-checker");
      val.textContent = "(none)";
    }
  }
  setValue(initialHex);

  cell.addEventListener("click", (e) => {
    e.stopPropagation();
    // Open the full Photoshop-style picker MODAL (swatches + SV plane +
    // hue strip + hex input + Apply / Cancel). Modal backdrop locks the
    // page so the popup can't be moved out from under you by clicking on
    // the node body or canvas (the issue with the compact popup).
    openPixaromaColorPickerModal({
      title: label === "Behind" ? "Behind (background) color" : `${label} color`,
      initialColor: getInitial(),
      showClear: withClear,
      onPick: (c) => onPick(c),
    });
  });

  return { el: cell, setValue };
}

// ── Custom font popup (mirrors openImageDropdown) ─────────────────────────────

function openFontPopup(anchorEl, catalog, currentId, onPick, onCatalog) {
  document.querySelector(".pix-to-popup")?.remove();
  const popup = document.createElement("div");
  popup.className = "pix-to-popup";
  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = `${rect.left}px`;
  popup.style.top = "0px"; // real position set after measuring (below)
  popup.style.width = `${Math.max(rect.width, 200)}px`;

  // ── search row (filter + refresh) ──
  const searchRow = document.createElement("div");
  searchRow.className = "pix-to-popup-search";
  const mag = document.createElement("span");
  mag.className = "pix-to-popup-mag";
  mag.textContent = "⌕";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Filter fonts…";
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "pix-to-popup-refresh";
  refreshBtn.title = "Rescan models/fonts for newly added fonts";
  refreshBtn.textContent = "↻";
  searchRow.append(mag, input, refreshBtn);
  popup.appendChild(searchRow);

  // ── scrollable list ──
  const list = document.createElement("div");
  list.className = "pix-to-popup-list";
  popup.appendChild(list);

  // Lazy preview: load a row's own font only when it scrolls into view.
  let io = null;
  const buildList = (cat, query) => {
    list.innerHTML = "";
    if (io) { io.disconnect(); io = null; }
    io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const rowEl = en.target;
        io.unobserve(rowEl);
        const id = rowEl.dataset.fontId;
        const f = cat.find((x) => x.id === id);
        const w0 = f?.weights?.[0];
        if (!w0) continue;
        loadFontForLayer(f.id, w0.weight, w0.italic)
          .then(() => { rowEl.style.fontFamily = `"Pix-${f.id}", system-ui`; })
          .catch(() => {});
      }
    }, { root: list });

    const q = (query || "").trim().toLowerCase();
    let lastCat = null;
    let shown = 0;
    for (const f of cat) {
      if (q && !f.label.toLowerCase().includes(q)) continue;
      if (lastCat && lastCat !== f.category) {
        const sep = document.createElement("div");
        sep.className = "pix-to-popup-sep";
        list.appendChild(sep);
      }
      lastCat = f.category;
      const item = document.createElement("div");
      item.className = "pix-to-popup-item" + (f.id === currentId ? " active" : "");
      item.textContent = f.label;
      item.dataset.fontId = f.id;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        onPick(f.id);
        dismiss();
      });
      list.appendChild(item);
      io.observe(item);
      shown++;
    }
    if (shown === 0) {
      const empty = document.createElement("div");
      empty.className = "pix-to-popup-empty";
      empty.textContent = "(no matches)";
      list.appendChild(empty);
    }
  };

  let workingCat = catalog;
  // Teardown: removes the popup + the observer. Reassigned after the popup is
  // in the DOM to the closer returned by attachPopupCloseListeners, which ALSO
  // detaches the document listeners (so no listener leak on row-click/Escape).
  let dismiss = () => { if (io) io.disconnect(); popup.remove(); };

  // Typing filters; keystrokes must not reach the canvas (pan/shortcuts).
  input.addEventListener("input", () => buildList(workingCat, input.value));
  input.addEventListener("keydown", (e) => {
    e.stopImmediatePropagation();
    if (e.key === "Escape") dismiss();
  });

  refreshBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    refreshBtn.disabled = true;
    try {
      workingCat = await refreshFontCatalog();
      onCatalog?.(workingCat);
      buildList(workingCat, input.value);
    } catch (err) {
      console.warn("[text_editor] font refresh failed", err);
    } finally {
      refreshBtn.disabled = false;
    }
  });

  document.body.appendChild(popup);
  // Wire close + build rows AFTER the popup is connected: the IntersectionObserver
  // root (the scroll list) must be in the DOM for lazy previews to fire, and the
  // returned closer is the single teardown path that also detaches listeners.
  dismiss = attachPopupCloseListeners(popup, () => { if (io) io.disconnect(); popup.remove(); });
  buildList(workingCat, "");

  // Position: open downward; if it would overflow the viewport bottom, flip
  // above the anchor; clamp into the viewport as a last resort. Also clamp the
  // left edge so a narrow sidebar near the screen edge doesn't push it off.
  const vw = window.innerWidth, vh = window.innerHeight;
  const ph = Math.min(popup.offsetHeight, 340);
  let top = rect.bottom + 2;
  if (top + ph > vh - 8) {
    const above = rect.top - 2 - ph;
    top = above >= 8 ? above : Math.max(8, vh - 8 - ph);
  }
  let left = rect.left;
  if (left + popup.offsetWidth > vw - 8) left = Math.max(8, vw - 8 - popup.offsetWidth);
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
  setTimeout(() => input.focus(), 0);
}

// Shared close-listener wiring for our custom popups. Mirrors Load Image
// Pattern #14: mousedown/pointerdown/wheel/Esc all capture-phase. Wheel
// listener MUST gate on !popup.contains so users can scroll the list.
function attachPopupCloseListeners(popup, closeFn) {
  const onDocDown = (e) => { if (!popup.contains(e.target)) doClose(); };
  const onWheel   = (e) => { if (!popup.contains(e.target)) doClose(); };
  const onKey     = (e) => { if (e.key === "Escape") doClose(); };
  function doClose() {
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("pointerdown", onDocDown, true);
    document.removeEventListener("wheel", onWheel, true);
    document.removeEventListener("keydown", onKey, true);
    closeFn();
  }
  setTimeout(() => {
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("wheel", onWheel, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  return doClose;
}

// ── CSS injection (once per page) ─────────────────────────────────────────────

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return; _cssInjected = true;
  const s = document.createElement("style"); s.id = "pix-to-css";
  s.textContent = `
    .pix-to-root {
      box-sizing: border-box;
      padding: 8px;
      background: #2a2a2a;
      border-radius: 4px;
      color: #ddd;
      font: 11px ui-sans-serif, system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .pix-to-root * { box-sizing: border-box; }
    .pix-to-empty::after { content:"Select a layer to edit"; color:#666; font-style:italic; }

    .pix-to-textarea {
      width: 100%;
      background: #1d1d1d;
      color: #fff;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 8px;
      font: 12px ui-sans-serif, system-ui, sans-serif;
      resize: vertical;
      min-height: 44px;
    }
    .pix-to-textarea:focus { outline: none; border-color: ${BRAND}; }
    .pix-to-textarea-locked {
      color: #666 !important;
      background: #1a1a1a !important;
      cursor: not-allowed;
      font-style: italic;
    }
    .pix-to-text-lockhint {
      font: 10px ui-sans-serif, system-ui, sans-serif;
      color: ${BRAND};
      letter-spacing: 0.3px;
      margin-top: -2px;
      margin-bottom: 2px;
    }

    .pix-to-dropdown {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 7px 10px;
      font: 13px ui-sans-serif, system-ui, sans-serif;
      color: #ddd;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
    }
    .pix-to-dropdown:hover { border-color: #666; }
    .pix-to-dropdown .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pix-to-dropdown .arrow { color: ${BRAND}; font-size: 11px; margin-left: 6px; }

    /* Font row: dropdown grows, B + I toggle buttons on the right */
    .pix-to-font-row {
      display: flex;
      gap: 4px;
      align-items: stretch;
    }
    .pix-to-dropdown-grow { flex: 1; min-width: 0; }

    /* Bold / Italic toggle buttons. Square chips, single letter, orange
       background when active, grey when off. */
    .pix-to-style-btn {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      color: #888;
      cursor: pointer;
      width: 36px;
      flex-shrink: 0;
      font: 700 14px ui-sans-serif, system-ui, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .pix-to-style-btn:hover { border-color: #666; color: #ddd; }
    .pix-to-style-btn.active { background: ${BRAND}; color: #fff; border-color: ${BRAND}; }
    .pix-to-italic-btn { font-style: italic; font-family: serif; }

    /* Small row caption (disambiguates Text align vs Position on canvas) */
    .pix-to-caption {
      font: 10px ui-sans-serif, system-ui, sans-serif;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 2px 0 -2px 1px;
    }

    /* Align row: 3 icon chips, full width */
    .pix-to-row3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 3px;
    }
    /* Position-on-canvas row: 6 icon chips (H trio + V trio) */
    .pix-to-row6 {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 3px;
    }

    .pix-to-chip {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      color: #aaa;
      cursor: pointer;
      padding: 5px 0;
      font: 600 11px ui-sans-serif, system-ui, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 26px;
    }
    .pix-to-chip:hover { border-color: #666; color: #ddd; }
    .pix-to-chip.active { background: ${BRAND}; color: #fff; border-color: ${BRAND}; }
    /* Brief click acknowledgement for the momentary "Position on canvas"
       buttons (they have no persistent active state). */
    .pix-to-chip.is-flashing { background: ${BRAND}; border-color: ${BRAND}; }
    .pix-to-align-chip img {
      width: 14px; height: 14px;
      pointer-events: none;
      filter: brightness(0) saturate(100%) invert(75%);
    }
    .pix-to-align-chip.active img,
    .pix-to-align-chip.is-flashing img { filter: brightness(0) invert(1); }

    /* 2-column grid for number inputs + colors. minmax(0,1fr) lets columns
       shrink below their content min-size so cells never overflow the panel. */
    .pix-to-grid2 {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 4px;
    }
    /* 3-column grid used by the Rotate / X / Y row */
    .pix-to-grid3 {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
      gap: 4px;
    }
    /* Narrow (composer sidebar) — stack to one column so every cell gets full
       width and the longer labels (LINE HEIGHT / LETTER SP / BEHIND) fit. */
    .pix-to-narrow .pix-to-grid2 { grid-template-columns: 1fr; }

    /* Numeric input cell: [LABEL  value  spin]. Matches Load Image's
       .pix-li-numinput: the cell STRETCHES its children (align-items:stretch)
       so the spinner column fills the full cell height and its chevrons render
       cleanly. No padding on the cell itself - the label and input supply
       their own, the spin column sits flush against the right border. */
    .pix-to-input-cell {
      display: flex;
      align-items: center;   /* center label + value; the spin column stretches itself */
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      min-height: 28px;
      overflow: hidden;   /* clip the recessed spinner column to the rounded corner */
    }
    .pix-to-input-cell:focus-within { border-color: ${BRAND}; }
    .pix-to-input-label {
      display: flex;
      align-items: center;
      padding-left: 8px;
      font: 10px ui-sans-serif, system-ui, sans-serif;
      color: ${BRAND};
      text-transform: uppercase;
      letter-spacing: 0.5px;
      flex-shrink: 0;
    }
    .pix-to-input-val {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: ${BRAND};
      font: 600 13px ui-sans-serif, system-ui, sans-serif;
      line-height: 1.2;   /* explicit vertical centering (don't rely on input auto-center) */
      text-align: right;
      width: 100%;
      min-width: 0;
      padding: 0 6px;
      -moz-appearance: textfield;
    }
    .pix-to-input-val::-webkit-outer-spin-button,
    .pix-to-input-val::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

    /* Spinner column: SOLID filled triangle glyphs (literal ▲ ▼ chars - never
       a \\25B2 CSS escape, which throws inside this template literal). No
       divider, transparent buttons, so the field reads as one uniform dark box
       (mirrors the Image Resize / Load Image spinner). Stretches full cell
       height via the cell's align-items:stretch. */
    .pix-to-spin {
      display: flex;
      flex-direction: column;
      width: 16px;
      flex-shrink: 0;
      align-self: stretch;   /* full cell height even though the cell centers its items */
    }
    .pix-to-spin > button {
      flex: 1;
      background: transparent;
      border: none;
      padding: 0;
      cursor: pointer;
      color: #aaa;
      position: relative;
      outline: none;
    }
    .pix-to-spin > button:hover { color: ${BRAND}; }
    .pix-to-spin-up::before,
    .pix-to-spin-down::before {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      font-size: 8px;
      line-height: 1;
    }
    .pix-to-spin-up::before   { content: "▲"; }
    .pix-to-spin-down::before { content: "▼"; }

    /* Color cell: [swatch LABEL hex] */
    .pix-to-color-cell {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 4px 8px;
      cursor: pointer;
      min-height: 28px;
    }
    .pix-to-color-cell:hover { border-color: #666; }
    .pix-to-color-cell-swatch {
      width: 18px; height: 18px;
      border-radius: 3px;
      border: 1px solid #555;
      flex-shrink: 0;
      background: #fff;
    }
    .pix-to-color-cell-val {
      flex: 1;
      text-align: right;
      font: 600 11px ui-sans-serif, system-ui, sans-serif;
      color: ${BRAND};
      letter-spacing: 0.3px;
    }
    .pix-to-swatch-checker {
      background: repeating-conic-gradient(#333 0% 25%, #444 0% 50%) 0 0 / 8px 8px !important;
    }

    /* Reset row: 3-column grid so the button sits centered (middle
       column) and matches the width of a single align chip. */
    .pix-to-reset-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 3px;
    }
    .pix-to-reset-btn {
      grid-column: 2;
      background: ${BRAND};
      border: 1px solid ${BRAND};
      border-radius: 4px;
      color: #fff;
      padding: 5px 0;
      cursor: pointer;
      font: 600 11px ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.5px;
      min-height: 26px;
    }
    .pix-to-reset-btn:hover { background: #ff7e5a; border-color: #ff7e5a; }

    /* Custom dropdown popup (positioned via body) */
    .pix-to-popup {
      position: fixed;
      z-index: 99999;
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      font: 13px ui-sans-serif, system-ui, sans-serif;
      color: #ddd;
      max-height: 340px;
      min-width: 160px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .pix-to-popup-search {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border-bottom: 1px solid #333;
      background: #1d1d1d;
      flex-shrink: 0;
    }
    .pix-to-popup-mag { color: #888; font-size: 14px; }
    .pix-to-popup-search input {
      flex: 1;
      min-width: 0;
      background: transparent;
      border: none;
      outline: none;
      color: #e0e0e0;
      font: 12px ui-sans-serif, system-ui, sans-serif;
    }
    .pix-to-popup-search input::placeholder { color: #777; }
    .pix-to-popup-refresh {
      background: rgba(255,255,255,0.06);
      color: #ccc;
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 4px;
      width: 22px;
      height: 22px;
      cursor: pointer;
      line-height: 1;
      font-size: 13px;
      flex-shrink: 0;
    }
    .pix-to-popup-refresh:hover { border-color: ${BRAND}; color: #fff; }
    .pix-to-popup-refresh:disabled { opacity: 0.5; cursor: default; }
    .pix-to-popup-list { overflow-y: auto; flex: 1; }
    .pix-to-popup-empty { padding: 10px 12px; color: #777; font: 12px ui-sans-serif, system-ui, sans-serif; }
    .pix-to-popup-item {
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid #2a2a2a;
    }
    .pix-to-popup-item:last-child { border-bottom: none; }
    .pix-to-popup-item:hover { background: #2a2a2a; }
    .pix-to-popup-item.active { color: ${BRAND}; font-weight: 600; }
    .pix-to-popup-sep { height: 1px; background: #333; margin: 4px 0; }

    /* Watermark: Pixels / %-width size-unit toggle (2-segment) */
    .pix-to-sizemode { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; }
    .pix-to-seg {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      color: #aaa;
      cursor: pointer;
      padding: 5px 0;
      font: 600 11px ui-sans-serif, system-ui, sans-serif;
      min-height: 26px;
    }
    .pix-to-seg:hover { border-color: #666; color: #ddd; }
    .pix-to-seg.active { background: ${BRAND}; color: #fff; border-color: ${BRAND}; }

    /* Watermark position row: Rotate + Margin X/Y on the left, compact 3x3
       anchor square on the right (mirrors Load Image's crop anchor). */
    .pix-to-wm-posrow { display: flex; gap: 6px; align-items: stretch; }
    .pix-to-wm-posfields { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .pix-to-anchor {
      flex: none;
      width: 92px;
      aspect-ratio: 1;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-template-rows: repeat(3, 1fr);
      gap: 3px;
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 5px;
      padding: 5px;
      box-sizing: border-box;
    }
    .pix-to-anchor-cell {
      background: rgba(255, 255, 255, 0.07);
      border-radius: 2px;
      cursor: pointer;
      transition: background 0.08s;
    }
    .pix-to-anchor-cell:hover { background: rgba(255, 255, 255, 0.18); }
    .pix-to-anchor-cell.active { background: ${BRAND}; }
  `;
  document.head.appendChild(s);
}
