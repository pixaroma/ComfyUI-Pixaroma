import os
import io
import re
import hashlib
import threading
import time
import shutil
import asyncio
import json
import base64
import uuid
from server import PromptServer
from aiohttp import web
from PIL import Image
from PIL.PngImagePlugin import PngInfo
import folder_paths

from .nodes._save_helpers import (
    _build_pnginfo,
    _next_counter,
    _resolve_save_folder,
    _safe_prefix,
)
from .nodes._save_text_helpers import (
    count_entries as _st_count_entries,
    normalize_txt_name as _st_normalize_txt_name,
)
from .nodes._prompt_reader_helpers import read_prompt_from_image, resolve_input_image_name
from .nodes import _video_prompt_helpers as _vp
from .nodes import _ai_prompt_presets as _aip
from .nodes._cache_bust_helpers import stamp_import_urls
from .nodes._bg_removal_helpers import (
    get_birefnet_inventory,
    is_birefnet_model_id,
    run_birefnet_on_pil,
)
from .nodes._path_guard import (
    is_path_under as _is_path_under,
    safe_join as _safe_join,
    folder_allowed as _pix_folder_allowed,
    remember_folder as _pix_remember_folder,
    denied_message as _pix_denied_message,
    comfy_roots as _pix_comfy_roots,
    remembered_folders as _pix_remembered_folders,
    prescreen as _pix_prescreen,
    prescreen_folder_field as _pix_prescreen_field,
    rel_is_rooted as _pix_rel_is_rooted,
)
from .nodes._font_catalog import full_catalog as _font_full_catalog
from .nodes._resize_helpers import _I16_MODES
from .nodes._font_catalog import (
    get_custom_fonts_dir as _font_custom_dir,
    resolve_custom_file as _font_resolve_custom,
)
from .nodes._lora_helpers import (
    build_lora_info as _lora_build_info,
    file_sha256 as _lora_file_sha256,
    find_preview_path as _lora_find_preview,
    parse_civitai_modelversion as _lora_parse_civitai,
    save_sidecar_cache as _lora_save_sidecar,
    delete_sidecar_cache as _lora_delete_sidecar,
    sanitize_civitai_key as _civitai_sanitize_key,
    mask_civitai_key as _civitai_mask_key,
    civitai_hosts as _civitai_hosts,
    read_civitai_account as _civitai_read_account,
    write_civitai_account as _civitai_write_account,
    get_custom_triggers as _lora_get_custom,
    set_custom_triggers as _lora_set_custom,
    find_custom_preview as _lora_find_custom_preview,
    custom_preview_path as _lora_custom_preview_path,
    custom_preview_version as _lora_custom_preview_version,
    write_custom_preview as _lora_write_custom_preview,
    delete_custom_preview as _lora_delete_custom_preview,
)
from .nodes.node_krea_lora_convert import (
    inspect_lora as _krea_lora_inspect,
    resolve_and_convert as _krea_lora_convert,
)
from .nodes._workflow_index_helpers import (
    build_index as _wf_build_index,
    collections as _wf_collections,
    detect_issues as _wf_detect_issues,
    looks_like_image as _wf_looks_like_image,
    is_cover_name as _wf_is_cover_name,
    reserved_part as _wf_reserved_part,
    WIN_RESERVED_NAMES as _WIN_RESERVED_NAMES,
)

# Ensure ComfyUI/models/fonts/ exists so users have a place to drop fonts.
try:
    _PIXAROMA_CUSTOM_FONTS_DIR = _font_custom_dir()
except Exception as _e:
    _PIXAROMA_CUSTOM_FONTS_DIR = None
    print(f"[Pixaroma] could not prepare custom fonts dir: {_e}")

# --- PORTABLE COMFYUI FIX ---
# Force rembg to download and read AI models from ComfyUI/models/rembg
# instead of the hidden C:\Users\name\.u2net folder.
REMBG_MODELS_DIR = os.path.join(folder_paths.models_dir, "rembg")
os.makedirs(REMBG_MODELS_DIR, exist_ok=True)
os.environ["U2NET_HOME"] = REMBG_MODELS_DIR
# ----------------------------

PIXAROMA_ASSETS_DIR = os.path.realpath(
    os.path.join(os.path.dirname(__file__), "assets")
)
PIXAROMA_VENDOR_DIR = os.path.realpath(
    os.path.join(PIXAROMA_ASSETS_DIR, "vendor")
)

# ─────────────────────────────────────────────────────────────────────────────
# Browser-cache fix for our .mjs files - TWO layers, both needed.
#
# Layer 1 (headers): ComfyUI core's cache middleware sets "Cache-Control:
# no-store" on .js/.css responses, but it checks request.path.endswith(".js") -
# which does NOT match our .mjs ES modules. Mirror it for OUR OWN .mjs/.js via
# an on_response_prepare hook so freshly-fetched files are never cached.
#
# Layer 2 (import-URL version stamping): headers only help when the browser
# actually ASKS the server. A browser that heuristically cached a pre-fix .mjs
# treats it as fresh and never re-requests it, so those users stayed stale
# until a manual hard refresh - and lazily-imported modules (editors, icons)
# needed MORE hard refreshes. The middleware below serves our .js/.mjs files
# with every relative .mjs import rewritten to "./x.mjs?v=<plugin version>".
# Entry index.js files are always refetched (core sends no-store for .js), so
# after an update the bumped version makes every internal module URL brand new
# and the whole tree loads fresh - no user action, on browser/Desktop/Mac.
# See nodes/_cache_bust_helpers.py for the rewrite rules.
#
# Python change -> needs a full ComfyUI restart. Only touches this plugin's
# files; the served folder name is auto-derived so a renamed install still works.
_PIX_DIR = os.path.basename(os.path.dirname(os.path.abspath(__file__)))
_PIX_PREFIX = "/extensions/" + _PIX_DIR + "/"
# WEB_DIRECTORY is "./js", so /extensions/<dir>/X maps to <plugin>/js/X.
_PIX_JS_ROOT = os.path.realpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "js")
)
_PIX_PYPROJECT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pyproject.toml")
_pix_stamp_version_cache = {"mtime": None, "version": "0"}


async def _pixaroma_no_cache(request, response):
    p = request.path
    if p.startswith(_PIX_PREFIX) and (p.endswith(".mjs") or p.endswith(".js")):
        response.headers["Cache-Control"] = "no-store"


def _pixaroma_stamp_version():
    """Plugin version for import-URL stamping, refreshed when pyproject.toml
    changes on disk (an update swaps files without restarting the server; the
    stamp must reflect the NEW version immediately, same lesson as
    _read_pixaroma_version). Cached by mtime so serving ~150 modules per page
    load does not re-parse the TOML each time."""
    try:
        mt = os.path.getmtime(_PIX_PYPROJECT)
        if _pix_stamp_version_cache["mtime"] != mt:
            _pix_stamp_version_cache["version"] = _read_pixaroma_version()
            _pix_stamp_version_cache["mtime"] = mt
    except Exception:
        pass
    return _pix_stamp_version_cache["version"]


@web.middleware
async def _pixaroma_stamp_imports_mw(request, handler):
    p = request.path
    if (
        request.method == "GET"
        and p.startswith(_PIX_PREFIX)
        and (p.endswith(".mjs") or p.endswith(".js"))
    ):
        try:
            rel = p[len(_PIX_PREFIX):]
            file_path = os.path.realpath(os.path.join(_PIX_JS_ROOT, rel))
            if file_path.startswith(_PIX_JS_ROOT + os.sep) and os.path.isfile(file_path):
                with open(file_path, "r", encoding="utf-8") as f:
                    text = f.read()
                text = stamp_import_urls(text, _pixaroma_stamp_version())
                return web.Response(
                    text=text,
                    content_type="application/javascript",
                    charset="utf-8",
                    headers={"Cache-Control": "no-store"},
                )
        except Exception as e:
            # Fall through to the native static handler (unstamped but served);
            # log loudly because a partial fallback can double-instance modules.
            print("[Pixaroma] import-stamp serve failed, falling back:", e)
    return await handler(request)


def _pixaroma_install_no_cache():
    # Two independent installs: if one fails the other still protects users.
    inst = getattr(PromptServer, "instance", None)
    app = getattr(inst, "app", None) if inst else None
    if app is None:
        return
    try:
        if not getattr(app, "_pixaroma_no_cache_installed", False):
            app.on_response_prepare.append(_pixaroma_no_cache)
            app._pixaroma_no_cache_installed = True
    except Exception as e:
        print("[Pixaroma] no-cache hook not installed:", e)
    try:
        if not getattr(app, "_pixaroma_import_stamp_installed", False):
            app.middlewares.append(_pixaroma_stamp_imports_mw)
            app._pixaroma_import_stamp_installed = True
    except Exception as e:
        print("[Pixaroma] import-stamp middleware not installed:", e)


_pixaroma_install_no_cache()

# Offline-first vendored third-party assets (Three.js, OrbitControls, loaders…).
# Served with arbitrary path depth so `three/examples/jsm/…` resolves.
_VENDOR_PATH_RE = re.compile(r"^[A-Za-z0-9_\-./]+$")
_VENDOR_MIME = {
    ".mjs": "application/javascript",
    ".js": "application/javascript",
    ".json": "application/json",
    ".wasm": "application/wasm",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
}


@PromptServer.instance.routes.get("/pixaroma/vendor/{tail:.*}")
async def serve_pixaroma_vendor(request):
    tail = request.match_info["tail"]
    if not tail or ".." in tail.split("/") or not _VENDOR_PATH_RE.match(tail):
        return web.Response(status=400)
    file_path = os.path.realpath(os.path.join(PIXAROMA_VENDOR_DIR, tail))
    if not file_path.startswith(PIXAROMA_VENDOR_DIR + os.sep):
        return web.Response(status=403)
    if not os.path.isfile(file_path):
        return web.Response(status=404)
    ext = os.path.splitext(tail)[1].lower()
    headers = {"Cache-Control": "public, max-age=31536000, immutable"}
    if ext in _VENDOR_MIME:
        headers["Content-Type"] = _VENDOR_MIME[ext]
    return web.FileResponse(file_path, headers=headers)


# ── the asset route a HOSTED ComfyUI can actually reach ─────────────────────
#
# THE PROBLEM (measured on a cloud platform, 2026-08-04): their edge routes by
# FILE EXTENSION, not by path. Anything whose URL PATH ends .svg / .png / .ttf /
# .mp3 is answered by their own static file server and never reaches ComfyUI,
# wherever it sits in the path. Extensions they do forward: .json, .glb, .mjs,
# and no extension at all. So every icon, font and sound 404'd there while our
# JSON routes worked perfectly.
#
# THE FIX: put the filename in the QUERY STRING and leave the PATH extensionless.
# Verified against their gateway: "/pixaroma/api/version?name=icons/ui/play.svg"
# is forwarded and answers 200, so they inspect the path only.
#
# Containment mirrors the vendor route exactly: reject "..", allow only a safe
# charset, then realpath and require the result to still sit under the assets
# directory. See .claude/patterns/path-containment.md - a check against an
# attacker-supplied root guards nothing, so the root here is our own constant.
@PromptServer.instance.routes.get("/pixaroma/api/asset")
async def serve_pixaroma_asset_q(request):
    rel = request.query.get("path", "")
    if not rel or ".." in rel.split("/") or not _VENDOR_PATH_RE.match(rel):
        return web.Response(status=400)
    file_path = os.path.realpath(os.path.join(PIXAROMA_ASSETS_DIR, rel))
    if not file_path.startswith(PIXAROMA_ASSETS_DIR + os.sep):
        return web.Response(status=403)
    if not os.path.isfile(file_path):
        return web.Response(status=404)
    return web.FileResponse(file_path)


# The ORIGINAL path-based asset urls. Still served (older saved workflows and any
# third-party reference keep working); the query form above is what the frontend
# asks for now. Two urls, ONE handler, so the containment checks below are
# written once and cannot drift apart.
#
#   /pixaroma/assets/...       the original, still used by older workflows
#   /pixaroma/api/assets/...   what the frontend asks for now
#
# WHY the second one exists (measured on a cloud platform, 2026-08-04): their
# gateway forwards anything under "/pixaroma/api/" to ComfyUI, and blocks
# "/pixaroma/assets/" at the edge before it ever arrives. Proven by asking for a
# path that does not exist under each: under /pixaroma/api/ you get ComfyUI's own
# empty 404, under /pixaroma/assets/ you get their web server's HTML 404. Same
# file, same auth token, different answer. So every icon, sound and font 404'd
# there while our API routes worked fine.
@PromptServer.instance.routes.get("/pixaroma/api/assets/{filename}")
@PromptServer.instance.routes.get("/pixaroma/assets/{filename}")
async def serve_pixaroma_asset(request):
    filename = request.match_info["filename"]
    if not _SAFE_ID_RE.match(
        filename.replace(".", "").replace("-", "").replace("_", "")
    ):
        return web.Response(status=400)
    file_path = os.path.realpath(os.path.join(PIXAROMA_ASSETS_DIR, filename))
    if not file_path.startswith(PIXAROMA_ASSETS_DIR + os.sep):
        return web.Response(status=403)
    if not os.path.isfile(file_path):
        return web.Response(status=404)
    return web.FileResponse(file_path)


@PromptServer.instance.routes.get("/pixaroma/api/assets/{subdir}/{filename}")
@PromptServer.instance.routes.get("/pixaroma/assets/{subdir}/{filename}")
async def serve_pixaroma_asset_sub(request):
    subdir = request.match_info["subdir"]
    filename = request.match_info["filename"]
    for part in (subdir, filename.replace(".", "").replace("-", "").replace("_", "")):
        if not _SAFE_ID_RE.match(part):
            return web.Response(status=400)
    file_path = os.path.realpath(os.path.join(PIXAROMA_ASSETS_DIR, subdir, filename))
    if not file_path.startswith(PIXAROMA_ASSETS_DIR + os.sep):
        return web.Response(status=403)
    if not os.path.isfile(file_path):
        return web.Response(status=404)
    return web.FileResponse(file_path)


@PromptServer.instance.routes.get("/pixaroma/api/assets/{subdir}/{subdir2}/{filename}")
@PromptServer.instance.routes.get("/pixaroma/assets/{subdir}/{subdir2}/{filename}")
async def serve_pixaroma_asset_sub2(request):
    subdir = request.match_info["subdir"]
    subdir2 = request.match_info["subdir2"]
    filename = request.match_info["filename"]
    for part in (subdir, subdir2, filename.replace(".", "").replace("-", "").replace("_", "")):
        if not _SAFE_ID_RE.match(part):
            return web.Response(status=400)
    file_path = os.path.realpath(
        os.path.join(PIXAROMA_ASSETS_DIR, subdir, subdir2, filename)
    )
    if not file_path.startswith(PIXAROMA_ASSETS_DIR + os.sep):
        return web.Response(status=403)
    if not os.path.isfile(file_path):
        return web.Response(status=404)
    return web.FileResponse(file_path)


PIXAROMA_NOTE_ICONS_DIR = os.path.realpath(
    os.path.join(PIXAROMA_ASSETS_DIR, "icons", "note")
)


def _derive_icon_label(stem: str) -> str:
    """Derive a human-readable label from a kebab/snake filename stem.

    Rules (per spec 2026-04-21-note-inline-icons-design.md):
      - Split on '-' and '_'.
      - Preserve all-uppercase segments (CLIP, VAE, GGUF, LORA).
      - Lowercase mixed/lowercase segments.
      - Join with spaces.
      - Capitalize first letter of the result.
    """
    parts = re.split(r"[-_]", stem)
    mapped = []
    for p in parts:
        if p and p == p.upper() and any(c.isalpha() for c in p):
            mapped.append(p)
        else:
            mapped.append(p.lower())
    joined = " ".join(mapped).strip()
    if not joined:
        return stem
    return joined[0].upper() + joined[1:]


def _read_pixaroma_version():
    """Read the plugin version from pyproject.toml FRESH on every call (NOT cached).

    Reading a ~1KB TOML on the rare Version Check request is negligible, and a fresh
    read means a version bump on disk is reflected immediately — WITHOUT a ComfyUI
    restart. The old module-global cache held the version read at STARTUP, so after
    an update (files bumped, browser hard-refreshed) the server kept reporting the
    old number while the JS reported the new one, firing a FALSE "browser cache
    outdated" warning even though the install was correct. Returns a string or
    'unknown'."""
    version = "unknown"
    try:
        import toml

        toml_path = os.path.join(os.path.dirname(__file__), "pyproject.toml")
        with open(toml_path, "r", encoding="utf-8") as f:
            version = toml.load(f).get("project", {}).get("version", "unknown")
    except Exception:
        # toml not installed, or file unreadable — fall back to a manual scan
        try:
            toml_path = os.path.join(os.path.dirname(__file__), "pyproject.toml")
            with open(toml_path, "r", encoding="utf-8") as f:
                for line in f:
                    m = re.match(r'\s*version\s*=\s*["\']([^"\']+)["\']', line)
                    if m:
                        version = m.group(1)
                        break
        except Exception:
            pass
    return version


@PromptServer.instance.routes.get("/pixaroma/api/version")
async def pixaroma_version(request):
    """Return the Pixaroma plugin version for the Version Check node."""
    return web.json_response({"version": _read_pixaroma_version()})


@PromptServer.instance.routes.get("/pixaroma/api/sounds")
async def pixaroma_sounds(request):
    """List the chime/notification sounds in assets/sounds/.

    Used by Run Timer Pixaroma's settings to populate the chime-sound picker.
    Mirrors node_notify._list_sounds(); the files themselves are served by the
    existing /pixaroma/assets/sounds/<filename> route. Returns
    { "sounds": [ "Vista.mp3", ... ] } (empty list on a missing folder/error).
    """
    sounds_dir = os.path.join(PIXAROMA_ASSETS_DIR, "sounds")
    try:
        if not os.path.isdir(sounds_dir):
            return web.json_response({"sounds": []})
        # Only list files the asset-serving route can actually deliver: its
        # filename check is _SAFE_ID_RE on the name minus dots/dashes/underscores,
        # so a name with a space (e.g. "My Chime.mp3") would 400 on playback.
        # Filtering here keeps the picker from offering an unplayable file.
        files = sorted(
            f for f in os.listdir(sounds_dir)
            if f.lower().endswith((".mp3", ".wav", ".ogg"))
            and _SAFE_ID_RE.match(f.replace(".", "").replace("-", "").replace("_", ""))
        )
        return web.json_response({"sounds": files})
    except Exception:
        return web.json_response({"sounds": []})


@PromptServer.instance.routes.get("/pixaroma/api/krea_lora/inspect")
async def krea_lora_inspect(request):
    """Detection info for the Krea LoRA Converter node's live readout.

    Given a lora filename (as listed in the node's dropdown), report whether it
    is a fal Krea 2 LoRA, how many layers convert, and the suggested output name.
    """
    name = request.query.get("lora_name", "")
    try:
        return web.json_response(_krea_lora_inspect(name))
    except Exception as exc:
        return web.json_response({"ok": False, "message": "Inspect failed: {}".format(exc)})


