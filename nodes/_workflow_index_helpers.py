"""Pixaroma Workflows - reading the workflow folder.

Pure helpers, no ComfyUI imports, so they can be tested on their own
(harness: D:\\Claude Tests\\_workflow_index_test.py).

Everything the browser shows beyond a filename comes from here: what a workflow
contains, a tiny map of its graph for the cover, which files look like junk or
duplicates, and the collections that fill themselves.

Reading 144 files is done ONCE and cached against each file's modified-time and
size, so a second open re-parses only what actually changed. The browser never
fetches the files itself.
"""

import hashlib
import json
import os
import re
import threading
from collections import deque

# Files bigger than this are almost certainly not a hand-made workflow, and
# parsing one blocks the request. 24 MB is far above the largest real workflow
# seen in the wild (the biggest in the author's own folder is 75 KB).
_MAX_BYTES = 24 * 1024 * 1024

# How many node rectangles the cover map carries. A cover is ~120x64 CSS pixels,
# so past a few dozen boxes nothing more is legible and the payload just grows.
_MAP_CAP = 60

# Total prompt text kept per workflow, for searching. Enough to find a phrase
# somebody remembers; small enough that 144 of them stay a light payload.
_TEXT_CAP = 2000

# Bumped whenever an entry's SHAPE changes, so a cache written by an older
# version is thrown away instead of being replayed into code that no longer
# understands it (v2: the cover map carries a colour string, not a palette index).
_CACHE_VERSION = 2

_MODEL_EXT = (".safetensors", ".ckpt", ".gguf", ".pt", ".pth", ".sft", ".bin")

# Widget strings on these classes are treated as prompt text worth searching.
_TEXTY = ("cliptextencode", "text", "prompt", "string")

# ── collection rules ─────────────────────────────────────────────────────────
# One table, so a new grouping is a data change rather than a code change. Each
# kind is (id, label, predicate over the entry). Order matters: the first
# matching "output kind" wins, so a video workflow is not also filed as
# text-to-image just because it has a sampler in it.

def _has(entry, *needles):
    """True when any node class in this workflow contains one of the needles."""
    low = entry.get("_lower_types") or []
    return any(any(n in t for t in low) for n in needles)


def _kind_video(e):
    return _has(e, "savemp4", "vhs_", "savewebm", "videocombine", "imagetovideo",
                "svd_", "animatediff", "wanimage", "saveanimated")


def _kind_upscale(e):
    return _has(e, "upscalemodel", "imagescale", "upscale")


def _kind_inpaint(e):
    return _has(e, "inpaint", "setlatentnoisemask", "outpaint")


def _kind_img2img(e):
    return _has(e, "vaeencode", "loadimage") and _has(e, "sampler")


def _kind_txt2img(e):
    return _has(e, "sampler") and _has(e, "cliptextencode", "textencode")


# Checked in this order; a workflow lands in the FIRST one that matches, so the
# most specific description of what it makes wins.
_KINDS = [
    ("video", "Video", _kind_video),
    ("inpaint", "Inpaint / Outpaint", _kind_inpaint),
    ("upscale", "Upscale", _kind_upscale),
    ("img2img", "Image to Image", _kind_img2img),
    ("txt2img", "Text to Image", _kind_txt2img),
]

# Model families, matched against the model filenames found in the workflow.
_FAMILIES = [
    ("flux", "Flux", ("flux",)),
    ("qwen", "Qwen", ("qwen",)),
    ("wan", "Wan", ("wan",)),
    ("sdxl", "SDXL", ("sdxl", "sd_xl")),
    ("sd15", "SD 1.5", ("sd15", "v1-5", "sd_v1")),
    ("sd3", "SD 3", ("sd3", "sd_3")),
    ("hunyuan", "Hunyuan", ("hunyuan",)),
    ("krea", "Krea", ("krea",)),
    ("chroma", "Chroma", ("chroma",)),
]


# ── small utilities ──────────────────────────────────────────────────────────

def _is_under(child, parent):
    """True when child sits inside parent. Compares both the collapsed path and
    the resolved one, so a workflows folder reached through a junction (a common
    split-across-drives setup) is still accepted, while '..' cannot escape."""
    try:
        c_abs, p_abs = os.path.abspath(child), os.path.abspath(parent)
        if os.path.commonpath([c_abs, p_abs]) == p_abs:
            return True
    except ValueError:
        pass
    try:
        c_real, p_real = os.path.realpath(child), os.path.realpath(parent)
        return os.path.commonpath([c_real, p_real]) == p_real
    except ValueError:
        return False


def _rel(path, root):
    return os.path.relpath(path, root).replace(os.sep, "/")


