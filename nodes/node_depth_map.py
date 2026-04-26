import os
import uuid

import numpy as np
from PIL import Image
import torch
import torch.nn.functional as F

import comfy.model_management
import folder_paths


_DEPTH_CACHE = {}


# Repo IDs and short folder names for the three Depth Anything V2 sizes.
# Files land under <ComfyUI>/models/depth-anything-v2/<Size>/ so the install
# is fully portable (move the ComfyUI folder, weights move with it) and
# users can inspect / replace files with a normal file manager.
_DA2 = {
    "DepthAnythingV2_Small": ("Small", "depth-anything/Depth-Anything-V2-Small-hf"),
    "DepthAnythingV2_Base":  ("Base",  "depth-anything/Depth-Anything-V2-Base-hf"),
    "DepthAnythingV2_Large": ("Large", "depth-anything/Depth-Anything-V2-Large-hf"),
}

# Files that snapshot_download / manual install must end up with for
# from_pretrained to work. README.md / .gitattributes are skipped.
_DA2_FILES = ("config.json", "preprocessor_config.json", "model.safetensors")


def _da2_local_dir(model_name):
    short_name, _ = _DA2[model_name]
    return os.path.join(folder_paths.models_dir, "depth-anything-v2", short_name)


def _da2_install_hint(model_name, target_dir, original_error):
    repo = _DA2[model_name][1]
    base_url = f"https://huggingface.co/{repo}/resolve/main"
    return (
        f"\n[Pixaroma] Depth Map — '{model_name}' failed to load.\n"
        f"   Reason: {original_error}\n\n"
        f"   The plugin expected model files at:\n"
        f"     {target_dir}\n\n"
        f"   Auto-download needs `transformers` and `huggingface_hub`:\n"
        f"     pip install transformers huggingface_hub\n\n"
        f"   Manual install (offline / blocked download):\n"
        f"     1. Create the folder above (if it doesn't exist).\n"
        f"     2. Download these files INTO that folder:\n"
        f"        {base_url}/config.json\n"
        f"        {base_url}/preprocessor_config.json\n"
        f"        {base_url}/model.safetensors\n"
        f"     3. Re-run the workflow.\n\n"
        f"   Sizes: Small ~100 MB, Base ~400 MB, Large ~1.3 GB.\n"
    )


def _ensure_da2_local(model_name, target_dir):
    """Download the three required files into target_dir if missing.
    Raises RuntimeError with manual-install instructions on failure."""
    have_all = all(
        os.path.isfile(os.path.join(target_dir, f)) for f in _DA2_FILES
    )
    if have_all:
        return

    try:
        from huggingface_hub import snapshot_download
    except Exception as e:
        raise RuntimeError(_da2_install_hint(model_name, target_dir, e)) from e

    repo_id = _DA2[model_name][1]
    os.makedirs(target_dir, exist_ok=True)
    print(f"[Pixaroma] Depth Map — downloading {repo_id} -> {target_dir}")
    try:
        snapshot_download(
            repo_id=repo_id,
            local_dir=target_dir,
            local_dir_use_symlinks=False,
            allow_patterns=list(_DA2_FILES),
        )
    except Exception as e:
        raise RuntimeError(_da2_install_hint(model_name, target_dir, e)) from e

    # Verify everything actually landed
    missing = [f for f in _DA2_FILES if not os.path.isfile(os.path.join(target_dir, f))]
    if missing:
        raise RuntimeError(_da2_install_hint(
            model_name, target_dir,
            f"download finished but these files are still missing: {missing}",
        ))


