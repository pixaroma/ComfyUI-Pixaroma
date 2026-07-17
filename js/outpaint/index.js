// Outpaint Pixaroma - the node face: mode, ratio, add-space and limit rows, and
// the preview that shows where the green will land.
// One DOM widget, both renderers. The maths lives in core.mjs (mirroring
// nodes/node_outpaint.py); this file only paints it and collects clicks.
//
// The preview is the composition, the badge is the truth: the picture is drawn
// at the PADDED proportions, so after a megapixel cap the real output is smaller
// than it implies. The badge states the final numbers. Help says so too.
//
// State lives on node.properties.outpaintState and is injected into the hidden
// OutpaintState input by the graphToPrompt hook at the bottom (Vue Compat #9),
// so nothing here needs a visible widget or an input dot.
//
// The chevron, the gear and the colour swatch are rendered at their final
// geometry but are deliberately INERT: the settings panel is a later task and a
// button that opens nothing would be a lie. They carry the "dim" class until
// then so they read as not-yet-live rather than broken.

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { applyAdaptiveCanvasOnly, canvasBackingScale, installZoomRepaint } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import {
  BRAND, DEFAULT_RATIOS, DEFAULT_STATE, LIMITS, STATE_PROP,
  anchorAxis, finalSize, padsForState, readState, remapAnchor, writeState,
} from "./core.mjs";

const CLASS = "PixaromaOutpaint";
const HIDDEN_INPUT = "OutpaintState"; // must match node_outpaint.py's hidden input

// Measured on the user's own canvas, 2026-07-17: the size they actually drag an
// Outpaint node to. Verified before adopting - 305 leaves the ratio row 267px and
// six chips need 206, so even the widest set the settings panel allows still fits
// on one line.
const DEFAULT_W = 305;
const MIN_W = 305;
// Deliberately taller than the floor, which is what separates this from the
// compact utility nodes where default == minimum (node UI convention #5). The
// extra height goes to the preview - the picture is the point of the node, and at
// the bare floor it gets ~121px where this gives it ~180. Safe against snapFresh,
// which only ever grows a node UP to its floor, so a default above it is left
// alone; and safe to drag smaller, since nothing here clamps the width or height.
const DEFAULT_H = 421;

// Height maths. These mirror the CSS below - keep them in lockstep.
const PAD = 9;      // .pix-op-inner padding, top + bottom
const ROW_GAP = 6;  // gap between rows
// The preview height the floor ASKS for. Deliberately not a CSS min-height (see
// .pix-op-prev): the preview may shrink below this when the body is tight, which
// is why measureFloor counts this constant rather than the element's real height.
const PREVIEW_MIN = 120;
// Four rows (148) + a gap + the preview at its minimum. Used ONLY while the root
// is unmounted, so it must track the row set: any task that adds or removes a row
// has to move this with it.
const FLOOR_FALLBACK = 148 + ROW_GAP + PREVIEW_MIN;
const FLOOR_MIN = 60;
// A runaway guard, not a target (Save Image inflated to ~1830px without one).
// Pitched well above the real floor - even with every row wrapped at a narrow
// width the sum lands near 420 - so it can only ever catch nonsense.
const FLOOR_CAP = 460;

// ── preview ────────────────────────────────────────────────────────────────
const PREVIEW_INSET = 6;   // breathing room around the composition
const BAND_TEXT_MIN = 24;  // below this the band cannot hold text, so it hops out
const BAND_INK = "#0a3d0a"; // near-black ON the green: #00ff00 is far too bright for white

// ── source image ───────────────────────────────────────────────────────────
// Is anything wired in? Kept separate from the picture itself, because the two
// answer different questions: no wire is "connect an image", while a wire whose
// picture has not arrived is "run once" - and telling the user the wrong one of
// those sends them looking in the wrong place.
function hasWire(node) {
  const slot = (node.inputs || []).find((i) => i && i.name === "image");
  return !!slot && slot.link != null;
}

