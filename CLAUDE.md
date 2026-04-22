# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
ComfyUI-Pixaroma is a custom node plugin for ComfyUI that adds interactive visual editors (3D Builder, Paint Studio, Image Composer, Image Crop, Note Pixaroma — a rich-text annotation node) directly inside ComfyUI workflows. It has zero core dependencies — PIL and PyTorch come from ComfyUI's environment.

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
| `/pixaroma/api/note/check_folder` | (dead — kept only for back-compat; no JS caller) |
| `/pixaroma/api/note/open_folder` | (dead — kept only for back-compat; no JS caller) |

The two `note/*_folder` routes are leftover from an earlier iteration where the Note Pixaroma Download pill would open the target ComfyUI folder in the OS file explorer. Design changed to "folder path is purely informational text under the pill" — the JS no longer fetches these routes. Safe to delete after confirming no workflow depends on them.

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
├── note/               # Note Pixaroma (NoteEditor class, mixin pattern)
│   ├── index.js        # Entry: node lifecycle, DEFAULT_CFG, parseCfg, onConfigure/onResize
│   ├── core.mjs        # Class shell: open/close, save, undo history, Ctrl+Z neutering,
│   │                   #  code/preview view toggle, _applyEditAreaBg, _normalizeEditArea
│   ├── toolbar.mjs     # _buildToolbar: bold/italic/headings/colour pickers/link/code/HR/
│   │                   #  Button Design/YT/Discord entries, undo/redo, view toggle, SWATCHES,
│   │                   #  _promptLinkUrl + _promptCodeBlock themed modals
│   ├── blocks.mjs      # Button Design rich dialog (icon picker, live preview, toggles),
│   │                   #  YouTube + Discord generic block dialogs, validateUrl helper,
│   │                   #  renderButtonHTML, insertAtSavedRange, saveRange/restoreRange
│   ├── render.mjs      # createNoteDOMWidget, renderContent, attachEditButton,
│   │                   #  attachCanvasClickDelegation, injectCopyButtons (for <pre>)
│   ├── sanitize.mjs    # Allowlist-based HTML sanitizer (tags, attrs, classes, styles, href)
│   └── css.mjs         # injectCSS — all note styles (overlay, editarea, pills, toggles)
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

6. **Ctrl+Z escapes editor overlays to the graph** — The Vue frontend's undo is driven by `changeTracker.undo` (in the workflow store), which calls `app.loadGraphData` → `graph.configure` → `graph.clear`. `window.addEventListener("keydown", fn, true)` + `stopImmediatePropagation` does NOT preempt it because `changeTracker.undo` is scheduled via `requestAnimationFrame` from a different code path, and patching `app.graph.undo` / `Comfy.Undo` command doesn't cover it either. The only reliable block is patching the bottleneck functions while the editor is open, then restoring them on cleanup:
   ```js
   this._savedLoadGraphData = app.loadGraphData.bind(app);
   app.loadGraphData = () => Promise.resolve();
   this._savedGraphConfigure = app.graph.configure.bind(app.graph);
   app.graph.configure = () => {};
   // On cleanup: app.loadGraphData = this._savedLoadGraphData; etc.
   ```
   See `js/note/core.mjs` for the full pattern (also neuters `graph.undo/redo`, `Comfy.Undo`/`Comfy.Redo` commands, plus a `node.onRemoved` resurrection-close safety net). Always debug this class of bug with a stack trace from `onRemoved` — it will show you the exact path that needs wrapping.

7. **`installFocusTrap` and contenteditable don't mix** — Paint/Composer/3D call `installFocusTrap(overlay)` so their hidden textarea absorbs focus for keyboard-shortcut isolation. For rich-text editors that use a contenteditable (Note Pixaroma), do NOT call `installFocusTrap`: its `mouseup` handler refocuses the hidden textarea whenever the event target isn't INPUT/TEXTAREA/SELECT, which steals focus on every toolbar-button click (user has to re-click into the editor to type) and wipes the text selection when a drag-select ends outside the panel. Use the `loadGraphData` / `graph.configure` neutering pattern from point 6 instead.

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

