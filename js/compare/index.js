import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";
import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/nodes2.mjs";
// Buttons: Show 1 | Left Right | Up Down | Overlay | Difference
// "Show 1" toggles: Show 1 → Show 2 → back to compare (deselects)
const MODES = ["Left Right", "Right Left", "Up Down", "Overlay", "Difference"];
const SLIDER_PAD = 50; // "Opacity" label width
const MODE_HINTS = [
  "↔  Hover image to slide left / right",
  "↔  Hover image to slide right / left",
  "↕  Hover image to slide up / down",
  "",
  "Shows pixel differences between images",
];
const SHOW_HINTS = [
  "Showing image 1  ·  Click again to switch",
  "Showing image 2  ·  Click again to switch",
];

// Layout constants
const BTN_GAP = 3;
const BTN_H = 18;
const BTN_W = 56;
const BTN_X = 80; // start X (right of input labels)
const ROW1_Y = 10;
const ROW2_Y = 30;
const IMG_Y = 54; // image area starts here
const INIT_W = 440;
const INIT_H = INIT_W + IMG_Y; // square preview area
const MIN_W = BTN_X + BTN_W * 6 + BTN_GAP * 5 + 6;
const MIN_H = IMG_Y + 100;

// Button rect helpers — Show toggle is first, then 4 mode buttons.
// The row layout is RESPONSIVE to the body width W so the 6 buttons + the Copy
// button always fit. Legacy keeps the BTN_X (80px) left margin to clear the
// canvas-painted input-slot labels (image1 / image2); in Nodes 2.0 the slots
// are rendered by Vue ABOVE the DOM-widget canvas, so that 80px would be wasted
// space that pushes the rightmost button off the edge — use a small margin
// there instead. Both paintCompare and the hit-tests call rowLayout(W), and
// both read isVueNodes(), so they always agree within a renderer.
function rowLayout(W) {
  const gap = BTN_GAP;
  const vue = isVueNodes();
  const leftPad = vue ? 12 : BTN_X;
  const rightPad = vue ? 12 : 6;
  const n = 6; // Show toggle + 5 mode buttons
  let bw = Math.floor((W - leftPad - rightPad - gap * (n - 1)) / n);
  // Legacy caps at the classic 56px (keeps the legacy node byte-identical);
  // Nodes 2.0 lets the buttons FILL the body width so there's no trailing gap
  // on a wide node (the canvas is the whole body width there).
  bw = Math.max(30, vue ? bw : Math.min(BTN_W, bw));
  return { leftPad, gap, bw };
}
function showRect(W) {
  const L = rowLayout(W);
  return { x: L.leftPad, y: ROW1_Y, w: L.bw, h: BTN_H };
}
function modeRect(W, i) {
  const L = rowLayout(W);
  return { x: L.leftPad + (i + 1) * (L.bw + L.gap), y: ROW1_Y, w: L.bw, h: BTN_H };
}
function hintRect(W) {
  const L = rowLayout(W);
  return { x: L.leftPad, y: ROW2_Y, w: L.bw * 6 + L.gap * 5, h: BTN_H };
}
function copyRect(W) {
  // Stacks directly under Difference (modeRect(4)), same width.
  const last = modeRect(W, 4);
  return { x: last.x, y: ROW2_Y, w: last.w, h: BTN_H };
}
// Opacity-slider track geometry, derived PURELY from the body width. The
// hit-test (cmpDown/cmpMove) computes this on demand instead of reading a value
// stashed during the last paint — important in Nodes 2.0 where the canvas only
// repaints on demand (a tap with no preceding move could otherwise see a stale/
// null geometry). Legacy repainted every frame so it never hit this, but
// deriving it keeps both renderers correct.
function sliderGeo(W) {
  const r2 = hintRect(W);
  const trackX = r2.x + SLIDER_PAD;
  const trackW = r2.w - SLIDER_PAD - 36;
  const trackY = r2.y + r2.h / 2 - 3;
  const trackH = 6;
  return { trackX, trackW, trackY, trackH };
}

