import os
import json
import uuid
import numpy as np
import torch
from PIL import Image
import folder_paths
from .node_ref import any_type, FlexibleOptionalInputType
from ._inpaint_helpers import (
    apply_inpaint_crop, merge_params, resolve_inpaint_mask, PIXAROMA_CROP_INFO, DEFAULTS,
)


# Friendly combo labels -> internal size-mode keys used by the geometry helper.
_SIZE_MODE = {
    "keep shape (long side)": "keep",
    "force size (square)": "force",
    "free (multiple only)": "free",
}


class _InpaintOptionalInputs(FlexibleOptionalInputType):
    """Declares concrete optional IMAGE + MASK inputs (so drag-from-output search
    finds the node) while still accepting the hidden InpaintCropWidget DOM-widget
    value (and anything else) via the flexible any_type fallback - same trick as
    Image Crop's _CropOptionalInputs."""

    def __init__(self, type):
        super().__init__(type)
        self["image"] = ("IMAGE", {
            "tooltip": (
                "Wire any upstream IMAGE here to inpaint it (Load Image, VAE "
                "Decode, anything). You can also drag-drop or paste an image onto "
                "the node body - those load it directly and disconnect this wire."
            ),
        })
        self["mask"] = ("MASK", {
            "tooltip": (
                "Optional mask of the area to inpaint (e.g. a transparent PNG's "
                "alpha, or any MASK output). It is used as-is whenever you have not "
                "painted a mask in the editor - so clearing the editor falls back to "
                "this wired mask. A mask painted in the editor takes priority."
            ),
        })

    def __getitem__(self, key):
        if dict.__contains__(self, key):
            return dict.__getitem__(self, key)
        return (self.type,)


