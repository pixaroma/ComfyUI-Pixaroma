"""Prompt From List Pixaroma - tiny picker that grabs one prompt from a list.

Pair with Prompt Multi Pixaroma's `prompts` output (List mode). Drop
multiple of these in a workflow so different downstream slots can each
pull a different prompt from the same library, without cluttering the
library node with many output dots.

Inputs:
- prompts (PIXAROMA_PROMPT_LIST): the prompts list output from Prompt Multi
- index (INT, 1-based): which prompt in the list to send out

Output:
- text (STRING): the picked prompt. Returns "" when the index is out of
  range, instead of erroring, so a workflow with mis-set index still runs
  (downstream nodes that don't tolerate empty prompt will surface the
  problem clearly).
"""


PIXAROMA_PROMPT_LIST = "PIXAROMA_PROMPT_LIST"


class PixaromaPromptFromList:
    DESCRIPTION = (
        "Prompt From List Pixaroma - tiny picker. Takes the `prompts` "
        "output from a Prompt Multi Pixaroma node (set to List mode) and "
        "outputs one prompt from it, chosen by the index number.\n\n"
        "Drop several of these in a workflow (all wired to the same "
        "Prompt Multi) so scene 1 gets prompt 1, scene 2 gets prompt 2, "
        "etc. - without piling many output dots on the library node.\n\n"
        "Index is 1-based: 1 picks the first prompt in the library. If "
        "the index is out of range the output is an empty string."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompts": (PIXAROMA_PROMPT_LIST, {"tooltip": "The prompts list from a Prompt Multi Pixaroma node set to List mode."}),
                "index": ("INT", {
                    "default": 1,
                    "min": 1,
                    "max": 9999,
                    "step": 1,
                    "tooltip": "1-based row number in the list. Out of range returns empty.",
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("The prompt picked from the list at the chosen index. Empty if the index is out of range.",)
    FUNCTION = "pick"
    CATEGORY = "👑 Pixaroma"

    def pick(self, prompts, index):
        if not isinstance(prompts, list):
            return ("",)
        idx0 = int(index) - 1
        if idx0 < 0 or idx0 >= len(prompts):
            return ("",)
        item = prompts[idx0]
        return (item if isinstance(item, str) else "",)


NODE_CLASS_MAPPINGS = {"PixaromaPromptFromList": PixaromaPromptFromList}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPromptFromList": "Prompt From List Pixaroma"}
