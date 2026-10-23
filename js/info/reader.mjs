// Info Pixaroma - the reading window.
//
// A floating window over the canvas showing one Info node's note: wide, larger
// text, scrolls, drags by its title bar, Esc or the X closes it. It does not
// block the canvas (you can read while you work), and one window serves every
// Info button: clicking another button swaps the note in.
//
// When the workflow has two or more Info buttons, a list on the left shows
// them all (subgraphs included), so the next note is one click away instead
// of a hunt on the canvas.
//
// The note is drawn by Note Pixaroma's own renderContent + stylesheet, so a
// download button, an icon or a table looks exactly as the editor made it.

import { app } from "../../../scripts/app.js";
import { injectCSS as injectNoteCSS } from "../note/css.mjs";
import { renderContent } from "../note/render.mjs";
import { ensureIcons, injectIconCSS } from "../note/icons.mjs";
import { isLiveNode } from "../shared/live_node.mjs";
import { openHelpFor } from "../shared/help.mjs";
import { pixAsset } from "../shared/api_url.mjs";
import { pixConfirm } from "../shared/confirm_dialog.mjs";
import { NODE, readCfg, writeCfg, withInfo, findWidget, iconUrl, inkFor, READER_MIN,
  TEXT_SCALE, clampTextScale } from "./core.mjs";
import { INFO_HELP } from "./help.mjs";
import { isEmptyNote } from "./face.mjs";

const QUESTION_ICON = pixAsset("icons/note/question-mark.svg");
const DELETE_ICON = pixAsset("icons/ui/delete.svg");

