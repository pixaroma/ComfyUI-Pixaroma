"""Reference Images Pixaroma - several reference pictures on one node, each with
a role, and a prompt that names every picture the way the model expects.

Multi-picture edit models (Qwen Image 2.1, FLUX 3 Image Klein, MiniMax H3, Flux
2 Klein) each name their reference pictures differently: <image1>,
<ref_image_0>, <Picture 1>, "image 1". This node holds up to 12 pictures, gives
each one a role (character, outfit, pose, style...), and sends:
  - prompt     "Use the character from <image1>, the outfit from <image2> ..."
               plus your own words, where @1, @2 become the model's tags,
  - image_1..  the pictures, one output each, in the order shown on the node.

The model is found by following the prompt wire (Auto), or picked on the node.

Thin wrapper: every decision lives in _ref_images_helpers.py (pure, tested by
D:\\Claude Tests\\_ref_images\\parity.py against the browser's copy).

Frontend-driven (Vue Compat #9): the cards live on node.properties.refImages in
the browser and arrive through the hidden RefImagesState input, filled by the
graphToPrompt hook in js/reference_images/index.js. Adds NO route: pictures go
up through ComfyUI's own /upload/image into the input folder.
"""

import hashlib
import json
import os

import numpy as np
import torch
from PIL import Image, ImageOps

import folder_paths
import node_helpers

from ._path_guard import safe_join
from ._ref_images_helpers import (
    MAX_CARDS, MODEL_LABELS, build_prompt, detect_model, fill_value, parse_state, target_size,
)

_I16_MODES = ("I;16", "I;16B", "I;16L", "I;16N")


def _card_path(card):
    """The card's picture inside ComfyUI's input folder, or None. The state blob
    is untrusted (every hidden input is), so the join is contained."""
    name = card.get("file") or ""
    if not name:
        return None
    sub = card.get("sub") or ""
    rel = (sub.strip("/\\") + "/" + name) if sub else name
    return safe_join(folder_paths.get_input_directory(), rel)


def _load_picture(path, state, model, fill):
    """One picture as a [1, H, W, 3] float tensor: the first frame, turned the
    way the camera held it, transparent parts filled with a plain colour, then
    scaled down / trimmed to the node's size settings."""
    img = node_helpers.pillow(Image.open, path)
    try:
        img.seek(0)
    except Exception:
        pass
    frame = node_helpers.pillow(ImageOps.exif_transpose, img)
    if frame.mode == "I":
        frame = frame.point(lambda px: px * (1 / 255))
    elif frame.mode in _I16_MODES:
        frame = frame.convert("I").point(lambda px: px * (1 / 257))
    has_alpha = "A" in frame.getbands() or (frame.mode == "P" and "transparency" in frame.info)
    if has_alpha:
        rgba = frame.convert("RGBA")
        shade = int(round(fill * 255))
        back = Image.new("RGBA", rgba.size, (shade, shade, shade, 255))
        rgb = Image.alpha_composite(back, rgba).convert("RGB")
    else:
        rgb = frame.convert("RGB")

    sw, sh, cw, ch = target_size(rgb.size[0], rgb.size[1], state, model)
    if (sw, sh) != rgb.size:
        rgb = rgb.resize((sw, sh), Image.LANCZOS)
    if (cw, ch) != (sw, sh):
        left = (sw - cw) // 2
        top = (sh - ch) // 2
        rgb = rgb.crop((left, top, left + cw, top + ch))

    try:
        import comfy.model_management as _mm
        dtype = _mm.intermediate_dtype()
    except Exception:
        dtype = torch.float32
    arr = np.asarray(rgb, dtype=np.float32) / 255.0
    return torch.from_numpy(arr)[None,].to(dtype=dtype)


def _blocker(message):
    try:
        from comfy_execution.graph_utils import ExecutionBlocker
        return ExecutionBlocker(message)
    except Exception:
        return None


