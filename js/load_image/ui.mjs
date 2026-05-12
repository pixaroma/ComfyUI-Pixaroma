import { BRAND } from "../shared/index.mjs";

let _cssInjected = false;

export function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const css = `
    .pix-li-root {
      width: 100%;
      box-sizing: border-box;
      padding: 8px;
      background: #2a2a2a;
      border-radius: 4px;
      color: #ddd;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .pix-li-upload-btn {
      width: 100%;
      background: ${BRAND};
      border: none;
      border-radius: 4px;
      padding: 9px 8px;
      font-size: 11px;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      font-family: inherit;
      transition: background 0.08s;
    }
    .pix-li-upload-btn:hover { background: #ff7e5a; }
    .pix-li-upload-btn .ico {
      width: 14px; height: 14px;
      background-color: currentColor;
      -webkit-mask: url("/pixaroma/assets/icons/ui/upload.svg") center/14px 14px no-repeat;
              mask: url("/pixaroma/assets/icons/ui/upload.svg") center/14px 14px no-repeat;
    }
    .pix-li-hint {
      font-size: 9px;
      color: #777;
      text-align: center;
      letter-spacing: 0.3px;
      margin-top: -3px;
    }
    .pix-li-hint kbd {
      color: #aaa;
      font-family: inherit;
      background: transparent;
      padding: 0;
    }
    .pix-li-dropdown {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 11px;
      color: #ccc;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
    }
    .pix-li-dropdown:hover { border-color: #666; }
    .pix-li-dropdown .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pix-li-dropdown .arrow { color: ${BRAND}; font-size: 10px; margin-left: 6px; }
    /* Drag-over highlight — applied to .pix-li-root */
    .pix-li-root.drag-over { box-shadow: 0 0 0 2px ${BRAND}, 0 0 24px rgba(246,103,68,0.4); }
    /* Drop overlay shown during drag */
    .pix-li-drop-overlay {
      position: absolute;
      inset: 0;
      background: rgba(246,103,68,0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
      backdrop-filter: blur(2px);
      z-index: 2;
      display: none;
    }
    .pix-li-root.drag-over .pix-li-drop-overlay { display: flex; }
    .pix-li-drop-overlay .icon { font-size: 32px; color: ${BRAND}; }
    .pix-li-drop-overlay .label { font-size: 13px; color: ${BRAND}; font-weight: 600; }
    .pix-li-chips {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 3px;
    }
    .pix-li-chip {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 4px;
      text-align: center;
      font-size: 10px;
      color: #ccc;
      cursor: pointer;
      user-select: none;
      transition: background 0.08s, border-color 0.08s;
    }
    .pix-li-chip:hover { border-color: #666; }
    .pix-li-chip.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }
    .pix-li-chip.span-full { grid-column: span 2; }
    .pix-li-panel {
      background: #222;
      border: 1px solid rgba(246,103,68,0.45);
      border-radius: 4px;
      padding: 8px 10px;
    }
    .pix-li-panel-row { display: flex; align-items: center; gap: 8px; }
    .pix-li-panel-label {
      font-size: 9px;
      color: ${BRAND};
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .pix-li-panel input[type="range"] {
      flex: 1;
      accent-color: ${BRAND};
    }
    .pix-li-panel input[type="text"], .pix-li-panel input[type="number"] {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 3px;
      padding: 4px 6px;
      color: ${BRAND};
      font-size: 12px;
      font-weight: 600;
      text-align: center;
      font-family: inherit;
      box-sizing: border-box;
    }
    .pix-li-panel input[type="text"]:focus, .pix-li-panel input[type="number"]:focus {
      outline: none;
      border-color: ${BRAND};
    }
    .pix-li-panel-readout {
      font-size: 9px;
      color: #888;
      font-family: inherit;
      text-align: center;
      margin-top: 6px;
    }
    .pix-li-quickpicks {
      display: grid;
      gap: 3px;
      margin-bottom: 8px;
    }
    .pix-li-quickpick {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 3px;
      color: #aaa;
      padding: 4px 0;
      text-align: center;
      font-size: 10px;
      cursor: pointer;
      font-family: inherit;
    }
    .pix-li-quickpick:hover { border-color: #666; color: #ddd; }
    .pix-li-quickpick.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }
    .pix-li-value {
      font-family: inherit;
      font-size: 12px;
      color: ${BRAND};
      font-weight: 600;
      min-width: 50px;
      text-align: right;
    }
    .pix-li-ratio-chips {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 3px;
      margin-bottom: 8px;
    }
    .pix-li-ratio-chip {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 3px;
      padding: 4px 0;
      text-align: center;
      font-size: 9px;
      color: #aaa;
      cursor: pointer;
      font-family: inherit;
    }
    .pix-li-ratio-chip:hover { border-color: #666; color: #ddd; }
    .pix-li-ratio-chip.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }
    .pix-li-cropped {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 6px;
    }
    .pix-li-cropped > div {
      text-align: center;
      font-size: 10px;
      padding: 5px 0;
      color: #aaa;
      cursor: pointer;
      user-select: none;
    }
    .pix-li-cropped > div.active { background: ${BRAND}; color: #fff; }
    .pix-li-pad-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      color: #888;
    }
    .pix-li-pad-swatch {
      width: 22px; height: 22px;
      border-radius: 3px;
      border: 1px solid #444;
      cursor: pointer;
    }
    .pix-li-custom-ratio-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-bottom: 6px;
    }
    /* Custom ratio inputs sit inside a .pix-li-numinput wrapper — the
       wrapper supplies border/background; we just give the wrapper a
       fixed width and the inner input a slightly bigger font. */
    .pix-li-custom-ratio-input-wrap { width: 72px; }
    .pix-li-custom-ratio-input-wrap input { font-size: 13px !important; }
    .pix-li-custom-ratio-swap {
      width: 28px;
      height: 28px;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 3px;
      color: #aaa;
      cursor: pointer;
      position: relative;
      padding: 0;
      display: inline-block;
    }
    .pix-li-custom-ratio-swap::before {
      content: "";
      position: absolute;
      inset: 0;
      background-color: currentColor;
      -webkit-mask: url("/pixaroma/assets/icons/ui/swap.svg") center/14px 14px no-repeat;
              mask: url("/pixaroma/assets/icons/ui/swap.svg") center/14px 14px no-repeat;
      pointer-events: none;
    }
    .pix-li-custom-ratio-swap:hover { color: ${BRAND}; border-color: ${BRAND}; }
    /* Center single-input panel rows (Max MP / Longest side / Scale by ×). */
    .pix-li-panel-row.pix-li-centered { justify-content: center; }
    .pix-li-input-wide {
      width: 70% !important;
      max-width: 200px;
    }
    /* makeNumericInput wrapper — flex row with input + stacked +/- spinners. */
    .pix-li-numinput {
      display: inline-flex;
      align-items: stretch;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      overflow: hidden;
      box-sizing: border-box;
    }
    .pix-li-numinput:focus-within { border-color: ${BRAND}; }
    .pix-li-numinput input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      padding: 5px 7px;
      color: ${BRAND};
      font-size: 12px;
      font-weight: 600;
      text-align: center;
      font-family: inherit;
      width: 100%;
      min-width: 0;
    }
    .pix-li-spin {
      display: flex;
      flex-direction: column;
      width: 14px;
      border-left: 1px solid #444;
    }
    .pix-li-spin > button {
      flex: 1;
      background: #232323;
      border: none;
      padding: 0;
      cursor: pointer;
      color: #aaa;
      font-size: 8px;
      line-height: 1;
      position: relative;
    }
    .pix-li-spin > button:hover { background: #333; color: ${BRAND}; }
    .pix-li-spin-up { border-bottom: 1px solid #444; }
    /* CSS chevron arrows (no extra SVG needed). */
    .pix-li-spin-up::before,
    .pix-li-spin-down::before {
      content: "";
      position: absolute;
      left: 50%;
      top: 50%;
      width: 6px;
      height: 6px;
      transform: translate(-50%, -50%) rotate(-45deg);
      border-top: 1px solid currentColor;
      border-right: 1px solid currentColor;
    }
    .pix-li-spin-up::before {
      transform: translate(-50%, -25%) rotate(-45deg);
    }
    .pix-li-spin-down::before {
      transform: translate(-50%, -75%) rotate(135deg);
    }
    /* Width × Height panels (Fit inside, Crop to fill) with swap between. */
    .pix-li-wh-row {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 6px;
      align-items: end;
    }
    .pix-li-wh-field {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .pix-li-wh-label {
      font-size: 9px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      text-align: center;
    }
    /* W/H input is inside a .pix-li-numinput wrap — the wrap provides
       background/border, so the input itself stays transparent.
       Only need to upsize the font compared to the default 12px. */
    .pix-li-wh-input-wrap { width: 100%; }
    .pix-li-wh-input { font-size: 13px !important; }
    /* Generic swap button used between W and H inputs. */
    .pix-li-swap {
      width: 32px;
      height: 32px;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #aaa;
      cursor: pointer;
      padding: 0;
      position: relative;
      align-self: end;
    }
    .pix-li-swap::before {
      content: "";
      position: absolute;
      inset: 0;
      background-color: currentColor;
      -webkit-mask: url("/pixaroma/assets/icons/ui/swap.svg") center/16px 16px no-repeat;
              mask: url("/pixaroma/assets/icons/ui/swap.svg") center/16px 16px no-repeat;
      pointer-events: none;
    }
    .pix-li-swap:hover { color: ${BRAND}; border-color: ${BRAND}; }
    /* Aspect-ratio preview block under W / H fields. */
    .pix-li-wh-preview {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      margin-top: 8px;
    }
    .pix-li-wh-rect {
      background: rgba(246,103,68,0.18);
      border: 1px solid ${BRAND};
      border-radius: 2px;
      transition: width 0.12s ease, height 0.12s ease;
    }
    .pix-li-wh-rect-label {
      font-size: 9px;
      color: #999;
      font-family: inherit;
    }
    /* Tiny aspect-ratio shape rendered INSIDE each Match-ratio chip,
       same idea Resolution Pixaroma uses to make every ratio recognisable
       at a glance without reading the label. */
    .pix-li-ratio-chip {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }
    .pix-li-shape {
      display: inline-block;
      background: rgba(180,180,180,0.25);
      border: 1px solid #888;
      border-radius: 1px;
      box-sizing: border-box;
      flex-shrink: 0;
    }
    .pix-li-ratio-chip.active .pix-li-shape {
      background: rgba(255,255,255,0.4);
      border-color: rgba(255,255,255,0.85);
    }
    /* Custom chip has no shape (no fixed aspect) — keep text-only. */
    .pix-li-ratio-chip.pix-li-ratio-custom-chip { display: block; }
    .pix-li-global {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .pix-li-snap-row, .pix-li-rs-row {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #1d1d1d;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 5px 8px;
    }
    .pix-li-magnet {
      display: inline-block;
      width: 11px; height: 11px;
      background-color: #888;
      -webkit-mask: url("/pixaroma/assets/icons/ui/magnet.svg") center/11px 11px no-repeat;
              mask: url("/pixaroma/assets/icons/ui/magnet.svg") center/11px 11px no-repeat;
    }
    .pix-li-snap-btns {
      display: inline-flex;
      gap: 2px;
      margin-left: auto;
    }
    .pix-li-snap-btn {
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 3px;
      color: #aaa;
      font-size: 9px;
      padding: 2px 5px;
      min-width: 18px;
      cursor: pointer;
      font-family: inherit;
      line-height: 1;
    }
    .pix-li-snap-btn:hover { color: #ddd; border-color: #666; }
    .pix-li-snap-btn.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }
    .pix-li-rs-select {
      background: transparent;
      border: none;
      color: #ccc;
      font-size: 10px;
      margin-left: auto;
      cursor: pointer;
      font-family: inherit;
    }
    .pix-li-up-row {
      background: #1d1d1d;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 5px 8px;
      display: flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      user-select: none;
      font-size: 10px;
      color: #aaa;
    }
    .pix-li-up-row input { accent-color: ${BRAND}; cursor: pointer; }
  `;
  const el = document.createElement("style");
  el.id = "pixaroma-load-image-css";
  el.textContent = css;
  document.head.appendChild(el);
}

