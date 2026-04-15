# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
ComfyUI-Pixaroma is a custom node plugin for ComfyUI that adds interactive visual editors (3D Builder, Paint Studio, Image Composer, Image Crop) directly inside ComfyUI workflows. It has zero core dependencies — PIL and PyTorch come from ComfyUI's environment.

## Development Setup
No build step. Install by placing this folder in `ComfyUI/custom_nodes/`. ComfyUI auto-imports `__init__.py` on startup.
No test suite or linting configuration exists in this project.

## Architecture

### Entry Points
- `__init__.py` — Aggregates all node classes, registers routes, exports `WEB_DIRECTORY = "./js"`
- `server_routes.py` — 9 aiohttp HTTP routes for file I/O and AI features
- `nodes/*.py` — Individual node implementations (one per editor, all under 100 lines)

### Node → ComfyUI Integration
Each node file exports `NODE_CLASS_MAPPINGS` and `NODE_DISPLAY_NAME_MAPPINGS`. `__init__.py` merges them all.

Nodes are `OUTPUT_NODE = True` and receive editor state as a serialized JSON string inside a widget dict (`kwargs.get("SomeWidget")`). They load pre-rendered images from disk (written by the browser) and return PyTorch tensors.

### Frontend → Backend Data Flow
1. User edits in browser (WebGL / Canvas)
2. JS saves result to disk via `POST /pixaroma/api/*/save`
3. On workflow execution, Python node reads the saved file path from widget JSON and loads it as a tensor

### Backend Routes (server_routes.py)
| Route | Purpose |
|-------|---------|
| `/pixaroma/api/layer/upload` | Save paint layers |
| `/pixaroma/api/project/save` | Save composition |
| `/pixaroma/api/paint/save` | Save paint strokes |
| `/pixaroma/api/3d/save` | Save 3D render |
| `/pixaroma/api/3d/bg_upload` | Upload 3D background |
| `/pixaroma/api/crop/save` | Save crop result |
| `/pixaroma/remove_bg` | AI background removal (rembg) |
| `/pixaroma/assets/{filename}` | Serve logo/assets |

### Frontend Directory Structure
The frontend is organized into **directory-per-editor** modules under `js/`. Each directory is self-contained with files split by concern (~300 lines max per file).

**File extension convention:** Only `index.js` files (entry points that call `app.registerExtension`) use the `.js` extension. All other module files use `.mjs`. This is because ComfyUI auto-loads every `*.js` file as a separate extension — using `.mjs` for non-entry modules prevents them from being loaded twice.

