"""Save Image Pixaroma - save images to ANY folder on disk (or output/),
with filename tokens, PNG/JPG, optional workflow embedding, and batch support.

The node face (folder + filename pattern + live preview + format) and the
right-click settings panel live in js/save_image/. State arrives via the
hidden SaveImageState input, injected by the frontend at graphToPrompt time
(Pattern #9). %NodeName.widget% tokens (e.g. %Seed Pixaroma.seed%) are
resolved FRONTEND-side before injection; %date:FMT%, %input%, %width%,
%height%, %batch_num% and %counter% are resolved here.
"""

import json
import os
import re
import time
import uuid
from collections import OrderedDict

import folder_paths
import numpy as np
from PIL import Image

from ._path_guard import (
    folder_allowed as _pix_folder_allowed,
    prescreen_folder_field as _pix_prescreen_field,
    denied_message as _pix_denied_message,
    safe_join,
)
from ._save_helpers import (
    _build_pnginfo,
    _expand_date_tokens,
    _json_safe,
    _metadata_disabled,
    _next_counter,
    _resolve_save_folder,
    _safe_prefix,
    strip_stale_preview,
)

# Keys MUST match js/save_image/state.mjs::DEFAULT_STATE.
DEFAULT_STATE = {
    "version": 1,
    "folder": "",
    "pattern": "image_%date:yyyy-MM-dd%_%counter%",
    "format": "png",
    "quality": 100,
    "embedWorkflow": True,
    "civitaiMeta": False,
    "saveOnRun": True,
    "dateStyle": "yyyy-MM-dd",  # JS-only (what the + Date chip inserts)
    "counterDigits": 3,         # %counter% zero-padding (001 = 3)
    "folded": False,            # JS-only (node body collapsed on the canvas)
    "hideBarWhenFolded": False, # JS-only (also hide the toolbar when folded)
    "webpLossless": False,      # WebP written lossless (quality is ignored)
    # Let a WIRED name keep its folders instead of flattening them to '_'.
    # OFF by default: a wired value creating folders on its own would surprise
    # anyone whose workflow already relies on the flattened name. Containment
    # does NOT depend on this flag - the joined pattern still goes through
    # _safe_prefix, which refuses '..', a leading '/', and turns a drive colon
    # into '_', so the result can only ever land under the save folder.
    "inputSubfolders": False,
    # JS-only: which optional buttons the node face shows. Absent/true = shown,
    # so an older saved workflow keeps every button.
    "showOpen": True,
    "showCopy": True,
    "showFolder": True,
    "showPng": True,
    "showJpg": True,
    "showWebp": True,
}

# Extensions stripped off a wired `name` value so "cat.png" doesn't become
# "cat.png_00001.png". Only known media extensions - "model_v1.2" keeps its dot.
_MEDIA_EXT_RE = re.compile(
    r"\.(png|jpe?g|webp|gif|bmp|tiff?|avif|mp4|mov|webm|mkv|m4v)$", re.IGNORECASE
)

_PREVIEW_MAX = 16  # frames shown in the node preview (all files still save)

# ── token-served previews (files saved OUTSIDE ComfyUI's folders) ────────────
# /view can only serve input/output/temp, so the node preview fetches external
# files through /pixaroma/api/save_image/file?t=<token>. The registry maps
# opaque tokens to EXACT paths this session wrote - the client never sends a
# path, so there is no traversal surface. Bounded FIFO; dies with the process.
_SERVE_TOKENS = OrderedDict()
_SERVE_CAP = 256


def _register_serve_token(path):
    tok = uuid.uuid4().hex
    _SERVE_TOKENS[tok] = path
    while len(_SERVE_TOKENS) > _SERVE_CAP:
        _SERVE_TOKENS.popitem(last=False)
    return tok


def resolve_serve_token(tok):
    """Exact-token lookup used by the serving route. None for anything else."""
    return _SERVE_TOKENS.get(str(tok or ""))


