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

> 💬 **Need help, have an idea, or found a bug?** Post in the **#pixaroma-nodes** channel on the [Pixaroma Discord](https://discord.gg/gggpkVgBf3), or open a work item (issue) on [GitLab](https://gitlab.com/pixaroma/comfyui-pixaroma/-/issues).

> 💡 **Updated Pixaroma and a node looks broken or old?** Hard-refresh your ComfyUI browser tab with **Ctrl+Shift+R** (**Cmd+Shift+R** on Mac). The browser caches old node visuals, so without a hard refresh you can still see the previous version even though the update installed correctly.

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
Compare settings side by side without setting anything up. Drop it at the end of your workflow and wire your final image in, just like a preview node. Then pick what changes **across** (columns) and **down** (rows) from a dropdown of the nodes already in your graph - no extra wiring. The value box adapts to your pick: a number gives a Start/End/Steps range, a dropdown (sampler, model, scheduler) gives a checklist, a lora lets you compare loras or their strengths (works with the Power Lora Loader too), and your prompt gives find-and-replace. Hit Run once and every combination fills a labeled grid right in the node, with **Dark/Light/Mono** grid themes and **Save/Copy/Open** buttons. The seed stays **locked** across the grid so the only thing changing is the thing you're testing.

### 🎛️ LoRA Loader Pixaroma
Stack as many LoRAs as you want in one compact node, each on its own line with an on/off switch and a strength you type or nudge with arrows - and chain the model and clip through several of them. Click the **i** on any LoRA to see its details and trigger words, read straight from the file with no internet needed; tick the ones you want (or type your own) and they come out of a **triggers** output as plain text for your prompt. A searchable, browse-by-folder picker makes finding a LoRA quick, and an optional **Civitai** lookup fills in official trigger words and a preview when you ask, with a link to the model's page. **Add LoRA**, all on/off and the settings tuck into the middle of the node to keep it small; right-click a row to move, duplicate or remove it.

### 🔗 Text Join Pixaroma
Join a few pieces of text into one, each on its own line - and every line is **type-or-wire**: type straight in, or drag a wire from another node to feed it, so fixed text and text from elsewhere mix freely. Comes in **Two**, **Three** and **Four** line versions, and the lines **grow** as you enlarge the node so long text has room. Right-click for the settings: choose what goes **between** the pieces (comma, space, new line, none, or your own), **skip empty** lines so you never get a stray comma, and - the handy part - **rename each line** to whatever fits your workflow (trigger words, prompt, camera, lighting) so the node reads the way you think. A per-line copy and paste sits on each box, and it works in both the classic and the new node interface.

### ✂️ Image Crop
No more guessing crop sizes with numbers! Visually draw your crop box, or set width, height, position and a center/edge alignment right on the node - math expressions like `1024+512` work too. Standard presets (1:1, 16:9, 9:16…) keep social and video aspects locked. Wire **any IMAGE** output into the node (Load Image, VAE Decode, anything) and run the workflow once - the editor and mini-preview will show the live source. Or paste an image straight from the clipboard with **Ctrl+V**. It keeps **transparency** too (wire a mask in, get a matching cropped mask out) and hands off a **crop_info** wire to the new **Image Uncrop** node, so you can edit the crop and paste it back later.

📥 [Download example workflow](workflows/Crop%20Pixaroma%20Workflow.json)

![Image Crop Node](workflows/Crop%20Pixaroma%20Workflow.jpg?v=3)
![Image Crop Editor](workflows/Crop%20Pixaroma%20Workflow%20v2.jpg?v=2)

### 🧩 Image Uncrop
The other half of crop-and-edit: paste an edited or upscaled crop **back** onto the original image at the exact spot it came from. Wire the **crop_info** from Image Crop into it, run your crop through any nodes you like (upscale, recolor, inpaint, remove background), and Image Uncrop drops the result back in place - everything outside the crop stays untouched. A **feather** slider softens the seam for a seamless blend, and transparency carries straight through.

### 🩹 Inpaint Crop Pixaroma
The easy way to set up an inpaint. Open the fullscreen editor and **paint** over the part you want the AI to redo - brush, erase, invert, an adjustable brush, and **zoom** (scroll) + **pan** (Space-drag) for fine detail. The node automatically finds the area around your mask, adds a margin, and crops a clean, **model-friendly** piece (sized to a multiple of 8 and scaled toward your target) so even a small spot gets enough resolution to look sharp. Set how the result blends back - **softness**, mask grow, and **Mask** (only the painted area) vs **Whole crop** - right here, with a live preview. Wire the cropped **image** and **mask** into your inpaint or edit model (Flux, KSampler, edit models), then send the **crop_info** wire to Inpaint Stitch to paste the result back. Turn on **invert_mask** to inpaint the opposite area (no separate Invert Mask node), and it works with a mask wired in too. Works in both the classic and the new node interface.

### 🪡 Inpaint Stitch Pixaroma
The other half: paste your inpainted crop **back** onto the original, blended so the seam disappears. Wire in the **crop_info** from Inpaint Crop and your processed crop, and by default only the area you painted changes - everything else stays pixel-perfect. Fine-tune the **softness**, **blend mode**, and an optional **color match** right on this node; because it runs after the sampler, changing them re-runs only this node (instant, no re-generating the image). It also hands back the untouched **original**, so you can drop both into Image Compare for an instant before / after.

### 🌓 Image Compare
The best way to see the difference between two images. Easily compare them side-by-side with a slider, overlap them, or highlight exactly what changed between the two versions.

📥 [Download example workflow](workflows/Image%20Compare%20Pixaroma%20Workflow.json)

![Image Compare Node](workflows/Image%20Compare%20Pixaroma%20Workflow.jpg?v=2)
![Image Compare Editor](workflows/Image%20Compare%20Pixaroma%20Workflow%20v2.jpg?v=2)

### ⏸️ Pause Image Pixaroma
A checkpoint you drop into your workflow to stop and look at the image before running the slow part (like an upscale or a second pass). Press Run and it pauses there, showing you the image while the rest of the workflow waits. Like what you see? Hit **Continue** and only the steps after it run - the heavy generation is skipped, so it's fast, and you upscale the exact image you saw. Don't like it? Hit **Regenerate** for a fresh one, or change something upstream and run again. Flip the toggle to **Pass** to run everything in one go. **Copy**, **Save to disk**, **Save to output**, and **Open** buttons act right on the previewed image. Works in both the classic and the new node interface.

### 🖼️ Load Image Pixaroma
A drop-in replacement for ComfyUI's native LoadImage with everything you'd want in one node. Same upload / drag-drop / Ctrl+V paste / multi-frame / alpha-to-mask behavior as native, plus inline resize: pick from **Off**, **Max megapixels**, **Longest side**, **Scale by ×**, **Fit inside**, **Crop to fill**, or **Match aspect ratio** with a sub-toggle for Crop or Pad (12 ratio presets + Custom, with a Pixaroma color picker for the Pad color). **Snap to /8/16/32/64**, **Resample picker** (Auto / Nearest / Bilinear / Bicubic / Lanczos with one-line hints under each), and an **Allow upscaling** toggle apply on top. Numeric fields accept math expressions (`1024+64`, `512*2`), ↑↓ arrow stepping (Shift = 10×), and have visible +/- spinner buttons. A live **Input → Output** info bar with tiny aspect-ratio rectangles shows you exactly what dimensions the workflow will produce as you tweak settings. Outputs include `IMAGE`, `MASK`, `WIDTH`, `HEIGHT`, `FILENAME` (no extension), `ORIGINAL_WIDTH`, `ORIGINAL_HEIGHT` - eliminates downstream Get Image Size + Image Scale chains in most workflows.

### 🪶 Load Image Mini Pixaroma
The compact version of Load Image, for when you want a small, uncluttered node on the canvas. Same engine and the same picking - **upload / drag-drop / Ctrl+V paste**, the ◀ ▶ arrows and thumbnail file picker, and full **Open in Mask Editor** / Copy-Paste (Clipspace) support - but the face is just a toolbar, the file picker and a preview. All the resize modes (**Max megapixels**, **Longest side**, **Scale by ×**, **Fit inside**, **Crop to fill**, **Match aspect ratio**) plus snap, resample and upscaling live in the gear settings panel, and you can recolour the node's buttons per node. It outputs just `IMAGE` and a small `image_info` bundle. Pair it with **Image Info Pixaroma** to unpack that bundle into `IMAGE`, `MASK`, `WIDTH`, `HEIGHT`, `FILENAME` - wire it in only when you need those extras, so the loader itself stays small (Image Info also shows the size and filename right on its own face). Works in both the classic and the new node interface.

### 📂 Load Images from Folder Pixaroma
Point it at any folder on your computer and batch-process its images through your workflow. Pick which ones in a thumbnail gallery (**Select all**, the **First N**, or hand-pick), then hit Run once and it feeds each selected image through your graph on its own, giving you a finished result for every image (mixed image sizes are fine). Set the folder with the real OS folder dialog (the **Browse** button, Windows / Mac / Linux) or just type or paste a path. It carries the same inline resize options as Load Image Pixaroma (**Max megapixels**, **Longest side**, **Scale by**, **Fit inside**, **Crop to fill**, **Match aspect ratio**, **Pad**), applied to each image as it loads. Outputs `IMAGE`, `MASK`, `WIDTH`, `HEIGHT`, `FILENAME`, `INDEX`, `TOTAL` - wire WIDTH/HEIGHT into an empty latent so it matches each image, and FILENAME into a Save node so every result keeps its original name. Works in both the classic and the new node interface.

