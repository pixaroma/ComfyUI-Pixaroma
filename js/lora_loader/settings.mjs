// LoRA Loader Pixaroma - the floating gear settings panel (Sizes / Sliders pattern:
// themed panel beside the node, draggable by its header, closes on outside click or
// Esc). Per-node preferences; "Set as default" stores them for new nodes.

import { app } from "/scripts/app.js";
import { openPixaromaColorPickerPopup, BUTTON_PALETTE } from "../shared/color_picker.mjs";
import {
  readState, writeState, accentOf, saveDefaults, roundStrength, BRAND,
} from "./core.mjs";

let _panel = null;
let _panelNode = null;
let _refresh = null;
let _cpHandle = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function injectCSS() {
  if (document.getElementById("pix-llp-css")) return;
  const s = document.createElement("style");
  s.id = "pix-llp-css";
  s.textContent = `
    .pix-llp { position:fixed; z-index:10010; width:290px; max-width:94vw; background:#1a1a1a;
      border:1px solid #4a4a4a; border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,0.6);
      color:#d8d8d8; font:12px 'Segoe UI',system-ui,sans-serif; overflow:hidden; }
    .pix-llp-t { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#232323;
      border-bottom:1px solid #333; cursor:grab; user-select:none; color:var(--acc,${BRAND}); }
    .pix-llp-t .x { margin-left:auto; color:#8a8a8a; cursor:pointer; padding:0 4px; }
    .pix-llp-t .x:hover { color:#fff; }
    .pix-llp-b { padding:12px; display:flex; flex-direction:column; gap:11px; max-height:64vh; overflow-y:auto; }
    .pix-llp-row { display:flex; align-items:center; gap:10px; }
    .pix-llp-row .lab { flex:1; color:#c2c2c2; }
    .pix-llp-row .hint { display:block; font-size:10px; color:#7a7a7a; margin-top:1px; }
    .pix-llp-num { width:66px; box-sizing:border-box; background:#161616; border:1px solid #4a4a4a;
      border-radius:6px; color:#fff; text-align:center; font:12px monospace; padding:6px 4px; outline:none; }
    .pix-llp-num:focus { border-color:var(--acc,${BRAND}); }
    .pix-llp-txt { width:70px; box-sizing:border-box; background:#161616; border:1px solid #4a4a4a;
      border-radius:6px; color:#fff; text-align:center; font:12px monospace; padding:6px 4px; outline:none; }
    .pix-llp-txt:focus { border-color:var(--acc,${BRAND}); }
    .pix-llp-sw { flex:0 0 auto; width:34px; height:18px; border-radius:99px; background:#3a3a3a;
      position:relative; cursor:pointer; border:1px solid #000; }
    .pix-llp-sw::after { content:""; position:absolute; top:1px; left:1px; width:14px; height:14px;
      border-radius:50%; background:#8a8a8a; transition:left .14s, background .14s; }
    .pix-llp-sw.on { background:var(--acc,${BRAND}); } .pix-llp-sw.on::after { left:17px; background:#fff; }
    .pix-llp-swatch { width:30px; height:22px; border-radius:5px; border:1px solid #555; cursor:pointer; flex:0 0 auto; }
    .pix-llp-swatch:hover { border-color:#fff; }
    .pix-llp-f { display:flex; gap:8px; padding:10px 12px; border-top:1px solid #333; background:#1f1f1f; }
    .pix-llp-btn { border:1px solid #444; background:rgba(255,255,255,0.04); color:#d8d8d8; border-radius:5px;
      padding:6px 12px; font:12px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-llp-btn:hover { border-color:var(--acc,${BRAND}); color:#fff; }
    .pix-llp-push { margin-left:auto; }
  `;
  document.head.appendChild(s);
}

function getNodeRect(node) {
  if (node?.id != null) {
    const e = document.querySelector(`[data-node-id="${node.id}"]`);
    if (e) return e.getBoundingClientRect();
  }
  const c = app.canvas, ds = c?.ds, cv = c?.canvas;
  if (!ds || !cv || !node?.pos || !node?.size) return null;
  const cr = cv.getBoundingClientRect();
  const titleH = window.LiteGraph?.NODE_TITLE_HEIGHT || 30;
  const sc = ds.scale || 1, off = ds.offset || [0, 0];
  const left = cr.left + (node.pos[0] + off[0]) * sc;
  const top = cr.top + (node.pos[1] - titleH + off[1]) * sc;
  return { left, top, right: left + node.size[0] * sc, bottom: top + (node.size[1] + titleH) * sc };
}
function placeBeside(panel, rect) {
  const vw = window.innerWidth, vh = window.innerHeight, mw = panel.offsetWidth, mh = panel.offsetHeight;
  const gap = 12, pad = 8;
  if (!rect) { panel.style.left = Math.max(pad, (vw - mw) / 2) + "px"; panel.style.top = Math.max(pad, (vh - mh) / 2) + "px"; return; }
  let left = rect.right + gap;
  if (left + mw > vw - pad) left = rect.left - gap - mw;
  if (left < pad) left = Math.max(pad, vw - mw - pad);
  let top = Math.min(rect.top, vh - mh - pad);
  panel.style.left = left + "px";
  panel.style.top = Math.max(pad, top) + "px";
}
function makeDraggable(panel, handle) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".x")) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev) => {
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
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop")) return;
  closeLoraPanel();
}
function escClose(e) {
  if (e.key === "Escape" && _panel) {
    if (document.querySelector(".pix-cp-popup, .pix-cp-modal-backdrop")) return;
    e.stopPropagation();
    closeLoraPanel();
  }
}

