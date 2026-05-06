# Align Pixaroma — design spec

**Date:** 2026-05-05
**Status:** Approved (brainstormed)
**Type:** Frontend-only feature (no Python node, no widgets, no save/load)
**Files added:** `js/align/index.js` only

---

## 1. Goal

Add a Photoshop/Illustrator-style **smart-snap and alignment-guide** system to ComfyUI's node canvas, exposed as a single ON/OFF toggle in the top toolbar. When ON, dragging or resizing a node makes it snap to the edges and centers of nearby nodes, with a thin orange guide line drawn through aligned reference points so the user can see *what* aligned with *what*. When OFF, it costs nothing.

## 2. Why opt-in via toggle

The user wants this as a **toggleable** feature, not always-on, because:

- Some workflows (manual nudge of nodes for screenshots, fine-tuning a layout) need pixel-precise positioning without the canvas grabbing them.
- Performance unknowns on very dense graphs — opt-in lets the user pay the cost only when they're aligning.
- Discoverability: a visible toolbar button surfaces the feature better than a hidden setting.

The setting persists across ComfyUI restarts and defaults to **OFF** so first-run users don't get unexpected snap behavior.

## 3. User-facing behavior

### 3.1 Snap targets

When you drag a node, its **left**, **right**, **top**, **bottom**, **horizontal center**, and **vertical center** can each snap to the corresponding reference line on any other (non-selected, non-collapsed-into-group) node. 6 reference lines × 6 = 36 possible alignments per pair, considered per axis independently.

Resize uses the same edges, but only the corner being dragged participates as a moving edge. The opposite edges stay anchored.

### 3.2 Multi-selection drag

When multiple nodes are selected and dragged together, the **bounding box of the selection** is the moving rect. The selection moves as a rigid block; guides appear at the outer edges of the group. Each non-selected node is a snap target.

### 3.3 Snap distance

**8 screen pixels.** Measured in screen space so it stays consistent regardless of canvas zoom (computed as `8 / canvas.ds.scale` in graph space per tick). Exposed as a slider setting `Pixaroma.Align.SnapDistance` (range 4–16, default 8) for power users.

### 3.4 Visual guides

When an alignment engages, a **1 px solid line** in `#f66744` (Pixaroma BRAND) is drawn from the topmost participating edge to the bottommost (vertical guides) or analogous (horizontal guides), with a **16 px overhang** past the outermost participating rect. Drawn in graph coordinates with `lineWidth = 1 / ds.scale` so the stroke is exactly 1 screen pixel at any zoom.

Multiple simultaneous guides allowed (e.g., one X-axis match plus one Y-axis match). If three or more nodes share an edge, draw a single extended guide spanning all participating rects. Cap at 6 guides per tick as a safety valve.

No fade animation — guides appear and disappear instantly, matching Figma.

### 3.5 Alt-bypass

Holding `Alt` during a drag temporarily disables snap for that drag. Releasing Alt re-engages it. Does not change the global toggle state.

### 3.6 Toolbar button

A button using `assets/icons/ui/align-center-v.svg` is added to the ComfyUI top toolbar. Click toggles `Pixaroma.Align.Enabled`. Visual state mirrors the setting:

- **ON** — icon tinted `#f66744` (BRAND).
- **OFF** — icon in default toolbar gray.

The button is the user's primary access point. The Settings panel is the secondary access path and the persistent source of truth.

## 4. Architecture

### 4.1 File layout

```
js/align/
  index.js          # ~350-400 LOC, single file (no .mjs splits needed)
```

No new Python files. No changes to `__init__.py`, `server_routes.py`, or any other editor.

### 4.2 ComfyUI extension registration

```js
app.registerExtension({
  name: "Pixaroma.Align",
  settings: [
    {
      id: "Pixaroma.Align.Enabled",
      name: "Align Pixaroma — snap & guides",
      type: "boolean",
      defaultValue: false,
      category: ["👑 Pixaroma", "Align"],
      tooltip: "Snap nodes to others' edges and centers while dragging or resizing. Hold Alt to bypass.",
      onChange: (v) => { state.enabled = v; updateToolbarButton(); },
    },
    {
      id: "Pixaroma.Align.SnapDistance",
      name: "Snap distance (screen pixels)",
      type: "slider",
      defaultValue: 8,
      attrs: { min: 4, max: 16, step: 1 },
      category: ["👑 Pixaroma", "Align"],
      onChange: (v) => { state.snapDistPx = v; },
    },
  ],
  commands: [
    {
      id: "pixaroma.align.toggle",
      label: "Toggle Align Pixaroma",
      icon: ICON_URL,                           // or CSS class with mask-image
      function: () => toggleEnabled(),
    },
  ],
  // menuCommands / topbarButtons added at implementation time depending on
  // which API the running ComfyUI version exposes (see §4.5).
});
```

### 4.3 Module-scope state

