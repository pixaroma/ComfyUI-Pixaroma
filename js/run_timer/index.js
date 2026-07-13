import { app } from "/scripts/app.js";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { api } from "/scripts/api.js";
import { isVueNodes, applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { createPixaromaColorPicker } from "../shared/color_picker.mjs";
import { openRunHistory, closeRunHistoryFor, refreshRunHistory } from "./history.mjs";

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Run Timer Pixaroma — a stopwatch for the whole workflow               ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// Frontend-only node (never runs in Python). It listens to ComfyUI's run
// events: on execution_start it resets to zero and counts up live; on finish it
// freezes the total and plays a chime. Every setting (chime/sound/volume/
// decimals/color) lives in a floating right-click panel. State is on
// node.properties.runTimerState.
//
// TITLE-LESS BY DESIGN (like the Label node). The whole node is just the clock —
// no title bar, no category chip, no frame. This is done the SAME way Label does
// it, which is the ONLY way that works cleanly in both renderers:
//   • `nodeType.title_mode = NO_TITLE` is set ONCE on the node TYPE (not per
//     node). Set at registration, so the Nodes 2.0 reactive node reads NO_TITLE
//     from first mount and never reserves the title height (a per-node LIVE
//     toggle does NOT work — Vue caches title_mode in a copy that only re-reads
//     on remount, so it keeps reserving the 30px → the node renders too tall).
//   • CLASSIC renderer: NO DOM widget at all — the clock is painted straight onto
//     the node canvas (onDrawForeground). A DOM element on top of the canvas
//     can't behave like a canvas node: click-through routes clicks to the
//     browser, not the node, so it can't be dragged/right-clicked. Painting on
//     the canvas makes it a real node — LiteGraph handles drag + right-click.
//   • NODES 2.0: a DOM-widget clock, with the frame/chip hidden via CSS and the
//     widget subtree click-through so drag + right-click reach the canvas.
//
// The last FINISHED total is persisted (node.properties.runTimerLastMs) so it
// survives a tab switch / reload (Preview Image Pattern #4); a finished run
// writes it (flags "modified", accepted), the load path only READS it (dirty-on-
// load safe, Vue Compat #18).

const BRAND = "#f66744";
const NODE_NAME = "PixaromaRunTimer";
const STATE_PROP = "runTimerState";

const NODE_W = 160;  // starting width (refit to the clock content on drop)
const MIN_W = 130;   // resize floor — keeps the m:s readout un-clipped
const CLOCK_H = 50;  // node height (constant — a single tight clock line)
const FIT_PAD_X = 26; // horizontal breathing room added around the measured clock

const DEFAULT_STATE = {
  version: 1,
  color: BRAND,   // clock digit color
  decimals: 0,    // 0 = m:s (default), 2 = + hundredths, 3 = + milliseconds
  chime: true,    // play a sound on finish
  sound: "",      // "" = the library default (Vista.mp3 / first file)
  volume: 70,     // 0..100
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
// Break ms into labeled groups. The fraction rides on the seconds group after a
// decimal point. Past an hour → hr:min:sec (fraction dropped). Math.floor on
// every part is REQUIRED (ms is a float, else raw decimals leak).
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

// ── display (Nodes 2.0 DOM clock) ───────────────────────────────────────────
// Rebuild the segment STRUCTURE only when the shape changes; otherwise just
// update the numbers each frame. No-op in the classic renderer (no DOM clock).
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
  node._rtDotState = mode; // the classic canvas painter reads this
  if (node._pixRtDot) node._pixRtDot.className = "pix-rt-dot" + (mode === "run" ? " run" : mode === "done" ? " done" : "");
  if (!isVueNodes()) node.setDirtyCanvas && node.setDirtyCanvas(true, true);
}
function flashScreen(node) {
  const scr = node._pixRtScreen;
  if (!scr) return; // Nodes 2.0 only (classic just freezes the number + orange dot)
  scr.classList.remove("flash");
  void scr.offsetWidth; // reflow so the animation can replay
  scr.classList.add("flash");
}
// Refresh the on-screen clock the right way for the renderer: a canvas repaint
// in the CLASSIC renderer (onDrawForeground redraws), else the DOM paint.
function refreshClock(node) {
  maybeFitWidth(node); // hug the clock content when the readout shape changes
  if (!isVueNodes()) { node.setDirtyCanvas && node.setDirtyCanvas(true, true); }
  else paint(node);
}

// ── fit the node width to the clock content (the Label 'fit' trick) ─────────
// Monospace digits → the width is stable per SHAPE (decimals + hour rollover), so
// we only remeasure/resize when the shape changes. Sizing the node tightly to the
// content is what makes it look like a compact clock with no empty space.
let _measCanvas = null;
function measureClockContentWidth(node) {
  if (!_measCanvas) _measCanvas = document.createElement("canvas");
  const ctx = _measCanvas.getContext("2d");
  const parts = clockParts(node._rtDisplayMs || 0, node._pixRtDecimals != null ? node._pixRtDecimals : 0);
  const NUM = "600 30px 'Consolas','DejaVu Sans Mono',ui-monospace,monospace";
  const UNIT = "500 13px 'Consolas','DejaVu Sans Mono',ui-monospace,monospace";
  const FRAC = "600 19px 'Consolas','DejaVu Sans Mono',ui-monospace,monospace";
  const gap = 5;
  let total = 0;
  ctx.font = NUM; const colonW = ctx.measureText(":").width;
  parts.groups.forEach((g, i) => {
    if (i > 0) total += gap * 2 + colonW;
    ctx.font = NUM; total += ctx.measureText(g.num).width + Math.max(0, g.num.length - 1); // + ~1px letter-spacing/digit
    if (parts.frac && i === parts.groups.length - 1) { ctx.font = FRAC; total += ctx.measureText(parts.frac).width; }
    ctx.font = UNIT; total += 2 + ctx.measureText(g.unit).width;
  });
  return total;
}
function fitClockWidth(node) {
  if (isGraphLoading()) return; // dirty-on-load safe (trust the saved width on load)
  if (typeof node.setSize !== "function") return;
  const w = Math.max(MIN_W, Math.round(measureClockContentWidth(node) + FIT_PAD_X));
  if (Math.abs((node.size[0] || 0) - w) > 1) node.setSize([w, node.size[1]]);
}
function maybeFitWidth(node) {
  const parts = clockParts(node._rtDisplayMs || 0, node._pixRtDecimals != null ? node._pixRtDecimals : 0);
  const sig = parts.groups.length + "|" + (parts.frac ? parts.frac.length : 0);
  if (node._rtWidthSig === sig) return; // only refit when the readout shape changes
  node._rtWidthSig = sig;
  fitClockWidth(node);
}
// Apply color + decimals from state and repaint.
function applyState(node) {
  const st = readState(node);
  node._pixRtDecimals = st.decimals;
  if (node._pixRtScreen) node._pixRtScreen.style.setProperty("--cc", st.color || BRAND);
  refreshClock(node);
}
// Restore the last frozen total from node.properties (survives tab switch /
// reload). READ-ONLY (dirty-on-load safe). Rejects an absurd value from a
// corrupted / hand-edited workflow JSON.
const MAX_RESTORE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — generous vs any real run
function restoreLastRun(node) {
  if (node._rtRunning) return;
  const ms = node.properties && node.properties.runTimerLastMs;
  if (typeof ms === "number" && isFinite(ms) && ms >= 0 && ms <= MAX_RESTORE_MS) node._rtDisplayMs = ms;
}

// ── copy-to-clipboard (works over http LAN via an execCommand fallback) ──────
function copyToClipboard(text, flash) {
  const legacyCopy = () => {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    let ok = false;
    try { document.body.appendChild(ta); ta.select(); ok = document.execCommand("copy"); }
    catch (_e) { ok = false; }
    finally { ta.remove(); }
    flash(ok);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => flash(true)).catch(legacyCopy);
  else legacyCopy();
}

// ── run time history (global, persistent) ───────────────────────────────────
// The last N FINISHED runs, stored in a global ComfyUI setting (unregistered
// settings persist — Vue Compat #20). Deliberately GLOBAL, not per-node: it never
// writes node.properties, so recording a run can't dirty a saved workflow, and it
// survives reloads. One entry per run {ms, name, at}; shown from any Run Timer's
// right-click "Run time history". Mirrors the Seed history.
const HISTORY_SETTING = "Pixaroma.RunTimer.History";
const HISTORY_MAX = 10;

// Best-effort name of the active workflow (for the history label). ComfyUI's
// workflow store exposes activeWorkflow.filename (verified in the frontend
// bundle); strip the folder + .json. Falls back through older APIs, then to
// "Unsaved" so a fresh / temporary workflow still reads sensibly.
function activeWorkflowName() {
  try {
    const wf = app.extensionManager?.workflow?.activeWorkflow
            || app.workflowManager?.activeWorkflow;
    let raw = (wf && (wf.filename || wf.key || wf.path || wf.name)) || "";
    raw = String(raw).split(/[\\/]/).pop().replace(/\.json$/i, "").trim();
    if (raw) return raw;
  } catch (_e) {}
  return "Unsaved";
}

function getRunHistory() {
  try {
    const raw = app.ui?.settings?.getSettingValue?.(HISTORY_SETTING);
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.filter((e) => e && typeof e === "object" && isFinite(Number(e.ms)));
  } catch (_e) { return []; }
}
function saveRunHistory(arr) {
  try {
    app.ui?.settings?.setSettingValueAsync?.(HISTORY_SETTING, JSON.stringify(arr.slice(0, HISTORY_MAX)));
  } catch (_e) {}
}
// Record one finished run (most-recent first, capped). Guards a garbage duration.
function recordRunHistory(ms) {
  const dur = Number(ms);
  if (!isFinite(dur) || dur < 0) return;
  const entry = { ms: Math.round(dur), name: activeWorkflowName(), at: Date.now() };
  saveRunHistory([entry, ...getRunHistory()].slice(0, HISTORY_MAX));
  refreshRunHistory(); // update the panel if it happens to be open
}
// Open the Run time history panel for `node`. Builds the ctx the panel needs.
function openRunHistoryPanel(node) {
  openRunHistory(node, {
    getHistory: getRunHistory,
    clearHistory: () => { saveRunHistory([]); refreshRunHistory(); },
    copyToClipboard,
  });
}

// ── run lifecycle (drives every Run Timer on the canvas) ────────────────────
const _timers = new Set();
let _rafId = null;
let _runStart = null; // run-level origin (set on execution_start) → history duration
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
  _runStart = performance.now(); // one origin for the run → history duration
  for (const node of _timers) {
    clearTimeout(node._rtDotT);
    node._rtRunning = true;
    node._rtStart = _runStart; // share it so the frozen clock == the recorded time
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
    // A very fast first run can finish before the sounds list has fetched. Await
    // the memoized fetch so the default chime still plays; fall back to Vista.mp3.
    if (!_soundsCache.length) _soundsCache = await fetchSounds();
    sound = defaultSound() || "Vista.mp3";
  }
  if (sound) playSound(sound, (st.volume ?? 70) / 100);
}
function finishAll(success) {
  let anyFinished = false;
  for (const node of _timers) {
    if (!node._rtRunning) continue;   // idempotent: first finish wins
    anyFinished = true;
    node._rtRunning = false;
    node._rtDisplayMs = performance.now() - node._rtStart;
    // Persist the frozen total (see restoreLastRun). A genuine run-completion
    // write (flags "modified", accepted); never written on the load path.
    if (!node.properties) node.properties = {};
    node.properties.runTimerLastMs = node._rtDisplayMs;
    refreshClock(node);
    setDot(node, "done");
    flashScreen(node);
    if (success) maybeChime(node);
    clearTimeout(node._rtDotT);
    node._rtDotT = setTimeout(() => setDot(node, "idle"), 2200);
  }
  // Record ONE history entry per run — successes only (an interrupted / errored
  // run gives a partial, misleading time). anyFinished guards a double finish
  // event (some builds fire BOTH 'executing'(null) and execution_success): after
  // the first, every node is already stopped, so the second pass adds nothing.
  if (anyFinished && success && _runStart != null) {
    recordRunHistory(performance.now() - _runStart);
  }
}

