import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";

// =============================================================================
// Align Pixaroma - toggleable snap & alignment guides for the node canvas.
//
// Architecture: window-level pointermove listener does the snap math + node
// position mutation. LGraphCanvas.prototype.onDrawForeground is monkey-patched
// for guide rendering. Both early-return when disabled, so the cost when OFF
// is one boolean read per pointermove.
//
// Hook discovery (May 2026): in this ComfyUI version's Vue frontend, the
// drag handler is bound directly to a captured pointer (likely via
// _mousemove_callback bound to window during drag). Patching
// LGraphCanvas.prototype.processMouseMove had ZERO effect because that method
// is never invoked. Even the canvas DOM element doesn't see pointermove
// during drag (events are routed via setPointerCapture). The reliable hook
// is window.addEventListener("pointermove", ...) in the BUBBLE phase, so we
// run AFTER LiteGraph has applied its mouse delta to the node position.
//
// Drag detection signals (NOT node_dragged, that property is unset here):
//   - app.canvas.last_mouse_dragging === true   (LiteGraph drag flag)
//   - e.buttons & 1                              (left button held)
//   - app.canvas.selected_nodes                  (the dragged set)
//
// Toolbar button: DOM-mounted via `app.menu.settingsGroup.element.before(btn)`,
// the same pattern rgthree-comfy uses (web/comfyui/comfy_ui_bar.js).
// =============================================================================

const SETTING_ENABLED = "Pixaroma.Align.Enabled";
const SETTING_SNAP_DIST = "Pixaroma.Align.SnapDistance";

const state = {
  enabled: false,
  snapDistPx: 8,
  activeGuides: [],
  toolbarBtn: null,
  // Drag tracking. Captured on the first pointermove tick of a drag. We use
  // cumulative cursor delta from drag start to compute the "desired" node
  // position, independent of LiteGraph's tick-by-tick deltas. Snap engages
  // when desired puts an edge within snapDist of a target line.
  dragInfo: null,       // { posX, posY, cursorX, cursorY, nodeId } or null
};

const ICON_URL = "/pixaroma/assets/icons/ui/align-center-v.svg";

function toggleEnabled() {
  const s = app.ui?.settings;
  if (!s) return;
  const next = !s.getSettingValue(SETTING_ENABLED);
  s.setSettingValue(SETTING_ENABLED, next);
  // onChange handler updates state.enabled. Force toolbar tint refresh in case
  // onChange runs after this returns:
  state.enabled = next;
  updateToolbarTint();
}

function injectToolbarCSS() {
  if (document.getElementById("pixaroma-align-css")) return;
  const style = document.createElement("style");
  style.id = "pixaroma-align-css";
  style.textContent = `
    .pixaroma-align-btn .pixaroma-align-icon {
      display: inline-block;
      width: 18px;
      height: 18px;
      background-color: currentColor;
      mask-image: url(${ICON_URL});
      -webkit-mask-image: url(${ICON_URL});
      mask-size: contain;
      -webkit-mask-size: contain;
      mask-repeat: no-repeat;
      -webkit-mask-repeat: no-repeat;
      mask-position: center;
      -webkit-mask-position: center;
      pointer-events: none;
    }
    .pixaroma-align-btn:not(.pixaroma-align-on) {
      background-color: #2a2c2e !important;
      color: #ddd !important;
      border-color: #444 !important;
    }
    .pixaroma-align-btn:not(.pixaroma-align-on):hover {
      background-color: #3a3d40 !important;
    }
    .pixaroma-align-btn.pixaroma-align-on {
      background-color: ${BRAND} !important;
      color: #fff !important;
      border-color: ${BRAND} !important;
    }
    .pixaroma-align-btn.pixaroma-align-on:hover {
      background-color: ${BRAND} !important;
      filter: brightness(1.08);
    }
  `;
  document.head.appendChild(style);
}

function updateToolbarTint() {
  const btn = state.toolbarBtn;
  if (!btn) return;
  btn.classList.toggle("pixaroma-align-on", state.enabled);
}

