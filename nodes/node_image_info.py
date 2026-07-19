"""Image Info Pixaroma - unpack the image_info bundle from Load Image Mini.

Load Image Mini keeps its face small by emitting a single `image_info` bundle
instead of five separate outputs. Wire that bundle in here to get the image,
mask, width, height and filename back as normal outputs. The node also reports
width / height / filename on its own face (painted beside the outputs in the
Classic renderer) so a quick glance often saves pulling the wires at all.
"""

import torch


class PixaromaImageInfo:
    DESCRIPTION = (
        "Image Info Pixaroma - unpacks the image_info bundle from Load Image "
        "Mini Pixaroma into image, mask, width, height and filename outputs. "
        "Wire it in only when you need those extras, so the loader stays "
        "compact. The width, height and filename also show on the node face."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_info": ("PIX_IMAGE_INFO", {"tooltip": "The image_info bundle from a Load Image Mini Pixaroma node."}),
            },
        }

    CATEGORY = "👑 Pixaroma/🖼️ Image"
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "STRING")
    RETURN_NAMES = ("image", "mask", "width", "height", "filename")
    OUTPUT_TOOLTIPS = (
        "The image from the bundle (same as the loader's image output).",
        "The image's mask, from its alpha channel (blank if it has none).",
        "Image width in pixels, after any resize.",
        "Image height in pixels, after any resize.",
        "The image's filename.",
    )
    FUNCTION = "unpack"
    OUTPUT_NODE = True  # so the ui readout fires each run even mid-graph

    def unpack(self, image_info):
        # Defensive: a malformed / missing bundle must not crash the graph. Fall
        # back to a tiny black image + blank mask + zeros so downstream wiring
        # still receives valid tensors.
        if not isinstance(image_info, dict):
            image = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            mask = torch.zeros((1, 64, 64), dtype=torch.float32)
            return {"ui": {"pixaroma_image_info": [{"width": 0, "height": 0, "filename": ""}]},
                    "result": (image, mask, 0, 0, "")}

        image = image_info.get("image")
        mask = image_info.get("mask")
        if not isinstance(image, torch.Tensor):
            image = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
        if not isinstance(mask, torch.Tensor):
            mask = torch.zeros((1, image.shape[1] if image.ndim >= 3 else 64,
                                image.shape[2] if image.ndim >= 3 else 64), dtype=torch.float32)

        # Prefer the bundled dims; fall back to the tensor shape so the outputs
        # are always right even if a future producer forgets to set them.
        width = image_info.get("width")
        height = image_info.get("height")
        if not isinstance(width, int) or width <= 0:
            width = int(image.shape[2]) if image.ndim >= 3 else 0
        if not isinstance(height, int) or height <= 0:
            height = int(image.shape[1]) if image.ndim >= 3 else 0
        filename = image_info.get("filename")
        if not isinstance(filename, str):
            filename = ""

        return {
            "ui": {"pixaroma_image_info": [{"width": width, "height": height, "filename": filename}]},
            "result": (image, mask, width, height, filename),
        }


NODE_CLASS_MAPPINGS = {"PixaromaImageInfo": PixaromaImageInfo}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaImageInfo": "Image Info Pixaroma"}
