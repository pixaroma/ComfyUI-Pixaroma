"""Pure helpers for writing Civitai-readable (A1111 "parameters") image metadata.

NOTHING here imports ComfyUI, torch or PIL, so it unit-tests standalone.
Harness: D:\\Claude Tests\\_civitai_meta_test.py

The whole contract below was verified against Civitai's OWN open-source parser,
not community write-ups. Since 2026-08-31 that parser is the npm package
@civitai/generation-metadata (automatic1111Parser, hashesDetailExtractor,
defaultParsers = A1111 first); civitai/src/utils/metadata/index.ts only wraps
it. Harness that RUNS it on our output: D:\\Claude Tests\\_civitai_real_parser_test.py
(run that before changing any rule). Historical sources the rules were first read from:
  civitai/src/utils/metadata/automatic.metadata.ts        the A1111 parser (removed)
  civitai/src/utils/metadata/index.ts                     parser precedence
  civitai/packages/civitai-db-schema/prisma/programmability/get_image_resources.sql
                                                          how a hash becomes a resource
  civitai/src/components/Image/DetailV2/ImageMeta.tsx     which keys show as badges
  AUTOMATIC1111/stable-diffusion-webui modules/processing.py + infotext_utils.py
                                                          the string assembly + quoting

THE RULES THAT COST THE MOST TO ESTABLISH (do not regress):

1. The container is a PNG tEXt chunk named exactly `parameters` (case
   sensitive), or EXIF UserComment for JPG/WebP. The ONLY thing that makes
   Civitai try the A1111 parser is the string containing the substring
   "Steps: ". `Version:` is NOT required.

2. Civitai tries its `automatic` parser BEFORE its ComfyUI parser and the first
   match wins. So once a `parameters` chunk exists, our `prompt`/`workflow`
   chunks are ignored for resource purposes. Keep writing them anyway - they are
   what makes the PNG reloadable in ComfyUI.

3. Resource matching is EXACT case-insensitive equality against Civitai's hash
   table, which holds AutoV2 (first 10 hex chars of the file's full SHA256) and
   full SHA256 rows. So a 10-char or a 64-char value matches and NOTHING else
   does. A wrong hash resolves to nothing, silently, with no error anywhere.

4. Use `Hashes: {...}`, NOT A1111's `Lora hashes`. A1111's LoRA hash is the
   12-char kohya "addnet" hash, which skips the safetensors header, so it can
   never match on Civitai.

5. LoRA STRENGTH does not travel in `Hashes` (those entries get a NULL
   strength). It only arrives via `<lora:name:weight>` tags in the prompt text,
   so the tags must be appended to the recorded positive prompt. The tag regex
   Civitai uses is `<(lora|hypernet):([a-zA-Z0-9_\\.\\-]+):([0-9.]+)>` - no
   spaces, slashes or parentheses in the name, and NO leading minus on the
   weight, so a negative weight cannot be expressed.

6. Sampler names must be mapped by us. Civitai only applies its own mapping on
   the comfy path, never on the automatic path.

7. `CFG scale` has a LOWERCASE s. Getting that wrong is a real, shipped bug in
   another pack (giriss/comfy-image-saver writes `CFG Scale`), and the value
   then neither maps nor displays.

8. Cosmetic, but users will ask: Civitai's "Other metadata" badges DROP every
   key starting with an uppercase letter, so Model, Model hash, Version,
   Schedule type and Denoising strength never appear as badges. They are still
   stored and still used for matching. This is Civitai's display choice, not
   something to fix here.
"""

import hashlib
import json
import os
import re

# ---------------------------------------------------------------- sampler names

# Mirrors alexopus/ComfyUI-Image-Saver CIVITAI_SAMPLER_MAP, which itself mirrors
# civitai/src/server/common/constants.ts samplerMap. Order is irrelevant.
CIVITAI_SAMPLER_MAP = {
    "euler_ancestral": "Euler a",
    "euler": "Euler",
    "lms": "LMS",
    "heun": "Heun",
    "dpm_2": "DPM2",
    "dpm_2_ancestral": "DPM2 a",
    "dpmpp_2s_ancestral": "DPM++ 2S a",
    "dpmpp_2m": "DPM++ 2M",
    "dpmpp_sde": "DPM++ SDE",
    "dpmpp_2m_sde": "DPM++ 2M SDE",
    "dpmpp_3m_sde": "DPM++ 3M SDE",
    "dpm_fast": "DPM fast",
    "dpm_adaptive": "DPM adaptive",
    "ddim": "DDIM",
    "plms": "PLMS",
    "uni_pc_bh2": "UniPC",
    "uni_pc": "UniPC",
    "lcm": "LCM",
}