// Cursor for the Nodes 2.0 DOM body (legacy keeps LiteGraph's own per-region
// cursor). Without this the DOM node inherits ComfyUI's pointer cursor over the
// WHOLE body, which wrongly implies the entire node is one big button. We point
// only over clickable controls, show a resize cursor over the slide area, and a
// plain arrow everywhere else.
function cmpCursor(node, lx, ly, W, H) {
  const p = [lx, ly];
  if (inside(p, showRect(W))) return "pointer";
  for (let i = 0; i < 5; i++) if (inside(p, modeRect(W, i))) return "pointer";
  if (node._cmpShowWhich !== 0 && inside(p, copyRect(W))) return "pointer";
  if (node._cmpShowWhich === 0 && node._cmpMode === 3) {
    const g = sliderGeo(W);
    if (lx >= g.trackX - 8 && lx <= g.trackX + g.trackW + 8 &&
        ly >= g.trackY - 6 && ly <= g.trackY + g.trackH + 6) return "pointer";
  }
  // Hover-to-slide image area (Left/Right -> ↔, Up Down -> ↕)
  if (ly >= IMG_Y && node._cmpShowWhich === 0 && (node._cmpImg1 || node._cmpImg2)) {
    if (node._cmpMode <= 1) return "ew-resize";
    if (node._cmpMode === 2) return "ns-resize";
  }
  return "default";
}
function inside(pos, r) {
  return (
    pos[0] >= r.x && pos[0] <= r.x + r.w && pos[1] >= r.y && pos[1] <= r.y + r.h
  );
}
function paintBtn(ctx, r, label, on, hovered) {
  ctx.fillStyle = on ? BRAND : "#2a2c2e";
  // Hover on a non-active bordered control: border -> BRAND + text brightens,
  // no fill change (the Pixaroma node UI convention, CLAUDE.md #13). Active
  // buttons keep the solid BRAND fill.
  ctx.strokeStyle = on ? BRAND : (hovered ? BRAND : "#444");
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, 3);
  else ctx.rect(r.x, r.y, r.w, r.h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = on ? "#fff" : (hovered ? "#ddd" : "#999");
  ctx.font = "9px 'Segoe UI',sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
}

// Setting ID and option list
const SETTING_DEFAULT_MODE = "Pixaroma.Compare.DefaultMode";
const DEFAULT_MODE_OPTIONS = [
  "Show 2", "Show 1", "Left Right", "Right Left",
  "Up Down", "Overlay", "Difference",
];

// Persistence (Vue Compat #11 / Preview Image Pattern #4): view state and
// loaded image refs live on node.properties so the comparison survives Vue
// workflow tab switching. LiteGraph serializes properties to workflow JSON
// natively, so the temp/ PNGs (which survive tab switching but not ComfyUI
// restart) stay paired to the right node.
const STATE_KEY = "compareState";

// Repaint in BOTH renderers. Legacy: node.setDirtyCanvas redraws the canvas-
// painted body. Nodes 2.0: the body is our own DOM <canvas> (NOT a bridged
// widget), so we must call its render() directly — setDirtyCanvas alone never
// repaints it. Mirrors the Preview Image `repaint()` helper.
function cmpRepaint(node) {
  if (!node) return;
  node.setDirtyCanvas?.(true, true);
  if (window.LiteGraph?.vueNodesMode) node._cmpDomRender?.();
}

function buildCmpUrl(d) {
  return `/view?filename=${encodeURIComponent(d.filename)}&type=${encodeURIComponent(d.type)}&subfolder=${encodeURIComponent(d.subfolder || "")}&t=${Date.now()}`;
}

function loadCmpImage(node, meta, idx) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    if (idx === 0) node._cmpImg1 = img;
    else node._cmpImg2 = img;
    node.imgs = null;
    cmpRepaint(node);
  };
  img.src = buildCmpUrl(meta);
}

// Copy the currently-shown image (Show 1 / Show 2) to the OS clipboard
// as PNG. Mirrors Preview Image Pixaroma Pattern #12: force MIME to
// "image/png" (some servers return image/x-png and ClipboardItem is
// strict), fall back to a toast if the Clipboard API is unavailable.
// The 700ms green-flash feedback runs entirely off node._cmpCopyFlash —
// the next two redraws (set + clear) trigger via cmpRepaint.
async function copyShownImage(node) {
  const which = node._cmpShowWhich;
  if (which !== 1 && which !== 2) return;
  const img = which === 1 ? node._cmpImg1 : node._cmpImg2;
  if (!img || !img.src) return;
  const toast = (msg) => {
    const t = app.extensionManager?.toast;
    if (t?.add) t.add({ severity: "warn", summary: "Compare", detail: msg, life: 2500 });
    else console.warn("[Pixaroma] Compare:", msg);
  };
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      toast("Clipboard not available in this browser");
      return;
    }
    const resp = await fetch(img.src);
    const raw = await resp.blob();
    const blob = raw.type === "image/png"
      ? raw
      : new Blob([await raw.arrayBuffer()], { type: "image/png" });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    node._cmpCopyFlash = true;
    cmpRepaint(node);
    setTimeout(() => {
      node._cmpCopyFlash = false;
      cmpRepaint(node);
    }, 700);
  } catch (err) {
    console.warn("[Pixaroma] Compare copy failed:", err);
    toast("Could not copy to clipboard");
  }
}