// TIER 1 only: the picture the upstream node already holds (Load Image, Preview
// Image). Kept separate from sourceImage because the executed handler must ask
// this exact question - "does the browser already have it?" - and must NOT be
// satisfied by our own cached base frame, or the second run would skip its
// stash and the preview would sit on the first generated image for ever.
function upstreamImage(node) {
  if (!hasWire(node)) return null;
  try {
    const slot = (node.inputs || []).find((i) => i && i.name === "image");
    const graph = node.graph || app.graph;
    // graph.links can be a Map in newer frontends (Vue Compat #3).
    let link = graph?.links?.[slot.link];
    if (!link && typeof graph?.links?.get === "function") link = graph.links.get(slot.link);
    const img = link && graph.getNodeById?.(link.origin_id)?.imgs?.[0];
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) return img;
  } catch (_e) { /* an unresolved wire is not an error, just an unknown picture */ }
  return null;
}

// The picture to draw, in two tiers (the Text Overlay pattern):
//   1. upstream populates imgs[0] (Load Image, Preview Image) - instant, no Run
//   2. it does not (a VAE Decode mid-chain) - the frame Python stashed to temp/
//      on the last run, cached by the executed handler below
// Both are gated on the wire existing: a base frame left over from a since
// removed upstream would be a picture of something the node no longer receives.
function sourceImage(node) {
  if (!hasWire(node)) return null;
  const up = upstreamImage(node);
  if (up) return up;
  const base = node._pixOpBaseImg;
  return base && base.naturalWidth > 0 ? base : null;
}

// The dimensions of that picture, or null while they are not known yet.
function sourceSize(node) {
  const img = sourceImage(node);
  return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
}

// What the face is currently drawn against. Cheap on purpose: property reads
// only, no layout, so the watcher below can run forever without costing a reflow.
function sourceSig(node) {
  const img = sourceImage(node);
  return img ? (img.src || "?") + "|" + img.naturalWidth + "x" + img.naturalHeight : "none";
}

// The upstream picture arrives asynchronously AND can change at any time - the
// user picks another file in Load Image, or a run replaces the frame - and
// nothing tells us: there is no per-frame hook and no event (Vue Compat #1), so
// polling is the documented answer. This one is permanent rather than a brief
// burst, because "appears once loaded" and "keeps up when the file changes" are
// the same problem; without it the preview would silently show the previous
// image. It repaints only when the picture actually changed, and self-clears
// once the node leaves the graph.
function watchSource(node) {
  clearInterval(node._pixOpPoll);
  node._pixOpSrcSig = sourceSig(node);
  node._pixOpPoll = setInterval(() => {
    if (!node.graph) {
      clearInterval(node._pixOpPoll);
      node._pixOpPoll = null;
      return;
    }
    const sig = sourceSig(node);
    if (sig === node._pixOpSrcSig) return;
    node._pixOpSrcSig = sig;
    // The rows depend on the source too (the Add space triplet follows the
    // source aspect), so repaint the whole face, not just the preview.
    renderFace(node);
  }, 400);
}

