# Preview Image Pixaroma — Batch + Subfolder + Auto-Index + Save-Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [docs/superpowers/specs/2026-05-04-preview-pixaroma-improvements-design.md](../specs/2026-05-04-preview-pixaroma-improvements-design.md)

**Goal:** Bring Preview Image Pixaroma to feature parity with native PreviewImage (batch strip + selection) and SaveImage (subfolder syntax, auto-counter, optional auto-save mode), without breaking existing workflows.

**Architecture:** Backend writes all batch frames (temp/ in preview mode, output/ in save mode), returns URLs under custom UI key `pixaroma_preview_frames`. Frontend listens for ComfyUI's `executed` event, renders frames in a custom strip widget with click-to-select, "i / N" badge, and orange selection border. Save buttons act on the selected frame.

**Tech Stack:** Python (PIL, ComfyUI's `folder_paths`), aiohttp routes (existing), vanilla JS (LiteGraph custom widgets, no build step).

**Codebase note:** This project has NO automated test suite (per CLAUDE.md). Verification is manual: edit → restart ComfyUI → run a workflow in the browser → confirm behavior → commit. Each task ends with explicit user-facing verification steps.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `nodes/_save_helpers.py` | NEW | Shared `_safe_prefix` validator + `_build_pnginfo` metadata helper |
| `nodes/node_preview.py` | REWRITTEN | Node class: `save_mode` widget, batch loop, hidden inputs, custom UI key |
| `server_routes.py` | MODIFIED | Use shared helpers; relax save route prefix; rewrite prepare route response shape |
| `js/preview/index.js` | MODIFIED | New strip widget, `executed` listener, selected-frame save handlers |
| `CLAUDE.md` | MODIFIED | Update Preview Image Pixaroma rows in token-saving table |

---

## Task 1: Create shared helpers module (`_save_helpers.py`)

**Files:**
- Create: `nodes/_save_helpers.py`

- [ ] **Step 1: Create the file with both helpers**

Create `nodes/_save_helpers.py`:

```python
"""Shared helpers for Pixaroma nodes that save images:
  - _safe_prefix:    validate filename_prefix supporting subfolder/file syntax
  - _build_pnginfo:  build a PngInfo embedding workflow + prompt for re-import
Used by node_preview.py (Python entry) and server_routes.py (HTTP routes).
"""

import json
import re

from PIL.PngImagePlugin import PngInfo


# ---- prefix validation ----

_SAFE_SEG_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")
_PREFIX_MAX_LEN = 256


def _safe_prefix(s):
    """Return cleaned prefix string, or None if invalid.

    Allows path segments separated by '/', each matching [A-Za-z0-9_-].
    Rejects '..', leading '/', empty segments, total length > 256.
    Backslashes are normalized to forward slashes (Windows convenience).

    Caller decides what to do with None:
      - Backend node:  `_safe_prefix(s) or "Preview"` (don't crash workflow)
      - Server routes: `if not prefix: return 400` (surface error to JS)
    """
    if not isinstance(s, str):
        return None
    s = s.strip().replace("\\", "/")
    if not s or len(s) > _PREFIX_MAX_LEN:
        return None
    if s.startswith("/"):
        return None
    parts = s.split("/")
    if any(not p or p == ".." or not _SAFE_SEG_RE.match(p) for p in parts):
        return None
    return s


# ---- workflow metadata embedding ----

def _build_pnginfo(prompt=None, workflow=None, extra_pnginfo=None):
    """Return a PngInfo object embedding workflow + prompt as tEXt chunks,
    matching the byte format ComfyUI's built-in SaveImage writes.

    Two calling conventions, supported simultaneously:
      Route side (called from JS): pass `prompt=` and `workflow=` (both
        JSON-serialisable dicts from app.graphToPrompt()).
      Node side (called by ComfyUI): pass `prompt=` (PROMPT hidden input)
        and `extra_pnginfo=` (EXTRA_PNGINFO hidden input — a dict whose
        "workflow" key holds the workflow). Each key in extra_pnginfo
        becomes its own tEXt chunk.

    Any argument may be None / missing — its chunk is then skipped.
    Unserialisable extras are silently dropped (best-effort).
    """
    pnginfo = PngInfo()
    if prompt is not None:
        try:
            pnginfo.add_text("prompt", json.dumps(prompt))
        except Exception:
            pass
    if workflow is not None:
        try:
            pnginfo.add_text("workflow", json.dumps(workflow))
        except Exception:
            pass
    if isinstance(extra_pnginfo, dict):
        for k, v in extra_pnginfo.items():
            try:
                pnginfo.add_text(k, json.dumps(v))
            except Exception:
                pass
    return pnginfo
```

- [ ] **Step 2: Verify the module imports and the helpers behave correctly**

Run from the repo root (uses Python's built-in unittest-style assertions, no extra deps):

```bash
python -c "
import sys; sys.path.insert(0, '.')
from nodes._save_helpers import _safe_prefix, _build_pnginfo

# valid prefixes
assert _safe_prefix('Preview') == 'Preview'
assert _safe_prefix('SDXL/image') == 'SDXL/image'
assert _safe_prefix('a/b/c') == 'a/b/c'
assert _safe_prefix(' Preview ') == 'Preview'         # strips whitespace
assert _safe_prefix('SDXL\\\\image') == 'SDXL/image'  # Windows-style separator

# invalid prefixes
for bad in [None, '', '   ', '..', 'a/..', 'a/../b', '/abs', 'a/', '/a', 'a//b', 'a/b!', 'a' * 300, 123]:
    assert _safe_prefix(bad) is None, f'expected None for {bad!r}'

# build_pnginfo behavior — checking returned object type only
pi = _build_pnginfo(prompt={'a': 1}, workflow={'b': 2})
assert pi.__class__.__name__ == 'PngInfo'

pi = _build_pnginfo(prompt={'a': 1}, extra_pnginfo={'workflow': {'b': 2}, 'misc': [1, 2]})
assert pi.__class__.__name__ == 'PngInfo'

pi = _build_pnginfo()  # all None — should not raise
assert pi.__class__.__name__ == 'PngInfo'

print('OK')
"
```

Expected output: `OK`. If anything fails, the assertion shows which case broke.

- [ ] **Step 3: Commit**

```bash
git add nodes/_save_helpers.py
git commit -m "preview: add shared _save_helpers module (_safe_prefix + _build_pnginfo)"
```

---

## Task 2: Migrate `server_routes.py` to use the shared metadata helper

**Files:**
- Modify: `server_routes.py:215-224` (replace `_embed_workflow_metadata` body)

This task de-duplicates code with no behavior change — both routes still produce identical PNG metadata. We need this before later tasks add the node-side caller.

- [ ] **Step 1: Replace the helper body**

In `server_routes.py`, find the `_embed_workflow_metadata` function around line 215 and replace its body with a call to the shared helper.

Find:
```python
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

Replace with:
```python
def _embed_workflow_metadata(workflow, prompt) -> PngInfo:
    """Return a PngInfo with `prompt` and `workflow` tEXt chunks,
    matching the byte format ComfyUI's built-in SaveImage writes.
    Either argument may be None (chunk is then skipped).
    Thin compatibility wrapper around nodes._save_helpers._build_pnginfo."""
    return _build_pnginfo(prompt=prompt, workflow=workflow)
```

- [ ] **Step 2: Add the import at the top of `server_routes.py`**

Find the existing `from nodes.` imports (or just below the stdlib imports) and add:

```python
from nodes._save_helpers import _build_pnginfo, _safe_prefix
```

If there's no existing `from nodes.` import, place this after the `from PIL.PngImagePlugin import PngInfo` line.

- [ ] **Step 3: Verify ComfyUI starts cleanly**

Restart ComfyUI. The console must show no `ImportError` or other exceptions related to `_save_helpers`. The plugin's normal startup banner appears.

If ComfyUI logs an `ImportError`, it's almost always (a) the file isn't actually copied to the live install — see CLAUDE.md "Worktree files not served"; or (b) a circular import. Resolve before continuing.

- [ ] **Step 4: Smoke-test the existing save flow still works**

In the browser:
1. Drop a Preview Image Pixaroma node, wire any image source.
2. Run the workflow.
3. Click **Save to Output**.
4. Confirm: a file appears in `output/` matching `Preview_NNNNN_.png`. Drag the file into ComfyUI — it loads with workflow metadata (i.e. metadata embedding still works).

- [ ] **Step 5: Commit**

```bash
git add server_routes.py
git commit -m "preview: route _embed_workflow_metadata through shared _build_pnginfo"
```

---

## Task 3: Relax filename_prefix validation in `/pixaroma/api/preview/save` (subfolders work)

**Files:**
- Modify: `server_routes.py` (around line 712-717, the prefix validation block in `api_preview_save`)

This is the smallest user-visible win in the plan and doesn't depend on any other task — landing it early gets the user unstuck on subfolders.

- [ ] **Step 1: Replace the strict regex with `_safe_prefix`**

Find the validation block in `api_preview_save`:

```python
    if not isinstance(prefix_raw, str) or not prefix_raw:
        return web.json_response({"error": "filename_prefix required"}, status=400)
    if len(prefix_raw) > _MAX_ID_LEN or not _SAFE_ID_RE.match(prefix_raw):
        return web.json_response(
            {"error": "filename_prefix must match [A-Za-z0-9_-]{1,64}"}, status=400
        )
```

Replace with:

```python
    prefix = _safe_prefix(prefix_raw)
    if not prefix:
        return web.json_response(
            {"error": "invalid filename_prefix: use [A-Za-z0-9_-] segments separated by '/', no '..'"},
            status=400,
        )
```

- [ ] **Step 2: Update the downstream `prefix_raw` reference to use the cleaned `prefix`**

In the same function, find:

```python
        full_folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
            prefix_raw, output_dir, pil.width, pil.height
        )
```

Replace `prefix_raw` with `prefix`:

```python
        full_folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
            prefix, output_dir, pil.width, pil.height
        )
