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
A complete WebGL 3D scene editor inside ComfyUI. Place primitives, apply custom materials, and configure interactive lighting to build complex depth maps or reference scenes for ControlNet. Supports background image references and full camera control.
![3D Builder Pixaroma](https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/workflows/3D%20Builder%20Pixaroma%20Workflow.jpg)

### ✨ Image Composer
Advanced layer-based composition. Move, scale, and rotate multiple images with a visual interface. Use the eraser tool with a soft brush for manual masking, or leverage the built-in AI background removal for instant object isolation. Perfect for pre-processing or final touch-ups.
![Image Composer Pixaroma](https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/workflows/Image%20Composer%20Pixaroma%20Workflow.jpg)

### 🖌️ Paint Studio
A professional-grade painting suite optimized for performance. Features a robust layer system, customizable brushes, blend modes, and a dedicated smudge tool for seamless blending. Ideal for inpainting, custom masks, or creating textures from scratch.
![Paint Pixaroma](https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/workflows/Paint%20Pixaroma%20Workflow.jpg)

### ✂️ Precision Crop
No more guessing crop coordinates. Graphically define your crop area with interactive handles. Includes standard aspect ratio presets (1:1, 16:9, 9:16) to ensure your output is perfectly framed for its final destination.
![Image Crop Pixaroma](https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/workflows/Crop%20Pixaroma%20Workflow.jpg)

### 🌓 Interactive Compare
The ultimate tool for model testing and workflow optimization. Compare two images side-by-side with a slider, vertically, via overlay blending, or using a difference map to highlight identical pixels vs. changes.
![Image Compare Pixaroma](https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/workflows/Image%20Compare%20Pixaroma%20Workflow.jpg)

### 🏷️ Label & Utility
- **Label Tool:** Organize massive workflows with clean, customizable labels to keep your logic readable.
- **Show Text:** A vital debugging tool that displays the raw content of any input—be it tensors, latents, or string values.
![Labels Pixaroma](https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/workflows/Labels%20Pixaroma%20Workflow.jpg)

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
*Note: The ~170MB model will download automatically upon first use to `ComfyUI/models/rembg/`.*

---

## 📺 Learning Resources

Master the Pixaroma suite with our video guides and workflow deep-dives:

📺 **[Visit Pixaroma on YouTube](https://www.youtube.com/@pixaroma)**

---

## 🛠 Changelog

### **April 13, 2026**
- 🎨 **Paint Studio — Custom Tool Cursors:** Fill and eyedropper tools now show their actual SVG icons as cursors. Alt+drag eyedropper in brush mode shows the eyedropper cursor.
- 🎨 **Paint Studio — Color Picker Improvements:** HSL adjust sliders fixed (no more color jumps). Swatch panel redesigned: 1 row of recent colors + 4 rows of fixed palette colors.
- 🎨 **Paint Studio — Brush Resize (`[`/`]`):** Now responds instantly without delay or jumpiness, cursor updates in real-time.
- 🎨 **Paint Studio — Layer Lock Enforcement:** Locked layers now block transform, delete, and all drawing tools. Lock icon displays in orange for visibility.
- 🔧 **Close Button Fix:** X button now closes without saving across all editors (Paint, Composer, 3D Builder).
- 🔧 **Reset to BW Button:** Redesigned with reset icon and label for clarity.
- 🛠 **Keyboard Shortcuts:** Fixed shortcuts being blocked after interacting with sidebar sliders. Alt/Space/bracket keys now work reliably.
- 🛠 **Composer — Duplicate Layer Fix:** Duplicated layers with eraser masks no longer share the same mask canvas.
- 🌓 **Image Compare — Redesigned Controls:** New button order: Show 1 → Left Right → Right Left → Up Down → Overlay → Difference. Show button toggles between image 1 and image 2 solo view. Added Right Left mode for reversed split comparison. Default view shows image 2.
- 🔄 **Image Composer Preview Auto-Update:** Node preview now updates automatically after workflow execution when placeholders are connected — no need to open the editor and save manually.
- 🔧 **Placeholder Ratio Reset:** Changing a placeholder's aspect ratio now properly resets any previous stretching.
- 🛠 **Vue Frontend Compatibility:** Fixed stale editor references, `graph.links` Map support, and replaced `onDrawForeground` with polling for reliable upstream change detection.

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

