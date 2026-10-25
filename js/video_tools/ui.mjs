// Video Tools Pixaroma - the node face.
//
// ONE DOM widget in both renderers (the fill recipe of nodes2-preview-fill.md):
// the root fills its row, all layout lives on an inner absolute layer, and the
// result picture is the one part that grows with the node. Every other row has
// a FIXED height, so a run's result can never grow the body (convention #43);
// getMinHeight is a CONSTANT (#39 E).
//
// The result shows as a STILL; Play swaps in the moving preview (an animated
// WebP) and Stop swaps the still back, so nothing animates on the page while
// you work or while a Run is going (convention #41).

import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { installNativeTextMenu } from "../shared/native_text_menu.mjs";
import { installNodeAccent } from "../shared/node_settings.mjs";
import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/nodes2.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { passComfyShortcut } from "../shared/text_shortcuts.mjs";
import { pixApiUrl } from "../shared/api_url.mjs";
import { api } from "../../../scripts/api.js";
import { MAX_CLIPS, MAX_FPS, MAX_SPAN, MAX_TIMES, MIN_FPS, fmtSecs, planVideo, readState, secs } from "./core.mjs";
import { injectCSS } from "./css.mjs";
import { setClip, setOption } from "./actions.mjs";
import { contentMin, growToFloor, pairsShown } from "./layout.mjs";

export const WIDGET_NAME = "video_tools_ui";
export const WIDGET_TYPE = "pixaroma_video_tools";
// getMinHeight is a CONSTANT under any real content (#39 E: core grows a node to
// computeSize on every open); the real floor is measured (layout.mjs nodeFloor:
// the clip rows, the Join / Loop rows that wrap when narrow, the picture at 90).
export const FLOOR = 300;
export const MIN_W = 460;

// Clip 1 wears the node's accent, the others fixed colours (the timeline and the badges).
export const SLOT_COLORS = ["var(--pix-acc,#f66744)", "#4a90d9", "#3ec371", "#b07ae8", "#e3b341", "#3fc1c9",
  "#e86a8a", "#9aa7b4"];

