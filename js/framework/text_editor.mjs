// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Text Editor Panel (Load Image visual language)     ║
// ║  Properties UI for ONE text overlay.                         ║
// ║  Mounted twice: on the node body AND in the editor sidebar.  ║
// ║                                                              ║
// ║  Self-contained CSS (no dependency on .pxf-overlay scope)    ║
// ║  so the body panel looks the same as inside the editor.      ║
// ║  Mirrors js/load_image/ui.mjs styling for consistency        ║
// ║  with other Pixaroma nodes (custom dropdowns, orange         ║
// ║  accents, dark #1d1d1d panels, orange-text number inputs).   ║
// ╚═══════════════════════════════════════════════════════════════╝

import { getFontCatalog, loadFontForLayer } from "./fonts.mjs";
import { openPixaromaCompactColorPickerPopup } from "../shared/color_picker.mjs";

const BRAND = "#f66744";

/** Create the text editor panel.
 *  @param {Object} opts
 *  @param {HTMLElement} opts.mount  - container to render into
 *  @param {Function} opts.onChange  - called with (layer) on any property change
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

  // ── TEXT ──
  section("TEXT");
  ui.textArea = el("textarea", "pix-to-textarea");
  ui.textArea.placeholder = "Type your text here...";
  root.appendChild(ui.textArea);
  ui.textArea.addEventListener("input", () => { const l = layerNow(); if (l) l.text = ui.textArea.value; fireChange(); });
  ui.textArea.addEventListener("keydown", (e) => e.stopImmediatePropagation());

  // ── FONT ── (custom Pixaroma dropdown, mirrors openImageDropdown)
  section("FONT");
  ui.fontDropdown = el("div", "pix-to-dropdown");
  ui.fontDropdown.innerHTML = `<span class="name">Inter</span><span class="arrow">▾</span>`;
  ui.fontDropdownName = ui.fontDropdown.querySelector(".name");
  root.appendChild(ui.fontDropdown);
  ui.fontDropdown.addEventListener("click", (e) => {
    e.stopPropagation();
    openFontPopup(ui.fontDropdown, fontCatalog || [], layerNow()?.font || "Inter", (id) => {
      const l = layerNow(); if (!l) return;
      l.font = id;
      ui.fontDropdownName.textContent = labelForFont(fontCatalog, id);
      ui.fontDropdownName.style.fontFamily = `"Pix-${id}", system-ui`;
      fireChange();
    });
  });

  // ── WEIGHT + ITALIC row ──
  // STYLE: Regular / Bold / Italic chips. Reg/Bold are mutex (weight 400 vs 700).
  // Italic is an independent toggle.
  section("STYLE");
  const styleRow = el("div", "pix-to-style-row");
  root.appendChild(styleRow);

  ui.regBtn = el("button", "pix-to-chip");
  ui.regBtn.type = "button";
  ui.regBtn.textContent = "Regular";
  ui.regBtn.addEventListener("click", () => {
    const l = layerNow(); if (!l) return;
    l.weight = 400;
    ui.regBtn.classList.add("active");
    ui.boldBtn.classList.remove("active");
    fireChange();
  });
  styleRow.appendChild(ui.regBtn);

  ui.boldBtn = el("button", "pix-to-chip pix-to-bold");
  ui.boldBtn.type = "button";
  ui.boldBtn.textContent = "Bold";
  ui.boldBtn.addEventListener("click", () => {
    const l = layerNow(); if (!l) return;
    l.weight = 700;
    ui.boldBtn.classList.add("active");
    ui.regBtn.classList.remove("active");
    fireChange();
  });
  styleRow.appendChild(ui.boldBtn);

  ui.italicBtn = el("button", "pix-to-chip pix-to-italic-chip");
  ui.italicBtn.type = "button";
  ui.italicBtn.textContent = "Italic";
  ui.italicBtn.addEventListener("click", () => {
    const l = layerNow(); if (!l) return;
    l.italic = !l.italic;
    ui.italicBtn.classList.toggle("active", l.italic);
    fireChange();
  });
  styleRow.appendChild(ui.italicBtn);

  // ── ALIGN ──
  sectionLabel("ALIGN", root);
  const alignRow = el("div", "pix-to-align-row");
  root.appendChild(alignRow);
  const ALIGN_ICONS = {
    left:   "/pixaroma/assets/icons/ui/align-left.svg",
    center: "/pixaroma/assets/icons/ui/align-center-h.svg",
    right:  "/pixaroma/assets/icons/ui/align-right.svg",
  };
  ui.alignChips = ["left", "center", "right"].map((a) => {
    const b = el("button", "pix-to-chip pix-to-align-chip");
    b.type = "button";
    b.dataset.align = a;
    b.title = `Align ${a}`;
    const img = document.createElement("img");
    img.src = ALIGN_ICONS[a];
    img.alt = a;
    img.draggable = false;
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

  // ── TYPOGRAPHY ──
  section("TYPOGRAPHY");
  ui.sizeSlider = createSlider("Size", 8, 512, 96, 1, (v) => {
    const l = layerNow(); if (l) { l.fontSize = v; fireChange(); }
  });
  root.appendChild(ui.sizeSlider.el);

  ui.lineHeightSlider = createSlider("Line h", 0.5, 4, 1.2, 0.1, (v) => {
    const l = layerNow(); if (l) { l.lineHeight = v; fireChange(); }
  });
  root.appendChild(ui.lineHeightSlider.el);

  ui.letterSpacingSlider = createSlider("Letter sp", -10, 50, 0, 0.5, (v) => {
    const l = layerNow(); if (l) { l.letterSpacing = v; fireChange(); }
  });
  root.appendChild(ui.letterSpacingSlider.el);

  ui.opacitySlider = createSlider("Opacity", 0, 100, 100, 1, (v) => {
    const l = layerNow(); if (l) { l.opacity = v / 100; fireChange(); }
  });
  root.appendChild(ui.opacitySlider.el);

  ui.rotationSlider = createSlider("Rotation", -180, 180, 0, 1, (v) => {
    const l = layerNow(); if (l) { l.rotation = v; fireChange(); }
  });
  root.appendChild(ui.rotationSlider.el);

  // ── COLORS ──
  section("COLORS");
  // Text color row
  const colorRow = el("div", "pix-to-color-row");
  root.appendChild(colorRow);
  const textLbl = el("span", "pix-to-color-label"); textLbl.textContent = "Text"; colorRow.appendChild(textLbl);
  ui.colorSwatch = el("div", "pix-to-color-swatch");
  ui.colorSwatch.addEventListener("click", () => openTextColorPicker(ui.colorSwatch, layerNow()?.color || "#FFFFFF", (c) => {
    const l = layerNow(); if (!l || !c) return;
    l.color = c;
    ui.colorSwatch.style.background = c;
    ui.colorHex.input.value = c;
    fireChange();
  }));
  colorRow.appendChild(ui.colorSwatch);
  ui.colorHex = numericInputWrap(); colorRow.appendChild(ui.colorHex.wrap);
  ui.colorHex.input.value = "#FFFFFF";
  ui.colorHex.input.addEventListener("change", () => {
    const v = ui.colorHex.input.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      const l = layerNow(); if (!l) return;
      l.color = v; ui.colorSwatch.style.background = v; fireChange();
    } else { ui.colorHex.input.value = layerNow()?.color || "#FFFFFF"; }
  });
  ui.colorHex.input.addEventListener("keydown", (e) => e.stopImmediatePropagation());

  // Behind (bg pill) color row
  const bgRow = el("div", "pix-to-color-row");
  root.appendChild(bgRow);
  const bgLbl = el("span", "pix-to-color-label"); bgLbl.textContent = "Behind"; bgRow.appendChild(bgLbl);
  ui.bgSwatch = el("div", "pix-to-color-swatch pix-to-swatch-checker");
  ui.bgSwatch.addEventListener("click", () => openBgColorPicker(ui.bgSwatch, layerNow()?.bgColor || "#000000", (c) => {
    const l = layerNow(); if (!l) return;
    l.bgColor = c;
    if (c) { ui.bgSwatch.style.background = c; ui.bgSwatch.classList.remove("pix-to-swatch-checker"); ui.bgHex.input.value = c; }
    else   { ui.bgSwatch.style.background = ""; ui.bgSwatch.classList.add("pix-to-swatch-checker"); ui.bgHex.input.value = "(none)"; }
    fireChange();
  }));
  bgRow.appendChild(ui.bgSwatch);
  ui.bgHex = numericInputWrap(); bgRow.appendChild(ui.bgHex.wrap);
  ui.bgHex.input.value = "(none)";
  ui.bgHex.input.placeholder = "(none)";
  ui.bgHex.input.addEventListener("change", () => {
    const v = ui.bgHex.input.value.trim();
    const l = layerNow(); if (!l) return;
    if (v === "" || v === "(none)") {
      l.bgColor = null;
      ui.bgSwatch.style.background = ""; ui.bgSwatch.classList.add("pix-to-swatch-checker");
      ui.bgHex.input.value = "(none)";
      fireChange();
    } else if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      l.bgColor = v;
      ui.bgSwatch.style.background = v; ui.bgSwatch.classList.remove("pix-to-swatch-checker");
      fireChange();
    } else { ui.bgHex.input.value = layerNow()?.bgColor || "(none)"; }
  });
  ui.bgHex.input.addEventListener("keydown", (e) => e.stopImmediatePropagation());

  // ── POSITION ──
  section("POSITION");
  ui.posXSlider = createSlider("X", 0, 4096, 0, 1, (v) => {
    const l = layerNow(); if (l) { l.x = v; fireChange(); }
  });
  root.appendChild(ui.posXSlider.el);
  ui.posYSlider = createSlider("Y", 0, 4096, 0, 1, (v) => {
    const l = layerNow(); if (l) { l.y = v; fireChange(); }
  });
  root.appendChild(ui.posYSlider.el);

  // Reset to defaults (caller supplies the actual reset logic so the
  // panel stays decoupled from the node's default-state shape).
  if (onReset) {
    const resetBtn = el("button", "pix-to-reset-btn");
    resetBtn.type = "button";
    resetBtn.textContent = "Reset to defaults";
    resetBtn.title = "Restore all settings to their defaults";
    resetBtn.addEventListener("click", () => {
      const l = layerNow(); if (!l) return;
      onReset(l);
      setLayer(l);
      fireChange();
    });
    root.appendChild(resetBtn);
  }

  // Load font catalog. Used by the custom font popup. Also pre-load each
  // font's primary weight so the popup items render in their own typeface
  // (the popup uses style.fontFamily = "Pix-<id>").
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
      if (!layer) {
        root.classList.add("pix-to-empty");
        return;
      }
      root.classList.remove("pix-to-empty");
      ui.textArea.value = layer.text ?? "";
      const fontId = layer.font ?? "Inter";
      ui.fontDropdownName.textContent = labelForFont(fontCatalog, fontId);
      ui.fontDropdownName.style.fontFamily = `"Pix-${fontId}", system-ui`;
      const w = layer.weight ?? 400;
      ui.regBtn.classList.toggle("active", w === 400);
      ui.boldBtn.classList.toggle("active", w === 700);
      ui.italicBtn.classList.toggle("active", !!layer.italic);
      ui.alignChips.forEach((c) => c.classList.toggle("active", c.dataset.align === (layer.align ?? "center")));
      ui.sizeSlider.setValue(layer.fontSize ?? 96);
      ui.lineHeightSlider.setValue(layer.lineHeight ?? 1.2);
      ui.letterSpacingSlider.setValue(layer.letterSpacing ?? 0);
      ui.opacitySlider.setValue(Math.round((layer.opacity ?? 1) * 100));
      ui.rotationSlider.setValue(layer.rotation ?? 0);
      ui.posXSlider.setValue(layer.x ?? 0);
      ui.posYSlider.setValue(layer.y ?? 0);
      ui.colorSwatch.style.background = layer.color ?? "#FFFFFF";
      ui.colorHex.input.value = layer.color ?? "#FFFFFF";
      if (layer.bgColor) {
        ui.bgSwatch.style.background = layer.bgColor;
        ui.bgSwatch.classList.remove("pix-to-swatch-checker");
        ui.bgHex.input.value = layer.bgColor;
      } else {
        ui.bgSwatch.style.background = "";
        ui.bgSwatch.classList.add("pix-to-swatch-checker");
        ui.bgHex.input.value = "(none)";
      }
    } finally {
      suspendChange = false;
    }
  }

  /** Set position slider ranges based on the canvas dimensions. */
  function setCanvasBounds(canvasWidth, canvasHeight) {
    ui.posXSlider.setRange(-canvasWidth, canvasWidth * 2);
    ui.posYSlider.setRange(-canvasHeight, canvasHeight * 2);
  }

  function destroy() { root.remove(); }

  function section(text) {
    const h = document.createElement("div");
    h.className = "pix-to-section";
    h.textContent = text;
    root.appendChild(h);
  }

  return { setLayer, setCanvasBounds, destroy };
}

