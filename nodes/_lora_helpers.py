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
  - sanitize_civitai_key / mask_civitai_key / civitai_hosts / read_civitai_account /
    write_civitai_account back the optional Civitai API key. They take an explicit
    path, so they stay folder_paths-free and testable; the route decides WHERE.
"""
import hashlib
import json
import os
import re
import struct
import threading

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


def explicit_trigger_words(meta, limit=_MAX_TRIGGERS):
    """ONLY the words the LoRA's author declared as its trigger phrase
    (`modelspec.trigger_phrase` / `ss_trigger_words`), never the training tags.

    `derive_trigger_words` merges the two on purpose - both are useful to OFFER.
    They are very different things to TICK, though: the declared phrase is what
    the LoRA needs in the prompt (usually one or two words), while the tag list
    is the twenty most common labels in its training set. Auto-selecting those
    would push twenty booru tags into the user's prompt. Never raises.
    """
    if not isinstance(meta, dict):
        return []
    phrase = meta.get("modelspec.trigger_phrase") or meta.get("ss_trigger_words") or ""
    if not isinstance(phrase, str):
        return []
    out = []
    seen = set()
    for part in phrase.split(","):
        w = part.strip()
        if not w:
            continue
        key = w.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(w)
        if len(out) >= limit:
            break
    return out


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
        # The author's DECLARED phrase on its own, so the info panel can tick
        # words automatically without also ticking the twenty training tags that
        # `file_triggers` carries after it. See explicit_trigger_words.
        "explicit_triggers": explicit_trigger_words(meta),
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


_NOTICE_NAMES = 5  # a toast is small: a long stack says "and N more" instead


def _name_list(names):
    # without the extension, as the rows show it: a toast is narrow and a long
    # name broke inside ".safetensors"
    shown = ", ".join(re.sub(r"\.(safetensors|ckpt|pt|pth|bin|sft)$", "", str(n), flags=re.I)
                      for n in names[:_NOTICE_NAMES])
    more = len(names) - _NOTICE_NAMES
    return "{} and {} more".format(shown, more) if more > 0 else shown


def skip_notices(missing, failed):
    """The small messages for rows the Run went on without, as
    [{'summary', 'detail'}]: one for files that are not there, one for files that
    are there but would not load. Empty when every row applied."""
    out = []
    if missing:
        n = len(missing)
        out.append({
            "summary": "LoRA not found" if n == 1 else "{} LoRAs not found".format(n),
            "detail": "Skipped, so the Run goes on without {}: {}".format(
                "it" if n == 1 else "them", _name_list(missing)),
        })
    if failed:
        n = len(failed)
        out.append({
            "summary": "LoRA could not be loaded" if n == 1 else "{} LoRAs could not be loaded".format(n),
            "detail": "Skipped, so the Run goes on without {}: {}. The file may be damaged.".format(
                "it" if n == 1 else "them", _name_list(failed)),
        })
    return out


def missing_key(state, available):
    """Which switched-on rows have no file, as one string, for IS_CHANGED: it
    changes when a missing LoRA arrives, and only then. `available` is ComfyUI's
    own list of LoRA names, so no string from the prompt reaches the disk here."""
    have = set(available)
    return "|".join(sorted(e["name"] for e in state.get("loras", ())
                           if e.get("on") and e["name"] not in have))


def parse_state(state_str):
    """Normalize the hidden LoraLoaderState JSON into
    {'loras': [...], 'sep': str, 'cacheMode': 'last'|'all'|'none'}.

    Forgiving by design (a hand-edited API workflow must still run): bad/empty input
    -> {'loras': [], 'sep': ', ', 'cacheMode': 'last'}; nameless or non-dict entries
    are dropped; each kept entry is {name, on, sm, sc, triggers}. sc defaults to sm
    when absent (single strength drives both). cacheMode (how much LoRA data the node
    keeps in RAM between runs) clamps any unknown value to 'last' - ComfyUI parity,
    keep only the most recently used file. Never raises.
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
    cache_mode = obj.get("cacheMode")
    if cache_mode not in ("last", "all", "none"):
        cache_mode = "last"
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
    return {"loras": loras, "sep": sep, "cacheMode": cache_mode}


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


