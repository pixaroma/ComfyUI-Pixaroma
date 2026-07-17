// Pure, DOM-free maths for Outpaint Pixaroma. Mirrors nodes/node_outpaint.py.
// Python is authoritative: if these disagree, the preview lies about the result.
// Keep this file importable by plain node so it stays testable.
//
// The Python side reaches its final size through _resize_helpers._apply_pad and
// _apply_max_mp, so the helpers below mirror those two (plus _apply_snap,
// _clamp_dims and the rounding) rather than only node_outpaint.py itself.
// Locked by D:\Claude Tests\_outpaint_core_test.mjs (unit) and the JS-vs-Python
// cross-check; re-run BOTH after touching any formula here.

export const STATE_PROP = "outpaintState";
export const STATE_VERSION = 1;
export const LIMITS = [0, 1, 1.5, 2];
export const SNAPS = [0, 8, 16, 32, 64];
export const RATIO_LIBRARY = [
  "1:1", "4:5", "5:4", "3:4", "4:3", "2:3",
  "3:2", "1:2", "2:1", "9:16", "16:9", "21:9",
];
export const DEFAULT_RATIOS = ["1:1", "4:5", "3:2", "16:9", "9:16"];
export const BRAND = "#f66744";

// Mirrors _MAX_PAD in node_outpaint.py, which clamps every per-side value while
// parsing state. Exported so the UI can clamp its own fields to the same ceiling:
// a field that lets the user type past this would preview a pad Python discards.
export const MAX_PAD = 8192;

export const DEFAULT_STATE = {
  version: STATE_VERSION,
  mode: "ratio",
  ratio: "3:2",
  anchor: "centre",
  top: 0, bottom: 0, left: 0, right: 0,
  limit: 0,
  color: "#00ff00",
  snap: 0,
  collapsed: false,
};

// Python's float() is strict where JS parseFloat() is lenient: float("2abc")
// raises, parseFloat("2abc") returns 2. Without this gate "16:9:1" and "16:9abc"
// would preview a pad that Python refuses to make.
const FINITE_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function strictFloat(text) {
  const t = String(text).trim();
  return FINITE_NUMBER.test(t) ? parseFloat(t) : NaN;
}

export function parseRatio(text) {
  if (typeof text !== "string" || !text.includes(":")) return null;
  // Split on the FIRST colon only, mirroring Python's str.partition(":"), so
  // "3:2:5" hands "2:5" to the number gate and is rejected by both sides.
  const at = text.indexOf(":");
  const rw = strictFloat(text.slice(0, at));
  const rh = strictFloat(text.slice(at + 1));
  if (!isFinite(rw) || !isFinite(rh) || rw <= 0 || rh <= 0) return null;
  return [rw, rh];
}

// Which axis the chosen ratio grows. Only ONE ever grows from a single ratio
// pick, which is why the anchor row is three chips and not a 3x3 grid.
// "h" = wider (left/centre/right), "v" = taller (top/middle/bottom),
// null = no growth, so the anchor row has nothing to do.
export function anchorAxis(ratioText, srcW, srcH) {
  const r = parseRatio(ratioText);
  if (!r || !srcW || !srcH) return null;
  const target = r[0] / r[1];
  const cur = srcW / srcH;
  if (Math.abs(target - cur) < 1e-6) return null;
  return target > cur ? "h" : "v";
}

// Null-prototype so a hand-edited anchor cannot reach Object.prototype:
// a plain literal would make remapAnchor("constructor", "v") return a function.
const H_TO_V = Object.assign(Object.create(null), { left: "top", centre: "middle", right: "bottom" });
const V_TO_H = Object.assign(Object.create(null), { top: "left", middle: "centre", bottom: "right" });

// Keep the user's intent when the live axis flips: "hug the far edge" stays
// "hug the far edge" rather than snapping back to centre.
export function remapAnchor(anchor, toAxis) {
  if (toAxis === "v") return H_TO_V[anchor] ?? (V_TO_H[anchor] ? anchor : "middle");
  if (toAxis === "h") return V_TO_H[anchor] ?? (H_TO_V[anchor] ? anchor : "centre");
  return anchor;
}

// Mirrors _resize_helpers._round_half_up, which is floor(x + 0.5). Math.round
// agrees for every positive value except the 0.49999999999999994 corner, where
// Math.round is arguably more correct but stops mirroring Python.
// Every dimension in node_outpaint.py goes through _round_half_up, never the
// built-in round(): the built-in is banker's rounding, so a 999-high source at
// 3:2 (999*1.5 = 1498.5) would give Python 1498 and JS 1499, and the preview
// would paint the green one pixel wide of the real output.
function roundHalfUp(x) {
  return Math.floor(x + 0.5);
}

// Mirrors _resize_helpers._apply_snap. FLOOR, not round-to-nearest, so snapping
// can never push a dim back above the megapixel cap. The floor is 8 (matching
// Python) and NOT the snap step: for a source smaller than the step, Python
// lands on 8, so a max(snap, ...) here would over-report a tiny image.
function snapTo(w, h, snap) {
  if (!snap || snap <= 0) return [w, h];
  return [Math.max(8, Math.floor(w / snap) * snap),
          Math.max(8, Math.floor(h / snap) * snap)];
}