export function buildRoot() {
  const root = document.createElement("div");
  root.className = "pix-li-root";
  root.style.position = "relative"; // so drop-overlay can be absolute-positioned

  // Drop overlay (initially hidden; class toggle on .pix-li-root.drag-over shows it).
  const drop = document.createElement("div");
  drop.className = "pix-li-drop-overlay";
  const dropIcon = document.createElement("div");
  dropIcon.className = "icon";
  dropIcon.textContent = "📥";
  const dropLabel = document.createElement("div");
  dropLabel.className = "label";
  dropLabel.textContent = "Drop to upload";
  drop.append(dropIcon, dropLabel);
  root.appendChild(drop);

  // Upload button (orange, prominent, primary action).
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pix-li-upload-btn";
  const ico = document.createElement("span");
  ico.className = "ico";
  const lbl = document.createElement("span");
  lbl.textContent = "Upload Image";
  btn.append(ico, lbl);
  root.appendChild(btn);

  // Hint line for alternate upload methods.
  const hint = document.createElement("div");
  hint.className = "pix-li-hint";
  hint.innerHTML = `or drag here · paste with <kbd>Ctrl+V</kbd>`;
  root.appendChild(hint);

  // Placeholder for the dropdown (filled in Task 14).
  const dd = document.createElement("div");
  dd.className = "pix-li-dropdown";
  dd.dataset.role = "dropdown";
  dd.innerHTML = `<span class="name">— no image —</span><span class="arrow">▾</span>`;
  root.appendChild(dd);

  return root;
}

