"""Shared BiRefNet background-removal infrastructure for Pixaroma.

Used by:
- nodes/node_remove_background.py (Remove Background Pixaroma node)
- server_routes.py (/pixaroma/remove_bg + /pixaroma/remove_bg_info, called
  by Image Composer and Paint Pixaroma's AI Remove Background panels)

ComfyUI's native loader hardcodes 1024 in birefnet.json, so we bypass it
and build BackgroundRemovalModel ourselves with the right image_size.
Filename rule:
    contains "matt" -> 2048 (matting models, soft edges)
    has "hr" as a word-piece -> 2048 (HR models, hard edges + detail)
    otherwise -> 1024 (standard)
"""

import io
import logging
import os
import re
from collections import OrderedDict

import numpy as np
import torch
import folder_paths
from PIL import Image

import comfy.bg_removal_model
import comfy.model_management
import comfy.model_patcher
import comfy.ops
import comfy.utils


SENTINEL_NO_MODELS = "(no models - see Info tab)"
_DEFAULT_MODEL_NAME = "birefnet.safetensors"
_BIREFNET_MARKER = "bb.layers.1.blocks.0.attn.relative_position_index"
_HR_RE = re.compile(r"(?<![a-z])hr(?![a-z])", re.IGNORECASE)


# Canonical catalog of BiRefNet variants this node supports. The route
# returns this list (annotated with `installed`) so the frontend can
# render the dropdown + download links without hardcoding the list in
# JS too.
BIREFNET_VARIANTS = [
    {
        "id": "birefnet",
        "label": "BiRefNet Standard",
        "filename": "birefnet.safetensors",
        "sizeMB": 424,
        "resolution": 1024,
        "downloadUrl": "https://huggingface.co/Comfy-Org/BiRefNet/tree/main/background_removal",
        "vram": "4-6 GB",
        "bestFor": "clean objects, products, logos - fast everyday cutouts",
    },
    {
        # Same model file as Standard, just pinned to 512 internal resolution.
        # Lets users on 4-6 GB cards pick a guaranteed-fits option directly
        # instead of waiting for the auto OOM-retry chain in run_birefnet_on_pil.
        # Edges are softer (no fine detail from 1024 patches) but the silhouette
        # is still very good - usable for most product / character cutouts.
        "id": "birefnet-lowvram",
        "label": "BiRefNet Low VRAM",
        "filename": "birefnet.safetensors",
        "sizeMB": 424,
        "resolution": 512,
        "downloadUrl": "https://huggingface.co/Comfy-Org/BiRefNet/tree/main/background_removal",
        "vram": "2-3 GB",
        "bestFor": "low-VRAM cards (4-6 GB) - softer edges, always fits, faster",
    },
    {
        "id": "birefnet-hr",
        "label": "BiRefNet HR",
        "filename": "birefnet-hr.safetensors",
        "sizeMB": 444,
        "resolution": 2048,
        "downloadUrl": "https://huggingface.co/ZhengPeng7/BiRefNet_HR",
        "vram": "8 GB+",
        "bestFor": "large images with fine outline detail",
    },
    {
        "id": "birefnet-matting",
        "label": "BiRefNet Matting (Soft Edges)",
        "filename": "birefnet-matting.safetensors",
        "sizeMB": 444,
        "resolution": 2048,
        "downloadUrl": "https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting",
        "vram": "8 GB+",
        "bestFor": "hair, fur, lace, soft fabric (also try for glass/smoke)",
    },
]

_BIREFNET_IDS = {v["id"] for v in BIREFNET_VARIANTS}


def _resolution_for_filename(name):
    """Return 2048 for matting / HR filenames, 1024 otherwise."""
    stem = os.path.splitext(name)[0]
    lower = stem.lower()
    if "matt" in lower:
        return 2048
    if _HR_RE.search(stem):
        return 2048
    return 1024


class _PixaromaBgModel(comfy.bg_removal_model.BackgroundRemovalModel):
    """BackgroundRemovalModel that accepts a config dict instead of a json
    file path, so we can pass a custom image_size without writing a temp
    json. Mirrors the parent body line-for-line except for the dict-vs-file
    config source.

    force_cpu=True pins the model to CPU at fp32 (used as the last-ditch
    fallback when GPU OOMs at every retry resolution)."""

    def __init__(self, config, force_cpu=False):
        self.image_size = config.get("image_size", 1024)
        self.image_mean = config.get("image_mean", [0.0, 0.0, 0.0])
        self.image_std = config.get("image_std", [1.0, 1.0, 1.0])
        self.model_type = config.get("model_type", "birefnet")
        self.config = config.copy()

        model_class = comfy.bg_removal_model.BG_REMOVAL_MODELS.get(self.model_type)
        if model_class is None:
            raise ValueError(
                f"Remove Background Pixaroma: unknown model_type {self.model_type!r}. "
                "This node currently only supports 'birefnet'."
            )

        if force_cpu:
            cpu = torch.device("cpu")
            self.load_device = cpu
            offload_device = cpu
            # CPU runs everything in fp32 — fp16 on CPU is slower than fp32
            # in PyTorch and risks silent precision loss in BiRefNet's ops.
            self.dtype = torch.float32
        else:
            self.load_device = comfy.model_management.text_encoder_device()
            offload_device = comfy.model_management.text_encoder_offload_device()
            self.dtype = comfy.model_management.text_encoder_dtype(self.load_device)
        self.model = model_class(config, self.dtype, offload_device, comfy.ops.manual_cast)
        self.model.eval()

        self.patcher = comfy.model_patcher.CoreModelPatcher(
            self.model,
            load_device=self.load_device,
            offload_device=offload_device,
        )


