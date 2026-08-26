"""Shared video-encoding helpers for Pixaroma nodes that write mp4 files.

Extracted from node_save_mp4.py on 2026-08-10 when Save Video Pixaroma was
built, so the two nodes cannot drift. Every invariant here was earned by a real
bug and is recorded in .claude/patterns/save-mp4.md - read that file before
changing anything in this module, and keep the comments: they are the reason
each line exists, not decoration.

What lives here:
  _resolve_ffmpeg        locate the ffmpeg binary, with a helpful install hint
  _write_wav_pcm16       Comfy AUDIO waveform -> 16-bit PCM WAV (stdlib + numpy)
  build_video_meta_tags  the {"workflow": json, "prompt": json} tag map to embed
  write_ffmetadata_tags  those tags as an FFMETADATA file (a FILE, not -metadata
                         args, so a big workflow cannot blow the Windows
                         command-line length limit)
  metadata_movflags      the two muxer flags the read-back depends on - READ ITS
                         COMMENT before changing either of them
  build_video_meta_json  the older single-blob form, kept only because it
                         documents the _json_safe NaN trap that both builders
                         depend on. NOTHING calls it; do not reach for it.
  validate_rgb_frames    refuse a shape rgb24 cannot carry, BEFORE any file is
                         claimed
  claim_counter_path     atomic O_EXCL name claim with a re-claiming loop
  encode_frames          the frame pump: stderr drain, BrokenPipeError
                         tolerance, success gate and cleanup on every path
"""

import os
import shutil
import subprocess
import threading

import numpy as np

import comfy.model_management


def _escape_ffmetadata(value):
    """Escape a value for an ffmpeg FFMETADATA file: backslash-escape = ; # \\
    and newline (per the ffmetadata spec). Done in one pass so the backslashes we
    add are never themselves re-escaped."""
    out = []
    for ch in value:
        if ch in ("=", ";", "#", "\\"):
            out.append("\\")
            out.append(ch)
        elif ch == "\n":
            out.append("\\\n")
        else:
            out.append(ch)
    return "".join(out)


def build_video_meta_json(prompt, extra_pnginfo):
    """JSON string {"workflow":..., "prompt":...} to embed in the mp4's comment
    atom, or None if neither is available. This is the exact shape a video-aware
    ComfyUI frontend parses out of an mp4's comment when you drag the video back
    onto the canvas, so the workflow is restored.

    ⚠️ The payload MUST go through `_json_safe` (2026-08-10). PROMPT carries
    `is_changed: [NaN]` for every node whose IS_CHANGED returns nan - which is
    Preview Image, Save Image, Notify and BOTH save-video nodes - and
    `json.dumps` writes that as the bare token `NaN`, which is NOT valid JSON.
    Python's `json.loads` happens to accept it, so the file looks fine from
    Python; a browser's `JSON.parse` REFUSES it, which is the one consumer that
    matters. MEASURED on two real saved videos: the comment held a bare `NaN`
    and JSON.parse threw, so the whole drag-back-to-restore promise was dead
    while the file itself played perfectly.

    Do NOT "fix" this with `allow_nan=False`: that raises, the except below
    returns None, and the workflow would be dropped entirely instead.

    _save_helpers is imported lazily so this module stays free of a PIL import
    at module scope (that file imports PngInfo).
    """
    import json

    from ._save_helpers import _json_safe

    meta = {}
    if isinstance(extra_pnginfo, dict):
        wf = extra_pnginfo.get("workflow")
        if wf is not None:
            meta["workflow"] = wf
    if prompt is not None:
        meta["prompt"] = prompt
    if not meta:
        return None
    try:
        return json.dumps(_json_safe(meta))
    except Exception:
        return None


def build_video_meta_tags(prompt, extra_pnginfo):
    """The tag NAME -> JSON-string map to embed, matching what ComfyUI CORE's own
    SaveVideo writes: a separate `workflow` tag and a separate `prompt` tag, each
    holding its own JSON. Returns {} when there is nothing to embed.

    Shares `build_video_meta_json`'s `_json_safe` scrub - see that docstring for
    why (PROMPT carries a bare `NaN` that a browser's JSON.parse refuses).
    """
    import json

    from ._save_helpers import _json_safe

    tags = {}
    if isinstance(extra_pnginfo, dict):
        wf = extra_pnginfo.get("workflow")
        if wf is not None:
            tags["workflow"] = wf
    if prompt is not None:
        tags["prompt"] = prompt
    if not tags:
        return {}
    try:
        return {k: json.dumps(_json_safe(v)) for k, v in tags.items()}
    except Exception:
        return {}