def walk_following(root):
    """os.walk that descends into symlinked folders without ever looping.

    A symlink (or junction) inside the workflows folder - to a second drive, a
    sync folder, or a shared library - is a real folder to the user, and plain
    os.walk skips it: its contents went unindexed and the folder itself never
    appeared in the browser's tree.

    followlinks=True on its own can spin forever when a link points back at an
    ancestor, so each directory is visited at most once by REAL path. That also
    means two links to the same target are indexed once, under whichever one
    the walk reaches first - indexing the same files twice under two names
    would just invent duplicates.
    """
    seen = set()

    def _claim(path):
        try:
            real = os.path.realpath(path)
        except OSError:
            return False
        if real in seen:
            return False
        seen.add(real)
        return True

    _claim(root)
    for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
        dirnames[:] = [d for d in dirnames if _claim(os.path.join(dirpath, d))]
        yield dirpath, dirnames, filenames


def _num(v, default=0.0):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    # A workflow written by a broken exporter can carry inf/nan, which would
    # serialise to invalid JSON and break the whole response.
    if f != f or f in (float("inf"), float("-inf")):
        return default
    return f


def _xy(v):
    """Node pos/size is a 2-list in modern files and a {"0":x,"1":y} dict in
    some older ones. Accept both rather than dropping the node from the map."""
    if isinstance(v, dict):
        return _num(v.get("0") if "0" in v else v.get(0)), _num(v.get("1") if "1" in v else v.get(1))
    if isinstance(v, (list, tuple)) and len(v) >= 2:
        return _num(v[0]), _num(v[1])
    return 0.0, 0.0


_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def _node_color(color):
    """The node's OWN colour, as a plain hex string, or "" when it has none.

    This used to be a hash of the colour into a fixed 8-swatch palette, which
    meant a green node could be drawn brown - the cover looked arbitrary
    because it WAS arbitrary. The real colour is carried instead, and the
    browser lifts it to a readable brightness (ComfyUI node colours are
    near-black, being title tints on a dark canvas, so drawing them literally
    gives an unreadable cover).

    Anything that is not a plain hex value - `rgba(0,0,0,0)`, a css name, junk
    from a hand-edited file - becomes "" rather than being passed through, so
    the drawing code only ever has one shape to deal with.
    """
    if not isinstance(color, str):
        return ""
    c = color.strip()
    return c.lower() if _HEX_RE.match(c) else ""


def _clamp01(v):
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def _walk_strings(widgets):
    """Widget values can nest (lists, dicts) depending on the node. Yield every
    string found, so a model filename is not missed because of its shape."""
    # TWO separate limits, because one number could not do both jobs.
    #
    # Counting only POPS bounded nothing: a flat list of a million strings was a
    # single pop plus one extend. Spending the SAME budget on pushes then broke
    # it the other way - a big list used the whole allowance queueing items and
    # the loop exited before yielding any of them, so models and prompt text
    # came back empty. (Caught by a mutation test, not by reading it.)
    #
    # So: visits bound the WORK, the queue length bounds the MEMORY, and the
    # queue is FIFO so a truncated walk keeps the EARLIEST values - widget slot
    # 0 is where a model filename lives, and dropping that first was backwards.
    MAX_VISIT = 2000
    MAX_QUEUE = 2000
    queue = deque([widgets])
    visited = 0
    while queue and visited < MAX_VISIT:
        cur = queue.popleft()
        visited += 1
        if isinstance(cur, str):
            yield cur
            continue
        if isinstance(cur, dict):
            items = cur.values()
        elif isinstance(cur, (list, tuple)):
            items = cur
        else:
            continue
        for v in items:
            if len(queue) >= MAX_QUEUE:
                break
            queue.append(v)


# ── one workflow ─────────────────────────────────────────────────────────────