```
js/
├── framework/          # Shared UI toolkit (all editors depend on this)
│   ├── index.mjs       # Barrel re-export (import from here)
│   ├── theme.mjs       # CSS injection, brand colors, _uiIcon helper
│   ├── layout.mjs      # createEditorLayout() — fullscreen overlay shell
│   ├── components.mjs  # Buttons, panels, sliders, inputs, tool grids, zoom, transform
│   ├── layers.mjs      # Photoshop-style layer panel with drag reorder
│   └── canvas.mjs      # Canvas settings, frame overlay, toolbar + drag-drop
│
├── shared/             # Shared utilities (constants, node preview, helpers)
│   ├── index.mjs       # Barrel re-export
│   ├── utils.mjs       # BRAND, installFocusTrap, hideJsonWidget, downloadDataURL
│   ├── preview.mjs     # createNodePreview, showNodePreview, restoreNodePreview
│   └── label_css.mjs   # injectLabelCSS() for label editor
│
├── paint/              # Paint Studio (PaintStudio class, mixin pattern)
│   ├── index.js        # Entry: ComfyUI extension registration
│   ├── core.mjs        # Class shell: constructor, open/close, UI building
│   ├── canvas.mjs      # Canvas init, layer CRUD (add/delete/merge/flatten)
│   ├── render.mjs      # Layer rendering with transforms, grid
│   ├── transform.mjs   # Transform handles, hit-test, zoom/pan
│   ├── events.mjs      # Mouse/keyboard event binding & routing
│   ├── tools.mjs       # Brush, pencil, eraser, smudge, fill, pick, shape
│   ├── history.mjs     # Undo/redo snapshots
│   ├── ui.mjs          # Color picker, tool options, layer panel sync
│   ├── engine.mjs      # BrushEngine class, color conversion utils
│   └── api.mjs         # PaintAPI backend calls
│
├── 3d/                 # 3D Builder (Pixaroma3DEditor class, mixin pattern)
│   ├── index.js        # Entry: ComfyUI extension registration
│   ├── core.mjs        # Class shell, UI building, Three.js lazy loading
│   ├── engine.mjs      # Three.js scene/renderer/camera init, animation
│   ├── objects.mjs     # Object CRUD, selection, geometry, materials, layer thumbs
│   ├── shapes.mjs      # Shape registry: id → { icon, label, build, params, defaults, live }
│   ├── shape_params.mjs # Per-object Shape panel (right sidebar) + geometry rebuild
│   ├── composites.mjs  # Multi-mesh Groups (tree, house, flower, …) registry + builders
│   ├── picker.mjs      # "Add 3D Object" modal picker (categorised grid)
│   ├── importer.mjs    # GLB/OBJ lazy loaders + wrapImportPivot + _addImportedGroup
│   ├── interaction.mjs # Tools, camera views, keyboard, undo/redo
│   ├── persistence.mjs # Save/restore scene JSON, background image
│   └── api.mjs         # ThreeDAPI backend calls
│
├── composer/           # Image Composer (PixaromaEditor class, mixin pattern)
│   ├── index.js        # Entry: ComfyUI extension registration
│   ├── core.mjs        # Class shell, state management
│   ├── eraser.mjs      # Eraser mode, mask creation/loading
│   ├── interaction.mjs # Events, alignment, keyboard, transforms
│   ├── render.mjs      # Rendering, history/undo
│   ├── ui.mjs          # Sidebar panel builder
│   ├── layers.mjs      # Layer helper module
│   └── api.mjs         # PixaromaAPI backend calls
│
├── crop/               # Image Crop (CropEditor class, mixin pattern)
│   ├── index.js        # Entry: ComfyUI extension registration
│   ├── core.mjs        # Class shell, UI building
│   ├── interaction.mjs # Mouse/keyboard, crop handle dragging
│   └── render.mjs      # Canvas rendering, aspect ratio logic, save
│
├── label/              # Label Editor (function-based, not a class)
│   ├── index.js        # Entry: ComfyUI extension registration
│   ├── core.mjs        # LabelEditor class, UI building
│   └── render.mjs      # Canvas text rendering, typography helpers
│
├── compare/            # Compare Viewer (single file, 413 lines)
│   └── index.js        # Full compare widget (LiteGraph node drawing)
│
├── showtext/           # Show Text node (single file, 97 lines)
│   └── index.js
│
├── reference/          # Reference node (single file, 140 lines)
    └── index.js
```

### Mixin Pattern (how editor classes are split)
Editor classes (PaintStudio, Pixaroma3DEditor, PixaromaEditor, CropEditor) use a **prototype mixin pattern** to split methods across files:
- `core.mjs` defines the class with constructor and UI building
- Other `.mjs` files add methods: `ClassName.prototype.methodName = function() { ... };`
- `index.js` imports all mixin files as **side-effect imports** before using the class
- All methods use `this` — they have full access to the instance

### Import Conventions
- Editors import framework from `../framework/index.mjs`
- Editors import shared utils from `../shared/index.mjs`
- ComfyUI app is imported as `import { app } from "/scripts/app.js";` (absolute) or relative `../../../../scripts/app.js`
- Only `index.js` entry points use `.js` extension; all other modules use `.mjs`

