// ============================================================
// Pixaroma 3D Editor — Tools, camera, keyboard, click, undo
// ============================================================
import { Pixaroma3DEditor, getTHREE } from "./core.mjs";
import { isCompositeType, buildComposite } from "./composites.mjs";
// Static import of the SYNCHRONOUS importer helper so the composite
// undo path can rebuild groups without a placeholder-sphere swap
// flicker. (GLB / OBJ / bunny undo still needs the async loaders —
// those stay on the placeholder pattern for now.)
import { prepareImportedGroup } from "./importer.mjs";

// ─── Tools & Camera ───────────────────────────────────────

Pixaroma3DEditor.prototype._setToolMode = function (mode) {
  this.toolMode = mode;
  if (this.transformCtrl)
    this.transformCtrl.setMode(
      { move: "translate", rotate: "rotate", scale: "scale" }[mode] ||
        "translate",
    );
  ["move", "rotate", "scale"].forEach((m) =>
    this.el[`tool_${m}`]?.classList.toggle("active", m === mode),
  );
  const def = this._toolDefs.find((t) => t.id === mode);
  if (this.el.toolInfo && def) this.el.toolInfo.textContent = def.tip;
  // Reconfigure the X/Y/Z sliders for the newly-active mode (the
  // ranges & labels change — Move: -10..10, Rotate: -180..180°,
  // Scale: 0.1..5) and refresh their values from the active object.
  this._updateTransformSliders?.();
};

Pixaroma3DEditor.prototype._camView = function (id) {
  const dist = 6;
  // Orthographic-only zoom override — default is 1 (the camera's own
  // frustum bounds), but the iso view needs ~2× zoom so objects
  // actually fill the 10-unit ortho frustum instead of floating
  // small in the middle with the grid fading off the edges.
  let zoomOverride = 1;
  if (id === "front") {
    this.camera.position.set(0, 1, dist);
    this.orbitCtrl.target.set(0, 1, 0);
  } else if (id === "side") {
    // Right side (+X) — shortcut key 2
    this.camera.position.set(dist, 1, 0);
    this.orbitCtrl.target.set(0, 1, 0);
  } else if (id === "otherside") {
    // Left side (−X) — shortcut key 7 — the side key 2 doesn't show
    this.camera.position.set(-dist, 1, 0);
    this.orbitCtrl.target.set(0, 1, 0);
  } else if (id === "back") {
    this.camera.position.set(0, 1, -dist);
    this.orbitCtrl.target.set(0, 1, 0);
  } else if (id === "top") {
    this.camera.position.set(0, dist + 2, 0.01);
    this.orbitCtrl.target.set(0, 0, 0);
  } else if (id === "perspective3q") {
    // Default perspective view: classic 3/4 angle — slight elevation,
    // slight azimuth, framing whatever's at the world origin.
    this.camera.position.set(4, 3, 5);
    this.orbitCtrl.target.set(0, 1, 0);
  } else if (id === "iso") {
    // True isometric angle: equal X / Y / Z offset from target —
    // azimuth 45°, elevation ≈ 35.264°. Only meaningful under an
    // orthographic camera (shortcut 6 sets that first).
    this.camera.position.set(6, 6, 6);
    this.orbitCtrl.target.set(0, 1, 0);
    zoomOverride = 2;
  } else if (id === "focus" && this.activeObj) {
    // Preserve the CURRENT view direction + distance. Just translate
    // the camera so its target lands on the selected object. The old
    // behavior hard-coded a 3/4 perspective offset (+3, +2, +3),
    // which from a front / iso / top view snapped to a different
    // angle entirely and sometimes pushed the ground grid off the
    // visible frustum.
    const THREE = getTHREE();
    const p = this.activeObj.position;
    const offset = new THREE.Vector3()
      .copy(this.camera.position)
      .sub(this.orbitCtrl.target);
    // Defensive: if current direction is zero (unlikely) fall back
    // to the classic 3/4 offset so we don't end up with camera
    // coincident with the target.
    if (offset.lengthSq() < 1e-6) offset.set(3, 2, 3);
    this.orbitCtrl.target.set(p.x, p.y, p.z);
    this.camera.position.copy(this.orbitCtrl.target).add(offset);
    // Preserve ortho zoom too — reset-to-1 would open the frustum
    // back to its full 10-unit width and chop off the grid edges.
    zoomOverride = this.camera.zoom ?? 1;
  }
  // Force camera orientation to match the new target, THEN apply the
  // zoom override so switching view after iso/persp works cleanly.
  // Previously orbitCtrl.update() alone didn't always reset ortho zoom
  // after _setPerspective had been called, leaving the next view with
  // the wrong frustum size (scene appeared too large / too close).
  this.camera.lookAt(this.orbitCtrl.target);
  if (this._isOrtho && this.camera.zoom !== undefined) {
    this.camera.zoom = zoomOverride;
  }
  this.camera.updateProjectionMatrix?.();
  this.camera.updateMatrixWorld?.();
  this.orbitCtrl.update();
};

