// Prompt Each Pixaroma - the floating settings panel.
//
// Copied from js/save_video/settings.mjs rather than written from
// node_panel.mjs's signatures, per .claude/patterns/node-settings-accent.md:
// building one from scratch shipped three bugs in one file that every other
// panel had already solved. The three that matter here, all inherited:
//   - outsideClose listens for POINTERDOWN, not mousedown. LiteGraph calls
//     preventDefault() on the canvas pointerdown, which suppresses the
//     compatibility mouse events, so a mousedown handler never fires there and
//     clicking the canvas would not close the panel.
//   - makeDraggable gets ignoreSelector for the close button, or the drag
//     handle's setPointerCapture eats the click and the X does nothing.
//   - the gear is exempt from outsideClose, or clicking it again closes and
//     instantly reopens the panel.

import {
  readState, writeState, SPLIT_LINE, SPLIT_BLANK,
  WIRED_AFTER, WIRED_BEFORE, DEFAULT_CAP, MAX_CAP,
} from "./core.mjs";
import { el } from "./ui.mjs";
import { createAccentSection } from "../shared/node_settings.mjs";
import { followNode, placeBeside, getNodeScreenRect, makeDraggable } from "../shared/node_panel.mjs";

const CSS_ID = "pix-each-panel-css";

const CSS = `
.pix-each-panel {
  position: fixed; z-index: 1300; width: 330px;
  background: #2b2b2b; border: 1px solid #3a3a3a; border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0,0,0,.5);
  font-family: sans-serif; font-size: 12px; color: #e0e0e0; overflow: hidden;
}
.pix-each-phead {
  background: #232323; padding: 9px 12px; font-size: 12px; font-weight: 600;
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid #3a3a3a; cursor: move; user-select: none;
}
.pix-each-px {
  background: none; border: none; color: #999; cursor: pointer;
  font-size: 13px; line-height: 1; padding: 2px 4px;
}
.pix-each-px:hover { color: var(--pix-acc,#f66744); }
.pix-each-pbody {
  padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 11px;
  max-height: 70vh; overflow-y: auto;
}
.pix-each-plab { font-size: 11.5px; color: #ddd; font-weight: 600; }
.pix-each-psub { font-size: 10.5px; color: #8f8f8f; line-height: 1.4; margin-top: 2px; }
.pix-each-prow { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.pix-each-bgrid { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.pix-each-bchip {
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.15);
  border-radius: 3px; padding: 4px 10px; font-size: 11px;
  color: rgba(255,255,255,.72); cursor: pointer;
}
.pix-each-bchip:hover { border-color: var(--pix-acc,#f66744); color: #ddd; }
.pix-each-bchip.on {
  background: var(--pix-acc,#f66744); border-color: var(--pix-acc,#f66744); color: #fff;
}
.pix-each-sw {
  width: 32px; height: 18px; border-radius: 9px; flex: 0 0 auto; cursor: pointer;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.15);
  position: relative; transition: background .12s, border-color .12s;
}
.pix-each-sw::after {
  content: ""; position: absolute; left: 2px; top: 2px; width: 12px; height: 12px;
  border-radius: 50%; background: #8a8a8a; transition: left .12s, background .12s;
}
.pix-each-sw.on { background: var(--pix-acc,#f66744); border-color: var(--pix-acc,#f66744); }
.pix-each-sw.on::after { left: 16px; background: #fff; }
.pix-each-num {
  font: 11px monospace; background: #1d1d1d; border: 1px solid #333;
  border-radius: 4px; padding: 4px 8px; color: var(--pix-acc,#f66744);
  width: 74px; text-align: right; outline: none;
}
.pix-each-num:focus { border-color: var(--pix-acc,#f66744); }
`;

