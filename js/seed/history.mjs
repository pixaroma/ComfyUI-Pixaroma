// Seed Pixaroma — floating "Seed history" panel (same floating-panel pattern as
// the settings panel / Run Timer / Save Image: a themed panel beside the node,
// draggable by its header, closes on outside click / Esc). Lists the last N
// seeds that actually ran (global — see index.js recordSeedHistory) and lets you
// Use one on this node, Copy it, or Export the whole list as a .txt file.
//
// Self-contained: index.js passes a ctx so this module needs no import back:
//   ctx = { getHistory() -> number[], useSeed(seed), clearHistory(),
//           copyToClipboard(text, flash) }

import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

let _cssDone = false;
function injectCSS() {
  if (_cssDone || document.getElementById("pix-seed-hist-css")) {
    _cssDone = true;
    return;
  }
  _cssDone = true;
  const s = document.createElement("style");
  s.id = "pix-seed-hist-css";
  s.textContent = [
    ".pix-seed-hpanel{position:fixed;z-index:10010;width:300px;max-width:94vw;max-height:70vh;display:flex;flex-direction:column;background:#1a1a1a;border:1px solid #444;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.6);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;}",
    ".pix-seed-hhead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #333;color:#ddd;font-size:13px;font-weight:600;cursor:move;flex:0 0 auto;}",
    ".pix-seed-hx{border:0;background:transparent;color:#999;font-size:13px;cursor:pointer;padding:2px 7px;border-radius:4px;}",
    ".pix-seed-hx:hover{color:#fff;}",
    ".pix-seed-hlist{overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:6px;flex:1 1 auto;}",
    ".pix-seed-hempty{color:#8f8f8f;font-size:12px;text-align:center;line-height:1.5;padding:22px 12px;}",
    ".pix-seed-hrow{display:flex;align-items:center;gap:8px;background:#1d1d1d;border:1px solid #333;border-radius:6px;padding:6px 8px;}",
    ".pix-seed-hidx{flex:0 0 auto;color:#6f6f6f;font-size:10px;min-width:15px;text-align:right;}",
    ".pix-seed-hseed{flex:1;min-width:0;font-family:ui-monospace,Consolas,monospace;font-size:13px;color:#f2f2f2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:text;}",
    ".pix-seed-hbtn{flex:0 0 auto;padding:4px 10px;border-radius:5px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);color:rgba(255,255,255,0.85);font-size:11px;cursor:pointer;font-family:inherit;transition:background .08s,border-color .08s,color .08s;}",
    ".pix-seed-hbtn:hover{background:" + BRAND + ";border-color:" + BRAND + ";color:#fff;}",
    ".pix-seed-hbtn.is-flashing,.pix-seed-hbtn.is-flashing:hover{background:#3ec371;border-color:#3ec371;color:#fff;}",
    ".pix-seed-hfoot{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #333;flex:0 0 auto;}",
    ".pix-seed-hfbtn{flex:1;padding:7px;border-radius:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);color:rgba(255,255,255,0.85);font-size:12px;cursor:pointer;font-family:inherit;transition:background .08s,border-color .08s,color .08s;}",
    ".pix-seed-hfbtn:hover{background:" + BRAND + ";border-color:" + BRAND + ";color:#fff;}",
  ].join("\n");
  document.head.appendChild(s);
}

let _panel = null;
let _panelNode = null;
let _ctx = null;

function outsideClose(e) {
  if (_panel && !_panel.contains(e.target)) closeSeedHistory();
}
function escClose(e) {
  if (e.key === "Escape" && _panel) {
    e.stopPropagation();
    closeSeedHistory();
  }
}

