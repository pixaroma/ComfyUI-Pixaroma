"""H3 Latent Upscale Pixaroma: the upscaler network and how it is run.

A port of the 3D MiniMax H3 latent upscaler from Comfyui_Minimax_h3_latent_Upscaler by LBH-123-AI (MIT). The
network, the latent normalisation, the size rounding and the temporal chunking below are theirs, kept unchanged
so the enlarged latent is bit-identical to the original node's with the settings that node uses by default
(target size, align 32, temporal chunking on, fp16 on the GPU). What differs: only that one way of setting the
size, safetensors files only, the model moved on and off the card through ComfyUI's memory manager, Stop is
honoured between chunks, and a joint picture + sound H3 latent goes in and comes out whole (a sound part is added
when the latent has none, so it can go straight on to H3 Audio Sync or a sampler).

The model file itself is not part of the pack: the user downloads it into models/latent_upscale_models.

Original licence (MIT), kept as its terms require:

    MIT License

    Copyright (c) 2026 LBH-123-AI

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
"""
import re

import torch
import torch.nn as nn
import torch.nn.functional as F

VAE_DOWNSAMPLE = 16       # H3's video VAE: one latent pixel = 16 x 16 picture pixels
ALIGN = 32                # the original's pixel alignment ("32 is strictly recommended")
CHUNK = 32                # latent frames per temporal chunk, the original's
H3_CHANNELS = 24

# MiniMax H3 latent normalisation stats (24 channels), the original's
LATENTS_MEAN = [
    0.858090341091156, -0.9606591463088989, 1.0661640167236328, -0.5090325474739075,
    -0.2727581858634949, -1.3675414323806763, -0.2553254961967468, -0.26907554268836975,
    -0.5376840829849243, -0.0464097298681736, 0.6657370328903198, 0.19690127670764923,
    -0.5460608005523682, -0.4035342037677765, -0.23683024942874908, 0.25928452610969543,
    -0.30133944749832153, 0.211341992020607, -1.1206848621368408, 0.3581933379173279,
    -0.04225143790245056, 0.2604829967021942, 0.22864092886447906, 0.7056031823158264,
]
LATENTS_STD = [
    1.2223774194717407, 1.2767263650894165, 1.6831774711608887, 1.7549455165863037,
    1.5636216402053833, 2.194143533706665, 0.9653137922286987, 1.0569885969161987,
    0.841948926448822, 0.7729952931404114, 1.8955937623977661, 0.946841835975647,
    0.7996809482574463, 0.44988900423049927, 0.7197399735450745, 0.6936293244361877,
    2.961095094680786, 2.7694199085235596, 3.0496184825897217, 2.1088054180145264,
    3.276226282119751, 3.1627357006073, 2.2816812992095947, 2.6127843856811523,
]


def _norm_tensors(device, dtype):
    mean = torch.tensor(LATENTS_MEAN, dtype=dtype, device=device).view(1, -1, 1, 1, 1)
    std = torch.tensor(LATENTS_STD, dtype=dtype, device=device).view(1, -1, 1, 1, 1)
    return mean, std


# ---------------------------------------------------------------- the network (module names = the file's keys)

def _normalization(channels):
    return nn.GroupNorm(32, channels)


class _ResBlockEmb3D(nn.Module):
    def __init__(self, channels, emb_channels, dropout=0, out_channels=None):
        super().__init__()
        self.out_channels = out_channels or channels
        self.in_layers = nn.Sequential(
            _normalization(channels), nn.SiLU(),
            nn.Conv3d(channels, self.out_channels, 3, padding=1),
        )
        self.emb_layers = nn.Sequential(
            nn.SiLU(), nn.Linear(emb_channels, 2 * self.out_channels),
        )
        self.out_norm = _normalization(self.out_channels)
        self.out_layers = nn.Sequential(
            nn.SiLU(), nn.Dropout(p=dropout),
            nn.Conv3d(self.out_channels, self.out_channels, 3, padding=1),
        )
        self.skip = (
            nn.Conv3d(channels, self.out_channels, 1)
            if self.out_channels != channels else nn.Identity()
        )

    def forward(self, x, emb):
        h = self.in_layers(x)
        emb_out = self.emb_layers(emb).type(h.dtype)
        while len(emb_out.shape) < len(h.shape):
            emb_out = emb_out[..., None]
        scale, shift = torch.chunk(emb_out, 2, dim=1)
        h = self.out_norm(h) * (1 + scale) + shift
        h = self.out_layers(h)
        return self.skip(x) + h


