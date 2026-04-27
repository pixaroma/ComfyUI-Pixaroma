# nodes/node_audio_react.py
"""Audio-reactive image-to-video without depth — widgets-only narrow surface.

Effect math lives in nodes/_audio_react_engine.py. This file is a thin
wrapper that surfaces the widget UI and delegates to the engine.
"""
from ._audio_react_engine import (
    ASPECT_OPTIONS,
    AUDIO_BANDS_HZ,
    MOTION_MODES,
    Params,
    generate_video,
    validate_params,
)


# Local list — duplicates MOTION_MODES.keys() in _audio_react_engine.py
# but kept here because ComfyUI's INPUT_TYPES is evaluated at import time
# and we want a stable explicit order for the dropdown.
_MOTION_MODES = list(MOTION_MODES.keys()) or [
    # Fallback for the unlikely case where MOTION_MODES isn't populated yet.
    "scale_pulse", "zoom_punch", "shake", "drift", "rotate_pulse",
    "ripple", "swirl", "slit_scan",
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
                    "tooltip": "Time advance for modes whose motion has its own oscillation independent of the audio (drift, rotate_pulse, ripple, slit_scan). Hz / cycles per second. 0.2 = one full cycle every 5s (default, slow cinematic). 0.5 = 2s. 1.0 = fast pulse. Ignored by scale_pulse / zoom_punch / shake / swirl (those are 100% audio-driven)."}),
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
        params = Params(
            motion_mode=motion_mode, intensity=intensity, audio_band=audio_band,
            motion_speed=motion_speed, smoothing=smoothing, loop_safe=loop_safe,
            fps=fps,
            glitch_strength=glitch_strength, bloom_strength=bloom_strength,
            vignette_strength=vignette_strength, hue_shift_strength=hue_shift_strength,
            aspect_ratio=aspect_ratio,
            custom_width=custom_width, custom_height=custom_height,
        )
        for diag in validate_params(params):
            print(f"[Pixaroma] Audio React — {diag}")
        frames = generate_video(image, audio, params)
        return (frames, audio, float(params.fps))


NODE_CLASS_MAPPINGS = {"PixaromaAudioReact": PixaromaAudioReact}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaAudioReact": "Audio React Pixaroma"}
