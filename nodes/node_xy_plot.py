"""XY Plot Pixaroma - run the workflow over every X x Y value combination and
assemble the results into a labeled comparison grid.

How it works (the heavy lifting is shared with Prompt Multi / Prompt Pack):
  - The frontend (js/xy_plot/) patches app.queuePrompt to loop ONE workflow run
    per (x, y) cell. Before each run it injects that cell's X and Y values into
    the TARGET nodes' widgets via app.graphToPrompt, and injects this node's
    per-cell cursor + the full label arrays into the hidden XYPlotState input
    (Vue Compat #9).
  - Each run, this node receives the cell image + the cursor. It accumulates the
    cell server-side keyed by a per-plot `sessionId`, (re)assembles the labeled
    grid PNG with PIL, hands the PNG filename to the frontend (custom ui key
    `pixaroma_xy_grid`) for the in-node <img> preview, and outputs the assembled
    grid tensor on the `grid` IMAGE slot. The grid is valid after every cell
    (missing/errored cells stay blank) and complete after the last one.
  - A normal Run (no plot cursor) just passes the image straight through.

The accumulator + cell PILs are also reachable by the save routes
(server_routes.py) so the Save buttons can write the grid (and optionally each
individual cell) to disk/output.
"""
import json
import os
import threading

import folder_paths
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont

from ._save_helpers import _json_safe

# Guards the module-level session state below. The node executes on ComfyUI's
# worker thread while the save / restyle routes run on the aiohttp thread, so a
# theme-restyle or save during a live plot can otherwise read `cells` mid-write
# (e.g. `next(iter(cells.values()))` raising "dict changed size during iteration").
_LOCK = threading.RLock()

# Hard cap on grid dimensions so a malformed/oversized state can't allocate a
# giant canvas before the long-side downscale kicks in. Mirrors the JS cap.
_MAX_DIM = 100

# ── Server-side accumulator ────────────────────────────────────────────────
# Keyed by sessionId -> {
#   "cells": {(xi, yi): PIL.Image RGB},   # the rendered cells received so far
#   "cols": int, "rows": int,
#   "x_labels": [str...], "y_labels": [str...],
#   "x_name": str, "y_name": str, "draw_labels": bool,
#   "grid_name": str,   # stable temp filename for this plot's grid PNG
#   "prefix": str,      # filename_prefix for the Save buttons
# }
_SESSIONS = {}
_SESSION_ORDER = []      # LRU order of sessionIds
_MAX_SESSIONS = 8        # cap stored plots so memory can't grow unbounded

# Grid layout constants (px). Labels + gaps scale with cell size at render time.
_GRID_LONG_SIDE_CAP = 4096   # scale the whole grid down if it exceeds this

# Grid color themes. The cells are the user's images (unchanged); these colors
# style the background, the empty-cell tiles, the value labels, and the orange
# axis-name lines. "dark" is the Pixaroma default.
_THEMES = {
    "dark":  {"grid": (20, 20, 20),    "cell": (42, 42, 42),    "label": (235, 235, 235), "axis": (246, 103, 68)},
    "light": {"grid": (242, 242, 242), "cell": (255, 255, 255), "label": (28, 28, 28),    "axis": (214, 80, 48)},
    "mono":  {"grid": (18, 18, 18),    "cell": (40, 40, 40),    "label": (236, 236, 236), "axis": (170, 170, 170)},
}

_FONT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "fonts")
_FONT_CACHE = {}


