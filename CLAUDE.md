# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
ComfyUI-Pixaroma is a custom node plugin for ComfyUI that adds interactive visual editors (3D Builder, Paint Studio, Image Composer, Image Crop, Note Pixaroma - a rich-text annotation node, Preview Image Pixaroma - an in-node image previewer with save-to-disk / save-to-output buttons, Notify Pixaroma - a terminal node that plays a sound from `assets/sounds/` when reached, useful as a workflow-completion alert when working in another window) directly inside ComfyUI workflows. It also includes Align Pixaroma, a toggleable canvas-wide smart-snap and alignment-guide system (no nodes added; patches `LGraphCanvas` so any node drag/resize snaps to nearby edges and centers with orange guide lines). It has zero core dependencies — PIL and PyTorch come from ComfyUI's environment. All nodes share the `👑 Pixaroma` menu category.

## Development Setup
No build step. Install by placing this folder in `ComfyUI/custom_nodes/`. ComfyUI auto-imports `__init__.py` on startup.
No test suite or linting configuration exists in this project.

## Architecture

### Entry Points
- `__init__.py` — Aggregates all node classes, registers routes, exports `WEB_DIRECTORY = "./js"`
- `server_routes.py` — aiohttp HTTP routes for file I/O, asset serving, and AI features
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
| `/pixaroma/api/preview/save` | Preview Image Pixaroma — write PNG with workflow metadata to ComfyUI `output/` with auto-increment counter (filename_prefix supports `subfolder/prefix`) |
| `/pixaroma/api/preview/prepare` | Preview Image Pixaroma — return JSON `{image_b64, suggested_filename}` with workflow metadata embedded; suggested_filename peeks the next free counter for Save-to-Disk |
| `/pixaroma/remove_bg` | AI background removal (rembg) |
| `/pixaroma/assets/{filename}` | Serve logo/assets |
| `/pixaroma/api/note/icons/list` | List inline-icon SVGs in `assets/icons/note/` |

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
├── resolution/         # Resolution Pixaroma (single file, ~640 lines)
│   └── index.js        # 3x3 ratio chip grid + 8-row size list + Custom mode
│                       #  (W/H inputs, swap, snap chips, aspect preview).
│                       #  State on node.properties + graphToPrompt hook.
│
├── align/              # Align Pixaroma: toggleable smart-snap + alignment
│   └── index.js        #  guides for the node canvas (~640 lines, single
│                       #  file). Frontend-only patch, no Python node.
│                       #  Hooks: window-level pointermove for snap math
│                       #  (NOT LGraphCanvas.processMouseMove, which Vue
│                       #  does not invoke), drawFrontCanvas wrap for guide
│                       #  rendering (NOT onDrawForeground, unreliable in
│                       #  Vue per Compat #1). Drag-origin + cursor-delta
│                       #  model: state.dragInfo captures cursorX/Y + each
│                       #  selected node's pos at drag start; per-tick
│                       #  desired = orig + cursorDelta; snap is a lateral
│                       #  correction. Visual node bounds include the title
│                       #  bar (LiteGraph.NODE_TITLE_HEIGHT) so snap edges
│                       #  match what the user sees. Change-detection cache
│                       #  identifies the dragged node (more reliable than
│                       #  selected_nodes, which a resize-handle click does
│                       #  not update). Hysteresis stickyG = snapGraph * 1.5
│                       #  to prevent wiggle. Multi-select is a rigid bbox
│                       #  move; resize uses per-edge tracking with sticky
│                       #  "moving" flags. Settings: Pixaroma.Align.Enabled
│                       #  + .SnapDistance under DISTINCT leaf categories
│                       #  (Vue UI dedupes by leaf name). Toolbar button
│                       #  mounted via app.menu.settingsGroup.element.before
│                       #  (rgthree pattern). Default OFF, zero cost when
│                       #  disabled. Shift bypasses snap (Alt is taken by
│                       #  ComfyUI for "duplicate during drag").
│
├── compare/            # Compare Viewer (single file, 413 lines)
│   └── index.js        # Full compare widget (LiteGraph node drawing)
│
├── preview/            # Preview Image Pixaroma (single file, ~520 lines)
│   └── index.js        # Two orange buttons (Save to Disk / Save to Output) +
│                       #  custom strip widget rendering all batch frames with
│                       #  click-to-select (orange BRAND border + "i / N" badge).
│                       #  Listens to api.addEventListener("executed", ...) for
│                       #  pixaroma_preview_frames (custom UI key — Save Mp4
│                       #  pattern, NOT ui.images, so LiteGraph doesn't render
│                       #  its native strip underneath). Save buttons act on
│                       #  the SELECTED frame. saveToOutput posts to
│                       #  /pixaroma/api/preview/save; saveToDisk posts to
│                       #  /pixaroma/api/preview/prepare and uses the route's
│                       #  suggested_filename (auto-counter peek) for the Save
│                       #  dialog, then writes via window.showSaveFilePicker
│                       #  with <a download> fallback.
│
├── notify/             # Notify Pixaroma (single file, ~65 lines)
│   └── index.js        # Terminal node that plays a sound from
│                       #  assets/sounds/ when reached. Listens to
│                       #  api.addEventListener("executed", ...) for
│                       #  pixaroma_notify (custom UI key, Save Mp4
│                       #  pattern). Settings master toggle
│                       #  Pixaroma.Notify.Enabled. Native ▶ Preview
│                       #  button bypasses both master and per-node
│                       #  toggles (manual override - the user is
│                       #  actively asking to hear the sound now,
│                       #  toggles only gate automatic notifications).
│                       #  Sounds served by existing /pixaroma/assets/
│                       #  <subdir>/<filename> route, no new backend.
│                       #  Python returns float("nan") from IS_CHANGED
│                       #  so notification fires on every Run, even
│                       #  when upstream is fully cached.
│
├── audio_studio/       # AudioReact Pixaroma — fullscreen editor for audio-reactive effects
│   ├── index.js        # Entry: button widget on the node, app.graphToPrompt hook
│   │                   #  (Pattern #9), nodeCreated lifecycle. DEFAULT_CFG mirrors
│   │                   #  Params() defaults in nodes/_audio_react_engine.py.
│   ├── core.mjs        # AudioStudioEditor class — open/close/save/discard,
│   │                   #  Vue-compat Ctrl+Z neutering, undo/redo stack, source
│   │                   #  resolution + drag-drop, header/sidebar building.
│   ├── transport.mjs   # Mixin — transport bar UI (play/scrub/sparkline/frame
│   │                   #  stepper), Web Audio playback synced to playhead.
│   ├── audio_analysis.mjs # Decode (Web Audio API), inline Cooley-Tukey real
│   │                   #  FFT (no deps), 4-band envelope/onset packed for
│   │                   #  RGBA32F upload, encodeWav() for upload conversion.
│   ├── render.mjs      # Mixin — WebGL2 pipeline init + 2-pass render
│   │                   #  (motion → intermediate FBO → overlay → screen).
│   ├── shaders.mjs     # 8 motion shader fragments + combined-overlay shader,
│   │                   #  compileProgram() with WeakMap cache.
│   ├── ui.mjs          # Mixin — tabbed sidebar (Motion / Overlays / Audio /
│   │                   #  Output), control factories, helpers.
│   └── api.mjs         # Backend wrappers — uploadSource (multipart POST),
│                       #  getUpstreamImageUrl (Vue links Map/object dual access),
│                       #  getInlineSourceUrl.
│
├── showtext/           # Show Text Pixaroma (single file, ~85 lines)
│   └── index.js        # Read-only DOM <textarea> via addDOMWidget for native
│                       #  text selection / copy + scrollbar. Free resize (min
│                       #  200x120, default 280x200). STRING output named
│                       #  "text" so it chains downstream. Widget value
│                       #  serialized so last-shown text restores on workflow
│                       #  load. No onDrawForeground (Vue Compat #1).
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

