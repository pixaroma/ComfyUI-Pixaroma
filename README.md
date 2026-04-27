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

Pixaroma turns ComfyUI into a powerful, easy-to-use design space. It brings professional editing right into your workflow!

### 🧊 3D Builder
A full 3D scene editor right inside ComfyUI. Drop in shapes, trees, houses, furniture, or import your own 3D models. You get easy camera controls, realistic lighting, undo/redo, and live previews. Perfect for making reference scenes for ControlNet or depth maps!
![3D Builder — Node](workflows/3D%20Builder%20Pixaroma%20Workflow.jpg)
![3D Builder — Editor](workflows/3D%20Builder%20Pixaroma%20Workflow%20v2.jpg)

### 🎶 Audio React Pixaroma
Bring still images to life with an audio-reactive image-to-video render — **no extra models needed**, just an image and an audio track. Pick from eight opinionated motion modes (`scale_pulse`, `zoom_punch`, `shake`, `drift`, `rotate_pulse`, `ripple`, `swirl`, `slit_scan`) and stack up to four overlay effects (glitch, bloom, vignette, hue shift). Same audio-band filter, sizing controls, and loop-safe rendering you'd want for music videos and social loops. Pairs with `Save Mp4 Pixaroma` to write the clip directly to MP4 with audio muxed in.

### 🎚️ Audio Pulse Pixaroma
Sibling node to **Audio React Pixaroma** — same effect engine, but with a full live editor. Click **Open Audio Pulse** on the node to launch a fullscreen overlay:

- **WebGL preview canvas** — renders effects in real time as you scrub the audio. Tweak motion mode / intensity / overlay strengths and watch the result update instantly, no workflow run required.
- **Tabbed sidebar** — Motion / Overlays / Audio / Output groups all 16 effect controls.
- **Transport bar** — play / pause / scrub / frame stepper, with the audio envelope shown as an inline sparkline so you can scrub straight to a beat.
- **Keyboard shortcuts** — Space to play/pause, arrows to step a frame, Shift+arrows for one-second jumps, Ctrl+Z / Ctrl+Y for ~50 levels of param undo.
- **Image + Audio sources** — connect an upstream `IMAGE` / `AUDIO` input, or load files from inside the editor (drag-drop on canvas or pick-file via the source pills). Inline files survive workflow reloads.
- **Same engine as Audio React** — the workflow renders identical frames in Python, ready for `Save Mp4 Pixaroma`. Use Audio React for fast scripted runs; use Audio Pulse when you want to dial in the look interactively.

Requires WebGL2 (universal in modern browsers since 2017).

### ✨ Image Composer
Easily combine and arrange multiple images. Move, scale, and rotate layers using a simple visual editor. Use the eraser to tweak things by hand, or let our AI background removal tool isolate objects for you instantly.
![Image Composer — Node](workflows/Image%20Composer%20Pixaroma%20Workflow.jpg)
![Image Composer — Editor](workflows/Image%20Composer%20Pixaroma%20Workflow%20v2.jpg)

### 🖌️ Paint Studio
A fast, easy-to-use painting tool. It features layers, custom brushes, and a smudge tool for smooth blending. Perfect for fixing details, drawing custom masks, or painting from scratch.
![Paint — Node](workflows/Paint%20Pixaroma%20Workflow.jpg)
![Paint — Editor](workflows/Paint%20Pixaroma%20Workflow%20v2.jpg)

### ✂️ Precision Crop
No more guessing crop sizes with numbers! Visually draw your crop box. It includes standard presets (like 1:1 or 16:9) so your image is always framed perfectly for social media or video.
![Image Crop — Node](workflows/Crop%20Pixaroma%20Workflow.jpg)
![Image Crop — Editor](workflows/Crop%20Pixaroma%20Workflow%20v2.jpg)

### 🌓 Interactive Compare
The best way to see the difference between two images. Easily compare them side-by-side with a slider, overlap them, or highlight exactly what changed between the two versions.
![Image Compare — Node](workflows/Image%20Compare%20Pixaroma%20Workflow.jpg)
![Image Compare — Editor](workflows/Image%20Compare%20Pixaroma%20Workflow%20v2.jpg)

### 📝 Note Pixaroma
A beautiful, simple text editor to document your workflows right on the canvas. Write normally using bold, italics, lists, and headings. Add custom colored buttons, icons, or links to YouTube and Discord. You can even color-code your notes to match your style. It perfectly saves and restores exactly how you styled it.
![Note Pixaroma — Node](workflows/Note%20Pixaroma%20Workflow.jpg)
![Note Pixaroma — Editor](workflows/Note%20Pixaroma%20Workflow%20v2.jpg)

### 🏷️ Label Pixaroma
Keep your workflows tidy with clean, custom labels.

![Labels — Node](workflows/Labels%20Pixaroma%20Workflow.jpg)
![Labels — Editor](workflows/Labels%20Pixaroma%20Workflow%20v2.jpg)

