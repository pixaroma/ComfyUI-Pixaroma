"""
Text Join Pixaroma - join a few pieces of text into one.

Each text field can be typed into on the node, OR a wire can be dragged onto its
dot to pull text from another node (the wire wins when connected). Right-clicking
the node opens the settings: the separator that goes between the pieces and
whether to skip empty fields so you never get a stray separator.

Three nodes share this file: Text Join Two / Three / Four Pixaroma (two, three or
four fields). They only differ by field count, so they share the _TextJoinBase
below. The separator / skip-empty choice rides along in a hidden JoinState input,
injected by the frontend (Vue Compat #9), so it needs no widget on the node face.
The text values flow through the node's own STRING widgets (hidden behind the
custom fields) plus the same graphToPrompt inject, like Outpaint Stitch's sliders.
"""
import json


# Maps the separator picker key to the actual string placed between pieces.
_SEP_MAP = {"comma": ", ", "space": " ", "newline": "\n", "none": ""}
_DEFAULT_STATE = {"sep": "comma", "customSep": "", "skipEmpty": True}
_WORDS = {2: "two", 3: "three", 4: "four"}


def _parse_state(raw):
    """Parse the JoinState JSON, tolerating anything (mis-typed / empty / dict)."""
    if isinstance(raw, dict):
        data = raw
    elif isinstance(raw, str) and raw.strip():
        try:
            data = json.loads(raw)
        except Exception:
            data = {}
    else:
        data = {}
    state = dict(_DEFAULT_STATE)
    if isinstance(data, dict):
        sep = data.get("sep")
        if sep in _SEP_MAP or sep == "custom":
            state["sep"] = sep
        if isinstance(data.get("customSep"), str):
            state["customSep"] = data["customSep"]
        state["skipEmpty"] = bool(data.get("skipEmpty", True))
    return state


def _resolve_sep(state):
    if state["sep"] == "custom":
        return state["customSep"]
    return _SEP_MAP.get(state["sep"], ", ")


def _as_text(v):
    if isinstance(v, str):
        return v
    if v is None:
        return ""
    return str(v)


def _join(parts, raw_state):
    state = _parse_state(raw_state)
    sep = _resolve_sep(state)
    pieces = [_as_text(p) for p in parts]
    if state["skipEmpty"]:
        pieces = [p for p in pieces if p != ""]
    return sep.join(pieces)


def _text_input(n):
    return ("STRING", {
        "default": "",
        "multiline": True,
        "tooltip": (
            "Text piece %s. Type here, or drag a wire onto its dot to pull text "
            "from another node (the wire wins when connected)." % n
        ),
    })


def _description(n):
    word = _WORDS[n]
    return (
        "Joins %s pieces of text into one. Type in each field, or wire another "
        "node's text into its dot (the wire wins when connected). A separator "
        "(comma, space, new line, none, or your own) goes between the pieces, and "
        "empty pieces are skipped so you never get a stray separator. Right-click "
        "the node for the separator and skip-empty settings." % word
    )


class _TextJoinBase:
    """Shared logic for the Two / Three / Four nodes. Subclasses set N (the field
    count) plus their own DESCRIPTION / OUTPUT_TOOLTIPS. Inputs and outputs are
    built from N, so text_1..text_N reach join()/IS_CHANGED() as keyword args."""

    N = 2
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "join"
    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "text_%d" % i: _text_input(str(i)) for i in range(1, cls.N + 1)
            },
            "hidden": {
                "JoinState": ("STRING", {"default": ""}),
            },
        }

    @classmethod
    def _pieces(cls, kw):
        return [kw.get("text_%d" % i, "") for i in range(1, cls.N + 1)]

    @classmethod
    def IS_CHANGED(cls, JoinState="", **kw):
        return json.dumps([*cls._pieces(kw), _parse_state(JoinState)],
                          sort_keys=True, default=str)

    def join(self, JoinState="", **kw):
        return (_join(self._pieces(kw), JoinState),)


class PixaromaTextJoinTwo(_TextJoinBase):
    N = 2
    DESCRIPTION = _description(2)
    OUTPUT_TOOLTIPS = ("The two pieces joined with your separator.",)


class PixaromaTextJoinThree(_TextJoinBase):
    N = 3
    DESCRIPTION = _description(3)
    OUTPUT_TOOLTIPS = ("The three pieces joined with your separator.",)


class PixaromaTextJoinFour(_TextJoinBase):
    N = 4
    DESCRIPTION = _description(4)
    OUTPUT_TOOLTIPS = ("The four pieces joined with your separator.",)


NODE_CLASS_MAPPINGS = {
    "PixaromaTextJoinTwo": PixaromaTextJoinTwo,
    "PixaromaTextJoinThree": PixaromaTextJoinThree,
    "PixaromaTextJoinFour": PixaromaTextJoinFour,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaTextJoinTwo": "Text Join Two Pixaroma",
    "PixaromaTextJoinThree": "Text Join Three Pixaroma",
    "PixaromaTextJoinFour": "Text Join Four Pixaroma",
}