@PromptServer.instance.routes.post("/pixaroma/api/krea_lora/convert")
async def krea_lora_convert(request):
    """Convert a fal Krea 2 LoRA to ComfyUI format (the node's Convert button)."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "message": "Bad request."}, status=400)
    if not isinstance(data, dict):
        return web.json_response({"ok": False, "message": "Bad request."}, status=400)
    name = data.get("lora_name", "")
    out = data.get("output_name", "")
    overwrite = bool(data.get("overwrite", False))
    try:
        return web.json_response(_krea_lora_convert(name, out, overwrite))
    except Exception as exc:
        return web.json_response({"ok": False, "message": "Convert failed: {}".format(exc)})


@PromptServer.instance.routes.get("/pixaroma/api/note/icons/list")
async def list_note_icons(request):
    """Enumerate the note inline-icon folder.

    Returns { "icons": [ { "id", "label", "url" }, ... ] } sorted by label.
    Empty list on error or missing folder — the frontend handles both
    empty-folder and route-failure with the same "No icons found" UI.
    """
    try:
        if not os.path.isdir(PIXAROMA_NOTE_ICONS_DIR):
            return web.json_response({"icons": []})
        entries = []
        for name in os.listdir(PIXAROMA_NOTE_ICONS_DIR):
            if not name.lower().endswith(".svg"):
                continue
            stem = name[:-4]
            # Slug must match the frontend sanitizer regex
            # /^[A-Za-z0-9_-]{1,64}$/ — reject anything else so we
            # never hand the frontend an id it would later strip.
            if not re.match(r"^[A-Za-z0-9_-]{1,64}$", stem):
                continue
            entries.append({
                "id": stem,
                "label": _derive_icon_label(stem),
                # The /pixaroma/api/ form: a hosted ComfyUI's gateway forwards
                # that prefix and blocks /pixaroma/assets/ at the edge. This
                # value is handed straight to the browser, so it must be the
                # reachable one. The frontend still runs it through pixApiUrl()
                # to pick up any auth token the host requires.
                # The TAIL only. The frontend hands this to pixAsset(), which
                # builds the extensionless /pixaroma/api/asset?path=... url a
                # hosted ComfyUI's gateway will actually forward, and adds any
                # auth token that host requires. Do NOT put a full path here:
                # a url ending .svg is intercepted by their static file server.
                "url": f"icons/note/{name}",
            })
        entries.sort(key=lambda e: e["label"].lower())
        return web.json_response({"icons": entries})
    except Exception:
        # Never 500 on a listing failure — frontend treats empty list as
        # "no icons", which is the least-surprising UX.
        return web.json_response({"icons": []})


@PromptServer.instance.routes.get("/pixaroma/api/fonts/list")
async def pixaroma_fonts_list(request):
    """Return the merged builtin + custom font catalog. `?refresh=1` rescans
    the drop-in folder first. See docs/text-overlay-render.md for the contract."""
    refresh = request.rel_url.query.get("refresh") in ("1", "true", "yes")
    try:
        return web.json_response(_font_full_catalog(refresh=refresh))
    except Exception as e:
        # Never 500 on a listing failure — empty means "no fonts" to the UI.
        print(f"[Pixaroma] font catalog build failed: {e}")
        return web.json_response([])


_FONT_NAME_RE = re.compile(r"^[^/\\]+\.(ttf|otf)$", re.IGNORECASE)


@PromptServer.instance.routes.get("/pixaroma/api/fonts/file/{name}")
async def pixaroma_fonts_file(request):
    """Serve a user drop-in font file by exact name, with a realpath guard."""
    name = request.match_info["name"]
    if not name or ".." in name or not _FONT_NAME_RE.match(name):
        return web.Response(status=400)
    path = _font_resolve_custom(name)
    if not path:
        return web.Response(status=404)
    ext = os.path.splitext(name)[1].lower()
    ctype = "font/otf" if ext == ".otf" else "font/ttf"
    headers = {"Cache-Control": "public, max-age=3600", "Content-Type": ctype}
    return web.FileResponse(path, headers=headers)


PIXAROMA_INPUT_ROOT = os.path.realpath(
    os.path.join(folder_paths.get_input_directory(), "pixaroma")
)
os.makedirs(PIXAROMA_INPUT_ROOT, exist_ok=True)

# Max payload: 50 MB of base64 text (≈ 37 MB image)
_MAX_B64_BYTES = 50 * 1024 * 1024
# Only alphanumeric, hyphen, underscore allowed in caller-supplied IDs
_SAFE_ID_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")
_MAX_ID_LEN = 64


def _sanitize_id(value: str, fallback: str) -> str:
    """Return value only if it matches the safe-ID pattern, else fallback."""
    if value and len(value) <= _MAX_ID_LEN and _SAFE_ID_RE.match(value):
        return value
    return fallback


def _safe_path(filename: str) -> str | None:
    """
    Build an absolute path inside PIXAROMA_INPUT_ROOT.
    Returns None if the resolved path would escape the root (path traversal guard).
    Defensively ensures the root exists — the module-load os.makedirs at the top
    of this file can no-op silently if folder_paths.get_input_directory() returned
    a stale path at startup (e.g. an extra_model_paths.yaml override that
    references a deleted/moved install). Subsequent img.save() would then 500
    with FileNotFoundError. Re-creating here is a 1-syscall idempotent guard.
    """
    full = os.path.realpath(os.path.join(PIXAROMA_INPUT_ROOT, filename))
    if (
        not full.startswith(PIXAROMA_INPUT_ROOT + os.sep)
        and full != PIXAROMA_INPUT_ROOT
    ):
        return None
    try:
        os.makedirs(os.path.dirname(full), exist_ok=True)
    except OSError as e:
        print(f"[PixaromaCrop] could not create {os.path.dirname(full)}: {e}")
        return None
    return full


def _decode_image(b64_data: str) -> Image.Image | None:
    """Decode a data-URI base64 string into a PIL Image, or return None on failure."""
    if not b64_data.startswith("data:image"):
        return None
    if len(b64_data) > _MAX_B64_BYTES:
        return None
    try:
        _, b64_raw = b64_data.split(",", 1)
        image_data = base64.b64decode(b64_raw)
        img = Image.open(io.BytesIO(image_data))
        # Reject absurd dimensions before convert() allocates memory
        # (decompression-bomb guard; no legitimate source exceeds this).
        if img.width > 16384 or img.height > 16384:
            return None
        return img
    except Exception:
        return None


_MAX_IMAGE_EDGE = 16384


def _decode_bare_b64_image(b64_raw: str):
    """Decode a BARE base64 image body (no data: prefix) with the SAME
    decompression-bomb guard _decode_image applies.

    Exists because /pixaroma/remove_bg hand-rolled its decode and kept only the
    byte cap, dropping the dimension check every other decode site has
    (2026-08-03 audit). A ~89 Mpx PNG compresses to well under the 50 MB cap and
    then goes straight into a BiRefNet / rembg forward pass, so the missing
    check was the difference between a rejected request and an OOM.
    """
    img = Image.open(io.BytesIO(base64.b64decode(b64_raw)))
    if img.width > _MAX_IMAGE_EDGE or img.height > _MAX_IMAGE_EDGE:
        raise ValueError(
            f"image is {img.width}x{img.height}; the limit is "
            f"{_MAX_IMAGE_EDGE}x{_MAX_IMAGE_EDGE}"
        )
    return img


def _embed_workflow_metadata(workflow, prompt) -> PngInfo:
    """Return a PngInfo with `prompt` and `workflow` tEXt chunks,
    matching the byte format ComfyUI's built-in SaveImage writes.
    Either argument may be None (chunk is then skipped).
    Thin compatibility wrapper around nodes._save_helpers._build_pnginfo."""
    return _build_pnginfo(prompt=prompt, workflow=workflow)


# ── `if not isinstance(<body>, dict): <body> = {}` - why EVERY json route has it ──
#
# `await request.json()` does NOT check Content-Type and does not require an
# object, so a body of `[1]` / `"x"` / `5` / `true` parses fine and is TRUTHY.
# The old house idiom `data = data or {}` therefore let it straight through to
# `.get()`, which raises AttributeError out of the handler and 500s the route -
# and every one of these routes is UNAUTHENTICATED, so any page the user visits
# can do it. Only the FALSY non-dicts (`[]`, `""`, `0`, `null`) were ever caught,
# which is why the shape survived in a dozen routes for a year.
#
# Swept across all of them 2026-08-05 after a review found two. Add the guard to
# any new json route; `or {}` alone is not enough.
# Harness: D:\Claude Tests\_json_body_guard_test.py

@PromptServer.instance.routes.post("/pixaroma/api/layer/upload")
async def upload_raw_layer(request):
    data = await request.json()
    if not isinstance(data, dict):
        data = {}
    b64_data = data.get("image", "")
    raw_id = data.get("layer_id", "")
    layer_id = _sanitize_id(raw_id, str(uuid.uuid4()).replace("-", ""))

    img = _decode_image(b64_data)
    if img is None:
        return web.json_response({"error": "Invalid image data"}, status=400)

    filename = f"layer_{layer_id}.png"
    file_path = _safe_path(filename)
    if file_path is None:
        return web.json_response({"error": "Invalid layer id"}, status=400)

    img.save(file_path, "PNG")
    relative_path = os.path.join("pixaroma", filename).replace("\\", "/")
    return web.json_response({"path": relative_path})


@PromptServer.instance.routes.post("/pixaroma/api/project/save")
async def save_project(request):
    data = await request.json()
    if not isinstance(data, dict):
        data = {}
    merged_b64 = data.get("image_merged", "")
    raw_id = data.get("project_id", "")
    project_id = _sanitize_id(raw_id, str(uuid.uuid4()).replace("-", ""))

    img = _decode_image(merged_b64)
    if img is None:
        return web.json_response({"error": "Invalid image data"}, status=400)

    filename = f"composite_{project_id}.png"
    file_path = _safe_path(filename)
    if file_path is None:
        return web.json_response({"error": "Invalid project id"}, status=400)

    img.save(file_path, "PNG")
    relative_path = os.path.join("pixaroma", filename).replace("\\", "/")
    return web.json_response({"status": "success", "composite_path": relative_path})


@PromptServer.instance.routes.post("/pixaroma/api/paint/save")
async def save_paint_composite(request):
    data = await request.json()
    if not isinstance(data, dict):
        data = {}
    merged_b64 = data.get("image_merged", "")
    raw_id = data.get("project_id", "")
    project_id = _sanitize_id(raw_id, str(uuid.uuid4()).replace("-", ""))

    img = _decode_image(merged_b64)
    if img is None:
        return web.json_response({"error": "Invalid image data"}, status=400)

    filename = f"paint_composite_{project_id}.png"
    file_path = _safe_path(filename)
    if file_path is None:
        return web.json_response({"error": "Invalid project id"}, status=400)

    img.save(file_path, "PNG")
    relative_path = os.path.join("pixaroma", filename).replace("\\", "/")
    return web.json_response({"status": "success", "composite_path": relative_path})


@PromptServer.instance.routes.post("/pixaroma/api/3d/save")
async def save_3d_render(request):
    data = await request.json()
    if not isinstance(data, dict):
        data = {}
    merged_b64 = data.get("image_merged", "")
    raw_id = data.get("project_id", "")
    project_id = _sanitize_id(raw_id, str(uuid.uuid4()).replace("-", ""))

    img = _decode_image(merged_b64)
    if img is None:
        return web.json_response({"error": "Invalid image data"}, status=400)

    filename = f"3d_render_{project_id}.png"
    file_path = _safe_path(filename)
    if file_path is None:
        return web.json_response({"error": "Invalid project id"}, status=400)

    img.save(file_path, "PNG")
    relative_path = os.path.join("pixaroma", filename).replace("\\", "/")
    return web.json_response({"status": "success", "composite_path": relative_path})


@PromptServer.instance.routes.post("/pixaroma/api/3d/model_upload")
async def save_3d_model_upload(request):
    """Accepts a base64 GLB/GLTF/OBJ upload and stores it under
    input/pixaroma/<project_id>/models/<sha1>.<ext>. Returns the
    relative path (under the pixaroma input root) so the frontend
    can serve it via /view?type=input&subfolder=…."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"status": "error", "msg": "bad_json"}, status=400)

    if not isinstance(data, dict):
        data = {}
    raw_id = data.get("project_id", "")
    project_id = _sanitize_id(raw_id, str(uuid.uuid4()).replace("-", ""))
    filename = data.get("filename", "")
    b64 = data.get("data", "")

    if not re.match(
        r"^[a-zA-Z0-9_\-. ]+\.(glb|gltf|obj|mtl|jpg|jpeg|png|bmp|tga|webp|tif|tiff)$",
        filename,
        re.IGNORECASE,
    ):
        return web.json_response(
            {"status": "error", "msg": "bad_filename"}, status=400,
        )
    if len(b64) > _MAX_B64_BYTES:
        return web.json_response(
            {"status": "error", "msg": "too_large"}, status=413,
        )

    # Strip optional data URL prefix (the frontend sends `readAsDataURL`).
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return web.json_response({"status": "error", "msg": "bad_base64"}, status=400)

    # Store under input/pixaroma/<project_id>/models/<filename>.
    # Preserve the original (sanitized) filename so companion files in
    # an OBJ bundle — .mtl referencing .jpg textures by name — keep
    # their relative links working once served over /view. Repeat
    # uploads within a project overwrite, which is usually desired.
    safe_name = re.sub(r"[^a-zA-Z0-9_\-. ]", "_", filename)
    rel_subpath = os.path.join(project_id, "models", safe_name)
    full_path = _safe_path(rel_subpath)
    if full_path is None:
        return web.json_response({"status": "error", "msg": "bad_path"}, status=400)

    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "wb") as f:
        f.write(raw)

    rel = os.path.join("pixaroma", rel_subpath).replace("\\", "/")
    return web.json_response(
        {"status": "success", "path": rel, "filename": safe_name},
    )


@PromptServer.instance.routes.post("/pixaroma/api/3d/bg_upload")
async def save_3d_bg_image(request):
    data = await request.json()
    if not isinstance(data, dict):
        data = {}
    b64_data = data.get("image", "")
    raw_id = data.get("project_id", "")
    project_id = _sanitize_id(raw_id, str(uuid.uuid4()).replace("-", ""))

    img = _decode_image(b64_data)
    if img is None:
        return web.json_response({"error": "Invalid image data"}, status=400)

    filename = f"3d_bg_{project_id}.png"
    file_path = _safe_path(filename)
    if file_path is None:
        return web.json_response({"error": "Invalid project id"}, status=400)

    img.save(file_path, "PNG")
    relative_path = os.path.join("pixaroma", filename).replace("\\", "/")
    return web.json_response({"status": "success", "path": relative_path})


# ── Image Crop: one file per SAVE, not one per node (GitLab #22) ─────────────
# Both crop routes used to write `crop_<kind>_<project_id>.png`, and project_id
# is created ONCE per node and never changes. So a second crop overwrote the
# file an ALREADY-QUEUED job was pointing at: crop A -> queue, crop B -> queue,
# crop C -> queue, run, and all three jobs render C. The rect was never the
# problem (it is a widget value, so ComfyUI snapshots it per job correctly) -
# only the pixels behind it. Measured before the fix: 4 of 5 jobs read someone
# else's image.
#
# Each save now gets its own file, so a queued job's path keeps its pixels. The
# frontend stores whatever path the route returns, so this is server-side only.
#
# The cost of unique names is that they accumulate, and nothing has ever cleaned
# these up - so we keep the newest few PER PROJECT and drop the rest. Bounded per
# node rather than unbounded, and to lose a file you would have to queue a job
# and then make KEEP more crops on that same node before the queue drained.
#
# ⚠️ The `__` between the id and the stamp is load-bearing twice: it stops
# project "crop_1" pruning project "crop_12"'s files, and it means the LEGACY
# `crop_<kind>_<project_id>.png` written by older builds never matches, so a
# workflow saved before this change keeps the file it still references.
_CROP_KEEP_PER_PROJECT = 20


def _crop_save_unique(prefix, project_id, img):
    """Save `img` under a fresh name for this project. Returns the relative path
    the frontend should store, or None if the path guard refused it."""
    stamp = uuid.uuid4().hex[:12]
    filename = f"{prefix}_{project_id}__{stamp}.png"
    file_path = _safe_path(filename)
    if file_path is None:
        return None
    img.save(file_path, "PNG")
    _crop_prune(prefix, project_id)
    return os.path.join("pixaroma", filename).replace("\\", "/")


def _crop_prune(prefix, project_id, keep=_CROP_KEEP_PER_PROJECT):
    """Drop this project's oldest saves beyond `keep`. Never raises into the
    response - failing to tidy up must not fail the save itself."""
    try:
        folder = os.path.join(PIXAROMA_INPUT_ROOT)
        match = f"{prefix}_{project_id}__"
        entries = []
        for name in os.listdir(folder):
            if not name.startswith(match) or not name.endswith(".png"):
                continue
            full = os.path.join(folder, name)
            try:
                entries.append((os.path.getmtime(full), full))
            except OSError:
                pass
        entries.sort(reverse=True)          # newest first
        for _mtime, full in entries[keep:]:
            try:
                os.remove(full)
            except OSError:
                pass
    except Exception:
        pass


@PromptServer.instance.routes.post("/pixaroma/api/crop/save")
async def save_crop_composite(request):
    data = await request.json()
    if not isinstance(data, dict):
        data = {}
    merged_b64 = data.get("image_merged", "")
    raw_id = data.get("project_id", "")
    project_id = _sanitize_id(raw_id, str(uuid.uuid4()).replace("-", ""))

    img = _decode_image(merged_b64)
    if img is None:
        return web.json_response({"error": "Invalid image data"}, status=400)

    relative_path = _crop_save_unique("crop_composite", project_id, img)
    if relative_path is None:
        return web.json_response({"error": "Invalid project id"}, status=400)
    return web.json_response({"status": "success", "composite_path": relative_path})


@PromptServer.instance.routes.post("/pixaroma/api/crop/upload_src")
async def upload_crop_source(request):
    data = await request.json()
    if not isinstance(data, dict):
        data = {}
    b64_data = data.get("image", "")
    raw_id = data.get("project_id", "")
    project_id = _sanitize_id(raw_id, str(uuid.uuid4()).replace("-", ""))

    img = _decode_image(b64_data)
    if img is None:
        return web.json_response({"error": "Invalid image data"}, status=400)

    relative_path = _crop_save_unique("crop_src", project_id, img)
    if relative_path is None:
        return web.json_response({"error": "Invalid project id"}, status=400)
    return web.json_response({"status": "success", "path": relative_path})


# ────────────────────────────────────────────────────────────
# Inpaint Crop Pixaroma — source + painted-mask upload
# ────────────────────────────────────────────────────────────

@PromptServer.instance.routes.post("/pixaroma/api/inpaint/upload_src")
async def upload_inpaint_source(request):
    data = await request.json()
    if not isinstance(data, dict):
        data = {}
    raw_id = data.get("project_id", "")
    project_id = _sanitize_id(raw_id, str(uuid.uuid4()).replace("-", ""))

    img = _decode_image(data.get("image", ""))
    if img is None:
        return web.json_response({"error": "Invalid image data"}, status=400)

    filename = f"inpaint_src_{project_id}.png"
    file_path = _safe_path(filename)
    if file_path is None:
        return web.json_response({"error": "Invalid project id"}, status=400)

    try:
        img.convert("RGB").save(file_path, "PNG")
    except Exception as e:
        return web.json_response({"error": f"Failed to process image: {e}"}, status=400)
    relative_path = os.path.join("pixaroma", filename).replace("\\", "/")
    return web.json_response({"status": "success", "path": relative_path})


@PromptServer.instance.routes.post("/pixaroma/api/inpaint/save_mask")
async def save_inpaint_mask(request):
    data = await request.json()
    if not isinstance(data, dict):
        data = {}
    raw_id = data.get("project_id", "")
    project_id = _sanitize_id(raw_id, str(uuid.uuid4()).replace("-", ""))

    img = _decode_image(data.get("mask", ""))
    if img is None:
        return web.json_response({"error": "Invalid mask data"}, status=400)

    filename = f"inpaint_mask_{project_id}.png"
    file_path = _safe_path(filename)
    if file_path is None:
        return web.json_response({"error": "Invalid project id"}, status=400)

    # Painted mask: white = inpaint here. Store as 8-bit grayscale.
    try:
        img.convert("L").save(file_path, "PNG")
    except Exception as e:
        return web.json_response({"error": f"Failed to process mask: {e}"}, status=400)
    relative_path = os.path.join("pixaroma", filename).replace("\\", "/")
    return web.json_response({"status": "success", "path": relative_path})


# ────────────────────────────────────────────────────────────
# AudioReact Pixaroma — inline image / audio upload
# ────────────────────────────────────────────────────────────

ALLOWED_AUDIO_STUDIO_IMAGE_EXTS = {"png", "jpg", "jpeg", "webp"}
ALLOWED_AUDIO_STUDIO_AUDIO_EXTS = {"wav"}  # WAV only — browser converts before upload
_AUDIO_STUDIO_NODE_ID_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")
_AUDIO_STUDIO_MAX_FILE_BYTES = 50 * 1024 * 1024   # 50 MB per file
_AUDIO_STUDIO_MAX_DIR_BYTES  = 100 * 1024 * 1024  # 100 MB combined per node


@PromptServer.instance.routes.get("/pixaroma/api/audio_studio/sysinfo")
async def audio_studio_sysinfo(request):
    """Report total + currently-available system RAM so the editor can show
    a live "this render needs ~X GB" estimate. Mirrors the safety check in
    nodes/_audio_react_engine.py::generate_video — UI shows the same numbers
    the engine will use, no run-time surprises."""
    info = {"total_gb": None, "available_gb": None, "cap_gb": None}
    try:
        import psutil
        vm = psutil.virtual_memory()
        info["total_gb"] = vm.total / (1024 ** 3)
        info["available_gb"] = vm.available / (1024 ** 3)
        info["cap_gb"] = info["available_gb"] * 0.90
    except Exception:
        pass
    return web.json_response(info)


@PromptServer.instance.routes.post("/pixaroma/api/audio_studio/upload")
async def audio_studio_upload(request):
    reader = await request.multipart()

    node_id = None
    kind = None
    file_bytes = None
    file_filename = None

    while True:
        field = await reader.next()
        if field is None:
            break
        if field.name == "node_id":
            node_id = (await field.text()).strip()
        elif field.name == "kind":
            kind = (await field.text()).strip()
        elif field.name == "file":
            file_filename = field.filename or ""
            file_bytes = await field.read(decode=False)

    if not node_id or not _AUDIO_STUDIO_NODE_ID_RE.match(node_id) or len(node_id) > 64:
        return web.json_response(
            {"error": "Invalid node_id (must match [a-zA-Z0-9_-]{1,64})."},
            status=400,
        )
    if kind not in ("image", "audio"):
        return web.json_response(
            {"error": "kind must be 'image' or 'audio'."}, status=400,
        )
    if not file_bytes or not file_filename:
        return web.json_response({"error": "file field is missing."}, status=400)
    if len(file_bytes) > _AUDIO_STUDIO_MAX_FILE_BYTES:
        return web.json_response(
            {"error": f"file too large (>{_AUDIO_STUDIO_MAX_FILE_BYTES} bytes)."},
            status=400,
        )

    ext = file_filename.rsplit(".", 1)[-1].lower() if "." in file_filename else ""
    if kind == "image" and ext not in ALLOWED_AUDIO_STUDIO_IMAGE_EXTS:
        return web.json_response(
            {"error": (
                f"image extension {ext!r} not allowed; use one of "
                f"{sorted(ALLOWED_AUDIO_STUDIO_IMAGE_EXTS)}."
            )},
            status=400,
        )
    if kind == "audio" and ext not in ALLOWED_AUDIO_STUDIO_AUDIO_EXTS:
        return web.json_response(
            {"error": (
                "audio extension " + repr(ext) + " not allowed; only WAV is "
                "accepted (the browser converts other formats before upload)."
            )},
            status=400,
        )

    # Build the per-node directory path and containment-check it.
    rel_dir = os.path.join("audio_studio", node_id)
    target_dir = _safe_path(rel_dir)
    if target_dir is None:
        return web.json_response({"error": "path traversal blocked."}, status=400)
    os.makedirs(target_dir, exist_ok=True)

    # Replace any existing files of the same kind (potentially different ext).
    import glob as _glob
    for existing in _glob.glob(os.path.join(target_dir, kind + ".*")):
        try:
            os.unlink(existing)
        except OSError:
            pass

    rel_target = os.path.join("audio_studio", node_id, f"{kind}.{ext}")
    target_path = _safe_path(rel_target)
    if target_path is None:
        return web.json_response({"error": "path traversal blocked."}, status=400)

    # Combined-size cap: everything already in the dir (excluding the file
    # we're about to overwrite, which was already removed above) plus the
    # incoming file.
    target_basename = os.path.basename(target_path)
    try:
        other_size = sum(
            os.path.getsize(f)
            for f in _glob.glob(os.path.join(target_dir, "*"))
            if os.path.isfile(f) and os.path.basename(f) != target_basename
        )
    except OSError:
        other_size = 0
    if other_size + len(file_bytes) > _AUDIO_STUDIO_MAX_DIR_BYTES:
        return web.json_response(
            {"error": (
                f"per-node combined size cap "
                f"({_AUDIO_STUDIO_MAX_DIR_BYTES} bytes) exceeded."
            )},
            status=400,
        )

    with open(target_path, "wb") as fh:
        fh.write(file_bytes)

    rel = f"audio_studio/{node_id}/{kind}.{ext}"
    return web.json_response({"path": rel})


# ── Load Video Pixaroma: video upload ────────────────────────────────────────
_LOAD_VIDEO_UPLOAD_EXTS = {
    "mp4", "mov", "mkv", "webm", "avi", "m4v", "gif",
    "mpg", "mpeg", "wmv", "flv", "ogv", "ts",
}
_LOAD_VIDEO_MAX_BYTES = 1024 * 1024 * 1024  # 1 GB
# _WIN_RESERVED_NAMES is imported at the top of this file. It used to be defined
# here as well, so the workflow folder check and this upload check were two
# copies of the same list - one source now, in the module that has tests.


