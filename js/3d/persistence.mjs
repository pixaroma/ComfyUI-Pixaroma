// ============================================================
// Pixaroma 3D Editor — Save/restore, background image mgmt
// ============================================================
import { Pixaroma3DEditor, getTHREE, ThreeDAPI } from "./core.mjs";
import { loadTeapotGeometry } from "./shapes.mjs";

// ─── Save / Restore ───────────────────────────────────────

Pixaroma3DEditor.prototype._serializeScene = function () {
  return {
    doc_w: this.docW,
    doc_h: this.docH,
    project_id: this.projectId,
    bgColor: this.bgColor,
    fov: this._fov,
    shadows: this._shadows,
    isOrtho: this._isOrtho,
    objects: this.objects.map((o) => {
      const base = {
        id: o.userData.id,
        name: o.userData.name,
        type: o.userData.type,
        colorHex: o.userData.colorHex,
        locked: o.userData.locked,
        geoParams: o.userData.geoParams || null,
        position: { x: o.position.x, y: o.position.y, z: o.position.z },
        rotation: { x: o.rotation.x, y: o.rotation.y, z: o.rotation.z },
        scale: { x: o.scale.x, y: o.scale.y, z: o.scale.z },
        visible: o.visible,
      };
      // Imported-model bookkeeping — only user uploads carry path/ext.
      // Bunny is rebuilt from the bundled asset so needs no importPath.
      if (o.userData.type === "import") {
        base.importPath = o.userData.importPath || null;
        base.importExt = o.userData.importExt || null;
        base.keepOriginalMaterials = !!o.userData.keepOriginalMaterials;
      } else if (o.userData.type === "bunny") {
        base.keepOriginalMaterials = !!o.userData.keepOriginalMaterials;
      }
      // Material fields for parametric meshes straight from o.material.
      // For imported groups pull them from the stashed override material
      // so the user's colour / rough / metal / opacity tweaks survive
      // the save/restore round-trip even though the loader's originals
      // are re-loaded fresh from disk.
      if (o.material) {
        base.roughness = o.material.roughness;
        base.metalness = o.material.metalness;
        base.opacity = o.material.opacity;
      } else if (o.userData._overrideMat) {
        const om = o.userData._overrideMat;
        base.roughness = om.roughness;
        base.metalness = om.metalness;
        base.opacity = om.opacity;
      }
      return base;
    }),
    camera: this.camera
      ? {
          position: {
            x: this.camera.position.x,
            y: this.camera.position.y,
            z: this.camera.position.z,
          },
          target: {
            x: this.orbitCtrl.target.x,
            y: this.orbitCtrl.target.y,
            z: this.orbitCtrl.target.z,
          },
        }
      : null,
    light: {
      color: this.el.lightColor?.value || "#fff",
      intensity: this.light?.intensity ?? 1.4,
      ambient: this.ambientLight?.intensity ?? 0,
      dir: { ...this._lightDir },
    },
    showGrid: this._showGrid,
    showGizmo: this._showGizmo,
    bgImage: this._bgImg.path
      ? {
          path: this._bgImg.path,
          x: this._bgImg.x,
          y: this._bgImg.y,
          scale: this._bgImg.scale,
          rotation: this._bgImg.rotation,
          opacity: this._bgImg.opacity,
        }
      : null,
  };
};

