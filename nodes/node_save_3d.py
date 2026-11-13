"""Save 3D Pixaroma - look at a 3D model, fix how it stands, then preview or save it.

The backend. The face (the square viewer, the views and looks, the Fix row and
the gear) lives in js/save_3d/. The settings live on node.properties in the
browser and arrive in the hidden Save3DState input (Vue Compat #9). The result
goes back in ui.pixaroma_save3d, stamped, because a cached node replays its
executed event (free-vram.md #5).

A run: read the input through _mesh3d_io (an OBJ keeps its quads, groups and
colours; a MESH, GLB or STL keeps its uvs, normals and textures), apply the Fix
(turns, center, on the ground), write OBJ, GLB or STL, into temp in Preview and
into the save folder in Save, and return that same file on model_3d, so the next
node gets exactly what was saved.

The report also carries what the face's LIVE Fix preview needs: `fix` (the turns
and the exact move that were applied, so the viewer can undo them) and `view`
(a file standing on Y, unscaled: the saved file itself when it is an OBJ or GLB
on Y that /view can serve, otherwise a separate temp file).

Save now (the button on the face) copies the last Preview file through the
/pixaroma/api/save3d/save_now route, which calls save_now() below. The save
folder follows Save Image's rules: empty is the output folder, anything else must
pass the shared guard (nodes/_path_guard.py).

Pure helpers + harness: _mesh3d.py, _save3d_helpers.py, D:\\Claude Tests\\_save3d_test.py.
"""
from __future__ import annotations

import os
import re
import time

import folder_paths

from . import _mesh3d as m3
from . import _mesh3d_io as mio
from ._path_guard import denied_message, folder_allowed, prescreen_folder_field, safe_join
from ._save3d_helpers import DEFAULT_NAME, check_line, parse_state, pick_format
from ._save_helpers import _resolve_save_folder, _safe_prefix

CLASS = "PixaromaSave3D"
HIDDEN_INPUT = "Save3DState"
UI_KEY = "pixaroma_save3d"
PREVIEW_SUBFOLDER = "pixaroma_save3d"
WHO = "Save 3D Pixaroma"
# The only files Save now may copy: ones this node wrote into its temp folder.
# 60, not 40: a preview may carry the 8-character workflow key and "_view" ahead of a 40-character id.
SOURCE_NAME = re.compile(r"^save3d_[A-Za-z0-9_-]{1,60}\.(obj|glb|stl)$")

NOTHING_WIRED = (
    "Save 3D Pixaroma has nothing to save. Wire a mesh, or a model_3d from Load 3D Pixaroma "
    "or another 3D node, into it."
)


def _safe_id(uid):
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(uid if uid is not None else "node"))[:40] or "node"


def _file_bytes(model, fmt, state):
    """The fixed model as file bytes -> (bytes, stands on Z). STL stands on Z
    unless Up says Y; OBJ and GLB stand on Y unless Up says Z."""
    up = state["up"]
    z_up = up == "z" or (up == "auto" and fmt == "stl")
    if fmt == "stl":
        V, F, _colours = m3.triangulate(model.poly)
        P = m3.scale_longest(V, None if state["stlSize"] == "model" else state["stlSize"])
        if z_up:
            P = m3.y_up_to_z_up(P)
        return m3.stl_bytes(P, F, header=WHO.encode("ascii")), z_up
    if z_up:
        model = mio.turn(model, m3.y_up_to_z_up)
    if fmt == "obj":
        return m3.write_obj(model.poly, header=WHO), z_up
    return mio.glb_bytes(model, WHO), z_up