// ── stateless helpers ─────────────────────────────────────────────────────────

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function sectionLabel(text, parent) {
  const l = el("div", "pix-to-sublabel");
  l.textContent = text;
  if (parent) parent.appendChild(l);
  return l;
}

// Compact swatch-grid picker (Note Pixaroma pattern): closes immediately
// on pick, has a "More colors..." footer that opens a full HSV modal,
// and a Reset button that returns to the supplied default color.
function openTextColorPicker(swatchEl, initialColor, onPick) {
  openPixaromaCompactColorPickerPopup(swatchEl, {
    initialColor,
    showClear: false,           // text always has a colour
    resetColor: "#FFFFFF",       // Reset returns to default white
    onPick,
  });
}

function openBgColorPicker(swatchEl, initialColor, onPick) {
  openPixaromaCompactColorPickerPopup(swatchEl, {
    initialColor,
    showClear: true,            // transparent tile = no pill
    clearPosition: "last",
    resetColor: null,            // Reset returns to no-pill
    onPick,
  });
}

function labelForFont(catalog, id) {
  if (!catalog) return id || "Inter";
  const f = catalog.find((x) => x.id === id);
  return f?.label || id || "Inter";
}

// Pixaroma-style slider row: label, range, numeric box on the right.
// Matches the Load Image numeric-input visual language (orange text,
// dark bg, no native browser chrome).
function createSlider(label, min, max, value, step, onChange) {
  const row = el("div", "pix-to-slider-row");
  const lbl = el("div", "pix-to-slider-label"); lbl.textContent = label; row.appendChild(lbl);
  const slider = document.createElement("input");
  slider.type = "range"; slider.className = "pix-to-slider";
  slider.min = min; slider.max = max; slider.value = value; slider.step = step;
  row.appendChild(slider);
  const num = document.createElement("input");
  num.type = "number"; num.className = "pix-to-num";
  num.min = min; num.max = max; num.value = value; num.step = step;
  row.appendChild(num);
  // Set the --pix-to-fill CSS var so the linear-gradient track shows
  // orange to the left of the thumb and grey to the right. Re-compute
  // on every value change so the fill follows the thumb.
  function syncFill() {
    const mn = parseFloat(slider.min) || 0;
    const mx = parseFloat(slider.max) || 100;
    const v  = parseFloat(slider.value) || 0;
    const pct = ((v - mn) / (mx - mn || 1)) * 100;
    slider.style.setProperty("--pix-to-fill", pct + "%");
  }
  syncFill();
  slider.addEventListener("input", () => { num.value = slider.value; syncFill(); onChange(parseFloat(slider.value)); });
  num.addEventListener("input", () => { slider.value = num.value; syncFill(); onChange(parseFloat(num.value)); });
  num.addEventListener("keydown", (e) => e.stopImmediatePropagation());
  return {
    el: row, slider, num,
    setValue(v) { slider.value = v; num.value = v; syncFill(); },
    setRange(mn, mx) { slider.min = mn; slider.max = mx; num.min = mn; num.max = mx; syncFill(); },
  };
}

