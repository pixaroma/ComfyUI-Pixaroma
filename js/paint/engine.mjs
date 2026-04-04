// ============================================================
// Pixaroma Paint Engine — Brush, Fill, Color, Smudge utilities
// ============================================================

export class BrushEngine {
  constructor() {
    this._stampCache = null;
    this._stampKey = "";
    this._strokeRemainder = 0;
    this._lastPt = null;
    this._velocity = 0;
    this._smudgePatch = null;
  }

  // ─── Stamp generation ────────────────────────────────────

  getStamp(size, hardness, shape, angle) {
    const key = `${size}|${hardness}|${shape}|${angle}`;
    if (key === this._stampKey && this._stampCache) return this._stampCache;
    this._stampKey = key;
    this._stampCache = this._buildStamp(size, hardness, shape, angle);
    return this._stampCache;
  }

  _buildStamp(size, hardness, shape, angle) {
    const pad = Math.ceil(size * 0.15) + 2;
    const dim = size + pad * 2;
    const cvs = document.createElement("canvas");
    cvs.width = dim;
    cvs.height = dim;
    const ctx = cvs.getContext("2d");
    const cx = dim / 2;
    const cy = dim / 2;
    const r = size / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((angle || 0) * Math.PI) / 180);

    const h01 = Math.max(0, Math.min(1, hardness / 100));

    switch (shape) {
      case "round":
        this._stampRound(ctx, r, h01);
        break;
      case "square":
        this._stampSquare(ctx, r, h01);
        break;
      case "triangle":
        this._stampTri(ctx, r, h01);
        break;
      case "diamond":
        this._stampDiamond(ctx, r, h01);
        break;
      case "star":
        this._stampStar(ctx, r, h01);
        break;
      case "flat":
        this._stampFlat(ctx, r, h01);
        break;
      case "leaf":
        this._stampLeaf(ctx, r, h01);
        break;
      default:
        this._stampRound(ctx, r, h01);
    }
    ctx.restore();

