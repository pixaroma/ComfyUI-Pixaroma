"""Sketch Pixaroma - every decision the node makes, in one pure module.

No torch and no ComfyUI import: plain Python + Pillow + numpy, so all of it is
testable without a GPU (harness: D:\\Claude Tests\\_sketch_test.py).

The browser MIRRORS parts of this and the two must never drift
(js/sketch/core.mjs + js/sketch/draw.mjs):
  - COLORS, WIDTHS and the geometry constants below,
  - build_prompt, including the left/right wording for repeated marks,
  - the freehand curve (smooth_path) and the arrow head (arrow_geometry).
Whether a freehand stroke is a CLOSED loop is decided once, in the browser,
when the stroke is drawn, and stored on the mark ("closed"). Python trusts that
flag, so it can never judge the same stroke differently from what the user saw.

Coordinates arrive normalised: x as a fraction of the picture's width, y of its
height. Line width is a fraction of the picture's LONG side, so a mark looks the
same on a 512 and on a 4K picture.
"""

import json
import math
import re
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# name -> RGB. The NAME is what the prompt says, so it must be a word an edit
# model understands. MUST match js/sketch/core.mjs.
COLORS = {
    "red": (255, 43, 43),
    "blue": (43, 123, 255),
    "green": (22, 195, 90),
    "purple": (160, 70, 255),
    "yellow": (255, 210, 26),
    "white": (255, 255, 255),
    "black": (17, 17, 17),
}
# line width as a fraction of the picture's long side. MUST match core.mjs.
WIDTHS = {"S": 0.006, "M": 0.010, "L": 0.016, "XL": 0.030}
TYPES = ("box", "ellipse", "pen", "arrow", "text")

# Hard rails. /prompt takes any value as sent, so the hidden state can hold
# anything: every list is capped before it is walked.
MAX_MARKS = 64
MAX_POINTS = 4000
MAX_TEXT = 60
MAX_NOTE = 400

MIN_LINE_PX = 2.0
TEXT_SCALE = 5.2      # text height = line width x this
TEXT_BASELINE = 0.35  # the click is the text's vertical middle: baseline = y + size x this
HEAD_SCALE = 4.2      # arrow head length = line width x this
HEAD_HALF = 0.45      # arrow head half-angle, radians
HEAD_MIN = 6.0        # px
PAD = 2.0             # px of slack around every mark's box, for anti-aliasing

REMOVE_LINE = "Remove all the colored marks and keep everything else the same."

# Supersampling budget for the anti-aliased edges: the coverage layer of one
# mark may hold at most this many pixels at the raised resolution (8-bit, so
# 48 MB), which caps a full-frame box on an 8K picture without refusing it.
_SS_BUDGET = 48_000_000


# ── reading the hidden state ────────────────────────────────────────────────
def _num(v):
    if isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _point(p):
    if not isinstance(p, (list, tuple)) or len(p) < 2:
        return None
    x, y = _num(p[0]), _num(p[1])
    if x is None or y is None:
        return None
    return (min(1.0, max(0.0, x)), min(1.0, max(0.0, y)))


