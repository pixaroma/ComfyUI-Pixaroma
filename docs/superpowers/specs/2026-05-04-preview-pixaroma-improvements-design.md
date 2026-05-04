# Preview Image Pixaroma — Batch, Subfolder, Auto-Index, Save-Mode

**Date:** 2026-05-04
**Status:** Spec
**Touches:** `nodes/node_preview.py`, `nodes/_save_helpers.py` (new), `server_routes.py`, `js/preview/index.js`, `CLAUDE.md`

## Goal

Bring the Preview Image Pixaroma node up to feature parity with ComfyUI's native `PreviewImage` for batches, with native `SaveImage` for subfolders and auto-numbering, and add an opt-in mode that turns the node into a true save node — without breaking any existing workflows.

## Problems being fixed

1. **Batch shows only frame 0.** A batch of 4 collapses to a single image; the other 3 are silently discarded from the visible preview. Save buttons can only act on what's visible.
2. **Subfolders rejected.** The route's regex `^[a-zA-Z0-9_\-]+$` rejects `SDXL/image`, even though `folder_paths.get_save_image_path` (already called) supports the syntax safely.
3. **Save to Disk has no auto-index.** Suggested filename is `{prefix}.png` every time → user overwrites or has to rename manually. (Save to Output already auto-numbers via `get_save_image_path`.)
4. **No way to make the node persist images automatically.** It's preview-only; users who want both preview and save must wire a separate `SaveImage` node.

## Non-goals

