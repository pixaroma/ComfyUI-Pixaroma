// Load Audio Pixaroma - the node face.
//
// Convention #12 for the labelled number field, #13 for the interaction states
// (hover = accent border, never a fill), #14 for the file picker (our dark
// popup, never a native <select>), #27 for sizing that popup with the canvas
// zoom, and #20 for the drag.

import { ACC, accentOf } from "../shared/node_settings.mjs";
import { canvasBackingScale } from "../shared/nodes2.mjs";
import { pixAsset } from "../shared/api_url.mjs";
import { placeZoomedPopup } from "../shared/popup_zoom.mjs";
import { DEFAULT_STATE, WAVE_H, fmtTime, readState, writeState } from "./core.mjs";
import { audioFileUrl, listAudioFiles, uploadAudio } from "./api.mjs";
import { drawWave, forgetPeaks, loadPeaks, makePlayer } from "./waveform.mjs";

const ROOT = "pix-la-root";
let _cssDone = false;
let _popup = null;

export function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const css = `
  .${ROOT}{
    box-sizing:border-box; width:100%; height:100%; display:flex; flex-direction:column;
    gap:5px; padding:0 8px 4px; font:12px 'Segoe UI',sans-serif; color:#ddd;
    background:transparent; overflow:hidden;
  }
  .${ROOT} .row{ display:flex; gap:6px; align-items:stretch; }
  .${ROOT} .file{
    flex:1; min-width:0; box-sizing:border-box; display:flex; align-items:center;
    justify-content:space-between; gap:6px; background:#1d1d1d; border:1px solid #444;
    border-radius:4px; padding:5px 8px; cursor:pointer; color:#ddd; font-size:11px;
  }
  .${ROOT} .file:hover{ border-color:${ACC}; color:#fff; }
  .${ROOT} .file .nm{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .${ROOT} .file .ar{ color:${ACC}; font-size:9px; flex:none; }
  .${ROOT} .btn{
    box-sizing:border-box; background:rgba(255,255,255,0.04);
    border:1px solid rgba(255,255,255,0.14); border-radius:4px;
    color:rgba(255,255,255,0.65); font-size:11px; padding:5px 9px; cursor:pointer;
    user-select:none; flex:none;
  }
  .${ROOT} .btn:hover{ border-color:${ACC}; color:#fff; }
  /* Convention #28: the BUNDLED gear svg as a mask, never the emoji. An emoji
     is drawn by the operating system, so it is a different shape on Windows,
     Mac and Linux and sits on its own baseline. */
  .${ROOT} .gear{ display:flex; align-items:center; justify-content:center; padding:5px 7px; }
  .${ROOT} .gear::before{
    content:""; display:block; width:14px; height:14px; background:#bbb;
    -webkit-mask:url(${pixAsset("icons/note/gear.svg")}) center/contain no-repeat;
    mask:url(${pixAsset("icons/note/gear.svg")}) center/contain no-repeat;
  }
  .${ROOT} .gear:hover::before{ background:${ACC}; }
  .${ROOT} .wavebox{
    background:#1d1d1d; border:1px solid #444; border-radius:4px; padding:6px;
    display:flex; flex-direction:column; gap:4px; flex:1 1 auto; min-height:0;
  }
  /* ⚠️ flex-basis MUST be 0, never auto. A <canvas> takes its INTRINSIC ASPECT
     RATIO from its width/height ATTRIBUTES (the backing store), and with
     flex-basis:auto the flex base size comes from that intrinsic size - so the
     element's HEIGHT gets derived from its own backing store. drawWave sets the
     backing store from the element's measured size, which closes a feedback
     loop: paint -> backing goes square -> layout makes the box square -> the
     next paint writes an even bigger square. MEASURED in Nodes 2.0: the body
     went 190 -> 443px on a fresh insert, and widening the node from 380 to 600
     pushed node.size[1] to 685. flex-basis:0 makes the base size 0 so only the
     flex line (and min-height) decide the height; verified back to 188px. */
  .${ROOT} .wave{
    width:100%; flex:1 1 0; min-height:${WAVE_H}px; display:block;
    cursor:ew-resize; touch-action:none;
  }
  .${ROOT} .times{ display:flex; justify-content:space-between; font-size:10px; color:#777; }
  .${ROOT} .times .sel{ color:${ACC}; }
  .${ROOT} .num{
    box-sizing:border-box; display:flex; align-items:center; justify-content:space-between;
    background:#1d1d1d; border:1px solid #444; border-radius:4px; padding:5px 8px; min-height:26px;
  }
  .${ROOT} .num:focus-within{ border-color:${ACC}; }
  .${ROOT} .num .lb{ font-size:11px; letter-spacing:.4px; color:${ACC}; }
  .${ROOT} .num .rt{ display:flex; align-items:center; gap:7px; }
  .${ROOT} .num input{
    width:64px; background:none; border:none; outline:none; text-align:right;
    color:${ACC}; font:12px 'Segoe UI',sans-serif; line-height:1.2;
  }
  .${ROOT} .spin{ display:flex; flex-direction:column; line-height:.85; align-self:stretch;
    justify-content:center; }
  .${ROOT} .spin b{ font-size:8px; color:${ACC}; cursor:pointer; font-weight:400; }
  .${ROOT} .spin b:hover{ filter:brightness(1.4); }
  .${ROOT} .out{
    background:rgba(0,0,0,0.25); border-radius:4px; padding:5px 8px; font-size:11px;
    color:#aaa; line-height:1.5; display:flex; align-items:center; gap:7px;
  }
  /* A REAL hit area. The bare triangle was ~8x10px, which is findable by eye
     and not by mouse - the first thing reported about this node. The glyph
     inside stays small; the button around it is 26x22. */
  .${ROOT} .out .playbtn{
    flex:none; width:26px; height:22px; margin:-3px 0 -3px -3px;
    display:flex; align-items:center; justify-content:center; cursor:pointer;
    border-radius:4px;
  }
  .${ROOT} .out .playbtn:hover{ background:rgba(255,255,255,0.08); }
  .${ROOT} .out .playbtn .play{
    width:0; height:0; border-style:solid; border-width:6px 0 6px 10px;
    border-color:transparent transparent transparent ${ACC};
  }
  .${ROOT} .out .playbtn .stop{
    width:10px; height:10px; background:${ACC}; border-radius:1px;
  }
  .${ROOT} .out .tx{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .${ROOT} .out .warn{ color:#f2b134; }
  .${ROOT} .out .bad{ color:#e05252; }

  .pix-la-pop{
    position:fixed; z-index:10900; background:#232323; border:1px solid #555;
    border-radius:6px; box-shadow:0 10px 30px rgba(0,0,0,0.5); overflow:auto;
    font-family:'Segoe UI',sans-serif; padding:0.25em 0;
  }
  .pix-la-pop .it{
    padding:0.4em 0.8em; cursor:pointer; font-size:1em; color:#ddd;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  .pix-la-pop .it:hover{ background:#2f2f2f; }
  .pix-la-pop .it.on{ color:${ACC}; }
  .pix-la-pop .em{ padding:0.5em 0.8em; font-size:0.92em; color:#888; }
  `;
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
}

