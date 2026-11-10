// ============================================================
// Inpaint Crop Pixaroma — geometry (JS mirror of nodes/_inpaint_helpers.py)
// Keep computeRegion() 1:1 with the Python compute_region so the editor's live
// crop-rectangle preview matches what the node actually produces. Source of
// truth: docs/inpaint-crop-math.md. Every rounding here is half-to-EVEN like
// Python's round(): a half-UP Math.round changed the rect size at an exact .5 and
// with it the output (904 in the editor, 896 from the node, 2026-11-10).
// ============================================================

export const GEO_DEFAULTS = {
  size_mode: "keep", target: 1024, target_w: 1024, target_h: 1024,
  multiple: 8, context_px: 24, context_pct: 10, mask_grow: 4, mask_blur: 4,
  blend: 16, min_size: 256, max_size: 2048, allow_upscale: true,
};

// round half to EVEN, matching Python's built-in round() (banker's rounding) that
// _round_mult uses. Math.round is half-UP, so without this the editor crop-box size
// could read one `multiple` step off from the real output at exact .5 boundaries
// (e.g. 1056/64 = 16.5 -> Python 16 -> 1024, half-up 17 -> 1088). Only the exact-.5
// case differs; every other value rounds identically.
const roundHalfEven = (x) => {
  const f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
};
const roundMult = (v, m) => {
  m = Math.max(1, Math.round(m));
  return Math.max(m, roundHalfEven(v / m) * m);
};
const clampi = (v, lo, hi) => Math.max(lo, Math.min(hi, roundHalfEven(v)));

export function computeRegion(bbox, W, H, params) {
  const p = { ...GEO_DEFAULTS, ...(params || {}) };
  W = Math.round(W); H = Math.round(H);
  let x0, y0, x1, y1;
  if (!bbox) { x0 = 0; y0 = 0; x1 = W; y1 = H; } else { [x0, y0, x1, y1] = bbox; }
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;

  // context expand uses max(context_px, blend) so the seam feather has room to reach
  // 0 inside the crop (Option B - mirror of compute_region; a big softness grows it).
  const ctx = Math.max(p.context_px, p.blend || 0);
  let rw = bw + 2 * ctx + bw * p.context_pct / 100;
  let rh = bh + 2 * ctx + bh * p.context_pct / 100;

  const mult = p.multiple, mode = p.size_mode;

  // force mode: grow the WANTED region to the target aspect first (output is the
  // fixed target size, set below).
  let tw = 0, th = 0;
  if (mode === "force") {
    tw = Math.max(mult, roundMult(p.target_w, mult));
    th = Math.max(mult, roundMult(p.target_h, mult));
    const ta = tw / th;
    if (rw / rh < ta) rw = rh * ta; else rh = rw / ta;
  }

  // place + clamp the SOURCE region inside the image
  let rw_i = Math.max(1, Math.min(roundHalfEven(rw), W));
  let rh_i = Math.max(1, Math.min(roundHalfEven(rh), H));
  if (mode === "force") {
    // keep source aspect == target aspect after the image-bound clamp (mirror).
    const aspect = tw / th;
    if (rw_i > rh_i * aspect) rw_i = Math.max(1, roundHalfEven(rh_i * aspect));
    else rh_i = Math.max(1, roundHalfEven(rw_i / aspect));
  }
  const rx = clampi(cx - rw_i / 2, 0, W - rw_i);
  const ry = clampi(cy - rh_i / 2, 0, H - rh_i);

  // output size from the CLAMPED source rect (rw_i, rh_i), never the un-clamped
  // region - so the crop is never stretched when the image edge clipped it.
  let out_w, out_h;
  if (mode === "force") {
    out_w = tw; out_h = th;
  } else if (mode === "free") {
    // keep the cropped rect's own size; when the long side exceeds max_size scale
    // BOTH axes by one factor so the aspect is preserved (mirror of compute_region).
    let ow = rw_i, oh = rh_i;
    const big = Math.max(ow, oh);
    if (big > p.max_size) { const k = p.max_size / big; ow *= k; oh *= k; }
    out_w = roundMult(ow, mult);
    out_h = roundMult(oh, mult);
  } else {
    const long = Math.max(rw_i, rh_i);
    let s = long > 0 ? p.target / long : 1;
    if (!p.allow_upscale) s = Math.min(s, 1);
    let ow = rw_i * s, oh = rh_i * s;
    const small = Math.min(ow, oh);
    if (small < p.min_size) { const k = p.min_size / small; ow *= k; oh *= k; }
    const big = Math.max(ow, oh);
    if (big > p.max_size) { const k = p.max_size / big; ow *= k; oh *= k; }
    out_w = roundMult(ow, mult); out_h = roundMult(oh, mult);
  }
  out_w = Math.max(mult, Math.round(out_w));
  out_h = Math.max(mult, Math.round(out_h));
  return { rx, ry, rw: rw_i, rh: rh_i, out_w, out_h };
}

