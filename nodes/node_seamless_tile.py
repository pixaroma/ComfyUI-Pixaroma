"""Seamless Tile Pixaroma.

Changes a model and its VAE so the picture they make has no edge: it repeats on all four sides, every time, with
the normal KSampler and the normal VAE Decode. The math is in _seamless_helpers; this file attaches it.

- Krea 2, Z-Image, FLUX.2 Klein, FLUX 3 Klein (transformers): for each model call, the position code is swapped for a "torus" one (every
  height / width frequency makes a whole number of turns per tile), so the last column is the first column's
  neighbour. Nothing is added to the weights, nothing is downloaded, the speed is the same.
- SDXL / SD 1.5 (UNets): the model's convolutions wrap around the edges during each call.
- The VAE: a light copy whose decode wraps its convolutions around the edges. If ComfyUI has to decode in tiles
  (low memory), the latent is wrapped around by a margin first and cut back after: very close, not exact.

Everything is put on a CLONE of the model and a COPY of the VAE, for the length of one call, and taken off in a
`finally`; the model and VAE other nodes use are untouched.
"""
import copy
import logging

import torch

from ._seamless_helpers import TILE_MODES, TorusEmbedND, WrapPadding, crop_decoded, mode_axes, size_hint, \
    wrap_pad_latent

WRAPPER_KEY = "pixaroma_seamless_tile"
LOG = "[Seamless Tile Pixaroma]"
VAE_FACTOR = 8   # px per latent px when the model does not say (Krea 2, Z-Image, SDXL); FLUX.2 / FLUX 3 / Qwen 2.1: 16

# The model families this node knows. Anything else gets a clear error, never a silent no-op (a silent no-op is
# exactly the "lucky seed" trap the node exists to remove).
# label / attr (the position embedder) / patch (an attribute name, or the number itself) / min_turns: a position
# frequency under that many turns per tile is dropped (see snapped_omegas). Measured per family on 26 hard prompts
# (seamless.md #17d): Z-Image needs 1.0 (else most pictures repeat 4 times inside the tile); Krea 2 keeps plain
# rounding (1.0 there put fault lines into long stripes and it has no repeat problem).
# Optional: axes = the position code must have this many axes (FLUX.1 shares FLUX.2's class with 3, untested);
# pos_scale = the attribute that scales the picture's positions (FLUX 3: 0.5 per token, so the period is too);
# image_last = snap only the picture's tokens, the LAST in the sequence, for a model that puts its text on the height
# and width axes too (no family uses it now: Qwen Image 2.1 joined with it but lost its big motifs, seamless.md #17e).
# FLUX.2 / FLUX 3 decode with the FLUX.2 VAE, whose fused fast path WrapPadding switches off (seamless.md #17e).
_ROPE_FAMILIES = {
    ("comfy.ldm.krea2.model", "SingleStreamDiT"):
        dict(label="Krea 2", attr="pe_embedder", patch="patch", min_turns=0.5),
    # NextDiT also serves Lumina 2 / NewBie (axes [32, 32, 32], theta 10000) and Ming-Image (Z-Image's position code,
    # image_model "ming_image"): untested, so only Z-Image's exact code is taken (seamless.md #20)
    ("comfy.ldm.lumina.model", "NextDiT"):
        dict(label="Z-Image", attr="rope_embedder", patch="patch_size", min_turns=1.0,
             axes_dim=[32, 48, 48], theta=256.0, skip_models=("ming_image",)),
    ("comfy.ldm.flux.model", "Flux"):
        dict(label="FLUX.2", attr="pe_embedder", patch="patch_size", min_turns=0.5, axes=4),
    ("comfy.ldm.flux3.model", "Flux3"):
        dict(label="FLUX 3", attr="pe_embedder", patch=1, min_turns=0.5, pos_scale="image_rope_scale"),
}
_UNET = ("comfy.ldm.modules.diffusionmodules.openaimodel", "UNetModel")
_KNOWN = "Krea 2, Z-Image, FLUX.2 Klein, FLUX 3 Klein, SDXL and SD 1.5"


