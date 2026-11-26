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

CANVAS_MULTIPLE = 64     # every model's latent fits a canvas that is a multiple of 64 px
MIN_BAND = 16            # thinner than this is not a border worth a corner
MIN_CANVAS = 1024        # smaller canvases are too small for today's models to draw well
MASK_MODES = ("Seam", "Corner")
MIRROR_ROWS = 128        # the mirror-line search samples about this many rows (and offsets) of the band
SEAM_FEATHER = 0.5       # the seam mask fades out over this share of its half-width, past the solid part
EDGE_FRACTION = 0.04     # rows at the top and at the bottom sampled for the background colour
PIXEL_THRESHOLD = 0.1    # a pixel this far from the background (any channel, 0..1) is part of the drawing
ROW_COVERAGE = 0.3       # a row with more than this share of drawn pixels belongs to the band
GAP_FRACTION = 0.02      # background rows inside the band (thin white lines) bridged, as a fraction of the height


class BorderError(ValueError):
    """A strip the nodes can't use; the message says what to change."""


def background_colour(img):
    """The plain background: the median of the top or bottom EDGE_FRACTION of rows, whichever is more even."""
    h = img.shape[0]
    k = max(1, round(EDGE_FRACTION * h))
    edges = [img[:k].reshape(-1, img.shape[-1]), img[h - k:].reshape(-1, img.shape[-1])]
    best = min(edges, key=lambda px: px.std(dim=0).mean().item())
    return best.median(dim=0).values


def find_band(img, top=0, bottom=0):
    """(top, bottom, bg) of the band in a strip picture [H, W, 3]; bottom is exclusive.

    top / bottom > 0 are taken as given (bottom exclusive here). A pixel is "drawn" when one of its channels is more
    than PIXEL_THRESHOLD from the background colour; a row is a band row when over ROW_COVERAGE of it is drawn (so
    paper texture and soft shading are not). The longest run of band rows wins, gaps of up to GAP_FRACTION of the
    height bridged (thin white lines inside a border).
    """
    h = img.shape[0]
    bg = background_colour(img)
    if top <= 0 or bottom <= 0:
        drawn = ((img - bg).abs().amax(dim=-1) > PIXEL_THRESHOLD).float().mean(dim=1)
        rows = (drawn > ROW_COVERAGE).tolist()
        gap = max(1, round(GAP_FRACTION * h))
        best, start, last = (0, 0), None, None
        for r, on in enumerate(rows):
            if not on:
                continue
            if start is None or r - last > gap + 1:
                start = r
            last = r
            if last + 1 - start > best[1] - best[0]:
                best = (start, last + 1)
        top = top if top > 0 else best[0]
        bottom = bottom if bottom > 0 else best[1]
    top, bottom = max(0, int(top)), min(h, int(bottom))
    if bottom - top < MIN_BAND:
        raise BorderError(
            f"Seamless Border: no border band found (found {max(0, bottom - top)} rows, need {MIN_BAND}). Set "
            "band_top and band_bottom to the band's first and last row, or check that the strip has a band across "
            "a plain background.")
    return top, bottom, bg


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


def css_line(t):
    """The CSS for the 9-slice kit saved as border.png (no `fill`: the page's own background shows inside)."""
    return (f"border-style: solid; border-width: {t}px; border-image: url(border.png) {t} round;")
