"""H3 Latent Upscale Pixaroma.

Makes a MiniMax H3 video latent bigger with a trained latent upscaler, the first half of a "regenerate in 2K"
pass: the enlarged latent is then re-drawn by H3 in a few steps, which adds the real detail. The network is in
_h3_latent_upscale_helpers (a port of the 3D H3 latent upscaler by LBH-123-AI, MIT); this file finds the model
file, moves the model on and off the graphics card and hands the latent through.

It never downloads anything: the model file goes in models/latent_upscale_models.
"""
import folder_paths

from ._h3_latent_upscale_helpers import activation_bytes, check_size, empty_sound_for, h3_parts, \
    load_model_file, needs_upscale, upscale_tensor

FOLDER = "latent_upscale_models"
DOWNLOAD_HINT = ("Download minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors (or the fp16 one) from "
                 "https://huggingface.co/LBH-123-AI/Minimax_h3_latent_Upscaler into "
                 "ComfyUI/models/latent_upscale_models, then press R in ComfyUI to refresh the list.")
NO_MODEL = "(no .safetensors upscaler in models/latent_upscale_models)"

_MODEL_CACHE = {}   # path -> (mtime, dtype, model on the CPU)


def _ensure_folder():
    # Core registers this folder since late 2025; an older ComfyUI may not have it yet.
    try:
        if FOLDER not in folder_paths.folder_names_and_paths:
            import os
            folder_paths.add_model_folder_path(FOLDER, os.path.join(folder_paths.models_dir, FOLDER))
    except Exception:
        pass


def _available():
    """The folder's safetensors files, H3 ones first: the folder is shared with other models' upscalers (LTX),
    and the first entry is what a freshly added node picks."""
    _ensure_folder()
    try:
        names = [n for n in folder_paths.get_filename_list(FOLDER) if n.lower().endswith(".safetensors")]
    except Exception:
        return []
    return sorted(names, key=lambda n: (0 if ("h3" in n.lower() or "minimax" in n.lower()) else 1, n.lower()))


def _get_model(name, dtype):
    import os
    if name not in _available():
        raise RuntimeError("[Pixaroma] H3 Latent Upscale: the upscaler \"%s\" is not in your %s folder. %s"
                           % (name, FOLDER, DOWNLOAD_HINT))
    try:
        path = folder_paths.get_full_path_or_raise(FOLDER, name)
    except Exception:
        raise RuntimeError("[Pixaroma] H3 Latent Upscale: the upscaler \"%s\" could not be found on disk. %s"
                           % (name, DOWNLOAD_HINT))
    mtime = os.path.getmtime(path)
    hit = _MODEL_CACHE.get(path)
    if hit is not None and hit[0] == mtime and hit[1] == dtype:
        return hit[2]
    try:
        model = load_model_file(path, dtype)
    except ValueError as e:
        raise RuntimeError("[Pixaroma] H3 Latent Upscale: \"%s\": %s. Pick a MiniMax H3 3D latent upscaler. %s"
                           % (name, e, DOWNLOAD_HINT))
    _MODEL_CACHE.clear()          # one upscaler kept in memory at a time
    _MODEL_CACHE[path] = (mtime, dtype, model)
    return model


class PixaromaH3LatentUpscale:
    DESCRIPTION = (
        "Makes a MiniMax H3 video latent bigger with a trained latent upscaler, before H3 re-draws it at the new "
        "size in a few steps (a 2K regenerate pass). Wire the latent of your clip in (VAE Encode with the H3 video "
        "VAE, or an H3 sampler's output), set the new width and height, and send the result on to H3 Audio Sync "
        "or the sampler. Picture and sound stay together; a latent with no sound part gets a silent one. Needs an "
        "H3 latent upscaler file in models/latent_upscale_models. Based on the MiniMax H3 latent upscaler by "
        "LBH-123-AI (MIT); the math is unchanged, so the result matches the original node."
    )

    @classmethod
    def INPUT_TYPES(cls):
        models = _available() or [NO_MODEL]
        return {
            "required": {
                "latent": ("LATENT", {
                    "tooltip": "The MiniMax H3 latent to make bigger: VAE Encode with the H3 video VAE, or the "
                               "latent out of an H3 sampler. Picture and sound both work.",
                }),
                "upscale_model": (models, {
                    "tooltip": "The H3 latent upscaler file, from models/latent_upscale_models. "
                               "minimax_h3_latent_upscaler_3d_conv_v1 is the one NVIDIA's 2K regenerate uses.",
                }),
                "width": ("INT", {
                    "default": 1440, "min": 64, "max": 8192, "step": 32,
                    "tooltip": "The new width in picture pixels. Rounded to a multiple of 32, which H3 needs. "
                               "Keep the shape of your video: 1440 x 2560 is 2K portrait, 2560 x 1440 2K landscape.",
                }),
                "height": ("INT", {
                    "default": 2560, "min": 64, "max": 8192, "step": 32,
                    "tooltip": "The new height in picture pixels. Rounded to a multiple of 32, which H3 needs.",
                }),
            },
        }

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("latent",)
    OUTPUT_TOOLTIPS = ("The bigger H3 latent, picture and sound together. Send it to H3 Audio Sync (to keep your "
                       "own sound) or to the sampler that re-draws it.",)
    FUNCTION = "upscale"
    CATEGORY = "👑 Pixaroma/✂️ Resize & Crop"

    def upscale(self, latent, upscale_model, width, height):
        import torch
        import comfy.model_management as mm

        try:
            video, rest, kind = h3_parts(latent)
            check_size(video, width, height)
        except ValueError as e:
            raise RuntimeError("[Pixaroma] H3 Latent Upscale: %s" % e)

        if not needs_upscale(video, width, height) and kind != "video":
            # The original hands the latent back untouched at the same size: keep H3 Audio Sync's sound lock
            # (its noise_mask) too. A picture-only video latent still gets its silent sound part below.
            return (latent,)

        if needs_upscale(video, width, height):
            if upscale_model == NO_MODEL or not upscale_model:
                raise RuntimeError("[Pixaroma] H3 Latent Upscale: no upscaler file found (.safetensors only, a .pth "
                                   "file is not used). " + DOWNLOAD_HINT)
            device = mm.get_torch_device()
            dtype = torch.float16 if device.type in ("cuda", "mps", "xpu") else torch.float32
            model = _get_model(upscale_model, dtype)
            model_bytes = sum(p.numel() * p.element_size() for p in model.parameters())
            mm.free_memory(model_bytes + activation_bytes(video, width, height, dtype), device)
            try:
                model.to(device)
                up = upscale_tensor(model, video, width, height, device, dtype,
                                    check_interrupt=mm.throw_exception_if_processing_interrupted)
            finally:
                model.to("cpu")
                mm.soft_empty_cache()
        else:
            up = video

        if kind == "image":
            return ({"samples": up},)
        import comfy.nested_tensor
        sound = rest if kind == "av" else (empty_sound_for(up),)
        return ({"samples": comfy.nested_tensor.NestedTensor((up,) + tuple(sound))},)


NODE_CLASS_MAPPINGS = {"PixaromaH3LatentUpscale": PixaromaH3LatentUpscale}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaH3LatentUpscale": "H3 Latent Upscale Pixaroma"}
