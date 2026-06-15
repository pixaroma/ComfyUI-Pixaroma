// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma - Help content for the selection-toolbar Help button ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// One place to edit the in-app help for most Pixaroma nodes. Each entry maps a
// node's comfyClass -> a help-definition object (see js/shared/help.mjs for the
// schema). The selection-toolbar Help button (js/help_toolbar/index.js) shows
// the matching help whenever one of these nodes is selected.
//
// A few nodes register their OWN help from their node file because the help def
// lives next to that node's code: Image Compare (js/compare/index.js), Text
// (js/text/index.js), XY Plot (js/xy_plot/ui.mjs), Find and Replace
// (js/find_replace/render.mjs). Everything else lives here.
//
// To edit a node's help: find its entry below and change the text. To add help
// for a NEW node: add an entry keyed by its exact comfyClass.

import { registerNodeHelp } from "../shared/index.mjs";

const HELP = {
  "Pixaroma3D": {
    title: "3D Builder Pixaroma",
    tagline: "A full 3D scene editor inside ComfyUI - build, light, and render scenes without leaving your workflow.",
    sections: [
      {
        heading: "What it does",
        body: "Opens a fullscreen 3D editor where you can place primitives (cubes, spheres, cylinders, torus, blob, terrain, rock, teapot, hollow vessels), composite assets (trees, houses, furniture, flowers), or import your own `.glb` / `.obj` models.\n\nThe editor includes orbit / pan / zoom camera controls, realistic lighting, and live preview. Keyboard shortcuts follow the Blender layout: `G` to grab, `S` to scale, `R` to rotate, `Shift+D` to duplicate, and `Numpad 1/3/7` for view presets. Full undo / redo is built in.",
      },
      {
        heading: "How to use",
        bullets: [
          "Click `Open 3D Builder` on the node to open the fullscreen editor.",
          "Add shapes from the toolbar or import a `.glb` / `.obj` file.",
          "Position, scale, and rotate objects using the handles or keyboard shortcuts.",
          "Adjust the background image, lighting, and canvas size in the settings panel.",
          "Click `Save` to write the render back to the node.",
          "Run the workflow to get the rendered image as output.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The rendered 3D scene as a flat RGB image."],
          ["width", "Width of the render in pixels."],
          ["height", "Height of the render in pixels."],
        ],
      },
    ],
    footer: "Wire `image` into a ControlNet preprocessor for instant depth maps, line art, or normal maps.",
  },

  "PixaromaPaint": {
    title: "Paint Pixaroma",
    tagline: "A layered painting editor inside ComfyUI - draw, retouch, and compose on stacked layers.",
    sections: [
      {
        heading: "What it does",
        body: "Opens a fullscreen painting canvas with multiple layers, Photoshop-style controls (drag to reorder, opacity, blend modes, merge, flatten), and a full brush engine. Tools include pencil, brush, eraser, smudge, fill, shape, and color picker. The smudge tool gives smooth color blending; brush hardness and opacity are fully adjustable.\n\nDrag an image file onto the closed node body to load it as a new top layer and open the editor automatically. The `AI Remove Background` button on image layers extracts subjects with one click. A `Transparent BG` checkbox in the toolbar lets you save a PNG with a transparent background directly to disk.",
      },
      {
        heading: "How to use",
        bullets: [
          "Drag an image onto the node body to pre-load a layer, or click `Open Paint Studio` to start from scratch.",
          "Use the layer panel on the right to add, reorder, merge, or delete layers.",
          "Pick a tool from the left toolbar and paint on the canvas.",
          "Click `Save` when done; run the workflow to output the result.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The final composited painting."],
          ["width", "Width of the canvas in pixels."],
          ["height", "Height of the canvas in pixels."],
        ],
      },
    ],
  },

  "PixaromaImageComposition": {
    title: "Image Composer Pixaroma",
    tagline: "A layer-based image compositor inside ComfyUI - arrange, blend, and grade multiple images on one canvas.",
    sections: [
      {
        heading: "What it does",
        body: "Opens a fullscreen compositor where you stack images as layers and control each one independently: move, scale, rotate, set opacity, choose a blend mode, apply Gaussian blur, or remove its background with AI.\n\nThe eraser tool masks any layer non-destructively, with a `Restore` mode to paint areas back in. An FX adjustment layer (like a Photoshop grade layer) applies color-grade effects (exposure, contrast, saturation, tone) plus 14 cinematic presets to everything below it. Text layers let you add styled, editable text directly on the canvas.\n\nDrag an image onto the closed node body to add it as a new layer. Wire upstream IMAGE inputs into placeholder slots for generative workflows.",
      },
      {
        heading: "How to use",
        bullets: [
          "Drag an image onto the node body to add a layer and open the editor, or click `Open Image Composer`.",
          "Add more layers via drag-drop, paste, the `+` button, or by wiring an upstream IMAGE into a placeholder slot.",
          "Select a layer in the panel to move / scale / rotate it with handles, or use the right sidebar to set opacity, blend mode, and blur.",
          "Add an FX layer to apply a color grade or cinematic preset above any layer group.",
          "Click `Save` when done; run the workflow to composite and output the result.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The fully composited image."],
          ["width", "Width of the canvas in pixels."],
          ["height", "Height of the canvas in pixels."],
        ],
      },
    ],
  },

  "PixaromaCrop": {
    title: "Image Crop Pixaroma",
    tagline: "Crop any image visually with a draggable handle - no typing pixel coordinates.",
    sections: [
      {
        heading: "What it does",
        body: "Shows a draggable crop rectangle over your image with corner and edge handles. The on-node panel exposes `Width`, `Height`, `X`, `Y`, `Ratio`, and `Alignment` fields - math expressions like `1024+512` or `512*2` work in any number field. Picking a non-Free alignment auto-centers the crop rectangle.\n\nThree ways to load a source image: wire any upstream IMAGE into the input slot, drag and drop a file onto the node body, or paste from the clipboard with `Ctrl+V`. Drag-drop and paste auto-disconnect the upstream wire so your loaded image takes over.",
      },
      {
        heading: "How to use",
        bullets: [
          "Wire an upstream IMAGE, drag a file onto the node, or paste with `Ctrl+V`.",
          "Adjust the crop rectangle using the panel fields or click `Open Crop Editor` for the fullscreen editor with handles.",
          "Choose a preset ratio (1:1, 16:9, 9:16, and more) or leave it on `Free`.",
          "Run the workflow to output the cropped result.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The cropped image."],
          ["width", "Width of the cropped area in pixels."],
          ["height", "Height of the cropped area in pixels."],
        ],
      },
    ],
  },

  "PixaromaAudioStudio": {
    title: "AudioReact Pixaroma",
    tagline: "Turn a still image into an audio-reactive video - motion and effects that move with the beat.",
    sections: [
      {
        heading: "What it does",
        body: "Opens a fullscreen editor with a live WebGL preview that reacts to audio in real time as you drag sliders. Choose one of 15 motion modes (Pulse Zoom, Camera Shake, Glitch, Pinch, Wave, Tilt, Pixelate, RGB Split, and more) and layer up to 8 overlay effects (chroma shift, bloom, vignette, hue shift, cinematic grade, letterbox, scanlines, film grain).\n\nBoth the image and audio inputs are optional - you can wire upstream sources or load them inline inside the editor by drag-drop or file pick. No extra models are needed; requires WebGL2.",
      },
      {
        heading: "How to use",
        bullets: [
          "Wire an upstream IMAGE and AUDIO, or click `Open AudioReact` and load them inside the editor.",
          "Pick a motion mode and adjust its intensity and other settings in the sidebar.",
          "Add overlay effects from the effects panel.",
          "Use the transport bar to scrub and preview the animation in real time.",
          "Click `Save` to store the settings; run the workflow to render all frames.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["video_frames", "All rendered animation frames as a batch of images."],
          ["audio", "The audio track passed through for muxing downstream."],
          ["fps", "Frames per second of the render."],
        ],
      },
    ],
    footer: "Pair with `Save Mp4 Pixaroma` to mux the audio and frames into a single MP4 file.",
  },

  "PixaromaNote": {
    title: "Note Pixaroma",
    tagline: "A rich-text annotation that lives on your canvas - no wires, no outputs.",
    sections: [
      {
        heading: "What it does",
        body: "Lets you write styled, multi-paragraph notes directly on the canvas. Double-click (or use the pencil button) to open a fullscreen editor.\n\nSupported formatting: bold, italic, underline, strikethrough, headings, bulleted and numbered lists, code blocks with a copy button, tables, horizontal rules, and inline icons (CLIP, LORA, GGUF, model badges and 30+ more). You can also insert custom-colored buttons (Download, View Page, Read More, or plain links) and pre-styled YouTube and Discord pills.",
      },
      {
        heading: "How to use",
        bullets: [
          "Drop the node anywhere on the canvas.",
          "Double-click the node body (or click the pencil icon) to open the editor.",
          "Write and format your content using the toolbar buttons.",
          "Click `Save` to close and persist your note.",
          "Right-click the node to change its background and title color via the standard Colors menu.",
        ],
      },
    ],
    footer: "This node never runs during a workflow - it is pure decoration and shows no timing badge.",
  },

  "PixaromaLabel": {
    title: "Label Pixaroma",
    tagline: "A clean text label for captioning parts of your workflow.",
    sections: [
      {
        heading: "What it does",
        body: "Renders a single styled line of text directly on the canvas as a floating caption. No inputs, no outputs - purely decorative. You can pick the font family, font size (up to 256 px), text color, and background pill color.",
      },
      {
        heading: "How to use",
        bullets: [
          "Drop the node where you want the label.",
          "Double-click the node to open the editor.",
          "Type your text, choose a font and colors, then click `Save`.",
          "The label resizes itself to hug its text - no manual resizing needed.",
        ],
      },
    ],
    footer: "This node never runs during a workflow.",
  },

  "PixaromaPromptMulti": {
    title: "Prompt Multi Pixaroma",
    tagline: "A prompt library with two run modes - queue one image per prompt, or send all prompts as a list.",
    sections: [
      {
        heading: "What it does",
        body: "Holds a list of prompts you can toggle on/off, label, and reorder. A pill at the top switches between two behaviors:\n\n`Queue Text` mode: clicking Run queues the workflow once per enabled prompt in sequence, one prompt per run. Wire the `text` output to CLIP Text Encode to generate one image per prompt.\n\n`List Prompts` mode: clicking Run fires the workflow once and makes the full list available as a bundle. Wire the `prompts` output into Prompt From List Pixaroma nodes downstream so different parts of the workflow can each pull a different prompt.",
      },
      {
        heading: "How to use",
        bullets: [
          "Click `+ Add prompt` to add a row, then type a prompt into each.",
          "Toggle the orange pill on each row to include or exclude it from runs.",
          "Drag the handle on the left edge of a row to reorder.",
          "Pick `Queue Text` or `List Prompts` mode using the pills at the top.",
          "Wire `text` to CLIP Text Encode (Queue mode) or wire `prompts` to Prompt From List nodes (List mode).",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["text", "The active row's prompt for the current queue run. Use this in Queue mode."],
          ["prompts", "All enabled prompts as a list. Use this in List mode with Prompt From List Pixaroma nodes."],
        ],
      },
    ],
    footer: "Both outputs are always visible - the mode pill only controls whether the queue loops.",
  },

  "PixaromaPromptPack": {
    title: "Prompt Pack Pixaroma",
    tagline: "Paste a block of prompts and queue one workflow run per prompt automatically.",
    sections: [
      {
        heading: "What it does",
        body: "You paste multiple prompts into one big textarea. When you click Run the node queues the workflow once per non-empty prompt, looping automatically. The counter pill in the textarea's corner shows the total count at idle, then `current / total` during a run.\n\nA split-mode pill at the top controls how prompts are separated: `Paragraph` splits on blank lines (good for long, multi-sentence prompts) and `Line` splits on every newline (good for short one-liners).",
      },
      {
        heading: "How to use",
        bullets: [
          "Paste or type your prompts into the textarea.",
          "Choose `Paragraph` or `Line` split mode using the pill at the top.",
          "Wire the `text` output to CLIP Text Encode.",
          "Click Run - the node queues one workflow per prompt automatically.",
          "Empty or whitespace-only entries are silently skipped.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["text", "The current prompt for this queue run - one entry from the block."],
        ],
      },
    ],
    footer: "If the textarea is empty when you click Run, nothing queues and a message appears.",
  },

  "PixaromaPromptStack": {
    title: "Prompt Stack Pixaroma",
    tagline: "Build one combined prompt from a list of toggleable chunks.",
    sections: [
      {
        heading: "What it does",
        body: "Holds an ordered list of prompt pieces. All enabled pieces are joined into a single string using your chosen separator (default: comma + space, configurable in Settings under `Pixaroma`).\n\nUseful for building prompts modularly: you can mute a style chunk, a color description, or a quality suffix without deleting it.",
      },
      {
        heading: "How to use",
        bullets: [
          "Click `+ Add row` to add a chunk, then type a piece of your prompt into each.",
          "Click the orange pill on a row to toggle it on or off.",
          "Drag the handle on the left edge of a row to reorder.",
          "Wire the `text` output to CLIP Text Encode or a downstream text node.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["text", "All enabled chunks joined into one string, in top-to-bottom order."],
        ],
      },
    ],
    footer: "Trailing commas on each chunk are stripped automatically, so you can be loose with punctuation.",
  },

  "PixaromaPromptFromList": {
    title: "Prompt From List Pixaroma",
    tagline: "Picks one prompt by number from a Prompt Multi list.",
    sections: [
      {
        heading: "What it does",
        body: "A tiny single-purpose node. Connect the `prompts` output of a Prompt Multi Pixaroma node (set to List Prompts mode) and set the `index` to choose which prompt you want. Index 1 returns the first enabled prompt, index 2 the second, and so on.\n\nDrop several of these in a workflow - all wired to the same Prompt Multi - so each section uses a different prompt from the same library.",
      },
      {
        heading: "How to use",
        bullets: [
          "Set your Prompt Multi node to `List Prompts` mode.",
          "Wire its `prompts` output to this node's `prompts` input.",
          "Set `index` to the position of the prompt you want (1-based).",
          "Wire `text` to CLIP Text Encode or any downstream text input.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["text", "The prompt at the chosen index. Returns an empty string if the index is out of range."],
        ],
      },
    ],
  },

  "PixaromaShowText": {
    title: "Show Text Pixaroma",
    tagline: "Inspect anything flowing through your workflow - tensors, prompts, numbers - in a readable text box.",
    sections: [
      {
        heading: "What it does",
        body: "Displays a compact, human-readable description of whatever you wire in. Strings and numbers print as-is. Image tensors show shape, data type, min, and max values. Latents show their sample shape.\n\nThe text box is read-only and scrollable, so long output never forces the node to grow. Hover over the node to reveal a `Copy` button in the corner.",
      },
      {
        heading: "How to use",
        bullets: [
          "Wire any output - prompt text, an IMAGE, a latent, a number - into `source`.",
          "The box updates on every Run.",
          "Hover the node and click `Copy` to copy the displayed text.",
          "The same text is also on the `text` output, so you can chain it forward.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["text", "The text shown in the box, passed through unchanged so you can keep wiring it downstream."],
        ],
      },
    ],
    footer: "Useful for checking what a text node produces, or confirming an image tensor's dimensions before a sampler.",
  },

  "PixaromaPromptReader": {
    title: "Prompt Reader Pixaroma",
    tagline: "Pull the positive prompt saved inside any ComfyUI or Automatic1111 PNG back out as usable text.",
    sections: [
      {
        heading: "What it does",
        body: "Reads the metadata embedded in a PNG and extracts the positive prompt that generated it. Works with ComfyUI workflows (including chained text nodes, SDXL dual encoders, and switch/combine graphs) and with Automatic1111 / Forge images.\n\nThe readout updates the moment you pick a file, so you can read the prompt before running. If the image has no embedded prompt (a JPEG, a screenshot, or a PNG that lost its metadata), the readout explains why.",
      },
      {
        heading: "How to use",
        bullets: [
          "Click `Upload Image` to pick a PNG, or drag one onto the node.",
          "Or use the file dropdown to choose from images already in ComfyUI's input folder.",
          "The prompt appears in the text area immediately.",
          "Wire the `text` output into a CLIP Text Encode or any other text input to reuse the prompt.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["text", "The recovered prompt, or an explanatory message when none was found."],
        ],
      },
    ],
    footer: "Use the Previous / Next arrow buttons to step through images in the input folder quickly.",
  },

  "PixaromaLoadImage": {
    title: "Load Image Pixaroma",
    tagline: "Load an image with built-in resize - max megapixels, longest side, fit inside, crop to fill, and more - in one node.",
    sections: [
      {
        heading: "What it does",
        body: "A drop-in replacement for the native Load Image node with an inline resize panel, so you rarely need a separate resize node downstream. Supports all native features: upload, drag-drop, paste, animated images, and alpha-to-mask extraction.\n\nResize modes: `Off`, `Max megapixels`, `Longest side`, `Scale by`, `Fit inside`, `Crop to fill`, `Match aspect ratio`, and `Pad`. Snap chips, a resample picker, and an upscale toggle round out the controls.",
      },
      {
        heading: "How to use",
        bullets: [
          "Click `Upload`, drag a file onto the node, or paste from the clipboard to load an image.",
          "Use the thumbnail dropdown (with subfolder groups) or the `◀ ▶` arrows to switch between images.",
          "Pick a resize mode chip in the panel. Its controls appear below.",
          "The node shows a live INPUT to OUTPUT size card so you can confirm the final dimensions before running.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The loaded image, after any resize."],
          ["mask", "Alpha channel as a mask (blank if the image has no alpha)."],
          ["width", "Output width in pixels, after any resize."],
          ["height", "Output height in pixels, after any resize."],
          ["filename", "The image filename (without extension)."],
          ["original_width", "Width of the original image before any resize."],
          ["original_height", "Height of the original image before any resize."],
        ],
      },
    ],
    footer: "Replaces Get Image Size + Image Scale chains in most workflows.",
  },

  "PixaromaLoadImagesFolder": {
    title: "Load Images from Folder Pixaroma",
    tagline: "Load many images from any folder and run your workflow on each one, one at a time.",
    sections: [
      {
        heading: "What it does",
        body: "Point it at a folder of images and pick which ones to process. When you Run, it feeds the selected images through your workflow one at a time and gives you a finished result for each. It is a drop-in for Load Image when you want to batch a whole folder: swap it in, wire it the same way, and one Run handles every image. Images can be different sizes.\n\nIt has the same resize options as Load Image Pixaroma (`Max megapixels`, `Longest side`, `Scale by`, `Fit inside`, `Crop to fill`, `Match aspect ratio`), applied to each image as it loads. Resize is `Off` by default.",
      },
      {
        heading: "How to use",
        bullets: [
          "Set the folder: type or paste a path into the folder box, or click `Browse` to navigate your drives and folders and pick one.",
          "Click `Pick images` to open the gallery. Use `Select all`, `First` with a number, or click individual thumbnails to choose exactly what you want.",
          "Wire `image` into your workflow (upscale, restyle, etc.) and `filename` into a Save node so each result keeps its original name.",
          "Hit Run once and leave the batch count at 1. The node processes every selected image by itself.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "Each selected image, one per item, after any resize."],
          ["mask", "Each image's mask from its alpha channel (blank if it has none)."],
          ["width", "Each image's width in pixels (after any resize). Wire into an empty latent so it matches the image's size."],
          ["height", "Each image's height in pixels (after any resize)."],
          ["filename", "Each image's filename without the extension, for naming saved results."],
          ["index", "The 1-based position of each image in this batch (1, 2, 3 ...)."],
          ["total", "How many images are in this batch (how many loaded; same for every item)."],
        ],
      },
    ],
    footer: "Pick 5 images and you get 5 results from one Run. No need to match any batch number.",
  },

  "PixaromaPreview": {
    title: "Preview Image Pixaroma",
    tagline: "Inline image preview with Save, Copy, and Open buttons - batch-aware, with a Strip or Grid layout.",
    sections: [
      {
        heading: "What it does",
        body: "Shows every image in a batch as thumbnails on the node. Click a thumbnail to expand it; use the `◀ ▶` arrow keys (or click the image) to flip through the batch; press `Esc` to collapse. Toggle `Strip` (one row) and `Grid` (fills the body) layouts with the small icon in the preview's top-right corner.\n\nFour buttons act on the selected frame: `Save Disk` saves to a folder you choose, `Save Output` writes to ComfyUI's output folder, `Copy` puts the frame on your clipboard, `Open` opens it in a new tab. Both Save buttons embed the workflow into the PNG so you can drag it back in later.\n\nSet `save_mode` to `save` and the node becomes a drop-in for the native Save Image node: every frame is written to output on each Run.",
      },
      {
        heading: "How to use",
        bullets: [
          "Wire any IMAGE source into `image`.",
          "Leave `save_mode` on `preview` while iterating; switch to `save` for automatic saves.",
          "Use `filename_prefix` to control the output name. Supports subfolders with `/` and date tokens like `%date:yyyy-MM-dd%`.",
          "Click a thumbnail to expand it, then use the arrow keys to browse the batch.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The image(s) passed through unchanged so you can keep wiring downstream."],
        ],
      },
    ],
    footer: "Preview state (selected frame, layout) survives switching workflow tabs.",
  },

  "PixaromaSaveMp4": {
    title: "Save Mp4 Pixaroma",
    tagline: "Encode a frame batch to an H.264 mp4 with optional audio, and watch it play right on the node.",
    sections: [
      {
        heading: "What it does",
        body: "Takes an IMAGE batch and an optional AUDIO track and encodes them to a single mp4 using ffmpeg. A video preview plays on the node body so you can check the result without leaving ComfyUI. Audio is muxed in the same pass.\n\nThe ffmpeg binary is auto-located: if imageio-ffmpeg is installed its bundled exe is used; otherwise ffmpeg on your system PATH is tried.",
      },
      {
        heading: "How to use",
        bullets: [
          "Wire an IMAGE batch into `video_frames` and the frame rate into `fps` (from AudioReact, connect its `video_frames` and `fps`).",
          "Optionally connect an `audio` output to add a soundtrack.",
          "Set `save_mode` to `preview` (temp, auto-cleared on restart) or `save` (kept in output).",
          "Set `filename_prefix` to name the file; a 5-digit counter is added automatically.",
          "Enable `trim_to_audio` to end the video at the audio length.",
        ],
      },
      {
        heading: "Requirements",
        body: "Install imageio-ffmpeg (`pip install imageio-ffmpeg`) for a bundled ffmpeg with no system setup. Width and height must both be even numbers.",
      },
    ],
    footer: "This is a terminal save node - it has no outputs.",
  },

  "PixaromaImageResize": {
    title: "Image Resize Pixaroma",
    tagline: "Resize an image (and its mask) mid-workflow using a set of smart resize modes.",
    sections: [
      {
        heading: "What it does",
        body: "Applies one of eight resize modes to the wired image and its optional mask, then outputs the result with its final pixel dimensions. You can also wire a width, height, or longest-side value from another node to drive the size automatically.",
      },
      {
        heading: "Resize modes",
        defs: [
          ["Off", "Passes the image through unchanged."],
          ["Max megapixels", "Scales down so the image does not exceed a total pixel count. Uses 1 MP = 1024x1024 to stay aligned with standard AI sizes."],
          ["Longest side", "Scales so the longer edge hits the number you set. Works for portrait or landscape without picking an axis."],
          ["Scale by", "Multiplies both dimensions by a factor (2.0 doubles, 0.5 halves)."],
          ["Fit inside", "Fits the image inside a W x H box while keeping the whole image visible and the aspect ratio intact."],
          ["Crop to fill", "Scales and center-crops so the image completely fills a W x H box. Edges may be trimmed."],
          ["Match aspect ratio", "Resizes to a chosen preset ratio, either cropping or padding."],
          ["Pad", "Adds a colored border to reach the target size. The padded area becomes white in the mask (the inpaint region)."],
        ],
      },
      {
        heading: "Wiring a target size",
        body: "Connect a value to `width`, `height`, or `longest_side` from another node (e.g. Resolution Pixaroma) to drive the size. Wire only width or only height for an aspect-preserving scale. Wire both for an exact box. `longest_side` takes priority when connected.",
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The resized image."],
          ["mask", "The resized mask. In Pad mode the added border is white."],
          ["width", "Final output width in pixels."],
          ["height", "Final output height in pixels."],
          ["longest_side", "The longer of the output width and height."],
        ],
      },
    ],
  },

  "PixaromaRemoveBackground": {
    title: "Remove Background Pixaroma",
    tagline: "Cut out the foreground from an image using a BiRefNet AI model.",
    sections: [
      {
        heading: "What it does",
        body: "Runs a BiRefNet neural network over the image and returns a cutout with a transparent background (RGBA), plus a foreground mask and an inverted mask - all three in one pass.",
      },
      {
        heading: "How to use",
        bullets: [
          "Wire an image into `image` and pick a model from the `model` dropdown.",
          "Models live in `ComfyUI/models/background_removal/`. If the dropdown is empty, download one from HuggingFace first.",
          "Filenames containing `matt` or `hr` preprocess at 2048px - better for hair and fine edges. Others use 1024px.",
          "Connect the cutout `image` for compositing, `mask` for inpainting (white = kept foreground), or `inverted_mask`.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The cutout in RGBA - the background is fully transparent."],
          ["mask", "Foreground mask: white where the subject was kept."],
          ["inverted_mask", "Background mask: the foreground mask flipped."],
        ],
      },
    ],
    footer: "Common models: `birefnet.safetensors` (standard), `birefnet-hr.safetensors` (high-res), `birefnet-matting.safetensors` (best for hair / fur).",
  },

  "PixaromaPauseImage": {
    title: "Pause Image Pixaroma",
    tagline: "Pause your workflow mid-run to review an image before the expensive part runs.",
    sections: [
      {
        heading: "What it does",
        body: "Acts as an inline gate on any IMAGE wire. Drop it between an image source (e.g. a KSampler) and expensive downstream work (an upscale, a second pass). In Pause mode only the upstream runs and the image is shown; you then decide whether to continue.",
      },
      {
        heading: "The three modes",
        defs: [
          ["Pause", "Run stops here. The image is shown and a snapshot is saved. The downstream does not run yet."],
          ["Continue", "The upstream is skipped and the saved snapshot is fed downstream. Use this after reviewing, so only the cheaper downstream work runs."],
          ["Pass", "The whole workflow runs end to end, as if this node were not there."],
        ],
      },
      {
        heading: "How to use",
        bullets: [
          "Wire your image source into `image` and wire the output onward.",
          "Set the toggle to `Pause` and press Run. Review the image.",
          "Switch to `Continue` and press Run again - only the downstream runs, fed from the image you saw.",
          "Use `Regenerate` to roll a fresh image at the same point.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The image continuing downstream: the live input in Pause/Pass, or the saved snapshot in Continue."],
        ],
      },
    ],
  },

  "PixaromaSwitch": {
    title: "Switch Pixaroma",
    tagline: "Route one of many wired inputs to a single output by clicking a row toggle.",
    sections: [
      {
        heading: "What it does",
        body: "Accepts up to 32 wired inputs of any type (MODEL, CLIP, IMAGE, STRING, AUDIO, and so on) and passes exactly one of them through to the output unchanged. You choose which row is active by clicking its toggle on the node. Only the active row's upstream branch runs - the others are skipped.",
      },
      {
        heading: "How to use",
        bullets: [
          "Wire upstream nodes into the rows. A new empty row appears as you fill each one.",
          "Click a row's toggle to make it active (the orange highlight marks it).",
          "Click a row's label to rename it so you remember what each input is.",
          "Disconnect a wire to remove its row.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["output", "The value from the active row, passed through unchanged. The output type adapts to whatever is connected."],
        ],
      },
    ],
  },

  "PixaromaSwitchWH": {
    title: "Switch WH Pixaroma",
    tagline: "Toggle between two width/height pairs with one click.",
    sections: [
      {
        heading: "What it does",
        body: "Takes two pairs of width and height values (A and B) and passes one pair to the output. Click `A` or `B` on the node to choose. Useful for flipping between a source image's native size and a chosen resolution without rewiring.",
      },
      {
        heading: "How to use",
        bullets: [
          "Wire a width/height pair (e.g. from Load Image Pixaroma) into `width_a` and `height_a`.",
          "Wire a second pair (e.g. from Resolution Pixaroma) into `width_b` and `height_b`.",
          "Click `A` or `B` to pick which pair flows out.",
          "Always wire both width and height for a side.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["width", "The width from the active source."],
          ["height", "The height from the active source."],
        ],
      },
    ],
  },

  "PixaromaSwitchSource": {
    title: "Switch Source Pixaroma",
    tagline: "Flip a whole set of wires between two setups (A and B) with one toggle.",
    sections: [
      {
        heading: "What it does",
        body: "Each row has an A input and a B input and one output. A single A/B toggle picks which side feeds every row at once. Designed for swapping an entire pipeline in one click - for example switching between local models and API nodes without touching individual wires. Only the chosen side runs.",
      },
      {
        heading: "How to use",
        bullets: [
          "Set the number of rows you need using the `Rows` field.",
          "Wire your first setup into the A inputs (`a_1`, `a_2`, ...) and your second into the B inputs.",
          "Click `A` or `B` to choose which bank runs.",
          "Click an output label to rename it for the row.",
          "`Use connected` lets a row fall back to the other side if the active side is empty; `Strict` raises a clear error instead.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["output_1 ... output_N", "Each row's output carries its A or B input, depending on the active toggle."],
        ],
      },
    ],
  },

  "PixaromaMuteSwitch": {
    title: "Mute Switch Pixaroma",
    tagline: "Toggle whole workflow branches on and off with per-scene pills.",
    sections: [
      {
        heading: "What it does",
        body: "Wire the last node of each branch (usually a KSampler) into a row. Clicking a row's pill skips or enables that entire upstream branch on the next Run. Useful for workflows with several scenes or style variants where you only want to render a subset at a time.",
      },
      {
        heading: "Mode pills",
        defs: [
          ["Single / Multi", "Single is like a radio button - exactly one scene runs. Multi lets any combination run together."],
          ["Mute / Bypass", "Mute means an off scene does not run at all. Bypass means each node passes its input through unchanged."],
        ],
      },
      {
        heading: "How to use",
        bullets: [
          "Wire the last node of each branch into a row (`input_1`, `input_2`, ...).",
          "Click a row's pill to toggle it on (orange) or off (grey).",
          "Rename a row by clicking its label.",
          "Right-click the node for `Enable all rows` / `Disable all rows` shortcuts in Multi mode.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["out", "A phantom pass-through used only to chain Mute Switches together. Carries no real data - do not wire it into regular nodes."],
        ],
      },
    ],
  },

  "PixaromaResolution": {
    title: "Resolution Pixaroma",
    tagline: "One-click resolution picker for AI image sizes, with ratio chips, snap, custom ratios, and math.",
    sections: [
      {
        heading: "What it does",
        body: "Shows a grid of aspect-ratio chips (1:1, 16:9, 9:16, 2:1, 3:2, 2:3, 4:3, 3:4, 4:5). Click a ratio to see its most popular sizes, then click a size to set it. Outputs `width` and `height` as integers ready to wire into an Empty Latent Image or any size input.",
      },
      {
        heading: "Modes",
        defs: [
          ["Preset", "Pick a ratio chip, then a preset size for that ratio. Covers SDXL, AI video, and social media sizes."],
          ["Custom Ratio", "Type any W:H (such as 21:9) and get auto-computed AI-friendly sizes."],
          ["Custom Resolution", "Type exact pixel dimensions. Math expressions like `1024+128` or `512*2` work in the W and H fields."],
        ],
      },
      {
        heading: "Snap",
        body: "The `16`, `32`, and `64` snap chips round the output to that multiple (VAE-friendly). Use `none` to turn it off.",
      },
      {
        heading: "Outputs",
        defs: [
          ["width", "Chosen width in pixels."],
          ["height", "Chosen height in pixels."],
        ],
      },
    ],
  },

  "PixaromaNumber": {
    title: "Number Pixaroma",
    tagline: "One number field that outputs the same value as both INT and FLOAT.",
    sections: [
      {
        heading: "What it does",
        body: "Type a number once and get two outputs: `int` (rounded to the nearest whole number) and `float` (kept with decimals). Handy when one downstream node needs an integer and another needs a decimal from the same value. The field accepts whole numbers, decimals, and math like `1024+64` or `512*2`.",
      },
      {
        heading: "Outputs",
        defs: [
          ["int", "The value rounded to the nearest whole number."],
          ["float", "The value as-is, with decimals preserved."],
        ],
      },
    ],
  },

  "PixaromaWH": {
    title: "WH Pixaroma",
    tagline: "Two number fields for width and height, passed straight through as outputs.",
    sections: [
      {
        heading: "What it does",
        body: "A minimal node with just a `width` and `height` field. Type the size you want and the values come out the other side. Pair it with Switch WH Pixaroma to toggle between a typed size and a size coming from another node.",
      },
      {
        heading: "Outputs",
        defs: [
          ["width", "The width you typed, in pixels."],
          ["height", "The height you typed, in pixels."],
        ],
      },
    ],
  },

  "PixaromaTextOverlay": {
    title: "Text Overlay Pixaroma",
    tagline: "Adds a styled text layer on top of an image, with a fullscreen editor for precise placement.",
    sections: [
      {
        heading: "What it does",
        body: "Draws a single block of styled text over the input image. Configure font, size, weight, italic, alignment, line height, letter spacing, color, opacity, rotation, position, and an optional background bar on the node panel. Click `Open Text Editor` for a fullscreen canvas where you can drag the text to move it, drag a corner to scale, drag the handle to rotate, use snap guides, or align to canvas edges.",
      },
      {
        heading: "Inputs",
        defs: [
          ["image", "Required image to draw the text on."],
          ["text", "Optional wire from any STRING source. When connected it replaces whatever text is typed on the panel (the box greys out as a reminder)."],
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The input image with your text drawn on top."],
        ],
      },
    ],
    footer: "Vertical text direction is supported via the `Horizontal | Vertical` toggle in the panel.",
  },

  "PixaromaTextWatermark": {
    title: "Text Watermark Pixaroma",
    tagline: "Stamps a styled text watermark at a fixed anchor on every image in a batch.",
    sections: [
      {
        heading: "What it does",
        body: "Adds a text watermark to an image or a whole batch. Unlike Text Overlay there is no fullscreen editor - you configure everything on the node panel and hit Run. Position is set by choosing one of nine anchor points (a corner, edge midpoint, or center) plus a margin inset, so the watermark lands in the same relative spot on every image regardless of its size.",
      },
      {
        heading: "Size mode",
        body: "Switch between `px` (a fixed pixel size) and `% width` (a percentage of each image's width). Percentage mode keeps the watermark visually the same across a batch of mixed resolutions.",
      },
      {
        heading: "Inputs",
        defs: [
          ["image", "Image or batch to stamp the watermark onto."],
          ["text", "Optional wire from any STRING source. When connected it replaces the panel text (the box greys out)."],
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The input image(s) with the watermark drawn on top."],
        ],
      },
    ],
    footer: "Vertical text direction is supported via the `Horizontal | Vertical` toggle.",
  },

  "NotifyPixaroma": {
    title: "Notify Pixaroma",
    tagline: "Plays a sound in your browser when this node is reached during a workflow run.",
    sections: [
      {
        heading: "What it does",
        body: "Drop one at the end of a workflow to hear when rendering is done, or branch one off any node to get an audio alert at a checkpoint. Useful when you are in another tab or app while ComfyUI runs. The sound fires every Run even when upstream is cached.",
      },
      {
        heading: "Inputs",
        defs: [
          ["any", "Wire any node output here. The data passes through untouched - this node only listens for when it is reached."],
          ["enabled", "Per-node mute switch. Turn it off to silence just this node."],
          ["sound", "Which sound to play. Lists every `.mp3`, `.wav`, and `.ogg` in the `assets/sounds/` folder. Add your own there (then restart ComfyUI)."],
          ["volume", "Playback volume from 0 (silent) to 100 (full)."],
          ["label", "Optional name shown in the browser console when the node fires. Helpful with several Notify nodes in one workflow."],
        ],
      },
    ],
    footer: "The `Preview` button plays the sound now, ignoring the toggles. A global on/off lives in Settings - Pixaroma - Notify.",
  },

  "PixaromaReferenceNode": {
    title: "Reference Node",
    tagline: "Developer reference node demonstrating the DOM widget pattern. Not for production workflows.",
    sections: [
      {
        heading: "What it does",
        body: "An internal example node used during development to test the custom DOM widget pattern. It outputs a STRING and is not useful in regular workflows.",
      },
    ],
  },

  "Pixaroma_VueReferenceNode": {
    title: "Pixaroma Vue Reference Node",
    tagline: "Developer reference node for the Nodes 2.0 API. Not for production workflows.",
    sections: [
      {
        heading: "What it does",
        body: "An internal example node used during development to test the Nodes 2.0 (Vue) API. It inverts an input image as a demo and is not useful in regular workflows.",
      },
    ],
  },

  "PixaromaVersionCheck": {
    title: "Version Check Pixaroma",
    tagline: "Shows your ComfyUI, frontend, node renderer, and Pixaroma version numbers in one place.",
    sections: [
      {
        heading: "What it does",
        body: "Displays four lines: ComfyUI backend version, ComfyUI frontend version, which node interface is active (`Nodes 2.0` or `Legacy`), and the installed Pixaroma version. Click `Copy` to copy all four as plain text for a bug report. Click the `Node UI` row to switch renderers (the page reloads). Click `Refresh` for a hard cache-clearing reload.",
      },
    ],
    footer: "No inputs, no outputs, no work on Run - it is a pure info panel.",
  },
};

for (const [cls, def] of Object.entries(HELP)) registerNodeHelp(cls, def);
