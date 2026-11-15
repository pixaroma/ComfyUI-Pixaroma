// Save Image Pixaroma — floating right-click settings panel (Run Timer
// pattern: free-floating themed panel beside the node, draggable by its
// header, closes on outside click / Esc). Holds the settings that would
// clutter the node face: JPG quality, workflow embedding, save-on-every-run.

import { readState, writeState } from "./state.mjs";
import { injectCSS, el } from "./ui.mjs";
import { createAccentSection } from "../shared/node_settings.mjs";
import {
  followNode,
  placeBeside,
  getNodeScreenRect,
  makeDraggable as _makeDraggable,
} from "../shared/node_panel.mjs";

// keep the old call shape (panel, handle) so the call site below is untouched
const makeDraggable = (panel, handle) =>
  _makeDraggable(panel, handle, {
    onUserMove: () => { _userMoved = true; },
    ignoreSelector: ".pix-si-px",
  });

let _panel = null;
let _panelNode = null;
let _onChange = null;
let _userMoved = false; // has the user dragged the panel somewhere deliberately?

// The panel's placement, its follow-the-node loop and its drag all moved to
// js/shared/node_panel.mjs on 2026-08-10 so Save Video uses the same copy. The
// two bug fixes they carry (the lost-pointerup guard and the subgraph-safe
// getNodeById) are documented there; this file keeps only its own singleton
// state and its own rows.
let _stopFollow = null;

function startFollowing(panel, node) {
  _stopFollow = followNode(panel, node, {
    isCurrent: () => _panel === panel,
    isUserMoved: () => _userMoved,
  });
}

function stopFollowing() {
  _stopFollow?.();
  _stopFollow = null;
}

function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop")) return;  // the colour picker
  closeSettingsPanel();
}
function escClose(e) {
  if (e.key === "Escape" && _panel) {
    e.stopPropagation();
    closeSettingsPanel();
  }
}

