"""H3 Long Video Pixaroma - one long MiniMax H3 clip, made in overlapping windows.

WHAT THIS IS FOR. H3 was trained on clips of 4 to 15 seconds. One run of 30 or 60
seconds works on a big card but is slow (attention grows with the square of the
length) and on a 12 GB card a 60 s run does not finish a single step. Chaining
10 s clips (the last frames of one pinned into the next) was measured and
rejected: every guided clip comes out darker and softer, which reads as a flash
and a quality drop at each join.

HOW. A DIFFUSION_MODEL wrapper. ComfyUI still samples ONE latent for the whole
clip; on every step the transformer runs on overlapping time windows of it (with
the matching slice of the sound) and the window outputs are blended across each
overlap. Because every step sees every window, the windows agree with each other
step by step and there is no join anywhere. model_base still does the noise
maths, the denoise masks and the audio carry on the WHOLE latent; only the
transformer sees slices, so H3 Audio Sync's locked track works unchanged.

Per window the packed layout is rebuilt (comfy/ldm/minimax/model.py rebuilds it
when the shapes differ, but keyframes are not part of its signature, so the
prebuilt one is dropped), pinned guides are shifted or cut to the window, and a
reference audio as long as the clip (the song as <Audio 1>) is cut to the same
part of the song the window is singing.

MEASURED 2026-10-22 (singer + real song, 480x864, ref2va + DMAD 4 steps):
30 s in 10 s windows sharpness 80 / face 162 vs one run 83 / 166, no flash, no
ghosting; 60 s: 4.5 min vs 9.4 min for one run, and it runs on a simulated 12 GB
card. A windowed REFINE of an upscaled low-res clip does NOT sharpen (H3 keeps a
soft input soft), which is why this node generates instead of upscaling.

Pure maths: _h3_long_video_helpers.py. Harness: D:\\Claude Tests\\_h3_long_video_test.py
"""
from __future__ import annotations

from ._h3_long_video_helpers import (
    FPS, OVERLAP_DEFAULT_S, OVERLAP_MAX_S, OVERLAP_MIN_S, WINDOW_DEFAULT_S, WINDOW_MAX_S, WINDOW_MIN_S,
    describe, frames_of, guide_audio_slice, is_track_ref, place_guide, plan_windows, ramp_weights, window_chunks,
)

WRAPPER_KEY = "pixaroma_h3_long_video"


def _diffusion_model_kind():
    import comfy.patcher_extension
    return comfy.patcher_extension.WrappersMP.DIFFUSION_MODEL


def is_windowed(model) -> bool:
    """Does this MODEL carry H3 Long Video's windows? (H3 Audio Sync asks, to skip its 15 second guard.)"""
    try:
        return bool(getattr(model, "wrappers", {}).get(_diffusion_model_kind(), {}).get(WRAPPER_KEY))
    except Exception:
        return False


