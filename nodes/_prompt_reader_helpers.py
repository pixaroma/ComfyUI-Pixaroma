"""Prompt Reader Pixaroma - metadata extraction helpers.

Read PNG tEXt/iTXt chunks via PIL, then walk the embedded ComfyUI workflow
JSON to trace the POSITIVE prompt text that drove the image. Falls back to
A1111 / Forge `parameters` style metadata when no ComfyUI workflow is present.

Used by both the Python node (run-time output) and the server route
(/pixaroma/api/prompt_reader/extract for the in-node live readout).
"""

import json
import re
from typing import Optional

from PIL import Image


_TEXT_KEYS = (
    "text", "text_g", "text_l", "string", "prompt", "value", "wildcard_text",
    "text_a", "text_b", "str", "format", "template",
    "prepend", "append", "positive_prompt", "input_string",
)
_COND_LINK_KEYS = (
    "conditioning", "conditioning_1", "conditioning_2",
    "cond", "positive", "from", "input",
)
_SAMPLER_RE = re.compile(r"sampler", re.IGNORECASE)
_MAX_WALK_DEPTH = 24


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


def _walk_for_text(
    node_id: str,
    nodes: dict,
    captured: list,
    visited: set,
    depth: int = 0,
) -> None:
    """DFS from `node_id` collecting string text-widget values.

    Follows known conditioning / text link inputs backwards through the graph
    so chains like KSampler -> ConditioningCombine -> CLIPTextEncode resolve
    to the underlying text. Visited-set + depth cap guard against cycles.
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
    inputs = node.get("inputs") or {}
    if not isinstance(inputs, dict):
        return

    for key in _TEXT_KEYS:
        v = inputs.get(key)
        if isinstance(v, str):
            s = v.strip()
            if s:
                captured.append(s)
        elif isinstance(v, list) and len(v) >= 1:
            _walk_for_text(v[0], nodes, captured, visited, depth + 1)

    for key, v in inputs.items():
        if key in _TEXT_KEYS:
            continue
        if key not in _COND_LINK_KEYS:
            continue
        if isinstance(v, list) and len(v) >= 1:
            _walk_for_text(v[0], nodes, captured, visited, depth + 1)


def extract_positive_from_comfy_prompt(prompt_json: str) -> Optional[str]:
    """Parse the ComfyUI 'prompt' PNG chunk and return the positive prompt.

    Strategy: find every sampler-like node (class_type matches /sampler/i),
    follow its 'positive' input backwards through the graph, collect every
    string text-widget value reached. De-duplicate while preserving order
    and join with paragraph separators when multiple distinct texts are
    found (e.g. SDXL CLIPTextEncodeSDXL with text_g + text_l).

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
            _walk_for_text(pos[0], nodes, captured, visited, 0)
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

    return {
        "found": False,
        "message": "Image has metadata but no positive prompt was found.",
    }
