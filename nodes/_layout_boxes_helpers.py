"""Layout Boxes Pixaroma - every decision the node makes, in one pure module.

No torch and no ComfyUI import: plain Python + Pillow + numpy, so all of it is
testable without a GPU (harness: D:\\Claude Tests\\_layout_boxes\\parity.py).

THE CONTRACT. The `elements` list must be exactly what ComfyUI's own
Create Bounding Boxes node sends (comfy_extras/nodes_bounding_boxes.py
build_elements + _norm_bbox), so FLUX.3 Layout Prompt and Build JSON Prompt
(Ideogram) read ours the same way:
  - one dict per box, keys in this order: type ("obj" or "text"), bbox,
    text (text boxes only), desc,
  - bbox = [ymin, xmin, ymax, xmax] on a 0..1000 grid of the CANVAS, each value
    Python round(fraction * 1000) clamped to 0..1000, ymin/ymax and xmin/xmax
    swapped when a box was stored upside down.
Core stores PIXELS and divides by the canvas size; we store the fractions
directly (x, y, w, h of the canvas), which is the same number for a box made
from pixels (px / width), so the grid values are identical. The harness proves
it on the Ep39 demo boxes plus a fuzz of random boxes.

Box colours are for the eye only (the face and the preview picture); they are
not part of the elements. MUST match js/layout_boxes/core.mjs COLORS.
"""

import json
import math

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

# Hard rails. /prompt takes any value as sent, so the hidden state can hold
# anything: every list and string is capped before it is walked.
MAX_BOXES = 64
MAX_DESC = 2000
MAX_TEXT = 500

# Box N takes COLORS[(N - 1) % len]. MUST match js/layout_boxes/core.mjs.
COLORS = (
    (255, 72, 72),     # red
    (56, 132, 255),    # blue
    (34, 197, 94),     # green
    (168, 85, 247),    # purple
    (250, 204, 21),    # yellow
    (6, 182, 212),     # cyan
    (236, 72, 153),    # pink
    (249, 115, 22),    # orange
)

PREVIEW_LONG_EDGE = 1024   # same cap as core's preview
BG_DIM = 0.6               # a picture behind the boxes is darkened so they read
EMPTY_RGB = (38, 38, 38)


def color_of(index):
    return COLORS[index % len(COLORS)]


MAX_COORD = 1e6   # far past any real box (the canvas is 0..1), small enough that x1000 still rounds


def _num(v):
    """A finite float within MAX_COORD, or None. A bool is not a number here.
    A 400-digit integer overflows float() and 1e306 overflows round(x * 1000),
    so both are refused here rather than failing the run later."""
    if isinstance(v, bool) or v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError, OverflowError):
        return None
    return f if math.isfinite(f) and abs(f) <= MAX_COORD else None


def _text(v, cap):
    return v[:cap].strip() if isinstance(v, str) else ""


def parse_state(raw):
    """The hidden LayoutState string (or dict) -> {"boxes": [...]}.

    Never raises: anything unreadable is dropped. Coordinates are kept exactly
    as stored (no clamp here): _norm_bbox clamps to the grid like core does,
    and clamping first would move a box that pokes past an edge."""
    data = raw
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", "ignore")
    if isinstance(raw, str):
        try:
            data = json.loads(raw) if raw.strip() else {}
        except (ValueError, TypeError, RecursionError):
            data = {}
    if not isinstance(data, dict):
        data = {}
    items = data.get("boxes")
    boxes = []
    if isinstance(items, list):
        for b in items[:MAX_BOXES]:
            if not isinstance(b, dict):
                continue
            x, y, w, h = (_num(b.get(k)) for k in ("x", "y", "w", "h"))
            if None in (x, y, w, h):
                continue
            etype = "text" if b.get("type") == "text" else "obj"
            boxes.append({
                "x": x, "y": y, "w": w, "h": h,
                "type": etype,
                "desc": _text(b.get("desc"), MAX_DESC),
                "text": _text(b.get("text"), MAX_TEXT) if etype == "text" else "",
            })
    return {"boxes": boxes}


def _norm_bbox(box):
    """core's _norm_bbox, verbatim in behaviour: [ymin, xmin, ymax, xmax] on 0..1000."""
    def grid(value):
        return max(0, min(1000, round(value * 1000)))

    x, y = box.get("x", 0.0), box.get("y", 0.0)
    w, h = box.get("w", 0.0), box.get("h", 0.0)
    ymin, xmin, ymax, xmax = grid(y), grid(x), grid(y + h), grid(x + w)
    if ymin > ymax:
        ymin, ymax = ymax, ymin
    if xmin > xmax:
        xmin, xmax = xmax, xmin
    return [ymin, xmin, ymax, xmax]


def build_elements(boxes):
    """core's build_elements for our boxes (no colour palettes: FLUX.3 ignores them)."""
    elements = []
    for box in boxes:
        etype = "text" if box.get("type") == "text" else "obj"
        element = {"type": etype, "bbox": _norm_bbox(box)}
        if etype == "text":
            element["text"] = box.get("text", "")
        element["desc"] = box.get("desc", "")
        elements.append(element)
    return elements


