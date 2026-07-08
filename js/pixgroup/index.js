import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { isVueNodes } from "../shared/index.mjs";
import { openHelpPopup } from "../shared/help.mjs";

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Pixaroma Group (custom) — PROTOTYPE                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// A group container that is ENTIRELY OURS — NOT ComfyUI's native LGraphGroup.
// Goal: no other extension (rgthree etc.) can decorate it, and we control
// every pixel + every behaviour. This prototype exists to test the FEEL of the
// custom interaction (drag-with-contained-nodes / resize / select) before we
// invest in porting fold / run / mute / color / Align onto it.
//
// • Data lives in graph.extra.pixaromaGroups (serialises into the workflow).
// • Rendered behind nodes by wrapping LGraphCanvas.prototype.drawGroups (the
//   same back-canvas pass native groups use — works in BOTH renderers).
// • Interaction via a window capture-phase pointerdown (the Align pattern):
//   grab the HEADER to move (contained nodes follow), the CORNER to resize.
// • Create / rename / delete via the canvas right-click menu.
//
// This is THE Pixaroma group system (the old native-group styling overlay was
// retired). It owns color (via the Node Colors palette, through the
// window.PixaromaNodeColors bridge), header buttons (Run/Mute/Bypass/Fold),
// multi-select, resize, duplicate, and nesting. Native ComfyUI groups still
// exist but render in ComfyUI's plain style.

const BRAND = "#f66744";
const RUN_GREEN = "#3ec371";  // a folded group lights up green while a member runs
const DEFAULT_COLOR = "#3f789e";
// Default look for a NEW Pixaroma group (neutral, user-chosen).
const DEF_TITLE = "#4a4a4e", DEF_BODY = "#2a2a2a";
const DEF_TITLE_A = 0.92, DEF_BODY_A = 0.5, DEF_FONT = 18;
const HANDLE = 18;      // bottom-right resize grab box, graph units
const MIN_W = 140, MIN_H = 80;

// Set by the execution listeners so a folded bar can show what's running inside it.
let _runningNodeId = null, _progress = null;

let _idc = 0;
// id = time + a per-session counter + a short random suffix, so ids stay unique
// even across a reload (the counter resets to 0 each load, and Date.now() is only
// ms-granular) — avoids a fresh group colliding with a saved group's id.
function newId() { return "pg_" + Date.now().toString(36) + "_" + (_idc++) + "_" + Math.random().toString(36).slice(2, 6); }

// The graph CURRENTLY shown on the canvas: the root, OR the subgraph you've
// entered. app.graph stays the ROOT even inside a subgraph (only app.canvas.graph
// follows the navigation), so EVERYTHING here that means "the graph I'm looking
// at" - the group array, member nodes, native groups - must read this, not
// app.graph. Reading app.graph was the bug where a parent's Pixaroma groups
// showed (and deleted) inside a subgraph.
function curGraph() {
  return app.canvas?.graph || app.graph;
}

// Our groups are stored PER-GRAPH on graph.extra.pixaromaGroups — each workflow
// tab AND each subgraph has its OWN array. ensureGroups() returns the CURRENT
// graph's array (curGraph(), NOT app.graph), creating it if absent. (Earlier this
// was a single module-global array shared by every graph AND aliased into each
// graph's extra; switching workflow tabs then leaked one workflow's groups onto
// another. Per-graph storage fixed the tab leak; reading curGraph() (v1.4.10)
// fixes the SUBGRAPH leak - app.graph stays the root inside a subgraph, so the
// reader drew/deleted the root's groups while you were inside the subgraph.)
function ensureGroups() {
  const g = curGraph();
  if (!g) return [];
  if (!g.extra) g.extra = {};
  if (!Array.isArray(g.extra.pixaromaGroups)) g.extra.pixaromaGroups = [];
  return g.extra.pixaromaGroups;
}

