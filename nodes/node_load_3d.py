"""Load 3D Pixaroma - pick a 3D model, turn it to the view you want, and take the
model AND a picture of it out of one node.

The picture is drawn in the BROWSER. There is no 3D renderer in Python and the
pack adds no dependencies, so the node face renders the model with the vendored
three.js, and when Run is pressed the graphToPrompt hook in js/load_3d/index.js
draws it at the requested size, uploads it through ComfyUI's own /upload/image
into the temp folder, and injects the two names into the hidden Load3DState
input. ComfyUI's own Load 3D works the same way. A run started without a browser
therefore has no picture; the node says so rather than inventing one, unless
nothing downstream reads the picture at all.

The picture's width and height also come out as numbers, and can be wired IN.
The browser reads a wired size before Run when it can (Sizes Pixaroma, see
js/load_3d/size.mjs) and draws the picture at it. A wired size that still
disagrees with the picture stops the run, because the only way that happens is a
size the browser could not know in time, and a picture of the wrong size would
otherwise flow on silently.

The model itself comes straight from disk as a File3D, the type ComfyUI's 3D
nodes pass around (Save 3D, Preview 3D, Get 3D Components).

Pure helpers + harnesses: _load3d_helpers.py, D:\\Claude Tests\\_load3d_test.py,
_load3d_size_test.py, and _load3d_api_test.py (headless, run with the embedded python).
"""
from __future__ import annotations

import os

import numpy as np
import torch
from PIL import Image

import folder_paths

from ._load3d_helpers import (
    CAPTURE_SUBFOLDER, NONE, is_model_name, list_models, output_size, outputs_consumed,
    parse_state, size_mismatch_message, strip_annotation, unknown_size_read, wired_side,
)
from ._path_guard import is_path_under, rel_is_rooted

CLASS = "PixaromaLoad3D"
HIDDEN_INPUT = "Load3DState"

NO_PICTURE = (
    "[Pixaroma] Load 3D: the picture of the model was not found. The node draws it "
    "in your browser at the moment you press Run, so run the workflow from the "
    "ComfyUI page. If you did, check the node shows your model (it may still have "
    "been loading, or the file could not be opened) and run it again."
)

NO_SIZE = (
    "[Pixaroma] Load 3D: the width and height were not sent. The node sends them from "
    "your browser at the moment you press Run, so run the workflow from the ComfyUI "
    "page, or wire width and height in."
)


def _dir(getter):
    try:
        return getter()
    except Exception:
        return None


def _model_roots():
    return [d for d in (_dir(folder_paths.get_input_directory),
                        _dir(folder_paths.get_output_directory)) if d]


def _resolve_model(name):
    """A combo value (any text) -> a real model file in input/ or output/, or None.

    Screened lexically FIRST: on Windows merely resolving \\\\host\\share
    contacts that host, and ComfyUI does not validate a combo value against
    its list, so it can be any text like any other input
    (patterns/path-containment.md).
    """
    if not isinstance(name, str) or not name or name == NONE:
        return None
    bare, kind = strip_annotation(name)
    if kind not in ("input", "output") or rel_is_rooted(bare) or not is_model_name(bare):
        return None
    try:
        path = folder_paths.get_annotated_filepath(name)
    except Exception:
        return None
    roots = _model_roots()
    if not roots or not is_path_under(path, *roots):
        return None
    return path if os.path.isfile(path) else None


def _resolve_capture(name):
    """A picture name that already passed parse_state's pattern -> its temp file."""
    if not name:
        return None
    tmp = _dir(folder_paths.get_temp_directory)
    if not tmp:
        return None
    try:
        path = folder_paths.get_annotated_filepath(name)
    except Exception:
        return None
    if not is_path_under(path, os.path.join(tmp, CAPTURE_SUBFOLDER)):
        return None
    return path if os.path.isfile(path) else None