let _listenersInstalled = false;
function installRunListeners() {
  if (_listenersInstalled) return;
  _listenersInstalled = true;
  api.addEventListener("execution_start", () => startAll());
  // 'executing' with a null node = queue item finished (older builds);
  // execution_success covers newer builds.
  api.addEventListener("executing", (e) => {
    const d = e && e.detail;
    const nodeId = (d && typeof d === "object") ? d.node : d;
    if (nodeId == null) finishAll(true);
  });
  api.addEventListener("execution_success", () => finishAll(true));
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

// Built ONCE (controls self-update) so the embedded color picker survives every
// interaction.
function renderPanelBody(node, body) {
  destroyPicker(node);
  body.innerHTML = "";
  const st = readState(node);

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

// Screen-pixel rect of the node so the panel opens BESIDE it. (Node Colors
// pattern.) The node is title-less, so no title-height offset.
function getNodeScreenRect(node) {
  if (isVueNodes() && node && node.id != null) {
    const elx = document.querySelector('[data-node-id="' + node.id + '"]');
    if (elx) return elx.getBoundingClientRect();
  }
  const c = app.canvas;
  const ds = c && c.ds, canvasEl = c && c.canvas;
  if (!ds || !canvasEl || !node || !node.pos || !node.size) return null;
  const cr = canvasEl.getBoundingClientRect();
  const scale = ds.scale || 1, off = ds.offset || [0, 0];
  const left = cr.left + (node.pos[0] + off[0]) * scale;
  const top = cr.top + (node.pos[1] + off[1]) * scale;
  const width = node.size[0] * scale;
  const height = node.size[1] * scale;
  return { left, top, right: left + width, bottom: top + height, width, height };
}
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
  if (left + mw > vw - pad) left = rect.left - gap - mw;
  if (left < pad) left = Math.max(pad, vw - mw - pad);
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
      if (!panel.isConnected) { up(); return; }
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
    if (_panel !== _p) return;
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
    // The DOM clock (Nodes 2.0 only). padding:0 → the dark screen fills the node
    // EXACTLY, so there is no frame ring / gray contour around it (the screen IS
    // the node surface). user-select:none so the digits never select.
    ".pix-rt-root{display:flex;padding:0;box-sizing:border-box;width:100%;height:100%;user-select:none;-webkit-user-select:none;}",
    ".pix-rt-screen{flex:1;min-width:0;position:relative;display:flex;align-items:center;justify-content:center;background:#0c0c0e;border:1px solid #1d1d20;border-radius:8px;padding:6px;box-sizing:border-box;}",
    ".pix-rt-time{display:flex;align-items:center;justify-content:center;gap:4px;font-family:'Consolas','DejaVu Sans Mono','SF Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--cc,#f66744);}",
    ".pix-rt-cseg{display:inline-flex;align-items:flex-start;}",
    ".pix-rt-numwrap{display:inline-flex;align-items:baseline;line-height:1;}",
    ".pix-rt-num{font-size:30px;letter-spacing:1px;}",
    ".pix-rt-frac{font-size:19px;opacity:0.85;letter-spacing:0.5px;}",
    ".pix-rt-colon{font-size:30px;line-height:1;opacity:0.7;}",
    ".pix-rt-unit{font-size:13px;line-height:1;margin-left:2px;margin-top:2px;opacity:0.5;}",
    ".pix-rt-dot{position:absolute;top:6px;left:7px;width:7px;height:7px;border-radius:50%;background:#6b6b72;}",
    ".pix-rt-dot.run{background:#3ec371;animation:pixRtPulse 1s infinite;}",
    ".pix-rt-dot.done{background:#f66744;}",
    ".pix-rt-screen.flash{animation:pixRtFlash 0.6s;}",
    "@keyframes pixRtPulse{0%,100%{opacity:1;}50%{opacity:.3;}}",
    "@keyframes pixRtFlash{0%{box-shadow:0 0 0 3px var(--cc,#f66744);}100%{box-shadow:0 0 0 0 rgba(0,0,0,0);}}",
    // ── NODES 2.0 title-less float (like the Label node). Scoped to .pix-rt-root,
    //    which only exists in Nodes 2.0 (classic has no DOM widget → no-op there).
    //    Hides the card / frame / footer chip / resting border, and makes the whole
    //    widget subtree click-through so drag + right-click reach the canvas. The
    //    HEADER + its reserved height are removed by title_mode NO_TITLE on the node
    //    type (set in beforeRegisterNodeDef), exactly like Label.
    ".lg-node:has(.pix-rt-root){background:transparent!important;border:none!important;box-shadow:none!important;}",
    // Kill the frontend's hardcoded node min-WIDTH (225px) + min-HEIGHT
    // (node.size[1] + ~30px title height). The min-height floor is the one that
    // matters here: without it Nodes 2.0 reserves 84+30=114px and shows a ~30px
    // dead/gray gap BELOW the 84px clock (the 'gray contour'). Label zeros both
    // (render.mjs injectVueLabelCSS rule 1); mirror it, scoped to .pix-rt-root.
    ".lg-node:has(.pix-rt-root),.lg-node:has(.pix-rt-root) > div,.lg-node:has(.pix-rt-root) > div > div{min-width:0!important;min-height:0!important;}",
    ".lg-node:has(.pix-rt-root) .lg-node-header{display:none!important;}",
    // Collapse the widget grid's padding/gaps + hide the reorder-handle gutter
    // (Label render.mjs rule 2) so the clock isn't offset or ringed by widget
    // chrome. The clock widget still fills the width (it's the last, 1fr column).
    // grid-template-columns: 1fr → the widget (and the clock screen inside it)
    // FILLS the node width instead of hugging the digits, so the node body never
    // shows as gray to the right of the clock.
    ".lg-node:has(.pix-rt-root) .lg-node-widgets{grid-template-columns:minmax(0,1fr)!important;padding:0!important;row-gap:0!important;gap:0!important;}",
    ".lg-node:has(.pix-rt-root) .lg-node-widget{gap:0!important;width:100%!important;}",
    ".lg-node:has(.pix-rt-root) .lg-node-widget > *:first-child{display:none!important;}",
    ".lg-node:has(.pix-rt-root) .lg-node-content{padding:0!important;}",
    ".lg-node:has(.pix-rt-root) [class*=\"component-node-background\"]{padding:0!important;gap:0!important;background:transparent!important;}",
    ".lg-node:has(.pix-rt-root) [class*=\"component-node-background\"] > div:has(.bg-node-component-surface),.lg-node:has(.pix-rt-root) .bg-node-component-surface{display:none!important;}",
    ".lg-node:has(.pix-rt-root) > div.absolute.border:not([data-testid]){display:none!important;}",
    ".lg-node:has(.pix-rt-root) [data-testid=\"node-state-outline-overlay\"],.lg-node:has(.pix-rt-root) > div.absolute.outline-none{inset:-2px!important;}",
    ".lg-node:has(.pix-rt-root) .lg-node-widgets,.lg-node:has(.pix-rt-root) .lg-node-widgets *{pointer-events:none!important;}",
    // panel — palette matches the Pixaroma Color Picker (#1a1a1a / #444).
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
  ].join("\n");
  (document.head || document.documentElement).appendChild(s);
}

