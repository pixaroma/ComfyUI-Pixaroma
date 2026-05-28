"""Generate test workflows for Mute Switch Pixaroma.

Writes 3 JSONs into D:/Claude Tests/mute switch workflows/:
  01 - Basic test (2 scenes sharing loaders) - demos basic mute + refcount
  02 - Single vs Multi modes (3 scenes)
  03 - Mute vs Bypass mode (2 scenes)

Each workflow has a title + subtitle label explaining what to click.
"""
import json
import os
import uuid

OUT_DIR = r"D:\Claude Tests\mute switch workflows"
os.makedirs(OUT_DIR, exist_ok=True)

BRAND = "#f66744"

# ── Node-color palette (from workflow_generation_recipes.md) ──────────────
COL_LOADER = {"color": "#004835", "bgcolor": "#1d1d1d"}
COL_POS    = {"color": "#15261c", "bgcolor": "#004835"}  # CLIPTextEncode (positive)
COL_LATENT = {"color": "#323",    "bgcolor": "#535"}      # EmptySD3LatentImage
COL_PROC   = {"color": "#1d1d1d", "bgcolor": "#2a2a2a"}   # KSampler / VAEDecode / etc.
COL_LABEL  = {"color": "transparent", "bgcolor": "transparent"}


_LABEL_ID = [9000]
def _next_label_id():
    _LABEL_ID[0] += 1
    return _LABEL_ID[0]

def title_label(x, y, w, text):
    return {
        "id": _next_label_id(),
        "type": "PixaromaLabel",
        "pos": [x, y],
        "size": [w, 51],
        "flags": {"no_title": True},
        "order": 0,
        "mode": 0,
        "inputs": [],
        "outputs": [],
        "properties": {
            "cnr_id": "ComfyUI-Pixaroma",
            "Node name for S&R": "PixaromaLabel",
            "aux_id": "pixaroma/ComfyUI-Pixaroma",
        },
        "widgets_values": [json.dumps({
            "text": text,
            "fontSize": 31,
            "fontFamily": "Arial",
            "fontColor": "#ffffff",
            "textAlign": "left",
            "backgroundColor": BRAND,
            "padding": 10,
            "borderRadius": 0,
            "opacity": 1,
            "fontWeight": "normal",
            "lineHeight": 1,
        })],
        **COL_LABEL,
    }


def subtitle_label(x, y, text):
    return {
        "id": _next_label_id(),
        "type": "PixaromaLabel",
        "pos": [x, y],
        "size": [643, 57],
        "flags": {"no_title": True},
        "order": 0,
        "mode": 0,
        "inputs": [],
        "outputs": [],
        "properties": {
            "cnr_id": "ComfyUI-Pixaroma",
            "Node name for S&R": "PixaromaLabel",
            "aux_id": "pixaroma/ComfyUI-Pixaroma",
        },
        "widgets_values": [json.dumps({
            "text": text,
            "fontSize": 13,
            "fontFamily": "Arial",
            "fontColor": "#c0c0c0",
            "textAlign": "left",
            "backgroundColor": "#333333",
            "padding": 10,
            "borderRadius": 0,
            "opacity": 1,
            "fontWeight": "normal",
            "lineHeight": 1.4,
        })],
        **COL_LABEL,
    }


def make_node(nid, ntype, pos, size, **kw):
    n = {
        "id": nid,
        "type": ntype,
        "pos": list(pos),
        "size": list(size),
        "flags": {},
        "order": 0,
        "mode": 0,
        "inputs": [],
        "outputs": [],
        "properties": {
            "cnr_id": "comfy-core",
            "ver": "0.3.76",
            "Node name for S&R": ntype,
        },
        "widgets_values": [],
        **COL_PROC,
    }
    for k, v in kw.items():
        n[k] = v
    return n