def _load_bg_model(ckpt_path, image_size, force_cpu=False):
    """Load a BiRefNet safetensors at the requested input resolution.
    Optionally force CPU device (used as last-ditch fallback on GPU OOM).
    Refuses non-BiRefNet or non-Swin-L weights with a clear message."""
    sd = comfy.utils.load_torch_file(ckpt_path)
    if _BIREFNET_MARKER not in sd:
        raise ValueError(
            f"Remove Background Pixaroma: {os.path.basename(ckpt_path)} does not "
            "look like a BiRefNet model (missing the expected backbone keys). "
            "This node only supports BiRefNet variants. Download one from:\n"
            "  https://huggingface.co/Comfy-Org/BiRefNet/tree/main/background_removal"
        )

    # ComfyUI's BiRefNet hardcodes a Swin-L backbone (embed_dim=192). The
    # lite variant uses Swin-T (embed_dim=96) - same architecture name but
    # totally different tensor shapes.
    patch_weight = sd.get("bb.patch_embed.proj.weight")
    if patch_weight is not None and patch_weight.shape[0] != 192:
        raise ValueError(
            f"Remove Background Pixaroma: {os.path.basename(ckpt_path)} looks "
            f"like a different BiRefNet variant (embed_dim={patch_weight.shape[0]}, "
            "probably the 'lite' Swin-T version). This node only supports the "
            "Swin-L backbone variants (standard, HR, HR-matting). Pick a "
            "different file from the dropdown, or download one of:\n"
            "  https://huggingface.co/Comfy-Org/BiRefNet/tree/main/background_removal\n"
            "  https://huggingface.co/ZhengPeng7/BiRefNet_HR\n"
            "  https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting"
        )

    config = {
        "model_type": "birefnet",
        "image_size": image_size,
        "image_mean": [0.0, 0.0, 0.0],
        "image_std": [1.0, 1.0, 1.0],
        "resize_to_original": True,
    }
    bg_model = _PixaromaBgModel(config, force_cpu=force_cpu)
    m, u = bg_model.load_sd(sd)
    if m:
        logging.warning(
            "Remove Background Pixaroma: %d missing keys when loading %s",
            len(m),
            os.path.basename(ckpt_path),
        )
    u = set(u)
    for k in list(sd.keys()):
        if k not in u:
            sd.pop(k)
    return bg_model


# LRU cache, cap 4. Shared between the node and the route - both hit the
# same cache so a second call (same model + resolution + device) is free.
# Cap bumped from 2 to 4 because the OOM-fallback chain can hold several
# variants at once: (1024 GPU, 768 GPU, 512 GPU, 1024 CPU).
_MODEL_CACHE = OrderedDict()
_CACHE_CAP = 4


def _get_cached_model(ckpt_path, image_size, force_cpu=False):
    """Return cached BiRefNet wrapper for (path, image_size, device) triple."""
    key = (os.path.abspath(ckpt_path), image_size, force_cpu)
    if key in _MODEL_CACHE:
        _MODEL_CACHE.move_to_end(key)
        return _MODEL_CACHE[key]
    model = _load_bg_model(ckpt_path, image_size, force_cpu=force_cpu)
    _MODEL_CACHE[key] = model
    while len(_MODEL_CACHE) > _CACHE_CAP:
        _MODEL_CACHE.popitem(last=False)
    return model


def _evict_from_cache(ckpt_path, image_size, force_cpu=False):
    """Drop a specific cache entry. Used after OOM so the failed model's
    Python reference goes away and its VRAM can be reclaimed before the
    next retry. Without eviction a cached-then-OOM model would still hold
    VRAM via _MODEL_CACHE, and the next smaller-resolution attempt would
    OOM too."""
    key = (os.path.abspath(ckpt_path), image_size, force_cpu)
    if key in _MODEL_CACHE:
        del _MODEL_CACHE[key]