### Note Pixaroma Patterns (do not regress)

These patterns were hard-won during Note Pixaroma development. Regressing any of them reintroduces specific bugs, some silent.

1. **Sanitizer must UNWRAP on invalid href, not remove** — in `sanitize.mjs` `filterElement`, when `filterHref` returns null the old code called `el.remove()` which deleted the `<a>` *and* its child text. Users lost their typed content silently on save whenever a link had a bad URL (e.g. dialog default `https://` with no host). Unwrap the anchor instead, keep the inner text, recurse into children. Same policy as for unknown wrapper tags.

2. **URL validation must fully parse, not just regex** — `/^https?:\/\//i.test(url)` accepts `"https://"` with no hostname. Use `new URL(url)` + `u.hostname` check so the dialog rejects what the sanitizer would later throw on. Shared `validateUrl()` in `blocks.mjs` returns `{ ok, message }` and is used by Button Design / YouTube / Discord; the link dialog in `toolbar.mjs` has the equivalent inline check.

3. **Python widget default MUST stay in sync with JS DEFAULT_CFG** — `nodes/node_note.py` ships a JSON string `default` for the `note_json` widget. ComfyUI pre-fills this into the widget value BEFORE `nodeCreated` fires, so `parseCfg` merges it on top of the JS defaults and whatever the Python string contains wins. `backgroundColor` and `accentColor` must match between the two files. `parseCfg` also contains a migration that strips the old `backgroundColor:"transparent"` default when content is empty, so users who haven't restarted ComfyUI still get the current default.

4. **Bg picker is a THREE-state override on node.color + node.bgcolor — do NOT go back to the old always-override flow** — `renderContent(node, bodyEl)` in `render.mjs` must respect `cfg.backgroundColor` having three different meanings, or it will clobber ComfyUI's native right-click Colors menu every time the user saves text edits (the original bug that forced this pattern to exist). States: (a) **undefined / key missing** → user has never touched the Bg picker; renderContent must LEAVE `node.color` / `node.bgcolor` alone so the native picker + LiteGraph theme defaults survive. (b) **null OR `"transparent"`** → user clicked Clear in the Bg picker; renderContent must null out `node.color` / `node.bgcolor` so our override reverts. (c) **hex string** → user picked via Bg picker; `node.bgcolor = hex` and `node.color = darken(hex, 0.3)` — the darkened title-bar color is REQUIRED so the title reads visually distinct against the body (same contrast the native Colors menu produces). `.pix-note-body` stays transparent so the frame color flows through as one surface. `node.setDirtyCanvas(true, true)` forces LiteGraph to repaint immediately. Bg picker Clear sets `cfg.backgroundColor = null`, NOT a hex — that's the signal the user explicitly reverted. `DEFAULT_CFG` in `index.js` omits the key entirely; the widget default JSON in `node_note.py` matches. `parseCfg` migrates legacy `"transparent"` / `"#111111"` values (both old widget defaults) to unset when the note has no content.

5. **Ctrl+Z escape fix — patch `app.loadGraphData` AND `app.graph.configure`** — see Vue Frontend Compatibility point 6 above. Note Pixaroma is the canonical implementation; `core.mjs` `open()` saves the originals and restores in `_cleanup`. Also neuters `graph.undo`/`graph.redo`, `Comfy.Undo`/`Comfy.Redo` commands, and has a `node.onRemoved` resurrection-close safety net. Missing any of these leaves a path that deletes the note while the editor is open.

6. **Do NOT call `installFocusTrap` with a contenteditable editor** — see Vue Frontend Compatibility point 7 above. The focus trap's mouseup handler steals focus and wipes text selection after drag-selects outside the panel.

7. **Inline errors, not `alert()`, inside editor overlays** — `alert()` context-switches out of the editor, loses focus, and some browsers block it from inside modal overlays entirely. Both `makeDialog` and `makeButtonDesignDialog` in `blocks.mjs` have an inline `.pix-note-linkerr` row; callbacks receive a `ctx.showError(msg)` helper and return `false` to keep the dialog open.

