"""
Outpaint Pixaroma - pad an image with a solid colour for an outpaint LoRA.

Pads each side with `color` (green by default), then optionally scales the
padded result to a megapixel limit, and reports the final size. Replaces
Load Image's Pad mode + Scale Image to Total Pixels + Get Image Size.

Why the compose: _resize_helpers._resize_frame dispatches to exactly ONE
mode, so pad and max_mp are mutually exclusive there. We call the two pure
functions in sequence instead. _resize_helpers.py is deliberately NOT
modified - four other nodes depend on it.
"""
import json
import math
import os
import uuid

import numpy as np
import torch
from PIL import Image

from ._resize_helpers import _apply_max_mp, _apply_pad, _round_half_up

try:
    import folder_paths
except ImportError:  # keeps the module importable in a bare test harness
    folder_paths = None

DEFAULT_STATE = {
    "version": 1,
    "mode": "ratio",
    "ratio": "3:2",
    "anchor": "centre",
    "top": 0, "bottom": 0, "left": 0, "right": 0,
    "limit": 0,
    "color": "#00ff00",
    "snap": 0,
    "collapsed": False,
}

_LIMITS = (0, 1, 1.5, 2)
_SNAPS = (0, 8, 16, 32, 64)
_ANCHORS = ("left", "centre", "right", "top", "middle", "bottom")
_MAX_PAD = 8192


def _tensor_to_pils(image_t):
    """[B,H,W,C] float32 0..1 -> list of RGB PIL images. Mirrors the helper in
    node_image_resize.py; each node keeps its own copy rather than growing the
    shared engine."""
    out = []
    arr = image_t.detach().cpu().numpy()
    for i in range(arr.shape[0]):
        frame = np.clip(arr[i] * 255.0 + 0.5, 0, 255).astype(np.uint8)
        if frame.shape[2] == 4:
            frame = frame[:, :, :3]
        elif frame.shape[2] == 1:
            frame = np.repeat(frame, 3, axis=2)
        out.append(Image.fromarray(frame, "RGB"))
    return out


def _parse_state(state_json):
    """Merge a hidden-state JSON over the defaults, coercing every field.
    Must tolerate anything: a hand-edited API file can put any type here."""
    st = dict(DEFAULT_STATE)
    if not state_json or not isinstance(state_json, str):
        return st
    try:
        raw = json.loads(state_json)
    except Exception:
        return st
    if not isinstance(raw, dict):
        return st

    if raw.get("mode") in ("ratio", "sides"):
        st["mode"] = raw["mode"]
    if isinstance(raw.get("ratio"), str):
        st["ratio"] = raw["ratio"]
    if raw.get("anchor") in _ANCHORS:
        st["anchor"] = raw["anchor"]
    for k in ("top", "bottom", "left", "right"):
        try:
            st[k] = max(0, min(int(raw.get(k, 0)), _MAX_PAD))
        # OverflowError matters: json.loads accepts the literal Infinity as a
        # documented extension, and int(inf) raises OverflowError, NOT ValueError
        # - so without it a hand-edited API file carrying Infinity would take the
        # whole node down, breaking this function's "tolerate anything" promise.
        except (TypeError, ValueError, OverflowError):
            st[k] = 0
    try:
        lim = float(raw.get("limit", 0))
        st["limit"] = lim if lim in _LIMITS else 0
    except (TypeError, ValueError, OverflowError):
        st["limit"] = 0
    c = raw.get("color")
    if isinstance(c, str) and len(c) == 7 and c[0] == "#":
        try:
            int(c[1:], 16)
            st["color"] = c
        except ValueError:
            pass
    try:
        sn = int(raw.get("snap", 0))
        st["snap"] = sn if sn in _SNAPS else 0
    except (TypeError, ValueError, OverflowError):
        st["snap"] = 0
    return st


def _parse_ratio(text):
    """'3:2' -> (3.0, 2.0). Returns None when unusable."""
    if not isinstance(text, str) or ":" not in text:
        return None
    a, _, b = text.partition(":")
    try:
        rw, rh = float(a), float(b)
    except (TypeError, ValueError):
        return None
    # float() accepts "inf" and "nan"; core.mjs's FINITE_NUMBER regex does not,
    # so without this the two sides disagree and the preview lies. Both would
    # also slip past the guard below: inf is > 0, and nan fails EVERY comparison
    # so "nan <= 0" is False. Reject them outright rather than padding by
    # infinity or by nothing-in-particular.
    if not math.isfinite(rw) or not math.isfinite(rh):
        return None
    if rw <= 0 or rh <= 0:
        return None
    return rw, rh


