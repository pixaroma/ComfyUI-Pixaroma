import { BRAND } from "../shared/index.mjs";

// ─── Defaults ────────────────────────────────────────────────
export const DEFAULTS = {
  text: "Label Pixaroma",
  fontSize: 18,
  fontFamily: "Arial",
  fontColor: "#ffffff",
  textAlign: "left",
  backgroundColor: "#333333",
  padding: 10,
  borderRadius: 6,
  opacity: 1,
  fontWeight: "normal",
  lineHeight: 1,
};

export const FONT_CHOICES = [
  "Arial",
  "Times New Roman",
  "Courier New",
  "Impact",
];
export const FONT_SHORT = ["Arial", "Times", "Courier", "Impact"];

// (Legacy curated swatch arrays removed — the editor now uses the shared
//  PIXAROMA_PALETTE from js/shared/color_picker.mjs.)

// ─── Helpers ─────────────────────────────────────────────────
export function fontStr(cfg) {
  return `${cfg.fontWeight === "bold" ? "bold " : ""}${cfg.fontSize}px '${cfg.fontFamily}', 'Segoe UI Emoji', 'Noto Color Emoji', system-ui, sans-serif`;
}

export function measureLabel(cfg) {
  const cvs = document.createElement("canvas");
  const ctx = cvs.getContext("2d");
  ctx.font = fontStr(cfg);
  const lines = (cfg.text || "").split("\n");
  const lh = cfg.fontSize * cfg.lineHeight;
  let maxW = 0;
  for (const line of lines) maxW = Math.max(maxW, ctx.measureText(line).width);
  return {
    w: Math.ceil(maxW) + cfg.padding * 2,
    h: Math.ceil(lines.length * lh) + cfg.padding * 2,
    lines,
    lh,
  };
}

// ─── Canvas rendering (shared by preview and node draw) ──────
export function renderLabelToCanvas(ctx, cfg, m, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = cfg.opacity;
  if (cfg.backgroundColor !== "transparent") {
    ctx.fillStyle = cfg.backgroundColor;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, m.w, m.h, cfg.borderRadius);
    else ctx.rect(0, 0, m.w, m.h);
    ctx.fill();
  }
  ctx.font = fontStr(cfg);
  ctx.fillStyle = cfg.fontColor;
  ctx.textBaseline = "top";
  ctx.textAlign = cfg.textAlign;
  let tx = cfg.padding;
  if (cfg.textAlign === "center") tx = m.w / 2;
  else if (cfg.textAlign === "right") tx = m.w - cfg.padding;
  for (let i = 0; i < m.lines.length; i++) {
    ctx.fillText(m.lines[i], tx, cfg.padding + i * m.lh);
  }
  ctx.globalAlpha = 1;
}

// ─── DOM rendering (Nodes 2.0 node body) ─────────────────────
// The crisp-HTML mirror of renderLabelToCanvas. Maps the SAME cfg to CSS, so
// the Nodes 2.0 label matches the Legacy canvas paint closely (and stays sharp
// at any zoom / large font). white-space:pre preserves the \n line breaks +
// spaces; the background pill is the element background + border-radius.
export function applyLabelToDom(el, cfg) {
  el.textContent = cfg.text || "";
  el.style.fontFamily = `'${cfg.fontFamily}', 'Segoe UI Emoji', 'Noto Color Emoji', system-ui, sans-serif`;
  el.style.fontSize = `${cfg.fontSize}px`;
  el.style.fontWeight = cfg.fontWeight === "bold" ? "bold" : "normal";
  el.style.lineHeight = String(cfg.lineHeight);
  el.style.color = cfg.fontColor;
  el.style.textAlign = cfg.textAlign;
  el.style.padding = `${cfg.padding}px`;
  el.style.opacity = String(cfg.opacity);
  if (cfg.backgroundColor && cfg.backgroundColor !== "transparent") {
    el.style.background = cfg.backgroundColor;
    el.style.borderRadius = `${cfg.borderRadius}px`;
  } else {
    el.style.background = "transparent";
    el.style.borderRadius = "0";
  }
}