```

- [ ] **Step 3: Verify subfolder save works end-to-end**

Restart ComfyUI. In the browser:

1. Drop a Preview Image Pixaroma node, wire any image source.
2. Type `SDXL/myprefix` in `filename_prefix`.
3. Run the workflow.
4. Click **Save to Output**.
5. Confirm: file appears at `output/SDXL/myprefix_00001_.png`. Drag it into ComfyUI — workflow metadata still embeds.
6. Now type `..` — click Save to Output — confirm an error toast appears (instead of saving).
7. Type `SDXL/` (trailing slash) — error toast.
8. Type a single name like `Preview` — saves normally to `output/Preview_NNNNN_.png` (no subfolder behavior change for the simple case).

- [ ] **Step 4: Commit**

```bash
git add server_routes.py
git commit -m "preview: allow subfolder/prefix syntax in /pixaroma/api/preview/save"
```

---

## Task 4: Update `/pixaroma/api/preview/prepare` (JSON response with auto-counter) AND wire JS Save to Disk to it

**Files:**
- Modify: `server_routes.py` `api_preview_prepare` (around lines 741-774)
- Modify: `js/preview/index.js` `saveToDisk` function

These two changes are coupled (the response shape becomes JSON) — they MUST land in one commit so we never have a state where the JS expects bytes and the route returns JSON or vice versa.

- [ ] **Step 1: Rewrite the prepare route to accept `filename_prefix` and return JSON**

Open `server_routes.py`. Find `api_preview_prepare` around line 741. Replace the entire function with:

```python
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

    prefix = _safe_prefix(prefix_raw)
    if not prefix:
        return web.json_response(
            {"error": "invalid filename_prefix: use [A-Za-z0-9_-] segments separated by '/', no '..'"},
            status=400,
        )

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
```

- [ ] **Step 2: Update `js/preview/index.js` `saveToDisk` to send the prefix and read JSON**

Open `js/preview/index.js`. Find `saveToDisk` (around line 163). Replace its body with:

```js
async function saveToDisk(node) {
  if (!node.imgs?.length) {
    showToast(node, "Run the workflow first");
    return;
  }
  let preparedBlob;
  let suggestedName = `${readFilenamePrefix(node)}.png`;
  try {
    const blob = await getPreviewBlob(node);
    if (!blob) throw new Error("no preview blob");
    const dataURL = await blobToDataURL(blob);
    const { workflow, prompt } = await getWorkflowAndPrompt();
    const resp = await fetch("/pixaroma/api/preview/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_b64: dataURL,
        filename_prefix: readFilenamePrefix(node),
        workflow,
        prompt,
      }),
    });
    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}));
      showToast(node, `Prepare failed: ${errJson.error || resp.status}`);
      return;
    }
    const { image_b64, suggested_filename } = await resp.json();
    if (suggested_filename) suggestedName = suggested_filename;
    preparedBlob = await dataURLToBlob(image_b64);
  } catch (err) {
    showToast(node, `Prepare failed: ${err.message || err}`);
    return;
  }

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

