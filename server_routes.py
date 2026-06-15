import os
import io
import re
import json
import base64
import uuid
from server import PromptServer
from aiohttp import web
from PIL import Image
from PIL.PngImagePlugin import PngInfo
import folder_paths

from .nodes._save_helpers import _build_pnginfo, _safe_prefix
from .nodes._prompt_reader_helpers import read_prompt_from_image
from .nodes._bg_removal_helpers import (
    get_birefnet_inventory,
    is_birefnet_model_id,
    run_birefnet_on_pil,
)
from .nodes._font_catalog import full_catalog as _font_full_catalog
from .nodes._font_catalog import (
    get_custom_fonts_dir as _font_custom_dir,
    resolve_custom_file as _font_resolve_custom,
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


_PIXAROMA_VERSION_CACHE = None


def _read_pixaroma_version():
    """Read the plugin version from pyproject.toml (cached). Mirrors the
    startup banner's logic in __init__.py. Returns a string or 'unknown'."""
    global _PIXAROMA_VERSION_CACHE
    if _PIXAROMA_VERSION_CACHE is not None:
        return _PIXAROMA_VERSION_CACHE
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
    _PIXAROMA_VERSION_CACHE = version
    return version


@PromptServer.instance.routes.get("/pixaroma/api/version")
async def pixaroma_version(request):
    """Return the Pixaroma plugin version for the Version Check node."""
    return web.json_response({"version": _read_pixaroma_version()})


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
                "url": f"/pixaroma/assets/icons/note/{name}",
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
        return Image.open(io.BytesIO(image_data))
    except Exception:
        return None


def _embed_workflow_metadata(workflow, prompt) -> PngInfo:
    """Return a PngInfo with `prompt` and `workflow` tEXt chunks,
    matching the byte format ComfyUI's built-in SaveImage writes.
    Either argument may be None (chunk is then skipped).
    Thin compatibility wrapper around nodes._save_helpers._build_pnginfo."""
    return _build_pnginfo(prompt=prompt, workflow=workflow)


@PromptServer.instance.routes.post("/pixaroma/api/layer/upload")
async def upload_raw_layer(request):
    data = await request.json()
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


@PromptServer.instance.routes.post("/pixaroma/api/crop/save")
async def save_crop_composite(request):
    data = await request.json()
    merged_b64 = data.get("image_merged", "")
    raw_id = data.get("project_id", "")
    project_id = _sanitize_id(raw_id, str(uuid.uuid4()).replace("-", ""))

    img = _decode_image(merged_b64)
    if img is None:
        return web.json_response({"error": "Invalid image data"}, status=400)

    filename = f"crop_composite_{project_id}.png"
    file_path = _safe_path(filename)
    if file_path is None:
        return web.json_response({"error": "Invalid project id"}, status=400)

    img.save(file_path, "PNG")
    relative_path = os.path.join("pixaroma", filename).replace("\\", "/")
    return web.json_response({"status": "success", "composite_path": relative_path})


@PromptServer.instance.routes.post("/pixaroma/api/crop/upload_src")
async def upload_crop_source(request):
    data = await request.json()
    b64_data = data.get("image", "")
    raw_id = data.get("project_id", "")
    project_id = _sanitize_id(raw_id, str(uuid.uuid4()).replace("-", ""))

    img = _decode_image(b64_data)
    if img is None:
        return web.json_response({"error": "Invalid image data"}, status=400)

    filename = f"crop_src_{project_id}.png"
    file_path = _safe_path(filename)
    if file_path is None:
        return web.json_response({"error": "Invalid project id"}, status=400)

    img.save(file_path, "PNG")
    relative_path = os.path.join("pixaroma", filename).replace("\\", "/")
    return web.json_response({"status": "success", "path": relative_path})


# ────────────────────────────────────────────────────────────
# Inpaint Crop Pixaroma — source + painted-mask upload
# ────────────────────────────────────────────────────────────

@PromptServer.instance.routes.post("/pixaroma/api/inpaint/upload_src")
async def upload_inpaint_source(request):
    data = await request.json()
    raw_id = data.get("project_id", "")
    project_id = _sanitize_id(raw_id, str(uuid.uuid4()).replace("-", ""))

    img = _decode_image(data.get("image", ""))
    if img is None:
        return web.json_response({"error": "Invalid image data"}, status=400)

    filename = f"inpaint_src_{project_id}.png"
    file_path = _safe_path(filename)
    if file_path is None:
        return web.json_response({"error": "Invalid project id"}, status=400)

    img.convert("RGB").save(file_path, "PNG")
    relative_path = os.path.join("pixaroma", filename).replace("\\", "/")
    return web.json_response({"status": "success", "path": relative_path})


@PromptServer.instance.routes.post("/pixaroma/api/inpaint/save_mask")
async def save_inpaint_mask(request):
    data = await request.json()
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
    img.convert("L").save(file_path, "PNG")
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
            input_data = base64.b64decode(b64_data)
            input_image = Image.open(io.BytesIO(input_data))
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

        input_data = base64.b64decode(b64_data)
        input_image = Image.open(io.BytesIO(input_data))
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
        pnginfo = _embed_workflow_metadata(workflow, prompt)
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
        pnginfo = _build_pnginfo(prompt=prompt, workflow=workflow)
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

    grid_filename = data.get("grid_filename")
    if not isinstance(grid_filename, str) or not grid_filename:
        return web.json_response({"error": "missing grid_filename"}, status=400)
    session_id = data.get("session_id")
    save_cells = data.get("save_cells") is True
    workflow = data.get("workflow")
    prompt = data.get("prompt")
    prefix = _safe_prefix(data.get("filename_prefix", "xy_plot")) or "xy_plot"

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
    # bounded token (it keys an in-memory dict; reject oversized/odd input).
    valid_sid = isinstance(session_id, str) and bool(_SAFE_ID_RE.match(session_id)) and len(session_id) <= _MAX_ID_LEN
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
    })


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