def build_workflow_1_basic():
    """2 scenes sharing UNET/CLIP/VAE/ModelSamplingAuraFlow/EmptySD3LatentImage.
    Demos basic mute + refcount: toggle one row OFF -> only that scene's
    private nodes grey out. Toggle both OFF -> shared loaders grey out too.
    """
    nodes = []
    links = []
    next_link = [1]

    def new_link(from_id, from_slot, to_id, to_slot, ltype):
        lid = next_link[0]
        next_link[0] += 1
        links.append([lid, from_id, from_slot, to_id, to_slot, ltype])
        return lid

    # Layout columns
    LOADER_X = -1100
    SHARED_X = -550   # CLIP + LATENT shared column
    SCENE1_X = 100
    SCENE2_X = 100
    SCENE1_Y = 350
    SCENE2_Y = 1050
    SWITCH_X = 1400

    # ── Header ───────────────────────────────────────────────────────────
    nodes.append(title_label(LOADER_X, 40, 700, "Mute Switch - Basic Test"))
    nodes.append(subtitle_label(LOADER_X, 91,
        "Click Run: both scenes generate. Click the toggle on row 2, then Run: only the cat appears.\n"
        "Only the KSampler greys out - upstream nodes that nothing else needs are skipped automatically."))

    # ── Shared loaders (left column) ─────────────────────────────────────
    unet = make_node(101, "UNETLoader", (LOADER_X, 250), (495, 82), **COL_LOADER)
    unet["outputs"] = [{"name": "MODEL", "type": "MODEL", "links": []}]
    unet["widgets_values"] = ["z-image\\z-image-turbo_fp8_scaled_e5m2_KJ.safetensors", "default"]
    nodes.append(unet)

    clip = make_node(102, "CLIPLoader", (LOADER_X, 380), (460, 106), **COL_LOADER)
    clip["outputs"] = [{"name": "CLIP", "type": "CLIP", "links": []}]
    clip["widgets_values"] = ["qwen_3_4b_fp8_mixed.safetensors", "lumina2", "default"]
    nodes.append(clip)

    vae = make_node(103, "VAELoader", (LOADER_X, 540), (270, 58), **COL_LOADER)
    vae["outputs"] = [{"name": "VAE", "type": "VAE", "links": []}]
    vae["widgets_values"] = ["ae.safetensors"]
    nodes.append(vae)

    # ModelSamplingAuraFlow - shared between scenes
    msaf = make_node(104, "ModelSamplingAuraFlow", (LOADER_X, 660), (270, 58))
    msaf["inputs"] = [{"name": "model", "type": "MODEL", "link": None}]
    msaf["outputs"] = [{"name": "MODEL", "type": "MODEL", "links": []}]
    msaf["widgets_values"] = [3]
    nodes.append(msaf)

    # EmptySD3LatentImage - shared
    latent = make_node(105, "EmptySD3LatentImage", (LOADER_X, 760), (270, 108), **COL_LATENT)
    latent["outputs"] = [{"name": "LATENT", "type": "LATENT", "links": []}]
    latent["widgets_values"] = [1024, 1024, 1]
    nodes.append(latent)

    # Wire UNET -> ModelSamplingAuraFlow
    link_unet_msaf = new_link(101, 0, 104, 0, "MODEL")
    unet["outputs"][0]["links"].append(link_unet_msaf)
    msaf["inputs"][0]["link"] = link_unet_msaf

    # ── Build a scene (CLIPTextEncode + ConditioningZeroOut + KSampler + VAEDecode + PixaromaPreview) ──
    def add_scene(name, base_id, x, y, prompt, seed):
        # CLIPTextEncode (positive)
        cte_id = base_id
        cte = make_node(cte_id, "CLIPTextEncode", (x, y), (425, 200), **COL_POS)
        cte["inputs"] = [{"name": "clip", "type": "CLIP", "link": None}]
        cte["outputs"] = [{"name": "CONDITIONING", "type": "CONDITIONING", "links": []}]
        cte["widgets_values"] = [prompt]
        nodes.append(cte)

        # ConditioningZeroOut
        czo_id = base_id + 1
        czo = make_node(czo_id, "ConditioningZeroOut", (x, y + 230), (200, 26))
        czo["inputs"] = [{"name": "conditioning", "type": "CONDITIONING", "link": None}]
        czo["outputs"] = [{"name": "CONDITIONING", "type": "CONDITIONING", "links": []}]
        nodes.append(czo)

        # KSampler
        ks_id = base_id + 2
        ks = make_node(ks_id, "KSampler", (x + 460, y), (270, 262))
        ks["inputs"] = [
            {"name": "model", "type": "MODEL", "link": None},
            {"name": "positive", "type": "CONDITIONING", "link": None},
            {"name": "negative", "type": "CONDITIONING", "link": None},
            {"name": "latent_image", "type": "LATENT", "link": None},
        ]
        ks["outputs"] = [{"name": "LATENT", "type": "LATENT", "links": []}]
        ks["widgets_values"] = [seed, "fixed", 5, 1, "dpmpp_sde", "beta", 1]
        nodes.append(ks)

        # VAEDecode
        vd_id = base_id + 3
        vd = make_node(vd_id, "VAEDecode", (x + 760, y), (140, 46))
        vd["inputs"] = [
            {"name": "samples", "type": "LATENT", "link": None},
            {"name": "vae", "type": "VAE", "link": None},
        ]
        vd["outputs"] = [{"name": "IMAGE", "type": "IMAGE", "links": []}]
        nodes.append(vd)

        # PixaromaPreview
        pp_id = base_id + 4
        pp = make_node(pp_id, "PixaromaPreview", (x + 920, y), (340, 400))
        pp["properties"] = {
            "cnr_id": "ComfyUI-Pixaroma",
            "Node name for S&R": "PixaromaPreview",
        }
        pp["inputs"] = [{"name": "image", "type": "IMAGE", "link": None}]
        pp["outputs"] = [{"name": "image", "type": "IMAGE", "links": []}]
        pp["widgets_values"] = ["img", "preview"]
        nodes.append(pp)

        # ── Wire the scene ────────────────────────────────────────────
        # CLIP -> CTE
        l = new_link(102, 0, cte_id, 0, "CLIP")
        clip["outputs"][0]["links"].append(l)
        cte["inputs"][0]["link"] = l

        # CTE -> ConditioningZeroOut
        l = new_link(cte_id, 0, czo_id, 0, "CONDITIONING")
        cte["outputs"][0]["links"].append(l)
        czo["inputs"][0]["link"] = l

        # CTE -> KSampler.positive
        l = new_link(cte_id, 0, ks_id, 1, "CONDITIONING")
        cte["outputs"][0]["links"].append(l)
        ks["inputs"][1]["link"] = l

        # ModelSamplingAuraFlow -> KSampler.model
        l = new_link(104, 0, ks_id, 0, "MODEL")
        msaf["outputs"][0]["links"].append(l)
        ks["inputs"][0]["link"] = l

        # ConditioningZeroOut -> KSampler.negative
        l = new_link(czo_id, 0, ks_id, 2, "CONDITIONING")
        czo["outputs"][0]["links"].append(l)
        ks["inputs"][2]["link"] = l

        # Latent -> KSampler.latent_image
        l = new_link(105, 0, ks_id, 3, "LATENT")
        latent["outputs"][0]["links"].append(l)
        ks["inputs"][3]["link"] = l

        # KSampler -> VAEDecode.samples
        l = new_link(ks_id, 0, vd_id, 0, "LATENT")
        ks["outputs"][0]["links"].append(l)
        vd["inputs"][0]["link"] = l

        # VAE -> VAEDecode.vae
        l = new_link(103, 0, vd_id, 1, "VAE")
        vae["outputs"][0]["links"].append(l)
        vd["inputs"][1]["link"] = l

        # VAEDecode -> PixaromaPreview
        l = new_link(vd_id, 0, pp_id, 0, "IMAGE")
        vd["outputs"][0]["links"].append(l)
        pp["inputs"][0]["link"] = l

        return ks_id  # caller wires KSampler into Mute Switch

    ks1_id = add_scene("Scene 1", 200, SCENE1_X, SCENE1_Y,
                       "a cute orange tabby cat sitting in a sunlit window, photorealistic, detailed fur, soft natural light",
                       111111)
    ks2_id = add_scene("Scene 2", 300, SCENE2_X, SCENE2_Y,
                       "a happy golden retriever puppy running through a field of wildflowers, sunny day, depth of field",
                       222222)

    # ── Mute Switch Pixaroma ─────────────────────────────────────────────
    ms_id = 400
    ms = {
        "id": ms_id,
        "type": "PixaromaMuteSwitch",
        "pos": [SWITCH_X, SCENE1_Y + 150],
        "size": [280, 110],
        "flags": {},
        "order": 0,
        "mode": 0,
        "inputs": [
            {"name": "input_1", "type": "*", "link": None, "label": "​", "pos": [10, 42]},
            {"name": "input_2", "type": "*", "link": None, "label": "​", "pos": [10, 62]},
            {"name": "input_3", "type": "*", "link": None, "label": "​", "pos": [10, 82]},
        ],
        "outputs": [],
        "properties": {
            "cnr_id": "ComfyUI-Pixaroma",
            "Node name for S&R": "PixaromaMuteSwitch",
            "muteSwitchState": {
                "version": 1,
                "selectMode": "multi",
                "muteMode": "mute",
                "rows": [
                    {"enabled": True, "label": "Scene 1 (cat)"},
                    {"enabled": True, "label": "Scene 2 (dog)"},
                    {"enabled": True, "label": None},
                ],
            },
            "muteSwitchOriginalModes": {},
        },
        "widgets_values": [],
        **COL_PROC,
    }
    nodes.append(ms)

    # Wire KSamplers into Mute Switch
    l = new_link(ks1_id, 0, ms_id, 0, "*")
    next(n for n in nodes if n["id"] == ks1_id)["outputs"][0]["links"].append(l)
    ms["inputs"][0]["link"] = l

    l = new_link(ks2_id, 0, ms_id, 1, "*")
    next(n for n in nodes if n["id"] == ks2_id)["outputs"][0]["links"].append(l)
    ms["inputs"][1]["link"] = l

    return _assemble(nodes, links)