export function closeLoraPanel() {
  try { _cpHandle?.close(); } catch {}
  _cpHandle = null;
  if (_panel) { try { _panel.remove(); } catch {} }
  _panel = null; _panelNode = null; _refresh = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}
export function closeLoraPanelFor(node) { if (_panelNode === node) closeLoraPanel(); }

export function openLoraPanel(node, refresh) {
  closeLoraPanel();
  injectCSS();
  _panelNode = node;
  _refresh = refresh || null;

  const panel = el("div", "pix-llp");
  panel.style.setProperty("--acc", accentOf(node));

  const title = el("div", "pix-llp-t");
  title.append(el("span", null, "⚙"), el("span", null, "LoRA Loader settings"));
  const x = el("span", "x", "✕");
  x.addEventListener("click", closeLoraPanel);
  title.appendChild(x);

  const body = el("div", "pix-llp-b");

  const fire = () => { _refresh?.(false); };
  const set = (patch) => { writeState(node, { ...readState(node), ...patch }); };

  // toggle row helper
  function toggleRow(label, hint, key, invert = false) {
    const row = el("div", "pix-llp-row");
    const l = el("div", "lab"); l.append(el("span", null, label));
    if (hint) { const h = el("span", "hint", hint); l.appendChild(h); }
    const sw = el("div", "pix-llp-sw");
    const cur = () => { const v = !!readState(node)[key]; return invert ? !v : v; };
    const paint = () => sw.classList.toggle("on", cur());
    paint();
    sw.addEventListener("click", () => {
      const next = !cur();
      set({ [key]: invert ? !next : next });
      paint();
      fire();
    });
    row.append(l, sw);
    return row;
  }

  // number row helper
  function numRow(label, key, { min = 0, round = null } = {}) {
    const row = el("div", "pix-llp-row");
    row.appendChild(el("div", "lab", label));
    const inp = el("input", "pix-llp-num");
    inp.type = "text";
    inp.value = String(readState(node)[key]);
    inp.addEventListener("keydown", (e) => e.stopPropagation());
    inp.addEventListener("change", () => {
      let v = parseFloat(inp.value);
      if (!Number.isFinite(v)) v = readState(node)[key];
      if (round) v = round(v);
      if (v < min) v = min;
      set({ [key]: v });
      inp.value = String(readState(node)[key]);
      fire();
    });
    row.appendChild(inp);
    return row;
  }

  body.appendChild(numRow("Default strength (new LoRAs)", "defStrength", { min: -10, round: roundStrength }));
  body.appendChild(numRow("Strength step (arrows)", "step", { min: 0.001 }));
  body.appendChild(toggleRow("Separate model / clip strength",
    "Show two strengths per row", "linkStrength", true));

  // separator (text)
  const sepRow = el("div", "pix-llp-row");
  sepRow.appendChild(el("div", "lab", "Trigger words separator"));
  const sepIn = el("input", "pix-llp-txt");
  sepIn.type = "text";
  sepIn.value = readState(node).sep;
  sepIn.title = "Text placed between trigger words in the output (e.g. \", \")";
  sepIn.addEventListener("keydown", (e) => e.stopPropagation());
  sepIn.addEventListener("change", () => { set({ sep: sepIn.value }); fire(); });
  sepRow.appendChild(sepIn);
  body.appendChild(sepRow);

  body.appendChild(toggleRow("Hide file extension",
    "Show the LoRA name without .safetensors", "hideExt"));
  body.appendChild(toggleRow("Civitai lookup button",
    "Show the optional online lookup in the info panel", "civitai"));
  body.appendChild(toggleRow("Show preview thumbnails",
    "In the info panel", "thumbs"));

  // accent
  const accRow = el("div", "pix-llp-row");
  accRow.appendChild(el("div", "lab", "Highlight colour"));
  const sw = el("div", "pix-llp-swatch");
  sw.style.background = accentOf(node);
  sw.title = "Pick the highlight colour";
  sw.addEventListener("click", () => {
    try { _cpHandle?.close(); } catch {} // don't stack pickers on repeated clicks
    _cpHandle = openPixaromaColorPickerPopup(sw, {
      initialColor: accentOf(node),
      swatches: BUTTON_PALETTE,
      wide: true,
      resetColor: BRAND,
      onPick: (c) => {
        const col = c || BRAND;
        set({ accent: col });
        panel.style.setProperty("--acc", col);
        sw.style.background = col;
        node._pixLlInner?.style.setProperty("--acc", col);
        fire();
      },
    });
  });
  accRow.appendChild(sw);
  body.appendChild(accRow);

  // footer
  const foot = el("div", "pix-llp-f");
  const mkDefault = el("button", "pix-llp-btn", "Set as default");
  mkDefault.title = "Use these settings for every new LoRA Loader node";
  mkDefault.addEventListener("click", async () => {
    const st = readState(node);
    const ok = await saveDefaults(st);
    mkDefault.textContent = ok ? "Saved as default" : "Could not save";
    setTimeout(() => { mkDefault.textContent = "Set as default"; }, 1200);
  });
  const done = el("button", "pix-llp-btn pix-llp-push", "Done");
  done.addEventListener("click", closeLoraPanel);
  foot.append(mkDefault, done);

  panel.append(title, body, foot);
  document.body.appendChild(panel);
  placeBeside(panel, getNodeRect(node));
  makeDraggable(panel, title);

  setTimeout(() => {
    if (!_panel) return;
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
  _panel = panel;
}