// CSS for the Nodes 2.0 label box + the node-frame hide (once).
let _vueCssInjected = false;
export function injectVueLabelCSS() {
  if (_vueCssInjected) return;
  _vueCssInjected = true;
  const s = document.createElement("style");
  s.id = "pix-lbl-vue-css";
  s.textContent = `
.pix-lbl-vue {
    display: inline-block; box-sizing: border-box; white-space: pre;
    user-select: none;
    /* ComfyUI's widget host is a flex column; without these the element gets
       STRETCHED to the node's (too-narrow) width, so the background pill ends at
       the node edge while the text overflows past it. align-self + flex:none
       make it size to the TEXT, so the pill always wraps the full text. */
    align-self: flex-start; flex: 0 0 auto;
    /* pointer-events:none is CRITICAL: Label is a title-less node, so its whole
       body is this element. If it captured the mouse, the place-on-canvas click
       (and node dragging) would land on it instead of the node, and the node
       would get stuck to the cursor. With none, clicks pass through to the node;
       editing is via double-click (legacy) / right-click "Edit Label". */
    pointer-events: none;
}
/* Make the Label node read as FLOATING TEXT in Nodes 2.0: hide the Vue node
   card/frame at rest so only the label shows (the hover toolbar + resize
   handles are a separate Vue overlay and stay). Scoped via :has() so it only
   touches Label nodes; no-op in legacy (no .lg-node there). */
.lg-node:has(.pix-lbl-vue) {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
}
.lg-node:has(.pix-lbl-vue) .lg-node-content { padding: 0 !important; }
/* THE PLACEMENT FIX: ComfyUI wraps our label in widget containers
   (.lg-node-widgets > .lg-node-widget > a flex host) that are ALL
   pointer-events:auto, so they eat the place-on-canvas / drag click (the node
   itself is pointer-events:none - all node interaction goes through the canvas
   by hit-test). Make the ENTIRE widget subtree of a Label node click-through so
   placement / drag / right-click reach the canvas. Safe because a Label has no
   interactive controls in its body - it's display-only text. Verified via the
   ancestor-chain console diagnostic (2026-06-01). */
.lg-node:has(.pix-lbl-vue) .lg-node-widgets,
.lg-node:has(.pix-lbl-vue) .lg-node-widgets * {
    pointer-events: none !important;
    /* overflow:visible so the widget wrappers never clip the label text when
       the node is momentarily a hair narrower than the rendered text (the node
       is resized to the real text width a frame later by _pixLblFit). */
    overflow: visible !important;
}
/* Tighten the selection / resize box to HUG the label. Every floor below was
   found by reading the compiled frontend (agent investigation 2026-06-01):
   a hardcoded 225px node min-width, a widget grid that forces 80px+125px
   columns, a 12px reorder-handle gutter + 12px right padding, ~20px of body
   padding (pt-1 pb-3 gap-1), and a selection outline drawn 7px OUTSIDE the node.
   Combined with _pixLblFit writing node.size = the real label size, this makes
   the box wrap the label. */
/* 1. Kill the min-WIDTH (225px) AND min-HEIGHT (node.size[1] + ~30px title
   height) on the node + its frame wrappers, so the box shrinks to the label in
   both dimensions. The min-height is what left the bottom handles low. */
.lg-node:has(.pix-lbl-vue),
.lg-node:has(.pix-lbl-vue) > div,
.lg-node:has(.pix-lbl-vue) > div > div { min-width: 0 !important; min-height: 0 !important; }
/* 2. Collapse the widget grid to a single content-sized column (drops the
   80px+125px column minimums, the right padding, row gaps, and the gutter). */
.lg-node:has(.pix-lbl-vue) .lg-node-widgets {
    grid-template-columns: max-content !important;
    padding-right: 0 !important;
    row-gap: 0 !important;
    gap: 0 !important;
}
.lg-node:has(.pix-lbl-vue) .lg-node-widget { gap: 0 !important; }
.lg-node:has(.pix-lbl-vue) .lg-node-widget > *:first-child { display: none !important; }
/* 3. Remove the node body's vertical padding + gap (pt-1 pb-3 gap-1) that adds
   space below the label. Broad substring match in case the class prefix varies. */
.lg-node:has(.pix-lbl-vue) [class*="component-node-background"] {
    padding: 0 !important;
    gap: 0 !important;
}
/* 4. Pull the selection outline in from -7px so the handles hug the box. */
.lg-node:has(.pix-lbl-vue) [data-testid="node-state-outline-overlay"],
.lg-node:has(.pix-lbl-vue) > div.absolute.outline-none { inset: -2px !important; }
/* 5. Hide the resize handles. The label auto-sizes to its text (_pixLblFit), so
   manual resize is a no-op (it snaps back) - the grips are just clutter. They're
   the only direct-child divs of the node that hold an icon <svg>; the size
   fallback (.h-5.w-5) catches them if the markup shifts. Selecting / moving /
   deleting / double-click-to-edit all still work (those aren't these handles). */
.lg-node:has(.pix-lbl-vue) > div:has(> svg),
.lg-node:has(.pix-lbl-vue) > div.h-5.w-5 { display: none !important; }
/* 6. Hide the Nodes 2.0 node FOOTER row (the muted status strip that holds the
   category chip, e.g. "Pixaroma" from the "👑 Pixaroma/..." category). A newer
   frontend added this row; on a title-less, transparent Label it's pure clutter
   AND reserves a ~37px strip below the text, so the node frame can't hug the
   label (the "contour" floating below + around the pill). The node sizes to its
   content, so removing the footer lets the frame shrink back to the label.
   We hide the node-body child that CONTAINS the chip (the footer row, robust to
   its utility classes changing) PLUS the chip itself as a fallback. Scoped to
   Label nodes via :has(); the label content is .pix-lbl-vue (no such class), so
   only the footer/chip are hit. */
.lg-node:has(.pix-lbl-vue) [class*="component-node-background"] > div:has(.bg-node-component-surface),
.lg-node:has(.pix-lbl-vue) .bg-node-component-surface { display: none !important; }
/* 7. Hide the node's RESTING border. A newer frontend draws it as an absolute
   child overlay (<div class="pointer-events-none absolute border border-solid
   ...">) instead of a border on .lg-node, so the host border:none rule above does
   not reach it. It rendered as a faint rounded contour around the pill with a LARGER
   corner radius than the label (the node frame's radius vs the pill's), reading as
   an unwanted second outline. The resting border has NO data-testid; the SELECTION
   outline overlay DOES (handled by rule #4 above), so :not([data-testid]) hides
   only the resting frame and a picked label still shows a hugging outline. */
.lg-node:has(.pix-lbl-vue) > div.absolute.border:not([data-testid]) { display: none !important; }
`;
  document.head.appendChild(s);
}

