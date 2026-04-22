<div align="center">
  <img src="https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/assets/pixaroma_logo.svg" width="120" alt="Pixaroma Logo">
  <h1>ComfyUI Pixaroma</h1>
  <p align="center">
    <strong>Elevate your ComfyUI workflow with professional-grade creative tools.</strong><br />
    3D scenes • Texture painting • Layered composition • Precision cropping • Rich notes • Side-by-side comparison
  </p>

  <p align="center">
    <a href="https://github.com/pixaroma/ComfyUI-Pixaroma/blob/main/LICENSE"><img src="https://img.shields.io/github/license/pixaroma/ComfyUI-Pixaroma?style=flat-square&color=blue" alt="License"></a>
    <a href="https://discord.gg/gggpkVgBf3"><img src="https://img.shields.io/badge/discord-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord"></a>
    <a href="https://www.youtube.com/@pixaroma"><img src="https://img.shields.io/badge/youtube-red?style=flat-square&logo=youtube" alt="YouTube"></a>
  </p>
</div>

---

## 🎨 Creative Suite

Pixaroma transforms ComfyUI into a powerful design environment, bringing professional editing capabilities directly into your node-based workflows.

### 🧊 3D Builder
A complete WebGL 3D scene editor inside ComfyUI. Drop in primitives, procedural shapes, or composite assets (trees, houses, furniture, vessels, and more) and craft reference scenes for ControlNet, depth maps, or compositions. Import your own GLB/OBJ models with textures. Full camera control (perspective + isometric + axis views), interactive lighting with studio HDR, shape-specific slider panels, undo/redo, transform sliders, drop-to-floor, and live layer thumbnails.
![3D Builder — Node](workflows/3D%20Builder%20Pixaroma%20Workflow.jpg)
![3D Builder — Editor](workflows/3D%20Builder%20Pixaroma%20Workflow%20v2.jpg)

### ✨ Image Composer
Advanced layer-based composition. Move, scale, and rotate multiple images with a visual interface. Use the eraser tool with a soft brush for manual masking, or leverage the built-in AI background removal for instant object isolation. Perfect for pre-processing or final touch-ups.
![Image Composer — Node](workflows/Image%20Composer%20Pixaroma%20Workflow.jpg)
![Image Composer — Editor](workflows/Image%20Composer%20Pixaroma%20Workflow%20v2.jpg)

### 🖌️ Paint Studio
A professional-grade painting suite optimized for performance. Features a robust layer system, customizable brushes, blend modes, and a dedicated smudge tool for seamless blending. Ideal for inpainting, custom masks, or creating textures from scratch.
![Paint — Node](workflows/Paint%20Pixaroma%20Workflow.jpg)
![Paint — Editor](workflows/Paint%20Pixaroma%20Workflow%20v2.jpg)

### ✂️ Precision Crop
No more guessing crop coordinates. Graphically define your crop area with interactive handles. Includes standard aspect ratio presets (1:1, 16:9, 9:16) to ensure your output is perfectly framed for its final destination.
![Image Crop — Node](workflows/Crop%20Pixaroma%20Workflow.jpg)
![Image Crop — Editor](workflows/Crop%20Pixaroma%20Workflow%20v2.jpg)

### 🌓 Interactive Compare
The ultimate tool for model testing and workflow optimization. Compare two images side-by-side with a slider, vertically, via overlay blending, or using a difference map to highlight identical pixels vs. changes.
![Image Compare — Node](workflows/Image%20Compare%20Pixaroma%20Workflow.jpg)
![Image Compare — Editor](workflows/Image%20Compare%20Pixaroma%20Workflow%20v2.jpg)

