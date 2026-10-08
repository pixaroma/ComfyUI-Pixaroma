"""AI Prompt Pixaroma - one local model, one saved instruction, text out.

The universal sibling of Video Prompt Pixaroma. That node knows about MiniMax
H3: modes derived from wires, duration tiers, a frame count. This one knows
about nothing - you give it a model and an instruction, wire in whatever you
have, and it hands back text. Which is what makes it chainable: the output is
a plain string and the input takes one, so a row of these is a row of steps.

The three calls that do the generating are exactly the ones core's own
TextGenerate node makes (comfy_extras/nodes_textgen.py): clip.tokenize, then
clip.generate, then clip.decode. Same parameters, same defaults, so a workflow
moved between the two behaves identically.

A NODE WITH NO MODEL IS A WORKING PASS-THROUGH, not an error. That is the
whole reason it can be dropped into a live chain and wired up afterwards, and
it is why there is no auto-picked substitute model here (Video Prompt has one
because it cannot function without a vision model; this one can).
"""
import time

import comfy.model_management
import comfy.sd
import folder_paths

from ._ai_prompt_helpers import (
    apply_no_think,
    as_text,
    build_prompt,
    content_text,
    AIPromptInputs,
    extra_image_keys,
    parse_state,
    reasoning_only,
    status_line,
    strip_reasoning,
    will_generate,
    word_count,
)

# ---------------------------------------------------------------------------
# Model cache
# ---------------------------------------------------------------------------
# MODULE level, so EVERY instance of this node shares it. Two nodes naming the
# same file get one load and one copy in memory, which is the common case for a
# chain - most people use the same model for every step.
#
# Deliberately ONE entry, copied from Video Prompt: swapping models should
# release the old one rather than sit on two 10 GB encoders. Two nodes using
# DIFFERENT models therefore take turns, reloading each run. That is the right
# trade on a 12 GB card; if mixed-model chains turn out to thrash in practice,
# this dict is the one line to widen.
_CLIP_CACHE = {}


def _release_clip(clip=None):
    """Actually give the VRAM back.

    soft_empty_cache() ALONE UNLOADS NOTHING - it empties torch's allocator
    cache while ComfyUI's own current_loaded_models still holds the encoder.
    The model has to be unloaded first. Measured on Video Prompt: 17.1 GB.
    """
    if clip is None:
        for c in _CLIP_CACHE.values():
            clip = c
            break
    _CLIP_CACHE.clear()
    patcher = getattr(clip, "patcher", None)
    if patcher is not None:
        try:
            comfy.model_management.unload_model_and_clones(patcher)
        except Exception:
            try:
                comfy.model_management.unload_all_models()
            except Exception:
                pass
    try:
        comfy.model_management.soft_empty_cache()
    except Exception:
        pass


_RUNTIME_WARNED = False


def reset_generation_runtime():
    """Give ComfyUI the between-node reset it never gets INSIDE one node.

    ComfyUI 0.37.0 added Aimdo dynamic VRAM loading and CUDA-graph decoding for
    the Qwen3/3.5 encoders, and `execution.py` resets that machinery in a
    `finally` after EVERY node. A node that generates TWICE therefore runs its
    second generation against the first one's live prefetch and malloc-graph
    state: the KV write indexes out of bounds, CUDA's device-side assert fires,
    and the WHOLE ComfyUI PROCESS aborts. That is not an exception a node can
    catch - the server simply disappears, taking the queue with it.

    Reproduced with a throwaway node containing nothing but two core
    `clip.generate` calls, so the defect is core's; two generations in two
    SEPARATE nodes are fine, because each one gets the executor's cleanup. The
    workaround is to run core's own cleanup ourselves, which is why this is a
    copy of those three lines and must stay one - if core changes what a node
    boundary resets, this has to follow.

    Reported 2026-09-21 (EmerJP, Semirhaged) against Music Prompt, which is the
    only node in the pack that generates twice in one execution.

    Every symbol here is version-dependent, so nothing may raise: on a ComfyUI
    without this machinery there is simply nothing to reset, and on one with it
    a failed reset must not take the generation with it. It DOES warn once,
    because a silent failure here means the next generation kills the process.
    """
    global _RUNTIME_WARNED
    # An older ComfyUI has none of this, which is not a failure and must not
    # warn - there is genuinely nothing to reset. Only a reset that EXISTS and
    # then goes wrong is worth saying anything about.
    try:
        import comfy.memory_management
    except Exception:
        return
    if not getattr(comfy.memory_management, "aimdo_enabled", False):
        return

    try:
        import comfy.model_prefetch
        import comfy_aimdo.model_vbar

        comfy.model_prefetch.cleanup_prefetch_queues()
        comfy.model_management.reset_cast_buffers()
        comfy_aimdo.model_vbar.vbars_reset_watermark_limits()
    except Exception as e:
        if not _RUNTIME_WARNED:
            _RUNTIME_WARNED = True
            print(
                "[Pixaroma] could not reset ComfyUI's per-node memory state "
                "between two generations (%s). If ComfyUI closes itself during "
                "a Music Prompt run, that is why - generate the caption and the "
                "lyrics with two AI Prompt nodes instead." % e
            )