### ↔️ Image Resize Pixaroma
Resize any image (and its mask) anywhere in your workflow with one compact node. Pick a mode - **Off**, **Max megapixels**, **Longest side**, **Scale by ×**, **Fit inside**, **Crop to fill**, **Match aspect ratio**, or **Pad** (add a colored border for outpainting / inpainting, where the new area becomes the editable mask region). **Crop to fill** has a 9-point **anchor** (keep the top, a corner, the center…) and a **Fill / Crop** toggle (scale-and-crop, or cut a piece at original pixels). A live **Input → Output** card with tiny aspect-ratio rectangles shows exactly what you'll get, and turns orange only when the size actually changes. Wire a **width / height** in (e.g. from Resolution Pixaroma): connect just one to scale while keeping the aspect ratio, or both for an exact size, and the controls adapt automatically. **Snap to /8/16/32/64**, a **Resample picker** (Auto / Nearest / Bilinear / Bicubic / Lanczos), and an **Allow upscaling** toggle apply on top; number fields take math like `1024+64`. Outputs `IMAGE`, `MASK`, `WIDTH`, `HEIGHT`.

### 🔲 Resize Crop Pixaroma
A dead-simple crop-to-fill node. Wire in an image, set a **width** and **height** (type them, or wire them in from another node like WH or Resolution Pixaroma), and it scales the image to completely fill that size and crops the overflow from the center - so the output is **always exactly** the size you asked for, with no stretching or black bars. Smaller images scale up to fill. An optional **mask** is cropped along with it. Outputs `IMAGE`, `MASK`, `WIDTH`, `HEIGHT`. Perfect for forcing images or video frames to a fixed size like 512×896 or 704×1280. Works in both the classic and the new node interface.

### 🖼️ Outpaint Pixaroma
Add a solid-colour border around your image so an outpainting model can paint new scenery into it - the setup step for extending a picture past its edges, in one node. **To ratio** grows the image to a target shape (1:1, 3:2, 16:9…) and an **Add space** row picks which side the new area goes on; **By side** adds an exact number of pixels per edge, or just **drag a green edge** right on the preview to pull the canvas out. A live **preview** shows the composition with the pad numbers on the fill and a size **badge**, and an **Input → Output** card shows the real dimensions (orange when they change). The fill is **neutral grey** by default - a strongly coloured fill can tint the whole result - but click the swatch to pick any colour. Optionally cap the result at a **megapixel limit** (choose your own buttons, or add a custom value) so it stays a sane size to generate, with an optional snap to a multiple of 8/16/32/64. Right-click or the gear opens settings to choose which ratio and megapixel buttons show and recolour the node; a small arrow folds it down to just the picture. Outputs `IMAGE`, `WIDTH`, `HEIGHT`. The outpainting itself is done by your model or LoRA, which needs its own trigger words in your prompt. Works in both the classic and the new node interface.

### ✂️ Outpaint Stitch Pixaroma
The companion to Outpaint Pixaroma. Once the model has filled in the new scenery, this puts your **original picture back at full quality** and keeps only the freshly generated area - because a large image usually has to be shrunk for the model, which softens the original half on the way through, and this brings it back sharp (only the new part, which had to be generated, stays soft). Wire the extra `outpaint_info` output from Outpaint Pixaroma into it and it drops the original back in exactly the right place and blends the join. **Feather** softens the seam, and **Color match** evens out any colour or brightness step where the old and new areas meet - it follows the background (so a light wall over a dark floor is handled per region, not as one flat colour) and evens out only the background tone, leaving any new subject the model added untouched. Both are sliders you can also wire a number into, and you can compare different Feather and Color match values side by side with XY Plot Pixaroma. Outputs the recombined `IMAGE` and a `MASK` of just the new area, so you can refine only that part later. Works in both the classic and the new node interface.

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

### 🎞️ Load Video Pixaroma
Bring a video into ComfyUI and turn it into frames. Upload one from your computer or pick from the dropdown, and it **plays right on the node** so you can check it before running (click the picture to play / pause). It hands you the **frames, the audio, and the details** (frame count, fps, width, height, length) all at once, so you rarely need a separate info node. Control how much to load: cap the number of frames for long clips, skip frames off the start, force a steady frame rate, or resize each frame (**crop-to-fill** an exact size with no stretching). Pairs with **Save Mp4** - send the frames and audio straight across to rebuild the video.

### 🎯 Load Video Frame Pixaroma
Grab one exact frame out of a video and use it as an image - like a Load Image node, but for video. Load a clip and a preview appears on the node with a slider: **drag** it to any spot, **step one frame** back or forward with the arrow buttons for a pinpoint pick, or **type** the exact frame number. It reads the frame count for you and shows where you are (**"frame 76 · 117 frames"**), then hands you the picked frame plus its mask and the video's frame count, fps, width and height. Perfect for pulling a still, a start frame, or a reference out of a video without exporting it in another program first. Works in both the classic and the new node interface.

### 🎬 Save Mp4 Pixaroma
Encode video frames + optional audio straight to MP4. Built-in `<video>` preview right on the node so you can watch the result without leaving ComfyUI (click the picture to play / pause). Pairs with AudioReact and Load Video, but works with any source that produces frames + AUDIO.

### 🔁 Loop Start / Loop End + Combine Pixaroma
Repeat a section of your workflow a set number of times. Put your nodes **between** Loop Start and Loop End, choose how many rounds, and the whole section runs again and again - perfect for building a long video in chunks or piling up a batch of images. Each round can **carry values forward** (the frames so far, a running counter), and the **Combine** node joins each round's result onto the growing pile (images into one batch, numbers into a list). Things that don't fit together (like an image and some text) stop with a clear, plain message instead of a confusing error. Works in both the classic and the new node interface.

### 💬 Show Text Pixaroma
See what text or data is flowing through your nodes, with a real read-only text box you can **select and copy** from. **Resize the node freely** in any direction; long text scrolls with a scrollbar instead of forcing the node to grow. New **STRING output** lets you chain it into other nodes (great for inspecting a prompt before passing it on). Saves and restores with your workflow.

### 🔍 Prompt Reader Pixaroma
Load any PNG that was generated with ComfyUI (or Automatic1111 / Forge) and read the **positive prompt** saved inside its metadata. No image preview - just the text. Drag-drop a file, click **Upload Image**, or pick from the file combo; the prompt appears the moment you choose a file, so you see it before running. One orange **Copy** button puts the prompt on your clipboard. The **STRING output** wires straight into CLIPTextEncode (or any text input) so you can re-use the prompt without retyping. Handles complex workflows with chained text nodes (ConditioningCombine, StringConcatenate, SDXL dual-text encoders). If the image has no prompt (JPG, screenshot, or a PNG whose metadata was stripped), you get a short clear message instead of a silent fail.

