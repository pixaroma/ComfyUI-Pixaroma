"""The ComfyUI side of the shared 3D mesh, for Save 3D and Edit 3D Pixaroma.

_mesh3d.py is the pure geometry. This file turns ComfyUI's 3D inputs into it and
back again, keeping what each source has:
* an OBJ file keeps its quads and other polygons, its panel groups and its colours
  (read by _mesh3d.read_obj, because core's reader splits polygons into triangles);
* a MESH wire, or a GLB, GLTF or STL file read by core's own Get 3D Components,
  keeps its uvs, normals, tangents, textures and material, so a textured model
  written back as GLB keeps its texture.
An STL file stands on Z; it is turned to stand on Y like everything else here.

torch and ComfyUI are imported inside the functions, so importing this costs
nothing at startup, and it uses no other node's code.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field, replace
from io import BytesIO

import numpy as np

from . import _mesh3d as m3
from ._comfy_api_compat import api_attr

# Load 3D Pixaroma sends FILE_3D; core's own 3D nodes send the per-format types.
FILE_TYPES = "FILE_3D,FILE_3D_GLB,FILE_3D_GLTF,FILE_3D_OBJ,FILE_3D_STL"
IMAGE_KEYS = ("texture", "metallic_roughness", "normal_map", "emissive")
READABLE = ("obj", "glb", "gltf", "stl")


@dataclass
class Model3D:
    """One model: the polygon mesh (Y up) plus what a triangle source carried."""
    poly: m3.PolyMesh
    source: str = "mesh"                   # mesh, obj, glb, gltf or stl
    uvs: np.ndarray | None = None          # (N, 2) per vertex
    normals: np.ndarray | None = None      # (N, 3)
    tangents: np.ndarray | None = None     # (N, 4): xyz + handedness
    images: dict = field(default_factory=dict)  # IMAGE_KEYS -> (1, H, W, 3) tensor
    unlit: bool = False
    occlusion_in_mr: bool = False
    material: dict | None = None
    items: int = 1                         # models in the MESH batch; only the first is used


def blocked(message):
    """ComfyUI's own "this output cannot be used" marker, or None on an old build."""
    try:
        from comfy_execution.graph_utils import ExecutionBlocker
    except Exception:
        return None
    return ExecutionBlocker(message)


def read_input(mesh, model_3d, who):
    """The two optional inputs every 3D node has -> (Model3D or None, notes).
    When both are wired, the mesh is used."""
    notes = []
    if mesh is not None:
        if model_3d is not None:
            notes.append("Both inputs were wired: the mesh wire was used and model_3d was ignored.")
        model = from_mesh(mesh, who)
    elif model_3d is not None:
        model = from_file(model_3d, who)
    else:
        return None, notes
    if model.items > 1:
        notes.append("The mesh holds {} models; only the first one was used.".format(model.items))
    return model, notes


def _format_of(model_3d, data):
    fmt = str(getattr(model_3d, "format", "") or "").lower().lstrip(".")
    if fmt:
        return fmt
    if data[:4] == b"glTF":
        return "glb"
    head = data[:256].lstrip()
    if head[:1] == b"{":
        return "gltf"
    if len(data) >= 84 and 84 + struct.unpack_from("<I", data, 80)[0] * 50 == len(data):
        return "stl"
    if head[:5].lower() == b"solid":
        return "stl"
    return "obj"


def from_file(model_3d, who):
    """A File3D -> Model3D. Only a File3D object is accepted: a bare path string
    would be a string turned into a file read (path-containment.md)."""
    if not hasattr(model_3d, "get_bytes"):
        raise ValueError("{}: model_3d has to come from a 3D node such as Load 3D Pixaroma.".format(who))
    data = model_3d.get_bytes()
    fmt = _format_of(model_3d, data)
    if fmt not in READABLE:
        raise ValueError("{}: .{} files cannot be read here. Use GLB, GLTF, OBJ or STL.".format(who, fmt))
    if fmt == "obj":
        return Model3D(poly=m3.read_obj(data), source="obj")
    try:
        from comfy_extras.nodes_mesh_io import Get3DComponents
    except Exception:
        raise ValueError("{}: this ComfyUI cannot read .{} files yet (it has no Get 3D Components node). "
                         "Update ComfyUI, or wire a mesh in instead.".format(who, fmt))
    out = Get3DComponents.execute(model_3d)
    result = getattr(out, "result", None) or getattr(out, "args", None)
    if not result:
        raise ValueError("{}: the model file could not be read.".format(who))
    model = replace(from_mesh(result[0], who), source=fmt)
    if fmt == "stl":
        model = turn(model, m3.stl_to_y_up)
    return model


def _item(value, n=None):
    """Item 0 of a batched per-vertex or per-face value, cut to n rows, or None."""
    import torch

    if isinstance(value, (list, tuple)):
        value = value[0] if len(value) else None
    elif torch.is_tensor(value) and value.ndim == 3:
        value = value[0] if value.shape[0] else None
    if not torch.is_tensor(value) or value.ndim != 2:
        return None
    return value[:n] if n is not None else value


def _numpy(t, dtype):
    return t.detach().to("cpu").numpy().astype(dtype)