# The browser's whitespace set (ECMAScript WhiteSpace + LineTerminator), copied
# from _prompt_each_helpers._JS_WS where it was verified code point by code
# point against V8. Python's own str.split() uses a DIFFERENT set (it adds
# U+001C..U+001F and U+0085, and leaves out U+FEFF), so splitting with it would
# let the prompt Python writes differ from the preview the node shows.
# Written as escapes: this file stays pure ASCII (convention #25).
_JS_WS = (
    "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)
_WS_RUN = re.compile("[" + re.escape(_JS_WS) + "]+")


def _one_line(s, cap):
    """Collapse every run of whitespace to one space and cap the length, the
    same way js/sketch/core.mjs oneLine() does (cap counted in code points)."""
    if not isinstance(s, str):
        return ""
    return " ".join(p for p in _WS_RUN.split(s) if p)[:cap]


def parse_state(raw):
    """Whatever arrives on the hidden input -> {"marks": [...], "remove_marks": bool}.

    Anything unreadable is DROPPED, never raised: a broken mark must not stop a
    run, and with no marks at all the node simply passes the picture through.
    """
    data = raw
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", "replace")
    if isinstance(raw, str):
        try:
            data = json.loads(raw or "{}")
        except (ValueError, TypeError):
            data = {}
    if not isinstance(data, dict):
        data = {}

    marks = []
    items = data.get("marks")
    if isinstance(items, list):
        for m in items[:MAX_MARKS]:
            if not isinstance(m, dict):
                continue
            t = m.get("type")
            if t not in TYPES:
                continue
            raw_pts = m.get("pts")
            if not isinstance(raw_pts, list):
                continue
            pts = [q for q in (_point(p) for p in raw_pts[:MAX_POINTS]) if q is not None]
            if len(pts) < (1 if t == "text" else 2):
                continue
            if t in ("box", "ellipse", "arrow"):
                pts = pts[:2]
            elif t == "text":
                pts = pts[:1]
            mark = {
                "type": t,
                "color": m.get("color") if m.get("color") in COLORS else "red",
                "w": m.get("w") if m.get("w") in WIDTHS else "M",
                "pts": pts,
                "note": _one_line(m.get("note"), MAX_NOTE),
            }
            if t == "text":
                text = _one_line(m.get("text"), MAX_TEXT)
                if not text:
                    continue
                mark["text"] = text
            if t == "pen":
                mark["closed"] = m.get("closed") is True
            marks.append(mark)

    rm = data.get("removeMarks")
    return {"marks": marks, "remove_marks": rm is not False}


# ── the prompt ──────────────────────────────────────────────────────────────
_ORDINALS = ("first", "second", "third", "fourth", "fifth",
             "sixth", "seventh", "eighth", "ninth", "tenth")


def _ordinal(n):
    if 1 <= n <= len(_ORDINALS):
        return _ORDINALS[n - 1]
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _phrase_key(m):
    """Marks that would be described with the SAME words share a key."""
    t = m["type"]
    if t == "text":
        return ("text", m["color"], m["text"])
    if t == "pen":
        return ("pen", m["color"], bool(m.get("closed")))
    return (t, m["color"])


def _center(m):
    if m["type"] == "arrow":
        return m["pts"][1]                    # where it points is what it means
    xs = [p[0] for p in m["pts"]]
    ys = [p[1] for p in m["pts"]]
    return ((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0)


def _positions(marks):
    """Position words for marks that would otherwise read the same.

    Two red boxes would both be "the red box", which an edit model cannot tell
    apart, so repeated marks are told apart by where they are: along whichever
    axis they are spread more. Returns, per mark, (before, after) wording.
    """
    groups = {}
    for i, m in enumerate(marks):
        groups.setdefault(_phrase_key(m), []).append(i)
    pos = [("", "")] * len(marks)
    for idx in groups.values():
        if len(idx) < 2:
            continue
        cs = [_center(marks[i]) for i in idx]
        xs = [c[0] for c in cs]
        ys = [c[1] for c in cs]
        horizontal = (max(xs) - min(xs)) >= (max(ys) - min(ys))
        a = 0 if horizontal else 1
        order = sorted(range(len(idx)), key=lambda k: (cs[k][a], cs[k][1 - a], idx[k]))
        n = len(idx)
        if n == 2:
            words = ("left", "right") if horizontal else ("top", "bottom")
        elif n == 3:
            words = ("left", "middle", "right") if horizontal else ("top", "middle", "bottom")
        else:
            words = None
        for rank, k in enumerate(order):
            if words:
                pos[idx[k]] = (words[rank] + " ", "")
            else:
                pos[idx[k]] = (_ordinal(rank + 1) + " ",
                               " from the left" if horizontal else " from the top")
    return pos


def _where(m, pos):
    before, after = pos
    c = m["color"]
    t = m["type"]
    if t == "box":
        return f"Inside the {before}{c} box{after}"
    if t == "ellipse":
        return f"Inside the {before}{c} circle{after}"
    if t == "pen":
        if m.get("closed"):
            return f"Inside the {before}{c} outline{after}"
        return f"The {before}{c} sketch{after}"
    if t == "arrow":
        return f"Where the {before}{c} arrow{after} points"
    return f'Where the {before}{c} text{after} says "{m["text"]}"'


def build_prompt(marks, remove_marks=True):
    """The instruction for the edit model: one sentence per mark with a note.

    Marks without a note are left out (the user may be writing their own
    prompt), and the closing "remove the marks" sentence is only added when at
    least one sentence came before it - on its own it would be the whole prompt.
    """
    pos = _positions(marks)
    lines = []
    for i, m in enumerate(marks):
        # strip(_JS_WS), NOT a bare strip(): Python's own set also strips U+0085
        # and U+001C..U+001F, which the browser keeps - the preview and the run
        # then disagree about the closing period (caught by _sketch_parity.py).
        note = (m.get("note") or "").strip(_JS_WS)
        if not note:
            continue
        end = "" if note[-1] in ".!?" else "."
        lines.append(f"{_where(m, pos[i])}: {note}{end}")
    if lines and remove_marks:
        lines.append(REMOVE_LINE)
    return " ".join(lines)


# ── geometry shared with the browser ────────────────────────────────────────
def line_px(w_key, long_side):
    return max(MIN_LINE_PX, WIDTHS.get(w_key, WIDTHS["M"]) * float(long_side))


def smooth_path(P):
    """The freehand stroke as a dense polyline - the SAME curve the browser
    draws with quadraticCurveTo: through the midpoints of consecutive points,
    each original point acting as the control point, then straight to the end."""
    n = len(P)
    if n < 3:
        return list(P)
    out = [P[0]]
    cur = P[0]
    for i in range(1, n - 1):
        ctrl = P[i]
        end = ((P[i][0] + P[i + 1][0]) / 2.0, (P[i][1] + P[i + 1][1]) / 2.0)
        seg = math.hypot(ctrl[0] - cur[0], ctrl[1] - cur[1]) + math.hypot(end[0] - ctrl[0], end[1] - ctrl[1])
        steps = max(2, min(48, int(seg / 2.0) + 1))
        for k in range(1, steps + 1):
            t = k / steps
            a, b, c = (1 - t) * (1 - t), 2 * (1 - t) * t, t * t
            out.append((a * cur[0] + b * ctrl[0] + c * end[0],
                        a * cur[1] + b * ctrl[1] + c * end[1]))
        cur = end
    out.append(P[-1])
    return out


def arrow_geometry(p0, p1, lw):
    """(shaft_end, (tip, corner1, corner2)). The shaft stops at the head's base
    so its round end never pokes out past the tip. A head is never longer than
    two thirds of the arrow, so a short arrow still reads as one."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dy)
    ang = math.atan2(dy, dx)
    hl = max(lw * HEAD_SCALE, HEAD_MIN)
    if length > 0:
        hl = min(hl, length / 1.5)
    tip = p1
    c1 = (tip[0] - hl * math.cos(ang - HEAD_HALF), tip[1] - hl * math.sin(ang - HEAD_HALF))
    c2 = (tip[0] - hl * math.cos(ang + HEAD_HALF), tip[1] - hl * math.sin(ang + HEAD_HALF))
    back = hl * math.cos(HEAD_HALF)
    base = (tip[0] - back * math.cos(ang), tip[1] - back * math.sin(ang))
    return base, (tip, c1, c2)


def _half_up(x):
    """Round half UP, like the browser's Math.round. Python's round() is
    banker's rounding and would make text one pixel different at exact halves."""
    return int(math.floor(x + 0.5))


def text_size_px(lw):
    return max(8, _half_up(lw * TEXT_SCALE))


def text_outline_px(size):
    return max(1, _half_up(max(2.0, size / 7.0) / 2.0))


# ── drawing ─────────────────────────────────────────────────────────────────
@lru_cache(maxsize=32)
def _font(path, size):
    """Inter at weight 700, the optical size following the font size - what the
    browser draws.

    Axes are set by NAME: Inter's optical-size axis comes BEFORE its weight
    axis, so a bare set_variation_by_axes([700]) set the optical size and left
    the weight Regular - the run drew thin words beside a bold node preview.
    The optical size is the font size in px, clamped to the axis: MEASURED in
    Chrome's canvas with the font genuinely loaded (10 and 12 px -> 14, 16 -> 16,
    20 -> 20, 28 -> 28, 40 -> 32). Same rule as _text_render_helpers._set_axes.
    """
    f = ImageFont.truetype(path, size=int(size))
    try:
        values = []
        for axis in f.get_variation_axes():
            name = axis.get("name", b"")
            name = (name.decode("utf-8", "ignore") if isinstance(name, bytes) else str(name)).lower()
            if name.startswith("weight"):
                want = 700
            elif name.startswith("optical"):
                want = int(size)
            else:
                want = axis.get("default", axis["minimum"])
            values.append(max(axis["minimum"], min(axis["maximum"], want)))
        if values:
            f.set_variation_by_axes(values)
    except Exception:
        pass                                  # a static font simply stays as it is
    return f


def _outline_rgba(color):
    return (0, 0, 0, 191) if color in ("white", "yellow") else (255, 255, 255, 217)


def _mark_px(m, W, H):
    return [(x * W, y * H) for x, y in m["pts"]]


def _bbox(points, grow):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs) - grow, min(ys) - grow, max(xs) + grow, max(ys) + grow


def _clip_box(box, W, H):
    x0 = max(0, int(math.floor(box[0])))
    y0 = max(0, int(math.floor(box[1])))
    x1 = min(W, int(math.ceil(box[2])))
    y1 = min(H, int(math.ceil(box[3])))
    if x1 <= x0 or y1 <= y0:
        return None
    return x0, y0, x1, y1


def _shape_layer(m, W, H, lw):
    """One anti-aliased stroked shape as (x0, y0, coverage uint8 HxW), or None."""
    P = _mark_px(m, W, H)
    hw = lw / 2.0
    t = m["type"]
    path = None
    head = None
    if t == "pen":
        path = smooth_path(P)
        box = _bbox(path, hw + PAD)
    elif t == "arrow":
        base, head = arrow_geometry(P[0], P[1], lw)
        box = _bbox([P[0], *head], hw + PAD)
    else:
        box = _bbox(P, hw + PAD)
    clip = _clip_box(box, W, H)
    if not clip:
        return None
    x0, y0, x1, y1 = clip
    bw, bh = x1 - x0, y1 - y0
    area = bw * bh
    s = 3 if area * 9 <= _SS_BUDGET else (2 if area * 4 <= _SS_BUDGET else 1)

    cov = Image.new("L", (bw * s, bh * s), 0)
    d = ImageDraw.Draw(cov)

    def q(p):
        return ((p[0] - x0) * s, (p[1] - y0) * s)

    width = max(1, int(round(lw * s)))
    r = lw * s / 2.0

    def cap(p):
        c = q(p)
        d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=255)

    if t in ("box", "ellipse"):
        (ax, ay), (bx, by) = P
        lo = q((min(ax, bx) - hw, min(ay, by) - hw))
        hi = q((max(ax, bx) + hw, max(ay, by) + hw))
        # Pillow draws a border INWARD from the box it is given, so growing the
        # box by half a line centres the line on the path, as a canvas stroke is.
        if t == "box":
            d.rectangle([lo[0], lo[1], hi[0], hi[1]], outline=255, width=width)
        else:
            d.ellipse([lo[0], lo[1], hi[0], hi[1]], outline=255, width=width)
    elif t == "pen":
        pts = [q(p) for p in path]
        if len(pts) >= 2:
            d.line(pts, fill=255, width=width, joint="curve")
        cap(path[0])
        cap(path[-1])
    elif t == "arrow":
        d.line([q(P[0]), q(base)], fill=255, width=width)
        cap(P[0])
        d.polygon([q(v) for v in head], fill=255)

    if s > 1:
        cov = cov.resize((bw, bh), Image.BOX)
    return x0, y0, np.asarray(cov, dtype=np.uint8)


