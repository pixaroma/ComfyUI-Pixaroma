"""Image Grid Pixaroma - every picture of a Run in one grid image.

A LIST input (Load Images from Folder, Prompt Each, a Loop) runs a node once
per item, so a preview node only ever shows the LAST picture. This node sets
INPUT_IS_LIST, so ComfyUI hands it the WHOLE list in one call (execution.py:
_async_map_node_over_list calls FUNCTION once with every input as a list), and
it lays every picture out in one image: the file name under each one, an
optional "before" picture above it, an optional title on top.

Every input arrives as a LIST, the widgets too: a widget value is [value],
so `_one()` takes the first. A batch inside one item is split into its frames.

The grid is returned as an IMAGE (save it with any save node) and shown on the
node through ComfyUI's own preview (ui.images, a temp file), so it needs no
browser code and looks the same in Classic and Nodes 2.0.
"""
import math
import os
import random

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont

import folder_paths

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_FONT = os.path.join(_HERE, "assets", "fonts", "Inter-Variable.ttf")

BACKGROUNDS = {"dark": ((30, 30, 30), (225, 225, 225)), "white": ((255, 255, 255), (35, 35, 35)),
               "black": ((0, 0, 0), (230, 230, 230)), "grey": ((72, 72, 72), (240, 240, 240))}
MAX_PICTURES = 1024     # a grid of more is unreadable anyway, and it bounds the work
MAX_SIDE = 8192         # the finished grid's longest side; cells shrink to fit under it


def _one(v, default):
    """A widget value arrives as a list under INPUT_IS_LIST."""
    if isinstance(v, (list, tuple)):
        v = v[0] if len(v) else default
    return default if v is None else v


def _frames(items):
    """A list of IMAGE tensors (each [B,H,W,C]) -> [(item_index, frame_in_item, frames_in_item, tensor[H,W,C])]."""
    out = []
    for i, t in enumerate(items or []):
        if not isinstance(t, torch.Tensor):
            continue
        if t.dim() == 3:
            t = t.unsqueeze(0)
        if t.dim() != 4:
            continue
        for k in range(t.shape[0]):
            out.append((i, k, t.shape[0], t[k]))
            if len(out) >= MAX_PICTURES:
                return out
    return out


def _to_pil(frame, bg):
    """One [H,W,C] frame -> RGB PIL. RGBA is composited onto the grid colour, never sheared."""
    a = frame.detach().float().cpu().clamp(0, 1).numpy()
    c = a.shape[-1]
    if c == 1:
        a = np.repeat(a, 3, axis=-1)
    if c >= 4:
        rgb, alpha = a[..., :3], a[..., 3:4]
        a = rgb * alpha + (np.array(bg, dtype=np.float32) / 255.0) * (1.0 - alpha)
    elif c == 2:
        a = np.repeat(a[..., :1], 3, axis=-1)
    return Image.fromarray((a[..., :3] * 255.0 + 0.5).astype(np.uint8), "RGB")


def _font(size):
    try:
        return ImageFont.truetype(_FONT, size)
    except Exception:
        try:
            return ImageFont.load_default(size)
        except Exception:
            return ImageFont.load_default()


def _fit_text(draw, text, font, width):
    """Shorten `text` with an ellipsis so it fits `width` pixels."""
    if draw.textlength(text, font=font) <= width:
        return text
    lo, hi = 0, len(text)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if draw.textlength(text[:mid] + "...", font=font) <= width:
            lo = mid
        else:
            hi = mid - 1
    return (text[:lo] + "...") if lo else ""


def _label(names, item, frame, frames_in_item, show):
    if not show:
        return ""
    name = ""
    if names:
        name = names[item] if item < len(names) else ""
        name = name if isinstance(name, str) else str(name)
    if not name:
        name = str(item + 1)
    return f"{name} ({frame + 1})" if frames_in_item > 1 else name