- [ ] **Step 3: Add the `dataURLToBlob` helper**

Open `js/preview/index.js`. Find `blobToDataURL` (around line 110). Add `dataURLToBlob` immediately below it:

```js
async function dataURLToBlob(dataURL) {
  const resp = await fetch(dataURL);
  return await resp.blob();
}
```

This helper uses `fetch` to convert a `data:image/png;base64,...` URL back into a Blob. Native, no dependencies.

- [ ] **Step 4: Verify Save to Disk auto-counter works**

Restart ComfyUI. Hard-refresh the browser (Ctrl+F5) so the JS reload picks up.

1. Drop a Preview Image Pixaroma node, run a workflow with a single image.
2. Click **Save to Output** twice in a row — files `Preview_00001_.png` and `Preview_00002_.png` exist in `output/`.
3. Click **Save to Disk** — file picker opens with suggested name `Preview_00003_.png` (counter advanced past the two existing).
4. Save it (anywhere). Drag back into ComfyUI — workflow metadata still embeds.
5. Type `SDXL/portrait` in filename_prefix, click **Save to Disk** — picker suggests `portrait_NNNNN_.png` (counter for that subfolder).
6. Type `..` and click Save to Disk — error toast (route 400).

- [ ] **Step 5: Commit**

```bash
git add server_routes.py js/preview/index.js
git commit -m "preview: prepare route returns JSON with suggested_filename; Save to Disk auto-indexes"
```

---

## Task 5: Rewrite `node_preview.py` (save_mode + batch + hidden inputs) and wire JS to `executed` event

**Files:**
- Modify: `nodes/node_preview.py` (full rewrite)
- Modify: `js/preview/index.js` (add `executed` listener, switch buttons widget to read frame array)

These changes are coupled because the backend stops returning `ui.images` (which auto-populates `node.imgs`) and starts returning `pixaroma_preview_frames` under the custom UI key. Without the JS update, no preview shows.

After this task: batch frames render side-by-side as a horizontal strip (basic layout, no selection UI yet — that comes in Task 6). Save buttons act on `frames[0]` until Task 6 wires selection.

- [ ] **Step 1: Rewrite `nodes/node_preview.py`**

Replace the entire contents of `nodes/node_preview.py` with:

