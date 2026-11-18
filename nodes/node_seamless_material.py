"""Seamless Material Pixaroma.

A seamless tile in; colour, roughness, normal, height and AO maps out (a material for Blender and other 3D programs),
every map seamless too. No model, no download: plain image math in _seamless_material_helpers.py, every blur and
slope wrapping around the edges.

With save_files on, each Run writes a NEW folder inside ComfyUI's output folder (save_to "materials/stone" ->
output/materials/stone_001/stone_color.png, _roughness, _normal, _height, _ao), named the way Blender's Node Wrangler
(Shift+Ctrl+T, Add Principled Texture Setup) wires them by itself. The path goes through _path_guard.safe_join.
"""
import os

from ._seamless_material_helpers import (
    MAP_NAMES,
    NORMAL_FORMATS,
    clean_save_to,
    file_names,
    make_maps,
    next_folder_name,
)


class SeamlessMaterialPixaroma:
    DESCRIPTION = (
        "Turns a seamless tile into a material for Blender and other 3D programs. It makes five maps: color, "
        "roughness, normal, height and AO. Every map is seamless too, because all the math wraps around the edges. "
        "No model and no download. The relief comes from brightness, so dark means deep. That suits stone, bricks "
        "with dark gaps, wood planks, tiles and woven fabric. It is wrong where a dark colour is not deeper, like a "
        "dark flower on a pale print. For light mortar between darker bricks, switch invert_height on. With "
        "save_files on, new maps are saved in a new numbered folder inside ComfyUI's output folder. Blender's Node "
        "Wrangler (Ctrl+Shift+T on a Principled BSDF) loads all five files from there in one step."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {
                    "tooltip": "The seamless tile, for example from Seamless Tile Pixaroma and VAE Decode. A tile "
                               "with an edge gives maps with the same edge.",
                }),
                "strength": ("FLOAT", {
                    "default": 1.0, "min": 0.0, "max": 10.0, "step": 0.05,
                    "tooltip": "How deep the relief looks in the normal map. 1 suits most stone and wood. Above "
                               "2, stains and small dark spots start to look like pits. The height map does not "
                               "change.",
                }),
                "roughness_min": ("FLOAT", {
                    "default": 0.55, "min": 0.0, "max": 1.0, "step": 0.01,
                    "tooltip": "Roughness of the brightest parts. 0 = mirror, 1 = fully matte.",
                }),
                "roughness_max": ("FLOAT", {
                    "default": 0.9, "min": 0.0, "max": 1.0, "step": 0.01,
                    "tooltip": "Roughness of the darkest parts. Set both the same for one even roughness.",
                }),
                "invert_height": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Off: dark = deep (gaps between stones and planks). On: light = deep (light mortar "
                               "between darker bricks).",
                }),
                "normal_format": (list(NORMAL_FORMATS), {
                    "default": NORMAL_FORMATS[0],
                    "tooltip": "OpenGL is what Blender reads. DirectX flips the green channel, for programs that "
                               "read DirectX normal maps.",
                }),
                "save_files": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "On: new maps are saved as five PNG files in a new numbered folder inside "
                               "ComfyUI's output folder. A Run with nothing changed saves nothing new. Off: "
                               "nothing is saved.",
                }),
                "save_to": ("STRING", {
                    "default": "materials/stone",
                    "tooltip": "Folder and name inside ComfyUI's output folder. materials/stone saves "
                               "output/materials/stone_001/stone_color.png, stone_roughness.png, stone_normal.png, "
                               "stone_height.png and stone_ao.png. New maps go to the next number: the highest "
                               "number is the newest.",
                }),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "IMAGE", "IMAGE")
    RETURN_NAMES = ("color", "roughness", "normal", "height", "ao")
    OUTPUT_TOOLTIPS = (
        "The tile itself (Base Color in Blender).",
        "Grey roughness map: white = matte, black = shiny.",
        "Normal map (blue-purple), the small relief for the light. OpenGL or DirectX as chosen.",
        "Grey height map: white = high, black = deep. Blender's Displacement or Bump node.",
        "Ambient occlusion: dark in the crevices. Blender renders its own shadows, so it is optional there.",
    )
    FUNCTION = "make"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    def make(self, image, strength=1.0, roughness_min=0.55, roughness_max=0.9, invert_height=False,
             normal_format=NORMAL_FORMATS[0], save_files=True, save_to="materials/stone", prompt=None,
             extra_pnginfo=None):
        if normal_format not in NORMAL_FORMATS:
            normal_format = NORMAL_FORMATS[0]
        maps = make_maps(image, strength=strength, roughness_min=roughness_min, roughness_max=roughness_max,
                         invert_height=bool(invert_height), normal_format=normal_format)
        if save_files:
            _save_maps(maps, save_to, prompt, extra_pnginfo)
        return tuple(maps[m] for m in MAP_NAMES)


