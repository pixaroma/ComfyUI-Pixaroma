// Sizes Pixaroma - the floating settings panel (Sliders / Run Timer / Save Image
// pattern: themed panel beside the node, draggable by its header, closes on
// outside click or Esc). Add / remove / reorder sizes, load common sizes, pick
// the snap step and the highlight colour. The node face stays minimal.

import { app } from "/scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { openPixaromaColorPickerPopup, BUTTON_PALETTE } from "../shared/color_picker.mjs";
import {
  readState, writeState, addSize, removeSize, reorderSize, addCommonSizes,
  accentOf, sanitizePair, BRAND, ACCENT_SETTING, SNAP_OPTIONS, MAX_SIZES,
} from "./core.mjs";

let _panel = null;
let _panelNode = null;
let _onChange = null;
let _cpHandle = null; // open colour-picker popup, so the panel can close it too

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function injectCSS() {
  if (document.getElementById("pix-szp-css")) return;
  const s = document.createElement("style");
  s.id = "pix-szp-css";
  s.textContent = `
    .pix-szp { position:fixed; z-index:10010; width:320px; max-width:94vw; background:#1a1a1a;
      border:1px solid #4a4a4a; border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,0.6);
      color:#d8d8d8; font:12px 'Segoe UI',-apple-system,sans-serif; overflow:hidden; }
    .pix-szp-t { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#232323;
      border-bottom:1px solid #333; cursor:grab; user-select:none; color:var(--acc,${BRAND}); }
    .pix-szp-t .x { margin-left:auto; color:#8a8a8a; cursor:pointer; padding:0 4px; }
    .pix-szp-t .x:hover { color:#fff; }
    .pix-szp-b { padding:12px; display:flex; flex-direction:column; gap:12px; max-height:62vh; overflow-y:auto; }

    .pix-szp-add { display:flex; align-items:center; gap:8px; }
    .pix-szp-add input { flex:1; min-width:0; box-sizing:border-box; background:#161616;
      border:1px solid #4a4a4a; border-radius:6px; color:#fff; text-align:center;
      font:13px 'Segoe UI',sans-serif; padding:8px 6px; outline:none; font-variant-numeric:tabular-nums; }
    .pix-szp-add input:focus { border-color:var(--acc,${BRAND}); }
    .pix-szp-add .x { color:#888; flex:0 0 auto; }
    .pix-szp-addbtn { flex:0 0 auto; background:var(--acc,${BRAND}); color:#fff; border:0; border-radius:6px;
      padding:9px 14px; font:12px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-szp-addbtn:hover { filter:brightness(1.08); }
    .pix-szp-addbtn:disabled { opacity:.4; cursor:default; filter:none; }

    .pix-szp-list { background:rgba(0,0,0,0.28); border-radius:6px; padding:4px; display:flex; flex-direction:column; gap:2px; }
    .pix-szp-row { display:flex; align-items:center; gap:8px; padding:7px 8px; border-radius:5px; color:#cfcfcf;
      background:rgba(255,255,255,0.02); }
    .pix-szp-row.drop-above { box-shadow:inset 0 2px 0 var(--acc,${BRAND}); }
    .pix-szp-row.drop-below { box-shadow:inset 0 -2px 0 var(--acc,${BRAND}); }
    .pix-szp-row .grip { color:#666; cursor:grab; flex:0 0 auto; font-size:13px; line-height:1; }
    .pix-szp-row .v { flex:1; text-align:center; font-variant-numeric:tabular-nums; }
    .pix-szp-row .del { color:#888; cursor:pointer; flex:0 0 auto; font-size:13px; line-height:1; }
    .pix-szp-row .del:hover { color:#e0604a; }

    .pix-szp-field { display:flex; flex-direction:column; gap:5px; }
    .pix-szp-lab { font-size:12px; color:#9a9a9a; }
    .pix-szp-seg { display:flex; gap:4px; }
    .pix-szp-seg button { flex:1; text-align:center; padding:6px 2px; border-radius:5px;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14); color:#a8a8a8;
      font:11px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-szp-seg button:hover { color:#ddd; }
    .pix-szp-seg button.on { background:var(--acc,${BRAND}); border-color:var(--acc,${BRAND}); color:#fff; font-weight:600; }

    .pix-szp-acc { display:flex; align-items:center; gap:10px; }
    .pix-szp-sw { width:30px; height:22px; border-radius:5px; border:1px solid #555; cursor:pointer; flex:none; }
    .pix-szp-sw:hover { border-color:#fff; }

    .pix-szp-f { display:flex; gap:8px; flex-wrap:wrap; padding:10px 12px; border-top:1px solid #333; background:#1f1f1f; }
    .pix-szp-btn { border:1px solid #444; background:rgba(255,255,255,0.04); color:#d8d8d8; border-radius:5px;
      padding:6px 12px; font:12px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-szp-btn:hover { border-color:var(--acc,${BRAND}); color:#fff; }
    .pix-szp-common { background:rgba(246,103,68,0.16); border:1px solid rgba(246,103,68,0.6); color:#f68a66;
      border-radius:6px; padding:9px; font:12px 'Segoe UI',sans-serif; cursor:pointer; width:100%;
      display:flex; align-items:center; justify-content:center; gap:7px; }
    .pix-szp-common:hover { filter:brightness(1.1); }
    .pix-szp-common:disabled { opacity:.4; cursor:default; filter:none; }
    .pix-szp-push { margin-left:auto; }
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

function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop")) return; // the colour picker
  closeSizesPanel();
}
function escClose(e) {
  if (e.key === "Escape" && _panel) {
    if (document.querySelector(".pix-cp-popup, .pix-cp-modal-backdrop")) return;
    e.stopPropagation();
    closeSizesPanel();
  }
}

export function closeSizesPanel() {
  try { _cpHandle?.close(); } catch {}
  _cpHandle = null;
  if (_panel) { try { _panel.remove(); } catch {} }
  _panel = null;
  _panelNode = null;
  _onChange = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

export function closeSizesPanelFor(node) {
  if (_panelNode === node) closeSizesPanel();
}

export function openSizesPanel(node, onChange) {
  closeSizesPanel();
  injectCSS();
  _onChange = onChange || null;
  _panelNode = node;

  const panel = el("div", "pix-szp");
  panel.style.setProperty("--acc", accentOf(node));

  const title = el("div", "pix-szp-t");
  title.append(el("span", null, "⚙"), el("span", null, "Sizes settings"));
  const x = el("span", "x", "✕");
  x.addEventListener("click", closeSizesPanel);
  title.appendChild(x);

  const body = el("div", "pix-szp-b");
  const foot = el("div", "pix-szp-f");

  const fire = (info) => { _onChange?.(info); };
  const repaintAccent = () => {
    const a = accentOf(node);
    panel.style.setProperty("--acc", a);
    sw.style.background = a;
  };

  let dragFrom = -1;

  function buildBody() {
    body.innerHTML = "";
    const st = readState(node);

    // ── add a size ─────────────────────────────────────────────────────────
    const add = el("div", "pix-szp-add");
    const wIn = el("input"); wIn.type = "text"; wIn.value = "1024"; wIn.title = "Width";
    const hIn = el("input"); hIn.type = "text"; hIn.value = "1536"; hIn.title = "Height";
    wIn.addEventListener("keydown", (e) => e.stopPropagation());
    hIn.addEventListener("keydown", (e) => e.stopPropagation());
    const addBtn = el("button", "pix-szp-addbtn", "add");
    addBtn.disabled = st.sizes.length >= MAX_SIZES;
    const doAdd = () => {
      const [w, h] = sanitizePair(wIn.value, hIn.value);
      if (addSize(node, w, h)) { fire({ structural: true }); buildBody(); }
    };
    addBtn.addEventListener("click", doAdd);
    for (const inp of [wIn, hIn]) {
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } });
    }
    add.append(wIn, el("span", "x", "×"), hIn, addBtn);
    body.appendChild(add);

    // ── the size list (drag to reorder, ✕ to delete) ───────────────────────
    const list = el("div", "pix-szp-list");
    st.sizes.forEach((pair, i) => {
      const row = el("div", "pix-szp-row");
      row.dataset.idx = String(i);

      const grip = el("span", "grip", "⋮⋮");
      grip.draggable = true;
      grip.addEventListener("dragstart", (e) => {
        dragFrom = i;
        try { e.dataTransfer.setData("text/plain", String(i)); e.dataTransfer.effectAllowed = "move"; } catch {}
      });

      const v = el("span", "v", `${pair[0]} × ${pair[1]}`);

      const del = el("span", "del", "✕");
      del.title = st.sizes.length > 1 ? "Remove this size" : "Keep at least one size";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (removeSize(node, i)) { fire({ structural: true }); buildBody(); }
      });

      row.addEventListener("dragover", (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const below = (e.clientY - r.top) > r.height / 2;
        row.classList.toggle("drop-below", below);
        row.classList.toggle("drop-above", !below);
      });
      row.addEventListener("dragleave", () => row.classList.remove("drop-above", "drop-below"));
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("drop-above", "drop-below");
        if (dragFrom < 0 || dragFrom === i) { dragFrom = -1; return; }
        const r = row.getBoundingClientRect();
        let to = (e.clientY - r.top) > r.height / 2 ? i + 1 : i;
        if (dragFrom < to) to -= 1; // account for the removed source slot
        if (reorderSize(node, dragFrom, to)) { fire({ structural: false }); buildBody(); }
        dragFrom = -1;
      });

      row.append(grip, v, del);
      list.appendChild(row);
    });
    body.appendChild(list);

    // ── snap ────────────────────────────────────────────────────────────────
    const snapField = el("div", "pix-szp-field");
    snapField.appendChild(el("div", "pix-szp-lab", "Snap width and height to multiple of"));
    const seg = el("div", "pix-szp-seg");
    for (const v of SNAP_OPTIONS) {
      const b = el("button", v === (st.snap || 0) ? "on" : null, v === 0 ? "Off" : String(v));
      b.addEventListener("click", () => {
        writeState(node, { ...readState(node), snap: v });
        fire({ structural: false }); buildBody();
      });
      seg.appendChild(b);
    }
    snapField.appendChild(seg);
    body.appendChild(snapField);

    // ── accent ────────────────────────────────────────────────────────────
    const acc = el("div", "pix-szp-acc");
    acc.append(sw, el("div", "pix-szp-lab", "Highlight colour"));
    body.appendChild(acc);
  }

  // Swatch built once so the picker never loses its anchor across rebuilds.
  const sw = el("div", "pix-szp-sw");
  sw.title = "Pick the highlight colour";
  sw.style.background = accentOf(node);
  sw.addEventListener("click", () => {
    // The LIVE picker (roomy SV plane + hue + hex + button-safe swatches). No
    // transparent tile - an accent is always a colour. onPick fires on every
    // change, so the node's pills + selected row recolour live as you drag.
    _cpHandle = openPixaromaColorPickerPopup(sw, {
      initialColor: accentOf(node),
      swatches: BUTTON_PALETTE,
      wide: true,
      resetColor: BRAND,       // Reset -> the Pixaroma orange
      onPick: (c) => {
        const col = c || BRAND;
        writeState(node, { ...readState(node), accent: col });
        repaintAccent();
        // Recolour the node live without a full rebuild (cheap CSS var swap).
        node._pixSzInner?.style.setProperty("--acc", col);
        node.setDirtyCanvas?.(true, true);
      },
    });
  });

  buildBody();

  // ── footer ────────────────────────────────────────────────────────────────
  const common = el("button", "pix-szp-common", "＋ Add common sizes (512 to 2048)");
  common.disabled = readState(node).sizes.length >= MAX_SIZES;
  common.addEventListener("click", () => {
    addCommonSizes(node);
    fire({ structural: true }); buildBody();
    common.disabled = readState(node).sizes.length >= MAX_SIZES;
  });

  const mkDefault = el("button", "pix-szp-btn", "Colour as default");
  mkDefault.title = "Use this node's colour for every new Sizes node";
  mkDefault.addEventListener("click", async () => {
    try {
      await app.ui.settings.setSettingValueAsync(ACCENT_SETTING, accentOf(node));
      mkDefault.textContent = "Saved as default";
      setTimeout(() => { mkDefault.textContent = "Colour as default"; }, 1200);
    } catch {}
  });

  const done = el("button", "pix-szp-btn pix-szp-push", "Done");
  done.addEventListener("click", closeSizesPanel);

  foot.append(mkDefault, done);

  // "Add common sizes" gets its own full-width row above the button footer.
  const commonWrap = el("div", "pix-szp-f");
  commonWrap.style.borderTop = "1px solid #333";
  commonWrap.appendChild(common);

  panel.append(title, body, commonWrap, foot);
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