def build_workflow_2_modes():
    """3 mini-scenes wired into Mute Switch.
    Demos the Single vs Multi pill toggle.
    Scenes are minimal: shared loaders, 3 different prompts.
    """
    nodes = []
    links = []
    next_link = [1]

    def new_link(from_id, from_slot, to_id, to_slot, ltype):
        lid = next_link[0]
        next_link[0] += 1
        links.append([lid, from_id, from_slot, to_id, to_slot, ltype])
        return lid

    LOADER_X = -1100
    SCENE_X = 100
    SWITCH_X = 1400
    Y_STEP = 600

    nodes.append(title_label(LOADER_X, 40, 800, "Mute Switch - Single vs Multi"))
    nodes.append(subtitle_label(LOADER_X, 91,
        "Three scenes wired in. Multi mode: all three are ON, all run. Click Multi to switch to Single:\n"
        "only one row stays ON (like radio buttons). Click a different row in Single to swap which is active."))

    # Shared loaders
    unet = make_node(101, "UNETLoader", (LOADER_X, 250), (495, 82), **COL_LOADER)
    unet["outputs"] = [{"name": "MODEL", "type": "MODEL", "links": []}]
    unet["widgets_values"] = ["z-image\\z-image-turbo_fp8_scaled_e5m2_KJ.safetensors", "default"]
    nodes.append(unet)

    clip = make_node(102, "CLIPLoader", (LOADER_X, 380), (460, 106), **COL_LOADER)
    clip["outputs"] = [{"name": "CLIP", "type": "CLIP", "links": []}]
    clip["widgets_values"] = ["qwen_3_4b_fp8_mixed.safetensors", "lumina2", "default"]
    nodes.append(clip)

    vae = make_node(103, "VAELoader", (LOADER_X, 540), (270, 58), **COL_LOADER)
    vae["outputs"] = [{"name": "VAE", "type": "VAE", "links": []}]
    vae["widgets_values"] = ["ae.safetensors"]
    nodes.append(vae)

    msaf = make_node(104, "ModelSamplingAuraFlow", (LOADER_X, 660), (270, 58))
    msaf["inputs"] = [{"name": "model", "type": "MODEL", "link": None}]
    msaf["outputs"] = [{"name": "MODEL", "type": "MODEL", "links": []}]
    msaf["widgets_values"] = [3]
    nodes.append(msaf)

    latent = make_node(105, "EmptySD3LatentImage", (LOADER_X, 760), (270, 108), **COL_LATENT)
    latent["outputs"] = [{"name": "LATENT", "type": "LATENT", "links": []}]
    latent["widgets_values"] = [1024, 1024, 1]
    nodes.append(latent)

    l = new_link(101, 0, 104, 0, "MODEL")
    unet["outputs"][0]["links"].append(l)
    msaf["inputs"][0]["link"] = l

    def add_scene(base_id, y, prompt, seed):
        cte = make_node(base_id, "CLIPTextEncode", (SCENE_X, y), (425, 200), **COL_POS)
        cte["inputs"] = [{"name": "clip", "type": "CLIP", "link": None}]
        cte["outputs"] = [{"name": "CONDITIONING", "type": "CONDITIONING", "links": []}]
        cte["widgets_values"] = [prompt]
        nodes.append(cte)

        czo = make_node(base_id + 1, "ConditioningZeroOut", (SCENE_X, y + 230), (200, 26))
        czo["inputs"] = [{"name": "conditioning", "type": "CONDITIONING", "link": None}]
        czo["outputs"] = [{"name": "CONDITIONING", "type": "CONDITIONING", "links": []}]
        nodes.append(czo)

        ks = make_node(base_id + 2, "KSampler", (SCENE_X + 460, y), (270, 262))
        ks["inputs"] = [
            {"name": "model", "type": "MODEL", "link": None},
            {"name": "positive", "type": "CONDITIONING", "link": None},
            {"name": "negative", "type": "CONDITIONING", "link": None},
            {"name": "latent_image", "type": "LATENT", "link": None},
        ]
        ks["outputs"] = [{"name": "LATENT", "type": "LATENT", "links": []}]
        ks["widgets_values"] = [seed, "fixed", 5, 1, "dpmpp_sde", "beta", 1]
        nodes.append(ks)

        vd = make_node(base_id + 3, "VAEDecode", (SCENE_X + 760, y), (140, 46))
        vd["inputs"] = [
            {"name": "samples", "type": "LATENT", "link": None},
            {"name": "vae", "type": "VAE", "link": None},
        ]
        vd["outputs"] = [{"name": "IMAGE", "type": "IMAGE", "links": []}]
        nodes.append(vd)

        pp = make_node(base_id + 4, "PixaromaPreview", (SCENE_X + 920, y), (340, 400))
        pp["properties"] = {"cnr_id": "ComfyUI-Pixaroma", "Node name for S&R": "PixaromaPreview"}
        pp["inputs"] = [{"name": "image", "type": "IMAGE", "link": None}]
        pp["outputs"] = [{"name": "image", "type": "IMAGE", "links": []}]
        pp["widgets_values"] = ["img", "preview"]
        nodes.append(pp)

        l = new_link(102, 0, base_id, 0, "CLIP")
        clip["outputs"][0]["links"].append(l)
        cte["inputs"][0]["link"] = l

        l = new_link(base_id, 0, base_id + 1, 0, "CONDITIONING")
        cte["outputs"][0]["links"].append(l)
        czo["inputs"][0]["link"] = l

        l = new_link(base_id, 0, base_id + 2, 1, "CONDITIONING")
        cte["outputs"][0]["links"].append(l)
        ks["inputs"][1]["link"] = l

        l = new_link(104, 0, base_id + 2, 0, "MODEL")
        msaf["outputs"][0]["links"].append(l)
        ks["inputs"][0]["link"] = l

        l = new_link(base_id + 1, 0, base_id + 2, 2, "CONDITIONING")
        czo["outputs"][0]["links"].append(l)
        ks["inputs"][2]["link"] = l

        l = new_link(105, 0, base_id + 2, 3, "LATENT")
        latent["outputs"][0]["links"].append(l)
        ks["inputs"][3]["link"] = l

        l = new_link(base_id + 2, 0, base_id + 3, 0, "LATENT")
        ks["outputs"][0]["links"].append(l)
        vd["inputs"][0]["link"] = l

        l = new_link(103, 0, base_id + 3, 1, "VAE")
        vae["outputs"][0]["links"].append(l)
        vd["inputs"][1]["link"] = l

        l = new_link(base_id + 3, 0, base_id + 4, 0, "IMAGE")
        vd["outputs"][0]["links"].append(l)
        pp["inputs"][0]["link"] = l

        return base_id + 2  # KSampler id

    ks1 = add_scene(200, 350, "a cute cat", 111)
    ks2 = add_scene(300, 1050, "a happy dog", 222)
    ks3 = add_scene(400, 1750, "a colorful parrot", 333)

    # Mute Switch with 3 wired rows
    ms_id = 500
    ms = {
        "id": ms_id,
        "type": "PixaromaMuteSwitch",
        "pos": [SWITCH_X, 700],
        "size": [280, 130],
        "flags": {},
        "order": 0,
        "mode": 0,
        "inputs": [
            {"name": "input_1", "type": "*", "link": None, "label": "​", "pos": [10, 42]},
            {"name": "input_2", "type": "*", "link": None, "label": "​", "pos": [10, 62]},
            {"name": "input_3", "type": "*", "link": None, "label": "​", "pos": [10, 82]},
            {"name": "input_4", "type": "*", "link": None, "label": "​", "pos": [10, 102]},
        ],
        "outputs": [],
        "properties": {
            "cnr_id": "ComfyUI-Pixaroma",
            "Node name for S&R": "PixaromaMuteSwitch",
            "muteSwitchState": {
                "version": 1,
                "selectMode": "multi",
                "muteMode": "mute",
                "rows": [
                    {"enabled": True, "label": "Cat"},
                    {"enabled": True, "label": "Dog"},
                    {"enabled": True, "label": "Parrot"},
                    {"enabled": True, "label": None},
                ],
            },
            "muteSwitchOriginalModes": {},
        },
        "widgets_values": [],
        **COL_PROC,
    }
    nodes.append(ms)

    for i, ks_id in enumerate([ks1, ks2, ks3]):
        l = new_link(ks_id, 0, ms_id, i, "*")
        next(n for n in nodes if n["id"] == ks_id)["outputs"][0]["links"].append(l)
        ms["inputs"][i]["link"] = l

    return _assemble(nodes, links)


