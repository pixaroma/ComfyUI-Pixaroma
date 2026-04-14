# 3D Builder v2 — Design Spec

**Date:** 2026-04-14
**Scope:** Rewrite of how objects are added and edited in `js/3d/`. Rendering quality uplift. Local 3D model import.
**Non-goals:** Face/edge/vertex editing, mesh booleans, animation, physics, mirroring, array modifiers, UV/texture editing.

---

## 1. Goals

- Replace the current 6-shape list with an **18-shape** library of parametric primitives.
- Let the user edit geometry parameters (sides, height, width, etc.) **after** an object is added, not only at creation.
- Let the user **import local `.glb` and `.obj`** files as scene objects (transform + color override only — no mesh editing).
- Uplift rendering quality so output looks smooth and pleasant without heavy post-processing: neutral studio environment, soft shadows, smooth normals, better tone mapping.
- Keep the existing editor shell (layers panel, save/close, layout, shortcuts, undo/redo, background image, save format) intact so the change is evolutionary.
- Stay scoped for weak hardware — caps on segments, debounced rebuilds for heavy shapes, no postprocessing pipeline.

---

## 2. Architecture

### 2.1 File layout

Existing files stay. Two new files are split out of `objects.mjs` / `engine.mjs` so no file grows past ~300 lines.

```
js/3d/
├── index.js           unchanged — entry
├── core.mjs           UI shell — `_buildLeft` shape section replaced
├── engine.mjs         Three.js init — rendering uplift lives here
├── objects.mjs        slimmed — CRUD, selection, color; geometry code moves out
├── shapes.mjs         NEW — shape registry: id → { icon, label, geoBuilder, params, defaults, category, live }
├── shape_params.mjs   NEW — the post-add parameter panel (shown in right sidebar)
├── importer.mjs       NEW — GLB/OBJ loading, normal smoothing, dispose, cache
├── interaction.mjs    unchanged
├── persistence.mjs    extended — handles new shape types + imported model paths + seeds
└── api.mjs            extended — one new endpoint for GLB/OBJ uploads
```

### 2.2 Shape registry

One entry per shape in `shapes.mjs`. Adding a 19th shape later = one new entry in one file.

```js
cube: {
  icon: "cube.svg",
  label: "Cube",
  category: "boxy",                      // for grid ordering
  live: true,                            // true = live rebuild on slider tick; false = debounced ~60ms
  params: [
    { key: "width",  label: "Width",  min: 0.1, max: 5, step: 0.1 },
    { key: "height", label: "Height", min: 0.1, max: 5, step: 0.1 },
    { key: "depth",  label: "Depth",  min: 0.1, max: 5, step: 0.1 },
  ],
  defaults: { width: 1, height: 1, depth: 1 },
  build: (THREE, p) => new THREE.BoxGeometry(p.width, p.height, p.depth),
}
```

All four call sites in the current code (`_makeGeo`, `_defaultGeoParams`, `_updateShapeParams.defs`, `_buildLeft.shapes[]`) are rewritten to read from the registry.

### 2.3 Post-add parameter editing

When a slider in the Shape panel changes:

1. Read the active object's type + current `geoParams`.
2. Update the changed param in place.
3. Call `registry[type].build(THREE, geoParams)` to produce a new `BufferGeometry`.
4. `oldGeometry.dispose()` on the mesh.
5. Assign the new geometry. Transform, material, userData are unchanged.
6. Push an undo snapshot (debounced: one snapshot per drag, not per tick).

Shapes with `live: true` rebuild on every slider `input` event. Shapes with `live: false` rebuild on a **60 ms trailing debounce** — the drag stays smooth visually, then the geometry snaps when the user pauses.

---

## 3. The 18 shapes

All sliders have a paired number input (existing `createSliderRow` pattern). `Sides` / `Segments` caps at 128 everywhere. Live = rebuild on every tick; Debounced = 60 ms trailing rebuild.

### 3.1 Row 1 — Boxy / angular

| Shape | Built with | Parameters | Rebuild |
|-------|------------|------------|---------|
| **Cube** | `BoxGeometry` | Width, Height, Depth | Live |
| **Prism** | `CylinderGeometry` with low sides (3–8) | Radius, Height, Sides | Live |
| **Pyramid** | `ConeGeometry` with fixed 4 sides | Base, Height | Live |

