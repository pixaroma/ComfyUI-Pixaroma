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

### 🖼️ Preview Image Pixaroma
A preview-plus-save checkpoint for any workflow. Shows the image inline in the node body like ComfyUI's built-in PreviewImage, but adds two orange canvas buttons: **Save to Disk** (native OS save dialog — pick any folder, anywhere on your drive, via the File System Access API) and **Save to Output** (writes to ComfyUI's `output/` folder with an auto-incremented counter). Both saved PNGs embed the full workflow + prompt as tEXt metadata chunks — drag any saved image back onto the ComfyUI canvas and the workflow restores. Editable `filename_prefix` widget (default `Preview`). Passthrough IMAGE output that is **optional** — terminate the workflow at this node for a "preview-only" run, or wire downstream and keep going without any error. Buttons enforce a minimum node size so they never clip, and fall back to the Downloads folder on Firefox / Safari <15.1 where `showSaveFilePicker` isn't available.

### 📐 Resolution Pixaroma
One-click resolution picker that outputs clean `width` and `height` INTs for any `EmptyLatent` or size-driven downstream node. 3×3 ratio chip grid (1:1 / 16:9 / 9:16 / 2:1 / 3:2 / 2:3 + Custom Resolution) with 8 curated sizes per ratio — including AI-video standards (832×480, 1280×720 for 16:9; 480×832, 720×1280 for 9:16; Wan 2.2 / CogVideoX / AnimateDiff friendly). Each ratio auto-selects a sensible default on click (e.g. 16:9 → 1280×720). **Custom Resolution** mode opens W/H number inputs with an inline **swap** icon between them, picks snap-step (8 / 16 / 32 / 64 px) with brand-orange active chip, arrow keys nudge by the picked step, plus a live aspect-ratio preview rectangle and ratio + megapixel readout. Locked node size (no accidental resize), workflow save/load round-trips the full state (ratio, picked size, custom values, snap choice).

---

## 🚀 Getting Started

### 1. Installation

#### **Method A: ComfyUI Easy Install (Zero-Config)**
If you're using [ComfyUI Easy Install](https://github.com/Tavris1/ComfyUI-Easy-Install) — a one-click ComfyUI launcher for Windows — **Pixaroma is already included**. You get it on first install and every time you run the built-in **Update Easy-Install.bat** , Pixaroma updates alongside ComfyUI and the other bundled custom nodes. Nothing to clone, nothing to configure. Just start ComfyUI and the 👑 Pixaroma nodes are in the Add Node menu.

#### **Method B: ComfyUI Manager**
1. Search for **Pixaroma** in the ComfyUI Manager.
2. Click **Install** and restart ComfyUI.

#### **Method C: Manual Installation**
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

### **April 25, 2026 — 3D Builder runs much smoother**
Spinning, panning, and zooming around your 3D scene now feels noticeably faster and less laggy. Behind the scenes, the editor was redoing a lot of work on every single frame — re-baking shadows, drawing a selection glow even when nothing was selected, and rendering at higher detail than needed. Those frame-by-frame chores have been trimmed back so the picture now updates only what actually changed. Same look, same features, just a smoother ride when you're moving the camera.

### **April 23, 2026 — Preview Image Pixaroma**
A new node that shows the image inline and adds two orange buttons: **Save to Disk** (native OS file dialog — pick any folder) and **Save to Output** (writes to `ComfyUI/output/` with an auto-incremented counter). Both PNGs embed the full workflow — drag any saved image back onto the canvas to restore it. Optional passthrough output: terminate the workflow here or keep chaining. All Pixaroma nodes now live under a unified `👑 Pixaroma` menu.

### **April 22, 2026 — Resolution Pixaroma**
One-click resolution picker that outputs `width` + `height` INTs for any latent. 3×3 ratio grid (1:1 / 16:9 / 9:16 / 2:1 / 3:2 / 2:3), 8 curated sizes per ratio including AI-video standards (Wan 2.2 / CogVideoX / AnimateDiff friendly), plus a **Custom** mode with W/H inputs, inline swap, snap-step chips (8/16/32/64 px), and live aspect preview.

