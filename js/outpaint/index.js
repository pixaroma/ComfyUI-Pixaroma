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

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { pixApiUrl, pixAsset } from "../shared/api_url.mjs";
import { applyAdaptiveCanvasOnly, canvasBackingScale, installZoomRepaint, isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeSettings, globalAccent } from "../shared/node_settings.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import {
  ACCENT_SETTING, BRAND, DEFAULT_STATE, MAX_PAD, STATE_PROP,
  anchorAxis, finalSize, limitsOf, padsForState, ratiosOf, readState, remapAnchor,
  sidePad, writeState,
} from "./core.mjs";
import { openPixaromaColorPickerPopup, PIXAROMA_PALETTE } from "../shared/color_picker.mjs";
import { makeNumericInput, injectResizePanelCSS } from "../shared/resize_panel.mjs";
import { openOutpaintSettings, closeOutpaintSettingsFor } from "./settings.mjs";

// The node's accent: its own saved colour, else the global default, else BRAND.
// Lives here rather than core.mjs because it reads app.ui.settings, and core is
// kept app-free so it stays unit-testable.
function accentOf(node) {
  const st = readState(node);
  if (st.accent) return st.accent;
  try {
    const g = app.ui?.settings?.getSettingValue(ACCENT_SETTING);
    if (g) return g;
  } catch (_e) { /* settings not ready */ }
  return globalAccent() || BRAND;   // then the master Pixaroma default
}

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
// Four rows (148) + a gap + the preview at its minimum, plus the cards strip in
// Nodes 2.0 (where it is a real row rather than paint on the node body). Used
// ONLY while the root is unmounted, so it must track the TALLEST row set: any
// task that adds or removes a row SHOWN IN TO RATIO MODE has to move this
// with it.
//
// The emphasis matters, because 148 encodes the tallest set (To ratio: mode +
// ratio + Add space + limit), NOT the row count. The By side pad row does not
// move it: By side hides the ratio and Add space rows, so it shows three rows
// where To ratio shows four. Do NOT raise this "for consistency" - measured,
// this value is what the load-time fit pass reads (the widget root is not
// mounted yet then, so measureFloor returns this cache), so raising it would
// grow every saved Outpaint node on open, which is the very regression this
// constant exists to avoid.
const CARDS_H = 38;
function floorFallback() {
  return 148 + ROW_GAP + PREVIEW_MIN + (isVueNodes() ? CARDS_H + ROW_GAP : 0);
}
const FLOOR_MIN = 60;
// A runaway guard, not a target (Save Image inflated to ~1830px without one).
// Pitched well above the real floor - even with every row wrapped at a narrow
// width the sum lands near 420 - so it can only ever catch nonsense.
const FLOOR_CAP = 460;

// ── preview ────────────────────────────────────────────────────────────────
const PREVIEW_INSET = 6;   // breathing room around the composition
const BAND_TEXT_MIN = 24;  // below this the band cannot hold text, so it hops out

