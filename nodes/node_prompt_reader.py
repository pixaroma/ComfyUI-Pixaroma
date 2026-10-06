"""Prompt Reader Pixaroma - extract the positive prompt embedded in an image.

Reads PNG tEXt chunks or a JPG / WebP's EXIF (ComfyUI workflow JSON or A1111
'parameters'; _prompt_reader_helpers.read_png_text_chunks), walks the
graph back from the sampler to the positive CLIP-text-encode node, and returns
the underlying text. STRING output only - no IMAGE/MASK side. If the image
has no embedded prompt, returns a short notice string explaining that, so
downstream nodes still receive a usable value.
"""

import os

import folder_paths

from ._prompt_reader_helpers import read_prompt_from_image, resolve_input_image_name


class PixaromaPromptReader:
    DESCRIPTION = (
        "Prompt Reader Pixaroma - load an image generated with ComfyUI "
        "(or Automatic1111 / Forge, or on Civitai) and read the positive "
        "prompt saved inside its metadata (PNG, JPG or WebP). No image "
        "preview, just the text. "
        "Outputs the prompt as STRING so you can wire it into a "
        "CLIPTextEncode or any other text input and re-use it. "
        "Drag-drop an image onto the node, click Upload Image, or pick "
        "from the file combo. The readout updates the moment a file is "
        "selected, so you see the prompt before running the workflow. "
        "If the image has no embedded prompt (a screenshot, a photo, or "
        "a file whose metadata was removed), the readout shows a short "
        "explanation and the STRING output carries the same explanation "
        "so downstream wiring does not break. Handles ComfyUI workflows "
        "with chained text nodes (ConditioningCombine, "
        "StringConcatenate, SDXL dual-text encoders) and the "
        "Automatic1111 / Forge 'parameters' format. You can also wire a "
        "filename into the optional 'filename' input (for example from Load "
        "Image Pixaroma's 'filename' output) - while it is connected the node "
        "ignores its own picker and reads the prompt from that image instead. "
        "Pick, upload, or drop a file to take over and the wire disconnects."
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
                "image": (sorted(files), {"image_upload": True, "tooltip": "The image to read the prompt from. Upload, drag-drop, or pick an image (PNG, JPG or WebP) made with ComfyUI / Automatic1111 / Forge or on Civitai so its embedded prompt can be recovered. The readout updates as soon as you pick a file."}),
            },
            "optional": {
                # Wire-only (no widget). When connected it drives the read and
                # the picker above is ignored. Load Image Pixaroma's filename
                # output is extension-less, so read() resolves it back to the
                # real file via resolve_input_image_name.
                "filename": ("STRING", {"forceInput": True, "tooltip": "Optional. Wire an image's filename here (for example Load Image Pixaroma's 'filename' output) to read that image's prompt automatically. While connected, the node ignores its own picker. Pick, upload, or drop a file on the node to take over and disconnect the wire."}),
            },
        }

    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("The prompt recovered from the image's metadata, or an explanatory message if none was found.",)
    FUNCTION = "read"
    OUTPUT_NODE = True

    @staticmethod
    def _effective_name(image, filename):
        """Pick which image to read: the wired filename wins over the picker.

        Returns (name, error_message). When a filename is wired but cannot be
        matched to a real file, name is None and error_message explains it so
        read() can surface that to the user instead of silently falling back to
        the picker (which would be confusing).
        """
        wired = filename.strip() if isinstance(filename, str) else ""
        if wired:
            resolved = resolve_input_image_name(wired)
            if not resolved:
                return None, (
                    f"Could not find an image named '{wired}' in the input "
                    "folder. Make sure the image sent by the connected node "
                    "is present in ComfyUI's input folder."
                )
            return resolved, None
        return image, None

    def read(self, image: str, filename: str = None):
        name, err = self._effective_name(image, filename)
        if err:
            return {"ui": {"text": [err]}, "result": (err,)}
        try:
            image_path = folder_paths.get_annotated_filepath(name)
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
    def IS_CHANGED(cls, image, filename=None):
        # Use (mtime, size) instead of a full-file SHA hash. ComfyUI's native
        # LoadImage hashes the file content, but we only need to know whether
        # the file changed - a 50MB PNG hashed on every run is wasteful.
        # mtime+size catches every realistic edit (the only false-negative is
        # an in-place byte swap that preserves size AND mtime, which doesn't
        # happen in practice when ComfyUI re-saves or the user re-uploads).
        # Reflect the EFFECTIVE file (wired filename wins) so a change on the
        # connected image also invalidates the cache and re-runs.
        name, _err = cls._effective_name(image, filename)
        if not name:
            wired = filename.strip() if isinstance(filename, str) else ""
            if wired:
                # Wired but unresolvable - key on the raw name so it re-checks
                # when the file appears / the wire changes.
                return f"unresolved:{wired}"
            # Nothing selected at all - always re-run (nan), same as before.
            return float("nan")
        try:
            image_path = folder_paths.get_annotated_filepath(name)
            st = os.stat(image_path)
            return f"{st.st_mtime_ns}:{st.st_size}"
        except Exception:
            return f"name:{name}"

    @classmethod
    def VALIDATE_INPUTS(cls, image=None, filename=None):
        # Never hard-block the graph: the node always runs and reports any
        # problem (missing file, no metadata) via its readout / output string,
        # so downstream wiring keeps working. This also means a wired filename
        # driving the read is never blocked by a stale picker value, and an
        # uploaded file not yet in the combo list is accepted.
        return True


NODE_CLASS_MAPPINGS = {"PixaromaPromptReader": PixaromaPromptReader}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPromptReader": "Prompt Reader Pixaroma"}
