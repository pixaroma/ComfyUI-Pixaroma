"""H3 Audio Sync Pixaroma - make the picture sing YOUR track.

WHAT THIS IS FOR. MiniMax H3 generates video and sound together as one joined
latent, so left alone it invents its own audio and the mouth moves to a song
that does not exist. This node puts a real recording into the sound half and
pins it there, so the sampler can only change the picture - and the only picture
that fits a fixed soundtrack is one whose mouth matches it.

HOW IT HOLDS THE SOUND STILL. `noise_mask` is a NestedTensor of ones for the
video and zeros for the audio. That is ComfyUI's own feature, not a trick:
comfy/samplers.py unbinds a nested denoise_mask, pads it per stream and blends
every step, so a zero-masked stream is carried through untouched.

WHY THE FITTING HAPPENS IN THE WAVEFORM, NOT THE LATENT. Padding an audio latent
with zeros is NOT silence - zero is just another point in latent space and
decodes to a tone or hiss - and because the stream is then frozen, the model
paints video against that noise for the whole tail. Real samples padded with
real zeros are actual silence. See _h3_sync_helpers.target_samples.

ON THE MODEL PASSTHROUGH. `model` goes through completely untouched, and the
output exists so the node can sit inline in the chain rather than making you
route the wire around it. There IS a real thing that could be done here: the DiT
derives the audio stream's timestep from the video sigma
(comfy/ldm/minimax/model.py, `t_a = 1.0 - time_shift_sigma(...)`), so while we
hold the audio clean the model is still told it is noisy. Telling it otherwise
would need a core hook that does not exist in ComfyUI 0.30.1 - checked across
the whole tree and every installed package. Deliberately NOT faked with a model
patch: it would be an unverifiable guess about quality, and a wrong guess here
is invisible rather than loud.

Pure maths: _h3_sync_helpers.py + _audio_window_helpers.py.
Harness: D:\\Claude Tests\\_audio_nodes_test.py
"""
from __future__ import annotations

import json

from ._audio_window_helpers import apply_window, plan_window
from ._h3_sync_helpers import LIMIT_DEFAULT_S, clip_info, over_limit, status, target_samples
from .node_h3_long_video import is_windowed

HIDDEN_INPUT = "H3SyncState"


def _state(raw):
    try:
        st = json.loads(raw or "{}")
    except Exception:
        return {}
    return st if isinstance(st, dict) else {}


