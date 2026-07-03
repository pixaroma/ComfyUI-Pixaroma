"""Save Image Pixaroma - save images to ANY folder on disk (or output/),
with filename tokens, PNG/JPG, optional workflow embedding, and batch support.

The node face (folder + filename pattern + live preview + format) and the
right-click settings panel live in js/save_image/. State arrives via the
hidden SaveImageState input, injected by the frontend at graphToPrompt time
(Pattern #9). %NodeName.widget% tokens (e.g. %Seed Pixaroma.seed%) are
resolved FRONTEND-side before injection; %date:FMT%, %input%, %width%,
%height%, %batch_num% and %counter% are resolved here.
"""

import base64
import io
import json
import os
import re
import time

import folder_paths
import numpy as np
from PIL import Image

from ._save_helpers import (
    _build_pnginfo,
    _expand_date_tokens,
    _json_safe,
    _next_counter,
    _resolve_save_folder,
    _safe_prefix,
)

# Keys MUST match js/save_image/state.mjs::DEFAULT_STATE.
DEFAULT_STATE = {
    "version": 1,
    "folder": "",
    "pattern": "image_%date:yyyy-MM-dd%_%counter%",
    "format": "png",
    "quality": 90,
    "embedWorkflow": True,
    "saveOnRun": True,
}

# Extensions stripped off a wired `name` value so "cat.png" doesn't become
# "cat.png_00001.png". Only known media extensions - "model_v1.2" keeps its dot.
_MEDIA_EXT_RE = re.compile(
    r"\.(png|jpe?g|webp|gif|bmp|tiff?|avif|mp4|mov|webm|mkv|m4v)$", re.IGNORECASE
)

_THUMB_MAX = 16    # thumbnails shipped to the node preview (all files still save)
_THUMB_SIDE = 192  # thumbnail long side in px


def _expand_native_tokens(s):
    """Expand ComfyUI's native %year% %month% %day% %hour% %minute% %second%
    tokens. Native SaveImage gets these from folder_paths.get_save_image_path
    (compute_vars), which this node bypasses because it saves to arbitrary
    folders - so expand them here with the same zero-padded values (real user
    report: they worked in Preview Image Pixaroma but came out literal here)."""
    if not isinstance(s, str) or "%" not in s:
        return s
    now = time.localtime()
    for k, v in (
        ("%year%", f"{now.tm_year:04}"),
        ("%month%", f"{now.tm_mon:02}"),
        ("%day%", f"{now.tm_mday:02}"),
        ("%hour%", f"{now.tm_hour:02}"),
        ("%minute%", f"{now.tm_min:02}"),
        ("%second%", f"{now.tm_sec:02}"),
    ):
        s = s.replace(k, v)
    return s