Pixaroma3DEditor.prototype._restoreScene = function (jsonStr) {
  const THREE = getTHREE();
  if (!jsonStr || jsonStr === "{}") {
    this._undoStack = [];
    this._redoStack = [];
    this._updateLayers();
    return;
  }
  this._isRestoring = true;
  try {
    const d = JSON.parse(jsonStr);
    if (d.doc_w) {
      this.docW = d.doc_w;
    }
    if (d.doc_h) {
      this.docH = d.doc_h;
    }
    // Sync canvas settings component with restored dimensions
    if (this._canvasSettings) {
      this._canvasSettings.setSize(this.docW, this.docH);
    }
    if (d.bgColor) {
      this.bgColor = d.bgColor;
      if (this.el.bgColor) this.el.bgColor.value = d.bgColor;
      this.scene.background = new THREE.Color(d.bgColor);
    }
    if (d.fov !== undefined) {
      this._fov = d.fov;
      if (this.el.fovSlider) this.el.fovSlider.value = d.fov;
      if (this.el.fovVal) this.el.fovVal.value = d.fov;
      if (this.camera.fov !== undefined) {
        this.camera.fov = d.fov;
        this.camera.updateProjectionMatrix();
      }
    }
    if (d.shadows !== undefined) {
      this._shadows = d.shadows;
      if (this.el.shadowCheck) this.el.shadowCheck.checked = d.shadows;
      if (this._groundMesh) this._groundMesh.visible = d.shadows;
    }
    if (d.isOrtho) this._setPerspective(false);
    if (d.project_id) this.projectId = d.project_id;
    this._updateFrame();
    if (d.objects) d.objects.forEach((od) => this._addObjFromData(od));
    if (d.camera) {
      if (d.camera.position)
        this.camera.position.set(
          d.camera.position.x,
          d.camera.position.y,
          d.camera.position.z,
        );
      if (d.camera.target)
        this.orbitCtrl.target.set(
          d.camera.target.x,
          d.camera.target.y,
          d.camera.target.z,
        );
      this.orbitCtrl.update();
    }
    if (d.light) {
      if (d.light.color && this.el.lightColor) {
        this.el.lightColor.value = d.light.color;
        this.light.color.set(d.light.color);
      }
      if (d.light.intensity != null) {
        this.light.intensity = d.light.intensity;
        const sv = Math.round((d.light.intensity / 2) * 100);
        if (this.el.lightIntS) {
          this.el.lightIntS.value = sv;
          this.el.lightIntV.value = sv;
        }
      }
      if (d.light.ambient != null) {
        this.ambientLight.intensity = d.light.ambient;
        const sv = Math.round(d.light.ambient * 100);
        if (this.el.lightAmbS) {
          this.el.lightAmbS.value = sv;
          this.el.lightAmbV.value = sv;
        }
      }
      if (d.light.dir) {
        this._lightDir = { ...d.light.dir };
        this._applyLightDir();
        const angVal = Math.round((this._lightDir.theta * 180) / Math.PI);
        const hgtVal = Math.round(90 - (this._lightDir.phi * 180) / Math.PI);
        if (this.el.lightAngle) {
          this.el.lightAngle.value = angVal;
          this.el.lightAngleVal.value = angVal;
        }
        if (this.el.lightHeight) {
          this.el.lightHeight.value = hgtVal;
          this.el.lightHeightVal.value = hgtVal;
        }
      }
    }
    if (d.showGrid !== undefined) {
      this._showGrid = d.showGrid;
      if (this.el.gridCheck) this.el.gridCheck.checked = d.showGrid;
      if (this.gridHelper) this.gridHelper.visible = d.showGrid;
    }
    if (d.showGizmo !== undefined) {
      this._showGizmo = d.showGizmo;
      if (this.el.gizmoCheck) this.el.gizmoCheck.checked = d.showGizmo;
      if (this._gizmoHelper) this._gizmoHelper.visible = d.showGizmo;
    }
    if (d.bgImage && d.bgImage.path) {
      this._bgImg = {
        path: d.bgImage.path,
        x: d.bgImage.x || 0,
        y: d.bgImage.y || 0,
        scale: d.bgImage.scale || 100,
        rotation: d.bgImage.rotation || 0,
        opacity: d.bgImage.opacity ?? 100,
        _natW: 0,
        _natH: 0,
      };
      this._syncBgSliders();
      // Load from server path — split into filename + subfolder for ComfyUI /view
      const parts = d.bgImage.path.replace(/\\/g, "/").split("/");
      const fname = parts.pop();
      const subfolder = parts.join("/") || "pixaroma";
      const imgSrc =
        "/view?filename=" +
        encodeURIComponent(fname) +
        "&type=input&subfolder=" +
        encodeURIComponent(subfolder) +
        "&t=" +
        Date.now();
      this._showBgImage(imgSrc, false);
    }
    if (this.objects.length) this._select(this.objects[0], false);
    this._updateLayers();
    // Snap the directional-light shadow frustum to the just-restored
    // scene bounds so the very first shadow frame is correct. Without
    // this the shadow renders with the default (wider) frustum until
    // the 1s setInterval fires, producing a visible "shadow jump" when
    // a saved scene is reopened.
    this._updateShadowFrustum?.();
    // If the saved scene contains any teapots, the first _addObject
    // calls above built them as placeholder spheres (TeapotGeometry
    // loads asynchronously). Kick off the load now and rebuild every
    // teapot mesh with the real geometry once the module resolves.
    if (d.objects?.some((od) => od.type === "teapot")) {
      loadTeapotGeometry().then(() => {
        if (this._closed) return;
        for (const m of this.objects) {
          if (m.userData.type === "teapot" && this._rebuildObjectGeometry) {
            this._rebuildObjectGeometry(m);
          }
        }
      });
    }
    this._isRestoring = false;
    this._undoStack = [];
    this._redoStack = [];
  } catch (e) {
    console.warn("[P3D]", e);
    this._isRestoring = false;
    this._addObject("cube");
  }
};

