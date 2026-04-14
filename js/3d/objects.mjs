// ============================================================
// Pixaroma 3D Editor — Object CRUD, selection, color, materials
// ============================================================
import { Pixaroma3DEditor, getTHREE, createLayerItem } from "./core.mjs";
import { buildGeometry, getShapeDefaults } from "./shapes.mjs";

// ─── Selection outline ────────────────────────────────────
// Screen-space silhouette outline via three.js OutlinePass (same
// approach Blender / Unity / Unreal use). Works for every shape —
// smooth subdivided surfaces, flat-shaded facets, concave geometry,
// imported meshes — without inverted-hull artifacts.
//
// Sync point: any code that mutates this.selectedObjs should call
// _syncOutlineSelection() at the end so the pass picks up the new
// set of highlighted objects.

Pixaroma3DEditor.prototype._syncOutlineSelection = function () {
  if (this._outlinePass) {
    this._outlinePass.selectedObjects = [...this.selectedObjs];
  }
};

// ─── Objects ──────────────────────────────────────────────

Pixaroma3DEditor.prototype._makeGeo = function (type, gp) {
  const THREE = getTHREE();
  return buildGeometry(THREE, type, gp);
};

Pixaroma3DEditor.prototype._addObject = function (type, gp) {
  const THREE = getTHREE();
  this._pushUndo();
  this._id++;
  if (!gp) gp = this._defaultGeoParams(type);
  const geo = this._makeGeo(type, gp);
  // Fixed Pixaroma clay/cream colour across every new primitive so
  // objects added sequentially match each other. Same hex as the
  // imported-group default (bunny, future imports) so there's a
  // single consistent "default shape colour" throughout the editor.
  const color = new THREE.Color("#c4a882");
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0,
    transparent: true,
    opacity: 1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Sit on the floor: compute the geometry's bounding box and offset the
  // mesh so its bottom rests at world y=0. Works for every shape —
  // including prism/pyramid which already translate their own bottom to
  // local y=0 (bb.min.y becomes 0, so position.y = 0), and shapes like
  // cube/sphere/cylinder whose geometries are centered on origin.
  if (type === "plane") {
    mesh.position.y = 0.01;
    mesh.rotation.x = -Math.PI / 2;
  } else if (type === "terrain") {
    // Terrain is a thin displaced plane — its lowest vertex sits exactly
    // at y=0 after bounding-box snap, which z-fights the ground. Lift by
    // 0.005 and double-side the material so the underside is visible
    // when the camera dips below the terrain.
    geo.computeBoundingBox();
    mesh.position.y = -geo.boundingBox.min.y + 0.005;
    mat.side = THREE.DoubleSide;
  } else if (type === "teapot") {
    // Teapot is a hollow shell — looking down through the lid hole or
    // into the spout, the interior is invisible without DoubleSide.
    geo.computeBoundingBox();
    mesh.position.y = -geo.boundingBox.min.y;
    mat.side = THREE.DoubleSide;
  } else {
    geo.computeBoundingBox();
    mesh.position.y = -geo.boundingBox.min.y;
  }
  mesh.userData = {
    id: this._id,
    name: type.charAt(0).toUpperCase() + type.slice(1) + " " + this._id,
    type,
    colorHex: "#" + color.getHexString(),
    locked: false,
    geoParams: { ...gp },
  };
  this.scene.add(mesh);
  this.objects.push(mesh);
  this._select(mesh, false);
  this._updateLayers();
  // Snap the directional-light shadow frustum to the new scene bounds
  // right now so the very first shadow frame is correct. Without this
  // the shadow renders with the previous (wider) frustum until the 1s
  // setInterval fires, which reads as a "shadow jump" to the user.
  this._updateShadowFrustum?.();
};

Pixaroma3DEditor.prototype._defaultGeoParams = function (type) {
  return getShapeDefaults(type);
};