8. **Button pill output structure** — `renderButtonHTML(v)` in `blocks.mjs` wraps pill + folder hint in `<span class="pix-note-btnblock">`. Size hint goes *inside* the `<a>` as `<span class="pix-note-btnsize">` so the `::before` middle-dot separator is a CSS pseudo-element (backspace collapses cleanly). Folder hint goes *outside* the `<a>` as a sibling `<span class="pix-note-folderhint">` — it's a separate visual line with a `::before` folder-icon mask. All four classes (`pix-note-btnblock`, `pix-note-btnsize`, `pix-note-folderhint`, `pix-note-dl`/`vp`/`rm`) are allowlisted in `sanitize.mjs`; adding a new pill class requires adding it there.

9. **Block-insert dialogs: capture the range BEFORE the modal opens** — focus moves to the dialog's first input, `window.getSelection()` loses its range. `saveRange(editArea)` snapshots the cloned range; `insertAtSavedRange` restores it and does the `execCommand("insertHTML", ...)`. Without this, Insert appears to do nothing (the HTML is inserted but nowhere visible).

10. **Code block inserts by direct DOM manipulation + captures block refs BEFORE modal** — `execCommand("insertHTML")` after the code modal closes has unreliable range targeting (Chrome's `intersectsNode` sometimes misses the first block after focus changes). In `toolbar.mjs` the code-block handler grabs `startBlock` / `endBlock` element references from the pre-modal selection, replaces them directly with the new `<pre><code>` + trailing `<p>`, and places the caret in the trailing paragraph. Also: `_normalizeEditArea` wraps any loose text-node root children in `<p>` first, otherwise `findTopBlock` returns null for freshly-typed content on a brand-new note.

11. **Manual undo history — browser native undo doesn't cover direct DOM mutations** — `core.mjs` maintains an innerHTML-snapshot stack (`_undo`, `_redo`) with debounced `_snapBefore`/`_snapAfter` wrappers. All direct-DOM operations (code-block insert, clear-format, list unwrap) must bracket themselves with snap calls. Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y keybindings in `_keyBlock` route through `doUndo`/`doRedo`.

12. **Paste strips formatting + prevents ComfyUI image-drop escape** — window-capture `paste` and `drop`/`dragover` handlers in `core.mjs` `open()` intercept images (prevents ComfyUI from spawning a Load Image node on the canvas) and pasted rich HTML (keeps pasted content as plain text). `stopImmediatePropagation` preempts ComfyUI's listeners.

13. **Swatches shared across pickers** — `SWATCHES` array in `toolbar.mjs` feeds A (text), ■ (highlight), Bg (background), Ac (accent) pickers. CSS grid in `css.mjs` is `repeat(7, 18px)`, so the 28 current swatches (4 rows × 7) render cleanly. Adding colours = edit one array; keep row count a multiple of 7.

14. **Page bg default is `#111111` — but only as a CSS-baseline fallback, NOT as a cfg value** — `.pix-note-editarea` in `css.mjs` has `background: #111111` as the rule's baseline, and `_applyEditAreaBg` in `core.mjs` falls back to `#111111` whenever `cfg.backgroundColor` is anything other than a hex (null, undefined, "transparent"). That guarantees the editor body always has a readable dark surface, regardless of what the canvas node looks like. Do NOT reintroduce `#111111` as the literal value of `DEFAULT_CFG.backgroundColor` or as the widget default in `node_note.py` — that was the old pattern and it clobbered the native Colors menu (see Pattern #4). The cfg value for "no override" is explicitly absent (undefined).

15. **Code view uses <pre>-overlay-under-transparent-<textarea>** — `js/note/codeview.mjs` `buildCodeViewDOM` layers a colored `<pre class="pix-note-hl">` (pointer-events: none) under a transparent `<textarea class="pix-note-raw">` that owns the caret + selection. Both MUST share identical font-family, font-size, line-height, padding, white-space, and word-break, or tokens desync from the caret. `.pix-note-raw { color: transparent; caret-color: ${BRAND}; }` hides the native textarea rendering while keeping the caret visible. Live re-tokenize on every `input` event via `renderTokensColored`. Pretty-print (`prettyFormatHTML`) runs **once on entering Code view** only — never on keystroke, because reformatting fights the caret and is widely disliked. Tokenizer output types live in `codeview.mjs` top comment and map to CSS classes `.pix-note-hl .tk-<type>` in `css.mjs`; adding a new token type requires editing both files.

16. **Edit-in-place pencil uses hover delegation with a single reusable floating button** — `js/note/core.mjs` `_installPencil` creates ONE `<button class="pix-note-pencil" contenteditable="false">` attached to the editor's `.pix-note-main` container, not one-per-block. A `mouseover` listener on `_editArea` uses `e.target.closest(PENCIL_BLOCK_SELECTORS)` to find the nearest editable ancestor and repositions the pencil. A 150 ms grace window on `mouseout` (cleared when the cursor enters the pencil itself) lets the user travel from block to pencil without the pencil disappearing. `contenteditable="false"` is critical — without it, typing can land inside the pencil. Show/hide uses a `.visible` class (CSS baseline `pointer-events: none`, `.visible` state adds `pointer-events: auto` + `opacity: 0.95`) rather than `style.display` — so clicks pass through when the pencil is invisible. The selector list `PENCIL_BLOCK_SELECTORS` in core.mjs MUST stay in sync with `_dispatchBlockEdit` in blocks.mjs: add a new editable block type in BOTH places. Replacements bracket with `_snapBefore` / `_snapAfter`. For Button Design, replace only the `<span class="pix-note-btnblock">` — never the trailing `&nbsp;` — or consecutive edits compound whitespace. Validation (via `validateUrl`) returns `false` + `ctx.showError(msg)` to keep the dialog open on bad URL, same pattern as insert flow (pattern #7 above).

17. **Grid (table) insert uses a dedicated toolbar entry, sanitizer allowlist, and a Tab-intercept for cell navigation** — `js/note/blocks.mjs` `renderGridHTML(cols, rows, header)` emits `<table class="pix-note-grid">` with `<br>` in every cell so `contenteditable` has a caret landing point (empty `<td>`s are unclickable in Chrome). `js/note/sanitize.mjs` must allow the five table tags (`table, thead, tbody, tr, th, td`) AND the `pix-note-grid` marker class — any future table variant needs a new allowed marker class. V1 deliberately omits `colspan` / `rowspan`, per-cell alignment, and pencil-edit (tables are edited by typing into cells, not by replacing a block). `js/note/codeview.mjs` `TOP_LEVEL_BLOCK_TAGS` must include `"table"` or the pretty-printer will fold tables into the preceding `<p>` and make Code view unreadable. `js/note/core.mjs` `_keyBlock` intercepts Tab / Shift+Tab inside a `<td>` / `<th>` to move the caret to the next/previous cell (walks `table.querySelectorAll("th, td")` in document order). The intercept calls `e.stopImmediatePropagation()` so ComfyUI's workflow-tab shortcut doesn't fire. The bracket also swallows Tab at the last cell / Shift+Tab at the first cell so the user never accidentally tabs out of the note editor. `renderGridHTML` appends a trailing `<p><br></p>` after the `</table>` so the caret has somewhere to land when the user wants to continue typing below the table.

18. **Btn / Ln color split + toolbar group colocation** — `js/note/toolbar.mjs` exposes two independent color pickers: **Btn** (drives `--pix-note-btn` CSS var; controls Download / View Page / Read More pill backgrounds via CSS rule consolidation) and **Ln** (drives `--pix-note-line`; controls grid cell borders, grid header underline, HR separator, AND folder-hint text under Button Design pills). YouTube pill (`#ff3838`) and Discord pill (`#5865f2`) stay hardcoded (brand recognition). Btn lives in G6 immediately after Button Design; Ln lives in G5 immediately after Grid. The colocation is intentional — pickers sit next to what they drive. Config schema split from single `accentColor` into `buttonColor` + `lineColor`; `parseCfg` back-compat migrates `accentColor` → `buttonColor` (lineColor falls through to DEFAULT_CFG since accentColor wasn't driving any lines historically). Three sync points for the schema change: `js/note/index.js` DEFAULT_CFG, `parseCfg` migration, and `nodes/node_note.py` widget default — miss one and the canvas node renders with defaults out-of-sync with the editor (same risk class as Pattern #3). Both `render.mjs` and `toolbar.mjs` must write BOTH CSS vars (one on the on-canvas body, one on the editor's contenteditable) — see `_editArea.style.setProperty` sites. Adding a new picker? Use the `makeColorPicker` factory in `toolbar.mjs` — it handles swatch refresh + live preview + openColorPop wiring with a single call.

19. **Toolbar mask-icons: two classes, single-layer vs two-layer** — the 8 toolbar SVG icons (link, code, separator, and the 5 color pickers: text, highlight, bg, button, line) render via CSS `mask-image` + `background-color`. Two helper classes in `css.mjs`:
    - `.pix-note-tbtn-maskicon` (single-layer). Uses `background-color: var(--pix-note-tbtn-tint, currentColor)` so the whole SVG tints in one color. Used for plain action buttons (link / code / separator) that stay toolbar-default color.
    - `.pix-note-tbtn-maskicon-multi` (two-layer). Uses `::before` (outline, always `currentColor`) stacked under `::after` (drop, tinted by `var(--pix-note-tbtn-tint, currentColor)`). Used for all 5 color pickers so the outline stays white on the dark toolbar while only the drop follows the picked color. File naming is enforced by CSS: `<name>-outline.svg` + `<name>-drop.svg`. All referenced SVG files MUST be committed (see commit `7cf4ecb` / `4f45436`) — untracked SVGs work locally but break a fresh clone. `pointer-events: none` on both classes keeps clicks flowing to the parent `<button>`.

20. **Color picker icons = last explicit pick, NO selectionchange mirror** — the 5 color pickers set `--pix-note-tbtn-tint` on the button element ONLY when the user picks via the popup (or hits Clear, which `removeProperty`s it so the icon falls back to currentColor). There is NO selectionchange-driven mirror that reads the cursor's context. Every variant tried — `getComputedStyle`, `queryCommandValue`, sticky ancestor-walk on `style.color` — has the same failure mode: `execCommand("foreColor" / "hiliteColor", c)` on a COLLAPSED selection STAGES the color WITHOUT mutating the DOM, so any mirror reading the cursor's current state sees the OLD color and overwrites the just-picked value. The final "sticky" attempt still broke in this scenario: pick orange → type (span has color:orange) → click inside that text → pick white → mirror walks up, finds still-`color:orange` ancestor (execCommand white just staged), overrides the white pick. Matches Notion / Google Docs: icon = most recent pick. The Clear branch of the picker MUST call `removeProperty("--pix-note-tbtn-tint")` (not just clear the applied color), otherwise the icon stays stuck on the previous tint.

21. **Chrome `hiliteColor` on collapsed selection clears staged `foreColor`** — `execCommand("hiliteColor", c)` on a collapsed selection CREATES a `<span style="background-color:...">` in the DOM at the cursor, AND as a side effect clears any previously-staged foreColor. Consequence: user picks text orange → picks highlight green → types → gets WHITE text on green bg (not orange on green). Fix lives in the highlight picker's onPick callback in `toolbar.mjs`: immediately after `execCommand("hiliteColor", ...)`, read `textColorBtn.style.getPropertyValue("--pix-note-tbtn-tint")` and replay `execCommand("foreColor", thatColor)` to restage. Combines cleanly on the next typed character. The reverse direction (foreColor first, no hilite) doesn't need compensation — foreColor on collapsed stages without DOM mutation and doesn't clear hiliteColor staging.

22. **CSS vars on editArea need explicit init after `this._editArea` is assigned** — `_buildToolbar()` runs BEFORE `this._editArea = editArea` in `open()`. The `makeColorPicker` factory's internal `apply()` writes `--pix-note-btn` / `--pix-note-line` via `this._editArea?.style.setProperty(...)` — the optional chain short-circuits at factory construction, so the initial write no-ops. Click-time picker updates still work because editArea is set by then, but on every editor REOPEN the preview falls back to orange (CSS default) even when cfg has saved colors. Fix: `NoteEditor.prototype._applyCfgColorsToEditArea()` in `core.mjs` explicitly writes both CSS vars, called immediately after `this._editArea = editArea`. If a new per-note CSS var is introduced for another picker, wire it into both `makeColorPicker` AND this init helper, or the same class of bug recurs.

23. **`save()` body lookup must be robust against Vue detachment** — Vue can tear down a node's DOM widget while the fullscreen editor overlay is open (Vue-compat #5). Using `this.node._noteBody` directly on save risks writing CSS vars / innerHTML to a stale element that's no longer in the live DOM — canvas-side picker changes (Bg, Btn, Ln) silently fail to reach the visible body. `core.mjs` `save()` does a three-step robust lookup: `this.node._noteBody?.isConnected` → `this.node._noteDOMWrap?.isConnected?.querySelector(".pix-note-body")` → `this.node.widgets?.find(x => x.name === "note_dom")?.element?.querySelector(".pix-note-body")`. Refresh the cached `_noteBody` reference to the live element after finding it so subsequent writes land correctly. Debug tip: a `bodyEl.isConnected` check + `console.log` in `renderContent` is a fast way to confirm the live body is what `save()` hit.

24. **Bold uses `queryCommandState("bold")` — not a B/STRONG tag walk** — a tag walk misses two important cases: (1) cursor inside H1/H2/H3 where the bold rendering comes from CSS `font-weight`, and (2) any point after the user has touched a color picker, because color pickers enable `styleWithCSS=true` globally and `execCommand("bold")` from that point onward produces `<span style="font-weight:bold">` instead of `<b>`. `queryCommandState("bold")` handles all three (B/STRONG, heading default, CSS span) correctly. Users expect the Bold icon to light up inside headings the way Word / Google Docs / Notion do. Italic / Underline / Strikethrough use `queryCmd` already — Bold was the outlier.

25. **Picked text/highlight colors must be restaged on EVERY caret move, not just after block inserts** — Chrome wipes the `execCommand`-staged `foreColor` / `hiliteColor` every time the selection moves, not only on DOM-mutating inserts. Clicking into another table cell, pressing Tab across cells, arrow-keying through blocks, or clicking through any block boundary all drop the stage. Without compensation the user picks orange, clicks elsewhere, types → white text. The durable fix lives in the existing document-level `selectionchange` handler in `toolbar.mjs` (originally added for toolbar active-state refresh) — it now ALSO calls `editor._restageColors?.()` for every collapsed-selection change inside the editArea. `_restageColors()` reads the picker icons' `--pix-note-tbtn-tint` values and replays `hiliteColor` FIRST, `foreColor` SECOND (per Pattern #21). It is GUARDED with `r.collapsed` so drag-selects never accidentally apply the picked color to the user's in-flight range. The two color picker buttons are exposed on the editor instance (`this._textColorBtn`, `this._hiColorBtn`) for the helper. `insertAtSavedRange()` in `blocks.mjs` ALSO calls it right after `execCommand("insertHTML")` as a belt-and-braces — the post-insert caret may not trigger selectionchange if it lands in the same position, so the explicit call guarantees typing immediately after the insert is colored too. Any new block-insert path that does its own DOM manipulation (bypassing `insertAtSavedRange`) should still call `_restageColors()` explicitly after the mutation + caret placement, following the `_insertGridBlock` pattern.

26. **Grid insert bypasses `execCommand("insertHTML")` entirely and manipulates DOM directly** — Chrome's caret placement after block-level insertHTML of a `<table>` is unreliable: the caret often lands inside the last `<td>` instead of the trailing `<p>`, and the table-split leaves the user's surrounding inline formatting in a fragile state. `_insertGridBlock` in `blocks.mjs` mirrors the code-block insert pattern — build the table + trailing `<p><br></p>` in a detached wrapper, insert as a sibling AFTER the anchor block (found via `findTopBlock` walk from the saved range), explicitly position the caret at the start of the trailing `<p>` via `range.selectNodeContents(trailing) + collapse(true)`, then call `_restageColors()` so typing below the grid picks up the staged color. Bracket with `_snapBefore` / `_snapAfter` so the whole insert is one undo step. If you add another block-level insert path (e.g. image, embed), follow THIS pattern — not the `insertHTML` pattern.

27. **Block modals live in `document.body`, not inside the editor panel — overlay close handler must check `hasModal`** — `makeButtonDesignDialog`, `makeGridDialog`, `openColorPop`, and `pix-note-confirm-backdrop` all `appendChild` onto `document.body` (so they can escape `transform` / `overflow` boundaries on the panel). Without compensation, a mousedown outside the dialog but inside the editor backdrop lands on `.pix-note-overlay` and triggers `close()` — popping the unsaved-changes prompt ON TOP of the still-open modal. `core.mjs` overlay mousedown handler runs the same `hasModal` guard as the Escape handler: `document.querySelector(".pix-note-blockdlg, .pix-note-confirm-backdrop, .pix-note-colorpop")`. Adding a new document.body-level modal? Add its selector to BOTH guards (Escape + overlay mousedown) or clicking outside it silently closes the editor.

28. **`<a>` clicks inside the edit area must be `preventDefault`ed** — the browser follows `<a href>` on any click inside a contenteditable, so clicking on an inserted Download / View Page / Read More / YouTube / Discord pill (or any plain link) to reposition the caret instead opens the URL in a new tab. `core.mjs` `open()` installs `editArea.addEventListener("click", fn, true)` using capture-phase + `e.target.closest("a") ? e.preventDefault() : …` so caret positioning works but navigation doesn't fire. Without this, users cannot reliably click into a pill to delete or re-edit it (the pencil handles the re-edit path, but simple caret positioning / backspace-through-pill doesn't work). Do NOT reach for `pointer-events: none` on pills — that also blocks the pencil hover delegation.

