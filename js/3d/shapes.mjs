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
      // Build a CylinderGeometry with n sides, then reorient to the
      // classic "house roof" pose:
      //   - extrusion axis along Z (front-back), so the triangular gable
      //     faces the default camera
      //   - triangle peak at +Y (up), flat rectangular face on the floor
      // We also translate the geometry so its flat bottom sits at local
      // y = 0 — this way the bottom stays planted on the ground plane
      // regardless of radius, and the "roof ridge" lifts as radius grows.
      const g = new THREE.CylinderGeometry(
        p.radius, p.radius, p.length, p.sides);
      g.rotateX(Math.PI / 2); // cylinder axis Y → Z (extrude front-back)
      g.rotateZ(Math.PI / 2); // first vertex (+X) → +Y (peak up)
      g.translate(0, p.radius / 2, 0); // flat bottom at y=0
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
