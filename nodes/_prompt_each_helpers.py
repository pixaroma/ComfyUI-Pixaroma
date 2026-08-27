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
import math
import re
from itertools import islice
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
# The most prompts one Run may ever queue, whatever the state blob asks for.
# MUST equal MAX_CAP in js/prompt_each/core.mjs - the browser clamps there for
# the UI, this clamps here for anything that skips the browser.
MAX_CAP = 4096

# The most PIECES one build will look at. The cap above bounds the OUTPUT,
# and a piece that expands to nothing never reaches it - see build_from_pieces.
# 10x the largest possible output, so no real list comes near it.
# MUST match MAX_PIECES in js/prompt_each/expand.mjs.
MAX_PIECES = 10 * MAX_CAP

# A hard rail, NOT the user-facing cap. Nine groups of ten options is a billion
# combinations, and a person can type that by accident; without a ceiling the
# expansion would build the whole product before the cap ever got to trim it.
# Expansion truncates as it goes, so memory stays bounded whatever arrives.
_CEILING = 4096

# The deepest [a|[b|c]] nesting that will be expanded. Anything deeper is left
# as literal text (see _balanced). Real prompts nest two or three levels; this
# is pure headroom, chosen to sit far below Python's ~1000-frame recursion
# limit. MUST match MAX_DEPTH in js/prompt_each/expand.mjs.
_MAX_DEPTH = 100