```python
import os
import uuid

import folder_paths
import numpy as np
from PIL import Image

from ._save_helpers import _build_pnginfo, _safe_prefix


def _tensor_to_pil(tensor):
    """Convert a HxWxC float [0,1] tensor frame to a PIL.Image."""
    arr = (tensor.cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
    return Image.fromarray(arr)


class PixaromaPreview:
    """Preview an image (or batch) inline in the node body, with buttons for
    Save-to-Disk and Save-to-Output. The image is also exposed on the output
    edge.

    Modes:
      preview (default): all batch frames are written to ComfyUI's temp/
        directory and shown in the node strip; nothing is saved permanently.
      save:              all batch frames are saved to output/ with embedded
        workflow metadata, exactly like the native SaveImage node, AND still
        shown in the strip preview.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": "Preview"}),
                "save_mode": (["preview", "save"], {"default": "preview"}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "preview"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma"

    def preview(
        self,
        image,
        filename_prefix,
        save_mode,
        prompt=None,
        extra_pnginfo=None,
    ):
        prefix = _safe_prefix(filename_prefix) or "Preview"

        results = []
        if save_mode == "save":
            output_dir = folder_paths.get_output_directory()
            full_folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
                prefix, output_dir, image.shape[2], image.shape[1]
            )
            os.makedirs(full_folder, exist_ok=True)
            for i, tensor in enumerate(image):
                pil = _tensor_to_pil(tensor)
                pnginfo = _build_pnginfo(prompt=prompt, extra_pnginfo=extra_pnginfo)
                fname = f"{name}_{counter + i:05}_.png"
                pil.save(os.path.join(full_folder, fname), "PNG", pnginfo=pnginfo)
                results.append({
                    "filename": fname,
                    "subfolder": subfolder,
                    "type": "output",
                })
        else:  # preview mode
            temp_dir = folder_paths.get_temp_directory()
            os.makedirs(temp_dir, exist_ok=True)
            for tensor in image:
                pil = _tensor_to_pil(tensor)
                fname = f"pixaroma_preview_{uuid.uuid4().hex}.png"
                pil.save(os.path.join(temp_dir, fname), "PNG")
                results.append({
                    "filename": fname,
                    "subfolder": "",
                    "type": "temp",
                })

        return {
            "ui": {"pixaroma_preview_frames": results},
            "result": (image,),
        }


NODE_CLASS_MAPPINGS = {"PixaromaPreview": PixaromaPreview}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPreview": "Preview Image Pixaroma"}
```

- [ ] **Step 2: Add the `api` import and `executed` listener at the top of `js/preview/index.js`**

Open `js/preview/index.js`. The current first line is `import { app } from "/scripts/app.js";`. Add the api import below it:

```js
import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { BRAND } from "../shared/utils.mjs";
```

- [ ] **Step 3: Add a `buildViewUrl` helper near the top (after the constants)**

Find the line `const TOAST_MS = 2000;` (around line 26). Below it, add:

```js
function buildViewUrl(entry) {
  const params = new URLSearchParams({
    filename: entry.filename,
    subfolder: entry.subfolder || "",
    type: entry.type || "temp",
    t: String(Date.now()),  // cache-bust same-name files
  });
  return `/view?${params.toString()}`;
}

function loadFrameImage(url) {
  const img = new Image();
  img.src = url;
  return img;
}
```

- [ ] **Step 4: Add the `executed` listener — register it once at module load**

At the very bottom of `js/preview/index.js` (after the `app.registerExtension(...)` call), append:

```js
// Listen for ComfyUI's executed event and pull our custom UI key
// (pixaroma_preview_frames) onto the node. We use a custom key (not
// `images`) so LiteGraph doesn't auto-render its native image strip
// underneath our custom widget.
api.addEventListener("executed", ({ detail }) => {
  const frames = detail?.output?.pixaroma_preview_frames;
  if (!frames || !frames.length) return;
  // Cross-version node-id resolution (Save Mp4 pattern, CLAUDE.md):
  // Vue may pass detail.node as a string, legacy as a number — try both.
  let node = app.graph.getNodeById(detail.node);
  if (!node && typeof detail.node === "string") {
    node = app.graph.getNodeById(parseInt(detail.node, 10));
  }
  if (!node || node.type !== "PixaromaPreview") return;

  node._pixaromaFrames = frames.map((f) => ({
    ...f,
    url: buildViewUrl(f),
    img: loadFrameImage(buildViewUrl(f)),
  }));
  // Reset selection if the new batch is smaller than the old one
  if ((node._pixaromaSelectedFrame ?? 0) >= frames.length) {
    node._pixaromaSelectedFrame = 0;
  }
  node.setDirtyCanvas(true, true);
});
```

- [ ] **Step 5: Update `getPreviewBlob` to read from the new frames cache, falling back to `node.imgs[0]`**

Find `getPreviewBlob` (around line 102):

```js
async function getPreviewBlob(node) {
  const img = node.imgs?.[0];
  if (!img || !img.src) return null;
  const resp = await fetch(img.src);
  if (!resp.ok) throw new Error(`preview fetch failed: ${resp.status}`);
  return await resp.blob();
}
```

Replace with:

