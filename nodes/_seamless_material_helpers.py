"""Seamless Material Pixaroma: the pure math (torch only, no ComfyUI imports, so it can be tested alone).

A seamless tile in, five maps out for a 3D program (Blender's Principled BSDF and the like):
- Color: the tile itself.
- Height: the tile's brightness (smoothed a little, stretched to the full 0..1 range). Dark = deep.
- Normal: the slope of the height, as a tangent-space normal map (OpenGL green-up, or DirectX green-down).
- Roughness: from the brightness, squeezed into a range you choose (bright = a bit smoother).
- AO: the crevices of the height (a blurred height minus the height), dark where the surface dips.

EVERY neighbourhood step (the blurs and the slope) WRAPS around the edges: the pixels past the right edge are the
ones from the left edge, and so on. So the maps of a seamless tile are seamless too, by construction: the maps of the
tile shifted by (dy, dx) are exactly the maps shifted by (dy, dx). With ordinary zero padding the maps get a line
along every edge (the CPU test in D:\\Claude Tests\\_seamless_material proves both).

The honest limit: height comes from BRIGHTNESS, so it is right where dark means deep (the gaps between stones,
planks, tiles) and wrong where a dark COLOUR is not deeper (a dark red flower on a pale leaf becomes a hole; light
mortar between darker bricks comes out raised, which invert_height fixes).
"""
import math

import torch
import torch.nn.functional as F

NORMAL_FORMATS = ("OpenGL (Blender)", "DirectX")
MAP_NAMES = ("color", "roughness", "normal", "height", "ao")   # the file tags Blender's Node Wrangler matches

REF_SIZE = 1024          # the blur sizes and the relief below are set for a 1024 px tile and scale with the tile
SMOOTH_SIGMA = 0.8       # px at 1024: takes the pixel noise out of the height before the slope is taken
DEPTH_PER_STRENGTH = 1.0 / 128.0   # the full height range is 1/128 of the tile wide at strength 1 (8 px at 1024)
AO_SIGMAS = (4.0, 16.0)  # px at 1024: a small and a wider crevice
AO_MAX_DARK = 0.75       # the deepest crevice gets this much darker (AO 0.25)
LOW_Q, HIGH_Q = 0.005, 0.995   # the height is stretched so 0.5 % of pixels sit at 0 and 0.5 % at 1
MIN_SIDE = 16            # smaller pictures are refused (a material needs more than a few pixels)


# ---------------------------------------------------------------- the wrap-around building blocks

def _pad(x, ph, pw, wrap=True):
    """x (N, C, H, W). Pad by ph rows top and bottom, pw columns left and right. wrap=True copies the opposite edge
    in (the whole point); wrap=False pads with zeros (only the CPU test uses it, to prove the wrap matters)."""
    if wrap:
        return F.pad(x, (pw, pw, ph, ph), mode="circular")
    return F.pad(x, (pw, pw, ph, ph), mode="constant", value=0.0)


def _gauss_kernel(sigma, max_radius):
    radius = max(1, min(int(math.ceil(3.0 * sigma)), max_radius))
    t = torch.arange(-radius, radius + 1, dtype=torch.float64)
    k = torch.exp(-0.5 * (t / sigma) ** 2)
    return (k / k.sum()).float(), radius


def blur(x, sigma, wrap=True):
    """Gaussian blur of x (N, 1, H, W), separable, wrapping around the edges. sigma in px."""
    if sigma <= 0:
        return x
    h, w = x.shape[-2], x.shape[-1]
    k, r = _gauss_kernel(sigma, max(1, min(h, w) - 1))
    k = k.to(device=x.device, dtype=x.dtype)
    x = F.conv2d(_pad(x, 0, r, wrap), k.view(1, 1, 1, -1))
    x = F.conv2d(_pad(x, r, 0, wrap), k.view(1, 1, -1, 1))
    return x


def slopes(h, wrap=True):
    """Sobel slope of h (N, 1, H, W), height units per pixel: (d/dx to the right, d/dy DOWN the picture)."""
    kx = torch.tensor([[-1.0, 0.0, 1.0], [-2.0, 0.0, 2.0], [-1.0, 0.0, 1.0]], device=h.device, dtype=h.dtype) / 8.0
    ky = kx.t().contiguous()
    p = _pad(h, 1, 1, wrap)
    return F.conv2d(p, kx.view(1, 1, 3, 3)), F.conv2d(p, ky.view(1, 1, 3, 3))


def _quantile(x, q):
    """Per picture quantile of x (N, 1, H, W) -> (N, 1, 1, 1). kthvalue: exact, no size limit (torch.quantile refuses
    a 4096 px picture), and the same for a shifted picture (the order of the pixels does not matter)."""
    flat = x.reshape(x.shape[0], -1)
    n = flat.shape[1]
    k = min(n, max(1, int(round(q * (n - 1))) + 1))
    return flat.kthvalue(k, dim=1).values.view(-1, 1, 1, 1)


def _stretch(x, lo_q=LOW_Q, hi_q=HIGH_Q):
    """Stretch each picture so its low quantile is 0 and its high one 1 (clamped). A flat picture becomes 0.5."""
    lo, hi = _quantile(x, lo_q), _quantile(x, hi_q)
    span = hi - lo
    flat = span < 1e-6
    out = ((x - lo) / span.clamp_min(1e-6)).clamp(0.0, 1.0)
    return torch.where(flat, torch.full_like(out, 0.5), out)


