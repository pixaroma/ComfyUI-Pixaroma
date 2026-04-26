import os
import sys
import uuid

import numpy as np
from PIL import Image
import torch
import torch.nn.functional as F

import comfy.model_management
import folder_paths


_DEPTH_CACHE = {}

_MIDAS_WEIGHT_URLS = {
    "MiDaS_small": (
        "midas_v21_small_256.pt",
        "https://github.com/isl-org/MiDaS/releases/download/v2_1/midas_v21_small_256.pt",
    ),
    "DPT_Large": (
        "dpt_large_384.pt",
        "https://github.com/isl-org/MiDaS/releases/download/v3/dpt_large_384.pt",
    ),
    "DPT_Hybrid": (
        "dpt_hybrid_384.pt",
        "https://github.com/isl-org/MiDaS/releases/download/v3/dpt_hybrid_384.pt",
    ),
}

_DA2_REPOS = {
    "DepthAnythingV2_Small": "depth-anything/Depth-Anything-V2-Small-hf",
    "DepthAnythingV2_Base":  "depth-anything/Depth-Anything-V2-Base-hf",
    "DepthAnythingV2_Large": "depth-anything/Depth-Anything-V2-Large-hf",
}


def _midas_install_hint(model_name, hub_dir, original_error):
    fname, url = _MIDAS_WEIGHT_URLS.get(model_name, ("<unknown>", "<unknown>"))
    checkpoints_dir = os.path.join(hub_dir, "checkpoints")
    repo_dir = os.path.join(hub_dir, "intel-isl_MiDaS_master")
    return (
        f"\n[Pixaroma] Depth Map — MiDaS '{model_name}' failed to load.\n"
        f"   Reason: {original_error}\n\n"
        f"   Manual install (offline / blocked download):\n"
        f"     1. Download the weights file:\n"
        f"        {url}\n"
        f"     2. Place it here (create the folder if missing):\n"
        f"        {os.path.join(checkpoints_dir, fname)}\n"
        f"     3. If the FIRST run can't clone the MiDaS repo at all, also\n"
        f"        download the source zip from:\n"
        f"        https://github.com/isl-org/MiDaS/archive/refs/heads/master.zip\n"
        f"        and extract it as:\n"
        f"        {repo_dir}\n"
        f"     4. Re-run the workflow.\n"
    )


def _da2_install_hint(model_name, original_error):
    repo = _DA2_REPOS.get(model_name, "<unknown>")
    return (
        f"\n[Pixaroma] Depth Map — '{model_name}' failed to load.\n"
        f"   Reason: {original_error}\n\n"
        f"   This model uses Hugging Face transformers. To install:\n"
        f"     pip install transformers\n\n"
        f"   The weights download automatically on first use:\n"
        f"     repo: {repo}\n"
        f"     cache dir: ~/.cache/huggingface/hub/  (or HF_HOME env var)\n"
        f"     size: ~100 MB Small / ~400 MB Base / ~1.3 GB Large\n\n"
        f"   If you don't want transformers, switch depth_model to\n"
        f"   DPT_Large or MiDaS_small (loaded via torch.hub instead).\n"
    )


def _safe_hub_load(repo, model, trust_repo=True):
    """torch.hub.load with comfyui_controlnet_aux's bundled midas package
    hidden so the real intel-isl/MiDaS resolves."""
    original_sys_path = sys.path.copy()
    sys.path = [p for p in sys.path if "comfyui_controlnet_aux" not in p.lower()]
    hidden = {}
    for name in list(sys.modules.keys()):
        if name == "midas" or name.startswith("midas."):
            hidden[name] = sys.modules.pop(name)
    try:
        return torch.hub.load(repo, model, trust_repo=trust_repo)
    finally:
        sys.path = original_sys_path
        for name, mod in hidden.items():
            sys.modules[name] = mod


def _build_midas_predictor(model_name, device):
    portable_hub_dir = os.path.join(folder_paths.models_dir, "torch_hub")
    os.makedirs(portable_hub_dir, exist_ok=True)
    torch.hub.set_dir(portable_hub_dir)

    try:
        model = _safe_hub_load("intel-isl/MiDaS", model_name, trust_repo=True)
        model.to(device).eval()
        transforms_mod = _safe_hub_load("intel-isl/MiDaS", "transforms", trust_repo=True)
    except Exception as e:
        msg = _midas_install_hint(model_name, portable_hub_dir, e)
        print(msg)
        raise RuntimeError(msg) from e

    if model_name in ("DPT_Large", "DPT_Hybrid"):
        transform = transforms_mod.dpt_transform
    else:
        transform = transforms_mod.small_transform

    def predict(img_uint8):
        with torch.no_grad():
            input_batch = transform(img_uint8).to(device)
            pred = model(input_batch)
        if pred.dim() == 3:
            pred = pred.squeeze(0)
        return pred.float()

    return predict


