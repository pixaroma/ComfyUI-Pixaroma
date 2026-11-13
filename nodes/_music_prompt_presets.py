"""Music Prompt Pixaroma - named formula sets.

A SET is the pair of instructions plus the sampling that makes them work, under
a name that says what it is for: `MiniMax Music 3 (Qwen3.5 4B int8)`. That name
is the whole point - the node ships one measured set today, and a second model or
a second music model becomes another entry rather than a rewrite.

WHY A SET RATHER THAN A FORMULA. This node has TWO instructions and they are not
independent: the caption runs at temperature 0.3 to stay factual and the lyrics
at 0.8 or every song rhymes the same way. Shipping either without its numbers
ships something that looks broken (ai-prompt.md #14: a formula without its
settings is half a recipe).

THE SHIPPED SET IS GENERATED, NOT STORED. It is built at request time from
`_music_prompt_formulas.py`, which is itself generated from the probe files that
measured it. There is no `assets/music_prompt_presets.json`, so there is no
second copy to drift.

ALL user sets live in ONE json file. Never one file per set: a set name is user
text, and a name that becomes a filename is the standard route from a save
feature to a path traversal (path-containment.md #1). One known file means no
path is ever built from user input at all.
"""

import json
from ._ai_prompt_helpers import bytes_or_none
import os
import threading

# Reused, not re-rolled: the ok flag in `_read_checked` is what stops a corrupt
# file being read as [] and then overwritten by the next save, which is total
# silent data loss (reference_lazy_store_write_back_destroys_data).
#
# ⚠️ It takes our `normalise` as an argument, and that is not optional. It was
# NOT generic when first reused: it called AI Prompt's own normalise, which wants
# a `formula` where a set has `caption` and `lyrics`, so every entry was dropped
# and the guard reported a file it had just written as unreadable. Verify the
# CONTRACT of a shared function, not just its name.
from ._ai_prompt_presets import MAX_PRESETS, _read_checked
from ._music_prompt_formulas import CAPTION_FORMULA, LYRICS_FORMULA
from ._music_prompt_helpers import CAPTION_SAMPLING, LYRICS_SAMPLING

MAX_NAME = 120
MAX_FORMULA = 20000
MAX_NOTE = 600

# ⚠️ DERIVED, never its own number. `_read_checked` truncates the raw list at
# ITS module's MAX_PRESETS - a function's globals resolve in the module it was
# defined in, not the one calling it - so a separate write-side cap here could
# silently drift above the read-side one. If it ever did, a library that grew
# past the read cap would be read back truncated, and the next save would
# os.replace that shortened list over the real file: everything past the cap
# gone, with ok=True and no error anywhere. Inert while both were 200, which is
# exactly the kind of latent data loss that survives a review.
MAX_SETS = MAX_PRESETS

# What a set carries besides its two formulas. Must match SETTING_KEYS in
# js/music_prompt/core.mjs.
SETTING_KEYS = (
    "caption_temperature", "caption_max_length",
    "lyrics_temperature", "lyrics_max_length",
)

_UNREADABLE = (
    "Your saved formula sets could not be read from %s, so nothing was written - "
    "fixing or moving that file will bring them back. Saving over it would have "
    "destroyed them."
)

# The name of the set that ships with the node. It names the MUSIC model it
# writes for and the LANGUAGE model it was measured on, because both matter.
SHIPPED_NAME = "MiniMax Music 3 (Qwen3.5 4B int8)"
SHIPPED_MODEL = "qwen3.5_4b_int8_convrot.safetensors"
# The size of that file, RECORDED rather than measured off disk.
#
# The picker looks the size up from the user's own models folder when it can,
# but that only ever works for a model they ALREADY have - and the moment
# someone most wants the number is when deciding whether to download it. The
# published file is the same everywhere, so the figure travels with the set.
# The on-disk size still wins when the file is present, so a user who
# re-quantised it sees their own.
SHIPPED_MODEL_BYTES = 5588607110          # 5.2 GB


def user_store_path():
    """<ComfyUI user dir>/pixaroma/music_prompt_presets.json, or None."""
    try:
        import folder_paths
        base = folder_paths.get_user_directory()
    except Exception:
        return None
    if not base:
        return None
    return os.path.join(base, "pixaroma", "music_prompt_presets.json")


def _clean(value, cap):
    return value[:cap] if isinstance(value, str) else ""


