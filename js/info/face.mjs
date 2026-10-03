// Info Pixaroma - the button face, in both renderers.
//
// CLASSIC: no visible DOM. LiteGraph paints the node body in the button colour
// with the button's corner radius (installInfoBodyHook) and onDrawForeground
// paints the icon and title on top. The node stays a real canvas node, so it
// drags, selects and right-clicks like any other (run-timer.md #4c).
//
// NODES 2.0: a DOM widget is the button, inside the full title-less frame-
// hiding CSS stack copied from Run Timer (label.md #2, #4, #7). The widget
// subtree is pointer-events:none, so the canvas still places, drags and
// right-clicks the node; clicks are detected in index.js.
//
// SIZE MODEL (both renderers): the WIDTH carries the scale, s = width / unit
// width, and the height is M.h * s. Classic lets the corner drag change both
// (the smallest button containing the pointer, run-timer.md #1c); Nodes 2.0
// only takes the width, and the height follows the content.

import { app } from "../../../scripts/app.js";
import { NODE, M, MIN_S, MAX_S, readCfg, unitWidth, clampS, fontAt, titleWidth,
  iconImage, iconUrl, inkFor, iconOrDefault } from "./core.mjs";
import { isVueNodes, applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { removeNodeWidget } from "../shared/remove_widget.mjs";

// Nothing written in the note yet: no text, and nothing visual (a picture, a
// line, an icon). Blank markup the editor leaves behind counts as empty.
// Cached on the content string: the Classic face asks on every frame.
const _empty = new Map();
export function isEmptyNote(node) {
  const html = String(readCfg(node).content || "");
  if (!html.trim()) return true;
  let v = _empty.get(html);
  if (v === undefined) {
    if (/<(img|hr|iframe|a\s|span[^>]*pix-note-ic)/i.test(html)) v = false;
    // trim() also strips U+00A0, so only the entity needs replacing.
    else v = !html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
    if (_empty.size > 200) _empty.clear();
    _empty.set(html, v);
  }
  return v;
}

export function isInfo(node) {
  return !!node && (node.comfyClass === NODE || node.type === NODE);
}

// ── CLASSIC ─────────────────────────────────────────────────────────────────

// Fit scale for whatever size the node has. Normally width and height agree;
// a size saved by Nodes 2.0 (its stored height is 30 px short of what it
// rendered, run-timer.md #1f) is letterboxed instead of overflowing.
export function classicScale(node, info) {
  const u = unitWidth(info);
  return clampS(Math.min((node.size[0] || u) / u, (node.size[1] || M.h) / M.h));
}

// The body IS the button: LiteGraph fills the node rectangle with node.bgcolor
// and rounds it with LiteGraph.ROUND_RADIUS, so set both (and kill the drop
// shadow) for the duration of this node's draw. Restored in finally. Same
// approach as Run Timer's installRtBodyHook; each wrap checks its own type and
// passes everything else through, so they compose.
export function installInfoBodyHook() {
  if (typeof window === "undefined" || window._pixInfoBodyWrapped) return;
  const proto = window.LGraphCanvas && window.LGraphCanvas.prototype;
  if (!proto || typeof proto.drawNode !== "function") return;
  window._pixInfoBodyWrapped = true;
  const orig = proto.drawNode;
  proto.drawNode = function (node, ctx) {
    if (ctx && isInfo(node) && !isVueNodes()) {
      const sBg = node.bgcolor, sCol = node.color, sShadow = ctx.shadowColor;
      const LG = window.LiteGraph || {};
      const sR = LG.ROUND_RADIUS;
      try {
        const info = readCfg(node).info;
        const s = classicScale(node, info);
        node.bgcolor = info.color;
        node.color = info.color;
        LG.ROUND_RADIUS = Math.min(M.radius * s, (node.size[1] || M.h) / 2);
        ctx.shadowColor = "rgba(0,0,0,0)";
      } catch (_e) {}
      try { return orig.apply(this, arguments); }
      finally {
        node.bgcolor = sBg; node.color = sCol; ctx.shadowColor = sShadow;
        LG.ROUND_RADIUS = sR;
      }
    }
    return orig.apply(this, arguments);
  };
}

export function paintClassic(node, ctx) {
  const info = readCfg(node).info;
  const w = node.size[0], h = node.size[1];
  const s = classicScale(node, info);
  const ink = inkFor(info.color);
  const radius = Math.min(M.radius * s, h / 2);

  ctx.save();
  // Hover: a light wash, the "you can click this" cue.
  try {
    if (app.canvas?.node_over === node) {
      ctx.fillStyle = ink === "#ffffff" ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(0, 0, w, h, radius); else ctx.rect(0, 0, w, h);
      ctx.fill();
    }
  } catch (_e) {}
  // A thin top highlight, like the DOM button's inset shine.
  ctx.globalAlpha *= 0.18;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(radius, 0.5);
  ctx.lineTo(w - radius, 0.5);
  ctx.stroke();
  ctx.globalAlpha /= 0.18;

  // An EMPTY note: a dashed inner outline, the "nothing written yet" cue.
  // A click on it opens the editor instead of an empty window.
  if (isEmptyNote(node)) {
    const inset = 4 * s;
    ctx.globalAlpha *= 0.55;
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, 1.5 * s);
    ctx.setLineDash([4 * s, 3 * s]);
    ctx.beginPath();
    const rr = Math.max(0, radius - inset);
    if (ctx.roundRect) ctx.roundRect(inset, inset, w - 2 * inset, h - 2 * inset, rr);
    else ctx.rect(inset, inset, w - 2 * inset, h - 2 * inset);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha /= 0.55;
  }

  const tw = titleWidth(info.title) * s;
  const iconPx = M.icon * s;
  const gap = info.title ? M.gap * s : 0;
  const contentW = iconPx + gap + tw;
  let x = (w - contentW) / 2;
  const img = iconImage(info.icon, ink);
  if (img) ctx.drawImage(img, x, (h - iconPx) / 2, iconPx, iconPx);
  x += iconPx + gap;
  if (info.title) {
    ctx.font = fontAt(M.font * s);
    ctx.fillStyle = ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    // Middle baseline sits a touch high for caps-heavy text; nudge down.
    ctx.fillText(info.title, x, h / 2 + 0.5 * s);
  }
  ctx.restore();
}

