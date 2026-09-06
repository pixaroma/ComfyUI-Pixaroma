"""Video decode helpers for Load Video Pixaroma.

Frame decoding prefers PyAV (`av`) and falls back to imageio (which uses the
same bundled ffmpeg as Save Mp4). Audio is pulled via an ffmpeg subprocess to a
temp WAV and read back with stdlib `wave` + numpy — the mirror of Save Mp4's
`_write_wav_pcm16` — so the AUDIO output never depends on torchaudio.

All third-party imports are wrapped defensively (CLAUDE.md Background Removal
Pattern #0): a missing or broken library must NOT crash the whole plugin at
import time. The node only surfaces a clear, actionable error when it actually
runs and no backend is available.
"""

import io
import math
import os
import shutil
import subprocess
import tempfile
import uuid
import wave

import numpy as np
import torch

from ._proc_runner import run_command

# ── Optional third-party backends (never crash import) ───────────────────────
try:
    import av  # PyAV — primary decoder (video + accurate metadata)
    _AV_OK = True
except Exception:
    av = None
    _AV_OK = False

try:
    import imageio  # fallback decoder (uses imageio-ffmpeg's bundled binary)
    _IMAGEIO_OK = True
except Exception:
    imageio = None
    _IMAGEIO_OK = False

try:
    import cv2  # used only for fast frame resize when present
    _CV2_OK = True
except Exception:
    cv2 = None
    _CV2_OK = False

try:
    import folder_paths
except Exception:
    folder_paths = None

try:
    import comfy.model_management as _mm
except Exception:
    _mm = None


# Extensions the file picker + uploader accept. Kept here so the node and the
# upload route can share one list.
VIDEO_EXTS = {
    "mp4", "mov", "mkv", "webm", "avi", "m4v", "gif",
    "mpg", "mpeg", "wmv", "flv", "ogv", "ts",
}


def video_backend_available() -> bool:
    return _AV_OK or _IMAGEIO_OK


def _need_backend():
    if not video_backend_available():
        raise RuntimeError(
            "[Pixaroma] Load Video needs a video reader, and none is installed.\n"
            "   Install PyAV (recommended) one of these ways:\n"
            "     ComfyUI Manager: use its pip-install option and enter:  av\n"
            "     Portable ComfyUI (Windows): in your ComfyUI folder (the one with\n"
            "       python_embeded) run:  python_embeded\\python.exe -m pip install av\n"
            "     Your own Python (venv/conda):  pip install av\n"
            "   (Alternatively:  pip install imageio imageio-ffmpeg )\n"
        )