class _TemporalConv(nn.Module):
    def __init__(self, channels, kernel_size=5):
        super().__init__()
        padding = kernel_size // 2
        self.norm = _normalization(channels)
        self.dwconv = nn.Conv3d(channels, channels, kernel_size=(kernel_size, 1, 1),
                                padding=(padding, 0, 0), groups=channels)
        self.pwconv = nn.Conv3d(channels, channels, kernel_size=1)

    def forward(self, x):
        identity = x
        h = self.norm(x)
        h = F.silu(h)
        h = self.dwconv(h)
        h = self.pwconv(h)
        return identity + h


class LatentResizer3D(nn.Module):
    def __init__(self, in_channels=24, in_blocks=12, out_blocks=12, channels=512, dropout=0.1,
                 temporal_every=2, temporal_kernel=5):
        super().__init__()
        self.conv_in = nn.Conv3d(in_channels, channels, 3, padding=1)
        embed_dim = 64
        self.embed = nn.Sequential(nn.Linear(1, embed_dim), nn.SiLU(), nn.Linear(embed_dim, embed_dim))

        self.in_blocks = nn.ModuleList()
        for b in range(in_blocks):
            self.in_blocks.append(_ResBlockEmb3D(channels, embed_dim, dropout))
            if temporal_every > 0 and b % temporal_every == 0:
                self.in_blocks.append(_TemporalConv(channels, temporal_kernel))

        self.out_blocks = nn.ModuleList()
        for b in range(out_blocks):
            self.out_blocks.append(_ResBlockEmb3D(channels, embed_dim, dropout))
            if temporal_every > 0 and b % temporal_every == 0:
                self.out_blocks.append(_TemporalConv(channels, temporal_kernel))

        self.norm_out = _normalization(channels)
        self.conv_out = nn.Conv3d(channels, in_channels, 3, padding=1)

    def forward(self, x, scale=None, target_size=None, enable_chunking=True, check_interrupt=None):
        if target_size is not None:
            size = target_size
        elif scale is not None:
            size = tuple(int(round(s * scale)) for s in x.shape[-3:])
        else:
            return x

        if size == x.shape[-3:]:
            return x

        B, C, T, H, W = x.shape

        tk = 0
        for b in self.in_blocks:
            if isinstance(b, _TemporalConv):
                tk = b.dwconv.weight.shape[2]
                break

        overlap = tk
        chunk = CHUNK

        if not enable_chunking or T <= chunk:
            return self._forward_seg(x, scale, size)

        x_padded = F.pad(x, (0, 0, 0, 0, overlap, overlap), mode="replicate")

        out_full = torch.zeros(B, C, T, size[-2], size[-1], device=x.device, dtype=x.dtype)
        weight_full = torch.zeros(1, 1, T, 1, 1, device=x.device, dtype=x.dtype)

        start = 0
        while start < T:
            if check_interrupt is not None:
                check_interrupt()
            seg_start = start
            seg_end = min(T, start + chunk)
            out_start = max(0, seg_start - overlap)
            out_end = min(T, seg_end + overlap)
            lo = max(0, out_start - overlap)
            hi = min(T + 2 * overlap, out_end + overlap)

            seg = x_padded[:, :, lo:hi].contiguous()
            seg_size = (hi - lo, size[-2], size[-1])
            seg_out = self._forward_seg(seg, scale, seg_size)

            s0 = (out_start + overlap) - lo
            s1 = s0 + (out_end - out_start)
            valid_out = seg_out[:, :, s0:s1]
            n_valid = out_end - out_start

            weight = torch.ones(n_valid, device=x.device, dtype=x.dtype)
            if seg_start > out_start:
                blend_len = seg_start - out_start
                weight[:blend_len] = torch.arange(1, blend_len + 1, device=x.device, dtype=x.dtype) / (blend_len + 1)
            if out_end > seg_end:
                blend_len = out_end - seg_end
                weight[-blend_len:] = torch.arange(blend_len, 0, -1, device=x.device, dtype=x.dtype) / (blend_len + 1)

            out_full[:, :, out_start:out_end] += valid_out * weight.view(1, 1, n_valid, 1, 1)
            weight_full[:, :, out_start:out_end] += weight.view(1, 1, n_valid, 1, 1)

            start += chunk
            del seg, seg_out, valid_out

        return out_full / weight_full.clamp(min=1e-8)

    def _forward_seg(self, x, scale, size):
        scale_emb = torch.tensor([scale - 1 if scale is not None else 0.0],
                                 dtype=x.dtype, device=x.device).unsqueeze(0)
        emb = self.embed(scale_emb)

        x = self.conv_in(x)
        for b in self.in_blocks:
            x = b(x, emb.expand(x.shape[0], -1)) if isinstance(b, _ResBlockEmb3D) else b(x)

        x = F.interpolate(x, size=size, mode="trilinear", align_corners=False)

        for b in self.out_blocks:
            x = b(x, emb.expand(x.shape[0], -1)) if isinstance(b, _ResBlockEmb3D) else b(x)

        x = self.norm_out(x)
        x = F.silu(x)
        return self.conv_out(x)