def _load_font(size):
    """Load a clean sans-serif label font from the bundled fonts, with
    graceful fallbacks. Variable fonts load at their default instance.
    Cached by size (labels reuse a handful of sizes per grid)."""
    size = max(8, int(size))
    if size in _FONT_CACHE:
        return _FONT_CACHE[size]
    font = None
    try:
        for name in ("Inter-Variable.ttf", "Roboto-Variable.ttf", "Montserrat-Variable.ttf"):
            p = os.path.join(_FONT_DIR, name)
            if os.path.exists(p):
                font = ImageFont.truetype(p, size)
                break
        if font is None and os.path.isdir(_FONT_DIR):
            for f in sorted(os.listdir(_FONT_DIR)):
                if f.lower().endswith((".ttf", ".otf")):
                    font = ImageFont.truetype(os.path.join(_FONT_DIR, f), size)
                    break
    except Exception:
        font = None
    if font is None:
        try:
            font = ImageFont.load_default(size)   # PIL >= 10
        except Exception:
            font = ImageFont.load_default()
    _FONT_CACHE[size] = font
    return font


def _fit_font(draw, text, base_size, max_w, min_size=10):
    """Return a font sized so `text` fits within `max_w` px - shrinking from
    `base_size` down to `min_size` rather than truncating, so axis labels stay
    fully readable (sampler / checkpoint names can be long)."""
    f = _load_font(base_size)
    w = _measure(draw, text, f)[0]
    if w <= max_w or w <= 0:
        return f
    return _load_font(max(min_size, int(base_size * max_w / w)))


def _tensor_to_pil(frame):
    """HxWxC float [0,1] tensor -> RGB PIL.Image.

    .detach() guards against autograd if ever called outside ComfyUI's no_grad
    executor; .contiguous() is required because a batch slice (image[i]) is
    often non-contiguous and .numpy() would fail/garble on it."""
    arr = (frame.detach().cpu().contiguous().numpy() * 255.0).clip(0, 255).astype(np.uint8)
    pil = Image.fromarray(arr)
    if pil.mode != "RGB":
        pil = pil.convert("RGB")
    return pil


def _pil_to_tensor(pil):
    """RGB PIL.Image -> 1xHxWx3 float [0,1] tensor.

    np.array (not np.asarray) so the buffer is writable - torch.from_numpy on a
    read-only PIL buffer can error or corrupt on later in-place ops."""
    if pil.mode != "RGB":
        pil = pil.convert("RGB")
    arr = np.array(pil, dtype=np.float32) / 255.0
    return torch.from_numpy(arr)[None, ...]


def _measure(draw, text, font):
    try:
        l, t, r, b = draw.textbbox((0, 0), text, font=font)
        return (r - l, b - t)
    except Exception:
        try:
            return draw.textsize(text, font=font)
        except Exception:
            return (len(text) * 7, 12)


def _truncate(draw, text, font, max_w):
    """Truncate `text` with an ellipsis so it fits in `max_w` px."""
    if not text:
        return ""
    if _measure(draw, text, font)[0] <= max_w:
        return text
    ell = "…"
    out = text
    while out and _measure(draw, out + ell, font)[0] > max_w:
        out = out[:-1]
    return (out + ell) if out else ell


def _evict_sessions():
    while len(_SESSION_ORDER) > _MAX_SESSIONS:
        old = _SESSION_ORDER.pop(0)
        sess = _SESSIONS.pop(old, None)
        # Delete the evicted plot's grid PNG from temp/ so old grids don't pile
        # up (temp is otherwise only cleared on ComfyUI restart).
        if sess and sess.get("grid_name"):
            try:
                p = os.path.join(folder_paths.get_temp_directory(), sess["grid_name"])
                if os.path.isfile(p):
                    os.remove(p)
            except Exception:
                pass


def _touch_session(session_id):
    if session_id in _SESSION_ORDER:
        _SESSION_ORDER.remove(session_id)
    _SESSION_ORDER.append(session_id)
    _evict_sessions()


def get_session(session_id):
    """Used by the save routes (server_routes.py)."""
    return _SESSIONS.get(session_id)