def _is_path_under(child: str, *parents: str) -> bool:
    """Return True iff `child` is inside ANY of the given parent directories.

    Uses os.path.commonpath so symlink games and ../../ tricks can't escape.
    Both sides are realpath-ed so case / separator differences on Windows
    don't slip through.
    """
    if not child:
        return False
    try:
        child_real = os.path.realpath(child)
    except OSError:
        return False
    for p in parents:
        try:
            parent_real = os.path.realpath(p)
            if os.path.commonpath([child_real, parent_real]) == parent_real:
                return True
        except (OSError, ValueError):
            continue
    return False


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
        return web.json_response({
            "found": False,
            "message": "Image file not found in the input folder.",
        })
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
    folder = request.query.get("path", "")
    recursive = request.query.get("recursive", "0") == "1"
    if not folder or not os.path.isdir(folder):
        return web.json_response({"ok": False, "message": "Folder not found.", "files": []})
    real = os.path.realpath(folder)
    try:
        import asyncio
        loop = asyncio.get_running_loop()
        files = await loop.run_in_executor(None, _lif_list_files, real, recursive)
    except Exception as e:
        return web.json_response({"ok": False, "message": f"Could not read folder: {e}", "files": []})
    return web.json_response({"ok": True, "folder": real, "files": files})


def _lif_make_thumb(full):
    """Decode + downscale one image to a small JPEG. Blocking - run off the loop."""
    from PIL import ImageOps
    im = Image.open(full)
    im = ImageOps.exif_transpose(im).convert("RGB")
    im.thumbnail((192, 192))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


@PromptServer.instance.routes.get("/pixaroma/api/load_images_folder/thumb")
async def api_lif_thumb(request):
    """Serve a small JPEG thumbnail for one image. ?path=<folder>&file=<rel>"""
    folder = request.query.get("path", "")
    rel = request.query.get("file", "")
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
    """Navigate the server filesystem for the in-app folder picker.
    ?path=<dir>  (empty = list drives on Windows / '/' on POSIX).
    Returns {ok, path, parent, dirs:[{name, path, images}]}; images = -1 means
    'not counted' (skipped for folders with many sub-folders, to stay fast)."""
    path = request.query.get("path", "")
    try:
        if not path:
            dirs = []
            if os.name == "nt":
                import string
                for letter in string.ascii_uppercase:
                    d = f"{letter}:\\"
                    if os.path.isdir(d):
                        dirs.append({"name": d, "path": d, "images": -1})
            else:
                dirs.append({"name": "/", "path": "/", "images": -1})
            return web.json_response({"ok": True, "path": "", "parent": None, "dirs": dirs})

        if not os.path.isdir(path):
            return web.json_response({"ok": False, "message": "Folder not found.", "dirs": []})
        real = os.path.realpath(path)
        parent = os.path.dirname(real)
        if parent == real:  # already at a drive / filesystem root
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
    try:
        import asyncio
        loop = asyncio.get_running_loop()
        path = await loop.run_in_executor(None, _lif_native_folder_dialog, start)
        if path is None:
            return web.json_response({"ok": False, "busy": True})
        if path and os.path.isdir(path):
            return web.json_response({"ok": True, "path": path})
        return web.json_response({"ok": False, "cancelled": True})
    except Exception as e:
        return web.json_response({"ok": False, "message": str(e)})
