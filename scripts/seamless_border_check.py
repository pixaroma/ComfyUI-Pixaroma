"""Seamless Border check: the geometry of Seamless Border Prep / Kit on synthetic strips.

Needs only Python + torch (no ComfyUI). Prints ALL OK or stops at the first failed check.

Usage:
    python scripts/seamless_border_check.py
"""
import importlib.util
import sys
import types
from pathlib import Path

import torch

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load(name):
    """Load nodes/<name>.py into a synthetic 'nodes' package (the pack's own __init__ needs ComfyUI)."""
    if "nodes" not in sys.modules:
        pkg = types.ModuleType("nodes")
        pkg.__path__ = [str(REPO_ROOT / "nodes")]
        sys.modules["nodes"] = pkg
    spec = importlib.util.spec_from_file_location(f"nodes.{name}", REPO_ROOT / "nodes" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[f"nodes.{name}"] = mod
    spec.loader.exec_module(mod)
    return mod


bh = _load("_border_helpers")
nb = _load("node_seamless_border")
BG = torch.tensor([0.97, 0.96, 0.95])


def make_band(t, w, seed=0):
    g = torch.Generator().manual_seed(seed)
    return torch.rand(t, w, 3, generator=g) * 0.6


def make_strip(t, w, h, top, gaps=()):
    """A strip picture: background with the band at rows top..top+t, optional background rows inside the band."""
    img = BG.view(1, 1, 3).expand(h, w, 3).clone()
    img += (torch.rand(h, w, 3, generator=torch.Generator().manual_seed(9)) - 0.5) * 0.02   # paper texture
    band = make_band(t, w)
    img[top:top + t] = band
    for r in gaps:
        img[top + r] = BG
    return img, band


def eq(a, b, what, tol=1e-6):
    d = (a - b).abs().max().item()
    assert d <= tol, f"{what}: max difference {d}"


def check_find_band():
    img, _ = make_strip(120, 256, 512, 200)
    top, bottom, bg = bh.find_band(img)
    assert (top, bottom) == (200, 320), (top, bottom)
    eq(bg, BG, "background colour", tol=0.02)
    img, _ = make_strip(120, 256, 512, 200, gaps=(40, 41, 80))
    assert bh.find_band(img)[:2] == (200, 320), "band with white lines inside"
    img, _ = make_strip(100, 256, 512, 0)
    assert bh.find_band(img)[:2] == (0, 100), "band touching the top"
    assert bh.find_band(img, 10, 90)[:2] == (10, 90), "manual rows"
    img, _ = make_strip(320, 256, 512, 120)
    assert bh.find_band(img)[:2] == (120, 440), "band over half the height"
    img, _ = make_strip(120, 256, 512, 200)
    img += torch.linspace(-0.06, 0, 512).view(-1, 1, 1)   # background shaded darker towards the top
    assert bh.find_band(img)[:2] == (200, 320), "shaded background"
    try:
        bh.find_band(BG.view(1, 1, 3).expand(256, 256, 3).clone())
        raise AssertionError("an empty strip should fail")
    except bh.BorderError as e:
        assert "band_top" in str(e)


def check_geometry(t, w):
    band = make_band(t, w, seed=t)
    th, tv, m = bh.target_h(band), bh.target_v(band), bh.mitre(band)
    side = bh.side_from_band(band)
    # the strips' own continuity at the corner: column W-1 then column 0
    eq(th[:, t - 1], band[:, w - 1], "target_h ends on strip column W-1")
    eq(tv[t - 1], bh.side_rows(band, [-1])[0], "target_v ends on the side row above row 0")
    eq(bh.side_rows(band, torch.arange(w)), side, "side_rows matches the turned band")
    # mitre: top strip on/above the diagonal, side below
    up = bh._upper(t)
    eq(m[up], th[up], "mitre upper half")
    eq(m[~up], tv[~up], "mitre lower half")
    eq(bh.blend_corner(m, band, 12), m, "blend leaves a mitred corner unchanged")
    # a random painted corner: blended joins are exact
    painted = torch.rand(t, t, 3, generator=torch.Generator().manual_seed(1))
    c = bh.blend_corner(painted, band, 12)
    eq(c[:t - 1, t - 1], band[:t - 1, w - 1], "corner right column joins the top strip")
    eq(c[t - 1, :t - 1], tv[t - 1, :t - 1], "corner bottom row joins the left side")
    eq(c[:t - 12, :t - 12], painted[:t - 12, :t - 12], "corner untouched outside the blend")
    eq(bh.blend_corner(painted, band, 0), painted, "blend 0 does nothing")
    # frame: sides are the turned band, corners the turned corner, all joins continue the strip
    for reps in (1, 3):
        f = bh.frame(c, band, BG, reps)
        n = 2 * t + reps * w
        assert f.shape == (n, n, 3)
        eq(f[:t, t:t + w], band, "frame top")
        eq(f[t:t + w, :t], torch.rot90(band.repeat(1, reps, 1), 1, dims=(0, 1))[:w], "frame left side")
        eq(f[:t, :t], c, "top-left corner")
        eq(f[:t, n - t:], torch.rot90(c, -1, dims=(0, 1)), "top-right corner")
        # top-right corner's left column continues the top strip after its last column W-1: strip column 0
        eq(f[:t - 1, n - t], band[:t - 1, 0], "top-right corner joins the top strip")
        # the whole frame looks the same turned 90 degrees: every side and corner matches
        eq(torch.rot90(f, -1, dims=(0, 1)), f, "frame is the same turned a quarter")
    # canvas
    canvas, mask, p = bh.build_canvas(band, BG, 2.0, "Corner")
    assert p % 64 == 0 and p >= 3 * t and p >= bh.MIN_CANVAS, p
    eq(canvas[:t, :t], m, "canvas corner pre-filled with the mitre")
    k = min(w, p - t)
    eq(canvas[:t, t:t + k], band[:, :k], "canvas top strip")
    eq(canvas[:t, p - 1], band[:, (p - t - 1) % w], "canvas top strip repeats to the edge")
    eq(canvas[t:t + min(w, p - t), :t], side[:min(w, p - t)], "canvas side")
    eq(canvas[p - 1, p - 1], BG, "canvas inside is background")
    assert mask[:t, :t].min() == 1 and mask.sum() == t * t
    # seam mask: along the diagonal, symmetric, off near the corner's other two corners, soft at its edges
    sm = bh.corner_mask(t, "Seam", 0.25)
    eq(sm, sm.T, "seam mask symmetric")
    assert sm.diagonal().min() == 1, "seam mask covers the diagonal"
    assert sm[0, t - 1] == 0 and sm[t - 1, 0] == 0, "seam mask leaves the far corners alone"
    if t >= 64:
        assert ((sm > 0) & (sm < 1)).any(), "seam mask is feathered"
    _, smask, _ = bh.build_canvas(band, BG, 2.0, "Seam")
    eq(smask[:t, :t], sm, "canvas carries the seam mask")
    assert smask[t:].sum() == 0 and smask[:, t:].sum() == 0
    # whatever the model returns outside the mask, the strip's own pixels come back exactly
    noisy = torch.rand(t, t, 3, generator=torch.Generator().manual_seed(3))
    kept = bh.keep_unmasked(noisy, band, sm)
    eq(kept[sm == 0], m[sm == 0], "unmasked corner pixels are the mitre")
    eq(kept[sm == 1], noisy[sm == 1], "masked corner pixels are the painted ones")


def check_mirror(t, w, shift):
    """A band that mirrors itself, rolled: the search finds a mirror line and the mitre there is symmetric."""
    half = make_band(t, w // 2, seed=w)
    band = torch.cat([half, half.flip(1)], 1).roll(shift, dims=1)
    s = bh.mirror_column(band)
    assert bh.mirror_error(band, s) < 1e-6, (t, w, shift, s)
    m = bh.mitre(band.roll(-s, dims=1))
    eq(m, m.transpose(0, 1), "mitre on the mirror line is symmetric across its diagonal")
    img = BG.view(1, 1, 3).expand(3 * t, band.shape[1], 3).clone()
    img[t:2 * t] = band
    _, _, info = nb.SeamlessBorderPrepPixaroma().prep(img.unsqueeze(0))
    eq(info["band"], band.roll(-s, dims=1), "Prep turns the corner on the mirror line", tol=0.0)


def check_nodes():
    img, band = make_strip(96, 384, 768, 300)
    prep, kit = nb.SeamlessBorderPrepPixaroma(), nb.SeamlessBorderKitPixaroma()
    canvas, mask, info = prep.prep(img.unsqueeze(0), 0, 0, 2.0, "Top", corner_at="Strip edge")
    assert canvas.shape[1] % 64 == 0 and mask.shape == canvas.shape[:3]
    eq(info["band"], band, "Prep cuts the band", tol=0.0)
    outs = kit.kit(canvas, info, 12, 2)
    k, corner, top, side, prev, css = outs
    t, w = 96, 384
    assert k.shape == (1, 2 * t + w, 2 * t + w, 3), k.shape
    assert corner.shape == (1, t, t, 3) and top.shape == (1, t, w, 3) and side.shape == (1, w, t, 3)
    assert prev.shape == (1, 2 * t + 2 * w, 2 * t + 2 * w, 3)
    eq(corner[0], bh.mitre(band), "mitred kit when the canvas goes straight in")
    assert canvas.shape[1] >= bh.MIN_CANVAS
    # a VAE round trip softens the whole canvas: Kit restores the unmasked part of the corner exactly
    soft = canvas * 0.9 + 0.05
    sm = info["mask"]
    c2 = kit.kit(soft, info, 0, 1)[1][0]
    eq(c2[sm == 0], bh.mitre(band)[sm == 0], "Kit keeps the strip pixels outside the seam")
    assert "96px" in css and "border-image" in css
    # an inpaint result returned at twice the size, in a batch of 2 corner options
    big = torch.nn.functional.interpolate(canvas.permute(0, 3, 1, 2), scale_factor=2, mode="bilinear")
    big = big.permute(0, 2, 3, 1).repeat(2, 1, 1, 1)
    outs = kit.kit(big, info, 12, 1)
    assert outs[1].shape == (2, t, t, 3)
    eq(outs[1][0, :t - 1, t - 1], band[:t - 1, w - 1], "resized result still joins exactly")
    # outer edge Bottom flips the band; RGBA strips use the first 3 channels
    rgba = torch.cat([img, torch.ones(*img.shape[:2], 1)], -1).unsqueeze(0)
    _, _, info2 = prep.prep(rgba, 0, 0, 2.0, "Bottom", corner_at="Strip edge")
    eq(info2["band"], band.flip(0), "outer edge Bottom", tol=0.0)
    try:
        prep.prep(torch.stack([img, img]), 0, 0, 2.0, "Top")
        raise AssertionError("a batch of strips should fail")
    except bh.BorderError:
        pass


if __name__ == "__main__":
    check_find_band()
    for t, w in ((96, 384), (37, 203), (300, 256), (16, 16)):
        check_geometry(t, w)
    for t, w, shift in ((96, 384, 37), (300, 512, 201), (40, 90, 0)):
        check_mirror(t, w, shift)
    check_nodes()
    print("ALL OK")
