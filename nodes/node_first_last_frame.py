"""First Last Frame Pixaroma - the first and the last frame of a video, as two
images you can wire straight into Save Image.

The point of the node is continuation: render a clip, take its last frame, use
that as the start image of the next clip, and keep going.

TWO inputs because ComfyUI has two different things called "video" on the wire,
and they are not interchangeable:
  * video_frames (IMAGE) - a batch of frames, e.g. Load Video Pixaroma.
  * video (VIDEO)        - core's video object, e.g. ComfyUI's own Load Video.
Wire whichever you have. video_frames wins if both are connected.

The IMAGE path is pure tensor indexing. The VIDEO path prefers an ffmpeg
subprocess that lifts exactly two frames off the file (see
_first_last_helpers.py for why that is exact and why it is a subprocess), and
falls back to core's own get_components() whenever reading the file directly
would be wrong or impossible.

That fallback is a correctness floor, not a nice path. It decodes the WHOLE
clip into memory, which is what core's Get Video Components does too. MEASURED
on a 150-frame 1080x1920 clip (D:\\Claude Tests\\_first_last_memory.py): 7.16 GB
peak against 70 MB through ffmpeg, and 2.6x slower. The peak is double the
frame data because core builds a per-frame list and then stacks it, holding
both copies for a moment. Sample RSS from a background thread if you ever
re-measure it - reading before and after the call reports the residual, not the
peak, and made the fallback look like 61 MB.
"""

import os

import numpy as np
import torch

from ._comfy_api_compat import api_attrs
from ._first_last_helpers import grab_first_last


def _np_to_image(arr):
    """HxWx3 uint8 -> [1,H,W,3] float32 0..1, ComfyUI's IMAGE layout."""
    return torch.from_numpy(np.ascontiguousarray(arr).astype(np.float32) / 255.0)[None,]


def _first_last_from_images(images):
    """(first, last) as two [1,H,W,3] tensors, or None when there is nothing
    usable here.

    Deliberately defensive about the shape. An optional input is NOT
    type-guaranteed: an any-type passthrough (our own Switch, or another pack's)
    bypasses ComfyUI's type matching, so this slot can receive a bare 3-D frame
    or a list of batches, and assuming a 4-D tensor would raise out of the node.

    Pixels are passed through untouched. This node picks frames; it must never
    quietly convert or reshape them.
    """
    if images is None:
        return None

    if isinstance(images, (list, tuple)):
        pairs = [p for p in (_first_last_from_images(x) for x in images) if p is not None]
        if not pairs:
            return None
        # First of the first part, last of the last part. Correct even when the
        # parts have different frame sizes, which a plain torch.cat could not
        # survive at all.
        return pairs[0][0], pairs[-1][1]

    if not torch.is_tensor(images):
        return None
    batch = images
    if batch.ndim == 3:
        # A bare H,W,C frame - but ONLY if the last axis is a plausible channel
        # count. A [N,H,W] MASK batch has the same ndim, and promoting one would
        # build a valid-looking IMAGE with N channels that passes every check
        # here and only fails much later inside Save Image, by which point the
        # cause is not recoverable from the error.
        if batch.shape[-1] not in (1, 3, 4):
            return None
        batch = batch[None, ...]
    if batch.ndim != 4 or batch.shape[0] == 0:
        return None
    # clone, not a view: a view of frame 0 keeps the entire decoded batch alive
    # for as long as anything downstream holds the output. One frame is cheap.
    return batch[0:1].clone(), batch[-1:].clone()


# The two older routes to the same class (a backwards-compat module, then the
# private one), tried after the pinned API and `latest`.
_OLD_VIDEO_MODULES = ("comfy_api.input_impl", "comfy_api.latest._input_impl.video_types")


def _video_from_file_classes():
    """Every VideoFromFile class this ComfyUI has, as a tuple: the PINNED
    comfy_api version first, then `latest` (documented as unstable,
    _comfy_api_compat.py), then the two older routes. ALL of them are accepted,
    because the video on the wire was made by whichever one core's Load Video
    uses. Today they are one and the same class. Empty = none found."""
    found = []
    for cls in api_attrs("InputImpl.VideoFromFile") + api_attrs("VideoFromFile", _OLD_VIDEO_MODULES):
        if isinstance(cls, type) and cls not in found:
            found.append(cls)
    return tuple(found)


