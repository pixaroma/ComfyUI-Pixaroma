"""Seamless Border math: pure torch, no ComfyUI import (so scripts/seamless_border_check.py runs in a bare Python).

Terms. A strip from Seamless Tile ("Left and right") is a band across a plain background; its full width W is one
repeat. `band` is that band cut out: [T, W, 3], row 0 = the OUTER edge of the frame, T = band thickness.

Going clockwise round the frame:
- top    = band as it is, read left to right (column 0 .. W-1);
- right  = band turned 90 degrees clockwise;
- bottom = band turned 180 degrees;
- left   = band turned 90 degrees counter-clockwise, so its row 0 (just under the top-left corner) is column W-1 and
  the columns count down going down.
So the top-left corner sits between strip column W-1 (below it) and strip column 0 (right of it). The other three
corners are the top-left one turned, exactly as the sides are the top turned.

Images here are [H, W, 3] float tensors (one picture, no batch); the nodes add and remove the batch axis.
"""
import math

import torch
import torch.nn.functional as F

CANVAS_MULTIPLE = 64     # every model's latent fits a canvas that is a multiple of 64 px
MIN_BAND = 16            # thinner than this is not a border worth a corner
MIN_CANVAS = 1024        # smaller canvases are too small for today's models to draw well
MASK_MODES = ("Seam", "Corner")
MIRROR_ROWS = 128        # the mirror-line search samples about this many rows (and offsets) of the band
SEAM_FEATHER = 0.5       # the seam mask fades out over this share of its half-width, past the solid part
EDGE_FRACTION = 0.04     # rows at the top and at the bottom sampled for the background colour (last resort)
# Band detection (Pixaroma, 2026-11-26; measured on 41 real Krea 2 strips in 18 styles, D:\Claude Tests\_border_corners).
# The band is what lies between the two plain backgrounds that touch the picture's top and bottom edges. "Plain" is
# judged by horizontal DETAIL, not by colour: a mottled parchment or a two-tone wall (white above, beige below) has
# almost none, a drawn border a lot. The old colour-only test took both of those for border.
DETAIL_BLUR = 2          # px: box blur of 2k+1 before measuring detail, so paper grain and JPEG noise do not count
                         # (no smoothing ACROSS rows: it moved the found edges out by its width; a crack is crossed
                         # by the background walk instead, BG_GAP)
PLAIN_LEVEL = 0.2        # a row is plain below lo + PLAIN_LEVEL x (hi - lo) of the picture's own detail range
PLAIN_FLOOR = 0.004      # ... and always below this (a picture with no band at all has no range to speak of)
COLOUR_STEP = 0.06       # a row whose colour is this far (any channel, 0..1) from the background beside it ends it
COLOUR_FOLLOW = 0.05     # the background colour follows a soft shading at this rate per row
COLOUR_DRIFT = 0.25      # ... but never further than this from where it started (a shaded parchment drifts 0.18; a
                         # band's black ground FADING into the paper must not be followed in: filigree_2)
BG_GAP = 0.005           # stray rows (a crack, a stain) crossed inside a background, as a share of the height
EDGE_SKIP = 0.06         # the background may start this far in (a stained paper edge, a stray line at the edge)
MIN_BG = 0.04            # a plain run at an edge thinner than this share of the height, in another colour than the
                         # background on the other side, is the band's own bar (the band touches that edge)
DARK_GROUND = 0.5        # ... and up to twice that thick when it is DARK (mean below this): a band's own dark ground
                         # running off the edge (victorian_2, 68 rows of green), while real thin margins of another
                         # colour are light paper or wall (baroque_2 85, greekkey_2 85, celtic_2 111 rows)


class BorderError(ValueError):
    """A strip the nodes can't use; the message says what to change."""


def background_colour(img):
    """The plain background: the median of the top or bottom EDGE_FRACTION of rows, whichever is more even."""
    h = img.shape[0]
    k = max(1, round(EDGE_FRACTION * h))
    edges = [img[:k].reshape(-1, img.shape[-1]), img[h - k:].reshape(-1, img.shape[-1])]
    best = min(edges, key=lambda px: px.std(dim=0).mean().item())
    return best.median(dim=0).values