### Editor Isolation
Each editor directory is a self-contained sub-project. When working on a specific editor, **only read and modify files in that editor's directory** (e.g. `js/paint/*.mjs` and `nodes/node_paint.py`). The only shared dependencies across all editors are `js/framework/` and `js/shared/` — be cautious modifying these as changes affect every editor.

### ComfyUI Vue Frontend Compatibility
ComfyUI's new Vue 3 frontend introduces several behavioral differences from the legacy LiteGraph frontend. These patterns were discovered during debugging and must be followed:

1. **`onDrawForeground` does not fire** — The Vue frontend does not call LiteGraph rendering hooks. Use `setInterval` polling instead for detecting upstream changes (see `js/composer/index.js` for the polling pattern).

2. **Editor overlay removal** — Vue may remove editor overlay elements from the DOM without triggering close callbacks. Always use the `isEditorOpen(node)` pattern that checks `overlay.isConnected` rather than trusting `node._pixaromaEditor` references:
   ```js
   function isEditorOpen(node) {
     if (!node._pixaromaEditor) return false;
     const overlay = node._pixaromaEditor.overlay;
     if (!overlay || !overlay.isConnected) {
       node._pixaromaEditor = null;
       return false;
     }
     return true;
   }
   ```

3. **`graph.links` may be a Map** — In newer ComfyUI versions, `graph.links` can be a `Map` instead of a plain object. Always try both access patterns:
   ```js
   let link = graph.links?.[linkId];
   if (!link && typeof graph.links?.get === "function") link = graph.links.get(linkId);
   ```

4. **Execution detection** — Use ComfyUI API events (`execution_start`, `executing` with `null` detail = finished) imported from `/scripts/api.js`. These are the reliable way to detect workflow execution completion.

5. **DOM widget may be nulled while editor is open** — Vue can tear down a node's DOM widget (added via `node.addDOMWidget`) while the fullscreen editor overlay is still showing. If the editor's `onSave` callback caches a `widget` reference in a closure, that reference becomes null and `widget.value = ...` throws. Guard with null-check + re-lookup from `node.widgets`:
   ```js
   editor.onSave = (jsonStr, dataURL) => {
     sceneJson = jsonStr;
     const w = widget || node.widgets?.find((x) => x.name === "SceneWidget");
     if (w) w.value = { scene_json: jsonStr };
   };
   ```

### ComfyUI Settings Integration
Pixaroma registers user-facing settings in ComfyUI's Settings panel using the `settings` array inside `app.registerExtension()`. Settings appear under the **👑 Pixaroma** category.

**How to add a new setting:**
1. Add a setting object to the `settings` array in the relevant `index.js` entry point:
   ```js
   app.registerExtension({
     name: "Pixaroma.SomeEditor",
     settings: [
       {
         id: "Pixaroma.SomeEditor.SettingName",
         name: "Human-readable label",
         type: "combo",              // types: boolean, combo, slider, number, text, color
         defaultValue: "Option A",
         options: ["Option A", "Option B"],  // combo only
         tooltip: "Shown on hover",
         category: ["👑 Pixaroma", "Sub-category"],
       },
     ],
     // ...
   });
   ```
2. Read the value at runtime: `app.ui.settings.getSettingValue("Pixaroma.SomeEditor.SettingName")`
3. **No custom icons** — categories only support text/emoji, not SVG or images.
4. All Pixaroma settings use the `["👑 Pixaroma", "..."]` category prefix for consistency.

**Current settings:**
| Setting ID | Type | Location | Purpose |
|------------|------|----------|---------|
| `Pixaroma.Compare.DefaultMode` | combo | `js/compare/index.js` | Default view mode for new Compare nodes |

### Transparent Background Save-to-Disk
Paint, Composer, and 3D Builder each have a "Transparent BG (Save to Disk)" checkbox next to their BG color picker. It only affects **Save to Disk** — the workflow "Save" path is untouched so existing workflows stay compatible (Python nodes still output RGB tensors).

