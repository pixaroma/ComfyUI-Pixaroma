"""Remove Background Pixaroma - one-node background removal with a built-in
model dropdown.

Replaces the older wire-based version (1.3.32) that required a separate
Load Background Removal Model node upstream. Loads BiRefNet weights from
ComfyUI/models/background_removal/ and picks the right preprocessing
resolution from the filename:
    contains "matt" -> 2048 (matting models, soft edges)
    has "hr" as a word-piece -> 2048 (HR models, hard edges + detail)
    otherwise -> 1024 (standard)

ComfyUI's native loader hardcodes 1024 in birefnet.json, so we bypass it
and build BackgroundRemovalModel ourselves with the right image_size.
"""

import logging
import os
import re
from collections import OrderedDict

import torch
import folder_paths

import comfy.bg_removal_model
import comfy.model_management
import comfy.model_patcher
import comfy.ops
import comfy.utils

SENTINEL_NO_MODELS = "(no models - see Info tab)"

# Filename rule: case-insensitive. "matt" catches matte / matting. "hr"
# uses word-piece matching (no ASCII letter on either side, start/end of
# string counts) so birefnet-hr.safetensors matches but birefnet-shrunk
# does not.
_HR_RE = re.compile(r"(?<![a-z])hr(?![a-z])", re.IGNORECASE)


def _resolution_for_filename(name):
    """Return 2048 for matting / HR filenames, 1024 otherwise.

    Operates on the stem (no extension) so a stray ".pth" or
    ".safetensors" can't cause weird matches.
    """
    stem = os.path.splitext(name)[0]
    lower = stem.lower()
    if "matt" in lower:
        return 2048
    if _HR_RE.search(stem):
        return 2048
    return 1024


# Stub class so the file imports; will be filled in Task 2.
class PixaromaRemoveBackground:
    pass


NODE_CLASS_MAPPINGS = {
    "PixaromaRemoveBackground": PixaromaRemoveBackground,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaRemoveBackground": "Remove Background Pixaroma",
}
