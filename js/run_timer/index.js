import { app } from "/scripts/app.js";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { api } from "/scripts/api.js";
import { isVueNodes, applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { createPixaromaColorPicker } from "../shared/color_picker.mjs";

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Run Timer Pixaroma — a stopwatch for the whole workflow               ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// Frontend-only node (never runs in Python). It listens to ComfyUI's run
// events: on execution_start it resets to zero and counts up live; on finish
// it freezes the total and plays a chime. The node body is JUST the clock;
// every setting (chime on/off, sound, volume, decimals, clock color) lives in
// a floating panel opened from the node's right-click menu. State is stored on
// node.properties.runTimerState — serialized natively, restored on load.
//
// The last FINISHED total is ALSO persisted (node.properties.runTimerLastMs) so
// it survives a workflow-tab switch / page reload instead of resetting to zero
// (the live _rtDisplayMs field is torn down with the node — Preview Image
// Pattern #4). A finished run writes it, so the workflow flags "modified" —
// accepted, exactly like Preview Image / Save Mp4. The restore path only READS
// it, so a plain open never dirties the workflow (Vue Compat #18).
//
// Built for BOTH renderers (the dot-less DOM-widget sizing recipe + the
// floating settings panel are the Group Switch pattern).

const BRAND = "#f66744";
const NODE_NAME = "PixaromaRunTimer";
const STATE_PROP = "runTimerState";

const NODE_W = 240;     // default body width on a fresh drop
const MIN_W = 200;      // resize floor — keeps the widest readout (00:00:000) un-clipped
const CLOCK_H = 84;     // body height (constant — single centered clock line)
const VUE_CHROME = 52;  // Nodes 2.0 only: node.size[1] = body + footer chip + borders
const DEFAULT_BARE_SETTING = "Pixaroma.RunTimer.DefaultBare"; // new timers start bare

// LiteGraph's title-bar height (used to compensate the reserved title space that
// Nodes 2.0 keeps in bare mode). Read lazily — window.LiteGraph isn't ready at
// module load.
function titleH() {
  return (typeof window !== "undefined" && window.LiteGraph && window.LiteGraph.NODE_TITLE_HEIGHT) || 30;
}

const DEFAULT_STATE = {
  version: 1,
  color: BRAND,   // clock digit color
  decimals: 0,    // 0 = m:s (default), 2 = + hundredths, 3 = + milliseconds
  chime: true,    // play a sound on finish
  sound: "",      // "" = use the library default (Vista.mp3 / first file)
  volume: 70,     // 0..100
  bare: false,    // true = hide the title bar + category chip + frame (float like Label)
};

// ── DOM helper ──────────────────────────────────────────────────────────────
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }

// ── state ───────────────────────────────────────────────────────────────────
function readState(node) {
  const s = node.properties && node.properties[STATE_PROP];
  return { ...DEFAULT_STATE, ...(s && typeof s === "object" ? s : {}) };
}
function writeState(node, patch) {
  const next = { ...readState(node), ...patch };
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = next;
  return next;
}

// ── sounds (shared with Notify Pixaroma's library) ──────────────────────────
let _soundsCache = [];
let _soundsPromise = null;
function fetchSounds() {
  if (!_soundsPromise) {
    _soundsPromise = fetch("/pixaroma/api/sounds")
      .then((r) => r.json())
      .then((j) => (Array.isArray(j && j.sounds) ? j.sounds : []))
      .catch(() => []);
  }
  return _soundsPromise;
}
function defaultSound() {
  if (_soundsCache.indexOf("Vista.mp3") >= 0) return "Vista.mp3";
  return _soundsCache[0] || "";
}
async function playSound(filename, volume01) {
  if (typeof filename !== "string" || !filename) return;
  const url = `/pixaroma/assets/sounds/${encodeURIComponent(filename)}`;
  const audio = new Audio(url);
  const v = Number(volume01);
  audio.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.7;
  try { await audio.play(); }
  catch (e) { console.warn("[Run Timer Pixaroma] playback failed:", (e && e.message) || e); }
}

// ── time formatting ─────────────────────────────────────────────────────────
function pad(n, l) { n = String(n); while (n.length < l) n = "0" + n; return n; }
// Break ms into labeled groups. The fraction (hundredths / milliseconds) rides
// on the seconds group after a decimal point, so it reads as "8.886 sec"; the
// hr/min/sec labels under each group say which is which. Past an hour the layout
// becomes hr:min:sec (the fraction is dropped — it just flickers at that scale).
// Math.floor on every part is REQUIRED: ms is a float, so without it the raw
// decimals leak (e.g. "886.5999999999").
function clockParts(ms, dec) {
  if (ms >= 3600000) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return { groups: [{ num: String(h), unit: "h" }, { num: pad(m, 2), unit: "m" }, { num: pad(s, 2), unit: "s" }], frac: "" };
  }
  const mm = Math.floor(ms / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  const groups = [{ num: pad(mm, 2), unit: "m" }, { num: pad(ss, 2), unit: "s" }];
  let frac = "";
  if (dec === 3) frac = "." + pad(Math.floor(ms % 1000), 3);
  else if (dec === 2) frac = "." + pad(Math.floor((ms % 1000) / 10), 2);
  return { groups, frac };
}

