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

  // Screen-space selection outline via three.js OutlinePass — same
  // approach Blender / Unity / Unreal use. Gives a clean silhouette
  // for any shape (subdivided, flat-shaded, concave) that bolts its
  // on-screen width regardless of zoom.
  //
  // Conservative settings this time:
  //   - edgeStrength 3: line reads orange without the over-saturated
  //     bloom we had at 20.
  //   - edgeThickness 1, edgeGlow 0, pulsePeriod 0: crisp 1px line.
  //   - downSampleRatio 1: full-res edge detection, no ray artifacts.
  //   - hiddenEdgeColor black: outline that's occluded by the gizmo
  //     (or any object in front) disappears against the scene bg
  //     rather than bleeding through as orange.
  const pp = getPostprocessing();
  this._composer = new pp.EffectComposer(this.renderer);
  this._composer.setSize(w, h);
  this._composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  this._composer.addPass(new pp.RenderPass(this.scene, this.camera));
  this._outlinePass = new pp.OutlinePass(
    new THREE.Vector2(w, h), this.scene, this.camera,
  );
  this._outlinePass.edgeStrength = 3;
  this._outlinePass.edgeGlow = 0;
  this._outlinePass.edgeThickness = 1;
  this._outlinePass.pulsePeriod = 0;
  this._outlinePass.downSampleRatio = 1;
  this._outlinePass.visibleEdgeColor.set(0xf66744);
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
    // Show the custom gray drag indicator line during drag only.
    // Orient it along the axis currently being manipulated.
    if (this._dragIndicator) {
      if (e.value && this.activeObj) {
        const axis = this.transformCtrl.axis; // 'X' | 'Y' | 'Z' | 'XY' | ...
        this._dragIndicator.position.copy(this.activeObj.position);
        if (axis === "Y")      this._dragIndicator.rotation.set(0, 0, Math.PI / 2);
        else if (axis === "Z") this._dragIndicator.rotation.set(0, Math.PI / 2, 0);
        else                    this._dragIndicator.rotation.set(0, 0, 0); // X default
        // Only show for single-axis translate drags; hide for rotate/
        // scale and multi-axis pulls (no single line represents them).
        const mode = this.transformCtrl.getMode();
        this._dragIndicator.visible =
          mode === "translate" && (axis === "X" || axis === "Y" || axis === "Z");
      } else {
        this._dragIndicator.visible = false;
      }
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
  // Kill every line object inside the TransformControls helper —
  // these are the bright axis-hover / axis-drag indicators that
  // streak across the scene. Material / visibility overrides don't
  // stick (TransformControls reasserts them on hover), so permanent
  // detachment is the only reliable fix. The arrow handles, plane
  // handles, balls, and pickers are all Mesh objects and stay intact.
  const linesToRemove = [];
  helper.traverse((o) => {
    if (o.isLine || o.isLineSegments || o.isLineLoop) linesToRemove.push(o);
  });
  linesToRemove.forEach((o) => o.parent?.remove(o));

  // Custom drag indicator — a single subtle gray line that we own.
  // Hidden by default; made visible + oriented along the active axis
  // while the user drags the gizmo. Gives the "I'm moving along X"
  // visual feedback the user asked for without bringing back the
  // bright built-in indicators.
  this._dragIndicator = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-500, 0, 0),
      new THREE.Vector3( 500, 0, 0),
    ]),
    // White drag indicator per the user's mockup — reads cleanly on
    // both the light top face and the dark shadowed sides of a cube,
    // and unambiguously signals "this is the axis you're moving
    // along" without being confused for an outline.
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    }),
  );
  this._dragIndicator.renderOrder = 999;
  this._dragIndicator.visible = false;
  this.scene.add(this._dragIndicator);

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
  // Composer renders scene + OutlinePass for live preview. Save path
  // bypasses this and calls renderer.render() directly so exported
  // PNGs don't have the selection highlight baked in.
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
