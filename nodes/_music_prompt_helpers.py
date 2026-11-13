"""Music Prompt Pixaroma - the pure half.

No torch, no ComfyUI imports, so every decision this node makes can be
exercised with a bare python and no model on disk
(harness: D:\\Claude Tests\\_music_prompt_test.py).

WHAT THIS NODE IS. `MiniMaxMusic3TextEncode` takes a `caption` and a `lyrics`
string, and they are different KINDS of writing: one describes the sound, the
other is sung out loud. AI Prompt emits one string, so today that is two nodes
and the idea has to be typed into both. This node takes the idea once and runs
the model twice on one load.

THE FORMULAS ARE BAKED IN, and that is the deliberate difference from AI
Prompt, whose whole design is that the formula lives on the node. Here the
wording is not the user's dial - it took three measured rounds to get the
lyrics one working and it is tuned to a TEMPERATURE as much as to a model
(ai-prompt.md #15.1: eight rewrites at 0.7 all failed and 0.3 fixed them with
no wording change). So the caption runs at 0.3 and the lyrics at 0.8, both
baked, and the CONTROLS on the face steer the song instead.

WHAT THE CONTROLS DO. They append the same natural-language clauses the
measurements used, because the shipped lyrics formula already reads length and
structure out of the idea. Measured inputs were literally
"a 30 second song about love" and "a song about love, 3 verses, 3 choruses and
a bridge", so `structure_clause` rebuilds exactly that shape rather than
inventing a directive block (ai-prompt.md #14b: prefer wording already measured
over new wording that reads better).

⚠️ VERSES ARE A REQUEST, NOT A GUARANTEE, and the face must not promise
otherwise. Measured: 1 and 2 come back exactly as asked on both seeds, 3
drifts, and asking for 6 returns 5. `MAX_VERSES` is 3 for that reason - do not
raise it without new measurements.
"""

# Reused, never re-rolled. These took twenty-odd documented fixes on the
# sibling and a second copy WILL drift (music-prompt.md, "the one architectural
# rule"). `_clamp` is private to that module but this is the same package and
# sharing it is the whole point.
from ._ai_prompt_helpers import _clamp, as_text
from ._music_prompt_formulas import CAPTION_FORMULA, LYRICS_FORMULA

__all__ = [
    "CAPTION_FORMULA",
    "CAPTION_FORMULA_NO_VOCALS",
    "NO_VOCAL_LYRICS",
    "LYRICS_FORMULA",
    "CAPTION_SAMPLING",
    "LYRICS_SAMPLING",
    "DEFAULT_STATE",
    "MAX_SECONDS",
    "AUTO_SHAPE",
    "MAX_VERSES",
    "auto_verses",
    "VERSES_AUTO",
    "build_caption_prompt",
    "build_lyrics_prompt",
    "idea_text",
    "parse_state",
    "status_line",
    "sampling_for",
    "structure_clause",
    "will_generate",
]

# The real ceiling, read from source rather than guessed:
# MAX_AUDIO_FRAMES 9000 / AUDIO_FRAMES_PER_SECOND 25 in
# comfy/ldm/minimax_music/ar.py. It is 360, not the 300 that gets assumed, and
# the encode node itself defaults to 120.
MAX_SECONDS = 360
MIN_SECONDS = 5
DEFAULT_SECONDS = 120

# 0 means "let the length decide", which is the formula's own shape rule.
VERSES_AUTO = 0
MAX_VERSES = 3

