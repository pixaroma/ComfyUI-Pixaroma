# Align Pixaroma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable Photoshop-style smart-snap + alignment-guide system to ComfyUI's node canvas, exposed as a button in the top toolbar with a 👑 Pixaroma → Align settings entry.

**Architecture:** Single frontend file `js/align/index.js` (~350-400 LOC) that monkey-patches `LGraphCanvas.prototype.processMouseMove` (snap math + node mutation) and `LGraphCanvas.prototype.onDrawForeground` (guide rendering). Settings (`Pixaroma.Align.Enabled`, `Pixaroma.Align.SnapDistance`) are the persistence source of truth; the toolbar button reads/writes the same setting. No Python, no widgets, no save/load. Default OFF — when OFF, hooks early-return on a single boolean check (zero overhead).

**Tech Stack:** Vanilla JS ES modules (ESM), ComfyUI extension API (`app.registerExtension`), LiteGraph patching, Canvas2D for guide rendering. No build step, no external dependencies.

**Spec:** [docs/superpowers/specs/2026-05-05-align-pixaroma-design.md](../specs/2026-05-05-align-pixaroma-design.md)

---

## Pre-flight notes

**No automated tests.** This project has no test framework (CLAUDE.md: "No test suite or linting configuration exists"). Each task uses **manual browser verification** in place of TDD. Verification steps are explicit — when one says "drag node A near node B's left edge", do exactly that.

**Worktree quirk.** This plan executes inside a git worktree. ComfyUI loads JS from the **main project directory**, not the worktree. After every JS change, copy the file to the main project before reloading the browser:

```bash
cp js/align/index.js D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/align/index.js
```

(Or rsync the whole `js/align/` directory.) Then **hard reload** ComfyUI (Ctrl+F5) — module cache is sticky.

**Each task ends in a local commit on the worktree branch.** Per CLAUDE.md git workflow: small focused commits, never push without explicit user request.

---

## File Structure

| File | Status | Purpose |
|------|--------|---------|
| `js/align/index.js` | **Create** | Single entry point. Extension registration (settings + commands), state, hook installation, snap math, guide rendering, toolbar button mounting. |
| `js/align/` (directory) | **Create** | New editor directory. |
| `CLAUDE.md` | **Modify** | Add `js/align/` row to the frontend directory tree (~line 90), add "Toggle alignment snap & guides" row to the "find code by task" table, document the patch-based architecture briefly. |

No other file is touched.

---

## Task 1: Skeleton + minimal extension registration

**Files:**
- Create: `js/align/index.js`

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p js/align
```

- [ ] **Step 2: Write the skeleton**

Create `js/align/index.js`:

```js
import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";

// =============================================================================
// Align Pixaroma — toggleable snap & alignment guides for the node canvas.
//
// Architecture: monkey-patches LGraphCanvas.prototype.processMouseMove (snap)
// and onDrawForeground (guide rendering). Both early-return when disabled, so
// the cost when OFF is one boolean read per mousemove.
//
// Patches WRAP, never REPLACE. We save the original at install time and call
// through. This lets us coexist with rgthree-comfy and similar extensions.
// =============================================================================

const SETTING_ENABLED = "Pixaroma.Align.Enabled";
const SETTING_SNAP_DIST = "Pixaroma.Align.SnapDistance";

const state = {
  enabled: false,
  snapDistPx: 8,
  activeGuides: [],
  toolbarBtn: null,
};

app.registerExtension({
  name: "Pixaroma.Align",
  settings: [
    {
      id: SETTING_ENABLED,
      name: "Align Pixaroma — snap & guides",
      type: "boolean",
      defaultValue: false,
      category: ["👑 Pixaroma", "Align"],
      tooltip: "Snap nodes to others' edges and centers while dragging or resizing. Hold Alt to bypass.",
      onChange: (v) => {
        state.enabled = !!v;
        console.log("[Pixaroma.Align] enabled =", state.enabled);
      },
    },
  ],
  setup() {
    console.log("[Pixaroma.Align] extension setup complete");
  },
});
```

- [ ] **Step 3: Copy to main project and hard-reload ComfyUI**

```bash
cp js/align/index.js D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/align/index.js
```

Then in browser: Ctrl+F5.

- [ ] **Step 4: Manual verification**

Open browser DevTools → Console. Expected:
- `[Pixaroma.Align] extension setup complete` appears on page load.
- Open ComfyUI Settings → search "Align" → confirm "Align Pixaroma — snap & guides" appears under 👑 Pixaroma → Align.
- Toggle it on. Console should print `[Pixaroma.Align] enabled = true`. Toggle off → `false`.

If any of these fail, do NOT proceed. Common causes: file not copied, module not reloaded (try opening DevTools → Network → check `index.js` returned 200 with new content), or ComfyUI restart needed.

- [ ] **Step 5: Commit**

```bash
git add js/align/index.js
git commit -m "feat(align): skeleton + Enabled setting"
```

---

## Task 2: Add SnapDistance slider setting

**Files:**
- Modify: `js/align/index.js`

- [ ] **Step 1: Add the second settings entry**

In `js/align/index.js`, inside the `settings: [...]` array, after the SETTING_ENABLED block:

```js
    {
      id: SETTING_SNAP_DIST,
      name: "Snap distance (screen pixels)",
      type: "slider",
      defaultValue: 8,
      attrs: { min: 4, max: 16, step: 1 },
      category: ["👑 Pixaroma", "Align"],
      tooltip: "How close (in screen pixels) an edge must be before snap engages.",
      onChange: (v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 4 && n <= 16) state.snapDistPx = n;
      },
    },
```

- [ ] **Step 2: Add initial-load sync to setup()**

Replace the `setup()` body in `js/align/index.js`:

```js
  setup() {
    // onChange fires only on subsequent changes — read current values now so
    // a user who had Enabled=ON across a restart gets the snap immediately.
    const s = app.ui?.settings;
    if (s) {
      state.enabled = !!s.getSettingValue(SETTING_ENABLED);
      const d = Number(s.getSettingValue(SETTING_SNAP_DIST));
      if (Number.isFinite(d) && d >= 4 && d <= 16) state.snapDistPx = d;
    }
    console.log("[Pixaroma.Align] setup: enabled=", state.enabled, "snapDist=", state.snapDistPx);
  },