def _format_notes(model, fmt):
    """What the chosen format could not keep, said once each."""
    notes = []
    faces = m3.face_summary(model.poly)
    if fmt != "obj" and faces["quads"] + faces["ngons"]:
        notes.append("{} files hold triangles only, so the quads were split into triangles in this file. "
                     "Choose OBJ to keep them.".format(fmt.upper()))
    if fmt != "obj" and model.poly.group_names:
        notes.append("Panel groups are kept in OBJ files only.")
    if fmt != "glb" and model.images:
        notes.append("{} files keep no textures here, so the texture was left out. "
                     "Choose GLB to keep it.".format(fmt.upper()))
    if fmt == "stl" and model.poly.colours is not None:
        notes.append("STL files keep no colours.")
    return notes


def _write_temp(data, name):
    """Into temp/pixaroma_save3d, written over on every run."""
    folder = os.path.join(folder_paths.get_temp_directory(), PREVIEW_SUBFOLDER)
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, name), "wb") as handle:
        handle.write(data)
    return {"filename": name, "subfolder": PREVIEW_SUBFOLDER, "type": "temp"}


def _temp_stem(uid, wf=""):
    """The node id, led by the workflow key when the browser sent one (parse_state accepts only
    8 hex characters). Every Ep34 workflow has a Stage 1 viewer with id 363, and with the id alone
    each of them showed whichever workflow ran last (2026-09-17). A run with no key keeps the old name."""
    return "{}_{}".format(wf, _safe_id(uid)) if wf else _safe_id(uid)


def _write_preview(data, fmt, uid, wf=""):
    return _write_temp(data, "save3d_{}.{}".format(_temp_stem(uid, wf), fmt))


def _view_format(model):
    """The viewer wants polygons and panel groups (OBJ) or colours and textures
    on triangles (GLB)."""
    faces = m3.face_summary(model.poly)
    return "obj" if faces["quads"] + faces["ngons"] or model.poly.group_names else "glb"


def _write_view(model, uid, wf=""):
    """The fixed model standing on Y and unscaled, for the viewer, when the saved
    file stands on Z, is an STL, or sits in a folder /view cannot serve."""
    fmt = _view_format(model)
    data = m3.write_obj(model.poly, header=WHO) if fmt == "obj" else mio.glb_bytes(model, WHO)
    return _write_temp(data, "save3d_{}_view.{}".format(_temp_stem(uid, wf), fmt))


def _fix_report(state, shift):
    """The Fix as it was applied. `shift` is the exact move added after the turns,
    so the viewer recovers the input as R^T (F - shift) and previews a new Fix on it."""
    return {"turns": list(state["turns"]), "center": bool(state["center"]), "ground": bool(state["ground"]),
            "shift": [float(s) for s in shift]}


def _save_folder(state):
    """The folder Save writes into -> (absolute path, inside ComfyUI's output folder).

    Empty is the output folder. Anything else goes through Save Image's rules in
    this exact order (path-containment.md #5 and #11b): the lexical screen BEFORE
    any resolve, because resolving a UNC path already hands over a credential;
    then the resolve; then the allowlist. A refusal names the fix (#7).
    """
    raw = state.get("folder") or ""
    if raw and not prescreen_folder_field(raw):
        raise ValueError(denied_message(raw))
    folder, inside = _resolve_save_folder(raw)
    if not folder_allowed(folder):
        raise ValueError(denied_message(folder))
    return folder, inside


