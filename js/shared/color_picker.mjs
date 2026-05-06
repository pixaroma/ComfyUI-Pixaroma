// Pixaroma Color Picker — reusable inline HSV + swatch + hex picker.
//
// Exposes:
//   - createPixaromaColorPicker(opts) → { element, getColor, setColor, destroy }
//       Inline component you append into any container.
//   - openPixaromaColorPickerPopup(anchorEl, opts)
//       Standalone popup (drop-in replacement for the old openColorPop).
//   - PIXAROMA_PALETTE — the 36-color default swatch grid.
//
// Components from top to bottom:
//   - 12-col swatch grid (3 rows of 12 = 36 colors). When `showClear`
//     is true, the FIRST tile is a checker-pattern "Transparent" tile
//     that yields `null` (= inherit / no color).
//   - Saturation × Value plane (canvas, drag to pick S+V).
//   - Vertical hue strip on the right (canvas, drag to pick H).
//   - Hex input + Reset button.
//
// All four input paths (swatch / SV / hue / hex) stay synced via
// shared state. Custom-painted on <canvas> so there is no native
// browser color-picker dialog (which opens a popup-over-popup and
// covers other UI in tight overlays).
//
// "Pixaroma Color Picker" — see `feedback_pixaroma_color_picker.md`
// in the user's memory dir.

import { BRAND } from "./utils.mjs";

// ── Default 36-color palette ───────────────────────────────────────
export const PIXAROMA_PALETTE = [
  // Row 1: neutrals (white → black ramp)
  "#ffffff","#e6e6e6","#cccccc","#b3b3b3","#999999","#808080",
  "#666666","#4d4d4d","#333333","#1a1a1a","#0a0a0a","#000000",
  // Row 2: vibrants across the hue spectrum
  "#ff5555","#ff8c42","#ffd166","#a3e635","#4ade80","#22d3ee",
  "#5a8cff","#818cf8","#c075f6","#f472b6","#ec4899","#f66744",
  // Row 3: muted / earth tones for accent variety
  "#7c2d12","#a16207","#65a30d","#0e7490","#1e40af","#581c87",
  "#a16d3a","#b08968","#ddb892","#a07e6a","#5a4634","#2c2620",
];

// ── HSV ↔ hex math ────────────────────────────────────────────────
function hexToHsv(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || "");
  if (!m) return { h: 0, s: 0, v: 1 };
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
function hsvToHex(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  const to8 = (n) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return "#" + to8(r) + to8(g) + to8(b);
}