// ── CSS ────────────────────────────────────────────────────────────────────
// No backticks anywhere inside this string (one would end the literal early and
// silently disable the whole extension), and no CSS unicode escapes (they are
// illegal octal escapes in a template literal) - the glyphs are set from JS.
function injectCSS() {
  if (document.getElementById("pixaroma-outpaint-css")) return;
  const css = `
    .pix-op-root { position:relative; width:100%; height:100%; box-sizing:border-box;
      background:#1d1d1d; border-radius:4px; color:#ddd;
      font-family: ui-sans-serif, system-ui, sans-serif; font-size:11px; }
    /* The flex column lives HERE, never on the root: ComfyUI forces the root to
       inline display:block on every rebuild and collapse, which would kill it. */
    .pix-op-inner { position:absolute; inset:0; box-sizing:border-box;
      display:flex; flex-direction:column; gap:${ROW_GAP}px; padding:${PAD}px;
      user-select:none; }
    .pix-op-row { display:flex; align-items:stretch; gap:5px; flex:0 0 auto;
      flex-wrap:wrap; }

    /* Chips: idle / hover / active per node UI convention #13. Hover moves the
       border and brightens the text - a fill would read as "active". */
    .pix-op-chip { flex:1 1 auto; min-width:0; box-sizing:border-box;
      display:flex; align-items:center; justify-content:center;
      padding:6px 4px; border-radius:5px;
      background:#1d1d1d; border:1px solid #444; color:#aaa;
      cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      transition:background .08s, border-color .08s, color .08s; }
    .pix-op-chip:hover { border-color:var(--pix-op-acc,${BRAND}); color:#ddd; }
    .pix-op-chip.on { background:var(--pix-op-acc,${BRAND});
      border-color:var(--pix-op-acc,${BRAND}); color:#fff; }
    /* Nothing to click: no pointer, no hover promise. */
    .pix-op-chip.dim { opacity:.4; cursor:default; }
    .pix-op-chip.dim:hover { border-color:#444; color:#aaa; }
    .pix-op-chip.dim.on:hover { border-color:var(--pix-op-acc,${BRAND}); color:#fff; }

    /* Chevron and gear: fixed, so the mode chips get every spare pixel. */
    .pix-op-sq { flex:0 0 auto; width:26px; padding:6px 0; }
    .pix-op-alabel { flex:0 0 auto; display:flex; align-items:center;
      color:#8a8a8a; padding-right:1px; white-space:nowrap; }

    /* A readout of the fill colour, not a button (its picker is a later task). */
    .pix-op-swatch { flex:0 0 auto; width:26px; border-radius:5px;
      border:1px solid #444; cursor:default; }

    /* The one grower: flex:1 1 0 hands it every spare pixel the rows do not use.
       min-height MUST be 0, and the floor lives in measureFloor instead. A real
       CSS min here looks tempting but backfires: a flex item cannot shrink below
       it, so whenever the body is tighter than the floor - which Nodes 2.0 is,
       its chrome being taller than the legacy computeSize estimate - the preview
       refuses to shrink and spills out over the category chip. With 0 it simply
       gets smaller, which is a graceful degradation rather than a broken node.
       (min-height also defaults to auto = content height, so it must be SET.) */
    .pix-op-prev { position:relative; flex:1 1 0; min-height:0;
      border-radius:4px; background:#151515; overflow:hidden; }
    /* Fills by inset rather than by flex: the canvas must not care what display
       the host forces on its parents. Backing store is sized in JS. */
    .pix-op-prev canvas { position:absolute; inset:0; width:100%; height:100%;
      display:block; }
  `;
  const s = document.createElement("style");
  s.id = "pixaroma-outpaint-css";
  s.textContent = css;
  document.head.appendChild(s);
}

// ── row builders ───────────────────────────────────────────────────────────
function chip(text, on, title) {
  const el = document.createElement("div");
  el.className = "pix-op-chip" + (on ? " on" : "");
  el.textContent = text;
  if (title) el.title = title;
  return el;
}

function row(host) {
  const el = document.createElement("div");
  el.className = "pix-op-row";
  host.appendChild(el);
  return el;
}

function apply(node, patch) {
  writeState(node, patch);
  renderFace(node);
  node.setDirtyCanvas?.(true, true);
}

function renderModeRow(node, host) {
  const st = readState(node);

  const chevron = chip("▾", false);
  chevron.classList.add("pix-op-sq", "dim"); // wired in the fold task
  host.appendChild(chevron);

  for (const [value, text, tip] of [
    ["ratio", "To ratio", "Grow the image to a target shape"],
    ["sides", "By side", "Add an exact number of pixels per edge"],
  ]) {
    const c = chip(text, st.mode === value, tip);
    c.onclick = () => apply(node, { mode: value });
    host.appendChild(c);
  }

  const gear = chip("⚙", false);
  gear.classList.add("pix-op-sq", "dim"); // wired in the settings task
  host.appendChild(gear);
}

function renderRatioRow(node, host) {
  const st = readState(node);
  // st.ratios is written by the settings task; fall back until it exists.
  const ratios = Array.isArray(st.ratios) && st.ratios.length ? st.ratios : DEFAULT_RATIOS;
  for (const r of ratios) {
    const c = chip(r, st.ratio === r, "Grow the image to " + r);
    c.onclick = () => apply(node, { ratio: r });
    host.appendChild(c);
  }
}

