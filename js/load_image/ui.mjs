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
      font-family: ui-monospace, monospace;
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
      background: rgba(246,103,68,0.07);
      border: 1px solid rgba(246,103,68,0.4);
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
      font-family: ui-monospace, monospace;
      box-sizing: border-box;
    }
    .pix-li-panel input[type="text"]:focus, .pix-li-panel input[type="number"]:focus {
      outline: none;
      border-color: ${BRAND};
    }
    .pix-li-panel-readout {
      font-size: 9px;
      color: #888;
      font-family: ui-monospace, monospace;
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
      font-family: ui-monospace, monospace;
    }
    .pix-li-quickpick:hover { border-color: #666; color: #ddd; }
    .pix-li-quickpick.active {
      background: ${BRAND};
      color: #fff;
      border-color: ${BRAND};
    }
    .pix-li-value {
      font-family: ui-monospace, monospace;
      font-size: 12px;
      color: ${BRAND};
      font-weight: 600;
      min-width: 50px;
      text-align: right;
    }
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
