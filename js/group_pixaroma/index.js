import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";

// =============================================================================
// Group Pixaroma - a nicer look + quick actions for ComfyUI groups.
//
// No new node: this is a canvas feature (like Align / Node Colors). We override
// the ONE function ComfyUI uses to paint a group - LGraphGroup.prototype.draw -
// which is canvas-painted in BOTH the legacy and Nodes 2.0 renderers (groups are
// NOT Vue-rendered), so a single code path styles groups everywhere.
//
// The native draw signature (verified from the bundle source map,
// src/lib/litegraph/src/LGraphGroup.ts):
//     draw(graphCanvas, ctx)
//   - coords are GRAPH space (the ctx is already translated/scaled), so we use
//     group._pos / group._size directly, exactly like nodes do.
//   - graphCanvas.editor_alpha is the GLOBAL canvas dimmer (we multiply by it).
// NOTE: groups paint on the CACHED back canvas, which does NOT repaint on a
// plain mouse-move, so we can't rely on graph_mouse for hover here. We track the
// cursor from a window pointermove and nudge a back-canvas repaint while over a
// group (see onWindowPointerMove).
// draw() is purely COSMETIC - move / resize / rename are handled separately in
// the canvas pointer code by group geometry, so replacing the paint keeps all
// of those working. We only swallow a pointerdown when it lands on one of OUR
// header buttons (so the group doesn't start dragging under the click).
//
// Coloring (Option A): the group keeps its single native group.color (set via
// the existing Node Colors palette - serializes natively, travels in the file).
// We tint the header (solid) + interior (soft) from that one color; a global
// "interior strength" setting controls how strong the inside fill is (that
// replaces ComfyUI's fixed 25% transparency). Per-group strength can come later.
//
// Actions on the header bar (shown on hover/select): mute all, bypass all,
// color, collapse/expand all, plus an always-visible node-count badge.
// =============================================================================

const SETTING_ENABLED = "Pixaroma.Groups.Enabled";
const SETTING_STRENGTH = "Pixaroma.Groups.InteriorStrength";

const state = {
  enabled: true,
  interiorStrength: 0.12, // 0..0.4, from the strength setting / 100
  cursor: null,           // { gx, gy } in graph space, tracked from pointermove
};
// Declared up here (NOT next to applyResizeLength below) because ComfyUI can fire
// the Enabled setting's onChange -> applyResizeLength SYNCHRONOUSLY during
// registerExtension when a saved value is applied - which is before a `let`
// declared lower in the module would initialize. Accessing it then throws
// "Cannot access '_origResizeLength' before initialization" (TDZ).
let _origResizeLength = null;

// ── Layout constants (graph units) ───────────────────────────────────────────
const TITLE_H = () => window.LiteGraph?.NODE_TITLE_HEIGHT || 30;
const RADIUS = 8;
const PAD = 7;
const BTN = 20;
const BTN_GAP = 4;
const ICON = 13;
const TITLE_FONT = 15;
const BADGE_FONT = 12;
const RESIZE_GRAB = 20; // group-resize grab depth (px) + the visual hint size
// Fallback for a group with NO color set (ComfyUI "No Color"). A neutral slate
// grey so an uncolored group reads as colorless, not blue (the native default
// '#335' / our old '#3f789e' fallback made "No Color" groups look deliberately
// blue, which was confusing).
const NEUTRAL = "#58585e";

const BTN_KEYS = ["mute", "bypass", "color", "collapse"];
const ICONS = {
  mute: "/pixaroma/assets/icons/ui/off.svg",
  bypass: "/pixaroma/assets/icons/ui/bypass.svg",
  color: "/pixaroma/assets/icons/ui/fill.svg",
  // Collapse toggle is a STATE-DEPENDENT glyph: minus = collapse (group expanded),
  // plus = expand (group collapsed). Clearer than fold-chevrons, which read like
  // an X at button size.
  collapse: "/pixaroma/assets/icons/ui/minus.svg",
  expand: "/pixaroma/assets/icons/ui/plus.svg",
};

