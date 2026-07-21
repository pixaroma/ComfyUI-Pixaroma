// Text Join Pixaroma - the floating settings panel (Sizes / Sliders pattern:
// themed panel beside the node, draggable by its header, closes on outside click
// or Esc). Picks the separator (custom dark dropdown, never a native <select>)
// and whether to skip empty fields. The node face stays just the text boxes.

import { app } from "/scripts/app.js";
import { isVueNodes } from "../shared/index.mjs";
import { BRAND, SEP_OPTIONS, readState, writeState, saveGlobalDefault } from "./core.mjs";

let _panel = null;
let _panelNode = null;
let _onChange = null;
let _ddCleanup = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function injectCSS() {
  if (document.getElementById("pix-tjp-css")) return;
  const s = document.createElement("style");
  s.id = "pix-tjp-css";
  s.textContent = `
    .pix-tjp { position:fixed; z-index:10010; width:288px; max-width:94vw; background:#1a1a1a;
      border:1px solid #4a4a4a; border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,0.6);
      color:#d8d8d8; font:12px 'Segoe UI',-apple-system,sans-serif; overflow:hidden; }
    .pix-tjp-t { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#232323;
      border-bottom:1px solid #333; cursor:grab; user-select:none; color:${BRAND}; }
    .pix-tjp-t .x { margin-left:auto; color:#8a8a8a; cursor:pointer; padding:0 4px; }
    .pix-tjp-t .x:hover { color:#fff; }
    .pix-tjp-b { padding:12px; display:flex; flex-direction:column; gap:14px; }

    .pix-tjp-field { display:flex; flex-direction:column; gap:6px; }
    .pix-tjp-lab { font-size:12px; color:#9a9a9a; }
    .pix-tjp-hint { font-size:11px; color:#7a7a7a; }

    .pix-tjp-ddv { display:flex; align-items:center; gap:8px; background:#1d1d1d; border:1px solid #3a3a3a;
      border-radius:6px; padding:8px 10px; cursor:pointer; }
    .pix-tjp-ddv:hover { border-color:${BRAND}; }
    .pix-tjp-ddv .l { flex:1; color:#e2e2e2; }
    .pix-tjp-ddv .c { color:#bdbdbd; font-size:11px; }

    .pix-tjp-custom { background:#161616; border:1px solid #3a3a3a; border-radius:6px; color:#fff;
      font:12px monospace; padding:8px 9px; outline:none; }
    .pix-tjp-custom:focus { border-color:${BRAND}; }

    .pix-tjp-tgrow { display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .pix-tjp-tog { width:36px; height:20px; border-radius:10px; background:rgba(255,255,255,0.14);
      position:relative; flex:none; cursor:pointer; transition:background .12s; }
    .pix-tjp-tog::after { content:""; position:absolute; top:2px; left:2px; width:16px; height:16px;
      border-radius:50%; background:#fff; transition:left .12s; }
    .pix-tjp-tog.on { background:${BRAND}; }
    .pix-tjp-tog.on::after { left:18px; }

    .pix-tjp-f { display:flex; gap:8px; padding:10px 12px; border-top:1px solid #333; background:#1f1f1f; }
    .pix-tjp-btn { border:1px solid #444; background:rgba(255,255,255,0.04); color:#d8d8d8; border-radius:5px;
      padding:6px 12px; font:12px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-tjp-btn:hover { border-color:${BRAND}; color:#fff; }
    .pix-tjp-push { margin-left:auto; }

    .pix-tjp-dd { position:fixed; z-index:10020; width:236px; max-width:92vw; background:#242424;
      border:1px solid ${BRAND}; border-radius:8px; box-shadow:0 14px 44px rgba(0,0,0,0.6);
      overflow:hidden; font:12px 'Segoe UI',sans-serif; color:#ddd; }
    .pix-tjp-dd-opt { display:flex; align-items:baseline; gap:8px; padding:8px 11px; cursor:pointer; }
    .pix-tjp-dd-opt:hover { background:#2f2f2f; }
    .pix-tjp-dd-opt .l { flex:none; color:#e2e2e2; font-size:12.5px; }
    .pix-tjp-dd-opt .h { flex:1; text-align:right; color:#7d7d7d; font-size:11px; }
    .pix-tjp-dd-opt.cur .l { color:${BRAND}; }
  `;
  document.head.appendChild(s);
}

