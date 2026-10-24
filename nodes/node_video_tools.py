"""Video Tools Pixaroma - join, trim, reverse, loop and fade video clips from
any video model, with their sound, in one node.

Up to three clips come in as frames (+ their sound). Each can lose frames at
the start and the end and play backwards; then they are joined (a straight
cut, a crossfade, or a dip to black), optionally matched in colour at each
seam, looped (repeat, ping-pong, or a seamless loop), and faded in / out. The
sound follows every step sample for sample.

Thin wrapper: the work lives in _video_tools_helpers.py (pure torch, tested by
D:\\Claude Tests\\_video_tools\\engine_test.py). The settings live on
node.properties.videoTools in the browser and arrive through the hidden
VideoToolsState input (js/video_tools/index.js graphToPrompt). Adds NO route
and NO subprocess: the node's moving preview is an animated WebP written by PIL
into ComfyUI's temp folder, like core's Save Animated WEBP.
"""

import os
import uuid

import torch

from ._video_tools_helpers import MAX_CLIPS, parse_state, process

_PREVIEW_H = 240        # the moving preview on the node: small, it only has to show the joins
_PREVIEW_FPS = 12
_PREVIEW_MAX = 240      # frames in the preview, at most
_THUMB_H = 72


def _frames_or_none(v):
    """An optional input is not type-guaranteed: only a real batch of frames counts."""
    try:
        if isinstance(v, torch.Tensor) and v.dim() in (3, 4) and v.numel() > 0:
            return v if v.dim() == 4 else v.unsqueeze(0)
    except Exception:
        pass
    return None


def _to_pil(frame, height):
    from PIL import Image
    arr = (frame[..., :3].float().clamp(0, 1) * 255).round().to(torch.uint8).cpu().numpy()
    im = Image.fromarray(arr, "RGB")
    if im.height != height:
        w = max(1, int(round(im.width * height / im.height)))
        im = im.resize((w, height), Image.BILINEAR)
    return im


def _temp_name(unique_id, ext):
    tag = "".join(ch if ch.isalnum() else "_" for ch in str(unique_id or "x"))[:40]
    return f"pixaroma_vt_{tag}_{uuid.uuid4().hex[:10]}.{ext}"


def _save_preview(frames, fps, unique_id):
    """A small looping animated WebP of the result for the node face. A
    courtesy: failing to write it never fails the run."""
    try:
        import folder_paths
        n = frames.shape[0]
        pfps = min(float(fps), float(_PREVIEW_FPS))
        step = max(1.0, float(fps) / pfps, n / float(_PREVIEW_MAX))
        idx = sorted({min(n - 1, int(i * step)) for i in range(int(n / step) + 1)})
        pics = [_to_pil(frames[i], min(_PREVIEW_H, frames.shape[1])) for i in idx]
        folder = folder_paths.get_temp_directory()
        os.makedirs(folder, exist_ok=True)
        name = _temp_name(unique_id, "webp")
        ms = int(round(1000.0 * step / float(fps)))
        pics[0].save(os.path.join(folder, name), save_all=True, append_images=pics[1:], duration=max(20, ms),
                     loop=0, quality=70, method=2)
        return {"filename": name, "subfolder": "", "type": "temp"}
    except Exception as e:
        print(f"[PixaromaVideoTools] could not write the preview: {e}")
        return None


def _save_thumb(frame, unique_id, height=_THUMB_H):
    try:
        import folder_paths
        folder = folder_paths.get_temp_directory()
        os.makedirs(folder, exist_ok=True)
        name = _temp_name(unique_id, "jpg")
        _to_pil(frame, min(height, frame.shape[0])).save(os.path.join(folder, name), quality=88)
        return {"filename": name, "subfolder": "", "type": "temp"}
    except Exception as e:
        print(f"[PixaromaVideoTools] could not write a clip picture: {e}")
        return None


def _still_index(pl, total):
    """The frame the node shows while the preview is not playing: the middle of
    the first crossfade (what you most want to check), else the middle of the
    first clip (a dip to black or a fade would show a black frame)."""
    i = pl["clips"][0]["kept"] // 2
    for j in pl["joins"]:
        if j["kind"] == "crossfade" and j["frames"]:
            i = j["at"] + j["frames"] // 2
            break
    # That is a place in the joined clips; a seamless loop starts `blend`
    # frames later (repeat and ping-pong start with the clips as they are).
    if pl["loop"] == "seamless":
        i -= pl["blend"]
    return max(0, min(total - 1, i))