@PromptServer.instance.routes.post("/pixaroma/api/load_video/upload")
async def load_video_upload(request):
    """Save an uploaded video into ComfyUI's input/ root (like native uploads)
    so the Load Video node lists it by its plain name and any other node can
    reuse it; the in-node <video> preview fetches it via /view?type=input.
    Extension allow-list, streamed size cap, path-traversal-safe target."""
    reader = await request.multipart()
    # Find the 'file' part. Validate its name/extension BEFORE reading the body
    # so the file streams straight to disk with an incremental size cap, instead
    # of buffering the whole upload (up to 1 GB) in memory first.
    field = None
    while True:
        f = await reader.next()
        if f is None:
            break
        if f.name == "file":
            field = f
            break

    if field is None or not field.filename:
        return web.json_response({"error": "file field is missing."}, status=400)

    base = os.path.basename(field.filename.replace("\\", "/"))
    stem, ext = os.path.splitext(base)
    ext = ext.lower().lstrip(".")
    if ext not in _LOAD_VIDEO_UPLOAD_EXTS:
        return web.json_response(
            {"error": f"video extension {ext!r} not allowed."}, status=400,
        )
    stem = re.sub(r"[^A-Za-z0-9_\- ]", "_", stem).strip().strip(".") or "video"
    # Reserved Windows device names (NUL/CON/COM1/...) resolve to a device, not a
    # file - suffix them so the upload writes a real file.
    if stem.upper() in _WIN_RESERVED_NAMES:
        stem = stem + "_"

    # Save into ComfyUI's input/ root (like native uploads) so the file is a
    # first-class input: it shows by its plain name and any other node that
    # lists input/ can reuse it. Claim a free filename ATOMICALLY with O_EXCL so
    # two concurrent uploads of the same name can't pick the same target and
    # clobber each other. The sanitized stem has no separators, so the target
    # stays directly under input/ (realpath-checked anyway).
    input_dir = os.path.realpath(folder_paths.get_input_directory())
    try:
        os.makedirs(input_dir, exist_ok=True)
    except OSError:
        pass
    candidate = f"{stem}.{ext}"
    n = 1
    fd = None
    target = None
    while True:
        target = os.path.realpath(os.path.join(input_dir, candidate))
        if not (target == input_dir or target.startswith(input_dir + os.sep)):
            return web.json_response({"error": "path traversal blocked."}, status=400)
        try:
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
            break
        except FileExistsError:
            candidate = f"{stem}_{n}.{ext}"
            n += 1
            if n > 100000:
                return web.json_response(
                    {"error": "could not find a free filename."}, status=500,
                )

    def _rm_target():
        try:
            os.remove(target)
        except OSError:
            pass

    # Stream chunks to the claimed file, enforcing the cap as we go; clean up the
    # partial file on overflow or any write error so input/ never accumulates
    # half-written uploads.
    written = 0
    too_big = False
    try:
        with os.fdopen(fd, "wb") as fh:
            while True:
                chunk = await field.read_chunk(262144)  # 256 KB
                if not chunk:
                    break
                written += len(chunk)
                if written > _LOAD_VIDEO_MAX_BYTES:
                    too_big = True
                    break
                fh.write(chunk)
    except Exception as e:
        _rm_target()
        print(f"[Pixaroma] Load Video — upload write failed: {e}")
        return web.json_response(
            {"error": "could not save the uploaded file."}, status=500,
        )

    if too_big:
        _rm_target()
        return web.json_response({"error": "file too large (over 1 GB)."}, status=400)
    if written == 0:
        _rm_target()
        return web.json_response({"error": "the uploaded file was empty."}, status=400)

    return web.json_response({
        "name": candidate,    # plain filename in input/ root, like native uploads
        "subfolder": "",
        "filename": candidate,
        "type": "input",
    })


@PromptServer.instance.routes.get("/pixaroma/api/load_video_frame/meta")
async def load_video_frame_meta(request):
    """Read a video's fps / frame_count / size WITHOUT decoding it, so the Load
    Video Frame picker can map its slider to frame numbers (the browser <video>
    exposes neither fps nor frame count). ?video=<annotated input path>."""
    video = request.query.get("video", "")
    if not video:
        return web.json_response({"error": "no video specified"}, status=400)
    try:
        path = folder_paths.get_annotated_filepath(video)
    except Exception:
        path = None
    if not path or not os.path.exists(path):
        return web.json_response({"error": "video not found"}, status=404)
    try:
        from .nodes._video_helpers import probe_meta
        import asyncio
        loop = asyncio.get_running_loop()
        # Opening the container + reading headers is usually fast, but keep it off
        # the aiohttp event loop so a slow/huge file can't stall other requests.
        meta = await loop.run_in_executor(None, probe_meta, path)
        return web.json_response(meta)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# Canonical list of bg-removal models shown in the Image Composer
# dropdown. Each entry carries:
#   id      — rembg session name (also dropdown `value`)
#   label   — human-friendly name the user sees
#   hint    — short description shown under the name
#   sizeMB  — approximate download size
#   minRembg — "0" means always; otherwise SemVer gate checked by info
# `auto` is a virtual option; the server picks the best available.
REMBG_MODELS = [
    {"id": "auto",              "label": "Auto (recommended)", "hint": "Picks the best available model",   "sizeMB": 0,   "minRembg": "0"},
    {"id": "u2net",             "label": "Fast",               "hint": "Works on any rembg install (u2net)", "sizeMB": 176, "minRembg": "0"},
    {"id": "isnet-general-use", "label": "Balanced",           "hint": "Cleaner edges than u2net (isnet)",   "sizeMB": 170, "minRembg": "2.0.27"},
    {"id": "birefnet-general",  "label": "Best",               "hint": "Highest quality, large (BiRefNet)",  "sizeMB": 900, "minRembg": "2.0.56"},
]

# Fallback chain used by "auto" — tries best first.
_AUTO_ORDER = ("birefnet-general", "isnet-general-use", "u2net")


def _version_tuple(v):
    """Convert '2.0.56' → (2, 0, 56). Unknown pieces become 0."""
    out = []
    for part in (v or "0").split("."):
        try:
            out.append(int("".join(ch for ch in part if ch.isdigit()) or "0"))
        except Exception:
            out.append(0)
    while len(out) < 3:
        out.append(0)
    return tuple(out[:3])


@PromptServer.instance.routes.get("/pixaroma/remove_bg_info")
async def remove_bg_info(request):
    """Tells the frontend what's installed and what's downloadable.

    Lets the Image Composer dropdown show real model names, mark the
    ones already on disk (no download wait), and gray out options that
    need a newer rembg version."""
    info = {
        "rembgInstalled": False,
        "rembgVersion": None,
        "modelDir": REMBG_MODELS_DIR,
        "models": [],
    }
    try:
        import rembg  # noqa: F401
        info["rembgInstalled"] = True
        info["rembgVersion"] = getattr(rembg, "__version__", "unknown")
    except ImportError:
        # Still return the model catalog so the UI can show greyed
        # entries with the "install rembg" hint.
        info["models"] = [dict(m, available=False, downloaded=False) for m in REMBG_MODELS]
        info["birefnet"] = get_birefnet_inventory()
        return web.json_response(info)

    # Which model files already exist on disk — saves the download wait
    # on first use. rembg typically names files "<id>.onnx".
    downloaded_ids = set()
    try:
        if os.path.isdir(REMBG_MODELS_DIR):
            files = os.listdir(REMBG_MODELS_DIR)
            for m in REMBG_MODELS:
                if any(f.startswith(m["id"]) and f.endswith(".onnx") for f in files):
                    downloaded_ids.add(m["id"])
    except Exception:
        pass

    installed_ver = _version_tuple(info["rembgVersion"])
    out_models = []
    for m in REMBG_MODELS:
        req = _version_tuple(m["minRembg"])
        available = installed_ver >= req
        out_models.append(dict(m, available=available, downloaded=m["id"] in downloaded_ids))
    info["models"] = out_models
    info["birefnet"] = get_birefnet_inventory()
    return web.json_response(info)


@PromptServer.instance.routes.post("/pixaroma/remove_bg")
async def remove_bg(request):
    data = await request.json()
    if not isinstance(data, dict):
        data = {}
    b64_data = data.get("image", "")
    # Accept the new explicit `model` field; fall back to legacy `quality`
    # ("normal"/"high") so old clients keep working.
    model = data.get("model") or data.get("quality") or "auto"
    legacy_map = {"normal": "isnet-general-use", "high": "birefnet-general"}
    model = legacy_map.get(model, model)

    if b64_data.startswith("data:image"):
        b64_data = b64_data.split(",", 1)[1]

    if len(b64_data) > _MAX_B64_BYTES:
        return web.json_response({"error": "Image too large"}, status=413)

    # ----------- BiRefNet branch (new in 1.3.34) -----------
    # If the client picked one of our BiRefNet variants, route through
    # the Pixaroma loader instead of rembg. No rembg dep required.
    if is_birefnet_model_id(model):
        try:
            input_image = _decode_bare_b64_image(b64_data)
            print(f"[Pixaroma] AI Remove Background: BiRefNet {model!r} on {input_image.size[0]}x{input_image.size[1]}...")
            output_image = run_birefnet_on_pil(input_image, model)
            buffered = io.BytesIO()
            output_image.save(buffered, format="PNG")
            output_b64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
            print(f"[Pixaroma] AI Remove Background: done ({model})")
            return web.json_response({
                "status": "success",
                "image": f"data:image/png;base64,{output_b64}",
                "modelUsed": model,
            })
        except ValueError as e:
            # File-not-found, lite-variant rejection, missing folder, etc.
            # ValueError carries our user-friendly install message.
            return web.json_response(
                {"error": str(e), "code": "BIREFNET_MISSING"},
                status=400,
            )
        except Exception as e:
            print(f"[Pixaroma] BiRefNet inference failed: {e}")
            return web.json_response(
                {"error": f"BiRefNet inference failed: {e}"},
                status=500,
            )

    # ----------- rembg branch (existing) -----------
    try:
        from rembg import remove, new_session
    except ImportError:
        return web.json_response(
            {"error": "rembg is not installed.", "code": "REMBG_MISSING"},
            status=500,
        )

    # _open_session tries the requested model, then falls back through
    # the auto chain if it isn't available. Returns (session, model_used)
    # so the client can surface the real model name to the user.
    def _open_session(requested):
        tried = []
        order = list(_AUTO_ORDER) if requested == "auto" else [requested] + [n for n in _AUTO_ORDER if n != requested]
        last_err = None
        for name in order:
            try:
                s = new_session(name)
                print(f"[Pixaroma] AI Remove Background: using model '{name}'")
                return s, name
            except Exception as e:
                last_err = e
                tried.append(name)
                print(f"[Pixaroma] model '{name}' not available: {e}")
        raise RuntimeError(f"No rembg model could be loaded (tried {tried}): {last_err}")

    try:
        session, model_used = _open_session(model)

        input_image = _decode_bare_b64_image(b64_data)
        print(f"[Pixaroma] AI Remove Background: processing {input_image.size[0]}x{input_image.size[1]} image with '{model_used}'...")
        output_image = remove(input_image, session=session)

        buffered = io.BytesIO()
        output_image.save(buffered, format="PNG")
        output_b64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
        print(f"[Pixaroma] AI Remove Background: done ({model_used})")

        return web.json_response({
            "status": "success",
            "image": f"data:image/png;base64,{output_b64}",
            "modelUsed": model_used,
        })
    except Exception as e:
        print(f"[Pixaroma] AI Remove Background: failed - {e}")
        return web.json_response({"error": f"Background removal failed: {e}"}, status=500)


@PromptServer.instance.routes.post("/pixaroma/api/preview/save")
async def api_preview_save(request):
    """Save a base64 PNG to ComfyUI's output/ folder with workflow metadata.

    Request JSON: {
        image_b64:       data-URI PNG string (required),
        filename_prefix: string 1-64 chars, [A-Za-z0-9_-] (default "Preview"),
        workflow:        JSON object from app.graph.serialize() (optional),
        prompt:          JSON object from app.graphToPrompt().output (optional),
    }
    Response JSON: { status: "success", filename, subfolder } on 200,
                   { error: "<message>" } on 400/500.
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)

    if not isinstance(data, dict):
        data = {}
    image_b64 = data.get("image_b64", "")
    prefix_raw = data.get("filename_prefix", "Preview")
    workflow = data.get("workflow")
    prompt = data.get("prompt")

    # Fall back to "Preview" if sanitization can't produce anything usable
    # (e.g. only special chars, '..' traversal, leading '/'). Matches the
    # Python node's behavior so the user always gets a successful save.
    prefix = _safe_prefix(prefix_raw) or "Preview"

    pil = _decode_image(image_b64)
    if pil is None:
        return web.json_response({"error": "invalid image data"}, status=400)

    try:
        output_dir = folder_paths.get_output_directory()
        full_folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
            prefix, output_dir, pil.width, pil.height
        )
        os.makedirs(full_folder, exist_ok=True)
        fname = f"{name}_{counter:05}_.png"
        full_path = os.path.join(full_folder, fname)
        # Carry a `parameters` (Civitai/A1111) chunk THROUGH the re-encode. The
        # browser posts the raw bytes of a PNG this plugin itself wrote, so the
        # chunk - when present - is our own output riding along; rebuilding the
        # PngInfo from scratch was silently dropping it (found in review). None
        # is a no-op in _build_pnginfo, so files without it are byte-identical.
        pnginfo = _build_pnginfo(prompt=prompt, workflow=workflow,
                                 parameters=pil.info.get("parameters"))
        pil.save(full_path, "PNG", pnginfo=pnginfo)
    except Exception as e:
        return web.json_response({"error": f"save failed: {e}"}, status=500)

    return web.json_response(
        {"status": "success", "filename": fname, "subfolder": subfolder}
    )


@PromptServer.instance.routes.post("/pixaroma/api/preview/prepare")
async def api_preview_prepare(request):
    """Embed workflow metadata into a PNG and return it alongside an
    auto-incremented suggested filename for Save-to-Disk.

    Request JSON: {
        image_b64:       data-URI PNG string (required),
        filename_prefix: string, supports subfolder/prefix (default "Preview"),
        workflow:        JSON object (optional),
        prompt:          JSON object (optional),
    }
    Response JSON: {
        image_b64:          data-URI PNG with embedded metadata,
        suggested_filename: e.g. "Preview_00012_.png" (next free counter),
    }, 400 on invalid input.
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)

    if not isinstance(data, dict):
        data = {}
    image_b64 = data.get("image_b64", "")
    prefix_raw = data.get("filename_prefix", "Preview")
    workflow = data.get("workflow")
    prompt = data.get("prompt")

    # Fall back to "Preview" if sanitization can't produce anything usable
    # (e.g. only special chars, '..' traversal, leading '/'). Matches the
    # Python node's behavior so the user always gets a successful save.
    prefix = _safe_prefix(prefix_raw) or "Preview"

    pil = _decode_image(image_b64)
    if pil is None:
        return web.json_response({"error": "invalid image data"}, status=400)

    try:
        # Same pass-through as /preview/save above: keep our own `parameters`
        # chunk across the re-encode (None is a no-op).
        pnginfo = _build_pnginfo(prompt=prompt, workflow=workflow,
                                 parameters=pil.info.get("parameters"))
        buf = io.BytesIO()
        pil.save(buf, "PNG", pnginfo=pnginfo)
        body = buf.getvalue()

        # Peek at the next free counter (read-only — no file written)
        output_dir = folder_paths.get_output_directory()
        _, name, counter, _, _ = folder_paths.get_save_image_path(
            prefix, output_dir, pil.width, pil.height
        )
        suggested_filename = f"{name}_{counter:05}_.png"
    except Exception as e:
        return web.json_response({"error": f"prepare failed: {e}"}, status=500)

    image_data_uri = "data:image/png;base64," + base64.b64encode(body).decode("ascii")
    return web.json_response({
        "image_b64": image_data_uri,
        "suggested_filename": suggested_filename,
    })


@PromptServer.instance.routes.post("/pixaroma/api/xy_plot/save")
async def api_xy_plot_save(request):
    """Save an XY Plot grid (already written to temp/ during the plot) to
    output/ with embedded workflow metadata. Optionally also write each
    individual cell into a <name>_cells/ subfolder.

    Request JSON: {
        grid_filename:   temp PNG filename of the assembled grid (required),
        session_id:      plot session id (only needed for save_cells),
        filename_prefix: output stem (default "xy_plot"),
        save_cells:      bool - also write each cell image,
        workflow/prompt: optional metadata to embed in the grid PNG,
    }
    Response JSON: { status, filename, subfolder, saved_cells } or { error }.
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)

    if not isinstance(data, dict):
        data = {}
    grid_filename = data.get("grid_filename")
    if not isinstance(grid_filename, str) or not grid_filename:
        return web.json_response({"error": "missing grid_filename"}, status=400)
    session_id = data.get("session_id")
    save_cells = data.get("save_cells") is True
    workflow = data.get("workflow")
    prompt = data.get("prompt")
    prefix = _safe_prefix(data.get("filename_prefix", "xy_plot")) or "xy_plot"

    valid_sid = isinstance(session_id, str) and bool(_SAFE_ID_RE.match(session_id)) and len(session_id) <= _MAX_ID_LEN

    # Prefer a grid re-assembled from the live session's cached cells at the user's
    # chosen Save resolution (built once, only on Save - the preview + the IMAGE
    # output stay capped at 4096). Falls back to the pre-rendered (4096-capped)
    # temp PNG when the session has been evicted or on any error.
    grid_pil = None
    if valid_sid:
        try:
            from .nodes.node_xy_plot import render_session_full, resolve_save_cap
            grid_pil = render_session_full(session_id, resolve_save_cap(data.get("save_max_size")))
        except Exception as e:
            print(f"[Pixaroma] XY Plot: full-res re-assembly failed, using preview: {e}")
            grid_pil = None

    if grid_pil is None:
        temp_dir = folder_paths.get_temp_directory()
        safe_name = os.path.basename(grid_filename)
        grid_path = os.path.join(temp_dir, safe_name)
        if not safe_name or not os.path.isfile(grid_path) or not _is_path_under(grid_path, temp_dir):
            return web.json_response({"error": "grid image not found - re-run the plot, then Save"}, status=400)
        try:
            grid_pil = Image.open(grid_path).convert("RGB")
        except Exception as e:
            return web.json_response({"error": f"could not read grid: {e}"}, status=500)

    try:
        output_dir = folder_paths.get_output_directory()
        full_folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
            prefix, output_dir, grid_pil.width, grid_pil.height
        )
        os.makedirs(full_folder, exist_ok=True)
        fname = f"{name}_{counter:05}_.png"
        pnginfo = _build_pnginfo(prompt=prompt, workflow=workflow)
        grid_pil.save(os.path.join(full_folder, fname), "PNG", pnginfo=pnginfo)
    except Exception as e:
        return web.json_response({"error": f"save failed: {e}"}, status=500)

    saved_cells = 0
    # Only attempt cells when explicitly requested AND the session id is a valid,
    # bounded token (valid_sid computed above; it keys an in-memory dict).
    if save_cells and valid_sid:
        try:
            from .nodes.node_xy_plot import snapshot_session_cells
            cells, _ = snapshot_session_cells(session_id)   # copied under the node's lock
            if cells:
                # Include the grid's counter in the folder name so saving the
                # same plot twice doesn't overwrite the first save's cells.
                cells_folder = os.path.join(full_folder, f"{name}_{counter:05}_cells")
                # Defense-in-depth: never write the cells subfolder outside output/.
                if _is_path_under(cells_folder, output_dir) or _is_path_under(os.path.dirname(cells_folder), output_dir):
                    os.makedirs(cells_folder, exist_ok=True)
                    for (xi, yi), cell in cells:
                        cell_name = f"{name}_x{xi}_y{yi}.png"
                        try:
                            cell.convert("RGB").save(os.path.join(cells_folder, cell_name), "PNG")
                            saved_cells += 1
                        except Exception:
                            pass
        except Exception as e:
            print(f"[Pixaroma] XY Plot: save cells failed: {e}")

    return web.json_response({
        "status": "success",
        "filename": fname,
        "subfolder": subfolder,
        "saved_cells": saved_cells,
        "width": grid_pil.width,
        "height": grid_pil.height,
    })


@PromptServer.instance.routes.post("/pixaroma/api/xy_plot/render_full")
async def api_xy_plot_render_full(request):
    """Return the XY Plot grid re-assembled at the requested resolution as PNG
    bytes, for the browser's Save Disk button (which downloads to the user's
    computer). Built once, on demand, from the cells cached server-side - the
    workflow/prompt are embedded so the downloaded PNG can be dragged back in.

    Request JSON: {
        session_id:    plot session id (required),
        save_max_size: "2048"|"4096"|"8192"|"full" (default 4096),
        workflow/prompt: optional metadata to embed,
    }
    Response: image/png bytes, or JSON { error } (404 when the session expired, so
    the browser can fall back to the capped preview file).
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)
    if not isinstance(data, dict):
        data = {}
    session_id = data.get("session_id")
    if not isinstance(session_id, str) or not _SAFE_ID_RE.match(session_id) or len(session_id) > _MAX_ID_LEN:
        return web.json_response({"error": "invalid session id"}, status=400)
    workflow = data.get("workflow")
    prompt = data.get("prompt")
    try:
        from .nodes.node_xy_plot import render_session_full, resolve_save_cap
        grid_pil = render_session_full(session_id, resolve_save_cap(data.get("save_max_size")))
    except Exception as e:
        return web.json_response({"error": f"render failed: {e}"}, status=500)
    if grid_pil is None:
        return web.json_response({"error": "session expired - run the plot again"}, status=404)
    try:
        buf = io.BytesIO()
        grid_pil.save(buf, "PNG", pnginfo=_build_pnginfo(prompt=prompt, workflow=workflow))
    except Exception as e:
        return web.json_response({"error": f"encode failed: {e}"}, status=500)
    return web.Response(body=buf.getvalue(), content_type="image/png")


