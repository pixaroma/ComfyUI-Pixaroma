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
import math

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
        "The current value or on/off state of row %d." % (i + 1) for i in range(MAX_SLIDERS)
    )
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma/🔢 Values"
    DESCRIPTION = (
        "A control panel that gathers the dials and switches you care about into one node and "
        "wires each straight to where it belongs. Add a control, name it, then connect its output "
        "to any input - a slider for numbers like steps, cfg, denoise or a LoRA strength, or a "
        "switch for a true/false setting. Each control adopts what you plug it into: a slider "
        "sends a whole number or a decimal, a switch (toggle) sends a boolean or 1/0, so it "
        "cannot send the wrong kind. Right-click the node for the settings, where you add or "
        "remove controls, set ranges and switch labels, and pick the colour. Find it by searching "
        "for control panel, slider, switch, toggle, boolean, or on/off."
    )

    @staticmethod
    def _value_of(slider):
        """One control dict -> the value Python should emit."""
        if not isinstance(slider, dict):
            return 0
        kind = str(slider.get("type") or "auto").lower()

        # A dropdown or a text field emits its string directly (no numeric parse).
        if kind in ("combo", "text"):
            v = slider.get("value")
            return v if isinstance(v, str) else ("" if v is None else str(v))

        try:
            # OverflowError matters: a bare 400-digit integer in the JSON parses
            # as an arbitrary-precision Python int, and float() then raises.
            value = float(slider.get("value", 0) or 0)
        except (TypeError, ValueError, OverflowError):
            value = 0.0
        # The browser always sends a value inside the slider's range, but a
        # hand-edited API file can send anything. Infinity or a 1e308 int would
        # be passed straight into a downstream node, so refuse the nonsense here.
        if not math.isfinite(value):
            value = 0.0
        value = max(-1e12, min(1e12, value))

        if kind == "toggle":
            # A switch stores 0 / 1 in value; it emits a boolean, or 1 / 0 when
            # it has adopted an INT target ("out"). "auto"/"bool" -> boolean.
            on = bool(round(value))
            if str(slider.get("out") or "auto").lower() == "int":
                return 1 if on else 0
            return on
        if kind in ("int", "seed"):
            return int(round(value))
        return float(value)

    def run(self, SlidersState="{}"):
        try:
            # RecursionError too: deeply nested JSON in a hand-edited file would
            # otherwise take the whole run down.
            state = json.loads(SlidersState) if isinstance(SlidersState, str) else {}
        except (ValueError, TypeError, RecursionError):
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
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSliders": "Control Panel Pixaroma"}
