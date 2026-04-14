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
    build: (THREE, p) => {
      // Hollow pipe: draw a filled outer disc with an inner circular hole
      // as a Shape, then extrude along the shape's normal (Z by default)
      // and rotate so the extrusion axis ends up on Y. Clamp inner < outer
      // so the slider combos can't invert (which would make an empty or
      // self-intersecting geometry).
      const outerR = Math.max(p.outerRadius, p.innerRadius + 0.01);
      const innerR = Math.min(p.innerRadius, p.outerRadius - 0.01);
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
      const g = new THREE.ConeGeometry(p.radius, p.height, p.sides);
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
    build: (THREE, p) => {
      const g = new THREE.TorusGeometry(p.radius, p.tube, p.radialSegs, p.tubeSegs);
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