// Classic resize gesture: the smallest button that CONTAINS the pointer, a
// pure function of the proposed size with no history (run-timer.md #1c - any
// rule that compares against what we wrote last frame oscillates).
export function applyResizeAspect(node, dir = "") {
  const info = readCfg(node).info;
  const u = unitWidth(info);
  const s = Math.max(MIN_S, Math.min(MAX_S, Math.max(node.size[0] / u, node.size[1] / M.h)));
  const w = Math.round(u * s), h = Math.round(M.h * s);
  // The canvas pins the OPPOSITE edge for the size it proposed; changing the
  // size here moved that edge (a top-left drag pushed the right edge 84 px,
  // measured). Re-pin it: a W corner keeps the right edge, an N corner the
  // bottom one. `dir` is LiteGraph's pointer.resizeDirection as read at the
  // START of the gesture (index.js): the canvas clears it after the first move
  // of the drag (measured: present on the first onResize call only).
  dir = String(dir || "");
  const right = node.pos[0] + node.size[0], bottom = node.pos[1] + node.size[1];
  if (Math.abs(node.size[0] - w) > 0.5) node.size[0] = w;
  if (Math.abs(node.size[1] - h) > 0.5) node.size[1] = h;
  if (dir.includes("W") && Math.abs(node.pos[0] - (right - w)) > 0.5) node.pos[0] = right - w;
  if (dir.includes("N") && Math.abs(node.pos[1] - (bottom - h)) > 0.5) node.pos[1] = bottom - h;
}

