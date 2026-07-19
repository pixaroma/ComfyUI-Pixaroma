// Prompt Pixaroma - the gear settings panel (button colour, per node + a global
// default). Same floating-panel pattern as Sliders / Save Image: a themed panel
// beside the node, draggable by its header, closes on outside click or Esc.
//
// Reads/writes node.properties.promptState.accent DIRECTLY (not through index.js)
// so there is no circular import back into the node module.

import { app } from "/scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { BRAND } from "../shared/utils.mjs";
import { openPixaromaColorPickerPopup, BUTTON_PALETTE } from "../shared/color_picker.mjs";

export const ACCENT_SETTING = "Pixaroma.Prompt.AccentColor";
export const ORDER_SETTING = "Pixaroma.Prompt.DefaultOrder";
const STATE_KEY = "promptState";

// Global default JOIN ORDER for new nodes. Stored in an UNREGISTERED setting (no
// row in the global Settings panel - it is changed from the node's gear instead;
// unregistered settings still persist, Vue Compat #20). Read accepts the legacy
// "Wired first" string; write is canonical "mine"/"wired".
export function getDefaultOrder() {
  try {
    const v = app.ui?.settings?.getSettingValue?.(ORDER_SETTING);
    if (v === "wired" || v === "Wired first") return "wired";
  } catch { /* fall through to mine */ }
  return "mine";
}
export async function setDefaultOrder(order) {
  try { await app.ui?.settings?.setSettingValueAsync?.(ORDER_SETTING, order === "wired" ? "wired" : "mine"); }
  catch { /* ignore */ }
}

function globalDefaultAccent() {
  try {
    const v = app.ui?.settings?.getSettingValue?.(ACCENT_SETTING);
    if (typeof v === "string" && /^#?[0-9a-fA-F]{3,8}$/.test(v.trim())) {
      const s = v.trim();
      return s[0] === "#" ? s : "#" + s;
    }
  } catch { /* fall through to BRAND */ }
  return BRAND;
}

// The colour a node's buttons paint with: per-node override, else the global
// default, else the Pixaroma orange.
export function accentOf(node) {
  const a = node?.properties?.[STATE_KEY]?.accent;
  if (typeof a === "string" && a) return a;
  return globalDefaultAccent();
}
function setNodeAccent(node, c) {
  node.properties = node.properties || {};
  const s = node.properties[STATE_KEY] || {};
  node.properties[STATE_KEY] = { ...s, accent: c || null };
}

let _panel = null;
let _panelNode = null;
let _onChange = null;
let _cpHandle = null;

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function injectCSS() {
  if (document.getElementById("pix-prmset-css")) return;
  const s = document.createElement("style");
  s.id = "pix-prmset-css";
  s.textContent = `
    .pix-prmset { position:fixed; z-index:10010; width:300px; max-width:94vw; background:#1a1a1a; border:1px solid #3a3a3a;
      border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,.6); color:#d8d8d8; font:12px 'Segoe UI',sans-serif; overflow:hidden; }
    .pix-prmset-t { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#232323; border-bottom:1px solid #333; cursor:grab; user-select:none; }
    .pix-prmset-t .x { margin-left:auto; color:#8a8a8a; cursor:pointer; padding:0 4px; }
    .pix-prmset-t .x:hover { color:#fff; }
    .pix-prmset-b { padding:12px; display:flex; flex-direction:column; gap:10px; }
    .pix-prmset-row { display:flex; align-items:center; gap:10px; }
    .pix-prmset-row .lab { font-size:12px; color:#cfcfcf; }
    .pix-prmset-row .sub { font-size:11px; color:#8a8a8a; }
    .pix-prmset-sw { width:34px; height:24px; border-radius:6px; border:1px solid #555; cursor:pointer; flex:none; }
    .pix-prmset-sw:hover { border-color:#fff; }
    .pix-prmset-block { display:flex; flex-direction:column; gap:5px; }
    .pix-prmset-block .lab { font-size:12px; color:#cfcfcf; }
    .pix-prmset-block .sub { font-size:11px; color:#8a8a8a; }
    .pix-prmset-seg { display:flex; border:1px solid #555; border-radius:6px; overflow:hidden; margin-top:2px; }
    .pix-prmset-seg button { flex:1; background:#1d1d1d; border:0; color:#cfcfcf; padding:6px 8px;
      font:11px 'Segoe UI',sans-serif; cursor:pointer; transition:background .1s,color .1s; }
    .pix-prmset-seg button + button { border-left:1px solid #444; }
    .pix-prmset-seg button:hover:not(.on) { color:#fff; }
    .pix-prmset-seg button.on { background:#f66744; color:#fff; }
    .pix-prmset-f { display:flex; gap:8px; padding:10px 12px; border-top:1px solid #333; background:#1f1f1f; }
    .pix-prmset-btn { border:1px solid #444; background:rgba(255,255,255,.04); color:#d8d8d8; border-radius:5px; padding:5px 12px;
      font:12px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-prmset-btn:hover { border-color:#f66744; color:#fff; }
    .pix-prmset-btn:disabled { opacity:.4; cursor:default; }
    .pix-prmset-push { margin-left:auto; }
  `;
  document.head.appendChild(s);
}