// ── One-time CSS injection ────────────────────────────────────────
let _cssInjected = false;
function ensureCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement("style");
  s.id = "pixaroma-color-picker-css";
  s.textContent = `
.pix-cp {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
}
.pix-cp-swatches {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 3px;
  width: 100%;
}
.pix-cp-tile {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  cursor: pointer;
  padding: 0;
  box-sizing: border-box;
}
.pix-cp-tile.selected {
  outline: 2px solid ${BRAND};
  outline-offset: 1px;
}
.pix-cp-tile-clear {
  background:
    linear-gradient(45deg, transparent 45%, #d33 45%, #d33 55%, transparent 55%),
    repeating-conic-gradient(#888 0 25%, #444 0 50%) 50%/8px 8px;
}
.pix-cp-sv-row {
  display: flex;
  gap: 6px;
  align-items: stretch;
}
.pix-cp-sv {
  border: 1px solid #444;
  border-radius: 3px;
  cursor: crosshair;
  display: block;
  flex: 1 1 auto;
  width: 100%;
  height: 80px;
}
.pix-cp-hue {
  border: 1px solid #444;
  border-radius: 3px;
  cursor: ns-resize;
  display: block;
  flex: 0 0 auto;
}
.pix-cp-hexrow {
  display: flex;
  gap: 6px;
  align-items: center;
}
.pix-cp-hex {
  flex: 1 1 auto;
  min-width: 0;
  height: 22px;
  box-sizing: border-box;
  background: #1a1a1a;
  border: 1px solid #444;
  color: #ddd;
  padding: 0 6px;
  font-size: 11px;
  font-family: "Consolas", monospace;
  border-radius: 3px;
}
.pix-cp-hex:focus {
  outline: none;
  border-color: ${BRAND};
}
.pix-cp-reset {
  flex: 0 0 auto;
  height: 22px;
  padding: 0 10px;
  background: transparent;
  border: 1px solid #444;
  color: #999;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  font-family: "Segoe UI", system-ui, sans-serif;
}
.pix-cp-reset:hover {
  color: ${BRAND};
  border-color: ${BRAND};
}

.pix-cp-popup {
  position: absolute;
  z-index: 100000;
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 5px;
  padding: 8px;
  box-shadow: 0 6px 18px rgba(0,0,0,.5);
  width: 248px;
  box-sizing: border-box;
}

/* Compact popup — swatches + Reset / More-colors row only. Used by the
   text and highlight pickers in the Note editor. Excel-style apply-on-
   click avoids the multi-fire onPick storms that SV-drag triggers. */
.pix-cp-compact-footer {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.pix-cp-compact-footer .pix-cp-reset {
  flex: 0 0 auto;
}
.pix-cp-more-btn {
  flex: 1 1 auto;
  height: 22px;
  padding: 0 10px;
  background: transparent;
  border: 1px solid #444;
  color: #999;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  font-family: "Segoe UI", system-ui, sans-serif;
}
.pix-cp-more-btn:hover {
  color: ${BRAND};
  border-color: ${BRAND};
}

/* "More colors" modal — full SV / hue / hex picker with OK / Cancel.
   Higher z-index than the picker popup so it stacks above. */
.pix-cp-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 100001;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pix-cp-modal-box {
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 6px;
  padding: 14px;
  box-shadow: 0 8px 24px rgba(0,0,0,.6);
  width: 280px;
  box-sizing: border-box;
}
.pix-cp-modal-title {
  color: #ddd;
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 10px;
}
.pix-cp-modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
}
.pix-cp-modal-btn {
  height: 28px;
  padding: 0 14px;
  background: transparent;
  border: 1px solid #444;
  color: #ddd;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  font-family: "Segoe UI", system-ui, sans-serif;
}
.pix-cp-modal-btn:hover {
  color: ${BRAND};
  border-color: ${BRAND};
}
.pix-cp-modal-btn.primary {
  background: ${BRAND};
  border-color: ${BRAND};
  color: #fff;
}
.pix-cp-modal-btn.primary:hover {
  background: #d54f2c;
  border-color: #d54f2c;
  color: #fff;
}
`;
  document.head.appendChild(s);
}

