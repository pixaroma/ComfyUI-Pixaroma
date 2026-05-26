"""Text Overlay Pixaroma render engine (PIL backend).

Mirror of js/framework/text_render.mjs. Both implementations MUST follow the
algorithm in docs/text-overlay-render.md. Parity is enforced by
scripts/text_overlay_parity_check.py.
"""
from __future__ import annotations
import os
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from functools import lru_cache

# Resolve plugin root (this file is at nodes/_text_render_helpers.py)
_PLUGIN_ROOT = Path(__file__).resolve().parent.parent
_FONTS_DIR = _PLUGIN_ROOT / "assets" / "fonts"

# Bundle catalog. Mirror of server_routes.py::pixaroma_fonts_list BUNDLE.
# (file, id, weight, italic, label, category, wght_axis|None)
# For variable fonts (wght_axis not None), font.set_variation_by_axes is called
# at load time. For static fonts (wght_axis None), no variation step.
_BUNDLE = [
    ("Inter-Variable.ttf",                  "Inter",            400, False, "Inter",            "sans",        400),
    ("Inter-Variable.ttf",                  "Inter",            700, False, "Inter",            "sans",        700),
    ("Roboto-Variable.ttf",                 "Roboto",           400, False, "Roboto",           "sans",        400),
    ("Roboto-Variable.ttf",                 "Roboto",           700, False, "Roboto",           "sans",        700),
    ("Montserrat-Variable.ttf",             "Montserrat",       400, False, "Montserrat",       "sans",        400),
    ("Montserrat-Variable.ttf",             "Montserrat",       800, False, "Montserrat",       "sans",        800),
    ("Oswald-Variable.ttf",                 "Oswald",           600, False, "Oswald",           "sans",        600),
    ("PlayfairDisplay-Variable.ttf",        "PlayfairDisplay",  700, False, "Playfair Display", "serif",       700),
    ("PlayfairDisplay-Italic-Variable.ttf", "PlayfairDisplay",  700, True,  "Playfair Display", "serif",       700),
    ("Lora-Variable.ttf",                   "Lora",             400, False, "Lora",             "serif",       400),
    ("Lora-Variable.ttf",                   "Lora",             700, False, "Lora",             "serif",       700),
    ("BebasNeue-Regular.ttf",               "BebasNeue",        400, False, "Bebas Neue",       "display",     None),
    ("Anton-Regular.ttf",                   "Anton",            400, False, "Anton",            "display",     None),
    ("Caveat-Variable.ttf",                 "Caveat",           500, False, "Caveat",           "handwriting", 500),
    ("JetBrainsMono-Variable.ttf",          "JetBrainsMono",    500, False, "JetBrains Mono",   "mono",        500),
]


def _get_catalog():
    """Return [{id, label, category, weights:[{weight, italic, file, wght?}]}],
    grouped + filtered to files that exist on disk."""
    grouped = {}
    for filename, font_id, weight, italic, label, category, wght_axis in _BUNDLE:
        if not (_FONTS_DIR / filename).is_file():
            continue
        bucket = grouped.setdefault(font_id, {"id": font_id, "label": label, "category": category, "weights": []})
        entry = {"weight": weight, "italic": italic, "file": filename}
        if wght_axis is not None:
            entry["wght"] = wght_axis
        bucket["weights"].append(entry)
    return list(grouped.values())


