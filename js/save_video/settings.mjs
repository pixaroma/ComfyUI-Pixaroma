// Save Video Pixaroma - the floating settings panel.
//
// Same shape as Save Image's: a draggable card that opens BESIDE the node and
// FOLLOWS it as the canvas is zoomed or panned (convention #29). The placement,
// follow loop and drag come from js/shared/node_panel.mjs, which carries the
// two bug fixes they earned; this file owns only its singleton state and rows.

import {
  readState, writeState, FORMATS, formatDef, visibleFormats, qualityToCrf, qualityLabel,
} from "./state.mjs";
import { injectCSS, el } from "./ui.mjs";
import { createAccentSection } from "../shared/node_settings.mjs";
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
  // take any open colour picker down with us, or Escape leaves it stranded on
  // document.body with no panel behind it
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

// onRemoved hook: only close the panel when it belongs to the deleted node.
export function closeSettingsPanelFor(node) {
  if (_panelNode === node) closeSettingsPanel();
}

export function isPanelOpenFor(node) {
  return _panelNode === node && !!_panel;
}

function switchRow(node, key, label, sub) {
  const row = el("div", "pix-sv-prow");
  const sw = el("span", "pix-sv-sw" + (readState(node)[key] ? " on" : ""));
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", String(!!readState(node)[key]));
  sw.tabIndex = 0;
  const toggle = () => {
    const st = readState(node);
    st[key] = !st[key];
    writeState(node, st);
    sw.classList.toggle("on", st[key]);
    sw.setAttribute("aria-checked", String(!!st[key]));
    _onChange?.();
  };
  sw.addEventListener("click", toggle);
  sw.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggle();
    }
  });
  const txt = el("div");
  txt.appendChild(el("div", "pix-sv-plab", label));
  txt.appendChild(el("div", "pix-sv-psub", sub));
  row.appendChild(sw);
  row.appendChild(txt);
  return row;
}

function section(body, label, sub) {
  const wrap = el("div");
  wrap.appendChild(el("div", "pix-sv-plab", label));
  if (sub) wrap.appendChild(el("div", "pix-sv-psub", sub));
  body.appendChild(wrap);
  return wrap;
}

