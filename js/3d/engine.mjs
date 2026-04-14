// ============================================================
// Pixaroma 3D Editor — Three.js init, shape params, lighting
// ============================================================
import {
  Pixaroma3DEditor,
  getTHREE,
  getOrbitControls,
  getTransformControls,
  createCanvasFrame,
} from "./core.mjs";
import { SHAPES } from "./shapes.mjs";

// ─── Three.js ─────────────────────────────────────────────

Pixaroma3DEditor.prototype._initThree = function () {
  const THREE = getTHREE(),
    OrbitControls = getOrbitControls(),
    TransformControls = getTransformControls();
  const vp = this.el.viewport,
    w = vp.clientWidth || 800,
    h = vp.clientHeight || 600;
  this.scene = new THREE.Scene();
  this.scene.background = new THREE.Color(this.bgColor);
  this.camera = new THREE.PerspectiveCamera(this._fov, w / h, 0.1, 1000);
  this.camera.position.set(4, 3, 5);

  this.renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: true,
  });
  this.renderer.setSize(w, h);
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  this.renderer.shadowMap.enabled = true;
  this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  vp.insertBefore(this.renderer.domElement, vp.firstChild);

  this.orbitCtrl = new OrbitControls(this.camera, this.renderer.domElement);
  this.orbitCtrl.enableDamping = true;
  this.orbitCtrl.dampingFactor = 0.08;
  this.orbitCtrl.target.set(0, 0.5, 0);

  this.transformCtrl = new TransformControls(
    this.camera,
    this.renderer.domElement,
  );
  this.transformCtrl.setMode("translate");
  this.transformCtrl.setSize(0.85);
  this.transformCtrl.addEventListener("dragging-changed", (e) => {
    this.orbitCtrl.enabled = !e.value;
    this._gizmoDragging = e.value;
    if (e.value) this._pushUndo(); // snapshot before transform
    if (e.value && this.activeObj && this.selectedObjs.size > 1) {
      // Starting drag — record initial positions/rotations/scales of all selected
      this._multiDragStart = new Map();
      for (const o of this.selectedObjs) {
        if (o === this.activeObj) continue;
        this._multiDragStart.set(o, {
          pos: o.position.clone(),
          rot: o.rotation.clone(),
          scl: o.scale.clone(),
        });
      }
      this._activeStartPos = this.activeObj.position.clone();
      this._activeStartRot = this.activeObj.rotation.clone();
      this._activeStartScl = this.activeObj.scale.clone();
    }
    if (!e.value) this._multiDragStart = null;
  });
  this.transformCtrl.addEventListener("objectChange", () => {
    // Multi-select: apply delta from activeObj to all selected objects
    if (!this._multiDragStart || !this.activeObj) return;
    const mode = this.transformCtrl.getMode();
    for (const [o, start] of this._multiDragStart) {
      if (mode === "translate") {
        o.position.set(
          start.pos.x + (this.activeObj.position.x - this._activeStartPos.x),
          start.pos.y + (this.activeObj.position.y - this._activeStartPos.y),
          start.pos.z + (this.activeObj.position.z - this._activeStartPos.z),
        );
      } else if (mode === "rotate") {
        o.rotation.set(
          start.rot.x + (this.activeObj.rotation.x - this._activeStartRot.x),
          start.rot.y + (this.activeObj.rotation.y - this._activeStartRot.y),
          start.rot.z + (this.activeObj.rotation.z - this._activeStartRot.z),
        );
      } else if (mode === "scale") {
        const sx = this._activeStartScl.x
          ? this.activeObj.scale.x / this._activeStartScl.x
          : 1;
        const sy = this._activeStartScl.y
          ? this.activeObj.scale.y / this._activeStartScl.y
          : 1;
        const sz = this._activeStartScl.z
          ? this.activeObj.scale.z / this._activeStartScl.z
          : 1;
        o.scale.set(start.scl.x * sx, start.scl.y * sy, start.scl.z * sz);
      }
    }
  });
  this.transformCtrl.addEventListener("mouseUp", () => {
    this._syncProps();
    this._updateLayers();
  });
  const helper =
    typeof this.transformCtrl.getHelper === "function"
      ? this.transformCtrl.getHelper()
      : this.transformCtrl;
  this.scene.add(helper);
  this._gizmoHelper = helper;

  this.gridHelper = new THREE.GridHelper(20, 20, 0x333344, 0x222233);
  this.scene.add(this.gridHelper);

  // Canvas frame + gray masks (using shared framework component)
  this._canvasFrame = createCanvasFrame(vp);
  this._canvasFrame.update(this.docW, this.docH);

  // Lights
  this.ambientLight = new THREE.AmbientLight(0xffffff, 0);
  this.scene.add(this.ambientLight);
  this.light = new THREE.DirectionalLight(0xffffff, 1.4);
  this.light.position.set(3, 5, 4);
  this.light.castShadow = true;
  this.light.shadow.mapSize.set(1024, 1024);
  this.light.shadow.camera.near = 0.1;
  this.light.shadow.camera.far = 50;
  this.light.shadow.camera.left = -10;
  this.light.shadow.camera.right = 10;
  this.light.shadow.camera.top = 10;
  this.light.shadow.camera.bottom = -10;
  this.scene.add(this.light);

  this._groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.ShadowMaterial({ opacity: 0.35 }),
  );
  this._groundMesh.rotation.x = -Math.PI / 2;
  this._groundMesh.receiveShadow = true;
  this.scene.add(this._groundMesh);

  // Pointer
  this.renderer.domElement.addEventListener("pointerdown", (e) => {
    if (e.button === 0)
      this._ptr = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  this.renderer.domElement.addEventListener("pointerup", (e) => {
    if (e.button !== 0 || !this._ptr) return;
    const dx = e.clientX - this._ptr.x,
      dy = e.clientY - this._ptr.y,
      dt = Date.now() - this._ptr.t;
    this._ptr = null;
    if (Math.hypot(dx, dy) < 6 && dt < 500 && !this._gizmoDragging)
      this._onClick(e);
  });

  this._onKey = (e) => this._handleKey(e);
  window.addEventListener("keydown", this._onKey, { capture: true });
  this._resizeObs = new ResizeObserver(() => this._onResize());
  this._resizeObs.observe(vp);
  this._applyLightDir();
};

Pixaroma3DEditor.prototype._updateFrame = function () {
  if (this._canvasFrame) this._canvasFrame.update(this.docW, this.docH);
};

Pixaroma3DEditor.prototype._onResize = function () {
  const vp = this.el.viewport;
  if (!vp || !this.renderer) return;
  const w = vp.clientWidth,
    h = vp.clientHeight;
  if (!w || !h) return;
  this.camera.aspect = w / h;
  this.camera.updateProjectionMatrix();
  this.renderer.setSize(w, h);
  this._updateFrame();
  this._updateBgCSS();
};

Pixaroma3DEditor.prototype._animate = function () {
  if (!this.renderer) return;
  this._animId = requestAnimationFrame(() => this._animate());
  this.orbitCtrl.update();
  this.renderer.render(this.scene, this.camera);
};

// ─── Shape Parameter UI ─────────────────────────────────

Pixaroma3DEditor.prototype._updateShapeParams = function () {
  const box = this.el.shapeParams;
  if (!box) return;
  box.innerHTML = "";
  const type = this._selectedShape;
  const p = this._shapeParams[type];
  if (!p) return;

  // Pull param defs from registry (single source of truth)
  const shape = SHAPES[type];
  const fields = shape ? shape.params : [];
  fields.forEach((f) => {
    const row = document.createElement("div");
    row.className = "p3d-row";
    const lbl = document.createElement("div");
    lbl.className = "p3d-label";
    lbl.textContent = f.label;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "p3d-range";
    slider.min = f.min;
    slider.max = f.max;
    slider.step = f.step;
    slider.value = p[f.key];
    const numIn = document.createElement("input");
    numIn.type = "number";
    numIn.className = "p3d-input";
    numIn.style.cssText =
      "width:50px;text-align:center;font-size:10px;padding:3px 4px;flex:none;border-radius:3px;";
    numIn.min = f.min;
    numIn.max = f.max;
    numIn.step = f.step;
    numIn.value = Number.isInteger(f.step) ? p[f.key] : p[f.key].toFixed(1);
    const sync = (v) => {
      p[f.key] = +v;
      slider.value = v;
      numIn.value = Number.isInteger(f.step) ? v : (+v).toFixed(1);
    };
    slider.addEventListener("input", () => sync(slider.value));
    numIn.addEventListener("change", () => {
      const v = Math.max(f.min, Math.min(f.max, +numIn.value || f.min));
      sync(v);
    });
    row.append(lbl, slider, numIn);
    box.appendChild(row);
  });

  // Reset to defaults button
  const resetBtn = document.createElement("button");
  resetBtn.className = "p3d-btn";
  resetBtn.style.cssText =
    "width:100%;margin-top:4px;font-size:10px;padding:4px 8px;";
  resetBtn.textContent =
    "\u21ba Reset " +
    type.charAt(0).toUpperCase() +
    type.slice(1) +
    " Defaults";
  resetBtn.title = "Reset parameters to default values";
  resetBtn.addEventListener("click", () => {
    this._shapeParams[type] = { ...this._shapeDefaults[type] };
    this._updateShapeParams();
  });
  box.appendChild(resetBtn);
};

Pixaroma3DEditor.prototype._addObjectWithParams = function () {
  const type = this._selectedShape;
  const p = this._shapeParams[type] ? { ...this._shapeParams[type] } : {};
  this._addObject(type, p);
};

// ─── Lighting ─────────────────────────────────────────────

Pixaroma3DEditor.prototype._applyLightDir = function () {
  if (!this.light) return;
  const d = 6,
    { theta, phi } = this._lightDir;
  this.light.position.set(
    d * Math.sin(phi) * Math.sin(theta),
    d * Math.cos(phi),
    d * Math.sin(phi) * Math.cos(theta),
  );
};
