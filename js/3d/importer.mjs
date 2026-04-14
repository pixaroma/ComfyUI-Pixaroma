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
  let group;
  if (mainExt === "obj") {
    // Optional MTL companion. Load it first so OBJLoader picks up the
    // materials. Textures referenced by filename in the .mtl are
    // remapped to their uploaded /view URLs via LoadingManager's
    // setURLModifier — the backend preserves original filenames so
    // the lookup works on lowercased basenames.
    const mtlFile = fileArray.find((f) => /\.mtl$/i.test(f.name));
    const OBJLoader = await getOBJLoader();
    const objLoader = new OBJLoader();
    if (mtlFile) {
      const mtlUp = uploaded.find((u) => u.origName === mtlFile.name);
      if (mtlUp) {
        const MTLLoader = await getMTLLoader();
        // Build a basename → uploaded-URL map for every companion we
        // uploaded. MTLLoader / its TextureLoader will request each
        // texture by its relative name; we intercept and redirect.
        const textureMap = new Map();
        for (const u of uploaded) {
          textureMap.set(u.origName.toLowerCase(), u.url);
        }
        const manager = new THREE.LoadingManager();
        manager.setURLModifier((url) => {
          const name = url.split("/").pop().split("?")[0].toLowerCase();
          return textureMap.get(name) || url;
        });
        const mtlLoader = new MTLLoader(manager);
        const materials = await mtlLoader.loadAsync(mtlUp.url);
        materials.preload();
        objLoader.setMaterials(materials);
      }
    }
    group = await objLoader.loadAsync(mainUp.url);
    await smoothGroupNormals(group);
  } else {
    // GLB/GLTF — all materials + textures are embedded in the file.
    group = await loadGLBFromURL(mainUp.url);
  }

  editor._addImportedGroup(group, "import", {
    name: mainFile.name,
    importPath: mainUp.path,
    importExt: mainExt,
  });
  // If an MTL / textures came in, default to showing original materials
  // (user bothered to provide them; they probably want to see them).
  const active = editor.activeObj;
  if (active && mainExt === "obj"
      && fileArray.some((f) => /\.mtl$/i.test(f.name))) {
    active.userData.keepOriginalMaterials = true;
    editor._applyImportMaterialMode?.(active);
  }
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
    transparent: true,
    opacity: 1,
  });
  group.traverse((o) => {
    if (o.isMesh) o.material = overrideMat;
  });
  return { origMaterials, overrideMat };
}

Pixaroma3DEditor.prototype._addImportedGroup = function (group, typeTag, extraUserData = {}) {
  const THREE = getTHREE();
  this._pushUndo();
  this._id++;

  const { origMaterials, overrideMat } = prepareImportedGroup(group);

  // Normalise the imported group's size so it comes in at a sensible
  // scale next to the parametric shapes. Imported GLBs are often
  // authored in very different unit systems (bunny ships at ~0.2 m
  // tall, user uploads can be huge). Compute the group's bounding
  // box, then uniformly scale so the longest axis is ~1.5 world
  // units — roughly the size of a default cube.
  const bbPre = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  bbPre.getSize(size);
  const maxExtent = Math.max(size.x, size.y, size.z);
  if (maxExtent > 0) {
    const target = 1.5;
    const s = target / maxExtent;
    group.scale.setScalar(s);
    group.updateMatrixWorld(true);
  }
  // Now sit the (rescaled) group on the floor.
  const box = new THREE.Box3().setFromObject(group);
  group.position.y = -box.min.y;

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

  this.scene.add(group);
  this.objects.push(group);
  this._select(group, false);
  this._updateLayers();
  this._updateShadowFrustum?.();
};