function renderAnchorRow(node, host) {
  const st = readState(node);
  const src = sourceSize(node);

  // By side mode: the per-edge numbers already say where everything goes, so an
  // anchor here would be a second, conflicting way to say the same thing.
  host.style.display = st.mode === "ratio" ? "" : "none";
  if (st.mode !== "ratio") return;

  // null covers two different things, and they must not be confused:
  //   src === null      -> the source size is unknown (nothing wired yet)
  //   axis === null     -> the source is known and this ratio grows nothing
  const axis = src ? anchorAxis(st.ratio, src.w, src.h) : null;
  const grows = !!axis;
  const shown = axis || "h"; // unknown source: show the horizontal triplet

  // "Both", not "Centre": the middle option splits the new space across both
  // sides, and "add space in the centre" would read as adding it in the middle
  // of the picture.
  const labels = shown === "v"
    ? [["top", "Top"], ["middle", "Both"], ["bottom", "Bottom"]]
    : [["left", "Left"], ["centre", "Both"], ["right", "Right"]];

  // Persist the remap so a 3:2 -> 9:16 flip keeps "hug the far edge" rather than
  // silently resetting to centre. Only when the live axis is genuinely KNOWN: an
  // unwired node shows the horizontal triplet as a placeholder, and remapping a
  // stored vertical anchor against that guess would corrupt it. Never on the
  // load path (Vue Compat #18) - the poll above can fire past the load window.
  const live = grows ? remapAnchor(st.anchor, axis) : st.anchor;
  if (live !== st.anchor && !isGraphLoading()) writeState(node, { anchor: live });

  // What the row HIGHLIGHTS, always in the shown triplet's vocabulary so a
  // stored cross-axis anchor still lights a chip. Display only, never written.
  const sel = remapAnchor(live, shown);

  const lbl = document.createElement("span");
  lbl.className = "pix-op-alabel";
  lbl.textContent = "Add space"; // NOT "Anchor" - see padsForRatio's comment
  host.appendChild(lbl);

  for (const [value, text] of labels) {
    const c = chip(text, sel === value);
    if (!grows) {
      c.classList.add("dim");
      c.title = src
        ? "This ratio matches the image, so there is nothing to add"
        : "Wire an image in to choose which side the new space goes on";
    } else {
      c.title = value === "centre" || value === "middle"
        ? "Split the new space evenly across both sides"
        : "Put the new space on the " + text.toLowerCase();
      c.onclick = () => apply(node, { anchor: value });
    }
    host.appendChild(c);
  }
}

function renderLimitRow(node, host) {
  const st = readState(node);
  for (const v of LIMITS) {
    const text = v === 0 ? "Off" : (v === 1 ? "1 MP" : String(v));
    const c = chip(text, st.limit === v, v === 0
      ? "Keep the padded size"
      : "Scale the padded image to " + v + " megapixels");
    c.onclick = () => apply(node, { limit: v });
    host.appendChild(c);
  }
  const sw = document.createElement("div");
  sw.className = "pix-op-swatch";
  sw.style.background = st.color;
  sw.title = "Fill colour: " + st.color;
  host.appendChild(sw);
}

// ── preview drawing ────────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Digit-only strings sit visually HIGH with textBaseline "middle": the em box
// reserves descender room that digits never use, and the gap scales with the
// font size. Centre on the real glyph box instead. Every readout in this preview
// is digits, so this is the default here, not the exception.
function fillTextVCenter(ctx, text, cx, cyMid) {
  const m = ctx.measureText(text);
  if (m.actualBoundingBoxAscent != null && m.actualBoundingBoxDescent != null) {
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, cx, cyMid + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  } else {
    ctx.textBaseline = "middle"; // very old browser: slightly high beats not drawn
    ctx.fillText(text, cx, cyMid);
  }
}

const PILL_H = 15;
const PILL_GAP = 4; // how far inside the image edge a hopped number sits

function pillW(ctx, text) { return ctx.measureText(text).width + 8; }

// A dark pill behind the text. Required the moment a number leaves the green: it
// lands on the photograph, where any fixed ink would vanish against some images.
function pill(ctx, text, cx, cyMid) {
  const w = pillW(ctx, text);
  ctx.fillStyle = "rgba(0,0,0,.72)";
  roundRect(ctx, cx - w / 2, cyMid - PILL_H / 2, w, PILL_H, 3);
  ctx.fill();
  ctx.fillStyle = "#eaffea";
  fillTextVCenter(ctx, text, cx, cyMid);
}