// Hides every auto-created widget so we can render our own UI in the DOM
// widget. `image_upload: True` creates TWO widgets in INPUT_TYPES on the
// Vue frontend: the `image` combo + a separate `upload` button widget — both
// need to be hidden, plus any other auto-created widget that isn't ours.
//
// Uses the same multi-technique pattern as shared/utils.mjs `hideJsonWidget`:
// setting `canvasOnly` alone is not enough for canvas drawing on the current
// Vue frontend — must also set `hidden=true`, zero `computeSize`, and hide
// any DOM element. Returns the `image` combo widget so callers can read /
// write its `.value` (that drives the actual file selection).
export function hideNativeImageCombo(node) {
  let imageWidget = null;
  for (const w of (node.widgets || [])) {
    if (!w) continue;
    if (w.name === "image") imageWidget = w;
    w.hidden = true;
    w.computeSize = () => [0, -4];
    if (!w.options) w.options = {};
    w.options.canvasOnly = true;
    if (w.element) w.element.style.display = "none";
  }
  // Vue may DOM-render an upload widget AFTER nodeCreated — re-hide on the
  // next animation frame as a belt-and-braces. Mirrors hideJsonWidget.
  requestAnimationFrame(() => {
    for (const w of (node.widgets || [])) {
      if (!w || w.name === "pixaroma_load_image_ui") continue;
      if (w.element) w.element.style.display = "none";
      if (w.inputEl) w.inputEl.style.display = "none";
    }
  });
  return imageWidget;
}