def build_workflow_3_mute_vs_bypass():
    """Same shape as workflow 1 but the subtitle focuses on Mute vs Bypass."""
    nodes = []
    links = []
    next_link = [1]

    def new_link(from_id, from_slot, to_id, to_slot, ltype):
        lid = next_link[0]
        next_link[0] += 1
        links.append([lid, from_id, from_slot, to_id, to_slot, ltype])
        return lid

    LOADER_X = -1100
    SCENE_X = 100
    SWITCH_X = 1400
    SCENE1_Y = 350
    SCENE2_Y = 1050

    nodes.append(title_label(LOADER_X, 40, 800, "Mute Switch - Mute vs Bypass"))
    nodes.append(subtitle_label(LOADER_X, 91,
        "Click row 2 OFF: scene 2 nodes turn solid grey (Mute = the scene does not run).\n"
        "Now click the Mute pill to switch to Bypass: the same nodes show a different visual (pass-through)."))

    unet = make_node(101, "UNETLoader", (LOADER_X, 250), (495, 82), **COL_LOADER)
    unet["outputs"] = [{"name": "MODEL", "type": "MODEL", "links": []}]
    unet["widgets_values"] = ["z-image\\z-image-turbo_fp8_scaled_e5m2_KJ.safetensors", "default"]
    nodes.append(unet)

    clip = make_node(102, "CLIPLoader", (LOADER_X, 380), (460, 106), **COL_LOADER)
    clip["outputs"] = [{"name": "CLIP", "type": "CLIP", "links": []}]
    clip["widgets_values"] = ["qwen_3_4b_fp8_mixed.safetensors", "lumina2", "default"]
    nodes.append(clip)

    vae = make_node(103, "VAELoader", (LOADER_X, 540), (270, 58), **COL_LOADER)
    vae["outputs"] = [{"name": "VAE", "type": "VAE", "links": []}]
    vae["widgets_values"] = ["ae.safetensors"]
    nodes.append(vae)

    msaf = make_node(104, "ModelSamplingAuraFlow", (LOADER_X, 660), (270, 58))
    msaf["inputs"] = [{"name": "model", "type": "MODEL", "link": None}]
    msaf["outputs"] = [{"name": "MODEL", "type": "MODEL", "links": []}]
    msaf["widgets_values"] = [3]
    nodes.append(msaf)

    latent = make_node(105, "EmptySD3LatentImage", (LOADER_X, 760), (270, 108), **COL_LATENT)
    latent["outputs"] = [{"name": "LATENT", "type": "LATENT", "links": []}]
    latent["widgets_values"] = [1024, 1024, 1]
    nodes.append(latent)

    l = new_link(101, 0, 104, 0, "MODEL")
    unet["outputs"][0]["links"].append(l)
    msaf["inputs"][0]["link"] = l

    def add_scene(base_id, y, prompt, seed):
        cte = make_node(base_id, "CLIPTextEncode", (SCENE_X, y), (425, 200), **COL_POS)
        cte["inputs"] = [{"name": "clip", "type": "CLIP", "link": None}]
        cte["outputs"] = [{"name": "CONDITIONING", "type": "CONDITIONING", "links": []}]
        cte["widgets_values"] = [prompt]
        nodes.append(cte)

        czo = make_node(base_id + 1, "ConditioningZeroOut", (SCENE_X, y + 230), (200, 26))
        czo["inputs"] = [{"name": "conditioning", "type": "CONDITIONING", "link": None}]
        czo["outputs"] = [{"name": "CONDITIONING", "type": "CONDITIONING", "links": []}]
        nodes.append(czo)

        ks = make_node(base_id + 2, "KSampler", (SCENE_X + 460, y), (270, 262))
        ks["inputs"] = [
            {"name": "model", "type": "MODEL", "link": None},
            {"name": "positive", "type": "CONDITIONING", "link": None},
            {"name": "negative", "type": "CONDITIONING", "link": None},
            {"name": "latent_image", "type": "LATENT", "link": None},
        ]
        ks["outputs"] = [{"name": "LATENT", "type": "LATENT", "links": []}]
        ks["widgets_values"] = [seed, "fixed", 5, 1, "dpmpp_sde", "beta", 1]
        nodes.append(ks)

        vd = make_node(base_id + 3, "VAEDecode", (SCENE_X + 760, y), (140, 46))
        vd["inputs"] = [
            {"name": "samples", "type": "LATENT", "link": None},
            {"name": "vae", "type": "VAE", "link": None},
        ]
        vd["outputs"] = [{"name": "IMAGE", "type": "IMAGE", "links": []}]
        nodes.append(vd)

        pp = make_node(base_id + 4, "PixaromaPreview", (SCENE_X + 920, y), (340, 400))
        pp["properties"] = {"cnr_id": "ComfyUI-Pixaroma", "Node name for S&R": "PixaromaPreview"}
        pp["inputs"] = [{"name": "image", "type": "IMAGE", "link": None}]
        pp["outputs"] = [{"name": "image", "type": "IMAGE", "links": []}]
        pp["widgets_values"] = ["img", "preview"]
        nodes.append(pp)

        l = new_link(102, 0, base_id, 0, "CLIP")
        clip["outputs"][0]["links"].append(l)
        cte["inputs"][0]["link"] = l
        l = new_link(base_id, 0, base_id + 1, 0, "CONDITIONING")
        cte["outputs"][0]["links"].append(l)
        czo["inputs"][0]["link"] = l
        l = new_link(base_id, 0, base_id + 2, 1, "CONDITIONING")
        cte["outputs"][0]["links"].append(l)
        ks["inputs"][1]["link"] = l
        l = new_link(104, 0, base_id + 2, 0, "MODEL")
        msaf["outputs"][0]["links"].append(l)
        ks["inputs"][0]["link"] = l
        l = new_link(base_id + 1, 0, base_id + 2, 2, "CONDITIONING")
        czo["outputs"][0]["links"].append(l)
        ks["inputs"][2]["link"] = l
        l = new_link(105, 0, base_id + 2, 3, "LATENT")
        latent["outputs"][0]["links"].append(l)
        ks["inputs"][3]["link"] = l
        l = new_link(base_id + 2, 0, base_id + 3, 0, "LATENT")
        ks["outputs"][0]["links"].append(l)
        vd["inputs"][0]["link"] = l
        l = new_link(103, 0, base_id + 3, 1, "VAE")
        vae["outputs"][0]["links"].append(l)
        vd["inputs"][1]["link"] = l
        l = new_link(base_id + 3, 0, base_id + 4, 0, "IMAGE")
        vd["outputs"][0]["links"].append(l)
        pp["inputs"][0]["link"] = l

        return base_id + 2

    ks1 = add_scene(200, SCENE1_Y, "a serene mountain landscape at sunrise", 111)
    ks2 = add_scene(300, SCENE2_Y, "a stormy ocean with crashing waves", 222)

    ms_id = 400
    ms = {
        "id": ms_id,
        "type": "PixaromaMuteSwitch",
        "pos": [SWITCH_X, 700],
        "size": [280, 110],
        "flags": {},
        "order": 0,
        "mode": 0,
        "inputs": [
            {"name": "input_1", "type": "*", "link": None, "label": "​", "pos": [10, 42]},
            {"name": "input_2", "type": "*", "link": None, "label": "​", "pos": [10, 62]},
            {"name": "input_3", "type": "*", "link": None, "label": "​", "pos": [10, 82]},
        ],
        "outputs": [],
        "properties": {
            "cnr_id": "ComfyUI-Pixaroma",
            "Node name for S&R": "PixaromaMuteSwitch",
            "muteSwitchState": {
                "version": 1,
                "selectMode": "multi",
                "muteMode": "mute",
                "rows": [
                    {"enabled": True, "label": "Mountains"},
                    {"enabled": True, "label": "Ocean"},
                    {"enabled": True, "label": None},
                ],
            },
            "muteSwitchOriginalModes": {},
        },
        "widgets_values": [],
        **COL_PROC,
    }
    nodes.append(ms)

    for i, ks_id in enumerate([ks1, ks2]):
        l = new_link(ks_id, 0, ms_id, i, "*")
        next(n for n in nodes if n["id"] == ks_id)["outputs"][0]["links"].append(l)
        ms["inputs"][i]["link"] = l

    return _assemble(nodes, links)


def _assemble(nodes, links):
    last_node_id = max(n["id"] for n in nodes)
    last_link_id = max((lk[0] for lk in links), default=0)
    return {
        "id": str(uuid.uuid4()),
        "revision": 0,
        "last_node_id": last_node_id,
        "last_link_id": last_link_id,
        "nodes": nodes,
        "links": links,
        "groups": [],
        "config": {},
        "extra": {
            "ds": {"scale": 0.55, "offset": [200, 0]},
            "workflowRendererVersion": "LG",
            "frontendVersion": "1.43.18",
        },
        "version": 0.4,
    }