const CSS = [
  // z-index 1390: one under the Help window (1400), so the ? opens Help ON TOP.
  ".pix-info-reader{position:fixed;z-index:1390;display:flex;flex-direction:column;width:min(860px, calc(100vw - 32px));",
  "max-height:calc(100vh - 48px);background:#202020;border:1px solid #3d3d3d;border-radius:12px;box-shadow:0 14px 44px rgba(0,0,0,.7);",
  "overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;color:#e6e6e6;}",
  ".pix-info-reader.has-rail{width:min(1070px, calc(100vw - 32px));}",
  ".pix-info-rbar{display:flex;align-items:center;gap:8px;padding:9px 10px 9px 14px;background:#2a2a2a;border-bottom:1px solid #3a3a3a;",
  "cursor:move;user-select:none;flex:none;touch-action:none;}",
  ".pix-info-rbub{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex:none;}",
  ".pix-info-ric{width:19px;height:19px;display:block;-webkit-mask:var(--i) center/contain no-repeat;mask:var(--i) center/contain no-repeat;}",
  ".pix-info-rtt{font-weight:700;font-size:15px;color:#f2f2f2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:2px;}",
  ".pix-info-rsp{flex:1;}",
  ".pix-info-rbtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:600 12px 'Segoe UI',system-ui,sans-serif;color:#ddd;cursor:pointer;",
  "border:1px solid #4a4a4a;border-radius:6px;padding:5px 11px;background:rgba(255,255,255,.04);flex:none;}",
  ".pix-info-rbtn:hover:not([disabled]){border-color:#f66744;color:#fff;}",
  ".pix-info-rbtn[disabled]{opacity:.35;cursor:default;}",
  ".pix-info-rbtn .pix-info-rbi{width:13px;height:13px;background:currentColor;-webkit-mask:var(--i) center/contain no-repeat;mask:var(--i) center/contain no-repeat;}",
  // A- / A+ as one segmented control.
  ".pix-info-rsz{display:inline-flex;flex:none;}",
  ".pix-info-rsz .pix-info-rbtn{padding:4px 9px;min-width:30px;}",
  ".pix-info-rsz .pix-info-rbtn:first-child{border-radius:6px 0 0 6px;font-size:11px;}",
  ".pix-info-rsz .pix-info-rbtn:last-child{border-radius:0 6px 6px 0;border-left:0;font-size:14px;}",
  // The ? is the SAME orange circle as the Pixaroma Help button on the node
  // selection toolbar (help_toolbar/index.js), so people recognise it.
  ".pix-info-rhelp{width:24px;height:24px;padding:0;border:0;border-radius:50%;background:#f66744;margin:0 2px;}",
  `.pix-info-rhelp::before{content:"";width:14px;height:14px;background:#fff;-webkit-mask:url("${QUESTION_ICON}") center/contain no-repeat;mask:url("${QUESTION_ICON}") center/contain no-repeat;}`,
  ".pix-info-rhelp:hover:not([disabled]){filter:brightness(1.12);}",
  ".pix-info-rx{border:0;background:transparent;color:#aaa;font-size:17px;line-height:1;cursor:pointer;padding:4px 8px;border-radius:6px;flex:none;}",
  ".pix-info-rx:hover{color:#fff;background:rgba(255,255,255,.08);}",
  // Body: the list of notes (only with 2+ buttons) and the note.
  ".pix-info-rmain{display:flex;flex:1 1 auto;min-height:0;}",
  ".pix-info-rail{display:none;flex:none;width:210px;overflow-y:auto;background:#1a1a1a;border-right:1px solid #333;padding:10px 8px;}",
  ".pix-info-reader.has-rail .pix-info-rail{display:block;}",
  ".pix-info-rail-h{font-size:10.5px;font-weight:700;color:#888;letter-spacing:.06em;margin:2px 6px 6px;}",
  ".pix-info-ri{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:7px;background:transparent;",
  "font:13px 'Segoe UI',system-ui,sans-serif;color:#ccc;cursor:pointer;text-align:left;margin:1px 0;}",
  ".pix-info-ri:hover{background:#262626;color:#fff;}",
  ".pix-info-ri.on{background:#2c2c2c;color:#fff;box-shadow:inset 3px 0 0 #f66744;}",
  ".pix-info-ri .sq{width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;flex:none;}",
  ".pix-info-ri .sq i{width:14px;height:14px;display:block;-webkit-mask:var(--i) center/contain no-repeat;mask:var(--i) center/contain no-repeat;}",
  ".pix-info-ri .t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}",
  ".pix-info-ri small{color:#777;font-size:10.5px;flex:none;}",
  // Resize corner: two short diagonal strokes, the usual "drag me" mark.
  ".pix-info-rgrip{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;touch-action:none;z-index:2;",
  "background:linear-gradient(135deg,transparent 0 55%,#666 55% 61%,transparent 61% 72%,#666 72% 78%,transparent 78%);}",
  ".pix-info-rgrip:hover{background:linear-gradient(135deg,transparent 0 55%,#f66744 55% 61%,transparent 61% 72%,#f66744 72% 78%,transparent 78%);}",
  // The note: an outer scroller and an inner Note body that carries the text
  // size as a zoom (so the scrollbar keeps its normal size).
  ".pix-info-doc{flex:1 1 auto;min-width:0;min-height:80px;overflow-y:auto;padding:20px 32px 26px;background:#1e1e1e;}",
  ".pix-info-reader .pix-info-docin.pix-note-body{height:auto;overflow:visible;padding:0;font-size:14.5px;line-height:1.6;}",
  ".pix-info-reader .pix-info-docin.pix-note-body h1{font-size:22px;margin:2px 0 8px;}",
  ".pix-info-reader .pix-info-docin.pix-note-body h2{font-size:18px;margin:14px 0 6px;}",
  ".pix-info-reader .pix-info-docin.pix-note-body h3{font-size:16px;margin:14px 0 6px;}",
  ".pix-info-empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:30px 10px;color:#aaa;font-size:14px;}",
  ".pix-info-empty button{font:600 13px 'Segoe UI',system-ui,sans-serif;color:#fff;background:#f66744;border:0;border-radius:6px;padding:7px 16px;cursor:pointer;}",
  ".pix-info-empty button:hover{filter:brightness(1.1);}",
].join("\n");
let _cssDone = false;
function injectReaderCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const s = document.createElement("style");
  s.setAttribute("data-pixaroma-info-reader", "1");
  s.textContent = CSS;
  document.head.appendChild(s);
}

