"""Pause Text Pixaroma - an inline STRING gate that pauses a workflow.

Sibling to Pause Image, but for words. Drop it between a text source (an LLM /
prompt generator) and the rest of the workflow. In Pause mode the run stops at
this node and shows the model's text; you edit it, then Continue feeds your
EDITED text downstream while the model is skipped (fast). Pass runs everything
straight through with the model's text untouched.

The pause / continue / pass decision is made in the JS frontend (Pattern #9):
the app.graphToPrompt hook injects the effective mode - AND the current edited
text - into the hidden PauseState input and prunes the prompt accordingly. This
node just reacts to whatever it is handed:

  - pause / pass with a WIRED input: output the incoming (model) text and emit
    it to the UI so the box shows the fresh text.
  - pause / pass with NO wire: keep the frontend's box text (do NOT emit, so a
    fresh Run can't wipe text the user typed by hand).
  - continue: the input wire is pruned away, so output the edited text carried
    in PauseState (the box the user just approved).

There is no disk snapshot - text is small enough to ride along inside the hidden
input, so this node is stateless on the Python side.
"""
import json


class PixaromaPauseText:
    DESCRIPTION = (
        "Pause Text Pixaroma - an inline gate that stops your workflow at this "
        "point so you can read and fix a piece of text before the rest of the "
        "workflow runs. Made for text that comes from a language model, where you "
        "have no control over the exact words. Wire your text source into the "
        "input and your next node onto the output.\n\n"
        "With the toggle on Pause, pressing Run stops here and shows the model's "
        "text; the rest of the workflow does not run. Edit the text, then press "
        "Continue and only the downstream runs, fed the exact words you approved - "
        "the model is skipped, so it is fast. Press Regenerate to get fresh text: "
        "the node walks back up the wire, finds whatever is generating the text, "
        "and rolls its seed to a new random value so you get a different result. "
        "Flip the toggle to Pass to run the whole workflow end to end in one go. "
        "Flip it to Keep to reuse your current text on every Run - the model is "
        "skipped and each Run makes a new image of the same prompt, so you can "
        "batch out variations quickly without losing your edit."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                # Optional + forceInput: a wire-only STRING input (no widget). In
                # Continue mode the JS prune removes this link so the model is
                # skipped and the node runs with text=None, returning the edited
                # text instead. In Pause / Pass mode the wired text is present.
                "text": ("STRING", {
                    "forceInput": True,
                    "tooltip": "The text to gate. Wire your text source (an LLM / prompt node) here.",
                }),
            },
            "hidden": {
                # Injected by the JS app.graphToPrompt hook (Pattern #9): a JSON
                # string like {"mode": "pause"|"continue"|"pass", "text": "<box>"}.
                # "text" is the frontend's current box content, used on Continue
                # (input pruned) and on an unwired Pause/Pass (keep the box).
                "PauseState": ("STRING", {"default": ""}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = (
        "The text continuing downstream: the model's text in Pause/Pass, or your "
        "edited text in Continue.",
    )
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Always re-execute so each Run re-captures the incoming text and emits a
        # fresh preview, even when the upstream is fully cached.
        return float("nan")

    @staticmethod
    def _as_text(v):
        """Coerce any wired value to a string (None -> "")."""
        if v is None:
            return ""
        return v if isinstance(v, str) else str(v)

    def run(self, text=None, PauseState=""):
        try:
            state = json.loads(PauseState) if PauseState else {}
        except Exception:
            state = {}
        if not isinstance(state, dict):
            state = {}
        mode = state.get("mode", "pause")
        box_text = self._as_text(state.get("text", ""))

        if mode == "continue":
            # The input wire was pruned away; output the edited box text.
            return {"result": (box_text,)}

        # Pause or Pass.
        if text is not None:
            # A wire fed us the model's text: pass it through AND emit it so the
            # frontend box shows the fresh text (a fresh Run replaces the edit).
            out_text = self._as_text(text)
            return {"ui": {"pixaroma_pause_text": [out_text]}, "result": (out_text,)}

        # No wire connected: keep whatever is in the frontend box (do NOT emit,
        # so a fresh Run can't wipe text the user typed by hand).
        return {"result": (box_text,)}


NODE_CLASS_MAPPINGS = {"PixaromaPauseText": PixaromaPauseText}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPauseText": "Pause Text Pixaroma"}