export function openSettingsPanel(node, onChange) {
  closeSettingsPanel();
  injectCSS();
  _onChange = onChange || null;
  const panel = el("div", "pix-sv-panel");
  _panel = panel;
  _panelNode = node;

  const head = el("div", "pix-sv-phead");
  head.appendChild(el("span", null, "Save Video settings"));
  const x = el("button", "pix-sv-px", "✕");
  x.type = "button";
  x.onclick = closeSettingsPanel;
  head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head, {
    onUserMove: () => { _userMoved = true; },
    ignoreSelector: ".pix-sv-px",
  });

  const body = el("div", "pix-sv-pbody");

  // ── date style ──
  const dateWrap = section(body, "Date style",
    "The order the + Date chip inserts (MM month, dd day)");
  const dateRow = el("div", "pix-sv-bgrid");
  for (const style of ["yyyy-MM-dd", "dd-MM-yyyy", "MM-dd-yyyy"]) {
    const b = el("button", "pix-sv-bchip", style);
    b.type = "button";
    if (readState(node).dateStyle === style) b.classList.add("on");
    b.onclick = () => {
      const st = readState(node);
      st.dateStyle = style;
      writeState(node, st);
      for (const sib of dateRow.children) sib.classList.toggle("on", sib.textContent === style);
      _onChange?.();
    };
    dateRow.appendChild(b);
  }
  dateWrap.appendChild(dateRow);

  // ── counter digits ──
  const cdWrap = section(body, "Counter digits", "How many digits %counter% uses (001 = 3)");
  const cdRow = el("div", "pix-sv-prow");
  const cdSl = el("input", "pix-sv-qsl");
  cdSl.type = "range";
  cdSl.min = "1";
  cdSl.max = "8";
  cdSl.step = "1";
  cdSl.value = String(readState(node).counterDigits ?? 3);
  const cdVal = el("span", "pix-sv-qval", "");
  const showCd = () => {
    cdVal.textContent = "1".padStart(parseInt(cdSl.value, 10), "0");
  };
  showCd();
  cdSl.oninput = () => {
    const st = readState(node);
    st.counterDigits = parseInt(cdSl.value, 10);
    writeState(node, st);
    showCd();
    _onChange?.();
  };
  cdRow.appendChild(cdSl);
  cdRow.appendChild(cdVal);
  cdWrap.appendChild(cdRow);

  // ── audio fade-in ──
  // AI video models (MiniMax H3 and friends) start their sound at full level in
  // a single step, which is heard as a click at the top of every clip. It is the
  // model, not the encoder - measured on the raw audio before it reaches ffmpeg -
  // and it cannot be prompted away. A short fade hides it: measured on a real
  // clip the opening step went 0.157 -> 0.072 at 60ms -> 0.036 at 120ms, while
  // 30ms was too short to help because the sound only starts at 20ms.
  // OFF by default on purpose: this node is also used to re-save an existing
  // video, and fading somebody's own sound track uninvited would be wrong.
  const afWrap = section(body, "Audio fade-in",
    "Fades the sound in at the very start. AI video clips often begin with a "
    + "click; about 120 removes it and is too short to hear as a fade. Leave at "
    + "0 when re-saving audio you do not want altered.");
  const afRow = el("div", "pix-sv-prow");
  const afSl = el("input", "pix-sv-qsl");
  afSl.type = "range";
  afSl.min = "0";
  afSl.max = "500";
  afSl.step = "10";
  afSl.value = String(readState(node).audioFadeMs ?? 0);
  const afVal = el("span", "pix-sv-qval", "");
  const showAf = () => {
    const v = parseInt(afSl.value, 10);
    afVal.textContent = v > 0 ? `${v} ms` : "off";
  };
  showAf();
  afSl.oninput = () => {
    const st = readState(node);
    st.audioFadeMs = parseInt(afSl.value, 10);
    writeState(node, st);
    showAf();
    _onChange?.();
  };
  afRow.appendChild(afSl);
  afRow.appendChild(afVal);
  afWrap.appendChild(afRow);

  // ── quality ──
  // Shown as 1-100 because the encoder's own number (CRF) runs BACKWARDS, which
  // is a bad thing to put in front of anyone. The CRF is printed beside it so
  // someone who knows the term can still see what it maps to; qualityToCrf is a
  // mirror of the Python, so the number shown is the number used.
  const qWrap = section(body, "Quality",
    "Not a percentage: video is always compressed, so there is no setting that " +
    "keeps the frames untouched. High is the point where you cannot see the " +
    "difference, and it is what Save Mp4 Pixaroma uses too. Going higher mostly " +
    "grows the file.");
  const qRow = el("div", "pix-sv-prow");
  const qSl = el("input", "pix-sv-qsl");
  qSl.type = "range";
  qSl.min = "1";
  qSl.max = "100";
  qSl.step = "1";
  qSl.value = String(readState(node).quality ?? 75);
  const qVal = el("span", "pix-sv-qval", "");
  const showQ = () => {
    const st = readState(node);
    // the WORD is the readout; the encoder's own number stays available on hover
    // for anyone who knows what CRF means, without teaching a backwards scale
    qVal.textContent = `${qSl.value} · ${qualityLabel(qSl.value)}`;
    qVal.title = `Encoder setting: CRF ${qualityToCrf(qSl.value, st.format)} (lower is higher quality)`;
    qSl.title = qVal.title;
  };
  showQ();
  qSl.oninput = () => {
    const st = readState(node);
    st.quality = parseInt(qSl.value, 10);
    writeState(node, st);
    showQ();
    _onChange?.();
  };
  qRow.appendChild(qSl);
  qRow.appendChild(qVal);
  qWrap.appendChild(qRow);

  // ── colour depth ──
  // Only MP4 HQ can do 10-bit. MP4 is H.264, and 10-bit H.264 (High 10) has no
  // hardware decoder anywhere, so it is deliberately not offered - the chips go
  // dim rather than lying about what the file will be.
  const depthWrap = section(body, "Colour depth",
    "10-bit keeps gradients like skies and fades smooth instead of banding. " +
    "Only MP4 HQ can do it; MP4 is always 8-bit so it plays everywhere.");
  const depthRow = el("div", "pix-sv-bgrid");
  const depthChips = {};
  for (const d of [8, 10]) {
    const b = el("button", "pix-sv-bchip", d + "-bit");
    b.type = "button";
    depthChips[d] = b;
    b.onclick = () => {
      const st = readState(node);
      st.bitDepth = d;
      writeState(node, st);
      syncDepth();
      _onChange?.();
    };
    depthRow.appendChild(b);
  }
  depthWrap.appendChild(depthRow);
  const depthNote = el("div", "pix-sv-psub", "");
  depthWrap.appendChild(depthNote);
  const syncDepth = () => {
    const st = readState(node);
    const canTen = formatDef(st.format).tenBit;
    const effective = canTen && (st.bitDepth ?? 10) >= 10 ? 10 : 8;
    for (const d of [8, 10]) {
      depthChips[d].classList.toggle("on", effective === d);
      depthChips[d].disabled = d === 10 && !canTen;
    }
    depthNote.textContent = canTen
      ? ""
      : "MP4 is 8-bit. Switch to MP4 HQ on the node to use 10-bit.";
    showQ(); // the CRF depends on the format too
  };
  syncDepth();

  // ── switches ──
  body.appendChild(switchRow(node, "trimToAudio", "Trim to audio",
    "End the video exactly where the sound ends, for when the audio is the master. " +
    "Off keeps every frame and the sound simply stops when it stops. On can drop " +
    "the last frame or two."));
  body.appendChild(switchRow(node, "embedWorkflow", "Save workflow inside the video",
    "Writes the whole workflow into the mp4, so you can drag the video back onto the " +
    "canvas later and get the graph back, exactly like dragging a PNG. Stored the same " +
    "way ComfyUI's own video saving stores it, so ComfyUI reads it back on its own."));
  body.appendChild(switchRow(node, "hideBarWhenFolded", "Hide the toolbar when folded",
    "When folded, also tuck away the format and Open/Download/Folder buttons."));

  // ── which buttons the face shows ──
  const bWrap = section(body, "Buttons on the node",
    "Hide the ones you never use. Hiding a format does not change what is already selected.");
  const bGrid = el("div", "pix-sv-bgrid");
  const BUTTONS = [
    { key: "showOpen", label: "Open" },
    { key: "showDownload", label: "Download" },
    { key: "showFolder", label: "Folder" },
    ...FORMATS.map((f) => ({ key: f.key, label: f.label, isFormat: true })),
  ];
  const chips = {};
  const syncChips = () => {
    const st = readState(node);
    const shown = visibleFormats(st);
    for (const b of BUTTONS) {
      chips[b.key].classList.toggle("on", st[b.key] !== false);
      // the LAST remaining format cannot be switched off, or the face would
      // have no way to change format at all
      chips[b.key].disabled =
        !!b.isFormat && shown.length === 1 && shown[0].key === b.key;
    }
  };
  for (const b of BUTTONS) {
    const chip = el("button", "pix-sv-bchip", b.label);
    chip.type = "button";
    chips[b.key] = chip;
    chip.onclick = () => {
      const st = readState(node);
      st[b.key] = st[b.key] === false;
      writeState(node, st);
      syncChips();
      _onChange?.();
    };
    bGrid.appendChild(chip);
  }
  syncChips();
  bWrap.appendChild(bGrid);

  // ── accent colour (convention #19) ──
  // Pass NO title/label/hint: `title` is what the helper puts in the "New <X>
  // nodes" BUTTON, not the row label, and it already reads "Save Video" from
  // the registerNodeSettings registry. Passing title:"Button colour" here
  // produced a button reading "New Button colour nodes" (caught in testing).
  // The row label and hint already default to exactly what Save Image shows.
  body.appendChild(createAccentSection(node, {
    onChange: () => _onChange?.(),
    // keep the picker's handle so closing this panel takes it down too -
    // Escape closes the panel, and without this the picker would be stranded
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