// The height a Classic button of this width should have.
export function heightForWidth(node) {
  return Math.round(M.h * clampS(node.size[0] / unitWidth(readCfg(node).info)));
}

// A Classic size whose height is far from what its width implies comes from
// Nodes 2.0: it stores a height 26-30 px SHORT of what it draws (measured: a
// button drawn 76 tall was stored as 50). Repair it from the width, outside a
// load and outside a gesture. The tolerance is deliberate: the title is
// measured with the system font, which differs a little between computers, so
// a workflow shared from another PC reads 5-10% off and must NOT be rewritten
// (it would flag itself modified on open). INSIDE the band nothing is written
// and the fit-scale painter simply letterboxes, which is harmless.
export function repairClassicHeight(node) {
  if (isGraphLoading() || isVueNodes()) return;
  try { if (app.canvas?.resizing_node === node) return; } catch (_e) {}
  const want = heightForWidth(node);
  const h = node.size[1];
  if (h < want * 0.8 || h > want * 1.25) node.size[1] = want;
}

// ── NODES 2.0 ───────────────────────────────────────────────────────────────

const CSS = [
  ".pix-info-root{--s:1;--c:#f66744;--ink:#fff;box-sizing:border-box;display:flex;align-items:center;justify-content:center;",
  "gap:calc(8px * var(--s));height:calc(34px * var(--s))!important;padding:0 calc(14px * var(--s));border-radius:calc(9px * var(--s));",
  "background:var(--c);color:var(--ink);font:600 calc(13px * var(--s))/1 \"Segoe UI\",system-ui,-apple-system,sans-serif;",
  "white-space:nowrap;overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,.18);user-select:none;flex:0 0 auto!important;}",
  ".pix-info-root .pix-info-ic{width:calc(18px * var(--s));height:calc(18px * var(--s));flex:none;background:currentColor;",
  "-webkit-mask:var(--i) center/contain no-repeat;mask:var(--i) center/contain no-repeat;}",
  // line-height 1.3: at 1 the clip cut the descenders off g, y, p (measured).
  ".pix-info-root .pix-info-tt{overflow:hidden;text-overflow:clip;line-height:1.3;}",
  // An empty note: the same dashed inner outline Classic paints.
  ".pix-info-root.is-empty{outline:max(1px,calc(1.5px * var(--s))) dashed color-mix(in srgb,var(--ink) 55%,transparent);outline-offset:calc(-4px * var(--s));}",
  // ── the title-less frame-hiding stack (run-timer.md #4e, label.md #4/#7) ──
  ".lg-node:has(.pix-info-root){background:transparent!important;border:none!important;box-shadow:none!important;}",
  // The node's direct child (the header-surface wrapper, rgb 29,29,29 on
  // frontend 1.53.6) has its own background, which showed as dark corners
  // under a big, very rounded button. A clock face is dark, so Run Timer
  // never showed it. Direct child only: a cheap selector (convention #36).
  ".lg-node:has(.pix-info-root) > div{background:transparent!important;}",
  ".lg-node:has(.pix-info-root),.lg-node:has(.pix-info-root) > div,.lg-node:has(.pix-info-root) > div > div{min-width:0!important;min-height:0!important;}",
  ".lg-node:has(.pix-info-root) .lg-node-header{display:none!important;}",
  ".lg-node:has(.pix-info-root) .lg-node-widgets{grid-template-columns:minmax(0,1fr)!important;padding:0!important;row-gap:0!important;gap:0!important;}",
  ".lg-node:has(.pix-info-root) .lg-node-widget{gap:0!important;width:100%!important;padding:0!important;}",
  ".lg-node:has(.pix-info-root) .lg-node-widget > *:first-child{display:none!important;}",
  ".lg-node:has(.pix-info-root) .lg-node-content{padding:0!important;}",
  ".lg-node:has(.pix-info-root) [class*=\"component-node-background\"]{padding:0!important;gap:0!important;background:transparent!important;}",
  // The footer row matched by its OWN class, never a nested descendant :has()
  // (CLAUDE.md convention #36: that form cost 10x on every pan and zoom).
  ".lg-node:has(.pix-info-root) [class*=\"component-node-background\"] > div.text-muted-foreground,.lg-node:has(.pix-info-root) .bg-node-component-surface{display:none!important;}",
  ".lg-node:has(.pix-info-root) > div.absolute.border:not([data-testid]){display:none!important;}",
  ".lg-node:has(.pix-info-root) [data-testid=\"node-state-outline-overlay\"],.lg-node:has(.pix-info-root) > div.absolute.outline-none{inset:-2px!important;}",
  ".lg-node:has(.pix-info-root) .lg-node-widgets,.lg-node:has(.pix-info-root) .lg-node-widgets *{pointer-events:none!important;}",
].join("\n");
let _cssDone = false;
function injectFaceCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const s = document.createElement("style");
  s.setAttribute("data-pixaroma-info", "1");
  s.textContent = CSS;
  document.head.appendChild(s);
}