// One pad number. A band thick enough to hold text gets it ON the green in
// near-black; a thin one cannot, so the number hops just inside the image on a
// pill - which is what keeps a 32px pad readable instead of clipped to a smear.
function bandNumber(ctx, px, thick, onCx, onCy, offCx, offCy) {
  if (px <= 0) return;
  const text = String(px);
  if (thick >= BAND_TEXT_MIN) {
    ctx.fillStyle = BAND_INK;
    fillTextVCenter(ctx, text, onCx, onCy);
  } else {
    pill(ctx, text, offCx, offCy);
  }
}

function drawBandNumbers(ctx, pads, scale, ox, oy, dw, dh) {
  ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  const midX = ox + dw / 2;
  const midY = oy + dh / 2;
  const t = pads.top * scale, b = pads.bottom * scale;
  const l = pads.left * scale, r = pads.right * scale;

  bandNumber(ctx, pads.top, t, midX, oy + t / 2,
    midX, oy + t + PILL_GAP + PILL_H / 2);
  bandNumber(ctx, pads.bottom, b, midX, oy + dh - b / 2,
    midX, oy + dh - b - PILL_GAP - PILL_H / 2);
  bandNumber(ctx, pads.left, l, ox + l / 2, midY,
    ox + l + PILL_GAP + pillW(ctx, String(pads.left)) / 2, midY);
  bandNumber(ctx, pads.right, r, ox + dw - r / 2, midY,
    ox + dw - r - PILL_GAP - pillW(ctx, String(pads.right)) / 2, midY);
}

// The truth, as against the picture: after a megapixel cap the real output is
// smaller than the composition above implies, so the final numbers have to be
// stated outright rather than inferred from the drawing. Said again in Help.
function drawSizeBadge(ctx, cssW, cssH, fin) {
  const text = fin.w + " × " + fin.h;
  ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  const w = ctx.measureText(text).width + 12;
  const h = 17;
  const cx = cssW - PREVIEW_INSET - w / 2;
  const cy = cssH - PREVIEW_INSET - h / 2;
  ctx.fillStyle = "rgba(0,0,0,.72)";
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 3);
  ctx.fill();
  ctx.fillStyle = "#ddd";
  fillTextVCenter(ctx, text, cx, cy);
}

function drawEmptyPreview(ctx, w, h, wired) {
  ctx.save();
  ctx.strokeStyle = "#3a3a3a";
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  roundRect(ctx, 4.5, 4.5, Math.max(0, w - 9), Math.max(0, h - 9), 4);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#6a6a6a";
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle"; // has descenders, so the digit fix does not apply
  // A wire with no picture is a different problem from no wire at all, and
  // sending the user to fix the wrong one wastes their time.
  ctx.fillText(wired ? "Run once to see the preview" : "Connect an image", w / 2, h / 2);
}

function renderPreview(node) {
  const ui = node._pixOpUI;
  if (!ui || !ui.prev || !ui.canvas) return;
  const cssW = ui.prev.clientWidth;
  const cssH = ui.prev.clientHeight;
  if (cssW <= 0 || cssH <= 0) return; // not laid out yet - the observer calls back

  // Backing store at DPR x graph zoom: the node body is CSS-transform-scaled, so
  // a canvas sized only in layout pixels goes soft as soon as the user zooms in.
  const s = canvasBackingScale(cssW, cssH);
  const bw = Math.max(1, Math.round(cssW * s));
  const bh = Math.max(1, Math.round(cssH * s));
  if (ui.canvas.width !== bw || ui.canvas.height !== bh) {
    ui.canvas.width = bw;
    ui.canvas.height = bh;
  }
  const ctx = ui.canvas.getContext("2d");
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const img = sourceImage(node);
  if (!img) { drawEmptyPreview(ctx, cssW, cssH, hasWire(node)); return; }

  const st = readState(node);
  const src = { w: img.naturalWidth, h: img.naturalHeight };
  const pads = padsForState(st, src.w, src.h);
  const padW = src.w + pads.left + pads.right;
  const padH = src.h + pads.top + pads.bottom;

  // Fit the PADDED rect, not the image: the preview is the composition, so the
  // green belongs inside the frame at the same proportions as the real output.
  const scale = Math.min((cssW - PREVIEW_INSET * 2) / padW, (cssH - PREVIEW_INSET * 2) / padH);
  const dw = padW * scale;
  const dh = padH * scale;
  const ox = (cssW - dw) / 2;
  const oy = (cssH - dh) / 2;

  // Green underneath, image over it: the four bands are simply the green the
  // image does not cover, so they cannot drift out of step with the maths.
  ctx.fillStyle = st.color;
  ctx.fillRect(ox, oy, dw, dh);
  ctx.drawImage(img, ox + pads.left * scale, oy + pads.top * scale,
    src.w * scale, src.h * scale);

  ctx.strokeStyle = "rgba(255,255,255,.14)";
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 0.5, oy + 0.5, Math.max(0, dw - 1), Math.max(0, dh - 1));

  drawBandNumbers(ctx, pads, scale, ox, oy, dw, dh);
  drawSizeBadge(ctx, cssW, cssH, finalSize(src.w, src.h, pads, st.limit, st.snap));
}