### 3.2 Row 2 — Rounded solids

| Shape | Built with | Parameters | Rebuild |
|-------|------------|------------|---------|
| **Sphere** | `SphereGeometry` | Radius, Segments, Rings | Live |
| **Capsule** | `CapsuleGeometry` (Three.js built-in) | Radius, Length, Cap Segments, Radial Segments | Live |
| **Crystal** | `LatheGeometry` — 3 points lathed around Y (bottom tip → middle ring → top tip) | Radius, Top Height, Bottom Height, Sides | Live |

### 3.3 Row 3 — Cylindrical family

| Shape | Built with | Parameters | Rebuild |
|-------|------------|------------|---------|
| **Cylinder** | `CylinderGeometry` | Top Radius, Bottom Radius, Height, Sides | Live |
| **Tube** (hollow pipe) | `ExtrudeGeometry` with ring-shaped `Path` (outer circle + inner hole) | Outer Radius, Inner Radius, Height, Sides | Live |
| **Cone** | `ConeGeometry` | Radius, Height, Sides | Live |

### 3.4 Row 4 — Toroidal + gear

| Shape | Built with | Parameters | Rebuild |
|-------|------------|------------|---------|
| **Torus** (donut) | `TorusGeometry` | Radius, Tube Thickness, Radial Segs, Tube Segs | Live |
| **Ring** (flat annulus) | `RingGeometry` — flat 2D ring | Inner Radius, Outer Radius, Segments | Live |
| **Gear** | Custom `ExtrudeGeometry` with toothed `Shape` + circular hole | Outer Radius, Inner Hole Radius, Teeth, Thickness, Tooth Depth | Debounced |

### 3.5 Row 5 — Flat / ground / organic

| Shape | Built with | Parameters | Rebuild |
|-------|------------|------------|---------|
| **Plane** | `PlaneGeometry` | Width, Height, Width Segs, Height Segs | Live |
| **Terrain** | Subdivided `PlaneGeometry` + simplex-noise vertex displacement | Size, Detail, Height Scale, Roughness, Seed | Debounced |
| **Blob** | `IcosahedronGeometry` with subdivision + smooth simplex noise displacement | Radius, Detail, Noise Strength, Smoothness, Seed | Debounced |

### 3.6 Row 6 — Complex meshes

| Shape | Built with | Parameters | Rebuild |
|-------|------------|------------|---------|
| **Rock** | `IcosahedronGeometry` with subdivision + jagged noise (flatShading) | Size, Detail, Roughness, Seed | Debounced |
| **Teapot** | `TeapotGeometry` from `three/examples/jsm/geometries/TeapotGeometry.js` | Size, Segments, Lid, Handle, Spout, Bottom (last 4 = toggles) | Debounced |
| **Bunny** | Loaded once from `assets/models/bunny.glb` + `computeVertexNormals` for smoothness | *(none — transform/color only)* | — |

### 3.7 Randomized shapes

Blob, Rock, and Terrain each get a **Seed** number input + **🎲 Re-roll** button next to it. Same seed produces the same shape across save/load (deterministic noise).

### 3.8 Imported model (Import button below the 18-shape grid)

| Type | Built with | Parameters |
|------|------------|------------|
| **Import…** | `GLTFLoader` or `OBJLoader` based on extension, `computeVertexNormals()` on flat-normal meshes, cached by upload path | *(none — transform/color/material override only)* |

---

## 4. UI changes

### 4.1 Left sidebar stacking

Unchanged except the "3D Objects" panel:

```
Canvas Settings  →  Background Image  →  3D Objects (REPLACED)  →  Transform Tools  →  Camera
```

### 4.2 "3D Objects" panel — new contents

- 3-column icon grid, 6 rows, 18 total buttons.
- Each button: 54 px tall, SVG `<img src="/pixaroma/assets/icons/3D/<id>.svg">` (white, recolored to `#f66744` orange on hover/active), label below, scale-1.05 pop on hover (120 ms).
- **One click = instantly add that shape to the scene with defaults.** No pre-configure step.
- CSS class renamed from `.p3d-obj-btn` to `.p3d-shape-btn`.
- Below the grid: full-width **"📁 Import 3D Model"** button with distinct visual style (uses existing `createButton` with `variant: "standard"` + upload icon).

