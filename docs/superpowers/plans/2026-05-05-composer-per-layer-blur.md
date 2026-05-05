# Composer Per-Layer Blur — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-destructive per-layer Gaussian blur control to Image Composer — slider in the Transform Properties panel, blur baked into save/restore, the saved PNG, and the Python workflow output.

**Architecture:** Add `layer.blur` (0–100, default 0) to the layer object. Apply via `ctx.filter = "blur(Npx)"` in the in-editor canvas render and the post-execution mini-preview recomposite, and via `PIL.ImageFilter.GaussianBlur` in the Python compositor's slow path. Mirror the 4-sync-point pattern used by `blendMode` (CLAUDE.md Image Composer Pattern #1).

**Tech Stack:** Vanilla JS / ES modules, Canvas 2D API, Python 3 + Pillow, ComfyUI custom node.

**Spec:** [docs/superpowers/specs/2026-05-05-composer-per-layer-blur-design.md](../specs/2026-05-05-composer-per-layer-blur-design.md)

**Important — every JS edit:** This codebase has a known quirk (CLAUDE.md user memory: "Worktree files not served"). After editing in the worktree, copy the modified file to the main project dir at `D:\ComfyTest\ComfyUI-Easy-Install\ComfyUI\custom_nodes\ComfyUI-Pixaroma\` (mirror path) so ComfyUI serves the new code. Each commit step shows the exact `cp` command.

**No test framework:** This project has no automated test suite (CLAUDE.md: "No test suite or linting configuration exists"). Verification is manual in-browser per the spec's test plan, applied in Task 7.

---

## File Structure

| File | Responsibility | Change kind |
|------|---------------|-------------|
| `js/framework/components.mjs` | Shared `createTransformPanel` — gains opt-in `showBlurSlider` + `onBlurChange` config | Modify |
| `js/composer/ui.mjs` | Composer panel wiring — passes `showBlurSlider: true`, caches `blurSlider`/`blurNum`, syncs slider to active layer | Modify |
| `js/composer/render.mjs` | In-editor canvas draw + restore — sets `ctx.filter` per layer, copies `blur` in 3 restore sites | Modify |
| `js/composer/interaction.mjs` | Project JSON save — serialises `blur` non-default-only | Modify |
| `js/composer/index.js` | Mini-preview recomposite — sets `ctx.filter` in `drawLayer` | Modify |
| `nodes/node_composition.py` | Python compositor slow path — applies `ImageFilter.GaussianBlur` before `_blend_over` | Modify |

5 files in the JS plugin, 1 file on the Python side. No new files.

---

## Task 1: Add `showBlurSlider` opt-in to the shared Transform Panel

**Files:**
- Modify: `js/framework/components.mjs:478-486` (insert after the existing Opacity block)

**Why:** `createTransformPanel` is shared by composer / paint / 3d / crop. Adding a non-default-on opt-in keeps every other editor's UI unchanged.

- [ ] **Step 1: Read the current Opacity block to mirror its shape**

Run (review only): `Read js/framework/components.mjs lines 478-486`. The existing pattern is:

```js
if (config.showOpacitySlider !== false) {
  const s = createSliderRow("Opacity", 0, 100, 100, config.onOpacityChange, {
    step: 1,
  });
  sliderWrap.appendChild(s.el);
  sliders.opacitySlider = s.slider;
  sliders.opacityNum = s.numInput;
  sliders.setOpacity = (v) => s.setValue(v);
}
```

- [ ] **Step 2: Insert the Blur block immediately after the Opacity block**

In `js/framework/components.mjs`, after the closing `}` of the Opacity `if` block (currently at line 486) and before `if (sliderWrap.children.length > 0) panel.content.appendChild(sliderWrap);`, insert:

```js
if (config.showBlurSlider === true) {
  const s = createSliderRow("Blur", 0, 100, 0, config.onBlurChange, {
    step: 1,
  });
  sliderWrap.appendChild(s.el);
  sliders.blurSlider = s.slider;
  sliders.blurNum = s.numInput;
  sliders.setBlur = (v) => s.setValue(v);
}
```

Note the gating: `=== true` (default OFF) — opposite of the other sliders which default ON. This keeps every other editor's panel unchanged.

- [ ] **Step 3: Mirror the edit to the main project dir**

```bash
cp "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/.claude/worktrees/silly-tesla-b7c330/js/framework/components.mjs" "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/framework/components.mjs"
```

- [ ] **Step 4: Verify other editors still build their panels (visual sanity)**

Hard-refresh ComfyUI. Open the Paint editor and the 3D editor. Confirm their Transform Properties panels look unchanged (no Blur row appears, since they don't pass `showBlurSlider: true`).

- [ ] **Step 5: Commit**

```bash
git add js/framework/components.mjs
git commit -m "feat(framework): add opt-in Blur slider to createTransformPanel"
```

---

## Task 2: Wire the Blur slider in Composer

**Files:**
- Modify: `js/composer/ui.mjs:754-761` (createTransformPanel config)
- Modify: `js/composer/ui.mjs:783-784` (cache slider refs on `core`)
- Modify: `js/composer/ui.mjs:170-175` (updateActiveLayerUI sync)
- Modify: `js/composer/ui.mjs` (add `onBlurChange` callback alongside `onOpacityChange`)

**Why:** Composer needs to opt into the new framework slider, expose it on `core`, sync it when the active layer changes, and update `layer.blur` on user input.

- [ ] **Step 1: Opt into the Blur slider when constructing the Transform Panel**

In `js/composer/ui.mjs`, find the `createTransformPanel` call at line 754:

```js
const tp = createTransformPanel({
  onReset: () => {},
  showRotateSlider: true,
  showScaleSlider: true,
  showStretchSliders: true,
  showOpacitySlider: true,
  startCollapsed: false,
});
```

Add `showBlurSlider: true` and an `onBlurChange` handler. The handler updates `layer.blur` for every selected layer, redraws, and pushes history (mirrors `onOpacityChange` from line 904-913):

```js
const tp = createTransformPanel({
  onReset: () => {},
  showRotateSlider: true,
  showScaleSlider: true,
  showStretchSliders: true,
  showOpacitySlider: true,
  showBlurSlider: true,
  onBlurChange: (val) => {
    for (const id of core.selectedLayerIds) {
      const layer = core.layers.find((l) => l.id === id);
      if (layer) layer.blur = val;
    }
    core.draw();
    core.pushHistory();
  },
  startCollapsed: false,
});
```

- [ ] **Step 2: Cache the slider refs on `core`**

In the same file, find lines 783-784:

```js
core.opacitySlider = tp.opacitySlider;
core.opacityNum = tp.opacityNum;
```

Add directly after:

```js
core.blurSlider = tp.blurSlider;
core.blurNum = tp.blurNum;
```

- [ ] **Step 3: Sync slider value when active layer changes**

In `js/composer/ui.mjs`, find the existing Opacity sync inside `updateActiveLayerUI` at lines 173-174:

```js
core.opacitySlider.value = Math.round(layer.opacity * 100);
core.opacityNum.value = Math.round(layer.opacity * 100);
```

Add directly after:

```js
core.blurSlider.value = layer.blur || 0;
core.blurNum.value = layer.blur || 0;
```

(No `Math.round` — `layer.blur` is already integer 0–100. No `*100` — opacity stores 0..1 then displays 0..100, but blur stores its display value 0..100 directly.)

- [ ] **Step 4: Mirror the edit to the main project dir**

```bash
cp "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/.claude/worktrees/silly-tesla-b7c330/js/composer/ui.mjs" "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/composer/ui.mjs"
```

- [ ] **Step 5: Smoke check (visual)**

Hard-refresh ComfyUI. Open Image Composer. Confirm: Transform Properties panel now has a Blur row at the bottom (after Opacity). Slider goes 0–100, default 0. Dragging it does nothing visible YET (Task 3 wires the render path) — but the slider/number must move and the active-layer-change syncing must work without console errors.

- [ ] **Step 6: Commit**

```bash
git add js/composer/ui.mjs
git commit -m "feat(composer): add Blur slider to Transform Properties panel"
```

---

## Task 3: Apply blur in the in-editor canvas render

**Files:**
- Modify: `js/composer/render.mjs:117-141` (the per-layer draw block inside the `forEach`)

**Why:** Make the Blur slider actually blur the layer in the editor preview. The selection-box stroke is on a separate overlay canvas (`oc`), unaffected by `this.ctx.filter` — verified by reading [render.mjs:147-219](../../../js/composer/render.mjs).

- [ ] **Step 1: Read the current per-layer draw block**

Lines 117-141 of `js/composer/render.mjs` look like:

```js
this.ctx.save();
this.ctx.scale(layer.flippedX ? -1 : 1, layer.flippedY ? -1 : 1);
// Snap to integer pixels so strokeRect (selection box) and drawImage land on
// the same pixel grid — otherwise sub-pixel anti-aliasing makes the box look
// 1-2px larger than the image on bottom/right edges
const w = Math.round(layer.img.width * layer.scaleX);
const h = Math.round(layer.img.height * layer.scaleY);