def _build_predictor(model_name, device):
    target_dir = _da2_local_dir(model_name)
    _ensure_da2_local(model_name, target_dir)

    try:
        from transformers import AutoImageProcessor, AutoModelForDepthEstimation
    except Exception as e:
        raise RuntimeError(_da2_install_hint(model_name, target_dir, e)) from e

    try:
        processor = AutoImageProcessor.from_pretrained(target_dir)
        model = AutoModelForDepthEstimation.from_pretrained(target_dir)
        model.to(device).eval()
    except Exception as e:
        raise RuntimeError(_da2_install_hint(model_name, target_dir, e)) from e

    def predict(img_uint8):
        pil = Image.fromarray(img_uint8)
        with torch.no_grad():
            inputs = processor(images=pil, return_tensors="pt").to(device)
            outputs = model(**inputs)
            depth = outputs.predicted_depth
        if depth.dim() == 3:
            depth = depth.squeeze(0)
        return depth.to(device).float()

    return predict


def _get_depth_predictor(model_name, device):
    """Returns a callable predict(img_uint8 [H,W,3]) -> depth tensor on `device`
    at the model's native output spatial size. Cached process-wide by model
    name + device — first call may download weights, subsequent calls are
    just inference."""
    cached = _DEPTH_CACHE.get(model_name)
    if cached is not None and cached.get("device") == str(device):
        return cached["fn"]

    if model_name not in _DA2:
        raise ValueError(
            f"[Pixaroma] Depth Map — unknown depth_model: {model_name!r}. "
            f"Expected one of {list(_DA2.keys())}."
        )
    fn = _build_predictor(model_name, device)
    _DEPTH_CACHE[model_name] = {"fn": fn, "device": str(device)}
    return fn


def _gaussian_blur_2d(x, kernel_size):
    """Separable Gaussian blur on a [H, W] tensor. kernel_size in pixels."""
    k = int(kernel_size)
    if k <= 0:
        return x
    if k % 2 == 0:
        k += 1
    sigma = k / 6.0
    half = k // 2
    coords = torch.arange(k, device=x.device, dtype=x.dtype) - half
    g = torch.exp(-(coords ** 2) / (2 * sigma ** 2))
    g = g / g.sum()
    x = x.unsqueeze(0).unsqueeze(0)
    x = F.conv2d(F.pad(x, (half, half, 0, 0), mode="reflect"), g.view(1, 1, 1, k))
    x = F.conv2d(F.pad(x, (0, 0, half, half), mode="reflect"), g.view(1, 1, k, 1))
    return x.squeeze(0).squeeze(0)


def _erode_2d(x, radius):
    """Morphological erosion (min-pool) on a [H, W] tensor. Pushes high
    values down toward neighboring lows — used to shrink the depth-map
    foreground inward so the warp boundary moves inside the silhouette,
    eliminating ghost-edge artifacts on parallax."""
    r = int(radius)
    if r <= 0:
        return x
    k = 2 * r + 1
    # min-pool via -max-pool(-x)
    return -F.max_pool2d(
        -x.unsqueeze(0).unsqueeze(0),
        kernel_size=k, stride=1, padding=r,
    ).squeeze(0).squeeze(0)


