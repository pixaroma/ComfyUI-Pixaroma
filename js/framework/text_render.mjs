// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Text Render (browser canvas) — simplified          ║
// ║  Single text, no effects. Mirror of                          ║
// ║  nodes/_text_render_helpers.py::render_text_layer.           ║
// ║  Math doc: docs/text-overlay-render.md                       ║
// ╚═══════════════════════════════════════════════════════════════╝

import { loadFontForLayer, canvasFontString } from "./fonts.mjs";

// Hardcoded bg-pill defaults (user can't tune; spec §3, §4)
const BG_PAD_X = 16;
const BG_PAD_Y = 10;
const BG_RADIUS = 0;

/** Render one text overlay onto the canvas context.
 *  Async because font must be loaded first.
 *
 *  @param {CanvasRenderingContext2D} ctx
 *  @param {Object} layer  text + font + position state — see DEFAULT_STATE in js/text_overlay/defaults.mjs for the shape
 */
export async function renderTextLayer(ctx, layer) {
  if (!layer) return;
  const text = String(layer.text ?? "");
  if (!text) return;

  const variant = await loadFontForLayer(layer.font, layer.weight || 400, !!layer.italic);
  const fontStr = canvasFontString(variant, layer.fontSize);
  const lineHeightPx = Math.round(layer.fontSize * (layer.lineHeight ?? 1.2));
  const letterSpacing = layer.letterSpacing ?? 0;
  const lines = text.split("\n");

  // Measure each line + font metrics
  ctx.save();
  ctx.font = fontStr;
  const lineWidths = lines.map((line) => measureLine(ctx, line, letterSpacing));
  const maxLineW = Math.max(0, ...lineWidths);
  const metrics = ctx.measureText("Mg");
  const ascender = metrics.actualBoundingBoxAscent || layer.fontSize * 0.78;
  const descender = metrics.actualBoundingBoxDescent || layer.fontSize * 0.22;
  ctx.restore();

  const bgColor = layer.bgColor || null;
  const padX = bgColor ? BG_PAD_X : 0;
  const padY = bgColor ? BG_PAD_Y : 0;
  const bboxW = Math.max(1, Math.ceil(maxLineW + 2 * padX));
  const bboxH = Math.max(1, Math.ceil(ascender + descender + Math.max(0, lines.length - 1) * lineHeightPx + 2 * padY));

  // Off-screen scratch canvas
  const scratch = document.createElement("canvas");
  scratch.width = bboxW;
  scratch.height = bboxH;
  const sctx = scratch.getContext("2d");

  // Synthesized italic skew
  if (variant.synthesizedItalic) {
    sctx.setTransform(1, 0, -Math.tan((12 * Math.PI) / 180), 1, 0, 0);
  }

  // 1. Background pill
  if (bgColor) {
    const r = Math.min(BG_RADIUS, bboxW / 2, bboxH / 2);
    sctx.save();
    sctx.fillStyle = bgColor;
    roundRect(sctx, 0, 0, bboxW, bboxH, r);
    sctx.fill();
    sctx.restore();
  }

  // 2. Fill text
  sctx.save();
  sctx.font = fontStr;
  sctx.textBaseline = "alphabetic";
  sctx.fillStyle = layer.color || "#FFFFFF";
  for (let i = 0; i < lines.length; i++) {
    const lx = lineOriginX(layer.align, padX, maxLineW, lineWidths[i]);
    const ly = padY + ascender + i * lineHeightPx;
    drawLine(sctx, lines[i], lx, ly, letterSpacing);
  }
  sctx.restore();

  // 3. Composite onto target ctx with rotation + opacity
  ctx.save();
  ctx.translate(layer.x + bboxW / 2, layer.y + bboxH / 2);
  if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.translate(-bboxW / 2, -bboxH / 2);
  ctx.globalAlpha = layer.opacity ?? 1;
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

// ── helpers ───────────────────────────────────────────────────────────────────

function measureLine(ctx, text, letterSpacing) {
  if (letterSpacing === 0) return ctx.measureText(text).width;
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width;
  return w + Math.max(0, text.length - 1) * letterSpacing;
}

function drawLine(ctx, text, x, y, letterSpacing) {
  if (letterSpacing === 0) { ctx.fillText(text, x, y); return; }
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + letterSpacing;
  }
}

function lineOriginX(align, padX, maxLineW, lineW) {
  if (align === "right") return padX + (maxLineW - lineW);
  if (align === "center") return padX + (maxLineW - lineW) / 2;
  return padX;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
