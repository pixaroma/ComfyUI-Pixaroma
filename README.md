<div align="center">
  <img src="assets/pixaroma_logo.svg" width="110" alt="Pixaroma logo">
  <h1>ComfyUI Pixaroma</h1>
  <p><strong>Nodes and canvas tools that make ComfyUI easier to&nbsp;use.</strong></p>
  <p>Load, resize, preview and save images. Write and reuse&nbsp;prompts.<br>
  Switch parts of a workflow on and off, and explain it with&nbsp;notes.</p>
  <p>
    <a href="https://workflows.pixaroma.com/help/"><img src="assets/readme/btn-help.svg" height="36" alt="Help page"></a>
    <a href="#-install"><img src="assets/readme/btn-install-grey.svg" height="36" alt="Install"></a>
    <a href="#-all-nodes-at-a-glance"><img src="assets/readme/btn-nodes-grey.svg" height="36" alt="Nodes"></a>
    <a href="#-changelog"><img src="assets/readme/btn-changelog-grey.svg" height="36" alt="Changelog"></a>
    <a href="https://discord.gg/gggpkVgBf3"><img src="assets/readme/btn-discord-grey.svg" height="36" alt="Discord"></a>
  </p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License: MIT"></a>
    <a href="https://www.youtube.com/@pixaroma"><img src="https://img.shields.io/badge/YouTube-123K%20subscribers-FF0000?style=flat-square&logo=youtube&logoColor=white" alt="YouTube subscribers"></a>
    <a href="https://discord.gg/gggpkVgBf3"><img src="https://img.shields.io/badge/Discord-98K%20members-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord members"></a>
  </p>
</div>

---

## 📖 Need help? Start here

