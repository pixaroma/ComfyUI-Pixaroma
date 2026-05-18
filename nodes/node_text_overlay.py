"""Text Overlay Pixaroma - fullscreen multi-layer text editor.

Reads layers from a hidden TextOverlayState input populated at submission time
by js/text_overlay/index.js's app.graphToPrompt hook. Renders each layer via
nodes/_text_render_helpers.py::render_text_layer on top of either the upstream
image OR a blank canvas at the user's width/height/bg_color widgets.
"""
import json
import numpy as np
import torch
from PIL import Image

from ._text_render_helpers import render_text_layer


class PixaromaTextOverlay:
    CATEGORY = "👑 Pixaroma"
    DESCRIPTION = (
        "Fullscreen text-overlay editor. Adds multi-layer styled text on top of "
        "an input image, or on a blank canvas when no image is wired. Click the "
        "Open Text Overlay button on the node to launch the editor."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {
                    "default": 1024, "min": 64, "max": 8192, "step": 8,
                    "tooltip": "Canvas width when no image is wired. Ignored when image input is connected.",
                }),
                "height": ("INT", {
                    "default": 1024, "min": 64, "max": 8192, "step": 8,
                    "tooltip": "Canvas height when no image is wired. Ignored when image input is connected.",
                }),
                "bg_color": ("STRING", {
                    "default": "#000000",
                    "tooltip": "Background hex color when no image is wired. Ignored when image input is connected.",
                }),
            },
            "optional": {
                "image": ("IMAGE", {"tooltip": "Optional. When wired, used as the canvas; widgets are ignored."}),
            },
            "hidden": {
                "TextOverlayState": ("STRING", {"default": "{}"}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "build"

    def build(self, width, height, bg_color, image=None, TextOverlayState="{}"):
        try:
            state = json.loads(TextOverlayState) if TextOverlayState else {}
        except json.JSONDecodeError:
            print("[Text Overlay Pixaroma] WARN: malformed TextOverlayState, treating as empty")
            state = {}
        layers = state.get("layers", []) or []

        if image is not None:
            return self._build_from_image(image, layers)

        base = Image.new("RGBA", (int(width), int(height)), self._parse_hex(bg_color))
        for layer in layers:
            render_text_layer(base, layer)
        return (self._pil_to_tensor(base),)

    def _build_from_image(self, image_tensor, layers):
        outputs = []
        for b in range(image_tensor.shape[0]):
            frame = image_tensor[b].clamp(0, 1).cpu().numpy()
            frame = (frame * 255).astype(np.uint8)
            pil = Image.fromarray(frame, "RGB").convert("RGBA")
            for layer in layers:
                render_text_layer(pil, layer)
            outputs.append(self._pil_to_tensor_array(pil))
        return (torch.stack(outputs, dim=0),)

    @staticmethod
    def _pil_to_tensor(pil):
        rgb = pil.convert("RGB")
        arr = np.array(rgb).astype(np.float32) / 255.0
        return torch.from_numpy(arr).unsqueeze(0)

    @staticmethod
    def _pil_to_tensor_array(pil):
        rgb = pil.convert("RGB")
        arr = np.array(rgb).astype(np.float32) / 255.0
        return torch.from_numpy(arr)

    @staticmethod
    def _parse_hex(hex_str):
        h = hex_str.lstrip("#")
        if len(h) != 6:
            return (0, 0, 0, 255)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


NODE_CLASS_MAPPINGS = {"PixaromaTextOverlay": PixaromaTextOverlay}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaTextOverlay": "Text Overlay Pixaroma"}
