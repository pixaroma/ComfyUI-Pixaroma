// ============================================================
// Pixaroma 3D Editor — Model importer (GLB / OBJ)
// Lazy-loads GLTFLoader / OBJLoader from esm.sh on first use.
// Caches models loaded from static asset URLs (e.g. the built-in
// bunny) so repeat Bunny clicks don't refetch / re-parse.
// ============================================================
import { Pixaroma3DEditor, getTHREE } from "./core.mjs";
import { ThreeDAPI } from "./api.mjs";

const ESM = "https://esm.sh/three@0.170.0";

let _GLTFLoader = null;
let _OBJLoader = null;
let _MTLLoader = null;
let _mergeVertices = null;
const _assetCache = new Map(); // url → cached Group

async function getGLTFLoader() {
  if (_GLTFLoader) return _GLTFLoader;
  const mod = await import(ESM + "/examples/jsm/loaders/GLTFLoader.js");
  _GLTFLoader = mod.GLTFLoader;
  return _GLTFLoader;
}

async function getOBJLoader() {
  if (_OBJLoader) return _OBJLoader;
  const mod = await import(ESM + "/examples/jsm/loaders/OBJLoader.js");
  _OBJLoader = mod.OBJLoader;
  return _OBJLoader;
}

async function getMTLLoader() {
  if (_MTLLoader) return _MTLLoader;
  const mod = await import(ESM + "/examples/jsm/loaders/MTLLoader.js");
  _MTLLoader = mod.MTLLoader;
  return _MTLLoader;
}

async function getMergeVertices() {
  if (_mergeVertices) return _mergeVertices;
  const mod = await import(
    ESM + "/examples/jsm/utils/BufferGeometryUtils.js"
  );
  _mergeVertices = mod.mergeVertices;
  return _mergeVertices;
}

// Recompute smooth vertex normals on every Mesh in a Group. GLB/OBJ
// exports often ship with DUPLICATED vertices at face boundaries
// (one vertex per face instead of one shared across all adjacent
// faces) — computeVertexNormals on that data produces flat shading
// because each vertex only knows about its own face's normal.
//
// mergeVertices collapses duplicate positions into shared vertices
// first, so the following computeVertexNormals averages across all
// incident faces and gives true smooth shading.
export async function smoothGroupNormals(group) {
  const mergeVertices = await getMergeVertices();
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    try {
      // Drop the baked normal attribute FIRST — otherwise mergeVertices
      // uses the existing (flat, per-face) normals as part of its
      // vertex-equality test and keeps every face vertex separate, so
      // the mesh merges nothing and stays flat-shaded.
      const src = o.geometry;
      if (src.attributes.normal) src.deleteAttribute("normal");
      // Loose tolerance so numerically-close positions from GLB export
      // rounding still collapse into shared vertices.
      const merged = mergeVertices(src, 1e-3);
      merged.computeVertexNormals();
      o.geometry.dispose();
      o.geometry = merged;
      // Belt-and-braces: also force the material to use vertex normals.
      if (o.material && "flatShading" in o.material) {
        o.material.flatShading = false;
        o.material.needsUpdate = true;
      }
    } catch {
      // If mergeVertices chokes on unusual attribute layouts, fall
      // back to a plain recompute so we at least don't crash.
      if (o.geometry.attributes.normal) o.geometry.deleteAttribute("normal");
      o.geometry.computeVertexNormals();
    }
  });
}

// Load a GLB by URL and return a Group. First call per URL fetches
// and parses; subsequent calls return a deep clone of the cached
// result so each imported instance gets its own transform.
export async function loadGLBFromURL(url) {
  const THREE = getTHREE();
  if (_assetCache.has(url)) {
    return _assetCache.get(url).clone(true);
  }
  const Loader = await getGLTFLoader();
  const loader = new Loader();
  const gltf = await loader.loadAsync(url);
  const group = gltf.scene || new THREE.Group();
  await smoothGroupNormals(group);
  _assetCache.set(url, group.clone(true));
  return group;
}

// Load an OBJ by URL. Returns a Group. (Used in Task 8 for uploads;
// kept here so the importer module owns every model format.)
export async function loadOBJFromURL(url) {
  const Loader = await getOBJLoader();
  const loader = new Loader();
  const group = await loader.loadAsync(url);
  await smoothGroupNormals(group);
  return group;
}

