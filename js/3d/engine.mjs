// ============================================================
// Pixaroma 3D Editor — Three.js init, lighting
// ============================================================
import {
  Pixaroma3DEditor,
  getTHREE,
  getOrbitControls,
  getTransformControls,
  createCanvasFrame,
} from "./core.mjs";

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

  // Procedural neutral studio environment (no external HDRI file)
  // Generates a gradient-lit cube scene, PMREMs it into a usable envMap.
  this._studioEnvOn = true; // default ON; toggled by Studio Lighting checkbox

  const buildStudioEnv = () => {
    const envScene = new THREE.Scene();
    const topColor = new THREE.Color("#fff2e0");
    const midColor = new THREE.Color("#8a8a8a");
    const botColor = new THREE.Color("#202028");
    const mkPlane = (w, h, color, pos, rot) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
      );
      m.position.copy(pos);
      if (rot) m.rotation.copy(rot);
      envScene.add(m);
    };
    mkPlane(40, 40, topColor, new THREE.Vector3(0,  20, 0), new THREE.Euler(Math.PI / 2, 0, 0));
    mkPlane(40, 40, botColor, new THREE.Vector3(0, -20, 0), new THREE.Euler(-Math.PI / 2, 0, 0));
    mkPlane(40, 40, midColor, new THREE.Vector3(0, 0,  20), new THREE.Euler(0, Math.PI, 0));
    mkPlane(40, 40, midColor, new THREE.Vector3(0, 0, -20));
    mkPlane(40, 40, midColor, new THREE.Vector3( 20, 0, 0), new THREE.Euler(0, -Math.PI / 2, 0));
    mkPlane(40, 40, midColor, new THREE.Vector3(-20, 0, 0), new THREE.Euler(0,  Math.PI / 2, 0));
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromScene(envScene);
    pmrem.dispose();
    envScene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    return rt.texture;
  };

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
  this.renderer.shadowMap.type = THREE.VSMShadowMap;
  // AgX is softer on highlights than ACES; available in three 0.170+.
  // Fallback to ACESFilmic if the runtime build doesn't export AgX.
  this.renderer.toneMapping =
    THREE.AgXToneMapping !== undefined
      ? THREE.AgXToneMapping
      : THREE.ACESFilmicToneMapping;
  this.renderer.toneMappingExposure = 1.0;
  this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  vp.insertBefore(this.renderer.domElement, vp.firstChild);

  // After renderer is created and attached
  this._studioEnvTexture = buildStudioEnv();
  if (this._studioEnvOn) this.scene.environment = this._studioEnvTexture;

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
  this.ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
  this.scene.add(this.ambientLight);
  this.light = new THREE.DirectionalLight(0xffffff, 1.0);
  this.light.position.set(3, 5, 4);
  this.light.castShadow = true;
  this.light.shadow.mapSize.set(2048, 2048);
  this.light.shadow.radius = 4;
  this.light.shadow.blurSamples = 12;
  this.light.shadow.bias = -0.0005;
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

  this._shadowFitInterval = setInterval(() => {
    // Vue frontend can remove the overlay without firing close callbacks —
    // self-terminate if the overlay is detached (see CLAUDE.md).
    const overlay = this.el?.overlay;
    if (!overlay || !overlay.isConnected) {
      clearInterval(this._shadowFitInterval);
      this._shadowFitInterval = null;
      return;
    }
    if (!this._gizmoDragging && !this._ptr) this._updateShadowFrustum();
  }, 1000);
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

Pixaroma3DEditor.prototype._updateShadowFrustum = function () {
  const THREE = getTHREE();
  if (!this.light || !this.objects.length) return;
  const box = new THREE.Box3();
  this.objects.forEach((o) => {
    if (!o.visible) return;
    const b = new THREE.Box3().setFromObject(o);
    box.union(b);
  });
  if (box.isEmpty()) return;
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  // Re-center the light's target on the scene center so the symmetric
  // frustum below actually covers all objects regardless of where they sit.
  this.light.target.position.copy(center);
  this.light.target.updateMatrixWorld();
  const halfMax = Math.max(size.x, size.y, size.z) * 0.75 + 2;
  const sc = this.light.shadow.camera;
  sc.left = -halfMax;
  sc.right = halfMax;
  sc.top = halfMax;
  sc.bottom = -halfMax;
  sc.near = 0.1;
  sc.far = halfMax * 4 + 10;
  sc.updateProjectionMatrix();
};
