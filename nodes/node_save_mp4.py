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


_COUNTER_LOCK = threading.Lock()


def _next_mp4_counter(folder, prefix):
    """Find the next free counter N for `<folder>/<prefix>_<N:05d>.mp4`.
    folder_paths.get_save_image_path's built-in counter assumes Comfy's
    `<prefix>_<N>_.<ext>` pattern (note the trailing underscore) and parses
    `int("00001.mp4")` for our cleaner `<prefix>_<N>.mp4` — which raises and
    silently returns 1, so every save overwrites Video_00001.mp4. We scan
    ourselves instead."""
    if not os.path.isdir(folder):
        return 1
    pat = prefix + "_"
    max_n = 0
    for f in os.listdir(folder):
        if not f.startswith(pat) or not f.endswith(".mp4"):
            continue
        middle = f[len(pat):-len(".mp4")]
        try:
            n = int(middle)
        except ValueError:
            continue
        if n > max_n:
            max_n = n
    return max_n + 1


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

    # Hardcoded encoder defaults — exposed as widgets earlier, removed for a
    # cleaner UI. Bring them back to INPUT_TYPES if a workflow needs control.
    _CRF = 19
    _PIX_FMT = "yuv420p"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_frames": ("IMAGE", {"tooltip": "Frame batch to encode. Wire Audio React Pixaroma's video_frames output here."}),
                "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 120.0, "step": 1.0,
                    "tooltip": "Output frame rate. Wire Audio React Pixaroma's fps output here so it always matches what produced the frames."}),
                "filename_prefix": ("STRING", {"default": "Video",
                    "tooltip": "Filename stem. The node appends a 5-digit counter and .mp4 (e.g. Video_00001.mp4). Saved into ComfyUI's output/ folder."}),
                "trim_to_audio": ("BOOLEAN", {"default": True,
                    "tooltip": "When audio is connected, end the video at the audio's length (uses ffmpeg -shortest). Off = keep all video frames even if longer than audio."}),
            },
            "optional": {
                "audio": ("AUDIO", {"tooltip": "Optional audio track to mux into the mp4 as AAC 192k. Connect Audio React Pixaroma's audio output here."}),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma"

    def save(self, video_frames, fps, filename_prefix, trim_to_audio, audio=None):
        if video_frames is None or video_frames.shape[0] == 0:
            raise ValueError("[Pixaroma] Save Mp4 — input video_frames batch is empty.")

        ffmpeg_path = _resolve_ffmpeg()
        crf = self._CRF
        pix_fmt = self._PIX_FMT
        fps_int = max(1, int(round(float(fps))))

        frames = video_frames
        n_frames, H, W, _ = frames.shape

        # yuv420p requires even dimensions; surface a clear error rather than
        # the opaque "height not divisible by 2" ffmpeg crash.
        if pix_fmt == "yuv420p" and (W % 2 != 0 or H % 2 != 0):
            raise ValueError(
                f"[Pixaroma] Save Mp4 — encoder requires even width and "
                f"height, got {W}x{H}. Resize input frames to even dimensions "
                f"(Audio React Pixaroma snaps to multiples of 8 automatically)."
            )

        # Resolve subfolder + base filename via folder_paths (handles
        # filename_prefix that contains a subfolder like "videos/clip"); use
        # our own counter scan because Comfy's built-in one assumes the
        # `<prefix>_<N>_.<ext>` trailing-underscore convention and silently
        # returns 1 for our cleaner `<prefix>_<N>.mp4` naming.
        out_dir = folder_paths.get_output_directory()
        full_folder, fname, _ignored, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, out_dir, W, H,
        )
        os.makedirs(full_folder, exist_ok=True)
        # Hold a lock around scan + claim so two save_mp4 nodes in the
        # same workflow can't both pick the same counter and overwrite
        # each other. Touch the file inside the lock to claim it.
        with _COUNTER_LOCK:
            counter = _next_mp4_counter(full_folder, fname)
            out_filename = f"{fname}_{counter:05d}.mp4"
            out_path = os.path.join(full_folder, out_filename)
            try:
                # O_EXCL guarantees atomic create-if-not-exists across processes too
                fd = os.open(out_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.close(fd)
            except FileExistsError:
                # Extremely unlikely: counter scan saw N as the max, but
                # something else just created N+1 in the same instant.
                # Bump and retry once.
                counter += 1
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
            "-r", str(fps_int),
            "-i", "-",
        ]
        if temp_audio_path is not None:
            cmd += ["-i", temp_audio_path]
        cmd += [
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", str(crf),
            "-pix_fmt", pix_fmt,
        ]
        if temp_audio_path is not None:
            cmd += ["-c:a", "aac", "-b:a", "192k"]
            if trim_to_audio:
                cmd += ["-shortest"]
        cmd += [out_path]

        print(f"[Pixaroma] Save Mp4 — writing {n_frames} frames @ {fps_int}fps "
              f"({W}x{H}, crf={crf}, {pix_fmt}"
              f"{', +audio' if temp_audio_path else ''}) -> {out_filename}")

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
            # On the exception path the explicit close above never ran. Close
            # the pipe so the OS handle isn't leaked (Windows is sensitive to
            # this) before killing.
            try:
                if proc.stdin and not proc.stdin.closed:
                    proc.stdin.close()
            except OSError:
                pass
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            if drain_thread.is_alive():
                drain_thread.join(timeout=2)
            if temp_audio_path is not None and os.path.exists(temp_audio_path):
                try:
                    os.remove(temp_audio_path)
                except OSError:
                    pass

        print(f"[Pixaroma] Save Mp4 — saved {out_path}")

        # Two output keys so the file is visible BOTH in ComfyUI's standard
        # output panel and in our in-node <video> preview (js/save_mp4/index.js
        # listens for `pixaroma_videos`).
        entry = {
            "filename": out_filename,
            "subfolder": subfolder,
            "type": "output",
            "format": "video/mp4",
        }
        return {"ui": {"images": [entry], "pixaroma_videos": [entry]}}


NODE_CLASS_MAPPINGS = {
    "PixaromaSaveMp4": PixaromaSaveMp4,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaSaveMp4": "Save Mp4 Pixaroma",
}