def summarize_workflow(path, root):
    """Everything the browser needs about one workflow file.

    Never raises. A file that is missing, too big, outside the root, or not
    valid JSON comes back with an "error" set and empty everything else, so one
    bad file cannot take out the whole listing.
    """
    name = os.path.splitext(os.path.basename(path))[0]
    blank = {
        "name": name, "rel": _rel(path, root) if root else os.path.basename(path),
        "folder": "", "size": 0, "modified": 0.0, "node_count": 0,
        "class_types": [], "models": [], "loras": [], "text": "",
        "map": [], "fingerprint": "", "error": None,
    }

    if root and not _is_under(path, root):
        blank["error"] = "outside the workflows folder"
        return blank

    try:
        st = os.stat(path)
    except OSError as e:
        blank["error"] = "cannot read: %s" % e.__class__.__name__
        return blank

    blank["size"] = st.st_size
    blank["modified"] = st.st_mtime
    rel = _rel(path, root)
    blank["rel"] = rel
    blank["folder"] = os.path.dirname(rel)

    if st.st_size > _MAX_BYTES:
        blank["error"] = "file is too large to read"
        return blank

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except RecursionError:
        # A few KB of nested brackets is enough. RecursionError is a
        # RuntimeError, so the three types above do not cover it.
        blank["error"] = "this file is nested too deeply to read"
        return blank
    except (OSError, ValueError, UnicodeDecodeError) as e:
        blank["error"] = "not a readable workflow: %s" % e.__class__.__name__
        return blank

    if not isinstance(data, dict):
        blank["error"] = "not a workflow file"
        return blank

    nodes = data.get("nodes")
    if not isinstance(nodes, list):
        blank["error"] = "no nodes in this file"
        return blank

    types, lower, models, loras, texts, boxes = [], [], [], [], [], []
    for n in nodes:
        if not isinstance(n, dict):
            continue
        t = n.get("type")
        # `(t or "").lower()` looks safe and is not: Python's `or` returns the
        # truthy operand, so "type": true or "type": 7 reached .lower() and
        # raised, taking the whole folder listing down with one bad file.
        t = t if isinstance(t, str) else ""
        if t:
            types.append(t)
            lower.append(t.lower())
        tl = t.lower()

        widgets = n.get("widgets_values")
        if widgets is not None:
            is_lora = "lora" in tl
            texty = any(k in tl for k in _TEXTY)
            for s in _walk_strings(widgets):
                low = s.lower()
                if low.endswith(_MODEL_EXT):
                    (loras if is_lora else models).append(s)
                elif texty and len(s) > 8:
                    texts.append(s)

        x, y = _xy(n.get("pos"))
        w, h = _xy(n.get("size"))
        boxes.append((x, y, w if w > 0 else 200.0, h if h > 0 else 80.0,
                      _node_color(n.get("color"))))

    # ── the cover map: node rectangles normalised into a 0..1 box ──
    cover = []
    if boxes:
        keep = boxes[:_MAP_CAP]
        min_x = min(b[0] for b in keep)
        min_y = min(b[1] for b in keep)
        max_x = max(b[0] + b[2] for b in keep)
        max_y = max(b[1] + b[3] for b in keep)
        span_x = max_x - min_x
        span_y = max_y - min_y
        # A single node, or every node stacked at one point, gives a zero span.
        if span_x <= 0:
            span_x = 1.0
        if span_y <= 0:
            span_y = 1.0
        for (x, y, w, h, col) in keep:
            cover.append([
                round(_clamp01((x - min_x) / span_x), 4),
                round(_clamp01((y - min_y) / span_y), 4),
                round(_clamp01(w / span_x), 4),
                round(_clamp01(h / span_y), 4),
                col,
            ])

    uniq_types = sorted(set(types))
    uniq_models = sorted(set(models))
    uniq_loras = sorted(set(loras))

    # Same shape of graph + same models = the same workflow wearing two names.
    # Deliberately ignores prompt text and node positions, which is what makes
    # it useful for spotting the copies people accumulate.
    # Serialised rather than joined on a separator. A filename containing the
    # separator could otherwise produce the same string as a different set split
    # differently, and telling workflows apart is this hash's only job. Escaping
    # by hand was the first attempt and introduced an invalid escape sequence;
    # json has one correct answer and no way to get it subtly wrong.
    fp_src = json.dumps([sorted(types), uniq_models, uniq_loras], separators=(",", ":"))
    fingerprint = hashlib.md5(fp_src.encode("utf-8")).hexdigest() if types else ""

    text = " ".join(texts)
    if len(text) > _TEXT_CAP:
        text = text[:_TEXT_CAP]

    blank.update({
        "node_count": len(nodes),
        "class_types": uniq_types,
        "models": uniq_models,
        "loras": uniq_loras,
        "text": text,
        "map": cover,
        "fingerprint": fingerprint,
    })
    return blank


# ── the whole folder ─────────────────────────────────────────────────────────

def _cache_key(st):
    return [st.st_mtime_ns, st.st_size]


def _load_cache(cache_path):
    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            c = json.load(f)
        if isinstance(c, dict) and c.get("version") == _CACHE_VERSION and isinstance(c.get("entries"), dict):
            return c["entries"]
    except (OSError, ValueError, UnicodeDecodeError):
        pass
    return {}