```

- [ ] **Step 3: Copy + reload**

```bash
cp js/align/index.js D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/align/index.js
```

Ctrl+F5.

- [ ] **Step 4: Manual verification**

In ComfyUI Settings → 👑 Pixaroma → Align:
- Confirm a "Snap distance (screen pixels)" slider appears, default 8, range 4-16.
- Drag the slider to 12 → console should print updated `snapDist` once the next setup runs OR you can immediately verify by typing in console: `window.app.ui.settings.getSettingValue("Pixaroma.Align.SnapDistance")` → should return 12.
- Toggle Enabled ON, set slider to 5, refresh page (Ctrl+F5). Console line should read `setup: enabled= true snapDist= 5`.

- [ ] **Step 5: Commit**

```bash
git add js/align/index.js
git commit -m "feat(align): SnapDistance slider setting + initial-load sync"
```

---

## Task 3: Pre-flight — identify topbar button API

**Files:** None (research only)

This task is pure investigation. The API for adding a button to the floating top toolbar (where rgthree's icon lives) varies by ComfyUI version. We need to know what works in the user's version before implementing.

- [ ] **Step 1: Inspect the existing top toolbar in DevTools**

Open ComfyUI → DevTools → Elements. Find the floating top toolbar (click the rgthree icon in the user's reference screenshot to confirm location). Note the DOM structure: tag, classes, parent. Look for a class like `.comfyui-button-group`, `.action-bar`, or `.p-toolbar`.

Document findings inline:

```
Toolbar parent selector: ___________
Existing rgthree button selector: ___________
Button container class:  ___________
```

- [ ] **Step 2: Search for ComfyUI extension API in installed source**

```bash
ls D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/web/
```

Look in `web/extensions/core` or `web/scripts` for files mentioning `commands`, `topbar`, `menuCommands`, `extensionManager`. Common locations:

```bash
grep -r "topbarButton\|registerCommand\|menuCommands" D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/web/ 2>/dev/null | head -20
```

- [ ] **Step 3: Inspect rgthree-comfy's source for its actual registration call**

```bash
find D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/rgthree-comfy/ -name "*.js" | xargs grep -l "topbar\|registerCommand\|menuCommands" 2>/dev/null | head -5
```

If found, read the relevant block and copy the exact registration shape it uses.

- [ ] **Step 4: Document the chosen API**

Write a 3-line note in `js/align/index.js` (top comment) describing the path you'll take, e.g.:

```js
// Toolbar button: registered via app.registerExtension({ commands, menuCommands })
// — Vue frontend renders `commands` with an `icon` field as topbar buttons.
// Confirmed in ComfyUI version <X.Y.Z> from rgthree-comfy/src/menu.js.
```

If no native topbar slot exists, note "Fallback: floating DOM button mounted to body" and proceed to Task 4 with the fallback path.

- [ ] **Step 5: Commit the research note**

```bash
git add js/align/index.js
git commit -m "chore(align): document topbar button API choice"
```

---

## Task 4: Toolbar button (with fallback)

**Files:**
- Modify: `js/align/index.js`

- [ ] **Step 1: Add toggle helper at module scope**

Above `app.registerExtension({...})` in `js/align/index.js`:

```js
function toggleEnabled() {
  const s = app.ui?.settings;
  if (!s) return;
  const next = !s.getSettingValue(SETTING_ENABLED);
  s.setSettingValue(SETTING_ENABLED, next);
  // onChange handler updates state.enabled. Also force toolbar tint refresh
  // in case onChange runs after this returns:
  state.enabled = next;
  updateToolbarTint();
}

function updateToolbarTint() {
  const btn = state.toolbarBtn;
  if (!btn) return;
  btn.style.color = state.enabled ? BRAND : "";
  btn.classList.toggle("pixaroma-align-on", state.enabled);
}
```

- [ ] **Step 2: Pick the toolbar mount path based on Task 3 findings**

**If Task 3 found a native API** (`commands` + topbar auto-render): add to `app.registerExtension({...})`:

```js
  commands: [
    {
      id: "pixaroma.align.toggle",
      label: "Toggle Align Pixaroma snap & guides",
      icon: "/pixaroma/assets/icons/ui/align-center-v.svg",
      function: () => toggleEnabled(),
    },
  ],
  menuCommands: [
    {
      path: ["Edit"],
      commands: ["pixaroma.align.toggle"],
    },
  ],
```

After page load, find the rendered button in DOM and cache it for tint updates. Add this inside `setup()` after the initial-load read:

```js
    // Find the toolbar button DOM ref for tint updates. Defer one tick so the
    // command renderer has flushed.
    setTimeout(() => {
      state.toolbarBtn = document.querySelector('[data-command="pixaroma.align.toggle"]')
        || document.querySelector('button[title*="Align Pixaroma"]');
      updateToolbarTint();
    }, 0);
```

**If Task 3 found NO native API** (fallback path): mount a DOM button manually.

```js
function mountFallbackButton() {
  if (state.toolbarBtn) return;
  // Find an anchor near the existing toolbar (selector depends on Task 3 findings).
  const anchor = document.querySelector(".comfyui-menu, .p-toolbar, header");
  if (!anchor) {
    setTimeout(mountFallbackButton, 500);  // retry until DOM is ready
    return;
  }
  const btn = document.createElement("button");
  btn.className = "pixaroma-align-fallback-btn";
  btn.title = "Toggle Align Pixaroma snap & guides";
  btn.style.cssText = `
    width: 28px; height: 28px; padding: 4px;
    background: transparent; border: 1px solid #444; border-radius: 4px;
    cursor: pointer; margin-left: 6px;
    display: inline-flex; align-items: center; justify-content: center;
    color: #888;
  `;
  btn.innerHTML = `
    <span style="
      display:inline-block; width:18px; height:18px;
      background: currentColor;
      mask: url(/pixaroma/assets/icons/ui/align-center-v.svg) center / contain no-repeat;
      -webkit-mask: url(/pixaroma/assets/icons/ui/align-center-v.svg) center / contain no-repeat;
    "></span>
  `;
  btn.addEventListener("click", toggleEnabled);
  anchor.appendChild(btn);
  state.toolbarBtn = btn;
  updateToolbarTint();
}
```

Call `mountFallbackButton()` from `setup()` after the initial-load read (replace the native-path `setTimeout` block).

- [ ] **Step 3: Update onChange to refresh tint**

In the SETTING_ENABLED `onChange`, add `updateToolbarTint()` after `state.enabled = !!v`:

```js
      onChange: (v) => {
        state.enabled = !!v;
        updateToolbarTint();
        console.log("[Pixaroma.Align] enabled =", state.enabled);
      },
```

- [ ] **Step 4: Copy + reload**

```bash
cp js/align/index.js D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/align/index.js
```

Ctrl+F5.

- [ ] **Step 5: Manual verification**

- A button with the `align-center-v` icon appears in the top toolbar (or as a fallback floating button next to it).
- Hover shows the tooltip "Toggle Align Pixaroma snap & guides".
- Click the button → icon turns orange (`#f66744`). Click again → returns to gray.
- Open Settings → 👑 Pixaroma → Align → confirm the Enabled toggle is in sync with the button (toggle in Settings → button color updates).
- Refresh page (Ctrl+F5) with button ON → button is still orange after reload.