class PixaromaVideoTools:
    DESCRIPTION = (
        "Join, trim, reverse, loop and fade video clips from any video model, together with "
        "their sound. Wire up to three clips (the frames, and the sound if they have one) and "
        "set what to do on the node: cut frames off the start or end of each clip, play one "
        "backwards, join them with a crossfade or a dip to black, match their colours where "
        "they meet, loop the result (repeat, ping-pong or a seamless loop) and fade in or out. "
        "The sound follows every step.\n\n"
        "Wire video_frames from Load Video or a video model's VAE Decode into video_1, and fps "
        "from Load Video. The result goes into Save Video. After a Run the node shows the "
        "clips on a timeline and a small moving preview.\n\n"
        "Find it by searching for video, join, merge, combine, concatenate, trim, cut, reverse, "
        "loop, ping pong, boomerang, crossfade, transition, fade or colour match."
    )

    CATEGORY = "👑 Pixaroma/🖼️ Image"
    FUNCTION = "run"
    RETURN_TYPES = ("IMAGE", "AUDIO", "INT", "FLOAT", "FLOAT")
    RETURN_NAMES = ("video_frames", "audio", "frame_count", "fps", "duration")
    OUTPUT_TOOLTIPS = (
        "The finished frames. Wire them into Save Video (or Save Mp4) to save the video.",
        "The finished sound, exactly as long as the frames. Nothing comes out when no clip had sound.",
        "How many frames the finished video has.",
        "The frames per second, the same as the fps input. Wire it into Save Video's fps.",
        "How long the finished video is, in seconds.",
    )

    @classmethod
    def INPUT_TYPES(cls):
        clip_tip = (
            "Clip %d: the frames of a video (IMAGE), for example video_frames from Load Video "
            "Pixaroma or the frames out of a video model's VAE Decode."
        )
        sound_tip = "Optional. The sound of clip %d (AUDIO). Clips without sound are silent while they play."
        opt = {}
        for i in range(1, MAX_CLIPS + 1):
            opt["video_%d" % i] = ("IMAGE", {"tooltip": clip_tip % i})
            opt["audio_%d" % i] = ("AUDIO", {"tooltip": sound_tip % i})
        return {
            "required": {
                "fps": ("FLOAT", {
                    "default": 24.0, "min": 1.0, "max": 240.0, "step": 1.0,
                    "tooltip": (
                        "The frames per second of the clips. Wire fps from Load Video Pixaroma, or set "
                        "the rate your video model makes (MiniMax H3 makes 24)."
                    ),
                }),
            },
            "optional": opt,
            "hidden": {
                "VideoToolsState": "STRING",
                "unique_id": "UNIQUE_ID",
            },
        }

    def run(self, fps=24.0, VideoToolsState=None, unique_id=None, **clips):
        st = parse_state(VideoToolsState)
        try:
            fps = float(fps)
        except (TypeError, ValueError):
            fps = 24.0
        if not fps > 0:
            fps = 24.0
        videos = [_frames_or_none(clips.get("video_%d" % i)) for i in range(1, MAX_CLIPS + 1)]
        audios = [clips.get("audio_%d" % i) for i in range(1, MAX_CLIPS + 1)]
        frames, sound, pl = process(videos, audios, fps, st)

        info_clips = []
        for c in pl["clips"]:
            v = videos[c["slot"]]
            a = audios[c["slot"]]
            thumb = _save_thumb(v[c["start"] if not c["reverse"] else c["end"] - 1], unique_id)
            info_clips.append({
                "slot": c["slot"] + 1, "frames": c["frames"], "kept": c["kept"],
                "width": int(v.shape[2]), "height": int(v.shape[1]),
                "audio": bool(isinstance(a, dict) and isinstance(a.get("waveform"), torch.Tensor)),
                "thumb": thumb,
            })
        total = int(frames.shape[0])
        entry = {
            "clips": info_clips, "total": total, "fps": fps, "duration": total / fps,
            "width": int(frames.shape[2]), "height": int(frames.shape[1]), "audio": sound is not None,
            "preview": _save_preview(frames, fps, unique_id) if st["preview"] == "animated" else None,
            "still": _save_thumb(frames[_still_index(pl, total)], unique_id, _PREVIEW_H),
        }
        return {"ui": {"pixaroma_video_tools": [entry]},
                "result": (frames, sound, total, fps, total / fps)}


NODE_CLASS_MAPPINGS = {"PixaromaVideoTools": PixaromaVideoTools}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaVideoTools": "Video Tools Pixaroma"}