### 🖼️ Preview Image Pixaroma
A handy way to preview your images right on the node, but better! Works with **single images and full batches**: every frame appears as a thumbnail strip with a `i / N` counter - click any thumbnail to open it large inside the node. Use the **arrow keys** (← →) to flip through the batch, click anywhere on the open image to advance to the next, hit `Esc` or the `×` button to collapse back. Two save buttons act on the currently selected frame: **Save to Disk** (choose any folder on your computer; the suggested filename auto-increments per click) and **Save to Output** (saves to ComfyUI's `output/`, supports subfolder syntax like `SDXL/portrait`). Flip the **save_mode** widget to `save` and the node turns into a drop-in replacement for SaveImage - every batch frame is automatically written to `output/` with embedded workflow metadata. Both modes embed your workflow into the saved PNG so you can drag it back into ComfyUI later. The preview also **survives workflow tab switching**, so you can leave it on a frame and come back to it later.

### 💾 Save Image Pixaroma
Save your images to **any folder on your computer**, not just ComfyUI's output folder. Type or paste a path, click **Browse** to pick a folder with the normal system dialog, or leave it empty to use the output folder. The **filename builder** has clickable chips for everything you might want in a name - the wired filename from Load Image, the date or time, an auto-increasing counter, the width and height, the batch number, even the seed from a Seed node - and a live **"Will save as"** line always shows the exact file the next run will create, so a complex pattern is never a surprise. Files **never overwrite** (the counter continues from the highest one already there), and typing `/` in the name makes subfolders (like a folder per day). Pick **PNG** (keeps transparency, embeds the workflow so you can drag the file back into ComfyUI) or **JPG** (smaller, with a quality setting). The saved images show in a **big preview right on the node** - one image fills the space, a batch shows as a grid you can click through - so it doubles as a preview node, with **Copy**, **Open**, and **Open Folder** buttons and a right-click menu on the picture. Flip **Mode** to Preview to see results on the node without writing anything to disk. Works in both the classic and the new node interface.

### 📐 Resolution Pixaroma
A simple, one-click resolution picker. Choose from 9 popular aspect ratios - 1:1, 16:9, 9:16, 2:1, 3:2, 2:3, 4:3, 3:4, and 4:5 (Instagram-portrait friendly) - and instantly get the exact width and height you need, including popular sizes for AI video. Type any Custom Ratio (21:9, 16:10, anything) with auto-computed AI-friendly sizes, or use Custom Resolution to type exact dimensions. Math expressions work in the Width and Height fields too - type `1024+128` or `512*2` and it just works. It perfectly saves all your settings with your workflow!

### 📐 Sizes Pixaroma
Keep your favourite exact resolutions in one tidy list and pick the one you want with a click - it sends out the **width** and **height**. Add any size you like from the settings (a `1024 × 1536` here, a `1920 × 1080` there), and a **Portrait / Landscape** button flips the whole list between tall and wide, so you only ever add a size once and switch orientation on the fly. There is an optional **snap** to keep every size on a multiple of 8, 16, 32 or 64 (handy for models that are fussy about dimensions), and you can recolour the node's buttons per node - or save your colour as the default for every new one. A small arrow folds the node down to just the size you have selected when you want it out of the way, and adding a size you already have never makes a duplicate - it just points you at the one that is there. Works in both the classic and the new node interface.

### 🌱 Seed Pixaroma
A dedicated seed node you wire into KSampler (or any node with a seed input). Flip between **Random** - a fresh seed every run - and **Fixed** - the same seed for repeatable results - right on the node. **New fixed random** rolls a new seed and locks it (great for keeping a lucky result while you tweak other things), **Use last seed** brings back the seed from the previous run, and **Copy** puts the current seed on your clipboard. Type any number into the big readout to set it exactly, and in Random mode a **Last run** line tells you which seed actually made the latest image. One Seed node can feed several samplers at once so they all stay in sync. Works in both the classic and the new node interface.

### 🎛️ Control Panel Pixaroma
One node that gathers every dial, switch and setting you keep reaching for, so you tweak them all from one place instead of hunting through the graph. Add a control, wire it to any input, and it becomes whatever you plug it into: a **slider** for a number (steps, cfg, denoise, a LoRA strength) that you drag, hold **Shift** for fine control, or double-click to type; a **switch** for an on/off setting; a **dropdown** for a picker like the sampler or scheduler that learns the whole list - and in the settings you tick which options to show, so it only offers the ones you actually use; a **seed** with randomize and new-seed buttons; or a **text** field you type into. A new control starts on **Auto** and the first input you connect it to teaches it everything - the kind, a sensible name, and for a slider the range, step and current value - so connecting never changes your workflow behind your back. Each control carries its own output on its own row, and it changes to match if you move it to a different input. It won't connect to things it can't drive, like a model or an image, and it tells you if you try. **Right-click** the node for the settings, where you add and remove controls, rename them, set a slider's range, choose which options a dropdown shows, and pick the colour the controls paint with (per node, and you can save your colour as the default for every new panel). Up to 16 controls per node, mixed freely, and you can add as many panels as you like. Works in both the classic and the new node interface.

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

### 🔄 Portrait Landscape Pixaroma
Flip a size between portrait (tall) and landscape (wide) with one click. Enter your two dimensions (or wire them in), then tap **Portrait** or **Landscape** - Portrait makes the smaller number the width (a tall image), Landscape makes the larger number the width (a wide image), so the order you type them never matters. One node replaces keeping two WH nodes and a Switch WH just to flip orientation. Outputs `WIDTH`, `HEIGHT` - wire them straight into an empty latent. Works in both the classic and the new node interface.

### 🔁 Switch Source Pixaroma
Flip a whole pipeline (or any set of wires) between two sources with one click. Wire your **A** bank and **B** bank for as many rows as you need (works for any wire type: MODEL, CLIP, VAE, IMAGE, LATENT, STRING...), then toggle **A** or **B** to swap them all at once - no rewiring cables. Two common setups: swap a combined Load Checkpoint against three separate model/CLIP/VAE loaders, or flip a "local" pipeline against an "api" one without ticking ten little switches. Output labels are editable per row, and you can pick whether empty rows leave the output blank or show a clear error.

### 🔇 Mute Switch Pixaroma
Skip whole parts of a workflow with one click. Wire the last node of each "scene" (usually a KSampler) into a row, then use the small switches to pick what runs and what doesn't. Two pills at the top: **Single** (only one scene runs at a time, like a radio button) or **Multi** (any combination), and **Mute** (the scene doesn't run) or **Bypass** (each node passes its input through unchanged). Chain Mute Switches together to group scenes: an outer Mute Switch can pick a group, and inner Mute Switches fine-tune which scenes inside that group run. Right-click for **Enable all rows** / **Disable all rows** to flip every row at once in Multi mode. Labels on rows are editable so you can name your scenes.

### 🎛️ Group Switch Pixaroma
A control panel of on / off switches, one per group, to mute or bypass whole groups with a click - a tidy, built-in way to do it with no extra extension needed. It lists both **Pixaroma groups** and regular **ComfyUI groups**, each with its colour dot and name (and a number if two share a name). A small **gear** opens a floating panel where you choose **Mute** or **Bypass**, whether to show **all** groups or just the ones you **pick** (with a search box and a locate button to jump to a group), and a switching rule: any number on, only one on at a time, or always keep one on. Flip a switch here and the group's own header button and any copies of this node all stay in sync. Works in both the classic and the new node interface.

### 🔗 Set / Get Pixaroma
Wireless connections for a cleaner canvas. Drop a **Set** node, wire anything into it (image, model, number, prompt), and give it a name. The Set has a passthrough output, so a node sitting nearby can wire to it directly, while far ones read it with a **Get** node - pick the name from a dropdown and it carries the same value, no cable stretched across the workflow. Colour a Set however you like and its Gets take the same colour (and follow along when you recolour it), so matching pairs are easy to spot, and the Get dropdown tags each name with its colour. Collapse them to almost nothing so they disappear into the background, and right-click to jump between a Get and its Set. They respect subgraphs (a value you **Set** in the main graph can be read by **Get** nodes inside your subgraphs), show a tiny value preview for plain numbers and text, and at run time they resolve straight to the original source - identical to a direct wire, with no extra cost. Works in both the classic and the new node interface. **Needs ComfyUI frontend 1.39.16 or newer** - older 1.39.x builds are missing a link feature these two nodes rely on (tested on 1.45.15). Not sure which frontend you have? Drop a **Version Check Pixaroma** node on the canvas, or look in **Settings → About**.

### 🔢 Number Pixaroma
A small node with one number field and two outputs: **int** and **float**. Useful when one downstream node wants a whole number and another wants a decimal from the same value, or when you want to convert a decimal into a whole number cleanly in the middle of a workflow. Accepts whole numbers, decimals, and math expressions like `1024+64` or `1024/3`. The int output rounds to the nearest whole number (`3.5` becomes `4`, `3.4` becomes `3`). Range is roughly plus or minus 1 quadrillion, so even very large numbers fit.

### ✍️ Text Pixaroma
A multi-line text field with a STRING output. Write your prompt (or any other long text) once and wire the output into multiple downstream nodes - positive prompt, negative prompt, captions, instructions, anywhere a string is needed. The field grows when you drag the node bigger, so you have plenty of room for long prompts. The text saves with your workflow.

### 💬 Prompt Pixaroma
A prompt box with a personal library of reusable shortcuts. Save a long chunk of prompt once (an oil-painting look, a lighting recipe, a quality booster), give it a short name, and then just type `@name` - it becomes the full text at run time, so the box stays short and readable. Type `@` for a searchable list of your saved shortcuts grouped by category; known ones show orange, a typo shows red, and a **Show expanded** preview shows exactly what gets sent. Wire another prompt into the text input and the two are joined - choose **My prompt first** or **Wired first** and the separator (comma, space, new line, pipe, and more). The **Tags** button opens a full-screen library where shortcuts live as cards you can create, rename, move between categories, and share with **Export** / **Import**; right-click any text in the box to copy it or save it as a shortcut, filling the library in for you so you only name it. Your library is stored on your own machine, stays private, and survives updating the pack - a shared workflow keeps your shortcuts to yourself, and dropping a finished image into **Prompt Reader Pixaroma** recovers the prompt behind it. For variety, type `*` and a category name (like `*Styles`) to drop in a RANDOM saved shortcut from that category, freshly chosen every run - it shows violet so it stands out from a fixed orange `@`. Each node's button colour and the default join order are set from its gear. Works in both the classic and the new node interface.

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
A small terminal node that plays a sound when reached during workflow execution, and times how long the run took to get there. Drop one at the end of a workflow to hear "render finished" while you're in another browser tab or app, or branch one off any node mid-graph to be alerted at a checkpoint. Pick from 10 bundled notification sounds (drop more `.mp3`/`.wav`/`.ogg` into `assets/sounds/` to extend), set a per-node volume and an optional label, and tap the **▶ Preview** button to audition a sound without running the workflow. A master toggle in **Settings → 👑 Pixaroma → Notify** silences every Notify node at once for quiet sessions. Each node also has its own enabled toggle. Always re-fires on every Run, even when upstream is fully cached.

Every node is also a **checkpoint timer**: the clock starts when you press **Run** and stops the moment this node is reached, so it answers "how long did it take to get this far". One at the end times the whole run; branch several through the graph and the gaps between their times are the per-segment times. The timing is independent of the sound - it still records with the sound off or the master mute on, so you can time a workflow in silence, and a 🔇 marker on the clock row means the ding won't play. Each node keeps **its own history** of the last 10 times (right-click → **Notify time history**), with the fastest marked, plus Copy, Export `.txt` and Clear; the times live on your machine, so a shared workflow never carries them. A small arrow on the clock row folds the node down to just the clock. Right-click also has **Record time** (per-node timer on/off) and **Mute all Notify sounds**. Works in both the classic and the new node interface.