def _image_model(model):
    """The model config's image_model name ("lumina2", "ming_image", ...), or None."""
    try:
        return model.model.model_config.unet_config.get("image_model")
    except Exception:
        return None


def _family(dm, image_model=None):
    """The _ROPE_FAMILIES entry of a diffusion model, or None."""
    entry = _ROPE_FAMILIES.get((type(dm).__module__, type(dm).__name__))
    if entry:
        emb = getattr(dm, entry["attr"], None)
        emb = getattr(emb, "orig", emb)
        axes = list(getattr(emb, "axes_dim", ()))
        if "axes" in entry and len(axes) != entry["axes"]:
            return None
        if "axes_dim" in entry and (axes != entry["axes_dim"] or getattr(emb, "theta", None) != entry["theta"]):
            return None
        if image_model in entry.get("skip_models", ()):
            return None
    return entry


def detect_family(model):
    """('rope', label, embedder attr, patch) or ('conv', label, None, multiple), or a clear ValueError."""
    dm = model.get_model_object("diffusion_model")
    entry = _family(dm, _image_model(model))
    if entry:
        label, attr = entry["label"], entry["attr"]
        emb = getattr(dm, attr, None)
        emb = getattr(emb, "orig", emb)                 # our own stand-in left by an interrupted call
        patch = entry["patch"] if isinstance(entry["patch"], int) else getattr(dm, entry["patch"], None)
        scale = getattr(dm, entry["pos_scale"], None) if "pos_scale" in entry else 1
        if emb is None or len(getattr(emb, "axes_dim", ())) < 3 or not isinstance(patch, int) or \
                not isinstance(scale, (int, float)) or scale <= 0:
            raise ValueError(f"Seamless Tile: this {label} model is not built the way it expects "
                             "(ComfyUI may have changed). Nothing was changed.")
        return "rope", label, attr, patch
    if (type(dm).__module__, type(dm).__name__) == _UNET:
        downs = max(0, len(getattr(dm, "channel_mult", (1, 2, 4))) - 1)
        return "conv", "SDXL / SD 1.5", None, 2 ** downs
    raise ValueError(f"Seamless Tile does not know this model yet ({type(dm).__name__}). It works with {_KNOWN}. "
                     "Nothing was changed.")


def px_per_latent(model):
    """Picture px per latent px, from the model's latent format (8 for most, 16 for FLUX.2 / FLUX 3 / Qwen 2.1)."""
    try:
        r = model.get_model_object("latent_format").spacial_downscale_ratio
        return r if isinstance(r, int) and r > 0 else VAE_FACTOR
    except Exception:
        return VAE_FACTOR


def _check_size(x, multiple, wrap_h, wrap_w, label, factor=VAE_FACTOR):
    if x.ndim == 5 and x.shape[2] != 1:
        raise ValueError("Seamless Tile makes still pictures only, not videos.")
    step = multiple * factor
    h, w = x.shape[-2], x.shape[-1]
    bad = []
    if wrap_h and h % multiple:
        bad.append(f"height {h * factor} (try {size_hint(h * factor, step)})")
    if wrap_w and w % multiple:
        bad.append(f"width {w * factor} (try {size_hint(w * factor, step)})")
    if bad:
        raise ValueError(f"Seamless Tile: with {label} the size must be a multiple of {step} px, so the pattern "
                         f"can join. Change the {' and '.join(bad)}.")


def make_rope_wrapper(attr, patch, wrap_h, wrap_w, label, min_turns=0.5, factor=VAE_FACTOR, pos_scale=None,
                      image_last=False):
    def seamless_rope_wrapper(executor, *args, **kwargs):
        x = args[0] if args else kwargs.get("x")
        _check_size(x, patch, wrap_h, wrap_w, label, factor)
        dm = executor.class_obj
        orig = getattr(dm, attr)
        orig = getattr(orig, "orig", orig)              # never stack our stand-in on itself
        th, tw = x.shape[-2] // patch, x.shape[-1] // patch
        scale = getattr(dm, pos_scale) if pos_scale else 1
        torus = TorusEmbedND(orig, th * scale if wrap_h else None, tw * scale if wrap_w else None, min_turns,
                             th * tw if image_last else None)
        setattr(dm, attr, torus)
        try:
            out = executor(*args, **kwargs)
        finally:
            setattr(dm, attr, orig)
        if torus.calls == 0:
            raise RuntimeError(f"Seamless Tile: the {label} model did not use its position code where expected "
                               "(ComfyUI may have changed), so the picture would not join. Please report it.")
        return out
    return seamless_rope_wrapper


