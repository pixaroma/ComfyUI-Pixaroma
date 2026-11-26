"""Seamless Border Prep / Kit Pixaroma: turn a border strip into a whole frame with painted corners.

Seamless Tile ("Left and right") makes a strip that repeats sideways. A frame also needs corners, and a corner can't
come from the wrap-around trick: its right edge must continue the top strip and its bottom edge the side strip,
which are fixed pictures, not a loop. So the corner is inpainted:

    strip -> Seamless Border Prep -> canvas + mask -> your inpaint (model WITHOUT Seamless Tile) -> VAE Decode
          -> Seamless Border Kit (with Prep's border_info) -> 9-slice kit, corner, strips, frame preview, CSS

Prep pre-fills the corner with a mitred (45 degree) join, so wiring Prep's canvas straight into Kit gives a mitred
frame with no model at all. Kit fades the corner's last few pixels into both strips, so the joins are exact whatever
the model painted. The math is in _border_helpers.
"""
import logging

import torch
import torch.nn.functional as F

from ._border_helpers import MASK_MODES, BorderError, blend_corner, build_canvas, corner_mask, css_line, find_band, \
    frame, keep_unmasked, mirror_column, side_from_band

# Wire type between the two nodes: a dict (band tensor, background colour, sizes). A plain duplicated string like
# PIXAROMA_OUTPAINT_INFO.
PIXAROMA_BORDER_INFO = "PIXAROMA_BORDER_INFO"
OUTER_EDGES = ("Top", "Bottom")
CORNER_AT = ("Mirror line", "Strip edge")