### ⏱️ Run Timer Pixaroma
A clock that times how long a workflow takes. It resets to zero the moment you press **Run**, counts up live while the workflow is working, then freezes on the total the instant it finishes and plays a chime, so you know it's done even when you're in another tab or app. The node face shows only the clock - small `m` / `s` / `h` markers sit next to the centered digits, and a long run rolls over to hours automatically. Everything else is in the right-click menu: turn the chime on or off, pick the sound and volume (with a **▶ Preview**) from the same library as Notify Pixaroma, choose how much detail to show (just minutes and seconds, or add hundredths or milliseconds), and set the clock colour with a full colour picker built right into the panel. A master mute for every Run Timer lives in **Settings → 👑 Pixaroma → Run Timer**. Just drop it on the canvas - it doesn't need wiring to anything. Works in both the classic and the new node interface.

### 🗒️ Run Log Pixaroma
A companion to Run Timer that keeps the last 10 run times right on the node. Every time you press **Run** it times the whole workflow and drops the finished time on top of the list, newest first - the most recent run is highlighted in orange and the quickest of the ten is marked in green, so you can watch a workflow get faster over a session or notice when a change slows it down. It shows only the times, and the list belongs to that one workflow: it is saved with it and travels with it, so a different workflow keeps its own separate list. Two subtle buttons in the corner **export** the list as a `.txt` file or **clear** it, and the same actions plus **Copy** are on the right-click menu. Just drop it on the canvas - it doesn't need wiring to anything. Works in both the classic and the new node interface.

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

### 🔧 Krea LoRA Converter
Trained a LoRA for the **Krea 2** model on **fal.ai**? It will not load in ComfyUI on its own, because it names its layers differently than ComfyUI expects. This node fixes that: pick your LoRA, press Convert, and it saves a ready-to-use copy into your LoRAs folder that works with any LoRA loader. The conversion is exact - your training is untouched, the result is identical, just loadable. It reads the file first and tells you what it is (so it will not touch a LoRA that already works), and it only ever reads your file and writes a new one. It never changes the original or downloads anything.

---

## 📺 Learning Resources

Master the Pixaroma suite with our video guides and workflow deep-dives:

