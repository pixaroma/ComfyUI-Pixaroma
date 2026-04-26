import gc
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


def _bandpass_fft(waveform, sample_rate, low_hz, high_hz):
    """FFT-based bandpass on the last dim. waveform: [..., samples]."""
    n = waveform.shape[-1]
    spec = torch.fft.rfft(waveform, dim=-1)
    freqs = torch.fft.rfftfreq(n, d=1.0 / sample_rate, device=waveform.device)
    mask = torch.ones_like(freqs)
    if low_hz is not None:
        mask = mask * (freqs >= low_hz).float()
    if high_hz is not None:
        mask = mask * (freqs <= high_hz).float()
    spec = spec * mask
    return torch.fft.irfft(spec, n=n, dim=-1)


class PixaromaAudioDepth:
    """Audio-reactive depth parallax: animates a still image with motion
    that pulses to the audio waveform. Outputs frames + audio + fps."""

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Source still image to animate (the actual pixels that get warped). Wire Depth Map Pixaroma's image output here for a clean two-wire setup."}),
                "depth_map": ("IMAGE", {"tooltip": "Depth map driving the parallax. Wire Depth Map Pixaroma's depth_map output here, or feed any grayscale IMAGE where white = near and black = far. Resized to match the render dimensions automatically."}),
                "audio": ("AUDIO", {"tooltip": "Driver audio. Clip length = audio_duration × fps."}),
                "aspect_ratio": ([
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
                ], {"default": "Original", "tooltip": "Output framing. 'Original' keeps the input image's ratio. Fixed presets crop + resize to that exact size. 'Custom Ratio …' uses custom_width and computes height from the ratio. 'Custom (W & H)' uses both custom_width and custom_height as-is. 2K / 4K need a lot of VRAM — drop the depth_model in Depth Map Pixaroma to a smaller variant if you OOM."}),
                "custom_width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8,
                    "tooltip": "Used by 'Custom Ratio …' presets and 'Custom (W & H)'. Ignored by 'Original' and fixed-size presets."}),
                "custom_height": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8,
                    "tooltip": "Used only by 'Custom (Use Width & Height below)'. Other presets compute or ignore it."}),
                "pulse_intensity": ("FLOAT", {"default": 0.8, "min": 0.0, "max": 2.0, "step": 0.05,
                    "tooltip": "How strongly audio amplitude drives motion. 0 = still, 0.8 = default cinematic, 2 = extreme."}),
                "fps": ("INT", {"default": 24, "min": 8, "max": 60, "step": 1,
                    "tooltip": "Output frames per second. Higher = smoother + larger file + longer render time."}),
                "motion_mode": ([
                    "radial",
                    "horizontal",
                    "vertical",
                    "combined",
                    "diagonal",
                    "figure_8",
                    "zoom_breath",
                ], {"default": "radial",
                    "tooltip": (
                        "radial = pulsing zoom inward from center (default — the original Pixaroma2 effect).\n"
                        "horizontal = camera dolly left↔right (cinematic Ken Burns).\n"
                        "vertical = camera bob up↕down.\n"
                        "combined = horizontal + vertical with 90° phase offset (circular / orbital feel).\n"
                        "diagonal = sway along a 45° NW↔SE axis (different from horizontal/vertical).\n"
                        "figure_8 = Lissajous figure-8 path (sin(t) on x, sin(2t) on y) — organic, surreal.\n"
                        "zoom_breath = slow zoom in→out cycle following motion_speed (distinct from beat-driven radial — feels like breathing)."
                    )}),
                "audio_band": (list(_AUDIO_BANDS_HZ.keys()), {"default": "full",
                    "tooltip": "Which frequency band drives the motion envelope. full = whole spectrum (default — works on any audio). bass = drum-driven cinematic feel (20–250 Hz, best for music). mids = vocal-driven (250–4000 Hz). treble = cymbals/hi-hats (4000–20000 Hz)."}),
                "loop_safe": ("BOOLEAN", {"default": False,
                    "tooltip": "Ramp motion to zero across the first and last 0.5 s so the rendered clip loops with no visible jump. Slightly reduces motion at the very start and end."}),
                "motion_speed": ("FLOAT", {"default": 0.2, "min": 0.05, "max": 1.0, "step": 0.05,
                    "tooltip": "Sway/bob frequency in Hz (cycles per second). 0.2 = one full cycle every 5 s (default, slow cinematic). 0.5 = 2 s. 1.0 = fast pulse. Only affects horizontal/vertical/combined modes — radial ignores this."}),
                "base_motion": ("FLOAT", {"default": 0.15, "min": 0.0, "max": 0.5, "step": 0.01,
                    "tooltip": "Always-on motion floor (0–0.5). 0.15 = default — gentle camera drift even at silence (mimics cinematic camera moves that never fully stop). 0 = motion fully gated by audio (silence = freeze)."}),
                "smoothing": ("INT", {"default": 5, "min": 1, "max": 15, "step": 1,
                    "tooltip": "Audio envelope moving-average window in frames. 5 = default — balanced. 1 = punchy, reacts to every transient (good for beats). 8–15 = fluid, slow camera response (cinematic)."}),
                "camera_shake": ("FLOAT", {"default": 0.2, "min": 0.0, "max": 0.5, "step": 0.01,
                    "tooltip": "Slow handheld camera drift independent of audio (~1 anchor/sec, cosine-interpolated for smooth motion). 0 = off. 0.1 = subtle drift. 0.2 = noticeable handheld feel (default). 0.5 = strong drift. Deterministic (same input = same shake)."}),
                "edge_headroom": ("FLOAT", {"default": 1.05, "min": 1.0, "max": 1.3, "step": 0.01,
                    "tooltip": "Render at slightly larger dimensions then center-crop back, giving motion a safety zone outside the visible frame. 1.0 = no headroom (motion can clip subjects at edges). 1.05 = 5% margin (default, kills most clipping at imperceptible cost). 1.2 = wide margin for very strong motion. Higher = more VRAM."}),
            }
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "FLOAT")
    RETURN_NAMES = ("video_frames", "audio", "fps")
    FUNCTION = "generate"
    CATEGORY = "👑 Pixaroma"

    def _process_aspect(self, image, aspect_ratio, custom_w, custom_h, headroom=1.0):
        """Returns (image_at_render_size, base_w, base_h).
        `image_at_render_size` is sized to base_w*headroom × base_h*headroom
        (snapped to multiples of 8). Caller should center-crop the warped
        frames back to base_w × base_h for the final output."""
        _, h, w, _ = image.shape

        if aspect_ratio == "Original":
            base_w, base_h = w, h
        elif aspect_ratio == "Custom (Use Width & Height below)":
            base_w, base_h = custom_w, custom_h
        elif "Custom Ratio" in aspect_ratio:
            base_w = custom_w
            if "16:9" in aspect_ratio:
                base_h = int(base_w * 9 / 16)
            elif "9:16" in aspect_ratio:
                base_h = int(base_w * 16 / 9)
            elif "4:3" in aspect_ratio:
                base_h = int(base_w * 3 / 4)
            elif "1:1" in aspect_ratio:
                base_h = base_w
            else:
                base_h = custom_h
        else:
            dim = aspect_ratio.split(" ")[0]
            base_w, base_h = map(int, dim.split("x"))

        base_w = (base_w // 8) * 8
        base_h = (base_h // 8) * 8

        if headroom > 1.0:
            target_w = ((int(base_w * headroom) + 7) // 8) * 8
            target_h = ((int(base_h * headroom) + 7) // 8) * 8
        else:
            target_w, target_h = base_w, base_h

        # Original + no headroom = pass image through untouched
        if aspect_ratio == "Original" and headroom <= 1.0:
            return image, base_w, base_h

        target_ratio = target_w / target_h
        current_ratio = w / h
        if current_ratio > target_ratio:
            new_w = int(h * target_ratio)
            left = (w - new_w) // 2
            image = image[:, :, left:left + new_w, :]
        elif current_ratio < target_ratio:
            new_h = int(w / target_ratio)
            top = (h - new_h) // 2
            image = image[:, top:top + new_h, :, :]

        image = image.permute(0, 3, 1, 2)
        image = F.interpolate(image, size=(target_h, target_w), mode="bilinear", align_corners=False)
        image = image.permute(0, 2, 3, 1)
        return image, base_w, base_h

    def _audio_envelope(self, audio, target_frames, fps, device, audio_band, smoothing):
        waveform = audio["waveform"]
        sample_rate = audio["sample_rate"]
        if waveform.shape[1] > 1:
            waveform = waveform.mean(dim=1, keepdim=True)

        if audio_band != "full":
            low_hz, high_hz = _AUDIO_BANDS_HZ[audio_band]
            waveform = _bandpass_fft(waveform, sample_rate, low_hz, high_hz)

        total_samples = waveform.shape[-1]
        samples_per_frame = sample_rate // fps
        required_samples = target_frames * samples_per_frame
        if total_samples < required_samples:
            repeats = math.ceil(required_samples / total_samples)
            waveform = waveform.repeat(1, 1, repeats)
        waveform = waveform[:, :, :required_samples]
        waveform = waveform.view(-1, samples_per_frame)

        rms = torch.sqrt(torch.mean(waveform ** 2, dim=1))
        rms_min, rms_max = rms.min(), rms.max()
        if rms_max > rms_min:
            rms = (rms - rms_min) / (rms_max - rms_min)
        else:
            rms = torch.zeros_like(rms)

        sw = max(1, int(smoothing))
        if sw % 2 == 0:
            sw += 1
        if sw == 1:
            return rms.to(device)
        pad = sw // 2
        kernel = torch.ones(1, 1, sw, device=rms.device) / sw
        rms_padded = F.pad(rms.unsqueeze(0).unsqueeze(0), (pad, pad), mode="replicate")
        rms_smoothed = F.conv1d(rms_padded, kernel).squeeze()
        return rms_smoothed.to(device)

    def generate(self, image, depth_map, audio, aspect_ratio, custom_width, custom_height,
                 pulse_intensity, fps, motion_mode, audio_band, loop_safe,
                 motion_speed, base_motion, smoothing, camera_shake,
                 edge_headroom):
        device = comfy.model_management.get_torch_device()

        image, out_w, out_h = self._process_aspect(
            image, aspect_ratio, custom_width, custom_height, edge_headroom,
        )
        img_tensor = image[0].permute(2, 0, 1).unsqueeze(0).to(device)
        _, _, H, W = img_tensor.shape

        # Where to center-crop the rendered (H, W) frames back to (out_h, out_w).
        crop_h_off = max(0, (H - out_h) // 2)
        crop_w_off = max(0, (W - out_w) // 2)
        needs_crop = (H != out_h) or (W != out_w)

        audio_duration = audio["waveform"].shape[-1] / audio["sample_rate"]
        total_frames = int(audio_duration * fps)
        if total_frames <= 0:
            raise ValueError(
                f"Audio is too short to produce any frames at {fps} fps "
                f"(audio_duration={audio_duration:.3f}s, need at least 1/{fps}s)."
            )
        envelope = self._audio_envelope(audio, total_frames, fps, device, audio_band, smoothing)

        # base_motion BEFORE loop_safe so the ramp can pull the floor down to
        # true zero at the loop boundaries (otherwise envelope[0] ends up at
        # `base_motion` and the loop has a visible jump).
        if base_motion > 0.0:
            envelope = base_motion + envelope * (1.0 - base_motion)

        # Reused below for camera_shake when loop_safe is on, so build it once.
        # Pin to `device` explicitly so the shake-side multiply doesn't depend
        # on envelope.device matching the compute device.
        loop_ramp = None
        if loop_safe:
            fade_n = max(1, min(int(fps * 0.5), total_frames // 2))
            loop_ramp = torch.linspace(0.0, 1.0, fade_n, device=device)
            envelope = envelope.detach().clone()
            envelope[:fade_n] = envelope[:fade_n] * loop_ramp
            envelope[-fade_n:] = envelope[-fade_n:] * loop_ramp.flip(0)

        # Convert input depth_map IMAGE [B, H_d, W_d, 3] to a 2D tensor [H, W]
        # at the render resolution. Average channels in case the user supplied
        # a colored image (e.g. hand-edited overlays); renormalize so any
        # post-edit value range works as long as white = near, black = far.
        depth_2d = depth_map[0].mean(dim=-1).to(device)
        if depth_2d.shape != (H, W):
            depth_2d = F.interpolate(
                depth_2d.unsqueeze(0).unsqueeze(0),
                size=(H, W),
                mode="bicubic",
                align_corners=False,
            ).squeeze(0).squeeze(0)
        d_min, d_max = depth_2d.min(), depth_2d.max()
        depth_map_2d = (depth_2d - d_min) / (d_max - d_min + 1e-6)

        comfy.model_management.soft_empty_cache()
        gc.collect()

        y, x = torch.meshgrid(
            torch.linspace(-1, 1, H, device=device),
            torch.linspace(-1, 1, W, device=device),
            indexing="ij",
        )
        base_grid = torch.stack([x, y], dim=-1).unsqueeze(0)

        # Per-frame motion phase for sway / bob / figure-8 modes.
        # `sway`, `bob` cycle at motion_speed Hz (sin/cos pair). `fig8_y`
        # runs at 2× for the classic figure-8 Lissajous (x=sin(t), y=sin(2t)).
        t = torch.arange(total_frames, device=device, dtype=torch.float32) / fps
        sway = torch.sin(t * 2 * math.pi * motion_speed)
        bob = torch.cos(t * 2 * math.pi * motion_speed)
        fig8_y = torch.sin(t * 4 * math.pi * motion_speed)

        # Camera shake: slow drift via random anchors (1 per second) with cosine
        # interpolation. Deterministic (seed=0), independent of audio.
        if camera_shake > 0.0 and total_frames > 0:
            n_anchors = max(2, int(audio_duration) + 2)
            g = torch.Generator().manual_seed(0)
            anchors_x = torch.randn(n_anchors, generator=g) * camera_shake * 0.05
            anchors_y = torch.randn(n_anchors, generator=g) * camera_shake * 0.05
            t_pos = torch.linspace(0, n_anchors - 1, total_frames)
            i_low = t_pos.long().clamp(max=n_anchors - 2)
            i_high = i_low + 1
            frac = t_pos - i_low.float()
            frac_smooth = (1.0 - torch.cos(frac * math.pi)) * 0.5
            shake_x = (anchors_x[i_low] * (1.0 - frac_smooth) + anchors_x[i_high] * frac_smooth).to(device)
            shake_y = (anchors_y[i_low] * (1.0 - frac_smooth) + anchors_y[i_high] * frac_smooth).to(device)
            # Apply the same loop-safe fade so shake also collapses to zero at
            # both ends — otherwise the random anchors at frame 0 vs N-1 don't
            # match and the loop has a visible jolt.
            if loop_ramp is not None:
                fade_n = loop_ramp.shape[0]
                shake_x[:fade_n] = shake_x[:fade_n] * loop_ramp
                shake_x[-fade_n:] = shake_x[-fade_n:] * loop_ramp.flip(0)
                shake_y[:fade_n] = shake_y[:fade_n] * loop_ramp
                shake_y[-fade_n:] = shake_y[-fade_n:] * loop_ramp.flip(0)
        else:
            shake_x = torch.zeros(total_frames, device=device)
            shake_y = torch.zeros(total_frames, device=device)

        print(f"[Pixaroma] Audio Depth: {total_frames} frames @ {fps}fps, "
              f"{W}x{H}, mode={motion_mode}, band={audio_band}, "
              f"speed={motion_speed}Hz, base={base_motion}, "
              f"smooth={smoothing}, shake={camera_shake}")
        pbar = comfy.utils.ProgressBar(total_frames)

        frames = []
        for i in range(total_frames):
            amp = envelope[i] * pulse_intensity * 0.1
            grid = base_grid.clone()
            if motion_mode == "radial":
                s = depth_map_2d * amp
                grid[..., 0] = grid[..., 0] - (grid[..., 0] * s)
                grid[..., 1] = grid[..., 1] - (grid[..., 1] * s)
            elif motion_mode == "zoom_breath":
                # signed amp via sway sign — alternates zoom in / zoom out
                s = depth_map_2d * amp * sway[i]
                grid[..., 0] = grid[..., 0] - (grid[..., 0] * s)
                grid[..., 1] = grid[..., 1] - (grid[..., 1] * s)
            elif motion_mode == "diagonal":
                shift = depth_map_2d * amp * sway[i]
                grid[..., 0] = grid[..., 0] - shift
                grid[..., 1] = grid[..., 1] - shift
            elif motion_mode == "figure_8":
                grid[..., 0] = grid[..., 0] - depth_map_2d * amp * sway[i]
                grid[..., 1] = grid[..., 1] - depth_map_2d * amp * fig8_y[i]
            else:
                if motion_mode in ("horizontal", "combined"):
                    grid[..., 0] = grid[..., 0] - depth_map_2d * amp * sway[i]
                if motion_mode in ("vertical", "combined"):
                    grid[..., 1] = grid[..., 1] - depth_map_2d * amp * bob[i]
            if camera_shake > 0.0:
                grid[..., 0] = grid[..., 0] - shake_x[i]
                grid[..., 1] = grid[..., 1] - shake_y[i]
            warped = F.grid_sample(
                img_tensor, grid,
                mode="bilinear", padding_mode="border", align_corners=False,
            )
            frame = warped.squeeze(0).permute(1, 2, 0)
            if needs_crop:
                frame = frame[crop_h_off:crop_h_off + out_h, crop_w_off:crop_w_off + out_w, :]
            frames.append(frame.cpu())
            pbar.update(1)

        output_video = torch.stack(frames, dim=0)
        return (output_video, audio, float(fps))


NODE_CLASS_MAPPINGS = {
    "PixaromaAudioDepth": PixaromaAudioDepth,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaAudioDepth": "Audio Depth Pixaroma",
}
