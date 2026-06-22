import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
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
// Live execution state (from ComfyUI api events) so a folded bar can show that a
// node inside it is currently running + its progress.
let _runningNodeId = null;
let _progress = null; // { value, max, node }

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
// Folded-bar "a node inside me is running right now" accent (success green).
const RUN_GREEN = "#3ec371";

const BTN_KEYS = ["mute", "bypass", "color", "collapse", "fold"];
const ICONS = {
  mute: "/pixaroma/assets/icons/ui/off.svg",
  bypass: "/pixaroma/assets/icons/ui/bypass.svg",
  color: "/pixaroma/assets/icons/ui/fill.svg",
  // Collapse toggle is a STATE-DEPENDENT glyph: minus = collapse (group expanded),
  // plus = expand (group collapsed). Clearer than fold-chevrons, which read like
  // an X at button size.
  collapse: "/pixaroma/assets/icons/ui/minus.svg",
  expand: "/pixaroma/assets/icons/ui/plus.svg",
  // Fold = collapse the WHOLE group to a slim bar (distinct from per-node collapse).
  fold: "/pixaroma/assets/icons/ui/fold.svg",
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
    installFoldHooks();
    installExecListeners();
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
  // Nested inside a folded group? Don't draw it at all (its nodes are already
  // hidden via the outer group's node list). Return BEFORE ctx.save so there is
  // nothing to balance.
  if (isHiddenGroup(group)) return;
  // Save canvas state FIRST - before any other work - so the draw wrapper's catch
  // can always balance exactly one ctx.save() if anything below throws. groupRect
  // (the only call above) returns null on bad input rather than throwing.
  ctx.save();
  // Folded? Draw the slim bar instead of the full group and bail. (drawFoldedBar
  // is the only call here; the wrapper's catch still balances this ctx.save().)
  if (isFolded(group)) { drawFoldedBar(group, gc, ctx, r); ctx.restore(); return; }
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
      // Balance paintGroup's ctx.save() so the native fallback (and the rest of
      // this frame's nodes/groups) render with a clean canvas state. restore() on
      // an already-balanced stack is a harmless no-op.
      try { ctx.restore(); } catch (_e) {}
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
  else if (key === "fold") toggleFold(group);
}

// =============================================================================
// Fold - collapse the WHOLE group to a slim bar (distinct from the per-node
// "collapse" button). Folding stores { nodes:[ids], box:[x,y,w,h] } on
// group.flags.pixFold (flags serialize natively, so a folded group reopens
// folded) and shrinks the group bounding to a bar. Member nodes are NOT moved on
// fold - they are hidden by dropping them from computeVisibleNodes (which drives
// node PAINT, the CLICK hit-test via getNodeOnPos(x,y,visible_nodes), AND the
// marquee). Their wires still render (drawConnections iterates graph._nodes), so
// a renderLink wrap reroutes any wire touching a hidden node onto the bar's edge
// and drops wires internal to the group. All verified against api-B1Iozgjo.js.
// (This pushes index.js over the ~400-line guideline; split into fold.mjs later.)
// =============================================================================
const FOLD_KEY = "pixFold";

function isFolded(g) { return !!(g && g.flags && g.flags[FOLD_KEY]); }

function findNode(graph, idStr) {
  if (!graph) return null;
  if (typeof graph.getNodeById === "function") {
    return graph.getNodeById(Number(idStr)) || graph.getNodeById(idStr) || null;
  }
  for (const n of graph._nodes || []) if (String(n.id) === String(idStr)) return n;
  return null;
}
function findGroup(gid) {
  if (gid == null) return null;
  for (const g of graphGroups(app.canvas)) if (g.id != null && String(g.id) === String(gid)) return g;
  return null;
}
// A group is "inside" another when its box sits fully within (and is smaller
// than) the other's. Folding an outer group tucks these away too - their member
// nodes are already hidden via the outer's node list, so leaving the inner group
// box drawn (empty) is the nested-group bug this fixes.
function groupInside(inner, outer) {
  const a = groupRect(inner), b = groupRect(outer);
  if (!a || !b) return false;
  const T = 4;
  return a.x >= b.x - T && a.y >= b.y - T && a.x + a.w <= b.x + b.w + T &&
    a.y + a.h <= b.y + b.h + T && a.w * a.h <= b.w * b.h;
}
function containedGroups(G) {
  const out = [];
  for (const g of graphGroups(app.canvas)) {
    if (g === G || g.id == null) continue;
    if (groupInside(g, G)) out.push(g);
  }
  return out;
}