### 📝 Note Pixaroma
Rich-text annotation node for documenting your workflow inline. Full WYSIWYG editor with a **Preview / Code** toggle — write like a normal doc, or drop into sanitized HTML when you want precise control. Bold / italic / underline / strikethrough, headings H1-H3, bulleted & numbered lists, tables (2-4 cols × 1-10 rows with Tab navigation between cells), code blocks, horizontal rules, per-text color and highlight. Per-note **Bg** color drives both the editor interior and the on-canvas node (title bar auto-darkens for readable contrast). Dedicated **Btn** and **Ln** pickers for pill backgrounds and line accents. **Button-Design pills** (Download / View Page / Read More) with optional folder hints ("Place in: ComfyUI/models/checkpoints") and size tags, plus preset **YouTube** and **Discord** pills. **42 inline SVG icons** shipped (CLIP / GGUF / LORA / VAE acronyms plus 38 workflow glyphs) in a drop-and-discover folder — drop more SVGs into `assets/icons/note/` and they appear in the picker, auto-scaled to surrounding font size. Click-to-edit pencil on every inserted block re-opens its dialog pre-filled. Built-in **Help** and **Code Reference** modals document every feature and every allowed HTML tag. Allowlist-based sanitizer strips scripts, event handlers, and unsafe URLs on save and paste.
![Note Pixaroma — Node](workflows/Note%20Pixaroma%20Workflow.jpg)
![Note Pixaroma — Editor](workflows/Note%20Pixaroma%20Workflow%20v2.jpg)

### 🏷️ Label & Utility
- **Label Tool:** Organize massive workflows with clean, customizable labels to keep your logic readable.
- **Show Text:** A vital debugging tool that displays the raw content of any input—be it tensors, latents, or string values.
![Labels — Node](workflows/Labels%20Pixaroma%20Workflow.jpg)
![Labels — Editor](workflows/Labels%20Pixaroma%20Workflow%20v2.jpg)

### 📐 Resolution Pixaroma
One-click resolution picker that outputs clean `width` and `height` INTs for any `EmptyLatent` or size-driven downstream node. 3×3 ratio chip grid (1:1 / 16:9 / 9:16 / 2:1 / 3:2 / 2:3 + Custom Resolution) with 8 curated sizes per ratio — including AI-video standards (832×480, 1280×720 for 16:9; 480×832, 720×1280 for 9:16; Wan 2.2 / CogVideoX / AnimateDiff friendly). Each ratio auto-selects a sensible default on click (e.g. 16:9 → 1280×720). **Custom Resolution** mode opens W/H number inputs with an inline **swap** icon between them, picks snap-step (8 / 16 / 32 / 64 px) with brand-orange active chip, arrow keys nudge by the picked step, plus a live aspect-ratio preview rectangle and ratio + megapixel readout. Locked node size (no accidental resize), workflow save/load round-trips the full state (ratio, picked size, custom values, snap choice).

---

## 🚀 Getting Started

### 1. Installation

#### **Method A: ComfyUI Manager (Recommended)**
1. Search for **Pixaroma** in the ComfyUI Manager.
2. Click **Install** and restart ComfyUI.

#### **Method B: Manual Installation**
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/pixaroma/ComfyUI-Pixaroma.git
```

### 2. Optional: AI Background Removal
Enable the **AI Remove Background** button in the Image Composer by installing `rembg`:

```bash
# Windows Portable
python.exe -m pip install rembg