def _build_da2_predictor(model_name, device):
    try:
        from transformers import pipeline
    except Exception as e:
        msg = _da2_install_hint(model_name, e)
        print(msg)
        raise RuntimeError(msg) from e

    try:
        pipe = pipeline(
            "depth-estimation",
            model=_DA2_REPOS[model_name],
            device=device,
        )
    except Exception as e:
        msg = _da2_install_hint(model_name, e)
        print(msg)
        raise RuntimeError(msg) from e

    def predict(img_uint8):
        pil = Image.fromarray(img_uint8)
        with torch.no_grad():
            result = pipe(pil)
        depth = result["predicted_depth"]
        if not isinstance(depth, torch.Tensor):
            depth = torch.as_tensor(depth)
        if depth.dim() == 3:
            depth = depth.squeeze(0)
        return depth.to(device).float()

    return predict


def _get_depth_predictor(model_name, device):
    """Returns a callable predict(img_uint8 [H,W,3]) -> depth tensor on `device`
    at the model's native output spatial size. Cached process-wide by model
    name + device."""
    cached = _DEPTH_CACHE.get(model_name)
    if cached is not None and cached.get("device") == str(device):
        return cached["fn"]

    if model_name in _MIDAS_WEIGHT_URLS:
        fn = _build_midas_predictor(model_name, device)
    elif model_name in _DA2_REPOS:
        fn = _build_da2_predictor(model_name, device)
    else:
        raise ValueError(f"[Pixaroma] Depth Map — unknown depth_model: {model_name!r}")

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


class PixaromaDepthMap:
    """Estimates a depth map from an image (MiDaS or Depth Anything V2),
    applies invert / contrast / blur, and outputs an IMAGE that downstream
    nodes (e.g. Audio Depth Pixaroma) consume. Renders an inline preview
    so you can see what the depth pass produced."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Source image to estimate depth from."}),
                "depth_model": ([
                    "DepthAnythingV2_Large",
                    "DepthAnythingV2_Base",
                    "DepthAnythingV2_Small",
                    "DPT_Large",
                    "MiDaS_small",
                ], {"default": "DepthAnythingV2_Base",
                    "tooltip": (
                        "Depth estimator.\n"
                        "DepthAnythingV2_Base (default, ~6GB VRAM, ~400MB weights) — best quality/cost tradeoff. Sharper edges than DPT_Large at lower VRAM.\n"
                        "DepthAnythingV2_Large (~10GB VRAM, ~1.3GB weights) — top quality.\n"
                        "DepthAnythingV2_Small (~4GB VRAM, ~100MB weights) — fast previews.\n"
                        "DPT_Large / MiDaS_small — older MiDaS models via torch.hub. Use if you don't have the `transformers` package installed."
                    )}),
                "depth_invert": ("BOOLEAN", {"default": False,
                    "tooltip": "Flip the depth map (near ↔ far). Use when the model gets it backwards on stylized or unusual images."}),
                "depth_contrast": ("FLOAT", {"default": 1.5, "min": 0.5, "max": 3.0, "step": 0.05,
                    "tooltip": "Power curve on the depth map. 1.0 = unchanged. >1 = stronger near/far separation (more dramatic parallax — default 1.5). <1 = flatter, gentler motion."}),
                "depth_blur": ("INT", {"default": 5, "min": 0, "max": 30, "step": 1,
                    "tooltip": "Gaussian blur on the depth map in pixels. Default 5 — softens warp along object silhouettes, kills jagged geometry from sharp depth edges. Increase to 10–15 if edges still look noisy. 0 = off."}),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("image", "depth_map")
    FUNCTION = "generate"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma"

    def generate(self, image, depth_model, depth_invert, depth_contrast, depth_blur):
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

        # Post-process
        if depth_invert:
            depth = 1.0 - depth
        if depth_contrast != 1.0:
            depth = depth.clamp(min=0.0) ** depth_contrast
        if depth_blur > 0:
            depth = _gaussian_blur_2d(depth, depth_blur)

        # Convert to ComfyUI IMAGE format [1, H, W, 3] (R=G=B=depth)
        depth_image = depth.detach().unsqueeze(-1).expand(-1, -1, 3).contiguous().unsqueeze(0).cpu()

        # Inline preview: write PNG to temp/ and surface in the UI dict.
        # Same pattern as Preview Image Pixaroma.
        preview_arr = (depth_image[0].numpy() * 255.0).clip(0, 255).astype(np.uint8)
        pil = Image.fromarray(preview_arr)
        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)
        fname = f"pixaroma_depth_{uuid.uuid4().hex}.png"
        pil.save(os.path.join(temp_dir, fname), "PNG")

        print(f"[Pixaroma] Depth Map — {depth_model}, {W}x{H}, "
              f"invert={depth_invert}, contrast={depth_contrast}, blur={depth_blur}px")

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
