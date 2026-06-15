"""Load Images from Folder Pixaroma.

A "folder version" of Load Image Pixaroma: point it at any folder on disk, pick
which images to process (all / first N / hand-picked in a thumbnail gallery), and
on Run feed each selected image through the workflow ONE AT A TIME via ComfyUI's
list mechanism (OUTPUT_IS_LIST) - one finished result per image.

State (folder, selection, options, resize) arrives as a hidden JSON string the
frontend injects via app.graphToPrompt (see js/load_images_folder/). The resize
keys are identical to node_load_image.py::DEFAULT_STATE so the shared
nodes/_resize_helpers._resize_frame engine works unchanged.
"""

import hashlib
import json
import os

import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

from ._resize_helpers import _resize_frame


# Resize keys MUST match node_load_image.py::DEFAULT_STATE (shared engine).
DEFAULT_STATE = {
    "version": 1,
    "folder": "",
    "recursive": False,
    "sort": "name",
    "sort_dir": "asc",
    "selected": [],
    # ── resize keys (mirror Load Image) ──
    "mode": "off",
    "max_mp": 1.0,
    "longest_side": 1024,
    "scale_factor": 1.0,
    "fit_w": 1024, "fit_h": 1024,
    "cover_w": 1024, "cover_h": 1024,
    "ratio_preset": "1:1",
    "ratio_w": 1, "ratio_h": 1,
    "ratio_action": "crop",
    "pad_color": "#808080",
    "pad_top": 0, "pad_bottom": 0, "pad_left": 0, "pad_right": 0,
    "crop_anchor": "center", "crop_scale": True,
    "snap": 0,
    "resample": "auto",
    "allow_upscale": True,
}


def _parse_state(state_json: str) -> dict:
    """Merge the hidden state JSON over DEFAULT_STATE. Falls back to defaults on
    any parse error (state may be missing/malformed in subgraph/partial-prompt
    cases - CLAUDE.md Vue Compat #9)."""
    if not state_json:
        return dict(DEFAULT_STATE)
    try:
        parsed = json.loads(state_json)
        merged = dict(DEFAULT_STATE)
        merged.update({k: v for k, v in parsed.items() if k in DEFAULT_STATE})
        return merged
    except Exception:
        print("[PixaromaLoadImagesFolder] Malformed state JSON, using defaults")
        return dict(DEFAULT_STATE)


def _load_one(path, state, dtype):
    """Open one image file, return (image_tensor, mask_tensor). Uses the first
    frame only (folders of stills); applies the shared resize engine."""
    img = node_pillow_open(path)
    frame = ImageOps.exif_transpose(next(ImageSequence.Iterator(img)))
    if frame.mode == "I":
        frame = frame.point(lambda px: px * (1 / 255))
    rgb = frame.convert("RGB")
    orig_w, orig_h = rgb.size

    if "A" in frame.getbands():
        alpha = np.array(frame.getchannel("A")).astype(np.float32) / 255.0
        mask_pil = Image.fromarray(((1.0 - alpha) * 255).astype(np.uint8), mode="L")
    elif frame.mode == "P" and "transparency" in frame.info:
        alpha = np.array(frame.convert("RGBA").getchannel("A")).astype(np.float32) / 255.0
        mask_pil = Image.fromarray(((1.0 - alpha) * 255).astype(np.uint8), mode="L")
    else:
        mask_pil = Image.new("L", rgb.size, 0)

    rgb_r, mask_r, fw, fh = _resize_frame(rgb, mask_pil, state, orig_w, orig_h)

    t = torch.from_numpy(np.array(rgb_r).astype(np.float32) / 255.0)[None,].to(dtype=dtype)
    m = torch.from_numpy(np.array(mask_r).astype(np.float32) / 255.0).unsqueeze(0).to(dtype=dtype)
    return t, m, int(fw), int(fh)


def node_pillow_open(path):
    """Open with the same defensive wrapper ComfyUI uses (handles truncated
    files gracefully where possible)."""
    try:
        import node_helpers
        return node_helpers.pillow(Image.open, path)
    except Exception:
        return Image.open(path)


