<div align="center">
  <img src="https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/assets/pixaroma_logo.svg" width="120" alt="Pixaroma Logo">
  <h1>ComfyUI Pixaroma</h1>
  <p align="center">
    <strong>Useful ComfyUI nodes for everyday workflows.</strong><br />
    Load Image • Crop • Compose • Paint • 3D • Compare • Preview • Save MP4 • Notes & Labels • Resolution • Switches • Remove Background • Text & Number utilities
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

### ✨ Image Composer
Easily combine and arrange multiple images. Move, scale, and rotate layers using a simple visual editor. **Per-layer blur** lets you focus or defocus any layer non-destructively with a simple slider. **Shift+Scroll wheel** scales the selected layer in place for quick adjustments. Use the eraser to tweak things by hand, or let our AI background removal tool isolate objects for you instantly.

📥 [Download example workflow](workflows/Image%20Composer%20Pixaroma%20Workflow.json)

![Image Composer Node](workflows/Image%20Composer%20Pixaroma%20Workflow.jpg?v=2)
![Image Composer Editor](workflows/Image%20Composer%20Pixaroma%20Workflow%20v2.jpg?v=2)

### 🖌️ Paint Pixaroma
A fast, easy-to-use painting tool. It features layers, custom brushes, and a smudge tool for smooth blending. Perfect for fixing details, drawing custom masks, or painting from scratch.

📥 [Download example workflow](workflows/Paint%20Pixaroma%20Workflow.json)

![Paint Node](workflows/Paint%20Pixaroma%20Workflow.jpg?v=2)
![Paint Editor](workflows/Paint%20Pixaroma%20Workflow%20v2.jpg?v=2)

### 🧊 3D Builder
A full 3D scene editor right inside ComfyUI. Drop in shapes, trees, houses, furniture, or import your own 3D models. You get easy camera controls, realistic lighting, undo/redo, and live previews. Perfect for making reference scenes for ControlNet or depth maps!

📥 [Download example workflow](workflows/3D%20Builder%20Pixaroma%20Workflow.json)

![3D Builder Node](workflows/3D%20Builder%20Pixaroma%20Workflow.jpg?v=2)
![3D Builder Editor](workflows/3D%20Builder%20Pixaroma%20Workflow%20v2.jpg?v=2)

### 🎚️ AudioReact Pixaroma
Audio-reactive image-to-video. **No extra models needed**, just an image and an audio track. Open the fullscreen editor, scrub the audio, and watch 15 motion modes (Pulse Zoom, Camera Shake, Glitch, Pinch, Wave, Tilt, Pixelate, RGB Split, and more) react to the beat in real time with a live WebGL preview. Stack 8 overlay effects on top: chroma shift, bloom, vignette, hue shift, cinematic teal/orange grade, letterbox, scanlines, and film grain. Pairs with **Save Mp4 Pixaroma** to write the clip directly to MP4 with audio muxed in. Requires WebGL2.

📥 [Download example workflow](workflows/AudioReact%20Workflow.json)

![AudioReact Node](workflows/AudioReact%20Workflow.jpg?v=2)
![AudioReact Editor](workflows/AudioReact%20Workflow%20v2.jpg?v=2)

### ✂️ Image Crop
No more guessing crop sizes with numbers! Visually draw your crop box, or set width, height, position and a center/edge alignment right on the node - math expressions like `1024+512` work too. Standard presets (1:1, 16:9, 9:16…) keep social and video aspects locked. Wire **any IMAGE** output into the node (Load Image, VAE Decode, anything) and run the workflow once - the editor and mini-preview will show the live source. Or paste an image straight from the clipboard with **Ctrl+V**.

📥 [Download example workflow](workflows/Crop%20Pixaroma%20Workflow.json)

![Image Crop Node](workflows/Crop%20Pixaroma%20Workflow.jpg?v=3)
![Image Crop Editor](workflows/Crop%20Pixaroma%20Workflow%20v2.jpg?v=2)

### 🌓 Image Compare
The best way to see the difference between two images. Easily compare them side-by-side with a slider, overlap them, or highlight exactly what changed between the two versions.

