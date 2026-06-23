import { app } from "/scripts/app.js";
import { isVueNodes } from "../shared/index.mjs";

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
// Touches NOTHING in js/group_pixaroma, js/node_colors, or js/align. Purely
// additive. If the feel passes: add color (Node Colors palette) + Align
// support, port the header buttons, then retire the native-group overlay.

const BRAND = "#f66744";
const DEFAULT_COLOR = "#3f789e";
const HANDLE = 18;      // bottom-right resize grab box, graph units
const MIN_W = 140, MIN_H = 80;

let _idc = 0;
function newId() { return "pg_" + Date.now().toString(36) + "_" + (_idc++); }

// Authoritative in-memory list of our groups for the current graph. We keep
// graph.extra.pixaromaGroups pointed at it AND (via installPersistence) inject
// it into every graph.serialize() + re-read it on every graph.configure(), so
// ComfyUI's change-tracker snapshots always carry our groups — an undo or a
// native-group delete that reconciles the graph state can no longer wipe them.
let _mirror = [];
function ensureGroups() {
  const g = app.graph;
  if (g) {
    if (!g.extra) g.extra = {};
    if (g.extra.pixaromaGroups !== _mirror) g.extra.pixaromaGroups = _mirror;
  }
  return _mirror;
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
function gTitleAlpha(g) { return Number.isFinite(g.titleAlpha) ? g.titleAlpha : 0.92; }
function gBodyAlpha(g)  { return Number.isFinite(g.bodyAlpha)  ? g.bodyAlpha  : 0.12; }
function gFontSize(g)   { return Number.isFinite(g.fontSize)   ? g.fontSize   : 14; }
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

// ── geometry ────────────────────────────────────────────────────────────
function inRect(g, p)   { return p[0] >= g.x && p[0] <= g.x + g.w && p[1] >= g.y && p[1] <= g.y + g.h; }
function inHeader(g, p) { return p[0] >= g.x && p[0] <= g.x + g.w && p[1] >= g.y && p[1] <= g.y + headerH(g); }
function inResize(g, p) { return p[0] >= g.x + g.w - HANDLE && p[0] <= g.x + g.w && p[1] >= g.y + g.h - HANDLE && p[1] <= g.y + g.h; }
function groupAt(p) {
  const gs = ensureGroups();
  for (let i = gs.length - 1; i >= 0; i--) if (inRect(gs[i], p)) return gs[i];
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
  for (const n of (app.graph?._nodes || [])) {
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
    for (const n of (app.graph?._nodes || [])) byId[String(n.id)] = n;
    const out = [];
    for (const id of g.foldNodes) { const n = byId[String(id)]; if (n) out.push(n); }
    return out;
  }
  return containedNodes(g);
}

// Set of all node ids hidden by folded groups + whether each owner shows wires.
// Cached; invalidated on fold / unfold / delete / configure (the id set only
// changes then — node moves don't change it).
let _hiddenCache = null;
function invalidateHidden() { _hiddenCache = null; }
function buildHidden() {
  const hidden = new Set();
  const showById = new Map(); // idStr -> owning folded group's showLinks
  for (const g of ensureGroups()) {
    if (!g.folded || !Array.isArray(g.foldNodes)) continue;
    const sl = !!g.showLinks;
    for (const id of g.foldNodes) { const s = String(id); hidden.add(s); if (!showById.has(s)) showById.set(s, sl); }
  }
  return { hidden, showById };
}
function hiddenMaps() { if (!_hiddenCache) _hiddenCache = buildHidden(); return _hiddenCache; }

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

// Vertically center text by its ACTUAL glyph box. Digit-only / caps text drawn
// with textBaseline:"middle" floats visually high (the em box reserves descender
// space the glyphs don't use), so center by the measured ascent/descent instead.
function fillTextVCenter(ctx, text, x, yMid) {
  const m = ctx.measureText(text);
  if (m.actualBoundingBoxAscent != null && m.actualBoundingBoxDescent != null) {
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, yMid + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  } else {
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, yMid);
  }
}

let _selectedId = null;
let _hoverId = null;        // group whose buttons are revealed (cursor inside it)
let _hotBtn = null;         // { gid, key } of the button under the cursor
let _hoverPt = null;        // last cursor pos in graph coords

