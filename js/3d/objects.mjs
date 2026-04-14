// ============================================================
// Pixaroma 3D Editor — Object CRUD, selection, color, materials
// ============================================================
import { Pixaroma3DEditor, getTHREE, createLayerItem } from "./core.mjs";
import { buildGeometry, getShapeDefaults } from "./shapes.mjs";

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
  const color = new THREE.Color().setHSL(
    Math.random() * 0.1 + 0.06,
    0.45,
    0.62,
  );
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
  mesh.position.y = type === "plane" ? 0.01 : 0.6;
  if (type === "plane") mesh.rotation.x = -Math.PI / 2;
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
    o.geometry.dispose();
    o.material.dispose();
    this.objects = this.objects.filter((x) => x !== o);
  }
  this.selectedObjs.clear();
  this.activeObj = null;
  this._updateLayers();
  this._syncProps();
  // Shape panel sliders reference the deleted object's geoParams — wipe
  // them so the right sidebar shows the "Select an object…" placeholder
  // immediately instead of lingering until the next click.
  if (this._rebuildShapePanel) this._rebuildShapePanel();
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
  if (!additive) {
    for (const o of this.selectedObjs) o.material.emissive?.setHex(0x000000);
    this.selectedObjs.clear();
  }
  if (mesh) {
    if (this.selectedObjs.has(mesh) && additive) {
      mesh.material.emissive?.setHex(0x000000);
      this.selectedObjs.delete(mesh);
      this.activeObj =
        this.selectedObjs.size > 0 ? [...this.selectedObjs][0] : null;
    } else {
      this.selectedObjs.add(mesh);
      mesh.material.emissive?.setHex(0x3a1f00);
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
  if (this._rebuildShapePanel) this._rebuildShapePanel();
};

Pixaroma3DEditor.prototype._setObjColor = function (hex) {
  if (!this.activeObj) return;
  for (const o of this.selectedObjs) {
    o.material.color.set(hex);
    o.userData.colorHex = hex;
  }
  this._syncHSLFromColor();
  this._updateLayers();
};

Pixaroma3DEditor.prototype._hslToColor = function () {
  const THREE = getTHREE();
  if (!this.activeObj) return;
  const h = (this.el.hslH?.value || 0) / 360,
    s = (this.el.hslS?.value || 0) / 100,
    l = (this.el.hslL?.value || 0) / 100;
  const c = new THREE.Color().setHSL(h, s, l);
  const hex = "#" + c.getHexString();
  for (const o of this.selectedObjs) {
    o.material.color.copy(c);
    o.userData.colorHex = hex;
  }
  if (this.el.objColor) this.el.objColor.value = hex;
  this._updateLayers();
};

Pixaroma3DEditor.prototype._syncHSLFromColor = function () {
  if (!this.activeObj) return;
  const hsl = {};
  this.activeObj.material.color.getHSL(hsl);
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
    o.material.color.set(p.c);
    o.material.roughness = p.r;
    o.material.metalness = p.m;
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
  if (this.el.objColor)
    this.el.objColor.value =
      o.userData.colorHex || "#" + o.material.color.getHexString();
  if (this.el.objName) this.el.objName.value = o.userData.name || "";
  if (this.el.roughS) {
    const v = Math.round(o.material.roughness * 100);
    this.el.roughS.value = v;
    this.el.roughV.value = v;
  }
  if (this.el.glossS) {
    const v = Math.round((1 - o.material.roughness) * 100);
    this.el.glossS.value = v;
    this.el.glossV.value = v;
  }
  if (this.el.opacS) {
    const v = Math.round(o.material.opacity * 100);
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