// Apply a saved object-data record to the most-recently-added object.
// Shared between parametric shapes (Mesh with .material) and imported
// groups (Group — .material doesn't exist so we skip those fields).
function applyObjectData(m, od) {
  m.userData.name = od.name || m.userData.name;
  m.userData.id = od.id || m.userData.id;
  m.userData.colorHex = od.colorHex;
  m.userData.locked = od.locked || false;
  if (od.position) m.position.set(od.position.x, od.position.y, od.position.z);
  if (od.rotation) m.rotation.set(od.rotation.x, od.rotation.y, od.rotation.z);
  if (od.scale) m.scale.set(od.scale.x, od.scale.y, od.scale.z);
  // Parametric mesh — write through its single material.
  if (m.material) {
    if (od.colorHex) m.material.color.set(od.colorHex);
    if (od.roughness !== undefined) m.material.roughness = od.roughness;
    if (od.metalness !== undefined) m.material.metalness = od.metalness;
    if (od.opacity !== undefined) {
      m.material.opacity = od.opacity;
      m.material.transparent = od.opacity < 1;
    }
  } else if (m.userData?._overrideMat) {
    // Imported group — apply saved tweaks to the stashed override
    // material so the next _applyImportMaterialMode swap shows the
    // right colour / PBR values, and the Object Color panel reflects
    // what the user picked before saving.
    const om = m.userData._overrideMat;
    if (od.colorHex) om.color.set(od.colorHex);
    if (od.roughness !== undefined) om.roughness = od.roughness;
    if (od.metalness !== undefined) om.metalness = od.metalness;
    if (od.opacity !== undefined) {
      om.opacity = od.opacity;
      om.transparent = od.opacity < 1;
    }
  }
  m.visible = od.visible !== false;
}

