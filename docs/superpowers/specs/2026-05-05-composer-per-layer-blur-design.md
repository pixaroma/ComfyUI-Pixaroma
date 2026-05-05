# Image Composer — Per-Layer Gaussian Blur

**Status:** Design approved 2026-05-05
**Editor:** Image Composer (`js/composer/`, `nodes/node_composition.py`)

## Goal

Let the user select a layer in Image Composer and apply a Gaussian blur via a slider. The blur is **non-destructive**: it can be raised, lowered, or removed at any time without losing the original layer image. Each layer keeps its own independent blur value. The blur applies in the editor preview, the saved project JSON, the canvas-to-PNG save, and the Python workflow execution.

## Non-goals

- No box blur, motion blur, radial blur, or other blur types — Gaussian only.
- No "Filters" panel framework. This is a single property, not a generalised filter system. (B/C from brainstorm rejected.)
- No blur caching to offscreen canvas. CSS filter is GPU-accelerated and fast enough for live slider drag at typical canvas sizes.
- No "Reset Transform" hook. Blur is a layer property (like opacity), not a transform.

## State

```
layer.blur: number   // 0..100, default 0, integer step
```

- Stored on the in-memory layer object alongside `opacity`, `blendMode`, etc.
- Default is `0` (no blur). Only serialised in project JSON when `> 0` (matches the `blendMode` "non-default-only" pattern).

## Slider range and step

- **Range:** `0` to `100` (pixel radius)
- **Step:** `1` (integer)
- **Numeric input** beside the slider, same row layout as Opacity

50 is already a heavy blur on a 1024² layer. 100 is "shape barely recognisable." Range can be widened later if a use case appears; widening is non-breaking.

## UI placement

- Right sidebar → existing **Transform Properties** panel.
- New row **after Opacity** (last row before the "Reset Transform" button).
- Row layout matches Opacity exactly: `[label] [slider] [number input]`.
- The "Reset Transform" button does **not** clear blur (matches Opacity behaviour).

## The 4 sync points

Per `CLAUDE.md` Image Composer Pattern #1 (per-layer property must travel through all four code paths or it silently reverts on some path):

### 1. In-editor canvas draw — `js/composer/render.mjs`

Inside the existing per-layer `this.ctx.save()` block at line 108, before the `drawImage` calls (both the masked path at line 138 and the unmasked path at line 140):

```js
if (layer.blur > 0) this.ctx.filter = "blur(" + layer.blur + "px)";
// ...existing drawImage(...)
this.ctx.filter = "none";   // explicit reset (defensive — restore() handles it,
                            //   but explicit reset avoids surprises when the
                            //   block is refactored)
```

- Selection rectangle (line 159) is drawn on the **overlay canvas** (`oc`), not `this.ctx` — so the selection box stays sharp regardless of layer blur. No change needed there.

### 2. Project JSON save — `js/composer/interaction.mjs`

In the `saveBtn` click handler, where `layerEntry` is built per layer:

```js
if (layer.blur && layer.blur > 0) layerEntry.blur = layer.blur;
```

Place adjacent to the existing `blendMode` serialisation. Non-default-only — keeps saved JSON tidy and avoids polluting older workflows.

### 3. Python compositor — `nodes/node_composition.py`

Before the existing `_blend_over(...)` call per layer, in the slow path (the path taken when layers have placeholders / rembg / masks):

```python
from PIL import ImageFilter   # add import at top of file if absent

# ... existing per-layer prep ...
blur_radius = layer.get("blur", 0)
if blur_radius > 0:
    layer_pil = layer_pil.filter(ImageFilter.GaussianBlur(radius=blur_radius))
# ... existing _blend_over(...) ...
```

The fast path (no placeholders / rembg / masks) loads the pre-rendered composite PNG that already has blur baked in by the browser canvas — no Python work needed there.

### 4. Client-side mini-preview recomposite — `js/composer/index.js`

In `rebuildPreview` → `drawLayer`, apply the same canvas `ctx.filter` before each layer draw, then reset:

```js
if (layer.blur > 0) ctx.filter = "blur(" + layer.blur + "px)";
// ... existing drawImage(...) for this layer ...
ctx.filter = "none";
```

