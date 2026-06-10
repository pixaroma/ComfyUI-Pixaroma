<div align="center">
  <img src="assets/pixaroma_logo.svg" width="120" alt="Pixaroma Logo">
  <h1>ComfyUI Pixaroma</h1>
  <p align="center">
    <strong>Useful ComfyUI nodes for everyday workflows.</strong><br />
    Load Image • Crop • Compose • Paint • 3D • Compare • Preview • Save MP4 • Notes & Labels • Resolution • Switches • Remove Background • Text & Number utilities
  </p>

  <p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
    <a href="https://discord.gg/gggpkVgBf3"><img src="https://img.shields.io/badge/discord-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord"></a>
    <a href="https://www.youtube.com/@pixaroma"><img src="https://img.shields.io/badge/youtube-red?style=flat-square&logo=youtube" alt="YouTube"></a>
  </p>
  <p align="center">
    <a href="#-getting-started">📥 Install</a> &nbsp;·&nbsp;
    <a href="#-creative-suite">🎨 Nodes</a> &nbsp;·&nbsp;
    <a href="#-learning-resources">📺 Tutorials</a> &nbsp;·&nbsp;
    <a href="#-changelog">🛠 Changelog</a> &nbsp;·&nbsp;
    <a href="https://discord.gg/gggpkVgBf3">💬 Discord</a>
  </p>
</div>

---

> 💬 **Need help, have an idea, or found a bug?** Hop into the [Pixaroma Discord](https://discord.gg/gggpkVgBf3) and post in the **#pixaroma-nodes** channel.

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

### 📊 XY Plot Pixaroma
Compare settings side by side without setting anything up. Drop it at the end of your workflow and wire your final image in, just like a preview node. Then pick what changes **across** (columns) and **down** (rows) from a dropdown of the nodes already in your graph - no extra wiring. The value box adapts to your pick: a number gives a Start/End/Steps range, a dropdown (sampler, model, scheduler) gives a checklist, and your prompt gives find-and-replace. Hit Run once and every combination fills a labeled grid right in the node, with **Dark/Light/Mono** grid themes and **Save/Copy/Open** buttons. The seed stays **locked** across the grid so the only thing changing is the thing you're testing.

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

### ⏸️ Pause Image Pixaroma
A checkpoint you drop into your workflow to stop and look at the image before running the slow part (like an upscale or a second pass). Press Run and it pauses there, showing you the image while the rest of the workflow waits. Like what you see? Hit **Continue** and only the steps after it run - the heavy generation is skipped, so it's fast, and you upscale the exact image you saw. Don't like it? Hit **Regenerate** for a fresh one, or change something upstream and run again. Flip the toggle to **Pass** to run everything in one go. **Copy**, **Save to disk**, **Save to output**, and **Open** buttons act right on the previewed image. Works in both the classic and the new node interface.

### 🖼️ Load Image Pixaroma
A drop-in replacement for ComfyUI's native LoadImage with everything you'd want in one node. Same upload / drag-drop / Ctrl+V paste / multi-frame / alpha-to-mask behavior as native, plus inline resize: pick from **Off**, **Max megapixels**, **Longest side**, **Scale by ×**, **Fit inside**, **Crop to fill**, or **Match aspect ratio** with a sub-toggle for Crop or Pad (12 ratio presets + Custom, with a Pixaroma color picker for the Pad color). **Snap to /8/16/32/64**, **Resample picker** (Auto / Nearest / Bilinear / Bicubic / Lanczos with one-line hints under each), and an **Allow upscaling** toggle apply on top. Numeric fields accept math expressions (`1024+64`, `512*2`), ↑↓ arrow stepping (Shift = 10×), and have visible +/- spinner buttons. A live **Input → Output** info bar with tiny aspect-ratio rectangles shows you exactly what dimensions the workflow will produce as you tweak settings. Outputs include `IMAGE`, `MASK`, `WIDTH`, `HEIGHT`, `FILENAME` (no extension), `ORIGINAL_WIDTH`, `ORIGINAL_HEIGHT` - eliminates downstream Get Image Size + Image Scale chains in most workflows.

### ↔️ Image Resize Pixaroma
Resize any image (and its mask) anywhere in your workflow with one compact node. Pick a mode - **Off**, **Max megapixels**, **Longest side**, **Scale by ×**, **Fit inside**, **Crop to fill**, **Match aspect ratio**, or **Pad** (add a colored border for outpainting / inpainting, where the new area becomes the editable mask region). **Crop to fill** has a 9-point **anchor** (keep the top, a corner, the center…) and a **Fill / Crop** toggle (scale-and-crop, or cut a piece at original pixels). A live **Input → Output** card with tiny aspect-ratio rectangles shows exactly what you'll get, and turns orange only when the size actually changes. Wire a **width / height** in (e.g. from Resolution Pixaroma): connect just one to scale while keeping the aspect ratio, or both for an exact size, and the controls adapt automatically. **Snap to /8/16/32/64**, a **Resample picker** (Auto / Nearest / Bilinear / Bicubic / Lanczos), and an **Allow upscaling** toggle apply on top; number fields take math like `1024+64`. Outputs `IMAGE`, `MASK`, `WIDTH`, `HEIGHT`.

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

### 💧 Text Watermark Pixaroma
A no-editor sibling of Text Overlay built for stamping a watermark onto an image (or a whole batch). Pick a corner, edge, or center on a 3x3 grid plus a small margin, and the text lands in the same spot on every image regardless of size. Size the text as fixed pixels or as a percentage of the image width (so mixed-size batches stay consistent), with the same font / weight / color / opacity / rotation / background bar controls as Text Overlay. No fullscreen editor - everything's on the node body. Use it when you want a watermark, a date stamp, or a corner caption applied uniformly to many images.

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

### 🔁 Switch Source Pixaroma
Flip a whole pipeline (or any set of wires) between two sources with one click. Wire your **A** bank and **B** bank for as many rows as you need (works for any wire type: MODEL, CLIP, VAE, IMAGE, LATENT, STRING...), then toggle **A** or **B** to swap them all at once - no rewiring cables. Two common setups: swap a combined Load Checkpoint against three separate model/CLIP/VAE loaders, or flip a "local" pipeline against an "api" one without ticking ten little switches. Output labels are editable per row, and you can pick whether empty rows leave the output blank or show a clear error.

### 🔇 Mute Switch Pixaroma
Skip whole parts of a workflow with one click. Wire the last node of each "scene" (usually a KSampler) into a row, then use the small switches to pick what runs and what doesn't. Two pills at the top: **Single** (only one scene runs at a time, like a radio button) or **Multi** (any combination), and **Mute** (the scene doesn't run) or **Bypass** (each node passes its input through unchanged). Chain Mute Switches together to group scenes: an outer Mute Switch can pick a group, and inner Mute Switches fine-tune which scenes inside that group run. Right-click for **Enable all rows** / **Disable all rows** to flip every row at once in Multi mode. Labels on rows are editable so you can name your scenes.

