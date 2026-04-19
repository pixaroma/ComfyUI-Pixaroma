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

import { THREE_VENDOR } from "./core.mjs";

// ─── Lazy-loaded Teapot geometry ──────────────────────────────
// TeapotGeometry lives in three/examples and weighs ~20KB. We fetch
// it only when the user clicks Teapot (or reopens a scene that
// already contains a teapot) so first-editor-open stays fast.
let _TeapotGeometry = null;
export async function loadTeapotGeometry() {
  if (_TeapotGeometry) return _TeapotGeometry;
  const mod = await import(
    THREE_VENDOR + "/examples/jsm/geometries/TeapotGeometry.mjs"
  );
  _TeapotGeometry = mod.TeapotGeometry;
  return _TeapotGeometry;
}

// ─── Build a closed thick-walled vessel profile ──────────────
// Takes an outer silhouette (bottom-corner → rim, excluding the
// center-bottom point at x=0) and returns a closed LatheGeometry
// profile with an inner wall offset inward by `wall`, a flat rim
// connecting outer to inner, and a flat interior floor at height
// `baseT`. The revolve becomes a solid thick-walled vessel with a
// proper visible inner surface — no more "backface-of-outer-wall
// as interior" that shades wrong under lighting / shadows.
function thickVesselProfile(outerSilhouette, wall, baseT) {
  const inward = (x) => Math.max(0.02, x - wall);
  const rim = outerSilhouette[outerSilhouette.length - 1];
  const innerReversed = outerSilhouette
    .slice()
    .reverse()
    .slice(1) // drop the rim; rim-inner is added explicitly
    .map(([x, y]) => [inward(x), Math.max(baseT, y)]);
  return [
    [0, 0],                    // center of outer base
    ...outerSilhouette,        // outer wall, bottom → rim
    [inward(rim[0]), rim[1]],  // rim inner (flat rim top)
    ...innerReversed,          // inner wall, rim → base
    [0, baseT],                // center of interior floor
  ];
}