// ── color helpers ───────────────────────────────────────────────────────
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return { r: 63, g: 120, b: 158 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgba(hex, a) { const c = hexToRgb(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; }
function ink(hex) {
  const c = hexToRgb(hex);
  const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  return lum > 0.62 ? "#1a1a1a" : "#ffffff";
}

// ── header-button icons (SVGs tinted + drawn on the canvas) ──────────────
const ICON_BASE = "/pixaroma/assets/icons/ui/";
const BTN_ICONS = { run: "play", mute: "mute", bypass: "bypass", fold: "fold", unfold: "unfold" };
const _iconImgs = {};   // url -> { img, loaded, err }
const _tintCache = {};  // url|hex -> canvas
function getRawImg(url) {
  let e = _iconImgs[url];
  if (!e) {
    e = { img: new Image(), loaded: false, err: false };
    e.img.onload = () => { e.loaded = true; repaint(); };
    e.img.onerror = () => { e.err = true; };
    e.img.src = url;
    _iconImgs[url] = e;
  }
  return e;
}
function tintedIcon(name, hex) {
  const url = ICON_BASE + name + ".svg";
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
  o.fillStyle = hex; o.fillRect(0, 0, S, S);
  _tintCache[key] = oc;
  return oc;
}

// ── per-group style, with back-compat (prototype groups stored a single `color`
// → both title and body fall back to it; new groups carry separate fields).
function gTitleColor(g) { return g.titleColor || g.color || DEFAULT_COLOR; }
function gBodyColor(g)  { return g.bodyColor  || g.color || DEFAULT_COLOR; }
function gTitleAlpha(g) { return Number.isFinite(g.titleAlpha) ? g.titleAlpha : DEF_TITLE_A; }
function gBodyAlpha(g)  { return Number.isFinite(g.bodyAlpha)  ? g.bodyAlpha  : DEF_BODY_A; }
function gFontSize(g)   { return Number.isFinite(g.fontSize)   ? g.fontSize   : DEF_FONT; }
// Header bar grows with the title font so big text never clips.
function headerH(g) { return Math.round(Math.max(26, gFontSize(g) + 14)); }

// ── screen → graph coords (manual, reliable during Vue drags) ───────────
function screenToGraph(clientX, clientY) {
  const c = app.canvas;
  const el = c?.canvas, ds = c?.ds;
  if (!el || !ds) return null;
  const r = el.getBoundingClientRect();
  const scale = ds.scale || 1, off = ds.offset || [0, 0];
  return [(clientX - r.left) / scale - off[0], (clientY - r.top) / scale - off[1]];
}

// ── ComfyUI "Always snap to grid" support ──────────────────────────────────
// ComfyUI keeps these LiteGraph globals live from its settings: alwaysSnapToGrid
// (Settings > LiteGraph > Always snap to grid → pysssss.SnapToGrid) and
// CANVAS_GRID_SIZE (Comfy.SnapToGrid.GridSize). When the setting is on we round
// a group's moved/resized geometry to the grid, exactly like a dragged node.
function gridSnapOn() { const LG = window.LiteGraph; return !!(LG && LG.alwaysSnapToGrid); }
function gridSnap(v) { const LG = window.LiteGraph; const gs = (LG && LG.CANVAS_GRID_SIZE) || 10; return Math.round(v / gs) * gs; }

// ── geometry ────────────────────────────────────────────────────────────
function inRect(g, p)   { return p[0] >= g.x && p[0] <= g.x + g.w && p[1] >= g.y && p[1] <= g.y + g.h; }
function inHeader(g, p) { return p[0] >= g.x && p[0] <= g.x + g.w && p[1] >= g.y && p[1] <= g.y + headerH(g); }
// Which corner (if any) the point is over → 4-corner resize. Disabled when folded
// (the bar isn't resizable). Buttons are hit-tested BEFORE this, so the top-right
// corner only resizes where there isn't a button.
function cornerAt(g, p) {
  if (g.folded) return null;
  if (p[0] < g.x || p[0] > g.x + g.w || p[1] < g.y || p[1] > g.y + g.h) return null;
  const L = p[0] <= g.x + HANDLE, R = p[0] >= g.x + g.w - HANDLE;
  const T = p[1] <= g.y + HANDLE, B = p[1] >= g.y + g.h - HANDLE;
  if (T && L) return "tl"; if (T && R) return "tr";
  if (B && L) return "bl"; if (B && R) return "br";
  return null;
}
function cornerCursor(c) { return (c === "tl" || c === "br") ? "nwse-resize" : "nesw-resize"; }
function groupAt(p) {
  const gs = ensureGroups();
  for (let i = gs.length - 1; i >= 0; i--) if (!isHiddenGroup(gs[i]) && inRect(gs[i], p)) return gs[i];
  return null;
}

function nodeVisualBounds(n) {
  const titleH = (window.LiteGraph?.NODE_TITLE_HEIGHT) || 30;
  const collapsed = !!n.flags?.collapsed;
  const w = n.size?.[0] || 0;
  const bodyH = collapsed ? 0 : (n.size?.[1] || 0);
  return { x: n.pos[0], y: n.pos[1] - titleH, w, h: bodyH + titleH };
}
// Nodes whose visual center sits inside the group (matches LiteGraph's own
// "contains" rule used for group-drag).
function containedNodes(g) {
  const out = [];
  for (const n of (curGraph()?._nodes || [])) {
    const b = nodeVisualBounds(n);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h) out.push(n);
  }
  return out;
}

// ── fold state + members ──────────────────────────────────────────────────
// When folded the box is just the bar, so the live center-inside test finds no
// members; resolve the ids captured at fold time instead.
function groupMemberNodes(g) {
  if (g.folded && Array.isArray(g.foldNodes)) {
    const byId = {};
    for (const n of (curGraph()?._nodes || [])) byId[String(n.id)] = n;
    const out = [];
    for (const id of g.foldNodes) { const n = byId[String(id)]; if (n) out.push(n); }
    return out;
  }
  return containedNodes(g);
}

// Member COUNT for the badge — cached so drawOne doesn't full-scan every node on
// EVERY frame (a real cost on big graphs during a drag). Folded = the fixed
// foldNodes count (instant). The cache lives in a WeakMap, NOT on the group object,
// so it never serializes (which would bloat the workflow + falsely flag it modified)
// and is GC'd when a group is deleted. 200ms TTL: the number lags a few frames when
// a node enters/leaves, which is imperceptible for a count.
const _countCache = new WeakMap(); // group obj -> { count, at }
function memberCount(g) {
  if (g.folded) return Array.isArray(g.foldNodes) ? g.foldNodes.length : 0;
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
  const c = _countCache.get(g);
  if (c && now - c.at < 200) return c.count;
  const count = containedNodes(g).length;
  _countCache.set(g, { count, at: now });
  return count;
}

// Other Pixaroma groups whose CENTER sits inside g (nested groups). Moving g must
// carry their FRAMES along; their member nodes are already in g's node list, so we
// translate only the nested frames (no double-move of the nodes inside them).
function containedGroups(g) {
  const out = [];
  for (const o of ensureGroups()) {
    if (o === g) continue;
    // FULLY contained, not center-inside: a LARGER outer group's center can fall
    // inside a small inner group, which falsely made the inner "contain" the outer
    // (so moving/folding the inner dragged the outer along). Nesting = whole box in.
    if (o.x >= g.x && o.y >= g.y && o.x + o.w <= g.x + g.w && o.y + o.h <= g.y + g.h) out.push(o);
  }
  return out;
}

// ── Native ComfyUI groups (LGraphGroup) ───────────────────────────────────
// We never OWN them, but we wrap them (G) and carry our groups when they move.
function nativeGroups() {
  return curGraph()?._groups || curGraph()?.groups || [];
}
// A native group's box in graph coords. Its geometry is a Float32Array _pos/_size
// (views of _bounding); fall back to .pos/.size. NEVER Array.isArray a typed array.
function natGrpBox(grp) {
  const pos = grp._pos || grp.pos, size = grp._size || grp.size;
  if (!pos || pos.length < 2 || !size || size.length < 2) return null;
  return { x: pos[0], y: pos[1], w: size[0], h: size[1] };
}
// Boxes of the SELECTED native ComfyUI groups (selectedItems mixes nodes+groups).
function selectedNativeGroupBoxes() {
  const sel = app.canvas?.selectedItems;
  if (!sel || typeof sel.has !== "function") return [];
  const out = [];
  for (const grp of nativeGroups()) if (sel.has(grp)) { const b = natGrpBox(grp); if (b) out.push(b); }
  return out;
}
// The SELECTED native ComfyUI groups themselves (not just their boxes).
function selectedNativeGroups() {
  const sel = app.canvas?.selectedItems;
  if (!sel || typeof sel.has !== "function") return [];
  return nativeGroups().filter((grp) => sel.has(grp));
}
// Topmost native ComfyUI group whose box contains the graph-space point p, or null.
// Iterate last-to-first so the most-recently-drawn (top) group wins, matching what
// the user clicks. Used by the "Convert to Pixaroma Group" menu item.
function nativeGroupAt(p) {
  if (!p) return null;
  const groups = nativeGroups();
  for (let i = groups.length - 1; i >= 0; i--) {
    const grp = groups[i];
    const b = natGrpBox(grp);
    if (b && p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h) return grp;
  }
  return null;
}
// Remove a native ComfyUI group from the current graph (used by Convert). Prefer the
// graph's own remove() so any internal bookkeeping runs; fall back to splicing the
// _groups/groups array. NEVER Array.isArray a typed array, but _groups IS a plain array.
function removeNativeGroup(graph, grp) {
  if (!graph || !grp) return;
  try { if (typeof graph.remove === "function") { graph.remove(grp); return; } } catch (_e) { /* fall through */ }
  const arr = graph._groups || graph.groups;
  if (Array.isArray(arr)) { const i = arr.indexOf(grp); if (i >= 0) arr.splice(i, 1); }
}
// (nodesInBox — nodes whose visual center sits in a box — is defined once below,
// near the Group Switch helpers; reused here to carry a native group's contents.)
// Write a native group's top-left in place. Its _pos is a Float32Array (usually a
// subarray VIEW of _bounding, so writing _pos also updates _bounding) — NEVER
// Array.isArray it; write _bounding too in case they're separate arrays on some build.
function setNativeGroupPos(grp, x, y) {
  const pos = grp._pos || grp.pos;
  if (pos && pos.length >= 2) { pos[0] = x; pos[1] = y; }
  const b = grp._bounding;
  if (b && b.length >= 2) { b[0] = x; b[1] = y; }
}

// Set of all node ids hidden by folded groups + whether each owner shows wires.
// Cached; invalidated on fold / unfold / delete / configure (the id set only
// changes then — node moves don't change it).
let _hiddenCache = null;
function invalidateHidden() { _hiddenCache = null; }
function buildHidden() {
  const hidden = new Set();
  const owner = new Map(); // idStr -> the folded group hiding it (read .showLinks live)
  const hiddenGroups = new Set(); // group ids hidden because a folded ancestor contains them
  for (const g of ensureGroups()) {
    if (!g.folded || !Array.isArray(g.foldNodes)) continue;
    for (const id of g.foldNodes) { const s = String(id); hidden.add(s); if (!owner.has(s)) owner.set(s, g); }
    if (Array.isArray(g.foldGroups)) for (const gid of g.foldGroups) hiddenGroups.add(String(gid));
  }
  return { hidden, owner, hiddenGroups };
}
function hiddenMaps() { if (!_hiddenCache) _hiddenCache = buildHidden(); return _hiddenCache; }
function isHiddenGroup(g) { return hiddenMaps().hiddenGroups.has(String(g.id)); }
// Member groups (frames), folded-aware like groupMemberNodes.
function groupMemberGroups(g) {
  if (g.folded && Array.isArray(g.foldGroups)) {
    const all = ensureGroups(), out = [];
    for (const id of g.foldGroups) { const sg = all.find((o) => String(o.id) === String(id)); if (sg) out.push(sg); }
    return out;
  }
  return containedGroups(g);
}
// Bar attach points (graph coords) for rerouting a crossing wire onto a folded bar.
function barOut(g) { return [g.x + g.w, g.y + g.h / 2]; }
function barIn(g) { return [g.x, g.y + g.h / 2]; }

// ── drawing (graph-space ctx, behind nodes) ─────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// Rounded TOP corners, square bottom — the header strip shape. Painting this path
// directly (then fill) reproduces exactly what the old "clip to the full rounded
// box, then fillRect the header strip" produced, WITHOUT a per-frame rounded-rect
// clip over the whole box (rounded-rect clips force the 2D rasterizer onto a slow
// path scaled by the group's on-screen area — the main per-frame draw cost).
function roundRectTop(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

// Vertically center text by its ACTUAL glyph box. Digit-only / caps text drawn
// with textBaseline:"middle" floats visually high (the em box reserves descender
// space the glyphs don't use), so center by the measured ascent/descent instead.
function fillTextVCenter(ctx, text, x, yMid) {
  // Set the baseline BEFORE measuring: actualBoundingBox metrics are relative to
  // the current textBaseline, so measuring under a stale "middle" baseline (left
  // from the title draw) computed the wrong offset and put the digit ~3px high.
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(text);
  if (m.actualBoundingBoxAscent != null && m.actualBoundingBoxDescent != null) {
    ctx.fillText(text, x, yMid + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  } else {
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, yMid);
  }
}

let _selectedId = null;            // the PRIMARY selected group (last clicked) — drives palette values
let _selectedIds = new Set();      // ALL selected groups (multi-select via shift-click)
let _groupClipboard = null;        // copied group frames (Ctrl+C); frame/style only, not nodes
let _groupClipActive = false;      // true when OUR groups were the last Ctrl+C (so Ctrl+V is ours)
let _groupClipMixed = false;       // true when that Ctrl+C ALSO had native nodes selected (so Ctrl+V pastes our frame AND lets ComfyUI paste the nodes)
let _mixedCopyAnchor = null;       // top-left of the copied NODES' bbox at Ctrl+C time → align the pasted frame to ComfyUI's node shift
let _pasteSeq = 0;                 // cascades repeated Ctrl+V offsets WITHOUT mutating the clipboard
let _marqueeRect = null;           // last seen ComfyUI marquee rect [x,y,w,h]; add our groups on release
let _marqueeShift = false;         // was Shift held during the marquee (Shift = add to selection, plain = replace)
let _hoverId = null;        // group whose buttons are revealed (cursor inside it)
let _hotBtn = null;         // { gid, key } of the button under the cursor
let _hoverPt = null;        // last cursor pos in graph coords

// Header-button geometry — the SINGLE source for both paint + hit-test, so they
// can't drift. Buttons sit at the header's right; the count badge to their left.
// Folded → one Unfold button; expanded → Run / Mute / Bypass / Fold.
const BSZ = 18, BGAP = 4, BPAD = 8, BICON = 12;

// How much of the header chrome shows, set from the "Group header buttons"
// setting: "always" (everything visible), "compact" (Fold + count stay, the
// Run/Mute/Bypass actions reveal on hover/select — the default), or "hover"
// (EVERYTHING, including Fold + the count, hides until hover/select).
let _btnVis = "compact";
function mapBtnVis(v) { return v === "Always" ? "always" : v === "Hover only" ? "hover" : "compact"; }

function headerButtons(g, revealed) {
  const hH = headerH(g);
  const bw = 24, bh = 16;
  // In "hover" mode the count badge also hides until revealed; otherwise it is
  // ALWAYS flush in the top-right corner (never drifts as buttons appear).
  const showBadge = (_btnVis !== "hover") || revealed;
  const badge = { x: g.x + g.w - BPAD - bw, y: g.y + (hH - bh) / 2, w: bw, h: bh, show: showBadge };
  // RESERVE the badge's slot when folded (even while the badge is hidden) so the
  // lone Unfold button never shifts when the count badge pops in on hover — that
  // was the "button dodges" bug on a folded, hover-only group (Discord feedback).
  let rx = (g.folded || showBadge) ? badge.x - 6 : g.x + g.w - BPAD;
  let keys;
  if (g.folded) {
    keys = ["unfold"]; // a folded bar always keeps its one Unfold affordance
  } else {
    // "always" → all buttons; "compact" → Fold always, actions on reveal;
    // "hover" → Fold + actions both only on reveal.
    const showActions = (_btnVis === "always") || revealed;
    const showFold = (_btnVis !== "hover") || revealed;
    keys = [];
    if (showActions) keys.push("run", "mute", "bypass");
    if (showFold) keys.push("fold");
  }
  const by = g.y + (hH - BSZ) / 2;
  const btns = [];
  for (let i = keys.length - 1; i >= 0; i--) { rx -= BSZ; btns.unshift({ key: keys[i], x: rx, y: by, w: BSZ, h: BSZ }); rx -= BGAP; }
  const leftmost = btns.length ? btns[0].x : (showBadge ? badge.x : g.x + g.w - BPAD);
  const titleClipW = Math.max(20, leftmost - 6 - (g.x + 12));
  return { btns, badge, titleClipW };
}

function drawButton(ctx, b, g, tInk) {
  const hot = _hotBtn && _hotBtn.gid === g.id && _hotBtn.key === b.key;
  // Hover just LIGHTENS the chip a little (no orange fill); the icon keeps its ink.
  const light = tInk === "#ffffff";
  ctx.fillStyle = light
    ? (hot ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.13)")
    : (hot ? "rgba(0,0,0,0.30)" : "rgba(0,0,0,0.13)");
  roundRect(ctx, b.x, b.y, b.w, b.h, 4); ctx.fill();
  const ic = tintedIcon(BTN_ICONS[b.key], tInk);
  if (ic) ctx.drawImage(ic, b.x + (b.w - BICON) / 2, b.y + (b.h - BICON) / 2, BICON, BICON);
}

function drawOne(ctx, g) {
  const tColor = gTitleColor(g), bColor = gBodyColor(g);
  const tA = gTitleAlpha(g), bA = gBodyAlpha(g);
  const fs = gFontSize(g), hH = headerH(g);
  const sel = _selectedIds.has(g.id);
  const scale = app.canvas?.ds?.scale || 1;
  const tInk = ink(tColor);
  const showBtns = g.id === _hoverId || _selectedIds.has(g.id);
  const layout = headerButtons(g, showBtns);

  // Running indicator (folded only): is a hidden member executing right now? The
  // member list is fixed at fold time, so a folded bar lights up for its nodes.
  let running = false, runTitle = "", prog = null;
  if (g.folded && _runningNodeId != null && Array.isArray(g.foldNodes)) {
    const rid = String(_runningNodeId);
    // Match a member directly OR a node INSIDE a member subgraph (composite "id:inner"
    // ids), so the bar stays lit through a subgraph's run (e.g. the KSampler), not
    // just the top-level nodes — that's why only the VAE flashed before.
    let matchedId = null;
    for (const id of g.foldNodes) { const s = String(id); if (rid === s || rid.startsWith(s + ":")) { matchedId = s; break; } }
    if (matchedId != null) {
      running = true;
      const nodes = curGraph()?._nodes || [];
      const rn = nodes.find((n) => String(n.id) === rid) || nodes.find((n) => String(n.id) === matchedId);
      runTitle = (rn && (rn.title || rn.type)) || "running";
      if (_progress && _progress.max > 0 && String(_progress.node) === rid) {
        prog = Math.max(0, Math.min(1, _progress.value / _progress.max));
      }
    }
  }

  // interior fill (body color + body opacity) — when folded, g.h IS the bar height
  ctx.fillStyle = rgba(bColor, bA);
  roundRect(ctx, g.x, g.y, g.w, g.h, 8); ctx.fill();

  // header bar (title color + title opacity), rounded to match the top corners.
  // Painted as a rounded-TOP path (no full-box clip) — pixel-identical to the old
  // clip+fillRect but without the expensive per-frame rounded-rect clip.
  ctx.fillStyle = rgba(tColor, tA);
  roundRectTop(ctx, g.x, g.y, g.w, Math.min(hH, g.h), 8); ctx.fill();

  // border (from the title color; orange when selected; green while running)
  ctx.strokeStyle = sel ? BRAND : rgba(tColor, Math.max(0.5, tA));
  ctx.lineWidth = (sel ? 2.5 : 1.5) / scale;
  roundRect(ctx, g.x, g.y, g.w, g.h, 8); ctx.stroke();
  if (running) {
    ctx.strokeStyle = RUN_GREEN;
    ctx.lineWidth = 2.5 / scale;
    roundRect(ctx, g.x, g.y, g.w, g.h, 8); ctx.stroke();
  }

  // title — while a member runs, show "▶ <running node>" in green so a folded
  // group tells you what's busy (its nodes are hidden).
  ctx.save();
  ctx.beginPath(); ctx.rect(g.x, g.y, layout.titleClipW, hH); ctx.clip();
  ctx.fillStyle = running ? RUN_GREEN : tInk;
  ctx.font = `600 ${fs}px 'Segoe UI', system-ui, sans-serif`;
  ctx.textBaseline = "middle"; ctx.textAlign = "left";
  const _titleStr = running ? ("▶ " + runTitle) : ((g.pinned ? "📌 " : "") + (g.title || "Group"));
  ctx.fillText(_titleStr, g.x + 12, g.y + hH / 2 + 1);
  ctx.restore();

  // node-count badge (cached; see memberCount — avoids a full node scan per frame).
  // Hidden in "hover only" mode until the group is hovered/selected (badge.show).
  const bd = layout.badge;
  if (bd.show) {
    const count = memberCount(g);
    ctx.fillStyle = tInk === "#ffffff" ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.22)";
    roundRect(ctx, bd.x, bd.y, bd.w, bd.h, 8); ctx.fill();
    ctx.fillStyle = tInk;
    ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    fillTextVCenter(ctx, String(count), bd.x + bd.w / 2, bd.y + bd.h / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
  }

  // header buttons (fold/unfold always shown; Run/Mute/Bypass reveal on hover/select)
  for (const b of layout.btns) drawButton(ctx, b, g, tInk);

  // progress bar along the bottom edge of a running folded bar
  if (prog != null) {
    ctx.fillStyle = RUN_GREEN;
    ctx.fillRect(g.x + 2, g.y + hH - 3, (g.w - 4) * prog, 2.5);
  }

  // resize handle (bottom-right) — not while folded (the bar isn't resizable).
  // Corner vertex pulled onto the r=8 rounded corner (inset = 8*(1-1/√2)) so the
  // triangle stays inside the rounded box WITHOUT a per-frame full-box clip.
  if (!g.folded) {
    const inset = 8 * (1 - Math.SQRT1_2);
    ctx.fillStyle = rgba(tColor, sel ? 1 : 0.85);
    ctx.beginPath();
    ctx.moveTo(g.x + g.w, g.y + g.h - HANDLE);
    ctx.lineTo(g.x + g.w - inset, g.y + g.h - inset);
    ctx.lineTo(g.x + g.w - HANDLE, g.y + g.h);
    ctx.closePath();
    ctx.fill();
  }
}

// Draw via the canvas's onDrawBackground hook (graph-space ctx, behind nodes) —
// NOT a wrap of drawGroups. LiteGraph SKIPS drawGroups entirely when there are
// zero NATIVE groups, so a wrap there stops firing the instant the last ComfyUI
// group is deleted and our groups appear "deleted" (they were only unpainted).
// onDrawBackground runs every back-canvas redraw regardless of group count, in
// both renderers, with the transform already applied.
function installDraw() {
  const c = app.canvas;
  if (!c) { setTimeout(installDraw, 150); return; }
  if (c._pixGroupBgWrapped) return;
  const prev = (typeof c.onDrawBackground === "function") ? c.onDrawBackground.bind(c) : null;
  c.onDrawBackground = function (ctx, area) {
    if (prev) { try { prev(ctx, area); } catch (_e) {} }
    // Apply the node / native-group carry HERE, inside the bg draw pass, in BOTH renderers,
    // reading the dragged node's / Comfy group's LIVE position. Drawing the carried pixgroup
    // frames in the SAME pass the Comfy group + the nodes are drawn with keeps everything in
    // sync — the frame can't lead (synchronous-draw bug) nor trail a frame (rAF bug). The
    // Comfy group is canvas-drawn, so dragging IT redraws the bg here with its current _pos;
    // a Vue node drag doesn't redraw the bg on its own, so _carryTick just REQUESTS this pass
    // (the detection + apply read live positions, so wherever the redraw comes from is fine).
    try { carryNativeGroupDrags(); } catch (_e) {} // detection (sets _natGrpDrag); skips during our own drag
    try { applyNodeCarry(); } catch (_e) {}
    try { applyNativeCarry(); } catch (_e) {}
    try {
      const gs = ensureGroups();
      if (gs.length) {
        const { hiddenGroups } = hiddenMaps();
        // Cull groups FULLY outside the visible area (LiteGraph's own per-frame
        // graph-space viewport [x,y,w,h], === this.visible_area). An off-screen
        // group otherwise still rasterizes its (clipped-out) fills + runs the
        // member-count scan; culling drops it to ~0. Any partial overlap still
        // draws fully. Falls back to draw-all when the area is unavailable.
        const va = (area && area.length >= 4 && area[2] > 0 && area[3] > 0) ? area : null;
        ctx.save();
        for (const g of gs) {
          if (hiddenGroups.has(String(g.id))) continue;
          if (va && (g.x > va[0] + va[2] || g.x + g.w < va[0] || g.y > va[1] + va[3] || g.y + g.h < va[1])) continue;
          drawOne(ctx, g);
        }
        ctx.restore();
      }
    } catch (_e) { /* never break the canvas */ }
  };
  c._pixGroupBgWrapped = true;
}

// ── interaction ─────────────────────────────────────────────────────────
let _drag = null;

function repaint() { try { app.canvas?.setDirty(true, true); } catch (_e) {} }
function markChanged() { try { app.graph?.change?.(); } catch (_e) {} repaint(); }

// Selecting one of OUR groups is EXCLUSIVE: clear ComfyUI's native node/group
// selection too, or a previously-selected node stays selected and its native
// selection toolbar lingers on top (that toolbar isn't ours).
function clearNativeSelection() {
  const c = app.canvas;
  if (!c) return;
  try { if (typeof c.deselectAllNodes === "function") c.deselectAllNodes(); } catch (_e) {}
  try { if (c.selectedItems && typeof c.deselect === "function") for (const it of [...c.selectedItems]) c.deselect(it); } catch (_e) {}
  try { if (c.selectedItems && c.selectedItems.clear) c.selectedItems.clear(); } catch (_e) {}
  try { if (c.selected_nodes) for (const k of Object.keys(c.selected_nodes)) delete c.selected_nodes[k]; } catch (_e) {}
  try { c.selected_group = null; } catch (_e) {}
}
function selectGroup(g) { _selectedId = g.id; _selectedIds = new Set([g.id]); clearNativeSelection(); }
// Shift-click toggles a group in/out of the multi-selection.
function toggleGroupSelection(g) {
  if (_selectedIds.has(g.id)) {
    _selectedIds.delete(g.id);
    if (_selectedId === g.id) _selectedId = _selectedIds.size ? [..._selectedIds][_selectedIds.size - 1] : null;
  } else {
    _selectedIds.add(g.id);
    _selectedId = g.id;
  }
  // Additive (shift/ctrl): do NOT clear the native node selection — keep any
  // selected nodes so a node + a group multi-select together. Mirrors the
  // node-click path in onDown, which keeps groups on a shift/ctrl click. (A
  // PLAIN group click still clears native via selectGroup, which is exclusive.)
}
function getSelectedGroups() {
  const gs = ensureGroups();
  return [..._selectedIds].map((id) => gs.find((g) => g.id === id)).filter(Boolean);
}

function startWin() {
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
}
function stopWin() {
  window.removeEventListener("pointermove", onMove, true);
  window.removeEventListener("pointerup", onUp, true);
  window.removeEventListener("pointercancel", onUp, true);
}

// True if the click landed on a node that is part of ComfyUI's current node
// selection — i.e. the user is grabbing an existing node+group multi-selection to
// drag it, NOT clicking empty canvas. Used so dragging a selected node does not
// deselect our co-selected groups.
function clickIsOnSelectedNode(p) {
  const sel = app.canvas?.selected_nodes;
  if (!sel) return false;
  for (const k in sel) {
    const n = sel[k]; if (!n || !n.pos) continue;
    const b = nodeVisualBounds(n);
    if (p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h) return true;
  }
  return false;
}
// Same idea for a co-selected NATIVE ComfyUI group: pressing one to drag the
// multi-selection must NOT deselect our co-selected Pixaroma groups (ComfyUI moves
// the native group + its nodes, and our carry loop moves the contained frames).
function clickIsOnSelectedNativeGroup(p) {
  for (const b of selectedNativeGroupBoxes()) {
    if (p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h) return true;
  }
  return false;
}
// The topmost node whose visual bounds contain p, else null.
function nodeAtPoint(p) {
  const ns = curGraph()?._nodes || [];
  for (let i = ns.length - 1; i >= 0; i--) {
    const n = ns[i]; if (!n || !n.pos) continue;
    const b = nodeVisualBounds(n);
    if (p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h) return n;
  }
  return null;
}
// Is node n a MEMBER of group g (its visual center inside g's box — the same rule
// containedNodes uses)? Used to decide who wins a press in the header.
function nodeIsMemberOf(g, n) {
  const b = nodeVisualBounds(n);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h;
}
// THE single source of truth for "should a press in g's header start a GROUP MOVE,
// or does a node win?". A node wins ONLY when it is NOT a member of g (i.e. it pokes
// into the header from OUTSIDE the group). A contained member does NOT win, so a TALL
// large-font title-bar still drags the group (fixes the bottom-half-of-the-title-bar
// bug). BOTH the hover cursor (onHover) and the drag-start (onDown) call this, so the
// "4-arrow move cursor" and the actual drag can never disagree.
function nonMemberNodeAtHeader(g, p) {
  const n = nodeAtPoint(p);
  return !!(n && !nodeIsMemberOf(g, n));
}
// Does this press GRAB the current multi-selection (KEEP our group selection + let the
// node-carry move it), or is it a plain click that should DESELECT our groups? It grabs
// the unit ONLY when the press is on a SELECTED node (the user deliberately co-selected
// it with the group, so dragging it moves the unit) OR — when NOT on any node — a selected
// native ComfyUI group's own area. A press on ANY node that is NOT selected deselects and
// drags that node alone, even if it sits geometrically INSIDE a selected Pixaroma group
// (clicking a node inside a group should move just the node / select just it, like ComfyUI).
function clickGrabsTheUnit(p) {
  if (clickIsOnSelectedNode(p)) return true;   // a co-selected node → drag the whole unit
  if (nodeAtPoint(p)) return false;            // a node that ISN'T selected → deselect + drag it alone
  return clickIsOnSelectedNativeGroup(p);      // no node under the cursor → grabbing the native group itself
}

function onDown(e) {
  if (e.button !== 0) return;
  _lmbDown = true; startCarryLoop(); // left button held: run the native-group-drag carry loop (stopped on pointerup/cancel/blur)
  _marqueeRect = null; _marqueeShift = false; // start fresh: drop any stale marquee from an abandoned drag
  _clickDeselectPending = false; // set when we KEEP selection for a possible drag; a plain click (no drag) deselects on release
  _pendingPixSelect = null;      // set on an already-selected pixgroup header press; a plain click (no drag) collapses to just it on release
  const c = app.canvas;
  if (!c) return;
  // Handle presses on the graph canvas surface, AND — in Nodes 2.0 — presses on a Vue node
  // DOM element (its clicks don't target the canvas, so our selection-sync / deselect logic
  // never saw them: clicking a node left our Pixaroma group selected). Ignore the toolbar /
  // side panels / anything outside the graph. The node/deselect path below never consumes
  // the event, so ComfyUI's own node interaction is unaffected.
  const onVueNode = isVueNodes() && e.target?.closest?.("[data-node-id]");
  if (e.target !== c.canvas && !onVueNode) return;
  // On a Vue node, a press on an interactive WIDGET (input / combo / button / slider) is a
  // value edit, not a node-select — don't run our selection logic (it would deselect the
  // pixgroup mid-edit). Only node-body / title presses fall through.
  if (onVueNode) {
    const t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON" ||
        (t && t.isContentEditable) || (t && t.closest && t.closest("input,select,textarea,button,[role='slider'],[contenteditable='true']"))) return;
  }
  const p = screenToGraph(e.clientX, e.clientY);
  if (!p) return;
  const gs = ensureGroups();
  for (let i = gs.length - 1; i >= 0; i--) {
    const g = gs[i];
    if (isHiddenGroup(g)) continue; // hidden by a folded ancestor → not interactive
    // header buttons FIRST, so a button click never starts a drag/rename. Hit-test
    // the SAME buttons that are painted (drawOne uses this showBtns), so a click in
    // empty header space can't trigger a button that isn't actually visible.
    if (inHeader(g, p)) {
      const showBtns = (g.id === _hoverId) || _selectedIds.has(g.id);
      const { btns } = headerButtons(g, showBtns);
      for (const b of btns) {
        if (p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h) {
          selectGroup(g); e.preventDefault(); e.stopImmediatePropagation();
          runButtonAction(g, b.key); repaint(); return;
        }
      }
    }
    // pinned groups are locked: never resize (or move) them
    const corner = g.pinned ? null : cornerAt(g, p);
    if (corner) {
      // anchor = the FIXED (opposite) corner; the dragged corner follows the cursor
      const ax = corner.includes("l") ? g.x + g.w : g.x;
      const ay = corner.includes("t") ? g.y + g.h : g.y;
      _drag = { mode: "resize", g, corner, ax, ay };
      selectGroup(g); e.preventDefault(); e.stopImmediatePropagation(); startWin(); repaint(); return;
    }
    if (inHeader(g, p)) {
      // A NON-MEMBER node under the cursor WINS over the group header move: a node whose
      // title bar pokes into the group's bar from OUTSIDE must be draggable on its own.
      // A CONTAINED MEMBER does NOT win — so a tall (large-font) title-bar still drags the
      // group even where its bottom overlaps a member's title (the reported bug). Same
      // predicate the hover cursor uses, so "move cursor ⟹ drag works" always holds.
      if (nonMemberNodeAtHeader(g, p)) break;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.shiftKey || e.ctrlKey || e.metaKey) { toggleGroupSelection(g); repaint(); return; } // shift/ctrl/cmd = add or remove from selection, no drag
      if (!_selectedIds.has(g.id)) selectGroup(g);              // plain click on an UNselected group → exclusive select (clears nodes)
      else { _selectedId = g.id; _pendingPixSelect = g.id; }    // already selected → KEEP the whole multi-selection for a possible DRAG; a plain CLICK (no drag) collapses to just this group on release
      if (g.pinned) { repaint(); return; }                     // pinned → select only; never start a move / duplicate-drag
      if (e.altKey) {
        // alt-drag = duplicate the styled frame(s) and drag the COPIES (frame only;
        // the nodes stay with the originals).
        duplicateSelectedFrames();
        const groupStarts = getSelectedGroups().map((gr) => ({ gr, x: gr.x, y: gr.y }));
        _drag = { mode: "move", ox: p[0], oy: p[1], groupStarts, nodeStarts: [] };
        startWin(); repaint(); return;
      }
      // Move EVERY selected group + its members + nested frames (deduped) by one delta.
      const movedGroups = new Set(), movedNodes = new Map();
      for (const sgrp of getSelectedGroups()) {
        if (sgrp.pinned) continue;                             // a co-selected pinned group (and its members) stays put
        movedGroups.add(sgrp);
        for (const n of groupMemberNodes(sgrp)) movedNodes.set(String(n.id), n);
        for (const ng of groupMemberGroups(sgrp)) if (!ng.pinned) movedGroups.add(ng);
      }
      // Also carry any SEPARATELY-selected native nodes (a node + group multi-
      // selection) so dragging the group moves them as one unit AND keeps them
      // selected (we no longer clearNativeSelection above). Deduped vs members.
      const nativeSel = app.canvas?.selected_nodes ? Object.values(app.canvas.selected_nodes) : [];
      for (const n of nativeSel) if (n && n.pos && !movedNodes.has(String(n.id))) movedNodes.set(String(n.id), n);
      // Also carry any co-selected NATIVE ComfyUI groups: their box AND their contained
      // nodes (ComfyUI isn't the one dragging them here — WE are — so it won't move
      // their contents). Contained nodes deduped vs everything already moving.
      const natStarts = [];
      for (const grp of selectedNativeGroups()) {
        const box = natGrpBox(grp); if (!box) continue;
        natStarts.push({ grp, x: box.x, y: box.y });
        for (const n of nodesInBox(box)) if (n && n.pos && !movedNodes.has(String(n.id))) movedNodes.set(String(n.id), n);
      }
      const groupStarts = [...movedGroups].map((gr) => ({ gr, x: gr.x, y: gr.y }));
      const nodeStarts = [...movedNodes.values()].map((n) => ({ n, x: n.pos[0], y: n.pos[1] }));
      _drag = { mode: "move", ox: p[0], oy: p[1], groupStarts, nodeStarts, natStarts };
      startWin(); repaint(); return;
    }
  }
  // Clicked the body (likely a node) or empty canvas → deselect OUR groups, but
  // NOT on a shift/ctrl/cmd-click (additive: keep the group, let the node JOIN it),
  // and NOT when grabbing a node that's part of the current node+group selection
  // (the user is dragging the whole multi-selection — keep the groups selected).
  // Never consume, so node-drag / marquee / pan all work normally.
  if (!(e.shiftKey || e.ctrlKey || e.metaKey) && _selectedIds.size) {
    if (clickGrabsTheUnit(p)) {
      // Grabbing the multi-selection (a selected node, a member node of a selected group,
      // or the native group itself) → KEEP our group selection FOR NOW so a drag carries
      // it. But a plain CLICK (no drag) should select just that node/group like ComfyUI,
      // so mark a pending deselect that a real drag clears (in applyNodeCarry/Native) and
      // that onWinPointerUp applies if no drag happened. Arm the node-carry if the press
      // is on a selected node; else trackSelectedNodeDrag arms it on the first drag tick.
      _clickDeselectPending = true;
      if (clickIsOnSelectedNode(p)) _carry = snapshotCarry(p);
    } else { _selectedId = null; _selectedIds.clear(); repaint(); } // a plain click → deselect our groups
  }
}