// Write the current cfg into the DOM face. Style only: safe on the load path.
export function renderVueFace(node) {
  const root = node._pixInfoRoot;
  if (!root) return;
  const info = readCfg(node).info;
  root.style.setProperty("--c", info.color);
  root.style.setProperty("--ink", inkFor(info.color));
  node._pixInfoIc.style.setProperty("--i", `url("${iconUrl(iconOrDefault(info.icon))}")`);
  node._pixInfoTt.textContent = info.title;
  node._pixInfoTt.style.display = info.title ? "" : "none";
  const empty = isEmptyNote(node);
  root.classList.toggle("is-empty", empty);
  root.title = empty ? "Empty note - click to write it"
    : (info.title ? `${info.title} - click to read` : "Click to read");
  node._pixInfoApplyScale?.();
}

// The rendered WIDTH is what the user drags; hand the scale to the CSS. Writes
// nothing but a CSS variable (a setSize from a ResizeObserver fires mid-drag
// and desyncs Align's resize guard, and would run on the load path).
function installScaleObserver(node, root) {
  if (typeof ResizeObserver === "undefined") return () => {};
  let last = -1;
  const apply = () => {
    const w = root.parentElement ? root.parentElement.clientWidth : root.clientWidth;
    if (!(w > 0)) return;
    const s = clampS(w / unitWidth(readCfg(node).info));
    node._pixInfoScale = s;
    if (Math.abs(s - last) < 0.005) return;
    last = s;
    root.style.setProperty("--s", String(s));
  };
  const ro = new ResizeObserver(apply);
  ro.observe(root.parentElement || root);
  apply();
  node._pixInfoApplyScale = () => { last = -1; apply(); };
  return () => { node._pixInfoApplyScale = null; try { ro.disconnect(); } catch (_e) {} };
}

// ── Ctrl+Z in Nodes 2.0 (measured 2026-10-02, frontend 1.53.6) ──────────────
// Undo / redo rebuild EVERY node through app.loadGraphData, with the same ids.
// Vue keeps each node's component (same key), and core's WidgetDOM.vue mounts
// a widget's element only in onMounted, so the NEW node's face is never put on
// the page. Our old face is torn down in onRemoved, so every Info button went
// blank after any Ctrl+Z (and could not be clicked: the hit test needs the face
// on the page). The fix: teardown remembers the host the face sat in (the
// WidgetDOM div), and a new face that is still off the page shortly after it
// was built is put into that host - the same replaceChildren WidgetDOM does.
// Only when the host is on the page, EMPTY, and inside this node's element on
// the graph being shown, so it can never take another node's place.
const _hosts = new Map();   // String(node.id) -> the WidgetDOM div of the old face
const REMOUNT_WAIT = [0, 40, 120, 300, 800];

