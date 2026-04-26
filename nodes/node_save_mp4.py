import os
import sys
import uuid
import wave
import shutil
import subprocess
import threading

import numpy as np
import torch

import folder_paths
import comfy.model_management


def _resolve_ffmpeg():
    """Locate the ffmpeg binary. Prefer imageio-ffmpeg's bundled exe (already
    on disk if comfyui-videohelpersuite or imageio is installed), then fall
    back to ffmpeg on PATH."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    on_path = shutil.which("ffmpeg")
    if on_path:
        return on_path
    raise RuntimeError(
        "[Pixaroma] Save Mp4 — ffmpeg binary not found.\n"
        "   Install one of:\n"
        "     pip install imageio-ffmpeg     (recommended, no system install)\n"
        "     https://ffmpeg.org/download.html  (system-wide)\n"
    )


def _write_wav_pcm16(path, waveform, sample_rate):
    """Write a Comfy AUDIO waveform tensor [C, samples] (or [B, C, samples])
    as 16-bit PCM WAV using only stdlib + numpy. Avoids torchaudio backend
    issues on Windows."""
    if waveform.dim() == 3:
        waveform = waveform[0]
    n_ch = int(waveform.shape[0])
    if n_ch == 0:
        raise ValueError("[Pixaroma] Save Mp4 — audio waveform has 0 channels.")
    samples = waveform.detach().cpu().numpy()
    samples = np.clip(samples, -1.0, 1.0)
    samples = (samples * 32767.0).astype(np.int16)
    interleaved = samples.T.tobytes()
    with wave.open(path, "wb") as f:
        f.setnchannels(n_ch)
        f.setsampwidth(2)
        f.setframerate(int(sample_rate))
        f.writeframes(interleaved)


class PixaromaSaveMp4:
    """Encode an IMAGE batch (and optional AUDIO) to a single H.264 mp4 in
    ComfyUI's output/ folder. No conflict with VHS Video Combine — separate
    class, separate category, fewer knobs, opinionated defaults."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "Frame batch to encode (output of Audio Depth Pixaroma or any IMAGE source)."}),
                "fps": ("INT", {"default": 24, "min": 1, "max": 120, "step": 1,
                    "tooltip": "Output frame rate. Should match what produced the frames (Audio Depth Pixaroma's fps output)."}),
                "filename_prefix": ("STRING", {"default": "AudioDepth",
                    "tooltip": "Filename stem. The node appends a 5-digit counter and .mp4 (e.g. AudioDepth_00001.mp4). Saved into ComfyUI's output/ folder."}),
                "crf": ("INT", {"default": 19, "min": 14, "max": 30, "step": 1,
                    "tooltip": "H.264 quality (Constant Rate Factor). Lower = better quality + larger file. 14 = visually lossless. 19 = high quality (default). 23 = web default. 28 = small file, visible artifacts."}),
                "pix_fmt": (["yuv420p", "yuv444p"], {"default": "yuv420p",
                    "tooltip": "Pixel format. yuv420p = max compatibility (web, social, mobile — default). yuv444p = no chroma subsampling, sharper colour but won't play in browsers / many players."}),
                "trim_to_audio": ("BOOLEAN", {"default": True,
                    "tooltip": "When audio is connected, end the video at the audio's length (uses ffmpeg -shortest). Off = keep all video frames even if longer than audio."}),
                "pingpong": ("BOOLEAN", {"default": False,
                    "tooltip": "Append the frames in reverse to make a seamless A→B→A loop. Doubles the rendered length (minus one frame at each end)."}),
            },
            "optional": {
                "audio": ("AUDIO", {"tooltip": "Optional audio track to mux into the mp4 as AAC 192k. Connect Audio Depth Pixaroma's audio output here."}),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma"

    def save(self, images, fps, filename_prefix, crf, pix_fmt,
             trim_to_audio, pingpong, audio=None):
        if images is None or images.shape[0] == 0:
            raise ValueError("[Pixaroma] Save Mp4 — input image batch is empty.")

        ffmpeg_path = _resolve_ffmpeg()

        # Pingpong: append reversed frames excluding the duplicates at each end
        # so playback looks like A→B→A with no visible repeated frame.
        if pingpong and images.shape[0] > 2:
            # indices N-2..1 — excludes both endpoints to avoid duplicate-frame stutter
            reversed_tail = images[-2:0:-1]
            frames = torch.cat([images, reversed_tail], dim=0)
        else:
            if pingpong:
                print(f"[Pixaroma] Save Mp4 — pingpong skipped: need >2 frames, got {images.shape[0]}.")
            frames = images

        n_frames, H, W, _ = frames.shape

        # yuv420p requires even dimensions; surface a clear error rather than
        # the opaque "height not divisible by 2" ffmpeg crash.
        if pix_fmt == "yuv420p" and (W % 2 != 0 or H % 2 != 0):
            raise ValueError(
                f"[Pixaroma] Save Mp4 — pix_fmt yuv420p requires even width and "
                f"height, got {W}x{H}. Switch pix_fmt to yuv444p, or resize the "
                f"input frames to even dimensions."
            )

        # Resolve output path with auto-incrementing counter (matches Comfy
        # convention used by SaveImage / Preview Image Pixaroma).
        out_dir = folder_paths.get_output_directory()
        full_folder, fname, counter, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, out_dir, W, H,
        )
        os.makedirs(full_folder, exist_ok=True)
        out_filename = f"{fname}_{counter:05d}.mp4"
        out_path = os.path.join(full_folder, out_filename)

        # If audio is supplied, write it to a temp wav alongside so ffmpeg can
        # mux both inputs in a single pass.
        temp_audio_path = None
        if audio is not None and audio.get("waveform") is not None and audio["waveform"].numel() > 0:
            temp_audio_path = os.path.join(
                folder_paths.get_temp_directory(),
                f"pixaroma_save_mp4_{uuid.uuid4().hex}.wav",
            )
            os.makedirs(os.path.dirname(temp_audio_path), exist_ok=True)
            _write_wav_pcm16(temp_audio_path, audio["waveform"], audio["sample_rate"])

        # Build ffmpeg command. Frames piped on stdin as raw RGB24.
        cmd = [
            ffmpeg_path, "-y",
            "-loglevel", "error",
            "-f", "rawvideo",
            "-vcodec", "rawvideo",
            "-pix_fmt", "rgb24",
            "-s", f"{W}x{H}",
            "-r", str(int(fps)),
            "-i", "-",
        ]
        if temp_audio_path is not None:
            cmd += ["-i", temp_audio_path]
        cmd += [
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", str(int(crf)),
            "-pix_fmt", pix_fmt,
        ]
        if temp_audio_path is not None:
            cmd += ["-c:a", "aac", "-b:a", "192k"]
            if trim_to_audio:
                cmd += ["-shortest"]
        cmd += [out_path]

        print(f"[Pixaroma] Save Mp4 — writing {n_frames} frames @ {fps}fps "
              f"({W}x{H}, crf={crf}, {pix_fmt}"
              f"{', +audio' if temp_audio_path else ''}"
              f"{', pingpong' if pingpong else ''}) -> {out_filename}")

        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
        )

        # Drain stderr in a background thread. Otherwise the OS pipe buffer
        # (4 KB on Windows) fills if ffmpeg emits any output and the next
        # stdin.write() blocks forever.
        stderr_chunks = []

        def _drain(pipe):
            try:
                for chunk in iter(lambda: pipe.read(4096), b""):
                    stderr_chunks.append(chunk)
            except Exception:
                pass

        drain_thread = threading.Thread(target=_drain, args=(proc.stderr,), daemon=True)
        drain_thread.start()

        try:
            for i in range(n_frames):
                comfy.model_management.throw_exception_if_processing_interrupted()
                frame_u8 = (frames[i].clamp(0.0, 1.0).cpu().numpy() * 255.0
                            ).astype(np.uint8)
                proc.stdin.write(frame_u8.tobytes())
            proc.stdin.close()
            proc.wait()
            drain_thread.join()
            if proc.returncode != 0:
                stderr = b"".join(stderr_chunks).decode("utf-8", errors="replace")
                raise RuntimeError(
                    f"[Pixaroma] Save Mp4 — ffmpeg failed (exit {proc.returncode}):\n"
                    f"{stderr}"
                )
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            if temp_audio_path is not None and os.path.exists(temp_audio_path):
                try:
                    os.remove(temp_audio_path)
                except OSError:
                    pass

        print(f"[Pixaroma] Save Mp4 — saved {out_path}")

        # Return as a UI image-style entry so the saved file shows up in the
        # workflow's output panel. Comfy's frontend handles mp4 type.
        return {
            "ui": {
                "images": [
                    {"filename": out_filename, "subfolder": subfolder, "type": "output"}
                ]
            }
        }


NODE_CLASS_MAPPINGS = {
    "PixaromaSaveMp4": PixaromaSaveMp4,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaSaveMp4": "Save Mp4 Pixaroma",
}