function onMove(e) {
  if (!_drag) return;
  const p = screenToGraph(e.clientX, e.clientY);
  if (!p) return;
  if (_drag.mode === "move") {
    // one cursor delta moves every captured group frame + node (handles multi-select)
    const ddx = p[0] - _drag.ox, ddy = p[1] - _drag.oy;
    if (Math.abs(ddx) > 3 || Math.abs(ddy) > 3) _pendingPixSelect = null; // a real drag → keep the multi-selection (not a click-to-collapse)
    // Align Pixaroma snap: ask Align for a snap on the dragged frames' bounding box,
    // then apply the SAME extra delta to every frame + node so they move rigidly.
    let sdx = 0, sdy = 0;
    const starts = _drag.groupStarts;
    // Skip snap when a co-selected NATIVE group rides along: it moves WITH the unit,
    // so it would be a MOVING snap target (the orange-guides feedback shake). A plain
    // Pixaroma-group drag (no native group in the set) still snaps normally.
    const carryingNative = !!(_drag.natStarts && _drag.natStarts.length);
    if (starts.length && !carryingNative && window.PixaromaAlign?.snapMovingRect) {
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const s of starts) {
        const nx = s.x + ddx, ny = s.y + ddy;
        bx0 = Math.min(bx0, nx); by0 = Math.min(by0, ny);
        bx1 = Math.max(bx1, nx + s.gr.w); by1 = Math.max(by1, ny + s.gr.h);
      }
      const snap = window.PixaromaAlign.snapMovingRect(
        { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 },
        { excludePixIds: starts.map((s) => s.gr.id), excludeNodes: _drag.nodeStarts.map((s) => s.n), bypass: e.shiftKey });
      if (snap) { sdx = snap.dx || 0; sdy = snap.dy || 0; }
    }
    let dx = ddx + sdx, dy = ddy + sdy;
    // ComfyUI "Always snap to grid": snap the primary frame's top-left to the grid
    // and move the WHOLE unit (frames + nodes + native groups) by that snapped delta,
    // so a dragged group lands on the grid just like a dragged node.
    if (gridSnapOn() && starts.length) {
      const a = starts[0];
      dx = gridSnap(a.x + dx) - a.x;
      dy = gridSnap(a.y + dy) - a.y;
    }
    for (const s of starts) { s.gr.x = s.x + dx; s.gr.y = s.y + dy; }
    const vue = isVueNodes();
    for (const s of _drag.nodeStarts) {
      const nx = s.x + dx, ny = s.y + dy;
      // Nodes 2.0 renders node positions from a reactive layout store, so a silent
      // index write (pos[0]=) doesn't move the node — assign a NEW pos array through
      // the setter so the reactive update fires. Legacy reads node.pos directly.
      if (vue) s.n.pos = [nx, ny];
      else { s.n.pos[0] = nx; s.n.pos[1] = ny; }
    }
    // Carry co-selected native ComfyUI group frames by the same delta (their contained
    // nodes were folded into nodeStarts above, so they've already moved).
    for (const s of _drag.natStarts || []) setNativeGroupPos(s.grp, s.x + dx, s.y + dy);
  } else {
    // resize from any corner: grow from the fixed anchor toward the cursor (single
    // group). Align Pixaroma: snap the dragged CORNER to nearby node/group edges.
    const g = _drag.g;
    const c = _drag.corner, ax = _drag.ax, ay = _drag.ay;
    let cx = p[0], cy = p[1];
    const snap = window.PixaromaAlign?.snapResizeCorner?.(cx, cy, { excludePixIds: [g.id], includeGroupedNodes: true, bypass: e.shiftKey });
    if (snap) { cx = snap.x; cy = snap.y; }
    // ComfyUI "Always snap to grid": round the dragged corner to the grid so the
    // resized frame lands on grid lines (matches dragged-node resize).
    if (gridSnapOn()) { cx = gridSnap(cx); cy = gridSnap(cy); }
    const w = Math.max(MIN_W, c.includes("l") ? ax - cx : cx - ax);
    const h = Math.max(MIN_H, c.includes("t") ? ay - cy : cy - ay);
    g.w = w; g.h = h;
    g.x = c.includes("l") ? ax - w : ax;
    g.y = c.includes("t") ? ay - h : ay;
  }
  e.preventDefault(); e.stopPropagation();
  repaint();
}