@PromptServer.instance.routes.post("/pixaroma/api/xy_plot/restyle")
async def api_xy_plot_restyle(request):
    """Re-render the current XY Plot grid with a new color theme, without
    re-running the workflow (the cells are cached server-side). Used for the
    instant Grid theme switch.

    Request JSON: { session_id: str, theme: "dark"|"light"|"mono" }
    Response JSON: { status, filename } or { error } (404 if session expired).
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)
    if not isinstance(data, dict):
        data = {}
    session_id = data.get("session_id")
    theme = data.get("theme") or "dark"
    if not isinstance(session_id, str) or not _SAFE_ID_RE.match(session_id) or len(session_id) > _MAX_ID_LEN:
        return web.json_response({"error": "invalid session id"}, status=400)
    if theme not in ("dark", "light", "mono"):
        return web.json_response({"error": "invalid theme"}, status=400)
    try:
        from .nodes.node_xy_plot import restyle_session
        name = restyle_session(session_id, theme)
    except Exception as e:
        return web.json_response({"error": f"restyle failed: {e}"}, status=500)
    if not name:
        return web.json_response({"error": "session expired - run the plot again"}, status=404)
    return web.json_response({"status": "success", "filename": name})


# _is_path_under used to be DEFINED here. It moved to nodes/_path_guard.py
# (2026-08-03) and is imported at the top of this file, so the nodes and the
# routes share ONE copy of the containment logic instead of two that drift.
# All existing call sites below are unchanged - same name, same behaviour.


@PromptServer.instance.routes.get("/pixaroma/api/prompt_reader/extract")
async def api_prompt_reader_extract(request):
    """Live readout endpoint for Prompt Reader Pixaroma.

    Query: ?filename=<image-name>   (supports ComfyUI's [input] suffix)
    Resolves the path inside ComfyUI's input directory and returns the
    extracted positive prompt, or a short message explaining why none
    could be read. Always 200 OK so the frontend never has to branch on
    HTTP status - it just renders `text` (or `message`) in the readout.

    Path-traversal hardening: even though `folder_paths.get_annotated_filepath`
    is the ComfyUI-standard resolver, we additionally realpath the result
    and require it to live under one of ComfyUI's known input / output /
    temp directories. Multi-user deployments and tunnelled instances make
    this defensive check worthwhile (the rest of the route only reads PNG
    chunks, but a path that looks like an image to PIL could still leak
    file existence + readability info).
    """
    filename = request.query.get("filename", "")
    if not filename:
        return web.json_response({
            "found": False,
            "message": "No image selected.",
        })
    try:
        image_path = folder_paths.get_annotated_filepath(filename)
    except Exception:
        image_path = None
    # Fall back to the resolver for a bare / extension-less name (e.g. a value
    # wired from Load Image Pixaroma's filename output) so the live readout can
    # follow a connected node even when it hands us "BunnyExplorer" rather than
    # "BunnyExplorer.png".
    if not image_path or not os.path.isfile(image_path):
        resolved = resolve_input_image_name(filename)
        if resolved:
            try:
                image_path = folder_paths.get_annotated_filepath(resolved)
            except Exception:
                image_path = None
    if not image_path or not os.path.isfile(image_path):
        return web.json_response({
            "found": False,
            "message": "Image file not found in the input folder.",
        })
    allowed_roots = [
        folder_paths.get_input_directory(),
        folder_paths.get_output_directory(),
        folder_paths.get_temp_directory(),
    ]
    if not _is_path_under(image_path, *allowed_roots):
        return web.json_response({
            "found": False,
            "message": "Image path is outside the allowed directories.",
        })
    try:
        result = read_prompt_from_image(image_path)
    except Exception as e:
        return web.json_response({
            "found": False,
            "message": f"Could not read metadata: {e}",
        })
    return web.json_response(result)


# ── Load Images from Folder Pixaroma ─────────────────────────────────────────
# These routes back the node's gallery + thumbnails. They read the user's OWN
# chosen folder on the local machine (the whole point of the node), so they are
# NOT constrained to input/. They are read-only, validate the path is a real
# directory, only touch image files, and guard the per-file thumbnail against
# path-traversal out of the chosen folder via _is_path_under.
_LIF_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".tif")


def _lif_is_image(name: str) -> bool:
    return name.lower().endswith(_LIF_IMAGE_EXTS)


def _lif_list_files(real, recursive):
    """Walk a folder and return its image files. Blocking (os.walk + os.stat on
    a big tree can take seconds) - run off the event loop."""
    files = []
    if recursive:
        for root, _dirs, names in os.walk(real):
            for n in names:
                if not _lif_is_image(n):
                    continue
                full = os.path.join(root, n)
                try:
                    st = os.stat(full)
                except OSError:
                    continue
                rel = os.path.relpath(full, real).replace("\\", "/")
                files.append({"file": rel, "name": n, "size": st.st_size, "mtime": st.st_mtime})
    else:
        for n in os.listdir(real):
            full = os.path.join(real, n)
            if os.path.isfile(full) and _lif_is_image(n):
                try:
                    st = os.stat(full)
                except OSError:
                    continue
                files.append({"file": n, "name": n, "size": st.st_size, "mtime": st.st_mtime})
    return files


@PromptServer.instance.routes.get("/pixaroma/api/load_images_folder/list")
async def api_lif_list(request):
    """List image files in a folder. ?path=<folder>&recursive=0|1
    Returns {ok, folder, files:[{file, name, size, mtime}]} (file = path
    relative to the folder, forward-slashed)."""
    # no-store on every branch: the gallery re-lists on each open, and a browser
    # heuristically caching this JSON would serve a stale folder (same hardening
    # as the LoRA list route).
    hdrs = {"Cache-Control": "no-store"}
    folder = request.query.get("path", "")
    recursive = request.query.get("recursive", "0") == "1"
    # prescreen BEFORE isdir: on Windows, isdir on \\host\share alone opens an
    # SMB connection and leaks an NTLM hash, so a UNC value must be judged
    # lexically before any filesystem call touches it.
    if not _pix_prescreen(folder):
        return web.json_response(
            {"ok": False, "message": _pix_denied_message(folder), "denied": True, "files": []},
            headers=hdrs,
        )
    # Containment (2026-08-03, ComfyUI-Manager PR #3118). This route is
    # unauthenticated, so without this `?path=C:\&recursive=1` enumerated every
    # image on the host and /thumb then served them back as JPEG bytes.
    # BEFORE isdir, not after: answering "Folder not found" for an absent path
    # and "not approved" for a present one is a directory-existence oracle for
    # the whole disk. next_counter already returns a constant for exactly this
    # reason; these three routes contradicted it until the round-3 review.
    if not _pix_folder_allowed(folder):
        return web.json_response(
            {"ok": False, "message": _pix_denied_message(folder), "denied": True, "files": []},
            headers=hdrs,
        )
    if not folder or not os.path.isdir(folder):
        return web.json_response({"ok": False, "message": "Folder not found.", "files": []}, headers=hdrs)
    real = os.path.realpath(folder)
    try:
        import asyncio
        loop = asyncio.get_running_loop()
        files = await loop.run_in_executor(None, _lif_list_files, real, recursive)
    except Exception as e:
        return web.json_response({"ok": False, "message": f"Could not read folder: {e}", "files": []}, headers=hdrs)
    return web.json_response({"ok": True, "folder": real, "files": files}, headers=hdrs)


def _lif_make_thumb(full):
    """Decode + downscale one image to a small JPEG. Blocking - run off the loop.

    The bit-depth branches MUST match nodes/node_load_images_folder.py::_load_one
    exactly. This is the gallery the user hand-picks images in, so a thumbnail
    that disagrees with what the node will actually load is worse than a wrong
    thumbnail on its own: they are choosing from pictures that do not describe
    the output. A 16-bit greyscale file measured 253.98 (4 unique values) here
    against the loader's correct 127.66 - i.e. a white square. See
    .claude/patterns/load-image.md #21 for why convert CLAMPS and why the
    .convert("I") is required before .point().
    """
    from PIL import ImageOps
    im = Image.open(full)
    im = ImageOps.exif_transpose(im)
    if im.mode == "I":
        im = im.point(lambda px: px * (1 / 255))
    elif im.mode in _I16_MODES:
        im = im.convert("I").point(lambda px: px * (1 / 257))
    im = im.convert("RGB")
    im.thumbnail((192, 192))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


@PromptServer.instance.routes.get("/pixaroma/api/load_images_folder/thumb")
async def api_lif_thumb(request):
    """Serve a small JPEG thumbnail for one image. ?path=<folder>&file=<rel>"""
    folder = request.query.get("path", "")
    rel = request.query.get("file", "")
    if not _pix_prescreen(folder):      # before isdir - see the list route
        return web.Response(status=403)
    # The _is_path_under below only proves the file sits inside the folder the
    # CALLER named, which is no containment at all while `folder` is arbitrary
    # (2026-08-03, ComfyUI-Manager PR #3118: this served any image-extension
    # file on the host back as a JPEG). Root the folder first, then keep the
    # existing per-file check so `rel` still cannot climb out of it.
    # Ordered BEFORE isdir so 403-vs-404 is not an existence oracle (round-3).
    if not _pix_folder_allowed(folder):
        return web.Response(status=403)
    # `rel` is attacker-controlled too, and os.path.join DISCARDS `folder` when
    # rel is absolute/UNC - so realpath would fire SMB before the check below.
    if _pix_rel_is_rooted(rel):
        return web.Response(status=403)
    if not folder or not rel or not os.path.isdir(folder):
        return web.Response(status=404)
    full = os.path.realpath(os.path.join(folder, rel))
    if (
        not _is_path_under(full, folder)
        or not os.path.isfile(full)
        or not _lif_is_image(os.path.basename(full))
    ):
        return web.Response(status=403)
    try:
        import asyncio
        loop = asyncio.get_running_loop()
        # PIL decode/resize/encode can be slow for big images - keep it off the
        # aiohttp event loop so other ComfyUI requests don't stall.
        body = await loop.run_in_executor(None, _lif_make_thumb, full)
        return web.Response(
            body=body,
            content_type="image/jpeg",
            headers={"Cache-Control": "no-cache"},
        )
    except Exception:
        return web.Response(status=404)


@PromptServer.instance.routes.get("/pixaroma/api/load_images_folder/browse")
async def api_lif_browse(request):
    """Navigate the server filesystem for the in-app folder picker, WITHIN the
    approved folders only. ?path=<dir> (empty = list the approved roots).
    Returns {ok, path, parent, dirs:[{name, path, images}]}; images = -1 means
    'not counted' (skipped for folders with many sub-folders, to stay fast).

    Containment added 2026-08-03 (ComfyUI-Manager PR #3118): this used to walk
    anything, so an unauthenticated caller could map the whole disk (and reach
    UNC paths, which on Windows leaks an NTLM hash just by being stat'd).

    The empty-path branch used to enumerate drive letters; it now lists the
    approved roots instead. That is both the containment AND a better landing
    screen - the user sees "output", "D:\\MyArt" rather than every drive. To add
    somewhere new they use the Browse button, which opens the real OS dialog and
    approves whatever they pick (see nodes/_path_guard)."""
    path = request.query.get("path", "")
    try:
        if not path:
            dirs = []
            seen = set()
            for d in list(_pix_comfy_roots()) + list(_pix_remembered_folders()):
                try:
                    if not d or not os.path.isdir(d):
                        continue
                    key = os.path.normcase(os.path.realpath(d))
                    if key in seen:
                        continue
                    seen.add(key)
                except OSError:
                    continue
                dirs.append({"name": os.path.basename(d.rstrip("\\/")) or d,
                             "path": d, "images": -1})
            return web.json_response({"ok": True, "path": "", "parent": None, "dirs": dirs})

        if not _pix_prescreen(path):    # before isdir - see the list route
            return web.json_response(
                {"ok": False, "message": _pix_denied_message(path), "denied": True, "dirs": []}
            )
        # allowed-check BEFORE isdir, so the reply cannot distinguish "absent"
        # from "present but not yours" for any path on the disk (round-3).
        if not _pix_folder_allowed(path):
            return web.json_response(
                {"ok": False, "message": _pix_denied_message(path), "denied": True, "dirs": []}
            )
        if not os.path.isdir(path):
            return web.json_response({"ok": False, "message": "Folder not found.", "dirs": []})
        real = os.path.realpath(path)
        parent = os.path.dirname(real)
        if parent == real:  # already at a drive / filesystem root
            parent = ""
        # Do not offer an "up" that would just be refused: once we are at the
        # top of an approved root, Up returns to the roots list ("") instead.
        if parent and not _pix_folder_allowed(parent):
            parent = ""

        subdirs = []
        try:
            for n in sorted(os.listdir(real), key=str.lower):
                full = os.path.join(real, n)
                if os.path.isdir(full):
                    subdirs.append((n, full))
        except OSError as e:
            return web.json_response({"ok": False, "message": f"Could not read folder: {e}", "dirs": []})

        # Only tally per-folder image counts when cheap (few sub-folders), so
        # browsing into e.g. C:\Windows doesn't stat hundreds of directories.
        do_count = len(subdirs) <= 60
        dirs = []
        for n, full in subdirs:
            cnt = -1
            if do_count:
                try:
                    cnt = sum(1 for fn in os.listdir(full) if _lif_is_image(fn))
                except OSError:
                    cnt = -1
            dirs.append({"name": n, "path": full, "images": cnt})
        return web.json_response({"ok": True, "path": real, "parent": parent, "dirs": dirs})
    except Exception as e:
        return web.json_response({"ok": False, "message": str(e), "dirs": []})


# Native OS folder picker. The ComfyUI server runs on the user's own machine for
# local installs, so it can pop a REAL folder dialog and return the chosen path -
# no image copying, like a desktop app. Cross-platform with NO extra Python deps:
# Windows = PowerShell + WinForms (the embedded Python lacks tkinter); macOS =
# osascript; Linux = zenity / kdialog. Each fails fast on a headless/remote host
# so the frontend falls back to the in-app browser. Never hangs (subprocess
# timeout); a module lock allows only one dialog at a time.
import threading as _threading

_LIF_DIALOG_LOCK = _threading.Lock()


def _lif_dialog_available():
    """True if SOME native folder dialog tool exists for this platform."""
    import sys
    import shutil
    if sys.platform == "win32":
        return shutil.which("powershell") is not None
    if sys.platform == "darwin":
        return shutil.which("osascript") is not None
    return shutil.which("zenity") is not None or shutil.which("kdialog") is not None


def _lif_dialog_windows(start_path):
    import subprocess
    # Show an invisible TopMost owner form, then open the folder dialog inside its
    # Shown event so it inherits the foreground (fixes "opens behind the browser").
    # Start path goes through an env var to avoid quoting issues.
    ps = (
        "Add-Type -AssemblyName System.Windows.Forms;"
        "$r='';"
        "$o=New-Object System.Windows.Forms.Form;"
        "$o.TopMost=$true;$o.ShowInTaskbar=$false;$o.FormBorderStyle='None';"
        "$o.Width=1;$o.Height=1;$o.Opacity=0;$o.StartPosition='CenterScreen';"
        "$o.Add_Shown({"
        "$o.Activate();"
        "$d=New-Object System.Windows.Forms.FolderBrowserDialog;"
        "$d.Description='Choose a folder of images';$d.ShowNewFolderButton=$false;"
        "if($env:LIF_START){try{$d.SelectedPath=$env:LIF_START}catch{}};"
        "if($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK){$script:r=$d.SelectedPath};"
        "$o.Close()"
        "});"
        "[void]$o.ShowDialog();"
        "[Console]::Out.Write($r)"
    )
    env = dict(os.environ)
    env["LIF_START"] = start_path or ""
    out = subprocess.run(
        ["powershell", "-NoProfile", "-STA", "-Command", ps],
        capture_output=True, text=True, timeout=300, env=env,
        creationflags=0x08000000,  # CREATE_NO_WINDOW (no console flash)
    )
    return (out.stdout or "").strip()


def _lif_dialog_macos(start_path):
    import subprocess
    import re
    script = 'POSIX path of (choose folder with prompt "Choose a folder of images")'
    # Only seed the start location when it's a real dir whose path has no chars
    # that could break out of the AppleScript string literal (?path= is supplied
    # by the caller, so treat it as untrusted).
    if start_path and os.path.isdir(start_path) and re.match(r'^[^"\\\x00-\x1f]+$', start_path):
        script = (
            'POSIX path of (choose folder with prompt "Choose a folder of images" '
            f'default location POSIX file "{start_path}")'
        )
    try:
        out = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=300)
        return (out.stdout or "").strip().rstrip("/") if out.returncode == 0 else ""
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def _lif_dialog_linux(start_path):
    import shutil
    import subprocess
    start = start_path if (start_path and os.path.isdir(start_path)) else os.path.expanduser("~")
    if shutil.which("zenity"):
        try:
            out = subprocess.run(
                ["zenity", "--file-selection", "--directory",
                 "--title=Choose a folder of images", f"--filename={start}/"],
                capture_output=True, text=True, timeout=300,
            )
            return (out.stdout or "").strip() if out.returncode == 0 else ""
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
    if shutil.which("kdialog"):
        try:
            out = subprocess.run(
                ["kdialog", "--getexistingdirectory", start, "--title", "Choose a folder of images"],
                capture_output=True, text=True, timeout=300,
            )
            return (out.stdout or "").strip() if out.returncode == 0 else ""
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
    return ""


def _lif_native_folder_dialog(start_path=""):
    """Open the native OS folder picker; return the chosen path, "" (cancelled),
    or None (busy - a dialog is already open). Runs in a thread (caller uses
    run_in_executor); only one at a time via the module lock."""
    if not _LIF_DIALOG_LOCK.acquire(blocking=False):
        return None  # a dialog is already open elsewhere -> caller falls back
    try:
        import sys
        if sys.platform == "win32":
            return _lif_dialog_windows(start_path)
        if sys.platform == "darwin":
            return _lif_dialog_macos(start_path)
        return _lif_dialog_linux(start_path)
    except Exception as e:
        print(f"[PixaromaLoadImagesFolder] native folder dialog failed: {e}")
        return ""
    finally:
        try:
            _LIF_DIALOG_LOCK.release()
        except Exception:
            pass


@PromptServer.instance.routes.get("/pixaroma/api/load_images_folder/pick_native")
async def api_lif_pick_native(request):
    """Pop the native OS folder dialog on the ComfyUI host; return the chosen path.
    {ok:true, path} on pick; {ok:false, cancelled} on cancel; {ok:false,
    unavailable} when no native dialog tool exists (so the UI falls back)."""
    if not _lif_dialog_available():
        return web.json_response({"ok": False, "unavailable": True})
    start = request.query.get("path", "")
    # ⚠ THE START PATH MUST ALREADY BE APPROVED. Not merely screened.
    #
    # The whole trust model rests on "an attacker can make this dialog appear
    # but cannot choose the folder". That is FALSE if they control where it
    # opens: `start` becomes $d.SelectedPath (line ~1870) and FolderBrowserDialog
    # RETURNS SelectedPath when the user clicks OK without navigating. So
    #   GET /pick_native?path=\\attacker\drop
    # pops a plausible "Choose a folder of images" box already sitting on the
    # attacker's share, and one OK click allowlists it permanently - after which
    # Save Image can write every render there. `?path=C:\Users\<name>` does the
    # same for the whole home directory.
    #
    # Restricting the start to an already-approved folder costs nothing: the
    # dialog simply opens at its default and the user navigates to the new
    # folder themselves, which is the flow anyway. Both real callers pass either
    # "" or a folder that is already approved.
    # (Round-3 review. The round-2 fix here only screened for UNC, which stopped
    # the credential leak but not the far worse click-to-approve.)
    if not (_pix_prescreen(start) and _pix_folder_allowed(start)):
        start = ""
    try:
        import asyncio
        loop = asyncio.get_running_loop()
        path = await loop.run_in_executor(None, _lif_native_folder_dialog, start)
        if path is None:
            return web.json_response({"ok": False, "busy": True})
        if path and os.path.isdir(path):
            # THE approval point for the whole allowlist (see nodes/_path_guard).
            # A folder that came back from the native OS dialog was chosen by a
            # human at the keyboard: an attacker can make this dialog APPEAR,
            # but the selection and the OK click happen in the operating system,
            # outside anything a request can influence. That is the only
            # authorisation signal available to us, so this is the ONLY place
            # allowed to call remember_folder. Do not call it from a route that
            # takes the folder from the request body - that would let an
            # attacker approve their own target and make the guard decorative.
            # Surface whether it actually persisted. If the write fails (read-only
            # user dir, AV lock, or a damaged config we refuse to clobber) and we
            # still answer plain ok, the node stores the folder, every Run then
            # says "click Browse and pick this folder once" - which they just did
            # - and there is no way out. Round-3 review finding 5.
            remembered = _pix_remember_folder(path)
            return web.json_response({"ok": True, "path": path, "remembered": bool(remembered)})
        return web.json_response({"ok": False, "cancelled": True})
    except Exception as e:
        return web.json_response({"ok": False, "message": str(e)})


# ─────────────────────────────────────────────────────────────────────────────
# Save Image Pixaroma routes: live filename-counter preview, open-in-explorer,
# and token-served previews for files saved OUTSIDE ComfyUI's folders.
# The Browse button reuses /pixaroma/api/load_images_folder/pick_native above.


@PromptServer.instance.routes.get("/pixaroma/api/save_image/file")
async def api_save_image_file(request):
    """Serve a file this server session just saved, looked up by an opaque
    token (exact-path registry in node_save_image, filled ONLY by the save
    node itself). No path arrives from the client, so there is no traversal
    surface. Powers the node's preview for files saved outside ComfyUI's
    folders, which /view cannot reach. Read-only; tokens die with the
    server process."""
    from .nodes.node_save_image import resolve_serve_token
    path = resolve_serve_token(request.query.get("t", ""))
    if not path or not os.path.isfile(path):
        return web.Response(status=404, text="unknown or expired preview token")
    # State the image type ourselves instead of leaving it to the platform's
    # mimetype table. MEASURED 2026-08-10 on this box: the same route answered
    # image/png for a .png and application/octet-stream for a .webp, even
    # though this Python's own mimetypes module knows .webp perfectly well. The
    # <img> preview survives either way because browsers sniff images, but the
    # node's "Open" button does window.open on this URL, and octet-stream makes
    # the browser DOWNLOAD the file instead of showing it.
    _CT = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
    ct = _CT.get(os.path.splitext(path)[1].lower())
    return web.FileResponse(path, headers={"Content-Type": ct} if ct else None)


@PromptServer.instance.routes.get("/pixaroma/api/save_video/file")
async def api_save_video_file(request):
    """Serve a VIDEO this server session just saved, looked up by an opaque
    token (exact-path registry in node_save_video, filled ONLY by the save node
    itself). No path arrives from the client, so there is no traversal surface.
    Powers the node's player for files saved outside ComfyUI's folders, which
    /view cannot reach. Read-only; tokens die with the server process.

    Two things this route MUST get right, both measured rather than assumed:

    * RANGE REQUESTS. A <video> element seeks by asking for a byte range, so
      without a 206 the scrub bar cannot move. aiohttp's FileResponse handles
      Range itself, and passing an explicit Content-Type header does not
      disturb it - verified with a real partial request.
    * CONTENT-TYPE. Stated here rather than left to the platform's mimetype
      table: the sibling image route was MEASURED answering
      application/octet-stream for a .webp on this box even though this
      Python's mimetypes module knows the extension, and octet-stream makes a
      browser download the file instead of playing it.
    """
    from .nodes.node_save_video import resolve_serve_token
    path = resolve_serve_token(request.query.get("t", ""))
    if not path or not os.path.isfile(path):
        return web.Response(status=404, text="unknown or expired video token")
    _CT = {".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm"}
    ct = _CT.get(os.path.splitext(path)[1].lower(), "video/mp4")
    return web.FileResponse(path, headers={"Content-Type": ct})


@PromptServer.instance.routes.get("/pixaroma/api/save_image/next_counter")
async def api_save_image_next_counter(request):
    """Next %counter% value for the node's live 'Will save as' preview.

    `name` is the resolved filename template (extension included, %counter%
    still in it, may contain '/' subfolder segments - the JS resolves dates /
    input / node-reference tokens before calling). `folder` is the raw folder
    field, resolved exactly like the node resolves it at save time. A folder
    that doesn't exist yet just means counter 1. Directory scan runs in an
    executor so a huge folder can't stall other requests.
    """
    folder_raw = request.query.get("folder", "")
    name = request.query.get("name", "")
    try:
        digits = max(1, min(8, int(request.query.get("digits", "3"))))
    except Exception:
        digits = 3

    def _scan():
        # Screen the string that will ACTUALLY be resolved: _resolve_save_folder
        # expands %VARS% and ~ BEFORE realpath, so a raw-only screen judges a
        # different value than the one that reaches the filesystem (round-3 #4).
        # Still entirely pre-resolve - expandvars/expanduser touch nothing.
        if not _pix_prescreen_field(folder_raw):
            return 1, "", True
        base, _inside = _resolve_save_folder(folder_raw)
        # Containment (2026-08-03). Without this the preview was a directory
        # read-oracle on ANY path: _resolve_save_folder deliberately accepts an
        # absolute folder, and _next_counter lists it. It returns no bytes, but
        # the max-match it reports leaks whether files exist anywhere on disk.
        # The refusal returns a CONSTANT (1, "") so nothing about the folder -
        # not even whether it exists - can be inferred from the answer, and a
        # `denied` flag so the node's preview can say so instead of quietly
        # showing a number that a Run would never produce.
        if not _pix_folder_allowed(base):
            return 1, "", True
        parts = [p for p in name.replace("\\", "/").split("/") if p]
        if not parts:
            return 1, "", False
        # Mirror the save-time order (node_save_image.py): %counter% in a
        # FOLDER segment resolves against existing sibling dirs FIRST, then
        # the FILE counter scans inside that resolved directory - so the
        # preview shows the exact path a Run would create.
        resolved_dirs = []
        parent = base
        for seg in parts[:-1]:
            if "%counter%" in seg:
                n = _next_counter(parent, seg)
                seg = seg.replace("%counter%", f"{n:0{digits}}")
            resolved_dirs.append(seg)
            parent = os.path.join(parent, seg)
        counter = _next_counter(parent, parts[-1])
        fname = parts[-1].replace("%counter%", f"{counter:0{digits}}")
        return counter, "/".join(resolved_dirs + [fname]), False

    try:
        import asyncio
        loop = asyncio.get_running_loop()
        counter, resolved, denied = await loop.run_in_executor(None, _scan)
        out = {"ok": True, "counter": counter, "resolved": resolved}
        if denied:
            out["denied"] = True
            out["message"] = _pix_denied_message(str(folder_raw))
        return web.json_response(out)
    except Exception as e:
        return web.json_response(
            {"ok": False, "message": str(e), "counter": 1, "resolved": ""}
        )


@PromptServer.instance.routes.post("/pixaroma/api/save_image/open_folder")
async def api_save_image_open_folder(request):
    """Open the OS file explorer at the node's save folder, IF that folder is
    approved. Local-install QoL; the path is resolved the same way the save
    does and must already exist as a directory.

    Containment added 2026-08-03 (ComfyUI-Manager PR #3118). This route is
    unauthenticated and was handing any absolute path to os.startfile /
    xdg-open, so any web page could pop file-manager windows on the user's
    desktop. Worse on Windows: a UNC path like \\\\attacker\\share makes the
    os.path.isdir check ALONE reach out over SMB and leak an NTLM hash, before
    startfile is even called - so the check has to come BEFORE the isdir, not
    just before the launch. The sibling /workflows/reveal route already did
    this correctly; this one is now consistent with it."""
    try:
        data = await request.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    folder_raw = str(data.get("folder", "") or "")
    if not _pix_prescreen_field(folder_raw):    # expansion-aware, see round-3 #4
        return web.json_response(
            {"ok": False, "message": _pix_denied_message(folder_raw), "denied": True}
        )
    path, _inside = _resolve_save_folder(folder_raw)
    if not _pix_folder_allowed(path):
        return web.json_response({"ok": False, "message": _pix_denied_message(path), "denied": True})
    if not os.path.isdir(path):
        return web.json_response({
            "ok": False,
            "message": "Folder does not exist yet - it is created on the first save.",
        })
    try:
        import subprocess
        import sys
        if sys.platform == "win32":
            # Plain open ONLY. The window may land behind the browser (the JS
            # status line says to check the taskbar). Do NOT re-add the
            # PowerShell bring-to-front script: its Add-Type + user32.dll
            # P/Invoke command line is flagged by Bitdefender as "Malicious
            # command line detected" and BLOCKED (real user report,
            # 2026-07-03) - antivirus heuristics can't tell it apart from
            # injector malware. os.startfile is a normal API call and safe.
            os.startfile(path)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"ok": False, "message": str(e)})


# ── LoRA Loader Pixaroma ─────────────────────────────────────────────────────
# Back the multi-LoRA loader: the file list, the offline info + trigger-word
# readout, preview thumbnails, and the OPTIONAL (user-clicked) Civitai lookup.
# Everything except /civitai is fully offline. Every route realpath-guards to the
# configured loras directories so a crafted ?name= can't read outside them.

def _lora_dirs():
    try:
        return list(folder_paths.get_folder_paths("loras"))
    except Exception:
        return []


# Civitai API hosts. `.com` is the real home; `.red` is Civitai's UNRESTRICTED
# domain and serves the same API on separate DNS, so it doubles as the backup when
# a network or ISP blocks civitai.com by name (verified 2026-07-25: byte-identical
# response for a public model). Which one is asked FIRST is the user's choice - see
# civitai_hosts() in _lora_helpers.py. `.green` is deliberately absent: its API
# 301-redirects straight back to civitai.com, so it is a redundant hop rather than
# an independent route.


def _civitai_account_file():
    """Where the Civitai key lives: <ComfyUI user dir>/pixaroma/civitai.json.

    Deliberately OUTSIDE this plugin's folder, which is a git repo - a key sitting
    in the working tree is one `git add -A` away from being published, and a
    Manager reinstall would wipe it. ComfyUI's user directory is the same place
    core keeps its own per-install settings, so it survives updates and is already
    excluded from anything shared."""
    base = None
    try:
        base = folder_paths.get_user_directory()
    except Exception:
        base = None
    if not base:
        # Very old ComfyUI without get_user_directory: fall back to a sibling of
        # this plugin rather than refusing to store anything at all.
        base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "user")
    d = os.path.join(base, "pixaroma")
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass
    return os.path.join(d, "civitai.json")


def _civitai_account():
    return _civitai_read_account(_civitai_account_file())


def _civitai_public_account(acc):
    """The ONLY shape the browser is ever given. The key itself never leaves the
    server: `configured` says whether there is one and `hint` shows its last four
    characters so the user can tell which key is loaded."""
    return {
        "ok": True,
        "configured": bool(acc.get("key")),
        "hint": _civitai_mask_key(acc.get("key")),
        "host": acc.get("host", "com"),
        "adultThumbs": bool(acc.get("adult_thumbs")),
    }


@PromptServer.instance.routes.get("/pixaroma/api/civitai/account")
async def api_civitai_account_get(request):
    """Whether a key is configured, and the two lookup preferences. Never the key."""
    return web.json_response(_civitai_public_account(_civitai_account()),
                             headers={"Cache-Control": "no-store"})


@PromptServer.instance.routes.post("/pixaroma/api/civitai/account")
async def api_civitai_account_set(request):
    """Set the key and/or the preferences. An absent field is left alone; `key: ""`
    clears the key. Answers with the same public shape, so the panel repaints from
    what the server actually stored rather than from what it hoped it sent."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    acc = _civitai_account()
    if "key" in body:
        raw = body.get("key")
        if isinstance(raw, str) and raw.strip() == "":
            acc["key"] = ""
        else:
            k = _civitai_sanitize_key(raw)
            if not k:
                return web.json_response({
                    "ok": False,
                    "message": "That does not look like an API key - it should be one "
                               "run of ordinary characters with no spaces.",
                }, headers={"Cache-Control": "no-store"})
            acc["key"] = k
    if body.get("host") in ("com", "red"):
        acc["host"] = body["host"]
    if "adultThumbs" in body:
        acc["adult_thumbs"] = bool(body.get("adultThumbs"))
    if not _civitai_write_account(_civitai_account_file(), acc):
        return web.json_response({"ok": False, "message": "Could not save the settings file."},
                                 headers={"Cache-Control": "no-store"})
    return web.json_response(_civitai_public_account(acc), headers={"Cache-Control": "no-store"})


def _resolve_lora_path(name):
    """Resolve a LoRA filename (as listed, incl. any subfolder) to a real path that
    is guaranteed to live inside a configured loras directory, or None."""
    if not name or not isinstance(name, str):
        return None
    try:
        p = folder_paths.get_full_path("loras", name)
    except Exception:
        p = None
    if not p or not os.path.isfile(p):
        return None
    # Fail CLOSED: if the loras dirs can't be determined (empty / folder_paths error),
    # refuse rather than serve an unverified path.
    roots = _lora_dirs()
    if not roots or not _is_path_under(p, *roots):
        return None
    return p


@PromptServer.instance.routes.get("/pixaroma/api/lora/list")
async def api_lora_list(request):
    """Every LoRA filename ComfyUI knows about (names include any subfolder prefix)."""
    # no-store: this JSON carries no cache headers otherwise, and a browser
    # heuristically caching it reproduces "renamed file never appears" even
    # after our JS re-fetches. Same class as the .mjs no-cache layers above.
    hdrs = {"Cache-Control": "no-store"}
    try:
        files = list(folder_paths.get_filename_list("loras"))
    except Exception:
        # A SCAN FAILURE is not an empty folder: the frontend treats a clean []
        # as ground truth and would mark every row "missing" (a workflow-wide
        # false alarm on a transient network-drive/locked-file hiccup). Say so.
        return web.json_response({"loras": [], "error": True}, headers=hdrs)
    return web.json_response({"loras": files}, headers=hdrs)


@PromptServer.instance.routes.get("/pixaroma/api/lora/info")
async def api_lora_info(request):
    """Offline info + trigger words for one LoRA (the info panel). Always 200 so the
    frontend never branches on HTTP status; reads only the file header + sidecars."""
    name = request.query.get("name", "")
    path = _resolve_lora_path(name)
    if not path:
        return web.json_response({"ok": False, "message": "LoRA not found."})
    try:
        import asyncio
        loop = asyncio.get_event_loop()
        # Header read is small but hashing/sidecar I/O is disk-bound - keep it off
        # the aiohttp event loop.
        info = await loop.run_in_executor(None, _lora_build_info, path)
    except Exception as exc:
        return web.json_response({"ok": False, "message": "Could not read: {}".format(exc)})
    # The user's own words ride along with the file's and Civitai's, so the panel
    # gets all three sources in one request and can show them the moment it opens.
    try:
        info["custom_triggers"] = _lora_get_custom(_lora_custom_file(), name)
    except Exception:
        info["custom_triggers"] = []
    # ...and so does their own preview picture. `custom_preview` drives the panel's
    # "remove" affordance; `preview_v` is the mtime that lets the browser past the
    # thumb route's hour-long cache when the picture was replaced somewhere else
    # (another node, another session) and this panel never saw it happen.
    try:
        folder = _lora_previews_dir()
        info["preview_v"] = _lora_custom_preview_version(folder, name)
        info["custom_preview"] = bool(info["preview_v"])
        if info["custom_preview"]:
            info["has_preview"] = True
    except Exception:
        info["custom_preview"] = False
        info["preview_v"] = 0
    # no-store: this answer now CARRIES the cache-buster (`preview_v`) that the
    # thumbnail URL is built from, so a heuristically cached copy would hand back
    # a stale version and defeat the very mechanism it exists for. aiohttp's
    # json_response sends no cache headers of its own - the same absent-headers
    # class that got our .mjs modules cached, and why /lora/list already says this.
    return web.json_response({"ok": True, "info": info}, headers={"Cache-Control": "no-store"})


@PromptServer.instance.routes.get("/pixaroma/api/lora/thumb")
async def api_lora_thumb(request):
    """Serve the LoRA's preview image, or 404.

    The user's OWN picture wins over the one beside the LoRA: this route is what
    both the panel and any future thumbnail read, so the override has to be
    honoured here rather than only where it happens to be displayed."""
    name = request.query.get("name", "")
    path = _resolve_lora_path(name)
    if not path:
        return web.Response(status=404)
    try:
        # Gated like the write and the delete: this hands bytes back to the
        # browser, so the same one guard decides what counts as ours.
        own = _lora_find_custom_preview(_lora_previews_dir(), name)
        if own and not _lora_preview_path_checked(name):
            own = None
    except Exception:
        own = None
    if own:
        return web.FileResponse(own, headers={"Cache-Control": "public, max-age=3600"})
    prev = _lora_find_preview(path)
    roots = _lora_dirs()
    if not prev or not roots or not _is_path_under(prev, *roots):
        return web.Response(status=404)
    return web.FileResponse(prev, headers={"Cache-Control": "public, max-age=3600"})


@PromptServer.instance.routes.get("/pixaroma/api/lora/civitai")
async def api_lora_civitai(request):
    """OPTIONAL online lookup (only when the user clicks the Civitai button).

    Fingerprints the file (SHA256), asks Civitai for an exact-file match, and caches
    the raw response next to the LoRA so future reads are instant and offline. Always
    200; `reason` tells the frontend which card to show: found / notfound / offline.
    """
    name = request.query.get("name", "")
    path = _resolve_lora_path(name)
    if not path:
        return web.json_response({"ok": False, "reason": "notfound", "message": "LoRA not found."})
    import asyncio
    loop = asyncio.get_event_loop()
    try:
        sha = await loop.run_in_executor(None, _lora_file_sha256, path)
    except Exception as exc:
        return web.json_response({"ok": False, "reason": "offline",
                                  "message": "Could not read the file: {}".format(exc)})
    try:
        import aiohttp
    except Exception:
        return web.json_response({"ok": False, "reason": "offline",
                                  "message": "Could not reach Civitai."})
    # 30s, not 12s: Civitai's API is regularly slow under load, and a lookup that
    # gives up early reads to the user as "it doesn't work", especially on a slow
    # link. The hash is already computed by this point, so this budget is purely
    # the HTTP round trip.
    timeout = aiohttp.ClientTimeout(total=30, connect=10)
    acc = _civitai_account()
    hosts = _civitai_hosts(acc.get("host"))
    # `Accept`: an edge that sees no explicit Accept can answer with an HTML
    # challenge page instead of the API; asking for JSON makes the intent
    # unambiguous. `Accept-Encoding` is pinned to what CPython can always decode:
    # aiohttp only advertises `br` when the brotli codec is importable
    # (`_gen_default_accept_encoding`), so on a stock install this is ALREADY the
    # effective value - measured, gzip/deflate, and Civitai returned no
    # compression at all - but pinning it means an install that happens to carry
    # brotli cannot be handed a `br` body by an edge and then fail to decode it.
    #
    # We deliberately do NOT send a browser User-Agent. It was suggested as a way
    # past Cloudflare, but measured against both hosts it changed nothing, and
    # impersonating Chrome to get through bot protection is not something this
    # plugin should do. The API key likewise stays in the Authorization header
    # and is NEVER put in the query string: a `?token=` lands in proxy and server
    # logs, which is the whole reason invariant 16 keeps it out of URLs.
    headers = {
        "User-Agent": "ComfyUI-Pixaroma",
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
    }
    if acc.get("key"):
        # Sanitised on the way in AND on the way out of the file, so this cannot
        # carry a newline into the header. Never logged, never echoed to the page.
        headers["Authorization"] = "Bearer {}".format(acc["key"])
    data = None
    last_note = "Could not reach Civitai."
    # A refusal aimed at the KEY is the most actionable thing we can report, so it is
    # kept aside rather than being overwritten by whatever the second host happens to
    # say afterwards (a timeout there would otherwise bury it).
    key_note = None
    for i, host in enumerate(hosts):
        last = i == len(hosts) - 1
        url = "https://{}/api/v1/model-versions/by-hash/{}".format(host, sha)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url, headers=headers) as resp:
                    if resp.status == 404:
                        # A 404 is only definitive on the LAST host. It used to end the
                        # search immediately, on the reasoning that both hosts serve one
                        # catalogue - true for a public model, but NOT for an adult-rated
                        # one: the main host hides it behind exactly this 404 while the
                        # unrestricted host returns it. That made a whole class of LoRAs
                        # report "not on Civitai" no matter how many times you asked.
                        # Costs one extra round trip in the genuinely-absent case, on a
                        # lookup the user clicked and which already spent longer hashing.
                        if not last:
                            last_note = "Not found on {}.".format(host)
                            continue
                        return web.json_response({"ok": True, "found": False, "reason": "notfound"})
                    if resp.status in (401, 403):
                        # NEVER returns from inside the loop, exactly like the 404 branch
                        # above. A 401/403 is the most HOST-SPECIFIC failure there is - a
                        # Cloudflare, corporate or ISP block page answers 403 for one
                        # domain while the other domain answers fine - and the backup host
                        # exists for precisely that. Returning here cost the user the
                        # backup, which was a regression against the previous release.
                        #
                        # Having a key saved does NOT make it safe to stop early either: a
                        # 403 does not say it is about the key, so blaming the key would
                        # send someone with a perfectly good one to go and check it while
                        # the host that would have worked was never asked. That is the
                        # same mistake aimed at the people most likely to hit it, since
                        # they are the ones who added a key BECAUSE lookups were failing.
                        if acc.get("key"):
                            key_note = ("Civitai refused the API key ({}). Check it in the node "
                                        "settings.".format(resp.status))
                            last_note = key_note
                        else:
                            # Name the likelier cause FIRST. A network-level block covers
                            # both civitai names, so by the time every host has refused,
                            # "your network" is the better guess than "buy a key".
                            last_note = ("Civitai refused the request ({}). Your network may be "
                                         "blocking Civitai, or this model may need an API key - "
                                         "add one in the node settings.".format(resp.status))
                        continue
                    if resp.status != 200:
                        # Rate limit / maintenance / gateway error: transient, so fall
                        # through to the backup host before giving up.
                        last_note = "Civitai returned {}.".format(resp.status)
                        continue
                    # Captured BEFORE parsing so a non-JSON reply can name what
                    # actually came back.
                    ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip()
                    # Read the WHOLE body, in a loop, with the memory cap kept.
                    #
                    # ⚠️ DO NOT go back to `await resp.content.read(N)` with a POSITIVE
                    # N. That does NOT mean "read up to N bytes of the body" - aiohttp's
                    # StreamReader.read only loops to EOF when n < 0; with a positive n
                    # it waits for the FIRST data to arrive and then returns
                    # `_read_nowait(n)`, which drains only what is buffered AT THAT
                    # MOMENT. On any reply that spans more than one chunk it returns the
                    # first chunk and silently drops the rest, so json.loads fails on
                    # truncated JSON while Content-Type still says application/json -
                    # which is precisely the "Civitai replied with application/json
                    # instead of data" report. Measured: 4096 of 32726 bytes, 5 times out
                    # of 5, against a server chunking at 4KB. It is invisible on a fast
                    # link (the whole reply lands in one buffer), which is why this
                    # survived two rounds of "cannot reproduce" and got misattributed to
                    # brotli. Harness: D:\Claude Tests\_civitai_partial_read_test.py.
                    #
                    # iter_chunked keeps the cap that a bare read()/text() would lose.
                    chunks = []
                    total = 0
                    async for chunk in resp.content.iter_chunked(65536):
                        total += len(chunk)
                        if total > 4 * 1024 * 1024:
                            return web.json_response({"ok": False, "reason": "offline",
                                                      "message": "Civitai response too large."})
                        chunks.append(chunk)
                    body = b"".join(chunks)
                    try:
                        data = json.loads(body)
                    except Exception:
                        # A 200 that is not JSON is a block / sign-in page from the
                        # network or its protection layer, NOT Civitai saying no.
                        # Naming the content type is what makes the next bug report
                        # diagnosable instead of a guess - reports of this arrive
                        # blaming compression, which the measurements rule out.
                        # `continue`, never return: the other host is exactly the
                        # backup for a per-domain block (invariant 16).
                        data = None
                        last_note = ("Civitai replied with {} instead of data - most likely a "
                                     "block or sign-in page from your network or its protection "
                                     "layer.".format(ctype or "an unknown format"))
                        continue
                    break
        except Exception as exc:
            # Keep WHY it failed: a timeout, a DNS/TLS/proxy refusal and a block
            # page all used to collapse into one generic line, which defeats the
            # point of showing the user a reason at all.
            kind = type(exc).__name__
            if "Timeout" in kind or "Cancelled" in kind:
                last_note = "Civitai timed out."
            elif "ContentEncoding" in kind or "Decompress" in kind:
                # Kept DISTINCT from the block-page line above on purpose: the two
                # were being conflated in bug reports, and the fix for each is
                # completely different. This one should now be unreachable (we pin
                # Accept-Encoding to gzip/deflate), so if it ever shows up it is
                # genuinely worth hearing about.
                last_note = ("Civitai sent a compressed reply this install cannot read ({}). "
                             "Please report this.".format(kind))
            elif "JSON" in kind or "Decode" in kind or "Value" in kind:
                last_note = "Civitai sent an unreadable reply (a login or block page?)."
            else:
                last_note = "Could not reach Civitai ({}).".format(kind)
            continue
    if data is None:
        # A key refusal outranks whatever the later host said: "check your key" is
        # something the user can act on, a trailing timeout is not.
        return web.json_response({"ok": False, "reason": "offline",
                                  "message": key_note or last_note})
    parsed = _lora_parse_civitai(data, allow_adult=bool(acc.get("adult_thumbs")))
    # Civitai answered 200 with a usable record -> FOUND, even when this version
    # happens to carry no trainedWords and no model.name (plenty do not; e.g.
    # COOLKIDS_MERGE_V2.5 has an empty trainedWords list). Requiring those two
    # threw away genuine hits AND skipped the sidecar write below, so every later
    # click re-hashed the whole file and re-fetched it.
    if not parsed:
        return web.json_response({"ok": True, "found": False, "reason": "notfound"})
    await loop.run_in_executor(None, _lora_save_sidecar, path, data)
    return web.json_response({"ok": True, "found": True, "info": parsed})


def _lora_custom_file():
    """Where the user's own trigger words live: <ComfyUI user dir>/pixaroma/lora_triggers.json.

    ONE file for every LoRA, in the same folder as the Civitai account (and for the
    same reasons): outside this plugin's git working tree, so it survives an update
    or a Manager reinstall. Deliberately NOT a sidecar beside each .safetensors -
    that would write into the models folder, which is often a read-only or network
    drive, and risks colliding with a user's own <base>.json."""
    base = None
    try:
        base = folder_paths.get_user_directory()
    except Exception:
        base = None
    if not base:
        base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "user")
    d = os.path.join(base, "pixaroma")
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass
    return os.path.join(d, "lora_triggers.json")


def _lora_previews_dir():
    """Where a user-picked LoRA preview lives: <ComfyUI user dir>/pixaroma/lora_previews.

    Same folder and the same reasoning as the trigger store above - NOT beside the
    .safetensors. A models folder is often read-only or a network share, and writing
    a <base>.preview.png there would overwrite whatever a Civitai helper already put
    next to the LoRA. Kept separate, ours simply WINS, and deleting it puts the
    automatic picture back."""
    return os.path.join(os.path.dirname(_lora_custom_file()), "lora_previews")


def _lora_preview_path_checked(name):
    """The on-disk path for one of our LoRA preview files, or None if it is not
    one we could have written. Every route that writes, reads or deletes one
    gates on this.

    Mirrors `_wf_cover_path` deliberately. The filename is a sha1 WE generate and
    the helper already regex-checks its shape, so nothing the caller sent ever
    reaches the join - but the containment check goes through the pack's ONE
    guard because that is what a reader will look for, and because
    `nodes/_path_guard.py` says a check is imported, never re-rolled. Belt as
    well as braces."""
    folder = _lora_previews_dir()
    path = _lora_custom_preview_path(folder, name)
    if not path:
        return None
    return path if _is_path_under(path, folder) else None


# A downscaled jpeg of a preview picture. The browser resizes to 512px before
# uploading, so anything near this is already something we did not send.
_LORA_PREVIEW_MAX_BYTES = 4 * 1024 * 1024


@PromptServer.instance.routes.post("/pixaroma/api/lora/preview")
async def api_lora_preview_set(request):
    """Store the user's own preview picture for one LoRA. POST {name, dataUrl}.

    Same shape as the workflow-cover upload, and the same rules: the size is
    checked BEFORE decoding (base64 expands by a third, so decoding first would
    let an oversized payload set the memory it takes to reject it), and the bytes
    have to LOOK like a picture - this file is served straight back to a browser
    as an image, so one that is not would simply never render and read as the
    feature being broken. Always 200."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    # `body or {}` is NOT enough: request.json() ignores Content-Type, so a body of
    # `[1]` / `"x"` / `5` / `true` parses to a truthy NON-dict and reaches .get,
    # raising AttributeError out of the handler and 500-ing an unauthenticated
    # route. The falsy non-dicts ([], "", 0, null) are why that survived testing.
    if not isinstance(body, dict):
        body = {}
    name = str(body.get("name", "") or "")
    data_url = str(body.get("dataUrl", "") or "")
    path = _resolve_lora_path(name)
    roots = _lora_dirs()
    if not path or not roots or not _is_path_under(path, *roots):
        return web.json_response({"ok": False, "message": "LoRA not found."})
    if "," not in data_url:
        return web.json_response({"ok": False, "message": "Nothing to save."})
    payload = data_url.split(",", 1)[1]
    if len(payload) > _LORA_PREVIEW_MAX_BYTES * 4 // 3 + 8:
        return web.json_response({"ok": False, "message": "That picture is too large."})
    try:
        raw = base64.b64decode(payload)
    except Exception:
        return web.json_response({"ok": False, "message": "That picture could not be read."})
    if not raw or len(raw) > _LORA_PREVIEW_MAX_BYTES:
        return web.json_response({"ok": False, "message": "That picture is too large."})
    if not _wf_looks_like_image(raw):
        return web.json_response(
            {"ok": False, "message": "That file is not a picture the browser can show."})
    if not _lora_preview_path_checked(name):
        return web.json_response({"ok": False, "message": "Bad preview path."})

    import asyncio
    loop = asyncio.get_event_loop()
    folder = _lora_previews_dir()
    try:
        written = await loop.run_in_executor(
            None, _lora_write_custom_preview, folder, name, raw
        )
    except Exception as exc:
        return web.json_response({"ok": False, "message": "Could not save: {}".format(exc)})
    if not written:
        return web.json_response({"ok": False, "message": "Could not save that picture."})
    return web.json_response({"ok": True, "v": _lora_custom_preview_version(folder, name)})


@PromptServer.instance.routes.post("/pixaroma/api/lora/preview_delete")
async def api_lora_preview_delete(request):
    """Remove the user's own preview so the automatic picture comes back. POST {name}.

    The filename is derived from the LoRA name and checked against the one shape we
    could have written before it reaches os.remove, so a hand-edited request cannot
    aim this at anything else. Always 200."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):      # see api_lora_preview_set - a truthy non-dict 500s it
        body = {}
    name = str(body.get("name", "") or "") or request.query.get("name", "")
    path = _resolve_lora_path(name)
    roots = _lora_dirs()
    if not path or not roots or not _is_path_under(path, *roots):
        return web.json_response({"ok": False, "message": "LoRA not found."})
    if not _lora_preview_path_checked(name):
        return web.json_response({"ok": False, "message": "Bad preview path."})
    try:
        removed = _lora_delete_custom_preview(_lora_previews_dir(), name)
    except Exception as exc:
        return web.json_response({"ok": False, "message": "Could not remove: {}".format(exc)})
    return web.json_response({"ok": True, "removed": bool(removed)})


@PromptServer.instance.routes.post("/pixaroma/api/lora/custom_triggers")
async def api_lora_custom_triggers(request):
    """Save the user's own trigger words for one LoRA. POST {name, words}.

    The name is a STORE KEY, never a filesystem path - it is normalised by
    custom_trigger_key and used as a dict key, so it cannot reach the disk. We
    still resolve it against the loras dirs first so the store only ever gains
    entries for LoRAs that actually exist (a typo'd or hostile name is refused
    rather than silently accumulating). Always 200."""
    try:
        data = await request.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    name = data.get("name", "") or request.query.get("name", "")
    words = data.get("words", [])
    path = _resolve_lora_path(name)
    roots = _lora_dirs()
    if not path or not roots or not _is_path_under(path, *roots):
        return web.json_response({"ok": False, "message": "LoRA not found."})
    import asyncio
    loop = asyncio.get_event_loop()
    try:
        stored = await loop.run_in_executor(
            None, _lora_set_custom, _lora_custom_file(), name, words
        )
    except Exception as exc:
        return web.json_response({"ok": False, "message": "Could not save: {}".format(exc)})
    return web.json_response({"ok": True, "words": stored})


@PromptServer.instance.routes.post("/pixaroma/api/lora/civitai_delete")
async def api_lora_civitai_delete(request):
    """Delete the cached Civitai sidecar (<base>.civitai.info) next to the LoRA, so the
    info reverts to the file's own words. POST {name}. Path-guarded to the loras dirs;
    always 200."""
    try:
        data = await request.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    name = data.get("name", "") or request.query.get("name", "")
    path = _resolve_lora_path(name)
    roots = _lora_dirs()
    if not path or not roots or not _is_path_under(path, *roots):
        return web.json_response({"ok": False, "message": "LoRA not found."})
    import asyncio
    loop = asyncio.get_event_loop()
    ok = await loop.run_in_executor(None, _lora_delete_sidecar, path)
    return web.json_response({"ok": bool(ok)})


# ── Pixaroma Workflows ───────────────────────────────────────────────────────
# Back the workflow browser: one cached index of the user's workflow folder, a
# sidecar for the things ComfyUI has nowhere to keep (notes, chosen covers,
# folder colours), folder create/rename/delete, and reveal-in-explorer.
#
# Opening, renaming, moving and deleting WORKFLOWS is deliberately NOT here:
# that all goes through ComfyUI's own workflow store in the browser, so its open
# tabs and modified flags stay correct. These routes only do what core has no
# API for.


def _wf_user_dir(request):
    """The user folder ComfyUI is actually using. Single-user installs are
    'default'; a multi-user setup sends the id in the comfy-user header, which
    is how core resolves it too."""
    base = folder_paths.get_user_directory()
    uid = "default"
    try:
        header = request.headers.get("comfy-user")
        if header and _sanitize_id(header, "") == header:
            uid = header
    except Exception:
        pass
    return os.path.join(base, uid)


def _wf_root(request):
    return os.path.join(_wf_user_dir(request), "workflows")


def _wf_cache_path(request):
    # Kept OUTSIDE the workflows folder, or the cache would index itself.
    return os.path.join(_wf_user_dir(request), "pixaroma_workflows_cache.json")


def _wf_meta_path(request):
    return os.path.join(_wf_user_dir(request), "pixaroma_workflows_meta.json")


def _wf_resolve(root, rel):
    """A relative path from the browser turned into a real one inside the
    workflows folder, or None. Returns None for empty, so a caller can never
    accidentally operate on the root itself."""
    rel = (rel or "").replace("\\", "/").strip("/")
    if not rel or rel == ".":
        return None
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    if not parts:
        return None
    p = os.path.normpath(os.path.join(root, *parts))
    if not _is_path_under(p, root):
        return None
    return p


def _wf_registered_types():
    """Class names ComfyUI has actually loaded, for the missing-node check."""
    try:
        import nodes as _comfy_nodes
        return set(_comfy_nodes.NODE_CLASS_MAPPINGS.keys())
    except Exception:
        return set()


def _wf_list_folders(root):
    """Every folder under the workflows root, including empty ones - those hold
    no entries, so they would otherwise be invisible in the browser."""
    out = []
    for dirpath, dirnames, _files in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        if os.path.abspath(dirpath) == os.path.abspath(root):
            continue
        out.append(os.path.relpath(dirpath, root).replace(os.sep, "/"))
    out.sort(key=lambda s: s.lower())
    return out


def _wf_read_meta(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except FileNotFoundError:
        return {}                     # first run, nothing to preserve
    except (OSError, ValueError, UnicodeDecodeError, RecursionError):
        # It EXISTS but will not parse. Returning {} here and letting the next
        # save write that back would erase every note, cover and folder colour
        # the moment somebody typed one character. Keep a copy first, so the
        # data is recoverable by hand instead of gone.
        try:
            broken = path + ".broken"
            if not os.path.exists(broken):
                shutil.copy2(path, broken)
                print(f"[Pixaroma] workflows sidecar unreadable; kept a copy at {broken}")
        except OSError:
            pass
    return {}


def _wf_write_meta(path, data):
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, path)
        return True
    except OSError:
        try:
            os.remove(tmp)
        except OSError:
            pass
        return False


def _wf_build_payload(root, cache_path, registered):
    """Runs off the event loop - it stats and parses every workflow file, and
    blocking here would stall image generation progress for everyone."""
    entries = _wf_build_index(root, cache_path)
    return {
        "ok": True,
        "entries": entries,
        "folders": _wf_list_folders(root),
        "collections": _wf_collections(entries),
        "issues": _wf_detect_issues(entries, registered),
    }


@PromptServer.instance.routes.get("/pixaroma/api/workflows/index")
async def api_workflows_index(request):
    """Everything the browser needs to draw itself, in one request."""
    root = _wf_root(request)
    if not os.path.isdir(root):
        return web.json_response(
            {"ok": True, "entries": [], "folders": [], "collections": [],
             "issues": {"unsaved_names": [], "duplicates": [], "missing_nodes": []}},
            headers={"Cache-Control": "no-store"},
        )
    import asyncio
    loop = asyncio.get_event_loop()
    try:
        payload = await loop.run_in_executor(
            None, _wf_build_payload, root, _wf_cache_path(request), _wf_registered_types()
        )
    except Exception as e:
        return web.json_response(
            {"ok": False, "message": str(e), "entries": [], "folders": [],
             "collections": [], "issues": {}},
            headers={"Cache-Control": "no-store"},
        )
    # no-store, or a browser can heuristically cache this and show a workflow
    # list that no longer matches the disk (convention #18).
    return web.json_response(payload, headers={"Cache-Control": "no-store"})


# The sidecar's shape, in one place. Anything not listed here is IGNORED on
# write - which silently swallowed folderOrder when it was first added and made
# "Move up" look like it did nothing at all. Add the key here as well as at the
# call site.
_WF_META_DICTS = ("notes", "covers", "folderColors")
_WF_META_LISTS = ("folderOrder", "folderExpanded")

# Every write is read-modify-write on one small file. Without this, a folder
# reorder and a note autosave landing together could each read before the other
# wrote, and the second write would put the first one's section back as it was -
# the exact "two panels must not wipe each other" case the merge was meant to
# cover, which merging alone cannot fix across separate requests.
_WF_META_LOCK = asyncio.Lock()


@PromptServer.instance.routes.get("/pixaroma/api/workflows/meta")
async def api_workflows_meta_get(request):
    # This GET can WRITE - it migrates old embedded covers and forgets ones
    # whose picture has gone - so it takes the same lock as the POST. Without
    # it, a GET that read before a save landed could write its own older copy
    # straight back over the top, losing the note that had just been saved.
    # And it does its disk work off the event loop, like the index route: a
    # stat per cover on a slow or networked drive would stall generation
    # progress for everyone.
    import asyncio
    async with _WF_META_LOCK:
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _wf_read_and_heal_meta, request)
    for k in _WF_META_DICTS:
        data.setdefault(k, {})
    for k in _WF_META_LISTS:
        data.setdefault(k, [])
    return web.json_response({"ok": True, "meta": data},
                             headers={"Cache-Control": "no-store"})


def _wf_read_and_heal_meta(request):
    path = _wf_meta_path(request)
    data = _wf_read_meta(path)
    # The healing is a courtesy, never a reason to fail the read. A sidecar that
    # has been hand-edited (or written by a much older version) can hold shapes
    # these passes do not expect, and this is the one workflow route with no
    # outer try of its own - an exception here 500s the panel on EVERY open,
    # permanently, until the file is fixed by hand. Far better to serve the data
    # unhealed.
    try:
        dirty = _wf_migrate_embedded_covers(request, data)
        dirty = _wf_drop_missing_covers(request, data) or dirty
    except Exception:
        return data
    if dirty:
        _wf_write_meta(path, data)
    return data


@PromptServer.instance.routes.post("/pixaroma/api/workflows/meta")
async def api_workflows_meta_post(request):
    """Merges rather than replaces, key by key. Two panels open at once must not
    be able to wipe each other's notes."""
    try:
        patch = await request.json()
    except Exception:
        patch = {}
    if not isinstance(patch, dict):
        return web.json_response({"ok": False, "message": "bad payload"})

    async with _WF_META_LOCK:
        return _wf_apply_meta_patch(request, patch)


def _wf_apply_meta_patch(request, patch):
    path = _wf_meta_path(request)
    data = _wf_read_meta(path)

    # Every picture that STOPS being referenced by this patch, whether because
    # its key was cleared or because that key was pointed at something else. The
    # deletions happen ONCE, at the end, against the FINAL state - which is what
    # makes the whole thing order-independent. Deleting inside the merge meant
    # asking "is anything else using this?" of a half-applied patch, and the
    # answer could be no purely because the key that re-points it had not been
    # merged yet.
    orphan_candidates = []

    # Dict sections merge key by key, so two panels cannot wipe each other.
    for section in _WF_META_DICTS:
        incoming = patch.get(section)
        if not isinstance(incoming, dict):
            continue
        current = data.get(section)
        if not isinstance(current, dict):
            current = {}

        for k, v in incoming.items():
            old = current.get(k)
            if v is None:
                current.pop(k, None)            # an explicit null clears one entry
            else:
                # A covers record names a FILE WE WILL LATER DELETE, so refuse a
                # filename we could not have written rather than storing it and
                # finding out at os.remove time.
                if section == "covers" and isinstance(v, dict) and "file" in v \
                        and not _wf_is_cover_name(v.get("file")):
                    continue
                # A run's own output must NEVER replace a picture the user chose
                # by hand. The automatic capture fires on every execution and
                # cannot see this file (it runs whether or not the panel was ever
                # opened), so the protection belongs here, at the one write point
                # every client goes through. Skipping before the orphan check
                # below is deliberate: nothing changed, so the old picture is
                # still referenced and must not be queued for deletion.
                # "Remove cover" clears the key, which is how the user opts back
                # in to their own output filling it - exactly what its tooltip
                # promises.
                if section == "covers" and isinstance(v, dict) \
                        and v.get("kind") == "output" \
                        and isinstance(old, dict) and old.get("kind") == "file":
                    continue
                current[k] = v
            # Overwriting a cover strands its old picture just as surely as
            # clearing it does. Only the clear case used to be considered, so
            # every workflow run that replaced a hand-picked cover with its own
            # output left the chosen file behind forever.
            if section == "covers" and isinstance(old, dict) and old.get("file"):
                if not (isinstance(v, dict) and v.get("file") == old["file"]):
                    orphan_candidates.append(old["file"])
        data[section] = current

    # List sections REPLACE. An order is meaningless merged key by key - the
    # whole point of sending it is that the sequence changed.
    for section in _WF_META_LISTS:
        incoming = patch.get(section)
        if isinstance(incoming, list):
            data[section] = [x for x in incoming if isinstance(x, str)]

    ok = _wf_write_meta(path, data)

    # Only after the write landed. Removing a picture and then failing to save
    # the record that stopped pointing at it would leave a cover referencing a
    # file that is no longer there.
    if ok:
        for name in orphan_candidates:
            if _wf_cover_referenced(data, name):
                continue                        # something else still wants it
            target = _wf_cover_path(request, name)
            if not target:
                continue                        # not a name we could have written
            try:
                os.remove(target)
            except OSError:
                pass                            # already gone, or in use
    return web.json_response({"ok": ok, "meta": data})


@PromptServer.instance.routes.post("/pixaroma/api/workflows/folder")
async def api_workflows_folder(request):
    """Create, rename or delete a folder. Core has no API for this; workflow
    FILES are never touched here - those go through ComfyUI's own store."""
    try:
        data = await request.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    action = str(data.get("action", ""))
    root = _wf_root(request)
    path = _wf_resolve(root, data.get("path", ""))

    if action == "create":
        if not path:
            return web.json_response({"ok": False, "message": "Give the folder a name."})
        bad = _wf_reserved_part(root, path)
        if bad:
            return web.json_response(
                {"ok": False, "message": f'"{bad}" is a name Windows keeps for itself. '
                                         f"Pick another one."})
        if os.path.exists(path):
            return web.json_response({"ok": False, "message": "That folder already exists."})
        try:
            os.makedirs(path)
        except OSError as e:
            return web.json_response({"ok": False, "message": str(e)})
        return web.json_response({"ok": True})

    if action == "rename":
        new_path = _wf_resolve(root, data.get("newPath", ""))
        if not path or not new_path:
            return web.json_response({"ok": False, "message": "Bad folder name."})
        if not os.path.isdir(path):
            return web.json_response({"ok": False, "message": "That folder is gone."})
        bad = _wf_reserved_part(root, new_path)
        if bad:
            return web.json_response(
                {"ok": False, "message": f'"{bad}" is a name Windows keeps for itself. '
                                         f"Pick another one."})
        if os.path.exists(new_path):
            return web.json_response({"ok": False, "message": "A folder with that name already exists."})
        try:
            os.rename(path, new_path)
        except OSError as e:
            return web.json_response({"ok": False, "message": str(e)})
        return web.json_response({"ok": True})

    if action == "delete":
        if not path or not os.path.isdir(path):
            return web.json_response({"ok": False, "message": "That folder is gone."})
        try:
            # Deliberately os.rmdir, never a recursive delete: refusing a folder
            # that still holds work is the whole safety story here, and there is
            # no undo in this version.
            os.rmdir(path)
        except OSError:
            return web.json_response(
                {"ok": False, "message": "That folder still has things in it. Empty it first."})
        return web.json_response({"ok": True})

    return web.json_response({"ok": False, "message": "Unknown action."})


@PromptServer.instance.routes.post("/pixaroma/api/workflows/reveal")
async def api_workflows_reveal(request):
    """Open the OS file explorer at a workflow's folder. Same trust level as the
    Save Image reveal: the server IS the user's machine."""
    try:
        data = await request.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    root = _wf_root(request)
    target = _wf_resolve(root, data.get("path", "")) or root
    folder = target if os.path.isdir(target) else os.path.dirname(target)
    if not os.path.isdir(folder) or not _is_path_under(folder, root):
        return web.json_response({"ok": False, "message": "Folder not found."})
    try:
        import subprocess
        import sys
        if sys.platform == "win32":
            # Plain open only - see the Save Image reveal route for why a
            # bring-to-front script must never be re-added here.
            os.startfile(folder)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", folder])
        else:
            subprocess.Popen(["xdg-open", folder])
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"ok": False, "message": str(e)})