- [ ] **Step 6: Commit**

```bash
git add js/align/index.js
git commit -m "feat(align): toolbar button with tint sync to Enabled setting"
```

---

## Task 5: Pre-flight — verify processMouseMove is the drag entry point

**Files:** None (research only)

Vue may have replaced `LGraphCanvas.prototype.processMouseMove` with a different handler. Confirm before patching.

- [ ] **Step 1: Probe in DevTools console**

Open ComfyUI, paste in console:

```js
window.LGraphCanvas?.prototype?.processMouseMove ? "EXISTS" : "MISSING"
```

Expected: `"EXISTS"`. If `MISSING`, search for the new entry point — common alternatives are `LGraphCanvas.prototype.onMouseMove` or a Vue-hosted handler in `app.canvas`.

- [ ] **Step 2: Confirm the function fires during a drag**

Paste in console:

```js
const orig = window.LGraphCanvas.prototype.processMouseMove;
window.LGraphCanvas.prototype.processMouseMove = function(e) {
  if (this.node_dragged) console.log("[probe] drag:", this.node_dragged.title);
  return orig.apply(this, arguments);
};
```

Drag any node. Expected: `[probe] drag: <NodeName>` prints continuously while dragging. If silent, find the handler that DOES fire (search `app.canvas` for any `onMouse*` function).

- [ ] **Step 3: Restore and document findings**

Refresh page (Ctrl+F5) to undo the probe. In `js/align/index.js`, near the top file comment, add:

```js
// Drag entry point confirmed: LGraphCanvas.prototype.processMouseMove
// (this.node_dragged is set; this.canvas.ds.scale gives current zoom)
```

If a different entry point was found, document it and adjust Task 6's patch target accordingly.

- [ ] **Step 4: Commit the note**

```bash
git add js/align/index.js
git commit -m "chore(align): confirm processMouseMove as drag entry point"
```

---

## Task 6: Patch processMouseMove with disabled-pass-through

**Files:**
- Modify: `js/align/index.js`

- [ ] **Step 1: Install the patch at module load**

At the bottom of `js/align/index.js`, after `app.registerExtension({...})`:

```js
// =============================================================================
// LiteGraph patches — installed once at module load. Both patches WRAP the
// original. When state.enabled is false, they early-return to the original
// with no extra work.
// =============================================================================

(function installPatches() {
  if (typeof window.LGraphCanvas?.prototype?.processMouseMove !== "function") {
    console.warn("[Pixaroma.Align] LGraphCanvas.processMouseMove not found — snap disabled");
    return;
  }
  const origProcessMove = window.LGraphCanvas.prototype.processMouseMove;
  window.LGraphCanvas.prototype.processMouseMove = function (e) {
    if (!state.enabled || (e && e.altKey)) {
      return origProcessMove.apply(this, arguments);
    }
    // Snap math will go here (Task 7).
    return origProcessMove.apply(this, arguments);
  };
  console.log("[Pixaroma.Align] processMouseMove patched");
})();
```

- [ ] **Step 2: Copy + reload**

```bash
cp js/align/index.js D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/align/index.js
```

Ctrl+F5.

- [ ] **Step 3: Manual verification — non-regression**

The patch is a pass-through right now. Verify nothing is broken:
- Console prints `[Pixaroma.Align] processMouseMove patched` once on load.
- Drag any node → moves smoothly, exactly as before.
- Resize a node from a corner → resizes smoothly.
- Toggle Enabled ON, drag again → behavior is still identical (no snap implemented yet, this is correct).
- Drag many nodes around for ~30 seconds. No frame drops, no console errors.

- [ ] **Step 4: Commit**

```bash
git add js/align/index.js
git commit -m "feat(align): wrap processMouseMove with disabled pass-through"
```

---

## Task 7: Snap math — single-node X axis

**Files:**
- Modify: `js/align/index.js`

- [ ] **Step 1: Add helpers at module scope**

Above `installPatches()`:

```js
// Build the 6 reference lines for a graph-space rect.
function rectEdges(rect) {
  return {
    left:    rect.x,
    right:   rect.x + rect.w,
    centerX: rect.x + rect.w / 2,
    top:     rect.y,
    bottom:  rect.y + rect.h,
    centerY: rect.y + rect.h / 2,
  };
}

function nodeRect(n) {
  return { x: n.pos[0], y: n.pos[1], w: n.size[0], h: n.size[1] };
}

// Find the closest snap delta along one axis. Returns { delta, target } or null.
// `movingValues` and `targetValues` are arrays of edge values along ONE axis.
function findClosestSnap(movingValues, targetValues, threshold) {
  let best = null;
  for (const m of movingValues) {
    for (const t of targetValues) {
      const d = t - m;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) {
        best = { delta: d, target: t, movingValue: m };
      }
    }
  }
  return best;
}
```

- [ ] **Step 2: Replace the snap section in the patch**

Inside the patched `processMouseMove`, replace the line `// Snap math will go here (Task 7).` with:

```js
    const draggedNode = this.node_dragged;
    if (!draggedNode) return origProcessMove.apply(this, arguments);

    const scale = this.ds?.scale || 1;
    const snapGraph = state.snapDistPx / scale;

    const movingRect = nodeRect(draggedNode);
    const movingE = rectEdges(movingRect);
    const movingX = [movingE.left, movingE.right, movingE.centerX];

    const graph = this.graph;
    const nodes = graph?._nodes || [];

    let bestX = null;
    for (const other of nodes) {
      if (other === draggedNode) continue;
      if (other.flags?.collapsed) continue;
      const oRect = nodeRect(other);
      // Cone reject — skip if both axes are too far away.
      const dx = Math.max(0, Math.max(oRect.x - (movingRect.x + movingRect.w), movingRect.x - (oRect.x + oRect.w)));
      const dy = Math.max(0, Math.max(oRect.y - (movingRect.y + movingRect.h), movingRect.y - (oRect.y + oRect.h)));
      if (dx > 2 * snapGraph && dy > 2 * snapGraph) continue;
      const oE = rectEdges(oRect);
      const targetsX = [oE.left, oE.right, oE.centerX];
      const m = findClosestSnap(movingX, targetsX, snapGraph);
      if (m && (!bestX || Math.abs(m.delta) < Math.abs(bestX.delta))) {
        bestX = m;
      }
    }

    if (bestX) {
      draggedNode.pos[0] += bestX.delta;
      // Update the canvas's drag offset so subsequent moves don't immediately
      // unsnap. last_mouse_position is the click anchor in graph space.
      if (this.last_mouse_position) {
        this.last_mouse_position[0] += bestX.delta;
      }
    }
```