def _save_cache(cache_path, entries):
    """Written to a temp file and moved into place, so a crash or a full disk
    part-way through leaves the previous cache intact rather than a broken one
    that then has to be detected and thrown away on every future open."""
    # The temp name carries the thread id: this runs in a thread executor, and a
    # single shared "<cache>.tmp" meant two overlapping builds wrote into the
    # same file and produced a torn one.
    tmp = "%s.%d.tmp" % (cache_path, threading.get_ident())
    try:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"version": _CACHE_VERSION, "entries": entries}, f)
        os.replace(tmp, cache_path)
    except OSError:
        try:
            os.remove(tmp)
        except OSError:
            pass


def build_index(root, cache_path):
    """Summarise every .json under root, re-reading only files whose modified
    time or size changed since last time. Returns a list of entries."""
    old = _load_cache(cache_path)
    new_entries = {}
    out = []

    for dirpath, dirnames, filenames in walk_following(root):
        # Skip anything hidden, and ComfyUI's own bookkeeping.
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fn in filenames:
            if not fn.lower().endswith(".json") or fn.startswith("."):
                continue
            full = os.path.join(dirpath, fn)
            rel = _rel(full, root)
            try:
                key = _cache_key(os.stat(full))
            except OSError:
                continue
            hit = old.get(rel)
            if hit and hit.get("key") == key and isinstance(hit.get("data"), dict):
                data = hit["data"]
            else:
                # summarize_workflow is written not to raise, but this listing is
                # the whole feature: a single unreadable file must not be able to
                # empty it, including through a bug introduced here later.
                try:
                    data = summarize_workflow(full, root)
                except Exception as e:            # noqa: BLE001 - deliberate
                    data = {
                        "name": os.path.splitext(fn)[0], "rel": rel,
                        "folder": os.path.dirname(rel), "size": 0, "modified": 0.0,
                        "node_count": 0, "class_types": [], "models": [], "loras": [],
                        "text": "", "map": [], "fingerprint": "",
                        "error": "could not be read: %s" % e.__class__.__name__,
                    }
            new_entries[rel] = {"key": key, "data": data}
            out.append(data)

    _save_cache(cache_path, new_entries)
    out.sort(key=lambda e: (e.get("folder", ""), e.get("name", "").lower()))
    return out


# ── what is wrong with this folder ───────────────────────────────────────────

# Node types the FRONTEND registers, which therefore never appear in Python's
# NODE_CLASS_MAPPINGS. Without this, every workflow containing a sticky note
# looks broken - it flagged 108 of one user's 143 workflows on the first run.
#
# This list only covers ComfyUI's own; a custom pack can register frontend-only
# nodes too (rgthree does), which is why the BROWSER recomputes this against
# LiteGraph.registered_node_types and overrides whatever comes from here. Treat
# the value below as a fallback, not the answer.
_FRONTEND_ONLY = frozenset({
    "Note", "MarkdownNote", "PrimitiveNode", "Reroute", "GroupNode",
})


# ── name and file checks ─────────────────────────────────────────────────────
# Pure, so they live here rather than in server_routes.py where nothing can
# import them to test them. Both guard a WRITE, which is exactly the sort of
# thing that should have a check watching it.

# CON, NUL, COM1 and the rest name a DEVICE on Windows, not a file, at any
# extension - so "NUL" and "NUL.json" both fail, and the failure arrives as an
# unhelpful OSError from deep inside the write.
WIN_RESERVED_NAMES = frozenset({
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
})

# The leading bytes of the picture formats a browser will actually draw.
_IMAGE_MAGIC = (
    b"\xff\xd8\xff",                    # jpeg
    b"\x89PNG\r\n\x1a\n",               # png
    b"GIF87a", b"GIF89a",               # gif
    b"BM",                              # bmp
)


def looks_like_image(raw):
    """True when these bytes begin like a picture a browser can show.

    A cover is served straight back to the browser as an image, so it should be
    one. Checking costs nothing and turns a mistyped upload into a sentence the
    user can act on, instead of a card that silently never renders."""
    if not isinstance(raw, (bytes, bytearray)):
        return False
    raw = bytes(raw)
    if raw.startswith(_IMAGE_MAGIC):
        return True
    if len(raw) < 12:
        return False
    # webp is RIFF....WEBP - the byte length sits between the two markers, so
    # the prefix alone is not enough (a wav file also starts RIFF).
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return True
    # avif and heic are ISO-BMFF: a length, then "ftyp", then the brand. The
    # cover picker asks for image/*, and phone photos are routinely avif/heic,
    # so leaving them out would reject a perfectly ordinary picture.
    return raw[4:8] == b"ftyp" and raw[8:12] in (
        b"avif", b"avis", b"heic", b"heix", b"hevc", b"mif1", b"msf1",
    )