// =============================================================================
// Extension + settings
// =============================================================================
app.registerExtension({
  name: "Pixaroma.Groups",
  settings: [
    {
      id: SETTING_ENABLED,
      name: "Group Pixaroma styling",
      type: "boolean",
      defaultValue: true,
      category: ["👑 Pixaroma", "Groups"],
      tooltip:
        "Restyle ComfyUI groups: rounded corners, a colored header bar with the group title + node count, and hover buttons to mute / bypass / color / collapse the whole group. Turn off to use ComfyUI's native group look.",
      onChange: (v) => {
        state.enabled = !!v;
        applyResizeLength();
        app.canvas?.setDirty?.(true, true);
      },
    },
    {
      id: SETTING_STRENGTH,
      name: "Group interior strength",
      type: "slider",
      defaultValue: 12,
      attrs: { min: 0, max: 40, step: 1 },
      category: ["👑 Pixaroma", "Groups (fill)"],
      tooltip:
        "How strong the interior fill of a group is (0 = transparent, 40 = bold). Replaces ComfyUI's fixed group transparency.",
      onChange: (v) => {
        const n = Number(v);
        if (Number.isFinite(n)) state.interiorStrength = Math.max(0, Math.min(40, n)) / 100;
        app.canvas?.setDirty?.(true, true);
      },
    },
  ],
  setup() {
    const s = app.ui?.settings;
    if (s) {
      const en = s.getSettingValue(SETTING_ENABLED);
      state.enabled = en === undefined ? true : !!en;
      const d = Number(s.getSettingValue(SETTING_STRENGTH));
      if (Number.isFinite(d)) state.interiorStrength = Math.max(0, Math.min(40, d)) / 100;
    }
    installDrawOverride();
    applyResizeLength();
    installPointerHook();
    // Warm the icon cache so the first hover doesn't flash empty buttons.
    for (const url of Object.values(ICONS)) getRawImg(url);
    console.log("[Pixaroma.Groups] setup: enabled =", state.enabled, "strength =", state.interiorStrength);
  },
});

// =============================================================================
// Group geometry (Float32Array-safe, mirrors Align's helpers). litegraph stores
// _pos/_size/_bounding as Float32Array (often subarray views), so Array.isArray
// is FALSE for them - test array-LIKE instead.
// =============================================================================
function arrLike(v, n) { return v != null && typeof v.length === "number" && v.length >= n; }
function groupRect(g) {
  let x, y, w, h;
  if (arrLike(g?._pos, 2)) { x = g._pos[0]; y = g._pos[1]; }
  else if (arrLike(g?.pos, 2)) { x = g.pos[0]; y = g.pos[1]; }
  else if (arrLike(g?._bounding, 4)) { x = g._bounding[0]; y = g._bounding[1]; }
  else return null;
  if (arrLike(g?._size, 2)) { w = g._size[0]; h = g._size[1]; }
  else if (arrLike(g?.size, 2)) { w = g.size[0]; h = g.size[1]; }
  else if (arrLike(g?._bounding, 4)) { w = g._bounding[2]; h = g._bounding[3]; }
  else return null;
  return { x, y, w, h };
}
function graphGroups(c) { return c?.graph?._groups || c?.graph?.groups || []; }