Pixaroma3DEditor.prototype._setPerspective = function (persp) {
  const THREE = getTHREE();
  if (persp === !this._isOrtho) return; // Already in this mode
  const vp = this.el.viewport,
    w = vp.clientWidth,
    h = vp.clientHeight;
  const pos = this.camera.position.clone(),
    tgt = this.orbitCtrl.target.clone();
  if (persp) {
    this.camera = new THREE.PerspectiveCamera(this._fov, w / h, 0.1, 1000);
    this._isOrtho = false;
  } else {
    this.camera = new THREE.OrthographicCamera(
      (-5 * w) / h,
      (5 * w) / h,
      5,
      -5,
      0.1,
      1000,
    );
    this._isOrtho = true;
  }
  this.camera.position.copy(pos);
  this.camera.lookAt(tgt);
  // Fresh zoom each swap — orbit scroll accumulates zoom on whichever
  // camera was active and we don't want that to carry over into the
  // newly-created one (especially for ortho where zoom multiplies the
  // frustum, making the scene look huge or tiny at first).
  if (this.camera.zoom !== undefined) this.camera.zoom = 1;
  this.camera.updateProjectionMatrix();
  this.camera.updateMatrixWorld();
  this.orbitCtrl.object = this.camera;
  this.orbitCtrl.update();
  this.transformCtrl.camera = this.camera;
  // CRITICAL: the EffectComposer's passes also cache camera references.
  // Without updating them, the composer keeps rendering with the OLD
  // camera after a swap — view keys move the new camera but the output
  // never changes, so it looks like shortcuts "stop working" post-6.
  if (this._renderPass) this._renderPass.camera = this.camera;
  if (this._outlinePass) this._outlinePass.renderCamera = this.camera;
  this.el.perspBtn?.classList.toggle("active", !this._isOrtho);
  this.el.isoBtn?.classList.toggle("active", this._isOrtho);
  // FOV is only meaningful for perspective cameras — ortho has no
  // field-of-view concept. Gray out the row and disable the inputs
  // so the user can tell the slider has no effect while in iso mode.
  const fovRow = this.el.fovRow;
  if (fovRow) {
    fovRow.style.opacity = this._isOrtho ? "0.4" : "1";
    fovRow.style.pointerEvents = this._isOrtho ? "none" : "";
  }
  if (this.el.fovSlider) this.el.fovSlider.disabled = this._isOrtho;
  if (this.el.fovVal) this.el.fovVal.disabled = this._isOrtho;
};

// ─── Interaction ──────────────────────────────────────────

Pixaroma3DEditor.prototype._onClick = function (e) {
  const THREE = getTHREE();
  const rect = this.renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouse, this.camera);
  const hits = ray.intersectObjects(this.objects, true);
  if (hits.length > 0) {
    // Imported Groups (bunny, user imports) have child meshes; a
    // raycast returns the child, but only the Group is tracked in
    // this.objects. Walk the ancestry up until we find the node that
    // actually lives in our object list — that's the selectable
    // target. Parametric meshes are their own match on the first
    // iteration.
    let target = hits[0].object;
    while (target && !this.objects.includes(target)) target = target.parent;
    if (target) this._select(target, e.shiftKey);
  } else {
    this.selectedObjs.clear();
    this.activeObj = null;
    this.transformCtrl.detach();
    this._syncProps();
    this._updateLayers();
    this._syncOutlineSelection();
    if (this._rebuildShapePanel) this._rebuildShapePanel();
  }
};

