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

import { getFontCatalog, loadFontForLayer } from "./fonts.mjs";
import { openPixaromaCompactColorPickerPopup } from "../shared/color_picker.mjs";

const BRAND = "#f66744";

/** Create the text editor panel.
 *  @param {Object} opts
 *  @param {HTMLElement} opts.mount  - container to render into
 *  @param {Function} opts.onChange  - called with (layer) on any property change
 *  @param {Function} [opts.onReset] - called with (layer) when Reset is clicked
 *  @returns {{ setLayer(layer), setCanvasBounds(w,h), destroy() }}
 */
export function createTextEditorPanel({ mount, onChange, onReset }) {
  injectCSS();
  let currentLayer = null;
  let suspendChange = false;
  let fontCatalog = null;

  const root = document.createElement("div");
  root.className = "pix-to-root";
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

  // Align: 3 icon buttons
  const alignRow = el("div", "pix-to-row3");
  root.appendChild(alignRow);
  const ALIGN_ICONS = {
    left:   "/pixaroma/assets/icons/ui/align-left.svg",
    center: "/pixaroma/assets/icons/ui/align-center-h.svg",
    right:  "/pixaroma/assets/icons/ui/align-right.svg",
  };
  ui.alignChips = ["left", "center", "right"].map((a) => {
    const b = el("button", "pix-to-chip pix-to-align-chip");
    b.type = "button"; b.dataset.align = a; b.title = `Align ${a}`;
    const img = document.createElement("img");
    img.src = ALIGN_ICONS[a]; img.alt = a; img.draggable = false;
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
  ui.sizeInput    = inputCell(typoGrid, "Size",      8,  512,   96, 1,   (v) => { const l = layerNow(); if (l) { l.fontSize = v;       fireChange(); }});
  ui.lineInput    = inputCell(typoGrid, "Leading", 0.5,    4,  1.2, 0.1, (v) => { const l = layerNow(); if (l) { l.lineHeight = v;     fireChange(); }});
  ui.letterInput  = inputCell(typoGrid, "Tracking", -10, 50,    0, 0.5, (v) => { const l = layerNow(); if (l) { l.letterSpacing = v;  fireChange(); }});
  ui.opacityInput = inputCell(typoGrid, "Opacity",   0, 100,  100, 1,   (v) => { const l = layerNow(); if (l) { l.opacity = v / 100;  fireChange(); }});
  ui.rotateInput  = inputCell(typoGrid, "Rotate", -180, 180,   0, 1,   (v) => { const l = layerNow(); if (l) { l.rotation = v;       fireChange(); }});

  const posGrid = el("div", "pix-to-grid2");
  root.appendChild(posGrid);
  ui.posXInput = inputCell(posGrid, "X", 0, 4096, 0, 1, (v) => { const l = layerNow(); if (l) { l.x = v; fireChange(); }});
  ui.posYInput = inputCell(posGrid, "Y", 0, 4096, 0, 1, (v) => { const l = layerNow(); if (l) { l.y = v; fireChange(); }});

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

  // Reset to defaults: compact, low-key, full-width but subtle.
  if (onReset) {
    const resetBtn = el("button", "pix-to-reset-btn");
    resetBtn.type = "button";
    resetBtn.textContent = "Reset to defaults";
    resetBtn.addEventListener("click", () => {
      const l = layerNow(); if (!l) return;
      onReset(l);
      setLayer(l);
      fireChange();
    });
    root.appendChild(resetBtn);
  }

  // Load font catalog; pre-load fonts so popup items render in their own typeface.
  getFontCatalog().then(async (cat) => {
    fontCatalog = cat;
    if (currentLayer) {
      ui.fontDropdownName.textContent = labelForFont(cat, currentLayer.font);
      ui.fontDropdownName.style.fontFamily = `"Pix-${currentLayer.font}", system-ui`;
    }
    for (const f of cat) {
      const firstWeight = f.weights?.[0];
      if (!firstWeight) continue;
      loadFontForLayer(f.id, firstWeight.weight, firstWeight.italic).catch(() => {});
    }
  }).catch((e) => console.warn("[text_editor] font catalog load failed", e));

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
      ui.opacityInput.setValue(Math.round((layer.opacity ?? 1) * 100));
      ui.rotateInput.setValue(layer.rotation ?? 0);
      ui.posXInput.setValue(layer.x ?? 0);
      ui.posYInput.setValue(layer.y ?? 0);
      ui.textColorCell.setValue(layer.color ?? "#FFFFFF");
      ui.bgColorCell.setValue(layer.bgColor || null);
    } finally {
      suspendChange = false;
    }
  }

  /** Set position input ranges based on the canvas dimensions. */
  function setCanvasBounds(canvasWidth, canvasHeight) {
    ui.posXInput.setRange(-canvasWidth, canvasWidth * 2);
    ui.posYInput.setRange(-canvasHeight, canvasHeight * 2);
  }

  function destroy() { root.remove(); }

  return { setLayer, setCanvasBounds, destroy };
}