def restyle_session(session_id, theme):
    """Re-render an existing plot's grid with a new color theme WITHOUT
    re-running the workflow (the cells are still cached). Returns the grid's
    temp filename, or None if the session has been evicted. Used by the
    /pixaroma/api/xy_plot/restyle route for instant theme switching."""
    with _LOCK:
        sess = _SESSIONS.get(session_id)
        if not sess:
            return None
        sess["theme"] = theme if theme in _THEMES else "dark"
        grid_pil = _assemble_grid(sess)   # reads cells; under lock so execute can't mutate mid-read
        grid_name = sess["grid_name"]
    temp_dir = folder_paths.get_temp_directory()
    os.makedirs(temp_dir, exist_ok=True)
    try:
        grid_pil.save(os.path.join(temp_dir, grid_name), "PNG")   # I/O outside the lock
    except Exception:
        return None
    return grid_name


def _assemble_grid(sess):
    """Build the labeled grid PIL.Image from whatever cells `sess` has so far.
    Missing cells render as empty tiles. Pure function of the session state."""
    cells = sess["cells"]
    cols = max(1, int(sess["cols"]))
    rows = max(1, int(sess["rows"]))
    draw_labels = bool(sess.get("draw_labels", True))
    pal = _THEMES.get(sess.get("theme") or "dark", _THEMES["dark"])

    # Cell size = the first received cell's size (assume a uniform batch).
    sample = next(iter(cells.values()), None)
    if sample is not None:
        cell_w, cell_h = sample.size
    else:
        cell_w = cell_h = 256

    gap = max(4, round(min(cell_w, cell_h) * 0.02))
    font_size = max(13, min(48, round(cell_h * 0.07)))
    pad = max(4, round(font_size * 0.4))

    # Measure label strips with a scratch draw context.
    scratch = Image.new("RGB", (4, 4))
    sdraw = ImageDraw.Draw(scratch)
    font = _load_font(font_size)

    x_labels = sess.get("x_labels") or [""] * cols
    y_labels = sess.get("y_labels") or [""] * rows
    x_name = sess.get("x_name") or ""
    y_name = sess.get("y_name") or ""

    if draw_labels:
        col_label_h = font_size + 2 * pad
        # Row-label strip: wide enough to show the full Y label (sampler /
        # checkpoint names can be long). Shrink-to-fit handles anything that
        # still overflows, so we never chop a name down to "dpm…".
        row_w_cap = max(160, round(cell_w * 0.5))
        widest = 0
        for lab in y_labels:
            widest = max(widest, _measure(sdraw, str(lab), font)[0])
        # also keep room for the corner axis-name lines
        for nm in (("↓ " + y_name), ("→ " + x_name)):
            widest = max(widest, _measure(sdraw, nm, _load_font(max(11, round(font_size * 0.8))))[0])
        row_label_w = max(60, min(row_w_cap, widest + 2 * pad))
    else:
        col_label_h = 0
        row_label_w = 0

    grid_w = row_label_w + cols * cell_w + (cols + 1) * gap
    grid_h = col_label_h + rows * cell_h + (rows + 1) * gap

    img = Image.new("RGB", (grid_w, grid_h), pal["grid"])
    draw = ImageDraw.Draw(img)

    def cell_xy(ci, ri):
        x = row_label_w + gap + ci * (cell_w + gap)
        y = col_label_h + gap + ri * (cell_h + gap)
        return x, y

    # Cells (or empty tiles).
    for ri in range(rows):
        for ci in range(cols):
            x, y = cell_xy(ci, ri)
            cell = cells.get((ci, ri))
            if cell is not None:
                if cell.size != (cell_w, cell_h):
                    tile = Image.new("RGB", (cell_w, cell_h), pal["cell"])
                    fitted = cell.copy()
                    fitted.thumbnail((cell_w, cell_h), Image.LANCZOS)
                    tile.paste(fitted, ((cell_w - fitted.width) // 2,
                                        (cell_h - fitted.height) // 2))
                    img.paste(tile, (x, y))
                else:
                    img.paste(cell, (x, y))
            else:
                draw.rectangle([x, y, x + cell_w - 1, y + cell_h - 1], fill=pal["cell"])

    if draw_labels:
        # Column labels (X values) centered above each column - shrink to fit
        # the cell width, never truncate.
        for ci in range(cols):
            lab = str(x_labels[ci]) if ci < len(x_labels) else ""
            if not lab:
                continue
            lf = _fit_font(draw, lab, font_size, cell_w - 6)
            cx, _ = cell_xy(ci, 0)
            tw, th = _measure(draw, lab, lf)
            draw.text((cx + (cell_w - tw) / 2, (col_label_h - th) / 2), lab, font=lf, fill=pal["label"])
        # Row labels (Y values) centered in the left strip - shrink to fit the
        # (wide) strip, never truncate, so the full name is always readable.
        for ri in range(rows):
            lab = str(y_labels[ri]) if ri < len(y_labels) else ""
            if not lab:
                continue
            lf = _fit_font(draw, lab, font_size, row_label_w - 2 * pad)
            _, cy = cell_xy(0, ri)
            tw, th = _measure(draw, lab, lf)
            draw.text((max(2, (row_label_w - tw) / 2), cy + (cell_h - th) / 2), lab, font=lf, fill=pal["label"])
        # Axis names in the top-left corner: "↓ y_name" over "→ x_name".
        corner_lines = []
        if y_name:
            corner_lines.append("↓ " + y_name)
        if x_name:
            corner_lines.append("→ " + x_name)
        ty = 3
        for line in corner_lines:
            lf = _fit_font(draw, line, max(11, round(font_size * 0.8)), max(row_label_w, 80) - 6)
            draw.text((4, ty), line, font=lf, fill=pal["axis"])
            ty += _measure(draw, line, lf)[1] + 2

    # Cap the long side so a big grid can't explode memory / the preview.
    long_side = max(grid_w, grid_h)
    if long_side > _GRID_LONG_SIDE_CAP:
        scale = _GRID_LONG_SIDE_CAP / long_side
        img = img.resize((max(1, round(grid_w * scale)), max(1, round(grid_h * scale))), Image.LANCZOS)

    return img


class PixaromaXYPlot:
    DESCRIPTION = (
        "XY Plot Pixaroma - compare settings at a glance. Drop this node at the "
        "end of your workflow and wire your final image into it, just like a "
        "Preview node. In the node body, pick what changes ACROSS (X) and DOWN "
        "(Y) from a dropdown of the nodes already in your graph - no extra "
        "wiring. The value box adapts to what you pick: a number gives a "
        "Start/End/Steps range, a dropdown (sampler, model) gives a checklist, "
        "and a prompt gives find-and-replace. Hit Run once: the workflow runs "
        "for every combination and the results fill a labeled grid right here in "
        "the node, with Save Disk / Save Output / Copy / Open buttons. The seed "
        "is locked across cells (unless you're plotting the seed) so the only "
        "difference you see is the thing you're testing."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Wire your workflow's final image here, like a Preview node. Each plot run feeds one cell of the grid."}),
                "filename_prefix": ("STRING", {"default": "xy_plot", "tooltip": "Filename stem used by the Save buttons. Supports subfolders with '/' and the same date / native tokens as Preview Image Pixaroma."}),
            },
            "hidden": {
                "XYPlotState": ("STRING", {"default": "{}"}),
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("grid",)
    OUTPUT_TOOLTIPS = ("The assembled comparison grid. During a plot it's the grid built so far; after the last cell it's complete. Wire it onward (e.g. to upscale or save) if you like.",)
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Always re-execute: every cell is a distinct run with a different
        # cursor + (usually) a different upstream image. NaN guarantees no
        # cache hit ever returns a stale cell. Same pattern as Preview / Notify.
        return float("nan")

    def execute(self, image, filename_prefix="xy_plot", XYPlotState="{}", prompt=None, extra_pnginfo=None):
        try:
            state = json.loads(XYPlotState) if XYPlotState else {}
            if not isinstance(state, dict):
                state = {}
        except (ValueError, TypeError):
            state = {}

        session_id = state.get("sessionId")
        # No plot cursor -> this is a normal single Run. Pass the image through.
        if not session_id:
            return {"ui": {}, "result": (image,)}

        try:
            xi = int(state.get("xi", 0))
            yi = int(state.get("yi", 0))
            cols = max(1, min(_MAX_DIM, int(state.get("cols", 1))))
            rows = max(1, min(_MAX_DIM, int(state.get("rows", 1))))
        except (ValueError, TypeError) as e:
            print("[Pixaroma] XY Plot: malformed cursor in XYPlotState: %s" % e)
            return {"ui": {}, "result": (image,)}

        # Accumulate + (re)assemble under the lock so a concurrent restyle/save
        # on the aiohttp thread can't read `cells` mid-write.
        with _LOCK:
            # Create the session on its FIRST cell. The JS driver makes a fresh
            # sessionId per plot, so a genuinely new plot always lands here; we
            # do NOT wipe an existing session when a (0,0) cell re-arrives (a
            # retry/re-execute), which would discard the cells gathered so far.
            if session_id not in _SESSIONS:
                grid_name = "pixaroma_xy_grid_%s.png" % "".join(
                    c for c in str(session_id) if c.isalnum() or c in "_-"
                )[:80]
                _SESSIONS[session_id] = {
                    "cells": {},
                    "cols": cols, "rows": rows,
                    "x_labels": state.get("xLabels") or [],
                    "y_labels": state.get("yLabels") or [],
                    "x_name": state.get("xName") or "",
                    "y_name": state.get("yName") or "",
                    "draw_labels": bool(state.get("drawLabels", True)),
                    "theme": state.get("theme") or "dark",
                    "grid_name": grid_name,
                    "prefix": state.get("prefix") or filename_prefix,
                }
            sess = _SESSIONS[session_id]
            _touch_session(session_id)

            # Keep label arrays / dims fresh (JS sends the full arrays every cell).
            sess["cols"], sess["rows"] = cols, rows
            if state.get("xLabels"):
                sess["x_labels"] = state["xLabels"]
            if state.get("yLabels"):
                sess["y_labels"] = state["yLabels"]
            sess["x_name"] = state.get("xName") or sess.get("x_name", "")
            sess["y_name"] = state.get("yName") or sess.get("y_name", "")
            sess["draw_labels"] = bool(state.get("drawLabels", sess.get("draw_labels", True)))
            sess["theme"] = state.get("theme") or sess.get("theme", "dark")

            # Store this cell (first frame of the batch). Skip out-of-range cells
            # so a bad cursor can't accumulate cells that never render / leak.
            if 0 <= xi < cols and 0 <= yi < rows:
                try:
                    sess["cells"][(xi, yi)] = _tensor_to_pil(image[0])
                except Exception as e:
                    print("[Pixaroma] XY Plot: failed to store cell (%d,%d): %s" % (xi, yi, e))
            else:
                print("[Pixaroma] XY Plot: cell (%d,%d) outside %dx%d grid - skipped" % (xi, yi, cols, rows))

            grid_pil = _assemble_grid(sess)
            grid_name = sess["grid_name"]

        # Write the grid PNG to temp/ for the preview (I/O outside the lock).
        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)
        try:
            grid_pil.save(os.path.join(temp_dir, grid_name), "PNG")
        except Exception as e:
            print("[Pixaroma] XY Plot: failed to write grid PNG: %s" % e)

        frame = {
            "filename": grid_name,
            "subfolder": "",
            "type": "temp",
            "_xy": _json_safe({"sessionId": str(session_id), "xi": xi, "yi": yi,
                               "cols": cols, "rows": rows}),
        }
        return {
            "ui": {"pixaroma_xy_grid": [frame]},
            "result": (_pil_to_tensor(grid_pil),),
        }


NODE_CLASS_MAPPINGS = {"PixaromaXYPlot": PixaromaXYPlot}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaXYPlot": "XY Plot Pixaroma"}