def resolve_ffmpeg():
    """Locate ffmpeg the same way Save Mp4 does: imageio-ffmpeg's bundled exe
    first, then ffmpeg on PATH. Returns None if neither is found (audio is then
    skipped rather than crashing the load)."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    return shutil.which("ffmpeg")


def _interrupt_check():
    """Let the user cancel a long load from the ComfyUI Stop button."""
    if _mm is not None:
        _mm.throw_exception_if_processing_interrupted()


# ── Frame transforms ─────────────────────────────────────────────────────────

def _scale_rgb(src, tw, th):
    """Plain (stretch) resize of an HxWx3 uint8 array to exactly (tw, th)."""
    H, W = src.shape[0], src.shape[1]
    if (tw, th) == (W, H):
        return np.ascontiguousarray(src)
    src = np.ascontiguousarray(src)
    if _CV2_OK:
        interp = cv2.INTER_AREA if (tw * th) < (W * H) else cv2.INTER_LANCZOS4
        return cv2.resize(src, (tw, th), interpolation=interp)
    from PIL import Image
    return np.asarray(Image.fromarray(src).resize((tw, th), Image.LANCZOS))


def _resize_rgb(arr, w, h):
    """Resize one HxWx3 uint8 frame:
      both 0    -> unchanged
      one 0     -> scale that axis, the other follows (keeps aspect)
      both set  -> COVER + center-crop to exactly (w, h): scale the frame to
                   fully cover the target box, then trim the overflow. Keeps the
                   picture's proportions and never stretches, matching Resize
                   Crop Pixaroma."""
    src = arr[..., :3]
    H, W = src.shape[0], src.shape[1]
    w = int(w) if w and w > 0 else 0
    h = int(h) if h and h > 0 else 0
    if w == 0 and h == 0:
        return np.ascontiguousarray(src)

    if w > 0 and h > 0:
        # Cover: scale so the frame fully covers (w, h), then center-crop.
        scale = max(w / float(W), h / float(H))
        rw = max(w, int(round(W * scale)))
        rh = max(h, int(round(H * scale)))
        resized = _scale_rgb(src, rw, rh)
        x0 = (rw - w) // 2
        y0 = (rh - h) // 2
        return np.ascontiguousarray(resized[y0:y0 + h, x0:x0 + w])

    # Single axis -> proportional scale.
    if w > 0:
        tw = w
        th = max(1, int(round(H * w / float(W))))
    else:
        th = h
        tw = max(1, int(round(W * h / float(H))))
    return _scale_rgb(src, tw, th)


def _resample_iter(raw_iter, native_fps, force_fps):
    """Nearest-hold resample a frame iterator from native_fps to force_fps.
    Drops frames when force < native, duplicates when force > native."""
    dt = 1.0 / force_fps
    next_t = 0.0
    for i, fr in enumerate(raw_iter):
        t = i / native_fps
        guard = 0
        while next_t <= t + 1e-9:
            yield fr
            next_t += dt
            guard += 1
            if guard > 4096:  # pathological force/native ratio safety
                break


def _collect(raw_iter, native_fps, force_fps, skip_first, max_frames,
             custom_w, custom_h):
    """Run the raw frame iterator through resample -> window -> skip, resizing
    each kept frame. Returns (list_of_uint8_frames, out_fps).

    Window model: max_frames is how many frames to read from the START (the
    window; 0 = all). skip_first then trims from the FRONT of that window, so the
    output is source frames [skip_first, max_frames). This bounds the decode to
    at most max_frames source frames."""
    if force_fps > 0 and native_fps > 0:
        src = _resample_iter(raw_iter, native_fps, force_fps)
        base_fps = force_fps
    else:
        src = raw_iter
        base_fps = native_fps

    out = []
    idx = -1
    for fr in src:
        _interrupt_check()
        idx += 1
        if max_frames and idx >= max_frames:
            break  # window end reached - stop reading
        if idx < skip_first:
            continue  # trim the front of the window
        out.append(_resize_rgb(fr, custom_w, custom_h))

    out_fps = base_fps if base_fps > 0 else 0.0
    return out, out_fps


# ── Backends ─────────────────────────────────────────────────────────────────

def _decode_av(path, force_fps, skip_first, max_frames, custom_w, custom_h):
    container = av.open(path)
    try:
        vstreams = container.streams.video
        if not vstreams:
            raise RuntimeError(
                f"[Pixaroma] Load Video — no video stream in "
                f"{os.path.basename(path)}."
            )
        v = vstreams[0]
        try:
            v.thread_type = "AUTO"
        except Exception:
            pass
        rate = v.average_rate or v.guessed_rate or getattr(v, "base_rate", None)
        native_fps = float(rate) if rate else 30.0
        if not (native_fps > 0):
            native_fps = 30.0
        cw = int(getattr(v.codec_context, "width", 0) or getattr(v, "width", 0) or 0)
        ch = int(getattr(v.codec_context, "height", 0) or getattr(v, "height", 0) or 0)

        def raw():
            for frame in container.decode(v):
                yield frame.to_ndarray(format="rgb24")

        out, out_fps = _collect(
            raw(), native_fps, force_fps, skip_first,
            max_frames, custom_w, custom_h,
        )
    finally:
        container.close()

    if out:
        height, width = out[0].shape[0], out[0].shape[1]
    else:
        width, height = cw, ch
    return out, out_fps, width, height


def _decode_imageio(path, force_fps, skip_first, max_frames, custom_w, custom_h):
    reader = imageio.get_reader(path, "ffmpeg")
    try:
        meta = reader.get_meta_data() or {}
        native_fps = float(meta.get("fps") or 0.0)
        if not (native_fps > 0):
            native_fps = 30.0
        size = meta.get("size") or (0, 0)
        cw, ch = int(size[0]), int(size[1])

        def raw():
            for fr in reader:
                a = np.asarray(fr)
                if a.ndim == 2:  # grayscale -> RGB
                    a = np.stack([a, a, a], axis=-1)
                elif a.shape[-1] == 1:  # single channel with axis
                    a = np.repeat(a, 3, axis=-1)
                elif a.shape[-1] == 2:  # gray + alpha -> replicate gray
                    a = np.repeat(a[..., :1], 3, axis=-1)
                yield a[..., :3]

        out, out_fps = _collect(
            raw(), native_fps, force_fps, skip_first,
            max_frames, custom_w, custom_h,
        )
    finally:
        reader.close()

    if out:
        height, width = out[0].shape[0], out[0].shape[1]
    else:
        width, height = cw, ch
    return out, out_fps, width, height


# ── Public API ───────────────────────────────────────────────────────────────

def decode(path, *, max_frames=0, force_fps=0.0, skip_first=0,
           custom_w=0, custom_h=0) -> dict:
    """Decode a video file to a frame batch + metadata.

    Returns {frames: IMAGE tensor [N,H,W,3] float32, fps, width, height,
    duration, frame_count}. Raises a clear error when no backend is available
    or no frames could be read.
    """
    _need_backend()
    skip_first = max(0, int(skip_first))
    max_frames = max(0, int(max_frames))
    force_fps = float(force_fps) if force_fps and force_fps > 0 else 0.0

    if _AV_OK:
        try:
            out, out_fps, width, height = _decode_av(
                path, force_fps, skip_first, max_frames, custom_w, custom_h,
            )
        except Exception as e:
            if _IMAGEIO_OK:
                print(f"[Pixaroma] Load Video — PyAV could not read this file "
                      f"({e}); falling back to imageio.")
                out, out_fps, width, height = _decode_imageio(
                    path, force_fps, skip_first, max_frames, custom_w, custom_h,
                )
            else:
                raise
    else:
        out, out_fps, width, height = _decode_imageio(
            path, force_fps, skip_first, max_frames, custom_w, custom_h,
        )

    if not out:
        if skip_first > 0:
            raise ValueError(
                f"[Pixaroma] Load Video — Skip first frames ({skip_first}) "
                f"removed every loaded frame of {os.path.basename(path)}. Lower "
                f"it, or raise Max frames, and try again."
            )
        raise ValueError(
            f"[Pixaroma] Load Video — no frames could be read from "
            f"{os.path.basename(path)}. The file may be corrupt or in an "
            f"unsupported format."
        )

    # Build the float32 IMAGE batch with the SMALLEST peak memory: stack to
    # uint8, release the per-frame list, then convert + scale IN PLACE. The old
    # `.astype(float32) / 255.0` allocated an EXTRA full-size temporary (a ~3GB
    # spike for a 120-frame 1080p clip) on top of the result, which on a busy
    # session can push into swap and make a fast load feel like a hang.
    frames_np = np.stack(out, axis=0)   # uint8 (N, H, W, 3)
    out = None                          # free the per-frame arrays before the float alloc
    frame_count = int(frames_np.shape[0])
    frames_np = frames_np.astype(np.float32)
    frames_np /= 255.0                  # in place - no second full-size copy
    duration = frame_count / out_fps if out_fps > 0 else 0.0
    tensor = torch.from_numpy(frames_np)
    return {
        "frames": tensor,
        "fps": float(out_fps),
        "width": int(width),
        "height": int(height),
        "duration": float(duration),
        "frame_count": frame_count,
    }


# ── Single-frame picker (Load Video Frame Pixaroma) ──────────────────────────
#
# probe_meta() reads fps / frame_count / size WITHOUT decoding every frame, so
# the picker UI can map its slider to frame numbers (the browser <video> exposes
# neither fps nor frame count). decode_one() seeks to a target frame and decodes
# just that one, so grabbing frame 5000 of a long clip stays fast.

def _av_video_meta(v, container):
    """fps / frame_count / duration from a PyAV video stream (no full decode)."""
    rate = v.average_rate or v.guessed_rate or getattr(v, "base_rate", None)
    fps = float(rate) if rate else 30.0
    if not (fps > 0):
        fps = 30.0
    w = int(getattr(v.codec_context, "width", 0) or getattr(v, "width", 0) or 0)
    h = int(getattr(v.codec_context, "height", 0) or getattr(v, "height", 0) or 0)

    duration = 0.0
    try:
        if v.duration is not None and v.time_base is not None:
            duration = float(v.duration * v.time_base)
    except Exception:
        duration = 0.0
    if duration <= 0 and getattr(container, "duration", None):
        try:
            duration = float(container.duration) / 1_000_000.0  # AV_TIME_BASE
        except Exception:
            duration = 0.0

    frame_count = 0
    try:
        frame_count = int(v.frames or 0)
    except Exception:
        frame_count = 0
    if frame_count <= 0 and duration > 0 and fps > 0:
        frame_count = int(round(duration * fps))  # close estimate
    if frame_count < 0:
        frame_count = 0
    return fps, frame_count, w, h, duration


def _probe_av(path):
    container = av.open(path)
    try:
        vstreams = container.streams.video
        if not vstreams:
            raise RuntimeError(
                f"[Pixaroma] Load Video Frame — no video stream in "
                f"{os.path.basename(path)}."
            )
        fps, frame_count, w, h, duration = _av_video_meta(vstreams[0], container)
        return {"fps": float(fps), "frame_count": int(frame_count),
                "width": int(w), "height": int(h), "duration": float(duration)}
    finally:
        container.close()


def _probe_imageio(path):
    reader = imageio.get_reader(path, "ffmpeg")
    try:
        meta = reader.get_meta_data() or {}
        fps = float(meta.get("fps") or 0.0)
        if not (fps > 0):
            fps = 30.0
        size = meta.get("size") or (0, 0)
        w, h = int(size[0]), int(size[1])
        duration = float(meta.get("duration") or 0.0)
        n = meta.get("nframes")
        frame_count = 0
        if isinstance(n, (int, float)) and math.isfinite(n) and n > 0:
            frame_count = int(n)
        if frame_count <= 0 and duration > 0 and fps > 0:
            frame_count = int(round(duration * fps))
        return {"fps": float(fps), "frame_count": int(frame_count),
                "width": int(w), "height": int(h), "duration": float(duration)}
    finally:
        reader.close()


def probe_meta(path) -> dict:
    """Read {fps, frame_count, width, height, duration} WITHOUT decoding every
    frame. frame_count may be a close estimate (duration x fps) when the
    container does not store an exact count."""
    _need_backend()
    if _AV_OK:
        try:
            return _probe_av(path)
        except Exception:
            if _IMAGEIO_OK:
                return _probe_imageio(path)
            raise
    return _probe_imageio(path)


def _decode_one_av(path, frame_index):
    container = av.open(path)
    try:
        vstreams = container.streams.video
        if not vstreams:
            raise RuntimeError(
                f"[Pixaroma] Load Video Frame — no video stream in "
                f"{os.path.basename(path)}."
            )
        v = vstreams[0]
        # IMPORTANT: decode a single frame SINGLE-THREADED. Multi-threaded PyAV
        # decoding (thread_type "AUTO") combined with a seek can DEADLOCK inside a
        # busy multi-threaded process like the ComfyUI server (it ran fine in an
        # isolated process but hung for minutes in ComfyUI). Threading buys almost
        # nothing here — we only decode a handful of frames from the keyframe — so
        # we leave the stream single-threaded, which is deadlock-proof. (Load Video
        # keeps AUTO because it streams hundreds of frames sequentially and never
        # seeks.)
        try:
            v.thread_type = "NONE"
        except Exception:
            pass
        fps, frame_count, _w, _h, duration = _av_video_meta(v, container)

        idx = max(0, int(frame_index))
        if frame_count > 0:
            idx = min(idx, frame_count - 1)
        target_t = idx / fps if fps > 0 else 0.0

        # Seek to the keyframe at/just before the target time, then decode
        # forward and keep the frame closest in time to the target (robust to
        # fps rounding + sparse keyframes).
        try:
            tb = v.time_base
            if tb:
                container.seek(max(0, int(target_t / float(tb))),
                               stream=v, any_frame=False, backward=True)
            else:
                container.seek(max(0, int(target_t * 1_000_000)),
                               any_frame=False, backward=True)
        except Exception:
            try:
                container.seek(0)
            except Exception:
                pass

        chosen = None
        best_dt = None
        seen = 0
        for frame in container.decode(v):
            _interrupt_check()
            seen += 1
            try:
                ft = float(frame.time) if frame.time is not None else target_t
            except Exception:
                ft = target_t
            arr = frame.to_ndarray(format="rgb24")
            dt = abs(ft - target_t)
            if best_dt is None or dt <= best_dt:
                best_dt = dt
                chosen = arr
            if ft > target_t + (0.5 / fps):
                break
            # Hard safety cap: even a file with no frame timestamps (every ft ==
            # target_t, so the break above never fires) can only walk a bounded
            # number of frames from the keyframe, never the whole stream.
            if seen >= 4096:
                break
        if chosen is None:
            raise RuntimeError(
                f"[Pixaroma] Load Video Frame — could not decode frame {idx} of "
                f"{os.path.basename(path)}."
            )
        h, w = chosen.shape[0], chosen.shape[1]
        return {"frame": np.ascontiguousarray(chosen[..., :3]),
                "fps": float(fps), "frame_count": int(frame_count),
                "width": int(w), "height": int(h),
                "duration": float(duration), "index": int(idx)}
    finally:
        container.close()


def _decode_one_imageio(path, frame_index):
    reader = imageio.get_reader(path, "ffmpeg")
    try:
        meta = reader.get_meta_data() or {}
        fps = float(meta.get("fps") or 0.0)
        if not (fps > 0):
            fps = 30.0
        size = meta.get("size") or (0, 0)
        duration = float(meta.get("duration") or 0.0)
        n = meta.get("nframes")
        frame_count = 0
        if isinstance(n, (int, float)) and math.isfinite(n) and n > 0:
            frame_count = int(n)
        if frame_count <= 0 and duration > 0 and fps > 0:
            frame_count = int(round(duration * fps))

        idx = max(0, int(frame_index))
        if frame_count > 0:
            idx = min(idx, frame_count - 1)

        # imageio can over-report the frame count, so a get_data at the very end
        # may raise; step down to the nearest readable frame.
        fr = None
        for cand in (idx, idx - 1, max(0, idx - 2), 0):
            if cand < 0:
                continue
            try:
                fr = reader.get_data(cand)
                idx = cand
                break
            except Exception:
                continue
        if fr is None:
            raise RuntimeError(
                f"[Pixaroma] Load Video Frame — could not read frame "
                f"{frame_index} of {os.path.basename(path)}."
            )
        a = np.asarray(fr)
        if a.ndim == 2:  # grayscale -> RGB
            a = np.stack([a, a, a], axis=-1)
        elif a.shape[-1] == 1:
            a = np.repeat(a, 3, axis=-1)
        elif a.shape[-1] == 2:  # gray + alpha -> replicate gray
            a = np.repeat(a[..., :1], 3, axis=-1)
        a = np.ascontiguousarray(a[..., :3])
        h, w = a.shape[0], a.shape[1]
        return {"frame": a, "fps": float(fps), "frame_count": int(frame_count),
                "width": int(w), "height": int(h),
                "duration": float(duration), "index": int(idx)}
    finally:
        reader.close()


def _grab_frame_ffmpeg(path, fps, idx):
    """Grab ONE exact frame via an ffmpeg SUBPROCESS. This is process-isolated,
    so it CANNOT deadlock the ComfyUI server the way in-process libav frame
    decoding can (that hang was the whole reason this path exists — the same
    decode ran in milliseconds in a standalone process but froze for minutes
    inside the running ComfyUI process), and process runner's timeout is a real
    safety net (a blocked in-process C decode call cannot be interrupted).

    Accurate + fast seek: `-ss t` BEFORE `-i` fast-seeks to the keyframe then
    decodes forward to t; t = idx / fps lands on exactly frame idx (verified
    frame-accurate against a sequential decode). Output is a self-describing PNG
    on the pipe (no width/height reshape guesswork). Returns HxWx3 uint8, or None
    if ffmpeg is unavailable or the grab fails (the caller then falls back to an
    in-process decode)."""
    if not (fps and fps > 0):
        return None
    ffmpeg = resolve_ffmpeg()
    if not ffmpeg:
        return None
    t = max(0.0, idx / float(fps))
    cmd = [
        ffmpeg, "-nostdin", "-loglevel", "error",
        "-ss", f"{t:.6f}", "-i", path,
        "-frames:v", "1", "-an",
        # rgb24 is load-bearing, not tidiness. Without it a 16-bit GRAYSCALE
        # source (gray16le, or a gray10/12le encode - scientific, astro and
        # medical captures look like this) makes ffmpeg emit a 16-bit grey PNG,
        # which Pillow opens as mode `I;16`, and .convert("RGB") on that mode
        # CLAMPS every sample above 255 instead of scaling it down. Measured:
        # 2 unique values and mean 225 (near-white) against 151 values and mean
        # 125 for the identical 8-bit source. ffmpeg exits 0 and Pillow raises
        # nothing, so the caller's fallback never engages and the user is handed
        # a white picture with no error anywhere. Fixing it in the PIL call
        # instead would have to cover Pillow's `I`, `I;16`, `I;16B` and `I;16L`
        # spellings, which differ between Pillow versions. Verified: ordinary
        # 8-bit output is BYTE-IDENTICAL with and without the flag.
        "-pix_fmt", "rgb24",
        "-f", "image2pipe", "-c:v", "png", "-",
    ]
    try:
        proc = run_command(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120,
        )
    except Exception:
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(proc.stdout)).convert("RGB")
        return np.ascontiguousarray(np.asarray(img)[..., :3])
    except Exception:
        return None


def decode_one(path, frame_index=0) -> dict:
    """Decode ONE frame at a 0-based index. Returns {frame: HxWx3 uint8, fps,
    frame_count, width, height, duration, index}. Raises a clear error when no
    backend is available or the frame can't be read.

    Primary path is an ffmpeg subprocess (`_grab_frame_ffmpeg`) so a run inside
    the ComfyUI server can never deadlock. Only when ffmpeg is genuinely missing
    does it fall back to an in-process (single-threaded) libav decode."""
    _need_backend()
    frame_index = max(0, int(frame_index))
    # Header-only metadata read — proven safe in-process (the /meta route runs
    # this inside ComfyUI and returns fine). Only frame DECODING was the hazard.
    meta = probe_meta(path)
    fps = float(meta.get("fps") or 0.0) or 30.0
    fc = int(meta.get("frame_count") or 0)
    idx = frame_index
    if fc > 0:
        idx = min(idx, fc - 1)

    arr = _grab_frame_ffmpeg(path, fps, idx)
    if arr is not None:
        return {
            "frame": arr, "fps": float(fps), "frame_count": fc,
            "width": int(arr.shape[1]), "height": int(arr.shape[0]),
            "duration": float(meta.get("duration") or 0.0), "index": int(idx),
        }

    # ffmpeg unavailable / failed -> in-process fallback (rare).
    if _AV_OK:
        try:
            return _decode_one_av(path, idx)
        except Exception as e:
            if _IMAGEIO_OK:
                print(f"[Pixaroma] Load Video Frame — PyAV could not read this "
                      f"file ({e}); falling back to imageio.")
                return _decode_one_imageio(path, idx)
            raise
    return _decode_one_imageio(path, idx)


def extract_audio(path):
    """Pull the soundtrack as a ComfyUI AUDIO dict via an ffmpeg subprocess.
    Returns None when the file has no audio, ffmpeg is missing, or extraction
    fails (the node then outputs no audio rather than crashing)."""
    ffmpeg = resolve_ffmpeg()
    if not ffmpeg:
        return None

    temp_dir = None
    if folder_paths is not None:
        try:
            temp_dir = folder_paths.get_temp_directory()
        except Exception:
            temp_dir = None
    if not temp_dir:
        temp_dir = tempfile.gettempdir() or os.path.dirname(path) or "."
    try:
        os.makedirs(temp_dir, exist_ok=True)
    except OSError:
        pass

    wav_path = os.path.join(temp_dir, f"pixaroma_load_video_{uuid.uuid4().hex}.wav")
    cmd = [
        ffmpeg, "-y", "-loglevel", "error",
        "-i", path, "-vn",
        "-acodec", "pcm_s16le",
        wav_path,
    ]
    try:
        try:
            proc = run_command(
                cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                timeout=180,
            )
        except subprocess.TimeoutExpired:
            print("[Pixaroma] Load Video — audio extraction timed out; "
                  "continuing without audio.")
            return None
        if (proc.returncode != 0 or not os.path.exists(wav_path)
                or os.path.getsize(wav_path) < 64):
            return None
        with wave.open(wav_path, "rb") as wf:
            n_ch = wf.getnchannels()
            sr = wf.getframerate()
            n = wf.getnframes()
            raw = wf.readframes(n)
        if n_ch <= 0 or sr <= 0 or not raw:
            return None
        data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        # Guard a truncated WAV whose length isn't a clean multiple of channels.
        usable = (data.shape[0] // n_ch) * n_ch
        if usable == 0:
            return None
        data = data[:usable].reshape(-1, n_ch).T  # (channels, samples)
        waveform = torch.from_numpy(np.ascontiguousarray(data)).unsqueeze(0)  # (1, C, S)
        return {"waveform": waveform, "sample_rate": int(sr)}
    except Exception as e:
        print(f"[Pixaroma] Load Video — audio extraction failed: {e}")
        return None
    finally:
        if os.path.exists(wav_path):
            try:
                os.remove(wav_path)
            except OSError:
                pass
