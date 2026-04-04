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
│   ├── objects.mjs     # Object CRUD, selection, geometry, materials
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

## Publishing
CI/CD auto-publishes to the ComfyUI registry when `pyproject.toml` is pushed to `main`. Do not modify `pyproject.toml`, `LICENSE`, or `.clauderules` or `.github/workflows/publish.yml`.