// The ink for a pad number sitting ON a band. The fill is a USER setting, so a
// fixed colour cannot work: #0a3d0a was tuned for bright green and would be
// nearly invisible on a dark fill. Pick whichever of near-black / near-white
// actually contrasts more, by WCAG relative luminance.
//
// A simple luminance THRESHOLD (the pickInk rule the node titles use, white
// below 150) gets the important case wrong: mid grey #808080 - now the default -
// lands at 128 and would take white, which is the WORSE choice there (3.95:1
// against black's 5.32:1). Measuring the contrast picks black, and keeps working
// for any colour the user chooses.
function relLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return 0.5; // unparseable: treat as mid, so neither ink is claimed
  const n = parseInt(m[1], 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

function bandInk(fill) {
  const L = relLuminance(fill);
  const vsBlack = (L + 0.05) / 0.05;
  const vsWhite = 1.05 / (L + 0.05);
  return vsBlack >= vsWhite ? "#0f0f0f" : "#ffffff";
}

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
    const up = link && graph.getNodeById?.(link.origin_id);
    // A MUTED (mode 2) or BYPASSED (mode 4) upstream is not producing the
    // picture it is still showing: bypass passes its own INPUT straight
    // through, so its preview is of an image that never arrives here. This node
    // puts numbers on its face from that picture (source size, canvas size,
    // which axis grows), so trusting it states a confident wrong size and draws
    // the wrong preview. Returning null falls through to tier 2 (the frame the
    // last run stashed) and then to the already-handled "no picture" state.
    if (up && (up.mode === 2 || up.mode === 4)) return null;
    const img = up?.imgs?.[0];
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
    // renderFace rebuilds every row, which would remove a pad field the user is
    // typing in and discard the half-typed text with it (removing a focused
    // element fires no blur, so it goes silently). Repaint the picture now and
    // leave the signature UNCHANGED so the next tick retries the rebuild once
    // focus has moved on.
    if (focusedPadInput(node)) { requestPreviewRedraw(node); return; }
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

    /* Chevron and gear: fixed, so the mode chips get every spare pixel. The
       14px glyph (larger than the 11px chip text) matches the gear on Sizes
       Pixaroma, so the settings button reads the same across the suite. */
    .pix-op-sq { flex:0 0 auto; width:30px; padding:6px 0; font-size:14px; line-height:1; }
    .pix-op-alabel { flex:0 0 auto; display:flex; align-items:center;
      color:#8a8a8a; padding-right:1px; white-space:nowrap; }

    /* By side pad fields: L / T / R / B, one per edge. The shared
       makeNumericInput is reused for its maths entry and, more importantly,
       its keydown isolation (the canvas grabs arrows and Enter otherwise) -
       but its 13px spinner column is dropped, because four fields plus a
       reset only fit across this node at its minimum width once the arrows
       are gone. min-width keeps all five on one line rather than wrapping. */
    /* min-height matches a chip row (the fields' own content is only ~16px, and
       .pix-op-row stretches, so without this the whole row reads as a thin
       cramped strip against the 28px rows above and below it). */
    .pix-op-pad { flex:1 1 0; min-width:44px; min-height:28px; box-sizing:border-box;
      display:flex; align-items:center; gap:3px;
      background:#1d1d1d; border:1px solid #444; border-radius:5px;
      padding:0 4px 0 6px; }
    .pix-op-pad:focus-within { border-color:var(--pix-op-acc,${BRAND}); }
    .pix-op-pad-l { flex:0 0 auto; font-size:9px; font-weight:700; color:#8a8a8a;
      letter-spacing:.5px; pointer-events:none; }
    /* Strip the shared wrapper's own box so only .pix-op-pad draws one. */
    .pix-op-pad .pix-li-numinput { flex:1 1 auto; min-width:0;
      border:none !important; background:transparent !important;
      border-radius:0 !important; }
    .pix-op-pad .pix-li-spin { display:none !important; }
    /* user-select is none on .pix-op-inner and inherits, which would stop the
       user drag-selecting the number they are about to replace. */
    .pix-op-pad .pix-li-numinput input { padding:0 !important;
      text-align:right !important; color:var(--pix-op-acc,${BRAND});
      user-select:text; }

    /* Reset: all four edges back to 0 in one click. Square like the chevron
       and gear, and it sits with the numbers it clears. */
    /* A real <button>, so padding/font have to be reset to match the chips. */
    .pix-op-reset { flex:0 0 auto; width:26px; min-height:28px; box-sizing:border-box;
      display:flex; align-items:center; justify-content:center;
      background:#1d1d1d; border:1px solid #444; border-radius:5px;
      color:#aaa; cursor:pointer; padding:0; font:inherit;
      transition:border-color .08s, color .08s; }
    .pix-op-reset:hover:not(:disabled) { border-color:var(--pix-op-acc,${BRAND});
      color:var(--pix-op-acc,${BRAND}); }
    .pix-op-reset:focus-visible { border-color:var(--pix-op-acc,${BRAND});
      color:var(--pix-op-acc,${BRAND}); outline:none; }
    /* Nothing to reset: genuinely inert, not merely faded. */
    .pix-op-reset:disabled { opacity:.4; cursor:default; }
    /* A mask, not a text glyph: no font-fallback tofu risk, and it matches the
       Reset on the shared pad panel. */
    .pix-op-reset-ic { width:12px; height:12px; background-color:currentColor;
      -webkit-mask: url("${pixAsset("icons/ui/reset.svg")}") center/12px 12px no-repeat;
              mask: url("${pixAsset("icons/ui/reset.svg")}") center/12px 12px no-repeat; }

    /* The fill-colour swatch. Clickable on the limit row (opens the fill
       picker); a plain readout in the folded summary. */
    .pix-op-swatch { flex:0 0 auto; width:26px; border-radius:5px;
      border:1px solid #444; cursor:default; }
    .pix-op-swatch-btn { cursor:pointer; }
    .pix-op-swatch-btn:hover { border-color:var(--pix-op-acc,${BRAND}); }

    /* Nodes 2.0 only - in legacy the same pixels are painted on the node body,
       so this is display:none there and measureFloor skips it. */
    .pix-op-cards { flex:0 0 auto; width:100%; height:${CARDS_H}px; display:block; }

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

// "Off" for 0, otherwise "N MP" - the MP suffix on every value, not just 1, so a
// custom 1.3 reads as "1.3 MP" rather than a bare "1.3".
function limitLabel(v) {
  return v === 0 ? "Off" : v + " MP";
}

function renderModeRow(node, host) {
  const st = readState(node);
  const folded = !!st.collapsed;

  // ▾ open, ▸ folded. Always live - the one control fold must never hide.
  const chevron = chip(folded ? "▸" : "▾", false,
    folded ? "Expand the settings" : "Collapse to the picture");
  chevron.classList.add("pix-op-sq");
  chevron.onclick = () => toggleFold(node);
  host.appendChild(chevron);

  if (folded) {
    // A summary, not a blank: the folded node still says what it is set to. The
    // chips are read-only here - the way to change them is to expand. Show the
    // active shape (the ratio, or "By side"), the limit, and the fill swatch.
    const shape = st.mode === "ratio" ? st.ratio : "By side";
    const sc = chip(shape, true, "Current: " + (st.mode === "ratio" ? "grow to " + shape : "add by side"));
    sc.style.cursor = "default";
    host.appendChild(sc);
    const lc = chip(limitLabel(st.limit), st.limit !== 0, st.limit === 0
      ? "No megapixel limit" : "Capped at " + st.limit + " MP");
    lc.style.cursor = "default";
    host.appendChild(lc);
    const sw = document.createElement("div");
    sw.className = "pix-op-swatch";
    sw.style.background = st.color;
    sw.title = "Fill colour: " + st.color;
    host.appendChild(sw);
  } else {
    for (const [value, text, tip] of [
      ["ratio", "To ratio", "Grow the image to a target shape"],
      ["sides", "By side", "Add an exact number of pixels per edge"],
    ]) {
      const c = chip(text, st.mode === value, tip);
      c.onclick = () => apply(node, { mode: value });
      host.appendChild(c);
    }
  }

  const gear = chip("⚙", false, "Choose ratios and the accent colour");
  gear.classList.add("pix-op-sq");
  gear.onclick = () => openSettings(node);
  host.appendChild(gear);
}

// Both ways into the settings panel - the gear and the right-click item - come
// through here, so the single-open guard and the live-refresh wiring live in one
// place. onChange repaints the whole face (a ratio change alters the chip row,
// an accent change recolours everything).
function openSettings(node) {
  openOutpaintSettings(node, {
    accentOf,
    onChange: () => { renderFace(node); node.setDirtyCanvas?.(true, true); },
  });
}

function renderRatioRow(node, host) {
  const st = readState(node);

  // By side mode ignores the ratio entirely - both engines branch on the mode
  // and never read it there - so these chips would do nothing at all: click 3:2
  // and the node does not move. Hide them, exactly as the Add space row already
  // hides itself, rather than leaving dead controls on the face. The chosen
  // ratio survives in state, so switching back to To ratio restores it.
  host.style.display = st.mode === "ratio" ? "" : "none";
  if (st.mode !== "ratio") return;

  // The chosen set (settings panel), clamped to the library and 1..6.
  for (const r of ratiosOf(node)) {
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

// ── By side: type the four pad values ──────────────────────────────────────
// Dragging a green edge was the only way to set these. The numbers themselves
// already exist in state - the drag writes exactly these four keys - so typing
// one adds no saved data, needs no Python change, and an existing workflow
// round-trips unchanged.
//
// Left-to-right in the order the eye reads a frame: L T R B.
const PAD_SIDES = [["left", "L", "Left"], ["top", "T", "Top"],
                   ["right", "R", "Right"], ["bottom", "B", "Bottom"]];

// Shown ONLY in By side mode. padsForState ignores all four values in ratio
// mode (core.mjs), so a field there would be a control that visibly does
// nothing - the same reason the ratio and Add space rows hide themselves in
// the other direction. Resetting in ratio mode is already one click on a
// ratio chip, so the reset hides with them.
function renderPadRow(node, host) {
  const st = readState(node);
  host.style.display = st.mode === "sides" ? "" : "none";
  if (st.mode !== "sides") return;

  const inputs = {};
  for (const [key, letter, name] of PAD_SIDES) {
    const cell = document.createElement("div");
    cell.className = "pix-op-pad";
    const tip = name + " edge: pixels of fill to add. Maths works, e.g. 512*2.";
    cell.title = tip;
    const lab = document.createElement("span");
    lab.className = "pix-op-pad-l";
    lab.textContent = letter;
    cell.appendChild(lab);

    // The opts object is HELD, not thrown away: makeNumericInput mutates this
    // very object and reads opts.value as its fallback whenever the typed text
    // does not parse (and as the base for an arrow step from an empty field).
    // syncPadInputs must therefore refresh opts.value as well as the visible
    // text - writing only el.value would strand the fallback at the number this
    // row was BUILT with, so clearing a field after a drag would revert to a
    // pre-drag value instead of the one on screen.
    //
    // sidePad is the SAME clamp Python applies while parsing state, so a typed
    // value can never preview a pad the run would discard.
    const opts = {
      value: sidePad(st[key]),
      min: 0, max: MAX_PAD, step: 1,
      format: (v) => String(Math.round(v)),
      onCommit: (v) => commitPad(node, key, v),
    };
    const built = makeNumericInput(opts);
    // makeNumericInput sets its own generic maths title on the input, which
    // covers nearly the whole cell - so without this the tooltip never says
    // WHICH edge the box is (the letter has pointer-events:none and falls
    // through to the cell, but the number the user aims at does not).
    built.input.title = tip;
    cell.appendChild(built.wrap);
    inputs[key] = { el: built.input, opts };
    // A press on the field must not reach the LiteGraph canvas underneath, or
    // the node drags out from under the cursor as the user clicks into the box.
    // Same guard installDrag puts on the preview.
    cell.addEventListener("pointerdown", (e) => e.stopPropagation());
    host.appendChild(cell);
  }
  node._pixOpPadInputs = inputs;

  // A real <button>, not a styled div: it gets an accessible name, a focus ring
  // and Enter/Space for free, and `disabled` makes "nothing to reset" genuinely
  // inert rather than merely faded. Matches the shared pad panel's own Reset.
  const rst = document.createElement("button");
  rst.type = "button";
  rst.className = "pix-op-reset";
  rst.setAttribute("aria-label", "Reset all four edges to 0");
  const ic = document.createElement("span");
  ic.className = "pix-op-reset-ic";
  rst.appendChild(ic);
  rst.onclick = () => resetPads(node);
  host.appendChild(rst);
  refreshResetState(node); // sets disabled + title from the live state
}

// The pad input that currently has focus, or null. Used to avoid two distinct
// ways of silently eating a half-typed value.
function focusedPadInput(node) {
  const inputs = node._pixOpPadInputs;
  if (!inputs) return null;
  for (const [key] of PAD_SIDES) {
    const f = inputs[key];
    if (f && f.el === document.activeElement) return f.el;
  }
  return null;
}

// A typed value deliberately does NOT commit through apply(): that calls
// renderFace, which rebuilds every row - destroying the very input the user is
// typing in and taking the caret with it. Follow the drag's path instead: write
// the state, repaint the picture and the size cards, leave the rows alone.
function commitPad(node, key, value) {
  const v = sidePad(value);
  if (sidePad(readState(node)[key]) === v) return; // nothing actually moved
  writeState(node, { [key]: v });
  requestPreviewRedraw(node);         // repaints the picture AND the size cards
  node.setDirtyCanvas?.(true, true);  // legacy: cards are painted on the body
  refreshResetState(node);            // 0 -> non-zero re-arms the reset button
}

// One click back to no padding at all. A one-shot action, so the full renderFace
// is fine here - and it is what refills the four fields with 0 and dims the
// button again.
function resetPads(node) {
  const st = readState(node);
  if (!st.left && !st.top && !st.right && !st.bottom) return;
  apply(node, { left: 0, top: 0, right: 0, bottom: 0 });
}

// Enable/dim the reset without rebuilding the row (which would eject the caret
// mid-typing). Cheap enough to call on every commit and every drag frame.
function refreshResetState(node) {
  const ui = node._pixOpUI;
  const btn = ui && ui.inner.querySelector(".pix-op-reset");
  if (!btn) return;
  const st = readState(node);
  const empty = !st.left && !st.top && !st.right && !st.bottom;
  btn.disabled = empty;
  btn.title = empty ? "Nothing to reset - all four edges are already 0"
                    : "Reset all four edges to 0";
}

// The edge-drag writes state WITHOUT rebuilding the rows (it must not, at
// 120Hz), so the boxes would sit on stale numbers for the whole gesture. Push
// the live values straight into the inputs instead.
function syncPadInputs(node) {
  const inputs = node._pixOpPadInputs;
  if (!inputs) return;
  const st = readState(node);
  for (const [key] of PAD_SIDES) {
    const f = inputs[key];
    // Never fight a field the user is actively typing in.
    if (!f || !f.el.isConnected || f.el === document.activeElement) continue;
    const v = sidePad(st[key]);
    // BOTH, always: the visible text and the field's own non-parsing fallback.
    // See the comment where opts is built - updating only the text leaves a
    // stale fallback that can undo a drag.
    f.opts.value = v;
    const text = String(v);
    if (f.el.value !== text) f.el.value = text;
  }
  refreshResetState(node);
}

function renderLimitRow(node, host) {
  const st = readState(node);
  // The user's own set of MP buttons (managed in the settings panel), else the
  // default. Number(st.limit) so a value stored as a string still matches.
  const active = Number(st.limit);
  for (const v of limitsOf(node)) {
    const c = chip(limitLabel(v), v === active, v === 0
      ? "Keep the padded size"
      : "Scale the padded image to " + v + " megapixels");
    c.onclick = () => apply(node, { limit: v });
    host.appendChild(c);
  }
  // The fill colour, and the one control that changes it. This is the colour the
  // outpaint model repaints, NOT the accent - a picker here is deliberately
  // separate from the settings panel's Button colour, and uses the full palette
  // (neutrals AND vibrants) because a LoRA might want pure green, white or black.
  const sw = document.createElement("div");
  sw.className = "pix-op-swatch pix-op-swatch-btn";
  sw.style.background = st.color;
  sw.title = "Fill colour (click to change): " + st.color;
  sw.onclick = () => openFillPicker(node, sw);
  host.appendChild(sw);
}

// The node-face fill picker. Separate handle from the settings panel's accent
// picker so neither closing the other; both are closed on node removal. Reset
// goes to the neutral-grey default, since that is the safe no-tint fill.
function openFillPicker(node, anchor) {
  try { node._pixOpFillPicker?.close(); } catch (_e) { /* already gone */ }
  node._pixOpFillPicker = openPixaromaColorPickerPopup(anchor, {
    initialColor: readState(node).color,
    swatches: PIXAROMA_PALETTE,
    wide: true,
    resetColor: DEFAULT_STATE.color, // #808080
    onPick: (c) => {
      writeState(node, { color: c || DEFAULT_STATE.color });
      renderFace(node); // recolours the swatch AND the preview bands + ink
      node.setDirtyCanvas?.(true, true);
    },
  });
}

// ── preview drawing ────────────────────────────────────────────────────────
// Where the composition sits inside the preview box. A PURE function of the box,
// the source and the pads, so the paint and the hit-test cannot drift apart -
// the Compare lesson: never hit-test against geometry stashed during the last
// paint, because a tap with no preceding move would read a stale one.
function previewGeom(cssW, cssH, src, pads) {
  const padW = src.w + pads.left + pads.right;
  const padH = src.h + pads.top + pads.bottom;
  // Fit the PADDED rect, not the image: the preview is the composition, so the
  // green belongs inside the frame at the same proportions as the real output.
  const scale = Math.min((cssW - PREVIEW_INSET * 2) / padW, (cssH - PREVIEW_INSET * 2) / padH);
  const dw = padW * scale;
  const dh = padH * scale;
  return { scale, dw, dh, ox: (cssW - dw) / 2, oy: (cssH - dh) / 2 };
}

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
  // Neutral, not tinted: this sits on the PHOTO behind its own dark pill, so it
  // has nothing to do with the fill colour and must not carry its hue.
  ctx.fillStyle = "#f0f0f0";
  fillTextVCenter(ctx, text, cx, cyMid);
}

// One pad number. A band thick enough to hold text gets it ON the green in
// near-black; a thin one cannot, so the number hops just inside the image on a
// pill - which is what keeps a 32px pad readable instead of clipped to a smear.
function bandNumber(ctx, px, thick, onCx, onCy, offCx, offCy, ink) {
  if (px <= 0) return;
  const text = String(px);
  if (thick >= BAND_TEXT_MIN) {
    ctx.fillStyle = ink;
    fillTextVCenter(ctx, text, onCx, onCy);
  } else {
    pill(ctx, text, offCx, offCy);
  }
}

function drawBandNumbers(ctx, pads, scale, ox, oy, dw, dh, ink) {
  ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  const midX = ox + dw / 2;
  const midY = oy + dh / 2;
  const t = pads.top * scale, b = pads.bottom * scale;
  const l = pads.left * scale, r = pads.right * scale;

  bandNumber(ctx, pads.top, t, midX, oy + t / 2,
    midX, oy + t + PILL_GAP + PILL_H / 2, ink);
  bandNumber(ctx, pads.bottom, b, midX, oy + dh - b / 2,
    midX, oy + dh - b - PILL_GAP - PILL_H / 2, ink);
  bandNumber(ctx, pads.left, l, ox + l / 2, midY,
    ox + l + PILL_GAP + pillW(ctx, String(pads.left)) / 2, midY, ink);
  bandNumber(ctx, pads.right, r, ox + dw - r / 2, midY,
    ox + dw - r - PILL_GAP - pillW(ctx, String(pads.right)) / 2, midY, ink);
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
  const { scale, dw, dh, ox, oy } = previewGeom(cssW, cssH, src, pads);

  // Green underneath, image over it: the four bands are simply the green the
  // image does not cover, so they cannot drift out of step with the maths.
  ctx.fillStyle = st.color;
  ctx.fillRect(ox, oy, dw, dh);
  ctx.drawImage(img, ox + pads.left * scale, oy + pads.top * scale,
    src.w * scale, src.h * scale);

  ctx.strokeStyle = "rgba(255,255,255,.14)";
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 0.5, oy + 0.5, Math.max(0, dw - 1), Math.max(0, dh - 1));

  drawBandNumbers(ctx, pads, scale, ox, oy, dw, dh, bandInk(st.color));
  drawSizeBadge(ctx, cssW, cssH, finalSize(src.w, src.h, pads, st.limit, st.snap));
}

// ── size cards ─────────────────────────────────────────────────────────────
// INPUT 1024 x 1024  ›  OUTPUT 1254 x 836, in the slot strip's dead space.
//
// ONE painter, two callers - the node's one deliberate renderer split, copied
// from Load Image rather than invented. Legacy paints it straight onto the node
// body beside the width/height rows; Nodes 2.0 renders that strip itself and
// skips body painting entirely, so the same pixels go on a small canvas at the
// top of our own panel. They are non-interactive pixels, which is the only
// reason they can live there at all - anything clickable would need a canvas
// hit-test in legacy plus a DOM button in Vue, two implementations of one thing.
const CARD_GAP = 16;          // room for the chevron between the two cards
const CARDS_LEFT = 12;
// Rows 2-3 of the strip: row centres are TOP_PAD + i*SLOT_H + SLOT_H/2, so with
// TOP_PAD 4 and SLOT_H 20 that is 14 / 34 / 54, and the pair centres at 44. Row
// 1 is left alone because the "image" INPUT label lives there.
const CARDS_MID_Y = 44;
// The output labels are right-aligned, so the space they need has to be measured
// from the RIGHT edge or the cards would collide with them the moment the user
// narrows the node. "height" is the longest at ~38px, plus its dot and a gap.
const CARDS_RIGHT_RESERVE = 74;

function cardsInfo(node) {
  const img = sourceImage(node);
  if (!img) return { mode: "msg", text: hasWire(node) ? "Run once for sizes" : "Connect an image" };
  const st = readState(node);
  const src = { w: img.naturalWidth, h: img.naturalHeight };
  const pads = padsForState(st, src.w, src.h);
  const fin = finalSize(src.w, src.h, pads, st.limit, st.snap);
  return { mode: "dual", inW: src.w, inH: src.h, outW: fin.w, outH: fin.h,
    changed: fin.w !== src.w || fin.h !== src.h };
}

// Paints into ctx within [leftPad .. leftPad+pairW], centred on midY. All
// coordinates are in the ctx's own CSS-pixel space, so the caller decides where
// "here" is and this stays renderer-agnostic.
function paintCardsInto(ctx, node, leftPad, midY, pairW) {
  const info = cardsInfo(node);
  const acc = accentOf(node); // the OUTPUT card follows the node's accent
  const fam = "ui-sans-serif, system-ui, sans-serif";
  ctx.save();
  ctx.textBaseline = "middle";

  if (info.mode === "msg") {
    ctx.font = "11px " + fam;
    ctx.textAlign = "left";
    ctx.fillStyle = "#6a6a6a";
    ctx.fillText(info.text, leftPad, midY, pairW);
    ctx.restore();
    return;
  }

  const cardW = (pairW - CARD_GAP) / 2;
  const y = midY - CARDS_H / 2;
  const card = (x, label, w, h, accent) => {
    roundRect(ctx, x + 0.5, y + 0.5, cardW - 1, CARDS_H - 1, 5);
    ctx.fillStyle = "#1d1d1d"; ctx.fill();
    ctx.strokeStyle = accent ? acc : "#444"; ctx.lineWidth = 1; ctx.stroke();
    const cx = x + cardW / 2;
    ctx.textAlign = "center";
    ctx.font = "9px " + fam;
    ctx.fillStyle = "#8a8a8a";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, y + 12, cardW - 8);
    ctx.font = "bold 11px " + fam;
    ctx.fillStyle = accent ? acc : "#ccc";
    // Digits again, so centre on the real glyph box (see fillTextVCenter).
    fillTextVCenter(ctx, w + " × " + h, cx, y + 26);
  };
  // Only the OUTPUT card goes accent, and only when the size ACTUALLY changes -
  // an accent that is always on says nothing.
  card(leftPad, "INPUT", info.inW, info.inH, false);
  card(leftPad + cardW + CARD_GAP, "OUTPUT", info.outW, info.outH, info.changed);

  const ax = leftPad + cardW + CARD_GAP / 2;
  ctx.strokeStyle = info.changed ? acc : "#6a6a6a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(ax - 2.5, midY - 4);
  ctx.lineTo(ax + 2.5, midY);
  ctx.lineTo(ax - 2.5, midY + 4);
  ctx.stroke();
  ctx.restore();
}

// The Nodes 2.0 caller: our own canvas, since there is no dead space to paint in.
function renderCardsCanvas(node) {
  const ui = node._pixOpUI;
  if (!ui || !ui.cards || ui.cards.style.display === "none") return;
  const cssW = ui.cards.clientWidth, cssH = ui.cards.clientHeight;
  if (cssW <= 0 || cssH <= 0) return;
  const s = canvasBackingScale(cssW, cssH);
  const bw = Math.max(1, Math.round(cssW * s)), bh = Math.max(1, Math.round(cssH * s));
  if (ui.cards.width !== bw || ui.cards.height !== bh) { ui.cards.width = bw; ui.cards.height = bh; }
  const ctx = ui.cards.getContext("2d");
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  paintCardsInto(ctx, node, 0, cssH / 2, cssW);
}

// A full canvas redraw per pointermove would be a synchronous repaint at
// whatever rate the mouse reports (120Hz+ on plenty of hardware). Coalesce to
// one per frame - the same lesson the Inpaint brush paid for.
function requestPreviewRedraw(node) {
  if (node._pixOpRaf) return;
  node._pixOpRaf = requestAnimationFrame(() => {
    node._pixOpRaf = null;
    renderPreview(node);
    // The size cards read padsForState too, so they must ride the same frame or
    // they state the pre-drag numbers while the picture shows the new ones. In
    // legacy they are painted on the node body and setDirtyCanvas covers them;
    // in Nodes 2.0 they are our own canvas and nothing else would repaint them.
    renderCardsCanvas(node);
  });
}

// ── drag the green edges ───────────────────────────────────────────────────
const HANDLE_HIT = 7;      // how close to an edge counts as grabbing it
const CURSORS = { left: "ew-resize", right: "ew-resize", top: "ns-resize", bottom: "ns-resize" };

// Which edge is under the pointer, or null. All four are grabbable, including
// ones with no green on them yet: dragging an edge outward is HOW you add space.
function hitEdge(lx, ly, g) {
  const { ox, oy, dw, dh } = g;
  const nearY = ly >= oy - HANDLE_HIT && ly <= oy + dh + HANDLE_HIT;
  const nearX = lx >= ox - HANDLE_HIT && lx <= ox + dw + HANDLE_HIT;
  // Left/right win the corners, arbitrarily but consistently.
  if (nearY && Math.abs(lx - ox) <= HANDLE_HIT) return "left";
  if (nearY && Math.abs(lx - (ox + dw)) <= HANDLE_HIT) return "right";
  if (nearX && Math.abs(ly - oy) <= HANDLE_HIT) return "top";
  if (nearX && Math.abs(ly - (oy + dh)) <= HANDLE_HIT) return "bottom";
  return null;
}

// getBoundingClientRect reports SCREEN px while the preview draws in LAYOUT px,
// and the node body is CSS-transform-scaled by the graph zoom - so without this
// the grab drifts further from the cursor the more the user has zoomed in. Same
// correction as Compare's localPos.
function localPos(el, e) {
  const r = el.getBoundingClientRect();
  const sx = r.width ? el.clientWidth / r.width : 1;
  const sy = r.height ? el.clientHeight / r.height : 1;
  return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy];
}

// Everything the pointer needs to know about the current composition, or null
// when there is nothing drawn to grab.
function previewState(node) {
  const ui = node._pixOpUI;
  const img = ui && sourceImage(node);
  if (!img) return null;
  const cssW = ui.prev.clientWidth, cssH = ui.prev.clientHeight;
  if (cssW <= 0 || cssH <= 0) return null;
  const st = readState(node);
  const src = { w: img.naturalWidth, h: img.naturalHeight };
  const pads = padsForState(st, src.w, src.h);
  return { st, src, pads, g: previewGeom(cssW, cssH, src, pads) };
}

function installDrag(node) {
  const prev = node._pixOpUI.prev;

  prev.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // Commit and release any pad box still holding focus, BEFORE the geometry
    // is read. Two things conspire otherwise: syncPadInputs deliberately skips
    // the focused field, and the preventDefault below stops the browser moving
    // focus off it - so that box would show its pre-drag number for the whole
    // gesture and then commit that stale text on its eventual blur, silently
    // undoing the drag. Blurring first also means d.pads starts from the number
    // the user actually typed.
    focusedPadInput(node)?.blur();
    const ps = previewState(node);
    if (!ps) return;
    const [lx, ly] = localPos(prev, e);
    const side = hitEdge(lx, ly, ps.g);
    if (!side) return;
    // Without this the canvas underneath takes the press and the whole node
    // drags away from under the cursor.
    e.stopPropagation();
    e.preventDefault();
    try { prev.setPointerCapture(e.pointerId); } catch (_e) { /* fine without it */ }
    node._pixOpDrag = {
      side, x: lx, y: ly, pads: { ...ps.pads },
      // The scale at GRAB time, held for the whole gesture. The composition
      // rescales to keep fitting as the pad grows, so reading a live scale would
      // make the same cursor movement worth a different number of pixels from
      // one frame to the next - the drag would feel like it was slipping.
      scale: ps.g.scale,
      needsFlip: ps.st.mode === "ratio",
    };
  });

  prev.addEventListener("pointermove", (e) => {
    const d = node._pixOpDrag;
    if (!d) {
      // Idle: just advertise which edges do something.
      const ps = previewState(node);
      const side = ps ? hitEdge(...localPos(prev, e), ps.g) : null;
      prev.style.cursor = side ? CURSORS[side] : "";
      return;
    }
    const [lx, ly] = localPos(prev, e);
    // Cursor delta -> SOURCE pixels. Outward on this edge means more green;
    // pulling out grows the canvas and shrinks the image inside the preview,
    // which reads as zooming out - exactly what is being asked of the model.
    const dx = (lx - d.x) / d.scale, dy = (ly - d.y) / d.scale;
    const grow = d.side === "right" ? dx : d.side === "left" ? -dx
      : d.side === "bottom" ? dy : -dy;
    const patch = {};
    if (d.needsFlip) {
      // The first movement of a ratio-mode drag switches to By side, carrying
      // over the numbers the ratio had computed. Without carrying them the other
      // three sides would snap to nothing the instant the user touched an edge.
      d.needsFlip = false;
      Object.assign(patch, d.pads, { mode: "sides" });
    }
    patch[d.side] = Math.max(0, Math.min(Math.round(d.pads[d.side] + grow), MAX_PAD));
    writeState(node, patch);
    // The mode chips and the Add space row only change on the flip; every other
    // move is the picture alone, so do not rebuild the rows 120 times a second.
    // The pad boxes still have to keep up, so they are written directly.
    if (patch.mode) renderFace(node);
    else { syncPadInputs(node); requestPreviewRedraw(node); }
  });

  const end = (e) => {
    if (!node._pixOpDrag) return;
    node._pixOpDrag = null;
    try { prev.releasePointerCapture(e.pointerId); } catch (_e) { /* already released */ }
    node.setDirtyCanvas?.(true, true);
  };
  prev.addEventListener("pointerup", end);
  prev.addEventListener("pointercancel", end);
  prev.addEventListener("pointerleave", () => {
    if (!node._pixOpDrag) prev.style.cursor = "";
  });
}

