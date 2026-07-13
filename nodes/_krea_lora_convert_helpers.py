"""Convert a fal.ai Krea 2 LoRA into ComfyUI-compatible key naming.

This is a LOSSLESS header rewrite. A .safetensors file is a small JSON header
(tensor name -> dtype / shape / byte offsets) followed by the raw weight block.
We only rename the keys in the header and copy the weight block through
byte-for-byte, so the converted LoRA is numerically identical to the original,
just loadable by ComfyUI. No torch, no safetensors library, stdlib only.

Why it is needed: fal.ai's Krea 2 trainer names layers the PEFT / diffusers way
(base_model.model.blocks.0.attn.wq.lora_A.weight), while ComfyUI's Krea 2 LoRA
loader expects the diffusers names produced by comfy/utils.py::krea2_to_diffusers
(transformer_blocks.0.attn.to_q.lora_down.weight, plain namespace). The maps
below are the exact inverse of that ComfyUI table, verified layer for layer, so
our output is guaranteed to match what ComfyUI accepts.

Independent tool: not affiliated with or endorsed by Krea or fal.ai. It converts
a LoRA file you already have on disk and never downloads or redistributes weights.
"""
import json
import os
import re
import shutil
import struct
import uuid
from collections import OrderedDict

FAL_PREFIX = "base_model.model."
LORA_A_SUFFIX = ".lora_A.weight"
LORA_B_SUFFIX = ".lora_B.weight"

# Per-block module names: native (fal) -> diffusers (ComfyUI).
# Inverse of comfy/utils.py::krea2_to_diffusers `block_map`.
BLOCK_MAP = {
    "attn.wq": "attn.to_q",
    "attn.wk": "attn.to_k",
    "attn.wv": "attn.to_v",
    "attn.gate": "attn.to_gate",
    "attn.wo": "attn.to_out.0",
    "mlp.gate": "ff.gate",
    "mlp.up": "ff.up",
    "mlp.down": "ff.down",
}

# Standalone (non-block) layers: native (fal) -> diffusers (ComfyUI).
# Inverse of comfy/utils.py::krea2_to_diffusers `MAP_BASIC`.
BASIC_MAP = {
    "first": "img_in",
    "tmlp.0": "time_embed.linear_1",
    "tmlp.2": "time_embed.linear_2",
    "tproj.1": "time_mod_proj",
    "txtmlp.1": "txt_in.linear_1",
    "txtmlp.3": "txt_in.linear_2",
    "txtfusion.projector": "text_fusion.projector",
    "last.linear": "final_layer.linear",
}

_BLOCK_RE = re.compile(r"^blocks\.(\d+)\.(.+)$")
_TXTFUSION_RE = re.compile(r"^txtfusion\.(layerwise_blocks|refiner_blocks)\.(\d+)\.(.+)$")

# Real Krea 2 LoRA headers are ~64 KB; cap well above that so a corrupt/huge
# header can never make us allocate gigabytes.
_MAX_HEADER_BYTES = 200 * 1024 * 1024

# Output-filename hardening: Windows-illegal characters + control chars, and
# reserved device names that would error at create time.
_ILLEGAL_RE = re.compile(r'[<>:"|?*\x00-\x1f]')
_RESERVED_NAMES = (
    {"CON", "PRN", "AUX", "NUL"}
    | {"COM{}".format(i) for i in range(1, 10)}
    | {"LPT{}".format(i) for i in range(1, 10)}
)


class KreaConvertError(Exception):
    """User-facing conversion problem (bad file, nothing to convert, ...)."""


def read_safetensors_header(path):
    """Return (header_len, header_dict). Raises KreaConvertError on a bad file."""
    with open(path, "rb") as handle:
        raw_len = handle.read(8)
        if len(raw_len) != 8:
            raise KreaConvertError("File is too small to be a safetensors file.")
        header_len = struct.unpack("<Q", raw_len)[0]
        if header_len <= 0 or header_len > _MAX_HEADER_BYTES:
            raise KreaConvertError("Safetensors header size looks invalid.")
        header_bytes = handle.read(header_len)
        if len(header_bytes) != header_len:
            raise KreaConvertError("Safetensors header is truncated.")
    try:
        header = json.loads(header_bytes)
    except json.JSONDecodeError as exc:
        raise KreaConvertError("Could not parse the safetensors header.") from exc
    if not isinstance(header, dict):
        raise KreaConvertError("Safetensors header is not a JSON object.")
    return header_len, header