def _write_saved(data, fmt, state):
    """Into the save folder with Save Image's name rules and core's counter.

    The name was cleaned by parse_state and goes through _safe_prefix (date tokens,
    Windows-illegal characters, reserved names); core's get_save_image_path then
    refuses a subfolder that climbs out of the folder. The file is claimed with
    O_EXCL, so two saves at the same moment never write over each other.
    -> {filename, subfolder, type}: "output" when /view can serve it, otherwise
    "external" with the absolute folder.
    """
    folder, inside = _save_folder(state)
    prefix = _safe_prefix(state["name"]) or DEFAULT_NAME
    base, filename, counter, _sub, _prefix = folder_paths.get_save_image_path(prefix, folder)
    os.makedirs(base, exist_ok=True)
    for _attempt in range(1000):
        name = "{}_{:05}_.{}".format(filename, counter, fmt)
        path = os.path.join(base, name)
        try:
            handle = open(path, "xb")
        except FileExistsError:
            counter += 1
            continue
        try:
            with handle:
                handle.write(data)
        except BaseException:
            # A write that fails half way (a full disk, a folder that went away) must not
            # leave a half-written file behind under the claimed name (backend review).
            try:
                os.remove(path)
            except OSError:
                pass
            raise
        break
    else:
        raise ValueError("Save 3D Pixaroma: no free file name was found in {}.".format(base))
    if inside:
        out_dir = os.path.realpath(folder_paths.get_output_directory())
        rel = os.path.relpath(os.path.realpath(base), out_dir)
        return {"filename": name, "subfolder": "" if rel == "." else rel, "type": "output"}
    return {"filename": name, "subfolder": "", "type": "external", "folder": base}


def save_now(data):
    """Save now: copy a Preview run's file into the save folder -> the saved file's info.

    Called by the /pixaroma/api/save3d/save_now route, so every value in `data`
    is checked here (path-containment.md #0). The source must be
    a file this node wrote: type temp, our own subfolder, our own name pattern, and
    safe_join keeps it inside that folder. The destination follows exactly the same
    rules as a Save run.
    """
    if not isinstance(data, dict) or not isinstance(data.get("file"), dict):
        raise ValueError("Save now needs the file from the last run.")
    ref = data["file"]
    name = ref.get("filename")
    if (ref.get("type") != "temp" or ref.get("subfolder") != PREVIEW_SUBFOLDER
            or not isinstance(name, str) or not SOURCE_NAME.match(name)):
        raise ValueError("Save now can only copy a file Save 3D Pixaroma wrote in Preview.")
    src = safe_join(os.path.join(folder_paths.get_temp_directory(), PREVIEW_SUBFOLDER), name)
    if not src or not os.path.isfile(src):
        raise ValueError("The preview file is gone (ComfyUI empties its temp folder when it restarts). "
                         "Run again, then Save now.")
    with open(src, "rb") as handle:
        blob = handle.read()
    state = parse_state({"name": data.get("name"), "folder": data.get("folder")})
    return _write_saved(blob, name.rsplit(".", 1)[1].lower(), state)


