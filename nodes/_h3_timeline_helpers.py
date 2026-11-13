"""Pure maths for H3 Timeline Pixaroma: scene lengths -> the clip length, and the windows that follow the scenes.

No torch, no ComfyUI (harness: D:\\Claude Tests\\_h3_timeline_test.py). The grid is H3 Long Video's
(_h3_long_video_helpers.py): windows start on 17-frame chunks and are 17n + 5 frames (5n + 2 tokens) long.

H3 Long Video uses one window length everywhere. Here every SCENE gets its own window(s), so a prompt change lands
exactly on the border between two scenes: a scene's window reaches up to EDGE_CHUNKS into each neighbour, so the
two windows share up to 2 * EDGE_CHUNKS chunks + 2 tokens around the border. A scene a little too long for one
window (H3 was trained on 4 to 15 s) first reaches less, down to MIN_REACH_CHUNKS; only a scene too long even then
is split into several windows that read the same prompt (scene_windows).
"""
from __future__ import annotations

from ._h3_long_video_helpers import CHUNK_FRAMES, FPS, _num, audio_at, frames_of, ramp_weights

SCENE_MIN_S = 4.0
SCENE_MAX_S = 120.0
SCENE_DEFAULT_S = 10.0
MAX_SCENES = 12
MIN_SCENE_CHUNKS = 5          # a first / last window is then >= 6 chunks (4.46 s), the shortest clip H3 makes
# How far a scene's window reaches into each neighbour. 1 chunk (a 1.6 s overlap) changed actions fine but LOST a
# person who had just walked in (node_person, 10-22): the next scene's window starts again from the start picture.
# 2 chunks = 4 chunks + 2 tokens of overlap = 73 frames, about 3 s.
EDGE_CHUNKS = 2
MAX_WINDOW_CHUNKS = 21        # 362 frames = 15.08 s
MIN_WINDOW_CHUNKS = 6         # 107 frames = 4.46 s, H3's shortest clip


def clean_lengths(lengths):
    """Scene lengths in seconds from the node's state, each clamped to [SCENE_MIN_S, SCENE_MAX_S], at most
    MAX_SCENES; anything unreadable becomes the default."""
    out = []
    for v in list(lengths or [])[:MAX_SCENES]:
        out.append(min(SCENE_MAX_S, max(SCENE_MIN_S, _num(v, SCENE_DEFAULT_S))))
    return out or [SCENE_DEFAULT_S]


def clip_frames(lengths) -> int:
    """The clip's frame count: the scenes added up, on H3's 17n + 5 grid (nearest)."""
    total = sum(clean_lengths(lengths))
    return CHUNK_FRAMES * max(6, int(round((total * FPS - 5) / CHUNK_FRAMES))) + 5


def scene_bounds(lengths, chunks):
    """Scene borders on the chunk grid: [0, b1, ..., chunks]. Each border is the nearest chunk to the scene's start
    in seconds, then pushed so every scene keeps at least MIN_SCENE_CHUNKS (from the end backwards too)."""
    ls = clean_lengths(lengths)
    chunks = int(chunks)
    k = len(ls)
    if k == 1 or chunks < MIN_SCENE_CHUNKS * k:
        return [0, chunks] if chunks > 0 else [0]
    b, t = [0], 0.0
    for v in ls[:-1]:
        t += v
        b.append(int(round(t * FPS / CHUNK_FRAMES)))
    b.append(chunks)
    for i in range(1, k):                       # forwards: room for the scene before
        b[i] = max(b[i], b[i - 1] + MIN_SCENE_CHUNKS)
    for i in range(k - 1, 0, -1):               # backwards: room for the scene after
        b[i] = min(b[i], b[i + 1] - MIN_SCENE_CHUNKS)
    return b


SPLIT_OVERLAP_CHUNKS = 10      # ~7 s: inside ONE scene, the overlap that kept a person who walked in (test C)
MIN_REACH_CHUNKS = 1           # a scene may reach this little into a neighbour to stay in ONE window (scene_windows)


