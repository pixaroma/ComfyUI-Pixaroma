class PixaromaCaptionReview:
    """Caption Review Pixaroma - check and fix the captions of a training set.

    A canvas tool, like Note and Info: it never runs (no outputs, not an output
    node), so ComfyUI skips it on Run. Its window (js/caption_review/) shows every
    picture of a folder with its .txt caption under it, editable, and writes the
    edited captions back through Save Text's existing write route (no new write
    route: registry-compliance.md 4e #2). The pictures and captions come from the
    read-only caption_review/list route, contained by _text_folder_helpers.
    """

    DESCRIPTION = (
        "Caption Review Pixaroma - shows every picture of a folder with its caption under it, so "
        "you can read and fix the captions of a training set in one window.\n\n"
        "Type the folder or click Browse, then click Review captions. Each picture shows its .txt "
        "file (01_Cat.png and 01_Cat.txt); type to fix one, and Save writes the changed captions "
        "back. A picture with no caption gets a new .txt when you write one. Filter by a word, or "
        "show only the pictures that still need a caption.\n\n"
        "Pair it with Save Text's One file per entry (an AI writes the captions, you check them "
        "here) and Load Texts from Folder (Run again with your fixed captions). It never runs: "
        "nothing to wire, nothing to process."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder": ("STRING", {"default": "", "tooltip": "The folder with the pictures and their .txt captions. Empty = ComfyUI's output folder; a name like Training Set = a folder inside output; or a full path to a folder you approved with Browse."}),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "noop"
    # OUTPUT_NODE intentionally not set: ComfyUI skips the node on Run (same as Note and Info).
    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"

    def noop(self, folder=""):
        return ()


NODE_CLASS_MAPPINGS = {"PixaromaCaptionReview": PixaromaCaptionReview}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaCaptionReview": "Caption Review Pixaroma"}