function getNodeScreenRect(node) {
  if (isVueNodes() && node && node.id != null) {
    const e = document.querySelector(`[data-node-id="${node.id}"]`);
    if (e) return e.getBoundingClientRect();
  }
  const c = app.canvas;
  const ds = c && c.ds;
  const cv = c && c.canvas;
  if (!ds || !cv || !node?.pos || !node?.size) return null;
  const cr = cv.getBoundingClientRect();
  const titleH = window.LiteGraph?.NODE_TITLE_HEIGHT || 30;
  const sc = ds.scale || 1;
  const off = ds.offset || [0, 0];
  const left = cr.left + (node.pos[0] + off[0]) * sc;
  const top = cr.top + (node.pos[1] - titleH + off[1]) * sc;
  const width = node.size[0] * sc;
  const height = (node.size[1] + titleH) * sc;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function placeBeside(panel, rect) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = panel.offsetWidth, mh = panel.offsetHeight;
  const gap = 12, pad = 8;
  if (!rect) {
    panel.style.left = Math.max(pad, (vw - mw) / 2) + "px";
    panel.style.top = Math.max(pad, (vh - mh) / 2) + "px";
    return;
  }
  let left = rect.right + gap;
  if (left + mw > vw - pad) left = rect.left - gap - mw;
  if (left < pad) left = Math.max(pad, vw - mw - pad);
  let top = rect.top;
  if (top + mh > vh - pad) top = vh - mh - pad;
  if (top < pad) top = pad;
  panel.style.left = left + "px";
  panel.style.top = top + "px";
}

function makeDraggable(panel, handle) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".x")) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev) => {
      if (!panel.isConnected) return up();
      panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, ev.clientX - ox)) + "px";
      panel.style.top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ev.clientY - oy)) + "px";
    };
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  });
}

function closeDropdown() {
  if (_ddCleanup) { try { _ddCleanup(); } catch { /* ignore */ } }
  _ddCleanup = null;
  document.querySelector(".pix-tjp-dd")?.remove();
}

function openDropdown(anchor, currentKey, onPick) {
  closeDropdown();
  const pop = el("div", "pix-tjp-dd");
  for (const o of SEP_OPTIONS) {
    const row = el("div", "pix-tjp-dd-opt" + (o.key === currentKey ? " cur" : ""));
    row.append(el("span", "l", o.label), el("span", "h", o.hint));
    row.addEventListener("click", () => { onPick(o.key); closeDropdown(); });
    pop.appendChild(row);
  }
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.width = Math.max(r.width, 200) + "px";
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + "px";
  const h = pop.offsetHeight;
  pop.style.top = (r.bottom + 4 + h <= window.innerHeight - 8)
    ? (r.bottom + 4) + "px" : Math.max(8, r.top - 4 - h) + "px";
  // Dismiss on outside pointer / wheel / Esc (all capture; skip inside the popup
  // AND the anchor so its own click doesn't immediately reopen->close).
  const onDown = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closeDropdown(); };
  const onWheel = (e) => { if (!pop.contains(e.target)) closeDropdown(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeDropdown(); } };
  setTimeout(() => {
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("wheel", onWheel, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  _ddCleanup = () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("wheel", onWheel, true);
    document.removeEventListener("keydown", onKey, true);
  };
}

function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  if (e.target.closest?.(".pix-tjp-dd")) return;   // the separator dropdown
  closeTextJoinPanel();
}
function escClose(e) {
  if (e.key === "Escape" && _panel) {
    if (document.querySelector(".pix-tjp-dd")) return;   // dropdown owns Esc first
    e.stopPropagation();
    closeTextJoinPanel();
  }
}