# ── Save now (the face button after a Preview run) ──────────────────────────
# A Preview run writes its frames to temp/ and records each file here together
# with the run it came from, so Save now can later write THOSE pictures into the
# save folder without running the workflow again (a new run makes a different
# picture whenever the seed is randomized). The client sends only a file NAME,
# and only a name in this registry is accepted, so the path is always one this
# node wrote, never one from the request. Bounded FIFO; it dies with the
# process, and ComfyUI empties its temp folder on restart anyway.
_PREVIEW_FILES = OrderedDict()  # temp filename -> (run context, batch index)
# Counted in FILES: 16 full 16-frame batches. 64 let five full Preview batches
# (other nodes, other tabs) push out a picture still on screen (review
# 2026-10-03). Each entry only points at the run's prompt + workflow, which
# ComfyUI's own history keeps anyway - no image data is held here.
_PREVIEW_FILES_CAP = 256
_PREVIEW_NAME_RE = re.compile(r"^pixaroma_save_preview_[0-9a-f]{32}\.png$")
_PREVIEW_GONE = (
    "This preview can no longer be saved: only the latest previews are kept, and "
    "ComfyUI empties its temp folder when it restarts. Run again, then Save now."
)


def _remember_preview(fname, run, index):
    _PREVIEW_FILES[fname] = (run, index)
    while len(_PREVIEW_FILES) > _PREVIEW_FILES_CAP:
        _PREVIEW_FILES.popitem(last=False)


def _expand_native_tokens(s):
    """Expand ComfyUI's native %year% %month% %day% %hour% %minute% %second%
    tokens. Native SaveImage gets these from folder_paths.get_save_image_path
    (compute_vars), which this node bypasses because it saves to arbitrary
    folders - so expand them here with the same zero-padded values (real user
    report: they worked in Preview Image Pixaroma but came out literal here)."""
    if not isinstance(s, str) or "%" not in s:
        return s
    now = time.localtime()
    for k, v in (
        ("%year%", f"{now.tm_year:04}"),
        ("%month%", f"{now.tm_mon:02}"),
        ("%day%", f"{now.tm_mday:02}"),
        ("%hour%", f"{now.tm_hour:02}"),
        ("%minute%", f"{now.tm_min:02}"),
        ("%second%", f"{now.tm_sec:02}"),
    ):
        s = s.replace(k, v)
    return s