// ── stateless helpers ─────────────────────────────────────────────────────────

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
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
    openPixaromaCompactColorPickerPopup(cell, {
      initialColor: getInitial(),
      showClear:    withClear,
      clearPosition: "last",
      resetColor:    withClear ? null : "#FFFFFF",
      onPick: (c) => onPick(c),
    });
  });

  return { el: cell, setValue };
}

// ── Custom font popup (mirrors openImageDropdown) ─────────────────────────────

function openFontPopup(anchorEl, catalog, currentId, onPick) {
  document.querySelector(".pix-to-popup")?.remove();
  const popup = document.createElement("div");
  popup.className = "pix-to-popup";
  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = `${rect.left}px`;
  popup.style.top  = `${rect.bottom + 2}px`;
  popup.style.width = `${rect.width}px`;

  let lastCat = null;
  for (const f of catalog) {
    if (lastCat && lastCat !== f.category) {
      const sep = document.createElement("div");
      sep.className = "pix-to-popup-sep";
      popup.appendChild(sep);
    }
    lastCat = f.category;
    const item = document.createElement("div");
    item.className = "pix-to-popup-item" + (f.id === currentId ? " active" : "");
    item.textContent = f.label;
    item.style.fontFamily = `"Pix-${f.id}", system-ui`;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      onPick(f.id);
      close();
    });
    popup.appendChild(item);
  }
  document.body.appendChild(popup);
  attachPopupCloseListeners(popup, close);
  function close() { popup.remove(); }
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

    /* Align row: 3 icon chips, full width */
    .pix-to-row3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
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
    .pix-to-align-chip img {
      width: 14px; height: 14px;
      pointer-events: none;
      filter: brightness(0) saturate(100%) invert(75%);
    }
    .pix-to-align-chip.active img { filter: brightness(0) invert(1); }

    /* 2-column grid for number inputs + colors */
    .pix-to-grid2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
    }

    /* Numeric input cell: [LABEL  value] */
    .pix-to-input-cell {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 4px 8px;
      min-height: 28px;
    }
    .pix-to-input-cell:focus-within { border-color: ${BRAND}; }
    .pix-to-input-label {
      font: 10px ui-sans-serif, system-ui, sans-serif;
      color: #888;
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
      text-align: right;
      width: 100%;
      min-width: 0;
      padding: 0;
      -moz-appearance: textfield;
    }
    .pix-to-input-val::-webkit-outer-spin-button,
    .pix-to-input-val::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

    /* Custom +/- spinner buttons (mirrors Load Image .pix-li-spin pattern,
       CSS chevrons so no extra SVG needed). */
    /* +/- spinners. Use unicode triangle chars (▴ ▾) so they always
       render as proper up/down arrows regardless of CSS border-rotation
       rendering quirks. */
    .pix-to-spin {
      display: flex;
      flex-direction: column;
      width: 14px;
      flex-shrink: 0;
      border-left: 1px solid #444;
      margin: -4px -8px -4px 6px; /* extend to the cell edge */
    }
    .pix-to-spin > button {
      flex: 1;
      background: transparent;
      border: none;
      padding: 0;
      cursor: pointer;
      color: #888;
      font: 10px ui-sans-serif, system-ui, sans-serif;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      outline: none;
    }
    .pix-to-spin > button:hover { background: #2a2a2a; color: ${BRAND}; }
    .pix-to-spin-up   { border-bottom: 1px solid #444; }
    .pix-to-spin-up::before   { content: "▴"; }
    .pix-to-spin-down::before { content: "▾"; }

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

    /* Reset button: small orange chip, right-aligned. Mirrors the
       Load Image .pix-li-snap-btn 'OFF' chip visual: tiny pill that
       clearly reads as a button (vs the previous low-key text link). */
    .pix-to-reset-btn {
      align-self: flex-end;
      margin-top: 4px;
      background: ${BRAND};
      border: 1px solid ${BRAND};
      border-radius: 3px;
      color: #fff;
      padding: 4px 10px;
      cursor: pointer;
      font: 600 10px ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.3px;
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
      max-height: 320px;
      overflow-y: auto;
      min-width: 160px;
    }
    .pix-to-popup-item {
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid #2a2a2a;
    }
    .pix-to-popup-item:last-child { border-bottom: none; }
    .pix-to-popup-item:hover { background: #2a2a2a; }
    .pix-to-popup-item.active { color: ${BRAND}; font-weight: 600; }
    .pix-to-popup-sep { height: 1px; background: #333; margin: 4px 0; }
  `;
  document.head.appendChild(s);
}
