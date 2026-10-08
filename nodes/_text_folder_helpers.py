"""Shared helpers for the .txt-folder nodes: Load Texts from Folder Pixaroma and
Caption Review Pixaroma (and the caption_review/list route that feeds it).

ONE copy of the folder rule for both, on purpose (path-containment.md: never
re-roll a check). The folder field means the same thing as Save Text's and
Save Image's: empty = ComfyUI's output folder, a relative name = a folder inside
output, a full path = any folder the user approved with Browse.

THE ORDER IS THE INVARIANT (path-containment #5): prescreen_folder_field on the
RAW string first (the resolver expands %VARS% and realpaths, and on Windows a
realpath of a UNC path already leaks an NTLM hash), then the shared resolver,
then folder_allowed on the resolved path, and only then isdir. Answering "not
found" only AFTER the allowed check keeps this from being a directory-existence
oracle for the whole disk (the LIF list route's round-3 rule).
"""
import os

from ._path_guard import denied_message as _pix_denied_message
from ._path_guard import folder_allowed as _pix_folder_allowed
from ._path_guard import prescreen_folder_field as _pix_prescreen_field
from ._save_helpers import _resolve_save_folder, _sanitize_segment
from ._save_text_helpers import _KNOWN_EXT_RE

MAX_FILES = 10000
MAX_BYTES = 1024 * 1024      # one caption / prompt file; anything bigger is not one


def resolve_folder(raw, who="Load Texts from Folder"):
    """(real_folder, error_message)."""
    raw = raw if isinstance(raw, str) else ""
    if not _pix_prescreen_field(raw):
        return None, _pix_denied_message(raw)
    base, _inside = _resolve_save_folder(raw)
    if not _pix_folder_allowed(base):
        return None, _pix_denied_message(raw)
    if not os.path.isdir(base):
        return None, f"{who}: folder not found: {raw or 'the ComfyUI output folder'}"
    return base, None


def list_txt(folder):
    """[(stem, full_path)] of the .txt files directly inside `folder`, in name order."""
    out = []
    try:
        names = os.listdir(folder)
    except OSError:
        return out
    for n in sorted(names, key=str.lower):
        if not n.lower().endswith(".txt"):
            continue
        p = os.path.join(folder, n)
        if os.path.isfile(p):
            out.append((n[:-4], p))
            if len(out) >= MAX_FILES:
                break
    return out


def read_txt(path, limit=MAX_BYTES):
    """(text, ok). The text without a BOM and without surrounding blank space.
    ok is False when the file is over `limit` or cannot be read (text is "")."""
    try:
        if os.path.getsize(path) > limit:
            return "", False
        with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
            return f.read().strip(), True
    except OSError:
        return "", False


def match_key(stem):
    """How a picture name and a .txt name are matched when they are not identical:
    the clean-up Save Text's file names get (_MG_1234 is saved as MG_1234.txt),
    case-insensitive."""
    return _sanitize_segment(str(stem)).lower()


def caption_index(files):
    """{exact lower stem: path} and {cleaned key: path} for list_txt() output."""
    exact, clean = {}, {}
    for s, p in files:
        exact.setdefault(s.lower(), p)
        clean.setdefault(match_key(s), p)
    return exact, clean


def find_caption(stem, exact, clean):
    """The .txt path that belongs to a picture stem, or None."""
    s = "" if stem is None else str(stem)
    return exact.get(s.lower()) or clean.get(match_key(s))


def save_name_changes(stem):
    """True when Save Text's write route would save `stem` under ANOTHER name
    (a leading _, a double __, a trailing dot or space, a forbidden character, over
    100 characters). Caption Review refuses to save such a card rather than
    writing a second, differently named file next to the picture."""
    s = "" if stem is None else str(stem)
    if not s or _KNOWN_EXT_RE.search(s):     # normalize_txt_name drops a known text extension
        return True
    return _sanitize_segment(s)[:100] != s
