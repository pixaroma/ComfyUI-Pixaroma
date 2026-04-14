// ============================================================
// Pixaroma 3D Editor — Shape registry
// Single source of truth for every primitive shape:
//   id → { icon, label, category, live, params, defaults, build(THREE, p) }
// Adding a new shape = add one entry here. No other file edits needed
// for the shape list / param panel / geometry build path.
// ============================================================

// Params are [{ key, label, min, max, step }]. Step matters for UI;
// integer step = integer input, float step = float input.
// `live: true` = rebuild on every slider tick (cheap shapes).
// `live: false` = rebuild debounced 60 ms (heavy shapes).

// ─── Lazy-loaded Teapot geometry ──────────────────────────────
// TeapotGeometry lives in three/examples and weighs ~20KB. We fetch
// it only when the user clicks Teapot (or reopens a scene that
// already contains a teapot) so first-editor-open stays fast.
let _TeapotGeometry = null;
export async function loadTeapotGeometry() {
  if (_TeapotGeometry) return _TeapotGeometry;
  const mod = await import(
    "https://esm.sh/three@0.170.0/examples/jsm/geometries/TeapotGeometry.js"
  );
  _TeapotGeometry = mod.TeapotGeometry;
  return _TeapotGeometry;
}

// ─── Seeded 3D simplex noise (public-domain, compact) ──────────────
// Adapted from Stefan Gustavson's reference implementation, seeded via
// a deterministic permutation shuffle so the same Seed param always
// produces the same shape (round-tripping save/load is reproducible).
// Returns values in roughly [-1, 1].
function makeNoise(seed) {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0 || 1;
  for (let i = 255; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad3 = [
    [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
    [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
    [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
  ];
  const dot = (g, x, y, z) => g[0]*x + g[1]*y + g[2]*z;
  return function noise3(x, y, z) {
    const F3 = 1/3, G3 = 1/6;
    const s2 = (x + y + z) * F3;
    const i = Math.floor(x + s2), j = Math.floor(y + s2), k = Math.floor(z + s2);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0)      { i1=1;j1=0;k1=0; i2=1;j2=1;k2=0; }
      else if (x0 >= z0) { i1=1;j1=0;k1=0; i2=1;j2=0;k2=1; }
      else               { i1=0;j1=0;k1=1; i2=1;j2=0;k2=1; }
    } else {
      if (y0 < z0)       { i1=0;j1=0;k1=1; i2=0;j2=1;k2=1; }
      else if (x0 < z0)  { i1=0;j1=1;k1=0; i2=0;j2=1;k2=1; }
      else               { i1=0;j1=1;k1=0; i2=1;j2=1;k2=0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2*G3, y2 = y0 - j2 + 2*G3, z2 = z0 - k2 + 2*G3;
    const x3 = x0 - 1 + 3*G3, y3 = y0 - 1 + 3*G3, z3 = z0 - 1 + 3*G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n0=0,n1=0,n2=0,n3=0;
    let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
    if (t0 >= 0) { t0*=t0; n0 = t0*t0*dot(grad3[perm[ii+perm[jj+perm[kk]]]%12], x0,y0,z0); }
    let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
    if (t1 >= 0) { t1*=t1; n1 = t1*t1*dot(grad3[perm[ii+i1+perm[jj+j1+perm[kk+k1]]]%12], x1,y1,z1); }
    let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
    if (t2 >= 0) { t2*=t2; n2 = t2*t2*dot(grad3[perm[ii+i2+perm[jj+j2+perm[kk+k2]]]%12], x2,y2,z2); }
    let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
    if (t3 >= 0) { t3*=t3; n3 = t3*t3*dot(grad3[perm[ii+1+perm[jj+1+perm[kk+1]]]%12], x3,y3,z3); }
    return 32 * (n0 + n1 + n2 + n3);
  };
}

export const SHAPES = {
  cube: {
    icon: "cube.svg",
    label: "Cube",
    category: "boxy",
    live: true,
    params: [
      { key: "width",  label: "Width",  min: 0.1, max: 5, step: 0.1 },
      { key: "height", label: "Height", min: 0.1, max: 5, step: 0.1 },
      { key: "depth",  label: "Depth",  min: 0.1, max: 5, step: 0.1 },
    ],
    defaults: { width: 1, height: 1, depth: 1 },
    build: (THREE, p) => {
      const g = new THREE.BoxGeometry(p.width, p.height, p.depth);
      g.computeVertexNormals();
      return g;
    },
  },
  prism: {
    icon: "prism.svg",
    label: "Prism",
    category: "boxy",
    live: true,
    params: [
      { key: "radius", label: "Radius", min: 0.1, max: 3, step: 0.1 },
      { key: "length", label: "Length", min: 0.1, max: 5, step: 0.1 },
      { key: "sides",  label: "Sides",  min: 3,   max: 8, step: 1 },
    ],
    defaults: { radius: 0.5, length: 1.5, sides: 3 },
    build: (THREE, p) => {
      // Build the prism as an explicit 2D n-gon in the XY plane, then
      // extrude along Z. This gives us full control over the cross-
      // section orientation regardless of Three.js's internal cylinder
      // conventions.
      //
      //   - Odd sides (3, 5, 7): one vertex at +Y (peak up) → classic
      //     triangular-prism "house roof" silhouette.
      //   - Even sides (4, 6, 8): one flat edge at top AND one flat
      //     edge at bottom → square bar, hex bar, etc.
      //
      // In both cases we translate after extrusion so the lowest vertex
      // sits at local y=0 — the prism's flat bottom stays planted on
      // the floor when the params panel changes radius.
      const r = p.radius, h = p.length, n = p.sides | 0;
      const startAngle = (n % 2 === 0)
        ? (Math.PI / 2 - Math.PI / n) // flat top+bottom
        : (Math.PI / 2);              // peak up
      const shape = new THREE.Shape();
      for (let i = 0; i < n; i++) {
        const a = startAngle + (i * 2 * Math.PI) / n;
        const x = r * Math.cos(a);
        const y = r * Math.sin(a);
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: h,
        bevelEnabled: false,
      });
      // ExtrudeGeometry lays the shape at z=0 and extrudes to z=+h.
      // Re-center along Z so the prism straddles the origin front-back.
      g.translate(0, 0, -h / 2);
      // Flat bottom at y=0.
      g.computeBoundingBox();
      g.translate(0, -g.boundingBox.min.y, 0);
      g.computeVertexNormals();
      return g;
    },
  },
  pyramid: {
    icon: "pyramid.svg",
    label: "Pyramid",
    category: "boxy",
    live: true,
    params: [
      { key: "base",   label: "Base",   min: 0.1, max: 3, step: 0.1 },
      { key: "height", label: "Height", min: 0.1, max: 5, step: 0.1 },
    ],
    defaults: { base: 0.7, height: 1.0 },
    build: (THREE, p) => {
      // ConeGeometry with 4 sides = square pyramid. By default the cone
      // is centered on origin (base at y=-h/2, apex at y=+h/2), which
      // means the base moves DOWN as height grows. Translate so the base
      // sits at local y=0 and only the apex rises — the base stays
      // planted on the ground.
      const g = new THREE.ConeGeometry(p.base, p.height, 4);
      g.translate(0, p.height / 2, 0);
      g.computeVertexNormals();
      return g;
    },
  },
  sphere: {
    icon: "sphere.svg",
    label: "Sphere",
    category: "rounded",
    live: true,
    params: [
      { key: "radius",     label: "Radius",   min: 0.1, max: 3,   step: 0.1 },
      { key: "widthSegs",  label: "Segments", min: 3,   max: 128, step: 1 },
      { key: "heightSegs", label: "Rings",    min: 2,   max: 128, step: 1 },
    ],
    defaults: { radius: 0.6, widthSegs: 16, heightSegs: 16 },
    build: (THREE, p) => {
      const g = new THREE.SphereGeometry(p.radius, p.widthSegs, p.heightSegs);
      g.computeVertexNormals();
      return g;
    },
  },
  capsule: {
    icon: "capsule.svg",
    label: "Capsule",
    category: "rounded",
    live: true,
    params: [
      { key: "radius",     label: "Radius",       min: 0.1, max: 2,  step: 0.05 },
      { key: "length",     label: "Length",       min: 0.1, max: 5,  step: 0.1 },
      { key: "capSegs",    label: "Cap Segments", min: 2,   max: 32, step: 1 },
      { key: "radialSegs", label: "Radial Segs",  min: 3,   max: 64, step: 1 },
    ],
    defaults: { radius: 0.3, length: 0.8, capSegs: 6, radialSegs: 16 },
    build: (THREE, p) => {
      // CapsuleGeometry is centered on origin; bottom cap ends up at
      // y = -(radius + length/2). _addObject re-snaps to the floor via
      // bounding box, so no translate needed here.
      const g = new THREE.CapsuleGeometry(
        p.radius, p.length, p.capSegs, p.radialSegs);
      g.computeVertexNormals();
      return g;
    },
  },
  crystal: {
    icon: "crystal.svg",
    label: "Crystal",
    category: "rounded",
    live: true,
    params: [
      { key: "radius",  label: "Radius",    min: 0.1, max: 2,  step: 0.05 },
      { key: "topH",    label: "Top H",     min: 0.1, max: 3,  step: 0.05 },
      { key: "bottomH", label: "Bottom H",  min: 0.1, max: 3,  step: 0.05 },
      { key: "sides",   label: "Sides",     min: 4,   max: 16, step: 1 },
    ],
    defaults: { radius: 0.4, topH: 0.9, bottomH: 0.4, sides: 6 },
    build: (THREE, p) => {
      // LatheGeometry revolves a 2D profile around the +Y axis. Using
      // 3 points (bottom tip → middle ring → top tip) yields a bipyramid
      // a.k.a. a faceted crystal / gemstone shape. `sides` controls the
      // facet count around the revolution.
      const pts = [
        new THREE.Vector2(0,        -p.bottomH),
        new THREE.Vector2(p.radius,  0),
        new THREE.Vector2(0,         p.topH),
      ];
      const g = new THREE.LatheGeometry(pts, p.sides);
      g.computeVertexNormals();
      return g;
    },
  },
  cylinder: {
    icon: "cylinder.svg",
    label: "Cylinder",
    category: "cylindrical",
    live: true,
    params: [
      { key: "radiusTop",    label: "Top Radius", min: 0,    max: 3, step: 0.05 },
      { key: "radiusBottom", label: "Btm Radius", min: 0.05, max: 3, step: 0.05 },
      { key: "height",       label: "Height",     min: 0.1,  max: 5, step: 0.1 },
      { key: "sides",        label: "Sides",      min: 3,    max: 128, step: 1 },
    ],
    defaults: { radiusTop: 0.5, radiusBottom: 0.5, height: 1.2, sides: 16 },
    build: (THREE, p) => {
      const g = new THREE.CylinderGeometry(
        p.radiusTop, p.radiusBottom, p.height, p.sides);
      g.computeVertexNormals();
      return g;
    },
  },
  tube: {
    icon: "tube.svg",
    label: "Tube",
    category: "cylindrical",
    live: true,
    params: [
      { key: "outerRadius", label: "Outer R", min: 0.15, max: 3,   step: 0.05 },
      { key: "innerRadius", label: "Inner R", min: 0.05, max: 2.8, step: 0.05 },
      { key: "height",      label: "Height",  min: 0.1,  max: 5,   step: 0.1 },
      { key: "sides",       label: "Sides",   min: 8,    max: 96,  step: 1 },
    ],
    defaults: { outerRadius: 0.5, innerRadius: 0.35, height: 1.0, sides: 32 },
    // Slider-input constraint: the param panel calls this BEFORE writing
    // the new value to geoParams, so Outer R is held above Inner R and
    // Inner R is held below Outer R. Prevents both the "tube collapses
    // when Outer R dragged below Inner R" and the "Outer R expands when
    // Inner R dragged past it" failure modes. The slider visually sticks
    // at the boundary, communicating the limit to the user.
    constraint: (p, key, v) => {
      if (key === "outerRadius") return Math.max(v, p.innerRadius + 0.01);
      if (key === "innerRadius") return Math.min(v, p.outerRadius - 0.01);
      return v;
    },
    // Dynamic slider bounds — the param panel uses this to shrink each
    // slider's track to the current valid envelope. Without it the
    // sliders show their full static range while the constraint silently
    // clamps drag, which feels like the slider is "stuck".
    bounds: (p, key) => {
      if (key === "outerRadius") return { min: p.innerRadius + 0.01 };
      if (key === "innerRadius") return { max: p.outerRadius - 0.01 };
      return {};
    },
    build: (THREE, p) => {
      // Hollow pipe: draw a filled outer disc with an inner circular hole
      // as a Shape, then extrude along the shape's normal (Z by default)
      // and rotate so the extrusion axis ends up on Y. A defensive clamp
      // still enforces innerR < outerR in case params arrive from
      // persistence/undo without passing through the constraint hook.
      const outerR = Math.max(p.outerRadius, p.innerRadius + 0.01);
      const innerR = Math.min(p.innerRadius, outerR - 0.01);
      const outer = new THREE.Shape();
      outer.absarc(0, 0, outerR, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
      outer.holes.push(hole);
      const g = new THREE.ExtrudeGeometry(outer, {
        depth: p.height,
        bevelEnabled: false,
        curveSegments: p.sides,
      });
      // Re-orient: Y becomes the height axis, and centre the tube on the
      // origin so _addObject's bounding-box snap lands it neatly on the
      // floor (and shape resizes don't drag the mesh around).
      g.rotateX(-Math.PI / 2);
      g.translate(0, -p.height / 2, 0);
      g.computeVertexNormals();
      return g;
    },
  },
  cone: {
    icon: "cone.svg",
    label: "Cone",
    category: "cylindrical",
    live: true,
    params: [
      { key: "radius", label: "Radius", min: 0.1, max: 3,   step: 0.1 },
      { key: "height", label: "Height", min: 0.1, max: 5,   step: 0.1 },
      { key: "sides",  label: "Sides",  min: 3,   max: 128, step: 1 },
    ],
    defaults: { radius: 0.5, height: 1.2, sides: 16 },
    build: (THREE, p) => {
      // Same trick as pyramid: ConeGeometry centers on the origin so its
      // base sits at y=-h/2. _rebuildObjectGeometry swaps geometry but
      // doesn't re-snap position, so when Height changes mid-edit the
      // base would drift down. Translate the geometry up by h/2 so the
      // base is at local y=0 — the apex is the only thing that grows.
      const g = new THREE.ConeGeometry(p.radius, p.height, p.sides);
      g.translate(0, p.height / 2, 0);
      g.computeVertexNormals();
      return g;
    },
  },
  torus: {
    icon: "torus.svg",
    label: "Torus",
    category: "toroidal",
    live: true,
    params: [
      { key: "radius",     label: "Radius",      min: 0.1,  max: 3,   step: 0.1 },
      { key: "tube",       label: "Tube",        min: 0.01, max: 1.5, step: 0.01 },
      { key: "radialSegs", label: "Radial Segs", min: 3,    max: 64,  step: 1 },
      { key: "tubeSegs",   label: "Tube Segs",   min: 3,    max: 128, step: 1 },
    ],
    defaults: { radius: 0.5, tube: 0.2, radialSegs: 12, tubeSegs: 32 },
    // Standard torus rule: tube radius < ring radius. Once tube >= radius
    // the geometry self-intersects through the centre — reads as a sphere
    // with an internal funnel rather than a donut. Clamp so the user
    // can't drag past that visual cliff. (For sphere-like shapes the
    // user has the actual Sphere primitive.)
    constraint: (p, key, v) => {
      if (key === "tube")   return Math.min(v, p.radius - 0.01);
      if (key === "radius") return Math.max(v, p.tube + 0.01);
      return v;
    },
    bounds: (p, key) => {
      if (key === "tube")   return { max: p.radius - 0.01 };
      if (key === "radius") return { min: p.tube + 0.01 };
      return {};
    },
    build: (THREE, p) => {
      // Defensive clamp in case params arrive from persistence/undo
      // without passing through the constraint hook.
      const tube = Math.min(p.tube, p.radius - 0.01);
      const g = new THREE.TorusGeometry(p.radius, tube, p.radialSegs, p.tubeSegs);
      g.computeVertexNormals();
      return g;
    },
  },
  ring: {
    icon: "ring.svg",
    label: "Ring",
    category: "toroidal",
    live: true,
    params: [
      { key: "outerRadius", label: "Outer R",   min: 0.1,  max: 3,   step: 0.05 },
      { key: "innerRadius", label: "Inner R",   min: 0.05, max: 2.8, step: 0.05 },
      { key: "thickness",   label: "Thickness", min: 0.01, max: 1,   step: 0.01 },
      { key: "segments",    label: "Segments",  min: 8,    max: 128, step: 1 },
    ],
    defaults: { outerRadius: 0.5, innerRadius: 0.3, thickness: 0.05, segments: 32 },
    // Same constraint as tube — keep Inner R below Outer R, no collapse.
    constraint: (p, key, v) => {
      if (key === "outerRadius") return Math.max(v, p.innerRadius + 0.01);
      if (key === "innerRadius") return Math.min(v, p.outerRadius - 0.01);
      return v;
    },
    bounds: (p, key) => {
      if (key === "outerRadius") return { min: p.innerRadius + 0.01 };
      if (key === "innerRadius") return { max: p.outerRadius - 0.01 };
      return {};
    },
    build: (THREE, p) => {
      // Annulus extruded along Y by a small thickness. Using Extrude
      // (instead of THREE.RingGeometry) gives us a proper two-sided 3D
      // ring that doesn't z-fight with the floor and looks correct from
      // any angle. Default thickness of 0.05 reads as a thin band; user
      // can crank it up to make it a flat washer.
      const outerR = Math.max(p.outerRadius, p.innerRadius + 0.01);
      const innerR = Math.min(p.innerRadius, outerR - 0.01);
      const outer = new THREE.Shape();
      outer.absarc(0, 0, outerR, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
      outer.holes.push(hole);
      const g = new THREE.ExtrudeGeometry(outer, {
        depth: p.thickness,
        bevelEnabled: false,
        curveSegments: p.segments,
      });
      // Lay flat on the floor (Y becomes height) and centre on origin
      // so _addObject's bounding-box snap parks the bottom face at y=0.
      g.rotateX(-Math.PI / 2);
      g.translate(0, -p.thickness / 2, 0);
      g.computeVertexNormals();
      return g;
    },
  },
  gear: {
    icon: "gear.svg",
    label: "Gear",
    category: "toroidal",
    live: false, // toothed ExtrudeGeometry is expensive — debounce
    params: [
      { key: "outerRadius", label: "Outer R",     min: 0.3,  max: 3,    step: 0.05 },
      { key: "innerRadius", label: "Inner Hole",  min: 0.05, max: 2,    step: 0.05 },
      { key: "teeth",       label: "Teeth",       min: 4,    max: 48,   step: 1 },
      { key: "gap",         label: "Gap",         min: 0.1,  max: 0.7,  step: 0.05 },
      { key: "holeSides",   label: "Hole Sides",  min: 3,    max: 32,   step: 1 },
      { key: "thickness",   label: "Thickness",   min: 0.05, max: 2,    step: 0.05 },
      { key: "toothDepth",  label: "Tooth Depth", min: 0.02, max: 0.5,  step: 0.01 },
    ],
    defaults: {
      outerRadius: 0.8, innerRadius: 0.2, teeth: 12,
      gap: 0.4, holeSides: 32,
      thickness: 0.3, toothDepth: 0.12,
    },
    // Three constraints to keep the gear geometrically valid:
    //   - Tooth Depth must leave room for the inner hole and a wall.
    //   - Inner Hole must fit inside the tooth-base radius.
    //   - Outer R must be wide enough to host the current teeth + hole.
    // Without these, dragging any one slider can produce overlapping
    // outer/inner contours and the ExtrudeGeometry collapses to nothing.
    constraint: (p, key, v) => {
      if (key === "innerRadius") {
        const maxInner = p.outerRadius - p.toothDepth - 0.04;
        return Math.min(v, Math.max(0.05, maxInner));
      }
      if (key === "toothDepth") {
        const maxDepth = p.outerRadius - p.innerRadius - 0.04;
        return Math.min(v, Math.max(0.02, maxDepth));
      }
      if (key === "outerRadius") {
        const minOuter = p.innerRadius + p.toothDepth + 0.04;
        return Math.max(v, minOuter);
      }
      return v;
    },
    // Dynamic slider tracks shrink to match the constraint envelope, so
    // the user sees Tooth Depth's max move when they drag Inner Hole or
    // Outer R, instead of the slider visibly running past its real limit.
    bounds: (p, key) => {
      if (key === "innerRadius") {
        return { max: Math.max(0.05, p.outerRadius - p.toothDepth - 0.04) };
      }
      if (key === "toothDepth") {
        return { max: Math.max(0.02, p.outerRadius - p.innerRadius - 0.04) };
      }
      if (key === "outerRadius") {
        return { min: p.innerRadius + p.toothDepth + 0.04 };
      }
      return {};
    },
    build: (THREE, p) => {
      // Build a flat 2D gear silhouette as a Shape: walk N teeth around
      // the rim, alternating between the base radius (gap between teeth)
      // and the tip radius (top of tooth). Punch a polygonal hole in the
      // middle, then extrude on Z and rotate so the gear stands flat
      // (axis on Y). Bevel softens the edges so reflections catch.
      //
      // `gap` (0..1) is the fraction of each tooth-step taken up by the
      // empty space between teeth. With gap=0 the teeth are touching;
      // with gap=0.7 the teeth become narrow spikes far apart. The tooth
      // itself uses the remaining (1-gap) of the step, with two short
      // ramps (base→tip→tip→base) shaping its profile.
      const teeth = Math.max(4, Math.round(p.teeth));
      const tipR  = p.outerRadius;
      const baseR = Math.max(p.outerRadius - p.toothDepth, p.innerRadius + 0.02);
      const shape = new THREE.Shape();
      const stepAngle = (Math.PI * 2) / teeth;
      const gap = Math.max(0, Math.min(0.9, p.gap ?? 0.4));
      const toothFrac = 1 - gap;
      // Tooth profile within its step: ramp up, plateau, ramp down.
      const f1 = toothFrac * 0.3;     // base → tip ramp end
      const f2 = toothFrac * 0.7;     // tip plateau end
      const f3 = toothFrac;           // tip → base ramp end
      for (let i = 0; i < teeth; i++) {
        const a0 = i * stepAngle;
        const pts = [
          [baseR, a0],
          [tipR,  a0 + stepAngle * f1],
          [tipR,  a0 + stepAngle * f2],
          [baseR, a0 + stepAngle * f3],
        ];
        pts.forEach(([r, a], idx) => {
          const x = Math.cos(a) * r, y = Math.sin(a) * r;
          if (i === 0 && idx === 0) shape.moveTo(x, y);
          else shape.lineTo(x, y);
        });
      }
      shape.closePath();
      // Polygonal inner hole. holeSides=32 reads as a smooth circle;
      // smaller values (6=hex, 4=square, 3=triangle) give faceted holes.
      // Holes must wind opposite to the outer shape for ExtrudeGeometry,
      // so we walk angles in the negative direction. We stop one short
      // of holeSides and call closePath() — closing with an explicit
      // duplicate point produces a zero-length segment that confuses
      // ExtrudeGeometry's triangulator and shows up as a sharp visual
      // glitch on the front face.
      const holeSides = Math.max(3, Math.round(p.holeSides ?? 32));
      const holeR = Math.min(p.innerRadius, baseR - 0.02);
      const hole = new THREE.Path();
      for (let i = 0; i < holeSides; i++) {
        const a = -i * (Math.PI * 2) / holeSides;
        const x = Math.cos(a) * holeR, y = Math.sin(a) * holeR;
        if (i === 0) hole.moveTo(x, y);
        else hole.lineTo(x, y);
      }
      hole.closePath();
      shape.holes.push(hole);
      // Bevel sizes are decoupled from thickness so the tooth silhouette
      // stays put when the user changes Thickness. Both are clamped to a
      // small fraction of toothDepth so the bevel never eats into the
      // tooth gap (which would visually merge teeth at high thickness).
      const bev = Math.min(0.025, p.toothDepth * 0.18);
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: p.thickness,
        bevelEnabled: true,
        bevelThickness: bev,
        bevelSize: bev,
        bevelSegments: 2,
        curveSegments: 4,
      });
      // Stand the gear flat (axis on Y), centered around origin so the
      // bounding-box snap in _addObject lands the lowest face at y=0.
      g.rotateX(-Math.PI / 2);
      g.translate(0, -p.thickness / 2, 0);
      g.computeVertexNormals();
      return g;
    },
  },
  terrain: {
    icon: "terrain.svg",
    label: "Terrain",
    category: "flat",
    live: false, // PlaneGeometry with up to 128² verts is heavy — debounce
    params: [
      { key: "size",        label: "Size",      min: 1,    max: 10,   step: 0.5 },
      { key: "detail",      label: "Detail",    min: 8,    max: 128,  step: 1 },
      { key: "heightScale", label: "Height",    min: 0.02, max: 3,    step: 0.02 },
      { key: "roughness",   label: "Roughness", min: 0.1,  max: 3,    step: 0.1 },
      { key: "seed",        label: "Seed",      min: 1,    max: 9999, step: 1 },
    ],
    defaults: { size: 4, detail: 64, heightScale: 0.15, roughness: 1.0, seed: 42 },
    build: (THREE, p) => {
      // Subdivided plane displaced on Z by layered simplex noise (3 octaves
      // for richer hills/valleys), then rotated to lie on XZ. Same Seed
      // reproduces the same shape so save/load round-trips deterministically.
      const noise = makeNoise(p.seed);
      const g = new THREE.PlaneGeometry(p.size, p.size, p.detail, p.detail);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        const n = noise(x * p.roughness, y * p.roughness, 0) * 0.5
                + noise(x * p.roughness * 2.3, y * p.roughness * 2.3, 0) * 0.25
                + noise(x * p.roughness * 4.7, y * p.roughness * 4.7, 0) * 0.125;
        pos.setZ(i, n * p.heightScale);
      }
      g.rotateX(-Math.PI / 2);
      g.computeVertexNormals();
      return g;
    },
  },
  blob: {
    icon: "blob.svg",
    label: "Blob",
    category: "rounded",
    live: false,
    params: [
      { key: "radius",     label: "Radius",     min: 0.2, max: 2,    step: 0.05 },
      { key: "detail",     label: "Detail",     min: 1,   max: 5,    step: 1 },
      { key: "strength",   label: "Strength",   min: 0,   max: 0.8,  step: 0.01 },
      { key: "smoothness", label: "Smoothness", min: 0.5, max: 4,    step: 0.1 },
      { key: "octaves",    label: "Octaves",    min: 1,   max: 4,    step: 1 },
      { key: "stretchY",   label: "Stretch Y",  min: 0.3, max: 2.5,  step: 0.05 },
      { key: "seed",       label: "Seed",       min: 1,   max: 9999, step: 1 },
    ],
    defaults: { radius: 0.6, detail: 3, strength: 0.25, smoothness: 1.5, octaves: 2, stretchY: 1.0, seed: 7 },
    build: (THREE, p) => {
      // Icosahedron sphere with each vertex pushed in/out along its
      // radial direction by N octaves of simplex noise — produces an
      // organic lumpy shape. Higher octaves add finer detail on top of
      // the base lobes. Stretch Y scales the final mesh vertically so
      // the user can squash it (mushroom) or elongate it (gourd).
      const noise = makeNoise(p.seed);
      const g = new THREE.IcosahedronGeometry(p.radius, p.detail);
      const pos = g.attributes.position;
      const v = new THREE.Vector3();
      const octs = Math.max(1, Math.min(4, Math.round(p.octaves)));
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        const len = v.length();
        let n = 0, amp = 1, freq = 1, norm = 0;
        for (let k = 0; k < octs; k++) {
          const sx = (v.x / p.smoothness) * freq;
          const sy = (v.y / p.smoothness) * freq;
          const sz = (v.z / p.smoothness) * freq;
          n += noise(sx, sy, sz) * amp;
          norm += amp;
          amp *= 0.5; freq *= 2;
        }
        n /= norm; // normalize so adding octaves doesn't blow up displacement
        v.setLength(len * (1 + n * p.strength));
        pos.setXYZ(i, v.x, v.y * p.stretchY, v.z);
      }
      g.computeVertexNormals();
      return g;
    },
  },
  rock: {
    icon: "rock.svg",
    label: "Rock",
    category: "complex",
    live: false,
    params: [
      { key: "size",      label: "Size",      min: 0.2, max: 2,    step: 0.05 },
      { key: "detail",    label: "Detail",    min: 1,   max: 4,    step: 1 },
      { key: "roughness", label: "Roughness", min: 0.1, max: 0.7,  step: 0.02 },
      { key: "sharpness", label: "Sharpness", min: 0.5, max: 3,    step: 0.1 },
      { key: "stretchY",  label: "Stretch Y", min: 0.3, max: 2.5,  step: 0.05 },
      { key: "seed",      label: "Seed",      min: 1,   max: 9999, step: 1 },
    ],
    defaults: { size: 0.6, detail: 2, roughness: 0.35, sharpness: 1.6, stretchY: 0.85, seed: 99 },
    build: (THREE, p) => {
      // Like Blob but at lower detail and with two octaves of noise for
      // jagged angular silhouette. Skip computeVertexNormals so the mesh
      // renders flat-shaded — the visible facets read as "rock".
      // Sharpness applies an exponential curve to the noise so values
      // bias toward extremes, giving more pronounced flats and ridges.
      const noise = makeNoise(p.seed);
      const g = new THREE.IcosahedronGeometry(p.size, p.detail);
      const pos = g.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        const len = v.length();
        const n1 = noise(v.x * 2, v.y * 2, v.z * 2);
        const n2 = noise(v.x * 5, v.y * 5, v.z * 5) * 0.3;
        let n = n1 + n2;
        // Sharpen / soften: |n|^(1/sharp) preserves sign, biases magnitudes.
        n = Math.sign(n) * Math.pow(Math.abs(n), 1 / p.sharpness);
        const newLen = len * (1 + n * p.roughness);
        // Floor at 50% of original length so the rock can't collapse
        // into a needle on aggressive noise.
        v.setLength(Math.max(newLen, len * 0.5));
        pos.setXYZ(i, v.x, v.y * p.stretchY, v.z);
      }
      // Intentionally skip computeVertexNormals — flat shading reads as "rock"
      return g;
    },
  },
  teapot: {
    icon: "teapot.svg",
    label: "Teapot",
    category: "complex",
    live: false,
    params: [
      { key: "size",     label: "Size",     min: 0.2, max: 2,  step: 0.05 },
      { key: "segments", label: "Segments", min: 3,   max: 16, step: 1 },
      { key: "lid",      label: "Lid",      min: 0,   max: 1,  step: 1 },
      { key: "body",     label: "Body",     min: 0,   max: 1,  step: 1 },
      { key: "spout",    label: "Spout",    min: 0,   max: 1,  step: 1 },
      { key: "bottom",   label: "Bottom",   min: 0,   max: 1,  step: 1 },
    ],
    defaults: { size: 0.5, segments: 8, lid: 1, body: 1, spout: 1, bottom: 1 },
    build: (THREE, p) => {
      // If the TeapotGeometry module hasn't resolved yet, fall back to
      // a placeholder sphere. core.mjs preloads the module before the
      // first _addObject('teapot'), and persistence.mjs preloads it
      // before _restoreScene rebuilds saved teapots — so this fallback
      // is only a safety net for edge cases.
      if (!_TeapotGeometry) return new THREE.SphereGeometry(p.size, 16, 16);
      const g = new _TeapotGeometry(
        p.size, p.segments,
        !!p.bottom, !!p.lid, !!p.body, false, !!p.spout,
      );
      g.computeVertexNormals();
      return g;
    },
  },
  plane: {
    icon: "plane.svg",
    label: "Plane",
    category: "flat",
    live: true,
    params: [
      { key: "width",  label: "Width",  min: 0.1, max: 10, step: 0.1 },
      { key: "height", label: "Height", min: 0.1, max: 10, step: 0.1 },
    ],
    defaults: { width: 2, height: 2 },
    build: (THREE, p) => {
      const g = new THREE.PlaneGeometry(p.width, p.height);
      g.computeVertexNormals();
      return g;
    },
  },
};

// Full 18-shape grid order (6 rows x 3 columns). Shapes not yet
// implemented fall back to cube + console warning via buildGeometry().
export const SHAPE_GRID = [
  "cube",     "prism",    "pyramid",
  "sphere",   "capsule",  "crystal",
  "cylinder", "tube",     "cone",
  "torus",    "ring",     "gear",
  "plane",    "terrain",  "blob",
  "rock",     "teapot",   "bunny",
];

export function getShape(id) {
  return SHAPES[id] || SHAPES.cube;
}

export function getShapeDefaults(id) {
  const s = SHAPES[id];
  return s ? { ...s.defaults } : { width: 1, height: 1, depth: 1 };
}

export function buildGeometry(THREE, id, params) {
  const s = SHAPES[id];
  if (!s) {
    console.warn(`[P3D] unknown shape type "${id}", falling back to cube`);
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.computeVertexNormals();
    return g;
  }
  return s.build(THREE, params);
}