// Write group geometry IN PLACE - _pos/_size are often Float32Array subarray
// views of _bounding, so set all three (Align Pattern #18: never Array.isArray a
// typed array; arrLike handles it).
function setGroupRect(g, x, y, w, h) {
  if (arrLike(g._bounding, 4)) { g._bounding[0] = x; g._bounding[1] = y; g._bounding[2] = w; g._bounding[3] = h; }
  if (arrLike(g._pos, 2)) { g._pos[0] = x; g._pos[1] = y; }
  if (arrLike(g._size, 2)) { g._size[0] = w; g._size[1] = h; }
}

// Per-frame cache, rebuilt by the computeVisibleNodes wrap (once/frame) and on
// fold/unfold/drag. { hiddenSet:Set<idStr>, hiddenNodes:[{node,rect,group}],
// info:Map<group,{count,inC,outC}> }
let _foldFrameMaps = null;
function invalidateFold() { _foldFrameMaps = null; }
function buildFoldMaps() {
  const graph = app.canvas?.graph;
  const hiddenSet = new Set();
  const hiddenNodes = [];
  const hiddenGroups = new Set();
  const info = new Map();
  for (const g of graphGroups(app.canvas)) {
    const f = g?.flags?.[FOLD_KEY];
    if (!f || !Array.isArray(f.nodes)) continue;
    const memberSet = new Set(f.nodes.map(String));
    const gi = { count: f.nodes.length, inC: 0, outC: 0 };
    info.set(g, gi);
    if (Array.isArray(f.groups)) for (const gid of f.groups) hiddenGroups.add(String(gid));
    for (const idStr of f.nodes) {
      const n = findNode(graph, idStr);
      if (!n || !n.pos || !n.size) continue;
      hiddenSet.add(String(n.id));
      hiddenNodes.push({ node: n, rect: nodeVisualRect(n), group: g });
      // Crossing-wire counts via PUBLIC node methods (this fork does not expose
      // link.origin_id - verified - so we never read link fields).
      try {
        if (Array.isArray(n.inputs) && typeof n.getInputNode === "function") {
          for (let i = 0; i < n.inputs.length; i++) {
            if (n.inputs[i]?.link == null) continue;
            const src = n.getInputNode(i);
            if (src && !memberSet.has(String(src.id))) gi.inC++;
          }
        }
        if (Array.isArray(n.outputs) && typeof n.getOutputNodes === "function") {
          for (let o = 0; o < n.outputs.length; o++) {
            const links = n.outputs[o]?.links;
            if (!links || !links.length) continue;
            const tns = n.getOutputNodes(o);
            if (tns) for (const tn of tns) if (tn && !memberSet.has(String(tn.id))) gi.outC++;
          }
        }
      } catch (_e) {}
    }
  }
  return { hiddenSet, hiddenNodes, hiddenGroups, info };
}
function foldMaps() { if (!_foldFrameMaps) _foldFrameMaps = buildFoldMaps(); return _foldFrameMaps; }
function isHiddenGroup(g) { return !!(g && g.id != null && foldMaps().hiddenGroups.has(String(g.id))); }

// Hide a node's DOM widgets (Note / preview / our DOM-widget nodes) while folded;
// ComfyUI re-shows them when the node re-enters visible_nodes on unfold.
function hideNodeWidgets(n) {
  const ws = n?.widgets;
  if (!ws) return;
  for (const w of ws) {
    const el = w?.element;
    if (el && el.style && el.style.display !== "none") el.style.display = "none";
  }
}

function posXY(p) {
  if (!p) return null;
  if (typeof p[0] === "number") return [p[0], p[1]];
  if (typeof p.x === "number") return [p.x, p.y];
  return null;
}
function hitHidden(fm, p) {
  const xy = posXY(p);
  if (!xy) return null;
  const T = 3;
  for (const h of fm.hiddenNodes) {
    const r = h.rect;
    if (xy[0] >= r.x - T && xy[0] <= r.x + r.w + T && xy[1] >= r.y - T && xy[1] <= r.y + r.h + T) return h;
  }
  return null;
}
function barOut(g) { const r = groupRect(g); return r ? [r.x + r.w, r.y + r.h / 2] : null; }
function barIn(g) { const r = groupRect(g); return r ? [r.x, r.y + r.h / 2] : null; }