function mountToolbarButton() {
  if (state.toolbarBtn?.isConnected) return;
  // app.menu.settingsGroup is the gear-icon group on the right side of the
  // floating top action bar. Inserting before it places our button next to
  // rgthree's logo. If app.menu isn't ready yet, retry a few times.
  const settingsGroupEl = app.menu?.settingsGroup?.element;
  if (!settingsGroupEl) {
    if (mountToolbarButton._tries == null) mountToolbarButton._tries = 0;
    if (++mountToolbarButton._tries > 20) {
      console.warn("[Pixaroma.Align] toolbar mount: app.menu.settingsGroup never appeared");
      return;
    }
    setTimeout(mountToolbarButton, 250);
    return;
  }

  injectToolbarCSS();

  const btn = document.createElement("button");
  btn.className = "comfyui-button pixaroma-align-btn";
  btn.title = "Toggle Align Pixaroma snap & alignment guides (hold Shift to bypass during drag)";
  // Keep `.comfyui-button` defaults for OFF state (matches other unfilled
  // buttons like the bookmark icon). The `.pixaroma-align-on` class swaps in
  // BRAND background + white icon when active, mirroring the Manager button.
  btn.innerHTML = `<span class="pixaroma-align-icon"></span>`;
  btn.addEventListener("click", toggleEnabled);

  // Wrap in a group element so it visually matches rgthree / native ComfyUI
  // button groups in the toolbar.
  const group = document.createElement("div");
  group.className = "comfyui-button-group pixaroma-align-group";
  group.appendChild(btn);

  settingsGroupEl.before(group);
  state.toolbarBtn = btn;
  updateToolbarTint();
}

app.registerExtension({
  name: "Pixaroma.Align",
  settings: [
    {
      id: SETTING_ENABLED,
      name: "Align Pixaroma snap & guides",
      type: "boolean",
      defaultValue: false,
      category: ["👑 Pixaroma", "Align"],
      tooltip: "Snap nodes to others' edges and centers while dragging or resizing. Hold Alt to bypass.",
      onChange: (v) => {
        state.enabled = !!v;
        updateToolbarTint();
        console.log("[Pixaroma.Align] enabled =", state.enabled);
      },
    },
    {
      id: SETTING_SNAP_DIST,
      name: "Align snap distance (screen pixels)",
      type: "slider",
      defaultValue: 8,
      attrs: { min: 4, max: 16, step: 1 },
      category: ["👑 Pixaroma", "Align (advanced)"],
      tooltip: "How close (in screen pixels) an edge must be before snap engages.",
      onChange: (v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 4 && n <= 16) state.snapDistPx = n;
      },
    },
  ],
  setup() {
    // onChange fires only on subsequent changes, so read current values now so
    // a user who had Enabled=ON across a restart gets the snap immediately.
    const s = app.ui?.settings;
    if (s) {
      state.enabled = !!s.getSettingValue(SETTING_ENABLED);
      const d = Number(s.getSettingValue(SETTING_SNAP_DIST));
      if (Number.isFinite(d) && d >= 4 && d <= 16) state.snapDistPx = d;
    }
    console.log("[Pixaroma.Align] setup: enabled=", state.enabled, "snapDist=", state.snapDistPx);
    mountToolbarButton();
    installPointerHook();
  },
});

// =============================================================================
// Drag hook - bubble-phase pointermove on window. Runs AFTER LiteGraph has
// applied the mouse delta to node.pos (so we can read the post-move position
// and apply a snap correction on top). When state.enabled is false, the
// handler does nothing on the very first line.
// =============================================================================

let _hookInstalled = false;

function installPointerHook() {
  if (_hookInstalled) return;
  window.addEventListener("pointermove", onWindowPointerMove, false);
  _hookInstalled = true;
  console.log("[Pixaroma.Align] pointer hook installed");
}

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

// Find the closest snap delta along one axis. Returns { delta, target, movingValue } or null.
// movingValues / targetValues are arrays of edge values along ONE axis.
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

