"""Prompt Each Pixaroma - many prompts, one Run, one image each.

The third way to put several prompts through a graph, and the one this pack was
missing:

  - Queue loop (Prompt Multi, Queue Text): the browser presses Run N times, so
    the queue panel fills with N entries.
  - Batch: one tensor holding N images. Deliberately never shipped - it is what
    runs a 6GB card out of memory.
  - Output list (this node): ONE queue entry, and ComfyUI's own executor re-runs
    everything downstream once per item, in order, one at a time. Same memory as
    a single image, and every result lands in the same Preview node.

That last one is `OUTPUT_IS_LIST`, which Load Images from Folder Pixaroma already
uses for files. This is the same mechanism pointed at text.

Deliberately NO `IS_CHANGED`. The state arrives in the prompt JSON, so ComfyUI
already hashes it and caches correctly. Prompt Multi returns NaN because its
queue loop feeds a different value each iteration behind ComfyUI's back; here
the whole list travels in one prompt, and a NaN would force every node
downstream to re-run forever (see .claude/patterns/free-vram.md).

Splitting, expansion and the cap all live in _prompt_each_helpers.py, mirrored in
js/prompt_each/expand.mjs so the node face can show the same count the executor
will produce.
"""

from ._prompt_each_helpers import build_prompts, combine_wired, parse_state


class PixaromaPromptEach:
    DESCRIPTION = (
        "Prompt Each Pixaroma - type prompts one per line, press Run once, and "
        "get one image per prompt.\n\n"
        "ComfyUI runs the rest of the workflow once for each prompt, one after "
        "another rather than all at once, so it uses no more memory than a "
        "single image does and every result collects in the same Preview node. "
        "This is different from Prompt Multi in Queue Text mode, which fills "
        "the queue panel with a separate entry per prompt.\n\n"
        "Wire the prompt output to CLIP Text Encode. Wire index into Save Image "
        "if you want the files numbered in order.\n\n"
        "Two buttons at the top switch how you see the prompts: Text is one per "
        "line in a single box, best for pasting a long list in at once; Rows "
        "gives each prompt its own box with an ON/OFF switch, a delete cross and "
        "a drag handle. Both show the same prompts, so you can move between them "
        "freely. A prompt switched off is skipped but kept, and appears in the "
        "Text view as a line starting with #, so you can switch prompts off by "
        "typing too. Write \\# in front of a prompt that should really begin "
        "with a hash.\n\n"
        "Square brackets expand: a line reading 'a [red|blue] car' becomes two "
        "prompts. Several groups on one line give every combination, so "
        "'[red|blue] [car|van]' is four. Curly braces are the opposite and "
        "still pick one at random, so the two can be mixed. Write \\[ for a "
        "bracket you want kept as text.\n\n"
        "Open the settings from the gear on the node to split on blank lines "
        "instead of every line, turn bracket expansion off, or change how many "
        "prompts one Run is allowed to queue."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "text": ("STRING", {
                    "forceInput": True,
                    "tooltip": (
                        "Prompts from another node, instead of typing them here. "
                        "Wire a Text, an AI Prompt, a Save Text buffer, or Prompt "
                        "Pixaroma so its tag library feeds the list. By default "
                        "this replaces what is typed on the node; the gear can "
                        "make it add to it instead."
                    ),
                }),
            },
            "hidden": {"PromptEachState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("STRING", "INT", "INT")
    RETURN_NAMES = ("prompt", "index", "total")
    OUTPUT_IS_LIST = (True, True, True)
    OUTPUT_TOOLTIPS = (
        "Each prompt in turn. Wire this to CLIP Text Encode and the workflow "
        "runs once per prompt.",
        "Which prompt this run is, counting from 1. Wire into Save Image so the "
        "saved files keep the order you typed.",
        "How many prompts this Run will produce. The same number on every one.",
    )
    FUNCTION = "build"
    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"

    def build(self, text=None, PromptEachState="{}"):
        state = parse_state(PromptEachState)
        source = combine_wired(state["text"], text, state["wiredMode"])

        result = build_prompts(
            source,
            split=state["split"],
            expand=state["expand"],
            trim=state["trim"],
            skip_empty=state["skipEmpty"],
            cap=state["cap"],
        )
        prompts = result.prompts

        # An EMPTY output list makes ComfyUI skip the whole downstream graph
        # without a word: no image, no error, nothing in the log. That is
        # indistinguishable from a broken workflow, so say what happened instead.
        # (Load Images from Folder raises on an empty folder for the same reason.)
        if not prompts:
            raise ValueError(
                "Prompt Each Pixaroma: no prompts to run. Type at least one "
                "prompt on the node, or wire text into it."
            )

        if result.truncated:
            print(
                f"[Pixaroma] Prompt Each: stopped at {len(prompts)} prompts "
                f"(the limit in the node's settings). Raise it there if you "
                f"meant to run more."
            )

        total = len(prompts)
        return (prompts, list(range(1, total + 1)), [total] * total)


NODE_CLASS_MAPPINGS = {"PixaromaPromptEach": PixaromaPromptEach}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPromptEach": "Prompt Each Pixaroma"}