def make_conv_wrapper(multiple, wrap_h, wrap_w, label):
    def seamless_conv_wrapper(executor, *args, **kwargs):
        x = args[0] if args else kwargs.get("x")
        _check_size(x, multiple, wrap_h, wrap_w, label)
        with WrapPadding(executor.class_obj, wrap_h, wrap_w) as wp:
            if wp.count == 0:
                raise RuntimeError("Seamless Tile: found no layers to wrap in this model. Please report it.")
            return executor(*args, **kwargs)
    return seamless_conv_wrapper


# ---------------------------------------------------------------- the VAE copy

_TILED_INNER = ("decode_tiled_", "decode_tiled_3d", "_decode_tiled_owned")


def seamless_vae(vae, wrap_h, wrap_w):
    """A light copy of `vae` (same weights, nothing loaded twice) whose decode joins at the edges."""
    base = getattr(vae, "_pix_seam_base", vae)
    new = copy.copy(base)
    for name in ("decode", "decode_tiled") + _TILED_INNER:   # copy.copy of a seamless copy would carry ours
        new.__dict__.pop(name, None)
    cls = type(base)
    new._pix_seam_base = base
    new._pix_seam_active = None
    base_mem = getattr(new, "memory_used_decode", None)   # core's estimate (an instance lambda); None on an empty VAE

    def memory_used_decode(shape, dtype):
        # Core sizes the FLUX.2 VAE for its fused path (x1) whenever the GPU can run it, and x4 otherwise. Our wrap
        # switches that path off (WrapPadding), so ask for the unfused amount while it is off, or a small card runs
        # out of memory and falls back to the tiled decode (very close, not exact).
        need = base_mem(shape, dtype)
        wp = new._pix_seam_active
        if wp is not None and wp._fused:
            try:
                from comfy.ldm.modules.diffusionmodules.model import fused_norm_served
                served = fused_norm_served(new.device, dtype)
            except Exception:
                served = True
            if served:
                need *= 4
        return need

    def decode(samples_in, *a, **k):
        if new.first_stage_model is None:                # a checkpoint with no VAE: core's own clear error
            return cls.decode(new, samples_in, *a, **k)
        wp = WrapPadding(new.first_stage_model, wrap_h, wrap_w).apply()
        new._pix_seam_active = wp
        try:
            out = cls.decode(new, samples_in, *a, **k)
            dec = getattr(new.first_stage_model, "decoder", None)
            if new._pix_seam_active is wp and isinstance(dec, torch.nn.Module):    # not the tiled fallback
                missed = wp.skipped(dec)
                if missed:
                    logging.warning(f"{LOG} {len(missed)} layers of this VAE decoded without the wrap (ComfyUI may "
                                    "have changed how this VAE runs): the edges may show a faint line. Please "
                                    "report it.")
            return out
        finally:
            new._pix_seam_active = None
            wp.undo()

    def inner_tiled(name):
        orig = getattr(cls, name)

        def tiled(samples, *a, **k):
            wp = new._pix_seam_active
            if wp is None:                               # not inside our decode (the public tiled decode below)
                return orig(new, samples, *a, **k)
            wp.undo()                                    # each tile would wrap onto itself: hooks off
            new._pix_seam_active = None
            logging.warning(f"{LOG} not enough memory for one decode, decoding in tiles: the edges are wrapped "
                            "around first, very close to seamless but not exact.")
            padded, mh, mw = wrap_pad_latent(samples, wrap_h, wrap_w)
            out = orig(new, padded, *a, **k)
            return crop_decoded(out, padded.shape[-2:], samples.shape[-2:], mh, mw)
        return tiled

    def decode_tiled(samples, *a, **k):
        padded, mh, mw = wrap_pad_latent(samples, wrap_h, wrap_w)
        out = cls.decode_tiled(new, padded, *a, **k)     # channels last: (..., H, W, C)
        return crop_decoded(out, padded.shape[-2:], samples.shape[-2:], mh, mw, h_dim=-3, w_dim=-2)

    new.decode = decode
    new.decode_tiled = decode_tiled
    if callable(base_mem):                # a VAE with no weights keeps core's own "VAE is invalid" path
        new.memory_used_decode = memory_used_decode
    for name in _TILED_INNER:
        if hasattr(cls, name):
            setattr(new, name, inner_tiled(name))
    return new


