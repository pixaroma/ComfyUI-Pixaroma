"""Prompt Reader Pixaroma - metadata extraction helpers.

Read PNG tEXt/iTXt chunks via PIL, then walk the embedded ComfyUI workflow
JSON to trace the POSITIVE prompt text that drove the image. Falls back to
A1111 / Forge `parameters` style metadata when no ComfyUI workflow is present.

Used by both the Python node (run-time output) and the server route
(/pixaroma/api/prompt_reader/extract for the in-node live readout).
"""

import json
import os
import re
from typing import Optional

from PIL import Image

# folder_paths is a ComfyUI runtime module; not available in unit-test
# environments. The chase-through-PromptReader feature degrades silently
# when it can't resolve a path.
try:
    import folder_paths as _folder_paths
except ImportError:
    _folder_paths = None


# Known text-bearing input names. Frozenset for O(1) lookup; the regex
# `_TEXT_KEY_RE` below catches the long tail of `text_X` / `string_X`
# / `prompt_X` patterns used by various concat / format / chain nodes.
_TEXT_KEYS = frozenset({
    "text", "text_g", "text_l", "string", "str", "prompt",
    "value", "wildcard_text", "input_string", "positive_prompt",
    "format", "template", "prepend", "append", "prefix", "suffix",
})
# Fallback pattern: covers rgthree-style Text Concatenate (`string_a`,
# `string_b`, ...), numbered variants (`text_1`, `text_2`), and the many
# similar concat / chain nodes in the ecosystem.
_TEXT_KEY_RE = re.compile(r"^(text|string|str|prompt)[_-][a-zA-Z0-9]+$")


def _is_text_key(name: str) -> bool:
    """Return True iff `name` looks like a text-carrying input."""
    return name in _TEXT_KEYS or bool(_TEXT_KEY_RE.match(name))


_COND_LINK_KEYS = frozenset({
    "conditioning", "conditioning_1", "conditioning_2",
    "cond", "positive", "from", "input",
})
_SAMPLER_RE = re.compile(r"sampler", re.IGNORECASE)
_MAX_WALK_DEPTH = 24
# Chase depth caps how many PixaromaPromptReader hops we follow when an image
# was generated from a workflow that itself contained a PromptReader pointing
# at yet another image. Five levels is plenty for realistic histories and
# bounds the work cleanly.
_MAX_CHASE_DEPTH = 5


def read_png_text_chunks(file_path: str) -> dict:
    """Return all tEXt/iTXt chunks from a PNG as {key: value} strings.

    Empty dict for non-PNG / unreadable files - the caller treats that as
    'no metadata found' and shows the placeholder message.
    """
    try:
        with Image.open(file_path) as img:
            info = dict(img.info or {})
    except Exception:
        return {}
    out = {}
    for k, v in info.items():
        if isinstance(v, (str, bytes)):
            out[str(k)] = v.decode("utf-8", "replace") if isinstance(v, bytes) else v
    return out


def _chase_pixaroma_prompt_reader(node: dict, chase_depth: int) -> Optional[str]:
    """When the walker hits a PixaromaPromptReader node, the embedded workflow
    only records `inputs.image = "<filename>"` - the actual prompt text was a
    runtime output, never saved into the prompt JSON. To recover it, resolve
    the image filename and recursively read THAT file's metadata.

    Returns None when the source file is missing (e.g. the user deleted it),
    when folder_paths isn't available, or when the chase cap is reached.
    """
    if chase_depth >= _MAX_CHASE_DEPTH or _folder_paths is None:
        return None
    inputs = node.get("inputs") or {}
    image_name = inputs.get("image")
    if not isinstance(image_name, str) or not image_name:
        return None
    try:
        image_path = _folder_paths.get_annotated_filepath(image_name)
    except Exception:
        return None
    if not image_path or not os.path.isfile(image_path):
        return None
    chunks = read_png_text_chunks(image_path)
    if "prompt" in chunks:
        positive = extract_positive_from_comfy_prompt(
            chunks["prompt"], _chase_depth=chase_depth + 1,
        )
        if positive:
            return positive
    if "parameters" in chunks:
        positive = extract_positive_from_a1111(chunks["parameters"])
        if positive:
            return positive
    return None


def _walk_for_text(
    node_id: str,
    nodes: dict,
    captured: list,
    visited: set,
    depth: int = 0,
    chase_depth: int = 0,
) -> None:
    """DFS from `node_id` collecting string text-widget values.

    Follows known conditioning / text link inputs backwards through the graph
    so chains like KSampler -> ConditioningCombine -> CLIPTextEncode resolve
    to the underlying text. Visited-set + depth cap guard against cycles.
    PixaromaPromptReader nodes are special-cased: their text output is a
    runtime value (not stored in the prompt JSON), so we chase the source
    image file and recursively extract its prompt.
    """
    if depth > _MAX_WALK_DEPTH:
        return
    sid = str(node_id)
    if sid in visited:
        return
    visited.add(sid)

    node = nodes.get(sid)
    if not isinstance(node, dict):
        return

    # Special-case Pixaroma Prompt Reader: chase the source file.
    if node.get("class_type") == "PixaromaPromptReader":
        chased = _chase_pixaroma_prompt_reader(node, chase_depth)
        if chased:
            captured.append(chased)
        return

    inputs = node.get("inputs") or {}
    if not isinstance(inputs, dict):
        return

    # Single pass over inputs. For each one, classify as text-carrying
    # (capture string OR recurse into linked node), conditioning-link
    # (recurse only), or ignore.
    for key, v in inputs.items():
        if _is_text_key(key):
            if isinstance(v, str):
                s = v.strip()
                if s:
                    captured.append(s)
            elif isinstance(v, list) and len(v) >= 1:
                _walk_for_text(v[0], nodes, captured, visited, depth + 1, chase_depth)
        elif key in _COND_LINK_KEYS:
            if isinstance(v, list) and len(v) >= 1:
                _walk_for_text(v[0], nodes, captured, visited, depth + 1, chase_depth)