# A cover filename is ALWAYS 16 hex characters and .jpg, because we generate it
# ourselves from the workflow path. Anything else did not come from us.
_COVER_NAME_RE = re.compile(r"[0-9a-f]{16}\.jpg")


def is_cover_name(name):
    """Is this a filename we could have written?

    Load-bearing for SAFETY, not tidiness. The sidecar is written from a plain
    HTTP body, so a cover record's "file" is whatever the client sent - and the
    clear path feeds it to os.remove. Without this, setting a cover's file to
    "../../something" and then clearing that key deleted an arbitrary file
    anywhere the ComfyUI process could reach. os.path.join is no defence: it
    DISCARDS the base directory when the second part is absolute."""
    return isinstance(name, str) and bool(_COVER_NAME_RE.fullmatch(name))


def reserved_part(root, path):
    """The first segment of `path` below `root` that Windows keeps for itself,
    or None. Checked on every platform: a folder made on Linux still has to open
    on the Windows machine those workflows may later be copied to.

    Deliberately PURE STRING work, no os.path. The obvious implementation began
    `os.path.relpath(path, root)` and it failed open on the single most likely
    input: ntpath resolves a bare "NUL" to the device mount \\\\.\\NUL, decides
    the two paths are on different mounts and raises ValueError - so the guard
    returned None for exactly the name it exists to catch. ("NUL.json" was
    caught, which is what made it look like it worked.) Nothing here may call a
    path function, because the whole point is that these names make path
    functions behave strangely."""
    r = str(root or "").replace("\\", "/").rstrip("/")
    p = str(path or "").replace("\\", "/")
    # Strip the root, so a root that itself contains a reserved word (possible
    # on Linux: /home/con/workflows) does not refuse every name underneath it.
    # If the two are unrelated, scan the whole path: refusing too much is a
    # message, letting a device name through is a failed write.
    if r and p.lower().startswith(r.lower() + "/"):
        p = p[len(r) + 1:]
    elif r and p.lower() == r.lower():
        return None
    for part in p.split("/"):
        stem = part.split(".", 1)[0].strip().upper()
        if stem in WIN_RESERVED_NAMES:
            return part
    return None


def detect_issues(index, registered_types):
    """The three things worth telling someone about their workflow folder."""
    unsaved, missing = [], []
    by_fp = {}

    for e in index:
        if e.get("error"):
            continue
        if e.get("name", "").lower().startswith("unsaved workflow"):
            unsaved.append({"rel": e["rel"], "name": e["name"]})

        gone = sorted(t for t in e.get("class_types", [])
                      if t not in registered_types and t not in _FRONTEND_ONLY)
        if gone:
            missing.append({"rel": e["rel"], "name": e["name"], "missing": gone})

        fp = e.get("fingerprint")
        if fp:
            by_fp.setdefault(fp, []).append(e)

    duplicates = [g for g in by_fp.values() if len(g) > 1]
    duplicates.sort(key=lambda g: -len(g))
    return {"unsaved_names": unsaved, "duplicates": duplicates, "missing_nodes": missing}


# ── collections that fill themselves ─────────────────────────────────────────

def collections(index):
    """Group workflows by what they make and which model they use, read out of
    the files themselves. Real folders are untouched; these sit alongside."""
    kinds = {}
    families = {}
    lora_items = []

    for e in index:
        if e.get("error"):
            continue
        e["_lower_types"] = [t.lower() for t in e.get("class_types", [])]
        try:
            for kid, label, pred in _KINDS:
                if pred(e):
                    kinds.setdefault(kid, {"label": label, "items": []})["items"].append(e["rel"])
                    break

            if e.get("loras"):
                lora_items.append(e["rel"])

            hit = set()
            for m in e.get("models", []) + e.get("loras", []):
                low = m.lower()
                for fid, label, needles in _FAMILIES:
                    if fid not in hit and any(n in low for n in needles):
                        hit.add(fid)
                        families.setdefault(fid, {"label": label, "items": []})["items"].append(e["rel"])
        finally:
            del e["_lower_types"]

    out = []
    for kid, label, _ in _KINDS:
        if kid in kinds:
            out.append({"id": kid, "group": "kind", "label": label,
                        "items": kinds[kid]["items"], "count": len(kinds[kid]["items"])})
    if lora_items:
        out.append({"id": "lora", "group": "kind", "label": "Uses a LoRA",
                    "items": lora_items, "count": len(lora_items)})
    for fid, label, _ in _FAMILIES:
        if fid in families:
            out.append({"id": fid, "group": "model", "label": label,
                        "items": families[fid]["items"], "count": len(families[fid]["items"])})
    return out