function onWindowPointerMove(e) {
  if (!state.enabled) { state.dragInfo = null; return; }
  // Shift bypasses snap (Alt is taken by ComfyUI for "duplicate during drag").
  if (e.shiftKey) { state.dragInfo = null; return; }
  const c = app.canvas;
  if (!c?.last_mouse_dragging) { state.dragInfo = null; return; }
  if (!(e.buttons & 1)) { state.dragInfo = null; return; }

  const sel = c.selected_nodes;
  if (!sel) { state.dragInfo = null; return; }
  const selKeys = Object.keys(sel);
  if (selKeys.length !== 1) { state.dragInfo = null; return; }  // multi-select in Task 9
  const draggedNode = sel[selKeys[0]];
  if (!draggedNode || draggedNode.flags?.collapsed) { state.dragInfo = null; return; }

  const scale = c.ds?.scale || 1;
  const snapGraph = state.snapDistPx / scale;

  // Capture drag origin on first tick (or whenever the dragged node changes).
  // last_mouse_dragging is set for ANY drag (node move, resize, canvas pan,
  // resize of an unrelated node, etc.), so we have to confirm this is a real
  // node-move drag before applying pos correction. We do that by waiting until
  // we observe the dragged node's pos changing (LiteGraph moved it).
  if (!state.dragInfo || state.dragInfo.nodeId !== draggedNode.id) {
    state.dragInfo = {
      nodeId: draggedNode.id,
      posX: draggedNode.pos[0],
      posY: draggedNode.pos[1],
      cursorX: e.clientX,
      cursorY: e.clientY,
      sizeW: draggedNode.size[0],
      sizeH: draggedNode.size[1],
      isResize: false,
      isMove: false,
    };
    return;
  }

  // Lock to resize mode the moment we see a size change. Even if LiteGraph
  // later clamps size at minimum (so the next tick looks "size unchanged"),
  // we stay locked for the rest of this drag.
  if (!state.dragInfo.isResize) {
    if (draggedNode.size[0] !== state.dragInfo.sizeW || draggedNode.size[1] !== state.dragInfo.sizeH) {
      state.dragInfo.isResize = true;
    }
  }
  if (state.dragInfo.isResize) return;  // resize snap arrives in Task 10

  // Lock to move mode the moment we see THIS node's pos change. Without this
  // confirmation, canvas-pan drags and resizes of OTHER nodes would cause us
  // to drag the previously-selected node based on cursor delta.
  if (!state.dragInfo.isMove) {
    if (draggedNode.pos[0] !== state.dragInfo.posX || draggedNode.pos[1] !== state.dragInfo.posY) {
      state.dragInfo.isMove = true;
    }
  }
  if (!state.dragInfo.isMove) return;  // not a node-move drag

  // "Desired" position = where the cursor wants the node to be, with no snap.
  const totalDxScreen = e.clientX - state.dragInfo.cursorX;
  const totalDyScreen = e.clientY - state.dragInfo.cursorY;
  const desiredX = state.dragInfo.posX + totalDxScreen / scale;
  const desiredY = state.dragInfo.posY + totalDyScreen / scale;

  // Build moving rect at desired position (ignore LiteGraph's tick-by-tick
  // mutations; we own the final node.pos this frame).
  const w = draggedNode.size[0];
  const h = draggedNode.size[1];
  const movingRect = { x: desiredX, y: desiredY, w, h };
  const movingE = rectEdges(movingRect);
  const movingX = [movingE.left, movingE.right, movingE.centerX];
  const movingY = [movingE.top, movingE.bottom, movingE.centerY];

  const nodes = c.graph?._nodes || [];
  let bestX = null;
  let bestY = null;
  for (const other of nodes) {
    if (other === draggedNode) continue;
    if (other.flags?.collapsed) continue;
    const oRect = nodeRect(other);
    const dxc = Math.max(0, Math.max(oRect.x - (movingRect.x + movingRect.w), movingRect.x - (oRect.x + oRect.w)));
    const dyc = Math.max(0, Math.max(oRect.y - (movingRect.y + movingRect.h), movingRect.y - (oRect.y + oRect.h)));
    if (dxc > 2 * snapGraph && dyc > 2 * snapGraph) continue;
    const oE = rectEdges(oRect);
    const mx = findClosestSnap(movingX, [oE.left, oE.right, oE.centerX], snapGraph);
    if (mx && (!bestX || Math.abs(mx.delta) < Math.abs(bestX.delta))) bestX = mx;
    const my = findClosestSnap(movingY, [oE.top, oE.bottom, oE.centerY], snapGraph);
    if (my && (!bestY || Math.abs(my.delta) < Math.abs(bestY.delta))) bestY = my;
  }

  // Set node.pos directly: snap target if found, else desired position.
  // This OVERWRITES whatever LiteGraph set this tick, so the cursor and node
  // never drift apart by more than snapGraph.
  draggedNode.pos[0] = bestX ? desiredX + bestX.delta : desiredX;
  draggedNode.pos[1] = bestY ? desiredY + bestY.delta : desiredY;
  c.setDirty?.(true, true);
}
