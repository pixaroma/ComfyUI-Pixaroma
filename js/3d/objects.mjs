// ============================================================
// Pixaroma 3D Editor — Object CRUD, selection, color, materials
// ============================================================
import { Pixaroma3DEditor, getTHREE, createLayerItem } from "./core.mjs";
import { buildGeometry, getShapeDefaults } from "./shapes.mjs";
import { isCompositeType, buildComposite } from "./composites.mjs";

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
  // Fixed warm off-white across every new primitive so objects added
  // sequentially match each other. Same hex as the imported-group
  // default (bunny, future imports) — one consistent "default shape
  // colour" throughout the editor.
  const color = new THREE.Color("#f3e8d8");
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
  } else if (
    type === "vase" || type === "bottle" || type === "goblet" ||
    type === "bowl" || type === "plantpot"
  ) {
    // Lathe-geometry vessels: the profile creates an open mouth / deep
    // interior cavity. Without DoubleSide the inside renders as a black
    // hole whenever the camera peeks in or the light grazes the rim.
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
    // Helper: material can be a single Material or an Array<Material>
    // (multi-material meshes, common in GLBs with sub-materials). Arrays
    // have no .dispose, so calling it crashes delete. Fan out here.
    const disposeMat = (m) => {
      if (!m) return;
      if (Array.isArray(m)) m.forEach((mm) => mm?.dispose?.());
      else m.dispose?.();
    };
    if (o.isGroup) {
      o.traverse((c) => {
        if (c.isMesh) {
          c.geometry?.dispose();
          disposeMat(c.material);
        }
      });
    } else {
      o.geometry?.dispose();
      disposeMat(o.material);
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
  const type = src.userData.type;

  // Case 1: parametric primitive (Mesh with own geometry + material)
  if (src.isMesh && src.geometry && src.material) {
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
      geoParams: src.userData.geoParams ? { ...src.userData.geoParams } : null,
    };
    this.scene.add(m);
    this.objects.push(m);
    this._select(m, false);
    this._updateLayers();
    this._updateShadowFrustum?.();
    return;
  }

  // Case 2: composite Group (tree, house, table, etc.) — rebuild from
  // its type + geoParams so the duplicate has fresh independent
  // materials, then copy over the user's override-color tweaks. This
  // matches the initial-add path so the duplicate behaves identically
  // in every way (material toggle works, sliders work, undo works).
  if (isCompositeType(type)) {
    this._id++;
    const newId = this._id;
    const gp = src.userData.geoParams
      ? { ...src.userData.geoParams }
      : {};
    const inner = buildComposite(type, gp);
    // Snapshot everything we need from src BEFORE the async resolves
    // (user could select/delete src in the meantime).
    const savedPos = src.position.clone();
    const savedRot = src.rotation.clone();
    const savedScl = src.scale.clone();
    const savedColor = src.userData.colorHex;
    const savedOverride = src.userData._overrideMat;
    const savedKeep = !!src.userData.keepOriginalMaterials;
    const savedName = src.userData.name;
    import("./importer.mjs").then((mod) => {
      if (this._closed) return;
      const { prepareImportedGroup } = mod;
      const { origMaterials, overrideMat } = prepareImportedGroup(
        inner, savedColor,
      );
      if (savedOverride) {
        overrideMat.color.copy(savedOverride.color);
        overrideMat.roughness = savedOverride.roughness;
        overrideMat.metalness = savedOverride.metalness;
        overrideMat.opacity = savedOverride.opacity;
        overrideMat.transparent = savedOverride.transparent;
      }
      inner.position.copy(savedPos);
      inner.position.x += 1;
      inner.rotation.copy(savedRot);
      inner.scale.copy(savedScl);
      inner.userData = {
        id: newId,
        name: savedName + " copy",
        type,
        colorHex: savedColor,
        locked: false,
        geoParams: gp,
        keepOriginalMaterials: savedKeep,
        _origMaterials: origMaterials,
        _overrideMat: overrideMat,
      };
      this._applyImportMaterialMode?.(inner);
      this.scene.add(inner);
      this.objects.push(inner);
      this._select(inner, false);
      this._updateLayers();
      this._updateShadowFrustum?.();
    });
    return;
  }

  // Case 3: any other Group — bunny, user-imported GLB/OBJ. Deep
  // clone geometry + materials so the duplicate doesn't share mutable
  // GPU resources with the source, and rebuild the _origMaterials /
  // _overrideMat bookkeeping from the fresh cloned materials so the
  // "Use Original Material" toggle keeps working on the duplicate.
  if (src.isGroup) {
    const clone = src.clone(true);
    const newOrigMaterials = [];
    clone.traverse((c) => {
      if (c.isMesh) {
        c.geometry = c.geometry.clone();
        if (Array.isArray(c.material)) {
          c.material = c.material.map((m) => m.clone());
        } else if (c.material) {
          c.material = c.material.clone();
        }
        newOrigMaterials.push(c.material);
        c.castShadow = true;
        c.receiveShadow = true;
      }
    });
    clone.position.copy(src.position);
    clone.position.x += 1;
    clone.rotation.copy(src.rotation);
    clone.scale.copy(src.scale);
    this._id++;
    const newOverride = src.userData._overrideMat
      ? src.userData._overrideMat.clone()
      : null;
    clone.userData = {
      ...src.userData,
      id: this._id,
      name: (src.userData.name || type) + " copy",
      locked: false,
      geoParams: src.userData.geoParams ? { ...src.userData.geoParams } : null,
      _origMaterials: newOrigMaterials,
      _overrideMat: newOverride,
    };
    this.scene.add(clone);
    this.objects.push(clone);
    this._select(clone, false);
    this._updateLayers();
    this._updateShadowFrustum?.();
    return;
  }
};

