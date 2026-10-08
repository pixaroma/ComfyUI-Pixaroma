// Save Text Pixaroma - the floating settings panel.
//
// Structurally a copy of js/save_video/settings.mjs, deliberately: the
// placement, the follow loop, the drag, the outside-close guard and the
// accent section all carry recorded bug fixes, and a fresh implementation
// would just re-earn them. What differs is the rows.
//
// The FACE stays minimal (box, footer, four buttons). Everything a person sets
// once and forgets lives here.

import {
  readState, writeState, SEPARATOR_LABELS,
} from "./state.mjs";
import { injectCSS, el } from "./ui.mjs";
import { createAccentSection } from "../shared/node_settings.mjs";
import { pixApiUrl } from "../shared/api_url.mjs";
import { notifyGraphChanged } from "../shared/graph_changed.mjs";
import { followNode, placeBeside, getNodeScreenRect, makeDraggable } from "../shared/node_panel.mjs";

let _panel = null;
let _panelNode = null;
let _onChange = null;
let _stopFollow = null;
let _userMoved = false; // has the user dragged the panel somewhere deliberately?
let _cpHandle = null;   // an open Pixaroma colour picker, so close can take it too

function stopFollowing() {
  _stopFollow?.();
  _stopFollow = null;
}

function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  // the Pixaroma colour picker opens OUTSIDE this panel, so a click in it must
  // not dismiss the panel underneath (the accent section opens it)
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop")) return;
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
  try {
    _cpHandle?.close?.();
  } catch {}
  _cpHandle = null;
  if (_panel) {
    try {
      _panel.remove();
    } catch {}
  }
  _panel = null;
  _panelNode = null;
  _onChange = null;
  // Reset on CLOSE, not on open: resetting on open would make one dragged panel
  // teach the next one to sit still where the node is not.
  _userMoved = false;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

export function closeSettingsPanelFor(node) {
  if (_panelNode === node) closeSettingsPanel();
}

function commit(node, key, value) {
  // Fresh-read rather than writing a snapshot taken when the panel opened, so
  // one control cannot clobber an edit made by another meanwhile (the lesson
  // from Save Image review round 3).
  const st = readState(node);
  st[key] = value;
  writeState(node, st);
  notifyGraphChanged();
  _onChange?.();
}

function section(body, label, sub) {
  const wrap = el("div");
  wrap.appendChild(el("div", "pix-stx-plab", label));
  if (sub) wrap.appendChild(el("div", "pix-stx-psub", sub));
  body.appendChild(wrap);
  return wrap;
}

function switchRow(node, key, label, sub) {
  const row = el("div", "pix-stx-prow");
  const sw = el("span", "pix-stx-sw" + (readState(node)[key] ? " on" : ""));
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", String(!!readState(node)[key]));
  sw.tabIndex = 0;
  const toggle = () => {
    const on = !readState(node)[key];
    commit(node, key, on);
    sw.classList.toggle("on", on);
    sw.setAttribute("aria-checked", String(on));
  };
  sw.addEventListener("click", toggle);
  sw.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggle();
    }
  });
  const txt = el("div");
  txt.appendChild(el("div", "pix-stx-plab", label));
  txt.appendChild(el("div", "pix-stx-psub", sub));
  row.appendChild(sw);
  row.appendChild(txt);
  return row;
}

// One-of-N chip row.
function chipRow(node, key, options, onPick) {
  const row = el("div", "pix-stx-bgrid");
  const chips = [];
  const sync = () => {
    const cur = readState(node)[key];
    chips.forEach(([b, v]) => b.classList.toggle("on", v === cur));
  };
  for (const [value, label] of options) {
    const b = el("button", "pix-stx-bchip", label);
    b.type = "button";
    b.onclick = () => {
      commit(node, key, value);
      sync();
      onPick?.(value);
    };
    chips.push([b, value]);
    row.appendChild(b);
  }
  sync();
  return row;
}