# ---------------------------------------------------------------- loading a model file

def _detect_arch(sd):
    """The original's architecture sniffing (attention is always off there too)."""
    cfg = {"in_channels": 24, "in_blocks": 12, "out_blocks": 12, "channels": 512, "dropout": 0.1,
           "temporal_every": 2, "temporal_kernel": 5}
    if "conv_in.weight" in sd:
        cfg["in_channels"] = sd["conv_in.weight"].shape[1]
        cfg["channels"] = sd["conv_in.weight"].shape[0]
    in_ids, out_ids, t_in, t_out = set(), set(), set(), set()
    for k in sd.keys():
        m = re.match(r"in_blocks\.(\d+)\.in_layers\.", k)
        if m:
            in_ids.add(int(m.group(1)))
        m = re.match(r"out_blocks\.(\d+)\.in_layers\.", k)
        if m:
            out_ids.add(int(m.group(1)))
        m = re.match(r"in_blocks\.(\d+)\.dwconv\.weight", k)
        if m:
            t_in.add(int(m.group(1)))
        m = re.match(r"out_blocks\.(\d+)\.dwconv\.weight", k)
        if m:
            t_out.add(int(m.group(1)))
    if in_ids:
        cfg["in_blocks"] = len(in_ids)
    if out_ids:
        cfg["out_blocks"] = len(out_ids)
    if t_in or t_out:
        cfg["temporal_every"] = 2
        for k in sd.keys():
            if k.endswith("dwconv.weight"):
                cfg["temporal_kernel"] = sd[k].shape[2]
                break
    else:
        cfg["temporal_every"] = 0
    return cfg


