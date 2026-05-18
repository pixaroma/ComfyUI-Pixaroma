"""Text Overlay Pixaroma — single-text overlay on a required image.

Reads state from a hidden TextOverlayState input populated by
js/text_overlay/index.js's app.graphToPrompt hook. Renders the single
text via nodes/_text_render_helpers.py::render_text_layer on top of the
required upstream image.
"""
import json
import os
import uuid
import numpy as np
import torch
from PIL import Image

import folder_paths

from ._text_render_helpers import render_text_layer


class PixaromaTextOverlay:
    CATEGORY = "👑 Pixaroma"
    DESCRIPTION = (
        "Adds a single styled text overlay on top of an input image. "
        "Edit quickly via the widgets on the node, or click 'Open Text "
        "Editor' for a fullscreen visual editor with drag, snap, and align tools."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Required upstream image. Text is overlayed on this."}),
            },
            "optional": {
                "text": ("STRING", {
                    "forceInput": True,
                    "tooltip": "Optional. When wired to an upstream STRING source, overrides the panel's text at render time.",
                }),
            },
            "hidden": {
                "TextOverlayState": ("STRING", {"default": "{}"}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "build"

    def build(self, image, text=None, TextOverlayState="{}"):
        try:
            state = json.loads(TextOverlayState) if TextOverlayState else {}
        except json.JSONDecodeError:
            print("[Text Overlay Pixaroma] WARN: malformed TextOverlayState, treating as empty")
            state = {}

        # Optional text input overrides the panel's text when wired (text is
        # None when the slot is not connected).
        if text is not None:
            state["text"] = str(text)

        # DEBUG: dump the state Python actually received so we can verify
        # the editor's x/y/etc. survived the JSON round-trip intact. Remove
        # once the y-position discrepancy is confirmed fixed.
        print(f"[Text Overlay Pixaroma] DEBUG state: x={state.get('x')} y={state.get('y')} "
              f"fontSize={state.get('fontSize')} text={state.get('text')!r} "
              f"bgColor={state.get('bgColor')!r} rotation={state.get('rotation')} "
              f"image_shape={tuple(image.shape)}")

        # state IS the single text dict (or empty dict = no overlay)
        outputs = []
        for b in range(image.shape[0]):
            frame = image[b].clamp(0, 1).cpu().numpy()
            frame = (frame * 255).astype(np.uint8)
            pil = Image.fromarray(frame, "RGB").convert("RGBA")
            if state and state.get("text"):
                render_text_layer(pil, state)
            outputs.append(self._pil_to_tensor_array(pil))

        # Stash the FIRST input frame (the base image BEFORE overlay) to
        # ComfyUI's temp/ folder so the editor canvas can use it as the
        # background. Without this, when upstream is an intermediate
        # generative node (VAE Decode, ImageScale, etc) that does not
        # populate node.imgs[0] on the frontend, the editor has no base
        # image to draw on and shows the 'Run the workflow once' message
        # even though the workflow HAS run.
        ui_payload = {}
        try:
            input_frame = image[0].clamp(0, 1).cpu().numpy()
            input_frame = (input_frame * 255).astype(np.uint8)
            input_pil = Image.fromarray(input_frame, "RGB")
            temp_dir = folder_paths.get_temp_directory()
            os.makedirs(temp_dir, exist_ok=True)
            fname = f"pixaroma_text_overlay_base_{uuid.uuid4().hex[:12]}.png"
            input_pil.save(os.path.join(temp_dir, fname), "PNG", optimize=False)
            ui_payload = {
                "pixaroma_text_overlay_base": [
                    {"filename": fname, "subfolder": "", "type": "temp"}
                ]
            }
        except Exception as e:
            print(f"[Text Overlay Pixaroma] WARN: failed to stash base image preview: {e}")

        return {"ui": ui_payload, "result": (torch.stack(outputs, dim=0),)}

    @staticmethod
    def _pil_to_tensor_array(pil):
        rgb = pil.convert("RGB")
        arr = np.array(rgb).astype(np.float32) / 255.0
        return torch.from_numpy(arr)


NODE_CLASS_MAPPINGS = {"PixaromaTextOverlay": PixaromaTextOverlay}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaTextOverlay": "Text Overlay Pixaroma"}
