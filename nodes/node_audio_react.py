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


def _onset_track(envelope, decay=0.85):
    """From a [T] envelope in [0,1], produce a [T] onset/transient track.
    Detects positive spikes (env increases above its 75th percentile by
    >0.05), then exponential-decays between hits. Output in [0, 1]."""
    if envelope.numel() == 0:
        return envelope.clone()
    diff = torch.cat([torch.zeros(1, device=envelope.device), envelope[1:] - envelope[:-1]])
    diff = torch.clamp(diff, min=0.0)
    # Threshold at top quartile of derivative + a small floor so quiet music
    # still produces some onsets.
    thresh = max(0.05, torch.quantile(diff, 0.75).item())
    spikes = (diff > thresh).float() * diff  # keep magnitude on hit frames

    # Exponential decay: onset[t] = max(spikes[t], onset[t-1] * decay)
    out = torch.zeros_like(envelope)
    prev = 0.0
    for i in range(envelope.numel()):
        prev = max(spikes[i].item(), prev * decay)
        out[i] = prev
    out_max = out.max().item()
    if out_max > 0:
        out = out / out_max  # peak-normalize to [0, 1]
    return out


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

    def _process_aspect(self, image, aspect_ratio, custom_w, custom_h, headroom=1.0):
        """Returns (image_at_render_size, base_w, base_h). Caller center-crops
        the warped frames back to base_w × base_h after warping."""
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
        """Returns a [target_frames] tensor in [0, 1] — per-frame audio energy."""
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
        rms_smoothed = F.conv1d(rms_padded, kernel).view(-1)
        return rms_smoothed.to(device)

    def _motion_scale_pulse(self, base_grid, env_t, intensity):
        """Uniform breathing zoom. env_t in [0,1], intensity in [0,2]."""
        s = env_t * intensity * 0.15  # max 30% zoom at intensity=2, env=1
        return base_grid * (1.0 - s)

    def _motion_zoom_punch(self, base_grid, onset_t, intensity):
        """Fast zoom-in spike on each transient, ease back."""
        s = onset_t * intensity * 0.30  # bigger amplitude than scale_pulse
        return base_grid * (1.0 - s)

    def _motion_shake(self, base_grid, i, total_frames, onset, intensity, fps):
        """Translation jitter. Random direction per onset, exponential settle."""
        # Lazily compute (and cache) the dx/dy track on the instance once per
        # call to generate(). i==0 builds it; later calls reuse.
        if (not hasattr(self, "_shake_dx_cache")
                or self._shake_dx_cache.shape[0] != total_frames):
            g = torch.Generator().manual_seed(0)
            dx_raw = torch.randn(total_frames, generator=g) * onset.cpu()
            dy_raw = torch.randn(total_frames, generator=g) * onset.cpu()
            dx = torch.zeros_like(dx_raw)
            dy = torch.zeros_like(dy_raw)
            decay = 0.7
            for k in range(total_frames):
                if k == 0:
                    dx[k] = dx_raw[k]
                    dy[k] = dy_raw[k]
                else:
                    dx[k] = dx[k-1] * decay + dx_raw[k] * (1.0 - decay)
                    dy[k] = dy[k-1] * decay + dy_raw[k] * (1.0 - decay)
            self._shake_dx_cache = dx.to(base_grid.device)
            self._shake_dy_cache = dy.to(base_grid.device)

        amp = intensity * 0.04  # 4% of half-frame at intensity=1, raw=±1
        dx = self._shake_dx_cache[i].item() * amp
        dy = self._shake_dy_cache[i].item() * amp

        grid = base_grid.clone()
        grid[..., 0] = grid[..., 0] - dx
        grid[..., 1] = grid[..., 1] - dy
        return grid

    def _motion_ripple(self, base_grid, t, env_t, intensity, motion_speed, H, W):
        """Concentric radial sine ripple from center."""
        device = base_grid.device
        ys = torch.linspace(-1, 1, H, device=device).unsqueeze(1).expand(H, W)
        xs = torch.linspace(-1, 1, W, device=device).unsqueeze(0).expand(H, W)
        aspect = W / H
        r = torch.sqrt((xs * aspect) ** 2 + ys ** 2)

        k = 6.0 * math.pi
        omega = 2.0 * math.pi * max(motion_speed * 4.0, 0.5)
        # Spec: amplitude is 0.015·min(W,H) px → in normalized [-1,1] grid
        # units (full range = 2 units across the smaller dim) → 0.015 * 2 / 2.
        A = env_t * intensity * 0.015 * 2.0

        dr = A * torch.sin(k * r - omega * t)

        r_safe = r.clamp(min=1e-3)
        dx = dr * (xs * aspect) / r_safe / aspect
        dy = dr * ys / r_safe

        grid = base_grid.clone()
        grid[0, ..., 0] = grid[0, ..., 0] + dx
        grid[0, ..., 1] = grid[0, ..., 1] + dy
        return grid

    def _motion_slit_scan(self, base_grid, t, env_t, intensity, motion_speed, H, W):
        """Vertical wave: each row offsets by sin(k·y_norm + omega·t) · audio.
        Looks like a slit-scan time-displacement without needing a frame
        buffer."""
        device = base_grid.device
        ys = torch.linspace(-1, 1, H, device=device).unsqueeze(1).expand(H, W)
        k = 4.0 * math.pi
        omega = 2.0 * math.pi * max(motion_speed * 2.0, 0.4)
        A = env_t * intensity * 0.04

        dy = A * torch.sin(k * ys - omega * t)
        dx = A * 0.5 * torch.cos(k * ys - omega * t)

        grid = base_grid.clone()
        grid[0, ..., 0] = grid[0, ..., 0] + dx
        grid[0, ..., 1] = grid[0, ..., 1] + dy
        return grid

    def _motion_kaleidoscope(self, base_grid, t, env_t, intensity, motion_speed, H, W):
        """6-segment radial mirror, segment rotation driven by audio + slow
        time advance. Renders best on roughly-square aspects."""
        device = base_grid.device
        segments = 6
        seg_angle = 2.0 * math.pi / segments  # π/3

        ys = base_grid[0, ..., 1]
        xs = base_grid[0, ..., 0]
        aspect = W / H

        x_corr = xs * aspect
        r = torch.sqrt(x_corr ** 2 + ys ** 2)
        theta = torch.atan2(ys, x_corr)

        rot = motion_speed * t * 0.5 + env_t * intensity * seg_angle * 0.5
        theta_shifted = theta - rot

        theta_mod = torch.remainder(theta_shifted, 2.0 * seg_angle)
        mask = theta_mod > seg_angle
        theta_mirror = torch.where(mask, 2.0 * seg_angle - theta_mod, theta_mod)
        theta_final = theta_mirror

        x_new = r * torch.cos(theta_final) / aspect
        y_new = r * torch.sin(theta_final)

        grid = base_grid.clone()
        grid[0, ..., 0] = x_new
        grid[0, ..., 1] = y_new
        grid = grid.clamp(-1.0, 1.0)
        return grid

    def _overlay_glitch(self, frame, onset_t, strength, H, W):
        """RGB shift on transients + scanline swap on big spikes."""
        if onset_t <= 0.001 or strength <= 0:
            return frame
        max_px = max(1, int(onset_t * strength * 0.012 * min(H, W)))
        g = torch.Generator().manual_seed(int(onset_t * 1e6) & 0xFFFF)
        signs = torch.randint(0, 2, (3,), generator=g) * 2 - 1
        offsets = signs * max_px
        out = frame.clone()
        for c in range(3):
            ox = offsets[c].item()
            if ox > 0:
                out[:, ox:, c] = frame[:, :W - ox, c]
                out[:, :ox, c] = frame[:, :ox, c]
            elif ox < 0:
                ox = -ox
                out[:, :W - ox, c] = frame[:, ox:, c]
                out[:, W - ox:, c] = frame[:, W - ox:, c]

        if onset_t * strength > 0.7:
            n_swap = max(1, H // 20)
            row_idx = torch.randint(0, H - 1, (n_swap,), generator=g)
            for ri in row_idx.tolist():
                tmp = out[ri].clone()
                out[ri] = out[ri + 1]
                out[ri + 1] = tmp
        return out

    def _overlay_bloom(self, frame, env_t, strength):
        return frame  # Task 12

    def _overlay_vignette(self, frame, env_t, strength, H, W, device):
        return frame  # Task 13

    def _overlay_hue_shift(self, frame, env_t, strength):
        return frame  # Task 14

    def generate(self, image, audio, aspect_ratio, custom_width, custom_height,
                 motion_mode, intensity, audio_band, motion_speed, smoothing,
                 loop_safe, fps, edge_headroom,
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

        image, out_w, out_h = self._process_aspect(
            image, aspect_ratio, custom_width, custom_height, edge_headroom,
        )
        img_tensor = image[0].permute(2, 0, 1).unsqueeze(0).to(device)
        _, _, H, W = img_tensor.shape

        crop_h_off = max(0, (H - out_h) // 2)
        crop_w_off = max(0, (W - out_w) // 2)
        needs_crop = (H != out_h) or (W != out_w)

        audio_duration = audio["waveform"].shape[-1] / audio["sample_rate"]
        total_frames = int(audio_duration * fps)
        if total_frames <= 0:
            raise ValueError(
                f"Audio is too short to produce any frames at {fps} fps "
                f"(audio_duration={audio_duration:.3f}s)."
            )

        # Clear motion-mode caches that depend on total_frames.
        if hasattr(self, "_shake_dx_cache"):
            del self._shake_dx_cache
            del self._shake_dy_cache

        envelope = self._audio_envelope(audio, total_frames, fps, device, audio_band, smoothing)

        if loop_safe:
            fade_n = max(1, min(int(fps * 0.5), total_frames // 2))
            loop_ramp = torch.linspace(0.0, 1.0, fade_n, device=device)
            envelope = envelope.detach().clone()
            envelope[:fade_n] = envelope[:fade_n] * loop_ramp
            envelope[-fade_n:] = envelope[-fade_n:] * loop_ramp.flip(0)

        onset = _onset_track(envelope)

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

            if motion_mode == "scale_pulse":
                grid = self._motion_scale_pulse(base_grid, env_t, intensity)
            elif motion_mode == "zoom_punch":
                grid = self._motion_zoom_punch(base_grid, onset_t, intensity)
            elif motion_mode == "shake":
                grid = self._motion_shake(base_grid, i, total_frames, onset, intensity, fps)
            elif motion_mode == "ripple":
                grid = self._motion_ripple(base_grid, t_vec[i].item(), env_t, intensity, motion_speed, H, W)
            elif motion_mode == "slit_scan":
                grid = self._motion_slit_scan(base_grid, t_vec[i].item(), env_t, intensity, motion_speed, H, W)
            elif motion_mode == "kaleidoscope":
                grid = self._motion_kaleidoscope(base_grid, t_vec[i].item(), env_t, intensity, motion_speed, H, W)
            else:
                raise ValueError(f"[Pixaroma] Audio React — unhandled motion_mode {motion_mode!r}.")

            warped = F.grid_sample(
                img_tensor, grid,
                mode="bilinear", padding_mode="border", align_corners=False,
            )
            frame = warped.squeeze(0).permute(1, 2, 0)  # [H, W, 3]

            # Overlays (each is a no-op when strength == 0).
            if glitch_strength > 0.0:
                frame = self._overlay_glitch(frame, onset_t, glitch_strength, H, W)
            if bloom_strength > 0.0:
                frame = self._overlay_bloom(frame, env_t, bloom_strength)
            if vignette_strength > 0.0:
                frame = self._overlay_vignette(frame, env_t, vignette_strength, H, W, device)
            if hue_shift_strength > 0.0:
                frame = self._overlay_hue_shift(frame, env_t, hue_shift_strength)

            if needs_crop:
                frame = frame[crop_h_off:crop_h_off + out_h, crop_w_off:crop_w_off + out_w, :]
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
