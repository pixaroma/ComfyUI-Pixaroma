"""Shared font catalog: builtin bundle + user drop-in fonts (models/fonts/).

Pure-Python (no aiohttp, no comfy execution context). Imported by
server_routes.py (the /pixaroma/api/fonts/* routes) and
nodes/_text_render_helpers.py (the PIL final render). Single source of truth
for the builtin BUNDLE and the custom-font scanner so the editor preview and
the saved image always agree.

`folder_paths` is imported lazily (inside the dir resolvers) so this module
stays importable outside ComfyUI for scripts/font_catalog_check.py.
"""
from __future__ import annotations
import os
import re
from pathlib import Path
from PIL import ImageFont

_PLUGIN_ROOT = Path(__file__).resolve().parent.parent
BUILTIN_FONTS_DIR = _PLUGIN_ROOT / "assets" / "fonts"

# (file, id, weight, italic, label, category, wght_axis|None)
BUNDLE = [
    ("Inter-Variable.ttf",                  "Inter",            400, False, "Inter",            "sans",        400),
    ("Inter-Variable.ttf",                  "Inter",            700, False, "Inter",            "sans",        700),
    ("Roboto-Variable.ttf",                 "Roboto",           400, False, "Roboto",           "sans",        400),
    ("Roboto-Variable.ttf",                 "Roboto",           700, False, "Roboto",           "sans",        700),
    ("Montserrat-Variable.ttf",             "Montserrat",       400, False, "Montserrat",       "sans",        400),
    ("Montserrat-Variable.ttf",             "Montserrat",       800, False, "Montserrat",       "sans",        800),
    ("Oswald-Variable.ttf",                 "Oswald",           600, False, "Oswald",           "sans",        600),
    ("PlayfairDisplay-Variable.ttf",        "PlayfairDisplay",  700, False, "Playfair Display", "serif",       700),
    ("PlayfairDisplay-Italic-Variable.ttf", "PlayfairDisplay",  700, True,  "Playfair Display", "serif",       700),
    ("Lora-Variable.ttf",                   "Lora",             400, False, "Lora",             "serif",       400),
    ("Lora-Variable.ttf",                   "Lora",             700, False, "Lora",             "serif",       700),
    ("BebasNeue-Regular.ttf",               "BebasNeue",        400, False, "Bebas Neue",       "display",     None),
    ("Anton-Regular.ttf",                   "Anton",            400, False, "Anton",            "display",     None),
    ("Caveat-Variable.ttf",                 "Caveat",           500, False, "Caveat",           "handwriting", 500),
    ("JetBrainsMono-Variable.ttf",          "JetBrainsMono",    500, False, "JetBrains Mono",   "mono",        500),
]

CAT_ORDER = ["sans", "serif", "display", "handwriting", "mono", "custom"]

_ID_RE = re.compile(r"[^A-Za-z0-9_-]+")


def _sanitize_id(name: str) -> str:
    s = _ID_RE.sub("-", (name or "").strip()).strip("-")
    return s or "Font"


def derive_weight(style: str) -> int:
    """Map a font's style-name string to a numeric weight. Most-specific
    keywords are checked first so 'semibold'/'extrabold'/'extralight' win
    over the substrings 'bold'/'light'."""
    s = (style or "").lower().replace(" ", "").replace("-", "").replace("_", "")
    table = [
        ("thin", 100),
        ("extralight", 200), ("ultralight", 200),
        ("light", 300),
        ("medium", 500),
        ("semibold", 600), ("demibold", 600),
        ("extrabold", 800), ("ultrabold", 800),
        ("black", 900), ("heavy", 900),
        ("bold", 700),
        ("regular", 400), ("normal", 400), ("book", 400),
    ]
    for kw, w in table:
        if kw in s:
            return w
    return 400


def derive_italic(style: str) -> bool:
    s = (style or "").lower()
    return "italic" in s or "oblique" in s


def _font_dirs() -> list:
    """All registered 'fonts' dirs (honors extra_model_paths.yaml). The first
    entry is the default ComfyUI/models/fonts/. folder_paths is imported here
    (lazily) so this module imports cleanly outside ComfyUI."""
    try:
        import folder_paths
        try:
            folder_paths.get_folder_paths("fonts")
        except KeyError:
            folder_paths.add_model_folder_path(
                "fonts", os.path.join(folder_paths.models_dir, "fonts")
            )
        return list(folder_paths.get_folder_paths("fonts"))
    except Exception:
        return []


