// Number Pick Pixaroma - the node face.
//
// One DOM widget, so a single implementation serves both renderers, and one row
// inside it: the buttons plus the gear. Deliberately no readout and no typed
// box - the chosen chip IS the readout, and the whole point of the node is that
// it is the smallest thing that can hold a number you change often.

import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/nodes2.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { installNodeAccent, ACC } from "../shared/node_settings.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { pixAsset } from "../shared/api_url.mjs";
import { ROW_H, BODY_PAD, readState, writeState, fmt } from "./core.mjs";

const ROOT_CLASS = "pix-npick-root";
const WIDGET_NAME = "number_pick_ui";
// Namespaced so a future frontend cannot claim the type name and render its own
// widget instead of our element (the Show Text bug, Nodes 2.0 notes).
const WIDGET_TYPE = "pixaroma_number_pick";

let _cssDone = false;

// Classic stacks one 20px slot row per output ABOVE the widgets. This node has
// ONE output, so that band is 20px of dead space with a right-aligned "value"
// label in it; we lift the widget over the band and lay the buttons into its
// empty left half, which is what makes the node one row tall.
export const SLOT_BAND = 20;
// Room for the right-aligned "value" label plus its dot. MEASURED the way
// duration.md #14 says to, not guessed: at LiteGraph's 14px node font "value"
// is 33px wide and LiteGraph right-aligns it 18px in from the node edge, so the
// label occupies `size[0]-51 .. size[0]-18`. Our content ends at
// `size[0] - (ROOT_MARGIN + BODY_PAD + LABEL_RESERVE)`, so 44 leaves a ~9px gap.
//
// It was 54 first, which put a 19px gap there and read as the gear being
// stranded in the middle of the row ("the settings can be closer to the value").
// Re-measure with ctx.measureText at LiteGraph.NODE_TEXT_SIZE if the output is
// ever renamed.
export const LABEL_RESERVE = 44;
// Classic insets the DOM widget by this much on each side of the node.
const ROOT_MARGIN = 10;
const GEAR_W = 16;
const ROW_GAP = 5;
const CHIP_GAP = 4;
// Nodes 2.0: the "value" slot ELEMENT is 50px wide and sits hard against the
// node's right edge (measured), while a widget row spans nearly the full node
// width - so the row has to reserve that much itself or the gear slides under
// the label once the body is lifted onto the slot band.
const VUE_LABEL_RESERVE = 44;
// How far the button row has to rise to CENTRE on the output-slot band.
//
// The SAME 13px in both renderers, because it is the same 26px row against the
// same 20px band, and both were measured independently: in Classic the dot sits
// at node-local y14 (TOP_PAD 4 + 20/2, Vue Compat #16) while the row centred at
// y27; in Nodes 2.0 the band is 20px at y426 and the row centre sat 33px below
// its centre, which is this 13 plus the block's own 20.
//
// Classic applies it as a negative margin-top on the row (so the body CLOSES UP
// and the node gets shorter by the same amount); Nodes 2.0 folds it into the
// block-nudge's negative margin-bottom. Re-measure if ROW_H or the widget
// wrapper's padding changes.
const NUDGE_EXTRA_LIFT = 13;

// Intrinsic width of one chip, measured at the REAL font rather than guessed
// from character count - "1" is 20px and "0.25" is 36px, and a node sized on an
// average would clip the long ones. Cached per label; the set of labels on a
// canvas is tiny.
const _chipW = new Map();
let _probe = null;
function chipWidth(label) {
  if (_chipW.has(label)) return _chipW.get(label);
  if (!_probe) {
    _probe = document.createElement("span");
    _probe.style.cssText =
      "position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:nowrap;"
      + "font:12px 'Segoe UI',sans-serif;padding:4px 6px;border:1px solid;box-sizing:border-box;";
    document.body.appendChild(_probe);
  }
  _probe.textContent = label;
  const w = Math.ceil(_probe.getBoundingClientRect().width) || 26;
  _chipW.set(label, w);
  return w;
}