### 4.3 Right sidebar stacking

A new **SHAPE** panel slots in between LAYERS and OBJECT COLOR:

```
Layers  →  Shape (NEW)  →  Object Color (+ HSL)  →  Materials  →  Lighting
```

### 4.4 Shape panel contents

- Dynamically rebuilt on every `_select()` that changes the active object's type.
- Header shows the shape name + icon.
- Sliders generated from `registry[type].params` using the framework's `createSliderRow` (matches existing slider style pixel-for-pixel).
- Bottom: **↺ Reset Shape Defaults** button.
- When no object is selected: panel shows "Select an object to edit its shape."
- When the active object is an imported model (`type: "import"` or `"bunny"`): panel shows "No shape parameters for imported models." plus the **Material Override** toggle (see 5.1).
- When multiple objects of *different* types are selected: panel shows "Multiple types selected — pick one object to edit shape."
- When multiple objects of the *same* type are selected: sliders drive all of them simultaneously.
- When the active object is locked: all sliders disabled.

### 4.5 Canvas area changes

- **Default BG color** changes from `#000000` → `#6e6e6e`. Old saved scenes keep their saved color; only the *default* for new scenes and the Reset button changes.
- **Focus button** in the Camera panel uses `/pixaroma/assets/icons/3D/focus.svg` (replacing the 🔍 emoji). Behavior unchanged.
- **Layer thumbnails**: color-swatch dot stays for simple shapes. For Bunny, Rock, Teapot, Gear, Blob, Terrain, and imported models, a tiny 14 × 14 offscreen render of the object is generated as the thumbnail (cached per-object, regenerated on color/geometry change). Falls back to swatch if render fails.

### 4.6 ComfyUI Settings panel

One new user-facing setting under **👑 Pixaroma** category:

| Setting ID | Type | Default | Purpose |
|------------|------|---------|---------|
| `Pixaroma.3D.DefaultBgColor` | color | `#6e6e6e` | Default BG color for new 3D scenes |

---

## 5. Import flow

### 5.1 User flow

1. Click **📁 Import 3D Model** button (below the shape grid).
2. File picker opens, accepting `.glb, .gltf, .obj`.
3. File uploads via new backend route → stored under `input/pixaroma/<project_id>/models/<hash>.<ext>`.
4. Frontend loads it from the served URL, lazy-importing the matching loader from esm.sh.
5. `computeVertexNormals()` applied on meshes that have only face normals (detected by `!attributes.normal || hasHardEdges`).
6. Wrapped in a `THREE.Group` so multi-mesh imports act as one selectable object.
7. Added to scene at origin, selected, appears in Layers panel named after the file.
8. Right sidebar shows: Transform (standard) + **Material Override** toggle in the Shape panel.

### 5.2 Material Override toggle

- **ON (default)**: imported model keeps its original materials/textures. Object Color panel disabled.
- **OFF**: all meshes in the imported `Group` share a single `MeshStandardMaterial` driven by the Object Color + Material panels (same as primitive objects).
- Toggle state persisted in object's `userData.keepOriginalMaterials`.

### 5.3 Built-in Bunny

- The Bunny button in the shape grid triggers the same import pipeline but loads `/pixaroma/assets/models/bunny.glb` directly — no upload.
- `type: "bunny"` is set in userData so persistence knows to reload from the bundled asset path rather than an upload path.
- First load caches the `GLTF` data on `window._pixaromaBunnyCache` so subsequent Bunny clicks are instant.
- If the bunny file is missing or 404s, an error toast appears and a sphere-based placeholder is added so the user isn't stuck.

### 5.4 Safety and caps

- Max upload size: 50 MB (matches existing base64 payload cap in `server_routes.py`).
- Allowed extensions: `.glb`, `.gltf`, `.obj` only. Rejected at route level.
- `_safe_path()` validates that the resulting file path stays inside `PIXAROMA_INPUT_ROOT`.
- GLB animations (if present) are ignored — only the first scene's meshes are imported.
- Face count is **not** capped — the user knowingly accepts the cost of loading large models.

---

## 6. Rendering uplift