```js
async function getPreviewBlob(node) {
  const idx = node._pixaromaSelectedFrame ?? 0;
  const frame = node._pixaromaFrames?.[idx];
  if (frame?.url) {
    const resp = await fetch(frame.url);
    if (!resp.ok) throw new Error(`preview fetch failed: ${resp.status}`);
    return await resp.blob();
  }
  // Fallback for legacy state where _pixaromaFrames hasn't populated yet
  const img = node.imgs?.[0];
  if (!img || !img.src) return null;
  const resp = await fetch(img.src);
  if (!resp.ok) throw new Error(`preview fetch failed: ${resp.status}`);
  return await resp.blob();
}
```

- [ ] **Step 6: Update the active-state check in the buttons widget**

Find inside `createButtonsWidget` → `draw`:

```js
      const active = !!(node.imgs && node.imgs.length > 0);
```

Replace with:

```js
      const active = !!(node._pixaromaFrames?.length || node.imgs?.length);
```

And inside `saveToOutput` and `saveToDisk` (both functions, near the top), find:

```js
  if (!node.imgs?.length) {
    showToast(node, "Run the workflow first");
    return;
  }
```

Replace each occurrence with:

```js
  if (!node._pixaromaFrames?.length && !node.imgs?.length) {
    showToast(node, "Run the workflow first");
    return;
  }
```

- [ ] **Step 7: Add a basic strip widget that draws all frames in a row (no selection UI yet)**

In `js/preview/index.js`, just below `createButtonsWidget`, add:

```js
// ---- strip widget (Task 5: basic layout; selection UI added in Task 6) ----
const STRIP_MIN_H = 180;     // minimum strip height when no frames yet
const STRIP_GAP = 4;         // px between frame cells
const STRIP_V_PAD = 4;       // top + bottom padding inside the strip

function layoutStrip(widgetWidth, frames) {
  const n = frames.length;
  if (!n) return { rects: [], totalH: STRIP_MIN_H };
  const innerW = Math.max(40, widgetWidth - 2 * SIDE_PAD);
  const cellGap = STRIP_GAP;
  const cellW = Math.max(40, Math.floor((innerW - cellGap * (n - 1)) / n));
  // Cell aspect: use first frame's natural aspect if loaded; else assume 1:1
  const first = frames[0]?.img;
  let aspect = 1;
  if (first?.complete && first.naturalWidth > 0) {
    aspect = first.naturalWidth / first.naturalHeight;
  }
  const cellH = Math.max(40, Math.round(cellW / aspect));
  const totalH = cellH + 2 * STRIP_V_PAD;
  const rects = [];
  for (let i = 0; i < n; i++) {
    rects.push({
      x: SIDE_PAD + i * (cellW + cellGap),
      y: STRIP_V_PAD,
      w: cellW,
      h: cellH,
      idx: i,
    });
  }
  return { rects, totalH };
}

function createStripWidget() {
  return {
    name: "pixaroma_strip",
    type: "custom",
    value: null,
    serialize: false,
    computeSize(width) {
      const node = this._node;
      const frames = node?._pixaromaFrames || [];
      const layout = layoutStrip(width, frames);
      return [width, layout.totalH];
    },
    draw(ctx, node, widget_width, y) {
      this._node = node;  // capture for computeSize
      const frames = node._pixaromaFrames || [];
      if (!frames.length) return;
      const layout = layoutStrip(widget_width, frames);
      node._pixaromaCells = layout;
      for (const r of layout.rects) {
        const f = frames[r.idx];
        if (f?.img?.complete && f.img.naturalWidth > 0) {
          ctx.drawImage(f.img, r.x, y + r.y, r.w, r.h);
        } else {
          // placeholder while loading
          ctx.save();
          ctx.fillStyle = "#222";
          ctx.fillRect(r.x, y + r.y, r.w, r.h);
          ctx.restore();
        }
      }
    },
    mouse() { return false; },  // selection added in Task 6
  };
}
```

- [ ] **Step 8: Register the strip widget in `onNodeCreated`**

Find inside `beforeRegisterNodeDef`:

```js
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      this.addCustomWidget(createButtonsWidget());
      // Sensible default + minimum size
      if (!this.size || this.size[0] < DEFAULT_W) this.size[0] = DEFAULT_W;
      if (!this.size[1] || this.size[1] < DEFAULT_H) this.size[1] = DEFAULT_H;
      this.setDirtyCanvas(true, true);
    };
```

Replace the body with:

```js
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      this.addCustomWidget(createButtonsWidget());
      this.addCustomWidget(createStripWidget());
      // Sensible default + minimum size
      if (!this.size || this.size[0] < DEFAULT_W) this.size[0] = DEFAULT_W;
      if (!this.size[1] || this.size[1] < DEFAULT_H) this.size[1] = DEFAULT_H;
      this.setDirtyCanvas(true, true);
    };
```

- [ ] **Step 9: When new frame images finish loading, force a redraw so layout/aspect is correct**

In the `executed` listener (Step 4 above), the `loadFrameImage` returns an `Image` object whose dimensions aren't known until it loads. Update `loadFrameImage` to set `onload` so the node redraws once dimensions arrive:

Find:
```js
function loadFrameImage(url) {
  const img = new Image();
  img.src = url;
  return img;
}
```