class _Windows:
    """The wrapper itself: one instance per node run, called on every model step."""

    def __init__(self, n, stride):
        self.n = n
        self.stride = stride
        self._told = None
        self._weights = {}

    def _report(self, latent_t, count):
        if self._told == latent_t:
            return
        self._told = latent_t
        win, ovl = describe(self.n, self.stride)
        print("[Pixaroma] H3 Long Video: {:.2f}s clip made in {} windows of {:.2f}s ({:.2f}s overlap)".format(
            frames_of(latent_t) / FPS, count, win, ovl))

    def _blend(self, wins, device):
        import torch
        key = (tuple(wins), str(device))
        if key not in self._weights:
            wv = ramp_weights([(l0, l1) for l0, l1, _, _ in wins])
            wa = ramp_weights([(a0, a1) for _, _, a0, a1 in wins])
            self._weights = {key: (
                [torch.tensor(w, dtype=torch.float32, device=device).view(1, 1, -1, 1, 1) for w in wv],
                [torch.tensor(w, dtype=torch.float32, device=device).view(1, 1, 1, -1) for w in wa])}
        return self._weights[key]

    def _window_payload(self, payload, l0, l1, a0, a1, audio_t):
        p = dict(payload)
        p.pop("layout", None)      # keyframes are not in its signature: force the rebuild for this window
        f0 = frames_of(l0)
        kfs = None
        if payload.get("keyframes") is not None:
            kfs = []
            for kf in payload["keyframes"]:
                lat, aud = kf.get("latent"), kf.get("audio_latent")
                tokens = (int(lat.shape[2]) if lat.ndim == 5 else 1) if lat is not None else 0
                spot = place_guide(int(kf["resolved_frame_index"]), tokens, l0, l1)
                if spot is None and lat is not None and aud is not None:
                    # its picture is not in this window, but its soundtrack can be: keep the sound alone
                    spot = place_guide(int(kf["resolved_frame_index"]), 0, l0, l1)
                    lat = None
                if spot is None:
                    continue
                t_from, t_to, new_idx = spot
                nk = dict(kf, resolved_frame_index=new_idx)
                if lat is None:
                    nk.pop("latent", None)
                elif (t_from, t_to) != (0, tokens):
                    nk["latent"] = lat[:, :, t_from:t_to]
                if aud is not None:
                    cut = guide_audio_slice(int(kf["resolved_frame_index"]), new_idx, f0, int(aud.shape[-1]), a1 - a0)
                    if cut is None:
                        nk.pop("audio_latent", None)
                    else:
                        nk["audio_latent"] = aud[..., cut[0]:cut[1]]
                if nk.get("latent") is None and nk.get("audio_latent") is None:
                    continue
                kfs.append(nk)
            p["keyframes"] = kfs
        refs = payload.get("refs")
        if refs is not None:
            cut_refs = []
            for r in refs:
                al = r.get("audio_latent")
                if r.get("kind") == "audio" and al is not None and is_track_ref(r.get("ref_audio_t"), audio_t):
                    al = al[..., a0:a1]
                    r = dict(r, audio_latent=al, ref_audio_t=int(al.shape[-1]))
                cut_refs.append(r)
            refs = cut_refs
            p["refs"] = refs
        # the same order model_base.MiniMaxH3.extra_conds uses: keyframes first, then references
        cv = [k["latent"] for k in (kfs or []) if k.get("latent") is not None]
        ca = [k["audio_latent"] for k in (kfs or []) if k.get("audio_latent") is not None]
        cv += [r["latent"] for r in (refs or []) if "latent" in r]
        ca += [r["audio_latent"] for r in (refs or []) if r.get("audio_latent") is not None]
        if "cond_video_latents" in payload or cv:
            p["cond_video_latents"] = cv
        if "cond_audio_latents" in payload or ca:
            p["cond_audio_latents"] = ca
        return p

    def __call__(self, executor, x, timestep, context, transformer_options=None, **kwargs):
        if transformer_options is None:
            transformer_options = {}
        # anything that is not H3's [video, audio] pair goes straight through
        if not isinstance(x, (list, tuple)) or len(x) != 2 or getattr(x[0], "ndim", 0) != 5:
            return executor(x, timestep, context, transformer_options, **kwargs)
        video, audio = x[0], x[1]
        wins = plan_windows(video.shape[2], audio.shape[-1], self.n, self.stride)
        if wins is None:
            return executor(x, timestep, context, transformer_options, **kwargs)
        import torch
        self._report(video.shape[2], len(wins))
        wv, wa = self._blend(wins, video.device)
        payload = kwargs.get("minimax_payload") or {}
        dm, adm = kwargs.get("denoise_mask"), kwargs.get("audio_denoise_mask")
        out_v = torch.zeros(video.shape, dtype=torch.float32, device=video.device)
        out_a = torch.zeros(audio.shape, dtype=torch.float32, device=audio.device)
        for (l0, l1, a0, a1), w_v, w_a in zip(wins, wv, wa):
            kw = dict(kwargs)
            kw["minimax_payload"] = self._window_payload(payload, l0, l1, a0, a1, audio.shape[-1])
            if dm is not None:
                kw["denoise_mask"] = dm[:, :, l0:l1]
            if adm is not None:
                kw["audio_denoise_mask"] = adm[..., a0:a1]
            o = executor([video[:, :, l0:l1], audio[..., a0:a1]], timestep, context,
                         transformer_options.copy(), **kw)
            out_v[:, :, l0:l1] += o[0].float() * w_v
            out_a[..., a0:a1] += o[1].float() * w_a.to(audio.device)
            del o
        return [out_v.to(video.dtype), out_a.to(audio.dtype)]