export function closePopup() {
  try { _popup?.remove(); } catch (_e) { /* already gone */ }
  _popup = null;
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("wheel", onWheel, true);
  document.removeEventListener("keydown", onEsc, true);
}

function outside(e) {
  if (_popup && !_popup.contains(e.target)) closePopup();
}
function onWheel(e) {
  // Gate on containment or scrolling a long list closes it (Load Image #14).
  if (_popup && !_popup.contains(e.target)) closePopup();
}
function onEsc(e) {
  if (e.key === "Escape" && _popup) { e.stopPropagation(); closePopup(); }
}

async function openPicker(node, anchor, onPick) {
  closePopup();
  const pop = document.createElement("div");
  pop.className = "pix-la-pop";
  const loading = document.createElement("div");
  loading.className = "em";
  loading.textContent = "reading the input folder...";
  pop.appendChild(loading);
  document.body.appendChild(pop);
  _popup = pop;
  placeZoomedPopup(pop, anchor, { baseFontPx: 12, minWidthPx: 160 });
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("wheel", onWheel, true);
  document.addEventListener("keydown", onEsc, true);

  // Re-listed on EVERY open, so a file dropped into input/ shows up without
  // pressing R (which cannot reach a custom popup) or restarting.
  const { files, error } = await listAudioFiles();
  if (_popup !== pop) return;            // closed while we were waiting
  pop.textContent = "";
  if (error || !files.length) {
    const em = document.createElement("div");
    em.className = "em";
    em.textContent = error
      ? "could not read the input folder"
      : "no sound files in ComfyUI's input folder";
    pop.appendChild(em);
  } else {
    const cur = readState(node).file;
    for (const name of files) {
      const it = document.createElement("div");
      it.className = "it" + (name === cur ? " on" : "");
      it.textContent = name;
      it.title = name;
      it.addEventListener("click", () => { closePopup(); onPick(name); });
      pop.appendChild(it);
    }
  }
  placeZoomedPopup(pop, anchor, { baseFontPx: 12, minWidthPx: 160 });
}

