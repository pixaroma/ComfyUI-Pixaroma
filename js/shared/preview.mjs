// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Shared — Node Preview System                       ║
// ║  Consistent preview display for all Pixaroma nodes           ║
// ╚═══════════════════════════════════════════════════════════════╝

import { createDummyWidget } from "./utils.mjs";

/**
 * Creates the DOM elements for a node preview area.
 * @returns {{ container, previewBox, preview, dummy, infoLabel }}
 */
export function createNodePreview(titleText, subtitleText, instructionText) {
  const container = document.createElement("div");
  container.style.cssText = `
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 0px;
    padding: 5px;
    background-color: #2a2a2a;
    border-radius: 4px;
    width: 100%;
    overflow: hidden;
  `;

  const previewBox = document.createElement("div");
  previewBox.style.cssText = `
    display: none;
    width: 100%;
    height: 0;
    padding-bottom: 100%;
    background-color: #000000;
    border-radius: 4px;
    overflow: hidden;
    position: relative;
  `;

  const preview = document.createElement("img");
  preview.style.cssText = `
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  `;
  previewBox.appendChild(preview);
  container.appendChild(previewBox);

  const dummy = createDummyWidget(titleText, subtitleText, instructionText);
  container.appendChild(dummy);

  const infoLabel = document.createElement("div");
  infoLabel.style.cssText =
    "color:#888;font-size:10px;text-align:center;margin-top:2px;";
  infoLabel.textContent = "";
  container.appendChild(infoLabel);

  return { container, previewBox, preview, dummy, infoLabel };
}

/**
 * Show a preview image in the shared preview area.
 */
export function showNodePreview(parts, src, dimText, node) {
  const { previewBox, preview, dummy, infoLabel } = parts;
  const img = new Image();
  img.onload = () => {
    dummy.style.display = "none";
    preview.src = src;
    previewBox.style.display = "block";
    infoLabel.textContent =
      dimText || `${img.naturalWidth}\u00d7${img.naturalHeight}`;
    _enforceSquare(previewBox);
    node.setDirtyCanvas(true, true);
  };
  img.src = src;
}

function _enforceSquare(el) {
  let tries = 0;
  const check = () => {
    if (!el.isConnected || tries > 60) return;
    tries++;
    const w = el.offsetWidth;
    if (w > 0) {
      el.style.height = w + "px";
      el.style.paddingBottom = "0";
    }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}

/**
 * Restore a preview from saved JSON.
 */
export function restoreNodePreview(parts, json, node) {
  try {
    const meta = JSON.parse(json);
    if (!meta.composite_path) return;
    const fn = meta.composite_path.split(/[\\/]/).pop();
    const url = `/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
    const dimText = `${meta.doc_w || "?"}\u00d7${meta.doc_h || "?"}`;
    showNodePreview(parts, url, dimText, node);
  } catch {
    // silently ignore malformed JSON
  }
}

/**
 * Activate the preview container after a short delay.
 */
export function activateNodePreview(parts, node) {
  const origResize = node.onResize;
  node.onResize = function (size) {
    origResize?.call(this, size);
    const box = parts.previewBox;
    if (box && box.style.display !== "none") {
      const w = box.offsetWidth;
      if (w > 0) {
        box.style.height = w + "px";
        box.style.paddingBottom = "0";
      }
    }
  };

  setTimeout(() => {
    parts.container.style.display = "flex";
    node.setDirtyCanvas(true, true);
  }, 100);
}
