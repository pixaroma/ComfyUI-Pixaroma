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
        """Force re-execution when the cropped file on disk changes."""
        crop_data = kwargs.get("CropWidget")
        if not crop_data:
            return ""
        try:
            crop_json = crop_data.get("crop_json", "{}") if isinstance(crop_data, dict) else str(crop_data)
            meta = json.loads(crop_json)
            composite_path = meta.get("composite_path", "")
            if composite_path:
                input_dir = folder_paths.get_input_directory()
                full_path = os.path.join(input_dir, composite_path)
                if os.path.exists(full_path):
                    return os.path.getmtime(full_path)
        except Exception:
            pass
        return str(crop_data)

    def load_crop(self, **kwargs):
        empty_image = torch.ones((1, 1024, 1024, 3), dtype=torch.float32)

        crop_data = kwargs.get("CropWidget")
        if not crop_data:
            return (empty_image, 1024, 1024)

        crop_json = crop_data.get("crop_json", "{}") if isinstance(crop_data, dict) else str(crop_data)
        if not crop_json or crop_json.strip() in ("", "{}"):
            return (empty_image, 1024, 1024)
        try:
            meta = json.loads(crop_json)
            if not isinstance(meta, dict):
                return (empty_image, 1024, 1024)

            doc_w = int(meta.get("doc_w", 1024))
            doc_h = int(meta.get("doc_h", 1024))

            composite_path = meta.get("composite_path", "")
            if not composite_path:
                arr = np.ones((doc_h, doc_w, 3), dtype=np.float32)
                return (torch.from_numpy(arr)[None,], doc_w, doc_h)

            input_dir = os.path.realpath(folder_paths.get_input_directory())
            full_path = os.path.realpath(os.path.join(input_dir, composite_path))

            if not full_path.startswith(input_dir + os.sep):
                print(
                    "[PixaromaCrop] Security: composite_path escapes input directory, blocked."
                )
                return (empty_image, doc_w, doc_h)

            if not os.path.exists(full_path):
                return (empty_image, doc_w, doc_h)

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
