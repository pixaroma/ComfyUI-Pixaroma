// ============================================================
// Pixaroma 3D Editor — Composite shape registry
//
// Composite shapes are multi-mesh Groups with baked per-part colors
// (trunk brown + leaves green, wall + roof, frame + cushions, etc).
// Each entry is fully parameterised — the shape panel renders its
// params as sliders and the editor regenerates the Group whenever
// one changes (same UX as primitives).
//
// Registry shape:
//   id → { icon, label, params, defaults, build(THREE, p) }
//
// `build(THREE, p)` returns a fresh THREE.Group. `p` is a plain
// object with values for every key in `params`. `buildComposite(id)`
// uses defaults; the shape panel writes user values into
// userData.geoParams and re-invokes build() on change.
// ============================================================

import { getTHREE } from "./core.mjs";

// Shared palette — muted, warm, reads well on the editor's dark bg.
const C = {
  trunk:    0x8b5a2b,
  wood:     0xa87046,
  leaves:   0x4d8a3a,
  leavesAlt:0x5aa84a,
  pine:     0x2f6b2a,
  mushCap:  0xb74042,
  mushStem: 0xeee3c6,
  petal:    0xf27085,
  center:   0xc69a39,
  wall:     0xd4b38a,
  roof:     0xa14a35,
  metalDk:  0x3a3f44,
  glow:     0xffeaa5,
  paint:    0xe8e3d8,
  cloud:    0xf4f4f6,
  cactus:   0x4e8b4a,
  stone:    0xd4cab3,
};

