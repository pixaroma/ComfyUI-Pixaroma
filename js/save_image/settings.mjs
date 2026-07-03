// Save Image Pixaroma — floating right-click settings panel (Run Timer
// pattern: free-floating themed panel beside the node, draggable by its
// header, closes on outside click / Esc). Holds the settings that would
// clutter the node face: JPG quality, workflow embedding, save-on-every-run.

import { app } from "/scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { readState, writeState } from "./state.mjs";
import { injectCSS, el } from "./ui.mjs";

let _panel = null;
let _panelNode = null;
let _onChange = null;

// Screen-pixel rect of the node (DOM in Nodes 2.0, geometry math in legacy)
// so the panel opens BESIDE the node instead of over it.
function getNodeScreenRect(node) {
  if (isVueNodes() && node && node.id != null) {
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
    if (e.target.closest(".pix-si-px")) return;
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

function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  closeSettingsPanel();
}
function escClose(e) {
  if (e.key === "Escape" && _panel) {
    e.stopPropagation();
    closeSettingsPanel();
  }
}

export function closeSettingsPanel() {
  if (_panel) {
    try {
      _panel.remove();
    } catch {}
  }
  _panel = null;
  _panelNode = null;
  _onChange = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

// onRemoved hook: only close the panel when it belongs to the deleted node.
export function closeSettingsPanelFor(node) {
  if (_panelNode === node) closeSettingsPanel();
}

function switchRow(node, key, label, sub) {
  const row = el("div", "pix-si-prow");
  const sw = el("span", "pix-si-sw" + (readState(node)[key] ? " on" : ""));
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", String(!!readState(node)[key]));
  sw.tabIndex = 0;
  const toggle = () => {
    const st = readState(node);
    st[key] = !st[key];
    writeState(node, st);
    sw.classList.toggle("on", st[key]);
    sw.setAttribute("aria-checked", String(!!st[key]));
    if (_onChange) _onChange();
  };
  sw.addEventListener("click", toggle);
  sw.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggle();
    }
  });
  const txt = el("div");
  txt.appendChild(el("div", "pix-si-plab", label));
  txt.appendChild(el("div", "pix-si-psub", sub));
  row.appendChild(sw);
  row.appendChild(txt);
  return row;
}

export function openSettingsPanel(node, onChange) {
  closeSettingsPanel();
  injectCSS();
  _onChange = onChange || null;
  const panel = el("div", "pix-si-panel");
  _panel = panel;
  _panelNode = node;

  const head = el("div", "pix-si-phead");
  head.appendChild(el("span", null, "Save Image settings"));
  const x = el("button", "pix-si-px", "✕");
  x.type = "button";
  x.onclick = closeSettingsPanel;
  head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head);

  const body = el("div", "pix-si-pbody");

  // Date style — what the + Date chip inserts (regional order)
  const dWrap = el("div");
  const dRow = el("div", "pix-si-prow");
  dRow.appendChild(el("span", "pix-si-plab", "Date style"));
  const dSeg = el("div", "pix-si-seg");
  const styles = ["yyyy-MM-dd", "dd-MM-yyyy", "MM-dd-yyyy"];
  const dBtns = styles.map((fmt) => {
    const b = el("button", null, fmt);
    b.type = "button";
    b.style.fontSize = "11px";
    b.style.padding = "4px 8px";
    b.classList.toggle("on", (readState(node).dateStyle || "yyyy-MM-dd") === fmt);
    b.addEventListener("click", () => {
      const st = readState(node);
      st.dateStyle = fmt;
      writeState(node, st);
      dBtns.forEach((x) => x.classList.toggle("on", x === b));
      if (_onChange) _onChange();
    });
    dSeg.appendChild(b);
    return b;
  });
  dRow.appendChild(dSeg);
  dWrap.appendChild(dRow);
  dWrap.appendChild(el("div", "pix-si-psub", "The order the + Date chip inserts (MM month, dd day)"));
  body.appendChild(dWrap);

  // Counter digits — %counter% zero-padding
  const cWrap = el("div");
  const cRow = el("div", "pix-si-prow");
  cRow.appendChild(el("span", "pix-si-plab", "Counter digits"));
  const cSl = el("input", "pix-si-qsl");
  cSl.type = "range";
  cSl.min = "1";
  cSl.max = "8";
  cSl.step = "1";
  cSl.value = String(readState(node).counterDigits ?? 5);
  const cVal = el("span", "pix-si-qval", "0".repeat(parseInt(cSl.value, 10) || 5) );
  cVal.style.minWidth = "58px";
  cSl.addEventListener("input", () => {
    const n = Math.max(1, Math.min(8, parseInt(cSl.value, 10) || 5));
    cVal.textContent = "0".repeat(n);
    const st = readState(node);
    st.counterDigits = n;
    writeState(node, st);
    if (_onChange) _onChange();
  });
  cRow.appendChild(cSl);
  cRow.appendChild(cVal);
  cWrap.appendChild(cRow);
  cWrap.appendChild(el("div", "pix-si-psub", "How many digits %counter% uses (00001 = 5)"));
  body.appendChild(cWrap);

  // JPG quality
  const qWrap = el("div");
  const qRow = el("div", "pix-si-prow");
  qRow.appendChild(el("span", "pix-si-plab", "JPG quality"));
  const qSl = el("input", "pix-si-qsl");
  qSl.type = "range";
  qSl.min = "1";
  qSl.max = "100";
  qSl.step = "1";
  qSl.value = String(readState(node).quality ?? 90);
  const qVal = el("span", "pix-si-qval", qSl.value);
  qSl.addEventListener("input", () => {
    qVal.textContent = qSl.value;
    const st = readState(node);
    st.quality = Math.max(1, Math.min(100, parseInt(qSl.value, 10) || 90));
    writeState(node, st);
    if (_onChange) _onChange();
  });
  qRow.appendChild(qSl);
  qRow.appendChild(qVal);
  qWrap.appendChild(qRow);
  qWrap.appendChild(el("div", "pix-si-psub", "Used only when the format is JPG"));
  body.appendChild(qWrap);

  body.appendChild(
    switchRow(
      node,
      "embedWorkflow",
      "Save workflow inside the image",
      "Drag the file back into ComfyUI to reload it (works with PNG)"
    )
  );

  panel.appendChild(body);
  document.body.appendChild(panel);
  placeBeside(panel, getNodeScreenRect(node));
  const _p = panel;
  setTimeout(() => {
    if (_panel !== _p) return; // closed within the same tick
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
}