def _tensor_to_pil(tensor):
    """Convert a HxWxC float [0,1] tensor frame to a PIL.Image (RGB or RGBA)."""
    arr = (tensor.cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def _thumb_b64(pil):
    """Small base64 JPEG thumbnail for the node preview. Needed because files
    saved OUTSIDE ComfyUI's folders can't be served through /view."""
    t = pil.convert("RGB")
    t.thumbnail((_THUMB_SIDE, _THUMB_SIDE))
    buf = io.BytesIO()
    t.save(buf, "JPEG", quality=70)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _build_jpeg_exif(prompt=None, workflow=None):
    """EXIF bytes embedding workflow + prompt, using the community convention
    ComfyUI already reads for WebP (0x010E ImageDescription = 'Workflow:<json>',
    0x010F Make = 'Prompt:<json>'). Best effort: the current ComfyUI frontend
    has NO jpeg workflow reader (verified in the bundle's
    getWorkflowDataFromFile), so drag-back restore works from PNG only - but
    other tools can read this, and a future frontend may add it.
    """
    exif = Image.Exif()
    try:
        if workflow is not None:
            exif[0x010E] = "Workflow:" + json.dumps(_json_safe(workflow))
        if prompt is not None:
            exif[0x010F] = "Prompt:" + json.dumps(_json_safe(prompt))
        return exif.tobytes()
    except Exception:
        return None


class PixaromaSaveImage:
    DESCRIPTION = (
        "Save Image Pixaroma - save images to any folder on your computer, not just ComfyUI's output folder. "
        "Type or paste a path, or click Browse to pick a folder with the normal Windows dialog; leave the field "
        "empty to use the output folder. The filename field supports tokens and shows a live 'Will save as' "
        "preview of the exact file that will be written. Tokens: %input% (the wired name input, e.g. the filename "
        "from Load Image Pixaroma), %date:yyyy-MM-dd% (and any date/time format), %counter% (auto-incrementing, "
        "never overwrites), %width%, %height%, %batch_num%, plus node references like %Seed Pixaroma.seed%. "
        "Use / in the name to create subfolders. Format is PNG (lossless, embeds the workflow so the file can be "
        "dragged back into ComfyUI) or JPG (smaller, quality setting in the right-click panel; ComfyUI cannot "
        "reload workflows from JPG). Right-click the node for JPG quality, workflow embedding, and the "
        "save-on-every-run switch. Batches save every frame with the counter increasing."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "Image (or batch) to save. Every frame in a batch is written, with the counter increasing per file."}),
            },
            "optional": {
                "name": ("STRING", {"forceInput": True, "tooltip": "Optional text used by the %input% token in the filename, e.g. wire the filename output of Load Image Pixaroma here to keep the original name."}),
            },
            "hidden": {
                "SaveImageState": "STRING",
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Always re-execute so every Run actually saves. Without this,
        # deleting the saved files and clicking Run again did NOTHING
        # (ComfyUI's input-hash cache skipped the node) - real user report
        # on day one. Same choice as Preview Image Pixaroma.
        return float("nan")

    def save(self, images, name=None, SaveImageState="", prompt=None, extra_pnginfo=None):
        state = dict(DEFAULT_STATE)
        try:
            data = json.loads(SaveImageState) if SaveImageState else {}
            if isinstance(data, dict):
                state.update(data)
        except Exception:
            pass

        fmt = "jpg" if str(state.get("format", "png")).lower() in ("jpg", "jpeg") else "png"
        ext = ".jpg" if fmt == "jpg" else ".png"
        try:
            quality = max(1, min(100, int(state.get("quality", 90))))
        except Exception:
            quality = 90
        embed = bool(state.get("embedWorkflow", True))
        save_on = bool(state.get("saveOnRun", True))

        h = int(images.shape[1])
        w = int(images.shape[2])
        folder_abs, inside_output = _resolve_save_folder(state.get("folder", ""))

        # Saving switched off: show what WOULD be saved, write nothing.
        if not save_on:
            entries = []
            for i, tensor in enumerate(images):
                if i >= _THUMB_MAX:
                    break
                entries.append({"filename": "", "thumb": _thumb_b64(_tensor_to_pil(tensor))})
            if not entries:
                entries.append({"filename": ""})
            entries[0]["_pixaroma_status"] = {
                "saved": 0,
                "folder": folder_abs,
                "w": w,
                "h": h,
                "inside_output": inside_output,
                "note": "Saving is off - nothing was written",
            }
            return {"ui": {"pixaroma_save_frames": entries}}

        # ---- resolve the pattern (batch-level tokens) ----
        pattern = str(state.get("pattern") or DEFAULT_STATE["pattern"])
        input_name = ""
        if name is not None:
            input_name = name if isinstance(name, str) else str(name)
            input_name = _MEDIA_EXT_RE.sub("", input_name.strip())
            # separators would create surprise subfolders; folders belong to
            # the PATTERN (type / there), not to a wired name
            input_name = input_name.replace("\\", "_").replace("/", "_")
        resolved = pattern.replace("%input%", input_name)
        resolved = _expand_date_tokens(resolved)
        resolved = _expand_native_tokens(resolved)
        resolved = resolved.replace("%width%", str(w)).replace("%height%", str(h))
        note = None
        rel = _safe_prefix(resolved)
        if not rel:
            rel = "image_%counter%"
            note = "filename pattern was invalid, used 'image_%counter%'"

        pnginfo = None
        exif_bytes = None
        if embed and fmt == "png":
            pnginfo = _build_pnginfo(prompt=prompt, extra_pnginfo=extra_pnginfo)
        elif embed and fmt == "jpg":
            wf = extra_pnginfo.get("workflow") if isinstance(extra_pnginfo, dict) else None
            exif_bytes = _build_jpeg_exif(prompt=prompt, workflow=wf)

        out_real = os.path.realpath(folder_paths.get_output_directory())
        results = []
        counters = {}      # per target dir: next FILE %counter% to try
        dir_counters = {}  # per (parent, segment): resolved FOLDER %counter%
        saved = 0
        for i, tensor in enumerate(images):
            rel_frame = rel.replace("%batch_num%", str(i))
            parts = [p for p in rel_frame.split("/") if p]
            base_tpl = parts[-1] if parts else "image_%counter%"
            sub_dirs = parts[:-1]
            # %counter% in a FOLDER segment: resolve it ONCE per run (whole
            # batch shares the folder), scanning existing sibling dirs so
            # e.g. take_%counter%/frame makes take_00001, take_00002, ...
            # per run instead of a folder literally named take_%counter%.
            if sub_dirs and any("%counter%" in d for d in sub_dirs):
                resolved_dirs = []
                parent = folder_abs
                for d in sub_dirs:
                    if "%counter%" in d:
                        ck = (parent.lower(), d)
                        if ck not in dir_counters:
                            dir_counters[ck] = _next_counter(parent, d)
                        d = d.replace("%counter%", f"{dir_counters[ck]:05}")
                    resolved_dirs.append(d)
                    parent = os.path.join(parent, d)
                sub_dirs = resolved_dirs
            target_dir = os.path.join(folder_abs, *sub_dirs) if sub_dirs else folder_abs
            try:
                os.makedirs(target_dir, exist_ok=True)
            except Exception as e:
                raise RuntimeError(
                    f"Save Image Pixaroma: cannot create folder '{target_dir}': {e}"
                )

            has_counter = "%counter%" in base_tpl
            key = target_dir.lower()
            if has_counter and key not in counters:
                counters[key] = _next_counter(target_dir, base_tpl + ext)

            # Claim the name with O_EXCL so files NEVER overwrite (bump on
            # collision; a pattern without %counter% auto-suffixes instead).
            counter = counters.get(key, 1)
            suffix = 0
            path = fname = None
            while True:
                if has_counter:
                    fname = base_tpl.replace("%counter%", f"{counter:05}") + ext
                elif suffix == 0:
                    fname = base_tpl + ext
                else:
                    fname = f"{base_tpl}_{suffix:05}{ext}"
                cand = os.path.join(target_dir, fname)
                try:
                    fd = os.open(cand, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
                    os.close(fd)
                    path = cand
                    break
                except FileExistsError:
                    if has_counter:
                        counter += 1
                    else:
                        suffix += 1
                    if counter > 999999 or suffix > 999999:
                        raise RuntimeError(
                            "Save Image Pixaroma: could not find a free filename (counter overflow)"
                        )
            if has_counter:
                counters[key] = counter + 1

            pil = _tensor_to_pil(tensor)
            ok = False
            try:
                if fmt == "png":
                    # RGBA is preserved - PNG keeps transparency.
                    pil.save(path, "PNG", pnginfo=pnginfo, compress_level=4)
                else:
                    rgb = pil
                    if pil.mode == "RGBA":
                        # JPG has no alpha: premultiply over black (consistent
                        # with the rest of the suite).
                        arr = np.asarray(pil).astype(np.float32)
                        a = arr[..., 3:4] / 255.0
                        rgb = Image.fromarray(
                            (arr[..., :3] * a).clip(0, 255).astype(np.uint8)
                        )
                    elif pil.mode != "RGB":
                        rgb = pil.convert("RGB")
                    if exif_bytes:
                        rgb.save(path, "JPEG", quality=quality, exif=exif_bytes)
                    else:
                        rgb.save(path, "JPEG", quality=quality)
                ok = True
            finally:
                if not ok:
                    # remove the claimed 0-byte file so failures leave no junk
                    try:
                        os.remove(path)
                    except OSError:
                        pass
            saved += 1

            entry = {"filename": fname}
            if inside_output:
                sub = os.path.relpath(target_dir, out_real)
                entry["subfolder"] = "" if sub == "." else sub.replace("\\", "/")
                entry["type"] = "output"
            else:
                entry["path"] = path
                if len(results) < _THUMB_MAX:
                    entry["thumb"] = _thumb_b64(pil)
            results.append(entry)

        status = {
            "saved": saved,
            "folder": folder_abs,
            "w": w,
            "h": h,
            "inside_output": inside_output,
        }
        if note:
            status["note"] = note
        if results:
            results[0]["_pixaroma_status"] = status

        # Inside output/: emit the standard ui.images key so the Media Assets
        # panel refreshes (Preview Pattern #14); the JS previews via /view.
        # Outside: our custom key with base64 thumbs (/view can't serve those
        # paths). ONE key either way so the Assets stack badge stays correct
        # (Preview Pattern #16).
        ui_key = "images" if inside_output else "pixaroma_save_frames"
        return {"ui": {ui_key: results}}


NODE_CLASS_MAPPINGS = {"PixaromaSaveImage": PixaromaSaveImage}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSaveImage": "Save Image Pixaroma"}