# ---------------------------------------------------------------- the maps

def luminance(rgb):
    """rgb (N, 3, H, W) 0..1 -> (N, 1, H, W) brightness (Rec. 709 weights on the picture's own values)."""
    w = torch.tensor([0.2126, 0.7152, 0.0722], device=rgb.device, dtype=rgb.dtype).view(1, 3, 1, 1)
    return (rgb * w).sum(dim=1, keepdim=True)


def make_maps(image, strength=1.0, roughness_min=0.55, roughness_max=0.9, invert_height=False,
              normal_format=NORMAL_FORMATS[0], wrap=True):
    """image: a ComfyUI picture batch (B, H, W, C), values 0..1. Returns a dict of five (B, H, W, 3) float pictures:
    color, roughness, normal, height, ao. `wrap` is for the CPU test only (False = zero padding, which leaves a line
    along every edge)."""
    if image.ndim != 4 or image.shape[-1] < 1:
        raise ValueError("Seamless Material needs a picture (IMAGE).")
    _, H, W, c = image.shape
    if H < MIN_SIDE or W < MIN_SIDE:
        raise ValueError(f"Seamless Material needs a picture at least {MIN_SIDE} px on each side (got {W}x{H}).")
    x = image.float()
    if c == 1:
        x = x.repeat(1, 1, 1, 3)
    rgb = x[..., :3].clamp(0.0, 1.0).permute(0, 3, 1, 2).contiguous()      # (B, 3, H, W)

    scale = math.sqrt(H * W) / REF_SIZE          # the same look at 1024 and at 2048
    lum = _stretch(blur(luminance(rgb), max(0.35, SMOOTH_SIGMA * scale), wrap))

    # Height: dark = deep (or the other way round with invert_height).
    height = 1.0 - lum if invert_height else lum

    # Normal: the slope of the height. The full height range is DEPTH_PER_STRENGTH of the tile wide, so the slope in
    # "depth per width" is (height per px) * (tile px) * depth. A tangent-space normal is (-dh/dx, dh/dy_up, 1).
    gx, gy_down = slopes(height, wrap)
    k = float(strength) * DEPTH_PER_STRENGTH * math.sqrt(H * W)
    nx = -gx * k
    ny = gy_down * k                     # OpenGL: green points UP the picture; height rising downward = facing up
    if normal_format == NORMAL_FORMATS[1]:
        ny = -ny                         # DirectX: green points DOWN
    nz = torch.ones_like(nx)
    n = torch.cat([nx, ny, nz], dim=1)
    n = n / n.norm(dim=1, keepdim=True).clamp_min(1e-8)
    normal = n * 0.5 + 0.5

    # Roughness: bright = a little smoother, inside the chosen range.
    r_lo, r_hi = float(roughness_min), float(roughness_max)
    rough = r_lo + (r_hi - r_lo) * (1.0 - lum)

    # AO: how far the height dips below its surroundings, at a small and a wider size.
    cav = torch.zeros_like(height)
    for s in AO_SIGMAS:
        cav = cav + (blur(height, max(0.5, s * scale), wrap) - height).clamp_min(0.0)
    top = _quantile(cav, HIGH_Q).clamp_min(1e-6)
    ao = 1.0 - AO_MAX_DARK * (cav / top).clamp(0.0, 1.0)

    def back(m):                         # (B, 1|3, H, W) -> (B, H, W, 3)
        if m.shape[1] == 1:
            m = m.repeat(1, 3, 1, 1)
        return m.clamp(0.0, 1.0).permute(0, 2, 3, 1).contiguous()

    return {
        "color": rgb.permute(0, 2, 3, 1).contiguous(),
        "roughness": back(rough),
        "normal": back(normal),
        "height": back(height),
        "ao": back(ao),
    }


# ---------------------------------------------------------------- saving names

_BAD_CHARS = '<>:"|?*'


def clean_save_to(text):
    """'materials/stone' -> ('materials', 'stone'). Folders are kept (forward or back slashes), every character a
    file name cannot hold becomes '_', '.' / '..' parts are dropped. The containment test is the caller's
    (_path_guard.safe_join); this only makes a tidy name. Empty -> ('', 'material')."""
    raw = str(text or "").replace("\\", "/")
    parts = []
    for p in raw.split("/"):
        p = "".join("_" if (ch in _BAD_CHARS or ord(ch) < 32) else ch for ch in p).strip().strip(".").strip()
        if p and p not in (".", ".."):
            parts.append(p)
    if not parts:
        return "", "material"
    return "/".join(parts[:-1]), parts[-1]


def next_folder_name(existing_names, name):
    """The next free '<name>_001' style folder name, after the highest number already there (never fills a gap,
    so the newest is always the highest number)."""
    best = 0
    prefix = name + "_"
    for e in existing_names:
        if e.startswith(prefix):
            tail = e[len(prefix):]
            if tail.isdigit():
                best = max(best, int(tail))
    return f"{name}_{best + 1:03d}"


def file_names(name):
    """The five file names Blender's Node Wrangler (Shift+Ctrl+T) wires by itself."""
    return {m: f"{name}_{m}.png" for m in MAP_NAMES}