Pixaroma3DEditor.prototype._addObjFromData = function (od) {
  if (od.type === "import") {
    // User-uploaded model. The GLB/OBJ lives on disk under the path
    // we saved at upload time — rebuild the ComfyUI /view URL from it
    // and load asynchronously. Placeholder sphere keeps the object
    // slot stable during the async load, same pattern as bunny.
    if (!od.importPath) {
      console.warn("[P3D] import missing path, skipping:", od);
      return;
    }
    this._addObject("sphere", { radius: 0.5, widthSegs: 16, heightSegs: 16 });
    const placeholder = this.objects[this.objects.length - 1];
    placeholder.userData.type = "import";
    applyObjectData(placeholder, od);
    import("./importer.mjs").then(async ({ loadGLBFromURL, loadOBJFromURL, prepareImportedGroup }) => {
      if (this._closed) return;
      const parts = od.importPath.split("/");
      const fname = parts.pop();
      const subfolder = parts.join("/");
      const url = "/view?filename=" + encodeURIComponent(fname)
                + "&type=input&subfolder=" + encodeURIComponent(subfolder)
                + "&t=" + Date.now();
      try {
        const group = od.importExt === "obj"
          ? await loadOBJFromURL(url)
          : await loadGLBFromURL(url);
        const idx = this.objects.indexOf(placeholder);
        if (idx === -1) return;
        const wasAttached = this.transformCtrl?.object === placeholder;
        const wasSelected = this.selectedObjs.has(placeholder);
        const wasActive = this.activeObj === placeholder;
        if (wasAttached) this.transformCtrl.detach();
        this.scene.remove(placeholder);
        placeholder.geometry?.dispose();
        placeholder.material?.dispose();
        // Shared material prep so the Shape-panel toggle round-trips.
        const { origMaterials, overrideMat } =
          prepareImportedGroup(group, od.colorHex);
        group.userData = {
          type: "import",
          importPath: od.importPath,
          importExt: od.importExt,
          _origMaterials: origMaterials,
          _overrideMat: overrideMat,
          keepOriginalMaterials: !!od.keepOriginalMaterials,
        };
        applyObjectData(group, od);
        this._applyImportMaterialMode?.(group);
        this.objects[idx] = group;
        this.scene.add(group);
        if (wasSelected) {
          this.selectedObjs.delete(placeholder);
          this.selectedObjs.add(group);
        }
        if (wasActive) this.activeObj = group;
        if (wasAttached && !group.userData.locked)
          this.transformCtrl.attach(group);
        if (this._syncOutlineSelection) this._syncOutlineSelection();
        this._updateLayers();
        this._updateShadowFrustum?.();
      } catch (e) {
        console.warn("[P3D] import restore failed, placeholder kept", e);
      }
    });
    return;
  }
  if (od.type === "bunny") {
    // Bunny ships as a GLB and must be fetched through the importer.
    // Add a placeholder sphere right away so the object order / index
    // stays stable in the sync restore pass, then async-swap for the
    // real GLB group once it resolves. If the fetch fails we keep
    // the sphere and just relabel its type so the user doesn't
    // silently lose the object.
    this._addObject("sphere", { radius: 0.5, widthSegs: 16, heightSegs: 16 });
    const placeholder = this.objects[this.objects.length - 1];
    placeholder.userData.type = "bunny";
    applyObjectData(placeholder, od);
    import("./importer.mjs").then(async ({ loadGLBFromURL }) => {
      if (this._closed) return;
      try {
        const group = await loadGLBFromURL("/pixaroma/assets/models/bunny.glb");
        // Replace placeholder in-place so the layer panel entry and
        // object ordering don't shuffle.
        const idx = this.objects.indexOf(placeholder);
        if (idx === -1) return; // placeholder was deleted mid-load
        // Detach gizmo before removing the placeholder from the scene —
        // TransformControls errors otherwise.
        const wasAttached = this.transformCtrl?.object === placeholder;
        const wasSelected = this.selectedObjs.has(placeholder);
        const wasActive = this.activeObj === placeholder;
        if (wasAttached) this.transformCtrl.detach();
        this.scene.remove(placeholder);
        placeholder.geometry?.dispose();
        placeholder.material?.dispose();
        // Prep the loaded group: shadow flags + material stash/override
        // so _applyImportMaterialMode can toggle later, and
        // applyObjectData can write the saved colour/rough/etc through
        // to the override material.
        const { prepareImportedGroup } = await import("./importer.mjs");
        const { origMaterials, overrideMat } =
          prepareImportedGroup(group, od.colorHex);
        group.userData = {
          type: "bunny",
          _origMaterials: origMaterials,
          _overrideMat: overrideMat,
          keepOriginalMaterials: !!od.keepOriginalMaterials,
        };
        applyObjectData(group, od);
        this._applyImportMaterialMode?.(group);
        this.objects[idx] = group;
        this.scene.add(group);
        if (wasSelected) {
          this.selectedObjs.delete(placeholder);
          this.selectedObjs.add(group);
        }
        if (wasActive) this.activeObj = group;
        if (wasAttached && !group.userData.locked)
          this.transformCtrl.attach(group);
        if (this._syncOutlineSelection) this._syncOutlineSelection();
        this._updateLayers();
        this._updateShadowFrustum?.();
      } catch (e) {
        console.warn("[P3D] bunny restore failed, keeping placeholder sphere", e);
      }
    });
    return;
  }
  const gp = od.geoParams || this._defaultGeoParams(od.type || "cube");
  this._addObject(od.type || "cube", gp);
  const m = this.objects[this.objects.length - 1];
  applyObjectData(m, od);
};