# ComfyUI has _gpu variants that Civitai's table does not list separately; they
# are the same sampler, so strip the suffix before looking up rather than
# falling through to the raw-name branch.
_GPU_SUFFIX = "_gpu"


def civitai_sampler_name(sampler_name, scheduler=""):
    """ComfyUI sampler + scheduler -> the A1111 name Civitai recognises.

    Unmapped samplers fall back to `{sampler}_{scheduler}` (matching what the
    established packs emit) so the value is at least readable; Civitai stores
    the sampler as a free string with no enum validation, so an unknown name
    displays verbatim instead of failing the parse.
    """
    s = str(sampler_name or "").strip()
    sch = str(scheduler or "").strip()
    key = s
    if key not in CIVITAI_SAMPLER_MAP and key.endswith(_GPU_SUFFIX):
        key = key[: -len(_GPU_SUFFIX)]
    if key in CIVITAI_SAMPLER_MAP:
        name = CIVITAI_SAMPLER_MAP[key]
        if sch == "karras":
            name += " Karras"
        elif sch == "exponential":
            name += " Exponential"
        return name
    if sch and sch != "normal":
        return "%s_%s" % (s, sch)
    return s


# ------------------------------------------------------------------- lora tags

# Civitai's own regex for reading a tag back. Kept here so the writer and the
# reader can never drift: whatever we emit must match this.
_LORA_TAG_RE = re.compile(r"<(lora|hypernet):([a-zA-Z0-9_\.\-]+):([0-9.]+)>")
_TAG_NAME_STRIP = re.compile(r"[^a-zA-Z0-9_.\-]+")


def lora_tag_name(lora_path):
    """Turn a LoRA file reference into a name Civitai's tag regex accepts.

    Drops any subfolder and the extension, then removes every character outside
    the allowed set. Returns "" when nothing usable survives, so the caller can
    skip the tag rather than emit a malformed one.
    """
    base = os.path.basename(str(lora_path or "").replace("\\", "/"))
    base = os.path.splitext(base)[0]
    cleaned = _TAG_NAME_STRIP.sub("_", base).strip("_")
    return cleaned


def format_weight(weight):
    """Weight as Civitai's `[0-9.]+` pattern requires: no minus, no exponent.

    A negative weight CANNOT be expressed in a tag (the regex rejects the
    minus), so it is clamped to 0 and the caller should treat that as "omit the
    tag" if it cares about fidelity.
    """
    try:
        w = float(weight)
    except (TypeError, ValueError):
        return None
    if w != w or w in (float("inf"), float("-inf")):  # NaN / inf
        return None
    if w < 0:
        return None
    text = ("%.4f" % w).rstrip("0").rstrip(".")
    return text or "0"


def lora_tags(loras):
    """Build the `<lora:name:weight>` tags that carry STRENGTH to Civitai.

    `loras` is a sequence of (path_or_name, weight). Entries whose name or
    weight cannot be expressed are skipped rather than emitted broken.
    Returns a list of tag strings, deduped, order preserved.
    """
    out = []
    seen = set()
    for item in loras or []:
        try:
            path, weight = item[0], item[1]
        except (TypeError, IndexError):
            continue
        name = lora_tag_name(path)
        w = format_weight(weight)
        if not name or w is None:
            continue
        tag = "<lora:%s:%s>" % (name, w)
        if tag in seen:
            continue
        seen.add(tag)
        out.append(tag)
    return out


# ----------------------------------------------------------------- file hashing

_HASH_BLOCK = 1 << 20  # 1 MiB, matching the established packs


def autov2(sha256_hex):
    """Civitai AutoV2 = the first 10 hex chars of the full-file SHA256."""
    s = str(sha256_hex or "").strip()
    return s[:10].lower() if len(s) >= 10 else ""


