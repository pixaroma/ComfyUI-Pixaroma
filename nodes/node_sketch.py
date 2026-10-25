"""Sketch Pixaroma - mark a picture for an edit model.

Draw boxes, circles, freehand loops, arrows or words on the picture right on the
node, write a short note beside each mark, and the node sends:
  - image  the picture with the marks drawn in, for the edit model to look at,
  - prompt the notes turned into an instruction ("Inside the red box: ..."),
  - mask   the marked areas, for an inpaint workflow instead.

Thin wrapper. Every decision lives in _sketch_helpers.py, which is pure and
tested (harness: D:\\Claude Tests\\_sketch_test.py).

Frontend-driven (Vue Compat #9): the marks live on node.properties.sketchState
in the browser and reach this node through the hidden SketchState input, which
js/sketch/index.js fills from its graphToPrompt hook. No IS_CHANGED: the state
IS an input, so ComfyUI's own cache re-runs the node exactly when a mark or a
note changes.
"""

import os
import uuid

import numpy as np
import torch

from ._sketch_helpers import build_mask, build_prompt, parse_state, render_layers

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_FONT = os.path.join(_ROOT, "assets", "fonts", "Inter-Variable.ttf")
_PREVIEW_LONG = 1600      # the node only needs to SHOW the picture


def _as_rgb(image):
    """[B,H,W,C] float -> [B,H,W,3]. An RGBA picture (a Qwen VAE decodes RGBA)
    loses its alpha, a grey one is repeated into three channels."""
    if image.dim() == 3:
        image = image.unsqueeze(0)
    c = image.shape[-1]
    if c == 3:
        return image
    if c > 3:
        return image[..., :3]
    return image[..., :1].repeat(1, 1, 1, 3)


def _save_preview(frame, width, height, unique_id):
    """The picture that actually came in, small, so the node can show it.

    Returns the ui entry or None: a preview is a courtesy, and failing to write
    one must never fail the run.
    """
    try:
        import folder_paths
        from PIL import Image

        arr = (frame.detach().float().clamp(0, 1) * 255.0).round().to(torch.uint8).cpu().numpy()
        pic = Image.fromarray(arr, "RGB")
        pic.thumbnail((_PREVIEW_LONG, _PREVIEW_LONG), Image.LANCZOS)
        folder = folder_paths.get_temp_directory()
        os.makedirs(folder, exist_ok=True)
        tag = "".join(ch if ch.isalnum() else "_" for ch in str(unique_id or "x"))[:40]
        name = f"pixaroma_sketch_{tag}_{uuid.uuid4().hex[:10]}.jpg"
        pic.save(os.path.join(folder, name), quality=92)
        return {"filename": name, "subfolder": "", "type": "temp",
                "width": int(width), "height": int(height)}
    except Exception as e:
        print(f"[PixaromaSketch] could not save the node preview: {e}")
        return None


class PixaromaSketch:
    DESCRIPTION = (
        "Mark what to change on a picture, for edit models like Flux 2 Klein, Qwen Image Edit "
        "and Kontext. Draw right on the node: a box, a circle, a freehand loop or sketch, an "
        "arrow, or a word. Every mark gets a number, and beside it you write what to change "
        "there, like make the hat a red cap.\n\n"
        "The node sends the picture with your marks drawn in, a prompt written from your notes "
        "(Inside the red box: make the hat a red cap. Remove all the colored marks and keep "
        "everything else the same.), and a mask of the marked areas for inpaint workflows. "
        "Each new mark takes the next color, so the prompt can tell them apart.\n\n"
        "The picture shows on the node before you run when it comes from a Load Image, and "
        "after a run it shows exactly the picture that came in. The expand button opens a big "
        "view for careful marking. Undo, clear and delete a single mark are on the node.\n\n"
        "Find it by searching for sketch, draw, mark, annotate, box, circle, arrow or edit."
    )

    CATEGORY = "👑 Pixaroma/🎨 Editors"
    FUNCTION = "run"
    # The face shows the run's result: a Run with nothing changed is cached, runs
    # no code, and re-sends that result only with this (ComfyUI 0.42 execution.py;
    # measured 2026-10-25: after a reload the face stayed empty, video-tools.md #8).
    HAS_INTERMEDIATE_OUTPUT = True
    RETURN_TYPES = ("IMAGE", "STRING", "MASK")
    RETURN_NAMES = ("image", "prompt", "mask")
    OUTPUT_TOOLTIPS = (
        "The picture with your marks drawn in, at its full size. Wire it in as the image the "
        "edit model looks at. Every pixel you did not mark is exactly the input.",
        "Your notes as one instruction, one sentence per mark with a note, plus a closing "
        "sentence asking the model to remove the marks (switch that off on the node). Wire it "
        "into the text encode. Empty when no mark has a note.",
        "White inside every box, circle and closed loop, and along an open sketch; black "
        "everywhere else. For inpaint workflows, when a model does not read drawn marks. "
        "Arrows and words point at things, so they are not part of it.",
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {
                    "tooltip": (
                        "The picture to mark. Wire a Load Image (or any node that makes a "
                        "picture). From a Load Image it shows on the node right away, also "
                        "through a Switch; after a run the node shows exactly the picture "
                        "that came in. If a node in between crops or turns the picture, run "
                        "once before marking."
                    ),
                }),
            },
            "hidden": {
                "SketchState": "STRING",
                "unique_id": "UNIQUE_ID",
            },
        }

    def run(self, image, SketchState=None, unique_id=None):
        state = parse_state(SketchState)
        marks = state["marks"]
        img = _as_rgb(image)
        batch, height, width = int(img.shape[0]), int(img.shape[1]), int(img.shape[2])

        out = img
        if marks:
            out = img.clone()
            for x0, y0, rgba in render_layers(width, height, marks, _FONT):
                h, w = rgba.shape[0], rgba.shape[1]
                layer = torch.from_numpy(np.ascontiguousarray(rgba)).to(device=img.device, dtype=img.dtype) / 255.0
                alpha = layer[..., 3:4]
                region = out[:, y0:y0 + h, x0:x0 + w, :]
                out[:, y0:y0 + h, x0:x0 + w, :] = region * (1.0 - alpha) + layer[..., :3] * alpha

        mask_np = np.asarray(build_mask(width, height, marks), dtype=np.float32) / 255.0
        mask = torch.from_numpy(mask_np).to(device=img.device).unsqueeze(0).repeat(batch, 1, 1)

        prompt = build_prompt(marks, state["remove_marks"])
        preview = _save_preview(img[0], width, height, unique_id)
        ui = {"pixaroma_sketch": [preview]} if preview else {}
        return {"ui": ui, "result": (out, prompt, mask)}


NODE_CLASS_MAPPINGS = {"PixaromaSketch": PixaromaSketch}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSketch": "Sketch Pixaroma"}