This recomposite runs ~300 ms after workflow execution on the fast path. Without this, the on-canvas preview briefly flashes from the correct blurred render to a non-blurred recomposite, then never recovers (because the recomposite is what's shown).

## Restore (3 sites — per Image Composer Pattern #3)

`attemptRestore()` in `js/composer/render.mjs` builds layer objects in three places — `isPlaceholder` fast path, `img.onload` success, and `img.onerror` missing-image fallback. Add to all three:

```js
blur: (mLayer.blur || 0),
```

Drop in any one and blur silently disappears for layers that take that code path on restore.

## Active-layer UI sync

`updateActiveLayerUI()` in `js/composer/ui.mjs` must update the blur slider + numeric input when the active layer changes:

```js
core._blurSlider.value = (layer.blur || 0);
core._blurInput.value  = (layer.blur || 0);
```

Without this, the slider's UI value goes stale across layer selection (matches the same risk Pattern #2 describes for blend dropdown).

## Edge cases

- **Layer with eraser mask** — at line 138 of `render.mjs` the masked image is drawn from the helper canvas. The blur filter is set on `this.ctx` before that `drawImage`, so the mask + image blur together. This produces a soft-edge fade, which matches user expectation. Tested mentally: not a regression because mask-path uses the same `this.ctx` as the unmasked path.
- **Placeholder layer** — blur is stored on the placeholder. The browser preview blurs the placeholder visualisation. Python applies blur to whatever upstream image lands at execution time.
- **Save to Disk** — `canvas.toDataURL()` captures filter effects automatically. No code change.
- **Selection box** — drawn on the separate overlay canvas, never blurred. Always sharp regardless of layer blur. (Verified by reading [render.mjs:147–219](js/composer/render.mjs:147) — the overlay block uses `oc.*`, not `this.ctx.*`.)
- **Reset Transform button** — leaves blur untouched (blur is not a transform). Matches Opacity's existing behaviour. To clear blur, drag the slider to 0.
- **Multi-select** — out of scope for v1. The blur slider only edits the *currently active* layer (matches how the Opacity slider behaves today). Future work could extend this.
- **Layer thumbnail in the Layers panel** — out of scope for v1. Thumbnails will continue to show the unblurred image. Adding blur to thumbs would be cosmetic-only and is not requested.

## Performance

CSS canvas filters (`ctx.filter = "blur(Npx)"`) are GPU-accelerated in Chromium and WebKit. Typical cost: <16 ms for blur(50px) on a 1024² layer. Slider drag is direct (no debounce needed) — the existing per-frame render budget handles it. If a future user reports slow drag on very large layers, retrofit Approach C from the brainstorm (offscreen-canvas cache keyed on `(layer.id, blur)`).

PIL `GaussianBlur` is CPU-only and somewhat slow on large layers, but it only runs in the slow Python path (placeholders / rembg / masks). Not a hot loop.

## Test plan

Manual verification in browser after implementation:

1. Add an image layer. Slider goes from 0 to 100. Image blurs smoothly. No visible jank during drag.
2. Switch to a second layer. Its slider position reflects ITS blur, not the previous layer's.
3. Increase blur, decrease blur, set to 0 — image returns to identical original sharpness (non-destructive verified).
4. Save the workflow. Reload it. Each layer's blur is preserved across save/restore.
5. Run the workflow once. The Python output PNG matches the editor preview pixel-for-pixel within the limits of canvas-vs-PIL Gaussian agreement (small differences at radius >50 are acceptable; visual match is the goal).
6. Set blur on a placeholder layer + run workflow with an upstream image — output is blurred.
7. Set blur on a layer with a mask + run workflow — mask edges blur too, no Python crash.
8. Selection box stays sharp at all blur amounts.
9. Save to Disk — exported PNG is blurred.

## Files to touch

| Path | Why |
|------|-----|
| `js/composer/ui.mjs` | Add Blur row to Transform Properties; `updateActiveLayerUI` sync |
| `js/composer/render.mjs` | `ctx.filter` before drawImage; add `blur` to all 3 `attemptRestore` layer-construction sites |
| `js/composer/interaction.mjs` | Serialise `blur` in saveBtn handler |
| `js/composer/index.js` | Apply `ctx.filter` in `rebuildPreview → drawLayer` |
| `nodes/node_composition.py` | `ImageFilter.GaussianBlur` per layer in slow path |

5 files. No new files. No new shared dependencies. Aligns with composer's existing per-layer-property pattern (blend mode, opacity).

## Out of scope (deferred)

- Blur in layer-panel thumbnails
- Multi-select blur editing
- Per-axis blur (motion-blur-like)
- Blur on the Layers panel mini-preview
- Box / motion / radial / other blur types
- Filters framework (brightness / contrast / hue, etc.)