/**
 * The narrowest this node can be and still show every button in full.
 *
 * This is what stops the row clipping: the chips never wrap (a second row would
 * fall out of a one-row node) and they never shrink below their text, so the
 * NODE has to be wide enough instead. Reported as "15" disappearing under the
 * gear.
 */
export function minWidthFor(values, vue = isVueNodes()) {
  const labels = (values || []).map((v) => fmt(v));
  let chips = labels.reduce((sum, l) => sum + chipWidth(l), 0);
  chips += Math.max(0, labels.length - 1) * CHIP_GAP;
  // Both renderers reserve the label column, they just inset the row by
  // different amounts. MEASURED in Nodes 2.0 on a 320-wide node: the row spans
  // 284px starting 18px in, so 18 each side; Classic insets the widget root 10
  // and the root pads 6.
  const reserve = vue ? VUE_LABEL_RESERVE : LABEL_RESERVE;
  const margins = vue ? 36 : ROOT_MARGIN * 2 + BODY_PAD * 2;
  return Math.ceil(margins + chips + ROW_GAP + GEAR_W + reserve);
}
/**
 * The node body: the button row with even margins, and nothing else. The SAME
 * number in both renderers, which is the point of it.
 *
 * MEASURED, not derived. Once the row is lifted onto the dot line the chip
 * always occupies node-local 2.7..25.3 whatever the node height is (swept 56
 * down to 28: the chip never moved and the alignment held at 0), so 28 is the
 * row with even margins above and below it.
 *
 * ⚠️ Nodes 2.0 reads this when the WIDGET IS BUILT and never again. It used to
 * return `ROW_H + BODY_PAD*2 + 6` = 44 for that renderer, which is what made the
 * node render 112px tall with a 25px hole between the buttons and the nodepack
 * badge ("now looks huge"). At 28 it renders 97 with a 10px gap, fresh AND after
 * any number of reloads.
 *
 * That is the correction to a WRONG conclusion recorded in #10 - that the Vue
 * layout floored the node and nothing could move it. It was reached by patching
 * `getMinHeight` on the LIVE widget, which genuinely does nothing, because the
 * value is baked at construction. Patching a live object is NOT a test of a
 * value that is read once when the object is made: change it at source and
 * reload the page.
 */
export function bodyHeight() {
  return ROW_H + 2;
}

// Classic's widgets_start_y (index.js liftOverSlots): the body starts 2px down.
export const CLASSIC_START_Y = 2;

/**
 * The DOM widget's own height: the body minus where it starts.
 *
 * ⚠️ Classic: core's `_arrangeWidgets` runs on EVERY draw and GROWS the node
 * when `widgets_start_y + widget height > node height`. At bodyHeight() that was
 * 2 + 28 = 30 against the pinned 28, so core grew it to 30, onResize pinned it
 * back to 28, and the setSize marked the canvas dirty for the next frame: a
 * resize loop at the frame rate for as long as the node was on screen (Discord
 * 2026-10-28: 1-3 CPU cores busy while idle, gone when the node was deleted).
 * Nodes 2.0 skips that grow and reads this once at build, so it keeps 28 there.
 */
function widgetHeight() {
  return isVueNodes() ? bodyHeight() : bodyHeight() - CLASSIC_START_Y;
}

