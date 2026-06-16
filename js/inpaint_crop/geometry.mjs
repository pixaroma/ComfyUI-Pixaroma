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