    // Softness via blur (only when hardness < ~0.98)
    if (h01 < 0.98) {
      const blurPx = (1 - h01) * r * 0.55;
      const soft = document.createElement("canvas");
      soft.width = dim;
      soft.height = dim;
      const sc = soft.getContext("2d");
      sc.filter = `blur(${blurPx.toFixed(2)}px)`;
      sc.drawImage(cvs, 0, 0);
      return soft;
    }
    return cvs;
  }

  _stampRound(ctx, r, h) {
    if (h >= 0.98) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = "#000";
      ctx.fill();
    } else {
      const inner = r * h;
      const g = ctx.createRadialGradient(0, 0, inner, 0, 0, r);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }
  }

  _stampSquare(ctx, r) {
    ctx.fillStyle = "#000";
    ctx.fillRect(-r, -r, r * 2, r * 2);
  }

  _stampTri(ctx, r) {
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.866, r * 0.5);
    ctx.lineTo(-r * 0.866, r * 0.5);
    ctx.closePath();
    ctx.fillStyle = "#000";
    ctx.fill();
  }

  _stampDiamond(ctx, r) {
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.fillStyle = "#000";
    ctx.fill();
  }

  _stampStar(ctx, r) {
    const inner = r * 0.42;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = (i * Math.PI) / 5 - Math.PI / 2;
      const rad = i % 2 === 0 ? r : inner;
      i === 0
        ? ctx.moveTo(Math.cos(ang) * rad, Math.sin(ang) * rad)
        : ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
    }
    ctx.closePath();
    ctx.fillStyle = "#000";
    ctx.fill();
  }

  _stampFlat(ctx, r) {
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#000";
    ctx.fill();
  }

  _stampLeaf(ctx, r) {
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.bezierCurveTo(r * 0.75, -r * 0.35, r * 0.75, r * 0.35, 0, r);
    ctx.bezierCurveTo(-r * 0.75, r * 0.35, -r * 0.75, -r * 0.35, 0, -r);
    ctx.closePath();
    ctx.fillStyle = "#000";
    ctx.fill();
  }

  // ─── Color tinting ───────────────────────────────────────

  tintStamp(stampCvs, hexColor) {
    const t = document.createElement("canvas");
    t.width = stampCvs.width;
    t.height = stampCvs.height;
    const ctx = t.getContext("2d");
    ctx.fillStyle = hexColor;
    ctx.fillRect(0, 0, t.width, t.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(stampCvs, 0, 0);
    return t;
  }

  // ─── Stroke interpolation ────────────────────────────────

  beginStroke(x, y) {
    this._strokeRemainder = 0;
    this._lastPt = { x, y };
    this._velocity = 0;
    return [{ x, y, pressure: 1.0 }];
  }

  continueStroke(x, y, spacingPx) {
    if (!this._lastPt) return [];
    const prev = this._lastPt;
    const dx = x - prev.x;
    const dy = y - prev.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Velocity-based pressure (slow = more, fast = less)
    this._velocity = this._velocity * 0.7 + dist * 0.3;
    const pressure = Math.max(0.2, Math.min(1.0, 1.0 - this._velocity * 0.015));

    if (dist === 0) return [];

    const stamps = [];
    let offset = Math.max(1, spacingPx) - this._strokeRemainder;
    while (offset <= dist) {
      const t = offset / dist;
      stamps.push({ x: prev.x + dx * t, y: prev.y + dy * t, pressure });
      offset += Math.max(1, spacingPx);
    }
    this._strokeRemainder = dist - (offset - Math.max(1, spacingPx));
    this._lastPt = { x, y };
    return stamps;
  }

  endStroke() {
    this._lastPt = null;
    this._strokeRemainder = 0;
  }

  // ─── Apply stamp to layer ────────────────────────────────

  applyStampToCtx(
    ctx,
    stamp,
    x,
    y,
    size,
    color,
    flowAlpha,
    isEraser,
    scatter,
    scatterAmt,
  ) {
    const half = stamp.width / 2;
    const sx =
      scatterAmt > 0 ? x + (Math.random() - 0.5) * scatterAmt * size : x;
    const sy =
      scatterAmt > 0 ? y + (Math.random() - 0.5) * scatterAmt * size : y;

    ctx.save();
    ctx.globalAlpha = flowAlpha;
    if (isEraser) {
      ctx.globalCompositeOperation = "destination-out";
      const tinted = this.tintStamp(stamp, "#000");
      ctx.drawImage(tinted, sx - half, sy - half);
    } else {
      ctx.globalCompositeOperation = "source-over";
      const tinted = this.tintStamp(stamp, color);
      ctx.drawImage(tinted, sx - half, sy - half);
    }
    ctx.restore();
  }

  // ─── Flood fill ──────────────────────────────────────────

  floodFill(canvas, startX, startY, fillColor, tolerance) {
    startX = Math.floor(Math.max(0, Math.min(canvas.width - 1, startX)));
    startY = Math.floor(Math.max(0, Math.min(canvas.height - 1, startY)));

    const ctx = canvas.getContext("2d");
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = id.data;
    const w = canvas.width;
    const h = canvas.height;

    // Parse fill color
    const tmp = document.createElement("canvas");
    tmp.width = tmp.height = 1;
    const tc = tmp.getContext("2d");
    tc.fillStyle = fillColor;
    tc.fillRect(0, 0, 1, 1);
    const fc = tc.getImageData(0, 0, 1, 1).data;
    const [fr, fg, fb, fa] = [fc[0], fc[1], fc[2], 255];

    const si = (startY * w + startX) * 4;
    const [tr, tg, tb, ta] = [
      data[si],
      data[si + 1],
      data[si + 2],
      data[si + 3],
    ];

    if (tr === fr && tg === fg && tb === fb && ta === fa) return;

    const tol = Math.max(0, tolerance);
    const match = (i) =>
      Math.abs(data[i] - tr) <= tol &&
      Math.abs(data[i + 1] - tg) <= tol &&
      Math.abs(data[i + 2] - tb) <= tol &&
      Math.abs(data[i + 3] - ta) <= tol;

    const set = (i) => {
      data[i] = fr;
      data[i + 1] = fg;
      data[i + 2] = fb;
      data[i + 3] = fa;
    };

    // Scanline fill
    const stack = [[startX, startY]];
    const visited = new Uint8Array(w * h);

    while (stack.length > 0) {
      let [cx, cy] = stack.pop();
      if (visited[cy * w + cx]) continue;

      let lx = cx;
      while (lx > 0 && match((cy * w + lx - 1) * 4)) lx--;

      let spanUp = false,
        spanDn = false;
      let rx = lx;

      while (rx < w) {
        const i = (cy * w + rx) * 4;
        if (!match(i)) break;
        if (visited[cy * w + rx]) {
          rx++;
          continue;
        }
        set(i);
        visited[cy * w + rx] = 1;

        if (cy > 0) {
          const ni = ((cy - 1) * w + rx) * 4;
          if (!spanUp && match(ni) && !visited[(cy - 1) * w + rx]) {
            stack.push([rx, cy - 1]);
            spanUp = true;
          } else if (spanUp && (!match(ni) || visited[(cy - 1) * w + rx])) {
            spanUp = false;
          }
        }
        if (cy < h - 1) {
          const ni = ((cy + 1) * w + rx) * 4;
          if (!spanDn && match(ni) && !visited[(cy + 1) * w + rx]) {
            stack.push([rx, cy + 1]);
            spanDn = true;
          } else if (spanDn && (!match(ni) || visited[(cy + 1) * w + rx])) {
            spanDn = false;
          }
        }
        rx++;
      }
    }
    ctx.putImageData(id, 0, 0);
  }

  // ─── Eyedropper ──────────────────────────────────────────

  sampleColor(canvas, x, y) {
    x = Math.round(Math.max(0, Math.min(canvas.width - 1, x)));
    y = Math.round(Math.max(0, Math.min(canvas.height - 1, y)));
    const ctx = canvas.getContext("2d");
    const d = ctx.getImageData(x, y, 1, 1).data;
    return `#${d[0].toString(16).padStart(2, "0")}${d[1].toString(16).padStart(2, "0")}${d[2].toString(16).padStart(2, "0")}`;
  }

  // ─── Smudge ──────────────────────────────────────────────

  smudgeBegin(ctx, x, y, size) {
    // Sample initial patch at stroke start
    const r = Math.ceil(size / 2);
    const sx = Math.max(0, Math.round(x) - r);
    const sy = Math.max(0, Math.round(y) - r);
    const sw = Math.min(ctx.canvas.width - sx, size * 2);
    const sh = Math.min(ctx.canvas.height - sy, size * 2);
    if (sw <= 0 || sh <= 0) {
      this._smudgePatch = null;
      return;
    }
    const id = ctx.getImageData(sx, sy, sw, sh);
    this._smudgePatch = { id, x: sx, y: sy, w: sw, h: sh, brushR: r };
  }

  smudge(ctx, x, y, lastX, lastY, size, strength) {
    const r = Math.ceil(size / 2);
    // Sample from lastX/lastY (source of smear)
    const srcX = Math.max(0, Math.round(lastX) - r);
    const srcY = Math.max(0, Math.round(lastY) - r);
    const sw = Math.min(ctx.canvas.width - srcX, size);
    const sh = Math.min(ctx.canvas.height - srcY, size);
    if (sw <= 0 || sh <= 0) return;

    const patch = ctx.getImageData(srcX, srcY, sw, sh);
    const tmp = document.createElement("canvas");
    tmp.width = sw;
    tmp.height = sh;
    tmp.getContext("2d").putImageData(patch, 0, 0);

    // Deposit at current position with round mask
    const dstX = Math.round(x) - r;
    const dstY = Math.round(y) - r;
    const alpha = Math.max(0.05, Math.min(0.95, (strength / 100) * 0.65));

    ctx.save();
    // Circular clipping mask so smudge is brush-shaped
    ctx.beginPath();
    ctx.arc(Math.round(x), Math.round(y), r, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(tmp, dstX, dstY);
    ctx.restore();
  }
}

// ─── Color conversion helpers ─────────────────────────────────────────────────

export function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

export function rgbToHex(r, g, b) {
  return (
    "#" +
    Math.round(r).toString(16).padStart(2, "0") +
    Math.round(g).toString(16).padStart(2, "0") +
    Math.round(b).toString(16).padStart(2, "0")
  );
}

export function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0,
    s = max === 0 ? 0 : d / max,
    v = max;
  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h: h * 360, s, v };
}

export function hsvToRgb(h, s, v) {
  h = h / 360;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r, g, bl;
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      bl = p;
      break;
    case 1:
      r = q;
      g = v;
      bl = p;
      break;
    case 2:
      r = p;
      g = v;
      bl = t;
      break;
    case 3:
      r = p;
      g = q;
      bl = v;
      break;
    case 4:
      r = t;
      g = p;
      bl = v;
      break;
    case 5:
      r = v;
      g = p;
      bl = q;
      break;
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(bl * 255),
  };
}

export function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0,
    l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}

export function hslToRgb(h, s, l) {
  h /= 360;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}