// Load an OBJ alongside its MTL + textures. `companions` is an array
// of {name, url} pairs for every companion file (the .mtl and every
// referenced texture image). Passing an empty / undefined companions
// list falls back to loadOBJFromURL (gray default materials).
// Shared between the initial import and the save/restore path so a
// textured cottage round-trips the same way both times.
export async function loadOBJWithCompanions(mainUrl, companions) {
  const THREE = getTHREE();
  const OBJLoader = await getOBJLoader();
  const objLoader = new OBJLoader();
  const mtl = companions?.find?.((c) => /\.mtl$/i.test(c.name));
  if (mtl) {
    const MTLLoader = await getMTLLoader();
    const textureMap = new Map();
    for (const c of companions) {
      if (c?.name && c?.url) textureMap.set(c.name.toLowerCase(), c.url);
    }
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      // Scan the whole URL (lowercased) for any companion basename —
      // MTLLoader's relative-path resolution over our /view?…
      // upload URLs doesn't produce a clean last-segment filename.
      const lc = url.toLowerCase();
      for (const [name, mapped] of textureMap) {
        if (lc.includes(name)) {
          console.log("[P3D] texture redirect:", name, "→", mapped);
          return mapped;
        }
      }
      // Not the MTL itself and not a recognised companion — probably a
      // texture the MTL references but the user didn't upload. Log so
      // the console shows you what's missing (common cause of a model
      // rendering as a black silhouette).
      if (!lc.includes(".mtl")) {
        console.warn("[P3D] texture not in companion list:", url);
      }
      return url;
    });
    manager.onError = (url) => {
      console.warn("[P3D] failed to load (404?):", url);
    };
    const mtlLoader = new MTLLoader(manager);
    // DoubleSide for the original-material path — house/cottage style
    // OBJs are built from single-sided walls, so FrontSide shows the
    // interior as transparent when the camera peeks inside.
    mtlLoader.setMaterialOptions({ side: THREE.DoubleSide });
    const materials = await mtlLoader.loadAsync(mtl.url);
    materials.preload();
    objLoader.setMaterials(materials);
  }
  const group = await objLoader.loadAsync(mainUrl);
  await smoothGroupNormals(group);
  // Post-process: some OBJ/MTL pairs exported from PBR pipelines set
  // `Kd 0 0 0` (black diffuse) while carrying the actual colour in the
  // `map_Kd` texture. MeshPhongMaterial multiplies the texture by the
  // diffuse colour, so black × texture = pure black — the model renders
  // as a silhouette with no shading. If a material has a diffuse map
  // assigned but its colour is effectively black, force it to white so
  // the texture shows through as intended.
  group.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || !m.color || !m.map) continue;
      const { r, g, b } = m.color;
      if (r < 0.02 && g < 0.02 && b < 0.02) {
        console.log("[P3D] reset black Kd → white on material with diffuse map:", m.name || "(unnamed)");
        m.color.setRGB(1, 1, 1);
      }
    }
  });
  return group;
}

// Build a /view URL from a stored-input relative path like
// "pixaroma/<proj>/models/foo.jpg". Exposed so the restore path can
// reconstruct companion URLs from saved paths without re-uploading.
export function viewURLForStoredPath(path) {
  const parts = path.split("/");
  const fname = parts.pop();
  const subfolder = parts.join("/");
  return "/view?filename=" + encodeURIComponent(fname)
       + "&type=input&subfolder=" + encodeURIComponent(subfolder)
       + "&t=" + Date.now();
}

// Read a File as a base64 data URL (used by the upload pipeline).
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Uploads one file and returns its /view URL + the stored path.
async function uploadOne(projectId, file) {
  if (file.size > 50 * 1024 * 1024) {
    throw new Error(`${file.name}: file too large (max 50 MB)`);
  }
  const dataURL = await readAsDataURL(file);
  const res = await ThreeDAPI.uploadModel(projectId, file.name, dataURL);
  if (res.status !== "success") {
    throw new Error(`Upload failed (${file.name}): ${res.msg || "unknown"}`);
  }
  const parts = res.path.split("/");
  const fname = parts.pop();
  const subfolder = parts.join("/");
  const url = "/view?filename=" + encodeURIComponent(fname)
            + "&type=input&subfolder=" + encodeURIComponent(subfolder)
            + "&t=" + Date.now();
  return { path: res.path, storedName: res.filename, url, origName: file.name };
}

