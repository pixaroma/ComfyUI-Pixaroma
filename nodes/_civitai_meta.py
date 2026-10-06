"""Build the Civitai-readable `parameters` metadata for a save node.

The ONE entry point a save node calls:

    from ._civitai_meta import build_metadata
    text = build_metadata(prompt, extra_pnginfo, unique_id, width, height)
    # -> a string to put in the PNG `parameters` chunk / EXIF UserComment,
    #    or None when there is nothing trustworthy to write.

This is the only module here that touches ComfyUI (`folder_paths`). The two it
builds on are pure and unit-tested standalone:
    _civitai_graph_walk.py   read the settings out of the API prompt
    _civitai_meta_helpers.py the A1111 string, hashing, the hash cache

DESIGN RULE, applied everywhere below: **omit rather than guess.** Every value is
value-or-None and a None key is simply left out, exactly as A1111 leaves out an
unset value. A wrong number in image metadata is worse than a missing one,
because whoever looks at the image cannot tell it is wrong. The same rule is why
`build_metadata` returns None instead of a half-string when it cannot find a
sampler: without `Steps: ` Civitai would not parse it anyway, so a partial string
is pure noise in the file.

WHY IT NEVER BLOCKS A SAVE: the whole body is wrapped by the caller in
try/except, and hashing is skipped (not waited for) when `allow_hash=False`.
"""

import json
import os

try:
    import folder_paths
except Exception:  # pragma: no cover - only for standalone import
    folder_paths = None

from . import _civitai_graph_walk as walk
from . import _civitai_meta_helpers as meta

# Folder keys a KSampler's model could have come from, most likely first.
_MODEL_FOLDERS = ("checkpoints", "diffusion_models", "unet")
# Which tree each loader widget names, so the lookup starts in the right place.
_FOLDERS_FOR_KEY = {
    "ckpt_name": ("checkpoints", "diffusion_models", "unet"),
    "unet_name": ("diffusion_models", "unet", "checkpoints"),
    "model_name": ("checkpoints", "diffusion_models", "unet"),
    "model_path": ("checkpoints", "diffusion_models", "unet"),
}

# LoRA Loader Pixaroma keeps its stack in a hidden state blob, so it is read
# here rather than by the generic walker. Verified against the node's OWN reader
# (nodes/node_lora_loader.py): hidden input "LoraLoaderState", state["loras"] is
# a list of {"on": bool, "name": str, "sm": model strength, "sc": clip strength},
# and a row whose name is the placeholder means "no LoRAs installed".
_LORA_STATE_INPUT = "LoraLoaderState"
_LORA_PLACEHOLDER = "(put LoRAs in models/loras)"

_CACHE_NAME = "pixaroma_model_hashes.json"
_cache = None


def _cache_path():
    """One JSON under ComfyUI's user directory.

    Deliberately NOT sidecar files next to the models: those pollute the user's
    model folders, and the two packs that do it write a hash with no
    size/mtime check, so replacing a model in place serves a stale hash forever.
    Falls back to the plugin folder, then the temp dir, so a locked-down install
    still gets caching rather than re-hashing multi-GB files on every save.
    """
    for getter in ("get_user_directory",):
        try:
            base = getattr(folder_paths, getter)()
            if base and os.path.isdir(base):
                return os.path.join(base, _CACHE_NAME)
        except Exception:
            pass
    try:
        return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            _CACHE_NAME)
    except Exception:
        import tempfile
        return os.path.join(tempfile.gettempdir(), _CACHE_NAME)


def get_cache():
    global _cache
    if _cache is None:
        _cache = meta.HashCache(_cache_path())
    return _cache


def resolve_model_path(name, folders=_MODEL_FOLDERS):
    """A model NAME as it appears in a prompt -> an absolute path, or None.

    Uses `folder_paths.get_full_path`, same as the rest of this plugin, so
    extra_model_paths.yaml and split-across-disks setups are honoured. Tries each
    plausible folder key because a KSampler's model can come from checkpoints,
    diffusion_models or unet.
    """
    if not name or folder_paths is None:
        return None
    for key in folders:
        try:
            path = folder_paths.get_full_path(key, name)
        except Exception:
            path = None
        if path and os.path.isfile(path):
            return path
    return None