export function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const css = `
  .${ROOT_CLASS}{
    box-sizing:border-box; display:flex; flex-direction:column; gap:4px;
    padding:${BODY_PAD}px; font:12px 'Segoe UI',sans-serif; user-select:none;
    /* Transparent, not a panel colour: an opaque root would cover the "value"
       label the node paints in the same band. */
    background:transparent;
  }
  /* Classic: the body is lifted over the output-slot band and the buttons take
     the empty left half of it, which puts them ~20px higher. It reserves the
     right for the "value" label the node paints there. */
  .${ROOT_CLASS}.classic{ padding-top:2px; }
  .${ROOT_CLASS}.classic .pix-npick-row{
    padding-right:${LABEL_RESERVE}px;
    /* Lift onto the output-dot line. margin, NOT position:relative: a
       relative shift would leave a 13px hole at the bottom of the body,
       where a negative margin takes the height with it. */
    margin-top:-${NUDGE_EXTRA_LIFT}px;
  }
  /* Nodes 2.0: same idea, different number - the body is lifted onto the
     output band by the block-nudge, so it must leave the "value" label room. */
  .${ROOT_CLASS}:not(.classic) .pix-npick-row{ padding-right:${VUE_LABEL_RESERVE}px; }
  .pix-npick-row{ display:flex; align-items:center; gap:5px; min-height:${ROW_H}px; }

  /* NEVER wrap: a second row would fall straight out of a one-row node
     (duration.md #13, learned there first). The buttons do not shrink either -
     the NODE's minimum width grows to fit them instead (minWidthFor), because a
     button squeezed under the gear is the defect this replaced.
     overflow:hidden stays only as a backstop for a node somehow narrower than
     its own minimum. */
  .pix-npick-chips{
    display:flex; gap:4px; flex:1 1 auto; min-width:0;
    flex-wrap:nowrap; overflow:hidden;
  }
  .pix-npick-chip{
    /* flex-shrink 0: a chip must NEVER be narrower than its number. The node's
       own minimum width grows to fit them instead (minWidthFor), which is what
       stops the last one sliding under the gear. They still GROW to share a
       wider node. */
    flex:1 0 auto; box-sizing:border-box;
    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14);
    border-radius:4px; color:rgba(255,255,255,0.72); font-size:12px;
    padding:4px 6px; cursor:pointer; text-align:center; line-height:1.1;
    font-family:inherit; white-space:nowrap; overflow:hidden;
  }
  .pix-npick-chip:hover{ border-color:${ACC}; color:#ddd; }
  .pix-npick-chip.on, .pix-npick-chip.on:hover{
    background:${ACC}; border-color:${ACC}; color:#fff;
  }

  /* The bundled gear SVG as a mask, never the emoji (convention #28): an emoji
     is drawn by the OS, so it is a different shape and baseline on every
     platform. currentColor so it follows the row rather than drifting. */
  .pix-npick-gear{
    flex:0 0 auto; width:16px; height:16px; padding:0; margin:0; line-height:0;
    background:none; border:none; cursor:pointer; color:#bbb;
  }
  .pix-npick-gear::before{
    content:""; display:block; width:14px; height:14px; background:currentColor;
    -webkit-mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
    mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
  }
  .pix-npick-gear:hover{ color:${ACC}; }
  `;
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
}

export function buildFace(node, openPanel) {
  const root = document.createElement("div");
  root.className = ROOT_CLASS + (isVueNodes() ? "" : " classic");

  const row = document.createElement("div");
  row.className = "pix-npick-row";
  root.appendChild(row);

  node._pixNpRoot = root;
  node._pixNpRow = row;
  node._pixNpOpenPanel = openPanel;

  const widget = node.addDOMWidget(WIDGET_NAME, WIDGET_TYPE, root, {
    serialize: false,
    // min AND max the same: the body is one row and nothing in it fills spare
    // space, so letting the widget stretch just gives a big empty box. Both are
    // CONSTANTS, never a live measurement, so they cannot grow a node on load
    // (convention #39 E). widgetHeight, not bodyHeight: see there (Classic loop).
    getMinHeight: () => widgetHeight(),
    getMaxHeight: () => widgetHeight(),
  });
  // BOTH flags, they are not the same one: options.serialize keeps the widget
  // out of the PROMPT, widget.serialize (top level) keeps it out of the saved
  // WORKFLOW. With only the first, the node writes widgets_values: [""] into
  // every saved file - state that means nothing and can differ between
  // renderers, which is how a clean workflow starts opening "modified".
  widget.serialize = false;
  // canvasOnly must be TRUE in Classic (keeps it out of the Parameters tab) and
  // FALSE in Nodes 2.0 (or the Vue body renders nothing) - hence the live getter.
  applyAdaptiveCanvasOnly(widget);
  // Without this the wheel stops zooming the canvas whenever the cursor is over
  // this node, because the DOM widget swallows it (convention #17).
  installCanvasZoomPassthrough(root);
  installNodeAccent(node, root);
  // Pins a content floor ONLY while a resize handle is dragged, so the row
  // cannot be squashed out of the frame - and node.size is never written, so a
  // clean workflow cannot open "modified".
  node._pixNpFloorOff = installResizeFloor(root, () => bodyHeight());

  return widget;
}

