"""Video Prompt Pixaroma - write an H3 prompt with a local model, in one node.

Replaces three workflows (text to video, first frame, first and last) of about
ten nodes each. Everything they wired by hand happens inside here: the text
encoder is loaded and cached, the two frames are stitched, the formula is joined
with the idea and the length block, and the model is asked for the prompt.

THE MODE IS NOT STORED. It is derived from which image inputs arrived, so there
is no mode on node.properties to go stale, and the connection handler in the JS
writes no serialized state - which is what keeps this clear of the configure
replay that has bitten the Switch family twice (Vue Compat #17 / #19).

All the text assembly is pure and lives in _video_prompt_helpers.py so it can be
tested with a bare python and no model on disk
(harness: D:\\Claude Tests\\_video_prompt_test.py).

The three calls that do the generating are exactly the ones core's own
TextGenerate node makes (comfy_extras/nodes_textgen.py): clip.tokenize, then
clip.generate, then clip.decode. Core's TextGenerateLTX2Prompt is the same shape
as this node for a different model - a TextGenerate that carries its own system
prompt - so this is a sanctioned pattern rather than a workaround.
"""
import torch

import comfy.model_management
import comfy.sd
import comfy.utils
import folder_paths

from ._duration_helpers import frames_from_seconds
from ._video_prompt_helpers import (
    FIRST_LAST,
    MODE_LABELS,
    TEXT_TO_VIDEO,
    assemble,
    formulas_fingerprint,
    load_formula,
    mode_for,
    parse_state,
    pick_model,
    word_count,
)

# ---------------------------------------------------------------------------
# Model cache
# ---------------------------------------------------------------------------
# ComfyUI caches a CLIPLoader node's OUTPUT between runs, which is what keeps a
# text encoder warm in the workflows this node replaces. Loading inside a node
# gets none of that, so without a cache here a 10 GB encoder would be re-read
# from disk on every single generate.
#
# Deliberately holds ONE entry: swapping the model in settings should release
# the old one rather than sit on two 10 GB encoders. The value is the CLIP
# object core hands back, which owns a ModelPatcher, so ComfyUI's own model
# management can still offload it when something else needs the VRAM.
_CLIP_CACHE = {}