def write_ffmetadata_tags(path, tags):
    """Write an FFMETADATA file with one line per tag."""
    with open(path, "w", encoding="utf-8") as f:
        f.write(";FFMETADATA1\n")
        for key, value in tags.items():
            f.write(key + "=" + _escape_ffmetadata(value) + "\n")


# ⚠️ THESE TWO FLAGS ARE THE WHOLE READ-BACK CONTRACT. Do not drop either.
#
# There are exactly two readers of a workflow inside an mp4 and they want
# DIFFERENT things. Measured 2026-08-26 against both, on real files:
#
#   ComfyUI CORE  `parseIsobmffMetadata` needs moov > udta > meta > KEYS + ilst
#       - the QuickTime `mdta` form, which is what `use_metadata_tags` writes,
#       with real tag names. Without the keys box it returns {} and gives up.
#       It also reads ONLY THE FIRST 2 MB of the file, which is what `faststart`
#       is for: it moves `moov` to the front, so a long video is reachable at all.
#
#   VideoHelperSuite `getVideoMetadata` wants an iTunes ilst `©cmt` atom, found
#       by scanning BACKWARDS from the end.
#
# ONE ffmpeg pass cannot produce both: `use_metadata_tags` moves `comment` into
# the keys box and the `©cmt` atom disappears (measured, all three combinations).
# So we write CORE's form, and VHS users are covered because VHS FALLS THROUGH -
# its handler ends `return await originalHandleFile.apply(this, arguments)`, so
# when it finds no `©cmt` the file reaches core's reader, which does find it.
# Writing OUR old form instead is what left every core-only install unable to
# open its own videos, which is how this was reported.
def metadata_movflags():
    return ["-movflags", "use_metadata_tags+faststart"]