def repeat_generation(owner):
    """Record that `owner` (the node object) is about to generate, and return
    True when it ALREADY generated text inside the execution that is running
    now. Call it right BEFORE each `clip.generate`; a True means
    `reset_generation_runtime()` must run first.

    A node's FUNCTION can run many times inside ONE execution: ComfyUI calls it
    once per item when an input is a LIST (Load Images from Folder, Prompt
    Each, Prompt Multi in List mode), all before its per-node cleanup runs. So
    the second picture of a folder generated against the first one's live
    state and ComfyUI 0.37+ aborted (core issue #16441), exactly the crash
    music-prompt.md #17 describes for two passes in one call.

    "This execution" is core's own (prompt_id, node_id) from
    comfy_execution.utils.get_executing_context(), the context it sets around
    every call of a list. A new Run is a new prompt_id, so it never pays for a
    reset it does not need. On a ComfyUI without that API there is no Aimdo
    either (both arrived long before 0.37), so False is safe there.
    """
    try:
        from comfy_execution.utils import get_executing_context
        ctx = get_executing_context()
    except Exception:
        ctx = None
    if ctx is None:
        return False
    key = (ctx.prompt_id, ctx.node_id)
    seen = getattr(owner, "_pix_generated_in", None) == key
    owner._pix_generated_in = key
    return seen


_NEEDED = (
    "  Put a language model in your ComfyUI/models/text_encoders folder and\n"
    "  pick it from the gear on the node. For anything that has to SEE a\n"
    "  picture it must be a VISION model (a Qwen3-VL build). The one the\n"
    "  Pixaroma formulas were measured against is\n"
    "  qwen3-vl-8b-heretic-1.3.0_fp8_e4m3fn.safetensors (10 GB, 12 GB+ cards):\n"
    "  https://huggingface.co/DreamFast/Qwen3-VL-8B-Heretic-1.3.0/tree/main/comfyui\n"
    "  (take it from that comfyui folder, NOT the repo root)\n"
    "  For an 8 GB card use the 4B instead:\n"
    "  https://huggingface.co/DreamFast/Qwen3-VL-4b-Heretic-ComfyUI/tree/main"
)


def _available():
    try:
        return list(folder_paths.get_filename_list("text_encoders"))
    except Exception:
        return []


def _load_clip(name, clip_type, label="AI Prompt", needed=None):
    """Load (or reuse) a text encoder.

    `label` and `needed` exist only so Music Prompt Pixaroma can share this
    function - and with it the module-level cache, so a Music Prompt and an
    AI Prompt naming the same file load it ONCE between them. Defaults keep
    every existing call identical.
    """
    needed = _NEEDED if needed is None else needed
    key = (name, clip_type)
    cached = _CLIP_CACHE.get(key)
    if cached is not None:
        return cached

    # Check the live list BEFORE touching the filesystem. Core's get_full_path
    # already normalises the name so a traversal cannot escape the folder, but
    # confirming the file is one this node offered keeps the error honest: the
    # user picked something specific and it is not there.
    if name not in _available():
        have = _available()
        raise RuntimeError(
            "[Pixaroma] %s: the model \"%s\" is not in your "
            "text_encoders folder.\n%s\n%s"
            % (
                label,
                name,
                ("  Files you do have: " + ", ".join(have[:8]) +
                 ("..." if len(have) > 8 else "")) if have
                else "  That folder is empty.",
                needed,
            )
        )

    # Guarded even though the membership check above passed: the two can
    # disagree if the file goes away between them, and the sibling node wraps
    # this same call for the same reason. Without it a resolver mismatch
    # surfaces as a raw traceback where every other failure here is friendly.
    try:
        path = folder_paths.get_full_path_or_raise("text_encoders", name)
    except Exception as e:
        raise RuntimeError(
            "[Pixaroma] %s: the model \"%s\" could not be found on disk, "
            "even though it is listed in your text_encoders folder.\n%s"
            % (label, name, needed)
        ) from e
    clip_type_enum = getattr(
        comfy.sd.CLIPType, str(clip_type).upper(), comfy.sd.CLIPType.STABLE_DIFFUSION
    )
    _release_clip()
    try:
        clip = comfy.sd.load_clip(
            ckpt_paths=[path],
            embedding_directory=folder_paths.get_folder_paths("embeddings"),
            clip_type=clip_type_enum,
            model_options={},
        )
    except Exception as e:
        raise RuntimeError(
            "[Pixaroma] %s: \"%s\" could not be loaded as a language "
            "model.\n%s" % (label, name, needed)
        ) from e
    # NOTE: do NOT test hasattr(clip, "generate") here. ComfyUI's CLIP wrapper
    # ALWAYS has it - it delegates inward - so the check passes for a T5 and
    # the real failure surfaces later. The honest place is around the CALL.
    _CLIP_CACHE[key] = clip
    return clip