let _win = null;       // the window element
let _node = null;      // the node it shows
let _raw = null;       // the widget string it was drawn from
let _railSig = "";     // what the list of notes was built from
let _poll = null;
// WHERE the window sits is remembered in this browser (screens differ, so it
// is a per-viewer convenience: nothing breaks if storage is blocked). HOW BIG
// it is belongs to each Info button and is saved in the workflow
// (cfg.info.reader, the user's call 2026-10-01): a short note opens small, a
// long one big, the way its author sized it.
const POS_KEY = "pixaroma.info.reader.v1";
let _pos = null;       // { left, top }
try {
  const p = JSON.parse(localStorage.getItem(POS_KEY) || "null");
  if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) _pos = { left: p.left, top: p.top };
} catch (_e) { _pos = null; }
function savePos() {
  try { localStorage.setItem(POS_KEY, JSON.stringify(_pos || {})); } catch (_e) {}
}
const MIN_W = READER_MIN.w, MIN_H = READER_MIN.h;
let _onEdit = null;
let _onDelete = null;
let _keyOff = null;
let _pressInside = false;

// Moves that leave the window during a press that began in it (a text
// selection dragged past the edge). Installed once; idle unless a press began
// inside the reader.
if (typeof window !== "undefined" && !window._pixInfoReaderMoveGuard) {
  window._pixInfoReaderMoveGuard = true;
  window.addEventListener("pointermove", (e) => {
    if (!_pressInside) return;
    if (!(e.buttons & 1) || !_win || !_win.isConnected) { _pressInside = false; return; }
    if (!_win.contains(e.target)) e.stopPropagation();
  }, true);
  const release = () => { _pressInside = false; };
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);
}

export function setReaderEditHandler(fn) { _onEdit = fn; }
export function setReaderDeleteHandler(fn) { _onDelete = fn; }
export function readerNode() { return _win && _win.isConnected ? _node : null; }

