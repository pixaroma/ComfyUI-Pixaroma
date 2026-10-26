"""Load Image Pixaroma + Load Image Mini: pictures from folders OUTSIDE input.

How it works (built 2026-09-29):
  A picture picked from one of the user's folders is COPIED into
      input/pixaroma_folders/<folder name>_<hash>/<file name>
  and the node holds that ordinary input name. So everything a Load Image
  already does - the preview, the Mask Editor, Copy/Paste (Clipspace), the
  size cards, ComfyUI's own validation, saved workflows - keeps working with
  no change, because to all of it this is just another file in input.

  Next to the copies sits a small note, `.pixaroma_source.json`, naming the
  folder they came from. At Run the node asks `refresh_copy`, which copies the
  original again when it was edited since, so painting over the original in
  another program and pressing Run uses the new picture.

Security (see .claude/patterns/path-containment.md):
  * A folder is readable only when `folder_allowed` says so: ComfyUI's own
    folders, or one the user picked in the operating system's folder dialog.
    Nothing here can approve a folder.
  * Every string that arrives from a request or a prompt is screened with
    `prescreen` BEFORE any filesystem call (a UNC path leaks a Windows password
    hash during the resolve itself), and every child path is checked with
    `rel_is_rooted` + `is_path_under`.
  * The note is re-checked on every use: its folder must still be approved AND
    its hash must match the name of the folder the note sits in, so a note
    written by anyone else cannot point a copy at a different place.
  * Copies are only ever written inside input/pixaroma_folders.
"""

import hashlib
import json
import os
import re
import shutil
import threading

import folder_paths

from ._path_guard import (
    denied_message,
    folder_allowed,
    is_path_under,
    prescreen,
    rel_is_rooted,
    safe_join,
)

FOLDER_PREFIX = "pixaroma_folders"
SIDECAR = ".pixaroma_source.json"
# The same list Load Images from Folder shows (server_routes._LIF_IMAGE_EXTS).
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".tif")

_ANNOTATION = re.compile(r"^(.*?)\s*\[(input|output|temp)\]\s*$", re.IGNORECASE)


def is_image_name(name) -> bool:
    return isinstance(name, str) and name.lower().endswith(IMAGE_EXTS)


def copy_dir_name(parent_real: str) -> str:
    """The folder under input/pixaroma_folders that holds copies from `parent_real`.

    Readable name + a short hash of the full path, so two folders that share a
    name (D:\\Photos and E:\\Photos) never share a copy folder.
    """
    base = os.path.basename(str(parent_real).rstrip("\\/")) or "folder"
    base = re.sub(r"[^A-Za-z0-9 _.-]", "_", base).strip(" .") or "folder"
    key = os.path.normcase(str(parent_real)).encode("utf-8", "surrogatepass")
    return "{}_{}".format(base[:40], hashlib.sha1(key).hexdigest()[:8])


def _split_value(image):
    """(copy_dir, file_name) for a folder-copy value, else None."""
    # A real value is a few hundred characters at most. Refuse anything longer
    # BEFORE the pattern below, which is slow on a long run of spaces - and this
    # runs on every /prompt, where the value is attacker-supplied (review round 1).
    if not isinstance(image, str) or len(image) > 1024:
        return None
    v = image.replace("\\", "/").strip()
    m = _ANNOTATION.match(v)
    if m:
        if m.group(2).lower() != "input":
            return None
        v = m.group(1)
    parts = v.split("/")
    if len(parts) != 3 or parts[0] != FOLDER_PREFIX or not parts[1] or not parts[2]:
        return None
    if parts[1] in (".", "..") or parts[2] in (".", ".."):
        return None
    return parts[1], parts[2]


def _tmp_name(dest: str) -> str:
    # pid + thread: two runs at once must never share a temp file.
    return "{}.tmp-{}-{}".format(dest, os.getpid(), threading.get_ident())


def _copy_if_changed(src: str, dest: str) -> bool:
    """Copy src over dest unless dest already matches it (size + mtime).
    Returns True when a copy was made. Raises on a real I/O failure."""
    st = os.stat(src)
    try:
        dt = os.stat(dest)
        if dt.st_size == st.st_size and int(dt.st_mtime) == int(st.st_mtime):
            return False
    except OSError:
        pass
    tmp = _tmp_name(dest)
    try:
        shutil.copy2(src, tmp)          # copy2 keeps the mtime, which the test above reads
        os.replace(tmp, dest)
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
    return True


def _write_note(dest_dir: str, parent_real: str) -> None:
    note = os.path.join(dest_dir, SIDECAR)
    try:
        with open(note, encoding="utf-8") as f:
            if json.load(f).get("source") == parent_real:
                return
    except Exception:
        pass
    tmp = _tmp_name(note)
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(json.dumps({
            "source": parent_real,
            "about": "Written by Load Image Pixaroma. The pictures in this folder are "
                     "copies from the source folder, refreshed when you press Run.",
        }, indent=2))
    os.replace(tmp, note)