// ── classic renderer: paint the clock on the node canvas ────────────────────
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
// Paint the whole clock (dark screen filling the node + digits + units + dot).
// ctx is already translated to the node origin (title-less → origin = node top).
// The screen fills the node body (covering the default card fill), so only the
// node's own 1px border shows — a clean bezel; the node stays a real canvas node,
// so LiteGraph handles drag + right-click natively (like the Label node).
function paintLegacyClock(node, ctx) {
  const w = node.size[0], h = node.size[1];
  const rr = (x, y, ww, hh, r) => { if (ctx.roundRect) ctx.roundRect(x, y, ww, hh, r); else ctx.rect(x, y, ww, hh); };
  ctx.save();
  ctx.fillStyle = "#0c0c0e";
  ctx.beginPath(); rr(0, 0, w, h, 8); ctx.fill();
  // status dot
  const dm = node._rtDotState || "idle";
  ctx.fillStyle = dm === "run" ? "#3ec371" : dm === "done" ? "#f66744" : "#6b6b72";
  ctx.beginPath(); ctx.arc(11, 11, 3.5, 0, Math.PI * 2); ctx.fill();
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
  let x = (w - total) / 2;
  const midY = h / 2;
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

// Classic only: LiteGraph paints the node's own body (bgcolor fill + a drop
// shadow) BEFORE onDrawForeground. On a title-less node that leaves a soft
// shadow/frame around the clock (the Label node hit this — CLAUDE.md Label #7).
// Wrap drawNode and, for a Run Timer, MATCH the body to the clock screen (same
// fill colour + corner radius) and kill the drop shadow for the duration, so the
// body IS the clock and no frame shows. Our onDrawForeground paints the digits +
// dot on top. All state restored in finally. No-op in Nodes 2.0 (body paint is
// skipped there; the frame is hidden via CSS). Composes with Label's own drawNode
// wrap (each checks its node type and passes the rest through).
function installRtBodyHook() {
  if (typeof window === "undefined" || window._pixRtBodyWrapped) return;
  const proto = window.LGraphCanvas && window.LGraphCanvas.prototype;
  if (!proto || typeof proto.drawNode !== "function") return;
  window._pixRtBodyWrapped = true;
  const orig = proto.drawNode;
  proto.drawNode = function (node, ctx) {
    if (ctx && node && (node.type === NODE_NAME || node.comfyClass === NODE_NAME)) {
      const sBg = node.bgcolor, sCol = node.color, sShadow = ctx.shadowColor;
      const LG = window.LiteGraph || {};
      const sR = LG.ROUND_RADIUS;
      node.bgcolor = "#0c0c0e"; node.color = "#0c0c0e";
      if (LG) LG.ROUND_RADIUS = 8;
      ctx.shadowColor = "rgba(0,0,0,0)";
      try { return orig.apply(this, arguments); }
      finally {
        node.bgcolor = sBg; node.color = sCol; ctx.shadowColor = sShadow;
        if (LG) LG.ROUND_RADIUS = sR;
      }
    }
    return orig.apply(this, arguments);
  };
}

// ── node sizing ─────────────────────────────────────────────────────────────
// The node height is a constant (CLOCK_H) — a title-less single clock line. No
// reserve to compensate (title_mode NO_TITLE on the node type is consistent from
// mount in both renderers, so Nodes 2.0 never reserves the title height).
function refreshNodeSize(node) {
  if (isGraphLoading()) return;
  try {
    if (typeof node.setSize !== "function") return;
    const target = isVueNodes() ? CLOCK_H : (typeof node.computeSize === "function" ? node.computeSize()[1] : CLOCK_H);
    if (Math.abs((node.size[1] || 0) - target) > 1) node.setSize([node.size[0], target]);
  } catch (_e) {}
}

function setupNode(node) {
  injectCSS();
  node._rtDisplayMs = 0;
  node._rtRunning = false;
  node._rtDotState = "idle";
  node._pixRtDecimals = DEFAULT_STATE.decimals;
  node.badges = []; // no pack badge (title-less like Label)
  // Also set the per-node no_title FLAG (title_mode on the type handles the
  // RENDER; this flag is what other features read — e.g. Align zeroes the title
  // height only when flags.no_title is set, so top/center alignment lines up on a
  // title-less node). Idempotent → no dirty-on-load once saved.
  node.flags = node.flags || {};
  if (!node.flags.no_title) node.flags.no_title = true;

  if (isVueNodes()) {
    // Nodes 2.0: a DOM-widget clock (frameless + click-through via the CSS above).
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
    paint(node); // initial 00:00
    installCanvasZoomPassthrough(root);
    const widget = node.addDOMWidget("run_timer_ui", "pixaroma_run_timer", root, {
      getValue: () => readState(node),
      setValue: () => {},
      getMinHeight: () => CLOCK_H,
      serialize: false, // state lives on node.properties
    });
    applyAdaptiveCanvasOnly(widget);
    widget.computeLayoutSize = () => ({ minHeight: CLOCK_H, minWidth: 1 });
    node._pixRtFloorOff = installResizeFloor(root, () => CLOCK_H);
  } else {
    // Classic: NO DOM widget — the clock is painted on the node canvas
    // (onDrawForeground), so the node is a real canvas node: draggable +
    // right-clickable, no DOM element eating clicks. computeSize hugs the body.
    node.computeSize = function () { return [MIN_W, CLOCK_H]; };
  }

  if (Array.isArray(node.size)) {
    if (node.size[0] < NODE_W) node.size[0] = NODE_W;
    node.size[1] = CLOCK_H;
  } else {
    node.size = [NODE_W, CLOCK_H];
  }

  _timers.add(node);
  // nodeCreated fires BEFORE configure() restores node.properties (Vue Compat #8)
  // — defer so a saved timer shows its restored color/decimals + last time.
  queueMicrotask(() => { restoreLastRun(node); applyState(node); refreshNodeSize(node); });
}

const HELP = {
  title: "Run Timer Pixaroma",
  tagline: "Times how long a workflow takes, and chimes when it is done.",
  sections: [
    { heading: "What it does", body: "The clock resets to zero the moment you press Run, counts up while the workflow is working, and freezes on the total time when it finishes. A chime plays on finish, so you know it is done even when you are in another browser tab or app." },
    { heading: "A clean floating clock", body: "The node is just the clock - no title bar, no frame - so it takes very little room on the canvas. Drag it from anywhere on the clock to move it, and right-click it for the settings. It works the same in both the classic and the new node interface." },
    { heading: "Reading the clock", body: "The time shows as minutes : seconds (for example 02:47). If a run goes past an hour the clock switches to hours : minutes : seconds. A small dot in the corner is green while running and orange the moment it finishes." },
    { heading: "Comparing workflows across tabs", body: "Each workflow remembers its own last time, so you can run several workflows in different tabs and switch between them to compare how long each one took.", bullets: [
      "The time is saved with the workflow, so it is still there after you switch tabs, reload the page, or restart ComfyUI.",
      "Because it is saved with the workflow, a small 'unsaved changes' dot shows on the tab after a run. Switching tabs never asks you to save; only closing a tab asks, as always.",
      "If you switch tabs while a run is still going, that run's time is not captured, and you will see the previous finished time when you come back.",
    ]},
    { heading: "Run time history", body: "Right-click the node and pick 'Run time history' to see the last 10 finished runs, newest first. Each line shows the workflow name and the time of day it ran, next to how long it took, and the fastest one is marked with a lightning bolt - handy for comparing how quick different workflows are. The list is shared across every workflow and is remembered between sessions (it is not saved inside any one workflow). You can copy a single line, export the whole list as a text file, or clear it. Only completed runs are listed; a run you stop or that errors out is skipped." },
    { heading: "Settings (right-click the node)", defs: [
      ["Chime on finish", "Turn the finish sound on or off."],
      ["Sound and Volume", "Pick the chime from the sound library and set how loud it is. The Preview button plays it right now."],
      ["Decimals", "Show hundredths (2), milliseconds (3), or just minutes and seconds (Off)."],
      ["Clock color", "Pick the digit color right in the panel: tap a swatch, drag the color square, or type a hex code. Reset returns it to Pixaroma orange."],
    ]},
    { heading: "Good to know", body: "It does not need to be wired to anything; just drop it on the canvas. Add your own chimes by dropping .mp3, .wav, or .ogg files (use simple names - letters, numbers, dashes) into the assets/sounds folder. A master mute for every Run Timer lives in Settings, under Pixaroma, Run Timer." },
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
  ],

  setup() {
    installRunListeners();
    installRtBodyHook();
    fetchSounds().then((list) => { _soundsCache = list; });
  },

  getNodeMenuItems(node) {
    // node.type fallback (comfyClass isn't populated on every build/timing — the
    // exact case Label's own hook guards, js/label/index.js).
    if (!node || (node.type !== NODE_NAME && node.comfyClass !== NODE_NAME)) return [];
    return [
      null,
      { content: "🕘 Run time history", callback: () => openRunHistoryPanel(node) },
      { content: "⚙ Run Timer settings", callback: () => openPanel(node) },
    ];
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;

    // Title-less like the Label node: set NO_TITLE on the node TYPE (once, at
    // registration) so both renderers treat it as title-less from first mount and
    // never reserve the title height. This is the crux — a per-node LIVE toggle
    // does NOT work in Nodes 2.0 (it caches title_mode in a copy that only re-reads
    // on remount, so it keeps reserving the 30px).
    const LG = (typeof window !== "undefined" && window.LiteGraph) || {};
    nodeType.title_mode = (LG.NO_TITLE != null) ? LG.NO_TITLE : 1;

    if (nodeType.prototype._pixRtPatched) return; // hot-reload: don't double-wrap
    nodeType.prototype._pixRtPatched = true;

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure ? _origConfigure.apply(this, arguments) : undefined;
      // Re-assert the no_title flag after configure restores node.flags (Align).
      this.flags = this.flags || {};
      if (!this.flags.no_title) this.flags.no_title = true;
      restoreLastRun(this); applyState(this); refreshNodeSize(this);
      return r;
    };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      _timers.delete(this);
      clearTimeout(this._rtDotT);
      try { if (this._pixRtFloorOff) this._pixRtFloorOff(); } catch (_e) {}
      this._pixRtFloorOff = null;
      if (_panelNode === this) closePanel();
      closeRunHistoryFor(this);
      if (_origRemoved) return _origRemoved.apply(this, arguments);
    };

    // Classic: keep resize HORIZONTAL (width free, height locked to the clock).
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        this.size[1] = CLOCK_H;
      }
      if (_origResize) return _origResize.apply(this, arguments);
    };

    // Classic: paint the clock onto the node canvas + keep the height fixed (also
    // self-heals a taller size saved by an older version). Nodes 2.0 skips this
    // (its DOM clock renders instead + onDrawForeground is not the paint path).
    const _origFg = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const r = _origFg ? _origFg.apply(this, arguments) : undefined;
      if (ctx && !isVueNodes()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (Math.abs((this.size[1] || 0) - CLOCK_H) > 0.5) this.size[1] = CLOCK_H;
        try { paintLegacyClock(this, ctx); } catch (_e) {}
      }
      return r;
    };
  },

  nodeCreated(node) {
    if (node.type !== NODE_NAME && node.comfyClass !== NODE_NAME) return;
    setupNode(node);
  },
});

registerNodeHelp(NODE_NAME, HELP);