// ─── Generic: weld seam normals on ANY parametric geometry ────
// Sphere, Cylinder, Cone, Capsule, Torus, Ring, Tube, Extrude etc.
// all duplicate vertices at angular seam boundaries (so UVs can wrap
// cleanly). computeVertexNormals then gives each duplicate a slightly
// different normal → visible lighting crease.
//
// Naive welding would merge the angular seam AND the cylinder top
// edge (where a side-wall vertex and a top-cap vertex are at the
// same position but have legitimately-different normals — one
// outward, one up). That would round off every hard edge.
//
// The fix: cluster co-located vertices by NORMAL DIRECTION, not just
// by position. Vertices only merge into the same cluster if their
// normals point in similar directions (dot product >= threshold).
// Hard edges like the cylinder top stay sharp because their normals
// are ~90° apart; smooth seams like the cylinder side wrap merge
// because their normals are nearly identical.
function weldSeamByPosition(geo, tolerance = 1e-4, normalThreshold = 0.5) {
  const positions = geo.attributes.position;
  const normals = geo.attributes.normal;
  if (!positions || !normals) return;
  const count = positions.count;
  const posArr = positions.array;
  const normArr = normals.array;
  const bucket = new Map();
  const invTol = 1 / tolerance;
  for (let i = 0; i < count; i++) {
    const x = posArr[i * 3];
    const y = posArr[i * 3 + 1];
    const z = posArr[i * 3 + 2];
    const k = `${Math.round(x * invTol)}|${Math.round(y * invTol)}|${Math.round(z * invTol)}`;
    let list = bucket.get(k);
    if (!list) { list = []; bucket.set(k, list); }
    list.push(i);
  }
  for (const list of bucket.values()) {
    if (list.length < 2) continue;
    // Detect triangle-fan singularities ONLY when the shared position
    // sits on the Y axis (x≈0 AND z≈0). On-axis + many co-located
    // vertices = a cone tip / sphere pole / pyramid apex — average
    // all their normals so the apex reads smooth.
    //
    // Off-axis clusters of 4+ vertices show up at cap / seam corners
    // (e.g. cylinder top-edge at the angular-wrap boundary has 2
    // side vertices + 2 cap vertices at identical positions) and
    // must NOT be treated as a fan — that averaged the hard top
    // edge into a rounded slope. Fall through to threshold clustering
    // instead, which merges same-direction normals and leaves
    // orthogonal ones (side vs cap) alone.
    const firstI = list[0];
    const x0 = posArr[firstI * 3];
    const z0 = posArr[firstI * 3 + 2];
    const onAxis = Math.abs(x0) < 0.01 && Math.abs(z0) < 0.01;
    if (onAxis && list.length >= 3) {
      let nx = 0, ny = 0, nz = 0;
      for (const i of list) {
        nx += normArr[i * 3];
        ny += normArr[i * 3 + 1];
        nz += normArr[i * 3 + 2];
      }
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      for (const i of list) {
        normArr[i * 3]     = nx;
        normArr[i * 3 + 1] = ny;
        normArr[i * 3 + 2] = nz;
      }
      continue;
    }
    // A position shared by 2–3 vertices is likely a seam pair (angular
    // wrap on a cylinder/sphere/etc.) OR a hard edge (cylinder top /
    // cube corner). Use normal-direction threshold to tell the two
    // apart: similar-direction normals merge (fixes seam), very
    // different normals stay apart (preserves hard edge).
    const clusters = [];
    for (const i of list) {
      const nx = normArr[i * 3];
      const ny = normArr[i * 3 + 1];
      const nz = normArr[i * 3 + 2];
      let placed = false;
      for (const c of clusters) {
        const cLen = Math.hypot(c.nx, c.ny, c.nz) || 1;
        const dot = (c.nx * nx + c.ny * ny + c.nz * nz) / cLen;
        if (dot >= normalThreshold) {
          c.indices.push(i);
          c.nx += nx; c.ny += ny; c.nz += nz;
          placed = true;
          break;
        }
      }
      if (!placed) {
        clusters.push({ indices: [i], nx, ny, nz });
      }
    }
    for (const c of clusters) {
      if (c.indices.length < 2) continue;
      const len = Math.hypot(c.nx, c.ny, c.nz) || 1;
      const ux = c.nx / len, uy = c.ny / len, uz = c.nz / len;
      for (const i of c.indices) {
        normArr[i * 3]     = ux;
        normArr[i * 3 + 1] = uy;
        normArr[i * 3 + 2] = uz;
      }
    }
  }
  normals.needsUpdate = true;
}