def row_detail(img):
    """[H]: the drawn detail in each row: mean |I(x+1) - I(x)| (the largest channel) on a copy blurred ALONG the row
    only (a blur across rows moved the found edges), x wrapping (the strip repeats). Ink and motifs score high; a
    plain, mottled or shaded background scores low, and a horizontal colour edge scores nothing."""
    k = DETAIL_BLUR
    x = F.pad(img.permute(2, 0, 1).unsqueeze(0), (k, k, 0, 0), mode="circular")
    b = F.avg_pool2d(x, (1, 2 * k + 1), stride=1)[0]
    return (b.roll(-1, dims=2) - b).abs().amax(0).mean(1)


def _walk_background(colours, plain, from_top, start, gap):
    """Rows from the edge to the end of the plain background that starts `start` rows in (0 = none found)."""
    h = len(colours)
    ref, base, n, miss = None, None, 0, 0
    for i in range(start, h):
        r = i if from_top else h - 1 - i
        c = colours[r]
        if plain[r] and (ref is None or (max(abs(a - b) for a, b in zip(c, ref)) <= COLOUR_STEP
                                         and max(abs(a - b) for a, b in zip(c, base)) <= COLOUR_DRIFT)):
            if ref is None:
                base = list(c)
            ref = list(c) if ref is None else [a + (b - a) * COLOUR_FOLLOW for a, b in zip(ref, c)]
            n, miss = i + 1, 0
        else:
            miss += 1
            if ref is None or miss > gap:
                break
    return n


def _edge_background(colours, plain, from_top):
    """How many rows from the top (or bottom) edge are plain background: walked inward while a row is plain and its
    colour stays within COLOUR_STEP of the background beside it (which follows a soft shading); stray rows (a crack,
    a stain) of up to BG_GAP of the height are crossed when the background carries on. The background may start
    anywhere in the first EDGE_SKIP of the height (a stained paper edge, a stray line at the very edge: celtic_2,
    victorian_1); the start that reaches furthest wins. Returns (rows from the edge, rows the background itself has)."""
    h = len(colours)
    gap, skip = max(1, round(BG_GAP * h)), max(1, round(EDGE_SKIP * h))
    best = (0, 0)
    for start in range(min(skip, h - 1) + 1):
        r = start if from_top else h - 1 - start
        prev = r - 1 if from_top else r + 1
        new_run = start == 0 or not plain[prev] or max(abs(a - b) for a, b in zip(colours[r], colours[prev])) > \
            COLOUR_STEP
        # a background may start where a new run starts (a stray line just ends: filigree_1 at row 92), or on every
        # 3rd row (a dark photo edge FADING into the paper has no clean start: the "sheet of paper" strips)
        if not plain[r] or not (new_run or start % 3 == 0):
            continue
        n = _walk_background(colours, plain, from_top, start, gap)
        if n - start > best[1]:   # the LONGEST plain run, not the furthest reach: a start inside the band's own
            best = (n, n - start)  # plain black ground, past a 73-row white margin, reached further (filigree_2)
    return best


def _rows_colour(img, rows):
    """The median colour of the given rows (a background), or None."""
    return img[rows].reshape(-1, img.shape[-1]).median(dim=0).values if len(rows) else None