function onUp(e) {
  if (!_drag) return;
  _drag = null;
  stopWin();
  try { window.PixaromaAlign?.endExternalDrag?.(); } catch (_e) {} // clear snap guides (move OR resize)
  markChanged();
}

// Marquee finalize: ComfyUI's Ctrl-drag marquee selects nodes + native groups but
// not ours, so on release we ADD any Pixaroma group the marquee rect touched to our
// selection (non-exclusive — ComfyUI's node/group selection stays).
function onWinPointerUp() {
  _lmbDown = false;
  if (_carryRaf) { cancelAnimationFrame(_carryRaf); _carryRaf = 0; } // stop the carry loop promptly
  // A plain CLICK (no drag) on an already-selected pixgroup header → collapse the whole
  // selection to JUST that pixgroup (clear the co-selected native nodes/groups), like
  // ComfyUI selecting just the clicked item. A real drag cleared the flag in onMove.
  if (_pendingPixSelect != null) {
    const gid = _pendingPixSelect; _pendingPixSelect = null;
    _selectedIds = new Set([gid]); _selectedId = gid; clearNativeSelection(); repaint();
  }
  // A press that grabbed the unit but never dragged = a plain CLICK on a node / native
  // group → deselect our groups (ComfyUI selects just that item; we mirror it). A real
  // drag cleared the flag in applyNodeCarry / applyNativeCarry.
  else if (_clickDeselectPending) { _clickDeselectPending = false; if (_selectedIds.size) { _selectedIds.clear(); _selectedId = null; repaint(); } }
  _natGrpDrag = null; _carry = null; // end any native-group / node-drag carry
  if (!_marqueeRect) return;
  const [mx, my, mw, mh] = _marqueeRect;
  const shift = _marqueeShift;
  _marqueeRect = null; _marqueeShift = false;
  const x0 = Math.min(mx, mx + mw), x1 = Math.max(mx, mx + mw);
  const y0 = Math.min(my, my + mh), y1 = Math.max(my, my + mh);
  if (x1 - x0 < 4 && y1 - y0 < 4) return; // ignore a click-sized rect
  const hit = [];
  for (const g of ensureGroups()) {
    if (isHiddenGroup(g)) continue;
    // ONLY when the whole group box is inside the marquee (like ComfyUI groups) so
    // marqueeing a node doesn't grab a big group just because it clipped its edge.
    if (g.x >= x0 && g.x + g.w <= x1 && g.y >= y0 && g.y + g.h <= y1) hit.push(g);
  }
  // A plain marquee REPLACES our group selection (matches ComfyUI's node marquee, so a
  // fresh marquee elsewhere drops a previously-selected group even when it hits none);
  // Shift+marquee ADDS to it.
  if (!shift) { _selectedIds.clear(); _selectedId = null; }
  else if (!hit.length) return; // Shift + empty rect: nothing to add, leave selection as-is
  for (const g of hit) _selectedIds.add(g.id);
  if (hit.length) _selectedId = hit[hit.length - 1].id;
  repaint();
}

// While a NATIVE ComfyUI group is dragged, ComfyUI moves it + its nodes but NOT our
// Pixaroma groups sitting inside it, so carry them. Driven by a requestAnimationFrame
// loop (startCarryLoop) that runs WHILE the left button is held, NOT by pointermove or
// the draw loop: in Nodes 2.0 the native-group title drag does not reach our window
// pointermove handler (so the carry was left behind), and the background-canvas redraw
// cadence is irregular there (so driving it from onDrawBackground made the carry lag /
// stutter). A steady rAF tick reads the live group._pos and moves our frames smoothly in
// BOTH renderers. _lmbDown gates it so a programmatic move / load / undo never carries.
const _natGrpPrev = new WeakMap();  // native group -> last {x,y,w,h}
let _natGrpDrag = null;             // { grp, pix: [our groups snapshotted inside] }
let _lmbDown = false;               // left mouse button currently held (gates the carry)
let _carryRaf = 0;                  // active rAF id for the native-group carry loop
// DETECTION ONLY (runs in the rAF). When a native ComfyUI group is being dragged,
// snapshot it + the contained pixgroups' base positions ONCE. The actual move is applied
// in the DRAW pass (applyNativeCarry), reading the group's LIVE _pos at draw time so the
// frames are drawn locked to it (the old per-tick incremental apply in the rAF left them
// one frame behind = the "lazy brush" trail).
function carryNativeGroupDrags() {
  // A header drag (ours, _drag) OR an active node-drag carry (_carry) BOTH own the
  // frames — never ALSO latch a native-group carry on top. Without this, a co-selected
  // native group that ComfyUI moves together with the dragged node gets detected as a
  // native drag, applyNativeCarry then re-pins the pixgroup to the group's (near-zero /
  // opposite) delta AND trackSelectedNodeDrag nulls _carry — so the node carry fights it,
  // then dies, and the frame drifts the wrong way then STOPS following (bug B1). Keep the
  // per-group baseline fresh below so a real native-group drag right after starts at 0.
  const ownDrag = !!_drag || !!_carry;
  for (const grp of nativeGroups()) {
    const box = natGrpBox(grp); if (!box) continue;
    const prev = _natGrpPrev.get(grp);
    _natGrpPrev.set(grp, box);
    if (!prev || !_lmbDown || ownDrag) continue; // only during an ACTUAL native-group drag (not our own)
    const dx = box.x - prev.x, dy = box.y - prev.y;
    if ((dx === 0 && dy === 0) || box.w !== prev.w || box.h !== prev.h) continue; // still / resized
    if (!_natGrpDrag || _natGrpDrag.grp !== grp) {
      _natGrpDrag = {
        grp, gx0: prev.x, gy0: prev.y, // the group's PRE-move position
        pix: ensureGroups().filter((o) => // our groups whose whole box was inside its previous box (pinned stay put)
          !o.pinned &&
          o.x >= prev.x && o.y >= prev.y && o.x + o.w <= prev.x + prev.w && o.y + o.h <= prev.y + prev.h)
          .map((o) => ({ o, x0: o.x, y0: o.y })),
      };
    }
  }
  return !!(_natGrpDrag && _natGrpDrag.pix.length); // a native group with our groups inside is being dragged
}
// Apply the native-group carry in the DRAW pass: read the dragged group's live _pos NOW
// and place the contained pixgroups at base + (live - start), so they're drawn locked to
// the group instead of trailing it by a frame. ComfyUI moves the group's member NODES, so
// we move only the pixgroup frames.
function applyNativeCarry() {
  if (_carry || !_natGrpDrag || !_lmbDown) return false; // a node-drag carry owns the frames (belt-and-braces vs the rAF/draw cadence race)
  const box = natGrpBox(_natGrpDrag.grp); if (!box) return false;
  const dx = box.x - _natGrpDrag.gx0, dy = box.y - _natGrpDrag.gy0;
  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) _clickDeselectPending = false; // it's a real drag, not a click
  for (const p of _natGrpDrag.pix) { p.o.x = p.x0 + dx; p.o.y = p.y0 + dy; }
  return _natGrpDrag.pix.length > 0;
}
function _carryTick() {
  if (!_lmbDown) { _carryRaf = 0; return; }   // drag ended -> stop the loop
  // Detection + apply BOTH live in the bg draw pass (onDrawBackground) now, reading live
  // positions. Here we only REQUEST that pass each frame so it fires at ~60Hz during a drag.
  // Pump while an ACTUAL carry is live (_carry = node-drag carry, _natGrpDrag = native-group
  // carry). The bare group-PRESENCE pump is kept ONLY in Nodes 2.0: there a native-group
  // title drag doesn't reliably dirty the bg, and carryNativeGroupDrags() (which sets
  // _natGrpDrag) runs INSIDE onDrawBackground, so this pump is the only thing that lets a
  // native-group carry get detected. In the CLASSIC renderer a canvas-drawn native group
  // self-dirties the bg every moved frame, so detection bootstraps within ~1 frame WITHOUT
  // the pump — so dropping presence-pumping there stops forcing wasteful full-bg repaints
  // during ordinary classic node drags (which have nothing to carry). Vue: bg-only (nodes
  // are Vue DOM, wires repaint themselves). Classic (carry live): force fg+bg in lockstep.
  if (_carry || _natGrpDrag || (isVueNodes() && ensureGroups().length)) {
    try { app.canvas?.setDirty(isVueNodes() ? false : true, true); } catch (_e) {}
  }
  _carryRaf = requestAnimationFrame(_carryTick);
}
function startCarryLoop() {
  // Baseline every native group's box so the first real move is a 0 delta (no jump from a
  // stale prev), and force a fresh snapshot on the first move of this drag.
  _natGrpDrag = null;
  for (const grp of nativeGroups()) { const b = natGrpBox(grp); if (b) _natGrpPrev.set(grp, b); }
  if (!_carryRaf) _carryRaf = requestAnimationFrame(_carryTick);
}