### 🔢 Number Pixaroma
A small node with one number field and two outputs: **int** and **float**. Useful when one downstream node wants a whole number and another wants a decimal from the same value, or when you want to convert a decimal into a whole number cleanly in the middle of a workflow. Accepts whole numbers, decimals, and math expressions like `1024+64` or `1024/3`. The int output rounds to the nearest whole number (`3.5` becomes `4`, `3.4` becomes `3`). Range is roughly plus or minus 1 quadrillion, so even very large numbers fit.

### ✍️ Text Pixaroma
A multi-line text field with a STRING output. Write your prompt (or any other long text) once and wire the output into multiple downstream nodes - positive prompt, negative prompt, captions, instructions, anywhere a string is needed. The field grows when you drag the node bigger, so you have plenty of room for long prompts. The text saves with your workflow.

### 🧱 Prompt Stack Pixaroma
A single node that holds an ordered stack of prompt chunks you can mute or include with one click. Add as many rows as you want, type a different piece of your prompt in each (style words, subject, lighting, quality boosters, anything), give each row a short label so you remember what it does, and toggle the orange **ON / OFF** pill to include or skip that row at run time. All the ON rows get joined into one text output with whatever separator you pick in **Settings → 👑 Pixaroma → Prompt Stack** (default comma+space, also works as newline, space, pipe, or anything you type). Drag the handle on the left of any row to reorder them, and the join order updates too. Rows that grow to many lines scroll on their own. The node tidies itself as you add and delete rows so it always fits its content with a bit of breathing room. Everything saves with your workflow. Great for testing prompt variants by clicking toggles instead of editing text.

### 🎲 Prompt Multi Pixaroma
The sibling of Prompt Stack: instead of joining your rows into one text output, it **runs the workflow once for each enabled row**. Type two or more prompt variants, give each a short label (e.g. "v1", "blue version"), and hit Run - you get one image per enabled prompt, sequentially, each as its own item in the ComfyUI queue panel so you can cancel any of them individually. Toggle the orange **ON / OFF** pill to skip a row without deleting it. Drag the handle on the left to reorder. Each generated image carries only the prompt that produced it, so dropping the PNG back into **Prompt Reader Pixaroma** correctly recovers that exact variant. Great for batch-comparing prompt ideas with a single click instead of editing text and re-running by hand. Also has a **List Prompts** mode (pill toggle at top) that ships the whole list out a `prompts` output for downstream **Prompt From List Pixaroma** nodes to pick from.