function hostOf(root) {
  const host = root?.parentElement;
  // Nodes 2.0 only: in Classic the parent is ComfyUI's .dom-widget wrapper.
  if (!host || host.classList.contains("dom-widget") || !host.closest(".lg-node")) return null;
  return host;
}

function remountIfOrphan(node, step = 0) {
  const root = node._pixInfoRoot;
  const key = String(node.id);
  if (!root || root.isConnected || !isVueNodes() || !node.graph) { if (root?.isConnected) _hosts.delete(key); return; }
  const host = _hosts.get(key);
  const nodeEl = host?.isConnected ? host.closest(".lg-node") : null;
  if (host && nodeEl && !host.firstElementChild && nodeEl.getAttribute("data-node-id") === key &&
      node.graph === app.canvas?.graph) {
    host.replaceChildren(root);
    _hosts.delete(key);
    renderVueFace(node);
    return;
  }
  if (step + 1 < REMOUNT_WAIT.length) setTimeout(() => remountIfOrphan(node, step + 1), REMOUNT_WAIT[step + 1]);
}

export function buildVueFace(node) {
  if (node._pixInfoRoot) return;
  injectFaceCSS();
  const root = document.createElement("div");
  root.className = "pix-info-root";
  const ic = document.createElement("span");
  ic.className = "pix-info-ic";
  const tt = document.createElement("span");
  tt.className = "pix-info-tt";
  root.appendChild(ic);
  root.appendChild(tt);
  node._pixInfoRoot = root;
  node._pixInfoIc = ic;
  node._pixInfoTt = tt;
  installCanvasZoomPassthrough(root);
  const widget = node.addDOMWidget("info_face", "pixaroma_info", root, {
    getValue: () => null,
    setValue: () => {},
    // A constant (CLAUDE.md #39 E): a live measure here creeps node.size.
    getMinHeight: () => Math.round(M.h * MIN_S),
    serialize: false,
  });
  widget.serialize = false;
  node._pixInfoWidget = widget;
  applyAdaptiveCanvasOnly(widget);
  // 0 in Classic: core arranges the node during the ~300 ms a torn-down face is
  // still attached after a flip, and a non-zero floor grew it (run-timer.md #13).
  widget.computeLayoutSize = () => ({ minHeight: isVueNodes() ? Math.round(M.h * MIN_S) : 0, minWidth: 1 });
  node._pixInfoScaleOff = installScaleObserver(node, root);
  renderVueFace(node);
  setTimeout(() => remountIfOrphan(node), REMOUNT_WAIT[0]);
}

export function teardownVueFace(node) {
  try { node._pixInfoScaleOff?.(); } catch (_e) {}
  node._pixInfoScaleOff = null;
  // The widget's own onRemove must run, or ComfyUI's widget store re-mounts it
  // (monitor.md #8). removeNodeWidget = node.removeWidget: onRemove + splice +
  // the store entry. The host is still read AFTER onRemove, as before (info.md #18).
  const w = node._pixInfoWidget || (node.widgets || []).find((x) => x && x.name === "info_face");
  removeNodeWidget(node, w);
  try {
    // Remember where a Nodes 2.0 face sat, for an undo that rebuilds this node
    // under the same id (remountIfOrphan above).
    const host = hostOf(node._pixInfoRoot);
    if (host) {
      if (_hosts.size > 200) _hosts.clear();
      _hosts.set(String(node.id), host);
    }
    const wrap = node._pixInfoRoot?.closest?.(".dom-widget");
    if (wrap) wrap.remove();
    node._pixInfoRoot?.remove();
  } catch (_e) {}
  node._pixInfoWidget = null;
  node._pixInfoRoot = null;
  node._pixInfoIc = null;
  node._pixInfoTt = null;
}

// The scale-1 size, which is also LiteGraph's resize floor in Classic.
export function classicComputeSize(node) {
  const info = readCfg(node).info;
  return [Math.round(unitWidth(info) * MIN_S), Math.round(M.h * MIN_S)];
}