// ── Inline component ──────────────────────────────────────────────
//
// opts:
//   initialColor: hex string | null (null only valid when showClear)
//   swatches: array of hex strings (default PIXAROMA_PALETTE)
//   showClear: bool — first swatch becomes a "transparent" checker tile
//   resetColor: hex string returned by Reset button (default "#f66744")
//   onChange: (color | null) => void — fires on every interaction
//
// returns: { element, getColor, setColor, destroy }
//   element  — root DOM node, append wherever you want
//   getColor — () => current color (hex or null)
//   setColor — (color) => programmatic update
//   destroy  — () => detaches window listeners, removes element
export function createPixaromaColorPicker(opts = {}) {
  ensureCSS();
  const {
    initialColor = "#f66744",
    swatches     = PIXAROMA_PALETTE,
    showClear    = false,
    resetColor   = "#f66744",
    onChange     = () => {},
    hideReset    = false,
  } = opts;

  // ── State ────────────────────────────────────────────────────────
  let curColor = initialColor === null ? null : initialColor;
  let curHsv   = hexToHsv(curColor || resetColor);

  // ── Root ────────────────────────────────────────────────────────
  const root = document.createElement("div");
  root.className = "pix-cp";

  // ── Swatches (with optional Clear / transparent tile) ───────────
  const swatchGrid = document.createElement("div");
  swatchGrid.className = "pix-cp-swatches";

  /** @type {{tile: HTMLElement, hex: string|null}[]} */
  const swatchTiles = [];

  if (showClear) {
    const clearTile = document.createElement("button");
    clearTile.type = "button";
    clearTile.className = "pix-cp-tile pix-cp-tile-clear";
    clearTile.title = "Transparent / clear color";
    clearTile.addEventListener("mousedown", (e) => e.preventDefault());
    clearTile.addEventListener("click", (e) => {
      e.stopPropagation();
      curColor = null;
      refresh();
      onChange(null);
    });
    swatchGrid.appendChild(clearTile);
    swatchTiles.push({ tile: clearTile, hex: null });
  }

  for (const hex of swatches) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "pix-cp-tile";
    tile.style.background = hex;
    tile.title = hex;
    tile.addEventListener("mousedown", (e) => e.preventDefault());
    tile.addEventListener("click", (e) => {
      e.stopPropagation();
      curColor = hex;
      curHsv = hexToHsv(hex);
      refresh();
      onChange(hex);
    });
    swatchGrid.appendChild(tile);
    swatchTiles.push({ tile, hex });
  }
  // Skip the swatch row entirely when nothing would render — used by the
  // "More colors" modal which passes `swatches: []` + `showClear: false`
  // to show only the SV / hue / hex picker.
  if (showClear || swatches.length > 0) {
    root.appendChild(swatchGrid);
  }

  // ── SV plane + Hue strip ────────────────────────────────────────
  const svRow = document.createElement("div");
  svRow.className = "pix-cp-sv-row";

  const svCanvas = document.createElement("canvas");
  svCanvas.width  = 168;
  svCanvas.height = 80;
  svCanvas.className = "pix-cp-sv";

  const hueCanvas = document.createElement("canvas");
  hueCanvas.width  = 14;
  hueCanvas.height = 80;
  hueCanvas.className = "pix-cp-hue";

  svRow.appendChild(svCanvas);
  svRow.appendChild(hueCanvas);
  root.appendChild(svRow);

  function renderSV() {
    const cssW = svCanvas.clientWidth || svCanvas.width;
    if (cssW > 0 && svCanvas.width !== cssW) svCanvas.width = cssW;
    const ctx = svCanvas.getContext("2d");
    const w = svCanvas.width, h = svCanvas.height;
    const hueHex = hsvToHex(curHsv.h, 1, 1);
    const g1 = ctx.createLinearGradient(0, 0, w, 0);
    g1.addColorStop(0, "#ffffff");
    g1.addColorStop(1, hueHex);
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);
    const g2 = ctx.createLinearGradient(0, 0, 0, h);
    g2.addColorStop(0, "rgba(0,0,0,0)");
    g2.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
    if (curColor !== null) {
      const mx = curHsv.s * w;
      const my = (1 - curHsv.v) * h;
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  function renderHue() {
    const ctx = hueCanvas.getContext("2d");
    const w = hueCanvas.width, h = hueCanvas.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    for (let i = 0; i <= 6; i++) {
      grad.addColorStop(i / 6, hsvToHex((i / 6) * 360, 1, 1));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    if (curColor !== null) {
      const my = (curHsv.h / 360) * h;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, my - 1.5, w, 3);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, my - 0.5, w, 1);
    }
  }

  let dragging = null;
  const onSV = (e) => {
    const r = svCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(svCanvas.width,  e.clientX - r.left));
    const y = Math.max(0, Math.min(svCanvas.height, e.clientY - r.top));
    curHsv.s = x / svCanvas.width;
    curHsv.v = 1 - y / svCanvas.height;
    curColor = hsvToHex(curHsv.h, curHsv.s, curHsv.v);
    refresh();
    onChange(curColor);
  };
  const onHue = (e) => {
    const r = hueCanvas.getBoundingClientRect();
    const y = Math.max(0, Math.min(hueCanvas.height, e.clientY - r.top));
    curHsv.h = (y / hueCanvas.height) * 360;
    curColor = hsvToHex(curHsv.h, curHsv.s, curHsv.v);
    refresh();
    onChange(curColor);
  };
  svCanvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = "sv";
    onSV(e);
  });
  hueCanvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = "hue";
    onHue(e);
  });
  const onWinMove = (e) => {
    if (dragging === "sv") onSV(e);
    else if (dragging === "hue") onHue(e);
  };
  const onWinUp = () => { dragging = null; };
  window.addEventListener("mousemove", onWinMove);
  window.addEventListener("mouseup", onWinUp);

  // ── Hex row + Reset ─────────────────────────────────────────────
  const hexRow = document.createElement("div");
  hexRow.className = "pix-cp-hexrow";

  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.className = "pix-cp-hex";
  hexInput.placeholder = "#rrggbb";
  hexInput.spellcheck = false;
  hexInput.value = curColor || "";
  hexInput.addEventListener("mousedown", (e) => e.stopPropagation());
  hexInput.oninput = () => {
    const v = hexInput.value.startsWith("#") ? hexInput.value : `#${hexInput.value}`;
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      curColor = v;
      curHsv = hexToHsv(v);
      refreshSelectionRing();
      renderSV();
      renderHue();
      onChange(v);
    }
  };
  hexRow.appendChild(hexInput);

  // Reset button — opt-out via `hideReset` for callers that supply
  // their own action row (e.g. the "More colors..." modal which uses
  // OK / Cancel buttons instead).
  if (!hideReset) {
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "pix-cp-reset";
    resetBtn.title = resetColor === null ? "Clear color" : `Reset to ${resetColor}`;
    resetBtn.textContent = "Reset";
    resetBtn.addEventListener("mousedown", (e) => e.preventDefault());
    resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      curColor = resetColor;
      // hexToHsv tolerates null but returns {h:0,s:0,v:1}; only update
      // HSV when we actually have a hex so the SV/hue tracker doesn't
      // jump to a meaningless red-corner position on null reset.
      if (resetColor !== null) curHsv = hexToHsv(resetColor);
      refresh();
      onChange(resetColor);
    });
    hexRow.appendChild(resetBtn);
  }

  root.appendChild(hexRow);

  // ── Refresh helpers ─────────────────────────────────────────────
  function refreshSelectionRing() {
    for (const { tile, hex } of swatchTiles) {
      const isCur =
        (curColor === null && hex === null) ||
        (curColor !== null && hex !== null &&
         hex.toLowerCase() === curColor.toLowerCase());
      tile.classList.toggle("selected", isCur);
    }
  }
  function refresh() {
    refreshSelectionRing();
    hexInput.value = curColor || "";
    renderSV();
    renderHue();
  }

  // Defer initial canvas paint until the element is in the DOM (so
  // svCanvas.clientWidth is meaningful and the SV marker stays
  // circular). The caller owns DOM insertion, so we use a microtask
  // that runs after the synchronous append in the typical flow.
  queueMicrotask(() => {
    refresh();
  });

  // Initial state: highlight the matching tile if any.
  refreshSelectionRing();

  // ── Public API ──────────────────────────────────────────────────
  return {
    element: root,
    getColor: () => curColor,
    setColor: (c) => {
      // null means "transparent / inherit" - only valid when the
      // picker was created with showClear: true. Ignore null otherwise
      // so the internal HSV state stays consistent with curColor.
      if (c === null && !showClear) return;
      curColor = c;
      if (c !== null) curHsv = hexToHsv(c);
      refresh();
    },
    destroy: () => {
      window.removeEventListener("mousemove", onWinMove);
      window.removeEventListener("mouseup", onWinUp);
      root.remove();
    },
  };
}