def resolve_font_variant(font_id: str, weight: int, italic: bool):
    """Best-match per math doc section 1. Returns dict with file path + flags."""
    catalog = _get_catalog()
    font = next((f for f in catalog if f["id"] == font_id), None)
    if not font:
        font = next((f for f in catalog if f["id"] == "Inter"), None)
        if not font:
            raise RuntimeError("No fonts in catalog (assets/fonts/ empty?). Run scripts/download_fonts.py")
    # exact
    for v in font["weights"]:
        if v["weight"] == weight and v["italic"] == bool(italic):
            return {"file": v["file"], "weight": v["weight"], "italic": v["italic"],
                    "wght": v.get("wght"), "synthesized_italic": False}
    # italic flip
    if italic:
        for v in font["weights"]:
            if v["weight"] == weight and not v["italic"]:
                return {"file": v["file"], "weight": v["weight"], "italic": False,
                        "wght": v.get("wght"), "synthesized_italic": True}
    # closest weight (italic preference if available)
    same = [v for v in font["weights"] if v["italic"] == bool(italic)]
    pool = same if same else font["weights"]
    pool = sorted(pool, key=lambda v: abs(v["weight"] - weight))
    v = pool[0]
    return {"file": v["file"], "weight": v["weight"], "italic": v["italic"],
            "wght": v.get("wght"), "synthesized_italic": bool(italic) and not v["italic"]}


@lru_cache(maxsize=128)
def _cached_pil_font(file: str, size: int, wght: int):
    """Cache PIL ImageFont instances per (file, size, wght) for the process lifetime.
    For variable fonts (wght != 0), activate the wght axis after load."""
    f = ImageFont.truetype(str(_FONTS_DIR / file), size=int(size))
    if wght:
        try:
            f.set_variation_by_axes([wght])
        except Exception:
            # Static font without variation axes — silently fall through; getlength still works
            pass
    return f


def load_pil_font(font_id: str, weight: int, italic: bool, size: int):
    """Returns (PIL.ImageFont.FreeTypeFont, synthesized_italic_bool)."""
    variant = resolve_font_variant(font_id, weight, italic)
    wght = variant.get("wght") or 0
    return _cached_pil_font(variant["file"], int(round(size)), wght), variant["synthesized_italic"]


# ────────────────────────────────────────────────────────────────────────────
# Rendering
# ────────────────────────────────────────────────────────────────────────────

def _hex_to_rgb(hex_str: str):
    h = hex_str.lstrip("#")
    if len(h) != 6:
        return (0, 0, 0)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _measure_line(font, text, letter_spacing):
    if letter_spacing == 0:
        return font.getlength(text)
    w = sum(font.getlength(c) for c in text)
    return w + max(0, len(text) - 1) * letter_spacing


def _line_origin_x(align, pad_x, max_line_w, line_w):
    if align == "right":
        return pad_x + (max_line_w - line_w)
    if align == "center":
        return pad_x + (max_line_w - line_w) / 2.0
    return pad_x


def _draw_line(draw, font, text, x, y, letter_spacing, color, stroke_width=0, stroke_fill=None):
    """Draw one line at baseline (x, y). Supports per-character draw for letter-spacing.
    Uses anchor='ls' (left baseline) to match the JS canvas 'alphabetic' baseline."""
    if letter_spacing == 0:
        kwargs = {"font": font, "fill": color, "anchor": "ls"}
        if stroke_width:
            kwargs["stroke_width"] = stroke_width
            kwargs["stroke_fill"] = stroke_fill
        draw.text((x, y), text, **kwargs)
        return
    cx = x
    for ch in text:
        kwargs = {"font": font, "fill": color, "anchor": "ls"}
        if stroke_width:
            kwargs["stroke_width"] = stroke_width
            kwargs["stroke_fill"] = stroke_fill
        draw.text((cx, y), ch, **kwargs)
        cx += font.getlength(ch) + letter_spacing


def _round_rect(draw, x, y, w, h, r, fill):
    """Filled rounded rect via PIL's rounded_rectangle (8.2.0+, always present in modern ComfyUI)."""
    draw.rounded_rectangle((x, y, x + w, y + h), radius=r, fill=fill)


# ────────────────────────────────────────────────────────────────────────────
# Hardcoded bg-pill defaults (user can't tune; spec §3, §4)
# ────────────────────────────────────────────────────────────────────────────
_BG_PAD_X = 16
_BG_PAD_Y = 10
_BG_RADIUS = 0