def _is_oom_error(exc):
    """Detect CUDA / device OOM by class AND by message string. Different
    torch versions wrap OOM differently (torch.cuda.OutOfMemoryError vs
    plain RuntimeError) and the message phrasing varies across versions
    ('out of memory', 'Allocation on device', 'CUDA_ERROR_OUT_OF_MEMORY')."""
    oom_cls = getattr(torch.cuda, "OutOfMemoryError", None)
    if oom_cls is not None and isinstance(exc, oom_cls):
        return True
    msg = str(exc).lower()
    return (
        "out of memory" in msg
        or "allocation on device" in msg
        or "cuda_error_out_of_memory" in msg
    )


_INSTALL_MESSAGE = (
    "No background-removal models found.\n"
    "\n"
    "Drop a BiRefNet .safetensors into ComfyUI/models/background_removal/ and "
    "refresh the workflow.\n"
    "\n"
    "Recommended files:\n"
    "  birefnet.safetensors           standard, 1024, hard edges\n"
    "  birefnet-hr.safetensors        HR, 2048, hard edges, more detail\n"
    "  birefnet-matting.safetensors   HR, 2048, soft edges (hair / fur)\n"
    "\n"
    "Filenames containing 'matt' or 'hr' (case-insensitive) preprocess at 2048; "
    "everything else at 1024. 2048 is slower and uses more VRAM.\n"
    "\n"
    "Download:\n"
    "  Standard:   https://huggingface.co/Comfy-Org/BiRefNet/tree/main/background_removal\n"
    "  HR:         https://huggingface.co/ZhengPeng7/BiRefNet_HR\n"
    "  HR-matting: https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting"
)


def _list_models():
    """Return the list of model filenames the dropdown should show.
    Sentinel item when the folder is empty so the dropdown is never blank.
    Pins `birefnet.safetensors` to position 0 so it becomes the default."""
    try:
        names = folder_paths.get_filename_list("background_removal")
    except Exception:
        names = []
    if not names:
        return [SENTINEL_NO_MODELS]
    names = sorted(names)
    if _DEFAULT_MODEL_NAME in names:
        names.remove(_DEFAULT_MODEL_NAME)
        names.insert(0, _DEFAULT_MODEL_NAME)
    return names


# ---------------------------------------------------------------------------
# New helpers for the /pixaroma/remove_bg route (Composer + Paint clients).
# ---------------------------------------------------------------------------


def is_birefnet_model_id(model_id):
    """True if `model_id` is one of our BiRefNet variant IDs."""
    return model_id in _BIREFNET_IDS


def get_birefnet_inventory():
    """Return the canonical variant list annotated with `installed`.
    Used by /pixaroma/remove_bg_info so the frontend dropdown can show
    download links for missing variants.

    Uses `folder_paths.get_full_path` to honour ComfyUI's extra_model_paths
    config (lots of users store models in a shared external dir, NOT the
    default ComfyUI/models/background_removal/)."""
    # Display path: prefer the first configured folder (where new downloads
    # should land), fall back to None if none configured.
    try:
        model_dir = folder_paths.get_folder_paths("background_removal")[0]
    except Exception:
        model_dir = None

    out = []
    for v in BIREFNET_VARIANTS:
        entry = dict(v)
        # get_full_path searches ALL configured roots (default + extras).
        # Returns the full path if found, None otherwise.
        try:
            found = folder_paths.get_full_path("background_removal", v["filename"])
        except Exception:
            found = None
        entry["installed"] = bool(found and os.path.isfile(found))
        out.append(entry)
    return {"modelDir": model_dir, "variants": out}