def _release_clip(clip=None):
    """Actually give the VRAM back.

    ⚠️ `soft_empty_cache()` ALONE DOES NOT UNLOAD ANYTHING. It empties torch's
    allocator cache; ComfyUI's own `current_loaded_models` still holds the
    encoder, so a 10 GB model stays resident and the "release" does nothing
    visible. The model has to be unloaded first, and only then is emptying the
    allocator cache worth doing.

    `unload_model_and_clones` is deliberate over `unload_all_models()`: this node
    is meant to sit in front of an H3 video model, and evicting everything would
    throw away whatever else the workflow had already loaded and make the next
    step reload it too.
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
            # Older builds without it: fall back to the blunt instrument rather
            # than silently leaving the memory held.
            try:
                comfy.model_management.unload_all_models()
            except Exception:
                pass
    try:
        comfy.model_management.soft_empty_cache()
    except Exception:
        pass


_NEEDED = (
    "  This node needs a VISION language model (a Qwen3-VL build) in your\n"
    "  ComfyUI/models/text_encoders folder, because it has to SEE the picture.\n"
    "  The one these formulas were written and measured against is\n"
    "  qwen3-vl-8b-heretic-1.3.0_fp8_e4m3fn.safetensors (10 GB, for 12 GB+ cards):\n"
    "  https://huggingface.co/DreamFast/Qwen3-VL-8B-Heretic-1.3.0/tree/main/comfyui\n"
    "  (take it from that comfyui folder, NOT the repo root - the root holds the\n"
    "  raw model, which ComfyUI cannot load as a text encoder)\n"
    "  For an 8 GB card use the 4B instead:\n"
    "  https://huggingface.co/DreamFast/Qwen3-VL-4b-Heretic-ComfyUI/tree/main\n"
    "  Pick it afterwards from the gear on the node, or leave it and the node\n"
    "  will find it by itself."
)


def _resolve_model(wanted: str):
    """The model to actually load, substituting when the named one is absent.

    Nobody opens the settings before their first Run. The shipped default names
    one specific file, so without this every user who does not happen to own
    that file gets a failure on a node they have not misconfigured.
    """
    try:
        available = list(folder_paths.get_filename_list("text_encoders"))
    except Exception:
        available = []
    chosen, auto = pick_model(available, wanted)
    if chosen is None:
        if available:
            raise RuntimeError(
                "[Pixaroma] Video Prompt: none of the files in your "
                "text_encoders folder look like a vision language model.\n"
                + _NEEDED
            )
        raise RuntimeError(
            "[Pixaroma] Video Prompt: your text_encoders folder is empty.\n"
            + _NEEDED
        )
    if auto:
        print("[Pixaroma] Video Prompt: \"%s\" is not in text_encoders, "
              "using \"%s\" instead. Pick one from the gear to silence this."
              % (wanted, chosen))
    return chosen


def _load_clip(name: str, clip_type: str):
    key = (name, clip_type)
    cached = _CLIP_CACHE.get(key)
    if cached is not None:
        return cached
    try:
        path = folder_paths.get_full_path_or_raise("text_encoders", name)
    except Exception:
        raise RuntimeError(
            "[Pixaroma] Video Prompt: the text encoder \"%s\" was not found "
            "in your text_encoders folder.\n" % name + _NEEDED
        )
    # Same getattr-with-fallback CLIPLoader itself uses, so an unknown type name
    # degrades instead of raising. The type is largely inert for these models -
    # the encoder comes from the weights - but it is carried so an unusual build
    # can still be pointed at the right branch.
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
        # The model combo lists EVERY file in text_encoders, so picking a T5 or
        # a CLIP-L is an easy mistake. `raise ... from e` keeps the original
        # traceback, or a genuine corrupt-file or OOM failure would become
        # undiagnosable.
        raise RuntimeError(
            "[Pixaroma] Video Prompt: \"%s\" could not be loaded as a "
            "language model.\n" % name + _NEEDED
        ) from e
    # NOTE: do NOT test `hasattr(clip, "generate")` here. ComfyUI's CLIP wrapper
    # ALWAYS has .generate - it delegates to the inner model - so the check
    # passes for a T5 and the real failure surfaces later as
    # "'T5GemmaModel' object has no attribute 'generate'". Measured 2026-08-12.
    # The honest place to catch it is around the generate CALL; see run().
    _CLIP_CACHE[key] = clip
    return clip


# ---------------------------------------------------------------------------
# Stitching
# ---------------------------------------------------------------------------
def _stitch_right(image1, image2):
    """First frame on the LEFT, last frame on the RIGHT, in one picture.

    A faithful copy of core's ImageStitch for the exact settings the tested FFLF
    workflow used (direction right, match_image_size on, no spacing), rather
    than a call into it: the V3 node returns an IO.NodeOutput whose shape is
    internal API, and this is fifteen lines.

    Which half is which is load-bearing - the whole FFLF formula is written
    around left meaning the start - so it is fixed here in Python and can no
    longer be wired backwards by accident.
    """
    if image2 is None:
        return image1
    if image1 is None:
        return image2
    if image1.shape[0] != image2.shape[0]:
        n = max(image1.shape[0], image2.shape[0])
        if image1.shape[0] < n:
            image1 = torch.cat(
                [image1, image1[-1:].repeat(n - image1.shape[0], 1, 1, 1)]
            )
        if image2.shape[0] < n:
            image2 = torch.cat(
                [image2, image2[-1:].repeat(n - image2.shape[0], 1, 1, 1)]
            )
    # Channel equalisation, copied from core (nodes_images.py). Without it an
    # RGB first frame plus an RGBA last frame - easy to produce by wiring
    # anything alpha-aware into ONE input - raises out of torch.cat AFTER the
    # 10 GB encoder has loaded, with a traceback naming torch rather than us.
    # Flagged independently by two reviewers.
    c1, c2 = int(image1.shape[-1]), int(image2.shape[-1])
    if c1 != c2:
        target_c = max(c1, c2)
        if c1 < target_c:
            image1 = torch.cat([
                image1,
                torch.ones((*image1.shape[:-1], target_c - c1),
                           device=image1.device, dtype=image1.dtype),
            ], dim=-1)
        if c2 < target_c:
            image2 = torch.cat([
                image2,
                torch.ones((*image2.shape[:-1], target_c - c2),
                           device=image2.device, dtype=image2.dtype),
            ], dim=-1)
    h1 = int(image1.shape[1])
    h2, w2 = int(image2.shape[1]), int(image2.shape[2])
    if h1 < 1 or h2 < 1 or w2 < 1:
        return image1
    target_h = h1
    target_w = max(1, int(h1 * (w2 / h2)))
    image2 = comfy.utils.common_upscale(
        image2.movedim(-1, 1), target_w, target_h, "lanczos", "disabled"
    ).movedim(1, -1)
    return torch.cat([image1, image2], dim=2)


def _img(x):
    """An IMAGE input as plain RGB, or None if it is not actually an image.

    Two jobs, both load-bearing:

    1. An `optional` input is NOT type-guaranteed: any ANY-type passthrough
       (our own Switch Pixaroma included) can put a list or a string on
       `first_frame`. `x is not None` would then be True, so the MODE would
       flip to first-frame and the WRONG FORMULA would run - worse than the
       exception that follows. Duck-typed on `ndim` rather than
       isinstance(torch.Tensor) so a tensor subclass still works.

    2. ⚠️ DROP THE ALPHA. Qwen3-VL's image preprocessing normalises exactly
       three channels and then reshapes patches using the real channel count,
       so a 4-channel RGBA image produces a 2048-wide patch against a
       1536-wide vision tower and dies in a torch matmul. Remove Background
       Pixaroma returns genuine RGBA, so this is one wire away, not exotic.

       Doing it HERE rather than in the stitch covers the single-image path
       too, and it happens BEFORE the model loads - the first attempt at this
       padded to 4 channels instead, which turned an instant failure into one
       that cost a 10 GB load first. Stripping is also what the rest of the
       pack does (Image Resize, Longest Side, Pause Image).
    """
    if getattr(x, "ndim", 0) != 4:
        return None
    try:
        if int(x.shape[-1]) > 3:
            return x[..., :3].contiguous()
    except (AttributeError, TypeError, ValueError, IndexError):
        # AttributeError is in the list because .contiguous() is torch-only:
        # an ANY-type passthrough that hands over a numpy RGBA batch has ndim 4
        # and a .shape, so it reaches the slice and then dies on a method it
        # does not have. Measured: "'numpy.ndarray' object has no attribute
        # 'contiguous'", raised out of run() ahead of every friendly message
        # this node has. Refusing it is the whole point of this function.
        return None
    return x


def _first_image(*candidates):
    for c in candidates:
        if c is not None:
            return c
    return None


class PixaromaVideoPrompt:
    DESCRIPTION = (
        "Writes a MiniMax H3 video prompt for you, on your own machine, using a small "
        "language model you already have. It replaces three separate workflows and about "
        "ten nodes with one.\n\n"
        "Type your idea in plain words, pick how long the video should be, and press Run. "
        "The node hands back a finished H3 prompt with all the fields and rules that model "
        "expects, plus the frame count to render it at.\n\n"
        "What it writes depends on what you wire in, and it switches by itself. Nothing "
        "connected means text to video. A first frame connected means it looks at that "
        "picture and animates it. Both a first and a last frame means it writes the journey "
        "from one to the other, and it joins the two pictures for you so they can never end "
        "up the wrong way round.\n\n"
        "The wording it follows lives in the settings, one for each of the three cases, and "
        "you can edit any of them and put the original back. The length choices live there "
        "too, because how much to write is the setting that changes the result most.\n\n"
        "Wire the frames output into your H3 node so the video is rendered at the same "
        "length the prompt was written for. Getting those two out of step is the easiest "
        "way to spoil a clip.\n\n"
        "Needs a vision model in your text_encoders folder, because the first-frame modes "
        "have to see the picture.\n\n"
        "Find it by searching for h3, minimax, prompt, llm, or write prompt."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # Everything the face shows rides in the hidden state blob, injected by
        # the browser at graphToPrompt time (Vue Compat #9). A required STRING
        # would render as a widget AND a convertible input dot.
        return {
            "required": {},
            "optional": {
                "first_frame": (
                    "IMAGE",
                    {
                        "tooltip": "The picture the video starts on. Connecting this "
                        "switches the node to first-frame mode, so it describes what it "
                        "sees and animates it. Leave it empty for text to video."
                    },
                ),
                "last_frame": (
                    "IMAGE",
                    {
                        "tooltip": "The picture the video ends on. Connecting this as "
                        "well as a first frame switches the node to first-and-last mode, "
                        "where it writes the movement from one picture to the other. "
                        "On its own, with no first frame, it is treated the SAME as a "
                        "first frame: the node describes that picture and animates FROM "
                        "it, not towards it. There is no last-frame-only mode, so wire a "
                        "first frame too if you want the movement to end on this picture."
                    },
                ),
                "clip": (
                    "CLIP",
                    {
                        "tooltip": "Optional. Wire a CLIP Loader here to use that model "
                        "instead of the one chosen in the node's settings. Handy for "
                        "sharing a single loaded model between several of these nodes."
                    },
                ),
            },
            "hidden": {"VideoPromptState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("STRING", "INT", "FLOAT")
    RETURN_NAMES = ("text", "frames", "seconds")
    OUTPUT_TOOLTIPS = (
        "The finished MiniMax H3 prompt. Wire it into the prompt or text input of your H3 "
        "node.",
        "How many frames to render, already adjusted to the pattern H3 accepts. Wire this "
        "into the length input of your H3 node so the video is exactly as long as the "
        "prompt was written for.",
        "How long the video will really be in seconds, which is the frame count divided by "
        "the frame rate. Use it for anything that has to line up with the video, such as "
        "the length of an audio track.",
    )
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        """Make an edited FORMULA reach the next Run.

        VideoPromptState covers the idea, the length and the seed, because it is a
        real input. The formulas are NOT - they are read from disk at execution
        time, so nothing about editing one changes the cache key.

        Measured before this existed: edit the active tier, press Run, and the
        run finished in 1.0s from cache with byte-identical text and the edit
        silently ignored. The settings panel appeared completely broken.

        Returns a fingerprint that is STABLE when nothing changed, so an
        unchanged node still caches and does not reload a 10 GB model on every
        queue. ComfyUI prepends this to the signature and then appends every
        input, so it can only make the key finer, never coarser.
        """
        return formulas_fingerprint()

    def run(self, first_frame=None, last_frame=None, clip=None, VideoPromptState="{}"):
        st = parse_state(VideoPromptState)
        # Coerce BEFORE mode_for, or a junk input silently selects the wrong
        # formula (see _img).
        first_frame = _img(first_frame)
        last_frame = _img(last_frame)
        mode = mode_for(first_frame is not None, last_frame is not None)
        prompt, asked_seconds, tier_name = assemble(VideoPromptState, mode)

        # Test the FORMULA, not the assembled prompt. The assembled prompt also
        # contains the idea and the length block, so with any idea typed a
        # missing formula file - or an override saved as "" - produced a prompt
        # that was just the idea plus the length block: no rules, no error, and
        # confident free-form prose that is not an H3 prompt at all. The helpful
        # message was unreachable in exactly the case that needed it.
        if not load_formula(mode).strip():
            raise RuntimeError(
                "[Pixaroma] Video Prompt: there is no formula to run for "
                "\"%s\". Open the gear on the node and press Reset on that formula "
                "to put the shipped one back." % MODE_LABELS.get(mode, mode)
            )

        # An empty idea in TEXT mode puts the LENGTH block directly under the
        # formula's trailing "IDEA:", so the model reads the length instructions
        # as the idea and writes confident nonsense. Refused only in text mode:
        # "look at this picture and invent something" is a legitimate use of a
        # first frame.
        if mode == TEXT_TO_VIDEO and not st["idea"].strip():
            raise RuntimeError(
                "[Pixaroma] Video Prompt: type an idea on the node first. "
                "With no picture wired and no idea, there is nothing to write about."
            )

        if asked_seconds <= 0:
            # Two different causes, two different fixes. The panel has no rename
            # control, so telling somebody to rename a tier that does not exist
            # is the wrong instruction twice over.
            if tier_name:
                raise RuntimeError(
                    "[Pixaroma] Video Prompt: the duration \"%s\" has no number of "
                    "seconds in its name, so the frame count cannot be worked out. "
                    "Give it a name with a number in it, like \"8 seconds\"."
                    % tier_name
                )
            raise RuntimeError(
                "[Pixaroma] Video Prompt: there are no duration tiers on disk for "
                "\"%s\". Open the gear on the node and press Reset on that formula "
                "to put the shipped ones back." % MODE_LABELS.get(mode, mode)
            )

        if mode == FIRST_LAST:
            image = _stitch_right(first_frame, last_frame)
        else:
            image = _first_image(first_frame, last_frame)

        if clip is not None:
            model = clip
            model_name = "the wired CLIP"
        else:
            model_name = _resolve_model(st["model"])
            model = _load_clip(model_name, st["clip_type"])

        # BYTE-IDENTICAL to core's TextGenerate.execute, including video and
        # audio. Do NOT wrap this in a try/except TypeError "for safety": every
        # tokenizer in the chain ends in **kwargs, so nothing here can raise
        # TypeError, and a fallback that quietly dropped skip_template or
        # thinking would change what the model is asked without saying so. That
        # fallback existed for one build of this node and cost an afternoon,
        # because it was the obvious suspect for a difference that turned out
        # not to exist. Measured 2026-08-12: this node and core's TextGenerate
        # score identically (2/6) on the same image, prompt text and seeds.
        #
        # `image` is singular on purpose. Qwen3VLTokenizer takes `images` as a
        # list but reads a singular `image` out of kwargs and splits it by batch
        # (comfy/text_encoders/qwen3vl.py, tokenize_with_weights).
        # The WRONG-MODEL guard lives here, around the call, because it cannot
        # live at load time: ComfyUI's CLIP wrapper always exposes .generate and
        # only the INNER model lacks it, so a T5 loads happily and then fails
        # with "'T5GemmaModel' object has no attribute 'generate'" - a message
        # that tells the user nothing about what to do.
        try:
            tokens = model.tokenize(
                prompt,
                image=image,
                skip_template=not st["use_default_template"],
                min_length=1,
                thinking=st["thinking"],
                video=None,
                audio=None,
            )
            generated = model.generate(
                tokens,
                do_sample=True,
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
            # NARROW on the message, not just the type. This block wraps a
            # multi-minute generation that touches ModelPatcher, model
            # management and torch internals, so any AttributeError from a
            # version skew or a real bug in that chain would otherwise be
            # reported as "pick a different model" - sending someone to
            # re-download 10 GB they already have, with the true traceback
            # hidden. The measured wrong-model failure is exactly
            # "'T5GemmaModel' object has no attribute 'generate'".
            if "generate" not in str(e):
                raise
            raise RuntimeError(
                "[Pixaroma] Video Prompt: \"%s\" cannot write text - it is "
                "not a language model.\n" % model_name + _NEEDED
            ) from e
        text = model.decode(generated)
        text = text.strip() if isinstance(text, str) else ""

        frames = frames_from_seconds(
            asked_seconds, st["fps"], st["step"], st["plus"], st["min_frames"]
        )
        fps = st["fps"] if st["fps"] > 0 else 24.0
        true_seconds = round(frames / fps, 4)

        # Free the encoder BEFORE the rest of the workflow runs, so an H3 video
        # model downstream gets the memory. The prompt is already decoded into
        # `text` by this point, so unloading cannot cost us the answer.
        #
        # Skipped when `clip` came in on a wire: that model belongs to a
        # CLIPLoader the user put on the canvas and may be shared with another
        # node, so it is not ours to evict.
        if st["release_model"] and clip is None:
            _release_clip(model)

        return {
            "ui": {
                "pixaroma_video_prompt": [
                    {
                        "text": text,
                        "words": word_count(text),
                        "mode": mode,
                        "mode_label": MODE_LABELS.get(mode, mode),
                        "tier": tier_name,
                        "asked_seconds": asked_seconds,
                        "frames": frames,
                        "seconds": true_seconds,
                        "seed": st["seed"],
                    }
                ]
            },
            "result": (text, frames, true_seconds),
        }


NODE_CLASS_MAPPINGS = {"PixaromaVideoPrompt": PixaromaVideoPrompt}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaVideoPrompt": "Video Prompt Pixaroma"}