29. **Inline icons render via `<span data-ic="<slug>" class="pix-note-ic" style="color:...">` with per-icon mask-image rules dynamically injected at editor open** — icons are a THREE-file contract: `server_routes.py` enumerates `assets/icons/note/*.svg` and returns `{id, label, url}` via `/pixaroma/api/note/icons/list`; `js/note/icons.mjs` caches the list at module scope and injects one `.pix-note-ic[data-ic="<id>"] { mask-image: url(...) }` rule per icon into a single `<style id="pix-note-icon-css">` at `<head>`; `js/note/sanitize.mjs` allows `pix-note-ic` class + `data-ic` attribute validated against `/^[A-Za-z0-9_-]{1,64}$/`. Any of those three going out of sync with the others breaks the feature silently. Slug case is preserved (CLIP / GGUF / LORA / VAE are intentional acronym filenames). Missing per-icon rule renders the span as a solid 1.2em colored rectangle — deliberately visible so the user notices a broken icon rather than an invisible gap. Color defaults to `#f66744`, lives as inline `style="color:..."`, is recolored by the existing text-color picker via standard `execCommand("foreColor")`. No pencil — delete + re-insert. The picker popup (`.pix-note-iconpop`) must be registered in BOTH `hasModal` selectors in `core.mjs` (Escape handler AND overlay mousedown) per Pattern #27, or clicking outside the popup silently closes the editor. `_insertInlineIcon` in `icons.mjs` deliberately bypasses `insertAtSavedRange` (blocks.mjs) to avoid a circular import; it does its own `execCommand("insertHTML")` + `_restageColors()` call so surrounding text color stays sticky (Pattern #25). If you add a NEW inline-marker class (different kind of inline element), follow this pattern: base class for layout + data-attr for identity + dynamically injected per-value CSS rule — NOT one class per variant (unmanageable with drop-and-discover libraries).

