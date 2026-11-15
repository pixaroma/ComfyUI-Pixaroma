"""Seamless Preview Pixaroma.

Shows a picture repeated (2x2, 3x3, offset, half-drop, half-brick) so you can see if it really joins, checks the
edges (PASS / WARN / FAIL for each direction) and outputs the repeated layout as a picture for mock-ups.

The preview files are written by ComfyUI's own PreviewImage into the temp folder (no path code here). The face draws
the chosen view in the browser from that one picture; the `tiled` output is built here by _seamless_helpers.tile_view.
"""
from ._seamless_helpers import VIEWS, seam_check, tile_view

MAX_PREVIEWS = 16      # a big batch: the first 16 pictures are shown and checked; all of them are tiled


class SeamlessPreviewPixaroma:
    DESCRIPTION = (
        "Shows a picture repeated so you can see if it joins with no edge, and checks it for you. The face shows "
        "the view you pick: one tile, 2x2, 3x3, Offset (moved by half a tile so the four corners meet in the "
        "middle, where a seam shows first), Half-drop or Half-brick (the repeats print shops use). The badge says "
        "PASS when the edge looks like any other line of the picture, WARN when it is a little stronger, FAIL when "
        "it is a real seam. image passes the picture through unchanged; tiled is the view as a bigger picture, for "
        "mock-ups and thumbnails."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {
                    "tooltip": "The picture to check, for example from VAE Decode after Seamless Tile Pixaroma.",
                }),
                "view": (list(VIEWS), {
                    "default": "2x2",
                    "tooltip": "How the face shows the repeat, and what the tiled output makes. Offset moves the "
                               "picture by half so the corners meet in the middle. Half-drop moves every other "
                               "column down by half, Half-brick every other row right by half.",
                }),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("image", "tiled")
    OUTPUT_TOOLTIPS = (
        "The same picture, unchanged. Connect it to a save node.",
        "The picture repeated the way the view shows it (2x2 is twice as wide and tall).",
    )
    FUNCTION = "preview"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    def preview(self, image, view="2x2", prompt=None, extra_pnginfo=None):
        import nodes as core     # at call time: a module-level import error would sink the whole pack

        if view not in VIEWS:
            view = "2x2"
        shown = image[:MAX_PREVIEWS]
        # the workflow goes into the preview PNG, as core's Preview Image does (drag it back into ComfyUI)
        saved = core.PreviewImage().save_images(shown, filename_prefix="PixSeamless", prompt=prompt,
                                                extra_pnginfo=extra_pnginfo)["ui"]["images"]
        entries = []
        for i, ref in enumerate(saved):
            entries.append({
                "filename": ref.get("filename", ""),
                "subfolder": ref.get("subfolder", ""),
                "type": ref.get("type", "temp"),
                "width": int(shown.shape[2]),
                "height": int(shown.shape[1]),
                "seam": seam_check(shown[i]),
            })
        ui = {"pixaroma_seamless": entries}
        if image.shape[0] > MAX_PREVIEWS:
            ui["pixaroma_seamless_more"] = [int(image.shape[0] - MAX_PREVIEWS)]
        return {"ui": ui, "result": (image, tile_view(image, view))}


NODE_CLASS_MAPPINGS = {"SeamlessPreviewPixaroma": SeamlessPreviewPixaroma}
NODE_DISPLAY_NAME_MAPPINGS = {"SeamlessPreviewPixaroma": "Seamless Preview Pixaroma"}
