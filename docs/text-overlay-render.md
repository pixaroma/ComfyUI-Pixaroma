# Text Overlay Render Math

Single source of truth for the rendering algorithm used by:
- `js/framework/text_render.mjs` (browser canvas)
- `nodes/_text_render_helpers.py` (PIL backend)

ANY change to these formulas MUST update this doc first, then both implementations, then re-run `scripts/text_overlay_parity_check.py`.

## 1. Font Resolution

Given `(font_id, weight, italic)`:
1. Walk the catalog's `weights` array for the font with matching `id`
2. If exact match (`weight == w && italic == i`): use it
3. If italic variant unavailable: try non-italic at same weight (mark `synthesizedItalic = true`)
4. If weight unavailable: pick closest available weight by absolute distance
5. If font_id not in catalog: fall back to `Inter` with same weight rules
6. If even Inter missing: hard error (won't happen with bundled set, but defensive)

Synthesized italic is rendered by skewing the canvas/PIL transform by ~12° horizontally. Used when an italic variant isn't bundled (e.g. Inter doesn't ship italic in our bundle).

## 1b. Variable Font Handling

Most bundled fonts are variable (one file covers many weights via the `wght` axis). The catalog entry has a `wght` field; the renderer activates this axis at draw time:

- **Browser canvas**: the FontFace is loaded with `weight: "100 900"` (the variable range), then `ctx.font = "<weight> <size>px <family>"` selects the right weight from the variable instance automatically. No extra code needed.
- **Python PIL**: `font = ImageFont.truetype(file, size); font.set_variation_by_axes([wght])`. PIL 8.0+ supports this. Wrap in try/except since static fonts (Bebas Neue, Anton) don't have variation axes and the call would error.

A static font (no `wght` field in the catalog entry) skips the variation step. Renderers must handle BOTH variable and static files in the same code path.

## 2. Text Measurement

For each line `text_i` in `text.split("\n")`:
- Set font to (resolvedFile, fontSize, wght)
- Browser: `ctx.measureText(text_i).width`, then add `letterSpacing * (text_i.length - 1)` for the per-glyph gaps
- Python: sum of `font.getlength(c)` per character, plus `letterSpacing * (len - 1)`
- `line_width_i = measured + spacing_pad`

Native browser canvas does NOT honor CSS `letter-spacing`. We add it manually by drawing each character separately when `letterSpacing != 0`. PIL has no letter-spacing at all, so we always draw per-character when `letterSpacing != 0` on the Python side.

When `letterSpacing == 0` (the common case), both sides draw the line as a single string for performance.

`lineHeight_px = round(fontSize * lineHeight)` where `lineHeight` is the multiplier (default 1.2).

`bbox_width = max(line_width_i for i in lines)`
`bbox_height = lineHeight_px * lineCount`

## 3. Background Pill Bbox

When `layer.background != null`:
- `bbox_width += 2 * background.paddingX`
- `bbox_height += 2 * background.paddingY`
- text origin shifts: text starts at `(paddingX, paddingY)` inside the bbox

## 4. Transform (Rotation)

Layer position `(x, y)` is the top-left of the UNROTATED bbox in canvas coordinates.

Both renderers must apply:
1. `translate(x + bbox_width / 2, y + bbox_height / 2)` (move to bbox center)
2. `rotate(rotation_degrees * pi / 180)`
3. `translate(-bbox_width / 2, -bbox_height / 2)` (back so (0,0) is bbox top-left)

After this, all drawing is in local bbox coordinates with (0,0) at bbox top-left.

PIL doesn't have a transform stack like canvas; we render the whole layer to a separate RGBA image at `bbox_width × bbox_height`, then rotate that image around its center with `Image.rotate(-rotation_degrees, expand=True, resample=BICUBIC)`, and paste onto base at `(x - delta_x, y - delta_y)` where `(delta_x, delta_y)` is the expansion offset caused by `expand=True`.

## 5. Draw Order (z, bottom to top)

For each layer (in the order `state.layers` lists them; first = bottom):
1. **Background pill** if set: rounded rect from `(0, 0)` to `(bbox_width, bbox_height)` with radius clamped to `min(bbox_width, bbox_height) / 2`, filled with `background.color` at `background.opacity`
2. **Shadow** if set: draw the text strings at their per-line positions BUT offset by `(shadow.offsetX, shadow.offsetY)`, filled with `shadow.color`, then Gaussian-blur with radius = `shadow.blur`, alpha-multiplied by `shadow.opacity`
3. **Stroke** if set: draw the text strings at their per-line positions with stroke `stroke.color` and width `stroke.width` (canvas: `ctx.strokeText`; PIL: `stroke_width` parameter to `draw.text` with `stroke_fill = stroke.color`)
4. **Fill**: draw the text strings at their per-line positions with `layer.color`

Each line's draw position (after the bbox-local transform):
- baseline y: `paddingY + i * lineHeight_px + ascender_offset` where `i` is the 0-based line index
- x position varies by alignment:
  - `align == "left"`: `paddingX`
  - `align == "center"`: `paddingX + (max_line_width - line_width_i) / 2`
  - `align == "right"`: `paddingX + (max_line_width - line_width_i)`

`ascender_offset` is the font's ascender height; both sides query the font metrics for this (canvas: `actualBoundingBoxAscent`, PIL: `font.getmetrics()[0]`).

## 6. Opacity (Final Pass)

`layer.opacity` (0..1) is applied to the entire layer composition AFTER drawing background + shadow + stroke + fill. This ensures shadow doesn't double-multiply with fill alpha.

Browser canvas: render whole layer to a temporary canvas, then `ctx.globalAlpha = layer.opacity; ctx.drawImage(tempCanvas, x, y)`.

PIL: render whole layer to its own RGBA image (already what we do for rotation), then `Image.eval(img, lambda a: int(a * layer.opacity))` on the alpha channel before pasting.

When `layer.opacity == 1.0` (the common case), skip the temp-canvas / alpha-eval step for performance.

## 7. Skipping Invisible Layers

If `layer.visible == false`: skip the whole layer entirely (no draw at all). The editor still shows a placeholder bbox + dimmed name in the layers panel, but the renderer is a no-op.

## 8. Color Format

All `color` fields are 6-char hex strings (`"#RRGGBB"`). Renderers convert to their native format (canvas: pass as-is; PIL: parse to `(R, G, B)` tuple, then combine with the opacity to form RGBA).

## 9. Parity Tolerance

The parity script (`scripts/text_overlay_parity_check.py`) renders ~10 reference configs through the Python implementation and diffs against committed goldens. Tolerance: under 2% of pixels may deviate by ΔE > 10. This accounts for inevitable rasterizer differences (the OS font hinter vs FreeType) while still catching real regressions.

Bit-exact match between the JS canvas and PIL renderers is impossible (different rasterizers). The goldens lock the Python output only; the JS side is checked visually by the human at editor save-time (the in-node thumbnail and the workflow output should match).

## 10. Known Approximations

- Synthesized italic skew differs slightly between canvas (transform matrix) and PIL (Image transform). Both produce ~12° lean but the kerning between characters can differ by a few pixels. Acceptable.
- Gaussian blur for shadows uses different kernels (canvas uses GPU blur, PIL uses CPU NumPy convolution). Output is visually equivalent within ΔE tolerance.
- Sub-pixel positioning (when `x` or `y` is fractional) is rounded to nearest integer pixel in both renderers to avoid hair-line offset drift.
- Variable font rendering: the browser's variable-font rasterizer and PIL's `set_variation_by_axes` use different interpolation paths between named instances. Differences are typically subtle but real.
