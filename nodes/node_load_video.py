"""Load Video Pixaroma — upload/pick a video, decode it to a frame batch plus
audio and metadata, with a built-in <video> preview on the node body.

The partner to Save Mp4 Pixaroma: Load Video's `frames`/`audio` outputs wire
straight into Save Mp4's `video_frames`/`audio` inputs. Decode + audio logic
lives in nodes/_video_helpers.py (PyAV primary, imageio fallback, ffmpeg for
audio) so the node file stays thin.
"""

import os

import folder_paths

from ._video_helpers import VIDEO_EXTS, decode, extract_audio


def _list_input_videos():
    """Video files in ComfyUI's input/ folder (walked recursively so uploads in
    input/pixaroma/ and any user subfolders appear). Paths are relative to
    input/ with forward slashes, matching folder_paths.get_annotated_filepath."""
    input_dir = folder_paths.get_input_directory()
    files = []
    if os.path.isdir(input_dir):
        for root, _dirs, fnames in os.walk(input_dir):
            rel_root = os.path.relpath(root, input_dir)
            for fname in fnames:
                ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
                if ext not in VIDEO_EXTS:
                    continue
                rel = fname if rel_root == "." else os.path.join(rel_root, fname)
                files.append(rel.replace("\\", "/"))
    return sorted(files)


class PixaromaLoadVideo:
    DESCRIPTION = (
        "Load Video Pixaroma - upload or pick a video and decode it to a frame "
        "batch, with a built-in video preview on the node so you can watch the "
        "source without leaving ComfyUI.\n\n"
        "Outputs: frames (the video as an image batch), audio, frame_count, "
        "fps, width, height, and duration - so you usually do not need a "
        "separate video-info node. Pairs with Save Mp4 Pixaroma: wire frames "
        "and audio straight across.\n\n"
        "Loading controls: Max frames caps how many frames load (a safety valve "
        "for long clips), Force FPS resamples to a steady frame rate, Skip first "
        "frames trims the start, Every Nth frame thins the clip, and Custom "
        "width/height resize each frame as it loads.\n\n"
        "Reads with PyAV when available, otherwise imageio; audio is pulled with "
        "ffmpeg. No extra setup is needed on most ComfyUI installs."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video": (_list_input_videos(), {
                    "tooltip": "The video to load from ComfyUI's input folder. Use the 'choose video to upload' button, or pick one from the dropdown (and the arrows to flip through)."}),
                "max_frames": ("INT", {"default": 0, "min": 0, "max": 100000, "step": 1,
                    "tooltip": "The most frames to load. 0 = load every frame. A safety valve: long videos can be thousands of frames, which can run out of memory. Set e.g. 120 to load just the first 120."}),
                "force_fps": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 240.0, "step": 1.0,
                    "tooltip": "Force a steady frames-per-second by dropping or duplicating frames (e.g. a 60fps clip forced to 24). 0 = keep the video's original rate. AI video models usually expect a fixed rate like 24."}),
                "skip_first_frames": ("INT", {"default": 0, "min": 0, "max": 100000, "step": 1,
                    "tooltip": "Skip this many frames from the start, like trimming an intro. 0 = start at the beginning."}),
                "select_every_nth": ("INT", {"default": 1, "min": 1, "max": 1000, "step": 1,
                    "tooltip": "Keep every Nth frame and skip the rest. 1 = every frame, 2 = every other frame (half as many). The fps output is adjusted so playback stays at real-time speed."}),
                "custom_width": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 1,
                    "tooltip": "Resize every frame to this width as it loads. 0 = keep the original. Set only width OR only height to scale proportionally; set both for an exact size."}),
                "custom_height": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 1,
                    "tooltip": "Resize every frame to this height as it loads. 0 = keep the original. Set only width OR only height to scale proportionally; set both for an exact size."}),
            },
        }

    CATEGORY = "👑 Pixaroma/🖼️ Image"
    RETURN_TYPES = ("IMAGE", "AUDIO", "INT", "FLOAT", "INT", "INT", "FLOAT")
    RETURN_NAMES = ("frames", "audio", "frame_count", "fps", "width", "height", "duration")
    OUTPUT_TOOLTIPS = (
        "The video as a batch of image frames, after any trim and resize.",
        "The video's soundtrack (empty if the file has no audio). Wire into Save Mp4 to keep the sound.",
        "How many frames were loaded.",
        "Frames per second of the loaded clip (adjusted for Force FPS and Every Nth frame).",
        "Frame width in pixels, after any resize.",
        "Frame height in pixels, after any resize.",
        "Length of the loaded clip in seconds.",
    )
    FUNCTION = "load"

    def load(self, video, max_frames=0, force_fps=0.0, skip_first_frames=0,
             select_every_nth=1, custom_width=0, custom_height=0):
        if not video:
            raise ValueError(
                "[Pixaroma] Load Video — no video selected. Click 'choose video "
                "to upload' or pick one from the dropdown."
            )
        path = folder_paths.get_annotated_filepath(video)
        if not path or not os.path.exists(path):
            raise ValueError(f"[Pixaroma] Load Video — file not found: {video}")

        result = decode(
            path,
            max_frames=max_frames,
            force_fps=force_fps,
            skip_first=skip_first_frames,
            every_nth=select_every_nth,
            custom_w=custom_width,
            custom_h=custom_height,
        )
        audio = extract_audio(path)

        print(
            f"[Pixaroma] Load Video — {os.path.basename(path)}: "
            f"{result['frame_count']} frames @ {result['fps']:.3f}fps, "
            f"{result['width']}x{result['height']}, {result['duration']:.3f}s"
            f"{' +audio' if audio else ''}"
        )
        return (
            result["frames"], audio, result["frame_count"], result["fps"],
            result["width"], result["height"], result["duration"],
        )

    @classmethod
    def IS_CHANGED(cls, video, **kwargs):
        # Re-run when the file's bytes could have changed. Widget values are
        # already part of the prompt, so ComfyUI re-runs on those automatically;
        # IS_CHANGED only needs the file signature. Cheaper than hashing content.
        try:
            path = folder_paths.get_annotated_filepath(video)
            st = os.stat(path)
            return f"{st.st_mtime_ns}:{st.st_size}"
        except Exception:
            return float("nan")

    @classmethod
    def VALIDATE_INPUTS(cls, video, **kwargs):
        if not video:
            return "No video selected."
        if not folder_paths.exists_annotated_filepath(video):
            return f"Video not found: {video}"
        return True


NODE_CLASS_MAPPINGS = {"PixaromaLoadVideo": PixaromaLoadVideo}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaLoadVideo": "Load Video Pixaroma"}