// Mirrors _resize_helpers._clamp_dims: floor 8 (an extreme snap can round a dim
// to nothing), ceiling 16384 (Python refuses to allocate past it, so a preview
// promising more would be a promise the run cannot keep).
function clampDims(w, h) {
  return [Math.max(8, Math.min(Math.trunc(w), 16384)),
          Math.max(8, Math.min(Math.trunc(h), 16384))];
}

// Mirrors the max(0, int(...)) each side gets in _apply_pad. Math.trunc rather
// than |0, which would wrap a large value through 32 bits.
function padPx(v) {
  const n = Number(v);
  return isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

// The anchor value names WHERE THE NEW SPACE GOES: "right" pads on the right.
// That is deliberately the OPPOSITE of _resize_helpers._anchor_offsets and of
// Load Image's crop anchor, which name where the image sticks. Reason: "sides"
// mode already means green-per-edge (right: 512 = 512px of green on the right),
// so the word must mean the same thing in both modes of this node. The UI label
// is "Add space", not "Anchor", to stop the two ideas being confused.
// MUST match nodes/node_outpaint.py::_pads_for_ratio exactly - if these
// disagree, the live preview paints the green on the wrong side.
// Do not "correct" this back to the _anchor_offsets convention.
export function padsForRatio(srcW, srcH, ratioText, anchor) {
  const none = { top: 0, bottom: 0, left: 0, right: 0 };
  const axis = anchorAxis(ratioText, srcW, srcH);
  if (!axis) return none;
  const r = parseRatio(ratioText);
  const target = r[0] / r[1];

  // The cross-axis names are accepted on both axes so a stored anchor left over
  // from the other axis still reads as near/far rather than silently centring.
  if (axis === "h") {
    const add = roundHalfUp(srcH * target) - srcW;
    if (add <= 0) return none;
    if (anchor === "left" || anchor === "top") return { ...none, left: add };
    if (anchor === "right" || anchor === "bottom") return { ...none, right: add };
    const half = Math.floor(add / 2);
    return { ...none, left: half, right: add - half };
  }
  const add = roundHalfUp(srcW / target) - srcH;
  if (add <= 0) return none;
  if (anchor === "top" || anchor === "left") return { ...none, top: add };
  if (anchor === "bottom" || anchor === "right") return { ...none, bottom: add };
  const half = Math.floor(add / 2);
  return { ...none, top: half, bottom: add - half };
}

// Mirrors _parse_state's per-side coercion: max(0, min(int(v), _MAX_PAD)).
// This is a SEPARATE clamp from padPx above, and both are needed: Python clamps
// the STATE on the way in (here, to _MAX_PAD) and the PAD on the way out (padPx,
// to >= 0). A preview that skipped this one would happily paint a 99999px band
// that the run is about to cut down to 8192.
export function sidePad(v) {
  const n = Number(v);
  return isFinite(n) ? Math.max(0, Math.min(Math.trunc(n), MAX_PAD)) : 0;
}

// The four pads a run will apply, whichever mode is live. Mirrors outpaint()'s
// own dispatch: ratio mode derives them from the shape, By side reads them off
// the state. Lives here rather than in the face because it is the thing that
// decides where the green goes - if it drifts from Python, the preview lies.
export function padsForState(st, srcW, srcH) {
  if (st && st.mode === "ratio") return padsForRatio(srcW, srcH, st.ratio, st.anchor);
  return {
    top: sidePad(st && st.top), bottom: sidePad(st && st.bottom),
    left: sidePad(st && st.left), right: sidePad(st && st.right),
  };
}

// Mirrors outpaint(): pad, then cap if a limit is set. Binary MP (1024*1024),
// matching ComfyUI's ImageScaleToTotalPixels and _apply_max_mp.
//
// Snap fires ONCE, exactly as the node arranges it: with a limit on, the pad
// pass runs unsnapped and the megapixel pass snaps; otherwise the pad pass
// snaps. Clamping sits between the two passes because Python clamps inside
// _apply_pad, so an oversized pad is capped BEFORE the megapixel factor is
// measured against it.
export function finalSize(srcW, srcH, pads, limit, snap) {
  let w = srcW + padPx(pads?.left) + padPx(pads?.right);
  let h = srcH + padPx(pads?.top) + padPx(pads?.bottom);

  [w, h] = snapTo(w, h, limit ? 0 : snap);
  [w, h] = clampDims(w, h);
  if (!limit) return { w, h };

  const target = Math.max(0.01, Math.min(limit, 64));
  const targetPx = target * 1024 * 1024;
  const cur = w * h;
  let factor = cur > 0 ? Math.sqrt(targetPx / cur) : 1;
  factor = Math.min(factor, 8);
  w = roundHalfUp(w * factor);
  h = roundHalfUp(h * factor);
  [w, h] = snapTo(w, h, snap);
  [w, h] = clampDims(w, h);
  return { w, h };
}

export function readState(node) {
  let raw = node?.properties?.[STATE_PROP];
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  return { ...DEFAULT_STATE, ...(raw && typeof raw === "object" ? raw : {}) };
}

export function writeState(node, patch) {
  const next = { ...readState(node), ...patch };
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = JSON.stringify(next);
  return next;
}