// Full upload + load + add pipeline. Accepts a FileList so the user
// can drop an OBJ bundle (.obj + .mtl + texture images) in one go —
// textures referenced by .mtl are fetched by the loader via relative
// paths, which resolve against the uploaded blob's /view URL folder
// (ComfyUI serves everything under the same subfolder).
//
// Single-file GLB works the same way (no companion files needed).
export async function importFromFiles(editor, files) {
  if (!files || !files.length) return;
  const fileArray = Array.from(files);

  // Find the primary mesh file (glb / gltf / obj).
  const mainFile = fileArray.find((f) =>
    /\.(glb|gltf|obj)$/i.test(f.name),
  );
  if (!mainFile) {
    throw new Error("Select a .glb, .gltf or .obj file");
  }
  const mainExt = mainFile.name.split(".").pop().toLowerCase();

  // Upload EVERY file so loaders can resolve companions/textures via
  // relative paths under the same stored subfolder.
  editor._setStatus?.(`Uploading ${fileArray.length} file(s)…`);
  const THREE = getTHREE();
  const uploaded = [];
  for (const f of fileArray) {
    // Skip files the backend won't accept (texture extensions etc).
    // We send them anyway — the route accepts .glb/.gltf/.obj plus
    // whitelisted companions added below.
    try {
      uploaded.push(await uploadOne(editor.projectId, f));
    } catch (e) {
      // Non-fatal per companion — keep going; main file checked below.
      console.warn("[P3D] skip file", f.name, e.message || e);
    }
  }
  const mainUp = uploaded.find((u) => u.origName === mainFile.name);
  if (!mainUp) throw new Error("Main mesh file failed to upload");

  editor._setStatus?.("Loading model…");
  // Companions = every non-main file we uploaded with {name, path, url}.
  // We stash the name/path pair on userData so save/restore can rebuild
  // the /view URLs (which carry a cache-buster timestamp) on demand.
  const companions = uploaded
    .filter((u) => u.origName !== mainFile.name)
    .map((u) => ({ name: u.origName, path: u.path, url: u.url }));
  let group;
  if (mainExt === "obj") {
    group = await loadOBJWithCompanions(mainUp.url, companions);
  } else {
    // GLB/GLTF — all materials + textures are embedded in the file.
    group = await loadGLBFromURL(mainUp.url);
  }

  // Default to the file's own materials. GLB always carries PBR data;
  // OBJ only does if an .mtl companion was supplied. For OBJ-without-MTL
  // the stored "originals" are plain MeshPhongMaterial defaults from
  // OBJLoader, so leave that case on the clay override instead.
  const hasOwnMaterials = mainExt !== "obj"
    || fileArray.some((f) => /\.mtl$/i.test(f.name));
  // companionFiles persisted to save JSON — just the name+path pairs.
  const companionFiles = companions.map((c) => ({ name: c.name, path: c.path }));
  editor._addImportedGroup(group, "import", {
    name: mainFile.name,
    importPath: mainUp.path,
    importExt: mainExt,
    companionFiles,
    keepOriginalMaterials: hasOwnMaterials,
  });
  editor._setStatus?.("Model imported");
}

// Backwards-compatible single-file entry point (used by drag+drop etc
// if we add that later).
export async function importFromFile(editor, file) {
  return importFromFiles(editor, [file]);
}

// Mixin — add an imported Group to the scene using the same plumbing
// as parametric shapes (undo, layer entry, selection, shadow frustum).
//
// `typeTag` is stored on userData.type — "bunny" for the bundled
// bunny, "import" for user uploads (Task 8). The Shape panel uses
// this to show the "No shape parameters for imported models." empty
// state rather than parametric sliders.
// Default warm off-white applied to bunny + user imports so they
// match the parametric-shape default. Without this, GLBs came out
// the dull neutral gray that three.js GLTFLoader uses when the file
// ships without a baseColor.
const IMPORTED_DEFAULT_COLOR = "#f3e8d8";

