"""Pure helpers for Save Text Pixaroma - no ComfyUI, no torch, no filesystem.

Save Text collects text across runs into ONE buffer that the node shows and a
.txt file mirrors. Almost all of that logic lives in the browser (js/save_text/),
because the browser is what owns the buffer; what lives here is the small set of
rules the WRITE ROUTE also needs, so the two sides cannot disagree about what an
entry is or what a .txt file is called.

Kept dependency-free so D:\\Claude Tests\\_save_text_test.py can import it with
any python.
"""

import re

# Separator ids shared with js/save_text/state.mjs::SEPARATORS. The id is what
# is stored in state; the string is what actually joins two entries. A blank
# line is the default because it is EXACTLY Prompt Pack Pixaroma's paragraph
# format, so a saved .txt drops straight back into the pack.
#
# Prompt Pack reads all three (js/prompt_pack/core.mjs::MODES has one pill per
# id here, same label). A "comma" id was offered on the day this node shipped
# and removed the next: a prompt is full of commas, so splitting on one shreds
# a single prompt into fragments. An id this dict no longer has falls back to
# the default in separator_str below, so an old state blob still saves fine.
SEPARATORS = {
    "blank": "\n\n",
    "newline": "\n",
    "rule": "\n---\n",
}
DEFAULT_SEPARATOR = "blank"


def separator_str(sep_id):
    """Resolve a separator id to the string that joins two entries.

    Unknown / non-string ids fall back to the default rather than raising: this
    reads a state blob that can hold any value (every hidden input can, see
    .claude/patterns/path-containment.md #0) and a bad id must not break a save.
    """
    if not isinstance(sep_id, str):
        return SEPARATORS[DEFAULT_SEPARATOR]
    return SEPARATORS.get(sep_id, SEPARATORS[DEFAULT_SEPARATOR])


def count_entries(text, sep_id=DEFAULT_SEPARATOR):
    """How many entries the buffer holds.

    Splitting on the separator and dropping blanks, so trailing separators and
    a run of empty lines the user left behind never inflate the count shown on
    the node. An empty buffer is 0 entries, not 1.
    """
    if not isinstance(text, str) or not text.strip():
        return 0
    sep = separator_str(sep_id)
    return len([p for p in text.split(sep) if p.strip()])


# Any extension the user's pattern might carry, so "notes.txt" and "notes" both
# end up as exactly one ".txt". Deliberately NOT a general "strip the last dot
# segment": a prompt file legitimately called "shot_2.1" must keep its .1.
_KNOWN_EXT_RE = re.compile(r"\.(txt|text|md|log|csv|json)$", re.IGNORECASE)


def normalize_txt_name(name):
    """Force a resolved file name to end in exactly one '.txt'.

    The extension is NOT the caller's choice, on purpose. This route writes
    the bytes it is sent (path-containment #0), so letting the name decide the
    extension would let a request drop
    a .bat / .ps1 / .lnk into any approved folder - and an approved folder is
    somewhere the user actually keeps things. Forcing .txt makes the worst case
    a stray text file.

    Returns "" for anything unusable, so the caller supplies its own fallback.
    """
    if not isinstance(name, str):
        return ""
    s = name.strip().replace("\\", "/")
    # keep only the last path segment here; folder segments are handled (and
    # contained) by the caller before this runs
    s = s.rsplit("/", 1)[-1].strip()
    s = _KNOWN_EXT_RE.sub("", s).strip()
    if not s:
        return ""
    return s + ".txt"


def timestamp_line(fmt_id, tm):
    """The '# 2026-08-17 14:32' line that precedes an entry, or "" when off.

    `tm` is a time.struct_time, passed in rather than read here so the function
    stays pure and the harness can pin an exact output.
    """
    if fmt_id == "date":
        return "# %04d-%02d-%02d" % (tm.tm_year, tm.tm_mon, tm.tm_mday)
    if fmt_id == "datetime":
        return "# %04d-%02d-%02d %02d:%02d" % (
            tm.tm_year, tm.tm_mon, tm.tm_mday, tm.tm_hour, tm.tm_min,
        )
    if fmt_id == "time":
        return "# %02d:%02d:%02d" % (tm.tm_hour, tm.tm_min, tm.tm_sec)
    return ""
