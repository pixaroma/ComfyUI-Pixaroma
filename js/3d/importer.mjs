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

// Mixin — add an imported Group to the scene using the same plumbing
// as parametric shapes (undo, layer entry, selection, shadow frustum).
//
// `typeTag` is stored on userData.type — "bunny" for the bundled
// bunny, "import" for user uploads (Task 8). The Shape panel uses
// this to show the "No shape parameters for imported models." empty
// state rather than parametric sliders.
// Default cream/clay colour applied to bunny + user imports so they
// match the look of the parametric shapes (which randomise around
// this hue). Without this, GLBs came out the dull neutral gray that
// three.js GLTFLoader uses when the file ships without a baseColor.
const IMPORTED_DEFAULT_COLOR = "#c4a882";

Pixaroma3DEditor.prototype._addImportedGroup = function (group, typeTag, extraUserData = {}) {
  const THREE = getTHREE();
  this._pushUndo();
  this._id++;

  // Shadow flags + default clay colour on every mesh in the hierarchy.
  // We override the GLB's materials (the bundled bunny.glb has plain
  // unlit materials) so imported objects look consistent with the rest
  // of the scene. The user can still recolour via the Object Color
  // panel; keepOriginalMaterials is stored for future "restore GLB
  // materials" toggle.
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material && o.material.color) {
        o.material.color.set(IMPORTED_DEFAULT_COLOR);
        o.material.roughness = 0.55;
        o.material.metalness = 0;
      }
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