def _plain_file_path(video):
    """The video's own file on disk, but ONLY when reading it directly would
    give the same frames the wire is carrying. None otherwise, which sends the
    caller to get_components().

    Two things this must not get wrong:

    * get_stream_source() is only safe to call on a VideoFromFile. The default
      implementation on the VideoInput base class builds a BytesIO by ENCODING
      the whole video, so calling it hopefully on an unknown subclass would
      quietly re-encode the clip just to ask it a question.
    * A trimmed video (core's Video Slice) is still backed by the untrimmed
      file, so the file's first and last frames are NOT the ones on the wire.
      Fall through and let get_components() apply the trim.
    """
    classes = _video_from_file_classes()
    if not classes or not isinstance(video, classes):
        return None

    # Discriminate on PRESENCE, never on exception type. An earlier version of
    # this guard used `except AttributeError: pass` to mean "older build with no
    # trim concept", which left exactly the hole the guard exists to close:
    # get_active_trim_window() is only a pure accessor for a NON-NEGATIVE
    # start_time - for a negative one (core's Trim Video accepts down to -1e5)
    # it calls _get_raw_duration(), which opens the file with PyAV and reaches
    # for things like video_stream.codec.capabilities. An AttributeError from
    # in there is indistinguishable from a missing method, so a PyAV version
    # skew would have been read as "untrimmed" and the untrimmed file read -
    # silently wrong frames. Measured by mutation: of AttributeError /
    # ValueError / RuntimeError raised inside, only AttributeError reached the
    # file; the other two already failed safe.
    getter = getattr(video, "get_active_trim_window", None)
    if getter is not None:
        try:
            start, duration = getter()
        except Exception:
            # Cannot prove it is untrimmed, so do not read the file.
            return None
        if start or duration:
            return None

    try:
        source = video.get_stream_source()
    except Exception:
        return None
    if isinstance(source, str) and os.path.isfile(source):
        return source
    return None     # a BytesIO-backed video has no file to read


def _first_last_from_video(video):
    """(first, last) as two [1,H,W,3] tensors from a core VIDEO object."""
    path = _plain_file_path(video)
    if path:
        grabbed = grab_first_last(path)
        if grabbed is not None:
            first, last = grabbed
            return _np_to_image(first), _np_to_image(last)

    if not hasattr(video, "get_components"):
        # Not a video object at all. An any-type passthrough (our own Switch, or
        # another pack's) bypasses ComfyUI's type matching, so this slot can
        # receive anything - most usefully an IMAGE batch, which we can simply
        # answer instead of refusing. Anything else gets our own message rather
        # than an AttributeError naming a method the user has never heard of.
        pair = _first_last_from_images(video)
        if pair is not None:
            return pair
        raise ValueError(
            "[Pixaroma] First Last Frame - the video input received something "
            "that is not a video (a %s). Wire it to ComfyUI's Load Video, or "
            "use the video_frames input for a batch of frames."
            % type(video).__name__
        )

    # Fallback: core's own path. Always correct, always expensive.
    components = video.get_components()
    images = getattr(components, "images", None)
    pair = _first_last_from_images(images)
    if pair is None:
        raise ValueError(
            "[Pixaroma] First Last Frame - the wired video decoded to no "
            "frames at all. Check the file plays elsewhere."
        )
    return pair


class PixaromaFirstLastFrame:
    DESCRIPTION = (
        "First Last Frame Pixaroma - pulls the very first and the very last "
        "frame out of a video and sends them on as two images.\n\n"
        "The usual reason to want this: you have just rendered a video and you "
        "want to carry on from where it ended. Take the last frame, feed it in "
        "as the start image of the next video, and the two clips join up. "
        "Wire either output into Save Image to keep it as a picture.\n\n"
        "There are two inputs because ComfyUI has two different kinds of video "
        "on the wire. Use video_frames for a batch of frames, such as the "
        "video_frames output of Load Video Pixaroma. Use video for ComfyUI's "
        "own video type, such as the output of its Load Video node. Connect "
        "whichever one you have; you never need both. If both are connected, "
        "video_frames is the one that is used.\n\n"
        "Reading a video file only costs the two frames it needs, so pointing "
        "this at a long clip does not load the whole thing into memory."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "video_frames": ("IMAGE", {
                    "tooltip": "A batch of video frames, such as the video_frames output of Load Video Pixaroma. Any image batch works. If a single image is wired in, the first and last frame are both that image. Used in preference to the video input when both are connected."}),
                "video": ("VIDEO", {
                    "tooltip": "ComfyUI's own video type, such as the output of its Load Video node. Use this input when the video has not been turned into frames yet. Only the two frames that are needed are read, so a long clip stays cheap."}),
            },
        }

    CATEGORY = "👑 Pixaroma/🖼️ Image"
    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("first_frame", "last_frame")
    OUTPUT_TOOLTIPS = (
        "The very first frame of the video, as an image.",
        "The very last frame of the video, as an image. This is the one to feed into the next video when you want the clips to join up.",
    )
    FUNCTION = "run"

    def run(self, video_frames=None, video=None):
        source = "video_frames"
        pair = _first_last_from_images(video_frames)

        if pair is None and video is not None:
            source = "video"
            pair = _first_last_from_video(video)

        if pair is None:
            # Reached two ways, and telling someone to connect a wire they are
            # looking at is worse than saying nothing. A wired `video` never
            # lands here (it either works or raises its own message above), so
            # a connected `video_frames` is the only thing left to blame.
            if video_frames is not None:
                raise ValueError(
                    "[Pixaroma] First Last Frame - video_frames is connected "
                    "but carried no frames this run. Check the node feeding it "
                    "actually produced images."
                )
            raise ValueError(
                "[Pixaroma] First Last Frame - nothing is wired in. Connect "
                "video_frames (from Load Video Pixaroma, or any image batch) "
                "or video (from ComfyUI's Load Video)."
            )

        first, last = pair
        print(
            f"[Pixaroma] First Last Frame - from {source}: "
            f"{int(first.shape[2])}x{int(first.shape[1])}"
        )
        return (first, last)


NODE_CLASS_MAPPINGS = {"PixaromaFirstLastFrame": PixaromaFirstLastFrame}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaFirstLastFrame": "First Last Frame Pixaroma"}