// ── display ─────────────────────────────────────────────────────────────────
// Rebuild the segment STRUCTURE only when the shape changes (hour rollover or a
// decimals change); otherwise just update the numbers each frame for speed.
function paint(node) {
  const wrap = node._pixRtTime;
  if (!wrap) return;
  const parts = clockParts(node._rtDisplayMs || 0, node._pixRtDecimals ?? DEFAULT_STATE.decimals);
  const sig = parts.groups.map((g) => g.unit).join(",") + (parts.frac ? "|f" : "");
  if (node._rtShapeSig !== sig) {
    node._rtShapeSig = sig;
    wrap.innerHTML = "";
    node._rtNumEls = [];
    node._rtFracEl = null;
    parts.groups.forEach((g, i) => {
      if (i > 0) { const c = el("span", "pix-rt-colon"); c.textContent = ":"; wrap.appendChild(c); }
      const seg = el("span", "pix-rt-cseg");
      const nw = el("span", "pix-rt-numwrap");
      const num = el("span", "pix-rt-num"); num.textContent = g.num; nw.appendChild(num);
      if (parts.frac && i === parts.groups.length - 1) {
        const fr = el("span", "pix-rt-frac"); fr.textContent = parts.frac; nw.appendChild(fr);
        node._rtFracEl = fr;
      }
      const unit = el("span", "pix-rt-unit"); unit.textContent = g.unit;
      seg.appendChild(nw); seg.appendChild(unit);
      wrap.appendChild(seg);
      node._rtNumEls.push(num);
    });
  } else {
    parts.groups.forEach((g, i) => { if (node._rtNumEls && node._rtNumEls[i]) node._rtNumEls[i].textContent = g.num; });
    if (node._rtFracEl) node._rtFracEl.textContent = parts.frac;
  }
}
function setDot(node, mode) {
  node._rtDotState = mode; // the classic-bare canvas painter reads this
  if (node._pixRtDot) node._pixRtDot.className = "pix-rt-dot" + (mode === "run" ? " run" : mode === "done" ? " done" : "");
  if (!isVueNodes() && readState(node).bare) node.setDirtyCanvas && node.setDirtyCanvas(true, true);
}
function flashScreen(node) {
  const scr = node._pixRtScreen;
  if (!scr) return;
  scr.classList.remove("flash");
  void scr.offsetWidth; // reflow so the animation can replay
  scr.classList.add("flash");
}
// Apply color + decimals from state and repaint the current value.
function applyState(node) {
  const st = readState(node);
  node._pixRtDecimals = st.decimals;
  if (node._pixRtScreen) node._pixRtScreen.style.setProperty("--cc", st.color || BRAND);
  refreshClock(node);
}
// Restore the last frozen total from node.properties so a workflow-tab switch
// or page reload shows it again instead of 00:00 (the live _rtDisplayMs field
// is torn down with the node — Preview Image Pattern #4). READ-ONLY: it never
// writes node.properties, so a plain open stays dirty-on-load safe (Vue Compat
// #18). Skipped while a run is live so it can't clobber the counting value.
// A real run is a performance.now() delta (hours at most), so reject an absurd
// value from a hand-edited / corrupted / shared workflow JSON — it would render
// a garbage clock. The only legitimate writer is finishAll.
const MAX_RESTORE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — generous vs any real run
function restoreLastRun(node) {
  if (node._rtRunning) return;
  const ms = node.properties && node.properties.runTimerLastMs;
  if (typeof ms === "number" && isFinite(ms) && ms >= 0 && ms <= MAX_RESTORE_MS) node._rtDisplayMs = ms;
}

// ── run lifecycle (drives every Run Timer on the canvas) ────────────────────
const _timers = new Set();
let _rafId = null;
function loop() {
  let anyRunning = false;
  const now = performance.now();
  for (const node of _timers) {
    if (node._rtRunning) {
      anyRunning = true;
      node._rtDisplayMs = now - node._rtStart;
      refreshClock(node);
    }
  }
  _rafId = anyRunning ? requestAnimationFrame(loop) : null;
}
function ensureLoop() { if (_rafId == null) _rafId = requestAnimationFrame(loop); }

function startAll() {
  for (const node of _timers) {
    clearTimeout(node._rtDotT);
    node._rtRunning = true;
    node._rtStart = performance.now();
    node._rtDisplayMs = 0;
    setDot(node, "run");
    refreshClock(node);
  }
  if (_timers.size) ensureLoop();
}
async function maybeChime(node) {
  const st = readState(node);
  if (!st.chime) return;
  if (app.ui.settings.getSettingValue("Pixaroma.RunTimer.Muted") === true) return;
  let sound = st.sound;
  if (!sound) {
    // A very fast first run after a page load can finish before the sounds
    // list has fetched. Await the memoized fetch (no extra request) so the
    // default chime still plays; fall back to the bundled Vista.mp3 if the
    // library is somehow empty.
    if (!_soundsCache.length) _soundsCache = await fetchSounds();
    sound = defaultSound() || "Vista.mp3";
  }
  if (sound) playSound(sound, (st.volume ?? 70) / 100);
}
function finishAll(success) {
  for (const node of _timers) {
    if (!node._rtRunning) continue;   // idempotent: first finish wins
    node._rtRunning = false;
    node._rtDisplayMs = performance.now() - node._rtStart;
    // Persist the frozen total so a workflow-tab switch / reload restores it
    // (see restoreLastRun). This is a genuine run-completion write — it flags
    // the workflow "modified" (accepted, like Preview Image / Save Mp4). It is
    // NEVER written on the load path, so it stays dirty-on-load safe.
    if (!node.properties) node.properties = {};
    node.properties.runTimerLastMs = node._rtDisplayMs;
    refreshClock(node);
    setDot(node, "done");
    flashScreen(node);
    if (success) maybeChime(node);
    // The frozen total stays on screen; the dot eases back to idle.
    clearTimeout(node._rtDotT);
    node._rtDotT = setTimeout(() => setDot(node, "idle"), 2200);
  }
}

let _listenersInstalled = false;
function installRunListeners() {
  if (_listenersInstalled) return;
  _listenersInstalled = true;
  // Start: the run has begun executing.
  api.addEventListener("execution_start", () => startAll());
  // Finish: 'executing' with a null node = the queue item finished (older
  // builds), plus execution_success on newer builds. Either is a clean finish.
  api.addEventListener("executing", (e) => {
    const d = e && e.detail;
    const nodeId = (d && typeof d === "object") ? d.node : d;
    if (nodeId == null) finishAll(true);
  });
  api.addEventListener("execution_success", () => finishAll(true));
  // Error / cancel: stop the clock but do NOT chime.
  api.addEventListener("execution_error", () => finishAll(false));
  api.addEventListener("execution_interrupted", () => finishAll(false));
}

// ── settings panel (floating, draggable — Group Switch pattern) ─────────────
let _panel = null, _panelNode = null;