# ⚠️ AUTO NAMES THE SHAPE. It does not leave the model to infer it from prose.
#
# The formula ALREADY prescribes a shape per length in its own words. The model
# reads it unreliably, and both failures a user hit came from that:
#
#   - a 60 second song came back with one verse and one chorus - the UNDER-FORTY
#     shape - and ran 21 seconds;
#   - a 30 second song came back with an empty [Intro] on top of a full verse and
#     chorus, and the chorus was chopped off the end.
#
# Naming the shape outright fixes both, measured on one idea with four or five
# seeds an arm, nothing else moving:
#
#     60s  say nothing              3/5 filled the minute
#     60s  "2 verses and 2 choruses" 5/5 filled the minute
#
#     30s  say nothing              1/4 free of an empty section
#     30s  "1 verse and 1 chorus"   4/4 free of an empty section
#
# The thresholds ARE the formula's own table, so this states what it already
# says rather than inventing a policy. 90 seconds and up is deliberately absent:
# 120s and 180s both measured 1.00x on Auto, and an explicit 3 verses drifts back
# to 2 at 180s, so naming it there would make things worse. Do not fix what
# measures fine.
#
# This is not Auto quietly becoming something else. Auto means the length decides
# the shape; this is the length deciding it. The clause produced is BYTE-IDENTICAL
# to choosing that verse count by hand, which is why the measurements above
# transfer with no new run.
#
# ⚠️ TWO OTHER APPROACHES FAILED - see music-prompt.md #6, do not retry them:
# telling the writer a SHORTER target changed nothing (8 lines either way), and
# telling it not to leave a section empty produced 26 sung lines on one seed.
#
# ⚠️ THE THIRD FIELD IS LINES PER SECTION, and it exists because naming the
# SHAPE was not enough on its own at the short end.
#
# The user's 30 second song came back as a full verse and chorus and still got
# chopped mid-chorus - their audio had roughly five sung lines in 29 seconds, so
# the real pace is nearer SIX seconds a line than the three the formula states.
# Eight lines cannot fit thirty seconds at that pace, however tidy the shape is.
#
# Measured at 30s over three seeds, with the shape clause already in place:
#
#     nothing added                     8, 8, 8 sung lines
#     "about six lines in total"        8, 8, 8   <- a BUDGET is ignored
#     "with two lines in each section"  4, 4, 4   <- a COUNT is obeyed
#
# A per-section COUNT works where a total does not. Four lines is about 23
# seconds at that pace, which fits with room to spare - and a short lyric costs
# nothing, because MiniMax plays out the rest of the ceiling anyway.
#
# ⚠️ 40 TO 90 GOT ITS OWN LINE COUNT 2026-08-18, on the report the previous
# version of this note was explicitly waiting for. Two renders at 60 seconds,
# BY EAR, on the same 16 line lyric:
#
#     intro  9s -> 51s of singing -> cut inside line 10   (5.2s a line)
#     intro 18s -> 41s of singing -> stopped after line 9 (4.6s a line)
#
# So about NINE lines fit a sixty second song, and the band was asking for
# sixteen. Two verses and two choruses at two lines each is eight, which fits
# both cases and leaves the four section shape intact.
#
# The INTRO is the variable nobody can plan around: it DOUBLED between two runs
# of the same lyric, spending a third of the ceiling before a word is sung.
# That is why the budget aims short rather than at the measured maximum.
#
# ⚠️ The 5/5 "filled the minute" result that ADDED this band was read off the
# encode node's `seconds` output, which is only the CEILING the acoustic model
# produced. It never showed whether the singing fit, and it did not. The same
# output is why two earlier truncations got through. A rendered song is the
# acceptance test; `seconds` is a pre-filter and nothing more.
#
# A shorter lyric costs nothing here either: run two still came back 59 seconds
# with nine lines sung, so the music simply plays the rest.
AUTO_SHAPE = (
    (40, 1, 2),      # under 40s: one verse and one chorus, two lines each
    (90, 2, 2),      # 40 up to 90: two verses and two choruses, two lines each
)                    # 90 and over: say nothing


def auto_verses(seconds):
    """The verse count Auto asks for at this length, or 0 to say nothing."""
    for limit, verses, _lines in AUTO_SHAPE:
        if int(seconds) < limit:
            return verses
    return VERSES_AUTO


def auto_lines(seconds):
    """Lines per section Auto asks for at this length, or None to say nothing."""
    for limit, _verses, lines in AUTO_SHAPE:
        if int(seconds) < limit:
            return lines
    return None

# MEASURED WITH THE WORDING, so they travel with it. The caption wants a low
# temperature to stay factual; the lyrics want a high one or every song rhymes
# the same way. Splitting these two apart is what makes one model load do two
# genuinely different jobs.
CAPTION_SAMPLING = {"temperature": 0.3, "max_length": 500}
LYRICS_SAMPLING = {"temperature": 0.8, "max_length": 900}

# Shared by both passes. Lifted from the measured preset settings; they are the
# same in each, so they are stated once.
COMMON_SAMPLING = {
    "top_k": 64,
    "top_p": 0.95,
    "min_p": 0.05,
    "repetition_penalty": 1.05,
    "presence_penalty": 0.0,
    "do_sample": True,
}

