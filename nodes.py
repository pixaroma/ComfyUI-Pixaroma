import torch
import numpy as np
from PIL import Image
import os
import json
import folder_paths
from .nodes_utils import any_type, FlexibleOptionalInputType


class PixaromaImageComposition:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "project_json": ("STRING", {"default": "{}", "multiline": True}),
            }
        }

    # ADDED: New Width and Height INT outputs!
    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("IMAGE", "WIDTH", "HEIGHT")
    FUNCTION = "load_composite"
    CATEGORY = "Pixaroma"

    @classmethod
    def IS_CHANGED(cls, project_json):
        """Force re-execution when the composite file on disk changes."""
        if not project_json or project_json.strip() in ("", "{}"):
            return ""
        try:
            meta = json.loads(project_json)
            composite_path = meta.get("composite_path", "")
            if composite_path:
                input_dir = folder_paths.get_input_directory()
                full_path = os.path.join(input_dir, composite_path)
                if os.path.exists(full_path):
                    return os.path.getmtime(full_path)
        except Exception:
            pass
        return project_json

    def load_composite(self, project_json):
        empty_image = torch.zeros((1, 1024, 1024, 3), dtype=torch.float32)

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


class PixaromaShowText:
    @classmethod
    def INPUT_TYPES(s):
        return {"required": {"source": (any_type, {})}}

    RETURN_TYPES = ()
    FUNCTION = "show"
    OUTPUT_NODE = True
    CATEGORY = "Pixaroma"

    def show(self, source):
        try:
            import torch

            if isinstance(source, torch.Tensor):
                text = (
                    f"Tensor  shape={tuple(source.shape)}"
                    f"  dtype={source.dtype}"
                    f"  min={source.min().item():.4f}"
                    f"  max={source.max().item():.4f}"
                )
            elif isinstance(source, dict) and "samples" in source:
                s = source["samples"]
                text = f"Latent  shape={tuple(s.shape)}"
            else:
                text = str(source)
        except Exception:
            text = str(source)
        return {"ui": {"text": [text]}}


class PixaromaPaint:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "paint_json": ("STRING", {"default": "{}", "multiline": True}),
            }
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("IMAGE", "WIDTH", "HEIGHT")
    FUNCTION = "load_painting"
    CATEGORY = "Pixaroma"

    @classmethod
    def IS_CHANGED(cls, paint_json):
        """Force re-execution when the composite file on disk changes."""
        if not paint_json or paint_json.strip() in ("", "{}"):
            return ""
        try:
            meta = json.loads(paint_json)
            composite_path = meta.get("composite_path", "")
            if composite_path:
                input_dir = folder_paths.get_input_directory()
                full_path = os.path.join(input_dir, composite_path)
                if os.path.exists(full_path):
                    return os.path.getmtime(full_path)
        except Exception:
            pass
        return paint_json

    def load_painting(self, paint_json):
        empty_image = torch.ones((1, 1024, 1024, 3), dtype=torch.float32)

        if not paint_json or paint_json.strip() in ("", "{}"):
            return (empty_image, 1024, 1024)

        try:
            meta = json.loads(paint_json)
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
                    "[PixaromaPaint] Security: composite_path escapes input directory, blocked."
                )
                return (empty_image, doc_w, doc_h)

            if not os.path.exists(full_path):
                return (empty_image, doc_w, doc_h)

            img = Image.open(full_path).convert("RGB")
            arr = np.array(img).astype(np.float32) / 255.0
            return (torch.from_numpy(arr)[None,], doc_w, doc_h)

        except Exception as e:
            print(f"[PixaromaPaint] Load error: {e}")
            return (empty_image, 1024, 1024)


NODE_CLASS_MAPPINGS = {
    "PixaromaImageComposition": PixaromaImageComposition,
    "PixaromaShowText": PixaromaShowText,
    "PixaromaPaint": PixaromaPaint,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaImageComposition": "Image Composer Pixaroma",
    "PixaromaShowText": "Show Text",
    "PixaromaPaint": "Paint Pixaroma",
}
