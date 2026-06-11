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

  // Vertical direction: stack characters per column (docs §5b). Font is already
  // loaded (fontStr); lineHeightPx = round(fontSize*lineHeight) IS the per-char
  // vertical step, letterSpacing IS the column gap.
  if (state.direction === "vertical") {
    return renderVerticalToCanvas(state, fontStr, lineHeightPx, letterSpacing);
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

/** Measure the rendered bbox {w, h} of state's text, direction-aware.
 *  `ctx.font` MUST already be set to the resolved variant's font string by the
 *  caller (font resolution differs between the node-body and editor callers).
 *  Mirrors the bbox math of renderTextToCanvas / renderVerticalToCanvas
 *  (docs §2 + §5b) EXCEPT the synthesized-italic slant widen, which the
 *  align/hit-test callers never accounted for (approximation predates this
 *  helper). Used by the Position-on-canvas buttons, auto-center, and the
 *  editor's align toolbar / drag bbox / Fit W / Fit H. */
export function measureTextDims(ctx, state) {
  const fontSize = state.fontSize || 96;
  const lines = String(state.text ?? "").split("\n");
  const letterSpacing = state.letterSpacing || 0;
  const stepPx = Math.round(fontSize * (state.lineHeight ?? 1.2));
  const m = ctx.measureText("Mg");
  const ascender = m.actualBoundingBoxAscent || fontSize * 0.78;
  const descender = m.actualBoundingBoxDescent || fontSize * 0.22;
  const padX = state.bgColor ? BG_PAD_X : 0;
  const padY = state.bgColor ? BG_PAD_Y : 0;

  if (state.direction === "vertical") {
    // Columns advance left-to-right; chars stack by stepPx; letterSpacing is
    // the column gap (docs §5b - lockstep with renderVerticalToCanvas).
    let totalColW = 0;
    let maxChars = 0;
    const cols = lines.map((line) => Array.from(line));
    for (const chars of cols) {
      let colW = 0;
      for (const ch of chars) colW = Math.max(colW, ctx.measureText(ch).width);
      totalColW += colW;
      maxChars = Math.max(maxChars, chars.length);
    }
    totalColW += Math.max(0, cols.length - 1) * letterSpacing;
    return {
      w: Math.max(1, Math.ceil(totalColW + 2 * padX)),
      h: Math.max(1, Math.ceil(ascender + descender + Math.max(0, maxChars - 1) * stepPx + 2 * padY)),
    };
  }

  const lineWidths = lines.map((ln) => {
    if (letterSpacing === 0) return ctx.measureText(ln).width;
    let w = 0;
    for (const ch of ln) w += ctx.measureText(ch).width;
    return w + Math.max(0, ln.length - 1) * letterSpacing;
  });
  const maxLineW = Math.max(0, ...lineWidths);
  return {
    w: Math.max(1, Math.ceil(maxLineW + 2 * padX)),
    h: Math.max(1, Math.ceil(ascender + descender + Math.max(0, lines.length - 1) * stepPx + 2 * padY)),
  };
}

/** Vertical (top-to-bottom, upright) text. Columns = lines, left-to-right.
 *  charStep = per-character vertical step; colGap = gap between columns.
 *  Mirror of nodes/_text_render_helpers.py::_render_vertical_layer. */
function renderVerticalToCanvas(state, fontStr, charStep, colGap) {
  const text = String(state.text ?? "");
  const lines = text.split("\n");
  const align = state.align || "center";

  const meas = document.createElement("canvas").getContext("2d");
  meas.font = fontStr;
  const m = meas.measureText("Mg");
  const ascender = m.actualBoundingBoxAscent || state.fontSize * 0.78;
  const descender = m.actualBoundingBoxDescent || state.fontSize * 0.22;

  const bgColor = state.bgColor || null;
  const padX = bgColor ? BG_PAD_X : 0;
  const padY = bgColor ? BG_PAD_Y : 0;

  // Per-column glyphs + max width
  const cols = lines.map((line) => {
    const chars = Array.from(line);
    let colW = 0;
    for (const ch of chars) colW = Math.max(colW, meas.measureText(ch).width);
    return { chars, colW };
  });
  const maxChars = Math.max(0, ...cols.map((c) => c.chars.length));
  const contentH = ascender + descender + Math.max(0, maxChars - 1) * charStep;
  const totalColW =
    cols.reduce((s, c) => s + c.colW, 0) + Math.max(0, cols.length - 1) * colGap;

  const bboxW = Math.max(1, Math.ceil(totalColW + 2 * padX));
  const bboxH = Math.max(1, Math.ceil(contentH + 2 * padY));

  const scratch = document.createElement("canvas");
  scratch.width = bboxW;
  scratch.height = bboxH;
  const sctx = scratch.getContext("2d");

  if (bgColor) {
    const r = Math.min(BG_RADIUS, bboxW / 2, bboxH / 2);
    sctx.save();
    sctx.fillStyle = bgColor;
    roundRect(sctx, 0, 0, bboxW, bboxH, r);
    sctx.fill();
    sctx.restore();
  }

  sctx.save();
  sctx.font = fontStr;
  sctx.textBaseline = "alphabetic";
  sctx.fillStyle = state.color || "#FFFFFF";
  let colOriginX = padX;
  for (const col of cols) {
    const colContentH =
      ascender + descender + Math.max(0, col.chars.length - 1) * charStep;
    const vOffset =
      align === "center" ? (contentH - colContentH) / 2
      : align === "right" ? contentH - colContentH
      : 0;
    for (let i = 0; i < col.chars.length; i++) {
      const ch = col.chars[i];
      const gw = meas.measureText(ch).width;
      const cx = colOriginX + (col.colW - gw) / 2;
      const ly = padY + vOffset + ascender + i * charStep;
      sctx.fillText(ch, cx, ly);
    }
    colOriginX += col.colW + colGap;
  }
  sctx.restore();

  return scratch;
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
