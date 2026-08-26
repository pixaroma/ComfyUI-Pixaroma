import os
import uuid

import folder_paths

# The encoder itself lives in _video_encode_helpers so Save Mp4 and Save Video
# share ONE copy (extracted 2026-08-10). Its invariants are recorded in
# .claude/patterns/save-mp4.md - read that before changing either file.
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

# Expands %date:...% and sanitises the prefix. The SAME helper the three sibling
# save nodes use (Save Image, Save Video, Preview Image), so the four cannot
# drift on what a filename may contain. See the fix note in save().
from ._save_helpers import _safe_prefix

# Honour ComfyUI's global --disable-metadata flag (same as SaveImage). Wrapped so
# the node still imports on a build that lacks it.
try:
    from comfy.cli_args import args as _comfy_cli_args
except Exception:
    _comfy_cli_args = None


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


class PixaromaSaveMp4:
    """Encode an IMAGE batch (and optional AUDIO) to a single H.264 mp4.
    save_mode=save writes to ComfyUI's output/ folder; save_mode=preview
    writes to ComfyUI's temp/ folder (auto-cleared on restart) so users can
    iterate without cluttering output/. Deliberately few knobs and opinionated
    defaults; Save Video Pixaroma is the one with folders and naming."""

    DESCRIPTION = (
        "Save Mp4 Pixaroma - encode an IMAGE batch (and optional AUDIO) to a "
        "single H.264 mp4 with a built-in <video> preview right on the node "
        "body so you can watch the result without leaving ComfyUI.\n\n"
        "Frames stream straight to ffmpeg's stdin (no temp PNG files); audio "
        "is muxed in as AAC 192k. Pairs with AudioReact Pixaroma but works "
        "with any source that produces frames + AUDIO.\n\n"
        "The whole workflow is saved inside the mp4, so you can drag the video "
        "back onto the canvas later and get the graph back, exactly like dragging "
        "a PNG. It is stored the same way ComfyUI's own video saving stores it, "
        "so ComfyUI reads it back on its own.\n\n"
        "ffmpeg binary is auto-located: imageio-ffmpeg's bundled exe is "
        "preferred (no system install needed - 'pip install imageio-ffmpeg'), "
        "with ffmpeg on PATH as a fallback. yuv420p requires even width and "
        "height; the node surfaces a clear error rather than ffmpeg's opaque "
        "crash if dimensions are odd.\n\n"
        "Encoder is hardcoded to libx264 / preset medium / CRF 19. Bring those "
        "back to INPUT_TYPES if a workflow needs per-clip control."
    )

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
                    "tooltip": "Filename stem. The node appends a 5-digit counter and .mp4 (e.g. Video_00001.mp4). Use '/' for subfolders, date tokens like %date:yyyy-MM-dd%, and node references like %Seed Pixaroma.seed% that print another node's field value into the name."}),
                "save_mode": (["save", "preview"], {"default": "save",
                    "tooltip": "save: write to ComfyUI's output/ folder, kept across restarts. preview: write to ComfyUI's temp/ folder, auto-cleared on restart, so use it while iterating and you will not clutter output/. The in-node video preview works the same in both modes."}),
                "trim_to_audio": ("BOOLEAN", {"default": False,
                    "tooltip": "Off (default): keep every video frame; the audio simply ends where it ends. On: end the video exactly at the audio's length (ffmpeg -shortest), for when the audio is the master (e.g. with Audio React). On can drop the last frame or two when the audio is slightly shorter than the video."}),
            },
            "optional": {
                "audio": ("AUDIO", {"tooltip": "Optional audio track to mux into the mp4 as AAC 192k. Connect Audio React Pixaroma's audio output here."}),
                # ⚠️ OPTIONAL, not required, and NOT for stylistic reasons.
                # A new REQUIRED input silently breaks every API-format prompt
                # captured before it existed: ComfyUI logs "Required input is
                # missing" then "Output will be ignored", DROPS the save node,
                # and still reports the whole prompt as SUCCESS. Measured here -
                # the video rendered for 30s and was thrown away with no error
                # anywhere the user would see. Optional means a prompt without
                # the field just gets the default.
                # Still listed AFTER the required block so widgets_values stays
                # positional-compatible with nodes saved before it existed.
                "audio_fade_ms": ("INT", {"default": 0, "min": 0, "max": 2000, "step": 10,
                    "tooltip": "Fade the sound in over this many milliseconds at the very start. 0 is off. AI video models often start their audio at full level in a single step, which is heard as a click; about 120 helps a lot and is too short to notice as a fade. Leave it at 0 when you are just re-saving a video whose sound you do not want altered."}),
            },
            # The workflow + prompt, embedded into the mp4 so dragging it back into
            # ComfyUI restores the graph (read by the drag-a-video loader).
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    def save(self, video_frames, fps, filename_prefix, save_mode, trim_to_audio,
             audio_fade_ms=0, audio=None, prompt=None, extra_pnginfo=None):
        crf = self._CRF
        pix_fmt = self._PIX_FMT
        fps_int = max(1, int(round(float(fps))))

        frames = video_frames
        # Empty batch, wrong channel count and odd dimensions all refuse here,
        # BEFORE anything claims a file, so a refusal cannot orphan a 0-byte mp4
        # (pattern #14). Shared with Save Video Pixaroma so the two cannot drift.
        n_frames, H, W = validate_rgb_frames(frames, "Save Mp4", pix_fmt)

        ffmpeg_path = _resolve_ffmpeg("Save Mp4")

        # Resolve subfolder + base filename via folder_paths (handles
        # filename_prefix that contains a subfolder like "videos/clip"); use
        # our own counter scan because Comfy's built-in one assumes the
        # `<prefix>_<N>_.<ext>` trailing-underscore convention and silently
        # returns 1 for our cleaner `<prefix>_<N>.mp4` naming.
        # save_mode picks the destination root: output/ for keepers, temp/
        # for ad-hoc previews (auto-cleared on ComfyUI restart). The JS
        # reads entry.type, so the in-node <video> works for both via /view.
        if save_mode == "preview":
            out_dir = folder_paths.get_temp_directory()
            file_type = "temp"
        else:
            out_dir = folder_paths.get_output_directory()
            file_type = "output"
        # Expand %date:...% and sanitise BEFORE handing the prefix on. Reported
        # 2026-08-08: the widget's tooltip promises date tokens, but this node
        # was the only one of the four save nodes that never expanded them, so
        # `Clip_%date:yyyy-MM-dd%` reached the filesystem with the colon still in
        # it. On Windows that is not an error - NTFS reads `name:stream` as an
        # alternate data stream, so the write "succeeds" into a hidden stream and
        # the user is left with a 0-byte file called `Clip_%date`, which is
        # exactly what was reported. Measured before the fix: the asked-for
        # filename never appears in the folder at all.
        #
        # _safe_prefix (not bare _expand_date_tokens) so this node also gains the
        # same illegal-character sanitising the siblings have. It returns None
        # only for genuinely unusable input (empty, over-long, leading slash, a
        # '..' segment), and the node falls back to its own default rather than
        # failing the run.
        #
        # The %Seed Pixaroma.seed% half of the tooltip needed nothing: those are
        # resolved in the browser at submit time by installFilenameTokenResolver
        # (js/save_mp4/index.js), so Python only ever sees the finished value.
        filename_prefix = _safe_prefix(filename_prefix) or "Video"
        full_folder, fname, _ignored, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, out_dir, W, H,
        )
        os.makedirs(full_folder, exist_ok=True)
        # Hold a lock around scan + claim so two save_mp4 nodes in the
        # same workflow can't both pick the same counter and overwrite
        # each other. Touch the file inside the lock to claim it - passing the
        # scan as a callable keeps it under the same lock, as the inline version
        # had it.
        out_path, out_filename, counter = claim_counter_path(
            full_folder,
            lambda n: f"{fname}_{n:05d}.mp4",
            start=lambda: _next_mp4_counter(full_folder, fname),
            label="Save Mp4",
        )

        # If audio is supplied, write it to a temp wav alongside so ffmpeg can
        # mux both inputs in a single pass.
        # The WHOLE block is inside the try, not just the write - the shape
        # checks and the makedirs are part of "preparing audio" too, and they
        # were the hole. Nothing guarantees `audio` is the standard
        # {"waveform", "sample_rate"} dict: it is an OPTIONAL input, and an
        # any-type passthrough node (ours or anyone's) can hand over a list, a
        # bare tensor or a string. `audio.get(...)` then raised AttributeError
        # straight out of save() - AFTER out_path was claimed with O_EXCL, so
        # the run died AND left a 0-byte mp4 orphaned in output/ forever,
        # because the cleanup `finally` further down only wraps the encode.
        # Reproduced with a list, a tensor and a string (2026-08-10). House
        # style is to degrade to video-only, never to crash the workflow.
        # Deliberately NO isinstance(audio, dict) gate: a legitimate mapping
        # that is not literally a dict still works, and anything else lands in
        # the except below and degrades with its reason printed.
        temp_audio_path = None
        try:
            if audio is not None and audio.get("waveform") is not None \
                    and audio["waveform"].numel() > 0:
                temp_audio_path = os.path.join(
                    folder_paths.get_temp_directory(),
                    f"pixaroma_save_mp4_{uuid.uuid4().hex}.wav",
                )
                os.makedirs(os.path.dirname(temp_audio_path), exist_ok=True)
                _write_wav_pcm16(temp_audio_path, audio["waveform"], audio["sample_rate"])
        except Exception as e:
            # Don't leak the partial WAV, and don't fail the whole save just
            # because audio prep failed - drop the audio and encode video only.
            print(f"[Pixaroma] Save Mp4 — could not prepare audio ({e}); "
                  f"encoding without it.")
            if temp_audio_path is not None and os.path.exists(temp_audio_path):
                try:
                    os.remove(temp_audio_path)
                except OSError:
                    pass
            temp_audio_path = None

        # Embed the workflow + prompt as separate mp4 tags, so dragging the
        # video back into ComfyUI restores the graph. Via an FFMETADATA file (not a
        # command-line arg) so a big workflow can't blow the Windows command-line
        # length limit. Skipped when metadata is globally disabled (--disable-metadata)
        # or when there's nothing to embed (e.g. a pure-API run).
        metadata_path = None
        disable_meta = bool(getattr(_comfy_cli_args, "disable_metadata", False))
        if not disable_meta:
            meta_tags = build_video_meta_tags(prompt, extra_pnginfo)
            if meta_tags:
                try:
                    metadata_path = os.path.join(
                        folder_paths.get_temp_directory(),
                        f"pixaroma_save_mp4_meta_{uuid.uuid4().hex}.txt",
                    )
                    os.makedirs(os.path.dirname(metadata_path), exist_ok=True)
                    write_ffmetadata_tags(metadata_path, meta_tags)
                except Exception as e:
                    print(f"[Pixaroma] Save Mp4 — could not prepare metadata ({e}); "
                          f"saving without it.")
                    if metadata_path is not None and os.path.exists(metadata_path):
                        try:
                            os.remove(metadata_path)
                        except OSError:
                            pass
                    metadata_path = None

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
        # The FFMETADATA input has no A/V streams, so it never disturbs ffmpeg's
        # video/audio auto-selection or -shortest; it's added last and pulled in via
        # -map_metadata <its input index>.
        meta_input_index = None
        if metadata_path is not None:
            meta_input_index = 1 + (1 if temp_audio_path is not None else 0)
            cmd += ["-i", metadata_path]
        cmd += [
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", str(crf),
            "-pix_fmt", pix_fmt,
        ]
        if temp_audio_path is not None:
            cmd += ["-c:a", "aac", "-b:a", "192k"]
            # Only when there IS audio - an -af with no audio stream is an error.
            cmd += audio_fade_args(audio_fade_ms)
            if trim_to_audio:
                cmd += ["-shortest"]
        if meta_input_index is not None:
            cmd += ["-map_metadata", str(meta_input_index)]
            # Both flags are the read-back contract - see metadata_movflags().
            cmd += metadata_movflags()
        cmd += [out_path]

        print(f"[Pixaroma] Save Mp4 [{save_mode}] — writing {n_frames} frames @ {fps_int}fps "
              f"({W}x{H}, crf={crf}, {pix_fmt}"
              f"{', +audio' if temp_audio_path else ''}) -> {out_filename}")

        # The frame pump, the stderr drain, the BrokenPipeError tolerance and the
        # cleanup-on-every-path live in _video_encode_helpers, shared with Save
        # Video Pixaroma. Every invariant in there is recorded in
        # .claude/patterns/save-mp4.md.
        broke_pipe = encode_frames(
            cmd, frames, out_path,
            temp_paths=[temp_audio_path, metadata_path],
            label="Save Mp4",
        )

        if broke_pipe:
            print("[Pixaroma] Save Mp4 — video trimmed to the audio length (trim_to_audio is on).")
        if save_mode == "preview":
            print(f"[Pixaroma] Save Mp4 — preview written to temp/ (auto-cleared on restart): {out_path}")
        else:
            print(f"[Pixaroma] Save Mp4 — saved {out_path}")

        # Two output keys so the file is visible BOTH in ComfyUI's standard
        # output panel and in our in-node <video> preview (js/save_mp4/index.js
        # listens for `pixaroma_videos`).
        entry = {
            "filename": out_filename,
            "subfolder": subfolder,
            "type": file_type,
            "format": "video/mp4",
        }
        return {"ui": {"images": [entry], "pixaroma_videos": [entry]}}


NODE_CLASS_MAPPINGS = {
    "PixaromaSaveMp4": PixaromaSaveMp4,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaSaveMp4": "Save Mp4 Pixaroma",
}