// Numeric/text input wrapped in a Pixaroma-style bordered box (matches
// .pix-li-numinput). Returns { wrap, input }.
function numericInputWrap() {
  const wrap = el("div", "pix-to-numinput");
  const input = document.createElement("input");
  input.type = "text";
  wrap.appendChild(input);
  return { wrap, input };
}

// ── Custom dropdown popups (mirror openImageDropdown / openResamplePopup) ──

function openFontPopup(anchorEl, catalog, currentId, onPick) {
  // Close any existing popup
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
// pattern #14: mousedown/pointerdown/wheel/Esc all capture-phase, and the
// wheel listener MUST gate on !popup.contains so users can scroll the
// list without it closing.
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
      gap: 6px;
    }
    .pix-to-root * { box-sizing: border-box; }
    .pix-to-empty::after { content:"Select a layer to edit"; color:#666; font-style:italic; }

    .pix-to-section {
      font: 600 9px ui-sans-serif, system-ui, sans-serif;
      color: ${BRAND};
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 6px;
      margin-bottom: 2px;
    }
    .pix-to-sublabel {
      font: 9px ui-sans-serif, system-ui, sans-serif;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 3px;
    }

    .pix-to-textarea {
      width: 100%;
      background: #1d1d1d;
      color: #fff;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 8px;
      font: 12px ui-sans-serif, system-ui, sans-serif;
      resize: vertical;
      min-height: 48px;
    }
    .pix-to-textarea:focus { outline: none; border-color: ${BRAND}; }

    .pix-to-dropdown {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 8px;
      font: 11px ui-sans-serif, system-ui, sans-serif;
      color: #ccc;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
    }
    .pix-to-dropdown:hover { border-color: #666; }
    .pix-to-dropdown .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pix-to-dropdown .arrow { color: ${BRAND}; font-size: 10px; margin-left: 6px; }

    /* STYLE + ALIGN rows: 3-up chip grids */
    .pix-to-style-row,
    .pix-to-align-row {
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
      padding: 6px 0;
      font: 600 11px ui-sans-serif, system-ui, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 28px;
    }
    .pix-to-chip:hover { border-color: #666; color: #ddd; }
    .pix-to-chip.active { background: ${BRAND}; color: #fff; border-color: ${BRAND}; }
    /* Style chips: render their own label in matching weight/style so the
       button visually previews what it does (Bold is bold, Italic is italic). */
    .pix-to-bold { font-weight: 700; }
    .pix-to-italic-chip { font-style: italic; }

    .pix-to-align-chip img {
      width: 14px; height: 14px;
      pointer-events: none;
      filter: brightness(0) saturate(100%) invert(75%);
    }
    .pix-to-align-chip.active img { filter: brightness(0) invert(1); }

    /* Reset button at the bottom of the panel — subtle, not prominent. */
    .pix-to-reset-btn {
      margin-top: 8px;
      background: transparent;
      border: 1px dashed #444;
      border-radius: 4px;
      color: #888;
      padding: 6px 8px;
      cursor: pointer;
      font: 11px ui-sans-serif, system-ui, sans-serif;
      align-self: stretch;
    }
    .pix-to-reset-btn:hover { color: ${BRAND}; border-color: ${BRAND}; }

    /* Slider row: label | range | numeric box */
    .pix-to-slider-row {
      display: grid;
      grid-template-columns: 56px 1fr 56px;
      gap: 6px;
      align-items: center;
    }
    .pix-to-slider-label {
      font: 10px ui-sans-serif, system-ui, sans-serif;
      color: #888;
    }
    /* Explicit cross-browser slider styling so the node body and the
       editor sidebar look IDENTICAL. accent-color alone made the thumb
       size depend on parent font-size, causing visible drift. */
    .pix-to-slider {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 4px;
      background: linear-gradient(to right,
        ${BRAND} 0%, ${BRAND} var(--pix-to-fill, 50%),
        #3a3a3a var(--pix-to-fill, 50%), #3a3a3a 100%);
      border-radius: 2px;
      outline: none;
      margin: 0;
      padding: 0;
      cursor: pointer;
    }
    .pix-to-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: ${BRAND};
      cursor: pointer;
      border: 2px solid #2a2a2a;
      box-shadow: 0 0 0 1px ${BRAND};
    }
    .pix-to-slider::-moz-range-thumb {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: ${BRAND};
      cursor: pointer;
      border: 2px solid #2a2a2a;
      box-shadow: 0 0 0 1px ${BRAND};
    }
    .pix-to-slider::-moz-range-track {
      background: transparent;
      border: none;
    }
    .pix-to-num {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 3px 4px;
      color: ${BRAND};
      font: 600 11px ui-sans-serif, system-ui, sans-serif;
      text-align: center;
      width: 100%;
      -moz-appearance: textfield;
    }
    .pix-to-num::-webkit-outer-spin-button,
    .pix-to-num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .pix-to-num:focus { outline: none; border-color: ${BRAND}; }

    /* COLORS rows */
    .pix-to-color-row { display: flex; gap: 6px; align-items: center; }
    .pix-to-color-label {
      font: 10px ui-sans-serif, system-ui, sans-serif;
      color: #888;
      width: 42px;
      flex-shrink: 0;
    }
    .pix-to-color-swatch {
      width: 28px; height: 28px;
      border-radius: 4px;
      border: 1px solid #444;
      cursor: pointer;
      flex: 0 0 28px;
      background: #fff;
    }
    .pix-to-color-swatch:hover { border-color: ${BRAND}; }
    .pix-to-swatch-checker {
      background: repeating-conic-gradient(#333 0% 25%, #444 0% 50%) 0 0 / 8px 8px !important;
    }

    .pix-to-numinput {
      display: flex;
      flex: 1;
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      overflow: hidden;
    }
    .pix-to-numinput:focus-within { border-color: ${BRAND}; }
    .pix-to-numinput input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      padding: 4px 6px;
      color: ${BRAND};
      font: 600 11px ui-sans-serif, system-ui, sans-serif;
      text-align: center;
      width: 100%;
    }

    /* Custom dropdown popup (positioned via body) */
    .pix-to-popup {
      position: fixed;
      z-index: 99999;
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      font: 12px ui-sans-serif, system-ui, sans-serif;
      color: #ccc;
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
    .pix-to-popup-sep {
      height: 1px;
      background: #333;
      margin: 4px 0;
    }
  `;
  document.head.appendChild(s);
}
