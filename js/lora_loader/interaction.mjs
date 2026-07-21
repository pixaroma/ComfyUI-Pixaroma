// LoRA Loader Pixaroma - all node-body events. ONE delegated set of listeners on
// the widget element dispatches on the data-act attributes render.mjs stamps.
// `refresh(structural)` (from index.js) re-renders and, when structural, re-fits
// the node height.

import {
  readState, patchLora, addLora, removeLora, duplicateLora, moveLora,
  setAllOn, countOn, accentOf, MAX_LORAS,
} from "./core.mjs";
import { openLoraDropdown } from "./dropdown.mjs";
import { openInfoPanel } from "./info_panel.mjs";
import { openLoraPanel } from "./settings.mjs";

let _menu = null;
let _menuCleanup = null;

function closeRowMenu() {
  if (_menuCleanup) { try { _menuCleanup(); } catch {} }
  _menuCleanup = null;
  if (_menu) { try { _menu.remove(); } catch {} }
  _menu = null;
}

function injectMenuCSS() {
  if (document.getElementById("pix-ll-menu-css")) return;
  const s = document.createElement("style");
  s.id = "pix-ll-menu-css";
  s.textContent = `
    .pix-ll-menu { position:fixed; z-index:10030; width:168px; background:#2b2b2b; border:1px solid #4a4a4a;
      border-radius:8px; box-shadow:0 12px 34px rgba(0,0,0,0.65); overflow:hidden;
      font:12px 'Segoe UI',system-ui,sans-serif; color:#e0e0e0; padding:3px 0; }
    .pix-ll-menu .it { display:flex; align-items:center; gap:9px; padding:7px 12px; cursor:pointer; }
    .pix-ll-menu .it .k { width:14px; text-align:center; color:#8a8a8a; }
    .pix-ll-menu .it:hover { background:#f66744; color:#fff; } .pix-ll-menu .it:hover .k { color:#fff; }
    .pix-ll-menu .it.danger:hover { background:#e2504a; }
    .pix-ll-menu .it.dis { opacity:.35; pointer-events:none; }
    .pix-ll-menu .sep { height:1px; background:#1b1b1b; margin:3px 0; }
  `;
  document.head.appendChild(s);
}

