// LoRA Loader Pixaroma - DOM build (pure) + CSS + height math. No event listeners
// here; interaction.mjs attaches ONE delegated handler on the widget element and
// dispatches on the data-act attributes this module stamps. index.js owns sizing
// and calls renderNode().

import { BRAND, readState, accentOf, countOn, MAX_LORAS } from "./core.mjs";

// Height constants - kept in lockstep with the CSS so the node hugs its content
// with no bottom gap and no scrollbar (getMinHeight in index.js reads contentHeight).
const PAD = 9;
const ADD_H = 30;
const TOP_GAP = 6;
const TOPROW_H = 28;
const AFTER_TOP = 9;
export const ROW_H = 32;
const ROW_GAP = 6;
const EMPTY_H = 46;

export function contentHeight(state) {
  const n = state.loras.length;
  const rowsH = n ? n * ROW_H + (n - 1) * ROW_GAP : EMPTY_H;
  return PAD + ADD_H + TOP_GAP + TOPROW_H + AFTER_TOP + rowsH + PAD;
}

const NO_LORAS = "(put LoRAs in models/loras)";
function baseName(name) {
  if (!name) return "";
  const i = name.replace(/\\/g, "/").lastIndexOf("/");
  return i < 0 ? name : name.slice(i + 1);
}

// One weight box: a typeable value + a ▲▼ spinner. `which` is "m" (model) or "c"
// (clip); the data-act values let the delegated handler know which strength to set.
function weightBox(value, which) {
  const w = document.createElement("div");
  w.className = "pix-ll-w";
  const val = document.createElement("input");
  val.className = "pix-ll-wval";
  val.dataset.act = which === "c" ? "wcval" : "wval";
  val.type = "text";
  val.value = Number(value).toFixed(2);
  val.title = which === "c" ? "Clip strength" : "Strength - type a value or use the arrows";
  const spin = document.createElement("div");
  spin.className = "pix-ll-wspin";
  const up = document.createElement("button");
  up.className = "pix-ll-wbtn"; up.dataset.act = which === "c" ? "wcinc" : "winc"; up.textContent = "▲"; up.tabIndex = -1;
  const dn = document.createElement("button");
  dn.className = "pix-ll-wbtn"; dn.dataset.act = which === "c" ? "wcdec" : "wdec"; dn.textContent = "▼"; dn.tabIndex = -1;
  spin.append(up, dn);
  w.append(val, spin);
  return w;
}

export function injectCSS() {
  if (document.getElementById("pix-ll-css")) return;
  const s = document.createElement("style");
  s.id = "pix-ll-css";
  s.textContent = `
    .pix-ll-root { width:100%; box-sizing:border-box; background:#1d1d1d; border-radius:4px;
      color:#ddd; font-family:ui-sans-serif,system-ui,sans-serif; font-size:11px; }
    /* Plain block flow (NOT flex, NOT absolute) so the list can never be squeezed
       (Sizes Pattern #4). Each child takes its natural height. */
    .pix-ll-inner { box-sizing:border-box; padding:${PAD}px; }

    .pix-ll-add { box-sizing:border-box; width:100%; height:${ADD_H}px; border:0; border-radius:6px;
      background:var(--acc,${BRAND}); color:#fff; font:600 12px 'Segoe UI',sans-serif; cursor:pointer;
      display:flex; align-items:center; justify-content:center; gap:6px; }
    .pix-ll-add:hover { filter:brightness(1.08); }
    .pix-ll-add:disabled { opacity:.4; cursor:default; filter:none; }

    .pix-ll-toprow { display:flex; align-items:stretch; gap:6px; margin-top:${TOP_GAP}px; height:${TOPROW_H}px; }
    .pix-ll-all { flex:1; min-width:0; display:flex; align-items:center; gap:8px;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14); border-radius:5px;
      padding:0 9px; color:#a8a8a8; cursor:pointer; user-select:none; }
    .pix-ll-all:hover { border-color:var(--acc,${BRAND}); color:#ddd; }
    .pix-ll-all .cnt { font-size:11px; white-space:nowrap; }
    .pix-ll-gear { flex:0 0 auto; width:32px; display:flex; align-items:center; justify-content:center;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14); border-radius:5px;
      color:#bbb; font-size:14px; cursor:pointer; user-select:none; }
    .pix-ll-gear:hover { border-color:var(--acc,${BRAND}); color:#fff; }

    .pix-ll-rows { margin-top:${AFTER_TOP}px; display:flex; flex-direction:column; gap:${ROW_GAP}px; }
    .pix-ll-row { box-sizing:border-box; height:${ROW_H}px; display:flex; align-items:center; gap:6px;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); border-radius:6px;
      padding:0 6px; }
    .pix-ll-row.off { opacity:.42; }

    .pix-ll-name { flex:1; min-width:0; height:24px; display:flex; align-items:center; gap:5px;
      background:#161616; border:1px solid #3a3a3a; border-radius:5px; padding:0 8px;
      font:11px monospace; color:#ddd; cursor:pointer; overflow:hidden; }
    .pix-ll-name:hover { border-color:var(--acc,${BRAND}); }
    .pix-ll-name .nm { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pix-ll-name.empty .nm { color:#777; }
    .pix-ll-name .car { flex:none; color:#777; font-size:9px; }

    .pix-ll-w { flex:0 0 auto; display:flex; align-items:center; height:24px; width:56px;
      background:#161616; border:1px solid #3a3a3a; border-radius:5px; overflow:hidden; }
    .pix-ll-w:focus-within { border-color:var(--acc,${BRAND}); }
    .pix-ll-wval { flex:1; min-width:0; width:100%; background:transparent; border:0; outline:none;
      color:#fff; text-align:center; font:11px monospace; padding:0; }
    .pix-ll-wval::-webkit-outer-spin-button,.pix-ll-wval::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
    .pix-ll-wspin { flex:0 0 auto; display:flex; flex-direction:column; width:15px; height:100%;
      border-left:1px solid #3a3a3a; }
    .pix-ll-wbtn { flex:1; border:0; background:transparent; color:#9a9a9a; cursor:pointer;
      font-size:7px; line-height:1; display:flex; align-items:center; justify-content:center; padding:0; }
    .pix-ll-wbtn:hover { color:var(--acc,${BRAND}); background:rgba(255,255,255,0.06); }

    .pix-ll-info { flex:0 0 auto; width:22px; height:22px; border-radius:5px;
      border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.05); color:#a8a8a8;
      cursor:pointer; display:flex; align-items:center; justify-content:center;
      font:italic 12px Georgia,serif; }
    .pix-ll-info:hover { border-color:var(--acc,${BRAND}); color:#fff; }

    .pix-ll-sw { flex:0 0 auto; width:30px; height:16px; border-radius:99px; background:#3a3a3a;
      position:relative; cursor:pointer; border:1px solid #000; }
    .pix-ll-sw::after { content:""; position:absolute; top:1px; left:1px; width:12px; height:12px;
      border-radius:50%; background:#8a8a8a; transition:left .14s, background .14s; }
    .pix-ll-sw.on { background:var(--acc,${BRAND}); }
    .pix-ll-sw.on::after { left:15px; background:#fff; }

    .pix-ll-empty { box-sizing:border-box; height:${EMPTY_H}px; margin-top:${AFTER_TOP}px;
      display:flex; align-items:center; justify-content:center; text-align:center; color:#777;
      font-size:11px; background:rgba(0,0,0,0.2); border:1px dashed #3a3a3a; border-radius:6px; padding:0 10px; }
  `;
  document.head.appendChild(s);
}