Pixaroma3DEditor.prototype._save = async function () {
  if (this._closed || !this.renderer) return;
  const THREE = getTHREE();
  this._layout.setSaving();
  try {
    const pr = this.renderer.getPixelRatio();
    const vp = this.el.viewport;
    const vpW = vp.clientWidth,
      vpH = vp.clientHeight;
    // Get frame rect (what the user sees as the canvas area)
    const fr = this._getFrameRect();

    // Use setViewOffset to render exactly the frame area at docW×docH output
    // This gives true WYSIWYG: objects appear the same size relative to frame
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.docW, this.docH);
    this.camera.aspect = vpW / vpH; // keep live preview aspect
    this.camera.setViewOffset(vpW, vpH, fr.x, fr.y, fr.w, fr.h);
    this.camera.updateProjectionMatrix();

    if (this.gridHelper) this.gridHelper.visible = false;
    if (this._gizmoHelper) this._gizmoHelper.visible = false;
    if (this._canvasFrame) this._canvasFrame.setVisible(false);
    // Selection outline is drawn by OutlinePass via the composer; the
    // save render below calls renderer.render() directly so it never
    // reaches the exported PNG — no toggling needed.

    // For save render: temporarily restore scene bg if no bg image
    const hadBgImage = this.el.bgImgEl && this._bgImg.path;
    if (!hadBgImage && this.scene.background === null)
      this.scene.background = new THREE.Color(this.bgColor);
    this.renderer.render(this.scene, this.camera);

    let dataURL;
    if (hadBgImage) {
      // Composite bg image behind 3D render at canvas resolution
      const compCanvas = document.createElement("canvas");
      compCanvas.width = this.docW;
      compCanvas.height = this.docH;
      const ctx = compCanvas.getContext("2d");
      ctx.fillStyle = this.bgColor;
      ctx.fillRect(0, 0, this.docW, this.docH);
      const img = this.el.bgImgEl;
      const aspect = this._bgImg._natW / this._bgImg._natH;
      // Base: image width = canvas width, height preserves aspect
      const baseW = this.docW;
      const baseH = baseW / aspect;
      const sc = this._bgImg.scale / 100;
      const iw = baseW * sc,
        ih = baseH * sc;
      const cx = this.docW / 2 + (this._bgImg.x / 100) * this.docW;
      const cy = this.docH / 2 + (this._bgImg.y / 100) * this.docH;
      ctx.save();
      ctx.globalAlpha = this._bgImg.opacity / 100;
      ctx.translate(cx, cy);
      ctx.rotate((this._bgImg.rotation * Math.PI) / 180);
      ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
      ctx.restore();
      ctx.drawImage(this.renderer.domElement, 0, 0);
      dataURL = compCanvas.toDataURL("image/png");
    } else {
      dataURL = this.renderer.domElement.toDataURL("image/png");
    }

    // If transparent disk save requested, do a second render without bg
    let transDataURL = null;
    if (this._diskSavePending && this._transparentBg) {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.render(this.scene, this.camera);
      if (hadBgImage) {
        const tCvs = document.createElement("canvas");
        tCvs.width = this.docW;
        tCvs.height = this.docH;
        const tCtx = tCvs.getContext("2d");
        const img = this.el.bgImgEl;
        const aspect = this._bgImg._natW / this._bgImg._natH;
        const baseW = this.docW;
        const baseH = baseW / aspect;
        const sc = this._bgImg.scale / 100;
        const iw = baseW * sc,
          ih = baseH * sc;
        const cx = this.docW / 2 + (this._bgImg.x / 100) * this.docW;
        const cy = this.docH / 2 + (this._bgImg.y / 100) * this.docH;
        tCtx.save();
        tCtx.globalAlpha = this._bgImg.opacity / 100;
        tCtx.translate(cx, cy);
        tCtx.rotate((this._bgImg.rotation * Math.PI) / 180);
        tCtx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
        tCtx.restore();
        tCtx.drawImage(this.renderer.domElement, 0, 0);
        transDataURL = tCvs.toDataURL("image/png");
      } else {
        transDataURL = this.renderer.domElement.toDataURL("image/png");
      }
    }

    // Restore transparent bg for live preview if bg image active
    if (hadBgImage) {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    }

    // Restore camera: clear view offset and restore live preview state
    this.camera.clearViewOffset();
    if (this.gridHelper) this.gridHelper.visible = this._showGrid;
    if (this._gizmoHelper) this._gizmoHelper.visible = this._showGizmo;
    if (this._canvasFrame) this._canvasFrame.setVisible(true);
    this.renderer.setPixelRatio(pr);
    this._onResize();

    const res = await ThreeDAPI.saveRender(this.projectId, dataURL);
    if (res.status === "success") {
      const sd = this._serializeScene();
      sd.composite_path = res.composite_path;
      if (this.onSave) this.onSave(JSON.stringify(sd), dataURL);
      if (this._diskSavePending) {
        this._diskSavePending = false;
        if (this.onSaveToDisk) this.onSaveToDisk(transDataURL || dataURL);
      }
      this._layout.setSaved();
    } else this._layout.setSaveError("Save failed");
  } catch (e) {
    console.error("[P3D]", e);
    this._layout.setSaveError("Save error");
  }
};