function saveCompareState(node) {
  node.properties = node.properties || {};
  const prev = node.properties[STATE_KEY] || {};
  node.properties[STATE_KEY] = {
    mode: node._cmpMode ?? 0,
    showWhich: node._cmpShowWhich ?? 0,
    opacity: node._cmpOpacity ?? 0.5,
    images: prev.images || [],
  };
}

function saveCompareImagesToProps(node, outputImages) {
  node.properties = node.properties || {};
  node.properties[STATE_KEY] = {
    mode: node._cmpMode ?? 0,
    showWhich: node._cmpShowWhich ?? 0,
    opacity: node._cmpOpacity ?? 0.5,
    images: outputImages.slice(0, 2).map((d) => ({
      filename: d.filename,
      subfolder: d.subfolder || "",
      type: d.type || "temp",
    })),
  };
}

function restoreCompareFromProperties(node) {
  if (node._cmpImg1 || node._cmpImg2) return; // idempotent
  const s = node.properties?.[STATE_KEY];
  if (!s) return;
  if (typeof s.mode === "number") node._cmpMode = s.mode;
  if (typeof s.showWhich === "number") node._cmpShowWhich = s.showWhich;
  if (typeof s.opacity === "number") node._cmpOpacity = s.opacity;
  if (Array.isArray(s.images) && s.images.length === 2) {
    loadCmpImage(node, s.images[0], 0);
    loadCmpImage(node, s.images[1], 1);
  }
  cmpRepaint(node);
}

