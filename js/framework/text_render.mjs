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

/** Render the text of `state` onto a fresh offscreen canvas sized to the text
 *  bbox. Returns the canvas (its width/height ARE the bbox). Async: font load.
 *  Used by renderTextLayer (Text Overlay) AND the Image Composer text layer.
 *
 *  @param {Object} state  text + font style — { text, font, weight, italic,
 *    fontSize, lineHeight, letterSpacing, align, color, bgColor }.
 *    Empty text → a 1x1 transparent canvas.
 *  @returns {Promise<HTMLCanvasElement>}
 */
export async function renderTextToCanvas(state) {
  const text = String(state.text ?? "");
  const variant = await loadFontForLayer(state.font, state.weight || 400, !!state.italic);
  const fontStr = canvasFontString(variant, state.fontSize);
  const lineHeightPx = Math.round(state.fontSize * (state.lineHeight ?? 1.2));
  const letterSpacing = state.letterSpacing ?? 0;

  if (!text) {
    const empty = document.createElement("canvas");
    empty.width = 1;
    empty.height = 1;
    return empty;
  }

  const lines = text.split("\n");

  // Measure each line + font metrics on a throwaway context.
  const meas = document.createElement("canvas").getContext("2d");
  meas.font = fontStr;
  const lineWidths = lines.map((line) => measureLine(meas, line, letterSpacing));
  const maxLineW = Math.max(0, ...lineWidths);
  const metrics = meas.measureText("Mg");
  const ascender = metrics.actualBoundingBoxAscent || state.fontSize * 0.78;
  const descender = metrics.actualBoundingBoxDescent || state.fontSize * 0.22;

  const bgColor = state.bgColor || null;
  const padX = bgColor ? BG_PAD_X : 0;
  const padY = bgColor ? BG_PAD_Y : 0;
  const bboxH = Math.max(1, Math.ceil(ascender + descender + Math.max(0, lines.length - 1) * lineHeightPx + 2 * padY));
  // Synthesized italic skews the bottom of glyphs LEFT by skew*bboxH. Widen the
  // bitmap by that overhang and translate drawing RIGHT by it so the lean isn't
  // clipped at the left edge. Mirror of nodes/_text_render_helpers.py.
  const skew = variant.synthesizedItalic ? Math.tan((12 * Math.PI) / 180) : 0;
  const slant = Math.ceil(skew * bboxH);
  const bboxW = Math.max(1, Math.ceil(maxLineW + 2 * padX) + slant);

  // Off-screen scratch canvas
  const scratch = document.createElement("canvas");
  scratch.width = bboxW;
  scratch.height = bboxH;
  const sctx = scratch.getContext("2d");

  // 1. Background pill — axis-aligned (NOT skewed) so synthesized-italic text
  //    leans inside a clean rectangle. The bbox is already widened by `slant`.
  if (bgColor) {
    const r = Math.min(BG_RADIUS, bboxW / 2, bboxH / 2);
    sctx.save();
    sctx.fillStyle = bgColor;
    roundRect(sctx, 0, 0, bboxW, bboxH, r);
    sctx.fill();
    sctx.restore();
  }

  // 2. Fill text — synthesized italic skews ONLY the text (+ slant translate),
  //    leaving the pill rectangular.
  sctx.save();
  if (skew) sctx.setTransform(1, 0, -skew, 1, slant, 0);
  sctx.font = fontStr;
  sctx.textBaseline = "alphabetic";
  sctx.fillStyle = state.color || "#FFFFFF";
  for (let i = 0; i < lines.length; i++) {
    const lx = lineOriginX(state.align, padX, maxLineW, lineWidths[i]);
    const ly = padY + ascender + i * lineHeightPx;
    drawLine(sctx, lines[i], lx, ly, letterSpacing);
  }
  sctx.restore();

  return scratch;
}

/** Render one text overlay onto the canvas context (Text Overlay node).
 *  Async because font must be loaded first.
 *
 *  @param {CanvasRenderingContext2D} ctx
 *  @param {Object} layer  text + font + position state — see DEFAULT_STATE in js/text_overlay/defaults.mjs for the shape
 */
export async function renderTextLayer(ctx, layer) {
  if (!layer) return;
  if (!String(layer.text ?? "")) return;
  const scratch = await renderTextToCanvas(layer);

  // Composite onto target ctx with position + rotation + opacity.
  ctx.save();
  ctx.translate(layer.x + scratch.width / 2, layer.y + scratch.height / 2);
  if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.translate(-scratch.width / 2, -scratch.height / 2);
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
