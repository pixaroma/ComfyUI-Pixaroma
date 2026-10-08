"""Music Prompt Pixaroma - one idea in, a caption and lyrics out.

`MiniMaxMusic3TextEncode` wants two strings, and they are different kinds of
writing: the caption describes the SOUND (genre, BPM, key, instruments) and
the lyrics are sung out loud. AI Prompt emits one string, so before this node
that was two AI Prompts with the idea typed into both.

This runs the model TWICE on ONE load, with different wording and different
sampling each time, and hands back both. The two generations cost about fifty
seconds against twenty-five for a single pass with a delimiter split - and
that split, when it misfires, gives one broken output instead of two good
ones. The model loads once either way, which is what makes the choice cheap.

It shares AI Prompt's loader, and therefore its module-level cache: a Music
Prompt and an AI Prompt naming the same file load it ONCE between them.

Full account of what was measured and why: `.claude/patterns/music-prompt.md`.
"""
import time

from ._ai_prompt_helpers import (
    apply_no_think,
    as_text,
    reasoning_only,
    strip_reasoning,
    word_count,
)
from ._music_prompt_helpers import (
    COMMON_SAMPLING,
    NO_VOCAL_LYRICS,
    build_caption_prompt,
    build_lyrics_prompt,
    idea_text,
    parse_state,
    sampling_for,
    status_line,
    will_generate,
)
# The SHARED loader and the SHARED one-entry cache. Importing rather than
# copying is the one architectural rule of this node: these took twenty-odd
# documented fixes on the sibling and a second copy would drift.
from .node_ai_prompt import _load_clip, _release_clip, repeat_generation, reset_generation_runtime

_NEEDED = (
    "  Put a language model in your ComfyUI/models/text_encoders folder and\n"
    "  pick it from the gear on the node. This node only reads and writes\n"
    "  words, so it does NOT need a vision model. The one both formulas were\n"
    "  measured on is qwen3.5_4b_int8_convrot.safetensors:\n"
    "  https://huggingface.co/Comfy-Org/Qwen3.5-4B_ComfyUI/tree/main"
)