📺 **[Visit Pixaroma on YouTube](https://www.youtube.com/@pixaroma)**

---

## 🛠 Changelog

### **July 22, 2026 · v1.4.53**
- **Sliders Pixaroma grows into Control Panel Pixaroma - one node for every dial, switch and setting you keep reaching for.** It still does everything the sliders did, and now each row can be more than a slider: wire a row to an on/off setting and it becomes a **switch**; to a picker like the sampler or scheduler and it becomes a **dropdown** that learns the whole list, with a place in the settings to tick which options to show so it only offers the ones you use; to a seed input and it becomes a **seed** with randomize and new-seed buttons; and to a text box and it becomes a **text** field you type into. As before, each control simply becomes whatever you plug it into and changes to match if you move it somewhere else, it won't connect to things it can't drive like a model or an image, and it tells you if you try. Right-click the node to add and remove controls, rename them, set a slider's range, choose a dropdown's options, and pick the colour it paints with. Up to 16 controls per node, mixed freely. Your existing Sliders nodes keep working and simply gain the new abilities. Works in both the classic and the new node interface.

### **July 21, 2026 · v1.4.47–v1.4.52**
- **LoRA Loader Pixaroma tidies up its info window and adds two handy options.** When a LoRA carries a lot of trigger words, its info window used to grow very wide and very long; now it stays a sensible size and the words scroll, each on one line, with the full text shown when you hover. If a LoRA has both its own words and words saved from Civitai, a small **File / Civitai** switch lets you flip between the two sets, and there is a button to delete the saved Civitai info and go back to the file's own words. Looking a LoRA up on Civitai now jumps straight to those words the moment it finds them. And a new setting, on by default, hides the file ending (like .safetensors) on each row so you see just the name - turn it off in the gear if you would rather see the whole file name. Works in both the classic and the new node interface.
- **New: Text Join Pixaroma (Two, Three and Four).** Join a few pieces of text into one, with each piece on its own line. Every line works two ways: type straight into it, or drag a wire in from another node to feed it - so you can mix fixed text with text coming from elsewhere. Pick the two-, three- or four-line version for how many pieces you need. The lines grow as you make the node bigger, so long text has room. Right-click the node to choose what goes between the pieces (a comma, a space, a new line, nothing, or your own), to skip empty lines so you never get a stray comma, and - the handy part - to rename each line to whatever you like (trigger words, prompt, camera, lighting, and so on) so the node reads the way you think. Works in both the classic and the new node interface.
- **New: LoRA Loader Pixaroma.** Stack as many LoRAs as you want in one small node instead of chaining a row of separate loaders. Each LoRA sits on its own line with an on/off switch and a strength you can type or nudge with arrows, and you can chain the model and clip through several of these. Click the little **i** on any LoRA to see its details and its trigger words - read straight from the file, so it works with no internet - then tap the ones you want, and they come out of a **triggers** output as plain text you wire into your prompt. If a LoRA has no words of its own you can type your own in and they are saved on it, or press the optional **Civitai** button to look them up online (only when you ask) and keep them for next time, with a link to open its page. The name box is a searchable list of your LoRAs you can browse folder by folder, and **Add LoRA**, an all on/off switch and the settings tuck into the middle of the node to keep it compact. Right-click a row to move, duplicate or remove it, and the gear holds the defaults - the strength step, separate model and clip strengths, the trigger separator and the highlight colour. One thing to know: connecting **clip** is optional and it still works without it, but wiring it through lets a LoRA tune how its trigger words are read, which matters most for LoRAs built around a trigger word. Works in both the classic and the new node interface.
- **Prompt Pixaroma can now roll a random shortcut each run.** As well as `@name` for one specific saved shortcut, type `*` and a category name (for example `*Styles`) to drop in a RANDOM shortcut from that category - a fresh one every time you run, so you get variety without touching the prompt. Type `*` for a list of your categories; a working one shows violet so you can tell it apart from a fixed orange `@`, and the preview marks it as random. Wire a Show Text Pixaroma to the output to see exactly which one was chosen on each run, and use a random seed if you want a new image every time. Works in both the classic and the new node interface.
- **New: Run Log Pixaroma.** A companion to Run Timer that keeps a running list of how long your last 10 runs took, right on the node - so you can watch a workflow get faster over a session, or notice when a change has slowed it down. Every time you press Run it times the whole workflow and drops the finished time on top of the list, newest first; the most recent one is highlighted and the quickest of the ten is marked. It shows only the times - no names, no clutter - and the list belongs to that one workflow, so it stays with it and is still there after you reload, while a different workflow keeps its own separate list. Two small buttons in the corner save the list as a text file or clear it, and the same actions plus Copy are on the right-click menu. Just drop it on the canvas - it doesn't need wiring to anything. Works in both the classic and the new node interface.
- **New: Outpaint Stitch Pixaroma.** The companion to Outpaint Pixaroma: once the model has painted the new scenery, this puts your original picture back exactly where it was, at full quality, and keeps only the freshly generated area. It exists because a large image usually has to be shrunk down for the model to work, which softens the original half on the way through - this brings that half back sharp, so only the new part stays soft (which is fine, it had to be generated). Wire the extra output from Outpaint Pixaroma into it and it drops the original back in the right place and blends the join. **Feather** softens the seam between the old and new areas, and **Color match** gently evens out any colour or brightness step where they meet - it follows the background, so it handles a light wall over a dark floor as two separate tones instead of one flat colour, and it is careful to even out only the background, leaving any new subject the model added untouched. Both are proper sliders you can also wire a number into, and you can compare different Feather and Color match settings side by side in a grid with XY Plot Pixaroma. It also hands back a mask of just the new area, in case you want to refine only that part later. Works in both the classic and the new node interface.

### **July 19, 2026 · v1.4.43–v1.4.46**
- **Prompt Pixaroma preview now keeps up with a connected prompt.** When you wire another prompt into the box, the little preview underneath updates the moment you change that other prompt, instead of waiting until you click back into the Prompt box - so what you see always matches what will be sent. The final result was already correct either way; this just fixes the live preview.
- **New: Prompt Pixaroma.** A prompt box that keeps a personal library of reusable shortcuts. Save a long piece of prompt once - say an oil-painting look with all its details - give it a short name, and from then on you just type `@oilpainting` and it turns into the full text when you run. Type `@` for a searchable list of your saved shortcuts grouped by category; the ones it knows show orange, a typo shows red, and a **Show expanded** preview shows exactly what will be sent. You can also wire another prompt into the box and the two are joined - you pick which comes first and how they are separated (comma, space, new line, and more). The **Tags** button opens a full-screen library where your shortcuts live as cards you can add, rename, sort into categories, and share with **Export** / **Import**; right-click any text in the box to copy it or save it straight into the library, and drop a finished image into **Prompt Reader Pixaroma** to recover the prompt behind it. Your library is kept on your own machine, stays private, and survives updating the pack, so a shared workflow never gives your shortcuts away. Each node's button colour and the default order for joining can be set from its gear. Works in both the classic and the new node interface.
- **Updates now show up on their own - no more hard refresh.** After updating the pack, some people still saw the old version of the nodes - missing buttons, missing panels - until they pressed Ctrl+Shift+R, sometimes several times, because the browser kept using an old saved copy of the pack's files. From this version on, every update looks brand new to the browser, so it fetches the fresh files by itself. Just update and restart ComfyUI as usual - no key combos, no cache tricks, and it works the same in a normal browser, in the Desktop app, and on Mac. One thing to know: if your browser is already stuck on an old copy from before, this update may need one final Ctrl+Shift+R - and that should be the last time you ever need it.
- **New: Load Image Mini Pixaroma, with an Image Info companion.** A smaller, tidier Load Image for when you don't want a big busy node taking over the canvas. It still does everything the full one does - upload, paste, drag-and-drop, flip through your images with the arrows, and paint a mask in the Mask Editor - but the node itself is stripped down to just the picture, the file picker and two outputs. All the resizing (max megapixels, longest side, scale by, fit inside, crop to fill, match ratio, plus snap and the resample choice) tucks away behind the gear, so it is there when you want it and out of the way when you don't, and you can recolour the node's buttons per node. Two small cards still show the size going in and coming out. When you do need the extras - the mask, the width and height, or the filename - drop in the new **Image Info Pixaroma** node and wire the loader's second output into it; it hands those back, and shows the size and filename right on its own face so a glance is often enough. Works in both the classic and the new node interface.

### **July 18, 2026 · v1.4.42**
- **New: Outpaint Pixaroma.** Adds a solid-colour border around your image so an outpainting model can fill in new scenery - the setup step for extending a picture past its edges, all in one node instead of three. Choose **To ratio** to grow the image to a shape like 16:9 or 3:2 (and a row lets you pick which side the new space goes on), or **By side** to add an exact number of pixels to an edge - or just grab a green edge on the preview and drag it out. A live preview shows exactly where the new area will be, with the pixel amounts written on it and a badge showing the final size, and a small Input → Output card shows the real dimensions and turns orange when they change. The fill is a neutral grey by default, because a strong colour like green can leave a faint tint across the whole picture; click the swatch to pick any colour you like. You can optionally shrink the result to a megapixel size so it stays sensible to generate, and you choose which megapixel buttons appear - including adding your own custom value - plus an optional snap to a multiple of 8, 16, 32 or 64. The gear (or right-click) opens settings to pick which ratio and megapixel buttons show and to recolour the node's buttons, and a little arrow folds the node down to just the picture when you want it out of the way. One thing to know: this node only adds the area to fill - the actual outpainting is done by your model or LoRA, which usually needs its own trigger words in your prompt. Works in both the classic and the new node interface.

### **July 16, 2026 · v1.4.40–v1.4.41**
- **Notify Pixaroma now times your workflow.** Every Notify node is also a checkpoint timer: the clock starts when you press Run and stops the moment the workflow reaches that node, so it tells you how long it took to get that far. Put one at the end for the total, or branch a few through the graph and the gaps between their times show you how long each part took. The timer does not depend on the sound - it still records with that node's sound switched off, or with every Notify muted, so you can time a run in complete silence (a small mute marker on the clock row tells you when the ding will not play). Each node keeps its own list of the last 10 times, with the quickest marked; right-click the node for **Notify time history** to copy a time, export the list as a text file, or clear it. Your times are kept on your own machine, so sharing a workflow never sends them along, and a copied node starts its own fresh list. A small arrow on the clock row folds the node down to just the clock when you want it out of the way, and the right-click menu can turn the timer off for one node or mute every Notify at once. One thing to know: a Notify node placed inside a subgraph will still play its sound, but it cannot time itself - put it in the main graph for that. Works in both the classic and the new node interface.
- **Save Image Pixaroma no longer stretches itself very tall.** The node could suddenly become enormously long - sometimes flashing long and back again when you switched workflows, and sometimes just staying that way until you resized it by hand, including in workflows shared by other people. It was measuring itself at moments when it could not actually see itself and getting a nonsense answer, then growing to match. Now it refuses to measure at those moments, it can never ask for a silly height, and the correction waits for the node to really appear instead of giving up after a fraction of a second (which is why it used to stay big when you came back to a workflow later). Workflows already saved with an over-tall node are put right when you open them, while a node you deliberately made tall yourself is left exactly as you set it - handy when you drag it out to see a tall portrait image in full. The **Reset node size** menu item no longer switches the correction off for good.

### **July 15, 2026 · v1.4.38–v1.4.39**
- **New: Sizes Pixaroma.** A tidy list of your favourite exact resolutions - pick one and it sends out the width and height. Add any sizes you want from the settings, and a Portrait / Landscape button flips the whole list between tall and wide, so you only add a size once and switch orientation whenever you like. There is an optional snap to keep sizes on a multiple of 8, 16, 32 or 64 (handy for models that are fussy about dimensions), and you can recolour the node's buttons - per node, or save your colour as the default. A small arrow folds the node down to just the size you picked when you want it compact. Adding a size you already have does not make a duplicate; it simply points you at the one that is there. Works in both the classic and the new node interface.
- **Duplicating a Crop or Inpaint Crop node no longer touches the original.** When you copied one of these nodes, the copy quietly shared the original's saved image and mask, so painting a new mask on the copy and saving it could overwrite what was on the original. Now every copy starts with a clean slate: its editor opens empty and its little preview on the node clears too, so the two are never mixed up. If the copy is wired to an image, it simply shows that image as usual. This works for every way of copying a node.

### **July 14, 2026 · v1.4.33–v1.4.37**
- **New: Sliders Pixaroma.** A panel that holds every number you keep reaching for. Add a slider, wire it to any number input - steps, cfg, denoise, a LoRA strength - and from then on you tweak it from the panel instead of hunting through the workflow. Drag across a slider to set it, hold Shift for fine control, or double-click to type an exact value. Each slider has its own output, on its own row. A new slider is set to Auto, and the first input you connect it to teaches it everything: whether it sends a whole number or a decimal, plus a sensible name, range and step - and it takes on the value that input is already using, so connecting never changes your workflow behind your back. It also cannot send the wrong kind of number, because it takes on its input's type. Right-click for the settings, where you add and remove sliders, set their ranges, and choose the colour the sliders paint with - per node, and you can save your colour as the default for every new panel, so you are not stuck with the orange.
- **Switch and Mute Switch line up properly in the new node style.** In ComfyUI's new node look, the little sockets you plug wires into were stacked above the rows, so each row's switch ended up below the socket it belonged to instead of beside it. Now every socket sits on its own row, just like the classic look: the wire, the name and the switch all on one line. The empty row at the bottom keeps its socket, so you can always see where the next wire goes. The classic look is unchanged, and your saved workflows are not affected either way.
- **The Switch now exports properly to API format.** If you saved a workflow in API format, the Switch node only kept the input you had selected and dropped the others, so changing which one it used (by editing SwitchState in the file) failed with an error about a missing input. The exported file now keeps every wire, so you can point it at any of them and it just works. Behind the scenes the Switch now tells ComfyUI which branch it needs, instead of the other branches being stripped out beforehand, which also means it finally picks the right branch when you run a workflow through the API with no browser open. Nothing changes for normal use: only the branch you pick still runs, just as fast as before. Switch Source got the same fix, since it dropped the unused A/B side in the same way. One thing to know: in an API-exported file the unused branches are now really there, so if one of them points at a model you do not have, ComfyUI will say so.
- **All on / All off buttons on the Group Switch.** Two buttons at the top of the node flip every group in the list at once, so you can switch off a whole set of sections (or bring them all back) with one click instead of clicking each one. They only touch the groups that switch is showing, so a hand-picked set leaves the rest alone. If you picked a switching rule that only allows one group on at a time, turning them all on is impossible, so that button is greyed out and hovering it tells you why.
- **A mute switch for the Run Timer, right where you need it.** Right-click a Run Timer and you will find a new "Mute all Run Timers" switch at the top of the settings. Turn it on and no Run Timer will make a sound when a workflow finishes, in any workflow, until you turn it back off - handy when you want quiet for a while without changing each timer one by one. It is the same switch that lives in ComfyUI's Settings, so flipping either one flips both. While it is on, the sound settings below it are dimmed to show they are being ignored, but the Preview button still plays, so you can keep trying sounds out. The existing "Chime on finish" toggle is still there for silencing just one timer, and it now says so on the label.

### **July 13, 2026 · v1.4.31–v1.4.32**
- **The Run Timer can now remember your recent run times.** Right-click a Run Timer and pick Run time history to see the last ten finished runs, newest first. Each one shows which workflow it was and what time of day it ran, right next to how long it took, and the fastest is marked with a lightning bolt - so you can tell at a glance which workflow is quicker. The list is shared across all your workflows and is remembered between sessions, and you can copy a single time, save the whole list to a text file, or clear it.
- **New: Krea LoRA Converter.** If you train a LoRA for the Krea 2 model on fal.ai, it will not load in ComfyUI on its own, because the file names its parts differently than ComfyUI expects. Drop in this node, pick your LoRA, and press Convert - it saves a ready-to-use copy into your LoRAs folder that works with any LoRA loader. Nothing about your training changes; the result is identical, just usable. It checks the file first and tells you what it is, so it will not touch a LoRA that already works, and it only ever reads your file and writes a new one - it never changes the original or downloads anything.

### **July 11, 2026 · v1.4.30**
- **The Seed node got several handy additions.** Small up and down arrows next to the seed let you nudge it by one (hold to keep counting) - handy for trying the seeds right next to one you like. You can now set random seeds as short as three digits if you prefer small, easy-to-remember numbers. And a new Seed history panel - open it with the H button or by right-clicking the node - remembers the last ten seeds you have run, so you can reuse one, copy it, or save the whole list to a text file. The buttons were also rearranged so their labels always fit.
- **Pause Image buttons are in a clearer order.** On the Pause Image node, Regenerate and Continue swapped places, so Regenerate is on the left and Continue on the right. It reads more naturally and helps avoid clicking the wrong one.

### **July 9, 2026 · v1.4.25–v1.4.29**
- **Image Compare no longer errors when one image is missing.** If a branch feeding one of the two inputs is muted, bypassed, or simply left unconnected (common in a workflow that toggles between text-to-image and image-to-image), the node used to throw a system error even though nothing was actually wrong. Now it just shows whichever image is connected - or a short "connect images" note when neither is - and never interrupts your run. Both inputs are optional, so it is safe to leave the node in place.
- **Fixed a small corner glitch on groups.** After the recent speed improvement, the little resize grip in a group's bottom-right corner could poke out past the rounded edge. It now tucks neatly back inside the corner, and groups stay just as fast.
- **Prompt Reader can now follow a connected image.** You can wire an image's file name (for example from the **Load Image Pixaroma** node's `filename` output) into the new input on **Prompt Reader**, and it reads that image's prompt automatically - no more picking the same image twice. As you flip through pictures in the Load Image node with the arrows, Prompt Reader keeps up and shows each one's prompt. To go back to choosing by hand, just upload, drop, or pick a file on Prompt Reader and the connection lets go on its own. (Only images that actually have a prompt saved inside them can be read, like PNGs made in ComfyUI, Automatic1111, or Forge.)
- **Pause Image keeps your image details when you press Continue.** When you sent an image through the Pause Image node and pressed Continue, the saved image kept the picture but lost its details - the prompt, seed, and generation settings - so gallery tools that read that info, and our own Prompt Reader, showed them as blank. Now those details travel through the node, so images you save after Continue carry their full information again, exactly like images that skip the node. Continue is just as fast as before and produces the same image.
- **Groups no longer slow down the canvas.** Adding a Pixaroma Group could make panning and moving around the canvas feel sluggish, especially on some computers and when a large group filled the screen. That is fixed - groups now draw far more efficiently, so the canvas stays smooth whether or not a group is on screen. The group and its buttons look exactly the same as before.

