import os
import io
import re
import base64
import uuid
from server import PromptServer
from aiohttp import web
from PIL import Image
import folder_paths

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


@PromptServer.instance.routes.get("/pixaroma/assets/{filename}")
async def serve_pixaroma_asset(request):
    filename = request.match_info["filename"]
    if not _SAFE_ID_RE.match(
        filename.replace(".", "").replace("-", "").replace("_", "")
    ):
        return web.Response(status=400)
    file_path = os.path.realpath(os.path.join(PIXAROMA_ASSETS_DIR, filename))
    if not file_path.startswith(PIXAROMA_ASSETS_DIR):
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
    if not file_path.startswith(PIXAROMA_ASSETS_DIR):
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
    if not file_path.startswith(PIXAROMA_ASSETS_DIR):
        return web.Response(status=403)
    if not os.path.isfile(file_path):
        return web.Response(status=404)
    return web.FileResponse(file_path)


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
    """
    full = os.path.realpath(os.path.join(PIXAROMA_INPUT_ROOT, filename))
    if (
        not full.startswith(PIXAROMA_INPUT_ROOT + os.sep)
        and full != PIXAROMA_INPUT_ROOT
    ):
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
    return web.json_response(info)


@PromptServer.instance.routes.post("/pixaroma/remove_bg")
async def remove_bg(request):
    try:
        from rembg import remove, new_session
    except ImportError:
        return web.json_response(
            {"error": "rembg is not installed.", "code": "REMBG_MISSING"},
            status=500,
        )

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