def pixaroma_lora_rows(prompt, node_ids):
    """[(lora_name, model_strength)] from every LoRA Loader Pixaroma listed.

    Mirrors the node's own reader: only rows with `on` true, never the
    placeholder row, and a row whose model strength is zero is skipped because it
    contributed nothing to the image (Civitai's parser skips those too).
    """
    out = []
    for node_id in node_ids or []:
        raw = walk.widget_value(prompt, node_id, _LORA_STATE_INPUT)
        if not isinstance(raw, str) or not raw.strip():
            continue
        try:
            state = json.loads(raw)
        except (ValueError, TypeError):
            continue
        rows = state.get("loras") if isinstance(state, dict) else None
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict) or not row.get("on"):
                continue
            name = row.get("name")
            if not isinstance(name, str) or not name or name == _LORA_PLACEHOLDER:
                continue
            try:
                strength = float(row.get("sm", 0.0))
            except (TypeError, ValueError):
                continue
            if -0.001 < strength < 0.001:
                continue
            out.append((name, strength))
    return out


def collect_resources(prompt, info, allow_hash=True):
    """(hashes_dict, lora_specs) for the `Hashes` field and the prompt tags.

    lora_specs keeps every active LoRA even when its hash is unavailable,
    because the `<lora:name:weight>` tag is still worth writing: it is the only
    place a STRENGTH can live, and it also lets Civitai match by name.
    """
    cache = get_cache()

    ckpt_sha = ""
    ckpt = info.get("checkpoint")
    if ckpt:
        # Search the tree the NAME CAME FROM first. Without this a name that
        # exists both as a full checkpoint and as a UNET hashed whichever the
        # fixed order hit first, attributing the image to a model never loaded.
        folders = _FOLDERS_FOR_KEY.get(info.get("checkpoint_key"), _MODEL_FOLDERS)
        path = resolve_model_path(ckpt, folders)
        if path:
            ckpt_sha, _src = cache.resolve(path, allow_hash=allow_hash)

    loras = list(info.get("loras") or [])
    loras += pixaroma_lora_rows(prompt, info.get("pixaroma_lora_ids"))

    # De-dupe by resolved file, keeping the first strength seen. The same LoRA
    # can legitimately appear twice (a chain plus our stack) and Civitai would
    # otherwise list it twice.
    hashed = []
    seen = set()
    specs = []
    for name, strength in loras:
        path = resolve_model_path(name, ("loras",))
        # De-dupe on the RESOLVED FILE, not the name: two LoRAs organised as
        # sd15/detail.safetensors and sdxl/detail.safetensors are different files
        # that share a basename, and keying on the name let both through here
        # only for them to collide later in the Hashes dict, losing one hash.
        key = os.path.normcase(path) if path else str(name).lower()
        if key in seen:
            continue
        seen.add(key)
        # A LoRA file that is not there did NOT affect the image: the LoRA Loader
        # skips a missing row and prints "skipped (not found)", and its own
        # trigger-words output excludes it for the same reason. Claiming it in the
        # metadata would advertise a resource that never touched the picture.
        if not path:
            continue
        specs.append((name, strength))
        sha, _src = cache.resolve(path, allow_hash=allow_hash)
        if sha:
            hashed.append((name, sha))

    return meta.build_hashes(model_sha256=ckpt_sha, loras=hashed), specs


def build_metadata(prompt, extra_pnginfo=None, unique_id=None, width=None,
                   height=None, allow_hash=True):
    """The A1111 `parameters` string for this save, or None.

    Returns None when no sampler can be found upstream: Civitai only parses a
    string containing "Steps: ", so a string without it is dead weight in the
    file rather than partial information.
    """
    if not isinstance(prompt, dict) or not prompt:
        return None

    node_id = str(unique_id) if unique_id is not None else None
    if node_id is None or node_id not in prompt:
        # Without our own id we cannot tell WHICH sampler fed this node, and
        # picking one at random would attach another pass's settings to this
        # image. Refuse instead.
        return None

    info = walk.describe(prompt, node_id)
    if info.get("steps") is None:
        return None

    hashes, lora_specs = collect_resources(prompt, info, allow_hash=allow_hash)

    params = {}
    params["Steps"] = info.get("steps")
    sampler = info.get("sampler_name")
    if sampler:
        params["Sampler"] = meta.civitai_sampler_name(sampler, info.get("scheduler") or "")
    if info.get("cfg") is not None:
        params["CFG scale"] = info["cfg"]
    if info.get("seed") is not None:
        params["Seed"] = info["seed"]
    size = meta.size_value(width, height)
    if size:
        params["Size"] = size

    ckpt = info.get("checkpoint")
    if ckpt:
        # A1111 writes the model NAME without folder or extension.
        params["Model"] = os.path.splitext(os.path.basename(str(ckpt).replace("\\", "/")))[0]
    model_hash = hashes.get("model")
    if model_hash:
        params["Model hash"] = model_hash

    denoise = info.get("denoise")
    try:
        if denoise is not None and float(denoise) != 1.0:
            params["Denoising strength"] = denoise
    except (TypeError, ValueError):
        pass

    # Civitai does not require Version, but every real A1111 string carries one
    # and it tells a human which tool wrote the file.
    params["Version"] = "ComfyUI"

    return meta.build_parameters(
        positive=info.get("positive") or "",
        negative=info.get("negative") or "",
        params=params,
        hashes=hashes,
        lora_specs=lora_specs or None,
    )