def _img(x):
    """An IMAGE input as plain RGB, or None if it is not actually an image.

    Two jobs, both earned on Video Prompt:

    1. An `optional` input is NOT type-guaranteed. Any ANY-type passthrough can
       put a list or a string here, and `x is not None` would then be True.
    2. DROP THE ALPHA. Qwen3-VL normalises exactly three channels and then
       reshapes patches using the real channel count, so a 4-channel RGBA image
       builds a 2048-wide patch against a 1536-wide vision tower and dies in a
       torch matmul - AFTER the 10 GB load. Remove Background Pixaroma returns
       genuine RGBA, so this is one wire away.
    """
    if getattr(x, "ndim", 0) != 4:
        return None
    try:
        if int(x.shape[-1]) > 3:
            return x[..., :3].contiguous()
    except (AttributeError, TypeError, ValueError, IndexError):
        # AttributeError because .contiguous() is torch-only: a numpy RGBA
        # batch has ndim 4 and a .shape, so it reaches the slice and dies on a
        # method it does not have. Refusing it is the point of this function.
        return None
    return x


def _audio(x):
    """An AUDIO input, or None if it is not one.

    Same rule as _img: the guard has to be inside a try, because on a
    non-mapping the membership test is itself the thing that raises.
    """
    try:
        if isinstance(x, dict) and "waveform" in x:
            return x
    except Exception:
        return None
    return None


def _batch_like_core(pics):
    """Several pictures as ONE batch, the way core's Batch Images makes it:
    every picture resized to the first one's size with a centre crop
    (comfy_extras/nodes_post_processing.py batch_images). Only for a model that
    reads a single `image` batch (Gemma 4); the Qwen vision models get the
    pictures one by one through `images` instead, at their own sizes."""
    import torch
    import comfy.utils
    first = pics[0]
    out = []
    for p in pics:
        if p.shape[1:3] != first.shape[1:3]:
            p = comfy.utils.common_upscale(
                p.movedim(-1, 1), first.shape[2], first.shape[1], "bilinear", "center"
            ).movedim(1, -1)
        out.append(p)
    return torch.cat(out, dim=0)