### **April 22, 2026 — Note Pixaroma**
Rich-text annotation node — replaces "wall of Markdown in a comment" with a full WYSIWYG editor.
[Youtube Tutorial](https://www.youtube.com/watch?v=XCgmEodQlIU)

- 📝 WYSIWYG: Bold / Italic / Underline / Strikethrough, H1-H3, lists, tables with Tab navigation, code blocks, horizontal rules, per-text color and highlight.
- 🎨 Per-note colors (Bg / Btn / Ln pickers) with title bar auto-darkening for readable contrast.
- 🔗 Pixaroma blocks: Download / View Page / Read More pills with folder hints + size tags; preset YouTube and Discord pills.
- 🎯 42 inline SVG icons shipped; drop more into `assets/icons/note/` to extend the picker.
- ✏️ Click-to-edit pencil on every inserted block (re-opens its dialog pre-filled).
- 🧰 Code view with syntax highlighting + an allowlist sanitizer that strips scripts, event handlers, and unsafe URLs on save/paste.
- 🎹 Standard shortcuts (Ctrl+B/I/U, Ctrl+Z/Y, Ctrl+S).

### **April 19, 2026**
- 🚪 **Clearer editor close button:** `✕` in every editor now reads `✕ Close <EditorName>` in red, so it's not confused with the host window's close X.
- 🔌 **3D Builder works offline:** Three.js is now bundled — no more CDN fetch on startup.
- 🖌️ **Paint cursor fix:** Brush ring preview no longer disappears after opening 3D Builder in the same session.
- 🎨 **Image Composer — blend modes restored:** Per-layer blend modes (Multiply, Screen, Overlay, etc.) now round-trip correctly through save → reopen → workflow execution.
- 🎨 **Paint Studio — AI Background Removal panel:** Remove Background button with model selector. Only enabled on layers that started from an imported image.
- 🎮 **Blender-style 3D shortcuts:** `G` move, `Shift+D` duplicate, `Shift+A` add-object picker, `Alt+A` deselect, `Esc` deselect/close-help, `.` focus-on-selected (all original shortcuts still work).

### **April 15, 2026 — 3D Builder v2**
A major overhaul turning 3D Builder into a full scene editor.
[Youtube Ep13 Tutorial](https://www.youtube.com/watch?v=DnKM-Np0fFw)

- 🧊 **18 primitive shapes** with per-shape slider panels (Cube, Sphere, Cylinder, Cone, Torus, Plane, Pyramid, Capsule, Tube, Ring, Prism, Crystal, Dome, Gear, Teapot, Blob, Rock, Terrain).
- 🌿 **16 composite shapes** — multi-mesh groups that look like real objects (Tree, Pine, Flower, Mushroom, Cactus, Cloud, House, Lamp Post, Fence, Signpost, Arch, Table, Chair, Bed, Couch, Bookshelf).
- 🏺 **5 hollow vessels** with wall-thickness slider (Vase, Bottle, Goblet, Bowl, Plant Pot).
- 🐇 **Bundled Stanford Bunny** as a one-click add.
- 📦 **GLB/OBJ import** with textures + "Use Original Material" toggle.
- ➕ **"Add 3D Object" picker** — categorised modal grid, one click drops the object in.
- 🌍 **Expanded Terrain** with 13 sliders for anything from plateaus to islands.
- 🎥 **Camera views**: `1` front, `2` side, `3` back, `4` top, `5` perspective, `6` iso, `7` other side, `0` focus-on-selected.
- 🎛️ **Transform sliders** (X/Y/Z) for Move/Rotate/Scale with bidirectional gizmo sync + Lock Proportions.
- 🏷️ **Layer thumbnails** showing mini 3D renders of the actual object.
- 🦶 **Drop to Floor** — snaps the lowest vertex to y=0 even when rotated/scaled.
- 🌅 **Studio HDR lighting** for realistic PBR materials.
- ⏪ **Instant undo/redo** — imports no longer refetch the GLB.
- ⚙️ **ComfyUI Setting:** default background color for new 3D scenes under 👑 Pixaroma → 3D Builder.

### **April 14, 2026**
- 🖼️ **Transparent Background Save:** Paint, Composer, and 3D Builder all have a "Transparent BG (Save to Disk)" checkbox. Workflow "Save" path is unchanged — existing workflows stay compatible.

### **April 13, 2026**
- 🎨 **Paint Studio overhaul:** custom tool cursors, smoother color picker, instant brush resize, locked layers enforced across all tools.
- 🌓 **Image Compare redesign** with new control order and solo-image toggle.
- ⚙️ **ComfyUI Settings panel** — Pixaroma now has its own section under `👑 Pixaroma`.
- 🔄 **Composer:** preview refreshes automatically after execution; duplicate-layer mask bug fixed.

### **April 02, 2026**
- 🔄 **ComfyUI 2.0 compatibility** — core nodes updated for the latest engine.
- 🏷 **Labels node** stability and performance fixes.

### **April 01, 2026**
- 🎉 **Official Release:** Initial public rollout of the Pixaroma suite.
- 📺 **Launch Video:** See it in action in [Episode 11](https://www.youtube.com/watch?v=Lmxf8pK-H1k).

---

## 📜 Feedback & License

> [!NOTE]
> This suite was developed with significant AI assistance. While thoroughly tested, we welcome bug reports and feedback from the community!

💬 **[Join our Discord Community](https://discord.gg/gggpkVgBf3)**  
⚖️ **Licensed under [MIT](https://github.com/pixaroma/ComfyUI-Pixaroma/blob/main/LICENSE)**