// ── Carry co-selected groups while a NODE is dragged ──────────────────────
// Move a node + group multi-selection as ONE unit, with the SAME snap-alignment a
// group drag uses. We do NOT intercept the pointerdown (wire-drags from a slot stay
// untouched): ComfyUI moves the selected nodes, and here we move the carried group
// frames + their non-selected members + the selected nodes to (start + cursorDelta +
// unitSnap). Keyed off the CURSOR delta (so there's no feedback from us overwriting
// node positions) but GATED on the selected node having actually moved — a wire-drag /
// pan / marquee moves the cursor without moving a node, and is left alone. Align
// stands down for the node (isDragging() reports the carry) so it can't snap the node
// and make the group jump; pixgroup snaps the unit's frame bbox via snapMovingRect.
let _carry = null; // active node-drag carry snapshot, or null
let _clickDeselectPending = false; // a press grabbed the unit; a plain click (no drag) deselects our groups on release
let _pendingPixSelect = null; // a press grabbed an already-selected pixgroup header; a plain click (no drag) collapses the selection to just that pixgroup on release
function snapshotCarry(cursor) {
  if (!_selectedIds.size) return null;
  const selNodes = app.canvas?.selected_nodes ? Object.values(app.canvas.selected_nodes) : [];
  if (!selNodes.length) return null;
  const ref = selNodes.find((n) => n && n.pos);
  if (!ref) return null;
  const selIds = new Set(selNodes.map((n) => String(n.id)));
  const frames = [], members = [], fSet = new Set();
  for (const g of getSelectedGroups()) {
    if (g.pinned) continue;   // pinned → not carried by a node drag; its members stay too
    if (!fSet.has(g)) { fSet.add(g); frames.push({ g, x: g.x, y: g.y, w: g.w, h: g.h }); }
    for (const ng of groupMemberGroups(g)) if (!ng.pinned && !fSet.has(ng)) { fSet.add(ng); frames.push({ g: ng, x: ng.x, y: ng.y, w: ng.w, h: ng.h }); }
    for (const n of groupMemberNodes(g)) if (!selIds.has(String(n.id)) && n.pos) members.push({ n, x: n.pos[0], y: n.pos[1] });
  }
  if (!frames.length) return null; // a node is selected but no group → nothing to carry
  const nodes = selNodes.filter((n) => n && n.pos).map((n) => ({ n, x: n.pos[0], y: n.pos[1] }));
  return { ref, rx: ref.pos[0], ry: ref.pos[1], cx: cursor[0], cy: cursor[1], frames, members, nodes,
           excludeIds: frames.map((f) => f.g.id),
           excludeNodes: [...members.map((m) => m.n), ...nodes.map((nn) => nn.n)] };
}
// pointermove (onHover) snapshots the carry. In CLASSIC the movement then happens in the
// DRAW pass (applyNodeCarry, onDrawBackground) reading node.pos — exact, jitter-free,
// locked. In NODES 2.0 node.pos lags through Vue's reactive layout and the draw-pass
// cadence stutters, so we move it HERE from the CURSOR (anchored to the node's start-of-
// move so there's no drag-threshold offset) — the same smooth signal the pixgroup-header
// drag uses.
function trackSelectedNodeDrag(e) {
  const dragging = (e.buttons & 1) === 1;
  if (!dragging) { _carry = null; return; }
  if (_natGrpDrag) { _carry = null; return; } // a native group drag owns the frames
  const p = screenToGraph(e.clientX, e.clientY);
  if (!p) return;
  if (!_carry) {
    if (!_selectedIds.size) return;
    _carry = snapshotCarry(p);
    return;
  }
  // The carry is APPLIED in the bg draw pass (applyNodeCarry, onDrawBackground) for BOTH
  // renderers now — reading node.pos live so the frame is drawn locked to the node AND in
  // sync with a co-dragged Comfy group (which is drawn in that same pass). Vue node moves
  // don't redraw the bg on their own, so _carryTick requests the pass each frame. Here we
  // only keep the snapshot fresh; nothing to apply.
}
// Called from onDrawBackground (the draw pass), NOT a separate rAF — so it reads the
// dragged node's LATEST position at the moment of drawing and positions the carried
// frames + non-selected members by that exact delta (node.pos - start). node.pos is the
// single source of truth (post-threshold, no cursor jitter), and reading it in the draw
// pass means the frame is drawn locked to the node, not a frame behind. ComfyUI owns the
// selected node; we never write it.
function applyNodeCarry() {
  if (!_carry) return false;
  if (!_lmbDown) { _carry = null; return false; } // safety: no drag in progress
  if (!_carry.ref || !_carry.ref.pos) { _carry = null; return false; }
  const dx = _carry.ref.pos[0] - _carry.rx, dy = _carry.ref.pos[1] - _carry.ry;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return false; // under the drag threshold / not moving
  _clickDeselectPending = false; // the node actually moved -> it's a drag, keep the selection
  const vue = isVueNodes();
  for (const f of _carry.frames) { f.g.x = f.x + dx; f.g.y = f.y + dy; }
  for (const m of _carry.members) { if (vue) m.n.pos = [m.x + dx, m.y + dy]; else { m.n.pos[0] = m.x + dx; m.n.pos[1] = m.y + dy; } }
  return true;
}

// Cursor hint so the grab zones are discoverable: a resize arrow over the
// bottom-right handle, a move cursor over the header. Bubble phase so it wins
// over ComfyUI's own per-move cursor; only clears what WE set (no flicker
// fight elsewhere).
let _cursorOverride = false;
function onHover(e) {
  if (_drag) return;
  const el = app.canvas?.canvas;
  // Zero Pixaroma groups → nothing to hover, carry, or marquee-select. Bail before
  // any per-move work (matches Align's "zero cost when nothing present" contract).
  if (!ensureGroups().length) {
    if (_cursorOverride && el) { el.style.cursor = ""; _cursorOverride = false; }
    if (_hoverId !== null || _hotBtn !== null) { _hoverId = null; _hotBtn = null; repaint(); }
    return;
  }
  trackSelectedNodeDrag(e);
  if (!el) return;
  // Track ComfyUI's marquee rect while it drags, so onWinPointerUp can add our
  // groups to the selection (the marquee already grabs nodes + native groups).
  const dr = app.canvas?.dragging_rectangle;
  if (dr && dr.length >= 4) { _marqueeRect = [dr[0], dr[1], dr[2], dr[3]]; _marqueeShift = !!e.shiftKey; }
  if (e.target !== el) {
    if (_cursorOverride) { el.style.cursor = ""; _cursorOverride = false; }
    if (_hoverId !== null || _hotBtn !== null) { _hoverId = null; _hotBtn = null; repaint(); }
    return;
  }
  const p = screenToGraph(e.clientX, e.clientY);
  if (!p) return;
  _hoverPt = p;
  let cur = null, hoverId = null, hotBtn = null;
  const gs = ensureGroups();
  for (let i = gs.length - 1; i >= 0; i--) {
    const g = gs[i];
    if (isHiddenGroup(g)) continue; // hidden by a folded ancestor
    if (!inRect(g, p)) continue;
    hoverId = g.id; // hovering anywhere in the group reveals its buttons
    if (inHeader(g, p)) {
      const { btns } = headerButtons(g, true);
      for (const b of btns) if (p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h) { hotBtn = { gid: g.id, key: b.key }; break; }
    }
    const corner = g.pinned ? null : cornerAt(g, p);
    if (hotBtn) cur = "pointer";
    else if (corner) cur = cornerCursor(corner);
    // Show the move cursor on the header EXCEPT where a non-member node wins (same
    // test onDown uses to start the drag), so the cursor never promises a move the
    // drag won't perform. A pinned group is locked, so no move/resize cursor.
    else if (!g.pinned && inHeader(g, p) && !nonMemberNodeAtHeader(g, p)) cur = "move";
    break; // topmost group only
  }
  if (cur) { el.style.cursor = cur; _cursorOverride = true; }
  else if (_cursorOverride) { el.style.cursor = ""; _cursorOverride = false; }
  const changed = hoverId !== _hoverId
    || (hotBtn ? hotBtn.key : null) !== (_hotBtn ? _hotBtn.key : null)
    || (hotBtn ? hotBtn.gid : null) !== (_hotBtn ? _hotBtn.gid : null);
  if (changed) { _hoverId = hoverId; _hotBtn = hotBtn; repaint(); }
}

// The currently-selected Pixaroma group (our own selection, by _selectedId).
// Exposed so the color tool's "\" shortcut can open the styling palette for it.
function getSelected() {
  if (_selectedId == null) return null;
  return ensureGroups().find((g) => g.id === _selectedId) || null;
}

// Delete / Backspace removes the selected Pixaroma group (ours only — we consume
// the event so ComfyUI doesn't also delete nodes). Ignored while typing, with a
// modifier, or while the styling palette / rename input is open. (The "group the
// selection" shortcut lives in ComfyUI's keybinding registry instead — see the
// commands/keybindings in registerExtension — so it's discoverable + rebindable
// and can't silently fight another extension's key.)
function onKeyDown(e) {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  // Ctrl/Cmd + C / V — copy/paste the selected Pixaroma group FRAME(s). Only takes
  // over Ctrl+V when OUR groups were the last thing copied (else ComfyUI handles it).
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
    const k = (e.key || "").toLowerCase();
    if (k === "a") {
      // Select-all: ComfyUI selects every node + native group, but doesn't know about our
      // Pixaroma groups — so ALSO add them all to our selection (Ctrl+A → drag / color /
      // delete then includes them). Don't preventDefault: ComfyUI runs its own select-all,
      // and ours is independent. (Typing in a field is already excluded by the guard above.)
      const all = ensureGroups();
      if (all.length) { _selectedIds = new Set(all.map((g) => g.id)); _selectedId = all[all.length - 1].id; repaint(); }
      return;
    }
    if (k === "c") {
      const sel = getSelectedGroups();
      const nativeNodes = app.canvas?.selected_nodes ? Object.keys(app.canvas.selected_nodes).length : 0;
      if (sel.length) {
        // Copy OUR frame(s). If nodes are ALSO selected it's a MIXED copy: Ctrl+V then
        // pastes our frame(s) AND lets ComfyUI paste the nodes (instead of dropping the
        // group entirely, the old "nodes selected → relinquish" bug). Never preventDefault
        // on C, so ComfyUI still copies any selected nodes into its own clipboard.
        _groupClipboard = sel.map((gr) => cloneGroupFrame(gr, 0, 0));
        _groupClipActive = true;
        _groupClipMixed = nativeNodes > 0;
        // Anchor = top-left of the copied NODES' bbox. On a mixed paste we shift the
        // pasted frame by the SAME delta ComfyUI shifts the nodes, so the node-inside-
        // group layout is preserved instead of the frame and nodes drifting apart.
        _mixedCopyAnchor = nativeNodes ? selectedNodesBBoxTopLeft() : null;
        _pasteSeq = 0;
      } else { _groupClipActive = false; } // no group of ours → relinquish so Ctrl+V defers to ComfyUI
      return;
    }
    if (k === "v") {
      if (_groupClipActive && _groupClipboard && _groupClipboard.length) {
        if (_groupClipMixed) {
          // Mixed: let the event flow to ComfyUI so it pastes the nodes, but DON'T place
          // our frame yet. Drop the old selection now (so it can't be dragged), snapshot
          // the existing node ids, and wait for ComfyUI's pasted nodes to land — then put
          // the frame at the SAME shift the nodes got, keeping the original layout.
          _selectedIds = new Set(); _selectedId = null; repaint();
          schedulePasteFramesAlignedToNewNodes(_groupClipboard, _mixedCopyAnchor, allNodeIds());
        } else {
          // Groups-only: consume the event so ComfyUI doesn't paste stale nodes.
          e.preventDefault(); e.stopImmediatePropagation(); pasteGroups();
        }
      } else if (_selectedIds.size) {
        // Relinquishing to ComfyUI's node paste → drop our group selection so a
        // still-selected old group isn't dragged along with the pasted nodes.
        _selectedIds = new Set(); _selectedId = null; repaint();
      }
      return;
    }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Delete" || e.key === "Backspace") {
    if (document.querySelector(".pix-nc-pal, .pix-pg-rename")) return; // editing → don't delete
    const sel = getSelectedGroups();
    if (!sel.length) return;
    const nativeNodes = app.canvas?.selected_nodes ? Object.keys(app.canvas.selected_nodes).length : 0;
    e.preventDefault();
    if (!nativeNodes) e.stopImmediatePropagation(); // pure-group delete → consume; mixed → let ComfyUI delete its nodes too
    for (const grp of sel) deleteGroup(grp);   // delete ALL selected
  }
}

// Double-click the header → inline rename (native-group style). The styling
// editor opens from the right-click menu and the "\" shortcut (color tool).
function onDblClick(e) {
  const c = app.canvas;
  if (!c || e.target !== c.canvas) return;
  const p = screenToGraph(e.clientX, e.clientY);
  if (!p) return;
  const gs = ensureGroups();
  for (let i = gs.length - 1; i >= 0; i--) {
    const g = gs[i];
    if (inHeader(g, p)) {
      // A double-click that lands on a header button is just two fast button
      // clicks (toggling mute/bypass/fold) - do NOT open rename; it was stealing
      // rapid toggles. Rename only fires on a double-click of the title strip.
      // Match the painted buttons (same showBtns as drawOne / onDown).
      const showBtns = (g.id === _hoverId) || _selectedIds.has(g.id);
      const { btns } = headerButtons(g, showBtns);
      for (const b of btns) if (p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h) return;
      e.preventDefault(); e.stopImmediatePropagation(); inlineRename(g); return;
    }
    if (inRect(g, p)) break;
  }
}

// ── create / rename / delete ────────────────────────────────────────────
function addGroup(p) {
  const gs = ensureGroups();
  const sel = app.canvas?.selected_nodes ? Object.values(app.canvas.selected_nodes) : [];
  // Wrap EVERYTHING selected: loose nodes + selected native ComfyUI groups + selected
  // Pixaroma groups (each box covers its own contents). "Group these together" ⊇ groups.
  const wrappedPix = getSelectedGroups();
  const boxes = [];
  for (const n of sel) boxes.push(nodeVisualBounds(n));
  for (const b of selectedNativeGroupBoxes()) boxes.push(b);
  for (const sg of wrappedPix) boxes.push({ x: sg.x, y: sg.y, w: sg.w, h: sg.h });
  let x, y, w, h;
  if (boxes.length) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const b of boxes) {
      minx = Math.min(minx, b.x); miny = Math.min(miny, b.y);
      maxx = Math.max(maxx, b.x + b.w); maxy = Math.max(maxy, b.y + b.h);
    }
    const pad = 22, hH = headerH({});
    x = minx - pad; y = miny - pad - hH;
    w = (maxx - minx) + pad * 2; h = (maxy - miny) + pad * 2 + hH;
  } else {
    x = p ? p[0] : 100; y = p ? p[1] : 100; w = 320; h = 220;
  }
  const g = {
    id: newId(), title: "Group",
    x, y, w: Math.max(MIN_W, w), h: Math.max(MIN_H, h),
    titleColor: DEF_TITLE, bodyColor: DEF_BODY,
    titleAlpha: DEF_TITLE_A, bodyAlpha: DEF_BODY_A, fontSize: DEF_FONT,
  };
  if (wrappedPix.length) {
    // Insert BEHIND the wrapped Pixaroma groups so they stay on top + interactive
    // (z-order: an outer wrapper must draw first). Else push on top (nodes draw above).
    let minIdx = gs.length;
    for (const wp of wrappedPix) { const idx = gs.indexOf(wp); if (idx >= 0) minIdx = Math.min(minIdx, idx); }
    gs.splice(minIdx, 0, g);
  } else {
    gs.push(g);
  }
  selectGroup(g);   // exclusive: the new group is selected, the wrapped items are not
  markChanged();
}
function deleteGroup(g) {
  const gs = ensureGroups();
  const i = gs.indexOf(g);
  if (i >= 0) gs.splice(i, 1);
  _selectedIds.delete(g.id);
  if (_selectedId === g.id) _selectedId = null;
  invalidateHidden(); updateFoldNodeHideCSS(); // a folded group deleted → un-hide its nodes
  markChanged();
}