function renderFace(node) {
  const ui = node._pixOpUI;
  if (!ui) return;
  const inner = ui.inner;
  inner.style.setProperty("--pix-op-acc", BRAND); // the settings task makes this per-node
  // Rebuild the ROWS only. The preview element is persistent: it owns a canvas
  // and a ResizeObserver, so recreating it on every chip click would leak an
  // observer per click and throw away a good backing store for nothing.
  for (const el of [...inner.children]) if (el !== ui.prev) el.remove();
  renderModeRow(node, row(inner));
  renderRatioRow(node, row(inner));
  renderAnchorRow(node, row(inner));
  renderLimitRow(node, row(inner));
  inner.appendChild(ui.prev); // appendChild MOVES an existing child, keeping it last
  renderPreview(node);
}

// ── height ─────────────────────────────────────────────────────────────────
// Sum the laid-out rows. REFUSE to measure an unmounted or zero-width root: the
// rows would wrap against no width and the sum would explode, inflating the node
// permanently. The 4px rounding stops font jitter creeping it taller on every
// workflow open (Vue Compat #18).
function measureFloor(node) {
  const ui = node._pixOpUI;
  if (!ui || !ui.root.isConnected || ui.root.clientWidth === 0) {
    return ui?._floorCache ?? FLOOR_FALLBACK;
  }
  let h = 0;
  let shown = 0;
  for (const child of ui.inner.children) {
    if (child.style.display === "none") continue; // the anchor row in By side mode
    // The preview counts as its MINIMUM, never its grown height. It is the flex
    // grower, so its offsetHeight is however much slack the node happens to have
    // - feeding that back as the floor would ratchet: the node could grow but
    // never shrink, because every measure would report the last size as the new
    // minimum. This is the Load Image count-at-min trick.
    h += (child === ui.prev) ? PREVIEW_MIN : child.offsetHeight;
    shown++;
  }
  if (!shown) return ui._floorCache ?? FLOOR_FALLBACK;
  h += (shown - 1) * ROW_GAP + PAD * 2;
  ui._floorCache = Math.min(Math.max(Math.round(h / 4) * 4, FLOOR_MIN), FLOOR_CAP);
  return ui._floorCache;
}

// ComfyUI's loadGraphData runs a fit pass over EVERY node: size = max(saved,
// computeSize()). A node saved shorter than its own computeSize therefore grows
// on the next open, which flags a clean workflow as modified (Vue Compat #18).
// This node is born short because the two ComfyUI size paths disagree: the live
// _arrangeWidgets settles it at slots+widget, while computeSize adds a slightly
// larger chrome estimate (measured: 214 vs 226). So mirror the load pass once at
// birth and the height we save is already the height the load will produce.
// FRESH nodes only - configure() owns a loaded node's size.
function snapFresh(node, tries = 0) {
  requestAnimationFrame(() => {
    if (!node.graph || node._pixOpConfigured || isGraphLoading()) return;
    const ui = node._pixOpUI;
    // computeSize is only trustworthy once the widget has a width: measureFloor
    // refuses to guess before that. Give layout a few frames, then snap anyway
    // (a node dropped off-screen never gets one).
    if ((!ui || !ui.root.isConnected || ui.root.clientWidth === 0) && tries < 20) {
      snapFresh(node, tries + 1);
      return;
    }
    let want = node.computeSize?.()?.[1] || 0;
    // computeSize estimates LEGACY chrome. Nodes 2.0 wraps the body in more of
    // it (its own slot strip, the category chip footer), so the very same height
    // leaves the widget area short there and the preview gets squeezed to a
    // sliver. Measure the ACTUAL shortfall rather than hardcoding a chrome
    // constant, which a frontend update would quietly rot.
    if (ui && ui.root.isConnected && ui.root.clientWidth > 0) {
      const deficit = measureFloor(node) - ui.root.clientHeight;
      if (deficit > 1) want = Math.max(want, node.size[1] + deficit);
    }
    if (want > 0 && node.size[1] < want - 1) {
      node.setSize?.([node.size[0], want]);
      node.setDirtyCanvas?.(true, true);
      // One correction pass: setSize re-runs layout, and in Nodes 2.0 the first
      // measurement is taken against the old body height, so the shortfall can
      // be revealed only once the new one lands. Bounded by tries.
      if (tries < 20) snapFresh(node, tries + 1);
    }
  });
}