export function ensureRoot(node) {
  const held = node._pixLlRoot;
  if (held && held.isConnected) return held;
  const w = (node.widgets || []).find((x) => x.name === "loras_ui");
  const el = w?.element;
  const elRoot = el?.classList?.contains?.("pix-ll-root") ? el : el?.querySelector?.(".pix-ll-root");
  if (elRoot) { node._pixLlRoot = elRoot; return elRoot; }
  return held || null; // populate the held root now; it shows when it mounts
}

export function renderNode(node) {
  const root = ensureRoot(node);
  if (!root) return;
  let inner = root.querySelector(".pix-ll-inner");
  if (!inner) {
    inner = document.createElement("div");
    inner.className = "pix-ll-inner";
    root.appendChild(inner);
  }
  node._pixLlInner = inner;

  const st = readState(node);
  const acc = accentOf(node);
  inner.style.setProperty("--acc", acc);
  inner.innerHTML = "";

  // ── Add LoRA (full width) ────────────────────────────────────────────────
  const add = document.createElement("button");
  add.className = "pix-ll-add";
  add.dataset.act = "add";
  add.textContent = "＋ Add LoRA";
  add.disabled = st.loras.length >= MAX_LORAS;
  add.title = st.loras.length >= MAX_LORAS ? `Up to ${MAX_LORAS} LoRAs per node` : "Add a LoRA row";
  inner.appendChild(add);

  // ── All on/off + count, and the gear ─────────────────────────────────────
  const on = countOn(st), total = st.loras.length;
  const toprow = document.createElement("div");
  toprow.className = "pix-ll-toprow";
  const all = document.createElement("div");
  all.className = "pix-ll-all";
  all.dataset.act = "allToggle";
  all.title = "Turn every LoRA on or off";
  const asw = document.createElement("span");
  asw.className = "pix-ll-sw" + (total && on === total ? " on" : "");
  const cnt = document.createElement("span");
  cnt.className = "cnt";
  cnt.textContent = total ? `${on} / ${total} on` : "no LoRAs";
  all.append(asw, cnt);
  const gear = document.createElement("div");
  gear.className = "pix-ll-gear";
  gear.dataset.act = "gear";
  gear.textContent = "⚙";
  gear.title = "LoRA Loader settings";
  toprow.append(all, gear);
  inner.appendChild(toprow);

  // ── rows, or the empty state ─────────────────────────────────────────────
  if (!st.loras.length) {
    const empty = document.createElement("div");
    empty.className = "pix-ll-empty";
    empty.textContent = "No LoRAs yet — click ＋ Add LoRA to stack your first one.";
    inner.appendChild(empty);
    return;
  }

  const rows = document.createElement("div");
  rows.className = "pix-ll-rows";
  for (const e of st.loras) {
    const row = document.createElement("div");
    row.className = "pix-ll-row" + (e.on ? "" : " off");
    row.dataset.id = e.id;

    const name = document.createElement("div");
    name.className = "pix-ll-name" + (e.name ? "" : " empty");
    name.dataset.act = "name";
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = e.name ? baseName(e.name) : NO_LORAS;
    nm.title = e.name || "Pick a LoRA";
    const car = document.createElement("span"); car.className = "car"; car.textContent = "▾";
    name.append(nm, car);

    const wm = weightBox(e.sm, "m");

    const info = document.createElement("div");
    info.className = "pix-ll-info";
    info.dataset.act = "info";
    info.textContent = "i";
    info.title = "Info + pick trigger words";

    const sw = document.createElement("div");
    sw.className = "pix-ll-sw" + (e.on ? " on" : "");
    sw.dataset.act = "toggle";
    sw.title = e.on ? "On - click to turn off" : "Off - click to turn on";

    row.append(name, wm);
    if (!st.linkStrength) row.appendChild(weightBox(e.sc, "c")); // separate model/clip
    row.append(info, sw);
    rows.appendChild(row);
  }
  inner.appendChild(rows);
}