_ORIGINAL_SEG_RE = re.compile(r"/original=true(?:,[^/]*)?/")


def _is_adult_image(nsfw, level):
    """True when a Civitai gallery image is flagged adult. `nsfwLevel` is a
    bitmask (1 PG, 2 PG13, 4 R, 8 X, 16 XXX); the older `nsfw` field is a bool or
    a word. Used only to keep an explicit image from becoming a node thumbnail,
    so it errs on the side of refusing. Never raises."""
    if nsfw in (True, "X", "XXX", "Mature"):
        return True
    try:
        if level is not None and int(level) >= 4:
            return True
    except (TypeError, ValueError):
        pass
    return False


def _thumb_url(url):
    """Civitai image URLs carry a transform segment; the API hands back
    `/original=true/`, i.e. the FULL-RESOLUTION image. We paint it into a 64px
    box, so requesting the original meant pulling ~1.5 MB (measured) for a
    thumbnail that needs ~55 KB - slow enough on a modest connection that the
    panel looks broken while it loads. Swap in a width transform; 256 keeps it
    crisp on a high-DPI screen.

    The segment can carry extra comma-separated params (`/original=true,quality=90/`),
    so match the whole segment rather than the bare literal. Any other URL shape
    (already width=N, or no transform at all) is returned untouched."""
    if not isinstance(url, str):
        return url
    return _ORIGINAL_SEG_RE.sub("/width=256/", url, count=1)


def parse_civitai_modelversion(obj, allow_adult=False):
    """Pull the fields we care about from a Civitai model-version response:
    {name?, type?, base_model?, triggers?, thumbnail?}. Prefers the first
    non-explicit image as the thumbnail, falling back to the first image. Never raises.

    `allow_adult` opts into using an explicit gallery image as the thumbnail. It is
    OFF by default and only ever turned on by the user, in the LoRA Loader's own
    settings: a model whose gallery is entirely explicit otherwise gets no picture
    at all, which reads as a failed lookup rather than as a deliberate choice."""
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
        any_img = None
        for im in imgs:
            if not isinstance(im, dict) or not im.get("url"):
                continue
            nsfw = im.get("nsfw")
            level = im.get("nsfwLevel")
            if any_img is None:
                any_img = im["url"]
            if nsfw in (None, False, "None", "Soft") and level in (None, 0, 1, 2):
                out["thumbnail"] = _thumb_url(im["url"])
                break
            # Fallback candidate: the first image NOT flagged adult. The old code
            # fell back to images[0] whatever its rating, so a model whose gallery
            # is entirely explicit put an explicit thumbnail on the user's canvas.
            # Now such a model simply gets no thumbnail.
            if fallback is None and not _is_adult_image(nsfw, level):
                fallback = im["url"]
        if "thumbnail" not in out and fallback:
            out["thumbnail"] = _thumb_url(fallback)
        # Last resort, and ONLY when the user asked for it: an entirely explicit
        # gallery. Without this an adult LoRA looks up correctly and still shows an
        # empty picture box, which is indistinguishable from the lookup failing.
        if "thumbnail" not in out and allow_adult and any_img:
            out["thumbnail"] = _thumb_url(any_img)
    return out


# ── Civitai account: the optional API key + which host to ask first ──────────
#
# WHY there is a key at all: Civitai hides adult-rated models from an anonymous
# API request, and `model-versions/by-hash` answers a plain 404 for one. From the
# node that is indistinguishable from "this file is not on Civitai" - so a user
# whose LoRAs are adult-rated sees the lookup simply never work, with no clue why.
# A key from an account whose own browsing settings allow that content makes the
# same request return the record.
#
# WHERE it is kept, and why NOT in the obvious places:
#   - NOT in node.properties: that is serialised into the workflow .json, so the
#     key would travel to anyone the workflow is shared with, and into any image
#     carrying an embedded workflow.
#   - NOT in a registered ComfyUI setting: comfy.settings.json is handed to the
#     browser in full, so the key would be readable by every extension on the page
#     and would sit in a file people copy between machines.
#   - It lives in a file only the server reads, and the browser is never told the
#     key itself - only whether one is set, plus the last few characters so the
#     user can tell WHICH key it is.

_CIVITAI_HOST_PREFS = ("com", "red")