// ── Body painter (renderer-agnostic) ─────────────────────────
// Draws the WHOLE Compare body (buttons + slider/hint + copy + image area)
// into `ctx` at origin (0,0) using the supplied width/height. Legacy passes
// this.size + a hover position derived from app.canvas.graph_mouse; the
// Nodes 2.0 DOM canvas passes its CSS box + the last DOM pointer position.
// `mouse` = {x, y} in the SAME local coords as the draw, or null (no hover).
function paintCompare(ctx, node, W, H, mouse) {
  // ── Row 1: Show toggle + mode buttons ──
  ctx.save();
  const showLabel = node._cmpShowWhich === 1 ? "Show 1" : node._cmpShowWhich === 2 ? "Show 2" : "Show 1";
  const hov = (rect) => !!(mouse &&
    mouse.x >= rect.x && mouse.x <= rect.x + rect.w &&
    mouse.y >= rect.y && mouse.y <= rect.y + rect.h);
  const sr = showRect(W);
  paintBtn(ctx, sr, showLabel, node._cmpShowWhich !== 0, hov(sr));
  for (let i = 0; i < 5; i++) {
    const mr = modeRect(W, i);
    paintBtn(ctx, mr, MODES[i], node._cmpShowWhich === 0 && node._cmpMode === i, hov(mr));
  }
  ctx.restore();

  // ── Row 2: opacity slider or hint text (same height) ──
  ctx.save();
  const r2 = hintRect(W);
  if (node._cmpShowWhich === 0 && node._cmpMode === 3) {
    // Slider track (geometry from sliderGeo(W) so paint + hit-test always agree)
    const { trackX, trackW, trackY, trackH } = sliderGeo(W);
    const pct = node._cmpOpacity;
    const thumbX = trackX + trackW * pct;

    // Label
    ctx.font = "9px 'Segoe UI',sans-serif";
    ctx.fillStyle = "#999";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Opacity", r2.x, r2.y + r2.h / 2);

    // Track bg
    ctx.fillStyle = "#2a2c2e";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(trackX, trackY, trackW, trackH, 3);
    else ctx.rect(trackX, trackY, trackW, trackH);
    ctx.fill();

    // Track fill
    ctx.fillStyle = BRAND;
    ctx.beginPath();
    if (ctx.roundRect)
      ctx.roundRect(trackX, trackY, Math.max(0, trackW * pct), trackH, 3);
    else ctx.rect(trackX, trackY, trackW * pct, trackH);
    ctx.fill();

    // Thumb
    ctx.fillStyle = BRAND;
    ctx.beginPath();
    ctx.arc(thumbX, r2.y + r2.h / 2, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(thumbX, r2.y + r2.h / 2, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Value
    ctx.fillStyle = "#ccc";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(
      `${Math.round(pct * 100)}%`,
      trackX + trackW + 6,
      r2.y + r2.h / 2,
    );

  } else {
    ctx.fillStyle = "#999";
    ctx.font = "9px 'Segoe UI',sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const hint = node._cmpShowWhich !== 0
      ? SHOW_HINTS[node._cmpShowWhich - 1]
      : (MODE_HINTS[node._cmpMode] || "");
    ctx.fillText(hint, r2.x, r2.y + r2.h / 2);
  }
  ctx.restore();

  // ── Copy button (Show 1 / Show 2 only) ──
  // Sits on row 2 right-aligned. Same height as the row 1 buttons so
  // the node never changes height when the user toggles Show 1/2. In
  // comparison modes it stays hidden so the hint text or the opacity
  // slider keep full width. Mutually exclusive with the slider since
  // the slider only renders when _cmpShowWhich === 0.
  if (node._cmpShowWhich !== 0) {
    const cr = copyRect(W);
    // Hover via the passed local mouse pos (legacy = graph_mouse - node.pos;
    // Nodes 2.0 = last DOM pointer pos). Both are in the same coord space
    // as the rects we draw, so the hit-test is identical.
    let hover = false;
    if (mouse) {
      hover = mouse.x >= cr.x && mouse.x <= cr.x + cr.w && mouse.y >= cr.y && mouse.y <= cr.y + cr.h;
    }
    const flash = !!node._cmpCopyFlash;
    ctx.save();
    ctx.fillStyle = flash ? "#3ec371" : (hover ? BRAND : "#2a2c2e");
    ctx.strokeStyle = flash ? "#3ec371" : (hover ? BRAND : "#444");
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cr.x, cr.y, cr.w, cr.h, 3);
    else ctx.rect(cr.x, cr.y, cr.w, cr.h);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = (flash || hover) ? "#fff" : "#999";
    ctx.font = "9px 'Segoe UI',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      flash ? "Copied" : "Copy " + node._cmpShowWhich,
      cr.x + cr.w / 2,
      cr.y + cr.h / 2,
    );
    ctx.restore();
  }

  // ── Image area ──
  const imgH = H - IMG_Y;
  if (!node._cmpImg1 && !node._cmpImg2) {
    ctx.save();
    ctx.fillStyle = "#171718";
    ctx.fillRect(0, IMG_Y, W, imgH);
    ctx.fillStyle = "#555";
    ctx.font = "12px 'Segoe UI',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      "Connect images & run to compare",
      W / 2,
      IMG_Y + imgH / 2,
    );
    ctx.restore();
    return;
  }

  const fit = (img) => {
    if (!img) return { x: 0, y: IMG_Y, w: W, h: imgH };
    const a = img.naturalWidth / img.naturalHeight;
    const fh = W / a;
    if (fh <= imgH) return { x: 0, y: IMG_Y + (imgH - fh) / 2, w: W, h: fh };
    const fw = imgH * a;
    return { x: (W - fw) / 2, y: IMG_Y, w: fw, h: imgH };
  };
  const fr1 = fit(node._cmpImg1),
    fr2 = fit(node._cmpImg2);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, IMG_Y, W, imgH);
  ctx.clip();
  ctx.fillStyle = "#111";
  ctx.fillRect(0, IMG_Y, W, imgH);

  // ── Single image override ──
  if (node._cmpShowWhich !== 0) {
    const img = node._cmpShowWhich === 1 ? node._cmpImg1 : node._cmpImg2;
    if (img)
      ctx.drawImage(img, fit(img).x, fit(img).y, fit(img).w, fit(img).h);
    ctx.restore();
    return;
  }

  const m = node._cmpMode;
  if (m === 0 || m === 1) {
    // Left Right (0) and Right Left (1) — swap which image is on which side
    const imgL = m === 0 ? node._cmpImg2 : node._cmpImg1;
    const imgR = m === 0 ? node._cmpImg1 : node._cmpImg2;
    const frL = m === 0 ? fr2 : fr1;
    const frR = m === 0 ? fr1 : fr2;
    const sx = W * node._cmpSplitX;
    if (imgR) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, IMG_Y, W - sx, imgH);
      ctx.clip();
      ctx.drawImage(imgR, frR.x, frR.y, frR.w, frR.h);
      ctx.restore();
    }
    if (imgL) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, IMG_Y, sx, imgH);
      ctx.clip();
      ctx.drawImage(imgL, frL.x, frL.y, frL.w, frL.h);
      ctx.restore();
    }
    if (node._cmpSplitX > 0.01 && node._cmpSplitX < 0.99) {
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, IMG_Y);
      ctx.lineTo(sx, IMG_Y + imgH);
      ctx.stroke();
    }
  } else if (m === 2) {
    const sy = IMG_Y + imgH * node._cmpSplitY;
    if (node._cmpImg1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, sy, W, IMG_Y + imgH - sy);
      ctx.clip();
      ctx.drawImage(node._cmpImg1, fr1.x, fr1.y, fr1.w, fr1.h);
      ctx.restore();
    }
    if (node._cmpImg2) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, IMG_Y, W, sy - IMG_Y);
      ctx.clip();
      ctx.drawImage(node._cmpImg2, fr2.x, fr2.y, fr2.w, fr2.h);
      ctx.restore();
    }
    if (node._cmpSplitY > 0.01 && node._cmpSplitY < 0.99) {
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
      ctx.stroke();
    }
  } else if (m === 3) {
    if (node._cmpImg1)
      ctx.drawImage(node._cmpImg1, fr1.x, fr1.y, fr1.w, fr1.h);
    if (node._cmpImg2) {
      ctx.globalAlpha = node._cmpOpacity;
      ctx.drawImage(node._cmpImg2, fr2.x, fr2.y, fr2.w, fr2.h);
      ctx.globalAlpha = 1;
    }
  } else {
    if (node._cmpImg1)
      ctx.drawImage(node._cmpImg1, fr1.x, fr1.y, fr1.w, fr1.h);
    if (node._cmpImg2) {
      ctx.globalCompositeOperation = "difference";
      ctx.drawImage(node._cmpImg2, fr2.x, fr2.y, fr2.w, fr2.h);
      ctx.globalCompositeOperation = "source-over";
    }
  }
  ctx.restore();
}

