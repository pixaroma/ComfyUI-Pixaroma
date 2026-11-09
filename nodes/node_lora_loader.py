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


def _notify(notices):
    """Tell the browser that queued this Run (js/lora_loader/index.js shows a toast)."""
    if not notices:
        return
    try:
        from server import PromptServer
        srv = PromptServer.instance
        for notice in notices:
            srv.send_sync("pixaroma-lora-notice", notice, srv.client_id)
    except Exception:
        pass


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
        "duplicate, or remove it. A LoRA whose file is missing shows in red and is "
        "skipped: the Run goes on without it and a small message names it."
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

    @classmethod
    def IS_CHANGED(cls, LoraLoaderState="{}", **kwargs):
        # A LoRA that cannot be used is skipped, not refused, so the Run works and
        # ComfyUI caches it. Without this, fixing it and pressing Run again changed
        # nothing: the same inputs came from the cache and it was never applied. So
        # the answer holds which rows have no file, and the size and date of those
        # that do: a damaged file replaced under the same name is still in the list.
        # Unchanged files give the same answer, so a normal node caches as before.
        # A plain string, never NaN, or everything downstream re-runs every time.
        try:
            missing, present = H.split_by_list(H.parse_state(LoraLoaderState),
                                                folder_paths.get_filename_list("loras"))
            stamps = []
            for name in present:
                st = os.stat(folder_paths.get_full_path("loras", name))
                stamps.append("{}:{}:{}".format(name, st.st_size, st.st_mtime_ns))
            return "|".join(missing + stamps)
        except Exception:
            return ""

    def __init__(self):
        # path -> (lora_state_dict, lora_metadata, file stamp). What survives BETWEEN runs is the
        # user's choice (gear "LoRA memory use", carried in the state as cacheMode):
        #   "last" (default) = ComfyUI parity, keep only the most recently used file;
        #   "all"  = keep the whole current stack (fastest re-runs, gigabytes for a
        #            big stack - the pre-2026-07-27 always-on behavior);
        #   "none" = keep nothing, re-read every run (lowest memory).
        # In "last"/"none" each entry loaded this run is also released right after
        # the NEXT one applies, so peak memory stays a couple of files instead of
        # the whole stack (the cross-run retained entry rides along until the end).
        self._cache = {}
        self._last_path = None

    def _get_lora(self, path):
        # Reused only while the file is the same one: IS_CHANGED re-runs the node
        # when a LoRA is replaced under its old name, and the old weights from here
        # would then make a whole new render with nothing to show for it.
        st = os.stat(path)
        stamp = (st.st_size, st.st_mtime_ns)
        cached = self._cache.get(path)
        if cached is not None and cached[2] == stamp:
            return cached[0], cached[1]
        try:
            lora, meta = comfy.utils.load_torch_file(path, safe_load=True, return_metadata=True)
        except TypeError:
            # Older ComfyUI has no return_metadata parameter. Without this fallback
            # EVERY row raised TypeError, the caller swallowed it, and the node
            # silently handed back the untouched model with no trigger words and no
            # visible error - the LoRA simply never applied.
            lora, meta = comfy.utils.load_torch_file(path, safe_load=True), None
        self._cache[path] = (lora, meta, stamp)
        return (lora, meta)

    def apply(self, model, clip=None, LoraLoaderState="{}"):
        state = H.parse_state(LoraLoaderState)
        cache_mode = state.get("cacheMode", "last")
        # The most recent row THIS run actually loaded. Kept separate from
        # self._last_path (the entry retained from the PREVIOUS run) - evicting the
        # retained entry when this run's FIRST row applied made "last" behave like
        # "none" for every 2+ row stack (the warm file was dropped moments before
        # it would have been reused; caught in the pre-release review).
        last_this_run = None

        # Rows whose LoRA was actually applied (or deliberately parked at strength 0).
        # ONLY these contribute trigger words, so the triggers output never claims words
        # for a LoRA that isn't really in the model - a missing/renamed file OR a file
        # that fails to load (corrupt / incompatible) adds nothing.
        resolved = []
        used_paths = set()
        applied = 0
        missing = []
        failed = []
        for entry in state["loras"]:
            if not entry.get("on"):
                continue
            name = entry["name"]
            if name == _NO_LORAS:
                continue
            # A row saved on Windows says h3\x; on Linux / Mac that only loads
            # as h3/x (find_lora_file tries the row's own spelling first).
            path = H.find_lora_file(name, lambda n: folder_paths.get_full_path("loras", n))
            if not path:
                print("[LoRA Loader Pixaroma] skipped (not found): {}".format(name))
                missing.append(name)
                continue

            sm = float(entry.get("sm", 0.0))
            sc = float(entry.get("sc", 0.0)) if clip is not None else 0.0
            if sm == 0 and sc == 0:
                # Deliberate no-op (file present, strengths zero): keep it cached and let
                # its picked trigger words count (the user turned it on on purpose).
                used_paths.add(path)
                resolved.append(entry)
                continue
            try:
                lora, meta = self._get_lora(path)
                try:
                    model, clip = comfy.sd.load_lora_for_models(
                        model, clip, lora, sm, sc, lora_metadata=meta
                    )
                except TypeError:
                    # Older ComfyUI: no lora_metadata parameter. Retry without it so
                    # the LoRA still applies instead of silently doing nothing.
                    model, clip = comfy.sd.load_lora_for_models(model, clip, lora, sm, sc)
                used_paths.add(path)
                applied += 1
                resolved.append(entry)  # actually applied -> its triggers count
                if cache_mode != "all":
                    # Release the PREVIOUS row loaded THIS run, so a 10-row stack
                    # peaks at a couple of files in RAM, not ten. The cross-run
                    # retained entry (self._last_path) is deliberately NOT touched
                    # here - it may still be reused later in this run.
                    if last_this_run is not None and last_this_run != path:
                        self._cache.pop(last_this_run, None)
                    last_this_run = path
            except Exception as exc:
                # Load failed -> NOT resolved, so its words don't reach the output.
                print("[LoRA Loader Pixaroma] failed to apply {}: {}".format(name, exc))
                failed.append(name)

        _notify(H.skip_notices(missing, failed))

        # Triggers come only from resolved rows (collect_triggers gates on `on`; every
        # resolved row is on, so it dedups + joins their picked words).
        triggers = H.collect_triggers({"loras": resolved, "sep": state.get("sep", ", ")})

        # Prune per the user's memory mode (see __init__).
        if cache_mode == "none":
            self._cache.clear()
            self._last_path = None
        elif cache_mode == "all":
            # Free entries for LoRAs the user removed, so memory tracks the node.
            for path in list(self._cache):
                if path not in used_paths:
                    del self._cache[path]
        else:  # "last": ComfyUI parity - at most ONE entry survives the run:
            # the most recent load of THIS run. If this run loaded nothing, the
            # previously retained file survives only while it is still part of the
            # stack (a strength-0 row counts) - an emptied stack really frees it.
            keep = last_this_run
            if keep is None and self._last_path in used_paths:
                keep = self._last_path
            for path in list(self._cache):
                if path != keep:
                    del self._cache[path]
            self._last_path = keep

        print("[LoRA Loader Pixaroma] applied {} LoRA(s).".format(applied))
        return (model, clip, triggers)


NODE_CLASS_MAPPINGS = {"PixaromaLoraLoader": PixaromaLoraLoader}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaLoraLoader": "LoRA Loader Pixaroma"}