- Paint: checkbox is inside `createCanvasToolbar` (`js/framework/canvas.mjs`), state on `this._canvasToolbar.transparentBg`. When saving, `js/paint/ui.mjs` `_save()` builds a second canvas without the `fillRect` for the disk PNG.
- Composer: checkbox in `js/composer/ui.mjs` (Canvas Settings panel), state on `this._transparentBg`. `_drawImpl` in `render.mjs` checks `this._transparentExport` flag to skip bg fill; save handler in `interaction.mjs` toggles the flag and re-renders for the disk PNG.
- 3D Builder: checkbox in `js/3d/core.mjs` (Canvas Settings panel), state on `this._transparentBg`. `persistence.mjs` `_save()` does a second Three.js render with `scene.background = null` + `renderer.setClearColor(0x000000, 0)` (renderer already has `alpha: true`).

### 3D Builder Patterns (do not regress)

These patterns were hard-won during 3D Builder v2 development. Regressing any of them reintroduces specific bugs.

1. **Use `Box3.setFromObject(o, true)` — ALWAYS pass `precise=true`** for drop-to-floor, auto-frame, and any bbox measurement on a rotated object. Without `precise=true`, Three.js returns a LOOSE AABB (8 corners of the local bbox transformed to world) that can be √2× larger along Y than the actual silhouette. That caused drop-to-floor to undershoot and leave rotated objects floating.

2. **Composites must have `skipPivotWrap: true`** — they're built with pivot at the base-center origin already. Re-centering via `wrapImportPivot` drifts the pivot every rebuild when bumps/arms are asymmetric (e.g. tree trunk drifting when bumps change).

3. **Primitive restore must merge `geoParams` over shape defaults** — `{ ...getShapeDefaults(type), ...savedGeoParams }`. Without the merge, v1 saves missing newer params (seed, smoothness, terrain expansion) deserialize with `undefined` and produce NaN geometry. User-saved keys always win. Same pattern for composites with `getCompositeDefaults`.

4. **Composite restore is SYNCHRONOUS** — use the static `import { prepareImportedGroup } from "./importer.mjs"` at the top of `persistence.mjs` and `interaction.mjs`. The old dynamic `import()` + placeholder-sphere-swap pattern produced a visible sphere flicker on every undo/load. Imports/bunnies still use async (they need network fetch), but composites build from code synchronously.

5. **Undo preserves async groups (import/bunny) by id** — `_applySnap` in `interaction.mjs` must match `userData.id` against the target snapshot and REUSE existing imports/bunnies instead of disposing + refetching. Without this, every undo triggers a 2-3s async re-fetch of the GLB/OBJ + textures.

6. **Shape panel sliders debounce on heavy shapes** — entries in `SHAPES` (shapes.mjs) with `live: false` (terrain, blob, rock, teapot) debounce slider rebuilds. Live sliders on 128²-vertex planes were freezing the browser.

7. **Seam welding must be normal-aware** — `weldSeamByPosition(geo, tolerance, normalThreshold)` in shapes.mjs clusters by NORMAL direction, not just position. A naive position-only weld merges cylinder-top corner pairs that should stay as hard edges. Threshold 0.5 preserves hard edges; on-axis clusters (fans) are detected separately and all normals averaged.

8. **Thickness for vessels uses `thickVesselProfile(outer, wall, baseT)`** — takes an outer silhouette array, returns a closed profile with inner wall offset by `wall` and interior floor at `baseT`. Goblet is a special case (solid foot+stem, hollow cup) and writes its own closed profile manually.

9. **Layer thumbnails use a secondary WebGLRenderer** — `_getThumbRenderer()` in `objects.mjs`. Must be disposed with `forceContextLoss()` in `onCleanup` or Chrome caps at ~16 contexts. Cache key includes type + colorHex + geoParams + scale + material mode. Cache invalidated in `_rebuildObjectGeometry` and `_rebuildCompositeGroup`.

10. **Post-processing camera swap** — when `_setPerspective` toggles between perspective and orthographic, it must update `this._renderPass.camera` and `this._outlinePass.renderCamera`. The EffectComposer caches the camera at pass construction and silently renders with the old camera otherwise.