/** The `seconds` input slot, whatever index it sits at. */
function secondsSlot(node) {
  return node?.inputs?.find((i) => i && i.name === "seconds") || null;
}

/** Is the seconds dot actually connected right now? */
function durationWired(node) {
  const s = secondsSlot(node);
  return !!(s && s.link != null);
}

/**
 * The length the upstream node says it will send, WITHOUT running anything.
 *
 * A node that knows its own numeric output publishes it as `_pixLiveSeconds`
 * (Duration Pixaroma does). That is what lets the selection resize the instant
 * you draw the wire instead of only after a run.
 *
 * The guards are the ones [[reference_upstream_preview_is_not_output]] earned:
 * check the WIRE not a cache, refuse a MUTED (2) or BYPASSED (4) upstream
 * because a bypassed node passes its own input through and never produces this
 * value, and read the DIRECT upstream only.
 */
function upstreamSeconds(node) {
  const slot = secondsSlot(node);
  if (!slot || slot.link == null) return null;
  const graph = node.graph;
  if (!graph) return null;
  let link = graph.links?.[slot.link];
  if (!link && typeof graph.links?.get === "function") link = graph.links.get(slot.link);
  if (!link) return null;
  const src = graph.getNodeById?.(link.origin_id);
  if (!src || src.mode === 2 || src.mode === 4) return null;
  const v = src._pixLiveSeconds;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** The length of the window the face should DRAW, in seconds. */
function windowSeconds(node, st, duration) {
  // Read the LINK, not the last run: the wire is true the moment it is drawn,
  // whereas _pixLaRun only exists after an execution. (_pixLaRun stays
  // runtime-only on purpose - writing a run result to node.properties would
  // flag a clean workflow modified on every execution, Vue Compat #18.)
  if (durationWired(node)) {
    // Live upstream value first: it is current, where the run cache can belong
    // to a wire that has since been moved.
    const live = upstreamSeconds(node);
    if (live != null) return live;
    const ran = node?._pixLaRun?.wired ? node._pixLaRun.length : null;
    if (ran != null && ran > 0) return ran;
    // Wired to something that cannot tell us in advance: the typed length is a
    // better stand-in than the whole file, and the readout says it is a guess.
    return st.length > 0 ? st.length : Math.max(0, duration - st.start);
  }
  if (st.whenUnwired === "length" && st.length > 0) return st.length;
  return Math.max(0, duration - st.start);
}

/**
 * Point the node at a different recording. ONE function, because there are two
 * ways in - the picker and Upload - and when they were written out separately
 * only one of them got fixed, so uploading kept the old file's length, cue and
 * playback while choosing from the list did not.
 *
 * A NEW FILE IS A FRESH START. A start point, a length and a play cursor are
 * all positions INSIDE one particular recording, so carrying them across is
 * meaningless: pick a 4.65s drum loop, then a 7.08s song, and you got the song
 * cropped to 4.65s for no stated reason. whenUnwired goes back to "whole" so
 * the new file is selected end to end. That is harmless while the seconds input
 * is wired, because the wire wins anyway, and it means unplugging later gives
 * the whole file rather than a leftover.
 */
function selectFile(node, name) {
  stopPlay(node);
  // `length` goes too. It is still read on the wired-but-unknown path, so a
  // leftover from the previous file shows up as the stand-in window length on
  // the new one; and flipping back to "Use length" in the gear panel would
  // otherwise resurrect it.
  writeState(node, { file: name, start: 0, length: DEFAULT_STATE.length,
                     whenUnwired: "whole" });
  node._pixLaDur = 0;
  node._pixLaCue = null;
  // The PER-NODE peaks copy, not just the shared module cache. Its freshness
  // test is `cached.file === state.file`, which still matches after a re-upload
  // under the SAME name - so the box kept drawing the old recording, and worse,
  // restored the old duration, making clicks map to the wrong times.
  node._pixLaPeaks = null;
}

export function buildFace(node, openPanel) {
  injectCSS();
  const root = document.createElement("div");
  root.className = ROOT;

  const fileRow = document.createElement("div");
  fileRow.className = "row";
  const file = document.createElement("div");
  file.className = "file";
  const nm = document.createElement("span");
  nm.className = "nm";
  const ar = document.createElement("span");
  ar.className = "ar";
  ar.textContent = "▼";
  file.append(nm, ar);
  file.title = "Choose a sound file from ComfyUI's input folder";
  file.addEventListener("click", () => openPicker(node, file, (name) => {
    selectFile(node, name);
    renderFace(node);
  }));

  const up = document.createElement("div");
  up.className = "btn";
  up.textContent = "Upload";
  up.title = "Copy a sound file into ComfyUI's input folder";
  up.addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "audio/*,.wav,.mp3,.flac,.ogg,.opus,.m4a,.aac,.aiff";
    inp.addEventListener("change", async () => {
      const f = inp.files?.[0];
      if (!f) return;
      nm.textContent = "uploading...";
      try {
        const name = await uploadAudio(f);
        // Same name, new bytes: the cached picture would be of the old file.
        forgetPeaks(name);
        selectFile(node, name);
      } catch (_e) {
        nm.textContent = "upload failed";
        return;
      }
      renderFace(node);
    });
    inp.click();
  });

  // The readout can say "length from settings", so there has to be a visible
  // way to reach them. Right-click worked but nothing advertised it.
  const gear = document.createElement("div");
  gear.className = "btn gear";
  gear.title = "Settings for this node";
  gear.addEventListener("click", (e) => { e.stopPropagation(); openPanel?.(node); });

  fileRow.append(file, up, gear);

  const wavebox = document.createElement("div");
  wavebox.className = "wavebox";
  const wave = document.createElement("canvas");
  wave.className = "wave";
  wave.title = "Click anywhere to put the play cursor there. Drag either orange "
    + "edge to trim, or drag the middle to slide the selection.";
  const times = document.createElement("div");
  times.className = "times";
  const tA = document.createElement("span");
  const tSel = document.createElement("span");
  tSel.className = "sel";
  const tB = document.createElement("span");
  times.append(tA, tSel, tB);
  wavebox.append(wave, times);

  const num = document.createElement("div");
  num.className = "num";
  const lb = document.createElement("span");
  lb.className = "lb";
  lb.textContent = "START AT";
  const rt = document.createElement("span");
  rt.className = "rt";
  const inp = document.createElement("input");
  inp.type = "text";
  inp.title = "Where in the file the window begins, in seconds";
  const spin = document.createElement("span");
  spin.className = "spin";
  const upB = document.createElement("b");
  upB.textContent = "▲";
  const dnB = document.createElement("b");
  dnB.textContent = "▼";
  spin.append(upB, dnB);
  rt.append(inp, spin);
  num.append(lb, rt);

  const nudge = (by) => {
    const st = readState(node);
    writeState(node, { start: Math.max(0, Math.round((st.start + by) * 100) / 100) });
    renderFace(node);
  };
  upB.addEventListener("click", () => nudge(0.5));
  dnB.addEventListener("click", () => nudge(-0.5));
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation();                       // or the canvas eats the typing
    if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
  });
  inp.addEventListener("change", () => {
    const v = parseFloat(inp.value);
    writeState(node, { start: Number.isFinite(v) ? Math.max(0, v) : 0 });
    renderFace(node);
  });

  const out = document.createElement("div");
  out.className = "out";
  const playBtn = document.createElement("span");
  playBtn.className = "playbtn";
  playBtn.title = "Play the selected part";
  const play = document.createElement("span");
  play.className = "play";
  playBtn.appendChild(play);
  const tx = document.createElement("span");
  tx.className = "tx";
  out.append(playBtn, tx);
  playBtn.addEventListener("click", () => togglePlay(node));

  root.append(fileRow, wavebox, num, out);

  node._pixLaEls = { root, nm, wave, tA, tSel, tB, inp, tx, play, playBtn };
  node._pixLaDur = 0;
  attachDrag(node, wave);
  attachSettings(node, file, openPanel);

  // The canvas has to be repainted at whatever size it ACTUALLY ends up, and
  // node.onResize is not a reliable signal for a DOM widget (Vue Compat #13).
  // A ResizeObserver fires for every real size change whatever caused it: node
  // resize, workflow tab switch, and - the case that bit here - the wrapper
  // going from display:none back to visible when the node scrolls into view.
  try {
    const ro = new ResizeObserver(() => {
      if (wave.clientWidth <= 0) return;
      const st = readState(node);
      const c = node._pixLaPeaks;
      // SELF-HEAL: if a file is set but we have no picture of it, do the full
      // render (which decodes) rather than painting an empty box. That is the
      // state a node lands in after its element is rebuilt - a renderer flip or
      // a workflow tab switch - and without this it silently shows "click
      // Upload" for a file that is loaded perfectly well.
      // Safe from recursion: renderFace changes the canvas BACKING size, never
      // its CSS box, so it cannot re-trigger this observer.
      if (st.file && (!c || c.file !== st.file)) renderFace(node);
      else repaintWave(node);
    });
    ro.observe(wave);
    node._pixLaRO = ro;
  } catch (_e) { /* no ResizeObserver: the node still works, it just needs a nudge */ }

  return root;
}