export function openSettingsPanel(node, onChange) {
  closeSettingsPanel();
  injectCSS();
  _onChange = onChange || null;
  const panel = el("div", "pix-stx-panel");
  _panel = panel;
  _panelNode = node;

  const head = el("div", "pix-stx-phead");
  head.appendChild(el("span", null, "Save Text settings"));
  const x = el("button", "pix-stx-px", "✕");
  x.type = "button";
  x.onclick = closeSettingsPanel;
  head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head, {
    onUserMove: () => { _userMoved = true; },
    ignoreSelector: ".pix-stx-px",
  });

  const body = el("div", "pix-stx-pbody");

  // ── folder ──
  const fWrap = section(body, "Folder",
    "Leave it empty for ComfyUI's output folder. A folder outside ComfyUI has to " +
    "be picked with Browse once, which is what approves it.");
  const fRow = el("div", "pix-stx-prow");
  const fIn = el("input", "pix-stx-field mono");
  fIn.type = "text";
  fIn.placeholder = "output folder";
  fIn.value = readState(node).folder || "";
  fIn.title = "Type or paste a folder, or click Browse.";
  fIn.onchange = () => commit(node, "folder", fIn.value.trim());
  const browse = el("button", "pix-stx-pbtn", "Browse");
  browse.type = "button";
  browse.title = "Pick a folder with your own system dialog.";
  browse.onclick = async () => {
    browse.disabled = true;
    browse.textContent = "...";
    try {
      const r = await fetch(pixApiUrl("/pixaroma/api/load_images_folder/pick_native"));
      const j = await r.json();
      if (j?.ok && j.folder) {
        fIn.value = j.folder;
        commit(node, "folder", j.folder);
      }
    } catch {
      /* the dialog was cancelled or is unavailable; leave the field alone */
    }
    browse.disabled = false;
    browse.textContent = "Browse";
  };
  fRow.appendChild(fIn);
  fRow.appendChild(browse);
  fWrap.appendChild(fRow);

  // ── file name ──
  const nWrap = section(body, "File name",
    "Always saved as .txt. %counter% keeps the numbering going, so a new " +
    "collection never overwrites an old one.");
  const nIn = el("input", "pix-stx-field mono");
  nIn.type = "text";
  nIn.placeholder = "prompts_%counter%";
  nIn.value = readState(node).pattern || "";
  nIn.onchange = () => commit(node, "pattern", nIn.value.trim());
  nWrap.appendChild(nIn);
  const chips = el("div", "pix-stx-chips");
  const addChip = (label, token, tip) => {
    const c = el("button", "pix-stx-chip", label);
    c.type = "button";
    c.title = tip;
    c.onclick = () => {
      nIn.value = (nIn.value || "") + token;
      commit(node, "pattern", nIn.value.trim());
    };
    chips.appendChild(c);
  };
  addChip("+ Counter", "_%counter%", "A number that goes up: 001, 002, 003.");
  addChip("+ Date", "_%date:yyyy-MM-dd%", "Today's date.");
  addChip("+ Time", "_%date:hh-mm%", "The time the file was started.");
  const dateFolder = el("button", "pix-stx-chip", "+ Date folder");
  dateFolder.type = "button";
  dateFolder.title = "Put the file in a folder named after today's date.";
  dateFolder.onclick = () => {
    const cur = nIn.value || "";
    if (!cur.startsWith("%date:")) {
      nIn.value = "%date:yyyy-MM-dd%/" + cur;
      commit(node, "pattern", nIn.value.trim());
    }
  };
  chips.appendChild(dateFolder);
  nWrap.appendChild(chips);

  const prev = el("div", "pix-stx-prev");
  prev.appendChild(el("div", "pix-stx-prevlab", "Next new file"));
  const prevPath = el("div", "pix-stx-prevpath", "...");
  prev.appendChild(prevPath);
  nWrap.appendChild(prev);
  panel._pixStxPrev = prevPath; // index.js fills this in

  // ── saving ──
  body.appendChild(switchRow(node, "autoSave", "Save after every run",
    "Keeps the file matching the node without you thinking about it. Turn it off " +
    "if you would rather press Save .txt yourself."));
  body.appendChild(switchRow(node, "eachFile", "One file per entry",
    "Also saves every entry as its own .txt, named by what is wired into the " +
    "name input: wire a picture's filename from Load Images from Folder and " +
    "01_Cat.jpg gets 01_Cat.txt, handy as training captions. A file with that " +
    "name is replaced. It goes in the folder above; turn Save after every run off " +
    "to write only these files."));

  // ── how entries are added ──
  const sepWrap = section(body, "Separator",
    "What goes between two entries. Prompt Pack Pixaroma has these same three " +
    "by the same name, so a saved file drops straight into it: pick the one " +
    "there that you picked here. If your prompts themselves contain blank " +
    "lines, choose --- line: entries are split on whatever you choose here, so " +
    "a separator that appears inside a prompt splits it in two.");
  sepWrap.appendChild(chipRow(node, "separator", SEPARATOR_LABELS));

  const newWrap = section(body, "New entry goes",
    "Top puts the newest prompt where you can read it without scrolling.");
  newWrap.appendChild(chipRow(node, "newest", [["bottom", "At the bottom"], ["top", "At the top"]]));

  const dupWrap = section(body, "Skip repeats",
    "A second belt: the node already ignores a run where nothing changed. This " +
    "covers what slips past that, mainly reopening a workflow.");
  dupWrap.appendChild(chipRow(node, "skipDupes", [
    ["off", "Keep all"], ["last", "Same as last"], ["any", "Any repeat"],
  ]));

  const tsWrap = section(body, "Timestamp each entry",
    "Adds a # comment line above each entry. Off keeps the file clean for reuse.");
  tsWrap.appendChild(chipRow(node, "timestamp", [
    ["off", "Off"], ["date", "Date"], ["time", "Time"], ["datetime", "Both"],
  ]));

  // ── rollover ──
  const maxWrap = section(body, "Start a new file after",
    "Stops one workflow growing an enormous collection inside its own file. The " +
    "full one is kept and a new one carries on.");
  const maxRow = el("div", "pix-stx-prow");
  const maxSl = el("input", "pix-stx-qsl");
  maxSl.type = "range";
  maxSl.min = "0";
  maxSl.max = "2000";
  maxSl.step = "50";
  maxSl.value = String(readState(node).maxEntries ?? 500);
  const maxVal = el("span", "pix-stx-qval", "");
  const showMax = () => {
    const v = parseInt(maxSl.value, 10);
    maxVal.textContent = v === 0 ? "never" : `${v} entries`;
  };
  showMax();
  maxSl.oninput = () => {
    commit(node, "maxEntries", parseInt(maxSl.value, 10));
    showMax();
  };
  maxRow.appendChild(maxSl);
  maxRow.appendChild(maxVal);
  maxWrap.appendChild(maxRow);

  // ── counter digits ──
  const cdWrap = section(body, "Counter digits", "How many digits %counter% uses (001 = 3).");
  const cdRow = el("div", "pix-stx-prow");
  const cdSl = el("input", "pix-stx-qsl");
  cdSl.type = "range";
  cdSl.min = "1";
  cdSl.max = "8";
  cdSl.step = "1";
  cdSl.value = String(readState(node).counterDigits ?? 3);
  const cdVal = el("span", "pix-stx-qval", "");
  const showCd = () => {
    cdVal.textContent = "1".padStart(parseInt(cdSl.value, 10), "0");
  };
  showCd();
  cdSl.oninput = () => {
    commit(node, "counterDigits", parseInt(cdSl.value, 10));
    showCd();
  };
  cdRow.appendChild(cdSl);
  cdRow.appendChild(cdVal);
  cdWrap.appendChild(cdRow);

  // ── accent colour (convention #19) ──
  // Pass NO title: `title` is what the helper puts in the "New <X> nodes"
  // BUTTON, and it already reads "Save Text" from the registerNodeSettings
  // registry. Passing one here produces "New Button colour nodes".
  body.appendChild(createAccentSection(node, {
    onChange: () => _onChange?.(),
    onPickerOpen: (h) => { _cpHandle = h; },
  }));

  panel.appendChild(body);
  document.body.appendChild(panel);
  placeBeside(panel, getNodeScreenRect(node));
  _stopFollow = followNode(panel, node, {
    isCurrent: () => _panel === panel,
    isUserMoved: () => _userMoved,
  });

  // deferred so the click that OPENED the panel does not immediately close it
  setTimeout(() => {
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
  return panel;
}

// index.js calls this after it resolves the next file name, so the panel's
// preview line stays in step with the node's footer.
export function setPanelPreview(node, text, denied) {
  // The panel is a SINGLETON, but the callers are per-node async continuations
  // (a debounced counter lookup that resolves ~350ms later). Without this owner
  // check, node A's resolved file name could land in a panel that by then
  // belongs to node B - showing one node's next filename while editing
  // another's settings.
  if (!_panel || _panelNode !== node) return;
  const p = _panel._pixStxPrev;
  if (!p) return;
  p.textContent = text || "...";
  p.classList.toggle("denied", !!denied);
}
