"""Shared helpers for Pixaroma nodes that save images:
  - _expand_date_tokens: expand VHS-style %date:fmt% in filename_prefix
  - _safe_prefix:        validate filename_prefix supporting subfolder/file syntax
  - _build_pnginfo:      build a PngInfo embedding workflow + prompt for re-import
Used by node_preview.py (Python entry) and server_routes.py (HTTP routes).
"""

import json
import re
import time

from PIL.PngImagePlugin import PngInfo


# ---- date-token expansion (VHS-compatible %date:fmt% syntax) ----

# Match %date:FMT% where FMT is one or more non-% characters.
# Native ComfyUI tokens (%year%, %month%, %day%, %hour%, %minute%,
# %second%, %width%, %height%) are NOT touched here - they are expanded
# later by folder_paths.get_save_image_path.
_DATE_TOKEN_RE = re.compile(r"%date:([^%]+)%")

# Java-style format codes (the same ones VHS / VideoHelperSuite accepts)
# mapped to Python strftime codes. Order matters: longer codes first so
# 'yyyy' is matched before 'yy' during the two-pass replacement.
_DATE_FMT_PAIRS = (
    ("yyyy", "%Y"),
    ("yy",   "%y"),
    ("MM",   "%m"),
    ("dd",   "%d"),
    ("HH",   "%H"),
    ("mm",   "%M"),
    ("ss",   "%S"),
)


def _expand_date_tokens(s):
    """Expand %date:FMT% tokens using Java-style codes.

    Supported codes (any other characters pass through literally):
        yyyy  4-digit year     yy   2-digit year
        MM    zero-padded mo   dd   zero-padded day
        HH    zero-padded hr   mm   zero-padded min
        ss    zero-padded sec

    Examples (assuming 2026-05-10 14:32:07):
        %date:yyyy-MM-dd%        -> 2026-05-10
        %date:yyyy/MM/dd%        -> 2026/05/10  (3 nested folders)
        %date:yyyy-MM-dd_HH-mm%  -> 2026-05-10_14-32

    Native ComfyUI tokens (%year%, %month%, etc.) are left alone for
    folder_paths.get_save_image_path to handle. Returns the input
    unchanged if it doesn't contain '%date:'.
    """
    if not isinstance(s, str) or "%date:" not in s:
        return s
    now = time.localtime()

    def _sub(match):
        fmt = match.group(1)
        # Two-pass swap via sentinels prevents 'yyyy' being mis-rewritten as
        # 'YY' after 'yy' would otherwise have already substituted into '%Y'.
        sentinels = []
        out = fmt
        for i, (java, py) in enumerate(_DATE_FMT_PAIRS):
            sent = f"\x00{i}\x01"
            out = out.replace(java, sent)
            sentinels.append((sent, py))
        for sent, py in sentinels:
            out = out.replace(sent, py)
        try:
            return time.strftime(out, now)
        except Exception:
            # Bad format string - leave the token untouched so the user
            # sees their input verbatim and can fix it.
            return match.group(0)

    return _DATE_TOKEN_RE.sub(_sub, s)


# ---- prefix validation ----

# Allow native ComfyUI tokens (%year%, %month%, etc.) to pass through
# validation untouched; get_save_image_path expands them later.
_SAFE_SEG_RE = re.compile(r"^[a-zA-Z0-9_\-%]+$")
_PREFIX_MAX_LEN = 256


def _safe_prefix(s):
    """Return cleaned prefix string, or None if invalid.

    Pipeline: expand %date:FMT% tokens first, then validate. Allows path
    segments separated by '/', each matching [A-Za-z0-9_-%] (the '%' is
    permitted so native ComfyUI tokens like %year% survive validation
    and reach folder_paths.get_save_image_path for final expansion).

    Rejects '..', leading '/', empty segments, total length > 256.
    Backslashes are normalized to forward slashes (Windows convenience).

    Caller decides what to do with None:
      - Backend node:  `_safe_prefix(s) or "Preview"` (don't crash workflow)
      - Server routes: `if not prefix: return 400` (surface error to JS)
    """
    if not isinstance(s, str):
        return None
    s = _expand_date_tokens(s)
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
