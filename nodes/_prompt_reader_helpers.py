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

# Mux / switch nodes: at workflow-run time these route ONE of several inputs
# to their output. The walker has to mirror the same selection logic, or it
# stops at the switch and the prompt comes back empty even though the wired
# upstream text node IS in the workflow JSON.
#
# Selection strategy per node class:
#   PixaromaSwitch         - inputs.SwitchState is a string "1".."32" set by
#                            the JS app.graphToPrompt hook; follow input_{N}.
#   Any Switch (rgthree)   - no widget; rgthree picks the first non-None
#                            any_NN at run-time. Mirror by scanning any_NN
#                            in numeric order and following the first one
#                            that has a wired link.
_MUX_PIX_SWITCH = "PixaromaSwitch"
_MUX_RGTHREE_ANY_SWITCH = "Any Switch (rgthree)"
_RGTHREE_ANY_KEY_RE = re.compile(r"^any_(\d+)$")

# Prompt Stack Pixaroma: ships its rows + separator as a JSON blob in the
# hidden PromptStackState STRING input. The walker rebuilds the joined output
# in pure Python (mirrors nodes/node_prompt_stack.py's build() logic).
_PROMPT_STACK_CLASS = "PixaromaPromptStack"

# Prompt Multi Pixaroma: holds a library of prompts AND can run in either
# of two modes (Queue or List). The hidden PromptMultiState STRING input is
# {"version":2, "mode":"queue"|"list", "activePrompt":"...", "rowTexts":[...]}.
# Two dynamic outputs (only one visible at a time, depending on mode):
#   - "text"  (queue mode): the active row's prompt this queue iteration
#                            -> read activePrompt directly
#   - "list"  (list mode):  the full enabled-rows list -> downstream Prompt
#                            From List picks one by index
# When the walker reaches a Multi node directly, the slot it came in from
# tells us which path to follow. Output slot 0 always exists in the saved
# workflow (since the JS dynamically reconciles the visible output).
_PROMPT_MULTI_CLASS = "PixaromaPromptMulti"

# Prompt From List Pixaroma: tiny picker that grabs one row from a Prompt
# Multi's list output via an "index" widget. The walker chases its
# `prompts` input back to the upstream Multi and indexes rowTexts.
_PROMPT_FROM_LIST_CLASS = "PixaromaPromptFromList"

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


def _pix_switch_active_link(inputs: dict):
    """Return the upstream node-id wired to the active row of a PixaromaSwitch.

    SwitchState is injected by js/switch/index.js's app.graphToPrompt hook as
    a string "1".."32". A wired input is stored as [origin_id, origin_slot].
    Returns None when nothing is connected on the active row.
    """
    state = inputs.get("SwitchState")
    try:
        idx = int(str(state)) if state is not None else 0
    except (TypeError, ValueError):
        idx = 0
    if idx < 1:
        return None
    wire = inputs.get(f"input_{idx}")
    if isinstance(wire, list) and len(wire) >= 1:
        return wire[0]
    return None


def _pix_prompt_stack_extract(inputs: dict) -> Optional[str]:
    """Rebuild the joined text from a PixaromaPromptStack's saved state.

    The hidden PromptStackState input is a JSON string of shape:
        { "version": 1, "rows": [{"enabled": bool, "label": str, "text": str}, ...],
          "separator": str }

    Returns the joined text (mirrors node_prompt_stack.py build()), or None
    when nothing is enabled / all rows empty / state malformed.
    """
    raw = inputs.get("PromptStackState")
    if not isinstance(raw, str) or not raw:
        return None
    try:
        state = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(state, dict):
        return None
    rows = state.get("rows")
    if not isinstance(rows, list):
        return None
    parts = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if not row.get("enabled"):
            continue
        txt = row.get("text", "") or ""
        if not isinstance(txt, str):
            continue
        txt = txt.strip()
        if txt.endswith(","):
            txt = txt[:-1].rstrip()
        if not txt:
            continue
        parts.append(txt)
    if not parts:
        return None
    sep = state.get("separator", ", ")
    if not isinstance(sep, str):
        sep = ", "
    return sep.join(parts)


def _pix_prompt_multi_row_at(inputs: dict, index_1based: int) -> Optional[str]:
    """Return the prompt text at the given 1-based index from a Multi's
    enabled-rows list, or None.

    Used by the From List walker to resolve which library row a downstream
    Prompt From List node was pointing at when this image was generated.
    The rowTexts field already contains ONLY enabled non-empty rows in
    display order, so a From List index of 1 maps to rowTexts[0].
    """
    raw = inputs.get("PromptMultiState")
    if not isinstance(raw, str) or not raw:
        return None
    try:
        state = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(state, dict):
        return None
    rows = state.get("rowTexts")
    if not isinstance(rows, list):
        return None
    idx0 = int(index_1based) - 1
    if idx0 < 0 or idx0 >= len(rows):
        return None
    item = rows[idx0]
    if not isinstance(item, str):
        return None
    item = item.strip()
    return item or None