Pixaroma3DEditor.prototype._deleteSelected = function () {
  if (!this.selectedObjs.size) return;
  this._pushUndo();
  this.transformCtrl.detach();
  for (const o of this.selectedObjs) {
    this.scene.remove(o);
    // Dispose works for both Mesh (geometry + material directly) and
    // imported Groups (walk the hierarchy). Without the traverse path
    // bunnies leaked GPU resources on delete and crashed the Shape /
    // undo machinery on the next add.
    if (o.isGroup) {
      o.traverse((c) => {
        if (c.isMesh) {
          c.geometry?.dispose();
          c.material?.dispose();
        }
      });
    } else {
      o.geometry?.dispose();
      o.material?.dispose();
    }
    this.objects = this.objects.filter((x) => x !== o);
  }
  this.selectedObjs.clear();
  this.activeObj = null;
  this._updateLayers();
  this._syncProps();
  this._syncOutlineSelection();
  // Shape panel sliders reference the deleted object's geoParams — wipe
  // them so the right sidebar shows the "Select an object…" placeholder
  // immediately instead of lingering until the next click.
  if (this._rebuildShapePanel) this._rebuildShapePanel();
  this._updateShadowFrustum?.();
};

Pixaroma3DEditor.prototype._dupSelected = function () {
  const THREE = getTHREE();
  if (!this.activeObj) return;
  this._pushUndo();
  const src = this.activeObj;
  const m = new THREE.Mesh(src.geometry.clone(), src.material.clone());
  m.position.copy(src.position);
  m.position.x += 1;
  m.rotation.copy(src.rotation);
  m.scale.copy(src.scale);
  m.castShadow = true;
  m.receiveShadow = true;
  this._id++;
  m.userData = {
    ...src.userData,
    id: this._id,
    name: src.userData.name + " copy",
    locked: false,
  };
  this.scene.add(m);
  this.objects.push(m);
  this._select(m, false);
  this._updateLayers();
};

Pixaroma3DEditor.prototype._select = function (mesh, additive) {
  if (!additive) this.selectedObjs.clear();
  if (mesh) {
    if (this.selectedObjs.has(mesh) && additive) {
      this.selectedObjs.delete(mesh);
      this.activeObj =
        this.selectedObjs.size > 0 ? [...this.selectedObjs][0] : null;
    } else {
      this.selectedObjs.add(mesh);
      this.activeObj = mesh;
    }
  } else {
    this.activeObj = null;
  }
  if (this.activeObj && !this.activeObj.userData.locked)
    this.transformCtrl.attach(this.activeObj);
  else this.transformCtrl.detach();
  this._syncProps();
  this._updateLayers();
  this._syncOutlineSelection();
  if (this._rebuildShapePanel) this._rebuildShapePanel();
};

Pixaroma3DEditor.prototype._setObjColor = function (hex) {
  if (!this.activeObj) return;
  for (const o of this.selectedObjs) {
    // Mesh: set its own material. Group (imported bunny / future
    // user imports): traverse and set colour on every mesh inside.
    if (o.material && o.material.color) {
      o.material.color.set(hex);
    } else if (o.isGroup) {
      o.traverse((c) => {
        if (c.isMesh && c.material && c.material.color) {
          c.material.color.set(hex);
        }
      });
    }
    o.userData.colorHex = hex;
  }
  this._syncHSLFromColor();
  this._updateLayers();
};

// Helpers — an imported Group has no top-level .material, so the
// Object Color / Material / HSL panels (which operate on a single
// material) need to reach into the first mesh in the hierarchy for
// reads and walk every mesh for writes.
function firstMeshMaterial(o) {
  if (o.material) return o.material;
  if (o.isGroup) {
    let found = null;
    o.traverse((c) => {
      if (!found && c.isMesh && c.material) found = c.material;
    });
    return found;
  }
  return null;
}
function applyToMaterials(o, fn) {
  if (o.material) {
    fn(o.material);
  } else if (o.isGroup) {
    o.traverse((c) => {
      if (c.isMesh && c.material) fn(c.material);
    });
  }
}

Pixaroma3DEditor.prototype._hslToColor = function () {
  const THREE = getTHREE();
  if (!this.activeObj) return;
  const h = (this.el.hslH?.value || 0) / 360,
    s = (this.el.hslS?.value || 0) / 100,
    l = (this.el.hslL?.value || 0) / 100;
  const c = new THREE.Color().setHSL(h, s, l);
  const hex = "#" + c.getHexString();
  for (const o of this.selectedObjs) {
    applyToMaterials(o, (m) => m.color?.copy(c));
    o.userData.colorHex = hex;
  }
  if (this.el.objColor) this.el.objColor.value = hex;
  this._updateLayers();
};