11. **Keyboard shortcuts use `e.code`, not `e.key`** — `Digit1`, `Digit2`, `Numpad1` etc. This is layout-independent. `e.key` depends on the user's keyboard layout and breaks for non-QWERTY users.

### Security Patterns (do not remove)
- `_safe_path()` in `server_routes.py` — validates all file paths stay within `PIXAROMA_INPUT_ROOT`
- IDs validated against `^[a-zA-Z0-9_\-]+$` regex (max 64 chars)
- Base64 payloads capped at 50 MB

## Token-Saving Rules for AI Agents

**IMPORTANT: Follow these rules to minimize token usage and work efficiently.**

### 1. Read only what you need
- **To edit brush tools**: read only `js/paint/tools.mjs` (~250 lines) — NOT the entire paint directory
- **To edit 3D object management**: read only `js/3d/objects.mjs` — NOT `core.mjs` or `engine.mjs`
- **To change UI components**: read only `js/framework/components.mjs` — NOT `theme.mjs` (which is mostly CSS)
- **To fix a save bug**: read only the editor's `persistence.mjs` or `render.mjs` (where `_save` lives)

### 2. Use the file names to find code
Files are named by concern. Match the task to the file:
| Task | Read this file |
|------|---------------|
| Fix brush/drawing | `js/paint/tools.mjs` |
| Fix layer add/delete | `js/paint/canvas.mjs` or `js/composer/layers.mjs` |
| Fix undo/redo | `js/<editor>/history.mjs` |
| Fix keyboard shortcuts | `js/<editor>/events.mjs` or `interaction.mjs` |
| Fix save/load | `js/<editor>/persistence.mjs` or `render.mjs` (for crop/composer) |
| Fix zoom/pan | `js/<editor>/transform.mjs` |
| Change a UI panel | `js/<editor>/core.mjs` (sidebar building) or `ui.mjs` |
| Change shared buttons/sliders | `js/framework/components.mjs` |
| Change canvas frame/toolbar | `js/framework/canvas.mjs` |
| Change layer panel UI | `js/framework/layers.mjs` |
| Add a new primitive 3D shape | `js/3d/shapes.mjs` (one registry entry: icon, label, build, params, defaults) |
| Add a new composite (multi-mesh) 3D shape | `js/3d/composites.mjs` + `js/3d/picker.mjs` SECTIONS |
| Change the per-object Shape panel | `js/3d/shape_params.mjs` |
| Handle GLB/OBJ import behavior | `js/3d/importer.mjs` |
| Add backend route | `server_routes.py` |
| Add a new Python node | `nodes/node_<name>.py` |

### 3. When adding a new method to an editor class
- Add it to the most relevant existing `.mjs` file by concern (tools, events, render, etc.)
- Use the mixin pattern: `ClassName.prototype.newMethod = function() { ... };`
- Do NOT create new files unless the relevant file would exceed ~400 lines
- New module files must use `.mjs` extension (only `index.js` entry points use `.js`)

### 4. When creating a new editor
Follow the existing directory structure:
1. Create `js/<name>/` with `index.js` (entry point, `.js`), `core.mjs`, and concern-based splits (all `.mjs`)
2. Create `nodes/node_<name>.py` with mappings
3. Import and merge in `__init__.py`
4. If it needs backend routes: add to `server_routes.py`
5. Keep every file under ~300 lines

### 5. Do not read framework CSS
`js/framework/theme.mjs` is ~660 lines but ~580 are a CSS string literal. You almost never need to read it. Only read it if you're adding a new CSS class or changing the color theme.

## Important Note
After major changes, please update this file (@CLUADE.me). Keep this file up-to-date with the project's status.

## Publishing
CI/CD auto-publishes to the ComfyUI registry when `pyproject.toml` is pushed to `main`. Do not modify `pyproject.toml`, `LICENSE`, or `.clauderules` or `.github/workflows/publish.yml`.
