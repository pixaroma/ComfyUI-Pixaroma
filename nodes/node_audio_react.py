# nodes/node_audio_react.py
import math

import torch
import torch.nn.functional as F

import comfy.utils
import comfy.model_management


_AUDIO_BANDS_HZ = {
    "full":   (None, None),
    "bass":   (20, 250),
    "mids":   (250, 4000),
    "treble": (4000, 20000),
}

_ASPECT_OPTIONS = [
    "Original",
    "Custom (Use Width & Height below)",
    "Custom Ratio 16:9 (Uses Width)",
    "Custom Ratio 9:16 (Uses Width)",
    "Custom Ratio 4:3 (Uses Width)",
    "Custom Ratio 1:1 (Uses Width)",
    "512x512 (Square)",
    "768x512 (Landscape)",
    "512x768 (Portrait)",
    "832x480 (Landscape)",
    "480x832 (Portrait)",
    "1024x576 (Landscape 16:9)",
    "576x1024 (Portrait 9:16)",
    "1280x720 (Landscape HD)",
    "720x1280 (Portrait HD)",
    "1920x1080 (Landscape FHD)",
    "1080x1920 (Portrait FHD)",
    "2560x1440 (Landscape 2K)",
    "1440x2560 (Portrait 2K)",
    "3840x2160 (Landscape 4K)",
    "2160x3840 (Portrait 4K)",
]

_MOTION_MODES = [
    "scale_pulse",
    "zoom_punch",
    "shake",
    "ripple",
    "slit_scan",
    "kaleidoscope",
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
                "aspect_ratio": (_ASPECT_OPTIONS, {"default": "Original",
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
                        "ripple = concentric ripples expand from center on each beat. Electronic / ambient.\n"
                        "slit_scan = rows time-displaced by audio envelope. Distinctive, modern, experimental.\n"
                        "kaleidoscope = radial 6-segment mirror; segment rotation reactive to audio. Club / abstract."
                    )}),
                "intensity": ("FLOAT", {"default": 0.8, "min": 0.0, "max": 2.0, "step": 0.05,
                    "tooltip": "Master strength. 0 = still, 0.8 = default (cinematic), 2 = extreme."}),
                "audio_band": (list(_AUDIO_BANDS_HZ.keys()), {"default": "full",
                    "tooltip": "Frequency band that drives the motion envelope. full = whole spectrum (default). bass = drum-driven (20–250 Hz). mids = vocal-driven (250–4000 Hz). treble = cymbals/hi-hats (4000–20000 Hz)."}),
                "motion_speed": ("FLOAT", {"default": 0.2, "min": 0.05, "max": 1.0, "step": 0.05,
                    "tooltip": "Base oscillation frequency in Hz for modes that need it (ripple, kaleidoscope, slit_scan). 0.2 = one cycle every 5s (cinematic)."}),
                "smoothing": ("INT", {"default": 5, "min": 1, "max": 15, "step": 1,
                    "tooltip": "Audio envelope moving-average window in frames. 1 = punchy. 5 = balanced default. 8–15 = fluid / cinematic."}),
                "loop_safe": ("BOOLEAN", {"default": True,
                    "tooltip": "Ramp the first and last 0.5s of motion to zero so the clip loops with no visible jump. Default ON."}),
                "fps": ("INT", {"default": 24, "min": 8, "max": 60, "step": 1,
                    "tooltip": "Output frames per second."}),
                "edge_headroom": ("FLOAT", {"default": 1.05, "min": 1.0, "max": 1.3, "step": 0.01,
                    "tooltip": "Render slightly larger then center-crop, giving motion a safety zone. 1.0 = none. 1.05 = default (kills edge-clipping). 1.2 = wide margin for strong motion."}),
                "glitch_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05,
                    "tooltip": "RGB-channel offset spikes on transients + occasional scanline tear. 0 = off."}),
                "bloom_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05,
                    "tooltip": "Gaussian glow that pulses with bass. 0 = off."}),
                "vignette_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05,
                    "tooltip": "Edges darken in pulses with audio. 0 = off."}),
                "hue_shift_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05,
                    "tooltip": "Color rotation cycles with audio amplitude. 0 = off."}),
            }
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "FLOAT")
    RETURN_NAMES = ("video_frames", "audio", "fps")
    FUNCTION = "generate"
    CATEGORY = "👑 Pixaroma"

    def generate(self, image, audio, aspect_ratio, custom_width, custom_height,
                 motion_mode, intensity, audio_band, motion_speed, smoothing,
                 loop_safe, fps, edge_headroom,
                 glitch_strength, bloom_strength, vignette_strength, hue_shift_strength):
        # STUB: passthrough one frame, ignore everything else for now.
        # Each subsequent task fleshes this out.
        return (image, audio, float(fps))


NODE_CLASS_MAPPINGS = {
    "PixaromaAudioReact": PixaromaAudioReact,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaAudioReact": "Audio React Pixaroma",
}