function section(title) {
  const s = el("div", "pix-rt-sect");
  const h = el("div", "pix-rt-sh"); h.textContent = title; s.appendChild(h);
  return s;
}
function row(label) {
  const r = el("div", "pix-rt-row");
  const l = el("span", "pix-rt-lbl"); l.textContent = label;
  r.appendChild(l);
  return r;
}
// Segmented control that updates its own active state in place (so the panel
// never needs a full rebuild on a click — that would tear down the embedded
// color picker mid-interaction).
function segmented(options, current, onPick) {
  const seg = el("div", "pix-rt-seg");
  let cur = current;
  const btns = options.map((o) => {
    const b = el("div", "pix-rt-sg" + (o.v === cur ? " on" : ""));
    b.textContent = o.label;
    b.onclick = () => {
      if (o.v === cur) return;
      cur = o.v;
      btns.forEach((bb, i) => bb.classList.toggle("on", options[i].v === cur));
      onPick(o.v);
    };
    seg.appendChild(b);
    return b;
  });
  return seg;
}
function toggle(on, onChange) {
  const t = el("span", "pix-rt-tog" + (on ? " on" : ""));
  t.appendChild(el("span", "k"));
  let state = on;
  t.onclick = (e) => { e.stopPropagation(); state = !state; t.classList.toggle("on", state); onChange(state); };
  return t;
}
function destroyPicker(node) {
  if (node && node._pixRtPicker) {
    try { node._pixRtPicker.destroy(); } catch (_e) {}
    node._pixRtPicker = null;
  }
}

// The panel is built ONCE (controls self-update) so the embedded color picker
// survives every interaction. Only opening a fresh panel rebuilds it.
function renderPanelBody(node, body) {
  destroyPicker(node);
  body.innerHTML = "";
  const st = readState(node);

  // ── Appearance (size look) ── — mirrors the Seed settings panel: this-node
  // toggle + the global new-node default.
  const aSec = section("Appearance");

  const bRow = row("This node");
  bRow.appendChild(segmented(
    [{ v: false, label: "Full" }, { v: true, label: "Compact" }],
    !!st.bare,
    (v) => { writeState(node, { bare: v }); applyBare(node); }
  ));
  aSec.appendChild(bRow);
  const bHint = el("div", "pix-rt-sublbl");
  bHint.textContent = "Compact hides the title bar, the category chip and the frame so just the clock shows (like a Label).";
  aSec.appendChild(bHint);

  const nRow = row("New Run Timers");
  const defBareNow = !!(app.ui && app.ui.settings &&
    app.ui.settings.getSettingValue(DEFAULT_BARE_SETTING) === true);
  nRow.appendChild(segmented(
    [{ v: false, label: "Full" }, { v: true, label: "Compact" }],
    defBareNow,
    (v) => { try { app.ui.settings.setSettingValueAsync(DEFAULT_BARE_SETTING, v); } catch (_e) {} }
  ));
  aSec.appendChild(nRow);
  const nHint = el("div", "pix-rt-sublbl");
  nHint.textContent = "The look every NEW Run Timer starts in. Saved globally (same as ComfyUI Settings > Pixaroma > Run Timer appearance).";
  aSec.appendChild(nHint);

  body.appendChild(aSec);

  // ── Chime ──
  const cSec = section("Chime");

  const chRow = row("Chime on finish");
  chRow.appendChild(toggle(st.chime, (on) => writeState(node, { chime: on })));
  cSec.appendChild(chRow);

  const sRow = row("Sound");
  const sel = el("select", "pix-rt-select");
  sel.addEventListener("keydown", (e) => e.stopPropagation());
  const fillSounds = () => {
    sel.innerHTML = "";
    const cur = readState(node).sound || defaultSound();
    const list = _soundsCache.length ? _soundsCache.slice() : [cur].filter(Boolean);
    // Saved sound no longer in the library: still show it (marked) so the
    // selection matches state instead of silently snapping to the first file.
    if (cur && list.indexOf(cur) === -1) list.unshift(cur);
    for (const f of list) {
      const op = el("option"); op.value = f;
      const missing = _soundsCache.length > 0 && _soundsCache.indexOf(f) === -1;
      op.textContent = f.replace(/\.[^.]+$/, "") + (missing ? " (missing)" : "");
      if (f === cur) op.selected = true;
      sel.appendChild(op);
    }
  };
  fillSounds();
  fetchSounds().then((list) => { _soundsCache = list; fillSounds(); });
  sel.onchange = () => writeState(node, { sound: sel.value });
  sRow.appendChild(sel);
  cSec.appendChild(sRow);

  const vRow = row("Volume");
  const vol = el("input", "pix-rt-vol");
  vol.type = "range"; vol.min = "0"; vol.max = "100"; vol.step = "1"; vol.value = String(st.volume);
  vol.style.setProperty("--fill", st.volume + "%");
  const vOut = el("span", "pix-rt-volout"); vOut.textContent = st.volume + "%";
  const prev = el("button", "pix-rt-prev"); prev.textContent = "▶ Preview";
  vol.addEventListener("input", () => {
    vOut.textContent = vol.value + "%";
    vol.style.setProperty("--fill", vol.value + "%");
    writeState(node, { volume: parseInt(vol.value, 10) || 0 });
  });
  prev.onclick = (e) => {
    e.stopPropagation();
    const s = readState(node);
    playSound(s.sound || defaultSound(), (s.volume ?? 70) / 100);
  };
  vRow.appendChild(vol); vRow.appendChild(vOut); vRow.appendChild(prev);
  cSec.appendChild(vRow);

  body.appendChild(cSec);

  // ── Display ──
  const dSec = section("Display");

  const dRow = row("Decimals");
  dRow.appendChild(segmented(
    [{ v: 0, label: "Off" }, { v: 2, label: "2" }, { v: 3, label: "3" }],
    st.decimals,
    (v) => { writeState(node, { decimals: v }); applyState(node); }
  ));
  dSec.appendChild(dRow);

  const colLbl = el("div", "pix-rt-sublbl"); colLbl.textContent = "Clock color";
  dSec.appendChild(colLbl);
  // Full embedded Pixaroma Color Picker — swatches + SV plane + hue + hex +
  // Reset, live-recoloring the clock as you drag (no extra clicks, no popup).
  const picker = createPixaromaColorPicker({
    initialColor: st.color || BRAND,
    resetColor: BRAND,
    onChange: (hex) => { writeState(node, { color: hex || BRAND }); applyState(node); },
  });
  node._pixRtPicker = picker;
  dSec.appendChild(picker.element);

  body.appendChild(dSec);
  requestAnimationFrame(reclampPanel);
}