def locate_band(img, top=None, bottom=None, inner="bottom"):
    """Where the band is in a strip picture [H, W, 3], as a dict:
    top, bottom (exclusive), bg (the background colour on the `inner` side, else the other side), touches_top,
    touches_bottom (the band reaches that edge of the picture: it may be cut there).

    top / bottom given (not None) are used as they are. Found ones: the band lies between the plain backgrounds
    touching the top and bottom edges (_edge_background), so a plain bar or a thin rule at the band's edge stays in
    the band, and a different background below than above (a two-tone wall) does not get in.
    """
    h = img.shape[0]
    detail = row_detail(img)
    lo, hi = torch.quantile(detail, 0.05).item(), torch.quantile(detail, 0.95).item()
    plain = (detail < max(lo + PLAIN_LEVEL * (hi - lo), PLAIN_FLOOR)).tolist()
    colours = img.median(dim=1).values
    n_top, run_top = _edge_background(colours.tolist(), plain, True)
    n_bot, run_bot = _edge_background(colours.tolist(), plain, False)
    if top is not None and not 0 <= int(top) < h:
        raise BorderError(f"Seamless Border: band_top ({int(top)}) must be a row of the strip, 0 to {h - 1}.")
    if bottom is not None and not 0 < int(bottom) <= h:
        raise BorderError(f"Seamless Border: band_bottom ({int(bottom) - 1}) must be a row of the strip, 0 to {h - 1}.")
    if n_top >= h:
        if top is None or bottom is None:   # rows typed by hand still work on a faint band (reviewer A r2 #1)
            raise BorderError("Seamless Border: no border band found, the strip looks plain all the way down. Set "
                              "band_top and band_bottom to the band's first and last row, or make a strip with a band.")
        n_top = run_top = n_bot = run_bot = 0
    c_top = _rows_colour(img, list(range(n_top - run_top, n_top)))
    c_bot = _rows_colour(img, list(range(h - n_bot, h - n_bot + run_bot)))
    # ... and the other side's background NEXT TO THE BAND, which a thin run is compared with: a page shaded from top
    # to bottom has another colour mid-page than beside the band (reviewer A r2 #2: a 40-row margin was swallowed)
    k = max(1, round(MIN_BG * h))
    near_top = _rows_colour(img, list(range(n_top - min(run_top, k), n_top)))
    near_bot = _rows_colour(img, list(range(h - n_bot, h - n_bot + min(run_bot, k))))
    # a thin plain run at one edge in another colour than the other side's background = the band's own bar
    for side in ("top", "bottom"):
        n, c, other = (run_top, c_top, near_bot) if side == "top" else (run_bot, c_bot, near_top)
        thin = n < MIN_BG * h or (n < 2 * MIN_BG * h and c.mean().item() < DARK_GROUND)
        if 0 < n and thin and other is not None and (c - other).abs().max().item() > COLOUR_STEP:
            if side == "top":   # reset the near-band colour too, or the bottom pass compares with the bar (r3)
                n_top, c_top, near_top = 0, None, None
            else:
                n_bot, c_bot, near_bot = 0, None, None
    found_top, found_bot = n_top, h - n_bot
    top = found_top if top is None else int(top)
    bottom = found_bot if bottom is None else int(bottom)
    if bottom - top < MIN_BAND:
        if top != found_top or bottom != found_bot:
            last = f"band_bottom ({bottom - 1})" if bottom != found_bot else f"the band's last row ({bottom - 1}, found)"
            raise BorderError(f"Seamless Border: band_top ({top}) must be at least {MIN_BAND} rows above {last}.")
        raise BorderError(
            f"Seamless Border: no border band found (found {max(0, bottom - top)} rows, need {MIN_BAND}). Set "
            "band_top and band_bottom to the band's first and last row, or check that the strip has a band across "
            "a plain background.")
    # the background colour: the plain rows outside the band on each side (manual rows may leave band rows outside)
    above = [r for r in range(top) if plain[r]] or list(range(top))
    below = [r for r in range(bottom, h) if plain[r]] or list(range(bottom, h))
    sides = {"top": _rows_colour(img, above) if top >= MIN_BAND else None,
             "bottom": _rows_colour(img, below) if h - bottom >= MIN_BAND else None}
    other = "top" if inner == "bottom" else "bottom"
    bg = sides[inner] if sides[inner] is not None else sides[other]
    if bg is None:
        bg = background_colour(img)
    return {"top": top, "bottom": bottom, "bg": bg, "touches_top": top == 0, "touches_bottom": bottom == h}


def find_band(img, top=0, bottom=0):
    """(top, bottom, bg) of the band; bottom is exclusive. top / bottom > 0 are taken as given (locate_band)."""
    b = locate_band(img, top if top > 0 else None, bottom if bottom > 0 else None)
    return b["top"], b["bottom"], b["bg"]


