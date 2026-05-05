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
  // Reset drag state on every release. Without this, a release-then-click
  // sequence with no intervening pointermove leaves stale dragInfo (with
  // its old lockType) attached to the next drag, breaking classification.
  const _reset = () => { state.dragInfo = null; state._prevNodeStates = null; };
  window.addEventListener("pointerup", _reset, false);
  window.addEventListener("pointercancel", _reset, false);
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
  // In LiteGraph, node.pos[1] is the top of the BODY (below the title bar),
  // and node.size[1] is the body height. The title sits at pos[1] - titleH.
  // For snap to align with the visual top edge of the node, include the
  // title bar in the rect. Collapsed nodes have no body, just title.
  const titleH = (n.flags?.collapsed) ? 0 : (window.LiteGraph?.NODE_TITLE_HEIGHT || 30);
  return {
    x: n.pos[0],
    y: n.pos[1] - titleH,
    w: n.size[0],
    h: n.size[1] + titleH,
  };
}

// Find the closest snap delta along one axis. Returns { delta, target, movingValue } or null.
// movingValues / targetValues are arrays of edge values along ONE axis.
// Hysteresis: a target equal to `stickyTarget` (the one we were snapped to last
// tick) gets a wider `stickyThreshold` so small cursor jitter doesn't disengage.
function findClosestSnap(movingValues, targetValues, threshold, stickyTarget, stickyThreshold) {
  let best = null;
  const sT = stickyThreshold == null ? threshold : stickyThreshold;
  for (const m of movingValues) {
    for (const t of targetValues) {
      const d = t - m;
      const allowed = (stickyTarget != null && Math.abs(t - stickyTarget) < 0.01) ? sT : threshold;
      if (Math.abs(d) <= allowed && (!best || Math.abs(d) < Math.abs(best.delta))) {
        best = { delta: d, target: t, movingValue: m };
      }
    }
  }
  return best;
}

