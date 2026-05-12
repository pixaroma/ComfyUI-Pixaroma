"""Load Image Pixaroma — native LoadImage parity + inline resize.

Spec: docs/superpowers/specs/2026-05-11-load-image-pixaroma-design.md

Architecture mirrors Resolution Pixaroma (hidden input + graphToPrompt
injection of state JSON from node.properties).
"""

import hashlib
import json
import math
import os
from typing import Tuple

import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

import folder_paths
import node_helpers


DEFAULT_STATE = {
    "version": 1,
    "mode": "off",
    "max_mp": 1.0,
    "longest_side": 1024,
    "scale_factor": 1.0,
    "fit_w": 1024, "fit_h": 1024,
    "cover_w": 1024, "cover_h": 1024,
    "ratio_preset": "1:1",
    "ratio_w": 1, "ratio_h": 1,
    "ratio_action": "crop",
    "pad_color": "#000000",
    "snap": 0,
    "resample": "auto",
    "allow_upscale": True,
}


# ── Helpers ─────────────────────────────────────────────────────────────────


def _parse_state(state_json: str) -> dict:
    """Parse the hidden LoadImagePixState JSON. Falls back to DEFAULT_STATE
    on any parse error (CLAUDE.md Vue Compat #9 — state may be missing or
    malformed in subgraph / partial-prompt cases)."""
    if not state_json:
        return dict(DEFAULT_STATE)
    try:
        parsed = json.loads(state_json)
        merged = dict(DEFAULT_STATE)
        merged.update({k: v for k, v in parsed.items() if k in DEFAULT_STATE})
        return merged
    except Exception:
        print("[PixaromaLoadImage] Malformed state JSON, using defaults")
        return dict(DEFAULT_STATE)


def _hex_to_rgb(hex_str: str) -> Tuple[int, int, int]:
    """Parse '#RRGGBB' or '#RGB' into an (R, G, B) int tuple. Falls back to
    black on malformed input."""
    s = (hex_str or "").lstrip("#")
    try:
        if len(s) == 3:
            return tuple(int(c * 2, 16) for c in s)  # type: ignore[return-value]
        if len(s) == 6:
            return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
    except Exception:
        pass
    return (0, 0, 0)


def _pick_resample(mode: str, factor: float):
    """Map state.resample + computed scale factor to a PIL resampling const.
    Auto = Lanczos when shrinking, Bilinear when growing or equal."""
    table = {
        "nearest": Image.NEAREST,
        "bilinear": Image.BILINEAR,
        "bicubic": Image.BICUBIC,
        "lanczos": Image.LANCZOS,
    }
    if mode in table:
        return table[mode]
    return Image.LANCZOS if factor < 1.0 else Image.BILINEAR


def _clamp_dims(w: int, h: int) -> Tuple[int, int]:
    """Final post-resize safety clamp. Floor at 8 (avoid 0-pixel images from
    extreme snap rounding); ceiling at 16384 (prevent OOM crashes)."""
    return (max(8, min(int(w), 16384)), max(8, min(int(h), 16384)))


def _apply_snap(w: int, h: int, snap: int) -> Tuple[int, int]:
    """Round each dim to nearest multiple of snap (0 = off). Post-modifier
    that runs after the mode's math."""
    if not snap or snap <= 0:
        return (w, h)
    return (max(8, round(w / snap) * snap), max(8, round(h / snap) * snap))


# ── Per-mode resize functions ────────────────────────────────────────────────