// NON-DESTRUCTIVE MASK RENDER
if (layer.hasMask_internal && layer.eraserMaskCanvas_internal) {
  this.renderCanvas.width = layer.img.width;
  this.renderCanvas.height = layer.img.height;
  this.renderCtx.clearRect(
    0,
    0,
    this.renderCanvas.width,
    this.renderCanvas.height,
  );

  this.renderCtx.drawImage(layer.img, 0, 0);
  this.renderCtx.globalCompositeOperation = "destination-out";
  this.renderCtx.drawImage(layer.eraserMaskCanvas_internal, 0, 0);
  this.renderCtx.globalCompositeOperation = "source-over";

  this.ctx.drawImage(this.renderCanvas, -w / 2, -h / 2, w, h);
} else {
  this.ctx.drawImage(layer.img, -w / 2, -h / 2, w, h);
}

this.ctx.restore();
```

- [ ] **Step 2: Set `this.ctx.filter` before the conditional drawImage block, reset after**

Modify the block so the filter is applied for both branches of the `if` (masked and non-masked) — they both call `this.ctx.drawImage`. Replace the masked-render `if/else` block with the same content but bracketed by filter set/reset:

```js
this.ctx.save();
this.ctx.scale(layer.flippedX ? -1 : 1, layer.flippedY ? -1 : 1);
// Snap to integer pixels so strokeRect (selection box) and drawImage land on
// the same pixel grid — otherwise sub-pixel anti-aliasing makes the box look
// 1-2px larger than the image on bottom/right edges
const w = Math.round(layer.img.width * layer.scaleX);
const h = Math.round(layer.img.height * layer.scaleY);