export function closeSeedHistory() {
  if (_panel) {
    try { _panel.remove(); } catch {}
  }
  _panel = null;
  _panelNode = null;
  _ctx = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

// onRemoved: only close when the panel belongs to the deleted node.
export function closeSeedHistoryFor(node) {
  if (_panelNode === node) closeSeedHistory();
}

// Screen-pixel rect of the node (DOM in Nodes 2.0, geometry math in legacy) so
// the panel opens BESIDE the node instead of over it.
function nodeScreenRect(node) {
  const vue = !!window.LiteGraph?.vueNodesMode;
  if (vue && node && node.id != null) {
    const elx = document.querySelector('[data-node-id="' + node.id + '"]');
    if (elx) return elx.getBoundingClientRect();
  }
  const c = app.canvas;
  const ds = c && c.ds;
  const canvasEl = c && c.canvas;
  if (!ds || !canvasEl || !node || !node.pos || !node.size) return null;
  const cr = canvasEl.getBoundingClientRect();
  const titleH = (window.LiteGraph && window.LiteGraph.NODE_TITLE_HEIGHT) || 30;
  const scale = ds.scale || 1;
  const off = ds.offset || [0, 0];
  const left = cr.left + (node.pos[0] + off[0]) * scale;
  const top = cr.top + (node.pos[1] - titleH + off[1]) * scale;
  const width = node.size[0] * scale;
  const height = (node.size[1] + titleH) * scale;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function placeBeside(panel, rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mw = panel.offsetWidth;
  const mh = panel.offsetHeight;
  const gap = 12;
  const pad = 8;
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
    if (e.target.closest(".pix-seed-hx")) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const ox = e.clientX - r.left;
    const oy = e.clientY - r.top;
    const move = (ev) => {
      if (!panel.isConnected) {
        up();
        return;
      }
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

function flashCopy(btn, ok) {
  btn.classList.toggle("is-flashing", ok);
  btn.textContent = ok ? "Copied" : "No clip";
  setTimeout(() => {
    btn.classList.remove("is-flashing");
    btn.textContent = "Copy";
  }, 700);
}

function buildList(listEl) {
  listEl.innerHTML = "";
  const seeds = (_ctx && _ctx.getHistory && _ctx.getHistory()) || [];
  if (!seeds.length) {
    listEl.appendChild(
      el("div", "pix-seed-hempty", "No seeds yet. Seeds you run will show up here (up to 10).")
    );
    return;
  }
  seeds.forEach((seed, i) => {
    const row = el("div", "pix-seed-hrow");
    row.appendChild(el("div", "pix-seed-hidx", i + 1 + "."));
    const val = el("div", "pix-seed-hseed", String(seed));
    val.title = String(seed);
    row.appendChild(val);
    const useBtn = el("button", "pix-seed-hbtn", "Use");
    useBtn.type = "button";
    useBtn.title = "Set this node's seed to " + seed + " (locks it as Fixed).";
    useBtn.addEventListener("click", () => { _ctx && _ctx.useSeed && _ctx.useSeed(seed); });
    const copyBtn = el("button", "pix-seed-hbtn", "Copy");
    copyBtn.type = "button";
    copyBtn.title = "Copy " + seed + " to the clipboard.";
    copyBtn.addEventListener("click", () => {
      if (_ctx && _ctx.copyToClipboard) _ctx.copyToClipboard(String(seed), (ok) => flashCopy(copyBtn, ok));
    });
    row.append(useBtn, copyBtn);
    listEl.appendChild(row);
  });
}

// Rebuild the list if the panel is open (called after a run records a new seed).
export function refreshSeedHistory() {
  if (!_panel) return;
  const listEl = _panel.querySelector(".pix-seed-hlist");
  if (listEl) buildList(listEl);
}

function exportTxt(seeds) {
  // CRLF so the file opens cleanly in Notepad; one seed per line.
  const text = seeds.join("\r\n") + "\r\n";
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "seed-history.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function openSeedHistory(node, ctx) {
  closeSeedHistory();
  injectCSS();
  _ctx = ctx;
  const panel = el("div", "pix-seed-hpanel");
  _panel = panel;
  _panelNode = node;

  const head = el("div", "pix-seed-hhead");
  head.appendChild(el("span", null, "Seed history"));
  const x = el("button", "pix-seed-hx", "✕");
  x.type = "button";
  x.onclick = closeSeedHistory;
  head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head);

  const list = el("div", "pix-seed-hlist");
  buildList(list);
  panel.appendChild(list);

  const foot = el("div", "pix-seed-hfoot");
  const exportBtn = el("button", "pix-seed-hfbtn", "Export .txt");
  exportBtn.type = "button";
  exportBtn.title = "Download the seed list as a text file.";
  exportBtn.addEventListener("click", () => {
    const seeds = (ctx && ctx.getHistory && ctx.getHistory()) || [];
    if (!seeds.length) return;
    exportTxt(seeds);
  });
  const clearBtn = el("button", "pix-seed-hfbtn", "Clear");
  clearBtn.type = "button";
  clearBtn.title = "Forget all remembered seeds.";
  clearBtn.addEventListener("click", () => {
    if (ctx && ctx.clearHistory) ctx.clearHistory();
    buildList(list);
  });
  foot.append(exportBtn, clearBtn);
  panel.appendChild(foot);

  document.body.appendChild(panel);
  placeBeside(panel, nodeScreenRect(node));
  const _p = panel;
  setTimeout(() => {
    if (_panel !== _p) return; // closed within the same tick
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
}