// ── before the first Run: a clip's length from Load Video Pixaroma's file ──
// The frames only exist once a Run made them, but a clip wired straight from
// Load Video Pixaroma can be counted from its file and settings (the existing
// /pixaroma/api/load_video_frame/meta route, headers only): the node shows
// "~124 frames" and the timeline before you run (the user's first look,
// 2026-10-25). A clip from a model's VAE Decode still says "Run once".
const _meta = new Map();   // file -> { done, meta } | { pending }
function fileMeta(node, file) {
  const m = _meta.get(file);
  if (m) return m.done ? m.meta : null;
  _meta.set(file, { pending: true });
  api.fetchApi(`/pixaroma/api/load_video_frame/meta?video=${encodeURIComponent(file)}`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((meta) => {
      _meta.set(file, { done: true, meta: meta && meta.fps > 0 && meta.frame_count > 0 ? meta : null });
      if (node.graph) renderFace(node);
    });
  return null;
}

function upstream(node, inputName) {
  const inp = node.inputs?.find((x) => x && x.name === inputName);
  if (inp?.link == null) return null;
  const g = node.graph;
  const l = g?.links?.get ? g.links.get(inp.link) : g?.links?.[inp.link];
  const src = l ? g.getNodeById(l.origin_id) : null;
  if (!src || (src.comfyClass || src.type) !== "PixaromaLoadVideo") return null;
  return { src, out: src.outputs?.[l.origin_slot]?.name };
}

const wv = (n, name) => n.widgets?.find((x) => x.name === name)?.value;

/** { frames, fps } Load Video will give for this clip, or null (not from Load
 *  Video, not read yet). Mirrors _collect: resample, then the max_frames window,
 *  then skip_first_frames. */
function estimate(node, k) {
  const u = upstream(node, `video_${k + 1}`);
  if (!u || u.out !== "video_frames") return null;
  const file = wv(u.src, "video");
  if (!file || typeof file !== "string") return null;
  const meta = fileMeta(node, file);
  if (!meta) return null;
  const force = Number(wv(u.src, "force_fps")) || 0;
  const max = Math.max(0, Math.trunc(Number(wv(u.src, "max_frames")) || 0));
  const skip = Math.max(0, Math.trunc(Number(wv(u.src, "skip_first_frames")) || 0));
  let n = force > 0 ? Math.floor(((meta.frame_count - 1) * force) / meta.fps + 1e-9) + 1 : meta.frame_count;
  if (max) n = Math.min(n, max);
  n = Math.max(0, n - skip);
  return n > 0 ? { frames: n, fps: force > 0 ? force : meta.fps } : null;
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const viewUrl = (f) => (f?.filename
  ? pixApiUrl(`/view?filename=${encodeURIComponent(f.filename)}&type=${encodeURIComponent(f.type || "temp")}`
    + `&subfolder=${encodeURIComponent(f.subfolder || "")}`)
  : "");

export function wiredSlots(node) {
  return Array.from({ length: MAX_CLIPS }, (_, i) => {
    const inp = node.inputs?.find((x) => x && x.name === `video_${i + 1}`);
    return !!(inp && inp.link != null);
  });
}

export const fpsWired = (node) => node.inputs?.find((x) => x && x.name === "fps")?.link != null;
export const musicWired = (node) => node.inputs?.find((x) => x && x.name === "music")?.link != null;

/** The rate the seconds on the face use: the wire's (the last run's, or Load
 *  Video's file before a run), else the fps set on the node. */
export function faceFps(node) {
  const run = node._pixVdtRun;
  if (fpsWired(node)) {
    if (run?.fps > 0) return run.fps;
    const u = upstream(node, "fps");
    if (u && u.out === "fps") {
      const file = wv(u.src, "video");
      const meta = typeof file === "string" ? fileMeta(node, file) : null;
      const force = Number(wv(u.src, "force_fps")) || 0;
      if (force > 0) return force;
      if (meta?.fps > 0) return meta.fps;
    }
  }
  return readState(node).fps;
}

/** A number with - and +. `onSet(v, commit)`: commit = a finished change (a
 *  click, Enter, leaving the field), not every keystroke. */
function stepper(min, max, label, onSet) {
  const box = el("span", "pix-vdt-step");
  const minus = el("button", null, "−");
  minus.type = "button";
  minus.setAttribute("aria-label", `${label}: less`);
  const input = el("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = "1";
  input.setAttribute("aria-label", label);
  input.title = label;
  const plus = el("button", null, "+");
  plus.type = "button";
  plus.setAttribute("aria-label", `${label}: more`);
  const clamp = (v) => Math.max(min, Math.min(max, Math.trunc(Number(v) || 0)));
  const bump = (d) => {
    const v = clamp(Number(input.value || 0) + d);
    input.value = String(v);
    onSet(v, true);
  };
  minus.addEventListener("click", (e) => { e.stopPropagation(); bump(-1); });
  plus.addEventListener("click", (e) => { e.stopPropagation(); bump(1); });
  input.addEventListener("keydown", (e) => {
    if (passComfyShortcut(e, input, { blur: true, arrows: true })) return;
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
  });
  input.addEventListener("input", () => { if (input.value !== "") onSet(clamp(input.value), false); });
  input.addEventListener("change", () => { input.value = String(clamp(input.value)); onSet(clamp(input.value), true); });
  box.append(minus, input, plus);
  return {
    el: box,
    set(v) { if (document.activeElement !== input) input.value = String(v); },
  };
}

function segmented(options, label, onPick) {
  const box = el("span", "pix-vdt-seg");
  box.setAttribute("role", "radiogroup");
  box.setAttribute("aria-label", label);
  const btns = options.map(([key, text, tip]) => {
    const b = el("button", null, text);
    b.type = "button";
    b.dataset.key = key;
    b.setAttribute("role", "radio");
    if (tip) b.title = tip;
    b.addEventListener("click", (e) => { e.stopPropagation(); onPick(key); });
    box.appendChild(b);
    return b;
  });
  return {
    el: box,
    set(cur) { for (const b of btns) { const on = b.dataset.key === cur; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); } },
  };
}

function toggle(text, tip, onFlip) {
  const b = el("span", "pix-vdt-sw");
  b.setAttribute("role", "switch");
  b.tabIndex = 0;
  b.title = tip;
  b.append(el("i"), el("span", null, text));
  const fire = (e) => { e.stopPropagation(); onFlip(); };
  b.addEventListener("click", fire);
  b.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); fire(e); } });
  return { el: b, set(on) { b.classList.toggle("on", !!on); b.setAttribute("aria-checked", String(!!on)); } };
}

