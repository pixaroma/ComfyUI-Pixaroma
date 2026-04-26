import os
import sys
import gc
import math

import torch
import torch.nn.functional as F

import comfy.utils
import comfy.model_management
import folder_paths


_MIDAS_CACHE = {}

_MIDAS_WEIGHT_URLS = {
    "MiDaS_small": (
        "midas_v21_small_256.pt",
        "https://github.com/isl-org/MiDaS/releases/download/v2_1/midas_v21_small_256.pt",
    ),
    "DPT_Large": (
        "dpt_large_384.pt",
        "https://github.com/isl-org/MiDaS/releases/download/v3/dpt_large_384.pt",
    ),
    "DPT_Hybrid": (
        "dpt_hybrid_384.pt",
        "https://github.com/isl-org/MiDaS/releases/download/v3/dpt_hybrid_384.pt",
    ),
}


def _midas_install_hint(model_name, hub_dir, original_error):
    """Build a human-readable error explaining how to recover when torch.hub
    can't reach GitHub or the weights download fails."""
    fname, url = _MIDAS_WEIGHT_URLS.get(model_name, ("<unknown>", "<unknown>"))
    checkpoints_dir = os.path.join(hub_dir, "checkpoints")
    repo_dir = os.path.join(hub_dir, "intel-isl_MiDaS_master")
    return (
        f"\n[Pixaroma] Audio Depth — MiDaS '{model_name}' failed to load.\n"
        f"   Reason: {original_error}\n\n"
        f"   Manual install (offline / blocked download):\n"
        f"     1. Download the weights file:\n"
        f"        {url}\n"
        f"     2. Place it here (create the folder if missing):\n"
        f"        {os.path.join(checkpoints_dir, fname)}\n"
        f"     3. If the FIRST run can't clone the MiDaS repo at all, also\n"
        f"        download the source zip from:\n"
        f"        https://github.com/isl-org/MiDaS/archive/refs/heads/master.zip\n"
        f"        and extract it as:\n"
        f"        {repo_dir}\n"
        f"     4. Re-run the workflow.\n"
    )


def _safe_hub_load(repo, model, trust_repo=True):
    """torch.hub.load with comfyui_controlnet_aux's bundled midas package
    hidden so the real intel-isl/MiDaS resolves."""
    original_sys_path = sys.path.copy()
    sys.path = [p for p in sys.path if "comfyui_controlnet_aux" not in p.lower()]
    hidden = {}
    for name in list(sys.modules.keys()):
        if name == "midas" or name.startswith("midas."):
            hidden[name] = sys.modules.pop(name)
    try:
        return torch.hub.load(repo, model, trust_repo=trust_repo)
    finally:
        sys.path = original_sys_path
        for name, mod in hidden.items():
            sys.modules[name] = mod