DEFAULT_STATE = {
    "idea": "",
    "model": "",
    # ⚠️ MUST match AI Prompt's default. The shared loader keys its cache on
    # (name, clip_type), so the SAME file under two different strings is two
    # entries - and since the cache holds ONE, alternating between an AI
    # Prompt and a Music Prompt evicted and reloaded a multi-GB encoder every
    # single time, silently defeating this node's headline promise.
    #
    # It is inert for the model both nodes recommend: comfy/sd.py selects the
    # tokenizer purely on te_model for the QWEN35_* family and never reads
    # clip_type there, so this changes nothing about how the file loads. The
    # probes passed "krea2" for the same reason - it made no difference.
    "clip_type": "minimax",
    "seed": 0,
    "seconds": DEFAULT_SECONDS,
    "verses": VERSES_AUTO,
    "bridge": False,
    "instrumental": False,
    # ⚠️ NOT the same thing as `instrumental` above, despite the names. That one
    # asks for one instrumental SECTION inside a sung song. This one means the
    # whole piece has NO SINGING AT ALL, which changes the caption formula and
    # skips the lyrics pass entirely. Kept as its own key rather than a mode
    # string so an old saved workflow simply reads False.
    "no_vocals": False,
    "release_model": False,
    # Multi-token prediction on/off, core Generate Text's `mtp` (ai-prompt.md
    # #34). On = the generate call exactly as before. Machine-specific, so a
    # formula SET never carries it.
    "mtp": True,
    # ---- the escape hatch, added 2026-08-18 --------------------------------
    # #3 says the formulas are baked in, and that stands as the DEFAULT: both
    # were measured, the lyrics one took three rounds, and each is tuned to its
    # temperature. But a user on a different model had no recourse at all, which
    # is a dead end rather than a safeguard. So they are overridable and EMPTY
    # MEANS THE MEASURED ONE - a blank box cannot be mistaken for a formula, and
    # Reset is just clearing it. The sampling is overridable for the same
    # reason: a reasoning model needs a far bigger max_length (ai-prompt.md
    # #14c), and no wording change can substitute for that.
    "caption_formula": "",
    "lyrics_formula": "",
    "caption_temperature": CAPTION_SAMPLING["temperature"],
    "caption_max_length": CAPTION_SAMPLING["max_length"],
    "lyrics_temperature": LYRICS_SAMPLING["temperature"],
    "lyrics_max_length": LYRICS_SAMPLING["max_length"],
}


def parse_state(raw):
    """The injected blob as a dict with every value present and in range.

    Nothing here is assumed: /prompt takes any value as sent, so a hand-edited
    workflow or a hand-written request can put anything in any field.
    """
    import json

    data = {}
    if isinstance(raw, str) and raw.strip():
        try:
            loaded = json.loads(raw)
            if isinstance(loaded, dict):
                data = loaded
        except (ValueError, TypeError):
            data = {}
    elif isinstance(raw, dict):
        data = raw

    st = dict(DEFAULT_STATE)
    st.update({k: v for k, v in data.items() if k in DEFAULT_STATE})

    st["idea"] = as_text(st["idea"])
    st["model"] = as_text(st["model"]).strip()
    st["clip_type"] = as_text(st["clip_type"]).strip() or "minimax"

    st["seed"] = int(_clamp(st["seed"], 0, 0, 0xFFFFFFFFFFFFFFFF))
    st["seconds"] = int(
        _clamp(st["seconds"], DEFAULT_SECONDS, MIN_SECONDS, MAX_SECONDS)
    )
    st["verses"] = int(_clamp(st["verses"], VERSES_AUTO, VERSES_AUTO, MAX_VERSES))

    st["caption_formula"] = as_text(st["caption_formula"])
    st["lyrics_formula"] = as_text(st["lyrics_formula"])
    # The same ranges core's own text node uses, so a value that reaches the
    # model is one the model will accept.
    st["caption_temperature"] = _clamp(
        st["caption_temperature"], CAPTION_SAMPLING["temperature"], 0.01, 2.0)
    st["lyrics_temperature"] = _clamp(
        st["lyrics_temperature"], LYRICS_SAMPLING["temperature"], 0.01, 2.0)
    st["caption_max_length"] = int(_clamp(
        st["caption_max_length"], CAPTION_SAMPLING["max_length"], 1, 32768))
    st["lyrics_max_length"] = int(_clamp(
        st["lyrics_max_length"], LYRICS_SAMPLING["max_length"], 1, 32768))

    st["bridge"] = st["bridge"] is True
    st["instrumental"] = st["instrumental"] is True
    st["no_vocals"] = st["no_vocals"] is True
    st["release_model"] = st["release_model"] is True
    st["mtp"] = st["mtp"] is not False
    return st