// The ► expand button on a folded bar - single source of truth for both the
// paint (drawFoldedBar) and the click hit-test (onFoldedBarPointerDown).
function foldChevronRect(r) {
  const s = Math.min(BTN, r.h - 6);
  return { x: r.x + 4, y: r.y + (r.h - s) / 2, w: s, h: s };
}

function _measCtx() {
  if (!_measCtx._c) _measCtx._c = document.createElement("canvas").getContext("2d");
  return _measCtx._c;
}
function computeBarWidth(group) {
  const oc = _measCtx();
  oc.font = `600 ${TITLE_FONT}px ${window.LiteGraph?.GROUP_FONT || "Arial"}`;
  const tw = oc.measureText(group.title || "Group").width;
  // chevron + title + count badge + links hint + side dots + pads
  return Math.round(Math.max(180, PAD + 14 + tw + 16 + 34 + 58 + PAD));
}

function foldGroup(group) {
  const r = groupRect(group);
  if (!r) return;
  const members = containedNodes(group);
  const grps = containedGroups(group).filter((g) => g.id != null);
  group.flags = group.flags || {};
  group.flags[FOLD_KEY] = {
    v: 1,
    nodes: members.map((n) => String(n.id)),
    groups: grps.map((g) => String(g.id)),
    box: [r.x, r.y, r.w, r.h],
  };
  setGroupRect(group, r.x, r.y, computeBarWidth(group), TITLE_H());
  invalidateFold();
  app.graph?.setDirtyCanvas?.(true, true);
  try { app.graph?.change?.(); } catch (_e) {}
}
function unfoldGroup(group) {
  const f = group.flags?.[FOLD_KEY];
  if (f && arrLike(f.box, 4)) setGroupRect(group, f.box[0], f.box[1], f.box[2], f.box[3]);
  if (group.flags) delete group.flags[FOLD_KEY];
  invalidateFold();
  app.graph?.setDirtyCanvas?.(true, true);
  try { app.graph?.change?.(); } catch (_e) {}
}
function toggleFold(group) { if (isFolded(group)) unfoldGroup(group); else foldGroup(group); }

// Track which node is executing (so a folded bar can light up + name it). Uses
// ComfyUI's reliable api events (Vue Compat #4). detail can be a bare id or an
// object { node }, and a null id = that prompt finished.
let _execListenersInstalled = false;
function installExecListeners() {
  if (_execListenersInstalled || !api?.addEventListener) return;
  const repaint = () => app.canvas?.setDirty?.(true, true);
  const clear = () => { _runningNodeId = null; _progress = null; repaint(); };
  api.addEventListener("executing", (e) => {
    const d = e?.detail;
    _runningNodeId = d && typeof d === "object" ? d.node : d;
    if (_runningNodeId == null) _progress = null;
    repaint();
  });
  api.addEventListener("progress", (e) => {
    const d = e?.detail || {};
    const node = d.node != null ? d.node : _runningNodeId;
    _progress = { value: Number(d.value) || 0, max: Number(d.max) || 0, node };
    repaint();
  });
  api.addEventListener("execution_start", clear);
  api.addEventListener("execution_success", clear);
  api.addEventListener("execution_error", clear);
  api.addEventListener("execution_interrupted", clear);
  _execListenersInstalled = true;
}

