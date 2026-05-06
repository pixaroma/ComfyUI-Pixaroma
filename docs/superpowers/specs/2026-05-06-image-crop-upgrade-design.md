# Image Crop Pixaroma — bug fix + on-node panel

**Date:** 2026-05-06
**Status:** Design approved, plan pending

## Summary

Two changes to Image Crop Pixaroma:

1. **Bug fix.** The editor opens empty (and the mini-preview stays blank) when the upstream is anything other than LoadImage — VAE Decode being the canonical case. Root cause: the JS upstream-URL resolver only knows two sources (LoadImage's filename widget, or `srcNode.imgs` cached post-execution), and VAE Decode populates neither.
2. **On-node panel.** Add a compact custom DOM widget above the mini-preview that exposes Width, Height, Ratio, Center, and a collapsible X/Y so users can tweak the crop without opening the full editor.

Existing behavior for LoadImage chains stays unchanged. Existing saved workflows keep working — no migration.

## Goals

- Editor and mini-preview show the live upstream image for any IMAGE source (VAE Decode, ImageScale, anything that produces an IMAGE tensor) — not only LoadImage.
- Quick numeric crop tweaks directly on the node body, mirroring the editor's W/H/X/Y values.
- Behavior parity between the on-node panel and the editor for size changes (both center-preserving).
- Persistence across Vue workflow tab switches via `node.properties` (Vue Compat patterns #4/#11).

## Non-goals

- Pre-execution preview for non-LoadImage chains. VAE Decode's output literally does not exist before the first run; the editor will show a hint message until then.
- Pixel-snap on the node panel (it stays editor-only — most users only set it once).
- Migration to the Resolution Pixaroma "hidden input + properties + graphToPrompt" persistence pattern. The existing `cropJson` hidden STRING widget is kept as the single source of truth.

## Architecture

Files affected:

| File | Change |
|---|---|
| `nodes/node_crop.py` | `load_crop()` saves the input tensor to `temp/` and returns it via a `pixaroma_crop_source` UI key. |
| `js/crop/index.js` | Subscribe to `executed` event; cache source URL on `node._pixaromaCropSourceURL` + `node.properties.pixaromaCropSourceURL`; update `getUpstreamImageURL` priority order; mount new panel before the existing CropWidget DOM widget. |
| `js/crop/panel.mjs` (NEW) | Custom DOM widget — W/H/Ratio/Center/(X,Y) controls, ~150 lines. |

No changes to:
- `server_routes.py` — temp PNGs are served by ComfyUI's existing `/view?type=temp` endpoint.
- `js/crop/interaction.mjs`, `render.mjs` — interaction / drawing logic untouched.
- The `cropJson` schema — same fields, no migration.

`js/crop/core.mjs` gets one small tweak only — adding a "Run workflow once to capture upstream" line to the editor's help text for the empty-canvas state. No structural change.

## 1. Bug fix — capture upstream image on execute

### Python side

`load_crop()` in `nodes/node_crop.py`:

1. When `upstream` is a tensor, write the **input** tensor (not the cropped output) to `temp/` as a UUID-named PNG (`pixaroma_crop_src_<uuid>.png`). Use ComfyUI's `folder_paths.get_temp_directory()`. Convert tensor → uint8 NHWC → PIL Image → `Image.save(path, "PNG")`.
2. Return shape changes from `return (cropped, w, h)` to:
   ```python
   return {
       "ui": {"pixaroma_crop_source": [{"filename": fname, "subfolder": "", "type": "temp"}]},
       "result": (cropped, w, h),
   }
   ```
   ComfyUI accepts this dict form for `OUTPUT_NODE = True` nodes (Save Mp4 + Preview Image Pixaroma both use it).
3. Skip the temp save if `upstream` is None (disk-composite fallback path) or if writing fails — the bug fix is best-effort, never a hard failure that breaks the workflow.

### JS side — `js/crop/index.js`

1. Inside `nodeCreated(node)`, add an `executed` listener:
   ```js
   const onExec = (event) => {
     const detail = event?.detail;
     if (!detail?.output) return;
     // Cross-version node-id resolution (Save Mp4 / Preview Image Pixaroma pattern):
     // Vue passes detail.node as a string, legacy as a number.
     const matched = app.graph.getNodeById(detail.node)
                  || app.graph.getNodeById(parseInt(detail.node, 10));
     if (matched !== node) return;
     const frames = detail.output.pixaroma_crop_source;
     if (!frames?.length) return;
     const f = frames[0];
     const url = `/view?filename=${encodeURIComponent(f.filename)}` +
                 `&subfolder=${encodeURIComponent(f.subfolder || "")}` +
                 `&type=${encodeURIComponent(f.type || "temp")}` +
                 `&t=${Date.now()}`;
     node._pixaromaCropSourceURL = url;
     node.properties.pixaromaCropSourceURL = url;
     rebuildPreviewFromUpstream();
   };
   api.addEventListener("executed", onExec);
   ```
   Detach in `node.onRemoved` (alongside the existing `execution_start` / `executing` cleanup).

2. Update `getUpstreamImageURL(node)` priority order:
   - **(1) Cached source URL** (`node._pixaromaCropSourceURL`) — works for any upstream after one workflow run.
   - **(2) LoadImage's filename widget** — covers pre-execution case for direct file inputs.
   - **(3) `srcNode.imgs` walk** — existing post-execution fallback for nodes that publish `imgs` (PreviewImage etc.).

3. Update `getUpstreamSnapshot(node)` so a cached URL contributes a stable token; this prevents the polling loop from oscillating between cached-URL and link-fingerprint snapshots.

4. **Cache invalidation:**
   - `onConnectionsChange` for the IMAGE input → clear `node._pixaromaCropSourceURL` and `node.properties.pixaromaCropSourceURL`.
   - On `onConfigure` and the `nodeCreated` queueMicrotask, restore the URL from `node.properties.pixaromaCropSourceURL` (Vue Compat #11).

5. **Editor empty-state hint** (small `js/crop/core.mjs` tweak): when `_buildUI` runs and no source URL was passed in, the help text gains a one-line note: "Wire an IMAGE input and run the workflow once to capture upstream images." LoadImage chains hit the existing path before this matters.

## 2. On-node panel

### Mount

Inside `nodeCreated(node)` in `js/crop/index.js`, mount order (LiteGraph renders top-down in addition order):

1. `image` input slot (existing)
2. Output slots (existing — `image` / `width` / `height`)
3. `Open Crop` button (existing)
4. **Crop panel DOM widget** (NEW)
5. **CropWidget mini-preview** (existing, last)

### DOM (in `js/crop/panel.mjs`)

```
┌──────────────────┬───┬──────────────────┐
│ W: [   512   ]   │ × │ H: [   512   ]   │
├──────────────────┴───┴──────────────────┤
│ [ Free          ▾ ]  [ ⊕ Center      ]  │
├─────────────────────────────────────────┤
│ ▸ position (X, Y)            (collapsed)│
│   X: [   0   ]    Y: [   0   ]          │   ← shown when expanded
└─────────────────────────────────────────┘
```

Inputs are bare `<input type="number">` styled to match the dark-bg theme used elsewhere in Pixaroma. Ratio is a `<select>`. Center is a `<button>`. Caret/triangle on the position row toggles the expanded state.

`createCropPanel({ getCropJson, setCropJson, getImageDims, onChange, getExpanded, setExpanded })` returns `{ el, refresh() }`.

### State model — single source of truth is `cropJson`

- **Panel reads cropJson** on every `refresh()` and fills the inputs. Pre-fill priority: (1) values from cropJson if `crop_w` is set; (2) full-image defaults from `getImageDims()` if mini-preview has loaded (W = imgW, H = imgH, X = Y = 0); (3) 1024×1024 fallback.
- **Panel writes cropJson** on every input commit (blur or Enter, plus debounced live updates while typing): parse current cropJson → mutate the relevant field(s) → also stamp `original_w`/`original_h` from `getImageDims()` so Python's proportional-rescaling logic stays correct under future upstream dim changes → `JSON.stringify` back via `setCropJson`. Then call `onChange()` which triggers `rebuildPreviewFromUpstream()`.
- **Validation/clamping** (applied on commit):
  - W, H ≥ 1, ≤ image dims (if known).
  - X ≥ 0, X + W ≤ image width. Same for Y/H.
  - If `ratio_idx` ≠ 0 (not Free): H locked to `round(W / ratio)`. Typing W drives H; typing H drives W (matches editor's `_computeWH` / `_computeWHfromH`).
  - Center button: `X = round((imgW - W) / 2)`, `Y = round((imgH - H) / 2)`. Then clamp.

### Cross-side sync

| Event | What happens |
|---|---|
| Editor saves | `onSave` writes cropJson + dataURL to mini-preview. **Add:** call `panel.refresh()` so the panel reflects the editor's saved values. |
| Panel commits a value (editor closed) | cropJson updated. `rebuildPreviewFromUpstream()` re-renders the mini-preview. Next editor open reads cropJson and shows the new values. |
| Panel commits while editor open | Editor stays on its pre-edit values until next save. **Last-write-wins** — explicit limitation, no live editor sync for v1. |
| Tab switch | `onConfigure` re-reads everything; `panel.refresh()` is called from the existing `_pixaromaCropRefresh` hook. X/Y collapsed/expanded state restored from `node.properties.pixaromaCropPanelExpanded`. |
| Mini-preview rebuild | The cached `HTMLImageElement` is held by `rebuildPreviewFromUpstream`'s closure; expose its dims to the panel via `getImageDims()` (returns `{ w, h }` or `null` if no image loaded). |

## 3. Persistence schema

`node.properties` keys (LiteGraph serializes these natively):

| Key | Purpose |
|---|---|
| `pixaromaCropSourceURL` | Cached `/view?type=temp&...` URL from the last execution. Restored on tab switch. |
| `pixaromaCropPanelExpanded` | Boolean — whether the X/Y row is expanded. |

`cropJson` (existing hidden STRING widget value, JSON-serialized) — fields used by panel: `crop_x`, `crop_y`, `crop_w`, `crop_h`, `ratio_idx`, `original_w`, `original_h`. No new fields.

## 4. Edge cases

| Scenario | Behavior |
|---|---|
| No upstream wired | Panel shows last-saved values from cropJson, or 1024×1024 defaults. Editing is allowed but doesn't update mini-preview (no source). |
| Upstream wired (non-LoadImage), no run yet | Panel shows defaults. Mini-preview stays as the placeholder. Editor shows the existing empty state + the new "Run workflow once…" hint. |
| Upstream wired (LoadImage), no run yet | Existing behavior — file URL is available immediately, mini-preview rebuilds, editor opens with the image. |
| Upstream tensor dimensions change between runs | Python's existing proportional rescale (`if orig_w > 0 and orig_h > 0 and (orig_w != w or orig_h != h)`) handles the rect; panel re-reads cropJson on next mini-preview rebuild. |
| Upstream wire reconnected to a different node | `onConnectionsChange` clears the cached source URL; next run re-captures. |
| Workflow restore (close + reopen ComfyUI tab) | `pixaromaCropSourceURL` restored from `node.properties` → mini-preview rebuilds → panel refreshes. |
| Disk-composite fallback path (no upstream wire, only saved cropped composite) | Unchanged — Python's `_load_disk_composite` still runs; no temp-PNG emission since `upstream` is None. |

## 5. Testing

No automated test suite in this project — manual QA against these scenarios:

1. **Regression — LoadImage chain**: editor opens with the image, mini-preview rebuilds, save round-trips correctly. (No change expected.)
2. **Bug fix — VAE Decode chain**: load workflow with VAE Decode → Crop → Save Image. Run workflow. Click Open Crop → editor shows the full generated image. Make a crop, save, re-run → output is correctly cropped.
3. **Bug fix — pre-execution VAE Decode chain**: open a fresh workflow with VAE Decode → Crop, click Open Crop *before* running. Editor shows the empty state with the "Run workflow once…" hint. Run the workflow. Click Open Crop again. Editor now shows the image.
4. **Panel — W/H edit**: edit W on the panel. Mini-preview updates within ~50 ms. cropJson reflects the new value. Open editor → editor shows the same W.
5. **Panel — ratio lock**: select 16:9 from the ratio combo. Type W = 1280. H clamps to 720. Type H = 600. W clamps to ~1067.
6. **Panel — Center button**: with a 800×600 crop on a 1024×1024 image, click Center. X jumps to 112, Y to 212. Mini-preview reflects.
7. **Panel — X/Y collapse**: click the position row. X/Y inputs appear. Switch workflow tab and back. Expanded state persists.
8. **Sync — editor save**: open editor, drag crop, save. Panel reflects the new W/H/X/Y.
9. **Reconnect**: disconnect VAE Decode wire, connect a different image source, run. Mini-preview shows the new source.
10. **Workflow restore**: close and reopen the ComfyUI tab on a workflow that had previously executed. Mini-preview comes back with the cached image; panel shows correct values.

## Risks and open questions

- **Ratio combo on the node** — the editor uses `RATIOS` from `js/crop/core.mjs`. Both panel and editor must stay in sync if that list ever changes. Plan mitigation: import `RATIOS` from a single shared module (already lives in `core.mjs`; panel imports from there).
- **Performance — debounce on typing**: live preview rebuild on every keystroke could feel janky. Mitigation: debounce panel commits at ~150 ms while typing; commit immediately on blur or Enter.
- **Editor open + panel edit race** — accepted limitation, last-write-wins. Documented in the spec; if it bites in practice we revisit.