class PixaromaDepthMap:
    """Estimates a depth map from an image using Depth Anything V2 (Small /
    Base / Large), applies invert / contrast / blur, and outputs an IMAGE
    that downstream nodes (e.g. Audio Depth Pixaroma) consume. Renders an
    inline preview so you can see what the depth pass produced.

    Model files live under <ComfyUI>/models/depth-anything-v2/<Size>/ for
    a fully portable install."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Source image to estimate depth from. Passed through to the image output for clean wiring into Audio Depth Pixaroma."}),
                "depth_model": ([
                    "DepthAnythingV2_Large",
                    "DepthAnythingV2_Base",
                    "DepthAnythingV2_Small",
                ], {"default": "DepthAnythingV2_Base",
                    "tooltip": (
                        "Depth Anything V2 size:\n"
                        "Base (default, ~6 GB VRAM, ~400 MB on disk) — sweet spot, sharper than DPT_Large.\n"
                        "Large (~10 GB VRAM, ~1.3 GB on disk) — best quality.\n"
                        "Small (~4 GB VRAM, ~100 MB on disk) — fast previews / low VRAM.\n"
                        "First-use downloads automatically into <ComfyUI>/models/depth-anything-v2/<Size>/. If the download fails the node prints manual install URLs."
                    )}),
                "depth_invert": ("BOOLEAN", {"default": False,
                    "tooltip": "Flip the depth map (near ↔ far). Use when the model gets it backwards on stylized or unusual images."}),
                "depth_contrast": ("FLOAT", {"default": 1.5, "min": 0.5, "max": 3.0, "step": 0.05,
                    "tooltip": "Power curve on the depth map. 1.0 = unchanged. >1 = stronger near/far separation (more dramatic parallax — default 1.5). <1 = flatter, gentler motion."}),
                "depth_feather": ("INT", {"default": 0, "min": 0, "max": 30, "step": 1,
                    "tooltip": "Erode the depth-map foreground inward by N pixels (morphological min-pool). Pushes the depth boundary INSIDE the visible silhouette so the foreground edge gets background-depth shift — kills the 'ghost outline' artifact you see on cables / hair / thin shapes during heavy parallax. 0 = off (default). 5–15 = mild, hides most edge artifacts. 20–30 = aggressive (shrinks the whole foreground)."}),
                "depth_blur": ("INT", {"default": 5, "min": 0, "max": 100, "step": 1,
                    "tooltip": "Gaussian blur on the depth map in pixels (applied AFTER feather). Default 5 — softens depth transitions, smooths jagged warp geometry. Push higher (20–60) if you still see edge seams in the rendered video. 0 = off."}),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("image", "depth_map")
    FUNCTION = "generate"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma"

    def generate(self, image, depth_model, depth_invert, depth_contrast, depth_feather, depth_blur):
        device = comfy.model_management.get_torch_device()

        _, H, W, _ = image.shape

        predict = _get_depth_predictor(depth_model, device)

        img_uint8 = (image[0].cpu().numpy() * 255.0).clip(0, 255).astype("uint8")
        raw_depth = predict(img_uint8)

        # Resize to source image dims
        depth = F.interpolate(
            raw_depth.unsqueeze(0).unsqueeze(0),
            size=(H, W),
            mode="bicubic",
            align_corners=False,
        ).squeeze(0).squeeze(0)

        # Normalize to [0, 1]
        d_min, d_max = depth.min(), depth.max()
        depth = (depth - d_min) / (d_max - d_min + 1e-6)

        # Post-process: invert → contrast → feather (shrinks foreground inward
        # so warp boundary lives inside the silhouette) → blur (softens what's
        # left). Order matters: feather BEFORE blur so the eroded edge gets
        # smoothed, not the original sharp edge.
        if depth_invert:
            depth = 1.0 - depth
        if depth_contrast != 1.0:
            depth = depth.clamp(min=0.0) ** depth_contrast
        if depth_feather > 0:
            depth = _erode_2d(depth, depth_feather)
        if depth_blur > 0:
            depth = _gaussian_blur_2d(depth, depth_blur)

        # Convert to ComfyUI IMAGE format [1, H, W, 3] (R=G=B=depth)
        depth_image = depth.detach().unsqueeze(-1).expand(-1, -1, 3).contiguous().unsqueeze(0).cpu()

        # Inline preview: write PNG to temp/ and surface in the UI dict.
        preview_arr = (depth_image[0].numpy() * 255.0).clip(0, 255).astype(np.uint8)
        pil = Image.fromarray(preview_arr)
        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)
        fname = f"pixaroma_depth_{uuid.uuid4().hex}.png"
        pil.save(os.path.join(temp_dir, fname), "PNG")

        print(f"[Pixaroma] Depth Map — {depth_model}, {W}x{H}, "
              f"invert={depth_invert}, contrast={depth_contrast}, "
              f"feather={depth_feather}px, blur={depth_blur}px")

        return {
            "ui": {"images": [{"filename": fname, "subfolder": "", "type": "temp"}]},
            "result": (image, depth_image),
        }


NODE_CLASS_MAPPINGS = {
    "PixaromaDepthMap": PixaromaDepthMap,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaDepthMap": "Depth Map Pixaroma",
}
