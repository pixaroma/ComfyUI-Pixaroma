# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
ComfyUI-Pixaroma is a custom node plugin for ComfyUI that adds interactive visual editors (3D Builder, Paint Studio, Image Composer, Image Crop) directly inside ComfyUI workflows. It has zero core dependencies — PIL and PyTorch come from ComfyUI's environment.

## Development Setup
No build step. Install by placing this folder in `ComfyUI/custom_nodes/`. ComfyUI auto-imports `__init__.py` on startup.

Optional background removal feature:
```bash
pip install rembg onnxruntime
```

No test suite or linting configuration exists in this project.

## Architecture

### Entry Points
- `__init__.py` — Aggregates all node classes, registers routes, exports `WEB_DIRECTORY = "./web"`
- `server_routes.py` — 9 aiohttp HTTP routes for file I/O and AI features
- `nodes/*.py` — Individual node implementations
- `web/js/pixaroma_base_editor.js` — Frontend UI base (Template Method pattern); all editors extend this

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

### Frontend Module Structure
Each editor follows the same pattern:
- `pixaroma_<name>.js` — Entry point, ComfyUI widget registration
- `pixaroma_<name>_core.js` — Core editor logic
- `pixaroma_<name>_api.js` — API calls to backend
- `pixaroma_shared.js` — Shared utilities
- `pixaroma_node_utils.js` — ComfyUI node integration helpers

### Editor Isolation
Each editor is a self-contained sub-project. When working on a specific editor, **only read and modify files belonging to that editor** (`pixaroma_<name>*.js` and `nodes/node_<name>.py`). The only shared dependency across all editors is `PixaromaEditorBase` in `web/js/pixaroma_base_editor.js` — read it for context but be cautious modifying it as changes affect every editor.

### Security Patterns (do not remove)
- `_safe_path()` in `server_routes.py` — validates all file paths stay within `PIXAROMA_INPUT_ROOT`
- IDs validated against `^[a-zA-Z0-9_\-]+$` regex (max 64 chars)
- Base64 payloads capped at 50 MB

## Adding a New Node
1. Create `nodes/node_<name>.py` with `NODE_CLASS_MAPPINGS` and `NODE_DISPLAY_NAME_MAPPINGS`
2. Import and merge in `__init__.py`
3. If it needs a visual editor: create `web/js/pixaroma_<name>.js` (entry), `_core.js`, `_api.js`
4. If it needs backend routes: add to `server_routes.py` and register in `__init__.py`

## Publishing
CI/CD auto-publishes to the ComfyUI registry when `pyproject.toml` is pushed to `main`. Do not modify `pyproject.toml`, `LICENSE`, or `.clauderules` or `.github/workflows/publish.yml`.
