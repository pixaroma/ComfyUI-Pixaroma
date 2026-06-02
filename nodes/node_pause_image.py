"""Pause Image Pixaroma - an inline IMAGE gate that pauses a workflow.

Drop it between an image source and expensive downstream work (an upscale,
a second pass, heavy post). In Pause mode the workflow stops at this node and
shows the image; the node saves a snapshot to ComfyUI's temp folder. On
Continue the JS frontend prunes the upstream out of the submitted prompt and
this node reloads the snapshot, so only the downstream runs - the exact image
you previewed, with the heavy upstream skipped entirely.

The pause / continue / pass decision is made in the JS frontend (Pattern #9):
the app.graphToPrompt hook injects the effective mode into the hidden
PauseState input and prunes the prompt accordingly. This node just reacts to
whatever mode it is handed.
"""
import json
import os

import folder_paths
import numpy as np
import torch
from PIL import Image


def _tensor_to_pil(frame):
    """HxWxC float [0,1] tensor frame -> PIL.Image (RGB)."""
    arr = (frame.cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def _pil_to_tensor(pil):
    """PIL.Image -> 1xHxWxC float [0,1] tensor."""
    arr = np.array(pil.convert("RGB")).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None, ...]


def _snapshot_path(node_id):
    """Deterministic per-node snapshot path in ComfyUI's temp folder.

    The same node id is handed to this node on the pause run and on the
    continue run (ComfyUI's UNIQUE_ID is stable for a node across runs), so the
    file written in Pause mode is exactly the one read back in Continue mode.
    """
    safe = "".join(c for c in str(node_id) if c.isalnum() or c in "_-") or "node"
    temp_dir = folder_paths.get_temp_directory()
    os.makedirs(temp_dir, exist_ok=True)
    return os.path.join(temp_dir, f"pixaroma_pause_{safe}.png")


class PixaromaPauseImage:
    DESCRIPTION = (
        "Pause Image Pixaroma - an inline gate that stops your workflow at this "
        "point so you can look at the image before running the expensive part that "
        "comes next (an upscale, a second pass, heavy post). Wire any IMAGE source "
        "into the input and your next node onto the output.\n\n"
        "With the toggle on Pause, pressing Run stops here and shows the image; the "
        "rest of the workflow does not run. Press Continue and only the downstream "
        "runs, fed from the exact image you saw - the model, sampler and decode are "
        "skipped, so it is fast. Press Regenerate to roll a new image at this point "
        "(a different image if your sampler seed is on randomize). Flip the toggle "
        "to Pass to run the whole workflow end to end in one go.\n\n"
        "The snapshot lives in ComfyUI's temp folder and is cleared when ComfyUI "
        "restarts, so after a restart pause once before using Continue."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                # Optional, NOT required: in Continue mode the JS prune removes
                # this input link so the upstream is skipped, and an optional
                # input lets the node run with image=None. In Pause / Pass mode
                # the image is present.
                "image": ("IMAGE", {"tooltip": "The image to gate. Wire your image source here; the same image flows out the output unchanged when the gate passes or continues."}),
            },
            "hidden": {
                # Injected by the JS app.graphToPrompt hook (Pattern #9):
                # a JSON string like {"mode": "pause" | "continue" | "pass"}.
                "PauseState": ("STRING", {"default": ""}),
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    OUTPUT_TOOLTIPS = ("The image continuing downstream - the live input in Pause/Pass mode, or the reloaded snapshot in Continue mode.",)
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Always re-execute so each Run re-captures the snapshot and emits a
        # fresh preview frame, even when the upstream is fully cached.
        return float("nan")

    def run(self, image=None, PauseState="", unique_id=None):
        try:
            state = json.loads(PauseState) if PauseState else {}
        except Exception:
            state = {}
        mode = state.get("mode", "pause")
        path = _snapshot_path(unique_id)

        frame = [{"filename": os.path.basename(path), "subfolder": "", "type": "temp"}]

        if mode == "continue":
            if not os.path.isfile(path):
                raise RuntimeError(
                    "Pause Image Pixaroma: the snapshot has expired (ComfyUI's "
                    "temp folder was cleared). Press Run to pause again, then Continue."
                )
            out = _pil_to_tensor(Image.open(path))
            return {"ui": {"pixaroma_pause_frame": frame}, "result": (out,)}

        # Pause or Pass: the image is wired in.
        if image is None:
            raise RuntimeError(
                "Pause Image Pixaroma: no image is connected to the input."
            )

        # Snapshot the first frame so Continue can replay it. (v1 snapshots
        # frame 0; batches larger than 1 replay their first frame.)
        _tensor_to_pil(image[0]).save(path, "PNG")
        return {"ui": {"pixaroma_pause_frame": frame}, "result": (image,)}


NODE_CLASS_MAPPINGS = {"PixaromaPauseImage": PixaromaPauseImage}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPauseImage": "Pause Image Pixaroma"}