function renderFace(node) {
  const ui = node._pixOpUI;
  if (!ui) return;
  const inner = ui.inner;
  inner.style.setProperty("--pix-op-acc", accentOf(node)); // per-node, from settings
  // Rebuild the ROWS only. The cards and preview elements are persistent: they
  // own canvases (and the preview a ResizeObserver and the drag listeners), so
  // recreating them on every chip click would leak an observer per click and
  // throw away a good backing store for nothing.
  for (const el of [...inner.children]) {
    if (el !== ui.prev && el !== ui.cards) el.remove();
  }
  // The pad fields live on a row that was just removed, so the cached
  // references are dead until renderPadRow hands over fresh ones. Clearing
  // here (not in renderPadRow) also covers the folded path, which never calls
  // it at all - syncPadInputs would otherwise write into detached inputs.
  node._pixOpPadInputs = null;
  renderModeRow(node, row(inner));
  // Folded drops the three control rows and keeps the mode summary + cards +
  // preview. The mode row above already rendered its summary form; skipping the
  // rest is the whole of the collapse. renderFace reads collapsed on every path
  // including onConfigure, so the fold shows on load with no extra step.
  if (!readState(node).collapsed) {
    renderRatioRow(node, row(inner));
    renderAnchorRow(node, row(inner));
    // By side only. It costs no height overall: this mode hides the two rows
    // above, so it shows three rows where To ratio shows four.
    renderPadRow(node, row(inner));
    renderLimitRow(node, row(inner));
  }
  // Re-assert the order: cards on top, preview last. Both calls MOVE the
  // existing child rather than adding a second one.
  inner.insertBefore(ui.cards, inner.firstChild);
  inner.appendChild(ui.prev);
  renderPreview(node);
  renderCardsCanvas(node);
}

