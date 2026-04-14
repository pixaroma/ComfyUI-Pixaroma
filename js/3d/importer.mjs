// ============================================================
// Pixaroma 3D Editor — Model importer (GLB / OBJ)
// Lazy-loads GLTFLoader / OBJLoader from esm.sh on first use.
// Caches models loaded from static asset URLs (e.g. the built-in
// bunny) so repeat Bunny clicks don't refetch / re-parse.
// ============================================================
import { Pixaroma3DEditor, getTHREE } from "./core.mjs";

const ESM = "https://esm.sh/three@0.170.0";

let _GLTFLoader = null;
let _OBJLoader = null;
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

// Recompute smooth vertex normals on every Mesh in a Group. GLB/OBJ
// files often ship with flat-shaded or missing normals; smoothing
// here gives the built-in Bunny and user imports a consistent look.
export function smoothGroupNormals(group) {
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeVertexNormals();
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
  smoothGroupNormals(group);
  _assetCache.set(url, group.clone(true));
  return group;
}

// Load an OBJ by URL. Returns a Group. (Used in Task 8 for uploads;
// kept here so the importer module owns every model format.)
export async function loadOBJFromURL(url) {
  const Loader = await getOBJLoader();
  const loader = new Loader();
  const group = await loader.loadAsync(url);
  smoothGroupNormals(group);
  return group;
}

// Mixin — add an imported Group to the scene using the same plumbing
// as parametric shapes (undo, layer entry, selection, shadow frustum).
//
// `typeTag` is stored on userData.type — "bunny" for the bundled
// bunny, "import" for user uploads (Task 8). The Shape panel uses
// this to show the "No shape parameters for imported models." empty
// state rather than parametric sliders.
Pixaroma3DEditor.prototype._addImportedGroup = function (group, typeTag, extraUserData = {}) {
  const THREE = getTHREE();
  this._pushUndo();
  this._id++;

  // Shadow flags on every mesh in the hierarchy.
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  // Sit the group on the floor by its axis-aligned bounding box,
  // same convention as parametric shapes. Box3.setFromObject walks
  // the group hierarchy and accounts for mesh transforms.
  const box = new THREE.Box3().setFromObject(group);
  group.position.y = -box.min.y;

  group.userData = {
    id: this._id,
    name: (extraUserData.name || typeTag).replace(/\.[^.]+$/, ""),
    type: typeTag,
    colorHex: "#ffffff",
    locked: false,
    geoParams: null, // no parametric shape
    keepOriginalMaterials: true, // Task 8 may expose a toggle
    ...extraUserData,
  };

  this.scene.add(group);
  this.objects.push(group);
  this._select(group, false);
  this._updateLayers();
  this._updateShadowFrustum?.();
};