Pixaroma3DEditor.prototype._handleKey = function (e) {
  if (!this.el.overlay?.parentNode) return;
  // Check if focus is on an input element inside our overlay
  const ae = document.activeElement;
  const tag = ae?.tagName;
  const isTrap = ae?.dataset?.pixaromaTrap;
  // For Ctrl+A: always handle it if our overlay is open (prevent selecting input text)
  const k = e.key,
    kl = k.toLowerCase(),
    ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && kl === "a") {
    e.preventDefault();
    // Blur any focused input first
    if ((tag === "INPUT" || tag === "TEXTAREA") && !isTrap) ae.blur();
    this._selectAll();
    return;
  }
  // Undo/Redo: always handle even when a slider / number input has focus.
  // Range inputs have no native Ctrl+Z, and for the Shape panel sliders the
  // user expects Ctrl+Z to revert the geometry change regardless of focus.
  if (ctrl && (kl === "z" || kl === "y")) {
    e.preventDefault();
    if ((tag === "INPUT" || tag === "TEXTAREA") && !isTrap) ae.blur();
    if (kl === "z") this._undo();
    else this._redo();
    return;
  }
  // Delete / Backspace: always handle when focus is on a range slider
  // (sliders grab focus after a drag and then swallow key events — without
  // this branch the user has to click elsewhere before Delete removes the
  // selected object). Text inputs / textareas still get native behaviour
  // so deleting characters in a layer name works as expected.
  if (kl === "delete" || kl === "backspace") {
    const isRange = tag === "INPUT" && ae?.type === "range";
    const isTypeable =
      (tag === "INPUT" && ae?.type !== "range") || tag === "TEXTAREA";
    if (isRange) ae.blur();
    if (!isTypeable || isTrap) {
      e.preventDefault();
      this._deleteSelected();
      return;
    }
  }
  // For other shortcuts: if focus is on a RANGE slider, blur it and
  // let the shortcut run — sliders grab focus after a drag and then
  // swallow key events, which was making camera/view shortcuts
  // appear to stop working after adjusting any slider (FOV, shape
  // params, etc.). Typeable inputs (text / number) and textareas
  // still bail so layer-renames and numeric fields keep native typing.
  const isRange = tag === "INPUT" && ae?.type === "range";
  const isTypeable =
    (tag === "INPUT" && ae?.type !== "range" &&
     ae?.type !== "checkbox" && ae?.type !== "radio") ||
    tag === "TEXTAREA" || tag === "SELECT";
  if (isRange) ae.blur();
  if (isTypeable && !isTrap) return;
  const handled = ctrl
    ? ["d", "s"].includes(kl)
    : [
        "m",
        "r",
        "s",
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "delete",
        "backspace",
        "escape",
      ].includes(kl);
  if (handled) e.preventDefault();
  if (ctrl && kl === "d") {
    this._dupSelected();
    return;
  }
  if (ctrl && kl === "s") {
    this._save();
    return;
  }
  if (kl === "delete" || kl === "backspace") {
    this._deleteSelected();
    return;
  }
  if (kl === "escape") {
    if (this.el.helpOverlay?.style.display === "block")
      this.el.helpOverlay.style.display = "none";
    return;
  }
  if (kl === "m") this._setToolMode("move");
  else if (kl === "r") this._setToolMode("rotate");
  else if (kl === "s") this._setToolMode("scale");
  // Camera shortcuts — use e.code so they work on every keyboard layout
  // (e.g. French AZERTY puts symbols on the number row in default mode;
  // e.key would be "&" "é" "\"" etc., but e.code stays "Digit1" "Digit2"…).
  //   1 Front · 2 Side (right) · 3 Back · 4 Top
  //   5 Perspective · 6 Isometric · 7 Other Side (left)
  //   0 Focus on selected
  else if (e.code === "Digit1" || e.code === "Numpad1") this._camView("front");
  else if (e.code === "Digit2" || e.code === "Numpad2") this._camView("side");
  else if (e.code === "Digit3" || e.code === "Numpad3") this._camView("back");
  else if (e.code === "Digit4" || e.code === "Numpad4") this._camView("top");
  // 5 / 6: switch projection AND jump to a matching viewing angle.
  // Just toggling projection without repositioning felt like nothing
  // happened when you were already on, say, the front view — now 5
  // always takes you to a 3/4 perspective angle and 6 to a classic
  // iso angle, regardless of where you were.
  else if (e.code === "Digit5" || e.code === "Numpad5") {
    this._setPerspective(true);
    this._camView("perspective3q");
  }
  else if (e.code === "Digit6" || e.code === "Numpad6") {
    this._setPerspective(false);
    this._camView("iso");
  }
  else if (e.code === "Digit7" || e.code === "Numpad7") this._camView("otherside");
  else if (e.code === "Digit0" || e.code === "Numpad0") this._camView("focus");
};

