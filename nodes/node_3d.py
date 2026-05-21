import torch
import numpy as np
from PIL import Image
import os
import json
import folder_paths
from .node_ref import any_type, FlexibleOptionalInputType

class Pixaroma3D:
    @classmethod
    def INPUT_TYPES(self):
        return {
            "required": {},
            "optional": FlexibleOptionalInputType(any_type),
        }

    CATEGORY = "👑 Pixaroma"
    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("image", "width", "height")
    OUTPUT_TOOLTIPS = ("The rendered 3D scene.", "Image width in pixels.", "Image height in pixels.")
    FUNCTION = "load_render"
    DESCRIPTION = (
        "3D Builder Pixaroma - a full 3D scene editor that runs inside ComfyUI. "
        "Open the fullscreen editor on the node to drop in primitives (cubes, "
        "spheres, cylinders, torus, blob, terrain, rock, teapot, hollow vessels), "
        "composite assets (trees, houses, furniture, flowers), or import your own "
        ".glb / .obj models.\n\n"
        "Camera controls (orbit, pan, zoom), realistic lighting, undo / redo, and "
        "live preview are all built in. Keyboard shortcuts use the Blender layout "
        "(G to grab, S to scale, R to rotate, Shift+D to duplicate, plus Numpad "
        "1/3/7 for view presets).\n\n"
        "Outputs the final render as an IMAGE plus its width and height so you can "
        "wire straight into ControlNet (great for depth maps, line art, normal maps) "
        "or any img2img workflow.\n\n"
        "Inputs are dynamic placeholder slots created by the editor when you add a "
        "background-image layer; their tooltips live on the JS side."
    )
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        """Force re-execution when the render file on disk changes."""
        scene_data = kwargs.get("SceneWidget")
        if not scene_data:
            return ""
        try:
            scene_json = scene_data.get("scene_json", "{}")
            meta = json.loads(scene_json)
            composite_path = meta.get("composite_path", "")
            if composite_path:
                input_dir = folder_paths.get_input_directory()
                full_path = os.path.join(input_dir, composite_path)
                if os.path.exists(full_path):
                    return os.path.getmtime(full_path)
        except Exception:
            pass
        return str(scene_data)

    def load_render(self, **kwargs):
        empty_image = torch.zeros((1, 1024, 1024, 3), dtype=torch.float32)

        # Extract scene data from the DOM widget
        scene_data = kwargs.get("SceneWidget")
        if not scene_data:
            return (empty_image, 1024, 1024)

        scene_json = scene_data.get("scene_json", "{}") if isinstance(scene_data, dict) else str(scene_data)

        if not scene_json or scene_json.strip() in ("", "{}"):
            return (empty_image, 1024, 1024)

        try:
            meta = json.loads(scene_json)
            if not isinstance(meta, dict):
                return (empty_image, 1024, 1024)

            doc_w = int(meta.get("doc_w", 1024))
            doc_h = int(meta.get("doc_h", 1024))

            composite_path = meta.get("composite_path", "")
            if not composite_path:
                arr = np.zeros((doc_h, doc_w, 3), dtype=np.float32)
                return (torch.from_numpy(arr)[None,], doc_w, doc_h)

            input_dir = os.path.realpath(folder_paths.get_input_directory())
            full_path = os.path.realpath(os.path.join(input_dir, composite_path))

            if not full_path.startswith(input_dir + os.sep):
                print(
                    "[Pixaroma3D] Security: composite_path escapes input directory, blocked."
                )
                return (empty_image, doc_w, doc_h)

            if not os.path.exists(full_path):
                return (empty_image, doc_w, doc_h)

            img = Image.open(full_path).convert("RGB")
            arr = np.array(img).astype(np.float32) / 255.0
            return (torch.from_numpy(arr)[None,], doc_w, doc_h)

        except Exception as e:
            print(f"[Pixaroma3D] Load error: {e}")
            return (empty_image, 1024, 1024)


NODE_CLASS_MAPPINGS = {
    "Pixaroma3D": Pixaroma3D,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Pixaroma3D": "3D Builder Pixaroma",
}