export function buildFace(node, { onGear }) {
  injectCSS();
  const root = el("div", "pix-vdt-root");
  const inner = el("div", "pix-vdt-inner");
  root.appendChild(inner);

  // ── the result ──
  const stage = el("div", "pix-vdt-stage");
  const img = el("img");
  img.alt = "The finished video";
  img.draggable = false;
  img.style.display = "none";
  const empty = el("div", "pix-vdt-empty", "Wire a video into v1 (and more clips into v2, v3...), then Run.\nThe finished video shows here.");
  empty.style.whiteSpace = "pre-line";
  const play = el("button", "pix-vdt-play", "▶ Play");
  play.type = "button";
  play.title = "Play the finished video here (a small moving preview, without sound)";
  play.addEventListener("click", (e) => { e.stopPropagation(); setPlaying(node, !node._pixVdtPlaying); });
  const gear = el("button", "pix-vdt-gear");
  gear.type = "button";
  gear.title = "Settings";
  gear.setAttribute("aria-label", "Video Tools settings");
  gear.addEventListener("click", (e) => { e.stopPropagation(); onGear(); });
  stage.append(img, empty, play, gear);

  const tl = el("div", "pix-vdt-tl");
  // The line under the timeline: what comes out, and the frame rate. The fps
  // stepper is the rate when nothing is wired into fps (a wire wins).
  const infoRow = el("div", "pix-vdt-inforow");
  const info = el("div", "pix-vdt-info", "");
  const fpsBox = stepper(MIN_FPS, MAX_FPS, "Frames per second of the clips (when nothing is wired into fps)",
    (v, commit) => setOption(node, "fps", v, !commit));
  const fpsF = el("span", "pix-vdt-f pix-vdt-fps");
  fpsF.append(el("span", null, "fps"), fpsBox.el);
  infoRow.append(info, fpsF);

  // ── the clips: one row per input pair the node shows (layout.mjs) ──
  const grid = el("div", "pix-vdt-clips");
  grid.append(el("span"), el("span"), el("span"), el("span", "hd", "Cut start"), el("span", "hd", "Cut end"),
    el("span", "hd", "Back"));
  const rows = [];
  for (let i = 0; i < MAX_CLIPS; i++) {
    const badge = el("span", "pix-vdt-badge", String(i + 1));
    badge.style.background = SLOT_COLORS[i];
    const th = el("span", "pix-vdt-th");
    const cinfo = el("span", "pix-vdt-cinfo", "");
    const cs = stepper(0, 100000, `Clip ${i + 1}: frames cut from the start`, (v, commit) => setClip(node, i, "cutStart", v, !commit));
    const ce = stepper(0, 100000, `Clip ${i + 1}: frames cut from the end`, (v, commit) => setClip(node, i, "cutEnd", v, !commit));
    // the cut in seconds under each number, like Join and Fade
    const csS = el("small");
    const ceS = el("small");
    const csC = el("span", "pix-vdt-cut");
    csC.append(cs.el, csS);
    const ceC = el("span", "pix-vdt-cut");
    ceC.append(ce.el, ceS);
    const rev = el("button", "pix-vdt-rev", "⟲");
    rev.type = "button";
    rev.title = "Play this clip backwards";
    rev.setAttribute("aria-label", `Play clip ${i + 1} backwards`);
    rev.addEventListener("click", (e) => { e.stopPropagation(); setClip(node, i, "reverse", !readState(node).clips[i].reverse); });
    const cells = [badge, th, cinfo, csC, ceC, rev];
    grid.append(...cells);
    rows.push({ badge, th, cinfo, cs, ce, csS, ceS, rev, cells });
  }

  // ── join ──
  const joinSec = el("div", "pix-vdt-sec");
  const joinSeg = segmented([
    ["cut", "Cut", "Clip after clip, no transition"],
    ["crossfade", "Crossfade", "The end of one clip melts into the start of the next (the video gets a little shorter)"],
    ["black", "Through black", "Fade to black, then up from black into the next clip"],
  ], "How the clips are joined", (k) => setOption(node, "join", k));
  const jLen = stepper(1, MAX_SPAN, "Transition length in frames", (v, commit) => setOption(node, "joinFrames", v, !commit));
  const jLenF = el("span", "pix-vdt-f");
  const jSecs = el("small");
  jLenF.append(el("span", null, "Length"), jLen.el, jSecs);
  const match = toggle("Match colors", "Shift each clip's colour and brightness so it matches the end of the clip before it. Hides the jump when a continued clip came out a little darker or warmer.",
    () => setOption(node, "match", !readState(node).match));
  joinSec.append(el("span", "pix-vdt-lab", "Join"), joinSeg.el, jLenF, match.el);

  // ── loop ──
  const loopSec = el("div", "pix-vdt-sec");
  const loopSeg = segmented([
    ["off", "Off", "Play once"],
    ["repeat", "Repeat", "Play it again from the start, the number of times set"],
    ["pingpong", "Ping-pong", "Forward, then backwards, then forward... (a boomerang)"],
    ["seamless", "Seamless", "Blend the end into the start, so it loops with no jump (the video gets a little shorter)"],
  ], "How the video loops", (k) => setOption(node, "loop", k));
  const lTimes = stepper(1, MAX_TIMES, "How many times it plays", (v, commit) => setOption(node, "loopTimes", v, !commit));
  const lTimesF = el("span", "pix-vdt-f");
  lTimesF.title = "How many times it plays";
  lTimesF.append(el("span", null, "×"), lTimes.el);
  const lBlend = stepper(1, MAX_SPAN, "Seamless loop: frames blended", (v, commit) => setOption(node, "loopFrames", v, !commit));
  const lBlendF = el("span", "pix-vdt-f");
  const lSecs = el("small");
  lBlendF.append(el("span", null, "Blend"), lBlend.el, lSecs);
  loopSec.append(el("span", "pix-vdt-lab", "Loop"), loopSeg.el, lTimesF, lBlendF);

  // ── fade ──
  const fadeSec = el("div", "pix-vdt-sec");
  const fIn = stepper(0, MAX_SPAN, "Fade in from black, in frames", (v, commit) => setOption(node, "fadeIn", v, !commit));
  const fOut = stepper(0, MAX_SPAN, "Fade out to black, in frames", (v, commit) => setOption(node, "fadeOut", v, !commit));
  const fInF = el("span", "pix-vdt-f");
  const fInS = el("small");
  fInF.append(el("span", null, "In"), fIn.el, fInS);
  const fOutF = el("span", "pix-vdt-f");
  const fOutS = el("small");
  fOutF.append(el("span", null, "Out"), fOut.el, fOutS);
  fadeSec.append(el("span", "pix-vdt-lab", "Fade"), fInF, fOutF);

  // ── music: one song under the whole video (shown only while one is wired) ──
  const musicSec = el("div", "pix-vdt-sec");
  const musicSeg = segmented([
    ["music", "Only music", "The song alone: the clips' own sound is left out (a music video)"],
    ["mix", "Music + clip sound", "The song and the clips' own sound together"],
  ], "What you hear with the song", (k) => setOption(node, "musicMix", k));
  musicSec.append(el("span", "pix-vdt-lab", "Music"), musicSeg.el);

  inner.append(stage, tl, infoRow, grid, joinSec, loopSec, fadeSec, musicSec);

  const widget = node.addDOMWidget(WIDGET_NAME, WIDGET_TYPE, root, {
    serialize: false,
    getMinHeight: () => FLOOR,
  });
  widget.serialize = false;
  widget.computeLayoutSize = () => ({ minHeight: FLOOR, minWidth: 1 });
  applyAdaptiveCanvasOnly(widget);
  installCanvasZoomPassthrough(root);
  installNativeTextMenu(root);
  installNodeAccent(node, root);
  // Nodes 2.0's corner drag measures the node collapsed, ignoring getMinHeight:
  // pin the measured content on the root while a resize handle is held (drag
  // only, never a load); a narrower node wraps rows, so grow to fit on release.
  const floorOff = installResizeFloor(root, () => contentMin(node) || FLOOR, () => growToFloor(node));
  const widthOff = installWidthFloor(root);

  node._pixVdtFace = {
    floorOff, widthOff,
    root, inner, stage, img, empty, play, tl, info, fpsBox, fpsF, rows, joinSec, joinSeg, jLen, jLenF, jSecs, match,
    loopSec, loopSeg, lTimes, lTimesF, lBlend, lBlendF, lSecs, fIn, fOut, fInS, fOutS, musicSec, musicSeg, widget,
    tlSig: "",
  };
  return widget;
}