📥 [Download example workflow](workflows/Image%20Compare%20Pixaroma%20Workflow.json)

![Image Compare Node](workflows/Image%20Compare%20Pixaroma%20Workflow.jpg?v=2)
![Image Compare Editor](workflows/Image%20Compare%20Pixaroma%20Workflow%20v2.jpg?v=2)

### 🖼️ Load Image Pixaroma
A drop-in replacement for ComfyUI's native LoadImage with everything you'd want in one node. Same upload / drag-drop / Ctrl+V paste / multi-frame / alpha-to-mask behavior as native, plus inline resize: pick from **Off**, **Max megapixels**, **Longest side**, **Scale by ×**, **Fit inside**, **Crop to fill**, or **Match aspect ratio** with a sub-toggle for Crop or Pad (12 ratio presets + Custom, with a Pixaroma color picker for the Pad color). **Snap to /8/16/32/64**, **Resample picker** (Auto / Nearest / Bilinear / Bicubic / Lanczos with one-line hints under each), and an **Allow upscaling** toggle apply on top. Numeric fields accept math expressions (`1024+64`, `512*2`), ↑↓ arrow stepping (Shift = 10×), and have visible +/- spinner buttons. A live **Input → Output** info bar with tiny aspect-ratio rectangles shows you exactly what dimensions the workflow will produce as you tweak settings. Outputs include `IMAGE`, `MASK`, `WIDTH`, `HEIGHT`, `FILENAME` (no extension), `ORIGINAL_WIDTH`, `ORIGINAL_HEIGHT` — eliminates downstream Get Image Size + Image Scale chains in most workflows.

### 📝 Note Pixaroma
A beautiful, simple text editor to document your workflows right on the canvas. Write normally with bold, italics, lists, headings, code blocks (with copy button), and inline icons (CLIP, LORA, GGUF, model versions, and 30+ more). Drop in custom-colored **buttons** (Download / View Page / Read More / plain), **separators** (5 line styles: solid, dashed, dotted, double, thick), **tables**, and **folder hints** for download paths. Each block carries its OWN colour, picked from a clean modal that opens centered on the screen, so two separators (or two grids, or two folder hints) in the same note can have totally different looks. YouTube and Discord pills come pre-colored. There is also a Code view for hand-editing the underlying HTML, plus a drop-in LLM prompt at `assets/note-pixaroma-llm-prompt.txt` if you want ChatGPT, Gemini, or a custom GPT to generate notes for you. It perfectly saves and restores exactly how you styled it.

📥 [Download example workflow](workflows/Note%20Pixaroma%20Workflow.json)

![Note Pixaroma Node](workflows/Note%20Pixaroma%20Workflow.jpg?v=2)
![Note Pixaroma Editor](workflows/Note%20Pixaroma%20Workflow%20v2.jpg?v=2)

### 🏷️ Label Pixaroma
Keep your workflows tidy with clean, custom labels.

📥 [Download example workflow](workflows/Labels%20Pixaroma%20Workflow.json)

![Labels Node](workflows/Labels%20Pixaroma%20Workflow.jpg?v=2)
![Labels Editor](workflows/Labels%20Pixaroma%20Workflow%20v2.jpg?v=2)

### ✏️ Text Overlay Pixaroma
Drop a styled text caption straight onto an image. 10 bundled fonts (Inter, Roboto, Montserrat, Oswald, Playfair Display, Lora, Bebas Neue, Anton, Caveat, JetBrains Mono), bold and italic toggles, three alignment options, size, line height, letter spacing, opacity, rotation, X / Y position, text color and an optional background bar behind the text. Type math like `100+12` in any number field and it evaluates. Click **Open Text Editor** for a fullscreen canvas where you can drag the text to move it, drag the corners to resize, drag the round handle on top to rotate, snap to canvas center / thirds / edges, and use **Fit W** or **Fit H** to fill the image. Save your work straight to disk as a PNG. Wire the optional **text** input to feed the caption from any upstream text source (the textarea on the node grays out so you know not to type there). New nodes auto-center the text on whatever image you wire in, no manual positioning needed for the first render.

