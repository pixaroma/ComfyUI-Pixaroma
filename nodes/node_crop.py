import os
import uuid
import torch
import numpy as np
from PIL import Image
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

    def _save_source_temp(self, tensor):
        """Save the *input* tensor (full uncropped, batch slot 0) to ComfyUI's
        temp/ as a UUID-named PNG so the JS editor + mini-preview can fetch
        it via /view?type=temp. Best-effort — returns the filename or None
        on any failure (never raise; the workflow must keep running)."""
        try:
            if not isinstance(tensor, torch.Tensor) or tensor.dim() != 4 or tensor.shape[0] == 0:
                return None
            arr = tensor[0].clamp(0.0, 1.0).cpu().numpy()
            arr = (arr * 255.0 + 0.5).astype(np.uint8)
            img = Image.fromarray(arr)
            temp_dir = folder_paths.get_temp_directory()
            os.makedirs(temp_dir, exist_ok=True)
            fname = f"pixaroma_crop_src_{uuid.uuid4().hex}.png"
            img.save(os.path.join(temp_dir, fname), "PNG")
            return fname
        except Exception as e:
            print(f"[PixaromaCrop] temp source save failed: {e}")
            return None

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

        # Capture the *input* tensor URL for the JS editor + mini-preview.
        # Best-effort: failures don't block the crop.
        ui_payload = None
        if isinstance(upstream, torch.Tensor):
            src_fname = self._save_source_temp(upstream)
            if src_fname:
                ui_payload = {"pixaroma_crop_source": [
                    {"filename": src_fname, "subfolder": "", "type": "temp"}
                ]}

        # ── Apply the crop ────────────────────────────────────────────────────
        if isinstance(upstream, torch.Tensor):
            try:
                result = self._crop_tensor(upstream, meta)
            except Exception as e:
                print(f"[PixaromaCrop] upstream crop error: {e}")
                result = self._load_disk_composite(meta, empty_image)
        else:
            result = self._load_disk_composite(meta, empty_image)

        if ui_payload:
            return {"ui": ui_payload, "result": result}
        return result

    # ─────────────────────────────────────────────────────────────────────────

    def _crop_tensor(self, tensor, meta):
        """Crop an upstream IMAGE tensor [B,H,W,C] using the saved rect.

        Coordinates are treated as ABSOLUTE pixels (no proportional rescale
        from original_w/original_h). The numeric panel + editor both write
        literal pixel values; rescaling on dim mismatch was confusing — typing
        W=430 on a 1920-wide source should crop 430 px, not "the same fraction"
        of the new image. Out-of-bounds coords are clamped to the image rect.
        If meta is empty (user wired upstream but never opened the editor or
        edited the panel), pass through unmodified.
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