All changes live in `engine.mjs` `_initThree()` plus small tweaks in `objects.mjs` material setup. No new third-party JS.

### 6.1 Procedural studio environment

- Build a tiny `THREE.Scene` with a gradient-colored cube (top `#fff2e0` warm, middle neutral gray, bottom `#202028` cool).
- Run it through `PMREMGenerator` once at init.
- Assign the resulting texture to `scene.environment`.
- Every `MeshStandardMaterial` in the scene now samples this for reflections/fill.
- **Opt-out:** new checkbox **"Studio Lighting"** in the Lighting panel (default ON). When off, `scene.environment = null` (today's look).

### 6.2 Soft shadows

```js
renderer.shadowMap.type = THREE.VSMShadowMap;
light.shadow.radius = 4;
light.shadow.blurSamples = 12;
light.shadow.mapSize.set(2048, 2048);   // up from 1024
light.shadow.bias = -0.0005;
```

VSM gives naturally-soft shadow edges that blur with distance.

### 6.3 Tone mapping

```js
renderer.toneMapping = THREE.AgXToneMapping;   // available in three 0.170+
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
```

Fallback to `ACESFilmicToneMapping` at runtime if `AgXToneMapping` is undefined.

### 6.4 Smooth normals

- `geo.computeVertexNormals()` called after every geometry creation in `shapes.mjs` `build()` functions, except for **Rock** (jagged shading is the point).
- Applied on import for imported meshes missing normals.

### 6.5 Default light & material tweaks

| Knob | Before | After |
|------|--------|-------|
| Directional light intensity | 1.4 | 1.0 |
| Ambient intensity | 0 | 0.15 |
| Default new-object roughness | 0.85 | 0.55 |
| Default new-object metalness | 0 | 0 |

Material presets (Clay / Matte / Glossy / Metal) unchanged.

### 6.6 Shadow frustum auto-fit

- Once per second while the scene is idle (no drag/orbit), compute the bounding box of `this.objects`.
- Set the directional light's shadow camera frustum to match.
- Keeps shadow-map resolution focused on what's visible — sharper soft shadows.

### 6.7 What does NOT change

- Orbit controls, transform gizmo, keyboard shortcuts.
- Save/close buttons, layout shell.
- Background image system (CSS 2D overlay behind canvas).
- Undo/redo, multi-select, drag-reorder in layers.
- FOV slider, perspective/isometric toggle, camera views (F/B/T + focus).
- Ground shadow plane (`ShadowMaterial`, opacity 0.35) stays on by default.
- Transparent BG save-to-disk checkbox and its render path.
- Save format keys — new fields are *added*, existing ones never change meaning.

---

## 7. Persistence

### 7.1 Object-level additions

Added to each object in `_serializeScene().objects[]`:

```js
{
  // ...existing keys (id, name, type, colorHex, locked, geoParams, position, rotation, scale,
  //                  roughness, metalness, opacity, visible)...

  importPath: "pixaroma/<project_id>/models/<hash>.glb",   // imported objects only
  keepOriginalMaterials: true,                              // imported objects only
  seed: 12345,                                              // Blob / Rock / Terrain only
}
```

### 7.2 Scene-level additions

```js
{
  // ...existing keys...
  studioLighting: true,      // "Studio Lighting" checkbox state
  defaultBgColor: "#6e6e6e", // user's chosen default gray, for Reset-button fidelity
}
```

### 7.3 Backward compatibility

- The 6 original shape types (`cube, sphere, cylinder, cone, torus, plane`) are present in the new registry with the **same `geoParams` keys** (`width/height/depth`, `radius/widthSegs/heightSegs`, `radiusTop/radiusBottom/height/sides`, `radius/tube/radialSegs/tubeSegs`, `width/height`). Old scenes load unchanged.
- Renderer-level changes (env map, VSM, tone mapping, gray default) apply automatically to old scenes when reopened — objects themselves are untouched.
- Unknown `type` values fall back to Cube with a console warning.
- Missing `seed` on Blob/Rock/Terrain defaults to `1` (deterministic placeholder).

### 7.4 Backend routes

| Route | Method | Status | Purpose |
|-------|--------|--------|---------|
| `/pixaroma/api/3d/model_upload` | POST | NEW | Accepts base64 `.glb/.gltf/.obj`, validates extension + size, writes under `input/pixaroma/<project_id>/models/`, returns relative path |
| `/pixaroma/assets/{filename}` | GET | EXTEND | Already exists; extend MIME map to serve `.glb` as `model/gltf-binary` and `.gltf` as `model/gltf+json` |

Both use `_safe_path()`. Save/restore routes (`/pixaroma/api/3d/save`) unchanged.

---

## 8. Edge cases

| Case | Handling |
|------|----------|
| Slider drag during debounced rebuild | Debounced rebuild reads the *latest* param value when it fires — no stale queue |
| Multi-select, same type | Slider updates all selected objects |
| Multi-select, different types | Shape panel shows "Multiple types selected — pick one object" |
| Locked active object | Shape panel sliders disabled (read-only) |
| GLB with animations | Clips ignored; only first scene's meshes imported |
| OBJ with no normals | `computeVertexNormals()` generates them |
| Rebuild during undo | Old geometry `.dispose()` before replacement — no GPU leak |
| Undo/redo on imported model | Undo stack stores import path + transform/material, not mesh data; restore reloads from loader cache |
| `/pixaroma/assets/models/bunny.glb` 404 | Error toast + sphere placeholder with `type: "bunny"` still set so scene can be re-saved |
| Old save with no `seed` on Blob/Rock/Terrain | Defaults to `seed: 1` at load |
| Old save with no `studioLighting` key | Defaults to `true` at load |
| Editor opened/closed while an import upload is in flight | Upload aborts cleanly (fetch abort controller); no placeholder mesh left behind |

---

## 9. Out of scope (YAGNI)

- Particles, physics, animation playback
- Face / edge / vertex / slice editing
- Mesh booleans, mirroring, array modifiers
- Light objects in the scene (beyond key + ambient + env)
- Texture painting, UV editing, material node graph
- FBX / STL / PLY / DAE import (GLB + OBJ covers the common case; easy to add later)

---

## 10. Implementation order

Each step ends with the editor still fully working. The plan can be paused at any step.

1. **Shape registry scaffold** — create `shapes.mjs`, port the 6 existing shapes into it, rewire `_makeGeo` / `_defaultGeoParams` / `_updateShapeParams` to read from the registry. No visible change.
2. **SVG icon grid** — replace 6 unicode icons with SVG `<img>` buttons.
3. **One-click add + per-object Shape panel** — remove pre-add param panel on the left, add Shape panel on the right, wire live/debounced rebuild paths.
4. **Rendering uplift** — procedural env map, VSM shadows, AgX tone mapping, normal smoothing, Studio Lighting checkbox, shadow frustum auto-fit.
5. **Gray BG default + focus.svg + ComfyUI setting.**
6. **Add the 12 new shapes**, one category-row at a time: Prism/Pyramid → Capsule/Crystal → Tube → Ring/Gear → Terrain/Blob/Rock → Teapot. Verify each row before moving on.
7. **Bunny** — `GLTFLoader` lazy-load, wire to Bunny button, normal smoothing, cache.
8. **Import flow** — backend `model_upload` route + frontend button + loader dispatch + Material Override toggle.
9. **Thumbnail mini-renders** in layer panel for complex shapes.
10. **Save format extensions** — test save/load round-trips for each new shape and for imported models; test loading a v1 scene.

---

## 11. Verification

No automated test suite exists for this plugin. Verification is manual at each step:

- Open editor → add one of each shape → tweak sliders → save → close → reopen. Everything round-trips.
- Import one small GLB and one small OBJ. Both render with smooth normals. Material Override toggle works both ways.
- Open a scene saved with the pre-v2 editor. Loads without errors; objects keep saved positions/colors/params exactly.
- Default BG of a fresh scene is `#6e6e6e` gray.
- Drag "Sides" slider on Cylinder from 3 → 64 — no stutter (live).
- Drag "Detail" slider on Blob from 1 → 5 — no visible stutter (debounced ~60 ms).
- Save to disk with Transparent BG checkbox still produces correct transparent PNG.
- Transform gizmo, orbit controls, F/B/T/0 shortcuts, undo/redo — all unchanged.

---

*End of spec.*
