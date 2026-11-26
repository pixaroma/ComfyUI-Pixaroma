"""Seamless Tile / Seamless Preview Pixaroma: the pure math (torch only, no ComfyUI imports, so it can be tested alone).

Two tricks make a picture with no edge, so it repeats on all four sides:
- Torus position code: a transformer image model (Krea 2, Z-Image) knows where a token sits only from its rotary
  position code (RoPE). Every height / width frequency is snapped to a whole number of turns per tile, so the last
  column and the first column are neighbours like any other two columns. The idea of snapping the frequencies follows
  the SpheRoPE paper (Hirschorn et al., 2026); this is our own code.
- Wrap padding: every convolution that pads its input with zeros gets the opposite edge copied in instead (a forward
  pre-hook), so a VAE decoder or a UNet (SDXL) sees a ring too.
And one check: the seam score compares the jump across the wrap line with the jumps across the lines inside the
picture, so a picture with a real seam stands out.
"""
import math

import torch

TILE_MODES = ("Both", "Left and right", "Up and down", "Off")
VIEWS = ("Tile", "2x2", "3x3", "Offset", "Half-drop", "Half-brick")

# The seam check compares lines every 4 px. Calibrated 2026-11-15 on the 240 spike pictures (Krea 2 1024 / 1536,
# Z-Image): every 4 px = all 120 seamless directions PASS and 97 of 120 normal ones FAIL (+7 WARN); every 16 px
# failed one seamless oak-planks picture, whose plank joint happened to sit on the wrap line.
SEAM_STEP = 4
WARN_FACTOR = 1.25      # the wrap line is the worst line but within this factor of the next worst: WARN
MIN_SEAM_SIZE = 64      # smaller pictures get "N/A"
TILED_MARGIN = 16       # latent px copied around a latent before a TILED decode (not exact, but very close)


def mode_axes(mode):
    """(wrap up-down, wrap left-right) for a dropdown value. Unknown values count as Both."""
    if mode == "Off":
        return False, False
    if mode == "Left and right":
        return False, True
    if mode == "Up and down":
        return True, False
    return True, True


# ---------------------------------------------------------------- torus position code