/** Right-click the file row is a shortcut to the gear, like other nodes. */
function attachSettings(node, el, openPanel) {
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPanel?.(node);
  });
}

// How close to an edge counts as grabbing its handle, in CSS pixels. Generous
// on purpose: the first version had no handles at all and the window jumped so
// its CENTRE landed under the cursor, which reads as the drag lagging behind.
const HANDLE_PX = 8;
const MIN_WINDOW_S = 0.1;

/** Which part of the selection is under this x? */
function zoneAt(node, wave, clientX) {
  const dur = node._pixLaDur || 0;
  const r = wave.getBoundingClientRect();
  if (!r.width || dur <= 0) return { zone: null, r, dur };
  const st = readState(node);
  const len = windowSeconds(node, st, dur);
  const x0 = (st.start / dur) * r.width;
  const x1 = (Math.min(dur, st.start + len) / dur) * r.width;
  const x = clientX - r.left;
  let zone;
  if (Math.abs(x - x0) <= HANDLE_PX) zone = "start";
  else if (!durationWired(node) && Math.abs(x - x1) <= HANDLE_PX) zone = "end";
  else if (x > x0 && x < x1) zone = "move";
  else zone = "jump";
  return { zone, r, dur, st, len, x };
}

/**
 * Drag the edges to trim, drag the middle to slide, click outside to jump.
 *
 * The END edge only moves when the duration input is UNWIRED - with a wire the
 * length belongs to whatever is upstream, and letting the mouse fight it would
 * silently disagree with the number actually used at run time.
 */