class PixaromaReferenceImages:
    DESCRIPTION = (
        "Several reference pictures on one node, each with a role, for the edit models that "
        "take more than one picture: Qwen Image 2.1, FLUX 3 Image Klein, MiniMax H3, Flux 2 "
        "Klein and others. Drop pictures on the node (or click Add), give each one a role like "
        "character, outfit, pose or style, and write what to make. In your words, @1 means "
        "picture 1, @2 picture 2, and so on.\n\n"
        "The prompt output names every picture the way the model expects it: <image1> for "
        "Qwen Image 2.1, <ref_image_0> for FLUX 3 Image Klein (it counts from 0), <Picture 1> "
        "for MiniMax H3, and image 1 for the rest. Auto finds the model by following the "
        "prompt wire, or pick it on the node. Wire the outputs 1, 2... (image_1, image_2...) into the model's "
        "picture inputs in the same order.\n\n"
        "Find it by searching for reference, references, multi image, several pictures, "
        "character, outfit, style, qwen edit, flux 3, klein, h3 or ref2v."
    )

    CATEGORY = "👑 Pixaroma/🖼️ Image"
    FUNCTION = "run"
    RETURN_TYPES = ("STRING",) + ("IMAGE",) * MAX_CARDS
    RETURN_NAMES = ("prompt",) + tuple("image_%d" % (i + 1) for i in range(MAX_CARDS))
    OUTPUT_TOOLTIPS = (
        "Your words with every @1, @2 turned into the model's own name for that picture, "
        "plus a sentence that says what each picture is for. Wire it into the prompt of the "
        "model's text encode (or into Prompt Pixaroma's text input).",
    ) + tuple(
        "Picture %d, as shown on the node. Wire it into the model's picture input number %d "
        "so the prompt and the pictures agree." % (i + 1, i + 1)
        for i in range(MAX_CARDS)
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "text": ("STRING", {
                    "forceInput": True,
                    "tooltip": (
                        "Optional. Your prompt from another node, for example Prompt Pixaroma. "
                        "It takes the place of the prompt box on this node; @1, @2 in it still "
                        "become the model's tags."
                    ),
                }),
            },
            "hidden": {
                "RefImagesState": "STRING",
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID",
            },
        }

    def run(self, text=None, RefImagesState=None, prompt=None, unique_id=None):
        state = parse_state(RefImagesState)
        model = state["model"]
        if model == "auto":
            model = detect_model(prompt, unique_id)

        fill = fill_value(state)
        images = []
        for i, card in enumerate(state["cards"]):
            path = _card_path(card)
            if not path or not os.path.isfile(path):
                raise ValueError(
                    "Reference Images: picture %d (%s) is not in ComfyUI's input folder. "
                    "Add it to the node again." % (i + 1, card.get("file") or "no file")
                )
            images.append(_load_picture(path, state, model, fill))

        wired_text = text if isinstance(text, str) else None
        out_prompt = build_prompt(state, model, wired_text)

        outs = []
        for i in range(MAX_CARDS):
            if i < len(images):
                outs.append(images[i])
            else:
                outs.append(_blocker(
                    "Reference Images has no picture %d. Add one more picture to the node, or "
                    "unwire image_%d." % (i + 1, i + 1)
                ))
        entry = {
            "model": model,
            "label": MODEL_LABELS.get(model, model),
            "prompt": out_prompt,
            "count": len(images),
        }
        return {"ui": {"pixaroma_ref_images": [entry]}, "result": (out_prompt, *outs)}

    @classmethod
    def IS_CHANGED(cls, RefImagesState=None, **_others):
        # The state is an input, so ComfyUI already re-runs on any change to it.
        # What it cannot see is a picture file replaced under the same name.
        # (The hidden PROMPT reaches IS_CHANGED as {}: nothing is decided from it.)
        state = parse_state(RefImagesState)
        m = hashlib.sha256()
        m.update(json.dumps(state, sort_keys=True).encode("utf-8"))
        for card in state["cards"]:
            path = _card_path(card)
            try:
                st = os.stat(path) if path else None
                m.update(("%s|%d|%d;" % (card.get("file"), st.st_size, int(st.st_mtime))).encode("utf-8")
                         if st else b"missing;")
            except OSError:
                m.update(b"missing;")
        return m.hexdigest()


NODE_CLASS_MAPPINGS = {"PixaromaReferenceImages": PixaromaReferenceImages}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaReferenceImages": "Reference Images Pixaroma"}