// Convert a standard ComfyUI group into a Pixaroma group in the SAME spot: a new
// Pixaroma group with the native group's exact box, title, and colour, then the
// native group is removed. The nodes are not moved, so the new frame geometrically
// contains the same nodes (Pixaroma membership is by full-containment) — drag it and
// they ride along. Eases migrating existing layouts to the new group style.
function convertNativeGroup(grp) {
  const graph = curGraph();
  const box = grp ? natGrpBox(grp) : null;
  if (!graph || !box) return;
  // The native group has ONE colour; use it for BOTH the header and the body tint so
  // the look carries over (body stays a tint via bodyAlpha). Fall back to the neutral
  // Pixaroma defaults when the group has no colour.
  const color = (typeof grp.color === "string" && grp.color) ? grp.color : null;
  const g = {
    id: newId(),
    title: grp.title || "Group",
    x: box.x, y: box.y, w: Math.max(MIN_W, box.w), h: Math.max(MIN_H, box.h),
    titleColor: color || DEF_TITLE,
    bodyColor: color || DEF_BODY,
    titleAlpha: DEF_TITLE_A, bodyAlpha: DEF_BODY_A, fontSize: DEF_FONT,
  };
  ensureGroups().push(g);
  removeNativeGroup(graph, grp);
  selectGroup(g); // select the new Pixaroma group (clears native selection)
  markChanged();
  try { graph.setDirtyCanvas?.(true, true); } catch (_e) { /* ignore */ }
}

// ── duplicate / copy / paste (FRAME ONLY — the styled container, not the nodes) ──
// A duplicated group is a fresh frame (new id, offset, unfolded) carrying the same
// title / size / colors / opacity / font. The nodes inside stay with the original.
function cloneGroupFrame(g, dx, dy) {
  const c = JSON.parse(JSON.stringify(g));
  c.id = newId();
  c.x = (g.x || 0) + (dx || 0);
  c.y = (g.y || 0) + (dy || 0);
  c.folded = false; delete c.foldNodes; delete c.foldGroups; delete c.hOpen; delete c.wOpen; delete c.pinned;
  return c;
}
function duplicateSelectedFrames() {
  const originals = getSelectedGroups();
  if (!originals.length) return;
  const gs = ensureGroups();
  const newSel = new Set();
  for (const og of originals) { const c = cloneGroupFrame(og, 0, 0); gs.push(c); newSel.add(c.id); }
  _selectedIds = newSel; _selectedId = [...newSel].pop() || null;
  markChanged();
}
// Groups-only paste (no nodes were copied): cascade a fixed offset and select the
// new frame(s) exclusively. The MIXED case uses schedulePasteFramesAlignedToNewNodes
// instead, so the frame follows ComfyUI's node-paste shift.
function pasteGroups() {
  if (!_groupClipboard || !_groupClipboard.length) return;
  const gs = ensureGroups();
  const newSel = new Set();
  // Paste AT THE CURSOR (like ComfyUI's own paste): shift the clipboard so its
  // bounding-box top-left lands at the live mouse. The old fixed 40px cascade put
  // the copy directly ON TOP of the source, where dragging it grabbed the source's
  // nodes (Discord feedback called it "fatal"). Fall back to the cascade only if
  // the cursor position isn't available.
  const gm = app.canvas?.graph_mouse;
  let offx, offy;
  if (gm && isFinite(gm[0]) && isFinite(gm[1])) {
    let minx = Infinity, miny = Infinity;
    for (const d of _groupClipboard) { if (d.x < minx) minx = d.x; if (d.y < miny) miny = d.y; }
    offx = gm[0] - minx; offy = gm[1] - miny;
    if (gridSnapOn()) { offx = gridSnap(gm[0]) - minx; offy = gridSnap(gm[1]) - miny; }
  } else {
    const off = 40 * (++_pasteSeq); offx = off; offy = off;
  }
  for (const data of _groupClipboard) {
    const c = cloneGroupFrame(data, offx, offy);
    gs.push(c); newSel.add(c.id);
  }
  // Reset selection to ONLY the new frame(s) — drops the old group so it isn't
  // dragged along with whatever was just pasted.
  _selectedIds = newSel; _selectedId = [...newSel].pop() || null;
  clearNativeSelection();
  markChanged();
}

// Top-left of the bounding box of the currently-selected native nodes (graph coords),
// or null. Recorded at copy time so a mixed paste can match ComfyUI's node shift.
function selectedNodesBBoxTopLeft() {
  const sel = app.canvas?.selected_nodes ? Object.values(app.canvas.selected_nodes) : [];
  return bboxTopLeftOfNodes(sel);
}
function bboxTopLeftOfNodes(nodes) {
  let minx = Infinity, miny = Infinity;
  for (const n of (nodes || [])) { const b = nodeVisualBounds(n); if (b.x < minx) minx = b.x; if (b.y < miny) miny = b.y; }
  return (minx === Infinity) ? null : { x: minx, y: miny };
}
function allNodeIds() {
  const out = new Set();
  for (const n of (curGraph()?._nodes || [])) out.add(n.id);
  return out;
}

// MIXED paste: ComfyUI pastes the nodes (possibly async, e.g. via navigator.clipboard),
// so we WAIT for the new nodes to appear, then create the frame(s) shifted by the SAME
// delta ComfyUI applied to the nodes — preserving the node-inside-group layout with no
// intermediate jump. Falls back to a small offset if no node ever lands (empty clipboard).
function schedulePasteFramesAlignedToNewNodes(clipboard, anchor, beforeIds) {
  if (!clipboard || !clipboard.length) return;
  const place = (dx, dy) => {
    const gs = ensureGroups();
    const newSel = new Set();
    for (const data of clipboard) { const c = cloneGroupFrame(data, dx, dy); gs.push(c); newSel.add(c.id); }
    _selectedIds = newSel; _selectedId = [...newSel].pop() || null;
    repaint(); markChanged();
  };
  let tries = 0;
  const MAX = 24; // ~400ms at 60fps — covers an async clipboard paste
  const tick = () => {
    const fresh = (curGraph()?._nodes || []).filter((n) => !beforeIds.has(n.id));
    if (fresh.length) {
      const B = bboxTopLeftOfNodes(fresh);
      if (B && anchor) place(B.x - anchor.x, B.y - anchor.y);
      else place(40, 40);
      return;
    }
    if (++tries >= MAX) { place(40, 40); return; } // ComfyUI pasted nothing → just offset
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ── header-button actions ─────────────────────────────────────────────────
function runButtonAction(g, key) {
  if (key === "run") queueGroup(g);
  else if (key === "mute") toggleMode(g, 2);
  else if (key === "bypass") toggleMode(g, 4);
  else if (key === "fold") foldGroup(g);
  else if (key === "unfold") unfoldGroup(g);
}

// Run = queue ONLY this group's output nodes (ComfyUI partial execution). Ids MUST
// be strings — the backend matches partial-execution targets against the prompt's
// string node-id keys; numbers never match and it 400s with "no outputs".
function isGroupOutputNode(n) {
  const NEVER = window.LiteGraph?.NEVER != null ? window.LiteGraph.NEVER : 2;
  return !!(n && n.mode !== NEVER && n.constructor && n.constructor.nodeData && n.constructor.nodeData.output_node);
}
function queueGroup(g) {
  const outs = groupMemberNodes(g).filter(isGroupOutputNode);
  if (!outs.length) { toast("Nothing to run in this group", "Put an output node (a Save or Preview) inside, then press Run."); return; }
  const ids = outs.map((n) => String(n.id));
  try {
    const r = app.queuePrompt(0, 1, ids);
    if (r && typeof r.then === "function") r.catch((e) => console.error("[PixGroup] run failed", e));
  } catch (e) { console.error("[PixGroup] run failed", e); toast("Could not run this group", String((e && e.message) || e)); }
}

// Apply a mode to a node AND every node inside it if it's a subgraph (recursively),
// so muting/bypassing a group also stops a branch nested in a subgraph.
function applyModeDeep(node, mode) {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop(); if (!n) continue;
    n.mode = mode;
    let inner = null;
    try { if (typeof n.isSubgraphNode === "function" && n.isSubgraphNode() && n.subgraph) inner = n.subgraph.nodes || n.subgraph._nodes; } catch (_e) {}
    if (inner && inner.length) for (let i = inner.length - 1; i >= 0; i--) stack.push(inner[i]);
  }
}
function toggleMode(g, mode) {
  const ns = groupMemberNodes(g);
  if (!ns.length) return;
  const all = ns.every((n) => n.mode === mode);
  const target = all ? 0 : mode;
  for (const n of ns) applyModeDeep(n, target);
  markChanged();
}

// ── Group Switch bridge helpers (js/group_switch) ──────────────────────────
// The Group Switch node controls BOTH our Pixaroma groups AND native ComfyUI
// groups through these, so it fully replaces rgthree's Fast Groups Muter/
// Bypasser. State is READ from the member nodes' live modes (so a switch
// reflects the group's own header Mute/Bypass button and every other switch —
// one shared source of truth), and a flip reuses applyModeDeep so it reaches
// into subgraphs. Native groups are keyed "ng:<id>" so they never collide with
// our "pg_…" ids; their members are the nodes whose visual center sits inside
// the native group's box (renderer-agnostic, no native internals needed).
function nodesInBox(box) {
  const out = [];
  for (const n of (curGraph()?._nodes || [])) {
    if (!n || !n.pos) continue;
    const b = nodeVisualBounds(n);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h) out.push(n);
  }
  return out;
}
function nativeKey(grp, idx) { return grp.id != null ? String(grp.id) : ("idx" + idx); }
function nativeGroupByKey(key) {
  const arr = nativeGroups();
  for (let i = 0; i < arr.length; i++) if (nativeKey(arr[i], i) === key) return arr[i];
  return null;
}
// Resolve a switch id (Pixaroma "pg_…" or native "ng:<id>") to its member nodes.
function switchMemberNodes(id) {
  if (typeof id === "string" && id.indexOf("ng:") === 0) {
    const grp = nativeGroupByKey(id.slice(3));
    const box = grp ? natGrpBox(grp) : null;
    return box ? nodesInBox(box) : [];
  }
  const g = ensureGroups().find((x) => x.id === id);
  return g ? groupMemberNodes(g) : [];
}
function switchGroupBox(id) {
  if (typeof id === "string" && id.indexOf("ng:") === 0) {
    const grp = nativeGroupByKey(id.slice(3));
    return grp ? natGrpBox(grp) : null;
  }
  const g = ensureGroups().find((x) => x.id === id);
  if (g) { selectGroup(g); return { x: g.x, y: g.y, w: g.w, h: g.h }; }
  return null;
}
// Every group (Pixaroma + native) the switch can list, in a stable order
// (Pixaroma first, then native — both in canvas/array order = "position").
function listSwitchGroups() {
  const out = [];
  for (const g of ensureGroups()) out.push({ id: g.id, title: g.title || "Group", color: gTitleColor(g), kind: "pix" });
  const arr = nativeGroups();
  for (let i = 0; i < arr.length; i++) {
    const grp = arr[i]; const box = natGrpBox(grp); if (!box) continue;
    out.push({ id: "ng:" + nativeKey(grp, i), title: grp.title || "Group", color: grp.color || DEFAULT_COLOR, kind: "native" });
  }
  return out;
}
function switchGroupState(id) {
  const ns = switchMemberNodes(id);
  if (!ns.length) return { muted: false, bypassed: false, count: 0 };
  return { muted: ns.every((n) => n.mode === 2), bypassed: ns.every((n) => n.mode === 4), count: ns.length };
}
function setSwitchGroup(id, on, action) {
  const ns = switchMemberNodes(id);
  if (!ns.length) return;
  const mode = on ? 0 : (action === "bypass" ? 4 : 2);
  for (const n of ns) applyModeDeep(n, mode);
  markChanged();
}
// Center the viewport on a group (Pixaroma or native) — the "locate" affordance
// the switch's pick list uses to tell same-named groups apart.
function revealSwitchGroup(id) {
  const box = switchGroupBox(id);
  if (!box) return;
  try {
    const c = app.canvas, ds = c?.ds, el = c?.canvas;
    if (ds && el && ds.offset) {
      const r = el.getBoundingClientRect();
      const s = ds.scale || 1;
      ds.offset[0] = (r.width / 2) / s - (box.x + box.w / 2);
      ds.offset[1] = (r.height / 2) / s - (box.y + box.h / 2);
    }
  } catch (_e) {}
  repaint();
}

// Fold = collapse the whole group to a slim bar: capture the member ids, shrink the
// box to a SHORT left-aligned bar (header height + a width that just fits the title
// + count + unfold button), hide the members (computeVisibleNodes wrap in legacy +
// a CSS rule in Nodes 2.0) and their crossing wires (renderLink wrap; hidden by
// default, per-group "show links" opt-in). All fields ride on the group object,
// so they serialize with the group.
let _measCtxEl = null;
function measCtx() { if (!_measCtxEl) _measCtxEl = document.createElement("canvas").getContext("2d"); return _measCtxEl; }
function computeBarWidth(g) {
  const oc = measCtx();
  oc.font = `600 ${gFontSize(g)}px 'Segoe UI', system-ui, sans-serif`;
  const tw = oc.measureText(g.title || "Group").width;
  // left pad(12) + title + gap(16) + toggle(BSZ) + gap(8) + badge(24) + right pad(BPAD) + slack(10)
  // — generous so the (always-visible) toggle + count never clip the title.
  return Math.round(Math.max(180, 12 + tw + 16 + BSZ + 8 + 24 + BPAD + 10));
}
function foldGroup(g) {
  if (g.folded) return;
  // Capture member nodes AND nested groups so both hide with the parent. Union in
  // each nested group's own members (covers a nested group that is already folded).
  const subs = containedGroups(g);
  const ids = new Set(containedNodes(g).map((n) => String(n.id)));
  for (const sg of subs) for (const n of groupMemberNodes(sg)) ids.add(String(n.id));
  g.foldNodes = [...ids];
  g.foldGroups = subs.map((sg) => sg.id);
  g.hOpen = g.h; g.wOpen = g.w;        // remember the open box to restore
  g.folded = true;
  g.h = headerH(g);
  g.w = computeBarWidth(g);            // shrink to a short bar, left edge unchanged
  if (g.showLinks == null) g.showLinks = true;  // outside-crossing wires shown by default
  invalidateHidden(); updateFoldNodeHideCSS(); markChanged();
}
function unfoldGroup(g) {
  if (!g.folded) return;
  g.folded = false;
  g.h = Math.max(MIN_H, g.hOpen || MIN_H);
  g.w = Math.max(MIN_W, g.wOpen || g.w);
  delete g.foldNodes;
  delete g.foldGroups;
  invalidateHidden(); updateFoldNodeHideCSS(); markChanged();
}
function toggleFold(g) { if (g.folded) unfoldGroup(g); else foldGroup(g); }