Pixaroma3DEditor.prototype._selectAll = function () {
  this.selectedObjs.clear();
  this.objects.forEach((o) => this.selectedObjs.add(o));
  // Set active to first unlocked object for gizmo
  this.activeObj =
    this.objects.find((o) => !o.userData.locked) || this.objects[0] || null;
  if (this.activeObj) {
    this.transformCtrl.attach(this.activeObj);
  }
  this._syncOutlineSelection();
  this._updateLayers();
  this._syncProps();
  this._setStatus(`Selected all ${this.objects.length} objects`);
};

// ─── Undo ─────────────────────────────────────────────────

Pixaroma3DEditor.prototype._snap = function () {
  return this.objects.map((o) => {
    // Imported Groups (type:"bunny", "import") don't have a single
    // top-level .material — their material state lives on _overrideMat.
    // Read material fields from there so undo restores the user's
    // colour / roughness / opacity tweaks after the async re-fetch.
    const mat = o.material || o.userData?._overrideMat;
    const base = {
      id: o.userData.id,
      name: o.userData.name,
      type: o.userData.type,
      colorHex: o.userData.colorHex,
      locked: o.userData.locked,
      gp: o.userData.geoParams ? { ...o.userData.geoParams } : null,
      pos: o.position.toArray(),
      rot: [o.rotation.x, o.rotation.y, o.rotation.z],
      scl: o.scale.toArray(),
      rough: mat?.roughness,
      metal: mat?.metalness,
      opac: mat?.opacity,
      vis: o.visible,
    };
    // Extra bookkeeping so undo/redo can rebuild imported objects from
    // disk. Without these, deleting an import and pressing Ctrl+Z ran
    // the parametric path, which saw type "import" / "bunny" as unknown
    // and fell back to a cube.
    if (o.userData.type === "import") {
      base.importPath = o.userData.importPath || null;
      base.importExt = o.userData.importExt || null;
      base.companionFiles = o.userData.companionFiles || [];
      base.keepOriginalMaterials = !!o.userData.keepOriginalMaterials;
    } else if (o.userData.type === "bunny") {
      base.keepOriginalMaterials = !!o.userData.keepOriginalMaterials;
    } else if (isCompositeType(o.userData.type)) {
      // Composites: save their geoParams (slider state) so undo/redo
      // after a slider change or delete puts the exact same shape
      // back — same trunk height, same seed, same petal count, etc.
      base.keepOriginalMaterials = !!o.userData.keepOriginalMaterials;
      base.gp = o.userData.geoParams ? { ...o.userData.geoParams } : null;
    }
    return base;
  });
};

Pixaroma3DEditor.prototype._pushUndo = function () {
  if (this._isRestoring) return;
  this._undoStack.push(this._snap());
  if (this._undoStack.length > this.MAX_UNDO) this._undoStack.shift();
  this._redoStack = [];
};

Pixaroma3DEditor.prototype._undo = function () {
  if (!this._undoStack.length) return;
  this._redoStack.push(this._snap());
  this._applySnap(this._undoStack.pop());
};

Pixaroma3DEditor.prototype._redo = function () {
  if (!this._redoStack.length) return;
  this._undoStack.push(this._snap());
  this._applySnap(this._redoStack.pop());
};

// Dispose helper — Mesh has .geometry / .material at the top level,
// imported Groups have them scattered across descendants. Walk the
// whole subtree so nothing leaks.
function disposeMat(m) {
  if (!m) return;
  if (Array.isArray(m)) m.forEach((mm) => mm?.dispose?.());
  else m.dispose?.();
}
function disposeObject(o) {
  o.traverse?.((c) => {
    if (c.isMesh) {
      c.geometry?.dispose();
      disposeMat(c.material);
    }
  });
  // Covers top-level Mesh (traverse visits self too in three.js) but
  // defensive in case of plain Object3D wrappers.
  o.geometry?.dispose?.();
  disposeMat(o.material);
}