def extract_positive_from_comfy_prompt(
    prompt_json: str, _chase_depth: int = 0,
) -> Optional[str]:
    """Parse the ComfyUI 'prompt' PNG chunk and return the positive prompt.

    Strategy: find every sampler-like node (class_type matches /sampler/i),
    follow its 'positive' input backwards through the graph, collect every
    string text-widget value reached. De-duplicate while preserving order
    and join with paragraph separators when multiple distinct texts are
    found (e.g. SDXL CLIPTextEncodeSDXL with text_g + text_l).

    `_chase_depth` is internal - used when the walker follows a PromptReader
    node into its source image's metadata.

    Returns None when no sampler exists OR no text is reached - the caller
    then tries the A1111 fallback.
    """
    try:
        nodes = json.loads(prompt_json)
    except Exception:
        return None
    if not isinstance(nodes, dict):
        return None

    samplers = []
    for nid, node in nodes.items():
        if not isinstance(node, dict):
            continue
        cls = node.get("class_type") or ""
        if isinstance(cls, str) and _SAMPLER_RE.search(cls):
            samplers.append(nid)

    if not samplers:
        return None

    captured: list = []
    visited: set = set()
    for sid in samplers:
        node = nodes.get(sid)
        if not isinstance(node, dict):
            continue
        pos = (node.get("inputs") or {}).get("positive")
        if isinstance(pos, list) and len(pos) >= 1:
            _walk_for_text(pos[0], nodes, captured, visited, 0, _chase_depth)
        elif isinstance(pos, str) and pos.strip():
            captured.append(pos.strip())

    if not captured:
        return None

    seen = set()
    unique = []
    for s in captured:
        if s not in seen:
            seen.add(s)
            unique.append(s)
    return "\n\n".join(unique)


_A1111_PARAM_LINE_RE = re.compile(
    r"^(Steps|Sampler|Schedule type|CFG scale|Seed|Size|Model hash|"
    r"Model|VAE|Denoising strength|Clip skip|ENSD|Eta|Hires upscale|"
    r"Hires steps|Hires upscaler|Version):",
    re.MULTILINE,
)


def extract_positive_from_a1111(parameters: str) -> Optional[str]:
    """Pull the positive portion out of an A1111 / Forge 'parameters' string.

    A1111 stores all three sections in one PNG tEXt chunk keyed 'parameters':
        masterpiece, cat
        Negative prompt: ugly, blurry
        Steps: 20, Sampler: Euler, ...

    The positive is everything before either the 'Negative prompt:' marker or
    the first known param line.
    """
    if not isinstance(parameters, str) or not parameters.strip():
        return None
    text = parameters

    neg_idx = text.find("\nNegative prompt:")
    if neg_idx > 0:
        positive = text[:neg_idx]
    else:
        m = _A1111_PARAM_LINE_RE.search(text)
        positive = text[: m.start()] if m else text

    positive = positive.strip()
    return positive or None


def read_prompt_from_image(file_path: str) -> dict:
    """Orchestrator. Returns one of:

      { "found": True,  "text": "<prompt>", "source": "comfyui" | "a1111" }
      { "found": False, "message": "..." }
    """
    chunks = read_png_text_chunks(file_path)
    if not chunks:
        return {
            "found": False,
            "message": "No prompt metadata found in this image.",
        }

    if "prompt" in chunks:
        positive = extract_positive_from_comfy_prompt(chunks["prompt"])
        if positive:
            return {"found": True, "text": positive, "source": "comfyui"}

    if "parameters" in chunks:
        positive = extract_positive_from_a1111(chunks["parameters"])
        if positive:
            return {"found": True, "text": positive, "source": "a1111"}

    # If the workflow contains a Pixaroma Prompt Reader and we still got
    # nothing, the failure mode is almost always "the original source image
    # is no longer in input/" (the chase couldn't resolve it). Surface a
    # specific message rather than the generic one so the user knows what
    # to do.
    if "prompt" in chunks:
        try:
            nodes = json.loads(chunks["prompt"])
            if isinstance(nodes, dict) and any(
                isinstance(n, dict) and n.get("class_type") == "PixaromaPromptReader"
                for n in nodes.values()
            ):
                return {
                    "found": False,
                    "message": (
                        "The prompt came from a Prompt Reader Pixaroma "
                        "node, but its source image is no longer in the "
                        "input folder so the prompt couldn't be traced."
                    ),
                }
        except Exception:
            pass

    return {
        "found": False,
        "message": "Image has metadata but no positive prompt was found.",
    }
