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

from ._path_guard import (
    folder_allowed as _pix_folder_allowed,
    prescreen as _pix_prescreen,
    denied_message as _pix_denied_message,
    rel_is_rooted as _pix_rel_is_rooted,
)
from ._resize_helpers import _I16_MODES, _resize_frame


# Resize keys MUST match node_load_image.py::DEFAULT_STATE (shared engine).
DEFAULT_STATE = {
    "version": 1,
    "folder": "",
    "recursive": False,
    # With "Include subfolders" on, the `filename` output normally FLATTENS the
    # relative path ("sub/cat.png" -> "sub_cat") so a Save node cannot overwrite
    # two same-named files from different folders. Turn this on to keep the real
    # path instead ("sub/cat"), which lets Save Image Pixaroma rebuild the same
    # folder tree - it has a matching "Keep folders from the wired name", and
    # only rebuilds folders when BOTH are on, so this stays safe by default.
    "keepFolders": False,
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
    elif frame.mode in _I16_MODES:
        frame = frame.convert("I").point(lambda px: px * (1 / 257))
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
        "mask, width, height, filename, index, total, path (the full file path, for "
        "Prompt Reader Pixaroma). Wire filename into a Save node "
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

    CATEGORY = "👑 Pixaroma/🖼️ Image"
    # `path` is appended LAST (2026-10-08) so every saved link to the first
    # seven keeps its slot index.
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "STRING", "INT", "INT", "STRING")
    RETURN_NAMES = ("image", "mask", "width", "height", "filename", "index", "total", "path")
    OUTPUT_IS_LIST = (True, True, True, True, True, True, True, True)
    OUTPUT_TOOLTIPS = (
        "Each selected image, one per list item (after any resize).",
        "Each image's mask from its alpha channel (blank if it has none).",
        "Each image's width in pixels (after any resize) - wire into an empty latent so it matches.",
        "Each image's height in pixels (after any resize).",
        "Each image's filename without the extension - wire into Save so results keep their original names. With subfolders included this is normally flattened (sub/cat becomes sub_cat) so two same-named files cannot collide; turn on 'Keep the folder structure in the name' to pass the real path instead and rebuild the same folders when saving.",
        "1-based position of each image in this batch (1, 2, 3 ...).",
        "How many images are in this batch - i.e. how many loaded (same for every item).",
        "Each image's full file path, with its extension - for nodes that open the file "
        "themselves, like Prompt Reader Pixaroma reading the prompt saved inside it.",
    )
    FUNCTION = "load"

    def load(self, LoadImagesFolderState: str = ""):
        state = _parse_state(LoadImagesFolderState)
        folder = state.get("folder", "") or ""
        selected = state.get("selected", []) or []

        # CONTAINMENT (2026-08-03, ComfyUI-Manager PR #3118).
        # The per-file check further down is correct, but it only ever proved
        # each file sits inside `folder` - and `folder` itself comes from the
        # hidden state blob, which an unauthenticated /prompt fully controls. So
        # the node would happily read any PIL-decodable file on the host and
        # hand it out on the `image` output. Root the FOLDER too.
        # prescreen runs before isdir because isdir on a UNC path already leaks
        # an NTLM hash over SMB on Windows.
        if not _pix_prescreen(folder):
            raise ValueError(_pix_denied_message(str(folder)))
        if not folder or not os.path.isdir(folder):
            raise ValueError(
                "Load Images from Folder: folder not found. Pick a folder on the node "
                "(type or paste a path, or use Browse)."
            )
        if not _pix_folder_allowed(folder):
            raise ValueError(_pix_denied_message(folder))
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
        recursive = bool(state.get("recursive", False))
        keep_folders = bool(state.get("keepFolders", False))
        images, masks, widths, heights, names, indices = [], [], [], [], [], []
        # The REALPATH that passed the containment check above, so a node that
        # opens it (Prompt Reader) gets a resolved, already-contained path.
        paths = []
        count = 0
        for rel in selected:
            if not isinstance(rel, str) or not rel:
                continue  # malformed selection entry (e.g. null/number in state)
            # Keep every selected file INSIDE the chosen folder. `selected` comes
            # from the (frontend-supplied) hidden state, so a crafted "../../x"
            # must not let the loader open files outside the folder.
            # An absolute/UNC entry has to go BEFORE realpath: os.path.join drops
            # `folder` entirely for one, and realpath on a UNC fires SMB and leaks
            # an NTLM hash before the commonpath check below can refuse it.
            if _pix_rel_is_rooted(rel):
                print(f"[PixaromaLoadImagesFolder] not a relative name, skipped: {rel}")
                continue
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
            if recursive:
                stem = os.path.splitext(rel)[0].replace("\\", "/")
                if keep_folders:
                    # hand over the REAL relative path so a Save node can
                    # rebuild the same folder tree ("sub/cat").
                    #
                    # Derived from the RESOLVED `path`, not from the raw `rel`.
                    # `rel` comes out of the hidden state, which /prompt lets
                    # anyone set, and the containment check above tests the
                    # resolved location - not the literal string. So an entry
                    # like "keep/../keep/cat.png" points at a file genuinely
                    # inside the folder, passes, and would then have emitted the
                    # traversal-SHAPED name "keep/../keep/cat" on an output whose
                    # whole purpose is to be used as a path by another node.
                    # Save Image refuses a ".." segment, and so does core's
                    # SaveImage, so nothing was exploitable - but this output is
                    # meant for arbitrary consumers, so it should not hand out a
                    # string shaped like an escape. relpath of an already
                    # contained path can never contain "..", and is identical to
                    # the old value for every ordinary selection (verified).
                    name = os.path.splitext(
                        os.path.relpath(path, real_folder)
                    )[0].replace("\\", "/")
                else:
                    # keep names unique across subfolders so a Save node can't
                    # overwrite: "sub/cat.png" -> "sub_cat"
                    name = stem.replace("/", "_")
            else:
                name = os.path.splitext(os.path.basename(rel))[0]
            names.append(name)
            paths.append(path)
            count += 1
            indices.append(count)

        if not images:
            raise ValueError(
                "Load Images from Folder: none of the selected images could be loaded "
                "(missing or unreadable). Re-check the folder and your selection."
            )

        totals = [count] * len(images)
        return (images, masks, widths, heights, names, indices, totals, paths)

    @classmethod
    def IS_CHANGED(cls, LoadImagesFolderState: str = ""):
        state = _parse_state(LoadImagesFolderState)
        folder = state.get("folder", "") or ""
        # Same containment as load(): without it this was an mtime/existence
        # oracle over any directory (blind - the digest is not returned to the
        # caller - but it is the same class of bug, and IS_CHANGED is exactly
        # the entry point that got missed on four other nodes). A refused folder
        # hashes as a constant, so the node simply does not re-run on it.
        if not _pix_prescreen(folder) or not _pix_folder_allowed(folder):
            return hashlib.sha256(b"pixaroma:folder-not-approved").hexdigest()
        real_folder = os.path.realpath(folder)
        # Everything except `selected` (options + resize) goes in as a stable blob;
        # selected files contribute their per-file mtime so edits on disk re-run.
        opts = {k: state[k] for k in state if k != "selected"}
        parts = [json.dumps(opts, sort_keys=True)]
        for rel in state.get("selected", []) or []:
            if not isinstance(rel, str) or not rel:
                continue  # malformed entry - skip (mirrors load())
            # Mirror load()'s guard: never stat a file outside the chosen folder
            # (selected is frontend-supplied, so a crafted "../../x" must not reach
            # os.stat). Outside paths hash as a constant instead of a real stat.
            if _pix_rel_is_rooted(rel):     # before realpath - see load()
                parts.append(f"{rel}:outside")
                continue
            p = os.path.realpath(os.path.join(folder, rel))
            try:
                if os.path.commonpath([p, real_folder]) != real_folder:
                    parts.append(f"{rel}:outside")
                    continue
            except ValueError:
                parts.append(f"{rel}:outside")  # different drive on Windows
                continue
            try:
                parts.append(f"{rel}:{os.stat(p).st_mtime_ns}")
            except OSError:
                parts.append(f"{rel}:missing")
        return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


NODE_CLASS_MAPPINGS = {"PixaromaLoadImagesFolder": PixaromaLoadImagesFolder}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaLoadImagesFolder": "Load Images from Folder Pixaroma"}