// Per-layer Gaussian blur — non-destructive, applied to the final composited
// (post-mask) result. Selection box stroke is on the overlay canvas (oc),
// so it stays sharp regardless of this filter.
if (layer.blur && layer.blur > 0) {
  this.ctx.filter = "blur(" + layer.blur + "px)";
}

// NON-DESTRUCTIVE MASK RENDER
if (layer.hasMask_internal && layer.eraserMaskCanvas_internal) {
  this.renderCanvas.width = layer.img.width;
  this.renderCanvas.height = layer.img.height;
  this.renderCtx.clearRect(
    0,
    0,
    this.renderCanvas.width,
    this.renderCanvas.height,
  );

  this.renderCtx.drawImage(layer.img, 0, 0);
  this.renderCtx.globalCompositeOperation = "destination-out";
  this.renderCtx.drawImage(layer.eraserMaskCanvas_internal, 0, 0);
  this.renderCtx.globalCompositeOperation = "source-over";

  this.ctx.drawImage(this.renderCanvas, -w / 2, -h / 2, w, h);
} else {
  this.ctx.drawImage(layer.img, -w / 2, -h / 2, w, h);
}

this.ctx.filter = "none";    // explicit reset; restore() also resets, but this
                             //   is defensive in case the block is refactored
this.ctx.restore();
```

- [ ] **Step 3: Mirror the edit to the main project dir**

```bash
cp "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/.claude/worktrees/silly-tesla-b7c330/js/composer/render.mjs" "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/composer/render.mjs"
```

- [ ] **Step 4: Manual verification — slider blurs the active layer**

Hard-refresh ComfyUI. Open Image Composer with at least one image layer. Drag the Blur slider from 0 to 50 — image should blur smoothly. Drag back to 0 — image returns to sharp. Add a second layer; verify each layer keeps its own blur value when you switch the active layer.

Expected: Smooth live blur during drag, no jank at typical canvas size, selection box edges remain sharp.

- [ ] **Step 5: Commit**

```bash
git add js/composer/render.mjs
git commit -m "feat(composer): apply per-layer Gaussian blur in editor canvas render"
```

---

## Task 4: Persist blur — save in project JSON, restore in 3 sites

**Files:**
- Modify: `js/composer/interaction.mjs:686` (saveBtn handler — add blur serialization)
- Modify: `js/composer/render.mjs:303, 336, 377` (attemptRestore — copy `blur` in all 3 layer-construction sites)

**Why:** Per CLAUDE.md Image Composer Pattern #3, `attemptRestore` builds layer objects in three places — `isPlaceholder` fast path, `img.onload` success, `img.onerror` missing-image fallback. Any new field must be copied in all three sites or it silently drops for some layer types on restore.

- [ ] **Step 1: Save — add blur serialization in interaction.mjs**

Find line 686 of `js/composer/interaction.mjs`:

```js
if (layer.blendMode && layer.blendMode !== "Normal") layerEntry.blendMode = layer.blendMode;
```

Add directly after (non-default-only, mirrors the blendMode pattern):

```js
if (layer.blur && layer.blur > 0) layerEntry.blur = layer.blur;
```

- [ ] **Step 2: Restore site 1 — `isPlaceholder` fast path**

In `js/composer/render.mjs`, find the layer object at lines 300-310 (the `isPlaceholder` branch). It currently includes:

```js
opacity: mLayer.opacity,
// ... a few lines ...
blendMode: mLayer.blendMode || "Normal",
```

Add immediately after the `blendMode` line:

```js
blur: mLayer.blur || 0,
```

- [ ] **Step 3: Restore site 2 — `img.onload` success**

Same file, same pattern, around line 336-341. After:

```js
blendMode: mLayer.blendMode || "Normal",
```

Add:

```js
blur: mLayer.blur || 0,
```

- [ ] **Step 4: Restore site 3 — `img.onerror` missing-image fallback**

Same file, same pattern, around line 377-382. After:

```js
blendMode: mLayer.blendMode || "Normal",
```

Add:

```js
blur: mLayer.blur || 0,
```

- [ ] **Step 5: Mirror both files to the main project dir**

```bash
cp "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/.claude/worktrees/silly-tesla-b7c330/js/composer/interaction.mjs" "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/composer/interaction.mjs" && cp "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/.claude/worktrees/silly-tesla-b7c330/js/composer/render.mjs" "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/composer/render.mjs"
```

- [ ] **Step 6: Manual verification — blur survives save/load**

Hard-refresh. Open Image Composer with at least two image layers. Set blur=30 on layer 1, blur=70 on layer 2. Click Save. Close the editor. Reload the workflow (close + reopen the ComfyUI tab, or refresh the page entirely). Reopen the editor.

Expected: Layer 1 still has blur=30 visually + on the slider when selected. Layer 2 still has blur=70.

- [ ] **Step 7: Commit**

```bash
git add js/composer/interaction.mjs js/composer/render.mjs
git commit -m "feat(composer): persist per-layer blur in save/restore"
```

---

## Task 5: Apply blur in the post-execution mini-preview recomposite

**Files:**
- Modify: `js/composer/index.js:283-311` (the `drawLayer` function inside `rebuildPreview`)

**Why:** After workflow execution, the fast path (no placeholders / rembg / masks) runs `rebuildPreview` ~300 ms later, which recomposes the layers client-side and replaces the canvas image. Without blur in this path, the mini preview briefly flashes from the correct blurred render to a non-blurred recomposite, then never recovers (per CLAUDE.md Image Composer Pattern #1).

- [ ] **Step 1: Read the current `drawLayer` function**

Lines 283-311 of `js/composer/index.js`:

```js
function drawLayer(ctx, layer, img, maskImg) {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  const sx = Math.abs(layer.scaleX || 1), sy = Math.abs(layer.scaleY || 1);
  const w = natW * sx, h = natH * sy;

  let src = img;
  if (maskImg) {
    const tc = document.createElement("canvas");
    tc.width = natW; tc.height = natH;
    const tCtx = tc.getContext("2d");
    tCtx.drawImage(img, 0, 0);
    tCtx.globalCompositeOperation = "destination-out";
    tCtx.drawImage(maskImg, 0, 0, natW, natH);
    src = tc;
  }

  const cx = layer.cx ?? docW / 2, cy = layer.cy ?? docH / 2;
  const rot = (layer.rotation || 0) * Math.PI / 180;
  ctx.save();
  ctx.globalAlpha = layer.opacity ?? 1;
  if (layer.blendMode && BLEND_MAP[layer.blendMode])
    ctx.globalCompositeOperation = BLEND_MAP[layer.blendMode];
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.scale(layer.flippedX ? -1 : 1, layer.flippedY ? -1 : 1);
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  ctx.restore();
}
```

- [ ] **Step 2: Set `ctx.filter` before drawImage**

Modify the block: insert the filter line after the existing `if (layer.blendMode...)` block and before the transform calls (so the filter applies to the `drawImage` at the end):

```js
function drawLayer(ctx, layer, img, maskImg) {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  const sx = Math.abs(layer.scaleX || 1), sy = Math.abs(layer.scaleY || 1);
  const w = natW * sx, h = natH * sy;

  let src = img;
  if (maskImg) {
    const tc = document.createElement("canvas");
    tc.width = natW; tc.height = natH;
    const tCtx = tc.getContext("2d");
    tCtx.drawImage(img, 0, 0);
    tCtx.globalCompositeOperation = "destination-out";
    tCtx.drawImage(maskImg, 0, 0, natW, natH);
    src = tc;
  }

  const cx = layer.cx ?? docW / 2, cy = layer.cy ?? docH / 2;
  const rot = (layer.rotation || 0) * Math.PI / 180;
  ctx.save();
  ctx.globalAlpha = layer.opacity ?? 1;
  if (layer.blendMode && BLEND_MAP[layer.blendMode])
    ctx.globalCompositeOperation = BLEND_MAP[layer.blendMode];
  if (layer.blur && layer.blur > 0)
    ctx.filter = "blur(" + layer.blur + "px)";
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.scale(layer.flippedX ? -1 : 1, layer.flippedY ? -1 : 1);
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  ctx.restore();
}
```

(`ctx.restore()` resets `filter` automatically — no explicit reset needed because `ctx.save()` was called at the top of the function.)

- [ ] **Step 3: Mirror the edit to the main project dir**

```bash
cp "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/.claude/worktrees/silly-tesla-b7c330/js/composer/index.js" "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/composer/index.js"
```

- [ ] **Step 4: Manual verification — no flash to non-blurred after execution**

Hard-refresh. Build a simple workflow: Image Composer → Preview Image. In the composer, add an image layer with blur=40, click Save. Close the editor. Run the workflow. Watch the canvas mini-preview on the Composer node ~300 ms after execution.

Expected: The mini-preview shows the blurred composite. No visible flash from blurred to non-blurred. The image stays blurred.

- [ ] **Step 5: Commit**

```bash
git add js/composer/index.js
git commit -m "feat(composer): apply blur in post-execution mini-preview recomposite"
```

---

## Task 6: Apply blur in the Python compositor (slow path)

**Files:**
- Modify: `nodes/node_composition.py:391` area (just before the `_blend_over` call)
- Modify: `nodes/node_composition.py` top-of-file imports (add `ImageFilter` if not already imported)

**Why:** The Python compositor's slow path runs when any layer has placeholders / auto-rembg / eraser masks. Without applying blur here, those layers come out unblurred when the workflow runs.

- [ ] **Step 1: Verify or add the `ImageFilter` import**

Open `nodes/node_composition.py`. Look near the top for an import of `PIL`. If you see `from PIL import Image` or similar, ensure `ImageFilter` is included. The line should look like:

```python
from PIL import Image, ImageFilter
```

If `ImageFilter` is missing from the existing PIL import, add it. If there is no PIL import at all (unlikely), add a new line near the other imports:

```python
from PIL import ImageFilter
```

- [ ] **Step 2: Apply blur to `composed` before the `_blend_over` call**

In `nodes/node_composition.py`, find line 390-391 area:

```python
composed = _apply_layer_transform(layer_img, layer, doc_w, doc_h)
canvas = _blend_over(canvas, composed, layer.get("blendMode", "Normal"))
```

Insert a blur application between these two lines:

```python
composed = _apply_layer_transform(layer_img, layer, doc_w, doc_h)
blur_radius = layer.get("blur", 0)
if blur_radius and blur_radius > 0:
    composed = composed.filter(ImageFilter.GaussianBlur(radius=blur_radius))