def _join(parts, sep):
    """Join, dropping blank pieces so a missing one takes its separator too."""
    return sep.join(p for p in parts if isinstance(p, str) and p.strip())


# The measured clause spelled the number as a WORD, and the whole point of
# reproducing measured wording is not paraphrasing it (ai-prompt.md #14b).
_NUMBER_WORDS = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six"}


def _listy(items):
    """a, b and c - the grammar the measured ideas actually used.

    "2 verses and 2 choruses" and "3 verses, 3 choruses and a bridge" are both
    real measured inputs, and this reproduces each exactly.
    """
    items = [i for i in items if i]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " and " + items[-1]


def _plural(count, word):
    return "%d %s" % (count, word if count == 1 else word + "es"
                      if word.endswith("s") else word + "s")


def structure_clause(seconds, verses=VERSES_AUTO, bridge=False, instrumental=False):
    """The tail appended to the idea, in the shape the measurements used.

    Length is always stated, because the node has a control for it and relying
    on the user to type "a 30 second song" is exactly the friction this node
    exists to remove. Structure is otherwise only stated when asked for, so the
    formula's own shape rule runs - except that Auto NAMES that shape rather
    than leaving it to be inferred from prose (see AUTO_SHAPE).
    """
    bits = []
    if seconds:
        bits.append("%d seconds long" % int(seconds))

    # The line count rides with the AUTO shape only. Someone who names a verse
    # count has taken the shape into their own hands, and silently adding a line
    # budget on top would be the node arguing with them.
    lines = None
    if not verses and seconds:
        verses = auto_verses(seconds)
        lines = auto_lines(seconds)

    wanted = []
    if verses and verses >= 1:
        # Verses and choruses move together: every measured pair asked for both,
        # and a verse count with no chorus is not a song shape anyone wanted.
        wanted.append(_plural(int(verses), "verse"))
        wanted.append(_plural(int(verses), "chorus"))
    if bridge:
        wanted.append("a bridge")
    if instrumental:
        wanted.append("an instrumental section")

    if wanted:
        bits.append(_listy(wanted))
    if lines:
        # MEASURED WORDING. "with two lines in each section" gave 4, 4, 4 sung
        # lines across three seeds; "about six lines in total" gave 8, 8, 8 and
        # changed nothing. Do not reword this into a total.
        bits.append("with %s lines in each section" % _NUMBER_WORDS.get(lines, lines))
    return ", ".join(bits)


def idea_text(idea, wired):
    """The user's own words: what they typed, plus anything wired in."""
    return _join([as_text(idea), as_text(wired)], "\n")


# The lyrics for a song with no singing. Emitted FROM CODE, never generated:
# there are no words to write, so asking the model for them is pure waste - it
# is the slower of the two passes (about 28-34s of the ~49s a song costs).
#
# `[Instrumental]` rather than an empty string, measured by ear: empty gave a
# 14 second track, the tag gave 26 and 29 seconds for the same 30 second
# request. ComfyUI's normalize_lyrics turns the empty string into a bare
# `[start]` and the tag into `[start]` + `[instrumental]`, so the tag is simply
# more for the model to hold on to.
NO_VOCAL_LYRICS = "[Instrumental]"