class PixaromaH3LongVideo:
    DESCRIPTION = (
        "For MiniMax H3 videos LONGER than about 15 seconds: 30 seconds, a minute or more, made in one run with "
        "no joins. For 15 seconds or less you do not need it (with it, nothing changes). Put it on the model wire "
        "before H3 Audio Sync and the sampler, and set the video length you need, up to about 149 seconds "
        "(ComfyUI's own MiniMax H3 nodes stop at 3600 frames).\n\n"
        "H3 was trained on clips of up to about 15 seconds. This node still makes the whole video as one piece, "
        "but on every step the model looks at it in overlapping windows of about 10 seconds, each with its own "
        "part of your song, and the windows are blended where they overlap. Because every window is worked on "
        "at every step, they agree with each other and there is no seam, flash or quality drop anywhere.\n\n"
        "It also needs far less graphics memory than one long run and is faster: a minute at 864 took 4.5 "
        "minutes instead of 9.4 on a 4090, and with only 12 GB of graphics memory free it ran at the same "
        "speed (a minute at 864, and 30 seconds at 1024), where one long run could not finish a step.\n\n"
        "This node only works with MiniMax H3. Find it by searching for h3, minimax, long video, windows."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {
                    "tooltip": "Your MiniMax H3 model (after its LoRAs). Wire the output on to H3 Audio Sync "
                               "and the sampler.",
                }),
                "window_seconds": ("FLOAT", {
                    "default": WINDOW_DEFAULT_S, "min": WINDOW_MIN_S, "max": WINDOW_MAX_S, "step": 0.5,
                    "tooltip": "How much of the video the model looks at at once. 10 seconds is the tested "
                               "default; H3 was trained on 4 to 15 seconds. Shorter windows use less memory "
                               "but hold together a little less well. Snapped to H3's frame grid (10 becomes "
                               "10.12). A video no longer than one window is made in one piece as usual.",
                }),
                "overlap_seconds": ("FLOAT", {
                    "default": OVERLAP_DEFAULT_S, "min": OVERLAP_MIN_S, "max": OVERLAP_MAX_S, "step": 0.5,
                    "tooltip": "How much two neighbouring windows share; they are blended across it. 1.5 "
                               "seconds is the tested default. More overlap = smoother but slower. Snapped to "
                               "H3's frame grid (1.5 becomes 1.62).",
                }),
            },
        }

    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("model",)
    OUTPUT_TOOLTIPS = (
        "Your model, set to make long videos in windows. Wire it to H3 Audio Sync (or straight to the sampler).",
    )
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma/🎵 Audio"

    def run(self, model, window_seconds, overlap_seconds):
        n, stride = window_chunks(window_seconds, overlap_seconds)
        if type(getattr(model, "model", None)).__name__ != "MiniMaxH3":
            print("[Pixaroma] H3 Long Video: this model is not MiniMax H3, so the node changes nothing.")
        m = model.clone()
        kind = _diffusion_model_kind()
        m.remove_wrappers_with_key(kind, WRAPPER_KEY)   # two of these nodes in a row: the last one wins
        m.add_wrapper_with_key(kind, WRAPPER_KEY, _Windows(n, stride))
        return (m,)


NODE_CLASS_MAPPINGS = {"PixaromaH3LongVideo": PixaromaH3LongVideo}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaH3LongVideo": "H3 Long Video Pixaroma"}