// ── Interaction (renderer-agnostic, local coords) ────────────
// Each returns true if it consumed the event / changed state. Callers handle
// the repaint. Legacy mouse hooks pass this.size as W/H; the DOM canvas passes
// its CSS box. Coords (lx, ly) are local to the same surface paintCompare drew.
function cmpDown(node, lx, ly, W, H) {
  const pos = [lx, ly];
  // Copy button (only visible in Show 1/2). Checked first; rects don't
  // overlap so this is just belt-and-braces.
  if (node._cmpShowWhich !== 0 && inside(pos, copyRect(W))) {
    copyShownImage(node);
    return true;
  }
  // Show toggle: toggles between Show 1 and Show 2
  if (inside(pos, showRect(W))) {
    node._cmpShowWhich = node._cmpShowWhich === 2 ? 1 : 2;
    saveCompareState(node);
    return true;
  }
  // Mode buttons — clicking one deselects Show mode
  for (let i = 0; i < 5; i++)
    if (inside(pos, modeRect(W, i))) {
      node._cmpMode = i;
      node._cmpShowWhich = 0;
      saveCompareState(node);
      return true;
    }
  // Opacity slider drag start (geometry derived from W — no dependency on a
  // prior paint having stashed it)
  if (node._cmpMode === 3) {
    const g = sliderGeo(W);
    const hx = g.trackX, hw = g.trackW, hy = g.trackY - 6, hh = g.trackH + 12;
    if (lx >= hx - 8 && lx <= hx + hw + 8 && ly >= hy && ly <= hy + hh) {
      node._cmpOpacity = Math.max(0, Math.min(1, (lx - hx) / hw));
      node._cmpDragging = true;
      return true;
    }
  }
  return false;
}

