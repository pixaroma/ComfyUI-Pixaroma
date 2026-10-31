"""Seed Pixaroma — a seed source with Random / Fixed modes + buttons.

All UI lives on the JS side; the only Python input is a hidden serialized
state string injected at execution time (same pattern as Resolution Pixaroma).
The JS frontend rolls a fresh random seed each run (Random mode) or passes the
locked value (Fixed mode), writing it into `runSeed` before submission.
"""

import json

# 2^64 - 1 — the upper bound ComfyUI's own seed widgets use, so whatever we
# output is always a valid KSampler seed.
SEED_MAX = 0xFFFFFFFFFFFFFFFF


class PixaromaSeed:
    DESCRIPTION = (
        "Seed Pixaroma - a seed source you wire into KSampler (or any node "
        "with a seed input). One Seed node can feed several samplers at once "
        "so they all share the same seed.\n\n"
        "Two modes: Random rolls a fresh seed every run; Fixed keeps the same "
        "seed for repeatable results. Buttons: New fixed random rolls a new "
        "seed and locks it; Use last seed brings back the previous run's seed; "
        "Copy puts the current seed on your clipboard. In Random mode a Last "
        "run line shows the seed that actually generated the last image.\n\n"
        "Outputs the seed as INT. State saves and restores with the workflow.\n\n"
        "To print the seed into a saved file name, put %Seed Pixaroma.seed% in the "
        "filename field of a Save Image, Save Mp4 Pixaroma, or Preview Image "
        "Pixaroma node (use this node's name, not the sampler's; rename the node to "
        "change the token)."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # SeedState is `hidden` (no widget, no input slot). The JS frontend
        # stores state on node.properties.seedState and injects the resolved
        # per-run seed into the API prompt via app.graphToPrompt.
        return {
            "required": {},
            "hidden": {
                "SeedState": ("STRING", {"default": "{}"}),
            },
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("seed",)
    OUTPUT_TOOLTIPS = (
        "The chosen seed as a whole number. Wire it into a sampler's seed input.",
    )
    FUNCTION = "get_seed"
    CATEGORY = "👑 Pixaroma/🔢 Values"

    # SeedState defaults to "{}" (seed 0) here and in get_seed: ComfyUI never
    # fills a missing hidden input from INPUT_TYPES, so an API prompt built
    # without the browser (curl, scripts, comfy-mcp) has no SeedState at all
    # and a required parameter crashed the run with a TypeError.
    @classmethod
    def IS_CHANGED(cls, SeedState: str = "{}"):
        # Re-execute whenever the injected seed changes. In Random mode the JS
        # hook injects a fresh runSeed each run (string differs -> re-run); in
        # Fixed mode it stays constant (string identical -> cached / repeatable).
        return SeedState

    def get_seed(self, SeedState: str = "{}"):
        try:
            state = json.loads(SeedState)
            s = int(state.get("runSeed", state.get("seed", 0)))
        except Exception:
            print("[PixaromaSeed] Malformed state, falling back to seed 0")
            s = 0
        # Keep inside the valid 0..2^64-1 seed range.
        if s < 0:
            s = 0
        elif s > SEED_MAX:
            s = s % (SEED_MAX + 1)
        return (s,)


NODE_CLASS_MAPPINGS = {"PixaromaSeed": PixaromaSeed}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSeed": "Seed Pixaroma"}