// ─── Weld LatheGeometry seam normals ─────────────────────────
// LatheGeometry duplicates the first/last column of vertices so UVs
// can wrap from u=0 to u=1 without stretching the last face back to
// zero. computeVertexNormals() then produces slightly different
// normals on each side of that seam (the two columns each see only
// the faces on their own side), which lights as a visible crease
// running from pole to pole. Fix: after computing normals, average
// the matching seam pair (column 0 ↔ column segments) and write the
// result back to both — the seam becomes invisible without touching
// positions or UVs.
function weldLatheSeam(geo, profileLen, segments) {
  const normals = geo.attributes.normal;
  if (!normals) return;
  const arr = normals.array;
  for (let p = 0; p < profileLen; p++) {
    const i0 = (0 * profileLen + p) * 3;
    const iM = (segments * profileLen + p) * 3;
    const nx = (arr[i0    ] + arr[iM    ]) * 0.5;
    const ny = (arr[i0 + 1] + arr[iM + 1]) * 0.5;
    const nz = (arr[i0 + 2] + arr[iM + 2]) * 0.5;
    const len = Math.hypot(nx, ny, nz) || 1;
    const ux = nx / len, uy = ny / len, uz = nz / len;
    arr[i0    ] = arr[iM    ] = ux;
    arr[i0 + 1] = arr[iM + 1] = uy;
    arr[i0 + 2] = arr[iM + 2] = uz;
  }
  normals.needsUpdate = true;
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
      weldSeamByPosition(g);
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
      weldSeamByPosition(g);
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
      // toNonIndexed() splits shared vertices into per-triangle copies
      // so computeVertexNormals gives each face its own normal instead
      // of smoothly blending across adjacent ones. Result: crisp
      // crystalline facets instead of a smooth bipyramid — the look a
      // crystal / gem shape actually needs.
      const g = new THREE.LatheGeometry(pts, p.sides).toNonIndexed();
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
      weldSeamByPosition(g);
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
      weldSeamByPosition(g);
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
      weldSeamByPosition(g);
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
      // Torus has two angular wraps (radial + tube) — weld both seams
      // after normals are computed so the lighting looks continuous.
      g.computeVertexNormals();
      weldSeamByPosition(g);
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
      weldSeamByPosition(g);
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
    live: false, // subdivided PlaneGeometry — debounce sliders to avoid lag
    // Rich terrain controls — combine these to create fields, rolling hills,
    // sharp mountains, plateaus, canyons, islands, etc. All sliders are
    // optional — missing params (from older saves) fall back to sensible
    // defaults inside the build so existing scenes keep working.
    params: [
      { key: "size",        label: "Size",        min: 1,    max: 20,   step: 0.5 },
      { key: "detail",      label: "Detail",      min: 16,   max: 180,  step: 2 },
      { key: "heightScale", label: "Height",      min: 0.02, max: 6,    step: 0.02 },
      { key: "scale",       label: "Scale",       min: 0.1,  max: 4,    step: 0.05 },
      { key: "octaves",     label: "Octaves",     min: 1,    max: 6,    step: 1 },
      { key: "persistence", label: "Persistence", min: 0.2,  max: 0.8,  step: 0.02 },
      { key: "lacunarity",  label: "Lacunarity",  min: 1.5,  max: 3,    step: 0.05 },
      { key: "ridge",       label: "Ridge",       min: 0,    max: 1,    step: 0.05 },
      { key: "power",       label: "Power",       min: 0.5,  max: 3,    step: 0.05 },
      { key: "flatness",    label: "Flatness",    min: 0,    max: 1,    step: 0.02 },
      { key: "edgeFalloff", label: "Edge Fall",   min: 0,    max: 1,    step: 0.05 },
      { key: "warp",        label: "Warp",        min: 0,    max: 0.8,  step: 0.02 },
      { key: "seed",        label: "Seed",        min: 1,    max: 9999, step: 1 },
    ],
    defaults: {
      size: 4.5, detail: 116, heightScale: 0.32, scale: 0.9,
      octaves: 3, persistence: 0.48, lacunarity: 1.7,
      ridge: 0.65, power: 1, flatness: 0.72, edgeFalloff: 0.65, warp: 0.06, seed: 3,
    },
    build: (THREE, p) => {
      // Full fBm pipeline with ridge blend, power curve, flatness, edge
      // falloff and domain warping. Same Seed reproduces the same terrain
      // so save/load round-trips deterministically.
      const noise = makeNoise(p.seed);
      const size = Math.max(1, p.size ?? 4);
      const detail = Math.max(2, Math.min(200, Math.round(p.detail ?? 80)));
      const heightScale = p.heightScale ?? 0.3;
      const scale = Math.max(0.01, p.scale ?? 1);
      const octs = Math.max(1, Math.min(6, Math.round(p.octaves ?? 3)));
      const pers = Math.min(0.95, Math.max(0.05, p.persistence ?? 0.5));
      const lac = Math.max(1.1, p.lacunarity ?? 2);
      const ridge = Math.max(0, Math.min(1, p.ridge ?? 0));
      const power = Math.max(0.1, p.power ?? 1);
      const flatness = Math.max(0, Math.min(1, p.flatness ?? 0));
      const edgeFall = Math.max(0, Math.min(1, p.edgeFalloff ?? 0));
      const warp = Math.max(0, Math.min(1, p.warp ?? 0));
      const half = size * 0.5;

      // Normalize fBm so the sum of octave amplitudes collapses to ~[-1,1]
      let ampSum = 0, aa = 1;
      for (let k = 0; k < octs; k++) { ampSum += aa; aa *= pers; }
      ampSum = ampSum || 1;

      const g = new THREE.PlaneGeometry(size, size, detail, detail);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);

        // Domain warp — offset sampling coords with another noise lookup
        // so the terrain gets curvy, natural-looking ridges instead of
        // grid-aligned streaks.
        let wx = x, wy = y;
        if (warp > 0) {
          const wn1 = noise(x * scale * 0.5 + 13.37, y * scale * 0.5 + 7.11, 0);
          const wn2 = noise(x * scale * 0.5 - 7.11, y * scale * 0.5 - 13.37, 0);
          wx = x + wn1 * warp;
          wy = y + wn2 * warp;
        }

        // fBm with optional ridge blend. Ridge = 0 → classic rolling noise,
        // Ridge = 1 → |n|-inverted ridges for sharp mountain crests.
        let n = 0, amp = 1, freq = scale;
        for (let k = 0; k < octs; k++) {
          let s = noise(wx * freq, wy * freq, 0);
          if (ridge > 0) {
            const r = 1 - Math.abs(s);
            const rs = r * 2 - 1;
            s = s * (1 - ridge) + rs * ridge;
          }
          n += s * amp;
          amp *= pers;
          freq *= lac;
        }
        n /= ampSum;

        // Power curve — <1 flattens, >1 steepens extremes.
        if (power !== 1) {
          const sign = n < 0 ? -1 : 1;
          n = sign * Math.pow(Math.abs(n), power);
        }

        // Flatness — squash |n| below a threshold toward zero so fields
        // and plateaus get large flat runs while peaks stay tall.
        if (flatness > 0) {
          const thresh = flatness * 0.6;
          const na = Math.abs(n);
          if (na < thresh) n *= (na / thresh);
        }

        // Edge falloff — smoothstep push the square boundary down to 0
        // for island / plateau silhouettes.
        if (edgeFall > 0) {
          const dx = Math.abs(x) / half;
          const dy = Math.abs(y) / half;
          const d = Math.max(dx, dy);
          const t = Math.max(0, Math.min(1, (d - (1 - edgeFall)) / edgeFall));
          const fall = 1 - t * t * (3 - 2 * t);
          n *= fall;
        }

        pos.setZ(i, n * heightScale);
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
    defaults: { radius: 0.6, detail: 4, strength: 0.3, smoothness: 1.5, octaves: 2, stretchY: 1.0, seed: 7 },
    build: (THREE, p) => {
      // Icosahedron sphere with each vertex pushed in/out along its
      // radial direction by N octaves of simplex noise — produces an
      // organic lumpy shape. IcosahedronGeometry is NON-indexed (each
      // triangle owns its own 3 vertices), so computeVertexNormals by
      // itself gives flat per-face shading. For a smooth "blob" look we
      // weld the per-triangle-duplicate positions back together by
      // averaging their face normals (weldSeamByPosition handles this
      // generically — co-located vertices with similar normals cluster
      // and average, producing smooth Gouraud shading across the whole
      // surface without needing mergeVertices).
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
      weldSeamByPosition(g, 1e-4, -0.5); // aggressive merge for smooth surface
      return g;
    },
  },
  rock: {
    icon: "rock.svg",
    label: "Rock",
    category: "complex",
    live: false,
    params: [
      { key: "size",       label: "Size",       min: 0.2, max: 2,    step: 0.05 },
      { key: "detail",     label: "Detail",     min: 1,   max: 5,    step: 1 },
      { key: "roughness",  label: "Roughness",  min: 0.1, max: 0.7,  step: 0.02 },
      { key: "sharpness",  label: "Sharpness",  min: 0.5, max: 3,    step: 0.1 },
      { key: "stretchY",   label: "Stretch Y",  min: 0.3, max: 2.5,  step: 0.05 },
      { key: "smoothness", label: "Smoothness", min: 0,   max: 1,    step: 0.05 },
      { key: "seed",       label: "Seed",       min: 1,   max: 9999, step: 1 },
    ],
    defaults: {
      size: 0.6, detail: 3, roughness: 0.22, sharpness: 1.0,
      stretchY: 0.7, smoothness: 0.8, seed: 22,
    },
    build: (THREE, p) => {
      // Low-poly rock: icosahedron with modest single-octave noise
      // displacement.
      //
      // Smoothness controls facet softness:
      //   0   → pure flat shading (every triangle its own normal —
      //         classic low-poly rock look)
      //   1   → fully smooth shading (normals averaged across the
      //         surface — boulder / pebble look)
      //   mid → facets soften progressively. Internally this blends
      //         each per-triangle face normal with the position-
      //         averaged smooth normal at that vertex.
      //
      // Higher Detail + higher Smoothness = rounder rocks with more
      // silhouette variation. Keep Detail low + Smoothness=0 for the
      // classic low-poly chunky rock.
      const noise = makeNoise(p.seed);
      const g = new THREE.IcosahedronGeometry(p.size, p.detail);
      const pos = g.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        const len = v.length();
        // Single low-frequency octave for gentle silhouette variation.
        const n = noise(v.x * 1.3, v.y * 1.3, v.z * 1.3);
        // Sharpness < 1 biases toward 0 (rounder, pebble-like).
        // Sharpness > 1 biases toward ±1 (more dramatic bulges).
        const biased = Math.sign(n) * Math.pow(Math.abs(n), 1 / p.sharpness);
        const newLen = len * (1 + biased * p.roughness);
        // Floor at 60% of the original radius so the rock can never
        // collapse into a thin sliver on the unlucky seed.
        v.setLength(Math.max(newLen, len * 0.6));
        pos.setXYZ(i, v.x, v.y * p.stretchY, v.z);
      }
      // Face normals (flat shading) — the baseline.
      g.computeVertexNormals();

      const smooth = Math.max(0, Math.min(1, p.smoothness ?? 0));
      if (smooth > 0) {
        // Compute per-position averaged normals, then blend toward
        // them by `smooth`. Position-averaged normals collapse every
        // co-located triangle corner onto the same (area-weighted)
        // smooth normal, which is what you'd get from an indexed
        // mergeVertices pass — but without losing the non-indexed
        // layout so we can still interpolate back to the flat look.
        const normals = g.attributes.normal;
        const posArr = pos.array;
        const normArr = normals.array;
        const count = pos.count;
        const tolerance = 1e-4;
        const invTol = 1 / tolerance;
        const bucket = new Map();
        for (let i = 0; i < count; i++) {
          const x = posArr[i * 3];
          const y = posArr[i * 3 + 1];
          const z = posArr[i * 3 + 2];
          const k = `${Math.round(x * invTol)}|${Math.round(y * invTol)}|${Math.round(z * invTol)}`;
          let list = bucket.get(k);
          if (!list) { list = []; bucket.set(k, list); }
          list.push(i);
        }
        for (const list of bucket.values()) {
          if (list.length < 2) continue;
          let nx = 0, ny = 0, nz = 0;
          for (const i of list) {
            nx += normArr[i * 3];
            ny += normArr[i * 3 + 1];
            nz += normArr[i * 3 + 2];
          }
          const m = Math.hypot(nx, ny, nz) || 1;
          nx /= m; ny /= m; nz /= m;
          for (const i of list) {
            const fx = normArr[i * 3];
            const fy = normArr[i * 3 + 1];
            const fz = normArr[i * 3 + 2];
            // Lerp flat→smooth by smooth; renormalize so lighting stays correct.
            let bx = fx * (1 - smooth) + nx * smooth;
            let by = fy * (1 - smooth) + ny * smooth;
            let bz = fz * (1 - smooth) + nz * smooth;
            const bm = Math.hypot(bx, by, bz) || 1;
            normArr[i * 3]     = bx / bm;
            normArr[i * 3 + 1] = by / bm;
            normArr[i * 3 + 2] = bz / bm;
          }
        }
        normals.needsUpdate = true;
      }
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
      // Rotate 180° on Y so the spout points the same way as the
      // shape-grid icon (handle on the right, spout on the left).
      g.rotateY(Math.PI);
      g.computeVertexNormals();
      weldSeamByPosition(g);
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
  // ─── Dome — half-sphere ──────────────────────────────────
  dome: {
    icon: "dome.svg",
    label: "Dome",
    category: "rounded",
    live: true,
    params: [
      { key: "radius",     label: "Radius",   min: 0.1, max: 3,   step: 0.05 },
      { key: "widthSegs",  label: "Segments", min: 6,   max: 64,  step: 1 },
      { key: "heightSegs", label: "Rings",    min: 3,   max: 32,  step: 1 },
    ],
    defaults: { radius: 0.8, widthSegs: 24, heightSegs: 12 },
    build: (THREE, p) => {
      // Top half of a sphere: phiLength full circle, thetaLength π/2.
      // Default orientation puts the hemisphere pointing up.
      const g = new THREE.SphereGeometry(
        p.radius, p.widthSegs, p.heightSegs,
        0, Math.PI * 2,
        0, Math.PI / 2,
      );
      g.computeVertexNormals();
      weldSeamByPosition(g);
      return g;
    },
  },
  // ─── Vessels built from a LatheGeometry profile ──────────
  // Each profile is a 2D silhouette (right half only) — LatheGeometry
  // revolves it around the Y axis. The profile points go bottom-to-top.
  // Keep the first point at x>0 so the bottom has a cap (closed base).
  vase: {
    icon: "vase.svg",
    label: "Vase",
    category: "lathe",
    live: true,
    params: [
      { key: "height",  label: "Height",  min: 0.3, max: 3,  step: 0.05 },
      { key: "radius",  label: "Width",   min: 0.1, max: 1.5, step: 0.05 },
      { key: "wall",    label: "Thickness", min: 0.01, max: 0.15, step: 0.005 },
      { key: "segments", label: "Smoothness", min: 8, max: 64, step: 1 },
    ],
    defaults: { height: 1.0, radius: 0.35, wall: 0.05, segments: 32 },
    build: (THREE, p) => {
      // Outer silhouette bottom→rim. thickVesselProfile closes it
      // into a proper thick-walled vessel (visible inner wall, flat
      // rim, interior floor) so shadows land on real surfaces and
      // not on the back of the outer wall.
      const h = p.height;
      const R = p.radius;
      const w = Math.max(0.005, Math.min(0.18, p.wall ?? 0.05));
      const outer = [
        [0.60 * R, 0.00],
        [0.70 * R, 0.08 * h],
        [0.98 * R, 0.25 * h],
        [1.00 * R, 0.40 * h],
        [0.85 * R, 0.55 * h],
        [0.55 * R, 0.72 * h],
        [0.45 * R, 0.85 * h],
        [0.55 * R, 0.95 * h],
        [0.65 * R, 1.00 * h],
      ];
      const profile = thickVesselProfile(outer, w, Math.max(0.02, w * 0.9));
      const points = profile.map(([x, y]) => new THREE.Vector2(x, y));
      const g = new THREE.LatheGeometry(points, p.segments);
      g.computeVertexNormals();
      weldLatheSeam(g, points.length, p.segments);
      return g;
    },
  },
  bottle: {
    icon: "bottle.svg",
    label: "Bottle",
    category: "lathe",
    live: true,
    params: [
      { key: "height",  label: "Height",  min: 0.3, max: 3,  step: 0.05 },
      { key: "radius",  label: "Width",   min: 0.1, max: 1.2, step: 0.05 },
      { key: "wall",    label: "Thickness", min: 0.01, max: 0.12, step: 0.005 },
      { key: "segments", label: "Smoothness", min: 8, max: 64, step: 1 },
    ],
    defaults: { height: 1.2, radius: 0.3, wall: 0.04, segments: 32 },
    build: (THREE, p) => {
      // Bottle: squat body with a long narrow neck. Thick-walled so
      // the neck opening reads as a real hole with an interior. Wall
      // is clamped so a thick slider can't collapse the narrow neck.
      const h = p.height;
      const R = p.radius;
      // Neck inner radius is 0.28R - wall; stop wall before that goes
      // sub-2% of R so the neck stays a real hole.
      const w = Math.max(0.005, Math.min(0.26 * R - 0.02, p.wall ?? 0.04));
      const outer = [
        [0.95 * R, 0.00],
        [1.00 * R, 0.08 * h],
        [1.00 * R, 0.50 * h],
        [0.90 * R, 0.58 * h],
        [0.40 * R, 0.65 * h],
        [0.28 * R, 0.75 * h],
        [0.28 * R, 0.95 * h],
        [0.35 * R, 1.00 * h],
      ];
      const profile = thickVesselProfile(outer, w, Math.max(0.02, w * 1.1));
      const points = profile.map(([x, y]) => new THREE.Vector2(x, y));
      const g = new THREE.LatheGeometry(points, p.segments);
      g.computeVertexNormals();
      weldLatheSeam(g, points.length, p.segments);
      return g;
    },
  },
  goblet: {
    icon: "goblet.svg",
    label: "Goblet",
    category: "lathe",
    live: true,
    params: [
      { key: "height",  label: "Height",  min: 0.3, max: 2.5, step: 0.05 },
      { key: "radius",  label: "Width",   min: 0.15, max: 1.2, step: 0.05 },
      { key: "wall",    label: "Thickness", min: 0.01, max: 0.12, step: 0.005 },
      { key: "segments", label: "Smoothness", min: 8, max: 64, step: 1 },
    ],
    defaults: { height: 1.0, radius: 0.35, wall: 0.04, segments: 32 },
    build: (THREE, p) => {
      // Goblet: SOLID disc foot + SOLID stem + HOLLOW cup. Closed
      // profile — starts at (0,0), traces foot→stem→cup-outer→rim,
      // comes back down the cup-inner, closes at (0, cupFloorY). The
      // stem stays solid because the inner cup floor sits just above
      // the stem top. Wall slider controls only the cup wall.
      const h = p.height;
      const R = p.radius;
      const w = Math.max(0.005, Math.min(0.15, p.wall ?? 0.04));
      // Inner cup radii (outer radii minus wall, clamped positive).
      const innerRim   = Math.max(0.02, 1.00 * R - w);
      const innerUpper = Math.max(0.02, 0.95 * R - w);
      const innerBelly = Math.max(0.02, 0.78 * R - w);
      const innerBase  = Math.max(0.04, 0.26 * R - w * 0.5);
      const cupFloorY  = 0.55 * h + Math.max(0.02, w * 1.5);
      const profile = [
        [0.00,       0.00],         // center of foot bottom
        [1.00 * R,   0.00],         // foot edge bottom
        [1.00 * R,   0.04 * h],     // foot edge top
        [0.25 * R,   0.09 * h],     // curve into stem
        [0.18 * R,   0.18 * h],     // stem bottom
        [0.18 * R,   0.50 * h],     // stem top
        [0.26 * R,   0.55 * h],     // widen into cup outer base
        [0.78 * R,   0.72 * h],     // cup outer belly
        [0.95 * R,   0.90 * h],     // cup outer upper
        [1.00 * R,   1.00 * h],     // outer rim
        [innerRim,   1.00 * h],     // inner rim (flat rim top)
        [innerUpper, 0.90 * h],     // inner cup upper
        [innerBelly, 0.72 * h],     // inner cup belly
        [innerBase,  0.58 * h],     // inner cup base edge
        [0.00,       cupFloorY],    // center of interior floor
      ];
      const points = profile.map(([x, y]) => new THREE.Vector2(x, y));
      const g = new THREE.LatheGeometry(points, p.segments);
      g.computeVertexNormals();
      weldLatheSeam(g, points.length, p.segments);
      return g;
    },
  },
  bowl: {
    icon: "bowl.svg",
    label: "Bowl",
    category: "lathe",
    live: true,
    params: [
      { key: "radius",  label: "Radius",  min: 0.2, max: 2.5, step: 0.05 },
      { key: "height",  label: "Depth",   min: 0.1, max: 1.5, step: 0.05 },
      { key: "wall",    label: "Thickness", min: 0.01, max: 0.2, step: 0.005 },
      { key: "segments", label: "Smoothness", min: 8, max: 64, step: 1 },
    ],
    defaults: { radius: 0.7, height: 0.35, wall: 0.05, segments: 32 },
    build: (THREE, p) => {
      // Bowl: half-dome silhouette fed through thickVesselProfile so
      // it gets a proper inner surface, flat rim, and interior floor.
      // Shadows now land on real geometry instead of the back of the
      // outer wall.
      const R = p.radius;
      const h = p.height;
      const w = Math.max(0.005, Math.min(0.22, p.wall ?? 0.05));
      const outer = [
        [0.15 * R, 0.00],
        [0.45 * R, 0.08 * h],
        [0.80 * R, 0.38 * h],
        [0.96 * R, 0.75 * h],
        [1.00 * R, 1.00 * h],
      ];
      const profile = thickVesselProfile(outer, w, Math.max(0.02, w * 0.8));
      const points = profile.map(([x, y]) => new THREE.Vector2(x, y));
      const g = new THREE.LatheGeometry(points, p.segments);
      g.computeVertexNormals();
      weldLatheSeam(g, points.length, p.segments);
      return g;
    },
  },
  plantpot: {
    icon: "plant-pot.svg",
    label: "Plant Pot",
    category: "lathe",
    live: true,
    params: [
      { key: "height",  label: "Height",  min: 0.2, max: 2.5, step: 0.05 },
      { key: "radius",  label: "Top R",   min: 0.2, max: 1.5, step: 0.05 },
      { key: "baseRatio", label: "Base %", min: 0.4, max: 1, step: 0.02 },
      { key: "wall",    label: "Thickness", min: 0.01, max: 0.15, step: 0.005 },
      { key: "segments", label: "Smoothness", min: 8, max: 64, step: 1 },
    ],
    defaults: { height: 0.7, radius: 0.55, baseRatio: 0.7, wall: 0.05, segments: 32 },
    build: (THREE, p) => {
      // Classic tapered flower pot with a rim lip at the top.
      // Thick-walled so you can actually plant something in it.
      const h = p.height;
      const R = p.radius;
      const w = Math.max(0.005, Math.min(0.18, p.wall ?? 0.05));
      const bR = R * p.baseRatio;
      const outer = [
        [bR,        0.00],
        [bR * 1.02, 0.02 * h],
        [R * 0.95,  0.85 * h],
        [R * 1.00,  0.88 * h],
        [R * 1.02,  0.95 * h],
        [R * 0.96,  1.00 * h],
      ];
      const profile = thickVesselProfile(outer, w, Math.max(0.02, w));
      const points = profile.map(([x, y]) => new THREE.Vector2(x, y));
      const g = new THREE.LatheGeometry(points, p.segments);
      g.computeVertexNormals();
      weldLatheSeam(g, points.length, p.segments);
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