function attachDrag(node, wave) {
  // Cursor feedback, so the handles are discoverable without a tooltip.
  wave.addEventListener("pointermove", (e) => {
    if (node._pixLaDragging) return;
    const { zone } = zoneAt(node, wave, e.clientX);
    wave.style.cursor = !zone ? "default"
      : (zone === "start" || zone === "end") ? "ew-resize"
      : zone === "move" ? "grab" : "pointer";
  });

  wave.addEventListener("pointerdown", (e) => {
    const info = zoneAt(node, wave, e.clientX);
    if (!info.zone) return;
    // Only the primary button, and never while a drag is already live. A second
    // press (right button while holding left, or a second finger) otherwise runs
    // this handler again and attaches a SECOND move listener; the first finish()
    // then flips the shared flag and the second returns early without removing
    // its own listener, leaving an orphan that fights every later drag with
    // stale zone/offset values for the rest of the node's life.
    if (e.button !== 0 || node._pixLaDragging) return;
    e.stopPropagation();
    e.preventDefault();
    try { wave.setPointerCapture(e.pointerId); } catch (_x) { /* mouse only */ }
    node._pixLaDragging = true;
    wave.style.cursor = info.zone === "move" ? "grabbing" : "ew-resize";

    const { dur } = info;
    const st0 = readState(node);
    const len0 = windowSeconds(node, st0, dur);
    const end0 = Math.min(dur, st0.start + len0);
    const rect = () => wave.getBoundingClientRect();
    const secAt = (cx) => {
      const r = rect();
      return r.width ? Math.max(0, Math.min(dur, ((cx - r.left) / r.width) * dur)) : 0;
    };
    // Where inside the window the grab happened, so the window follows the
    // cursor from THAT point instead of snapping its centre to it.
    // How far right the START may go. This has been wrong twice, in opposite
    // directions, so both cases are spelled out.
    //
    // `dur - len0` is only right when the length is FIXED. In "whole file from
    // here" mode the window's end IS the file end, so its length shrinks as the
    // start moves right - and `dur - len0` then evaluates to exactly the
    // current start, pinning the selection where it already is. Measured: slide
    // right once and it never moves right again.
    //
    // And when a FIXED length is longer than the file, `dur - len0` goes
    // negative and clamps to zero, which pins it at the very start instead.
    //
    // Both are the same failure to the user: a control that silently stops
    // responding, which reads as a broken one rather than a limit.
    const fixedLength = durationWired(node) || st0.whenUnwired === "length";
    const maxStart = (!fixedLength || len0 >= dur)
      ? Math.max(0, dur - MIN_WINDOW_S)
      : dur - len0;

    const grabOffset = secAt(e.clientX) - st0.start;
    const downX = e.clientX;
    // A press that never really moves is a CLICK, and a click places the play
    // cursor instead of touching the selection. Without this split there is no
    // way to audition a different part of a long file without dragging your
    // selection off the spot you had chosen.
    let moved = false;
    let zone = info.zone;
    let jumpOffset = grabOffset;
    const beginJumpDrag = (cx) => {
      const start = Math.max(0, Math.min(maxStart, secAt(cx) - len0 / 2));
      writeState(node, { start: round2(start) });
      zone = "move";
      jumpOffset = secAt(cx) - readState(node).start;
    };

    const apply = (cx) => {
      const t = secAt(cx);
      if (zone === "start") {
        if (durationWired(node)) {
          // Length is fixed by the wire, so the left edge SLIDES the window.
          writeState(node, { start: round2(Math.max(0, Math.min(maxStart, t))) });
        } else {
          const start = Math.max(0, Math.min(end0 - MIN_WINDOW_S, t));
          writeState(node, { start: round2(start), length: round2(end0 - start),
                             whenUnwired: "length" });
        }
      } else if (zone === "end") {
        const cur = readState(node);
        const len = Math.max(MIN_WINDOW_S, Math.min(dur - cur.start, t - cur.start));
        writeState(node, { length: round2(len), whenUnwired: "length" });
      } else {
        const start = Math.max(0, Math.min(maxStart, t - jumpOffset));
        writeState(node, { start: round2(start) });
      }
      // IN PLACE, never renderFace: that re-runs the decode promise and repaints
      // twice per pointermove, which is what made the drag feel like it was
      // catching up afterwards (Duration pattern #12, same lesson).
      // Dragging the selection resets the cue to its start, so Play always
      // means "from the beginning of what I just chose" unless you deliberately
      // click somewhere else afterwards.
      node._pixLaCue = null;
      // Re-arm the stop point while playing, or editing the selection mid-play
      // leaves the audio cutting out at the OLD boundary: drag the right handle
      // out and it still stops where the edge used to be. Measured FROM WHERE
      // THE AUDIO ACTUALLY IS, not from the (just-nulled) cue - see playStopAt.
      if (node._pixLaAudio) {
        node._pixLaStopAt = playStopAt(node, node._pixLaAudio.currentTime);
      }
      liveUpdate(node);
    };
    // NOTHING is applied on pointerdown any more - that is what made every
    // press move the selection, even one you meant as a click.

    const move = (mv) => {
      // Convention #20: a lost release must not leave the window following the
      // cursor forever. Synthetic events never reproduce it; real mice do.
      if (!(mv.buttons & 1)) { finish(); return; }
      if (!moved) {
        if (Math.abs(mv.clientX - downX) < 3) return;   // still a click so far
        moved = true;
        if (zone === "jump") beginJumpDrag(downX);
      }
      apply(mv.clientX);
    };
    const finish = (ev) => {
      if (!node._pixLaDragging) return;         // idempotent: the guard can also call it
      node._pixLaDragging = false;
      wave.style.cursor = "default";
      wave.removeEventListener("pointermove", move);
      try { wave.releasePointerCapture(e.pointerId); } catch (_x) { /* fine */ }
      if (!moved) setCue(node, secAt(ev && ev.clientX != null ? ev.clientX : downX));
    };
    wave.addEventListener("pointermove", move);
    wave.addEventListener("pointerup", finish, { once: true });
    wave.addEventListener("pointercancel", finish, { once: true });
    wave.addEventListener("lostpointercapture", finish, { once: true });
  });
}