export function closeTextJoinPanel() {
  closeDropdown();
  if (_panel) { try { _panel.remove(); } catch { /* ignore */ } }
  _panel = null;
  _panelNode = null;
  _onChange = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

export function closeTextJoinPanelFor(node) {
  if (_panelNode === node) closeTextJoinPanel();
}

export function openTextJoinPanel(node, onChange) {
  closeTextJoinPanel();
  injectCSS();
  _onChange = onChange || null;
  _panelNode = node;

  const panel = el("div", "pix-tjp");
  const title = el("div", "pix-tjp-t");
  title.append(el("span", null, "⚙"), el("span", null, "Text Join settings"));
  const x = el("span", "x", "✕");
  x.addEventListener("click", closeTextJoinPanel);
  title.appendChild(x);

  const body = el("div", "pix-tjp-b");
  const foot = el("div", "pix-tjp-f");

  const fire = () => { _onChange?.(); };

  function buildBody() {
    body.innerHTML = "";
    const st = readState(node);
    const opt = SEP_OPTIONS.find((o) => o.key === st.sep) || SEP_OPTIONS[0];

    // Separator picker (custom dark dropdown).
    const sepField = el("div", "pix-tjp-field");
    sepField.appendChild(el("div", "pix-tjp-lab", "Separator (goes between each piece)"));
    const ddv = el("div", "pix-tjp-ddv");
    ddv.append(el("span", "l", opt.label), el("span", "c", "▾"));
    ddv.addEventListener("click", () => {
      openDropdown(ddv, st.sep, (key) => {
        writeState(node, { ...readState(node), sep: key });
        fire(); buildBody();
      });
    });
    sepField.appendChild(ddv);
    sepField.appendChild(el("div", "pix-tjp-hint", opt.hint));

    if (st.sep === "custom") {
      const custom = el("input", "pix-tjp-custom");
      custom.type = "text";
      custom.value = st.customSep;
      custom.placeholder = "e.g.  \\n   or   |   or   ,";
      custom.title = "Typed exactly as-is between the pieces (spaces count).";
      custom.addEventListener("keydown", (e) => e.stopPropagation());
      custom.addEventListener("input", () => {
        writeState(node, { ...readState(node), customSep: custom.value });
        fire();
      });
      sepField.appendChild(custom);
    }
    body.appendChild(sepField);

    // Skip empty toggle.
    const skipField = el("div", "pix-tjp-field");
    const trow = el("div", "pix-tjp-tgrow");
    trow.append(el("span", "pix-tjp-lab", "Skip empty fields"));
    const tog = el("div", "pix-tjp-tog" + (st.skipEmpty ? " on" : ""));
    tog.addEventListener("click", () => {
      writeState(node, { ...readState(node), skipEmpty: !readState(node).skipEmpty });
      fire(); buildBody();
    });
    trow.appendChild(tog);
    skipField.appendChild(trow);
    skipField.appendChild(el("div", "pix-tjp-hint",
      st.skipEmpty ? "no stray separators when a piece is blank"
                   : "blank pieces still add a separator"));
    body.appendChild(skipField);
  }

  buildBody();

  const mkDefault = el("button", "pix-tjp-btn", "Set as default");
  mkDefault.title = "Use these settings for every new Text Join node";
  mkDefault.addEventListener("click", async () => {
    await saveGlobalDefault(readState(node));
    mkDefault.textContent = "Saved as default";
    setTimeout(() => { mkDefault.textContent = "Set as default"; }, 1200);
  });
  const done = el("button", "pix-tjp-btn pix-tjp-push", "Done");
  done.addEventListener("click", closeTextJoinPanel);
  foot.append(mkDefault, done);

  panel.append(title, body, foot);
  document.body.appendChild(panel);

  placeBeside(panel, getNodeScreenRect(node));
  makeDraggable(panel, title);

  setTimeout(() => {
    if (!_panel) return;
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
  _panel = panel;
}