class PixaromaH3AudioSync:
    DESCRIPTION = (
        "Makes a MiniMax H3 video sing the track you give it, instead of the meaningless sound the "
        "model would invent on its own. Put it between your latent and your sampler.\n\n"
        "H3 is unusual: it creates the picture and the sound at the same time, as one thing. That is "
        "why you cannot simply mute its audio and lay your own song on top afterwards, because the "
        "mouth was never moving to your song in the first place. This node drops your recording into "
        "the sound half and holds it still, so the only thing left for the model to decide is the "
        "picture that fits it.\n\n"
        "It works out how long the clip is by itself, so you never type a duration. If your track is "
        "shorter than the clip the node fills the rest with silence or loops it, whichever you chose, "
        "and says so on the node. If the clip is longer than about 15 seconds it warns you before the "
        "render rather than after, because H3 was only trained to about that length. For a longer video put "
        "H3 Long Video Pixaroma on the model wire before this node: it makes the clip in windows, and this "
        "node then skips the warning.\n\n"
        "This node only works with MiniMax H3. Find it by searching for h3, minimax, lipsync, sync, "
        "or music video."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {
                    "tooltip": "Your MiniMax H3 model. It passes straight through untouched.",
                }),
                "latent": ("LATENT", {
                    "tooltip": "The joined picture-and-sound latent from an H3 node, such as Empty "
                               "MiniMax H3 AV Latent or MiniMax H3 Image to Video.",
                }),
                "audio_vae": ("VAE", {
                    "tooltip": "H3's audio VAE, the same one the H3 conditioning node uses.",
                }),
                "track": ("AUDIO", {
                    "tooltip": "The real recording you want the video to perform: a song, a line of "
                               "dialogue, anything. Trim it first with Load Audio Pixaroma if you "
                               "only want part of it.",
                }),
            },
            "hidden": {HIDDEN_INPUT: ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("MODEL", "LATENT", "AUDIO")
    RETURN_NAMES = ("model", "latent", "audio")
    OUTPUT_TOOLTIPS = (
        "Your model, unchanged. Wire it on to the sampler so this node sits in the chain instead of "
        "being wired around.",
        "The latent with your track locked into its sound half. Wire this into the sampler.",
        "Your track cut to exactly the length of the clip, ready for the save node so the finished "
        "file has picture and sound the same length.",
    )
    FUNCTION = "run"
    # The face shows the run's result: a Run with nothing changed is cached, runs
    # no code, and re-sends that result only with this (ComfyUI 0.42 execution.py;
    # measured 2026-10-25: after a reload the face stayed empty, video-tools.md #8).
    HAS_INTERMEDIATE_OUTPUT = True
    CATEGORY = "👑 Pixaroma/🎵 Audio"

    def run(self, model, latent, audio_vae, track, **kwargs):
        import torch
        import comfy.nested_tensor

        st = _state(kwargs.get(HIDDEN_INPUT, "{}"))
        limit = st.get("limit", LIMIT_DEFAULT_S)
        # H3 Long Video earlier on the model wire makes the clip in ~10 s windows, so the 15 s wall does not apply
        if is_windowed(model):
            limit = 0
        when_short = "loop" if st.get("whenShort") == "loop" else "silence"

        samples = latent.get("samples") if isinstance(latent, dict) else None
        if samples is None or not getattr(samples, "is_nested", False):
            raise ValueError(
                "[Pixaroma] H3 Audio Sync needs a MiniMax H3 latent, which carries picture and "
                "sound together. The latent it was given holds only one of the two, so it is "
                "probably from a different model. Feed it an Empty MiniMax H3 AV Latent, or the "
                "latent output of MiniMax H3 Image to Video / Reference to Video."
            )

        parts = samples.unbind()
        if len(parts) < 2:
            raise ValueError(
                "[Pixaroma] H3 Audio Sync: that latent has no sound half to lock a track into."
            )
        video_latent, audio_template = parts[0], parts[1]
        target_t = audio_template.shape[-1]
        info = clip_info(video_latent.shape[2], target_t)

        # ── the clip-length guard, BEFORE any of the expensive work ──────────
        if over_limit(info["seconds"], limit):
            msg = (
                "[Pixaroma] H3 Audio Sync: this clip is {:.2f}s ({} frames), past the {:.0f}s you "
                "set as the longest. MiniMax H3 was only trained to about 15 seconds and usually "
                "falls apart beyond it. Lower the length on your latent node, or raise the limit "
                "in this node's settings."
            ).format(info["seconds"], info["frames"], float(limit))
            if st.get("overMode") == "stop":
                raise ValueError(msg)
            print(msg)

        # ── fit the WAVEFORM to the clip, then encode ────────────────────────
        waveform = track["waveform"][:1]                 # H3 is batch size 1
        sample_rate = int(track["sample_rate"])
        vae_rate = int(getattr(audio_vae, "audio_sample_rate", 32000))
        if sample_rate != vae_rate:
            import torchaudio
            waveform = torchaudio.functional.resample(waveform, sample_rate, vae_rate)

        track_seconds = waveform.shape[-1] / float(vae_rate or 1)
        want_samples = target_samples(target_t, vae_rate)
        plan = plan_window(waveform.shape[-1], vae_rate, 0.0, want_samples / float(vae_rate or 1))
        fitted = apply_window(waveform, plan, when_short)

        encoded = audio_vae.encode(fitted.movedim(1, -1))

        # Encoders round; this is the last couple of latent frames, never a real
        # gap. Repeat the final frame rather than zero-padding for the same
        # reason the waveform fitting exists at all - a zero latent frame is not
        # silence, and even two of them sit under the last moments of the shot.
        have = encoded.shape[-1]
        if have > target_t:
            encoded = encoded[..., :target_t]
        elif have < target_t:
            if have == 0:
                raise ValueError(
                    "[Pixaroma] H3 Audio Sync: the audio VAE returned nothing for that track."
                )
            tail = encoded[..., -1:].repeat_interleave(target_t - have, dim=-1)
            encoded = torch.cat([encoded, tail], dim=-1)

        locked = dict(latent)
        locked["samples"] = comfy.nested_tensor.NestedTensor((video_latent, encoded))
        # ones = denoise this stream, zeros = leave it exactly as it is. A video mask that is already on the latent
        # (H3 Timeline's Keep: the scenes kept from the last Run held at 0) stays; only the sound is replaced.
        video_mask = torch.ones_like(video_latent)
        old = latent.get("noise_mask") if isinstance(latent, dict) else None
        if old is not None and getattr(old, "is_nested", False):
            old_v = old.unbind()[0]
            if tuple(old_v.shape) == tuple(video_latent.shape):
                video_mask = old_v.to(video_latent)
        locked["noise_mask"] = comfy.nested_tensor.NestedTensor((video_mask, torch.zeros_like(encoded)))

        report = status(info, track_seconds, limit, when_short)
        if report["level"] != "ok":
            print("[Pixaroma] H3 Audio Sync: {} - {}".format(report["head"], report["detail"]))

        # Hand back the track cut to the clip, so the save node gets sound the
        # same length as the picture. Returning the whole untrimmed recording
        # here is the one thing that would quietly ruin the finished file.
        matched = {"waveform": fitted, "sample_rate": vae_rate}

        return {
            "ui": {"pixaroma_h3_sync": [dict(report, frames=info["frames"],
                                             seconds=round(info["seconds"], 3),
                                             track=round(track_seconds, 3))]},
            "result": (model, locked, matched),
        }


NODE_CLASS_MAPPINGS = {"PixaromaH3AudioSync": PixaromaH3AudioSync}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaH3AudioSync": "H3 Audio Sync Pixaroma"}