def _pix_prompt_from_list_resolve(node: dict, nodes: dict) -> Optional[str]:
    """Resolve a PixaromaPromptFromList node to its picked text.

    Reads the node's `index` widget value, follows the `prompts` input back
    to an upstream PixaromaPromptMulti (in List mode), and returns
    rowTexts[index-1]. Returns None when the upstream isn't a Multi, the
    index is missing / out of range, or the resolved row is empty.

    ComfyUI prompt JSON shape: widget values live in inputs (since they
    were promoted to the inputs dict at submit time); link values are
    [upstream_node_id, output_slot_idx] tuples.
    """
    inputs = node.get("inputs") or {}
    if not isinstance(inputs, dict):
        return None
    idx = inputs.get("index", 1)
    if not isinstance(idx, (int, float)):
        try:
            idx = int(idx)
        except (TypeError, ValueError):
            return None
    idx = int(idx)
    link = inputs.get("prompts")
    if not (isinstance(link, list) and len(link) >= 1):
        return None
    upstream_id = link[0]
    upstream = nodes.get(str(upstream_id))
    if not isinstance(upstream, dict):
        return None
    if upstream.get("class_type") != _PROMPT_MULTI_CLASS:
        # Some other node is feeding the list - we can't resolve it here.
        return None
    return _pix_prompt_multi_row_at(upstream.get("inputs") or {}, idx)


def _pix_prompt_multi_extract(inputs: dict) -> Optional[str]:
    """Read the active prompt from a PixaromaPromptMulti's saved state.

    The hidden PromptMultiState input is a JSON string of shape:
        { "version": 2, "mode": "queue"|"list",
          "activePrompt": str, "rowTexts": [str, ...] }
    (v1 schema {version:1, activePrompt} also handled - same field name.)

    Used when the walker reaches a Multi node via its `text` output (queue
    mode). Each queue iteration bakes that row's text into activePrompt at
    submit time, so the PNG embedded workflow captures exactly the prompt
    that produced that image. Recovery is a direct read.

    For Multi nodes reached via a Prompt From List node (list mode), use
    _pix_prompt_from_list_resolve instead - it indexes rowTexts properly.

    Returns the active prompt, or None when missing / malformed / empty.
    """
    raw = inputs.get("PromptMultiState")
    if not isinstance(raw, str) or not raw:
        return None
    try:
        state = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(state, dict):
        return None
    txt = state.get("activePrompt", "")
    if not isinstance(txt, str):
        return None
    txt = txt.strip()
    return txt or None


def _rgthree_any_switch_active_link(inputs: dict):
    """Return the upstream node-id wired to rgthree Any Switch's active input.

    rgthree's Any Switch has no widget: at run-time it picks the first non-
    None any_NN value. The walker mirrors that by scanning any_NN keys in
    numeric order and returning the first one that has a wired link.
    Returns None when nothing is connected.
    """
    candidates = []
    for key, v in inputs.items():
        m = _RGTHREE_ANY_KEY_RE.match(key)
        if not m:
            continue
        if isinstance(v, list) and len(v) >= 1:
            candidates.append((int(m.group(1)), v[0]))
    if not candidates:
        return None
    candidates.sort(key=lambda t: t[0])
    return candidates[0][1]


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

    # Mux / switch nodes: pick the active input and recurse through it. If we
    # fall through to the per-input loop instead, the switch's own input names
    # (input_1, any_01, ...) don't match the text/cond heuristics and the
    # walker stops cold at the switch.
    cls = node.get("class_type")
    if cls == _MUX_PIX_SWITCH:
        link = _pix_switch_active_link(inputs)
        if link is not None:
            _walk_for_text(link, nodes, captured, visited, depth + 1, chase_depth)
        return
    if cls == _MUX_RGTHREE_ANY_SWITCH:
        link = _rgthree_any_switch_active_link(inputs)
        if link is not None:
            _walk_for_text(link, nodes, captured, visited, depth + 1, chase_depth)
        return

    # Prompt Stack Pixaroma: text is NOT a wired input - all rows live as a
    # JSON blob inside the hidden PromptStackState string. Rebuild the joined
    # output the same way the Python node does at run-time.
    if cls == _PROMPT_STACK_CLASS:
        joined = _pix_prompt_stack_extract(inputs)
        if joined:
            captured.append(joined)
        return

    # Prompt Multi Pixaroma: each generated image carries only the prompt
    # that produced THIS image (the active row at queue time), baked into the
    # hidden PromptMultiState as {"activePrompt": "..."}. Read it directly.
    if cls == _PROMPT_MULTI_CLASS:
        text = _pix_prompt_multi_extract(inputs)
        if text:
            captured.append(text)
        return

    # Prompt From List Pixaroma: a tiny picker that grabs one row from a
    # Prompt Multi's `list` output. Read its index widget, walk back to the
    # upstream Multi, and resolve rowTexts[index-1].
    if cls == _PROMPT_FROM_LIST_CLASS:
        text = _pix_prompt_from_list_resolve(node, nodes)
        if text:
            captured.append(text)
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