def overlap_check(workflow, name):
    TITLE_BAR = 30
    nodes = workflow["nodes"]
    def bbox(n):
        is_label = n["type"] == "PixaromaLabel"
        tb = 0 if is_label else TITLE_BAR
        x0, y0 = n["pos"]
        w, h = n["size"]
        return (x0, y0 - tb, x0 + w, y0 + h)
    overlaps = []
    for i in range(len(nodes)):
        for j in range(i + 1, len(nodes)):
            a, b = bbox(nodes[i]), bbox(nodes[j])
            if max(a[0], b[0]) < min(a[2], b[2]) and max(a[1], b[1]) < min(a[3], b[3]):
                overlaps.append((nodes[i]["type"], nodes[j]["type"]))
    print(f"{name}: overlap check =", "CLEAN" if not overlaps else overlaps)


def write(workflow, name):
    path = os.path.join(OUT_DIR, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(workflow, f, indent=2)
    print(f"Wrote {path}")


w1 = build_workflow_1_basic()
overlap_check(w1, "01 - basic")
write(w1, "01 - Basic mute test.json")

w2 = build_workflow_2_modes()
overlap_check(w2, "02 - modes")
write(w2, "02 - Single vs Multi modes.json")

w3 = build_workflow_3_mute_vs_bypass()
overlap_check(w3, "03 - mute vs bypass")
write(w3, "03 - Mute vs Bypass.json")


def build_workflow_4_chaining():
    """Demonstrates Mute Switch chaining.
    Two inner switches each control a pair of scenes. One outer switch
    selects between the two inner switches in Single mode.
    Toggling the outer switch's active row cascades: muting an inner switch
    also mutes every node wired into it.
    """
    nodes = []
    links = []
    next_link = [1]

    def new_link(from_id, from_slot, to_id, to_slot, ltype):
        lid = next_link[0]
        next_link[0] += 1
        links.append([lid, from_id, from_slot, to_id, to_slot, ltype])
        return lid

    LOADER_X = -1300
    SCENE_X = 200
    INNER_SWITCH_X = 1500
    OUTER_SWITCH_X = 1850

    nodes.append(title_label(LOADER_X, 40, 950, "Mute Switch - Chaining (groups of scenes)"))
    nodes.append(subtitle_label(LOADER_X, 91,
        "Outer switch picks a GROUP. Switch in Single mode: only one group's two scenes run.\n"
        "Toggle row 1 vs row 2 on the outer switch to swap which group is active. Inner switches let you fine-tune."))

    # ── Shared loaders ───────────────────────────────────────────────────
    unet = make_node(101, "UNETLoader", (LOADER_X, 250), (495, 82), **COL_LOADER)
    unet["outputs"] = [{"name": "MODEL", "type": "MODEL", "links": []}]
    unet["widgets_values"] = ["z-image\\z-image-turbo_fp8_scaled_e5m2_KJ.safetensors", "default"]
    nodes.append(unet)

    clip = make_node(102, "CLIPLoader", (LOADER_X, 380), (460, 106), **COL_LOADER)
    clip["outputs"] = [{"name": "CLIP", "type": "CLIP", "links": []}]
    clip["widgets_values"] = ["qwen_3_4b_fp8_mixed.safetensors", "lumina2", "default"]
    nodes.append(clip)

    vae = make_node(103, "VAELoader", (LOADER_X, 540), (270, 58), **COL_LOADER)
    vae["outputs"] = [{"name": "VAE", "type": "VAE", "links": []}]
    vae["widgets_values"] = ["ae.safetensors"]
    nodes.append(vae)

    msaf = make_node(104, "ModelSamplingAuraFlow", (LOADER_X, 660), (270, 58))
    msaf["inputs"] = [{"name": "model", "type": "MODEL", "link": None}]
    msaf["outputs"] = [{"name": "MODEL", "type": "MODEL", "links": []}]
    msaf["widgets_values"] = [3]
    nodes.append(msaf)

    latent = make_node(105, "EmptySD3LatentImage", (LOADER_X, 760), (270, 108), **COL_LATENT)
    latent["outputs"] = [{"name": "LATENT", "type": "LATENT", "links": []}]
    latent["widgets_values"] = [1024, 1024, 1]
    nodes.append(latent)

    l = new_link(101, 0, 104, 0, "MODEL")
    unet["outputs"][0]["links"].append(l)
    msaf["inputs"][0]["link"] = l

    def add_scene(base_id, y, prompt, seed):
        cte = make_node(base_id, "CLIPTextEncode", (SCENE_X, y), (425, 200), **COL_POS)
        cte["inputs"] = [{"name": "clip", "type": "CLIP", "link": None}]
        cte["outputs"] = [{"name": "CONDITIONING", "type": "CONDITIONING", "links": []}]
        cte["widgets_values"] = [prompt]
        nodes.append(cte)

        czo = make_node(base_id + 1, "ConditioningZeroOut", (SCENE_X, y + 230), (200, 26))
        czo["inputs"] = [{"name": "conditioning", "type": "CONDITIONING", "link": None}]
        czo["outputs"] = [{"name": "CONDITIONING", "type": "CONDITIONING", "links": []}]
        nodes.append(czo)

        ks = make_node(base_id + 2, "KSampler", (SCENE_X + 460, y), (270, 262))
        ks["inputs"] = [
            {"name": "model", "type": "MODEL", "link": None},
            {"name": "positive", "type": "CONDITIONING", "link": None},
            {"name": "negative", "type": "CONDITIONING", "link": None},
            {"name": "latent_image", "type": "LATENT", "link": None},
        ]
        ks["outputs"] = [{"name": "LATENT", "type": "LATENT", "links": []}]
        ks["widgets_values"] = [seed, "fixed", 5, 1, "dpmpp_sde", "beta", 1]
        nodes.append(ks)

        vd = make_node(base_id + 3, "VAEDecode", (SCENE_X + 760, y), (140, 46))
        vd["inputs"] = [
            {"name": "samples", "type": "LATENT", "link": None},
            {"name": "vae", "type": "VAE", "link": None},
        ]
        vd["outputs"] = [{"name": "IMAGE", "type": "IMAGE", "links": []}]
        nodes.append(vd)

        pp = make_node(base_id + 4, "PixaromaPreview", (SCENE_X + 920, y), (340, 400))
        pp["properties"] = {"cnr_id": "ComfyUI-Pixaroma", "Node name for S&R": "PixaromaPreview"}
        pp["inputs"] = [{"name": "image", "type": "IMAGE", "link": None}]
        pp["outputs"] = [{"name": "image", "type": "IMAGE", "links": []}]
        pp["widgets_values"] = ["img", "preview"]
        nodes.append(pp)

        l = new_link(102, 0, base_id, 0, "CLIP"); clip["outputs"][0]["links"].append(l); cte["inputs"][0]["link"] = l
        l = new_link(base_id, 0, base_id + 1, 0, "CONDITIONING"); cte["outputs"][0]["links"].append(l); czo["inputs"][0]["link"] = l
        l = new_link(base_id, 0, base_id + 2, 1, "CONDITIONING"); cte["outputs"][0]["links"].append(l); ks["inputs"][1]["link"] = l
        l = new_link(104, 0, base_id + 2, 0, "MODEL"); msaf["outputs"][0]["links"].append(l); ks["inputs"][0]["link"] = l
        l = new_link(base_id + 1, 0, base_id + 2, 2, "CONDITIONING"); czo["outputs"][0]["links"].append(l); ks["inputs"][2]["link"] = l
        l = new_link(105, 0, base_id + 2, 3, "LATENT"); latent["outputs"][0]["links"].append(l); ks["inputs"][3]["link"] = l
        l = new_link(base_id + 2, 0, base_id + 3, 0, "LATENT"); ks["outputs"][0]["links"].append(l); vd["inputs"][0]["link"] = l
        l = new_link(103, 0, base_id + 3, 1, "VAE"); vae["outputs"][0]["links"].append(l); vd["inputs"][1]["link"] = l
        l = new_link(base_id + 3, 0, base_id + 4, 0, "IMAGE"); vd["outputs"][0]["links"].append(l); pp["inputs"][0]["link"] = l

        return base_id + 2  # KSampler id

    # Group A: cat + dog
    ksA1 = add_scene(200, 350,  "a cute orange cat sitting in sunlight", 1111)
    ksA2 = add_scene(300, 1050, "a happy golden retriever puppy", 2222)
    # Group B: mountain + ocean
    ksB1 = add_scene(400, 1750, "a serene mountain landscape at sunrise", 3333)
    ksB2 = add_scene(500, 2450, "a stormy ocean with crashing waves", 4444)

    # ── Inner switch A (group A) ─────────────────────────────────────────
    swA_id = 700
    swA = {
        "id": swA_id,
        "type": "PixaromaMuteSwitch",
        "pos": [INNER_SWITCH_X, 700],
        "size": [260, 110],
        "flags": {},
        "order": 0,
        "mode": 0,
        "inputs": [
            {"name": "input_1", "type": "*", "link": None, "label": "​", "pos": [10, 42]},
            {"name": "input_2", "type": "*", "link": None, "label": "​", "pos": [10, 62]},
            {"name": "input_3", "type": "*", "link": None, "label": "​", "pos": [10, 82]},
        ],
        "outputs": [],
        "properties": {
            "cnr_id": "ComfyUI-Pixaroma",
            "Node name for S&R": "PixaromaMuteSwitch",
            "muteSwitchState": {
                "version": 1,
                "selectMode": "multi",
                "muteMode": "mute",
                "rows": [
                    {"enabled": True, "label": "Cat"},
                    {"enabled": True, "label": "Dog"},
                    {"enabled": True, "label": None},
                ],
            },
            "muteSwitchOriginalModes": {},
        },
        "widgets_values": [],
        **COL_PROC,
    }
    nodes.append(swA)
    for i, ks_id in enumerate([ksA1, ksA2]):
        l = new_link(ks_id, 0, swA_id, i, "*")
        next(n for n in nodes if n["id"] == ks_id)["outputs"][0]["links"].append(l)
        swA["inputs"][i]["link"] = l

    # ── Inner switch B (group B) ─────────────────────────────────────────
    swB_id = 800
    swB = {
        "id": swB_id,
        "type": "PixaromaMuteSwitch",
        "pos": [INNER_SWITCH_X, 2100],
        "size": [260, 110],
        "flags": {},
        "order": 0,
        "mode": 0,
        "inputs": [
            {"name": "input_1", "type": "*", "link": None, "label": "​", "pos": [10, 42]},
            {"name": "input_2", "type": "*", "link": None, "label": "​", "pos": [10, 62]},
            {"name": "input_3", "type": "*", "link": None, "label": "​", "pos": [10, 82]},
        ],
        "outputs": [],
        "properties": {
            "cnr_id": "ComfyUI-Pixaroma",
            "Node name for S&R": "PixaromaMuteSwitch",
            "muteSwitchState": {
                "version": 1,
                "selectMode": "multi",
                "muteMode": "mute",
                "rows": [
                    {"enabled": True, "label": "Mountain"},
                    {"enabled": True, "label": "Ocean"},
                    {"enabled": True, "label": None},
                ],
            },
            "muteSwitchOriginalModes": {},
        },
        "widgets_values": [],
        **COL_PROC,
    }
    nodes.append(swB)
    for i, ks_id in enumerate([ksB1, ksB2]):
        l = new_link(ks_id, 0, swB_id, i, "*")
        next(n for n in nodes if n["id"] == ks_id)["outputs"][0]["links"].append(l)
        swB["inputs"][i]["link"] = l

    # ── Outer switch (Single mode, picks group A or group B) ────────────
    outer_id = 900
    outer = {
        "id": outer_id,
        "type": "PixaromaMuteSwitch",
        "pos": [OUTER_SWITCH_X, 1400],
        "size": [260, 110],
        "flags": {},
        "order": 0,
        "mode": 0,
        "inputs": [
            {"name": "input_1", "type": "*", "link": None, "label": "​", "pos": [10, 42]},
            {"name": "input_2", "type": "*", "link": None, "label": "​", "pos": [10, 62]},
            {"name": "input_3", "type": "*", "link": None, "label": "​", "pos": [10, 82]},
        ],
        "outputs": [],
        "properties": {
            "cnr_id": "ComfyUI-Pixaroma",
            "Node name for S&R": "PixaromaMuteSwitch",
            "muteSwitchState": {
                "version": 1,
                "selectMode": "single",
                "muteMode": "mute",
                "rows": [
                    {"enabled": True, "label": "Group A (animals)"},
                    {"enabled": False, "label": "Group B (landscapes)"},
                    {"enabled": False, "label": None},
                ],
            },
            "muteSwitchOriginalModes": {},
        },
        "widgets_values": [],
        **COL_PROC,
    }
    nodes.append(outer)

    # Wire inner switches into outer switch
    l = new_link(swA_id, -1, outer_id, 0, "*")
    # Note: Mute Switch has no real outputs (it's a terminal node). We still
    # need a link for the outer to "see" the inner. Use a fake output slot.
    # Actually we should not need an output - let's just create the link
    # entry but the outer switch's resolution walks inputs not outputs.
    # WAIT - this won't work. The outer switch resolves its rows by following
    # input links to the upstream node. The link[1] is the from_node id.
    # We need from_node=swA so the outer sees swA as upstream.
    # But swA has no outputs, so we can't create a real link from it.
    # Workaround: add a placeholder output on inner switches.
    pass  # link already added above; we just need swA to have an output slot

    return _assemble(nodes, links)


# Re-run to also include workflow 4 - but the chaining demo above needs a
# real output slot on the inner Mute Switches so the outer can wire them in.
# Given Mute Switch is a no-op terminal node, we add a dummy output slot to
# the inner switches just in this test workflow (the live Python node has no
# RETURN_TYPES, but the workflow JSON can still serialize a phantom output -
# it just won't be visible at runtime, which is fine because muting is JS-only).
# Cleaner approach: skip workflow 4 in code for now. The user can chain
# manually by deleting and re-wiring via the canvas.
# Removed the broken pass-through commit attempt above.
# Instead, build workflow 4 by giving inner switches a fake output slot.
def build_workflow_4_v2():
    nodes = []
    links = []
    next_link = [1]

    def new_link(from_id, from_slot, to_id, to_slot, ltype):
        lid = next_link[0]
        next_link[0] += 1
        links.append([lid, from_id, from_slot, to_id, to_slot, ltype])
        return lid

    LOADER_X = -1300
    SCENE_X = 200
    INNER_SWITCH_X = 1500
    OUTER_SWITCH_X = 1850

    nodes.append(title_label(LOADER_X, 40, 950, "Mute Switch - Chaining (groups of scenes)"))
    nodes.append(subtitle_label(LOADER_X, 91,
        "Outer switch picks a GROUP. Outer is in Single mode: only one group is active at a time.\n"
        "Toggle row 1 vs row 2 on the outer to swap groups. The inner switches let you fine-tune within a group."))

    unet = make_node(101, "UNETLoader", (LOADER_X, 250), (495, 82), **COL_LOADER)
    unet["outputs"] = [{"name": "MODEL", "type": "MODEL", "links": []}]
    unet["widgets_values"] = ["z-image\\z-image-turbo_fp8_scaled_e5m2_KJ.safetensors", "default"]
    nodes.append(unet)
    clip = make_node(102, "CLIPLoader", (LOADER_X, 380), (460, 106), **COL_LOADER)
    clip["outputs"] = [{"name": "CLIP", "type": "CLIP", "links": []}]
    clip["widgets_values"] = ["qwen_3_4b_fp8_mixed.safetensors", "lumina2", "default"]
    nodes.append(clip)
    vae = make_node(103, "VAELoader", (LOADER_X, 540), (270, 58), **COL_LOADER)
    vae["outputs"] = [{"name": "VAE", "type": "VAE", "links": []}]
    vae["widgets_values"] = ["ae.safetensors"]
    nodes.append(vae)
    msaf = make_node(104, "ModelSamplingAuraFlow", (LOADER_X, 660), (270, 58))
    msaf["inputs"] = [{"name": "model", "type": "MODEL", "link": None}]
    msaf["outputs"] = [{"name": "MODEL", "type": "MODEL", "links": []}]
    msaf["widgets_values"] = [3]
    nodes.append(msaf)
    latent = make_node(105, "EmptySD3LatentImage", (LOADER_X, 760), (270, 108), **COL_LATENT)
    latent["outputs"] = [{"name": "LATENT", "type": "LATENT", "links": []}]
    latent["widgets_values"] = [1024, 1024, 1]
    nodes.append(latent)

    l = new_link(101, 0, 104, 0, "MODEL")
    unet["outputs"][0]["links"].append(l)
    msaf["inputs"][0]["link"] = l

    def add_scene(base_id, y, prompt, seed):
        cte = make_node(base_id, "CLIPTextEncode", (SCENE_X, y), (425, 200), **COL_POS)
        cte["inputs"] = [{"name": "clip", "type": "CLIP", "link": None}]
        cte["outputs"] = [{"name": "CONDITIONING", "type": "CONDITIONING", "links": []}]
        cte["widgets_values"] = [prompt]
        nodes.append(cte)
        czo = make_node(base_id + 1, "ConditioningZeroOut", (SCENE_X, y + 230), (200, 26))
        czo["inputs"] = [{"name": "conditioning", "type": "CONDITIONING", "link": None}]
        czo["outputs"] = [{"name": "CONDITIONING", "type": "CONDITIONING", "links": []}]
        nodes.append(czo)
        ks = make_node(base_id + 2, "KSampler", (SCENE_X + 460, y), (270, 262))
        ks["inputs"] = [
            {"name": "model", "type": "MODEL", "link": None},
            {"name": "positive", "type": "CONDITIONING", "link": None},
            {"name": "negative", "type": "CONDITIONING", "link": None},
            {"name": "latent_image", "type": "LATENT", "link": None},
        ]
        ks["outputs"] = [{"name": "LATENT", "type": "LATENT", "links": []}]
        ks["widgets_values"] = [seed, "fixed", 5, 1, "dpmpp_sde", "beta", 1]
        nodes.append(ks)
        vd = make_node(base_id + 3, "VAEDecode", (SCENE_X + 760, y), (140, 46))
        vd["inputs"] = [
            {"name": "samples", "type": "LATENT", "link": None},
            {"name": "vae", "type": "VAE", "link": None},
        ]
        vd["outputs"] = [{"name": "IMAGE", "type": "IMAGE", "links": []}]
        nodes.append(vd)
        pp = make_node(base_id + 4, "PixaromaPreview", (SCENE_X + 920, y), (340, 400))
        pp["properties"] = {"cnr_id": "ComfyUI-Pixaroma", "Node name for S&R": "PixaromaPreview"}
        pp["inputs"] = [{"name": "image", "type": "IMAGE", "link": None}]
        pp["outputs"] = [{"name": "image", "type": "IMAGE", "links": []}]
        pp["widgets_values"] = ["img", "preview"]
        nodes.append(pp)

        l = new_link(102, 0, base_id, 0, "CLIP"); clip["outputs"][0]["links"].append(l); cte["inputs"][0]["link"] = l
        l = new_link(base_id, 0, base_id + 1, 0, "CONDITIONING"); cte["outputs"][0]["links"].append(l); czo["inputs"][0]["link"] = l
        l = new_link(base_id, 0, base_id + 2, 1, "CONDITIONING"); cte["outputs"][0]["links"].append(l); ks["inputs"][1]["link"] = l
        l = new_link(104, 0, base_id + 2, 0, "MODEL"); msaf["outputs"][0]["links"].append(l); ks["inputs"][0]["link"] = l
        l = new_link(base_id + 1, 0, base_id + 2, 2, "CONDITIONING"); czo["outputs"][0]["links"].append(l); ks["inputs"][2]["link"] = l
        l = new_link(105, 0, base_id + 2, 3, "LATENT"); latent["outputs"][0]["links"].append(l); ks["inputs"][3]["link"] = l
        l = new_link(base_id + 2, 0, base_id + 3, 0, "LATENT"); ks["outputs"][0]["links"].append(l); vd["inputs"][0]["link"] = l
        l = new_link(103, 0, base_id + 3, 1, "VAE"); vae["outputs"][0]["links"].append(l); vd["inputs"][1]["link"] = l
        l = new_link(base_id + 3, 0, base_id + 4, 0, "IMAGE"); vd["outputs"][0]["links"].append(l); pp["inputs"][0]["link"] = l
        return base_id + 2

    ksA1 = add_scene(200, 350,  "a cute orange cat sitting in sunlight", 1111)
    ksA2 = add_scene(300, 1050, "a happy golden retriever puppy", 2222)
    ksB1 = add_scene(400, 1750, "a serene mountain landscape at sunrise", 3333)
    ksB2 = add_scene(500, 2450, "a stormy ocean with crashing waves", 4444)

    # NOTE: chained Mute Switches need to know which inner switch each outer
    # row points at. We achieve this by giving inner switches a single fake
    # output slot (type "*", links list). LiteGraph happily serializes phantom
    # outputs; the Python no-op execute doesn't care.
    def make_inner_switch(node_id, pos, rows_labels, wired_ks_ids):
        sw = {
            "id": node_id,
            "type": "PixaromaMuteSwitch",
            "pos": list(pos),
            "size": [260, 110],
            "flags": {},
            "order": 0,
            "mode": 0,
            "inputs": [
                {"name": f"input_{i+1}", "type": "*", "link": None, "label": "​",
                 "pos": [10, 42 + i*20]} for i in range(len(rows_labels) + 1)
            ],
            "outputs": [
                {"name": "out", "type": "PIXAROMA_MUTE_CHAIN", "links": []}
            ],
            "properties": {
                "cnr_id": "ComfyUI-Pixaroma",
                "Node name for S&R": "PixaromaMuteSwitch",
                "muteSwitchState": {
                    "version": 1,
                    "selectMode": "multi",
                    "muteMode": "mute",
                    "rows": [{"enabled": True, "label": lbl} for lbl in rows_labels]
                            + [{"enabled": True, "label": None}],
                },
                "muteSwitchOriginalModes": {},
            },
            "widgets_values": [],
            **COL_PROC,
        }
        nodes.append(sw)
        for i, ks_id in enumerate(wired_ks_ids):
            l = new_link(ks_id, 0, node_id, i, "*")
            next(n for n in nodes if n["id"] == ks_id)["outputs"][0]["links"].append(l)
            sw["inputs"][i]["link"] = l
        return sw

    swA = make_inner_switch(700, (INNER_SWITCH_X, 700),  ["Cat", "Dog"],      [ksA1, ksA2])
    swB = make_inner_switch(800, (INNER_SWITCH_X, 2100), ["Mountain", "Ocean"], [ksB1, ksB2])

    # Outer switch (Single mode, picks group A or B)
    outer_id = 900
    outer = {
        "id": outer_id,
        "type": "PixaromaMuteSwitch",
        "pos": [OUTER_SWITCH_X, 1400],
        "size": [280, 110],
        "flags": {},
        "order": 0,
        "mode": 0,
        "inputs": [
            {"name": "input_1", "type": "*", "link": None, "label": "​", "pos": [10, 42]},
            {"name": "input_2", "type": "*", "link": None, "label": "​", "pos": [10, 62]},
            {"name": "input_3", "type": "*", "link": None, "label": "​", "pos": [10, 82]},
        ],
        "outputs": [],
        "properties": {
            "cnr_id": "ComfyUI-Pixaroma",
            "Node name for S&R": "PixaromaMuteSwitch",
            "muteSwitchState": {
                "version": 1,
                "selectMode": "single",
                "muteMode": "mute",
                "rows": [
                    {"enabled": True,  "label": "Group A (animals)"},
                    {"enabled": False, "label": "Group B (landscapes)"},
                    {"enabled": False, "label": None},
                ],
            },
            "muteSwitchOriginalModes": {},
        },
        "widgets_values": [],
        **COL_PROC,
    }
    nodes.append(outer)

    l = new_link(swA["id"], 0, outer_id, 0, "PIXAROMA_MUTE_CHAIN")
    swA["outputs"][0]["links"].append(l)
    outer["inputs"][0]["link"] = l

    l = new_link(swB["id"], 0, outer_id, 1, "PIXAROMA_MUTE_CHAIN")
    swB["outputs"][0]["links"].append(l)
    outer["inputs"][1]["link"] = l

    return _assemble(nodes, links)


w4 = build_workflow_4_v2()
overlap_check(w4, "04 - chaining")
write(w4, "04 - Chaining (groups of scenes).json")


def build_workflow_5_simple_chaining():
    """Text-only chaining demo - no model loading, immediate Run.
    Inner Switch A wires Text A1, Text A2.
    Inner Switch B wires Text B1, Text B2.
    Outer Switch C wires Switch A + Switch B (Single mode - pick a group).
    Each Text has a Show Text downstream so you can SEE which ones ran.
    """
    nodes = []
    links = []
    next_link = [1]

    def new_link(from_id, from_slot, to_id, to_slot, ltype):
        lid = next_link[0]
        next_link[0] += 1
        links.append([lid, from_id, from_slot, to_id, to_slot, ltype])
        return lid

    TEXT_X      = 0
    SHOWTEXT_X  = 320
    INNER_X     = 720
    OUTER_X     = 1080

    nodes.append(title_label(TEXT_X, 40, 920, "Mute Switch - Simple Chaining Test (text only)"))
    nodes.append(subtitle_label(TEXT_X, 91,
        "Outer switch picks GROUP A or GROUP B. Click Run: only the active group's Show Text fills in.\n"
        "Toggle the outer Single pill rows to swap groups. Inner switches let you mute individual rows."))

    def add_pair(base_id, label_letter, x, y):
        """Add a Text + ShowText pair. Returns (text_node, showtext_node)."""
        t = {
            "id": base_id,
            "type": "PixaromaText",
            "pos": [x, y],
            "size": [260, 158],
            "flags": {},
            "order": 0,
            "mode": 0,
            "inputs": [],
            "outputs": [
                {"name": "text", "type": "STRING", "links": [], "slot_index": 0},
            ],
            "properties": {
                "cnr_id": "ComfyUI-Pixaroma",
                "Node name for S&R": "PixaromaText",
            },
            "widgets_values": [f"Text {label_letter}"],
            **COL_PROC,
        }
        nodes.append(t)

        s = {
            "id": base_id + 1,
            "type": "PixaromaShowText",
            "pos": [x + 320, y],
            "size": [240, 158],
            "flags": {},
            "order": 0,
            "mode": 0,
            "inputs": [
                {"name": "source", "type": "*", "link": None},
            ],
            "outputs": [
                {"name": "text", "type": "STRING", "links": [], "slot_index": 0},
            ],
            "properties": {
                "cnr_id": "ComfyUI-Pixaroma",
                "Node name for S&R": "PixaromaShowText",
            },
            "widgets_values": [""],
            **COL_PROC,
        }
        nodes.append(s)

        # Text -> Show Text
        l = new_link(base_id, 0, base_id + 1, 0, "STRING")
        t["outputs"][0]["links"].append(l)
        s["inputs"][0]["link"] = l

        return t, s

    # Four Text + Show Text pairs
    tA1, _ = add_pair(101, "A1", TEXT_X,  220)
    tA2, _ = add_pair(201, "A2", TEXT_X,  430)
    tB1, _ = add_pair(301, "B1", TEXT_X,  680)
    tB2, _ = add_pair(401, "B2", TEXT_X,  890)

    # Helper to make a Mute Switch
    def make_switch(node_id, pos, rows_labels, wired_node_ids, wired_node_slots,
                    select_mode="multi", row_states=None):
        """rows_labels: list of labels (incl. None for trailing)
        wired_node_ids[i] = upstream node id for row i; None = unwired
        wired_node_slots[i] = upstream output slot index for row i
        row_states[i] = True/False enabled (defaults to True for connected, False for trailing/unwired)
        """
        # state.rows includes ALL rows (visible)
        n_visible = len(rows_labels)
        # Decide enabled per row
        if row_states is None:
            row_states = []
            for i in range(n_visible):
                if i < len(wired_node_ids) and wired_node_ids[i] is not None:
                    row_states.append(True)
                else:
                    row_states.append(False)

        sw = {
            "id": node_id,
            "type": "PixaromaMuteSwitch",
            "pos": list(pos),
            "size": [260, 130],
            "flags": {},
            "order": 0,
            "mode": 0,
            "inputs": [
                {"name": f"input_{i+1}", "type": "*", "link": None, "label": "​",
                 "pos": [10, 42 + i*20]}
                for i in range(n_visible)
            ],
            "outputs": [
                {"name": "out", "type": "PIXAROMA_MUTE_CHAIN", "links": [], "label": "​"},
            ],
            "properties": {
                "cnr_id": "ComfyUI-Pixaroma",
                "Node name for S&R": "PixaromaMuteSwitch",
                "muteSwitchState": {
                    "version": 1,
                    "selectMode": select_mode,
                    "muteMode": "mute",
                    "rows": [{"enabled": row_states[i], "label": rows_labels[i]}
                             for i in range(n_visible)],
                },
                "muteSwitchOriginalModes": {},
            },
            "widgets_values": [],
            **COL_PROC,
        }
        nodes.append(sw)
        for i, upid in enumerate(wired_node_ids):
            if upid is None:
                continue
            l = new_link(upid, wired_node_slots[i], node_id, i, "*")
            upstream_node = next(n for n in nodes if n["id"] == upid)
            upstream_node["outputs"][wired_node_slots[i]]["links"].append(l)
            sw["inputs"][i]["link"] = l
        return sw

    # Inner Switch A: wires Text A1, Text A2 (+ trailing)
    swA = make_switch(
        node_id=510,
        pos=(INNER_X, 280),
        rows_labels=["A1", "A2", None],
        wired_node_ids=[101, 201, None],
        wired_node_slots=[0, 0, 0],
        select_mode="multi",
    )

    # Inner Switch B: wires Text B1, Text B2 (+ trailing)
    swB = make_switch(
        node_id=610,
        pos=(INNER_X, 730),
        rows_labels=["B1", "B2", None],
        wired_node_ids=[301, 401, None],
        wired_node_slots=[0, 0, 0],
        select_mode="multi",
    )

    # Outer Switch C: wires Switch A + Switch B (Single mode, row 1 active)
    swC = make_switch(
        node_id=710,
        pos=(OUTER_X, 500),
        rows_labels=["Group A", "Group B", None],
        wired_node_ids=[510, 610, None],
        wired_node_slots=[0, 0, 0],
        select_mode="single",
        row_states=[True, False, False],
    )

    return _assemble(nodes, links)


w5 = build_workflow_5_simple_chaining()
overlap_check(w5, "05 - simple chaining")
write(w5, "05 - Simple chaining (text only).json")
