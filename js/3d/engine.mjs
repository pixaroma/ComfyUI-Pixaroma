// ============================================================
// Pixaroma 3D Editor — Three.js init, lighting
// ============================================================
import {
  Pixaroma3DEditor,
  getTHREE,
  getOrbitControls,
  getTransformControls,
  getPostprocessing,
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
    // Simple 3-point softbox rig baked into a cube env. Higher contrast
    // than a flat gradient so metal reflections show clear bright/dark bands.
    const envScene = new THREE.Scene();
    const topColor = new THREE.Color("#ffffff"); // bright overhead fill
    const sideHi = new THREE.Color("#7c7c82");   // mid sides (main reflection horizon)
    const sideLo = new THREE.Color("#3a3a42");   // darker sides for contrast
    const botColor = new THREE.Color("#161620"); // dark floor
    const keyColor = new THREE.Color("#ffffff"); // key softbox (punchy highlight)
    const fillColor = new THREE.Color("#c8d0ff"); // cool fill softbox
    const mkPlane = (w, h, color, pos, rot) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
      );
      m.position.copy(pos);
      if (rot) m.rotation.copy(rot);
      envScene.add(m);
    };
    // Cube walls
    mkPlane(40, 40, topColor, new THREE.Vector3(0,  20, 0), new THREE.Euler(Math.PI / 2, 0, 0));
    mkPlane(40, 40, botColor, new THREE.Vector3(0, -20, 0), new THREE.Euler(-Math.PI / 2, 0, 0));
    mkPlane(40, 40, sideHi, new THREE.Vector3(0, 0,  20), new THREE.Euler(0, Math.PI, 0));
    mkPlane(40, 40, sideLo, new THREE.Vector3(0, 0, -20));
    mkPlane(40, 40, sideHi, new THREE.Vector3( 20, 0, 0), new THREE.Euler(0, -Math.PI / 2, 0));
    mkPlane(40, 40, sideLo, new THREE.Vector3(-20, 0, 0), new THREE.Euler(0,  Math.PI / 2, 0));
    // Key softbox (front-right, white, big) — punchy main highlight
    mkPlane(14, 14, keyColor, new THREE.Vector3(10, 14, 12), new THREE.Euler(-Math.PI / 4, Math.PI / 6, 0));
    // Fill softbox (left, cool tint, smaller) — secondary highlight
    mkPlane(10, 10, fillColor, new THREE.Vector3(-14, 8, -4), new THREE.Euler(0, Math.PI / 2, 0));
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
  // No tonemapping — earlier we used AgX for a softer "cinematic"
  // look, but it desaturated user-picked object colours and the
  // selection outline (Pixaroma orange came out as washed-out tan).
  // For an editor, WYSIWYG colour fidelity matters more than filmic
  // highlight rolloff — use linear sRGB output and let the picker
  // colour be exactly what's drawn.
  this.renderer.toneMapping = THREE.NoToneMapping;
  this.renderer.toneMappingExposure = 1.0;
  this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  vp.insertBefore(this.renderer.domElement, vp.firstChild);

  // After renderer is created and attached
  this._studioEnvTexture = buildStudioEnv();
  if (this._studioEnvOn) this.scene.environment = this._studioEnvTexture;

  // Postprocessing pipeline for Blender-style screen-space selection
  // outline. Pipeline: RenderPass (draws scene) → OutlinePass (draws
  // orange outlines around this._outlinePass.selectedObjects) →
  // OutputPass (applies tonemap + sRGB conversion for final display).
  //
  // The save-render path intentionally bypasses the composer and calls
  // this.renderer.render() directly, so the exported PNG never has the
  // selection outline baked in — no need to toggle outline visibility.
  const pp = getPostprocessing();
  this._composer = new pp.EffectComposer(this.renderer);
  this._composer.setSize(w, h);
  this._composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  this._composer.addPass(new pp.RenderPass(this.scene, this.camera));
  this._outlinePass = new pp.OutlinePass(
    new THREE.Vector2(w, h), this.scene, this.camera,
  );
  // Bold ~2-3 px solid Pixaroma orange. edgeStrength saturates the
  // mix so the colour reads as the buttons' #f66744 instead of a
  // faded pink. edgeThickness gives the line body so the silhouette
  // stays uniform around the object at any zoom (OutlinePass measures
  // thickness in screen pixels, so it stays the same as you zoom).
  this._outlinePass.edgeStrength = 8;
  this._outlinePass.edgeGlow = 0;
  this._outlinePass.edgeThickness = 3;
  this._outlinePass.pulsePeriod = 0;
  // Full-resolution edge detection — the default half-res produced
  // "ray" streaks extending from sharp silhouettes.
  this._outlinePass.downSampleRatio = 1;
  // True Pixaroma brand orange. With NoToneMapping above, the colour
  // round-trips sRGB → linear → sRGB without compression, so it
  // displays exactly as #f66744 on screen.
  this._outlinePass.visibleEdgeColor.set(0xf66744);
  // Hide the "occluded edge" pass — where the gizmo (or any other
  // object) sits in front of the selected mesh, the outline would
  // otherwise bleed through as an orange "x-ray" line. Setting the
  // hidden colour to black makes those occluded edge pixels disappear
  // against the dark scene background, so gizmo arrows stay clean.
  this._outlinePass.hiddenEdgeColor.set(0x000000);
  this._composer.addPass(this._outlinePass);
  this._composer.addPass(new pp.OutputPass());

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
    // Flip helper drag-indicator lines visible only while dragging,
    // so the user sees a subtle gray axis hint during the drag and
    // nothing during normal hover. On the next frame TransformControls
    // may overwrite these flags for hover state — we re-apply in the
    // animate loop too, but doing it here makes drag-start instant.
    if (this._gizmoHelperLines) {
      for (const l of this._gizmoHelperLines) l.visible = e.value;
    }
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
    // Recompute the shadow frustum on EVERY drag tick — without this the
    // frustum stays at its pre-drag size, so the visible shadow gets
    // truncated as the object moves out of the old frustum and only
    // snaps back to correct on mouseUp. Cost: one Box3 union per object
    // per frame, negligible for typical scene sizes.
    this._updateShadowFrustum?.();
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
    // Snap the shadow frustum to the new scene bounds right now —
    // otherwise the frustum stays at its pre-drag size for up to a
    // second (until the setInterval below fires) and the shadow
    // visibly "jumps" into place after the user releases the gizmo.
    this._updateShadowFrustum?.();
  });
  const helper =
    typeof this.transformCtrl.getHelper === "function"
      ? this.transformCtrl.getHelper()
      : this.transformCtrl;
  this.scene.add(helper);
  this._gizmoHelper = helper;
  // TransformControls' helper subgroup contains line objects for two
  // purposes:
  //   1. Long bright axis-hover indicators (red/green/blue/yellow)
  //      that streak across the scene when you hover an arrow.
  //   2. A subtle drag indicator that appears along the active axis
  //      while the user is dragging.
  // The user only wants (2). Two-step strategy:
  //   - Override every helper line material to a subtle gray so the
  //     bright axis colours never appear on screen.
  //   - Hide all helper lines by default; flip them visible only
  //     while the gizmo is being dragged (toggled below by the
  //     dragging-changed listener). On hover the lines stay hidden;
  //     on release they hide again.
  this._gizmoHelperLines = [];
  helper.traverse((o) => {
    if ((o.isLine || o.isLineSegments) && o.material) {
      if (o.material.color) o.material.color.set(0x999999);
      o.material.opacity = 0.45;
      o.material.transparent = true;
      o.material.depthTest = false;
      o.visible = false;
      this._gizmoHelperLines.push(o);
    }
  });

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
  if (this._composer) this._composer.setSize(w, h);
  if (this._outlinePass) this._outlinePass.setSize(w, h);
  this._updateFrame();
  this._updateBgCSS();
};

