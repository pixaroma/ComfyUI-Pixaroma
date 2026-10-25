"""Video Tools Pixaroma - the pure part: the saved state, the plan (how many
frames each step keeps), and the frame + sound operations.

No ComfyUI import, so D:\\Claude Tests\\_video_tools\\engine_test.py can run it
with plain torch. The browser draws its timeline from the SAME plan
(js/video_tools/core.mjs planVideo); the test compares the two on the same cases.

The sound always follows the picture: frame f of a clip is the sound from
sample round(f * rate / fps), so every cut, join, loop and fade is done on the
sound at the matching samples, and the finished sound is exactly as long as the
finished frames.
"""

import json
import math

import torch
import torch.nn.functional as F

MAX_CLIPS = 8
JOINS = ("cut", "crossfade", "black")
LOOPS = ("off", "repeat", "pingpong", "seamless")
SIZES = ("fill", "fit", "stretch")
PREVIEWS = ("animated", "off")
MUSIC_MIX = ("music", "mix")   # a song wired into music: alone, or with the clips' own sound
MAX_FRAMES = 100000
MAX_SPAN = 2000          # the longest crossfade / fade / loop blend, in frames
MAX_TIMES = 100
MIN_FPS, MAX_FPS = 1.0, 240.0
_CHUNK = 8               # frames per resize / colour step (keeps the memory peak low)


def _int(v, lo, hi, dflt):
    if isinstance(v, bool):
        return dflt
    try:
        f = float(v)
    except (TypeError, ValueError):
        return dflt
    if not math.isfinite(f):
        return dflt
    return max(lo, min(hi, int(f)))


def _fps(v):
    if isinstance(v, bool):
        return 24.0
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 24.0
    if not math.isfinite(f):
        return 24.0
    return max(MIN_FPS, min(MAX_FPS, f))


def _pick(v, allowed, dflt):
    return v if isinstance(v, str) and v in allowed else dflt