// ── setup ──────────────────────────────────────────────────────────────────
function setupNode(node) {
  const root = document.createElement("div");
  root.className = "pix-op-root";
  const inner = document.createElement("div");
  inner.className = "pix-op-inner";
  root.appendChild(inner);

  // Built once and reused for the node's whole life - renderFace deliberately
  // steps around it rather than rebuilding it.
  const prev = document.createElement("div");
  prev.className = "pix-op-prev";
  const canvas = document.createElement("canvas");
  prev.appendChild(canvas);
  inner.appendChild(prev);

  node._pixOpUI = { root, inner, prev, canvas, _floorCache: FLOOR_FALLBACK };

  // node.onResize does not fire reliably for a DOM widget (Vue Compat #13), so
  // the element is watched directly: this catches a node resize, a renderer
  // reflow and a tab switch alike, whatever caused them.
  node._pixOpRO = new ResizeObserver(() => renderPreview(node));
  node._pixOpRO.observe(prev);

  // A graph zoom changes no layout box, so the observer above never sees it -
  // but it does change the backing scale, so without this the picture stays at
  // the resolution it was first drawn at and goes soft when zoomed in.
  node._pixOpZoomOff = installZoomRepaint(
    node, () => [prev.clientWidth, prev.clientHeight], () => renderPreview(node), "_pixOpZoomRaf");

  // No custom computeSize and no getMaxHeight: either makes the widget
  // fixed-height in legacy, so the node grows but can never shrink. minWidth 1
  // or the saved node width will not round-trip.
  const w = node.addDOMWidget("outpaint_ui", "pixaroma_outpaint", root, {
    serialize: false,
    getMinHeight: () => measureFloor(node),
  });
  w.computeLayoutSize = () => ({ minHeight: measureFloor(node), minWidth: 1 });
  applyAdaptiveCanvasOnly(w);

  // Fresh nodes only, and SYNCHRONOUS: configure() runs after onNodeCreated and
  // restores a loaded node's saved size over this. A microtask would run after
  // configure() instead and clobber the user's own size on every workflow open.
  // Index-assign rather than replacing the array, which a reactive proxy may hold.
  if (node.size[0] < MIN_W) node.size[0] = DEFAULT_W;
  if (node.size[1] < DEFAULT_H) node.size[1] = DEFAULT_H;

  // Defer the first paint past configure() so a restored workflow renders its
  // saved state, not the defaults (Vue Compat #8).
  queueMicrotask(() => {
    renderFace(node);
    watchSource(node);
    snapFresh(node);
  });
}

app.registerExtension({
  name: "Pixaroma.Outpaint",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;
    if (nodeType.prototype._pixOpPatched) return; // hot-reload guard
    nodeType.prototype._pixOpPatched = true;

    injectCSS();

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      // This node came from a saved workflow, so its size is already settled:
      // snapFresh must keep its hands off it.
      this._pixOpConfigured = true;
      const r = _origConfigure?.apply(this, arguments);
      // Paint only - renderFace touches no serialized state, and the anchor
      // remap inside it is gated on isGraphLoading().
      if (this._pixOpUI) { renderFace(this); watchSource(this); }
      return r;
    };

    const _origConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, index, connected, link, ioSlot) {
      const r = _origConn?.apply(this, arguments);
      // The wired image decides which triplet the Add space row shows, so repaint
      // on any wire change. Safe to run during the load replay (Vue Compat #19):
      // this only paints, and the remap write is gated on isGraphLoading().
      if (this._pixOpUI) { renderFace(this); watchSource(this); }
      return r;
    };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      // Release every watcher. Each one holds this node (and the observer also
      // pins the built DOM), so a node deleted mid-life would otherwise leak the
      // lot - exactly the leak Save Image shipped with in v1.4.41.
      clearInterval(this._pixOpPoll);
      this._pixOpPoll = null;
      try { this._pixOpRO?.disconnect(); } catch (_e) { /* already gone */ }
      this._pixOpRO = null;
      this._pixOpZoomOff?.();
      this._pixOpZoomOff = null;
      return _origRemoved?.apply(this, arguments);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== CLASS) return;
    setupNode(node);
  },
});