// ── Standalone popup wrapper ──────────────────────────────────────
//
// Drop-in replacement for the old openColorPop in toolbar.mjs. Builds
// a positioned popup at anchorEl's bottom and dismisses on outside
// click. onPick is called on every change (live preview).
//
// opts:
//   initialColor: hex | null
//   swatches:     array (default PIXAROMA_PALETTE)
//   showClear:    bool
//   resetColor:   hex (default "#f66744")
//   onPick:       (color | null) => void
export function openPixaromaColorPickerPopup(anchorEl, opts = {}) {
  ensureCSS();
  const popup = document.createElement("div");
  popup.className = "pix-cp-popup";
  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = `${rect.left}px`;
  popup.style.top  = `${rect.bottom + 4}px`;

  const picker = createPixaromaColorPicker({
    // Preserve an explicit null (means "no color picked yet → highlight
    // the Clear tile if showClear, else no swatch selected"). `??`
    // would coerce null → BRAND, breaking the "no pick" state for
    // text/highlight pickers.
    initialColor: "initialColor" in opts ? opts.initialColor : "#f66744",
    swatches:     opts.swatches,
    showClear:    !!opts.showClear,
    // Same `in opts` check as initialColor — preserve explicit null so
    // the Reset button can mean "clear back to no-color" for callers
    // that opt in (e.g. highlight picker → transparent on Reset).
    resetColor:   "resetColor" in opts ? opts.resetColor : "#f66744",
    onChange:     opts.onPick || (() => {}),
  });
  popup.appendChild(picker.element);
  document.body.appendChild(popup);

  const onDocDown = (e) => {
    if (!popup.contains(e.target) && e.target !== anchorEl) close();
  };
  function close() {
    document.removeEventListener("mousedown", onDocDown, true);
    picker.destroy();
    if (popup.parentNode) popup.remove();
  }
  // Defer attach by one tick so the click that opened us doesn't
  // immediately close us.
  setTimeout(() => document.addEventListener("mousedown", onDocDown, true), 0);

  return { close, getColor: picker.getColor, setColor: picker.setColor };
}

