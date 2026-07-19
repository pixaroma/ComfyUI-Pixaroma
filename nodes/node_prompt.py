"""Prompt Pixaroma - a prompt box where @tags expand to reusable snippets.

A superset of Text Pixaroma: a multi-line prompt with a single text output, plus a
personal library of named tags. Type @name (with autocomplete) to insert a short
tag; at queue time the frontend swaps each @tag for the longer prompt it stands
for. It also has an OPTIONAL text input: wire another prompt in and it is JOINED
with your prompt - you pick which comes first and how they are separated.

Division of labour (Vue Compat #9, the Sliders / Seed pattern):
  * @tag EXPANSION happens on the frontend, in the app.graphToPrompt hook in
    js/prompt/index.js, reading the tag library from ComfyUI settings. The
    expanded prompt + the join order + separator are injected into the hidden
    PromptState input.
  * This node parses PromptState and JOINS it with the wired text_in (which is a
    real link, only known here at execution).

Consequences (both deliberate, matching Text Pixaroma):
  * A pure API / headless run (no browser) sends PromptState "{}" -> the typed
    prompt is empty there; wire text_in for headless pipelines, or type into a
    plain Text node.
  * The tag library lives on the user's machine (ComfyUI settings), never in the
    workflow, so a shared workflow keeps the author's prompts private.
"""

import json


def _clean_str(v):
    return v if isinstance(v, str) else ""


class PixaromaPrompt:
    DESCRIPTION = (
        "Prompt Pixaroma - a prompt box with a single text output, plus a personal "
        "library of reusable @tags and an optional text input you can join with.\n\n"
        "Type your prompt and drop in @tags for the parts you reuse a lot. Save a tag "
        "called oilpainting whose full text is a long 'oil painting, thick brush "
        "strokes, Rembrandt lighting, ...' and then just type @oilpainting. Type @ in "
        "the box for a searchable list grouped by category; known tags glow, unknown "
        "ones warn you of a typo. Each @tag is swapped for its full text at run time, "
        "so the box stays short. Turn on Show expanded to preview what is sent.\n\n"
        "Wire a prompt into the text input and it is joined with yours - choose My "
        "prompt first or Wired first, and the separator. With nothing wired, the output "
        "is just your prompt.\n\n"
        "Manage tags with the Tags button: a fullscreen library with categories. Your "
        "library is saved in ComfyUI's settings, so it stays private to you and "
        "survives updating the plugin; share it on purpose with Export / Import."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "text_in": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": (
                            "Optional. Wire another prompt in and it is joined with "
                            "your typed prompt (order + separator set on the node). "
                            "Leave it unconnected to output just your prompt."
                        ),
                    },
                ),
            },
            # Frontend-injected: {"text": <expanded prompt>, "order": "mine"|"wired",
            # "sep": <separator>}. See the graphToPrompt hook in js/prompt/index.js.
            "hidden": {"PromptState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = (
        "Your prompt with every @tag expanded, joined with the wired text input if one "
        "is connected.",
    )
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"

    @staticmethod
    def _parse_state(raw):
        try:
            state = json.loads(raw) if isinstance(raw, str) else {}
        except (ValueError, TypeError, RecursionError):
            state = {}
        if not isinstance(state, dict):
            state = {}
        mine = _clean_str(state.get("text"))
        order = state.get("order")
        order = order if order in ("mine", "wired") else "mine"
        sep = state.get("sep")
        # A hand-edited API file could send a non-string / absurd separator.
        sep = sep if isinstance(sep, str) and len(sep) <= 16 else ", "
        return mine, order, sep

    def run(self, text_in=None, PromptState="{}"):
        mine, order, sep = self._parse_state(PromptState)
        # A wired STRING can arrive as a length-1 list from some upstream nodes.
        if isinstance(text_in, (list, tuple)):
            text_in = text_in[0] if text_in else ""
        other = _clean_str(text_in)

        # Nothing wired in (or it resolved empty) -> just the typed prompt.
        if not other.strip():
            return (mine,)
        if not mine.strip():
            return (other,)
        if order == "wired":
            return (other + sep + mine,)
        return (mine + sep + other,)


NODE_CLASS_MAPPINGS = {"PixaromaPrompt": PixaromaPrompt}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPrompt": "Prompt Pixaroma"}
