"""Save Video Pixaroma - save an mp4 to ANY folder on disk (or output/), with
filename tokens, a live "Will save as" preview, two quality formats, and an
in-node player.

Save Image Pixaroma's face married to Save Mp4's encoder. Save Mp4 stays exactly
as it is: it is the quick one, this is the full one.

The node face and the settings panel live in js/save_video/. State arrives via
the hidden SaveVideoState input, injected by the frontend at graphToPrompt time
(Vue Compat #9). %NodeName.widget% tokens (e.g. %Seed Pixaroma.seed%) are
resolved FRONTEND-side before injection; everything else is resolved here.

The encoder itself is nodes/_video_encode_helpers.py, shared with Save Mp4 - read
.claude/patterns/save-mp4.md before touching anything it does.
"""

import json
import os
import re
import time
import uuid
from collections import OrderedDict

import folder_paths

from ._path_guard import (
    folder_allowed as _pix_folder_allowed,
    prescreen_folder_field as _pix_prescreen_field,
    denied_message as _pix_denied_message,
)
from ._save_helpers import (
    _expand_date_tokens,
    _metadata_disabled,
    _next_counter,
    _resolve_save_folder,
    _safe_prefix,
    strip_stale_preview,
)
from ._video_encode_helpers import (
    audio_fade_args,
    build_video_meta_tags,
    claim_counter_path,
    encode_frames,
    validate_rgb_frames,
    metadata_movflags,
    write_ffmetadata_tags,
    _resolve_ffmpeg,
    _write_wav_pcm16,
)

LABEL = "Save Video"

# Keys MUST match js/save_video/state.mjs::DEFAULT_STATE.
DEFAULT_STATE = {
    "version": 1,
    "folder": "",
    "pattern": "Video_%date:yyyy-MM-dd%_%counter%",
    "format": "mp4",            # "mp4" (H.264 8-bit) | "mp4hq" (H.265 10-bit)
    "quality": 75,              # 1-100, mapped to the encoder's CRF below
    "bitDepth": 10,             # 8 | 10 - only read for mp4hq
    "trimToAudio": False,
    "audioFadeMs": 0,           # ms of fade-in on the sound; 0 = off (see audio_fade_args)
    "embedWorkflow": True,
    "saveOnRun": True,
    "dateStyle": "yyyy-MM-dd",  # JS-only (what the + Date chip inserts)
    "counterDigits": 3,         # %counter% zero-padding (001 = 3)
    "folded": False,            # JS-only (node body collapsed on the canvas)
    "hideBarWhenFolded": False, # JS-only (also hide the toolbar when folded)
    # JS-only: which optional buttons the face shows. Absent/true = shown, so an
    # older saved workflow keeps every button.
    "showOpen": True,
    "showDownload": True,
    "showFolder": True,
    "showMp4": True,
    "showMp4Hq": True,
}

# The two formats, single source of truth for the encoder flags AND the quality
# mapping. Adding a third (WebM/VP9 for transparency, ProRes for editing) should
# be one row here plus one row in the JS FORMATS table.
#
# Bit depth rides along with the FORMAT on purpose. A bare "8 or 10 bit" switch
# would let someone pick 10-bit H.264 (High 10), which is the option that sounds
# most obvious and is the least playable thing here: no hardware decoder
# implements it, so plenty of players and phones simply refuse the file. H.265
# Main 10 is a real, widely implemented profile, so that is the 10-bit route.
FORMATS = {
    "mp4": {
        "ext": ".mp4",
        "vcodec": "libx264",
        "tag": None,
        "pix8": "yuv420p",
        "pix10": None,          # deliberately no 10-bit H.264 - see above
        "crf_best": 14,
        "crf_worst": 32,
        "extra": [],
    },
    "mp4hq": {
        "ext": ".mp4",
        "vcodec": "libx265",
        # Without hvc1 the stream is tagged hev1, which Safari, QuickTime and
        # several players refuse outright. Measured: the file plays with it.
        "tag": "hvc1",
        "pix8": "yuv420p",
        "pix10": "yuv420p10le",
        "crf_best": 16,
        "crf_worst": 34,
        # x265 prints a dozen [info] banner lines to stderr regardless of
        # ffmpeg's own -loglevel, which buries a real error in the console.
        "extra": ["-x265-params", "log-level=error"],
    },
}