class PixaromaAIPrompt:
    DESCRIPTION = (
        "Runs a language model you already have, on your own machine, using an "
        "instruction you save on the node. Wire in a picture, a video, some audio or "
        "text, type an idea, and it hands back text. Wiring a picture adds a slot "
        "for another one, up to 8, each seen at its own size.\n\n"
        "The instruction is called the formula and it lives on this node, so every "
        "copy carries its own. That is what makes these chainable: put one after "
        "another and each does a different job, like describe this photo, then rewrite "
        "it in another style, then shorten it.\n\n"
        "With no model chosen it simply passes its text straight through, so you can "
        "drop it into a working graph and set it up afterwards without breaking "
        "anything. The banner on the node always says which it is about to do.\n\n"
        "Wire text in and it is joined with your idea, the same way Prompt Pixaroma "
        "joins its text input, and you choose which of the two comes first.\n\n"
        "The idea box understands the same @tags as Prompt Pixaroma, out of the same "
        "library: @name drops in a saved phrase, *Category picks a random one from a "
        "group, and #name picks a random line. They are swapped for real words before "
        "the model is asked anything. Press Tags on the node to open the library.\n\n"
        "Nothing is sent anywhere. It needs a model in your text_encoders folder, and "
        "a vision model if it has to look at a picture.\n\n"
        "Find it by searching for ai, prompt, llm, caption, or rewrite."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # Everything the face shows rides in the hidden state blob, injected by
        # the browser at graphToPrompt time (Vue Compat #9). A required STRING
        # would render as a widget AND a convertible input dot.
        # AIPromptInputs keeps these five EXACTLY (same names, same order: the
        # order is load-bearing for bypass, ai-prompt.md #24) and also answers
        # for image_2 ... image_8 without listing them in the schema.
        return {
            "required": {},
            "optional": AIPromptInputs({
                "clip": (
                    "CLIP",
                    {
                        "tooltip": "Optional. A model on a wire, from a CLIPLoader or "
                        "another node. While this is connected it is used instead of "
                        "the one picked in the settings, and Free VRAM is skipped "
                        "because that model is not this node's to unload."
                    },
                ),
                "image": (
                    "IMAGE",
                    {
                        "tooltip": "Optional. A picture for the model to look at. Needs "
                        "a vision model (a Qwen3-VL build); a text-only one accepts the "
                        "picture and silently ignores it. Wiring it adds an image_2 slot "
                        "for a second picture, and so on up to 8, each seen at its own "
                        "size."
                    },
                ),
                "video": (
                    "IMAGE",
                    {
                        "tooltip": "Optional. Video frames as an image batch. Assumed to "
                        "be 24 frames per second and sampled down to one per second "
                        "inside the model, so a long clip is fine."
                    },
                ),
                "audio": (
                    "AUDIO",
                    {
                        "tooltip": "Optional. Sound for the model to listen to. Needs a "
                        "model that can hear; most vision models cannot."
                    },
                ),
                "text": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": "Optional. Text from another node, joined with your "
                        "idea. Which one comes first is the segment in the node's slot "
                        "band, and its default is in the settings.",
                    },
                ),
            }),
            "hidden": {"AIPromptState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = (
        "What the model wrote. With no model chosen this is your idea and any wired "
        "text joined together and passed through unchanged, so a chain keeps working "
        "while you are still setting it up.",
    )
    FUNCTION = "run"
    # Without this the node NEVER RUNS unless its output is wired into something
    # that eventually reaches a real output node - so pressing Generate on a
    # node you are still setting up would do nothing at all, silently. Measured:
    # the first live test queued fine and the readout stayed empty forever.
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"

    def run(self, clip=None, image=None, video=None, audio=None, text=None,
            AIPromptState="{}", **extra):
        started = time.time()
        st = parse_state(AIPromptState)

        wired = as_text(text)
        has_clip = clip is not None

        # ---- the pass-through path ----------------------------------------
        if not will_generate(st, wired, has_clip):
            out = content_text(st["idea"], wired, st["order"], st["sep"])
            return {
                "ui": {
                    "pixaroma_ai_prompt": [{
                        "text": out,
                        "generated": False,
                        "status": status_line(st, wired, has_clip, False),
                        # So the face can tell the user when its own banner is
                        # lying: graphToPrompt DROPS an input whose origin node
                        # is muted or bypassed, so the wire can be there in the
                        # UI while Python never received a model.
                        "used_clip": has_clip,
                        "words": word_count(out),
                        "seconds": round(time.time() - started, 2),
                        # The seed this run actually used. The browser rolls a
                        # Random one at graphToPrompt time onto a runtime field,
                        # which a workflow tab switch destroys along with the
                        # node object - so report it and let the face store it
                        # beside the answer (js/ai_prompt/core.mjs displaySeed).
                        "seed": st["seed"],
                    }]
                },
                "result": (out,),
            }

        # ---- the generating path -------------------------------------------
        prompt = build_prompt(
            st["formula"], st["idea"], wired, st["order"], st["sep"]
        )
        own_clip = False
        if not has_clip:
            clip = _load_clip(st["model"], st["clip_type"])
            own_clip = True

        # Make the Thinking toggle mean something. AFTER the clip is resolved,
        # because the decision reads the model's NAME - and because own_clip
        # does not exist until here, which is how the first draft of this
        # would have raised NameError on every generating run.
        #
        # The `thinking` argument handed to tokenize below only reaches a chat
        # template some encoder paths never apply, so a Qwen3 loaded as lumina2
        # reasoned at length with the toggle already OFF: 59 seconds against
        # 17, for a control the user had set correctly. The switch written into
        # the user turn IS honoured there.
        prompt = apply_no_think(
            prompt,
            st["thinking"],
            getattr(getattr(clip, "tokenizer", None), "clip_name", "")
            or (st["model"] if own_clip else ""),
        )

        img = _img(image)
        vid = _img(video)
        aud = _audio(audio)
        more = [p for p in (_img(extra[k]) for k in extra_image_keys(extra)) if p is not None]

        if not more:
            # Byte-identical to core's TextGenerate. Do NOT wrap this in a
            # try/except TypeError "for safety": every tokenizer in the chain
            # ends in **kwargs, so nothing here CAN raise TypeError, and a
            # fallback that quietly dropped skip_template would change what the
            # model is asked without saying so. `image` is singular on purpose -
            # that is what core passes and what Qwen3VLTokenizer reads out of
            # kwargs.
            tokens = clip.tokenize(
                prompt,
                image=img,
                skip_template=not st["use_default_template"],
                min_length=1,
                thinking=st["thinking"],
                video=vid,
                audio=aud,
            )
        else:
            # image_2 ... image_8 are wired. ONLY this branch is new, so a node
            # without them asks exactly what it always asked (the harness pins
            # that byte for byte).
            #
            # Qwen3-VL / Qwen3.5 take `images`, a LIST of single pictures, and
            # give each its own vision block at its OWN size - which is the
            # point: a batch crops every picture to the first one's shape.
            # Gemma 4 reads only `image` (a batch), so it also gets them all,
            # resized to the first like core's Batch Images; a text-only model
            # ignores both, exactly as it ignores one picture today.
            pics = ([img] if img is not None else []) + more
            singles = [p[i:i + 1] for p in pics for i in range(p.shape[0])]
            tokens = clip.tokenize(
                prompt,
                image=_batch_like_core(pics),
                images=singles,
                skip_template=not st["use_default_template"],
                min_length=1,
                thinking=st["thinking"],
                video=vid,
                audio=aud,
            )

        # A LIST input (a folder of pictures, Prompt Each) runs this function
        # once per item inside ONE execution, so the second item would generate
        # against the first one's live state and ComfyUI 0.37+ would abort.
        # One generation per execution needs no reset (ai-prompt.md #25, #31).
        if repeat_generation(self):
            reset_generation_runtime()
        try:
            generated_ids = clip.generate(
                tokens,
                do_sample=st["do_sample"],
                max_length=st["max_length"],
                temperature=st["temperature"],
                top_k=st["top_k"],
                top_p=st["top_p"],
                min_p=st["min_p"],
                repetition_penalty=st["repetition_penalty"],
                presence_penalty=st["presence_penalty"],
                seed=st["seed"],
            )
        except AttributeError as e:
            # Narrow on purpose. Without the gate this wrapped a multi-minute
            # generation and reported any version skew as "download a
            # different 10 GB model", with the real traceback hidden.
            if "generate" not in str(e):
                raise
            raise RuntimeError(
                "[Pixaroma] AI Prompt: \"%s\" is not a language model - it cannot "
                "write text. Pick a Qwen3-VL build instead.\n%s"
                % (st["model"] if own_clip else "the model on the clip wire", _NEEDED)
            ) from e

        out = clip.decode(generated_ids)
        out = out if isinstance(out, str) else str(out or "")

        # A reasoning model narrates before it answers, and that narration is
        # not the prompt. Plain Qwen3 - the Z-Image text encoder - does it even
        # with thinking off, so without this the node returns 380 words of
        # "Okay, the user wants me to ..." and the image model renders it.
        ran_out_thinking = reasoning_only(out)
        out = strip_reasoning(out)

        # The text is a plain string by now, so the model can go. Only ours -
        # a model that arrived on a wire belongs to a loader the user placed
        # and may be shared with the rest of the graph.
        if st["release_model"] and own_clip:
            _release_clip(clip)

        return {
            "ui": {
                "pixaroma_ai_prompt": [{
                    "text": out,
                    "generated": True,
                    # An empty answer because the model thought until it ran out
                    # of room needs its own words: the fix is Max len or a
                    # different model, and an unexplained empty box sends people
                    # rewriting a formula that was never the problem.
                    "status": ("this model reasons, and it used the whole Max len "
                               "thinking before it wrote anything - raise Max len, "
                               "or pick a model that does not reason")
                    if ran_out_thinking else status_line(st, wired, has_clip, True),
                    "used_clip": has_clip,
                    "words": word_count(out),
                    "seconds": round(time.time() - started, 2),
                    # See the pass-through payload above: the face stores this
                    # so the seed chip still names the run after a tab switch.
                    "seed": st["seed"],
                }]
            },
            "result": (out,),
        }


NODE_CLASS_MAPPINGS = {"PixaromaAIPrompt": PixaromaAIPrompt}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaAIPrompt": "AI Prompt Pixaroma"}