// ── Compact popup ────────────────────────────────────────────────
//
// Excel-style: swatches grid + Reset + "More colors..." footer. Each
// swatch / Reset click fires `onPick(c)` ONCE and closes the popup
// immediately — no SV-drag, no live preview, no multi-fire onPick
// storms. Used by the Note editor's text and highlight pickers, where
// the apply-once-and-done flow plays nicely with sticky stage state.
//
// "More colors..." closes the popup and opens openMoreColorsModal —
// a centered modal with a full SV / hue / hex picker plus OK / Cancel
// buttons. OK fires `onPick` with the current color; Cancel does
// nothing.
//
// opts:
//   initialColor: hex | null  — used to ring the matching swatch
//   swatches:     array (default PIXAROMA_PALETTE)
//   showClear:    bool — first tile becomes a transparent / clear tile
//   resetColor:   hex | null  — what Reset fires on click
//   onPick:       (color | null) => void
export function openPixaromaCompactColorPickerPopup(anchorEl, opts = {}) {
  ensureCSS();

  const swatches    = opts.swatches    ?? PIXAROMA_PALETTE;
  const showClear   = !!opts.showClear;
  const resetColor  = "resetColor"  in opts ? opts.resetColor  : "#f66744";
  const initialColor = "initialColor" in opts ? opts.initialColor : null;
  const onPick      = opts.onPick || (() => {});

  const popup = document.createElement("div");
  popup.className = "pix-cp-popup";
  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = `${rect.left}px`;
  popup.style.top  = `${rect.bottom + 4}px`;

  // Track open state so the "More colors..." path can close synchronously
  // without racing with the document mousedown listener.
  let isOpen = true;
  function close() {
    if (!isOpen) return;
    isOpen = false;
    document.removeEventListener("mousedown", onDocDown, true);
    if (popup.parentNode) popup.remove();
  }

  const swatchGrid = document.createElement("div");
  swatchGrid.className = "pix-cp-swatches";

  const isCurMatch = (hex) =>
    (initialColor === null && hex === null) ||
    (initialColor !== null && hex !== null &&
      hex.toLowerCase() === initialColor.toLowerCase());

  if (showClear) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "pix-cp-tile pix-cp-tile-clear";
    tile.title = "Transparent / clear color";
    if (isCurMatch(null)) tile.classList.add("selected");
    tile.addEventListener("mousedown", (e) => e.preventDefault());
    tile.addEventListener("click", (e) => {
      e.stopPropagation();
      onPick(null);
      close();
    });
    swatchGrid.appendChild(tile);
  }

  for (const hex of swatches) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "pix-cp-tile";
    tile.style.background = hex;
    tile.title = hex;
    if (isCurMatch(hex)) tile.classList.add("selected");
    tile.addEventListener("mousedown", (e) => e.preventDefault());
    tile.addEventListener("click", (e) => {
      e.stopPropagation();
      onPick(hex);
      close();
    });
    swatchGrid.appendChild(tile);
  }
  popup.appendChild(swatchGrid);

  // Footer: Reset + More colors... (Reset gets resetColor — which can
  // be null so the highlight picker's Reset routes through the same
  // null branch as the transparent tile).
  const footer = document.createElement("div");
  footer.className = "pix-cp-compact-footer";

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "pix-cp-reset";
  resetBtn.title = resetColor === null ? "Clear color" : `Reset to ${resetColor}`;
  resetBtn.textContent = "Reset";
  resetBtn.addEventListener("mousedown", (e) => e.preventDefault());
  resetBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    onPick(resetColor);
    close();
  });
  footer.appendChild(resetBtn);

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "pix-cp-more-btn";
  moreBtn.textContent = "More colors...";
  moreBtn.addEventListener("mousedown", (e) => e.preventDefault());
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
    openMoreColorsModal({
      // Seed the modal with whatever's already picked (so the user's
      // fine-tuning starts from their current colour, not BRAND).
      initialColor: initialColor ?? (resetColor !== null ? resetColor : "#f66744"),
      onPick,
    });
  });
  footer.appendChild(moreBtn);
  popup.appendChild(footer);

  document.body.appendChild(popup);

  const onDocDown = (e) => {
    if (!popup.contains(e.target) && e.target !== anchorEl) close();
  };
  setTimeout(() => document.addEventListener("mousedown", onDocDown, true), 0);

  return { close };
}