def sanitize_civitai_key(raw):
    """Clean a pasted API key, or return "" if it cannot be one.

    REJECTS rather than strips when it finds anything unexpected. The key goes
    into an HTTP request header, and a stray CR or LF there is header injection -
    so the safe answer to "this does not look like a key" is to refuse it and let
    the user see that it did not take, not to quietly repair it into something
    that gets sent. Surrounding whitespace is the one exception: a copy-paste
    almost always brings a trailing newline and that is not the user's mistake."""
    if not isinstance(raw, str):
        return ""
    k = raw.strip()
    if not k or len(k) > 200:
        return ""
    for ch in k:
        # Printable ASCII only - no control characters, no spaces, nothing exotic.
        if ord(ch) < 33 or ord(ch) > 126:
            return ""
    return k


def mask_civitai_key(key):
    """A safe-to-display hint: the last 4 characters only. Enough to tell two keys
    apart, useless to anyone reading it over a shoulder or in a screenshot."""
    if not isinstance(key, str) or not key:
        return ""
    tail = key[-4:] if len(key) > 4 else key
    return "•" * 6 + tail


def civitai_hosts(pref):
    """The API hosts to try, in order, for a host preference.

    Both hosts always appear: the preference chooses which is asked FIRST, and the
    other stays as the backup that already existed for networks blocking one of
    them by name. `red` is Civitai's unrestricted domain, so a user who has adult
    LoRAs wants it asked first; everyone else is better served by the main host."""
    if pref == "red":
        return ("civitai.red", "civitai.com")
    return ("civitai.com", "civitai.red")


def read_civitai_account(path):
    """Read the account file. Always returns the full shape, never raises: a
    missing or damaged file must leave the lookup working exactly as it does with
    no key at all, not break the node."""
    out = {"key": "", "host": "com", "adult_thumbs": False}
    try:
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
    except Exception:
        return out
    if not isinstance(obj, dict):
        return out
    out["key"] = sanitize_civitai_key(obj.get("key"))
    if obj.get("host") in _CIVITAI_HOST_PREFS:
        out["host"] = obj["host"]
    out["adult_thumbs"] = bool(obj.get("adult_thumbs"))
    return out


def write_civitai_account(path, account):
    """Write the account file. Returns True on success, never raises.

    Written 0600 where the OS honours it (a no-op on most Windows setups, but it
    costs nothing and matters on Linux/macOS, where ComfyUI's user folder is
    otherwise world-readable). Every value is re-sanitised on the way in, so a
    direct POST cannot put a newline into the file for the next read to trust."""
    data = {
        "key": sanitize_civitai_key(account.get("key")),
        "host": account.get("host") if account.get("host") in _CIVITAI_HOST_PREFS else "com",
        "adult_thumbs": bool(account.get("adult_thumbs")),
    }
    try:
        # CREATED already restricted, not created-then-repaired. `open(path,"w")`
        # makes the file 0644 under the usual umask, and the chmod that follows is
        # a separate syscall - so on a shared Linux/macOS box the key sat
        # world-readable for the window between them, in a directory os.makedirs
        # left traversable. It is a short window and only on the FIRST write (a
        # later rewrite reuses the existing mode), but the first write is the one
        # carrying the key the user just pasted.
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        # Still chmod afterwards: this is what re-tightens a file left at 0644 by
        # a build that shipped before the line above existed. os.open's mode only
        # applies when it CREATES the file.
        try:
            os.chmod(path, 0o600)
        except Exception:
            pass
        return True
    except Exception:
        return False


# ── The user's own trigger words, stored PER LORA ────────────────────────────
#
# Reported 2026-08-04: "my own trigger word is not saved into the LoRA when I
# reload the lora". It was saved, but onto the ROW in that workflow - so
# switching the row to another LoRA and back lost it, and the same LoRA in
# another node or workflow never had it. The other two sources of trigger words
# (the .safetensors' own metadata, and the cached Civitai words) DO belong to the
# file, so the third one being per-row was the odd one out and read as a bug.
#
# Stored in ONE file in ComfyUI's user dir, not as a sidecar per LoRA: nothing is
# written into the models folder, which may sit on a read-only or network drive,
# and there is no chance of colliding with a user's own <base>.json.
#
# Like the civitai account helpers, these take an EXPLICIT path so they stay
# folder_paths-free and unit-testable; the route decides where.
_MAX_CUSTOM_WORDS = 64      # per LoRA - matches normLora's cap in core.mjs
_MAX_CUSTOM_LEN = 200       # a trigger phrase, not an essay
_MAX_CUSTOM_LORAS = 5000    # whole-store sanity cap


