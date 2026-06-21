"""Combine Pixaroma - join two inputs into one batch.

Takes any two inputs (any1 + any2) and merges them into a single output:
- images / video-frame batches (tensors [B,H,W,C]) are concatenated along the
  batch dimension; mismatched sizes are rescaled to the first input's W/H,
- latents (dicts with "samples") are batched the same way,
- numbers / strings are collected into a list,
- anything else (lists / tuples) is concatenated.

If one side is missing (None / unconnected) the other side passes through
unchanged - which is exactly what you want on the first round of a loop, when
there is nothing accumulated yet. Pairs with Loop Start / Loop End to pile up
each round's result.
"""

import torch

from ._type_helpers import ANY


class PixaromaCombine:
    DESCRIPTION = (
        "Join two inputs into one batch. Wire any two things into any1 and "
        "any2 and Combine merges them: images and video frames are stacked "
        "into one batch, latents are batched, numbers and text are gathered "
        "into a list. If one side is empty it just passes the other side "
        "through, so it is safe to use as the accumulator inside a loop "
        "(round 1 has nothing to add yet). Works with any wire type."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "any1": (ANY, {"tooltip": "First input. Images, video frames, latents, numbers, text - anything. Can be empty."}),
                "any2": (ANY, {"tooltip": "Second input, joined onto the first. In a loop this is usually the new round's result, with any1 carrying everything gathered so far."}),
            },
        }

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("batch",)
    OUTPUT_TOOLTIPS = (
        "The two inputs joined together. For images/frames this is one bigger batch; for numbers/text it is a list.",
    )
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma/🔀 Logic & Flow"

    @staticmethod
    def _latent_batch(a, b):
        import comfy.utils

        out = a.copy()
        s1 = a["samples"]
        s2 = b["samples"]
        if s1.shape[1:] != s2.shape[1:]:
            s2 = comfy.utils.common_upscale(s2, s1.shape[3], s1.shape[2], "bilinear", "center")
        out["samples"] = torch.cat((s1, s2), dim=0)
        out["batch_index"] = (
            a.get("batch_index", list(range(s1.shape[0])))
            + b.get("batch_index", list(range(s2.shape[0])))
        )
        return out

    @staticmethod
    def _kind(v):
        """A plain-English name for a value's type (for friendly errors)."""
        if isinstance(v, torch.Tensor):
            return "an image"
        if isinstance(v, dict) and "samples" in v:
            return "a latent"
        if isinstance(v, bool):
            return "a true/false value"
        if isinstance(v, str):
            return "text"
        if isinstance(v, (int, float)):
            return "a number"
        if isinstance(v, (list, tuple)):
            return "a list"
        return "that"

    @classmethod
    def _mix_msg(cls, a, b, want):
        return (
            "Combine Pixaroma can only join two things of the same kind. You "
            "gave it %s and %s. Wire %s into any1 and any2 (or leave one empty)."
            % (cls._kind(a), cls._kind(b), want)
        )

    def run(self, any1=None, any2=None):
        a, b = any1, any2

        # Empty side -> pass the other through (safe loop accumulator: round 1
        # has nothing to add yet).
        if a is None:
            return (b,)
        if b is None:
            return (a,)

        # Images / video-frame batches (tensors [B, H, W, C]) -> stack into one
        # batch. Both sides must be images, else a clear message.
        a_img, b_img = isinstance(a, torch.Tensor), isinstance(b, torch.Tensor)
        if a_img or b_img:
            if not (a_img and b_img):
                raise ValueError(self._mix_msg(a, b, "two images"))
            if a.shape[1:] != b.shape[1:]:
                import comfy.utils

                b = comfy.utils.common_upscale(
                    b.movedim(-1, 1), a.shape[2], a.shape[1], "bilinear", "center"
                ).movedim(1, -1)
            return (torch.cat((a, b), 0),)

        # Latents (dict with "samples") -> batch the same way.
        a_lat = isinstance(a, dict) and "samples" in a
        b_lat = isinstance(b, dict) and "samples" in b
        if a_lat or b_lat:
            if not (a_lat and b_lat):
                raise ValueError(self._mix_msg(a, b, "two latents"))
            return (self._latent_batch(a, b),)

        # Numbers / text -> gather into a list (bool excluded so it is not
        # treated as a number).
        a_sc = isinstance(a, (str, int, float)) and not isinstance(a, bool)
        b_sc = isinstance(b, (str, int, float)) and not isinstance(b, bool)
        if a_sc:
            if isinstance(b, tuple):
                return (b + (a,),)
            if isinstance(b, list):
                return (b + [a],)
            return ([a, b],)
        if b_sc:
            if isinstance(a, tuple):
                return (a + (b,),)
            if isinstance(a, list):
                return (a + [b],)
            return ([b, a],)

        # Lists / tuples -> concatenate; anything else, try to add, else a clear
        # message instead of a raw Python error.
        try:
            return (a + b,)
        except Exception:
            raise ValueError(self._mix_msg(a, b, "two things of the same kind"))


NODE_CLASS_MAPPINGS = {"PixaromaCombine": PixaromaCombine}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaCombine": "Combine Pixaroma"}
