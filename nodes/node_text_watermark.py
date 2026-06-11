"""Text Watermark Pixaroma - anchored, margin-based text watermark.

Reuses the Text Overlay render engine (nodes/_text_render_helpers.py). State
comes from a hidden TextWatermarkState input populated by
js/text_watermark/index.js's app.graphToPrompt hook. Unlike Text Overlay the
position is derived from a 9-point anchor + a margin inset, and the size can be
a fixed pixel value or a percentage of each image's width - so a mixed-size
batch gets a visually consistent watermark.
"""
import json
import math
import numpy as np
import torch
from PIL import Image

from ._text_render_helpers import render_text_layer, compute_text_bbox, resolve_font_variant


# Each anchor's horizontal band (left / center / right) and vertical band
# (top / middle / bottom). Used to turn the 9-point anchor + margin into x/y.
_ANCHOR_COLS = {
    "top-left": "left", "middle-left": "left", "bottom-left": "left",
    "top-center": "center", "center": "center", "bottom-center": "center",
    "top-right": "right", "middle-right": "right", "bottom-right": "right",
}
_ANCHOR_ROWS = {
    "top-left": "top", "top-center": "top", "top-right": "top",
    "middle-left": "middle", "center": "middle", "middle-right": "middle",
    "bottom-left": "bottom", "bottom-center": "bottom", "bottom-right": "bottom",
}


class PixaromaTextWatermark:
    CATEGORY = "👑 Pixaroma"
    DESCRIPTION = (
        "Stamps a styled text watermark onto an image or a whole batch. Pick a "
        "9-point anchor (corner, edge or center) plus a margin inset and the "
        "watermark lands in the same spot on every image regardless of its "
        "size. Size can be a fixed pixel value or a percentage of each image's "
        "width, so mixed-size batches stay visually consistent. Tune font, "
        "weight, italic, color, opacity, rotation and an optional background "
        "bar on the node. Wire the optional 'text' input to drive the watermark "
        "text from an upstream STRING source. No fullscreen editor - it is a "
        "configure-and-run node."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Image or batch to watermark. The watermark is drawn on top at render time."}),
            },
            "optional": {
                "text": ("STRING", {
                    "forceInput": True,
                    "tooltip": "Optional STRING input. When wired, it replaces the watermark text typed on the node (the textbox greys out while connected).",
                }),
            },
            "hidden": {
                "TextWatermarkState": ("STRING", {"default": "{}"}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    OUTPUT_TOOLTIPS = ("The input image(s) with the watermark drawn on top.",)
    FUNCTION = "build"

    def build(self, image, text=None, TextWatermarkState="{}"):
        try:
            state = json.loads(TextWatermarkState) if TextWatermarkState else {}
        except json.JSONDecodeError:
            print("[Text Watermark Pixaroma] WARN: malformed TextWatermarkState, treating as empty")
            state = {}

        # Optional wired text overrides the panel text (None when unwired).
        if text is not None:
            state["text"] = str(text)

        outputs = []
        for b in range(image.shape[0]):
            frame = image[b].clamp(0, 1).cpu().numpy()
            frame = (frame * 255).astype(np.uint8)
            pil = Image.fromarray(frame, "RGB").convert("RGBA")
            if state and state.get("text"):
                self._stamp(pil, state)
            outputs.append(self._pil_to_tensor_array(pil))

        return (torch.stack(outputs, dim=0),)

    def _stamp(self, pil, state):
        """Compute the anchored x/y from anchor + margin + size mode for THIS
        image, then hand a per-image state copy to the shared renderer."""
        W, H = pil.width, pil.height

        # Effective font size: fixed px, or a % of this image's width so the
        # watermark scales consistently across a mixed-size batch.
        size_mode = state.get("sizeMode", "px")
        base_size = float(state.get("fontSize", 64))
        if size_mode == "pct":
            font_px = max(1, int(round(W * base_size / 100.0)))
        else:
            font_px = max(1, int(round(base_size)))

        # Per-image render state: same field names the Text Overlay engine
        # reads, with the resolved size + computed x/y.
        st = dict(state)
        st["fontSize"] = font_px
        try:
            bbox_w, bbox_h = compute_text_bbox(st)
        except Exception as e:
            print(f"[Text Watermark Pixaroma] WARN: bbox failed: {e}")
            return

        # Synthesized italic (fonts with no real italic, e.g. Anton) leans the
        # text and the renderer widens the layer by a slant overhang on the
        # right so the lean isn't clipped. compute_text_bbox does NOT include
        # that overhang, so right / center anchoring must add it back - else a
        # right-anchored italic watermark pushes its lean off the edge. Matches
        # the slant math in _text_render_helpers.render_text_layer (12 degrees,
        # no supersampling on the non-rotated path).
        # Italic widens the rendered layer ONLY when the font has no real italic
        # face and the renderer SYNTHESIZES the lean (a skew). A font WITH a
        # genuine italic renders upright metrics with no overhang, so adding the
        # slant would over-inset right/center anchors. Gate on the same
        # synthesized-italic decision the renderer makes.
        # Vertical direction renders upright (the renderer skips the synthesized
        # lean entirely), so no slant compensation there.
        eff_w = bbox_w
        if (
            state.get("direction", "horizontal") != "vertical"
            and bool(state.get("italic", False))
            and self._is_synthesized_italic(state)
        ):
            slant = int(math.ceil(math.tan(math.radians(12)) * bbox_h))
            # + a small size-relative cushion for italic ink that overhangs the
            # advance width (the bbox measurement misses it).
            eff_w += slant + int(math.ceil(0.06 * font_px))

        margin_x = int(state.get("marginX", 20))
        margin_y = int(state.get("marginY", 20))
        anchor = state.get("anchor", "bottom-right")
        col = _ANCHOR_COLS.get(anchor, "right")
        row = _ANCHOR_ROWS.get(anchor, "bottom")

        if col == "left":
            x = margin_x
        elif col == "center":
            x = int(round((W - eff_w) / 2))
        else:  # right
            x = W - eff_w - margin_x

        if row == "top":
            y = margin_y
        elif row == "middle":
            y = int(round((H - bbox_h) / 2))
        else:  # bottom
            y = H - bbox_h - margin_y

        st["x"] = x
        st["y"] = y
        try:
            render_text_layer(pil, st)
        except Exception as e:
            print(f"[Text Watermark Pixaroma] WARN: render failed: {e}")

    @staticmethod
    def _is_synthesized_italic(state):
        """True if the renderer will FAKE italic (skew) because the font has no
        real italic face. Mirrors resolve_font_variant's decision so the anchor
        math only widens for the synthesized case."""
        try:
            variant = resolve_font_variant(
                state.get("font", "Roboto"),
                int(state.get("weight", 400)),
                True,
            )
            return bool(variant.get("synthesized_italic"))
        except Exception:
            return True  # assume synthesized (keeps the extra slant room - safer)

    @staticmethod
    def _pil_to_tensor_array(pil):
        rgb = pil.convert("RGB")
        arr = np.array(rgb).astype(np.float32) / 255.0
        return torch.from_numpy(arr)


NODE_CLASS_MAPPINGS = {"PixaromaTextWatermark": PixaromaTextWatermark}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaTextWatermark": "Text Watermark Pixaroma"}
