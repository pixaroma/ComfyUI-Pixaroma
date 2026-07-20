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
  "PixaromaLoadImageMini": {
    title: "Load Image Mini Pixaroma",
    tagline: "A compact Load Image: upload, pick, preview, and just two outputs. All the resize controls tuck into the gear.",
    sections: [
      {
        heading: "What it does",
        body: "This is the small version of Load Image Pixaroma. It loads a picture from ComfyUI's input folder and gives you a clean, minimal node - a toolbar, the file picker, and a preview - with only two outputs so it does not clutter the canvas.\n\nEverything the full Load Image can do is still here. The upload, paste and drag-drop all work, and Open in MaskEditor and Copy/Paste (Clipspace) behave exactly as they do on the full node.",
      },
      {
        heading: "The toolbar",
        defs: [
          ["Upload", "Choose an image file from your computer."],
          ["Paste", "Paste an image from the clipboard (or press Ctrl+V while the node is selected)."],
          ["Gear", "Open the settings panel: the resize modes, snap, resample, upscaling, and this node's accent colour."],
        ],
      },
      {
        heading: "Picking a file",
        body: "Use the arrows to flip through the images in your input folder one at a time (PageUp / PageDown also work), or click the filename to open the picker and choose from thumbnails. You can also drag an image straight onto the node.",
      },
      {
        heading: "Resize lives in the gear",
        body: "To keep the face small, all the resizing lives in the gear settings panel: Max megapixels, Longest side, Scale by, Fit inside, Crop to fill, and Match ratio, plus snap and the resample filter. It is the same resize engine as the full Load Image. Padding is not here on purpose - use Outpaint Pixaroma for that.\n\nThe two small cards on the face show the input size and the resulting output size so you can see the resize at a glance.",
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The loaded picture, after any resize you set in the gear."],
          ["image_info", "A small bundle carrying the mask, width, height and filename. Wire it into Image Info Pixaroma only when you need those extras - that is what keeps this loader small."],
        ],
      },
    ],
    footer: "Need the mask, width, height or filename? Add an Image Info Pixaroma node and wire image_info into it.",
  },

  "PixaromaImageInfo": {
    title: "Image Info Pixaroma",
    tagline: "Unpacks the image_info bundle from Load Image Mini into the mask, size and filename you need.",
    sections: [
      {
        heading: "What it does",
        body: "Load Image Mini keeps its face small by sending everything except the image through a single image_info output. This node opens that bundle back up. Wire it in only when you actually need the extras, so the loader itself stays compact.\n\nThe width, height and filename also show on this node's own face (in the Classic renderer), so a quick glance often saves you from pulling any wires at all.",
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The picture (the same one the loader's image output carries)."],
          ["mask", "The mask from the image's transparency, ready for inpainting. Blank if the image has no alpha."],
          ["width", "The image width in pixels, after any resize."],
          ["height", "The image height in pixels."],
          ["filename", "The image's file name."],
        ],
      },
    ],
    footer: "Connect the image_info output of a Load Image Mini Pixaroma node into this node's image_info input.",
  },

  "PixaromaOutpaint": {
    title: "Outpaint Pixaroma",
    tagline: "Add a solid-colour border around your image so an outpainting model can paint new scenery into it.",
    sections: [
      {
        heading: "What it does",
        body: "Outpainting means extending a picture beyond its edges. This node makes the room for that: it pads your image with a plain fill colour, and an outpainting model then replaces that fill by continuing the scene into it.\n\nThe fill is neutral grey by default. Grey is used because a strongly coloured fill can tint the whole result - a model trained to replace green tends to leave a green cast everywhere. You can change the fill by clicking the colour swatch, but grey is the safe choice.",
      },
      {
        heading: "The two modes",
        defs: [
          ["To ratio", "Grow the image to a target shape, like 16:9 or 3:2. The node works out how much fill to add. Pick which ratios appear in the settings (the gear)."],
          ["By side", "Add an exact number of pixels to a chosen edge. Drag a green edge in the preview to set it by hand; this also switches you to By side automatically."],
        ],
      },
      {
        heading: "Add space: which side gets the fill",
        body: "In To ratio mode, only one direction ever grows. The Add space row picks the side the new fill goes on:",
        bullets: [
          "`Left` / `Right` (or `Top` / `Bottom`) put all the new fill on that one side, so the original image sits against the opposite edge.",
          "`Both` splits the new space evenly across both sides, keeping the image centered.",
          "If the ratio already matches your image, nothing grows and the row is greyed out.",
        ],
      },
      {
        heading: "Limit and the size cards",
        body: "The limit chips optionally shrink the padded result to a megapixel target so it stays a sane size to generate. `Off` means no scaling at all - the output is exactly the padded size.\n\nThe INPUT and OUTPUT cards show the real sizes, and the OUTPUT card turns orange when the size changes. The badge on the preview always shows the true final numbers.",
      },
      {
        heading: "Preview: picture vs badge",
        body: "The preview draws the composition - your image with the fill bands around it, at the same proportions the output will have. After a megapixel limit the real output is smaller than the picture looks, so trust the badge for the true size. The picture shows the shape; the badge shows the numbers.\n\nBehind a Load Image the preview is live right away. Behind a generated image (a VAE Decode), it appears after one Run.",
      },
      {
        heading: "Keeping the original at full quality",
        body: "When you scale a large image down with the limit so the model can handle it, the whole picture goes through the model and the original half comes back a little softer and smaller. If you want the original part back at full quality, wire the `outpaint_info` output into an Outpaint Stitch Pixaroma node along with the finished image. It puts your original back exactly and keeps only the new area the model made. This is optional - if you do not wire it, nothing changes.",
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "Your image with the fill border added (and scaled to the limit, if one is set)."],
          ["width", "The final width in pixels - the badge number."],
          ["height", "The final height in pixels."],
          ["outpaint_info", "Optional. Carries your original image and where it sits, for Outpaint Stitch Pixaroma. Leave it unused if you do not need the original restored."],
        ],
      },
    ],
    footer: "This node only adds the fill area. The actual outpainting is done by your model or LoRA, which usually needs its own trigger words in the prompt to know it should fill the solid area - set those up with your prompt and loader nodes as that model requires.",
  },

  "PixaromaOutpaintStitch": {
    title: "Outpaint Stitch Pixaroma",
    tagline: "Put your pristine original back onto an outpaint result, keeping only the newly generated area.",
    sections: [
      {
        heading: "What it does",
        body: "When you outpaint a large image, you usually have to scale it down first so the model can handle it. That sends the whole picture - including the part you wanted to keep - through the model, which softens it. This node fixes that: it scales the finished result back up to full size and drops your original image back over its own area, pixel-for-pixel. Only the new area the model painted is kept from the generated image.",
      },
      {
        heading: "How to wire it",
        bullets: [
          "Wire the `outpaint_info` output of Outpaint Pixaroma into `outpaint_info` here.",
          "Wire the finished image (after VAE Decode) into `image`.",
          "That is it - the node knows where the original goes from the info.",
        ],
      },
      {
        heading: "Feather",
        body: "`feather` softens the join between your original and the new area, fading the original edge into the generated part over that many pixels. A little usually looks best, because the new area was blended to a re-encoded copy of your original, not the exact one, so there can be a faint step at the seam. Set it to 0 for a hard edge. Only the edges next to the new area are softened - the real picture edges stay sharp.",
      },
      {
        heading: "About the seam",
        body: "This will not be as invisible as Image Uncrop, and that is expected. The whole picture went through the model, so the generated area matches a slightly shifted version of your original. Feather hides most of it, and for extending scenery (sky, ground, walls, water) the join is usually not noticeable.",
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The full-size image: the model's new area with your pristine original pasted back over its region."],
          ["mask", "White marks the new area, black the untouched original. Feed it into a refine or inpaint pass if you want to sharpen just the new part."],
        ],
      },
    ],
    footer: "Optional companion to Outpaint Pixaroma. Skip it and the plain Outpaint result works fine; add it when you scaled a big image down and want the original half back at full quality.",
  },

  "PixaromaSeed": {
    title: "Seed Pixaroma",
    tagline: "A seed source with one-click random and fixed control - wire it into any sampler's seed input.",
    sections: [
      {
        heading: "What it does",
        body: "Holds a seed number and sends it out as `seed`. Drag the output into the seed input of KSampler (or any node that takes a seed). One Seed node can feed several samplers at once so they all stay on the same seed.",
      },
      {
        heading: "Modes",
        defs: [
          ["Random", "Rolls a fresh seed every time you Run, and the big number updates to show the seed that actually made the latest image (so it changes each Run)."],
          ["Fixed", "Keeps the same seed every Run, so the result is repeatable."],
        ],
      },
      {
        heading: "Buttons",
        defs: [
          ["New fixed random", "Rolls a brand-new random seed and locks it (switches to Fixed). Use it when a random result is great and you want to keep that exact seed."],
          ["Use last seed", "Loads the seed from the previous run and locks it. Perfect for making variations off the image you just liked. It works within the current session only, so after you reload or reopen the workflow it stays greyed out until you Run once."],
          ["Copy", "Copies the current seed to your clipboard."],
          ["Up / down arrows", "The small ▲ / ▼ arrows next to the seed nudge it by one and lock it (Fixed). Hold an arrow to keep counting. Great for trying the seeds right next to one you like."],
        ],
      },
      {
        heading: "Size and settings",
        body: "Right-click the node for a few things: a one-click Compact size / Full size flip, a Seed settings panel, and a Seed history list. Compact shrinks the node to a single row (the seed with small up/down arrows, a Random/Fixed toggle, and an N button that rolls a new fixed random seed) so it takes less room; Full brings all the buttons back. To copy the seed in compact mode, hover over the number: a small popup shows the full seed with a copy button (handy since a long seed can get trimmed in the small field). Your choice of size is saved with the workflow.\n\nThe Seed settings panel also sets the size every NEW Seed node starts at (the same as ComfyUI Settings, under Pixaroma then Seed), so you can have them all come in compact if you like.",
      },
      {
        heading: "Random seed digits",
        body: "In the Seed settings panel you can cap how big a Random seed is, from 3 up to 16 digits. Lower it if you want short, easy-to-remember seeds or another tool expects a smaller number (3 digits gives seeds from 0 to 999; 8 digits gives 0 to 99999999). It only changes the Random roll; typing an exact seed always works, whatever the setting.",
      },
      {
        heading: "Seed history",
        body: "Open it from the H button (in Full size, top row next to New fixed random) or by right-clicking the node and choosing Seed history. It shows the last 10 seeds you have run. From the list you can Use a seed (it loads onto this node and locks to Fixed), Copy it, or Export the whole list as a text file. The history is shared across all your Seed nodes and is kept even after you reload, so a seed you liked earlier is still there.",
      },
      {
        heading: "Put the seed in your file names",
        body: "You can print the seed into a saved file name. In a Save Image, Save Mp4 Pixaroma, or Preview Image Pixaroma node's filename field, type `%Seed Pixaroma.seed%` where you want the number, for example `portrait_%Seed Pixaroma.seed%`. On save it becomes `portrait_2137`.\n\nAlways point at THIS node, not the sampler: `%Seed Pixaroma.seed%`, not `%KSampler.seed%` (once wired, the sampler no longer holds the number, this node does). If you rename this node on the canvas, use the new name in the token. With more than one Seed node, rename them so each token points at the right one.",
      },
      {
        heading: "Tips",
        bullets: [
          "Type a number in the big field to set an exact seed (it switches to Fixed).",
          "In Fixed mode the same seed runs every time; in Random mode a new one rolls each Run.",
          "When you wire this into KSampler it takes over the seed, so KSampler's own seed control greys out. Use the Random and Fixed buttons here instead.",
          "The seed is picked in your browser. If you run a workflow through the API with no browser open, use Fixed with a set number (Random falls back to 0 there).",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["seed", "The chosen seed as a whole number."],
        ],
      },
    ],
    footer: "Found a seed you love in Random mode? Hit Use last seed (or New fixed random) to lock it, then tweak the rest of your workflow with confidence.",
  },

  "PixaromaLoopStart": {
    title: "Loop Start Pixaroma",
    tagline: "The opening bracket of a loop - repeat a section of your workflow a set number of times.",
    sections: [
      {
        heading: "What it does",
        body: "Put your nodes BETWEEN Loop Start and Loop End and that whole section runs again and again. Set `total` to the number of rounds. Use it to build a long video in chunks, grow a batch of images, or run the same step over and over.\n\nIt always comes as a pair with `Loop End` - wire Loop Start's `loop` output into Loop End's `loop` input so the two brackets know they belong together.",
      },
      {
        heading: "Carrying values between rounds",
        body: "The `value` slots are for things you want to hand from one round to the next - the frames built so far, a running total, the last image, and so on. Whatever a round produces, feed it back into the matching slot on `Loop End`, and `Loop Start` hands it to the next round. Leave the value slots empty if your loop does not need to carry anything.",
      },
      {
        heading: "Outputs",
        defs: [
          ["value1...value5", "The carried values for this round. Only use as many as you need."],
          ["loop", "Wire this into Loop End's loop input to pair the two brackets."],
          ["index", "Which round you are on, counting from 0 (0, 1, 2 ...). Handy for picking a different frame or value each round."],
        ],
      },
      {
        heading: "Tips",
        bullets: [
          "Pair it with `Combine Pixaroma` inside the loop to pile up each round's result (round 1 + round 2 + ...).",
          "`total` is how many rounds run. The loop body runs exactly that many times.",
          "If a value slot is empty it just carries nothing - that is fine.",
        ],
      },
    ],
    footer: "Loop Start and Loop End always work together: put your work between them, and feed Loop End's values back to carry them forward.",
  },

  "PixaromaLoopEnd": {
    title: "Loop End Pixaroma",
    tagline: "The closing bracket of a loop - sends each round back around, then outputs the final result.",
    sections: [
      {
        heading: "What it does",
        body: "Marks the end of the repeating section. Wire `loop` from `Loop Start`. Into the `value` slots, feed whatever you want carried to the next round (often a `Combine` node that gathers each round's frames). After the last round finishes, the value slots output the final carried values.",
      },
      {
        heading: "How to use",
        bullets: [
          "Wire `loop` from Loop Start's loop output.",
          "Put your generation nodes between Loop Start and Loop End.",
          "Feed the result you want to keep building into a `value` slot here - it loops back to Loop Start for the next round.",
          "Wire the matching output (value1, value2 ...) onward to use the final result after all rounds are done.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["value1...value5", "The final carried values after the last round. Match them to the value slots you fed in."],
        ],
      },
    ],
    footer: "Think of Loop Start and Loop End as brackets around the part you want to repeat. Everything between them runs each round.",
  },

  "PixaromaCombine": {
    title: "Combine Pixaroma",
    tagline: "Join two inputs into one batch - images, video frames, latents, numbers, or text.",
    sections: [
      {
        heading: "What it does",
        body: "Takes any two inputs and merges them into one. Images and video frames are stacked into a single bigger batch; latents are batched the same way; numbers and text are gathered into a list. If different-sized images come in, the second is resized to match the first.",
      },
      {
        heading: "What you can join",
        body: "Both inputs must be the SAME kind of thing:",
        bullets: [
          "image + image -> one bigger image batch (for example 3 frames stacked together)",
          "video frames + video frames -> a longer clip",
          "latent + latent -> a batched latent",
          "number + number -> a list, like 0 then 1 then 2",
          "text + text -> a list of words",
        ],
      },
      {
        heading: "Good to know",
        bullets: [
          "You can't mix kinds. An image plus text, or a latent plus a number, stops with a clear message - wire two of the same kind instead.",
          "An empty input is fine - Combine just passes the other side through. That is why it works as a loop accumulator from round 1.",
          "Different-sized images: the second one is resized to match the first (whatever you wire into `any1` sets the size).",
        ],
      },
      {
        heading: "Using it in a loop",
        body: "Combine shines as the 'pile-up' node inside a loop. Wire the running total into `any1` and the new round's result into `any2`, then carry the output back through `Loop End`. Each round adds onto the pile. On the very first round one side is empty - Combine just passes the other side through, so it works from round 1 with no special setup.",
      },
      {
        heading: "Outputs",
        defs: [
          ["batch", "The two inputs joined together. For images and frames this is one larger batch; for numbers and text it is a list."],
        ],
      },
    ],
    footer: "Empty input? Combine passes the other side through, so it is safe to use as an accumulator from the very first round.",
  },

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
          "To keep transparency, also wire a MASK into the `mask` input (for example Load Image's MASK output) - it gets cut with the exact same box.",
          "Adjust the crop rectangle using the panel fields or click `Open Crop Editor` for the fullscreen editor with handles.",
          "Choose a preset ratio (1:1, 16:9, 9:16, and more) or leave it on `Free`.",
          "Run the workflow to output the cropped result.",
          "To put an edited crop back later, wire the `crop_info` output into Image Uncrop Pixaroma.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The cropped image."],
          ["mask", "The cropped mask, cut with the same box as the image. Wire a MASK in (such as Load Image's MASK) to carry transparency through the crop; otherwise it is a fully-opaque mask sized to the crop."],
          ["crop_info", "Feed this into Image Uncrop Pixaroma to paste an edited version of the crop back onto the original image at the exact same spot."],
          ["width", "Width of the cropped area in pixels."],
          ["height", "Height of the cropped area in pixels."],
        ],
      },
    ],
  },

  "PixaromaUncrop": {
    title: "Image Uncrop Pixaroma",
    tagline: "Paste an edited crop back onto the original image at the exact spot it came from.",
    sections: [
      {
        heading: "What it does",
        body: "The other half of the crop, fix, then put it back workflow. After you crop a region with Image Crop Pixaroma and edit it (upscale, inpaint, face-fix, color work, anything), this node drops the edited piece back onto the full original image at the exact same place, leaving everything else untouched.\n\nIt knows where to paste from the `crop_info` wire, and it automatically resizes the edited crop to fit the original region (so upscaling the crop first is fine). Transparency travels through too: the `mask` output is the whole image's mask, not just the cropped rectangle.",
      },
      {
        heading: "How to use",
        bullets: [
          "Wire the `crop_info` output of Image Crop Pixaroma into this node's `crop_info`.",
          "Wire your edited crop into `image`.",
          "To keep transparency, wire Image Crop's `mask` straight across into `mask` (it lines up under image). The mask comes back out full-frame.",
          "Optionally raise `feather` for a soft, seamless edge where the crop meets the original.",
          "Run the workflow to get the recombined full image.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The original image with the edited crop pasted back in place."],
          ["mask", "The full-frame mask: the original mask with the crop region updated. Use it to keep transparency (e.g. into Join Image with Alpha)."],
          ["crop_info", "The same crop_info passed straight through, so you can forward it on without re-routing the wire from Image Crop."],
        ],
      },
    ],
  },

  "PixaromaInpaintCrop": {
    title: "Inpaint Crop Pixaroma",
    tagline: "The easy way to set up an inpaint - paint a mask, get a model-ready crop automatically.",
    sections: [
      {
        heading: "What it does",
        body: "Open the fullscreen editor and paint a mask over the part of the image you want to fix. The node finds the box around your mask, adds a context margin so the model can see the surroundings, and crops a clean, model-friendly piece (sized to a multiple of 8 and scaled toward your target, so even a small masked area gets enough resolution to look sharp).\n\nWire the cropped `image` and `mask` into your inpaint model (KSampler, Flux, edit models), then send `crop_info` into Inpaint Stitch Pixaroma to drop the result back in place. The orange box in the editor shows exactly what will be cropped as you paint. You also set how the seam blends here, with the `Softness` slider, and watch it preview live in a tint color you can switch (red, green, blue, yellow, orange) so it stays visible on any subject.",
      },
      {
        heading: "How to use",
        bullets: [
          "Wire an image in, or drag-drop / paste one onto the node body.",
          "Click `Open mask editor` and paint over the area to change. Use Brush / Erase (B / E), the size slider or `[` `]`, Clear and Invert. Scroll the wheel to zoom in for fine detail; hold Space and drag (or middle-drag) to pan.",
          "In the editor, drag `Softness` to set how soft the seam blends - the preview shows it live. Softness, blend mode, mask grow, crop size and context are on the node AND mirrored in the editor, so set them wherever is handier.",
          "Click `Save`, then wire `image` and `mask` into your inpaint model.",
          "Send `crop_info` to Inpaint Stitch Pixaroma.",
        ],
      },
      {
        heading: "Settings",
        defs: [
          ["softness", "How far the seam feathers when the crop is pasted back. Higher values grow the crop a little so the soft blend has room (you'll see the crop box expand). The editor previews it live; it travels to Inpaint Stitch automatically."],
          ["blend mode", "How the result is pasted back. Mask: only the area you painted is replaced, the rest of the crop keeps the original (the normal inpaint). Whole crop: the ENTIRE cropped box is replaced with the model's version - use when the model also relit or changed the surroundings, or for an img2img-style pass."],
          ["size mode", "Keep shape scales the long side to the target with no stretching (best quality). Force size outputs a square. Free keeps the natural size."],
          ["context px", "How much surrounding area to include around your mask."],
          ["mask grow / blur", "Expand the mask before cropping, and soften the mask the model sees."],
          ["invert mask", "Flip the mask so the inpaint hits the OPPOSITE area (swap subject and background). Works on a wired or painted mask - no separate Invert Mask node needed."],
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The cropped region, sized for the model."],
          ["mask", "The matching cropped mask. Wire it into SetLatentNoiseMask or your inpaint conditioning."],
          ["crop_info", "Carries the original and where the crop came from. Wire it into Inpaint Stitch Pixaroma."],
          ["width / height", "The crop size in pixels, handy for an empty latent or edit models."],
        ],
      },
    ],
    footer: "The `crop_info` wire is the same type Image Crop uses, so the two are interchangeable.",
  },

  "PixaromaInpaintStitch": {
    title: "Inpaint Stitch Pixaroma",
    tagline: "Paste your inpainted crop back onto the original, blended so the seam disappears.",
    sections: [
      {
        heading: "What it does",
        body: "The other half of the inpaint workflow. After Inpaint Crop Pixaroma cropped a region and you ran your model on it, this node resizes the result back and blends it into the original at the exact spot. By default only the painted area changes, so everything else stays pixel-perfect.\n\nThe seam softness and blend mode start from the Inpaint Crop Pixaroma node and ride the `crop_info` wire, but you can OVERRIDE them right here (`softness` -1 = use the crop's) along with `color match`. The big win: this node is AFTER the sampler, so changing any of them re-runs only this node - the sampler stays cached on a fixed seed - meaning you can fine-tune the blend instantly without re-generating the image. `color match` corrects a color or tone shift the model introduced by matching the unchanged surroundings around your mask (keep it Off when you deliberately changed colors). It also hands back the untouched `original` so you can compare before and after.",
      },
      {
        heading: "How to use",
        bullets: [
          "Wire the `crop_info` output of Inpaint Crop Pixaroma into `crop_info`.",
          "Wire your inpainted crop (after the model) into `image`. It is resized back automatically.",
          "Run the workflow to get the finished full image.",
          "To fine-tune the blend WITHOUT re-generating: change `softness`, `blend mode` or `color match` HERE and run again - only this node re-runs, the sampler is cached (fixed seed), so it's instant.",
          "Wire `image` and `original` into Image Compare Pixaroma for an instant before / after.",
        ],
      },
      {
        heading: "Settings",
        defs: [
          ["softness", "Seam feather, overriding the Crop node's. -1 = use the Crop node's value; 0-150 tunes the blend here, instantly (no re-sample). Bigger than the room the crop left may show a slightly harder edge - raise the Crop node's softness for more room."],
          ["blend mode", "from crop = use what the Crop node set. mask = replace only the painted area. whole crop = replace the entire cropped box. Changing it here re-runs only this node."],
          ["color match", "Correct a color/tone shift the model introduced, matching the unchanged surroundings around your mask. Off for deliberate color changes (it would pull them back). No live preview - set it and re-run."],
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The original image with the inpainted crop blended back in place."],
          ["original", "The full original uncropped image, for a before / after compare."],
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
        heading: "Follow a connected image",
        body: "Wire an image's filename into the optional `filename` input (for example from Load Image Pixaroma's `filename` output) and the node reads that image's prompt automatically. While the wire is connected it ignores its own picker, and the readout follows the connected node live as you switch images.\n\nTo go back to picking manually, just upload, drop, or pick a file on the node - that takes over and disconnects the wire.\n\nOnly images that actually have a prompt baked in (a PNG made by ComfyUI / A1111 / Forge) can be read. A JPEG or plain photo carries no prompt.\n\nNote: the connected filename does not include the subfolder, so if you keep two images with the exact same name in different input subfolders, the run may read the wrong one. Give them distinct names to be safe (the live readout in the node always shows the correct one).",
      },
      {
        heading: "Inputs",
        defs: [
          ["filename (optional)", "A filename to read from, usually wired from Load Image Pixaroma's `filename` output. When connected it drives the read and overrides the picker."],
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

  "PixaromaSaveImage": {
    title: "Save Image Pixaroma",
    tagline: "Save images to any folder on your computer, with a live preview of the exact filename.",
    sections: [
      {
        heading: "What it does",
        body: "Saves every image it receives to the folder you choose: type or paste any path, click `Browse` to pick one with the normal system dialog, or leave the field empty to use ComfyUI's output folder. The `Will save as` line always shows the exact file the next run will create, so complex naming patterns are never a surprise.\n\nBatches are handled automatically: every frame is saved with the counter increasing, and files never overwrite existing ones. Type `/` in the name to create subfolders, so `%date:yyyy-MM-dd%/image_%counter%` makes a folder per day.\n\nThe saved images show in a big preview on the node, so you do not need a separate preview node: one image fills the area, a batch shows as a grid. Click a picture in the grid to view it big, click it (or hover for the `◀ ▶` arrows) to flip through, and `✕` returns to the grid. Very large batches preview the first 16 images (every frame still saves). Resize the node to make the preview bigger.",
      },
      {
        heading: "Filename tokens (click the chips to insert them)",
        defs: [
          ["%input%", "The wired name input, e.g. the filename from Load Image Pixaroma, so results keep the original name."],
          ["%date:yyyy-MM-dd%", "The save date and time. Codes: yyyy year, MM month, dd day, hh hours, mm minutes, ss seconds. Careful: capital MM is the MONTH, lowercase mm is MINUTES (same rule as ComfyUI's built-in Save Image), so a date is yyyy-MM-dd and a time is hh-mm-ss."],
          ["%counter%", "An auto-increasing number that continues from the highest one already in the folder. Without %counter% in the name, the node still never overwrites: a taken name gets a _001 style ending added automatically (batches too, following your counter digits setting)."],
          ["%year% %month% %day% %hour% %minute% %second%", "Native ComfyUI tokens, same values as the built-in Save Image node. %date:...% does the same thing in a shorter form."],
          ["%width% / %height%", "The image size in pixels."],
          ["%batch_num%", "The frame's position inside a batch (0, 1, 2 ...)."],
          ["%Seed Pixaroma.seed%", "A node reference: prints another node's value into the name, like the seed that made the image. The `+ Model` chip builds one automatically for your model loader, so the model's name lands in the filename."],
        ],
      },
      {
        heading: "Format and settings",
        bullets: [
          "`PNG` is lossless, keeps transparency, and embeds the workflow: drag a saved PNG back into ComfyUI to reload everything with the exact seed that made it.",
          "`JPG` makes much smaller files with a quality setting. ComfyUI cannot reload workflows from JPG files, so pick PNG when that matters.",
          "`Mode` switches between `Save` (files are written on every run) and `Preview` (the images show on the node but nothing goes to your folder; frames use ComfyUI's temporary folder, cleared on restart). So the node can also replace a preview node while you iterate.",
          "`Copy`, `Open`, and `Folder` sit in the button row: Copy puts the shown image on your clipboard, Open shows it in a new browser tab, Folder opens the save location in your file explorer (the window can appear on the taskbar instead of in front; that is a Windows limitation). Right-clicking the preview image gives the same `Open image`, `Copy image`, and `Save image` (download) options.",
          "Right-click the node for `Save Image settings`: date style (the order the + Date chip inserts, e.g. dd-MM-yyyy), counter digits (how many zeros %counter% uses), JPG quality, and workflow embedding on or off. `Reset node size` in the same menu returns the node to its default size.",
        ],
      },
    ],
    footer: "The preview and the line under it show exactly what landed on disk in the last run.",
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
          "Click `Pick images` to open the gallery. Use `Select all`, type a number in the `First` box to grab the first few (it selects as you type), or click individual thumbnails to choose exactly what you want.",
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
          "Use `filename_prefix` to control the output name. Supports subfolders with `/`, date tokens like `%date:yyyy-MM-dd%`, and node references like `%Seed Pixaroma.seed%` that print another node's value into the name (in `save` mode, and the Save Disk / Save Output buttons).",
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
          "Set `filename_prefix` to name the file; a 5-digit counter is added automatically. You can print another node's value into the name with a token like `%Seed Pixaroma.seed%`.",
          "Enable `trim_to_audio` to end the video at the audio length.",
        ],
      },
      {
        heading: "Requirements",
        body: "Save Mp4 needs a free tool called ffmpeg to turn the frames into a video. Most ComfyUI setups already have it (for example if the Video Helper Suite nodes are installed), so usually there is nothing to install. One rule: the frame width and height must both be even numbers, and the node shows a clear message instead of crashing if they are odd.\n\nOnly if you see an \"ffmpeg not found\" message, add it one of these ways:",
        bullets: [
          "Easiest: in ComfyUI Manager, open its pip install option and enter `imageio-ffmpeg`.",
          "Portable ComfyUI (Windows): open a command window in your ComfyUI folder (the one that holds the `python_embeded` folder) and run `python_embeded\\python.exe -m pip install imageio-ffmpeg`.",
          "Installed with your own Python (venv or conda): activate that environment and run `pip install imageio-ffmpeg`.",
        ],
      },
      {
        heading: "Workflow inside the video",
        body: "The full workflow is saved inside the mp4 (in its comment metadata), the same way it is saved inside a PNG. So you can drag a saved mp4 back into ComfyUI later to rebuild the whole graph. Reading it back needs a video pack such as Video Helper Suite installed (it adds the drag-a-video support). The frame width and height must be even numbers.",
      },
    ],
    footer: "This is a terminal save node, it has no outputs.",
  },

  "PixaromaLoadVideo": {
    title: "Load Video Pixaroma",
    tagline: "Upload or pick a video, decode it to frames plus audio and info, and preview it right on the node.",
    sections: [
      {
        heading: "What it does",
        body: "Loads a video from ComfyUI's input folder and turns it into a batch of image frames you can feed into any image or video workflow. A video preview plays on the node body so you can check the clip without leaving ComfyUI.\n\nThe details you usually need are built in as separate outputs, so you do not need a second 'video info' node.",
      },
      {
        heading: "How to use",
        bullets: [
          "Click `choose video to upload` to add a file from your computer, or pick one from the dropdown (use the arrows to flip through).",
          "Wire `video_frames` into an image or video node. To rebuild a video later, send `video_frames` and `audio` straight into Save Mp4 Pixaroma.",
          "The clip plays in the preview as soon as it is selected, no need to run first.",
        ],
      },
      {
        heading: "Loading controls",
        defs: [
          ["Max frames", "How many frames to load from the start of the video. 0 = all. The safety valve for long clips: it never reads more than this many. Skip first frames then trims the front (Max 100 with Skip 5 gives 95)."],
          ["Force FPS", "Force a steady frames-per-second by dropping or duplicating frames (a 60fps clip forced to 24). 0 = keep the original rate. AI video models usually expect a fixed rate."],
          ["Skip first frames", "Skip this many frames from the start, like trimming an intro. Trims the front of the loaded frames."],
          ["Custom width / height", "Resize each frame as it loads. 0 = keep original. Set one to scale proportionally; set both to crop-to-fill that exact size (keeps proportions and trims overflow, like Resize Crop). It never stretches."],
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["video_frames", "The video as a batch of image frames."],
          ["audio", "The soundtrack (empty if the file has none). Wire into Save Mp4 to keep the sound."],
          ["frame_count", "How many frames were loaded."],
          ["fps", "Frames per second of the loaded clip."],
          ["width / height", "Frame size in pixels, after any resize."],
          ["duration", "Length of the loaded clip in seconds."],
        ],
      },
      {
        heading: "Requirements",
        body: "Load Video reads frames with PyAV (or imageio as a fallback) and gets audio with ffmpeg. Most ComfyUI setups already have these, so usually there is nothing to install. If you ever see a 'video reader' message, install PyAV: in ComfyUI Manager use its pip install option and enter `av` (portable Windows: run `python_embeded\\python.exe -m pip install av` in your ComfyUI folder).",
      },
    ],
    footer: "Pairs with Save Mp4 Pixaroma; video_frames and audio wire straight across.",
  },

  "PixaromaLoadVideoFrame": {
    title: "Load Video Frame Pixaroma",
    tagline: "Load a video and pick one exact frame to use as an image. Like a Load Image node, but for video.",
    sections: [
      {
        heading: "What it does",
        body: "Loads a video and pulls out a single frame you choose, then sends it on as an image. Use it when you want one still picture from a clip without exporting the frame in another program first.\n\nThe frame you pick shows in a preview right on the node, and it reads the video's frame count for you so the slider knows how far it can go.",
      },
      {
        heading: "How to pick a frame",
        bullets: [
          "Click `choose video to upload` to add a file, or pick one from the dropdown.",
          "Drag the slider under the preview to scrub to any spot. The preview updates as you drag.",
          "Use the `◀` and `▶` buttons to step exactly one frame back or forward for a pinpoint choice.",
          "Or type the exact frame number in the `frame` box above the preview.",
        ],
      },
      {
        heading: "Good to know",
        bullets: [
          "The frame number is 0-based, so `frame 0` is the very first frame.",
          "If you enter a number past the end of the video, the last frame is used.",
          "The preview is a quick guide; the frame the node sends out is always exact. On heavy phone videos (HEVC) the preview can lag a little, same as the Load Video node.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The frame you picked, as an image."],
          ["mask", "A blank mask that matches the frame, so it fits the same slots as Load Image."],
          ["frame_count", "How many frames the whole video has."],
          ["fps", "Frames per second of the video."],
          ["width / height", "Frame size in pixels."],
        ],
      },
      {
        heading: "Requirements",
        body: "Reads frames with PyAV (or imageio as a fallback). Most ComfyUI setups already have these. If you ever see a 'video reader' message, install PyAV: in ComfyUI Manager use its pip install option and enter `av` (portable Windows: run `python_embeded\\python.exe -m pip install av` in your ComfyUI folder).",
      },
    ],
    footer: "For loading a whole clip as a batch of frames instead, use Load Video Pixaroma.",
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

  "PixaromaResizeCrop": {
    title: "Resize Crop Pixaroma",
    tagline: "Force an image to an exact width and height by crop-to-fill - no stretching, no letterboxing.",
    sections: [
      {
        heading: "What it does",
        body: "Scales the image so it completely fills the target box, then crops the overflow from the center. The result is always exactly the width and height you set. Smaller images are scaled up to fill. Great for forcing image or video frames to a fixed size like 512x896 or 704x1280.",
      },
      {
        heading: "How to use",
        bullets: [
          "Wire an image into `image`.",
          "Type the size into the `width` and `height` fields, or wire a number into them from another node (e.g. Resolution Pixaroma or a Number node).",
          "The fields default to 1024 x 1024. The up/down arrows step by 8 since AI/video sizes are usually multiples of 8, but you can type any exact value.",
          "Optionally wire a `mask` - it gets cropped to the same size.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["image", "The cropped image, exactly width x height pixels."],
          ["mask", "The cropped mask, matching the output size (blank when no mask is wired in)."],
          ["width", "The output width in pixels."],
          ["height", "The output height in pixels."],
        ],
      },
    ],
    footer: "Need to scale without cropping, fit inside a box, or pad instead? Use Image Resize Pixaroma, which has all eight resize modes.",
  },

  "PixaromaPortraitLandscape": {
    title: "Portrait Landscape Pixaroma",
    tagline: "Flip a width and height between portrait (tall) and landscape (wide) with one click.",
    sections: [
      {
        heading: "What it does",
        body: "Takes two dimensions and outputs them in the orientation you choose. Click Portrait and the smaller number becomes the width (a tall image); click Landscape and the larger number becomes the width (a wide image). One node replaces keeping two WH nodes and a switch just to flip orientation.",
      },
      {
        heading: "How to use",
        bullets: [
          "Enter your two sizes in the width and height fields, or wire them in from another node (e.g. WH Pixaroma or Resolution Pixaroma).",
          "Click Portrait or Landscape - the active one lights up orange.",
          "Wire the width and height outputs into your Empty Latent (or anywhere a size is needed).",
          "The order you type the two numbers does not matter: Portrait always gives the tall arrangement, Landscape the wide one.",
        ],
      },
      {
        heading: "Outputs",
        defs: [
          ["width", "The output width. Portrait = the smaller of your two numbers, Landscape = the larger."],
          ["height", "The output height. Portrait = the larger of your two numbers, Landscape = the smaller."],
        ],
      },
    ],
    footer: "Need two genuinely different sizes (not just the same numbers swapped)? Use Switch WH Pixaroma instead, which picks between two separate width/height pairs.",
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
    tagline: "Route one of many wired inputs to a single output by clicking a row.",
    sections: [
      {
        heading: "What it does",
        body: "Accepts up to 32 wired inputs of any type (MODEL, CLIP, IMAGE, STRING, AUDIO, and so on) and passes exactly one of them through to the output unchanged. You choose which row is active by clicking it on the node. Only the active row's upstream branch runs - the others are skipped.",
      },
      {
        heading: "How to use",
        bullets: [
          "Wire upstream nodes into the rows. A new empty row appears as you fill each one.",
          "Click anywhere on a row to make it active (the orange highlight marks it).",
          "Double-click a row's name to rename it, so you remember what each input is. A single click only activates the row, so you will not change a label by accident. (In the new node interface, click into the name field to rename.)",
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
    tagline: "Plays a sound when the workflow reaches this node, and times how long the run took to get there.",
    sections: [
      {
        heading: "What it does",
        body: "Drop one at the end of a workflow to hear when rendering is done, or branch one off any node to get an audio alert at a checkpoint. Useful when you are in another tab or app while ComfyUI runs. Every Run it also measures how long the workflow took to REACH this node and shows that time on the node face. The sound fires every Run even when upstream is cached.",
      },
      {
        heading: "The checkpoint timer",
        body: "The clock starts the moment you press Run and stops when this node is reached, so it answers 'how long did it take to get this far'. One node at the end gives you the whole run; branch several through the graph and the gaps between their times are the per-segment times.\n\nTiming does not depend on the sound. The time is still recorded when this node's `enabled` toggle is off and when the master mute is on, so you can time a workflow in complete silence.",
      },
      {
        heading: "Reading the node face",
        body: "The clock row shows the last time as minutes : seconds . milliseconds (for example `02:47.318`), switching to hours : minutes : seconds . milliseconds if a run goes past an hour. It reads `--:--.---` until the first Run, and `timer off` when Record time is unticked for this node. A mute marker appears in the row whenever the ding will not play, whether that is this node's own toggle or the master mute - so a silent node never looks like a working one. The small arrow on the RIGHT of the clock row folds the node down to just the clock; click it again to bring the sound controls back.",
      },
      {
        heading: "Notify time history",
        body: "Right-click the node and pick `Notify time history` to see the last 10 times THIS node was reached, newest first. Each line shows the label (or the sound name if you left the label blank) and the time of day it ran, next to how long the workflow took to reach here, and the fastest one is marked with a lightning bolt. You can copy a single line, export the whole list as a text file, or clear it.\n\nEvery Notify node keeps its own separate list, so a workflow with several checkpoints gives you one history per checkpoint rather than one shared pile.",
      },
      {
        heading: "Settings (right-click the node)",
        defs: [
          ["Collapse / Expand", "Folds the node down to just the clock, or brings the sound controls back. The same thing the arrow on the clock row does."],
          ["Record time", "Turns the checkpoint timer on or off for this one node. While it is off the clock reads `timer off` and nothing is added to this node's history. The sound is unaffected."],
          ["Notify time history", "Opens this node's list of the last 10 times, with Copy, Export .txt, and Clear."],
          ["Mute all Notify sounds", "The master mute: no Notify node plays a sound, in any workflow. It is the same switch as the one in ComfyUI Settings, under Pixaroma, Notify, Enabled, so flipping either one flips both. Checkpoint timers keep recording while it is on."],
        ],
      },
      {
        heading: "Where the times are kept",
        body: "The recorded times are stored on THIS machine, not inside the workflow. Sharing or exporting a workflow never carries your times along with it, and whoever opens it starts with an empty list. Duplicating a Notify node also starts a fresh list rather than inheriting the original's. The times are remembered between sessions, so they are still there after you reload the page or restart ComfyUI.",
      },
      {
        heading: "Good to know",
        bullets: [
          "A Notify node inside a SUBGRAPH does not record a checkpoint time - the sound still plays, but nothing lands on the clock or in the history. Put it in the main graph to time it.",
          "A cached re-run shows a near-zero time. Nothing upstream had to be recomputed, so there was genuinely nothing to wait for.",
          "The time is measured in your browser, from the start of the Run to the moment this node reports back.",
        ],
      },
      {
        heading: "Inputs",
        defs: [
          ["any", "Wire any node output here. The data passes through untouched - this node only listens for when it is reached."],
          ["enabled", "Per-node mute switch. Turn it off to silence just this node. The checkpoint timer keeps recording."],
          ["sound", "Which sound to play. Lists every `.mp3`, `.wav`, and `.ogg` in the `assets/sounds/` folder. Add your own there (then restart ComfyUI)."],
          ["volume", "Playback volume from 0 (silent) to 100 (full)."],
          ["label", "Optional name shown in the browser console when the node fires, and used to name this node's rows in the time history. Helpful with several Notify nodes in one workflow."],
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
      {
        heading: "Spotting an out-of-date browser cache",
        body: "After an update the browser sometimes keeps running the OLD cached version of the nodes even though the files on disk are already new. This node compares the version the browser actually loaded against the version on disk. If they differ, the `Pixaroma` line turns orange and a warning tells you to press `Ctrl+Shift+R`. This catches the sneaky case where everything looks updated but the browser is still running old code, which can make workflows behave strangely or fail. The `Copy` text includes the warning too, so a pasted bug report shows it.",
      },
      {
        heading: "If Ctrl+Shift+R does not clear it",
        body: "Some browsers cache very stubbornly. To force a clean reload:",
        bullets: [
          "Press `F12` to open the developer tools.",
          "Click the `Network` tab.",
          "Tick the `Disable cache` checkbox at the top of that tab.",
          "Keep the tools open and refresh the page (`Ctrl+Shift+R` / `Cmd+Shift+R`).",
        ],
      },
    ],
    footer: "No inputs, no outputs, no work on Run - it is a pure info panel.",
  },
};

for (const [cls, def] of Object.entries(HELP)) registerNodeHelp(cls, def);