// Screen-pixel rect of the node (DOM in Nodes 2.0, geometry math in legacy) so
// the panel can open BESIDE the node instead of over it. (Node Colors pattern.)
function getNodeScreenRect(node) {
  if (isVueNodes() && node && node.id != null) {
    const elx = document.querySelector('[data-node-id="' + node.id + '"]');
    if (elx) return elx.getBoundingClientRect();
  }
  const c = app.canvas;
  const ds = c && c.ds, canvasEl = c && c.canvas;
  if (!ds || !canvasEl || !node || !node.pos || !node.size) return null;
  const cr = canvasEl.getBoundingClientRect();
  const titleH = (window.LiteGraph && window.LiteGraph.NODE_TITLE_HEIGHT) || 30;
  const scale = ds.scale || 1, off = ds.offset || [0, 0];
  const left = cr.left + (node.pos[0] + off[0]) * scale;
  const top = cr.top + (node.pos[1] - titleH + off[1]) * scale;
  const width = node.size[0] * scale;
  const height = (node.size[1] + titleH) * scale;
  return { left, top, right: left + width, bottom: top + height, width, height };
}
// Place the panel just to the RIGHT of the node, flipping left / clamping into
// the viewport as needed. No rect (node off-screen) → center it.
function placeBeside(panel, rect) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = panel.offsetWidth, mh = panel.offsetHeight;
  const gap = 12, pad = 8;
  if (!rect) {
    panel.style.left = Math.max(pad, (vw - mw) / 2) + "px";
    panel.style.top = Math.max(pad, (vh - mh) / 2) + "px";
    return;
  }
  let left = rect.right + gap;
  if (left + mw > vw - pad) left = rect.left - gap - mw; // flip to the left
  if (left < pad) left = Math.max(pad, vw - mw - pad);   // last resort: pin right
  let top = rect.top;
  if (top + mh > vh - pad) top = vh - mh - pad;
  if (top < pad) top = pad;
  panel.style.left = left + "px";
  panel.style.top = top + "px";
}
function reclampPanel() {
  if (!_panel) return;
  const pad = 10;
  const h = _panel.offsetHeight;
  let top = parseFloat(_panel.style.top) || pad;
  if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;
  if (top < pad) top = pad;
  _panel.style.top = top + "px";
}
function makeDraggable(panel, handle) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".pix-rt-px")) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev) => {
      if (!panel.isConnected) { up(); return; } // panel closed mid-drag — self-detach
      panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, ev.clientX - ox)) + "px";
      panel.style.top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ev.clientY - oy)) + "px";
    };
    const up = () => { window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  });
}
function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  // Clicks inside the shared color picker popup/modal must NOT close the panel.
  if (e.target.closest && e.target.closest(".pix-cp-popup, .pix-cp-modal-backdrop")) return;
  closePanel();
}
function escClose(e) { if (e.key === "Escape" && _panel) { e.stopPropagation(); closePanel(); } }
function closePanel() {
  destroyPicker(_panelNode);
  if (_panel) { try { _panel.remove(); } catch (_e) {} }
  _panel = null; _panelNode = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}
