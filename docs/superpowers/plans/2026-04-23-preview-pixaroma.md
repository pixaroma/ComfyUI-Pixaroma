# Preview Pixaroma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a ComfyUI node "Preview Pixaroma" that displays the input image inside the node body, exposes two orange canvas-drawn buttons ("Save to Disk" opens a native OS save dialog; "Save to Output" writes to ComfyUI's `output/` folder with workflow metadata), and passes the image through to an optional downstream edge.

**Architecture:** One Python node class emitting `{"ui":{"images":[…]}, "result":(image,)}` (standard ComfyUI preview pattern), plus two new aiohttp POST routes in `server_routes.py` that share a single PNG-metadata helper. Frontend is a single `js/preview/index.js` that paints buttons via `onDrawForeground` and hit-tests them in `onMouseDown`, mirroring the existing Compare node's approach.

**Tech Stack:** Python (PIL, PyTorch, aiohttp via `PromptServer`), ComfyUI `folder_paths`, vanilla JS (ES modules, `app.registerExtension`), File System Access API with `<a download>` fallback.

**Source spec:** [2026-04-23-preview-pixaroma-design.md](../specs/2026-04-23-preview-pixaroma-design.md) (commit `111f4ec`)

**Testing philosophy:** This repo has no automated test harness (confirmed in CLAUDE.md). Each task ends with **manual verification in a running ComfyUI instance** plus a **local commit on `Ioan`** — never pushed. The verification steps are concrete and repeatable.

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `nodes/node_preview.py` | **Create** | `PixaromaPreview` class, `NODE_CLASS_MAPPINGS`, `NODE_DISPLAY_NAME_MAPPINGS`. One file, ≤80 lines expected. |
| `__init__.py` | **Modify** | Add 2 import lines, 2 mapping-merge entries (alphabetical position next to `_MAPS_PAINT` / `_MAPS_RESOLUTION`). |
| `server_routes.py` | **Modify** | Add `_embed_workflow_metadata` helper + `/pixaroma/api/preview/save` + `/pixaroma/api/preview/prepare` routes. Added below existing routes to minimize diff noise. |
| `js/preview/index.js` | **Create** | Single-file ES module. Button paint, hit-test, toast, Save-to-Output handler, Save-to-Disk handler. ~300 lines expected. |

No new assets, no `package.json`, no build step.

---

## Task 1: Scaffold the Python node

Goal: node is registered and appears in the ComfyUI menu. No preview rendering yet; just the class skeleton passing the image through.

**Files:**
- Create: `nodes/node_preview.py`
- Modify: `__init__.py` (lines 13-14 area for import, lines 35-36 area for merge, lines 54-55 for name merge)

- [ ] **Step 1.1: Create `nodes/node_preview.py`**

```python
class PixaromaPreview:
    """Preview an image inline in the node body, with buttons for Save-to-Disk
    and Save-to-Output. Implementation of the preview tensor-to-temp logic
    is completed in Task 2; save flows live in the JS side (Tasks 7-8) and
    backend routes (Tasks 4-5)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": "Preview"}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "preview"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/Utils"

    def preview(self, image, filename_prefix):
        # Task 2 replaces this stub with temp-save + UI dict.
        return {"ui": {"images": []}, "result": (image,)}


NODE_CLASS_MAPPINGS = {"PixaromaPreview": PixaromaPreview}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPreview": "Preview Pixaroma"}
```

- [ ] **Step 1.2: Register in `__init__.py`**

Insert two import lines immediately AFTER line 14 (after the `_NAMES_PAINT` import, before `_MAPS_RESOLUTION`) so the imports stay alphabetically ordered between `PAINT` and `RESOLUTION`:

```python
from .nodes.node_preview import NODE_CLASS_MAPPINGS as _MAPS_PREVIEW
from .nodes.node_preview import NODE_DISPLAY_NAME_MAPPINGS as _NAMES_PREVIEW
```

In the `NODE_CLASS_MAPPINGS` dict (lines 32-43), insert `**_MAPS_PREVIEW,` immediately after `**_MAPS_PAINT,` and before `**_MAPS_RESOLUTION,`:

```python
NODE_CLASS_MAPPINGS = {
    **_MAPS_3D,
    **_MAPS_COMPOSITION,
    **_MAPS_PAINT,
    **_MAPS_PREVIEW,
    **_MAPS_RESOLUTION,
    **_MAPS_COMPARE,
    **_MAPS_CROP,
    **_MAPS_LABEL,
    **_MAPS_NOTE,
    **_MAPS_UTILS,
    **_MAPS_SHOW_TEXT,
}
```

In the `NODE_DISPLAY_NAME_MAPPINGS` dict (lines 46-57), insert `**_NAMES_PREVIEW,` after `**_NAMES_PAINT,` and before `**_NAMES_RESOLUTION,`:

```python
NODE_DISPLAY_NAME_MAPPINGS = {
    **_NAMES_COMPOSITION,
    **_NAMES_3D,
    **_NAMES_COMPARE,
    **_NAMES_CROP,
    **_NAMES_LABEL,
    **_NAMES_NOTE,
    **_NAMES_UTILS,
    **_NAMES_PAINT,
    **_NAMES_PREVIEW,
    **_NAMES_RESOLUTION,
    **_NAMES_SHOW_TEXT,
}
```