def _resize_frame(
    pil_rgb: Image.Image,
    pil_mask: Image.Image,
    state: dict,
    orig_w: int,
    orig_h: int,
) -> Tuple[Image.Image, Image.Image, int, int]:
    """Apply state['mode'] resize to (pil_rgb, pil_mask). Returns the resized
    PIL images and the final (W, H). pil_mask is always resized with NEAREST
    to preserve hard edges; pil_rgb uses the state['resample'] picker."""

    mode = state.get("mode", "off")

    # Each mode function is responsible for producing (pil_rgb, pil_mask, w, h)
    # already snapped + clamped. Off is the passthrough baseline.
    dispatch = {
        "off": _apply_off,
        "max_mp": _apply_max_mp,
        "longest_side": _apply_longest_side,
        "scale_factor": _apply_scale_factor,
        "fit_inside": _apply_fit_inside,
        "cover": _apply_cover,
        "match_ratio": _apply_match_ratio,
    }
    fn = dispatch.get(mode, _apply_off)
    return fn(pil_rgb, pil_mask, state, orig_w, orig_h)


def _apply_off(pil_rgb, pil_mask, state, orig_w, orig_h):
    # Even Off honors snap, so the user can use Snap alone as a rounding mode.
    w, h = _apply_snap(orig_w, orig_h, state.get("snap", 0))
    w, h = _clamp_dims(w, h)
    if (w, h) == (orig_w, orig_h):
        return pil_rgb, pil_mask, w, h
    factor = w / orig_w
    resample = _pick_resample(state.get("resample", "auto"), factor)
    return (
        pil_rgb.resize((w, h), resample),
        pil_mask.resize((w, h), Image.NEAREST),
        w, h,
    )


def _apply_max_mp(pil_rgb, pil_mask, state, orig_w, orig_h):
    target = float(state.get("max_mp", 1.0))
    target = max(0.01, min(target, 64.0))  # sanity bounds
    current_mp = (orig_w * orig_h) / 1_000_000.0

    factor = math.sqrt(target / current_mp) if current_mp > 0 else 1.0
    if not state.get("allow_upscale", False):
        factor = min(factor, 1.0)
    factor = min(factor, 8.0)  # sanity ceiling

    new_w = round(orig_w * factor)
    new_h = round(orig_h * factor)
    new_w, new_h = _apply_snap(new_w, new_h, state.get("snap", 0))
    new_w, new_h = _clamp_dims(new_w, new_h)

    if (new_w, new_h) == (orig_w, orig_h):
        return pil_rgb, pil_mask, new_w, new_h
    resample = _pick_resample(state.get("resample", "auto"), factor)
    return (
        pil_rgb.resize((new_w, new_h), resample),
        pil_mask.resize((new_w, new_h), Image.NEAREST),
        new_w, new_h,
    )


def _apply_longest_side(pil_rgb, pil_mask, state, orig_w, orig_h):
    target = int(state.get("longest_side", 1024))
    target = max(8, min(target, 16384))
    long_dim = max(orig_w, orig_h)
    factor = target / long_dim if long_dim > 0 else 1.0
    if not state.get("allow_upscale", False):
        factor = min(factor, 1.0)
    factor = min(factor, 8.0)

    new_w = round(orig_w * factor)
    new_h = round(orig_h * factor)
    new_w, new_h = _apply_snap(new_w, new_h, state.get("snap", 0))
    new_w, new_h = _clamp_dims(new_w, new_h)

    if (new_w, new_h) == (orig_w, orig_h):
        return pil_rgb, pil_mask, new_w, new_h
    resample = _pick_resample(state.get("resample", "auto"), factor)
    return (
        pil_rgb.resize((new_w, new_h), resample),
        pil_mask.resize((new_w, new_h), Image.NEAREST),
        new_w, new_h,
    )


def _apply_scale_factor(pil_rgb, pil_mask, state, orig_w, orig_h):
    factor = float(state.get("scale_factor", 1.0))
    factor = max(0.01, factor)
    if not state.get("allow_upscale", False):
        factor = min(factor, 1.0)
    factor = min(factor, 8.0)

    new_w = round(orig_w * factor)
    new_h = round(orig_h * factor)
    new_w, new_h = _apply_snap(new_w, new_h, state.get("snap", 0))
    new_w, new_h = _clamp_dims(new_w, new_h)

    if (new_w, new_h) == (orig_w, orig_h):
        return pil_rgb, pil_mask, new_w, new_h
    resample = _pick_resample(state.get("resample", "auto"), factor)
    return (
        pil_rgb.resize((new_w, new_h), resample),
        pil_mask.resize((new_w, new_h), Image.NEAREST),
        new_w, new_h,
    )


