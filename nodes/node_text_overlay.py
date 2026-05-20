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

from ._text_render_helpers import render_text_layer, compute_text_bbox


class PixaromaTextOverlay:
    CATEGORY = "👑 Pixaroma"
    DESCRIPTION = (
        "Adds a single styled text overlay on top of an input image. "
        "Tune font, size, weight, italic, alignment, line height, letter "
        "spacing, opacity, rotation, position, text color and an optional "
        "background bar directly on the node. Click 'Open Text Editor' for "
        "a fullscreen canvas with drag-to-move, drag-corner-to-scale, "
        "drag-handle-to-rotate, snap guides, align-to-canvas buttons, "
        "Fit W / Fit H, undo/redo and Save-to-Disk. Wire the optional "
        "'text' input to override the panel text from any upstream STRING "
        "source. The first run on a fresh node auto-centers the text on "
        "the actual image dimensions."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Required upstream image. Text is overlaid on this image at render time."}),
            },
            "optional": {
                "text": ("STRING", {
                    "forceInput": True,
                    "tooltip": "Optional STRING input. When wired, replaces the panel's text at render time (the textarea on the node is greyed out while the wire is connected to remind you).",
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

        # First-run positioning. The JS graphToPrompt hook can only position
        # the text when upstream has imgs[0] available (Load Image case). For
        # generative chains (KSampler -> VAE Decode -> Text Overlay), the
        # upstream image doesn't exist yet at submit time, so the JS hook
        # can't position. Do it here in Python where the image dims are real.
        # Two pending intents (explicit align wins over default auto-center):
        #   _alignPending      - user clicked a "Position on canvas" button on
        #                        the node body before dims were known.
        #   _autoCenterPending - fresh node that has never been centered.
        # Send the resolved position back via the ui payload so the JS state
        # persists the x/y instead of staying at the default forever.
        autocentered = None
        align_mode = state.get("_alignPending")
        if align_mode and state.get("text"):
            try:
                H, W = image.shape[1], image.shape[2]
                bbox_w, bbox_h = compute_text_bbox(state)
                if align_mode == "left":
                    state["x"] = 0
                elif align_mode == "centerH":
                    state["x"] = (W - bbox_w) // 2
                elif align_mode == "right":
                    state["x"] = W - bbox_w
                elif align_mode == "top":
                    state["y"] = 0
                elif align_mode == "centerV":
                    state["y"] = (H - bbox_h) // 2
                elif align_mode == "bottom":
                    state["y"] = H - bbox_h
                state.pop("_alignPending", None)
                state.pop("_autoCenterPending", None)
                autocentered = {"x": state.get("x", 0), "y": state.get("y", 0)}
            except Exception as e:
                print(f"[Text Overlay Pixaroma] WARN: align-on-canvas failed: {e}")
        elif state.get("_autoCenterPending") and state.get("text"):
            try:
                H, W = image.shape[1], image.shape[2]
                bbox_w, bbox_h = compute_text_bbox(state)
                state["x"] = max(0, (W - bbox_w) // 2)
                state["y"] = max(0, (H - bbox_h) // 2)
                state.pop("_autoCenterPending", None)
                autocentered = {"x": state["x"], "y": state["y"]}
            except Exception as e:
                print(f"[Text Overlay Pixaroma] WARN: auto-center failed: {e}")

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

        # Tell the JS side about the auto-centered position so it can
        # persist the new x/y on node.properties and clear the pending
        # flag (so subsequent runs don't re-center).
        if autocentered is not None:
            ui_payload["pixaroma_text_overlay_autocentered"] = [autocentered]

        return {"ui": ui_payload, "result": (torch.stack(outputs, dim=0),)}

    @staticmethod
    def _pil_to_tensor_array(pil):
        rgb = pil.convert("RGB")
        arr = np.array(rgb).astype(np.float32) / 255.0
        return torch.from_numpy(arr)


NODE_CLASS_MAPPINGS = {"PixaromaTextOverlay": PixaromaTextOverlay}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaTextOverlay": "Text Overlay Pixaroma"}