class SeamlessBorderPrepPixaroma:
    DESCRIPTION = (
        "Cuts the band out of a border strip made with Seamless Tile (Left and right) and lays out a canvas for "
        "inpainting a corner piece: the corner top-left, the strip to its right, the strip turned down the side, "
        "and a mask over the corner. Inpaint it with your usual setup, then give the result to Seamless Border Kit."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "strip": ("IMAGE", {
                    "tooltip": "The border strip from VAE Decode: a band across a plain background that repeats left "
                               "to right. Keep its full width: the width is one repeat.",
                }),
                "band_top": ("INT", {
                    "default": 0, "min": 0, "max": 16384,
                    "tooltip": "First row of the band, in pixels from the top. 0 = find it automatically.",
                }),
                "band_bottom": ("INT", {
                    "default": 0, "min": 0, "max": 16384,
                    "tooltip": "Last row of the band. 0 = find it automatically.",
                }),
                "context": ("FLOAT", {
                    "default": 1.0, "min": 0.5, "max": 6.0, "step": 0.25,
                    "tooltip": "How much strip the model sees beside the corner, in band thicknesses. More gives the "
                               "model more of the pattern to follow, and a bigger canvas (never under 1024 px).",
                }),
                "outer_edge": (list(OUTER_EDGES), {
                    "default": "Top",
                    "tooltip": "Which edge of the band faces out of the frame. Bottom turns the band upside down.",
                }),
                "repaint": (list(MASK_MODES), {
                    "default": "Seam",
                    "tooltip": "What the model repaints. Seam = only a band along the mitre's diagonal: the strip's "
                               "bands carry on round the corner and the model redraws where they turn (most "
                               "coherent). Corner = the whole corner square: a new corner piece, less tied to the strip.",
                }),
                "seam_width": ("FLOAT", {
                    "default": 0.4, "min": 0.05, "max": 1.0, "step": 0.05,
                    "tooltip": "Seam only: how wide the repainted band along the diagonal is, as a share of the "
                               "band thickness. 0.25 = a small ornament on the turn; 0.4 = room for a bigger one.",
                }),
                "corner_at": (list(CORNER_AT), {
                    "default": "Mirror line",
                    "tooltip": "Where along the strip the corner turns. Mirror line = the point where the pattern "
                               "mirrors itself (a motif's centre or a tile edge): both halves of the corner match "
                               "and a motif sits on the turn. Strip edge = the strip's own left edge. The strips "
                               "Kit outputs start at the same point.",
                }),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", PIXAROMA_BORDER_INFO)
    RETURN_NAMES = ("canvas", "mask", "border_info")
    OUTPUT_TOOLTIPS = (
        "The canvas to inpaint. The corner already holds a mitred join: denoise 1.0 paints a new corner, lower keeps "
        "it closer to the mitre. Wire it straight into Seamless Border Kit for a mitred frame with no model.",
        "White where the model should paint: along the corner's diagonal (Seam) or the whole corner (Corner).",
        "Wire into Seamless Border Kit.",
    )
    FUNCTION = "prep"
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    def prep(self, strip, band_top=0, band_bottom=0, context=1.0, outer_edge="Top", repaint="Seam", seam_width=0.4,
             corner_at="Mirror line"):
        if strip.shape[0] != 1:
            raise BorderError(f"Seamless Border Prep takes one strip, got a batch of {strip.shape[0]}. Pick one "
                              "first (for example with an image-from-batch node).")
        img = strip[0, ..., :3].float()
        top, bottom, bg = find_band(img, band_top, band_bottom + 1 if band_bottom > 0 else 0)
        band = img[top:bottom].clone()
        if outer_edge == "Bottom":
            band = band.flip(0)
        start = mirror_column(band) if corner_at == "Mirror line" else 0
        band = band.roll(-start, dims=1)
        canvas, mask_img, size = build_canvas(band, bg, context, repaint, seam_width)
        t, w = band.shape[0], band.shape[1]
        logging.info(f"[Seamless Border Pixaroma] band rows {top}-{bottom - 1} ({t} px thick, repeat {w} px), "
              f"corner at column {start}, canvas {size} x {size}")
        info = {"band": band, "bg": bg, "size": size, "mask": corner_mask(band.shape[0], repaint, seam_width)}
        return (canvas.unsqueeze(0), mask_img.unsqueeze(0), info)


class SeamlessBorderKitPixaroma:
    DESCRIPTION = (
        "Takes the inpainted canvas (or Prep's canvas as it is, for a mitred corner) and builds the frame: the "
        "corner joined exactly to both strips, turned for all four corners. Outputs a 9-slice image for CSS "
        "border-image, the pieces on their own, a frame preview and the CSS line."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {
                    "tooltip": "The inpainted canvas after VAE Decode. A batch gives one kit per picture. Prep's "
                               "canvas wired straight in gives a mitred corner.",
                }),
                "border_info": (PIXAROMA_BORDER_INFO, {"tooltip": "From Seamless Border Prep."}),
                "blend": ("INT", {
                    "default": 12, "min": 0, "max": 256,
                    "tooltip": "Pixels at the corner's two inner edges faded into the strips, so the joins match "
                               "exactly. 0 = keep the painted corner as it is (the joins may show).",
                }),
                "preview_repeats": ("INT", {
                    "default": 3, "min": 1, "max": 12,
                    "tooltip": "Strip repeats per side in the frame preview.",
                }),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "IMAGE", "IMAGE", "STRING")
    RETURN_NAMES = ("kit", "corner", "top_strip", "side_strip", "frame_preview", "css")
    OUTPUT_TOOLTIPS = (
        "9-slice image: the four corners and one repeat of each side. Save it as border.png for the CSS line.",
        "The top-left corner. Turn it 90 degrees for each next corner, clockwise.",
        "The top strip, one repeat. Turn it 180 degrees for the bottom.",
        "The left side, one repeat. Turn it 180 degrees for the right side.",
        "A whole frame, to check the joins by eye.",
        "CSS for a box with this border, using the kit saved as border.png.",
    )
    FUNCTION = "kit"
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    def kit(self, image, border_info, blend=12, preview_repeats=3):
        band, bg, size = border_info["band"], border_info["bg"], border_info["size"]
        t = band.shape[0]
        images = image[..., :3].float()
        if images.shape[1] != size or images.shape[2] != size:
            # an upscaled result, or a model that changed the size: back to the canvas Prep made
            images = F.interpolate(images.permute(0, 3, 1, 2), size=(size, size), mode="bilinear",
                                   align_corners=False, antialias=True).permute(0, 2, 3, 1)
        band, bg = band.to(images), bg.to(images)
        kits, corners, previews = [], [], []
        for img in images:
            corner = img[:t, :t].clamp(0, 1)
            if "mask" in border_info:
                corner = keep_unmasked(corner, band, border_info["mask"])
            corner = blend_corner(corner, band, blend)
            corners.append(corner)
            kits.append(frame(corner, band, bg, 1))
            previews.append(frame(corner, band, bg, preview_repeats))
        n = len(corners)
        top = band.unsqueeze(0).repeat(n, 1, 1, 1)
        side = side_from_band(band).unsqueeze(0).repeat(n, 1, 1, 1)
        return (torch.stack(kits), torch.stack(corners), top, side, torch.stack(previews), css_line(t))


NODE_CLASS_MAPPINGS = {
    "SeamlessBorderPrepPixaroma": SeamlessBorderPrepPixaroma,
    "SeamlessBorderKitPixaroma": SeamlessBorderKitPixaroma,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SeamlessBorderPrepPixaroma": "Seamless Border Prep Pixaroma",
    "SeamlessBorderKitPixaroma": "Seamless Border Kit Pixaroma",
}