// Shared prep for any imported Group — parametric shadow flags, stash
// original materials so the "Use Original Material" toggle can switch
// back to them, and build a single shared override MeshStandardMaterial
// so GLB/OBJ imports shade identically under our PBR pipeline.
// Returns { origMaterials, overrideMat } for storing on userData.
// Called both from _addImportedGroup (fresh adds) and from the
// persistence restore path (re-load from disk).
export function prepareImportedGroup(group, colorHex) {
  const THREE = getTHREE();
  const origMaterials = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    origMaterials.push(o.material || null);
  });
  const overrideMat = new THREE.MeshStandardMaterial({
    color: colorHex || IMPORTED_DEFAULT_COLOR,
    roughness: 0.55,
    metalness: 0,
    // Opaque by default. `transparent: true` with opacity=1 still pushes
    // the mesh into the transparent render queue, which back-to-front
    // sorts by centroid and skips depth writes — on complex multi-mesh
    // imports (cottage walls, the bunny) this causes triangles to render
    // out of order so you see "through" the model. The material-panel
    // opacity slider flips transparent=true when the user drops it <1.
    transparent: false,
    opacity: 1,
    depthWrite: true,
    // DoubleSide — imported meshes are often open shells (pot with no
    // bottom, leaves modeled as single planes). With FrontSide culling
    // you see "holes" right through them; DoubleSide shades both sides
    // of every triangle so the override clay material looks solid.
    side: THREE.DoubleSide,
  });
  group.traverse((o) => {
    if (o.isMesh) o.material = overrideMat;
  });
  return { origMaterials, overrideMat };
}

// Wrap an imported inner group in an outer Group whose origin sits on
// the mesh's base-center. Returns { outer, sizeLocal } — sizeLocal is
// the pre-scale world bbox size so callers can auto-scale if they want.
// Shared between fresh-add and save-restore so the gizmo pivot lands
// at the same spot on the mesh both times.
export function wrapImportPivot(innerGroup) {
  const THREE = getTHREE();
  const outer = new THREE.Group();
  outer.add(innerGroup);
  // Bbox of the inner while the outer is still identity — effectively
  // the inner's local-space bbox (three.js applies inner's own
  // transforms inside setFromObject).
  const bbLocal = new THREE.Box3().setFromObject(innerGroup);
  const sizeLocal = new THREE.Vector3();
  bbLocal.getSize(sizeLocal);
  const centerLocal = new THREE.Vector3();
  bbLocal.getCenter(centerLocal);
  // Shift the inner inside the wrapper so mesh base-center ends up at
  // the wrapper's local origin. Now TransformControls, which draws the
  // gizmo at outer.position, lands on the visible object.
  innerGroup.position.x -= centerLocal.x;
  innerGroup.position.y -= bbLocal.min.y;
  innerGroup.position.z -= centerLocal.z;
  return { outer, sizeLocal };
}

Pixaroma3DEditor.prototype._addImportedGroup = function (innerGroup, typeTag, extraUserData = {}) {
  const THREE = getTHREE();
  this._pushUndo();
  this._id++;

  const { origMaterials, overrideMat } = prepareImportedGroup(innerGroup);

  // Composites build with their pivot already at the base-center origin,
  // so re-centering via wrapImportPivot would drift the pivot every time
  // bumps/arms are asymmetric. For composites: use the built group
  // directly, snap Y so the base lands at y=0, skip XZ recenter.
  // For imports (GLB/OBJ): wrap pivot so gizmo lands on the mesh.
  const isComposite = !!extraUserData.skipPivotWrap;
  let group, sizeLocal;
  if (isComposite) {
    group = innerGroup;
    const bb = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    bb.getSize(size);
    sizeLocal = size;
    if (bb.min.y !== 0) group.position.y -= bb.min.y;
  } else {
    const wrapped = wrapImportPivot(innerGroup);
    group = wrapped.outer;
    sizeLocal = wrapped.sizeLocal;
  }

  // Normalise size — longest axis to ~1.5 world units. Applied on the
  // outer wrapper so the centering offset above (unscaled local coords)
  // scales together with the mesh.
  const maxExtent = Math.max(sizeLocal.x, sizeLocal.y, sizeLocal.z);
  if (maxExtent > 0) {
    group.scale.setScalar(1.5 / maxExtent);
  }

  group.userData = {
    id: this._id,
    name: (extraUserData.name || typeTag).replace(/\.[^.]+$/, ""),
    type: typeTag,
    colorHex: IMPORTED_DEFAULT_COLOR,
    locked: false,
    geoParams: null, // no parametric shape
    keepOriginalMaterials: false,
    _origMaterials: origMaterials,
    _overrideMat: overrideMat,
    ...extraUserData,
  };

  // If the caller asked for original materials (GLB imports + textured
  // OBJs set this via extraUserData), swap them back in BEFORE _select
  // so the Shape-panel checkbox renders already checked.
  if (group.userData.keepOriginalMaterials) {
    this._applyImportMaterialMode?.(group);
  }

  this.scene.add(group);
  this.objects.push(group);
  this._select(group, false);
  this._updateLayers();
  this._updateShadowFrustum?.();
};
