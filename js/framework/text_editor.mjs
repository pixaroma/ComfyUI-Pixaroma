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

  // Font picker. No label; the dropdown shows the current font name
  // rendered in its own typeface, which is self-explanatory.
  ui.fontDropdown = el("div", "pix-to-dropdown");
  ui.fontDropdown.innerHTML = `<span class="name">Roboto</span><span class="arrow">${chevronDown()}</span>`;
  ui.fontDropdownName = ui.fontDropdown.querySelector(".name");
  root.appendChild(ui.fontDropdown);
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

  // Style: Regular / Bold / Italic. Reg/Bold mutex, Italic independent.
  const styleRow = el("div", "pix-to-row3");
  root.appendChild(styleRow);
  ui.regBtn = chipBtn("Regular", "pix-to-chip", () => {
    const l = layerNow(); if (!l) return;
    l.weight = 400;
    ui.regBtn.classList.add("active"); ui.boldBtn.classList.remove("active");
    fireChange();
  });
  ui.boldBtn = chipBtn("Bold", "pix-to-chip pix-to-bold", () => {
    const l = layerNow(); if (!l) return;
    l.weight = 700;
    ui.boldBtn.classList.add("active"); ui.regBtn.classList.remove("active");
    fireChange();
  });
  ui.italicBtn = chipBtn("Italic", "pix-to-chip pix-to-italic-chip", () => {
    const l = layerNow(); if (!l) return;
    l.italic = !l.italic;
    ui.italicBtn.classList.toggle("active", l.italic);
    fireChange();
  });
  styleRow.append(ui.regBtn, ui.boldBtn, ui.italicBtn);

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
  ui.sizeInput   = inputCell(typoGrid, "Size",    8,  512,   96, 1,   (v) => { const l = layerNow(); if (l) { l.fontSize = v;       fireChange(); }});
  ui.lineInput   = inputCell(typoGrid, "Line",  0.5,    4,  1.2, 0.1, (v) => { const l = layerNow(); if (l) { l.lineHeight = v;     fireChange(); }});
  ui.letterInput = inputCell(typoGrid, "Letter", -10,  50,    0, 0.5, (v) => { const l = layerNow(); if (l) { l.letterSpacing = v;  fireChange(); }});
  ui.opacityInput = inputCell(typoGrid, "Opacity", 0, 100,  100, 1,   (v) => { const l = layerNow(); if (l) { l.opacity = v / 100;  fireChange(); }});
  ui.rotateInput = inputCell(typoGrid, "Rotate", -180, 180,   0, 1,   (v) => { const l = layerNow(); if (l) { l.rotation = v;       fireChange(); }});

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
      const w = layer.weight ?? 400;
      ui.regBtn.classList.toggle("active",  w === 400);
      ui.boldBtn.classList.toggle("active", w === 700);
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
// Layout: [LABEL  value] in a single bordered box.
function inputCell(parent, label, min, max, value, step, onChange) {
  const cell = el("div", "pix-to-input-cell");
  const lbl = el("span", "pix-to-input-label"); lbl.textContent = label;
  const input = document.createElement("input");
  input.type = "number"; input.className = "pix-to-input-val";
  input.min = min; input.max = max; input.value = value; input.step = step;
  cell.append(lbl, input);
  input.addEventListener("input", () => onChange(parseFloat(input.value)));
  input.addEventListener("keydown", (e) => e.stopImmediatePropagation());
  parent.appendChild(cell);
  return {
    el: cell, input,
    setValue(v) { input.value = v; },
    setRange(mn, mx) { input.min = mn; input.max = mx; },
  };
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

    /* Style + Align rows: 3 equal chips */
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
    .pix-to-bold { font-weight: 700; }
    .pix-to-italic-chip { font-style: italic; }
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

    /* Reset button: low-key text link style, full-width, subtle */
    .pix-to-reset-btn {
      margin-top: 4px;
      background: transparent;
      border: none;
      color: #777;
      padding: 6px 0;
      cursor: pointer;
      font: 11px ui-sans-serif, system-ui, sans-serif;
      text-align: center;
    }
    .pix-to-reset-btn:hover { color: ${BRAND}; }

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
