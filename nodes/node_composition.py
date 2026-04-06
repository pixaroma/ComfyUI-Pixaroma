import torch
import numpy as np
from PIL import Image
import os
import json
import folder_paths
from .node_ref import any_type, FlexibleOptionalInputType


# ── Helpers for placeholder compositing ──────────────────────────────────────

def _hex_to_rgba(hex_str):
    hex_str = hex_str.lstrip("#")
    r, g, b = int(hex_str[0:2], 16), int(hex_str[2:4], 16), int(hex_str[4:6], 16)
    return (r, g, b, 255)


def _tensor_to_pil(tensor):
    """Convert ComfyUI IMAGE tensor [B,H,W,C] float32 0-1 → PIL RGBA."""
    arr = tensor[0].cpu().numpy()
    arr = (arr * 255).clip(0, 255).astype(np.uint8)
    img = Image.fromarray(arr, "RGB" if arr.shape[2] == 3 else "RGBA")
    return img.convert("RGBA")


def _pil_to_tensor(img):
    """Convert PIL RGB image → ComfyUI IMAGE tensor [1,H,W,3] float32 0-1."""
    arr = np.array(img.convert("RGB")).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None,]


def _load_server_image(src, input_dir):
    """Load a layer image from the ComfyUI input directory (path-safe)."""
    real_input = os.path.realpath(input_dir)
    full_path = os.path.realpath(os.path.join(input_dir, src))
    if not full_path.startswith(real_input + os.sep):
        return None
    if not os.path.exists(full_path):
        return None
    return Image.open(full_path).convert("RGBA")


def _remove_background(img, quality="normal"):
    """Remove background from a PIL RGBA image using rembg (returns RGBA)."""
    try:
        from rembg import remove, new_session
        import io
        if quality == "high":
            try:
                session = new_session("briarmbg")
            except Exception:
                session = new_session("u2net")
        else:
            session = new_session("u2net")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        result_bytes = remove(buf.getvalue(), session=session)
        return Image.open(io.BytesIO(result_bytes)).convert("RGBA")
    except ImportError:
        print("[Pixaroma] rembg not installed — skipping auto remove BG")
        return img
    except Exception as e:
        print(f"[Pixaroma] Auto remove BG failed: {e}")
        return img


def _fit_to_placeholder(img, ph_w, ph_h, mode="cover"):
    """Resize and crop/pad img to fit placeholder dimensions using the given mode."""
    src_w, src_h = img.size
    if mode == "fill":
        return img.resize((ph_w, ph_h), Image.LANCZOS)
    elif mode == "contain":
        scale = min(ph_w / src_w, ph_h / src_h)
        new_w = max(1, int(src_w * scale))
        new_h = max(1, int(src_h * scale))
        resized = img.resize((new_w, new_h), Image.LANCZOS)
        result = Image.new("RGBA", (ph_w, ph_h), (0, 0, 0, 0))
        result.paste(resized, ((ph_w - new_w) // 2, (ph_h - new_h) // 2))
        return result
    else:  # cover
        scale = max(ph_w / src_w, ph_h / src_h)
        new_w = max(1, int(src_w * scale))
        new_h = max(1, int(src_h * scale))
        resized = img.resize((new_w, new_h), Image.LANCZOS)
        left = (new_w - ph_w) // 2
        top = (new_h - ph_h) // 2
        return resized.crop((left, top, left + ph_w, top + ph_h))


def _apply_layer_transform(img, layer, doc_w, doc_h):
    """Apply layer transforms and return a doc-sized RGBA canvas."""
    nat_w, nat_h = img.size
    scale_x = abs(layer.get("scaleX", 1.0))
    scale_y = abs(layer.get("scaleY", 1.0))
    new_w = max(1, int(nat_w * scale_x))
    new_h = max(1, int(nat_h * scale_y))
    img = img.resize((new_w, new_h), Image.LANCZOS)

    if layer.get("flippedX"):
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    if layer.get("flippedY"):
        img = img.transpose(Image.FLIP_TOP_BOTTOM)

    rotation = layer.get("rotation", 0)
    if rotation:
        img = img.rotate(-rotation, expand=True, resample=Image.BICUBIC)

    opacity = layer.get("opacity", 1.0)
    if opacity < 1.0:
        r, g, b, a = img.split()
        a = a.point(lambda x: int(x * opacity))
        img = Image.merge("RGBA", (r, g, b, a))

    cx = layer.get("cx", doc_w / 2)
    cy = layer.get("cy", doc_h / 2)
    paste_x = int(cx - img.width / 2)
    paste_y = int(cy - img.height / 2)

    canvas = Image.new("RGBA", (doc_w, doc_h), (0, 0, 0, 0))
    canvas.paste(img, (paste_x, paste_y), img)
    return canvas


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

            layers = meta.get("layers", [])
            input_dir = os.path.realpath(folder_paths.get_input_directory())
            has_placeholders = any(l.get("isPlaceholder") for l in layers)
            has_auto_rembg = any(l.get("removeBgOnExec") for l in layers)

            if has_placeholders or has_auto_rembg:
                # Composite from scratch so placeholder slots are filled and rembg is applied
                canvas = Image.new("RGBA", (doc_w, doc_h), (0, 0, 0, 0))
                for layer in layers:
                    if not layer.get("visible", True):
                        continue
                    if layer.get("isPlaceholder"):
                        ph_w = layer.get("naturalWidth", 512)
                        ph_h = layer.get("naturalHeight", 512)
                        img_input = kwargs.get(f"image_{layer['inputIndex']}")
                        if img_input is not None:
                            layer_img = _tensor_to_pil(img_input)
                            if layer.get("removeBgOnExec"):
                                layer_img = _remove_background(layer_img, layer.get("bgRemovalQuality", "normal"))
                            layer_img = _fit_to_placeholder(layer_img, ph_w, ph_h, layer.get("fillMode", "cover"))
                        else:
                            color = _hex_to_rgba(layer.get("placeholderColor", "#808080"))
                            layer_img = Image.new("RGBA", (ph_w, ph_h), color)
                    else:
                        src = layer.get("src") or ""
                        if not src or src == "__placeholder__":
                            continue
                        layer_img = _load_server_image(src, input_dir)
                        if layer_img is None:
                            continue
                        if layer.get("removeBgOnExec"):
                            layer_img = _remove_background(layer_img, layer.get("bgRemovalQuality", "normal"))
                    composed = _apply_layer_transform(layer_img, layer, doc_w, doc_h)
                    canvas = Image.alpha_composite(canvas, composed)
                return (_pil_to_tensor(canvas), doc_w, doc_h)

            # Fast path: load the pre-rendered composite PNG
            composite_path = meta.get("composite_path")
            if not composite_path:
                return (empty_image, doc_w, doc_h)

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