### **July 8, 2026 · v1.4.24**
- **XY Plot now works with the Power Lora Loader, and lets you compare lora strengths.** Before, XY Plot could only compare loras from the basic Load LoRA node. Now it also recognizes multi-lora loaders like the Power Lora Loader, so you can pick one of its lora rows as an axis. On top of swapping which lora loads, you can now put a lora's **strength** on an axis and compare weights side by side (for example 0.3, 0.6, 1.0) - and you can even make a two-way grid with the lora across the top and its strength down the side. The lora checklist shows all the loras you have installed (that is how you compare against ones not loaded in the node yet), and a stray "None" entry that used to sneak in from other loader nodes is gone. The node's Help explains it, including the reminder to turn off any other loras you are not comparing so they do not blend into every square.

### **July 7, 2026 · v1.4.20–v1.4.23**
- **A cleaner Run Timer.** The Run Timer is now just the floating clock - no title bar and no frame around it - so it takes up almost no room and looks like a real little clock on your canvas. You can drag it from anywhere on the clock and right-click it for the settings, the same in both the classic and the new node interface. It sizes itself tightly to the time it is showing, so there is no empty space around it.
- **A smaller Seed node.** Right-click a Seed Pixaroma node and choose "Seed compact size" to shrink it to a single row - the seed number, a small Random/Fixed toggle, and an N button that rolls a new random seed and locks it - so it takes far less room on the canvas. "Seed full size" brings all the buttons back. To copy the seed while compact, hover over the number: a small popup shows the full seed with a copy button, which also lets you read a long seed that does not fit the small field. There is also a "Seed settings" panel (also on right-click) where you can pick the size, make every new Seed node start compact, and cap how many digits a random seed has (handy when the big 16-digit number feels too long, for example limiting it to 8 digits). The compact size is polished so the seed number never gets clipped and a compact node keeps its size when you reload or resize the workflow. Works in both the classic and the new node interface.
- **Fold the Save Image node to save space.** Once a Save Image node is set up, you can fold it down with the small arrow in the top-left corner so it shows only the buttons and your result image, tucking away the folder and file-name settings. Click the arrow again to open it back up. There is also a setting (right-click the node) to hide the button bar as well when folded, for the most compact look. The node remembers whether it was folded when you save and reopen your workflow, and it works in both the classic and the new node interface.

### **July 6, 2026 · v1.4.19**
- **NEW: Save Image Pixaroma.** Save your images to any folder on your computer, not just ComfyUI's output folder. Type or paste a path, click Browse to pick one, or leave it empty for the output folder. Build the file name from clickable chips - the name from a Load Image node, the date or time, an auto-increasing counter, the width and height, the batch number, even the seed from a Seed node - and a live "Will save as" line shows the exact file the next run will create, so a complicated name is never a surprise. Files never overwrite (the counter continues from the highest number already there), and typing a slash in the name makes subfolders, like a folder per day. Choose PNG (keeps transparency and embeds the workflow so you can drag the file back in later) or JPG (smaller, with a quality setting). Your saved images show in a big preview right on the node - one image fills the space, a batch shows as a grid you can click through - so it also works as a preview node, with Copy, Open, and Open Folder buttons and a right-click menu on the picture. Flip the Mode to Preview to see results on the node without writing anything to disk. Works in both the classic and the new node interface.

### **July 3, 2026 · v1.4.18**
- **Put the seed into your saved file names.** You can now print the number from a Seed Pixaroma node straight into the file name of a Save Image, Preview Image Pixaroma, or Save Mp4 node. Type `%Seed Pixaroma.seed%` in the filename field where you want the number (for example `render_%Seed Pixaroma.seed%`) and your saved file comes out as `render_4595344337756276`. It works just like ComfyUI's built-in `%KSampler.seed%` trick, in both the built-in Save Image node and our own save nodes, and the number always matches the image you just made, whether the seed is Random or Fixed. Tip: point the token at the Seed node itself, not at the sampler.

### **July 2, 2026 · v1.4.17**
- **Run Timer keeps each workflow's time when you switch tabs.** Before, switching to another workflow tab reset the clock to zero, so you lost the time you had just measured. Now every workflow remembers its own last time, and it only resets when you run that workflow again, so you can keep a few workflows in separate tabs and switch between them to compare how long each one takes. The time stays after a page reload too.

### **July 1, 2026 · v1.4.14–v1.4.16**
- **The mouse wheel zooms the canvas over Pixaroma nodes now.** Before, hovering your cursor over one of our nodes' controls could swallow the mouse wheel, so zooming the canvas in and out did nothing until you moved to an empty spot. Now the wheel zooms the canvas wherever you hover, while text boxes and lists still scroll normally when your cursor is over them. This applies to the classic node view; the new node view already worked this way.
- **XY Plot saves at full resolution now.** The comparison grid you export is no longer shrunk down to the on-screen preview size. A new Save row on the node lets you choose how big the Save buttons write out: 2048, 4096, 8192, or Full for the original size, so a big grid finally comes out big. It's built only when you press Save, so your runs stay just as fast as before, and both Save Disk (to your computer) and Save Output (to ComfyUI's output folder) use your chosen size. The node's Help has a short "Saving and image size" section explaining it.
- **NEW: Load Video Frame Pixaroma.** Grab one exact frame out of a video and use it as an image, like a Load Image node but for video. Load a clip and a preview shows on the node with a slider: drag it to any spot, step one frame back or forward with the arrow buttons, or type the exact frame number. It reads the frame count for you and shows where you are ("frame 76 · 117 frames"), and hands you the picked frame plus its mask and the video's frame count, fps, width and height. Great for pulling a still, a start frame, or a reference out of a video without exporting it somewhere else first. Works in both the classic and the new node interface.

### **June 30, 2026 · v1.4.13**
- **Drag a quick preview back onto the canvas.** The Preview Image node now saves the full workflow inside its temporary preview images (the ones made in Preview mode while you iterate), so you can drag one straight back into ComfyUI to rebuild the graph, just like a saved image. Before this, only the Save modes did that, so you had to save to your output folder and tidy up afterwards.