import { updateNativePreview } from "./api.mjs";

// Open a popup listing the underlying combo's options. Clicking an item
// sets the combo value and the dropdown's label.
export function openImageDropdown(node, anchorEl, onPick) {
  const imageWidget = node._pixLiImageWidget;
  if (!imageWidget) return;
  const values = imageWidget.options?.values || [];

  // Close any existing popup
  document.querySelector(".pix-li-popup")?.remove();

  const popup = document.createElement("div");
  popup.className = "pix-li-popup";
  Object.assign(popup.style, {
    position: "fixed",
    zIndex: 99999,
    background: "#1d1d1d",
    border: `1px solid #444`,
    borderRadius: "4px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
    maxHeight: "300px",
    overflowY: "auto",
    fontSize: "11px",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    color: "#ccc",
    minWidth: "200px",
  });

  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = `${rect.left}px`;
  popup.style.top = `${rect.bottom + 2}px`;
  popup.style.width = `${rect.width}px`;

  if (values.length === 0) {
    const empty = document.createElement("div");
    empty.style.padding = "8px";
    empty.style.color = "#666";
    empty.textContent = "(no images uploaded yet)";
    popup.appendChild(empty);
  } else {
    for (const v of values) {
      const item = document.createElement("div");
      item.style.padding = "6px 10px";
      item.style.cursor = "pointer";
      item.style.borderBottom = "1px solid #2a2a2a";
      if (v === imageWidget.value) {
        item.style.color = "#f66744";
        item.style.fontWeight = "600";
      }
      item.textContent = v;
      item.addEventListener("mouseenter", () => { item.style.background = "#2a2a2a"; });
      item.addEventListener("mouseleave", () => { item.style.background = ""; });
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        imageWidget.value = v;
        // Refresh the native bottom-of-node preview to match the new file.
        updateNativePreview(node, v);
        node.graph?.setDirtyCanvas?.(true, true);
        closePopup();
        if (onPick) onPick(v);
      });
      popup.appendChild(item);
    }
  }

  document.body.appendChild(popup);

  // Close the popup AND detach every listener. Captured in a single helper
  // so all close paths (click outside, scroll, Escape, canvas pointerdown,
  // node move) go through the same cleanup. Without centralised cleanup,
  // detached listeners would leak and re-close zombie popups on the next open.
  function closePopup() {
    popup.remove();
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("pointerdown", onDocDown, true);
    document.removeEventListener("wheel", onWheel, true);
    document.removeEventListener("keydown", onKey, true);
  }
  const onDocDown = (e) => {
    if (!popup.contains(e.target)) closePopup();
  };
  const onWheel = () => closePopup();
  const onKey = (e) => {
    if (e.key === "Escape") closePopup();
  };
  // Capture phase so we preempt LiteGraph's canvas handlers, with a
  // setTimeout so the opening click doesn't immediately close. mousedown +
  // pointerdown both — LiteGraph's drag uses pointer events on the canvas,
  // and not every browser fires both reliably in capture phase.
  setTimeout(() => {
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("wheel", onWheel, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
}

const MODE_CHIPS = [
  { id: "off",            label: "Off" },
  { id: "max_mp",         label: "Max megapixels" },
  { id: "longest_side",   label: "Longest side" },
  { id: "scale_factor",   label: "Scale by ×" },
  { id: "fit_inside",     label: "Fit inside" },
  { id: "cover",          label: "Crop to fill" },
  { id: "match_ratio",    label: "Match aspect ratio", spanFull: true },
];

export function renderChips(state) {
  const wrap = document.createElement("div");
  wrap.className = "pix-li-chips";
  for (const c of MODE_CHIPS) {
    const el = document.createElement("div");
    el.className = "pix-li-chip" + (c.spanFull ? " span-full" : "");
    if (state.mode === c.id) el.classList.add("active");
    el.dataset.modeId = c.id;
    el.textContent = c.label;
    wrap.appendChild(el);
  }
  return wrap;
}

const SNAP_OPTIONS = [0, 8, 16, 32, 64];
const RESAMPLE_OPTIONS = ["auto", "nearest", "bilinear", "bicubic", "lanczos"];

export function renderGlobalControls(node, state, writeState, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "pix-li-global";

  // Snap row
  const snapRow = document.createElement("div");
  snapRow.className = "pix-li-snap-row";
  const magnet = document.createElement("span");
  magnet.className = "pix-li-magnet";
  snapRow.appendChild(magnet);
  const snapBtns = document.createElement("div");
  snapBtns.className = "pix-li-snap-btns";
  for (const v of SNAP_OPTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pix-li-snap-btn" + (v === (state.snap || 0) ? " active" : "");
    b.textContent = v === 0 ? "Off" : String(v);
    b.dataset.v = String(v);
    snapBtns.appendChild(b);
  }
  snapRow.appendChild(snapBtns);
  wrap.appendChild(snapRow);

  // Resample row (with Upscale toggle on its right, on a separate row)
  const rsRow = document.createElement("div");
  rsRow.className = "pix-li-rs-row";
  const rsLabel = document.createElement("span");
  rsLabel.style.fontSize = "10px";
  rsLabel.style.color = "#888";
  rsLabel.textContent = "Resample";
  const select = document.createElement("select");
  select.className = "pix-li-rs-select";
  for (const opt of RESAMPLE_OPTIONS) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
    if (state.resample === opt) o.selected = true;
    select.appendChild(o);
  }
  rsRow.append(rsLabel, select);
  wrap.appendChild(rsRow);

  // Upscale toggle row
  const upRow = document.createElement("label");
  upRow.className = "pix-li-up-row";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = !!state.allow_upscale;
  const upLbl = document.createElement("span");
  upLbl.textContent = "Allow upscaling";
  upRow.append(cb, upLbl);
  wrap.appendChild(upRow);

  // Wire events
  snapBtns.addEventListener("click", (e) => {
    const b = e.target.closest(".pix-li-snap-btn");
    if (!b) return;
    e.stopPropagation();
    const v = parseInt(b.dataset.v, 10);
    for (const x of snapBtns.querySelectorAll(".pix-li-snap-btn")) {
      x.classList.toggle("active", parseInt(x.dataset.v, 10) === v);
    }
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
    writeState(node, { ...s, snap: v });
    onChange?.();
  });
  select.addEventListener("change", () => {
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
    writeState(node, { ...s, resample: select.value });
    onChange?.();
  });
  cb.addEventListener("change", () => {
    const s = JSON.parse(node.properties?.loadImagePixState || "{}");
    writeState(node, { ...s, allow_upscale: cb.checked });
    onChange?.();
  });

  return wrap;
}
