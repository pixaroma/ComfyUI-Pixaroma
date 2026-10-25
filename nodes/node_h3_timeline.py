"""H3 Timeline Pixaroma - one long MiniMax H3 clip told as SCENES: each scene its own length, its own words and,
when it needs one, its own picture (a new look of the same shot, or a person who joins).

WHAT IT REPLACES. MiniMax H3 Reference to Video + H3 Long Video in one node: it writes each scene's prompt into
the tested EP41 Sing / Talk prompt (or the no-audio Act prompt, _h3_timeline_prompts.py), builds each scene's
conditioning with core's own Reference to Video code, and sets the model up to sample the whole clip in windows
that FOLLOW THE SCENES (_h3_timeline_helpers.scene_windows): every window reads its own scene's words and pictures,
and a scene change lands in the 1.6 s overlap between two windows, where the blend crosses over.

MEASURED 2026-10-22 (research_long_video_2.md "TIMELINE TEST", with a prototype of this wrapper): with a picture,
three scenes (hands clasped / dance / wave) change smoothly, no flash, no ghost; a person's picture from a scene on
brings them in from the edge; a new look picture dissolves in over ~0.4 s; each new scene drifts back toward the
picture's pose for a moment at its start. Without any picture the windows do not agree (double exposures), so
scene 1 must have one.

The scenes live in the browser (js/h3_timeline/) and reach this node through the hidden TimelineState input
(Vue Compat #9). Pictures are names in ComfyUI's input folder, resolved through _path_guard and refused outside it.
"""
from __future__ import annotations

from ._folder_source import refresh_copy, source_stamp
from ._h3_long_video_helpers import FPS
from ._h3_timeline_helpers import (MAX_WINDOW_CHUNKS, clip_frames, cut_borders, cut_box, cut_weights,
                                   describe_scenes, fit_box, keep_ranges, parse_state, scene_windows, split_scenes,
                                   window_chunks)
from ._h3_timeline_prompts import MODES, ROLE_PERSON, build_prompt
from ._path_guard import is_path_under, rel_is_rooted
from ._resize_helpers import normalize_bit_depth
from .node_h3_long_video import WRAPPER_KEY, _diffusion_model_kind, _Windows


