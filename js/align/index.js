import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";

// =============================================================================
// Align Pixaroma - toggleable snap & alignment guides for the node canvas.
// Nodes AND groups both participate: drag a node or a group and it snaps to the
// edges/centers of nearby nodes and groups alike (groups are move-only; a group
// carries its contained nodes with it). alignTargets() is the single combined
// node+group target list every snap path iterates.
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
  // Group-move tracking (separate from dragInfo so the carefully-tuned node
  // path is untouched). Captured on the first tick of a group drag.
  groupDrag: null,      // { ref, gx0, gy0, w, h, cursorX, cursorY, contained, ... } or null
  groupResize: null,    // { ref, x0, y0, cornerX0, cornerY0, cursorX, cursorY } or null (native group BR-resize)
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
      tooltip: "Snap nodes and groups to each other's edges and centers while dragging (and nodes while resizing). Hold Shift to bypass (Alt is taken by ComfyUI for duplicate-during-drag).",
      onChange: (v) => {
        state.enabled = !!v;
        updateToolbarTint();
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
    mountToolbarButton();
    installPointerHook();
    installDrawHook();
    // Group Pixaroma's pixgroup drag calls this for its snap (it owns its own move).
    try { window.PixaromaAlign = { snapMovingRect, snapResizeCorner, endExternalDrag: clearExternalGuides }; } catch (_e) {}
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
  // Capture-phase pointerdown so it runs BEFORE the Vue node's resize handler -
  // snapshots all node sizes as the gesture-start baseline (resize guard below).
  window.addEventListener("pointerdown", onWindowPointerDown, true);
  // Reset drag state on every release. Without this, a release-then-click
  // sequence with no intervening pointermove leaves stale dragInfo (with
  // its old lockType) attached to the next drag, breaking classification.
  // resetDrag also clears active guides so they vanish on release.
  window.addEventListener("pointerup", resetDrag, false);
  window.addEventListener("pointercancel", resetDrag, false);
  _hookInstalled = true;
}

// =============================================================================
// Render hook - wrap LGraphCanvas.prototype.drawFrontCanvas (the canvas-level
// render bottleneck) so we draw guides AFTER LiteGraph finishes drawing nodes
// and connections. The canvas-level onDrawForeground hook is documented as
// unreliable in the Vue frontend (CLAUDE.md Vue Frontend Compatibility #1) so
// we wrap drawFrontCanvas instead, which is provably called (Compare /
// Preview Image Pixaroma nodes render correctly via LiteGraph's draw pipe).
//
// We draw in SCREEN space using a manual graph -> screen transform so the
// stroke is exactly 1 screen pixel at any zoom (lineWidth = 1) and we don't
// depend on the canvas's world transform being applied at the time we run
// (it is restored before drawFrontCanvas returns).
// =============================================================================

let _drawHookInstalled = false;

function installDrawHook() {
  if (_drawHookInstalled) return;
  const proto = window.LGraphCanvas?.prototype;
  if (typeof proto?.drawFrontCanvas !== "function") {
    console.warn("[Pixaroma.Align] LGraphCanvas.drawFrontCanvas not found - guides will not render");
    return;
  }
  const orig = proto.drawFrontCanvas;
  proto.drawFrontCanvas = function () {
    const ret = orig.apply(this, arguments);
    if (state.activeGuides.length === 0) return ret;
    const ctx = this.ctx;
    if (!ctx) return ret;
    const scale = this.ds?.scale || 1;
    const offset = this.ds?.offset || [0, 0];
    const overhang = 16;
    const toScreenX = (gx) => (gx + offset[0]) * scale;
    const toScreenY = (gy) => (gy + offset[1]) * scale;
    ctx.save();
    ctx.strokeStyle = BRAND;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const g of state.activeGuides.slice(0, 8)) {
      if (g.axis === "X") {
        const x = toScreenX(g.value);
        ctx.moveTo(x, toScreenY(g.minPerp - overhang));
        ctx.lineTo(x, toScreenY(g.maxPerp + overhang));
      } else {
        const y = toScreenY(g.value);
        ctx.moveTo(toScreenX(g.minPerp - overhang), y);
        ctx.lineTo(toScreenX(g.maxPerp + overhang), y);
      }
    }
    ctx.stroke();
    ctx.restore();
    return ret;
  };
  _drawHookInstalled = true;
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

// Visual title-bar height for a node. Returns 0 for nodes that render no
// title bar at all: collapsed nodes (LiteGraph hides the body and only
// shows the title strip) AND nodes that opt out via flags.no_title
// (Pixaroma Label / Note set this so they render as pure decorative
// surfaces with no chrome). Otherwise returns LiteGraph's standard
// title-bar height (defaults to 30 px).
function getTitleH(n) {
  if (n.flags?.collapsed) return 0;
  if (n.flags?.no_title) return 0;
  return window.LiteGraph?.NODE_TITLE_HEIGHT || 30;
}

function nodeRect(n) {
  // A COLLAPSED node renders as just its title bar - a small pill of
  // _collapsed_width, sitting at pos[1] - titleH like any title. Use THAT small
  // rect so collapsed nodes snap/align by what's actually drawn (not their
  // hidden expanded body). _collapsed_width is set during draw; fall back to
  // LiteGraph.NODE_COLLAPSED_WIDTH (80) before the first paint.
  if (n.flags?.collapsed) {
    const th = window.LiteGraph?.NODE_TITLE_HEIGHT || 30;
    const cw = n._collapsed_width || window.LiteGraph?.NODE_COLLAPSED_WIDTH || 80;
    return { x: n.pos[0], y: n.pos[1] - th, w: cw, h: th };
  }
  // In LiteGraph, node.pos[1] is the top of the BODY (below the title bar),
  // and node.size[1] is the body height. The title sits at pos[1] - titleH.
  // For snap to align with the visual top edge of the node, include the
  // title bar in the rect. no_title nodes (Label / Note) have no title bar.
  const titleH = getTitleH(n);
  return {
    x: n.pos[0],
    y: n.pos[1] - titleH,
    w: n.size[0],
    h: n.size[1] + titleH,
  };
}

// ── Group geometry ───────────────────────────────────────────────────────
// A group's alignable rect is its full bounding box (the title strip sits
// INSIDE the top of the box, so there's no title-bar offset like nodes).
// Read/write defensively across litegraph versions and both renderers: the
// _pos/_size fields, the pos/size getters, or the _bounding [x,y,w,h] cache.
// litegraph stores _pos/_size/_bounding as Float32Array (and _pos/_size are
// often subarray VIEWS of _bounding). Array.isArray() is FALSE for typed
// arrays, so test array-LIKE (numeric .length) instead — using Array.isArray
// here made every group read return null and silently disabled group snapping.
function arrLike(v, n) { return v != null && typeof v.length === "number" && v.length >= n; }
function groupPos(g) {
  if (arrLike(g?._pos, 2)) return [g._pos[0], g._pos[1]];
  if (arrLike(g?.pos, 2)) return [g.pos[0], g.pos[1]];
  if (arrLike(g?._bounding, 4)) return [g._bounding[0], g._bounding[1]];
  return null;
}
function groupSize(g) {
  if (arrLike(g?._size, 2)) return [g._size[0], g._size[1]];
  if (arrLike(g?.size, 2)) return [g.size[0], g.size[1]];
  if (arrLike(g?._bounding, 4)) return [g._bounding[2], g._bounding[3]];
  return null;
}
function groupRect(g) {
  const p = groupPos(g), s = groupSize(g);
  if (!p || !s) return null;
  return { x: p[0], y: p[1], w: s[0], h: s[1] };
}
// Write a group's top-left. Array-replace through the pos getter (so any
// reactive Nodes 2.0 setter fires) AND sync the raw _pos/_bounding fields, so
// the group renders at the new spot in either renderer regardless of which the
// renderer reads. (Children are moved separately by the caller.)
function setGroupPos(g, x, y) {
  // Mutate in place (works on Float32Array views). _pos is usually a subarray of
  // _bounding, so writing _pos also updates _bounding, but set both to be safe.
  if (arrLike(g._pos, 2)) { g._pos[0] = x; g._pos[1] = y; }
  if (arrLike(g._bounding, 4)) { g._bounding[0] = x; g._bounding[1] = y; }
  if (!g._pos && arrLike(g.pos, 2)) { g.pos[0] = x; g.pos[1] = y; }
}
// Write a group's size (LiteGraph groups resize from the bottom-right, so the
// top-left _pos is unchanged). _size is usually a subarray of _bounding; set both.
function setGroupSize(g, w, h) {
  if (arrLike(g._size, 2)) { g._size[0] = w; g._size[1] = h; }
  if (arrLike(g._bounding, 4)) { g._bounding[2] = w; g._bounding[3] = h; }
  if (!g._size && arrLike(g.size, 2)) { g.size[0] = w; g.size[1] = h; }
}
function graphGroups(c) {
  return c?.graph?._groups || c?.graph?.groups || [];
}
// A group folded by Group Pixaroma is a slim "bar" that Group Pixaroma drags
// itself (bar-only). Align must NOT also treat it as a draggable group or the two
// fight and the bar appears stuck. (Detected via the fold flag the features share.)
function isFoldedGroup(g) { return !!(g && g.flags && g.flags.pixFold); }