class PixaromaLoadImagesFolder:
    DESCRIPTION = (
        "Load many images from any folder on disk and feed them through your "
        "workflow one at a time - one finished result per image. Pick all, the "
        "first N, or hand-pick specific images in a thumbnail gallery. Same resize "
        "options as Load Image Pixaroma (max megapixels, longest side, scale by, "
        "fit inside, crop to fill, match aspect ratio). Outputs are a list: image, "
        "mask, width, height, filename, index, total. Wire filename into a Save node "
        "so each result keeps its original name, and width/height into an empty latent "
        "so it matches each image's size. Hit Run once and leave the batch count at 1."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {
                "LoadImagesFolderState": (
                    "STRING",
                    {"default": json.dumps(DEFAULT_STATE)},
                ),
            },
        }

    CATEGORY = "👑 Pixaroma"
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "STRING", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "width", "height", "filename", "index", "total")
    OUTPUT_IS_LIST = (True, True, True, True, True, True, True)
    OUTPUT_TOOLTIPS = (
        "Each selected image, one per list item (after any resize).",
        "Each image's mask from its alpha channel (blank if it has none).",
        "Each image's width in pixels (after any resize) - wire into an empty latent so it matches.",
        "Each image's height in pixels (after any resize).",
        "Each image's filename without the extension - wire into Save so results keep their original names.",
        "1-based position of each image in this batch (1, 2, 3 ...).",
        "How many images are in this batch - i.e. how many loaded (same for every item).",
    )
    FUNCTION = "load"

    def load(self, LoadImagesFolderState: str = ""):
        state = _parse_state(LoadImagesFolderState)
        folder = state.get("folder", "") or ""
        selected = state.get("selected", []) or []

        if not folder or not os.path.isdir(folder):
            raise ValueError(
                "Load Images from Folder: folder not found. Pick a folder on the node "
                "(type or paste a path, or use Browse)."
            )
        if not selected:
            raise ValueError(
                "Load Images from Folder: no images selected. Click 'Pick images' and "
                "choose at least one."
            )

        try:
            import comfy.model_management as _mm
            dtype = _mm.intermediate_dtype()
        except Exception:
            dtype = torch.float32

        real_folder = os.path.realpath(folder)
        images, masks, widths, heights, names, indices = [], [], [], [], [], []
        count = 0
        for rel in selected:
            # Keep every selected file INSIDE the chosen folder. `selected` comes
            # from the (frontend-supplied) hidden state, so a crafted "../../x"
            # must not let the loader open files outside the folder.
            path = os.path.realpath(os.path.join(folder, rel))
            try:
                if os.path.commonpath([path, real_folder]) != real_folder:
                    print(f"[PixaromaLoadImagesFolder] outside folder, skipped: {rel}")
                    continue
            except ValueError:
                continue  # different drive on Windows
            if not os.path.isfile(path):
                print(f"[PixaromaLoadImagesFolder] missing, skipped: {rel}")
                continue
            try:
                t, m, fw, fh = _load_one(path, state, dtype)
            except Exception as e:
                print(f"[PixaromaLoadImagesFolder] failed to load {rel}: {e}")
                continue
            images.append(t)
            masks.append(m)
            widths.append(fw)
            heights.append(fh)
            names.append(os.path.splitext(os.path.basename(rel))[0])
            count += 1
            indices.append(count)

        if not images:
            raise ValueError(
                "Load Images from Folder: none of the selected images could be loaded "
                "(missing or unreadable). Re-check the folder and your selection."
            )

        totals = [count] * len(images)
        return (images, masks, widths, heights, names, indices, totals)

    @classmethod
    def IS_CHANGED(cls, LoadImagesFolderState: str = ""):
        state = _parse_state(LoadImagesFolderState)
        folder = state.get("folder", "") or ""
        # Everything except `selected` (options + resize) goes in as a stable blob;
        # selected files contribute their per-file mtime so edits on disk re-run.
        opts = {k: state[k] for k in state if k != "selected"}
        parts = [json.dumps(opts, sort_keys=True)]
        for rel in state.get("selected", []) or []:
            p = os.path.join(folder, rel)
            try:
                parts.append(f"{rel}:{os.stat(p).st_mtime_ns}")
            except OSError:
                parts.append(f"{rel}:missing")
        return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


NODE_CLASS_MAPPINGS = {"PixaromaLoadImagesFolder": PixaromaLoadImagesFolder}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaLoadImagesFolder": "Load Images from Folder Pixaroma"}