def run_birefnet_on_pil(pil_image, model_id):
    """Run a BiRefNet variant on a PIL image, return an RGBA PIL image
    with the foreground extracted (background made transparent).

    On GPU OOM, automatically retries at progressively smaller internal
    resolutions (native -> 768 -> 512), and finally on CPU if every GPU
    attempt failed. This means low-VRAM systems (e.g. 6 GB cards running
    BiRefNet Standard) still produce a cutout, at slightly softer edges
    (small resolution drop) or much slower (CPU fallback). The retry
    chain does NOT try to free GPU memory via unload_models — past
    attempts of that pattern were unreliable; this approach sidesteps it
    by using less memory or a different device entirely.

    Raises ValueError if the variant isn't installed or the model id is
    not a known BiRefNet variant. Raises RuntimeError if every retry
    path (GPU at all resolutions + CPU) failed.
    """
    if model_id not in _BIREFNET_IDS:
        raise ValueError(
            f"run_birefnet_on_pil: unknown BiRefNet model id {model_id!r}."
        )
    variant = next(v for v in BIREFNET_VARIANTS if v["id"] == model_id)
    # Use get_full_path so extra_model_paths.yaml is honoured (Easy Install
    # users often keep models in a shared external dir).
    try:
        ckpt_path = folder_paths.get_full_path("background_removal", variant["filename"])
    except Exception:
        ckpt_path = None
    if not ckpt_path or not os.path.isfile(ckpt_path):
        try:
            display_dir = folder_paths.get_folder_paths("background_removal")[0]
        except Exception:
            display_dir = "ComfyUI/models/background_removal"
        raise ValueError(
            f"Pixaroma BiRefNet: {variant['filename']} not found. "
            f"Download it from {variant['downloadUrl']} and drop the "
            f".safetensors into {display_dir}, then try again."
        )

    # Prefer the variant's explicit resolution (so birefnet-lowvram can pin
    # itself to 512 even though it shares birefnet.safetensors with Standard).
    # Fall back to filename-based detection for variants without it.
    native_size = variant.get("resolution") or _resolution_for_filename(variant["filename"])

    # GPU retry chain: native res first, then progressively smaller. Skip
    # any size that exceeds the native res (would just waste memory).
    gpu_sizes_to_try = []
    for s in (native_size, 1024, 768, 512):
        if s <= native_size and s not in gpu_sizes_to_try:
            gpu_sizes_to_try.append(s)

    # PIL -> torch (B, H, W, C) float32 in [0, 1], RGB only.
    rgb = pil_image.convert("RGB")
    arr = np.asarray(rgb, dtype=np.float32) / 255.0
    tensor = torch.from_numpy(arr).unsqueeze(0)  # (1, H, W, 3)

    mask = None
    last_gpu_err = None
    for size in gpu_sizes_to_try:
        try:
            print(f"[Pixaroma] BiRefNet: GPU attempt at {size}x{size}...")
            bg_model = _get_cached_model(ckpt_path, size, force_cpu=False)
            # torch.no_grad is REQUIRED here. When called from a workflow,
            # ComfyUI's executor wraps everything in no_grad already so it
            # works either way; when called from the server route (manual
            # Remove Background button) there's no wrapper, the mask comes
            # back with requires_grad=True, and the .numpy() conversion
            # below blows up with "Can't call numpy() on Tensor that requires
            # grad". Explicit no_grad here makes the helper caller-agnostic
            # and also saves memory by skipping the autograd graph.
            with torch.no_grad():
                mask = bg_model.encode_image(tensor)
            if size != native_size:
                print(
                    f"[Pixaroma] BiRefNet: GPU at {size}x{size} succeeded "
                    f"(downscaled from native {native_size} due to memory pressure)"
                )
            break
        except Exception as e:
            if _is_oom_error(e):
                last_gpu_err = e
                # Evict the failed entry so its VRAM can be reclaimed before
                # the next-smaller attempt loads its own model. Without this,
                # the dead 1024 model keeps holding GPU memory and the 768
                # attempt OOMs too.
                _evict_from_cache(ckpt_path, size, force_cpu=False)
                try:
                    torch.cuda.empty_cache()
                except Exception:
                    pass
                print(
                    f"[Pixaroma] BiRefNet: GPU at {size}x{size} OOM, "
                    f"retrying at smaller resolution..."
                )
                continue
            # Non-OOM error - re-raise so the user sees the real problem.
            raise

    # CPU last-resort fallback when every GPU resolution OOMed.
    if mask is None:
        print(
            f"[Pixaroma] BiRefNet: GPU OOM at every resolution. Falling back "
            f"to CPU at {native_size}x{native_size}. This will be slow "
            f"(expect 20-60 seconds for one image)..."
        )
        try:
            bg_model = _get_cached_model(ckpt_path, native_size, force_cpu=True)
            with torch.no_grad():
                mask = bg_model.encode_image(tensor)
            print("[Pixaroma] BiRefNet: CPU fallback succeeded")
        except Exception as cpu_err:
            _evict_from_cache(ckpt_path, native_size, force_cpu=True)
            raise RuntimeError(
                f"BiRefNet inference failed on GPU at every resolution "
                f"(last GPU error: {last_gpu_err}) AND on CPU ({cpu_err}). "
                f"Pick rembg U2Net or ISNet from the model dropdown - "
                f"they are smaller and work on any system."
            )

    # mask is (B, 1, H, W) on the model's device.
    if mask.ndim == 4 and mask.shape[1] == 1:
        mask = mask.squeeze(1)
    elif mask.ndim == 4 and mask.shape[-1] == 1:
        mask = mask.squeeze(-1)
    # mask is now (B, H, W) in [0, 1].
    mask_np = mask[0].clamp(0.0, 1.0).cpu().numpy()
    alpha = (mask_np * 255.0).astype(np.uint8)

    # Stitch RGBA from the original RGB and the new alpha.
    rgba = np.dstack([np.asarray(rgb, dtype=np.uint8), alpha])
    return Image.fromarray(rgba, mode="RGBA")