// Unified alignment targets: every node (its visual rect, title bar included)
// PLUS every group (its bounding box). The snap loops and guide extension
// iterate this one list, so nodes snap to groups and groups snap to nodes from
// a single code path. kind distinguishes the two for the multi-select skip
// (which is keyed on node ids); ref is the source object for identity skips.
function alignTargets(c) {
  const out = [];
  for (const n of (c.graph?._nodes || [])) {
    // collapsed:false on purpose - collapsed nodes now participate fully as snap
    // targets (nodeRect returns their small title-bar rect). They used to be
    // skipped via this flag, which is why a collapsed node never snapped.
    out.push({ ref: n, kind: "node", id: n.id, rect: nodeRect(n), collapsed: false });
  }
  for (const g of graphGroups(c)) {
    const r = groupRect(g);
    if (r) out.push({ ref: g, kind: "group", id: g.id, rect: r, collapsed: false });
  }
  // Pixaroma groups (js/pixgroup) — read-only snap targets, so dragging a node or a
  // native group aligns to their edges too. kind "pixgroup" so the node/group skips
  // (keyed on kind/ref) never touch them; ref null (no LiteGraph object behind them).
  try {
    const rects = window.PixaromaPixGroup?.allRects?.() || [];
    for (const r of rects) out.push({ ref: null, kind: "pixgroup", id: r.id, rect: { x: r.x, y: r.y, w: r.w, h: r.h }, collapsed: false });
  } catch (_e) {}
  return out;
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

// Record a guide for later rendering. axis = "X" or "Y". value is the snap
// line position in graph space. perpRange is [minPerp, maxPerp] of the rects
// being aligned (perp = the OTHER axis).
function pushGuide(axis, value, perpRange) {
  if (state.activeGuides.length >= 8) return;
  state.activeGuides.push({ axis, value, minPerp: perpRange[0], maxPerp: perpRange[1] });
}

// Extend a guide's perp range to include every non-skipped rect whose
// matching edge (left/right/centerX for X axis, top/bottom/centerY for Y)
// equals the guide value within EPS. This makes a column of 3+ nodes show
// one continuous guide that spans the whole column instead of a short
// segment between only the moving and matched rects.
// candidates are unified target objects ({ ref, rect, collapsed, ... } from
// alignTargets); skipFn receives the source ref (node or group).
function extendGuideRange(axis, value, baseLo, baseHi, candidates, skipFn) {
  const EPS = 0.5;
  let lo = baseLo, hi = baseHi;
  for (const cand of candidates) {
    if (cand.collapsed) continue;
    if (skipFn(cand.ref)) continue;
    const oR = cand.rect;
    const oE = rectEdges(oR);
    let match = false;
    if (axis === "X") {
      match = Math.abs(oE.left - value) < EPS
           || Math.abs(oE.right - value) < EPS
           || Math.abs(oE.centerX - value) < EPS;
    } else {
      match = Math.abs(oE.top - value) < EPS
           || Math.abs(oE.bottom - value) < EPS
           || Math.abs(oE.centerY - value) < EPS;
    }
    if (!match) continue;
    if (axis === "X") {
      lo = Math.min(lo, oR.y);
      hi = Math.max(hi, oR.y + oR.h);
    } else {
      lo = Math.min(lo, oR.x);
      hi = Math.max(hi, oR.x + oR.w);
    }
  }
  return [lo, hi];
}

// Draw a guide for EVERY edge of `rect` that coincides (after snapping) with a
// target's matching edge, deduped per axis+value and each spanning the moving
// rect plus all targets sharing that line. Used by the group-move path so that
// when two same-size groups align top AND bottom at once, both lines show — not
// just the single edge that drove the position snap.
function pushAlignedGuides(rect, targets, skip) {
  const EPS = 0.5;
  const me = rectEdges(rect);
  const xVals = [me.left, me.right, me.centerX];
  const yVals = [me.top, me.bottom, me.centerY];
  const xg = new Map(), yg = new Map(); // rounded value -> { value, lo, hi }
  const add = (map, val, lo, hi) => {
    const k = Math.round(val);
    const g = map.get(k);
    if (g) { g.lo = Math.min(g.lo, lo); g.hi = Math.max(g.hi, hi); }
    else map.set(k, { value: val, lo, hi });
  };
  for (const t of targets) {
    if (t.collapsed || skip(t.ref)) continue;
    const oE = rectEdges(t.rect), r = t.rect;
    for (const mv of xVals) for (const tv of [oE.left, oE.right, oE.centerX]) {
      if (Math.abs(mv - tv) < EPS) add(xg, tv, Math.min(rect.y, r.y), Math.max(rect.y + rect.h, r.y + r.h));
    }
    for (const mv of yVals) for (const tv of [oE.top, oE.bottom, oE.centerY]) {
      if (Math.abs(mv - tv) < EPS) add(yg, tv, Math.min(rect.x, r.x), Math.max(rect.x + rect.w, r.x + r.w));
    }
  }
  for (const g of xg.values()) pushGuide("X", g.value, [g.lo, g.hi]);
  for (const g of yg.values()) pushGuide("Y", g.value, [g.lo, g.hi]);
}

// Drop drag bookkeeping AND clear active guides. Use this for both
// pointerup/cancel and any mid-tick bail (disabled, Shift, no buttons).
// Setting setDirty triggers a redraw so any visible guides disappear
// promptly; redraw is cheap when there's nothing to draw.
function resetDrag() {
  state.dragInfo = null;
  state.groupDrag = null;
  state.groupResize = null;
  state._extStickyX = null; state._extStickyY = null;
  state._multiGroupDrag = false;
  state._prevNodeStates = null;
  state._vueResizing = false;
  state._gestureSizes = null;
  if (state.activeGuides.length) {
    state.activeGuides = [];
    app.canvas?.setDirty?.(true, true);
  }
}

// Capture every node's size at the START of a pointer gesture (capture phase, so
// this runs BEFORE the Vue node's own pointerdown that begins a resize). The Vue
// resize guard in onWindowPointerMove then compares against THIS baseline rather
// than the previous tick: a resize is detected the instant any node's size
// differs from its gesture-start size, and the difference persists for the whole
// drag (even after the node clamps at its min and stops changing) - so the guard
// latches reliably from tick 1 and the selected node is never moved while another
// node is being resized. (Pattern #16 hardening, 2026-06.)
function onWindowPointerDown(e) {
  if (!state.enabled) return;
  if (e.button !== 0) return; // primary button only
  const c = app.canvas;
  if (!c?.graph?._nodes) return;
  const sizes = new Map();
  for (const n of c.graph._nodes) sizes.set(n.id, [n.size[0], n.size[1]]);
  state._gestureSizes = sizes;
  state._vueResizing = false;
  // Baseline every group's rect (capture phase, before any drag moves them) so
  // a group MOVE is detectable by position change from the very first move tick.
  const grects = new Map();
  for (const g of graphGroups(c)) { const r = groupRect(g); if (r) grects.set(g, r); }
  state._prevGroupRects = grects;
  // If the pointer grabbed a RESIZE HANDLE, the element under it shows a
  // `*-resize` cursor. Latch the resize flag immediately so the move guard bails
  // from tick 0 - on the very first pointermove the node's size hasn't changed
  // yet, so the size-diff check alone would let the selected node creep one tick
  // before latching (the "moves just a little while I resize another" residual).
  try {
    const cur = e.target && window.getComputedStyle(e.target).cursor;
    if (cur && cur.indexOf("resize") !== -1) state._vueResizing = true;
  } catch (_e) {}
}

// Apply a snap correction to a node's position (and optionally size). LEGACY:
// synchronous index mutation (node.pos[0]=x), as it always did. NODES 2.0: the
// on-screen position comes from a reactive layout store, NOT node._pos directly;
// an index mutation does NOT trigger the `pos` setter that updates that store -
// only an ARRAY REPLACEMENT (node.pos = [x,y]) does. AND the Vue drag queues its
// own rAF that recomputes the position from the raw cursor and would overwrite
// ours, so we queue OUR write in a rAF too: our window-bubble handler runs AFTER
// the node element's pointermove (which queued Vue's rAF), so our rAF is later
// in the FIFO queue and runs after Vue's, winning. Only correct when a snap is
// actually engaged (snapActive) - otherwise leave Vue to position from the
// cursor. Agent-verified against the compiled frontend (2026-06-01).
function applyNodePos(node, x, y, snapActive) {
  if (isVueNodes()) {
    if (snapActive) requestAnimationFrame(() => { node.pos = [x, y]; });
  } else {
    node.pos[0] = x;
    node.pos[1] = y;
  }
}
function applyNodeRect(node, x, y, w, h, snapActive) {
  if (isVueNodes()) {
    if (snapActive) requestAnimationFrame(() => { node.pos = [x, y]; node.size = [w, h]; });
  } else {
    node.pos[0] = x; node.pos[1] = y;
    node.size[0] = w; node.size[1] = h;
  }
}

// ── Group drag: detection + snap (Approach A — absolute desired-from-origin) ─
// A group move also shifts its contained nodes, so the node change-detector
// below would mistake those for a node drag. We therefore detect + fully handle
// a group drag FIRST (and return), before any node logic runs.

// Refresh the per-group rect cache (runs every drag tick) so the next tick's
// change-detection has a fresh baseline.
function refreshGroupCache(c) {
  if (!state._prevGroupRects) state._prevGroupRects = new Map();
  state._prevGroupRects.clear();
  for (const g of graphGroups(c)) { const r = groupRect(g); if (r) state._prevGroupRects.set(g, r); }
}

// Identify a group being MOVED this tick: a group whose top-left changed since
// last tick with its SIZE unchanged (a size change means a resize, which we
// don't snap). _prevGroupRects is baselined on pointerdown, so a real group drag
// is caught on the very first move tick.
//
// We deliberately do NOT trust c.selected_group. It can be STALE (it stays set
// after you interact with a group, e.g. recolor it), and in the Vue renderer it
// remains set while you drag a NODE or select TEXT inside the group - which made
// Align move the whole group instead of the node / instead of selecting text
// (reported June 2026, both renderers). Movement-based detection can't
// false-fire: dragging a node or selecting text never moves the group.
function findDraggedGroup(c) {
  const prev = state._prevGroupRects;
  if (!prev) return null;
  for (const g of graphGroups(c)) {
    if (isFoldedGroup(g)) continue; // Group Pixaroma drags folded bars itself
    const r = groupRect(g), p = prev.get(g);
    if (!r || !p) continue;
    const moved = Math.abs(r.x - p.x) > 0.01 || Math.abs(r.y - p.y) > 0.01;
    const resized = Math.abs(r.w - p.w) > 0.01 || Math.abs(r.h - p.h) > 0.01;
    if (moved && !resized) return g;
  }
  return null;
}

// How many groups MOVED (top-left changed, size unchanged) since last tick. >1
// means a multi-group drag - Align can't rigidly snap the whole set, and snapping
// one member drifts it into the others, so we stay out and let LiteGraph move
// them rigidly.
function countMovedGroups(c) {
  const prev = state._prevGroupRects;
  if (!prev) return 0;
  let n = 0;
  for (const g of graphGroups(c)) {
    if (isFoldedGroup(g)) continue;
    const r = groupRect(g), p = prev.get(g);
    if (!r || !p) continue;
    const moved = Math.abs(r.x - p.x) > 0.01 || Math.abs(r.y - p.y) > 0.01;
    const resized = Math.abs(r.w - p.w) > 0.01 || Math.abs(r.h - p.h) > 0.01;
    if (moved && !resized) n++;
  }
  return n;
}

// A native group whose SIZE changed since last tick = being resized (LiteGraph
// groups resize from the bottom-right, top-left fixed). Distinct from a move.
function findResizedGroup(c) {
  const prev = state._prevGroupRects;
  if (!prev) return null;
  for (const g of graphGroups(c)) {
    if (isFoldedGroup(g)) continue;
    const r = groupRect(g), p = prev.get(g);
    if (!r || !p) continue;
    if (Math.abs(r.w - p.w) > 0.01 || Math.abs(r.h - p.h) > 0.01) return g;
  }
  return null;
}

// Nodes that move rigidly with the group. Prefer LiteGraph's own _nodes (it
// recomputes them when the group grab starts); fall back to geometry (node
// center inside the group rect) for any build that doesn't populate it.
function groupContainedNodes(c, g, gRect) {
  if (Array.isArray(g._nodes) && g._nodes.length) return g._nodes.slice();
  const out = [];
  for (const n of (c.graph?._nodes || [])) {
    const r = nodeRect(n);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    if (cx >= gRect.x && cx <= gRect.x + gRect.w && cy >= gRect.y && cy <= gRect.y + gRect.h) out.push(n);
  }
  return out;
}

// Write the snapped group + contained-node positions. Legacy: overwrite absolute
// every tick (same as the node path). Nodes 2.0: only correct when a snap is
// actually engaged, deferred in a rAF so it wins over Vue's own cursor-driven
// write (mirrors applyNodePos); when not snapped, leave the reactive drag alone.
function applyGroupDrag(g, contained, gx, gy, snapActive) {
  if (isVueNodes()) {
    if (!snapActive) return;
    // The group FRAME is canvas-painted (nothing competes to write it), so set it
    // SYNCHRONOUSLY — deferring it to the rAF made the frame oscillate between
    // ComfyUI's unsnapped paint and our snapped paint (the "group frame wiggles but
    // the nodes don't" report). The NODES are Vue-rendered, so their write stays in
    // the rAF to win over Vue's own cursor-driven layout write.
    setGroupPos(g, gx, gy);
    requestAnimationFrame(() => {
      for (const cn of contained) cn.node.pos = [gx + cn.off[0], gy + cn.off[1]];
    });
  } else {
    setGroupPos(g, gx, gy);
    for (const cn of contained) { cn.node.pos[0] = gx + cn.off[0]; cn.node.pos[1] = gy + cn.off[1]; }
  }
}

function handleGroupDrag(c, group, e) {
  const scale = c.ds?.scale || 1;
  const snapGraph = state.snapDistPx / scale;
  const gRect = groupRect(group);
  if (!gRect) { state.groupDrag = null; return; }

  // A SIZE change on an existing session means the group is being RESIZED, not
  // moved (some builds leave selected_group_resizing undefined) — bail so we
  // don't fight the resize. A fresh session trivially matches and falls through.
  if (state.groupDrag && state.groupDrag.ref === group &&
      (Math.abs(gRect.w - state.groupDrag.w) > 0.01 || Math.abs(gRect.h - state.groupDrag.h) > 0.01)) {
    state.groupDrag = null;
    return;
  }

  // (Re)initialise the session on a new group grab. Capture the group's origin,
  // the cursor origin, and each contained node's OFFSET from the group's
  // top-left (constant for a rigid move). The baseline tick applies no
  // correction (desired == current), so the group never jumps on grab.
  if (!state.groupDrag || state.groupDrag.ref !== group) {
    const contained = groupContainedNodes(c, group, gRect).map((n) => ({
      node: n, off: [n.pos[0] - gRect.x, n.pos[1] - gRect.y],
    }));
    state.groupDrag = {
      ref: group,
      gx0: gRect.x, gy0: gRect.y, w: gRect.w, h: gRect.h,
      cursorX: e.clientX, cursorY: e.clientY,
      contained,
      containedSet: new Set(contained.map((cn) => cn.node)),
      stickyX: null, stickyY: null,
    };
    return;
  }

  const di = state.groupDrag;
  const desiredX = di.gx0 + (e.clientX - di.cursorX) / scale;
  const desiredY = di.gy0 + (e.clientY - di.cursorY) / scale;
  const movingRect = { x: desiredX, y: desiredY, w: di.w, h: di.h };
  const movingE = rectEdges(movingRect);
  const movingX = [movingE.left, movingE.right, movingE.centerX];
  const movingY = [movingE.top, movingE.bottom, movingE.centerY];

  const stickyG = snapGraph * 1.5;
  const targets = alignTargets(c);
  // A group aligns to other groups' FRAMES and to LOOSE nodes — never to the
  // nodes nested INSIDE another group (their edges sit at different positions
  // than the frame and would hijack the snap). Collect every grouped node so we
  // can exclude them as targets.
  const groupedNodes = new Set();
  for (const t of targets) {
    if (t.kind !== "group" || t.ref === group) continue;
    for (const n of groupContainedNodes(c, t.ref, t.rect)) groupedNodes.add(n);
  }
  let bestX = null, bestY = null;
  for (const t of targets) {
    if (t.ref === group) continue;                                  // don't snap to self
    if (t.kind === "node" && di.containedSet.has(t.ref)) continue;  // nor to own children
    if (t.kind === "node" && groupedNodes.has(t.ref)) continue;     // nor to other groups' children
    // A Pixaroma group INSIDE this native group is carried with it (Group Pixaroma
    // moves it on the group drag), so it's a moving target → skip it, else the group
    // wiggles trying to snap to something that follows it.
    if (t.kind === "pixgroup") {
      const r = t.rect;
      if (r.x >= gRect.x && r.y >= gRect.y && r.x + r.w <= gRect.x + gRect.w && r.y + r.h <= gRect.y + gRect.h) continue;
    }
    if (t.collapsed) continue;
    const oRect = t.rect;
    const dxc = Math.max(0, Math.max(oRect.x - (movingRect.x + movingRect.w), movingRect.x - (oRect.x + oRect.w)));
    const dyc = Math.max(0, Math.max(oRect.y - (movingRect.y + movingRect.h), movingRect.y - (oRect.y + oRect.h)));
    if (dxc > 2 * stickyG && dyc > 2 * stickyG) continue;
    const oE = rectEdges(oRect);
    const mx = findClosestSnap(movingX, [oE.left, oE.right, oE.centerX], snapGraph, di.stickyX, stickyG);
    if (mx && (!bestX || Math.abs(mx.delta) < Math.abs(bestX.delta))) bestX = mx;
    const my = findClosestSnap(movingY, [oE.top, oE.bottom, oE.centerY], snapGraph, di.stickyY, stickyG);
    if (my && (!bestY || Math.abs(my.delta) < Math.abs(bestY.delta))) bestY = my;
  }
  di.stickyX = bestX ? bestX.target : null;
  di.stickyY = bestY ? bestY.target : null;

  const fx = bestX ? desiredX + bestX.delta : desiredX;
  const fy = bestY ? desiredY + bestY.delta : desiredY;
  applyGroupDrag(group, di.contained, fx, fy, !!(bestX || bestY));

  // Position correction uses only the single closest delta per axis (bestX/bestY),
  // but the GUIDE lines fan out to EVERY edge of the snapped rect that coincides
  // with a target — so two same-size groups show both their top AND bottom lines,
  // not just the one that drove the snap.
  const finalRect = { x: fx, y: fy, w: di.w, h: di.h };
  const skip = (ref) => ref === group || di.containedSet.has(ref) || groupedNodes.has(ref);
  state.activeGuides = [];
  pushAlignedGuides(finalRect, targets, skip);
  c.setDirty?.(true, true);
}

// Snap a native group RESIZE: the bottom-right corner follows the cursor (absolute
// model from resize start, so it never feeds back from its own snapped output);
// snap that corner to nearby edges + write the new size. Top-left stays put.
function handleGroupResize(c, group, e) {
  const gRect = groupRect(group);
  if (!gRect) { state.groupResize = null; return; }
  if (!state.groupResize || state.groupResize.ref !== group) {
    state.groupResize = {
      ref: group, x0: gRect.x, y0: gRect.y,
      cornerX0: gRect.x + gRect.w, cornerY0: gRect.y + gRect.h,
      cursorX: e.clientX, cursorY: e.clientY,
    };
    state._extStickyX = null; state._extStickyY = null;
    return; // baseline tick: no correction, so the group never jumps on grab
  }
  const ri = state.groupResize;
  const scale = c.ds?.scale || 1;
  const desiredX = ri.cornerX0 + (e.clientX - ri.cursorX) / scale;
  const desiredY = ri.cornerY0 + (e.clientY - ri.cursorY) / scale;
  const snap = snapResizeCorner(desiredX, desiredY, { excludeGroupId: group.id, bypass: e.shiftKey });
  setGroupSize(group, Math.max(10, snap.x - ri.x0), Math.max(10, snap.y - ri.y0));
  c.setDirty?.(true, true);
}

// ── External-drag snap API (used by Group Pixaroma's own pixgroup drag) ──────
// A Pixaroma group is moved by its OWN module (frame + contained nodes), so Align
// can't drive it via node.pos like a node/native group. Instead that module hands
// us the dragged frames' bounding rect here; we set the guides (the draw hook
// renders them) and return the snap delta to apply to the frames + their contents.
function clearExternalGuides() {
  state._extStickyX = null; state._extStickyY = null;
  if (state.activeGuides.length) { state.activeGuides = []; app.canvas?.setDirty?.(true, true); }
}
function snapMovingRect(rect, opts) {
  opts = opts || {};
  const c = app.canvas;
  if (!state.enabled || !c || opts.bypass || !rect) { clearExternalGuides(); return { dx: 0, dy: 0 }; }
  // Defensive: an external caller (pixgroup) could pass a non-finite rect; bail cleanly
  // instead of computing NaN snap deltas that would get written back as positions.
  if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) { clearExternalGuides(); return { dx: 0, dy: 0 }; }
  const scale = c.ds?.scale || 1;
  const snapGraph = state.snapDistPx / scale;
  const stickyG = snapGraph * 1.5;
  const exPix = new Set(opts.excludePixIds || []);   // dragged pixgroup ids — don't snap to them
  const exNodes = new Set(opts.excludeNodes || []);  // their member nodes — nor to own children
  const targets = alignTargets(c);
  // A Pixaroma group aligns to ANY node or group frame on the canvas (except its own
  // contents) — INCLUDING a node that sits inside a ComfyUI group. (Native-group moves
  // still skip other groups' nested nodes via handleGroupDrag, for frame-to-frame.)
  const me = rectEdges(rect);
  const movingX = [me.left, me.right, me.centerX];
  const movingY = [me.top, me.bottom, me.centerY];
  let bestX = null, bestY = null;
  for (const t of targets) {
    if (t.kind === "pixgroup" && exPix.has(t.id)) continue;
    if (t.kind === "node" && exNodes.has(t.ref)) continue;
    if (t.collapsed) continue;
    const oRect = t.rect;
    const dxc = Math.max(0, Math.max(oRect.x - (rect.x + rect.w), rect.x - (oRect.x + oRect.w)));
    const dyc = Math.max(0, Math.max(oRect.y - (rect.y + rect.h), rect.y - (oRect.y + oRect.h)));
    if (dxc > 2 * stickyG && dyc > 2 * stickyG) continue;
    const oE = rectEdges(oRect);
    const mx = findClosestSnap(movingX, [oE.left, oE.right, oE.centerX], snapGraph, state._extStickyX, stickyG);
    if (mx && (!bestX || Math.abs(mx.delta) < Math.abs(bestX.delta))) bestX = mx;
    const my = findClosestSnap(movingY, [oE.top, oE.bottom, oE.centerY], snapGraph, state._extStickyY, stickyG);
    if (my && (!bestY || Math.abs(my.delta) < Math.abs(bestY.delta))) bestY = my;
  }
  state._extStickyX = bestX ? bestX.target : null;
  state._extStickyY = bestY ? bestY.target : null;
  const dx = bestX ? bestX.delta : 0, dy = bestY ? bestY.delta : 0;
  const finalRect = { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
  const guideTargets = targets.filter((t) => !(t.kind === "pixgroup" && exPix.has(t.id)));
  const skip = (ref) => !!(ref && exNodes.has(ref));
  state.activeGuides = [];
  pushAlignedGuides(finalRect, guideTargets, skip);
  c.setDirty?.(true, true);
  return { dx, dy };
}

// Snap a RESIZE corner (the cursor point) to nearby target edges, one axis each.
// Returns the snapped { x, y } for the dragged corner + draws a guide per snapped
// axis. Used by Group Pixaroma's pixgroup corner-resize.
function snapResizeCorner(x, y, opts) {
  opts = opts || {};
  const c = app.canvas;
  if (!state.enabled || !c || opts.bypass) { clearExternalGuides(); return { x, y }; }
  // Defensive: bail on a non-finite corner from an external caller (pixgroup).
  if (!Number.isFinite(x) || !Number.isFinite(y)) { clearExternalGuides(); return { x, y }; }
  const scale = c.ds?.scale || 1;
  const snapGraph = state.snapDistPx / scale;
  const stickyG = snapGraph * 1.5;
  const exPix = new Set(opts.excludePixIds || []);
  const targets = alignTargets(c);
  // includeGroupedNodes (Pixaroma-group resize): align to ANY node, even ones inside
  // a ComfyUI group. Native-group resize leaves it off → keeps frame-to-frame, but
  // still snaps to its OWN contained nodes (the excludeGroupId skip).
  const groupedNodes = new Set();
  if (!opts.includeGroupedNodes) {
    for (const t of targets) {
      if (t.kind !== "group") continue;
      // Skip the group BEING resized: we WANT its edge to snap to its OWN contained
      // nodes (so you can fit the frame snugly to its contents). Once the edge passes
      // a node's center the node counts as "contained", and excluding it here is
      // exactly what stopped the bottom edge from ever reaching that node's bottom.
      if (opts.excludeGroupId != null && t.id === opts.excludeGroupId) continue;
      for (const n of groupContainedNodes(c, t.ref, t.rect)) groupedNodes.add(n);
    }
  }
  let bx = null, by = null; // { delta, target, rect }
  for (const t of targets) {
    if (t.kind === "pixgroup" && exPix.has(t.id)) continue;
    if (t.kind === "group" && opts.excludeGroupId != null && t.id === opts.excludeGroupId) continue;
    if (t.kind === "node" && groupedNodes.has(t.ref)) continue;
    if (t.collapsed) continue;
    const oE = rectEdges(t.rect);
    for (const tv of [oE.left, oE.right, oE.centerX]) {
      const d = tv - x;
      const allowed = (state._extStickyX != null && Math.abs(tv - state._extStickyX) < 0.01) ? stickyG : snapGraph;
      if (Math.abs(d) <= allowed && (!bx || Math.abs(d) < Math.abs(bx.delta))) bx = { delta: d, target: tv, rect: t.rect };
    }
    for (const tv of [oE.top, oE.bottom, oE.centerY]) {
      const d = tv - y;
      const allowed = (state._extStickyY != null && Math.abs(tv - state._extStickyY) < 0.01) ? stickyG : snapGraph;
      if (Math.abs(d) <= allowed && (!by || Math.abs(d) < Math.abs(by.delta))) by = { delta: d, target: tv, rect: t.rect };
    }
  }
  state._extStickyX = bx ? bx.target : null;
  state._extStickyY = by ? by.target : null;
  const sx = bx ? x + bx.delta : x, sy = by ? y + by.delta : y;
  state.activeGuides = [];
  if (bx) pushGuide("X", bx.target, [Math.min(sy, bx.rect.y), Math.max(sy, bx.rect.y + bx.rect.h)]);
  if (by) pushGuide("Y", by.target, [Math.min(sx, by.rect.x), Math.max(sx, by.rect.x + by.rect.w)]);
  c.setDirty?.(true, true);
  return { x: sx, y: sy };
}

function onWindowPointerMove(e) {
  if (!state.enabled) { resetDrag(); return; }
  // Shift bypasses snap (Alt is taken by ComfyUI for "duplicate during drag").
  if (e.shiftKey) { resetDrag(); return; }
  if (!(e.buttons & 1)) { resetDrag(); return; }
  const c = app.canvas;
  if (!c) { resetDrag(); return; }
  // Marquee / canvas-pan are not node drags. (Present in both renderers; in
  // Nodes 2.0 these may be unset, but the change-detection below still excludes
  // them since neither moves a node.)
  if (c.dragging_rectangle != null) { resetDrag(); return; }
  if (c.dragging_canvas) { resetDrag(); return; }

  // A Pixaroma group (js/pixgroup) drag is owned by that module — it moves the
  // frame + its contained nodes itself and calls snapMovingRect for the snap. Bail
  // here WITHOUT clearing guides (snapMovingRect just set them); else our node
  // detector below would misread the moving contained nodes as a node drag.
  if (window.PixaromaPixGroup?.isDragging?.()) { state.dragInfo = null; state.groupDrag = null; return; }

  // ── Group drag takes precedence over node logic. Detect it first (and keep an
  // in-progress session alive even on a still tick, so guides don't flicker when
  // you pause), then handle + return. A group move also shifts its contained
  // nodes, which the node detector below would otherwise misread as a node drag.
  // The button-held + shift + marquee/pan gates above already cleared groupDrag
  // when appropriate; pointerup/cancel clears it via resetDrag.
  const draggedGroup = findDraggedGroup(c) || state.groupDrag?.ref || null;
  const resizedGroupRaw = findResizedGroup(c); // detect BEFORE refreshGroupCache overwrites prev
  // Latch a multi-group drag (2+ groups moving together). Once latched, Align
  // stays out of group snapping for the rest of the gesture so the selected
  // groups move rigidly via LiteGraph instead of creeping into each other.
  if (countMovedGroups(c) > 1) state._multiGroupDrag = true;
  refreshGroupCache(c);
  if (draggedGroup) {
    if (state._multiGroupDrag) {
      state.groupDrag = null;
      if (state.activeGuides.length) { state.activeGuides = []; c.setDirty?.(true, true); }
      return;
    }
    handleGroupDrag(c, draggedGroup, e);
    return;
  }
  // Native group RESIZE (bottom-right corner moved, top-left fixed) — snap the corner.
  const resizedGroup = resizedGroupRaw || state.groupResize?.ref || null;
  if (resizedGroup && !state._multiGroupDrag) {
    handleGroupResize(c, resizedGroup, e);
    return;
  }

  // LEGACY-ONLY drag gates. Nodes 2.0 moves nodes WITHOUT setting
  // last_mouse_dragging (undefined) or pointer.dragStarted (stays false) -
  // verified via console diagnostic 2026-06-01 - so gating on them would bail
  // EVERY Vue drag. In Vue the drag is detected purely by node.pos change below,
  // which is the universal signal and inherently excludes marquee/pan (no node
  // moves). The pre-threshold dead-zone protection (dragStarted) is a legacy
  // concern only; in Vue the change-detection is the dead-zone guard (nothing
  // moves until the drag actually commits).
  const vue = isVueNodes();
  if (!vue) {
    if (!c.last_mouse_dragging) { resetDrag(); return; }
    if (c.pointer && c.pointer.dragStarted === false) { resetDrag(); return; }
  }

  // Find the node being dragged.
  //  LEGACY: "which node did LiteGraph just move this tick?" via the change-
  //    detection cache (selected_nodes can point at the wrong node, e.g. resizing
  //    an unselected node, so change-detect is primary).
  //  NODES 2.0: the Vue drag moves the node through a reactive LAYOUT STORE and
  //    NEVER mutates node._pos - only OUR snap write does. So change-detection
  //    (which reads node.pos) fires only on the odd tick where _pos happens to
  //    differ, making the snap engage then fall off = the VIBRATION the user saw.
  //    Instead, once the drag session exists, look the node up directly by its
  //    stored id (keeps the session alive EVERY frame); on tick 0 use
  //    selected_nodes (marquee/pan already bailed above). Agent-verified 2026-06-01.
  let draggedNode = null;
  if (vue) {
    // Resize guard (Nodes 2.0): a resize updates node._size, but a MOVE does
    // NOT mutate node._pos, and selected_nodes can't tell us whether the user is
    // moving the selected node or RESIZING a different one. So if ANY node's
    // size changed since last tick, a resize is in progress - Align doesn't snap
    // resizes in Vue, and moving a node during one yanks the WRONG node (the
    // "resize one node and the selected one moves too" + "node jumps when I
    // resize it" bugs). Detect it once and stay out of the way for the rest of
    // the gesture; resetDrag clears the flag on release / next non-drag move.
    // Compare against the GESTURE-START sizes (captured on pointerdown), not the
    // previous tick: the difference persists for the whole drag, so the latch is
    // reliable even on tick 1 and even after the resized node clamps at its min
    // (where a per-tick diff would read "no change" and let the selected node
    // move). Fall back to the per-tick cache if no gesture baseline (e.g. a drag
    // already in progress when Align was toggled on).
    if (!state._vueResizing) {
      const base = state._gestureSizes;
      for (const n of (c.graph?._nodes || [])) {
        if (base) {
          const g = base.get(n.id);
          if (g && (g[0] !== n.size[0] || g[1] !== n.size[1])) { state._vueResizing = true; break; }
        } else if (state._prevNodeStates) {
          const p = state._prevNodeStates.get(n.id);
          if (p && (p.w !== n.size[0] || p.h !== n.size[1])) { state._vueResizing = true; break; }
        }
      }
    }
    if (state._vueResizing) {
      state.dragInfo = null;
      if (state.activeGuides.length) { state.activeGuides = []; c.setDirty?.(true, true); }
      return;
    }
    // Use the existing session's node, but VALIDATE it's still the one being
    // dragged: it must still be SELECTED. Otherwise the session is stale - a
    // previous drag whose pointerup we missed (the Vue node's captured pointer
    // can swallow the release) - and the by-id lookup would keep moving that OLD
    // node while the user drags a new one (the "move one node, another moves
    // too" leak). A stale session is dropped and we re-pick from the current
    // selection.
    if (state.dragInfo?.nodeId != null) {
      const id = state.dragInfo.nodeId;
      const node = c.graph?._nodes?.find((n) => n.id === id) || null;
      const stillSelected = node && c.selected_nodes &&
        Object.values(c.selected_nodes).some((s) => s && s.id === id);
      if (stillSelected) draggedNode = node;
      else state.dragInfo = null;
    }
    if (!draggedNode) {
      const sel = c.selected_nodes;
      const keys = sel ? Object.keys(sel) : [];
      if (keys.length >= 1) draggedNode = sel[keys[0]];
    }
  } else if (state._prevNodeStates && c.graph?._nodes) {
    for (const n of c.graph._nodes) {
      const p = state._prevNodeStates.get(n.id);
      if (p && (p.x !== n.pos[0] || p.y !== n.pos[1] || p.w !== n.size[0] || p.h !== n.size[1])) {
        draggedNode = n;
        break;
      }
    }
  }
  // Legacy-only fallbacks for tick 0 (no cache yet) / very-slow drags.
  if (!draggedNode && !vue) {
    const sel = c.selected_nodes;
    const selKeys = sel ? Object.keys(sel) : [];
    if (selKeys.length === 1) {
      draggedNode = sel[selKeys[0]];
    } else if (selKeys.length > 1) {
      // Multi-select drag - pick first selected as anchor so dragInfo can
      // initialise on tick 0 (cache empty here). Multi mode is detected
      // below via the selected_nodes membership check, regardless of which
      // selected node ends up as the anchor each tick.
      draggedNode = sel[selKeys[0]];
    } else if (c.node_over) {
      draggedNode = c.node_over;
    } else if (c.graph?.getNodeOnPos && c.graph_mouse) {
      draggedNode = c.graph.getNodeOnPos(c.graph_mouse[0], c.graph_mouse[1]);
    }
  }
  // Refresh the per-node cache for next tick. Done on EVERY tick (even the
  // no-node ones below) so the next tick always has a fresh baseline to diff.
  if (c.graph?._nodes) {
    if (!state._prevNodeStates) state._prevNodeStates = new Map();
    state._prevNodeStates.clear();
    for (const n of c.graph._nodes) {
      state._prevNodeStates.set(n.id, { x: n.pos[0], y: n.pos[1], w: n.size[0], h: n.size[1] });
    }
  }
  // No node moved this tick (tick-0 warm-up, a stationary pause, or a Vue
  // marquee/pan). Clear any guides but DON'T resetDrag - that wipes the cache we
  // just refreshed, and the next tick could then never detect movement (the
  // bug that broke Align entirely in Nodes 2.0: every tick-0 cleared the cache).
  if (!draggedNode) {
    if (state.activeGuides.length) { state.activeGuides = []; c.setDirty?.(true, true); }
    return;
  }

  // A PINNED node is locked (flags.pinned): native LiteGraph won't drag it, so
  // Align must not either. If the node we identified as dragged is pinned, stand
  // down for this gesture. (A multi-select where only SOME members are pinned is
  // handled below by excluding the pinned ones from the moving set.)
  if (draggedNode.flags?.pinned) {
    state.dragInfo = null;
    if (state.activeGuides.length) { state.activeGuides = []; c.setDirty?.(true, true); }
    return;
  }

  // Multi-select detection. If 2+ nodes (collapsed included) are selected AND the
  // identified draggedNode is in that selection, the drag is treated as a
  // rigid bbox move where the cursor delta moves every selected node by the
  // same amount and snap is computed on the bbox edges/centers.
  // Resize cannot be multi (LiteGraph has no multi-resize), so multi-select
  // implies move-only.
  let multiNodes = null;
  {
    const sel = c.selected_nodes;
    if (sel) {
      const selVals = Object.values(sel);
      if (selVals.length > 1 && selVals.includes(draggedNode)) {
        // Exclude PINNED nodes from the moving set - they stay locked even when an
        // unpinned sibling in the selection is dragged (native LiteGraph skips them).
        const live = selVals.filter((n) => n && !(n.flags && n.flags.pinned));
        if (live.length > 1) multiNodes = live;
      }
    }
  }

  const scale = c.ds?.scale || 1;
  const snapGraph = state.snapDistPx / scale;

  // Capture drag origin on first tick (or whenever the drag session changes).
  // last_mouse_dragging is set for ANY drag (node move, resize, canvas pan,
  // resize of an unrelated node, etc.). We have to classify the drag before
  // applying any correction. Classification:
  //   - "move":   pos changed, size unchanged    -> move snap
  //   - "resize": size changed (any corner/edge) -> resize snap on the
  //               specific edges that are moving (detected per tick)
  // Multi-select is locked to "move" at init since LiteGraph has no
  // multi-resize handle.
  //
  // Identity check: in multi mode the change-detect anchor can shift
  // tick-to-tick if iteration order of _nodes shifts, so we accept any
  // member of the captured origIds as the same session. Re-init only if
  // single<->multi flips or if a non-member node is dragged.
  const sessionMatches = state.dragInfo && (
    (multiNodes && state.dragInfo.multiSelect && state.dragInfo.origIds?.has(draggedNode.id)) ||
    (!multiNodes && !state.dragInfo.multiSelect && state.dragInfo.nodeId === draggedNode.id)
  );
  if (!sessionMatches) {
    if (multiNodes) {
      const origPositions = new Map();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of multiNodes) {
        origPositions.set(n.id, { x: n.pos[0], y: n.pos[1] });
        const r = nodeRect(n); // collapse-aware visual rect
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.w);
        maxY = Math.max(maxY, r.y + r.h);
      }
      state.dragInfo = {
        nodeId: draggedNode.id,
        cursorX: e.clientX,
        cursorY: e.clientY,
        lockType: "move",
        multiSelect: true,
        origPositions,
        origBBox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        origIds: new Set(multiNodes.map((n) => n.id)),
        stickyMoveX: null, stickyMoveY: null,
      };
    } else {
      state.dragInfo = {
        nodeId: draggedNode.id,
        posX: draggedNode.pos[0],
        posY: draggedNode.pos[1],
        cursorX: e.clientX,
        cursorY: e.clientY,
        sizeW: draggedNode.size[0],
        sizeH: draggedNode.size[1],
        lockType: null,
        multiSelect: false,
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
    }
    return;
  }

  // Classify the drag once, lock that classification for the rest of the drag.
  if (!state.dragInfo.lockType) {
    const sizeChanged = draggedNode.size[0] !== state.dragInfo.sizeW || draggedNode.size[1] !== state.dragInfo.sizeH;
    if (vue) {
      // Vue's MOVE drag doesn't mutate node._pos (it writes the reactive layout
      // store), so the posChanged test can never fire. Lock to "move" unless
      // node._size changed (a RESIZE does update _size) - then leave it null so
      // we never move a node mid-resize. (Vue resize uses a separate mechanism
      // Align doesn't snap; move is the supported case.)
      if (!sizeChanged) state.dragInfo.lockType = "move";
    } else {
      const posChanged = draggedNode.pos[0] !== state.dragInfo.posX || draggedNode.pos[1] !== state.dragInfo.posY;
      if (sizeChanged)         state.dragInfo.lockType = "resize";
      else if (posChanged)     state.dragInfo.lockType = "move";
      // else: neither has changed yet; wait
    }
  }

  if (state.dragInfo.lockType === null) return;

  if (state.dragInfo.lockType === "resize") {
    // All edges below are in VISUAL coords (top includes the title bar) so
    // they line up with other nodes' visual edges from nodeRect().
    const titleH = getTitleH(draggedNode);
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
    const targets = alignTargets(c);
    let snapLeft = null, snapRight = null, snapTop = null, snapBot = null;
    const tryTarget = (curBest, t, value, sticky, rect) => {
      const d = t - value;
      const allowed = (sticky != null && Math.abs(t - sticky) < 0.01) ? stickyG : snapGraph;
      if (Math.abs(d) <= allowed && (!curBest || Math.abs(d) < Math.abs(curBest.delta))) {
        return { delta: d, target: t, rect };
      }
      return curBest;
    };
    for (const tg of targets) {
      if (tg.ref === draggedNode) continue;
      if (tg.collapsed) continue;
      const oRect = tg.rect;
      const oE = rectEdges(oRect);
      if (leftMoves) {
        for (const t of [oE.left, oE.right, oE.centerX]) {
          snapLeft = tryTarget(snapLeft, t, dLeft, state.dragInfo.stickyResizeL, oRect);
        }
      }
      if (rightMoves) {
        for (const t of [oE.left, oE.right, oE.centerX]) {
          snapRight = tryTarget(snapRight, t, dRight, state.dragInfo.stickyResizeR, oRect);
        }
      }
      if (topMoves) {
        for (const t of [oE.top, oE.bottom, oE.centerY]) {
          snapTop = tryTarget(snapTop, t, dTop, state.dragInfo.stickyResizeT, oRect);
        }
      }
      if (botMoves) {
        for (const t of [oE.top, oE.bottom, oE.centerY]) {
          snapBot = tryTarget(snapBot, t, dBot, state.dragInfo.stickyResizeB, oRect);
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

    // Convert visual top back to body top by adding titleH. Legacy writes every
    // tick; Nodes 2.0 only corrects when an edge is snapped (applyNodeRect).
    applyNodeRect(
      draggedNode,
      fLeft, fTop + titleH, fRight - fLeft, fBot - (fTop + titleH),
      !!(snapLeft || snapRight || snapTop || snapBot),
    );

    // Push one guide per engaged edge. fLeft/fRight/fTop/fBot are visual
    // coords; matched rects (snapXxx.rect) are also visual via nodeRect().
    state.activeGuides = [];
    if (snapLeft && snapLeft.rect) {
      pushGuide("X", snapLeft.target, [
        Math.min(fTop, snapLeft.rect.y),
        Math.max(fBot, snapLeft.rect.y + snapLeft.rect.h),
      ]);
    }
    if (snapRight && snapRight.rect) {
      pushGuide("X", snapRight.target, [
        Math.min(fTop, snapRight.rect.y),
        Math.max(fBot, snapRight.rect.y + snapRight.rect.h),
      ]);
    }
    if (snapTop && snapTop.rect) {
      pushGuide("Y", snapTop.target, [
        Math.min(fLeft, snapTop.rect.x),
        Math.max(fRight, snapTop.rect.x + snapTop.rect.w),
      ]);
    }
    if (snapBot && snapBot.rect) {
      pushGuide("Y", snapBot.target, [
        Math.min(fLeft, snapBot.rect.x),
        Math.max(fRight, snapBot.rect.x + snapBot.rect.w),
      ]);
    }
    c.setDirty?.(true, true);
    return;
  }

  // From here, lockType === "move".

  if (state.dragInfo.multiSelect) {
    // Rigid bbox move: cursor delta drives the captured bounding box, snap is
    // computed on the bbox's six reference lines against every non-selected
    // node, and the resulting (cursor + snap) delta is applied uniformly to
    // each selected node from its original drag-start position. Selected
    // nodes never become snap targets (skipped via origIds).
    const di = state.dragInfo;
    const dxGraph = (e.clientX - di.cursorX) / scale;
    const dyGraph = (e.clientY - di.cursorY) / scale;
    const movingRect = {
      x: di.origBBox.x + dxGraph,
      y: di.origBBox.y + dyGraph,
      w: di.origBBox.w,
      h: di.origBBox.h,
    };
    const movingE = rectEdges(movingRect);
    const movingX = [movingE.left, movingE.right, movingE.centerX];
    const movingY = [movingE.top, movingE.bottom, movingE.centerY];
    const stickyG = snapGraph * 1.5;
    const allNodes = c.graph?._nodes || [];
    const targets = alignTargets(c);
    let bestX = null, bestXRect = null;
    let bestY = null, bestYRect = null;
    for (const tg of targets) {
      if (tg.kind === "node" && di.origIds.has(tg.id)) continue;
      if (tg.collapsed) continue;
      const oRect = tg.rect;
      const dxc = Math.max(0, Math.max(oRect.x - (movingRect.x + movingRect.w), movingRect.x - (oRect.x + oRect.w)));
      const dyc = Math.max(0, Math.max(oRect.y - (movingRect.y + movingRect.h), movingRect.y - (oRect.y + oRect.h)));
      if (dxc > 2 * stickyG && dyc > 2 * stickyG) continue;
      const oE = rectEdges(oRect);
      const mx = findClosestSnap(movingX, [oE.left, oE.right, oE.centerX], snapGraph, di.stickyMoveX, stickyG);
      if (mx && (!bestX || Math.abs(mx.delta) < Math.abs(bestX.delta))) { bestX = mx; bestXRect = oRect; }
      const my = findClosestSnap(movingY, [oE.top, oE.bottom, oE.centerY], snapGraph, di.stickyMoveY, stickyG);
      if (my && (!bestY || Math.abs(my.delta) < Math.abs(bestY.delta))) { bestY = my; bestYRect = oRect; }
    }
    di.stickyMoveX = bestX ? bestX.target : null;
    di.stickyMoveY = bestY ? bestY.target : null;
    const finalDx = dxGraph + (bestX ? bestX.delta : 0);
    const finalDy = dyGraph + (bestY ? bestY.delta : 0);
    const multiSnapActive = !!(bestX || bestY);
    for (const n of allNodes) {
      if (!di.origIds.has(n.id)) continue;
      const orig = di.origPositions.get(n.id);
      if (!orig) continue;
      applyNodePos(n, orig.x + finalDx, orig.y + finalDy, multiSnapActive);
    }

    // Guides span the moved bbox plus the rect that produced the matching
    // edge, then extend over every other rect that shares the matched edge.
    // skipFn excludes selected nodes (the bbox already covers them) and the
    // rect that already established the guide's base range.
    const finalBBox = { x: di.origBBox.x + finalDx, y: di.origBBox.y + finalDy, w: di.origBBox.w, h: di.origBBox.h };
    state.activeGuides = [];
    if (bestX && bestXRect) {
      const range = extendGuideRange(
        "X", bestX.target,
        Math.min(finalBBox.y, bestXRect.y),
        Math.max(finalBBox.y + finalBBox.h, bestXRect.y + bestXRect.h),
        targets,
        (ref) => ref && di.origIds.has(ref.id),
      );
      pushGuide("X", bestX.target, range);
    }
    if (bestY && bestYRect) {
      const range = extendGuideRange(
        "Y", bestY.target,
        Math.min(finalBBox.x, bestYRect.x),
        Math.max(finalBBox.x + finalBBox.w, bestYRect.x + bestYRect.w),
        targets,
        (ref) => ref && di.origIds.has(ref.id),
      );
      pushGuide("Y", bestY.target, range);
    }
    c.setDirty?.(true, true);
    return;
  }

  // "Desired" position = where the cursor wants the node to be, with no snap.
  const totalDxScreen = e.clientX - state.dragInfo.cursorX;
  const totalDyScreen = e.clientY - state.dragInfo.cursorY;
  const desiredX = state.dragInfo.posX + totalDxScreen / scale;
  const desiredY = state.dragInfo.posY + totalDyScreen / scale;

  // Build moving rect at desired position. Use the VISUAL rect (including
  // the title bar above pos[1]) so snap aligns with what the user sees.
  // Collapse-aware moving rect: a collapsed node is just its title pill.
  const collapsed = !!draggedNode.flags?.collapsed;
  const TH = window.LiteGraph?.NODE_TITLE_HEIGHT || 30;
  const titleH = collapsed ? TH : getTitleH(draggedNode);
  const w = collapsed ? (draggedNode._collapsed_width || window.LiteGraph?.NODE_COLLAPSED_WIDTH || 80) : draggedNode.size[0];
  const h = collapsed ? 0 : draggedNode.size[1];
  const movingRect = { x: desiredX, y: desiredY - titleH, w, h: h + titleH };
  const movingE = rectEdges(movingRect);
  const movingX = [movingE.left, movingE.right, movingE.centerX];
  const movingY = [movingE.top, movingE.bottom, movingE.centerY];

  const stickyG = snapGraph * 1.5;
  const targets = alignTargets(c);
  let bestX = null, bestXRect = null;
  let bestY = null, bestYRect = null;
  for (const t of targets) {
    if (t.ref === draggedNode) continue;
    if (t.collapsed) continue;
    const oRect = t.rect;
    const dxc = Math.max(0, Math.max(oRect.x - (movingRect.x + movingRect.w), movingRect.x - (oRect.x + oRect.w)));
    const dyc = Math.max(0, Math.max(oRect.y - (movingRect.y + movingRect.h), movingRect.y - (oRect.y + oRect.h)));
    if (dxc > 2 * stickyG && dyc > 2 * stickyG) continue;
    const oE = rectEdges(oRect);
    const mx = findClosestSnap(movingX, [oE.left, oE.right, oE.centerX], snapGraph, state.dragInfo.stickyMoveX, stickyG);
    if (mx && (!bestX || Math.abs(mx.delta) < Math.abs(bestX.delta))) { bestX = mx; bestXRect = oRect; }
    const my = findClosestSnap(movingY, [oE.top, oE.bottom, oE.centerY], snapGraph, state.dragInfo.stickyMoveY, stickyG);
    if (my && (!bestY || Math.abs(my.delta) < Math.abs(bestY.delta))) { bestY = my; bestYRect = oRect; }
  }
  state.dragInfo.stickyMoveX = bestX ? bestX.target : null;
  state.dragInfo.stickyMoveY = bestY ? bestY.target : null;

  // Set node.pos: snap target if found, else desired position. In legacy this
  // OVERWRITES whatever LiteGraph set this tick (so cursor and node never drift
  // apart); in Nodes 2.0 we only correct when a snap is engaged (applyNodePos).
  const fx = bestX ? desiredX + bestX.delta : desiredX;
  const fy = bestY ? desiredY + bestY.delta : desiredY;
  applyNodePos(draggedNode, fx, fy, !!(bestX || bestY));

  // Build the visual rect at the FINAL (post-snap) position so the guide line
  // spans accurately. Use fx/fy (not draggedNode.pos, which in Nodes 2.0 is only
  // updated by the deferred rAF). Then extend over every other rect that shares
  // the matched edge so a column/row of 3+ shows one full guide.
  const finalRect = { x: fx, y: fy - titleH, w, h: h + titleH };
  state.activeGuides = [];
  if (bestX && bestXRect) {
    const range = extendGuideRange(
      "X", bestX.target,
      Math.min(finalRect.y, bestXRect.y),
      Math.max(finalRect.y + finalRect.h, bestXRect.y + bestXRect.h),
      targets,
      (ref) => ref === draggedNode,
    );
    pushGuide("X", bestX.target, range);
  }
  if (bestY && bestYRect) {
    const range = extendGuideRange(
      "Y", bestY.target,
      Math.min(finalRect.x, bestYRect.x),
      Math.max(finalRect.x + finalRect.w, bestYRect.x + bestYRect.w),
      targets,
      (ref) => ref === draggedNode,
    );
    pushGuide("Y", bestY.target, range);
  }
  c.setDirty?.(true, true);
}
