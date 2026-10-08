"""Text Match Pixaroma - does this text contain one of these words?

Turns a text answer into something a workflow can act on: a yes / no, the
number of the word that matched, and a gate that lets a value through only on
a match. With a vision model in front ("Is the face sharp? Answer yes or no")
it becomes a picture FILTER: wire the picture into `value` and only the
matching ones reach the save node.

The gate uses ComfyUI's own ExecutionBlocker(None): a blocked item simply does
not run downstream, with no error. On a LIST input (Load Images from Folder,
Prompt Each) this node runs once per item, so each item is let through or not
on its own (execution.py merge_result_data keeps a blocker per item).

Matching is literal: every word is re.escape()d before it goes into a pattern,
so a user's text can never be read as a regular expression (no ReDoS, no
surprise metacharacters).
"""
import re

from ._type_helpers import ANY

MODES = ["contains any word", "contains all words", "is exactly one of them", "starts with one of them"]

# The punctuation a model wraps a one-word answer in ("Yes.", "**Yes**", '"yes"').
_EDGE = " \t\r\n.,;:!?\"'`*_()[]{}<>"


def parse_words(words):
    """One word or phrase per line; commas also separate. Blank pieces dropped."""
    if not isinstance(words, str):
        return []
    out = []
    for line in words.replace("\r", "\n").split("\n"):
        for piece in line.split(","):
            p = piece.strip()
            if p:
                out.append(p)
    return out


# "Whole word" = not glued to another LETTER. Not \w: \w counts digits and "_" as
# word characters, so "cat" did not match the file name "01_Cat" (MEASURED in the
# live suite 2026-10-08), and file names are a main use. [^\W\d_] is "a letter"
# in any script. A lookaround instead of \b also keeps a word that starts or ends
# with a symbol (#tag, C++) whole.
_LETTER_BEFORE = r"(?<![^\W\d_])"
_LETTER_AFTER = r"(?![^\W\d_])"


def _found(text, word, whole, flags):
    if not whole:
        return re.search(re.escape(word), text, flags) is not None
    return re.search(_LETTER_BEFORE + re.escape(word) + _LETTER_AFTER, text, flags) is not None


def match_text(text, words, mode, ignore_case=True, whole_words=True):
    """(match: bool, index: int 1-based or 0, word: str). Pure, for the harness."""
    text = text if isinstance(text, str) else ("" if text is None else str(text))
    ws = parse_words(words)
    if not ws:
        return False, 0, ""
    flags = re.IGNORECASE if ignore_case else 0
    if mode == "is exactly one of them":
        t = text.strip(_EDGE)
        for i, w in enumerate(ws, 1):
            if (t.lower() == w.lower()) if ignore_case else (t == w):
                return True, i, w
        return False, 0, ""
    if mode == "starts with one of them":
        t = text.lstrip(_EDGE)
        for i, w in enumerate(ws, 1):
            head = t[: len(w)]
            same = (head.lower() == w.lower()) if ignore_case else (head == w)
            # whole word: the next character must not be a letter (same rule as _found)
            if same and (not whole_words or len(t) == len(w) or not t[len(w)].isalpha()):
                return True, i, w
        return False, 0, ""
    hits = [(i, w) for i, w in enumerate(ws, 1) if _found(text, w, whole_words, flags)]
    if mode == "contains all words":
        if len(hits) == len(ws):
            return True, hits[0][0], hits[0][1]
        return False, 0, ""
    # "contains any word" (also the fallback for an unknown mode)
    if hits:
        return True, hits[0][0], hits[0][1]
    return False, 0, ""


def _blocked():
    """ComfyUI's silent "do not run what follows" marker, or None on an old build."""
    try:
        from comfy_execution.graph_utils import ExecutionBlocker
    except Exception:
        return None
    return ExecutionBlocker(None)


class PixaromaTextMatch:
    DESCRIPTION = (
        "Text Match Pixaroma - checks whether a text contains one of your words, and lets a "
        "workflow act on the answer.\n\n"
        "Wire any text into text (an AI answer, a prompt, a file name) and type the words to look "
        "for, one per line or separated by commas. It gives a yes / no (match), the number of the "
        "word that matched (index, 1 for the first word, 0 for none) and the word itself.\n\n"
        "Wire a picture or anything else into value and two gates appear: if_match lets it through "
        "only when the text matches, if_no_match only when it does not. Nothing after a closed gate "
        "runs, and there is no error. With a vision model asked 'Is the face sharp? Answer yes or "
        "no' in front, a whole folder is filtered in one Run: only the matching pictures reach the "
        "save node. With nothing wired into value, the gates pass the text itself.\n\n"
        "Matching is plain text, never a code pattern. Whole words is on by default, so 'cat' does "
        "not match 'category'; upper and lower case are the same unless you turn that off."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"forceInput": True, "tooltip": "The text to check, for example an AI Prompt answer, a prompt or a file name."}),
                "words": ("STRING", {"default": "yes", "multiline": True, "tooltip": "The words or phrases to look for: one per line, or separated by commas. The first one is number 1 for the index output."}),
                "mode": (MODES, {"default": MODES[0], "tooltip": "contains any word = at least one of them is in the text. contains all words = every one of them is. is exactly one of them = the whole text is one of the words (spaces, full stops and quotes around it are ignored, so 'Yes.' counts as yes). starts with one of them = the text begins with one of the words."}),
                "ignore_case": ("BOOLEAN", {"default": True, "tooltip": "On: Yes, YES and yes are the same."}),
                "whole_words": ("BOOLEAN", {"default": True, "tooltip": "On: a word only counts on its own, so 'cat' does not match 'category'. Off: it may be part of a longer word."}),
            },
            "optional": {
                "value": (ANY, {"tooltip": "Optional. Anything to let through only on a match (if_match) or only without one (if_no_match): a picture, a prompt, a latent. Not wired: the gates pass the text."}),
            },
        }

    RETURN_TYPES = ("BOOLEAN", "INT", "STRING", ANY, ANY)
    RETURN_NAMES = ("match", "index", "word", "if_match", "if_no_match")
    OUTPUT_TOOLTIPS = (
        "True when the text matches your words, False when it does not.",
        "The number of the word that matched (1 for the first word in the list), 0 when none did.",
        "The word that matched, or nothing.",
        "The value (or the text) when it matches. Without a match nothing after it runs.",
        "The value (or the text) when it does NOT match. With a match nothing after it runs.",
    )
    FUNCTION = "check"
    CATEGORY = "👑 Pixaroma/🔀 Logic & Flow"

    def check(self, text, words="yes", mode=MODES[0], ignore_case=True, whole_words=True, value=None):
        ok, index, word = match_text(text, words, mode, bool(ignore_case), bool(whole_words))
        passed = text if value is None else value
        blocker = _blocked()
        # On a ComfyUI without ExecutionBlocker the gates cannot close: they pass the value
        # both ways rather than failing the Run, and match / index still tell the truth.
        if_match = passed if ok or blocker is None else blocker
        if_no = passed if (not ok) or blocker is None else blocker
        return (ok, index, word, if_match, if_no)


NODE_CLASS_MAPPINGS = {"PixaromaTextMatch": PixaromaTextMatch}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaTextMatch": "Text Match Pixaroma"}
