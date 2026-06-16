// ============================================================
// Inpaint Crop Pixaroma — geometry (JS mirror of nodes/_inpaint_helpers.py)
// Keep computeRegion() 1:1 with the Python compute_region so the editor's live
// crop-rectangle preview matches what the node actually produces. Source of
// truth: docs/inpaint-crop-math.md. The ONLY accepted drift is sub-pixel rect
// placement (Python uses banker's rounding, JS uses round-half-up) - a +/-1px
// preview offset, never a different output size.
// ============================================================

export const GEO_DEFAULTS = {
  size_mode: "keep", target: 1024, target_w: 1024, target_h: 1024,
  multiple: 8, context_px: 24, context_pct: 10, mask_grow: 4, mask_blur: 4,
  blend: 16, min_size: 256, max_size: 2048, allow_upscale: true,
};

const roundMult = (v, m) => {
  m = Math.max(1, Math.round(m));
  return Math.max(m, Math.round(v / m) * m);
};
const clampi = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

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
  let out_w, out_h;
  if (mode === "force") {
    const tw = Math.max(mult, roundMult(p.target_w, mult));
    const th = Math.max(mult, roundMult(p.target_h, mult));
    const ta = tw / th;
    if (rw / rh < ta) rw = rh * ta; else rh = rw / ta;
    out_w = tw; out_h = th;
  } else if (mode === "free") {
    out_w = Math.min(roundMult(rw, mult), roundMult(p.max_size, mult));
    out_h = Math.min(roundMult(rh, mult), roundMult(p.max_size, mult));
  } else {
    const long = Math.max(rw, rh);
    let s = long > 0 ? p.target / long : 1;
    if (!p.allow_upscale) s = Math.min(s, 1);
    let ow = rw * s, oh = rh * s;
    // min_size bump FIRST, then the max_size clamp LAST as the hard ceiling - so an
    // extreme-aspect mask can't have its long side scaled past max_size (OOM).
    const small = Math.min(ow, oh);
    if (small < p.min_size) { const k = p.min_size / small; ow *= k; oh *= k; }
    const big = Math.max(ow, oh);
    if (big > p.max_size) { const k = p.max_size / big; ow *= k; oh *= k; }
    out_w = roundMult(ow, mult); out_h = roundMult(oh, mult);
  }

  let rw_i = Math.max(1, Math.min(Math.round(rw), W));
  let rh_i = Math.max(1, Math.min(Math.round(rh), H));
  if (mode === "force") {
    // keep the SOURCE aspect == output aspect after the image-bound clamp, or an
    // oblong image stretches (mirror of compute_region's force re-impose).
    const aspect = out_w / out_h;
    if (rw_i > rh_i * aspect) rw_i = Math.max(1, Math.round(rh_i * aspect));
    else rh_i = Math.max(1, Math.round(rw_i / aspect));
  }
  const rx = clampi(cx - rw_i / 2, 0, W - rw_i);
  const ry = clampi(cy - rh_i / 2, 0, H - rh_i);
  out_w = Math.max(mult, Math.round(out_w));
  out_h = Math.max(mult, Math.round(out_h));
  return { rx, ry, rw: rw_i, rh: rh_i, out_w, out_h };
}

// Bounding box of painted pixels from a mask canvas's alpha channel.
// Returns [x0,y0,x1,y1] (x1/y1 exclusive) or null when nothing is painted.
export function maskBBoxFromImageData(data, w, h, thresh = 8) {
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