### 🎬 Save Mp4 Pixaroma
Encode video frames + optional audio straight to MP4. Built-in `<video>` preview right on the node so you can watch the result without leaving ComfyUI. Pairs with AudioReact, but works with any source that produces frames + AUDIO.

### 💬 Show Text Pixaroma
See what text or data is flowing through your nodes, with a real read-only text box you can **select and copy** from. **Resize the node freely** in any direction; long text scrolls with a scrollbar instead of forcing the node to grow. New **STRING output** lets you chain it into other nodes (great for inspecting a prompt before passing it on). Saves and restores with your workflow.

### 🔍 Prompt Reader Pixaroma
Load any PNG that was generated with ComfyUI (or Automatic1111 / Forge) and read the **positive prompt** saved inside its metadata. No image preview - just the text. Drag-drop a file, click **Upload Image**, or pick from the file combo; the prompt appears the moment you choose a file, so you see it before running. One orange **Copy** button puts the prompt on your clipboard. The **STRING output** wires straight into CLIPTextEncode (or any text input) so you can re-use the prompt without retyping. Handles complex workflows with chained text nodes (ConditioningCombine, StringConcatenate, SDXL dual-text encoders). If the image has no prompt (JPG, screenshot, or a PNG whose metadata was stripped), you get a short clear message instead of a silent fail.