// ── executed: pick up the stashed base frame ───────────────────────────────
// Tier 2 of the preview. The node takes a tensor, so for a generated picture
// (KSampler -> VAE Decode) nothing upstream ever populates imgs[0] and tier 1
// finds nothing. Python writes the run's INPUT frame to temp/ and names it in
// its ui payload; this turns that name into the picture the preview draws.
if (!app._pixOpExecPatched) {
  app._pixOpExecPatched = true;   // hot-reload guard: one listener, not one per load
  api.addEventListener("executed", ({ detail }) => {
    try {
      const entry = detail?.output?.pixaroma_outpaint_base?.[0];
      if (!entry || !entry.filename) return;
      // Vue hands the node id over as a string, legacy as a number.
      const graph = app.graph;
      const node = graph?.getNodeById?.(detail.node) ??
                   graph?.getNodeById?.(parseInt(detail.node, 10));
      if (!node || node.comfyClass !== CLASS) return;
      // Python cannot know whether the browser already has a picture, so it
      // stashes on every run. Decode it only when TIER 1 came up empty: with a
      // Load Image upstream the frame is already on screen, and decoding a
      // full-size PNG each run to throw it away would be pure waste. Rewiring to
      // a generated source simply means the next run supplies it.
      // upstreamImage, NOT sourceImage: the latter counts our own cached base
      // frame, so it would answer "already got one" from the second run onward
      // and freeze the preview on the first generated image.
      if (upstreamImage(node)) return;
      const img = new Image();
      img.onload = () => {
        if (!node.graph) return; // deleted while it loaded
        node._pixOpBaseImg = img;
        // Keep the watcher in step, or it repaints the same picture again 400ms
        // later for nothing.
        node._pixOpSrcSig = sourceSig(node);
        renderFace(node);
      };
      img.src = "/view?filename=" + encodeURIComponent(entry.filename) +
        "&type=" + encodeURIComponent(entry.type || "temp") +
        "&subfolder=" + encodeURIComponent(entry.subfolder || "");
    } catch (e) {
      // A preview is never worth breaking the executed handler for - every other
      // node's listener runs off this same event.
      console.warn("[Outpaint Pixaroma] base preview failed:", (e && e.message) || e);
    }
  });
}

// ── graphToPrompt: inject the per-node state ────────────────────────────────
// INJECT ONLY - never prune here: Export (API) serialises this same output, so a
// prune would strip the exported workflow.
function buildIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    for (const n of graph._nodes || graph.nodes || []) {
      if (!n) continue;
      if (n.comfyClass === CLASS || n.type === CLASS) index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findNode(index, id) {
  const s = String(id);
  if (index.has(s)) return index.get(s);
  const tail = s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : null;
  return tail && index.has(tail) ? index.get(tail) : null;
}

if (!app._pixOpPromptPatched) {
  app._pixOpPromptPatched = true;
  const _origGraphToPrompt = app.graphToPrompt.bind(app);
  app.graphToPrompt = async function (...args) {
    const result = await _origGraphToPrompt(...args);
    try {
      const out = result?.output;
      if (out) {
        let index = null;
        for (const id in out) {
          const entry = out[id];
          if (!entry || entry.class_type !== CLASS) continue;
          if (!index) index = buildIndex();
          const node = findNode(index, id);
          const state = node?.properties?.[STATE_PROP] || JSON.stringify(DEFAULT_STATE);
          entry.inputs = entry.inputs || {};
          entry.inputs[HIDDEN_INPUT] = state;
        }
      }
    } catch (e) {
      console.warn("[Outpaint Pixaroma] could not inject state:", (e && e.message) || e);
    }
    return result;
  };
}