def _read_foreign_sidecar(model_path):
    """Reuse a SHA256 another pack already computed, so users of those packs
    pay no hashing cost.

      <model>.sha256          alexopus/ComfyUI-Image-Saver (bare hex)
      <model>.metadata.json   willmiao/ComfyUI-Lora-Manager (key "sha256",
                              lowercase; may be absent/empty while its
                              hash_status is "pending")

    Returns a 64-char lowercase hex string or "". Deliberately strict: a short
    or non-hex value is ignored rather than trusted, because a wrong hash fails
    SILENTLY on Civitai and would be very hard to diagnose later.
    """
    stem = os.path.splitext(str(model_path))[0]
    try:
        p = stem + ".sha256"
        if os.path.isfile(p):
            with open(p, "r", encoding="utf-8", errors="replace") as fh:
                v = fh.read().strip().lower()
            if re.fullmatch(r"[0-9a-f]{64}", v):
                return v
    except OSError:
        pass
    try:
        p = stem + ".metadata.json"
        if os.path.isfile(p):
            with open(p, "r", encoding="utf-8", errors="replace") as fh:
                data = json.load(fh)
            v = str(data.get("sha256", "")).strip().lower()
            if re.fullmatch(r"[0-9a-f]{64}", v):
                return v
    except (OSError, ValueError, AttributeError):
        pass
    return ""


def sha256_file(path, block=_HASH_BLOCK):
    """Full-file SHA256, streamed. Returns "" if the file cannot be read."""
    try:
        h = hashlib.sha256()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(block), b""):
                h.update(chunk)
        return h.hexdigest().lower()
    except OSError:
        return ""


def cache_key(path):
    """Identity of a model file for caching: path + size + mtime.

    The size+mtime part matters. alexopus's `.sha256` sidecar has NO such check,
    so replacing a model in place while keeping the filename serves a stale hash
    forever, which then silently fails to resolve on Civitai. Returns "" when
    the file cannot be stat-ed.
    """
    try:
        st = os.stat(path)
    except OSError:
        return ""
    return "%s|%d|%d" % (os.path.normcase(os.path.abspath(path)), st.st_size, int(st.st_mtime))