### 🖼️ Preview Image Pixaroma
A handy way to preview your images right on the node, but better! Works with **single images and full batches**: every frame appears as a thumbnail strip with a `i / N` counter - click any thumbnail to open it large inside the node. Use the **arrow keys** (← →) to flip through the batch, click anywhere on the open image to advance to the next, hit `Esc` or the `×` button to collapse back. Two save buttons act on the currently selected frame: **Save to Disk** (choose any folder on your computer; the suggested filename auto-increments per click) and **Save to Output** (saves to ComfyUI's `output/`, supports subfolder syntax like `SDXL/portrait`). Flip the **save_mode** widget to `save` and the node turns into a drop-in replacement for SaveImage - every batch frame is automatically written to `output/` with embedded workflow metadata. Both modes embed your workflow into the saved PNG so you can drag it back into ComfyUI later. The preview also **survives workflow tab switching**, so you can leave it on a frame and come back to it later.

### 📐 Resolution Pixaroma
A simple, one-click resolution picker. Choose from 9 popular aspect ratios - 1:1, 16:9, 9:16, 2:1, 3:2, 2:3, 4:3, 3:4, and 4:5 (Instagram-portrait friendly) - and instantly get the exact width and height you need, including popular sizes for AI video. Type any Custom Ratio (21:9, 16:10, anything) with auto-computed AI-friendly sizes, or use Custom Resolution to type exact dimensions. Math expressions work in the Width and Height fields too - type `1024+128` or `512*2` and it just works. It perfectly saves all your settings with your workflow!

### 📏 WH Pixaroma
A tiny utility node with two number fields for width and height, and matching width/height outputs. Use it when you want to type a target resolution manually somewhere in your workflow. Math expressions like `1024+64` or `512*2` work directly in the fields. Pairs perfectly with **Switch WH Pixaroma** so you can flip between manual values and the size coming from another node.

### ✂️ Remove Background Pixaroma
One node replaces the usual three-node chain (Remove Background, Invert Mask, Join Image with Alpha). Wire in your image, pick a model from the built-in dropdown, and get three outputs in one shot: the cutout image with a transparent background, the foreground mask (white on black), and the inverted mask (black on white). No separate Load Background Removal Model node to wire in. Three BiRefNet variants are supported, each tuned for a different use case:

- **birefnet.safetensors** (Standard) - 424 MB - 4-6 GB VRAM - processes at 1024×1024. Best for clean objects, products, logos. Fast everyday cutouts.
- **birefnet-hr.safetensors** (High Resolution) - 444 MB - 8 GB+ VRAM - processes at 2048×2048. Best for large images where you need fine outline detail picked up (jewelry, intricate hardware, complex shapes).
- **birefnet-matting.safetensors** (Soft Alpha Edges) - 444 MB - 8 GB+ VRAM - processes at 2048×2048. Best for hair, fur, lace, soft fabric. Also worth trying for glass, smoke, sheer materials (trained mostly on portraits, so results on transparency vary).

Drop the `.safetensors` files into `ComfyUI/models/background_removal/`; if the folder is empty the node tells you exactly what to download and where to put it. The model resizes your image to its internal resolution before finding the cutout, then the mask is scaled back to match your original size - so your output stays the same dimensions as your input regardless of which model you pick. Downloads: [Standard](https://huggingface.co/Comfy-Org/BiRefNet/tree/main/background_removal), [HR](https://huggingface.co/ZhengPeng7/BiRefNet_HR), [HR-matting](https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting).

### 🔀 Switch Pixaroma
A universal multi-input switch for any data type. Connect models, images, prompts, masks, audio, latents, anything you want, and pick which one flows through with a single click on its toggle. The node starts with one input and grows on its own as you connect more cables (up to 32 rows). Each row gets a label that auto-fills with the type name (MODEL, IMAGE, CLIP...) so you can tell what is wired where at a glance; click the label to type your own name (for example "main checkpoint" or "alt prompt"), clear it and press Enter to revert to the type name. Only one input can be active at a time, lit up in Pixaroma orange. Disconnect the active row and the switch automatically moves to the next available one so your workflow doesn't break. All settings save with your workflow.

### 🔀 Switch WH Pixaroma
Switch between two width/height sources with a single click. Wire two width+height pairs into the **A** and **B** inputs (for example a Load Image Pixaroma's WIDTH/HEIGHT and a manual size from WH Pixaroma), then click **A** or **B** on the node body to choose which pair flows through. No rewiring cables. If one side has only one cable connected (the other forgotten), the node uses the complete side instead so the workflow doesn't break. If nothing is wired, you get a clear error message.

### 🔢 Number Pixaroma
A small node with one number field and two outputs: **int** and **float**. Useful when one downstream node wants a whole number and another wants a decimal from the same value, or when you want to convert a decimal into a whole number cleanly in the middle of a workflow. Accepts whole numbers, decimals, and math expressions like `1024+64` or `1024/3`. The int output rounds to the nearest whole number (`3.5` becomes `4`, `3.4` becomes `3`). Range is roughly plus or minus 1 quadrillion, so even very large numbers fit.

### ✍️ Text Pixaroma
A multi-line text field with a STRING output. Write your prompt (or any other long text) once and wire the output into multiple downstream nodes - positive prompt, negative prompt, captions, instructions, anywhere a string is needed. The field grows when you drag the node bigger, so you have plenty of room for long prompts. The text saves with your workflow.

### 🧱 Prompt Stack Pixaroma
A single node that holds an ordered stack of prompt chunks you can mute or include with one click. Add as many rows as you want, type a different piece of your prompt in each (style words, subject, lighting, quality boosters, anything), give each row a short label so you remember what it does, and toggle the orange **ON / OFF** pill to include or skip that row at run time. All the ON rows get joined into one text output with whatever separator you pick in **Settings → 👑 Pixaroma → Prompt Stack** (default comma+space, also works as newline, space, pipe, or anything you type). Drag the handle on the left of any row to reorder them, and the join order updates too. Rows that grow to many lines scroll on their own. The node tidies itself as you add and delete rows so it always fits its content with a bit of breathing room. Everything saves with your workflow. Great for testing prompt variants by clicking toggles instead of editing text.

### 🎲 Prompt Multi Pixaroma
The sibling of Prompt Stack: instead of joining your rows into one text output, it **runs the workflow once for each enabled row**. Type two or more prompt variants, give each a short label (e.g. "v1", "blue version"), and hit Run - you get one image per enabled prompt, sequentially, each as its own item in the ComfyUI queue panel so you can cancel any of them individually. Toggle the orange **ON / OFF** pill to skip a row without deleting it. Drag the handle on the left to reorder. Each generated image carries only the prompt that produced it, so dropping the PNG back into **Prompt Reader Pixaroma** correctly recovers that exact variant. Great for batch-comparing prompt ideas with a single click instead of editing text and re-running by hand.

### 🔔 Notify Pixaroma
A small terminal node that plays a sound when reached during workflow execution. Drop one at the end of a workflow to hear "render finished" while you're in another browser tab or app, or branch one off any node mid-graph to be alerted at a checkpoint. Pick from 10 bundled notification sounds (drop more `.mp3`/`.wav`/`.ogg` into `assets/sounds/` to extend), set a per-node volume and an optional label, and tap the **▶ Preview** button to audition a sound without running the workflow. A master toggle in **Settings → 👑 Pixaroma → Notify** silences every Notify node at once for quiet sessions. Each node also has its own enabled toggle. Always re-fires on every Run, even when upstream is fully cached.

### 🧲 Align Pixaroma
A canvas-wide smart-snap and alignment-guide system. Toggle it on with the mountain icon in the top toolbar (next to the Manager). Once enabled, dragging or resizing any node makes its edges and centers snap to nearby nodes, with thin orange guide lines showing exactly what aligned with what (Photoshop / Figma style). Multi-selection drags as a rigid bounding box. A column of 3+ nodes sharing an edge gets a single guide spanning the whole column. Hold **Shift** to bypass snap for a single drag (Alt is reserved by ComfyUI for duplicate-during-drag). Snap distance is adjustable (4 to 16 screen pixels) under **Settings → 👑 Pixaroma → Align (advanced)**. Default OFF, zero overhead until you toggle it on.

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
AI Remove Background is used in three places in Pixaroma: the **Remove Background Pixaroma** node, the **Image Composer** editor's AI Background Removal button, and the **Paint Pixaroma** editor's AI Background Removal button.

- The **node** uses **Pixaroma BiRefNet only** (`ComfyUI/models/background_removal/*.safetensors`).
- The two **editors** can use **Pixaroma BiRefNet OR rembg** - their dropdown shows BiRefNet variants on top and rembg options below. Any BiRefNet model you install once works in all three places.

There are two ways to get AI background removal working: **Pixaroma BiRefNet** (recommended, no extra Python deps, three model variants, works in the node AND the editors) and **rembg** (a separate Python library with four model options, works in the editors only). They can be used side-by-side - install whichever you want from the dropdown.

#### Option A: Pixaroma BiRefNet (recommended)

Download one of these three `.safetensors` files and drop it into `ComfyUI/models/background_removal/`. The dropdown shows them grouped under "Pixaroma BiRefNet" at the top. **The filename matters** - it controls which preprocessing resolution is used. Rename the downloaded file to one of the names below so the dropdown picks the right one.

| Variant | Filename | VRAM | Best for |
|---------|----------|------|----------|
| **Standard** | `birefnet.safetensors` (424 MB) | 4-6 GB | Clean objects, products, logos. Fast everyday cutouts. Default. [Download](https://huggingface.co/Comfy-Org/BiRefNet/tree/main/background_removal) |
| **High Resolution** | `birefnet-hr.safetensors` (444 MB) | 8 GB+ | Large images with fine outline detail (jewelry, intricate hardware). [Download](https://huggingface.co/ZhengPeng7/BiRefNet_HR) |
| **Matting (Soft Edges)** | `birefnet-matting.safetensors` (444 MB) | 8 GB+ | Hair, fur, lace, soft fabric. Also worth trying for glass / smoke. [Download](https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting) |

**Important: HR and Matting need renaming after download.** The Standard model from Comfy-Org is already named `birefnet.safetensors` and works as-is. But the HR and Matting variants come from ZhengPeng7's HuggingFace repos as `model.safetensors`, and Pixaroma needs them named correctly to know which preprocessing resolution to use.

- Standard (`birefnet.safetensors`) - **no rename needed**, drop the file in as-is
- HR (downloaded as `model.safetensors`) - **rename to `birefnet-hr.safetensors`**
- Matting (downloaded as `model.safetensors`) - **rename to `birefnet-matting.safetensors`**

**Rename steps on Windows**: right-click the file, **Rename**, type the new name (keeping `.safetensors` at the end), press Enter. If Windows hides extensions: View tab → check "File name extensions" first, otherwise the rename can accidentally drop the extension. Why the names matter: filenames containing `matt` or `hr` (case-insensitive) tell Pixaroma to preprocess at 2048×2048; anything else preprocesses at 1024×1024. If you name HR as plain `birefnet.safetensors`, it will load but run at 1024 and you'll lose the whole point of HR.

#### Option B: rembg (alternative)

`rembg` is a separate Python library. Install it once and you get four bundled model options.

```bash
# Windows Portable (ComfyUI Easy-Install)
# Open ComfyUI/python_embeded folder, type cmd in the address bar, run:
python.exe -m pip install rembg

# Standard installation
pip install rembg
```

Restart ComfyUI. Once installed, the dropdown shows these under "rembg":

| Option | Size | What it is |
|--------|------|------------|
| **rembg Auto** | n/a | Picks the best installed rembg model. |
| **rembg Fast (u2net)** | ~176 MB | Works on any setup, great for quick cutouts. |
| **rembg Balanced (isnet)** | ~170 MB | Cleaner edges than u2net. |
| **rembg Best (BiRefNet via rembg)** | ~900 MB | rembg's own BiRefNet ONNX. Largest, slowest. |

Model files download automatically on first use to `ComfyUI/models/rembg/`. For details and troubleshooting, see [rembg on GitHub](https://github.com/danielgatis/rembg#installation).

#### What gets picked by default?

If you have **at least one BiRefNet variant** installed, the dropdown defaults to BiRefNet Standard (or HR / Matting if Standard isn't installed). Otherwise it falls back to rembg Auto. You can always change the selection manually - the dropdown shows install / download instructions inline for any option that isn't ready to use.

---

## 📺 Learning Resources

Master the Pixaroma suite with our video guides and workflow deep-dives:

📺 **[Visit Pixaroma on YouTube](https://www.youtube.com/@pixaroma)**

---

## 🛠 Changelog

> 💡 **After updating Pixaroma:** hard-refresh your ComfyUI browser tab with **Ctrl+Shift+R** (or **Cmd+Shift+R** on Mac). The browser keeps old node visuals cached, and without a hard refresh you may still see the previous version of a node even though the update installed correctly.

### **May 19, 2026 · v1.3.40–1.3.47**
- **NEW: Run Button FX & Connection FX.** Optional flair in Settings: 8 styles for the Run button (flames, lightning, sparkles, shockwave…) and a magnetic glow with particles while you drag a wire to a slot. Both off by default.
- **NEW: One-click node colors.** Right-click any node → **👑 Pixaroma colors** for 33 ready-made themes, plus a saved Favorite and a custom picker. Works on several selected nodes at once, and the colors travel with the workflow when you share it.
- **Text & prompt nodes share one clean look.** Matching textareas, buttons, and spacing that blend with any node color. Text Pixaroma gained **Copy all / Replace / Clear** buttons, and the mode pills on Prompt Pack/Multi moved to the top with hover tips.
- **Load Image & Prompt Reader: easier browsing.** ◀ ▶ arrows (and PageUp/Down) flip through your images, input subfolders show as labelled groups, and the layout is tighter.
- **Align lines up with Labels & Notes**, and those two no longer show a timing badge after a Run.
- **Works again on older ComfyUI installs** (a recent update could hide the whole Pixaroma menu).
- Plus smaller touches: Image Compare one-click Copy, a default save-mode setting for Preview Image, and fixes for drag-selecting text in prompt rows, layer renaming, and minimum node sizes.

### **May 18, 2026 · v1.3.37–1.3.39**
- **NEW: Text Overlay Pixaroma.** Add a styled caption to any image: 10 fonts, bold/italic, alignment, size, rotation, color, and an optional background bar. Open the fullscreen editor to drag, scale, and rotate the text with snap guides, then Save to Disk.
- **NEW: Prompt Pack Pixaroma.** Paste a block of prompts and the node runs your workflow once per prompt (split by blank line or by line), with a live countdown.
- **NEW: Prompt From List Pixaroma + Prompt Multi "List mode".** Send different prompts to different parts of a single workflow.

### **May 17, 2026 · v1.3.32–1.3.35**
- **NEW: Prompt Stack Pixaroma.** Stack prompt chunks in labelled rows, toggle each on/off, drag to reorder, and join them into one prompt with your chosen separator.
- **AI Background Removal: built-in model dropdown.** Three BiRefNet quality levels right on the node (drop `.safetensors` into `ComfyUI/models/background_removal/`). Now works on 4–6 GB cards (auto-retries smaller, falls back to CPU if needed), and the Composer/Paint editors use the same models.

### **May 15, 2026 · v1.3.28–1.3.31**
- **NEW: Switch Pixaroma.** A universal one-click switch for any data type (models, images, prompts, masks, audio…). It grows its inputs as you wire more (up to 32) and only one is active at a time.
- **NEW: Remove Background Pixaroma.** One node that outputs the cutout, the mask, and the inverted mask together — replacing the usual three-node chain.
- **Show Text: one-click Copy button.** Prompt Reader now also reads prompts routed through a Switch.

### **May 13, 2026 · v1.3.24–1.3.27**
- **NEW: Prompt Reader Pixaroma.** Drop a generated PNG on it to instantly read the prompt saved inside (works with ComfyUI, A1111, Forge), with a Copy button and a text output.
- **Load Image: cleaner resize math.** Picking "1 MP" keeps 1024×1024 (SD/SDXL/Flux-friendly); presets map to 512² / 1024² / 2048², and the on-canvas readout matches the real output.
- **AudioReact handles long audio** without crashing, with a live memory indicator. **Preview Image:** wired filenames always work and refresh after you delete a saved file.

### **May 12, 2026 · v1.3.21–1.3.23**
- **NEW: Load Image Pixaroma.** A drop-in replacement for LoadImage with built-in resize controls (7 modes, aspect-ratio presets, snap-to-multiple, math in number fields) and 7 outputs, so you can skip downstream resize chains. A live readout shows the resulting size before you Run.
- **NEW: small utility nodes** — Text, Number (int + float), WH, and Switch WH.
- **Drag-and-drop images** onto Image Crop / Composer / Paint. **Preview Image:** new Copy & Open buttons, and Save buttons honor a wired filename.

### **May 10, 2026 · v1.3.18–1.3.20**
- **Preview Image: native-style grid for batches.** Thumbnails fill the space as big as possible, with a per-node Grid/Strip toggle, and filenames now accept date folders like `%date:yyyy-MM-dd%/img`.
- **Image Composer:** your chosen canvas background color now survives a Run, and the mini-preview thumbnail stays square as you resize.
- **Fixed:** the right-sidebar Parameters tab no longer breaks Pixaroma node bodies. Plus clearer Info-panel descriptions and a calmer startup notice.

### **May 09, 2026**
- **NEW: Notify Pixaroma** - a tiny terminal node that plays a sound when reached during a workflow run. Drop one at the end of a workflow to hear "render finished" when you're in another browser tab or app, or branch one off any checkpoint. 10 bundled sounds in `assets/sounds/` (drop in your own `.mp3`/`.wav`/`.ogg` to extend). Per-node enabled toggle, volume slider, label, and a **▶ Preview** button to audition a sound without running the workflow. Master toggle under **Settings → 👑 Pixaroma → Notify** silences every Notify node at once. Always re-fires on every Run, even when upstream is fully cached. Help panel now shows full Description + per-input tooltips.

### **May 08, 2026**
- **Align Pixaroma fixes:** Ctrl+drag marquee selection no longer slides previously-selected nodes around. A small "the selection shifts a tiny bit" glitch when starting a new marquee right after a previous one is also gone. Canvas pans no longer trigger snap either.

### **May 07, 2026**
- **Preview Image Pixaroma fixes:** Single-image previews now always show the `WxH` dimension footer (previously only batches did). Going from a batch (in expanded view) to a single-image run no longer leaves a stuck close X over the new image.
- **Show Text Pixaroma rewrite:** Real read-only text box you can **select and copy text from** (the previous version did not allow selection). **Resize the node freely** in any direction; long text scrolls instead of forcing the node to grow. New **STRING output** named `text` so the node can chain into other nodes - inspect a prompt and still pass it on. Last-shown text saves and restores with the workflow.
- **Note Pixaroma - centered-modal overhaul:** Every insert button (Icon, Separator, Grid, Button, Folder hint, YouTube, Discord) now opens a clean centered modal with its own colour picker. Each inserted block carries its **own** colour, so two separators (or two grids, or two folder hints) in the same note can look completely different.
- **5 separator styles + grid colour pickers + plain button option:** Separators come in solid, dashed, dotted, double, or thick. Grids have per-instance border AND header background colours. Buttons can be Download, View Page, Read More, or a plain pill with no icon.
- **New Folder hint toolbar button:** Folder bundling moved out of the button modal into its own entry. Use it to add a "Place in: ComfyUI/..." line under any button.
- **LLM prompt file:** `assets/note-pixaroma-llm-prompt.txt` is a drop-in system prompt for ChatGPT or Gemini so they can generate Code-view-ready HTML for your notes.

### **May 06, 2026**
- **NEW: Align Pixaroma:** Toggleable smart-snap and alignment-guide system for the node canvas. Click the mountain icon in the top toolbar to enable; dragging or resizing nodes then snaps to nearby edges and centers with thin orange guide lines. Hold **Shift** to bypass snap for one drag. Default OFF (zero overhead when disabled).
- **Note Pixaroma colour pickers:** Text and highlight pickers got an Excel-style swatches popup (3 rows of 12 = 36 colours, Reset, "More colours..." for HSV/hex). Picks are now sticky across cursor moves and typing sessions.
- **Image Crop upgrade:** Now works with **any IMAGE source**, not just Load Image (wire a VAE Decode or anything producing an IMAGE). Compact W / H / X / Y / Ratio / Alignment panel right on the node body. Math expressions in the number fields. Press **Ctrl+V** to paste an image straight from your clipboard.

### **May 05, 2026**
- **Image Composer - per-layer blur:** Non-destructive Gaussian blur slider in the Transform Properties panel. Each layer keeps its own blur value.
- **Image Composer - Shift+Scroll** scales the selected layer (±5% per tick).
- **Image Composer fixes:** High-res upstream images no longer get downsampled to the placeholder slot size; placeholder ratio changes preserve the image preview; selection box no longer drifts at canvas edges.

### **May 04, 2026**
- **Preview Image Pixaroma upgrade:** Batches render as a horizontal thumbnail strip with `i / N` counters - click any thumbnail to open it inline at full size; arrow keys navigate; Esc collapses. New **save_mode** widget: flip to `save` and the node becomes a drop-in for SaveImage with workflow metadata embedded. Previews survive workflow tab switching.
- **Resolution Pixaroma:** Added 4:3, 3:4, and 4:5 aspect ratios. New **Custom Ratio** mode for any W:H. Math expressions now work in the Width and Height fields.

### **April 27, 2026**
- **NEW: AudioReact Pixaroma**: turn an image into an audio-reactive video with a fullscreen WebGL editor. 15 motion modes, 8 stackable overlays, real-time scrubbable preview.
- **NEW: Save Mp4 Pixaroma**: encode frames + audio straight to MP4, with an in-node video preview.

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

💡 **Have an idea for a new node or improvement?** Post it in [Discussions](https://github.com/pixaroma/ComfyUI-Pixaroma/discussions).  
🐞 **Found a bug or something broken?** Open an [Issue](https://github.com/pixaroma/ComfyUI-Pixaroma/issues).  
💬 **[Join our Discord Community](https://discord.gg/gggpkVgBf3)**  
⚖️ **Licensed under [MIT](https://github.com/pixaroma/ComfyUI-Pixaroma/blob/main/LICENSE)**
