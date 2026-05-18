# Text Overlay Render Math (Simplified)

Single source of truth for the rendering algorithm used by:
- `js/framework/text_render.mjs` (browser canvas)
- `nodes/_text_render_helpers.py` (PIL backend)

ANY change to these formulas MUST update this doc first, then both implementations, then re-run `scripts/text_overlay_parity_check.py`.

This is the SIMPLIFIED (v2) renderer. The multi-layer / effects version had §11 (transform stack) and §12 (blend modes); both removed.

## 1. Font Resolution

Given `(font_id, weight, italic)`:
1. Walk catalog's `weights` for the font with matching `id`
2. Exact match (`weight == w && italic == i`) → use it
3. Italic variant unavailable → try non-italic at same weight (mark `synthesizedItalic = true`)
4. Weight unavailable → pick closest weight by absolute distance
5. font_id not in catalog → fall back to `Inter`
6. Even Inter missing → hard error

Synthesized italic skews canvas/PIL transform by 12° horizontally.

## 1b. Variable Font Handling

Most bundled fonts are variable. Catalog entry has a `wght` field activated at draw time. Browser: FontFace loaded with `weight: "100 900"`, canvas font string picks weight. Python PIL: `font.set_variation_by_axes([wght])` after truetype load. Static fonts (Bebas Neue, Anton) skip the axis step.

## 2. Text Measurement

For each line in `text.split("\n")`:
- Set font to (resolvedFile, fontSize)
- Browser: `ctx.measureText(line).width`, plus per-glyph letter-spacing if non-zero
- Python: `font.getlength` per character, plus letter-spacing
- `line_width_i = measured + max(0, len-1) * letter_spacing`

Native canvas does NOT honor CSS letter-spacing. We add it manually by drawing each character separately when `letterSpacing != 0`. PIL has no letter-spacing; always per-character draw when non-zero.

`lineHeight_px = round(fontSize * lineHeight)` (multiplier, default 1.2).

`bbox_width = max(line_width_i) + 2 * padX`  (padX = 16 if bgColor else 0)
`bbox_height = ascender + descender + (lineCount - 1) * lineHeight_px + 2 * padY`  (padY = 10 if bgColor else 0)

`ascender + descender` is the visible glyph extent (font metrics via `measureText("Mg")` / `font.getmetrics()`). lineHeight multiplier adds spacing BETWEEN lines only.

## 3. Background Pill

When `layer.bgColor` is a hex string (not null / not empty):
- Filled rounded rect at `(0, 0)` to `(bbox_width, bbox_height)`
- Radius: `min(BG_RADIUS, bbox_width/2, bbox_height/2)` where `BG_RADIUS = 6`
- Color: `bgColor` opaque (no alpha — pill is always full alpha; the layer's `opacity` applies to the whole composition including the pill)

Hardcoded defaults: `BG_PAD_X = 16`, `BG_PAD_Y = 10`, `BG_RADIUS = 6`. No user controls for these in v2.

## 4. Draw Order

For the single text:
1. **Background pill** (if `bgColor` set, see §3)
2. **Fill text**: for each line at `(lineOriginX, padY + ascender + i * lineHeightPx)` with `layer.color`

Then transforms (§5).

`lineOriginX`:
- align "left" → `padX`
- align "center" → `padX + (max_line_width - line_width_i) / 2`
- align "right" → `padX + (max_line_width - line_width_i)`

## 5. Transform (Opacity + Rotation)

Layer position `(x, y)` is the top-left of the UNROTATED bbox in canvas coordinates. Rotation pivots around the bbox center.

Browser:
1. Render bg pill + text to a scratch canvas at `bboxW × bboxH`
2. `ctx.save()` → `translate(x + bboxW/2, y + bboxH/2)` → `rotate(rot * π / 180)` → `translate(-bboxW/2, -bboxH/2)`
3. `ctx.globalAlpha = layer.opacity` → `drawImage(scratch, 0, 0)` → `ctx.restore()`

Python:
1. Render bg pill + text to `layer_img = Image.new("RGBA", (bboxW, bboxH))`
2. Synthesized italic skew (if needed)
3. Apply opacity: alpha = `alpha.point(lambda a: int(a * opacity))`, `layer_img.putalpha(alpha)` (skip if opacity == 1.0)
4. Rotate: `layer_img.rotate(-rotation, expand=True, resample=BICUBIC)` (compensate paste origin for `expand=True` growth)
5. `base_img.alpha_composite(layer_img, dest=(paste_x, paste_y))`

## 6. Color Format

All `color` and `bgColor` fields are 6-char hex strings (`"#RRGGBB"`). `bgColor` is `null` (or empty string) when no pill.

## 7. Parity Tolerance

`scripts/text_overlay_parity_check.py` renders 10 reference configs through the Python renderer and diffs against committed goldens. Tolerance: under 2% of pixels may deviate by ΔE > 10. Goldens lock the Python output; JS side checked visually by the human at editor save time.

## 8. Known Approximations

- Synthesized italic skew differs slightly between canvas (matrix transform) and PIL (Image transform). Acceptable.
- Sub-pixel positioning rounded to nearest integer pixel in both renderers.
- Variable font interpolation: browser's variable-font rasterizer and PIL's `set_variation_by_axes` use different interpolation paths.
