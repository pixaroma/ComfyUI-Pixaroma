# nodes/node_audio_react.py
import gc
import math

import torch
import torch.nn.functional as F

import comfy.utils
import comfy.model_management

from ._audio_react_engine import (
    ASPECT_OPTIONS,
    AUDIO_BANDS_HZ,
    MOTION_MODES,
    MotionContext,
    OVERLAYS,
    OverlayContext,
    audio_envelope,
    bandpass_fft,
    onset_track,
    process_aspect,
    reset_motion_caches,
)

# Duplicates MOTION_MODES.keys() in _audio_react_engine.py — kept as a
# top-level list because ComfyUI's INPUT_TYPES is evaluated at import
# time and order matters for the dropdown. A6 will replace this with
# list(MOTION_MODES.keys()) once import order is resolved.
_MOTION_MODES = [
    "scale_pulse",
    "zoom_punch",
    "shake",
    "drift",
    "rotate_pulse",
    "ripple",
    "swirl",
    "slit_scan",
]


class PixaromaAudioReact:
    """Audio-reactive image-to-video without depth. One opinionated node:
    pick a motion mode, optionally stack overlay effects, get an animated
    clip whose motion follows the audio envelope."""

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Source still image to animate."}),
                "audio": ("AUDIO", {"tooltip": "Driver audio. Clip length = audio_duration × fps."}),
                "aspect_ratio": (ASPECT_OPTIONS, {"default": "Original",
                    "tooltip": "Output framing. 'Original' keeps the input image's ratio. Fixed presets crop+resize to that exact size. 'Custom Ratio …' uses custom_width and computes height from the ratio. 'Custom (W & H)' uses both as-is."}),
                "custom_width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8,
                    "tooltip": "Used by 'Custom Ratio …' presets and 'Custom (W & H)'. Ignored by 'Original' and fixed-size presets."}),
                "custom_height": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8,
                    "tooltip": "Used only by 'Custom (Use Width & Height below)'. Other presets compute or ignore it."}),
                "motion_mode": (_MOTION_MODES, {"default": "scale_pulse",
                    "tooltip": (
                        "scale_pulse = uniform breathing zoom on audio amplitude (default — universal, looks good on any image).\n"
                        "zoom_punch = fast zoom-in spike on each transient, slow ease back. Drum-hit / drop aesthetic.\n"
                        "shake = translation jitter on transients, no rotation. Aggressive, hip-hop / rock.\n"
                        "drift = slow Ken Burns circular pan; audio amplifies the drift amount. Subtle, cinematic — best on portraits / landscapes.\n"
                        "rotate_pulse = image rocks CW↔CCW; audio amplifies the rocking angle (max ±15°). Hypnotic, music-box.\n"
                        "ripple = concentric ripples expand from center on each beat. Electronic / ambient.\n"
                        "swirl = polar twist; image looks pulled into a vortex at center, audio drives the twist strength. Trippy / psychedelic.\n"
                        "slit_scan = rows time-displaced by audio envelope. Distinctive, modern, experimental."
                    )}),
                "intensity": ("FLOAT", {"default": 0.8, "min": 0.0, "max": 2.0, "step": 0.05,
                    "tooltip": "How strongly the audio drives the chosen motion mode and the four overlays. 0 = completely still output (matches the input image exactly, useful for previewing overlays alone). 0.8 = cinematic default (visible but tasteful). 1.0–1.5 = energetic. 2.0 = extreme — verges on cartoony for scale-based modes."}),
                "audio_band": (list(AUDIO_BANDS_HZ.keys()), {"default": "full",
                    "tooltip": "Frequency band that drives the motion envelope. full = whole spectrum (default). bass = drum-driven (20–250 Hz). mids = vocal-driven (250–4000 Hz). treble = cymbals/hi-hats (4000–20000 Hz)."}),
                "motion_speed": ("FLOAT", {"default": 0.2, "min": 0.05, "max": 1.0, "step": 0.05,
                    "tooltip": "Time advance for modes whose motion has its own oscillation independent of the audio (ripple, slit_scan, kaleidoscope). Hz / cycles per second. 0.2 = one full cycle every 5s (default, slow cinematic). 0.5 = 2s. 1.0 = fast pulse. Ignored by scale_pulse / zoom_punch / shake (those are 100% audio-driven)."}),
                "smoothing": ("INT", {"default": 5, "min": 1, "max": 15, "step": 1,
                    "tooltip": "Audio envelope moving-average window in frames. 1 = punchy. 5 = balanced default. 8–15 = fluid / cinematic."}),
                "loop_safe": ("BOOLEAN", {"default": True,
                    "tooltip": "Ramp motion to zero across the first and last 0.5s of the clip so playback loops with no visible jump. ON by default — typical use case (audio-reactive music videos / social loops) benefits, the 0.5s fade is invisible on clips longer than ~5s. Turn OFF for one-shot renders that won't loop, or for very short clips where you want full motion at the boundaries. Automatically skipped when the clip is shorter than 4 frames."}),
                "fps": ("INT", {"default": 24, "min": 8, "max": 60, "step": 1,
                    "tooltip": "Output frames per second."}),
                "glitch_strength": ("FLOAT", {"default": 0.6, "min": 0.0, "max": 1.0, "step": 0.05,
                    "tooltip": "RGB channels split apart on transients (chromatic-aberration tear), with occasional 5%-of-rows scanline swap on big spikes. Resolution-relative — same look at 720p as 4K. 0 = off (skipped entirely for performance). 0.3 = subtle. 0.6 = vintage VHS / cyberpunk. 1.0 = aggressive."}),
                "bloom_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05,
                    "tooltip": "Gaussian-blurred glow screen-blended back over the frame, intensity tracks audio envelope. Highlights bloom outward on each beat. 0 = off (skipped — bloom is the most expensive overlay; leaving it at 0 saves ~20% per-frame). 0.4 = dreamy. 0.7 = strong neon glow."}),
                "vignette_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05,
                    "tooltip": "Radial darkening that pulses inward with audio. Center stays at full brightness; corners darken. 0 = off. 0.3 = cinematic safety. 0.7 = heavy mood / horror. 1.0 = corners go ~50% dark on peaks."}),
                "hue_shift_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05,
                    "tooltip": "Cycles the image's hue around the gray axis as audio plays. Max rotation is 30° at full strength + full envelope (deliberately gentle — bigger angles look gimmicky). 0 = off. 0.5 = noticeable color cycle. 1.0 = full ±30° swing on peaks."}),
            }
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "FLOAT")
    RETURN_NAMES = ("video_frames", "audio", "fps")
    FUNCTION = "generate"
    CATEGORY = "👑 Pixaroma"

    def generate(self, image, audio, aspect_ratio, custom_width, custom_height,
                 motion_mode, intensity, audio_band, motion_speed, smoothing,
                 loop_safe, fps,
                 glitch_strength, bloom_strength, vignette_strength, hue_shift_strength):
        # Input validation — clear actionable messages over crashes.
        if image is None:
            raise ValueError(
                "[Pixaroma] Audio React — no image connected. Wire an "
                "IMAGE source (e.g. Load Image) to the 'image' input."
            )
        if (audio is None or not isinstance(audio, dict)
                or "waveform" not in audio or "sample_rate" not in audio
                or audio["waveform"] is None
                or not isinstance(audio["sample_rate"], (int, float))
                or audio["sample_rate"] <= 0):
            raise ValueError(
                "[Pixaroma] Audio React — no valid audio connected. Wire "
                "a Load Audio (or any AUDIO source with non-empty "
                "waveform and sample_rate > 0) to the 'audio' input."
            )

        device = comfy.model_management.get_torch_device()

        # No edge_headroom in this node — see CLAUDE.md "Audio React Patterns".
        # Every motion mode here either pulls inward (scale_pulse, zoom_punch),
        # clamps explicitly (kaleidoscope), or excursions are <6% of frame
        # (shake / ripple / slit_scan) — padding_mode="border" handles those
        # invisibly. So we render at the exact target size, no crop pass.
        image, out_w, out_h = process_aspect(
            image, aspect_ratio, custom_width, custom_height,
        )
        img_tensor = image[0].permute(2, 0, 1).unsqueeze(0).to(device)
        _, _, H, W = img_tensor.shape

        audio_duration = audio["waveform"].shape[-1] / audio["sample_rate"]
        total_frames = int(audio_duration * fps)
        if total_frames <= 0:
            raise ValueError(
                f"Audio is too short to produce any frames at {fps} fps "
                f"(audio_duration={audio_duration:.3f}s)."
            )

        reset_motion_caches()

        envelope = audio_envelope(audio, total_frames, fps, device, audio_band, smoothing)

        # loop_safe needs at least 4 frames so fade_n is >= 2 — otherwise
        # linspace(0, 1, 1) = [0] and the only frame gets zeroed out.
        # Skip silently below 4 frames; user's tiny clip won't loop but
        # also won't be all-zero. linspace(0, 1, fade_n) DELIBERATELY
        # starts at 0 so envelope[0] and envelope[-1] become exactly 0 —
        # that's what makes the playback loop seamless (motion is fully
        # frozen at both ends, so the wrap-around looks identical to a
        # held still frame).
        if loop_safe and total_frames >= 4:
            fade_n = max(2, min(int(fps * 0.5), total_frames // 2))
            loop_ramp = torch.linspace(0.0, 1.0, fade_n, device=device)
            envelope = envelope.detach().clone()
            envelope[:fade_n] = envelope[:fade_n] * loop_ramp
            envelope[-fade_n:] = envelope[-fade_n:] * loop_ramp.flip(0)

        onset = onset_track(envelope)

        comfy.model_management.soft_empty_cache()
        gc.collect()

        # Time vector for periodic motion (ripple / kaleidoscope / slit_scan).
        t_vec = torch.arange(total_frames, device=device, dtype=torch.float32) / fps

        # Normalized base sampling grid in [-1, 1]. grid_sample reads x first.
        y, x = torch.meshgrid(
            torch.linspace(-1, 1, H, device=device),
            torch.linspace(-1, 1, W, device=device),
            indexing="ij",
        )
        base_grid = torch.stack([x, y], dim=-1).unsqueeze(0)  # [1, H, W, 2]

        print(f"[Pixaroma] Audio React: {total_frames} frames @ {fps}fps, "
              f"{W}x{H} -> {out_w}x{out_h}, mode={motion_mode}, band={audio_band}, "
              f"intensity={intensity}, smooth={smoothing}")
        pbar = comfy.utils.ProgressBar(total_frames)

        frames = []
        for i in range(total_frames):
            env_t = envelope[i].item()
            onset_t = onset[i].item()

            ctx = MotionContext(
                base_grid=base_grid,
                env_t=env_t,
                onset_t=onset_t,
                t=t_vec[i].item(),
                intensity=intensity,
                motion_speed=motion_speed,
                H=H, W=W,
                total_frames=total_frames,
                frame_index=i,
                fps=fps,
                onset_arr=onset,
            )
            motion_fn = MOTION_MODES.get(motion_mode)
            if motion_fn is None:
                raise ValueError(
                    f"[Pixaroma] Audio React — unhandled motion_mode {motion_mode!r}. "
                    f"Known: {list(MOTION_MODES.keys())}"
                )
            grid = motion_fn(ctx)

            warped = F.grid_sample(
                img_tensor, grid,
                mode="bilinear", padding_mode="border", align_corners=False,
            )
            frame = warped.squeeze(0).permute(1, 2, 0)  # [H, W, 3]

            # Overlays (each is a no-op when strength == 0).
            overlay_strengths = {
                "glitch":    glitch_strength,
                "bloom":     bloom_strength,
                "vignette":  vignette_strength,
                "hue_shift": hue_shift_strength,
            }
            for ov_name, ov_fn in OVERLAYS.items():
                s = overlay_strengths.get(ov_name, 0.0)
                if s > 0.0:
                    frame = ov_fn(OverlayContext(
                        frame=frame, env_t=env_t, onset_t=onset_t,
                        strength=s, H=H, W=W, device=device,
                    ))

            frames.append(frame.cpu())
            pbar.update(1)

        output_video = torch.stack(frames, dim=0)
        return (output_video, audio, float(fps))


NODE_CLASS_MAPPINGS = {
    "PixaromaAudioReact": PixaromaAudioReact,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaAudioReact": "Audio React Pixaroma",
}