// Which nodes "belong to" the group for the count + buttons. A group is a visual
// container, so we use OVERLAP: any node whose visual rect intersects the group
// box counts - so a tall node poking out the bottom edge is still collapsed /
// muted (the user's case). This is deliberately MORE inclusive than LiteGraph's
// own membership (which uses the node CENTER, and is what decides group-DRAG), so
// a node that is mostly outside but overlapping will be affected by the buttons
// even though it won't move when you drag the group. The rect is collapse-aware
// via node.boundingRect (a collapsed node's rect is just its title pill); read
// only, no recomputeInsideNodes() side effects.
function nodeVisualRect(n) {
  const br = n.boundingRect;
  if (br && br.length >= 4) return { x: br[0], y: br[1], w: br[2], h: br[3] };
  const th = window.LiteGraph?.NODE_TITLE_HEIGHT || 30;
  if (n.flags?.collapsed) {
    const cw = n._collapsed_width || window.LiteGraph?.NODE_COLLAPSED_WIDTH || 80;
    return { x: n.pos[0], y: n.pos[1] - th, w: cw, h: th };
  }
  return { x: n.pos[0], y: n.pos[1] - th, w: n.size[0], h: n.size[1] + th };
}
function containedNodes(group) {
  const c = app.canvas;
  const nodes = c?.graph?._nodes || [];
  const r = groupRect(group);
  if (!r) return [];
  const out = [];
  for (const n of nodes) {
    if (!n.pos || !n.size) continue;
    const nr = nodeVisualRect(n);
    // Rect-intersection: node overlaps the group box on both axes.
    if (nr.x < r.x + r.w && nr.x + nr.w > r.x && nr.y < r.y + r.h && nr.y + nr.h > r.y) out.push(n);
  }
  return out;
}

// =============================================================================
// Icon cache: rasterize each mask-style SVG once, then tint it to a given ink
// color via 'source-in' (same effect as CSS mask-image + background-color).
// Returns null until the image has loaded (a redraw is requested on load).
// =============================================================================
const _iconImgs = {};   // url -> { img, loaded, err }
const _tintCache = {};  // url|hex -> canvas
function getRawImg(url) {
  let e = _iconImgs[url];
  if (!e) {
    e = { img: new Image(), loaded: false, err: false };
    e.img.onload = () => { e.loaded = true; app.canvas?.setDirty?.(true, true); };
    e.img.onerror = () => { e.err = true; };
    e.img.src = url;
    _iconImgs[url] = e;
  }
  return e;
}
function tintedIcon(url, hex) {
  const key = url + "|" + hex;
  if (_tintCache[key]) return _tintCache[key];
  const e = getRawImg(url);
  if (!e.loaded) return null;
  const S = 64;
  const oc = document.createElement("canvas");
  oc.width = S; oc.height = S;
  const o = oc.getContext("2d");
  o.drawImage(e.img, 0, 0, S, S);
  o.globalCompositeOperation = "source-in";
  o.fillStyle = hex;
  o.fillRect(0, 0, S, S);
  _tintCache[key] = oc;
  return oc;
}

// =============================================================================
// Color helpers
// =============================================================================
function parseHex(c) {
  if (typeof c !== "string") return null;
  let h = c.trim();
  if (h[0] !== "#") return null;
  h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
// Ink (text/icon) color that reads on top of the colored header. Light header
// -> dark ink; dark/unknown header -> white ink.
function pickInk(color) {
  const c = parseHex(color);
  if (!c) return "#ffffff";
  const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  return lum > 150 ? "#1a1a1a" : "#ffffff";
}

function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// Top corners rounded, bottom square (the header strip).
function rrTop(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
function ellipsize(ctx, s, maxW) {
  if (maxW <= 0) return "";
  if (ctx.measureText(s).width <= maxW) return s;
  const ell = "…";
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(s.slice(0, mid) + ell).width <= maxW) lo = mid; else hi = mid - 1;
  }
  return lo > 0 ? s.slice(0, lo) + ell : "";
}

// =============================================================================
// Header layout - the single source of truth for button rects, used by BOTH the
// painter and the click hit-test (so they can never drift). All graph coords.
// Buttons are laid out right-aligned; they only PAINT on hover/select, but the
// rects always exist (when the header is wide enough to fit them).
// =============================================================================
function computeHeader(group) {
  const r = groupRect(group);
  if (!r) return null;
  const th = TITLE_H();
  const total = BTN_KEYS.length * BTN + (BTN_KEYS.length - 1) * BTN_GAP;
  const fits = r.w >= total + 70; // leave room for title + badge
  const by = r.y + (th - BTN) / 2;
  const buttons = [];
  if (fits) {
    let bx = r.x + r.w - PAD - total;
    for (const key of BTN_KEYS) {
      buttons.push({ key, x: bx, y: by, w: BTN, h: BTN });
      bx += BTN + BTN_GAP;
    }
  }
  const cur = state.cursor;
  const hover = !!(cur && cur.gx >= r.x && cur.gx <= r.x + r.w && cur.gy >= r.y && cur.gy <= r.y + r.h);
  const showButtons = fits && (hover || !!group.selected);
  return { x: r.x, y: r.y, w: r.w, h: r.h, th, buttons, fits, showButtons };
}