def from_mesh(mesh, who):
    """A core MESH -> Model3D of its first model, cut to its real length in a
    padded batch (the same slicing core's get_mesh_batch_item does)."""
    import torch

    verts = getattr(mesh, "vertices", None)
    if isinstance(verts, (list, tuple)):
        items = len(verts)
    elif torch.is_tensor(verts) and verts.ndim == 3:
        items = int(verts.shape[0])
    else:
        items = 1
    counts_v, counts_f = getattr(mesh, "vertex_counts", None), getattr(mesh, "face_counts", None)
    nv = nf = None
    if counts_v is not None and counts_f is not None and len(counts_v) and len(counts_f):
        nv, nf = int(counts_v[0]), int(counts_f[0])
    V = _item(verts, nv)
    F = _item(getattr(mesh, "faces", None), nf)
    if items == 0 or V is None or F is None or V.shape[0] == 0 or F.shape[0] == 0:
        raise ValueError("{}: the mesh is empty.".format(who))
    n = int(V.shape[0])

    def per_vertex(name):
        t = _item(getattr(mesh, name, None), n)
        return _numpy(t, np.float32) if t is not None and t.shape[0] == n else None

    uvs = per_vertex("uvs")
    images = {}
    if uvs is not None:
        # A texture without texture coordinates cannot be drawn, so it is kept
        # only when the uvs are.
        for key in IMAGE_KEYS:
            t = getattr(mesh, key, None)
            if torch.is_tensor(t) and t.ndim == 4 and t.shape[0]:
                images[key] = t[0:1]
    material = getattr(mesh, "material", None)
    return Model3D(
        poly=m3.from_triangles(_numpy(V, np.float64), _numpy(F, np.int64), per_vertex("vertex_colors")),
        source="mesh", uvs=uvs, normals=per_vertex("normals"), tangents=per_vertex("tangents"),
        images=images, unlit=bool(getattr(mesh, "unlit", False)),
        occlusion_in_mr=bool(getattr(mesh, "occlusion_in_mr", False)),
        material=dict(material) if isinstance(material, dict) else None, items=items,
    )


def _turn_rows(rows, fn):
    """Turn the xyz of per-vertex directions, keeping any fourth column (a
    tangent's handedness, which a turn does not change)."""
    if rows is None:
        return None
    rows = np.asarray(rows, np.float32)
    turned = np.asarray(fn(rows[:, :3]), np.float32)
    return np.concatenate([turned, rows[:, 3:]], axis=1) if rows.shape[1] > 3 else turned


def turn(model, fn):
    """Apply a pure turn, given as a function of (N, 3) points, to the positions,
    the normals and the tangents."""
    return replace(model, poly=m3.with_vertices(model.poly, fn(model.poly.vertices)),
                   normals=_turn_rows(model.normals, fn), tangents=_turn_rows(model.tangents, fn))


def fix(model, turns, center, ground):
    """The Fix row: the turns in order, then center on X and Z, then the lowest
    point on Y = 0. Normals and tangents only turn.
    -> (fixed Model3D, shift): shift is the (3,) move added after the turns."""
    def spin(rows):
        return m3.apply_fix(rows, turns, False, False)

    turned = spin(model.poly.vertices)
    shift = m3.fix_shift(turned, center, ground)
    fixed = replace(model, poly=m3.with_vertices(model.poly, turned + shift),
                    normals=_turn_rows(model.normals, spin), tangents=_turn_rows(model.tangents, spin))
    return fixed, shift


def to_mesh(model, who="Save 3D Pixaroma"):
    """Model3D -> a one-model core MESH, polygons split into triangles. Uvs and
    normals stay valid because the vertices do not change. The MESH type comes
    from a PINNED comfy_api version first, `latest` last (_comfy_api_compat.py)."""
    import torch

    mesh_type = api_attr("Types.MESH")
    if mesh_type is None:
        raise ValueError("{}: this ComfyUI has no 3D mesh type (comfy_api Types.MESH), so it cannot "
                         "write GLB files. Update ComfyUI, or choose OBJ or STL.".format(who))

    V, F, C = m3.triangulate(model.poly)

    def batch(array, dtype):
        return torch.from_numpy(np.ascontiguousarray(array, dtype))[None]

    kw = {"vertices": batch(V, np.float32), "faces": batch(F, np.int64)}
    if C is not None:
        kw["vertex_colors"] = batch(C, np.float32)
    for key in ("uvs", "normals", "tangents"):
        value = getattr(model, key)
        if value is not None:
            kw[key] = batch(value, np.float32)
    kw.update(model.images)
    kw["unlit"] = model.unlit
    kw["occlusion_in_mr"] = model.occlusion_in_mr
    if model.material is not None:
        kw["material"] = model.material
    return mesh_type(**kw)


def glb_bytes(model, who):
    """Model3D -> GLB bytes through core's own writer, which carries every PBR
    attribute (uvs, colours, normals, textures, material)."""
    try:
        from comfy_extras.nodes_save_3d import mesh_item_to_glb_bytes
    except Exception:
        raise ValueError("{}: this ComfyUI cannot write GLB files yet. Update ComfyUI, "
                         "or choose OBJ or STL.".format(who))
    data = mesh_item_to_glb_bytes(to_mesh(model, who), 0)
    if not data:
        raise ValueError("{}: the model is empty, so there is nothing to write.".format(who))
    return data


def file3d(data, fmt, who="Save 3D Pixaroma"):
    """File bytes -> the File3D a model_3d output carries, its type from a PINNED
    comfy_api version first, `latest` last (_comfy_api_compat.py). On a ComfyUI
    with no File3D type the file is already saved by now, so only this output is
    blocked, with the reason: failing the run would make a retry save a second
    copy (the same rule as the view file, save-3d.md #10)."""
    file_type = api_attr("Types.File3D")
    if file_type is None:
        return blocked("{}: this ComfyUI has no 3D file type (comfy_api Types.File3D), so the model_3d "
                       "output cannot be used. The file itself was saved. Update ComfyUI.".format(who))
    return file_type(BytesIO(data), file_format=fmt)