# Standard Installation
pip install rembg
```

Once installed, the panel's **Model** dropdown shows what's available in your rembg version:

| Option | Model | Size | Notes |
|--------|-------|------|-------|
| **Auto (recommended)** | picks the best available | — | tries BiRefNet → isnet → u2net |
| **Fast** | `u2net` | ~176 MB | works on any rembg install |
| **Balanced** | `isnet-general-use` | ~170 MB | cleaner edges, needs rembg 2.0.27+ |
| **Best** | `birefnet-general` | ~900 MB | highest quality, needs rembg 2.0.56+ |

Models download automatically on first use to `ComfyUI/models/rembg/`. Options requiring a newer `rembg` are shown greyed out with the minimum version needed — upgrade with `python.exe -m pip install -U rembg` to unlock them.

---

## 📺 Learning Resources

Master the Pixaroma suite with our video guides and workflow deep-dives:

📺 **[Visit Pixaroma on YouTube](https://www.youtube.com/@pixaroma)**

---

## 🛠 Changelog

### **April 22, 2026 — Resolution Pixaroma**
A one-click resolution picker that outputs `width` + `height` as plain INTs for any latent / size-driven downstream node.

- 📐 **3×3 ratio chip grid** — 1:1 / 16:9 / 9:16 / 2:1 / 3:2 / 2:3 + full-width **Custom Resolution** row. Active chip highlighted in brand orange.
- 🎬 **8 curated sizes per ratio** including AI-video standards (832×480, 1280×720 for 16:9; 480×832, 720×1280 for 9:16 — Wan 2.2 / CogVideoX / AnimateDiff friendly).
- 🎯 **Per-ratio default on click** — 16:9 → 1280×720, 9:16 → 720×1280, 2:1 → 1280×640, etc. Not the smallest entry.
- ✏️ **Custom mode** — W/H number inputs with an inline swap-icon button between them (Figma-style), 4 inline snap-step chips (8 / 16 / 32 / 64 px) with brand-orange active state, arrow keys nudge by the chosen step, live aspect-ratio preview rectangle, ratio + megapixel readout.
- 🔒 **Locked node size** — no accidental resize; the layout never breaks.
- 💾 **Round-trip save/load** — workflow file restores the exact ratio, picked size, custom values, and snap choice with no flash on open.
- 🌑 **Brand-default dark colors** — nodes come up with a dark title + body out of the box; ComfyUI's native right-click Colors menu still works if you want to change.

### **April 22, 2026 — Note Pixaroma**
A brand-new rich-text annotation node. Replaces the "wall of Markdown as a comment" approach with a full WYSIWYG editor + sanitized Code view.

- 📝 **WYSIWYG editor** — Bold / Italic / Underline / Strikethrough, headings H1-H3, bulleted and numbered lists, tables (2-4 cols × 1-10 rows with Tab navigation between cells), code blocks (`<pre><code>`), horizontal rules, inline text color, highlight color.
- 🎨 **Per-note colors** — Bg picker drives both the editor interior AND the on-canvas node (title bar auto-darkens for readable contrast). Separate Btn picker for button-pill backgrounds and Ln picker for line accents (grid borders, HR, folder hints).
- 🔗 **Pixaroma blocks** — Button Design dialog produces Download / View Page / Read More pills with optional folder hints ("Place in: ComfyUI/models/...") and file-size tags. Preset YouTube and Discord pills with Pixaroma defaults.
- 🎯 **Inline icon library** — 42 SVG icons shipped (CLIP / GGUF / LORA / VAE acronyms + 38 workflow glyphs). Drop more SVGs into `assets/icons/note/` and they auto-appear in the picker. Size auto-scales with surrounding font, color follows the text picker.
- ✏️ **Click-to-edit pencils** — Every inserted block (link, pill, code, grid-free block) has a hover pencil that re-opens its dialog pre-filled for edits.
- 🧰 **Code view** — Edit raw sanitized HTML with syntax highlighting when you need precise control. Pretty-printed on entry, re-sanitized on exit.
- ❓ **Help + Code Reference modals** — Two built-in popup dialogs document every feature, every shortcut, and every allowed HTML tag / class / inline style — so even users hand-editing HTML know exactly what survives the sanitizer.
- 🛡️ **Allowlist sanitizer** — Strips `<script>`, `<iframe>`, `<img>`, all event handlers (onclick, onerror, …), and `javascript:` URLs automatically. Classes, styles, and `href` protocols are all explicitly allowlisted.
- 🌐 **Plays nicely with ComfyUI's native color menu** — Pick a color from the right-click Colors menu and our editor respects it across save/reload. Sync logic prevents the editor body from disagreeing with the canvas when both color sources are in play.
- 🎹 **Keyboard shortcuts** — Ctrl+B / I / U formatting, Ctrl+Z / Y undo/redo (with manual history for direct-DOM mutations), Ctrl+S save, Tab / Shift+Tab to navigate grid cells, Backspace to delete an inline icon in a single keystroke.

### **April 19, 2026**
- 🚪 **Clearer editor close button:** The titlebar's `✕` in every Pixaroma editor (Paint, 3D, Crop, Composer, Compare, Label) is now labeled `✕ Close <EditorName>` (e.g. "✕ Close Paint Pixaroma") and styled in red. This avoids confusion with the host window's close X — especially inside desktop launchers like ComfyUI-EZi where the two X icons sit next to each other. Hover tooltip confirms it only closes the editor, not ComfyUI.
- 🔌 **3D Builder works offline:** Three.js is now bundled with the node instead of being downloaded from the internet each time. No more blank 3D canvas when you're offline, on a flaky connection, or behind a firewall that blocks CDNs. Nothing to configure — it just works after you update and restart ComfyUI.
- 🖌️ **Paint cursor fix:** The brush ring preview could disappear after opening the 3D Builder once in the same session (a CSS rule from the 3D editor was leaking into Paint). The brush, pencil, eraser, and smudge cursors now stay visible no matter which editor you open first.
- 🎨 **Image Composer — Blend modes are back:** Per-layer blend modes (Multiply, Screen, Overlay, Soft Light, etc.) now round-trip correctly through save → reopen → workflow execution. Previously a layer set to Multiply would quietly revert to Normal on reopen, the Preview Image output would lose the blend whenever a layer had auto-rembg / placeholder / mask (the Python compositor ignored blend modes), and the node's mini-preview would overwrite itself with a Normal recomposite ~300 ms after execution. Fixed on all four touch points: project JSON save, in-editor restore + dropdown sync, Python compositor (full W3C Compositing L1 with proper Porter-Duff alpha — all 16 modes), and the post-execution client-side recomposite.
- 🎨 **Paint Studio — AI Background Removal panel:** New sidebar section mirrors the Image Composer's — Remove Background button, model dropdown (Auto / Fast / Balanced / Best), rembg status line. Shares the same backend route and model catalog. **Safer scope:** the button is only enabled on layers that started from an imported image (Add Image / drag-drop). Layers drawn from scratch with the brush stay grayed out so you can't accidentally rembg a stroke composition. Painting on top of an imported image keeps the layer rembg-eligible. One Ctrl+Z after a removal restores the original pixels.
- 🎮 **Blender-style shortcuts in 3D Builder** (all original shortcuts still work — these are added on top):
  - `G` — Move tool (Blender "Grab")
  - `Shift+D` — Duplicate selected
  - `Shift+A` — Open the Add 3D Object picker
  - `Alt+A` — Deselect all
  - `Esc` — Deselect all (or close the help overlay if it's open)
  - `.` / `Numpad .` — Focus on selected object

### **April 15, 2026 — 3D Builder v2**
A major overhaul turning 3D Builder from a primitives-only tool into a full scene editor. 
Check Tutorial on [Youtube Ep13](https://www.youtube.com/watch?v=DnKM-Np0fFw)

- 🧊 **18 primitive shapes** — Cube, Sphere, Cylinder, Cone, Torus, Plane, Pyramid, Capsule, Tube, Ring, Prism, Crystal, Dome, Gear, Teapot, Blob, Rock, Terrain. Every shape has its own slider panel with per-parameter control (height, radius, segments, seed, smoothness, etc.) and a "Reset Shape Defaults" button.
- 🌿 **16 composite shapes** — Multi-mesh groups that look like real objects: Tree, Pine Tree, Flower, Mushroom, Cactus, Cloud, House, Lamp Post, Fence, Signpost, Arch, Table, Chair, Bed, Couch, Bookshelf. Each has its own set of sliders (trunk height, tier overlap, window shape, shelf count, …) and a re-roll seed for variety.
- 🏺 **5 vessels with wall thickness** — Vase, Bottle, Goblet, Bowl, Plant Pot. All hollow, with a Thickness slider so you can actually see inside. Goblet is modeled as solid foot + solid stem + hollow cup.
- 🐇 **Bundled Bunny** — Stanford bunny as a one-click add, rendered with its original material.
- 📦 **GLB/OBJ import** — Load your own textured 3D models (supports MTL + companion textures for OBJ). Models load asynchronously, with a "Use Original Material" toggle to switch between the model's baked materials and your own color/roughness/metalness override.
- ➕ **"Add 3D Object" picker** — Categorised modal grid (Primitives / Organic / Nature / Architecture / Furniture / Vessels). One click drops the object into the scene.
- 🌍 **Greatly expanded Terrain** — 13 sliders for any kind of landscape: Size, Detail, Height, Scale, Octaves, Persistence, Lacunarity, Ridge (for mountains), Power, Flatness (for plateaus/fields), Edge Fall (for islands), Warp, Seed.
- 🎥 **Camera shortcuts & views** — `1` front, `2` side, `3` back, `4` top, `5` perspective, `6` isometric, `7` other side, `0` focus-on-selected. SVG icons on the camera panel buttons.
- 🎛️ **Transform sliders** — X / Y / Z sliders under the gizmo for Move, Rotate, and Scale modes. Bidirectional sync with the gizmo. "Lock Proportions" checkbox for uniform scaling. "Reset Transform" does a full reset + drop-to-floor.
- 🏷️ **Layer panel thumbnails** — Every layer row now shows a mini 3D render of the actual object (28×28, rendered off-screen at 2× then downscaled) instead of a colored dot. Cached per object, invalidates on geometry/color/scale changes.
- 🦶 **Drop to Floor** — Button in the layers panel that snaps any object's lowest vertex to y=0, even if rotated or scaled. Uses precise vertex AABB so rotated objects land flush on the grid.
- 🌅 **Studio Lighting + PMREM** — HDR environment map for realistic PBR lighting. Checkbox saves with the scene.
- ⏪ **Instant undo/redo for imports** — Imported models and composites are preserved across undo/redo (no more 2-3s flicker while the GLB/OBJ refetches). Composites rebuild synchronously — no placeholder sphere flicker.
- 💾 **Robust save format** — All params (including ones added in later versions) round-trip safely. Old v1 scenes load with new defaults for any missing fields.
- ⚙️ **ComfyUI Setting:** Pick your default background color for new 3D scenes under 👑 Pixaroma → 3D Builder.

### **April 14, 2026**
- 🖼️ **Transparent Background Save:** Paint Studio, Image Composer, and 3D Builder now have a "Transparent BG (Save to Disk)" checkbox next to the BG color picker. When enabled, "Save to Disk" exports a PNG with transparent background. The regular "Save" (workflow) is unchanged — existing workflows stay fully compatible.

### **April 13, 2026**
- 🎨 **Paint Studio Overhaul:** Custom tool cursors, smoother color picker (fixed HSL sliders, redesigned swatches), instant brush resize, locked layers enforced across all tools.
- 🌓 **Image Compare Redesign:** New control order with Right Left mode and solo-image toggle.
- ⚙️ **ComfyUI Settings Panel:** Pixaroma now has its own section (👑 Pixaroma) — first setting lets you pick the default compare mode.
- 🔄 **Composer Auto-Update & Fixes:** Preview refreshes automatically after execution, duplicate-layer mask bug fixed, placeholder ratio reset fixed.
- 🛠 **General:** X button closes without saving, keyboard shortcuts no longer blocked after slider use, Vue frontend compatibility fixes.

### **April 02, 2026**
- 🔄 **ComfyUI 2.0 Compatibility:** Core nodes updated for the latest engine.
- 🏷 **Labels Node:** Stability fixes and performance improvements.
- 🐛 **General Fixes:** Targeted bug resolutions for a smoother experience.

### **April 01, 2026**
- 🎉 **Official Release:** Initial public rollout of the Pixaroma suite.
- 📺 **Launch Video:** See it in action in [Episode 11](https://www.youtube.com/watch?v=Lmxf8pK-H1k).

---

## 📜 Feedback & License

> [!NOTE]
> This suite was developed with significant AI assistance. While thoroughly tested, we welcome bug reports and feedback from the community!

💬 **[Join our Discord Community](https://discord.gg/gggpkVgBf3)**  
⚖️ **Licensed under [MIT](https://github.com/pixaroma/ComfyUI-Pixaroma/blob/main/LICENSE)**