class _SceneWindows(_Windows):
    """The H3 Long Video wrapper with windows that follow the scenes, each window reading its scene's text,
    token tags and references. Scene 1 is the sampler's own conditioning, so its windows run unchanged."""

    def __init__(self, lengths, scene_conds, later_conds=None, cuts=(), max_chunks=MAX_WINDOW_CHUNKS, preroll=0):
        super().__init__(0, 0)
        self.lengths = list(lengths)
        self.cuts = frozenset(cuts or ())       # the scenes that start with a clean cut (scene_windows)
        self.max_chunks = max_chunks            # the longest window (window_chunks)
        self.preroll = preroll                  # chunks a cut scene starts before its border (scene_windows)
        self._priv = {}                         # per window: (noise level, x0, eps) of its own frames across a cut
        self._gones = None                      # (weights, per window: its zero-weight positions), _gone_of
        self.scene_conds = scene_conds          # [(cross_attn, extras) or None] per scene
        # {scene: (cross_attn, extras)}: the conditioning for the LATER windows of a scene that was split (too long
        # for one window even at the smallest reach, scene_windows), when someone walked in during its first window:
        # worded as already there (people_sentence `arrived`)
        self.later_conds = dict(later_conds or {})
        self._ctx = {}

    def _blend_cut(self, spans, borders, device):
        """_Windows._blend with clean cuts: what two windows share at a cut is split at the border, no blend."""
        import torch
        hv, ha = borders
        key = (tuple(spans), tuple(hv), str(device))
        if key not in self._weights:
            wv = cut_weights([(l0, l1) for l0, l1, _, _ in spans], hv)
            wa = cut_weights([(a0, a1) for _, _, a0, a1 in spans], ha)
            self._weights = {key: (
                [torch.tensor(w, dtype=torch.float32, device=device).view(1, 1, -1, 1, 1) for w in wv],
                [torch.tensor(w, dtype=torch.float32, device=device).view(1, 1, 1, -1) for w in wa])}
        return self._weights[key]

    def _gone_of(self, wv):
        """Per window: the positions it renders only to throw away (blend weight 0: across a clean cut), as an
        index on the weights' device, or None. Worked out once per weight set, so the window loop never waits for
        the GPU to say whether a window has any."""
        if self._gones is None or self._gones[0] is not wv:     # holding wv keeps its id from being reused
            out = []
            for w in wv:
                idx = (w.view(-1) <= 0).nonzero().view(-1)
                out.append(idx if idx.numel() else None)
            self._gones = (wv, out)
        return self._gones[1]

    def _context(self, dm, sc, cond, like):
        key = (sc, str(like.device), str(like.dtype))      # sc = a scene index, or ("later", scene)
        if key not in self._ctx:
            self._ctx[key] = dm.preprocess_text_embeds(cond.to(device=like.device, dtype=like.dtype))
        return self._ctx[key]

    def __call__(self, executor, x, timestep, context, transformer_options=None, **kwargs):
        if transformer_options is None:
            transformer_options = {}
        if not isinstance(x, (list, tuple)) or len(x) != 2 or getattr(x[0], "ndim", 0) != 5:
            return executor(x, timestep, context, transformer_options, **kwargs)
        video, audio = x[0], x[1]
        wins = scene_windows(video.shape[2], audio.shape[-1], self.lengths, self.max_chunks, self.cuts, self.preroll)
        if wins is None:
            return executor(x, timestep, context, transformer_options, **kwargs)
        import torch
        if self._told != video.shape[2]:
            self._told = video.shape[2]
            print("[Pixaroma] H3 Timeline: {} scenes, {} windows{}".format(
                len(self.lengths), len(wins), ", {} clean cuts".format(len(self.cuts)) if self.cuts else ""))
        spans = [w[:4] for w in wins]
        if self.cuts:
            wv, wa = self._blend_cut(spans, cut_borders(video.shape[2], self.lengths, wins, self.cuts), video.device)
        else:
            wv, wa = self._blend(spans, video.device)
        payload = kwargs.get("minimax_payload") or {}
        own_text = list(transformer_options.get("cond_or_uncond") or [0]) == [0]
        dm = getattr(executor, "class_obj", None)
        dm = getattr(dm, "diffusion_model", dm)
        mask_v, mask_a = kwargs.get("denoise_mask"), kwargs.get("audio_denoise_mask")
        # Keep: a window whose every blended position is held (denoise mask 0: a kept scene, Audio Sync's track) is
        # not run at all; the sampler puts the held latent there anyway, so a redo costs only its own windows
        held_v, held_a = _held(mask_v, 2), _held(mask_a, -1)
        sg = transformer_options.get("sigmas")
        sig = float(sg.max()) if torch.is_tensor(sg) and sg.numel() else None     # this step's noise level
        gones = self._gone_of(wv)
        out_v = torch.zeros(video.shape, dtype=torch.float32, device=video.device)
        out_a = torch.zeros(audio.shape, dtype=torch.float32, device=audio.device)
        seen = set()
        for k, ((l0, l1, a0, a1, sc), w_v, w_a) in enumerate(zip(wins, wv, wa)):
            if (held_v is not None and held_a is not None
                    and bool(held_v[l0:l1][w_v.view(-1) > 0].all()) and bool(held_a[a0:a1][w_a.view(-1) > 0].all())):
                seen.add(sc)
                continue
            ctx, src = context, payload
            ck, entry = sc, None
            if own_text:
                if sc in seen and sc in self.later_conds:       # windows come in time order: not the scene's first
                    ck, entry = ("later", sc), self.later_conds[sc]
                elif sc < len(self.scene_conds):
                    entry = self.scene_conds[sc]
            seen.add(sc)
            if entry is not None and dm is not None and hasattr(dm, "preprocess_text_embeds"):
                cond, extras = entry
                ctx = self._context(dm, ck, cond, context)
                src = dict(payload)
                if extras.get("minimax_refs") is not None:
                    src["refs"] = extras["minimax_refs"]
                if extras.get("minimax_token_tags") is not None:
                    src["text_token_tags"] = extras["minimax_token_tags"]
                else:
                    src.pop("text_token_tags", None)
            kw = dict(kwargs)
            kw["minimax_payload"] = self._window_payload(src, l0, l1, a0, a1, audio.shape[-1])
            # Across a clean cut this window renders some of the OTHER scene's frames only to throw them away (its 2
            # tail tokens, a pre-roll). Whatever is there leaks into this scene. MEASURED 10-23: with that scene KEPT
            # (held, mask 0, read by H3 as a finished picture to end on) the redone desk turned into the kept sofa
            # within 0.5 s; held but unmasked, its closer framing still made the desk zoom in; this window's own
            # nearest frame repeated there gave black streaks in the last frames before the cut (seed 111). So
            # there this window keeps its OWN continuation of its shot, stepped from its own predictions as if the
            # scene were made alone (as 4 separate renders were, clean), marked as ordinary frames (1).
            # MEASURED 10-23: a CLONE of each such window + GPU reads in this loop made Full HD (1088 x 1920, Window
            # 5 s) run out of memory on 24 GB, where the loop without them fit. So the model gets a slice of the
            # shared latent as before, those few positions are written IN PLACE and put back right after, and which
            # positions they are is worked out once (_gone_of), so the cut handling adds no waits for the GPU.
            xv = video[:, :, l0:l1]
            gone = gones[k]
            pk = (l0, l1, tuple(transformer_options.get("cond_or_uncond") or [0]))
            saved = None
            if gone is not None and sig is not None:
                saved = xv[:, :, gone].clone()
                prev = self._priv.get(pk)
                if prev is not None and prev[0] > sig:          # a later step of the same sampling
                    xv[:, :, gone] = ((1.0 - sig) * prev[1] + sig * prev[2]).to(xv.dtype)
                else:
                    # the first step: noise of its own, the same with or without Keep. A KEPT neighbour is CLEAN
                    # here even at the first step (core injects held frames at full strength:
                    # model_base.MiniMaxH3.scale_latent_inpaint), so the window's start would differ with Keep
                    seed = int((kw.get("minimax_payload") or {}).get("seed", 0) or 0)
                    g = torch.Generator().manual_seed((seed * 1000003 + l0) % (2 ** 62))
                    n = torch.randn(tuple(saved.shape), generator=g, dtype=torch.float32).to(xv.device)
                    xv[:, :, gone] = (sig * n + (1.0 - sig) * saved.float()).to(xv.dtype)
            if mask_v is not None:
                mv = mask_v[:, :, l0:l1]
                if gone is not None:
                    mv = mv.clone()
                    mv[:, :, gone.to(mv.device)] = 1.0
                kw["denoise_mask"] = mv
            if mask_a is not None:
                kw["audio_denoise_mask"] = mask_a[..., a0:a1]
            o = executor([xv, audio[..., a0:a1]], timestep, ctx, transformer_options.copy(), **kw)
            if saved is not None:
                # flow model: x = (1 - s) x0 + s eps and the output v = eps - x0, so x0 = x - s v, eps = x + (1 - s) v
                xin, vv = xv[:, :, gone].float(), o[0][:, :, gone].float()
                self._priv[pk] = (sig, xin - sig * vv, xin + (1.0 - sig) * vv)
                xv[:, :, gone] = saved                          # the shared latent back as the sampler gave it
            out_v[:, :, l0:l1] += o[0].float() * w_v
            out_a[..., a0:a1] += o[1].float() * w_a.to(audio.device)
            del o
        return [out_v.to(video.dtype), out_a.to(audio.dtype)]


