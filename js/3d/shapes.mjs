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
