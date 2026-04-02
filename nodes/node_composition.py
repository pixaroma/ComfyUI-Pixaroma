import torch
import numpy as np
from PIL import Image
import os
import json
import folder_paths
from .node_ref import any_type, FlexibleOptionalInputType


class PixaromaImageComposition:
    @classmethod
    def INPUT_TYPES(self):
        return {
            "required": {},
            "optional": FlexibleOptionalInputType(any_type),
        }

    # ADDED: New Width and Height INT outputs!
    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("image", "width", "height")
    FUNCTION = "load_composite"
    CATEGORY = "Pixaroma"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        """Force re-execution when the composite file on disk changes."""
        composition_data = kwargs.get("ComposerWidget")
        if not composition_data:
            return ""
        try:
            project_json = composition_data.get("project_json", "{}") if isinstance(composition_data, dict) else str(composition_data)
            meta = json.loads(project_json)
            composite_path = meta.get("composite_path", "")
            if composite_path:
                input_dir = folder_paths.get_input_directory()
                full_path = os.path.join(input_dir, composite_path)
                if os.path.exists(full_path):
                    return os.path.getmtime(full_path)
        except Exception:
            pass
        return str(composition_data)

    def load_composite(self, **kwargs):
        empty_image = torch.zeros((1, 1024, 1024, 3), dtype=torch.float32)

        composition_data = kwargs.get("ComposerWidget")
        if not composition_data:
            return (empty_image, 1024, 1024)

        project_json = composition_data.get("project_json", "{}") if isinstance(composition_data, dict) else str(composition_data)

        if not project_json or project_json == "" or project_json == "{}":
            return (empty_image, 1024, 1024)

        try:
            meta = json.loads(project_json)
            if not isinstance(meta, dict):
                return (empty_image, 1024, 1024)

            # Grab actual dimensions from JSON
            doc_w = int(meta.get("doc_w", 1024))
            doc_h = int(meta.get("doc_h", 1024))

            composite_path = meta.get("composite_path")
            if not composite_path:
                return (empty_image, doc_w, doc_h)

            input_dir = os.path.realpath(folder_paths.get_input_directory())
            full_path = os.path.realpath(os.path.join(input_dir, composite_path))

            # Security: block path traversal — path must stay inside input_dir
            if not full_path.startswith(input_dir + os.sep):
                print(
                    "[Pixaroma] Security: composite_path escapes input directory, blocked."
                )
                return (empty_image, doc_w, doc_h)

            if not os.path.exists(full_path):
                return (empty_image, doc_w, doc_h)

            img = Image.open(full_path).convert("RGB")
            img = np.array(img).astype(np.float32) / 255.0
            img_tensor = torch.from_numpy(img)[None,]

            # Return Image + Dimensions
            return (img_tensor, doc_w, doc_h)

        except Exception as e:
            print(f"[Pixaroma] Fatal Load Error: {e}")
            return (empty_image, 1024, 1024)


NODE_CLASS_MAPPINGS = {
    "PixaromaImageComposition": PixaromaImageComposition,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaImageComposition": "Image Composer Pixaroma",
}