def load_model_file(path, dtype):
    """safetensors file -> the network on the CPU in `dtype`, ready to move to the card. Raises ValueError with
    a plain message when the file is not an H3 latent upscaler of this kind."""
    from safetensors.torch import load_file
    try:
        sd = load_file(path, device="cpu")
    except Exception as e:    # safetensors' own error is not a ValueError (a cut-off download, a renamed file)
        raise ValueError("the file could not be read, maybe a broken or unfinished download (%s)" % str(e)[:160])
    sd = {k: v.to(torch.float16) if v.dtype == torch.float8_e4m3fn else v for k, v in sd.items()}
    if any(k.startswith("upscaler.") for k in sd):
        sd = {k[len("upscaler."):]: v for k, v in sd.items() if k.startswith("upscaler.")}
    if "conv_in.weight" not in sd or "embed.0.weight" not in sd:
        raise ValueError("this file is not a MiniMax H3 3D latent upscaler")
    cfg = _detect_arch(sd)
    model = LatentResizer3D(**cfg)
    try:
        model.load_state_dict(sd, strict=True)
    except RuntimeError as e:
        raise ValueError("this file does not match the 3D latent upscaler layout (%s)" % str(e).splitlines()[0])
    model = model.eval().requires_grad_(False)
    if dtype != torch.float32:
        model = model.to(dtype)
    return model


# ---------------------------------------------------------------- sizes and the run