def compute_text_bbox(layer):
    """Return (bbox_w, bbox_h) for the rendered layer, in pixels.
    Used by the graphToPrompt-time auto-center path in node_text_overlay.py
    so we can pre-position a fresh node based on the upstream image dims
    without going through the full render_text_layer pipeline.
    Matches the math in render_text_layer exactly."""
    text = str(layer.get("text", ""))
    if not text:
        return (0, 0)
    font_id = layer.get("font", "Roboto")
    weight = int(layer.get("weight", 400))
    italic = bool(layer.get("italic", False))
    font_size = float(layer.get("fontSize", 64))
    line_height_mult = float(layer.get("lineHeight", 1.2))
    letter_spacing = float(layer.get("letterSpacing", 0))
    bg_color = layer.get("bgColor")

    pil_font, _ = load_pil_font(font_id, weight, italic, font_size)
    lines = text.split("\n")
    line_widths = [_measure_line(pil_font, ln, letter_spacing) for ln in lines]
    max_line_w = max(line_widths) if line_widths else 0
    line_height_px = round(font_size * line_height_mult)
    pad_x = _BG_PAD_X if bg_color else 0
    pad_y = _BG_PAD_Y if bg_color else 0
    try:
        left, top, right, bottom = pil_font.getbbox("Mg", anchor="ls")
        ascender = max(0, -top)
        descender = max(0, bottom)
    except TypeError:
        ascender, descender = pil_font.getmetrics()
    glyph_h = ascender + descender
    bbox_w = max(1, int(round(max_line_w + 2 * pad_x)))
    bbox_h = max(1, int(round(glyph_h + max(0, len(lines) - 1) * line_height_px + 2 * pad_y)))
    return (bbox_w, bbox_h)


