// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Monitor Pixaroma - the floating settings panel                          ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Copied from js/save_video/settings.mjs rather than written from the helper
// signatures, which is the rule in .claude/patterns/node-settings-accent.md:
// building one from scratch shipped three bugs in one file that every other
// panel had already solved (the ✕ swallowed by the drag handle, the gear that
// could not toggle it shut, and a canvas click that could not close it because
// LiteGraph preventDefaults the pointerdown and mousedown never fires).
//
// This is where "add or remove stuff" lives: every readout, every button and the
// layout are switched on and off here, and the node face is rebuilt from the
// same state the moment anything changes.

import { el, injectCSS } from "./ui.mjs";
import {
  readState, writeState, BARS, SCALARS, BUTTONS, DEFAULT_STATE, MIN_S, MAX_S, deviceLabel,
} from "./core.mjs";
import { createAccentSection, applyAccent } from "../shared/node_settings.mjs";
import { followNode, placeBeside, getNodeScreenRect, makeDraggable } from "../shared/node_panel.mjs";
import { lastSample } from "./poll.mjs";

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

// The node whose panel an OUTSIDE CLICK last dismissed, and when. The face's own
// Settings button needs it: in the classic renderer that button is painted on
// the canvas, so pressing it IS an outside pointerdown and closes the panel
// before LiteGraph has even routed the click to the node. Without this the
// button could open the panel but never close it again (see index.js).
let _lastOutsideClose = { node: null, at: 0 };

export function justClosedByOutsideClick(node, withinMs = 400) {
  return _lastOutsideClose.node === node && Date.now() - _lastOutsideClose.at < withinMs;
}

function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  // the colour picker opens on document.body, OUTSIDE this panel, so a click in
  // it must not dismiss the panel underneath
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop, .pix-nset-pop")) return;
  // the gear that opened us acts on click; without this exemption the panel
  // closes on its pointerdown and instantly reopens
  if (e.target.closest?.(".pix-nset-gear, [data-pix-monitor-gear]")) return;
  // the face's OWN buttons (Nodes 2.0, where they are real DOM): pressing Free
  // VRAM should not dismiss the panel, and Settings toggles it through
  // openSettingsPanel's was-open check instead
  if (e.target.closest?.(".pix-mon-btn")) return;
  _lastOutsideClose = { node: _panelNode, at: Date.now() };
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
  // Reset on CLOSE, not on open: on open it would teach the next panel to sit
  // where a previous one was dragged, away from its own node.
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

// ── small builders ──────────────────────────────────────────────────────────

function section(body, label, sub) {
  const wrap = el("div", "pix-mon-sect");
  if (label) wrap.appendChild(el("div", "pix-mon-plab", label));
  if (sub) wrap.appendChild(el("div", "pix-mon-psub", sub));
  body.appendChild(wrap);
  return wrap;
}

function chipRow(wrap, items, isOn, onPick, isDisabled) {
  const grid = el("div", "pix-mon-bgrid");
  const chips = {};
  const sync = () => {
    for (const it of items) {
      chips[it.key].classList.toggle("on", !!isOn(it));
      chips[it.key].disabled = !!isDisabled?.(it);
    }
  };
  for (const it of items) {
    const b = el("button", "pix-mon-bchip", it.label);
    b.type = "button";
    if (it.hint) b.title = it.hint;
    chips[it.key] = b;
    b.onclick = () => {
      onPick(it);
      sync();
      // Same contract as switchRow/sliderRow: the node must be resized and
      // re-rendered to fit what was just chosen. This was MISSING here, so
      // toggling Layout/Show/Buttons changed the state but never the node -
      // in classic the leftover height was then re-read as a BIGGER scale
      // (the height carries the scale), so hiding rows made the remaining
      // ones grow instead of the box shrinking (review finding, 2026-08-24).
      _onChange?.();
    };
    grid.appendChild(b);
  }
  sync();
  wrap.appendChild(grid);
  return sync;
}