function nodeScreenRect(node) {
  if (isVueNodes() && node && node.id != null) {
    const e = document.querySelector(`[data-node-id="${node.id}"]`);
    if (e) return e.getBoundingClientRect();
  }
  const c = app.canvas, ds = c && c.ds, cv = c && c.canvas;
  if (!ds || !cv || !node?.pos || !node?.size) return null;
  const cr = cv.getBoundingClientRect();
  const titleH = window.LiteGraph?.NODE_TITLE_HEIGHT || 30;
  const sc = ds.scale || 1, off = ds.offset || [0, 0];
  const left = cr.left + (node.pos[0] + off[0]) * sc;
  const top = cr.top + (node.pos[1] - titleH + off[1]) * sc;
  return { left, top, right: left + node.size[0] * sc, bottom: top + (node.size[1] + titleH) * sc };
}
function placeBeside(panel, rect) {
  const vw = window.innerWidth, vh = window.innerHeight, mw = panel.offsetWidth, mh = panel.offsetHeight, gap = 12, pad = 8;
  if (!rect) { panel.style.left = Math.max(pad, (vw - mw) / 2) + "px"; panel.style.top = Math.max(pad, (vh - mh) / 2) + "px"; return; }
  let left = rect.right + gap;
  if (left + mw > vw - pad) left = rect.left - gap - mw;
  if (left < pad) left = Math.max(pad, vw - mw - pad);
  let top = rect.top;
  if (top + mh > vh - pad) top = vh - mh - pad;
  if (top < pad) top = pad;
  panel.style.left = left + "px"; panel.style.top = top + "px";
}
function makeDraggable(panel, handle) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".x")) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev) => {
      if (!panel.isConnected) return up();
      panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, ev.clientX - ox)) + "px";
      panel.style.top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ev.clientY - oy)) + "px";
    };
    const up = () => { window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  });
}
function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop")) return; // the colour picker
  closePromptSettings();
}
function escClose(e) {
  if (e.key === "Escape" && _panel) {
    if (document.querySelector(".pix-cp-popup, .pix-cp-modal-backdrop")) return;
    e.stopPropagation();
    closePromptSettings();
  }
}

export function closePromptSettings() {
  try { _cpHandle?.close(); } catch { /* ignore */ }
  _cpHandle = null;
  if (_panel) { try { _panel.remove(); } catch { /* ignore */ } }
  _panel = null; _panelNode = null; _onChange = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}
export function closePromptSettingsFor(node) { if (_panelNode === node) closePromptSettings(); }