export function setPlaying(node, on) {
  const f = node._pixVdtFace;
  const run = node._pixVdtRun;
  node._pixVdtPlaying = !!on && !!run?.preview;
  if (!f) return;
  const src = node._pixVdtPlaying ? viewUrl(run.preview) : viewUrl(run?.still);
  if (src && f.img.getAttribute("src") !== src) f.img.src = src;
  f.play.textContent = node._pixVdtPlaying ? "■ Stop" : "▶ Play";
}

/** Each wired clip's length: the last run's, else Load Video's file (an
 *  estimate, shown with "~"), else unknown (`missing`). */
function lengthsFor(node, wired) {
  const run = node._pixVdtRun;
  const known = {};
  for (const c of run?.clips || []) known[c.slot - 1] = c.frames;
  let missing = false;
  const guessed = new Set();
  const lengths = wired.map((w, i) => {
    if (!w) return null;
    if (known[i] != null) return known[i];
    const est = estimate(node, i);
    if (est) { guessed.add(i); return est.frames; }
    missing = true;
    return null;
  });
  return { lengths, missing, guessed };
}

function drawTimeline(node, pl, missing, anyWired) {
  const f = node._pixVdtFace;
  const sig = JSON.stringify([pl, missing, anyWired]);
  if (sig === f.tlSig) return;
  f.tlSig = sig;
  f.tl.textContent = "";
  if (!anyWired || missing || !pl.total) {
    f.tl.appendChild(el("span", "hint", anyWired ? "Run once and the clips show on this timeline" : "No clip wired"));
    return;
  }
  const total = pl.total;
  const pct = (v, of) => `${(100 * v) / of}%`;
  const color = (k) => SLOT_COLORS[pl.clips[k].slot];
  const baseInto = (box, mirror) => {
    // the base (every clip once), drawn across `box`
    const len = pl.base;
    for (let k = 0; k < pl.clips.length; k++) {
      const c = pl.clips[k];
      const s = el("span", "seg");
      s.style.left = pct(c.at, len);
      s.style.width = pct(c.kept, len);
      s.style.background = color(k);
      box.appendChild(s);
    }
    pl.joins.forEach((j, k) => {
      if (j.kind === "crossfade") {
        const s = el("span", "seg");
        s.style.left = pct(j.at, len);
        s.style.width = pct(j.frames, len);
        s.style.background = `linear-gradient(90deg, ${color(k)}, ${color(k + 1)})`;
        box.appendChild(s);
      } else if (j.kind === "black") {
        if (j.out) {
          const s = el("span", "seg");
          s.style.left = pct(j.at - j.out, len);
          s.style.width = pct(j.out, len);
          s.style.background = `linear-gradient(90deg, transparent, #000)`;
          box.appendChild(s);
        }
        if (j.in) {
          const s = el("span", "seg");
          s.style.left = pct(j.at, len);
          s.style.width = pct(j.in, len);
          s.style.background = `linear-gradient(90deg, #000, transparent)`;
          box.appendChild(s);
        }
      } else if (k < pl.clips.length - 1) {
        const s = el("span", "sep");
        s.style.left = pct(j.at, len);
        box.appendChild(s);
      }
    });
    if (mirror) box.style.transform = "scaleX(-1)";
  };
  for (let t = 0; t < pl.times; t++) {
    const cyc = el("span", "cyc" + (t ? " rep" : ""));
    cyc.style.left = pct(t * pl.cycle, total);
    cyc.style.width = pct(pl.cycle, total);
    if (pl.loop === "pingpong" && pl.cycle > pl.base) {
      const fwd = el("span", "cyc");
      fwd.style.left = "0";
      fwd.style.width = pct(pl.base, pl.cycle);
      baseInto(fwd, false);
      const back = el("span", "cyc");
      back.style.left = pct(pl.base, pl.cycle);
      back.style.width = pct(pl.cycle - pl.base, pl.cycle);
      baseInto(back, true);
      cyc.append(fwd, back);
    } else {
      const body = el("span", "cyc");
      body.style.left = "0";
      // A seamless loop drops `blend` frames: the base is drawn a little wider
      // than the cycle and its end shades into clip 1's colour.
      body.style.width = pct(pl.base, pl.cycle);
      baseInto(body, false);
      cyc.appendChild(body);
      cyc.style.overflow = "hidden";
      if (pl.loop === "seamless" && pl.blend) {
        const s = el("span", "seg");
        s.style.left = pct(pl.cycle - pl.blend, pl.cycle);
        s.style.width = pct(pl.blend, pl.cycle);
        s.style.background = `linear-gradient(90deg, ${color(pl.clips.length - 1)}, ${color(0)})`;
        cyc.appendChild(s);
      }
    }
    f.tl.appendChild(cyc);
    if (t) {
      const sep = el("span", "sep");
      sep.style.left = pct(t * pl.cycle, total);
      f.tl.appendChild(sep);
    }
  }
  if (pl.fadeIn) {
    const s = el("span", "seg");
    s.style.left = "0";
    s.style.width = pct(pl.fadeIn, total);
    s.style.background = "linear-gradient(90deg, #000, transparent)";
    f.tl.appendChild(s);
  }
  if (pl.fadeOut) {
    const s = el("span", "seg");
    s.style.left = pct(total - pl.fadeOut, total);
    s.style.width = pct(pl.fadeOut, total);
    s.style.background = "linear-gradient(90deg, transparent, #000)";
    f.tl.appendChild(s);
  }
}