def _held(mask, dim):
    """A denoise mask -> per position along `dim` (time), True where nothing is denoised (all 0), else None."""
    if mask is None or getattr(mask, "is_nested", False) or getattr(mask, "ndim", 0) < 2:
        return None
    try:
        m = mask.movedim(dim, 0)
        return (m.reshape(m.shape[0], -1).amax(dim=1) <= 0).to(mask.device)
    except Exception:
        return None


# Keep: the last finished latent of each Timeline node (by its node id), so a later Run can hold the kept scenes.
# Only the newest few nodes are remembered: an entry is ~190 MB of RAM at 1088 x 1920 x 41 s.
_LAST = {}
_LAST_MAX = 4
# per node id: how many times the sampler stored a Run (_KeepLast), and whether the node's last run() held a kept
# scene; IS_CHANGED reads both (see there)
_KEEP_RUNS = {}
_KEEP_HELD = {}
KEEP_KEY = "pixaroma_h3_timeline_keep"


class _KeepLast:
    """An OUTER_SAMPLE wrapper: remembers what the sampler made (video and sound latents, on the CPU) for the
    Timeline node with this id. Never changes the result; any problem only skips the remembering."""

    def __init__(self, key, sig):
        self.key = key
        self.sig = sig          # what each scene was in this Run (_scene_sig): Keep holds only what still matches

    def __call__(self, executor, noise, latent_image, sampler, sigmas, denoise_mask=None, callback=None,
                 disable_pbar=False, seed=None, latent_shapes=None):
        out = executor(noise, latent_image, sampler, sigmas, denoise_mask, callback, disable_pbar, seed,
                       latent_shapes=latent_shapes)
        try:
            import comfy.utils
            parts = comfy.utils.unpack_latents(out, latent_shapes) if latent_shapes and len(latent_shapes) > 1 else [out]
            if len(parts) >= 2 and getattr(parts[0], "ndim", 0) == 5:
                _LAST.pop(self.key, None)                       # re-inserted = the newest
                _LAST[self.key] = (parts[0].detach().float().cpu(), parts[1].detach().float().cpu(), self.sig)
                while len(_LAST) > _LAST_MAX:
                    _LAST.pop(next(iter(_LAST)))
                _KEEP_RUNS[self.key] = _KEEP_RUNS.get(self.key, 0) + 1
        except Exception as e:
            print("[Pixaroma] H3 Timeline: could not remember this run for Keep ({}).".format(e))
        return out


