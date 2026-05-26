// Composer FX adjustment engine (JS side). Mirror of nodes/_fx_adjust_engine.py.
// Single source of truth: docs/composer-fx-math.md. No DOM use - runs in Node for parity.

export const NEUTRAL = {
  brightness: 0, contrast: 0, exposure: 0, highlights: 0, shadows: 0,
  whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0,
  tint: 0, hue: 0, sharpness: 0, clarity: 0, grain: 0, vignette: 0, fade: 0,
};

export const PRESETS = {
  "Original": {},
  "Punch": { contrast: 18, saturation: 20, clarity: 12 },
  "Warm": { temperature: 25, saturation: 8, contrast: 6 },
  "Cool": { temperature: -22, tint: -6, saturation: 6 },
  "Vintage": { contrast: -10, saturation: -18, temperature: 18, fade: 30 },
  "Faded": { contrast: -12, fade: 45, saturation: -8, blacks: 15 },
  "Matte": { contrast: -16, fade: 35, saturation: -6 },
  "Vivid": { saturation: 32, contrast: 12, vibrance: 20 },
  "Cross-process": { hue: -12, saturation: 26, contrast: 14, temperature: -10 },
  "Mono": { saturation: -100, contrast: 12 },
  "Noir": { saturation: -100, contrast: 40, blacks: 20 },
  "Sepia": { saturation: -100, temperature: 35, contrast: 6, fade: 10 },
};

const LR = 0.2126, LG = 0.7152, LB = 0.0722;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export function mergeAdjustments(adj) {
  const out = { ...NEUTRAL };
  if (adj) for (const k in NEUTRAL) if (adj[k] != null) out[k] = adj[k];
  return out;
}

export function isNeutral(adj, amount01) {
  if (amount01 <= 0) return true;
  const a = mergeAdjustments(adj);
  for (const k in a) if (a[k] !== 0) return false;
  return true;
}

function hueMatrix(deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
}

function sharpen(ch, w, h, k) {
  const out = new Float32Array(ch.length);
  const at = (x, y) => ch[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += at(x + dx, y + dy);
    const blur = s / 9, c = ch[y * w + x];
    out[y * w + x] = c + k * (c - blur);
  }
  return out;
}