/** Re-sync every control from the saved state, the wires and the last run.
 *  Pure DOM: never writes size, properties or slots (safe on the load path). */
export function renderFace(node) {
  const f = node._pixVdtFace;
  if (!f) return;
  const st = readState(node);
  const fps = faceFps(node);
  const wired = wiredSlots(node);
  const nWired = wired.filter(Boolean).length;
  const run = node._pixVdtRun;
  const { lengths, missing, guessed } = lengthsFor(node, wired);
  const pl = planVideo(lengths, st);
  const approx = guessed.size ? "~" : "";

  // the result
  const has = !!run?.still || !!run?.preview;
  f.stage.classList.toggle("has", !!run?.preview);
  f.empty.style.display = has ? "none" : "";
  f.empty.textContent = nWired
    ? (run && st.preview === "off" ? "The moving preview is off (gear).\nRun to make the video." : "Run, and the finished video shows here.")
    : "Wire a video into v1 (and more clips into v2, v3...), then Run.\nThe finished video shows here.";
  f.img.style.display = has ? "" : "none";
  if (has) setPlaying(node, node._pixVdtPlaying);

  drawTimeline(node, pl, missing, nWired > 0);

  // the line under the timeline: the live plan when every wired clip is known
  // ("~" while a clip's length comes from its file, before the first Run)
  if (nWired && !missing && pl.total) {
    const sz = run?.width ? ` · ${run.width}×${run.height}` : "";
    const snd = musicWired(node) ? " · with music"
      : (run && !approx ? (run.audio ? " · with sound" : " · no sound") : "");
    f.info.innerHTML = "";
    const b = el("b", null, `${approx}${pl.total} frames`);
    f.info.append(b, document.createTextNode(` · ${approx}${fmtSecs(secs(pl.total, fps))}${sz}${snd}`));
  } else {
    f.info.textContent = "";
  }
  f.info.title = approx ? "Counted from the video files before the first Run; the Run gives the exact numbers." : "";
  // the fps on the node: what the seconds use when nothing is wired into fps
  const wiredFps = fpsWired(node);
  f.fpsBox.set(wiredFps ? +faceFps(node).toFixed(3) : st.fps);
  f.fpsF.classList.toggle("wired", wiredFps);
  f.fpsF.title = wiredFps ? "The frame rate comes from the fps wire" : "Frames per second of the clips (no fps wire)";
  for (const x of f.fpsF.querySelectorAll("button,input")) x.disabled = wiredFps;

  // the clip rows
  const runClips = {};
  for (const c of run?.clips || []) runClips[c.slot - 1] = c;
  const plBySlot = {};
  for (const c of pl.clips) plBySlot[c.slot] = c;
  const shown = Math.max(1, pairsShown(node));
  f.rows.forEach((r, i) => {
    // one row per input pair the node shows (the wired clips + one free pair)
    const vis = i < shown;
    for (const x of r.cells) x.style.display = vis ? "" : "none";
    if (!vis) return;
    const c = st.clips[i];
    r.cs.set(c.cutStart);
    r.ce.set(c.cutEnd);
    r.csS.textContent = fmtSecs(secs(c.cutStart, fps));
    r.ceS.textContent = fmtSecs(secs(c.cutEnd, fps));
    r.rev.classList.toggle("on", c.reverse);
    r.rev.setAttribute("aria-pressed", String(c.reverse));
    const isWired = wired[i];
    r.cinfo.classList.toggle("off", !isWired);
    r.badge.style.opacity = isWired ? "" : ".4";
    for (const x of [r.cs.el, r.ce.el, r.rev]) x.style.opacity = isWired ? "" : ".4";
    const rc = runClips[i];
    const pc = plBySlot[i];
    const g = guessed.has(i) ? "~" : "";
    if (!isWired) r.cinfo.textContent = `not wired (v${i + 1})`;
    else if (!pc || (!rc && !g)) r.cinfo.textContent = "wired: Run once to read it";
    else {
      const kept = pc.kept < pc.frames ? `${g}${pc.kept} of ${pc.frames} frames` : `${g}${pc.frames} frames`;
      const tail = g ? "" : (rc.audio ? " · sound" : "");
      r.cinfo.textContent = `${kept} · ${g}${fmtSecs(secs(pc.kept, fps))}${tail}`;
    }
    r.cinfo.title = r.cinfo.textContent
      + (g ? "\nCounted from the video file before the first Run; the Run gives the exact numbers." : "");
    const src = isWired && rc?.thumb ? viewUrl(rc.thumb) : "";
    const img = r.th.querySelector("img");
    if (src && (!img || img.getAttribute("src") !== src)) {
      r.th.textContent = "";
      const im = el("img");
      im.alt = `Clip ${i + 1}`;
      im.draggable = false;
      im.src = src;
      r.th.appendChild(im);
    } else if (!src && img) r.th.textContent = "";
  });

  // join / loop / fade
  f.joinSeg.set(st.join);
  f.jLen.set(st.joinFrames);
  f.jSecs.textContent = fmtSecs(secs(st.joinFrames, fps));
  f.jLenF.classList.toggle("off", st.join === "cut");
  f.match.set(st.match);
  f.joinSec.classList.toggle("dim", nWired < 2);
  f.joinSec.title = nWired < 2 ? "Wire a second clip to join clips" : "";
  f.loopSeg.set(st.loop);
  f.lTimes.set(st.loopTimes);
  f.lTimesF.classList.toggle("off", st.loop === "off");
  f.lBlend.set(st.loopFrames);
  f.lSecs.textContent = fmtSecs(secs(st.loopFrames, fps));
  f.lBlendF.classList.toggle("off", st.loop !== "seamless");
  f.musicSec.style.display = musicWired(node) ? "" : "none";
  f.musicSeg.set(st.musicMix);
  f.fIn.set(st.fadeIn);
  f.fOut.set(st.fadeOut);
  f.fInS.textContent = fmtSecs(secs(st.fadeIn, fps));
  f.fOutS.textContent = fmtSecs(secs(st.fadeOut, fps));
}