function round2(v) { return Math.round(v * 100) / 100; }

/** Where Play starts from: your last click, or the start of the selection. */
function cueSeconds(node, st) {
  const c = node?._pixLaCue;
  return Number.isFinite(c) ? c : st.start;
}

/**
 * Put the play cursor somewhere. If audio is already playing, jump there
 * instead of stopping - that is what makes it usable for finding a moment in a
 * long file.
 */
function setCue(node, seconds) {
  const dur = node._pixLaDur || 0;
  node._pixLaCue = Math.max(0, Math.min(dur, seconds));
  const el = node._pixLaAudio;
  if (el) {
    try { el.currentTime = node._pixLaCue; } catch (_e) { /* not seekable yet */ }
    node._pixLaStopAt = playStopAt(node);
    node._pixLaPlayAt = node._pixLaCue;
  }
  repaintWave(node);
}

/**
 * Where Play stops, which depends on WHY you are playing.
 *
 * Cue inside the selection: you are checking the clip you chose, so stop at its
 * end. Cue outside it: you clicked over there to go looking for something, so
 * keep playing to the end of the file - cutting out after the selection's
 * length is meaningless once the cue has nothing to do with the selection, and
 * that is exactly how it felt.
 *
 * The boundary is not arbitrary: it is the visible orange edge, so which of the
 * two you get is something you can see before you press anything.
 */