export function renderFace(node) {
  const row = node?._pixNpRow;
  // Deliberately NOT gated on `row.isConnected`. The first render runs from a
  // queueMicrotask in onNodeCreated, and the widget element is NOT in the
  // document yet at that point - an isConnected guard there returns early and
  // nothing ever renders again, so the node comes up with an empty body.
  // Building into a detached element is fine; it shows when it is attached.
  if (!row) return;
  // Re-asserted every render, not just at build: the renderer can be switched
  // while the node is on the canvas, and the two layouts are not interchangeable.
  node._pixNpRoot?.classList.toggle("classic", !isVueNodes());
  const st = readState(node);
  row.textContent = "";

  const chips = document.createElement("div");
  chips.className = "pix-npick-chips";
  for (const v of st.values) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pix-npick-chip" + (Math.abs(v - st.value) < 1e-9 ? " on" : "");
    b.textContent = fmt(v);
    b.title = `Send ${fmt(v)}`;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      writeState(node, { value: v });
      renderFace(node);
      node.setDirtyCanvas?.(true, true);
    });
    chips.appendChild(b);
  }
  row.appendChild(chips);

  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "pix-npick-gear";
  gear.title = "Settings: choose the numbers on the buttons";
  gear.addEventListener("click", (e) => {
    e.stopPropagation();
    node._pixNpOpenPanel?.(node);
  });
  row.appendChild(gear);
}

export function destroyFace(node) {
  try { node._pixNpFloorOff?.(); } catch {}
  node._pixNpFloorOff = null;
  node._pixNpRoot = null;
  node._pixNpRow = null;
}

// ── Nodes 2.0: lift the body onto the output-slot band ─────────────────────
//
// Classic gets this free (`widgets_start_y`), but Nodes 2.0 renders the dots in
// their own block, so the button row lands BELOW the "value" label with a gap -
// reported as "the output is not aligned with the numbers on nodes 2".
//
// This is the Load Image Mini / Sliders BLOCK-NUDGE, applied unchanged: pull the
// output-slot block out of flow with a negative bottom margin and the widget
// body rises to overlap it. See `.claude/patterns/load-image-mini.md` for the
// full recipe and why each part is the way it is.
//
// It writes ONLY inline DOM style on a Vue-managed element - never node.size,
// properties or slots - so it cannot dirty a saved workflow (Vue Compat #18),
// and the whole thing is wrapped so a future frontend just degrades to the row
// sitting below the dots, which still works.

function slotBlockOf(node) {
  const root = node?._pixNpRoot;
  const el = root?.closest?.(".lg-node");
  const slot = el?.querySelector?.(".lg-slot--output");
  return slot?.parentElement?.parentElement || null;
}

/**
 * Already lifted? Read our OWN inline negative margin, NEVER a geometric
 * "did the row reach the block" test: the wrapper's padding means it never
 * reaches it exactly, so a geometric check never settles and the poll
 * re-nudges every tick, which flickers. Vue REPLACES the element on re-render
 * (fresh element, no inline style), so this reads false again exactly when a
 * re-apply is needed.
 */
function isNudged(block) {
  return !!block && String(block.style.marginBottom || "").startsWith("-");
}

export function nudgeIntoSlots(node) {
  if (!isVueNodes()) return false;
  try {
    const block = slotBlockOf(node);
    if (!block || isNudged(block)) return false;
    const h = block.offsetHeight;
    if (!h) return false;                       // not laid out yet, try next tick
    block.style.marginBottom = `${-(h + NUDGE_EXTRA_LIFT)}px`;
    return true;
  } catch { return false; }
}