def _convert_base(base_name):
    """Native (fal) layer base name -> diffusers (ComfyUI) base name, or None."""
    m = _BLOCK_RE.match(base_name)
    if m:
        idx, tail = m.groups()
        mapped = BLOCK_MAP.get(tail)
        return "transformer_blocks.{}.{}".format(idx, mapped) if mapped else None

    m = _TXTFUSION_RE.match(base_name)
    if m:
        group, idx, tail = m.groups()
        mapped = BLOCK_MAP.get(tail)
        return "text_fusion.{}.{}.{}".format(group, idx, mapped) if mapped else None

    return BASIC_MAP.get(base_name)


def convert_key(key):
    """fal LoRA key -> ComfyUI (plain diffusers) LoRA key, or None if not convertible."""
    if not key.startswith(FAL_PREFIX):
        return None
    subkey = key[len(FAL_PREFIX):]
    if subkey.endswith(LORA_A_SUFFIX):
        base = subkey[:-len(LORA_A_SUFFIX)]
        suffix = ".lora_down.weight"
    elif subkey.endswith(LORA_B_SUFFIX):
        base = subkey[:-len(LORA_B_SUFFIX)]
        suffix = ".lora_up.weight"
    else:
        return None
    converted = _convert_base(base)
    if converted is None:
        return None
    return converted + suffix


_LORA_SUFFIXES = (LORA_A_SUFFIX, LORA_B_SUFFIX, ".lora_down.weight", ".lora_up.weight")


def _meta_dict(header):
    """Return header['__metadata__'] if it is a dict, else {} (tolerate malformed files)."""
    m = header.get("__metadata__", {})
    return m if isinstance(m, dict) else {}


def analyze(header):
    """Inspect a safetensors header and describe what it is (for the node readout).

    verdict:
      "convert"          -> a fal Krea 2 LoRA (base_model.model. names) we can convert.
      "already_loadable" -> a LoRA already using ComfyUI-style names (transformer. /
                            diffusion_model. / plain diffusers), so no conversion needed.
      "unknown"          -> no LoRA tensors we recognize.
    """
    meta = _meta_dict(header)
    tensor_keys = [k for k in header if k != "__metadata__"]

    fal_keys = [
        k for k in tensor_keys
        if k.startswith(FAL_PREFIX) and (k.endswith(LORA_A_SUFFIX) or k.endswith(LORA_B_SUFFIX))
    ]
    lora_keys = [k for k in tensor_keys if any(k.endswith(s) for s in _LORA_SUFFIXES)]

    unmappable = [k for k in fal_keys if convert_key(k) is None]
    mappable_count = len(fal_keys) - len(unmappable)

    if mappable_count > 0:
        verdict = "convert"
    elif lora_keys:
        verdict = "already_loadable"
    else:
        verdict = "unknown"

    return {
        "total_tensors": len(tensor_keys),
        "fal_key_count": len(fal_keys),
        "lora_key_count": len(lora_keys),
        "mappable_count": mappable_count,
        "unmappable_count": len(unmappable),
        "unmappable_sample": unmappable[:12],
        "verdict": verdict,
        # Kept so convert_file's guard reads naturally: an already-loadable LoRA
        # is "already ComfyUI format" as far as this converter is concerned.
        "is_already_comfy": verdict == "already_loadable",
        "base_model": str(meta.get("base_model", "") or ""),
        "rank": str(meta.get("lora_rank", "") or ""),
        "alpha": str(meta.get("lora_alpha", "") or ""),
    }