def get_custom_fonts_dir() -> str:
    """Resolve AND ensure the primary drop-in fonts dir. Used by server_routes
    at import time so the folder always exists for the user to drop files in."""
    dirs = _font_dirs()
    primary = dirs[0] if dirs else os.path.join(
        os.path.dirname(_PLUGIN_ROOT.parent), "models", "fonts"
    )
    os.makedirs(primary, exist_ok=True)
    return primary


def resolve_custom_file(filename: str) -> str | None:
    """Return the absolute path of a custom font file across all registered
    fonts dirs, with a realpath-under-dir traversal guard. None if not found."""
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        return None
    for d in _font_dirs():
        dreal = os.path.realpath(d)
        cand = os.path.realpath(os.path.join(dreal, filename))
        if (cand == dreal or cand.startswith(dreal + os.sep)) and os.path.isfile(cand):
            return cand
    return None


def builtin_catalog() -> list:
    grouped = {}
    for filename, font_id, weight, italic, label, category, wght in BUNDLE:
        if not (BUILTIN_FONTS_DIR / filename).is_file():
            continue
        bucket = grouped.setdefault(font_id, {
            "id": font_id, "label": label, "category": category,
            "source": "builtin", "weights": [],
        })
        entry = {"weight": weight, "italic": italic, "file": filename}
        if wght is not None:
            entry["wght"] = wght
        bucket["weights"].append(entry)
    return list(grouped.values())


def scan_custom_dirs(dirs) -> list:
    """Scan dirs for .ttf/.otf, group by the font's internal family name,
    derive weight + italic from its internal style name. category/source
    = 'custom'. Unreadable files are skipped with a warning."""
    grouped = {}
    for d in dirs:
        dd = Path(d)
        if not dd.is_dir():
            continue
        for p in sorted(dd.iterdir(), key=lambda x: x.name.lower()):
            if not p.is_file() or p.suffix.lower() not in (".ttf", ".otf"):
                continue
            try:
                family, style = ImageFont.truetype(str(p)).getname()
            except Exception as e:
                print(f"[Pixaroma] skipping unreadable font {p.name}: {e}")
                continue
            family = (family or p.stem).strip()
            weight = derive_weight(style)
            italic = derive_italic(style)
            bucket = grouped.setdefault(family, {
                "id": None, "label": family, "category": "custom",
                "source": "custom", "_family": family, "weights": [],
            })
            if any(w["weight"] == weight and w["italic"] == italic
                   for w in bucket["weights"]):
                continue
            bucket["weights"].append({"weight": weight, "italic": italic, "file": p.name})
    return list(grouped.values())


_cache = {"fingerprint": None, "custom": None}


def _fingerprint(dirs) -> tuple:
    out = []
    for d in dirs:
        dd = Path(d)
        if not dd.is_dir():
            continue
        for p in sorted(dd.iterdir(), key=lambda x: x.name.lower()):
            if p.is_file() and p.suffix.lower() in (".ttf", ".otf"):
                st = p.stat()
                out.append((str(dd), p.name, st.st_mtime_ns, st.st_size))
    return tuple(out)


def custom_catalog(dirs) -> list:
    fp = _fingerprint(dirs)
    if _cache["fingerprint"] == fp and _cache["custom"] is not None:
        return _cache["custom"]
    cat = scan_custom_dirs(dirs)
    n = sum(len(f["weights"]) for f in cat)
    if n > 500:
        print(f"[Pixaroma] {n} custom font files found; large folders may slow the picker.")
    _cache["fingerprint"] = fp
    _cache["custom"] = cat
    return cat


def invalidate() -> None:
    _cache["fingerprint"] = None
    _cache["custom"] = None


def _assign_ids_and_sort(builtin, custom) -> list:
    used = {f["id"] for f in builtin}
    for f in custom:
        base = _sanitize_id(f.get("_family") or f["label"])
        fid, n = base, 2
        while fid in used:
            fid = f"{base}-{n}"
            n += 1
        f["id"] = fid
        used.add(fid)
        f.pop("_family", None)
    allf = builtin + custom
    allf.sort(key=lambda f: (
        CAT_ORDER.index(f["category"]) if f["category"] in CAT_ORDER else 99,
        f["label"].lower(),
    ))
    return allf


def full_catalog(refresh: bool = False) -> list:
    """Merged builtin + custom catalog, builtins first, custom under 'custom'.
    Each font carries 'source'. Custom entries get a collision-safe id."""
    if refresh:
        invalidate()
    builtin = builtin_catalog()
    custom = [dict(f) for f in custom_catalog(_font_dirs())]  # copy: don't mutate cache
    return _assign_ids_and_sort(builtin, custom)