canvas = _blend_over(canvas, composed, layer.get("blendMode", "Normal"))
```

Rationale for ordering: blur after transform (so rotation/scale doesn't change the effective blur kernel size) and after mask (so mask edges blur with the layer, matching the JS render path at `js/composer/render.mjs:117-141`). Before `_blend_over` so the blurred result is what gets composited.

- [ ] **Step 3: Mirror the edit to the main project dir**

```bash
cp "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/.claude/worktrees/silly-tesla-b7c330/nodes/node_composition.py" "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/nodes/node_composition.py"
```

- [ ] **Step 4: Restart ComfyUI**

Python node changes do NOT hot-reload. Stop ComfyUI (Ctrl+C in its terminal) and restart it. Verify it starts without import errors. (If you see `ImportError: ImageFilter`, Pillow's namespace is fine — re-check Step 1.)

- [ ] **Step 5: Manual verification — Python output is blurred (slow path)**

Build a workflow that forces the slow path: Image Composer with a placeholder layer (right-click on a layer → Convert to Placeholder, or add a placeholder via the Add Placeholder button). Connect an upstream image to the placeholder. In the composer, set the placeholder layer's blur to 50, click Save.

Run the workflow. Inspect the Composer node's output (connect to a Preview Image node).

Expected: The placeholder layer in the final output is blurred (~50px Gaussian). The mini-preview on the Composer node also shows blur (covered by Task 5).

Also test a layer with an eraser mask: paint with the Composer's eraser, set blur, run. Expected: masked layer has blurred content + blurred mask edges.

- [ ] **Step 6: Commit**

```bash
git add nodes/node_composition.py
git commit -m "feat(composer): apply per-layer Gaussian blur in Python compositor slow path"
```

---

## Task 7: Full manual test pass (per spec test plan)

**Why:** Run through the spec's 9 verification points end-to-end to confirm no regressions and the feature behaves as specified.

- [ ] **Step 1: Hard-refresh the browser, restart ComfyUI**

Confirms a clean state with all changes loaded. Mandatory after Python edits.

- [ ] **Step 2: Smooth slider behaviour**

Open Image Composer. Add an image layer. Drag the Blur slider from 0 to 100 slowly. Image blurs smoothly. No jank at typical canvas sizes (≤2048²). Numeric input mirrors slider value.

- [ ] **Step 3: Per-layer independence**

Add a second layer. Switch to it via the layer panel. Slider snaps to its blur (0 by default). Set it to 60. Switch back to the first layer — its slider snaps back to its previous value. Each layer carries its own blur.

- [ ] **Step 4: Non-destructive (round-trip)**

Set a layer's blur to 80. Drag it back to 0. The image should be **identically sharp** to before — no quality loss, no haze. Confirms the source image is preserved.

- [ ] **Step 5: Save/restore round-trip**

With layers at varying blur (e.g. 0, 40, 90), click Save. Reload the workflow. Each layer's blur value is preserved when the editor reopens.

- [ ] **Step 6: Workflow execution → output PNG**

Connect Composer → Preview Image. Run workflow. The downstream Preview shows the blurred composite. Pixel match between editor and Python output is approximate (canvas-vs-PIL Gaussian agreement is close but not bit-identical) — visual match is the success criterion.

- [ ] **Step 7: Placeholder + blur**

Add a placeholder layer, connect an upstream image, set placeholder blur to 50, run workflow. Output is blurred.

- [ ] **Step 8: Mask + blur**

Add an image layer, use the Composer eraser to mask part of it, set blur to 30, run workflow. The masked region is transparent; the visible region is blurred; mask edges are softened by blur. No Python crash.

- [ ] **Step 9: Selection box stays sharp**

At any blur level (try 100), the orange selection box and corner handles around the active layer remain crisp — they're drawn on the overlay canvas, not subject to the layer's filter.

- [ ] **Step 10: Save to Disk**

In the Composer toolbar, click Save to Disk. The exported PNG is blurred.

- [ ] **Step 11: Reset Transform leaves blur untouched**

Set blur to 50. Click "Reset Transform" in the Transform panel. Rotate / scale / stretch should reset to defaults; blur remains 50. Matches Opacity's behaviour.

- [ ] **Step 12: Older workflow compatibility**

Load a workflow saved BEFORE this feature was added. Each layer should appear with blur=0 (non-destructive default). No errors, no missing-key warnings in the JS console.

- [ ] **Step 13: Final commit if any small fixes were needed**

If any of Steps 2-12 surfaced a regression and you patched it, commit:

```bash
git add -A
git commit -m "fix(composer): blur regression spotted in manual QA"
```

If everything passed cleanly, no commit needed — the per-task commits already capture the work.

---

## Self-Review Notes

**Spec coverage:**
- Slider 0–100, default 0, integer step → Task 1 (framework) + Task 2 (composer wiring)
- Per-layer property `layer.blur` → All tasks
- Live preview with CSS filter → Task 3
- Selection box stays sharp → Task 3 (no overlay change), Task 7 Step 9 (verified)
- Project JSON save (non-default-only) → Task 4 Step 1
- Restore (3 sites) → Task 4 Steps 2-4
- Mini-preview recomposite → Task 5
- Python `ImageFilter.GaussianBlur` → Task 6
- Mask + blur edge case → Task 3 (filter applied to both branches), Task 7 Step 8
- Placeholder + blur → Task 7 Step 7
- "Reset Transform" leaves blur untouched → no code path resets it (matches Opacity); Task 7 Step 11 verifies
- Older workflow compat → Task 7 Step 12 verifies (`mLayer.blur || 0` defaults)
- All 4 sync points hit: Task 3 (in-editor), Task 4 (save), Task 5 (mini-preview), Task 6 (Python). All 3 restore sites hit in Task 4.

**Type consistency:**
- `layer.blur` is a number 0–100 (integer) everywhere — JS uses `> 0` checks, Python uses `layer.get("blur", 0)` and `> 0` check. JSON encodes as plain integer.
- `showBlurSlider` config key matches `showOpacitySlider` naming.
- `blurSlider` / `blurNum` property names match `opacitySlider` / `opacityNum` naming on `core` and `tp`.
- `onBlurChange` callback signature matches `onOpacityChange` (number → void).

**No placeholders:** Every step has actual code, exact paths, exact commands.

**Worktree-mirror reminder:** Each JS task includes the `cp` step before manual verification (per user's saved memory: worktree files aren't served until copied to the main project dir).