// The slim bar drawn in place of a folded group (called from paintGroup).
function drawFoldedBar(group, gc, ctx, r) {
  const { x, y, w, h } = r;
  const ea = gc?.editor_alpha != null ? gc.editor_alpha : 1;
  const color = group.color || NEUTRAL;
  const ink = pickInk(color);
  const inkWhite = ink === "#ffffff";
  const cy = y + h / 2;
  const gi = foldMaps().info.get(group) || { count: group.flags?.[FOLD_KEY]?.nodes?.length || 0, inC: 0, outC: 0 };
  const GF = window.LiteGraph?.GROUP_FONT || "Arial";

  // Is a node inside this folded group executing right now? (member list includes
  // any nested groups' nodes too, so the outer bar lights up for nested runs.)
  const fk = group.flags?.[FOLD_KEY];
  const memberIds = fk && Array.isArray(fk.nodes) ? fk.nodes : [];
  const running = _runningNodeId != null && memberIds.some((id) => String(id) === String(_runningNodeId));
  const runNode = running ? findNode(app.canvas?.graph, _runningNodeId) : null;
  const runTitle = running ? (runNode?.title || runNode?.type || "running") : "";
  const prog = running && _progress && _progress.max > 0 && String(_progress.node) === String(_runningNodeId)
    ? Math.max(0, Math.min(1, _progress.value / _progress.max)) : null;

  rr(ctx, x + 0.5, y + 0.5, w, h, RADIUS);
  ctx.globalAlpha = 0.92 * ea; ctx.fillStyle = color; ctx.fill();
  rr(ctx, x + 0.5, y + 0.5, w, h, RADIUS);
  ctx.globalAlpha = 0.55 * ea; ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
  ctx.globalAlpha = ea;

  // Running: a green border so the user can spot the active group at a glance.
  if (running) {
    rr(ctx, x + 0.5, y + 0.5, w, h, RADIUS);
    ctx.globalAlpha = ea; ctx.lineWidth = 2.5; ctx.strokeStyle = RUN_GREEN; ctx.stroke();
  }

  if (group.selected) {
    rr(ctx, x - 1.5, y - 1.5, w + 3, h + 3, RADIUS + 2);
    ctx.lineWidth = 2; ctx.strokeStyle = BRAND; ctx.stroke();
  }

  // Expand button: a ► chevron the user clicks to reopen, with a hover highlight
  // (matches the header buttons) so it clearly reads as a button. Double-clicking
  // anywhere on the bar still works too.
  const cr = foldChevronRect(r);
  const cur = state.cursor;
  const chHover = !!(cur && cur.gx >= cr.x && cur.gx <= cr.x + cr.w && cur.gy >= cr.y && cur.gy <= cr.y + cr.h);
  if (chHover) {
    rr(ctx, cr.x, cr.y, cr.w, cr.h, 5);
    ctx.globalAlpha = 0.16 * ea; ctx.fillStyle = inkWhite ? "#ffffff" : "#000000"; ctx.fill();
    ctx.globalAlpha = ea;
  }
  ctx.fillStyle = ink;
  const ccx = cr.x + cr.w / 2 - 2, chs = 4;
  ctx.beginPath();
  ctx.moveTo(ccx, cy - chs); ctx.lineTo(ccx + chs, cy); ctx.lineTo(ccx, cy + chs); ctx.closePath(); ctx.fill();

  // Side dots where the rerouted wires attach (left = incoming, right = outgoing).
  ctx.fillStyle = ink;
  if (gi.inC > 0) { ctx.beginPath(); ctx.arc(x, cy, 3.5, 0, Math.PI * 2); ctx.fill(); }
  if (gi.outC > 0) { ctx.beginPath(); ctx.arc(x + w, cy, 3.5, 0, Math.PI * 2); ctx.fill(); }

  ctx.textBaseline = "middle";
  let rightLimit = x + w - PAD;
  if (running) {
    // Show WHICH node is running (more useful than the link/count during a run).
    ctx.font = `${BADGE_FONT}px ${GF}`;
    ctx.fillStyle = RUN_GREEN; ctx.globalAlpha = ea; ctx.textAlign = "right";
    const rtMax = Math.max(40, x + w - PAD - (cr.x + cr.w + 4) - 60);
    const shown = ellipsize(ctx, "▶ " + runTitle, rtMax);
    ctx.fillText(shown, rightLimit, cy + 0.5);
    rightLimit -= ctx.measureText(shown).width + 8;
  } else {
    const links = gi.inC + gi.outC;
    if (links > 0) {
      ctx.font = `${BADGE_FONT - 1}px ${GF}`;
      const lstr = links + (links === 1 ? " link" : " links");
      const lw = ctx.measureText(lstr).width;
      ctx.fillStyle = ink; ctx.globalAlpha = 0.7 * ea; ctx.textAlign = "right";
      ctx.fillText(lstr, rightLimit, cy + 0.5);
      ctx.globalAlpha = ea;
      rightLimit -= lw + 8;
    }
    ctx.font = `${BADGE_FONT}px ${GF}`;
    const cstr = String(gi.count);
    const bw = ctx.measureText(cstr).width + 12;
    const bh = BADGE_FONT + 6;
    const badgeX = rightLimit - bw;
    if (badgeX > x + 44) {
      rr(ctx, badgeX, y + (h - bh) / 2, bw, bh, bh / 2);
      ctx.fillStyle = inkWhite ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.13)"; ctx.fill();
      ctx.fillStyle = ink; ctx.textAlign = "center";
      ctx.fillText(cstr, badgeX + bw / 2, cy + 0.5);
      rightLimit = badgeX - 6;
    }
  }
  ctx.font = `600 ${TITLE_FONT}px ${GF}`;
  ctx.fillStyle = ink; ctx.textAlign = "left";
  const titleX = cr.x + cr.w + 4;
  const title = ellipsize(ctx, group.title || "Group", rightLimit - titleX - 4);
  ctx.fillText(title, titleX, cy + 0.5);

  // Progress bar (steps etc.) along the bottom edge while a member runs.
  if (prog != null) {
    ctx.globalAlpha = ea; ctx.fillStyle = RUN_GREEN;
    ctx.fillRect(x + 1, y + h - 3, (w - 2) * prog, 2.5);
  }
}