function switchRow(wrap, node, key, label, sub, after) {
  const row = el("div", "pix-mon-prow");
  const sw = el("span", "pix-mon-sw" + (readState(node)[key] ? " on" : ""));
  // the KNOB. The CSS styles `.pix-mon-sw i` but nothing created it, so every
  // switch rendered as a bare orange pill with no visible on/off state
  // (user-reported with a screenshot, 2026-08-24)
  sw.appendChild(el("i"));
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", String(!!readState(node)[key]));
  sw.tabIndex = 0;
  const toggle = () => {
    const st = writeState(node, { [key]: !readState(node)[key] });
    sw.classList.toggle("on", !!st[key]);
    sw.setAttribute("aria-checked", String(!!st[key]));
    after?.(st);
    _onChange?.();
  };
  sw.addEventListener("click", toggle);
  sw.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggle();
    }
  });
  const txt = el("div", "pix-mon-ptxt");
  txt.appendChild(el("div", "t", label));
  if (sub) txt.appendChild(el("div", "s", sub));
  row.appendChild(sw);
  row.appendChild(txt);
  wrap.appendChild(row);
  return row;
}

function sliderRow(wrap, { min, max, step, value, format, onInput }) {
  const row = el("div", "pix-mon-prow");
  const sl = el("input", "pix-mon-qsl");
  sl.type = "range";
  sl.min = String(min);
  sl.max = String(max);
  sl.step = String(step);
  sl.value = String(value);
  const out = el("span", "pix-mon-qval");
  const show = () => {
    out.textContent = format(Number(sl.value));
    const f = ((Number(sl.value) - min) / (max - min)) * 100;
    sl.style.setProperty("--fill", f + "%");
  };
  show();
  sl.oninput = () => {
    onInput(Number(sl.value));
    show();
    _onChange?.();
  };
  row.appendChild(sl);
  row.appendChild(out);
  wrap.appendChild(row);
  return show;
}

// ── the panel ───────────────────────────────────────────────────────────────