def _save_maps(maps, save_to, prompt=None, extra_pnginfo=None):
    """One new folder per picture of the batch, five PNGs each. Height is 16-bit grey (no steps in a displacement);
    roughness and AO 8-bit grey; colour and normal 8-bit RGB. The workflow goes into the colour PNG only."""
    import folder_paths
    import numpy as np
    from PIL import Image

    from ._path_guard import rel_is_rooted, safe_join
    from ._save_helpers import _build_pnginfo

    # A full path (C:\..., /..., \\server\...) is refused with a clear message instead of turning into a strange
    # folder inside output. Lexical only: nothing is resolved before this (a UNC path would contact the host).
    if rel_is_rooted(save_to):
        raise ValueError(f"Seamless Material: save_to is a folder INSIDE ComfyUI's output folder, like "
                         f"materials/stone, not a full path (got {save_to!r}).")
    out_root = os.path.realpath(folder_paths.get_output_directory())
    sub, name = clean_save_to(save_to)
    parent = safe_join(out_root, sub) if sub else out_root
    if not parent:
        raise ValueError(f"Seamless Material: save_to must be a folder inside ComfyUI's output folder "
                         f"(got {save_to!r}). Example: materials/stone")
    try:
        os.makedirs(parent, exist_ok=True)
        existing = os.listdir(parent)
    except OSError as e:
        raise RuntimeError(f"Seamless Material: cannot make the folder {parent}: {e}") from e

    names = file_names(name)
    count = maps["color"].shape[0]
    for i in range(count):
        # never write into a folder that already exists (an earlier material would be overwritten): a name taken
        # some other way (another program, a race) moves on to the next number
        for _ in range(1000):
            folder_name = next_folder_name(existing, name)
            existing.append(folder_name)
            folder = safe_join(parent, folder_name)
            if not folder:
                raise ValueError(f"Seamless Material: cannot save under {save_to!r}.")
            try:
                os.makedirs(folder, exist_ok=False)
                break
            except FileExistsError:
                continue
        else:
            raise RuntimeError(f"Seamless Material: no free folder name for {name!r} in {parent}.")

        def u8(m, i=i):
            return (maps[m][i].detach().float().cpu().clamp(0, 1).numpy() * 255.0 + 0.5).astype(np.uint8)

        Image.fromarray(u8("color")).save(os.path.join(folder, names["color"]), "PNG", compress_level=4,
                                          pnginfo=_build_pnginfo(prompt=prompt, extra_pnginfo=extra_pnginfo))
        Image.fromarray(u8("normal")).save(os.path.join(folder, names["normal"]), "PNG", compress_level=4)
        for m in ("roughness", "ao"):
            Image.fromarray(u8(m)[..., 0]).save(os.path.join(folder, names[m]), "PNG", compress_level=4)
        h = maps["height"][i][..., 0].detach().float().cpu().clamp(0, 1).numpy()
        Image.fromarray((h * 65535.0 + 0.5).astype(np.uint16)).save(os.path.join(folder, names["height"]), "PNG",
                                                                     compress_level=4)
        # cp1252-safe: a folder name with an emoji must not crash the Run after the files are written
        print("[Pixaroma] Seamless Material: saved 5 maps to " + folder.encode("ascii", "backslashreplace").decode())


NODE_CLASS_MAPPINGS = {"SeamlessMaterialPixaroma": SeamlessMaterialPixaroma}
NODE_DISPLAY_NAME_MAPPINGS = {"SeamlessMaterialPixaroma": "Seamless Material Pixaroma"}