export function closeReader() {
  if (_poll) { clearInterval(_poll); _poll = null; }
  try { _keyOff?.(); } catch (_e) {}
  _keyOff = null;
  if (_win) { try { _win.remove(); } catch (_e) {} }
  _win = null; _node = null; _raw = null; _railSig = "";
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ── The list of notes ───────────────────────────────────────────────────────
// Every live Info button of the open workflow: the root graph first, then each
// subgraph, each in reading order (top to bottom, then left to right).
export function listInfoNodes() {
  const out = [];
  const take = (graph, inSub) => {
    const nodes = (graph?._nodes || []).filter((n) => n && (n.comfyClass === NODE || n.type === NODE) && isLiveNode(n));
    nodes.sort((a, b) => (a.pos[1] - b.pos[1]) || (a.pos[0] - b.pos[0]));
    for (const n of nodes) out.push({ node: n, inSub });
  };
  try {
    take(app.graph, false);
    const subs = app.graph?.subgraphs;
    if (subs && typeof subs.values === "function") for (const sg of subs.values()) take(sg, true);
  } catch (_e) {}
  return out;
}

function railSignature(list) {
  return list.map(({ node, inSub }) => {
    const i = readCfg(node).info;
    return `${node.id}|${inSub ? 1 : 0}|${i.title}|${i.icon}|${i.color}|${isEmptyNote(node) ? 1 : 0}`;
  }).join("/");
}

function buildRail(win) {
  const rail = win.querySelector(".pix-info-rail");
  const list = listInfoNodes();
  const sig = railSignature(list) + "#" + (_node ? _node.id : "");
  if (sig === _railSig) return;
  _railSig = sig;
  const show = list.length >= 2;
  const wasShown = win.classList.contains("has-rail");
  win.classList.toggle("has-rail", show);
  rail.innerHTML = "";
  if (!show) { if (wasShown) { applySize(win, _node); place(win); } return; }
  rail.appendChild(el("div", "pix-info-rail-h", "THIS WORKFLOW"));
  for (const { node, inSub } of list) {
    const info = readCfg(node).info;
    const b = el("button", "pix-info-ri" + (node === _node ? " on" : ""));
    b.type = "button";
    b.title = inSub ? `${info.title || "Info"} (inside a subgraph)` : (info.title || "Info");
    const sq = el("span", "sq");
    sq.style.background = info.color;
    const ic = el("i");
    ic.style.setProperty("--i", `url("${iconUrl(info.icon)}")`);
    ic.style.background = inkFor(info.color);
    sq.appendChild(ic);
    b.appendChild(sq);
    b.appendChild(el("span", "t", info.title || "Info"));
    if (inSub) b.appendChild(el("small", null, "subgraph"));
    else if (isEmptyNote(node)) b.appendChild(el("small", null, "empty"));
    b.addEventListener("click", () => { if (node !== _node) openReader(node); });
    rail.appendChild(b);
  }
  if (!wasShown) { applySize(win, _node); place(win); }
}

// ── The note ────────────────────────────────────────────────────────────────
function fill(win, node) {
  const cfg = readCfg(node);
  const info = cfg.info;
  win.setAttribute("aria-label", info.title || "Info");
  win.querySelector(".pix-info-rbub").style.background = info.color;
  const ric = win.querySelector(".pix-info-ric");
  ric.style.setProperty("--i", `url("${iconUrl(info.icon)}")`);
  ric.style.background = inkFor(info.color);
  win.querySelector(".pix-info-rtt").textContent = info.title || "Info";
  const doc = win.querySelector(".pix-info-doc");
  const inner = win.querySelector(".pix-info-docin");
  // The same test the button uses for its dashed "empty" outline.
  if (isEmptyNote(node)) {
    inner.innerHTML = "";
    const box = el("div", "pix-info-empty");
    box.appendChild(el("div", null, "This note is empty."));
    const b = el("button", null, "Write it");
    b.type = "button";
    b.addEventListener("click", () => editFromReader());
    box.appendChild(b);
    inner.appendChild(box);
  } else {
    // renderContent writes node.color / node.bgcolor for Note's own canvas
    // body. Hand it a stand-in so it can never touch the real node.
    renderContent({ _noteCfg: cfg, bgcolor: "#000000" }, inner);
  }
  const bg = typeof cfg.backgroundColor === "string" && /^#[0-9a-f]{6}$/i.test(cfg.backgroundColor) ? cfg.backgroundColor : "";
  doc.style.background = bg;
  applyTextScale(win, info);
  _raw = findWidget(node)?.value ?? null;
  buildRail(win);
}

function applyTextScale(win, info) {
  const s = clampTextScale(info.textScale ?? 1);
  const inner = win.querySelector(".pix-info-docin");
  inner.style.zoom = s === 1 ? "" : String(s);
  const [minus, plus] = win.querySelectorAll(".pix-info-rsz .pix-info-rbtn");
  if (minus) { minus.disabled = s <= TEXT_SCALE.min + 1e-6; minus.title = `Smaller text (now ${Math.round(s * 100)}%)`; }
  if (plus) { plus.disabled = s >= TEXT_SCALE.max - 1e-6; plus.title = `Bigger text (now ${Math.round(s * 100)}%)`; }
}

// A- / A+ for THIS button, saved with the workflow like its window size.
function stepTextScale(dir) {
  const node = _node;
  if (!node || !isLiveNode(node) || !_win) return;
  const cfg = readCfg(node);
  const now = clampTextScale(cfg.info.textScale ?? 1);
  const next = clampTextScale(now + dir * TEXT_SCALE.step);
  if (next === now) return;
  const changes = next === 1 ? { textScale: undefined } : { textScale: next };
  const out = withInfo(cfg, changes);
  if (next === 1) delete out.info.textScale;
  writeCfg(node, out);
  _raw = findWidget(node)?.value ?? null;   // our own write: no redraw needed
  applyTextScale(_win, out.info);
}

function editFromReader() {
  const n = _node;
  closeReader();
  if (n && _onEdit) _onEdit(n, { reopenReader: true });
}

// Delete from the window asks first (the right-click Delete does not: user's
// call 2026-10-02). Cancel has the focus, so Enter keeps the button.
async function deleteFromReader() {
  const n = _node;
  if (!n || !isLiveNode(n) || !_onDelete) return;
  // The name goes in the title, shortened so it stays on one line; the message
  // is two fixed lines that fit the box, so no line is left with a lone word
  // (user, 2026-10-02: one word on its own line looks bad).
  const name = readCfg(n).info.title || "Info";
  let short = name;
  if (name.length > 40) {
    const cut = name.slice(0, 40);
    const sp = cut.lastIndexOf(" ");
    short = (sp > 20 ? cut.slice(0, sp) : cut.slice(0, 39)).trimEnd() + "…";   // at a whole word
  }
  const ok = await pixConfirm({
    title: `Delete "${short}"?`,
    message: "The button and its note will be removed from the workflow.\nCtrl+Z brings it back.",
    okText: "Delete",
    danger: true,
  });
  if (!ok || !isLiveNode(n) || !n.graph) return;
  if (readerNode() === n) closeReader();
  _onDelete(n);
}

// ── Size and position ───────────────────────────────────────────────────────
// The size this button's author gave its window, or the default (width from
// the stylesheet, height fitting the note). A saved size larger than this
// screen is clamped to it.
function applySize(win, node) {
  const r = node ? readCfg(node).info.reader : null;
  if (r) {
    win.style.width = `${Math.round(Math.max(MIN_W, Math.min(r.w, window.innerWidth - 16)))}px`;
    win.style.height = `${Math.round(Math.max(MIN_H, Math.min(r.h, window.innerHeight - 16)))}px`;
  } else {
    win.style.width = "";
    win.style.height = "";
  }
}

function place(win) {
  const w = win.offsetWidth, h = win.offsetHeight;
  let left, top;
  if (_pos) { left = _pos.left; top = _pos.top; }
  else { left = (window.innerWidth - w) / 2; top = Math.max(24, window.innerHeight * 0.08); }
  // Keep the WHOLE window on screen: each button opens at its own size, so a
  // taller note shown where a short one stood would otherwise run off the
  // bottom (measured: top 275 + 858 tall on a 906 px window). It moves up or
  // left just enough; the remembered spot itself is not changed.
  left = Math.max(8, Math.min(window.innerWidth - Math.min(w, window.innerWidth - 16) - 8, left));
  top = Math.max(8, Math.min(window.innerHeight - Math.min(h, window.innerHeight - 16) - 8, top));
  win.style.left = `${Math.round(left)}px`;
  win.style.top = `${Math.round(top)}px`;
}

// One pointer drag with BOTH defences of CLAUDE.md convention #20: pointer
// capture on the handle, and stopping as soon as the button is up (a lost
// release otherwise leaves the window stuck to the cursor).
function startDrag(handle, e, onMove, onEnd) {
  e.preventDefault();
  let ended = false;
  try { handle.setPointerCapture(e.pointerId); } catch (_e) {}
  const move = (ev) => {
    if (!(ev.buttons & 1)) { end(); return; }
    onMove(ev);
  };
  const end = () => {
    if (ended) return;
    ended = true;
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    handle.removeEventListener("lostpointercapture", end);
    try { handle.releasePointerCapture(e.pointerId); } catch (_e) {}
    onEnd?.();
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("lostpointercapture", end);
}

// Move by the title bar.
function wireDrag(win, bar) {
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    const r = win.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    startDrag(bar, e, (ev) => {
      const left = Math.max(80 - r.width, Math.min(window.innerWidth - 80, ev.clientX - dx));
      const top = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy));
      win.style.left = `${Math.round(left)}px`;
      win.style.top = `${Math.round(top)}px`;
      _pos = { left, top };
    }, savePos);
  });
}