// ── "More colors..." modal ───────────────────────────────────────
//
// Centered modal with full SV / hue / hex picker + OK / Cancel.
// OK fires `opts.onPick(currentHex)` and closes; Cancel just closes.
// Esc cancels (window-capture so it preempts the editor's overlay
// keydown handler — Note editor's `_keyBlock` already returns early
// when `.pix-cp-modal-backdrop` is in the DOM, see Pattern #27).
function openMoreColorsModal(opts) {
  ensureCSS();

  const backdrop = document.createElement("div");
  backdrop.className = "pix-cp-modal-backdrop";

  const box = document.createElement("div");
  box.className = "pix-cp-modal-box";

  const title = document.createElement("div");
  title.className = "pix-cp-modal-title";
  title.textContent = "Pick a color";
  box.appendChild(title);

  let pickedColor = opts.initialColor ?? "#f66744";
  const picker = createPixaromaColorPicker({
    initialColor: pickedColor,
    swatches: [],
    showClear: false,
    hideReset: true,
    onChange: (c) => { if (c !== null) pickedColor = c; },
  });
  box.appendChild(picker.element);

  const actions = document.createElement("div");
  actions.className = "pix-cp-modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "pix-cp-modal-btn";
  cancelBtn.textContent = "Cancel";

  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.className = "pix-cp-modal-btn primary";
  okBtn.textContent = "OK";

  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);
  box.appendChild(actions);

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  function close() {
    window.removeEventListener("keydown", onKey, true);
    picker.destroy();
    if (backdrop.parentNode) backdrop.remove();
  }

  okBtn.addEventListener("click", () => {
    if (pickedColor != null) opts.onPick(pickedColor);
    close();
  });
  cancelBtn.addEventListener("click", close);

  // Click outside the box (on the backdrop itself) cancels.
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  // Esc cancels. Use window-capture + stopImmediatePropagation so any
  // editor-level Esc handler attached after this listener is preempted
  // (Vue-compat #6 territory). The Note editor's `_keyBlock` checks
  // for an open `.pix-cp-modal-backdrop` and returns early, so this
  // also works without the stop.
  function onKey(e) {
    if (e.key === "Escape") {
      e.stopImmediatePropagation();
      e.preventDefault();
      close();
    }
  }
  window.addEventListener("keydown", onKey, true);
}
