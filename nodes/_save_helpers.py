"""Shared helpers for Pixaroma nodes that save images:
  - _safe_prefix:    validate filename_prefix supporting subfolder/file syntax
  - _build_pnginfo:  build a PngInfo embedding workflow + prompt for re-import
Used by node_preview.py (Python entry) and server_routes.py (HTTP routes).
"""

import json
import re

from PIL.PngImagePlugin import PngInfo


# ---- prefix validation ----

_SAFE_SEG_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")
_PREFIX_MAX_LEN = 256


def _safe_prefix(s):
    """Return cleaned prefix string, or None if invalid.

    Allows path segments separated by '/', each matching [A-Za-z0-9_-].
    Rejects '..', leading '/', empty segments, total length > 256.
    Backslashes are normalized to forward slashes (Windows convenience).

    Caller decides what to do with None:
      - Backend node:  `_safe_prefix(s) or "Preview"` (don't crash workflow)
      - Server routes: `if not prefix: return 400` (surface error to JS)
    """
    if not isinstance(s, str):
        return None
    s = s.strip().replace("\\", "/")
    if not s or len(s) > _PREFIX_MAX_LEN:
        return None
    if s.startswith("/"):
        return None
    parts = s.split("/")
    if any(not p or p == ".." or not _SAFE_SEG_RE.match(p) for p in parts):
        return None
    return s


# ---- workflow metadata embedding ----

def _build_pnginfo(prompt=None, workflow=None, extra_pnginfo=None):
    """Return a PngInfo object embedding workflow + prompt as tEXt chunks,
    matching the byte format ComfyUI's built-in SaveImage writes.

    Two calling conventions, supported simultaneously:
      Route side (called from JS): pass `prompt=` and `workflow=` (both
        JSON-serialisable dicts from app.graphToPrompt()).
      Node side (called by ComfyUI): pass `prompt=` (PROMPT hidden input)
        and `extra_pnginfo=` (EXTRA_PNGINFO hidden input — a dict whose
        "workflow" key holds the workflow). Each key in extra_pnginfo
        becomes its own tEXt chunk.

    Any argument may be None / missing — its chunk is then skipped.
    Unserialisable extras are silently dropped (best-effort).
    """
    pnginfo = PngInfo()
    if prompt is not None:
        try:
            pnginfo.add_text("prompt", json.dumps(prompt))
        except Exception:
            pass
    if workflow is not None:
        try:
            pnginfo.add_text("workflow", json.dumps(workflow))
        except Exception:
            pass
    if isinstance(extra_pnginfo, dict):
        for k, v in extra_pnginfo.items():
            try:
                pnginfo.add_text(k, json.dumps(v))
            except Exception:
                pass
    return pnginfo