- Reuploading or replacing the per-frame caching layer in LiteGraph.
- Animation / playback for batches (they're stills, not frames of a video).
- A separate "subfolder" widget — we follow native ComfyUI convention of `subfolder/prefix` in a single field.

## UX changes (frontend)

### Layout, top to bottom inside the node body

1. `filename_prefix` — text input (existing). Validation relaxed to allow `subfolder/prefix` syntax.
2. `save_mode` — combo: `preview` / `save`, default `preview` (NEW).
3. **Buttons widget** — `[Save to Disk]` `[Save to Output]` (existing geometry).
4. **Strip widget** (NEW) — horizontal row of all batch frames.

### Strip widget behavior

- Renders all frames returned by the backend (under custom UI key `pixaroma_preview_frames`).
- **Click to select** — selected frame gets a 2px orange border (`BRAND` color from `js/shared/utils.mjs`).
- **Frame counter badge** — small `i / N` in the bottom-right corner of each frame; e.g. `2 / 4`.
- **Selected indicator** — orange border, plus the badge background changes to `BRAND` for the selected frame.
- **Auto-fit** — frames sized so up to ~4 visible at default node width; mouse-wheel horizontal scroll on overflow.
- **Single-image case (batch == 1)** — no border, no badge, just the image (matches today's look).
- **Selection state** — `node._pixaromaSelectedFrame` (default 0). Not persisted across workflow JSON saves; resets to 0 on reload (selection is a UI affordance, not a workflow input).

### Save buttons (manual)

Both buttons read `node._pixaromaSelectedFrame` and act on that single frame, regardless of `save_mode`:

| Button | Behavior |
|---|---|
| Save to Disk | POST `/pixaroma/api/preview/prepare` with `{ image_b64, prefix, workflow, prompt }`; backend returns `{ image_b64, suggested_filename }`; JS converts to Blob, opens `showSaveFilePicker` with `suggested_filename`. |
| Save to Output | POST `/pixaroma/api/preview/save` with `{ image_b64, prefix, workflow, prompt }`; backend writes to `output/` with auto-counter and embedded metadata. |

### `save_mode = "save"` automatic behavior

On every workflow execution, the Python node writes ALL batch frames (not just the selected one) to `output/{subfolder}/{name}_{counter:05}_.png` with embedded workflow metadata. This matches `SaveImage` exactly — the manual Save buttons remain available for re-saves of a specific frame.

In `save` mode the strip preview still renders, sourced from the same files that just got persisted to `output/` (so no double-write to temp/).

## Backend node ([nodes/node_preview.py](../../../nodes/node_preview.py))

```python
class PixaromaPreview:
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

    def preview(self, image, filename_prefix, save_mode, prompt=None, extra_pnginfo=None):
        prefix = _safe_prefix(filename_prefix)  # falls back to "Preview" on invalid

        results = []
        if save_mode == "save":
            output_dir = folder_paths.get_output_directory()
            full_folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
                prefix, output_dir, image.shape[2], image.shape[1]
            )
            os.makedirs(full_folder, exist_ok=True)
            for i, tensor in enumerate(image):
                pil = _tensor_to_pil(tensor)
                pnginfo = _build_pnginfo(prompt, extra_pnginfo)
                fname = f"{name}_{counter + i:05}_.png"
                pil.save(os.path.join(full_folder, fname), "PNG", pnginfo=pnginfo)
                results.append({"filename": fname, "subfolder": subfolder, "type": "output"})
        else:  # preview mode
            temp_dir = folder_paths.get_temp_directory()
            os.makedirs(temp_dir, exist_ok=True)
            for tensor in image:
                pil = _tensor_to_pil(tensor)
                fname = f"pixaroma_preview_{uuid.uuid4().hex}.png"
                pil.save(os.path.join(temp_dir, fname), "PNG")
                results.append({"filename": fname, "subfolder": "", "type": "temp"})

        return {
            "ui": {"pixaroma_preview_frames": results},
            "result": (image,),
        }
```

### Why `pixaroma_preview_frames` instead of `images`

Returning `ui.images` causes ComfyUI / LiteGraph to populate `node.imgs` and render its native image strip below widgets. Our custom strip widget needs full control of layout + selection overlay, so we use a project-specific UI key (same pattern Save Mp4 uses with `pixaroma_videos`). The frontend listens to `api.addEventListener("executed", ...)`, reads `detail.output.pixaroma_preview_frames`, and renders.

### `_safe_prefix(s)` — validator

Allows path segments separated by `/`, each segment matches `[A-Za-z0-9_\-]+`. Rejects `..`, leading `/`, empty segments, total length > 256. Returns the cleaned prefix on success, or `None` on invalid input. **Caller decides** what to do with `None`:

- Backend node: `prefix = _safe_prefix(filename_prefix) or "Preview"` (don't crash the workflow on bad input).
- Server routes: `if not prefix: return 400` (reject explicitly so the JS toast surfaces the error).

```python
_SAFE_SEG_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")
_PREFIX_MAX_LEN = 256

def _safe_prefix(s):
    """Return cleaned prefix string, or None if invalid."""
    if not isinstance(s, str): return None
    s = s.strip().replace("\\", "/")
    if not s or len(s) > _PREFIX_MAX_LEN: return None
    if s.startswith("/"): return None
    parts = s.split("/")
    if any(not p or p == ".." or not _SAFE_SEG_RE.match(p) for p in parts):
        return None
    return s
```

Lives in a shared helper module — see next section.

## Shared helper module ([nodes/_save_helpers.py](../../../nodes/_save_helpers.py)) — NEW

Houses the prefix validator (`_safe_prefix`, shown above) AND the metadata builder. Extracts the existing `_embed_workflow_metadata` body from `server_routes.py` so both the backend node and the routes use one implementation:

```python
import json
from PIL.PngImagePlugin import PngInfo

def _build_pnginfo(prompt=None, extra_pnginfo=None) -> PngInfo:
    pnginfo = PngInfo()
    if prompt is not None:
        pnginfo.add_text("prompt", json.dumps(prompt))
    if isinstance(extra_pnginfo, dict):
        for k, v in extra_pnginfo.items():
            try:
                pnginfo.add_text(k, json.dumps(v))
            except Exception:
                pass  # skip unserialisable extras
    return pnginfo
```

Note the engine wraps `prompt`/`workflow` differently in the route vs the node:
- The **route** (called from JS) receives `workflow` and `prompt` as JSON objects from `app.graphToPrompt()`. It writes them as `workflow` and `prompt` keys.
- The **node** (called by ComfyUI) receives `prompt` and `extra_pnginfo` (which contains `workflow`). It writes `prompt` and iterates `extra_pnginfo`.

To keep `_build_pnginfo` truly shared, the route adapts: builds an `extra_pnginfo`-shaped dict `{"workflow": workflow}` and calls `_build_pnginfo(prompt, extra_pnginfo)`. One function, two callsites.

## Server route changes ([server_routes.py](../../../server_routes.py))

### `/pixaroma/api/preview/save` — relax validation

```diff
- if len(prefix_raw) > _MAX_ID_LEN or not _SAFE_ID_RE.match(prefix_raw):
-     return web.json_response(
-         {"error": "filename_prefix must match [A-Za-z0-9_-]{1,64}"}, status=400
-     )
+ prefix = _safe_prefix(prefix_raw)
+ if not prefix:
+     return web.json_response(
+         {"error": "invalid filename_prefix: use [A-Za-z0-9_-] segments separated by '/', no '..'"},
+         status=400,
+     )
```

The route rejects invalid input with 400 so the JS toast surfaces the error to the user. The downstream `prefix` variable is then used everywhere the old `prefix_raw` was used.

### `/pixaroma/api/preview/prepare` — accept prefix, return JSON with suggested filename

**Request body change** — adds required `filename_prefix` (used to peek the next counter):
```json
{
  "image_b64": "data:image/png;base64,...",
  "filename_prefix": "Preview",        // NEW — required
  "workflow": { ... },                  // optional
  "prompt":   { ... }                   // optional
}
```

Validate with `_safe_prefix`; on invalid, return 400 like the save route.

**Response body change** — JSON instead of raw PNG:
```diff
- return web.Response(body=body, content_type="image/png")
+ # Peek at next counter via folder_paths (no write)
+ output_dir = folder_paths.get_output_directory()
+ _, name, counter, _, _ = folder_paths.get_save_image_path(
+     prefix, output_dir, pil.width, pil.height
+ )
+ suggested = f"{name}_{counter:05}_.png"
+ b64 = "data:image/png;base64," + base64.b64encode(body).decode("ascii")
+ return web.json_response({"image_b64": b64, "suggested_filename": suggested})
```

This is a **breaking API change** for prepare, but the only consumer is `js/preview/index.js` and we're updating it in the same PR.

## Frontend ([js/preview/index.js](../../../js/preview/index.js))

### Module structure

Single file (~450 lines). Stays under the ~500-line guideline. Sections:

1. **Constants** (button geometry, brand colors, strip layout)
2. **Buttons widget** (existing, minor change to read selected frame)
3. **Strip widget** (NEW)
4. **`executed` event handler** — pulls `pixaroma_preview_frames` from API output
5. **Save handlers** (`saveToOutput`, `saveToDisk`) — updated for selected-frame + new prepare response
6. **Extension registration** — registers widgets, listens for `executed`

### Strip widget — pseudocode

```js
function createStripWidget() {
  return {
    name: "pixaroma_strip",
    type: "custom",
    value: null,
    serialize: false,
    computeSize(width) {
      // height adapts to first frame aspect ratio + min height
      const node = this._node;
      if (!node?._pixaromaFrames?.length) return [width, MIN_STRIP_H];
      const cells = layoutFrames(width, node._pixaromaFrames);
      return [width, cells.totalH];
    },
    draw(ctx, node, widget_width, y) {
      const frames = node._pixaromaFrames || [];
      if (!frames.length) {
        // empty placeholder
        return;
      }
      const cells = layoutFrames(widget_width, frames);
      node._pixaromaCells = cells;
      const sel = node._pixaromaSelectedFrame ?? 0;
      for (let i = 0; i < cells.rects.length; i++) {
        const r = cells.rects[i];
        const img = frames[i].img;  // HTMLImageElement, lazily loaded
        if (img?.complete) ctx.drawImage(img, r.x, y + r.y, r.w, r.h);
        if (frames.length > 1) {
          drawCounterBadge(ctx, r, y, i + 1, frames.length, sel === i);
          if (sel === i) drawSelectionBorder(ctx, r, y);
        }
      }
    },
    mouse(event, pos, node) {
      if (event.type !== "pointerdown" && event.type !== "mousedown") return false;
      const cells = node._pixaromaCells || { rects: [] };
      for (let i = 0; i < cells.rects.length; i++) {
        const r = cells.rects[i];
        if (hitTestCell(r, pos)) {
          node._pixaromaSelectedFrame = i;
          node.setDirtyCanvas(true, true);
          return true;
        }
      }
      return false;
    },
  };
}
```

`layoutFrames` returns equal-width cells with a small gap, capped to a max number visible (overflow handled later by horizontal scroll if needed; v1 just clamps cells to min width 80px).

### `executed` event hook

```js
api.addEventListener("executed", ({ detail }) => {
  const frames = detail?.output?.pixaroma_preview_frames;
  if (!frames) return;
  // Cross-version node-id resolution (Save Mp4 pattern from CLAUDE.md):
  // Vue passes detail.node as a string, legacy passes a number — try both.
  const node =
    app.graph.getNodeById(detail.node) ||
    app.graph.getNodeById(parseInt(detail.node));
  if (!node || node.type !== "PixaromaPreview") return;
  node._pixaromaFrames = frames.map((f) => ({
    ...f,
    img: loadImg(buildViewUrl(f)),
  }));
  if ((node._pixaromaSelectedFrame ?? 0) >= frames.length) {
    node._pixaromaSelectedFrame = 0;
  }
  node.setDirtyCanvas(true, true);
});
```

`buildViewUrl` returns `/view?filename=...&subfolder=...&type=...&t=<timestamp>` (cache-busted).

### Save handler changes

`saveToDisk` switches from raw-PNG response to JSON `{ image_b64, suggested_filename }`:

```js
const { image_b64, suggested_filename } = await resp.json();
const blob = await dataURLToBlob(image_b64);
// ... existing showSaveFilePicker call with suggestedName: suggested_filename
```

Both save handlers grab the selected frame's image source:

```js
function getSelectedFrameBlob(node) {
  const idx = node._pixaromaSelectedFrame ?? 0;
  const f = node._pixaromaFrames?.[idx];
  if (!f?.img) throw new Error("no frame selected");
  return imageElToBlob(f.img);
}
```

## Edge cases & failure modes

| Case | Behavior |
|---|---|
| Empty batch (impossible from valid IMAGE input but defensive) | Strip empty, save buttons say "Run the workflow first" |
| `batch == 1` | No counter badge, no selection border — same look as today |
| Invalid `filename_prefix` (e.g. `..`, `\\`, leading `/`) | Backend node falls back to `"Preview"`, prints a warning, doesn't crash. Routes return 400 to JS, which shows the error toast. |
| `save` mode + readonly disk | Exception bubbles up; node fails the run with a normal ComfyUI error |
| Counter race (two simultaneous runs same prefix) | Same race as native `SaveImage` — accepted upstream behavior |
| Trailing slash in prefix (`SDXL/`) | Empty last segment → invalid → fallback to `"Preview"` |
| Old workflow JSON loaded (no `save_mode` widget value) | ComfyUI defaults the new widget to `"preview"` (mode declared in `INPUT_TYPES`); behavior identical to old node |
| `executed` event arrives before strip widget exists (race during node creation) | Frames are stored on `node._pixaromaFrames`; strip widget reads them on next draw |
| Selected frame index out of bounds after a re-run with smaller batch | Reset to 0 when frames update |

## Testing checklist (manual, before merge)

1. Drop preview node, wire to a single image source — works exactly like today.
2. Wire to a batch of 4 — strip shows 4 frames, click each: orange border tracks. Counter badges show `1/4`–`4/4`.
3. With frame 2 selected, click Save to Output — file `Preview_00001_.png` written to `output/`, file content matches frame 2.
4. With frame 3 selected, click Save to Disk — file picker opens with `Preview_00002_.png` suggested (counter advanced).
5. Type `SDXL/portrait` in `filename_prefix` — saves to `output/SDXL/portrait_00001_.png`. Subdirectory created if missing.
6. Type `..` → falls back to `Preview`. Type `SDXL/` → fallback. Type `/abs/path` → fallback. Type 300-char string → fallback.
7. Switch `save_mode` to `save` and run with batch of 4 — 4 files appear in `output/` with auto-counter, all 4 have workflow metadata embedded (verify by drag-dropping back into ComfyUI).
8. Reload the workflow — `save_mode` value persists, `filename_prefix` value persists. Run again, counter continues from where it left off.
9. Existing workflow saved before this change — loads with `save_mode = "preview"` (default), behaves identically to before.
10. Vue frontend specifically — strip renders, click selection works, save buttons fire. No console errors.

## Deferred / future work

- Horizontal scroll for batches > ~4 visible.
- Right-click context menu on strip cells (Save This Frame, Copy, Open in OS).
- Drag selection / range save.
- Preview thumbnails sized below full resolution to speed first paint on large batches.

## Open questions

None — all decisions locked via the brainstorming pass with the user.