def build_grid(after, before=None, names=None, columns=0, cell=384, gap=8, background="dark", show_names=True, title=""):
    """Pure (tensors in, PIL out) so the harness can call it without ComfyUI's executor."""
    bg, fg = BACKGROUNDS.get(background, BACKGROUNDS["dark"])
    pics = _frames(after)
    if not pics:
        raise ValueError("Image Grid Pixaroma: no pictures came in. Wire the images output of the node that makes or loads them.")
    pre = _frames(before) if before else []
    n = len(pics)
    pair = bool(pre)
    cols = int(columns) if int(columns or 0) > 0 else max(1, math.ceil(math.sqrt(n * (2 if pair else 1))))
    cols = max(1, min(cols, n))
    rows = math.ceil(n / cols)
    cell = max(32, int(cell))
    gap = max(0, int(gap))

    def size_for(c):
        fs = max(11, c // 16)
        label_h = int(fs * 1.7) if show_names else 0
        title_h = int(fs * 2.6) if title else 0
        cell_h = c * (2 if pair else 1) + (gap if pair else 0) + label_h
        w = cols * c + (cols + 1) * gap
        h = title_h + rows * cell_h + (rows + 1) * gap
        return fs, label_h, title_h, cell_h, w, h

    fs, label_h, title_h, cell_h, W, H = size_for(cell)
    if max(W, H) > MAX_SIDE:
        cell = max(32, int(cell * MAX_SIDE / max(W, H)) - 1)
        fs, label_h, title_h, cell_h, W, H = size_for(cell)

    sheet = Image.new("RGB", (W, H), bg)
    draw = ImageDraw.Draw(sheet)
    font = _font(fs)
    if title:
        tfont = _font(int(fs * 1.5))
        t = _fit_text(draw, str(title), tfont, W - 2 * gap)
        draw.text((gap, gap + (title_h - int(fs * 1.5)) // 2), t, font=tfont, fill=fg)

    def paste(img, x, y):
        im = img.copy()
        im.thumbnail((cell, cell), Image.LANCZOS)
        sheet.paste(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2))

    for idx, (item, k, nk, frame) in enumerate(pics):
        r, c = divmod(idx, cols)
        x = gap + c * (cell + gap)
        y = title_h + gap + r * (cell_h + gap)
        if pair:
            if idx < len(pre):
                paste(_to_pil(pre[idx][3], bg), x, y)
            paste(_to_pil(frame, bg), x, y + cell + gap)
        else:
            paste(_to_pil(frame, bg), x, y)
        text = _label(names, item, k, nk, show_names)
        if text:
            t = _fit_text(draw, text, font, cell)
            tw = draw.textlength(t, font=font)
            draw.text((x + (cell - tw) / 2, y + cell_h - label_h + (label_h - fs) / 2 - 1), t, font=font, fill=fg)
    return sheet


class PixaromaImageGrid:
    DESCRIPTION = (
        "Image Grid Pixaroma - puts every picture of a Run into one grid image.\n\n"
        "When Load Images from Folder, Prompt Each or a Loop sends many pictures through a "
        "workflow, a preview shows only the last one. Wire the results into images and this node "
        "collects ALL of them into one picture, with each file name under its picture.\n\n"
        "Wire the original pictures into before to see before and after: each original sits above "
        "its result. Wire Load Images from Folder's filename into names to label each picture with "
        "its file name (without it they are numbered). Columns 0 picks a near-square grid by itself.\n\n"
        "The grid shows on the node and comes out of the grid output: wire it into Save Image "
        "Pixaroma to keep it. It works on a plain batch too. Very large grids are scaled down to "
        "8192 pixels on the long side, and up to 1024 pictures are used.\n\n"
        "Wire it to the pictures BEFORE a gate that holds some back (Text Match's if_match): "
        "ComfyUI skips the whole grid when any picture of the list was held back."
    )

    INPUT_IS_LIST = True
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "The pictures to collect, usually the results of a folder or list Run. A batch works too."}),
                "columns": ("INT", {"default": 0, "min": 0, "max": 64, "tooltip": "How many pictures side by side. 0 = automatic, a near-square grid."}),
                "cell_size": ("INT", {"default": 384, "min": 64, "max": 2048, "step": 16, "tooltip": "The size of each picture in the grid, in pixels (its longest side). The picture keeps its shape."}),
                "gap": ("INT", {"default": 8, "min": 0, "max": 128, "tooltip": "The space between the pictures, in pixels."}),
                "background": (list(BACKGROUNDS), {"default": "dark", "tooltip": "The colour behind the pictures. The names are written in a colour that reads on it."}),
                "show_names": ("BOOLEAN", {"default": True, "tooltip": "Write each picture's name (or its number) under it."}),
                "title": ("STRING", {"default": "", "tooltip": "Optional. A title across the top of the grid."}),
            },
            "optional": {
                "before": ("IMAGE", {"tooltip": "Optional. The original pictures, in the same order: each one is shown above its result."}),
                "names": ("STRING", {"forceInput": True, "tooltip": "Optional. A name for each picture, for example Load Images from Folder's filename output. Not wired: the pictures are numbered."}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("grid",)
    OUTPUT_TOOLTIPS = ("The grid as one picture. Wire it into Save Image Pixaroma to keep it.",)
    FUNCTION = "make"
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    def make(self, images, columns=0, cell_size=384, gap=8, background="dark", show_names=True, title="", before=None, names=None):
        sheet = build_grid(
            images, before=before, names=names,
            columns=_one(columns, 0), cell=_one(cell_size, 384), gap=_one(gap, 8),
            background=_one(background, "dark"), show_names=bool(_one(show_names, True)),
            title=str(_one(title, "") or "").strip(),
        )
        arr = np.asarray(sheet, dtype=np.float32) / 255.0
        tensor = torch.from_numpy(arr)[None, ...]
        # The on-node preview: ComfyUI's own temp-file preview, like Preview Image.
        temp = folder_paths.get_temp_directory()
        os.makedirs(temp, exist_ok=True)
        name = "pixaroma_grid_%08x.png" % random.getrandbits(32)
        sheet.save(os.path.join(temp, name), compress_level=4)
        return {"ui": {"images": [{"filename": name, "subfolder": "", "type": "temp"}]}, "result": (tensor,)}


NODE_CLASS_MAPPINGS = {"PixaromaImageGrid": PixaromaImageGrid}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaImageGrid": "Image Grid Pixaroma"}