# ── the preview picture ────────────────────────────────────────────────────

def _font(path, size, weight):
    """Inter at `weight`, the optical size following the font size. Axes are set
    by NAME (sketch.md #17b: Inter lists optical size BEFORE weight, so a bare
    positional list sets the wrong axis). Falls back to Pillow's own font."""
    try:
        f = ImageFont.truetype(path, size=int(size))
    except Exception:
        try:
            return ImageFont.load_default(int(size))
        except Exception:
            return ImageFont.load_default()
    try:
        values = []
        for axis in f.get_variation_axes():
            name = axis.get("name", b"")
            name = (name.decode("utf-8", "ignore") if isinstance(name, bytes) else str(name)).lower()
            if name.startswith("weight"):
                want = weight
            elif name.startswith("optical"):
                want = int(size)
            else:
                want = axis.get("default", axis["minimum"])
            values.append(max(axis["minimum"], min(axis["maximum"], want)))
        if values:
            f.set_variation_by_axes(values)
    except Exception:
        pass
    return f


def preview_size(width, height, bg_size=None):
    """The preview's pixel size: the picture's (or the canvas's) shape, long edge
    capped at PREVIEW_LONG_EDGE."""
    w, h = bg_size if bg_size else (int(width), int(height))
    w, h = max(1, int(w)), max(1, int(h))
    scale = min(1.0, PREVIEW_LONG_EDGE / max(w, h))
    return max(1, round(w * scale)), max(1, round(h * scale))


def box_label(box):
    """What the preview writes inside a box: the exact words of a text box in
    quotes, then the description."""
    parts = []
    if box.get("type") == "text" and box.get("text"):
        parts.append('"%s"' % box["text"])
    if box.get("desc"):
        parts.append(box["desc"])
    return "  ".join(parts)


def _wrap(draw, text, font, max_w):
    lines = []
    for para in text.split("\n"):
        line = ""
        for word in para.split():
            test = word if not line else line + " " + word
            if line and draw.textlength(test, font=font) > max_w:
                lines.append(line)
                line = word
            else:
                line = test
        if line:
            lines.append(line)
    return lines


def render_preview(boxes, width, height, bg=None, font_path=None):
    """The boxes drawn over the picture (or a plain dark canvas), numbered like
    <obj_N>. `bg` is an HxWx3 uint8 array or None. Returns an HxWx3 uint8 array."""
    bg_size = (bg.shape[1], bg.shape[0]) if bg is not None else None
    rw, rh = preview_size(width, height, bg_size)
    if bg is not None:
        base = Image.fromarray(bg, "RGB").resize((rw, rh), Image.LANCZOS)
        base = ImageEnhance.Brightness(base).enhance(BG_DIM).convert("RGBA")
    else:
        base = Image.new("RGBA", (rw, rh), EMPTY_RGB + (255,))

    overlay = Image.new("RGBA", (rw, rh), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    short = min(rw, rh)
    lw = max(2, round(max(rw, rh) / 400))
    fs = max(11, round(short / 34))
    badge_font = _font(font_path, fs, 700)
    label_font = _font(font_path, fs, 600)

    for i, box in enumerate(boxes):
        r, g, b = color_of(i)
        x0 = rw * box["x"]
        y0 = rh * box["y"]
        x1 = rw * (box["x"] + box["w"])
        y1 = rh * (box["y"] + box["h"])
        x0, x1 = sorted((x0, x1))
        y0, y1 = sorted((y0, y1))
        x0, x1 = max(0, min(rw - 1, round(x0))), max(0, min(rw - 1, round(x1)))
        y0, y1 = max(0, min(rh - 1, round(y0))), max(0, min(rh - 1, round(y1)))
        draw.rectangle([x0, y0, x1, y1], fill=(r, g, b, 46), outline=(r, g, b, 255), width=lw)

        tag = str(i + 1)
        tw = draw.textlength(tag, font=badge_font)
        bw = max(fs + 8, round(tw) + 12)
        bh = fs + 8
        draw.rectangle([x0, y0, x0 + bw, y0 + bh], fill=(r, g, b, 255))
        dark = (0.299 * r + 0.587 * g + 0.114 * b) > 150
        draw.text((x0 + bw / 2, y0 + bh / 2), tag, fill=(17, 17, 17, 255) if dark else (255, 255, 255, 255),
                  font=badge_font, anchor="mm")

        label = box_label(box)
        if label and (x1 - x0) > 3 * fs:
            ty = y0 + bh + 4
            line_h = fs + 3
            for line in _wrap(draw, label, label_font, x1 - x0 - 10):
                if ty + line_h > y1:
                    break
                draw.text((x0 + 6, ty), line, fill=(255, 255, 255, 255), font=label_font,
                          stroke_width=max(1, fs // 8), stroke_fill=(0, 0, 0, 220))
                ty += line_h

    return np.asarray(Image.alpha_composite(base, overlay).convert("RGB"), dtype=np.uint8)