class SeamlessTilePixaroma:
    DESCRIPTION = (
        "Makes the picture repeat with no edge: it joins on all four sides, every time, not only on a lucky seed. "
        "Put it between the model and VAE loaders and the sampler, then use the normal KSampler and the normal VAE "
        "Decode with the model and VAE that come out of it. Works with Krea 2, Z-Image, FLUX.2 Klein, FLUX 3 Klein, "
        "SDXL and SD 1.5, text to picture. Same speed, nothing downloaded, the loaded models are not changed. The "
        "size must be a multiple of 16 px (32 px for SDXL, 64 px for SD 1.5). Licences: Krea 2 is free for "
        "companies under US$1M a year, Z-Image is Apache-2.0, the FLUX models have their own. The idea of snapping "
        "the position code follows the SpheRoPE paper (Hirschorn et al., 2026); the code is our own."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {
                    "tooltip": "The model, after any LoRA loaders. Krea 2, Z-Image, FLUX.2 Klein, FLUX 3 Klein, SDXL "
                               "or SD 1.5.",
                }),
                "vae": ("VAE", {
                    "tooltip": "The VAE that decodes the picture. Use the vae output of this node in VAE Decode, "
                               "or the picture gets a faint line at the edges.",
                }),
                "tile": (list(TILE_MODES), {
                    "default": "Both",
                    "tooltip": "Which edges join. Both = repeats in every direction (patterns, textures). Left and "
                               "right = a strip that repeats sideways. Up and down = repeats vertically. Off = the "
                               "model and VAE pass through unchanged.",
                }),
            },
        }

    RETURN_TYPES = ("MODEL", "VAE")
    RETURN_NAMES = ("model", "vae")
    OUTPUT_TOOLTIPS = (
        "The model that makes pictures with no edge. Connect it to the sampler.",
        "The VAE that decodes with no edge. Connect it to VAE Decode.",
    )
    FUNCTION = "apply"
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    def apply(self, model, vae, tile="Both"):
        import comfy.patcher_extension as pe     # at call time: a module-level import error would sink the whole pack

        wrap_h, wrap_w = mode_axes(tile)
        if not (wrap_h or wrap_w):
            return (model, vae)
        kind, label, attr, unit = detect_family(model)
        patched = model.clone()
        # A clone copies its parent's wrappers, ours included when this node is chained twice: take it off first.
        if hasattr(patched, "remove_wrappers_with_key"):
            patched.remove_wrappers_with_key(pe.WrappersMP.DIFFUSION_MODEL, WRAPPER_KEY)
        to = patched.model_options.setdefault("transformer_options", {})
        to.get("wrappers", {}).get(pe.WrappersMP.DIFFUSION_MODEL, {}).pop(WRAPPER_KEY, None)
        if kind == "rope":
            entry = _family(model.get_model_object("diffusion_model"), _image_model(model))
            wrapper = make_rope_wrapper(attr, unit, wrap_h, wrap_w, label, entry["min_turns"], px_per_latent(model),
                                        entry.get("pos_scale"), entry.get("image_last", False))
        else:
            wrapper = make_conv_wrapper(unit, wrap_h, wrap_w, label)
        patched.add_wrapper_with_key(pe.WrappersMP.DIFFUSION_MODEL, WRAPPER_KEY, wrapper)
        return (patched, seamless_vae(vae, wrap_h, wrap_w))


NODE_CLASS_MAPPINGS = {"SeamlessTilePixaroma": SeamlessTilePixaroma}
NODE_DISPLAY_NAME_MAPPINGS = {"SeamlessTilePixaroma": "Seamless Tile Pixaroma"}