def _scene_sig(scenes):
    """Where each scene sits and what starts it: Keep may hold a scene only while these are the same as in the
    Run it keeps from (a changed length moves every border after it; a moved or new picture is another scene)."""
    return [(round(float(s["length"]), 3), s["picture"] or "", s["role"], bool(s["cut"])) for s in scenes]


def _keep_latent(latent, prev, scenes, keeps):
    """The node's empty AV latent -> (latent with the kept scenes filled from the last Run and held (noise_mask 0,
    video and sound), [the scenes held]), or (None, why) when nothing can be kept."""
    import torch
    import comfy.nested_tensor
    samples = latent.get("samples") if isinstance(latent, dict) else None
    if prev is None or samples is None or not getattr(samples, "is_nested", False):
        return None, "no earlier Run of this node to keep from (made in full)"
    v, a = samples.unbind()[:2]
    if tuple(prev[0].shape) != tuple(v.shape) or tuple(prev[1].shape) != tuple(a.shape):
        return None, "the last Run was another size or length, so every scene is made new"
    sig, old = _scene_sig(scenes), prev[2]
    if [s[0] for s in sig] != [s[0] for s in old]:
        return None, "a scene length changed since the last Run, so every scene is made new"
    held = [i for i in sorted(keeps) if i < len(sig) and sig[i] == old[i]]
    if not held:
        return None, "the kept scenes changed since the last Run (picture or cut), so they are made new"
    nv, na = v.clone(), a.clone()
    vm, am = torch.ones_like(v), torch.ones_like(a)
    lengths = [s["length"] for s in scenes]
    for t0, t1, a0, a1 in keep_ranges(lengths, v.shape[2], a.shape[-1], held):
        nv[:, :, t0:t1] = prev[0][:, :, t0:t1].to(nv)
        vm[:, :, t0:t1] = 0
        na[..., a0:a1] = prev[1][..., a0:a1].to(na)
        am[..., a0:a1] = 0
    out = dict(latent)
    out["samples"] = comfy.nested_tensor.NestedTensor((nv, na))
    out["noise_mask"] = comfy.nested_tensor.NestedTensor((vm, am))
    return out, held