_DEFAULT_FORMAT = "mp4"


def format_def(fmt):
    """Look up a format, tolerating an unknown value from a hand-edited state
    blob rather than raising mid-save."""
    return FORMATS.get(str(fmt or "").lower(), FORMATS[_DEFAULT_FORMAT])


def quality_to_crf(quality, fmt):
    """Map the face's Quality 1-100 to the encoder's CRF.

    CRF runs BACKWARDS (lower means better), which is a bad thing to put in
    front of anyone, so the UI shows quality and this converts.

    The anchor that matters: quality_to_crf(75, "mp4") == 19, which is exactly
    what Save Mp4 hardcodes - so a default Save Video and a default Save Mp4
    produce the same encode. The harness pins that.

    JS mirror: js/save_video/state.mjs::qualityToCrf - keep the two in lockstep.
    """
    f = format_def(fmt)
    try:
        q = max(1, min(100, int(quality)))
    except Exception:
        q = 75
    span = f["crf_worst"] - f["crf_best"]
    # floor(x + 0.5) rather than round(), because Python's round() is banker's
    # rounding and JS's Math.round is not - the mirror would drift by one at
    # every .5 (the Longest Side parity trap).
    return int(f["crf_best"] + (100 - q) / 99.0 * span + 0.5)


def format_duration(n_frames, fps):
    """Clip length in seconds as a FILENAME-SAFE string.

    Whole numbers print plain ("5"), anything else gets one decimal with a
    HYPHEN instead of a dot ("3-4"), because a dot in the middle of a filename
    reads like a file extension.

    JS mirror: js/save_video/state.mjs::formatDuration.
    """
    try:
        fps = float(fps)
        if fps <= 0:
            return "0"
        secs = int(n_frames) / fps
    except Exception:
        return "0"
    rounded = int(secs * 10 + 0.5) / 10.0
    if abs(rounded - round(rounded)) < 1e-9:
        return str(int(round(rounded)))
    return ("%.1f" % rounded).replace(".", "-")


# Extensions stripped off a wired `name` value so "clip.mp4" doesn't become
# "clip.mp4_00001.mp4". Only known media extensions - "take_v1.2" keeps its dot.
_MEDIA_EXT_RE = re.compile(
    r"\.(png|jpe?g|webp|gif|bmp|tiff?|avif|mp4|mov|webm|mkv|m4v)$", re.IGNORECASE
)

# ── token-served previews (files saved OUTSIDE ComfyUI's folders) ────────────
# /view can only serve input/output/temp, so the node's player fetches an
# external file through /pixaroma/api/save_video/file?t=<token>. The registry
# maps opaque tokens to EXACT paths this session wrote - the client never sends
# a path, so there is no traversal surface. Bounded FIFO; dies with the process.
_SERVE_TOKENS = OrderedDict()
_SERVE_CAP = 64


def _register_serve_token(path):
    tok = uuid.uuid4().hex
    _SERVE_TOKENS[tok] = path
    while len(_SERVE_TOKENS) > _SERVE_CAP:
        _SERVE_TOKENS.popitem(last=False)
    return tok


def resolve_serve_token(tok):
    """Exact-token lookup used by the serving route. None for anything else."""
    return _SERVE_TOKENS.get(str(tok or ""))


def _expand_native_tokens(s):
    """Expand ComfyUI's native %year% %month% %day% %hour% %minute% %second%
    tokens. This node bypasses folder_paths.get_save_image_path (it saves to
    arbitrary folders), so it has to expand them itself, exactly as Save Image
    does - a real user report when Save Image first shipped without it."""
    if not isinstance(s, str) or "%" not in s:
        return s
    now = time.localtime()
    for k, v in (
        ("%year%", f"{now.tm_year:04}"),
        ("%month%", f"{now.tm_mon:02}"),
        ("%day%", f"{now.tm_mday:02}"),
        ("%hour%", f"{now.tm_hour:02}"),
        ("%minute%", f"{now.tm_min:02}"),
        ("%second%", f"{now.tm_sec:02}"),
    ):
        s = s.replace(k, v)
    return s