// ── fold ───────────────────────────────────────────────────────────────────
// A user action only. Folding remembers the open height so expanding restores
// the same big preview rather than snapping to the bare floor; expanding reads
// it back. Both writes are user-driven, so they never dirty a load (Vue Compat
// #18). renderFace does the visual half; this does the height half.
function toggleFold(node) {
  const st = readState(node);
  const collapsed = !st.collapsed;
  writeState(node, collapsed
    ? { collapsed: true, openH: node.size[1] } // stash before we shrink
    : { collapsed: false });
  renderFace(node);
  fitFoldHeight(node);
  node.setDirtyCanvas?.(true, true);
}

// Resize to match the fold state. NEVER on the load path (the saved height
// already fits the saved fold state; writing size there reopens the workflow
// "modified"), and never while LiteGraph title-collapsed (every child reads
// invisible, so a measure returns just the chrome). setSize whole-array in both:
// writing node.size[1] bypasses the Vue layout store, which only bridges the
// size SETTER.
function fitFoldHeight(node) {
  if (isGraphLoading() || node.flags?.collapsed) return;
  const st = readState(node);
  const w = node.size[0];

  // Expanding: go straight back to the height the node had before it folded, so
  // the preview returns to its old big size rather than the bare floor.
  if (!st.collapsed) {
    node.setSize?.([w, st.openH || DEFAULT_H]);
    node.setDirtyCanvas?.(true, true);
    return;
  }

  // Folding: shrink to the content floor. A frame later so the hidden rows are
  // actually gone, then adjust node.size by the deficit between the floor
  // (measureFloor counts the preview at its MINIMUM, not the flex-grown height it
  // shows for that one frame) and the current root height. This is snapFresh's
  // deficit maths run bidirectionally, so it is renderer-agnostic - it reads the
  // real root in whichever renderer instead of trusting computeSize (legacy
  // chrome only) or a --node-height:0 probe (which collapses the preview to 0
  // and would fold too short).
  requestAnimationFrame(() => {
    if (!node.graph) return;
    const ui = node._pixOpUI;
    if (!ui || !ui.root.isConnected || ui.root.clientWidth === 0) return;
    const deficit = measureFloor(node) - ui.root.clientHeight;
    node.setSize?.([w, Math.round(node.size[1] + deficit)]);
    node.setDirtyCanvas?.(true, true);
  });
}