// =============================================================================
// The painter
// =============================================================================
function paintGroup(group, gc, ctx) {
  const r = groupRect(group);
  if (!r) return;
  const { x, y, w, h } = r;
  const ea = gc?.editor_alpha != null ? gc.editor_alpha : 1;
  const color = group.color || NEUTRAL;
  const ink = pickInk(color);
  const inkWhite = ink === "#ffffff";
  const th = TITLE_H();
  const head = computeHeader(group);

  const nodes = containedNodes(group);
  const count = nodes.length;
  const allMuted = count > 0 && nodes.every((n) => n.mode === 2);
  const allBypassed = count > 0 && nodes.every((n) => n.mode === 4);
  const allCollapsed = count > 0 && nodes.every((n) => !!n.flags?.collapsed);
  const active = { mute: allMuted, bypass: allBypassed, collapse: allCollapsed, color: false };

  ctx.save();

  // 1) Interior fill (whole body, rounded), at the user's strength.
  rr(ctx, x + 0.5, y + 0.5, w, h, RADIUS);
  ctx.globalAlpha = state.interiorStrength * ea;
  ctx.fillStyle = color;
  ctx.fill();

  // 2) Header bar (rounded top corners, square bottom), near-solid.
  rrTop(ctx, x + 0.5, y + 0.5, w, th, RADIUS);
  ctx.globalAlpha = 0.92 * ea;
  ctx.fillStyle = color;
  ctx.fill();

  // 3) Border.
  rr(ctx, x + 0.5, y + 0.5, w, h, RADIUS);
  ctx.globalAlpha = 0.55 * ea;
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();

  // 4) Resize hint (bottom-right). Sized to the (enlarged) grab zone and inset a
  // few px so it tucks inside the rounded corner instead of poking past it.
  const rInset = 4;
  const rLeg = RESIZE_GRAB - rInset;
  ctx.globalAlpha = 0.45 * ea;
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(x + w - rInset, y + h - rInset);
  ctx.lineTo(x + w - rInset - rLeg, y + h - rInset);
  ctx.lineTo(x + w - rInset, y + h - rInset - rLeg);
  ctx.closePath();
  ctx.fill();

  // 5) Selection outline.
  if (group.selected) {
    rr(ctx, x - 1.5, y - 1.5, w + 3, h + 3, RADIUS + 2);
    ctx.globalAlpha = ea;
    ctx.lineWidth = 2;
    ctx.strokeStyle = BRAND;
    ctx.stroke();
  }

  ctx.globalAlpha = ea;

  // 6) Count badge (always shown). Right-aligned: left of the buttons if shown,
  // else at the right edge.
  ctx.font = `${BADGE_FONT}px ${window.LiteGraph?.GROUP_FONT || "Arial"}`;
  const cstr = String(count);
  const ctw = ctx.measureText(cstr).width;
  const padX = 6;
  const bw = ctw + padX * 2;
  const bh = BADGE_FONT + 6;
  const rightLimit = head && head.showButtons ? head.buttons[0].x - BTN_GAP : x + w - PAD;
  const badgeX = rightLimit - bw;
  const badgeY = y + (th - bh) / 2;
  if (badgeX > x + PAD + 8) {
    rr(ctx, badgeX, badgeY, bw, bh, bh / 2);
    ctx.fillStyle = inkWhite ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.13)";
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cstr, badgeX + bw / 2, badgeY + bh / 2 + 0.5);
  }

  // 7) Title (left), truncated to the space before the badge.
  ctx.font = `600 ${TITLE_FONT}px ${window.LiteGraph?.GROUP_FONT || "Arial"}`;
  ctx.fillStyle = ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const titleX = x + PAD;
  const titleMax = (badgeX > x + PAD + 8 ? badgeX : rightLimit) - BTN_GAP - titleX;
  const title = ellipsize(ctx, group.title || "Group", titleMax);
  ctx.fillText(title, titleX, y + th / 2 + 0.5);

  // 8) Buttons (only on hover/select).
  if (head && head.showButtons) {
    const cur = state.cursor;
    for (const b of head.buttons) {
      const bhover = !!(cur && cur.gx >= b.x && cur.gx <= b.x + b.w && cur.gy >= b.y && cur.gy <= b.y + b.h);
      // Collapse shows its state through the icon (- / +), so it gets no "active"
      // background; mute / bypass keep the active fill so they read as ON.
      const showActive = b.key !== "collapse" && active[b.key];
      if (showActive || bhover) {
        rr(ctx, b.x, b.y, b.w, b.h, 5);
        ctx.globalAlpha = ea * (showActive ? 0.3 : 0.16);
        ctx.fillStyle = inkWhite ? "#ffffff" : "#000000";
        ctx.fill();
        ctx.globalAlpha = ea;
      }
      const iconUrl = b.key === "collapse"
        ? (active.collapse ? ICONS.expand : ICONS.collapse)
        : ICONS[b.key];
      const ic = tintedIcon(iconUrl, ink);
      if (ic) ctx.drawImage(ic, b.x + (b.w - ICON) / 2, b.y + (b.h - ICON) / 2, ICON, ICON);
    }
  }

  ctx.restore();
}