```js
const state = {
  enabled: false,                // mirrors the Pixaroma.Align.Enabled setting
  snapDistPx: 8,                 // mirrors Pixaroma.Align.SnapDistance
  activeGuides: [],              // [{axis, value, minPerp, maxPerp}, ...]
  toolbarBtn: null,              // DOM ref for tint updates
};
```

**Initial sync** — the `onChange` handlers fire only on subsequent changes, not on extension load. At the end of `setup()` (or whichever extension lifecycle hook runs after settings are restored), explicitly read both settings into `state` so a user who had Enabled=ON across a restart gets the snap behavior immediately:

```js
state.enabled    = app.ui.settings.getSettingValue("Pixaroma.Align.Enabled");
state.snapDistPx = app.ui.settings.getSettingValue("Pixaroma.Align.SnapDistance");
updateToolbarButton();
```

### 4.4 Hook points

Two monkey-patches installed once at module load:

1. **`LGraphCanvas.prototype.processMouseMove`** — wraps the original. First line: early-return to original if `!state.enabled || e.altKey`. If a drag or resize is active, run snap math (§5), mutate the dragged node's `pos` / `size`, populate `state.activeGuides`. Then call original.
2. **`LGraphCanvas.prototype.onDrawForeground`** — chains: call original first, then if `state.activeGuides.length > 0`, draw guides on top.

A third hook on `processMouseUp` (or equivalent) clears `state.activeGuides` and calls `setDirtyCanvas(true, true)` once.

Both patches preserve the original function reference at install time and call through. If another extension also patches the same method (rgthree, mtb), the wrap-don't-replace pattern means we cooperate.

### 4.5 Toolbar button — research at implementation time

The exact API for adding to the **floating top action bar** (where rgthree's icon lives in the user's reference screenshot) varies by ComfyUI version. In priority order:

1. **Modern Vue frontend** — `app.registerExtension({ commands, menuCommands / topbarButtons })`. Many `commands` get auto-rendered as topbar icon buttons. Pass icon as URL or CSS class (mask-image pattern, same as Note Pixaroma toolbar).
2. **Fallback** — if no native topbar slot is exposed, mount a small floating DOM button to `document.body`, anchored next to the existing top toolbar via its bounding rect (with a `ResizeObserver` to reposition). Same icon, same toggle behavior.

Either way the user sees a button in roughly the same place. The Settings entry is always present as a guaranteed access path.

## 5. Snap math

Per `processMouseMove` tick (only when `state.enabled && !e.altKey && (node_dragged || resize_active)`):

```
1. Compute snapGraph = state.snapDistPx / canvas.ds.scale.

2. Build movingRect (graph space):
     - Single node drag: { left, right, top, bottom, centerX, centerY } from node.pos and node.size.
     - Multi-select drag: bounding box over all selected_nodes.
     - Resize: only the dragged corner's two edges are "moving"; opposite edges are fixed.

3. For each candidate node (= every non-selected, non-collapsed node):
     a. Cone reject: if abs distance in BOTH X and Y exceeds 2*snapGraph, skip.
     b. Build candidate's six reference lines.
     c. For each X-axis moving edge, find smallest |delta| against any candidate X-axis edge.
     d. Same for Y axis.

4. Across all candidates, pick the single closest X match (within snapGraph) and the
   single closest Y match (within snapGraph), independently.

5. If X match found:
     - Adjust pos[0] (or size[0] for resize) by deltaX.
     - Append { axis: "X", value: matchedX, minPerp, maxPerp } to activeGuides.
       minPerp/maxPerp = topmost/bottommost edges of {movingRect, matchedRect, ...co-aligned rects}.

6. Same for Y match.

7. If multiple non-selected rects share the matched value (within tiny epsilon), extend the
   guide to span all of them (single guide, not multiple).
```

**Resize edge constraints:**

| Resize handle | Moving edges (X)  | Moving edges (Y)  | Anchored edges |
|---------------|-------------------|-------------------|----------------|
| SE corner     | right, centerX    | bottom, centerY   | left, top      |
| SW corner     | left, centerX     | bottom, centerY   | right, top     |
| NE corner     | right, centerX    | top, centerY      | left, bottom   |
| NW corner     | left, centerX     | top, centerY      | right, bottom  |
| E edge        | right, centerX    | (none)            | left           |
| W edge        | left, centerX     | (none)            | right          |
| S edge        | (none)            | bottom, centerY   | top            |
| N edge        | (none)            | top, centerY      | bottom         |

Center edges are dragged-along during resize because the rect's center moves when one side moves; they remain valid snap candidates.

## 6. Rendering

Inside the patched `onDrawForeground(ctx)`:

```
ctx.save();
ctx.strokeStyle = "#f66744";
ctx.lineWidth = 1 / canvas.ds.scale;
ctx.beginPath();
for (const g of state.activeGuides.slice(0, 6)) {
  if (g.axis === "X") {
    const overhang = 16;  // graph units; appears 16 screen px at 1x zoom
    ctx.moveTo(g.value, g.minPerp - overhang);
    ctx.lineTo(g.value, g.maxPerp + overhang);
  } else { // "Y"
    ctx.moveTo(g.minPerp - 16, g.value);
    ctx.lineTo(g.maxPerp + 16, g.value);
  }
}
ctx.stroke();
ctx.restore();
```

The "16" is in graph units. At 1× zoom it appears as 16 screen px; at 2× zoom 32 screen px. For v1 we accept that — it keeps the math simple. If the overhang feels visually off at extreme zooms we can divide by `ds.scale` later.

## 7. Performance

**When OFF — true zero cost:**
- `processMouseMove` patch first line: `if (!state.enabled) return original.apply(this, arguments);`
- `onDrawForeground` patch first line: `if (!state.activeGuides.length) return;` (after calling original)
- No allocation, no event listeners attached on enable, no node iteration.

**When ON — bounded cost per tick:**
- Multi-select bounding box: O(selected), usually 1-10 nodes.
- Cone reject: O(N) cheap — 4 number comparisons per node.
- Snap math: O(survivors) — 36 distance comparisons per surviving candidate.
- For a typical 50-node graph, well under 1 ms per pointermove. For 500-node pathological graphs, the cone reject keeps survivors small.

## 8. Vue frontend compatibility

This feature touches none of the usual Vue compat traps:

- No DOM widgets on nodes (Vue Compat #11 N/A).
- No editor overlay (Vue Compat #5/6/7 N/A).
- No `nodeCreated`-time DOM widget population (Vue Compat #8 N/A).
- No hidden STRING widgets (Vue Compat #9 N/A).

**One thing to verify at implementation time:** in the Vue frontend, dragging still routes through `LGraphCanvas.prototype.processMouseMove`. If Vue has substituted a different drag handler, we need to find and patch that one instead. Pre-flight check before writing the bulk of the code: confirm `processMouseMove` is invoked when dragging a node in the user's ComfyUI version.

## 9. Out of scope (v1)

Listed so they're not silently dropped — revisit any of these in v2 if useful.

- **Socket-line snap** — snap so input/output sockets line up vertically for straight wires.
- **Distance/spacing labels** — Figma's "16 px" badges between evenly-spaced nodes.
- **Snap to canvas viewport** (center, origin, golden-section).
- **Snap to grid** — ComfyUI has its own grid + grid-snap setting; we don't reinvent.
- **Easing/animation when a snap engages** — instant, like Figma.
- **Per-axis disable** (X-only or Y-only) — both axes always.
- **Group-node-aware bounding box** — nodes inside a Group treated as individual nodes for snap purposes. The Group frame itself is a snap target like any other node.
- **Undo entry on snap-induced move** — a drag is one undo step regardless of snap.
- **Tests / parity harness** — small + visual feature; manual testing on real workflows.

## 10. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| ComfyUI Vue version doesn't expose a topbar API → button has no home. | Fallback: floating DOM button anchored next to the existing toolbar via `document.body` + `ResizeObserver`. Settings entry is always present as a guaranteed access path. |
| Vue swaps drag handler away from `LGraphCanvas.processMouseMove`. | Pre-flight check before main implementation. If swapped, find the new entry point and patch that instead — pattern is unchanged. |
| Another extension also patches `processMouseMove` and replaces (not wraps). | Document the wrap-don't-replace pattern in `js/align/index.js` header. If a third party breaks us, file an issue with them. |
| Snap math hot-path becomes slow on 500+ node graphs. | Cone reject already in design. If insufficient, add spatial index (rebuilt per drag start, not per tick). |
| User finds 8 px too eager/sluggish. | `Pixaroma.Align.SnapDistance` slider (4-16) already in design. |

## 11. Acceptance checklist

- [ ] Toolbar button appears in the top action bar (or fallback floating button) with the `align-center-v.svg` icon.
- [ ] Click toggles `Pixaroma.Align.Enabled` setting; icon tints orange when ON, gray when OFF.
- [ ] Setting survives ComfyUI restart, defaults to OFF on first install.
- [ ] When OFF, no measurable performance impact during node drag/resize.
- [ ] When ON, dragging a node within 8 screen pixels of another node's edge/center snaps it.
- [ ] When snapped, a thin orange guide line appears spanning the aligned rects with 16 px overhang.
- [ ] Snap also engages on resize (each corner handle uses the correct moving edges per §5 table).
- [ ] Multi-selection drag snaps as a bounding-box.
- [ ] Holding Alt during a drag bypasses snap for that drag.
- [ ] No regression in any other Pixaroma editor (Paint, 3D, Composer, Crop, Note, etc.).
- [ ] Verified in the Vue frontend specifically — Ctrl+Z still works, no Vue compat surprises.