class PixaromaInpaintCrop:
    DESCRIPTION = (
        "Inpaint Crop Pixaroma - the easy way to set up an inpaint. Open the "
        "fullscreen editor and paint a mask over the area you want to fix (brush, "
        "erase, clear, invert, adjustable brush size). The node automatically "
        "finds the box around your mask, adds a context margin, and crops a "
        "model-friendly piece (sized to a multiple of 8, scaled toward your "
        "target so even a small masked area gets enough resolution).\n\n"
        "Turn on invert_mask to flip the mask and inpaint the OPPOSITE area (e.g. a "
        "cut-out's background instead of its subject), no Invert Mask node needed.\n\n"
        "Wire the cropped image and mask into your inpaint model (KSampler, Flux, "
        "edit models), then send the crop_info wire into Inpaint Stitch Pixaroma "
        "to paste the result back onto the original at the exact spot.\n\n"
        "Outputs the cropped image, the matching cropped mask, a crop_info wire, "
        "and the crop width and height (handy for an empty latent). The crop_info "
        "wire is the same type Image Crop uses, so the two are interchangeable."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "size_mode": (list(_SIZE_MODE.keys()), {
                    "default": "keep shape (long side)",
                    "tooltip": (
                        "Keep shape: scale the masked area so its long side hits "
                        "the target, no stretching (best quality). Force size: "
                        "always output a target x target square. Free: natural "
                        "size, just rounded to the multiple."
                    ),
                }),
                "target": ("INT", {
                    "default": 1024, "min": 64, "max": 8192, "step": 8,
                    "tooltip": "Target long side (keep) or square size (force), in px.",
                }),
                "multiple": ([8, 16, 32, 64], {
                    "default": 8,
                    "tooltip": "Round the crop size to this multiple for model compatibility.",
                }),
                "context_px": ("INT", {
                    "default": 24, "min": 0, "max": 1024, "step": 1,
                    "tooltip": "How many extra pixels of surrounding context to include each side.",
                }),
                "mask_grow": ("INT", {
                    "default": 4, "min": 0, "max": 256, "step": 1,
                    "tooltip": "Expand the painted mask by this many pixels before cropping.",
                }),
                "mask_blur": ("INT", {
                    "default": 4, "min": 0, "max": 256, "step": 1,
                    "tooltip": "Soften the output mask edge by this many pixels for a smoother inpaint.",
                }),
                "invert_mask": ("BOOLEAN", {
                    "default": False,
                    "tooltip": (
                        "Flip the mask so the inpaint targets the OPPOSITE area "
                        "(swap subject and background). Works on a wired mask or a "
                        "painted one - a built-in alternative to an Invert Mask node. "
                        "No effect if no mask is connected."
                    ),
                }),
                "softness": ("INT", {
                    "default": 16, "min": 0, "max": 150, "step": 1,
                    "tooltip": (
                        "How far the seam feathers when Inpaint Stitch pastes the "
                        "crop back. Previewed live in the mask editor."
                    ),
                }),
            },
            "optional": _InpaintOptionalInputs(any_type),
        }

    RETURN_TYPES = ("IMAGE", "MASK", PIXAROMA_CROP_INFO, "INT", "INT")
    RETURN_NAMES = ("image", "mask", "crop_info", "width", "height")
    OUTPUT_TOOLTIPS = (
        "The cropped region, resized to the model-friendly output size.",
        "The cropped mask at the same size (grown and blurred as set). Wire it "
        "into SetLatentNoiseMask / your inpaint conditioning.",
        "Crop info for Inpaint Stitch Pixaroma - carries the original image and "
        "where the crop came from so the inpainted result can be pasted back "
        "exactly. Same type as Image Crop, so they are interchangeable.",
        "Cropped output width in pixels (for an empty latent / edit models).",
        "Cropped output height in pixels.",
    )
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma"
    OUTPUT_NODE = True

    # ─────────────────────────────────────────────────────────────────────────

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        """Re-run on any knob change, or when the painted-mask file changes."""
        parts = [str(kwargs.get(k)) for k in
                 ("size_mode", "target", "multiple", "context_px", "mask_grow", "mask_blur", "softness")]
        state = kwargs.get("InpaintCropWidget")
        try:
            sj = state.get("state_json", "{}") if isinstance(state, dict) else str(state)
            meta = json.loads(sj) if sj else {}
            parts.append(json.dumps(meta, sort_keys=True))  # deterministic regardless of key order
            mp = meta.get("mask_path", "")
            if mp:
                full = cls._resolve_pixaroma_path(mp)
                if full:
                    parts.append(str(os.path.getmtime(full)))
            sp = meta.get("src_path", "")
            if sp:
                fs = cls._resolve_pixaroma_path(sp)
                if fs:
                    parts.append(str(os.path.getmtime(fs)))
        except Exception:
            parts.append(str(state))
        return "|".join(parts)

    @staticmethod
    def _resolve_pixaroma_path(rel_path):
        if not rel_path:
            return None
        input_dir = os.path.realpath(folder_paths.get_input_directory())
        full_path = os.path.realpath(os.path.join(input_dir, rel_path))
        if not full_path.startswith(input_dir + os.sep):
            print("[PixaromaInpaintCrop] Security: path escapes input dir, blocked.")
            return None
        return full_path if os.path.exists(full_path) else None

    def _save_source_temp(self, tensor):
        """Stash the input tensor (frame 0) to temp/ so the JS editor can load it."""
        try:
            if not isinstance(tensor, torch.Tensor) or tensor.dim() != 4 or tensor.shape[0] == 0:
                return None
            arr = (tensor[0].clamp(0, 1).cpu().numpy() * 255.0 + 0.5).astype(np.uint8)
            temp_dir = folder_paths.get_temp_directory()
            os.makedirs(temp_dir, exist_ok=True)
            fname = f"pixaroma_inpaint_src_{uuid.uuid4().hex}.png"
            Image.fromarray(arr).save(os.path.join(temp_dir, fname), "PNG")
            return fname
        except Exception as e:
            print(f"[PixaromaInpaintCrop] temp source save failed: {e}")
            return None

    def _load_disk_image(self, rel_path):
        full = self._resolve_pixaroma_path(rel_path)
        if not full:
            return None
        try:
            arr = np.array(Image.open(full).convert("RGB")).astype(np.float32) / 255.0
            return torch.from_numpy(arr)[None,]
        except Exception as e:
            print(f"[PixaromaInpaintCrop] source load error: {e}")
            return None

    def _load_disk_mask(self, rel_path):
        full = self._resolve_pixaroma_path(rel_path)
        if not full:
            return None
        try:
            arr = np.array(Image.open(full).convert("L")).astype(np.float32) / 255.0
            return torch.from_numpy(arr)[None,]
        except Exception as e:
            print(f"[PixaromaInpaintCrop] mask load error: {e}")
            return None

    def _empty(self):
        img = torch.ones((1, 1024, 1024, 3), dtype=torch.float32)
        mask = torch.zeros((1, 1024, 1024), dtype=torch.float32)
        info = {"image": img, "mask": mask, "x": 0, "y": 0, "w": 1024, "h": 1024,
                "orig_w": 1024, "orig_h": 1024}
        return (img, mask, info, 1024, 1024)

    def _params(self, size_mode, target, multiple, context_px, mask_grow, mask_blur):
        mode = _SIZE_MODE.get(size_mode, "keep")
        p = dict(DEFAULTS)
        p.update({
            "size_mode": mode, "target": int(target),
            "target_w": int(target), "target_h": int(target),
            "multiple": int(multiple), "context_px": int(context_px),
            "mask_grow": int(mask_grow), "mask_blur": int(mask_blur),
        })
        return merge_params(p)

    def run(self, size_mode="keep shape (long side)", target=1024, multiple=8,
            context_px=24, mask_grow=4, mask_blur=4, softness=16, invert_mask=False, **kwargs):
        upstream = kwargs.get("image")
        upstream_mask = kwargs.get("mask")
        state = kwargs.get("InpaintCropWidget")

        meta = {}
        if state is not None:
            try:
                sj = state.get("state_json", "{}") if isinstance(state, dict) else str(state)
                if sj and sj.strip() not in ("", "{}"):
                    parsed = json.loads(sj)
                    if isinstance(parsed, dict):
                        meta = parsed
            except Exception as e:
                print(f"[PixaromaInpaintCrop] state parse error: {e}")

        # ── source image: wired upstream wins, else the editor-saved src on disk
        ui_payload = None
        image = upstream if isinstance(upstream, torch.Tensor) else None
        if image is not None:
            src_fname = self._save_source_temp(image)
            if src_fname:
                ui_payload = {"pixaroma_inpaint_source": [
                    {"filename": src_fname, "subfolder": "", "type": "temp"}]}
        else:
            image = self._load_disk_image(meta.get("src_path", ""))

        if not isinstance(image, torch.Tensor):
            return self._empty()

        # ── mask: a PAINTED editor mask wins; a cleared/empty one (mask_path set
        # but the saved file is all-black) falls back to the wired mask, so clearing
        # the editor uses the wired mask as-is. resolve_inpaint_mask owns the rule.
        disk_mask = self._load_disk_mask(meta.get("mask_path", ""))
        mask = resolve_inpaint_mask(disk_mask, upstream_mask)

        params = self._params(size_mode, target, multiple, context_px, mask_grow, mask_blur)
        # Seam softness (the node 'softness' knob, mirrored by the editor): feed it
        # into the geometry so the crop CONTEXT grows to fit the feather (Option B -
        # compute_region uses max(context_px, blend)), then ride it on crop_info to
        # Inpaint Stitch as the seam-feather width.
        sb = max(0, min(150, int(softness)))
        params["blend"] = sb
        params["invert_mask"] = bool(invert_mask)   # flip the mask before cropping
        try:
            img_t, mask_t, crop_info, ow, oh = apply_inpaint_crop(image, mask, params)
        except Exception as e:
            print(f"[PixaromaInpaintCrop] crop error: {e}")
            return self._empty()

        # blend mode (editor-only) also rides crop_info. (color_match is now the
        # Stitch node's own knob.)
        crop_info["blend"] = sb
        _bm = str(meta.get("blend_mode", "mask"))
        crop_info["blend_mode"] = _bm if _bm in ("mask", "whole_crop") else "mask"

        result = (img_t, mask_t, crop_info, ow, oh)
        if ui_payload:
            return {"ui": ui_payload, "result": result}
        return result


NODE_CLASS_MAPPINGS = {
    "PixaromaInpaintCrop": PixaromaInpaintCrop,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaInpaintCrop": "Inpaint Crop Pixaroma",
}
