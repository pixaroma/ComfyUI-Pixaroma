// Outpaint Pixaroma - the floating settings panel (Sizes / Run Timer / Save Image
// pattern: a themed panel beside the node, dragged by its header, closed on an
// outside click or Esc). Choose which 1-6 ratio chips the To ratio row shows,
// the per-node accent colour, and the final-size snap. The node face stays
// minimal; everything configurable lives here.

import { app } from "/scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { openPixaromaColorPickerPopup, BUTTON_PALETTE } from "../shared/color_picker.mjs";
import {
  ACCENT_SETTING, BRAND, MAX_LIMITS, MAX_MP, MAX_RATIOS, RATIO_LIBRARY, SNAPS,
  addLimit, limitsOf, ratiosOf, readState, removeLimit, toggleRatio, writeState,
} from "./core.mjs";

// Same label as the node's limit row (kept local so settings.mjs need not import
// index.js, which would be circular): "Off" for 0, "N MP" otherwise.
function mpLabel(v) {
  return v === 0 ? "Off" : v + " MP";
}

let _panel = null;
let _panelNode = null;
let _onChange = null;
let _accentOf = null;  // the host passes this in - it reads app.ui.settings
let _cpHandle = null;  // the open colour picker, so the panel can close it too

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function injectCSS() {
  if (document.getElementById("pix-opp-css")) return;
  const s = document.createElement("style");
  s.id = "pix-opp-css";
  // No backtick or CSS unicode escape inside this literal - a stray one would
  // end the string early and silently kill the whole module.
  s.textContent = `
    .pix-opp { position:fixed; z-index:10010; width:300px; max-width:94vw; background:#1a1a1a;
      border:1px solid #4a4a4a; border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,0.6);
      color:#d8d8d8; font:12px 'Segoe UI',-apple-system,sans-serif; overflow:hidden; }
    .pix-opp-t { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#232323;
      border-bottom:1px solid #333; cursor:grab; user-select:none; color:var(--acc,${BRAND}); }
    .pix-opp-t .x { margin-left:auto; color:#8a8a8a; cursor:pointer; padding:0 4px; }
    .pix-opp-t .x:hover { color:#fff; }
    .pix-opp-b { padding:12px; display:flex; flex-direction:column; gap:14px; max-height:64vh; overflow-y:auto; }

    .pix-opp-field { display:flex; flex-direction:column; gap:6px; }
    .pix-opp-lab { font-size:12px; color:#9a9a9a; display:flex; align-items:baseline; gap:6px; }
    .pix-opp-lab .cnt { color:var(--acc,${BRAND}); font-variant-numeric:tabular-nums; }

    /* Ratio grid: a 6-wide toggle of the library. Idle / hover / on follow the
       node UI convention - hover moves the border, on fills with the accent. */
    .pix-opp-grid { display:grid; grid-template-columns:repeat(6,1fr); gap:5px; }
    .pix-opp-chip { box-sizing:border-box; text-align:center; padding:6px 2px; border-radius:5px;
      background:#1d1d1d; border:1px solid #444; color:#aaa; cursor:pointer;
      font:11px 'Segoe UI',sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      transition:background .08s, border-color .08s, color .08s; }
    .pix-opp-chip:hover { border-color:var(--acc,${BRAND}); color:#ddd; }
    .pix-opp-chip.on { background:var(--acc,${BRAND}); border-color:var(--acc,${BRAND}); color:#fff; }
    /* A chip that cannot be toggled right now (the last one on, or a 7th) still
       reads as a choice, just not an available one. */
    .pix-opp-chip.locked { opacity:.5; cursor:default; }
    .pix-opp-chip.locked:hover { border-color:#444; color:#aaa; }
    .pix-opp-chip.on.locked:hover { border-color:var(--acc,${BRAND}); color:#fff; }

    .pix-opp-msg { font-size:11px; color:var(--acc,${BRAND}); min-height:14px;
      opacity:0; transition:opacity .12s; }
    .pix-opp-msg.show { opacity:1; }

    /* Megapixel buttons: a wrap of list-member chips, each removable (except
       Off), plus a custom-value add field. Neutral, not accent-filled - these
       are list members, not a toggle-on state like the ratio grid. */
    .pix-opp-mrow { display:flex; flex-wrap:wrap; gap:5px; }
    .pix-opp-mchip { display:inline-flex; align-items:center; gap:5px; box-sizing:border-box;
      padding:6px 8px; border-radius:5px; background:#1d1d1d; border:1px solid #444;
      color:#ccc; font:11px 'Segoe UI',sans-serif; white-space:nowrap; }
    .pix-opp-mchip .mx { color:#8a8a8a; cursor:pointer; font-size:12px; line-height:1;
      padding:0 1px; border-radius:3px; }
    .pix-opp-mchip .mx:hover { color:#fff; background:#e0604a; }
    .pix-opp-add { display:flex; align-items:center; gap:8px; }
    .pix-opp-add input { flex:1; min-width:0; box-sizing:border-box; background:#161616;
      border:1px solid #4a4a4a; border-radius:6px; color:#fff; text-align:center;
      font:13px 'Segoe UI',sans-serif; padding:7px 6px; outline:none; }
    .pix-opp-add input:focus { border-color:var(--acc,${BRAND}); }
    .pix-opp-add .unit { flex:0 0 auto; color:#8a8a8a; font-size:11px; }
    .pix-opp-addbtn { flex:0 0 auto; background:var(--acc,${BRAND}); color:#fff; border:0;
      border-radius:6px; padding:8px 14px; font:12px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-opp-addbtn:hover { filter:brightness(1.08); }
    .pix-opp-addbtn:disabled { opacity:.4; cursor:default; filter:none; }

    .pix-opp-seg { display:flex; gap:4px; }
    .pix-opp-seg button { flex:1; text-align:center; padding:6px 2px; border-radius:5px;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14); color:#a8a8a8;
      font:11px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-opp-seg button:hover { color:#ddd; }
    .pix-opp-seg button.on { background:var(--acc,${BRAND}); border-color:var(--acc,${BRAND}); color:#fff; font-weight:600; }

    .pix-opp-acc { display:flex; align-items:center; gap:10px; }
    .pix-opp-sw { width:30px; height:22px; border-radius:5px; border:1px solid #555; cursor:pointer; flex:none; }
    .pix-opp-sw:hover { border-color:#fff; }

    .pix-opp-f { display:flex; gap:8px; align-items:center; padding:10px 12px; border-top:1px solid #333; background:#1f1f1f; }
    .pix-opp-btn { border:1px solid #444; background:rgba(255,255,255,0.04); color:#d8d8d8; border-radius:5px;
      padding:6px 12px; font:12px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-opp-btn:hover { border-color:var(--acc,${BRAND}); color:#fff; }
    .pix-opp-push { margin-left:auto; }
  `;
  document.head.appendChild(s);
}