# EXACTLY what JavaScript's String.prototype.trim() removes: the ECMAScript
# WhiteSpace set plus LineTerminator. Python's own str.strip() is NOT the same
# set in EITHER direction, and both gaps are real parity bugs, because the count
# on the node face is trimmed by JS while the prompt that actually runs is
# trimmed here:
#   U+FEFF (BOM)  JS strips it, Python does not -> the face showed "c" while the
#                 model received an invisible character. Reachable by pasting
#                 from a UTF-8-with-BOM file, which this project has met before.
#   U+0085 (NEL), U+001C..U+001F  Python strips them, JS does not -> the face
#                 would keep a character the run silently dropped.
# Using one explicit set makes the two provably identical instead of
# coincidentally similar. MUST match what trim() does in expand.mjs.
_JS_WS = (
    # Written as escapes, NEVER as literal characters: this file is
    # deliberately pure ASCII so an invisible byte cannot hide in it
    # (convention #25, and the release preflight scans for exactly that).
    "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)

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

    Nesting DEPTH is refused the same way, and for the same reason. The parser
    and the expander are mutually recursive, roughly two frames per level, so a
    balanced-but-deep string like "["*500 + "a" + "]"*500 - which a person can
    paste in one keystroke - blew Python's 1000-frame limit and raised
    RecursionError straight out of the node. V8's stack is far bigger, so the
    browser happily showed a count for a prompt that then failed on Run. Bailing
    to the literal is the behaviour this function already promises for anything
    it cannot parse safely.
    """
    depth = 0
    for c in s:
        if c == "[":
            depth += 1
            if depth > _MAX_DEPTH:
                return False
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

def build_from_pieces(pieces, expand=True, trim=True, skip_empty=True,
                      cap=DEFAULT_CAP):
    """Turn ALREADY-SEPARATED prompt pieces into the final list.

    This is the real pipeline. It takes pieces rather than text because the
    node's rows are separate values in the state - a row may itself contain
    newlines, and splitting a joined blob would tear such a row into several
    prompts (it did: typing Enter inside a row duplicated content on every
    keystroke until the count ran away).
    """
    try:
        cap = DEFAULT_CAP if cap is None else int(cap)
    except (TypeError, ValueError, OverflowError):
        # OverflowError is the one the obvious pair misses: int(float("inf"))
        # raises it, and JSON's 1e400 parses to inf. parse_state clamps before
        # this is reached through the node, but this is public and the harness
        # calls it directly.
        cap = DEFAULT_CAP
    if cap < 0:
        cap = 0

    kept = []
    # The cap bounds the OUTPUT, not the INPUT, and the two are not the same
    # thing: a piece that expands to nothing (an empty bracket group, a blank
    # line) never increments the output count, so the cap's break can never
    # fire and BOTH loops run over every piece that arrived. MEASURED: 2,000,000
    # pieces of "[]" with cap=1 burned 2.27s of CPU and produced zero prompts,
    # from a 12MB body - and ComfyUI accepts 100MB by default.
    #
    # The guard lives HERE rather than in parse_state because pieces reach this
    # function from two directions: the state blob's rows AND the wired `text`
    # input, which a hand-written API prompt can set to a literal string of any
    # length. One guard covers both.
    #
    # 10x the largest output this node can ever produce, so no real list can
    # reach it - the browser's own row list is unusable long before this.
    # islice, NOT list(...)[:N] - the latter copies the whole array before
    # slicing it, which is the very work being avoided.
    for piece in islice(pieces or [], MAX_PIECES):
        if not isinstance(piece, str):
            continue
        if trim:
            piece = piece.strip(_JS_WS)
        if skip_empty and not piece:
            continue
        # A piece starting with "#" is switched OFF. Rows carry their own
        # enabled flag now, so this only still matters for text that arrives on
        # the wire or through Paste - including a Save Text file, whose
        # "# <date>" lines are skipped for free. The escape is checked FIRST so
        # a genuine "#1 portrait" still works.
        if piece.startswith("\\#"):
            piece = piece[1:]
        elif piece.startswith("#"):
            continue
        kept.append(piece)

    prompts = []
    truncated = False
    for piece in kept:
        variants = expand_brackets(piece) if expand else [piece]
        for variant in variants:
            if trim:
                variant = variant.strip(_JS_WS)
            if skip_empty and not variant:
                continue
            if len(prompts) >= cap:
                truncated = True
                break
            prompts.append(variant)
        if truncated:
            break

    return Result(prompts, len(kept), truncated)


def build_prompts(text, split=SPLIT_LINE, expand=True, trim=True,
                  skip_empty=True, cap=DEFAULT_CAP):
    """Split one block of text, then run the pipeline. Used for the wired input
    and for pasted text; the node's own rows go through build_from_pieces."""
    if split not in SPLIT_MODES:
        split = SPLIT_LINE
    return build_from_pieces(split_text(text, split), expand=expand, trim=trim,
                             skip_empty=skip_empty, cap=cap)


# --------------------------------------------------------------------------
# state
# --------------------------------------------------------------------------

DEFAULT_STATE = {
    "version": 2,
    # The node's rows, already separated. `text` is only still read so a
    # workflow saved by the very first build still opens.
    "prompts": [],
    "text": "",
    "split": SPLIT_LINE,
    "expand": True,
    "trim": True,
    "skipEmpty": True,
    "cap": DEFAULT_CAP,
    "wiredAt": "after",
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
    except (ValueError, TypeError, RecursionError):
        # RecursionError is the one the obvious pair misses. CPython's JSON
        # decoder recurses per nesting level, so a blob that is nothing but
        # "[" * 20000 + "]" * 20000 - which does not even have to resemble the
        # state schema, since this raises long before the isinstance(dict)
        # check - threw straight out of the node. MEASURED on 3.14: fine at
        # 5000, raises at 20000; a different interpreter will have a different
        # threshold, which is exactly why the guard is unconditional rather
        # than a depth check. This function's contract is that a wrong value
        # produces the defaults and NEVER an exception.
        return state
    if not isinstance(data, dict):
        return state

    if isinstance(data.get("text"), str):
        state["text"] = data["text"]
    if isinstance(data.get("prompts"), list):
        state["prompts"] = [x for x in data["prompts"] if isinstance(x, str)]
    if data.get("split") in SPLIT_MODES:
        state["split"] = data["split"]
    for key in ("expand", "trim", "skipEmpty"):
        if isinstance(data.get(key), bool):
            state[key] = data[key]
    if data.get("wiredAt") in ("after", "before"):
        state["wiredAt"] = data["wiredAt"]
    cap = data.get("cap")
    if isinstance(cap, bool):
        pass  # bool is an int subclass in Python; a toggle is not a cap
    elif isinstance(cap, (int, float)) and math.isfinite(cap):
        # Clamp the SAME WAY THE BROWSER DOES (core.mjs MAX_CAP), because the
        # browser's clamp protects nobody: /prompt is unauthenticated, so a
        # hand-written API prompt reaches this function without ever passing
        # through readState. Without the ceiling a crafted blob could ask for
        # a cap of 999999999 and queue that many downstream graph runs from one
        # Run. isfinite also covers what the old "cap == cap" NaN test did not:
        # JSON's 1e400 parses to inf in both languages, and int(inf) raises
        # OverflowError straight out of the node, where JS quietly fell back to
        # the default.
        state["cap"] = max(0, min(MAX_CAP, int(cap)))

    return state