// Save (or clear, with null) the window size on the button it belongs to.
// A user action, so it may flag the workflow modified - that is the point:
// the size travels with the workflow.
function saveSizeOnNode(node, size) {
  if (!node || !isLiveNode(node)) return;
  const cfg = readCfg(node);
  const before = JSON.stringify(cfg.info.reader || null);
  const reader = size ? { w: Math.round(size.w), h: Math.round(size.h) } : null;
  if (JSON.stringify(reader) === before) return;
  const out = withInfo(cfg, { reader });
  if (!reader) delete out.info.reader;
  writeCfg(node, out);
  _raw = findWidget(node)?.value ?? null;   // our own write: no redraw needed
}

// Size by the bottom-right corner. Double-click it to go back to the default.
function wireResize(win, grip) {
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const r = win.getBoundingClientRect();
    // Where in the corner the pointer landed, so the corner does not jump.
    const ox = e.clientX - r.right, oy = e.clientY - r.bottom;
    let size = null;
    const node = _node;
    startDrag(grip, e, (ev) => {
      const w = Math.max(MIN_W, Math.min(ev.clientX - ox - r.left, window.innerWidth - r.left - 8));
      const h = Math.max(MIN_H, Math.min(ev.clientY - oy - r.top, window.innerHeight - r.top - 8));
      win.style.width = `${Math.round(w)}px`;
      win.style.height = `${Math.round(h)}px`;
      size = { w, h };
    }, () => { if (size && node === _node) saveSizeOnNode(node, size); });
  });
  grip.addEventListener("dblclick", () => {
    saveSizeOnNode(_node, null);
    applySize(win, _node);
    place(win);
  });
}