def _resolve_ffmpeg(label="Save Mp4"):
    """Locate the ffmpeg binary. Prefer imageio-ffmpeg's bundled exe (usually
    already on disk, since anything that works with video pulls it in), then
    fall back to ffmpeg on PATH."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    on_path = shutil.which("ffmpeg")
    if on_path:
        return on_path
    raise RuntimeError(
        f"[Pixaroma] {label}: ffmpeg was not found, and it is needed to make the video.\n"
        "   Easiest fix is to install imageio-ffmpeg (a bundled ffmpeg, no system setup):\n"
        "     Portable ComfyUI (Windows) - run this in your ComfyUI folder\n"
        "       (the one that holds the python_embeded folder):\n"
        "         python_embeded\\python.exe -m pip install imageio-ffmpeg\n"
        "     Or in ComfyUI Manager, use its pip install option and enter: imageio-ffmpeg\n"
        "     Your own Python (venv/conda): pip install imageio-ffmpeg\n"
        "   Or install ffmpeg system-wide from https://ffmpeg.org/download.html\n"
    )


_COUNTER_LOCK = threading.Lock()


def _write_wav_pcm16(path, waveform, sample_rate, label="Save Mp4"):
    """Write a Comfy AUDIO waveform tensor [C, samples] (or [B, C, samples])
    as 16-bit PCM WAV using only stdlib + numpy. Avoids torchaudio backend
    issues on Windows."""
    import wave

    if waveform.dim() == 3:
        waveform = waveform[0]
    n_ch = int(waveform.shape[0])
    if n_ch == 0:
        raise ValueError(f"[Pixaroma] {label} — audio waveform has 0 channels.")
    samples = waveform.detach().cpu().numpy()
    # np.clip leaves NaN as NaN (NaN * 32767 -> garbage int16); scrub NaN/Inf to
    # silence / extremes before the cast.
    samples = np.nan_to_num(samples, nan=0.0, posinf=1.0, neginf=-1.0)
    samples = np.clip(samples, -1.0, 1.0)
    samples = (samples * 32767.0).astype(np.int16)
    interleaved = samples.T.tobytes()
    with wave.open(path, "wb") as f:
        f.setnchannels(n_ch)
        f.setsampwidth(2)
        f.setframerate(int(sample_rate))
        f.writeframes(interleaved)


#: Longest fade we will accept, in milliseconds. A fade is meant to hide a click
#: at the very start, not to be a creative effect - past a couple of seconds the
#: user is editing their audio and should do it in an editor.
MAX_AUDIO_FADE_MS = 2000


def audio_fade_args(fade_ms):
    """ffmpeg args for a short fade-in on the audio, or [] when it is off.

    WHY THIS EXISTS: MiniMax H3 (and other AV models) generate audio that is
    silent for ~20 ms and then switches on at FULL LEVEL in a single step.
    Measured on a real clip: 0.001 -> 0.005 -> 0.162 across three 10 ms slices.
    That instantaneous step is audible as a click or "dit" at the start of every
    clip. It is the MODEL, not this encoder - a tap on the raw audio before it
    reaches ffmpeg shows the identical opening - and it cannot be prompted away
    (asking for a gradual fade-in was measured to make it LOUDER, not softer).

    Measured effect on the size of that first step, on a real H3 clip:
        no fade  0.157   |   30 ms  0.144   |   60 ms  0.072   |   120 ms  0.036
    30 ms is too short to help, because the sound only starts at 20 ms.

    DEFAULT OFF, deliberately. These nodes are also used for plain load-and-save
    round trips, and silently fading somebody's existing sound track would be an
    unrequested edit to their content. The user turns it on for AV-model clips.

    Never raises: an unreadable value is treated as off, because a bad number in
    a settings blob must not be able to fail a whole render.
    """
    try:
        ms = int(float(fade_ms))
    except (TypeError, ValueError, OverflowError):
        # OverflowError is NOT hypothetical: this value arrives from a JSON state
        # blob, and json.loads accepts the literal `Infinity`, on which
        # int(float(x)) raises OverflowError rather than ValueError.
        return []
    if ms <= 0:
        return []
    ms = min(ms, MAX_AUDIO_FADE_MS)
    # afade wants seconds. 3 decimals is 1 ms resolution, which is finer than
    # anything audible here, and avoids a float like 0.12000000000000001 in the
    # command line.
    return ["-af", "afade=t=in:st=0:d=%.3f" % (ms / 1000.0)]


def validate_rgb_frames(frames, label="Save Mp4", pix_fmt="yuv420p"):
    """Refuse anything -pix_fmt rgb24 cannot carry. Returns (n_frames, H, W).

    CALL THIS BEFORE CLAIMING AN OUTPUT PATH. Placed early so a refusal cannot
    orphan a 0-byte file (save-mp4 pattern #14).

    rgb24 promises ffmpeg exactly 3 bytes per pixel, and the raw stdin stream
    carries NO frame delimiters, so a tensor with any other channel count
    misaligns every frame boundary from the first frame on. Measured 2026-08-10:
    a 4-channel batch encoded with NO exception and NO decode error, just a wrong
    video (21670 bytes against the correct 16739); 1-channel the same at 6578.
    Silent corruption is worse than a crash because nothing tells the user, so
    refuse it the same way the even-dimensions check does.
    """
    if frames is None or frames.shape[0] == 0:
        raise ValueError(f"[Pixaroma] {label} — input video_frames batch is empty.")
    if frames.ndim != 4 or frames.shape[3] != 3:
        raise ValueError(
            f"[Pixaroma] {label} — video_frames must be a batch of RGB "
            f"images shaped [batch, height, width, 3], got "
            f"{tuple(frames.shape)}. If it carries transparency (RGBA), "
            f"convert it to RGB before this node."
        )
    n_frames, H, W, _ = frames.shape
    # yuv420p (and its 10-bit sibling) require even dimensions; surface a clear
    # error rather than the opaque "height not divisible by 2" ffmpeg crash.
    if pix_fmt.startswith("yuv420") and (W % 2 != 0 or H % 2 != 0):
        raise ValueError(
            f"[Pixaroma] {label} — encoder requires even width and "
            f"height, got {W}x{H}. Resize input frames to even dimensions "
            f"(Audio React Pixaroma snaps to multiples of 8 automatically)."
        )
    return int(n_frames), int(H), int(W)


def claim_counter_path(folder, make_name, start=1, limit=99999, label="Save Mp4"):
    """Atomically claim the first free `<folder>/<make_name(n)>` from n=start.

    Returns (path, filename, n). Held under a module-wide lock so two save nodes
    in the same workflow cannot both pick the same counter and overwrite each
    other, and the O_EXCL touch happens INSIDE the lock so the name is claimed,
    not merely observed free.

    `start` may be a CALLABLE, which is then invoked inside the lock. That keeps
    a caller's directory scan under the same lock as the claim, exactly as the
    original inline code had it - the claim loop alone would still be correct,
    but this preserves the behaviour rather than reasoning about it.

    This is a re-claiming LOOP on purpose: the old code bumped the counter once
    without re-claiming, so a cross-process collision could still slip through
    (the scan saw N as max, but another writer had just taken N+1).
    """
    with _COUNTER_LOCK:
        n = start() if callable(start) else start
        while True:
            filename = make_name(n)
            path = os.path.join(folder, filename)
            try:
                # O_EXCL atomically claims the name across processes too.
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.close(fd)
                return path, filename, n
            except FileExistsError:
                n += 1
                if n > limit:
                    raise RuntimeError(
                        f"[Pixaroma] {label} — could not find a free output filename."
                    )
            except OSError as e:
                # read-only folder, AV lock, dead network share, ... - a clear
                # message instead of a raw traceback
                raise RuntimeError(
                    f"[Pixaroma] {label} — cannot write in '{folder}': {e}"
                )


def _cleanup(paths):
    for p in paths:
        if p and os.path.exists(p):
            try:
                os.remove(p)
            except OSError:
                pass


def encode_frames(cmd, frames, out_path, temp_paths=(), label="Save Mp4"):
    """Run ffmpeg with `frames` piped to stdin as raw rgb24. Returns True when
    the video was trimmed early by a clean -shortest finalize (so the caller can
    say so), False otherwise. Raises RuntimeError on a genuine ffmpeg failure.

    Cleans up on EVERY failure path: the temp files, and the claimed-but-empty
    or partial `out_path`, so output/ has no 0-byte junk and the counter does not
    drift past it. A successful -shortest trim keeps its valid file.
    """
    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
        )
    except Exception:
        # Popen failed (e.g. ffmpeg vanished). Don't leak the temp files, and
        # remove the 0-byte output file we already claimed (O_EXCL). This is the
        # one failure path that claims the file but cannot reach the encode
        # finally below.
        _cleanup(list(temp_paths) + [out_path])
        raise

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

    broke_pipe = False
    success = False
    try:
        try:
            for i in range(frames.shape[0]):
                comfy.model_management.throw_exception_if_processing_interrupted()
                frame_u8 = (frames[i].clamp(0.0, 1.0).cpu().numpy() * 255.0
                            ).astype(np.uint8)
                proc.stdin.write(frame_u8.tobytes())
        except BrokenPipeError:
            # ffmpeg closed its input before we fed every frame. This is the
            # EXPECTED outcome when trim_to_audio adds -shortest and the audio
            # is shorter than the frames: ffmpeg finalizes the mp4 at the
            # audio's end and exits, so the remaining frame writes break the
            # pipe. The output is already complete (trimmed to the audio).
            # Stop feeding; a genuine ffmpeg failure still surfaces as a
            # non-zero exit code below.
            broke_pipe = True
        try:
            if not proc.stdin.closed:
                proc.stdin.close()
        except OSError:
            pass
        proc.wait()
        drain_thread.join()
        if proc.returncode != 0:
            stderr = b"".join(stderr_chunks).decode("utf-8", errors="replace")
            raise RuntimeError(
                f"[Pixaroma] {label} — ffmpeg failed (exit {proc.returncode}):\n"
                f"{stderr}"
            )
        success = True  # rc 0 (incl. a -shortest broke_pipe) -> valid output
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
        _cleanup(temp_paths)
        if not success:
            _cleanup([out_path])

    return broke_pipe
