import torch
import numpy as np
from PIL import Image, ImageChops
import os
import json
import time
import folder_paths
from .node_ref import any_type, FlexibleOptionalInputType


# Temp subfolder for Image Composer node previews (cleared by ComfyUI
# between runs). We save the final executed image here so the node's
# mini preview can show the EXACT result — matching what downstream
# Preview Image nodes see, including any auto-rembg applied.
_PIXAROMA_PREVIEW_SUBFOLDER = "pixaroma_composer_preview"


def _save_preview_png(pil_img, doc_w, doc_h):
    """Save the final composed image into ComfyUI's temp dir so the
    ImageComposer node's JS side can fetch it and update the mini
    preview. Returns the UI image descriptor dict expected by
    ComfyUI's onExecuted message."""
    try:
        temp_dir = os.path.join(folder_paths.get_temp_directory(), _PIXAROMA_PREVIEW_SUBFOLDER)
        os.makedirs(temp_dir, exist_ok=True)
        filename = f"composer_{int(time.time() * 1000)}.png"
        path = os.path.join(temp_dir, filename)
        # RGB export — the ImageComposer's canvas is always a flat RGB
        # image from the browser's point of view. Alpha channel from
        # rembg output gets baked onto whatever bg color was set.
        out = pil_img.convert("RGB") if pil_img.mode != "RGB" else pil_img
        out.save(path, format="PNG", optimize=False)
        return {
            "filename": filename,
            "subfolder": _PIXAROMA_PREVIEW_SUBFOLDER,
            "type": "temp",
        }
    except Exception as e:
        print(f"[Pixaroma] preview save failed: {e}")
        return None


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


def _remove_background(img, quality="auto"):
    """Remove background from a PIL RGBA image using rembg (returns RGBA).

    Accepts either a modern model id ('u2net' / 'isnet-general-use' /
    'birefnet-general') or a legacy quality tier ('normal' / 'high' /
    'auto'). Tries the requested model first, then walks the auto
    fallback chain (best → lightest) if it's not installed.
    """
    try:
        from rembg import remove, new_session
        import io

        # Legacy tier → modern model. Keeps old saved scenes working.
        _legacy = {"normal": "isnet-general-use", "high": "birefnet-general"}
        requested = _legacy.get(quality, quality) or "auto"

        # Try requested first, then fall through the auto chain. This
        # matches the server-side /pixaroma/remove_bg behaviour so the
        # workflow output matches what the Image Composer preview uses.
        auto_chain = ("birefnet-general", "isnet-general-use", "u2net")
        order = (list(auto_chain) if requested == "auto"
                 else [requested] + [n for n in auto_chain if n != requested])
        session = None
        for name in order:
            try:
                session = new_session(name)
                print(f"[Pixaroma] Auto Remove BG: using model '{name}'")
                break
            except Exception as e:
                print(f"[Pixaroma] model '{name}' not available: {e}")
        if session is None:
            print("[Pixaroma] No rembg model could be loaded, skipping remove BG")
            return img

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


def _apply_eraser_mask(img, mask_path, input_dir):
    """Apply eraser mask to image alpha. Mask white pixels = erased."""
    mask_img = _load_server_image(mask_path, input_dir)
    if mask_img is None:
        return img
    mask_img = mask_img.resize(img.size, Image.LANCZOS)
    # Mask uses destination-out: opaque pixels in mask = erased
    # So we subtract mask alpha from image alpha
    r, g, b, a = img.split()
    mask_a = mask_img.split()[3]  # alpha channel of mask
    # Where mask is opaque, set image alpha to 0
    a = ImageChops.subtract(a, mask_a)
    return Image.merge("RGBA", (r, g, b, a))


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

            has_masks = any(l.get("maskSrc") for l in layers)

            if has_placeholders or has_auto_rembg or has_masks:
                # Composite from scratch so placeholder slots are filled, rembg and masks applied
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
                                layer_img = _remove_background(layer_img, layer.get("bgRemovalQuality", "auto"))
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
                            layer_img = _remove_background(layer_img, layer.get("bgRemovalQuality", "auto"))
                    # Apply eraser mask if present (mask white = erased)
                    mask_src = layer.get("maskSrc")
                    if mask_src:
                        layer_img = _apply_eraser_mask(layer_img, mask_src, input_dir)
                    composed = _apply_layer_transform(layer_img, layer, doc_w, doc_h)
                    canvas = Image.alpha_composite(canvas, composed)
                # Save the final composed image to temp so the node's
                # mini preview gets the exact executed result (including
                # auto-rembg / mask application). Without this, the JS
                # `rebuildPreview` re-composes the raw placeholder
                # images client-side and the mini preview looks nothing
                # like the Preview Image output downstream.
                preview_img = _save_preview_png(canvas, doc_w, doc_h)
                result = (_pil_to_tensor(canvas), doc_w, doc_h)
                if preview_img:
                    return {"ui": {"images": [preview_img]}, "result": result}
                return result

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