def _tensor_to_pil(tensor):
    """Convert a HxWxC float [0,1] tensor frame to a PIL.Image.

    ComfyUI's IMAGE contract is 3 or 4 channels, but a misbehaving upstream
    node can emit 1/2/5+ channels - PIL's fromarray raises a raw TypeError on
    those, so normalize instead of crashing the save (1 -> grayscale, 2 ->
    grayscale+alpha, 5+ -> first three as RGB).
    """
    arr = (tensor.cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
    if arr.ndim == 3:
        c = arr.shape[2]
        if c == 1:
            return Image.fromarray(arr[:, :, 0], "L")
        if c == 2:
            return Image.fromarray(arr, "LA")
        if c > 4:
            arr = arr[:, :, :3]
    return Image.fromarray(arr)


_EXIF_MAX = 64000  # JPEG APP1 segment tops out ~65 KB; Pillow raises
                   # "EXIF data is too long" past it (verified empirically)


def _strip_stale_preview(extra):
    """This node's binding of the shared helper: drop every Save Image node's
    remembered preview (`pixSiLastRun`) from the EMBEDDED workflow copy.

    The reasoning, and the copy-never-mutate rule that goes with it, live in
    _save_helpers.strip_stale_preview - shared with Save Video Pixaroma since
    2026-08-10 so the two cannot drift.
    """
    return strip_stale_preview(extra, "PixaromaSaveImage", "pixSiLastRun")


def _build_jpeg_exif(prompt=None, workflow=None, parameters=None, max_bytes=None):
    """EXIF bytes embedding workflow + prompt, using the community convention
    ComfyUI reads for WebP (0x010E ImageDescription = 'Workflow:<json>',
    0x010F Make = 'Prompt:<json>').

    Used by BOTH the JPG and the WebP save paths, and the difference between
    them is only `max_bytes`:

    * JPG carries EXIF in an APP1 segment, which tops out at ~65 KB, so a real
      workflow usually does NOT fit and the ladder below has to shed payload.
      The current ComfyUI frontend also has no jpeg reader at all (verified in
      the bundle's getWorkflowDataFromFile), so a JPG never drag-restores.
    * WebP stores EXIF in its own RIFF chunk with no such limit, and the
      frontend DOES have an `image/webp` branch calling getWebpMetadata -
      re-verified live in the bundle 2026-08-10. So a WebP written here really
      does reload the workflow when dragged back in, and passing a large
      max_bytes lets the whole graph ride along.

    A big graph easily exceeds the ~65 KB JPEG EXIF segment limit and Pillow
    then raises AT SAVE TIME - so try workflow+prompt, fall back to workflow
    only, and skip embedding entirely when even that is too large (the JPG
    still saves; PNG is the reload format anyway).

    A1111-style `parameters` text goes in EXIF UserComment (0x9286, inside the
    Exif IFD 0x8769) with the standard 8-byte "UNICODE\\0" prefix + UTF-16-BE
    payload, which is what Civitai's reader expects and what piexif produces for
    encoding="unicode". It is preferred over the workflow, because it is normally
    small and it is the ONLY part Civitai can read - dropping it to make room for
    a giant workflow would defeat the point.

    But "normally small" is not always: UTF-16 costs 2 bytes per character, so a
    ~32000-character prompt alone busts the 64 KB limit. The ladder therefore ends
    with two attempts that DROP the user comment, so an enormous prompt costs only
    the Civitai part and still leaves the workflow EXIF that used to fit, rather
    than losing everything.
    """
    # PNG goes through _build_pnginfo, which gates itself; the JPG path builds
    # its own bytes, so it needs the same gate here or --disable-metadata would
    # hold for PNG and leak for JPG.
    if _metadata_disabled():
        return None

    def _user_comment(exif, include=True):
        if not include or not (isinstance(parameters, str) and parameters.strip()):
            return
        try:
            ifd = exif.get_ifd(0x8769)
            ifd[0x9286] = b"UNICODE\x00" + parameters.encode("utf-16-be")
        except Exception:
            pass

    have_params = isinstance(parameters, str) and bool(parameters.strip())
    cap = _EXIF_MAX if max_bytes is None else int(max_bytes)
    try:
        # (workflow, prompt, include_user_comment), most complete first.
        #
        # The two PROMPT-ONLY rungs (2026-09-29, Discord report "metadata gone
        # for all instances"): once a workflow passed the JPG limit the file
        # was saved with NOTHING, although the prompt alone - a fraction of the
        # workflow's size - would have fitted. The workflow is shared by every
        # Save Image node, so all of them went blank at once. They come after
        # every workflow rung, so a file that fitted before embeds exactly
        # what it did before.
        attempts = (
            (workflow, prompt, True),
            (workflow, None, True),
            (None, prompt, True),
            (None, None, True),
            # Last resorts with the user comment dropped, so a huge prompt does
            # not also cost the workflow EXIF that fitted before this feature.
            # Fullest first, same as above, or a fitting bigger payload would be
            # skipped in favour of the smaller one tried earlier.
            (workflow, prompt, False),
            (workflow, None, False),
            (None, prompt, False),
        )
        for wf, pr, include in attempts:
            if wf is None and pr is None and not (include and have_params):
                continue
            exif = Image.Exif()
            if wf is not None:
                exif[0x010E] = "Workflow:" + json.dumps(_json_safe(wf))
            if pr is not None:
                exif[0x010F] = "Prompt:" + json.dumps(_json_safe(pr))
            _user_comment(exif, include)
            data = exif.tobytes()
            if len(data) <= cap:
                return data
        return None
    except Exception:
        return None


def _parse_state(raw):
    """The node state -> a full dict with every default filled in.

    `raw` is the hidden SaveImageState JSON string on a run, or the object itself
    from the Save now route. Untrusted either way: anything that is not a JSON
    object leaves the defaults.
    """
    state = dict(DEFAULT_STATE)
    data = raw
    if isinstance(raw, str):
        try:
            data = json.loads(raw) if raw else {}
        except Exception:
            data = {}
    if isinstance(data, dict):
        state.update(data)
    return state


def _contain_folder(folder_raw):
    """The save folder from the state -> (folder_abs, inside_output), or a
    ValueError whose message names the fix.

    CONTAINMENT (2026-08-03, ComfyUI-Manager PR #3118). `folder` arrives in the
    hidden SaveImageState blob (or the Save now request) and both are
    unauthenticated, so this string is attacker-controlled. It used to be
    honoured verbatim for any absolute path: `inside_output` was computed but
    only ever picked the UI payload shape, never gated the write. A crafted
    prompt could therefore drop PNG/JPG files anywhere the ComfyUI process can
    write. Saving to your own folders still works - see _path_guard: anything
    you picked with the Browse button is approved, and so are ComfyUI's own
    folders.
    prescreen first (raw string, no filesystem touch) because
    _resolve_save_folder calls realpath, which reaches out over SMB for a UNC
    path before we would otherwise get a look at it.
    It must be the _FIELD variant (2026-08-04, follow-up review on PR #3118):
    _resolve_save_folder expandvars() the string before it resolves, so plain
    prescreen() screens a DIFFERENT value than the one that gets realpath'd -
    `%HOMESHARE%` is not lexically UNC, sails through, and only becomes UNC
    after expansion. The two routes in server_routes.py already used the field
    variant; this node was the one site still on the plain one.
    """
    if not _pix_prescreen_field(folder_raw):
        raise ValueError(_pix_denied_message(str(folder_raw)))
    folder_abs, inside_output = _resolve_save_folder(folder_raw)
    if not _pix_folder_allowed(folder_abs):
        raise ValueError(_pix_denied_message(folder_abs))
    return folder_abs, inside_output


def _write_frames(frames, state, name, w, h, prompt, extra_pnginfo, unique_id,
                  folder_abs, inside_output):
    """Write `frames`, (batch index, PIL image) pairs, into the save folder
    -> (ui entries, status).

    The ONE write path: a Save run and Save now both come through here, so the
    naming, the counter, the formats and the metadata cannot drift apart.
    `frames` may be a generator, so a long batch is still converted one frame
    at a time.
    """
    raw_fmt = str(state.get("format", "png")).lower()
    if raw_fmt in ("jpg", "jpeg"):
        fmt = "jpg"
    elif raw_fmt == "webp":
        fmt = "webp"
    else:
        fmt = "png"
    ext = {"jpg": ".jpg", "webp": ".webp"}.get(fmt, ".png")
    try:
        quality = max(1, min(100, int(state.get("quality", 100))))
    except Exception:
        quality = 100
    webp_lossless = bool(state.get("webpLossless", False))
    embed = bool(state.get("embedWorkflow", True))
    civitai_on = bool(state.get("civitaiMeta", False))
    try:
        digits = max(1, min(8, int(state.get("counterDigits", 3))))
    except Exception:
        digits = 3

    # ---- resolve the pattern (batch-level tokens) ----
    pattern = str(state.get("pattern") or DEFAULT_STATE["pattern"])
    input_name = ""
    if name is not None:
        input_name = name if isinstance(name, str) else str(name)
        input_name = _MEDIA_EXT_RE.sub("", input_name.strip())
        if state.get("inputSubfolders"):
            # "Keep folders from the wired name" is ON: keep the separators so a
            # source path like "portraits/cat" rebuilds that folder inside
            # the save folder (the point of the option - Load Images from
            # Folder can hand over the real relative path).
            #
            # This is NOT the containment boundary. The joined pattern still
            # goes through _safe_prefix below, which returns None for any
            # '..' segment or a leading '/', and _sanitize_segment turns a
            # drive colon into '_' - so "../../x", "/etc/x" and "C:/x" can
            # only ever end up refused or as a plain subfolder. Verified in
            # the harness; do not add a second, weaker check here.
            input_name = input_name.replace("\\", "/")
        else:
            # separators would create surprise subfolders; folders belong to
            # the PATTERN (type / there), not to a wired name
            input_name = input_name.replace("\\", "_").replace("/", "_")
    resolved = pattern.replace("%input%", input_name)
    resolved = _expand_date_tokens(resolved)
    resolved = _expand_native_tokens(resolved)
    resolved = resolved.replace("%width%", str(w)).replace("%height%", str(h))
    note = None
    rel = _safe_prefix(resolved)
    if not rel:
        rel = "image_%counter%"
        note = "filename pattern was invalid, used 'image_%counter%'"

    # Civitai-readable generation settings, read from the graph (opt-in).
    # Built BEFORE the pnginfo so it can ride in the same chunk set. Wrapped
    # because metadata is a nice-to-have: nothing here may cost the user
    # their image.
    a1111 = None
    if civitai_on and not _metadata_disabled():
        try:
            from ._civitai_meta import build_metadata
            a1111 = build_metadata(prompt, extra_pnginfo, unique_id, w, h)
        except Exception as e:
            print("[Save Image Pixaroma] Civitai metadata skipped: %s" % e)

    # The picture must not carry the PREVIOUS run's preview - see
    # _strip_stale_preview. Done once here so the PNG, the JPG/WebP EXIF and
    # the Civitai reader below all embed the same cleaned copy.
    embed_extra = _strip_stale_preview(extra_pnginfo)

    pnginfo = None
    exif_bytes = None
    if fmt == "png" and (embed or a1111):
        pnginfo = _build_pnginfo(
            prompt=prompt if embed else None,
            extra_pnginfo=embed_extra if embed else None,
            parameters=a1111,
        )
    elif fmt in ("jpg", "webp") and (embed or a1111):
        wf = embed_extra.get("workflow") if isinstance(embed_extra, dict) else None
        exif_bytes = _build_jpeg_exif(
            prompt=prompt if embed else None,
            workflow=wf if embed else None,
            parameters=a1111,
            # WebP's EXIF lives in its own RIFF chunk with no 64 KB APP1
            # limit, so the whole workflow fits and the file really does
            # drag back into ComfyUI. Still capped, generously, so a
            # pathological graph cannot balloon every frame of a batch.
            max_bytes=(8 * 1024 * 1024) if fmt == "webp" else None,
        )

    out_real = os.path.realpath(folder_paths.get_output_directory())
    results = []
    counters = {}      # per target dir: next FILE %counter% to try
    dir_counters = {}  # per (parent, segment): resolved FOLDER %counter%
    saved = 0
    for i, pil in frames:
        rel_frame = rel.replace("%batch_num%", str(i))
        parts = [p for p in rel_frame.split("/") if p]
        base_tpl = parts[-1] if parts else "image_%counter%"
        sub_dirs = parts[:-1]
        # %counter% in a FOLDER segment: resolve it ONCE per run (whole
        # batch shares the folder), scanning existing sibling dirs so
        # e.g. take_%counter%/frame makes take_00001, take_00002, ...
        # per run instead of a folder literally named take_%counter%.
        if sub_dirs and any("%counter%" in d for d in sub_dirs):
            resolved_dirs = []
            parent = folder_abs
            for d in sub_dirs:
                if "%counter%" in d:
                    ck = (parent.lower(), d)
                    if ck not in dir_counters:
                        dir_counters[ck] = _next_counter(parent, d)
                    d = d.replace("%counter%", f"{dir_counters[ck]:0{digits}}")
                resolved_dirs.append(d)
                parent = os.path.join(parent, d)
            sub_dirs = resolved_dirs
        target_dir = os.path.join(folder_abs, *sub_dirs) if sub_dirs else folder_abs
        try:
            os.makedirs(target_dir, exist_ok=True)
        except Exception as e:
            raise RuntimeError(
                f"Save Image Pixaroma: cannot create folder '{target_dir}': {e}"
            )

        has_counter = "%counter%" in base_tpl
        # key by dir + template so filename FAMILIES count independently
        # (e.g. img_%batch_num%_%counter% - each batch_num scans its own
        # existing files instead of inheriting another family's counter)
        key = (target_dir.lower(), base_tpl)
        if has_counter and key not in counters:
            counters[key] = _next_counter(target_dir, base_tpl + ext)

        # Claim the name with O_EXCL so files NEVER overwrite (bump on
        # collision; a pattern without %counter% auto-suffixes instead).
        counter = counters.get(key, 1)
        suffix = 0
        path = fname = None
        while True:
            if has_counter:
                fname = base_tpl.replace("%counter%", f"{counter:0{digits}}") + ext
            elif suffix == 0:
                fname = base_tpl + ext
            else:
                fname = f"{base_tpl}_{suffix:0{digits}}{ext}"
            cand = os.path.join(target_dir, fname)
            try:
                fd = os.open(cand, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
                os.close(fd)
                path = cand
                break
            except FileExistsError:
                if has_counter:
                    counter += 1
                else:
                    suffix += 1
                if counter > 99999999 or suffix > 99999999:
                    raise RuntimeError(
                        "Save Image Pixaroma: could not find a free filename (counter overflow)"
                    )
            except OSError as e:
                # read-only folder, AV lock, dead network share, ... -
                # a clear message instead of a raw traceback
                raise RuntimeError(
                    f"Save Image Pixaroma: cannot write in '{target_dir}': {e}"
                )
        if has_counter:
            counters[key] = counter + 1

        ok = False
        try:
            if fmt == "png":
                # RGBA is preserved - PNG keeps transparency.
                pil.save(path, "PNG", pnginfo=pnginfo, compress_level=4)
            elif fmt == "webp":
                # WebP keeps ALPHA, so unlike JPG there is nothing to
                # flatten - only the odd channel counts _tensor_to_pil can
                # hand back (L / LA) need converting, since libwebp writes
                # RGB and RGBA only.
                im = pil if pil.mode in ("RGB", "RGBA") else pil.convert(
                    "RGBA" if pil.mode in ("LA", "PA") else "RGB"
                )
                kw = {"lossless": True} if webp_lossless else {"quality": quality}
                if exif_bytes:
                    try:
                        im.save(path, "WEBP", exif=exif_bytes, **kw)
                    except (ValueError, OSError):
                        # EXIF rejected by this Pillow/libwebp build - the
                        # image matters more than the metadata (same belt
                        # the JPEG branch wears).
                        im.save(path, "WEBP", **kw)
                else:
                    im.save(path, "WEBP", **kw)
            else:
                rgb = pil
                if pil.mode == "RGBA":
                    # JPG has no alpha: premultiply over black (consistent
                    # with the rest of the suite).
                    arr = np.asarray(pil).astype(np.float32)
                    a = arr[..., 3:4] / 255.0
                    rgb = Image.fromarray(
                        (arr[..., :3] * a).clip(0, 255).astype(np.uint8)
                    )
                elif pil.mode != "RGB":
                    rgb = pil.convert("RGB")
                if exif_bytes:
                    try:
                        rgb.save(path, "JPEG", quality=quality, exif=exif_bytes)
                    except ValueError:
                        # EXIF rejected by this Pillow build (size limit
                        # differences) - the image matters more, save plain
                        rgb.save(path, "JPEG", quality=quality)
                else:
                    rgb.save(path, "JPEG", quality=quality)
            ok = True
        finally:
            if not ok:
                # remove the claimed 0-byte file so failures leave no junk
                try:
                    os.remove(path)
                except OSError:
                    pass
        saved += 1

        entry = {"filename": fname}
        if inside_output:
            # all entries kept - native SaveImage parity for the Assets
            # panel; the frontend caps the DISPLAY at 16 itself
            sub = os.path.relpath(target_dir, out_real)
            entry["subfolder"] = "" if sub == "." else sub.replace("\\", "/")
            entry["type"] = "output"
        else:
            # external entries beyond the preview cap carry no token, so
            # they are dead weight in the payload - skip them (the status
            # dict carries the true saved count)
            if len(results) >= _PREVIEW_MAX:
                continue
            entry["path"] = path
            # full-quality preview via the token route (/view can't
            # serve external paths)
            entry["token"] = _register_serve_token(path)
        results.append(entry)

    status = {
        "saved": saved,
        "folder": folder_abs,
        "w": w,
        "h": h,
        "inside_output": inside_output,
    }
    if note:
        status["note"] = note
    if results:
        results[0]["_pixaroma_status"] = status
    return results, status


def _open_preview(path):
    """A Preview frame from temp/ as a clean PIL image: pixels only.

    Its own text chunks (the prompt and workflow every preview embeds) are
    dropped, so the saved file carries exactly what the node's settings say -
    nothing rides along when workflow embedding is off.
    """
    with Image.open(path) as im:
        im.load()
        pil = im.copy()
    pil.info = {}
    if pil.mode not in ("RGB", "RGBA", "L", "LA"):
        pil = pil.convert("RGBA" if "A" in pil.getbands() else "RGB")
    return pil


def save_now(data):
    """Save now: write the pictures a Preview run showed into the save folder,
    without running the workflow again -> {"entries", "inside_output"}.

    Called by the /pixaroma/api/save_image/save_now route, which is
    unauthenticated, so every value in `data` is untrusted (path-containment.md
    #0). The source must be a temp file this node registered when it wrote it
    (_PREVIEW_FILES); the request names it but never supplies a path. The
    destination follows exactly the rules of a Save run, through the same code
    (_contain_folder, _write_frames). The CURRENT settings of the node apply
    (folder, filename, format, quality, metadata), while what belongs to the
    picture comes from its run: the wired name, the size, the prompt and
    workflow, and the node references in the filename as long as the field is
    unchanged since that run.
    """
    if not isinstance(data, dict) or not isinstance(data.get("files"), list):
        raise ValueError("Save now needs the pictures from the last run.")
    temp_dir = folder_paths.get_temp_directory()
    # One preview can hold SEVERAL runs: a list input upstream (Prompt Each,
    # Load Images from Folder, any OUTPUT_IS_LIST node) runs this node once per
    # item and ComfyUI joins their pictures into one executed event. Each run
    # is written as its own group with its own name, size and prompt, in the
    # order sent - what a Save run does with the same list (round-2 review).
    groups = []  # [(run, [(batch index, path), ...])]
    seen = set()
    for fname in data["files"][:_PREVIEW_MAX]:
        ok_name = isinstance(fname, str) and bool(_PREVIEW_NAME_RE.match(fname))
        rec = _PREVIEW_FILES.get(fname) if ok_name else None
        path = safe_join(temp_dir, fname) if rec else None
        if not rec or not path or not os.path.isfile(path):
            raise ValueError(_PREVIEW_GONE if ok_name else
                             "Save now can only save pictures this node showed in Preview.")
        if fname in seen:
            continue
        seen.add(fname)
        group = next((g for g in groups if g[0] is rec[0]), None)
        if group is None:
            group = (rec[0], [])
            groups.append(group)
        group[1].append((rec[1], path))
    if not groups:
        raise ValueError("Save now needs the pictures from the last run.")

    state = _parse_state(data.get("state"))
    typed = state.get("pattern")
    live = data.get("pattern_live")
    folder_abs, inside_output = _contain_folder(state.get("folder", ""))
    entries = []
    status = None
    for run, picks in groups:
        run_state = dict(state)
        # Node references (%Seed Pixaroma.seed%) are filled in by the browser
        # when a run is queued, and a randomized seed has already moved on by
        # the time Save now is clicked. So while the field still says what it
        # said for that run, use the run's own values; an edited field uses
        # what the face shows.
        if run["pattern_raw"] is not None and typed == run["pattern_raw"]:
            run_state["pattern"] = run["pattern"]
        elif isinstance(live, str):
            run_state["pattern"] = live
        frames = ((i, _open_preview(p)) for i, p in picks)
        results, run_status = _write_frames(
            frames, run_state, run["name"], run["w"], run["h"], run["prompt"],
            run["extra_pnginfo"], run["unique_id"], folder_abs, inside_output,
        )
        if results:
            results[0].pop("_pixaroma_status", None)
        entries.extend(results)
        if status is None:
            status = run_status
        else:
            status["saved"] += run_status["saved"]
    # ONE status for the whole answer, on the first entry (the face reads it there)
    if entries and status is not None:
        entries[0]["_pixaroma_status"] = status
    return {"entries": entries, "inside_output": inside_output}


class PixaromaSaveImage:
    DESCRIPTION = (
        "Save Image Pixaroma - save images to any folder on your computer, not just ComfyUI's output folder. "
        "Type or paste a path, or click Browse to pick a folder with your system's own folder dialog; leave the field "
        "empty to use the output folder. The filename field supports tokens and shows a live 'Will save as' "
        "preview of the exact file that will be written. Tokens: %input% (the wired name input, e.g. the filename "
        "from Load Image Pixaroma), %date:yyyy-MM-dd% (and any date/time format), %counter% (auto-incrementing, "
        "never overwrites), %width%, %height%, %batch_num%, plus node references like %Seed Pixaroma.seed%. "
        "Use / in the name to create subfolders. Three formats: PNG (lossless, keeps transparency, drags back "
        "into ComfyUI to reload the workflow), WebP (much smaller, keeps transparency, and it also drags back "
        "in to reload the workflow), or JPG (small and universal, no transparency, and ComfyUI cannot reload "
        "a workflow from it). Open the settings with the gear on the node or by right-clicking it: date style, "
        "counter digits, quality, WebP lossless, workflow embedding, Civitai generation info, which buttons the "
        "node shows, and whether folders in a wired name are kept. Batches save every frame with the counter "
        "increasing.\n\n"
        "Add Civitai generation info (right-click) also writes the settings in the format Civitai reads, "
        "so an image posted there shows the checkpoint, the LoRAs and their strengths, plus steps, seed, "
        "sampler and size. The values are read from your workflow automatically, so nothing needs wiring "
        "into this node. The first save after adding a new model pauses briefly to fingerprint it, then "
        "it is remembered.\n\n"
        "Saved images show in a large preview on the node: one image fills the area, a batch shows as a grid. "
        "Click a picture in the grid to view it big, click it or hover for the arrows to flip through, and the "
        "X returns to the grid. Copy puts the shown image on the clipboard, Open shows it in a new browser tab. "
        "Resize the node to make the preview bigger. The Save and Preview buttons switch between writing files on "
        "every run and only showing images on the node with nothing written to your folder, so it can double as a "
        "preview node. After a Preview run, Save now (on the line under the image) writes every picture of that preview "
        "into your folder with the node's current settings, without running the workflow again. "
        "Folder shows the save location in your file explorer; the window can appear on the taskbar."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "Image (or batch) to save. Every frame in a batch is written, with the counter increasing per file."}),
            },
            "optional": {
                "name": ("STRING", {"forceInput": True, "tooltip": "Optional text used by the %input% token in the filename, e.g. wire the filename output of Load Image Pixaroma here to keep the original name. To save into a folder named after this text, click the + Input folder chip. If the text already contains folders they become underscores, unless you turn on 'Keep folders from the wired name' in the settings."}),
            },
            "hidden": {
                "SaveImageState": "STRING",
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Always re-execute so every Run actually saves. Without this,
        # deleting the saved files and clicking Run again did NOTHING
        # (ComfyUI's input-hash cache skipped the node) - real user report
        # on day one. Same choice as Preview Image Pixaroma.
        return float("nan")

    def save(self, images, name=None, SaveImageState="", prompt=None, extra_pnginfo=None,
             unique_id=None):
        state = _parse_state(SaveImageState)
        save_on = bool(state.get("saveOnRun", True))

        h = int(images.shape[1])
        w = int(images.shape[2])
        # CONTAINMENT: the folder is attacker-controlled - see _contain_folder.
        folder_abs, inside_output = _contain_folder(state.get("folder", ""))

        # Saving switched off: the node acts as a pure PREVIEW. Frames go to
        # ComfyUI's temp/ folder (auto-cleared on restart, /view-servable,
        # workflow embedded like native PreviewImage) - nothing is written to
        # the user's folder. Each frame is registered so Save now can write it
        # later without a new run (see _PREVIEW_FILES).
        if not save_on:
            temp_dir = folder_paths.get_temp_directory()
            os.makedirs(temp_dir, exist_ok=True)
            # same cleaning as the real save below: a preview frame embeds a
            # workflow too, so it must not carry the previous run's preview
            pnginfo = _build_pnginfo(prompt=prompt, extra_pnginfo=_strip_stale_preview(extra_pnginfo))
            run = {
                "name": name,
                # The filename field as typed, and with this run's node
                # references filled in (the browser resolves %Node.widget% when
                # it queues the run; patternRaw is sent in Preview mode only).
                "pattern_raw": state.get("patternRaw"),
                "pattern": state.get("pattern"),
                "w": w,
                "h": h,
                "prompt": prompt,
                "extra_pnginfo": extra_pnginfo,
                "unique_id": unique_id,
            }
            entries = []
            for i, tensor in enumerate(images):
                if i >= _PREVIEW_MAX:
                    break
                pil = _tensor_to_pil(tensor)
                fname = f"pixaroma_save_preview_{uuid.uuid4().hex}.png"
                pil.save(os.path.join(temp_dir, fname), "PNG", pnginfo=pnginfo)
                _remember_preview(fname, run, i)
                entries.append({"filename": fname, "subfolder": "", "type": "temp"})
            if not entries:
                entries.append({"filename": ""})
            entries[0]["_pixaroma_status"] = {
                "saved": 0,
                "folder": folder_abs,
                "w": w,
                "h": h,
                "inside_output": inside_output,
                "note": "Preview mode - nothing was written to your folder",
            }
            return {"ui": {"pixaroma_save_frames": entries}}

        frames = ((i, _tensor_to_pil(t)) for i, t in enumerate(images))
        results, _status = _write_frames(
            frames, state, name, w, h, prompt, extra_pnginfo, unique_id,
            folder_abs, inside_output,
        )

        # Inside output/: emit the standard ui.images key so the Media Assets
        # panel refreshes (Preview Pattern #14); the JS previews via /view.
        # Outside: our custom key with token-served entries (/view can't serve
        # those paths). ONE key either way so the Assets stack badge stays
        # correct (Preview Pattern #16).
        ui_key = "images" if inside_output else "pixaroma_save_frames"
        return {"ui": {ui_key: results}}


NODE_CLASS_MAPPINGS = {"PixaromaSaveImage": PixaromaSaveImage}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSaveImage": "Save Image Pixaroma"}