def build_video_prompt(prompt, unique_id=None, width=None, height=None):
    """A small ComfyUI API prompt for a VIDEO's `prompt` tag, or None.

    Civitai reads a video ONLY through its `prompt` / `workflow` tags and its
    ComfyUI parser (civitai-meta.md #16), and that parser chokes on a real graph:
    it cannot see the text in our prompt nodes, takes a WIRED seed as 0, and drops
    the whole record when Control Panel or Dropdown feed the sampler. So this
    hands it a plain stand-in it reads in full: one loader, the LoRAs as core
    LoraLoaders, two CLIPTextEncodes with the real text, an EmptyLatentImage at
    the video's size and one KSampler with every value written in. The values are
    the ones build_metadata writes for an image (same walk, same refusals); a
    value the walk cannot know is left out, never guessed. Nothing is hashed:
    Civitai's ComfyUI path matches no hashes, so it would only cost time.

    The caller puts this in the `prompt` tag and leaves `workflow` alone, which
    is what ComfyUI reopens a video from.
    """
    if not isinstance(prompt, dict) or not prompt:
        return None
    node_id = str(unique_id) if unique_id is not None else None
    if node_id is None or node_id not in prompt:
        return None
    # The PICTURE's sampler: a soundtrack's own sampler on an `audio` wire can be
    # nearer and would label the video with its values (walk.not_audio).
    info = walk.describe(prompt, node_id, sampler_follow=walk.not_audio)
    if info.get("steps") is None:
        return None

    graph = {}
    model = clip = None
    ckpt = info.get("checkpoint")
    if ckpt:
        if info.get("checkpoint_key") == "unet_name":
            graph["1"] = {"class_type": "UNETLoader", "inputs": {"unet_name": ckpt}}
        else:
            graph["1"] = {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}}
        model, clip = ["1", 0], ["1", 1]

    # The same LoRAs, in the same order, collect_resources would record for an
    # image: a file that is not there did not touch the picture, so it is left out.
    seen = set()
    loras = list(info.get("loras") or []) + pixaroma_lora_rows(prompt, info.get("pixaroma_lora_ids"))
    next_id = 10
    for name, strength in loras:
        path = resolve_model_path(name, ("loras",))
        if not path:
            continue
        key = os.path.normcase(path)
        if key in seen:
            continue
        seen.add(key)
        inputs = {"lora_name": name, "strength_model": strength}
        if model:
            inputs["model"] = model
        if clip:
            inputs["clip"] = clip
        graph[str(next_id)] = {"class_type": "LoraLoader", "inputs": inputs}
        model, clip = [str(next_id), 0], [str(next_id), 1]
        next_id += 1

    sampler = {"steps": info.get("steps")}
    for src, dst in (("seed", "seed"), ("cfg", "cfg"), ("sampler_name", "sampler_name"),
                     ("scheduler", "scheduler"), ("denoise", "denoise")):
        if info.get(src) is not None:
            sampler[dst] = info[src]
    if model:
        sampler["model"] = model
    for side, nid in (("positive", "2"), ("negative", "3")):
        text = info.get(side)
        if isinstance(text, str) and text.strip():
            enc = {"text": text}
            if clip:
                enc["clip"] = clip
            graph[nid] = {"class_type": "CLIPTextEncode", "inputs": enc}
            sampler[side] = [nid, 0]
    try:
        w, h = int(width), int(height)
    except (TypeError, ValueError):
        w = h = 0
    if w > 0 and h > 0:
        graph["4"] = {"class_type": "EmptyLatentImage",
                      "inputs": {"width": w, "height": h, "batch_size": 1}}
        sampler["latent_image"] = ["4", 0]
    graph["5"] = {"class_type": "KSampler", "inputs": sampler}
    try:
        # A bare NaN is not JSON a browser can parse; leave the tag alone instead.
        return json.dumps(graph, allow_nan=False)
    except (TypeError, ValueError):
        return None
