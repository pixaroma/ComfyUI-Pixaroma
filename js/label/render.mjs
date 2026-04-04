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

export const FONT_CHOICES = ["Arial", "Times New Roman", "Courier New", "Impact"];
export const FONT_SHORT = ["Arial", "Times", "Courier", "Impact"];

// Color swatches
export const TEXT_SWATCHES = [
  "#ffffff",
  "#cccccc",
  "#999999",
  "#555555",
  "#000000",
  "#f66744",
  "#cc3333",
  "#33aa33",
  "#3388dd",
  "#ddaa00",
  "#ff99bb",
  "#99ddff",
  "#aaffaa",
  "#ffeeaa",
  "#cc88ff",
];
export const BG_SWATCHES = [
  "#333333",
  "#444444",
  "#555555",
  "#222222",
  "#111111",
  "#f66744",
  "#593930",
  "#355735",
  "#354f6b",
  "#4f3560",
  "#ffe0e0",
  "#e0ffe0",
  "#e0e0ff",
  "#fff3e0",
  "#f0f0f0",
];

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
    width: 520px; max-height: 90vh; overflow-y: auto;
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
    background: #111; border-radius: 5px; border: 1px solid #222;
    padding: 8px; min-height: 28px; display: flex;
    align-items: center; justify-content: center; overflow: hidden;
}
.pix-lbl-preview canvas { max-width: 100%; height: auto; }
/* Toggle button group */
.pix-lbl-btns { display: flex; gap: 3px; flex-wrap: wrap; align-items: center; }
.pix-lbl-btn {
    padding: 4px 10px; border: 1px solid #333; border-radius: 4px;
    background: #232325; color: #888; font-size: 11px; cursor: pointer;
    transition: all 0.12s; line-height: 1.4;
}
.pix-lbl-btn:hover { border-color: #555; color: #bbb; }
.pix-lbl-btn.active { background: ${BRAND}22; border-color: ${BRAND}; color: ${BRAND}; }
.pix-lbl-bold { font-weight: bold; min-width: 26px; text-align: center; }
/* Range row */
.pix-lbl-range-wrap { display: flex; align-items: center; gap: 6px; }
.pix-lbl-range-wrap input[type="range"] { flex: 1; accent-color: ${BRAND}; height: 3px; }
.pix-lbl-range-wrap .pix-lbl-val {
    color: #666; font-size: 11px; min-width: 28px; text-align: right; font-variant-numeric: tabular-nums;
}
/* Divider inside button row */
.pix-lbl-vsep { width: 1px; height: 16px; background: #333; margin: 0 3px; flex-shrink: 0; }
/* 2-col color grid */
.pix-lbl-color-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.pix-lbl-color-col { min-width: 0; }
/* Color section */
.pix-lbl-swatches { display: flex; gap: 3px; flex-wrap: wrap; margin-bottom: 5px; }
.pix-lbl-swatch {
    width: 20px; height: 20px; border-radius: 3px; cursor: pointer;
    border: 2px solid transparent; transition: border-color 0.12s;
    box-sizing: border-box;
}
.pix-lbl-swatch:hover { border-color: #888; }
.pix-lbl-swatch.active { border-color: #fff; }
.pix-lbl-swatch-transp {
    width: 20px; height: 20px; border-radius: 3px; cursor: pointer;
    border: 2px solid transparent; box-sizing: border-box;
    background: repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 50%/8px 8px;
}
.pix-lbl-swatch-transp:hover { border-color: #888; }
.pix-lbl-swatch-transp.active { border-color: #fff; }
.pix-lbl-color-row { display: flex; align-items: center; gap: 5px; }
.pix-lbl-color-row input[type="color"] {
    width: 26px; height: 22px; padding: 0; border: 1px solid #333;
    border-radius: 3px; background: #1e1e1f; cursor: pointer; flex-shrink: 0;
}
.pix-lbl-color-row .pix-lbl-hex {
    flex: 1; min-width: 0; background: #1e1e1f; border: 1px solid #2e2e2e; border-radius: 3px;
    color: #bbb; padding: 3px 5px; font-size: 11px; font-family: monospace; outline: none;
}
.pix-lbl-color-row .pix-lbl-hex:focus { border-color: ${BRAND}; }
/* 4-up spacing strip */
.pix-lbl-spacing-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
.pix-lbl-spacing-field { min-width: 0; }
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
/* Help overlay */
.pix-lbl-help-overlay {
    position: absolute; inset: 0; background: #171718;
    border-radius: 10px; padding: 22px 20px; overflow-y: auto;
    color: #bbb; font-size: 12px; line-height: 1.65; z-index: 10;
}
.pix-lbl-help-overlay h3 { color: ${BRAND}; margin: 0 0 10px 0; font-size: 14px; }
.pix-lbl-help-overlay p { margin: 0 0 6px 0; }
.pix-lbl-help-overlay kbd {
    background: #2a2a2a; border: 1px solid #444; border-radius: 3px;
    padding: 1px 4px; font-size: 10px; font-family: monospace; color: #ccc;
}
.pix-lbl-help-close {
    position: absolute; top: 10px; right: 14px;
    background: none; border: none; color: #555; font-size: 18px; cursor: pointer;
}
.pix-lbl-help-close:hover { color: #ddd; }
.pix-lbl-btn-help { background: none; border: none; color: #555; font-size: 11px; padding: 6px 8px; margin-right: auto; }
.pix-lbl-btn-help:hover { color: #999; }
`;
  document.head.appendChild(style);
}