function cmpMove(node, lx, ly, W, H) {
  // Slider drag (works while the pointer is down; mode is always 3 while a
  // slider drag is in progress)
  if (node._cmpDragging && node._cmpMode === 3) {
    const g = sliderGeo(W);
    node._cmpOpacity = Math.max(0, Math.min(1, (lx - g.trackX) / g.trackW));
    return true;
  }
  // Hover-to-slide swipe (Left/Right/Up-Down modes) — no button required
  if (
    node._cmpShowWhich === 0 &&
    node._cmpMode <= 2 &&
    (node._cmpImg1 || node._cmpImg2)
  ) {
    const imgW = W,
      imgH = H - IMG_Y;
    if (node._cmpMode <= 1)
      node._cmpSplitX = Math.max(0, Math.min(1, lx / imgW));
    else node._cmpSplitY = Math.max(0, Math.min(1, (ly - IMG_Y) / imgH));
    return true;
  }
  return false;
}

function cmpUp(node) {
  if (node._cmpDragging) saveCompareState(node); // persist final opacity
  node._cmpDragging = false;
}

function cmpWheel(node, ly, deltaY) {
  if (node._cmpMode === 3 && ly > ROW1_Y) {
    node._cmpOpacity = Math.max(
      0,
      Math.min(1, node._cmpOpacity + (deltaY > 0 ? -0.05 : 0.05)),
    );
    saveCompareState(node);
    return true;
  }
  return false;
}

function cmpLeave(node) {
  if (node._cmpDragging) saveCompareState(node); // mouseup may not fire
  node._cmpDragging = false;
  if (node._cmpMode <= 1) {
    node._cmpSplitX = 0;
  } else if (node._cmpMode === 2) {
    node._cmpSplitY = 0;
  }
}

// ── Nodes 2.0 DOM-widget body ────────────────────────────────
// In Nodes 2.0 the canvas-painted body is silently skipped (drawNode early-
// returns), so the node would render empty. A bridged addCustomWidget can't
// fill-and-resize (the WidgetLegacy canvas+2 growth loop), so — exactly like
// the Preview Image strip — we use a DOM <div> + <canvas> widget that fills
// via CSS flex and is sized by a ResizeObserver, reusing paintCompare/cmp*
// unchanged. The legacy onDrawForeground + mouse hooks are left intact and
// only run in the legacy renderer.
function createCompareDOMWidget(node) {
  const root = document.createElement("div");
  root.className = "pix-cmp-root";
  // ComfyUI wraps this in a flex column whose children get flex:1. To fill the
  // allocated height we need flex:1 1 0 + min-height:0 (a flex item defaults to
  // min-height:auto = content height, which collapses it). The MIN_H floor is
  // guaranteed by computeLayoutSize below, so do NOT set height/min-height here.
  root.style.cssText =
    "position:relative;width:100%;flex:1 1 0;min-height:0;box-sizing:border-box;cursor:default;";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  root.appendChild(canvas);

  const widget = node.addDOMWidget("pixaroma_compare", "pixaroma_compare", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => MIN_H,
  });
  // A widget WITH computeLayoutSize gets a flexible `auto` grid row (so it
  // absorbs the node's free vertical space); without it, a fixed min-content
  // row. Compare's body IS the whole content, so it should grow.
  // minWidth MUST be 1 (NOT MIN_W): a real minWidth forces the Vue layout to
  // clamp the node width on every layout pass, overriding the SAVED width on
  // reload (the node snaps wider in every workflow on refresh/save-open). The
  // responsive button row (rowLayout) already adapts to any width, so a 1px
  // floor is safe. This matches the proven Preview Image strip widget.
  widget.computeLayoutSize = () => ({ minHeight: MIN_H, minWidth: 1 });
  applyAdaptiveCanvasOnly(widget);

  const render = () => {
    const cssW = root.clientWidth;
    const cssH = root.clientHeight;
    if (cssW <= 0 || cssH <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    node._cmpDomW = cssW;
    node._cmpDomH = cssH;
    paintCompare(ctx, node, cssW, cssH, node._cmpDomMouse || null);
  };
  node._cmpDomRender = render;

  const localPos = (e) => {
    const r = root.getBoundingClientRect();
    // The Vue node is CSS-transform-scaled by the graph zoom, so
    // getBoundingClientRect() returns SCREEN px while render() draws in layout
    // px (root.clientWidth/Height). Convert the click offset back to layout px
    // (divide by the zoom scale) so clicks line up with the drawn rects at ANY
    // zoom level. Without this, zooming in shifts every hit-test to the right /
    // down (e.g. clicking Overlay selects Difference; the Copy button is missed).
    const sx = r.width ? root.clientWidth / r.width : 1;
    const sy = r.height ? root.clientHeight / r.height : 1;
    return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy];
  };
  const W = () => node._cmpDomW || root.clientWidth;
  const H = () => node._cmpDomH || root.clientHeight;

  root.addEventListener("pointerdown", (e) => {
    const [lx, ly] = localPos(e);
    if (cmpDown(node, lx, ly, W(), H())) {
      e.stopPropagation();
      // Capture so a slider drag that leaves the canvas still tracks move/up.
      if (node._cmpDragging) {
        try { root.setPointerCapture(e.pointerId); } catch {}
      }
      render();
    }
  });
  root.addEventListener("pointermove", (e) => {
    const [lx, ly] = localPos(e);
    node._cmpDomMouse = { x: lx, y: ly };
    root.style.cursor = cmpCursor(node, lx, ly, W(), H());
    cmpMove(node, lx, ly, W(), H());
    render(); // also refreshes the Copy-button hover state
  });
  root.addEventListener("pointerup", (e) => {
    cmpUp(node);
    try { root.releasePointerCapture(e.pointerId); } catch {}
    render();
  });
  root.addEventListener("pointerleave", () => {
    node._cmpDomMouse = null;
    cmpLeave(node);
    render();
  });
  root.addEventListener("wheel", (e) => {
    const [, ly] = localPos(e);
    if (cmpWheel(node, ly, e.deltaY)) {
      // Only swallow the wheel when we consumed it (Overlay opacity); otherwise
      // let it bubble so the graph still zooms.
      e.preventDefault();
      e.stopPropagation();
      render();
    }
  }, { passive: false });

  const ro = new ResizeObserver(() => render());
  ro.observe(root);
  node._cmpDomRO = ro;
  requestAnimationFrame(render); // initial paint once laid out
  return widget;
}