# The caption for a song with no singing.
#
# ⚠️ THE ABSENCE OF VOCAL WORDS IS THE WHOLE MECHANISM, and it is the opposite
# of what it looks like. A caption that NEGATES the singing - "no lead vocal, no
# backing vocals, no wordless humming or vowel sounds" - produced humming on
# BOTH attempts ("huhuhaha", "ii ii uui"). Removing every vocal word instead,
# and simply not having a Vocal Details part at all, produced clean instrumental
# tracks. Naming the thing summons it; this is the same negative-rule overshoot
# that made "with no section left empty" produce MORE empty sections (#6).
# Never "fix" this by adding a clearer prohibition.
#
# The second half matters too: with no singer, something has to carry the tune,
# so the formula asks for a named instrument that states the theme, develops it
# and returns to it. Without that the model has no melodic job to do.
#
# Measured by ear over four renders, two very different genres (an ambient City
# Pop ballad on three seeds, an instrumental disco funk on one): three came back
# with no voice at all, one had a single stray "aaaha". So it strongly suppresses
# vocals rather than guaranteeing their absence - re-roll is the remedy, exactly
# as it is for the intro length and the verse count.
CAPTION_FORMULA_NO_VOCALS = (
    "You write the STRUCTURED CAPTION that a music model reads to compose a "
    "piece of INSTRUMENTAL music. Turn the idea below into that caption and "
    "write nothing else.\n\n"
    "Write it as two short labelled parts, in this order, each on its own "
    "line.\n\n"
    "Global Metadata: name the genre and a subgenre, a BPM as a number, a key "
    "and scale, how the feeling moves from the start to the end, where someone "
    "would listen to it, and how the recording should sound.\n\n"
    "Arrangement: name ONE instrument that carries the lead melody from start "
    "to finish, and say that it states the theme, develops it, and returns to "
    "it at the end. Then name the instruments that support it and what each one "
    "does, the groove, what the bass and the drums do, and how much space the "
    "recording has.\n\n"
    "Choose words that suit THIS idea. Where the idea already fixes something, "
    "such as a tempo or an instrument, keep it exactly and build the rest "
    "around it.\n\n"
    "Write about instruments and the recording ONLY. Do not use markdown, "
    "headings, bullet points or asterisks. Do not introduce your answer or "
    "repeat the idea back. Start with the words Global Metadata."
)


def build_caption_prompt(idea, wired, formula="", no_vocals=False):
    """What the model is asked for the CAPTION.

    Deliberately gets the idea ALONE - no length, no structure. The caption
    describes SOUND, and "120 seconds long" is not a sound; feeding it in only
    invites the number into a field that is meant to carry genre, key and
    instruments. Every measured caption run used a plain idea.

    `no_vocals` swaps in the instrumental formula. A user's OWN formula still
    wins over both, because an override that some other setting can silently
    countermand is worse than no override.
    """
    default = CAPTION_FORMULA_NO_VOCALS if no_vocals else CAPTION_FORMULA
    return _join([as_text(formula).strip() or default,
                  idea_text(idea, wired)], "\n")


def build_lyrics_prompt(idea, wired, caption="", seconds=DEFAULT_SECONDS,
                        verses=VERSES_AUTO, bridge=False, instrumental=False,
                        formula=""):
    """What the model is asked for the LYRICS.

    It sees the caption as well as the idea, and BOTH halves are load-bearing.
    Measured: caption alone loses the subject outright - "a 30 second song
    about love" produced lyrics that never said love once, because the caption
    describes sound and never mentions what the song is about. The idea alone
    loses the mood the caption just settled. Together they keep the theme, the
    length and the feel.
    """
    clause = structure_clause(seconds, verses, bridge, instrumental)
    subject = idea_text(idea, wired)
    if clause:
        subject = ("%s, %s" % (subject, clause)) if subject.strip() else clause

    caption = as_text(caption).strip()
    if caption:
        # Labelled, so the model can tell the description of the sound apart
        # from the thing the song is about. Unlabelled, a caption reads as more
        # idea and its facts start turning up in sung lines.
        subject = "%s\n\nThe music it will be sung over:\n%s" % (subject, caption)
    return _join([as_text(formula).strip() or LYRICS_FORMULA, subject], "\n")


def sampling_for(which, state):
    """The sampling for one pass, with the user's overrides applied.

    The measured numbers are the DEFAULTS, not a cage. The caption wants a low
    temperature to stay factual and the lyrics a high one, but a different model
    may want different values entirely - and a REASONING model needs a far bigger
    max_length than the prose alone, which no wording change can substitute for
    (ai-prompt.md #14c).
    """
    base = CAPTION_SAMPLING if which == "caption" else LYRICS_SAMPLING
    out = dict(base)
    out["temperature"] = state.get("%s_temperature" % which, base["temperature"])
    out["max_length"] = state.get("%s_max_length" % which, base["max_length"])
    return out


def will_generate(state, wired_text, has_clip):
    """True when there is both something to ask with and something to ask."""
    if not (has_clip or state.get("model")):
        return False
    return bool(idea_text(state.get("idea", ""), wired_text).strip())


def status_line(state, wired_text, has_clip, generated):
    """A SHORT note for the readout, or "" when there is nothing worth saying."""
    if generated:
        return ""
    if not (has_clip or state.get("model")):
        return "no model, your text passed through"
    return "nothing to send, your text passed through"