def mirror_error(band, s, step=1):
    """How far the band is from its mirror image about the line between columns s-1 and s (0 = exact), over the
    part a mitre at that line shows: k columns either side on row y, for k < T - y. `step` samples every step-th
    row and offset."""
    t, w = band.shape[0], band.shape[1]
    k = torch.arange(0, t, step)
    diff = (band[k][:, (s + k) % w] - band[k][:, (s - 1 - k) % w]).abs().mean(-1)
    return diff[k.view(1, -1) < (t - k).view(-1, 1)].mean().item()


def mirror_column(band):
    """The column s whose left edge is the band's best mirror line.

    A strip repeats, so the corner can sit at any column. Rolled so that column s is column 0, the top strip and the
    side are mirror images across the corner's diagonal, and the mitre reads as a designed corner (a motif centred
    on the turn) instead of an arbitrary cut. Every column is tried, on about MIRROR_ROWS sampled rows.
    """
    step = max(1, band.shape[0] // MIRROR_ROWS)
    return min(range(band.shape[1]), key=lambda s: mirror_error(band, s, step))


def strip_cols(band, cols):
    """The band's columns `cols` (wrapped mod W): [T, len(cols), 3]."""
    return band[:, torch.as_tensor(cols, dtype=torch.long) % band.shape[1]]


def side_from_band(band):
    """The left side: the band turned 90 degrees counter-clockwise, [W, T, 3], outer edge on the left."""
    return torch.rot90(band, 1, dims=(0, 1))


def side_rows(band, rows):
    """Rows `rows` of the left side extended both ways (row r shows strip column W-1-r): [len(rows), T, 3]."""
    w = band.shape[1]
    cols = (w - 1 - torch.as_tensor(rows, dtype=torch.long)) % w
    return band[:, cols].transpose(0, 1)


def target_h(band):
    """[T, T, 3]: the top strip carried on leftwards into the corner (column x shows strip column W-T+x)."""
    t, w = band.shape[0], band.shape[1]
    return strip_cols(band, torch.arange(w - t, w))


def target_v(band):
    """[T, T, 3]: the left side carried on upwards into the corner (row y is side row y-T)."""
    t = band.shape[0]
    return side_rows(band, torch.arange(-t, 0))


def _upper(t):
    """[T, T] bool: on or above the diagonal (x >= y), the half that belongs to the top strip."""
    y = torch.arange(t).view(-1, 1)
    x = torch.arange(t).view(1, -1)
    return x >= y


def mitre(band):
    """The 45-degree picture-frame corner [T, T, 3]: the top strip above the diagonal, the side below it."""
    return torch.where(_upper(band.shape[0]).unsqueeze(-1), target_h(band), target_v(band))


def keep_unmasked(painted, band, mask):
    """The painted corner where the mask says so, the mitre (the strip's own pixels) elsewhere.

    The canvas goes through VAE encode / decode, which softens every pixel a little; this puts the untouched part
    back exactly, fading with the mask's feather.
    """
    m = mask.to(painted).unsqueeze(-1)
    return mitre(band).to(painted) * (1 - m) + painted * m


def blend_corner(corner, band, blend):
    """Fade the corner's last `blend` columns into the top strip and its last `blend` rows into the side.

    The diagonal splits the work: on or above it the columns fade to target_h, below it the rows fade to target_v.
    The ramps reach 1 on the join column / row, so both joins equal the strips exactly (the one inner-corner pixel
    belongs to the top strip). A mitred corner already equals both targets there, so it comes back unchanged.
    """
    t = band.shape[0]
    blend = max(0, min(int(blend), t // 2))
    if blend == 0:
        return corner
    ramp = ((torch.arange(t, dtype=corner.dtype) - (t - blend) + 1) / blend).clamp(0, 1)
    w_h = ramp.view(1, -1, 1)   # by column
    w_v = ramp.view(-1, 1, 1)   # by row
    faded_h = corner * (1 - w_h) + target_h(band) * w_h
    faded_v = corner * (1 - w_v) + target_v(band) * w_v
    return torch.where(_upper(t).unsqueeze(-1), faded_h, faded_v)


def canvas_size(t, context):
    """The padded canvas side: corner + `context` band thicknesses of strip, at least MIN_CANVAS, rounded up to
    CANVAS_MULTIPLE."""
    s = max(MIN_CANVAS, t + max(1, round(float(context) * t)))
    return int(math.ceil(s / CANVAS_MULTIPLE) * CANVAS_MULTIPLE)


def corner_mask(t, mode="Seam", seam_width=0.25, dtype=torch.float32):
    """[T, T] mask of what the model repaints in the corner.

    Corner: the whole square. Seam: a band along the mitre's diagonal, solid for seam_width x T across and fading
    out over SEAM_FEATHER of that half-width beyond, so the bands of the strip stay in the corner and the model only
    redraws where they turn.
    """
    if mode == "Corner":
        return torch.ones(t, t, dtype=dtype)
    y = torch.arange(t, dtype=dtype).view(-1, 1)
    x = torch.arange(t, dtype=dtype).view(1, -1)
    d = (x - y).abs() / math.sqrt(2)                      # distance from the diagonal, in pixels
    half = max(1.0, float(seam_width) * t / 2)
    feather = max(1.0, half * SEAM_FEATHER)
    return ((half + feather - d) / feather).clamp(0, 1)


def build_canvas(band, bg, context, mode="Seam", seam_width=0.25):
    """(canvas [P, P, 3], mask [P, P], P) for inpainting the top-left corner.

    Corner pre-filled with the mitre; the top strip runs right from it and the left side runs down from it, both to
    the canvas edge; the inside of the frame is the background colour. Mask = corner_mask in the corner, 0 elsewhere.
    """
    t = band.shape[0]
    p = canvas_size(t, context)
    canvas = bg.view(1, 1, -1).expand(p, p, band.shape[-1]).clone()
    canvas[:t, :t] = mitre(band)
    canvas[:t, t:] = strip_cols(band, torch.arange(p - t))
    canvas[t:, :t] = side_rows(band, torch.arange(p - t))
    mask = torch.zeros(p, p, dtype=band.dtype)
    mask[:t, :t] = corner_mask(t, mode, seam_width, band.dtype)
    return canvas, mask, p


def frame(corner, band, bg, repeats=1):
    """A whole frame, `repeats` strip repeats per side: [(2T + repeats*W)] square, inside = background colour."""
    t, w = band.shape[0], band.shape[1]
    n = t * 2 + repeats * w
    top = band.repeat(1, repeats, 1)
    out = bg.view(1, 1, -1).expand(n, n, band.shape[-1]).clone()
    out[:t, t:n - t] = top
    out[t:n - t, n - t:] = torch.rot90(top, -1, dims=(0, 1))
    out[n - t:, t:n - t] = torch.rot90(top, 2, dims=(0, 1))
    out[t:n - t, :t] = torch.rot90(top, 1, dims=(0, 1))
    out[:t, :t] = corner
    out[:t, n - t:] = torch.rot90(corner, -1, dims=(0, 1))
    out[n - t:, n - t:] = torch.rot90(corner, 2, dims=(0, 1))
    out[n - t:, :t] = torch.rot90(corner, 1, dims=(0, 1))
    return out


PREVIEW_MAX = 4096       # px: the frame preview is made at most this wide (12 repeats of a 2048 px strip with an
                         # 890 px band were a 26 000 px square, about 8 GB, before this)


def preview_frame(corner, band, bg, repeats=1):
    """frame() for looking at: when it would be wider than PREVIEW_MAX, the corner and band are scaled down FIRST
    (the same scale, the corner to the band's new thickness), so the big frame is never made at full size."""
    t, w = band.shape[0], band.shape[1]
    n = 2 * t + repeats * w
    if n <= PREVIEW_MAX:
        return frame(corner, band, bg, repeats)
    s = PREVIEW_MAX / n
    ts, ws = max(1, round(t * s)), max(1, round(w * s))

    def fit(x, hh, ww):
        return F.interpolate(x.permute(2, 0, 1).unsqueeze(0), size=(hh, ww), mode="bilinear", align_corners=False,
                             antialias=True)[0].permute(1, 2, 0)

    return frame(fit(corner, ts, ts), fit(band, ts, ws), bg, repeats)


def css_line(t):
    """The CSS for the 9-slice kit saved as border.png (no `fill`: the page's own background shows inside)."""
    return (f"border-style: solid; border-width: {t}px; border-image: url(border.png) {t} round;")