def _file3d(path):
    """ComfyUI's own 3D file object, so every core 3D node accepts the output."""
    try:
        from comfy_api.latest import Types
        return Types.File3D(path)
    except Exception:
        # An older ComfyUI without the 3D types has nothing that could take the
        # object anyway, and a path is what its older 3D nodes read.
        return path


def _blocked(message):
    """ComfyUI's own "this output cannot be used" marker, or None on a build without it."""
    try:
        from comfy_execution.graph_utils import ExecutionBlocker
    except Exception:
        return None
    return ExecutionBlocker(message)


def _load_image(path):
    with Image.open(path) as im:
        im.load()
        rgb = im.convert("RGB")
    arr = np.asarray(rgb, dtype=np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


def _load_mask(path, size):
    with Image.open(path) as im:
        im.load()
        grey = im.convert("L")
    if grey.size != size:
        grey = grey.resize(size, Image.BILINEAR)
    arr = np.asarray(grey, dtype=np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


class PixaromaLoad3D:
    DESCRIPTION = (
        "Loads a 3D model and gives you the model file and a picture of it from one node. "
        "The node shows the model live: drag to turn it, scroll to zoom, or click Front, Back, "
        "Left, Right, Top or 3/4 to jump to a view. The bright frame is exactly the picture that "
        "comes out, at the width and height you set, in the look you pick: Color shows the "
        "model's own colours and textures, Clay shows only the shape in plain grey, and Normal "
        "and Depth give pictures ready for ControlNet. The mask output is white where the model "
        "is. The picture's width and height also come out as numbers, so an empty latent can be "
        "the same size, and they can be wired in from Sizes Pixaroma, which then sets the "
        "picture and the frame on the node together. Opens GLB, GLTF, OBJ, FBX, STL and PLY "
        "files from ComfyUI's input/3d and output/3d folders, so a model a 3D workflow just saved "
        "is already in the list. The picture is drawn in your browser when you press Run, so run "
        "the workflow from the ComfyUI page."
    )

    @classmethod
    def INPUT_TYPES(cls):
        files = (list_models(_dir(folder_paths.get_input_directory))
                 + list_models(_dir(folder_paths.get_output_directory), " [output]"))
        return {
            "required": {
                "model_file": ([NONE] + files, {
                    "tooltip": "The 3D model to load. Models in input/3d and output/3d are listed; "
                               "the Upload button on the node adds new ones.",
                }),
            },
            # Optional and socket-only. A new input on a released node must never be
            # required, or every API prompt saved before it existed stops validating.
            "optional": {
                "width": ("INT", {
                    "forceInput": True,
                    "tooltip": "Optional. Wire in the width from Sizes Pixaroma and the picture follows "
                               "it: the Width field locks, the frame on the node takes the new shape, "
                               "and the picture is drawn that wide. Only Sizes Pixaroma can be read "
                               "before Run.",
                }),
                "height": ("INT", {
                    "forceInput": True,
                    "tooltip": "Optional. Wire in the height from Sizes Pixaroma and the picture follows "
                               "it: the Height field locks, the frame on the node takes the new shape, "
                               "and the picture is drawn that tall. Only Sizes Pixaroma can be read "
                               "before Run.",
                }),
            },
            # Hidden, not required: a required STRING shows as a widget AND a
            # convertible input dot in the Vue frontend (Vue Compat #9).
            "hidden": {
                HIDDEN_INPUT: ("STRING", {"default": "{}"}),
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("FILE_3D", "IMAGE", "MASK", "INT", "INT")
    RETURN_NAMES = ("model_3d", "image", "mask", "width", "height")
    OUTPUT_TOOLTIPS = (
        "The 3D model file itself, for 3D workflows: Save 3D, Preview 3D (Advanced), or Get 3D "
        "Components to edit the mesh.",
        "A picture of the model exactly as the frame on the node shows it, at the width and "
        "height you set, in the look you picked.",
        "White where the model is and black everywhere else, the same size as the image.",
        "The width of the picture in pixels. Wire it into an empty latent so the image you make "
        "is the same size as the picture.",
        "The height of the picture in pixels. Wire it into an empty latent together with width.",
    )
    FUNCTION = "load"
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    @classmethod
    def VALIDATE_INPUTS(cls, model_file):
        # Taking model_file here also switches off ComfyUI's own "value not in
        # list" check, so a model uploaded after the page loaded still validates.
        if model_file == NONE:
            return "Load 3D Pixaroma: no model picked. Choose one on the node or use its Upload button."
        if _resolve_model(model_file) is None:
            return "Load 3D Pixaroma: {!r} was not found in input/3d or output/3d.".format(model_file)
        return True

    @classmethod
    def IS_CHANGED(cls, model_file, **kwargs):
        """Re-run when the model FILE changes under the same name.

        The name and the picture names are inputs, so they are already part of
        the cache key; the content of a file overwritten in place is not.

        Do not try to read the prompt here. ComfyUI calls IS_CHANGED with no
        dynprompt, so a hidden PROMPT arrives as {} and any "is the picture wired"
        check answers the same for every run (execution.py, IsChangedCache.get).
        load() deals with that case instead.
        """
        path = _resolve_model(model_file)
        if not path:
            return ""
        try:
            s = os.stat(path)
        except OSError:
            return ""
        return "{}:{}".format(s.st_mtime_ns, s.st_size)

    def load(self, model_file, width=None, height=None, prompt=None, unique_id=None, **kwargs):
        path = _resolve_model(model_file)
        if not path:
            raise ValueError(
                "[Pixaroma] Load 3D: no usable model selected"
                + (" ({!r} was not found in input/3d or output/3d)".format(model_file)
                   if model_file and model_file != NONE else "")
                + ". Pick one on the node, or use its Upload button."
            )
        wired = (wired_side(width, "width"), wired_side(height, "height"))
        st = parse_state(kwargs.get(HIDDEN_INPUT))
        image_path = _resolve_capture(st["image"])
        mask_path = _resolve_capture(st["mask"])
        if image_path and mask_path:
            image = _load_image(image_path)
            size = (int(image.shape[2]), int(image.shape[1]))
            # The browser drew the picture at the wired size whenever it could read
            # it, so a disagreement is a size it could not know before Run. Stop:
            # a picture of the wrong size would flow on silently.
            problem = size_mismatch_message(size, wired)
            if problem:
                raise ValueError(problem)
            mask = _load_mask(mask_path, size)
            return (_file3d(path), image, mask, size[0], size[1])
        if outputs_consumed(prompt, unique_id, (1, 2)):
            raise ValueError(NO_PICTURE)
        # Only model_3d (and perhaps the size) is wired. This result is CACHED, and
        # a later run that DOES wire the image, still with no picture, has identical
        # inputs, so it is handed this result without load() running again. A blank
        # image would then flow on silently; a blocker stops whoever reads it, with
        # the same message (measured by _load3d_api_test.py, test B).
        blocker = _blocked(NO_PICTURE)
        if blocker is not None:
            image, mask = blocker, blocker
        else:
            image = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            mask = torch.zeros((1, 64, 64), dtype=torch.float32)
        w, h = output_size(wired, st)
        if w is None or h is None:
            # Only a side nobody knows AND something reads is an error: a width wired
            # in still comes out when the height is unknown and unused.
            if unknown_size_read((w, h), prompt, unique_id):
                raise ValueError(NO_SIZE)
            # The unknown side is not read; the same cached-blocker reasoning applies.
            size_blocker = _blocked(NO_SIZE)
            stand_in = size_blocker if size_blocker is not None else 0
            w = stand_in if w is None else w
            h = stand_in if h is None else h
        return (_file3d(path), image, mask, w, h)


NODE_CLASS_MAPPINGS = {CLASS: PixaromaLoad3D}
NODE_DISPLAY_NAME_MAPPINGS = {CLASS: "Load 3D Pixaroma"}