# ── cover pictures ───────────────────────────────────────────────────────────
# A hand-picked cover used to be embedded in the sidecar as a base64 data URL.
# That file is fetched WHOLE every time the panel opens, so three covers already
# made it 96 KB and fifty would have made it ~1.5 MB on every open. Covers are
# written as real jpg files here instead, and the sidecar keeps only a filename.
#
# The stored name is derived from the workflow path so it is stable, and each
# save bumps a version number that the browser puts in the URL - which means the
# image can be cached hard and still update the moment it is replaced.

_WF_COVER_DIRNAME = "pixaroma_covers"
_WF_COVER_MAX_BYTES = 8 * 1024 * 1024
# The migration path is deliberately far more generous than a fresh upload: the
# picture is already the user's chosen cover, so the only question is whether we
# can afford to decode it here, not whether to keep it. Over this, it simply
# stays embedded.
_WF_MIGRATE_MAX_CHARS = 64 * 1024 * 1024
# _wf_looks_like_image is imported at the top - it is pure, so it lives in the
# helpers module where the test harness can reach it.


def _wf_covers_dir(request, create=False):
    d = os.path.join(_wf_user_dir(request), _WF_COVER_DIRNAME)
    if create:
        try:
            os.makedirs(d, exist_ok=True)
        except OSError:
            pass
    return d


