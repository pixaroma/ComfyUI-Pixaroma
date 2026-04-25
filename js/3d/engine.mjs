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
  // Store the RenderPass so _setPerspective can update its camera
  // reference when the user swaps perspective ↔ isometric. Without
  // this, pressing 6 then any view key would NEVER change the
  // rendered view — the composer kept drawing with the old camera.
  this._renderPass = new pp.RenderPass(this.scene, this.camera);
  this._composer.addPass(this._renderPass);
  this._outlinePass = new pp.OutlinePass(
    new THREE.Vector2(w, h), this.scene, this.camera,
  );
  // edgeStrength much above ~5 pushes the outline colour brighter than
  // 1.0 in the shader and, after sRGB encoding, shifted from the
  // intended Pixaroma red-orange toward yellow. 3 keeps the colour
  // true at the cost of a slightly softer AA rim.
  this._outlinePass.edgeStrength = 4;
  this._outlinePass.edgeGlow = 0;
  this._outlinePass.edgeThickness = 2;
  this._outlinePass.pulsePeriod = 0;
  // Half-res edge detection — visually identical for a 2px outline and
  // halves the OutlinePass fragment cost on every frame.
  this._outlinePass.downSampleRatio = 2;
  // Use the SAME Pixaroma orange for both visible and hidden passes.
  // hiddenEdgeColor = black was causing parts of the silhouette to
  // vanish whenever a pixel was even slightly occluded (contact edges
  // with the ground plane, edges near the gizmo handles, or shallow-
  // angle facets on pyramid-like shapes where the depth-test briefly
  // flipped). Same colour both ways means the silhouette never
  // disappears regardless of what's in front.
  this._outlinePass.visibleEdgeColor.set(0xf66744);
  this._outlinePass.hiddenEdgeColor.set(0xf66744);
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
    // Live-sync the X/Y/Z transform sliders with whatever the gizmo
    // is doing so the two input methods stay in sync frame-by-frame.
    this._updateTransformSliders?.();
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

  // ── Axis orientation HUD (top-right corner) ──────────────
  // A tiny independent scene + camera rendered in a scissor viewport
  // over the main view. The HUD camera mirrors the main camera's
  // rotation so the world axes in the HUD line up with the world axes
  // visible in the scene — you can always tell which direction is
  // X/Y/Z regardless of how the user has orbited.
  //
  // Using a scissor viewport on the main renderer (vs. a second
  // WebGLRenderer) keeps us under Chrome's ~16 context cap — we
  // already have a thumbnail renderer too.
  const hudScene = new THREE.Scene();
  // Red X, Green Y, Blue Z — standard 3D convention
  const arrowLen = 0.85;
  const headLen = 0.22;
  const headW = 0.12;
  const _arr = (dir, color) =>
    new THREE.ArrowHelper(dir, new THREE.Vector3(), arrowLen, color, headLen, headW);
  hudScene.add(_arr(new THREE.Vector3(1, 0, 0), 0xff4444));
  hudScene.add(_arr(new THREE.Vector3(0, 1, 0), 0x55dd55));
  hudScene.add(_arr(new THREE.Vector3(0, 0, 1), 0x4488ff));
  // X / Y / Z letter labels at the arrow tips via CanvasTexture sprites.
  // Sprites in three.js always face the camera, so the letters stay
  // readable regardless of how the user has orbited — as long as the
  // HUD camera isn't rolled (see _animate where it uses lookAt with
  // world-up to avoid inheriting roll from the main camera).
  //
  // depthTest:false keeps letters on top of their arrow even when the
  // arrow and label overlap along a world axis pointing at the viewer.
  const _mkLabel = (text, colorHex) => {
    const S = 128; // bigger canvas → crisper letters after mipmap downsample
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const ctx = cv.getContext("2d");
    // Thin black halo via shadow (not strokeText — stroke of thickness
    // 6+ around a thin glyph like "Y" fills in the negative space and
    // makes it look like an "I"). 3 overlapping fills at slight
    // offsets gives a clean offset-shadow without the fill-in problem.
    ctx.font = "900 96px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    const cx = S / 2, cy = S / 2;
    // Mini drop-shadow in 4 directions for legibility on any bg
    for (const [dx, dy] of [[-2,0],[2,0],[0,-2],[0,2]]) {
      ctx.fillText(text, cx + dx, cy + dy);
    }
    ctx.fillStyle = colorHex;
    ctx.fillText(text, cx, cy);
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
    );
    // Slightly larger than before so the glyph reads clearly at 80px HUD.
    sp.scale.set(0.55, 0.55, 1);
    return sp;
  };
  const lx = _mkLabel("X", "#ff9090"); lx.position.set(1.2, 0, 0);
  const ly = _mkLabel("Y", "#9ef09e"); ly.position.set(0, 1.2, 0);
  const lz = _mkLabel("Z", "#9bc2ff"); lz.position.set(0, 0, 1.2);
  hudScene.add(lx, ly, lz);

  const hudCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  this._axisHud = {
    scene: hudScene,
    camera: hudCamera,
    size: 80,              // pixels in main canvas
    margin: 10,            // offset from top-right
    visible: true,         // toggled by "Show Axes" checkbox
  };

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
  // Don't re-render the 2048² VSM shadow map every frame — it's the
  // single biggest per-frame cost during orbit/pan/zoom and the scene
  // hasn't changed. We flip needsUpdate=true at every mutation point
  // (scene edits via _updateShadowFrustum, light dir via _applyLightDir).
  this.light.shadow.autoUpdate = false;
  this.light.shadow.needsUpdate = true;
  this.scene.add(this.light);

  this._groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.ShadowMaterial({ opacity: 0.35 }),
  );
  this._groundMesh.rotation.x = -Math.PI / 2;
  // Shadow catcher sits just below y=0 so it doesn't share depth with
  // object bases. Otherwise OutlinePass treats the bottom edge as
  // "occluded by ground" and renders it as hiddenEdgeColor (black),
  // giving the "outline missing on bottom" look.
  this._groundMesh.position.y = -0.002;
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
  // Handle both camera types — OrthographicCamera has no `.aspect`
  // property, it needs left/right recomputed from the viewport aspect,
  // otherwise the frustum stays stuck at whatever aspect the camera
  // was created with and objects look stretched or the scene zooms oddly.
  if (this._isOrtho) {
    const a = w / h;
    this.camera.left = -5 * a;
    this.camera.right = 5 * a;
    this.camera.top = 5;
    this.camera.bottom = -5;
  } else {
    this.camera.aspect = w / h;
  }
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
  // When nothing is selected, skip the composer entirely — OutlinePass
  // + OutputPass still bind RTs and run shaders even on an empty
  // selection, wasting GPU on every orbit/pan/zoom frame.
  const hasOutline = this._outlinePass?.selectedObjects?.length > 0;
  if (this._composer && hasOutline) this._composer.render();
  else this.renderer.render(this.scene, this.camera);

  // ── Axis HUD overlay ─────────────────────────────────────
  // Drawn AFTER the main render into a small scissor viewport at the
  // top-right corner. clearDepth() makes sure the HUD arrows are
  // never clipped by the main scene's depth buffer. Save path skips
  // the whole _animate loop so HUDs never appear in exported PNGs.
  if (this._axisHud && this._axisHud.visible) {
    const hud = this._axisHud;
    // Place the HUD camera along the SAME world-space direction the
    // main camera sits on (relative to origin), but force its up to
    // be world +Y via lookAt. That way the HUD axes reflect the
    // viewer's angle WITHOUT inheriting any camera roll — letters
    // stay upright on screen even when the main camera is tilted.
    const THREE = getTHREE();
    if (!this._axisHudTmp) this._axisHudTmp = new THREE.Vector3();
    const dir = this._axisHudTmp;
    this.camera.getWorldDirection(dir); // main camera's -Z in world space
    // Place HUD camera at the opposite of the main camera's look dir
    // so it looks back at origin from the same side as main camera.
    // Distance is tuned to keep the arrow tips + letter labels (at
     // position ~1.2 with sprite half-size ~0.275) safely inside the
     // viewport. At FOV 50° a distance of 3.5 gives ~1.63 of visible
     // half-extent which leaves margin for the labels at corner poses.
    hud.camera.position.copy(dir).multiplyScalar(-3.5);
    // Pick a non-degenerate up vector: world +Y normally, but when the
    // user is looking nearly straight up or down (top/bottom view) the
    // up and look directions become parallel and lookAt flips. Fall
    // back to world -Z so the letters stay stable near those angles.
    if (Math.abs(dir.y) > 0.98) {
      hud.camera.up.set(0, 0, dir.y > 0 ? 1 : -1);
    } else {
      hud.camera.up.set(0, 1, 0);
    }
    hud.camera.lookAt(0, 0, 0);

    // Renderer viewport uses CSS pixels; getSize() returns the same.
    // Three.js viewport Y is 0 at the BOTTOM, so top-right means y = H - size - margin.
    if (!this._axisHudSize) this._axisHudSize = new THREE.Vector2();
    const sz = this.renderer.getSize(this._axisHudSize);
    const s = hud.size;
    const m = hud.margin;
    const vx = sz.x - s - m;
    const vy = sz.y - s - m;
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.setViewport(vx, vy, s, s);
    this.renderer.setScissor(vx, vy, s, s);
    this.renderer.setScissorTest(true);
    this.renderer.render(hud.scene, hud.camera);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, sz.x, sz.y);
    this.renderer.autoClear = prevAutoClear;
  }
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
  this.light.shadow.needsUpdate = true;
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
  // Flag the shadow map for refresh — autoUpdate is off, so this is
  // the single funnel through which scene edits trigger a shadow re-bake.
  this.light.shadow.needsUpdate = true;
};