- [ ] **Step 1.3: Restart ComfyUI**

Fully stop and restart the ComfyUI server (not just refresh the browser) — custom-node Python files are loaded once at startup.

Expected startup banner: `{N+1} nodes Loaded` where `N+1` includes the new node.

- [ ] **Step 1.4: Manually verify the node appears**

1. Open ComfyUI in browser (hard refresh with Ctrl+F5).
2. Right-click canvas → `Add Node` → `👑 Pixaroma` → `Utils` → confirm **"Preview Pixaroma"** is listed.
3. Click it to add to the canvas. The node appears with:
   - Title: "Preview Pixaroma"
   - One IMAGE input socket (left)
   - One IMAGE output socket (right, labeled `image`)
   - One text widget labeled `filename_prefix` pre-filled with `Preview`

If the node does not appear, check the ComfyUI console for import errors.

- [ ] **Step 1.5: Commit**

```bash
git add nodes/node_preview.py __init__.py
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(preview): scaffold PixaromaPreview node"
```

---

## Task 2: Render preview image in the node body

Goal: When the workflow runs, the image appears inside the node body (same UX as ComfyUI's built-in `PreviewImage`). The image is also passed through to the output edge.

**Files:**
- Modify: `nodes/node_preview.py` (replace the `preview` method body from Task 1)

- [ ] **Step 2.1: Replace the `preview` method**

Open `nodes/node_preview.py`. Replace the module contents with:

```python
import os
import uuid
import numpy as np
from PIL import Image
import folder_paths


class PixaromaPreview:
    """Preview an image inline in the node body, with buttons for Save-to-Disk
    and Save-to-Output. The image is also exposed on the output edge."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": "Preview"}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "preview"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/Utils"

    def preview(self, image, filename_prefix):
        # Only the first frame of the batch is previewed (matches Image Compare).
        # The full batch is still passed through via `result`.
        tensor = image[0]
        arr = (tensor.cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
        pil = Image.fromarray(arr)

        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)
        fname = f"pixaroma_preview_{uuid.uuid4().hex}.png"
        pil.save(os.path.join(temp_dir, fname), "PNG")

        return {
            "ui": {
                "images": [{"filename": fname, "subfolder": "", "type": "temp"}]
            },
            "result": (image,),
        }


NODE_CLASS_MAPPINGS = {"PixaromaPreview": PixaromaPreview}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPreview": "Preview Pixaroma"}
```

- [ ] **Step 2.2: Restart ComfyUI**

Full restart (Python file changed).

- [ ] **Step 2.3: Manually verify preview rendering**

1. Hard-refresh the browser.
2. Build a minimal test workflow: `Load Image` → `Preview Pixaroma` (drag an edge from Load Image's IMAGE output to Preview Pixaroma's `image` input). Use any sample image.
3. Click `Queue Prompt`.
4. Verify:
   - The image appears rendered inside the Preview Pixaroma node body.
   - The node shows no error flag in the UI.
   - The ComfyUI console shows no exceptions.

- [ ] **Step 2.4: Verify the passthrough output**

1. Add a second node: `Save Image` (ComfyUI's built-in).
2. Connect Preview Pixaroma's `image` output → Save Image's `images` input.
3. Queue Prompt again.
4. Verify `ComfyUI/output/ComfyUI_*.png` now contains the image — this proves the tensor passes through correctly.
5. Delete the Save Image node and confirm Preview Pixaroma **still runs without error** (this exercises the "output unconnected" case).

- [ ] **Step 2.5: Commit**

```bash
git add nodes/node_preview.py
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(preview): render image in node body and pass through"
```

---

## Task 3: Add PNG metadata embedding helper

Goal: Add a shared helper in `server_routes.py` that builds a `PngInfo` object with `prompt` and `workflow` tEXt chunks — the exact format ComfyUI's built-in `SaveImage` writes. Used by both routes in Tasks 4 and 5.

**Files:**
- Modify: `server_routes.py` (add helper near the other helpers around line 199-210)

- [ ] **Step 3.1: Add the helper function**

Open `server_routes.py`. Locate the `_decode_image` function (around line 199). Immediately AFTER that function and before the first `@PromptServer.instance.routes.post(...)` decorator, insert:

```python
import json  # already standard; placed locally if module-level import is missing
from PIL.PngImagePlugin import PngInfo


def _embed_workflow_metadata(workflow, prompt) -> PngInfo:
    """Return a PngInfo with `prompt` and `workflow` tEXt chunks,
    matching the byte format ComfyUI's built-in SaveImage writes.
    Either argument may be None (chunk is then skipped)."""
    pnginfo = PngInfo()
    if prompt is not None:
        pnginfo.add_text("prompt", json.dumps(prompt))
    if workflow is not None:
        pnginfo.add_text("workflow", json.dumps(workflow))
    return pnginfo
```

Check the top of the file — if `import json` is already present at module level, drop the local `import json` inside the helper. Same for `from PIL.PngImagePlugin import PngInfo` — hoist it to the top next to `from PIL import Image` (line 8) if preferred. Either placement works; keep the one that matches the file's existing style.

- [ ] **Step 3.2: Restart ComfyUI**

Full restart (Python file changed). Verify no import errors in the console.

- [ ] **Step 3.3: Commit**

```bash
git add server_routes.py
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(routes): add PNG workflow-metadata helper"
```

---

## Task 4: Backend route `/pixaroma/api/preview/save`

Goal: POST endpoint that decodes a base64 PNG, embeds workflow+prompt metadata, and writes to ComfyUI's `output/` folder with an auto-incremented counter. Test via `curl` before any frontend work.

**Files:**
- Modify: `server_routes.py` (add the new route at the end of the file)

- [ ] **Step 4.1: Add the route**

Append to the end of `server_routes.py`:

```python
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

    if not isinstance(prefix_raw, str) or not prefix_raw:
        return web.json_response({"error": "filename_prefix required"}, status=400)
    if len(prefix_raw) > _MAX_ID_LEN or not _SAFE_ID_RE.match(prefix_raw):
        return web.json_response(
            {"error": "filename_prefix must match [A-Za-z0-9_-]{1,64}"}, status=400
        )

    pil = _decode_image(image_b64)
    if pil is None:
        return web.json_response({"error": "invalid image data"}, status=400)

    try:
        output_dir = folder_paths.get_output_directory()
        full_folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
            prefix_raw, output_dir, pil.width, pil.height
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
```

- [ ] **Step 4.2: Restart ComfyUI**

Full restart. Verify no import/syntax errors.

- [ ] **Step 4.3: Manually verify with `curl`**

Prepare a tiny test PNG as base64 data URI. In a shell:

```bash
# 1x1 red PNG, inline base64 so no file needed
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

curl -s -X POST http://127.0.0.1:8188/pixaroma/api/preview/save \
  -H "Content-Type: application/json" \
  -d "{\"image_b64\":\"$PNG\",\"filename_prefix\":\"PreviewTest\",\"workflow\":{\"test\":1},\"prompt\":{\"hello\":\"world\"}}"
```

Expected JSON response:

```json
{"status":"success","filename":"PreviewTest_00001_.png","subfolder":""}
```

Run the same `curl` a second time — expect `filename":"PreviewTest_00002_.png"`.

- [ ] **Step 4.4: Verify the file and its metadata**

1. Open `ComfyUI/output/PreviewTest_00001_.png` in a file browser.
2. Extract metadata with Python (in ComfyUI's venv or any Python with Pillow):

```bash
python -c "from PIL import Image; im=Image.open('ComfyUI/output/PreviewTest_00001_.png'); print(im.info)"
```

Expected output includes `'prompt': '{"hello": "world"}'` and `'workflow': '{"test": 1}'`.

- [ ] **Step 4.5: Negative-path curl checks**

```bash
# Bad prefix (contains slash)
curl -s -X POST http://127.0.0.1:8188/pixaroma/api/preview/save \
  -H "Content-Type: application/json" \
  -d "{\"image_b64\":\"$PNG\",\"filename_prefix\":\"../evil\"}"
```

Expected: HTTP 400, body `{"error":"filename_prefix must match [A-Za-z0-9_-]{1,64}"}`.

```bash
# Bad image data
curl -s -X POST http://127.0.0.1:8188/pixaroma/api/preview/save \
  -H "Content-Type: application/json" \
  -d "{\"image_b64\":\"not-a-data-uri\",\"filename_prefix\":\"ok\"}"
```

Expected: HTTP 400, body `{"error":"invalid image data"}`.

- [ ] **Step 4.6: Clean up test files & commit**

```bash
rm ComfyUI/output/PreviewTest_*.png
git add server_routes.py
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(routes): add /pixaroma/api/preview/save"
```

---

## Task 5: Backend route `/pixaroma/api/preview/prepare`

Goal: POST endpoint that returns a metadata-embedded PNG blob without writing it to disk. Used by Save-to-Disk so the frontend can embed metadata without pulling in a PNG-chunks JS library.

**Files:**
- Modify: `server_routes.py` (add below the `/save` route from Task 4)

- [ ] **Step 5.1: Add the route**

Append to the end of `server_routes.py`:

```python
@PromptServer.instance.routes.post("/pixaroma/api/preview/prepare")
async def api_preview_prepare(request):
    """Return an in-memory PNG with workflow metadata embedded.
    Used by the Save-to-Disk flow to keep metadata-embedding logic in Python.

    Request JSON: {
        image_b64: data-URI PNG string (required),
        workflow:  JSON object (optional),
        prompt:    JSON object (optional),
    }
    Response: image/png bytes on 200, JSON error on 400.
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)

    image_b64 = data.get("image_b64", "")
    workflow = data.get("workflow")
    prompt = data.get("prompt")

    pil = _decode_image(image_b64)
    if pil is None:
        return web.json_response({"error": "invalid image data"}, status=400)

    try:
        pnginfo = _embed_workflow_metadata(workflow, prompt)
        buf = io.BytesIO()
        pil.save(buf, "PNG", pnginfo=pnginfo)
        body = buf.getvalue()
    except Exception as e:
        return web.json_response({"error": f"prepare failed: {e}"}, status=500)

    return web.Response(body=body, content_type="image/png")
```

- [ ] **Step 5.2: Restart ComfyUI**

Full restart.

- [ ] **Step 5.3: Manually verify with `curl`**

```bash
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

curl -s -X POST http://127.0.0.1:8188/pixaroma/api/preview/prepare \
  -H "Content-Type: application/json" \
  -d "{\"image_b64\":\"$PNG\",\"workflow\":{\"test\":42},\"prompt\":{}}" \
  --output /tmp/prepared.png

python -c "from PIL import Image; im=Image.open('/tmp/prepared.png'); print(im.info); print(im.size)"
```

Expected: `(1, 1)` size, `info` dict containing `'workflow': '{"test": 42}'`.

- [ ] **Step 5.4: Commit**

```bash
rm /tmp/prepared.png
git add server_routes.py
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(routes): add /pixaroma/api/preview/prepare"
```

---

## Task 6: Frontend scaffold — buttons rendered in disabled state

Goal: Create `js/preview/index.js`. Extension registers, two orange buttons paint below the preview area in their DISABLED state (grey fill, grey text). No click handling yet; no save logic yet.

**Files:**
- Create: `js/preview/index.js`

- [ ] **Step 6.1: Create `js/preview/index.js`**

```javascript
import { app } from "/scripts/app.js";
import { BRAND } from "../shared/utils.mjs";

// ---- button geometry ----
const BTN_W = 120;
const BTN_H = 24;
const BTN_GAP = 8;
const BTN_MARGIN_BOTTOM = 6;

// ---- colors (mirror Compare's paintBtn) ----
const COLOR_ACTIVE_FILL = BRAND;
const COLOR_ACTIVE_FILL_HOVER = "#ff8a5e";
const COLOR_ACTIVE_STROKE = BRAND;
const COLOR_ACTIVE_TEXT = "#fff";
const COLOR_DISABLED_FILL = "#2a2c2e";
const COLOR_DISABLED_STROKE = "#444";
const COLOR_DISABLED_TEXT = "#999";

// ---- button model ----
function getButtonRects(node) {
  const nodeW = node.size[0];
  const nodeH = node.size[1];
  const totalW = BTN_W * 2 + BTN_GAP;
  const x0 = Math.max(6, (nodeW - totalW) / 2);
  const y = nodeH - BTN_H - BTN_MARGIN_BOTTOM;
  return [
    { id: "disk",   x: x0,                     y, w: BTN_W, h: BTN_H, label: "Save to Disk" },
    { id: "output", x: x0 + BTN_W + BTN_GAP,   y, w: BTN_W, h: BTN_H, label: "Save to Output" },
  ];
}

function paintBtn(ctx, rect, active, hovered) {
  const { x, y, w, h, label } = rect;
  ctx.save();
  ctx.fillStyle = active
    ? (hovered ? COLOR_ACTIVE_FILL_HOVER : COLOR_ACTIVE_FILL)
    : COLOR_DISABLED_FILL;
  ctx.strokeStyle = active ? COLOR_ACTIVE_STROKE : COLOR_DISABLED_STROKE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = active ? COLOR_ACTIVE_TEXT : COLOR_DISABLED_TEXT;
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.restore();
}

// ---- extension ----
app.registerExtension({
  name: "Pixaroma.Preview",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPreview") return;

    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.apply(this, arguments);
      if (this.flags?.collapsed) return;

      const active = !!(this.imgs && this.imgs.length > 0);
      const rects = getButtonRects(this);
      const hoverId = this._pixaromaHoverId || null;
      for (const r of rects) {
        paintBtn(ctx, r, active, hoverId === r.id);
      }
    };
  },
});
```

- [ ] **Step 6.2: Hard-refresh the browser**

ComfyUI auto-loads JS from `WEB_DIRECTORY`. Ctrl+Shift+R to bypass the cache.

- [ ] **Step 6.3: Manually verify the buttons render**

1. Add a Preview Pixaroma node to the canvas (do NOT connect it yet, do NOT run).
2. Confirm two buttons appear at the bottom of the node:
   - Both gray fill (`#2a2c2e`), gray text (`#999`).
   - Left label: "Save to Disk". Right label: "Save to Output".
   - Buttons roughly centered, 8 px gap between them.
3. Resize the node wider — buttons re-center on the next draw (may require a mouse move to trigger a redraw; that's fine, Task 10 adds explicit `onResize` hook).
4. Open the browser DevTools console — no errors from `Pixaroma.Preview`.

- [ ] **Step 6.4: Commit**

```bash
git add js/preview/index.js
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(preview-ui): scaffold frontend with disabled orange buttons"
```

---

## Task 7: Wire up Save-to-Output button

Goal: Clicking "Save to Output" on a populated node fetches the preview blob, POSTs to `/pixaroma/api/preview/save`, and a canvas toast confirms the saved filename. This task also adds the hit-test, toast helper, and the `node.imgs` guard.

**Files:**
- Modify: `js/preview/index.js`

- [ ] **Step 7.1: Add helper functions and mouse handling**

Replace the **contents** of `js/preview/index.js` with:

```javascript
import { app } from "/scripts/app.js";
import { BRAND } from "../shared/utils.mjs";

const BTN_W = 120;
const BTN_H = 24;
const BTN_GAP = 8;
const BTN_MARGIN_BOTTOM = 6;

const COLOR_ACTIVE_FILL = BRAND;
const COLOR_ACTIVE_FILL_HOVER = "#ff8a5e";
const COLOR_ACTIVE_STROKE = BRAND;
const COLOR_ACTIVE_TEXT = "#fff";
const COLOR_DISABLED_FILL = "#2a2c2e";
const COLOR_DISABLED_STROKE = "#444";
const COLOR_DISABLED_TEXT = "#999";

const TOAST_MS = 2000;

// ---- geometry ----
function getButtonRects(node) {
  const nodeW = node.size[0];
  const nodeH = node.size[1];
  const totalW = BTN_W * 2 + BTN_GAP;
  const x0 = Math.max(6, (nodeW - totalW) / 2);
  const y = nodeH - BTN_H - BTN_MARGIN_BOTTOM;
  return [
    { id: "disk",   x: x0,                     y, w: BTN_W, h: BTN_H, label: "Save to Disk" },
    { id: "output", x: x0 + BTN_W + BTN_GAP,   y, w: BTN_W, h: BTN_H, label: "Save to Output" },
  ];
}

function hitTest(rect, lx, ly) {
  return lx >= rect.x && lx <= rect.x + rect.w && ly >= rect.y && ly <= rect.y + rect.h;
}

// ---- paint ----
function paintBtn(ctx, rect, active, hovered) {
  const { x, y, w, h, label } = rect;
  ctx.save();
  ctx.fillStyle = active
    ? (hovered ? COLOR_ACTIVE_FILL_HOVER : COLOR_ACTIVE_FILL)
    : COLOR_DISABLED_FILL;
  ctx.strokeStyle = active ? COLOR_ACTIVE_STROKE : COLOR_DISABLED_STROKE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = active ? COLOR_ACTIVE_TEXT : COLOR_DISABLED_TEXT;
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.restore();
}

function paintToast(ctx, node, text) {
  const rects = getButtonRects(node);
  const y = rects[0].y;
  const x = rects[0].x;
  const w = rects[1].x + rects[1].w - x;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.82)";
  ctx.strokeStyle = BRAND;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, BTN_H, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + BTN_H / 2 + 1);
  ctx.restore();
}

function showToast(node, text) {
  node._pixaromaToast = { text, until: Date.now() + TOAST_MS };
  node.setDirtyCanvas(true, true);
  setTimeout(() => {
    const t = node._pixaromaToast;
    if (t && t.until <= Date.now()) {
      node._pixaromaToast = null;
      node.setDirtyCanvas(true, true);
    }
  }, TOAST_MS + 100);
}

// ---- blob / data URI helpers ----
async function getPreviewBlob(node) {
  const img = node.imgs?.[0];
  if (!img || !img.src) return null;
  const resp = await fetch(img.src);
  if (!resp.ok) throw new Error(`preview fetch failed: ${resp.status}`);
  return await resp.blob();
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("FileReader failed"));
    r.readAsDataURL(blob);
  });
}

async function getWorkflowAndPrompt() {
  // app.graphToPrompt() returns { workflow, output }; "output" is the prompt.
  const { workflow, output } = await app.graphToPrompt();
  return { workflow, prompt: output };
}

function readFilenamePrefix(node) {
  const w = node.widgets?.find((x) => x.name === "filename_prefix");
  const v = (w?.value ?? "Preview").toString().trim();
  return v || "Preview";
}

// ---- save handlers ----
async function saveToOutput(node) {
  if (!node.imgs?.length) {
    showToast(node, "Run the workflow first");
    return;
  }
  try {
    const blob = await getPreviewBlob(node);
    if (!blob) throw new Error("no preview blob");
    const dataURL = await blobToDataURL(blob);
    const { workflow, prompt } = await getWorkflowAndPrompt();
    const resp = await fetch("/pixaroma/api/preview/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_b64: dataURL,
        filename_prefix: readFilenamePrefix(node),
        workflow,
        prompt,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      showToast(node, `Save failed: ${data.error || resp.status}`);
      return;
    }
    showToast(node, `Saved: ${data.filename}`);
  } catch (err) {
    showToast(node, `Save failed: ${err.message || err}`);
  }
}

// ---- extension ----
app.registerExtension({
  name: "Pixaroma.Preview",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPreview") return;

    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.apply(this, arguments);
      if (this.flags?.collapsed) return;

      const rects = getButtonRects(this);
      const active = !!(this.imgs && this.imgs.length > 0);
      const hoverId = this._pixaromaHoverId || null;
      for (const r of rects) paintBtn(ctx, r, active, hoverId === r.id);

      const toast = this._pixaromaToast;
      if (toast && toast.until > Date.now()) {
        paintToast(ctx, this, toast.text);
      }
    };

    const origMouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (e, localPos) {
      if (this.flags?.collapsed) {
        return origMouseDown ? origMouseDown.apply(this, arguments) : false;
      }
      const rects = getButtonRects(this);
      for (const r of rects) {
        if (hitTest(r, localPos[0], localPos[1])) {
          if (r.id === "output") saveToOutput(this);
          // disk handler wired in Task 8
          return true;
        }
      }
      return origMouseDown ? origMouseDown.apply(this, arguments) : false;
    };
  },
});
```

- [ ] **Step 7.2: Hard-refresh the browser**

Ctrl+Shift+R.

- [ ] **Step 7.3: Manually verify Save-to-Output golden path**

1. Add Preview Pixaroma to the canvas, connect a `Load Image`, queue the workflow.
2. After the preview renders, the buttons should now paint in **orange** (active state).
3. Click "Save to Output".
4. Verify:
   - A toast "Saved: Preview_00001_.png" appears at the bottom of the node for ~2 s.
   - The file `ComfyUI/output/Preview_00001_.png` exists.
5. Click "Save to Output" again → toast shows `Preview_00002_.png`, file exists.
6. Change the `filename_prefix` widget to `MyRun` → click save → `ComfyUI/output/MyRun_00001_.png` exists.

- [ ] **Step 7.4: Manually verify workflow metadata round-trip**

1. Drag the saved `output/Preview_00001_.png` onto the ComfyUI canvas (drop anywhere on the workflow area).
2. Verify the workflow restores — all nodes from the test workflow reappear and are properly wired.

- [ ] **Step 7.5: Manually verify the "no preview yet" guard**

1. Add a new Preview Pixaroma node. Do **not** connect anything. Do **not** queue.
2. Click either button. Confirm:
   - Toast "Run the workflow first" appears.
   - No network request in the Network tab (verify with DevTools).
3. Buttons still render in the disabled gray state.

- [ ] **Step 7.6: Clean up test files & commit**

```bash
rm ComfyUI/output/Preview_00001_.png ComfyUI/output/Preview_00002_.png ComfyUI/output/MyRun_00001_.png 2>/dev/null || true
git add js/preview/index.js
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(preview-ui): wire up Save-to-Output, hit-test, and toasts"
```

---

## Task 8: Wire up Save-to-Disk button

Goal: Clicking "Save to Disk" on a populated node fetches the preview blob, POSTs to `/pixaroma/api/preview/prepare` to get a metadata-embedded PNG, then invokes `window.showSaveFilePicker` (Chrome/Edge/Opera) or falls back to an `<a download>` trigger (Firefox, Safari <15.1).

**Files:**
- Modify: `js/preview/index.js`

- [ ] **Step 8.1: Add `saveToDisk` and wire the click handler**

In `js/preview/index.js`, add the `saveToDisk` function immediately after `saveToOutput`:

```javascript
async function saveToDisk(node) {
  if (!node.imgs?.length) {
    showToast(node, "Run the workflow first");
    return;
  }
  let preparedBlob;
  try {
    const blob = await getPreviewBlob(node);
    if (!blob) throw new Error("no preview blob");
    const dataURL = await blobToDataURL(blob);
    const { workflow, prompt } = await getWorkflowAndPrompt();
    const resp = await fetch("/pixaroma/api/preview/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_b64: dataURL, workflow, prompt }),
    });
    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}));
      showToast(node, `Prepare failed: ${errJson.error || resp.status}`);
      return;
    }
    preparedBlob = await resp.blob();
  } catch (err) {
    showToast(node, `Prepare failed: ${err.message || err}`);
    return;
  }

  const suggestedName = `${readFilenamePrefix(node)}.png`;

  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(preparedBlob);
      await writable.close();
      showToast(node, `Saved: ${handle.name}`);
    } catch (err) {
      if (err?.name === "AbortError") return; // user cancelled, silent
      showToast(node, `Save failed: ${err.message || err}`);
    }
    return;
  }

  // Fallback: <a download> → Downloads folder
  const url = URL.createObjectURL(preparedBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast(node, "Saved to Downloads (browser has no folder picker)");
}
```

Then update the `onMouseDown` override inside `beforeRegisterNodeDef` so clicking the disk button dispatches to `saveToDisk`. Find the existing block:

```javascript
          if (r.id === "output") saveToOutput(this);
          // disk handler wired in Task 8
          return true;
```

Replace with:

```javascript
          if (r.id === "output") saveToOutput(this);
          else if (r.id === "disk") saveToDisk(this);
          return true;
```

- [ ] **Step 8.2: Hard-refresh the browser (Chrome or Edge)**

- [ ] **Step 8.3: Manually verify Save-to-Disk golden path (Chrome/Edge)**

1. Run a workflow through Preview Pixaroma so the preview populates.
2. Click "Save to Disk".
3. Native OS save dialog opens with suggested filename `Preview.png` (or whatever the prefix is) and `.png` filter active.
4. Choose any folder outside `ComfyUI/output/` (e.g. Desktop). Confirm.
5. Verify the file lands at the chosen path.
6. Inspect its metadata:

```bash
python -c "from PIL import Image; im=Image.open('C:/path/to/chosen.png'); print(sorted(im.info.keys()))"
```

Expected keys include `prompt` and `workflow`.
7. Drag the saved file onto ComfyUI canvas — workflow restores.

- [ ] **Step 8.4: Verify user-cancel path**

1. Click "Save to Disk" → in the OS dialog click Cancel.
2. Verify: no toast, no error, no file written, buttons still work on subsequent clicks.

- [ ] **Step 8.5: Verify the Firefox fallback**

**If Firefox is available:** repeat Task 8.3 in Firefox. Expect:
- No native save dialog.
- A download bar appears; file lands in the Downloads folder with name `Preview.png`.
- Toast: "Saved to Downloads (browser has no folder picker)".

**If Firefox is not available:** skip this step and note it in the manual QA log for later (Task 12). The fallback code path is simple and the verification can be deferred.

- [ ] **Step 8.6: Commit**

```bash
git add js/preview/index.js
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(preview-ui): wire up Save-to-Disk with File System Access API + fallback"
```

---

## Task 9: Hover state + cursor feedback

Goal: Orange buttons brighten on hover and the node's canvas cursor changes to a pointer. Polish step — no new save logic.

**Files:**
- Modify: `js/preview/index.js`

- [ ] **Step 9.1: Add `onMouseMove` override**

In `js/preview/index.js`, inside `beforeRegisterNodeDef`, after the `onMouseDown` override, add:

```javascript
    const origMouseMove = nodeType.prototype.onMouseMove;
    nodeType.prototype.onMouseMove = function (e, localPos) {
      if (!this.flags?.collapsed) {
        const rects = getButtonRects(this);
        let newHover = null;
        for (const r of rects) {
          if (hitTest(r, localPos[0], localPos[1])) { newHover = r.id; break; }
        }
        if (newHover !== this._pixaromaHoverId) {
          this._pixaromaHoverId = newHover;
          this.setDirtyCanvas(true, true);
        }
      }
      return origMouseMove ? origMouseMove.apply(this, arguments) : false;
    };

    const origMouseLeave = nodeType.prototype.onMouseLeave;
    nodeType.prototype.onMouseLeave = function () {
      if (this._pixaromaHoverId) {
        this._pixaromaHoverId = null;
        this.setDirtyCanvas(true, true);
      }
      return origMouseLeave ? origMouseLeave.apply(this, arguments) : false;
    };
```

- [ ] **Step 9.2: Hard-refresh and verify**

1. Move the cursor over each orange button (node must be populated).
2. Verify the button fill brightens from `#f66744` to `#ff8a5e` while hovered, reverts when the cursor leaves.
3. Move the cursor out of the node entirely — no stuck hover state.
4. When the buttons are in the disabled state, hover has no visual effect (this is intentional; active-only hover feedback mirrors Compare).

- [ ] **Step 9.3: Commit**

```bash
git add js/preview/index.js
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(preview-ui): hover feedback on orange buttons"
```

---

## Task 10: Resize handling

Goal: When the user drags the node's resize handle, the buttons reposition to stay centered below the preview on the next redraw.

**Files:**
- Modify: `js/preview/index.js`

- [ ] **Step 10.1: Add `onResize` override**

In `js/preview/index.js`, inside `beforeRegisterNodeDef`, add below the `onMouseLeave` override:

```javascript
    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (origResize) origResize.apply(this, arguments);
      this.setDirtyCanvas(true, true);
    };
```

- [ ] **Step 10.2: Hard-refresh and verify**

1. Add Preview Pixaroma with a populated preview.
2. Drag the bottom-right resize handle in multiple directions.
3. Verify the buttons stay horizontally centered under the preview and stay 6 px above the bottom edge at every size.
4. Shrink the node narrower than `2*120 + 8 = 248` px. Verify the buttons don't go negative — `x0 = Math.max(6, …)` clamps them; they may overlap with each other at very small widths, which is acceptable for v1.

- [ ] **Step 10.3: Commit**

```bash
git add js/preview/index.js
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(preview-ui): redraw buttons on resize"
```

---

## Task 11: Vue-frontend compatibility check

Goal: Confirm `onDrawForeground` / `onMouseDown` / `onMouseMove` actually fire on the Vue 3 frontend. If they don't, fall back to a minimal polling redraw (CLAUDE.md Vue Compat #1). Compare's existing use of `onDrawForeground` suggests they work, but this must be verified, not assumed.

**Files:**
- Modify (only if broken): `js/preview/index.js`

- [ ] **Step 11.1: Verify on the current (latest) ComfyUI frontend**

1. Confirm which frontend is running: Settings → About → ComfyUI frontend version. (Vue 3 is the current default in 2026-era builds.)
2. Add a Preview Pixaroma, connect a `Load Image`, run the workflow.
3. Verify:
   - Buttons appear at startup (disabled state) without needing a mouse move to trigger the first draw.
   - After queue, buttons transition to orange.
   - Clicking "Save to Output" triggers a save and toast.
   - Hovering a button brightens it.
   - Resizing repositions the buttons.

- [ ] **Step 11.2: If buttons don't appear or don't update**

Only if Task 11.1 reveals a Vue-suppressed hook, add this fallback inside `beforeRegisterNodeDef` AFTER the other overrides:

```javascript
    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      // Vue-frontend safety net: force a periodic redraw while the node
      // is selected or hovered, so canvas-drawn buttons stay up-to-date.
      // Matches the polling pattern documented in CLAUDE.md Vue Compat #1.
      this._pixaromaRedrawTimer = setInterval(() => {
        if (!this.graph) return;
        this.setDirtyCanvas(true, true);
      }, 250);
    };
    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this._pixaromaRedrawTimer) {
        clearInterval(this._pixaromaRedrawTimer);
        this._pixaromaRedrawTimer = null;
      }
      if (origRemoved) origRemoved.apply(this, arguments);
    };
```

If Task 11.1 passed without issues, **skip Step 11.2** — YAGNI.

- [ ] **Step 11.3: Commit (only if Step 11.2 was needed)**

```bash
git add js/preview/index.js
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "fix(preview-ui): add Vue-frontend redraw polling"
```

---

## Task 12: Full manual QA pass

Goal: Work through every test case from the spec's Testing section (cases 1–14). No code changes expected; if any case fails, open a mini-task to fix it, commit separately.

**Files:** none expected. If a bug surfaces, fix it in the relevant file, commit with a `fix(preview): …` message.

- [ ] **Step 12.1: Fresh environment**

1. Stop ComfyUI, delete `ComfyUI/temp/pixaroma_preview_*.png` (clean slate).
2. Delete any remaining test files in `ComfyUI/output/` from earlier tasks.
3. Start ComfyUI, hard-refresh the browser.

- [ ] **Step 12.2: Run through all 14 test cases**

Check each off and record observations. Mark `✅ pass` or `❌ fail <reason>`.

1. Node appears under **👑 Pixaroma → Utils** as "Preview Pixaroma". — ☐
2. Load Image → Preview Pixaroma → queue → preview thumbnail renders, buttons turn orange. — ☐
3. Click Save to Output → `output/Preview_00001_.png` exists. Second click → `Preview_00002_.png`. — ☐
4. Edit prefix to `Test` → save → `Test_00001_.png` exists. — ☐
5. Click Save to Disk (Chrome/Edge) → native save dialog → file written with metadata. — ☐
6. Drag a saved PNG onto ComfyUI canvas → workflow restores. — ☐
7. Disconnect output socket → workflow still runs without error. — ☐
8. Connect output socket to another Preview Pixaroma → chained previews both render. — ☐
9. Click save buttons before running workflow → "Run the workflow first" toast, no network call. — ☐
10. Cancel the save picker mid-flow → silent no-op, subsequent clicks still work. — ☐
11. Firefox (if available): Save-to-Disk triggers Downloads-folder fallback with toast. — ☐
12. Resize the node → buttons reposition cleanly, preview scales. — ☐
13. Set prefix to `../evil` → click Save to Output → backend 400, toast shows validation error, no file written. — ☐
14. Confirm `onDrawForeground` fires on the Vue frontend (already verified in Task 11). — ☐

- [ ] **Step 12.3: If any case failed, fix + re-commit**

For each failure, edit the relevant file, verify the fix resolves the case, and commit:

```bash
git add <changed-files>
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "fix(preview): <what was wrong>"
```

Re-run the affected test case to confirm the fix.

- [ ] **Step 12.4: Final clean-up**

```bash
rm ComfyUI/output/Preview_*.png ComfyUI/output/Test_*.png 2>/dev/null || true
```

- [ ] **Step 12.5: Log the completion**

No commit at this step — the log is just for the implementer to confirm everything lands. When done, inform the user the implementation is complete and all 14 cases pass (or list specific ones that were deferred, e.g. the Firefox path if Firefox wasn't available).

---

## Self-review

**1. Spec coverage check**

| Spec requirement | Task |
|---|---|
| Python class `PixaromaPreview` + `INPUT_TYPES` / `RETURN_TYPES` / `OUTPUT_NODE=True` / category `👑 Pixaroma/Utils` | Task 1, Task 2 |
| `filename_prefix` STRING widget default `"Preview"` | Task 1 |
| Preview renders inside node body using `{"ui":{"images":[…]}, "result":(image,)}` | Task 2 |
| Passthrough output, no error if unconnected | Task 2 (verified Step 2.4) |
| `/pixaroma/api/preview/save` route with validation + metadata + counter | Task 4 |
| `/pixaroma/api/preview/prepare` route returning PNG bytes with metadata | Task 5 |
| Shared `_embed_workflow_metadata` helper | Task 3 |
| Canvas-drawn orange buttons via `onDrawForeground` | Task 6, Task 7 |
| Hit-test in `onMouseDown` | Task 7 |
| Save-to-Output flow with toast | Task 7 |
| Save-to-Disk with `showSaveFilePicker` + `<a download>` fallback + AbortError catch | Task 8 |
| Hover state | Task 9 |
| Resize handling | Task 10 |
| Disabled-state guard "Run the workflow first" | Task 7 (Step 7.5) |
| Workflow metadata embedded — drag saved PNG back into ComfyUI to restore | Task 7 (Step 7.4), Task 8 (Step 8.3) |
| All 14 test cases | Task 12 |
| Local commits on `Ioan`, never pushed | Every task |

**2. Placeholder scan**

No `TBD`, no `TODO`, no "similar to", no "add appropriate error handling". Every code step has complete code. Every verification step has a concrete command and expected outcome.

**3. Type / name consistency**

- JS function names: `getButtonRects`, `paintBtn`, `hitTest`, `paintToast`, `showToast`, `getPreviewBlob`, `blobToDataURL`, `getWorkflowAndPrompt`, `readFilenamePrefix`, `saveToOutput`, `saveToDisk` — referenced consistently across Tasks 6, 7, 8, 9, 10.
- Python helper: `_embed_workflow_metadata(workflow, prompt)` defined in Task 3, called in Tasks 4 and 5 with the same argument order.
- Route paths: `/pixaroma/api/preview/save`, `/pixaroma/api/preview/prepare` — identical between backend task (4/5) and frontend task (7/8).
- Node state keys: `node._pixaromaHoverId`, `node._pixaromaToast`, `node._pixaromaRedrawTimer` — prefixed consistently.
- Widget name: `filename_prefix` — Python INPUT_TYPES (Task 1/2), JS lookup (Task 7, `readFilenamePrefix`).

No inconsistencies.

---

## Plan complete

Spec → plan mapping is tight. Ready for execution — implementer should work task-by-task, verify each manually, and commit on `Ioan` after every green task.
