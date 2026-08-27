"""Prompt Each Pixaroma - the pure maths, with no torch and no ComfyUI import.

Turns one block of typed text into the list of prompts the node hands out, so
`node_prompt_each.py` stays a thin wrapper and this file can be unit-tested on
its own. `js/prompt_each/expand.mjs` is the BROWSER MIRROR of everything here -
the node face has to show the same count the executor will produce, so any
change to the rules below has to land in both files and in the parity harness.

Order of operations, and it matters:

    split -> trim -> drop empties -> expand [a|b] -> cap

Expansion runs AFTER the split, so a bracket group can never span two prompts,
and BEFORE the cap, so the cap counts the prompts you actually get.

Bracket semantics, deliberately the opposite of the braces already documented on
Text Pixaroma: `{a|b}` picks ONE at random, `[a|b]` yields BOTH. The two compose
because they are resolved by different code at different times.

Harness: D:\\Claude Tests\\_prompt_each_test.py
"""

import json
import re
from collections import namedtuple

# Private-use-area placeholders for escaped brackets, so they survive the parse
# as literals without colliding with anything a person would type. Built with
# chr() so this file stays pure ASCII (no invisible characters - CLAUDE.md
# convention #25).
_ESC_OPEN = chr(0xE002)
_ESC_CLOSE = chr(0xE003)

SPLIT_LINE = "line"
SPLIT_BLANK = "blank"
SPLIT_MODES = (SPLIT_LINE, SPLIT_BLANK)

DEFAULT_CAP = 200

# A hard rail, NOT the user-facing cap. Nine groups of ten options is a billion
# combinations, and a person can type that by accident; without a ceiling the
# expansion would build the whole product before the cap ever got to trim it.
# Expansion truncates as it goes, so memory stays bounded whatever arrives.
_CEILING = 4096

_BLANK_SPLIT_RE = re.compile(r"\n[ \t]*\n+")

Result = namedtuple("Result", "prompts pieces truncated")


# --------------------------------------------------------------------------
# splitting
# --------------------------------------------------------------------------

def _normalise_newlines(text):
    return text.replace("\r\n", "\n").replace("\r", "\n")


def split_text(text, mode=SPLIT_LINE):
    """Cut one block of text into raw prompt pieces. No trimming, no expansion."""
    if not isinstance(text, str) or not text:
        return []
    text = _normalise_newlines(text)
    if mode == SPLIT_BLANK:
        return _BLANK_SPLIT_RE.split(text)
    return text.split("\n")


# --------------------------------------------------------------------------
# bracket expansion
# --------------------------------------------------------------------------

def _protect_escapes(s):
    return s.replace("\\[", _ESC_OPEN).replace("\\]", _ESC_CLOSE)


def _restore_escapes(s):
    return s.replace(_ESC_OPEN, "[").replace(_ESC_CLOSE, "]")


def _balanced(s):
    """True when every [ has a matching ] after it and nothing closes early.

    An unbalanced string is left completely alone rather than half-expanded:
    eating half of somebody's prompt because they typed one stray bracket is a
    far worse outcome than not expanding it.
    """
    depth = 0
    for c in s:
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def _parse_seq(s, i, stops):
    """Parse literals and groups until a stop character or the end.

    Returns (parts, index). A part is ("lit", str) or ("grp", [parts, ...]).
    """
    parts = []
    buf = []
    while i < len(s):
        c = s[i]
        if c in stops:
            break
        if c == "[":
            if buf:
                parts.append(("lit", "".join(buf)))
                buf = []
            group, i = _parse_group(s, i + 1)
            parts.append(group)
            continue
        buf.append(c)
        i += 1
    if buf:
        parts.append(("lit", "".join(buf)))
    return parts, i


def _parse_group(s, i):
    """i points just past the '['. Returns (("grp", alts), index past the ']')."""
    alts = []
    while True:
        alt, i = _parse_seq(s, i, "|]")
        alts.append(alt)
        if i >= len(s):
            # Only reachable on an unbalanced string, which _balanced already
            # refused, but returning cleanly beats an IndexError if that ever
            # stops being true.
            return ("grp", alts), i
        if s[i] == "|":
            i += 1
            continue
        return ("grp", alts), i + 1