def _wf_cover_path(request, name):
    """The on-disk path for one of our cover files, or None if the name is not
    ours. Every os.remove of a cover goes through this."""
    if not _wf_is_cover_name(name):
        return None
    folder = _wf_covers_dir(request)
    path = os.path.join(folder, name)
    # Belt as well as braces: the regex already rules out separators, but the
    # containment check is what a reader will look for.
    return path if _is_path_under(path, folder) else None


def _wf_cover_name(rel):
    """Stable per workflow, and safe as a filename whatever the path contains."""
    return hashlib.sha1(rel.encode("utf-8")).hexdigest()[:16] + ".jpg"


def _wf_cover_referenced(meta, filename, skip_key=None):
    """True when some OTHER workflow still points at this file. Renaming a
    workflow re-points the same picture at a new key, so deleting the file just
    because the old key went away would throw away a cover that is still in
    use."""
    for k, v in (meta.get("covers") or {}).items():
        if k == skip_key:
            continue
        if isinstance(v, dict) and v.get("file") == filename:
            return True
    return False


def _wf_drop_missing_covers(request, data):
    """Forget covers whose picture is no longer on disk.

    The folder is a normal folder and people delete things in it. Without this
    the sidecar kept pointing at a file that had gone, the card showed a broken
    reference, and "Remove cover" was offered for something that did not exist.
    Returns True when something was dropped."""
    covers = data.get("covers")
    if not isinstance(covers, dict):
        return False
    folder = _wf_covers_dir(request)

    # os.path.isfile answers False for "deleted" AND for "could not look" - a
    # disconnected network drive, an antivirus lock, a permission blip. Treating
    # those the same would wipe EVERY cover reference on one bad moment. If the
    # folder itself cannot be listed, assume nothing and change nothing.
    if not os.path.isdir(folder):
        return False
    try:
        present = set(os.listdir(folder))
    except OSError:
        return False

    # Also forget covers whose WORKFLOW has gone. Renaming carries the cover
    # across to the new path first (the browser does that), so anything still
    # pointing at a path with no file behind it is genuinely orphaned, and its
    # picture would otherwise sit there forever.
    wf_root = _wf_root(request)
    wf_root_ok = os.path.isdir(wf_root)

    changed = False
    for rel, rec in list(covers.items()):
        if not isinstance(rec, dict) or rec.get("kind") != "file":
            continue
        name = rec.get("file")
        # isinstance, not just truthiness: `name not in present` against a SET
        # raises TypeError for a list or a dict, and a corrupt or hand-edited
        # sidecar is exactly the situation this healing pass exists for - it
        # must not be the thing that 500s the route.
        if not isinstance(name, str):
            name = None
        if name and name not in present:
            covers.pop(rel, None)
            changed = True
            continue
        if wf_root_ok:
            wf_path = _wf_resolve(wf_root, rel)
            if wf_path and not os.path.isfile(wf_path):
                covers.pop(rel, None)
                changed = True
                if name and not _wf_cover_referenced(data, name, skip_key=rel):
                    path = _wf_cover_path(request, name)
                    if path:
                        try:
                            os.remove(path)
                        except OSError:
                            pass
    return changed