def parse_state(raw):
    """A healed copy of the node's state. Never raises."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw.strip() else {}
        except (ValueError, TypeError, RecursionError):
            raw = {}
    if not isinstance(raw, dict):
        raw = {}
    clips = []
    src = raw.get("clips") if isinstance(raw.get("clips"), list) else []
    for i in range(MAX_CLIPS):
        c = src[i] if i < len(src) and isinstance(src[i], dict) else {}
        clips.append({
            "cutStart": _int(c.get("cutStart"), 0, MAX_FRAMES, 0),
            "cutEnd": _int(c.get("cutEnd"), 0, MAX_FRAMES, 0),
            "reverse": c.get("reverse") is True,
        })
    return {
        "clips": clips,
        "join": _pick(raw.get("join"), JOINS, "crossfade"),
        "joinFrames": _int(raw.get("joinFrames"), 1, MAX_SPAN, 12),
        "match": raw.get("match") is True,
        "matchStrength": _int(raw.get("matchStrength"), 0, 100, 100),
        "loop": _pick(raw.get("loop"), LOOPS, "off"),
        "loopTimes": _int(raw.get("loopTimes"), 1, MAX_TIMES, 2),
        "loopFrames": _int(raw.get("loopFrames"), 1, MAX_SPAN, 12),
        "fadeIn": _int(raw.get("fadeIn"), 0, MAX_SPAN, 0),
        "fadeOut": _int(raw.get("fadeOut"), 0, MAX_SPAN, 0),
        "size": _pick(raw.get("size"), SIZES, "fill"),
        "preview": _pick(raw.get("preview"), PREVIEWS, "animated"),
        # the frame rate when nothing is wired into fps (the stepper on the face)
        "fps": _fps(raw.get("fps")),
        "musicMix": _pick(raw.get("musicMix"), MUSIC_MIX, "music"),
    }


# ── the plan: frame counts only, mirrored in js/video_tools/core.mjs ────────
def kept_range(n, cut_start, cut_end):
    """[start, end) of the frames kept from a clip of n frames. At least one."""
    if n <= 0:
        return 0, 0
    s = min(cut_start, n - 1)
    e = max(s + 1, n - cut_end)
    return s, e


def plan(lengths, st):
    """lengths: the frame count of each input slot, or None when not wired.
    Returns every number the timeline and the engine need."""
    clips = []
    for slot, n in enumerate(lengths[:MAX_CLIPS]):
        if n is None or n <= 0:
            continue
        c = st["clips"][slot]
        s, e = kept_range(int(n), c["cutStart"], c["cutEnd"])
        clips.append({"slot": slot, "frames": int(n), "start": s, "end": e, "kept": e - s,
                      "reverse": c["reverse"], "xin": 0})
    joins = []
    pos = 0
    for k, c in enumerate(clips):
        if k == 0:
            c["at"] = 0
            pos = c["kept"]
            continue
        prev = clips[k - 1]
        if st["join"] == "crossfade":
            # The crossfade OUT of a clip may not reach back into the crossfade
            # that came INTO it: with a short middle clip the two overlapped and
            # clip 1 showed through clip 3 (review 2026-10-25, reproduced).
            n = min(st["joinFrames"], prev["kept"] - 1 - prev["xin"], c["kept"] - 1)
            n = max(0, n)
            joins.append({"kind": "crossfade" if n else "cut", "frames": n, "at": pos - n})
            c["at"] = pos - n
            c["xin"] = n
            pos += c["kept"] - n
        elif st["join"] == "black":
            n_out = min(st["joinFrames"], prev["kept"])
            n_in = min(st["joinFrames"], c["kept"])
            joins.append({"kind": "black", "out": n_out, "in": n_in, "at": pos})
            c["at"] = pos
            pos += c["kept"]
        else:
            joins.append({"kind": "cut", "frames": 0, "at": pos})
            c["at"] = pos
            pos += c["kept"]
    base = pos
    loop = st["loop"] if base > 0 else "off"
    times = st["loopTimes"]
    blend = 0
    if loop == "repeat":
        cycle = base
    elif loop == "pingpong":
        cycle = base + max(0, base - 2)
    elif loop == "seamless":
        blend = min(st["loopFrames"], base // 2)
        cycle = base - blend
    else:
        cycle, times = base, 1
    total = cycle * times
    return {
        "clips": clips, "joins": joins, "base": base, "loop": loop, "times": times, "cycle": cycle,
        "blend": blend, "total": total,
        "fadeIn": min(st["fadeIn"], total), "fadeOut": min(st["fadeOut"], total),
    }


# ── frames ──────────────────────────────────────────────────────────────────
def as_rgb(frames):
    """[N, H, W, C] with exactly 3 channels (RGBA loses alpha, grey repeats)."""
    if frames.dim() == 3:
        frames = frames.unsqueeze(0)
    c = frames.shape[-1]
    if c > 3:
        return frames[..., :3]
    if c < 3:
        return frames[..., :1].expand(*frames.shape[:-1], 3)
    return frames


def fit_size(frames, h, w, mode):
    """Every frame to h x w: fill (cover, crop the middle), fit (letterbox in
    black) or stretch. Done a few frames at a time."""
    n, fh, fw = frames.shape[0], frames.shape[1], frames.shape[2]
    if (fh, fw) == (h, w):
        return frames
    if mode == "stretch":
        sh, sw = h, w
    else:
        k = max(h / fh, w / fw) if mode == "fill" else min(h / fh, w / fw)
        sh, sw = max(1, int(round(fh * k))), max(1, int(round(fw * k)))
    out = torch.zeros((n, h, w, 3), dtype=frames.dtype)
    for i in range(0, n, _CHUNK):
        x = frames[i:i + _CHUNK].float().permute(0, 3, 1, 2)
        x = F.interpolate(x, size=(sh, sw), mode="bilinear", align_corners=False, antialias=True)
        x = x.permute(0, 2, 3, 1).clamp(0, 1).to(frames.dtype)
        if mode == "fill":
            t, l = (sh - h) // 2, (sw - w) // 2
            out[i:i + _CHUNK] = x[:, t:t + h, l:l + w]
        elif mode == "fit":
            t, l = (h - sh) // 2, (w - sw) // 2
            out[i:i + _CHUNK, t:t + sh, l:l + sw] = x
        else:
            out[i:i + _CHUNK] = x
    return out


def _stats(frames):
    """Per-channel mean and spread of a few frames, read on a small copy."""
    x = frames.float().permute(0, 3, 1, 2)
    if x.shape[-1] > 96 or x.shape[-2] > 96:
        x = F.interpolate(x, size=(min(96, x.shape[-2]), min(96, x.shape[-1])), mode="area")
    x = x.permute(1, 0, 2, 3).reshape(3, -1)
    return x.mean(dim=1), x.std(dim=1)


def match_colors(clip, ref_tail, strength):
    """Shift clip's colour and brightness so its first frames match the last
    frames before it (the seam), by `strength` (0..1)."""
    if strength <= 0 or clip.shape[0] == 0 or ref_tail.shape[0] == 0:
        return clip
    m = min(8, clip.shape[0])
    mu_c, sd_c = _stats(clip[:m])
    mu_r, sd_r = _stats(ref_tail)
    ratio = torch.where(sd_c > 1e-4, sd_r / sd_c.clamp(min=1e-4), torch.ones_like(sd_c)).clamp(0.25, 4.0)
    out = torch.empty_like(clip)
    for i in range(0, clip.shape[0], _CHUNK):
        x = clip[i:i + _CHUNK].float()
        y = (x - mu_c) * ratio + mu_r
        out[i:i + _CHUNK] = (x + (y - x) * strength).clamp(0, 1).to(clip.dtype)
    return out


def _ramp(n, rising, dtype):
    """n gains: rising 0 .. (n-1)/n (the first frame black), falling (n-1)/n .. 0."""
    g = torch.arange(n, dtype=torch.float32) / max(1, n)
    if not rising:
        g = 1.0 - (torch.arange(n, dtype=torch.float32) + 1) / max(1, n)
    return g.to(dtype)


def assemble(clips, pl):
    """The clips (already cut, turned, sized and coloured) joined into one
    tensor of pl['base'] frames, written once into a tensor made to size."""
    first = clips[0]
    out = torch.empty((pl["base"],) + tuple(first.shape[1:]), dtype=first.dtype)
    for k, c in enumerate(clips):
        at = pl["clips"][k]["at"]
        if k == 0:
            out[0:c.shape[0]] = c
            continue
        j = pl["joins"][k - 1]
        if j["kind"] == "crossfade":
            n = j["frames"]
            t = ((torch.arange(n, dtype=torch.float32) + 1) / (n + 1)).view(n, 1, 1, 1)
            a = out[at:at + n].float()
            out[at:at + n] = (a * (1 - t) + c[:n].float() * t).to(out.dtype)
            out[at + n:at + c.shape[0]] = c[n:]
        elif j["kind"] == "black":
            out[at:at + c.shape[0]] = c
            if j["out"]:
                g = _ramp(j["out"], False, torch.float32).view(-1, 1, 1, 1)
                out[at - j["out"]:at] = (out[at - j["out"]:at].float() * g).to(out.dtype)
            if j["in"]:
                g = _ramp(j["in"], True, torch.float32).view(-1, 1, 1, 1)
                out[at:at + j["in"]] = (out[at:at + j["in"]].float() * g).to(out.dtype)
        else:
            out[at:at + c.shape[0]] = c
    return out


def loop_frames(base, pl):
    loop, times, n = pl["loop"], pl["times"], base.shape[0]
    if loop == "off":
        return base
    if loop == "pingpong":
        idx = list(range(n)) + list(range(n - 2, 0, -1))
        cycle = base[idx]
    elif loop == "seamless":
        b = pl["blend"]
        if b <= 0:
            cycle = base
        else:
            cycle = torch.empty((n - b,) + tuple(base.shape[1:]), dtype=base.dtype)
            cycle[0:n - 2 * b] = base[b:n - b]
            t = ((torch.arange(b, dtype=torch.float32) + 1) / (b + 1)).view(b, 1, 1, 1)
            cycle[n - 2 * b:] = (base[n - b:].float() * (1 - t) + base[:b].float() * t).to(base.dtype)
    else:
        cycle = base
    return cycle.repeat(times, 1, 1, 1) if times > 1 else cycle


def fade_frames(frames, pl):
    if pl["fadeIn"]:
        g = _ramp(pl["fadeIn"], True, torch.float32).view(-1, 1, 1, 1)
        frames[:pl["fadeIn"]] = (frames[:pl["fadeIn"]].float() * g).to(frames.dtype)
    if pl["fadeOut"]:
        g = _ramp(pl["fadeOut"], False, torch.float32).view(-1, 1, 1, 1)
        frames[-pl["fadeOut"]:] = (frames[-pl["fadeOut"]:].float() * g).to(frames.dtype)
    return frames


def _runs_middle(mask):
    """The middle of the longest run of True (the first on a tie), or None."""
    best, i, m = None, 0, mask.tolist()
    while i < len(m):
        if not m[i]:
            i += 1
            continue
        j = i
        while j < len(m) and m[j]:
            j += 1
        if best is None or j - i > best[1]:
            best = (i, j - i)
        i = j
    return None if best is None else best[0] + best[1] // 2


def still_index(pl):
    """The frame the node shows while the preview is not playing: the middle of
    the longest stretch where clip 1 shows ALONE at full light (no fade, dip,
    crossfade or loop blend), else of the longest such stretch of any clip, else
    the brightest frame. Exact by construction: the SAME assemble / loop / fade
    steps run on a probe of 1 x 2 px frames carrying "clip 1", "light", the
    frame's place and its square (a blend of two frames breaks the square).
    Until 2026-10-25 the pick was read off the plan, and in 95 of 1500 random
    settings it still landed in a fade-in, a loop blend or a dip (still_check.py)."""
    probe = []
    for k, c in enumerate(pl["clips"]):
        pos = (torch.arange(c["kept"], dtype=torch.float64) + 1) / (c["kept"] + 1)
        x = torch.zeros((c["kept"], 1, 2, 3), dtype=torch.float64)
        x[:, 0, 0, 0] = 1.0 if k == 0 else 0.0
        x[:, 0, 0, 1] = 1.0
        x[:, 0, 1, 0] = pos
        x[:, 0, 1, 1] = pos * pos
        probe.append(x)
    v = fade_frames(loop_frames(assemble(probe, pl), pl), pl)
    first, light = v[:, 0, 0, 0], v[:, 0, 0, 1]
    p, p2 = v[:, 0, 1, 0], v[:, 0, 1, 1]
    whole = (light > 1 - 1e-9) & ((p * p - p2).abs() < 1e-9)
    # The first pass of the clips first: a repeat or ping-pong loop runs clip 1's
    # clean frames on across the cycles, and the middle of that long run was a
    # cycle start, the clip's first frame (review round 2, reproduced).
    first_pass = min(pl["base"], pl["cycle"])
    for mask in (whole & (first > 1 - 1e-9), whole & ((first > 1 - 1e-9) | (first < 1e-9))):
        for part in (mask[:first_pass], mask):
            i = _runs_middle(part)
            if i is not None:
                return i
    return int(torch.argmax(light))


# ── sound ───────────────────────────────────────────────────────────────────
def _b(f, sr, fps):
    """The first sample of frame f."""
    return int(round(f * sr / fps))


def _wave(audio):
    """A ComfyUI AUDIO dict as ([C, S] float tensor, rate), or (None, 0)."""
    if not isinstance(audio, dict):
        return None, 0
    wf = audio.get("waveform")
    sr = audio.get("sample_rate")
    if not isinstance(wf, torch.Tensor) or wf.numel() == 0:
        return None, 0
    try:
        sr = int(sr)
    except (TypeError, ValueError):
        return None, 0
    if sr <= 0:
        return None, 0
    if wf.dim() == 3:
        wf = wf[0]
    elif wf.dim() == 1:
        wf = wf.unsqueeze(0)
    # Sound can arrive on the graphics card (--gpu-only, some packs): all the
    # work here is in normal memory, and torch refuses to mix the two.
    return wf.float().cpu(), sr


def _resample(wf, sr_from, sr_to):
    if sr_from == sr_to:
        return wf
    try:
        import torchaudio.functional as AF
        return AF.resample(wf, sr_from, sr_to)
    except Exception:
        n = max(1, int(round(wf.shape[-1] * sr_to / sr_from)))
        return F.interpolate(wf.unsqueeze(0), size=n, mode="linear", align_corners=False)[0]


def _fit_len(wf, n):
    if wf.shape[-1] == n:
        return wf
    if wf.shape[-1] > n:
        return wf[..., :n]
    return torch.cat([wf, torch.zeros((wf.shape[0], n - wf.shape[-1]), dtype=wf.dtype)], dim=-1)


def _xfade(a, b):
    """Crossfade sound a (fading out) into b (fading in), same shape [ch, m].
    Equal power (cos / sin) keeps two UNRELATED sounds at their loudness, but
    adds the SAME sound (two clips of one video, met at the same moment) up to
    sqrt(2) times louder. So the gains are divided by sqrt(1 + corr * sin 2t):
    corr 0 = equal power as before, corr 1 = the two gains sum to 1 and the
    voice runs on at its level. corr below 0 counts as 0."""
    m = a.shape[-1]
    th = (torch.arange(m, dtype=torch.float32) + 0.5) / max(1, m) * (math.pi / 2)
    na, nb = float(a.norm()), float(b.norm())
    corr = float((a * b).sum()) / (na * nb) if na > 1e-9 and nb > 1e-9 else 0.0
    corr = min(1.0, max(0.0, corr))
    k = torch.rsqrt(1.0 + corr * torch.sin(2 * th))
    return a * (torch.cos(th) * k) + b * (torch.sin(th) * k)


def build_sound(audios, pl, fps):
    """The finished sound, sample-matched to the finished frames, or None when
    no wired clip has sound. audios: one AUDIO (or None) per plan clip."""
    waves = [_wave(a) for a in audios]
    have = [(w, sr) for w, sr in waves if w is not None]
    if not have:
        return None
    sr = have[0][1]
    ch = max(w.shape[0] for w, _ in have)
    clips = []
    for (wf, r), c in zip(waves, pl["clips"]):
        # This clip's sound for exactly its kept frames, silence when it has none.
        if wf is None:
            part = torch.zeros((ch, _b(c["kept"], sr, fps)))
        else:
            wf = _resample(wf, r, sr)
            if wf.shape[0] < ch:
                wf = wf.expand(ch, -1) if wf.shape[0] == 1 else torch.cat(
                    [wf, torch.zeros((ch - wf.shape[0], wf.shape[-1]))], dim=0)
            part = _fit_len(wf[..., _b(c["start"], sr, fps):_b(c["end"], sr, fps)], _b(c["kept"], sr, fps))
            if c["reverse"]:
                part = torch.flip(part, dims=[-1])
        clips.append(part)

    out = clips[0]
    for k in range(1, len(clips)):
        j = pl["joins"][k - 1]
        nxt = clips[k]
        if j["kind"] == "crossfade":
            m = min(_b(j["frames"], sr, fps), out.shape[-1], nxt.shape[-1])
            mixed = _xfade(out[..., out.shape[-1] - m:], nxt[..., :m])
            out = torch.cat([out[..., :out.shape[-1] - m], mixed, nxt[..., m:]], dim=-1)
        elif j["kind"] == "black":
            mo = min(_b(j["out"], sr, fps), out.shape[-1])
            mi = min(_b(j["in"], sr, fps), nxt.shape[-1])
            out = out.clone()
            nxt = nxt.clone()
            if mo:
                out[..., out.shape[-1] - mo:] *= torch.linspace(1, 0, mo)
            if mi:
                nxt[..., :mi] *= torch.linspace(0, 1, mi)
            out = torch.cat([out, nxt], dim=-1)
        else:
            out = torch.cat([out, nxt], dim=-1)
    out = _fit_len(out, _b(pl["base"], sr, fps))

    loop, times, base = pl["loop"], pl["times"], pl["base"]
    if loop == "pingpong" and base > 2:
        cycle = torch.cat([out, torch.flip(out[..., _b(1, sr, fps):_b(base - 1, sr, fps)], dims=[-1])], dim=-1)
    elif loop == "seamless" and pl["blend"] > 0:
        m = _b(pl["blend"], sr, fps)
        s = out.shape[-1]
        mixed = _xfade(out[..., s - m:], out[..., :m])
        cycle = torch.cat([out[..., m:s - m], mixed], dim=-1)
    else:
        cycle = out
    if loop != "off":
        cycle = _fit_len(cycle, _b(pl["cycle"], sr, fps))
    out = cycle.repeat(1, times) if times > 1 else cycle
    out = _fit_len(out, _b(pl["total"], sr, fps))

    if pl["fadeIn"]:
        m = min(_b(pl["fadeIn"], sr, fps), out.shape[-1])
        out = out.clone()
        out[..., :m] *= torch.linspace(0, 1, m)
    if pl["fadeOut"]:
        m = min(_b(pl["fadeOut"], sr, fps), out.shape[-1])
        out = out.clone()
        out[..., out.shape[-1] - m:] *= torch.linspace(1, 0, m)
    return {"waveform": out.unsqueeze(0).contiguous(), "sample_rate": sr}


# ── the whole thing ─────────────────────────────────────────────────────────
def _channels(wf, ch):
    if wf.shape[0] == ch:
        return wf
    if wf.shape[0] == 1:
        return wf.expand(ch, -1)
    return torch.cat([wf, torch.zeros((ch - wf.shape[0], wf.shape[-1]))], dim=0)


def add_music(music, sound, pl, fps, mode):
    """One song under the whole finished video: from the song's start, cut (or
    padded with silence) to exactly the video's length, with the video's fade in
    and out. mode "music": the song alone; "mix": the song plus the clips' own
    sound (already shaped by build_sound), limited to -1..1. Loops do not repeat
    the song: it plays straight through. Returns `sound` when no song."""
    wf, sr = _wave(music)
    if wf is None:
        return sound
    n = _b(pl["total"], sr, fps)
    out = _fit_len(wf, n).clone()
    if pl["fadeIn"]:
        m = min(_b(pl["fadeIn"], sr, fps), n)
        out[..., :m] *= torch.linspace(0, 1, m)
    if pl["fadeOut"]:
        m = min(_b(pl["fadeOut"], sr, fps), n)
        out[..., n - m:] *= torch.linspace(1, 0, m)
    if mode == "mix" and sound is not None:
        cw, csr = _wave(sound)
        if cw is not None:
            cw = _fit_len(_resample(cw, csr, sr), n)
            ch = max(out.shape[0], cw.shape[0])
            out = (_channels(out, ch) + _channels(cw, ch)).clamp(-1.0, 1.0)
    return {"waveform": out.unsqueeze(0).contiguous(), "sample_rate": sr}


def process(videos, audios, fps, st, music=None):
    """videos / audios: one per input slot (None when not wired); music: one
    AUDIO under the whole video, or None. Returns (frames, sound or None, plan)."""
    lengths = [None if v is None else int(as_rgb(v).shape[0]) for v in videos]
    pl = plan(lengths, st)
    if not pl["clips"]:
        raise ValueError("Video Tools: wire a video into v1 (video_1) or another clip input.")
    target = None
    done = []
    for c in pl["clips"]:
        # .cpu(): frames can arrive on the graphics card (--gpu-only) and every
        # curve and buffer here is in normal memory (a no-op for CPU frames).
        x = as_rgb(videos[c["slot"]])[c["start"]:c["end"]].cpu()
        if c["reverse"]:
            x = torch.flip(x, dims=[0])
        if target is None:
            target = (x.shape[1], x.shape[2])
        x = fit_size(x, target[0], target[1], st["size"])
        if st["match"] and done:
            x = match_colors(x, done[-1][-min(8, done[-1].shape[0]):], st["matchStrength"] / 100.0)
        done.append(x)
    # assemble() always writes into a NEW tensor, so the fades below can never
    # touch the frames another node handed us.
    base = assemble(done, pl)
    del done, x     # x still held the last clip's copy
    frames = fade_frames(loop_frames(base, pl), pl)
    sound = build_sound([audios[c["slot"]] for c in pl["clips"]], pl, fps)
    sound = add_music(music, sound, pl, fps, st["musicMix"])
    return frames, sound, pl