function openPanel(node) {
  closePanel();
  injectCSS();
  const panel = el("div", "pix-rt-panel");
  _panel = panel; _panelNode = node;
  const head = el("div", "pix-rt-phead");
  const ttl = el("span"); ttl.textContent = "Run Timer settings";
  const x = el("button", "pix-rt-px"); x.textContent = "✕"; x.onclick = closePanel;
  head.appendChild(ttl); head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head);
  const body = el("div", "pix-rt-pbody");
  panel.appendChild(body);
  renderPanelBody(node, body);
  document.body.appendChild(panel);
  placeBeside(panel, getNodeScreenRect(node));
  requestAnimationFrame(reclampPanel);
  const _p = panel;
  setTimeout(() => {
    if (_panel !== _p) return; // closed within the same tick — don't orphan listeners
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
}

// ── CSS (no backticks inside the strings — convention) ──────────────────────
let _cssDone = false;
function injectCSS() {
  if (_cssDone || document.getElementById("pix-rt-css")) { _cssDone = true; return; }
  _cssDone = true;
  const s = document.createElement("style");
  s.id = "pix-rt-css";
  s.textContent = [
    // user-select:none → the digits never select as text. pointer-events is set
    // PER-RENDERER in JS (applyRootMode): none in Nodes 2.0 bare (drag + right-
    // click go through to the canvas), auto otherwise (the DOM widget stays
    // interactive). In the CLASSIC renderer bare mode the DOM widget is hidden and
    // the clock is painted straight on the canvas (onDrawForeground) so it's a real
    // canvas node — draggable + right-clickable like the Label node.
    ".pix-rt-root{display:flex;padding:6px 8px;box-sizing:border-box;width:100%;height:100%;user-select:none;-webkit-user-select:none;}",
    ".pix-rt-screen{flex:1;min-width:0;position:relative;display:flex;align-items:center;justify-content:center;background:#0c0c0e;border:1px solid #1d1d20;border-radius:8px;padding:8px;box-sizing:border-box;}",
    ".pix-rt-time{display:flex;align-items:center;justify-content:center;gap:4px;font-family:'Consolas','DejaVu Sans Mono','SF Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--cc,#f66744);}",
    ".pix-rt-cseg{display:inline-flex;align-items:flex-start;}",
    ".pix-rt-numwrap{display:inline-flex;align-items:baseline;line-height:1;}",
    ".pix-rt-num{font-size:30px;letter-spacing:1px;}",
    ".pix-rt-frac{font-size:19px;opacity:0.85;letter-spacing:0.5px;}",
    ".pix-rt-colon{font-size:30px;line-height:1;opacity:0.7;}",
    ".pix-rt-unit{font-size:13px;line-height:1;margin-left:2px;margin-top:2px;opacity:0.5;}",
    ".pix-rt-dot{position:absolute;top:8px;left:9px;width:8px;height:8px;border-radius:50%;background:#6b6b72;}",
    ".pix-rt-dot.run{background:#3ec371;animation:pixRtPulse 1s infinite;}",
    ".pix-rt-dot.done{background:#f66744;}",
    ".pix-rt-screen.flash{animation:pixRtFlash 0.6s;}",
    "@keyframes pixRtPulse{0%,100%{opacity:1;}50%{opacity:.3;}}",
    "@keyframes pixRtFlash{0%{box-shadow:0 0 0 3px var(--cc,#f66744);}100%{box-shadow:0 0 0 0 rgba(0,0,0,0);}}",
    // panel — palette matches the Pixaroma Color Picker (#1a1a1a / #444) so the
    // embedded picker blends in seamlessly.
    ".pix-rt-panel{position:fixed;z-index:10010;width:320px;max-width:94vw;background:#1a1a1a;border:1px solid #444;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.6);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;}",
    ".pix-rt-phead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #333;color:#ddd;font-size:13px;font-weight:600;cursor:move;}",
    ".pix-rt-px{border:0;background:transparent;color:#999;font-size:13px;cursor:pointer;padding:2px 7px;border-radius:4px;}",
    ".pix-rt-px:hover{color:#fff;}",
    ".pix-rt-pbody{max-height:74vh;overflow-y:auto;}",
    ".pix-rt-sect{padding:11px 12px;border-bottom:1px solid #333;}",
    ".pix-rt-sect:last-child{border-bottom:0;}",
    ".pix-rt-sh{font-size:11px;color:#888;margin-bottom:9px;}",
    ".pix-rt-row{display:flex;align-items:center;gap:10px;margin-bottom:9px;}",
    ".pix-rt-row:last-child{margin-bottom:0;}",
    ".pix-rt-lbl{flex:1;font-size:12.5px;color:#ccc;}",
    ".pix-rt-sublbl{font-size:11px;color:#888;margin:2px 0 8px;}",
    ".pix-rt-tog{width:34px;height:18px;border-radius:9px;background:#3a3a3a;position:relative;cursor:pointer;flex:none;transition:background .15s;}",
    ".pix-rt-tog .k{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#bbb;transition:left .15s,background .15s;}",
    ".pix-rt-tog.on{background:#f66744;}",
    ".pix-rt-tog.on .k{left:18px;background:#fff;}",
    ".pix-rt-select{background:#1a1a1a;border:1px solid #444;color:#ddd;border-radius:4px;font-size:12.5px;padding:5px 7px;font-family:inherit;cursor:pointer;max-width:150px;}",
    ".pix-rt-select:focus{outline:none;border-color:#f66744;}",
    // clean filled slider — no track contour, orange fill up to the thumb
    ".pix-rt-vol{-webkit-appearance:none;appearance:none;flex:1;min-width:0;height:4px;border-radius:2px;outline:none;cursor:pointer;background:linear-gradient(to right,#f66744 var(--fill,70%),#3a3a3a var(--fill,70%));}",
    ".pix-rt-vol::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:#f66744;border:2px solid #1a1a1a;cursor:pointer;}",
    ".pix-rt-vol::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:#f66744;border:2px solid #1a1a1a;cursor:pointer;}",
    ".pix-rt-vol::-moz-range-track{height:4px;border-radius:2px;background:transparent;}",
    ".pix-rt-volout{font-size:12px;color:#bbb;width:36px;text-align:right;flex:none;}",
    ".pix-rt-prev{background:transparent;border:1px solid #444;color:#ccc;border-radius:4px;font-size:12px;padding:5px 9px;cursor:pointer;flex:none;font-family:inherit;}",
    ".pix-rt-prev:hover{border-color:#f66744;color:#f66744;}",
    ".pix-rt-seg{display:flex;background:#0e0e0e;border:1px solid #333;border-radius:6px;padding:2px;flex:none;}",
    ".pix-rt-sg{min-width:42px;text-align:center;color:#aaa;font-size:12px;padding:5px 10px;border-radius:4px;cursor:pointer;user-select:none;}",
    ".pix-rt-sg.on{background:#f66744;color:#fff;}",
    // ── BARE mode (right-click "compact"): the title bar itself is removed via a
    //    per-node title_mode shadow (setBareTitle); everything below hides the
    //    frame + category chip + padding so just the floating clock remains, and
    //    makes the body click-through so the node still drags / right-clicks via
    //    the canvas (the clock is display-only; settings open from the menu).
    //    Scoped to the .pix-rt-bare marker; the .lg-node rules are Vue-only (no
    //    .lg-node element exists in legacy, so they are a no-op there).
    ".lg-node:has(.pix-rt-bare){background:transparent!important;border:none!important;box-shadow:none!important;}",
    ".lg-node:has(.pix-rt-bare) .lg-node-header{display:none!important;}",
    ".lg-node:has(.pix-rt-bare) .lg-node-content{padding:0!important;}",
    ".lg-node:has(.pix-rt-bare) [class*=\"component-node-background\"]{padding:0!important;gap:0!important;background:transparent!important;}",
    ".lg-node:has(.pix-rt-bare) [class*=\"component-node-background\"] > div:has(.bg-node-component-surface),.lg-node:has(.pix-rt-bare) .bg-node-component-surface{display:none!important;}",
    ".lg-node:has(.pix-rt-bare) > div.absolute.border:not([data-testid]){display:none!important;}",
    ".lg-node:has(.pix-rt-bare) [data-testid=\"node-state-outline-overlay\"],.lg-node:has(.pix-rt-bare) > div.absolute.outline-none{inset:-2px!important;}",
    ".lg-node:has(.pix-rt-bare) .lg-node-widgets,.lg-node:has(.pix-rt-bare) .lg-node-widgets *{pointer-events:none!important;}",
  ].join("\n");
  (document.head || document.documentElement).appendChild(s);
}

// ── node sizing (dot-less DOM-widget panel — Group Switch recipe) ───────────
function bodyHeight() { return CLOCK_H; }
// DOM-widget min height. In Nodes 2.0 BARE mode we keep title_mode NORMAL (the
// reactive Vue node keeps reserving ~30px of title height regardless — a live
// title_mode shadow does NOT clear it, verified), and instead shrink node.size by
// that reserve so the rendered element lands back at the clock body. So the bare
// Vue floor is bodyHeight - titleH; everything else is the full body.
function widgetMinHeight(node) {
  return (isVueNodes() && readState(node).bare) ? Math.max(20, bodyHeight() - titleH()) : bodyHeight();
}
function refreshNodeSize(node) {
  if (isGraphLoading()) return;
  try {
    if (typeof node.setSize !== "function") return;
    const bare = readState(node).bare;
    let target;
    if (isVueNodes()) {
      // Normal = clock body + chrome (footer chip + borders). Bare = clock body
      // MINUS the reserved title height (Nodes 2.0 still reserves it — the copy is
      // stale), so element = node.size + reserve lands at the clock body. A
      // CONSTANT, so it stays correct across save / load / toggle.
      target = bare ? Math.max(20, bodyHeight() - titleH()) : bodyHeight() + VUE_CHROME;
    } else {
      target = (typeof node.computeSize === "function" ? node.computeSize()[1] : bodyHeight());
    }
    if (Math.abs((node.size[1] || 0) - target) > 1) node.setSize([node.size[0], target]);
  } catch (_e) {}
}

// ── bare mode (right-click "compact"): hide the title bar + category chip +
//    frame so just the floating clock remains (like the Label node) ──────────
// Hide the title PER-NODE by SHADOWING the LGraphNode `title_mode` getter with an
// instance own-property. Verified against the bundle: `get title_mode(){ return
// this.constructor.title_mode ?? NORMAL_TITLE }` is read by BOTH renderers
// (legacy `measure()` reserves the title height + the draw gate; Vue's height
// calc reads `n.title_mode`), so shadowing it on the instance hides the title in
// both — without touching the shared constructor (which would affect EVERY
// Run Timer). It is NOT serialized (LiteGraph.serialize copies fixed fields, not
// arbitrary own-properties), so it never dirties a saved workflow; the persisted
// truth is state.bare, re-applied on load.
function setBareTitle(node, bare) {
  const LG = (typeof window !== "undefined" && window.LiteGraph) || {};
  // Shadow title_mode ONLY in the CLASSIC renderer. Legacy re-reads title_mode
  // fresh each draw (measure() reserves the title height + the draw gate), so the
  // shadow reliably removes both the title bar AND its reserved height. Nodes 2.0
  // caches title_mode in a reactive COPY that only re-reads on remount — a live
  // shadow leaves title_mode = NO_TITLE but STILL reserves the 30px (verified via
  // the diagnostic: element = node.size + 30). So in Vue we do NOT shadow: the
  // title stays NORMAL, the header is hidden via CSS, and node.size compensates
  // the constant reserve (see refreshNodeSize / widgetMinHeight).
  const wantShadow = bare && !isVueNodes();
  if (wantShadow) {
    Object.defineProperty(node, "title_mode", {
      value: LG.NO_TITLE != null ? LG.NO_TITLE : 1,
      configurable: true, writable: true, enumerable: false,
    });
  } else if (Object.prototype.hasOwnProperty.call(node, "title_mode")) {
    delete node.title_mode; // restore the prototype getter (→ NORMAL_TITLE)
  }
}
// Apply the current bare state: title shadow + the CSS marker class + a size
// re-fit. Called on setup, on load (onConfigure), and on every toggle. The size
// re-fit is gated inside refreshNodeSize (skips the load path — dirty-on-load
// safe, Vue Compat #18). Changing node.size on a toggle also forces the Vue node
// to re-render, which re-reads the shadowed title_mode (so the title hides live).
function applyBare(node) {
  const bare = !!readState(node).bare;
  setBareTitle(node, bare);
  // Drop the pack badge ("Pixaroma") in bare mode. It is canvas-painted above
  // the node in the classic renderer (CSS can't reach it) and driven by
  // node.badges (same field the Label node clears). Save + restore so un-baring
  // brings it back this session.
  if (bare) {
    if (node._pixRtBadges === undefined) node._pixRtBadges = node.badges;
    node.badges = [];
  } else if (node._pixRtBadges !== undefined) {
    node.badges = node._pixRtBadges;
    node._pixRtBadges = undefined;
  }
  if (node._pixRtRoot) node._pixRtRoot.classList.toggle("pix-rt-bare", bare);
  applyRootMode(node);
  refreshNodeSize(node);
  node.setDirtyCanvas && node.setDirtyCanvas(true, true);
  app.graph && app.graph.setDirtyCanvas && app.graph.setDirtyCanvas(true, true);
}

// Show/route the DOM clock per renderer + mode. CLASSIC BARE hides the DOM widget
// (the clock is canvas-painted via onDrawForeground → a real, draggable canvas
// node). NODES 2.0 BARE makes it click-through so drag / right-click reach the
// canvas. Everything else keeps the DOM widget interactive (unchanged).
function applyRootMode(node) {
  const root = node._pixRtRoot;
  if (!root) return;
  const bare = !!readState(node).bare;
  const vue = isVueNodes();
  if (!vue && bare) {
    root.style.display = "none";
    root.style.pointerEvents = "";
  } else {
    root.style.display = "";
    root.style.pointerEvents = (vue && bare) ? "none" : "auto";
  }
}

// Refresh the on-screen clock the right way for the node's renderer/mode: a
// canvas repaint for CLASSIC BARE (onDrawForeground redraws), else the DOM paint.
function refreshClock(node) {
  if (!isVueNodes() && readState(node).bare) {
    node.setDirtyCanvas && node.setDirtyCanvas(true, true);
  } else {
    paint(node);
  }
}

// Vertically center digit/colon text by its ACTUAL glyph box (digit-only strings
// float high with textBaseline:middle — CLAUDE.md canvas note).
function fillTextVC(ctx, text, x, yMid) {
  const m = ctx.measureText(text);
  if (m && m.actualBoundingBoxAscent != null && m.actualBoundingBoxDescent != null) {
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, yMid + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  } else {
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, yMid);
  }
}

