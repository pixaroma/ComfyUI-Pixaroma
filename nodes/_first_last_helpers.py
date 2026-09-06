"""Pull the FIRST and the LAST frame of a video FILE with two small ffmpeg
subprocess calls.

Deliberately its own module rather than an addition to _video_helpers.py: that
file is shared by three shipped nodes (Load Video, Load Video Frame, Save Mp4)
and this needs nothing from it but `resolve_ffmpeg`.

Why a subprocess at all: in-process libav frame DECODING has been measured to
deadlock the running ComfyUI server (the same decode ran in milliseconds in a
standalone process) - see .claude/patterns/load-video-frame.md #1. A fresh
subprocess is exactly the environment that never hangs, and process runner's
timeout is a real safety net, which a blocked in-process C call is not.

Both grabs are EXACT by construction, which is the whole point of doing it this
way instead of seeking by frame number:
  * first: no seek at all, decode from the start, keep frame 1.
  * last:  `-sseof` seeks relative to the END of the file, `-update 1` keeps
           overwriting one output file, so whatever ffmpeg decodes last is what
           survives on disk.
Every function returns None on any failure so the caller can fall back to
ComfyUI's own get_components(), which is always correct (just memory-hungry).
"""

import io
import os
import subprocess
import threading
import uuid

import numpy as np

from ._video_helpers import resolve_ffmpeg
from ._proc_runner import run_command

# Generous: a long-GOP 4K file can take a while to decode a tail window, and
# this is a backstop against a wedged process, not a performance target.
_TIMEOUT = 180

# How far back from the end to start decoding for the last frame. Tried in
# order: one second covers any sane frame rate, and the wider retry rescues a
# file whose final second is one huge GOP or whose tail timestamps are odd.
_TAIL_WINDOWS = (1.0, 5.0)


def _png_bytes_to_rgb(data):
    """PNG bytes -> HxWx3 uint8. Alpha is dropped: a ComfyUI IMAGE is 3-channel.

    Both callers pass `-pix_fmt rgb24`, and that is load-bearing, not tidiness.
    Without it a 16-bit GRAYSCALE source (gray16le, or a gray10/12le encode -
    scientific, astro and medical captures look like this) makes ffmpeg emit a
    16-bit greyscale PNG, which Pillow opens as mode `I;16`. `.convert("RGB")`
    on that mode CLAMPS every sample above 255 instead of scaling it down, so
    the frame comes back near-white: measured 2 unique values and mean 225
    against 151 values and mean 125 for the identical 8-bit source. ffmpeg
    exits 0 and Pillow raises nothing, so the caller's fallback never engages
    and the user is handed a white picture with no error anywhere.

    Fixing it here instead would have to cover Pillow's `I`, `I;16`, `I;16B`
    and `I;16L` spellings, which differ between Pillow versions. Making ffmpeg
    hand us 8-bit RGB in the first place has no version surface at all, and if
    ffmpeg ever cannot satisfy rgb24 it exits non-zero, which degrades to the
    always-correct get_components() path rather than to a wrong picture.

    Verified: ordinary 8-bit yuv420p output is BYTE-IDENTICAL with and without
    the flag (md5 of all four reference clips unchanged), so the common path
    cannot regress.
    """
    from PIL import Image

    img = Image.open(io.BytesIO(data)).convert("RGB")
    return np.ascontiguousarray(np.asarray(img)[..., :3])


def _run(cmd):
    """Run ffmpeg, swallowing every failure mode into None. Never raises."""
    try:
        return run_command(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=_TIMEOUT
        )
    except Exception:
        return None


def grab_first_frame(path, ffmpeg=None):
    """The video's first frame as HxWx3 uint8, or None.

    No `-ss` at all, so there is no seek to be inexact about: ffmpeg decodes
    from the head of the file and `-frames:v 1` stops after the first frame.
    PNG on a pipe is self-describing, so there is no width/height reshape
    guesswork on our side.
    """
    ffmpeg = ffmpeg or resolve_ffmpeg()
    if not ffmpeg:
        return None
    proc = _run([
        ffmpeg, "-nostdin", "-loglevel", "error",
        "-i", path,
        "-frames:v", "1", "-an",
        "-pix_fmt", "rgb24",            # see _png_bytes_to_rgb
        "-f", "image2pipe", "-c:v", "png", "-",
    ])
    if proc is None or proc.returncode != 0 or not proc.stdout:
        return None
    try:
        return _png_bytes_to_rgb(proc.stdout)
    except Exception:
        return None


def grab_last_frame(path, ffmpeg=None, temp_dir=None):
    """The video's TRUE last frame as HxWx3 uint8, or None.

    `-sseof -N` seeks N seconds back from the END of the file, then `-update 1`
    writes every decoded frame to the SAME output path, each overwriting the
    last. Decoding runs to EOF, so the file left behind is the final frame.

    Deliberately NOT `-ss (frame_count-1)/fps`: a container's frame count is
    often an ESTIMATE (see .claude/patterns/load-video-frame.md #3), and an
    estimate that is one frame LOW seeks into the middle of the clip and
    returns a perfectly valid, completely wrong frame with no error anywhere.
    Silently wrong data is worse than falling back, so the frame count is never
    consulted here.

    Writes through a temp file rather than a pipe because `-update 1` on a pipe
    emits every frame in the window back to back; the file is bounded to one
    frame no matter how long the window is.
    """
    ffmpeg = ffmpeg or resolve_ffmpeg()
    if not ffmpeg:
        return None
    if not temp_dir:
        try:
            import folder_paths

            temp_dir = folder_paths.get_temp_directory()
        except Exception:
            return None
    try:
        os.makedirs(temp_dir, exist_ok=True)
    except Exception:
        return None

    # pid + thread id + uuid: two runs of this node can be in flight at once
    # (batched prompts, two nodes in one graph), and a name that only carries
    # the pid collides between threads of the same process.
    out_path = os.path.join(
        temp_dir,
        f"pixaroma_lastframe_{os.getpid()}_{threading.get_ident()}_{uuid.uuid4().hex}.png",
    )
    try:
        for window in _TAIL_WINDOWS:
            proc = _run([
                ffmpeg, "-nostdin", "-loglevel", "error", "-y",
                "-sseof", f"-{window:g}",
                "-i", path,
                "-an", "-update", "1",
                "-pix_fmt", "rgb24",    # see _png_bytes_to_rgb
                out_path,
            ])
            if proc is None or proc.returncode != 0:
                continue
            try:
                if os.path.getsize(out_path) <= 0:
                    continue
                with open(out_path, "rb") as fh:
                    return _png_bytes_to_rgb(fh.read())
            except Exception:
                continue
        return None
    finally:
        try:
            os.remove(out_path)
        except Exception:
            pass


def grab_first_last(path, temp_dir=None):
    """(first, last) as HxWx3 uint8 arrays, or None if EITHER grab failed.

    All-or-nothing on purpose: a pair where one frame came from ffmpeg and the
    other from a different code path could disagree about colour handling, and
    the caller's fallback produces a consistent pair from one source.
    """
    ffmpeg = resolve_ffmpeg()
    if not ffmpeg or not path or not os.path.isfile(path):
        return None
    first = grab_first_frame(path, ffmpeg)
    if first is None:
        return None
    last = grab_last_frame(path, ffmpeg, temp_dir)
    if last is None:
        return None
    return first, last
