// Sizes Pixaroma - the floating settings panel (Sliders / Run Timer / Save Image
// pattern: themed panel beside the node, draggable by its header, closes on
// outside click or Esc). Add / remove / reorder sizes, load common sizes, pick
// the snap step and the highlight colour. The node face stays minimal.

import { app } from "../../../scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { openPixaromaColorPickerPopup, BUTTON_PALETTE } from "../shared/color_picker.mjs";
import { GLOBAL_ACCENT_SETTING, repaintAllAccents } from "../shared/node_settings.mjs";
import { pixAsset } from "../shared/api_url.mjs";
import { isComfyTextShortcut } from "../shared/text_shortcuts.mjs";
import {
  readState, writeState, addSize, removeSize, reorderSize, addCommonSizes,
  accentOf, sanitizePair, isStarredPair, toggleStarAt, tagOfPair, setTagAt,
  BRAND, ACCENT_SETTING, SNAP_OPTIONS, MAX_SIZES,
} from "./core.mjs";
import { openTagMenu, closeTagMenu, tagMenuOpen } from "./tag_menu.mjs";

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

    .pix-szp-addmsg { font-size:11px; color:var(--acc,${BRAND}); text-align:center;
      opacity:0; max-height:0; overflow:hidden; margin-top:-8px; transition:opacity .12s, max-height .12s, margin-top .12s; }
    .pix-szp-addmsg.show { opacity:1; max-height:20px; margin-top:0; }
    @keyframes pix-szp-flash {
      0%   { box-shadow:inset 0 0 0 2px var(--acc,${BRAND}); background:rgba(255,255,255,0.12); }
      100% { box-shadow:inset 0 0 0 0 transparent; background:rgba(255,255,255,0.02); }
    }
    .pix-szp-row.flash { animation:pix-szp-flash .75s ease; }

    .pix-szp-list { background:rgba(0,0,0,0.28); border-radius:6px; padding:4px; display:flex; flex-direction:column; gap:2px; }
    .pix-szp-row { display:flex; align-items:center; gap:8px; padding:3px 8px; border-radius:5px; color:#cfcfcf;
      background:rgba(255,255,255,0.02); }
    .pix-szp-row.drop-above { box-shadow:inset 0 2px 0 var(--acc,${BRAND}); }
    .pix-szp-row.drop-below { box-shadow:inset 0 -2px 0 var(--acc,${BRAND}); }
    .pix-szp-row .grip { color:#666; cursor:grab; flex:0 0 auto; font-size:13px; line-height:1; }
    .pix-szp-row .v { flex:1; text-align:center; font-variant-numeric:tabular-nums; }
    .pix-szp-row .del { color:#888; cursor:pointer; flex:0 0 auto; font-size:13px; line-height:1; }
    .pix-szp-row .del:hover { color:#e0604a; }
    /* Recommended toggle. The glyph is the bundled FILLED star SVG used as a
       mask (convention #28): an OS-drawn ★ is a different shape and baseline on
       every platform, and an emoji star arrives in colour on some of them. Off
       and on are the same filled shape in two colours - an outline-vs-filled
       pair would need a second asset for no extra clarity. */
    /* margin-right pushes the star INWARD, away from the delete ✕ (which stays
       pinned to the right edge). They were one 8px gap apart, so a slightly-off
       click on the star hit ✕ and removed the size - a destructive neighbour
       deserves more room than a normal one. */
    .pix-szp-row .star { flex:0 0 auto; width:15px; height:15px; cursor:pointer;
      margin-right:16px; background:#5a5a5a;
      -webkit-mask:url("${pixAsset("icons/ui/star.svg")}") center/contain no-repeat;
      mask:url("${pixAsset("icons/ui/star.svg")}") center/contain no-repeat; }
    .pix-szp-row .star:hover { background:#8a8a8a; }
    .pix-szp-row .star.on { background:var(--acc,${BRAND}); }
    .pix-szp-row .star.on:hover { background:var(--acc,${BRAND}); opacity:.8; }
    /* The label picker. One fixed width, so the column lines up down the list
       whatever each row holds. */
    .pix-szp-row .tag { flex:0 0 auto; box-sizing:border-box; width:66px; height:24px; padding:0 6px;
      display:flex; align-items:center; justify-content:space-between; gap:4px;
      background:#1d1d1d; border:1px solid #444; border-radius:4px; color:#9a9a9a;
      font:11px 'Segoe UI',sans-serif; cursor:pointer; user-select:none; }
    .pix-szp-row .tag.on { color:#e0e0e0; }
    .pix-szp-row .tag:hover { border-color:var(--acc,${BRAND}); color:#ddd; }
    .pix-szp-row .tag:focus-visible { outline:2px solid var(--acc,${BRAND}); outline-offset:1px; }
    .pix-szp-row .tag .arrow { font-size:8px; line-height:1; color:#8a8a8a; }

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
    .pix-szp-common { background:color-mix(in srgb, var(--pix-acc,#f66744) 16%, transparent); border:1px solid color-mix(in srgb, var(--pix-acc,#f66744) 60%, transparent); color:#f68a66;
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
    // Both defences against a LOST pointerup (convention #20, the same pair as
    // js/shared/node_panel.mjs): when the release never arrives (pointer left
    // the window, capture taken) the panel followed the cursor until a click.
    try { handle.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    let done = false;
    const move = (ev) => {
      if (!panel.isConnected) return up();
      if (!(ev.buttons & 1)) return up(); // we missed the release
      panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, ev.clientX - ox)) + "px";
      panel.style.top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ev.clientY - oy)) + "px";
    };
    const up = () => {
      if (done) return; // idempotent: the guard above can call this too
      done = true;
      try { handle.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      handle.removeEventListener("lostpointercapture", up);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    handle.addEventListener("lostpointercapture", up);
  });
}

function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop, .pix-szp-tagmenu")) return; // its popups
  closeSizesPanel();
}
function escClose(e) {
  if (e.key === "Escape" && _panel) {
    if (document.querySelector(".pix-cp-popup, .pix-cp-modal-backdrop")) return;
    if (tagMenuOpen()) return;   // Esc closes the tag list first, the panel stays
    e.stopPropagation();
    closeSizesPanel();
  }
}

export function closeSizesPanel() {
  try { _cpHandle?.close(); } catch {}
  _cpHandle = null;
  closeTagMenu();
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
  let addMsgEl = null;
  let addMsgTimer = null;
  let common = null;   // the footer's "Add common sizes" button (built after the first buildBody)

  // Subtle "why nothing was added" line under the add field.
  function showAddMsg(text) {
    if (!addMsgEl) return;
    addMsgEl.textContent = text;
    addMsgEl.classList.add("show");
    clearTimeout(addMsgTimer);
    addMsgTimer = setTimeout(() => addMsgEl?.classList.remove("show"), 1800);
  }
  // Pulse an existing row so the user sees the duplicate they already have.
  function flashRow(idx) {
    const row = body.querySelector(`.pix-szp-row[data-idx="${idx}"]`);
    if (!row) return;
    try { row.scrollIntoView({ block: "nearest" }); } catch {}
    row.classList.remove("flash");
    void row.offsetWidth; // restart the animation
    row.classList.add("flash");
    setTimeout(() => row.classList.remove("flash"), 780);
  }

  function buildBody() {
    body.innerHTML = "";
    const st = readState(node);

    // ── add a size ─────────────────────────────────────────────────────────
    const add = el("div", "pix-szp-add");
    const wIn = el("input"); wIn.type = "text"; wIn.value = "1024"; wIn.title = "Width";
    const hIn = el("input"); hIn.type = "text"; hIn.value = "1536"; hIn.title = "Height";
    // Keys stay in the field (a typed letter must not fire a canvas shortcut),
    // except Ctrl/Cmd+S and Ctrl/Cmd+Enter: ComfyUI's save and run, which listen
    // on window. Stopped here, Ctrl+S opened the browser's "Save page as" dialog.
    const keepKey = (e) => {
      if (isComfyTextShortcut(e) && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.stopPropagation();
    };
    wIn.addEventListener("keydown", keepKey);
    hIn.addEventListener("keydown", keepKey);
    const addBtn = el("button", "pix-szp-addbtn", "add");
    addBtn.disabled = st.sizes.length >= MAX_SIZES;
    // The footer button follows every add / remove, not only the panel opening
    // (a full list stayed "full" after a size was removed: sizes.md #12).
    if (common) common.disabled = st.sizes.length >= MAX_SIZES;
    const doAdd = () => {
      // Only plain whole numbers. sanitizePair turns anything else into 1024
      // (right for a damaged saved state, wrong for typing): "1,920" x 1080
      // was added as 1024 x 1080, and "0x400" reads as hex 1024.
      const whole = (v) => /^\s*\d+\s*$/.test(v) && +v > 0;
      if (!whole(wIn.value) || !whole(hIn.value)) { showAddMsg("Type whole numbers"); return; }
      const [w, h] = sanitizePair(wIn.value, hIn.value);
      const res = addSize(node, w, h);
      if (res.ok) {
        fire({ structural: true });
        buildBody();
      } else if (res.reason === "duplicate") {
        // Already have this size (any orientation) — don't clutter the list;
        // just select + flash the one that's there and say so quietly.
        fire({ structural: false }); // the selection may have moved to it
        buildBody();
        flashRow(res.index);
        showAddMsg("Already in the list");
      } else if (res.reason === "max") {
        showAddMsg(`List is full (max ${MAX_SIZES})`);
      }
    };
    addBtn.addEventListener("click", doAdd);
    for (const inp of [wIn, hIn]) {
      // plain Enter adds; Ctrl/Cmd+Enter is ComfyUI's Run (keepKey lets it out)
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); doAdd(); } });
    }
    add.append(wIn, el("span", "x", "×"), hIn, addBtn);
    body.appendChild(add);
    addMsgEl = el("div", "pix-szp-addmsg");
    body.appendChild(addMsgEl);

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
      // A drag released outside the list never gets a drop: forget it, or the
      // next drop on a row (even a file dragged in) reorders the list (sizes.md #12).
      grip.addEventListener("dragend", () => { dragFrom = -1; });

      const v = el("span", "v", `${pair[0]} × ${pair[1]}`);

      const starOn = isStarredPair(st, pair);
      const star = el("span", "star" + (starOn ? " on" : ""));
      star.title = starOn
        ? "Recommended - click to unmark"
        : "Mark as recommended (shows a star on the node)";
      star.addEventListener("click", (e) => {
        e.stopPropagation();
        // Cosmetic only: never touches the selection or the output, so there is
        // no `structural: true` here and the node does not need refitting.
        if (toggleStarAt(node, i)) { fire({ structural: false }); buildBody(); }
      });

      // Cosmetic like the star: the node keeps its height and its output.
      const tagNow = tagOfPair(st, pair);
      const tag = el("button", "tag" + (tagNow ? " on" : ""));
      tag.type = "button";
      tag.title = "Add a label to this size, shown on the node";
      tag.setAttribute("aria-label", tagNow ? `Label: ${tagNow}. Change it` : "Add a label to this size");
      tag.setAttribute("aria-haspopup", "menu");
      tag.append(el("span", null, tagNow || "Tag"), el("span", "arrow", "▼"));
      tag.addEventListener("click", (e) => {
        e.stopPropagation();
        openTagMenu(tag, tagNow, accentOf(node), (t) => {
          if (setTagAt(node, i, t)) { fire({ structural: false }); buildBody(); }
        });
      });

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

      row.append(grip, v, tag, star, del);
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
  common = el("button", "pix-szp-common", "＋ Add common sizes (512 to 2048)");
  common.disabled = readState(node).sizes.length >= MAX_SIZES;
  common.addEventListener("click", () => {
    addCommonSizes(node);
    fire({ structural: true }); buildBody();   // buildBody refreshes common.disabled
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


  // The SECOND default: one master colour every Pixaroma node follows unless it
  // (or its node type) has been given one of its own. Written through the shared
  // helper so all the panels agree on the key.
  const mkAll = el("button", "pix-szp-btn", "Every Pixaroma node");
  mkAll.title = "Every Pixaroma node follows this colour, unless it has been given one of its own";
  mkAll.addEventListener("click", async () => {
    try {
      await app.ui.settings.setSettingValueAsync(GLOBAL_ACCENT_SETTING, accentOf(node));
      mkAll.textContent = "Saved";
      setTimeout(() => { mkAll.textContent = "Every Pixaroma node"; }, 1200);
      repaintAllAccents();
    } catch { /* settings not ready */ }
  });
  foot.append(mkDefault, mkAll, done);

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