def build_converted_header(header):
    """Return (new_header_OrderedDict, stats). stats = {total, converted, skipped}."""
    converted = OrderedDict()
    meta = dict(_meta_dict(header))
    meta.setdefault("pixaroma_converted_from", str(meta.get("base_model", "fal/krea-2")))
    meta["pixaroma_converter"] = "ComfyUI-Pixaroma Krea LoRA Converter"
    converted["__metadata__"] = meta

    total = 0
    skipped = []
    seen = set()
    for key, value in header.items():
        if key == "__metadata__":
            continue
        total += 1
        new_key = convert_key(key)
        if new_key is None:
            skipped.append(key)
            continue
        if new_key in seen:
            raise KreaConvertError("Duplicate converted key: {}".format(new_key))
        seen.add(new_key)
        # Reuse the SAME value dict (unchanged data_offsets) so the copied weight
        # block stays valid - we only renamed the key. Iteration order is
        # preserved, so offsets stay ascending and contiguous.
        converted[new_key] = value

    return converted, {"total": total, "converted": len(seen), "skipped": skipped}


def default_output_name(input_path, suffix="_comfyui"):
    stem = os.path.splitext(os.path.basename(input_path))[0]
    return "{}{}.safetensors".format(stem, suffix)


def sanitize_output_name(name):
    """Return a safe bare filename ending in .safetensors, or raise. No directories."""
    name = (name or "").strip()
    # Output always lands next to the input; strip any path the user typed.
    name = name.replace("\\", "/").split("/")[-1]
    # Neutralize Windows-illegal / control chars and trailing dots or spaces.
    name = _ILLEGAL_RE.sub("_", name).strip().rstrip(". ")
    if not name or name in (".", ".."):
        raise KreaConvertError("Invalid output filename.")
    stem = name[:-len(".safetensors")] if name.lower().endswith(".safetensors") else name
    stem = stem.rstrip(". ")
    if not stem:
        raise KreaConvertError("Invalid output filename.")
    if stem.upper() in _RESERVED_NAMES:
        stem = stem + "_"
    return stem + ".safetensors"


def _write_converted(input_path, output_path, old_header_len, new_header):
    raw = json.dumps(new_header, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    # safetensors allows trailing header padding; keep the data block 8-aligned.
    pad = (8 - (len(raw) % 8)) % 8
    raw += b" " * pad
    data_start = 8 + old_header_len
    tmp = "{}.{}.pixtmp".format(output_path, uuid.uuid4().hex)
    try:
        with open(input_path, "rb") as src, open(tmp, "wb") as dst:
            src.seek(data_start)
            dst.write(struct.pack("<Q", len(raw)))
            dst.write(raw)
            shutil.copyfileobj(src, dst, length=1024 * 1024)
        os.replace(tmp, output_path)  # atomic: a crash can't leave a half file
    except Exception:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass
        raise


def convert_file(input_path, output_path, overwrite=False):
    """Convert input_path -> output_path. Returns stats dict. Raises KreaConvertError."""
    input_path = os.path.abspath(input_path)
    output_path = os.path.abspath(output_path)
    if not os.path.isfile(input_path):
        raise KreaConvertError("Input file not found.")
    if os.path.splitext(input_path)[1].lower() != ".safetensors":
        raise KreaConvertError("Input must be a .safetensors file.")
    if os.path.normcase(output_path) == os.path.normcase(input_path):
        raise KreaConvertError("Output must be a different file from the input.")
    if os.path.exists(output_path) and not overwrite:
        raise KreaConvertError("A file with that name already exists (turn on Overwrite to replace it).")

    old_len, header = read_safetensors_header(input_path)
    info = analyze(header)
    if info["is_already_comfy"]:
        raise KreaConvertError("This LoRA is already in ComfyUI format - nothing to convert.")
    if info["mappable_count"] == 0:
        raise KreaConvertError("No fal Krea 2 LoRA layers found - is this a fal Krea 2 LoRA?")

    new_header, stats = build_converted_header(header)
    _write_converted(input_path, output_path, old_len, new_header)
    stats["output_path"] = output_path
    stats["output_name"] = os.path.basename(output_path)
    return stats