- [ ] **Step 3: Copy + reload**

```bash
cp js/align/index.js D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/align/index.js
```

Ctrl+F5.

- [ ] **Step 4: Manual verification**

- Toggle Align ON.
- Drop two arbitrary nodes (e.g., two Note Pixaroma nodes) on the canvas, side by side.
- Slowly drag node A horizontally so its left edge approaches node B's left edge (~10 px away). It should snap so the two left edges align.
- Same for right edges, and for one center vs another center.
- Vertical movement is NOT yet snapped (Y axis comes in Task 8).
- Toggle Align OFF → drag should be unrestricted again.
- Hold Alt while dragging with Align ON → no snap.

If snap "fights" you (snaps and immediately unsnaps), the `last_mouse_position` adjustment is the fix; verify it's present.

- [ ] **Step 5: Commit**

```bash
git add js/align/index.js
git commit -m "feat(align): single-node X-axis snap (left/right/centerX)"
```

---

## Task 8: Snap math — Y axis

**Files:**
- Modify: `js/align/index.js`

- [ ] **Step 1: Add Y-axis snap to the patch**

Inside the patch, after the X-axis block in `processMouseMove`, add the symmetric Y-axis logic. Modify the existing per-other-node loop to also collect Y matches; tracking is symmetric to X. Replace the entire snap section (between `if (!draggedNode)` and the existing `if (bestX)`) with:

```js
    const draggedNode = this.node_dragged;
    if (!draggedNode) return origProcessMove.apply(this, arguments);

    const scale = this.ds?.scale || 1;
    const snapGraph = state.snapDistPx / scale;

    const movingRect = nodeRect(draggedNode);
    const movingE = rectEdges(movingRect);
    const movingX = [movingE.left, movingE.right, movingE.centerX];
    const movingY = [movingE.top, movingE.bottom, movingE.centerY];

    const graph = this.graph;
    const nodes = graph?._nodes || [];

    let bestX = null;
    let bestY = null;
    for (const other of nodes) {
      if (other === draggedNode) continue;
      if (other.flags?.collapsed) continue;
      const oRect = nodeRect(other);
      const dx = Math.max(0, Math.max(oRect.x - (movingRect.x + movingRect.w), movingRect.x - (oRect.x + oRect.w)));
      const dy = Math.max(0, Math.max(oRect.y - (movingRect.y + movingRect.h), movingRect.y - (oRect.y + oRect.h)));
      if (dx > 2 * snapGraph && dy > 2 * snapGraph) continue;
      const oE = rectEdges(oRect);
      const mx = findClosestSnap(movingX, [oE.left, oE.right, oE.centerX], snapGraph);
      if (mx && (!bestX || Math.abs(mx.delta) < Math.abs(bestX.delta))) bestX = mx;
      const my = findClosestSnap(movingY, [oE.top, oE.bottom, oE.centerY], snapGraph);
      if (my && (!bestY || Math.abs(my.delta) < Math.abs(bestY.delta))) bestY = my;
    }

    if (bestX) {
      draggedNode.pos[0] += bestX.delta;
      if (this.last_mouse_position) this.last_mouse_position[0] += bestX.delta;
    }
    if (bestY) {
      draggedNode.pos[1] += bestY.delta;
      if (this.last_mouse_position) this.last_mouse_position[1] += bestY.delta;
    }
```

- [ ] **Step 2: Copy + reload**

```bash
cp js/align/index.js D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/align/index.js
```

Ctrl+F5.

- [ ] **Step 3: Manual verification**