// ─── small helpers ──────────────────────────────────────────
function makeMat(THREE, hex, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: hex,
    roughness: opts.roughness ?? 0.7,
    metalness: opts.metalness ?? 0,
    transparent: true,
    opacity: 1,
  });
}
function makeMesh(THREE, geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Seeded pseudo-random: same seed = same randomized shape every time,
// so save/restore and undo/redo reproduce the exact same result.
function prng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ─── Tree — broadleaf (tapered trunk + shaped canopy) ───────
function buildTree(THREE, p) {
  const g = new THREE.Group();
  const trunkH = p.trunkH;
  const trunkR = p.trunkR;
  // Top of trunk is narrower than base — natural taper. trunkTaper
  // of 1.0 = no taper (straight cylinder), 0.5 = top half as wide.
  const trunkRTop = trunkR * p.trunkTaper;
  const canopyR = p.canopy;
  const stretchY = p.canopyStretchY;
  const canopyOffset = p.canopyOffset;

  const trunk = makeMesh(
    THREE,
    new THREE.CylinderGeometry(trunkRTop, trunkR, trunkH, 14),
    makeMat(THREE, C.trunk, { roughness: 0.95 }),
  );
  trunk.position.y = trunkH / 2;
  g.add(trunk);

  const canopyMat = makeMat(THREE, C.leaves, { roughness: 0.85 });
  // Main canopy — scaled sphere so user can squash (wide flat crown)
  // or elongate (tall cypress-like shape).
  const mainY = trunkH + canopyR * stretchY * 0.8 + canopyOffset;
  const main = makeMesh(
    THREE,
    new THREE.SphereGeometry(canopyR, 20, 14),
    canopyMat,
  );
  main.scale.y = stretchY;
  main.position.y = mainY;
  g.add(main);

  // Bumps arranged around the canopy. bumpSize scales their radius
  // relative to the main canopy; bumpSpread pushes them farther out
  // radially so you can get a sparse tuft-on-top look or a dense
  // cluster. Seeded for reproducibility.
  const rnd = prng(p.seed);
  const bumpCount = Math.round(p.bumps);
  const bumpSize = p.bumpSize;
  const bumpSpread = p.bumpSpread;
  for (let i = 0; i < bumpCount; i++) {
    // Evenly space azimuth + seeded jitter so bumps don't clump
    const baseA = (i / bumpCount) * Math.PI * 2;
    const a = baseA + (rnd() - 0.5) * 0.6;
    const r = canopyR * bumpSpread * (0.85 + rnd() * 0.3);
    const bR = canopyR * bumpSize * (0.8 + rnd() * 0.4);
    const bump = makeMesh(THREE, new THREE.SphereGeometry(bR, 14, 10), canopyMat);
    bump.scale.y = stretchY * 0.9;
    bump.position.set(
      Math.cos(a) * r,
      mainY + (rnd() - 0.3) * canopyR * 0.4,
      Math.sin(a) * r,
    );
    g.add(bump);
  }
  return g;
}

// ─── Pine tree — stacked cones on a short trunk ─────────────
function buildPineTree(THREE, p) {
  const g = new THREE.Group();
  const trunkH = p.trunkH;
  const trunkR = p.trunkR;
  const tiers = Math.round(p.tiers);
  const canopyH = p.canopyH;
  const baseR = p.baseR;
  // topR is a FRACTION of baseR — 0 = cones taper to a point at the
  // very top tier, 1 = every tier is the same width (columnar spruce).
  const topR = baseR * p.topR;
  const overlap = p.overlap;

  const trunk = makeMesh(
    THREE,
    new THREE.CylinderGeometry(trunkR * 0.85, trunkR, trunkH, 12),
    makeMat(THREE, C.trunk, { roughness: 0.95 }),
  );
  trunk.position.y = trunkH / 2;
  g.add(trunk);

  const pineMat = makeMat(THREE, C.pine, { roughness: 0.85 });
  const tierH = canopyH / tiers;
  for (let i = 0; i < tiers; i++) {
    const t = tiers === 1 ? 0 : i / (tiers - 1);
    const r = baseR + (topR - baseR) * t;
    const h = tierH * 1.2; // each tier taller than slot → overlap
    const y = trunkH + i * tierH * (1 - overlap) + h / 2;
    const cone = makeMesh(THREE, new THREE.ConeGeometry(r, h, 16), pineMat);
    cone.position.y = y;
    g.add(cone);
  }
  return g;
}

// ─── Mushroom — stem + domed cap ────────────────────────────
function buildMushroom(THREE, p) {
  const g = new THREE.Group();
  const stemH = p.stemH;
  const stemR = p.stemR;
  const capR = p.capR;
  const stem = makeMesh(
    THREE,
    new THREE.CylinderGeometry(stemR * 0.75, stemR, stemH, 16),
    makeMat(THREE, C.mushStem, { roughness: 0.7 }),
  );
  stem.position.y = stemH / 2;
  g.add(stem);
  const cap = makeMesh(
    THREE,
    new THREE.SphereGeometry(capR, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    makeMat(THREE, C.mushCap, { roughness: 0.6 }),
  );
  cap.position.y = stemH;
  g.add(cap);
  // Underside disc so looking up into the cap doesn't see empty air
  const underside = makeMesh(
    THREE,
    new THREE.CircleGeometry(capR, 24),
    makeMat(THREE, C.mushStem, { roughness: 0.9 }),
  );
  underside.rotation.x = Math.PI / 2;
  underside.position.y = stemH;
  g.add(underside);
  return g;
}

// ─── Flower — tapered stem, cupped petals, calyx, radial leaves ─
function buildFlower(THREE, p) {
  const g = new THREE.Group();
  const stemH = p.stemH;
  const stemRBottom = 0.032;
  const stemRTop = 0.022;
  // Tapered stem — wider at base, thinner at the flower
  const stem = makeMesh(
    THREE,
    new THREE.CylinderGeometry(stemRTop, stemRBottom, stemH, 12),
    makeMat(THREE, C.leaves, { roughness: 0.9 }),
  );
  stem.position.y = stemH / 2;
  g.add(stem);
  // Calyx — a small green cup at the top of the stem where petals
  // attach. Hides the abrupt transition from stem to petals and reads
  // as the botanical base of the flower.
  const calyx = makeMesh(
    THREE,
    new THREE.SphereGeometry(0.07, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    makeMat(THREE, C.leaves, { roughness: 0.85 }),
  );
  calyx.scale.y = 0.7;
  calyx.position.y = stemH - 0.02;
  g.add(calyx);
  // Center — small dome-like pollen disc resting on top of the petals
  const centerR = 0.1;
  const centerMat = makeMat(THREE, C.center, { roughness: 0.55 });
  const center = makeMesh(
    THREE,
    new THREE.SphereGeometry(centerR, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    centerMat,
  );
  center.scale.y = 0.7;
  center.position.y = stemH + 0.025;
  g.add(center);
  // Petals — each has its own pivot group positioned at the CENTER
  // EDGE (not the stem origin). petalAngle tilts the pivot around
  // the local tangent axis: + = petal tips rise UP (cup / tulip),
  // 0 = flat (daisy), − = petals droop DOWN (wilted).
  const petalMat = makeMat(THREE, C.petal, { roughness: 0.55 });
  const petalCount = Math.max(3, Math.round(p.petals));
  const petalAngleRad = (p.petalAngle * Math.PI) / 180;
  const petalBaseR = centerR * 0.9;
  const petalLen = 0.2;
  for (let i = 0; i < petalCount; i++) {
    const angle = (i / petalCount) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.set(
      Math.cos(angle) * petalBaseR,
      stemH + 0.015,
      Math.sin(angle) * petalBaseR,
    );
    // Orient the pivot outward (rotate around Y), then tilt around
    // the local Z axis. Positive angle lifts the petal tip UP.
    pivot.rotation.y = -angle;
    pivot.rotation.z = petalAngleRad;
    g.add(pivot);
    const petal = makeMesh(
      THREE,
      new THREE.SphereGeometry(0.12, 16, 12),
      petalMat,
    );
    // Teardrop shape: wider than tall, extended outward
    petal.scale.set(1.4, 0.25, 1.0);
    petal.position.set(petalLen / 2, 0, 0);
    pivot.add(petal);
  }
  // Leaves — emerge from the lower half of the stem, rotate outward.
  // leafY is clamped to 0.1–0.6 of stem height so leaves NEVER reach
  // the flower head no matter how the user drags the slider. leafAngle
  // capped at 45° so even fully tilted up they stay well below petals.
  const leafMat = makeMat(THREE, C.leavesAlt, { roughness: 0.85 });
  const leafCount = Math.max(0, Math.round(p.leaves));
  const leafAngleRad = (p.leafAngle * Math.PI) / 180;
  const leafYFrac = Math.min(0.6, Math.max(0.1, p.leafY));
  const leafY = stemH * leafYFrac;
  // Tapered stem: approximate stem radius at the leaf attachment height
  const stemRAtLeaf =
    stemRBottom + (stemRTop - stemRBottom) * leafYFrac;
  // Leaf ellipsoid dimensions — semi-axes (radius × scale).
  // Inner edge of leaf must sit OUTSIDE the stem, not pass through it,
  // so leaf.position.x = stemRAtLeaf + semiLenX (center of ellipsoid
  // is one half-length out from the stem surface).
  const leafBaseR = 0.13;
  const leafScaleX = 1.35;
  const leafScaleY = 0.18;
  const leafScaleZ = 0.55;
  const leafSemiLen = leafBaseR * leafScaleX;
  for (let i = 0; i < leafCount; i++) {
    const angle = (i / leafCount) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.set(0, leafY, 0);
    pivot.rotation.y = angle;
    // 0 = horizontal outward, + = angled UP, − = drooping DOWN.
    // (Sign matches petalAngle convention: positive lifts up.)
    pivot.rotation.z = leafAngleRad;
    g.add(pivot);
    const leaf = makeMesh(
      THREE,
      new THREE.SphereGeometry(leafBaseR, 14, 10),
      leafMat,
    );
    leaf.scale.set(leafScaleX, leafScaleY, leafScaleZ);
    // Place so inner edge of ellipsoid sits flush with stem surface
    leaf.position.set(stemRAtLeaf + leafSemiLen, 0, 0);
    pivot.add(leaf);
  }
  return g;
}

// ─── Cactus — saguaro (flat-bottom trunk + capsule arms) ────
function buildCactus(THREE, p) {
  const g = new THREE.Group();
  const cactusMat = makeMat(THREE, C.cactus, { roughness: 0.85 });
  const trunkH = p.trunkH;
  const trunkR = 0.2;
  // Trunk: cylinder body with a rounded dome cap on top. Bottom is
  // flat (sitting on the ground) instead of a capsule's rounded half.
  const cylH = Math.max(0.01, trunkH - trunkR);
  const trunkCyl = makeMesh(
    THREE,
    new THREE.CylinderGeometry(trunkR, trunkR, cylH, 20),
    cactusMat,
  );
  trunkCyl.position.y = cylH / 2;
  g.add(trunkCyl);
  const trunkCap = makeMesh(
    THREE,
    new THREE.SphereGeometry(trunkR, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    cactusMat,
  );
  trunkCap.position.y = cylH;
  g.add(trunkCap);
  // Arms: explicit per-count layouts so 1, 2, 3 arms all look right
  // and don't overlap. armY is the vertical midpoint for the whole
  // arm cluster (0 = trunk bottom, 1 = trunk top). armH controls
  // horizontal reach from trunk; armV the vertical rise from elbow.
  //
  // Each layout entry is { side, offsetT } where offsetT is a signed
  // fraction (-1..+1) applied to a "spread" that gets clamped so all
  // arms + their vertical rises fit inside [0, trunkH].
  const ARM_LAYOUTS = {
    0: [],
    1: [{ side: -1, offsetT: 0 }],
    2: [
      { side: -1, offsetT: -0.4 },
      { side:  1, offsetT:  0.4 },
    ],
    3: [
      // Stagger left-right-left with one side getting two arms at
      // different heights. Middle arm on the opposite side.
      { side: -1, offsetT: -0.7 },
      { side:  1, offsetT:  0.0 },
      { side: -1, offsetT:  0.7 },
    ],
  };
  const armCount = Math.max(0, Math.min(3, Math.round(p.arms)));
  const armR = 0.09;
  const armH = p.armH;
  const armV = p.armV;
  const armYMid = trunkH * p.armY;
  // Clamp spread so the top-most arm's vertical rise still fits under
  // the trunk cap, and the bottom-most arm stays above the ground.
  const headroomUp = trunkH - armYMid - armV - armR * 2;
  const headroomDn = armYMid - armR * 2;
  const spread = Math.max(0, Math.min(0.35 * trunkH, headroomUp, headroomDn));
  const layout = ARM_LAYOUTS[armCount] || [];
  for (const entry of layout) {
    const armYPos = armYMid + entry.offsetT * spread;
    const side = entry.side;
    const h = makeMesh(
      THREE,
      new THREE.CapsuleGeometry(armR, armH, 6, 14),
      cactusMat,
    );
    h.rotation.z = Math.PI / 2;
    h.position.set(side * (trunkR + armH / 2), armYPos, 0);
    g.add(h);
    const v = makeMesh(
      THREE,
      new THREE.CapsuleGeometry(armR, armV, 6, 14),
      cactusMat,
    );
    v.position.set(side * (trunkR + armH), armYPos + armV / 2, 0);
    g.add(v);
  }
  return g;
}

// ─── House — walls + gable roof + door + windows + chimney ──
function buildHouse(THREE, p) {
  const g = new THREE.Group();
  const wallW = p.width, wallH = p.wallH, wallD = p.depth;
  const roofH = p.roofH;
  const overhang = p.overhang;

  const wallMat    = makeMat(THREE, C.wall,   { roughness: 0.85 });
  const roofMat    = makeMat(THREE, C.roof,   { roughness: 0.8  });
  const doorMat    = makeMat(THREE, C.trunk,  { roughness: 0.9  });
  const windowMat  = makeMat(THREE, 0x7aa8cc, { roughness: 0.3, metalness: 0.25 });
  const chimneyMat = makeMat(THREE, 0x8b4a3b, { roughness: 0.9  });

  // ─── Walls ─────────────────────────────────────────────────
  const body = makeMesh(
    THREE,
    new THREE.BoxGeometry(wallW, wallH, wallD),
    wallMat,
  );
  body.position.y = wallH / 2;
  g.add(body);

  // ─── Gable roof (triangular prism) ─────────────────────────
  // A gable fits rectangular footprints naturally — as depth
  // changes the ROOF LENGTH changes with it, no stretched pyramid.
  const roofShape = new THREE.Shape();
  const roofW2 = wallW / 2 + overhang;
  roofShape.moveTo(-roofW2, 0);
  roofShape.lineTo( roofW2, 0);
  roofShape.lineTo( 0,      roofH);
  roofShape.lineTo(-roofW2, 0);
  const roofDepth = wallD + overhang * 2;
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, {
    depth: roofDepth,
    bevelEnabled: false,
  });
  const roof = makeMesh(THREE, roofGeo, roofMat);
  roof.position.set(0, wallH, -wallD / 2 - overhang);
  g.add(roof);

  // ─── Front door ────────────────────────────────────────────
  const doorH = Math.min(wallH * 0.6, 0.7);
  const doorW = Math.min(0.3, wallW * 0.22);
  const door = makeMesh(
    THREE,
    new THREE.BoxGeometry(doorW, doorH, 0.03),
    doorMat,
  );
  door.position.set(0, doorH / 2, wallD / 2 + 0.015);
  g.add(door);

  // ─── Windows ───────────────────────────────────────────────
  // Independent controls: Front Windows (0–2), Side Windows
  // (checkbox — puts one on each side wall), Back Window
  // (checkbox). Window Shape picks geometry: 0 rectangle,
  // 1 arched-top, 2 round porthole. Window W / H / Y let you
  // dial size and vertical placement.
  const winW = p.winW;
  const winH = p.winH;
  const winT = 0.04;
  const shapeIdx = Math.max(0, Math.min(2, Math.round(p.winShape)));
  // Clamp vertical position so the window never pokes below the
  // floor or above the wall top regardless of slider value.
  const winYRaw = wallH * p.winY;
  const winYMin = winH / 2 + 0.05;
  const winYMax = wallH - winH / 2 - 0.05;
  const winY = Math.max(winYMin, Math.min(winYMax, winYRaw));

  // Build a window geometry in "frontBack" orientation — thin on
  // the Z axis, centered on origin. Side windows rotate this by
  // 90° around Y so the same geometry serves both orientations.
  function makeWindowGeo(orient) {
    let geo;
    if (shapeIdx === 0) {
      // Simple rectangle
      geo = new THREE.BoxGeometry(winW, winH, winT);
    } else if (shapeIdx === 1) {
      // Arched top: rectangle bottom + semicircle top
      const s = new THREE.Shape();
      const halfW = winW / 2;
      const bodyH = winH * 0.55;
      s.moveTo(-halfW, 0);
      s.lineTo( halfW, 0);
      s.lineTo( halfW, bodyH);
      s.absarc(0, bodyH, halfW, 0, Math.PI, false);
      s.lineTo(-halfW, 0);
      geo = new THREE.ExtrudeGeometry(s, { depth: winT, bevelEnabled: false });
      // Extrude goes from Z=0 → Z=winT; shape lives in XY.
      // Re-center on origin, and lift so the arch peak is at the top.
      const archTotalH = bodyH + halfW;
      geo.translate(0, -archTotalH / 2, -winT / 2);
    } else {
      // Round porthole — cylinder oriented as a thin disc facing +Z
      const r = Math.min(winW, winH) / 2;
      geo = new THREE.CylinderGeometry(r, r, winT, 20);
      geo.rotateX(Math.PI / 2);
    }
    if (orient === "side") {
      // Rotate to face ±X — thin axis becomes X, width becomes Z.
      geo.rotateY(Math.PI / 2);
    }
    return geo;
  }

  function addWindow(x, y, z, orient) {
    const geo = makeWindowGeo(orient);
    const m = makeMesh(THREE, geo, windowMat);
    m.position.set(x, y, z);
    g.add(m);
  }

  // Front windows: 0 = none, 1 = left of door, 2 = flanking both sides
  const frontCount = Math.max(0, Math.min(2, Math.round(p.frontWin)));
  if (frontCount >= 1) {
    addWindow(-wallW * 0.3, winY, wallD / 2 + winT / 2, "frontBack");
  }
  if (frontCount >= 2) {
    addWindow( wallW * 0.3, winY, wallD / 2 + winT / 2, "frontBack");
  }

  // Side windows: checkbox — one on each side wall when on
  if (p.sideWin >= 0.5) {
    addWindow(-wallW / 2 - winT / 2, winY, 0, "side");
    addWindow( wallW / 2 + winT / 2, winY, 0, "side");
  }

  // Back window: checkbox — one centered on back wall
  if (p.backWin >= 0.5) {
    addWindow(0, winY, -wallD / 2 - winT / 2, "frontBack");
  }

  // ─── Chimney ───────────────────────────────────────────────
  if (p.chimney >= 0.5) {
    const chW = 0.14;
    const chTopY = wallH + roofH + 0.15;
    const chBottomY = wallH;
    const chH = chTopY - chBottomY;
    const chimney = makeMesh(
      THREE,
      new THREE.BoxGeometry(chW, chH, chW),
      chimneyMat,
    );
    chimney.position.set(wallW * 0.22, chBottomY + chH / 2, wallD * 0.18);
    g.add(chimney);
    const cap = makeMesh(
      THREE,
      new THREE.BoxGeometry(chW * 1.2, 0.04, chW * 1.2),
      chimneyMat,
    );
    cap.position.copy(chimney.position);
    cap.position.y = chTopY + 0.02;
    g.add(cap);
  }

  return g;
}

// ─── Lamp post — base, pole, optional arm, shade, glowing bulb ─
function buildLampPost(THREE, p) {
  const g = new THREE.Group();
  const metalMat = makeMat(THREE, C.metalDk, { roughness: 0.5, metalness: 0.6 });

  // ─── Base (tapered disc) ──────────────────────────────────
  const baseH = 0.1;
  const baseW = p.baseW;
  const base = makeMesh(
    THREE,
    new THREE.CylinderGeometry(baseW * 0.78, baseW, baseH, 16),
    metalMat,
  );
  base.position.y = baseH / 2;
  g.add(base);

  // ─── Pole ─────────────────────────────────────────────────
  const poleH = p.poleH;
  const poleR = p.poleR;
  const pole = makeMesh(
    THREE,
    new THREE.CylinderGeometry(poleR, poleR, poleH, 12),
    metalMat,
  );
  pole.position.y = baseH + poleH / 2;
  g.add(pole);

  // ─── Optional arm + shade offset ──────────────────────────
  // armLen == 0 → shade sits on top of the pole (post-style lantern).
  // armLen > 0 → horizontal capsule arm + shade hanging off the side
  //              (street-lamp style). A Capsule is used so the arm's
  //              rounded ends tuck smoothly into pole + shade with no
  //              visible flat-cap gap at either junction.
  const armLen = p.armLen;
  const poleTopY = baseH + poleH;
  let shadeX = 0;
  let shadeTopY = poleTopY;
  if (armLen > 0.01) {
    const armR = 0.025;
    const arm = makeMesh(
      THREE,
      new THREE.CapsuleGeometry(armR, armLen, 6, 12),
      metalMat,
    );
    arm.rotation.z = Math.PI / 2;
    arm.position.set(armLen / 2 + poleR * 0.5, poleTopY, 0);
    g.add(arm);
    // Small collar where the arm meets the pole — hides any residual gap
    const collar = makeMesh(
      THREE,
      new THREE.SphereGeometry(poleR * 1.25, 10, 8),
      metalMat,
    );
    collar.position.set(0, poleTopY, 0);
    g.add(collar);
    shadeX = armLen + poleR * 0.5;
  }

  // ─── Shade (lamp housing) ─────────────────────────────────
  // shadeStyle: 0 = cylindrical (classic street lamp), 1 = cone
  // (down-tapered, softer), 2 = globe (sphere lantern).
  const shadeStyle = Math.round(p.shadeStyle);
  const shadeH = p.shadeH;
  const shadeR = p.shadeR;
  let shadeGeo;
  if (shadeStyle === 0) {
    shadeGeo = new THREE.CylinderGeometry(shadeR * 0.95, shadeR, shadeH, 16);
  } else if (shadeStyle === 1) {
    shadeGeo = new THREE.CylinderGeometry(shadeR * 0.5, shadeR, shadeH, 16);
  } else {
    shadeGeo = new THREE.SphereGeometry(shadeR, 18, 14);
  }
  const shade = makeMesh(THREE, shadeGeo, metalMat);
  if (armLen > 0.01) {
    // Hang the shade below the arm tip: top of shade aligns with arm Y
    shade.position.set(shadeX, poleTopY - shadeH / 2, 0);
    shadeTopY = poleTopY;
  } else {
    // Post-mount: shade sits ON TOP of the pole
    shade.position.set(0, poleTopY + shadeH / 2, 0);
    shadeTopY = poleTopY + shadeH;
  }
  g.add(shade);

  // ─── Bulb (optional) ──────────────────────────────────────
  if (p.bulbShow >= 0.5) {
    const bulbMat = new THREE.MeshStandardMaterial({
      color: C.glow,
      emissive: C.glow,
      emissiveIntensity: 0.8,
      roughness: 0.3,
      transparent: true,
      opacity: 1,
    });
    const bulbR = shadeR * 0.7;
    const bulb = makeMesh(
      THREE,
      new THREE.SphereGeometry(bulbR, 16, 12),
      bulbMat,
    );
    if (armLen > 0.01) {
      // Bulb sticks out the bottom of the hanging shade
      bulb.position.set(shadeX, poleTopY - shadeH + bulbR * 0.3, 0);
    } else {
      // Bulb sits inside the top-mounted shade
      bulb.position.set(0, poleTopY + shadeH * 0.5, 0);
    }
    g.add(bulb);
  }

  return g;
}

// ─── Table — top + 4 legs ───────────────────────────────────
function buildTable(THREE, p) {
  const g = new THREE.Group();
  const woodMat = makeMat(THREE, C.wood, { roughness: 0.8 });
  const topW = p.width, topD = p.depth, topH = 0.06;
  const legH = p.legH;
  const top = makeMesh(
    THREE,
    new THREE.BoxGeometry(topW, topH, topD),
    woodMat,
  );
  top.position.y = legH + topH / 2;
  g.add(top);
  const legR = 0.05;
  const offX = topW / 2 - 0.1;
  const offZ = topD / 2 - 0.1;
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const leg = makeMesh(
      THREE,
      new THREE.CylinderGeometry(legR, legR, legH, 10),
      woodMat,
    );
    leg.position.set(sx * offX, legH / 2, sz * offZ);
    g.add(leg);
  }
  return g;
}

// ─── Chair — seat, back, 4 legs ─────────────────────────────
function buildChair(THREE, p) {
  const g = new THREE.Group();
  const woodMat = makeMat(THREE, C.wood, { roughness: 0.8 });
  const seatW = p.seatW, seatD = p.seatD, seatH = 0.06;
  const legH = p.legH;
  const backH = p.backH;
  const seat = makeMesh(
    THREE,
    new THREE.BoxGeometry(seatW, seatH, seatD),
    woodMat,
  );
  seat.position.y = legH + seatH / 2;
  g.add(seat);
  const backT = 0.05;
  const back = makeMesh(
    THREE,
    new THREE.BoxGeometry(seatW, backH, backT),
    woodMat,
  );
  back.position.set(0, legH + seatH + backH / 2, -seatD / 2 + backT / 2);
  g.add(back);
  const legR = 0.035;
  const offX = seatW / 2 - 0.05;
  const offZ = seatD / 2 - 0.05;
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const leg = makeMesh(
      THREE,
      new THREE.CylinderGeometry(legR, legR, legH, 10),
      woodMat,
    );
    leg.position.set(sx * offX, legH / 2, sz * offZ);
    g.add(leg);
  }
  return g;
}

// ─── Fence — 1–3 posts with rails & pickets between them ─────
function buildFence(THREE, p) {
  const g = new THREE.Group();
  const woodMat   = makeMat(THREE, C.wood, { roughness: 0.9 });
  const picketMat = makeMat(THREE, 0xc19469, { roughness: 0.95 }); // slightly lighter

  const postCount = Math.max(1, Math.min(3, Math.round(p.posts)));
  const postH     = p.postH;
  const postW     = p.postW;
  const spacing   = p.spacing;
  const capStyle  = Math.round(p.capStyle);

  // Lay posts out symmetrically along X. With postCount=1 the one
  // post sits at origin; with 2 or 3 they're evenly spaced across a
  // total width of spacing*(postCount-1) centered on origin.
  const totalWidth = spacing * Math.max(0, postCount - 1);
  const startX = -totalWidth / 2;

  // ─── Posts + caps ─────────────────────────────────────────
  for (let i = 0; i < postCount; i++) {
    const x = postCount === 1 ? 0 : startX + spacing * i;
    const post = makeMesh(
      THREE,
      new THREE.BoxGeometry(postW, postH, postW),
      woodMat,
    );
    post.position.set(x, postH / 2, 0);
    g.add(post);
    // Cap: 0 pyramid · 1 ball · 2 flat (no cap mesh added).
    if (capStyle === 0) {
      const capH = postW * 0.75;
      const cap = makeMesh(
        THREE,
        new THREE.ConeGeometry(postW * 0.75, capH, 4),
        woodMat,
      );
      cap.rotation.y = Math.PI / 4;
      cap.position.set(x, postH + capH / 2, 0);
      g.add(cap);
    } else if (capStyle === 1) {
      const cap = makeMesh(
        THREE,
        new THREE.SphereGeometry(postW * 0.5, 14, 10),
        woodMat,
      );
      cap.position.set(x, postH + postW * 0.35, 0);
      g.add(cap);
    }
  }

  // ─── Rails + pickets span BETWEEN adjacent posts ──────────
  // With a single post there's no panel to fill, so skip entirely.
  if (postCount < 2) return g;

  const railCount   = Math.max(0, Math.min(3, Math.round(p.rails)));
  const railT       = p.railT;
  const picketCount = Math.max(0, Math.min(20, Math.round(p.pickets)));
  const picketW     = p.picketW;
  const picketH     = p.picketH * postH;

  for (let i = 0; i < postCount - 1; i++) {
    // Inner X range for this panel — between the inner faces of the
    // two adjacent posts. Pickets sit inside this range; rails span
    // the full gap (including into the post faces for a clean look).
    const leftX    = startX + spacing * i;
    const rightX   = startX + spacing * (i + 1);
    const panelW   = rightX - leftX;
    const panelCX  = (leftX + rightX) / 2;

    // Rails — horizontal beams evenly distributed along the post
    // height (excluding top/bottom 10% margins so they don't kiss
    // the ground or the cap).
    for (let r = 0; r < railCount; r++) {
      const t = railCount === 1 ? 0.5 : r / (railCount - 1);
      const y = postH * (0.15 + t * 0.7);
      const rail = makeMesh(
        THREE,
        new THREE.BoxGeometry(panelW, railT, railT),
        woodMat,
      );
      rail.position.set(panelCX, y, 0);
      g.add(rail);
    }

    // Pickets — vertical slats evenly distributed across the panel,
    // sitting slightly above ground and extending up to picketH.
    // Thin in Z (about half their X width) so they read as planks.
    if (picketCount > 0) {
      const innerLeft  = leftX + postW / 2;
      const innerRight = rightX - postW / 2;
      const innerW     = innerRight - innerLeft;
      const slotW      = innerW / (picketCount + 1);
      for (let pi = 0; pi < picketCount; pi++) {
        const px = innerLeft + slotW * (pi + 1);
        const picket = makeMesh(
          THREE,
          new THREE.BoxGeometry(picketW, picketH, picketW * 0.55),
          picketMat,
        );
        picket.position.set(px, picketH / 2 + 0.015, 0);
        g.add(picket);
      }
    }
  }

  return g;
}

// ─── Signpost — pole + rectangular sign board ──────────────
function buildSignpost(THREE, p) {
  const g = new THREE.Group();
  const woodMat = makeMat(THREE, C.wood, { roughness: 0.85 });
  const boardMat = makeMat(THREE, C.paint, { roughness: 0.7 });
  const poleH = p.poleH;
  const pole = makeMesh(
    THREE,
    new THREE.CylinderGeometry(0.045, 0.045, poleH, 10),
    woodMat,
  );
  pole.position.y = poleH / 2;
  g.add(pole);
  const board = makeMesh(
    THREE,
    new THREE.BoxGeometry(p.boardW, p.boardH, 0.05),
    boardMat,
  );
  board.position.y = poleH - p.boardH / 2 - 0.05;
  board.position.x = p.boardW / 2 - 0.05;
  g.add(board);
  const cap = makeMesh(
    THREE,
    new THREE.SphereGeometry(0.06, 10, 8),
    woodMat,
  );
  cap.position.y = poleH;
  g.add(cap);
  return g;
}

// ─── Cloud — cluster of overlapping spheres, seeded ────────
function buildCloud(THREE, p) {
  const g = new THREE.Group();
  const cloudMat = makeMat(THREE, C.cloud, { roughness: 1 });
  const puffCount = Math.max(2, Math.round(p.puffs));
  const rnd = prng(p.seed);
  const spread = p.spread;
  // Always place a big central puff first so the cloud always has a core
  const core = makeMesh(
    THREE,
    new THREE.SphereGeometry(0.5, 16, 12),
    cloudMat,
  );
  g.add(core);
  for (let i = 0; i < puffCount - 1; i++) {
    const r = 0.3 + rnd() * 0.2;
    const a = rnd() * Math.PI * 2;
    const radius = spread * (0.3 + rnd() * 0.7);
    const px = Math.cos(a) * radius;
    const pz = Math.sin(a) * radius * 0.4;
    const py = (rnd() - 0.3) * 0.25;
    const puff = makeMesh(
      THREE,
      new THREE.SphereGeometry(r, 14, 10),
      cloudMat,
    );
    puff.position.set(px, py, pz);
    g.add(puff);
  }
  return g;
}

// ─── Arch — pillars + half-torus top + keystone + base steps ─
function buildArch(THREE, p) {
  const g = new THREE.Group();
  const stoneMat = makeMat(THREE, C.stone, { roughness: 0.9 });

  const pillarW = p.pillarW;
  const pillarD = p.pillarD;
  const pillarH = p.pillarH;
  const spanX   = p.span;
  const tube    = p.tube;

  // ─── Optional base steps ──────────────────────────────────
  // stepCount: 0 = no steps, 1–3 = stacked base slabs, each
  // slightly wider & shallower than the one above.
  const stepCount = Math.max(0, Math.min(3, Math.round(p.steps)));
  const stepH = 0.08;
  let baseTopY = 0;
  for (let i = 0; i < stepCount; i++) {
    // Steps go bottom (widest) to top (narrowest). i=0 is the widest
    // bottom step, subsequent ones shrink inward.
    const shrink = i * 0.08;
    const sW = spanX + pillarW + 0.3 - shrink;
    const sD = pillarD + 0.3 - shrink;
    const step = makeMesh(
      THREE,
      new THREE.BoxGeometry(sW, stepH, sD),
      stoneMat,
    );
    step.position.y = i * stepH + stepH / 2;
    g.add(step);
  }
  baseTopY = stepCount * stepH;

  // ─── Pillars ──────────────────────────────────────────────
  for (const sx of [-1, 1]) {
    const pillar = makeMesh(
      THREE,
      new THREE.BoxGeometry(pillarW, pillarH, pillarD),
      stoneMat,
    );
    pillar.position.set(sx * spanX / 2, baseTopY + pillarH / 2, 0);
    g.add(pillar);
  }

  // ─── Half-torus arch spanning the pillars ─────────────────
  // archRadius is the centre-to-centre distance between pillars / 2.
  // The torus is split into radial segments — higher tube value means
  // a thicker, more "Roman" look; thinner = delicate Moorish arch.
  const archRadius = spanX / 2;
  const arch = makeMesh(
    THREE,
    new THREE.TorusGeometry(archRadius, tube, 12, 32, Math.PI),
    stoneMat,
  );
  arch.position.y = baseTopY + pillarH;
  g.add(arch);

  // ─── Optional keystone at the apex ────────────────────────
  if (p.keystone >= 0.5) {
    const ksW = Math.max(0.12, tube * 2);
    const ksH = Math.max(0.14, tube * 2);
    const keystone = makeMesh(
      THREE,
      new THREE.BoxGeometry(ksW, ksH, pillarD * 1.05),
      stoneMat,
    );
    keystone.position.y = baseTopY + pillarH + archRadius - ksH * 0.15;
    g.add(keystone);
  }

  return g;
}

// ─── Bed — frame, mattress, blanket, pillows, headboard ─────
function buildBed(THREE, p) {
  const g = new THREE.Group();
  const frameMat = makeMat(THREE, C.wood, { roughness: 0.85 });
  const mattressMat = makeMat(THREE, 0xf2ede0, { roughness: 0.8 });
  const blanketMat = makeMat(THREE, 0xa6718d, { roughness: 0.75 });
  const pillowMat = makeMat(THREE, 0xffffff, { roughness: 0.85 });
  const bedW = p.width, bedD = p.length, frameH = 0.22, matH = 0.15;
  const frame = makeMesh(
    THREE,
    new THREE.BoxGeometry(bedW, frameH, bedD),
    frameMat,
  );
  frame.position.y = frameH / 2;
  g.add(frame);
  const mattress = makeMesh(
    THREE,
    new THREE.BoxGeometry(bedW - 0.08, matH, bedD - 0.08),
    mattressMat,
  );
  mattress.position.y = frameH + matH / 2;
  g.add(mattress);
  const blanketL = bedD * 0.65;
  const blanket = makeMesh(
    THREE,
    new THREE.BoxGeometry(bedW - 0.05, 0.04, blanketL),
    blanketMat,
  );
  blanket.position.set(0, frameH + matH + 0.02, bedD / 2 - blanketL / 2);
  g.add(blanket);
  const pillowCount = Math.max(1, Math.round(p.pillows));
  const pillowSlotW = (bedW - 0.2) / pillowCount;
  const pillowD = 0.28;
  for (let i = 0; i < pillowCount; i++) {
    const pillowW = pillowSlotW - 0.04;
    const pillow = makeMesh(
      THREE,
      new THREE.BoxGeometry(pillowW, 0.1, pillowD),
      pillowMat,
    );
    const x = -bedW / 2 + 0.1 + pillowSlotW * (i + 0.5);
    pillow.position.set(
      x,
      frameH + matH + 0.05,
      -bedD / 2 + pillowD / 2 + 0.05,
    );
    g.add(pillow);
  }
  const headH = p.headboardH;
  if (headH > 0) {
    const headboard = makeMesh(
      THREE,
      new THREE.BoxGeometry(bedW, headH, 0.06),
      frameMat,
    );
    headboard.position.set(0, headH / 2, -bedD / 2 - 0.03);
    g.add(headboard);
  }
  return g;
}

// ─── Couch — base, back, arms, cushions ────────────────────
function buildCouch(THREE, p) {
  const g = new THREE.Group();
  const bodyMat = makeMat(THREE, 0x6d8ba8, { roughness: 0.85 });
  const cushionMat = makeMat(THREE, 0x89a9c5, { roughness: 0.8 });
  const baseW = p.width, baseD = p.depth, baseH = 0.3;
  const armW = 0.18, armH = 0.5;
  const backH = p.backH;
  const base = makeMesh(
    THREE,
    new THREE.BoxGeometry(baseW, baseH, baseD),
    bodyMat,
  );
  base.position.y = baseH / 2;
  g.add(base);
  const back = makeMesh(
    THREE,
    new THREE.BoxGeometry(baseW, backH, 0.18),
    bodyMat,
  );
  back.position.set(0, baseH + backH / 2, -baseD / 2 + 0.09);
  g.add(back);
  for (const sx of [-1, 1]) {
    const arm = makeMesh(
      THREE,
      new THREE.BoxGeometry(armW, armH, baseD),
      bodyMat,
    );
    arm.position.set(sx * (baseW / 2 - armW / 2), baseH + armH / 2 - 0.08, 0);
    g.add(arm);
  }
  const cushionCount = Math.max(1, Math.round(p.cushions));
  const cushionArea = baseW - 2 * armW - 0.06;
  const cushionW = cushionArea / cushionCount;
  const cushionD = baseD - 0.3;
  const cushionH = 0.12;
  for (let i = 0; i < cushionCount; i++) {
    const c = makeMesh(
      THREE,
      new THREE.BoxGeometry(cushionW - 0.02, cushionH, cushionD),
      cushionMat,
    );
    const x = -cushionArea / 2 + cushionW * (i + 0.5);
    c.position.set(
      x,
      baseH + cushionH / 2 + 0.005,
      (baseD - 0.18) / 2 - cushionD / 2,
    );
    g.add(c);
  }
  return g;
}

// ─── Bookshelf — frame + shelves + optional books ──────────
function buildBookshelf(THREE, p) {
  const g = new THREE.Group();
  const woodMat = makeMat(THREE, C.wood, { roughness: 0.85 });
  const shelfW = p.width, shelfD = p.depth, shelfH = p.height, wallT = 0.05;
  for (const sx of [-1, 1]) {
    const side = makeMesh(
      THREE,
      new THREE.BoxGeometry(wallT, shelfH, shelfD),
      woodMat,
    );
    side.position.set(sx * (shelfW / 2 - wallT / 2), shelfH / 2, 0);
    g.add(side);
  }
  const back = makeMesh(
    THREE,
    new THREE.BoxGeometry(shelfW - wallT * 2, shelfH, 0.03),
    woodMat,
  );
  back.position.set(0, shelfH / 2, -shelfD / 2 + 0.015);
  g.add(back);
  // Shelf count: includes top & bottom — p.shelves counts interior
  // dividers, total horizontal planks = p.shelves + 2.
  const totalShelves = Math.max(2, Math.round(p.shelves) + 2);
  const shelfYs = [];
  for (let i = 0; i < totalShelves; i++) {
    const t = i / (totalShelves - 1);
    shelfYs.push(0.02 + t * (shelfH - 0.04));
  }
  for (const y of shelfYs) {
    const shelf = makeMesh(
      THREE,
      new THREE.BoxGeometry(shelfW - wallT * 2, 0.04, shelfD - 0.05),
      woodMat,
    );
    shelf.position.set(0, y, 0);
    g.add(shelf);
  }
  if (p.showBooks) {
    const bookColors = [
      0xa14a35, 0x3e6b96, 0x7e5c34, 0xd4a73e, 0x4a7d4a, 0x8a3a5a,
    ];
    const innerW = shelfW - wallT * 2 - 0.06;
    const rnd = prng(p.seed);
    for (let lvl = 0; lvl < shelfYs.length - 1; lvl++) {
      const yBottom = shelfYs[lvl] + 0.02;
      const yHeight = shelfYs[lvl + 1] - shelfYs[lvl] - 0.06;
      if (yHeight < 0.15) continue;
      let x = -innerW / 2 + 0.02;
      while (x < innerW / 2 - 0.02) {
        const bw = 0.05 + rnd() * 0.03;
        const bh = yHeight * (0.65 + rnd() * 0.3);
        const color = bookColors[Math.floor(rnd() * bookColors.length)];
        const book = makeMesh(
          THREE,
          new THREE.BoxGeometry(bw, bh, shelfD - 0.1),
          makeMat(THREE, color, { roughness: 0.6 }),
        );
        book.position.set(x + bw / 2, yBottom + bh / 2, 0);
        g.add(book);
        x += bw + 0.005;
      }
    }
  }
  return g;
}

// ─── Registry ───────────────────────────────────────────────
// Params use the same schema as SHAPES: [{ key, label, min, max, step }].
// Integer steps produce integer inputs. Special key "showBooks" is
// rendered as a checkbox (min/max/step still listed for completeness).
export const COMPOSITES = {
  tree: {
    icon: "tree.svg", label: "Tree", build: buildTree,
    params: [
      { key: "trunkH",         label: "Trunk H",       min: 0.2, max: 2.0, step: 0.05 },
      { key: "trunkR",         label: "Trunk R",       min: 0.05, max: 0.25, step: 0.01 },
      { key: "trunkTaper",     label: "Trunk Taper",   min: 0.5, max: 1.0, step: 0.02 },
      { key: "canopy",         label: "Canopy R",      min: 0.3, max: 1.4, step: 0.05 },
      { key: "canopyStretchY", label: "Canopy Stretch",min: 0.5, max: 1.8, step: 0.05 },
      { key: "canopyOffset",   label: "Canopy Y",      min: -0.3, max: 0.5, step: 0.02 },
      { key: "bumps",          label: "Bumps",         min: 0,   max: 8,   step: 1 },
      { key: "bumpSize",       label: "Bump Size",     min: 0.3, max: 1.0, step: 0.05 },
      { key: "bumpSpread",     label: "Bump Spread",   min: 0.3, max: 1.0, step: 0.05 },
      { key: "seed",           label: "Seed",          min: 1,   max: 9999, step: 1 },
    ],
    defaults: {
      trunkH: 0.7, trunkR: 0.11, trunkTaper: 0.8,
      canopy: 0.55, canopyStretchY: 1.0, canopyOffset: 0,
      bumps: 3, bumpSize: 0.55, bumpSpread: 0.65,
      seed: 42,
    },
  },
  pinetree: {
    icon: "pine-tree.svg", label: "Pine Tree", build: buildPineTree,
    params: [
      { key: "trunkH",  label: "Trunk H",    min: 0.1, max: 1.2, step: 0.05 },
      { key: "trunkR",  label: "Trunk R",    min: 0.04, max: 0.18, step: 0.01 },
      { key: "canopyH", label: "Canopy H",   min: 0.6, max: 3.0, step: 0.05 },
      { key: "baseR",   label: "Base R",     min: 0.3, max: 1.0, step: 0.05 },
      { key: "topR",    label: "Top Taper %", min: 0.0, max: 0.9, step: 0.05 },
      { key: "tiers",   label: "Tiers",      min: 1,   max: 7,   step: 1 },
      { key: "overlap", label: "Tier Overlap", min: 0.1, max: 0.75, step: 0.02 },
    ],
    defaults: {
      trunkH: 0.2, trunkR: 0.07, canopyH: 1.05,
      baseR: 0.4, topR: 0.45, tiers: 3, overlap: 0.24,
    },
  },
  mushroom: {
    icon: "mushroom.svg", label: "Mushroom", build: buildMushroom,
    params: [
      { key: "stemH", label: "Stem H", min: 0.2, max: 1.2, step: 0.05 },
      { key: "stemR", label: "Stem R", min: 0.08, max: 0.3, step: 0.01 },
      { key: "capR",  label: "Cap R",  min: 0.2, max: 0.9, step: 0.02 },
    ],
    defaults: { stemH: 0.55, stemR: 0.18, capR: 0.42 },
  },
  flower: {
    icon: "flower.svg", label: "Flower", build: buildFlower,
    params: [
      { key: "stemH",      label: "Stem H",      min: 0.4, max: 1.6, step: 0.05 },
      { key: "petals",     label: "Petals",      min: 3,   max: 12,  step: 1 },
      // Petal Tilt: + = tips UP (cup / tulip), 0 = flat (daisy),
      //             − = tips DOWN (wilted).
      { key: "petalAngle", label: "Petal Tilt",  min: -45, max: 60,  step: 1 },
      { key: "leaves",     label: "Leaves",      min: 0,   max: 6,   step: 1 },
      // Leaf Angle: + = angled UP, 0 = horizontal, − = drooping DOWN.
      // Range expanded to -45 so you can get a strong natural droop.
      { key: "leafAngle",  label: "Leaf Angle",  min: -45, max: 45,  step: 1 },
      { key: "leafY",      label: "Leaf Y",      min: 0.1, max: 0.6, step: 0.02 },
    ],
    defaults: { stemH: 0.8, petals: 5, petalAngle: 25, leaves: 2, leafAngle: 41, leafY: 0.3 },
  },
  cactus: {
    icon: "cactus.svg", label: "Cactus", build: buildCactus,
    params: [
      { key: "trunkH", label: "Trunk H", min: 0.7, max: 2.0, step: 0.05 },
      { key: "arms",   label: "Arms",    min: 0,   max: 3,   step: 1 },
      { key: "armH",   label: "Arm Out", min: 0.1, max: 0.5, step: 0.02 },
      { key: "armV",   label: "Arm Up",  min: 0.15, max: 0.8, step: 0.02 },
      { key: "armY",   label: "Arm Pos", min: 0.25, max: 0.75, step: 0.02 },
    ],
    defaults: { trunkH: 1.65, arms: 2, armH: 0.26, armV: 0.37, armY: 0.45 },
  },
  house: {
    icon: "house.svg", label: "House", build: buildHouse,
    params: [
      { key: "width",     label: "Width",         min: 0.8,  max: 3.0,  step: 0.05 },
      { key: "depth",     label: "Depth",         min: 0.8,  max: 3.0,  step: 0.05 },
      { key: "wallH",     label: "Walls H",       min: 0.5,  max: 2.0,  step: 0.05 },
      { key: "roofH",     label: "Roof H",        min: 0.2,  max: 1.5,  step: 0.05 },
      { key: "overhang",  label: "Overhang",      min: 0,    max: 0.25, step: 0.01 },
      // Window placement
      { key: "frontWin",  label: "Front Windows", min: 0,    max: 2,    step: 1 },
      { key: "sideWin",   label: "Side Windows",  min: 0,    max: 1,    step: 1 },
      { key: "backWin",   label: "Back Window",   min: 0,    max: 1,    step: 1 },
      // Window geometry
      { key: "winShape",  label: "Window Shape",  min: 0,    max: 2,    step: 1 },
      { key: "winW",      label: "Window W",      min: 0.15, max: 0.45, step: 0.02 },
      { key: "winH",      label: "Window H",      min: 0.15, max: 0.45, step: 0.02 },
      { key: "winY",      label: "Window Y",      min: 0.3,  max: 0.85, step: 0.02 },
      { key: "chimney",   label: "Chimney",       min: 0,    max: 1,    step: 1 },
    ],
    defaults: {
      width: 1.15, depth: 1.25, wallH: 1.0, roofH: 0.7, overhang: 0.12,
      frontWin: 2, sideWin: 1, backWin: 1,
      winShape: 0, winW: 0.28, winH: 0.28, winY: 0.6,
      chimney: 1,
    },
  },
  lamppost: {
    icon: "lamp-post.svg", label: "Lamp Post", build: buildLampPost,
    params: [
      { key: "poleH",      label: "Pole H",      min: 0.8,  max: 2.5,  step: 0.05 },
      { key: "poleR",      label: "Pole R",      min: 0.02, max: 0.08, step: 0.005 },
      { key: "baseW",      label: "Base W",      min: 0.1,  max: 0.35, step: 0.01 },
      { key: "armLen",     label: "Arm Length",  min: 0,    max: 0.5,  step: 0.02 },
      { key: "shadeStyle", label: "Shade Style", min: 0,    max: 2,    step: 1 },
      { key: "shadeR",     label: "Shade R",     min: 0.07, max: 0.25, step: 0.01 },
      { key: "shadeH",     label: "Shade H",     min: 0.08, max: 0.3,  step: 0.01 },
      { key: "bulbShow",   label: "Bulb",        min: 0,    max: 1,    step: 1 },
    ],
    defaults: {
      poleH: 1.5, poleR: 0.035, baseW: 0.18,
      armLen: 0.2, shadeStyle: 0, shadeR: 0.11, shadeH: 0.16,
      bulbShow: 1,
    },
  },
  table: {
    icon: "table.svg", label: "Table", build: buildTable,
    params: [
      { key: "width", label: "Width", min: 0.6, max: 2.5, step: 0.05 },
      { key: "depth", label: "Depth", min: 0.5, max: 1.5, step: 0.05 },
      { key: "legH",  label: "Leg H", min: 0.3, max: 1.1, step: 0.05 },
    ],
    defaults: { width: 1.3, depth: 0.8, legH: 0.65 },
  },
  chair: {
    icon: "chair.svg", label: "Chair", build: buildChair,
    params: [
      { key: "seatW", label: "Seat W", min: 0.3, max: 0.9, step: 0.02 },
      { key: "seatD", label: "Seat D", min: 0.3, max: 0.9, step: 0.02 },
      { key: "legH",  label: "Leg H",  min: 0.25, max: 0.8, step: 0.02 },
      { key: "backH", label: "Back H", min: 0.2,  max: 1.0, step: 0.05 },
    ],
    defaults: { seatW: 0.55, seatD: 0.55, legH: 0.45, backH: 0.6 },
  },
  // Kept the id "fencepost" for save-file compatibility, but the
  // label + behaviour now represent a full fence with 1–3 posts.
  fencepost: {
    icon: "fence-post.svg", label: "Fence", build: buildFence,
    params: [
      { key: "posts",     label: "Posts",      min: 1,    max: 3,    step: 1 },
      { key: "spacing",   label: "Spacing",    min: 0.6,  max: 2.5,  step: 0.05 },
      { key: "postH",     label: "Post H",     min: 0.4,  max: 2.0,  step: 0.05 },
      { key: "postW",     label: "Post W",     min: 0.08, max: 0.3,  step: 0.01 },
      { key: "capStyle",  label: "Cap Style",  min: 0,    max: 2,    step: 1 },
      { key: "rails",     label: "Rails",      min: 0,    max: 3,    step: 1 },
      { key: "railT",     label: "Rail Thick", min: 0.03, max: 0.12, step: 0.005 },
      { key: "pickets",   label: "Pickets",    min: 0,    max: 15,   step: 1 },
      { key: "picketW",   label: "Picket W",   min: 0.03, max: 0.15, step: 0.005 },
      { key: "picketH",   label: "Picket H %", min: 0.3,  max: 1.05, step: 0.02 },
    ],
    defaults: {
      posts: 2, spacing: 1.4, postH: 1.0, postW: 0.14, capStyle: 0,
      rails: 2, railT: 0.05,
      pickets: 6, picketW: 0.06, picketH: 0.85,
    },
  },
  signpost: {
    icon: "signpost.svg", label: "Signpost", build: buildSignpost,
    params: [
      { key: "poleH",  label: "Pole H",  min: 0.6, max: 2.0, step: 0.05 },
      { key: "boardW", label: "Board W", min: 0.4, max: 1.5, step: 0.05 },
      { key: "boardH", label: "Board H", min: 0.15, max: 0.8, step: 0.02 },
    ],
    defaults: { poleH: 1.1, boardW: 0.85, boardH: 0.4 },
  },
  cloud: {
    icon: "cloud.svg", label: "Cloud", build: buildCloud,
    params: [
      { key: "puffs",  label: "Puffs",  min: 3, max: 10, step: 1 },
      { key: "spread", label: "Spread", min: 0.4, max: 1.5, step: 0.05 },
      { key: "seed",   label: "Seed",   min: 1, max: 9999, step: 1 },
    ],
    defaults: { puffs: 6, spread: 0.7, seed: 7 },
  },
  arch: {
    icon: "arch.svg", label: "Arch", build: buildArch,
    params: [
      { key: "span",     label: "Span",     min: 0.6,  max: 2.5, step: 0.05 },
      { key: "pillarH",  label: "Pillar H", min: 0.5,  max: 2.5, step: 0.05 },
      { key: "pillarW",  label: "Pillar W", min: 0.12, max: 0.5, step: 0.02 },
      { key: "pillarD",  label: "Pillar D", min: 0.12, max: 0.5, step: 0.02 },
      { key: "tube",     label: "Arch Thickness", min: 0.04, max: 0.22, step: 0.01 },
      { key: "keystone", label: "Keystone", min: 0, max: 1, step: 1 },
      { key: "steps",    label: "Base Steps", min: 0, max: 3, step: 1 },
    ],
    defaults: {
      span: 1.0, pillarH: 1.0, pillarW: 0.2, pillarD: 0.22,
      tube: 0.09, keystone: 1, steps: 0,
    },
  },
  bed: {
    icon: "bed.svg", label: "Bed", build: buildBed,
    params: [
      { key: "width",       label: "Width",        min: 0.8, max: 2.2, step: 0.05 },
      { key: "length",      label: "Length",       min: 1.4, max: 2.6, step: 0.05 },
      { key: "pillows",     label: "Pillows",      min: 1,   max: 4,   step: 1 },
      { key: "headboardH",  label: "Headboard H",  min: 0,   max: 1.2, step: 0.05 },
    ],
    defaults: { width: 1.2, length: 1.8, pillows: 2, headboardH: 0.55 },
  },
  couch: {
    icon: "couch.svg", label: "Couch", build: buildCouch,
    params: [
      { key: "width",    label: "Width",    min: 1.0, max: 3.0, step: 0.05 },
      { key: "depth",    label: "Depth",    min: 0.5, max: 1.0, step: 0.05 },
      { key: "backH",    label: "Back H",   min: 0.3, max: 1.0, step: 0.05 },
      { key: "cushions", label: "Cushions", min: 1,   max: 4,   step: 1 },
    ],
    defaults: { width: 1.6, depth: 0.75, backH: 0.55, cushions: 2 },
  },
  bookshelf: {
    icon: "bookshelf.svg", label: "Bookshelf", build: buildBookshelf,
    params: [
      { key: "width",     label: "Width",     min: 0.6, max: 2.0, step: 0.05 },
      { key: "depth",     label: "Depth",     min: 0.2, max: 0.6, step: 0.02 },
      { key: "height",    label: "Height",    min: 0.8, max: 2.5, step: 0.05 },
      { key: "shelves",   label: "Shelves",   min: 1,   max: 6,   step: 1 },
      { key: "showBooks", label: "Show Books", min: 0,   max: 1,   step: 1 },
      { key: "seed",      label: "Seed",      min: 1,   max: 9999, step: 1 },
    ],
    defaults: {
      width: 1.2, depth: 0.3, height: 1.6,
      shelves: 3, showBooks: 1, seed: 5,
    },
  },
};

export function isCompositeType(type) {
  return !!COMPOSITES[type];
}

export function getCompositeDefaults(id) {
  const entry = COMPOSITES[id];
  return entry ? { ...entry.defaults } : {};
}

// Build a composite group by id. If params is omitted, uses defaults.
export function buildComposite(id, params) {
  const entry = COMPOSITES[id];
  if (!entry) return null;
  const THREE = getTHREE();
  const p = params || { ...entry.defaults };
  return entry.build(THREE, p);
}
