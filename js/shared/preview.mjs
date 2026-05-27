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

  // Keep the preview box square at all times. The original
  // `requestAnimationFrame` loop + `node.onResize` override only handled
  // the initial render and one specific resize hook, but ComfyUI's Vue
  // frontend doesn't reliably fire `node.onResize` for DOM-widget
  // resizes (CLAUDE.md Vue Frontend Compatibility #1 / #5 family) - so
  // the box would lock at its first measured width and stay that
  // height even after the user dragged the node wider, manifesting as
  // wide-letterboxed previews. ResizeObserver fires for every actual
  // size change of the observed element regardless of cause (node
  // resize, tab switch reflow, parent layout shifts) and works in all
  // browsers ComfyUI runs in.
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver((entries) => {
      // Self-disconnect once the box leaves the DOM (node removed/duplicated),
      // otherwise the observer + its element reference leak for the page's life
      // across every add/delete cycle (shared by Paint/Crop/Composer/3D).
      if (!previewBox.isConnected) { ro.disconnect(); return; }
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) {
          previewBox.style.height = w + "px";
          previewBox.style.paddingBottom = "0";
        }
      }
    });
    ro.observe(previewBox);
    // Expose the observer so a consumer can disconnect it explicitly in onRemoved.
    return { container, previewBox, preview, dummy, infoLabel, resizeObserver: ro };
  }

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
    // Squaring is handled by the ResizeObserver attached in
    // createNodePreview - it fires on every size change including the
    // initial display:none -> display:block transition right here.
    node.setDirtyCanvas(true, true);
  };
  img.src = src;
}

/**
 * Restore a preview from saved JSON.
 */
export function restoreNodePreview(parts, json, node) {
  try {
    const meta = JSON.parse(json);
    // Prefer the saved composite; fall back to the raw source (e.g. a Crop node
    // where the user pasted/dropped an image but never opened the editor — it
    // has a src_path but no composite_path), otherwise the mini-preview is blank
    // after a workflow tab switch. Composer/Paint/3D always have composite_path,
    // so this fallback never changes their behavior.
    const rel = meta.composite_path || meta.src_path;
    if (!rel) return;
    const fn = rel.split(/[\\/]/).pop();
    const url = `/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=pixaroma&t=${Date.now()}`;
    const dimText = `${meta.doc_w || "?"}\u00d7${meta.doc_h || "?"}`;
    showNodePreview(parts, url, dimText, node);
  } catch {
    // silently ignore malformed JSON
  }
}

/**
 * Activate the preview container after a short delay.
 *
 * Squaring of the preview box is now driven by the ResizeObserver
 * installed in createNodePreview, so we no longer override
 * node.onResize here (that hook is unreliable in ComfyUI's Vue
 * frontend - see CLAUDE.md Vue Frontend Compatibility patterns).
 */
export function activateNodePreview(parts, node) {
  setTimeout(() => {
    parts.container.style.display = "flex";
    node.setDirtyCanvas(true, true);
  }, 100);
}
