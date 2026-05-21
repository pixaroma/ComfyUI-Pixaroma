import torch

from .node_ref import any_type


class PixaromaShowText:
    DESCRIPTION = (
        "Show Text Pixaroma - inspect what's flowing through your nodes in a "
        "real read-only text box you can select and copy from. Wire ANYTHING "
        "into source - strings, ints, floats, latents, IMAGE tensors, even "
        "unknown types - and the node prints a compact human-readable form:\n\n"
        "- Tensors: shape, dtype, min, max\n"
        "- Latents: sample shape\n"
        "- Anything else: str(value)\n\n"
        "Resize the node freely; long text scrolls with a scrollbar instead "
        "of forcing the node to grow. The same string is also passed through "
        "to the 'text' STRING output, so you can chain it into other nodes "
        "(useful for inspecting a prompt before passing it through)."
    )

    @classmethod
    def INPUT_TYPES(s):
        return {"required": {"source": (any_type, {"tooltip": "Anything to inspect. Tensors are summarized as shape / dtype / min / max; latents show their sample shape; everything else uses str(value). The string representation is also passed through unchanged to the 'text' output."})}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("The same text shown in the box, passed through so you can keep chaining it.",)
    FUNCTION = "show"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma"

    def show(self, source):
        try:
            if isinstance(source, torch.Tensor):
                text = (
                    f"Tensor  shape={tuple(source.shape)}"
                    f"  dtype={source.dtype}"
                    f"  min={source.min().item():.4f}"
                    f"  max={source.max().item():.4f}"
                )
            elif isinstance(source, dict) and "samples" in source:
                s = source["samples"]
                text = f"Latent  shape={tuple(s.shape)}"
            else:
                text = str(source)
        except Exception:
            text = str(source)
        return {"ui": {"text": [text]}, "result": (text,)}


NODE_CLASS_MAPPINGS = {
    "PixaromaShowText": PixaromaShowText,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaShowText": "Show Text Pixaroma",
}