class HashCache:
    """path+size+mtime -> full SHA256, persisted as one JSON file.

    One file, NOT sidecars littered through the user's models folders. Reads
    foreign sidecars first (free), then hashes. Every write is best-effort: a
    cache that cannot be saved must degrade to re-hashing, never raise into a
    save.
    """

    def __init__(self, path):
        self.path = path
        self._data = {}
        self._loaded = False

    def load(self):
        if self._loaded:
            return
        self._loaded = True
        try:
            if os.path.isfile(self.path):
                with open(self.path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                if isinstance(data, dict):
                    entries = data.get("entries")
                    if isinstance(entries, dict):
                        self._data = {
                            k: v for k, v in entries.items()
                            if isinstance(v, str) and re.fullmatch(r"[0-9a-f]{64}", v)
                        }
        except (OSError, ValueError):
            self._data = {}

    def save(self):
        try:
            d = os.path.dirname(self.path)
            if d:
                os.makedirs(d, exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump({"version": 1, "entries": self._data}, fh)
            os.replace(tmp, self.path)
            return True
        except OSError:
            return False

    def get(self, path):
        """Cached SHA256 for `path`, or "" if not known. Never hashes."""
        self.load()
        k = cache_key(path)
        return self._data.get(k, "") if k else ""

    def resolve(self, path, allow_hash=True):
        """SHA256 for `path`: cache, then a foreign sidecar, then hash it.

        Returns (sha256_hex, source) where source is one of
        "cache" / "sidecar" / "hashed" / "" (unavailable).
        """
        self.load()
        k = cache_key(path)
        if not k:
            return "", ""
        hit = self._data.get(k)
        if hit:
            return hit, "cache"
        foreign = _read_foreign_sidecar(path)
        if foreign:
            self._data[k] = foreign
            self.save()
            return foreign, "sidecar"
        if not allow_hash:
            return "", ""
        computed = sha256_file(path)
        if not computed:
            return "", ""
        self._data[k] = computed
        self.save()
        return computed, "hashed"


# --------------------------------------------------- the `parameters` string

def _quote(value):
    """A1111's quoting rule (modules/infotext_utils.py::quote).

    A value containing a comma, colon or newline is JSON-encoded, so Civitai's
    parser can find where it ends. NOT for `Hashes`: that one is a bare JSON
    object (see build_parameters).
    """
    s = str(value)
    if "," not in s and "\n" not in s and ":" not in s:
        return s
    return json.dumps(s, ensure_ascii=False)


# Emission order follows A1111's own generation_params dict so the string looks
# native. Keys are spelled EXACTLY as A1111 spells them; see rule 7 above.
_KEY_ORDER = (
    "Steps",
    "Sampler",
    "Schedule type",
    "CFG scale",
    "Seed",
    "Size",
    "Model hash",
    "Model",
    "Denoising strength",
    "Clip skip",
    "Version",
)


def build_parameters(positive="", negative="", params=None, hashes=None,
                     lora_specs=None):
    """Assemble the A1111 `parameters` string Civitai parses.

    positive / negative : prompt text. LoRA tags are appended to `positive`
                          because that is the ONLY place a strength can live.
    params              : dict of the keys in _KEY_ORDER (plus any extras,
                          emitted after the known ones in insertion order).
                          None / "" values are dropped, exactly as A1111 drops
                          them.
    hashes              : dict like {"model": "<10hex>", "LORA:name": "<10hex>"}
                          emitted as the `Hashes` key. Empty -> omitted.
    lora_specs          : sequence of (path_or_name, weight) used to build the
                          `<lora:...>` tags. Pass None to skip.

    Guarantees:
      - The result always contains "Steps: " when a Steps value is supplied,
        which is Civitai's only detection gate.
      - The `Negative prompt:` line is omitted entirely when there is no
        negative, matching A1111.
    """
    params = dict(params or {})
    pos = str(positive or "").strip()

    tags = lora_tags(lora_specs) if lora_specs else []
    if tags:
        pos = (pos + " " + " ".join(tags)).strip() if pos else " ".join(tags)

    neg = str(negative or "").strip()

    pairs = []
    for key in _KEY_ORDER:
        if key in params and params[key] not in (None, ""):
            pairs.append("%s: %s" % (key, _quote(params.pop(key))))
        else:
            params.pop(key, None)
    for key, value in params.items():
        if value not in (None, ""):
            pairs.append("%s: %s" % (key, _quote(value)))

    if hashes:
        clean = {k: v for k, v in hashes.items() if v}
        if clean:
            # A BARE JSON object, never _quote()d: A1111 writes the dict itself.
            # Civitai's reader brace-scans from the first "{" after ", Hashes: "
            # and JSON.parses it; a quoted value hands it `{\"model\"...` and
            # the throw drops EVERYTHING from the file (civitai-meta.md #14).
            pairs.append("Hashes: %s" % json.dumps(clean, separators=(",", ":")))

    line = ", ".join(pairs)
    neg_block = "\nNegative prompt: %s" % neg if neg else ""
    return "%s%s\n%s" % (pos, neg_block, line)


def size_value(width, height):
    """`Size` is WxH in that order, split on a literal 'x' by Civitai."""
    try:
        return "%dx%d" % (int(width), int(height))
    except (TypeError, ValueError):
        return ""


def build_hashes(model_sha256="", loras=None):
    """The `Hashes` dict, using AutoV2 (10 hex) values.

    `loras` is a sequence of (name_for_display, sha256_hex). A key named exactly
    "vae" is skipped: Civitai's resource query excludes it.
    """
    out = {}
    m = autov2(model_sha256)
    if m:
        out["model"] = m
    for item in loras or []:
        try:
            name, sha = item[0], item[1]
        except (TypeError, IndexError):
            continue
        v = autov2(sha)
        if not v:
            continue
        tag = lora_tag_name(name)
        # Civitai's query excludes an entry named exactly "vae", so a LoRA that
        # happens to be called that would be silently dropped on their side.
        if tag.lower() == "vae":
            continue
        if v in out.values():
            continue   # the same bytes are already listed: one resource
        key = "LORA:%s" % tag
        # The key is the cleaned BASENAME, so two LoRAs from different folders
        # sharing a name, or two non-Latin names (both clean to ""), collided and
        # the second hash vanished (civitai-meta.md #15). Such a LoRA is keyed by
        # its own hash instead: Civitai's resource query reads only the role
        # before the ":" and matches on the hash value.
        if not tag or key in out:
            key = "LORA:%s" % v
        out[key] = v
    return out