Pixaroma3DEditor.prototype._close = function () {
  if (this._closed) return;
  if (this._shadowFitInterval) {
    clearInterval(this._shadowFitInterval);
    this._shadowFitInterval = null;
  }
  if (this._studioEnvTexture) {
    this._studioEnvTexture.dispose();
    this._studioEnvTexture = null;
  }
  if (this.scene) this.scene.environment = null;
  this._closed = true;
  if (this._animId) cancelAnimationFrame(this._animId);
  this._animId = null;
  window.removeEventListener("keydown", this._onKey, { capture: true });
  if (this._resizeObs) this._resizeObs.disconnect();
  if (this.transformCtrl) {
    this.transformCtrl.detach();
    this.transformCtrl.dispose();
  }
  if (this.orbitCtrl) this.orbitCtrl.dispose();
  if (this._composer) {
    this._composer.passes.forEach((p) => p.dispose?.());
    this._composer.renderTarget1?.dispose();
    this._composer.renderTarget2?.dispose();
    this._composer = null;
    this._outlinePass = null;
  }
  if (this.renderer) {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
  this.objects.forEach((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  if (this._layout) this._layout.unmount();
  else if (this.el.overlay?.parentNode)
    this.el.overlay.parentNode.removeChild(this.el.overlay);
  this.scene = null;
  this.camera = null;
  this.renderer = null;
  if (this.onClose) this.onClose();
};

// ─── Background Image (CSS 2D) ─────────────────────────────

Pixaroma3DEditor.prototype._loadBgImage = function () {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataURL = ev.target.result;
      this._setStatus("Uploading background...");
      try {
        const res = await ThreeDAPI.uploadBgImage(this.projectId, dataURL);
        if (res.status === "success" && res.path) {
          this._bgImg.path = res.path;
          this._showBgImage(dataURL, true);
          this._setStatus("Background loaded");
        } else {
          this._setStatus("Upload failed");
        }
      } catch (e) {
        console.warn("[P3D] bg upload", e);
        this._setStatus("Upload error");
      }
    };
    reader.readAsDataURL(file);
  });
  input.click();
};

Pixaroma3DEditor.prototype._showBgImage = function (src, autoFit) {
  const cont = this.el.bgContainer;
  if (!cont) return;
  cont.innerHTML = "";
  const img = document.createElement("img");
  img.crossOrigin = "anonymous";
  img.src = src;
  img.onload = () => {
    this._bgImg._natW = img.naturalWidth;
    this._bgImg._natH = img.naturalHeight;
    if (autoFit) this._fitBg("width");
    else this._updateBgCSS();
  };
  img.onerror = () => {
    this._setStatus("Failed to load bg image");
  };
  this.el.bgImgEl = img;
  cont.appendChild(img);
  // Make canvas transparent so bg shows through
  if (this.scene) this.scene.background = null;
  if (this.renderer) this.renderer.setClearColor(0x000000, 0);
  if (this._updateBgPanelState) this._updateBgPanelState();
};