// CLASSIC BARE: paint the whole clock (screen + digits + units + status dot)
// straight onto the node canvas, so the node is a plain canvas node — LiteGraph
// handles drag + right-click natively (like the Label node). ctx is already
// translated to the node body origin. Mirrors the DOM clock look.
function paintLegacyBareClock(node, ctx) {
  const w = node.size[0], h = node.size[1];
  const p = 2;
  const sx = p, sy = p, sw = Math.max(20, w - p * 2), sh = Math.max(20, h - p * 2);
  const rr = (x, y, ww, hh, r) => { if (ctx.roundRect) ctx.roundRect(x, y, ww, hh, r); else ctx.rect(x, y, ww, hh); };
  ctx.save();
  // screen
  ctx.fillStyle = "#0c0c0e";
  ctx.beginPath(); rr(sx, sy, sw, sh, 8); ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = "#1d1d20";
  ctx.beginPath(); rr(sx + 0.5, sy + 0.5, sw - 1, sh - 1, 7.5); ctx.stroke();
  // status dot
  const dm = node._rtDotState || "idle";
  ctx.fillStyle = dm === "run" ? "#3ec371" : dm === "done" ? "#f66744" : "#6b6b72";
  ctx.beginPath(); ctx.arc(sx + 11, sy + 11, 4, 0, Math.PI * 2); ctx.fill();
  // time
  const col = readState(node).color || BRAND;
  const parts = clockParts(node._rtDisplayMs || 0, node._pixRtDecimals != null ? node._pixRtDecimals : 0);
  const NUM = "600 30px 'Consolas','DejaVu Sans Mono',ui-monospace,monospace";
  const UNIT = "500 13px 'Consolas','DejaVu Sans Mono',ui-monospace,monospace";
  const FRAC = "600 19px 'Consolas','DejaVu Sans Mono',ui-monospace,monospace";
  const gap = 5;
  ctx.textAlign = "left";
  ctx.font = NUM; const colonW = ctx.measureText(":").width;
  const segs = parts.groups.map((g, i) => {
    ctx.font = NUM; const nw = ctx.measureText(g.num).width;
    ctx.font = UNIT; const uw = ctx.measureText(g.unit).width;
    let fw = 0;
    if (parts.frac && i === parts.groups.length - 1) { ctx.font = FRAC; fw = ctx.measureText(parts.frac).width; }
    return { g, nw, uw, fw };
  });
  let total = 0;
  segs.forEach((s, i) => { if (i > 0) total += gap * 2 + colonW; total += s.nw + s.fw + 2 + s.uw; });
  let x = sx + (sw - total) / 2;
  const midY = sy + sh / 2;
  segs.forEach((s, i) => {
    if (i > 0) {
      ctx.font = NUM; ctx.fillStyle = col; ctx.globalAlpha = 0.7;
      fillTextVC(ctx, ":", x + gap, midY); ctx.globalAlpha = 1; x += gap * 2 + colonW;
    }
    ctx.font = NUM; ctx.fillStyle = col; ctx.globalAlpha = 1;
    fillTextVC(ctx, s.g.num, x, midY); x += s.nw;
    if (s.fw) { ctx.font = FRAC; ctx.globalAlpha = 0.85; fillTextVC(ctx, parts.frac, x, midY); ctx.globalAlpha = 1; x += s.fw; }
    ctx.font = UNIT; ctx.fillStyle = col; ctx.globalAlpha = 0.5; ctx.textBaseline = "alphabetic";
    ctx.fillText(s.g.unit, x + 2, midY - 8); ctx.globalAlpha = 1; x += 2 + s.uw;
  });
  ctx.restore();
}
// Flip this node between the normal card and the bare clock (user action → a
// node.properties write is fine; never on the load path).
function toggleBare(node) {
  writeState(node, { bare: !readState(node).bare });
  applyBare(node);
}

