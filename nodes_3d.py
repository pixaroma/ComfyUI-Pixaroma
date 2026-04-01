import torch
import numpy as np
from PIL import Image
import os
import json
import folder_paths


class Pixaroma3D:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "scene_json": ("STRING", {"default": "{}", "multiline": True}),
            }
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("IMAGE", "WIDTH", "HEIGHT")
    FUNCTION = "load_render"
    CATEGORY = "Pixaroma"

    @classmethod
    def IS_CHANGED(cls, scene_json):
        """Force re-execution when the render file on disk changes."""
        if not scene_json or scene_json.strip() in ("", "{}"):
            return ""
        try:
            meta = json.loads(scene_json)
            composite_path = meta.get("composite_path", "")
            if composite_path:
                input_dir = folder_paths.get_input_directory()
                full_path = os.path.join(input_dir, composite_path)
                if os.path.exists(full_path):
                    return os.path.getmtime(full_path)
        except Exception:
            pass
        return scene_json

    def load_render(self, scene_json):
        empty_image = torch.zeros((1, 1024, 1024, 3), dtype=torch.float32)

        if not scene_json or scene_json.strip() in ("", "{}"):
            return (empty_image, 1024, 1024)

        try:
            meta = json.loads(scene_json)
            if not isinstance(meta, dict):
                return (empty_image, 1280, 720)

            doc_w = int(meta.get("doc_w", 1024))
            doc_h = int(meta.get("doc_h", 1024))

            composite_path = meta.get("composite_path", "")
            if not composite_path:
                arr = np.zeros((doc_h, doc_w, 3), dtype=np.float32)
                return (torch.from_numpy(arr)[None,], doc_w, doc_h)

            input_dir = os.path.realpath(folder_paths.get_input_directory())
            full_path = os.path.realpath(os.path.join(input_dir, composite_path))

            if not full_path.startswith(input_dir + os.sep):
                print("[Pixaroma3D] Security: composite_path escapes input directory, blocked.")
                return (empty_image, doc_w, doc_h)

            if not os.path.exists(full_path):
                return (empty_image, doc_w, doc_h)

            img = Image.open(full_path).convert("RGB")
            arr = np.array(img).astype(np.float32) / 255.0
            return (torch.from_numpy(arr)[None,], doc_w, doc_h)

        except Exception as e:
            print(f"[Pixaroma3D] Load error: {e}")
            return (empty_image, 1280, 720)


NODE_CLASS_MAPPINGS = {
    "Pixaroma3D": Pixaroma3D,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Pixaroma3D": "3D Builder Pixaroma",
}