// ── Folded-bar pointer handling: drag to move (member nodes ride along), quick
//    double-tap to unfold. We fully own the pointer here (the caller already
//    swallowed the event), so native group drag/rename never fires on the bar.
let _lastBarDown = { t: 0, g: null, moved: false };
function screenToGraph(c, ev) {
  const rect = c.canvas.getBoundingClientRect();
  const scale = c.ds?.scale || 1;
  const off = c.ds?.offset || [0, 0];
  return [(ev.clientX - rect.left) / scale - off[0], (ev.clientY - rect.top) / scale - off[1]];
}
function onFoldedBarPointerDown(e, group, c, gx, gy) {
  const f = group.flags?.[FOLD_KEY];
  const r0 = groupRect(group);
  if (!f || !r0) return;
  // Single-click the ► expand button = reopen (the discoverable path).
  const cr = foldChevronRect(r0);
  if (gx >= cr.x && gx <= cr.x + cr.w && gy >= cr.y && gy <= cr.y + cr.h) {
    _lastBarDown = { t: 0, g: null, moved: false };
    unfoldGroup(group);
    c.setDirty?.(true, true);
    return;
  }
  // Double-click anywhere on the bar also reopens.
  const now = typeof performance !== "undefined" ? performance.now() : 0;
  if (_lastBarDown.g === group && !_lastBarDown.moved && now - _lastBarDown.t < 340) {
    _lastBarDown = { t: 0, g: null, moved: false };
    unfoldGroup(group);
    c.setDirty?.(true, true);
    return;
  }
  _lastBarDown = { t: now, g: group, moved: false };
  const barW = r0.w, barH = r0.h, bx = r0.x, by = r0.y;
  const members = (Array.isArray(f.nodes) ? f.nodes : [])
    .map((id) => findNode(app.graph, id))
    .filter((n) => n && n.pos);
  const startPos = members.map((n) => [n.pos[0], n.pos[1]]);
  // Nested groups ride along too: capture each one's current box plus, if it is
  // itself folded, its stored restore box, so reopening stays aligned.
  const memberGroups = (Array.isArray(f.groups) ? f.groups : []).map(findGroup).filter(Boolean);
  const mgStart = memberGroups.map((g) => {
    const gr = groupRect(g);
    const inf = g.flags?.[FOLD_KEY];
    return {
      box: gr ? [gr.x, gr.y, gr.w, gr.h] : null,
      rbox: inf && arrLike(inf.box, 4) ? [inf.box[0], inf.box[1]] : null,
    };
  });
  const start = [gx, gy];
  let moved = false;
  const onMove = (ev) => {
    const p = screenToGraph(c, ev);
    const dx = p[0] - start[0], dy = p[1] - start[1];
    if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    moved = true; _lastBarDown.moved = true;
    setGroupRect(group, bx + dx, by + dy, barW, barH);
    for (let i = 0; i < members.length; i++) {
      members[i].pos[0] = startPos[i][0] + dx;
      members[i].pos[1] = startPos[i][1] + dy;
    }
    for (let i = 0; i < memberGroups.length; i++) {
      const s = mgStart[i];
      if (s.box) setGroupRect(memberGroups[i], s.box[0] + dx, s.box[1] + dy, s.box[2], s.box[3]);
      const inf = memberGroups[i].flags?.[FOLD_KEY];
      if (inf && s.rbox && arrLike(inf.box, 4)) { inf.box[0] = s.rbox[0] + dx; inf.box[1] = s.rbox[1] + dy; }
    }
    invalidateFold();
    c.setDirty?.(true, true);
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    if (moved) {
      const r2 = groupRect(group);
      if (f && arrLike(f.box, 4) && r2) { f.box[0] = r2.x; f.box[1] = r2.y; }
      try { app.graph?.change?.(); } catch (_e) {}
    }
  };
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
}