// ── height ─────────────────────────────────────────────────────────────────
// Sum the laid-out rows. REFUSE to measure an unmounted or zero-width root: the
// rows would wrap against no width and the sum would explode, inflating the node
// permanently. The 4px rounding stops font jitter creeping it taller on every
// workflow open (Vue Compat #18).
function measureFloor(node) {
  const ui = node._pixOpUI;
  if (!ui || !ui.root.isConnected || ui.root.clientWidth === 0) {
    return ui?._floorCache ?? floorFallback();
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
  if (!shown) return ui._floorCache ?? floorFallback();
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
  // steps around them rather than rebuilding them.
  //
  // Nodes 2.0 only: legacy paints the same cards onto the node body, where the
  // slot strip has real dead space. Hidden rather than absent so measureFloor
  // simply skips it (it skips display:none children).
  const cards = document.createElement("canvas");
  cards.className = "pix-op-cards";
  cards.style.display = isVueNodes() ? "block" : "none";
  inner.appendChild(cards);

  const prev = document.createElement("div");
  prev.className = "pix-op-prev";
  const canvas = document.createElement("canvas");
  prev.appendChild(canvas);
  inner.appendChild(prev);

  node._pixOpUI = { root, inner, cards, prev, canvas, _floorCache: floorFallback() };

  const repaintCanvases = () => { renderPreview(node); renderCardsCanvas(node); };

  // node.onResize does not fire reliably for a DOM widget (Vue Compat #13), so
  // the element is watched directly: this catches a node resize, a renderer
  // reflow and a tab switch alike, whatever caused them.
  node._pixOpRO = new ResizeObserver(repaintCanvases);
  node._pixOpRO.observe(prev);

  // A graph zoom changes no layout box, so the observer above never sees it -
  // but it does change the backing scale, so without this the pixels stay at the
  // resolution they were first drawn at and go soft when zoomed in.
  node._pixOpZoomOff = installZoomRepaint(
    node, () => [prev.clientWidth, prev.clientHeight], repaintCanvases, "_pixOpZoomRaf");

  // The listeners live on the persistent preview element, so this is wired once
  // for the node's whole life - renderFace deliberately steps around it.
  installDrag(node);

  // No custom computeSize and no getMaxHeight: either makes the widget
  // fixed-height in legacy, so the node grows but can never shrink. minWidth 1
  // or the saved node width will not round-trip.
  const w = node.addDOMWidget("outpaint_ui", "pixaroma_outpaint", root, {
    serialize: false,
    getMinHeight: () => measureFloor(node),
  });
  w.computeLayoutSize = () => ({ minHeight: measureFloor(node), minWidth: 1 });
  applyAdaptiveCanvasOnly(w);
  // Wheel over the preview must still zoom the canvas (Classic; no-ops in Nodes
  // 2.0). Independent of the green-edge drag, which is pointer-driven.
  installCanvasZoomPassthrough(root);

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

  // No Settings-panel row: this node's colour lives in its OWN panel (the gear /
  // right-click entry). It used to be registered here with defaultValue BRAND,
  // which made getSettingValue ALWAYS return the orange - so the node-type
  // default permanently outranked the master accent and "Every Pixaroma node"
  // could never reach this node. Unregistered, the key is written ONLY by an
  // explicit "New Outpaint nodes" press, so stored == deliberately chosen.

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;
    if (nodeType.prototype._pixOpPatched) return; // hot-reload guard
    nodeType.prototype._pixOpPatched = true;

    injectCSS();
    injectResizePanelCSS(); // the .pix-li-* base for the shared numeric fields

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

    // LEGACY only: paint the size cards into the slot strip's dead space. Vue
    // renders that strip itself and skips node-body painting entirely (so this
    // would simply never show there) - the .pix-op-cards canvas carries the same
    // pixels instead.
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const r = _origDraw?.apply(this, arguments);
      if (isVueNodes() || this.flags?.collapsed) return r;
      const pairW = this.size[0] - CARDS_LEFT - CARDS_RIGHT_RESERVE;
      // Too narrow to say anything useful: better blank than two clipped smears
      // overlapping the output labels.
      if (pairW >= 120) paintCardsInto(ctx, this, CARDS_LEFT, CARDS_MID_Y, pairW);
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
      if (this._pixOpRaf) cancelAnimationFrame(this._pixOpRaf);
      this._pixOpRaf = null;
      this._pixOpDrag = null;
      this._pixOpPadInputs = null;
      // Close THIS node's settings panel and fill picker if either was open, or
      // their window listeners would outlive the node.
      closeOutpaintSettingsFor(this);
      try { this._pixOpFillPicker?.close(); } catch (_e) { /* already gone */ }
      this._pixOpFillPicker = null;
      return _origRemoved?.apply(this, arguments);
    };
  },

  // Right-click -> a second way into the same panel. The new context-menu API
  // (Vue Compat #20), NOT the deprecated getNodeMenuOptions monkey-patch.
  getNodeMenuItems(node) {
    if (node?.comfyClass !== CLASS) return [];
    const st = readState(node);
    const folded = !!st.collapsed;
    // A second way to the reset, for when the node is folded or the user is
    // already in the menu. Disabled rather than hidden in ratio mode, where the
    // pads are derived and a ratio chip is the way back.
    const padded = !!(st.left || st.top || st.right || st.bottom);
    return [
      null,
      { content: folded ? "▸ Expand" : "▾ Collapse", callback: () => toggleFold(node) },
      {
        content: "↺ Reset padding",
        disabled: st.mode !== "sides" || !padded,
        callback: () => resetPads(node),
      },
      { content: "⚙ Outpaint settings", callback: () => openSettings(node) },
    ];
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
      img.src = pixApiUrl("/view?filename=" + encodeURIComponent(entry.filename) +
        "&type=" + encodeURIComponent(entry.type || "temp") +
        "&subfolder=" + encodeURIComponent(entry.subfolder || ""));
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
  const _origGraphToPrompt_fn = app.graphToPrompt;
  const _origGraphToPrompt = (...a) => _origGraphToPrompt_fn.apply(app, a);
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

// The gear in the node selection toolbar opens the same panel the right-click
// entry does. ownMenuItem: this node already adds its own menu line.
registerNodeSettings(CLASS, {
  title: "Outpaint",
  // paints from its OWN --acc var - run its own render (see Control Panel)
  onChange: (node) => { renderFace(node); node.setDirtyCanvas?.(true, true); },
  ownMenuItem: true,
  open: (node) => openSettings(node),
});