def _text_layer(m, W, H, lw, font_path):
    """Bold text with a thin contrasting outline, as (x0, y0, rgba uint8), or None."""
    size = text_size_px(lw)
    try:
        font = _font(font_path, size)
    except Exception:
        return None
    sw = text_outline_px(size)
    x, y = _mark_px(m, W, H)[0]
    anchor_xy = (x, y + size * TEXT_BASELINE)          # text baseline
    probe = ImageDraw.Draw(Image.new("L", (1, 1)))
    l, tt, r, b = probe.textbbox(anchor_xy, m["text"], font=font, anchor="ls", stroke_width=sw)
    clip = _clip_box((l - PAD, tt - PAD, r + PAD, b + PAD), W, H)
    if not clip:
        return None
    x0, y0, x1, y1 = clip
    layer = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text((anchor_xy[0] - x0, anchor_xy[1] - y0), m["text"], font=font, anchor="ls",
           fill=COLORS[m["color"]] + (255,), stroke_width=sw, stroke_fill=_outline_rgba(m["color"]))
    # np.array, not np.asarray: Pillow hands back a READ-ONLY view, and torch
    # warns (and may misbehave) when a tensor is made from one.
    return x0, y0, np.array(layer, dtype=np.uint8)


def render_layers(W, H, marks, font_path):
    """Every mark as (x0, y0, rgba uint8 array), in drawing order.

    Each layer covers only the pixels its mark touches, so the node composites
    just those - every other pixel of the picture stays bit-identical to the
    input. A mark that falls entirely outside the picture yields nothing.
    """
    long_side = max(W, H)
    layers = []
    for m in marks:
        lw = line_px(m["w"], long_side)
        if m["type"] == "text":
            got = _text_layer(m, W, H, lw, font_path)
            if got:
                layers.append(got)
            continue
        got = _shape_layer(m, W, H, lw)
        if not got:
            continue
        x0, y0, cov = got
        rgba = np.zeros(cov.shape + (4,), dtype=np.uint8)
        rgba[..., :3] = COLORS[m["color"]]
        rgba[..., 3] = cov
        layers.append((x0, y0, rgba))
    return layers