function setupNode(node) {
  injectCSS();
  const root = el("div", "pix-rt-root");
  const screen = el("div", "pix-rt-screen");
  const dot = el("span", "pix-rt-dot");
  const time = el("div", "pix-rt-time");
  screen.appendChild(dot); screen.appendChild(time);
  root.appendChild(screen);

  node._pixRtRoot = root;
  node._pixRtScreen = screen;
  node._pixRtDot = dot;
  node._pixRtTime = time;
  node._rtDisplayMs = 0;
  node._rtRunning = false;
  node._pixRtDecimals = DEFAULT_STATE.decimals;
  paint(node); // render the initial 00:00 so the screen is not blank pre-microtask

  installCanvasZoomPassthrough(root);
  const widget = node.addDOMWidget("run_timer_ui", "pixaroma_run_timer", root, {
    getValue: () => readState(node),
    setValue: () => {},
    getMinHeight: () => widgetMinHeight(node),
    serialize: false, // state lives on node.properties
  });
  applyAdaptiveCanvasOnly(widget);
  widget.computeLayoutSize = () => ({ minHeight: widgetMinHeight(node), minWidth: 1 });
  node._pixRtFloorOff = installResizeFloor(root, () => bodyHeight());

  // Classic: hug the body (the stock computeSize reserves a phantom slot row +
  // per-widget spacing on this dot-less node). WIDTH = MIN_W (the corner-drag
  // floor, NOT the live width). Vue uses computeLayoutSize.
  if (!isVueNodes()) {
    node.computeSize = function () { return [MIN_W, bodyHeight()]; };
  }
  if (Array.isArray(node.size)) {
    if (node.size[0] < NODE_W) node.size[0] = NODE_W;
  } else {
    node.size = [NODE_W, CLOCK_H];
  }

  _timers.add(node);
  // nodeCreated fires BEFORE configure() restores node.properties (Vue Compat
  // #8) — defer so a saved timer shows its restored color/decimals AND its last
  // finished time (restoreLastRun), not defaults / 00:00.
  queueMicrotask(() => {
    // Fresh drop (no saved state): start in the look the user picked as their
    // default (a global Pixaroma setting). Restored nodes keep their saved look
    // (configure() has already set node.properties by now — Vue Compat #8).
    if (!node.properties || node.properties[STATE_PROP] == null) {
      const defBare = !!(app.ui && app.ui.settings &&
        app.ui.settings.getSettingValue(DEFAULT_BARE_SETTING) === true);
      if (defBare) writeState(node, { bare: true });
    }
    restoreLastRun(node);
    applyState(node);
    applyBare(node); // title shadow + marker class + size (includes refreshNodeSize)
  });
}

