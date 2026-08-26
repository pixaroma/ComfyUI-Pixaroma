import { app } from "/scripts/app.js";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { api } from "/scripts/api.js";
import { isVueNodes, applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import {
  registerNodeSettings, createAccentSection, accentOf, applyAccent, installNodeAccent,
} from "../shared/node_settings.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { createPixaromaColorPicker } from "../shared/color_picker.mjs";
import { pixApiUrl, pixAsset } from "../shared/api_url.mjs";
// openFontPopup injects its own CSS, so there is nothing else to import here.
import { openFontPopup } from "../shared/font_picker.mjs";
import { getFontCatalog, loadFontForLayer } from "../framework/fonts.mjs";
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

const MIN_W = 130;   // absolute safety floor if a measurement ever returns junk
const BASE_H = 50;   // node height AT SCALE 1 (the original, un-resized clock)

// ── the clock scales with the node (2026-08-16) ─────────────────────────────
// Asked for on Discord: "make it bigger so I can read it across the room."
//
// WIDTH IS THE HANDLE, and the height follows from it. That is not a taste
// call, it is what each renderer allows (measured live, frontend 1.4x):
//   • NODES 2.0 REJECTS a height write. setSize([300,180]) came back as
//     [300, 13.3] while the node rendered 43px tall - the height is derived
//     from the widget's CONTENT and the layout store owns it. The WIDTH write
//     took (139 -> 300). So there, scaling the font is what makes the node
//     taller, and we must never write the height at all.
//   • CLASSIC has one resize handle (the bottom-right corner) and honours
//     node.size, so we read the width the user dragged and set the height
//     ourselves. Dragging the corner therefore scales the clock and the node
//     keeps hugging it - no empty black margin, which is the whole look.
// One rule, both renderers: scale = node width / the clock's width at scale 1.
const MIN_S = 0.45;  // Nodes 2.0 has no width clamp: shrink to fit, never clip
const MAX_S = 8;     // sanity cap (a ~400px tall clock) so a stray drag can't
                     // produce a 4000px node that is a pain to grab back

// Every hard-coded pixel of the clock face, at scale 1. The canvas painter and
// the Nodes 2.0 CSS both multiply these by the scale, so the two renderers stay
// the same clock. Change a number here, not in one of the two renderers.
const M = {
  num: 30, frac: 19, unit: 13,  // font sizes
  ls: 1,                         // letter-spacing between digits
  gap: 5,                        // half-gap either side of the colon
  unitDx: 2, unitDy: 8,          // superscript offset from the digits
  padX: 26,                      // breathing room either side of the readout
  dotR: 3.5, dotAt: 11,          // status dot radius + centre
  radius: 8,                     // screen corner radius
};

const DEFAULT_STATE = {
  version: 1,
  color: BRAND,   // clock digit color
  decimals: 0,    // 0 = m:s (default), 2 = + hundredths, 3 = + milliseconds
  font: "",       // "" = the built-in monospace clock face; else a catalog id
                  // (the SAME font library Text Overlay / Watermark / Note use)
  // OFF by default (2026-08-13, the user's call after people asked for it). A
  // node that starts making a noise the first time you press Run is the kind of
  // thing you have to go and switch off, and the clock is the point of this node
  // - the chime is the extra. Turn it on per timer in the right-click panel.
  // Deliberately NOT done by defaulting the MASTER mute to on: that switch is a
  // user-facing "silence everything" override, and defaulting it true would show
  // every panel as muted with its rows dimmed, which reads as something being
  // wrong rather than as a default.
  chime: false,   // play a sound on finish

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

// ── master mute (GLOBAL, not per node) ──────────────────────────────────────
// One switch that silences the finish chime on EVERY Run Timer, in every
// workflow. It lives in the node's own settings panel (it used to also have a
// row in ComfyUI's Settings panel; node-specific options moved onto the node).
// The id is unregistered, so isMuted() supplies the default itself. It persists
// on its own (no node.properties, so a run/mute can never dirty a workflow).
const MUTE_ID = "Pixaroma.RunTimer.Muted";
function isMuted() {
  try { return app.ui.settings.getSettingValue(MUTE_ID) === true; }
  catch (_e) { return false; }
}
function setMuted(on) {
  try {
    const s = app.ui.settings;
    const r = s.setSettingValueAsync
      ? s.setSettingValueAsync(MUTE_ID, !!on)
      : s.setSettingValue(MUTE_ID, !!on);
    if (r && typeof r.catch === "function") r.catch(() => {});
  } catch (e) {
    console.warn("[Run Timer Pixaroma] could not save the mute setting:", (e && e.message) || e);
  }
}

// ── sounds (shared with Notify Pixaroma's library) ──────────────────────────
let _soundsCache = [];
let _soundsPromise = null;
// force=true re-fetches (the settings panel passes it on every open, so a sound
// dropped into the folder mid-session appears without a page reload - the old
// single-flight promise never reset, so the panel's per-open fetchSounds() call
// silently served the very first fetch forever). Unforced calls keep the cached
// promise: maybeChime relies on that fast path for a very quick first run.
function fetchSounds(force = false) {
  if (_soundsPromise && !force) return _soundsPromise;
  _soundsPromise = fetch(pixApiUrl("/pixaroma/api/sounds"), { cache: "no-store" })
    .then((r) => r.json())
    .then((j) => (Array.isArray(j && j.sounds) ? j.sounds : []))
    .catch(() => _soundsCache || []);
  return _soundsPromise;
}
function defaultSound() {
  if (_soundsCache.indexOf("Vista.mp3") >= 0) return "Vista.mp3";
  return _soundsCache[0] || "";
}
async function playSound(filename, volume01) {
  if (typeof filename !== "string" || !filename) return;
  const url = pixAsset(`sounds/${encodeURIComponent(filename)}`);
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
// The exact string the face is showing. The rAF loop repaints ONLY when this
// changes, which at the DEFAULT 0 decimals is once a SECOND instead of 60 times
// (see the loop for the measurement). Derived from the same clockParts() both
// painters use, so it can never be coarser than what is on screen: at 2 or 3
// decimals it differs every frame and the repaint rate is unchanged.
function readoutSig(node) {
  const p = clockParts(node._rtDisplayMs || 0, node._pixRtDecimals ?? DEFAULT_STATE.decimals);
  return p.groups.map((g) => g.num + g.unit).join(":") + p.frac;
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
  // Foreground only - see refreshClock for why the background flag is waste.
  if (!isVueNodes()) node.setDirtyCanvas && node.setDirtyCanvas(true, false);
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
  // FOREGROUND ONLY. The clock is painted in onDrawForeground and the body hook
  // wraps drawNode - both are foreground work. The background canvas carries the
  // GRID and the GROUPS, which a ticking digit cannot change, so asking for it
  // was pure waste on every single frame of every run. MEASURED on an 80-node
  // graph at 2135x1881: 15.36 ms/frame with the background, 3.68 ms without.
  if (!isVueNodes()) { node.setDirtyCanvas && node.setDirtyCanvas(true, false); }
  else paint(node);
}

// ── the clock face: fonts, layout, measurement ──────────────────────────────
// ONE layout function serves BOTH the width measurement and the canvas painter.
// They used to compute widths separately with slightly different formulas, which
// is a drift waiting to happen the moment the face changes (and it did: the
// measure carried a letter-spacing fudge the painter did not apply).

/** The canvas/CSS font stack for this node: the chosen catalog font if one is
 *  loaded, else the built-in monospace clock face. */
function clockFontStack(node) {
  const v = node._rtFontVar;
  return v
    ? `"Pix-${v.fontId}${v.italic ? "-Italic" : ""}",'Consolas','DejaVu Sans Mono',ui-monospace,monospace`
    : "'Consolas','DejaVu Sans Mono',ui-monospace,monospace";
}
function clockFonts(node, s) {
  const stack = clockFontStack(node);
  // A catalog font is registered at the weight resolveFontVariant picked, so ask
  // for THAT: requesting 600 from a static 400-only face (Bebas Neue, Anton)
  // makes the browser synthesize a smeared fake bold.
  const w = node._rtFontVar ? node._rtFontVar.weight : 0;
  return {
    num: `${w || 600} ${M.num * s}px ${stack}`,
    frac: `${w || 600} ${M.frac * s}px ${stack}`,
    unit: `${w || 500} ${M.unit * s}px ${stack}`,
    stack,
  };
}

// Widest digit at the current font — the fixed cell every digit is drawn in.
// WHY fixed cells: the built-in face is monospace, but a chosen font need not
// be, and a proportional font makes every digit a different width, so the
// centred readout would visibly shuffle sideways on every tick (and, at 3
// decimals, on every frame). Drawing each digit centred in a constant cell
// pins the layout for ANY font.
function digitCell(ctx, s) {
  let w = 0;
  for (let i = 0; i < 10; i++) w = Math.max(w, ctx.measureText(String(i)).width);
  return w + M.ls * s;
}
function numRunWidth(ctx, str, cell, dotW) {
  let w = 0;
  for (const ch of str) w += (ch === "." ? dotW : cell);
  return w;
}
function drawNumRun(ctx, str, x, midY, cell, dotW) {
  // ONE baseline for the whole run, taken from a DIGIT - never per character.
  // fillTextVC centres text on ITS OWN glyph box, which is right for a whole
  // string but wrong character-by-character: "." has a 4px-tall box against a
  // digit's 12px, so it was being centred on the digits' MIDDLE and the clock
  // read "19·886" instead of "19.886" (measured 4px off at scale 1, 17px at
  // scale 4). Widths are untouched - both the measure and the paint still use
  // cell/dotW - so nothing about the layout or the node width moves.
  const dm = ctx.measureText("0");
  const haveBox = dm && dm.actualBoundingBoxAscent != null && dm.actualBoundingBoxDescent != null;
  const prevBase = ctx.textBaseline;
  const dy = haveBox ? (dm.actualBoundingBoxAscent - dm.actualBoundingBoxDescent) / 2 : 0;
  ctx.textBaseline = haveBox ? "alphabetic" : "middle";
  for (const ch of str) {
    const c = ch === "." ? dotW : cell;
    ctx.fillText(ch, x + (c - ctx.measureText(ch).width) / 2, midY + dy);
    x += c;
  }
  ctx.textBaseline = prevBase;
  return x;
}

/** Measure the whole readout at `s`. Returns the pieces the painter needs, so
 *  the painted clock and the node width can never disagree. */
function clockLayout(ctx, node, s) {
  const parts = clockParts(node._rtDisplayMs || 0, node._pixRtDecimals != null ? node._pixRtDecimals : 0);
  const f = clockFonts(node, s);
  ctx.font = f.num;
  const numCell = digitCell(ctx, s);
  const numDot = ctx.measureText(".").width;
  const colonW = ctx.measureText(":").width;
  ctx.font = f.frac;
  const fracCell = digitCell(ctx, s);
  const fracDot = ctx.measureText(".").width;
  const segs = parts.groups.map((g, i) => {
    ctx.font = f.num;
    const numW = numRunWidth(ctx, g.num, numCell, numDot);
    let fracW = 0;
    if (parts.frac && i === parts.groups.length - 1) {
      ctx.font = f.frac;
      fracW = numRunWidth(ctx, parts.frac, fracCell, fracDot);
    }
    ctx.font = f.unit;
    const unitW = ctx.measureText(g.unit).width;
    return { g, numW, fracW, unitW };
  });
  let total = 0;
  segs.forEach((sg, i) => {
    if (i > 0) total += M.gap * 2 * s + colonW;
    total += sg.numW + sg.fracW + M.unitDx * s + sg.unitW;
  });
  return { parts, f, segs, total, colonW, numCell, numDot, fracCell, fracDot };
}

// ── node width <-> scale ────────────────────────────────────────────────────
// The node's width at scale 1 (readout + breathing room). Cached per
// shape+font: it costs ~20 measureText calls and the painter runs every frame.
let _measCanvas = null;
function measureCtx() {
  if (!_measCanvas) _measCanvas = document.createElement("canvas");
  return _measCanvas.getContext("2d");
}
function shapeSig(node) {
  const parts = clockParts(node._rtDisplayMs || 0, node._pixRtDecimals != null ? node._pixRtDecimals : 0);
  // The DIGIT COUNT per group matters, not just how many groups there are: the
  // hour group is unpadded String(h), so 1h is one cell and 10h is two. Keyed on
  // the count alone, a run crossing 10 hours kept the 1-digit width and the side
  // padding quietly collapsed. Minutes and seconds are always pad(_,2), so this
  // can only change at an hour boundary - never per tick.
  const shape = parts.groups.map((g) => g.num.length).join(",");
  return shape + "|" + (parts.frac ? parts.frac.length : 0) + "|" + (node._rtFontKey || "");
}
function clockUnitWidth(node) {
  const sig = shapeSig(node);
  if (node._rtUnitSig === sig && node._rtUnitW > 0) return node._rtUnitW;
  const w = Math.max(MIN_W, Math.round(clockLayout(measureCtx(), node, 1).total + M.padX));
  node._rtUnitSig = sig;
  node._rtUnitW = w;
  return w;
}
/** The scale a box of `boxW` px asks for. `floorAtOne` for the size writers
 *  (classic can be clamped, so it never renders below the original size);
 *  the painter passes false so a too-narrow Nodes 2.0 node shrinks to fit
 *  rather than spilling its digits outside the frame. */
function clockScale(node, boxW, floorAtOne) {
  const u = clockUnitWidth(node);
  if (!(u > 0) || !(boxW > 0)) return 1;
  return Math.max(floorAtOne ? 1 : MIN_S, Math.min(MAX_S, boxW / u));
}

// ── fit the node to the clock (the Label 'fit' trick, now scale-aware) ──────
// THE one width writer. Re-hugs the node to the readout at the CURRENT scale,
// so toggling decimals or swapping the font keeps the size the user chose.
// In Nodes 2.0 the height is NOT ours to set (see the note at MIN_S) - it
// follows the content by itself.
function fitClockWidth(node) {
  if (isGraphLoading()) return; // dirty-on-load safe (trust the saved width on load)
  if (typeof node.setSize !== "function") return;
  const s = node._rtScale || 1;
  const w = Math.round(clockUnitWidth(node) * s);
  const h = Math.round(BASE_H * s);
  const vue = isVueNodes();
  const dw = Math.abs((node.size[0] || 0) - w);
  const dh = vue ? 0 : Math.abs((node.size[1] || 0) - h);
  if (dw > 1 || dh > 1) node.setSize([w, vue ? node.size[1] : h]);
}
function maybeFitWidth(node) {
  // Bail BEFORE stamping the signature. fitClockWidth bails during a load, and
  // stamping first meant the shape was recorded as "already fitted" when it
  // never was - nothing re-drives it afterwards, so the refit was lost for good.
  // The case that bites: a run passes one hour (the readout gains an h group)
  // while a workflow-tab switch is loading. The node keeps its 2-group width and
  // the painter's fit-to-box then draws the clock at ~74% inside it, letterboxed,
  // until the next run resets the shape.
  if (isGraphLoading()) return;
  const sig = shapeSig(node);
  if (node._rtWidthSig === sig) return; // only refit when the readout shape changes
  node._rtWidthSig = sig;
  fitClockWidth(node);
}
/**
 * THE RESIZE RULE (classic): the node becomes the smallest clock-shaped box that
 * CONTAINS the pointer - `scale = max(width/unit, height/BASE_H)`.
 *
 * It is a pure function of the size LiteGraph proposes, with NO history, and
 * that is the whole point. The first cut derived the scale from the WIDTH alone
 * and it felt exactly as reported: "snappy up and down, jumping text". The cause
 * is that LiteGraph proposes an ABSOLUTE size each frame (pointer minus node
 * origin), not a delta - so dragging DOWNWARD leaves the proposed width
 * untouched, the width-derived height snapped back to where it already was, the
 * node refused to grow, and the vertically-centred digits jumped as the height
 * flicked between two values.
 *
 * Anything that compares against the size we ourselves wrote last frame
 * oscillates for the same reason: after we grow the node past the pointer, the
 * next proposal is still measured from the pointer, so it reads as a large
 * "movement" back the other way. max() has no such memory: as the pointer moves
 * smoothly, the scale moves smoothly, in whichever direction is being pulled.
 */
function applyResizeAspect(node) {
  const u = clockUnitWidth(node);
  const s = Math.max(1, Math.min(MAX_S, Math.max(node.size[0] / u, node.size[1] / BASE_H)));
  node._rtScale = s;
  const w = Math.round(u * s), h = Math.round(BASE_H * s);
  if (Math.abs(node.size[0] - w) > 0.5) node.size[0] = w;
  if (Math.abs(node.size[1] - h) > 0.5) node.size[1] = h;
}
// Is THIS node's resize handle being dragged right now? LiteGraph tracks it on
// the canvas (verified live: canvas.resizing_node). It is what lets the aspect
// rule run ONLY during a real gesture - so it can never fire on the load path,
// where max() would happily "correct" a workflow saved by the pre-resize
// version (height pinned at 50, width whatever the user dragged) into a 2x clock
// on sight, and flag the untouched workflow modified.
function isResizingThis(node) {
  try { return app.canvas && app.canvas.resizing_node === node; } catch (_e) { return false; }
}

// Adopt the scale the CURRENT node size implies. Read-only (never writes
// node.size), so it is safe on the load path: a workflow saved with a big clock
// comes back big, and the scale falls out of the size that was saved.
//
// In CLASSIC the HEIGHT is the carrier, deliberately, even though a drag is read
// from the width: the height is BASE_H * scale and nothing else, whereas the
// width also depends on how wide the readout happens to be - which changes with
// the decimals AND with the chosen font. On the load path that difference is the
// whole ballgame, because a custom font has NOT loaded yet when we first
// measure, so a width-derived scale would be computed against fallback metrics
// and come out wrong. Nodes 2.0 has no choice (the height is the layout's, see
// MIN_S) and re-derives on every observer tick anyway.
function syncScaleFromSize(node) {
  if (isVueNodes()) {
    const w = (node._pixRtRoot && node._pixRtRoot.clientWidth) || node.size[0] || 0;
    node._rtScale = clockScale(node, w, false);
    return;
  }
  const h = node.size[1] || BASE_H;
  node._rtScale = Math.max(1, Math.min(MAX_S, h / BASE_H));
}

// ── the chosen font ─────────────────────────────────────────────────────────
// A clock is read at a glance, from across the room, so not every font in the
// library earns a place in this list. Judged by rendering "08:47" and
// "11:19.886" in all ten (2026-08-16):
//   • HANDWRITING is out. Caveat's digits are ambiguous at clock sizes and its
//     slant fights the m/s superscripts - it reads as a broken clock, not a
//     styled one. The rule is by CATEGORY, not by name, so a future bundled
//     script font is excluded too. A user's OWN drop-in font is category
//     "custom" and is never filtered: their font, their call.
//   • Everything else (sans, serif, display, mono) reads cleanly and stays.
const CLOCK_FONT_SKIP = ["handwriting"];
function clockFontCatalog(cat) {
  return (cat || []).filter((f) => CLOCK_FONT_SKIP.indexOf(f.category) === -1);
}
// Ask for 700, not 600. resolveFontVariant picks the CLOSEST available weight,
// and at 600 Montserrat (400/800) tie-broke to 400 and drew visibly thinner than
// every other face; at 700 it lands on 800. Inter/Roboto/Lora/Playfair get their
// 700, and the single-weight display faces (Anton, Bebas Neue) are unaffected.
const CLOCK_FONT_WEIGHT = 700;
// Loading is async (FontFace), and a canvas silently falls back to the default
// face if you set ctx.font before the file is in - so nothing is applied until
// the load resolves, and then everything is remeasured and repainted.
function applyDomFont(node) {
  if (!node._pixRtTime) return;
  node._pixRtTime.style.fontFamily = clockFontStack(node);
  // The WEIGHT too, or the two renderers draw different faces of the same font:
  // the canvas painter asks for the resolved weight (and the node is measured at
  // it), while the CSS declares none and inherits ~400 - so an Inter clock was
  // genuinely bold in classic and light in Nodes 2.0, narrower than the box the
  // scale was computed for.
  node._pixRtTime.style.fontWeight = String(node._rtFontVar ? node._rtFontVar.weight : 600);
}
async function applyClockFont(node) {
  const id = readState(node).font || "";
  // Capture the load flag BEFORE any await. fitClockWidth checks it at CALL
  // time, and this is the one caller that resumes asynchronously: the catalog
  // fetch plus the .ttf download routinely outlive isGraphLoading's 300ms
  // trailing window on a cold first open. Landing late, it re-hugged from a
  // scale recovered out of the ROUNDED height (up to 0.01 of scale lost), so
  // the width came back 1-3px off the saved one and node.size was rewritten on
  // a workflow the user only OPENED - the dirty-on-load class this node's gates
  // exist to prevent.
  const wasLoading = isGraphLoading();
  // GENERATION GUARD. The load is async, so two picks in quick succession race,
  // and the SLOWER one resolves last and wins - REPRODUCED by delaying one
  // font's file: pick Inter (slow) then Montserrat, and Montserrat renders
  // correctly until Inter lands late and overwrites it, leaving the clock drawn
  // in Inter while the saved state says Montserrat (and the node re-hugged to
  // the wrong metrics). It only self-corrects on the next workflow load. Stamp
  // each attempt and let only the newest one commit.
  const gen = (node._rtFontGen || 0) + 1;
  node._rtFontGen = gen;
  if (!id) {
    if (node._rtFontKey === "" && !node._rtFontVar) return;
    node._rtFontVar = null; node._rtFontKey = "";
  } else {
    if (node._rtFontKey === id && node._rtFontVar) return;
    try {
      const variant = await loadFontForLayer(id, CLOCK_FONT_WEIGHT, false);
      if (node._rtFontGen !== gen) return;   // a newer pick already won
      // resolveFontVariant does NOT throw for an id it has never heard of - it
      // quietly substitutes Inter (verified: asking for a nonexistent id returns
      // fontId "Inter"). So the catch below could never fire for the case its own
      // comment names, and a workflow shared with a drop-in font the recipient
      // does not have would draw in INTER: not their font, and not the built-in
      // clock face either, with nothing said. Treat a substituted variant as
      // missing. Do NOT "fix" this in resolveFontVariant - Text Overlay and
      // Watermark rely on that Inter fallback.
      if (!variant || variant.fontId !== id) {
        // WARN ONCE PER ID. Falling back sets _rtFontKey = "", which can never
        // satisfy the "already applied" memo at the top, so every later
        // applyState re-enters this branch - and applyState runs on EVERY
        // pointermove of the colour picker, which meant a warning per mousemove
        // for exactly the user the warning is meant for. Deliberately NOT
        // memoizing the RESOLVE itself: someone who installs the font, presses ↻
        // in the picker and re-picks it must still get it.
        if (node._rtFontWarned !== id) {
          console.warn("[Run Timer Pixaroma] clock font '" + id + "' is not installed; using the built-in face.");
          node._rtFontWarned = id;
        }
        node._rtFontVar = null; node._rtFontKey = "";
      } else {
        node._rtFontVar = variant; node._rtFontKey = id;
        node._rtFontWarned = null;   // installed later → warn again if it goes missing
      }
    } catch (e) {
      if (node._rtFontGen !== gen) return;
      // The file itself failed to fetch or parse.
      console.warn("[Run Timer Pixaroma] font '" + id + "' could not load:", (e && e.message) || e);
      node._rtFontVar = null; node._rtFontKey = "";
    }
  }
  node._rtUnitSig = null;   // the metrics changed → drop the cached width
  applyDomFont(node);
  // RE-DERIVE THE SCALE BEFORE RE-HUGGING. Until this await resolved, the unit
  // width was measured with the FALLBACK face, so in Nodes 2.0 - where the scale
  // comes from the rendered width divided by that unit - the scale was wrong by
  // however much the real face differs (measured: Playfair's digits are 17%
  // wider than the fallback's). The clock rendered at the wrong size on every
  // load, and the re-hug below then wrote that wrong size back into node.size,
  // so it drifted further on each open and flagged an untouched workflow as
  // modified. With the real metrics in hand the scale comes back out as the one
  // the user saved, and the fit below is a no-op.
  syncScaleFromSize(node);
  if (wasLoading) {
    // Trust the saved width: it was measured with THIS font when it was saved.
    // Stamping the signature is what makes that stick - refreshClock below calls
    // maybeFitWidth, and the signature has just changed (it includes the font
    // key), so without the stamp the fit runs there instead and the gate buys
    // nothing.
    node._rtWidthSig = shapeSig(node);
  } else {
    fitClockWidth(node);    // re-hug at the same scale, with the new metrics
  }
  refreshClock(node);
}

// Apply color + decimals + font from state and repaint.
function applyState(node) {
  const st = readState(node);
  node._pixRtDecimals = st.decimals;
  if (node._pixRtScreen) node._pixRtScreen.style.setProperty("--cc", st.color || BRAND);
  node._rtUnitSig = null;   // decimals change the readout width
  applyClockFont(node);     // async; repaints itself when the file lands
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
// `name` is captured at run START (see startAll) — the active tab can change
// while a run is in flight, so we must NOT re-query the name here at finish.
function recordRunHistory(ms, name) {
  const dur = Number(ms);
  if (!isFinite(dur) || dur < 0) return;
  const nm = (typeof name === "string" && name) ? name : activeWorkflowName();
  const entry = { ms: Math.round(dur), name: nm, at: Date.now() };
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
let _runName = "";    // active workflow name captured at run start → history label
// Is a run in flight RIGHT NOW? _runStart alone cannot answer that - it is never
// cleared, because the history needs it after the finish. See adoptLiveRun.
let _runLive = false;
// Repaint only when the readout the user can SEE has changed.
//
// This loop runs for the WHOLE duration of a run, and it used to force a full
// canvas repaint 60 times a second no matter what the clock said. At the default
// 0 decimals the digits change ONCE A SECOND, so 59 of every 60 repaints drew an
// identical face. MEASURED on an 80-node graph at 2135x1881: a forced repaint
// cost 15.36 ms, i.e. ~92% of one CPU core held for the entire generation, while
// an idle canvas costs 0. On a single-machine setup that is taken straight out of
// ComfyUI's own Python process - reported 2026-08-25 as MiniMax Music dropping
// 30.46 it/s -> 24.24 with a timer on the canvas and -> 15.24 with an unpacked
// subgraph, which is the node-count scaling this cost has.
//
// Every OTHER caller of refreshClock is a discrete event (run start, finish,
// colour, font, decimals) and still repaints unconditionally, so nothing that
// changes the face for a non-text reason can be skipped here.
function loop() {
  let anyRunning = false;
  const now = performance.now();
  for (const node of _timers) {
    if (node._rtRunning) {
      anyRunning = true;
      node._rtDisplayMs = now - node._rtStart;
      const sig = readoutSig(node);
      if (node._rtReadoutSig !== sig) {
        node._rtReadoutSig = sig;
        refreshClock(node);
      }
    }
  }
  _rafId = anyRunning ? requestAnimationFrame(loop) : null;
}
function ensureLoop() { if (_rafId == null) _rafId = requestAnimationFrame(loop); }

/**
 * Join a run that is ALREADY under way.
 *
 * Reported 2026-08-12 and reproduced by the user: start a workflow, switch to
 * another tab, come back, and the clock has stopped even though the workflow is
 * still going. Switching tabs TEARS DOWN the node - it leaves `_timers` through
 * onRemoved - and coming back builds a FRESH one whose `_rtRunning` is false, so
 * nothing counts it and it sits on the previous run's frozen total.
 *
 * The run itself is global (`execution_start` .. finish), so a timer that
 * appears mid-run can simply adopt it, counting from the RUN's own origin rather
 * than from zero - which is also what keeps its total honest if it is on screen
 * when the run ends.
 *
 * Writes only RUNTIME fields, so it cannot dirty a workflow on the load path it
 * runs from (Vue Compat #18); `refreshClock`'s width fit already bails during
 * `isGraphLoading()`.
 */
function adoptLiveRun(node) {
  if (!_runLive || _runStart == null || node._rtRunning) return;
  clearTimeout(node._rtDotT);
  node._rtRunning = true;
  node._rtStart = _runStart;
  node._rtDisplayMs = performance.now() - _runStart;
  setDot(node, "run");
  refreshClock(node);
  ensureLoop();
}

function startAll() {
  _runLive = true;
  _runStart = performance.now(); // one origin for the run → history duration
  _runName = activeWorkflowName(); // capture the workflow NOW (at start), not at
                                   // finish — the active tab may change mid-run
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
  if (!st.chime) return;   // this node's own switch
  if (isMuted()) return;   // the global master mute (panel + Settings)
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
  // Clear the in-flight flag FIRST and unconditionally: it is run-level, so it
  // must drop even when no timer node was on screen to be finished (otherwise a
  // timer added later would adopt a run that ended long ago).
  _runLive = false;
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
    recordRunHistory(performance.now() - _runStart, _runName);
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
// The live font popup's dismiss closure, so closePanel can take it down too.
let _fontPopupClose = null;
// Re-syncs the panel's master-mute row from the live setting. Set while a panel
// is open; called by the setting's onChange so flipping the mute in ComfyUI's
// Settings dialog is reflected here immediately (and vice versa).
let _panelSyncMute = null;

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
// Like toggle(), but its ON state is read LIVE from getOn() instead of an internal
// flag — so an external change (the same setting flipped in ComfyUI's Settings
// dialog) can re-sync it via .sync() with no stale-flag desync. sync(on) accepts an
// explicit value for the case where the live read would be stale (see syncMute).
function liveToggle(getOn, onChange) {
  const t = el("span", "pix-rt-tog");
  t.appendChild(el("span", "k"));
  t.sync = (on) => { t.classList.toggle("on", on != null ? !!on : !!getOn()); };
  t.onclick = (e) => {
    e.stopPropagation();
    const next = !getOn();
    t.sync(next);       // optimistic: the store write may settle async
    onChange(next);
  };
  t.sync();
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

  // Master mute FIRST — it overrides everything below it. Global (every Run Timer,
  // every workflow). This panel is now the one place to change it, and the
  // right-click menu entry uses the SAME label.
  const mRow = row("Mute all Run Timers");
  mRow.title = "Master switch: no Run Timer plays its finish chime, in any workflow. The Preview button below still plays, so you can keep trying sounds out.";
  const mTog = liveToggle(isMuted, (on) => { setMuted(on); syncMute(); });
  mRow.appendChild(mTog);
  cSec.appendChild(mRow);

  // Shown only WHILE muted, so it costs no height the rest of the time. It is what
  // explains the dimmed rows below (and that Preview is the exception).
  const mHint = el("div", "pix-rt-hint");
  mHint.textContent = "No timer will chime. The settings below are ignored until you unmute. Preview still plays.";
  cSec.appendChild(mHint);

  const chRow = row("Chime on finish (this timer)");
  chRow.title = "Turns the finish sound on or off for THIS Run Timer only. Other Run Timers are not affected.";
  // liveToggle, not toggle: this same state is also driven by the mute button on
  // the Volume row below, and a plain toggle keeps its own internal flag, which
  // would go stale the moment the other surface flipped it.
  const chTog = liveToggle(() => !!readState(node).chime, (on) => { writeState(node, { chime: on }); syncMute(); });
  chRow.appendChild(chTog);
  cSec.appendChild(chRow);

  const sRow = row("Sound");
  sRow.title = "The sound this timer plays when the workflow finishes. Drop your own .mp3, .wav or .ogg files into the assets/sounds folder to add more.";
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
  // force: the panel just opened - show what is in the folder NOW, not at page load.
  fetchSounds(true).then((list) => { _soundsCache = list; fillSounds(); });
  sel.onchange = () => writeState(node, { sound: sel.value });
  sRow.appendChild(sel);
  cSec.appendChild(sRow);

  const vRow = row("Volume");
  vRow.title = "How loud this timer's finish sound is.";
  // Mute button, at the left of the slider like any media player. It drives the
  // SAME per-node chime switch as the row above - one state, two surfaces (which
  // is why both are liveToggle/synced). Added 2026-08-16 because a dimmed "70%"
  // on its own does not say WHY it is dim, and a struck-out speaker does.
  // Deliberately NOT dimmed while muted: it is the control that un-mutes, so a
  // greyed-out version of it would read as broken (the Preview precedent).
  const muteBtn = el("button", "pix-rt-mutebtn");
  muteBtn.type = "button";
  muteBtn.onclick = (e) => {
    e.stopPropagation();
    writeState(node, { chime: !readState(node).chime });
    syncMute();
  };
  vRow.appendChild(muteBtn);
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
  prev.title = "Play the chosen sound right now. This always plays, even while muted, so you can keep trying sounds out.";
  prev.onclick = (e) => {
    e.stopPropagation();
    const s = readState(node);
    playSound(s.sound || defaultSound(), (s.volume ?? 70) / 100);
  };
  vRow.appendChild(vol); vRow.appendChild(vOut); vRow.appendChild(prev);
  cSec.appendChild(vRow);

  // While the master mute is on, dim the per-node chime rows so it is obvious WHY
  // nothing plays. They stay clickable (dim-not-disabled — the Prompt Reader idiom)
  // so the user can still set this node up for when the mute comes back off. The
  // Volume row uses pix-rt-dimv, which dims only its label/slider/readout and NOT
  // the Preview button — Preview is the one control that still works while muted (a
  // click on it IS the user asking to hear the sound now — the Notify precedent), so
  // showing it greyed would read as broken.
  //
  // `force` matters: ComfyUI fires a setting's onChange BEFORE it writes the new
  // value into its store (frontend settingStore.applySettingLocally), so a re-read
  // via isMuted() from inside that handler returns the OLD value. The handler passes
  // the new value in; the panel's own click path passes nothing and reads the store,
  // which by then is written.
  function syncMute(force) {
    const on = (typeof force === "boolean") ? force : isMuted();
    const chime = !!readState(node).chime;
    // "quiet" = nothing will play, for EITHER reason. The Sound/Volume rows are
    // meaningless in both cases, so they dim in both; the chime row itself only
    // dims under the master mute, since it is the switch you would reach for.
    const quiet = on || !chime;
    mTog.sync(on);
    chTog.sync(chime);                                   // the other surface
    muteBtn.classList.toggle("off", !chime);             // ...and the third
    muteBtn.title = chime
      ? "Mute this timer (the same switch as Chime on finish above)"
      : "Unmute this timer";
    muteBtn.setAttribute("aria-label", chime ? "Mute this timer" : "Unmute this timer");
    chRow.classList.toggle("pix-rt-dim", on);
    sRow.classList.toggle("pix-rt-dim", quiet);
    vRow.classList.toggle("pix-rt-dimv", quiet);
    mHint.style.display = on ? "block" : "none";
    requestAnimationFrame(reclampPanel);  // the hint changes the panel height
  }
  syncMute();
  _panelSyncMute = syncMute;

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

  // ── Clock font ──
  // The SAME font library Text Overlay / Text Watermark / Composer text use
  // (bundled faces + anything dropped into ComfyUI/models/fonts), through the
  // SAME picker - js/shared/font_picker.mjs - so there is one control to learn
  // and one to maintain. Convention #14: a custom dark dropdown, never a
  // native <select>.
  const fRow = row("Clock font");
  fRow.title = "The typeface the clock is drawn in. Same font list as the Text Overlay and Watermark nodes, including your own fonts from ComfyUI/models/fonts.";
  const fBtn = el("div", "pix-rt-fontbtn");
  const fName = el("span", "name");
  const fArr = el("span", "arrow"); fArr.textContent = "▾";
  fBtn.appendChild(fName); fBtn.appendChild(fArr);
  let fontCat = [];
  const paintFontBtn = () => {
    const id = readState(node).font || "";
    if (!id) {
      fName.textContent = "Clock (default)";
      fName.style.fontFamily = "'Consolas',ui-monospace,monospace";
      return;
    }
    const hit = fontCat.find((f) => f.id === id);
    fName.textContent = hit ? hit.label : id;
    // Preview the name in its own face, but only once the file is actually in:
    // naming a font in a family that has not loaded just shows the fallback.
    loadFontForLayer(id, CLOCK_FONT_WEIGHT, false)
      .then(() => { fName.style.fontFamily = `"Pix-${id}", 'Consolas', monospace`; })
      .catch(() => { fName.style.fontFamily = "'Consolas',ui-monospace,monospace"; });
  };
  paintFontBtn();
  getFontCatalog().then((cat) => { fontCat = clockFontCatalog(cat); paintFontBtn(); }).catch(() => {});
  fBtn.onclick = (e) => {
    e.stopPropagation();
    // Keep the dismiss closure: every POINTER path closes the popup by itself,
    // but the paths that destroy the node WITHOUT a pointerdown do not - drop a
    // workflow file onto the canvas, or press Ctrl+Z while the popup's filter
    // box has focus, and the graph reloads, closePanel runs, and the popup is
    // left floating over the new graph. Clicking a font in it then writes to a
    // detached node and the pick is silently lost.
    _fontPopupClose = openFontPopup(fBtn, {
      catalog: fontCat,
      currentId: readState(node).font || "",
      extraTop: [{ id: "", label: "Clock (default)" }],
      filter: clockFontCatalog,   // also applied after the popup's ↻ refresh
      onPick: (id) => { writeState(node, { font: id || "" }); paintFontBtn(); applyState(node); },
      onCatalog: (cat) => { fontCat = clockFontCatalog(cat); paintFontBtn(); },
    });
  };
  fRow.appendChild(fBtn);
  dSec.appendChild(fRow);

  const colLbl = el("div", "pix-rt-sublbl"); colLbl.textContent = "Clock color";
  dSec.appendChild(colLbl);
  const picker = createPixaromaColorPicker({
    initialColor: st.color || BRAND,
    resetColor: BRAND,
    onChange: (hex) => { writeState(node, { color: hex || BRAND }); applyState(node); },
  });
  node._pixRtPicker = picker;
  dSec.appendChild(picker.element);

  // The shared colour block goes INSIDE the Display section, not as a bare
  // sibling of it: .pix-rt-pbody has no padding of its own (the sections carry
  // it), so a sibling would sit flush against the panel's edges.
  // Distinct from the clock colour above: that paints the big digits, this
  // paints the buttons, toggles and the status dot.
  dSec.appendChild(createAccentSection(node, {
    label: "Button colour",
    hint: "Toggles, the volume slider and the status dot. This node only.",
    onChange: () => { applyAccent(_panel, node); applyState(node); },
  }));

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
  // Both the colour picker and the font picker mount on document.body, so a
  // click inside either is NOT outside this panel. Without .pix-to-popup here,
  // picking a font dismisses the settings panel underneath it (convention #19).
  if (e.target.closest && e.target.closest(".pix-cp-popup, .pix-cp-modal-backdrop, .pix-to-popup")) return;
  closePanel();
}
function escClose(e) {
  if (e.key !== "Escape" || !_panel) return;
  // The font popup owns Escape while it is open, so one press closes the popup
  // and leaves the panel standing. Both listeners are capture-phase on document,
  // so stopPropagation cannot arbitrate this - only the check can.
  if (document.querySelector(".pix-to-popup")) return;
  e.stopPropagation();
  closePanel();
}
function closePanel() {
  // Take the font popup down with the panel (see the note at the open site).
  // dismiss is idempotent, and it also detaches the popup's own document
  // listeners + its IntersectionObserver, which removing the element would not.
  if (_fontPopupClose) { try { _fontPopupClose(); } catch (_e) {} _fontPopupClose = null; }
  destroyPicker(_panelNode);
  if (_panel) { try { _panel.remove(); } catch (_e) {} }
  _panel = null; _panelNode = null; _panelSyncMute = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}
function openPanel(node) {
  closePanel();
  injectCSS();
  const panel = el("div", "pix-rt-panel");
  applyAccent(panel, node);   // the panel's own toggles/slider follow the accent
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
    // ── EVERY size below is a calc() off --rt-s, the scale the node's width asks
    //    for (installVueScaleObserver sets it). That is what makes the clock
    //    resizable in Nodes 2.0: the font grows, and the node's height follows
    //    the content by itself. The numbers match the M table used by the
    //    classic canvas painter, so the two renderers draw the same clock.
    //    font-feature-settings tnum keeps a chosen (proportional) font's digits
    //    on a fixed advance, the DOM counterpart of the painter's digit cells.
    ".pix-rt-root{display:flex;padding:0;box-sizing:border-box;width:100%;height:100%;user-select:none;-webkit-user-select:none;}",
    ".pix-rt-screen{flex:1;min-width:0;position:relative;display:flex;align-items:center;justify-content:center;background:#0c0c0e;border:1px solid #1d1d20;border-radius:calc(8px * var(--rt-s,1));padding:calc(6px * var(--rt-s,1));box-sizing:border-box;}",
    ".pix-rt-time{display:flex;align-items:center;justify-content:center;gap:calc(4px * var(--rt-s,1));font-family:'Consolas','DejaVu Sans Mono','SF Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;font-feature-settings:'tnum' 1;white-space:nowrap;color:var(--cc,#f66744);}",
    ".pix-rt-cseg{display:inline-flex;align-items:flex-start;}",
    ".pix-rt-numwrap{display:inline-flex;align-items:baseline;line-height:1;}",
    ".pix-rt-num{font-size:calc(30px * var(--rt-s,1));letter-spacing:calc(1px * var(--rt-s,1));}",
    ".pix-rt-frac{font-size:calc(19px * var(--rt-s,1));opacity:0.85;letter-spacing:calc(0.5px * var(--rt-s,1));}",
    ".pix-rt-colon{font-size:calc(30px * var(--rt-s,1));line-height:1;opacity:0.7;}",
    ".pix-rt-unit{font-size:calc(13px * var(--rt-s,1));line-height:1;margin-left:calc(2px * var(--rt-s,1));margin-top:calc(2px * var(--rt-s,1));opacity:0.5;}",
    ".pix-rt-dot{position:absolute;top:calc(6px * var(--rt-s,1));left:calc(7px * var(--rt-s,1));width:calc(7px * var(--rt-s,1));height:calc(7px * var(--rt-s,1));border-radius:50%;background:#6b6b72;}",
    ".pix-rt-dot.run{background:#3ec371;animation:pixRtPulse 1s infinite;}",
    ".pix-rt-dot.done{background:var(--pix-acc,#f66744);}",
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
    // padding:0 is load-bearing, NOT tidying. The frontend gives every widget
    // row a 12px RIGHT padding (its output-dot gutter). On a node whose body IS
    // the dark clock screen, that padding is 12px of bare node left showing past
    // the screen's right edge - the "gray contour sticking out on the right"
    // reported 2026-08-16. MEASURED: node right edge 730 vs screen right edge
    // 719.2; with this rule both are 730. Same family as the grid-template-columns
    // fix below, different cause, so fixing one never fixed the other.
    ".lg-node:has(.pix-rt-root) .lg-node-widget{gap:0!important;width:100%!important;padding:0!important;}",
    ".lg-node:has(.pix-rt-root) .lg-node-widget > *:first-child{display:none!important;}",
    ".lg-node:has(.pix-rt-root) .lg-node-content{padding:0!important;}",
    ".lg-node:has(.pix-rt-root) [class*=\"component-node-background\"]{padding:0!important;gap:0!important;background:transparent!important;}",
    // ⚠️ The footer row is matched by its OWN class, never with a nested
    // descendant ":has(.bg-node-component-surface)". That form has to be
    // re-evaluated against every div in the document on every class change, and
    // ComfyUI changes node classes constantly while you pan/zoom/hover/select.
    // MEASURED in Nodes 2.0 on a 56-node graph over 40 class-churn frames:
    // 0.33 ms/frame with our CSS off, 7.56 as shipped, 1.01 after this change -
    // this one selector was ~90% of the cost. See label/render.mjs for the full
    // note; Label and Monitor carry the identical rule and the identical fix.
    ".lg-node:has(.pix-rt-root) [class*=\"component-node-background\"] > div.text-muted-foreground,.lg-node:has(.pix-rt-root) .bg-node-component-surface{display:none!important;}",
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
    // Master mute ON → the per-node chime rows are overridden. Dim, NOT disabled:
    // they stay clickable (so you can still set the node up). pix-rt-dimv dims the
    // Volume row EXCEPT its Preview button — Preview still plays while muted, so it
    // must not look greyed out. (Child opacity can't undo a parent's, hence the
    // per-child rule rather than dimming the whole row.)
    ".pix-rt-dim{opacity:0.45;}",
    ".pix-rt-dimv > .pix-rt-lbl,.pix-rt-dimv > .pix-rt-vol,.pix-rt-dimv > .pix-rt-volout{opacity:0.45;}",
    // Mute button on the Volume row. The icon is the BUNDLED SVG used as a CSS
    // mask, never an emoji (house rule #28): an emoji is drawn by the OS, so it
    // is a different shape on Windows/Mac/Linux and sits on its own baseline.
    ".pix-rt-mutebtn{background:transparent;border:1px solid #444;border-radius:4px;width:26px;height:26px;padding:0;cursor:pointer;flex:none;display:flex;align-items:center;justify-content:center;}",
    ".pix-rt-mutebtn:hover{border-color:var(--pix-acc,#f66744);}",
    ".pix-rt-mutebtn::before{content:\"\";display:block;width:14px;height:14px;background:#ccc;-webkit-mask:url(\"" + pixAsset("icons/ui/audio.svg") + "\") center/contain no-repeat;mask:url(\"" + pixAsset("icons/ui/audio.svg") + "\") center/contain no-repeat;}",
    ".pix-rt-mutebtn:hover::before{background:var(--pix-acc,#f66744);}",
    ".pix-rt-mutebtn.off::before{background:#8a8a8a;-webkit-mask-image:url(\"" + pixAsset("icons/ui/mute.svg") + "\");mask-image:url(\"" + pixAsset("icons/ui/mute.svg") + "\");}",
    ".pix-rt-hint{display:none;font-size:11px;line-height:1.35;color:#8a8a8a;margin:-3px 0 9px;}",
    ".pix-rt-sublbl{font-size:11px;color:#888;margin:2px 0 8px;}",
    ".pix-rt-tog{width:34px;height:18px;border-radius:9px;background:#3a3a3a;position:relative;cursor:pointer;flex:none;transition:background .15s;}",
    ".pix-rt-tog .k{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#bbb;transition:left .15s,background .15s;}",
    ".pix-rt-tog.on{background:var(--pix-acc,#f66744);}",
    ".pix-rt-tog.on .k{left:18px;background:#fff;}",
    ".pix-rt-select{background:#1a1a1a;border:1px solid #444;color:#ddd;border-radius:4px;font-size:12.5px;padding:5px 7px;font-family:inherit;cursor:pointer;max-width:150px;}",
    ".pix-rt-select:focus{outline:none;border-color:var(--pix-acc,#f66744);}",
    // The font picker's closed state: deliberately the same box as .pix-rt-select
    // above so the two rows read as one control family, even though this one
    // opens our dark popup and that one is a native list.
    ".pix-rt-fontbtn{display:flex;align-items:center;gap:6px;background:#1a1a1a;border:1px solid #444;color:#ddd;border-radius:4px;font-size:12.5px;padding:5px 7px;cursor:pointer;max-width:150px;flex:none;}",
    ".pix-rt-fontbtn:hover{border-color:var(--pix-acc,#f66744);}",
    ".pix-rt-fontbtn .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".pix-rt-fontbtn .arrow{color:var(--pix-acc,#f66744);font-size:11px;flex:none;}",
    ".pix-rt-vol{-webkit-appearance:none;appearance:none;flex:1;min-width:0;height:4px;border-radius:2px;outline:none;cursor:pointer;background:linear-gradient(to right,var(--pix-acc,#f66744) var(--fill,70%),#3a3a3a var(--fill,70%));}",
    ".pix-rt-vol::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:var(--pix-acc,#f66744);border:2px solid #1a1a1a;cursor:pointer;}",
    ".pix-rt-vol::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:var(--pix-acc,#f66744);border:2px solid #1a1a1a;cursor:pointer;}",
    ".pix-rt-vol::-moz-range-track{height:4px;border-radius:2px;background:transparent;}",
    ".pix-rt-volout{font-size:12px;color:#bbb;width:36px;text-align:right;flex:none;}",
    ".pix-rt-prev{background:transparent;border:1px solid #444;color:#ccc;border-radius:4px;font-size:12px;padding:5px 9px;cursor:pointer;flex:none;font-family:inherit;}",
    ".pix-rt-prev:hover{border-color:var(--pix-acc,#f66744);color:var(--pix-acc,#f66744);}",
    ".pix-rt-seg{display:flex;background:#0e0e0e;border:1px solid #333;border-radius:6px;padding:2px;flex:none;}",
    ".pix-rt-sg{min-width:42px;text-align:center;color:#aaa;font-size:12px;padding:5px 10px;border-radius:4px;cursor:pointer;user-select:none;}",
    ".pix-rt-sg.on{background:var(--pix-acc,#f66744);color:#fff;}",
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
  // FIT-TO-BOX, and deliberately NOT just the width: the painter is pure (it
  // writes no size), so it must stay honest about a box it did not choose - a
  // node left short by an older version, or mid-drag before onResize lands,
  // renders a smaller clock instead of spilling digits outside the frame.
  const s = Math.min(clockScale(node, w, false), Math.max(MIN_S, h / BASE_H));
  const rr = (x, y, ww, hh, r) => { if (ctx.roundRect) ctx.roundRect(x, y, ww, hh, r); else ctx.rect(x, y, ww, hh); };
  ctx.save();
  // Inside the save(): the layout sets ctx.font while measuring, and that must
  // not leak out to whatever LiteGraph draws after us.
  const L = clockLayout(ctx, node, s);
  ctx.fillStyle = "#0c0c0e";
  ctx.beginPath(); rr(0, 0, w, h, M.radius * s); ctx.fill();
  // status dot
  const dm = node._rtDotState || "idle";
  ctx.fillStyle = dm === "run" ? "#3ec371" : dm === "done" ? accentOf(node) : "#6b6b72";
  ctx.beginPath(); ctx.arc(M.dotAt * s, M.dotAt * s, M.dotR * s, 0, Math.PI * 2); ctx.fill();
  // time
  const col = readState(node).color || BRAND;
  ctx.textAlign = "left";
  let x = (w - L.total) / 2;
  const midY = h / 2;
  L.segs.forEach((sg, i) => {
    if (i > 0) {
      ctx.font = L.f.num; ctx.fillStyle = col; ctx.globalAlpha = 0.7;
      fillTextVC(ctx, ":", x + M.gap * s, midY); ctx.globalAlpha = 1;
      x += M.gap * 2 * s + L.colonW;
    }
    ctx.font = L.f.num; ctx.fillStyle = col; ctx.globalAlpha = 1;
    x = drawNumRun(ctx, sg.g.num, x, midY, L.numCell, L.numDot);
    if (sg.fracW) {
      ctx.font = L.f.frac; ctx.globalAlpha = 0.85;
      x = drawNumRun(ctx, L.parts.frac, x, midY, L.fracCell, L.fracDot);
      ctx.globalAlpha = 1;
    }
    ctx.font = L.f.unit; ctx.fillStyle = col; ctx.globalAlpha = 0.5; ctx.textBaseline = "alphabetic";
    ctx.fillText(sg.g.unit, x + M.unitDx * s, midY - M.unitDy * s);
    ctx.globalAlpha = 1; x += M.unitDx * s + sg.unitW;
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
// The node is a single clock line whose height is BASE_H * the current scale.
// No title reserve to compensate (title_mode NO_TITLE on the node type is
// consistent from mount in both renderers).
//
// CLASSIC ONLY. In Nodes 2.0 the height is the layout store's (a write there is
// silently discarded - see the note at MIN_S), so we never touch it.
function refreshNodeSize(node) {
  if (isGraphLoading()) return;
  if (isVueNodes()) return;
  try {
    if (typeof node.setSize !== "function") return;
    syncScaleFromSize(node);
    const target = Math.round(BASE_H * (node._rtScale || 1));
    if (Math.abs((node.size[1] || 0) - target) > 1) node.setSize([node.size[0], target]);
  } catch (_e) {}
}

// Nodes 2.0: the rendered WIDTH is what the user drags, so watch the widget root
// and hand the scale to the CSS (every face size is a calc() off --rt-s). The
// node then grows TALLER by itself, because its height is derived from this
// content. Vue Compat #13: node.onResize is not reliable for a DOM widget, and
// node.size lies about the rendered size - so measure the element.
//
// It deliberately writes NOTHING but a CSS variable: a ResizeObserver that calls
// setSize fires mid-drag and desyncs Align's resize guard (CLAUDE.md), and any
// serialized write here would run on the load path and false-dirty the workflow.
function installVueScaleObserver(node, root) {
  if (typeof ResizeObserver === "undefined") return () => {};
  let last = -1;
  const apply = () => {
    const w = root.clientWidth;
    if (!(w > 0)) return;
    const s = clockScale(node, w, false);
    node._rtScale = s;
    if (Math.abs(s - last) < 0.005) return;  // also stops the content-height
    last = s;                                // reflow from re-triggering us
    root.style.setProperty("--rt-s", String(s));
  };
  const ro = new ResizeObserver(apply);
  ro.observe(root);
  apply();
  return () => { try { ro.disconnect(); } catch (_e) {} };
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
    installNodeAccent(node, root);   // the status dot follows this node's accent
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
      // CONSTANTS, not a live measurement: these feed the layout's floor, and a
      // measured value creeps node.size bigger on every workflow switch
      // (CLAUDE.md). The clock grows via the font scale, not via this floor.
      getMinHeight: () => BASE_H,
      serialize: false, // state lives on node.properties
    });
    applyAdaptiveCanvasOnly(widget);
    widget.computeLayoutSize = () => ({ minHeight: BASE_H, minWidth: 1 });
    // The floor must follow the SCALE, not sit at BASE_H. It is pinned only
    // while a resize handle is dragged, which is exactly when the frontend takes
    // its collapse measurement - so a constant 50 let the bottom edge be dragged
    // up through a 4x clock, spilling 200px of digits out of the frame.
    node._pixRtFloorOff = installResizeFloor(root, () => Math.round(BASE_H * (node._rtScale || 1)));
    node._pixRtScaleOff = installVueScaleObserver(node, root);
  } else {
    // Classic: NO DOM widget — the clock is painted on the node canvas
    // (onDrawForeground), so the node is a real canvas node: draggable +
    // right-clickable, no DOM element eating clicks.
    //
    // computeSize is the SCALE-1 size, which is also LiteGraph's resize floor:
    // the corner drag cannot make the clock smaller than its original look, and
    // it grows freely from there. It is a live value (a wider readout at 3
    // decimals, or a wide font, raises the floor) - never a constant.
    node.computeSize = function () { return [clockUnitWidth(this), BASE_H]; };
  }

  // A FRESH node opens at SCALE 1 - the original compact clock. Assigned
  // synchronously (convention #9): configure() runs after this and restores the
  // saved size for a saved or duplicated node, so this only ever decides what a
  // brand-new drop looks like. Never deferred into a microtask, or it would run
  // AFTER configure and flatten every user-resized timer back to small.
  const fresh = [clockUnitWidth(node), BASE_H];
  if (Array.isArray(node.size)) { node.size[0] = fresh[0]; node.size[1] = fresh[1]; }
  else node.size = fresh;

  _timers.add(node);
  // nodeCreated fires BEFORE configure() restores node.properties (Vue Compat #8)
  // — defer so a saved timer shows its restored color/decimals + last time.
  // adoptLiveRun FIRST: if a run is still going (this node was just rebuilt by a
  // workflow-tab switch) it takes over the live count, and restoreLastRun then
  // correctly leaves the previous total alone - it early-returns while running.
  queueMicrotask(() => {
    adoptLiveRun(node);
    restoreLastRun(node);
    // BEFORE applyState: the restored WIDTH is what says how big this clock was
    // left, and every fit below re-hugs at that scale.
    syncScaleFromSize(node);
    applyState(node);
    refreshNodeSize(node);
  });
}

const HELP = {
  title: "Run Timer Pixaroma",
  tagline: "Times how long a workflow takes, and chimes when it is done.",
  sections: [
    { heading: "What it does", body: "The clock resets to zero the moment you press Run, counts up while the workflow is working, and freezes on the total time when it finishes.\n\nIt can also chime when the run is done, so you know even when you are in another browser tab or app. That is off to begin with: right-click the timer and turn on 'Chime on finish' for the timers you want to hear." },
    { heading: "A clean floating clock", body: "The node is just the clock - no title bar, no frame - so it takes very little room on the canvas. Drag it from anywhere on the clock to move it, and right-click it for the settings. It works the same in both the classic and the new node interface." },
    { heading: "Make it bigger", body: "Drag the corner of the clock and the whole thing scales up with it: digits, the little m and s, and the status dot. Handy on a second monitor, or just to see the time from across the room.\n\nDrag in any direction you like - out, down, or diagonally - and the clock keeps its shape, so it always fills the node with no empty black around it. It will not go smaller than its original size, and each timer remembers how big you made it, saved with the workflow." },
    { heading: "Pick a font for it", body: "Right-click and choose 'Clock font' to draw the time in any of the bundled fonts: condensed ones like Oswald, Bebas Neue and Anton look particularly good as a big clock, and JetBrains Mono keeps the classic digital look.\n\nIt is the same font list the Text Overlay and Watermark nodes use, so any .ttf or .otf you drop into ComfyUI/models/fonts shows up here too (press the ↻ button in the picker to pick up new ones without restarting). Handwriting fonts are left out on purpose: they are hard to read as a clock. Choose 'Clock (default)' to go back to the built-in face." },
    { heading: "Reading the clock", body: "The time shows as minutes : seconds (for example 02:47). If a run goes past an hour the clock switches to hours : minutes : seconds. A small dot in the corner is green while running and orange the moment it finishes." },
    { heading: "Comparing workflows across tabs", body: "Each workflow remembers its own last time, so you can run several workflows in different tabs and switch between them to compare how long each one took.", bullets: [
      "The time is saved with the workflow, so it is still there after you switch tabs, reload the page, or restart ComfyUI.",
      "Because it is saved with the workflow, a small 'unsaved changes' dot shows on the tab after a run. Switching tabs never asks you to save; only closing a tab asks, as always.",
      "If you switch tabs while a run is going and come back before it ends, the clock picks the run up again and carries on from the right time.",
      "If the run finishes while you are away on another tab, that time is not captured, and you will see the previous finished time when you come back.",
    ]},
    { heading: "Run time history", body: "Right-click the node and pick 'Run time history' to see the last 10 finished runs, newest first. Each line shows the workflow name and the time of day it ran, next to how long it took, and the fastest one is marked with a lightning bolt - handy for comparing how quick different workflows are. The list is shared across every workflow and is remembered between sessions (it is not saved inside any one workflow). You can copy a single line, export the whole list as a text file, or clear it. Each run is filed under whichever workflow was active when it started. Only completed runs are listed; a run you stop or that errors out is skipped." },
    { heading: "Settings (right-click the node)", defs: [
      ["Mute all Run Timers", "The master mute: no Run Timer plays its finish chime, in any workflow. It is the same switch wherever you reach it, so flipping it in one place flips it everywhere. While it is on, the rows below it are dimmed to show they are being ignored."],
      ["Chime on finish (this timer)", "Turns the finish sound on or off for this one timer only. It starts off, so a new Run Timer is silent until you switch it on here. The speaker button on the Volume row is the same switch, whichever is easier to reach."],
      ["Sound and Volume", "Pick the chime from the sound library and set how loud it is. The Preview button plays it right now, even while muted, so you can still try sounds out. When nothing is going to play, the Sound and Volume rows are dimmed and the speaker shows as muted, so a volume of 70% never looks like a sound that is about to happen."],
      ["Decimals", "Show hundredths (2), milliseconds (3), or just minutes and seconds (Off). Off is the default and by far the lightest: the clock only redraws when the second changes, so it costs almost nothing while a run is going. Hundredths and milliseconds change on every frame, so the clock has to redraw about 60 times a second for the whole run, which keeps your processor busy on a big workflow and can make the run itself a little slower. Leave it Off unless you really want the finer number."],
      ["Clock font", "The typeface for the digits: any bundled font, or your own from ComfyUI/models/fonts."],
      ["Clock color", "Pick the digit color right in the panel: tap a swatch, drag the color square, or type a hex code. Reset returns it to Pixaroma orange."],
    ]},
    { heading: "Two ways to silence it", body: "Use Mute all Run Timers when you just want quiet for a while: it silences every timer at once and is remembered until you turn it back off, and it is not tied to any workflow. Use Chime on finish when you want this one timer quiet but others still able to chime. If either one is off, no sound plays." },
    { heading: "Good to know", body: "It does not need to be wired to anything; just drop it on the canvas. Add your own chimes by dropping .mp3, .wav, or .ogg files (use simple names - letters, numbers, dashes) into the assets/sounds folder." },
  ],
};

app.registerExtension({
  name: "Pixaroma.RunTimer",

  // No Settings-panel row: this option already lives in the node's own
  // settings panel, which is the one place to change it.

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
      restoreLastRun(this);
      syncScaleFromSize(this);   // the restored size carries the chosen scale
      applyState(this); refreshNodeSize(this);
      return r;
    };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      _timers.delete(this);
      clearTimeout(this._rtDotT);
      try { if (this._pixRtFloorOff) this._pixRtFloorOff(); } catch (_e) {}
      this._pixRtFloorOff = null;
      try { if (this._pixRtScaleOff) this._pixRtScaleOff(); } catch (_e) {}
      this._pixRtScaleOff = null;
      if (_panelNode === this) closePanel();
      closeRunHistoryFor(this);
      if (_origRemoved) return _origRemoved.apply(this, arguments);
    };

    // Classic: the user drags the WIDTH and the height follows, so the node
    // always hugs the clock (see the note at MIN_S). Both writes happen here, in
    // a real user gesture - never in the painter, which must not touch a
    // serialized field on a load frame (convention #7 / Vue Compat #18).
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes()) applyResizeAspect(this);
      if (_origResize) return _origResize.apply(this, arguments);
    };

    // Classic: paint the clock onto the node canvas. Nodes 2.0 skips this (its
    // DOM clock renders instead + onDrawForeground is not the paint path).
    //
    // It ALSO carries the height derivation, because onResize alone cannot be
    // trusted with it: instrumented live through a corner drag, onResize logged
    // ONE call (our own setSize) while LiteGraph moved node.size repeatedly - so
    // a width change does land without it. Deriving here means the height is
    // right on the very next frame whichever path moved the width. (It is also
    // how the pre-resize version really pinned the height: its onResize lock was
    // largely decorative and this clamp did the work.)
    //
    // THE isGraphLoading GATE IS NOT OPTIONAL (convention #7): node.size is
    // serialized and a draw hook runs on the FIRST frame of a workflow load, so
    // an ungated write here is the one thing that can flag an untouched workflow
    // as modified. It is safe by construction too - every width we write is
    // paired with its height, so a saved pair already agrees and nothing is
    // written - but the gate is what makes that a guarantee instead of a hope.
    const _origFg = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const r = _origFg ? _origFg.apply(this, arguments) : undefined;
      if (ctx && !isVueNodes()) {
        if (!isGraphLoading()) {
          // ONLY while this node's handle is actually being dragged - outside a
          // gesture the size is not ours to touch. (onResize normally lands
          // first and has already done this; the frame after the drag ends is
          // what this is really for, plus any path that moves node.size without
          // onResize.)
          //
          // ...with ONE exception: a height that is OUT OF RANGE is not a size
          // anyone chose, so it gets repaired. This is how a timer saved in
          // NODES 2.0 survives being opened in classic. Vue owns the height
          // there and leaves a stub in node.size (MEASURED: 13.3 while the node
          // rendered 43px tall), so without the repair classic would honour that
          // stub - a 13px-tall sliver with the clock drawn at the MIN_S floor
          // inside it, and nothing left to heal it once the aspect rule is
          // gesture-gated. applyResizeAspect derives from the WIDTH, which IS
          // the scale carrier in Nodes 2.0, so the clock comes back the size the
          // user actually made it there. A legitimately-sized node always has
          // its height in range, so this can never fire on a normal open.
          const hOut = !(this.size[1] >= BASE_H - 0.5 && this.size[1] <= BASE_H * MAX_S + 0.5);
          if (isResizingThis(this) || hOut) applyResizeAspect(this);
          else syncScaleFromSize(this);
        }
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

// The gear in the node selection toolbar opens the same panel the right-click
// entry does. ownMenuItem: this node already adds its own menu line.
registerNodeSettings(NODE_NAME, {
  title: "Run Timer",
  ownMenuItem: true,
  open: (node) => openPanel(node),
});