function playStopAt(node, origin) {
  const st = readState(node);
  const dur = node._pixLaDur || 0;
  // No decode yet (or it failed): we do not know where anything is, so let the
  // element's own `ended` event stop it. Returning 0 here made Play a silent
  // no-op - the icon flicked to stop and straight back, with no sound - both
  // for the first second after picking a big file and forever after a file the
  // waveform could not decode but <audio> can still stream.
  if (dur <= 0) return Infinity;
  // `origin` lets a caller ask "from HERE", which matters when re-arming during
  // a drag: apply() has just nulled the cue, so cueSeconds would answer with
  // the selection start - always inside - and collapse the stop to the
  // selection end even when the audio is playing somewhere else entirely.
  // Measured: playing at 10.85s past a [0,3] selection, one nudge killed it.
  const from = Number.isFinite(origin) ? origin : cueSeconds(node, st);
  const selEnd = Math.min(dur, st.start + windowSeconds(node, st, dur));
  const inside = from >= st.start - 0.001 && from < selEnd - 0.001;
  return inside ? selEnd : dur;
}

/** The cheap per-frame update: the two numbers plus a repaint. No decoding. */
function liveUpdate(node) {
  const els = node._pixLaEls;
  if (!els) return;
  const st = readState(node);
  els.inp.value = st.start.toFixed(2);
  repaintWave(node);
}

function togglePlay(node) {
  const els = node._pixLaEls;
  const st = readState(node);
  if (!els || !st.file) return;
  if (node._pixLaAudio) { stopPlay(node); return; }
  const el = makePlayer(audioFileUrl(st.file));
  node._pixLaAudio = el;
  const from = cueSeconds(node, st);
  el.currentTime = from;
  // Read on every tick rather than captured once, so clicking elsewhere while
  // it plays moves both the position AND the point it will stop at.
  node._pixLaStopAt = playStopAt(node);
  el.addEventListener("ended", () => stopPlay(node));
  el.play().catch(() => stopPlay(node));
  els.play.className = "stop";
  els.playBtn.title = "Stop";

  // A rAF playhead rather than the `timeupdate` event: timeupdate fires about
  // four times a second, which draws a visibly stepping line. This also does
  // the stop check, so the boundary is honoured smoothly.
  const tick = () => {
    if (node._pixLaAudio !== el) return;                 // stopped or replaced
    if (el.currentTime >= node._pixLaStopAt) { stopPlay(node); return; }
    node._pixLaPlayAt = el.currentTime;
    repaintWave(node);
    node._pixLaPlayRaf = requestAnimationFrame(tick);
  };
  node._pixLaPlayRaf = requestAnimationFrame(tick);
}

export function stopPlay(node) {
  if (!node) return;
  const el = node._pixLaAudio;
  if (el) {
    // NOT src = "": an empty src resolves against the document URL, so the
    // browser re-requests the ComfyUI page as media and logs an error.
    try { el.pause(); el.removeAttribute("src"); el.load(); } catch (_e) { /* already torn down */ }
  }
  node._pixLaAudio = null;
  if (node._pixLaPlayRaf) {
    try { cancelAnimationFrame(node._pixLaPlayRaf); } catch (_e) { /* ignore */ }
    node._pixLaPlayRaf = null;
  }
  node._pixLaPlayAt = null;
  const els = node._pixLaEls;
  if (els) {
    els.play.className = "play";
    els.playBtn.title = "Play the selected part";
    repaintWave(node);                                   // clear the playhead
  }
}