const HELP = {
  title: "Run Timer Pixaroma",
  tagline: "Times how long a workflow takes, and chimes when it is done.",
  sections: [
    { heading: "What it does", body: "The clock resets to zero the moment you press Run, counts up while the workflow is working, and freezes on the total time when it finishes. A chime plays on finish, so you know it is done even when you are in another browser tab or app." },
    { heading: "Reading the clock", body: "The time shows as minutes : seconds : hundredths (for example 02:47:38). If a run goes past an hour the clock switches to hours : minutes : seconds. A small dot in the corner is green while running and orange the moment it finishes." },
    { heading: "Comparing workflows across tabs", body: "Each workflow remembers its own last time, so you can run several workflows in different tabs and switch between them to compare how long each one took. The time you see always belongs to the workflow you are looking at, and it only resets when you run that same workflow again.", bullets: [
      "The time is saved with the workflow, so it is still there after you switch tabs, reload the page, or restart ComfyUI.",
      "Because it is saved with the workflow, a small 'unsaved changes' dot shows on the tab after a run. Switching between tabs never asks you to save; only closing a tab asks, the same as always.",
      "If you switch tabs while a run is still going, that run's time is not captured, and you will see the previous finished time when you come back. Let a run finish before switching if you want its time kept.",
    ]},
    { heading: "Settings (right-click the node)", defs: [
      ["Compact (hide title bar)", "Right-click and choose Compact to hide the title bar, the category chip, and the frame so just the clock floats on the canvas, like a Label. Choose Show title bar to bring them back. A setting (under Pixaroma, then Run Timer appearance) makes new timers start compact if you like."],
      ["Chime on finish", "Turn the finish sound on or off."],
      ["Sound and Volume", "Pick the chime from the sound library and set how loud it is. The Preview button plays it right now."],
      ["Decimals", "Show hundredths (2), milliseconds (3), or just minutes and seconds (Off)."],
      ["Clock color", "Pick the digit color right in the panel: tap a swatch, drag the color square, or type a hex code. Reset returns it to Pixaroma orange."],
    ]},
    { heading: "Good to know", body: "The node only shows the clock - all the controls are in the right-click menu. It does not need to be wired to anything; just drop it on the canvas. Add your own chimes by dropping .mp3, .wav, or .ogg files (use simple names - letters, numbers, dashes) into the assets/sounds folder. A master mute for every Run Timer lives in Settings, under Pixaroma, Run Timer." },
  ],
};

app.registerExtension({
  name: "Pixaroma.RunTimer",

  settings: [
    {
      id: "Pixaroma.RunTimer.Muted",
      name: "Mute all chimes",
      type: "boolean",
      defaultValue: false,
      tooltip: "Master switch. When on, no Run Timer plays its finish chime.",
      category: ["👑 Pixaroma", "Run Timer"],
    },
    {
      // Distinct leaf ("Run Timer (appearance)") so it doesn't collapse into the
      // Muted row (Vue Settings dedupes by deepest leaf — Align Pattern #10).
      id: DEFAULT_BARE_SETTING,
      name: "New Run Timers start bare (no title bar)",
      type: "boolean",
      defaultValue: false,
      tooltip: "New Run Timer nodes drop in the compact bare look (no title bar, category chip, or frame — just the clock). Any node can still be switched with right-click.",
      category: ["👑 Pixaroma", "Run Timer (appearance)"],
    },
  ],

  setup() {
    installRunListeners();
    fetchSounds().then((list) => { _soundsCache = list; });
  },

  getNodeMenuItems(node) {
    if (!node || node.comfyClass !== NODE_NAME) return [];
    const st = readState(node);
    // Off the 👑 crown (a frame glyph + a gear) so they stand out from the
    // crowded crown items — same rationale as the Seed menu.
    return [
      null,
      {
        content: st.bare ? "▭ Show title bar" : "▭ Compact (hide title bar)",
        callback: () => toggleBare(node),
      },
      { content: "⚙ Run Timer settings", callback: () => openPanel(node) },
    ];
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    if (nodeType.prototype._pixRtPatched) return; // hot-reload: don't double-wrap
    nodeType.prototype._pixRtPatched = true;

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure ? _origConfigure.apply(this, arguments) : undefined;
      if (this._pixRtRoot) { restoreLastRun(this); applyState(this); applyBare(this); }
      return r;
    };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      _timers.delete(this);
      clearTimeout(this._rtDotT);
      try { if (this._pixRtFloorOff) this._pixRtFloorOff(); } catch (_e) {}
      this._pixRtFloorOff = null;
      if (_panelNode === this) closePanel();
      if (_origRemoved) return _origRemoved.apply(this, arguments);
    };

    // Classic only: keep resize HORIZONTAL (width free, height locked to the
    // clock). Vue sizes via computeLayoutSize — leave it alone.
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        this.size[1] = bodyHeight();
      }
      if (_origResize) return _origResize.apply(this, arguments);
    };

    // Classic BARE: paint the clock straight onto the node canvas so it's a real
    // canvas node (drag + right-click work natively, like the Label node).
    // onDrawForeground fires reliably in the classic renderer; Nodes 2.0 skips it
    // and keeps the DOM clock.
    const _origFg = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const r = _origFg ? _origFg.apply(this, arguments) : undefined;
      if (ctx && !isVueNodes() && this.properties &&
          this.properties[STATE_PROP] && this.properties[STATE_PROP].bare) {
        try { paintLegacyBareClock(this, ctx); } catch (_e) {}
      }
      return r;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_NAME) return;
    setupNode(node);
  },
});

registerNodeHelp(NODE_NAME, HELP);