// Drop the selected object(s) onto the ground plane — computes each
// object's world-space bounding box and shifts position.y so the box's
// min.y lands at y = 0. Works for any selection: single mesh, imported
// group, composite, multi-select. Locked objects are skipped.
Pixaroma3DEditor.prototype._dropToFloor = function () {
  const THREE = getTHREE();
  if (!this.selectedObjs.size && !this.activeObj) return;
  const targets = this.selectedObjs.size
    ? [...this.selectedObjs]
    : [this.activeObj];
  // Filter out locked objects first so we don't push an undo entry
  // when nothing will actually move.
  const movable = targets.filter((o) => !o.userData.locked);
  if (!movable.length) return;
  this._pushUndo();
  for (const o of movable) {
    // Refresh the world matrix before measuring — otherwise the
    // bounding box is computed from stale matrices when the object
    // was moved just before this call (keyboard shortcut immediately
    // after a slider change, etc.).
    o.updateMatrixWorld(true);
    // precise=true iterates actual vertex positions instead of the
    // looser "transform the 8 corners of the local bbox" shortcut.
    // For rotated objects those two differ dramatically — a rotated
    // sphere's loose bbox extends √2× further along Y than the true
    // silhouette, which made drop-to-floor undershoot and leave the
    // object floating. precise=true gives the tight world AABB so
    // position.y -= bb.min.y lands the actual lowest vertex at y=0.
    const bb = new THREE.Box3().setFromObject(o, true);
    if (!isFinite(bb.min.y)) continue;
    o.position.y -= bb.min.y;
  }
  this._syncProps();
  this._updateShadowFrustum?.();
};

// ─── Align & Distribute ─────────────────────────────────────
// Operates on the multi-selection. Each object's world-space AABB is
// measured with precise=true so rotated objects align by their actual
// silhouette, not a loose rotated-box approximation. Locked objects
// are skipped. Single-select or zero-select = no-op (needs 2+ to align
// and 3+ to distribute meaningfully).
Pixaroma3DEditor.prototype._alignSelected = function (axis, mode) {
  const THREE = getTHREE();
  const ax = axis.toLowerCase();
  if (!["x", "y", "z"].includes(ax)) return;
  if (!["min", "center", "max"].includes(mode)) return;
  const movable = [...this.selectedObjs].filter((o) => !o.userData.locked);
  if (movable.length < 2) {
    this._setStatus?.("Align: select 2+ objects first");
    return;
  }

  const bounds = movable.map((o) => {
    o.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(o, true);
    return { obj: o, min: bb.min[ax], max: bb.max[ax] };
  });
  const globalMin = Math.min(...bounds.map((b) => b.min));
  const globalMax = Math.max(...bounds.map((b) => b.max));
  const globalCenter = (globalMin + globalMax) / 2;

  this._pushUndo();
  for (const b of bounds) {
    let delta = 0;
    if (mode === "min") delta = globalMin - b.min;
    else if (mode === "max") delta = globalMax - b.max;
    else if (mode === "center") delta = globalCenter - (b.min + b.max) / 2;
    b.obj.position[ax] += delta;
  }
  this._updateTransformSliders?.();
  this._updateShadowFrustum?.();
  this._syncProps?.();
  // Human-readable feedback. Uses the same min/center/max words as
  // the tooltip so the user can confirm the exact action.
  const label = { min: "Min", center: "Center", max: "Max" }[mode];
  this._setStatus?.(
    `Aligned ${movable.length} objects to ${axis} ${label}`,
  );
};

