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

// Full upload + load + add pipeline for a user-picked File. Uploads
// via ThreeDAPI, constructs the ComfyUI /view URL from the returned
// relative path, loads via GLB or OBJ depending on extension, and
// drops the resulting Group into the editor with type:"import" plus
// the saved path/ext so _serializeScene can restore it later.
export async function importFromFile(editor, file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["glb", "gltf", "obj"].includes(ext)) {
    throw new Error(`Unsupported extension: ${ext}`);
  }
  if (file.size > 50 * 1024 * 1024) {
    throw new Error("File too large (max 50 MB)");
  }

  editor._setStatus?.("Uploading model…");
  const dataURL = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const res = await ThreeDAPI.uploadModel(
    editor.projectId, file.name, dataURL,
  );
  if (res.status !== "success") {
    throw new Error(`Upload failed: ${res.msg || "unknown"}`);
  }

  // res.path = "pixaroma/<project>/models/<hash>.<ext>".
  // Build /view URL with filename + subfolder so ComfyUI serves it.
  const parts = res.path.split("/");
  const fname = parts.pop();
  const subfolder = parts.join("/");
  const url = "/view?filename=" + encodeURIComponent(fname)
            + "&type=input&subfolder=" + encodeURIComponent(subfolder)
            + "&t=" + Date.now();

  editor._setStatus?.("Loading model…");
  const group = ext === "obj"
    ? await loadOBJFromURL(url)
    : await loadGLBFromURL(url);

  editor._addImportedGroup(group, "import", {
    name: file.name,
    importPath: res.path,
    importExt: ext,
  });
  editor._setStatus?.("Model imported");
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

Pixaroma3DEditor.prototype._addImportedGroup = function (group, typeTag, extraUserData = {}) {
  const THREE = getTHREE();
  this._pushUndo();
  this._id++;

  // Shadow flags + uniform MeshStandardMaterial on every mesh. We
  // rebuild the material (rather than mutating in place) because
  // different loaders produce different types — GLBs give us
  // MeshStandardMaterial, OBJLoader gives MeshPhongMaterial by
  // default — and the same scene lights render them very
  // differently. Forcing a StandardMaterial with the Pixaroma clay
  // default makes GLB and OBJ imports look identical under our PBR
  // pipeline.
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.material?.dispose?.();
    o.material = new THREE.MeshStandardMaterial({
      color: IMPORTED_DEFAULT_COLOR,
      roughness: 0.55,
      metalness: 0,
      transparent: true,
      opacity: 1,
    });
  });

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
    ...extraUserData,
  };

  this.scene.add(group);
  this.objects.push(group);
  this._select(group, false);
  this._updateLayers();
  this._updateShadowFrustum?.();
};