Pixaroma3DEditor.prototype._syncHSLFromColor = function () {
  if (!this.activeObj) return;
  const mat = firstMeshMaterial(this.activeObj);
  if (!mat || !mat.color) return;
  const hsl = {};
  mat.color.getHSL(hsl);
  if (this.el.hslH) {
    this.el.hslH.value = Math.round(hsl.h * 360);
    this.el.hslHV.textContent = Math.round(hsl.h * 360);
  }
  if (this.el.hslS) {
    this.el.hslS.value = Math.round(hsl.s * 100);
    this.el.hslSV.textContent = Math.round(hsl.s * 100);
  }
  if (this.el.hslL) {
    this.el.hslL.value = Math.round(hsl.l * 100);
    this.el.hslLV.textContent = Math.round(hsl.l * 100);
  }
};

// ─── Materials ────────────────────────────────────────────

Pixaroma3DEditor.prototype._applyMat = function (p) {
  if (!this.activeObj) return;
  for (const o of this.selectedObjs) {
    applyToMaterials(o, (m) => {
      m.color?.set(p.c);
      if ("roughness" in m) m.roughness = p.r;
      if ("metalness" in m) m.metalness = p.m;
    });
    o.userData.colorHex = p.c;
  }
  this._syncProps();
};

// ─── Panels ───────────────────────────────────────────────

Pixaroma3DEditor.prototype._syncProps = function () {
  const o = this.activeObj;
  if (!o) {
    if (this.el.objColor) this.el.objColor.value = "#888";
    if (this.el.objName) this.el.objName.value = "";
    return;
  }
  // Look up the material for panel reads — imported groups' first
  // mesh, otherwise the object's own .material.
  const mat = firstMeshMaterial(o);
  if (this.el.objColor)
    this.el.objColor.value =
      o.userData.colorHex ||
      (mat?.color ? "#" + mat.color.getHexString() : "#888888");
  if (this.el.objName) this.el.objName.value = o.userData.name || "";
  const rough = mat?.roughness ?? 0.55;
  if (this.el.roughS) {
    const v = Math.round(rough * 100);
    this.el.roughS.value = v;
    this.el.roughV.value = v;
  }
  if (this.el.glossS) {
    const v = Math.round((1 - rough) * 100);
    this.el.glossS.value = v;
    this.el.glossV.value = v;
  }
  if (this.el.opacS) {
    const v = Math.round((mat?.opacity ?? 1) * 100);
    this.el.opacS.value = v;
    this.el.opacV.value = v;
  }
  this._syncHSLFromColor();
};

Pixaroma3DEditor.prototype._updateLayers = function () {
  if (!this._layerPanel) return;
  const items = this.objects.map((obj, i) => {
    const isActive = obj === this.activeObj;
    const isMulti = this.selectedObjs.has(obj) && !isActive;

    // Color swatch thumbnail
    const dot = document.createElement("div");
    dot.className = "p3d-layer-color";
    dot.style.background = obj.userData.colorHex || "#888";

    return createLayerItem({
      name: obj.userData.name || "Object",
      visible: obj.visible,
      locked: !!obj.userData.locked,
      active: isActive,
      multiSelected: isMulti,
      thumbnail: dot,
      onVisibilityToggle: () => {
        obj.visible = !obj.visible;
        this._updateLayers();
      },
      onLockToggle: () => {
        obj.userData.locked = !obj.userData.locked;
        if (obj.userData.locked && obj === this.activeObj)
          this.transformCtrl.detach();
        this._updateLayers();
        if (this._rebuildShapePanel) this._rebuildShapePanel();
      },
      onClick: (e) => {
        if (e.detail > 1) return;
        this._select(obj, e.shiftKey || e.ctrlKey);
      },
      onRename: (newName) => {
        obj.userData.name = newName;
        this._syncProps();
      },
    }).el;
  });
  this._layerPanel.refresh(items);
};