def _resolve_picture(name):
    """An input-folder picture name -> its real path, or None. The same order as Load Audio's _resolve
    (patterns/path-containment.md): the rooted prescreen BEFORE anything touches the disk, then containment in the
    INPUT folder only (a timeline picture is always an upload there)."""
    import os
    import folder_paths
    if not name or not isinstance(name, str):
        return None
    bare = name.split(" [")[0] if " [" in name else name
    if rel_is_rooted(bare):
        return None
    try:
        path = folder_paths.get_annotated_filepath(name)
        root = folder_paths.get_input_directory()
    except Exception:
        return None
    if not root or not is_path_under(path, root):
        return None
    return path if os.path.isfile(path) else None


def _load_picture(name, n):
    import numpy as np
    import torch
    import node_helpers
    from PIL import Image, ImageOps
    # A picture taken from one of the user's own folders (Load Image's picker, + Folder) is a COPY in
    # input/pixaroma_folders: bring it up to date with the original first, like Load Image does. Never raises; a
    # no-op for every other picture.
    refresh_copy(name)
    path = _resolve_picture(name)
    if path is None:
        raise ValueError("H3 Timeline: scene {}'s picture \"{}\" is not in ComfyUI's input folder. Pick it again on "
                         "the node.".format(n, name))
    img = node_helpers.pillow(Image.open, path)
    img = node_helpers.pillow(ImageOps.exif_transpose, img)
    img = normalize_bit_depth(img).convert("RGB")      # a 16-bit picture would clip to near white
    return torch.from_numpy(np.asarray(img).astype(np.float32) / 255.0)[None]