Replace with:
```js
function loadFrameImage(url, onLoad) {
  const img = new Image();
  img.onload = () => { if (onLoad) onLoad(img); };
  img.src = url;
  return img;
}
```

In the `executed` listener, change:
```js
    img: loadFrameImage(buildViewUrl(f)),
```

to:
```js
    img: loadFrameImage(buildViewUrl(f), () => node.setDirtyCanvas(true, true)),
```

- [ ] **Step 10: Restart and verify single + batch cases**

Restart ComfyUI. Hard-refresh the browser (Ctrl+F5).

Single image:
1. Drop a Preview Image Pixaroma node, wire any single image source.
2. Run the workflow.
3. Confirm: image appears in the strip area below the buttons (single cell, full width). Save to Output / Save to Disk both work as before.

Batch:
4. Wire the node to a batch of 4 (e.g. EmptyLatentImage with batch_size=4 → VAEDecode).
5. Run the workflow.
6. Confirm: 4 frames appear side-by-side in the strip.
7. Click Save to Output — first frame saves to `output/Preview_00001_.png` (selection always 0 in this task).
8. Click Save to Disk — first frame saves to disk.

`save_mode = "save"`:
9. Set `save_mode` widget to `save`.
10. Run a fresh workflow with batch=2.
11. Confirm: BOTH frames appear in `output/` (e.g. `Preview_00003_.png`, `Preview_00004_.png` — counter continues from previous saves). Drag each into ComfyUI — workflow metadata is embedded in both.
12. Set `save_mode` back to `preview` — confirm new runs do NOT write to output/.

Backwards compat:
13. Open a workflow JSON saved before this change (one with the old node) — it loads with `save_mode = "preview"` and behaves identically to before.

If anything fails, fix in this same task before committing — DO NOT commit a broken state.

- [ ] **Step 11: Commit**

```bash
git add nodes/node_preview.py js/preview/index.js
git commit -m "preview: batch support + save_mode toggle (preview/save) + JS executed-event wiring"
```

---

## Task 6: Add strip-widget selection UI (click to select, orange border, "i / N" badge) and wire selected frame into save handlers

**Files:**
- Modify: `js/preview/index.js` (`createStripWidget` and `getPreviewBlob`)

After Task 5 the strip renders frames but selection is hardcoded to 0. This task adds the user-visible selection.

- [ ] **Step 1: Add selection-rendering constants**

In `js/preview/index.js`, find the strip-widget constants (added in Task 5):

```js
const STRIP_MIN_H = 180;
const STRIP_GAP = 4;
const STRIP_V_PAD = 4;
```

Below them, add:

```js
const STRIP_BORDER_W = 2;       // selection border thickness
const BADGE_PAD = 4;            // px inside the counter badge
const BADGE_H = 16;             // px tall badge
const BADGE_FONT = "11px sans-serif";
```

- [ ] **Step 2: Replace the strip widget's `draw` method to render selection + badges**

Find the existing `draw` inside `createStripWidget`:

```js
    draw(ctx, node, widget_width, y) {
      this._node = node;
      const frames = node._pixaromaFrames || [];
      if (!frames.length) return;
      const layout = layoutStrip(widget_width, frames);
      node._pixaromaCells = layout;
      for (const r of layout.rects) {
        const f = frames[r.idx];
        if (f?.img?.complete && f.img.naturalWidth > 0) {
          ctx.drawImage(f.img, r.x, y + r.y, r.w, r.h);
        } else {
          ctx.save();
          ctx.fillStyle = "#222";
          ctx.fillRect(r.x, y + r.y, r.w, r.h);
          ctx.restore();
        }
      }
    },
```

Replace with:

```js
    draw(ctx, node, widget_width, y) {
      this._node = node;
      const frames = node._pixaromaFrames || [];
      if (!frames.length) return;
      const layout = layoutStrip(widget_width, frames);
      node._pixaromaCells = layout;
      const sel = node._pixaromaSelectedFrame ?? 0;
      const total = frames.length;
      for (const r of layout.rects) {
        const f = frames[r.idx];
        if (f?.img?.complete && f.img.naturalWidth > 0) {
          ctx.drawImage(f.img, r.x, y + r.y, r.w, r.h);
        } else {
          ctx.save();
          ctx.fillStyle = "#222";
          ctx.fillRect(r.x, y + r.y, r.w, r.h);
          ctx.restore();
        }
        if (total > 1) {
          // Counter badge in bottom-right, BRAND fill if selected, dark otherwise
          const isSel = r.idx === sel;
          const badgeText = `${r.idx + 1} / ${total}`;
          ctx.save();
          ctx.font = BADGE_FONT;
          const textW = ctx.measureText(badgeText).width;
          const badgeW = textW + BADGE_PAD * 2;
          const bx = r.x + r.w - badgeW - 4;
          const by = y + r.y + r.h - BADGE_H - 4;
          ctx.fillStyle = isSel ? BRAND : "rgba(0,0,0,0.72)";
          ctx.beginPath();
          ctx.roundRect(bx, by, badgeW, BADGE_H, 3);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.textBaseline = "middle";
          ctx.textAlign = "left";
          ctx.fillText(badgeText, bx + BADGE_PAD, by + BADGE_H / 2 + 1);
          ctx.restore();
          if (isSel) {
            // Orange selection border drawn inside the cell to avoid clipping
            ctx.save();
            ctx.strokeStyle = BRAND;
            ctx.lineWidth = STRIP_BORDER_W;
            ctx.strokeRect(
              r.x + STRIP_BORDER_W / 2,
              y + r.y + STRIP_BORDER_W / 2,
              r.w - STRIP_BORDER_W,
              r.h - STRIP_BORDER_W,
            );
            ctx.restore();
          }
        }
      }
    },
```