def _split(a, b, max_chunks):
    """Chunk range [a, b) -> sub-windows of at most max_chunks. As few windows as with a 2 * EDGE overlap, but
    then overlapping by up to SPLIT_OVERLAP_CHUNKS: a short overlap let the next window start again from the start
    picture, so a man who had walked in faded out and walked in a second time (measured 10-22, t4_room, 2.8 s).
    Each later window still starts 2 * EDGE past [a] (never reaching the previous scene's window) and each earlier
    one ends 2 * EDGE before [b] (never reaching the next scene's)."""
    n = b - a
    if n <= max_chunks:
        return [(a, b)]
    edge2 = 2 * EDGE_CHUNKS
    k = -(-(n - edge2) // (max_chunks - edge2))

    def plan(over):
        w = -(-(n + over * (k - 1)) // k)
        return [(s, s + w) for s in [a + j * (w - over) for j in range(k - 1)] + [b - w]]

    def fits(p):        # strict: a window's 2 tail tokens reach into the next chunk, so touching chunks overlap
        return (all(t - s <= max_chunks for s, t in p)
                and p[1][0] > a + edge2                        # clear of the previous scene's window
                and p[-2][1] < b - edge2                       # clear of the next scene's window
                and all(p[j - 2][1] < p[j][0] for j in range(2, len(p))))   # only neighbours overlap

    over = max(edge2, min(SPLIT_OVERLAP_CHUNKS, (k * max_chunks - n) // (k - 1)))
    while over > edge2 and not fits(plan(over)):
        over -= 1
    return plan(over)


def _split_short(a, b, max_chunks, guard_lo, guard_hi):
    """_split for the shorter windows of the node's window setting: the fewest windows (then the widest, never
    under MIN_WINDOW_CHUNKS) EVENLY spaced over [a, b), overlapping each neighbour by 2+ chunks and never the one
    two back. The second window starts after [a + guard_lo] and the second-last ends before [b - guard_hi], clear of
    the neighbour scenes' windows (guard = the reach on that side, both ways). Pinning the last window to [b] like
    _split does bunched the windows up there and three overlapped."""
    n = b - a
    for k in range(2, n + 1):
        for w in range(max_chunks, MIN_WINDOW_CHUNKS - 1, -1):
            if k * w < n:                       # k windows of w cannot cover n even end to end
                break
            p = [(s, s + w) for s in [a + (j * (n - w)) // (k - 1) for j in range(k)]]
            if any(p[j][0] - p[j - 1][0] > w - 2 for j in range(1, k)):
                continue                        # a 2-chunk overlap at least
            if any(p[j][0] <= p[j - 2][1] for j in range(2, k)):
                continue                        # only neighbours overlap (a window's 2 tail tokens reach on)
            if p[1][0] <= a + guard_lo or p[-2][1] >= b - guard_hi:
                continue
            return p
    return None


WINDOW_MIN_S = 5.0


def window_chunks(seconds):
    """The longest window, from the node's window setting in seconds (0 / unreadable = automatic, the full
    MAX_WINDOW_CHUNKS = 15 s). Shorter windows use less memory at big sizes; a scene longer than one is made in
    several overlapping windows that read the same words (5 s = 7 chunks)."""
    s = _num(seconds, 0.0)
    if s <= 0:
        return MAX_WINDOW_CHUNKS
    return min(MAX_WINDOW_CHUNKS, max(7, int(round(max(WINDOW_MIN_S, s) * FPS / CHUNK_FRAMES))))


def scene_windows(latent_t, audio_t, lengths, max_chunks=MAX_WINDOW_CHUNKS, cuts=(), preroll=0):
    """-> [(l0, l1, a0, a1, scene)] token / audio-frame ranges and the scene each window reads, or None when the
    latent is not on H3's grid, has no audio, or one scene fills it in a single window (nothing to do).

    `cuts` = the scenes that START with a clean cut: no window reaches across that border, so the scene's first
    window begins exactly on it like a fresh clip. The two windows still share the earlier one's 2 tail tokens (a
    window is 5n + 2 tokens); cut_weights splits what two windows share at the border itself (cut_borders). A scene
    with cuts on both sides can be only 5 chunks, below H3's shortest clip: its window renders 1 chunk of the
    next scene (the last scene: of the one before), which cut_weights then drops.

    `preroll` (chunks) starts a cut scene's first window that much BEFORE its border; cut_weights drops that part,
    so the scene is already moving at the cut (a fresh shot starts almost frozen and settles in its first ~0.5 s)."""
    latent_t, audio_t = int(latent_t), int(audio_t)
    cuts = set(cuts or ())
    chunks = (latent_t - 2) // 5
    if latent_t != 5 * chunks + 2 or audio_t <= 0 or chunks < 1:
        return None
    b = scene_bounds(lengths, chunks)
    if len(b) < 2:
        return None
    k = len(b) - 1
    # shorter windows (the node's window setting) reach 1 chunk into a neighbour: 2 would leave a 5 s window
    # little of its own scene
    capped = max_chunks < MAX_WINDOW_CHUNKS
    edge = MIN_REACH_CHUNKS if capped else EDGE_CHUNKS
    out, prev_ahead = [], 0
    preroll = max(0, min(2, int(preroll or 0)))
    for i in range(k):
        back = (edge if i not in cuts else preroll) if i > 0 else 0
        ahead = edge if i < k - 1 and i + 1 not in cuts else 0
        # A scene a little too long for one window keeps ONE window by reaching less into its neighbours (the
        # previous one first), never below 1 chunk (each border must stay inside an overlap). MEASURED 10-22
        # (t4_room, 10 s + 14 s, Add person): split in two, the windows put the man in different places and he
        # slid across their overlap. Too long even then: split as before, with the full reach.
        nb, na = back, ahead
        while b[i + 1] + na - (b[i] - nb) > max_chunks and (nb > MIN_REACH_CHUNKS or na > MIN_REACH_CHUNKS):
            if nb > MIN_REACH_CHUNKS:
                nb -= 1
            else:
                na -= 1
        if b[i + 1] + na - (b[i] - nb) <= max_chunks:
            back, ahead = nb, na
        short = MIN_WINDOW_CHUNKS - (b[i + 1] + ahead - (b[i] - back))
        if short > 0:           # only next to clean cuts (no reach there)
            if i < k - 1:
                ahead += short
            elif i > 0:
                back += short
        a, z = b[i] - back, b[i + 1] + ahead
        if not capped:
            parts = _split(a, z, max_chunks)
        elif z - a <= max_chunks + 1:     # one chunk over (a short scene + its reach): no split leaves room
            parts = [(a, z)]
        else:
            # how far the next scene's first window reaches back into this one (after a cut: its pre-roll, or
            # 1 for a short last scene)
            nxt = edge if i < k - 1 and i + 1 not in cuts else (max(preroll, 1 if i == k - 2 else 0) if i < k - 1 else 0)
            parts = (_split_short(a, z, max_chunks, back + prev_ahead, ahead + nxt)
                     or _split_short(a, z, max_chunks, 0, 0) or [(a, z)])
        for s, t in parts:
            out.append((s, t, i))
        prev_ahead = ahead
    if len(out) == 1:
        return None
    wins = []
    for s, t, i in out:
        l0, l1 = 5 * s, min(5 * t + 2, latent_t)
        a0 = min(audio_at(frames_of(l0)), audio_t - 1)
        a1 = audio_t if l1 == latent_t else min(audio_t, audio_at(frames_of(l1)))
        wins.append((l0, l1, a0, max(a0 + 1, a1), i))
    return wins


def cut_borders(latent_t, lengths, wins, cuts):
    """For cut_weights: per window, the clean-cut border where it starts its scene, as (token, audio frame), else
    None (a window that blends, or a later window of the same scene)."""
    b = scene_bounds(lengths, (int(latent_t) - 2) // 5)
    cuts = set(cuts or ())
    hv, ha = [], []
    for j, w in enumerate(wins):
        if j and w[4] != wins[j - 1][4] and w[4] in cuts:
            t = 5 * b[w[4]]
            hv.append(t)
            ha.append(audio_at(frames_of(t)))
        else:
            hv.append(None)
            ha.append(None)
    return hv, ha


def cut_weights(spans, borders):
    """ramp_weights, except where borders[i] is a position: there window i - 1 and window i meet at a clean cut, so
    of what they share, the part before the border belongs to window i - 1 alone and the rest to window i (no
    blend). Nothing there = exactly ramp_weights."""
    if all(x is None for x in borders):
        return ramp_weights(spans)
    ws = []
    for i, (s, e) in enumerate(spans):
        w = [1.0] * (e - s)
        if i > 0 and spans[i - 1][1] > s:
            if borders[i] is None:
                width = spans[i - 1][1] - s
                w = [min(v, (j + 0.5) / width) for j, v in enumerate(w)]
            else:
                w = [0.0 if s + j < borders[i] else v for j, v in enumerate(w)]
        if i + 1 < len(spans) and spans[i + 1][0] < e:
            if borders[i + 1] is None:
                width = e - spans[i + 1][0]
                w = [min(v, (e - (s + j) - 0.5) / width) for j, v in enumerate(w)]
            else:
                w = [0.0 if s + j >= borders[i + 1] else v for j, v in enumerate(w)]
        ws.append([v if v == 0.0 else max(v, 1e-4) for v in w])
    total = [0.0] * max(e for _, e in spans)
    for (s, _), w in zip(spans, ws):
        for j, v in enumerate(w):
            total[s + j] += v
    return [[v / total[s + j] if total[s + j] > 0 else 0.0 for j, v in enumerate(w)] for (s, _), w in zip(spans, ws)]


def split_scenes(lengths, cuts=(), max_chunks=MAX_WINDOW_CHUNKS, preroll=0) -> set:
    """The scenes made in MORE than one window, on the latent the node makes for these lengths (clip_frames:
    17n + 5 frames = 5n + 2 tokens), by the same scene_windows the wrapper calls at sample time. Only their later
    windows read the node's `later_conds`, so the node builds that extra prompt only for them: each build is one more
    text + picture + audio encode (review 10-22: it was built for every scene a person joins in)."""
    count = {}
    for w in scene_windows(5 * ((clip_frames(lengths) - 5) // CHUNK_FRAMES) + 2, 1, lengths, max_chunks, cuts,
                           preroll) or []:
        count[w[4]] = count.get(w[4], 0) + 1
    return {s for s, n in count.items() if n > 1}


MAX_WORDS = 2000
MAX_NAME = 512
FITS = ("cut", "fit")


def _unit(v, fallback=0.5):
    return min(1.0, max(0.0, _num(v, fallback)))


def parse_state(raw):
    """The node's TimelineState JSON (any shape) -> {"scenes": [...]} with every field clean:
    length (s), words, picture (an input-folder filename or None), role ("look" / "person"), x, y (where the cut
    sits, 0..1), fit ("cut" / "fit") and cut (True = the scene starts with a clean cut, never on scene 1). Always
    at least one scene."""
    import json
    try:
        data = json.loads(raw) if isinstance(raw, str) and raw.strip() else (raw if isinstance(raw, dict) else {})
    except (ValueError, TypeError):
        data = {}
    scenes = data.get("scenes") if isinstance(data, dict) else None
    out = []
    for sc in (scenes if isinstance(scenes, list) else [])[:MAX_SCENES]:
        if not isinstance(sc, dict):
            continue
        pic = sc.get("picture")
        pic = pic.strip()[:MAX_NAME] if isinstance(pic, str) and pic.strip() else None
        out.append({
            "length": clean_lengths([sc.get("length")])[0],
            "words": str(sc.get("words") or "")[:MAX_WORDS],
            "picture": pic,
            "role": "person" if sc.get("role") == "person" else "look",
            "x": _unit(sc.get("x")),
            "y": _unit(sc.get("y")),
            "fit": sc.get("fit") if sc.get("fit") in FITS else "cut",
            "cut": bool(out) and sc.get("cut") is True,
            "keep": sc.get("keep") is True,
        })
    if not out:
        out = [{"length": SCENE_DEFAULT_S, "words": "", "picture": None, "role": "look", "x": 0.5, "y": 0.5, "fit": "cut",
                "cut": False, "keep": False}]
    d = data if isinstance(data, dict) else {}
    return {"scenes": out, "window": max(0.0, min(15.0, _num(d.get("window"), 0.0))),
            "preroll": max(0, min(2, int(_num(d.get("preroll"), 0))))}


def keep_ranges(lengths, latent_t, audio_t, keeps):
    """Keep (redo the other scenes only): per kept scene, its (token, token) video range and (frame, frame) audio
    range on the latent, from the same borders as the windows (the last scene runs to the latent's end)."""
    latent_t, audio_t = int(latent_t), int(audio_t)
    b = scene_bounds(lengths, (latent_t - 2) // 5)
    out = []
    for i in sorted(set(keeps or ())):
        if 0 <= i < len(b) - 1:
            t0 = 5 * b[i]
            t1 = latent_t if i == len(b) - 2 else 5 * b[i + 1]
            a0 = min(audio_at(frames_of(t0)), audio_t)
            a1 = audio_t if i == len(b) - 2 else min(audio_at(frames_of(t1)), audio_t)
            out.append((t0, t1, a0, a1))
    return out


def cut_box(src_w, src_h, w, h, x=0.5, y=0.5):
    """Cut to fill: scale a src_w x src_h picture to COVER w x h, then the w x h window at (x, y) (0 = left / top,
    1 = right / bottom of the room there is). -> (scaled_w, scaled_h, left, top)."""
    s = max(w / float(src_w), h / float(src_h))
    sw, sh = max(w, int(round(src_w * s))), max(h, int(round(src_h * s)))
    return sw, sh, int(round((sw - w) * _unit(x))), int(round((sh - h) * _unit(y)))


def fit_box(src_w, src_h, w, h):
    """Fit inside: scale to fit w x h whole; -> (scaled_w, scaled_h, left, top) of the picture on a w x h canvas."""
    s = min(w / float(src_w), h / float(src_h))
    sw, sh = max(1, min(w, int(round(src_w * s)))), max(1, min(h, int(round(src_h * s))))
    return sw, sh, (w - sw) // 2, (h - sh) // 2


def describe_scenes(lengths, frames):
    """Human numbers: [(start s, end s)] per scene as the borders really land, for the node's readout."""
    chunks = (int(frames) - 5) // CHUNK_FRAMES
    b = scene_bounds(lengths, chunks)
    end = int(frames) / FPS
    return [(round(b[i] * CHUNK_FRAMES / FPS, 2), round(end if i == len(b) - 2 else b[i + 1] * CHUNK_FRAMES / FPS, 2))
            for i in range(len(b) - 1)]