export function closeSettingsPanel() {
  stopFollowing();
  if (_panel) {
    try {
      _panel.remove();
    } catch {}
  }
  _panel = null;
  _panelNode = null;
  _onChange = null;
  // Reset on CLOSE, not on open: resetting on open would make one dragged
  // panel teach the next one to sit still where the node is not.
  _userMoved = false;
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
  cSl.value = String(readState(node).counterDigits ?? 3);
  const cVal = el("span", "pix-si-qval", "0".repeat(parseInt(cSl.value, 10) || 3) );
  cVal.style.minWidth = "58px";
  cSl.addEventListener("input", () => {
    const n = Math.max(1, Math.min(8, parseInt(cSl.value, 10) || 3));
    cVal.textContent = "0".repeat(n);
    const st = readState(node);
    st.counterDigits = n;
    writeState(node, st);
    if (_onChange) _onChange();
  });
  cRow.appendChild(cSl);
  cRow.appendChild(cVal);
  cWrap.appendChild(cRow);
  cWrap.appendChild(el("div", "pix-si-psub", "How many digits %counter% uses (001 = 3)"));
  body.appendChild(cWrap);

  // JPG / WebP quality (one slider - both are lossy, and nobody wants two)
  const qWrap = el("div");
  const qRow = el("div", "pix-si-prow");
  qRow.appendChild(el("span", "pix-si-plab", "JPG / WebP quality"));
  const qSl = el("input", "pix-si-qsl");
  qSl.type = "range";
  qSl.min = "1";
  qSl.max = "100";
  qSl.step = "1";
  qSl.value = String(readState(node).quality ?? 100);
  const qVal = el("span", "pix-si-qval", qSl.value);
  qSl.addEventListener("input", () => {
    qVal.textContent = qSl.value;
    const st = readState(node);
    st.quality = Math.max(1, Math.min(100, parseInt(qSl.value, 10) || 100));
    writeState(node, st);
    if (_onChange) _onChange();
  });
  qRow.appendChild(qSl);
  qRow.appendChild(qVal);
  qWrap.appendChild(qRow);
  qWrap.appendChild(
    el("div", "pix-si-psub",
       "Used when the format is JPG, or WebP with lossless off. PNG is always lossless. Lower means a smaller file")
  );
  body.appendChild(qWrap);

  body.appendChild(
    switchRow(
      node,
      "webpLossless",
      "WebP lossless",
      "Only used when you pick WebP on the node - WebP can be saved two ways. Off: the quality slider decides, and a picture lands around a fifth of the PNG size with no visible change. On: it comes back pixel for pixel identical, at about three quarters of the PNG. Leave it off for pictures you post, turn it on for a master you will edit again"
    )
  );

  body.appendChild(
    switchRow(
      node,
      "print300",
      "Print resolution (300 ppi)",
      "On: PNG and JPG files say 300 ppi, so a 3000 px picture opens as 10 inches wide for print. Off: the file carries no print size and apps read it as 72 ppi, for screens. The pixels are the same either way; WebP has no place for it"
    )
  );

  body.appendChild(
    switchRow(
      node,
      "embedWorkflow",
      "Save workflow inside the image",
      "Drag the file back into ComfyUI to reload it. Works with PNG and WebP; a JPG cannot carry it back"
    )
  );

  body.appendChild(
    switchRow(
      node,
      "civitaiMeta",
      "Add Civitai generation info",
      "Also writes the model, LoRAs, steps, seed and sampler in the format Civitai reads. Keep 'Save workflow inside the image' on too, or dragging the file back rebuilds a basic graph from this info instead of your full workflow"
    )
  );

  body.appendChild(
    switchRow(
      node,
      "inputSubfolders",
      "Keep folders from the wired name",
      "Only does anything when the text wired in ALREADY contains folders, like portraits/cat: normally that is flattened to portraits_cat, and this keeps it, so a folder of subfolders comes back arranged the same way. Pair it with 'Keep folder structure in the name' on Load Images from Folder. To put every picture in a folder named after the wired text instead, use the + Input folder chip on the node"
    )
  );

  body.appendChild(
    switchRow(
      node,
      "hideBarWhenFolded",
      "Hide the toolbar when folded",
      "When folded, also tuck away the format and Copy/Open/Folder buttons"
    )
  );

  // ── which buttons the node face shows ──
  // Asked for directly: Open Folder is not useful on every system, and someone
  // who only saves PNG + WebP does not want a JPG button in the way.
  const bWrap = el("div");
  bWrap.appendChild(el("div", "pix-si-plab", "Buttons on the node"));
  bWrap.appendChild(
    el("div", "pix-si-psub", "Hide the ones you never use. Hiding a format does not change what is already selected")
  );
  const BTNS = [
    ["showOpen", "Open"],
    ["showCopy", "Copy"],
    ["showFolder", "Folder"],
    ["showPng", "PNG"],
    ["showWebp", "WebP"],
    ["showJpg", "JPG"],
  ];
  const grid = el("div", "pix-si-bgrid");
  const chips = [];
  for (const [key, label] of BTNS) {
    const c = el("button", "pix-si-bchip", label);
    c.type = "button";
    c.classList.toggle("on", readState(node)[key] !== false);
    c.title = "Show the " + label + " button on the node";
    c.addEventListener("click", () => {
      const st = readState(node);
      const next = st[key] === false; // clicking an OFF chip turns it back on
      // Never let the last format be switched off: the face would have no way
      // to change format at all. Same rule the face's visibleFormats() keeps.
      const fmtKeys = ["showPng", "showJpg", "showWebp"];
      if (!next && fmtKeys.includes(key) && fmtKeys.filter((k) => st[k] !== false).length <= 1) return;
      st[key] = next;
      writeState(node, st);
      c.classList.toggle("on", next);
      if (_onChange) _onChange();
    });
    grid.appendChild(c);
    chips.push(c);
  }
  bWrap.appendChild(grid);
  body.appendChild(bWrap);

  // the shared colour block, so this node offers the same option as the rest
  body.appendChild(createAccentSection(node, { onChange: () => _onChange?.() }));

  panel.appendChild(body);
  document.body.appendChild(panel);
  placeBeside(panel, getNodeScreenRect(node));
  startFollowing(panel, node);
  const _p = panel;
  setTimeout(() => {
    if (_panel !== _p) return; // closed within the same tick
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
}