Pixaroma3DEditor.prototype._animate = function () {
  if (!this.renderer) return;
  this._animId = requestAnimationFrame(() => this._animate());
  this.orbitCtrl.update();
  // Re-enforce helper-line visibility every frame because
  // TransformControls' own update() flips visible=true on hover. We
  // want them visible only during active drag (tracked via
  // _gizmoDragging from dragging-changed).
  if (this._gizmoHelperLines) {
    const want = !!this._gizmoDragging;
    for (const l of this._gizmoHelperLines) {
      if (l.visible !== want) l.visible = want;
    }
  }
  // Use the composer for live preview so OutlinePass renders the
  // selection highlight. The save path bypasses this and calls
  // renderer.render() directly for a clean export.
  if (this._composer) this._composer.render();
  else this.renderer.render(this.scene, this.camera);
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
  // Keep the light's target fixed at world origin. Previously we moved
  // it to the scene's centre, which meant the light direction itself
  // changed whenever any object moved — so dragging one cube visibly
  // re-angled the shadows of every other object. With the target fixed,
  // the light direction stays constant and only the frustum extent
  // grows/shrinks to cover the scene.
  this.light.target.position.set(0, 0, 0);
  this.light.target.updateMatrixWorld();
  // Frustum sized to cover every object from the origin outward (not
  // from the moving centre). Take the max extent on any axis relative
  // to origin, plus a small margin so shadows don't clip at the edge.
  const halfMax = Math.max(
    Math.abs(box.min.x), Math.abs(box.max.x),
    Math.abs(box.min.z), Math.abs(box.max.z),
    Math.abs(box.max.y),
    2,
  ) * 1.2 + 2;
  const sc = this.light.shadow.camera;
  sc.left = -halfMax;
  sc.right = halfMax;
  sc.top = halfMax;
  sc.bottom = -halfMax;
  sc.near = 0.1;
  sc.far = halfMax * 4 + 10;
  sc.updateProjectionMatrix();
};
