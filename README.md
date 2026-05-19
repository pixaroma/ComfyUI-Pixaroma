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

### **May 19, 2026 (1.3.43)**
- **NEW: Color any node in the Pixaroma look with one click.** Right-click any node in ComfyUI (yours or any other plugin's) and you now see a **👑 Pixaroma colors** entry. Open it for a submenu of 33 ready-made themes designed to read well with the dim gray title text ComfyUI uses on unselected nodes. Three neutral darks at the top (Dark, Onyx, Charcoal), then 15 hue families: Red, Orange, Gold, Olive, Lime, Green, Teal, Cyan, Sky, Blue, Indigo, Purple, Magenta, Pink, Brown. Each hue has TWO paired versions: a plain hue (title and body in matching color) and a **Pixa[Hue]** version (same identity color on the title with a Pixaroma dark gray body). Stack a plain node above its Pixa partner and the bright color matches across them visually. Every entry in the submenu shows a small two-tone swatch beside its name so you can see what you are about to apply at a glance.
- **Favorite Title + Favorite Body settings.** Open Settings, search Pixaroma, and you will see two new color pickers for your personal favorite title and body. The submenu has a **Favorite (from settings)** entry that applies your saved pair in one click, perfect for keeping your custom brand a click away on every workflow.
- **Pick custom colors modal.** A **Pick custom...** entry in the submenu opens a side-by-side picker for title and body with a small live-preview node above so you can see exactly how your combo will look before clicking Apply. Whatever you Apply automatically becomes your new Favorite, so two clicks reuse the same custom colors next time.
- **Multi-select aware.** Select multiple nodes (marquee or Ctrl+click), right-click one of them, and the menu label updates to **"👑 Pixaroma colors (N nodes)"**. Picking a theme paints all of them at once. Same for the **Reset** entry.
- **Workflows travel.** The colors land directly on each node's saved color fields, so anyone you share the workflow with sees the same colors. No need for them to install Pixaroma to see your scheme.

### **May 19, 2026 (1.3.42)**
- **Text and prompt nodes share one visual language now.** Across Text Pixaroma, Show Text Pixaroma, Prompt Pack Pixaroma, Prompt Multi Pixaroma, Prompt Stack Pixaroma, Switch Pixaroma, and Switch WH Pixaroma: same dark textarea look, same button shape and size, same row spacing, same focus highlight. Right-click a node and pick a custom color and the buttons, toggle pills, and inline controls all blend with the new color instead of standing out as dark gray patches.
- **Text Pixaroma got a new button row.** Three small buttons now sit at the bottom: **Copy all** puts the entire textarea on your clipboard, **Replace** pastes whatever text is on your clipboard into the field (it warns you instead of wiping if the clipboard is empty or has only an image), and **Clear** wipes the field instantly with no confirm dialog. Hover any button to see what it does.
- **Prompt Pack and Prompt Multi: mode pills moved to the top, hover tooltips added.** The Paragraph / Line pills on Prompt Pack and the Queue Text / List Prompts pills on Prompt Multi now sit on the same line as the output labels at the top of the node, freeing up vertical space inside. Hover any pill to see what mode it switches to. The bottom action row on both nodes also got a fresh look (**Add prompt** / **Clear all** / **Reset** on Multi, **Copy all** / **Replace** / **Clear** on Pack), all with hover tooltips.
- **Prompt Stack got the same polish.** Adaptive colors for rows and inputs, action buttons renamed for consistency ("Clear all" instead of "Clear text", "Add row" instead of "+ Add row"), hover tooltips throughout.
- **Show Text Pixaroma is more compact by default.** New nodes drop on the canvas at a small 210 × 118 strip so you can use Show Text as an inline label next to other nodes. Drag the corner outward when you need more reading room. The textarea inside now matches the other text nodes.
- **Switch and Switch WH buttons adapt to custom node colors too.** The OFF state of the toggle pill on Switch and the inactive A / B button on Switch WH blend with whatever node color you pick. Switch's "(empty)" placeholder text on trailing rows is now easier to read.
- **Fixed: drag-selecting text in a prompt row no longer steals the row.** On Prompt Stack and Prompt Multi, trying to select a portion of text inside a row used to accidentally pick up the whole row and try to reorder it. Now you can drag-select normally; only the small ⋮⋮ handle on the left of each row triggers a reorder.
- **Fixed: renaming a layer in Image Composer / Paint / 3D Builder no longer cancels when you drag-select text.** Trying to drag-select a portion of a layer name to overwrite just part of it used to dismiss the rename input on mouse release. Now selection works as expected and you can keep typing.
- **Fixed: nodes no longer break when shrunk too small.** Switch WH, Show Text, Prompt Stack, Prompt Multi, and Prompt Pack each now have a strict minimum size and they self-heal if anything tries to resize them past that minimum, so buttons can never get pushed past the node frame.

### **May 19, 2026 (1.3.41)**
- **Load Image Pixaroma: flip through your images with arrows.** A small ◀ button on the left and a ▶ button on the right of the filename dropdown step through every image in your input folder in order. Each click changes the picked file and the preview updates automatically so you can scrub through a batch visually until you find the one you want. PageUp and PageDown do the same when the node is selected. A tiny "3 / 247" counter inside the dropdown shows where you are in the list.
- **Load Image Pixaroma + Prompt Reader Pixaroma: subfolders inside the input folder are now visible.** If you keep your inputs sorted into folders (3d, pasted, References, etc), opening the dropdown now shows them as labelled groups instead of hiding them entirely. Each entry shows just the filename for fast scanning; hovering shows the full path. The previously selected file scrolls into view when you open the dropdown.
- **Load Image Pixaroma: tighter layout, less scrolling.** The input and output dimensions now sit side by side on one line (was two lines stacked vertically), the resize mode buttons are arranged 3 per row (was 2 per row), and new nodes drop on the canvas a little wider so everything fits naturally. The Pad color picker for Match aspect ratio now uses the same Photoshop-style picker as Text Overlay (swatches + colour square + hue slider + hex code + Apply / Cancel) so you can pick exactly the colour you want with confidence.
- **Prompt Reader Pixaroma got the same upgrade.** Same upload-button icon as Load Image (so the two nodes feel consistent), same ◀ / ▶ arrows next to the dropdown, same PageUp / PageDown shortcut, same subfolder grouping in the popup. Perfect for stepping through a folder of generated images one by one to read each prompt.
- **Image picker hardening.** Tightened up a class of edge cases where the bottom preview could end up out of sync with the picked filename if you switched images very quickly, switched workflow tabs, or had autosave kick in mid-pick. Multiple internal safeguards now keep the picked filename, the preview, and the workflow input all pointing at the same image at all times.

### **May 19, 2026 (1.3.40)**
- **Pixaroma loads again on older ComfyUI installs.** If you were on an older ComfyUI Portable build, updating Pixaroma past 1.3.30 made the entire Pixaroma menu disappear at startup with an Import Failed error. Every Pixaroma node now loads normally on older ComfyUI. Only Background Removal needs a current ComfyUI; if you try to use it on an older build, you get a clear message asking you to update ComfyUI first. Everything else (Image Composer, Paint, 3D Builder, Compare, Crop, Note, Load Image, Switch, Prompt Stack, Prompt Reader, Text Overlay, and all the other nodes) works fine even on the older build.
- **Image Compare: one-click Copy.** When you flip into Show 1 or Show 2 mode, a small Copy button now sits to the right of the hint text. Click it to put that image on your clipboard so you can paste straight into Photoshop, Discord, another node, anywhere. The button is hidden in side-by-side / overlap / difference modes so it never gets in the way. The node body height never changes when you toggle Show 1 / Show 2.
- **Preview Image Pixaroma: choose the default save mode.** Open Settings, search Pixaroma, and you will see a new option called Default save mode under Preview (save mode). Pick whether new Preview Image Pixaroma nodes start in Preview (writes to temp, auto-cleared on restart) or Save (writes to output with workflow metadata baked into the PNG). Existing nodes inside your saved workflows are untouched; this only affects fresh nodes you drop on the canvas after picking.

### **May 18, 2026 (1.3.39)**
- **NEW: Text Overlay Pixaroma** - add a styled text caption to any image. 10 bundled fonts, bold / italic, three alignments, size, line height, letter spacing, opacity, rotation, X / Y, text color and an optional background bar behind the text. Math expressions work in every number field (type `100+12`, hit Enter, you get 112). Click **Open Text Editor** for a fullscreen canvas: drag the text to move it, drag the corners to resize from the center (Alt to resize from the opposite corner instead), drag the round handle to rotate, Shift+wheel to scale in place, snap guides catch on canvas center / thirds / edges. **Fit W** and **Fit H** buttons fill the text to the image width or height. **Save to Disk** exports a PNG straight to your machine. Wire the optional **text** input to override the caption from any upstream text source, and the textarea grays out so you know typing there is ignored. New nodes auto-center the text on whatever image you wire in, so the first render comes out looking right without any positioning fiddle.

### **May 18, 2026 (1.3.38)**
- **NEW: Prompt Pack Pixaroma** - paste a block of prompts in one textarea and the node queues one workflow run per prompt. Pick **Paragraph** (prompts separated by blank lines, good for long flowing prompts) or **Line** (one prompt per line, good for short lists) with the pill at the top. While running, a counter in the bottom-right corner counts down "3 left, 2 left, 1 left" so you can see how many images are still to come. A **Clear prompts** button on the bottom-left wipes the textarea with a confirm dialog. Drop a generated PNG back on Prompt Reader Pixaroma to recover the exact prompt that produced that specific image.
- **Prompt Multi - smaller fixes:** two rows with the exact same text both render properly in Queue Text mode now (previously the second one silently reused the first image). Opening an older workflow no longer marks it as modified just by opening it. Clicking the ON / OFF pill on a row no longer flickers the row or triggers a stray toggle. Plays nicer with other workflow plugins that also customise the Run button.

### **May 18, 2026 (1.3.37)**
- **Prompt Multi Pixaroma - new List mode for sending different prompts to different parts of the same workflow.** Two pills at the top of the node toggle between Queue Text (the original behaviour - one image per enabled prompt) and List Prompts (one run, the whole list goes out as a single wire). In List mode, pair with the new Prompt From List Pixaroma to pick which prompt feeds which downstream slot - perfect for multi-scene workflows where scene 1, scene 2, scene 3 each need a different prompt from the same library.
- **NEW: Prompt From List Pixaroma** - tiny picker node. Wire it to Prompt Multi's `prompts` output, set a number for which row you want, and the picked prompt comes out the other side. Drop several copies in your workflow, each set to a different number, to fan one library out to many destinations without cluttering the library node with multiple output dots.
- **Prompt Multi - extra polish:** new **Clear prompts** and **Reset** buttons next to Add prompt; **rows are now called "Prompt 1, Prompt 2…"** instead of "Row 1, Row 2…"; **empty enabled prompts are skipped at run time** so a leftover blank row doesn't waste a queue slot.
- **Prompt Stack Pixaroma - matching polish:** new **Clear text** and **Reset** buttons next to Add row, same themed confirm dialogs as Prompt Multi.
- **Prompt Reader Pixaroma reads the new flow:** Drop a PNG generated through the new List Prompts + From List combo back into Prompt Reader and you get the exact prompt that produced that specific image.

### **May 17, 2026 (1.3.35)**
- **AI background removal works on 4-6 GB cards.** BiRefNet Standard no longer fails with out-of-memory on a 6 GB card. The dropdown adds a new **BiRefNet Low VRAM** option for guaranteed-fits 512px cutouts when you want it faster. If memory still gets tight, the model automatically retries at smaller sizes and finally falls back to CPU - the click never silently fails.
- **Auto Remove on Execute now uses the model you picked.** Previously, ticking Auto Remove on Execute with BiRefNet Standard (or HR / Matting) silently switched to a rembg model at workflow time and produced a different cutout than the manual Remove Background button. Now the same model runs in both places.
- **Model dropdown stops flipping back to rembg Auto when you select a layer.** Picking BiRefNet Standard for a layer and then clicking on it used to revert the dropdown to rembg Auto. The pick now sticks.

### **May 17, 2026 (1.3.34)**
- **AI Remove Background dropdown matches the standalone node.** Image Composer and Paint editors now read the same BiRefNet model files as Remove Background Pixaroma. Drop your `.safetensors` once into `ComfyUI/models/background_removal/` and both work. Defaults to BiRefNet Standard if installed; existing rembg options stay listed below. Not-installed entries show an inline Download link.

### **May 17, 2026 (1.3.33)**
- **NEW: Remove Background dropdown built into the node**, with three BiRefNet variants - Standard (1024px, 4-6 GB VRAM), HR (2048px, 8 GB+), and Matting (2048px, soft edges for hair/fur). No more separate Load Background Removal Model node to wire in. Drop `.safetensors` into `ComfyUI/models/background_removal/`; processing resolution picked automatically from the filename. Output stays the same size as input.

### **May 17, 2026 (1.3.32)**
- **NEW: Prompt Stack Pixaroma** - one node that holds an ordered stack of prompt chunks. Type different parts of your prompt in each row (style, subject, lighting, quality boosters), label them, and toggle the orange ON / OFF pill to include or skip each one at run time. Drag to reorder. ON rows join with your chosen separator (default `, `, set under Settings) into one text output. Great for testing prompt variants by clicking toggles instead of editing text.
- **Prompt Reader Pixaroma reads Prompt Stack output:** Drop a PNG generated with Prompt Stack into Prompt Reader and you get back the exact combined prompt, separator included.

### **May 15, 2026 (1.3.31)**
- **NEW: Remove Background Pixaroma** - a single node that replaces the usual three-node chain for background removal. Wire in your image and a Load Background Removal Model, and the node outputs the cutout image (with transparent background), the foreground mask, and the inverted mask all at once. Same result as the native Remove Background + Invert Mask + Join Image with Alpha chain, but with fewer cables on your canvas.

### **May 15, 2026 (1.3.30)**
- **Show Text Pixaroma now has a one-click Copy button.** Hover the text box and a small orange Copy button fades in at the bottom-right corner; click it to put the text on your clipboard, briefly turns green to confirm. Native text selection and Ctrl+C still work for partial copies.

### **May 15, 2026 (1.3.29)**
- **Prompt Reader Pixaroma reads through switches:** If your workflow had a Switch Pixaroma (or rgthree's Any Switch) between your text node and the prompt encoder, dropping the generated PNG on Prompt Reader used to say "no positive prompt found" even though the prompt was right there in the image's metadata. The reader now picks the active row of a Switch Pixaroma (and the first connected input of an Any Switch) and traces the text from there.

### **May 15, 2026 (1.3.28)**
- **NEW: Switch Pixaroma** - a universal multi-input switch for any data type. Connect models, images, prompts, masks, audio, latents, anything you want, and pick which one flows through with a single click on its toggle. The node starts with one input and grows on its own as you connect more cables (up to 32 rows). Each row gets a label that auto-fills with the type name (MODEL, IMAGE, CLIP...) so you can tell what is wired where at a glance; click the label to type your own name (for example "main checkpoint" or "alt prompt"), clear it and press Enter to revert to the type name. Only one input can be active at a time, lit up in Pixaroma orange. Disconnect the active row and the switch automatically moves to the next available one so your workflow doesn't break. All settings save with your workflow.

### **May 13, 2026 (1.3.27)**
- **NEW: Prompt Reader Pixaroma** - drop a PNG that was generated with ComfyUI (or Automatic1111 / Forge) onto the node and instantly see the **positive prompt** that was saved inside its metadata. No image preview, just the text. One orange **Copy** button puts the prompt on your clipboard; the **STRING output** wires straight into CLIPTextEncode so you can re-use the prompt without retyping. The reader walks back through chained text nodes (ConditioningCombine, StringConcatenate, SDXL dual-text encoders) so workflows with complex prompt structures still work, **and** it also follows the trail through earlier Prompt Reader Pixaroma nodes when an image was generated from a prompt loaded out of another image. If the image has no prompt (JPG, screenshot, or a PNG whose metadata was stripped), you get a short clear message instead of a silent fail.

### **May 13, 2026 (1.3.26)**
- **AudioReact - long audio no longer crashes:** Rendering audio longer than ~30 seconds at HD used to slow to a crawl past the 50% mark and crash after eating most of your free disk space. The render now uses much less memory. If the chosen settings would still need more memory than your computer has free, you now see a clear message right away (with what to lower) instead of waiting through a partial render that ends in a crash.
- **AudioReact - live memory indicator in the editor:** The editor's top bar shows how much memory the current settings will need versus how much your computer has free, color-coded so you can tell at a glance: green means safe, amber means tight, red means the render will refuse. Updates live as you change fps, resolution, or audio.
- **AudioReact - memory reference table in Help:** A new table in the Help panel lists typical memory needs for common combinations of duration (30 seconds / 1 minute / 3 minutes) at 512×512 / 720p / 1080p, so you can plan ahead.
- **AudioReact - Save button works even with no changes:** Opening the editor, looking around, and clicking Save without changing anything now closes the editor cleanly. Previously the click did nothing if you hadn't made changes, which felt like the button was broken.

### **May 13, 2026 (1.3.25)**
- **Load Image Pixaroma - Max megapixels now keeps 1024 at 1024:** Picking **1 MP** on a 1024×1024 image now leaves it at 1024×1024 (matching how ComfyUI's built-in node works), so the output stays friendly for SD / SDXL / Flux and empty-latent nodes downstream. Previously you got 1000×1000 which doesn't divide cleanly and could cause issues in later steps. The MP presets now map to clean AI sizes: **0.25 MP = 512², 1 MP = 1024², 4 MP = 2048².**
- **Load Image Pixaroma - resolution rounding is consistent:** The on-canvas Output number now matches exactly what the workflow produces, and the resolution snap chips (8 / 16 / 32 / 64) never push the result above your chosen max megapixels.

### **May 13, 2026 (1.3.24)**
- **Preview Image Pixaroma - wired filename always works now:** Wiring any text into the filename field (for example a Text Pixaroma, or Load Image's filename output) now always produces a valid name, even when the text has spaces, dots, or unusual characters. Previously the save button failed with an error for anything but plain words.
- **Preview Image Pixaroma - Run refreshes after deleting saved files:** If you delete the saved image from disk and click Run again, the file is re-saved and the preview refreshes. Previously the preview stayed dark and you had to change the filename to recover.
- **Load Image Pixaroma - file picker scrolls properly:** Scrolling through the file list with the mouse wheel no longer closes the dropdown.

### **May 12, 2026 (1.3.23)**
- **NEW: WH Pixaroma** - tiny utility node with two number fields for width and height, and matching outputs. Type a target resolution manually somewhere in your workflow. Math expressions like `1024+64` work directly in the fields.
- **NEW: Switch WH Pixaroma** - switch between two width/height sources with a single click. Wire two W+H pairs into the **A** and **B** inputs, then click A or B on the node body to pick which pair flows through. No rewiring. If one side is partially wired (one cable forgotten), the node uses the complete other side; if nothing is wired, you get a clear error message.
- **NEW: Number Pixaroma** - one number field with two outputs: **int** and **float**. Useful when one downstream node wants a whole number and another wants a decimal from the same value. Accepts math expressions like `1024/3` and very large numbers (up to about 1 quadrillion). The int output rounds to the nearest whole number.
- **NEW: Text Pixaroma** - multi-line text field with a STRING output. Write a prompt once and wire it into multiple downstream nodes; the field grows as you resize the node.
- **Load Image Pixaroma - image preview fills the node when resized:** Dragging the node taller no longer leaves an awkward gap between the controls and the image preview. The image now grows to fill the available space.
- **Preview Image Pixaroma - Save buttons honor wired filename:** When you wire a cable into the `filename_prefix` input (for example Load Image Pixaroma's FILENAME output), the **Save Disk** and **Save Output** buttons now use the wired filename. Previously they ignored the wire and saved as `img_...` regardless.

### **May 12, 2026 (1.3.22)**
- **Preview Image Pixaroma - Copy and Open buttons:** Two new orange buttons next to Save Disk / Save Output. **Copy** copies the selected image to your clipboard so you can paste it into another node, a paint app, a chat message, anywhere. **Open** opens the selected image in a new browser tab for full-screen viewing or comparing several side by side. Both act on the image you're currently viewing when you have a batch, so you get the frame you clicked, not always the first or last. Also fixed: dragging the node smaller used to let the buttons spill outside the node frame; the buttons now stay inside.
- **Drag-and-drop on Image Crop / Image Composer / Paint:** Drop an image file anywhere on the node and it loads in. **Image Crop** sets the dropped image as the source. **Image Composer** and **Paint** open the editor and add the dropped image as a new layer on top of any existing layers (never replaces, like Photoshop / Figma / Affinity).
- **Image Crop - Load Image button + center-crop fix:** The in-editor **Load Image** button is now always available, even when an image is wired in (using it replaces the wired image). Also fixed a long-standing center-crop bug: changing Width or Height on the node right after loading a workflow used to crop from the top-left even with **Center Crop** selected. Centered crop now works correctly.
- **Load Image Pixaroma - drop UX cleanup:** Drop anywhere on the node (the orange "Drop to upload" overlay is gone). 

### **May 12, 2026 (1.3.21)**
- **NEW: Load Image Pixaroma** — a drop-in replacement for ComfyUI's `LoadImage` with inline resize controls and 7 outputs. Same file-picker / drag-drop / Ctrl+V paste / multi-frame / alpha-to-mask behavior as native, plus 7 resize modes (Off, Max megapixels, Longest side, Scale by ×, Fit inside, Crop to fill, Match aspect ratio with Crop or Pad) all driven from chips and numeric inputs on the node — no need to open an editor. Match-aspect-ratio offers 11 presets + Custom (1:1, 16:9, 9:16, 2:1, 3:2, 2:3, 4:3, 3:4, 4:5, 21:9, 5:4) and a Pixaroma color picker for the Pad color. Snap-to-multiple (8 / 16 / 32 / 64), Resample picker with hint text under each option (Auto / Nearest / Bilinear / Bicubic / Lanczos), and an Allow-upscaling toggle apply as post-modifiers. Numeric fields accept math expressions like `1024+64` or `512*2`, ↑↓ arrow stepping (Shift+arrow = 10× step), and have visible +/- spinner buttons. A live INPUT → OUTPUT info bar with tiny aspect-ratio rectangles shows the source dims + resulting dims as you tweak settings, so you can see exactly what the workflow will produce before you Run. Outputs: `IMAGE`, `MASK`, `WIDTH`, `HEIGHT`, `FILENAME` (without extension), `ORIGINAL_WIDTH`, `ORIGINAL_HEIGHT` — eliminates downstream Get Image Size + Image Scale + Image Resize chains in most workflows.

### **May 10, 2026 (1.3.20)**
- **Parameters tab no longer breaks Pixaroma nodes:** Switching to the right-sidebar **Parameters** tab on any Pixaroma editor / preview node (Paint, Image Composer, Image Crop, 3D Builder, Resolution, Note, Show Text, Save Mp4, Preview Image, Reference) used to duplicate the node's controls inside the Parameters panel AND visually break the node body itself. Fixed.
- **Preview Image Pixaroma - native grid layout for batches:** Reworked the Grid mode to match native ComfyUI exactly: it picks the column count that makes thumbnails as big as possible, and cells touch directly with no extra space between them. Any unused area sits at the edges of the grid instead of between thumbnails. Layout adapts cleanly to node shape: wide node + 5 imgs → 5×1, square + 5 imgs → 2×3, tall narrow + 5 imgs → 1×5. Identical to native ComfyUI at the same node size.
- **Preview Image Pixaroma - badge / Description polish:** The orange `i / N` selection badge no longer overlaps the orange selection border at any aspect ratio. The node's right-sidebar Info panel description rewritten as clear plain text.

### **May 10, 2026 (1.3.19)**
- **Preview Image Pixaroma - grid layout for batches:** Multi-image batches now wrap into a 2D grid by default (3 imgs → 2×2, 5 imgs → 2×3, 9 imgs → 3×3...), matching native PreviewImage. Thumbnails stay big regardless of batch size, no more wasted vertical space. A small toggle icon in the top-right of the preview flips between **Grid** and **Strip** (single horizontal row, the previous behavior) per node; the default for new nodes lives under **Settings → 👑 Pixaroma → Preview → Default batch layout**.
- **Preview Image Pixaroma - date tokens in `filename_prefix`:** The filename field now accepts the same date-folder syntax as VHS / Save Image extras: `%date:yyyy-MM-dd%/img` writes into `output/2026-05-10/img_00001_.png`. Native ComfyUI tokens (`%year%`, `%month%`, `%day%`, `%hour%`, `%minute%`, `%second%`, `%width%`, `%height%`) also work. Hover the field for examples. Applies to both the **Save to Output** button and `save_mode=save`.
- **Preview Image Pixaroma - badge polish:** The `i / N` counter pill no longer overlaps with the orange selection border at certain image aspect ratios, and stays a consistent dark pill in every state instead of going orange-on-orange when selected.

### **May 10, 2026 (1.3.18)**
- **Image Composer fix:** the canvas background colour you pick in the editor now survives the workflow run. Previously, if a Composer had placeholder slots (or auto background removal, or eraser masks), running the workflow flipped the background from your chosen colour to black in BOTH the in-node mini preview and the downstream Preview Image. Re-save any existing project to carry the colour forward; older saves without a saved bg colour fall back to the editor's default dark grey.
- **Editor mini-preview squaring fix:** the small preview thumbnail under Image Composer / Paint / Image Crop / 3D Builder nodes now stays square as you resize the node, instead of locking into a wide letterboxed rectangle that only "snapped right" once you ran the workflow.
- **Help panel polish (every node):** ComfyUI's right-side Info tab now shows real Description text for every Pixaroma node instead of blank rows. Each input also has a hover tooltip explaining what to wire and what it does.
- **Banner notice rewrite:** the "Some Pixaroma nodes conflict with Nodes 2.0" line at startup was a bright orange one-liner that several users read as an error. It's now two grey lines starting with "This is a notice, not an error" and only the **Pixaroma** brand word stays orange. Same intent, less alarm.

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