- [ ] **Step 3: Replace the `mouse` no-op with click-to-select**

Find inside `createStripWidget`:

```js
    mouse() { return false; },  // selection added in Task 6
```

Replace with:

```js
    mouse(event, pos, node) {
      if (event.type !== "pointerdown" && event.type !== "mousedown") return false;
      const layout = node._pixaromaCells;
      if (!layout?.rects?.length) return false;
      // pos is widget-local; rects are also widget-local (relative to the
      // widget's top-left). They're in the same coord system → direct hit-test.
      const lx = pos[0];
      const ly = pos[1];
      for (const r of layout.rects) {
        if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) {
          if ((node._pixaromaSelectedFrame ?? 0) !== r.idx) {
            node._pixaromaSelectedFrame = r.idx;
            node.setDirtyCanvas(true, true);
          }
          return true;
        }
      }
      return false;
    },
```

- [ ] **Step 4: Verify selected-frame save end-to-end**

Restart ComfyUI is NOT needed (JS-only changes). Hard-refresh the browser (Ctrl+F5).

1. Run a workflow with batch=4.
2. Confirm: 4 frames render with `1 / 4`, `2 / 4`, `3 / 4`, `4 / 4` badges; frame 1 has an orange border + orange-fill badge.
3. Click frame 3. Border + orange badge move to frame 3. Other frames' badges go dark.
4. Click **Save to Output** — file `Preview_NNNNN_.png` saved; drag into ComfyUI — content matches frame 3 (not frame 1).
5. Click **Save to Disk** — file picker suggests `Preview_NNNNN_.png` (counter advanced from step 4). Save it. Open the saved PNG — content matches frame 3.
6. Click frame 1, then Save to Output — content matches frame 1 (selection works in both directions).
7. Single-image case: wire to a non-batch source, run. Confirm: NO border, NO badge (UI hides selection affordances when batch == 1 — comes from the `if (total > 1)` guard).
8. After re-running with a smaller batch (e.g. batch=2 after batch=4), the previously-selected index 3 falls out of bounds — confirm: selection resets to 0 (handled by Task 5's `executed` listener guard).

- [ ] **Step 5: Commit**

```bash
git add js/preview/index.js
git commit -m "preview: strip-widget selection (click, orange border, i/N badge) + selected-frame save"
```

---

## Task 7: Update CLAUDE.md token-saving table

**Files:**
- Modify: `CLAUDE.md` (the Preview Image Pixaroma rows in the token-saving table near the bottom of the Frontend Directory Structure section, plus the "Files touched" guidance row)

- [ ] **Step 1: Update the `js/preview/` directory description**

Open `CLAUDE.md`. Find the `js/preview/` section in the directory tree (around line 100):

```
├── preview/            # Preview Image Pixaroma (single file, ~320 lines)
│   └── index.js        # Two orange buttons (Save to Disk / Save to Output) as
│                       #  an addCustomWidget placed between filename_prefix and
│                       #  the ComfyUI-native preview image. saveToOutput posts
│                       #  to /pixaroma/api/preview/save; saveToDisk posts to
│                       #  /pixaroma/api/preview/prepare then writes via
│                       #  window.showSaveFilePicker with <a download> fallback.
│                       #  Node-level onMouseMove/onMouseLeave for hover (widget
│                       #  mouse() doesn't get pointermove on Vue).
```

Replace with:

```
├── preview/            # Preview Image Pixaroma (single file, ~500 lines)
│   └── index.js        # Two orange buttons (Save to Disk / Save to Output) +
│                       #  custom strip widget rendering all batch frames with
│                       #  click-to-select (orange BRAND border + "i / N" badge).
│                       #  Listens to api.addEventListener("executed", ...) for
│                       #  pixaroma_preview_frames (custom UI key — Save Mp4
│                       #  pattern, NOT ui.images, so LiteGraph doesn't render
│                       #  its native strip underneath). saveToOutput posts to
│                       #  /pixaroma/api/preview/save; saveToDisk posts to
│                       #  /pixaroma/api/preview/prepare and uses the route's
│                       #  suggested_filename (auto-counter peek) for the Save
│                       #  dialog, then writes via window.showSaveFilePicker
│                       #  with <a download> fallback.
```

- [ ] **Step 2: Update the "Preview Image Pixaroma" entry in the token-saving table**

Find in `CLAUDE.md`:

```
| Preview Image Pixaroma — change button layout / geometry / colors | `js/preview/index.js` constants at the top (`BTN_H`, `BTN_GAP`, `MIN_W`, `MIN_H`, `DEFAULT_W`, `DEFAULT_H`, `COLOR_ACTIVE_*` / `COLOR_DISABLED_*`). Button rects computed in `computeButtonRects`, painted in `paintBtn`. Buttons live as an `addCustomWidget` (so they reserve vertical space above the image) — don't switch back to `onDrawForeground` overlay; it collides with ComfyUI's native preview + dimension label. |
| Preview Image Pixaroma — change save flow / routes | Backend: `nodes/node_preview.py` (tensor → temp PNG for preview display) + `server_routes.py` helpers `_embed_workflow_metadata`, `/pixaroma/api/preview/save`, `/pixaroma/api/preview/prepare`. Frontend: `js/preview/index.js` `saveToOutput` / `saveToDisk`. Both POST a dataURL + the workflow/prompt from `app.graphToPrompt()`. Metadata embedding lives in Python only (single source of truth). |
```

Replace with:

```
| Preview Image Pixaroma — change button or strip layout / geometry / colors | `js/preview/index.js` constants at the top (`BTN_H`, `BTN_GAP`, `MIN_W`, `MIN_H`, `DEFAULT_W`, `DEFAULT_H`, `STRIP_GAP`, `STRIP_V_PAD`, `STRIP_BORDER_W`, `BADGE_*`, `COLOR_ACTIVE_*` / `COLOR_DISABLED_*`). Button rects computed in `computeButtonRects`, painted in `paintBtn`. Strip rects computed in `layoutStrip`, painted in `createStripWidget().draw`. Buttons + strip live as `addCustomWidget`s (so they reserve vertical space, draw immediately on node-add, and Vue-compat works). Don't switch back to `onDrawForeground` (Vue Compat #1) and don't return `ui.images` from the Python node (LiteGraph would render its native strip underneath the custom one — use the `pixaroma_preview_frames` custom UI key instead, Save Mp4 pattern). |
| Preview Image Pixaroma — change save flow / routes | Backend: `nodes/node_preview.py` (tensor → PNG, two modes: temp/ for preview, output/ for save with embedded metadata via shared `nodes/_save_helpers._build_pnginfo`) + `server_routes.py` helpers `_embed_workflow_metadata` (thin wrapper), `/pixaroma/api/preview/save`, `/pixaroma/api/preview/prepare`. Both routes validate `filename_prefix` via shared `nodes/_save_helpers._safe_prefix` (allows `subfolder/prefix` with `[A-Za-z0-9_-]` segments, no `..`). Prepare route returns JSON `{image_b64, suggested_filename}` — the suggested_filename peeks `folder_paths.get_save_image_path` to pre-fill the Save-to-Disk picker with the next free counter. Frontend: `js/preview/index.js` `saveToOutput` / `saveToDisk` read the SELECTED frame from `node._pixaromaFrames[node._pixaromaSelectedFrame]`. Both POST a dataURL + the workflow/prompt from `app.graphToPrompt()`. Metadata embedding lives in `nodes/_save_helpers._build_pnginfo` only (single source of truth). |
| Preview Image Pixaroma — add / change save_mode behavior or hidden inputs | `nodes/node_preview.py`. `INPUT_TYPES` declares `save_mode` as a required combo (`preview` / `save`, default `preview`) and `prompt: PROMPT, extra_pnginfo: EXTRA_PNGINFO` as hidden inputs. In `save` mode the node iterates the entire batch, calls `folder_paths.get_save_image_path`, and saves each frame to `output/{subfolder}/{name}_{counter+i:05}_.png` with embedded metadata — drop-in for native SaveImage. In `preview` mode it writes UUID-named PNGs to `temp/` (auto-cleared on ComfyUI restart). Either mode returns `ui.pixaroma_preview_frames` (custom key). |
```

- [ ] **Step 3: Verify the diff is clean**

Run:
```bash
git diff CLAUDE.md
```

Confirm: only the preview-related rows changed; no accidental edits elsewhere.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "claude.md: update Preview Image Pixaroma rows for batch + save_mode + subfolder"
```

---

## Final acceptance test

After Task 7 commits, run the spec's full Testing Checklist (spec §"Testing checklist") in one sitting. All 10 cases must pass before declaring done.

If any case fails, root-cause it (don't paper over) and fix in a follow-up commit on this branch — don't amend old commits.

---

## Self-review notes (informational, not a task)

- All four user requirements covered: batch (Task 5+6), subfolder (Task 3), auto-index Save to Disk (Task 4), save_mode toggle (Task 5).
- All file paths match between tasks. `nodes/_save_helpers.py` is created in Task 1 and consistently imported as `from ._save_helpers import _build_pnginfo, _safe_prefix` in `node_preview.py` (Task 5) and `from nodes._save_helpers import _build_pnginfo, _safe_prefix` in `server_routes.py` (Task 2).
- Type / signature consistency: `_safe_prefix(s) -> str | None` used everywhere; `_build_pnginfo(prompt=, workflow=, extra_pnginfo=)` keyword-only at all callsites.
- No placeholders remain ("TBD", "etc.").
- Each task ends with concrete verification + commit. Each task leaves the codebase in a working state (subject to manual restart).
