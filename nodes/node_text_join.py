"""
Text Join Pixaroma - join two or three pieces of text into one.

Each text field can be typed into on the node, OR a wire can be dragged onto its
dot to pull text from another node (the wire wins when connected). A gear panel
picks the separator that goes between the pieces and whether to skip empty
fields so you never get a stray separator.

Two nodes share this file: Text Join Two Pixaroma (two fields) and Text Join
Three Pixaroma (three fields). The separator / skip-empty choice rides along in
a hidden JoinState input, injected by the frontend (Vue Compat #9), so changing
it in the panel needs no widget on the node face. The text values flow through
the node's own STRING widgets (hidden behind the custom fields) plus the same
graphToPrompt inject, exactly like Outpaint Stitch Pixaroma's sliders.
"""
import json


# Maps the separator picker key to the actual string placed between pieces.
_SEP_MAP = {"comma": ", ", "space": " ", "newline": "\n", "none": ""}
_DEFAULT_STATE = {"sep": "comma", "customSep": "", "skipEmpty": True}


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


class PixaromaTextJoinTwo:
    DESCRIPTION = (
        "Joins two pieces of text into one. Type in each field, or wire another "
        "node's text into its dot (the wire wins when connected). A separator, "
        "set in the gear panel, goes between the pieces, and empty pieces are "
        "skipped so you never get a stray separator. Handy for building a prompt "
        "from a fixed part plus a variable part."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "text_1": _text_input("1"),
                "text_2": _text_input("2"),
            },
            "hidden": {
                "JoinState": ("STRING", {"default": ""}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("The two pieces joined with your separator.",)
    FUNCTION = "join"
    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"

    @classmethod
    def IS_CHANGED(cls, text_1="", text_2="", JoinState="", **kw):
        return json.dumps([text_1, text_2, _parse_state(JoinState)],
                          sort_keys=True, default=str)

    def join(self, text_1="", text_2="", JoinState="", **kw):
        return (_join([text_1, text_2], JoinState),)


class PixaromaTextJoinThree:
    DESCRIPTION = (
        "Joins three pieces of text into one. Type in each field, or wire "
        "another node's text into its dot (the wire wins when connected). A "
        "separator, set in the gear panel, goes between the pieces, and empty "
        "pieces are skipped so you never get a stray separator. Handy for "
        "building a prompt from several parts, some fixed and some wired in."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "text_1": _text_input("1"),
                "text_2": _text_input("2"),
                "text_3": _text_input("3"),
            },
            "hidden": {
                "JoinState": ("STRING", {"default": ""}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("The three pieces joined with your separator.",)
    FUNCTION = "join"
    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"

    @classmethod
    def IS_CHANGED(cls, text_1="", text_2="", text_3="", JoinState="", **kw):
        return json.dumps([text_1, text_2, text_3, _parse_state(JoinState)],
                          sort_keys=True, default=str)

    def join(self, text_1="", text_2="", text_3="", JoinState="", **kw):
        return (_join([text_1, text_2, text_3], JoinState),)


NODE_CLASS_MAPPINGS = {
    "PixaromaTextJoinTwo": PixaromaTextJoinTwo,
    "PixaromaTextJoinThree": PixaromaTextJoinThree,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaTextJoinTwo": "Text Join Two Pixaroma",
    "PixaromaTextJoinThree": "Text Join Three Pixaroma",
}
