import torch
import numpy as np
from PIL import Image, ImageChops
import os
import json
import time
import folder_paths
from server import PromptServer
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


def _rgb_to_hsl(rgb):
    """rgb: (...,3) float 0-1 → (...,3) float HSL (H 0-1, S 0-1, L 0-1)."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.max(rgb, axis=-1)
    mn = np.min(rgb, axis=-1)
    l = (mx + mn) / 2
    d = mx - mn
    s = np.where(d == 0, 0, d / np.where(l < 0.5, mx + mn, 2 - mx - mn + 1e-10))
    h = np.zeros_like(l)
    mask = d != 0
    rc = (mx - r) / np.where(d == 0, 1, d)
    gc = (mx - g) / np.where(d == 0, 1, d)
    bc = (mx - b) / np.where(d == 0, 1, d)
    h = np.where((r == mx) & mask, bc - gc, h)
    h = np.where((g == mx) & mask, 2 + rc - bc, h)
    h = np.where((b == mx) & mask, 4 + gc - rc, h)
    h = (h / 6) % 1
    return np.stack([h, s, l], axis=-1)


def _hsl_to_rgb(hsl):
    h, s, l = hsl[..., 0], hsl[..., 1], hsl[..., 2]
    q = np.where(l < 0.5, l * (1 + s), l + s - l * s)
    p = 2 * l - q

    def hue2rgb(t):
        t = t % 1
        return np.where(t < 1/6, p + (q - p) * 6 * t,
               np.where(t < 1/2, q,
               np.where(t < 2/3, p + (q - p) * (2/3 - t) * 6, p)))

    r = np.where(s == 0, l, hue2rgb(h + 1/3))
    g = np.where(s == 0, l, hue2rgb(h))
    b = np.where(s == 0, l, hue2rgb(h - 1/3))
    return np.stack([r, g, b], axis=-1)


def _blend_over(base_rgba, top_rgba, mode):
    """Porter-Duff source-over with a blend function per W3C Compositing L1.
    Returns a new PIL RGBA image. Both inputs must be the same size RGBA."""
    if not mode or mode == "Normal":
        return Image.alpha_composite(base_rgba, top_rgba)

    b = np.asarray(base_rgba, dtype=np.float32) / 255.0
    t = np.asarray(top_rgba, dtype=np.float32) / 255.0
    base_rgb = b[..., :3]
    top_rgb = t[..., :3]
    base_a = b[..., 3:4]
    top_a = t[..., 3:4]

    if mode == "Multiply":
        blended = base_rgb * top_rgb
    elif mode == "Screen":
        blended = 1 - (1 - base_rgb) * (1 - top_rgb)
    elif mode == "Overlay":
        blended = np.where(base_rgb < 0.5, 2 * base_rgb * top_rgb, 1 - 2 * (1 - base_rgb) * (1 - top_rgb))
    elif mode == "Darken":
        blended = np.minimum(base_rgb, top_rgb)
    elif mode == "Lighten":
        blended = np.maximum(base_rgb, top_rgb)
    elif mode == "Color Dodge":
        blended = np.where(top_rgb >= 1, 1.0, np.minimum(1.0, base_rgb / np.maximum(1 - top_rgb, 1e-6)))
    elif mode == "Color Burn":
        blended = np.where(top_rgb <= 0, 0.0, np.maximum(0.0, 1 - (1 - base_rgb) / np.maximum(top_rgb, 1e-6)))
    elif mode == "Hard Light":
        blended = np.where(top_rgb < 0.5, 2 * base_rgb * top_rgb, 1 - 2 * (1 - base_rgb) * (1 - top_rgb))
    elif mode == "Soft Light":
        gd = np.where(base_rgb < 0.25, ((16 * base_rgb - 12) * base_rgb + 4) * base_rgb, np.sqrt(np.maximum(base_rgb, 0)))
        blended = np.where(top_rgb < 0.5,
                           base_rgb - (1 - 2 * top_rgb) * base_rgb * (1 - base_rgb),
                           base_rgb + (2 * top_rgb - 1) * (gd - base_rgb))
    elif mode == "Difference":
        blended = np.abs(base_rgb - top_rgb)
    elif mode == "Exclusion":
        blended = base_rgb + top_rgb - 2 * base_rgb * top_rgb
    elif mode in ("Hue", "Saturation", "Color", "Luminosity"):
        base_hsl = _rgb_to_hsl(base_rgb)
        top_hsl = _rgb_to_hsl(top_rgb)
        if mode == "Hue":
            out_hsl = np.stack([top_hsl[..., 0], base_hsl[..., 1], base_hsl[..., 2]], axis=-1)
        elif mode == "Saturation":
            out_hsl = np.stack([base_hsl[..., 0], top_hsl[..., 1], base_hsl[..., 2]], axis=-1)
        elif mode == "Color":
            out_hsl = np.stack([top_hsl[..., 0], top_hsl[..., 1], base_hsl[..., 2]], axis=-1)
        else:  # Luminosity
            out_hsl = np.stack([base_hsl[..., 0], base_hsl[..., 1], top_hsl[..., 2]], axis=-1)
        blended = _hsl_to_rgb(out_hsl)
    else:
        blended = top_rgb

    # W3C compositing: source_color = (1 - αb) * Cs + αb * B(Cb, Cs)
    # Then standard source-over with αs.
    adjusted_top = (1 - base_a) * top_rgb + base_a * np.clip(blended, 0, 1)
    out_rgb = top_a * adjusted_top + (1 - top_a) * base_a * base_rgb
    out_a = top_a + (1 - top_a) * base_a
    safe_a = np.where(out_a > 0, out_a, 1)
    out_rgb = np.where(out_a > 0, out_rgb / safe_a, 0)
    out = np.concatenate([out_rgb, out_a], axis=-1)
    out = (np.clip(out, 0, 1) * 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


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
                    canvas = _blend_over(canvas, composed, layer.get("blendMode", "Normal"))
                # Save the final composed image to temp so the node's
                # mini preview gets the exact executed result (including
                # auto-rembg / mask application). Without this, the JS
                # `rebuildPreview` re-composes the raw placeholder
                # images client-side and the mini preview looks nothing
                # like the Preview Image output downstream.
                #
                # IMPORTANT: we deliberately DON'T return {"ui":
                # {"images": [...]}} here — ComfyUI would then render
                # that image as a secondary preview panel below the
                # node widgets, on top of our custom top preview.
                # Instead we push a private WebSocket event that our
                # index.js listener picks up and applies to the top
                # preview only.
                preview_img = _save_preview_png(canvas, doc_w, doc_h)
                if preview_img:
                    try:
                        PromptServer.instance.send_sync(
                            "pixaroma-composer-preview",
                            {
                                "project_id": meta.get("project_id"),
                                "filename": preview_img["filename"],
                                "subfolder": preview_img["subfolder"],
                                "type": preview_img["type"],
                                "doc_w": doc_w,
                                "doc_h": doc_h,
                            },
                        )
                    except Exception as e:
                        print(f"[Pixaroma] preview WS send failed: {e}")
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