### 💬 Show Text Pixaroma
Easily see what text or data is flowing through your nodes.

### 🖼️ Preview Image Pixaroma
A handy way to preview your image right on the node, but better! It gives you two simple buttons: **Save to Disk** (choose any folder on your computer) and **Save to Output** (saves to your ComfyUI output folder). Both options safely embed your workflow into the image, so you can drag the image back in later to restore everything.

### 📐 Resolution Pixaroma
A simple, one-click resolution picker. Choose from standard aspect ratios (like 1:1, 16:9, or 9:16) and instantly get the exact width and height you need, including popular sizes for AI video. Or, use Custom mode to type in your exact dimensions. It perfectly saves all your settings with your workflow!

---

## 🚀 Getting Started

### 1. Installation

#### **Method A: ComfyUI Easy Install (Zero-Config)**
If you use [ComfyUI Easy Install](https://github.com/Tavris1/ComfyUI-Easy-Install) for Windows, **Pixaroma is already included!** Just update via the built-in updater and you're good to go.

#### **Method B: ComfyUI Manager**
1. Search for **Pixaroma** in the ComfyUI Manager.
2. Click **Install** and restart ComfyUI.

#### **Method C: Manual Installation**
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/pixaroma/ComfyUI-Pixaroma.git
```

### 2. Optional: AI Background Removal
Want to use the **AI Remove Background** button in the Image Composer? Just install `rembg`:

```bash
# Windows Portable
python.exe -m pip install rembg

# Standard Installation
pip install rembg
```

Once installed, you can pick from different AI models depending on the quality you need:

| Option | Size | What it is |
|--------|------|------------|
| **Auto (recommended)** | — | Automatically picks the best available model for you. |
| **Fast** | ~176 MB | Works on any setup, great for quick cutouts. |
| **Balanced** | ~170 MB | Cleaner edges. |
| **Best** | ~900 MB | Highest quality cutouts. |

---

## 📺 Learning Resources

Master the Pixaroma suite with our video guides and workflow deep-dives:

📺 **[Visit Pixaroma on YouTube](https://www.youtube.com/@pixaroma)**

---

## 🛠 Changelog

### **April 25, 2026**
- **Smoother 3D Builder:** Moving the camera, spinning, and zooming in your 3D scenes is now much faster and less laggy!

### **April 23, 2026**
- **New Preview Node:** Added Preview Image Pixaroma with simple buttons to save your image anywhere on your computer.
- **Organized Menu:** All our nodes now live under a single `👑 Pixaroma` menu.

### **April 22, 2026**
- **New Resolution Node:** A simple, one-click resolution picker for your aspect ratios.
- **New Note Node:** A beautiful rich-text editor for adding notes directly to your canvas. [Watch the tutorial](https://www.youtube.com/watch?v=XCgmEodQlIU).

### **April 19, 2026**
- **Clearer Close Buttons:** Pop-up editors now have an obvious red "Close" button.
- **Offline 3D Builder:** The 3D Builder no longer needs an internet connection to start.
- **Paint Fixes:** Fixed the brush cursor disappearing, and added a new "Remove Background" AI button.
- **Composer Fixes:** Layer blend modes (like Multiply or Screen) now save and load correctly.
- **3D Shortcuts:** Added Blender-style keyboard shortcuts (G to move, Shift+D to duplicate, etc.).

### **April 15, 2026**
- **Huge 3D Builder Update:** Added 18 basic shapes, 16 complex objects (trees, furniture), 5 hollow vessels, and custom 3D model imports. Added camera views, a drop-to-floor button, and instant undo/redo. [Watch the tutorial](https://www.youtube.com/watch?v=DnKM-Np0fFw).

### **April 14, 2026**
- **Transparent Saves:** Added a checkbox to save images with transparent backgrounds in Paint, Composer, and 3D Builder.

### **April 13, 2026**
- **Paint Improvements:** Better cursors, smoother color picking, and quick brush resizing.
- **Compare Tool Updates:** Better controls and a new solo-image view.
- **Settings:** Pixaroma now has its own section in the ComfyUI settings menu.

### **April 02, 2026**
- **ComfyUI 2.0 Compatibility:** Updated all nodes to run smoothly on the latest ComfyUI version.

### **April 01, 2026**
- **Launch Day:** Initial release of the Pixaroma suite! [Watch the video](https://www.youtube.com/watch?v=Lmxf8pK-H1k).

---

## 📜 Feedback & License

> [!NOTE]
> This suite was developed with significant AI assistance. While thoroughly tested, we welcome bug reports and feedback from the community!

💬 **[Join our Discord Community](https://discord.gg/gggpkVgBf3)**  
⚖️ **Licensed under [MIT](https://github.com/pixaroma/ComfyUI-Pixaroma/blob/main/LICENSE)**