// Nodes 2.0 has no width floor for this body: its corner drag clamps at the node
// element's INLINE min-width, read on every move, so pin one only WHILE a resize
// handle of this node is held (Layout Boxes' installWidthFloor, sketch.md #11):
// it can never fight a saved size on a load. Found by CONTAINMENT at press time.
function installWidthFloor(root) {
  let pinned = null;
  const clear = () => {
    if (!pinned) return;
    try { pinned.style.removeProperty("min-width"); } catch {}
    pinned = null;
  };
  const onDown = (e) => {
    if (!isVueNodes() || !root.isConnected) return;
    if (e.target?.closest?.(".lg-node-widget")) return;
    let cur = "";
    try { cur = getComputedStyle(e.target).cursor || ""; } catch {}
    if (!cur.includes("resize")) return;
    const el = e.target.closest?.(".lg-node");
    if (!el || !el.contains(root)) return;
    try { el.style.setProperty("min-width", MIN_W + "px"); pinned = el; } catch {}
  };
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointerup", clear, true);
  window.addEventListener("pointercancel", clear, true);
  return () => {
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointerup", clear, true);
    window.removeEventListener("pointercancel", clear, true);
    clear();
  };
}

export function destroyFace(node) {
  try { node._pixVdtFace?.floorOff?.(); } catch {}
  try { node._pixVdtFace?.widthOff?.(); } catch {}
  node._pixVdtFace = null;
}
