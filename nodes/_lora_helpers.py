"""Pure LoRA metadata / trigger-word logic for LoRA Loader Pixaroma.

Stdlib only - no comfy, no folder_paths, no torch. Everything here reads a file or
a dict and returns data, so it is unit-testable outside ComfyUI (see
D:/Claude Tests/_lora_loader_test.py).

The design is offline-first:
  - read_safetensors_metadata / derive_trigger_words / base_model_family / build_lora_info
    read ONLY the file's small JSON header (never the tensors) - instant, no network.
  - read_sidecar_info / find_preview_path read files a Civitai helper may have left
    next to the LoRA - still no network.
  - file_sha256 / parse_civitai_modelversion / save_sidecar_cache support the OPTIONAL
    online Civitai lookup, which the server route performs (this module never opens a
    socket).
"""
import hashlib
import json
import os
import struct

# Real LoRA headers are tens of KB; cap far above that so a corrupt length field can
# never make us allocate gigabytes.
_MAX_HEADER_BYTES = 200 * 1024 * 1024
# How many frequency-derived tags we surface as candidate trigger words.
_MAX_TRIGGERS = 20

_PREVIEW_EXTS = (
    ".preview.png", ".preview.jpeg", ".preview.jpg", ".preview.webp",
    ".png", ".jpg", ".jpeg", ".webp",
)


def read_safetensors_metadata(path):
    """Return the file's __metadata__ dict (str->str), or {} on any problem.

    Reads ONLY the header (8-byte little-endian length + that many JSON bytes),
    never the tensor block. Never raises: a bad, missing, or oversized file -> {}.
    """
    try:
        with open(path, "rb") as f:
            raw = f.read(8)
            if len(raw) != 8:
                return {}
            n = struct.unpack("<Q", raw)[0]
            if n <= 0 or n > _MAX_HEADER_BYTES:
                return {}
            head = f.read(n)
            if len(head) != n:
                return {}
        obj = json.loads(head)
    except Exception:
        return {}
    if not isinstance(obj, dict):
        return {}
    meta = obj.get("__metadata__")
    return meta if isinstance(meta, dict) else {}


