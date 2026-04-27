# nodes/node_audio_studio.py
"""Audio Studio Pixaroma -- sibling to Audio React Pixaroma.

Same effect math (shared engine in _audio_react_engine.py). Different UX:
a fullscreen browser editor with live WebGL preview replaces the
widgets-only surface. The editor saves config to a hidden `studio_json`
input via Pattern #9 (extension-scope app.graphToPrompt injection) -- JS
side lands in Milestone D.

Source resolution at exec time:
- image: optional upstream IMAGE input. If unwired, loaded from disk at
  input/pixaroma/audio_studio/<node_id>/image.<ext>.
- audio: same dual-source pattern. Disk-stored audio is always WAV
  (browser converts before upload -- see js/audio_studio/audio_analysis.mjs).
"""
from __future__ import annotations

import json
import wave
from pathlib import Path

import numpy as np
import torch
from PIL import Image

import folder_paths

from ._audio_react_engine import (
    generate_video,
    params_from_dict,
    validate_params,
)


PIXAROMA_INPUT_ROOT = Path(folder_paths.get_input_directory()) / "pixaroma"


def _migrate_cfg(cfg: dict) -> dict:
    """Apply schema_version migrations. v1 is the only version at ship --
    this is here so future migrations have an obvious home."""
    version = cfg.get("schema_version", 1)
    # Future: if version < N: ... apply migration ...; version = N
    cfg["schema_version"] = version
    return cfg


def _load_inline_image(rel_path: str) -> torch.Tensor:
    """Load PNG/JPG/WebP from input/pixaroma/audio_studio/... -> IMAGE tensor
    [1, H, W, 3] in [0, 1]."""
    abs_path = PIXAROMA_INPUT_ROOT / rel_path
    if not abs_path.exists():
        raise ValueError(
            f"[Pixaroma] Audio Studio -- inline image missing at {abs_path}. "
            f"Re-open the editor and re-pick the image."
        )
    arr = np.array(Image.open(abs_path).convert("RGB"), dtype=np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


def _load_inline_audio(rel_path: str) -> dict:
    """Load WAV from input/pixaroma/audio_studio/... -> AUDIO dict
    {waveform: [1, C, S], sample_rate: int}.

    WAV-only -- the browser converts other formats (MP3 / OGG / AAC) to WAV
    before upload via the Web Audio API + an inline 16-bit PCM writer.
    Keeps the Python side dependency-free (stdlib `wave` module).
    """
    abs_path = PIXAROMA_INPUT_ROOT / rel_path
    if not abs_path.exists():
        raise ValueError(
            f"[Pixaroma] Audio Studio -- inline audio missing at {abs_path}. "
            f"Re-open the editor and re-pick the audio."
        )
    with wave.open(str(abs_path), "rb") as wf:
        sample_rate = wf.getframerate()
        n_channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)
    if sample_width == 2:
        data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sample_width == 4:
        data = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    elif sample_width == 1:
        data = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise ValueError(
            f"[Pixaroma] Audio Studio -- unsupported WAV sample width "
            f"{sample_width} bytes. Re-encode to 16-bit PCM WAV."
        )
    if n_channels > 1:
        data = data.reshape(-1, n_channels).T  # [C, S]
    else:
        data = data.reshape(1, -1)             # [1, S]
    waveform = torch.from_numpy(data).unsqueeze(0)  # [1, C, S]
    return {"waveform": waveform, "sample_rate": sample_rate}


class PixaromaAudioStudio:
    """Audio-reactive image-to-video, sibling to Audio React Pixaroma.

    No widget UI on the node itself -- config is stored in node.properties
    and surfaced via a fullscreen JS editor (Milestone D+).
    """

    @classmethod
    def INPUT_TYPES(s):
        return {
            "optional": {
                "image": ("IMAGE", {"tooltip": "Optional upstream image. If wired, used as the source. If unwired, the editor's inline-loaded image is used."}),
                "audio": ("AUDIO", {"tooltip": "Optional upstream audio. Same dual-source pattern as image."}),
            },
            "hidden": {
                "studio_json": ("STRING", {"default": "{}"}),
            },
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "FLOAT")
    RETURN_NAMES = ("video_frames", "audio", "fps")
    FUNCTION = "generate"
    CATEGORY = "\U0001f451 Pixaroma"

    def generate(self, studio_json="{}", image=None, audio=None):
        try:
            cfg = json.loads(studio_json or "{}")
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"[Pixaroma] Audio Studio -- could not parse studio_json: {exc}. "
                f"Open the editor and re-save."
            ) from exc
        cfg = _migrate_cfg(cfg)
        params = params_from_dict(cfg)

        # Source resolution: upstream wiring ALWAYS wins when present;
        # inline path is the fallback when nothing is wired. cfg.image_source
        # / cfg.audio_source are preserved for backwards compatibility but
        # do NOT override the wire — matches user mental model that wiring
        # an input means "use this". To use inline only, disconnect the
        # upstream wire.
        if image is None:
            if cfg.get("image_path"):
                image = _load_inline_image(cfg["image_path"])
            else:
                raise ValueError(
                    "[Pixaroma] Audio Studio -- no image source. Wire an "
                    "IMAGE input or open the editor and load an inline image."
                )

        if audio is None:
            if cfg.get("audio_path"):
                audio = _load_inline_audio(cfg["audio_path"])
            else:
                raise ValueError(
                    "[Pixaroma] Audio Studio -- no audio source. Wire an "
                    "AUDIO input or open the editor and load an inline audio."
                )

        for diag in validate_params(params):
            print(f"[Pixaroma] Audio Studio -- {diag}")
        frames = generate_video(image, audio, params)
        return (frames, audio, float(params.fps))


NODE_CLASS_MAPPINGS = {"PixaromaAudioStudio": PixaromaAudioStudio}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaAudioStudio": "Audio Studio Pixaroma"}
