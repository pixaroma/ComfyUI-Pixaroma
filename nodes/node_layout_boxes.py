"""Layout Boxes Pixaroma - draw where things go, for FLUX.3 layout prompts.

Draw boxes on a canvas the shape of your picture, number them, and write what
goes in each one (or the exact words, for a text box). The node sends:
  - elements  the boxes in the very form ComfyUI's own Create Bounding Boxes
              node sends them, for FLUX.3 Layout Prompt (or Build JSON Prompt
              for Ideogram),
  - preview   a picture of the boxes, numbered like <obj_1>, <obj_2>...

Why it exists: core's Create Bounding Boxes draws its canvas only in the
Nodes 2.0 renderer. This one works in Classic and Nodes 2.0 alike.

Thin wrapper. Every decision lives in _layout_boxes_helpers.py, which is pure
and tested (harness: D:\\Claude Tests\\_layout_boxes\\parity.py).

Frontend-driven (Vue Compat #9): the boxes live on node.properties.layoutBoxes
in the browser and reach this node through the hidden LayoutState input, which
js/layout_boxes/index.js fills from its graphToPrompt hook. No IS_CHANGED: the
state IS an input, so ComfyUI's own cache re-runs the node exactly when a box
changes.
"""

import os
import uuid

import numpy as np
import torch

from ._layout_boxes_helpers import build_elements, parse_state, render_preview

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_FONT = os.path.join(_ROOT, "assets", "fonts", "Inter-Variable.ttf")
_PICTURE_LONG = 1600      # the node only needs to SHOW the background


def _frame_rgb(image):
    """The first frame of an IMAGE as HxWx3 uint8. An RGBA picture (a Qwen VAE
    decodes RGBA) loses its alpha, a grey one is repeated into three channels."""
    if image.dim() == 3:
        image = image.unsqueeze(0)
    frame = image[0]
    c = frame.shape[-1]
    if c > 3:
        frame = frame[..., :3]
    elif c < 3:
        frame = frame[..., :1].repeat(1, 1, 3)
    return (frame.detach().float().clamp(0, 1) * 255.0).round().to(torch.uint8).cpu().numpy()


def _save_picture(arr, unique_id):
    """The background that actually came in, small, so the node can show it
    after a run. A courtesy: failing to write it must never fail the run."""
    try:
        import folder_paths
        from PIL import Image

        pic = Image.fromarray(arr, "RGB")
        height, width = arr.shape[0], arr.shape[1]
        pic.thumbnail((_PICTURE_LONG, _PICTURE_LONG), Image.LANCZOS)
        folder = folder_paths.get_temp_directory()
        os.makedirs(folder, exist_ok=True)
        tag = "".join(ch if ch.isalnum() else "_" for ch in str(unique_id or "x"))[:40]
        name = f"pixaroma_layout_{tag}_{uuid.uuid4().hex[:10]}.jpg"
        pic.save(os.path.join(folder, name), quality=92)
        return {"filename": name, "subfolder": "", "type": "temp",
                "width": int(width), "height": int(height)}
    except Exception as e:
        print(f"[PixaromaLayoutBoxes] could not save the node picture: {e}")
        return None


class PixaromaLayoutBoxes:
    DESCRIPTION = (
        "Draw where things go in your picture, for FLUX.3 layout prompts. Drag on the canvas "
        "to draw a box, drag a box to move it, drag its corners to resize it. Every box gets a "
        "number and a line where you write what goes there. Switch a box to Text when it "
        "should hold exact words, like a sign or a title.\n\n"
        "In your prompt, write <obj_1> for box 1, <obj_2> for box 2, and so on. Wire elements "
        "into FLUX.3 Layout Prompt (element) together with your prompt. It works like ComfyUI's "
        "Create Bounding Boxes node, in both the Classic and the Nodes 2.0 look.\n\n"
        "The canvas takes its shape from width and height (wire them from Sizes Pixaroma), or "
        "from the picture you wire into background. Boxes are kept as parts of the canvas, so "
        "changing the size keeps every box in its place. The expand button opens a big view "
        "for careful drawing.\n\n"
        "Find it by searching for layout, boxes, bounding box, regions, composition or flux 3."
    )

    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"
    FUNCTION = "run"
    # The face shows the run's result: a Run with nothing changed is cached, runs
    # no code, and re-sends that result only with this (ComfyUI 0.42 execution.py;
    # measured 2026-10-25: after a reload the face stayed empty, video-tools.md #8).
    HAS_INTERMEDIATE_OUTPUT = True
    RETURN_TYPES = ("ARRAY", "IMAGE")
    RETURN_NAMES = ("elements", "preview")
    OUTPUT_TOOLTIPS = (
        "Your boxes as prompt elements: where each box is and what you wrote in it. Wire it "
        "into FLUX.3 Layout Prompt (element), which adds them to your prompt as its layout "
        "table. Build JSON Prompt (Ideogram) reads it too.",
        "A picture of your boxes with their numbers, over the background when one is wired. "
        "Handy to save beside the result or to show what you asked for.",
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {
                    "default": 1024, "min": 64, "max": 16384, "step": 8,
                    "tooltip": (
                        "The width of the picture you will make. With height it gives the canvas its "
                        "shape. Wire the width of Sizes Pixaroma (or the node that sets your latent "
                        "size) so they always match. Boxes stay in place when it changes."
                    ),
                }),
                "height": ("INT", {
                    "default": 1024, "min": 64, "max": 16384, "step": 8,
                    "tooltip": (
                        "The height of the picture you will make. Wire the height of Sizes Pixaroma "
                        "so the canvas has the same shape as your latent."
                    ),
                }),
            },
            "optional": {
                "background": ("IMAGE", {
                    "tooltip": (
                        "Optional. A picture to draw your boxes over, for example the photo an edit "
                        "model will change. The canvas then takes the picture's shape. From a Load "
                        "Image it shows right away; from other nodes it shows after a run."
                    ),
                }),
            },
            "hidden": {
                "LayoutState": "STRING",
                "unique_id": "UNIQUE_ID",
            },
        }

    def run(self, width, height, background=None, LayoutState=None, unique_id=None):
        boxes = parse_state(LayoutState)["boxes"]
        elements = build_elements(boxes)

        bg = None
        picture = None
        if isinstance(background, torch.Tensor) and background.dim() >= 3 and background.numel() > 0:
            bg = _frame_rgb(background)
            picture = _save_picture(bg, unique_id)

        rgb = render_preview(boxes, int(width), int(height), bg, _FONT)
        preview = torch.from_numpy(rgb.astype(np.float32) / 255.0).unsqueeze(0)

        entry = {"dims": [int(width), int(height)], "picture": picture}
        return {"ui": {"pixaroma_layout_boxes": [entry]}, "result": (elements, preview)}


NODE_CLASS_MAPPINGS = {"PixaromaLayoutBoxes": PixaromaLayoutBoxes}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaLayoutBoxes": "Layout Boxes Pixaroma"}
