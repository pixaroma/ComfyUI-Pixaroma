"""Longest Side Pixaroma - scale an image so its longer edge hits a chosen
size, optionally cropping it to a shape first.

The small sibling of Image Resize Pixaroma. It deliberately never asks for two
numbers: the size tab says how BIG, the shape chip says what SHAPE, and the step
button rounds both sides. Everything that needs an explicit width AND height
(fit inside, pad, match ratio) stays in Image Resize, which is what makes that
node eight rows tall and this one two.

All the arithmetic lives in _longest_side_helpers (pure, no torch), because the
browser mirrors it to paint the size preview on the node face and the two must
agree exactly. See .claude/patterns/ and the harness at
D:\\Claude Tests\\_longest_side_test.py.
"""

import json

import numpy as np
import torch
from PIL import Image

from ._longest_side_helpers import (
    ALLOWED_STEPS, DEFAULT_STATE, MIN_DIM, compute, parse_state,
)
from ._resize_helpers import _pick_resample


def _tensor_to_pils(image_t):
    """BHWC float tensor -> list of RGB PIL images.

    Defensive about the channel count the same way Image Resize is: ComfyUI
    IMAGE is normally 3-channel, but a stray grayscale image (or a mask rewired
    into the image slot) or an RGBA tensor must not crash a running workflow.
    """
    arr = (image_t.clamp(0, 1).cpu().numpy() * 255.0).round().astype(np.uint8)
    out = []
    for frame in arr:
        if frame.ndim == 2:                        # (H,W) grayscale
            frame = np.stack([frame] * 3, axis=-1)
        elif frame.shape[-1] >= 3:                 # RGB / RGBA (drop alpha)
            frame = frame[..., :3]
        else:                                      # 1- or 2-channel
            frame = np.repeat(frame[..., :1], 3, axis=-1)
        out.append(Image.fromarray(frame, "RGB"))
    return out


class PixaromaLongestSide:
    DESCRIPTION = (
        "Scale an image so its longest side is the size you pick, and "
        "optionally crop it to a shape on the way.\n\n"
        "Pick a size from the tabs (864, 1024, 1216 and so on) and the longer "
        "edge of the picture becomes exactly that, with the other edge "
        "following so nothing is squashed. It works the same for a tall photo "
        "or a wide one, so you never have to decide whether you mean width or "
        "height.\n\n"
        "The shape chips underneath crop the picture first. Keep leaves the "
        "shape alone and simply scales it. Pick 1:1, 16:9, 9:16 or any other "
        "shape and the biggest piece of that shape is taken from the middle of "
        "your picture, so nothing stretches and no empty bars appear. Which "
        "sizes and shapes appear, plus where the crop is taken from, are all in "
        "the settings behind the gear.\n\n"
        "The small button at the top steps through Off, 8, 16, 32 and 64, and "
        "rounds both sides to that step, because most models want sizes in "
        "steps like these. Outputs the finished image plus its width and "
        "height, ready to wire into a sampler."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "The picture to resize. Its longer edge becomes the size you picked on the node."}),
            },
            "hidden": {
                "LongestSideState": ("STRING", {"default": json.dumps(DEFAULT_STATE)}),
            },
        }

    CATEGORY = "👑 Pixaroma/✂️ Resize & Crop"
    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("image", "width", "height")
    OUTPUT_TOOLTIPS = (
        "The resized picture, cropped first if you picked a shape other than keep.",
        "The finished width in pixels, already rounded to the step if one is set.",
        "The finished height in pixels, already rounded to the step if one is set.",
    )
    FUNCTION = "run"
    # The face shows the run's result: a Run with nothing changed is cached, runs
    # no code, and re-sends that result only with this (ComfyUI 0.42 execution.py;
    # measured 2026-10-25: after a reload the face stayed empty, video-tools.md #8).
    HAS_INTERMEDIATE_OUTPUT = True

    def run(self, image, LongestSideState=""):
        state = parse_state(LongestSideState)

        frames = _tensor_to_pils(image)

        # A zero-length IMAGE batch has no frame to measure, so `frames[0]`
        # aborted the run with a bare IndexError that named neither this node
        # nor the reason. Nothing here can invent a truthful width and height,
        # so pass the empty batch straight through and say what happened in the
        # log - the fault is upstream, and stopping the whole queue for it helps
        # nobody.
        if not frames:
            print("[PixaromaLongestSide] the incoming image batch is empty; "
                  "passing it through unchanged")
            return {
                "ui": {"pixaroma_longest_side": [{
                    "in_w": 0, "in_h": 0, "out_w": 0, "out_h": 0, "cropped": False,
                }]},
                "result": (image, MIN_DIM, MIN_DIM),
            }

        in_w, in_h = frames[0].size

        plan = compute(in_w, in_h, state)
        cx, cy, cw, ch = plan["crop"]
        out_w, out_h = plan["size"]

        # Auto resampling wants to know whether this is a shrink or a grow, so
        # it can use Lanczos going down and Bilinear coming up.
        factor = (out_w / cw) if cw else 1.0
        resample = _pick_resample(state["resample"], factor)

        out = []
        for pil in frames:
            # A batch is normally uniform, but a frame that somehow differs
            # would make the shared crop box wrong, so re-plan for that frame
            # rather than cropping outside the image.
            if pil.size != (in_w, in_h):
                p = compute(pil.size[0], pil.size[1], state)
                fx, fy, fw, fh = p["crop"]
                fw_out, fh_out = p["size"]
            else:
                fx, fy, fw, fh = cx, cy, cw, ch
                fw_out, fh_out = out_w, out_h

            if (fx, fy, fw, fh) != (0, 0, pil.size[0], pil.size[1]):
                pil = pil.crop((fx, fy, fx + fw, fy + fh))
            if pil.size != (fw_out, fh_out):
                pil = pil.resize((fw_out, fh_out), resample)

            out.append(torch.from_numpy(np.array(pil).astype(np.float32) / 255.0)[None,])

        out_image = torch.cat(out, dim=0) if len(out) > 1 else out[0]

        ui = {"pixaroma_longest_side": [{
            "in_w": in_w, "in_h": in_h, "out_w": out_w, "out_h": out_h,
            "cropped": bool(plan["cropped"]),
        }]}
        return {"ui": ui, "result": (out_image, out_w, out_h)}


NODE_CLASS_MAPPINGS = {"PixaromaLongestSide": PixaromaLongestSide}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaLongestSide": "Longest Side Pixaroma"}