def _apply_fit_inside(pil_rgb, pil_mask, state, orig_w, orig_h):
    tw = int(state.get("fit_w", 1024))
    th = int(state.get("fit_h", 1024))
    tw = max(8, min(tw, 16384))
    th = max(8, min(th, 16384))

    factor = min(tw / orig_w, th / orig_h)
    if not state.get("allow_upscale", False):
        factor = min(factor, 1.0)
    factor = min(factor, 8.0)

    new_w = round(orig_w * factor)
    new_h = round(orig_h * factor)
    new_w, new_h = _apply_snap(new_w, new_h, state.get("snap", 0))
    new_w, new_h = _clamp_dims(new_w, new_h)

    if (new_w, new_h) == (orig_w, orig_h):
        return pil_rgb, pil_mask, new_w, new_h
    resample = _pick_resample(state.get("resample", "auto"), factor)
    return (
        pil_rgb.resize((new_w, new_h), resample),
        pil_mask.resize((new_w, new_h), Image.NEAREST),
        new_w, new_h,
    )


def _apply_cover(pil_rgb, pil_mask, state, orig_w, orig_h):
    tw = int(state.get("cover_w", 1024))
    th = int(state.get("cover_h", 1024))
    tw = max(8, min(tw, 16384))
    th = max(8, min(th, 16384))

    factor = max(tw / orig_w, th / orig_h)
    allow_upscale = state.get("allow_upscale", False)

    if not allow_upscale and factor > 1.0:
        # Degrade: image too small to fill target without upscaling. Fall
        # back to Fit-inside math so the user gets a clean output instead of
        # an error. MUST pass cover_w/cover_h as the target via a fit_w/fit_h
        # alias — _apply_fit_inside reads fit_w/fit_h, NOT cover_w/cover_h.
        # Without this aliasing the user's Crop-to-fill target dims were
        # silently replaced by their separate Fit-inside settings, causing
        # the JS preview readout to disagree with the Python output.
        fallback_state = {**state, "fit_w": tw, "fit_h": th}
        return _apply_fit_inside(pil_rgb, pil_mask, fallback_state, orig_w, orig_h)

    factor = min(factor, 8.0)

    # Step 1: resize the source up/down by `factor` so one dim matches the
    # target and the other overflows.
    scaled_w = round(orig_w * factor)
    scaled_h = round(orig_h * factor)
    resample = _pick_resample(state.get("resample", "auto"), factor)
    rgb_scaled = pil_rgb.resize((scaled_w, scaled_h), resample)
    mask_scaled = pil_mask.resize((scaled_w, scaled_h), Image.NEAREST)

    # Step 2: center-crop scaled image to (tw, th).
    left = (scaled_w - tw) // 2
    top = (scaled_h - th) // 2
    right = left + tw
    bottom = top + th
    rgb_cropped = rgb_scaled.crop((left, top, right, bottom))
    mask_cropped = mask_scaled.crop((left, top, right, bottom))

    # Snap on final dims (post-crop). Snap may further resize.
    final_w, final_h = _apply_snap(tw, th, state.get("snap", 0))
    final_w, final_h = _clamp_dims(final_w, final_h)
    if (final_w, final_h) != (tw, th):
        rgb_cropped = rgb_cropped.resize((final_w, final_h), resample)
        mask_cropped = mask_cropped.resize((final_w, final_h), Image.NEAREST)

    return rgb_cropped, mask_cropped, final_w, final_h