def _get_midas(model_name, device):
    cached = _MIDAS_CACHE.get(model_name)
    if cached is not None and cached.get("device") == str(device):
        return cached["model"], cached["transform"]

    portable_hub_dir = os.path.join(folder_paths.models_dir, "torch_hub")
    os.makedirs(portable_hub_dir, exist_ok=True)
    torch.hub.set_dir(portable_hub_dir)

    try:
        model = _safe_hub_load("intel-isl/MiDaS", model_name, trust_repo=True)
        model.to(device).eval()
        transforms_mod = _safe_hub_load("intel-isl/MiDaS", "transforms", trust_repo=True)
    except Exception as e:
        msg = _midas_install_hint(model_name, portable_hub_dir, e)
        print(msg)
        raise RuntimeError(msg) from e

    if model_name in ("DPT_Large", "DPT_Hybrid"):
        transform = transforms_mod.dpt_transform
    else:
        transform = transforms_mod.small_transform

    _MIDAS_CACHE[model_name] = {
        "model": model,
        "transform": transform,
        "device": str(device),
    }
    return model, transform


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
                "image": ("IMAGE", {"tooltip": "Source still image to animate."}),
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
                ], {"default": "Original", "tooltip": "Output framing. 'Original' keeps the input image's ratio. Fixed presets crop + resize to that exact size. 'Custom Ratio …' uses custom_width and computes height from the ratio. 'Custom (W & H)' uses both custom_width and custom_height as-is."}),
                "custom_width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8,
                    "tooltip": "Used by 'Custom Ratio …' presets and 'Custom (W & H)'. Ignored by 'Original' and fixed-size presets."}),
                "custom_height": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8,
                    "tooltip": "Used only by 'Custom (Use Width & Height below)'. Other presets compute or ignore it."}),
                "pulse_intensity": ("FLOAT", {"default": 0.8, "min": 0.0, "max": 2.0, "step": 0.05,
                    "tooltip": "How strongly audio amplitude drives motion. 0 = still, 0.8 = default cinematic, 2 = extreme."}),
                "fps": ("INT", {"default": 24, "min": 8, "max": 60, "step": 1,
                    "tooltip": "Output frames per second. Higher = smoother + larger file + longer render time."}),
                "midas_model": (["MiDaS_small", "DPT_Large"], {"default": "MiDaS_small",
                    "tooltip": "Depth estimator. MiDaS_small ≈ 6 GB VRAM, fast. DPT_Large ≈ 10 GB+ VRAM, slower, sharper edges."}),
                "motion_mode": (["radial", "horizontal", "vertical", "combined"], {"default": "radial",
                    "tooltip": "radial = pulsing zoom from center (the original Pixaroma2 effect). horizontal = camera dolly left↔right. vertical = camera bob up↕down. combined = both with 90° phase offset (orbital feel). Sway/bob complete one cycle every 4 seconds."}),
                "depth_contrast": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 3.0, "step": 0.05,
                    "tooltip": "Power curve on the depth map. 1.0 = unchanged. >1 = stronger near/far separation (more dramatic parallax). <1 = flatter, gentler motion."}),
                "depth_invert": ("BOOLEAN", {"default": False,
                    "tooltip": "Flip the depth map (near ↔ far). Use when MiDaS gets it backwards on stylized or unusual images."}),
                "audio_band": (list(_AUDIO_BANDS_HZ.keys()), {"default": "full",
                    "tooltip": "Which frequency band drives the motion envelope. full = whole spectrum (default). bass = drum-driven cinematic feel (20–250 Hz). mids = vocal-driven (250–4000 Hz). treble = cymbals/hi-hats (4000–20000 Hz)."}),
                "loop_safe": ("BOOLEAN", {"default": False,
                    "tooltip": "Ramp motion to zero across the first and last 0.5 s so the rendered clip loops with no visible jump. Slightly reduces motion at the very start and end."}),
            }
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "FLOAT", "IMAGE")
    RETURN_NAMES = ("video_frames", "audio", "fps", "depth_map")
    FUNCTION = "generate"
    CATEGORY = "👑 Pixaroma"

    def _process_aspect(self, image, aspect_ratio, custom_w, custom_h):
        if aspect_ratio == "Original":
            return image

        _, h, w, _ = image.shape
        if aspect_ratio == "Custom (Use Width & Height below)":
            target_w, target_h = custom_w, custom_h
        elif "Custom Ratio" in aspect_ratio:
            target_w = custom_w
            if "16:9" in aspect_ratio:
                target_h = int(target_w * 9 / 16)
            elif "9:16" in aspect_ratio:
                target_h = int(target_w * 16 / 9)
            elif "4:3" in aspect_ratio:
                target_h = int(target_w * 3 / 4)
            elif "1:1" in aspect_ratio:
                target_h = target_w
            else:
                target_h = custom_h
        else:
            dim = aspect_ratio.split(" ")[0]
            target_w, target_h = map(int, dim.split("x"))

        target_w = (target_w // 8) * 8
        target_h = (target_h // 8) * 8

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
        return image

    def _audio_envelope(self, audio, target_frames, fps, device, audio_band):
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

        kernel = torch.ones(1, 1, 3, device=rms.device) / 3.0
        rms_padded = F.pad(rms.unsqueeze(0).unsqueeze(0), (1, 1), mode="replicate")
        rms_smoothed = F.conv1d(rms_padded, kernel).squeeze()
        return rms_smoothed.to(device)

    def generate(self, image, audio, aspect_ratio, custom_width, custom_height,
                 pulse_intensity, fps, midas_model, motion_mode, depth_contrast,
                 depth_invert, audio_band, loop_safe):
        device = comfy.model_management.get_torch_device()

        image = self._process_aspect(image, aspect_ratio, custom_width, custom_height)
        img_tensor = image[0].permute(2, 0, 1).unsqueeze(0).to(device)
        _, _, H, W = img_tensor.shape

        audio_duration = audio["waveform"].shape[-1] / audio["sample_rate"]
        total_frames = int(audio_duration * fps)
        envelope = self._audio_envelope(audio, total_frames, fps, device, audio_band)

        if loop_safe and total_frames > 0:
            fade_n = max(1, min(int(fps * 0.5), total_frames // 2))
            ramp = torch.linspace(0.0, 1.0, fade_n, device=envelope.device)
            envelope = envelope.clone()
            envelope[:fade_n] = envelope[:fade_n] * ramp
            envelope[-fade_n:] = envelope[-fade_n:] * ramp.flip(0)

        midas, transform = _get_midas(midas_model, device)

        with torch.no_grad():
            img_uint8 = (image[0].cpu().numpy() * 255).astype("uint8")
            input_batch = transform(img_uint8).to(device)
            prediction = midas(input_batch)
            prediction = F.interpolate(
                prediction.unsqueeze(1),
                size=(H, W),
                mode="bicubic",
                align_corners=False,
            ).squeeze()

        depth_min, depth_max = prediction.min(), prediction.max()
        depth_map = (prediction - depth_min) / (depth_max - depth_min + 1e-6)
        if depth_invert:
            depth_map = 1.0 - depth_map
        if depth_contrast != 1.0:
            depth_map = depth_map.clamp(min=0.0) ** depth_contrast

        del input_batch, prediction
        comfy.model_management.soft_empty_cache()
        gc.collect()

        y, x = torch.meshgrid(
            torch.linspace(-1, 1, H, device=device),
            torch.linspace(-1, 1, W, device=device),
            indexing="ij",
        )
        base_grid = torch.stack([x, y], dim=-1).unsqueeze(0)

        # Per-frame motion phase for sway / bob modes (one cycle per 4s)
        sway_freq = 0.25
        t = torch.arange(total_frames, device=device, dtype=torch.float32) / fps
        sway = torch.sin(t * 2 * math.pi * sway_freq)
        bob = torch.cos(t * 2 * math.pi * sway_freq)

        print(f"[Pixaroma] Audio Depth: {total_frames} frames @ {fps}fps, "
              f"{W}x{H}, {midas_model}, mode={motion_mode}, band={audio_band}")
        pbar = comfy.utils.ProgressBar(total_frames)

        frames = []
        for i in range(total_frames):
            amp = envelope[i] * pulse_intensity * 0.1
            grid = base_grid.clone()
            if motion_mode == "radial":
                s = depth_map * amp
                grid[..., 0] = grid[..., 0] - (grid[..., 0] * s)
                grid[..., 1] = grid[..., 1] - (grid[..., 1] * s)
            else:
                if motion_mode in ("horizontal", "combined"):
                    grid[..., 0] = grid[..., 0] - depth_map * amp * sway[i]
                if motion_mode in ("vertical", "combined"):
                    grid[..., 1] = grid[..., 1] - depth_map * amp * bob[i]
            warped = F.grid_sample(
                img_tensor, grid,
                mode="bilinear", padding_mode="reflection", align_corners=False,
            )
            frames.append(warped.squeeze(0).permute(1, 2, 0).cpu())
            pbar.update(1)

        output_video = torch.stack(frames, dim=0)
        depth_image = depth_map.detach().unsqueeze(-1).expand(-1, -1, 3).contiguous().unsqueeze(0).cpu()
        return (output_video, audio, float(fps), depth_image)


NODE_CLASS_MAPPINGS = {
    "PixaromaAudioDepth": PixaromaAudioDepth,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaAudioDepth": "Audio Depth Pixaroma",
}
