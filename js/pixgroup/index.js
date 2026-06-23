import { app } from "/scripts/app.js";

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
const TITLE_H = 30;     // header bar height, graph units
const HANDLE = 18;      // bottom-right resize grab box, graph units
const MIN_W = 140, MIN_H = 80;

let _idc = 0;
function newId() { return "pg_" + Date.now().toString(36) + "_" + (_idc++); }

function ensureGroups() {
  const g = app.graph;
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
function inHeader(g, p) { return p[0] >= g.x && p[0] <= g.x + g.w && p[1] >= g.y && p[1] <= g.y + TITLE_H; }
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

function drawOne(ctx, g) {
  const color = g.color || DEFAULT_COLOR;
  const sel = g.id === _selectedId;
  const scale = app.canvas?.ds?.scale || 1;
  const tInk = ink(color);

  // interior tint
  ctx.fillStyle = rgba(color, 0.12);
  roundRect(ctx, g.x, g.y, g.w, g.h, 8); ctx.fill();

  // header bar (clipped to the rounded top)
  ctx.save();
  roundRect(ctx, g.x, g.y, g.w, g.h, 8); ctx.clip();
  ctx.fillStyle = rgba(color, 0.92);
  ctx.fillRect(g.x, g.y, g.w, TITLE_H);
  ctx.restore();

  // border (orange when selected)
  ctx.strokeStyle = sel ? BRAND : rgba(color, 0.85);
  ctx.lineWidth = (sel ? 2.5 : 1.5) / scale;
  roundRect(ctx, g.x, g.y, g.w, g.h, 8); ctx.stroke();

  // title (clipped so it doesn't run under the badge)
  ctx.save();
  ctx.beginPath(); ctx.rect(g.x, g.y, g.w - 46, TITLE_H); ctx.clip();
  ctx.fillStyle = tInk;
  ctx.font = "600 14px 'Segoe UI', system-ui, sans-serif";
  ctx.textBaseline = "middle"; ctx.textAlign = "left";
  ctx.fillText(g.title || "Group", g.x + 12, g.y + TITLE_H / 2 + 1);
  ctx.restore();

  // node-count badge
  const count = containedNodes(g).length;
  const bw = 28, bh = 16, bx = g.x + g.w - bw - 8, by = g.y + (TITLE_H - bh) / 2;
  ctx.fillStyle = tInk === "#ffffff" ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.22)";
  roundRect(ctx, bx, by, bw, bh, 8); ctx.fill();
  ctx.fillStyle = tInk;
  ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  fillTextVCenter(ctx, String(count), bx + bw / 2, by + bh / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  // resize handle (bottom-right) — clipped to the rounded border so its outer
  // corner follows the curve instead of poking a sharp triangle past the edge.
  ctx.save();
  roundRect(ctx, g.x, g.y, g.w, g.h, 8); ctx.clip();
  ctx.fillStyle = rgba(color, sel ? 1 : 0.85);
  ctx.beginPath();
  ctx.moveTo(g.x + g.w, g.y + g.h - HANDLE);
  ctx.lineTo(g.x + g.w, g.y + g.h);
  ctx.lineTo(g.x + g.w - HANDLE, g.y + g.h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

let _origDrawGroups = null;
function installDraw() {
  const C = window.LGraphCanvas?.prototype;
  if (!C || !C.drawGroups || C._pixGroupDrawWrapped) return;
  _origDrawGroups = C.drawGroups;
  C.drawGroups = function (canvas, ctx) {
    try { _origDrawGroups.apply(this, arguments); } catch (_e) { /* keep ours alive */ }
    try {
      const gs = ensureGroups();
      if (gs.length) { ctx.save(); for (const g of gs) drawOne(ctx, g); ctx.restore(); }
    } catch (_e) { /* never break the canvas */ }
  };
  C._pixGroupDrawWrapped = true;
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
    if (inResize(g, p)) {
      _drag = { mode: "resize", g, ox: p[0], oy: p[1], ow: g.w, oh: g.h };
      _selectedId = g.id; e.preventDefault(); e.stopImmediatePropagation(); startWin(); repaint(); return;
    }
    if (inHeader(g, p)) {
      const members = containedNodes(g).map((n) => ({ n, dx: n.pos[0] - g.x, dy: n.pos[1] - g.y }));
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
    const pad = 22;
    x = minx - pad; y = miny - pad - TITLE_H;
    w = (maxx - minx) + pad * 2; h = (maxy - miny) + pad * 2 + TITLE_H;
  } else {
    x = p ? p[0] : 100; y = p ? p[1] : 100; w = 320; h = 220;
  }
  const g = { id: newId(), title: "Pixaroma Group", x, y, w: Math.max(MIN_W, w), h: Math.max(MIN_H, h), color: DEFAULT_COLOR };
  gs.push(g);
  _selectedId = g.id;
  markChanged();
}
function renameGroup(g) {
  const t = window.prompt("Group title", g.title || "Pixaroma Group");
  if (t != null) { g.title = t; markChanged(); }
}
function deleteGroup(g) {
  const gs = ensureGroups();
  const i = gs.indexOf(g);
  if (i >= 0) gs.splice(i, 1);
  if (_selectedId === g.id) _selectedId = null;
  markChanged();
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
      opts.push({ content: "👑 Rename Pixaroma Group", callback: () => renameGroup(over) });
      opts.push({ content: "👑 Delete Pixaroma Group", callback: () => deleteGroup(over) });
    }
    return opts;
  };
  C._pixGroupMenuWrapped = true;
}

app.registerExtension({
  name: "Pixaroma.PixGroup",
  setup() {
    installDraw();
    installMenu();
    window.addEventListener("pointerdown", onDown, true);
    // Prototype: expose a console helper for quick add while testing.
    try { window.PixAddGroup = () => addGroup(app.canvas?.graph_mouse ? [app.canvas.graph_mouse[0], app.canvas.graph_mouse[1]] : null); } catch (_e) {}
  },
});