def _strip_stale_preview(extra):
    """Drop every Save Video node's remembered clip (`pixSvLastRun`) from the
    EMBEDDED workflow copy, so a video dragged back into ComfyUI does not show
    the PREVIOUS run's clip. Reasoning + the copy-never-mutate rule live in
    _save_helpers.strip_stale_preview."""
    return strip_stale_preview(extra, "PixaromaSaveVideo", "pixSvLastRun")


class PixaromaSaveVideo:
    DESCRIPTION = (
        "Save Video Pixaroma - save an mp4 to any folder on your computer, not just ComfyUI's "
        "output folder, with the same filename tools as Save Image Pixaroma and a player built "
        "into the node. Type or paste a folder path, or click Browse to pick one with your "
        "system's own folder dialog; leave the field empty to use the output folder. The "
        "filename field supports tokens and shows a live 'Will save as' preview of the exact "
        "file that will be written. Tokens: %input% (the wired name input), %date:yyyy-MM-dd% "
        "(and any date or time format), %counter% (auto-incrementing, never overwrites), "
        "%width%, %height%, %fps%, %frames%, %duration%, plus node references like "
        "%Seed Pixaroma.seed%. Use / in the name to create subfolders.\n\n"
        "Two formats. MP4 is H.264 at 8-bit and plays everywhere, which is why it is the "
        "default. MP4 HQ is H.265 at 10-bit: gradients like skies and fades stay smooth "
        "instead of banding, and the file is roughly half the size, but it needs a reasonably "
        "recent player. Open the settings with the gear on the node or by right-clicking it "
        "for quality, colour depth, date style, counter digits, trim to audio, workflow "
        "embedding, and which buttons the node shows.\n\n"
        "The whole workflow is saved inside the mp4, so you can drag the video back onto "
        "the canvas later and get the graph back, exactly like dragging a PNG. It is "
        "stored the same way ComfyUI's own video saving stores it, so ComfyUI reads it "
        "back on its own.\n\n"
        "The Save and Preview pills switch between writing to your folder on every run and "
        "writing to ComfyUI's temp folder instead, which is cleared on restart, so you can "
        "iterate without filling your folder. ffmpeg is found automatically: it prefers the "
        "one bundled with imageio-ffmpeg (pip install imageio-ffmpeg, no system setup) and "
        "falls back to ffmpeg on your PATH. Both formats need even width and height, and the "
        "node says so clearly rather than letting ffmpeg fail."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_frames": ("IMAGE", {
                    "tooltip": "The frames to encode, as an image batch. Wire a video source, an "
                               "AudioReact Pixaroma video_frames output, or any node that produces "
                               "a batch of images. They must be RGB and have even width and height."}),
                "fps": ("FLOAT", {
                    "default": 24.0, "min": 1.0, "max": 240.0, "step": 1.0,
                    "tooltip": "Frames per second for the saved video. Wire the fps output of "
                               "whatever produced the frames so the two always agree, or type a "
                               "number. Also available in the filename as the %fps% token."}),
            },
            "optional": {
                "audio": ("AUDIO", {
                    "tooltip": "Optional sound track, mixed into the mp4 as AAC 192k. If the audio "
                               "cannot be read the video is still saved, just without it. Turn on "
                               "'Trim to audio' in the settings to end the video where the audio ends."}),
                "name": ("STRING", {
                    "forceInput": True,
                    "tooltip": "Optional text used by the %input% token in the filename, for example "
                               "wire the filename output of a loader here to keep the original name. "
                               "To save into a folder named after this text, put a slash after the "
                               "token: %input%/clip_%counter%."}),
            },
            "hidden": {
                "SaveVideoState": "STRING",
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Always re-execute so every Run actually saves. Without this, deleting
        # the saved files and clicking Run again does NOTHING (ComfyUI's
        # input-hash cache skips the node) - a real day-one report on Save Image.
        # Touches no filesystem, so there is no second guarded entry point here.
        return float("nan")

    def save(self, video_frames, fps, audio=None, name=None, SaveVideoState="",
             prompt=None, extra_pnginfo=None, unique_id=None):
        state = dict(DEFAULT_STATE)
        try:
            data = json.loads(SaveVideoState) if SaveVideoState else {}
            if isinstance(data, dict):
                state.update(data)
        except Exception:
            pass

        fmt_id = str(state.get("format", _DEFAULT_FORMAT)).lower()
        if fmt_id not in FORMATS:
            fmt_id = _DEFAULT_FORMAT
        fmt = FORMATS[fmt_id]
        ext = fmt["ext"]
        crf = quality_to_crf(state.get("quality", 75), fmt_id)
        # 10-bit only where the format actually supports it; MP4 (H.264) has no
        # pix10 entry, so it stays 8-bit whatever the setting says.
        # guarded like its neighbours below: a hand-edited state blob can hold a
        # string or a dict here, and an unguarded int() would raise a raw
        # traceback instead of degrading
        try:
            want10 = int(state.get("bitDepth", 10) or 8) >= 10
        except Exception:
            want10 = True
        pix_fmt = fmt["pix10"] if (want10 and fmt["pix10"]) else fmt["pix8"]
        embed = bool(state.get("embedWorkflow", True))
        trim_to_audio = bool(state.get("trimToAudio", False))
        save_on = bool(state.get("saveOnRun", True))
        try:
            digits = max(1, min(8, int(state.get("counterDigits", 3))))
        except Exception:
            digits = 3

        fps_int = max(1, int(round(float(fps))))

        frames = video_frames
        # Shape and even-dimension refusal FIRST, before anything claims a file,
        # so a refusal cannot orphan a 0-byte mp4 (save-mp4 pattern #14).
        n_frames, H, W = validate_rgb_frames(frames, LABEL, pix_fmt)

        # CONTAINMENT (path-containment pattern). `folder` arrives in the hidden
        # SaveVideoState blob and /prompt is unauthenticated, so this string is
        # attacker-controlled. prescreen FIRST, on the raw string with no
        # filesystem touch, because _resolve_save_folder calls realpath, which on
        # Windows reaches out over SMB for a UNC path before we would otherwise
        # get a look at it. It must be the _FIELD variant: _resolve_save_folder
        # expandvars() the string before resolving, so the plain prescreen would
        # screen a DIFFERENT value than the one that gets realpath'd.
        folder_raw = state.get("folder", "")
        if not _pix_prescreen_field(folder_raw):
            raise ValueError(_pix_denied_message(str(folder_raw)))
        folder_abs, inside_output = _resolve_save_folder(folder_raw)
        if not _pix_folder_allowed(folder_abs):
            raise ValueError(_pix_denied_message(folder_abs))

        # Preview mode: write to ComfyUI's temp/ (cleared on restart) instead of
        # the user's folder, keeping the SAME name so the "Will save as" line
        # stays honest. /view serves temp, so the player needs no token here.
        if not save_on:
            # realpath, to match how the output branch resolves its root. The
            # relpath at the end of this function realpaths the root it compares
            # against, so a RAW temp dir here disagrees with it whenever
            # <base>/temp is a junction or symlink - which is the exact
            # split-across-drives setup the path guard exists to support. Same
            # drive it yields a subfolder full of "..", which /view refuses and
            # the player shows blank; different drive os.path.relpath RAISES,
            # killing a run whose file had already been written.
            folder_abs = os.path.realpath(folder_paths.get_temp_directory())
            inside_output = False
            file_type = "temp"
        else:
            file_type = "output" if inside_output else "external"

        ffmpeg_path = _resolve_ffmpeg(LABEL)

        # ---- resolve the filename pattern ----
        pattern = str(state.get("pattern") or DEFAULT_STATE["pattern"])
        input_name = ""
        if name is not None:
            input_name = name if isinstance(name, str) else str(name)
            input_name = _MEDIA_EXT_RE.sub("", input_name.strip())
            # Separators in a WIRED value would create surprise subfolders;
            # folders belong to the PATTERN (type / there), not to a wired name.
            input_name = input_name.replace("\\", "_").replace("/", "_")
        resolved = pattern.replace("%input%", input_name)
        resolved = _expand_date_tokens(resolved)
        resolved = _expand_native_tokens(resolved)
        resolved = (
            resolved.replace("%width%", str(W))
            .replace("%height%", str(H))
            .replace("%fps%", str(fps_int))
            .replace("%frames%", str(n_frames))
            .replace("%duration%", format_duration(n_frames, fps_int))
        )
        note = None
        rel = _safe_prefix(resolved)
        if not rel:
            rel = "Video_%counter%"
            note = "filename pattern was invalid, used 'Video_%counter%'"

        parts = [p for p in rel.split("/") if p]
        base_tpl = parts[-1] if parts else "Video_%counter%"
        sub_dirs = parts[:-1]
        # %counter% in a FOLDER segment resolves against existing sibling dirs,
        # so take_%counter%/clip makes take_001, take_002 per run rather than a
        # folder literally named take_%counter%.
        if sub_dirs and any("%counter%" in d for d in sub_dirs):
            resolved_dirs = []
            parent = folder_abs
            for d in sub_dirs:
                if "%counter%" in d:
                    d = d.replace("%counter%", f"{_next_counter(parent, d):0{digits}}")
                resolved_dirs.append(d)
                parent = os.path.join(parent, d)
            sub_dirs = resolved_dirs
        target_dir = os.path.join(folder_abs, *sub_dirs) if sub_dirs else folder_abs
        try:
            os.makedirs(target_dir, exist_ok=True)
        except Exception as e:
            raise RuntimeError(f"{LABEL} Pixaroma: cannot create folder '{target_dir}': {e}")

        # Claim the name atomically so files NEVER overwrite. A pattern without
        # %counter% auto-suffixes instead of bumping a counter.
        has_counter = "%counter%" in base_tpl
        if has_counter:
            def _make_name(n):
                return base_tpl.replace("%counter%", f"{n:0{digits}}") + ext
            start = lambda: _next_counter(target_dir, base_tpl + ext)  # noqa: E731
        else:
            def _make_name(n):
                return (base_tpl + ext) if n == 0 else f"{base_tpl}_{n:0{digits}}{ext}"
            start = 0
        out_path, out_filename, _n = claim_counter_path(
            target_dir, _make_name, start=start, limit=99999999, label=LABEL,
        )

        # ---- audio ----
        # The WHOLE block is inside the try, not just the write. `audio` is an
        # OPTIONAL input and nothing guarantees it is the standard
        # {"waveform", "sample_rate"} dict: an any-type passthrough node (ours or
        # anyone's) can hand over a list, a bare tensor or a string, and
        # audio.get(...) would then raise AttributeError straight out of save()
        # AFTER out_path was claimed - crashing the run AND orphaning a 0-byte
        # mp4. Deliberately NO isinstance(audio, dict) gate: a legitimate mapping
        # that is not literally a dict still works, and anything else degrades
        # here with its reason printed (save-mp4 pattern #13).
        temp_audio_path = None
        try:
            if audio is not None and audio.get("waveform") is not None \
                    and audio["waveform"].numel() > 0:
                temp_audio_path = os.path.join(
                    folder_paths.get_temp_directory(),
                    f"pixaroma_save_video_{uuid.uuid4().hex}.wav",
                )
                os.makedirs(os.path.dirname(temp_audio_path), exist_ok=True)
                _write_wav_pcm16(temp_audio_path, audio["waveform"],
                                 audio["sample_rate"], LABEL)
        except Exception as e:
            print(f"[Pixaroma] {LABEL} — could not prepare audio ({e}); encoding without it.")
            if temp_audio_path is not None and os.path.exists(temp_audio_path):
                try:
                    os.remove(temp_audio_path)
                except OSError:
                    pass
            temp_audio_path = None

        # ---- workflow metadata ----
        # Written as separate workflow/prompt tags via an FFMETADATA FILE (not a command
        # line arg) so a big workflow cannot blow the Windows command-line length
        # limit. The stale-preview strip matters here for the same reason it does
        # on Save Image: the workflow is frozen at QUEUE time, so the node's
        # memory of its last clip is the run BEFORE this one.
        metadata_path = None
        if embed and not _metadata_disabled():
            meta_tags = build_video_meta_tags(prompt, _strip_stale_preview(extra_pnginfo))
            if meta_tags:
                try:
                    metadata_path = os.path.join(
                        folder_paths.get_temp_directory(),
                        f"pixaroma_save_video_meta_{uuid.uuid4().hex}.txt",
                    )
                    os.makedirs(os.path.dirname(metadata_path), exist_ok=True)
                    write_ffmetadata_tags(metadata_path, meta_tags)
                except Exception as e:
                    print(f"[Pixaroma] {LABEL} — could not prepare metadata ({e}); saving without it.")
                    if metadata_path is not None and os.path.exists(metadata_path):
                        try:
                            os.remove(metadata_path)
                        except OSError:
                            pass
                    metadata_path = None

        # ---- build the ffmpeg command ----
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
        # The FFMETADATA input has no A/V streams, so it never disturbs ffmpeg's
        # stream auto-selection or -shortest; it goes last and is pulled in with
        # -map_metadata <its input index>.
        meta_input_index = None
        if metadata_path is not None:
            meta_input_index = 1 + (1 if temp_audio_path is not None else 0)
            cmd += ["-i", metadata_path]
        cmd += ["-c:v", fmt["vcodec"], "-preset", "medium", "-crf", str(crf),
                "-pix_fmt", pix_fmt]
        cmd += fmt["extra"]
        if fmt["tag"]:
            cmd += ["-tag:v", fmt["tag"]]
        if temp_audio_path is not None:
            cmd += ["-c:a", "aac", "-b:a", "192k"]
            # Only when there IS audio - an -af with no audio stream is an error.
            cmd += audio_fade_args(state.get("audioFadeMs", 0))
            if trim_to_audio:
                cmd += ["-shortest"]
        if meta_input_index is not None:
            cmd += ["-map_metadata", str(meta_input_index)]
            # Both flags are the read-back contract - see metadata_movflags().
            cmd += metadata_movflags()
        cmd += [out_path]

        depth = "10-bit" if pix_fmt.endswith("10le") else "8-bit"
        print(f"[Pixaroma] {LABEL} [{'preview' if not save_on else 'save'}] — "
              f"{n_frames} frames @ {fps_int}fps ({W}x{H}, {fmt['vcodec']}, {depth}, "
              f"crf={crf}{', +audio' if temp_audio_path else ''}) -> {out_filename}")

        broke_pipe = encode_frames(
            cmd, frames, out_path,
            temp_paths=[temp_audio_path, metadata_path],
            label=LABEL,
        )
        if broke_pipe:
            print(f"[Pixaroma] {LABEL} — video trimmed to the audio length (trim to audio is on).")
        print(f"[Pixaroma] {LABEL} — saved {out_path}")

        # ---- ui payload ----
        # Inside output/ (or temp/ in preview mode): a standard /view entry, and
        # the `images` key as well so the Assets panel refreshes - Save Mp4 does
        # the same and the frontend copes with a video there.
        # Outside: only our own key, with an opaque token, because /view cannot
        # serve an arbitrary path.
        entry = {"filename": out_filename, "format": "video/mp4"}
        status = {
            "saved": 1,
            "folder": target_dir,
            "w": W,
            "h": H,
            "frames": n_frames,
            "fps": fps_int,
            "duration": round(n_frames / float(fps_int), 2),
            "format": fmt_id,
            "depth": depth,
            "crf": crf,
            "inside_output": inside_output,
            "saved_to_disk": bool(save_on),
        }
        if note:
            status["note"] = note
        entry["_pixaroma_status"] = status

        if file_type == "external":
            entry["path"] = out_path
            entry["token"] = _register_serve_token(out_path)
            entry["type"] = "external"
            return {"ui": {"pixaroma_save_video": [entry]}}

        root = (folder_paths.get_temp_directory() if file_type == "temp"
                else folder_paths.get_output_directory())
        sub = os.path.relpath(target_dir, os.path.realpath(root))
        entry["subfolder"] = "" if sub == "." else sub.replace("\\", "/")
        entry["type"] = file_type
        return {"ui": {"images": [entry], "pixaroma_save_video": [entry]}}


NODE_CLASS_MAPPINGS = {"PixaromaSaveVideo": PixaromaSaveVideo}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSaveVideo": "Save Video Pixaroma"}
