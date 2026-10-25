// Video Tools Pixaroma - the saved state and the plan (pure, no imports).
//
// The plan says how many frames each step keeps. Python's
// nodes/_video_tools_helpers.py plan() makes the real one at run time; this
// copy only draws the live timeline on the node, so a crossfade or a loop you
// change shows at once. D:\Claude Tests\_video_tools\plan_parity.py runs both
// on the same cases: they must match. Change one, change the other.

export const CLASS = "PixaromaVideoTools";
export const HIDDEN_INPUT = "VideoToolsState";
export const PROP = "videoTools";

export const MAX_CLIPS = 8;
export const JOINS = ["cut", "crossfade", "black"];
export const LOOPS = ["off", "repeat", "pingpong", "seamless"];
export const SIZES = ["fill", "fit", "stretch"];
export const PREVIEWS = ["animated", "off"];
export const MUSIC_MIX = ["music", "mix"];
const MAX_FRAMES = 100000;
export const MAX_SPAN = 2000;
export const MAX_TIMES = 100;
export const MIN_FPS = 1;
export const MAX_FPS = 240;

function int(v, lo, hi, dflt) {
  if (typeof v === "boolean" || v === null || v === undefined || v === "") return dflt;
  const f = Number(v);
  if (!Number.isFinite(f)) return dflt;
  return Math.max(lo, Math.min(hi, Math.trunc(f)));
}
/** Mirrors _fps: the rate when nothing is wired into fps. */
export function fpsOf(v) {
  if (typeof v === "boolean" || v === null || v === undefined || v === "") return 24;
  const f = Number(v);
  if (!Number.isFinite(f)) return 24;
  return Math.max(MIN_FPS, Math.min(MAX_FPS, f));
}
const pick = (v, allowed, dflt) => (typeof v === "string" && allowed.includes(v) ? v : dflt);

/** A healed copy. Mirrors parse_state. */
export function parseState(raw) {
  if (typeof raw === "string") {
    try { raw = raw.trim() ? JSON.parse(raw) : {}; } catch { raw = {}; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
  const src = Array.isArray(raw.clips) ? raw.clips : [];
  const clips = [];
  for (let i = 0; i < MAX_CLIPS; i++) {
    const c = i < src.length && src[i] && typeof src[i] === "object" && !Array.isArray(src[i]) ? src[i] : {};
    clips.push({
      cutStart: int(c.cutStart, 0, MAX_FRAMES, 0),
      cutEnd: int(c.cutEnd, 0, MAX_FRAMES, 0),
      reverse: c.reverse === true,
    });
  }
  return {
    clips,
    join: pick(raw.join, JOINS, "crossfade"),
    joinFrames: int(raw.joinFrames, 1, MAX_SPAN, 12),
    match: raw.match === true,
    matchStrength: int(raw.matchStrength, 0, 100, 100),
    loop: pick(raw.loop, LOOPS, "off"),
    loopTimes: int(raw.loopTimes, 1, MAX_TIMES, 2),
    loopFrames: int(raw.loopFrames, 1, MAX_SPAN, 12),
    fadeIn: int(raw.fadeIn, 0, MAX_SPAN, 0),
    fadeOut: int(raw.fadeOut, 0, MAX_SPAN, 0),
    size: pick(raw.size, SIZES, "fill"),
    preview: pick(raw.preview, PREVIEWS, "animated"),
    fps: fpsOf(raw.fps),
    musicMix: pick(raw.musicMix, MUSIC_MIX, "music"),
  };
}

export const readState = (node) => parseState(node?.properties?.[PROP]);

export function writeState(node, next) {
  if (!node) return;
  node.properties = node.properties || {};
  node.properties[PROP] = { v: 1, ...parseState(next) };
}

export const injectedState = (node) => ({ v: 1, ...readState(node) });

export function keptRange(n, cutStart, cutEnd) {
  if (n <= 0) return [0, 0];
  const s = Math.min(cutStart, n - 1);
  const e = Math.max(s + 1, n - cutEnd);
  return [s, e];
}

/** Mirror of plan(): lengths = frames per input slot, null when not wired. */
export function planVideo(lengths, st) {
  const clips = [];
  lengths.slice(0, MAX_CLIPS).forEach((n, slot) => {
    if (n == null || n <= 0) return;
    const c = st.clips[slot];
    const [s, e] = keptRange(Math.trunc(n), c.cutStart, c.cutEnd);
    clips.push({ slot, frames: Math.trunc(n), start: s, end: e, kept: e - s, reverse: c.reverse, xin: 0 });
  });
  const joins = [];
  let pos = 0;
  clips.forEach((c, k) => {
    if (k === 0) { c.at = 0; pos = c.kept; return; }
    const prev = clips[k - 1];
    if (st.join === "crossfade") {
      // Never reach back into the crossfade that came INTO the previous clip.
      const n = Math.max(0, Math.min(st.joinFrames, prev.kept - 1 - prev.xin, c.kept - 1));
      joins.push({ kind: n ? "crossfade" : "cut", frames: n, at: pos - n });
      c.at = pos - n;
      c.xin = n;
      pos += c.kept - n;
    } else if (st.join === "black") {
      const nOut = Math.min(st.joinFrames, prev.kept);
      const nIn = Math.min(st.joinFrames, c.kept);
      joins.push({ kind: "black", out: nOut, in: nIn, at: pos });
      c.at = pos;
      pos += c.kept;
    } else {
      joins.push({ kind: "cut", frames: 0, at: pos });
      c.at = pos;
      pos += c.kept;
    }
  });
  const base = pos;
  const loop = base > 0 ? st.loop : "off";
  let times = st.loopTimes;
  let blend = 0;
  let cycle;
  if (loop === "repeat") cycle = base;
  else if (loop === "pingpong") cycle = base + Math.max(0, base - 2);
  else if (loop === "seamless") { blend = Math.min(st.loopFrames, Math.floor(base / 2)); cycle = base - blend; }
  else { cycle = base; times = 1; }
  const total = cycle * times;
  return {
    clips, joins, base, loop, times, cycle, blend, total,
    fadeIn: Math.min(st.fadeIn, total), fadeOut: Math.min(st.fadeOut, total),
  };
}

/** "12 frames (0.50 s)" style helpers. */
export const secs = (frames, fps) => (fps > 0 ? frames / fps : 0);
export function fmtSecs(s) {
  if (s >= 60) return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")} min`;
  return `${s >= 10 ? s.toFixed(1) : s.toFixed(2)} s`;
}
