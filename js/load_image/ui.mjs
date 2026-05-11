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
