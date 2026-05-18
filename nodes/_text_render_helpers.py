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
_BG_RADIUS = 6


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

    font_id = layer.get("font", "Inter")
    weight = int(layer.get("weight", 400))
    italic = bool(layer.get("italic", False))
    font_size = float(layer.get("fontSize", 96))
    line_height_mult = float(layer.get("lineHeight", 1.2))
    letter_spacing = float(layer.get("letterSpacing", 0))
    align = layer.get("align", "center")
    color_hex = layer.get("color", "#FFFFFF")
    opacity = float(layer.get("opacity", 1.0))
    rotation = float(layer.get("rotation", 0))
    bg_color = layer.get("bgColor")  # None or hex string

    pil_font, synthesized_italic = load_pil_font(font_id, weight, italic, font_size)

    lines = text.split("\n")
    line_widths = [_measure_line(pil_font, ln, letter_spacing) for ln in lines]
    max_line_w = max(line_widths) if line_widths else 0
    line_height_px = round(font_size * line_height_mult)

    pad_x = _BG_PAD_X if bg_color else 0
    pad_y = _BG_PAD_Y if bg_color else 0

    ascender, descender = pil_font.getmetrics()
    glyph_h = ascender + descender
    bbox_w = max(1, int(round(max_line_w + 2 * pad_x)))
    bbox_h = max(1, int(round(glyph_h + max(0, len(lines) - 1) * line_height_px + 2 * pad_y)))

    layer_img = Image.new("RGBA", (bbox_w, bbox_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer_img)

    # 1. Background pill (only if bgColor is set)
    if bg_color:
        bg_rgba = _hex_to_rgb(bg_color) + (255,)
        r = min(_BG_RADIUS, bbox_w // 2, bbox_h // 2)
        _round_rect(draw, 0, 0, bbox_w - 1, bbox_h - 1, r, bg_rgba)

    # 2. Fill text
    fill_color = _hex_to_rgb(color_hex) + (255,)
    for i, ln in enumerate(lines):
        lx = _line_origin_x(align, pad_x, max_line_w, line_widths[i])
        ly = pad_y + ascender + i * line_height_px
        _draw_line(draw, pil_font, ln, lx, ly, letter_spacing, fill_color)

    # 3. Synthesized italic skew
    if synthesized_italic:
        m = math.tan(math.radians(12))
        layer_img = layer_img.transform(
            layer_img.size, Image.AFFINE, (1, m, 0, 0, 1, 0),
            resample=Image.BICUBIC,
        )

    # 4. Layer-level opacity (final pass)
    if opacity < 1.0:
        alpha = layer_img.split()[-1]
        alpha = alpha.point(lambda a: int(a * opacity))
        layer_img.putalpha(alpha)

    # 5. Rotation (around bbox center)
    paste_x = int(round(layer.get("x", 0)))
    paste_y = int(round(layer.get("y", 0)))
    if rotation:
        before_w, before_h = layer_img.size
        layer_img = layer_img.rotate(-rotation, expand=True, resample=Image.BICUBIC)
        after_w, after_h = layer_img.size
        paste_x -= (after_w - before_w) // 2
        paste_y -= (after_h - before_h) // 2

    # 6. Composite onto base
    if base_img.mode != "RGBA":
        base_img = base_img.convert("RGBA")
    base_img.alpha_composite(layer_img, dest=(paste_x, paste_y))
    return base_img