def build_mask(W, H, marks):
    """White where an inpaint should work, as a Pillow "L" image.

    A box, a circle and a closed loop give their inside plus their own line (so
    the line itself is repainted too). An open freehand stroke gives a wide band
    along the stroke: it is a sketch of something to add, not a boundary.
    Arrows and text point at things rather than enclose them, so they are left
    out.
    """
    img = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(img)
    long_side = max(W, H)
    for m in marks:
        lw = line_px(m["w"], long_side)
        hw = lw / 2.0
        P = _mark_px(m, W, H)
        t = m["type"]
        if t in ("box", "ellipse"):
            (ax, ay), (bx, by) = P
            box = [min(ax, bx) - hw, min(ay, by) - hw, max(ax, bx) + hw, max(ay, by) + hw]
            if t == "box":
                d.rectangle(box, fill=255)
            else:
                d.ellipse(box, fill=255)
        elif t == "pen":
            path = smooth_path(P)
            if m.get("closed") and len(path) >= 3:
                d.polygon(path, fill=255)
                width = max(1, int(round(lw)) + 1)
                d.line(path + [path[0]], fill=255, width=width, joint="curve")
            else:
                band = max(1, int(round(lw * 3)))
                if len(path) >= 2:
                    d.line(path, fill=255, width=band, joint="curve")
                r = band / 2.0
                for p in (path[0], path[-1]):
                    d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=255)
    return img