def render_text_layer(base_img, layer):
    """Render one text overlay onto base_img (PIL.Image, RGBA, mutated in place).

    Mirror of js/framework/text_render.mjs::renderTextLayer.
    Algorithm: docs/text-overlay-render.md.

    Single-text-only (no layers param, no effects). Schema fields supported:
    text, font, weight, italic, align, fontSize, lineHeight, letterSpacing,
    x, y, rotation, opacity, color, bgColor.
    """
    if not layer:
        return base_img
    text = str(layer.get("text", ""))
    if not text:
        return base_img

    # Defaults intentionally match js/text_overlay/defaults.mjs DEFAULT_STATE
    # so a state dict with missing keys renders identically in editor + output.
    font_id = layer.get("font", "Roboto")
    weight = int(layer.get("weight", 400))
    italic = bool(layer.get("italic", False))
    font_size = float(layer.get("fontSize", 64))
    line_height_mult = float(layer.get("lineHeight", 1.2))
    letter_spacing = float(layer.get("letterSpacing", 0))
    align = layer.get("align", "center")
    color_hex = layer.get("color", "#FFFFFF")
    opacity = float(layer.get("opacity", 1.0))
    rotation = float(layer.get("rotation", 0))
    bg_color = layer.get("bgColor")  # None or hex string

    # Supersample factor for rotation: render the layer at SS x intended
    # size, rotate at the larger size, then downsample with LANCZOS for
    # proper anti-aliased diagonal edges. PIL's Image.rotate caps out at
    # BICUBIC which still leaves stair-step pixels along rotated edges of
    # the bg pill / text bounding box. Supersampling gives the LANCZOS
    # downsample enough pixels to average for smooth edges.
    # Skip supersampling when no rotation — the 1x render is already
    # crisp and we'd just waste memory + time.
    ss = 3 if rotation else 1

    font_size_eff = font_size * ss
    letter_spacing_eff = letter_spacing * ss

    pil_font, synthesized_italic = load_pil_font(font_id, weight, italic, font_size_eff)

    lines = text.split("\n")
    line_widths = [_measure_line(pil_font, ln, letter_spacing_eff) for ln in lines]
    max_line_w = max(line_widths) if line_widths else 0
    line_height_px = round(font_size_eff * line_height_mult)

    pad_x = (_BG_PAD_X * ss) if bg_color else 0
    pad_y = (_BG_PAD_Y * ss) if bg_color else 0

    # Use the ACTUAL ink bounding box of "Mg" RELATIVE TO THE BASELINE
    # so the values match canvas measureText("Mg").actualBoundingBox*
    # used by the JS renderer. CRITICAL: pass anchor="ls" (left
    # baseline). Without it, getbbox defaults to anchor="la" (left
    # ascender top) and the returned `top` is a POSITIVE offset from
    # the font's ascender line down to the visible glyph top — not the
    # negative ascender-from-baseline we want. Misreading that as a
    # negative ascender caused ascender=0 and text was drawn mostly
    # ABOVE the layer_img (clipped) instead of inside it. Fall back to
    # getmetrics() for very old PIL builds that don't support the
    # anchor parameter on getbbox.
    try:
        left, top, right, bottom = pil_font.getbbox("Mg", anchor="ls")
        ascender  = max(0, -top)     # top is negative for glyphs above baseline
        descender = max(0, bottom)   # bottom is positive for glyphs below baseline
    except TypeError:
        ascender, descender = pil_font.getmetrics()
    glyph_h = ascender + descender
    bbox_w = max(1, int(round(max_line_w + 2 * pad_x)))
    bbox_h = max(1, int(round(glyph_h + max(0, len(lines) - 1) * line_height_px + 2 * pad_y)))

    layer_img = Image.new("RGBA", (bbox_w, bbox_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer_img)

    # 1. Background pill (only if bgColor is set)
    if bg_color:
        bg_rgba = _hex_to_rgb(bg_color) + (255,)
        r = min(_BG_RADIUS * ss, bbox_w // 2, bbox_h // 2)
        _round_rect(draw, 0, 0, bbox_w - 1, bbox_h - 1, r, bg_rgba)

    # 2. Fill text
    fill_color = _hex_to_rgb(color_hex) + (255,)
    for i, ln in enumerate(lines):
        lx = _line_origin_x(align, pad_x, max_line_w, line_widths[i])
        ly = pad_y + ascender + i * line_height_px
        _draw_line(draw, pil_font, ln, lx, ly, letter_spacing_eff, fill_color)

    # 3. Synthesized italic skew. The skew shifts the bottom of glyphs LEFT by
    # m*bbox_h; widen the canvas by that overhang and shift content RIGHT by it
    # (AFFINE c = -slant) so the lean isn't clipped at the left edge. Mirror of
    # js/framework/text_render.mjs.
    if synthesized_italic:
        m = math.tan(math.radians(12))
        slant = int(math.ceil(m * bbox_h))
        layer_img = layer_img.transform(
            (bbox_w + slant, bbox_h), Image.AFFINE, (1, m, -slant, 0, 1, 0),
            resample=Image.BICUBIC,
        )
        bbox_w = bbox_w + slant

    # 4. Layer-level opacity (final pass)
    if opacity < 1.0:
        alpha = layer_img.split()[-1]
        alpha = alpha.point(lambda a: int(a * opacity))
        layer_img.putalpha(alpha)

    # 5. Rotation (around bbox center). When supersampling (rotation
    # branch), rotate at SS resolution then downsample to 1x with
    # LANCZOS for anti-aliased edges.
    paste_x = int(round(layer.get("x", 0)))
    paste_y = int(round(layer.get("y", 0)))
    if rotation:
        layer_img = layer_img.rotate(-rotation, expand=True, resample=Image.BICUBIC)
        after_w_ss, after_h_ss = layer_img.size
        # Downsample to 1x
        target_w = max(1, round(after_w_ss / ss))
        target_h = max(1, round(after_h_ss / ss))
        layer_img = layer_img.resize((target_w, target_h), Image.LANCZOS)
        # paste offset uses the 1x equivalent bbox
        bbox_w_1x = max(1, round(bbox_w / ss))
        bbox_h_1x = max(1, round(bbox_h / ss))
        paste_x -= (target_w - bbox_w_1x) // 2
        paste_y -= (target_h - bbox_h_1x) // 2

    # 6. Composite onto base
    if base_img.mode != "RGBA":
        base_img = base_img.convert("RGBA")
    base_img.alpha_composite(layer_img, dest=(paste_x, paste_y))
    return base_img