/**
 * Take back the space the lift freed, when the layout did not.
 *
 * ⚠️ THIS EXISTS BECAUSE THE LIFT IS A RACE, and the race is invisible on a fast
 * machine. `nudgeIntoSlots` pulls the slot block out of flow with a negative
 * margin, which makes the widget body 33px shorter. If the Vue layout measures
 * AFTER that, the node comes out right. If it measures BEFORE, the node keeps
 * the taller height forever and nothing re-measures it.
 *
 * MEASURED on two machines running byte-identical code, same server, fresh node:
 *
 *   |            | node.size[1] | widget body | rendered |
 *   | this one   |      67      |     38      |    97    |  (layout measured after)
 *   | the user's |     100      |     71      |   130    |  (layout measured before)
 *
 * Their body is 71 where its own content is 38 (padding 6 + row 26 + padding 6),
 * i.e. exactly the 33px of lift, still reserved. A high-DPI display (theirs is
 * dpr 1.65) shifts layout timing enough to lose the race every single time,
 * which is why they saw it on every new node and I never saw it once.
 *
 * So do not depend on the timing: compare the body against its OWN content and
 * hand back the difference. Idempotent - once corrected the excess is 0, so the
 * poll that calls this settles immediately and never oscillates.
 */
export function trimToContent(node) {
  if (!isVueNodes()) return false;              // Classic pins its height itself
  try {
    const root = node?._pixNpRoot;
    const row = node?._pixNpRow;
    if (!root?.isConnected || !row) return false;
    const cs = getComputedStyle(root);
    const want = row.offsetHeight
      + (parseFloat(cs.paddingTop) || 0)
      + (parseFloat(cs.paddingBottom) || 0);
    if (!want) return false;                    // not laid out yet
    const excess = Math.round(root.offsetHeight - want);
    // A small tolerance: sub-pixel rounding on a fractional-DPI display must not
    // make this nibble a pixel off the node on every poll tick.
    if (excess < 2) return false;
    node.setSize?.([node.size[0], Math.max(1, node.size[1] - excess)]);
    return true;
  } catch { return false; }
}

/**
 * Land the lift and the trim on the FIRST laid-out frame, not on the next poll
 * tick.
 *
 * The 350ms poll is the self-heal for a Vue re-render; it is far too slow for a
 * node being PLACED, which follows the cursor while you position it - the user
 * watched the correction happen: "before adding to canvas it resize on my mouse
 * and by the time is added is already good size". A burst gets it done before
 * the first frame anyone sees.
 *
 * Same shape as the house helper `js/shared/slot_band.mjs::settleSlotBand`, and
 * for the same measured reason: a ResizeObserver is not enough, because the node
 * MOVES and re-lays out without its own box resizing, so the observer never
 * fires. Both calls are idempotent, so the extra attempts cost two reads each.
 */
export function settleNudge(node) {
  if (!isVueNodes()) return;
  const once = () => { nudgeIntoSlots(node); trimToContent(node); };
  try { requestAnimationFrame(once); } catch { once(); }
  for (const ms of [0, 16, 48, 120, 300, 700]) setTimeout(once, ms);
}

const _nudgeTimers = new WeakMap();

/**
 * 350ms self-heal poll. A ResizeObserver is not enough: Vue replaces the node
 * element on re-render, which orphans any observer AND drops our inline style
 * (the same lesson as Sliders' watchAlign). `isNudged` makes the steady state a
 * single property read.
 */
export function watchNudge(node) {
  if (_nudgeTimers.has(node)) return;
  const t = setInterval(() => {
    if (!node.graph) { unwatchNudge(node); return; }
    if (!isVueNodes()) return;                  // Classic uses widgets_start_y
    nudgeIntoSlots(node);
    // ...and reclaim the space the lift freed if the layout measured too early.
    // Both calls are idempotent, so the steady state is two cheap reads.
    trimToContent(node);
  }, 350);
  _nudgeTimers.set(node, t);
}

export function unwatchNudge(node) {
  const t = _nudgeTimers.get(node);
  if (t) clearInterval(t);
  _nudgeTimers.delete(node);
}