// Small toast (ComfyUI's manager when present, else a brand-bordered banner).
function toast(summary, detail) {
  try { const t = app.extensionManager && app.extensionManager.toast; if (t && t.add) { t.add({ severity: "warn", summary, detail, life: 5000 }); return; } } catch (_e) {}
  try {
    const el = document.createElement("div");
    el.textContent = detail ? `${summary} - ${detail}` : summary;
    el.style.cssText = "position:fixed;top:56px;left:50%;transform:translateX(-50%);z-index:99999;background:#1d1d1d;color:#fff;border:1px solid " + BRAND + ";border-radius:6px;padding:9px 15px;font:13px 'Segoe UI',sans-serif;box-shadow:0 4px 14px rgba(0,0,0,0.45);max-width:540px;text-align:center;";
    document.body.appendChild(el); setTimeout(() => { try { el.remove(); } catch (_e) {} }, 5000);
  } catch (_e) {}
}

// ── fold hooks: hide folded members + their wires (both renderers) ─────────
let _foldHooksInstalled = false, _origCVN = null, _origRenderLink = null;
function installFoldHooks() {
  if (_foldHooksInstalled) return;
  const proto = (window.LiteGraph?.LGraphCanvas || window.LGraphCanvas)?.prototype;
  if (!proto) { setTimeout(installFoldHooks, 200); return; }
  // LEGACY: drop hidden members from visible_nodes (kills their paint + hit-test).
  if (typeof proto.computeVisibleNodes === "function") {
    _origCVN = proto.computeVisibleNodes;
    proto.computeVisibleNodes = function (nodes, out) {
      const res = _origCVN.call(this, nodes, out);
      try {
        const { hidden } = hiddenMaps();
        if (hidden.size && Array.isArray(res)) {
          for (let i = res.length - 1; i >= 0; i--) if (hidden.has(String(res[i].id))) res.splice(i, 1);
          const vn = this.visible_nodes;
          if (Array.isArray(vn) && vn !== res) for (let i = vn.length - 1; i >= 0; i--) if (hidden.has(String(vn[i].id))) vn.splice(i, 1);
        }
      } catch (_e) {}
      return res;
    };
  }
  // Hide a crossing wire whose hidden endpoint's group does NOT opt to show links.
  // Identify endpoints by the link's real node ids (reliable), never by position.
  if (typeof proto.renderLink === "function") {
    _origRenderLink = proto.renderLink;
    proto.renderLink = function (ctx, a, b, link, skipBorder, flow, color, startDir, endDir, opts) {
      try {
        if (link && link.origin_id != null) {
          const { owner } = hiddenMaps();
          if (owner.size) {
            const oG = owner.get(String(link.origin_id));
            const tG = owner.get(String(link.target_id));
            // Internal wire (both ends inside ONE folded group) → always hidden.
            if (oG && tG && oG === tG) return;
            if (oG || tG) {
              // Crossing wire (one end inside a folded group, the other outside):
              // hidden by default; when that group opts to "show links" we render it
              // REROUTED to the bar edge — so only outside-going wires show and they
              // connect to the bar instead of being cut off at the hidden node.
              const show = (oG ? oG.showLinks !== false : true) && (tG ? tG.showLinks !== false : true);
              if (!show) return;
              const na = oG ? barOut(oG) : a;
              const nb = tG ? barIn(tG) : b;
              let no = opts;
              if (opts) { no = Object.assign({}, opts); if (oG) no.startControl = undefined; if (tG) no.endControl = undefined; }
              return _origRenderLink.call(this, ctx, na || a, nb || b, link, skipBorder, flow, color, startDir, endDir, no);
            }
          }
        }
      } catch (_e) {}
      return _origRenderLink.call(this, ctx, a, b, link, skipBorder, flow, color, startDir, endDir, opts);
    };
  }
  _foldHooksInstalled = true;
}

// NODES 2.0: members are Vue DOM (not canvas), so the CVN wrap can't hide them —
// a stylesheet rule does (an !important rule survives Vue re-renders). No-op in legacy.
let _foldCSSEl = null, _foldCSSKey = "";
function updateFoldNodeHideCSS() {
  let ids = [];
  try { ids = isVueNodes() ? [...hiddenMaps().hidden] : []; } catch (_e) {}
  const key = ids.slice().sort().join(",");
  if (key === _foldCSSKey) return;
  _foldCSSKey = key;
  if (!_foldCSSEl) {
    _foldCSSEl = document.createElement("style");
    _foldCSSEl.id = "pix-pixgroup-fold-hide";
    (document.head || document.documentElement).appendChild(_foldCSSEl);
  }
  _foldCSSEl.textContent = ids.map((id) => `[data-node-id="${id}"]{display:none !important;}`).join("\n");
}

// Execution indicator: track which node is running (ComfyUI api events) so a folded
// bar can light up green + name the running member — you can't see the hidden nodes,
// so the bar tells you the group is busy. detail may be a bare id or { node }; a
// null id = the prompt finished.
let _execInstalled = false;
function installExecListeners() {
  if (_execInstalled || !api || !api.addEventListener) return;
  const clear = () => { _runningNodeId = null; _progress = null; repaint(); };
  api.addEventListener("executing", (e) => {
    const d = e && e.detail;
    _runningNodeId = d && typeof d === "object" ? d.node : d;
    if (_runningNodeId == null) _progress = null;
    repaint();
  });
  api.addEventListener("progress", (e) => {
    const d = (e && e.detail) || {};
    const node = d.node != null ? d.node : _runningNodeId;
    _progress = { value: Number(d.value) || 0, max: Number(d.max) || 0, node };
    repaint();
  });
  api.addEventListener("execution_start", clear);
  api.addEventListener("execution_success", clear);
  api.addEventListener("execution_error", clear);
  api.addEventListener("execution_interrupted", clear);
  _execInstalled = true;
}

// ── style editor popup ──────────────────────────────────────────────────
// Styling now lives in the shared color tool (js/node_colors openPixGroupPalette);
// this module only needs CSS for the inline-rename input on the header.
function injectRenameCSS() {
  if (document.getElementById("pix-pg-css")) return;
  const s = document.createElement("style");
  s.id = "pix-pg-css";
  s.textContent = `
.pix-pg-rename { position: fixed; z-index: 10001; box-sizing: border-box;
  background: rgba(20,20,20,0.96); border: 1px solid #f66744; border-radius: 4px;
  color: #fff; padding: 0 6px; font-family: 'Segoe UI', system-ui, sans-serif; font-weight: 600; outline: none; }
  `;
  document.head.appendChild(s);
}

// graph → screen rect for a group (used to position the inline-rename input).
function groupScreenRect(g) {
  const c = app.canvas, el = c?.canvas, ds = c?.ds;
  if (!el || !ds) return null;
  const r = el.getBoundingClientRect();
  const s = ds.scale || 1, o = ds.offset || [0, 0];
  const left = r.left + (g.x + o[0]) * s, top = r.top + (g.y + o[1]) * s;
  return { left, top, width: g.w * s, height: g.h * s, right: left + g.w * s, bottom: top + g.h * s };
}
// Inline rename right on the group header (native-group style), positioned over
// the title in screen space. Commit on Enter / blur, cancel on Esc.
function inlineRename(g) {
  injectRenameCSS();
  const rect = groupScreenRect(g);
  if (!rect) return;
  const scale = app.canvas?.ds?.scale || 1;
  const inp = document.createElement("input");
  inp.className = "pix-pg-rename";
  inp.value = g.title || "";
  inp.spellcheck = false;
  inp.style.left = (rect.left + 8 * scale) + "px";
  inp.style.top = (rect.top + 5 * scale) + "px";
  inp.style.width = Math.max(60, rect.width - 56 * scale) + "px";
  inp.style.height = Math.max(20, headerH(g) * scale - 10 * scale) + "px";
  inp.style.fontSize = Math.max(11, Math.round(gFontSize(g) * scale)) + "px";
  document.body.appendChild(inp);
  inp.focus(); inp.select();
  let done = false;
  const cleanup = () => { if (done) return; done = true; inp.removeEventListener("blur", commit); inp.remove(); };
  const commit = () => { g.title = inp.value; repaint(); markChanged(); cleanup(); };
  inp.addEventListener("blur", commit);
  inp.addEventListener("pointerdown", (e) => e.stopPropagation());
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); cleanup(); }
  });
}

// Help content for the group (a Pixaroma group isn't a real node, so it has no
// comfyClass and the node selection-toolbar "?" can't target it — we surface the
// same popup from the right-click menu instead).
const GROUP_HELP = {
  title: "Pixaroma Group",
  tagline: "A custom group container you fully control: color it, fold it, run it.",
  sections: [
    { heading: "Create & move", bullets: [
      "Right-click the canvas and pick \"Add Pixaroma Group\", or select nodes and press G.",
      "Drag the header to move it (the nodes inside move with it); drag the bottom-right corner to resize. Both snap to the grid when ComfyUI's \"Always snap to grid\" setting is on.",
      "Copy with Ctrl+C and paste with Ctrl+V - the pasted copy lands where your mouse is. Alt-drag the header also duplicates it.",
      "Double-click the title to rename. Select it and press Delete to remove it (the nodes stay).",
      "Right-click and pick \"Pin Group\" to lock it so it can't be moved or resized (a pin shows in its title). With several items selected it pins the whole selection, and ComfyUI's own Pin button now locks selected groups too. Unpin the same way.",
    ]},
    { heading: "Header buttons", defs: [
      ["Run", "Queue only this group's output nodes (a Save or Preview inside it)."],
      ["Mute", "Mute every node in the group (toggle); reaches into subgraphs."],
      ["Bypass", "Bypass every node in the group (toggle)."],
      ["Fold", "Collapse the whole group to a slim bar and hide its nodes. Click Unfold to reopen."],
    ]},
    { heading: "Folded bar", body: "While folded the bar turns green and names the node running inside it, so you can watch progress without the nodes showing. Wires that cross to outside nodes stay visible and attach to the bar; right-click the bar to hide them. Wires between hidden nodes stay hidden." },
    { heading: "Style", body: "Right-click and pick \"Edit Pixaroma Group\" (or press the \\ key with the group selected) to open the color tool: title and body color, title and body opacity, font size, plus your own saved favourites." },
  ],
};

// Right-click group menus use the new context-menu API (the getNodeMenuItems /
// getCanvasMenuItems hooks on the registerExtension config below), NOT a monkey-patch
// of getNodeMenuOptions / getCanvasMenuOptions (which ComfyUI deprecated). The hooks
// are part of the extension registration, so there is no install timing / retry to get
// right and no double-wrap flag needed.

// Ride ComfyUI's own save / undo / change-tracker cycle. graph.serialize() is
// what the change-tracker snapshots AND what a workflow save writes, so each
// graph's OWN groups (graph.extra.pixaromaGroups) ride every snapshot;
// graph.configure() is what load / undo / a graph reconcile calls, so we
// normalize our key back to a fresh PER-GRAPH array. Net effect: deleting a
// native group (which triggers a reconcile) can no longer wipe our groups, and
// undo/redo carry them. Both wraps operate on `this` (the graph being
// (de)serialized), NOT only app.graph, so background tabs AND subgraphs persist
// their OWN groups (the old app.graph-only guard never saved subgraph groups and
// let the active graph's groups bleed across tabs).
function installPersistence() {
  const G = app.graph?.constructor?.prototype || window.LGraph?.prototype;
  if (!G || G._pixGroupPersistWrapped) return;
  const origSerialize = G.serialize;
  G.serialize = function () {
    const data = origSerialize.apply(this, arguments);
    try {
      if (data) {
        const groups = this.extra && this.extra.pixaromaGroups;
        if (Array.isArray(groups) && groups.length) {
          if (!data.extra) data.extra = {};
          data.extra.pixaromaGroups = JSON.parse(JSON.stringify(groups));
        } else if (data.extra && "pixaromaGroups" in data.extra) {
          // No groups → OMIT the key entirely (deterministic: matches a workflow
          // that never had groups, instead of leaving a stale empty array).
          delete data.extra.pixaromaGroups;
        }
      }
    } catch (_e) { /* never break a save */ }
    return data;
  };
  const origConfigure = G.configure;
  G.configure = function (data) {
    const r = origConfigure.apply(this, arguments);
    try {
      // Normalize OUR key to a fresh per-graph array, decoupled from the saved
      // data object (so editing live groups never mutates the loaded JSON) — and a
      // graph with NO saved groups gets an EMPTY array, never another tab's groups.
      if (!this.extra) this.extra = {};
      const arr = data && data.extra && data.extra.pixaromaGroups;
      this.extra.pixaromaGroups = Array.isArray(arr) ? arr.map((x) => ({ ...x })) : [];
      if (this === curGraph()) {
        invalidateHidden();
        // a group loaded already folded must re-hide its members (Nodes 2.0 CSS;
        // legacy is handled by the computeVisibleNodes wrap on the next paint).
        try { updateFoldNodeHideCSS(); } catch (_e) {}
      }
    } catch (_e) { /* never break a load */ }
    return r;
  };
  G._pixGroupPersistWrapped = true;
}

// A Pixaroma group nested INSIDE a native ComfyUI group used to show the whole
// native-group menu (Fit Group To Nodes, Select Nodes, Bypass Group Nodes, Edit
// Group, AND our own ComfyUI-Group-Color items) stacked on top of the Pixaroma
// group's own menu, because the click point is also inside the native group so
// ComfyUI's getGroupOnPos finds it (GitLab #9). A Pixaroma group renders ON TOP,
// so when one covers the point the user is targeting IT — hide the native group
// from getGroupOnPos there. That single gate feeds ComfyUI's group options, the
// "Edit Group" submenu, AND node_colors' native-group color items, so suppressing
// it removes all of them at once. The native group stays fully interactive on its
// title bar (uses getGroupTitlebarOnPos), edges, resize corner, and uncovered
// body — groupAt only matches where a Pixaroma group is actually drawn.
function installGroupMenuGuard() {
  const G = app.graph?.constructor?.prototype || window.LGraph?.prototype;
  if (!G || G._pixGroupOnPosWrapped) return;
  const orig = G.getGroupOnPos;
  if (typeof orig !== "function") return;
  G.getGroupOnPos = function (x, y) {
    try {
      // Only on the graph where our (top-level) Pixaroma groups live; inside a
      // subgraph defer entirely so its native groups behave normally.
      if (this === curGraph() && groupAt([x, y])) return undefined;
    } catch (_e) {}
    return orig.apply(this, arguments);
  };
  G._pixGroupOnPosWrapped = true;
}