8. **`nodeCreated` fires BEFORE `configure()` — defer initial DOM widget population via `queueMicrotask`** — In Vue's new frontend, the extension-level `nodeCreated(node)` hook fires DURING node construction, BEFORE ComfyUI calls `configure(data)` to restore saved widget values. If you render the DOM widget contents synchronously inside `nodeCreated`, you render from the Python default and then flash to the saved state when `onConfigure`'s re-render hook fires milliseconds later. The fix: create an empty `root` div, call `addDOMWidget(..., root, ...)`, wire event listeners, cache `node._xxxRoot = root`, and **defer the initial populate to `queueMicrotask(() => { ... })`** so the restored widget value is visible by the time we read it. Keep the `onConfigure` re-render for the "open a different workflow into an already-constructed node" case. Pattern applies to any hidden-JSON-widget node (Resolution Pixaroma is the reference implementation; Note Pixaroma's timing happens to mask the flash because its initial render is visually lighter). Full diagnostic path: add `console.log` of the widget value in both `nodeCreated` setup and `onConfigure` — if the first shows defaults and the second shows the saved value, you have this bug.

9. **For hidden state, prefer Python `hidden` inputs + `node.properties` + `graphToPrompt` over hidden STRING widgets — eliminates both the input dot and the persistence fragility.** Vue auto-exposes primitive-type *required* inputs (STRING/INT/FLOAT) as convertible input slots that flash a grey dot on hover. Two ways to suppress the dot:
   - **Wrong**: `node.removeInput(idx)` on the auto-created slot. Causes saved JSON to have `"inputs": []`, and on workflow RELOAD Vue fails to reconnect the saved `widgets_values[0]` to the hidden STRING widget — silent revert to defaults on every workflow open.
   - **Right (Resolution Pixaroma pattern)**: Define the input as `"hidden"` (not `"required"`) in Python — no widget, no slot, no dot. Store state on `node.properties[YOUR_KEY]` (LiteGraph serializes `properties` natively in workflow JSON). At extension scope, monkey-patch `app.graphToPrompt` to inject the saved state into each node's `inputs.YourHiddenName` right before submission. Read state via `node.properties[YOUR_KEY]` in setup; include a one-time migration that scans `node.widgets_values` for the old JSON format if you're upgrading from a widget-based architecture.
   - **Acceptable (Note Pixaroma pattern)**: keep the required STRING widget + `hideJsonWidget`. The hover dot remains but persistence is rock-solid via the standard widget value flow. Use this when no extra prompt-time injection is desired.

10. **Custom widget click routing uses `computeSize` bounds, NOT actual rendered area.** LiteGraph's `processNodeWidgets` hit-tests clicks against `widget.last_y + widget.computeSize(width)[1]`. If a widget reports a small constant (e.g. `[width, 220]` matching native PreviewImage's `minHeight: 220`) but DRAWS at a larger height (e.g. `node.size[1] - y` for a "fill remaining space" widget), clicks below the `computeSize` line are NOT routed to `widget.mouse()` — they fall through to `node.onMouseDown`. This bites any node whose last widget needs to grow with the node body (preview strip, video preview, etc.). Two fixes: (a) DUAL CLICK PATH — extract click logic into a shared helper, call from BOTH `widget.mouse()` AND `nodeType.prototype.onMouseDown` so clicks anywhere over the rendered area work (Preview Image Pixaroma pattern); (b) make `computeSize` return the dynamic height (requires caching `_node` reference and computing the strip's own y from sibling widgets — complex and fragile). (a) is preferred.

11. **Preview state persistence across Vue workflow tab switching: `node.properties` + restore via `queueMicrotask(onNodeCreated)` AND `onConfigure`.** Vue's tab switching can tear down node UI state (anything in `node._xxx` instance fields). Anything that should survive — selected frame, expanded mode, frame URLs — must live on `node.properties` (LiteGraph serializes this natively). Build a `restoreFromProperties(node)` helper that re-hydrates the runtime state from properties; wire it from BOTH `queueMicrotask(() => restoreFromProperties(this))` in `onNodeCreated` (Compat #8 — fires after configure resolves the saved property values) AND `nodeType.prototype.onConfigure` (belt-and-braces). Idempotent via early-return on already-populated state. See "Preview Image Pixaroma Patterns" #4 for the full pattern — reuse it for any preview-style node where users would lose state when switching tabs.

12. **Read `app.canvas.graph_mouse` inside `draw()` for free per-frame hover detection on canvas-painted controls.** LiteGraph already redraws the node on every pointermove; any state computed in `draw` is implicitly per-frame. Convert mouse to node-local: `mx = graph_mouse[0] - node.pos[0]`. Hit-test against the same rect the click handler uses. Branch fill/stroke style on hover. No DOM widget needed — this is what native PreviewImage does for its X close button.

13. **`node.onResize` does not reliably fire for DOM-widget resizes — use `ResizeObserver`.** Same family as Compat #1 (`onDrawForeground` not firing): the Vue frontend handles many node-resize paths without invoking `node.onResize`, and even when it does the timing relative to DOM layout is inconsistent. Anything that needs to track the rendered size of a DOM widget (e.g. keeping a preview box square via `height = offsetWidth`) should attach a `ResizeObserver` to the element directly. ResizeObserver fires for every actual size change regardless of cause (node resize, container reflow, tab switch, parent layout shifts) and is supported in every browser ComfyUI runs in. Reference implementation: `js/shared/preview.mjs` — the `createNodePreview` helper used by Paint, Crop, Composer, and 3D Builder mini-previews. Bug class this prevents: "preview box renders as a wide rectangle and only snaps square after the user runs a workflow" (an old `requestAnimationFrame` 60-frame loop + `node.onResize` override would lock the height at the first measured width and never update on subsequent resizes).

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
| `Pixaroma.Preview.DefaultLayout` | combo | `js/preview/index.js` | Default batch layout (Grid / Strip) for Preview Image Pixaroma; per-node toggle in the widget overrides |

### Transparent Background Save-to-Disk
Paint, Composer, and 3D Builder each have a "Transparent BG (Save to Disk)" checkbox next to their BG color picker. It only affects **Save to Disk** — the workflow "Save" path is untouched so existing workflows stay compatible (Python nodes still output RGB tensors).

- Paint: checkbox is inside `createCanvasToolbar` (`js/framework/canvas.mjs`), state on `this._canvasToolbar.transparentBg`. When saving, `js/paint/ui.mjs` `_save()` builds a second canvas without the `fillRect` for the disk PNG.
- Composer: checkbox in `js/composer/ui.mjs` (Canvas Settings panel), state on `this._transparentBg`. `_drawImpl` in `render.mjs` checks `this._transparentExport` flag to skip bg fill; save handler in `interaction.mjs` toggles the flag and re-renders for the disk PNG.
- 3D Builder: checkbox in `js/3d/core.mjs` (Canvas Settings panel), state on `this._transparentBg`. `persistence.mjs` `_save()` does a second Three.js render with `scene.background = null` + `renderer.setClearColor(0x000000, 0)` (renderer already has `alpha: true`).

### Image Composer Patterns (do not regress)

1. **Per-layer blend mode has FOUR touch points that must stay in sync** — (a) in-editor canvas draw (`js/composer/render.mjs` — reads `layer.blendMode`, maps via `BLEND_MAP` to `globalCompositeOperation`), (b) project JSON save (`js/composer/interaction.mjs` `saveBtn` click handler — writes `blendMode` onto `layerEntry` when not "Normal"), (c) the Python executor (`nodes/node_composition.py` `_blend_over()` — W3C Compositing L1 with proper Porter-Duff alpha), AND (d) the **client-side mini-preview recomposite** (`js/composer/index.js` `rebuildPreview` → `drawLayer`). The recomposite runs 300 ms after workflow execution in the fast path (no placeholders/rembg/masks) and would otherwise overwrite the correct save-time preview with a Normal-only render. If any of these four is missing, blend modes silently revert to Normal on some path. The Python path is only taken when a layer has placeholder / auto-rembg / eraser-mask; otherwise the fast path loads the pre-rendered composite PNG which already has blend baked in.

2. **Active-layer blend dropdown needs explicit sync** — `updateActiveLayerUI()` in `js/composer/ui.mjs` must call `core._layerPanel.setBlend(layer.blendMode || "Normal")` whenever a layer becomes active. Without this, `layer.blendMode` stays correct but the `<select>` UI reverts to its default option and misleads the user.

3. **Restore path has THREE layer-construction sites** — `attemptRestore()` in `render.mjs` builds layer objects in three places: `isPlaceholder` fast path, `img.onload` success, and `img.onerror` missing-image fallback. Any new serialized field must be copied from `mLayer` in all three, or it gets silently dropped for certain layer types.

4. **Background color has FOUR sync points** — (a) editor draw `_drawImpl` in `render.mjs` reads `this._bgColor || "#1e1e1e"` to fillRect every frame, (b) saveBtn in `interaction.mjs` writes `bg_color: this._bgColor || "#1e1e1e"` into `finalMeta` so it persists in `project_json`, (c) `attemptRestore` in `render.mjs` must read `meta.bg_color` and assign back to `this._bgColor` (and update `this._bgColorInput.value` if the picker exists), (d) Python's dynamic-compose path in `node_composition.py` reads `meta.get("bg_color")` and uses `_hex_to_rgba(...)` to fill the canvas BEFORE iterating layers. The mini-preview client recomposite in `js/composer/index.js` `compositeAll()` ALSO needs to read `meta.bg_color` and `ctx.fillRect` before drawing layers — without this, the workflow output and mini preview both flip from the user's chosen colour to black on every Run when there are placeholders/rembg/masks (RGBA→RGB conversion in `_save_preview_png` makes transparent pixels black). Older saves missing `bg_color` should fall back to `#1e1e1e` (the editor's default) for backward compat.

5. **Post-run client recomposite (`rebuildPreview`) only adds value when there are placeholder layers** — for the no-placeholder case, Python's fast path loads the saved `composite_path` PNG (which has the user's bg color baked into pixels via line 760-762 of saveBtn), and that's exactly what `restoreNodePreview` already shows. Calling `rebuildPreview` after run in this case re-renders client-side, which can drift from the saved view (different scaling rounding, missing styles, etc.). The `onExecuted` and `executing(null)` handlers in `js/composer/index.js` gate on `node._pixaromaHasPlaceholders?.()` to skip the rebuild for the fast path. The polling rebuild (upstream LoadImage swap before run) is unaffected — it only matters when placeholders exist anyway.

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

### AudioReact Engine Patterns (do not regress)

1. **`slit_scan` is a per-row time-evolving sine wave, NOT a frame-buffer pull** — the spec at `docs/superpowers/specs/2026-04-27-audio-react-pixaroma-design.md` originally described slit_scan as pulling rows from past frames in a buffer (`num_frames × H × W × 3` memory). The implementation simplifies this to per-row vertical sine displacement at row-shifted phase, audio-modulated amplitude — visually the same kind of "time-displaced rows" effect at zero extra memory cost. If you ever switch to a real frame buffer, clamp lookback to ≤ 0.5s of frames or memory blows up at high fps / 4K.

2. **`shake` motion mode caches dx/dy on `self`, must be cleared at the top of `generate()`** — the cache size depends on `total_frames`, which differs per audio length. `generate()` does `if hasattr(self, "_shake_dx_cache"): del ...` before computing the envelope. Without that, switching audio (different total_frames) reuses stale jitter and crashes on index OOB.

3. **`audio_envelope`, `bandpass_fft`, `onset_track`, `process_aspect`, `Params`, all motion functions, all overlay functions live in `nodes/_audio_react_engine.py` — and ONLY there.** `node_audio_studio.py` is a thin wrapper that builds a `Params` and calls `engine.generate_video()`. Do NOT copy helpers into the node file — divergence breaks parity between the Python render and the editor preview (via `js/audio_studio/shaders.mjs`) and the regression goldens. The math is locked behind one file by design.

4. **Print line uses ASCII `->`, not `→` (U+2192)** — Windows console default codec (cp1252) can't encode the arrow. Crashes the generate() call before frame 1.

5. **Color shift / channel offset uses resolution-relative pixel counts, not hardcoded** — `glitch` overlay computes max_px = `int(onset_t * strength * 0.012 * min(H, W))` so a 720p clip and a 4K clip produce visually-equivalent glitch amplitudes. Same pattern in `ripple` (`A = 0.015 * 2.0` in normalized grid units, since grid spans `[-1, 1]`). Hardcoded pixel counts feel different at every resolution and break the "drop-in defaults" promise.

6. **Overlay short-circuit at strength == 0 is mandatory for performance** — every overlay's first line is `if env_t <= 0.001 or strength <= 0: return frame`. Without the early-return, bloom (which does a Gaussian blur per frame) costs ~30% even at strength=0. The `generate()` loop also checks `if glitch_strength > 0.0:` etc. before calling. Both layers of guard are intentional.

7. **No `edge_headroom` widget — deliberately omitted, do not add it back** — depth-based parallax nodes (which this project no longer ships) need headroom because depth × strong intensity can displace sample coords well beyond `[-1, 1]`. `audio_react`'s motion modes don't have that problem: `scale_pulse` and `zoom_punch` pull inward (zoom-in only, range stays inside `[-1, 1]`), and `shake` / `drift` / `rotate_pulse` / `ripple` / `swirl` / `slit_scan` excurse by at most ~6% — `padding_mode="border"` handles those invisibly. Headroom would just render extra pixels that get cropped, wasting compute. `_process_aspect()` is still called (defaults `headroom=1.0`) so the helper stays general-purpose, but no crop pass after the per-frame loop.

### AudioReact Patterns (do not regress)

These patterns were hard-won during AudioReact v1 development. Regressing any of them reintroduces specific bugs.

1. **`DEFAULT_CFG` in `js/audio_studio/index.js` MUST stay in sync with `Params` defaults in `nodes/_audio_react_engine.py`.** ComfyUI doesn't pre-fill a hidden input's value; the JS extension is the source of truth for first-time-on-canvas defaults. If the two diverge, the editor opens with one set of defaults and the workflow runs with another. Same risk class as Note Pixaroma Pattern #3 — keep them in sync at the same commit.

2. **Engine math lives in `nodes/_audio_react_engine.py` ONLY** — `node_audio_studio.py` is a thin wrapper that builds a `Params` and calls `generate_video()`. If you ever feel the urge to "just inline this one helper" in the node file, don't — every formula must travel through the engine.

3. **Math doc (`docs/audio-react-math.md`) is the single source of truth for formulas.** When changing a formula: (1) update the doc first; (2) update the Python implementation in the engine; (3) update the matching GLSL shader in `js/audio_studio/shaders.mjs`; (4) run `scripts/audio_parity_check.py --regenerate` to refresh goldens; (5) run the browser parity harness manually (`assets/audio_studio_parity/index.html`) to confirm the WebGL side still matches. Skipping any step risks editor preview drifting from MP4 output.

4. **Approximate-preview carve-outs are documented, not silent.** Math doc §9 lists `shake` and `bloom` explicitly. The browser harness exempts these from the ΔE check. If you add a new "the WebGL side can't bit-match this" effect, update §9 AND the harness — silently exempting tests has misled debugging in the past.

5. **Audio is WAV-only on disk.** The browser converts MP3 / OGG / AAC / etc. via `decodeAudio` + `encodeWav` in `js/audio_studio/audio_analysis.mjs` BEFORE upload. Server only accepts `.wav` — keeps Python dependency-free (stdlib `wave` module). Don't add server-side ffmpeg / pydub / etc. to "support more formats." Adding a heavy dep ripple-effects through the project's "no extra deps" promise.

6. **WebGL2 required, no fallback.** If `getContext("webgl2")` returns null, the editor shows a clear error to the user. Don't add WebGL1 fallback — none of the modern browsers we target lack WebGL2, and the fallback complexity buys nothing.

7. **Pattern #9 persistence** (CLAUDE.md Vue Frontend Compatibility point #9) — `studio_json` is declared `hidden` in `INPUT_TYPES`, state lives on `node.properties.audioStudioState`, `app.graphToPrompt` hook in `js/audio_studio/index.js` injects it at submission. Same as Resolution Pixaroma. If the input ever shows up as a slot dot, Pattern #9 has been broken — likely by `removeInput()` or by re-declaring as `required STRING`.

8. **`shake` motion shader uses a deterministic JS RNG (mulberry32-like hash seeded by frame index) — NOT a port of `torch.Generator(0)`.** Browser preview is approximate for shake. This is documented behavior — if you "fix" the shader to use Python's exact sequence, you'll discover torch's RNG cannot be reproduced cross-platform and break parity in a different way.

9. **Audio analysis runs ONCE per audio load**, packing all 4 bands into one RGBA32F texture (R=full, G=bass, B=mids, A=treble). Toggling `audio_band` in the sidebar is a free uniform swap (`u_audio_band_idx`), not a recompute. Don't add a "recompute on band change" path — it slows the editor and adds latency to a click that should be instant.

10. **`_onCfgChanged` only triggers `_recomputeAudio` when `fps` / `smoothing` / `loop_safe` actually changed**, AND the recompute is debounced 200ms. Cached as `_audioParamsKey`. Without this guard, dragging intensity / overlay sliders would re-run the 4-band FFT on every tick — the smoothing slider especially felt sticky before this was added.

11. **`_setImage` MUST re-attach `this.canvas` to `canvasHost` if it's been disconnected** — `_showCanvasMessage` sets `canvasHost.textContent`, which removes the `<canvas>` from the DOM. Without the re-attach, picking an inline image after seeing the "upstream not ready" message renders to an orphaned canvas that's invisible until the editor is closed and re-opened.

12. **`isDirty()` must OR a `_uploadDirty` flag, not just compare cfg JSON** — re-uploading a source replaces bytes at the same path (`audio_studio/<id>/<kind>.<ext>`), so `cfg.image_path` / `audio_path` doesn't change between picks. Without `_uploadDirty`, the SAVE button stays grey after the second image upload. The flag is set on every upload and cleared in `_save()`.

13. **Vue-compat: editor patches `app.loadGraphData` AND `app.graph.configure`** while open (Pattern #6 in Vue Frontend Compatibility) — Ctrl+Z would otherwise tear down the workflow under the editor. `forceClose` restores both. Plus `node.onRemoved` resurrection-close safety net. Plus we cache `node.onConnectionsChange` to react to upstream wire/disconnect mid-edit (re-resolves the affected source) and restore the original handler on close.

14. **Window-level scrub listeners (`mousemove` / `mouseup`) must be cached on the editor instance and detached in `forceClose`** — see `_detachTransportListeners` in `transport.mjs`. Without detach, the closure keeps the editor alive after close (memory leak + stale references on the next open). Same applies to debounced timers (`_recomputeTimer`, `_snapTimer`) — `forceClose` clears both.

15. **Inline-upload wire disconnects are queued, not immediate — committed on Save, discarded on Cancel.** When the user uploads an image / audio inside the editor, the upstream wire is NOT torn down at upload time. Instead `_queueWireDisconnect(name)` records the input on `editor._pendingDisconnects`, and `cfg.<src>_force_inline = true` keeps the inline preview winning over the still-attached upstream during the session. `_save()` calls `_disconnectUpstreamInput(name)` for each queued entry before serializing. If the user picks Discard from the close prompt, `forceClose()` runs without `_save()` and the queued set is garbage-collected with the editor — the graph wire stays intact. The previous "disconnect immediately on upload" design left the user with a permanently disconnected wire whenever they uploaded by accident and discarded; that's the bug this pattern fixes. If you add a new inline-upload path, route through `_queueWireDisconnect` (not `_disconnectUpstreamInput`) and set `force_inline = true` so the in-session preview is correct.

### Align Pixaroma Patterns (do not regress)

These patterns were hard-won during the May-2026 implementation. The original spec / plan assumed `LGraphCanvas.prototype.processMouseMove` and `onDrawForeground` would be the hook points; on-the-spot probing showed neither fires in this ComfyUI Vue frontend, so the implementation diverged. Re-read this section before touching the Align module.

1. **Vue frontend hook discovery: window pointermove + drawFrontCanvas, NOT processMouseMove + onDrawForeground.** ComfyUI's Vue frontend does not invoke `LGraphCanvas.prototype.processMouseMove` during drags (verified by patching it to no effect). Drag input is captured via `setPointerCapture` so even the canvas DOM element does not see pointermove during drag. The reliable input hook is a **window-level** `pointermove` listener (bubble phase) gated on `app.canvas.last_mouse_dragging` AND `e.buttons & 1`. For RENDER, the canvas-level `onDrawForeground` is documented as unreliable in Vue (CLAUDE.md Vue Frontend Compatibility #1) so we wrap `LGraphCanvas.prototype.drawFrontCanvas` instead, which is provably called (Compare and Preview Image Pixaroma both render via the same draw pipeline). If a future ComfyUI version changes either, re-probe both hooks before patching.

2. **Drag-origin + cursor-delta model.** `state.dragInfo` captures `cursorX/Y` and per-node `pos[0/1]` at drag start. Each tick computes `desired = orig + (e.clientX/Y - cursorX/Y) / scale` and OVERWRITES `node.pos`, replacing whatever LiteGraph already set this tick. This decouples our snap from LiteGraph's tick-by-tick increments and prevents the "snap fights the cursor" jitter the original plan tried to solve via `last_mouse_position` patching. Multi-select uses the same model with a captured map of every selected node's original position; one cursor delta moves the whole selection rigidly.

3. **Visual node rect includes title bar height.** `LiteGraph.NODE_TITLE_HEIGHT` (default 30) sits ABOVE `node.pos[1]`, which is the body top, not the visual top. Snap math must use the visual rect (`y = pos[1] - titleH`, `h = size[1] + titleH`) for top-edge alignments to match what the user sees. Collapsed nodes have no body, so `nodeRect()` zeroes titleH. Forgetting this makes the top edge snap 30 px off.

4. **Change-detection beats `selected_nodes` for dragged-node identification.** `state._prevNodeStates` caches every node's pos/size each tick; the next tick's diff identifies the node LiteGraph just modified. `selected_nodes` alone is wrong because resize-handle clicks on an UNSELECTED node do not update the selection, so snap math would target the wrong rect. Fallbacks (in priority order: `selected_nodes` length 1, `node_over`, `getNodeOnPos(graph_mouse)`) cover the very first tick when the cache is empty. For multi-select, fallback picks the first selected node as the anchor; multi mode is detected separately via `Object.values(selected_nodes).includes(draggedNode)`.

5. **Hysteresis with `stickyG = 1.5 * snapGraph` prevents wiggle.** `findClosestSnap` and the resize `tryTarget` both accept a sticky-target argument; a target equal to last tick's snapped value gets the wider `stickyG` allowance, others get the narrower `snapGraph`. Without this, a cursor exactly at the snap-zone boundary makes the node oscillate between snapped and free positions.

6. **Resize "moving edge" flags persist for the rest of the drag.** `dragInfo.leftMoves / rightMoves / topMoves / botMoves` flip true the first tick an edge measurably differs from its drag-start value, then stay true even if LiteGraph clamps the size at min-bounds. Without persistence, snap drops the moving edge whenever min-size kicks in and the user has to wiggle to re-engage.

7. **Drag is classified once (move vs resize) and the lock holds.** After the first detected change, `dragInfo.lockType` becomes `"move"` (pos changed) or `"resize"` (size changed), and stays. Multi-select is locked to `"move"` at init since LiteGraph has no multi-resize handle. Re-classifying mid-drag would let a single jitter route the rest of the drag through the wrong branch.

8. **Hooks WRAP, never REPLACE.** `installDrawHook()` saves the original `drawFrontCanvas` at install time and calls through; the toolbar button is mounted with `settingsGroupEl.before(group)` next to existing buttons. Replacing breaks every other extension that patches the same surface. Verified coexistence with rgthree-comfy and an unrelated "NodeAlign" extension that adds its own align toolbar.

9. **`state.enabled` early-return is the perf contract.** First line of `onWindowPointerMove`: bail when disabled. First line of the `drawFrontCanvas` wrap after calling original: bail when `state.activeGuides.length === 0`. No node iteration, no allocation, no math. The "default OFF, zero cost" promise depends on this. Do not add work above either guard.

10. **Settings leaf categories must be DISTINCT (Vue UI dedupes by deepest leaf).** Two Pixaroma.Align settings collapse into one row in Settings if they share the same leaf. Current schema: `["👑 Pixaroma", "Align"]` for Enabled and `["👑 Pixaroma", "Align (advanced)"]` for SnapDistance. Same trap applies to any future Pixaroma feature with multiple settings; sharing a leaf silently drops one row.

11. **Shift bypasses snap, NOT Alt.** Alt is taken by ComfyUI for "duplicate during drag", so the bypass key is `e.shiftKey`. The toolbar button title and the settings tooltip BOTH must say Shift. The settings tooltip drifted to "Hold Alt" once during development and was caught only by reviewing the code; if you change the modifier, update both strings.

12. **Multi-select is a rigid bbox move with selected nodes excluded from snap targets.** When `selected_nodes` has 2+ live members AND the dragged node is one of them, init captures every selected node's `pos` into `dragInfo.origPositions` plus the visual bbox (`origBBox`). Each tick: cursor delta drives the bbox; snap is computed only on the bbox edges/centers against non-selected nodes (skipped via `dragInfo.origIds.has(other.id)`); the resulting (cursor + snap) delta is applied uniformly to every selected node from its captured original. Selected nodes never become snap targets to each other. Membership is checked by object identity (`Object.values(sel).includes(draggedNode)`) rather than stringified id since LiteGraph keys can be number or string depending on the build.

13. **Extended guides scan all candidates for shared edges.** After picking the best X (or Y) snap, `extendGuideRange()` walks every non-skipped rect and unions the perp range with any whose left/right/centerX (top/bottom/centerY) equals the snap value within EPS = 0.5 graph units. Result: a column of 3+ co-aligned nodes shows ONE continuous guide across the full column, not a short segment between only the moving and matched rects. Move-only for v1; resize keeps the simpler 2-rect range since extended guides matter most for arranging columns/rows.

14. **Distinguish marquee / canvas-pan from node-drag via LiteGraph canvas state flags.** The window pointermove handler MUST NOT run snap math during a Ctrl+drag marquee or a canvas pan: both leave `last_mouse_dragging` true and `e.buttons & 1` set, so those gates alone are not enough. LiteGraph exposes three mutually-exclusive mode flags on `app.canvas`: `dragging_rectangle` (non-null `[x,y,w,h]` array iff a marquee is active), `dragging_canvas` (true iff panning), `isDragging` (true iff a node/group is being moved; replaces the older `node_dragged` which no longer exists in current ComfyUI builds). Gate the handler with `if (c.dragging_rectangle != null || c.dragging_canvas) bail`. Do NOT also gate on `!c.isDragging` — its dead-zone onset (see #15) lags `dragStarted` for legit multi-node drags and silently kills snap on the first ticks of a real multi-select drag. Original bug this gate fixed: a second Ctrl+drag marquee with N>1 nodes already selected used the fallback chain at lines 395-409 (selKeys.length > 1 picks first selected as anchor) and dragged every selected node along with the marquee cursor. Same root cause for the cursor-sweep nudge: marquee path passing over an unselected node picked it via `node_over` / `getNodeOnPos` and applied snap writes to it.

15. **Pre-threshold dead zone leak — gate on `pointer.dragStarted === false`.** LiteGraph's `CanvasPointer` waits ~6px / 150ms before committing to ANY drag mode. During that window `dragging_rectangle`, `dragging_canvas`, and `isDragging` are all still null/false even though `last_mouse_dragging` is already true and the user's button is down. With multiple nodes already selected, the fallback chain picks the first selected node as anchor and leaks cursor delta into every selected node's position for the few pixels before LiteGraph commits to "marquee". User-visible as "previously-selected nodes shift a little bit, randomly" the moment a new marquee starts. The fix: `if (c.pointer && c.pointer.dragStarted === false) bail` (strict `=== false` so undefined on older builds falls through to existing behaviour). `pointer.dragStarted` flips true at the exact threshold crossing for ALL drag types. Cost: legit multi-node snap engagement is delayed by at most 6px / 150ms — barely perceptible. Do NOT use `isDragging === false` for this purpose: it is also false during the dead zone, but in practice it lags `dragStarted` enough for some multi-node drags that snap stops engaging entirely (verified during the May-2026 fix sequence).

### Note Pixaroma Patterns (do not regress)

These patterns were hard-won during Note Pixaroma development. Regressing any of them reintroduces specific bugs, some silent.

1. **Sanitizer must UNWRAP on invalid href, not remove** — in `sanitize.mjs` `filterElement`, when `filterHref` returns null the old code called `el.remove()` which deleted the `<a>` *and* its child text. Users lost their typed content silently on save whenever a link had a bad URL (e.g. dialog default `https://` with no host). Unwrap the anchor instead, keep the inner text, recurse into children. Same policy as for unknown wrapper tags.

2. **URL validation must fully parse, not just regex** — `/^https?:\/\//i.test(url)` accepts `"https://"` with no hostname. Use `new URL(url)` + `u.hostname` check so the dialog rejects what the sanitizer would later throw on. Shared `validateUrl()` in `blocks.mjs` returns `{ ok, message }` and is used by Button Design / YouTube / Discord; the link dialog in `toolbar.mjs` has the equivalent inline check.

3. **Python widget default MUST stay in sync with JS DEFAULT_CFG** — `nodes/node_note.py` ships a JSON string `default` for the `note_json` widget. ComfyUI pre-fills this into the widget value BEFORE `nodeCreated` fires, so `parseCfg` merges it on top of the JS defaults and whatever the Python string contains wins. `backgroundColor` and `accentColor` must match between the two files. `parseCfg` also contains a migration that strips the old `backgroundColor:"transparent"` default when content is empty, so users who haven't restarted ComfyUI still get the current default.

4. **Bg picker is a THREE-state override on node.color + node.bgcolor — do NOT go back to the old always-override flow** — `renderContent(node, bodyEl)` in `render.mjs` must respect `cfg.backgroundColor` having three different meanings, or it will clobber ComfyUI's native right-click Colors menu every time the user saves text edits (the original bug that forced this pattern to exist). States: (a) **undefined / key missing** → user has never touched the Bg picker; renderContent must LEAVE `node.color` / `node.bgcolor` alone so the native picker + LiteGraph theme defaults survive. (b) **null OR `"transparent"`** → legacy state from notes saved under the older Bg picker that had a clickable transparent tile; renderContent must null out `node.color` / `node.bgcolor` so our override reverts. (c) **hex string** → user picked via Bg picker; `node.bgcolor = hex` and `node.color = darken(hex, 0.3)` — the darkened title-bar color is REQUIRED so the title reads visually distinct against the body (same contrast the native Colors menu produces). `.pix-note-body` stays transparent so the frame color flows through as one surface. `node.setDirtyCanvas(true, true)` forces LiteGraph to repaint immediately. **Reachability note (May 2026)**: the Bg picker now uses the compact picker with `showClear: true, clearPosition: "last", clearDisabled: true` — the transparent tile renders as a dimmed/grayed out slot for visual consistency with text + highlight pickers, but it's NOT clickable, so state (b) is no longer reachable from inside the picker. `c == null` branch in the picker's `onPick` is kept for backward compat (legacy saves that already have null). `DEFAULT_CFG` in `index.js` still omits the key entirely so new notes start in state (a) and right-click → Colors works for users who never touch the Bg button. `parseCfg` migrates legacy `"transparent"` / `"#111111"` values (both old widget defaults) to unset when the note has no content.

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

20. **Text + highlight + Bg pickers all use the Excel-style compact popup with sticky-pick state; Btn / Ln stay on the live-preview popup** — Two distinct popup APIs in `js/shared/color_picker.mjs`. Compact (`openPixaromaCompactColorPickerPopup`) shows swatches + Reset + "More colors..." footer; each click fires `onPick(hex)` ONCE and closes the popup. "More colors..." closes the popup and opens `openMoreColorsModal` — a centered modal with full SV / hue / hex picker + OK / Cancel buttons. The modal's SV plane is square (`aspect-ratio: 1` in CSS, canvas internal width AND height synced from CSS dimensions via `renderSV` / `renderHue`) — Photoshop-style. **Unified shape across the three Note pickers (May 2026)**: text + highlight + Bg all pass `swatches: PIXAROMA_PALETTE.slice(0, 35)`, `showClear: true`, `clearPosition: "last"` so the swatch grid looks identical in all three (3 rows × 12, transparent tile in the bottom-right slot). `clearDisabled` differs: text + Bg pass `true` (transparent tile renders dimmed/grayscale, not clickable — they don't have a meaningful "transparent" state), highlight passes `false` (the only picker where transparent really clears). Btn / Ln stay on the original `openPixaromaColorPickerPopup` (live-preview SV-drag) via the `makeColorPicker` factory because they drive whole-editor visuals where live preview is genuinely useful. **Sticky pick state**: text → `this._pickedFg = c` set on every onPick (including Reset to `#ffffff`); highlight → `this._stagedHi = c` for a colour, `this._stagedHiClear = true` for Reset/transparent (Pattern #30). `_mirrorPickerColors` checks state in priority order: `_stagedHi` > `_stagedHiClear` > cursor-bg mirror > clear. The `_stagedHiClear` arm is critical — without it the icon flips back to the cursor's surrounding bg colour as soon as `selectionchange` fires after Reset. Both `_stagedHi` and `_stagedHiClear` are mutually exclusive (picking a colour clears `_stagedHiClear`; picking Reset clears `_stagedHi`). All three sticky vars (`_pickedFg`, `_stagedHi`, `_stagedHiClear`) are cleared in `_cleanup` on editor close. The Note editor's modal-aware `hasModal` selectors (Pattern #27) include both `.pix-cp-popup` and `.pix-cp-modal-backdrop` so Esc / overlay-mousedown don't tear the editor down while the popup or the More-colors modal is open.

21. **Highlight is applied via `beforeinput` + manual character insert with `e.preventDefault()`. Do NOT use `execCommand("hiliteColor")` for collapsed cursors.** `execCommand("hiliteColor", c)` on a collapsed cursor has THREE bugs in Chrome: (a) it CLEARS any previously-staged foreColor; (b) for some span-nesting configurations the new bg span lands at the START of editArea (caret-jump bug); (c) when the cursor is inside an existing bg span, it expands the selection to wrap the prior highlighted region, which the user then accidentally overwrites by typing. The fix is to NOT call hiliteColor on collapsed cursors at all. Architecture: the highlight onPick stores the colour in `this._stagedHi` (sticky) and (for collapsed cursor) does NOT mutate the DOM. A `beforeinput` listener attached to editArea in `core.mjs` (`this._beforeInputHandler` → `_applyStagedHilite` in `toolbar.mjs`) handles the actual application: walks up from the caret to find the nearest inline `style.backgroundColor` ancestor; if it matches the staged colour (`inMatchingBg = true`), let the browser do its native insertion (typing extends the span via inheritance). Otherwise build a `<span style="background-color:STAGED">` with the typed character INSIDE it (`span.textContent = e.data`), `range.insertNode(span)`, place the caret AFTER the character, and **`e.preventDefault()`** to suppress the browser's default insertion. **The preventDefault is REQUIRED** because Chrome's `beforeinput` resolves the insertion target as a STATIC range via `InputEvent.getTargetRanges()` captured BEFORE our handler runs — modifying the selection inside the handler does NOT redirect the typed character. Without preventDefault, the character lands in the original (un-bg) text node and leaves the empty bg span behind as invisible litter (every typed character is plain, with empty spans accumulating in the DOM). The exact bug observed during development: type "test", pick orange, type "start" → "start" comes out plain because every character was being inserted into the original text node while the bg spans we created were invisible empties. **`_pickedFg` must also be applied** — the manually-inserted span gets `style.color = this._pickedFg` if set, since Chrome's foreColor staging only takes effect during NATIVE insertion and our `e.preventDefault()` bypasses it. Without this, the first char typed into a fresh staged-bg span is white (default fg) while subsequent chars (extending via Chrome) get the staged foreColor — "first-char-white-rest-orange" regression after Ctrl+A + type. Composition (`insertCompositionText` with no `data` yet): insert an empty span and let the browser's composition lifecycle handle the text — do NOT preventDefault, that would block IME. For NON-COLLAPSED ranges in the highlight onPick (user has selection at pick time), still call `execCommand("hiliteColor", c)` — it correctly handles multi-element selections; replay foreColor afterwards because hiliteColor side-effect-clears it. `_stagedHi` is sticky (NOT cleared on first beforeinput consume) so subsequent typing in different areas keeps producing the picked highlight until the user picks differently or hits Reset (Pattern #30 covers Reset / clear-stage and the post-deletion cleanups).

22. **CSS vars on editArea need explicit init after `this._editArea` is assigned** — `_buildToolbar()` runs BEFORE `this._editArea = editArea` in `open()`. The `makeColorPicker` factory's internal `apply()` writes `--pix-note-btn` / `--pix-note-line` via `this._editArea?.style.setProperty(...)` — the optional chain short-circuits at factory construction, so the initial write no-ops. Click-time picker updates still work because editArea is set by then, but on every editor REOPEN the preview falls back to orange (CSS default) even when cfg has saved colors. Fix: `NoteEditor.prototype._applyCfgColorsToEditArea()` in `core.mjs` explicitly writes both CSS vars, called immediately after `this._editArea = editArea`. If a new per-note CSS var is introduced for another picker, wire it into both `makeColorPicker` AND this init helper, or the same class of bug recurs.

23. **`save()` body lookup must be robust against Vue detachment** — Vue can tear down a node's DOM widget while the fullscreen editor overlay is open (Vue-compat #5). Using `this.node._noteBody` directly on save risks writing CSS vars / innerHTML to a stale element that's no longer in the live DOM — canvas-side picker changes (Bg, Btn, Ln) silently fail to reach the visible body. `core.mjs` `save()` does a three-step robust lookup: `this.node._noteBody?.isConnected` → `this.node._noteDOMWrap?.isConnected?.querySelector(".pix-note-body")` → `this.node.widgets?.find(x => x.name === "note_dom")?.element?.querySelector(".pix-note-body")`. Refresh the cached `_noteBody` reference to the live element after finding it so subsequent writes land correctly. Debug tip: a `bodyEl.isConnected` check + `console.log` in `renderContent` is a fast way to confirm the live body is what `save()` hit.

24. **Bold uses `queryCommandState("bold")` — not a B/STRONG tag walk** — a tag walk misses two important cases: (1) cursor inside H1/H2/H3 where the bold rendering comes from CSS `font-weight`, and (2) any point after the user has touched a color picker, because color pickers enable `styleWithCSS=true` globally and `execCommand("bold")` from that point onward produces `<span style="font-weight:bold">` instead of `<b>`. `queryCommandState("bold")` handles all three (B/STRONG, heading default, CSS span) correctly. Users expect the Bold icon to light up inside headings the way Word / Google Docs / Notion do. Italic / Underline / Strikethrough use `queryCmd` already — Bold was the outlier.

25. **Picked TEXT colour must be restaged on every caret move; highlight stickiness goes through a different path entirely.** Chrome wipes `execCommand`-staged `foreColor` every time the selection moves (not just on DOM mutations) — clicking into another table cell, Tab across cells, arrow-keying, or clicking through any block boundary all drop the stage. Without compensation, the user picks orange, clicks elsewhere, types → white text. The durable fix is `_restageColors` in `toolbar.mjs`, called from the document-level `selectionchange` handler: reads `_textColorBtn`'s `--pix-note-tbtn-tint` and replays `execCommand("foreColor", that)`. Guarded with `r.collapsed` so drag-selects don't accidentally recolour the user's in-flight range, and with `_suppressMirrorUntil` so a freshly-staged colour isn't fired on top of itself. **`_restageColors` does NOT touch `hiliteColor`** — that path is buggy (Pattern #21) and highlight stickiness is handled by `_stagedHi` + the `beforeinput` listener instead, which doesn't depend on Chrome's stage persisting across cursor moves. Block-insert paths (grid, code, HR) call `_restageColors` directly after the DOM insert + caret placement — the post-insert caret may not trigger selectionchange if it lands in the same offset, so the explicit call guarantees text typed immediately after the insert is coloured. Highlight stickiness across block inserts is automatic — `_stagedHi` is sticky and `_applyStagedHilite` runs on whatever the next `insertText` event is, regardless of where the caret landed after the block. Any new block-insert path that does its own DOM manipulation should still call `_restageColors()` after the mutation + caret placement, following the `_insertGridBlock` pattern.

26. **Grid insert bypasses `execCommand("insertHTML")` entirely and manipulates DOM directly** — Chrome's caret placement after block-level insertHTML of a `<table>` is unreliable: the caret often lands inside the last `<td>` instead of the trailing `<p>`, and the table-split leaves the user's surrounding inline formatting in a fragile state. `_insertGridBlock` in `blocks.mjs` mirrors the code-block insert pattern — build the table + trailing `<p><br></p>` in a detached wrapper, insert as a sibling AFTER the anchor block (found via `findTopBlock` walk from the saved range), explicitly position the caret at the start of the trailing `<p>` via `range.selectNodeContents(trailing) + collapse(true)`, then call `_restageColors()` so typing below the grid picks up the staged color. Bracket with `_snapBefore` / `_snapAfter` so the whole insert is one undo step. If you add another block-level insert path (e.g. image, embed), follow THIS pattern — not the `insertHTML` pattern.

27. **Block modals live in `document.body`, not inside the editor panel — overlay close handler must check `hasModal`** — `makeButtonDesignDialog`, `makeGridDialog`, the colour picker popup (`.pix-cp-popup`), the More-colors modal (`.pix-cp-modal-backdrop`), the icon picker popup (`.pix-note-iconpop`), the help overlay (`.pix-note-help-overlay`), and `pix-note-confirm-backdrop` all `appendChild` onto `document.body` (so they can escape `transform` / `overflow` boundaries on the panel). Without compensation, a mousedown outside the dialog but inside the editor backdrop lands on `.pix-note-overlay` and triggers `close()` — popping the unsaved-changes prompt ON TOP of the still-open modal. `core.mjs` overlay mousedown handler runs the same `hasModal` guard as the Escape handler: `document.querySelector(".pix-note-blockdlg, .pix-note-confirm-backdrop, .pix-cp-popup, .pix-cp-modal-backdrop, .pix-note-iconpop, .pix-note-help-overlay")`. Adding a new document.body-level modal? Add its selector to BOTH guards (Escape + overlay mousedown) or clicking outside it silently closes the editor.

28. **`<a>` clicks inside the edit area must be `preventDefault`ed** — the browser follows `<a href>` on any click inside a contenteditable, so clicking on an inserted Download / View Page / Read More / YouTube / Discord pill (or any plain link) to reposition the caret instead opens the URL in a new tab. `core.mjs` `open()` installs `editArea.addEventListener("click", fn, true)` using capture-phase + `e.target.closest("a") ? e.preventDefault() : …` so caret positioning works but navigation doesn't fire. Without this, users cannot reliably click into a pill to delete or re-edit it (the pencil handles the re-edit path, but simple caret positioning / backspace-through-pill doesn't work). Do NOT reach for `pointer-events: none` on pills — that also blocks the pencil hover delegation.

29. **Inline icons render via `<span data-ic="<slug>" data-size="<s|l|xl>" class="pix-note-ic" contenteditable="false" style="color:...">` with per-icon mask-image rules dynamically injected at editor open** -- icons are a FOUR-file contract: `server_routes.py` enumerates `assets/icons/note/*.svg` and returns `{id, label, url}` via `/pixaroma/api/note/icons/list`; `js/note/icons.mjs` caches the list at module scope and injects one `.pix-note-ic[data-ic="<id>"] { mask-image: url(...) }` rule per icon into a single `<style id="pix-note-icon-css">` at `<head>`; `js/note/sanitize.mjs` allows `pix-note-ic` class + `data-ic` attribute (validated against `/^[A-Za-z0-9_-]{1,64}$/`) + `data-size` attribute (validated against `/^(s|m|l|xl)$/`, span-only) + `contenteditable` attribute (only `"false"`, only on icon spans). The `contenteditable="false"` flag is REQUIRED -- without it Chrome's caret-rendering algorithm produces a dead-zone at the icon edges where the cursor disappears for one arrow-key step. With it, the browser treats the span as an atomic block: arrow-keys step cleanly past it, click placement has well-defined before/after positions, and Backspace from after removes the whole span in one keystroke. Color and size are independent of the A text-color picker -- they live as session-sticky state on `editor._iconPickerColor` / `editor._iconPickerSize`, set via the icon popup's color row + size pills, decoupled from typing colors. Defaults: orange `#f66744` + M (1.2em) on every editor open, reset in `_cleanup()`. The popup re-paints its grid glyphs at the picked color/size for live preview before insert. Color stamps as inline `style="color:..."` on the span; size stamps as `data-size="s|l|xl"` (M default omits the attribute so old notes stay byte-identical). Slug case is preserved (CLIP / GGUF / LORA / VAE are intentional acronym filenames). Missing per-icon rule renders the span as a solid 1.2em colored rectangle -- deliberately visible so the user notices a broken icon rather than an invisible gap. The picker popup (`.pix-note-iconpop`) must be registered in BOTH `hasModal` selectors in `core.mjs` (Escape handler AND overlay mousedown) per Pattern #27, or clicking outside the popup silently closes the editor. `_insertInlineIcon` in `icons.mjs` does direct DOM insertion via `range.insertNode()` (NOT `execCommand("insertHTML")` -- that wraps inserts in new blocks at the contenteditable root, splitting layout) bracketed by `_snapBefore`/`_snapAfter` so the manual undo stack records the mutation (Pattern #11). Backspace / Delete adjacent to an icon span is INTERCEPTED inside the consolidated `_keyBlock` handler in `core.mjs::open()` (NOT a separate `_iconKeyHandler` -- `_keyBlock` runs on window-capture and ends with `stopImmediatePropagation`, so editArea-bubble handlers would never fire). The walker peers through wrapper elements that may contain a single icon (Chrome can wrap inserts in `<font color>`/`<span style="color">` when foreColor is staged), strips the trailing `&nbsp;` (or its leading-char form when merged with typed text), and unwraps the now-empty wrapper. If you add a NEW inline-marker class (different kind of inline element), follow this pattern: base class for layout + data-attr for identity + dynamically injected per-value CSS rule + `contenteditable="false"` for atomic caret/selection behavior.

30. **Highlight Reset uses the stored-marks pattern via `_stagedHiClear`; `_applyStagedHilite` is the single point of robustness for ALL post-deletion / fresh-note states.** Reset / transparent on the highlight picker does NOT mutate the DOM at click time (collapsed case) — it sets `_stagedHi = null; _stagedHiClear = true` and clears the icon. The mirror priority (Pattern #20) keeps the icon dimmed even when the cursor sits inside a bg span. The actual "escape the surrounding bg span" happens at TYPE time in `_applyStagedHilite`'s clear-stage branch: walk to the OUTERMOST bg-styled ancestor, measure cursor offset within it, and either insert the typed char as a sibling text node before / after / split-and-between the span. After the first char, the cursor is in a plain text node with no bg ancestor, so subsequent chars early-return and natural typing takes over. Mirrors ProseMirror / Slate / Quill / Lexical's stored-marks design (which this project deliberately copied after the agent investigation in May 2026). Earlier Reset-time DOM manipulation attempts (move-cursor-out, split-at-Reset) failed because the apply branch produces ONE single-char `<span bg>` per typed char, not a merged span, so "outermost bgAncestor" walks found a single-char span and Chrome's contenteditable merged subsequent typing back into adjacent same-color siblings. **The clear branch must also apply `_pickedFg`** by wrapping the inserted text in a `<span style="color:...">` instead of a raw text node — same rationale as Pattern #21's apply-branch fix. **Five mandatory cleanups run at the top of `_applyStagedHilite` for ALL stage modes (apply + clear), in order**: (a) `_normalizeEditArea?.()` — wraps any loose text / inline / `<br>` directly under editArea (post-Chrome-native-backspace state) into `<p>` blocks. Range positions survive the `appendChild` moves. Without this, the cursor lands at editArea level and the rest of the cleanups don't fire. (b) `wasNonCollapsed = !r.collapsed` capture, then `r.deleteContents()` if non-collapsed. (c) editArea-level cursor descent — when `r.startContainer === this._editArea` (cursor at editArea root, e.g. after `_placeCursorAtEnd`), pick `children[idx-1] || children[idx]` and reposition cursor to its END. Without this, `r.insertNode(span)` puts the span as an editArea-level sibling instead of inside a `<p>` — "test" lands on line 2 of a brand-new note. (d) Empty-bg-span residue cleanup — runs UNCONDITIONALLY (not gated on `wasNonCollapsed`): walks up while parent is an empty `<span bg>` and peels each layer off, repositioning the range. Catches both Ctrl+A + delete residues AND backspace-emptied spans. Without this, the matching-bg short-circuit returns early ("Chrome will extend"), but Chrome strips the empty inline element and inserts plain text in the parent block — "first-char-plain" regression. (e) `<br>`-only block cleanup — when the block ancestor (`<p>` etc, NOT editArea) has only a `<br>` child, strip the `<br>` and reset r to (block, 0). Mirrors what Chrome does natively when typing into an empty contenteditable; we mirror it because our manual insert bypasses Chrome's native cleanup. **Defensive `wasNonCollapsed` gate on `inMatchingBg` short-circuit**: when we just did a `deleteContents`, force the explicit insert path (skip the matching-bg short-circuit) so the typed char gets a guaranteed bg span even if a residue we didn't catch is wrapping the cursor. Trade-off: occasionally produces nested same-colour spans like `<span bg:X><span bg:X>a</span></span>`, visually identical to the unnested form. The agent investigation (May 2026, three parallel agents — code-path / DOM-invariants / reference-impls) is what produced the stored-marks design; future work in this area should re-read the agents' findings before introducing new state machines.

31. **Matching-bg extension MUST be manual; Chrome's native extension misbehaves at inline boundaries.** When `_applyStagedHilite` sees a collapsed cursor inside a span whose bg matches `_stagedHi` (the "extend the existing run" case), DO NOT just `return` and let Chrome handle it. Confirmed via console logging: Chrome's native insertion at a trailing-edge inline position EMPTIES the matching span and merges the typed char (as `&nbsp;`) into the PREVIOUS adjacent span, then jumps the cursor with it. Result: every other space ends up in the wrong colour. The fix is to manually extend the existing text node via `r.startContainer.insertData(r.startOffset, data)` + `e.preventDefault()`, gated on `r.startContainer.nodeType === 3` (text node — element-level matching is rare and falls through to the regular insert which produces a redundant nested span, visually correct). **Two more rules for the manual-extension path**: (a) **Convert typed `" "` (space) to ` ` (nbsp) unconditionally** — CSS `white-space: normal` collapses a regular ASCII space at the trailing edge of inline content, so the FIRST space typed in a fresh bg span would visually disappear ("first space didn't take"). nbsp doesn't collapse and renders reliably. Trade-off: line-wrap cannot break at those spaces, but highlighted phrases are typically short. The same conversion applies to the SPAN-INSERT path's `span.textContent` for the first char in a freshly-escaped span. (b) **`fgMatches` check** — if `_pickedFg` is set and differs from the bg span's `style.color` (user picked a new text colour while the cursor sits inside an existing highlight), DO NOT extend; fall through to the SPAN-INSERT path, which builds a nested `<span bg color>` with the new colour over the same bg. Without this, MANUAL-EXTEND silently writes new text into the existing text node and the span's old `color` style applies — text colour changes inside a highlight silently get ignored. The check uses `colorToHex` to normalise rgb()/hex for comparison. Subsequent same-colour chars then match the new inner span and extend it via MANUAL-EXTEND.

### Preview Image Pixaroma Patterns (do not regress)

These patterns were hard-won during the May-2026 batch + save-mode upgrade. Several of them generalize to ANY canvas-rendered preview node, so re-read this section before building a similar widget.

1. **Native PreviewImage layout pattern: constant `minHeight` + fit-contain in available space — DO NOT mutate node size based on image aspect.** ComfyUI's `useImagePreviewWidget` returns `{ minHeight: 220 }` and inside `draw()` computes `scale = Math.min(slotW/imgW, slotH/imgH, 1)` to fit the image in WHATEVER rect the user-resized node grants. We tried two earlier approaches that both failed: (a) `computeSize` returns aspect-driven height + `node.setSize` to fit on frame load — caused FLICKER on every resize because `fitNodeToWidgets` snapped height back mid-drag; (b) cap aspect-driven height at a max — still snapped on aspect changes (portrait → landscape left empty grey). The only correct pattern is: `computeSize` returns a constant minimum; `draw` reads `Math.max(MIN_H, node.size[1] - y)` for actual height; image is fitted inside via min-scale. User can resize freely both directions, image always fits, no flicker. See `js/preview/index.js` `layoutImgStrip` + `createStripWidget.computeSize` + `createStripWidget.draw`.

2. **`widget.mouse()` only fires for clicks INSIDE the widget's `computeSize` bounds — clicks in the extended-draw area below need a node-level `onMouseDown` fallback.** This is the consequence of (1): when the strip widget reports `minHeight: 220` but draws at e.g. 600px (tall node), LiteGraph's click router uses the 220 figure for hit-testing. Clicks below that line aren't routed to `widget.mouse()` at all. The fix is a DUAL CLICK PATH: a shared `handleStripClick(node, lx, ly)` helper called from BOTH `widget.mouse()` AND `nodeType.prototype.onMouseDown` (which fires when no widget claimed the click). Both use the same hit-rects from `_pixaromaCells`. Without the dual path, big nodes lose click on bottom thumbnails. The earlier finding that `widget.mouse() returning false doesn't fall through to node.onMouseDown` is true ONLY when LiteGraph routed the click to the widget in the first place — for clicks outside widget bounds, `node.onMouseDown` does fire, hence the fallback works.

3. **Pixaroma-specific UI key (`pixaroma_preview_frames`) instead of `ui.images` — required to disable LiteGraph's native image strip rendering.** Returning `ui.images` from a Python node causes ComfyUI to populate `node.imgs` and draw its own image strip below the widgets. Our custom strip would render on top → double rendering. Save Mp4 set the precedent (`pixaroma_videos`); we follow it. Frontend listens to `api.addEventListener("executed", ...)`, reads `detail.output.pixaroma_preview_frames`, and renders. Cross-version node-id resolution — `app.graph.getNodeById(detail.node)` first, then `parseInt(detail.node, 10)` if string — required because Vue passes the node id as a string while legacy passes a number (Save Mp4 pattern, used in multiple Pixaroma nodes).

4. **Preview persistence across workflow tab switching: store frame metadata on `node.properties`, hydrate on `onConfigure` AND `queueMicrotask(onNodeCreated)`.** This is the **standard Pixaroma persistence pattern for any preview-style node** — IMPORTANT to reuse for future preview nodes that need to survive Vue tab switches. Frame URLs (filename + subfolder + type), selected index, expanded state — all live on `node.properties.pixaromaXxx`. LiteGraph serializes `properties` to workflow JSON natively, so persistence is automatic. On node restoration, a small `restoreFromProperties(node)` helper re-loads HTMLImageElements from the persisted URLs. Wire it from BOTH (a) `queueMicrotask(() => restoreFromProperties(this))` inside `onNodeCreated` (Vue Compat #8 — `onNodeCreated` fires BEFORE `configure()` so we defer past it), AND (b) `nodeType.prototype.onConfigure` (belt-and-braces for paths that bypass the microtask). The function is idempotent via an early-return guard `if (node._pixaromaFrames?.length) return`. Use this exact pattern for any new node where the user shouldn't lose preview state when switching tabs. The temp/ PNG files survive workflow switching (cleared only on ComfyUI restart) — for permanent persistence across restarts, write to output/ via the save_mode pattern below.

5. **Hover state on canvas-drawn buttons: read `app.canvas.graph_mouse` inside `draw()`, no extra wiring.** LiteGraph already redraws on every pointermove, so reading `graph_mouse` per draw call gives free per-frame hover detection. Convert to node-local: `mx = graph_mouse[0] - node.pos[0], my = graph_mouse[1] - node.pos[1]`. Hit-test against the same rect the click handler uses. Branch the fill/stroke style on hover. This is what native ComfyUI does for the X close button on PreviewImage — no DOM widget needed. We use `BRAND` (orange) on hover and dark gray otherwise. The cursor change (CSS `cursor: pointer`) is optional and conflicts with LiteGraph's own cursor management — skip unless really needed.

6. **`save_mode` widget pattern (preview / save combo) for nodes that should be both preview and save destinations.** Adds a required combo widget and `prompt: PROMPT, extra_pnginfo: EXTRA_PNGINFO` hidden inputs in `INPUT_TYPES`. Default to `preview` for preview-first nodes. In `save` mode, iterate the entire batch, call `folder_paths.get_save_image_path(prefix, output_dir, w, h)` once for the base counter, then save each frame as `{name}_{counter+i:05}_.png` with embedded metadata via the shared `nodes/_save_helpers._build_pnginfo`. Same pattern Save Mp4 uses (with `save` / `preview` routing to output/ vs temp/). For backwards compat: a workflow saved before the `save_mode` widget existed loads with the default — verified for Preview Image Pixaroma. Same pattern can be applied to other preview nodes wanting save-on-execute.

7. **Save-to-Disk filename auto-increment via per-node session offset (`_pixaromaDiskOffset`).** `folder_paths.get_save_image_path` only sees files in ComfyUI's `output/`, not the user's chosen disk location. So every Save-to-Disk click would suggest the same filename. Fix: track a per-node click counter (`node._pixaromaDiskOffset`), bump after each successful save, apply via `bumpFilenameCounter("img_00002_.png", offset)` to the server-suggested name. Reset to 0 on each `executed` event (new run = fresh counter base from output/). NOT persisted across workflow saves — accepted trade-off since disk save locations are user-chosen anyway.

8. **`_safe_prefix(s)` validator — relative-import shared helper module + dual contract (None vs fallback string).** Lives in `nodes/_save_helpers.py`. Returns `None` on invalid input. Caller decides: backend node uses `_safe_prefix(s) or "Preview"` (don't crash workflow); server route uses `if not prefix: return 400` (surface error to JS toast). Allows `[A-Za-z0-9_\-%]` segments separated by `/`, rejects `..`, leading `/`, empty segments, length > 256. `\\` is normalized to `/` for Windows convenience. **`%` is permitted in segments** so two layers of token expansion both work: (a) **VHS-style `%date:FMT%`** is expanded BEFORE validation by `_expand_date_tokens` (Java-style codes `yyyy yy MM dd HH mm ss`, two-pass sentinel swap to avoid `yyyy`/`yy` collision, bad format strings leave the token literal so the user can spot the typo); (b) **native ComfyUI tokens** `%year% %month% %day% %hour% %minute% %second% %width% %height%` survive validation as literal `%`-delimited segments and are expanded later by `folder_paths.get_save_image_path.compute_vars`. Net result: `%date:yyyy-MM-dd%/images/fish_` and `%year%-%month%-%day%/img` both work. Path traversal is impossible: our regex still rejects `..`, ComfyUI does its own `os.path.commonpath` check after its expansion, and Java date codes can only emit digits. `nodes/_save_helpers.py` is imported via `from .nodes._save_helpers import _build_pnginfo, _safe_prefix` (relative import, package-aware) — NEVER `from nodes._save_helpers` because that collides with ComfyUI's top-level `nodes.py`. The `nodes/` directory is an implicit namespace package (no `__init__.py`) and that's fine.

9. **Tracking the "active" preview node for global keybindings (`_activePreviewNode`).** Module-scope `let _activePreviewNode = null`. Set on click that enters expanded mode; clear on X close, Esc, OR `nodeType.prototype.onRemoved` (so deleted nodes don't dangle a reference and prevent GC of their loaded images). Window-level `keydown` listener routes ←/→/Esc to whichever node is active, with `INPUT/TEXTAREA/contentEditable` exclusion so the user can still type. Use capture-phase (`true` 3rd arg to `addEventListener`) so we preempt ComfyUI's canvas-pan keybindings. Same pattern can be reused for any other node that needs document-level keyboard control while focused.

10. **Inline expand-in-place over fullscreen lightbox.** Native PreviewImage doesn't dim the canvas behind a lightbox — clicks on the strip thumbnail expand THE SAME widget into a single-image view (X close, counter, dimensions). Stay inside the node body. Two earlier attempts went different directions and were rejected by the user: (a) full-viewport overlay with 0.92 black backdrop ("not fullscreen"); (b) viewport-centered card without backdrop ("not like that, like preview imafge from comfyui does"). The final shape is: same strip widget, two render modes via `_pixaromaExpanded` flag, all controls drawn on the node canvas. Click-image-to-advance gives quick batch flipthrough without exiting expanded mode.
- `_safe_path()` in `server_routes.py` — validates all file paths stay within `PIXAROMA_INPUT_ROOT`
- IDs validated against `^[a-zA-Z0-9_\-]+$` regex (max 64 chars)
- Base64 payloads capped at 50 MB
- Note sanitizer (`js/note/sanitize.mjs`) — allowlist-based. Anything user-reachable (link insert, code-view HTML edit, paste) must round-trip through `sanitize(html)` before being written to the DOM or saved. Class allowlist covers only Pixaroma-specific classes; style allowlist covers only `color`, `background-color`, `text-align`; href allowlist is `http:`, `https:`, `mailto:`.

### Offline-first: Vendored Three.js
The 3D Builder used to `import("https://esm.sh/three@0.170.0/…")` at runtime, which
broke with `ERR_CONNECTION_RESET` for any user running ComfyUI offline or behind a
restrictive proxy. Three.js is now vendored inside the plugin.

- **On disk**: `assets/vendor/three/three.mjs` plus every jsm addon the editor
  touches (controls, postprocessing, loaders, utils, geometries). Each jsm addon
  only imports `../../../three.mjs`, so copying the esm.sh "es2022" build
  preserves all relative resolution with zero rewrites.
- **Served at**: `/pixaroma/vendor/{tail}` — route in `server_routes.py`. Accepts
  arbitrary depth, blocks `..` traversal and any chars outside `[A-Za-z0-9_\-./]`,
  realpath-checks the result stays under `PIXAROMA_VENDOR_DIR`.
- **Entry point**: `THREE_VENDOR = "/pixaroma/vendor/three"` exported from
  `js/3d/core.mjs`. All dynamic `import()` calls in `core.mjs`, `importer.mjs`,
  and `shapes.mjs` go through it.
- **Upgrading three.js**: re-fetch `https://esm.sh/three@<VERSION>/es2022/*` for
  each file listed under `assets/vendor/three/`, keeping the relative paths
  identical. The addons import `../../../three.mjs` so the directory layout must
  stay `three.mjs` at the root with `examples/jsm/<category>/*.mjs` for addons.

**Do not** reintroduce esm.sh/unpkg/jsdelivr imports for three.js or its addons.

### 3D CSS isolation
`injectExtraStyles()` in `js/3d/core.mjs` adds global `<style>` rules to `<head>`.
These must be scoped to a **3D-only** class (`.p3d-workspace`) — NOT the shared
`.pxf-workspace` framework class — because the stylesheet persists in the DOM
after the 3D editor closes and bleeds into every other editor.

In particular, `.pxf-workspace canvas { position:relative; z-index:1 }` used to
override Paint's `.ppx-cursor-canvas { position:absolute }` via selector
specificity, unstacking the brush-ring cursor overlay canvas so it shifted
below the display canvas — the brush preview disappeared after a 3D session.
The 3D `open()` path now adds `.p3d-workspace` to its workspace element, and
the CSS rule targets that class only.

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
| Add / change Resolution Pixaroma sizes per ratio | `js/resolution/index.js` `SIZES` const + `DEFAULT_PER_RATIO` (per-ratio click default) — keep the spec doc table in sync. Layout sizing (NODE_H / WIDGET_H / list min-height) lives at the top of the same file. State schema on `node.properties.resolutionState` + `app.graphToPrompt` injection hook at the bottom of the file (Pattern #9). |
| Fix / extend Note toolbar (buttons, pickers) | `js/note/toolbar.mjs` |
| Add / change a toolbar mask-icon | `js/note/css.mjs` (`.pix-note-tbtn-maskicon` for single-layer, `.pix-note-tbtn-maskicon-multi` for two-layer color pickers) + SVG files in `assets/icons/ui/` (two-layer icons need `<name>-outline.svg` + `<name>-drop.svg`) + `makeMaskIcon`/`makeMaskIconMulti` call in `toolbar.mjs` |
| Change per-note colour pickers (Btn, Ln, Bg, text, highlight) | Two architectures: text + highlight use the COMPACT picker (`openPixaromaCompactColorPickerPopup` in `js/shared/color_picker.mjs` — swatches + Reset + "More colors..." footer; modal opens on More). Bg / Btn / Ln use the live-preview popup (`openPixaromaColorPickerPopup`) via the `makeColorPicker` factory in `js/note/toolbar.mjs`. Sticky-pick state is `editor._pickedFg` (text) and `editor._stagedHi` (highlight); both cleared in `_cleanup`. Text application: `execCommand("foreColor")` at pick + `_restageColors` on every selectionchange (Pattern #25). Highlight application: `beforeinput` handler in `core.mjs` → `_applyStagedHilite` in `toolbar.mjs` does manual char insert with `e.preventDefault()` (Pattern #21). `js/note/render.mjs` writes Btn/Ln CSS vars on canvas body; `core.mjs` `_applyCfgColorsToEditArea` writes same vars on the editor's contenteditable on each open. |
| Fix Note block dialogs (Download/YT/Discord, link, code) | `js/note/blocks.mjs` (+ `_promptLinkUrl`/`_promptCodeBlock` in toolbar.mjs) |
| Change what HTML/attrs/classes are allowed in a note | `js/note/sanitize.mjs` (allowlists) |
| Change how a note renders on canvas or node colour behaviour | `js/note/render.mjs` (`renderContent`) |
| Change Note default colour / size / placeholder | `js/note/index.js` DEFAULT_CFG + `nodes/node_note.py` widget default (keep in sync) |
| Add / manage inline note icons (SVG library) | Drop SVGs into `assets/icons/note/`. Label derivation + list endpoint live in `server_routes.py`'s `/pixaroma/api/note/icons/list` route, mirrored in `js/note/icons.mjs::deriveLabel`. Both must stay in sync if you change the rules. To add a new SIZE preset, edit ALL of: `js/note/css.mjs` (new `.pix-note-ic[data-size="<id>"]` rule), `js/note/sanitize.mjs` (extend `IC_SIZE_RE`), `js/note/icons.mjs::openIconPop` (new pill in `sizes` array). Picker color + size are session-sticky on `editor._iconPickerColor` / `editor._iconPickerSize`, set in `core.mjs::open()` and reset in `_cleanup()`. Atomic Backspace/Delete handler also lives in `core.mjs::open()` (`_iconKeyHandler` listener on `_editArea`). |
| Change inline-icon rendering (size / alignment / color model) | `js/note/css.mjs` base `.pix-note-ic` rule + per-icon rules dynamically injected by `js/note/icons.mjs::injectIconCSS`. Picker popup styles: `.pix-note-iconpop` family in `css.mjs`. |
| Toggle / change Align Pixaroma snap behavior | `js/align/index.js` (single file). Settings: `Pixaroma.Align.Enabled` (boolean, mirrors the toolbar button) + `Pixaroma.Align.SnapDistance` (slider 4-16). Hooks: window pointermove for snap (NOT `LGraphCanvas.processMouseMove`, which Vue does not invoke); `LGraphCanvas.drawFrontCanvas` wrap for guide rendering (NOT `onDrawForeground`, unreliable in Vue per Compat #1). WRAP-don't-replace pattern coexists with rgthree-comfy and the "NodeAlign" extension. Shift bypasses snap (Alt is taken by ComfyUI for duplicate-during-drag). Active guides drawn in BRAND #f66744 with `lineWidth = 1` in screen space (manual graph -> screen transform) so the stroke is exactly 1 screen pixel at any zoom. Snap distance is `state.snapDistPx / canvas.ds.scale` graph units, computed every tick (so zoom changes mid-drag are honored). |
| Add backend route | `server_routes.py` |
| Add a new Python node | `nodes/node_<name>.py` |
| AudioReact Pixaroma — change motion mode or overlay effect | `nodes/_audio_react_engine.py` (engine — all motion functions, overlays, audio helpers `bandpass_fft` / `audio_envelope` / `onset_track`, `process_aspect`, `Params` dataclass, `MOTION_MODES` / `OVERLAYS` registries, `generate_video()`). NEVER inline math into `node_audio_studio.py`; divergence breaks parity. Update `docs/audio-react-math.md` first, then engine, then `js/audio_studio/shaders.mjs` (GLSL mirror), then re-run `scripts/audio_parity_check.py --regenerate` and the browser parity harness. |
| AudioReact Pixaroma — change effect math | DO NOT change in `node_audio_studio.py`. Update `nodes/_audio_react_engine.py` only. Mirror the change to `js/audio_studio/shaders.mjs` (GLSL). Update `docs/audio-react-math.md` (single source of truth). Re-run the parity scripts. |
| AudioReact Pixaroma — editor UI / sidebar | `js/audio_studio/ui.mjs` (controls / tabs) + `js/audio_studio/core.mjs` (open/close/save/discard, source resolution, undo, header pills). |
| AudioReact Pixaroma — transport / playback | `js/audio_studio/transport.mjs` (play / pause / scrub / sparkline / Web Audio sync). |
| AudioReact Pixaroma — WebGL pipeline | `js/audio_studio/render.mjs` (orchestration: framebuffer setup, motion + overlay passes, uniform binding) + `js/audio_studio/shaders.mjs` (per-mode GLSL). Reload page (Ctrl+F5) after shader edits — module cache is sticky. |
| AudioReact Pixaroma — Python entry point | `nodes/node_audio_studio.py` (thin wrapper — `optional` image/audio inputs + `hidden` studio_json; engine math lives in `nodes/_audio_react_engine.py`; `_migrate_cfg` for forward-compatible schema bumps). |
| AudioReact Pixaroma — upload route | `server_routes.py` `/pixaroma/api/audio_studio/upload`. Image: PNG / JPG / JPEG / WebP. Audio: WAV only (browser converts MP3 / OGG / etc. via `decodeAudio` + `encodeWav` in `js/audio_studio/audio_analysis.mjs` before upload — keeps Python dep-free). 50MB per file, 100MB combined per node dir. |
| AudioReact Pixaroma — config schema | `js/audio_studio/index.js` `DEFAULT_CFG` MUST stay in sync with `Params` defaults in `nodes/_audio_react_engine.py` (AudioReact Pattern #1). `nodes/node_audio_studio.py` `_migrate_cfg` handles version bumps. |
| Save Mp4 Pixaroma — change widgets / encoder flags / output naming | `nodes/node_save_mp4.py`. ffmpeg binary resolved via `_resolve_ffmpeg` (imageio-ffmpeg first, ffmpeg on PATH fallback, clear install hint on failure). Frames piped to ffmpeg's stdin as raw rgb24 (no temp PNGs). Audio (optional) is written to a temp WAV via `_write_wav_pcm16` (stdlib `wave` + numpy, NO torchaudio dep) and passed as a second `-i` input so muxing is one ffmpeg call. Stderr drained in a daemon thread to avoid Windows pipe-buffer deadlock. `trim_to_audio` adds `-shortest` only when audio is present. `save_mode` widget (`save` / `preview`, default `save`) routes the encoded mp4 to ComfyUI's `output/` folder (kept across restarts) vs `temp/` folder (auto-cleared on ComfyUI restart, no clutter while iterating) — the only difference is the destination root + the `entry.type` field (`"output"` vs `"temp"`); the in-node `<video>` preview works identically because `js/save_mp4/index.js::buildViewUrl` already reads `entry.type`. Output naming via `folder_paths.get_save_image_path` so the counter auto-increments inside whichever root. `OUTPUT_NODE = True` (terminal). Encoder defaults are baked into class attrs `_CRF` (19) + `_PIX_FMT` (yuv420p) — promote them back to INPUT_TYPES if a workflow needs control. Returns `{"ui": {"images": [...], "pixaroma_videos": [...]}}`; the `pixaroma_videos` key is consumed by `js/save_mp4/index.js` to render the in-node `<video>` preview. |
| Save Mp4 Pixaroma — in-node video preview | `js/save_mp4/index.js`. Single index.js entry. On `nodeCreated` adds a DOM widget containing a `<video>` element + a placeholder div, both attached via `addDOMWidget(name, type, element, {serialize: false, getMinHeight: () => 180})`. Subscribes to `api.addEventListener("executed", ...)` and looks for `detail.output.pixaroma_videos` from our Python node — when found, sets the `<video>.src` to `/view?filename=...&subfolder=...&type=output&t=<timestamp>` (cache-busted) and toggles placeholder off. Node id resolved with both string and parseInt fallbacks for cross-version compat. |
| Fix composer blend mode save/restore/execute | `js/composer/interaction.mjs` (save), `render.mjs` (restore), `ui.mjs` (dropdown sync), `nodes/node_composition.py` `_blend_over()` |
| Paint AI Background Removal panel | `js/paint/core.mjs` `_buildBgRemovalPanel` + `_removeBgFromActiveLayer` (button gated on `ly.sourceKind === "image"`, set by the `onAddImage` handler and serialized as `source_kind` in the layer project JSON). Reuses the `/pixaroma/remove_bg` backend route via `PaintAPI.removeBg`. |
| Preview Image Pixaroma — change button or strip / grid layout / geometry / colors | `js/preview/index.js` constants at the top (`BTN_H`, `BTN_GAP`, `MIN_W`, `MIN_H`, `DEFAULT_W`, `DEFAULT_H`, `IMG_STRIP_GAP`, `IMG_STRIP_V_PAD`, `IMG_STRIP_BORDER_W`, `BADGE_*`, `LAYOUT_TOGGLE_*`, `COLOR_ACTIVE_*` / `COLOR_DISABLED_*`). Button rects computed in `computeButtonRects`, painted in `paintBtn`. Strip (single horizontal row) rects via `layoutImgStrip`; Grid (2D wrap, `rows = ceil(sqrt(N)); cols = ceil(N/rows)`, matches native PreviewImage) via `layoutImgGrid`. Layout selection in `createStripWidget().draw` reads `getLayoutMode(node)` which checks `node.properties.pixaromaLayout` ('grid' / 'strip') with fallback to setting `Pixaroma.Preview.DefaultLayout`. Per-node toggle icon painted via `paintLayoutToggle` (top-right, hover-aware, glyph shows the OPPOSITE mode = what you'll switch to on click). Buttons + strip live as `addCustomWidget`s (so they reserve vertical space, draw immediately on node-add, and Vue-compat works). Don't switch back to `onDrawForeground` (Vue Compat #1) and don't return `ui.images` from the Python node (LiteGraph would render its native strip underneath the custom one — use the `pixaroma_preview_frames` custom UI key instead, Save Mp4 pattern). |
| Preview Image Pixaroma — change save flow / routes | Backend: `nodes/node_preview.py` (tensor → PNG, two modes: temp/ for preview, output/ for save with embedded metadata via shared `nodes/_save_helpers._build_pnginfo`) + `server_routes.py` helpers `_embed_workflow_metadata` (thin wrapper), `/pixaroma/api/preview/save`, `/pixaroma/api/preview/prepare`. Both routes validate `filename_prefix` via shared `nodes/_save_helpers._safe_prefix` (allows `subfolder/prefix` with `[A-Za-z0-9_-]` segments, no `..`). Prepare route returns JSON `{image_b64, suggested_filename}` — `suggested_filename` peeks `folder_paths.get_save_image_path` to pre-fill the Save-to-Disk picker with the next free counter. Frontend: `js/preview/index.js` `saveToOutput` / `saveToDisk` read the SELECTED frame from `node._pixaromaFrames[node._pixaromaSelectedFrame]`. Both POST a dataURL + the workflow/prompt from `app.graphToPrompt()`. Metadata embedding lives in `nodes/_save_helpers._build_pnginfo` only (single source of truth). |
| Preview Image Pixaroma — add / change save_mode behavior or hidden inputs | `nodes/node_preview.py`. `INPUT_TYPES` declares `save_mode` as a required combo (`preview` / `save`, default `preview`) and `prompt: PROMPT, extra_pnginfo: EXTRA_PNGINFO` as hidden inputs. In `save` mode the node iterates the entire batch, calls `folder_paths.get_save_image_path`, and saves each frame to `output/{subfolder}/{name}_{counter+i:05}_.png` with embedded metadata — drop-in for native SaveImage. In `preview` mode it writes UUID-named PNGs to `temp/` (auto-cleared on ComfyUI restart). Either mode returns `ui.pixaroma_preview_frames` (custom key). |
| Notify Pixaroma — add or swap a sound | Drop a `.mp3` (or `.wav`/`.ogg`) into `assets/sounds/`, restart ComfyUI. `_list_sounds()` in `nodes/node_notify.py` auto-enumerates the folder at every `INPUT_TYPES()` call. No code changes needed. To remove a sound, delete its file. |
| Notify Pixaroma — change widgets / Python contract | `nodes/node_notify.py` (single file, ~80 lines). `INPUT_TYPES` declares `any` (AnyType wire), `enabled` (BOOLEAN), `sound` (combo from `_list_sounds()`), `volume` (INT 0-100), `label` (STRING). `IS_CHANGED` returns `float("nan")` so the node always re-executes (notification fires on every Run, even when upstream is fully cached). `notify()` returns `{"ui": {"pixaroma_notify": [{sound, volume, label}]}}` when enabled, else `{"ui": {}}`. AnyType class overrides `__ne__` to bypass ComfyUI's strict type matching. Per-node `enabled=false` is symmetric silent on Python and JS (no print, no event). |
| Notify Pixaroma — change JS audio / Preview button / Settings | `js/notify/index.js` (single file, ~65 lines). `playSound(filename, volume01)` helper builds URL `/pixaroma/assets/sounds/<name>` and `<audio>.play()`s. `app.registerExtension` declares the master toggle `Pixaroma.Notify.Enabled` under category `["👑 Pixaroma", "Notify"]`. `setup()` registers ONE global `api.addEventListener("executed", ...)` listener that reads `pixaroma_notify` and gates on the master setting. `beforeRegisterNodeDef` adds a native `▶ Preview` button via `addWidget("button", ...)` that bypasses both master and per-node toggles (manual override - the user is actively asking to hear the sound now; toggles only gate automatic notifications during workflow runs). |

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