/** Draw everything from what we already know. No fetching, no decoding. */
function paint(node, peaks, dur, error) {
  const els = node?._pixLaEls;
  // Guard on the ELEMENTS, NOT on isConnected: the first render comes from a
  // queueMicrotask in onNodeCreated, before ComfyUI has attached the widget
  // element, so an isConnected gate silently skips it. destroyFace nulls _els,
  // which is the real protection against painting into a dead widget.
  if (!els) return;
  const st = readState(node);
  node._pixLaDur = dur;

  const len = windowSeconds(node, st, dur);
  const sel = dur > 0 && len > 0
    ? { from: st.start / dur, to: Math.min(1, (st.start + len) / dur) }
    : null;
  // Pass the CSS size: canvasBackingScale caps the backing buffer against it,
  // and calling it bare lets a zoomed-in node allocate a needlessly huge canvas.
  const frac = (v) => (v != null && dur > 0) ? Math.max(0, Math.min(1, v / dur)) : null;
  const cue = Number.isFinite(node._pixLaCue) ? node._pixLaCue : null;
  drawWave(els.wave, peaks, sel, accentOf(node),
    canvasBackingScale(els.wave.clientWidth, els.wave.clientHeight),
    { play: frac(node._pixLaPlayAt), cue: frac(cue) });
  els.tA.textContent = dur > 0 ? "0:00" : "";
  els.tB.textContent = dur > 0 ? fmtTime(dur) : "";
  els.tSel.textContent = dur > 0 && len > 0
    ? `${fmtTime(st.start)} – ${fmtTime(Math.min(dur, st.start + len))}`
    : "";

  let text = "";
  let cls = "";
  if (error) { text = "could not read that file"; cls = "bad"; }
  // Name the BUTTON, not the action. "Pick a file" left people hunting for
  // where, when Upload was sitting right there unread.
  else if (!st.file) text = "click Upload, or choose a file above";
  else {
    // Name where the length came from. A number you did not work out yourself
    // should say so, and say when it is only a guess.
    let src;
    if (durationWired(node)) {
      src = upstreamSeconds(node) != null ? "length from the wire"
        : (node._pixLaRun?.wired ? "length from the last run" : "length not known until you run");
    } else {
      src = st.whenUnwired === "length" ? "length from settings" : "whole file from here";
    }
    text = `taking ${len.toFixed(2)}s · ${src}`;
    if (dur > 0 && st.start + len > dur + 0.01) {
      text = `${len.toFixed(2)}s wanted, file ends first · `
        + (st.whenShort === "loop" ? "will loop" : "will pad with silence");
      cls = "warn";
    }
  }
  els.tx.textContent = text;
  els.tx.className = "tx " + cls;
}

/**
 * Repaint from the cached decode. This is what the ResizeObserver calls.
 *
 * It exists because node.onResize does NOT reliably fire for a DOM widget
 * (Vue Compat #13), and a canvas that was measured while its wrapper was
 * display:none keeps that size forever. ComfyUI hides the wrapper whenever the
 * node is off-screen or the canvas is zoomed well out, so "drop the node, pan
 * away, pan back" left a 2x2 canvas and an empty box - measured, not guessed.
 */
export function repaintWave(node) {
  const st = readState(node);
  const c = node?._pixLaPeaks;
  const fresh = c && c.file === st.file;
  paint(node, fresh ? c.peaks : null, fresh ? c.duration : 0, fresh ? c.error : false);
}

export function renderFace(node) {
  const els = node?._pixLaEls;
  if (!els) return;
  const st = readState(node);

  els.nm.textContent = st.file || "choose a sound file";
  els.nm.style.color = st.file ? "#ddd" : "rgba(255,255,255,0.45)";
  els.inp.value = st.start.toFixed(2);

  if (!st.file) { paint(node, null, 0, false); return; }

  // Draw what we already have first so a re-render never blanks the box, then
  // paint again when the decode lands.
  repaintWave(node);

  const token = (node._pixLaToken = (node._pixLaToken || 0) + 1);
  loadPeaks(st.file, audioFileUrl(st.file)).then((res) => {
    // A stale decode must not paint over a newer selection: pick file A then
    // quickly file B, and A's slower decode would otherwise land last. The
    // _pixLaEls check catches the node being deleted mid-decode.
    if (node._pixLaToken !== token || !node._pixLaEls) return;
    node._pixLaPeaks = { file: st.file, ...res };
    paint(node, res.peaks, res.duration, res.error);
  });
}

export function destroyFace(node) {
  stopPlay(node);
  closePopup();
  try { node?._pixLaRO?.disconnect(); } catch (_e) { /* already gone */ }
  if (node) {
    node._pixLaRO = null;
    node._pixLaEls = null;
    node._pixLaPeaks = null;
    node._pixLaCue = null;
  }
}