def _apply_match_ratio(pil_rgb, pil_mask, state, orig_w, orig_h):
    rw = max(1, int(state.get("ratio_w", 1)))
    rh = max(1, int(state.get("ratio_h", 1)))
    action = state.get("ratio_action", "crop")

    target_aspect = rw / rh
    current_aspect = orig_w / orig_h

    if action == "crop":
        if current_aspect > target_aspect:
            # Wider than target — crop sides
            new_w = round(orig_h * target_aspect)
            new_h = orig_h
        else:
            # Taller than target — crop top/bottom
            new_w = orig_w
            new_h = round(orig_w / target_aspect)
        new_w = max(1, new_w)
        new_h = max(1, new_h)
        left = (orig_w - new_w) // 2
        top = (orig_h - new_h) // 2
        rgb_out = pil_rgb.crop((left, top, left + new_w, top + new_h))
        mask_out = pil_mask.crop((left, top, left + new_w, top + new_h))
    else:
        # action == "pad"
        if current_aspect > target_aspect:
            # Wider than target — pad top/bottom
            new_w = orig_w
            new_h = round(orig_w / target_aspect)
        else:
            # Taller than target — pad sides
            new_w = round(orig_h * target_aspect)
            new_h = orig_h
        new_w = max(1, new_w)
        new_h = max(1, new_h)
        pad_color = _hex_to_rgb(state.get("pad_color", "#000000"))
        rgb_out = Image.new("RGB", (new_w, new_h), pad_color)
        # Mask gets opaque (mask=1, since fill is non-image area; matches
        # native LoadImageMask convention that 1=masked/opaque-area).
        mask_out = Image.new("L", (new_w, new_h), 255)
        offset_x = (new_w - orig_w) // 2
        offset_y = (new_h - orig_h) // 2
        rgb_out.paste(pil_rgb, (offset_x, offset_y))
        # The original image area gets the original mask values pasted on top.
        mask_out.paste(pil_mask, (offset_x, offset_y))

    # Snap to final dims (may slightly drift ratio, documented in spec).
    final_w, final_h = _apply_snap(new_w, new_h, state.get("snap", 0))
    final_w, final_h = _clamp_dims(final_w, final_h)

    if (final_w, final_h) != (new_w, new_h):
        # Snap nudged dims — resize the crop/pad result.
        factor = final_w / new_w
        resample = _pick_resample(state.get("resample", "auto"), factor)
        rgb_out = rgb_out.resize((final_w, final_h), resample)
        mask_out = mask_out.resize((final_w, final_h), Image.NEAREST)

    return rgb_out, mask_out, final_w, final_h


# ── Node class ───────────────────────────────────────────────────────────────