def import_file(folder, rel):
    """Copy one picture from an approved folder into input.

    `folder` is the folder the picker listed, `rel` the file's path inside it
    (both straight from a request, so both untrusted). Returns
    (value, None) on success, value being the input name the node should hold,
    or (None, message) on refusal. Refusals never say whether a path exists.
    """
    if not isinstance(folder, str) or not isinstance(rel, str) or not folder or not rel:
        return None, "No picture was given."
    # prescreen BEFORE anything touches the filesystem (UNC leak), then the
    # allowlist, then the child check - the order is the invariant.
    if not prescreen(folder) or not folder_allowed(folder):
        return None, denied_message(folder)
    if rel_is_rooted(rel):
        return None, "That picture is not inside the folder."
    if not os.path.isdir(folder):
        return None, "Folder not found."
    real_folder = os.path.realpath(folder)
    # Checked as the folder shows it, before resolving: a junction or symlink
    # the user placed INSIDE the folder is followed (is_path_under follow_links).
    joined = os.path.abspath(os.path.join(real_folder, rel))
    full = os.path.realpath(joined)
    # The picture test on BOTH names: the shown one names the copy, the real one
    # is what gets copied (an 8.3 "SECRET~1.PNG" is really "secret notes.pngx").
    if (not is_path_under(joined, real_folder, follow_links=True) or not os.path.isfile(full)
            or not is_image_name(os.path.basename(joined))
            or not is_image_name(os.path.basename(full))):
        return None, "That picture is not inside the folder."
    # The copy folder is named after the REAL place (unchanged for every plain
    # picture); the note keeps the path inside the approved folder, because
    # that is what source_for's folder_allowed can approve when it is a link.
    shown_parent = os.path.dirname(joined)
    value = "{}/{}/{}".format(FOLDER_PREFIX, copy_dir_name(os.path.realpath(shown_parent)),
                              os.path.basename(joined))
    input_dir = folder_paths.get_input_directory()
    dest = safe_join(input_dir, value)
    if not dest:
        return None, "Could not place the copy inside ComfyUI's input folder."
    try:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        _write_note(os.path.dirname(dest), shown_parent)
        _copy_if_changed(full, dest)
    except Exception as e:
        return None, "Could not copy the picture: {}".format(e)
    return value, None


def source_for(image):
    """The original file a folder copy came from, or None. Read-only, never raises."""
    try:
        split = _split_value(image)
        if not split:
            return None
        dir_name, file_name = split
        input_dir = folder_paths.get_input_directory()
        copy_path = safe_join(input_dir, "{}/{}/{}".format(FOLDER_PREFIX, dir_name, file_name))
        if not copy_path:
            return None
        with open(os.path.join(os.path.dirname(copy_path), SIDECAR), encoding="utf-8") as f:
            src_dir = json.load(f).get("source")
        if not isinstance(src_dir, str) or not src_dir:
            return None
        if not prescreen(src_dir):
            return None
        # lexical first, so the string folder_allowed judges is the one realpath
        # resolves (a note can be planted through core's /upload/image; on Linux /
        # macOS a raw "pics/faces/../Documents" read outside, review round 1)
        src_dir = os.path.abspath(src_dir)
        if not folder_allowed(src_dir, follow_links=True):
            return None
        real_dir = os.path.realpath(src_dir)
        # The note must belong to the folder it sits in: its hash is part of
        # that folder's name, so a note copied or written elsewhere cannot
        # redirect a copy to a different source.
        if copy_dir_name(real_dir) != dir_name:
            return None
        if rel_is_rooted(file_name) or not is_image_name(file_name):
            return None
        joined = os.path.join(real_dir, file_name)
        src = os.path.realpath(joined)
        # the REAL name must be a picture too: a crafted value's 8.3 "SECRET~1.PNG"
        # is really "secret notes.pngx" (the same test import_file makes)
        if (not is_path_under(joined, real_dir, follow_links=True) or not os.path.isfile(src)
                or not is_image_name(os.path.basename(src))):
            return None
        return src
    except Exception:
        return None


def refresh_copy(image) -> bool:
    """At Run: copy the original again if it changed. True when a copy was made.
    Never raises - on any problem the existing copy is used as it is."""
    try:
        src = source_for(image)
        if not src:
            return False
        dir_name, file_name = _split_value(image)
        dest = safe_join(folder_paths.get_input_directory(),
                         "{}/{}/{}".format(FOLDER_PREFIX, dir_name, file_name))
        if not dest:
            return False
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        return _copy_if_changed(src, dest)
    except Exception as e:
        print("[Pixaroma] could not refresh a folder copy, using the copy as it is: {}".format(e))
        return False


def source_stamp(image) -> str:
    """Size + mtime of the original, for IS_CHANGED; "" when there is none."""
    src = source_for(image)
    if not src:
        return ""
    try:
        st = os.stat(src)
        return "{}:{}".format(st.st_size, st.st_mtime_ns)
    except OSError:
        return ""