def _wf_migrate_embedded_covers(request, data):
    """Move any base64 cover left over from the first version out to a file.
    Runs on read, so it happens once, by itself, with nothing for the user to
    do. Returns True when something changed and the sidecar needs writing."""
    covers = data.get("covers")
    if not isinstance(covers, dict):
        return False
    changed = False
    for rel, rec in list(covers.items()):
        if not isinstance(rec, dict):
            continue
        # str(), not `or ""`: `or` returns the truthy operand, so a record whose
        # "url" is a dict or a number reached .startswith and raised
        # AttributeError - out of this function, out of the healing read, and
        # out of the meta route, which 500s every panel open from then on.
        url = rec.get("url")
        url = url if isinstance(url, str) else ""
        if not (rec.get("kind") == "file" and url.startswith("data:")):
            continue
        # Bounded so one absurd leftover cannot be decoded whole on every read.
        # Generous, because this is an EXISTING cover the user already chose:
        # over the limit it stays embedded (slow but intact) rather than being
        # thrown away. Only genuinely unreadable base64 is dropped.
        if len(url) > _WF_MIGRATE_MAX_CHARS:
            continue
        try:
            payload = url.split(",", 1)[1]
            raw = base64.b64decode(payload)
        except Exception:
            covers.pop(rel, None)          # unreadable leftover, drop it
            changed = True
            continue
        if not raw:
            covers.pop(rel, None)
            changed = True
            continue
        name = _wf_cover_name(rel)
        try:
            os.makedirs(_wf_covers_dir(request, create=True), exist_ok=True)
            with open(os.path.join(_wf_covers_dir(request), name), "wb") as f:
                f.write(raw)
        except OSError:
            continue                        # leave it embedded rather than lose it
        covers[rel] = {"kind": "file", "file": name, "v": 1}
        changed = True
    return changed


@PromptServer.instance.routes.post("/pixaroma/api/workflows/cover")
async def api_workflows_cover_set(request):
    """Store a hand-picked cover as a real file and point the sidecar at it."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    rel = str(body.get("rel", "") or "")
    data_url = str(body.get("dataUrl", "") or "")
    if not rel or "," not in data_url:
        return web.json_response({"ok": False, "message": "Nothing to save."})

    payload = data_url.split(",", 1)[1]
    # Checked BEFORE decoding: base64 expands by about a third, so decoding
    # first meant the cap could not bound the memory used to reject an
    # oversized payload.
    if len(payload) > _WF_COVER_MAX_BYTES * 4 // 3 + 8:
        return web.json_response({"ok": False, "message": "That picture is too large."})
    try:
        raw = base64.b64decode(payload)
    except Exception:
        return web.json_response({"ok": False, "message": "That picture could not be read."})
    if not raw or len(raw) > _WF_COVER_MAX_BYTES:
        return web.json_response({"ok": False, "message": "That picture is too large."})
    if not _wf_looks_like_image(raw):
        return web.json_response(
            {"ok": False, "message": "That file is not a picture the browser can show."})

    name = _wf_cover_name(rel)
    folder = _wf_covers_dir(request, create=True)
    path = os.path.join(folder, name)
    if not _is_path_under(path, folder):
        return web.json_response({"ok": False, "message": "Bad cover path."})
    # Written to a temp file and moved into place. The filename is the same
    # every time for a given workflow, so replacing a cover would otherwise let
    # a request in flight read a half-written jpg.
    tmp = "%s.%d.tmp" % (path, threading.get_ident())
    try:
        with open(tmp, "wb") as f:
            f.write(raw)
        os.replace(tmp, path)
    except OSError as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        return web.json_response({"ok": False, "message": str(e)})

    async with _WF_META_LOCK:
        return _wf_record_cover(request, rel, name)


def _wf_record_cover(request, rel, name):
    # Resolved HERE, not inherited. This used to read a `folder` local belonging
    # to the CALLER, so the one path that needs it - the write-failed cleanup
    # below - raised NameError instead of tidying up, and NameError is not an
    # OSError so the except missed it and the route 500'd.
    folder = _wf_covers_dir(request)
    meta_path = _wf_meta_path(request)
    meta = _wf_read_meta(meta_path)
    covers = meta.get("covers")
    if not isinstance(covers, dict):
        covers = {}
    # A TIMESTAMP, not a counter. The filename is derived from the workflow
    # path, so it is the same every time; a counter restarted at 1 whenever the
    # entry had been dropped (deleting the picture by hand does exactly that),
    # producing a url identical to one the browser may still be holding - and
    # the new cover would show as the old one. A millisecond stamp cannot repeat.
    version = int(time.time() * 1000)
    # The record being REPLACED can point at a DIFFERENT file than the one just
    # written: the filename is hashed from the workflow's path, so after a
    # rename the carried-over record still holds the OLD path's hash, and the
    # next hand-pick writes the NEW hash. The meta-patch route learned to clean
    # up superseded pictures; this route is its own write path and did not, so
    # every rename-then-repick stranded a jpg in the covers folder forever.
    prev = covers.get(rel)
    old_name = prev.get("file") if isinstance(prev, dict) else None
    # Asked BEFORE the overwrite, while `meta` still describes what is on disk:
    # does anything on disk point at the file the upload just (over)wrote?
    # Needed by the failure branch below, where the sidecar write did NOT land,
    # so the on-disk records are the ones that matter.
    name_was_referenced = _wf_cover_referenced(meta, name)
    covers[rel] = {"kind": "file", "file": name, "v": version}
    meta["covers"] = covers
    if not _wf_write_meta(meta_path, meta):
        # The record write failed, so the sidecar still holds whatever it held.
        # Deleting the uploaded file is only CLEANUP when nothing on disk points
        # at that name - and something usually does: the filename is hashed from
        # the workflow's path, so RE-picking a cover for a workflow that already
        # has one writes the SAME name its existing record references. Deleting
        # unconditionally here destroyed that existing cover on a failed save -
        # the record survived, pointed at nothing, and the next read pruned it.
        # When the old record references the name, the file (now holding the new
        # bytes) simply stays: the user keeps a working cover either way.
        if not name_was_referenced:
            try:
                os.remove(os.path.join(folder, name))
            except OSError:
                pass
        return web.json_response({"ok": False, "message": "Could not save the cover setting."})
    # Only after the write landed, and with the same guards as everywhere else:
    # the shape check (a corrupt record must not aim os.remove), the reference
    # check against the FINAL state, and _wf_cover_path as the one way a name
    # becomes a path.
    if old_name and old_name != name and not _wf_cover_referenced(meta, old_name):
        old_path = _wf_cover_path(request, old_name)
        if old_path:
            try:
                os.remove(old_path)
            except OSError:
                pass
    return web.json_response({"ok": True, "file": name, "v": version})


@PromptServer.instance.routes.get("/pixaroma/api/workflows/cover/{name}")
async def api_workflows_cover_get(request):
    name = request.match_info.get("name", "")
    # The name is ours (a hex digest plus .jpg), so anything else is not one of
    # ours and there is no reason to go looking for it. Same validator the
    # delete paths use - one definition, so read and delete can never disagree
    # about what counts as one of our files.
    path = _wf_cover_path(request, name)
    if not path or not os.path.isfile(path):
        return web.Response(status=404, text="Not found")
    # NOT "immutable". These are ordinary files in a folder the user can open,
    # and deleting one by hand left the old picture on screen for a year because
    # the browser never asked again. "no-cache" still avoids re-downloading -
    # FileResponse sends a validator, so the usual answer is a cheap 304 - but a
    # file that has gone now 404s straight away and the card falls back to the
    # drawn map.
    return web.FileResponse(path, headers={"Cache-Control": "no-cache"})


# ── Duration Pixaroma: preview a CUSTOM formula ────────────────────────────
# The recipe maths is mirrored in the browser so the node face updates the
# instant you click. A user-written FORMULA is not mirrored on purpose: a second
# expression evaluator in JS would agree with Python's simpleeval only until it
# did not, and the node would then show one number and generate another. So the
# face asks the one real evaluator what it will produce.
#
# Read-only and side-effect free: it evaluates the same sandboxed expression the
# node itself would run, touches no filesystem and stores nothing. The formula
# is attacker-supplied like every other input on this unauthenticated server,
# which is exactly why it goes through _duration_helpers (simpleeval, capped
# length, capped exponent) and never near eval().
@PromptServer.instance.routes.post("/pixaroma/api/duration/preview")
async def api_duration_preview(request):
    import math

    from .nodes._duration_helpers import (
        frames_from_formula, frames_from_seconds, MAX_FORMULA_LEN,
    )

    try:
        # aiohttp's content.read(N) returns only what is BUFFERED for a positive
        # N, so it can silently truncate. json() reads the whole body; the size
        # ceiling is the client_max_size aiohttp already enforces.
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "bad request"}, status=400)
    if not isinstance(data, dict):
        return web.json_response({"ok": False, "error": "bad request"}, status=400)

    formula = data.get("formula")
    if not isinstance(formula, str) or len(formula) > MAX_FORMULA_LEN:
        formula = ""

    def _f(key, fallback):
        try:
            value = float(data.get(key, fallback))
        except (TypeError, ValueError, OverflowError):
            return float(fallback)
        return value if math.isfinite(value) else float(fallback)

    seconds = _f("seconds", 5.0)
    fps = _f("fps", 24.0)
    step = _f("step", 17)
    plus = _f("plus", 5)
    min_frames = _f("minFrames", 5)

    frames = frames_from_formula(formula, seconds, fps)
    ok = frames is not None
    if not ok:
        # Report the fallback the node itself would use, so the face can say
        # what will really happen instead of only that something is wrong.
        frames = frames_from_seconds(seconds, fps, step, plus, min_frames)
    actual = (frames / fps) if fps > 0 else 0.0
    return web.json_response(
        {"ok": ok, "frames": int(frames), "actual": float(actual)},
        headers={"Cache-Control": "no-store"},
    )


# ── Load Audio Pixaroma ─────────────────────────────────────────────────────
# The node's picker is our own DOM popup, not a native combo, so ComfyUI's R
# (Refresh Node Definitions) cannot reach it - core only rewrites native combo
# widgets. Convention #18: the picker re-fetches on EVERY open and this answer
# is never cached, so a file dropped in the input folder shows up without a
# refresh, let alone a restart.
_AUDIO_EXTS = (".wav", ".mp3", ".flac", ".ogg", ".opus", ".m4a", ".aac", ".wma", ".aiff", ".aif")


@PromptServer.instance.routes.get("/pixaroma/api/load_audio/list")
async def api_load_audio_list(request):
    """Sound files sitting in ComfyUI's input folder."""
    hdrs = {"Cache-Control": "no-store"}
    try:
        input_dir = folder_paths.get_input_directory()
        names = []
        for n in os.listdir(input_dir):
            if not n.lower().endswith(_AUDIO_EXTS):
                continue
            try:
                if os.path.isfile(os.path.join(input_dir, n)):
                    names.append(n)
            except OSError:
                continue
        names.sort(key=lambda s: s.lower())
    except Exception:
        # A SCAN FAILURE is not an empty folder. Saying [] would make the node
        # report "no audio files" on a transient locked-folder hiccup, which
        # reads as "my files are gone" (same reasoning as the LoRA list above).
        return web.json_response({"files": [], "error": True}, headers=hdrs)
    return web.json_response({"files": names}, headers=hdrs)


# ---------------------------------------------------------------------------
# Video Prompt Pixaroma - the editable formulas
# ---------------------------------------------------------------------------
# The formulas are FILES, not settings: 8.7k to 12.3k characters each, times
# three modes, plus four duration tiers apiece. The shipped copies live in
# assets/video_prompt_formulas; an edit is written to <ComfyUI user dir>/pixaroma/
# video_prompt_formulas so a pack update never overwrites it and Reset can always put the
# original back.
#
# CONTAINMENT: the only caller-supplied value that reaches a filename is `mode`,
# and it is checked against a FIXED tuple before anything touches the disk
# (_vp.valid_mode). That is stronger than sanitising a free string, because no
# request can name a file we did not ship. Nothing here builds a path out of
# user text, so there is no join to get wrong (.claude/patterns/path-containment.md).

_VP_MAX_FORMULA = 400_000      # ~30x the largest shipped formula
_VP_MAX_TIERS = 24
_VP_MAX_TIER_VALUE = 40_000
_VP_MAX_TIER_NAME = 200


def _vp_no_store():
    return {"Cache-Control": "no-store"}


@PromptServer.instance.routes.get("/pixaroma/api/video_prompt/formulas")
async def api_video_prompt_formulas(request):
    """Everything the settings panel needs, in one request.

    Re-read from disk every time (convention #18): our own route gets nothing
    from ComfyUI's R refresh, so a cached answer would look permanently stale
    after an edit made anywhere else.
    """
    out = {"modes": {}, "models": []}
    for mode in _vp.MODES:
        try:
            formula = _vp.load_formula(mode)
            tiers = _vp.load_durations(mode)
            out["modes"][mode] = {
                "formula": formula,
                "chars": len(formula),
                "edited": _vp.is_edited(mode),
                "durations": tiers,
            }
        except Exception:
            out["modes"][mode] = {
                "formula": "", "chars": 0, "edited": False, "durations": [],
            }
    try:
        out["models"] = list(folder_paths.get_filename_list("text_encoders"))
        out["sizes"] = _text_encoder_sizes(out["models"])
    except Exception:
        # A scan failure is not an empty folder - saying [] would make the panel
        # claim the user has no text encoders at all.
        out["models"] = []
        out["sizes"] = {}
        out["models_error"] = True
    return web.json_response(out, headers=_vp_no_store())


@PromptServer.instance.routes.post("/pixaroma/api/video_prompt/formula")
async def api_video_prompt_save_formula(request):
    try:
        data = await request.json()
    except Exception:
        data = None
    # request.json() returns ANY type, so never assume a dict.
    if not isinstance(data, dict):
        return web.json_response({"ok": False, "error": "bad body"}, status=400,
                                 headers=_vp_no_store())
    mode = data.get("mode")
    text = data.get("text")
    if not _vp.valid_mode(mode):
        return web.json_response({"ok": False, "error": "unknown mode"}, status=400,
                                 headers=_vp_no_store())
    if not isinstance(text, str):
        return web.json_response({"ok": False, "error": "text must be a string"},
                                 status=400, headers=_vp_no_store())
    if len(text) > _VP_MAX_FORMULA:
        return web.json_response({"ok": False, "error": "formula too large"},
                                 status=413, headers=_vp_no_store())
    ok = _vp.save_formula(mode, text)
    return web.json_response({"ok": bool(ok)}, headers=_vp_no_store())


@PromptServer.instance.routes.post("/pixaroma/api/video_prompt/durations")
async def api_video_prompt_save_durations(request):
    try:
        data = await request.json()
    except Exception:
        data = None
    if not isinstance(data, dict):
        return web.json_response({"ok": False, "error": "bad body"}, status=400,
                                 headers=_vp_no_store())
    mode = data.get("mode")
    tiers = data.get("tiers")
    if not _vp.valid_mode(mode):
        return web.json_response({"ok": False, "error": "unknown mode"}, status=400,
                                 headers=_vp_no_store())
    if not isinstance(tiers, list) or not tiers:
        return web.json_response({"ok": False, "error": "tiers must be a list"},
                                 status=400, headers=_vp_no_store())
    if len(tiers) > _VP_MAX_TIERS:
        return web.json_response({"ok": False, "error": "too many tiers"},
                                 status=413, headers=_vp_no_store())
    for item in tiers:
        if not isinstance(item, dict):
            continue
        # The NAME was uncapped while the value was capped, so one unauthenticated
        # POST could write ~20 MB of tier names (aiohttp's client_max_size) into
        # the user dir, repeatably, each then rendering as a chip label.
        if len(str(item.get("name", ""))) > _VP_MAX_TIER_NAME:
            return web.json_response({"ok": False, "error": "tier name too long"},
                                     status=413, headers=_vp_no_store())
        if len(str(item.get("value", ""))) > _VP_MAX_TIER_VALUE:
            return web.json_response({"ok": False, "error": "tier too large"},
                                     status=413, headers=_vp_no_store())
    ok = _vp.save_durations(mode, tiers)
    return web.json_response({"ok": bool(ok)}, headers=_vp_no_store())


@PromptServer.instance.routes.post("/pixaroma/api/video_prompt/reset")
async def api_video_prompt_reset(request):
    """Delete the user's override so the shipped formula is used again."""
    try:
        data = await request.json()
    except Exception:
        data = None
    if not isinstance(data, dict):
        return web.json_response({"ok": False, "error": "bad body"}, status=400,
                                 headers=_vp_no_store())
    mode = data.get("mode")
    if not _vp.valid_mode(mode):
        return web.json_response({"ok": False, "error": "unknown mode"}, status=400,
                                 headers=_vp_no_store())
    ok = _vp.reset_formula(mode)
    return web.json_response({"ok": bool(ok)}, headers=_vp_no_store())


# ---------------------------------------------------------------------------
# AI Prompt Pixaroma
# ---------------------------------------------------------------------------
def _text_encoder_sizes(names):
    """Byte size per text-encoder file, for the picker's size labels.

    The user asked for the size beside the name so a 2b / 4b / 9b of the same
    family can be told apart at a glance, which matters now that several sizes
    of the same model are installed.

    Kept as a SEPARATE map rather than folding it into the `models` list: that
    list is a plain array of strings and several `.includes(...)` checks in the
    three panels depend on it (the wired-clip lock, the preset model hint, the
    "model no longer on disk" warning). Changing its shape would break all of
    them for a cosmetic label.

    Best effort and never raises. A model whose path cannot be resolved simply
    gets no size shown, which is better than failing the whole list - the list
    is what the panel actually needs.
    """
    out = {}
    for n in names:
        try:
            p = folder_paths.get_full_path("text_encoders", n)
            if p:
                out[n] = os.path.getsize(p)
        except Exception:
            pass
    return out


@PromptServer.instance.routes.get("/pixaroma/api/ai_prompt/models")
async def api_ai_prompt_models(request):
    """The text encoders on disk, for the node's model picker.

    That is ALL this node needs from the server - its formula lives on the
    node, not in a file, so there is nothing here to save or reset.

    Re-listed on every panel open (convention #18): a custom picker backed by
    our own route gets nothing from ComfyUI's R refresh, so a session cache
    would look permanently stale after a rename. `error` is reported separately
    so an empty folder and a failed scan cannot be confused - saying [] for a
    scan failure would tell the user they own no models at all.
    """
    try:
        models = list(folder_paths.get_filename_list("text_encoders"))
        return web.json_response(
            {"models": models, "sizes": _text_encoder_sizes(models)},
            headers=_vp_no_store(),
        )
    except Exception as e:
        return web.json_response(
            {"models": [], "sizes": {}, "error": str(e)}, headers=_vp_no_store()
        )


@PromptServer.instance.routes.get("/pixaroma/api/ai_prompt/presets")
async def api_ai_prompt_presets(request):
    """The shipped presets and the user's own, re-read every time.

    Split so the UI can show which are yours (deletable) and which ship with
    the pack (not deletable). Never raises: a corrupt user file returns an
    empty list rather than taking the picker down.

    userError says that empty list means "could not be read" rather than "you
    have none" - an empty folder and a broken read must never look identical
    (convention #18), and here they differ by whether the user has lost
    anything.
    """
    try:
        return web.json_response(
            {
                "shipped": _aip.load_shipped(),
                "user": _aip.load_user(),
                "userError": not _aip.user_readable(),
            },
            headers=_vp_no_store(),
        )
    except Exception as e:
        return web.json_response(
            {"shipped": [], "user": [], "error": str(e)}, headers=_vp_no_store()
        )