### Security Patterns (do not remove)
- `_safe_path()` in `server_routes.py` — validates all file paths stay within `PIXAROMA_INPUT_ROOT`
- IDs validated against `^[a-zA-Z0-9_\-]+$` regex (max 64 chars)
- Base64 payloads capped at 50 MB
- Note sanitizer (`js/note/sanitize.mjs`) — allowlist-based. Anything user-reachable (link insert, code-view HTML edit, paste) must round-trip through `sanitize(html)` before being written to the DOM or saved. Class allowlist covers only Pixaroma-specific classes; style allowlist covers only `color`, `background-color`, `text-align`; href allowlist is `http:`, `https:`, `mailto:`.

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
| Fix / extend Note toolbar (buttons, pickers) | `js/note/toolbar.mjs` |
| Add / change a toolbar mask-icon | `js/note/css.mjs` (`.pix-note-tbtn-maskicon` for single-layer, `.pix-note-tbtn-maskicon-multi` for two-layer color pickers) + SVG files in `assets/icons/ui/` (two-layer icons need `<name>-outline.svg` + `<name>-drop.svg`) + `makeMaskIcon`/`makeMaskIconMulti` call in `toolbar.mjs` |
| Change per-note colour pickers (Btn, Ln, Bg, text, highlight) | `js/note/toolbar.mjs` (`makeColorPicker` factory for Btn/Ln; inline pickers for text / highlight / Bg in G3); `js/note/render.mjs` writes CSS vars on canvas body; `core.mjs` `_applyCfgColorsToEditArea` writes same vars on the editor's contenteditable on each open |
| Fix Note block dialogs (Download/YT/Discord, link, code) | `js/note/blocks.mjs` (+ `_promptLinkUrl`/`_promptCodeBlock` in toolbar.mjs) |
| Change what HTML/attrs/classes are allowed in a note | `js/note/sanitize.mjs` (allowlists) |
| Change how a note renders on canvas or node colour behaviour | `js/note/render.mjs` (`renderContent`) |
| Change Note default colour / size / placeholder | `js/note/index.js` DEFAULT_CFG + `nodes/node_note.py` widget default (keep in sync) |
| Add / manage inline note icons (SVG library) | Drop SVGs into `assets/icons/note/`. Label derivation + list endpoint live in `server_routes.py`'s `/pixaroma/api/note/icons/list` route, mirrored in `js/note/icons.mjs::deriveLabel`. Both must stay in sync if you change the rules. |
| Change inline-icon rendering (size / alignment / color model) | `js/note/css.mjs` base `.pix-note-ic` rule + per-icon rules dynamically injected by `js/note/icons.mjs::injectIconCSS`. Picker popup styles: `.pix-note-iconpop` family in `css.mjs`. |
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

## Git Workflow (Ioan branch)

The user works on the `Ioan` branch. Two commit destinations:

1. **Local commits** — after any non-trivial working change, create a local commit on `Ioan` as a checkpoint. This is the **default** — no confirmation needed, just do it. The user relies on these to roll back if something breaks (`git stash`, `git reset --hard HEAD~1`, or `git checkout <sha>`).

2. **Push to Ioan on GitHub** — only when the user **explicitly** says "push to Ioan", "push to github", "commit to Ioan github", or similar. Never push proactively.

**Pattern:**
- Make the edit → verify it parses / works → `git add -A && git commit -m "scope: description"` LOCAL
- Keep commits small and focused: one coherent change per commit
- Never amend a pushed commit; only amend local-only commits if still WIP
- If work breaks something, the user can roll back to the previous local checkpoint

**Do not** push to origin unless asked. **Do** commit locally after every working change.

## Publishing
CI/CD auto-publishes to the ComfyUI registry when `pyproject.toml` is pushed to `main`. Do not modify `pyproject.toml`, `LICENSE`, or `.clauderules` or `.github/workflows/publish.yml`.
