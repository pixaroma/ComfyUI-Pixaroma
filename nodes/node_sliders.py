"""Sliders Pixaroma - one panel of sliders that drives numbers across the workflow.

Frontend-driven (Vue Compat #9): every slider (name, range, step, type and its
current value) lives on node.properties in the browser and is injected into the
hidden SlidersState input by the graphToPrompt hook in js/sliders/index.js.

Python's only job is to hand each slider's value to its own output. Outputs are
declared ANY so a slider can be wired to an INT or a FLOAT input without
ComfyUI's type check rejecting it; the frontend narrows the visible slot type
(INT / FLOAT) so a wrong connection is refused at the wire, before it can ever
fail mid-run.

Because SlidersState is part of the node's inputs, moving a slider changes the
node's cache signature - so a run picks up the new value with no IS_CHANGED.
"""

import json

from ._type_helpers import ANY

# Python must declare a fixed number of outputs; the frontend shows only as many
# as the user has sliders and removes the rest. Raising this is safe (old saved
# workflows keep working) - lowering it is not.
MAX_SLIDERS = 16


class PixaromaSliders:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {"SlidersState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = tuple([ANY] * MAX_SLIDERS)
    RETURN_NAMES = tuple("value_%d" % (i + 1) for i in range(MAX_SLIDERS))
    OUTPUT_TOOLTIPS = tuple(
        "The current value of slider %d." % (i + 1) for i in range(MAX_SLIDERS)
    )
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma/🔢 Values"
    DESCRIPTION = (
        "A panel of sliders that feeds numbers to the rest of the workflow. Add a slider, "
        "name it, give it a range, then wire its output to any number input - steps, cfg, "
        "denoise, a LoRA strength. Each slider is Auto until you connect it: the first input "
        "you plug it into decides whether it sends a whole number or a decimal, so it cannot "
        "send the wrong kind. Right-click the node for the settings, where you set the ranges, "
        "add or remove sliders, and pick the slider colour."
    )

    @staticmethod
    def _value_of(slider):
        """One slider dict -> the number Python should emit."""
        if not isinstance(slider, dict):
            return 0
        try:
            value = float(slider.get("value", 0) or 0)
        except (TypeError, ValueError):
            value = 0.0
        if str(slider.get("type") or "auto").lower() == "int":
            return int(round(value))
        return float(value)

    def run(self, SlidersState="{}"):
        try:
            state = json.loads(SlidersState) if isinstance(SlidersState, str) else {}
        except (ValueError, TypeError):
            state = {}
        if not isinstance(state, dict):
            state = {}

        sliders = state.get("sliders")
        if not isinstance(sliders, list):
            sliders = []

        # Always return the full tuple; the graph only wires the slots that exist.
        out = []
        for i in range(MAX_SLIDERS):
            out.append(self._value_of(sliders[i]) if i < len(sliders) else 0)
        return tuple(out)


NODE_CLASS_MAPPINGS = {"PixaromaSliders": PixaromaSliders}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSliders": "Sliders Pixaroma"}