export function openPromptSettings(node, onChange) {
  closePromptSettings();
  injectCSS();
  _onChange = onChange || null;
  _panelNode = node;

  const panel = el("div", "pix-prmset");
  const title = el("div", "pix-prmset-t");
  title.append(el("span", null, "⚙"), el("span", null, "Prompt settings"));
  const x = el("span", "x", "✕");
  x.addEventListener("click", closePromptSettings);
  title.appendChild(x);

  const body = el("div", "pix-prmset-b");
  const row = el("div", "pix-prmset-row");
  const sw = el("div", "pix-prmset-sw");
  sw.title = "Pick the colour the node's buttons paint with";
  sw.style.background = accentOf(node);
  const txt = el("div");
  txt.appendChild(el("div", "lab", "Button colour"));
  txt.appendChild(el("div", "sub", "This node's buttons."));
  row.append(sw, txt);
  body.appendChild(row);

  // Default join order for NEW nodes - lives here on the node's gear, not in the
  // global Settings panel (picking writes the unregistered default immediately).
  const jblock = el("div", "pix-prmset-block");
  jblock.appendChild(el("div", "lab", "Default join order"));
  jblock.appendChild(el("div", "sub", "How new Prompt nodes start. Each node still sets its own on the top line."));
  const jseg = el("div", "pix-prmset-seg");
  const jMine = el("button", null, "My prompt first");
  const jWired = el("button", null, "Wired first");
  jMine.title = "New Prompt nodes put your typed prompt before the wired one";
  jWired.title = "New Prompt nodes put the wired prompt before yours";
  jseg.append(jMine, jWired);
  jblock.appendChild(jseg);
  body.appendChild(jblock);
  // Update the highlight from the CHOSEN value (optimistic) - getSettingValue does
  // not reflect setSettingValueAsync immediately, so re-reading it here would lag.
  const applyJoinUI = (cur) => {
    jMine.classList.toggle("on", cur !== "wired");
    jWired.classList.toggle("on", cur === "wired");
  };
  applyJoinUI(getDefaultOrder());
  jMine.addEventListener("click", () => { applyJoinUI("mine"); setDefaultOrder("mine"); });
  jWired.addEventListener("click", () => { applyJoinUI("wired"); setDefaultOrder("wired"); });

  sw.addEventListener("click", () => {
    try { _cpHandle?.close(); } catch { /* ignore */ } // re-click: close the previous picker (else it leaks)
    _cpHandle = openPixaromaColorPickerPopup(sw, {
      initialColor: accentOf(node),
      swatches: BUTTON_PALETTE,
      wide: true,
      resetColor: BRAND,
      onPick: (c) => {
        setNodeAccent(node, c || null);
        sw.style.background = accentOf(node);
        _onChange?.();
      },
    });
  });

  const foot = el("div", "pix-prmset-f");
  const mkDefault = el("button", "pix-prmset-btn", "Colour default");
  mkDefault.title = "Use this node's colour for every new Prompt node";
  mkDefault.addEventListener("click", async () => {
    try {
      await app.ui.settings.setSettingValueAsync(ACCENT_SETTING, accentOf(node));
      mkDefault.textContent = "Saved";
      setTimeout(() => { mkDefault.textContent = "Colour default"; }, 1200);
    } catch { /* ignore */ }
  });
  const reset = el("button", "pix-prmset-btn", "Reset");
  reset.title = "Follow the global default colour";
  reset.addEventListener("click", () => { setNodeAccent(node, null); sw.style.background = accentOf(node); _onChange?.(); });
  const done = el("button", "pix-prmset-btn pix-prmset-push", "Done");
  done.addEventListener("click", closePromptSettings);
  foot.append(mkDefault, reset, done);

  panel.append(title, body, foot);
  document.body.appendChild(panel);
  placeBeside(panel, nodeScreenRect(node));
  makeDraggable(panel, title);
  setTimeout(() => {
    if (!panel.isConnected) return;
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
  _panel = panel;
}