Pixaroma3DEditor.prototype._applySnap = function (state) {
  const THREE = getTHREE();
  this.transformCtrl.detach();
  // Preserve imports/bunnies across undo/redo instead of tearing them
  // down and re-fetching the GLB/OBJ every time. Without this, each
  // undo triggers the full async load pipeline — noticeable 2-3s
  // flicker for textured OBJs on every undo press. We match by
  // userData.id and reuse the existing THREE.Group.
  const asyncReusable = new Map();
  const targetIds = new Set(state.map((d) => d.id).filter(Boolean));
  this.objects.forEach((o) => {
    const t = o.userData?.type;
    const isAsync = t === "import" || t === "bunny";
    const id = o.userData?.id;
    if (isAsync && id && targetIds.has(id) && !asyncReusable.has(id)) {
      // Keep in cache — remove from scene temporarily so we re-add in
      // proper order. Don't dispose, materials/textures stay alive.
      this.scene.remove(o);
      asyncReusable.set(id, o);
    } else {
      this.scene.remove(o);
      disposeObject(o);
    }
  });
  this.objects = [];
  this.selectedObjs.clear();
  this.activeObj = null;
  state.forEach((d) => {
    // Fast path: reuse an already-loaded import/bunny group if we have
    // one with the same id. Skips async refetch entirely.
    if ((d.type === "import" || d.type === "bunny") && d.id && asyncReusable.has(d.id)) {
      const group = asyncReusable.get(d.id);
      asyncReusable.delete(d.id);
      // Re-apply saved transforms + material tweaks to the reused group.
      if (d.pos) group.position.fromArray(d.pos);
      if (d.rot) group.rotation.set(d.rot[0], d.rot[1], d.rot[2]);
      if (d.scl) group.scale.fromArray(d.scl);
      group.visible = d.vis !== false;
      group.userData.name = d.name;
      group.userData.colorHex = d.colorHex;
      group.userData.locked = d.locked || false;
      group.userData.keepOriginalMaterials = !!d.keepOriginalMaterials;
      const om = group.userData._overrideMat;
      if (om) {
        if (d.colorHex) om.color.set(d.colorHex);
        if (d.rough !== undefined) om.roughness = d.rough;
        if (d.metal !== undefined) om.metalness = d.metal;
        if (d.opac !== undefined) {
          om.opacity = d.opac;
          om.transparent = d.opac < 1;
        }
      }
      this._applyImportMaterialMode?.(group);
      this.scene.add(group);
      this.objects.push(group);
      if (d.id > this._id) this._id = d.id;
      return;
    }
    if (d.type === "import") {
      // Imported user-upload — rebuild the same way the save/restore
      // path does: placeholder sphere keeps the object slot stable
      // while we async-load the GLB/OBJ from its stored /view URL.
      // Without this branch, undo after deleting an import dropped the
      // model into the parametric fallback, which saw "import" as an
      // unknown shape and gave the user a cube.
      if (!d.importPath) {
        console.warn("[P3D] undo: import missing path, skipping");
        return;
      }
      const ph = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 16, 16),
        new THREE.MeshStandardMaterial({
          color: d.colorHex || "#c4a882",
          roughness: d.rough ?? 0.55,
          metalness: d.metal ?? 0,
          transparent: (d.opac ?? 1) < 1,
          opacity: d.opac ?? 1,
        }),
      );
      ph.castShadow = true;
      ph.receiveShadow = true;
      if (d.pos) ph.position.fromArray(d.pos);
      if (d.rot) ph.rotation.set(d.rot[0], d.rot[1], d.rot[2]);
      if (d.scl) ph.scale.fromArray(d.scl);
      ph.visible = d.vis !== false;
      ph.userData = {
        id: d.id,
        name: d.name,
        type: "import",
        colorHex: d.colorHex,
        locked: d.locked || false,
        geoParams: null,
        importPath: d.importPath,
        importExt: d.importExt,
        companionFiles: d.companionFiles || [],
        keepOriginalMaterials: !!d.keepOriginalMaterials,
      };
      if (d.id > this._id) this._id = d.id;
      this.scene.add(ph);
      this.objects.push(ph);
      import("./importer.mjs").then(async (mod) => {
        if (this._closed) return;
        const {
          loadGLBFromURL, loadOBJWithCompanions, prepareImportedGroup,
          wrapImportPivot, viewURLForStoredPath,
        } = mod;
        try {
          const url = viewURLForStoredPath(d.importPath);
          const innerGroup = d.importExt === "obj"
            ? await loadOBJWithCompanions(
                url,
                (d.companionFiles || []).map((c) => ({
                  name: c.name,
                  url: viewURLForStoredPath(c.path),
                })),
              )
            : await loadGLBFromURL(url);
          const idx = this.objects.indexOf(ph);
          if (idx === -1) return;
          const wasAttached = this.transformCtrl?.object === ph;
          const wasSelected = this.selectedObjs.has(ph);
          const wasActive = this.activeObj === ph;
          if (wasAttached) this.transformCtrl.detach();
          this.scene.remove(ph);
          disposeObject(ph);
          const { origMaterials, overrideMat } =
            prepareImportedGroup(innerGroup, ph.userData.colorHex);
          const { outer: group } = wrapImportPivot(innerGroup);
          group.position.copy(ph.position);
          group.rotation.copy(ph.rotation);
          group.scale.copy(ph.scale);
          group.visible = ph.visible;
          group.userData = {
            ...ph.userData,
            _origMaterials: origMaterials,
            _overrideMat: overrideMat,
          };
          // Re-apply the saved material tweaks onto the fresh override
          // so undo puts colour/roughness/opacity back where they were.
          if (d.colorHex) overrideMat.color.set(d.colorHex);
          if (d.rough !== undefined) overrideMat.roughness = d.rough;
          if (d.metal !== undefined) overrideMat.metalness = d.metal;
          if (d.opac !== undefined) {
            overrideMat.opacity = d.opac;
            overrideMat.transparent = d.opac < 1;
          }
          this.objects[idx] = group;
          this.scene.add(group);
          this._applyImportMaterialMode?.(group);
          if (wasSelected) {
            this.selectedObjs.delete(ph);
            this.selectedObjs.add(group);
          }
          if (wasActive) this.activeObj = group;
          if (wasAttached && !group.userData.locked)
            this.transformCtrl.attach(group);
          if (this._syncOutlineSelection) this._syncOutlineSelection();
          this._updateLayers();
          this._updateShadowFrustum?.();
          if (wasActive) {
            this._rebuildShapePanel?.();
            this._syncProps?.();
          }
        } catch (e) {
          console.warn("[P3D] import undo restore failed, sphere kept", e);
        }
      });
      return;
    }
    if (d.type === "bunny") {
      // Imported group — can't rebuild from the parametric pipeline.
      // Insert a placeholder sphere so object order stays stable, then
      // async-swap to the real GLB once the importer resolves.
      const ph = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 16, 16),
        new THREE.MeshStandardMaterial({
          color: d.colorHex || "#c4a882",
          roughness: d.rough ?? 0.55,
          metalness: d.metal ?? 0,
          transparent: true,
          opacity: d.opac ?? 1,
        }),
      );
      ph.castShadow = true;
      ph.receiveShadow = true;
      if (d.pos) ph.position.fromArray(d.pos);
      if (d.rot) ph.rotation.set(d.rot[0], d.rot[1], d.rot[2]);
      if (d.scl) ph.scale.fromArray(d.scl);
      ph.visible = d.vis !== false;
      ph.userData = {
        id: d.id,
        name: d.name,
        type: "bunny",
        colorHex: d.colorHex,
        locked: d.locked || false,
        geoParams: null,
      };
      if (d.id > this._id) this._id = d.id;
      this.scene.add(ph);
      this.objects.push(ph);
      import("./importer.mjs").then(async (mod) => {
        if (this._closed) return;
        const { loadGLBFromURL, prepareImportedGroup, wrapImportPivot } = mod;
        try {
          const innerGroup = await loadGLBFromURL(
            "/pixaroma/assets/models/bunny.glb",
          );
          const idx = this.objects.indexOf(ph);
          if (idx === -1) return;
          // Detach the gizmo from the placeholder BEFORE removing it
          // from the scene. TransformControls keeps a direct object
          // reference and logs "must be part of the scene graph" if
          // we remove without detaching first.
          const wasAttached = this.transformCtrl?.object === ph;
          const wasSelected = this.selectedObjs.has(ph);
          const wasActive = this.activeObj === ph;
          if (wasAttached) this.transformCtrl.detach();
          this.scene.remove(ph);
          disposeObject(ph);
          // Stash original materials + build override so the Shape-
          // panel toggle still works after undo re-creates the bunny.
          const { origMaterials, overrideMat } =
            prepareImportedGroup(innerGroup, ph.userData.colorHex);
          // Wrap pivot at mesh base-center so the gizmo lands on the
          // bunny after undo — same treatment as fresh add/restore.
          const { outer: group } = wrapImportPivot(innerGroup);
          group.position.copy(ph.position);
          group.rotation.copy(ph.rotation);
          group.scale.copy(ph.scale);
          group.visible = ph.visible;
          group.userData = {
            ...ph.userData,
            _origMaterials: origMaterials,
            _overrideMat: overrideMat,
          };
          this.objects[idx] = group;
          this.scene.add(group);
          if (wasSelected) {
            this.selectedObjs.delete(ph);
            this.selectedObjs.add(group);
          }
          if (wasActive) this.activeObj = group;
          if (wasAttached && !group.userData.locked)
            this.transformCtrl.attach(group);
          if (this._syncOutlineSelection) this._syncOutlineSelection();
          this._updateLayers();
          this._updateShadowFrustum?.();
        } catch (e) {
          console.warn("[P3D] bunny undo restore failed, sphere kept", e);
        }
      });
      return;
    }
    // Composite group (tree, house, table, …) — build synchronously.
    // Previously this used a placeholder-sphere + async importer swap
    // like the bunny/import paths, which caused a visible sphere
    // flicker on every undo of a composite. Now it builds and adds
    // the real group in one pass since composites have no async deps.
    if (isCompositeType(d.type)) {
      try {
        const inner = buildComposite(d.type, d.gp || undefined);
        const { origMaterials, overrideMat } =
          prepareImportedGroup(inner, d.colorHex);
        // Composites build with pivot at origin — no wrapImportPivot.
        // Just snap Y to floor as safety, then overlay saved transforms.
        const group = inner;
        const bb = new THREE.Box3().setFromObject(group);
        if (bb.min.y !== 0) group.position.y -= bb.min.y;
        if (d.pos) group.position.fromArray(d.pos);
        if (d.rot) group.rotation.set(d.rot[0], d.rot[1], d.rot[2]);
        if (d.scl) group.scale.fromArray(d.scl);
        group.visible = d.vis !== false;
        group.userData = {
          id: d.id,
          name: d.name,
          type: d.type,
          colorHex: d.colorHex,
          locked: d.locked || false,
          geoParams: d.gp ? { ...d.gp } : null,
          keepOriginalMaterials: d.keepOriginalMaterials !== undefined
            ? !!d.keepOriginalMaterials
            : true,
          _origMaterials: origMaterials,
          _overrideMat: overrideMat,
        };
        // Re-apply the saved material tweaks onto the fresh override
        if (d.colorHex) overrideMat.color.set(d.colorHex);
        if (d.rough !== undefined) overrideMat.roughness = d.rough;
        if (d.metal !== undefined) overrideMat.metalness = d.metal;
        if (d.opac !== undefined) {
          overrideMat.opacity = d.opac;
          overrideMat.transparent = d.opac < 1;
        }
        if (d.id > this._id) this._id = d.id;
        this._applyImportMaterialMode?.(group);
        this.scene.add(group);
        this.objects.push(group);
        this._updateLayers();
        this._updateShadowFrustum?.();
      } catch (e) {
        console.warn(`[P3D] composite "${d.type}" undo restore failed`, e);
      }
      return;
    }
    const gp = d.gp || this._defaultGeoParams(d.type);
    const g = this._makeGeo(d.type, gp);
    const mat = new THREE.MeshStandardMaterial({
      color: d.colorHex || "#888",
      roughness: d.rough ?? 0.85,
      metalness: d.metal ?? 0,
      transparent: true,
      opacity: d.opac ?? 1,
    });
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    if (d.pos) m.position.fromArray(d.pos);
    if (d.rot) m.rotation.set(d.rot[0], d.rot[1], d.rot[2]);
    if (d.scl) m.scale.fromArray(d.scl);
    m.visible = d.vis !== false;
    m.userData = {
      id: d.id,
      name: d.name,
      type: d.type,
      colorHex: d.colorHex,
      locked: d.locked || false,
      geoParams: gp,
    };
    if (d.id > this._id) this._id = d.id;
    this.scene.add(m);
    this.objects.push(m);
  });
  // Any leftover async-reusable groups weren't matched in the target
  // state — that means they're truly gone and we need to free their
  // materials/textures. Without this the import GLB/OBJ would leak
  // across repeated undo/redo cycles.
  for (const orphan of asyncReusable.values()) {
    disposeObject(orphan);
  }
  if (this.objects.length) this._select(this.objects[0], false);
  this._updateLayers();
};