- Drag node A vertically near node B's top or bottom edge → snap engages.
- Drag node A diagonally so it approaches both an X edge and a Y edge simultaneously → both snap independently (node ends up corner-aligned).
- Drag a node FAR from any other → no snap, smooth motion.
- Test 5+ different node pairs at varying zoom levels (use mouse wheel to zoom in/out). Snap distance should feel constant (it's screen-space).

- [ ] **Step 4: Commit**

```bash
git add js/align/index.js
git commit -m "feat(align): Y-axis snap (top/bottom/centerY)"
```

---

## Task 9: Multi-selection bounding-box snap

**Files:**
- Modify: `js/align/index.js`

- [ ] **Step 1: Add bounding-box helper**

Above `installPatches()`:

```js
function selectionBBox(canvas) {
  const sel = canvas.selected_nodes;
  if (!sel) return null;
  const ids = Object.keys(sel);
  if (ids.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) {
    const n = sel[id];
    if (!n || n.flags?.collapsed) continue;
    minX = Math.min(minX, n.pos[0]);
    minY = Math.min(minY, n.pos[1]);
    maxX = Math.max(maxX, n.pos[0] + n.size[0]);
    maxY = Math.max(maxY, n.pos[1] + n.size[1]);
  }
  if (!isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, ids: new Set(ids) };
}
```

- [ ] **Step 2: Use bbox when multiple selected**

In the patch, change how `movingRect` is computed and how the dragged node is moved. Replace the snap section with this version that handles both single and multi-select:

```js
    const draggedNode = this.node_dragged;
    if (!draggedNode) return origProcessMove.apply(this, arguments);

    const scale = this.ds?.scale || 1;
    const snapGraph = state.snapDistPx / scale;

    const bbox = selectionBBox(this);
    const isMulti = bbox && bbox.ids.size > 1 && bbox.ids.has(String(draggedNode.id));
    const movingRect = isMulti ? bbox : nodeRect(draggedNode);
    const movingE = rectEdges(movingRect);
    const movingX = [movingE.left, movingE.right, movingE.centerX];
    const movingY = [movingE.top, movingE.bottom, movingE.centerY];

    const graph = this.graph;
    const nodes = graph?._nodes || [];
    const skipIds = isMulti ? bbox.ids : new Set([String(draggedNode.id)]);

    let bestX = null;
    let bestY = null;
    for (const other of nodes) {
      if (skipIds.has(String(other.id))) continue;
      if (other.flags?.collapsed) continue;
      const oRect = nodeRect(other);
      const dx = Math.max(0, Math.max(oRect.x - (movingRect.x + movingRect.w), movingRect.x - (oRect.x + oRect.w)));
      const dy = Math.max(0, Math.max(oRect.y - (movingRect.y + movingRect.h), movingRect.y - (oRect.y + oRect.h)));
      if (dx > 2 * snapGraph && dy > 2 * snapGraph) continue;
      const oE = rectEdges(oRect);
      const mx = findClosestSnap(movingX, [oE.left, oE.right, oE.centerX], snapGraph);
      if (mx && (!bestX || Math.abs(mx.delta) < Math.abs(bestX.delta))) bestX = mx;
      const my = findClosestSnap(movingY, [oE.top, oE.bottom, oE.centerY], snapGraph);
      if (my && (!bestY || Math.abs(my.delta) < Math.abs(bestY.delta))) bestY = my;
    }

    if (bestX || bestY) {
      const dx = bestX ? bestX.delta : 0;
      const dy = bestY ? bestY.delta : 0;
      if (isMulti) {
        // Move every selected node by the same delta so the group stays rigid.
        for (const id of bbox.ids) {
          const n = this.selected_nodes[id];
          if (!n) continue;
          n.pos[0] += dx;
          n.pos[1] += dy;
        }
      } else {
        draggedNode.pos[0] += dx;
        draggedNode.pos[1] += dy;
      }
      if (this.last_mouse_position) {
        this.last_mouse_position[0] += dx;
        this.last_mouse_position[1] += dy;
      }
    }
```

- [ ] **Step 3: Copy + reload**

```bash
cp js/align/index.js D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/align/index.js
```

Ctrl+F5.

- [ ] **Step 4: Manual verification**

- Drop 3+ nodes. Shift-click two of them to multi-select.
- Drag the selection as a group. The whole group should snap as a single bounding box against the third (unselected) node.
- Selected nodes do NOT snap to each other (the loop skips them via `skipIds`).
- Single-node drag still works as before.

- [ ] **Step 5: Commit**

```bash
git add js/align/index.js
git commit -m "feat(align): multi-selection bounding-box snap"
```

---

## Task 10: Resize snap

**Files:**
- Modify: `js/align/index.js`

- [ ] **Step 1: Detect resize state**

LiteGraph sets `this.resizing_node` (or similar) when a node is being resized. Confirm the exact property name with a quick console probe:

```js
// in DevTools console, while resizing a node:
console.log(window.app.canvas.resizing_node, window.app.canvas.node_dragged);
```

If `resizing_node` is set during resize and `node_dragged` is null, use that. (If LiteGraph in this version uses a different name, search `LGraphCanvas.prototype` for resize handling — common names are `resizing_node`, `node_being_resized`.) Document the actual property in a code comment.

- [ ] **Step 2: Branch the patch on resize vs drag**

For LiteGraph in current ComfyUI versions, the resize handle is the SE corner only (the bottom-right grip). For v1 we keep moving edges to **right** + **bottom** — center edges are intentionally excluded because anchoring left/top means centerX moving by `delta` would require right to grow by `2*delta`, which is an extra rule with little user value. Edge-to-edge alignment is what the user actually wants from "make this node the same width as that one".

Inside `processMouseMove`, add a resize branch above the drag branch (insert after the `if (!state.enabled || altKey) return origProcessMove(...)` early-return):

```js
    const resizingNode = this.resizing_node;  // confirm property name from Step 1
    if (resizingNode) {
      const scale = this.ds?.scale || 1;
      const snapGraph = state.snapDistPx / scale;
      const r = nodeRect(resizingNode);
      const e = rectEdges(r);
      const movingX = [e.right];   // SE corner: only right edge moves
      const movingY = [e.bottom];  // SE corner: only bottom edge moves
      const nodes = this.graph?._nodes || [];
      let bestX = null, bestXRect = null;
      let bestY = null, bestYRect = null;
      for (const other of nodes) {
        if (other === resizingNode) continue;
        if (other.flags?.collapsed) continue;
        const oR = nodeRect(other);
        const dx = Math.max(0, Math.max(oR.x - (r.x + r.w), r.x - (oR.x + oR.w)));
        const dy = Math.max(0, Math.max(oR.y - (r.y + r.h), r.y - (oR.y + oR.h)));
        if (dx > 2 * snapGraph && dy > 2 * snapGraph) continue;
        const oE = rectEdges(oR);
        const mx = findClosestSnap(movingX, [oE.left, oE.right, oE.centerX], snapGraph);
        if (mx && (!bestX || Math.abs(mx.delta) < Math.abs(bestX.delta))) {
          bestX = mx; bestXRect = oR;
        }
        const my = findClosestSnap(movingY, [oE.top, oE.bottom, oE.centerY], snapGraph);
        if (my && (!bestY || Math.abs(my.delta) < Math.abs(bestY.delta))) {
          bestY = my; bestYRect = oR;
        }
      }
      // SE corner: left/top anchored, so right-edge snap grows size[0] by delta.
      if (bestX) resizingNode.size[0] += bestX.delta;
      if (bestY) resizingNode.size[1] += bestY.delta;

      // Push guides (resize uses simple 2-rect range; extended guides land in Task 13).
      state.activeGuides = [];
      if (bestX && bestXRect) {
        const minY = Math.min(r.y, bestXRect.y);
        const maxY = Math.max(r.y + r.h, bestXRect.y + bestXRect.h);
        pushGuide("X", bestX.target, [minY, maxY]);
      }
      if (bestY && bestYRect) {
        const minX = Math.min(r.x, bestYRect.x);
        const maxX = Math.max(r.x + r.w, bestYRect.x + bestYRect.w);
        pushGuide("Y", bestY.target, [minX, maxX]);
      }
      this.setDirty?.(true, true);
      return origProcessMove.apply(this, arguments);
    }
```

Note: this references `pushGuide` and `state.activeGuides` which are introduced in Task 11. The resize branch's guide push will be a silent no-op until Task 11 defines `pushGuide` (the function call will throw a ReferenceError). To avoid breaking the build between tasks, **skip the `state.activeGuides = []; if (bestX...) pushGuide(...); ...` block in this task** — leave just the size mutations and `return origProcessMove.apply(this, arguments)`. Add the guide-push back in Task 11 Step 2.

Concretely, for THIS task only, the resize branch ends at:

```js
      if (bestX) resizingNode.size[0] += bestX.delta;
      if (bestY) resizingNode.size[1] += bestY.delta;
      return origProcessMove.apply(this, arguments);
    }
```

- [ ] **Step 3: Copy + reload**

```bash
cp js/align/index.js D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/align/index.js
```

Ctrl+F5.

- [ ] **Step 4: Manual verification**

- With Align ON, place node A above node B.
- Resize node A's bottom-right corner so its right edge approaches node B's right edge → snap.
- Same for bottom edge against bottom edge.
- Resize FAR from any node → unrestricted.
- Toggle OFF → resize unrestricted.
- Hold Alt during resize → no snap.

If LiteGraph in this version exposes only a single resize corner, the SE-only handling is fine; document any deviation.

- [ ] **Step 5: Commit**

```bash
git add js/align/index.js
git commit -m "feat(align): resize snap (SE corner — right/bottom edges)"
```

---

## Task 11: Active-guides bookkeeping

**Files:**
- Modify: `js/align/index.js`

- [ ] **Step 1: Populate state.activeGuides during snap**

Add a helper above `installPatches()`:

```js
// Record a guide for later rendering. axis = "X" or "Y". value is the snap
// line position in graph space. perpRange is [minPerp, maxPerp] of the rects
// being aligned (perp = the OTHER axis).
function pushGuide(axis, value, perpRange) {
  if (state.activeGuides.length >= 6) return;
  state.activeGuides.push({ axis, value, minPerp: perpRange[0], maxPerp: perpRange[1] });
}

function clearGuides(canvas) {
  if (!state.activeGuides.length) return;
  state.activeGuides = [];
  canvas?.setDirty?.(true, true);
}
```

- [ ] **Step 2: Track matched rects + push guides in the drag branch**

The snap loop currently only tracks `bestX` / `bestY` deltas. To draw a guide accurately, we also need the **rect** that produced each match (so the guide line spans both rects, not just the moving rect doubled).

In the DRAG branch (the multi-select-aware version from Task 9), modify the bookkeeping:

1. Replace `let bestX = null; let bestY = null;` with:

```js
    let bestX = null, bestXRect = null;
    let bestY = null, bestYRect = null;
```

2. Inside the per-`other` loop, when updating `bestX` / `bestY`, also capture the rect:

```js
      const mx = findClosestSnap(movingX, [oE.left, oE.right, oE.centerX], snapGraph);
      if (mx && (!bestX || Math.abs(mx.delta) < Math.abs(bestX.delta))) {
        bestX = mx; bestXRect = oRect;
      }
      const my = findClosestSnap(movingY, [oE.top, oE.bottom, oE.centerY], snapGraph);
      if (my && (!bestY || Math.abs(my.delta) < Math.abs(bestY.delta))) {
        bestY = my; bestYRect = oRect;
      }
```

3. After the existing `if (bestX || bestY) { ... mutation ... }` block, append the guide-push:

```js
      state.activeGuides = [];
      if (bestX && bestXRect) {
        const minY = Math.min(movingRect.y, bestXRect.y);
        const maxY = Math.max(movingRect.y + movingRect.h, bestXRect.y + bestXRect.h);
        pushGuide("X", bestX.target, [minY, maxY]);
      }
      if (bestY && bestYRect) {
        const minX = Math.min(movingRect.x, bestYRect.x);
        const maxX = Math.max(movingRect.x + movingRect.w, bestYRect.x + bestYRect.w);
        pushGuide("Y", bestY.target, [minX, maxX]);
      }
```

4. In the RESIZE branch (Task 10), un-comment / re-enable the equivalent guide-push that was held back. Replace the resize branch's tail:

```js
      if (bestX) resizingNode.size[0] += bestX.delta;
      if (bestY) resizingNode.size[1] += bestY.delta;
      return origProcessMove.apply(this, arguments);
    }
```

with:

```js
      if (bestX) resizingNode.size[0] += bestX.delta;
      if (bestY) resizingNode.size[1] += bestY.delta;

      state.activeGuides = [];
      if (bestX && bestXRect) {
        const minY = Math.min(r.y, bestXRect.y);
        const maxY = Math.max(r.y + r.h, bestXRect.y + bestXRect.h);
        pushGuide("X", bestX.target, [minY, maxY]);
      }
      if (bestY && bestYRect) {
        const minX = Math.min(r.x, bestYRect.x);
        const maxX = Math.max(r.x + r.w, bestYRect.x + bestYRect.w);
        pushGuide("Y", bestY.target, [minX, maxX]);
      }
      return origProcessMove.apply(this, arguments);
    }
```

(`bestXRect` / `bestYRect` are already captured in the resize branch from Task 10's loop.)

- [ ] **Step 3: Clear guides on pointer-up**

Patch `processMouseUp` similarly. After `installPatches()`'s contents:

```js
  if (typeof window.LGraphCanvas?.prototype?.processMouseUp === "function") {
    const origUp = window.LGraphCanvas.prototype.processMouseUp;
    window.LGraphCanvas.prototype.processMouseUp = function () {
      const ret = origUp.apply(this, arguments);
      clearGuides(this);
      return ret;
    };
  }
```

(Place this inside the same `installPatches()` IIFE.)

- [ ] **Step 4: Copy + reload**

```bash
cp js/align/index.js D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/align/index.js
```

Ctrl+F5.

- [ ] **Step 5: Manual verification**

No visual change yet (rendering comes in Task 12), but verify in console:

Add a temporary `window.__pixAlignState = state;` line at the bottom of `index.js`, copy + reload, then in DevTools console run:

```js
setInterval(() => console.log("guides:", window.__pixAlignState.activeGuides.length), 250);
```

Confirm:
- While dragging a node into snap range with Align ON: count is 1 or 2.
- After releasing the mouse: count returns to 0.
- Toggle Align OFF: count stays at 0 during drag.

Stop the interval (refresh page), remove the `window.__pixAlignState = state;` line before committing.

- [ ] **Step 6: Commit**

```bash
git add js/align/index.js
git commit -m "feat(align): track active guides + clear on pointerup"
```

---

## Task 12: Render guides in onDrawForeground

**Files:**
- Modify: `js/align/index.js`

- [ ] **Step 1: Patch onDrawForeground inside installPatches()**

Append to the IIFE in `installPatches()`:

```js
  if (typeof window.LGraphCanvas?.prototype?.onDrawForeground === "function") {
    const origDraw = window.LGraphCanvas.prototype.onDrawForeground;
    window.LGraphCanvas.prototype.onDrawForeground = function (ctx) {
      origDraw.apply(this, arguments);
      if (!state.activeGuides.length) return;
      const scale = this.ds?.scale || 1;
      const overhang = 16;  // graph units
      ctx.save();
      ctx.strokeStyle = BRAND;
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      for (const g of state.activeGuides.slice(0, 6)) {
        if (g.axis === "X") {
          ctx.moveTo(g.value, g.minPerp - overhang);
          ctx.lineTo(g.value, g.maxPerp + overhang);
        } else {
          ctx.moveTo(g.minPerp - overhang, g.value);
          ctx.lineTo(g.maxPerp + overhang, g.value);
        }
      }
      ctx.stroke();
      ctx.restore();
    };
  } else {
    console.warn("[Pixaroma.Align] onDrawForeground not found — guides won't render");
  }
```

- [ ] **Step 2: Force a canvas redraw on snap so guides appear immediately**

In the drag branch, after pushing guides, add:

```js
      this.setDirty?.(true, true);
```

(Same for resize branch.)

- [ ] **Step 3: Copy + reload**

```bash
cp js/align/index.js D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/align/index.js
```

Ctrl+F5.

- [ ] **Step 4: Manual verification**

- With Align ON, drag node A near node B's left edge → solid orange line appears, spanning from above the topmost rect to below the bottommost, with ~16 px of overhang.
- Diagonal snap → both X and Y guides appear.
- Release mouse → guides vanish instantly.
- Zoom in to 200% → guide stays exactly 1 screen pixel thick.
- Zoom out to 50% → still 1 px.
- Hold Alt during drag → no guides (snap is bypassed, so no guides should be pushed).

- [ ] **Step 5: Commit**

```bash
git add js/align/index.js
git commit -m "feat(align): render orange guide lines via onDrawForeground"
```

---

## Task 13: Extended guides for 3+ shared edges

**Files:**
- Modify: `js/align/index.js`

- [ ] **Step 1: Extend perp range over all rects sharing the matched value**

Inside the drag branch, replace the `if (bestX && bestXRect)` block with a version that scans all candidates for shared X values:

```js
      state.activeGuides = [];
      const EPS = 0.5;  // graph units — "same edge" tolerance
      if (bestX && bestXRect) {
        let minY = Math.min(movingRect.y, bestXRect.y);
        let maxY = Math.max(movingRect.y + movingRect.h, bestXRect.y + bestXRect.h);
        for (const other of nodes) {
          if (skipIds.has(String(other.id)) || other === bestXRect) continue;
          if (other.flags?.collapsed) continue;
          const oR = nodeRect(other);
          const oE = rectEdges(oR);
          if (Math.abs(oE.left - bestX.target) < EPS ||
              Math.abs(oE.right - bestX.target) < EPS ||
              Math.abs(oE.centerX - bestX.target) < EPS) {
            minY = Math.min(minY, oR.y);
            maxY = Math.max(maxY, oR.y + oR.h);
          }
        }
        pushGuide("X", bestX.target, [minY, maxY]);
      }
      if (bestY && bestYRect) {
        let minX = Math.min(movingRect.x, bestYRect.x);
        let maxX = Math.max(movingRect.x + movingRect.w, bestYRect.x + bestYRect.w);
        for (const other of nodes) {
          if (skipIds.has(String(other.id)) || other === bestYRect) continue;
          if (other.flags?.collapsed) continue;
          const oR = nodeRect(other);
          const oE = rectEdges(oR);
          if (Math.abs(oE.top - bestY.target) < EPS ||
              Math.abs(oE.bottom - bestY.target) < EPS ||
              Math.abs(oE.centerY - bestY.target) < EPS) {
            minX = Math.min(minX, oR.x);
            maxX = Math.max(maxX, oR.x + oR.w);
          }
        }
        pushGuide("Y", bestY.target, [minX, maxX]);
      }
      this.setDirty?.(true, true);
```

(Same scan logic in the resize branch — for v1 the resize branch can keep the simpler 2-rect version since extended guides matter most when arranging columns.)

- [ ] **Step 2: Copy + reload**

```bash
cp js/align/index.js D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/align/index.js
```

Ctrl+F5.

- [ ] **Step 3: Manual verification**

- Place 3 nodes vertically with the same left edge X coordinate: e.g., A at (100,50), B at (100,200), C at (100,350).
- Drag a 4th node D so its left edge approaches X=100.
- The orange guide line should span from above A to below C (the full column), not just D-to-A.
- Same test with horizontal alignment (3 nodes sharing top edge) → horizontal guide spans the full row.

- [ ] **Step 4: Commit**

```bash
git add js/align/index.js
git commit -m "feat(align): extend guide line over all rects sharing the snap edge"
```

---

## Task 14: Cooperate with rgthree-like extensions (smoke test)

**Files:** None (verification only)

- [ ] **Step 1: Confirm rgthree-comfy is installed**

```bash
ls D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ | grep -i rgthree
```

If not installed, skip this task. Note "rgthree not present in this environment" in the commit message at the end.

- [ ] **Step 2: Manual verification — both extensions live**

With both Pixaroma.Align and rgthree-comfy enabled:
- Toggle Align ON → snap works.
- Click rgthree's bookmark icon → its menu still opens.
- Drag a node with both extensions active → no console errors, snap engages, rgthree behaviors (e.g., its drag-to-reroute) still function.
- If rgthree provides any drag-aware feature, exercise it once to confirm no conflict.

If a conflict surfaces, document it in a code comment near `installPatches()` and consider whether the wrap pattern needs adjustment (e.g., installing the patch later via `setTimeout(installPatches, 1000)` so other extensions install first).

- [ ] **Step 3: Commit a brief note** (only if any change was needed)

If no changes needed, skip the commit.

```bash
git commit --allow-empty -m "test(align): verified coexistence with rgthree-comfy"
```

---

## Task 15: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the new editor to the frontend directory tree**

Find the `## Architecture` → `### Frontend Directory Structure` section in `CLAUDE.md`. Find the `js/` tree (under "directory-per-editor modules"). Insert a new entry alphabetically between `audio_studio/` and `compare/` (or wherever fits the existing alphabetical order — match the surrounding style):

```
├── align/              # Align Pixaroma — toggleable snap & alignment guides
│   └── index.js        # Single file (~350 LOC). Patches LGraphCanvas
│                       #  processMouseMove (snap math), onDrawForeground
│                       #  (orange BRAND guide lines), processMouseUp (clear).
│                       #  Toolbar button + 👑 Pixaroma → Align settings.
│                       #  No Python, no widgets, no save/load. Default OFF;
│                       #  early-return on disabled = zero cost.
```

- [ ] **Step 2: Add the project-overview line**

Find the "## Project Overview" section. After `Image Crop accepts upstream IMAGE input`, ComfyUI-Pixaroma also adds the editors section. Append " Align Pixaroma — toggleable canvas snap & alignment guides" to the editor list in the first paragraph.

- [ ] **Step 3: Add a row to the "find code by task" table**

Find the `## Token-Saving Rules` → `### 2. Use the file names to find code` table. Add this row alphabetically (after the alignment-related rows or at end):

```
| Toggle / change Align Pixaroma snap behavior | `js/align/index.js` (single file). Settings: `Pixaroma.Align.Enabled` (boolean) + `Pixaroma.Align.SnapDistance` (slider 4-16). Patches `LGraphCanvas.prototype.processMouseMove` for snap, `onDrawForeground` for guide rendering, `processMouseUp` for cleanup. WRAP-don't-replace pattern — coexists with rgthree-comfy. Active guides drawn in BRAND `#f66744` with `lineWidth = 1 / scale` so stroke is exactly 1 screen pixel at any zoom. |
```

- [ ] **Step 4: Add an "Align Pixaroma Patterns" section**

Find the existing "### Note Pixaroma Patterns" or "### Preview Image Pixaroma Patterns" sections. After one of them, add:

```
### Align Pixaroma Patterns (do not regress)

1. **Hooks WRAP, never REPLACE.** All three patches (`processMouseMove`, `onDrawForeground`, `processMouseUp`) save the original at install time and call through. Replacing breaks every other extension that also patches LiteGraph (rgthree-comfy, comfyui-mtb, etc.). If you're tempted to replace because "it's cleaner", you're about to break a user's workflow.

2. **`state.enabled` early-return is the perf contract.** First line of every patch: `if (!state.enabled) return original.apply(this, arguments)`. No allocation, no node iteration, no math. The "default OFF, zero cost" promise depends on this. Don't add work above the guard.

3. **`last_mouse_position` adjustment is mandatory after pos mutation.** When snap moves a node, the click-anchor must move with it; otherwise the next mousemove tick computes a new position from the un-shifted anchor and immediately UN-snaps. The result is jitter. If you ever change the snap-mutation block, keep the `this.last_mouse_position[0/1] += delta` lines or snap will visibly fight the mouse.

4. **Snap distance is computed in graph space PER TICK.** `snapGraph = state.snapDistPx / canvas.ds.scale`. Don't cache this — the user can mouse-wheel to zoom mid-drag and the threshold needs to follow.

5. **Cone reject is the only thing keeping this fast on dense graphs.** `if (dx > 2*snapGraph && dy > 2*snapGraph) continue;` skips the 36-distance-comparison block for any candidate that's nowhere near the moving rect on either axis. Removing this turns a 500-node graph into a slideshow during drag.

6. **Settings are the source of truth, button is a mirror.** Both the toolbar button and the Settings entry write to `Pixaroma.Align.Enabled`. The Settings `onChange` updates `state.enabled` AND calls `updateToolbarTint()` so the icon stays in sync regardless of where the toggle came from. Add a third entry point (e.g., a keyboard shortcut)? It MUST go through `toggleEnabled()`, not flip `state.enabled` directly.

7. **Multi-select uses bbox, but selection ids are stringified everywhere.** LiteGraph keys `selected_nodes` by stringified id; `node.id` itself can be number or string depending on LiteGraph version. Always `String(node.id)` when comparing against the selected_nodes keys / skipIds set, or you'll get false negatives that let the dragged node "snap to itself" via a sibling.
```

- [ ] **Step 5: Manual verification**

Re-read the three CLAUDE.md edits. Confirm:
- The `js/align/` tree entry uses 4-space indentation matching surrounding entries.
- The find-code-by-task row preserves the table format (no broken `|`).
- The patterns section uses the same heading depth (`###`) and numbered-list format as the others.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): document Align Pixaroma editor + patterns"
```

---

## Task 16: Final smoke test

**Files:** None

- [ ] **Step 1: Cold start with Enabled=OFF (default)**

Restart ComfyUI completely. Hard-reload the browser. Open a sample workflow.
- Drag nodes — completely unrestricted, no snap, no guides.
- No console errors, no console spam.

- [ ] **Step 2: Enable and exercise everything**

Toggle Align ON via the toolbar button.
- Single-node drag → snaps on edges/centers.
- Multi-select drag (2+ nodes) → snaps as bounding box.
- Resize SE corner → snaps on right + bottom edges.
- Hold Alt during any of the above → bypass works.
- Zoom in to 300%, then out to 30% — snap distance feels constant.
- 3 vertically aligned nodes + drag a 4th to the column → extended guide spans full column.

- [ ] **Step 3: Cross-editor regression check**

While Align is ON, open each of the Pixaroma editors at least once:
- Note Pixaroma → edit a note → confirm Ctrl+Z still works inside the editor.
- 3D Builder → open the editor → confirm objects render.
- Image Composer → open → confirm layers render.
- Paint Studio → open → confirm brush still works.
- Image Crop → open → confirm crop handles work.

If any editor breaks, the patches are interfering — open an issue, document the editor name + what broke, and fix before declaring done.

- [ ] **Step 4: Persistence check**

Toggle Align ON. Set SnapDistance to 12. Restart ComfyUI. Reload browser.
- Toolbar button is orange immediately on load.
- Console line `setup: enabled= true snapDist= 12`.
- Snap engages from 12 px away, not 8.

- [ ] **Step 5: No regression in workflow loading**

Open a complex workflow (any saved one with 20+ nodes). Drag a few nodes around. No console errors. Save the workflow. Close and re-open. Nodes are still where you left them.

- [ ] **Step 6: Final commit (only if any cleanup was needed)**

If everything passed without changes, skip. Otherwise:

```bash
git add -A
git commit -m "fix(align): smoke-test cleanup"
```

---

## Self-Review

Spec coverage check:

| Spec section | Implemented in |
|--------------|----------------|
| §3.1 Snap targets (6 reference lines × 6) | Tasks 7, 8 (`rectEdges` + `findClosestSnap`) |
| §3.2 Multi-select bounding box | Task 9 |
| §3.3 8 px screen-space threshold | Tasks 2, 7 (`state.snapDistPx / scale`) |
| §3.4 1 px orange guides w/ 16 px overhang | Task 12 (lineWidth = 1/scale, overhang in graph units) |
| §3.5 Alt-bypass | Task 6 (`e.altKey` early-return) |
| §3.6 Toolbar button + tint mirror | Tasks 3, 4 |
| §4.1 Single file `js/align/index.js` | Task 1 (and all subsequent edits) |
| §4.2 Settings registration | Tasks 1, 2 |
| §4.3 State + initial-load sync | Task 2 |
| §4.4 Three patches (move/draw/up) | Tasks 6, 11, 12 |
| §4.5 Topbar button research | Task 3 |
| §5 Snap math (cone reject, both axes, resize edge table) | Tasks 7, 8, 9, 10 |
| §6 Render block | Task 12 |
| §7 Performance (zero-cost OFF) | Tasks 6, 7 (early-return + cone reject) |
| §8 Vue compat (verify processMouseMove fires) | Task 5 |
| §10 Risks: rgthree coexistence | Task 14 |
| §11 Acceptance checklist | Task 16 |

No spec section is unimplemented. No "TBD" / "TODO" / "later" placeholders remain. Type/property names are consistent across tasks (`state`, `nodeRect`, `rectEdges`, `findClosestSnap`, `selectionBBox`, `pushGuide`, `clearGuides`, `installPatches`, `updateToolbarTint`, `toggleEnabled`).