**[workflows.pixaroma.com/help](https://workflows.pixaroma.com/help/)** has short videos with a voice that show every step, the same steps written under each video, **[questions and answers](https://workflows.pixaroma.com/help/faq/)** you can search, and **[a page for every&nbsp;node](https://workflows.pixaroma.com/help/nodes/)**.

| I want&nbsp;to... | Open&nbsp;this |
|---|---|
| Install ComfyUI with the Pixaroma nodes&nbsp;(Windows) | [Install with&nbsp;Easy-Install](https://workflows.pixaroma.com/help/install-easy-install/) |
| Add the Pixaroma nodes to the ComfyUI I&nbsp;have | [Install with&nbsp;git](https://workflows.pixaroma.com/help/install-git/) |
| Update the Pixaroma&nbsp;nodes | [How to&nbsp;update](https://workflows.pixaroma.com/help/#update) |
| Fix empty nodes or missing buttons after an&nbsp;update | [The 5 second&nbsp;fix](https://workflows.pixaroma.com/help/refresh/) |
| Fix red "missing nodes" in a&nbsp;workflow | [Missing&nbsp;nodes](https://workflows.pixaroma.com/help/missing-nodes/) |
| Find a model file a workflow&nbsp;needs | [Missing&nbsp;models](https://workflows.pixaroma.com/help/missing-models/) |
| See which version I&nbsp;have | [Check your&nbsp;version](https://workflows.pixaroma.com/help/check-version/) |
| Read what a node does and how to use&nbsp;it | [Pixaroma&nbsp;nodes](https://workflows.pixaroma.com/help/nodes/) |
| Ask a question or report a&nbsp;bug | [Ask for&nbsp;help](https://workflows.pixaroma.com/help/report/) |

**Inside ComfyUI:** click the <img src="assets/readme/toolbar-help.svg" height="22" align="absmiddle" alt="?"> button in the top toolbar (or press **Alt+H**). It opens help for every Pixaroma node, with a search that reads the whole text, so you can type the problem ("buttons missing") instead of a node&nbsp;name.

**Questions, bugs and ideas** all go to **[#pixaroma-nodes on Discord](https://discord.com/channels/1245221993746399232/1513481633762775110)** ([join the server first](https://discord.gg/gggpkVgBf3), it is free). Issues and pull requests on GitLab and GitHub are closed, so everything lands in one place and gets an&nbsp;answer.

---

## 📥 Install

**ComfyUI Easy-Install (Windows):** the Pixaroma nodes are already included. [Watch how to install&nbsp;it](https://workflows.pixaroma.com/help/install-easy-install/).

**With git** (portable ComfyUI or your own install): open your `ComfyUI/custom_nodes` folder, type `cmd` in the address bar, and&nbsp;run:

```bash
git clone https://gitlab.com/pixaroma/comfyui-pixaroma.git
```

Then restart ComfyUI and press **Ctrl+Shift+R** in the&nbsp;browser.

**ComfyUI Manager:** searching for Pixaroma works, but the Manager only offers the old version **1.4.144**. The Comfy Registry marked the newer versions as "flagged" with no reason given. The nodes are safe. To get the newest version, use Easy-Install or git, or switch Pixaroma to **nightly** in the Manager. [Read&nbsp;more](https://workflows.pixaroma.com/help/flagged/).

## 🔄 Update

- **Easy-Install:** close ComfyUI, open the EZi Launcher and press **Easy-Install** under UPDATE.&nbsp;[Video](https://workflows.pixaroma.com/help/update-easy-install/)
- **git:** open the `ComfyUI-Pixaroma` folder inside `custom_nodes`, type `cmd` in the address bar, and run `git pull`.&nbsp;[Video](https://workflows.pixaroma.com/help/update-git/)
- **After every update:** restart ComfyUI, then press **Ctrl+Shift+R** once in the browser (**Cmd+Shift+R** on a Mac). Without it, the browser can keep showing the old version of the nodes.&nbsp;[Why](https://workflows.pixaroma.com/help/refresh/)
- **Which version do I have?** Click the <img src="assets/readme/toolbar-help.svg" height="22" align="absmiddle" alt="?"> button in the top toolbar: your version is in the bottom right corner of the Help window. Or add the **Version Check Pixaroma**&nbsp;node.

## 🔍 Find the nodes

Double-click an empty spot on the canvas and type **Pixaroma**: every Pixaroma node shows up. You can also open the **Node Library** on the left and the **👑 Pixaroma** folder, where the nodes are sorted into the groups&nbsp;below.

---

## 🧩 All nodes at a glance

The groups are in order of how much they are used in real workflows, and inside each group the most used node comes first. Click a name for its full help on the website: what it does, how to use it, and every input and&nbsp;setting.

### 🖼️ Image

| Node | What it&nbsp;does |
|---|---|
| [Preview&nbsp;Image&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/preview-image/) | Shows your images on the node, one or a whole batch, with Save, Copy and Open&nbsp;buttons. |
| [Load&nbsp;Image&nbsp;Mini&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/load-image-mini/) | A small Load Image: a picker, a preview and two outputs. Resize lives in the&nbsp;gear. |
| [Image&nbsp;Info&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/image-info/) | Unpacks Load Image Mini's `image_info` into the mask, width, height and file&nbsp;name. |
| [Image&nbsp;Compare&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/image-compare/) | Compare two images with a slider, side by side, or see exactly what&nbsp;changed. |
| [Load&nbsp;Images&nbsp;from&nbsp;Folder&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/load-images-from-folder/) | Runs your workflow once for each picture in any folder you&nbsp;choose. |
| [Save&nbsp;Image&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/save-image/) | Saves to any folder, with a live preview of the exact file&nbsp;name. |
| [Save&nbsp;Mp4&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/save-mp4/) | Turns frames and sound into an mp4 and plays it on the&nbsp;node. |
| [Remove&nbsp;Background&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/remove-background/) | Cuts out the subject with a BiRefNet model: cutout, mask and inverted mask in one&nbsp;node. |
| [Load&nbsp;Image&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/load-image/) | Load Image with resize built in: max megapixels, longest side, fit inside, crop to fill and&nbsp;more. |
| [Image&nbsp;Grid&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/image-grid/) | Puts every picture of a Run in one grid image, with each file name under its&nbsp;picture. |
| [Save&nbsp;3D&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/save-3d/) | Shows a 3D model, stands it on the ground, and saves it as OBJ, GLB or&nbsp;STL. |
| [Load&nbsp;Video&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/load-video/) | Loads a video as frames, sound and info, and plays it on the&nbsp;node. |
| [Pause&nbsp;Image&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/pause-image/) | Stops the Run so you can look at the picture before the slow part&nbsp;runs. |
| [Load&nbsp;3D&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/load-3d/) | Loads a 3D model and gives you the model and a picture of&nbsp;it. |
| [Load&nbsp;Video&nbsp;Frame&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/load-video-frame/) | Picks one exact frame from a video to use as an&nbsp;image. |
| [First&nbsp;Last&nbsp;Frame&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/first-last-frame/) | Takes the first and the last frame of a video as two&nbsp;images. |
| [Save&nbsp;Video&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/save-video/) | Saves an mp4 to any folder with your own file name, and plays it on the&nbsp;node. |

### 💬 Prompt and Text

| Node | What it&nbsp;does |
|---|---|
| [Prompt&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/prompt/) | A prompt box with saved shortcuts (`@tags`), random picks and&nbsp;lists. |
| [Show&nbsp;Text&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/show-text/) | Shows any text or value going through a wire, in a box you can copy&nbsp;from. |
| [Text&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/text/) | A big text box with one text output. Type once, wire it into many&nbsp;nodes. |
| [Text&nbsp;Join&nbsp;Two,&nbsp;Three&nbsp;and&nbsp;Four&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/text-join-two/) | Joins two, three or four pieces of text into one. Type or wire each&nbsp;one. |
| [AI&nbsp;Prompt&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/ai-prompt/) | Runs a language model on your own PC with an instruction you save on the&nbsp;node. |
| [Prompt&nbsp;Each&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/prompt-each/) | Many prompts, one Run, one picture&nbsp;each. |
| [Prompt&nbsp;Multi&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/prompt-multi/) | Queues one Run per prompt, or sends all the prompts out as a&nbsp;list. |
| [Prompt&nbsp;From&nbsp;List&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/prompt-from-list/) | Picks one prompt by number from a Prompt Multi&nbsp;list. |
| [Prompt&nbsp;Pack&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/prompt-pack/) | Paste a block of prompts and queue one Run per&nbsp;prompt. |
| [Save&nbsp;Text&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/save-text/) | Collects the text of every Run into one list and a .txt&nbsp;file. |
| [Prompt&nbsp;Reader&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/prompt-reader/) | Reads the prompt saved inside a ComfyUI, Automatic1111 or Civitai&nbsp;picture. |
| [Prompt&nbsp;Stack&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/prompt-stack/) | Builds one prompt from rows you switch on and&nbsp;off. |
| [Video&nbsp;Prompt&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/video-prompt/) | Writes a MiniMax H3 video prompt on your own&nbsp;PC. |
| [Find&nbsp;and&nbsp;Replace&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/find-and-replace/) | Changes words in a text on its way through a&nbsp;wire. |
| [Load&nbsp;Texts&nbsp;from&nbsp;Folder&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/load-texts-from-folder/) | Sends the .txt files of a folder through the workflow one by&nbsp;one. |
| [Pause&nbsp;Text&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/pause-text/) | Stops the Run so you can read and fix a text before the rest&nbsp;runs. |
| [Caption&nbsp;Review&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/caption-review/) | Every picture of a folder with its caption under it, to read and fix a training&nbsp;set. |
| [Music&nbsp;Prompt&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/music-prompt/) | One idea in, a caption and lyrics out for MiniMax Music&nbsp;3. |
| [Layout&nbsp;Boxes&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/layout-boxes/) | Draw boxes where things go and write what goes in each, for FLUX.3 layout&nbsp;prompts. |

### 📝 Notes and Overlay

| Node | What it&nbsp;does |
|---|---|
| [Label&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/label/) | A text caption on the canvas to name parts of your workflow. No wires, it never&nbsp;runs. |
| [Note&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/note/) | A note with headings, lists, tables, icons, and Download or YouTube&nbsp;buttons. |
| [Info&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/info/) | A small button that opens a note in a reading window, so big notes do not fill the&nbsp;canvas. |
| [Text&nbsp;Watermark&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/text-watermark/) | Stamps text in the same spot on every image of a batch, all set up on the&nbsp;node. |
| [Text&nbsp;Overlay&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/text-overlay/) | Puts styled text on an image, with a full screen editor to place&nbsp;it. |

### 🔢 Values

| Node | What it&nbsp;does |
|---|---|
| [Seed&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/seed/) | A seed for your samplers: Random or Fixed, and one click to keep a good&nbsp;result. |
| [Sizes&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/sizes/) | Your own list of favourite sizes, with a Portrait or Landscape&nbsp;flip. |
| [Resolution&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/resolution/) | Pick a ratio (1:1, 16:9 and more) and get a width and height that suit AI&nbsp;models. |
| [Dropdown&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/dropdown/) | A dropdown you fill in yourself: pick a short name, send a long&nbsp;value. |
| [Duration&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/duration/) | Type a length in seconds, get the frame count your video model&nbsp;wants. |
| [Number&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/number/) | One number field that sends the same value as a whole number and as a&nbsp;decimal. |
| [Control&nbsp;Panel&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/control-panel/) | Sliders, switches and dropdowns for settings all over your workflow, in one&nbsp;node. |
| [Portrait&nbsp;Landscape&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/portrait-landscape/) | Flips a width and height between tall and wide with one&nbsp;click. |
| [WH&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/wh/) | Two number fields: width and&nbsp;height. |
| [Number&nbsp;Pick&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/number-pick/) | One number, picked from a row of buttons you choose&nbsp;yourself. |

### 🔀 Logic and Flow

| Node | What it&nbsp;does |
|---|---|
| [Run&nbsp;Timer&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/run-timer/) | Times the whole Run and plays a chime when it is done. No wires&nbsp;needed. |
| [Free&nbsp;VRAM&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/free-vram/) | Frees the graphics card's memory at the exact point you&nbsp;choose. |
| [Loop&nbsp;Start&nbsp;and&nbsp;Loop&nbsp;End&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/loop-start/) | Repeats part of a workflow a set number of&nbsp;times. |
| [Combine&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/combine/) | Joins two inputs into one batch: images, frames, latents, numbers or&nbsp;text. |
| [Switch&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/switch/) | Many inputs, one output: click a row to choose which one goes&nbsp;through. |
| [Mute&nbsp;Switch&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/mute-switch/) | Switches to turn whole parts of a workflow on and&nbsp;off. |
| [Monitor&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/monitor/) | A live readout of how hard your computer is&nbsp;working. |
| [XY&nbsp;Plot&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/xy-plot/) | Compares settings side by side in one labeled grid, with no extra&nbsp;wiring. |
| [Set&nbsp;and&nbsp;Get&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/set/) | Sends a value across the canvas with no cable: Set stores it under a name, Get reads&nbsp;it. |
| [Notify&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/notify/) | Plays a sound when the Run reaches this node, and times how long it took to get&nbsp;there. |
| [Switch&nbsp;WH&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/switch-wh/) | Chooses between two width and height pairs with one&nbsp;click. |
| [Switch&nbsp;Source&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/switch-source/) | Flips a whole set of wires between setup A and setup&nbsp;B. |
| [Group&nbsp;Switch&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/group-switch/) | On and off switches for your groups, in one small&nbsp;panel. |
| [Text&nbsp;Match&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/text-match/) | Does a text contain one of your words? Yes or no, plus gates that let things through only on a&nbsp;match. |
| [Version&nbsp;Check&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/version-check/) | Shows your Pixaroma, ComfyUI and frontend versions, with a Copy&nbsp;button. |
| [Run&nbsp;Log&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/run-log/) | Keeps the last 10 Run times of this workflow on the&nbsp;canvas. |

### ✂️ Resize and Crop

| Node | What it&nbsp;does |
|---|---|
| [Resize&nbsp;Crop&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/resize-crop/) | Makes an image an exact width and height by cropping, never&nbsp;stretching. |
| [Longest&nbsp;Side&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/longest-side/) | Makes a picture's longest side the size you click, and can crop it to a&nbsp;shape. |
| [Image&nbsp;Crop&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/image-crop/) | Draw the crop box on the image, no pixel numbers to&nbsp;type. |
| [Image&nbsp;Uncrop&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/image-uncrop/) | Puts an edited crop back onto the original, in the exact spot it came&nbsp;from. |
| [Inpaint&nbsp;Crop&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/inpaint-crop/) | Paint a mask and get a crop sized for the model, ready to&nbsp;inpaint. |
| [Inpaint&nbsp;Stitch&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/inpaint-stitch/) | Puts the inpainted crop back onto the original so the seam does not&nbsp;show. |
| [Outpaint&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/outpaint/) | Adds space around an image so a model can paint new scenery&nbsp;there. |
| [Outpaint&nbsp;Stitch&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/outpaint-stitch/) | Puts your sharp original back onto the outpaint result, keeping only the new&nbsp;area. |
| [Image&nbsp;Resize&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/image-resize/) | Resizes an image and its mask, with many modes including&nbsp;Pad. |

### 🧰 Utility

| Node | What it&nbsp;does |
|---|---|
| [LoRA&nbsp;Loader&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/lora-loader/) | Many LoRAs in one node, with trigger words read from each&nbsp;file. |
| [Krea&nbsp;LoRA&nbsp;Converter&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/krea-lora-converter/) | Makes a Krea 2 LoRA trained on fal.ai load in&nbsp;ComfyUI. |
| [Krea2&nbsp;Enhancer&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/krea2-enhancer/) | Makes a Krea 2 model follow your prompt more&nbsp;closely. |

### 🎨 Editors

| Node | What it&nbsp;does |
|---|---|
| [Paint&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/paint/) | A painting editor with layers, brushes and a smudge&nbsp;tool. |
| [3D&nbsp;Builder&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/3d-builder/) | Build, light and render a 3D scene inside&nbsp;ComfyUI. |
| [Image&nbsp;Composer&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/image-composer/) | Arrange, blend and adjust many images on one canvas, in&nbsp;layers. |
| [Sketch&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/sketch/) | Mark what to change on a picture and write the change beside it, for edit&nbsp;models. |
| [AudioReact&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/audioreact/) | Turns a still image into a video that moves with the&nbsp;music. |

### 🎵 Audio

| Node | What it&nbsp;does |
|---|---|
| [Load&nbsp;Audio&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/load-audio/) | Shows a sound file's shape so you can take just the part you&nbsp;want. |
| [H3&nbsp;Audio&nbsp;Sync&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/h3-audio-sync/) | Makes a MiniMax H3 video sing your song instead of one it makes&nbsp;up. |
| [H3&nbsp;Timeline&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/h3-timeline/) | Tells one long MiniMax H3 video as scenes, each with its own words and, if needed, a&nbsp;picture. |
| [H3&nbsp;Long&nbsp;Video&nbsp;Pixaroma](https://workflows.pixaroma.com/help/nodes/h3-long-video/) | Makes one MiniMax H3 video longer than 15 seconds, in one run with no&nbsp;cuts. |

### 🖱️ Canvas tools (no node needed)

| Tool | What it&nbsp;does |
|---|---|
| [Workflows&nbsp;panel](https://workflows.pixaroma.com/help/nodes/workflows-panel/) | <img src="assets/readme/toolbar-workflows.svg" height="22" align="absmiddle" alt="W"> in the top toolbar (or **Alt+W**): find, open and organise your workflow files, with a picture of&nbsp;each. |
| [Help&nbsp;window](https://workflows.pixaroma.com/help/faq/#q-help-window) | <img src="assets/readme/toolbar-help.svg" height="22" align="absmiddle" alt="?"> in the top toolbar (or **Alt+H**): help for every node, with&nbsp;search. |
| [Align](https://workflows.pixaroma.com/help/nodes/align/) | <img src="assets/readme/toolbar-align.svg" height="22" align="absmiddle" alt="Align"> in the top toolbar: nodes snap into line as you drag them, with a guide&nbsp;line. |
| [Pixaroma&nbsp;Group](https://workflows.pixaroma.com/help/nodes/pixaroma-group/) | A group box with Run, Mute, Bypass and Fold buttons in its&nbsp;header. |
| [Node&nbsp;Colors](https://workflows.pixaroma.com/help/nodes/node-colors/) | Right-click a node or group to recolour it, with favourites and copy and&nbsp;paste. |
| [Adaptive&nbsp;node&nbsp;titles](https://workflows.pixaroma.com/help/nodes/adaptive-node-titles/) | Title text turns white or dark by itself, so it stays readable on any&nbsp;colour. |
| [Connection&nbsp;FX](https://workflows.pixaroma.com/help/nodes/connection-fx/) | Slots that fit glow while you drag a wire. Off until you turn it&nbsp;on. |
| [Run&nbsp;button&nbsp;effects](https://workflows.pixaroma.com/help/nodes/run-button-effects/) | Optional effects on ComfyUI's Run&nbsp;button. |
| [Your own&nbsp;fonts](https://workflows.pixaroma.com/help/faq/#q-fonts) | Put .ttf or .otf files in `ComfyUI/models/fonts` and Text Overlay and Text Watermark can use&nbsp;them. |

---

## ✂️ Background removal models

**Remove Background Pixaroma** and the AI background buttons in **Image Composer** and **Paint** use a BiRefNet model. Put one of these files in&nbsp;`ComfyUI/models/background_removal/`:

| Model | File&nbsp;name | VRAM | Best&nbsp;for |
|---|---|---|---|
| Standard | `birefnet.safetensors` (424&nbsp;MB) | 4 to 6&nbsp;GB | Objects, products, logos. Fast.&nbsp;[Download](https://huggingface.co/Comfy-Org/BiRefNet/tree/main/background_removal) |
| High&nbsp;Resolution | `birefnet-hr.safetensors` (444&nbsp;MB) | 8&nbsp;GB+ | Big images with fine edges.&nbsp;[Download](https://huggingface.co/ZhengPeng7/BiRefNet_HR) |
| Matting | `birefnet-matting.safetensors` (444&nbsp;MB) | 8&nbsp;GB+ | Hair, fur, lace, soft fabric.&nbsp;[Download](https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting) |

**Rename the HR and Matting files after you download them.** They arrive as `model.safetensors`; rename them exactly as in the table, because the name tells Pixaroma which size to work at. [FAQ: which model](https://workflows.pixaroma.com/help/faq/#q-bg-models) · [FAQ: HR or Matting not&nbsp;working](https://workflows.pixaroma.com/help/faq/#q-bg-rename)

The two editors can also use **rembg** (`pip install rembg`, then restart ComfyUI). The node does not need it. [FAQ: do I need&nbsp;rembg?](https://workflows.pixaroma.com/help/faq/#q-rembg-needed)

---

## 📺 Learn more

- **[Pixaroma on YouTube](https://www.youtube.com/@pixaroma)**: a free ComfyUI course, with a new episode almost every&nbsp;week.
- **[workflows.pixaroma.com](https://workflows.pixaroma.com/)**: the workflows from every episode, free to&nbsp;download.
- **[Help page](https://workflows.pixaroma.com/help/)**: install, update, and fixes for the usual&nbsp;problems.

---

## 🛠 Changelog

### **October 24, 2026 · v1.4.231**
- **Load Image, Load Image Mini and Prompt Reader:** once you pick a picture, ComfyUI's "Missing Inputs" warning about the workflow's missing picture goes away.
- **Info:** Esc closes a ComfyUI dialog opened over the Info window, not the Info window under it.

### **October 23, 2026 · v1.4.230**
- **NEW: Krea2 Enhancer Pixaroma.** Makes a Krea 2 model follow your prompt more closely. It gives the same pictures as the Krea2T Enhancer, which its author removed, so our Krea 2 workflows work again.
- **H3 Timeline:** each scene can start with a clean cut, Keep holds the scenes you like while you redo the others, and a shorter Window fits bigger sizes in memory.
- **Spell check:** Pixaroma text boxes follow ComfyUI's own spell check setting.
- **Run button effects:** the arrow next to Run turns orange too on newer ComfyUI, and Run stays orange after Run (Instant).

### **October 22, 2026 · v1.4.229**
- **NEW: H3 Timeline Pixaroma.** Tell one long MiniMax H3 video as scenes, each with its own length, words and, if needed, a picture: a new look, or a person who walks in. One run, no cuts, tested up to 60 seconds.
- **NEW: H3 Long Video Pixaroma.** One MiniMax H3 video longer than 15 seconds, made in one run with no cuts.
- **Text size:** the text boxes of the text and prompt nodes follow ComfyUI's text size setting, and each node can have its own size from the right-click menu.

### **October 21, 2026 · v1.4.227-v1.4.228**
- **AI Prompt has two MOSS-Image presets:** one turns a short idea into a detailed caption, the other writes the caption that makes a picture again.
- **AI Prompt, Music Prompt and Video Prompt work on more graphics cards:** when ComfyUI's fast text writing stops with "Unsupported Flash Attention tensor strides", they write the text the regular way instead.

### **October 20, 2026 · v1.4.225-v1.4.226**
- **Load Video loads phone videos the right way up:** a clip filmed upright on a phone no longer comes out turned sideways and cropped.
- **Drop a video file on Load Video to load it,** like a picture on Load Image. It used to make a second video node instead.
- **Group Switch keeps the size you drag it to,** through switch flips, tab changes and reopening the workflow.
- **Sizes and Resolution help explains a twice-as-big picture:** some other packs' samplers skip the step that fits the latent to Flux 2 and Qwen Image 2.1.

### **October 18, 2026 · v1.4.223-v1.4.224**
- **Civitai info keeps the seed in Flux 2 and FLUX 3 workflows:** a seed, steps or CFG wired into the sampler's side nodes now reach Civitai.
- **AI Prompt, Music Prompt and Video Prompt get a Faster writing (MTP) switch** in the gear. Turn it off if a Qwen3.5 model crashes with a CUDA error.
- **Workflows panel sorts numbers as numbers:** Sort by Name puts 2 before 10 and keeps each folder's workflows together, and the Sort button always names the order shown.

### **October 17, 2026 · v1.4.221-v1.4.222**
- **Resolution and Sizes get a batch box beside the latent output:** one Run makes 1 to 64 pictures.
- **Control Panel dropdowns show long model names on a wider node,** instead of always cutting them after a few words.

### **October 16, 2026 · v1.4.216-v1.4.220**
- **New node, Layout Boxes Pixaroma:** draw where things go for FLUX.3 layout prompts, in Classic and Nodes 2.0.
- **Switch, Mute Switch, Text Join and Outpaint Stitch keep their wired rows** in Nodes 2.0 on ComfyUI 0.40 and newer.
- **AI Prompt can send the formula as a system message,** plus a FLUX 3 prompt upsampler preset.
- **Control Panel dropdowns take the new model list when you press R,** also through Set and Get.
- **Open buttons no longer say "Popup blocked"** on Save Image, Preview Image and Pause Image.
- **Find and Replace, Prompt Multi and Prompt Stack** no longer grow or open as modified.
- **Dialogs stay open when a drag ends outside them;** dragged panels no longer stick to the mouse.
- **Text Join and XY Plot text boxes get Copy and Paste on right-click;** Pixaroma Group draws links through reroutes.

### **October 15, 2026 · v1.4.215**
- **Video Prompt: Reset, Import and the seed box work on ComfyUI Desktop,** and Ctrl+Z in its editor no longer undoes the workflow.
- **Copy (Clipspace) from Prompt Reader, Save Image or Save Video no longer breaks the next paste.**
- **Scrub bars stop following the mouse** after a release outside the window.
- **Image Uncrop masks keep their shape; Crop and Composer show subfolder pictures; Ctrl+S works in more fields.**

### **October 13, 2026 · v1.4.213-v1.4.214**
- **Load Images from Folder: a new folder starts with every picture picked,** so Browse then Run does the whole folder. Use Pick images to choose fewer.
- **Sizes and Resolution: a new latent output** for the KSampler, the same as Empty Latent Image, so you can skip that node. Resolution's spacing now matches Sizes.
- **Ctrl+S and Ctrl+Enter now work while typing** in node fields and settings panels across the pack (they opened the browser's Save page or did nothing).
- **Resolution:** a shared workflow can no longer run code through a saved size, and Custom Ratio keeps your ratio at the size limits.
- **Control Panel: a Random seed stays Random** when you open its number and change nothing.

### **October 12, 2026 · v1.4.210-v1.4.212**
- **Preview Image and Image Compare: a Run that ends while another workflow tab is open** now shows up when you switch back, and never lands on the other tab.
- **The same fix for every other node that shows a result** (Show Text, Pause Text, Save Text, Save Image, AI Prompt, Notify and 20 more): the other tab's nodes are never touched.
- **AudioReact: the editor preview turns the same way as the saved video** for Swirl, Rotate Pulse, Drift, Slit Scan, Wave and Tilt.
- **A new, shorter README:** every node in one line, grouped in order of use, each linking to its own help page on the website.
- **Help window: Load Audio and H3 Audio Sync** now sit in their own Audio group with its music icon, not last with a box icon.

### **October 11, 2026 · v1.4.209**
- **Load Images from Folder: clearer help for Skip pictures already done.** Use it to do a big folder in parts. A stopped Run has saved nothing yet.

### **October 10, 2026 · v1.4.208**
- **Load Images from Folder: when every picture is already done,** the Run now stops quietly with a short notice instead of a red error box.

### **October 9, 2026 · v1.4.207**
- **Help window: a Latest version button beside your version,** opening workflows.pixaroma.com/latest with the newest version and what is new.
- **Node titles stay readable in the light theme,** and in Nodes 2.0 the Show advanced inputs text and nodes inside subgraphs follow the node colour too.
- **Load Images from Folder: a folder problem shows on the Pick button,** and the folder not approved message reads as clear steps.

### **October 8, 2026 · v1.4.203-v1.4.206**
- **AI Prompt and Music Prompt no longer crash ComfyUI on a list** (a folder or Prompt Each): each item gets its own text.
- **Save Text: new "One file per entry" switch and name input,** so every picture gets its own .txt with the same name, ready as training captions.
- **Load Images from Folder: new path output, and Prompt Reader reads it,** so one Run reads the prompts saved in every picture of a folder.
- **NEW: Image Grid,** every picture of a folder Run in one grid, with names and an optional before row.
- **NEW: Text Match,** a yes or no from your words, with gates that filter a whole folder with an AI.
- **NEW: Load Texts from Folder and Caption Review:** read a folder of .txt captions, and fix them in one window.
- **Load Images from Folder can skip pictures already done,** so a big folder carries on where it stopped.
- **Fixed: right-click a paused video for its menu again; Load Video's sound follows Skip first frames; Image Grid cells fit wide pictures.**

### **October 6, 2026 · v1.4.199-v1.4.202**
- **Save Image and Preview Image: Civitai shows your prompt, settings and model again** with "Add Civitai generation info" on. Save images again before uploading.
- **Civitai info also reads prompts built with String Concatenate and LoRAs from Power Lora Loader (rgthree),** and keeps LoRAs with non-Latin names.
- **Prompt Reader now reads the prompt from JPG and WebP images,** including Civitai downloads and Save Image's own JPG and WebP files.
- **Save Mp4 and Save Video: new "Add Civitai generation info" switch,** so Civitai shows the prompt and settings of your videos. Values from Dropdown Pixaroma are read too.
- **Prompt Reader no longer shows the negative prompt as the prompt** when an image has none, and Civitai info keeps the space between joined texts.

### **October 5, 2026 · v1.4.197-v1.4.198**
- **Text Overlay and Text Watermark no longer scramble pictures from Qwen Image 2.1 and Ming Image;** transparent pictures stay transparent, with the text on top.
- **Control Panel: the Show options list fits long names and has a filter box,** and All or None apply to the matching names.
- **Monitor's help explains why its VRAM number is lower than Crystools or Task Manager.**
- **Newer ComfyUI: workflows no longer show as changed** right after opening them with Text Join, Sliders, Dropdown, Switch, Outpaint Stitch or Load 3D nodes.
- **Newer ComfyUI, Nodes 2.0: Ctrl+Z no longer gets stuck** after adding Paint, 3D Builder, Image Composer, Crop, Text Overlay, Notify or 9 other nodes.

### **October 4, 2026 · v1.4.193-v1.4.196**
- **Pixaroma loads even when a launcher saves ComfyUI's console output to a file;** its startup message could stop every node from loading.
- **Ctrl+Z no longer gets stuck after you add one of 14 nodes,** including Paint, 3D Builder, Image Composer, Prompt and Inpaint Crop.
- **Seed no longer marks a workflow as changed** on open, and Ctrl+Z works with it in Nodes 2.0.
- **Nodes 2.0: Run Timer, Monitor, Info and Label keep their size** on open and Ctrl+Z, so undo works again.
- **The button colour you pick reaches every part** of Image Resize and the image loaders, lists and gallery included.
- **Nodes 2.0: Align snaps collapsed and title-less nodes** to the edges you see.
- **Mute Switch shows its "out" label** right after switching to Nodes 2.0.
- **Workflows panel: Alt+W closes it even with a question open,** and a right-click no longer cancels it.
- **Help and node descriptions call on/off controls switches and buttons.**

### **October 3, 2026 · v1.4.188-v1.4.192**
- **Save Image: Save now** writes a Preview run's pictures to your folder without running again.
- **Nodes 2.0: the wheel scrolls long prompts** when "Scroll the field" is set.
- **Save Image's Civitai info now includes your prompt** from Pixaroma prompt nodes.
- **Prompt boxes:** Ctrl+S saves the workflow, and Replace no longer sends hidden line breaks.
- **Fixed: Image Compare's Overlay opacity follows the mouse wheel again.**
- **Image Crop: Pixaroma dropdowns** for Ratio and Alignment, with full names.
- **Help search finds Image Resize for "upscale" again,** and icon-only buttons have names for screen readers.
- **Ready for newer ComfyUI:** renderer switches and removed rows no longer leave stale data behind.
- **Load Image and Load Image Mini open at the same height every time,** and saved workflows no longer reopen taller.
- **Workflows panel: an open question box now blocks the panel behind it,** and only one can be open.

### **October 2, 2026 · v1.4.185-v1.4.187**
- **AI Prompt and Music Prompt: saving remembers the preset you edited.** Its name is filled in, so pressing Enter updates it. An edited built-in one is offered as "(mine)". Music Prompt now also asks before replacing another set with the same name.
- **Info: Delete.** Right-click a button and choose Delete, or press Delete in its reading window, which asks first. Ctrl+Z brings it back.
- **Prompt Each: the prompt boxes fit their text again** when a workflow opens and when you make the node wider, with no scrollbar.
- **Fixed: in Nodes 2.0, after Ctrl+Z Pixaroma nodes kept their old controls,** so what you typed was lost and Info buttons went blank.

### **October 1, 2026 · v1.4.183-v1.4.184**
- **NEW: Info Pixaroma.** A small button on the canvas that opens a note to read. Pick a title, icon and colour, or start from Read me, Download Models, Run Times and more. Also in the canvas right-click menu, under Add Label.
- **AI Prompt: two Ming Image presets** that turn a short idea into the layout prompt Ming Image 0.1 reads best, written by Qwen3.8 27B or Qwen3.5 9B.
- **Note: lists no longer leave an empty gap above them**, and the Code view no longer adds stray empty lines.
- **Fixed: in Nodes 2.0, Align moved the selected node** when you dragged the sidebar or a floating window, or selected text in another node.
- **Help: hidden storage fields are no longer listed as settings** on the Note, Label and Info pages.

### **September 30, 2026 · v1.4.182**
- **Resize Crop: sharper when it enlarges a picture.** It now uses lanczos both ways, the same as ComfyUI's own resize.
- **Fixed: a "Pixaroma" badge floating above Label, Run Timer and Monitor** after the latest ComfyUI update.

### **September 29, 2026 · v1.4.177-v1.4.181**
- **Load Image and Load Image Mini: pictures from your own folders** (`+ Folder` in the picker), refreshed from the original at each Run. Load Image also gets a settings gear.
- **AI Prompt: several pictures at once.** Wiring a picture adds a slot for another, up to 8, each seen at its own size.
- **Paint: "Canvas size from added image".** Turn it on under Add Image and every picture you add sets the canvas to its size.
- **Fixed: Inpaint Crop behind an Image Composer showed the picture going into the Composer**, so the mask was painted on the wrong image.
- **Fixed: Ctrl+V pasted nothing while a Load Image or Load Image Mini was selected**, not even copied nodes. Pasting a picture no longer asks Firefox for permission each time.
- **Save Image: a JPG keeps the prompt** when the workflow is too big to fit inside it.
- **Save Image and Save Video: "Will save as" shows ‹wired name›** when the name is only made during the run, instead of a wrong name.

### **September 28, 2026 · v1.4.176**
- **AI Prompt's "Qwen Image 2.1 - prompt from an idea" preset now writes real selfies**, not photos of someone holding up a phone. Load the preset again to get it.

### **September 27, 2026 · v1.4.170-v1.4.175**
- **New: Sketch Pixaroma.** Mark a picture with boxes, circles, arrows or words and a note each; edit models like Flux 2 Klein get the marked picture and a ready prompt.
- **Fixed: Set and Get Pixaroma broke after refreshing nodes (R)** until a page reload. Affected workflows repair themselves, and both are back in the Add Node menu.
- **Fixed: all Pixaroma nodes showed up empty** when ComfyUI runs under a web address folder (a reverse proxy like `yoursite.com/comfyui/`).
- **Plus fixes:** Inter Bold now comes out bold in Text Overlay and Watermark; Align no longer shrinks a node below its content; XY Plot, Load Images from Folder, Image Resize and Notify keep their size; Civitai info no longer writes the positive prompt as the negative.

### **September 26, 2026 · v1.4.163-v1.4.169**
- **Run Timer, Run Log and Monitor Pixaroma no longer slow your renders.** Run Timer with 2 or 3 decimals had cost 6-9%; its final time stays exact.
- **Faster renders in Nodes 2.0 with Compare, Preview Image, Outpaint, Load 3D, Save 3D or a video node (Load Video, Load Video Frame, Save Mp4, Save Video) on screen.** Their previews show a still picture while nothing moves. Load Audio, Image Resize and Load Image Mini do the same.
- **Fixed: copied Run Timers, Monitors and Image Composers kept working unseen**, even after the node was deleted.
- **17 nodes now follow switching Nodes 2.0 on or off** without a reload, instead of showing empty, doubled or missing parts, or dots that would not take a wire.
- **Fixed: nodes left inside a subgraph kept acting after a tab switch**, disturbing another workflow's nodes or downloading a picture again after every run.

### **September 24, 2026 · v1.4.162**
- **New: four Qwen Image 2.1 presets for AI Prompt Pixaroma**: a prompt from an idea, a transparent picture, a prompt from an image, and an edit instruction.
- **Fixed: Inpaint Stitch Pixaroma pasted a grey patch** when the model returned a picture with transparency, as Qwen Image 2.1 does. It pastes clean colours now.

### **September 22, 2026 · v1.4.159-v1.4.161**
- **Fixed: Music Prompt Pixaroma closed ComfyUI part way through a run**, on ComfyUI 0.37.0. It writes the caption and the lyrics again.
- **Fixed: in Prompt Pixaroma the cursor could sit away from the words you typed**, further out the longer the prompt. The box now follows your theme's font exactly.
- **A file name can end with `_` again.** Type `name_%counter%_` in Save Image Pixaroma and you get `name_001_.png`, so you can add your own words after the number.

### **September 21, 2026 · v1.4.158**
- **Fixed: the prompt and text nodes used the wrong look for your theme:** white on a dark one, dark on a light one. A new **Node look** setting can force either.
- **Fixed: Load Audio Pixaroma's file list ran off the screen.** It scrolls now.
- **Group Switch Pixaroma no longer slows things down while on screen.**
- **Inpaint Crop Pixaroma follows a Switch**, and stops showing a picture that is no longer wired in.

### **September 18, 2026 · v1.4.154-v1.4.157**
- **New node: Number Pick Pixaroma.** One number, picked from buttons you choose yourself. It sends a whole number or a decimal to suit whatever you wire it to.
- **Volume on the video players.** A speaker on Save Mp4 and Save Video Pixaroma. The level you set is remembered by every Pixaroma video node.
- **Save Mp4 Pixaroma takes a whole video, not only frames**, and it now shows the video size on the node, as does Load Video Pixaroma.
- **Group Switch Pixaroma: an arrow on each row** jumps the canvas to that group.
- **Fixed: Inpaint Crop Pixaroma was blank** when a Switch or a Reroute sat between it and the picture.
- **Fixed: Prompt Reader Pixaroma could open a little short** in a big workflow.

### **September 17, 2026 · v1.4.152-v1.4.153**
- **Fixed: middle-mouse drag did not move the canvas over a node's picture or text box.** Now it does, over 3D views too.
- **Fixed: LoRA Loader forgot your trigger words when a LoRA was moved to another folder.** Pick the moved file again and they come back.
- **Fixed: Ctrl+Up / Ctrl+Down did not change a word's weight** in Pixaroma prompt boxes.
- **Fixed: in ComfyUI's light theme, the prompt and text nodes had invisible buttons and black text boxes.**
- **Fixed: Save 3D views could stay on "Loading ..." until a page refresh**, after a Load 3D node had been open.
- **Fixed: a Save 3D node could show the model from another workflow.** Each workflow now keeps its own preview.
- **If the browser stops drawing 3D views, Load 3D and Save 3D now say so** and try again on their own, instead of staying dark.
- **The info line under Save 3D's view wraps to two lines**, so nothing is cut off.

### **September 16, 2026 · v1.4.151**
- **NEW: Save 3D Pixaroma.** See a 3D model on the node, check which way it faces, stand it on the ground, and save it as OBJ, GLB or STL.
- **Preview Image Pixaroma no longer makes everything after it run again.** Change a late setting and only the steps after it are redone, so 3D workflows are much quicker to tweak.

### **September 14, 2026 · v1.4.150**
- **Load 3D Pixaroma now gives out its `width` and `height`**, so your empty latent can match the picture.
- **Load 3D can take its size from Sizes Pixaroma.** Wire the two together and the 3D picture follows your size pick, so tall and wide pictures keep the angle of your view.

### **September 13, 2026 · v1.4.149**
- **NEW: Load 3D Pixaroma.** Load a GLB, OBJ, FBX, STL or PLY model, turn it to any view, and get the model, its picture and a mask.

### **September 11, 2026 · v1.4.145-v1.4.148**
- **Fixed: bypassing a node could break the wire below it.** Show Text, Switch, Notify and Free VRAM stopped with "missing input" or passed the wrong value.
- **Fixed: Save Text kept only the first result** of a folder run.
- **Fixed: a picked button colour came back orange after a reload**, hover too.
- **Fixed: opening and closing a workflow asked "Save changes?"** with nothing changed.
- **Fixed: the settings gear on Prompt Each and Music Prompt** opened the colour panel.
- **The video nodes now install ffmpeg with the pack**, so they work on a fresh setup. Update through Manager or your launcher, not git on its own.
- **Remove Background names every folder it searched** when a model is missing.
- **Clearer help** for Control Panel's Step and for Mute Switch.

### **September 7, 2026 · v1.4.144**
- **Fixed: selecting text in Prompt, AI Prompt and Music Prompt showed no highlight.** The words were selected and copying worked, but nothing showed, so there was no way to tell.

### **September 6, 2026 · v1.4.143**
- **Fixed: a 16-bit picture came out almost white**, in Inpaint Crop, Image Crop, Image Composer layers and AudioReact. The preview looked right the whole time, so it read as the node being broken.
- **The download is smaller.** Developer tools and notes that never run on your machine are no longer packed into the release.
- **The settings gear on Outpaint and Prompt is now drawn by the pack**, so it looks the same on Windows, Mac and Linux.

### **September 5, 2026 · v1.4.133-v1.4.142**
- **Fixed: Preview Image Save to Disk** - big pictures failed, the filename stopped counting up, and a refused folder picker now saves to Downloads.
- **Fixed: the Workflows panel now sees folders you linked in from elsewhere**, and can rename, move and cover them. Thanks to jab416171.
- **Fixed: Prompt Reader returned an AI node's instructions instead of the prompt.**
- **Fixed: Load Audio now finds sound files in folders inside `input`.**
- **Fixed: a Pixaroma group inside another group could stop being editable.**
- **Fixed: text looked doubled while you selected it** in AI Prompt, Prompt and Music Prompt.
- **Fixed: Run Timer grew a little on every open** with a font of your own.
- **Open folder and Reveal now work only on the computer ComfyUI runs on**, since that is whose screen the window appears on.
- **Groundwork for clearing the Registry security warning.** Nothing changes in how the nodes behave.
- **Reports and ideas now go to `#pixaroma-nodes` on Discord.**

### **August 27, 2026 · v1.4.131-v1.4.132**
- **NEW: Prompt Each Pixaroma.** Type a prompt in each row, press Run **once**, and you get one picture per prompt, all collected in the same Preview node. It renders them one at a time, so a long list is safe on a small graphics card.
- **Square brackets multiply a row**: `a [red|blue] car` is two prompts, `a [red|blue] [car|van]` is all four. The counter shows what you will get before you press Run.
- **Paste a whole list in one go**, one prompt per line, and Copy sends it back out the same way with the ON/OFF switches kept.
- **It works with your tag library.** Wire Prompt Pixaroma into its `text` input and your `@tags` are filled in first, added to your rows rather than replacing them.
- **Fixed properly: Prompt Multi and Prompt Stack rows collapsing into thin overlapping bars.** The cause was **Monitor Pixaroma restyling them**, not another node pack, which is why it came and went and a refresh cleared it.
- **Prompt rows now hold their height** if anything else tries to squeeze them.

### **August 26, 2026 · v1.4.127-v1.4.130**
- **Fixed: Load Audio grew taller by itself.** The waveform pushed the node bigger on every redraw, ending at a different size after each reload and dragging the canvas.
- **Panning and zooming are lighter on big workflows.** Label, Monitor and Run Timer no longer tax the canvas.
- **Fixed: Save Video, Save Image and Save Text would not fill the node**, leaving the video small with empty space below.
- **Fixed: Prompt Multi and Prompt Stack rows could collapse into each other**, only alongside certain other node packs.
- **Fixed: dragging a saved video back onto the canvas rebuilds the workflow again.**
- **Fixed: Image Crop gave every queued job the last crop.**
- **The LoRA picker no longer opens on an empty folder**, and Back is easier to see.

### **August 25, 2026 · v1.4.123-1.4.126**
- **Dropdown Pixaroma now holds up to four values in one entry.** Name each output, and one pick sets several wires at once: a sampler and its scheduler.
- **Fixed: a Dropdown would not connect to a sampler or scheduler by hand.** It worked if the wire was already saved, but once unplugged it could not be plugged back.
- **Each output has its own type.** Existing Dropdowns keep working.
- **New: Save Mp4 and Save Video can fade the sound in.** AI video clips often start with a click; 120 removes it.
- **Fixed: Save Mp4 could skip saving, with no error, when run from an API script.**

### **August 24, 2026 · v1.4.121-1.4.122**
- **NEW: Free VRAM Pixaroma**, hands the graphics card's memory back at the point you wire it in, so a second heavy model has room to load. Under Logic & Flow.
- **NEW: Monitor Pixaroma**, a live readout on the canvas: video memory, system memory, GPU and processor load, temperature and power. Under Logic & Flow.
- **Monitor also keeps a peak mark** from the last run, has its own Free VRAM button, and switches between bars and a one line strip.

### **August 21, 2026 · v1.4.120**
- **Seed Pixaroma now works with Impact Pack's wildcard nodes.** Wired into ImpactWildcardProcessor in populate mode, the processed text stayed on the same words every run. It rerolls properly now.

### **August 19, 2026 · v1.4.119**
- **NEW: `@tags` in Music Prompt**, the same library Prompt and AI Prompt use.
- **NEW: Music Prompt writes instrumental music**, about twice as fast.
- **Picking a formula set loads its model too**, and a new node names the built-in one.
- **Music Prompt's small sizes are fixed**: F / R was cut off, and it could shrink under its content.
- **Instr. is now Break.** Avoid it on a 30 second song.
- **Model sizes in every picker**, and Gemma 4 and Qwen3.5 are no longer marked "no vision".
- **The cursor lands where you click** in long prompts.

### **August 18, 2026 · v1.4.115-v1.4.117**
- **NEW: Music Prompt Pixaroma.** One idea in, a caption and lyrics out for MiniMax Music 3. Set the length and the words are written to fit. Replaces the two music presets.
- **Find a model by typing.** The model lists in AI Prompt, Video Prompt and Music Prompt settings now filter as you type, like presets do.
- **NEW: your tag library works in AI Prompt too.** `@name`, `*Category` and `#name` from the same library as Prompt Pixaroma, coloured so you can see which are real.
- **NEW: a Krea 2 idea preset for Qwen3.5 4B.** Over 36 runs it named the medium every time and never opened with a stray label.
- **Prompt Pack reads what Save Text writes.** The same three separators in both, so a saved .txt runs again.
- **Comma is gone as a separator.** It chopped prompts into pieces. Workflows set to it move to Blank line.
- **Quick runs no longer scatter a collection.** Save Text could start a second .txt part way through.

### **August 17, 2026 · v1.4.111-v1.4.114**
- **NEW: Save Text Pixaroma.** Keeps every run's text in one list on the node and in a .txt file, so tried prompts are not lost. Clear starts a new file instead of deleting the old one.
- **Copy and Paste (Clipspace) work again** on Load Image, Load Image Mini and Preview Image.
- **Inpaint Crop asks before throwing your mask away.** Closing with ✕ or Escape used to discard your painting.
- **AI Prompt works on the desktop app**, where its questions never appeared, so presets, recipes and the seed box did nothing. You can also find a preset by typing and delete one from its row.
- **Ctrl+Z no longer undoes your whole workflow** when a Pixaroma question or the AI Prompt editor is open.
- **Pause Text: Regenerate gives you a fresh prompt** from an AI Prompt node, even with a fixed seed.
- **Plus:** paste a recipe when the browser blocks clipboard reads; Load Video Frame explains a blank ProRes preview.

### **August 16, 2026 · v1.4.109-v1.4.110**
- **NEW: First Last Frame Pixaroma.** Takes the first and last frame out of a video as two pictures, so the next clip can start where the last one ended. Works with Load Video Pixaroma or ComfyUI's own Load Video.
- **Run Timer: drag the corner and the whole clock grows with it**, digits and all, and it remembers the size with your workflow. You can also pick the clock font now, your own .ttf files included.
- **The timer says when it will stay silent** by dimming the sound rows, and there is a mute button beside the volume.
- **16-bit pictures load properly now** in Load Image, Load Image Mini and Load Images from Folder. Scans and depth maps used to come out almost white.
- **Plus fixes:** no grey edge down the right of the clock; Load Video Frame handles 16-bit clips.

### **August 14, 2026 · v1.4.107-v1.4.108**
- **NEW: AI Prompt Pixaroma.** Give it a model and a saved instruction, wire in text, pictures, audio or video, and it writes text on your own machine, no account or key. Six ready recipes included.
- **Chain them and share recipes:** the output is plain text, so one node can describe a photo and the next restyle it. A recipe shares as one .txt file.
- **Your written prompt stays put** in AI Prompt and Video Prompt when you switch workflow tabs, with the seed that wrote it.
- **The Krea 2 idea recipe keeps the look you ask for:** cartoon, illustration or 3D no longer turns into a photograph. Load the preset again to pick it up.
- **Plus fixes:** a clearer AI Prompt banner, a formula box that scrolls, settings panels that open fully on screen, and dropdowns that close when you zoom.

### **August 13, 2026 · v1.4.105-v1.4.106**
- **Video Prompt: the idea box can be made bigger.** Drag the node, drag the bar under the box, or press Expand for a full-screen one.
- **LoRA Loader: a LoRA two folders deep no longer shows "Empty folder"**, and a LoRA's trigger word is now ticked for you when you pick it.
- **Right-click in a text box gives copy and paste again** instead of the node menu, on the prompt and text nodes.
- **Save Mp4: dates in the filename work.** `%date:yyyy-MM-dd%` used to be left in the name.
- **Run Timer keeps counting** when you switch workflow and come back. Its chime now starts off.
- Thank you to everyone who reported these.

### **August 12, 2026 · v1.4.104**
- **NEW: Video Prompt Pixaroma.** Type an idea in plain words and get a finished MiniMax H3 prompt, replacing three workflows of about ten nodes each. Runs on your own machine with one vision model.
- **It picks the mode from what you wire in** (nothing, one picture or two), and its frames output snaps to a length H3 accepts. Wan, Hunyuan and LTX too.
- **Also:** talking prompts work at 5 seconds, the wording is yours to edit, a Free VRAM switch frees the model for your video, and Prompt Reader pulls your idea back out.

### **August 10, 2026 · v1.4.100-v1.4.103**
- **NEW: Save Video Pixaroma.** Save an mp4 anywhere with Save Image's folder and filename tools, a live preview of the name, and playback on the node. MP4 HQ keeps fades smooth at about half the size.
- **Three new filename pieces:** frame rate, length and frame count, like `Video_24fps_81f_3-4s_001.mp4`.
- **Save Image can save WebP:** about a fifth of a PNG, keeps transparency, and still reloads the workflow when dragged in. Plus a settings gear, a row to hide unused buttons, and a + Input folder chip.
- **Fixed: Load Image Mini and Load Image showed the wrong picture** after switching workflow tabs.
- **Plus fixes:** the Save Mp4 preview no longer goes black, a wrong sound wire or transparent frames no longer stop Save Mp4, the video timeline no longer sticks to your cursor, and Save Image no longer shows a picture you deleted.

### **August 7, 2026 · v1.4.99**
- **Fixed: a change you made by clicking a Pixaroma control was not always noticed**, so a workflow could look saved when it was not, and with Auto Save on the change could be lost entirely. Every control now reports it the instant you make it, and Ctrl+Z undoes it properly. Worth knowing either way: a workflow opened from the built-in templates always reopens as it came, so save it under your own name once it is set up.

### **August 6, 2026 · v1.4.97-v1.4.98**
- **Fixed: Pause Text made your whole workflow redo itself**, so everything after it ran again on every Run even with a fixed seed and nothing changed. Pause Image had the same problem, found by checking rather than waiting for a report.
- **Fixed: workflow cards showed a broken picture** for anything that makes video. They now show the drawn map of the graph, and cards already stuck put themselves right.
- **Fixed: a cover you picked is no longer replaced** by the next run's output. It stays until you use Remove cover.

### **August 5, 2026 · v1.4.91-v1.4.96**
- **NEW: Load Audio Pixaroma.** Pick a sound file and take exactly the piece you want: drag the orange edges to trim, drag the middle to slide, and press play to hear it before you spend a render. Wire in Duration Pixaroma and the window matches your video exactly.
- **NEW: H3 Audio Sync Pixaroma.** Makes a MiniMax H3 video perform your recording instead of the sound the model invents. H3 makes picture and sound as one thing, so you cannot simply lay a track on top; this puts yours in and holds it there. It reads the length itself and warns past H3's roughly 15 seconds.
- **NEW: Longest Side Pixaroma.** Click a size and the longer edge becomes exactly that, the other following so nothing is squashed. Optional shape crops first, and a button rounds both sides to 8, 16, 32 or 64.
- **Your own picture for any LoRA:** click the small picture, drop one on it, or paste. Yours wins over the Civitai one, and the x brings the automatic one back. Kept with your settings, so it survives updates and read-only model drives.
- **Fixed: Image Resize no longer loses a see-through background.** It comes out of the mask output, cropped and resized to match, ready for Join Image with Alpha.
- Also: saving an unsaved workflow into a folder now uses the folder you chose; a LoRA picture or your trigger words could vanish while the panel was still loading; loaders could show a different picture than the one you picked.

### **August 4, 2026 · v1.4.85-v1.4.90**
- **Pixaroma now works properly on online ComfyUI services.** The Save Mp4 player, Note icons, fonts, sounds and several pickers were quietly broken there: around 270 addresses were built as if ComfyUI owned the whole site. Nothing changes on your own PC.
- **Your own LoRA trigger words now belong to the LoRA**, not to one row, so a word you type once is waiting wherever you use that LoRA. Words you already typed move across the first time you open the panel.
- **Our full screen editors no longer hold up the rest of ComfyUI.** Ctrl+Z is still kept inside the editor, but the old way of doing it also switched off workflow loading for the whole page, which affected other creators' nodes.
- **Switch and Mute Switch survive changing the node style.** Flipping ComfyUI's classic/new node setting without refreshing used to leave them empty or drawn twice. Both rebuild themselves now, rows intact.
- **Run Log can show your PC's hardware** in the corner, like `RTX 4090 · 24GB VRAM · 128GB RAM`, so shared times mean something. Off until you turn it on, never saved into your workflow.
- **Sizes can star your recommended sizes**, so the ones that suit your model stand out on the node.
- **It is easier to find where your own fonts go**: the font list says so at the bottom, and Help has a new "Add your own fonts" page.
- Also: a bad setting on one node can no longer stop the Run button; Pixaroma is back in the ComfyUI Manager list; Run Log fills the node properly in the new node style; AudioReact and Save Image check a folder is allowed before looking it up, which matters on Windows network paths.

### **August 3, 2026 · v1.4.82-v1.4.84**
- **Please update: Pixaroma now only reads and writes where you have said it can.** It stays inside ComfyUI's own input, output and temp folders plus any folder you pick with **Browse**, which approves it for good. Nothing you already save to the output folder changes, and the node warns you before you run rather than after. Found in a security review, with no report of it being used against anyone.
- **NEW: Duration Pixaroma.** Say how long a video should be in seconds and it works out the frame count your model wants, replacing the seconds-plus-maths pair people usually wire up. You decide which lengths it offers, as buttons or a slider, and it shows the frame count and the true length before you run. Outputs both, so audio can line up. Custom formula understands the same functions as ComfyUI's Math Expression.
- **Portrait Landscape can round your sizes to a step** of 8, 16, 32 or 64, each node keeping its own, and it shows the size it will send. Existing nodes open with rounding off.
- **Fixed: Control Panel and Dropdown could not connect to some newer ComfyUI nodes**, including its own Math Expression - the wire appeared and vanished a moment later. Connection sparkles light up on those inputs now too.

### **August 2, 2026 · v1.4.76-v1.4.81**
- **LoRA Loader: add your Civitai API key** in the gear and lookups find models the site keeps from anyone not signed in. Your key stays on your computer, never in a workflow, and only its last four characters are shown back. Try Civitai also works on more connections now, and its info panels follow the node as you zoom.
- **XY Plot: long prompts are readable at last**, wrapping with numbered lines in the value box and into the side strip as an axis label instead of running across your pictures. The grid preview follows the node width, and the saved grid carries its workflow.
- **Prompt: put your tag categories in any order** by dragging or the ⋯ menu. Colours show where each piece came from - tag, category or list - and a half-typed tag gets a spellcheck-style underline instead of glowing red at you.
- **Start ComfyUI with `--disable-metadata` and Pixaroma writes nothing into your pictures**: no workflow, no prompt, no Civitai info. Before, only the video saver honoured it.
- Plus fixes: Export (API) left out everything after a paused Pause node; dragging a workflow or category onto a text box could rename a file or edit a tag; renaming a category to change only its capitals did nothing; Inpaint Crop failing on newer NumPy.

### **August 1, 2026 · v1.4.73-v1.4.75**
- **Using a list twice in one prompt gives you two different things.** `#fruit #fruit` now deals the next one along instead of repeating.
- **You can see what a prompt actually picked.** The expanded box shows the real words the moment you press Run, and they travel inside the picture.
- **Fixed: a picture now remembers the seed that made it.** Drag it back onto the canvas and Run recreates it, locked to that seed.
- **Fixed: a confusing warning on startup.** One of the pack's own files was saved with an invisible marker, and a new check stops that happening again.

### **July 31, 2026 · v1.4.69-v1.4.72**
- **NEW: Dropdown Pixaroma.** Your own named list for the values you keep retyping - pick "warm light" instead of pasting the sentence. Sends text, a whole number, a decimal or on/off.
- **It can change entry on its own each run.** The letter on the node: **F** keeps your pick, **I** steps to the next, **R** picks at random. XY Plot can compare every entry.
- **The Workflows panel can be made bigger.** Three **A** buttons in its toolbar scale the writing, cards, pictures and folder list together.
- **Folders inside folders now fold away**, and you can right-click a folder to make another one inside it.
- **You can hide the Align, Workflows and Help buttons** with three tick boxes in Settings. Alt+W and Alt+H still work.
- **XY Plot warns when another LoRA is quietly in every square**, and its help gained worked examples plus a section just for LoRAs.
- Plus fixes: the Workflows search box emptied itself when you changed the view, the sort or the size.

### **July 30, 2026 · v1.4.66-v1.4.68**
- **NEW: a panel for your workflows** - the orange **W** in the top toolbar, or Alt+W. It reads the folder you already use, gives every workflow a picture, and searches inside the files.
- **Organise without leaving ComfyUI:** rename with F2, drag onto a folder, duplicate, set a cover, delete. **Needs tidying** gathers the mess in one click.
- **Save Image and Preview Image can add the generation info Civitai reads.** Right-click to switch it on; the values are read from your workflow. Off by default.
- **XY Plot can compare the LoRAs in LoRA Loader Pixaroma** - the file in each row, its strength, or both at once on a grid.
- Plus fixes: "no workflow data available" when opening from your history on a cloned install, and an XY Plot asking you to save a workflow you never edited.

### **July 29, 2026 · v1.4.64-v1.4.65**
- **NEW: a help button in the top toolbar**, the orange **?** next to Align. It covers every node, the canvas tools and four short guides, and search reads the whole text.
- **Your version is always on screen** along the bottom of the help window, and one click copies the full details for a support question.
- **Fixed: the typing cursor could sit away from the text in Prompt Pixaroma** on long prompts.
- **Fixed: Label Pixaroma was only showing half its help**, plus two wrong instructions in the Pixaroma Group help.

### **July 28, 2026 · v1.4.63**
- **Pick your own colour for almost any Pixaroma node** - around fifty of them now, up from seven. Apply it to one node, to every node of that kind, or to the whole pack.
- **A settings gear on the node toolbar**, next to the question mark, and in the right-click menu too.
- **A node's own options moved onto the node**, out of the Settings window. Everything you had already chosen carries over.
- **Fixed: Load Image Mini, Image Info and Prompt could make an untouched workflow ask to be saved.**

### **July 27, 2026 · v1.4.60-v1.4.62**
- **Outpaint: type the edge amounts** instead of only dragging, with a reset button. Sums like `512*2` work.
- **Renamed model files show up when you press R** - fixed in the LoRA picker, the folder gallery, Run Timer's sounds and the Note icon picker.
- **A LoRA whose file is missing finally says so**, with a red mark, instead of looking normal and quietly doing nothing.
- **NEW: choose how much memory the LoRA Loader uses** - Standard, Fast or Lowest, in the gear. Standard is the new default.
- **Prompt: deleting from the tag library is easy to find** - every category row has a plain **⋯** menu now.
- **Anything that takes something away asks first**, names exactly what goes, and offers to export a backup.
- Plus fixes: your place in a sequence only moves on a real Run, and odd entries from a hand-edited import file are refused cleanly.

### **July 25, 2026 · v1.4.58-v1.4.59**
- **LoRAs kept on another drive through a shortcut folder now show their details** - they came back as "not found" before. Prompt Reader, Save Image and XY Plot benefit too.
- **Civitai lookups are steadier and previews load far faster**, with a useful reason when something does go wrong.
- **The details window no longer flashes in the corner**, and it opens next to the node.
- **The mouse wheel zooms again over seven nodes that had stopped it**, plus a new setting for what it does over a text box or list.

### **July 24, 2026 · v1.4.56-v1.4.57**
- **NEW: Pause Text Pixaroma.** A checkpoint for words: read and fix AI-written text before it goes on, or hit **Regenerate** for a fresh one.
- **Prompt learns lists.** Flip a shortcut to **List**, put one option per line, and `#animals` becomes one of them each run - Shuffle, Random or In order.
- **The tag library keeps your writing and your lists apart**, so `@` offers your wording and `#` offers your lists.
- **Share part of your library instead of all of it** - export one category, and see what is in a file before importing it.
- Plus fixes: Pause Image no longer skips your other branches on Continue, and Text Join no longer hides words behind the line label.

### **July 23, 2026 · v1.4.54-v1.4.55**
- **Run Log lets you label each run.** Double-click a row and type a short note; it travels with that run's time and comes along when you export.
- **Copying a Switch or Mute Switch keeps everything you set up** - row names, the row you had switched through, and which branches were off.

### **July 22, 2026 · v1.4.53**
- **Sliders grows into Control Panel Pixaroma.** Each row becomes whatever you plug it into: a slider, a switch, a dropdown, a seed or a text field. Up to 16 per node, and your existing Sliders nodes simply gain the new abilities.

### **July 21, 2026 · v1.4.47-v1.4.52**
- **NEW: LoRA Loader Pixaroma.** Stack as many LoRAs as you like in one small node, each with an on/off switch and a strength. Click the **i** for trigger words read straight from the file, tap the ones you want, and they come out of a **triggers** output.
- **NEW: Text Join Pixaroma (Two, Three and Four).** Join pieces of text, each line either typed or wired in. Right-click to set the separator, skip empty lines, and rename each line.
- **NEW: Run Log Pixaroma.** Keeps the last 10 run times on the node, newest first, one list per workflow. No wiring needed.
- **NEW: Outpaint Stitch Pixaroma.** Puts your original picture back at full quality after an outpaint and keeps only the new area, with Feather and Color match.
- **Prompt can roll a random shortcut each run** - type `*` and a category name.
- **LoRA Loader's info window is tidier**, with a File / Civitai switch and an option to hide the file ending.

### **July 19, 2026 · v1.4.43-v1.4.46**
- **NEW: Prompt Pixaroma.** A prompt box with a personal library: save a long chunk once, then just type `@name`. Type `@` for a searchable list, and **Tags** opens a full-screen library you can export and import.
- **NEW: Load Image Mini Pixaroma, with an Image Info companion.** A stripped-down loader that keeps all the resizing behind the gear; wire Image Info in when you need the mask, size or filename.
- **Updates now show up on their own - no more hard refresh.** One last Ctrl+Shift+R may be needed if your browser is already stuck on an old copy.
- **Prompt's preview keeps up with a connected prompt** as you change it.

### **July 18, 2026 · v1.4.42**
- **NEW: Outpaint Pixaroma.** Adds a border around your image so an outpainting model can fill in new scenery. Grow to a ratio, add exact pixels per edge, or drag a green edge on the preview. Optional megapixel cap and snap.

### **July 16, 2026 · v1.4.40-v1.4.41**
- **Notify now times your workflow.** The clock starts on Run and stops when the workflow reaches that node, so several Notify nodes give you per-section times. Each keeps its own history of the last 10.
- **Fixed: Save Image no longer stretches itself very tall**, and workflows already saved that way are put right when you open them.

### **July 15, 2026 · v1.4.38-v1.4.39**
- **NEW: Sizes Pixaroma.** A tidy list of your favourite exact resolutions, with a Portrait / Landscape button that flips the whole list and an optional snap.
- **Fixed: duplicating a Crop or Inpaint Crop node no longer touches the original** - every copy starts with a clean slate.

### **July 14, 2026 · v1.4.33-v1.4.37**
- **NEW: Sliders Pixaroma.** A panel holding every number you keep reaching for. Wire a slider to any number input and it learns the name, range, step and type.
- **Switch and Mute Switch line up properly in the new node style** - each socket now sits on its own row.
- **The Switch exports properly to API format**, and picks the right branch when run through the API. Switch Source too.
- **All on / All off buttons on the Group Switch**, plus a mute-all switch for Run Timer in its settings.

### **July 13, 2026 · v1.4.31-v1.4.32**
- **Run Timer remembers your recent run times.** Right-click for the last ten, with the workflow name, the time of day, and the fastest marked.
- **NEW: Krea LoRA Converter.** A LoRA trained for Krea 2 on fal.ai will not load in ComfyUI; pick it, press Convert, and it saves a working copy. Your original is never touched.

### **July 11, 2026 · v1.4.30**
- **The Seed node gained up/down arrows, shorter random seeds, and a history panel** of the last ten seeds you ran.
- **Pause Image buttons are in a clearer order** - Regenerate on the left, Continue on the right.

### **July 9, 2026 · v1.4.25-v1.4.29**
- **Image Compare no longer errors when one image is missing** - it just shows whichever one is connected.
- **Prompt Reader can follow a connected image.** Wire a filename in and it keeps up as you flip through pictures.
- **Pause Image keeps your image details when you press Continue**, so the prompt and seed survive.
- **Groups no longer slow down the canvas**, and the corner grip tucks back inside the rounded edge.

### **July 8, 2026 · v1.4.24**
- **XY Plot works with the Power Lora Loader, and can compare lora strengths** - put the lora across and the strength down for a grid of both.

### **July 7, 2026 · v1.4.20-v1.4.23**
- **A cleaner Run Timer** - just the floating clock, no title bar or frame, sized tightly to the time.
- **A smaller Seed node.** Right-click for "Seed compact size" to shrink it to one row, plus a settings panel to cap how many digits a random seed has.
- **Fold the Save Image node** with the arrow in its corner to tuck away the folder and file-name settings.

### **July 6, 2026 · v1.4.19**
- **NEW: Save Image Pixaroma.** Save to any folder on your computer, build the file name from clickable chips, and see a live "Will save as" line. Files never overwrite, PNG or JPG, with a big preview on the node.

### **July 3, 2026 · v1.4.18**
- **Put the seed into your saved file names.** Type `%Seed Pixaroma.seed%` in the filename field and the number lands in the file, in our save nodes and the built-in one.

### **July 2, 2026 · v1.4.17**
- **Run Timer keeps each workflow's time when you switch tabs**, and after a page reload.

### **July 1, 2026 · v1.4.14-v1.4.16**
- **NEW: Load Video Frame Pixaroma.** Grab one exact frame out of a video: drag the slider, step with the arrows, or type the frame number.
- **The mouse wheel zooms the canvas over Pixaroma nodes now**, while text boxes and lists still scroll normally.
- **XY Plot saves at full resolution.** A Save row picks 2048, 4096, 8192 or Full.

### **June 30, 2026 · v1.4.13**
- **Drag a quick preview back onto the canvas.** Preview Image now saves the workflow inside its temporary images too.

### **June 29, 2026 · v1.4.12**
- **Pin a Pixaroma Group** so you cannot move or resize it by accident, and pinned nodes stay locked when Align is on.
- **Draw inpaint masks with a pen or tablet** in Inpaint Crop.
- **Prompt Multi and Prompt Stack keep their text rows the right size** after a workflow or tab switch.

### **June 28, 2026 · v1.4.9-v1.4.11**
- **NEW: Run Timer Pixaroma.** A clock that resets on Run, counts up live, freezes on the total and plays a chime. Right-click for the sound, the detail and the colour.
- **Turn a regular group into a Pixaroma Group** with one right-click, and groups no longer leak into subgraphs.
- **Save Mp4 stores the workflow inside the video**, so you can drag a saved video back in.
- **The Seed node shows the seed it actually used** in Random mode.
- Plus fixes: dragging a group by its title bar always works, lowercase `hh` works in filename date stamps, Set Pixaroma is findable by dragging any wire, and Get / Set hold their picked name more reliably.

### **June 26, 2026 · v1.4.3-v1.4.8**
- **Pixaroma Groups stay with their workflow** - no more appearing on the wrong tab or disappearing.
- **Set / Get fixed:** a Set could grow a duplicate input that stopped the value passing through. Older workflows repair themselves when you open them.
- **Copy and paste a Pixaroma group** with Ctrl+C / Ctrl+V, landing at your cursor, and Ctrl+A now selects them too.
- **Group Switch is friendlier** - click anywhere on a row to flip it, and switched-off rows are dimmed.
- **Version Check warns about an out-of-date browser cache**, with the fix, and the Copy button includes it.
- Plus smaller touches: group snap-to-grid, a cleaner right-click menu, smoother group dragging, colouring a whole selection at once, and resizable Seed and Group Switch nodes.

### **June 25, 2026 · v1.4.2**
- **NEW: Group Switch Pixaroma.** On / off switches, one per group, that mute or bypass whole groups with a click. Lists both Pixaroma and regular groups.
- **Move a node and its group together**, and group selection now matches ComfyUI (Ctrl+drag replaces, Shift adds).
- **Choose how group header buttons appear** - always, on hover, or a tidy in-between.

### **June 24, 2026 · v1.4.0-v1.4.1**
- **Groups, reimagined: the Pixaroma Group.** Select some nodes and press **G**. A coloured header with the node count, one-click run / mute / bypass / fold, nesting, and Align snapping. Regular ComfyUI groups go back to their plain look.
- **Group Mute and Bypass reach inside subgraphs**, and the header has a **Run** button for just that group.
- **A cleaner, more modern Label editor**, and the Label looks right on the canvas again.
- Plus smaller touches: the colour menu colours your whole selection, and the "deprecated" console warnings are gone.

### **June 22, 2026 · v1.3.101-v1.3.102**
- **Align now works with groups.** Drag a group and it snaps to nearby nodes and groups, taking its own nodes with it.
- **NEW: Group styling** - rounded corners, a coloured header with the node count, and hover buttons to mute, bypass, colour or collapse.
- **NEW: Smart node title colour** - titles turn white or dark so they stay readable on any node colour.
- Plus smaller touches: separate node and group colour favourites, fresher swatches, more Align fixes, and Load Video uses less memory.

### **June 21, 2026 · v1.3.100**
- **NEW: Loop Start / Loop End + Combine Pixaroma.** Repeat a section of your workflow as many times as you like - good for a long video in chunks or a batch of images. Combine piles each round's result onto the total.

### **June 20, 2026 · v1.3.99**
- **NEW: Load Video Pixaroma.** Load a video and turn it into frames, with a preview that plays on the node. Gives you the frames, the audio and the details all at once.
- **Save Mp4 keeps every frame by default**, plays on click, and handles audio a touch shorter than the picture.

### **June 19, 2026 · v1.3.95-1.3.98**
- **NEW: Set / Get Pixaroma.** Wireless connections: wire anything into a **Set**, name it, and read it anywhere with a **Get**. They work inside subgraphs and behave exactly like a real wire.
- **NEW: Resize Crop Pixaroma.** Set a width and height and it fills that size exactly, cropping the overflow from the centre.
- **NEW: Portrait Landscape Pixaroma.** Flip a size between tall and wide with one click.
- **Save Mp4 preview, much improved** - it keeps the size you set, with its own playback bar, Download and fullscreen.
- **Tidier menu** - the nodes are sorted into folders instead of one long list.

### **June 17, 2026 · v1.3.93-1.3.94**
- **NEW: Seed Pixaroma.** Flip between Random and Fixed, lock in a lucky roll, bring back the previous seed, or copy the number. One node can feed several samplers.
- **Load Images from Folder: the First box works as you type**, and caps to how many images are actually there.

### **June 16, 2026 · v1.3.92**
- **NEW: Inpaint Crop + Inpaint Stitch Pixaroma.** Paint over the part you want changed and it crops a clean, model-friendly piece; Stitch pastes the result back so the seam disappears. Zoom, pan, brush, erase and invert in the editor.
- **No more hard refresh after every update** (do one last Ctrl+Shift+R right after this one).
- **Press `\` to open Node Colors** with a node or group selected.

### **June 15, 2026 · v1.3.88-1.3.91**
- **NEW: Image Uncrop Pixaroma.** Paste an edited or upscaled crop back onto the original at the exact spot, with a feather slider.
- **NEW: Load Images from Folder Pixaroma.** Point it at any folder, pick images in a gallery, and Run once to process each one.
- **Image Crop now carries transparency** plus a `crop_info` wire that feeds Image Uncrop. (Its width and height outputs moved down one spot.)
- **Preview Image: mixed-size batches fit each thumbnail to its own shape.**

### **June 10, 2026 · v1.3.84-1.3.87**
- **NEW: vertical text** in Text Overlay, Composer text layers and Text Watermark.
- **NEW: a Restore brush for the Composer eraser** - paint the original image back.
- **NEW: a Help button on every node** - select one and click the orange **?** in the toolbar.
- **NEW: a Dynamic prompts switch on the Text node** - `{red|blue|green}` picks one at random.
- Plus fixes: Text no longer strips curly braces, save names in any language work, and Image Compare shows each input's size.

### **June 9, 2026 · v1.3.82-1.3.83**
- **Load Image keeps a steady size** instead of resizing itself and shoving your other nodes around.
- **Finished the GitLab move**, and the README now flags the browser-cache fix up front.

### **June 8, 2026 · v1.3.79-1.3.81**
- **XY Plot: whole numbers stay whole and decimals stick**, plus a new **Snap** toggle that rounds sizes to clean multiples.
- **XY Plot: a Help button, separate Reset X and Reset Y**, and buttons that wrap instead of spilling out of a narrow node.

### **June 7, 2026 · v1.3.78**
- **Project moved to GitLab.** The links now point to the new home; the nodes themselves are unchanged.

### **June 3, 2026 · v1.3.73-1.3.77**
- **NEW: XY Plot Pixaroma.** Compare settings side by side with no setup: wire your image in, pick what changes across and down, Run once, and a labelled grid fills the node.
- **NEW: Find and Replace Pixaroma.** Sit it in a wire and it swaps words on the way through - stack rules, drag to reorder, and see a live before-and-after.
- **Fixed: Find and Replace, Prompt Stack, Prompt Pack, Prompt Multi and XY Plot now work inside subgraphs.**
- **Sharper previews when you zoom in** on Preview Image and Load Image.

### **June 2, 2026 · v1.3.72**
- **NEW: Pause Image Pixaroma.** Pause and preview before the slow part; hit **Continue** and only the steps after it run, so you upscale the exact image you saw.
- **Image Compare: a sharper preview plus Save to disk and Save to output buttons.**
- **Align: nodes no longer jump or move the wrong node when you resize.**

### **June 1, 2026 · v1.3.70-1.3.71**
- **Every Pixaroma node now works in ComfyUI's new node interface.** Mute Switch, Image Resize and Label were the last three.
- **Align guides, the node colour picker and Connection FX all work there too**, and the colour picker was redesigned to pop out beside the node.

### **May 29, 2026 · v1.3.67-1.3.69**
- **Most Pixaroma nodes now work in ComfyUI's new node interface**, including Preview Image, Load Image, Image Compare, Switch and Switch Source.
- **NEW: Version Check Pixaroma.** Shows your ComfyUI, frontend and Pixaroma versions and which node interface is active, with a Copy button for bug reports.

### **May 28, 2026 · v1.3.62-1.3.66**
- **NEW: Mute Switch Pixaroma.** Skip whole parts of a workflow with one click, with Single / Multi and Mute / Bypass buttons, and chaining to group scenes.
- **NEW: Switch Source Pixaroma.** Flip a whole pipeline between two banks of wires with one click.
- **Preview Image: saved images now appear in the Media Assets panel**, plus an option to leave the counter off a Save to Disk filename.
- **Prompt Reader sees through Switch Source.**

### **May 27, 2026 · v1.3.59-1.3.61**
- **NEW: Text Watermark node.** Stamp text in a fixed spot on an image or a whole batch, sized in pixels or as a percentage of the width.
- **NEW: use your own fonts.** Drop `.ttf` / `.otf` files into `ComfyUI/models/fonts/` and they appear in the picker.
- **Undo inside an editor stays inside that editor** - Ctrl+Z can no longer delete the node or revert your workflow.
- Plus fixes: Prompt Multi / Prompt Pack no longer make too many images through one Switch, plus many Image Composer reliability fixes.

### **May 26, 2026 · v1.3.58**
- **Fixed: Load Image keeps the original filename after you draw a mask.**

### **May 25, 2026 · v1.3.56**
- **NEW: node colors organized by color.** Right-click a node for Red, Orange, Gold and so on, each opening its shades, plus a Dark folder.
- Plus fixes: masks work again on Load Image, Copy / Paste loads the right picture, and Number and WH keep their size across workflows.

### **May 22, 2026 · v1.3.53-1.3.55**
- **NEW: color your groups, not just nodes**, plus copy a colour and paste it anywhere, and save up to four favourites.
- **NEW: crop a single layer in Image Composer** with **C** - non-destructive, and re-openable any time.
- **Text: random options and notes in your prompt.** `{day|night}` picks one at random; `//` lines and `/* */` blocks are left out.
- Plus fixes: Switch now runs only the input you picked, Preview Image's save buttons recreate the same picture, and Load Image gained thumbnails, search and a folder sidebar.

### **May 21, 2026 · v1.3.51-1.3.52**
- **NEW: Image Resize Pixaroma.** Eight modes including Crop to fill and Pad, with a live Input → Output preview and a wireable width or height.
- **Press Ctrl+Enter to run while typing** in the text and prompt nodes.
- **Every node now explains itself** - hover any control for a tip, and the Info panel describes each input and output.
- **Nodes remember their settings on reload** (Switch, Image Resize, Crop).

### **May 20, 2026 · v1.3.48-1.3.50**
- **Text Overlay: move the whole caption in one click** with a Position on canvas row.
- **Fixed: opening and closing a workflow no longer falsely asks to Save Changes.**
- **Fixed: drag the ⋮⋮ handle to reorder rows** in Prompt Stack and Prompt Multi.
- Plus fixes: the fullscreen editors can no longer freeze the UI, and Prompt Pack / Prompt Multi no longer block a Run when they are not in use.

### **May 19, 2026 · v1.3.40-1.3.47**
- **NEW: Run Button FX & Connection FX.** Eight styles for the Run button, and a magnetic glow while you drag a wire. Both off by default.
- **NEW: One-click node colors.** Right-click any node for 33 ready-made themes, a saved favourite and a custom picker.
- **Text & prompt nodes share one clean look**, and Text gained **Copy all / Replace / Clear**.
- Plus smaller touches: ◀ ▶ arrows on Load Image and Prompt Reader, Align lines up with Labels and Notes, and it works again on older ComfyUI installs.

### **May 18, 2026 · v1.3.37-1.3.39**
- **NEW: Text Overlay Pixaroma.** A styled caption on any image, with a fullscreen editor to drag, scale and rotate it with snap guides.
- **NEW: Prompt Pack Pixaroma.** Paste a block of prompts and it runs once per prompt, with a live countdown.
- **NEW: Prompt From List Pixaroma** plus Prompt Multi's List mode, to send different prompts to different parts of one workflow.

### **May 17, 2026 · v1.3.32-1.3.35**
- **NEW: Prompt Stack Pixaroma.** Stack prompt chunks in labelled rows, toggle each on or off, drag to reorder, and join them with your chosen separator.
- **AI Background Removal: a built-in model dropdown** with three BiRefNet quality levels, now working on 4-6 GB cards.

### **May 15, 2026 · v1.3.28-1.3.31**
- **NEW: Switch Pixaroma.** A universal one-click switch for any data type, growing its inputs as you wire more.
- **NEW: Remove Background Pixaroma.** One node giving the cutout, the mask and the inverted mask together.
- **Show Text: a one-click Copy button**, and Prompt Reader reads prompts routed through a Switch.

### **May 13, 2026 · v1.3.24-1.3.27**
- **NEW: Prompt Reader Pixaroma.** Drop a generated PNG on it to read the prompt saved inside, with a Copy button and a text output.
- **Load Image: cleaner resize math**, and the on-canvas readout matches the real output.
- **AudioReact handles long audio** without crashing.

### **May 12, 2026 · v1.3.21-1.3.23**
- **NEW: Load Image Pixaroma.** A drop-in replacement for LoadImage with built-in resize controls and 7 outputs, so you can skip downstream resize chains.
- **NEW: small utility nodes** - Text, Number, WH and Switch WH.
- **Drag-and-drop images** onto Image Crop / Composer / Paint, plus Copy and Open buttons on Preview Image.

### **May 10, 2026 · v1.3.18-1.3.20**
- **Preview Image: a native-style grid for batches**, with a per-node Grid / Strip toggle and date folders in filenames.
- **Image Composer: your canvas background colour now survives a Run.**
- **Fixed: the right-sidebar Parameters tab no longer breaks Pixaroma node bodies.**

### **May 09, 2026**
- **NEW: Notify Pixaroma.** A tiny node that plays a sound when reached during a run, so you know it finished from another tab. 10 bundled sounds, per-node volume, and a Preview button.

### **May 08, 2026**
- **Align fixes:** Ctrl+drag marquee selection no longer slides previously-selected nodes around, and canvas pans no longer trigger snap.

### **May 07, 2026**
- **Show Text rewrite:** a real read-only box you can select and copy from, freely resizable, with a new STRING output.
- **Note: a centered modal for every insert button**, each block carrying its own colour, plus 5 separator styles and a plain button option.
- **Preview Image fixes:** single images now show the `WxH` footer, and a stuck close X is gone.

### **May 06, 2026**
- **NEW: Align Pixaroma.** Smart-snap and alignment guides for the canvas - click the mountain icon to enable, hold **Shift** to bypass. Default off.
- **Note colour pickers** got a swatches popup, and picks stay put across cursor moves.
- **Image Crop upgrade:** works with any IMAGE source, a compact panel on the node, math in the fields, and Ctrl+V paste.

### **May 05, 2026**
- **Image Composer: per-layer blur**, and **Shift+Scroll** to scale the selected layer.
- **Fixed:** high-res upstream images no longer get downsampled to the placeholder size.

### **May 04, 2026**
- **Preview Image upgrade:** batches render as a thumbnail strip with a counter, arrow keys navigate, and a new **save_mode** turns it into a drop-in SaveImage.
- **Resolution: added 4:3, 3:4 and 4:5**, a Custom Ratio mode, and math in the Width and Height fields.

### **April 27, 2026**
- **NEW: AudioReact Pixaroma** - turn an image into an audio-reactive video, with 15 motion modes and 8 overlays in a fullscreen editor.
- **NEW: Save Mp4 Pixaroma** - encode frames and audio straight to MP4, with a preview on the node.

### **April 25, 2026**
- **Smoother 3D Builder:** moving the camera, spinning and zooming are much faster.

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

## 📜 About and license

- **Home:** ComfyUI-Pixaroma is made on [GitLab](https://gitlab.com/pixaroma/comfyui-pixaroma). The copy on GitHub is a backup that is kept level with&nbsp;it.
- **License:** [MIT](LICENSE). Free to use, copy, change and share, as long as the copyright notice stays with&nbsp;it. The Pixaroma name, logo and the Pixa mascot are not covered by the MIT&nbsp;license.
- **Made with AI help:** a lot of this pack was written with AI assistance, and every change is tested before it is&nbsp;released.

ComfyUI-Pixaroma is an independent, community-made extension. It is not affiliated with, endorsed by, or sponsored by Comfy Org or the ComfyUI project. Product names, logos, and trademarks are the property of their respective&nbsp;owners.