app.registerExtension({
  name: "Pixaroma.Compare",
  settings: [
    {
      id: SETTING_DEFAULT_MODE,
      name: "Default Compare Mode",
      type: "combo",
      defaultValue: "Show 2",
      options: DEFAULT_MODE_OPTIONS,
      tooltip: "The initial view mode when a new Compare node is created",
      category: ["👑 Pixaroma", "Image Compare"],
    },
  ],
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaCompare") return;

    // ── Creation ─────────────────────────────────────────
    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _origCreated?.apply(this, arguments);

      // Read user's preferred default mode from settings
      const pref = app.ui?.settings?.getSettingValue?.(SETTING_DEFAULT_MODE) || "Show 2";
      const modeIdx = MODES.indexOf(pref);
      if (modeIdx !== -1) {
        this._cmpMode = modeIdx;
        this._cmpShowWhich = 0;
      } else if (pref === "Show 1") {
        this._cmpMode = 0;
        this._cmpShowWhich = 1;
      } else {
        // "Show 2" (default)
        this._cmpMode = 0;
        this._cmpShowWhich = 2;
      }

      this._cmpSplitX = 0;
      this._cmpSplitY = 0;
      this._cmpOpacity = 0.5;
      this._cmpImg1 = null;
      this._cmpImg2 = null;
      this.size[0] = INIT_W;
      this.size[1] = INIT_H;

      // Suppress ComfyUI's native output-image preview. Compare emits
      // ui.images (two temp PNGs) which the Vue frontend would otherwise
      // render as its own .image-preview panel, duplicating our viewer.
      // hideOutputImages is the official suppression flag (Preview Image
      // pattern); it's a harmless no-op in legacy where the native strip is
      // gated on node.imgs (which onExecuted/onDrawBackground null out).
      this.hideOutputImages = true;

      // Per-renderer split (fixed per page load): Nodes 2.0 gets a DOM-widget
      // canvas that reuses paintCompare/cmp*; legacy keeps the onDrawForeground
      // + mouse-hook canvas painting below. Only one path is live per instance.
      if (isVueNodes()) {
        createCompareDOMWidget(this);
      }

      // Restore view state + image refs from properties AFTER configure()
      // runs (Vue Compat #8 — nodeCreated fires before configure, so defer
      // via microtask). Survives Vue workflow tab switching.
      queueMicrotask(() => restoreCompareFromProperties(this));
    };

    // Belt-and-braces: also restore on explicit configure (workflow JSON
    // load). Idempotent via the early-return guard inside the helper.
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _origConfigure ? _origConfigure.apply(this, arguments) : undefined;
      restoreCompareFromProperties(this);
      return r;
    };

    // ── Execution — DO NOT call origExecuted (it creates preview widgets that shift layout)
    nodeType.prototype.onExecuted = function (output) {
      // Suppress default preview
      this.imgs = null;

      if (!output?.images || output.images.length < 2) return;
      // Persist image refs to node.properties before loading so a Vue tab
      // switch immediately after execution still restores correctly.
      saveCompareImagesToProps(this, output.images);
      loadCmpImage(this, output.images[0], 0);
      loadCmpImage(this, output.images[1], 1);
    };

    // Suppress default background image rendering (legacy only — onDrawBackground
    // does not fire in Nodes 2.0, where hideOutputImages handles suppression).
    nodeType.prototype.onDrawBackground = function () {
      if (this.flags?.collapsed) return;
      if (this.imgs) this.imgs = null;
    };

    // ── Drawing (legacy renderer only) ───────────────────
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (_origDraw) _origDraw.call(this, ctx);
      // Skip our custom painting while collapsed (avoids drawing over the
      // collapsed title pill).
      if (this.flags?.collapsed) return;
      // Nodes 2.0 paints via the DOM widget canvas; the canvas-render path is
      // skipped there anyway, and mutating node.size below would fight the Vue
      // flex layout, so bail.
      if (isVueNodes()) return;

      // Enforce min size
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;

      // Hover position for the Copy button: graph-mouse converted to node-local.
      let mouse = null;
      const gm = app.canvas?.graph_mouse;
      if (gm) mouse = { x: gm[0] - this.pos[0], y: gm[1] - this.pos[1] };

      paintCompare(ctx, this, this.size[0], this.size[1], mouse);
    };

    // ── Mouse (legacy renderer only — Nodes 2.0 routes via the DOM widget) ──
    const _origDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (e, pos) {
      if (isVueNodes()) return _origDown ? _origDown.call(this, e, pos) : undefined;
      if (cmpDown(this, pos[0], pos[1], this.size[0], this.size[1])) {
        app.graph.setDirtyCanvas(true, true);
        return true;
      }
      if (_origDown) return _origDown.call(this, e, pos);
    };

    const _origMove = nodeType.prototype.onMouseMove;
    nodeType.prototype.onMouseMove = function (e, pos) {
      if (isVueNodes()) return _origMove ? _origMove.call(this, e, pos) : undefined;
      if (cmpMove(this, pos[0], pos[1], this.size[0], this.size[1])) {
        app.graph.setDirtyCanvas(true, true);
      }
      if (_origMove) return _origMove.call(this, e, pos);
    };

    const _origUp = nodeType.prototype.onMouseUp;
    nodeType.prototype.onMouseUp = function (e, pos) {
      if (isVueNodes()) return _origUp ? _origUp.call(this, e, pos) : undefined;
      cmpUp(this);
      if (_origUp) return _origUp.call(this, e, pos);
    };

    const _origWheel = nodeType.prototype.onMouseWheel;
    nodeType.prototype.onMouseWheel = function (e, pos) {
      if (isVueNodes()) return _origWheel ? _origWheel.call(this, e, pos) : undefined;
      if (cmpWheel(this, pos[1], e.deltaY)) {
        app.graph.setDirtyCanvas(true, true);
        return true;
      }
      if (_origWheel) return _origWheel.call(this, e, pos);
    };

    const _origLeave = nodeType.prototype.onMouseLeave;
    nodeType.prototype.onMouseLeave = function (e) {
      if (isVueNodes()) return _origLeave ? _origLeave.call(this, e) : undefined;
      cmpLeave(this);
      app.graph.setDirtyCanvas(true, true);
      if (_origLeave) return _origLeave.call(this, e);
    };

    // add min resize while resizing
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (e) {
      if (_origResize) return _origResize.call(this, e);
      // Nodes 2.0: leave sizing to the Vue flex layout (writing node.size
      // fights it).
      if (isVueNodes()) return;
      this.size[0] = Math.max(this.size[0], 390);
      this.size[1] = Math.max(this.size[1], 390);
    };

    // Release the DOM-widget ResizeObserver on node removal (Nodes 2.0).
    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try { this._cmpDomRO?.disconnect(); } catch {}
      this._cmpDomRO = null;
      this._cmpDomRender = null;
      return _origRemoved ? _origRemoved.apply(this, arguments) : undefined;
    };
  },
});