// =============================================================================
// Install the draw override (delegates to native when disabled or on error).
// =============================================================================
let _drawInstalled = false;
let _origDraw = null;
function installDrawOverride() {
  if (_drawInstalled) return;
  const GroupCls = window.LiteGraph?.LGraphGroup || window.LGraphGroup;
  if (!GroupCls?.prototype || typeof GroupCls.prototype.draw !== "function") {
    console.warn("[Pixaroma.Groups] LGraphGroup.draw not found - group styling disabled");
    return;
  }
  _origDraw = GroupCls.prototype.draw;
  GroupCls.prototype.draw = function (graphCanvas, ctx) {
    if (!state.enabled) return _origDraw.call(this, graphCanvas, ctx);
    try {
      paintGroup(this, graphCanvas, ctx);
    } catch (err) {
      console.warn("[Pixaroma.Groups] paint error, falling back to native", err);
      return _origDraw.call(this, graphCanvas, ctx);
    }
  };
  _drawInstalled = true;
  console.log("[Pixaroma.Groups] LGraphGroup.draw override installed");
}

// Enlarge the group-resize grab zone so the corner is easy to grab despite the
// rounded corners. LiteGraph's resize hit-test reads the static
// LGraphGroup.resizeLength (verified from the bundle); bump it while styling is
// enabled, restore the original when disabled. (_origResizeLength is declared at
// the TOP of the module - see the TDZ note there.)
function applyResizeLength() {
  const G = window.LiteGraph?.LGraphGroup || window.LGraphGroup;
  if (!G) return;
  if (_origResizeLength == null) _origResizeLength = G.resizeLength;
  G.resizeLength = state.enabled ? RESIZE_GRAB : (_origResizeLength != null ? _origResizeLength : 10);
}

// =============================================================================
// Actions
// =============================================================================
function toggleMode(group, mode) {
  const ns = containedNodes(group);
  if (!ns.length) return;
  const all = ns.every((n) => n.mode === mode);
  for (const n of ns) n.mode = all ? 0 : mode;
  app.graph?.setDirtyCanvas?.(true, true);
  try { app.graph?.change?.(); } catch (_e) {}
}
function toggleCollapse(group) {
  const ns = containedNodes(group);
  if (!ns.length) return;
  const target = !ns.every((n) => !!n.flags?.collapsed);
  for (const n of ns) {
    const cur = !!n.flags?.collapsed;
    if (cur !== target) {
      // Use the official collapse() (toggles) so Nodes 2.0 reactivity catches it.
      if (typeof n.collapse === "function") n.collapse();
      else { n.flags = n.flags || {}; n.flags.collapsed = target; }
    }
    n.setDirtyCanvas?.(true, true);
  }
  app.graph?.setDirtyCanvas?.(true, true);
}
function openColor(group) {
  const api = window.PixaromaGroupColors;
  if (api && typeof api.open === "function") {
    const targets = typeof api.getTargets === "function" ? api.getTargets(group) : [group];
    api.open(targets, group);
  } else {
    console.warn("[Pixaroma.Groups] group color palette unavailable (Node Colors not loaded?)");
  }
}
function runAction(key, group) {
  if (key === "mute") toggleMode(group, 2);
  else if (key === "bypass") toggleMode(group, 4);
  else if (key === "collapse") toggleCollapse(group);
  else if (key === "color") openColor(group);
}