class PixaromaLoadImage:
    DESCRIPTION = (
        "Load Image Pixaroma - native LoadImage parity (upload, drag-drop, "
        "paste, multi-frame, alpha to mask) plus inline resize: max "
        "megapixels, longest side, scale by, fit inside, crop to fill, "
        "match aspect ratio. Snap chips, resample picker, upscale guard. "
        "Outputs: IMAGE, MASK, WIDTH, HEIGHT, FILENAME, ORIGINAL_WIDTH, "
        "ORIGINAL_HEIGHT.\n\n"
        "Eliminates the need for downstream Get Image Size + Image Scale + "
        "Image Resize chains in most workflows."
    )

    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [
            f for f in os.listdir(input_dir)
            if os.path.isfile(os.path.join(input_dir, f))
        ]
        files = folder_paths.filter_files_content_types(files, ["image"])
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
            },
            "hidden": {
                "LoadImagePixState": (
                    "STRING",
                    {"default": json.dumps(DEFAULT_STATE)},
                ),
            },
        }

    CATEGORY = "👑 Pixaroma"
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "STRING", "INT", "INT")
    RETURN_NAMES = (
        "IMAGE", "MASK", "WIDTH", "HEIGHT",
        "FILENAME", "ORIGINAL_WIDTH", "ORIGINAL_HEIGHT",
    )
    FUNCTION = "load_image"

    def load_image(self, image: str, LoadImagePixState: str = ""):
        image_path = folder_paths.get_annotated_filepath(image)
        img = node_helpers.pillow(Image.open, image_path)

        output_images = []
        output_masks = []
        orig_w = orig_h = None
        final_w = final_h = None

        # Match native LoadImage's tensor dtype so fp16 / bf16 pipelines
        # don't need an extra cast downstream. Fall back to float32 if the
        # comfy import isn't available (unit-test or non-Comfy runtime).
        try:
            import comfy.model_management as _mm
            tensor_dtype = _mm.intermediate_dtype()
        except Exception:
            tensor_dtype = torch.float32

        state = _parse_state(LoadImagePixState)

        for frame in ImageSequence.Iterator(img):
            frame = node_helpers.pillow(ImageOps.exif_transpose, frame)
            if frame.mode == "I":
                frame = frame.point(lambda px: px * (1 / 255))
            rgb = frame.convert("RGB")

            if orig_w is None:
                orig_w, orig_h = rgb.size
            if rgb.size != (orig_w, orig_h):
                continue

            # Build the PIL mask (1 - alpha, or zeros if none).
            if "A" in frame.getbands():
                alpha = np.array(frame.getchannel("A")).astype(np.float32) / 255.0
                mask_pil = Image.fromarray(
                    ((1.0 - alpha) * 255).astype(np.uint8), mode="L"
                )
            elif frame.mode == "P" and "transparency" in frame.info:
                alpha = np.array(
                    frame.convert("RGBA").getchannel("A")
                ).astype(np.float32) / 255.0
                mask_pil = Image.fromarray(
                    ((1.0 - alpha) * 255).astype(np.uint8), mode="L"
                )
            else:
                mask_pil = Image.new("L", rgb.size, 0)

            # Apply resize (Off-mode passthrough until modes fill in).
            rgb_resized, mask_resized, frame_w, frame_h = _resize_frame(
                rgb, mask_pil, state, orig_w, orig_h,
            )
            final_w, final_h = frame_w, frame_h

            arr = np.array(rgb_resized).astype(np.float32) / 255.0
            tensor = torch.from_numpy(arr)[None,].to(dtype=tensor_dtype)
            mask_arr = np.array(mask_resized).astype(np.float32) / 255.0
            mask_tensor = torch.from_numpy(mask_arr).unsqueeze(0).to(dtype=tensor_dtype)

            output_images.append(tensor)
            output_masks.append(mask_tensor)

            if img.format == "MPO":
                break  # native LoadImage same: only first frame for MPO

        if len(output_images) == 0:
            # Defensive — never happens for valid PIL images but keeps tensor
            # shapes consistent if we ever hit a pathological file.
            zeros = torch.zeros((1, 64, 64, 3), dtype=tensor_dtype)
            zeros_mask = torch.zeros((1, 64, 64), dtype=tensor_dtype)
            basename = os.path.splitext(os.path.basename(image_path))[0]
            return (zeros, zeros_mask, 64, 64, basename, 64, 64)

        if len(output_images) > 1:
            out_img = torch.cat(output_images, dim=0)
            out_mask = torch.cat(output_masks, dim=0)
        else:
            out_img = output_images[0]
            out_mask = output_masks[0]

        # `final_w` / `final_h` are set by the last frame's resize call. All
        # frames must produce the same dims by construction (same input dims +
        # same state), so this is safe.
        if final_w is None:
            final_w, final_h = orig_w, orig_h

        basename = os.path.splitext(os.path.basename(image_path))[0]
        return (out_img, out_mask, final_w, final_h, basename, orig_w, orig_h)

    @classmethod
    def IS_CHANGED(cls, image, LoadImagePixState=""):
        image_path = folder_paths.get_annotated_filepath(image)
        m = hashlib.sha256()
        with open(image_path, "rb") as f:
            m.update(f.read())
        m.update((LoadImagePixState or "").encode("utf-8"))
        return m.hexdigest()

    @classmethod
    def VALIDATE_INPUTS(cls, image, LoadImagePixState=""):
        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True


NODE_CLASS_MAPPINGS = {"PixaromaLoadImage": PixaromaLoadImage}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaLoadImage": "Load Image Pixaroma"}