### **June 29, 2026 · v1.4.12**
- **Pin a Pixaroma Group to lock it in place.** Right-click a Pixaroma group and pick "Pin Group" and it stays put: you can no longer move or resize it by accident, and a pin shows in its title. It works with a whole selection too, so pinning several things at once (or pressing ComfyUI's own Pin button) now locks your Pixaroma groups along with the nodes. Unpin from the same menu, and the locked state saves with your workflow.
- **Pinned nodes stay locked when Align is on.** If you pinned a few nodes and had Pixaroma's Align feature switched on, dragging the selection used to drag the pinned ones along too. Now pinned nodes stay anchored whether one or several are selected.
- **Draw inpaint masks with a pen or tablet.** The mask brush in Inpaint Crop now works with a drawing tablet, pen, or touch, not just a mouse (the same fix we made earlier for Paint).
- **Prompt Multi and Prompt Stack keep their text rows the right size.** Rows holding several lines no longer shrink back to two lines after you switch workflows or tabs, the Add / Clear / Reset buttons stay inside the node as you type, and empty rows and a fresh node now sit at a tidy, compact height instead of leaving extra empty space.

### **June 28, 2026 · v1.4.9–v1.4.11**
- **NEW: Run Timer Pixaroma.** A clock that times your whole workflow: it resets when you press Run, counts up live, and freezes on the total the moment the run finishes, then plays a chime so you know it's done even when you're in another tab. The face shows just the time (with small m / s / h markers next to the digits, and it rolls over to hours on long runs). Right-click for the settings - chime on or off, the sound and volume with a Preview (the same sound library as Notify), how much detail to show (just minutes and seconds, or add hundredths or milliseconds), and the clock colour with a full colour picker built right into the panel. A master mute for every Run Timer lives in Settings. Just drop it on the canvas; it needs no wiring. Works in both the classic and the new node interface.
- **Turn a regular group into a Pixaroma Group.** Right-click a standard ComfyUI group and pick "Convert to Pixaroma Group": it becomes a Pixaroma group of the same size, name, and colour, so moving an existing layout to the new style is one click instead of rebuilding it by hand.
- **Pixaroma Groups no longer leak into subgraphs.** When you step into a subgraph you now see only that subgraph's own groups, not copies of the ones outside, and deleting a group inside a subgraph no longer deletes the matching one outside.
- **Dragging a group by its title bar always works now.** Before, grabbing the bottom half of a group's title bar (especially with a large title font) could pan the canvas instead of moving the group. Now the whole title bar moves the group, matching the move cursor you see.
- **Save Mp4 stores the workflow inside the video.** The full workflow is now saved inside the mp4, so you can drag a saved video back into ComfyUI to rebuild the graph, just like a saved image. Reading it back needs a video pack such as Video Helper Suite installed.
- **Filename date stamps accept lowercase `hh` for the hour.** When you put a date pattern in the filename (like `%date:yyyy-MM-dd hh-mm-ss%`), the hour now works with lowercase `hh`, matching the built-in Save Image (uppercase `HH` still works too).
- **The Seed node shows the seed it actually used.** In Random mode the big number now updates on every Run to the seed that made the latest image, so it matches the output instead of looking frozen. Switching to Fixed keeps that same seed (so the number does not jump), and Copy copies whatever is shown.
- **Find Set Pixaroma by dragging any wire.** Drag a connection out from a node and search, and Set Pixaroma now shows up for any kind of value (numbers, seeds, images, and more), not just text.
- **Get / Set nodes hold their picked name more reliably.** Added safeguards so a Get node (and occasionally a Set) does not lose the name you chose during long sessions with many of them, something a few users ran into in heavier workflows.

### **June 26, 2026 · v1.4.3–v1.4.8**
- **Pixaroma Groups stay with their workflow.** Fixed a bug where, with more than one workflow open, groups could appear on the wrong workflow tab or disappear. Each workflow (and each subgraph) now keeps its own groups, and groups placed inside a subgraph save correctly.
- **Set / Get nodes fixed.** Fixed a bug where a Set node could grow a second, duplicate input that stopped the value from passing through, which made paired Get nodes come up empty (sometimes with "missing input" errors). New workflows never get the duplicate, and older workflows that already hit it repair themselves when you open them.
- **Pixaroma Group snaps to the grid.** When ComfyUI's "Always snap to grid" setting is on, dragging or resizing a Pixaroma Group now lines up to the grid like everything else.
- **Pixaroma Group pastes where your mouse is.** Copy a group with Ctrl+C and paste with Ctrl+V and it lands at your cursor, instead of stacking on top of the original (where dragging the copy used to grab the original's nodes).
- **A folded group's button stops dodging.** With header buttons set to "Hover only", hovering a folded group no longer makes its unfold button jump aside.
- **Group Switch is friendlier.** Click anywhere on a row to flip it (not just the little switch), enabled rows are now bright while switched-off rows are dimmed so the state is clear at a glance, and new switches default to Bypass.
- **Switch is safer to click.** Click a row to make it active, and double-click its name to rename, so a near-miss on the toggle no longer drops you into editing the wrong label.
- **"Use last seed" is now instant.** On the Seed node, clicking Use last seed brings back the previous image straight from the cache instead of regenerating it once before it settles. This matches how other popular seed nodes behave.
- **Seed and Group Switch can be resized.** Both nodes are now resizable in width - drag a corner to make them wider or narrower, and the height keeps fitting their contents on its own. Before, Group Switch could only be made wider and the Seed node could not be resized at all.
- **No more false "browser cache outdated" warning.** The Version Check node sometimes warned that your browser was out of date right after an update even when your files were already current. The version number it reads now refreshes on its own, so that false alarm is gone.
- **Copy and paste a Pixaroma group.** Ctrl+C / Ctrl+V (and Duplicate) now carry the group frame itself, not just the nodes inside it. Copying a group together with a node keeps their layout when you paste.
- **Cleaner right-click menu.** When a Pixaroma group sits inside a regular ComfyUI group, right-clicking it no longer piles the regular group's menu options on top - you get just the Pixaroma group's own menu. And in the new node interface, opening a group menu no longer leaves an old node menu hanging open behind it.
- **Smoother group dragging in the new node interface.** Select a node, a Pixaroma group, and a regular ComfyUI group together and drag any of them: they now stay locked in step instead of one lagging behind the others.
- **Colour your whole selection from the group palette.** With a node, a regular group, and a Pixaroma group selected together, opening Pixaroma Group Colors now colours all of them at once (the regular group takes the title colour so it matches, instead of going dark).
- **Select all includes Pixaroma groups.** Pressing Ctrl+A now selects your Pixaroma groups too, so you can move, colour, or delete everything in one go.
- **Version Check now warns you about an out-of-date browser cache.** After an update, browsers sometimes keep running the old version of the nodes even though the files are already new, which can make workflows act up or fail for no obvious reason. The Version Check node now spots this: if your browser is running older code than what is installed, the Pixaroma line turns orange with a clear warning to press Ctrl+Shift+R, and the Copy button includes it so it shows up when you paste your versions into a bug report. The built-in help also explains a stronger refresh trick for browsers that hold on to the old version too tightly.

### **June 25, 2026 · v1.4.2**
- **NEW: Group Switch Pixaroma.** A control panel of on / off switches, one per group, that mutes or bypasses whole groups with a single click - a tidy, built-in way to do it with no extra extension needed. It lists both Pixaroma groups and regular ComfyUI groups, each with its colour dot and name. A gear opens a floating panel where you choose **Mute** or **Bypass**, whether to show all groups or just the ones you pick (with a search box and a button to jump to a group on the canvas), and a switching rule (any number on, only one at a time, or always keep one on). Flip a switch and the group's own header button and any copies of this node stay in sync. Works in both the classic and the new node interface.
- **Move a node and its group together.** Select a node along with a Pixaroma group and drag either one: the whole selection now moves as a single unit, nothing gets deselected, and it snaps into line with the Align tool.
- **Group selection now matches ComfyUI.** Drawing a selection box (Ctrl+drag) over an empty area replaces your group selection the way ComfyUI does, and holding **Shift** adds to it. Switching away mid-selection no longer leaves a stray group selected when you come back.
- **Dragging a ComfyUI group carries the Pixaroma groups inside it** in the new node interface too, and follows along smoothly.
- **Choose how group header buttons appear.** A new setting lets you have a group's header buttons always visible, shown only on hover, or a tidy in-between (the fold button and node count always there, the run / mute / bypass buttons on hover).

### **June 24, 2026 · v1.4.0–v1.4.1**
- **A cleaner, more modern Label editor.** The colour section was redesigned: pick **Background** or **Text** with two clear buttons (the active one lights up orange), then choose from a tidy palette, drag in the colour picker, or type a hex code, and the selected colour's code shows and updates right under the picker. There's a **Transparent** option for the background and a new **Reset** button (it puts the styling back to default but keeps your text). Everything is lined up neatly now: even spacing, aligned columns, and matching controls.
- **Label looks right on the canvas again.** Fixed the Label showing black corners (or a solid black box when set to transparent) in the classic interface, and tidied how it hugs its text with no stray outline in the new node interface. Manual resize is off since the label sizes itself to the text.
- **Groups, reimagined.** Last update's group styling has grown into a full **Pixaroma Group**: a group you add yourself (select some nodes and press **G**, or right-click and choose Add Pixaroma Group) that's entirely ours, so other extensions can't fight over it. It has a coloured header showing the group name and node count, one-click header buttons to **run / mute / bypass / fold** everything inside, and you can **fold** a whole group down to a slim bar to tidy your canvas (the nodes and wires inside tuck away, with a little running indicator while it works). Select several at once, move or resize them, duplicate one, nest them, and they snap into line with the Align tool. Heads-up for existing users: regular ComfyUI groups go back to their plain look, and the styling now lives in this new Pixaroma Group.
- **Group Mute and Bypass now reach inside subgraphs.** Muting or bypassing a group correctly turns off nodes nested in a subgraph, not just the subgraph box, so branching workflows behave the way you expect.
- **Run a single group.** The group header has a Run button that queues just that group's output nodes, so you can run one section of your workflow without running everything.
- **The colour menu colours your whole selection at once.** Right-click a node with a group also selected, pick a colour, and both get coloured together, matching how ComfyUI does it.
- **Load Image no longer grows out of its group.** Folding then unfolding a group could make a Load Image inside stretch taller and spill past the edge. Fixed, it keeps its size now.
- **Quieter and tidier under the hood.** Removed some leftover console messages and moved every right-click menu onto ComfyUI's current menu system, so Pixaroma no longer logs "deprecated" warnings.

### **June 22, 2026 · v1.3.101–v1.3.102**
- **Align tool now works with groups.** Drag a group and it snaps into line with nearby nodes and other groups, with the orange guide lines showing as it goes, and the nodes inside the group move along with it. Dragging a node now snaps to a group's edges too. (Turn on the Align button in the top toolbar to use it.)
- **Node and group colour favourites are now separate.** Saving a colour to a favourite from the group colour menu no longer overwrites the node colours you saved - each keeps its own set of favourites.
- **"Pick custom..." colours now open on the node's current colour**, so you can make a small adjustment instead of starting from an unrelated colour.
- **NEW: Group styling.** Groups get a cleaner look - rounded corners, a coloured header bar showing the group's name and how many nodes are inside, and a soft tint. Hover over a group and a row of buttons appears on its header so you can, in one click, mute all / bypass all / pick a colour / collapse or expand all the nodes inside. On by default (you can switch it off in Settings if you prefer the plain look).
- **NEW: Smart node title colour.** A node's title text now turns white or dark automatically to stay readable on whatever colour you give the node - no more grey titles vanishing on light colours. On by default.
- **Fresher colour swatches.** The custom-colour picker has a brighter, more modern palette, and the Pixaroma orange plus a handy dark grey are pinned at the front for quick access (for both nodes and groups). Picking a custom colour for a group now starts from the group's current colour.
- **More Align fixes.** Dragging a node, or selecting text inside a group, no longer drags the whole group by mistake; and collapsed nodes now snap into line too.
- **Load Video uses less memory** when loading big or long videos, so it's less likely to bog things down.

### **June 21, 2026 · v1.3.100**
- **NEW: Loop Start / Loop End + Combine Pixaroma** - repeat a part of your workflow as many times as you like. Put your nodes between Loop Start and Loop End, set the number of rounds, and the section runs over and over - great for making a long video in chunks or stacking up a batch of images. Each round can carry values forward to the next, and the new **Combine** node piles each round's result onto the running total (images into one batch, numbers into a list). If you try to join two things that don't fit (like an image and text), you get a friendly message instead of a cryptic error. Polished over several careful review passes. Works in both the classic and the new node interface.

### **June 20, 2026 · v1.3.99**
- **NEW: Load Video Pixaroma** - load a video and turn it into frames. Upload one from your computer or pick from a dropdown, and it plays right on the node so you can check it before running (click the picture to play or pause). You get the frames, the audio, and the details (frame count, fps, width, height, length) all at once, so you rarely need a separate info node. Cap how many frames to load (a safety valve for long clips), skip frames off the start, force a steady frame rate, or resize each frame (crop-to-fill an exact size, no stretching). Pairs with Save Mp4 - wire the frames and audio across to rebuild the video. Works in both the classic and the new node interface.
- **Save Mp4 improvements.** It now keeps every frame by default (the trim-to-audio option is off unless you turn it on), so a loaded video saves at its full length. Click anywhere on the preview to play or pause, not just the small button. And a video whose audio is a touch shorter than the picture (common with AI-generated clips) now saves cleanly instead of stopping with an error.

### **June 19, 2026 · v1.3.95-1.3.98**
- **Save Mp4 preview, much improved.** The video preview no longer jumps to a giant size when you run, so it stops covering your other nodes. It keeps whatever size you set and you can drag it bigger or smaller freely. It now has its own playback bar **under** the video that's always there: play / pause, a draggable timeline, the time, a **Download** button to save the mp4 straight to your computer, and a fullscreen button. The ffmpeg setup note in the help is also clearer for beginners and portable installs.
- **NEW: Set / Get Pixaroma** - wireless connections that keep your canvas clean. Wire anything (an image, a model, a number, a prompt) into a **Set** node and give it a name; then a **Get** node anywhere reads that same value with no cable running across the screen - just pick the name from a dropdown. The Set also has a passthrough output, so a node sitting nearby can wire to it directly while far ones use a Get. Colour a Set however you like and its Gets take the same colour, following along when you recolour it, so matching pairs stand out. Collapse them to almost nothing, and right-click to jump from a Get to its Set. They work inside subgraphs (a value you Set in the main graph can be read inside your subgraphs), show a tiny value preview for numbers and text, and behave exactly like a real wire when you run, so they never change your result. Works in both the classic and the new node interface.
- **NEW: Resize Crop Pixaroma** - a dead-simple crop-to-fill node. Set a width and height (type them or wire them in), and it scales your image to completely fill that size and trims the overflow from the center - so the result is always exactly the size you asked for, with no stretching or black bars. Smaller images scale up to fill, and an optional mask is cropped along with it. Great for forcing images or video frames to a fixed size like 512×896 or 704×1280.
- **NEW: Portrait Landscape Pixaroma** - flip a size between portrait (tall) and landscape (wide) with one click. Type your two numbers, tap **Portrait** or **Landscape**, and it arranges them into the orientation you picked (the order you type them never matters). One node replaces keeping two WH nodes and a switch just to flip orientation.
- **Tidier menu** - the Pixaroma nodes are now sorted into folders (Editors, Image, Resize & Crop, Prompt & Text, Notes & Overlay, Values, Logic & Flow) instead of one long list, so they're easier to find. Your existing workflows are unaffected.

### **June 17, 2026 · v1.3.93-1.3.94**
- **NEW: Seed Pixaroma** - a dedicated seed node you wire into KSampler (or any node with a seed input). Flip between **Random** (a fresh seed every run) and **Fixed** (the same seed for repeatable results), hit **New fixed random** to lock in a lucky roll, **Use last seed** to bring back the previous run's seed, or **Copy** to grab the number. One Seed node can feed several samplers so they all stay in sync. Works in both the classic and the new node interface.
- **Load Images from Folder - the "First" box now works as you type.** Type a number in the **First** box and it selects that many images right away (before, you had to click the First button for anything to happen). It also caps to how many images are in the folder, so if you ask for more than exist it just selects them all.

### **June 16, 2026 · v1.3.92**
- **NEW: Inpaint Crop + Inpaint Stitch Pixaroma** - the easy way to inpaint. Open the editor, paint over the part you want the AI to change, and the node automatically crops a clean, model-friendly piece around it; run it through your model, then Inpaint Stitch pastes the result back at the exact spot, blended so the seam disappears. The editor has **zoom** (scroll wheel) and **pan** (Space-drag) for fine detail, brush / erase / invert, an adjustable brush, and a live preview of how the edit will blend. Set how it blends back (softness, mask grow, mask vs whole-crop) on the node or in the editor; tweak the blend on the Stitch node afterwards without re-generating.
- **No more hard refresh after every update.** The plugin now tells the browser not to cache its files, so from now on plugin updates show up on a normal page reload. (Do **one** last hard refresh - Ctrl+Shift+R - right after this update to clear the old cache; after that, a normal reload is enough.)
- **Press `\` to open Node Colors.** With a node, several nodes, or a group selected, tap the **`\`** key to open the color palette (it's also labeled in the right-click menu now).

### **June 15, 2026 · v1.3.88-1.3.91**
- **NEW: Image Uncrop Pixaroma** - paste an edited or upscaled crop back onto the original image at the exact spot it came from, with a **feather** slider for a seamless blend.
- **Image Crop now carries transparency** - a new mask input/output plus a `crop_info` wire that feeds Image Uncrop. (Its width and height outputs moved down one spot, so reconnect those once if you used them.)
- **Image Uncrop now works with pasted/loaded crops too** - pasting or loading an image straight into Image Crop (no Load Image node) used to make Uncrop return just the cropped piece; now it rebuilds the full picture either way.
- **NEW: Load Images from Folder Pixaroma** - point it at any folder, pick images in a thumbnail gallery, and Run once to process each one (different sizes are fine). Outputs image, mask, size, filename, and index per image.
- **Preview Image:** mixed-size batches now fit each thumbnail to its own shape instead of stretching.
- **Housekeeping:** the Manager / registry star count and "last updated" date refresh correctly again.

### **June 10, 2026 · v1.3.84-1.3.87**
- **NEW: vertical text (top to bottom)** in Text Overlay, Composer text layers, and Text Watermark - a Horizontal / Vertical switch; Enter starts a new column.
- **NEW: a Restore brush for the Composer eraser** - flip Erase / Restore (or hold Alt, or press X) to paint the original image back; the brush ring turns orange in Restore mode.
- **NEW: a Help button on every node** - select a node and click the orange **?** in the toolbar for a plain-English panel (the small in-node ? buttons were removed to save space).
- **NEW: a Dynamic prompts switch on the Text node** (off by default) - turn it on and `{red|blue|green}` picks one at random each run.
- **NEW: image sizes on Image Compare** - each input shows its resolution, turning orange when the two don't match.
- **Text Pixaroma no longer strips curly braces** `{ }` - they stay exactly as typed, so JSON prompts survive.
- **Save names in any language work** - Korean, Japanese, accented letters, and spaces in the filename are kept as typed (also Save to Disk / Output and XY Plot).

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

## 📜 About, Feedback & License

> [!NOTE]
> This suite was developed with significant AI assistance. While thoroughly tested, we welcome bug reports and feedback from the community!

🏠 **Home:** ComfyUI-Pixaroma is developed on [GitLab](https://gitlab.com/pixaroma/comfyui-pixaroma) - the place for the latest code. Any copy hosted elsewhere (such as a GitHub mirror) is a backup.  
💡 **Have an idea for a new node or improvement?** Share it in the **#pixaroma-nodes** channel on [Discord](https://discord.gg/gggpkVgBf3).  
🐞 **Found a bug?** Open a work item (GitLab's name for an issue) on [GitLab](https://gitlab.com/pixaroma/comfyui-pixaroma/-/issues), or post in **#pixaroma-nodes** on [Discord](https://discord.gg/gggpkVgBf3).  
⚖️ **Licensed under [MIT](LICENSE)**

ComfyUI-Pixaroma is an independent, community-made extension. It is not affiliated with, endorsed by, or sponsored by Comfy Org or the ComfyUI project. Product names, logos, and trademarks are the property of their respective owners.