// Compute the pixel rect of the canvas frame inside the viewport
Pixaroma3DEditor.prototype._getFrameRect = function () {
  const vp = this.el.viewport;
  if (!vp) return { x: 0, y: 0, w: 800, h: 600 };
  const vpW = vp.clientWidth,
    vpH = vp.clientHeight;
  const s = Math.min(vpW / this.docW, vpH / this.docH, 1);
  const fw = this.docW * s,
    fh = this.docH * s;
  return { x: (vpW - fw) / 2, y: (vpH - fh) / 2, w: fw, h: fh };
};

Pixaroma3DEditor.prototype._updateBgCSS = function () {
  const img = this.el.bgImgEl;
  if (!img) return;
  if (!this._bgImg._natW || !this._bgImg._natH) return;
  const fr = this._getFrameRect();
  const aspect = this._bgImg._natW / this._bgImg._natH;
  // Base size: fit width of canvas frame, preserving aspect
  const baseW = fr.w;
  const baseH = baseW / aspect;
  // Apply scale
  const sc = this._bgImg.scale / 100;
  const iw = baseW * sc,
    ih = baseH * sc;
  // Position: center of frame + offset (offset in % of frame size)
  const cx = fr.x + fr.w / 2 + (this._bgImg.x / 100) * fr.w;
  const cy = fr.y + fr.h / 2 + (this._bgImg.y / 100) * fr.h;
  img.style.width = iw + "px";
  img.style.height = ih + "px";
  img.style.left = cx + "px";
  img.style.top = cy + "px";
  const fh = this._bgImg._flipH ? " scaleX(-1)" : "";
  const fv = this._bgImg._flipV ? " scaleY(-1)" : "";
  img.style.transform = `translate(-50%,-50%) rotate(${this._bgImg.rotation}deg)${fh}${fv}`;
  img.style.opacity = this._bgImg.opacity / 100;
};

Pixaroma3DEditor.prototype._fitBg = function (mode) {
  if (!this._bgImg._natW || !this._bgImg._natH) return;
  const natW = this._bgImg._natW,
    natH = this._bgImg._natH;
  const aspect = natW / natH;
  const fr = this._getFrameRect();
  // Base size is fit-width, so scale=100 means image width == frame width
  if (mode === "width") {
    this._bgImg.scale = 100;
  } else if (mode === "height") {
    // Scale so image height == frame height
    const baseH = fr.w / aspect;
    this._bgImg.scale = Math.round((fr.h / baseH) * 100);
  } else {
    // fill: cover the entire frame
    const baseH = fr.w / aspect;
    const scaleW = 100; // width fits at 100
    const scaleH = Math.round((fr.h / baseH) * 100);
    this._bgImg.scale = Math.max(scaleW, scaleH);
  }
  this._bgImg.x = 0;
  this._bgImg.y = 0;
  this._syncBgSliders();
  this._updateBgCSS();
};

Pixaroma3DEditor.prototype._syncBgSliders = function () {
  if (this.el.bgX) {
    this.el.bgX.value = this._bgImg.x;
    this.el.bgXV.value = this._bgImg.x;
  }
  if (this.el.bgY) {
    this.el.bgY.value = this._bgImg.y;
    this.el.bgYV.value = this._bgImg.y;
  }
  if (this.el.bgSc) {
    this.el.bgSc.value = this._bgImg.scale;
    this.el.bgScV.value = this._bgImg.scale;
  }
  if (this.el.bgRot) {
    this.el.bgRot.value = this._bgImg.rotation;
    this.el.bgRotV.value = this._bgImg.rotation;
  }
  if (this.el.bgOp) {
    this.el.bgOp.value = this._bgImg.opacity;
    this.el.bgOpV.value = this._bgImg.opacity;
  }
};

Pixaroma3DEditor.prototype._removeBgImage = function () {
  const THREE = getTHREE();
  const cont = this.el.bgContainer;
  if (cont) cont.innerHTML = "";
  this.el.bgImgEl = null;
  this._bgImg = {
    path: null,
    x: 0,
    y: 0,
    scale: 100,
    rotation: 0,
    opacity: 100,
    _natW: 0,
    _natH: 0,
  };
  // Restore scene background
  if (this.scene) this.scene.background = new THREE.Color(this.bgColor);
  this._syncBgSliders();
  if (this._updateBgPanelState) this._updateBgPanelState();
  this._setStatus("Background removed");
};
