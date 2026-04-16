<div align="center">
  <img src="https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/assets/pixaroma_logo.svg" width="120" alt="Pixaroma Logo">
  <h1>ComfyUI Pixaroma</h1>
  <p align="center">
    <strong>Elevate your ComfyUI workflow with professional-grade creative tools.</strong><br />
    3D scenes • Texture painting • Layered composition • Precision cropping • Side-by-side comparison
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

### 🏷️ Label & Utility
- **Label Tool:** Organize massive workflows with clean, customizable labels to keep your logic readable.
- **Show Text:** A vital debugging tool that displays the raw content of any input—be it tensors, latents, or string values.
![Labels — Node](workflows/Labels%20Pixaroma%20Workflow.jpg)
![Labels — Editor](workflows/Labels%20Pixaroma%20Workflow%20v2.jpg)

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