// ─── CSS injection (once) ────────────────────────────────────
let _cssInjected = false;
export function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
.pix-lbl-overlay {
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    font-family: 'Segoe UI', system-ui, sans-serif;
}
.pix-lbl-panel {
    background: #171718; border: 1px solid #2e2e2e; border-radius: 10px;
    width: 720px; max-height: 90vh; overflow-y: auto;
    box-shadow: 0 16px 48px rgba(0,0,0,0.7); position: relative;
    scrollbar-width: thin; scrollbar-color: #444 transparent;
}
.pix-lbl-panel::-webkit-scrollbar { width: 5px; }
.pix-lbl-panel::-webkit-scrollbar-thumb { background: #444; border-radius: 4px; }
.pix-lbl-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; border-bottom: 1px solid #242424; position: sticky; top: 0;
    background: #171718; z-index: 1;
}
.pix-lbl-title { display: flex; align-items: center; gap: 6px; color: #e0e0e0; font-size: 13px; font-weight: 600; letter-spacing: 0.2px; }
.pix-lbl-title-logo { width: 18px; height: 18px; }
.pix-lbl-title-brand { color: ${BRAND}; }
.pix-lbl-close {
    background: none; border: none; color: #555; font-size: 18px;
    cursor: pointer; padding: 0 2px; line-height: 1;
}
.pix-lbl-close:hover { color: #ddd; }
.pix-lbl-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
/* Section label */
.pix-lbl-lbl {
    display: block; color: #555; font-size: 9px; margin-bottom: 4px;
    text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600;
}
.pix-lbl-field textarea {
    width: 100%; box-sizing: border-box;
    background: #1e1e1f; border: 1px solid #2e2e2e; border-radius: 5px;
    color: #d0d0d0; padding: 7px 9px; font-size: 13px;
    font-family: inherit; outline: none; resize: vertical; min-height: 46px;
}
.pix-lbl-field textarea:focus { border-color: ${BRAND}; }
.pix-lbl-preview {
    border-radius: 6px; border: 1px solid #222;
    padding: 12px; height: 200px; box-sizing: border-box; display: flex;
    align-items: center; justify-content: center; overflow: hidden;
    /* subtle checkerboard so a transparent background reads as transparent */
    background-color: #111;
    background-image:
      linear-gradient(45deg, #1b1b1b 25%, transparent 25%, transparent 75%, #1b1b1b 75%),
      linear-gradient(45deg, #1b1b1b 25%, transparent 25%, transparent 75%, #1b1b1b 75%);
    background-size: 16px 16px;
    background-position: 0 0, 8px 8px;
}
.pix-lbl-preview canvas { display: block; max-width: 100%; max-height: 100%; }
/* Toggle button group */
.pix-lbl-btns { display: flex; gap: 5px; flex-wrap: nowrap; align-items: stretch; }
.pix-lbl-btn {
    flex: 1 1 0; min-width: 0;
    padding: 7px 8px; border: 1px solid #333; border-radius: 5px;
    background: #232325; color: #888; font-size: 12px; cursor: pointer;
    transition: all 0.12s; line-height: 1.4;
    display: flex; align-items: center; justify-content: center;
}
.pix-lbl-btn:hover { border-color: #555; color: #bbb; }
.pix-lbl-btn.active { background: ${BRAND}22; border-color: ${BRAND}; color: ${BRAND}; }
.pix-lbl-bold { font-weight: bold; min-width: 26px; text-align: center; }
/* Divider inside button row */
.pix-lbl-vsep { width: 1px; height: 16px; background: #333; margin: 0 3px; flex-shrink: 0; }
/* Spacing & Style — 2-col grid of slider fields */
.pix-lbl-spacing-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 14px; }
/* Footer */
.pix-lbl-footer {
    display: flex; justify-content: flex-end; align-items: center; gap: 6px;
    padding: 8px 14px; border-top: 1px solid #242424; position: sticky; bottom: 0;
    background: #171718;
}
.pix-lbl-footer button {
    padding: 6px 16px; border: none; border-radius: 5px;
    font-size: 12px; cursor: pointer; font-weight: 500;
}
.pix-lbl-btn-cancel { background: #252527; color: #aaa; border: 1px solid #333; }
.pix-lbl-btn-cancel:hover { background: #2e2e30; }
.pix-lbl-btn-save { background: ${BRAND}; color: #fff; border: 1px solid transparent; }
.pix-lbl-btn-save:hover { opacity: 0.88; }
/* Align icon buttons */
.pix-lbl-align-icon { display: flex; flex-direction: column; gap: 2px; width: 13px; align-items: flex-start; }
.pix-lbl-align-icon span { display: block; height: 2px; background: currentColor; border-radius: 1px; }
.pix-lbl-align-left .pix-lbl-align-icon span:nth-child(1) { width: 13px; }
.pix-lbl-align-left .pix-lbl-align-icon span:nth-child(2) { width: 9px; }
.pix-lbl-align-left .pix-lbl-align-icon span:nth-child(3) { width: 11px; }
.pix-lbl-align-center .pix-lbl-align-icon { align-items: center; }
.pix-lbl-align-center .pix-lbl-align-icon span:nth-child(1) { width: 13px; }
.pix-lbl-align-center .pix-lbl-align-icon span:nth-child(2) { width: 9px; }
.pix-lbl-align-center .pix-lbl-align-icon span:nth-child(3) { width: 11px; }
.pix-lbl-align-right .pix-lbl-align-icon { align-items: flex-end; }
.pix-lbl-align-right .pix-lbl-align-icon span:nth-child(1) { width: 13px; }
.pix-lbl-align-right .pix-lbl-align-icon span:nth-child(2) { width: 9px; }
.pix-lbl-align-right .pix-lbl-align-icon span:nth-child(3) { width: 11px; }
/* (Help is the shared themed popup from js/shared/help.mjs - no editor-local
    help-overlay CSS needed.) */
/* Round help button (matches the Group Colors / toolbar look) */
.pix-lbl-help-btn {
    margin-right: auto; width: 24px; height: 24px; border-radius: 50%;
    border: none; background: ${BRAND}; color: #fff; font-size: 13px; font-weight: 700;
    cursor: pointer; line-height: 1; padding: 0; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
}
.pix-lbl-help-btn:hover { filter: brightness(1.12); }
/* Slider + editable number + spinner arrows (matches .pix-nc-slider) */
/* inline label (left of the slider) so the row is one line - saves height */
.pix-lbl-slbl { flex: 0 0 auto; min-width: 58px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #777; white-space: nowrap; }
.pix-lbl-sliderrow { display: flex; align-items: center; gap: 8px; }
.pix-lbl-slider {
    -webkit-appearance: none; appearance: none;
    flex: 1 1 auto; min-width: 0; height: 6px; cursor: pointer; margin: 0;
    background: linear-gradient(to right, ${BRAND} 0%, ${BRAND} var(--fill, 50%), #3a3a40 var(--fill, 50%), #3a3a40 100%);
    border-radius: 3px; border: none; outline: none;
}
.pix-lbl-slider::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 13px; height: 13px; border-radius: 50%;
    background: ${BRAND}; border: none; box-shadow: 0 0 3px rgba(0,0,0,0.5);
    cursor: pointer; margin-top: -3.5px;
}
.pix-lbl-slider::-moz-range-thumb {
    width: 13px; height: 13px; border-radius: 50%;
    background: ${BRAND}; border: none; box-shadow: 0 0 3px rgba(0,0,0,0.5); cursor: pointer;
}
.pix-lbl-slider::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; background: transparent; border: none; }
.pix-lbl-slider::-moz-range-track { height: 6px; border-radius: 3px; background: transparent; border: none; }
.pix-lbl-spin {
    display: flex; align-items: stretch; flex: 0 0 auto; height: 24px;
    background: #161616; border: 1px solid #3a3a40; border-radius: 6px; overflow: hidden;
}
.pix-lbl-spinval {
    width: 44px; min-width: 44px; text-align: right; font-size: 12px; color: #ddd;
    background: transparent; border: none; outline: none; padding: 0 4px;
    font-variant-numeric: tabular-nums;
}
.pix-lbl-spinbtns { display: flex; flex-direction: column; width: 15px; flex: 0 0 auto; border-left: 1px solid #3a3a40; }
.pix-lbl-spinbtns button {
    flex: 1 1 0; border: none; background: rgba(255,255,255,0.05); color: #aaa;
    font-size: 7px; line-height: 1; cursor: pointer; padding: 0;
    display: flex; align-items: center; justify-content: center;
}
.pix-lbl-spinbtns button:last-child { border-top: 1px solid #3a3a40; }
.pix-lbl-spinbtns button:hover { background: rgba(255,255,255,0.12); color: #fff; }
/* Background / Text color buttons — Prompt-Multi-style segmented pills: solid
   orange when active, gray when inactive. They select which target the picker +
   swatches edit; the selected colour's label + editable hex code shows in the
   bar under the picker (.pix-lbl-hexbar). */
.pix-lbl-cbars { display: flex; gap: 6px; margin-bottom: 10px; }
.pix-lbl-cbar {
    flex: 1 1 0; min-width: 0; box-sizing: border-box;
    padding: 9px 8px; border-radius: 6px; cursor: pointer; text-align: center;
    font: 13px system-ui, sans-serif;
    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15);
    color: rgba(255,255,255,0.85); transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.pix-lbl-cbar:hover { background: ${BRAND}; border-color: ${BRAND}; color: #fff; }
.pix-lbl-cbar.active { background: ${BRAND}; border-color: ${BRAND}; color: #fff; }
/* Hex bar under the picker (Group "Body #hex" style): dark interior, swatch
   chip, the selected target's label (gray) + its editable hex code (orange).
   It replaces the picker's own hex field (hidden below), and the label switches
   between "Background" and "Text" with the selected button. */
.pix-lbl-hexbar {
    display: flex; align-items: center; gap: 8px; margin-top: 8px;
    background: #161616; border: 1px solid #3a3a40; border-radius: 6px; padding: 7px 9px;
}
.pix-lbl-hexbar-chip {
    width: 18px; height: 18px; border-radius: 4px; flex: 0 0 auto;
    border: 1px solid rgba(255,255,255,0.2); box-sizing: border-box;
}
.pix-lbl-hexbar-chip.is-transp {
    background-color: #3a3a3a;
    background-image:
      linear-gradient(45deg, transparent 44%, #e0504a 44%, #e0504a 56%, transparent 56%),
      linear-gradient(45deg, #777 25%, transparent 25%, transparent 75%, #777 75%),
      linear-gradient(45deg, #777 25%, transparent 25%, transparent 75%, #777 75%);
    background-size: 100% 100%, 8px 8px, 8px 8px;
    background-position: 0 0, 0 0, 4px 4px;
}
.pix-lbl-hexbar-k { font: 11px system-ui, sans-serif; color: #8a8a90; flex: 0 0 auto; }
.pix-lbl-hexbar-v {
    flex: 1 1 auto; min-width: 0; background: transparent; border: none; outline: none;
    color: ${BRAND}; font: 12.5px "Consolas", monospace; letter-spacing: 0.03em; padding: 0;
}
.pix-lbl-hexbar-v::placeholder { color: #6a6a70; font-style: italic; letter-spacing: 0; }
/* Colors: SV picker (left) | swatch grid (right), filling the full width.
   The grid is a perfect 9x4 of the 36 palette colours, so it always fills
   complete rows (no empty cells) whether or not Transparent is shown. */
.pix-lbl-colorrow { display: flex; gap: 14px; align-items: flex-start; }
.pix-lbl-pickercol { flex: 1 1 0; min-width: 0; }
.pix-lbl-swatchcol { flex: 1 1 0; min-width: 0; }
.pix-lbl-swgrid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 5px; align-content: start; }
.pix-lbl-swtile {
    aspect-ratio: 1; min-width: 0; padding: 0; border-radius: 5px; cursor: pointer;
    border: 2px solid transparent; box-sizing: border-box; background-clip: padding-box;
}
.pix-lbl-swtile:hover { border-color: #888; }
.pix-lbl-swtile.active { border-color: #fff; }
/* Transparent — Background only, a labelled control below the grid (so it is
   never a half-empty grid cell). Hidden for Text via inline display:none in JS. */
.pix-lbl-transbtn {
    margin-top: 6px; width: 100%; box-sizing: border-box;
    display: flex; align-items: center; gap: 8px;
    padding: 6px 9px; border-radius: 6px; cursor: pointer; font-size: 12px;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12); color: #aaa;
    transition: all 0.12s;
}
.pix-lbl-transbtn:hover { border-color: ${BRAND}; color: #ddd; }
.pix-lbl-transbtn.active { border-color: ${BRAND}; color: ${BRAND}; }
.pix-lbl-transbtn-sw {
    width: 16px; height: 16px; border-radius: 3px; flex: 0 0 auto; box-sizing: border-box;
    border: 1px solid rgba(255,255,255,0.2);
    background-color: #3a3a3a;
    background-image:
      linear-gradient(45deg, transparent 44%, #e0504a 44%, #e0504a 56%, transparent 56%),
      linear-gradient(45deg, #777 25%, transparent 25%, transparent 75%, #777 75%),
      linear-gradient(45deg, #777 25%, transparent 25%, transparent 75%, #777 75%);
    background-size: 100% 100%, 8px 8px, 8px 8px;
    background-position: 0 0, 0 0, 4px 4px;
}
/* Embedded picker (no internal swatches): fill the left column + give the SV
   plane a usable height. min-width:0 on the picker + its SV row + the SV canvas
   is REQUIRED: a flex-item <canvas> keeps its intrinsic 168px width unless told
   it may shrink, which otherwise pushed the hue strip out over the swatches. */
.pix-lbl-panel .pix-cp { width: 100%; max-width: none; margin: 0; min-width: 0; }
.pix-lbl-panel .pix-cp-sv-row { min-width: 0; }
.pix-lbl-panel .pix-cp-sv { height: 170px; min-width: 0; }
/* Hide the picker's own hex field — our labelled .pix-lbl-hexbar replaces it
   (it shows the selected target's name + code and changes with the buttons). */
.pix-lbl-panel .pix-cp-hexrow { display: none; }
`;
  document.head.appendChild(style);
}