function onWindowPointerMove(e) {
  if (!state.enabled) { state.dragInfo = null; state._prevNodeStates = null; return; }
  // Shift bypasses snap (Alt is taken by ComfyUI for "duplicate during drag").
  if (e.shiftKey) { state.dragInfo = null; state._prevNodeStates = null; return; }
  const c = app.canvas;
  if (!c?.last_mouse_dragging) { state.dragInfo = null; state._prevNodeStates = null; return; }
  if (!(e.buttons & 1)) { state.dragInfo = null; state._prevNodeStates = null; return; }

  // Find the dragged/resized node. The MOST reliable signal is "which node
  // did LiteGraph just modify this tick?" - found by comparing pos/size to
  // the previous-tick cache. We try that first because selected_nodes can
  // point to the wrong node (e.g. user has node B selected but is resizing
  // an unselected node A; the resize handle click doesn't update selection).
  let draggedNode = null;
  if (state._prevNodeStates && c.graph?._nodes) {
    for (const n of c.graph._nodes) {
      const p = state._prevNodeStates.get(n.id);
      if (p && (p.x !== n.pos[0] || p.y !== n.pos[1] || p.w !== n.size[0] || p.h !== n.size[1])) {
        draggedNode = n;
        break;
      }
    }
  }
  // Fallbacks for the first tick (no cache yet) or for very-slow drags
  // where no measurable change happened this tick.
  if (!draggedNode) {
    const sel = c.selected_nodes;
    const selKeys = sel ? Object.keys(sel) : [];
    if (selKeys.length === 1) {
      draggedNode = sel[selKeys[0]];
    } else if (selKeys.length > 1) {
      // multi-select handled in Task 9
      state.dragInfo = null;
      state._prevNodeStates = null;
      return;
    } else if (c.node_over) {
      draggedNode = c.node_over;
    } else if (c.graph?.getNodeOnPos && c.graph_mouse) {
      draggedNode = c.graph.getNodeOnPos(c.graph_mouse[0], c.graph_mouse[1]);
    }
  }
  // Refresh the per-node cache for next tick BEFORE we possibly bail.
  if (c.graph?._nodes) {
    if (!state._prevNodeStates) state._prevNodeStates = new Map();
    state._prevNodeStates.clear();
    for (const n of c.graph._nodes) {
      state._prevNodeStates.set(n.id, { x: n.pos[0], y: n.pos[1], w: n.size[0], h: n.size[1] });
    }
  }
  if (!draggedNode || draggedNode.flags?.collapsed) { state.dragInfo = null; return; }

  const scale = c.ds?.scale || 1;
  const snapGraph = state.snapDistPx / scale;

  // Capture drag origin on first tick (or whenever the dragged node changes).
  // last_mouse_dragging is set for ANY drag (node move, resize, canvas pan,
  // resize of an unrelated node, etc.). We have to classify the drag before
  // applying any correction. Classification:
  //   - "move":   pos changed, size unchanged    -> move snap
  //   - "resize": size changed (any corner/edge) -> resize snap on the
  //               specific edges that are moving (detected per tick)
  if (!state.dragInfo || state.dragInfo.nodeId !== draggedNode.id) {
    state.dragInfo = {
      nodeId: draggedNode.id,
      posX: draggedNode.pos[0],
      posY: draggedNode.pos[1],
      cursorX: e.clientX,
      cursorY: e.clientY,
      sizeW: draggedNode.size[0],
      sizeH: draggedNode.size[1],
      lockType: null,
      // Cache of which edges have moved at least once in this resize. Once an
      // edge "moves" we treat it as moving for the rest of the drag, even if
      // a later tick clamps it (so snap doesn't reset).
      leftMoves: false, rightMoves: false, topMoves: false, botMoves: false,
      // Hysteresis: remember which target line each axis/edge snapped to last
      // tick so we can use a wider threshold to STAY snapped, narrower to
      // ENGAGE. Prevents wiggle at the snap-zone boundary.
      stickyMoveX: null, stickyMoveY: null,
      stickyResizeL: null, stickyResizeR: null, stickyResizeT: null, stickyResizeB: null,
    };
    return;
  }

  // Classify the drag once, lock that classification for the rest of the drag.
  if (!state.dragInfo.lockType) {
    const sizeChanged = draggedNode.size[0] !== state.dragInfo.sizeW || draggedNode.size[1] !== state.dragInfo.sizeH;
    const posChanged = draggedNode.pos[0] !== state.dragInfo.posX || draggedNode.pos[1] !== state.dragInfo.posY;
    if (sizeChanged)         state.dragInfo.lockType = "resize";
    else if (posChanged)     state.dragInfo.lockType = "move";
    // else: neither has changed yet; wait
  }

  if (state.dragInfo.lockType === null) return;

  if (state.dragInfo.lockType === "resize") {
    // All edges below are in VISUAL coords (top includes the title bar) so
    // they line up with other nodes' visual edges from nodeRect().
    const titleH = (draggedNode.flags?.collapsed) ? 0 : (window.LiteGraph?.NODE_TITLE_HEIGHT || 30);
    // Detect which edges are moving by comparing current vs initial edge
    // positions. Once an edge moves, mark it sticky so we keep snapping it
    // even when LiteGraph clamps it at min size.
    const initLeft = state.dragInfo.posX;
    const initRight = state.dragInfo.posX + state.dragInfo.sizeW;
    const initTop = state.dragInfo.posY - titleH;          // visual top
    const initBot = state.dragInfo.posY + state.dragInfo.sizeH;
    const curLeft = draggedNode.pos[0];
    const curRight = draggedNode.pos[0] + draggedNode.size[0];
    const curTop = draggedNode.pos[1] - titleH;            // visual top
    const curBot = draggedNode.pos[1] + draggedNode.size[1];
    const EPS = 0.01;
    if (Math.abs(curLeft - initLeft) > EPS) state.dragInfo.leftMoves = true;
    if (Math.abs(curRight - initRight) > EPS) state.dragInfo.rightMoves = true;
    if (Math.abs(curTop - initTop) > EPS) state.dragInfo.topMoves = true;
    if (Math.abs(curBot - initBot) > EPS) state.dragInfo.botMoves = true;
    const { leftMoves, rightMoves, topMoves, botMoves } = state.dragInfo;

    let minW = 50, minH = 20;
    if (typeof draggedNode.computeSize === "function") {
      const cs = draggedNode.computeSize();
      if (cs && cs.length >= 2) { minW = cs[0]; minH = cs[1]; }
    }

    const totalDx = (e.clientX - state.dragInfo.cursorX) / scale;
    const totalDy = (e.clientY - state.dragInfo.cursorY) / scale;
    let dLeft = leftMoves  ? initLeft  + totalDx : initLeft;
    let dRight = rightMoves ? initRight + totalDx : initRight;
    let dTop = topMoves   ? initTop   + totalDy : initTop;
    let dBot = botMoves   ? initBot   + totalDy : initBot;

    // Enforce min sizes; the moving edge gives way to the anchor. Visual
    // height = body height + titleH, so visualMinH includes titleH.
    const visualMinH = minH + titleH;
    if (dRight - dLeft < minW) {
      if (leftMoves)  dLeft = dRight - minW;
      else            dRight = dLeft + minW;
    }
    if (dBot - dTop < visualMinH) {
      if (topMoves)   dTop = dBot - visualMinH;
      else            dBot = dTop + visualMinH;
    }

    const stickyG = snapGraph * 1.5;
    const nodes = c.graph?._nodes || [];
    let snapLeft = null, snapRight = null, snapTop = null, snapBot = null;
    const tryTarget = (curBest, t, value, sticky) => {
      const d = t - value;
      const allowed = (sticky != null && Math.abs(t - sticky) < 0.01) ? stickyG : snapGraph;
      if (Math.abs(d) <= allowed && (!curBest || Math.abs(d) < Math.abs(curBest.delta))) {
        return { delta: d, target: t };
      }
      return curBest;
    };
    for (const other of nodes) {
      if (other === draggedNode) continue;
      if (other.flags?.collapsed) continue;
      const oRect = nodeRect(other);
      const oE = rectEdges(oRect);
      if (leftMoves) {
        for (const t of [oE.left, oE.right, oE.centerX]) {
          snapLeft = tryTarget(snapLeft, t, dLeft, state.dragInfo.stickyResizeL);
        }
      }
      if (rightMoves) {
        for (const t of [oE.left, oE.right, oE.centerX]) {
          snapRight = tryTarget(snapRight, t, dRight, state.dragInfo.stickyResizeR);
        }
      }
      if (topMoves) {
        for (const t of [oE.top, oE.bottom, oE.centerY]) {
          snapTop = tryTarget(snapTop, t, dTop, state.dragInfo.stickyResizeT);
        }
      }
      if (botMoves) {
        for (const t of [oE.top, oE.bottom, oE.centerY]) {
          snapBot = tryTarget(snapBot, t, dBot, state.dragInfo.stickyResizeB);
        }
      }
    }
    state.dragInfo.stickyResizeL = snapLeft  ? snapLeft.target  : null;
    state.dragInfo.stickyResizeR = snapRight ? snapRight.target : null;
    state.dragInfo.stickyResizeT = snapTop   ? snapTop.target   : null;
    state.dragInfo.stickyResizeB = snapBot   ? snapBot.target   : null;

    let fLeft = snapLeft  ? snapLeft.target  : dLeft;
    let fRight = snapRight ? snapRight.target : dRight;
    let fTop = snapTop   ? snapTop.target   : dTop;       // visual top
    let fBot = snapBot   ? snapBot.target   : dBot;       // body bottom
    if (fRight - fLeft < minW) {
      if (leftMoves)  fLeft = fRight - minW;
      else            fRight = fLeft + minW;
    }
    if (fBot - fTop < visualMinH) {
      if (topMoves)   fTop = fBot - visualMinH;
      else            fBot = fTop + visualMinH;
    }

    // Convert visual top back to body top by adding titleH.
    draggedNode.pos[0] = fLeft;
    draggedNode.pos[1] = fTop + titleH;
    draggedNode.size[0] = fRight - fLeft;
    draggedNode.size[1] = fBot - (fTop + titleH);
    c.setDirty?.(true, true);
    return;
  }

  // From here, lockType === "move".

  // "Desired" position = where the cursor wants the node to be, with no snap.
  const totalDxScreen = e.clientX - state.dragInfo.cursorX;
  const totalDyScreen = e.clientY - state.dragInfo.cursorY;
  const desiredX = state.dragInfo.posX + totalDxScreen / scale;
  const desiredY = state.dragInfo.posY + totalDyScreen / scale;

  // Build moving rect at desired position. Use the VISUAL rect (including
  // the title bar above pos[1]) so snap aligns with what the user sees.
  const titleH = (draggedNode.flags?.collapsed) ? 0 : (window.LiteGraph?.NODE_TITLE_HEIGHT || 30);
  const w = draggedNode.size[0];
  const h = draggedNode.size[1];
  const movingRect = { x: desiredX, y: desiredY - titleH, w, h: h + titleH };
  const movingE = rectEdges(movingRect);
  const movingX = [movingE.left, movingE.right, movingE.centerX];
  const movingY = [movingE.top, movingE.bottom, movingE.centerY];

  const stickyG = snapGraph * 1.5;
  const nodes = c.graph?._nodes || [];
  let bestX = null;
  let bestY = null;
  for (const other of nodes) {
    if (other === draggedNode) continue;
    if (other.flags?.collapsed) continue;
    const oRect = nodeRect(other);
    const dxc = Math.max(0, Math.max(oRect.x - (movingRect.x + movingRect.w), movingRect.x - (oRect.x + oRect.w)));
    const dyc = Math.max(0, Math.max(oRect.y - (movingRect.y + movingRect.h), movingRect.y - (oRect.y + oRect.h)));
    if (dxc > 2 * stickyG && dyc > 2 * stickyG) continue;
    const oE = rectEdges(oRect);
    const mx = findClosestSnap(movingX, [oE.left, oE.right, oE.centerX], snapGraph, state.dragInfo.stickyMoveX, stickyG);
    if (mx && (!bestX || Math.abs(mx.delta) < Math.abs(bestX.delta))) bestX = mx;
    const my = findClosestSnap(movingY, [oE.top, oE.bottom, oE.centerY], snapGraph, state.dragInfo.stickyMoveY, stickyG);
    if (my && (!bestY || Math.abs(my.delta) < Math.abs(bestY.delta))) bestY = my;
  }
  state.dragInfo.stickyMoveX = bestX ? bestX.target : null;
  state.dragInfo.stickyMoveY = bestY ? bestY.target : null;

  // Set node.pos directly: snap target if found, else desired position.
  // This OVERWRITES whatever LiteGraph set this tick, so the cursor and node
  // never drift apart by more than snapGraph.
  draggedNode.pos[0] = bestX ? desiredX + bestX.delta : desiredX;
  draggedNode.pos[1] = bestY ? desiredY + bestY.delta : desiredY;
  c.setDirty?.(true, true);
}