def custom_trigger_key(name):
    """Normalize a LoRA name into a store key. Separators are folded to `/` so a
    store copied between Windows and Linux still matches. Returns "" for junk."""
    if not isinstance(name, str):
        return ""
    return name.strip().replace("\\", "/").strip("/")


def sanitize_custom_words(words):
    """A clean, de-duped, capped list of trigger words. Never raises.

    De-dupe is case-insensitive but keeps the FIRST spelling the user typed, so
    their capitalisation survives."""
    out, seen = [], set()
    if not isinstance(words, (list, tuple)):
        return out
    for w in words:
        if not isinstance(w, str):
            continue
        s = w.strip()[:_MAX_CUSTOM_LEN].strip()
        if not s:
            continue
        k = s.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(s)
        if len(out) >= _MAX_CUSTOM_WORDS:
            break
    return out


def read_custom_triggers(path):
    """The whole store as {key: [words]}. Never raises - a missing or damaged
    file must read as "no custom words", never break the panel."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
    except Exception:
        return {}
    if not isinstance(obj, dict):
        return {}
    out = {}
    for name, words in obj.items():
        key = custom_trigger_key(name)
        if not key:
            continue
        clean = sanitize_custom_words(words)
        if clean:
            out[key] = clean
        if len(out) >= _MAX_CUSTOM_LORAS:
            break
    return out


def write_custom_triggers(path, store):
    """Write the whole store. Returns True on success, never raises.

    Written to a temp file and os.replace'd: this one file holds EVERY LoRA's
    words, so a crash or a full disk part-way through a plain write would take
    all of them, not just the one being edited."""
    data = {}
    if isinstance(store, dict):
        for name, words in store.items():
            key = custom_trigger_key(name)
            if not key:
                continue
            clean = sanitize_custom_words(words)
            if clean:
                data[key] = clean
            if len(data) >= _MAX_CUSTOM_LORAS:
                break
    # pid AND thread id, for the same measured reason as write_custom_preview
    # below: the route hands this to run_in_executor, so two saves land on two
    # pool threads sharing one pid and, with a fixed name, one temp file. Here it
    # matters MORE - interleaved writes publish damaged JSON, read_custom_triggers
    # swallows that as {}, and the next save rewrites the store from the empty
    # read, taking EVERY LoRA's words with it. Fixing only the sibling would have
    # left the worse half of an identical bug in the same module.
    tmp = "%s.%d.%d.tmp" % (path, os.getpid(), threading.get_ident())
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
        return True
    except Exception:
        try:
            os.remove(tmp)
        except Exception:
            pass
        return False


def get_custom_triggers(path, name):
    """One LoRA's stored words (possibly empty). Never raises."""
    key = custom_trigger_key(name)
    if not key:
        return []
    return read_custom_triggers(path).get(key, [])


def set_custom_triggers(path, name, words):
    """Replace one LoRA's words. An EMPTY list removes its entry entirely, so the
    store does not accumulate dead keys as users clear words. Returns the list
    actually stored. Never raises."""
    key = custom_trigger_key(name)
    if not key:
        return []
    store = read_custom_triggers(path)
    clean = sanitize_custom_words(words)
    if clean:
        store[key] = clean
    else:
        store.pop(key, None)
    write_custom_triggers(path, store)
    return clean


# ── the user's own preview picture ───────────────────────────────────────────
#
# Kept in <ComfyUI user dir>/pixaroma/lora_previews/, for exactly the reasons
# custom_trigger_key's store is (see _lora_custom_file in server_routes): the
# models folder is often read-only or a network share, and writing a
# <base>.preview.png there would also overwrite whatever a Civitai helper had
# already put beside the LoRA. This one is an OVERRIDE that WINS over both the
# sidecar preview and a live Civitai thumbnail, and removing it puts the
# automatic picture back - so nothing the user already had is ever destroyed.
#
# The filename is derived from the LoRA name, so it REPEATS: replacing a preview
# writes the same path again. The browser therefore needs a cache-busting
# version, which is why custom_preview_version returns the file's mtime in ms -
# a counter would restart at 1 whenever the file had been deleted by hand and
# hand back a url the browser is still holding (the workflow-cover lesson).