// Bounding box of painted pixels from a mask canvas's alpha channel.
// Returns [x0,y0,x1,y1] (x1/y1 exclusive) or null when nothing is painted.
// thresh 127 = alpha >= 128, the node's `mask > 0.5` (preprocess_mask). It was 8,
// which also counted the brush's faint anti-aliased rim: the editor box came out a
// pixel wider each side and its crop size one `multiple` step off (728 vs 720).
export function maskBBoxFromImageData(data, w, h, thresh = 127) {
  let x0 = w, y0 = h, x1 = 0, y1 = 0, found = false;
  for (let y = 0; y < h; y++) {
    let row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > thresh) {
        found = true;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return found ? [x0, y0, x1 + 1, y1 + 1] : null;
}

// Expand a bbox by `px` each side (clamped) - mirrors the effect of the Python
// mask dilation (grow) on the bounding box.
export function growBBox(bbox, px, W, H) {
  if (!bbox) return null;
  return [
    Math.max(0, bbox[0] - px), Math.max(0, bbox[1] - px),
    Math.min(W, bbox[2] + px), Math.min(H, bbox[3] + px),
  ];
}

// Outward seam-feather alpha - the canvas mirror of Python `_blur_alpha`'s scipy
// path (nodes/_inpaint_helpers.py). Reads the ALPHA channel of an RGBA `data`
// buffer (w x h) as the mask, returns a Float32Array alpha: 1.0 INSIDE the mask
// (and at its edge), ramping to 0 over `k` px OUTSIDE via the same smoothstep the
// node uses. Pure + DOM-free for unit testing.
//
// The node uses an exact Euclidean signed-distance transform; here we use a fast
// 2-pass (1, sqrt2) chamfer transform of the OUTSIDE distance (inside is just 1).
// The chamfer approximates Euclidean within a few %, which is invisible on a soft
// seam preview. This is the "preview == result" parity: a moderate softness no
// longer looks tighter in the editor than the real stitched seam.
export function seamAlphaFromAlpha(data, w, h, k) {
  const n = w * h;
  const INF = 1e9;
  const d = new Float32Array(n);
  for (let i = 0, p = 3; i < n; i++, p += 4) d[i] = data[p] > 127 ? 0 : INF;
  const d1 = 1, d2 = Math.SQRT2;
  // forward pass: top-left -> bottom-right (already-visited neighbours)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + d1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + d1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + d2);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + d2);
      }
      d[i] = v;
    }
  }
  // backward pass: bottom-right -> top-left
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, d[i + 1] + d1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + d1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + d2);
        if (x > 0) v = Math.min(v, d[i + w - 1] + d2);
      }
      d[i] = v;
    }
  }
  const out = new Float32Array(n);
  const kk = Math.max(1e-3, k);
  for (let i = 0; i < n; i++) {
    if (d[i] === 0) { out[i] = 1; continue; }      // inside the mask + its edge
    const t = Math.max(0, Math.min(1, 1 - d[i] / kk));
    out[i] = t * t * (3 - 2 * t);                  // smoothstep, same as the node
  }
  return out;
}