### 🎯 Prompt From List Pixaroma
A tiny picker that pairs with **Prompt Multi Pixaroma** in List Prompts mode. Wire Prompt Multi's `prompts` output into this node's input, set a 1-based **index**, and you get back the prompt at that position. Drop multiple From List nodes to fan one prompt library out to different places - for example, use index 1 in scene A, index 2 in scene B. Out-of-range index returns an empty string instead of erroring, so a workflow with a mistyped index still runs.

### 📦 Prompt Pack Pixaroma
Paste a block of prompts and queue **one workflow run per prompt** - no per-row buttons to toggle. A small pill at the top picks how the block splits: **Paragraph** (blank-line splits, for multi-line prompts) or **Line** (newline splits, for short one-line prompts). A counter pill shows total / active prompts so you know how many runs you're about to queue. Each generated image carries its own prompt (recoverable via Prompt Reader). Use it when you already have a long list of prompts in a text file or document and want to batch-run them all without typing each into its own field.

### 🔤 Find and Replace Pixaroma
Drop this node into a wire between a text source (an LLM node, Show Text, Text Pixaroma, any text output) and whatever uses the text. It catches the text on the way through, swaps out the words you tell it to, and passes the edited version on - the original source stays untouched. Add one rule per change: type what to find and what to put in its place, or leave the replace box empty to just delete the found text. Stack as many rules as you want and drag them to reorder (they apply top to bottom); toggle any rule off to skip it without losing it. Four switches at the top fine-tune the matching: **Case** (match capital letters exactly), **Whole word** (so "art" doesn't get caught inside "artist"), **Regex** (advanced pattern matching), and **Tidy** (cleans up double spaces and stray commas left behind by your edits). The node shows a live before-and-after right on its body so you can see exactly what changed, and that preview saves with your workflow - handy when you want to share an example where the prompt gets rewritten and have it visible the moment someone opens it. A **Reset** button clears everything in one click.

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
git clone https://gitlab.com/pixaroma/comfyui-pixaroma.git
```

> **⚠️ Node looks blank or broken right after updating?** This is almost always your browser cache, not a bug. Hard-refresh with **Ctrl + Shift + R** (Windows / Linux) or **Cmd + Shift + R** (Mac). If a node is still broken after that, see [Read this first](https://gitlab.com/pixaroma/comfyui-pixaroma/-/issues/2).

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

### **June 10, 2026 · v1.3.84**
- **Text Pixaroma no longer removes curly braces.** Curly braces { } were quietly being stripped out of your text when you ran the workflow, which broke JSON prompts and anything else that needs braces. They now stay exactly as you typed them.
- **NEW: a Dynamic prompts switch on the Text node.** That brace-stripping was actually a "pick one at random" feature in disguise - so it's now an opt-in switch, off by default. Turn it on and {red|blue|green} picks one option at random each run (you can nest them, and notes after // or inside /* */ get removed); leave it off and every brace stays put.
- **NEW: a Help button on the Text node.** Click the ? next to the Dynamic prompts switch for a panel that explains the text box, the buttons, and the switch - with a simple table showing what your text looks like with the switch on versus off.

### **June 9, 2026 · v1.3.82-1.3.83**
- **Load Image Pixaroma keeps a steady size.** Loading images of different shapes (square, tall, wide) no longer makes the node resize itself and shove your other nodes around - it stays put and fits the image inside, like the standard Load Image. In the new node interface the preview now fills the node properly instead of leaving an empty gap below it.
- **Finished the GitLab move.** The bundled sample workflow's buttons now point to GitLab too - they were the last spot still linking to the old GitHub home. The nodes themselves are unchanged.
- **Quicker fix for "a node looks broken after updating".** The README now flags up front that this is almost always a browser cache, with the 30-second hard-refresh fix, so it is faster to sort out.

### **June 8, 2026 · v1.3.79-1.3.81**
- **XY Plot: whole-number settings stay whole.** Width, height and steps now come out as round numbers - a range from 512 to 1024 gives proper values instead of odd decimals (no more 682.66).
- **XY Plot: new Snap toggle for sizes.** Each number axis gets a Snap toggle (next to Range/List) that rounds width/height to clean step multiples, so a range gives tidy sizes like 512, 688, 848, 1024. It's on by default; switch it off for exact values.
- **XY Plot: added a Help button.** Click the **?** at the top of the node (next to Reset X) for a panel that explains what the node does, how to use it, how the value box works, and what every option means - the same kind of in-node help that Find and Replace has.
- **XY Plot: decimal values stick now.** Typing a value like 7.1 (or 0.05) for a setting such as cfg or denoise now keeps the decimal instead of rounding it off to a whole number. Works for both the comma list and the Start/End/Steps range.
- **XY Plot: reset each axis on its own.** Each axis now has its own button (Reset X and Reset Y) so you can clear just one without touching the other. The button at the bottom (Reset XY) still clears everything at once.
- **XY Plot: buttons no longer spill out when the node is narrow.** In the new node interface, making the node smaller now lets the Lock seed / Draw labels / Save cells row wrap to fit inside the node instead of hanging off the edges.

### **June 7, 2026 · v1.3.78**
- **Project moved to GitLab.** The repository and the in-app and README links (the Help footers and the background-removal help link) now point to the new home at gitlab.com/pixaroma/comfyui-pixaroma. The nodes themselves are unchanged.

### **June 3, 2026 · v1.3.73–1.3.77**
- **NEW: a Help button on Find and Replace.** Click the **?** in the top corner of the node to open a clear panel that explains what the node does, how to use it, what each switch means, and a regex cheat-sheet with worked examples - so you can learn it without leaving ComfyUI. (This is the first node to get it; more will follow.)
- **Find and Replace: a tricky pattern can no longer freeze things.** If you turn on Regex and type a pattern that could lock up the browser or the run, the node now spots it, skips that one rule, and shows a short warning instead of hanging - and the live preview stays smooth while you type. Everyday patterns are unaffected.
- **Fixed: Find and Replace, Prompt Stack, Prompt Pack, Prompt Multi and XY Plot now work inside subgraphs.** When any of these was tucked inside a subgraph (a packaged group of nodes), it quietly did nothing - your rules or prompts were ignored. They now apply correctly there, exactly like on the main canvas.
- **Find and Replace: the live before-and-after now matches the real result.** When a rule adds a new line or a tab, matches a whole word with accents (like "café"), or uses an advanced replacement, the preview on the node now shows exactly what you'll get when you run.
- **NEW: Find and Replace Pixaroma.** Sit this node in a wire between a text source and whatever uses the text, and it swaps out words on the way through - great for fixing or tweaking a prompt without touching the original. Type what to find and what to replace it with, stack as many rules as you like, and drag to reorder them (they apply top to bottom). Toggle any rule off to skip it without deleting it. Switches at the top let you match capital letters exactly, match whole words only (so "art" doesn't get caught inside "artist"), use advanced pattern matching, or tidy up double spaces and stray commas left behind by your edits. The node shows a live before-and-after right on it, and that preview saves with your workflow - so a shared example shows the rewrite the moment someone opens it. A **Reset** button clears everything in one click.
- **NEW: XY Plot Pixaroma.** Compare settings side by side without setting anything up. Drop it at the end of your workflow and wire your image in like a preview node, then pick what changes **across** (columns) and **down** (rows) from a dropdown of the nodes already in your graph - no rewiring. The value box adapts to what you pick: a number gives a Start/End/Steps range, a dropdown (sampler, model, scheduler) gives a checklist, and your prompt gives find-and-replace. Hit Run once and every combination fills a labeled grid right in the node, with Dark/Light/Mono grid themes and Save/Copy/Open buttons. The seed stays locked across the grid so the only thing changing is the thing you're testing.
- **Sharper previews when you zoom in.** The image in **Preview Image** and **Load Image** now stays crisp when you zoom into a node, instead of going blurry or pixelated (the same fix Image Compare got last update).
- **Preview Image always shows the latest result.** Fixed a case where running the workflow again could leave the old image on the node instead of updating to the new one.

### **June 2, 2026 · v1.3.72**
- **NEW: Pause Image Pixaroma.** Drop it into your workflow to pause and preview the image before running the slow part (like an upscale or a second pass). Press Run and it stops there and shows you the image; the rest of the workflow waits. Happy with it? Hit **Continue** and only the steps after it run - the heavy generation is skipped, so it's fast and you upscale the exact image you saw. Not happy? Hit **Regenerate** for a new one, or change something upstream and run again. Flip the toggle to **Pass** to run everything in one go. You can **Copy**, **Save to disk**, **Save to output**, or **Open** the previewed image right from the node.
- **Image Compare: sharper preview + save buttons.** The compared image now stays crisp when you zoom into the node. Added **Save to disk** and **Save to output** buttons (next to Copy) that save whichever image you're currently showing.
- **Image Crop now appears when you drag an image wire.** Before, you could only find it by double-clicking the canvas; now it shows up in the search when you drag a wire out of any image output.
- **Align: nodes no longer jump or move the wrong node when you resize.** With Align on in the new node interface, resizing a node no longer makes it jump, and resizing one node no longer drags a different selected node along with it.

### **June 1, 2026 · v1.3.70–1.3.71**
- **Every Pixaroma node now works in ComfyUI's new "Nodes 2.0" interface.** The last few were finished off: **Mute Switch** (the on/off scene switcher now shows its mode pills and per-row switches in the new interface), **Image Resize** (its INPUT→OUTPUT size cards and live readout), and **Label** (the floating text label — the trickiest one, since it has no title bar and sizes itself to your text; placing, dragging, double-click-to-edit, and a snug box around the text all work now). All of these display and behave correctly in both the classic and the new interface.
- **The snap & alignment guides now work in Nodes 2.0 too.** Turn on Align (the orange button up by the gear icon, or Settings → 👑 Pixaroma → Align) and drag a node near another: the orange guide lines appear and the node snaps into alignment, the same as in the classic interface. Before, nothing happened in the new interface.
- **The node color picker is redesigned — and now works in Nodes 2.0.** Right-click any node (or a group) and pick **👑 Pixaroma Node Colors**: a palette pops out *beside* the node so you can watch it recolor live as you click. Choose from a full grid of swatches (15 shades for every color, plus 45 group colors), save up to 8 favorites, drag the panel out of the way, or open a custom two-color picker. Resetting a node's color also works correctly in the new interface now.
- **Connection effects now work in Nodes 2.0.** With Connection FX on (Settings → 👑 Pixaroma → Connections), dragging a wire lights up the matching inputs near your cursor with a glow and little particles flowing between your wire and the slot, plus a spark burst when it connects — just like in the classic interface. With this, the whole Pixaroma suite is fully at home in the new interface.

### **May 29, 2026 · v1.3.67-1.3.69**
- **Most Pixaroma nodes now work in ComfyUI's new "Nodes 2.0" interface, not just the classic one.** ComfyUI has been building a modern node interface (you can turn it on in Settings → Rendering), and it's slowly becoming the default. Before, many Pixaroma nodes showed up blank or broken when Nodes 2.0 was on. Now these all display and work correctly in both the classic and the new interface: Show Text, Text, Resolution, Prompt Reader, Switch WH, Prompt Stack, Text Watermark, Text Overlay, Note, Image Crop, Paint, 3D Builder, Image Composer, AudioReact, Save Mp4, Prompt Pack and Prompt Multi (the Paragraph/Line and Queue/List toggles on the last two moved from the node's top edge to the top of the box so they show up in the new interface).
- **Preview Image, Load Image and Image Compare now work in Nodes 2.0 too.** These three draw their own buttons and previews on the node, so they needed a full rebuild. Image Compare's side-by-side slider, overlap, difference, opacity, Copy and hover-to-slide all work in both interfaces; Load Image and Preview Image keep their previews and controls; and all three remember their size when you save and reopen a workflow.
- **NEW: Version Check Pixaroma.** A small panel you can drop on the canvas that shows your ComfyUI version, frontend version, which node interface is active (Nodes 2.0 or Classic), and your Pixaroma version. A **Copy** button copies all four lines as text so you can paste them straight into a bug report, a **Refresh** button reloads the page, and clicking the interface row switches between Nodes 2.0 and Classic without opening Settings.
- **Switch and Switch Source now work in Nodes 2.0 too.** Their controls only showed in the Classic interface before. Now in the new interface, Switch Source shows its Rows / A-B / "when empty" controls, and Switch lists one row per input below the dots - each input is numbered, shows what's plugged in (text, image, etc.), and has an on/off switch to pick which input is passed through. Click an input's box to give it a custom name.
- **Still in progress:** Mute Switch is the last node still being adapted to the new interface, so for now it works best in the Classic one. The Version Check node shows you at a glance which interface you're in.

### **May 28, 2026 · v1.3.62-1.3.66**
- **Preview Image: saved images now appear in the Media Assets panel.** With the node's save mode set to "save", your image shows up in the Assets panel the moment the workflow finishes, exactly like the native Save Image node. Before, the file landed in your output folder but the panel stayed empty until you manually reloaded. The thumbnail on the node itself stays clean (no duplicate preview), and the asset card no longer shows a confusing stack-count badge for single saves. Thanks @Dean-Corso for the bug report and video that nailed down the cause.
- **Preview Image: option to keep filenames clean on Save to Disk.** In Settings → 👑 Pixaroma → Preview (disk save), turn on **Save Disk: omit counter from filename** and the Save dialog will pre-fill `myimage.png` instead of `myimage_00001_.png` - no more deleting the padding by hand. Your computer will still warn before overwriting an existing file. Save to Output is unchanged: it always keeps the counter so a re-run can't silently overwrite the previous file.
- **Mute Switch: right-click to flip every row at once.** Right-click any Mute Switch and pick **Enable all rows** or **Disable all rows** to turn every wired row on (or off) in one click. Both options stay greyed out in Single mode (since only one row can be on at a time there). Per-row toggles still work the same - this is just a shortcut for "give me everything" or "skip everything" without clicking each row.
- **NEW: Mute Switch Pixaroma.** Skip whole parts of a workflow with one click. Wire the last node of each "scene" (usually a KSampler) into a row, then use the small switches to pick what runs and what does not. Two pills at the top: Single (only one scene runs at a time, like a radio button) or Multi (any combination), and Mute (the scene does not run) or Bypass (each node passes its input through unchanged). Chain Mute Switches together to group scenes: an outer Mute Switch can pick a group, and inner Mute Switches fine-tune which scenes inside that group run. Labels on rows are editable so you can name your scenes.
- **Tooltips on Mute Switch, Prompt Pack and Prompt Multi now match the standard Windows / Mac look** (white background, dark text, sharp corners) so they read the same way as the tooltips on regular buttons.
- **NEW: Switch Source Pixaroma.** Flip a whole pipeline (or any set of wires) between two sources with one click. Wire your A bank and B bank for as many rows as you need (works for any wire type: MODEL, CLIP, VAE, IMAGE, LATENT, STRING…), then toggle A/B to swap them all at once. Two common setups: swap a combined Load Checkpoint against three separate model/CLIP/VAE loaders, or flip a "local" pipeline against an "api" one without ticking ten little switches. Output labels are editable per row, and you can pick whether empty rows leave the output blank or show a clear error.
- **Prompt Reader sees through Switch Source.** Drop a saved image whose workflow ran through a Switch Source and the prompt comes back correctly, instead of "no prompt found".

### **May 27, 2026 · v1.3.59-1.3.61**
- **Fixed: Prompt Multi / Prompt Pack no longer make too many images when wired into one Switch together.** With several prompt nodes feeding a single Switch, clicking Run now makes exactly the prompts from the one the Switch is pointing at (for example 3, not 9) - the others sit out instead of multiplying.
- **NEW: Text Watermark node.** Stamp text onto an image or a whole batch in a fixed spot - pick a corner / edge / center on a 3×3 grid plus a margin, and it lands in the same place on every image no matter its size. Set the size in pixels or as a percentage of the image width (so mixed-size batches stay consistent), with font, color, opacity, rotation and an optional background bar. No separate editor to open.
- **NEW: use your own fonts.** Drop `.ttf`/`.otf` files into `ComfyUI/models/fonts/` and they show up in the font picker for Text Overlay and Image Composer text - with a search box and a "Custom" group to find them fast.
- **Undo inside an editor stays inside that editor.** In Paint, 3D Builder, Image Crop, Image Composer, Note, AudioReact and Text Overlay, pressing **Ctrl+Z** now only undoes your edits in the open editor - it can no longer accidentally delete the node or revert the rest of your workflow behind it.
- **3D Builder:** undoing the last object now also clears its shadow, and opening/closing the editor repeatedly no longer slows the viewport down over time.
- **Text Overlay:** the red ✕ Close button now discards the changes you made that session (use Save to keep them).
- Plus smaller touches: many Image Composer reliability fixes (erasing + undo, color-grade layers, saving and reloading), crisper text when resizing a text layer, and editor cleanups.

### **May 26, 2026 · v1.3.58**
- **Fixed: Load Image keeps the original filename after you draw a mask.** Adding a mask in the Mask Editor no longer switches the node's Filename output to a temporary name - it stays the name of the image you loaded.

### **May 25, 2026 · v1.3.56**
- **NEW: node colors organized by color.** Right-click a node → **👑 Pixaroma Node Colors** and pick a color (Red, Orange, Gold … Pink); open one to see its shades from deep to bright. A new **Dark** folder holds the standard Pixaroma dark plus a few neutral and softly-tinted dark options.
- **Fixed: masks work again on Load Image.** Drawing a mask in the Mask Editor and saving now produces the mask from the node.
- **Fixed: Load Image loads the right picture after Copy/Paste (Clipspace)** - pasting a copied image now loads that image, not the previous one.
- **Fixed: Number and WH nodes keep their size when you switch workflows** (the title no longer gets cut off).

### **May 22, 2026 · v1.3.53-1.3.55**
- **NEW: color your groups, not just nodes.** Right-click a group (the labelled box around nodes) and pick from a set of ready-made colors, or open the custom picker for any shade - a quick way to organize a busy workflow at a glance.
- **Copy a color and paste it anywhere.** Grab the color from any node or group and paste it onto others - even from a node onto a group - so you can match an existing workflow's color scheme in a couple of clicks.
- **Save your favorite colors.** Keep up to four colors you use often and apply them in one click from the right-click menu; they're remembered between sessions.
- Plus smaller touches: the right-click color menu now puts your favorites on top, and each entry clearly says whether it changes the node or the group.
- **NEW: crop a single layer in Image Composer.** Press **C** (or the new Crop button) to trim just one layer - for example keep one pose from a character sheet - without resizing the canvas or affecting the other layers. It's non-destructive: drag the box and corner handles (with a rule-of-thirds guide) to frame it, press **C** again to apply, and re-open any time to adjust or bring the full image back.
- **Text: random options and notes in your prompt.** Write `{day|night}` and one is picked at random each time you run - great for variations. Lines with `//` or blocks wrapped in `/* ... */` are treated as notes and left out of the prompt. Keep literal braces with `\{` and `\}`.
- **Switch now runs only the input you picked.** Before, it quietly processed every connected input even though only the chosen one was used, wasting time; now only the selected branch runs.
- **Preview Image: Save to Disk / Save to Output recreate the same picture.** Dragging a saved image back into ComfyUI and running it now reproduces that exact image (previously these buttons saved the next random seed, so you'd get a different one). A clearer message also appears when a preview's temporary file is gone after a restart.
- **Eraser keeps erasing when you sweep off the canvas and back** in Image Composer, instead of stopping mid-stroke.
- **Load Image: find and pick images by thumbnail.** Open the file list and you now see a thumbnail of every image, a search box to filter by name, and a folder sidebar to jump between subfolders - so you can recognise the image you want at a glance instead of reading file names. A small toggle switches between small and large thumbnails and remembers your choice.
- **Fixed: running a single node no longer starts the whole workflow.** Pressing a node's own run button (Execute) again runs just that node and what it needs, instead of kicking off the entire workflow.

### **May 21, 2026 · v1.3.51-1.3.52**
- **NEW: Image Resize Pixaroma.** Resize an image (and its mask) anywhere in your workflow with one compact node. Choose **Off**, **Max megapixels**, **Longest side**, **Scale by**, **Fit inside**, **Crop to fill**, **Match aspect ratio**, or **Pad** - which adds a border for outpainting and marks the new area as the mask to fill. **Crop to fill** lets you pick which part of the image to keep (the top, a corner, the center…) and whether to scale-and-crop or cut a piece at its original size. A live **Input → Output** preview shows the exact result and lights up only when the size actually changes. Wire a **width or height** in (for example from Resolution Pixaroma): connect just one to scale while keeping the shape, or both for an exact size - the node adapts on its own.
- **Image Resize: wire in a single "longest side" value.** Connect one number and the node scales the longer edge of your image to that size, keeping the shape, so you no longer have to decide between width and height. It also gained a matching **longest side** output. Wired sizes now follow the **Upscaling** toggle, and a value of 0 simply passes the image through untouched.

---

**Home:** ComfyUI-Pixaroma is developed on [GitLab](https://gitlab.com/pixaroma/comfyui-pixaroma). That is the place for the latest code and to report issues. Any copy hosted elsewhere (such as a GitHub mirror) is a backup.

ComfyUI-Pixaroma is an independent, community-made extension. It is not affiliated with, endorsed by, or sponsored by Comfy Org or the ComfyUI project. Product names, logos, and trademarks are the property of their respective owners.
- **Press Ctrl+Enter to run while typing.** Text, Prompt Pack, Prompt Multi, and Prompt Stack fields no longer swallow the Run shortcut.
- **Every node now explains itself.** Hover any control for a quick tip, and the side Info panel describes what each input and output does.
- **Nodes remember their settings on reload.** Switch, Image Resize, and Crop no longer reset their choices when you reopen a workflow or switch tabs.
- **Title cards hug their text** instead of stretching into a wide empty box.

### **May 20, 2026 · v1.3.48-1.3.50**
- **Text Overlay: move the whole caption in one click.** A new **Position on canvas** row on the node body snaps the text to any edge or the center of the image. The left/center/right buttons are now clearly labelled **Text align** (they line up multiple lines inside the text block).
- **Prompt Pack & Prompt Multi no longer block a Run when they're not in use.** A leftover prompt node sitting on the canvas (unwired or muted) used to stop every workflow with a "paste a prompt" warning. Now it only speaks up when it's actually wired into the run.
- **Fixed: opening and closing a workflow no longer falsely asks to "Save Changes?".** Text Overlay, Prompt Stack, Prompt Multi, Switch, and Label title cards were marking a workflow as edited just by being opened. (Re-save an affected workflow once to clear it for good.)
- **Fixed: drag the ⋮⋮ handle to reorder rows** in Prompt Stack and Prompt Multi - it now works.
- **Fixed: the fullscreen editors can no longer freeze the UI.** Closing a workflow while a Text Overlay / Note / AudioReact editor was open could leave you unable to open or create workflows until a refresh; it now recovers on its own.
- **Fixed: Connection FX no longer sparkles every wire when you open a workflow.** The sparkle now fires only when you connect two nodes yourself, not when a saved workflow loads all its wires.
- **Fixed: the Paragraph/Line tip on Prompt Pack (and Queue/List on Prompt Multi) no longer stays stuck on screen** after you move your mouse off the buttons into the text box.

### **May 19, 2026 · v1.3.40-1.3.47**
- **NEW: Run Button FX & Connection FX.** Optional flair in Settings: 8 styles for the Run button (flames, lightning, sparkles, shockwave…) and a magnetic glow with particles while you drag a wire to a slot. Both off by default.
- **NEW: One-click node colors.** Right-click any node → **👑 Pixaroma colors** for 33 ready-made themes, plus a saved Favorite and a custom picker. Works on several selected nodes at once, and the colors travel with the workflow when you share it.
- **Text & prompt nodes share one clean look.** Matching textareas, buttons, and spacing that blend with any node color. Text Pixaroma gained **Copy all / Replace / Clear** buttons, and the mode pills on Prompt Pack/Multi moved to the top with hover tips.
- **Load Image & Prompt Reader: easier browsing.** ◀ ▶ arrows (and PageUp/Down) flip through your images, input subfolders show as labelled groups, and the layout is tighter.
- **Align lines up with Labels & Notes**, and those two no longer show a timing badge after a Run.
- **Works again on older ComfyUI installs** (a recent update could hide the whole Pixaroma menu).
- Plus smaller touches: Image Compare one-click Copy, a default save-mode setting for Preview Image, and fixes for drag-selecting text in prompt rows, layer renaming, and minimum node sizes.

### **May 18, 2026 · v1.3.37-1.3.39**
- **NEW: Text Overlay Pixaroma.** Add a styled caption to any image: 10 fonts, bold/italic, alignment, size, rotation, color, and an optional background bar. Open the fullscreen editor to drag, scale, and rotate the text with snap guides, then Save to Disk.
- **NEW: Prompt Pack Pixaroma.** Paste a block of prompts and the node runs your workflow once per prompt (split by blank line or by line), with a live countdown.
- **NEW: Prompt From List Pixaroma + Prompt Multi "List mode".** Send different prompts to different parts of a single workflow.

### **May 17, 2026 · v1.3.32-1.3.35**
- **NEW: Prompt Stack Pixaroma.** Stack prompt chunks in labelled rows, toggle each on/off, drag to reorder, and join them into one prompt with your chosen separator.
- **AI Background Removal: built-in model dropdown.** Three BiRefNet quality levels right on the node (drop `.safetensors` into `ComfyUI/models/background_removal/`). Now works on 4-6 GB cards (auto-retries smaller, falls back to CPU if needed), and the Composer/Paint editors use the same models.

### **May 15, 2026 · v1.3.28-1.3.31**
- **NEW: Switch Pixaroma.** A universal one-click switch for any data type (models, images, prompts, masks, audio…). It grows its inputs as you wire more (up to 32) and only one is active at a time.
- **NEW: Remove Background Pixaroma.** One node that outputs the cutout, the mask, and the inverted mask together - replacing the usual three-node chain.
- **Show Text: one-click Copy button.** Prompt Reader now also reads prompts routed through a Switch.

### **May 13, 2026 · v1.3.24-1.3.27**
- **NEW: Prompt Reader Pixaroma.** Drop a generated PNG on it to instantly read the prompt saved inside (works with ComfyUI, A1111, Forge), with a Copy button and a text output.
- **Load Image: cleaner resize math.** Picking "1 MP" keeps 1024×1024 (SD/SDXL/Flux-friendly); presets map to 512² / 1024² / 2048², and the on-canvas readout matches the real output.
- **AudioReact handles long audio** without crashing, with a live memory indicator. **Preview Image:** wired filenames always work and refresh after you delete a saved file.

### **May 12, 2026 · v1.3.21-1.3.23**
- **NEW: Load Image Pixaroma.** A drop-in replacement for LoadImage with built-in resize controls (7 modes, aspect-ratio presets, snap-to-multiple, math in number fields) and 7 outputs, so you can skip downstream resize chains. A live readout shows the resulting size before you Run.
- **NEW: small utility nodes** - Text, Number (int + float), WH, and Switch WH.
- **Drag-and-drop images** onto Image Crop / Composer / Paint. **Preview Image:** new Copy & Open buttons, and Save buttons honor a wired filename.

### **May 10, 2026 · v1.3.18-1.3.20**
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

💡 **Have an idea for a new node or improvement?** Share it in our [Discord community](https://discord.gg/gggpkVgBf3).  
🐞 **Found a bug or something broken?** Open an [Issue](https://gitlab.com/pixaroma/comfyui-pixaroma/-/issues).  
💬 **[Join our Discord Community](https://discord.gg/gggpkVgBf3)**  
⚖️ **Licensed under [MIT](LICENSE)**