// rgba: Uint8ClampedArray RGBA 0..255 (mutated in place). Alpha untouched.
export function applyFx(rgba, width, height, adj, amount01, seed = 0) {
  amount01 = clamp(+amount01, 0, 1);
  if (isNeutral(adj, amount01)) return rgba;
  const a = mergeAdjustments(adj);
  const n = width * height;

  const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  const or_ = new Float32Array(n), og = new Float32Array(n), ob = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    r[i] = or_[i] = rgba[p] / 255;
    g[i] = og[i] = rgba[p + 1] / 255;
    b[i] = ob[i] = rgba[p + 2] / 255;
  }

  const M = a.hue ? hueMatrix(a.hue) : null;
  for (let i = 0; i < n; i++) {
    let cr = r[i], cg = g[i], cb = b[i];
    if (a.exposure) { const f = 2 ** (a.exposure / 100); cr *= f; cg *= f; cb *= f; }
    if (a.brightness) { const o = a.brightness / 200; cr += o; cg += o; cb += o; }
    if (a.contrast) { const f = 1 + a.contrast / 100; cr = (cr - 0.5) * f + 0.5; cg = (cg - 0.5) * f + 0.5; cb = (cb - 0.5) * f + 0.5; }
    if (a.blacks) { const k = a.blacks / 100 * 0.5; cr += k * clamp(1 - 2 * cr, 0, 1); cg += k * clamp(1 - 2 * cg, 0, 1); cb += k * clamp(1 - 2 * cb, 0, 1); }
    if (a.shadows) { const k = a.shadows / 100 * 0.5; cr += k * (1 - cr) * (1 - cr); cg += k * (1 - cg) * (1 - cg); cb += k * (1 - cb) * (1 - cb); }
    if (a.highlights) { const k = a.highlights / 100 * 0.5; cr += k * cr * cr; cg += k * cg * cg; cb += k * cb * cb; }
    if (a.whites) { const k = a.whites / 100 * 0.5; cr += k * clamp(2 * cr - 1, 0, 1); cg += k * clamp(2 * cg - 1, 0, 1); cb += k * clamp(2 * cb - 1, 0, 1); }
    if (a.temperature) { const o = a.temperature / 100 * 0.10; cr += o; cb -= o; }
    if (a.tint) { cg += a.tint / 100 * 0.10; }
    if (a.saturation) { const L = LR * cr + LG * cg + LB * cb, f = 1 + a.saturation / 100; cr = L + (cr - L) * f; cg = L + (cg - L) * f; cb = L + (cb - L) * f; }
    if (a.vibrance) {
      const mx = Math.max(cr, cg, cb), mn = Math.min(cr, cg, cb);
      const sat = mx <= 0 ? 0 : (mx - mn) / mx, amt = a.vibrance / 100 * (1 - sat);
      const L = LR * cr + LG * cg + LB * cb, f = 1 + amt;
      cr = L + (cr - L) * f; cg = L + (cg - L) * f; cb = L + (cb - L) * f;
    }
    if (M) {
      const nr = M[0] * cr + M[1] * cg + M[2] * cb;
      const ng = M[3] * cr + M[4] * cg + M[5] * cb;
      const nb = M[6] * cr + M[7] * cg + M[8] * cb;
      cr = nr; cg = ng; cb = nb;
    }
    if (a.clarity) { const L = LR * cr + LG * cg + LB * cb, m = 1 - Math.abs(2 * L - 1), f = 1 + a.clarity / 100 * 0.5 * m; cr = (cr - 0.5) * f + 0.5; cg = (cg - 0.5) * f + 0.5; cb = (cb - 0.5) * f + 0.5; }
    r[i] = cr; g[i] = cg; b[i] = cb;
  }

  // Pass B - sharpness (3x3 box blur, edge replicate)
  if (a.sharpness) {
    const k = a.sharpness / 100;
    const sr = sharpen(r, width, height, k);
    const sg = sharpen(g, width, height, k);
    const sb = sharpen(b, width, height, k);
    r.set(sr); g.set(sg); b.set(sb);
  }

  // Pass C - coord (grain, vignette, fade) + amount blend + write back
  const inv = 1 / 0.70710678;
  const am = amount01, im = 1 - amount01;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let cr = r[i], cg = g[i], cb = b[i];
      if (a.grain) {
        const d = x * 12.9898 + y * 78.233 + seed * 37.719;
        let h = Math.sin(d) * 43758.5453; h = h - Math.floor(h);
        const nz = (h - 0.5) * (a.grain / 100) * 0.2;
        cr += nz; cg += nz; cb += nz;
      }
      if (a.vignette) {
        const dx = (x + 0.5) / width - 0.5, dy = (y + 0.5) / height - 0.5;
        const rr = Math.sqrt(dx * dx + dy * dy) * inv, v = clamp((rr - 0.5) / 0.5, 0, 1);
        const f = 1 - (a.vignette / 100) * v * v;
        cr *= f; cg *= f; cb *= f;
      }
      if (a.fade) { const m = 1 - a.fade / 100 * 0.15, o = a.fade / 100 * 0.10; cr = cr * m + o; cg = cg * m + o; cb = cb * m + o; }
      const p = i * 4;
      rgba[p] = Math.round((or_[i] * im + clamp01(cr) * am) * 255);
      rgba[p + 1] = Math.round((og[i] * im + clamp01(cg) * am) * 255);
      rgba[p + 2] = Math.round((ob[i] * im + clamp01(cb) * am) * 255);
    }
  }
  return rgba;
}

// Stable per-layer grain seed from id. Same 31-multiplier hash as Python _fx_seed.
export function fxSeed(layerId) {
  let h = 0;
  const s = layerId || "";
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 100000;
}