function openRowMenu(node, id, x, y, refresh) {
  closeRowMenu();
  injectMenuCSS();
  const st = readState(node);
  const idx = st.loras.findIndex((e) => e.id === id);
  if (idx < 0) return;
  const e = st.loras[idx];

  const menu = document.createElement("div");
  menu.className = "pix-ll-menu";
  const item = (k, label, cb, { danger = false, dis = false } = {}) => {
    const it = document.createElement("div");
    it.className = "it" + (danger ? " danger" : "") + (dis ? " dis" : "");
    const ks = document.createElement("span"); ks.className = "k"; ks.textContent = k;
    const ls = document.createElement("span"); ls.textContent = label;
    it.append(ks, ls);
    if (!dis) it.addEventListener("click", () => { closeRowMenu(); cb(); });
    return it;
  };
  const sep = () => { const d = document.createElement("div"); d.className = "sep"; return d; };

  menu.append(
    item("i", "More info", () => openInfoPanel(node, id, refresh)),
    sep(),
    item("↑", "Move up", () => { moveLora(node, id, -1); refresh(true); }, { dis: idx === 0 }),
    item("↓", "Move down", () => { moveLora(node, id, +1); refresh(true); }, { dis: idx === st.loras.length - 1 }),
    item("⧉", "Duplicate", () => { duplicateLora(node, id); refresh(true); },
      { dis: st.loras.length >= MAX_LORAS }),
    item(e.on ? "◉" : "○", e.on ? "Disable" : "Enable",
      () => {
        const cur = readState(node).loras.find((x) => x.id === id); // re-read at click time
        patchLora(node, id, { on: !cur?.on });
        refresh(false);
      }),
    sep(),
    item("⌫", "Remove", () => { removeLora(node, id); refresh(true); }, { danger: true }),
  );

  document.body.appendChild(menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(6, Math.min(x, window.innerWidth - mw - 6)) + "px";
  menu.style.top = Math.max(6, Math.min(y, window.innerHeight - mh - 6)) + "px";

  const onDown = (ev) => { if (!menu.contains(ev.target)) closeRowMenu(); };
  const onKey = (ev) => { if (ev.key === "Escape") closeRowMenu(); };
  setTimeout(() => {
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  _menuCleanup = () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
  };
  _menu = menu;
}

function rowIdOf(target) {
  const row = target.closest?.(".pix-ll-row");
  return row?.dataset?.id || null;
}

function stepWeight(node, id, dir, which, refresh) {
  const st = readState(node);
  const e = st.loras.find((x) => x.id === id);
  if (!e) return;
  if (which === "c") patchLora(node, id, { sc: e.sc + dir * st.step });
  else patchLora(node, id, { sm: e.sm + dir * st.step });
  refresh(false);
}

export function attachInteractions(node, widgetEl, refresh) {
  widgetEl.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t?.dataset?.act === "wval" || t?.dataset?.act === "wcval") return; // let the weight field focus
    const act = t.closest?.("[data-act]")?.dataset?.act;
    if (!act) return;
    ev.stopPropagation();

    if (act === "add") {
      const res = addLora(node, "");
      refresh(true);
      // Open the picker right away on the new row so it's a one-click add-and-pick.
      if (res.ok) {
        requestAnimationFrame(() => {
          const rowEl = widgetEl.querySelector(`.pix-ll-row[data-id="${res.state.loras[res.index].id}"] .pix-ll-name`);
          if (rowEl) openNamePicker(node, res.state.loras[res.index].id, rowEl, refresh);
        });
      }
      return;
    }
    if (act === "allToggle") {
      const st = readState(node);
      setAllOn(node, !(st.loras.length && countOn(st) === st.loras.length));
      refresh(false);
      return;
    }
    if (act === "gear") { openLoraPanel(node, refresh); return; }

    const id = rowIdOf(t);
    if (!id) return;
    if (act === "name") { openNamePicker(node, id, t.closest(".pix-ll-name"), refresh); return; }
    if (act === "info") { openInfoPanel(node, id, refresh); return; }
    if (act === "toggle") {
      const e = readState(node).loras.find((x) => x.id === id);
      patchLora(node, id, { on: !e?.on });
      refresh(false);
      return;
    }
    if (act === "winc") { stepWeight(node, id, +1, "m", refresh); return; }
    if (act === "wdec") { stepWeight(node, id, -1, "m", refresh); return; }
    if (act === "wcinc") { stepWeight(node, id, +1, "c", refresh); return; }
    if (act === "wcdec") { stepWeight(node, id, -1, "c", refresh); return; }
  });

  // Commit a typed weight on change (fires on blur / Enter).
  widgetEl.addEventListener("change", (ev) => {
    const act = ev.target?.dataset?.act;
    if (act !== "wval" && act !== "wcval") return;
    const id = rowIdOf(ev.target);
    if (!id) return;
    patchLora(node, id, act === "wcval" ? { sc: ev.target.value } : { sm: ev.target.value });
    refresh(false);
  });

  // Focus a weight field -> select its text for quick overwrite.
  widgetEl.addEventListener("focusin", (ev) => {
    const act = ev.target?.dataset?.act;
    if (act === "wval" || act === "wcval") ev.target.select?.();
  });

  // Keep typing inside a weight field from triggering canvas shortcuts; Enter commits.
  widgetEl.addEventListener("keydown", (ev) => {
    const act = ev.target?.dataset?.act;
    if (act !== "wval" && act !== "wcval") return;
    ev.stopPropagation();
    if (ev.key === "Enter") { ev.preventDefault(); ev.target.blur(); }
  });

  // Right-click a row -> the row menu.
  widgetEl.addEventListener("contextmenu", (ev) => {
    const id = rowIdOf(ev.target);
    if (!id) return;
    ev.preventDefault();
    ev.stopPropagation();
    openRowMenu(node, id, ev.clientX, ev.clientY, refresh);
  });
}

function openNamePicker(node, id, anchorEl, refresh) {
  const e = readState(node).loras.find((x) => x.id === id);
  openLoraDropdown(anchorEl, {
    current: e?.name || "",
    accent: accentOf(node),
    onPick: (name) => { patchLora(node, id, { name }); refresh(false); },
  });
}

export { closeRowMenu };