class PixaromaSave3D:
    DESCRIPTION = (
        "Shows a 3D model in a square viewer and saves it. Drag to look around and pick a look: Color, "
        "Clay, Wire (the real polygon edges), Panels or Normal. The FRONT arrow, the floor grid and the "
        "model's shadow show which way the model faces and whether it stands on the ground. The Fix row "
        "changes the file itself: turn the model 90 degrees at a time, center it, and stand it on the "
        "ground. What you see is what gets saved. Preview writes a temporary file only; Save writes into "
        "your output folder on every run, and Save now copies the last preview without running again. "
        "Format Auto keeps quads as OBJ and writes a triangle model as GLB with its colours and textures; "
        "STL is for 3D printing. Wire in a mesh, or a model_3d from Load 3D Pixaroma or another 3D node. "
        "The model_3d output is the saved file, so the next node gets exactly what was saved."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "mesh": ("MESH", {
                    "tooltip": "A mesh from any mesh node, for example the Pixal3D or Trellis 2 nodes. "
                               "When a model_3d is wired in as well, the mesh is used.",
                }),
                "model_3d": (mio.FILE_TYPES, {
                    "tooltip": "A 3D model file, for example from Load 3D Pixaroma. GLB, GLTF, OBJ and STL "
                               "can be read. An OBJ keeps its quads, panel groups and colours.",
                }),
            },
            # Hidden, not required: a required STRING shows as a widget AND a
            # convertible input dot in the Vue frontend (Vue Compat #9).
            "hidden": {
                HIDDEN_INPUT: ("STRING", {"default": "{}"}),
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("FILE_3D",)
    RETURN_NAMES = ("model_3d",)
    OUTPUT_TOOLTIPS = (
        "The fixed model as a file, in the format it was saved in (OBJ, GLB or STL). Wire it into any "
        "node that takes a 3D model file; it gets exactly what this node saved.",
    )
    FUNCTION = "save"
    # Runs with nothing downstream, like a save node should.
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    def save(self, mesh=None, model_3d=None, unique_id=None, **kwargs):
        state = parse_state(kwargs.get(HIDDEN_INPUT))
        started = time.perf_counter()

        model, notes = mio.read_input(mesh, model_3d, WHO)
        if model is None:
            report = {"ok": True, "skipped": True, "mode": state["mode"],
                      "message": "nothing is wired in", "stamp": time.perf_counter()}
            return {"ui": {UI_KEY: [report]}, "result": (mio.blocked(NOTHING_WIRED),)}

        bad = m3.count_non_finite(model.poly.vertices)
        if bad:
            notes.append("{} vertices have a position that is not a number: the Fix and the check line "
                         "leave them out, and they are written as they came in.".format(bad))
        fixed, shift = mio.fix(model, state["turns"], state["center"], state["ground"])
        fmt = pick_format(state["format"], fixed.poly)
        notes.extend(_format_notes(fixed, fmt))
        data, z_up = _file_bytes(fixed, fmt, state)
        saved = state["mode"] == "save"
        info = _write_saved(data, fmt, state) if saved else _write_preview(data, fmt, unique_id, state["wf"])
        # An OBJ or GLB standing on Y that /view can serve is exactly what the
        # viewer needs; anything else gets a view file of its own, so the saved
        # file is never altered.
        servable = info["type"] in ("temp", "output")
        if fmt in ("obj", "glb") and not z_up and servable:
            view = info
        else:
            try:
                view = _write_view(fixed, unique_id, state["wf"])
            except Exception as exc:
                # The file itself is already written: report it rather than fail the run and
                # lose it, since a retry would save a second copy (backend review 2026-09-15).
                view = info
                notes.append("The view on the node could not be made ({}); the file itself was written."
                             .format(exc))

        report = {
            "ok": True, "skipped": False, "mode": state["mode"], "saved": saved, "file": info, "view": view,
            "format": fmt, "up": "z" if z_up else "y", "source": fixed.source,
            "fix": _fix_report(state, shift),
            # What this run was ASKED for, so the face can tell whether the file on the node is
            # still the one its settings describe. From this run's own state: a key stamped in the
            # browser at queue time can belong to a NEWER prompt than the run landing now.
            "request": {k: state[k] for k in ("turns", "center", "ground", "format", "up", "stlSize")},
            "faces": m3.face_summary(fixed.poly), "edges": m3.edge_census(fixed.poly),
            "colours": fixed.poly.colours is not None, "texture": "texture" in fixed.images,
            "groups": len(fixed.poly.group_names),
            # The saved result, and the model as it came in (what the Fix changed).
            "check": check_line(m3.placement_check(fixed.poly.vertices)),
            "checkInput": check_line(m3.placement_check(model.poly.vertices)),
            "bytes": len(data), "seconds": round(time.perf_counter() - started, 2),
            "notes": notes, "stamp": time.perf_counter(),
        }
        ui = {UI_KEY: [report]}
        if saved and info["type"] == "output":
            # Core's own key for a saved 3D file, so ComfyUI's Media Assets panel
            # lists it (it goes by the file's extension). The frontend adds a viewer
            # for that key only on its own Save 3D Model node, so ours gets none.
            ui["3d"] = [info]
        return {"ui": ui, "result": (mio.file3d(data, fmt),)}


NODE_CLASS_MAPPINGS = {CLASS: PixaromaSave3D}
NODE_DISPLAY_NAME_MAPPINGS = {CLASS: "Save 3D Pixaroma"}