// Screen rect of the node (Vue: the real element; legacy: graph-to-screen math).
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
  return { left, top, right: left + node.size[0] * sc, bottom: top + (node.size[1] + titleH) * sc,
           width: node.size[0] * sc, height: (node.size[1] + titleH) * sc };
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
  closeOutpaintSettings();
}
function escClose(e) {
  if (e.key === "Escape" && _panel) {
    if (document.querySelector(".pix-cp-popup, .pix-cp-modal-backdrop")) return; // let the picker take it
    e.stopPropagation();
    closeOutpaintSettings();
  }
}

export function closeOutpaintSettings() {
  try { _cpHandle?.close(); } catch (_e) { /* already gone */ }
  _cpHandle = null;
  if (_panel) { try { _panel.remove(); } catch (_e) { /* already gone */ } }
  _panel = null;
  _panelNode = null;
  _onChange = null;
  _accentOf = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

export function closeOutpaintSettingsFor(node) {
  if (_panelNode === node) closeOutpaintSettings();
}

// ctx = { accentOf(node), onChange() }. accentOf comes from the host because it
// reads app.ui.settings, which core.mjs deliberately does not touch.
export function openOutpaintSettings(node, ctx) {
  closeOutpaintSettings(); // single-open guard, both entry points share it
  injectCSS();
  _onChange = ctx?.onChange || null;
  _accentOf = ctx?.accentOf || (() => BRAND);
  _panelNode = node;

  const accent = () => _accentOf(node);
  const fire = () => { _onChange?.(); };

  const panel = el("div", "pix-opp");
  panel.style.setProperty("--acc", accent());

  const title = el("div", "pix-opp-t");
  title.append(el("span", null, "⚙"), el("span", null, "Outpaint settings"));
  const x = el("span", "x", "✕");
  x.addEventListener("click", closeOutpaintSettings);
  title.appendChild(x);

  const body = el("div", "pix-opp-b");
  const foot = el("div", "pix-opp-f");

  const repaintAccent = () => {
    const a = accent();
    panel.style.setProperty("--acc", a);
    sw.style.background = a;
  };

  let msgEl = null, msgTimer = null;
  function showMsg(text) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.classList.add("show");
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => msgEl?.classList.remove("show"), 1600);
  }
  // Its own line under the megapixel section, so a "can't add" reason shows there
  // rather than up under the ratio grid.
  let mMsgEl = null, mMsgTimer = null;
  function showMMsg(text) {
    if (!mMsgEl) return;
    mMsgEl.textContent = text;
    mMsgEl.classList.add("show");
    clearTimeout(mMsgTimer);
    mMsgTimer = setTimeout(() => mMsgEl?.classList.remove("show"), 1600);
  }

  function buildBody() {
    body.innerHTML = "";
    const chosen = ratiosOf(node);

    // ── ratio chips ─────────────────────────────────────────────────────────
    const rf = el("div", "pix-opp-field");
    const lab = el("div", "pix-opp-lab");
    lab.append(el("span", null, "Ratio buttons"),
               el("span", "cnt", `${chosen.length} of ${MAX_RATIOS}`));
    rf.appendChild(lab);

    const grid = el("div", "pix-opp-grid");
    for (const r of RATIO_LIBRARY) {
      const on = chosen.includes(r);
      // A chip is locked when clicking it would break the 1..6 bounds: the last
      // one on cannot go off, and a new one cannot go on once six are chosen.
      const locked = (on && chosen.length <= 1) || (!on && chosen.length >= MAX_RATIOS);
      const c = el("div", "pix-opp-chip" + (on ? " on" : "") + (locked ? " locked" : ""), r);
      c.title = on
        ? (locked ? "Keep at least one ratio" : "Hide this ratio")
        : (locked ? `At most ${MAX_RATIOS} ratios` : "Show this ratio");
      if (!locked) {
        c.addEventListener("click", () => {
          const next = toggleRatio(chosen, r);
          if (!next) { showMsg(on ? "Keep at least one" : `At most ${MAX_RATIOS}`); return; }
          writeState(node, { ratios: next });
          fire();       // the node's To ratio row changes with the set
          buildBody();
        });
      }
      grid.appendChild(c);
    }
    rf.appendChild(grid);
    msgEl = el("div", "pix-opp-msg");
    rf.appendChild(msgEl);
    body.appendChild(rf);

    // ── megapixel buttons (a managed list: remove any, add a custom value) ────
    const mps = limitsOf(node);
    const mf = el("div", "pix-opp-field");
    const mlab = el("div", "pix-opp-lab");
    mlab.append(el("span", null, "Megapixel buttons"),
                el("span", "cnt", `${mps.length} of ${MAX_LIMITS}`));
    mf.appendChild(mlab);

    const mrow = el("div", "pix-opp-mrow");
    for (const v of mps) {
      const c = el("div", "pix-opp-mchip", mpLabel(v));
      if (v === 0) {
        c.title = "Off is always available";
      } else {
        c.title = `${mpLabel(v)} - click the x to remove`;
        const x = el("span", "mx", "×"); // multiplication sign, not a CSS escape
        x.title = "Remove " + mpLabel(v);
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          const next = removeLimit(mps, v);
          if (!next) return;
          const patch = { limits: next };
          // If the removed button was the active one, fall back to Off so the
          // node is never left pointing at a limit it no longer shows.
          if (Number(readState(node).limit) === v) patch.limit = 0;
          writeState(node, patch);
          fire();
          buildBody();
        });
        c.appendChild(x);
      }
      mrow.appendChild(c);
    }
    mf.appendChild(mrow);

    // Add a custom MP value.
    const addRow = el("div", "pix-opp-add");
    const inp = el("input");
    inp.type = "text";
    inp.placeholder = "e.g. 1.3";
    inp.title = "A megapixel value to add";
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation(); // keep typing out of the canvas shortcuts
      if (e.key === "Enter") { e.preventDefault(); doAddMp(); }
    });
    const addBtn = el("button", "pix-opp-addbtn", "Add");
    addBtn.disabled = mps.filter((v) => v > 0).length >= MAX_LIMITS - 1;
    function doAddMp() {
      const next = addLimit(mps, inp.value);
      if (!next) {
        const n = Number(inp.value);
        showMMsg(!isFinite(n) || n <= 0 ? "Enter a number of megapixels"
          : n > MAX_MP ? `At most ${MAX_MP} MP`
          : mps.length >= MAX_LIMITS ? "The row is full" : "Already in the list");
        return;
      }
      writeState(node, { limits: next });
      inp.value = "";
      fire();
      buildBody();
    }
    addBtn.addEventListener("click", doAddMp);
    addRow.append(inp, el("span", "unit", "MP"), addBtn);
    mf.appendChild(addRow);
    mMsgEl = el("div", "pix-opp-msg");
    mf.appendChild(mMsgEl);
    body.appendChild(mf);

    // ── accent ──────────────────────────────────────────────────────────────
    const af = el("div", "pix-opp-field");
    af.appendChild(el("div", "pix-opp-lab", "Button colour"));
    const acc = el("div", "pix-opp-acc");
    acc.append(sw, el("div", "pix-opp-lab", "The accent for this node"));
    af.appendChild(acc);
    body.appendChild(af);

    // ── snap ────────────────────────────────────────────────────────────────
    const sf = el("div", "pix-opp-field");
    sf.appendChild(el("div", "pix-opp-lab", "Snap the final size to a multiple of"));
    const seg = el("div", "pix-opp-seg");
    const curSnap = readState(node).snap || 0;
    for (const v of SNAPS) {
      const b = el("button", v === curSnap ? "on" : null, v === 0 ? "Off" : String(v));
      b.addEventListener("click", () => {
        writeState(node, { snap: v });
        fire();
        buildBody();
      });
      seg.appendChild(b);
    }
    sf.appendChild(seg);
    body.appendChild(sf);
  }

  // The swatch is built ONCE, outside buildBody, so the open picker never loses
  // its anchor across a rebuild.
  const sw = el("div", "pix-opp-sw");
  sw.title = "Pick the accent colour";
  sw.style.background = accent();
  sw.addEventListener("click", () => {
    // Close any already-open picker before opening a new one - a second click
    // while the first is up would otherwise orphan the first's window listeners
    // (they only get released when _cpHandle is closed, and the reassign below
    // loses the old handle). The node-face fill picker does the same.
    try { _cpHandle?.close(); } catch (_e) { /* already gone */ }
    // The LIVE picker (roomy SV plane + hue + hex + BUTTON_PALETTE, whose
    // swatches keep white button text readable - PIXAROMA_PALETTE's pale ones do
    // not). No transparent tile: an accent is always a colour. onPick fires on
    // every change, so the node recolours live as the user drags. The picker
    // adds window listeners, so it MUST be destroyed when the panel closes -
    // closeOutpaintSettings calls _cpHandle.close().
    _cpHandle = openPixaromaColorPickerPopup(sw, {
      initialColor: accent(),
      swatches: BUTTON_PALETTE,
      wide: true,
      resetColor: BRAND, // Reset -> the Pixaroma orange
      onPick: (c) => {
        writeState(node, { accent: c || BRAND });
        repaintAccent();
        fire(); // recolour the node's chips + cards live
      },
    });
  });

  buildBody();

  // ── footer: make this node's accent the default for new ones, plus Done ─────
  const mkDefault = el("button", "pix-opp-btn", "Colour as default");
  mkDefault.title = "Use this colour for every new Outpaint node";
  mkDefault.addEventListener("click", async () => {
    try {
      await app.ui.settings.setSettingValueAsync(ACCENT_SETTING, accent());
      mkDefault.textContent = "Saved as default";
      setTimeout(() => { mkDefault.textContent = "Colour as default"; }, 1200);
    } catch (_e) { /* settings not ready */ }
  });
  const done = el("button", "pix-opp-btn pix-opp-push", "Done");
  done.addEventListener("click", closeOutpaintSettings);
  foot.append(mkDefault, done);

  panel.append(title, body, foot);
  document.body.appendChild(panel);

  placeBeside(panel, getNodeScreenRect(node));
  makeDraggable(panel, title);

  // Defer attach one tick so the click that opened us does not immediately close
  // us (the click is still bubbling when this runs).
  setTimeout(() => {
    if (!_panel) return;
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
  _panel = panel;
}
