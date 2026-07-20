"""
Outpaint Pixaroma - pad an image with a solid colour for an outpaint LoRA.

Pads each side with `color` (mid grey by default), then optionally scales the
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

# Custom wire type carrying everything Outpaint Stitch Pixaroma needs to put the
# pristine original back onto the outpaint result: the FULL original image plus
# the pad amounts per side (so the stitch knows where the original sits in the
# padded canvas). A plain duplicated string so node_outpaint_stitch.py's matching
# constant stays decoupled (no cross-file import chain), like PIXAROMA_CROP_INFO.
PIXAROMA_OUTPAINT_INFO = "PIXAROMA_OUTPAINT_INFO"

DEFAULT_STATE = {
    "version": 1,
    "mode": "ratio",
    "ratio": "3:2",
    "anchor": "centre",
    "top": 0, "bottom": 0, "left": 0, "right": 0,
    "limit": 0,
    # Mid grey, not green: a LoRA trained on a green fill learns the colour as
    # well as the shape and bleeds a green cast over the WHOLE generated image
    # (reported from real use, 2026-07-17). Neutral grey has no hue to bleed.
    # MUST match js/outpaint/core.mjs's DEFAULT_STATE.
    "color": "#808080",
    "snap": 0,
    "collapsed": False,
}

_MAX_MP = 64  # _apply_max_mp's ceiling; a custom limit can be anything up to it
_SNAPS = (0, 8, 16, 32, 64)
_ANCHORS = ("left", "centre", "right", "top", "middle", "bottom")
_MAX_PAD = 8192
_MAX_DIM = 16384  # the engine's _clamp_dims ceiling; padding must not exceed it


def _fit_pad(pad_a, pad_b, extent):
    """Shrink two opposite-side pads so extent + pad_a + pad_b <= _MAX_DIM, the
    same ceiling _apply_pad's result is clamped to. Keeps the split proportional
    so the image stays where the anchor put it. Returns (pad_a, pad_b) unchanged
    when they already fit. This runs BEFORE _apply_pad allocates the canvas, so
    an absurd pad can no longer OOM the run (see outpaint)."""
    room = max(0, _MAX_DIM - int(extent))
    total = int(pad_a) + int(pad_b)
    if total <= room:
        return int(pad_a), int(pad_b)
    if total <= 0:
        return 0, 0
    fa = int(pad_a) * room // total
    return fa, room - fa


def _tensor_to_pils(image_t):
    """[B,H,W,C] float32 0..1 -> list of RGB PIL images. Mirrors the helper in
    node_image_resize.py; each node keeps its own copy rather than growing the
    shared engine."""
    out = []
    arr = image_t.detach().cpu().numpy()
    for i in range(arr.shape[0]):
        frame = np.clip(arr[i] * 255.0 + 0.5, 0, 255).astype(np.uint8)
        # ComfyUI's IMAGE is 3- or 4-channel, but a misbehaving upstream node can
        # hand over 1, 2 or 5+ channels; Image.fromarray(..., "RGB") would then
        # crash the run. Normalise every case to RGB, matching Save Image's own
        # defensive coercion, rather than letting a bad wire kill the outpaint.
        ch = frame.shape[2]
        if ch >= 3:
            frame = frame[:, :, :3]           # RGB, dropping alpha / extras
        elif ch == 2:
            frame = np.repeat(frame[:, :, :1], 3, axis=2)  # grey + a spare -> grey
        else:  # ch == 1
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
        # Any megapixel target the user picks, not a fixed allowlist: the settings
        # panel lets them add custom values now. Accept anything finite in
        # [0, _MAX_MP] (0 = no scaling); _apply_max_mp clamps to the same ceiling.
        st["limit"] = lim if (math.isfinite(lim) and 0 <= lim <= _MAX_MP) else 0
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
        "Mid grey is the default fill. Any colour works, but a strongly "
        "coloured fill can tint the whole generated image, because a model "
        "trained to replace it learns the colour as well as the shape. Grey "
        "is neutral, so it has no hue to bleed.\n\n"
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
        "Info for Outpaint Stitch Pixaroma - carries the pristine original and "
        "where it sits in the padded canvas, so after the model fills the new "
        "area you can put the original back at full quality. Optional; wire it "
        "into Outpaint Stitch Pixaroma, or leave it unused.",
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

    RETURN_TYPES = ("IMAGE", "INT", "INT", PIXAROMA_OUTPAINT_INFO)
    RETURN_NAMES = ("image", "width", "height", "outpaint_info")
    FUNCTION = "outpaint"
    CATEGORY = "👑 Pixaroma/✂️ Resize & Crop"

    def outpaint(self, image, OutpaintState=""):
        st = _parse_state(OutpaintState)
        pils = _tensor_to_pils(image)
        if not pils:
            return (image, 0, 0, None)

        src_w, src_h = pils[0].size
        if st["mode"] == "ratio":
            t, b, l, r = _pads_for_ratio(src_w, src_h, st["ratio"], st["anchor"])
        else:
            t, b, l, r = st["top"], st["bottom"], st["left"], st["right"]

        # Cap the padded size to the engine ceiling BEFORE building the canvas.
        # _apply_pad allocates Image.new at the full pre-clamp size and only
        # _clamp_dims shrinks the RESULT - so an unbounded pad would allocate
        # gigabytes and MemoryError the run before the clamp runs. This is
        # reachable two ways: a hand-edited extreme ratio (1:1000 -> millions of
        # px, _pads_for_ratio has no _MAX_PAD clamp), and plain sides mode with
        # all four edges at the 8192 field max on a large source (up to 32768**2
        # = 3 GB). The final size is clamped to 16384 either way, so fitting the
        # pads down first loses nothing and just avoids the giant allocation.
        t, b = _fit_pad(t, b, src_h)
        l, r = _fit_pad(l, r, src_w)

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

        # Tier 2 of the preview. The node takes a TENSOR, which the browser
        # cannot see; when upstream is a Load Image the frontend has its own
        # imgs[0] to draw, but a VAE Decode mid-chain populates nothing, so the
        # preview would stay empty forever. Hand the input frame over through
        # temp/ instead. Text Overlay does exactly this and is not an OUTPUT_NODE
        # either, which is the proof a plain node's ui payload reaches the JS.
        #
        # FULL RESOLUTION on purpose. Downscaling would be cheaper, but the
        # preview reads the picture's naturalWidth to work out both the pads and
        # the size badge, so a smaller stash would quietly make both of them lie
        # about what the run produces.
        ui = {}
        try:
            if folder_paths is not None:
                temp_dir = folder_paths.get_temp_directory()
                os.makedirs(temp_dir, exist_ok=True)
                # A fresh uuid per run doubles as the cache-buster: reusing one
                # name would let the browser show the previous run's frame.
                fname = "pixaroma_outpaint_base_%s.png" % uuid.uuid4().hex[:12]
                pils[0].save(os.path.join(temp_dir, fname), "PNG", optimize=False)
                ui["pixaroma_outpaint_base"] = [
                    {"filename": fname, "subfolder": "", "type": "temp"}
                ]
        except Exception as e:
            # A preview is never worth failing a real run over.
            print("[Outpaint Pixaroma] base preview stash failed:", e)

        # Everything in ui must be strict-JSON-safe. One NaN and the frontend's
        # JSON.parse of the whole websocket message throws, silently dropping
        # every other node's payload along with this one. Only plain strings
        # reach it here, so there is nothing to sanitise.
        #
        # outpaint_info carries the PRISTINE original (the untouched input tensor)
        # and the per-side pads AFTER _fit_pad, so Outpaint Stitch Pixaroma knows
        # exactly where the original sits in the padded canvas (l, t) and its full
        # size (src_w, src_h). canvas_w/h are what _apply_pad built, pre-max_mp -
        # the size the stitch scales the result back up to. The info never leaves
        # Python (it is a typed wire, not part of ui), so a tensor here is fine.
        info = {
            "original": image,
            "left": int(l), "top": int(t), "right": int(r), "bottom": int(b),
            "orig_w": int(src_w), "orig_h": int(src_h),
            "canvas_w": int(src_w + l + r), "canvas_h": int(src_h + t + b),
        }
        return {"ui": ui, "result": (out, int(out_w), int(out_h), info)}


NODE_CLASS_MAPPINGS = {"PixaromaOutpaint": PixaromaOutpaint}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaOutpaint": "Outpaint Pixaroma"}