// ComfyUI Nodes 2.0 mixes TWO context-menu systems: a Vue/PrimeVue menu for NODES
// (`.p-contextmenu`) and the legacy LiteGraph DOM menu for the CANVAS/GROUPS
// (`.litecontextmenu`). PrimeVue's outside-close listens for a document 'click' (a LEFT
// click) — a right-click fires no click event, so right-clicking a group (which opens the
// legacy menu) leaves the prior Vue NODE menu open underneath → two menus stack (verified by
// DOM probe + the PrimeVue bundle). A node→node right-click is fine (opening a Vue menu DOES
// close the legacy one). Fix: on a CANVAS/group right-click, synthesize an outside 'click' so
// PrimeVue dismisses any stale Vue node menu BEFORE the legacy menu opens. Dispatched on
// document.body (not the canvas), so it only trips PrimeVue's document-level close listener —
// our own capture pointerdown handler ignores it (it's a click, not a pointerdown) and
// ComfyUI's canvas handlers never see it. No-op in Classic (no `.p-contextmenu`) and whenever
// no Vue menu is open. This also tidies the same stale-menu case for a plain empty-canvas
// right-click after a node menu (a general ComfyUI quirk, fixed here for free).
function installVueMenuDismissGuard() {
  if (window._pixVueMenuDismiss) return;
  window._pixVueMenuDismiss = true;
  window.addEventListener("contextmenu", (e) => {
    try {
      if (e.target?.closest?.("[data-node-id]")) return;      // node right-click: Vue replaces Vue, leave it
      if (!document.querySelector(".p-contextmenu")) return;  // no stale Vue node menu open
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true })); // PrimeVue closes on this
    } catch (_e) {}
  }, true);
}

// ── Pin / lock position (selection-aware + native-pin sync) ──────────────────
// Pixaroma groups aren't native objects, so ComfyUI's native Pin (selection
// toolbar / node menu) never touches them. Two hooks close that gap:
//  1) setSelectionPinned — our menu's "Pin selection" pins/unpins every selected
//     pixgroup AND the co-selected native nodes + native groups in one action.
//  2) installPinSync — wrap LGraphNode/LGraphGroup .pin() (what the native UI
//     calls per selected item) so a native pin of a mixed selection ALSO flips the
//     co-selected pixgroups: read the gesture's target off a just-pinned native
//     item and mirror it to our selected groups.
function setSelectionPinned(target) {
  for (const g of getSelectedGroups()) { if (target) g.pinned = true; else delete g.pinned; }
  const c = app.canvas;
  const nodes = c?.selected_nodes ? Object.values(c.selected_nodes) : [];
  for (const n of nodes) { try { n.pin?.(target); } catch (_e) {} }
  for (const grp of selectedNativeGroups()) { try { grp.pin?.(target); } catch (_e) {} }
  markChanged(); repaint();
  try { app.canvas?.setDirty(true, true); } catch (_e) {}
}

let _pinMirrorQueued = false;
function schedulePinMirror() {
  if (!_selectedIds.size || _pinMirrorQueued) return;
  _pinMirrorQueued = true;
  // Runs AFTER the native pin loop (it calls .pin() on each selected item
  // synchronously), so every native item is already at the gesture's target.
  queueMicrotask(() => {
    _pinMirrorQueued = false;
    if (!_selectedIds.size) return;
    const c = app.canvas;
    let target = null;
    const nodes = c?.selected_nodes ? Object.values(c.selected_nodes) : [];
    for (const n of nodes) { if (n && n.flags) { target = !!n.flags.pinned; break; } }
    if (target === null) for (const grp of selectedNativeGroups()) { if (grp) { target = !!(grp.pinned ?? grp.flags?.pinned); break; } }
    if (target === null) return; // no native item in the selection to mirror from
    let changed = false;
    for (const g of ensureGroups()) {
      if (!_selectedIds.has(g.id)) continue;
      if (target && !g.pinned) { g.pinned = true; changed = true; }
      else if (!target && g.pinned) { delete g.pinned; changed = true; }
    }
    if (changed) { markChanged(); repaint(); }
  });
}
function installPinSync() {
  const wrap = (proto) => {
    if (!proto || typeof proto.pin !== "function" || proto._pixPinWrapped) return;
    const orig = proto.pin;
    proto.pin = function (...a) { const r = orig.apply(this, a); try { schedulePinMirror(); } catch (_e) {} return r; };
    proto._pixPinWrapped = true;
  };
  try { wrap(window.LiteGraph?.LGraphNode?.prototype || app.graph?._nodes?.[0]?.constructor?.prototype); } catch (_e) {}
  try { const gp = window.LiteGraph?.LGraphGroup?.prototype || (app.graph?._groups && app.graph._groups[0] && app.graph._groups[0].constructor?.prototype); wrap(gp); } catch (_e) {}
}

app.registerExtension({
  name: "Pixaroma.PixGroup",
  settings: [
    {
      id: "Pixaroma.PixGroup.ButtonVisibility",
      name: "Group header buttons",
      type: "combo",
      options: ["Always", "Compact", "Hover only"],
      defaultValue: "Compact",
      tooltip:
        "When a Pixaroma group's header buttons show. Always: every button stays visible. " +
        "Compact: Fold and the node count stay, Run/Mute/Bypass appear on hover or select. " +
        "Hover only: everything (including Fold and the count) appears only when you hover or select the group.",
      category: ["👑 Pixaroma", "Group"],
      onChange: (v) => { _btnVis = mapBtnVis(v); repaint(); },
    },
  ],
  // "Group selected nodes" via ComfyUI's command + keybinding system (NOT a raw key
  // listener), so it shows in Settings → Keybindings, any conflict is surfaced there,
  // and the user can rebind it if another extension also wants G. Core bindings take
  // precedence, so this never silently steals a built-in key.
  commands: [
    {
      id: "Pixaroma.GroupSelected",
      label: "Pixaroma: Group selected nodes",
      function: () => {
        const sel = app.canvas?.selected_nodes ? Object.values(app.canvas.selected_nodes) : [];
        if (sel.length) addGroup(null);
        else toast("Select nodes first", "Select one or more nodes, then group them.");
      },
    },
  ],
  keybindings: [{ combo: { key: "g" }, commandId: "Pixaroma.GroupSelected" }],

  // NODE right-click menu — new context-menu API (replaces the deprecated
  // getNodeMenuOptions monkey-patch). "Add Pixaroma Group (G)" wraps the selected
  // node(s), same as pressing G (right-clicking a node selects it).
  getNodeMenuItems(node) {
    return [
      null,
      { content: "👑 Add Pixaroma Group (G)", callback: () => addGroup(null) },
    ];
  },

  // CANVAS right-click menu — new context-menu API (replaces the deprecated
  // getCanvasMenuOptions monkey-patch). `canvas` is a parameter (no `this`); read
  // canvas.graph_mouse for the right-click point and add the per-group entries only
  // when a Pixaroma group is under the cursor.
  getCanvasMenuItems(canvas) {
    const gm = canvas?.graph_mouse || app.canvas?.graph_mouse;
    const p = gm ? [gm[0], gm[1]] : null;
    const over = p ? groupAt(p) : null;
    const items = [
      null,
      { content: "👑 Add Pixaroma Group", callback: () => addGroup(p) },
    ];
    if (over) {
      items.push({ content: "👑 Pixaroma Group Colors (\\)", callback: () => { if (window.PixaromaNodeColors?.openPixGroup) window.PixaromaNodeColors.openPixGroup(over); else inlineRename(over); } });
      items.push({ content: "👑 Duplicate Pixaroma Group", callback: () => { const c = cloneGroupFrame(over, 40, 40); ensureGroups().push(c); _selectedIds = new Set([c.id]); _selectedId = c.id; clearNativeSelection(); markChanged(); } });
      items.push({ content: "👑 Copy Group Colors", callback: () => { window.PixaromaNodeColors?.setColorClipboard?.({ title: gTitleColor(over), body: gBodyColor(over) }); } });
      if (window.PixaromaNodeColors?.getColorClipboard?.()) items.push({ content: "👑 Paste Group Colors", callback: () => { const c = window.PixaromaNodeColors?.getColorClipboard?.(); if (!c) return; const sel = getSelectedGroups(); const tgts = (sel.length && sel.includes(over)) ? sel : [over]; for (const t of tgts) { t.titleColor = c.title; t.bodyColor = c.body; } markChanged(); } });
      items.push({ content: over.folded ? "👑 Unfold Group" : "👑 Fold Group", callback: () => toggleFold(over) });
      const _pixSel = getSelectedGroups();
      const _natN = canvas?.selected_nodes ? Object.keys(canvas.selected_nodes).length : 0;
      // The right-clicked group is part of a multi-selection → pin/unpin the WHOLE
      // selection (its pixgroups + co-selected native nodes + native groups), not
      // just this one. A lone group (or one not in the selection) toggles by itself.
      const _multiPin = _selectedIds.has(over.id) && (_pixSel.length > 1 || _natN > 0 || selectedNativeGroups().length > 0);
      items.push({
        content: _multiPin ? (over.pinned ? "👑 Unpin selection" : "👑 Pin selection")
                           : (over.pinned ? "👑 Unpin Group" : "👑 Pin Group"),
        callback: () => {
          const target = !over.pinned;
          if (_multiPin) setSelectionPinned(target);
          else { if (target) over.pinned = true; else delete over.pinned; markChanged(); repaint(); }
        },
      });
      if (over.folded) items.push({ content: (over.showLinks !== false) ? "👑 Hide links while folded" : "👑 Show links while folded", callback: () => { over.showLinks = (over.showLinks === false); invalidateHidden(); markChanged(); } });
      items.push({ content: "👑 Group Help", callback: () => openHelpPopup(GROUP_HELP) });
      items.push({ content: "👑 Delete Pixaroma Group", callback: () => deleteGroup(over) });
    } else {
      // No Pixaroma group here, but maybe a standard ComfyUI group is — offer to
      // convert it into a Pixaroma group (same size, title, and colour) so existing
      // layouts move to the new group style without rebuilding them by hand.
      const natGrp = p ? nativeGroupAt(p) : null;
      if (natGrp) {
        items.push({ content: "👑 Convert to Pixaroma Group", callback: () => convertNativeGroup(natGrp) });
      }
    }
    return items;
  },

  setup() {
    installDraw();
    installPersistence();
    installGroupMenuGuard();
    installVueMenuDismissGuard();
    installPinSync();
    installFoldHooks();
    installExecListeners();
    // onChange only fires when the user changes the setting — read the saved value
    // once at startup so a non-default choice applies on load.
    try { const v = app.ui?.settings?.getSettingValue?.("Pixaroma.PixGroup.ButtonVisibility"); if (v) _btnVis = mapBtnVis(v); } catch (_e) {}
    // Groups load per-graph from graph.extra.pixaromaGroups (ensureGroups reads it
    // fresh), so a workflow already open before this ran is picked up automatically.
    invalidateHidden();
    try { updateFoldNodeHideCSS(); } catch (_e) {}
    // Nodes 2.0: re-assert the hide CSS for groups loaded already folded (a node
    // element may mount a beat after configure). Cheap: a no-op unless the set changed.
    // installDraw is idempotent (returns if already wrapped); calling it here
    // self-heals the draw if ComfyUI ever recreates app.canvas (the wrap is on the
    // canvas INSTANCE, not the prototype). updateFoldNodeHideCSS re-asserts Nodes 2.0
    // hide CSS for late-mounted nodes.
    setInterval(() => { try { installDraw(); updateFoldNodeHideCSS(); installPinSync(); } catch (_e) {} }, 700);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onHover, false);
    window.addEventListener("pointerup", onWinPointerUp, true);
    window.addEventListener("pointercancel", onWinPointerUp, true); // also clears _lmbDown / carry on an interrupted drag
    window.addEventListener("dblclick", onDblClick, true);
    window.addEventListener("keydown", onKeyDown, true);
    // Safety net: if focus is lost mid-drag (alt-tab) the browser may emit no
    // pointerup, leaving _drag stuck (and onHover then early-returns forever). Clear
    // it on blur so the next interaction is clean.
    window.addEventListener("blur", () => {
      if (_drag) { _drag = null; stopWin(); try { window.PixaromaAlign?.endExternalDrag?.(); } catch (_e) {} }
      _natGrpDrag = null; _carry = null; _lmbDown = false; _clickDeselectPending = false; _pendingPixSelect = null;
      if (_carryRaf) { cancelAnimationFrame(_carryRaf); _carryRaf = 0; }
      _marqueeRect = null; _marqueeShift = false; // a marquee abandoned by alt-tab must not apply on the return release
    });
    // Expose to the color tool (js/node_colors): the "\" shortcut opens the
    // styling palette for the selected group; repaint after it edits fields.
    try {
      window.PixaromaPixGroup = {
        getSelected,
        getSelectedGroups,
        groupAt,
        repaint: () => repaint(),
        // For Align Pixaroma: every visible group's rect (snap TARGETS) + whether a
        // group is being dragged (so Align bails its node detector while we own the drag).
        allRects: () => ensureGroups().filter((g) => !isHiddenGroup(g)).map((g) => ({ id: g.id, x: g.x, y: g.y, w: g.w, h: g.h })),
        // group drag/resize, a node-drag carrying co-selected groups, OR a native
        // ComfyUI group being dragged WHILE it carries Pixaroma groups inside it.
        // In the last case Align must stand down (else it snaps the native group +
        // its nodes by a snapped delta while our carry moves the frames by the raw
        // delta → the node drifts/wiggles inside the frame). Scoped to pix.length so
        // a native group with NO Pixaroma group inside still gets Align's snapping.
        isDragging: () => !!_drag || !!_carry || !!(_natGrpDrag && _natGrpDrag.pix && _natGrpDrag.pix.length),
        // For the Group Switch node (js/group_switch): list groups (Pixaroma AND
        // native ComfyUI groups), read a group's live mute/bypass state, flip it,
        // and center the view on one to locate it.
        listGroups: listSwitchGroups,
        getGroupState: switchGroupState,
        setGroupSwitch: setSwitchGroup,
        revealGroup: revealSwitchGroup,
      };
    } catch (_e) {}
  },
});