def _pads_for_ratio(src_w, src_h, ratio_text, anchor):
    """Grow src to the target aspect. ONLY ONE AXIS EVER GROWS, which is why
    the UI needs three anchor chips, not nine cells. Returns (t, b, l, r).

    The anchor names WHERE THE GREEN GOES: anchor "right" pads on the right.
    That is deliberately the OPPOSITE of _resize_helpers._anchor_offsets,
    where the anchor names where the image sticks. Two reasons: the anchor
    row exists to pick the side a one-sided-green LoRA repaints, and "sides"
    mode already means green-per-edge (right: 512 = 512px of green on the
    right), so the word has to mean the same thing in both modes of this
    node. Do not "correct" this back to the _anchor_offsets convention."""
    r = _parse_ratio(ratio_text)
    if not r:
        return 0, 0, 0, 0
    rw, rh = r
    target = rw / rh
    cur = src_w / src_h if src_h else 1.0

    if abs(target - cur) < 1e-6:
        return 0, 0, 0, 0

    if target > cur:  # wider: grow horizontally
        add = _round_half_up(src_h * target) - src_w
        if add <= 0:
            return 0, 0, 0, 0
        if anchor in ("left", "top"):
            return 0, 0, add, 0
        if anchor in ("right", "bottom"):
            return 0, 0, 0, add
        half = add // 2
        return 0, 0, half, add - half

    # _round_half_up, never the built-in round(): Python's round() is banker's
    # rounding (round(1498.5) = 1498) while JS Math.round always goes up, so a
    # built-in round() here would make the live preview disagree with the real
    # output at exact .5 boundaries - a 999-tall source at 3:2 hits it.
    add = _round_half_up(src_w / target) - src_h  # taller: grow vertically
    if add <= 0:
        return 0, 0, 0, 0
    if anchor in ("top", "left"):
        return add, 0, 0, 0
    if anchor in ("bottom", "right"):
        return 0, add, 0, 0
    half = add // 2
    return half, add - half, 0, 0


class PixaromaOutpaint:
    DESCRIPTION = (
        "Pads an image with a solid colour so an outpainting model can fill "
        "the new area in, then optionally scales the result down to a "
        "megapixel limit and reports the final size.\n\n"
        "Green is the default fill because outpainting LoRAs are usually "
        "trained to replace a solid green area, but any colour works.\n\n"
        "To ratio grows the image to a target shape and the anchor decides "
        "which side the new space appears on. By side lets you set an exact "
        "number of pixels per edge. The megapixel limit is optional: with it "
        "off the image keeps its padded size.\n\n"
        "The width and height outputs report the FINAL size, so they can feed "
        "an empty latent directly."
    )
    OUTPUT_TOOLTIPS = (
        "The padded image, scaled to the megapixel limit when one is set.",
        "Final width in pixels, after padding and any scaling.",
        "Final height in pixels, after padding and any scaling.",
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {
                    "tooltip": "The image to pad. Wire any image source here."
                }),
            },
            "hidden": {"OutpaintState": ("STRING", {"default": ""})},
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("image", "width", "height")
    FUNCTION = "outpaint"
    CATEGORY = "👑 Pixaroma/✂️ Resize & Crop"

    def outpaint(self, image, OutpaintState=""):
        st = _parse_state(OutpaintState)
        pils = _tensor_to_pils(image)
        if not pils:
            return (image, 0, 0)

        src_w, src_h = pils[0].size
        if st["mode"] == "ratio":
            t, b, l, r = _pads_for_ratio(src_w, src_h, st["ratio"], st["anchor"])
        else:
            t, b, l, r = st["top"], st["bottom"], st["left"], st["right"]

        limit = st["limit"]
        # Snap must fire ONCE. With a limit on, the pad pass runs unsnapped and
        # the max_mp pass does the snapping; otherwise both snap and the second
        # fights the first.
        pad_state = {
            "pad_top": t, "pad_bottom": b, "pad_left": l, "pad_right": r,
            "pad_color": st["color"],
            "snap": 0 if limit else st["snap"],
            "resample": "auto",
        }
        mp_state = {
            "max_mp": limit,
            "allow_upscale": True,  # scale to EXACTLY the limit, up or down
            "snap": st["snap"],
            "resample": "auto",
        }

        out_frames = []
        out_w = out_h = 0
        for pil in pils:
            # _apply_pad needs a mask; we have no mask output, so it is a
            # throwaway.
            blank = Image.new("L", pil.size, 0)
            rgb, msk, w, h = _apply_pad(pil, blank, pad_state, *pil.size)
            if limit:
                rgb, msk, w, h = _apply_max_mp(rgb, msk, mp_state, w, h)
            out_w, out_h = w, h
            out_frames.append(
                torch.from_numpy(np.array(rgb).astype(np.float32) / 255.0)[None,]
            )

        out = torch.cat(out_frames, dim=0).to(image.device)
        return (out, int(out_w), int(out_h))


NODE_CLASS_MAPPINGS = {"PixaromaOutpaint": PixaromaOutpaint}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaOutpaint": "Outpaint Pixaroma"}
