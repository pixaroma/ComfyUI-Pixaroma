# Preview Pixaroma — Design Spec

**Date:** 2026-04-23
**Status:** Approved (brainstorm complete, awaiting implementation plan)
**Branch:** Ioan

## Problem

Every workflow needs a preview checkpoint — a node where the user can eyeball a generated image and decide whether to save it or continue the pipeline. ComfyUI's built-in `PreviewImage` shows the image but has no save-to-disk feature; `SaveImage` writes to the ComfyUI `output/` folder only. Users currently have to: (a) wait for the workflow to finish, (b) right-click the preview, (c) fall back to the browser's "Save image as…" which strips workflow metadata and has an awkward filename.

Preview Pixaroma collapses this into one node with two explicit orange buttons — mirroring the Image Compare UI pattern — plus an optional passthrough output so the same node can be either a terminator (eyeball and stop) or a mid-stream checkpoint (eyeball, save if you want, keep going).

## Identity

| Field | Value |
|---|---|
| Class name | `PixaromaPreview` |
| Display name | `Preview Pixaroma` |
| Category | `👑 Pixaroma/Utils` |
| Inputs | `image: IMAGE` (required) |
| Outputs | `image: IMAGE` (passthrough — downstream-optional per ComfyUI default) |
| Widgets | `filename_prefix: STRING` (default `"Preview"`) |
| `OUTPUT_NODE` | `True` |
| Backend file | `nodes/node_preview.py` |
| Frontend file | `js/preview/index.js` (single file — follows Compare's pattern per CLAUDE.md) |
| Backend routes | `/pixaroma/api/preview/save`, `/pixaroma/api/preview/prepare` (both POST) in `server_routes.py` |
| Registration | Add to `__init__.py` mapping merge in alphabetical position |

## UI

### Layout (resizable node, approximate 280 × 320 px default)

```
┌─────────────────────────────────┐
│ Preview Pixaroma         [×]    │  title bar
├─────────────────────────────────┤
│ ● image ─────────────── image ● │  input (left) / output (right) sockets
├─────────────────────────────────┤
│ filename_prefix: [Preview    ]  │  editable STRING widget
├─────────────────────────────────┤
│                                 │
│      ┌───────────────┐          │
│      │   (preview    │          │  rendered image — standard ComfyUI
│      │    image)     │          │  preview area, scales with node
│      └───────────────┘          │
│                                 │
│   [ Save to Disk ] [ Save to Output ]
└─────────────────────────────────┘
```

- Resize handle present; preview and buttons reflow on resize.
- Preview area uses ComfyUI's default `imgs`-array rendering (same as built-in `PreviewImage`). No custom image-draw code.
- Both buttons are **canvas-drawn** via `onDrawForeground`, hit-tested in `onMouseDown`, same approach as Image Compare's `paintBtn`.

### Button specs

- Active fill / stroke: `BRAND` (`#f66744`), white text `#fff` — imported from `js/shared/utils.mjs`.
- Disabled fill: `#2a2c2e`, disabled stroke: `#444`, disabled text: `#999` — matches Compare's inactive style.
- Shape: rounded rect, 3 px radius.
- Size: ~120 × 24 px each, 8 px horizontal gap, horizontally centered under preview, 6 px from node's bottom edge.
- Disabled state: triggered when `node.imgs` is empty (workflow hasn't run yet). Click shows an inline toast "Run the workflow first".
- Hover state: subtle brightness bump (reuse Compare's hover convention).

### Labels

- Left button: **Save to Disk** — opens OS save dialog (Chrome/Edge) or falls back to browser Downloads.
- Right button: **Save to Output** — writes to ComfyUI `output/` with auto-incremented counter.

### Toasts

Bottom-of-node canvas-drawn toast, 2 s duration. Reuse an existing `js/shared/` helper if one exists at implementation time; otherwise add one inline in `index.js`.

### Vue-frontend consideration

CLAUDE.md Vue Compat #1 notes `onDrawForeground` may not fire in the Vue 3 frontend. Image Compare uses it successfully, so it appears to work for button-paint purposes. Implementation will verify during manual QA. If the Vue frontend suppresses it, fall back to a lightweight `setInterval`-triggered `node.setDirtyCanvas(true, true)` while the node is selected or hovered.

## Backend

### Python node (`nodes/node_preview.py`)

```python
class PixaromaPreview:
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
        # Save to ComfyUI temp/ so the frontend can render it in the node body.
        # Mirrors ComfyUI's built-in PreviewImage pattern.
        # Returns both UI info (for node preview) and the passthrough tensor.
        ...
        return {"ui": {"images": [{"filename": fn, "subfolder": "", "type": "temp"}]},
                "result": (image,)}
```

- `filename_prefix` is a required STRING widget. Per CLAUDE.md Vue Compat #9, this will expose a convertible input dot on hover. That's acceptable for this node — users expect to be able to wire the prefix from another node if they want. No `hidden`-input plumbing needed.
- Temp-save logic mirrors `PreviewImage` in ComfyUI core: PIL.Image from tensor, random UUID filename, write to `folder_paths.get_temp_directory()`, return the filename via the UI dict.

### Backend routes (additions to `server_routes.py`)

Two new POST routes, following the existing Pixaroma pattern (`_decode_image`, `_safe_path`, 50 MB base64 cap, `^[a-zA-Z0-9_\-]+$` ID validation):

#### `POST /pixaroma/api/preview/save`

Saves to ComfyUI `output/` folder (not the Pixaroma input folder — this is where users expect "saved" images to appear in the ComfyUI gallery).

**Request body (JSON):**
- `image_b64`: base64 data-URI PNG (cap 50 MB per existing pattern)
- `filename_prefix`: string, validated against `^[A-Za-z0-9_\-]{1,64}$`
- `workflow`: JSON object (from `app.graph.serialize()`)
- `prompt`: JSON object (last prompt API payload)

**Processing:**
1. Decode base64 → PIL Image via `_decode_image`.
2. Build PNG `PngInfo` with `prompt` and `workflow` tEXt chunks (byte-for-byte match to ComfyUI's built-in `SaveImage`).
3. Compute save path via ComfyUI's `folder_paths.get_save_image_path(filename_prefix, folder_paths.get_output_directory())` — this returns `(full_output_folder, filename, counter, subfolder, filename_prefix)` with atomic counter logic.
4. Save as `<prefix>_<counter_padded_to_5>_.png` in the returned folder.
5. Return `{ "status": "success", "filename": "<prefix>_00001_.png", "subfolder": "<subfolder or empty>" }`.

#### `POST /pixaroma/api/preview/prepare`

Returns a metadata-embedded PNG blob without writing it to disk. Used by Save-to-Disk so the JS side doesn't have to embed PNG tEXt chunks itself.

**Request body (JSON):** `image_b64`, `workflow`, `prompt` (same validation as `/save` minus filename).

**Response:** `Content-Type: image/png`, body = PNG bytes with embedded metadata.

### Metadata embedding (shared helper)

Factor the PNG metadata embedding into a single private helper `_embed_workflow_metadata(pil_img, workflow, prompt) -> PngInfo` inside `server_routes.py`. Both routes call it. This is the single source of truth — if ComfyUI core ever changes the metadata format, one place changes.

## Frontend (`js/preview/index.js`)

Single file, ~250–350 lines expected. Structure:

1. **Extension registration** — `app.registerExtension({ name: "Pixaroma.Preview", … })` with a `beforeRegisterNodeDef` hook that checks `nodeData.name === "PixaromaPreview"` and patches the node class prototype.
2. **`onDrawForeground` override** — paint two orange buttons using a local `paintBtn(ctx, x, y, w, h, label, active)` function (copy from Compare's `index.js` pattern; the repo has no shared helper for this yet).
3. **`onMouseDown` override** — hit-test button rects, dispatch to `_onSaveToDisk()` / `_onSaveToOutput()`.
4. **`onResize` override** — reposition button rects based on new node width (keep 8 px gap, centered).
5. **Save handlers:**
   - `_onSaveToDisk()`: read latest preview blob from `node.imgs[0]` → POST to `/pixaroma/api/preview/prepare` with workflow + prompt → receive PNG blob → `window.showSaveFilePicker({ suggestedName, types: [{accept:{"image/png":[".png"]}}] })` if available; else `<a download>` fallback. Catch `AbortError` silently on user cancel.
   - `_onSaveToOutput()`: same blob read → POST to `/pixaroma/api/preview/save` with workflow + prompt + `filename_prefix` (from the widget) → success toast with returned filename.
6. **Preview blob reader helper** — fetches from the `/view?filename=…&type=temp` endpoint using the filename ComfyUI set on `node.imgs[0]` (same approach as any ComfyUI preview consumer). Returns a `Blob`.
7. **Workflow + prompt capture** — `app.graphToPrompt()` returns `{ output: prompt, workflow }`; use that. Standard pattern in ComfyUI extensions.
8. **Inline toast helper** — canvas-drawn text flash at bottom of node, 2 s, managed via `setTimeout` + `setDirtyCanvas(true, true)`.
9. **Disabled-state logic** — in the save handlers, early-return with toast if `!node.imgs || node.imgs.length === 0`.

No framework imports needed other than `BRAND` from `../shared/utils.mjs` and `app` from `/scripts/app.js`.

## Data flow

### Workflow execution (preview display)

```
IMAGE tensor in → PixaromaPreview.preview()
  → save PNG to ComfyUI temp/ (PreviewImage technique)
  → return {"ui": {"images": [{"filename":..., "subfolder":"", "type":"temp"}]},
            "result": (image,)}
  → frontend: ComfyUI core auto-renders image in node body
  → downstream IMAGE edge (connected): receives tensor via "result"
  → downstream IMAGE edge (unconnected): silent — core handles, no error
```

### Save to Output button

```
JS: read latest preview blob from node.imgs[0] via /view endpoint
  → app.graphToPrompt() → { workflow, prompt }
  → fetch('/pixaroma/api/preview/save', POST, {
       image_b64, filename_prefix, workflow, prompt })
  → Python: decode → _embed_workflow_metadata → PngInfo
  → folder_paths.get_save_image_path(prefix, output_dir) → (folder, name, counter, …)
  → PIL save to output/<prefix>_00001_.png with pnginfo
  → return { filename, subfolder }
JS: toast "Saved: Preview_00001_.png"
```

### Save to Disk button

```
JS: read latest preview blob from node.imgs[0]
  → app.graphToPrompt() → { workflow, prompt }
  → fetch('/pixaroma/api/preview/prepare', POST, { image_b64, workflow, prompt })
  → Python: decode → _embed_workflow_metadata → PIL save to in-memory buffer
  → return PNG bytes
JS: if window.showSaveFilePicker exists:           # Chrome/Edge/Opera
       user picks folder+name → write blob to handle
     else:                                         # Firefox, Safari <15.1
       create <a href=blob: download=<suggestedName>> → click()
       toast: "Saved to Downloads (browser doesn't support folder picker)"
```

## Error handling

### Input / output edges

- **Input `image` unconnected** → ComfyUI core raises "Required input missing" at execute time. Expected. No custom handling — a preview node cannot preview nothing.
- **Output `image` unconnected** → ComfyUI core handles silently. User terminates at Preview Pixaroma or chains forward; both work with no additional code.

### Save-to-Output failures

- **No preview yet (user clicked before running)** → JS guard: `if (!node.imgs?.length)` → toast "Run the workflow first". Matches the pattern used by Image Compare for its un-populated state.
- **Disk full / permission denied** → backend returns HTTP 500 + `{ error: "<reason>" }`. JS shows toast "Save failed: <reason>".
- **Filename collision** → impossible. `folder_paths.get_save_image_path` handles counter atomically via filesystem probe.
- **Invalid filename_prefix** (user typed unsafe chars) → backend returns HTTP 400. JS shows toast with the validation message. Widget allows any typed characters; server is the validation boundary (consistent with existing Pixaroma routes).

### Save-to-Disk failures

- **`window.showSaveFilePicker` unsupported** (Firefox, Safari <15.1) → silent fallback to `<a download>` → Downloads folder. Brief toast noting the fallback.
- **User cancels picker** → catch `AbortError`, silent no-op. Standard web behavior.
- **Backend `/prepare` fails** → toast "Prepare failed: <reason>". No partial file written (blob is only created after successful response).

### Server-side input validation

- Reuse existing `_safe_path` path-traversal guard from `server_routes.py`.
- `filename_prefix` validated against `^[A-Za-z0-9_\-]{1,64}$` (same regex as existing Pixaroma routes).
- Base64 payload size capped at 50 MB (existing pattern).
- Reject non-PNG data URIs with HTTP 400.

## Testing & verification

No automated tests — the repo has no test harness (CLAUDE.md confirms). Verification is manual, done in ComfyUI with the dev server running.

### Golden path

1. Load ComfyUI → node appears in menu under **👑 Pixaroma → Utils** as "Preview Pixaroma".
2. Drag node onto canvas → connect an image source (e.g. `Load Image`) → queue workflow → preview thumbnail renders in node body, both orange buttons become active.
3. Click **Save to Output** → `ComfyUI/output/Preview_00001_.png` created. Second click → `Preview_00002_.png`.
4. Edit `filename_prefix` widget to `Test` → save → `Test_00001_.png` created.
5. Click **Save to Disk** (Chrome/Edge) → native save dialog opens → pick any folder → file written with metadata.
6. Drag a saved PNG back onto ComfyUI canvas → workflow restores from embedded metadata.

### Edge cases

7. Output socket **unconnected** → workflow still runs end-to-end without error.
8. Output socket **connected** to another node (including another Preview Pixaroma) → image passes through correctly.
9. Click Save buttons **before running** workflow → toast "Run the workflow first", no crash, no network call.
10. Cancel the Save-to-Disk picker mid-flow → silent no-op, no toast, no broken state, subsequent saves still work.
11. Firefox: Save-to-Disk triggers download to Downloads folder + toast noting the fallback.
12. Resize the node → buttons reposition cleanly, preview scales.
13. Save with `filename_prefix` containing unsafe chars (e.g. `../evil`) → backend rejects with 400, JS toasts the validation error, no file written.

### Vue-frontend verification

14. Confirm `onDrawForeground` fires for the Preview node on the Vue frontend. If not, swap to `setInterval` + `setDirtyCanvas(true, true)` while node is in view. Test on latest ComfyUI release.

## Non-goals (explicitly out of scope for v1)

- **Batch save** — if the IMAGE tensor has batch > 1, save only the first frame. Matches Image Compare's handling. Can revisit.
- **JPG / WebP** — PNG only. Reopen if users ask for lossy output with embedded metadata (tricky; JPG has no tEXt chunks, would need EXIF UserComment).
- **Automated tests** — follow the repo's manual-verification convention.
- **Preview-in-node zoom / pan** — standard ComfyUI preview only. Compare already covers the zoomed side-by-side case.
- **Settings integration** — no ComfyUI settings panel entries in v1. The `filename_prefix` widget is sufficient for naming control.

## Implementation order (preview; full plan comes next)

1. Python node + `__init__.py` registration — verify the node appears in the menu and passes image through.
2. Backend routes + shared metadata helper in `server_routes.py` — curl-test them first with a small fixture PNG.
3. JS preview file — orange buttons, hit-test, Save-to-Output wired first, then Save-to-Disk.
4. Manual QA pass through all 14 test cases.
5. Local commit on `Ioan` per CLAUDE.md Git Workflow (single commit or split by layer — the writing-plans skill will decide).

## Open questions (none remain after brainstorm)

All product decisions confirmed:
- Preview rendered in node body (A)
- User-editable `filename_prefix` widget, default `Preview`, counter appended (B)
- PNG-only output (A)
- Workflow + prompt metadata embedded in saved PNGs (A)
- Canvas-drawn buttons, mirroring Image Compare (A)
- `/prepare` route for Save-to-Disk metadata embedding (recommended, accepted)