export function openSettingsPanel(node, onChange) {
  const wasOpen = isPanelOpenFor(node);
  closeSettingsPanel();
  if (wasOpen) return null;   // the gear is a toggle
  injectCSS();
  _onChange = onChange || null;

  const panel = el("div", "pix-mon-panel");
  _panel = panel;
  _panelNode = node;
  applyAccent(panel, node);   // a body-level panel does not inherit the node's var

  const head = el("div", "pix-mon-phead");
  head.appendChild(el("span", null, "Monitor settings"));
  const x = el("button", "pix-mon-px", "✕");
  x.type = "button";
  x.onclick = closeSettingsPanel;
  head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head, {
    onUserMove: () => { _userMoved = true; },
    ignoreSelector: ".pix-mon-px",
  });

  const body = el("div", "pix-mon-pbody");

  // ── layout ──
  const lWrap = section(body, "Layout");
  chipRow(
    lWrap,
    [
      { key: "bars", label: "Bars", hint: "The full dashboard: one bar per readout." },
      { key: "strip", label: "Strip", hint: "One compact line, for parking in a corner of the canvas." },
    ],
    (it) => readState(node).layout === it.key,
    (it) => writeState(node, { layout: it.key }),
  );

  // ── which readouts ──
  const sWrap = section(body, "Show",
    "A readout with nothing behind it stays hidden: GPU load, temperature and power need an NVIDIA card.");
  const showItems = [...BARS, ...SCALARS];
  chipRow(
    sWrap,
    showItems,
    (it) => readState(node).show[it.key] !== false,
    (it) => writeState(node, { show: { [it.key]: readState(node).show[it.key] === false } }),
  );

  // ── which buttons ──
  const bWrap = section(body, "Buttons on the node",
    "Free VRAM is ComfyUI's own Free model and node cache, so it can never do anything ComfyUI would not do to itself.");
  chipRow(
    bWrap,
    BUTTONS,
    (it) => readState(node).buttons[it.key] !== false,
    (it) => writeState(node, { buttons: { [it.key]: readState(node).buttons[it.key] === false } }),
  );

  // ── size ──
  const zWrap = section(body, "Size",
    "In the classic node interface you can also just drag the bottom corner.");
  sliderRow(zWrap, {
    min: MIN_S, max: MAX_S, step: 0.25, value: readState(node).scale || 1,
    format: (v) => v.toFixed(2).replace(/\.?0+$/, "") + "x",
    onInput: (v) => writeState(node, { scale: v }),
  });

  // ── update rate ──
  const uWrap = section(body, "Update");
  sliderRow(uWrap, {
    min: 250, max: 5000, step: 250, value: readState(node).interval || 1000,
    format: (v) => (v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 2 : 0) + " s" : v + " ms"),
    onInput: (v) => writeState(node, { interval: v }),
  });
  switchRow(uWrap, node, "fastWhileRunning", "Sample faster while running",
    "Three times faster during a run, so the peak mark catches the real high point.");
  switchRow(uWrap, node, "pauseHidden", "Pause on another browser tab",
    "Stop asking the server for numbers nobody is looking at.");

  // ── appearance ──
  const aWrap = section(body, "Appearance");
  switchRow(aWrap, node, "warn", "Warn when memory gets tight",
    "Bars turn amber past 85% and red past 95%, so colour on this node only ever means one thing.");
  switchRow(aWrap, node, "showTitle", "Show the card name",
    "The small line at the top with the graphics card and the live dot.");

  // ── which card (only when there is more than one) ──
  const sample = lastSample();
  const devs = sample?.devices || [];
  if (devs.length > 1) {
    const dWrap = section(body, "Graphics card",
      "This machine has more than one. Each monitor watches one card.");
    chipRow(
      dWrap,
      devs.map((d, i) => ({ key: String(i), label: deviceLabel(d) || "GPU " + i })),
      (it) => String(readState(node).device || 0) === it.key,
      (it) => writeState(node, { device: Number(it.key) }),
    );
  }

  // ── reset ──
  const rWrap = section(body, "Reset");
  const rBtn = el("button", "pix-mon-bchip", "Back to the defaults");
  rBtn.type = "button";
  rBtn.title = "Put every setting on this monitor back to how it started. The colour is left alone.";
  rBtn.onclick = () => {
    const keep = readState(node).scale;
    writeState(node, { ...DEFAULT_STATE, scale: keep });
    // apply the restored rows to the node BEFORE closing - closeSettingsPanel
    // nulls _onChange, and opening a panel deliberately applies nothing
    _onChange?.();
    closeSettingsPanel();
    _panelSoftReopen(node, onChange);
  };
  rWrap.appendChild(rBtn);

  // ── accent colour (convention #19) ──
  // No title/label/hint: `title` is what the helper puts in the "New <X> nodes"
  // BUTTON, and it already reads "Monitor" from the registry.
  body.appendChild(createAccentSection(node, {
    onChange: () => {
      // re-tint THIS panel's own chrome too - applyAccent ran once at open, so
      // without this the node recolours live while the open panel keeps the old
      // colour until reopened (review finding, 2026-08-24)
      try {
        if (_panel) applyAccent(_panel, node);
      } catch (_e) {}
      _onChange?.();
    },
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
  // Deliberately NO _onChange call here: opening a panel is looking, not
  // changing, and syncSize's height recompute can differ from a drag-set height
  // by 1px (the committed scale is rounded to 2dp), so an apply-on-open
  // rewrote node.size and flagged an untouched workflow modified from merely
  // viewing the settings (review finding, 2026-08-24; measured 201 -> 202).
  return panel;
}

// Rebuild the panel after a reset, so the controls show the restored values.
// Deferred by a tick: closeSettingsPanel has just cleared the listeners, and
// reopening inside the same click would trip the open guard.
function _panelSoftReopen(node, onChange) {
  setTimeout(() => openSettingsPanel(node, onChange), 0);
}