// =============================================================================
// The fold hooks (the heart of it). Verified against api-B1Iozgjo.js:
//  - computeVisibleNodes builds canvas.visible_nodes, which drives node PAINT,
//    the CLICK hit-test (getNodeOnPos(x,y,visible_nodes)) AND the marquee, so
//    dropping a node here hides it from all three at once.
//  - drawConnections iterates graph._nodes (NOT visible_nodes) and calls
//    this.renderLink(ctx, startPos, endPos, link, ...) per wire, so wrapping
//    renderLink lets us reroute a wire that touches a hidden node onto the bar
//    (identified positionally - link fields are not exposed in this fork) or
//    drop a wire that is internal to one folded group.
// =============================================================================
let _foldHooksInstalled = false;
let _origCVN = null;
let _origRenderLink = null;
function installFoldHooks() {
  if (_foldHooksInstalled) return;
  const Canvas = window.LiteGraph?.LGraphCanvas || window.LGraphCanvas;
  const proto = Canvas?.prototype;
  if (!proto) { console.warn("[Pixaroma.Groups] LGraphCanvas not found - fold disabled"); return; }

  if (typeof proto.computeVisibleNodes === "function") {
    _origCVN = proto.computeVisibleNodes;
    proto.computeVisibleNodes = function (nodes, out) {
      const res = _origCVN.call(this, nodes, out);
      if (!state.enabled || !Array.isArray(res)) return res;
      const fm = (_foldFrameMaps = buildFoldMaps());
      if (fm.hiddenSet.size) {
        for (let i = res.length - 1; i >= 0; i--) {
          if (fm.hiddenSet.has(String(res[i].id))) res.splice(i, 1);
        }
        for (const h of fm.hiddenNodes) hideNodeWidgets(h.node);
      }
      return res;
    };
  } else {
    console.warn("[Pixaroma.Groups] computeVisibleNodes not found - fold hide disabled");
  }

  if (typeof proto.renderLink === "function") {
    _origRenderLink = proto.renderLink;
    proto.renderLink = function (ctx, a, b, link, skipBorder, flow, color, startDir, endDir, opts) {
      if (state.enabled) {
        const fm = _foldFrameMaps || buildFoldMaps();
        if (fm.hiddenNodes.length) {
          const ah = hitHidden(fm, a);
          const bh = hitHidden(fm, b);
          if (ah && bh && ah.group === bh.group) return; // wire internal to a folded group
          if (ah || bh) {
            const na = ah ? barOut(ah.group) : a;
            const nb = bh ? barIn(bh.group) : b;
            let no = opts;
            if (opts) { no = Object.assign({}, opts); no.startControl = undefined; no.endControl = undefined; }
            return _origRenderLink.call(this, ctx, na || a, nb || b, link, skipBorder, flow, color, startDir, endDir, no);
          }
        }
      }
      return _origRenderLink.call(this, ctx, a, b, link, skipBorder, flow, color, startDir, endDir, opts);
    };
  } else {
    console.warn("[Pixaroma.Groups] renderLink not found - wire reroute disabled");
  }

  _foldHooksInstalled = true;
  console.log("[Pixaroma.Groups] fold hooks installed");
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
  // Clear stale hover state when disabled, so re-enabling doesn't briefly show
  // buttons at the last cursor spot before the next move updates it.
  if (!state.enabled) { state.cursor = null; _hoverGroupActive = false; return; }
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
    if (isHiddenGroup(g)) continue;
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
  // Folded bars first: they carry no header buttons, and we own their pointer
  // (drag to move, double-click to unfold). Bail as soon as one is hit.
  for (const g of graphGroups(c)) {
    if (!isFolded(g) || isHiddenGroup(g)) continue;
    const fr = groupRect(g);
    if (!fr) continue;
    if (gx >= fr.x && gx <= fr.x + fr.w && gy >= fr.y && gy <= fr.y + fr.h) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      onFoldedBarPointerDown(e, g, c, gx, gy);
      return;
    }
  }
  for (const g of graphGroups(c)) {
    if (isFolded(g) || isHiddenGroup(g)) continue;
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