@PromptServer.instance.routes.post("/pixaroma/api/ai_prompt/presets/save")
async def api_ai_prompt_preset_save(request):
    try:
        data = await request.json()
    except Exception:
        data = None
    if not isinstance(data, dict):
        return web.json_response({"ok": False, "error": "bad body"}, status=400,
                                 headers=_vp_no_store())
    ok, message = _aip.save_user(data)
    return web.json_response({"ok": bool(ok), "message": message},
                             headers=_vp_no_store())


@PromptServer.instance.routes.post("/pixaroma/api/ai_prompt/presets/delete")
async def api_ai_prompt_preset_delete(request):
    """Deletes one of the USER's presets only - the shipped file is read-only."""
    try:
        data = await request.json()
    except Exception:
        data = None
    if not isinstance(data, dict):
        return web.json_response({"ok": False, "error": "bad body"}, status=400,
                                 headers=_vp_no_store())
    ok, message = _aip.delete_user(data.get("name"))
    return web.json_response({"ok": bool(ok), "message": message},
                             headers=_vp_no_store())


# ---------------------------------------------------------------------------
# Save Text Pixaroma - write the node's collected text to a .txt file.
#
# ONE route, and it always writes the WHOLE buffer, never an append. That is the
# node's design: what you see on the node IS what is in the file, so there is no
# second copy to drift out of step. A full write of a text file is cheap, and it
# means the run path and the manual Save button take the identical code path, so
# the class of bug where "it saves after a run but not after an edit" cannot
# exist.
#
# Browse reuses /pixaroma/api/load_images_folder/pick_native and Open folder
# reuses /pixaroma/api/save_image/open_folder; the live counter preview reuses
# /pixaroma/api/save_image/next_counter (its `name` is a free-form template, so
# it scans .txt files just as happily as .png).
# ---------------------------------------------------------------------------

# A prompt is a few hundred bytes and a big collection a few hundred KB. The cap
# is here because this route is unauthenticated and writes caller-supplied bytes
# to disk (path-containment #0) - without it one request could fill a drive.
_SAVE_TEXT_MAX_BYTES = 5 * 1024 * 1024


@PromptServer.instance.routes.post("/pixaroma/api/save_text/write")
async def api_save_text_write(request):
    """Write Save Text Pixaroma's collected buffer to a .txt file.

    Body:
      folder   raw folder field, empty = ComfyUI's output dir. Resolved exactly
               the way Save Image resolves it, so the two agree about where a
               typed path lands.
      name     file name. With claim=true it may still contain %counter% and
               '/' folder segments; with claim=false it is the already-resolved
               name we handed back earlier.
      content  the whole buffer.
      claim    true starts a NEW file (resolve %counter%, create with O_EXCL so
               two nodes racing cannot land on the same name); false overwrites
               the named file.

    The extension is forced to .txt and is NOT the caller's choice - see
    _save_text_helpers.normalize_txt_name for why.
    """
    try:
        data = await request.json()
    except Exception:
        data = None
    # REFUSE a body that is not a JSON object, rather than defaulting to {}.
    # Defaulting meant `[1,2,3]`, `"str"`, `null`, `7`, an empty body and a
    # form-encoded body all fell through to folder:"" + name:"" and wrote a
    # 0-byte prompts_00N.txt into the user's output ROOT. The route is
    # unauthenticated, so that was a litter primitive for anything that can
    # reach the port. MEASURED: six junk bodies, six stray files.
    if not isinstance(data, dict):
        return web.json_response(
            {"ok": False, "message": "Expected a JSON object body."}, status=400
        )

    folder_raw = str(data.get("folder", "") or "")
    name_raw = str(data.get("name", "") or "")
    content = data.get("content", "")
    if not isinstance(content, str):
        content = "" if content is None else str(content)
    claim = bool(data.get("claim"))
    try:
        digits = max(1, min(8, int(data.get("digits", 3))))
    except Exception:
        digits = 3

    payload_len = len(content.encode("utf-8"))
    if payload_len > _SAVE_TEXT_MAX_BYTES:
        return web.json_response({
            "ok": False,
            "message": "That is more text than this node will write (limit 5 MB).",
        })

    # ORDER IS THE INVARIANT (path-containment #5): prescreen the RAW field
    # first, because _resolve_save_folder expands %VARS% and ~ and then
    # realpaths, and on Windows a realpath of a UNC path is itself the attack -
    # it hands over an NTLM hash before any check has run. The _field variant is
    # the expansion-aware one, and this route expands downstream, so it is the
    # one required here (path-containment #11b).
    if not _pix_prescreen_field(folder_raw):
        return web.json_response(
            {"ok": False, "message": _pix_denied_message(folder_raw), "denied": True}
        )

    def _write():
        base, _inside = _resolve_save_folder(folder_raw)
        if not _pix_folder_allowed(base):
            # Echo the RAW field, never the resolved one. _resolve_save_folder
            # has already run expandvars/expanduser/realpath, so `base` can
            # contain values the caller never supplied - a folder of
            # "%USERNAME%/%COMPUTERNAME%" came back as the real Windows user and
            # machine name, turning a refusal into an environment oracle. The
            # sibling next_counter route echoes the raw string for this reason.
            return {"ok": False, "message": _pix_denied_message(folder_raw), "denied": True}

        # _safe_prefix handles the folder segments, rejects '..' and a leading
        # '/', and neutralises the characters Windows forbids. It returns None
        # for anything unrecoverable, so we supply our own fallback rather than
        # letting a blank name write a file called ".txt".
        rel = _safe_prefix(name_raw) or "prompts_%counter%"
        parts = [p for p in rel.replace("\\", "/").split("/") if p]
        leaf = _st_normalize_txt_name(parts[-1]) or "prompts_%counter%.txt"
        # Resolve %counter% in FOLDER segments too, against existing sibling
        # dirs, mirroring what the save_image/next_counter route does - it
        # resolves them "so the preview shows the exact path a Run would
        # create", and without this the two disagreed: the preview promised
        # take_001/notes_001.txt while the write created a directory literally
        # named "take_%counter%".
        # The literal, NOT _save_helpers._COUNTER_TOKEN - that name is not
        # imported here, and the NameError was swallowed by the outer handler,
        # so every save with a subfolder in its name failed with
        # "name '_COUNTER_TOKEN' is not defined" instead of writing. The rest of
        # this function already compares against the literal.
        dirs = []
        parent = base
        for seg in parts[:-1]:
            if "%counter%" in seg:
                seg = seg.replace("%counter%", f"{_next_counter(parent, seg):0{digits}}")
            dirs.append(seg)
            parent = os.path.join(parent, seg)

        if "%counter%" not in leaf:
            # A fixed name: nothing to resolve, and nothing the claim loop could
            # usefully bump to. Leaving n as an int here made the loop retry the
            # identical path 200 times and then report "Could not find a free
            # file name" when the truth is simply that the file already exists.
            n = None
        else:
            n = _next_counter(parent, leaf)

        def _contained(rel):
            """_safe_join, retried through a transient Windows file lock.

            _safe_join realpaths the candidate, and on Windows realpath OPENS
            the file to resolve it - so while another request is renaming onto
            that same name, this can fail for a reason that has nothing to do
            with containment. MEASURED: 1 in 36 concurrent claims came back as
            "That file name is not allowed" when the name was perfectly fine.

            ⚠️ Containment is NOT weakened. A non-None result is still required,
            so a path that genuinely escapes returns None on every attempt and
            is still refused - retrying only costs it ~150ms (the loop sleeps on
            its last pass too). We never accept anything _safe_join rejected.
            """
            for i in range(4):
                p = _safe_join(base, rel)
                if p:
                    return p
                time.sleep(0.015 * (i + 1))
            return None

        final_leaf = leaf if n is None else leaf.replace("%counter%", f"{n:0{digits}}")
        # Second, independent containment check on the FULL joined path. The
        # first one approved the FOLDER; this one proves the file we are about
        # to open is really inside it (path-containment #1 - a join is not a
        # guard, the realpath test after it is).
        rel_final = "/".join(dirs + [final_leaf])
        path = _contained(rel_final)
        if not path:
            return {"ok": False, "message": "That file name is not allowed."}

        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
        except OSError as e:
            return {"ok": False, "message": f"Could not create the folder: {e}"}

        if claim:
            # Claim the name before writing, bumping on collision, so two nodes
            # (or two Clears in quick succession) cannot silently share a file.
            claimed = False
            for _ in range(200):
                try:
                    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                    os.close(fd)
                    claimed = True
                    break
                except FileExistsError:
                    if n is None:
                        return {"ok": False, "message": "That file already exists."}
                    n += 1
                    final_leaf = leaf.replace("%counter%", f"{n:0{digits}}")
                    rel_final = "/".join(dirs + [final_leaf])
                    path = _contained(rel_final)
                    if not path:
                        return {"ok": False, "message": "That file name is not allowed."}
                except OSError as e:
                    return {"ok": False, "message": f"Could not create the file: {e}"}
            if not claimed:
                return {"ok": False, "message": "Could not find a free file name."}

        # Write to a temp file and rename over the target, so a crash or a full
        # disk part way through cannot leave a truncated collection behind. Not
        # losing prompts is the entire point of this node.
        # pid AND thread id in the temp name: pid alone collides when two
        # requests are in flight in the same process.
        tmp = "%s.%d.%d.tmp" % (path, os.getpid(), threading.get_ident())
        try:
            # encoding="utf-8" writes NO byte-order mark (that would be
            # "utf-8-sig"), and newline="\n" keeps the file byte-identical on
            # every platform instead of letting Windows expand each \n to \r\n.
            with open(tmp, "w", encoding="utf-8", newline="\n") as f:
                f.write(content)
            # RETRY the rename. On Windows os.replace can lose a race that has
            # nothing to do with this request: _safe_join calls realpath(),
            # which opens the candidate file to resolve it, so another request
            # resolving the SAME name holds a momentary handle and MoveFileEx
            # returns ERROR_ACCESS_DENIED. MEASURED 3 lost writes out of 36 with
            # 12 simultaneous claims, and that is reachable for real - several
            # fresh Save Text nodes in one workflow all claim the same default
            # pattern the moment a run finishes.
            #
            # Retrying is the right lever: dropping the realpath is not an
            # option (it IS the containment test), and the collision is
            # transient - an immediate retry of the identical request succeeded
            # every time. Backs off up to ~0.42s in total, then gives up and
            # reports honestly rather than pretending the text was saved.
            last_err = None
            for attempt in range(6):
                try:
                    os.replace(tmp, path)
                    last_err = None
                    break
                except OSError as e2:
                    last_err = e2
                    time.sleep(0.02 * (attempt + 1))
            if last_err is not None:
                raise last_err
        except OSError as e:
            try:
                if os.path.exists(tmp):
                    os.remove(tmp)
            except OSError:
                pass
            # Also drop the EMPTY file the claim loop created a moment ago.
            # Without this a failed write leaves a 0-byte .txt behind AND burns
            # that counter value, so repeated failures walk a trail of empty
            # files up the sequence (the same orphan shape Save Mp4 hit).
            #
            # The size check is what makes this safe: only remove it if it is
            # still empty, so a concurrent writer that got there first keeps its
            # data. Guarded by `claim` so we never delete a file we did not
            # create in this request.
            if claim:
                try:
                    if os.path.exists(path) and os.path.getsize(path) == 0:
                        os.remove(path)
                except OSError:
                    pass
            return {"ok": False, "message": f"Could not write the file: {e}"}

        return {
            "ok": True,
            "file": rel_final,
            "path": path,
            "folder": base,
            "bytes": payload_len,
            "entries": _st_count_entries(content, str(data.get("separator") or "blank")),
        }

    try:
        loop = asyncio.get_running_loop()
        out = await loop.run_in_executor(None, _write)
        return web.json_response(out)
    except Exception as e:
        return web.json_response({"ok": False, "message": str(e)})


# ---------------------------------------------------------------------------
# Music Prompt Pixaroma - named formula sets
# ---------------------------------------------------------------------------
# A SET is the two instructions plus the sampling that makes them work, under a
# name saying what it is for. The node ships one measured set and a second model
# becomes another entry rather than a rewrite.
#
# The shipped set is GENERATED from the formulas module at request time, so
# there is no second copy of the wording anywhere to drift.
@PromptServer.instance.routes.get("/pixaroma/api/music_prompt/presets")
async def api_music_prompt_presets(request):
    try:
        from .nodes import _music_prompt_presets as mps
        return web.json_response(
            {
                "shipped": mps.shipped(),
                "user": mps.load_user(),
                # The file exists and could not be understood. An empty library
                # and an unreadable one must NEVER look the same: in the second
                # case the user still HAS sets, and saving would destroy them.
                "userError": not mps.user_readable(),
            },
            headers=_vp_no_store(),
        )
    except Exception as e:
        return web.json_response(
            {"shipped": [], "user": [], "userError": False, "error": str(e)},
            headers=_vp_no_store(),
        )


@PromptServer.instance.routes.post("/pixaroma/api/music_prompt/presets/save")
async def api_music_prompt_presets_save(request):
    try:
        data = await request.json()
        if not isinstance(data, dict):
            return web.json_response({"ok": False, "message": "Expected an object."})
        from .nodes import _music_prompt_presets as mps
        ok, message = mps.save_user(data)
        return web.json_response({"ok": bool(ok), "message": message})
    except Exception as e:
        return web.json_response({"ok": False, "message": str(e)})


@PromptServer.instance.routes.post("/pixaroma/api/music_prompt/presets/delete")
async def api_music_prompt_presets_delete(request):
    try:
        data = await request.json()
        name = data.get("name") if isinstance(data, dict) else None
        from .nodes import _music_prompt_presets as mps
        ok, message = mps.delete_user(name)
        return web.json_response({"ok": bool(ok), "message": message})
    except Exception as e:
        return web.json_response({"ok": False, "message": str(e)})


# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  Monitor Pixaroma - live system stats                                    ║
# ╚══════════════════════════════════════════════════════════════════════════╝
#
# ONE route, polled about once a second by every Monitor node on the canvas.
# Everything it reads is cheap and in-process EXCEPT the GPU extras (load,
# temperature, power), which only nvidia-smi can tell us:
#
#   • psutil ships with ComfyUI, so CPU and system RAM are free.
#   • comfy.model_management already knows the VRAM figures (it is what
#     /system_stats reports), so we reuse it rather than talking to torch.
#   • pynvml is NOT a ComfyUI dependency, so the extras come from the nvidia-smi
#     SUBPROCESS - measured at 85 ms on the dev box. That is far too slow to run
#     inside a request that fires every second, so it runs on a background
#     thread and the route always answers from the CACHE. The first poll has no
#     extras, the second onwards does.
#
# Everything here degrades rather than fails: an AMD card, a Mac, a machine with
# no nvidia-smi on PATH, or a psutil that has been removed all produce a payload
# with those keys missing, and the node simply hides those readouts.

_PIX_MON_GPU_LOCK = threading.Lock()
_PIX_MON_GPU = {
    "at": 0.0,      # monotonic time of the last successful read
    "rows": [],     # parsed nvidia-smi rows
    "busy": False,  # a refresh thread is already running
    "fails": 0,     # consecutive failures
    "off": False,   # give up permanently for this session
}
_PIX_MON_GPU_MIN_AGE = 0.75   # never spawn a refresh more often than this
_PIX_MON_GPU_MAX_FAILS = 3    # then stop spawning processes for good


def _pix_mon_smi_path():
    """nvidia-smi's path, or None. Cached in the same dict as the readings.

    Read/written WITHOUT the lock, which is safe only because this function's
    single caller is _pix_mon_gpu_refresh, and refresh threads are serialized by
    the lock-protected `busy` check-and-set. If a second caller is ever added,
    move this under _PIX_MON_GPU_LOCK first (review note, 2026-08-24).
    """
    p = _PIX_MON_GPU.get("path")
    if p is None:
        p = shutil.which("nvidia-smi") or ""
        _PIX_MON_GPU["path"] = p
    return p or None


def _pix_mon_gpu_refresh():
    """Run nvidia-smi once and store the parsed rows. Background thread only.

    EVERYTHING that can raise must sit inside the try: if this function ever
    escaped without reaching the lock block below, `busy` would stay True and
    GPU extras would be silently dead until a ComfyUI restart (review finding,
    2026-08-24). That is why the imports are inside it too.
    """
    rows = None
    try:
        from .nodes._monitor_helpers import NVIDIA_SMI_ARGS, parse_nvidia_smi
        import subprocess

        exe = _pix_mon_smi_path()
        if exe:
            kwargs = {}
            # Windows would flash a console window once a second otherwise.
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            if flags:
                kwargs["creationflags"] = flags
            out = subprocess.run(
                [exe, *NVIDIA_SMI_ARGS],
                capture_output=True,
                text=True,
                timeout=4.0,
                **kwargs,
            )
            if out.returncode == 0:
                rows = parse_nvidia_smi(out.stdout)
    except Exception:
        rows = None

    with _PIX_MON_GPU_LOCK:
        _PIX_MON_GPU["busy"] = False
        if rows:
            _PIX_MON_GPU["rows"] = rows
            _PIX_MON_GPU["at"] = time.monotonic()
            _PIX_MON_GPU["fails"] = 0
        else:
            _PIX_MON_GPU["fails"] += 1
            if _PIX_MON_GPU["fails"] >= _PIX_MON_GPU_MAX_FAILS:
                # No nvidia-smi, an AMD card, or a driver that keeps erroring:
                # stop spawning a process every second for the rest of the
                # session. A ComfyUI restart is the retry.
                _PIX_MON_GPU["off"] = True
                _PIX_MON_GPU["rows"] = []


def _pix_mon_gpu_rows():
    """The cached nvidia-smi rows, kicking a background refresh if stale.

    NEVER waits on the subprocess: the request would then be as slow as the
    slowest nvidia-smi call, once per second, forever.
    """
    with _PIX_MON_GPU_LOCK:
        if _PIX_MON_GPU["off"]:
            return []
        stale = (time.monotonic() - _PIX_MON_GPU["at"]) >= _PIX_MON_GPU_MIN_AGE
        if stale and not _PIX_MON_GPU["busy"]:
            _PIX_MON_GPU["busy"] = True
            start = True
        else:
            start = False
        rows = list(_PIX_MON_GPU["rows"])
    if start:
        # If .start() itself raises (OS thread exhaustion), `busy` must not stay
        # latched True - that would silently end GPU extras for the whole
        # session, and the 500 would also discard the CPU/RAM half of the
        # response (review finding, 2026-08-24).
        try:
            threading.Thread(
                target=_pix_mon_gpu_refresh, name="pixaroma-monitor-gpu", daemon=True
            ).start()
        except Exception:
            with _PIX_MON_GPU_LOCK:
                _PIX_MON_GPU["busy"] = False
    return rows


def _pix_mon_torch_devices():
    """Every torch device, primary first - the same list /system_stats reports.

    `get_all_torch_devices` is what core's own system_stats calls (it is what
    makes a multi-GPU box report every card). It is guarded because it is newer
    than the pack's minimum ComfyUI: an older build falls back to the one primary
    device, which is all it ever had.
    """
    import comfy.model_management as mm

    primary = mm.get_torch_device()
    try:
        devices = list(mm.get_all_torch_devices())
    except Exception:
        devices = []
    if not devices:
        return [primary]
    # primary first, so a face that only draws devices[0] draws the card the
    # workflow is actually running on
    return [primary] + [d for d in devices if d != primary]


def _pix_mon_devices():
    """VRAM per torch device, in the same shape /system_stats uses."""
    out = []
    try:
        import comfy.model_management as mm

        for dev in _pix_mon_torch_devices():
            try:
                total, torch_total = mm.get_total_memory(dev, torch_total_too=True)
                free, torch_free = mm.get_free_memory(dev, torch_free_too=True)
                out.append(
                    {
                        "name": mm.get_torch_device_name(dev),
                        "type": getattr(dev, "type", "cuda"),
                        "index": getattr(dev, "index", None),
                        "total": int(total),
                        "used": int(total) - int(free),
                        # what TORCH itself is holding, i.e. ComfyUI's own share
                        "torchTotal": int(torch_total),
                        "torchUsed": int(torch_total) - int(torch_free),
                    }
                )
            except Exception:
                continue
    except Exception:
        pass
    return out


@PromptServer.instance.routes.get("/pixaroma/api/monitor/stats")
async def api_monitor_stats(request):
    from .nodes._monitor_helpers import gpu_extras_for, parse_visible_devices, pct

    payload = {"ok": True}

    # ── CPU + system RAM (psutil ships with ComfyUI) ──
    try:
        import psutil

        vm = psutil.virtual_memory()
        payload["ram"] = {
            "total": int(vm.total),
            "used": int(vm.total - vm.available),
            "pct": pct(vm.total - vm.available, vm.total),
        }
        # interval=None is non-blocking: it reports the load since the PREVIOUS
        # call, which is exactly the poll interval. The very first answer after a
        # restart is the average since boot; every one after that is live.
        payload["cpu"] = {"pct": float(psutil.cpu_percent(interval=None))}
        try:
            rss = psutil.Process().memory_info().rss
            payload["proc"] = {"used": int(rss), "pct": pct(rss, vm.total)}
        except Exception:
            pass
    except Exception:
        pass

    # ── VRAM, plus the driver's own view of the card ──
    # CUDA_VISIBLE_DEVICES makes torch renumber the visible cards from 0 while
    # nvidia-smi keeps physical indices, so the mask must be translated or a
    # pinned box shows the OTHER card's temperature (review finding, 2026-08-24).
    devices = _pix_mon_devices()
    if devices:
        visible = parse_visible_devices(os.environ.get("CUDA_VISIBLE_DEVICES"))
        payload["devices"] = gpu_extras_for(devices, _pix_mon_gpu_rows(), visible)
    else:
        rows = _pix_mon_gpu_rows()
        if rows:
            payload["devices"] = [
                {
                    "name": r.get("name") or "GPU",
                    "type": "cuda",
                    "index": r.get("index"),
                    "total": r.get("memTotal") or 0,
                    "used": r.get("memUsed") or 0,
                    "util": r.get("util"),
                    "temp": r.get("temp"),
                    "power": r.get("power"),
                }
                for r in rows
            ]

    return web.json_response(payload, headers={"Cache-Control": "no-store"})
