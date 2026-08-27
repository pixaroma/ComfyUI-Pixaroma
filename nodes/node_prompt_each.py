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

from ._prompt_each_helpers import (
    MAX_PIECES,
    build_from_pieces,
    parse_state,
    split_text,
)


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
        "Each prompt gets its own box with an ON/OFF switch, a delete cross and "
        "a drag handle to reorder it, the same as Prompt Stack. A prompt "
        "switched off is skipped but kept, so you can try the list without one "
        "and put it back without retyping.\n\n"
        "Paste, up beside the counter, replaces every row with the clipboard, "
        "one prompt per line. That is how a hundred prompts get in from a "
        "spreadsheet in one go. Copy sends them back out the same way, keeping "
        "the switches.\n\n"
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
                        "Extra prompts from another node, run after the rows on "
                        "this one. Wire a Text, an AI Prompt, a Save Text buffer, "
                        "or Prompt Pixaroma so its tag library feeds the list. "
                        "One prompt per line. To run only these, press Reset so "
                        "the node has no prompts of its own."
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

        # The node's own rows arrive ALREADY SEPARATED. They must not be joined
        # and re-split: a row may contain newlines of its own, and splitting a
        # joined blob tears such a row into several prompts. `text` is only read
        # when `prompts` is absent, so a workflow saved by the first build of
        # this node still opens.
        pieces = list(state["prompts"])
        if not pieces and state["text"]:
            pieces = split_text(state["text"], state["split"])

        # Text on the wire IS one block, so that one IS split here - and it is
        # purely ADDITIVE: it runs after the rows and never replaces them, so
        # what is on the node is always part of what runs. To use only the wired
        # prompts, press Reset and leave the single empty row (it is skipped).
        wired = text if isinstance(text, str) else ""
        if wired.strip():
            arrived = split_text(wired, state["split"])
            if state["wiredAt"] == "before":
                pieces = arrived + pieces
            else:
                pieces = pieces + arrived

        # SAY SO if the hard piece rail bites. build_from_pieces looks at no more
        # than MAX_PIECES pieces, and `result.truncated` reports the user's CAP,
        # not this - so without a word here a wired blob longer than the rail
        # (a Save Text mirror file is the realistic one, since it accumulates)
        # would quietly contribute fewer prompts than it holds, with the node's
        # own message pointing at a setting that is not the cause. The rows can
        # never reach this; only the wire can.
        if len(pieces) > MAX_PIECES:
            print(
                f"[Pixaroma] Prompt Each: {len(pieces)} pieces arrived and only "
                f"the first {MAX_PIECES} were read. This is a fixed safety "
                f"limit, not the cap in the node's settings - split the source "
                f"into smaller pieces if you meant to run them all."
            )

        result = build_from_pieces(
            pieces,
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
