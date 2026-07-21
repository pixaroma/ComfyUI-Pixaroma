"""LoRA Loader Pixaroma - stack many LoRAs in one node.

Front-end driven (Vue Compat #9): every LoRA row (file name, on/off, model and clip
strength, and the trigger words the user picked) lives on node.properties in the
browser and is injected into the hidden LoraLoaderState input by the graphToPrompt
hook in js/lora_loader/index.js. Because LoraLoaderState is part of the node's
inputs, editing a row changes the node's cache signature, so a run always picks up
the new value with no IS_CHANGED.

Python's job is small: for each switched-on row, apply its LoRA to the MODEL (and
CLIP) with its strengths, chaining them, and join the user's chosen trigger words
into the `triggers` STRING output. The metadata / trigger-word reading used by the
info panel lives in the pure, testable _lora_helpers module and in server_routes.
"""
import os

import folder_paths
import comfy.sd
import comfy.utils

from . import _lora_helpers as H

_NO_LORAS = "(put LoRAs in models/loras)"


def _lora_list():
    try:
        files = list(folder_paths.get_filename_list("loras"))
    except Exception:
        files = []
    return files or [_NO_LORAS]


class PixaromaLoraLoader:
    DESCRIPTION = (
        "Stack as many LoRAs as you want in one node. Each LoRA has its own on/off "
        "switch and strength, and you can chain the model and clip through several of "
        "these nodes. Click the i on a row to see the LoRA's info and pick its trigger "
        "words; the switched-on picks come out of the triggers output as plain text you "
        "wire into your prompt. Trigger words are read straight from the file, so it "
        "works with no internet; an optional per-LoRA Civitai lookup can fetch the "
        "official words and a preview when you ask for it. Add LoRAs, all on/off, and "
        "the settings live in the middle of the node; right-click a row to move, "
        "duplicate, or remove it."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"tooltip": "The diffusion model every switched-on LoRA is applied to."}),
            },
            "optional": {
                "clip": ("CLIP", {"tooltip": "The CLIP (text encoder) the LoRAs are applied to. Optional, but recommended: connect it (checkpoint CLIP into here, and the CLIP output on to your text encode) so LoRAs can also tune how your trigger words are read. It matters most for LoRAs that use a trigger word. Leave it unwired only for a model-only setup."}),
            },
            "hidden": {"LoraLoaderState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("MODEL", "CLIP", "triggers")
    OUTPUT_TOOLTIPS = (
        "The model with every switched-on LoRA applied, in row order.",
        "The CLIP with every switched-on LoRA applied (passes through unchanged if no CLIP was connected).",
        "The trigger words you picked, from switched-on LoRAs only, joined as plain text for your prompt.",
    )
    FUNCTION = "apply"
    CATEGORY = "👑 Pixaroma/🧰 Utility"

    def __init__(self):
        # path -> (lora_state_dict, lora_metadata). Kept across runs so re-running
        # doesn't re-read the files; pruned each run to only the LoRAs still in use.
        self._cache = {}

    def _get_lora(self, path):
        cached = self._cache.get(path)
        if cached is not None:
            return cached
        lora, meta = comfy.utils.load_torch_file(path, safe_load=True, return_metadata=True)
        self._cache[path] = (lora, meta)
        return (lora, meta)

    def apply(self, model, clip=None, LoraLoaderState="{}"):
        state = H.parse_state(LoraLoaderState)

        # Rows whose LoRA file actually resolved. Only these contribute trigger words,
        # so the triggers output never claims words for a LoRA that isn't really there
        # (a missing / renamed file is skipped and adds nothing).
        resolved = []
        used_paths = set()
        applied = 0
        for entry in state["loras"]:
            if not entry.get("on"):
                continue
            name = entry["name"]
            if name == _NO_LORAS:
                continue
            try:
                path = folder_paths.get_full_path("loras", name)
            except Exception:
                path = None
            if not path or not os.path.isfile(path):
                print("[LoRA Loader Pixaroma] skipped (not found): {}".format(name))
                continue

            resolved.append(entry)  # file present -> its picked triggers count
            sm = float(entry.get("sm", 0.0))
            sc = float(entry.get("sc", 0.0)) if clip is not None else 0.0
            if sm == 0 and sc == 0:
                # Nothing to apply, but keep the file cached in case a later run
                # raises the strength; its triggers still count (the file is present).
                used_paths.add(path)
                continue
            try:
                lora, meta = self._get_lora(path)
                model, clip = comfy.sd.load_lora_for_models(
                    model, clip, lora, sm, sc, lora_metadata=meta
                )
                used_paths.add(path)
                applied += 1
            except Exception as exc:
                print("[LoRA Loader Pixaroma] failed to apply {}: {}".format(name, exc))

        # Triggers come only from resolved rows (collect_triggers gates on `on`; every
        # resolved row is on, so it dedups + joins their picked words).
        triggers = H.collect_triggers({"loras": resolved, "sep": state.get("sep", ", ")})

        # Free cache entries for LoRAs the user removed, so memory tracks the node.
        for path in list(self._cache):
            if path not in used_paths:
                del self._cache[path]

        print("[LoRA Loader Pixaroma] applied {} LoRA(s).".format(applied))
        return (model, clip, triggers)


NODE_CLASS_MAPPINGS = {"PixaromaLoraLoader": PixaromaLoraLoader}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaLoraLoader": "LoRA Loader Pixaroma"}
