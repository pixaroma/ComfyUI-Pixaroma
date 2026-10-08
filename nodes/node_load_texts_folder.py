"""Load Texts from Folder Pixaroma - the .txt files of a folder, one by one.

The partner of Save Text's "One file per entry": captions or prompts saved as
one .txt per picture come back in as a LIST, so the rest of the workflow runs
once per text (OUTPUT_IS_LIST, the same mechanism as Load Images from Folder).

Two ways to use it:
  - nothing wired into `names`: every .txt in the folder, in name order;
  - Load Images from Folder's `filename` wired into `names`: the text that
    belongs to EACH picture (01_Cat -> 01_Cat.txt), in the pictures' order,
    so a picture and its caption travel together. A picture with no .txt gets
    an empty text (and a console note), so the two lists never drift apart.
    INPUT_IS_LIST is what lets the node see the whole name list in one call.

CONTAINMENT: the folder string is attacker-controlled (/prompt is
unauthenticated). All folder logic is in _text_folder_helpers.resolve_folder
(prescreen BEFORE resolve, folder_allowed BEFORE isdir), shared with Caption
Review's route. Only plain .txt files directly inside the folder are read, each
capped at 1 MB. IS_CHANGED is the second entry point and runs the same guard
before any stat.
"""
import hashlib
import os

from ._text_folder_helpers import caption_index, find_caption, list_txt, read_txt, resolve_folder


def _one(v, default):
    """A widget value arrives as a list under INPUT_IS_LIST."""
    if isinstance(v, (list, tuple)):
        v = v[0] if len(v) else default
    return default if v is None else v


def pair_texts(files, names):
    """For each wired name, (text, name), in order; the names with no .txt."""
    exact, clean = caption_index(files)
    rows, missing = [], []
    for n in names:
        n = "" if n is None else str(n)
        p = find_caption(n, exact, clean)
        if p is None:
            missing.append(n)
            rows.append(("", n))
        else:
            rows.append((read_txt(p)[0], n))
    return rows, missing


class PixaromaLoadTextsFolder:
    DESCRIPTION = (
        "Load Texts from Folder Pixaroma - reads the .txt files of a folder and sends them through "
        "the workflow one by one, the way Load Images from Folder does with pictures.\n\n"
        "Type the folder, or click Browse: empty means ComfyUI's output folder, a name like "
        "Training Set means a folder inside output, and a full path works for any folder you "
        "approved with Browse.\n\n"
        "Nothing wired into names: every .txt in the folder, in name order. Wire Load Images from "
        "Folder's filename into names and you get the text that belongs to EACH picture, in the "
        "same order: 01_Cat.png gets 01_Cat.txt. A picture with no text file gets an empty text, "
        "so pictures and texts always stay together.\n\n"
        "Made for the captions and prompts Save Text writes with One file per entry: fix a few by "
        "hand (Caption Review Pixaroma), then Run again with them. Files over 1 MB are skipped."
    )

    INPUT_IS_LIST = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder": ("STRING", {"default": "", "tooltip": "The folder with the .txt files. Empty = ComfyUI's output folder; a name like Training Set = a folder inside output; or a full path to a folder you approved with Browse."}),
            },
            "optional": {
                "names": ("STRING", {"forceInput": True, "tooltip": "Optional. Wire Load Images from Folder's filename here to get the text of EACH picture (01_Cat gets 01_Cat.txt), in the pictures' order."}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "INT", "INT")
    RETURN_NAMES = ("text", "filename", "index", "total")
    OUTPUT_IS_LIST = (True, True, True, True)
    OUTPUT_TOOLTIPS = (
        "Each text in turn. The rest of the workflow runs once per text.",
        "Each text's file name without .txt (or the wired picture name).",
        "Which text this is, counting from 1.",
        "How many texts this Run sends. The same number on every one.",
    )
    FUNCTION = "load"
    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"

    def load(self, folder=None, names=None):
        raw = str(_one(folder, "") or "")
        real, err = resolve_folder(raw)
        if err:
            raise ValueError(err)
        files = list_txt(real)
        wired = list(names) if names else []
        if wired:
            rows, missing = pair_texts(files, wired)
            if missing:
                shown = ", ".join(missing[:5]) + (" ..." if len(missing) > 5 else "")
                print(f"[Pixaroma] Load Texts from Folder: no .txt for {len(missing)} of {len(wired)} picture(s): {shown}")
        else:
            if not files:
                raise ValueError(f"Load Texts from Folder: no .txt files in {real}")
            rows = []
            for s, p in files:
                text, ok = read_txt(p)
                if not ok:
                    print(f"[Pixaroma] Load Texts from Folder: skipped {os.path.basename(p)} (over 1 MB or unreadable)")
                    continue
                rows.append((text, s))
            if not rows:
                raise ValueError(f"Load Texts from Folder: no readable .txt files in {real}")
        texts = [t for t, _ in rows]
        stems = [s for _, s in rows]
        n = len(rows)
        return (texts, stems, list(range(1, n + 1)), [n] * n)

    @classmethod
    def IS_CHANGED(cls, folder=None, names=None):
        # Second entry point: the same guard as load(), BEFORE any stat.
        raw = str(_one(folder, "") or "")
        real, err = resolve_folder(raw)
        if err:
            return "unresolved:" + raw
        h = hashlib.sha256()
        for stem, p in list_txt(real):
            try:
                st = os.stat(p)
                h.update(f"{stem}|{st.st_mtime_ns}|{st.st_size}\n".encode("utf-8", "replace"))
            except OSError:
                h.update(f"{stem}|gone\n".encode("utf-8", "replace"))
        return h.hexdigest()


NODE_CLASS_MAPPINGS = {"PixaromaLoadTextsFolder": PixaromaLoadTextsFolder}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaLoadTextsFolder": "Load Texts from Folder Pixaroma"}