def _expand_parts(parts, ceiling):
    """Cartesian product over every group, truncating at `ceiling` as it goes.

    The later group varies fastest (odometer order), so
    `[red|blue] over [sand|snow]` reads red/sand, red/snow, blue/sand, blue/snow
    rather than interleaving - which is the order a person writing the line
    expects to get back.
    """
    results = [""]
    for part in parts:
        if part[0] == "lit":
            lit = part[1]
            results = [r + lit for r in results]
            continue
        alts = []
        for alt in part[1]:
            alts.extend(_expand_parts(alt, ceiling))
            if len(alts) >= ceiling:
                break
        out = []
        for r in results:
            for a in alts:
                out.append(r + a)
                if len(out) >= ceiling:
                    break
            if len(out) >= ceiling:
                break
        results = out
    return results


def expand_brackets(text, ceiling=_CEILING):
    """Expand every [a|b] group into all its combinations.

    An unbalanced string comes back unchanged, as a single item.
    """
    if not isinstance(text, str) or "[" not in text and "]" not in text:
        return [text if isinstance(text, str) else ""]
    protected = _protect_escapes(text)
    if not _balanced(protected):
        return [_restore_escapes(protected)]
    parts, _ = _parse_seq(protected, 0, "")
    return [_restore_escapes(v) for v in _expand_parts(parts, ceiling)]


# --------------------------------------------------------------------------
# the whole pipeline
# --------------------------------------------------------------------------

def build_prompts(text, split=SPLIT_LINE, expand=True, trim=True,
                  skip_empty=True, cap=DEFAULT_CAP):
    """Turn typed text into the prompt list. Returns Result(prompts, pieces, truncated).

    `pieces` is how many prompts there were BEFORE expansion, which is the left
    half of the node's count chip ("4 lines -> 12 prompts").
    """
    if split not in SPLIT_MODES:
        split = SPLIT_LINE
    try:
        cap = DEFAULT_CAP if cap is None else int(cap)
    except (TypeError, ValueError):
        cap = DEFAULT_CAP
    if cap < 0:
        cap = 0

    raw = split_text(text, split)

    pieces = []
    for piece in raw:
        if trim:
            piece = piece.strip()
        if skip_empty and not piece:
            continue
        # A prompt starting with "#" is switched OFF. That is what the Rows
        # view's toggle writes, so the two views are the same string and can
        # never drift apart - and it means a Save Text file's "# <date>" lines
        # are skipped for free rather than queued as prompts.
        # The escape is checked FIRST so a genuine "#1 portrait" still works.
        if piece.startswith("\\#"):
            piece = piece[1:]
        elif piece.startswith("#"):
            continue
        pieces.append(piece)

    prompts = []
    truncated = False
    for piece in pieces:
        variants = expand_brackets(piece) if expand else [piece]
        for variant in variants:
            if trim:
                variant = variant.strip()
            if skip_empty and not variant:
                continue
            if len(prompts) >= cap:
                truncated = True
                break
            prompts.append(variant)
        if truncated:
            break

    return Result(prompts, len(pieces), truncated)


# --------------------------------------------------------------------------
# state
# --------------------------------------------------------------------------

DEFAULT_STATE = {
    "version": 1,
    "text": "",
    "split": SPLIT_LINE,
    "expand": True,
    "trim": True,
    "skipEmpty": True,
    "cap": DEFAULT_CAP,
    "wiredMode": "replace",
}


def parse_state(raw):
    """Read the hidden state blob, healing anything that is not the right shape.

    Every field is type-checked because /prompt is unauthenticated and this
    string is fully attacker-controlled: a wrong type here should produce the
    default, never an exception out of the node.
    """
    state = dict(DEFAULT_STATE)
    if not raw or not isinstance(raw, str):
        return state
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return state
    if not isinstance(data, dict):
        return state

    if isinstance(data.get("text"), str):
        state["text"] = data["text"]
    if data.get("split") in SPLIT_MODES:
        state["split"] = data["split"]
    for key in ("expand", "trim", "skipEmpty"):
        if isinstance(data.get(key), bool):
            state[key] = data[key]
    cap = data.get("cap")
    if isinstance(cap, bool):
        pass  # bool is an int subclass in Python; a toggle is not a cap
    elif isinstance(cap, (int, float)) and cap == cap:  # reject NaN
        state["cap"] = max(0, int(cap))
    if data.get("wiredMode") in ("replace", "add"):
        state["wiredMode"] = data["wiredMode"]
    return state


def combine_wired(typed, wired, mode="replace"):
    """Fold a wired `text` input into the typed box, per the gear setting."""
    wired = wired if isinstance(wired, str) else ""
    typed = typed if isinstance(typed, str) else ""
    if not wired.strip():
        return typed
    if mode == "add":
        if not typed.strip():
            return wired
        return typed.rstrip("\n") + "\n" + wired
    return wired