class PixaromaMusicPrompt:
    # Generations completed in the CURRENT execution. On the class as well as in
    # run(), so _ask can never raise AttributeError if it is ever reached first.
    _passes = 0

    DESCRIPTION = (
        "Turns one idea into the two pieces of writing a music model needs: a caption "
        "describing how the song should SOUND, and the lyrics that get sung. Wire both "
        "straight into MiniMax Music 3, and the duration output into its max_duration, "
        "so the song is given exactly the time the words were written for.\n\n"
        "It runs a language model you already have, on your own machine, twice on one "
        "load. The wording of both instructions is built in and was measured rather "
        "than guessed, so there is no formula to write: you type the idea and set the "
        "length, and the controls do the rest.\n\n"
        "Length is the important one. The music model treats it as a ceiling, so a "
        "lyric written for three minutes against a thirty second setting is simply cut "
        "off part way through. Wiring the duration output means you only set it here.\n\n"
        "A song can still come out shorter than you asked, because the music model stops "
        "when the words run out. If that happens, press Re-roll: how many lines get "
        "written varies from one seed to the next.\n\n"
        "Verses are a request, not a promise. One and two come back exactly as asked; "
        "three sometimes drifts. Left on Auto the length alone decides the shape, "
        "which is the most reliable way to run it.\n\n"
        "With no model chosen it passes your text through to both outputs, so you can "
        "drop it into a working graph and set it up afterwards.\n\n"
        "Find it by searching for music, song, lyrics, caption, or minimax."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # Everything the face shows rides in the hidden state blob, injected by
        # the browser at graphToPrompt time (Vue Compat #9). A required STRING
        # would render as a widget AND a convertible input dot.
        return {
            "required": {},
            "optional": {
                "clip": (
                    "CLIP",
                    {
                        "tooltip": "Optional. A model on a wire, from a CLIPLoader or "
                        "another node. While this is connected it is used instead of "
                        "the one picked in the settings, and Free VRAM is skipped "
                        "because that model is not this node's to unload."
                    },
                ),
                "text": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": "Optional. Text from another node, added to your "
                        "idea. Useful for feeding in a theme you built somewhere else.",
                    },
                ),
            },
            "hidden": {"MusicPromptState": ("STRING", {"default": "{}"})},
        }

    # duration is a FLOAT because that is what MiniMaxMusic3TextEncode's
    # max_duration is (0.04 to 360, step 0.04). Wiring it means the length is set
    # ONCE, here, where the lyric is written for it - rather than typed into two
    # nodes that can silently disagree. That encode node then passes its own
    # `seconds` output on to EmptyMiniMaxMusic3LatentAudio, so one wire from here
    # sets the whole chain.
    RETURN_TYPES = ("STRING", "STRING", "FLOAT")
    RETURN_NAMES = ("caption", "lyrics", "duration")
    OUTPUT_TOOLTIPS = (
        "How the song should sound: genre, BPM, key, the voice and the instruments, in "
        "the three labelled parts MiniMax Music 3 expects. Wire it to that node's "
        "caption input.",
        "The words that get sung, laid out with section tags like [Verse] and "
        "[Chorus]. Wire it to that node's lyrics input.",
        "The length you set on this node, in seconds. Wire it to the music node's "
        "max_duration so the song is given exactly the time the words were written "
        "for, instead of you typing the same number in two places.",
    )
    FUNCTION = "run"
    # Load-bearing. Without it a node whose outputs are not yet wired into
    # something reaching a real output node is simply never executed, so
    # pressing Generate while still setting up would silently do nothing
    # (ai-prompt.md #3, found on its first live test).
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"

    # ---- generation ------------------------------------------------------
    def _ask(self, clip, prompt, sampling, seed, model_name):
        """One generation. Byte-identical call shape to core's TextGenerate."""
        # ComfyUI resets its per-node memory machinery between NODES, and this
        # node generates twice inside ONE. Without the reset the second
        # generation aborts the whole ComfyUI process on 0.37.0 - see
        # reset_generation_runtime(). Counted rather than hard-coded to "before
        # the lyrics" so a third pass cannot be added without the reset.
        # repeat_generation covers a LIST input too: the idea list runs run()
        # once per item inside the SAME execution, and run() zeroes _passes, so
        # the counter alone missed the second idea's first pass (music-prompt.md
        # #17b). Called first so it records every generation.
        repeat = repeat_generation(self)
        if repeat or self._passes:
            reset_generation_runtime()
        self._passes += 1

        prompt = apply_no_think(prompt, False, model_name)
        tokens = clip.tokenize(
            prompt,
            image=None,
            skip_template=False,
            min_length=1,
            thinking=False,
            video=None,
            audio=None,
        )
        try:
            generated_ids = clip.generate(
                tokens,
                seed=seed,
                **dict(COMMON_SAMPLING, **sampling),
            )
        except AttributeError as e:
            # Narrow on purpose: without the gate this wraps a multi-minute
            # generation and reports any version skew as "download a different
            # model", with the real traceback hidden.
            if "generate" not in str(e):
                raise
            raise RuntimeError(
                "[Pixaroma] Music Prompt: \"%s\" is not a language model - it "
                "cannot write text.\n%s" % (model_name or "the wired model", _NEEDED)
            ) from e

        raw = clip.decode(generated_ids)
        raw = raw if isinstance(raw, str) else str(raw or "")
        # A reasoning model narrates before it answers and that narration is not
        # the song. Told apart from an ordinary empty answer because the fix is
        # different and specific: raise the length, or pick a model that does
        # not reason.
        return strip_reasoning(raw), reasoning_only(raw)

    def run(self, clip=None, text=None, MusicPromptState="{}"):
        started = time.time()
        # ComfyUI reuses this object across runs, so the pass counter is reset
        # here rather than in __init__ - a value left over from the last run
        # would make the FIRST generation pay for a reset it does not need.
        self._passes = 0
        st = parse_state(MusicPromptState)

        wired = as_text(text)
        has_clip = clip is not None

        # ---- the pass-through path ----------------------------------------
        # Both outputs get the same text. A node with no model is a WORKING
        # state, not an error - that is what lets someone drop one into a live
        # graph and wire it up afterwards - and the banner on the face says so.
        if not will_generate(st, wired, has_clip):
            out = idea_text(st["idea"], wired)
            return {
                "ui": {
                    "pixaroma_music_prompt": [{
                        "caption": out,
                        "lyrics": out,
                        "generated": False,
                        "status": status_line(st, wired, has_clip, False),
                        # So the face can tell the user when its own banner is
                        # lying: graphToPrompt DROPS an input whose origin node
                        # is muted or bypassed, so the wire can be there in the
                        # UI while Python never received a model.
                        "used_clip": has_clip,
                        "caption_words": word_count(out),
                        "lyrics_words": word_count(out),
                        "seconds_asked": st["seconds"],
                        "seconds": round(time.time() - started, 2),
                        "seed": st["seed"],
                    }]
                },
                "result": (out, out, float(st["seconds"])),
            }

        # ---- the generating path -------------------------------------------
        own_clip = False
        if not has_clip:
            clip = _load_clip(
                st["model"], st["clip_type"], label="Music Prompt", needed=_NEEDED
            )
            own_clip = True

        model_name = (
            getattr(getattr(clip, "tokenizer", None), "clip_name", "")
            or (st["model"] if own_clip else "")
        )

        # CAPTION FIRST, and the lyrics then see it. Measured: the caption alone
        # loses the subject (a song "about love" whose lyrics never say love,
        # because a caption describes sound and never says what the song is
        # about) and the idea alone loses the mood the caption just settled.
        caption, cap_ran_out = self._ask(
            clip,
            build_caption_prompt(st["idea"], wired, st["caption_formula"],
                                 no_vocals=st["no_vocals"]),
            sampling_for("caption", st),
            st["seed"],
            model_name,
        )
        if st["no_vocals"]:
            # ONE PASS. A piece with no singing has no words to write, so asking
            # the model for lyrics is pure waste - and it is the SLOWER half,
            # about 28-34s of the ~49s a song costs. So instrumental mode is
            # roughly twice as fast, which is most of the reason it exists.
            #
            # The tag comes from code rather than the model for the same reason
            # a fixed string should never be generated: there is exactly one
            # right answer and a model can only get it wrong.
            lyrics, lyr_ran_out = NO_VOCAL_LYRICS, False
        else:
            lyrics, lyr_ran_out = self._ask(
                clip,
                build_lyrics_prompt(
                    st["idea"], wired, caption,
                    seconds=st["seconds"], verses=st["verses"],
                    bridge=st["bridge"], instrumental=st["instrumental"],
                    formula=st["lyrics_formula"],
                ),
                sampling_for("lyrics", st),
                st["seed"],
                model_name,
            )

        # Both strings are plain text by now, so the model can go. Only ours: a
        # model that arrived on a wire belongs to a loader the user placed and
        # may be shared with the rest of the graph.
        if st["release_model"] and own_clip:
            _release_clip(clip)

        status = ""
        if cap_ran_out or lyr_ran_out:
            status = ("this model reasons, and it used its whole budget thinking "
                      "before it wrote anything - pick a model that does not reason")

        return {
            "ui": {
                "pixaroma_music_prompt": [{
                    "caption": caption,
                    "lyrics": lyrics,
                    "generated": True,
                    "status": status,
                    "used_clip": has_clip,
                    "caption_words": word_count(caption),
                    "lyrics_words": word_count(lyrics),
                    "seconds_asked": st["seconds"],
                    "seconds": round(time.time() - started, 2),
                    "seed": st["seed"],
                }]
            },
            "result": (caption, lyrics, float(st["seconds"])),
        }


NODE_CLASS_MAPPINGS = {"PixaromaMusicPrompt": PixaromaMusicPrompt}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaMusicPrompt": "Music Prompt Pixaroma"}