def _pictures_stamp(state):
    """For IS_CHANGED: what each scene picture IS now, so a picture changed under the same name re-runs the node.
    A folder copy: the ORIGINAL's size + time (the copy is refreshed later, inside the Run; hashing it here would
    change the key once more at the next Run, node_load_image.IS_CHANGED). Any other: the file's bytes, like core
    Load Image. Only through _resolve_picture (IS_CHANGED is a second entry point). Never raises."""
    import hashlib
    m = hashlib.sha256()
    try:
        names = []
        for sc in parse_state(state)["scenes"]:
            if sc["picture"] and sc["picture"] not in names:
                names.append(sc["picture"])
        for name in names:
            m.update(name.encode("utf-8", "replace") + b"\0")
            stamp = source_stamp(name)
            if stamp:
                m.update(stamp.encode("utf-8"))
                continue
            path = _resolve_picture(name)
            if path is None:
                m.update(b"missing")
                continue
            with open(path, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    m.update(chunk)
    except Exception as e:
        m.update(repr(e).encode("utf-8", "replace"))
    return m.hexdigest()


def _frame_picture(img, w, h, fit, x, y):
    """A scene's look picture -> exactly the video frame's size: cut to fill at (x, y), or fitted inside with black
    bars."""
    import torch
    import comfy.utils
    src_h, src_w = int(img.shape[1]), int(img.shape[2])
    s = img.movedim(-1, 1)
    if fit == "fit":
        sw, sh, left, top = fit_box(src_w, src_h, w, h)
        out = torch.zeros((1, 3, h, w), dtype=s.dtype, device=s.device)
        out[:, :, top:top + sh, left:left + sw] = comfy.utils.common_upscale(s, sw, sh, "lanczos", "disabled")
    else:
        sw, sh, left, top = cut_box(src_w, src_h, w, h, x, y)
        out = comfy.utils.common_upscale(s, sw, sh, "lanczos", "disabled")[:, :, top:top + h, left:left + w]
    return out.movedim(1, -1).clamp(0.0, 1.0)


def _fit_audio(audio, seconds):
    """The track cut (or padded with real silence) to the clip: as <Audio 1> it must be the clip's length, or H3
    Long Video's windows cannot cut it per window (is_track_ref). -> (audio or None, readout)."""
    import torch
    try:
        wave, sr = audio["waveform"], int(audio["sample_rate"])
        if not torch.is_tensor(wave) or wave.ndim != 3 or wave.shape[-1] < 1 or sr <= 0:
            return None, "the audio input is not a sound"
    except Exception:
        return None, "the audio input is not a sound"
    have = wave.shape[-1] / float(sr)
    want = int(round(seconds * sr))
    if wave.shape[-1] >= want:
        wave = wave[..., :want]
        note = "audio {:.1f} s, fits".format(have) if have - seconds < 0.5 else \
            "audio {:.1f} s, the video uses the first {:.1f} s".format(have, seconds)
    else:
        pad = torch.zeros(wave.shape[:-1] + (want - wave.shape[-1],), dtype=wave.dtype, device=wave.device)
        wave = torch.cat([wave, pad], dim=-1)
        note = "audio {:.1f} s for a {:.1f} s video: the last {:.1f} s are silent".format(have, seconds, seconds - have)
    return {"waveform": wave.contiguous(), "sample_rate": sr}, note


class PixaromaH3Timeline:
    DESCRIPTION = (
        "Tell one long MiniMax H3 video as scenes: each scene has its own length, a few words for what happens, "
        "and, if it needs one, its own picture. Scene 1's picture is the start picture. A later picture is either a "
        "New look (the same shot with a change, like a hat or another dress; it fades in, so for a natural change write "
        "the action in the scene before, with no picture) or Add person (any photo "
        "of someone who joins; they can walk in).\n\n"
        "It replaces MiniMax H3 Reference to Video and H3 Long Video: wire model, clip and both VAEs in, and the "
        "model, positive and latent out to H3 Audio Sync and the sampler. Sing and Talk put your words into the "
        "tested EP41 prompts and use the audio input as the song or the voice (lock it with H3 Audio Sync); Act needs "
        "no audio and H3 makes the sound itself.\n\n"
        "The video is made in one run, in windows that follow your scenes. Each scene either BLENDS out of the one "
        "before (one continuous shot, no flash) or starts with a clean CUT (a new shot from its own picture, the "
        "audio still in time). KEEP on a scene holds it as your last Run made it: change the seed and Run again to "
        "redo only the other scenes, in less time. A shorter WINDOW (5 s) uses less memory, for big sizes like "
        "960 x 1728. A scene is 4 seconds or more. A person who joins stays for the "
        "scene they join in: write their arrival and what they do next in one scene, and keep that scene at about "
        "13 seconds or less (a longer one is made in two parts and the person can slide between them). Works only "
        "with MiniMax H3."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"tooltip": "Your MiniMax H3 model (after its LoRAs). The node sets it up to make "
                                               "the video scene by scene."}),
                "clip": ("CLIP", {"tooltip": "The MiniMax H3 text encoder: it reads each scene's prompt and pictures."}),
                "vae": ("VAE", {"tooltip": "The MiniMax H3 video VAE."}),
                "audio_vae": ("VAE", {"tooltip": "The MiniMax H3 audio VAE."}),
                "mode": (list(MODES), {"default": "Sing", "tooltip": (
                    "Sing: the picture sings the audio (a song). Talk: the picture speaks the audio (a voice). Act: no "
                    "audio, H3 makes the sound itself. Your scene words go into the tested prompt for that mode.")}),
                "width": ("INT", {"default": 480, "min": 128, "max": 2048, "step": 32,
                                  "tooltip": "Video width. H3 sizes are multiples of 32."}),
                "height": ("INT", {"default": 864, "min": 128, "max": 2048, "step": 32,
                                   "tooltip": "Video height. H3 sizes are multiples of 32."}),
            },
            "optional": {
                "audio": ("AUDIO", {"tooltip": (
                    "The song (Sing) or the voice (Talk), as long as the video or longer: it is cut to the video's "
                    "length. Wire the same sound into H3 Audio Sync's track so the mouth follows it. Not used in Act.")}),
            },
            "hidden": {
                "TimelineState": "STRING",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("MODEL", "CONDITIONING", "LATENT", "FLOAT")
    RETURN_NAMES = ("model", "positive", "latent", "seconds")
    OUTPUT_TOOLTIPS = (
        "Your model, set to make the video scene by scene. Wire it to H3 Audio Sync (or straight to the sampler).",
        "Scene 1's conditioning (the node swaps in the other scenes while it samples). Wire it to the sampler, and "
        "through Conditioning Zero Out to its negative.",
        "The empty video + sound latent for the whole length. Wire it to H3 Audio Sync's latent (or the sampler).",
        "The video's length in seconds (all scenes added up, on H3's frame grid). Not for the Load Audio that feeds "
        "this node: the scenes set the length.",
    )
    FUNCTION = "run"
    # The face shows the run's result: a Run with nothing changed is cached, runs
    # no code, and re-sends that result only with this (ComfyUI 0.42 execution.py;
    # measured 2026-10-25: after a reload the face stayed empty, video-tools.md #8).
    HAS_INTERMEDIATE_OUTPUT = True
    CATEGORY = "👑 Pixaroma/🎵 Audio"

    @classmethod
    def IS_CHANGED(cls, TimelineState=None, **kwargs):
        # The scenes text is already in the cache key; this adds what the pictures ARE, so a picture edited or
        # replaced under the same name (or a folder picture's original) re-runs the node.
        stamp = _pictures_stamp(TimelineState)
        # Keep that could NOT hold anything in this node's last run (none yet, e.g. a saved workflow opened after a
        # restart with Keep already on; another size; a length changed): the node's cached latent has no kept
        # scenes, and changing only the seed would reuse it forever. So the key moves each time the sampler
        # stores a new Run, until Keep holds; from then on it stays put and the cache holds the kept frames.
        try:
            if any(sc["keep"] for sc in parse_state(TimelineState)["scenes"]):
                key = str(kwargs.get("unique_id"))
                if not _KEEP_HELD.get(key):
                    return "{}|keep{}".format(stamp, _KEEP_RUNS.get(key, 0))
        except Exception:
            pass
        return stamp

    def run(self, model, clip, vae, audio_vae, mode, width, height, audio=None, TimelineState=None, unique_id=None):
        try:
            from comfy_extras.nodes_minimax_h3 import MiniMaxH3ReferenceToVideo
        except Exception as e:
            raise RuntimeError("H3 Timeline needs a ComfyUI with MiniMax H3 support (core 0.42 or newer).") from e
        state = parse_state(TimelineState)
        scenes = state["scenes"]
        max_chunks = window_chunks(state["window"])
        lengths = [s["length"] for s in scenes]
        frames = clip_frames(lengths)
        seconds = frames / float(FPS)
        w = max(128, int(width) // 32 * 32)
        h = max(128, int(height) // 32 * 32)
        mode = mode if mode in MODES else "Sing"
        note = ""
        track = None
        if mode != "Act":
            if audio is None:
                note = "no audio wired: made as Act (H3 makes the sound)"
            else:
                track, note = _fit_audio(audio, seconds)
            if track is None:
                print("[Pixaroma] H3 Timeline: " + note + ".")
                mode = "Act"
        if not scenes[0]["picture"]:
            raise ValueError("H3 Timeline: scene 1 needs a picture (the start picture). H3 cannot keep a long video "
                             "together without one.")

        loaded = {}

        def picture(name, n):
            if name not in loaded:
                loaded[name] = _load_picture(name, n)
            return loaded[name]

        look, people, built, scene_conds, later_conds = None, [], {}, [], {}
        positive = latent = None
        cuts = {i for i, sc in enumerate(scenes) if i > 0 and sc["cut"]}
        preroll = state["preroll"] if cuts else 0
        split = split_scenes(lengths, cuts, max_chunks, preroll)

        def make(text, i):
            key = (text, look[:4], tuple(people))
            if key not in built:
                refs = {"ref_image_0": _frame_picture(picture(look[0], look[4]), w, h, look[1], look[2], look[3])}
                for k, p in enumerate(people):
                    refs["ref_image_{}".format(k + 1)] = picture(p, i + 1)
                out = MiniMaxH3ReferenceToVideo.execute(
                    clip=clip, prompt=text, width=w, height=h, length=frames, ref_image_size="match",
                    vae=vae, audio_vae=audio_vae, ref_images=refs,
                    ref_audios={"ref_audio_0": track} if track is not None else None)
                built[key] = (out[0], out[1])
            return built[key]

        for i, sc in enumerate(scenes):
            entering = ()
            if sc["picture"]:
                if i == 0 or sc["role"] != ROLE_PERSON:
                    look = (sc["picture"], sc["fit"], sc["x"], sc["y"], i + 1)
                elif sc["picture"] not in people:
                    people = people + [sc["picture"]]
                    entering = (len(people) - 1,)
            # a scene after a clean cut is a fresh shot that begins from its look picture, worded like scene 1
            cond, lat = make(build_prompt(mode, sc["words"], len(people), entering, later=i > 0 and i not in cuts), i)
            if i == 0:
                positive, latent = cond, lat
                scene_conds.append(None)
            else:
                scene_conds.append(None if cond is positive else (cond[0][0], cond[0][1]))
            if entering and i in split:
                # Only read when this scene is split into windows (wrapper): the later ones see them already there.
                later, _ = make(build_prompt(mode, sc["words"], len(people), later=True, arrived=entering), i)
                later_conds[i] = (later[0][0], later[0][1])

        if type(getattr(model, "model", None)).__name__ != "MiniMaxH3":
            print("[Pixaroma] H3 Timeline: this model is not MiniMax H3, the scenes will not work.")
        m = model.clone()
        kind = _diffusion_model_kind()
        m.remove_wrappers_with_key(kind, WRAPPER_KEY)     # H3 Long Video before this node: the scenes take over
        m.add_wrapper_with_key(kind, WRAPPER_KEY, _SceneWindows(lengths, scene_conds, later_conds, cuts, max_chunks,
                                                                preroll))
        # Keep: remember what this Run makes; the kept scenes of a later Run are taken from it and held
        import comfy.patcher_extension
        key = str(unique_id)
        outer = comfy.patcher_extension.WrappersMP.OUTER_SAMPLE
        m.remove_wrappers_with_key(outer, KEEP_KEY)
        m.add_wrapper_with_key(outer, KEEP_KEY, _KeepLast(key, _scene_sig(scenes)))
        keeps = {i for i, sc in enumerate(scenes) if sc["keep"]}
        keep_note = ""
        _KEEP_HELD[key] = False
        if keeps:
            kept, info = _keep_latent(latent, _LAST.get(key), scenes, keeps)
            _KEEP_HELD[key] = kept is not None
            if kept is None:
                keep_note = "Keep: " + info
                print("[Pixaroma] H3 Timeline: " + keep_note + ".")
            else:
                latent = kept
                keep_note = "Keep: scene{} {} kept from the last Run".format(
                    "s" if len(info) > 1 else "", ", ".join(str(i + 1) for i in info))
                if len(info) < len(keeps):
                    keep_note += " (the others changed, so they are made new)"

        spans = describe_scenes(lengths, frames)
        ui = {"h3_timeline": [{"frames": frames, "seconds": round(seconds, 2), "mode": mode, "audio": note,
                               "keep": keep_note, "scenes": [[a, b] for a, b in spans]}]}
        return {"ui": ui, "result": (m, positive, latent, seconds)}


NODE_CLASS_MAPPINGS = {"PixaromaH3Timeline": PixaromaH3Timeline}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaH3Timeline": "H3 Timeline Pixaroma"}