// Distribute: evenly space the selected objects' centers along an axis.
// The two extremes (lowest and highest center on that axis) stay put,
// and the middle objects slide to equal spacing between them. Needs
// 3+ objects — with fewer it's already distributed (or degenerate).
Pixaroma3DEditor.prototype._distributeSelected = function (axis) {
  const THREE = getTHREE();
  const ax = axis.toLowerCase();
  if (!["x", "y", "z"].includes(ax)) return;
  const movable = [...this.selectedObjs].filter((o) => !o.userData.locked);
  if (movable.length < 3) return;

  const bounds = movable.map((o) => {
    o.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(o, true);
    return { obj: o, center: (bb.min[ax] + bb.max[ax]) / 2 };
  });
  bounds.sort((a, b) => a.center - b.center);
  const first = bounds[0].center;
  const last = bounds[bounds.length - 1].center;
  const step = (last - first) / (bounds.length - 1);

  this._pushUndo();
  for (let i = 1; i < bounds.length - 1; i++) {
    const target = first + step * i;
    bounds[i].obj.position[ax] += target - bounds[i].center;
  }
  this._updateTransformSliders?.();
  this._updateShadowFrustum?.();
  this._syncProps?.();
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
  // Align/distribute bar depends on how many objects are selected.
  this._updateAlignButtons?.();
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

// Flip the Object Color + Materials panels' interactivity based on
// whether there's an active object. When nothing is selected the
// inputs render grayed out and can't be edited — matches the Shape
// panel's "Select an object…" placeholder behaviour and avoids the
// confusing state where a color-picker change would silently apply
// to nothing.
Pixaroma3DEditor.prototype._setObjectPanelsEnabled = function (enabled) {
  const el = this.el;
  const opacity = enabled ? "1" : "0.4";
  const pointer = enabled ? "" : "none";
  const toggle = (node) => {
    if (!node) return;
    node.disabled = !enabled;
    node.style.opacity = opacity;
    node.style.pointerEvents = pointer;
  };
  toggle(el.objColor);
  toggle(el.objName);
  toggle(el.hslH); toggle(el.hslS); toggle(el.hslL);
  toggle(el.roughS); toggle(el.roughV);
  toggle(el.glossS); toggle(el.glossV);
  toggle(el.opacS);  toggle(el.opacV);
  toggle(el.delBtn);
  if (el.matBtns) for (const b of el.matBtns) toggle(b);
};

// Format a transform-slider value for the number input box. Integer
// step (rotation in whole degrees) → no decimals; floats → 2dp.
Pixaroma3DEditor.prototype._formatXformValue = function (v) {
  return Number.isInteger(v) ? String(v) : (+v).toFixed(2);
};

// Configure the per-axis X / Y / Z sliders under Transform Tools for
// the current mode, and populate them from the active object's
// transform. Also called on every gizmo-drag tick so the sliders
// track the 3D manipulator in real time.
Pixaroma3DEditor.prototype._updateTransformSliders = function () {
  const slots = this.el.xformSliders;
  if (!slots) return;
  const obj = this.activeObj;
  const mode = this.toolMode;
  const locked = !obj || !!obj.userData?.locked;
  const fmt = (v) => this._formatXformValue(v);
  // Lock Proportions is only meaningful in Scale mode — hide the
  // checkbox row in Move / Rotate so it doesn't look like a dead
  // option the user can toggle without effect.
  if (this.el.xformUniformRow) {
    this.el.xformUniformRow.style.display =
      mode === "scale" ? "flex" : "none";
  }
  for (const { label, slider, numIn, axis } of slots) {
    const axLower = axis.toLowerCase();
    let min, max, step, val, prefix;
    if (mode === "rotate") {
      min = -180; max = 180; step = 1; prefix = "Rot";
      val = obj ? (obj.rotation[axLower] * 180) / Math.PI : 0;
    } else if (mode === "scale") {
      min = 0.1; max = 5; step = 0.01; prefix = "Scale";
      val = obj ? obj.scale[axLower] : 1;
    } else {
      // Default: move
      min = -10; max = 10; step = 0.05; prefix = "Pos";
      val = obj ? obj.position[axLower] : 0;
    }
    label.textContent = `${prefix} ${axis}`;
    slider.min = min; slider.max = max; slider.step = step;
    slider.value = val;
    slider.disabled = locked;
    numIn.min = min; numIn.max = max; numIn.step = step;
    numIn.value = fmt(val);
    numIn.disabled = locked;
  }
};

Pixaroma3DEditor.prototype._syncProps = function () {
  // Transform sliders follow every selection / transform change too
  this._updateTransformSliders?.();
  const o = this.activeObj;
  if (!o) {
    // Browser <input type=color> requires "#rrggbb" — the shorthand
    // "#888" triggers a console warning even though it renders fine.
    if (this.el.objColor) this.el.objColor.value = "#888888";
    if (this.el.objName) this.el.objName.value = "";
    this._setObjectPanelsEnabled(false);
    return;
  }
  this._setObjectPanelsEnabled(true);
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

// ─── Layer-panel mini thumbnail renderer ─────────────────────────
// Complex objects (Bunny, Rock, Teapot, Gear, Blob, Terrain, imported
// GLB/OBJ, composites) get a 28×28 offscreen WebGL render instead of
// a flat colour dot, so layer items read as "a tree / a rock / a
// chair" at a glance. Simple primitives keep the colour swatch.
//
// The renderer is a single extra WebGLRenderer kept per editor instance
// (creating one per thumbnail would churn GPU contexts). Thumbnails
// are cached on obj.userData._thumbCache keyed by a string that captures
// everything that can change the render — type, colour, geoParams,
// scale, material mode. Cache invalidates in _rebuildObjectGeometry
// and _rebuildCompositeGroup.
// Internal render size — 2× the 28px display so browser downscaling
// smooths edges instead of showing pixel stairs. Bigger than this
// just burns fill-rate without visible gain at the display size.
const THUMB_RENDER_PX = 56;
const THUMB_DISPLAY_PX = 28;

Pixaroma3DEditor.prototype._getThumbRenderer = function () {
  const THREE = getTHREE();
  if (this._thumbRenderer) return this._thumbRenderer;
  const r = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  r.setSize(THUMB_RENDER_PX, THUMB_RENDER_PX);
  r.setClearColor(0x000000, 0);
  this._thumbRenderer = r;
  return r;
};

Pixaroma3DEditor.prototype._generateThumbnail = function (obj) {
  const THREE = getTHREE();
  // Cache key: any field that can change the render must be in here.
  const ud = obj.userData || {};
  const cacheKey = [
    ud.type,
    ud.colorHex || "",
    JSON.stringify(ud.geoParams || {}),
    obj.scale.x.toFixed(3),
    obj.scale.y.toFixed(3),
    obj.scale.z.toFixed(3),
    ud._useOriginalMaterials ? "orig" : "override",
  ].join("|");
  if (ud._thumbCacheKey === cacheKey && ud._thumbCache) {
    return ud._thumbCache;
  }
  try {
    const r = this._getThumbRenderer();
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

    // Deep-clone the object so the thumbnail render doesn't touch the
    // live scene. clone(true) shares geometry + material references
    // with the original, which is fine — we don't mutate either, and
    // leaving the original materials intact means lighting / colour
    // matches the live viewport.
    const clone = obj.clone(true);
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    // Keep scale so stretched objects (e.g. squashed blobs) read the
    // same in the thumb as they do in the viewport.
    scene.add(clone);

    // Auto-frame: fit the world AABB into the mini camera.
    const box = new THREE.Box3().setFromObject(clone, true);
    if (box.isEmpty()) return null;
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    // Shift the clone so its bbox centre sits at the origin — gives
    // a balanced framing regardless of the object's pivot.
    clone.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 1.6 + 0.3;
    cam.position.set(dist, dist * 0.7, dist);
    cam.lookAt(0, 0, 0);

    const amb = new THREE.AmbientLight(0xffffff, 0.6);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(1, 2, 1);
    scene.add(amb, dir);

    r.render(scene, cam);
    const url = r.domElement.toDataURL("image/png");

    ud._thumbCache = url;
    ud._thumbCacheKey = cacheKey;
    return url;
  } catch (e) {
    console.warn("[P3D] thumbnail render failed", e);
    return null;
  }
};

Pixaroma3DEditor.prototype._updateLayers = function () {
  if (!this._layerPanel) return;
  const items = this.objects.map((obj, i) => {
    const isActive = obj === this.activeObj;
    const isMulti = this.selectedObjs.has(obj) && !isActive;

    // Thumbnail: mini 3D render for every object (primitives,
    // composites, imports all get a live render). Cached on userData
    // so repeated _updateLayers calls don't re-render unless the
    // geometry / color / scale / material changed.
    let thumbnail;
    const url = this._generateThumbnail(obj);
    if (url) {
      thumbnail = document.createElement("img");
      thumbnail.src = url;
      thumbnail.style.cssText =
        `width:${THUMB_DISPLAY_PX}px;height:${THUMB_DISPLAY_PX}px;border-radius:3px;border:1px solid #555;flex-shrink:0;background:#2a2c2e;object-fit:contain;image-rendering:auto;`;
    } else {
      // Render failed (no WebGL / context lost) — fall back to colour dot.
      thumbnail = document.createElement("div");
      thumbnail.className = "p3d-layer-color";
      thumbnail.style.background = obj.userData.colorHex || "#888";
    }

    return createLayerItem({
      name: obj.userData.name || "Object",
      visible: obj.visible,
      locked: !!obj.userData.locked,
      active: isActive,
      multiSelected: isMulti,
      thumbnail: thumbnail,
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