def snapped_omegas(dim, theta, period, min_turns=0.5):
    """The frequencies of one RoPE axis (as ComfyUI's flux rope makes them), each moved to the nearest whole number
    of turns per `period` tokens. A frequency that makes less than `min_turns` turns becomes 0 ("same place for
    all"). 0.5 = plain rounding (Krea 2). Z-Image uses 1.0: rounding its channels of 0.5-1 turn UP to a full turn
    made 57 of 100 pictures 4 copies of a half-size tile (seamless.md #17d)."""
    scale = torch.linspace(0, (dim - 2) / dim, steps=dim // 2, dtype=torch.float64)
    omega = 1.0 / (theta ** scale)
    raw = omega * period / (2 * math.pi)
    turns = torch.round(raw)
    turns[raw < min_turns] = 0
    return turns * (2 * math.pi / period)


def torus_rope(pos, dim, theta, period, min_turns=0.5):
    """Same layout as comfy.ldm.flux.math.rope ([..., n, dim/2, 2, 2], float32), with snapped frequencies.
    Positions are taken modulo the period first, so the angle is exact for any whole-number position."""
    # float64 only where every backend has it (core's rope moves MPS, Intel XPU and DirectML to the CPU for the
    # same reason); ROCm reports "cuda". The tensor is tiny, so the CPU costs nothing elsewhere.
    work = pos.device if pos.device.type in ("cuda", "cpu") else torch.device("cpu")
    # Move FIRST, cast after: on Apple Silicon one .to(device=cpu, dtype=float64) of this strided MPS slice returned
    # wrong values (the picture came out as noise); two steps match the CPU (seamless.md #28). Same bytes on cuda / cpu.
    p = torch.remainder(pos.to(device=work).to(dtype=torch.float64), float(period))
    ang = p[..., None] * snapped_omegas(dim, theta, period, min_turns).to(work)
    c, s = torch.cos(ang), torch.sin(ang)
    out = torch.stack([c, -s, s, c], dim=-1)
    out = out.reshape(*out.shape[:-1], 2, 2)
    return out.to(dtype=torch.float32, device=pos.device)


class TorusEmbedND(torch.nn.Module):
    """Stands in for ComfyUI's EmbedND for one model call. The original makes the whole position code (so the axes
    we do not touch stay byte-identical to ComfyUI's), then the height (axis 1) and width (axis 2) slices are
    replaced by the snapped ones. `calls` counts uses, so the node can prove it was really used.
    `tail` = snap only the LAST `tail` tokens (the picture), for a model whose text tokens also sit on the height /
    width axes (Qwen Image 2.1): their code stays ComfyUI's own, so its cached text is the same with or without us."""

    def __init__(self, orig, period_h=None, period_w=None, min_turns=0.5, tail=None):
        super().__init__()
        self.orig = orig
        self.period_h = period_h
        self.period_w = period_w
        self.min_turns = min_turns
        self.tail = tail
        self.calls = 0

    def forward(self, ids):
        out = self.orig(ids)
        axes = list(self.orig.axes_dim)
        half = sum(axes) // 2
        if out.shape[-1] != 2 or out.shape[-2] != 2 or out.shape[-3] != half or ids.shape[-1] != len(axes):
            raise RuntimeError("Seamless Tile: this model's position code has an unknown layout "
                               f"(shape {tuple(out.shape)}, axes {axes}). ComfyUI may have changed.")
        t0 = 0
        if self.tail is not None:
            t0 = ids.shape[-2] - self.tail
            if t0 < 0 or out.shape[-4] != ids.shape[-2]:
                raise RuntimeError("Seamless Tile: the picture has more tokens than the model's position code "
                                   f"({self.tail} vs {ids.shape[-2]}). ComfyUI may have changed.")
        out = out.clone()
        start = 0
        for i, d in enumerate(axes):
            period = self.period_h if i == 1 else self.period_w if i == 2 else None
            if period:
                snapped = torus_rope(ids[..., t0:, i], d, self.orig.theta, period, self.min_turns).unsqueeze(1)
                out[..., t0:, start:start + d // 2, :, :] = snapped.to(out.dtype)
            start += d // 2
        self.calls += 1
        return out


# ---------------------------------------------------------------- wrap padding

def wrap_pad(x, ph, pw):
    """Copy `ph` rows / `pw` columns of the opposite edge around x (last two dims)."""
    if ph:
        x = torch.cat([x[..., -ph:, :], x, x[..., :ph, :]], dim=-2)
    if pw:
        x = torch.cat([x[..., -pw:], x, x[..., :pw]], dim=-1)
    return x


class WrapPadding:
    """Context manager: every Conv2d / Conv3d inside `module` with zero padding on a wrapped axis pads that axis
    with the opposite edge instead. The other axis keeps its normal padding. `undo()` puts everything back
    (safe to call twice); after it the module computes exactly what it did before.
    A layer with a `fused_norm` fast path (ComfyUI's FLUX.2 VAE decoder) pads inside its own kernel and never calls
    the conv layer, so the hooks would never run: that fast path is switched off while the wrap is on (same picture,
    more memory). `fired` = the ids of the wrapped convs that really ran, so a caller can prove none was skipped."""

    def __init__(self, module, wrap_h, wrap_w):
        self.module, self.wrap_h, self.wrap_w = module, bool(wrap_h), bool(wrap_w)
        self._saved, self._handles, self._fused = [], [], []
        self.count = 0
        self.fired = set()

    def apply(self):
        if not (self.wrap_h or self.wrap_w):
            return self
        self.fired = set()
        for m in self.module.modules():
            if getattr(m, "fused_norm", None) is True:
                self._fused.append(m)
                m.fused_norm = False
        for m in self.module.modules():
            if not isinstance(m, (torch.nn.Conv2d, torch.nn.Conv3d)):
                continue
            if getattr(m, "_pix_seam_wrapped", False) or getattr(m, "padding_mode", "zeros") != "zeros":
                continue
            pad = m.padding
            if not isinstance(pad, tuple) or len(pad) < 2:
                continue
            ph = pad[-2] if self.wrap_h else 0
            pw = pad[-1] if self.wrap_w else 0
            if not (ph or pw):
                continue
            new_pad = list(pad)
            if ph:
                new_pad[-2] = 0
            if pw:
                new_pad[-1] = 0
            self._saved.append((m, pad))
            m.padding = tuple(new_pad)
            m._pix_seam_wrapped = True

            def hook(mod, args, ph=ph, pw=pw, fired=self.fired):
                fired.add(id(mod))
                return (wrap_pad(args[0], ph, pw),) + tuple(args[1:])
            self._handles.append(m.register_forward_pre_hook(hook))
        self.count = len(self._saved)
        return self

    def skipped(self, inside):
        """The wrapped convs under `inside` (a sub-module, e.g. a VAE's decoder) that never ran since apply()."""
        ids = {id(m) for m in inside.modules()}
        return [m for m, _ in self._saved if id(m) in ids and id(m) not in self.fired]

    def undo(self):
        for h in self._handles:
            h.remove()
        for m, pad in self._saved:
            m.padding = pad
            try:
                del m._pix_seam_wrapped
            except AttributeError:
                pass
        for m in self._fused:
            m.fused_norm = True
        self._handles, self._saved, self._fused = [], [], []

    def __enter__(self):
        return self.apply()

    def __exit__(self, *exc):
        self.undo()
        return False


def wrap_pad_latent(x, wrap_h, wrap_w, margin=TILED_MARGIN):
    """Wrap-pad a latent before a tiled decode. Returns (padded, mh, mw); the margin never exceeds the size."""
    mh = min(margin, x.shape[-2]) if wrap_h else 0
    mw = min(margin, x.shape[-1]) if wrap_w else 0
    return wrap_pad(x, mh, mw), mh, mw


def crop_decoded(out, padded_hw, orig_hw, mh, mw, h_dim=-2, w_dim=-1):
    """Cut the margin back off a decoded picture. The decoder's scale is read from the shapes."""
    sh = out.shape[h_dim] / padded_hw[0]
    sw = out.shape[w_dim] / padded_hw[1]
    top, left = int(round(mh * sh)), int(round(mw * sw))
    height, width = int(round(orig_hw[0] * sh)), int(round(orig_hw[1] * sw))
    out = out.narrow(h_dim, top, height)
    return out.narrow(w_dim, left, width)


def size_hint(px, step):
    """'1008 or 992' style hint for a size that is not a multiple of `step` px."""
    lo = max(step, (px // step) * step)
    hi = lo + step
    return f"{hi} or {lo}" if lo != px else str(px)


# ---------------------------------------------------------------- the seam check

def _boundary_scores(img, axis, step):
    """img (C, H, W). Score of every line at a multiple of `step` px along `axis`: the mean jump across it divided
    by the mean jump across the two lines next to it. Index 0 = the wrap line (last pixel to first pixel)."""
    d = (img - torch.roll(img, 1, dims=axis)).abs()
    keep = [i for i in range(img.ndim) if i != img.ndim + axis]
    per = d.mean(dim=keep)
    n = per.shape[0]
    idx = torch.arange(0, n, step)
    near = 0.5 * (per[(idx - 1) % n] + per[(idx + 1) % n])
    return per[idx] / near.clamp_min(1e-6)


def seam_check(image, step=SEAM_STEP):
    """image: one ComfyUI picture (H, W, C), values 0..1. For each direction returns the status and the numbers.
    PASS = the wrap line is not the worst line in the picture (a perfect tile is the worst only by chance, about 1 in
    the number of lines). WARN = it is the worst, but close to the next worst. FAIL = it clearly stands out."""
    img = image[..., :3].float().permute(2, 0, 1).cpu()
    res = {}
    finite = bool(torch.isfinite(img).all())     # a NaN picture (fp16 overflow) would put NaN in the UI JSON
    for name, axis in (("left_right", -1), ("up_down", -2)):
        n = img.shape[axis]
        if not finite or n < max(MIN_SEAM_SIZE, step * 4):
            res[name] = {"status": "N/A", "ratio": None, "rank": None}
            continue
        s = _boundary_scores(img, axis, step)
        seam, others = float(s[0]), s[1:]
        worst = float(others.max())
        rank = float((others > seam).float().mean())        # share of inner lines worse than the wrap line
        median = float(others.median())
        ratio = round(seam / median, 3) if median > 1e-6 else None   # 1.0 = a normal line; None = no normal line
        if seam <= worst * (1 + 1e-6) + 1e-6:   # a tie (a flat picture, a pattern whose step divides the size)
            status = "PASS"                      # joins like any inner line; real pictures never tie exactly
        elif seam <= worst * WARN_FACTOR:
            status = "WARN"
        else:
            status = "FAIL"
        res[name] = {"status": status, "ratio": ratio, "rank": round(rank, 3),
                     "vs_worst": round(seam / max(worst, 1e-6), 3)}
    return res


# ---------------------------------------------------------------- the tiled views (one definition for the output)

def tile_view(images, view):
    """images (B, H, W, C). The pattern laid out the way the view shows it. Tile = the picture itself; 2x2 / 3x3 =
    repeats; Offset = moved by half a tile both ways, so the four corners meet in the middle; Half-drop = 3 columns,
    the middle one moved down by half a tile; Half-brick = 3 rows, the middle one moved right by half a tile."""
    h, w = images.shape[1], images.shape[2]
    if view == "2x2":
        return images.repeat(1, 2, 2, 1)
    if view == "3x3":
        return images.repeat(1, 3, 3, 1)
    if view == "Offset":
        return torch.roll(images, shifts=(h // 2, w // 2), dims=(1, 2))
    if view == "Half-drop":
        col = images.repeat(1, 2, 1, 1)
        cols = [col if c % 2 == 0 else torch.roll(col, shifts=h // 2, dims=1) for c in range(3)]
        return torch.cat(cols, dim=2)
    if view == "Half-brick":
        row = images.repeat(1, 1, 2, 1)
        rows = [row if r % 2 == 0 else torch.roll(row, shifts=w // 2, dims=2) for r in range(3)]
        return torch.cat(rows, dim=1)
    return images