def normalise(raw):
    """One set with every field present and bounded, or None if unusable.

    A set with no name, or with neither formula, is DROPPED rather than
    repaired: a nameless entry cannot be picked and an empty one does nothing.
    One formula alone is allowed - somebody may want to change only the lyrics.
    """
    if not isinstance(raw, dict):
        return None
    name = _clean(raw.get("name"), MAX_NAME).strip()
    caption = _clean(raw.get("caption"), MAX_FORMULA)
    lyrics = _clean(raw.get("lyrics"), MAX_FORMULA)
    if not name or not (caption.strip() or lyrics.strip()):
        return None
    settings = {}
    src = raw.get("settings")
    if isinstance(src, dict):
        for key in SETTING_KEYS:
            if key in src:
                settings[key] = src[key]
    return {
        "name": name,
        "note": _clean(raw.get("note"), MAX_NOTE).strip(),
        "model_hint": _clean(raw.get("model_hint"), 200).strip(),
        # Recorded so the row can show a size even when that model is not on
        # disk - which is exactly when someone wants to know. Older stored sets
        # simply have None and show nothing.
        "model_bytes": bytes_or_none(raw.get("model_bytes")),
        "caption": caption,
        "lyrics": lyrics,
        "settings": settings,
    }


def shipped():
    """The measured set, BUILT from the generated formulas rather than stored."""
    return [{
        "name": SHIPPED_NAME,
        "note": "The measured pair. The caption is factual at a low temperature; "
                "the lyrics need a high one or every song rhymes the same way.",
        "model_hint": SHIPPED_MODEL,
        "model_bytes": SHIPPED_MODEL_BYTES,
        "caption": CAPTION_FORMULA,
        "lyrics": LYRICS_FORMULA,
        "settings": {
            "caption_temperature": CAPTION_SAMPLING["temperature"],
            "caption_max_length": CAPTION_SAMPLING["max_length"],
            "lyrics_temperature": LYRICS_SAMPLING["temperature"],
            "lyrics_max_length": LYRICS_SAMPLING["max_length"],
        },
    }]


def load_user():
    items, _ok = _read_checked(user_store_path(), normalise)
    return [x for x in (normalise(i) for i in items) if x]


def user_readable():
    """False ONLY when the file exists and could not be understood."""
    return _read_checked(user_store_path(), normalise)[1]


def _write_user(items):
    path = user_store_path()
    if not path:
        return False, "ComfyUI did not report a user directory, so there is nowhere to save."
    # The temp name carries pid AND thread id: a bare ".tmp" is shared by every
    # writer, so two ComfyUI instances pointed at one user directory can each
    # truncate the other's half-written file and then both replace, landing
    # exactly in the corrupt-file case the read guard exists for
    # (reference_shared_temp_name_needs_thread_id).
    tmp = "%s.%d.%d.tmp" % (path, os.getpid(), threading.get_ident())
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            json.dump({"version": 1, "presets": items}, fh, indent=1,
                      ensure_ascii=False)
        os.replace(tmp, path)   # atomic, so a crashed PROCESS cannot truncate it
        return True, ""
    except Exception as e:
        try:
            if os.path.isfile(tmp):
                os.remove(tmp)
        except Exception:
            pass
        # The real error goes to the CONSOLE, not to the browser. `str(e)` on an
        # OSError embeds the full temp path, which carries the OS username and
        # the install layout, which the browser has no need for. The sibling
        # module made the same call deliberately - its callers say only "Could
        # not write the presets file." - and a maintainer looking at a "cannot
        # save" report reads the ComfyUI log anyway.
        print("[Pixaroma] Music Prompt: could not write %s: %s" % (path, e))
        return False, "Could not write the formula sets file. The ComfyUI console has the reason."


def save_user(raw):
    """Add or replace one set by name. (ok, message)."""
    item = normalise(raw)
    if not item:
        return False, "A set needs a name and at least one instruction."
    if item["name"] == SHIPPED_NAME:
        return False, ("That name belongs to the set that ships with the node. "
                       "Pick another and both will be listed.")
    items, readable = _read_checked(user_store_path(), normalise)
    if not readable:
        return False, _UNREADABLE % (user_store_path() or "the presets file")
    items = [x for x in (normalise(i) for i in items) if x]
    items = [x for x in items if x["name"] != item["name"]]
    if len(items) >= MAX_SETS:
        return False, "That is more saved sets than this is meant to hold."
    items.append(item)
    items.sort(key=lambda x: x["name"].lower())
    return _write_user(items)


def delete_user(name):
    """Remove one of the user's own sets. (ok, message)."""
    name = _clean(name, MAX_NAME).strip()
    if not name:
        return False, "No name given."
    items, readable = _read_checked(user_store_path(), normalise)
    if not readable:
        return False, _UNREADABLE % (user_store_path() or "the presets file")
    items = [x for x in (normalise(i) for i in items) if x]
    left = [x for x in items if x["name"] != name]
    if len(left) == len(items):
        return False, "There is no saved set by that name."
    return _write_user(left)