// =============================================================================
// Click hit-test. Capture-phase window pointerdown runs BEFORE LiteGraph's own
// handler; when the click lands on one of our header buttons we run the action
// and stop the event so the group doesn't start dragging/renaming under it.
// (Same screen->graph transform Align uses: screen = (graph + offset) * scale.)
// =============================================================================
let _pointerInstalled = false;
let _hoverGroupActive = false;
function installPointerHook() {
  if (_pointerInstalled) return;
  window.addEventListener("pointerdown", onWindowPointerDown, true);
  // Track the cursor + nudge a back-canvas repaint while over a group, so the
  // hover-reveal buttons + per-button highlight update (the back canvas where
  // groups live is cached and does NOT repaint on plain mouse-move otherwise).
  window.addEventListener("pointermove", onWindowPointerMove, false);
  _pointerInstalled = true;
}
function onWindowPointerMove(e) {
  if (!state.enabled) return;
  const c = app.canvas;
  const canvasEl = c?.canvas;
  if (!canvasEl) return;
  const rect = canvasEl.getBoundingClientRect();
  const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
  if (!inside) {
    state.cursor = null;
    if (_hoverGroupActive) { _hoverGroupActive = false; c.setDirty?.(true, true); }
    return;
  }
  const scale = c.ds?.scale || 1;
  const off = c.ds?.offset || [0, 0];
  const gx = (e.clientX - rect.left) / scale - off[0];
  const gy = (e.clientY - rect.top) / scale - off[1];
  state.cursor = { gx, gy };
  let over = false;
  for (const g of graphGroups(c)) {
    const r = groupRect(g);
    if (r && gx >= r.x && gx <= r.x + r.w && gy >= r.y && gy <= r.y + r.h) { over = true; break; }
  }
  if (over) { _hoverGroupActive = true; c.setDirty?.(true, true); }
  else if (_hoverGroupActive) { _hoverGroupActive = false; c.setDirty?.(true, true); }
}
function onWindowPointerDown(e) {
  if (!state.enabled) return;
  if (e.button !== 0) return;
  const c = app.canvas;
  const canvasEl = c?.canvas;
  if (!canvasEl) return;
  // Only act when the pointer is over a <canvas> (the LiteGraph graph canvas in
  // legacy; Nodes 2.0 may route through its own canvas). Never over a DOM panel
  // / dialog / widget (those are divs/inputs), so we can't hijack their clicks.
  const tgt = e.target;
  if (!(tgt === canvasEl || (tgt && tgt.tagName === "CANVAS"))) return;
  const rect = canvasEl.getBoundingClientRect();
  const scale = c.ds?.scale || 1;
  const off = c.ds?.offset || [0, 0];
  const gx = (e.clientX - rect.left) / scale - off[0];
  const gy = (e.clientY - rect.top) / scale - off[1];
  for (const g of graphGroups(c)) {
    const head = computeHeader(g);
    if (!head || !head.fits) continue;
    // Cheap reject: only the header band carries buttons.
    if (gy < head.y || gy > head.y + head.th || gx < head.x || gx > head.x + head.w) continue;
    for (const b of head.buttons) {
      if (gx >= b.x && gx <= b.x + b.w && gy >= b.y && gy <= b.y + b.h) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        runAction(b.key, g);
        c.setDirty?.(true, true);
        return;
      }
    }
  }
}