# We generate this name ourselves, so anything not of this exact shape did not
# come from us. Load-bearing for SAFETY, not tidiness: delete_custom_preview
# feeds the result to os.remove, and os.path.join DISCARDS the folder when the
# second part is absolute.
_CUSTOM_PREVIEW_RE = re.compile(r"[0-9a-f]{16}\.jpg")


def custom_preview_name(name):
    """The filename we would store this LoRA's own preview under, or "" for junk.

    Hashed from the SAME normalised key the trigger store uses, so the two stay
    in step for a LoRA in a subfolder or on another OS."""
    key = custom_trigger_key(name)
    if not key:
        return ""
    return hashlib.sha1(key.encode("utf-8", "replace")).hexdigest()[:16] + ".jpg"


def is_custom_preview_name(name):
    """Is this a filename we could have written? Every os.remove goes through it."""
    return isinstance(name, str) and bool(_CUSTOM_PREVIEW_RE.fullmatch(name))


def custom_preview_path(folder, name):
    """Full path for one LoRA's own preview, or None when the name is junk or the
    joined path would land outside `folder`. Does NOT check the file exists."""
    fn = custom_preview_name(name)
    if not fn or not folder or not is_custom_preview_name(fn):
        return None
    path = os.path.join(str(folder), fn)
    # Belt: fn is 16 hex + .jpg by construction, so this cannot currently fail -
    # but the check is what makes that a guarantee rather than an assumption.
    try:
        base = os.path.abspath(str(folder))
        full = os.path.abspath(path)
    except Exception:
        return None
    if os.path.dirname(full) != base:
        return None
    return full


def find_custom_preview(folder, name):
    """The user's own preview for this LoRA, or None. Never raises."""
    path = custom_preview_path(folder, name)
    try:
        if path and os.path.isfile(path):
            return path
    except Exception:
        pass
    return None


def custom_preview_version(folder, name):
    """Milliseconds mtime of the user's own preview, or 0 when there isn't one.

    The URL for a preview never changes (the filename is derived from the LoRA
    name) and the thumb route caches for an hour, so this is what lets a picture
    replaced in one node show up in another one, or after a reload."""
    path = find_custom_preview(folder, name)
    if not path:
        return 0
    try:
        return int(os.path.getmtime(path) * 1000)
    except Exception:
        return 0


def write_custom_preview(folder, name, raw):
    """Store `raw` as this LoRA's own preview. Returns the path, or None.

    Temp file + os.replace, like every other repeating-filename write here: the
    path is the same every time for a given LoRA, so a plain write would let a
    request already in flight read a half-written jpg."""
    path = custom_preview_path(folder, name)
    if not path or not isinstance(raw, (bytes, bytearray)) or not raw:
        return None
    try:
        os.makedirs(str(folder), exist_ok=True)
    except Exception:
        return None
    # pid AND thread id. The route hands this to run_in_executor, so two requests
    # for the SAME LoRA land on two pool threads sharing one pid - measured: four
    # concurrent writers used ONE temp path. On POSIX their writes interleave and
    # os.replace publishes a corrupt jpeg; on Windows the second replace hits a
    # sharing violation and a valid save reports failure. The cover route uses
    # threading.get_ident() for exactly this reason.
    tmp = "%s.%d.%d.tmp" % (path, os.getpid(), threading.get_ident())
    try:
        with open(tmp, "wb") as f:
            f.write(bytes(raw))
        os.replace(tmp, path)
        return path
    except Exception:
        try:
            os.remove(tmp)
        except Exception:
            pass
        return None


def delete_custom_preview(folder, name):
    """Remove the user's own preview so the automatic picture comes back.
    True when a file was removed. Never raises."""
    path = find_custom_preview(folder, name)
    if not path:
        return False
    try:
        os.remove(path)
        return True
    except Exception:
        return False


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
