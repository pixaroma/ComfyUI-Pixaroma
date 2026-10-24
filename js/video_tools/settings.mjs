// Video Tools Pixaroma - the floating settings panel.
//
// Copied from js/reference_images/settings.mjs (itself Save Video's shape):
// beside the node and following it, outside-close on POINTERDOWN with the gear
// and the colour picker exempt, Escape closes, the drag ignores the close button.
// Every option is saved IN THE NODE, so a shared workflow behaves the same.

import { createAccentSection } from "../shared/node_settings.mjs";
import { followNode, getNodeScreenRect, makeDraggable, placeBeside } from "../shared/node_panel.mjs";
import { readState } from "./core.mjs";
import { injectCSS } from "./css.mjs";
import { setOption } from "./actions.mjs";

let _panel = null;
let _panelNode = null;
let _stopFollow = null;
let _userMoved = false;
let _cpHandle = null;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop, .pix-nset-pop, .pix-vdt-gear")) return;
  closeSettingsPanel();
}

function escClose(e) {
  if (e.key === "Escape" && _panel) {
    e.stopPropagation();
    closeSettingsPanel();
  }
}

export function closeSettingsPanel() {
  _stopFollow?.();
  _stopFollow = null;
  try { _cpHandle?.close?.(); } catch {}
  _cpHandle = null;
  try { _panel?.remove(); } catch {}
  _panel = null;
  _panelNode = null;
  _userMoved = false;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

export function closeSettingsPanelFor(node) {
  if (_panelNode === node) closeSettingsPanel();
}

export const isPanelOpenFor = (node) => _panelNode === node && !!_panel;

function section(body, label, sub) {
  const wrap = el("div");
  wrap.appendChild(el("div", "pix-vdt-plab", label));
  if (sub) wrap.appendChild(el("div", "pix-vdt-psub", sub));
  body.appendChild(wrap);
  return wrap;
}

function chips(node, wrap, key, options) {
  const row = el("div", "pix-vdt-bgrid");
  const sync = () => {
    const cur = readState(node)[key];
    for (const b of row.children) b.classList.toggle("on", b.dataset.key === cur);
  };
  for (const [k, label] of options) {
    const b = el("button", "pix-vdt-bchip", label);
    b.type = "button";
    b.dataset.key = k;
    b.onclick = () => { setOption(node, key, k); sync(); };
    row.appendChild(b);
  }
  sync();
  wrap.appendChild(row);
}

export function openSettingsPanel(node) {
  if (isPanelOpenFor(node)) {
    closeSettingsPanel();
    return null;
  }
  closeSettingsPanel();
  injectCSS();
  const panel = el("div", "pix-vdt-panel");
  _panel = panel;
  _panelNode = node;

  const head = el("div", "pix-vdt-phead");
  head.appendChild(el("span", null, "Video Tools settings"));
  const x = el("button", "pix-vdt-px", "✕");
  x.type = "button";
  x.setAttribute("aria-label", "Close");
  x.onclick = closeSettingsPanel;
  head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head, { onUserMove: () => { _userMoved = true; }, ignoreSelector: ".pix-vdt-px" });

  const body = el("div", "pix-vdt-pbody");

  chips(node, section(body, "Clips of another size",
    "Every clip takes the size of the first one. Fill crops the edges of a clip with another shape, Fit adds "
    + "black bars, Stretch pulls it to the size."), "size", [["fill", "Fill"], ["fit", "Fit"], ["stretch", "Stretch"]]);

  const mWrap = section(body, "Match colors: strength",
    "How far Match colors moves each clip toward the one before it. 100 matches it fully.");
  const row = el("div", "pix-vdt-prow");
  const sl = el("input", "pix-vdt-qsl");
  sl.type = "range";
  sl.min = "0";
  sl.max = "100";
  sl.step = "5";
  sl.value = String(readState(node).matchStrength);
  sl.setAttribute("aria-label", "Match colors strength");
  const val = el("span", "pix-vdt-qval", `${sl.value}%`);
  sl.oninput = () => { val.textContent = `${sl.value}%`; setOption(node, "matchStrength", parseInt(sl.value, 10), true); };
  sl.onchange = () => setOption(node, "matchStrength", parseInt(sl.value, 10));
  row.append(sl, val);
  mWrap.appendChild(row);

  chips(node, section(body, "Preview on the node",
    "After a Run the node keeps a small moving preview you can play. Off saves the few seconds it takes to make."),
  "preview", [["animated", "Moving"], ["off", "Off"]]);

  body.appendChild(createAccentSection(node, {
    onChange: () => node._pixVdtRefresh?.(),
    onPickerOpen: (h) => { _cpHandle = h; },
  }));

  panel.appendChild(body);
  document.body.appendChild(panel);
  placeBeside(panel, getNodeScreenRect(node));
  _stopFollow = followNode(panel, node, {
    isCurrent: () => _panel === panel,
    isUserMoved: () => _userMoved,
  });
  setTimeout(() => {
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
  return panel;
}
