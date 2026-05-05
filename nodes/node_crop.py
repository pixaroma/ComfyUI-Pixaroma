import torch
import numpy as np
from PIL import Image
import os
import json
import folder_paths
from .node_ref import any_type, FlexibleOptionalInputType


class PixaromaCrop:
    @classmethod
    def INPUT_TYPES(self):
        return {
            "required": {},
            "optional": FlexibleOptionalInputType(any_type),
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("image", "width", "height")
    FUNCTION = "load_crop"
    CATEGORY = "👑 Pixaroma"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        """Force re-execution when crop metadata changes.

        Upstream IMAGE changes are already detected by ComfyUI's input-hash
        mechanism, so we only need to bust the cache on rect edits. For the
        disk-composite fallback path, we additionally key on the file mtime.
        """
        crop_data = kwargs.get("CropWidget")
        if not crop_data:
            return ""
        try:
            crop_json = crop_data.get("crop_json", "{}") if isinstance(crop_data, dict) else str(crop_data)
            meta = json.loads(crop_json)
            rect_key = f"{meta.get('crop_x','')}-{meta.get('crop_y','')}-{meta.get('crop_w','')}-{meta.get('crop_h','')}"

            # If upstream is wired, the rect alone determines our output (the
            # upstream tensor is hashed by ComfyUI itself).
            if kwargs.get("image") is not None:
                return rect_key

            composite_path = meta.get("composite_path", "")
            if composite_path:
                input_dir = folder_paths.get_input_directory()
                full_path = os.path.join(input_dir, composite_path)
                if os.path.exists(full_path):
                    return f"{os.path.getmtime(full_path)}:{rect_key}"
        except Exception:
            pass
        return str(crop_data)

    def load_crop(self, **kwargs):
        empty_image = torch.ones((1, 1024, 1024, 3), dtype=torch.float32)

        crop_data = kwargs.get("CropWidget")
        upstream = kwargs.get("image")

        # No widget AND no upstream → return empty
        if not crop_data and upstream is None:
            return (empty_image, 1024, 1024)

        # Parse crop metadata (may be empty if user just wired upstream and never opened editor)
        meta = {}
        if crop_data:
            crop_json = crop_data.get("crop_json", "{}") if isinstance(crop_data, dict) else str(crop_data)
            if crop_json and crop_json.strip() not in ("", "{}"):
                try:
                    parsed = json.loads(crop_json)
                    if isinstance(parsed, dict):
                        meta = parsed
                except Exception as e:
                    print(f"[PixaromaCrop] crop_json parse error: {e}")

        # ── Upstream tensor path ──────────────────────────────────────────────
        # If an IMAGE is wired in, prefer it over the on-disk composite. This is
        # the "drop-in after Load Image" workflow the user wants.
        if isinstance(upstream, torch.Tensor):
            try:
                return self._crop_tensor(upstream, meta)
            except Exception as e:
                print(f"[PixaromaCrop] upstream crop error: {e}")
                # Fall through to disk path

        # ── Disk composite path (back-compat) ─────────────────────────────────
        return self._load_disk_composite(meta, empty_image)

    # ─────────────────────────────────────────────────────────────────────────

    def _crop_tensor(self, tensor, meta):
        """Crop an upstream IMAGE tensor [B,H,W,C] using the saved rect.

        Rect coords are scaled proportionally if upstream dims differ from the
        original_w/original_h captured at editor save time. If meta is empty
        (user wired upstream but never opened the editor), pass through unmodified.
        """
        if tensor.dim() != 4 or tensor.shape[0] == 0:
            # Unexpected shape -- pass through unmodified
            if tensor.dim() >= 3:
                return (tensor, int(tensor.shape[-2]), int(tensor.shape[-3]))
            return (tensor, 0, 0)

        b, h, w, c = tensor.shape

        # No saved rect → pass through (gives the user a sensible preview before
        # they open the editor for the first time).
        if not meta or meta.get("crop_w") in (None, 0):
            return (tensor, int(w), int(h))

        crop_x = float(meta.get("crop_x", 0))
        crop_y = float(meta.get("crop_y", 0))
        crop_w = float(meta.get("crop_w", w))
        crop_h = float(meta.get("crop_h", h))
        orig_w = float(meta.get("original_w", w))
        orig_h = float(meta.get("original_h", h))

        # Scale rect proportionally if upstream dims changed since save
        if orig_w > 0 and orig_h > 0 and (orig_w != w or orig_h != h):
            sx = w / orig_w
            sy = h / orig_h
            crop_x *= sx
            crop_y *= sy
            crop_w *= sx
            crop_h *= sy

        x0 = max(0, int(round(crop_x)))
        y0 = max(0, int(round(crop_y)))
        x1 = min(w, int(round(crop_x + crop_w)))
        y1 = min(h, int(round(crop_y + crop_h)))

        if x1 <= x0 or y1 <= y0:
            print(f"[PixaromaCrop] degenerate rect ({x0},{y0},{x1},{y1}) for {w}x{h} — passing through")
            return (tensor, int(w), int(h))

        cropped = tensor[:, y0:y1, x0:x1, :].contiguous()
        return (cropped, int(x1 - x0), int(y1 - y0))

    def _load_disk_composite(self, meta, empty_image):
        """Original behavior: load the editor-saved cropped PNG from input/pixaroma/."""
        doc_w = int(meta.get("doc_w", 1024))
        doc_h = int(meta.get("doc_h", 1024))

        composite_path = meta.get("composite_path", "")
        if not composite_path:
            arr = np.ones((doc_h, doc_w, 3), dtype=np.float32)
            return (torch.from_numpy(arr)[None,], doc_w, doc_h)

        input_dir = os.path.realpath(folder_paths.get_input_directory())
        full_path = os.path.realpath(os.path.join(input_dir, composite_path))

        if not full_path.startswith(input_dir + os.sep):
            print("[PixaromaCrop] Security: composite_path escapes input directory, blocked.")
            return (empty_image, doc_w, doc_h)

        if not os.path.exists(full_path):
            return (empty_image, doc_w, doc_h)

        try:
            img = Image.open(full_path).convert("RGB")
            arr = np.array(img).astype(np.float32) / 255.0
            return (torch.from_numpy(arr)[None,], doc_w, doc_h)
        except Exception as e:
            print(f"[PixaromaCrop] Load error: {e}")
            return (empty_image, 1024, 1024)


NODE_CLASS_MAPPINGS = {
    "PixaromaCrop": PixaromaCrop,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaCrop": "Image Crop Pixaroma",
}
