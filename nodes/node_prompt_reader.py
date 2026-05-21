"""Prompt Reader Pixaroma - extract the positive prompt embedded in an image.

Reads PNG tEXt chunks (ComfyUI workflow JSON or A1111 'parameters'), walks the
graph back from the sampler to the positive CLIP-text-encode node, and returns
the underlying text. STRING output only - no IMAGE/MASK side. If the image
has no embedded prompt, returns a short notice string explaining that, so
downstream nodes still receive a usable value.
"""

import os

import folder_paths

from ._prompt_reader_helpers import read_prompt_from_image


class PixaromaPromptReader:
    DESCRIPTION = (
        "Prompt Reader Pixaroma - load an image generated with ComfyUI "
        "(or Automatic1111 / Forge) and read the positive prompt saved "
        "inside its PNG metadata. No image preview, just the text. "
        "Outputs the prompt as STRING so you can wire it into a "
        "CLIPTextEncode or any other text input and re-use it. "
        "Drag-drop a PNG onto the node, click Upload Image, or pick "
        "from the file combo. The readout updates the moment a file is "
        "selected, so you see the prompt before running the workflow. "
        "If the image has no embedded prompt (JPG, screenshot, or a "
        "PNG that lost its metadata), the readout shows a short "
        "explanation and the STRING output carries the same explanation "
        "so downstream wiring does not break. Handles ComfyUI workflows "
        "with chained text nodes (ConditioningCombine, "
        "StringConcatenate, SDXL dual-text encoders) and the "
        "Automatic1111 / Forge 'parameters' format."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # Walk input/ recursively so subfolder PNGs are listed too. Forward
        # slashes in the paths so folder_paths.get_annotated_filepath resolves
        # them correctly cross-platform. Mirrors node_load_image.py.
        input_dir = folder_paths.get_input_directory()
        files = []
        try:
            if os.path.isdir(input_dir):
                for root, _dirs, fnames in os.walk(input_dir):
                    rel_root = os.path.relpath(root, input_dir)
                    for fname in fnames:
                        rel = fname if rel_root == "." else os.path.join(rel_root, fname)
                        files.append(rel.replace("\\", "/"))
            files = folder_paths.filter_files_content_types(files, ["image"])
        except Exception:
            files = []
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True, "tooltip": "The image to read the prompt from. Upload, drag-drop, or pick a PNG made with ComfyUI / Automatic1111 / Forge so its embedded prompt can be recovered. The readout updates as soon as you pick a file."}),
            },
        }

    CATEGORY = "👑 Pixaroma"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("The prompt recovered from the image's metadata, or an explanatory message if none was found.",)
    FUNCTION = "read"
    OUTPUT_NODE = True

    def read(self, image: str):
        try:
            image_path = folder_paths.get_annotated_filepath(image)
        except Exception:
            text = "Image file not found in the input folder."
            return {"ui": {"text": [text]}, "result": (text,)}

        result = read_prompt_from_image(image_path)
        if result.get("found"):
            text = result.get("text") or ""
        else:
            text = result.get("message") or "No prompt found in this image."
        return {"ui": {"text": [text]}, "result": (text,)}

    @classmethod
    def IS_CHANGED(cls, image):
        # Use (mtime, size) instead of a full-file SHA hash. ComfyUI's native
        # LoadImage hashes the file content, but we only need to know whether
        # the file changed - a 50MB PNG hashed on every run is wasteful.
        # mtime+size catches every realistic edit (the only false-negative is
        # an in-place byte swap that preserves size AND mtime, which doesn't
        # happen in practice when ComfyUI re-saves or the user re-uploads).
        try:
            image_path = folder_paths.get_annotated_filepath(image)
            st = os.stat(image_path)
            return f"{st.st_mtime_ns}:{st.st_size}"
        except Exception:
            return float("nan")

    @classmethod
    def VALIDATE_INPUTS(cls, image):
        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True


NODE_CLASS_MAPPINGS = {"PixaromaPromptReader": PixaromaPromptReader}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPromptReader": "Prompt Reader Pixaroma"}