def _clean_id(v):
    """A Civitai model/version id -> a clean int, or None. Rejects dicts/lists/garbage
    from a hand-edited sidecar so the frontend never builds a junk civitai.com URL."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, str) and v.isdigit():
        return int(v)
    return None


def _as_json(val):
    """A safetensors metadata value is always a string; structured ones are JSON
    strings that need a second parse. Return the parsed object, or None."""
    if isinstance(val, (dict, list)):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return None
    return None


def derive_trigger_words(meta, limit=_MAX_TRIGGERS):
    """Best-effort trigger words from training metadata.

    Order: an explicit trigger phrase first (modelspec.trigger_phrase /
    ss_trigger_words), then the most frequent training tags from ss_tag_frequency
    (counts summed across every dataset dir), de-duped case-insensitively, capped
    at `limit`. Returns [] when nothing usable is present. Never raises.
    """
    if not isinstance(meta, dict):
        return []
    out = []
    seen = set()

    def add(word):
        w = (word or "").strip()
        if not w:
            return
        key = w.lower()
        if key in seen:
            return
        seen.add(key)
        out.append(w)

    phrase = meta.get("modelspec.trigger_phrase") or meta.get("ss_trigger_words") or ""
    if isinstance(phrase, str):
        for part in phrase.split(","):
            add(part)

    freq = _as_json(meta.get("ss_tag_frequency"))
    counts = {}
    if isinstance(freq, dict):
        for dataset in freq.values():
            if not isinstance(dataset, dict):
                continue
            for tag, c in dataset.items():
                try:
                    counts[tag] = counts.get(tag, 0) + int(c)
                except (TypeError, ValueError):
                    continue
    # sorted() is stable, so equal counts keep first-seen (insertion) order.
    for tag, _c in sorted(counts.items(), key=lambda kv: -kv[1]):
        add(tag)
        if len(out) >= limit:
            break
    return out[:limit]


def base_model_family(meta):
    """Coarse base-model family for the mismatch warning: 'SDXL', 'SD1.5', 'SD2',
    'SD3', 'Flux', or '' when unknown. Never raises."""
    if not isinstance(meta, dict):
        return ""
    hay = " ".join(
        str(meta.get(k, "")) for k in (
            "ss_base_model_version", "ss_sd_model_name", "modelspec.architecture",
            "modelspec.implementation", "ss_network_module",
        )
    ).lower()
    if not hay.strip():
        return ""
    if "flux" in hay:
        return "Flux"
    if "sd3" in hay or "sd_3" in hay or "stable-diffusion-3" in hay:
        return "SD3"
    if "sdxl" in hay or "xl_base" in hay or "xl-base" in hay or "illustrious" in hay or "pony" in hay:
        return "SDXL"
    if "sd_v2" in hay or "sd2" in hay or "v2-1" in hay or "768-v" in hay:
        return "SD2"
    if ("sd_v1" in hay or "sd1" in hay or "v1-5" in hay or "v1.5" in hay
            or "sd-v1" in hay or "1-5-pruned" in hay):
        return "SD1.5"
    return ""


def read_sidecar_info(lora_path):
    """Read a Civitai-helper sidecar (<base>.civitai.info, then <base>.json) next to
    the LoRA. Returns {name?, base_model?, triggers?} or {}. No network. Never raises."""
    base = os.path.splitext(lora_path)[0]
    for ext in (".civitai.info", ".json"):
        sp = base + ext
        if not os.path.isfile(sp):
            continue
        try:
            with open(sp, "r", encoding="utf-8") as f:
                obj = json.load(f)
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue
        info = {}
        tw = obj.get("trainedWords")
        if isinstance(tw, list):
            info["triggers"] = [str(w).strip() for w in tw if str(w).strip()]
        elif isinstance(obj.get("activation text"), str):
            info["triggers"] = [w.strip() for w in obj["activation text"].split(",") if w.strip()]
        model = obj.get("model")
        if isinstance(model, dict) and model.get("name"):
            info["name"] = str(model["name"])
        if obj.get("baseModel"):
            info["base_model"] = str(obj["baseModel"])
        # modelId / version id let the frontend link to the Civitai model page.
        mid = _clean_id(obj.get("modelId"))
        if mid is not None:
            info["model_id"] = mid
        vid = _clean_id(obj.get("id"))
        if vid is not None:
            info["version_id"] = vid
        if info:
            return info
    return {}


def find_preview_path(lora_path):
    """Return the path of a preview image next to the LoRA (.preview.png etc.), or None."""
    base = os.path.splitext(lora_path)[0]
    for ext in _PREVIEW_EXTS:
        p = base + ext
        if os.path.isfile(p):
            return p
    return None


def _title_from_meta(meta, lora_path):
    for k in ("modelspec.title", "ss_output_name"):
        v = meta.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return os.path.splitext(os.path.basename(lora_path))[0]


def build_lora_info(lora_path):
    """Unified, offline info for a LoRA: title, base_model, rank, alpha, num_images,
    date, triggers, source ('file' | 'sidecar'), has_preview. Sidecar data (from a
    prior Civitai fetch) wins over file-derived data when present. Never raises."""
    meta = read_safetensors_metadata(lora_path)
    file_triggers = derive_trigger_words(meta)
    info = {
        "title": _title_from_meta(meta, lora_path),
        "base_model": base_model_family(meta),
        "rank": meta.get("ss_network_dim", "") or "",
        "alpha": meta.get("ss_network_alpha", "") or "",
        "num_images": meta.get("ss_num_train_images", "") or "",
        "date": meta.get("modelspec.date", "") or "",
        "triggers": file_triggers,
        # Both sets are returned SEPARATELY so the info panel can offer a File /
        # Civitai toggle. `triggers` stays the merged default (sidecar wins) for
        # back-compat; `file_triggers` is always the file's own words; and
        # `sidecar_triggers` holds the saved Civitai words when a sidecar exists.
        "file_triggers": file_triggers,
        "sidecar_triggers": [],
        "source": "file",
        "has_preview": find_preview_path(lora_path) is not None,
    }
    side = read_sidecar_info(lora_path)
    if side.get("triggers"):
        info["sidecar_triggers"] = side["triggers"]
        info["triggers"] = side["triggers"]
        info["source"] = "sidecar"
    if side.get("name"):
        info["title"] = side["name"]
    if side.get("base_model") and not info["base_model"]:
        info["base_model"] = side["base_model"]
    if side.get("model_id") is not None:
        info["model_id"] = side["model_id"]
    if side.get("version_id") is not None:
        info["version_id"] = side["version_id"]
    return info


_STATE_MAX_STRENGTH = 100.0


def _clamp_strength(v):
    """A strength value from the (possibly hand-edited) state JSON -> a finite float
    in [-100, 100]. Garbage / nan / inf -> 0.0."""
    try:
        f = float(v)
    except (TypeError, ValueError, OverflowError):
        return 0.0
    if f != f or f in (float("inf"), float("-inf")):
        return 0.0
    return max(-_STATE_MAX_STRENGTH, min(_STATE_MAX_STRENGTH, f))


def parse_state(state_str):
    """Normalize the hidden LoraLoaderState JSON into {'loras': [...], 'sep': str}.

    Forgiving by design (a hand-edited API workflow must still run): bad/empty input
    -> {'loras': [], 'sep': ', '}; nameless or non-dict entries are dropped; each
    kept entry is {name, on, sm, sc, triggers}. sc defaults to sm when absent (single
    strength drives both). Never raises.
    """
    try:
        obj = json.loads(state_str) if isinstance(state_str, str) else (state_str or {})
    except Exception:
        obj = {}
    if not isinstance(obj, dict):
        obj = {}
    sep = obj.get("sep")
    if not isinstance(sep, str):
        sep = ", "
    loras = []
    raw = obj.get("loras")
    if isinstance(raw, list):
        for e in raw:
            if not isinstance(e, dict):
                continue
            name = e.get("name")
            if not isinstance(name, str) or not name.strip():
                continue
            base_str = e.get("sm", e.get("strength", 1.0))
            trg = e.get("triggers")
            loras.append({
                "name": name,
                "on": bool(e.get("on", True)),
                "sm": _clamp_strength(base_str),
                "sc": _clamp_strength(e.get("sc", base_str)),
                "triggers": [str(w).strip() for w in trg if str(w).strip()]
                            if isinstance(trg, list) else [],
            })
    return {"loras": loras, "sep": sep}


def collect_triggers(state):
    """Joined, de-duped (case-insensitive) trigger words from ENABLED loras only,
    using state['sep'] as the separator. Order follows first appearance."""
    out, seen = [], set()
    for e in state.get("loras", []):
        if not e.get("on"):
            continue
        for w in e.get("triggers", []):
            k = w.lower()
            if w and k not in seen:
                seen.add(k)
                out.append(w)
    sep = state.get("sep")
    if not isinstance(sep, str):
        sep = ", "
    return sep.join(out)


def file_sha256(path):
    """Full SHA256 hex digest of a file (streamed). Used to look the LoRA up on
    Civitai by exact-file match. The server route calls this; this module never
    opens a network socket."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_civitai_modelversion(obj):
    """Pull the fields we care about from a Civitai model-version response:
    {name?, type?, base_model?, triggers?, thumbnail?}. Prefers the first
    non-explicit image as the thumbnail, falling back to the first image. Never raises."""
    if not isinstance(obj, dict):
        return {}
    out = {}
    tw = obj.get("trainedWords")
    if isinstance(tw, list):
        out["triggers"] = [str(w).strip() for w in tw if str(w).strip()]
    if obj.get("baseModel"):
        out["base_model"] = str(obj["baseModel"])
    model = obj.get("model")
    if isinstance(model, dict):
        if model.get("name"):
            out["name"] = str(model["name"])
        if model.get("type"):
            out["type"] = str(model["type"])
    mid = _clean_id(obj.get("modelId"))
    if mid is not None:
        out["model_id"] = mid
    vid = _clean_id(obj.get("id"))
    if vid is not None:
        out["version_id"] = vid
    imgs = obj.get("images")
    if isinstance(imgs, list):
        fallback = None
        for im in imgs:
            if not isinstance(im, dict) or not im.get("url"):
                continue
            if fallback is None:
                fallback = im["url"]
            nsfw = im.get("nsfw")
            level = im.get("nsfwLevel")
            if nsfw in (None, False, "None", "Soft") and level in (None, 0, 1, 2):
                out["thumbnail"] = im["url"]
                break
        if "thumbnail" not in out and fallback:
            out["thumbnail"] = fallback
    return out


def save_sidecar_cache(lora_path, civitai_obj):
    """Cache a raw Civitai response next to the LoRA as <base>.civitai.info so future
    reads are instant and offline. Returns True on success. Never raises."""
    try:
        base = os.path.splitext(lora_path)[0]
        with open(base + ".civitai.info", "w", encoding="utf-8") as f:
            json.dump(civitai_obj, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False


def delete_sidecar_cache(lora_path):
    """Delete the cached Civitai sidecar (<base>.civitai.info) next to the LoRA, so its
    info reverts to the file's own words (or a fresh lookup). Returns True if it's gone
    (deleted or already absent). Never raises. Leaves a user's own <base>.json alone."""
    try:
        p = os.path.splitext(lora_path)[0] + ".civitai.info"
        if os.path.isfile(p):
            os.remove(p)
        return True
    except Exception:
        return False