// Header-button geometry — the SINGLE source for both paint + hit-test, so they
// can't drift. Buttons sit at the header's right; the count badge to their left.
// Folded → one Unfold button; expanded → Run / Mute / Bypass / Fold.
const BSZ = 18, BGAP = 4, BPAD = 8, BICON = 12;
function headerButtons(g, showButtons) {
  const hH = headerH(g);
  let rx = g.x + g.w - BPAD;
  const btns = [];
  if (showButtons) {
    const keys = g.folded ? ["unfold"] : ["run", "mute", "bypass", "fold"];
    const by = g.y + (hH - BSZ) / 2;
    for (let i = keys.length - 1; i >= 0; i--) { rx -= BSZ; btns.unshift({ key: keys[i], x: rx, y: by, w: BSZ, h: BSZ }); rx -= BGAP; }
    rx -= 6;
  }
  const bw = 24, bh = 16;
  const badge = { x: rx - bw, y: g.y + (hH - bh) / 2, w: bw, h: bh };
  const titleClipW = Math.max(20, badge.x - 6 - (g.x + 12));
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
  const sel = g.id === _selectedId;
  const scale = app.canvas?.ds?.scale || 1;
  const tInk = ink(tColor);
  const showBtns = g.id === _hoverId || g.id === _selectedId;
  const layout = headerButtons(g, showBtns);

  // interior fill (body color + body opacity) — when folded, g.h IS the bar height
  ctx.fillStyle = rgba(bColor, bA);
  roundRect(ctx, g.x, g.y, g.w, g.h, 8); ctx.fill();

  // header bar (title color + title opacity), clipped to the rounded top
  ctx.save();
  roundRect(ctx, g.x, g.y, g.w, g.h, 8); ctx.clip();
  ctx.fillStyle = rgba(tColor, tA);
  ctx.fillRect(g.x, g.y, g.w, hH);
  ctx.restore();

  // border (from the title color; orange when selected)
  ctx.strokeStyle = sel ? BRAND : rgba(tColor, Math.max(0.5, tA));
  ctx.lineWidth = (sel ? 2.5 : 1.5) / scale;
  roundRect(ctx, g.x, g.y, g.w, g.h, 8); ctx.stroke();

  // title (clipped so it doesn't run under the badge / buttons)
  ctx.save();
  ctx.beginPath(); ctx.rect(g.x, g.y, layout.titleClipW, hH); ctx.clip();
  ctx.fillStyle = tInk;
  ctx.font = `600 ${fs}px 'Segoe UI', system-ui, sans-serif`;
  ctx.textBaseline = "middle"; ctx.textAlign = "left";
  ctx.fillText(g.title || "Group", g.x + 12, g.y + hH / 2 + 1);
  ctx.restore();

  // node-count badge
  const count = groupMemberNodes(g).length;
  const bd = layout.badge;
  ctx.fillStyle = tInk === "#ffffff" ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.22)";
  roundRect(ctx, bd.x, bd.y, bd.w, bd.h, 8); ctx.fill();
  ctx.fillStyle = tInk;
  ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  fillTextVCenter(ctx, String(count), bd.x + bd.w / 2, bd.y + bd.h / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  // header buttons (revealed on hover / select)
  if (showBtns) for (const b of layout.btns) drawButton(ctx, b, g, tInk);

  // resize handle (bottom-right) — not while folded (the bar isn't resizable).
  if (!g.folded) {
    ctx.save();
    roundRect(ctx, g.x, g.y, g.w, g.h, 8); ctx.clip();
    ctx.fillStyle = rgba(tColor, sel ? 1 : 0.85);
    ctx.beginPath();
    ctx.moveTo(g.x + g.w, g.y + g.h - HANDLE);
    ctx.lineTo(g.x + g.w, g.y + g.h);
    ctx.lineTo(g.x + g.w - HANDLE, g.y + g.h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
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
    try {
      const gs = ensureGroups();
      if (gs.length) { ctx.save(); for (const g of gs) drawOne(ctx, g); ctx.restore(); }
    } catch (_e) { /* never break the canvas */ }
  };
  c._pixGroupBgWrapped = true;
}

// ── interaction ─────────────────────────────────────────────────────────
let _drag = null;

function repaint() { try { app.canvas?.setDirty(true, true); } catch (_e) {} }
function markChanged() { try { app.graph?.change?.(); } catch (_e) {} repaint(); }

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

function onDown(e) {
  if (e.button !== 0) return;
  const c = app.canvas;
  if (!c || e.target !== c.canvas) return; // only the graph canvas surface
  const p = screenToGraph(e.clientX, e.clientY);
  if (!p) return;
  const gs = ensureGroups();
  for (let i = gs.length - 1; i >= 0; i--) {
    const g = gs[i];
    // header buttons FIRST, so a button click never starts a drag/rename
    if (inHeader(g, p)) {
      const { btns } = headerButtons(g, true);
      for (const b of btns) {
        if (p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h) {
          _selectedId = g.id; e.preventDefault(); e.stopImmediatePropagation();
          runButtonAction(g, b.key); repaint(); return;
        }
      }
    }
    if (!g.folded && inResize(g, p)) {
      _drag = { mode: "resize", g, ox: p[0], oy: p[1], ow: g.w, oh: g.h };
      _selectedId = g.id; e.preventDefault(); e.stopImmediatePropagation(); startWin(); repaint(); return;
    }
    if (inHeader(g, p)) {
      // groupMemberNodes (not containedNodes) so a folded bar drags its hidden members.
      const members = groupMemberNodes(g).map((n) => ({ n, dx: n.pos[0] - g.x, dy: n.pos[1] - g.y }));
      _drag = { mode: "move", g, ox: p[0], oy: p[1], gx: g.x, gy: g.y, members };
      _selectedId = g.id; e.preventDefault(); e.stopImmediatePropagation(); startWin(); repaint(); return;
    }
  }
  // Clicked the body (likely a node) or empty canvas → deselect, do NOT
  // consume so node-drag / marquee / pan all work normally.
  if (_selectedId != null) { _selectedId = null; repaint(); }
}

function onMove(e) {
  if (!_drag) return;
  const p = screenToGraph(e.clientX, e.clientY);
  if (!p) return;
  const g = _drag.g;
  if (_drag.mode === "move") {
    g.x = _drag.gx + (p[0] - _drag.ox);
    g.y = _drag.gy + (p[1] - _drag.oy);
    for (const m of _drag.members) { m.n.pos[0] = g.x + m.dx; m.n.pos[1] = g.y + m.dy; }
  } else {
    g.w = Math.max(MIN_W, _drag.ow + (p[0] - _drag.ox));
    g.h = Math.max(MIN_H, _drag.oh + (p[1] - _drag.oy));
  }
  e.preventDefault(); e.stopPropagation();
  repaint();
}

function onUp(e) {
  if (!_drag) return;
  _drag = null;
  stopWin();
  markChanged();
}

// Cursor hint so the grab zones are discoverable: a resize arrow over the
// bottom-right handle, a move cursor over the header. Bubble phase so it wins
// over ComfyUI's own per-move cursor; only clears what WE set (no flicker
// fight elsewhere).
let _cursorOverride = false;
function onHover(e) {
  if (_drag) return;
  const el = app.canvas?.canvas;
  if (!el) return;
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
    if (!inRect(g, p)) continue;
    hoverId = g.id; // hovering anywhere in the group reveals its buttons
    if (inHeader(g, p)) {
      const { btns } = headerButtons(g, true);
      for (const b of btns) if (p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h) { hotBtn = { gid: g.id, key: b.key }; break; }
    }
    if (hotBtn) cur = "pointer";
    else if (!g.folded && inResize(g, p)) cur = "nwse-resize";
    else if (inHeader(g, p)) cur = "move";
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

// Keyboard: G wraps the selected nodes in a Pixaroma group (like ComfyUI's
// group-selected); Delete / Backspace removes the selected Pixaroma group (ours
// only — we consume the event so ComfyUI doesn't also delete nodes). Both are
// ignored while typing or holding a modifier.
function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;

  // G — group the selected nodes. Only acts (and consumes the key) when there IS
  // a selection, so a bare 'g' otherwise passes through to anything else.
  if ((e.key === "g" || e.key === "G") && !e.shiftKey) {
    const sel = app.canvas?.selected_nodes ? Object.values(app.canvas.selected_nodes) : [];
    if (sel.length) { e.preventDefault(); e.stopImmediatePropagation(); addGroup(null); }
    return;
  }

  if (e.key === "Delete" || e.key === "Backspace") {
    if (document.querySelector(".pix-nc-pal, .pix-pg-rename")) return; // editing → don't delete
    const g = getSelected();
    if (!g) return;
    e.preventDefault(); e.stopImmediatePropagation();
    deleteGroup(g);
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
      const { btns } = headerButtons(g, true);
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
  let x, y, w, h;
  if (sel.length) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const n of sel) {
      const b = nodeVisualBounds(n);
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
    titleColor: DEFAULT_COLOR, bodyColor: DEFAULT_COLOR,
    titleAlpha: 0.92, bodyAlpha: 0.12, fontSize: 14,
  };
  gs.push(g);
  _selectedId = g.id;
  markChanged();
}
function deleteGroup(g) {
  const gs = ensureGroups();
  const i = gs.indexOf(g);
  if (i >= 0) gs.splice(i, 1);
  if (_selectedId === g.id) _selectedId = null;
  invalidateHidden(); updateFoldNodeHideCSS(); // a folded group deleted → un-hide its nodes
  markChanged();
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

// Fold = collapse the whole group to a slim bar: capture the member ids, shrink the
// box to the header height, hide the members (computeVisibleNodes wrap in legacy +
// a CSS rule in Nodes 2.0) and their crossing wires (renderLink wrap; hidden by
// default, per-group "show links" opt-in). All fields ride on the group object,
// so they serialize with the group.
function foldGroup(g) {
  if (g.folded) return;
  g.foldNodes = containedNodes(g).map((n) => String(n.id));
  g.hOpen = g.h;
  g.folded = true;
  g.h = headerH(g);
  if (g.showLinks == null) g.showLinks = false;
  invalidateHidden(); updateFoldNodeHideCSS(); markChanged();
}
function unfoldGroup(g) {
  if (!g.folded) return;
  g.folded = false;
  g.h = Math.max(MIN_H, g.hOpen || MIN_H);
  delete g.foldNodes;
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
          const { hidden, showById } = hiddenMaps();
          if (hidden.size) {
            const o = String(link.origin_id), t = String(link.target_id);
            const oh = hidden.has(o), th = hidden.has(t);
            if (oh || th) {
              const showO = oh ? showById.get(o) : true;
              const showT = th ? showById.get(t) : true;
              if (!(showO && showT)) return; // hidden by default while folded
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

function installMenu() {
  const C = window.LGraphCanvas?.prototype;
  if (!C || !C.getCanvasMenuOptions || C._pixGroupMenuWrapped) return;
  const orig = C.getCanvasMenuOptions;
  C.getCanvasMenuOptions = function () {
    const opts = orig.apply(this, arguments) || [];
    const gm = this.graph_mouse || app.canvas?.graph_mouse;
    const p = gm ? [gm[0], gm[1]] : null;
    const over = p ? groupAt(p) : null;
    opts.push(null);
    opts.push({ content: "👑 Add Pixaroma Group", callback: () => addGroup(p) });
    if (over) {
      opts.push({ content: "👑 Edit Pixaroma Group", callback: () => { if (window.PixaromaNodeColors?.openPixGroup) window.PixaromaNodeColors.openPixGroup(over); else inlineRename(over); } });
      opts.push({ content: over.folded ? "👑 Unfold Group" : "👑 Fold Group", callback: () => toggleFold(over) });
      if (over.folded) opts.push({ content: over.showLinks ? "👑 Hide links while folded" : "👑 Show links while folded", callback: () => { over.showLinks = !over.showLinks; invalidateHidden(); markChanged(); } });
      opts.push({ content: "👑 Delete Pixaroma Group", callback: () => deleteGroup(over) });
    }
    return opts;
  };
  C._pixGroupMenuWrapped = true;
}

// Ride ComfyUI's own save / undo / change-tracker cycle. graph.serialize() is
// what the change-tracker snapshots AND what a workflow save writes, so
// injecting our live list there means every snapshot carries our groups;
// graph.configure() is what load / undo / a graph reconcile calls, so we re-read
// our list from the restored data. Net effect: deleting a native group (which
// triggers a reconcile) can no longer wipe our groups, and undo/redo carry them.
function installPersistence() {
  const G = app.graph?.constructor?.prototype || window.LGraph?.prototype;
  if (!G || G._pixGroupPersistWrapped) return;
  const origSerialize = G.serialize;
  G.serialize = function () {
    const data = origSerialize.apply(this, arguments);
    try {
      if (this === app.graph && _mirror.length && data) {
        if (!data.extra) data.extra = {};
        data.extra.pixaromaGroups = JSON.parse(JSON.stringify(_mirror));
      }
    } catch (_e) { /* never break a save */ }
    return data;
  };
  const origConfigure = G.configure;
  G.configure = function (data) {
    const r = origConfigure.apply(this, arguments);
    try {
      if (this === app.graph) {
        const arr = data && data.extra && data.extra.pixaromaGroups;
        _mirror.length = 0;
        if (Array.isArray(arr)) for (const x of arr) _mirror.push({ ...x });
        if (this.extra) this.extra.pixaromaGroups = _mirror;
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

app.registerExtension({
  name: "Pixaroma.PixGroup",
  setup() {
    installDraw();
    installMenu();
    installPersistence();
    installFoldHooks();
    // Pick up groups from a workflow that was already loaded before this ran.
    try {
      const init = app.graph?.extra?.pixaromaGroups;
      if (Array.isArray(init)) { _mirror.length = 0; for (const x of init) _mirror.push({ ...x }); }
    } catch (_e) {}
    invalidateHidden();
    try { updateFoldNodeHideCSS(); } catch (_e) {}
    // Nodes 2.0: re-assert the hide CSS for groups loaded already folded (a node
    // element may mount a beat after configure). Cheap: a no-op unless the set changed.
    setInterval(() => { try { updateFoldNodeHideCSS(); } catch (_e) {} }, 700);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onHover, false);
    window.addEventListener("dblclick", onDblClick, true);
    window.addEventListener("keydown", onKeyDown, true);
    // Expose to the color tool (js/node_colors): the "\" shortcut opens the
    // styling palette for the selected group; repaint after it edits fields.
    try {
      window.PixaromaPixGroup = {
        getSelected,
        groupAt,
        repaint: () => repaint(),
      };
    } catch (_e) {}
  },
});