// ── Open ────────────────────────────────────────────────────────────────────
export function openReader(node) {
  if (!node) return;
  injectNoteCSS();
  injectReaderCSS();
  ensureIcons().then(() => injectIconCSS()).catch(() => {});

  // Another button's note: reuse the window where it stands.
  if (_win && _win.isConnected) {
    _node = node;
    fill(_win, node);
    // Each button opens at its own size, at the spot the user chose (a taller
    // note may have been nudged up to fit; a shorter one goes back).
    if (!_pos) _pos = { left: _win.offsetLeft, top: _win.offsetTop };
    applySize(_win, node);
    place(_win);
    return;
  }
  closeReader();
  const win = el("div", "pix-info-reader");
  win.setAttribute("role", "dialog");
  const bar = el("div", "pix-info-rbar");
  const bub = el("span", "pix-info-rbub");
  bub.appendChild(el("span", "pix-info-ric"));
  bar.appendChild(bub);
  bar.appendChild(el("span", "pix-info-rtt"));
  bar.appendChild(el("span", "pix-info-rsp"));
  const sz = el("span", "pix-info-rsz");
  const minus = el("button", "pix-info-rbtn", "A−");
  minus.type = "button";
  minus.addEventListener("click", () => stepTextScale(-1));
  const plus = el("button", "pix-info-rbtn", "A+");
  plus.type = "button";
  plus.addEventListener("click", () => stepTextScale(1));
  sz.appendChild(minus);
  sz.appendChild(plus);
  bar.appendChild(sz);
  const edit = el("button", "pix-info-rbtn");
  edit.type = "button";
  edit.title = "Edit this note and the button";
  const ei = el("span", "pix-info-rbi");
  ei.style.setProperty("--i", `url("${iconUrl("edit")}")`);
  edit.appendChild(ei);
  edit.appendChild(document.createTextNode("Edit"));
  edit.addEventListener("click", () => editFromReader());
  bar.appendChild(edit);
  const del = el("button", "pix-info-rbtn");
  del.type = "button";
  del.title = "Delete this Info button from the workflow (asks first)";
  const di = el("span", "pix-info-rbi");
  di.style.setProperty("--i", `url("${DELETE_ICON}")`);
  del.appendChild(di);
  del.appendChild(document.createTextNode("Delete"));
  del.addEventListener("click", () => { deleteFromReader(); });
  bar.appendChild(del);
  const help = el("button", "pix-info-rbtn pix-info-rhelp");
  help.type = "button";
  help.setAttribute("aria-label", "Help");
  help.title = "How Info Pixaroma works";
  help.addEventListener("click", () => openHelpFor(NODE, INFO_HELP));
  bar.appendChild(help);
  const x = el("button", "pix-info-rx", "✕");
  x.type = "button";
  x.title = "Close (Esc)";
  x.addEventListener("click", () => closeReader());
  bar.appendChild(x);
  win.appendChild(bar);
  const main = el("div", "pix-info-rmain");
  main.appendChild(el("div", "pix-info-rail"));
  const doc = el("div", "pix-info-doc");
  doc.appendChild(el("div", "pix-info-docin pix-note-body"));
  main.appendChild(doc);
  win.appendChild(main);
  const grip = el("div", "pix-info-rgrip");
  grip.title = "Drag to resize. Double-click for the default size.";
  win.appendChild(grip);
  // A press inside the window (dragging it, selecting text) must not reach
  // ComfyUI. MEASURED in Nodes 2.0: dragging the title bar ALSO moved the
  // selected node underneath, 44,60 for a 50,60 drag. The mover is Pixaroma
  // Align: its window pointermove listener takes ANY left-button move as a
  // drag of the selected node (Shift, which Align ignores, left the node put).
  // So the press, and every move until the release, stays in here: moves on
  // the window stop at the window; moves that wander off it are stopped at
  // the top (window capture) so neither Align nor the canvas acts on them.
  win.addEventListener("pointerdown", (e) => { _pressInside = true; e.stopPropagation(); });
  win.addEventListener("pointermove", (e) => { if (e.buttons) e.stopPropagation(); });
  document.body.appendChild(win);
  _win = win;
  _node = node;
  fill(win, node);
  applySize(win, node);
  place(win);
  wireDrag(win, bar);
  wireResize(win, grip);

  const onKey = (e) => {
    if (e.key !== "Escape" || !_win) return;
    // Esc in a text box elsewhere belongs to that box.
    const t = e.target;
    if (t && t !== document.body && !_win.contains(t) &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    // Leave Esc to anything open on top of us (a ComfyUI dialog, a menu, Help,
    // the "Delete this Info button?" question, which Esc must cancel alone).
    if (document.querySelector(".p-dialog-mask, .litecontextmenu, .pix-info-start, .pix-help-backdrop, .pix-cfm-back")) return;
    // ComfyUI's dialogs left PrimeVue (Settings already on frontend 1.55, all of them on 1.57): no .p-dialog-mask,
    // only role="dialog", which this window carries too. Measured: Esc closed us under an open Settings dialog.
    if ([...document.querySelectorAll('[role="dialog"]')].some((d) => d !== _win &&
        d.getAttribute("data-state") !== "closed" && d.getBoundingClientRect().width > 0)) return;
    // The Help window sits above us (it is opened from our ? button), so Esc
    // closes it first, wherever the focus is. Its own Esc only works while the
    // focus is inside it, and a click on its text leaves the focus on the page,
    // which used to close THIS window underneath instead (reproduced).
    const hb = document.querySelector(".pixhb-win");
    const hbOpen = window.PixaromaHelpBrowser?.isOpen
      ? window.PixaromaHelpBrowser.isOpen()
      : !!(hb && hb.offsetParent !== null && getComputedStyle(hb).display !== "none");
    if (hbOpen) {
      if (hb && hb.contains(document.activeElement)) return;   // its own handler closes it
      if (typeof window.PixaromaHelpBrowser?.close === "function") {
        e.preventDefault();
        e.stopPropagation();
        window.PixaromaHelpBrowser.close();
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    closeReader();
  };
  const onResize = () => { if (_win) { applySize(_win, _node); place(_win); } };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onResize);
  _keyOff = () => {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
  };

  // Close when the node goes (deleted, workflow switched), follow edits made
  // elsewhere (Ctrl+Z, a starter) by re-drawing when the saved note changes,
  // and keep the list of notes current (a button added, renamed, removed).
  _poll = setInterval(() => {
    if (!_node || !isLiveNode(_node) || !_node.graph) { closeReader(); return; }
    const raw = findWidget(_node)?.value ?? null;
    if (raw !== _raw && _win) { fill(_win, _node); applySize(_win, _node); place(_win); }
    else if (_win) buildRail(_win);
  }, 400);
}