def target_latent_size(h_in, w_in, width, height):
    """The original's 'target dimensions' rounding: (h_out, w_out, scale) in latent pixels."""
    w_px, h_px = float(width), float(height)
    scale = (w_px / (w_in * VAE_DOWNSAMPLE) + h_px / (h_in * VAE_DOWNSAMPLE)) / 2.0
    w_al = round(w_px / ALIGN) * ALIGN
    h_al = round(h_px / ALIGN) * ALIGN
    w_fin = round(w_al / VAE_DOWNSAMPLE) * VAE_DOWNSAMPLE
    h_fin = round(h_al / VAE_DOWNSAMPLE) * VAE_DOWNSAMPLE
    return max(1, int(h_fin // VAE_DOWNSAMPLE)), max(1, int(w_fin // VAE_DOWNSAMPLE)), scale


def needs_upscale(samples, width, height):
    """False when the target rounds to the latent's own size (the original then returns the latent unchanged)."""
    h_in, w_in = samples.shape[-2], samples.shape[-1]
    h_out, w_out, _ = target_latent_size(h_in, w_in, width, height)
    return (h_out, w_out) != (h_in, w_in)


ASPECT_TOLERANCE = 0.10   # rounding to 32 moves the shape by about 2 %; more than this is a different shape


def _fitting_size(h_in, w_in, width, height):
    """A target with the video's own shape and never smaller than the video: the long side is the larger of the
    asked one and the video's, the short side follows the shape, rounded to ALIGN (up when rounding would drop it
    below the video's)."""
    vid_w, vid_h = w_in * VAE_DOWNSAMPLE, h_in * VAE_DOWNSAMPLE
    landscape = w_in >= h_in
    vid_long, vid_short = (vid_w, vid_h) if landscape else (vid_h, vid_w)
    long_side = max(int(width), int(height), -(-vid_long // ALIGN) * ALIGN)
    short = max(ALIGN, round(long_side * vid_short / vid_long / ALIGN) * ALIGN)
    if short < vid_short:
        short = -(-vid_short // ALIGN) * ALIGN
    return (long_side, short) if landscape else (short, long_side)


def check_size(samples, width, height):
    """Raises ValueError when the target is smaller than the latent on either side, or has another shape. The
    original refuses only an overall smaller target and stretches the rest silently; we stop those runs too
    (a portrait size on a landscape clip was the easy mistake), so every run we let through is the original's."""
    h_in, w_in = samples.shape[-2], samples.shape[-1]
    h_out, w_out, _ = target_latent_size(h_in, w_in, width, height)
    vid_w, vid_h = w_in * VAE_DOWNSAMPLE, h_in * VAE_DOWNSAMPLE
    if w_out < w_in or h_out < h_in:
        fw, fh = _fitting_size(h_in, w_in, width, height)
        raise ValueError(
            "the target %d x %d is smaller than the video it gets (%d x %d) on at least one side. This node only "
            "makes a latent bigger and keeps its shape, for example %d x %d." % (width, height, vid_w, vid_h, fw, fh))
    if abs((w_out / h_out) / (w_in / h_in) - 1.0) > ASPECT_TOLERANCE:
        fw, fh = _fitting_size(h_in, w_in, width, height)
        raise ValueError(
            "the target %d x %d has a different shape from the video it gets (%d x %d), so the video would come out "
            "stretched. Keep the shape of your video, for example %d x %d." % (width, height, vid_w, vid_h, fw, fh))


def upscale_tensor(model, samples, width, height, device, dtype, check_interrupt=None):
    """One video (B, 24, T, H, W) or picture (B, 24, H, W) latent -> enlarged, on the CPU in its own dtype.
    The model must already be on `device` in `dtype`."""
    orig_dtype = samples.dtype
    was_4d = samples.dim() == 4
    s = samples.to(device=device, dtype=dtype, copy=True)
    if was_4d:
        s = s.unsqueeze(2)
    _, _, t, h_in, w_in = s.shape
    h_out, w_out, scale = target_latent_size(h_in, w_in, width, height)
    mean, std = _norm_tensors(device, dtype)
    with torch.inference_mode():
        s_norm = (s - mean) / std
        del s
        out = model(s_norm, scale=scale, target_size=(t, h_out, w_out), enable_chunking=True,
                    check_interrupt=check_interrupt)
        del s_norm
        out = out * std + mean
    if was_4d:
        out = out.squeeze(2)
    return out.to(device="cpu", dtype=orig_dtype)


def activation_bytes(samples, width, height, dtype, channels=512):
    """A rough figure for the card memory one chunk needs, to ask ComfyUI to make room first."""
    h_in, w_in = samples.shape[-2], samples.shape[-1]
    t = samples.shape[2] if samples.dim() == 5 else 1
    h_out, w_out, _ = target_latent_size(h_in, w_in, width, height)
    seg_t = min(t, CHUNK + 4 * 5)
    elem = torch.finfo(dtype).bits // 8
    return 4 * samples.shape[0] * channels * seg_t * h_out * w_out * elem


# ---------------------------------------------------------------- H3 picture + sound latents

def h3_parts(latent):
    """(video, rest, kind) from a LATENT dict: kind 'av' (joint picture + sound), 'video' (5-D) or 'image' (4-D).
    Raises ValueError for anything that is not a MiniMax H3 latent."""
    samples = latent.get("samples") if isinstance(latent, dict) else None
    if samples is None:
        raise ValueError("the latent input is empty")
    if getattr(samples, "is_nested", False):
        parts = samples.unbind()
        video, rest, kind = parts[0], tuple(parts[1:]), "av"
    else:
        video, rest, kind = samples, (), ("video" if samples.dim() == 5 else "image")
    if video.dim() not in (4, 5) or video.shape[1] != H3_CHANNELS:
        raise ValueError(
            "this is not a MiniMax H3 latent (it has %s channels, H3 has %d). Feed it the output of VAE Encode "
            "with the H3 video VAE, or the latent of an H3 sampler." % (
                video.shape[1] if video.dim() > 1 else "no", H3_CHANNELS))
    return video, rest, kind


def empty_sound_for(video):
    """A silent sound part for a (B, 24, T, H, W) video latent, the size ComfyUI's Empty MiniMax H3 AV Latent
    gives the same clip, so the result can go to H3 Audio Sync or a sampler."""
    import comfy.model_management
    try:
        from comfy.ldm.minimax.model import FRAME_PER_TOKEN
        from comfy_extras.nodes_minimax_h3 import temporal_shape
        frames = sum(FRAME_PER_TOKEN[k % 5] for k in range(video.shape[2]))
        audio_t = temporal_shape(frames)[2]
    except Exception:
        t = video.shape[2]
        frames = 5 if t <= 2 else 5 + 17 * ((t - 2) // 5)
        audio_t = round(frames / 24 * 40)
    return torch.zeros([video.shape[0], 32, 2, audio_t], device=comfy.model_management.intermediate_device())