function injectPanelCSS() {
  if (document.getElementById(CSS_ID)) return;
  const s = document.createElement("style");
  s.id = CSS_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

let _panel = null;
let _panelNode = null;
let _onChange = null;
let _stopFollow = null;
let _userMoved = false;
let _cpHandle = null;

function stopFollowing() {
  _stopFollow?.();
  _stopFollow = null;
}

function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  // the colour picker opens OUTSIDE this panel, so a click in it must not
  // dismiss the panel underneath
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop, .pix-nset-pop")) return;
  // the gear that opened us: it acts on click and this fires on pointerdown, so
  // without the exemption the panel would close and instantly reopen
  if (e.target.closest?.(".pix-each-gear")) return;
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

export function isPanelOpenFor(node) {
  return _panelNode === node && !!_panel;
}

function section(body, label, sub) {
  const wrap = el("div");
  wrap.appendChild(el("div", "pix-each-plab", label));
  if (sub) wrap.appendChild(el("div", "pix-each-psub", sub));
  body.appendChild(wrap);
  return wrap;
}

function chipRow(node, wrap, key, options) {
  const row = el("div", "pix-each-bgrid");
  const sync = () => {
    const st = readState(node);
    for (const c of row.children) c.classList.toggle("on", c.dataset.value === st[key]);
  };
  for (const opt of options) {
    const b = el("button", "pix-each-bchip", opt.label);
    b.type = "button";
    b.dataset.value = opt.value;
    if (opt.title) b.title = opt.title;
    b.onclick = () => {
      const st = readState(node);
      st[key] = opt.value;
      writeState(node, st);
      sync();
      _onChange?.();
    };
    row.appendChild(b);
  }
  sync();
  wrap.appendChild(row);
  return row;
}

function switchRow(node, body, key, label, sub) {
  const wrap = el("div");
  const top = el("div", "pix-each-prow");
  const sw = el("span", "pix-each-sw" + (readState(node)[key] ? " on" : ""));
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
  txt.appendChild(el("div", "pix-each-plab", label));
  txt.appendChild(el("div", "pix-each-psub", sub));
  top.appendChild(sw);
  top.appendChild(txt);
  wrap.appendChild(top);
  body.appendChild(wrap);
  return wrap;
}

export function openSettingsPanel(node, onChange) {
  closeSettingsPanel();
  injectPanelCSS();
  _onChange = onChange || null;

  const panel = el("div", "pix-each-panel");
  _panel = panel;
  _panelNode = node;

  const head = el("div", "pix-each-phead");
  head.appendChild(el("span", null, "Prompt Each settings"));
  const x = el("button", "pix-each-px", "✕");
  x.type = "button";
  x.onclick = closeSettingsPanel;
  head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head, {
    onUserMove: () => { _userMoved = true; },
    ignoreSelector: ".pix-each-px",
  });

  const body = el("div", "pix-each-pbody");

  // ── how the text is cut into prompts ──
  const splitWrap = section(body, "Cut pasted and wired text on",
    "Only applies to text arriving in ONE block: the Paste button and the text "
    + "input. The rows you type are already separate prompts, so this never "
    + "changes them. New line makes every line a prompt; Blank line lets one "
    + "prompt run over several lines and starts the next after an empty line.");
  chipRow(node, splitWrap, "split", [
    { value: SPLIT_LINE, label: "New line", title: "Every line becomes its own prompt" },
    { value: SPLIT_BLANK, label: "Blank line", title: "An empty line starts the next prompt, so a prompt can span several lines" },
  ]);

  const wiredWrap = section(body, "Wired prompts go",
    "Prompts arriving on the text input are always ADDED to the rows, never "
    + "instead of them. This is just the order, which decides the order the "
    + "images come out in and what index each one gets.");
  chipRow(node, wiredWrap, "wiredAt", [
    { value: WIRED_AFTER, label: "After the rows", title: "The rows run first, then whatever arrives on the wire" },
    { value: WIRED_BEFORE, label: "Before the rows", title: "The wired prompts run first, then the rows" },
  ]);

  // ── switches ──
  switchRow(node, body, "expand", "Expand [a|b] into every combination",
    "A line reading 'a [red|blue] car' becomes two prompts. Several groups on one "
    + "line give every combination. Off leaves brackets as ordinary text.");
  switchRow(node, body, "trim", "Trim spaces at both ends",
    "Drops leading and trailing spaces from every prompt, so a stray space cannot "
    + "quietly change the result.");
  switchRow(node, body, "skipEmpty", "Skip empty lines",
    "An empty line is ignored rather than queueing a run with no prompt. Turning "
    + "this off is almost never what you want.");

  // ── the cap ──
  // The rail that matters: three bracket groups of four options on ONE line is
  // 64 prompts, and nothing on screen warns you before Run. Expansion also stops
  // at a hard internal ceiling, so a typo cannot lock up the browser either.
  const capWrap = section(body, "Stop after",
    "The most prompts one Run is allowed to queue. Bracket groups multiply fast: "
    + "three groups of four options on one line is already 64 prompts.");
  const capRow = el("div", "pix-each-prow");
  const capInput = el("input", "pix-each-num");
  capInput.type = "number";
  capInput.min = "1";
  capInput.max = String(MAX_CAP);
  capInput.step = "1";
  capInput.value = String(readState(node).cap ?? DEFAULT_CAP);
  const commitCap = () => {
    const st = readState(node);
    let v = parseInt(capInput.value, 10);
    if (!isFinite(v)) v = DEFAULT_CAP;
    v = Math.max(1, Math.min(MAX_CAP, v));
    capInput.value = String(v);
    st.cap = v;
    writeState(node, st);
    _onChange?.();
  };
  capInput.addEventListener("change", commitCap);
  capInput.addEventListener("blur", commitCap);
  capRow.appendChild(capInput);
  capRow.appendChild(el("span", "pix-each-psub", "prompts per Run"));
  capWrap.appendChild(capRow);

  // ── accent colour (convention #19) ──
  // Pass NO title here: `title` is what the helper puts in the "New <X> nodes"
  // button, and it already reads "Prompt Each" from the registry.
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
