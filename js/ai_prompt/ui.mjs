// AI Prompt Pixaroma - the node face.
//
// ONE DOM widget in both renderers, so a live renderer flip has nothing to
// swap and ComfyUI re-parents the element itself (video-prompt.md #13 - an
// onRendererChange rebuild was tried there, leaked a root per flip, and was
// reverted).
//
// THE CONTROLS LIVE IN THE SLOT BAND. Five inputs against one output leaves
// four empty rows on the right, and the seed, the gear and the join order sit
// there instead of costing the body a row each. In CLASSIC the band FLOATS out
// of the widget flow with a negative top, which is free height
// (reference_classic_dom_band_float); in Nodes 2.0 the node body CLIPS
// anything above the widget top, so it stays in flow as a top row. Both write
// only DOM style, never node.size or node.properties, so neither can dirty a
// saved workflow, and both are wrapped so a future frontend degrades to a row
// rather than breaking the node.

import { app } from "/scripts/app.js";
import { pixAsset } from "../shared/api_url.mjs";
import { ACC, accentOf, installNodeAccent } from "../shared/node_settings.mjs";
import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/nodes2.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { installNativeTextMenu } from "../shared/native_text_menu.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { notifyGraphChanged } from "../shared/graph_changed.mjs";
// Safe: settings.mjs does not import this file, so there is no cycle.
import { askName } from "./settings.mjs";
// The @tag / *category / #list layer, shared with Prompt Pixaroma so the two nodes
// read the SAME library and colour it the same way (prompt.md #24/#25 - wildCat and
// listOf must stay the single source of "is this live").
import {
  acKeydown, backdropHTML, closeAC, injectTagCSS, insertTagAt,
  maybeAC, syncColumns,
} from "../prompt/tag_field.mjs";
import { openLibraryEditor, closeLibraryEditorFor } from "../prompt/library_editor.mjs";
import {
  IDEA_SHARE_DEFAULT,
  IDEA_SHARE_MAX,
  IDEA_SHARE_MIN,
  ORDER_IDEA,
  ORDER_WIRED,
  SEED_FIXED,
  SEED_RANDOM,
  displaySeed,
  readLast,
  readState,
  rollSeed,
  shortModel,
  slotConnected,
  willGenerate,
  wiredSummary,
  writeLast,
  writeState,
} from "./core.mjs";

const CSS_ID = "pixaroma-ai-prompt-css";
export const WIDGET_TYPE = "pixaroma_ai_prompt";
const WIDGET_MIN_H = 250;

// Calibrated against a 5-input / 1-output node in the Classic renderer.
// The band's first row lands beside the SECOND input (directly under the
// output dot) and the second row two slots below it, leaving one empty row
// between them so the seed and the join segment never read as one block.
const CLASSIC_BAND_TOP = -92;
const CLASSIC_RSV_L = 78;      // clear the clip / image / video / audio labels
// The band spreads over the FOUR free slot rows rather than bunching at the top:
// gear + seed beside slot 2, Tags halfway down, and the join segment beside the
// TEXT input it belongs to (slot 5), which is what it actually controls.
//
// Solved, not eyeballed. Rows 1 and 3 are 19px, the Tags row is TAGS_H, and the
// centres must be 60px apart (slot 2 at 34 to slot 5 at 94), so
//   (row3 centre - row1 centre) = 19 + 2*gap + TAGS_H = 60
// which fixes the gap once TAGS_H is chosen. With TAGS_H 23 that is a 9px gap, and
// it puts the Tags centre at 63.5 - midway between slots 3 and 4, i.e. exactly
// between the seed and the join. Change one and re-solve the other; do not nudge
// them by eye (pattern #4).
const TAGS_H = 23;
const CLASSIC_ROW_GAP = 9;
const VUE_ROW_GAP = 5;
// The widget root stops at node width - 10, while LiteGraph draws the output
// dot centred at width - 9 with radius 4, so its right edge is 5px further
// out. Measured, not guessed: getConnectionPos(false, 0) put the dot at x=391
// on a 400-wide node while the root's right edge sat at 390. Without this the
// rail stops short of the dot and the alignment reads as an accident.
const CLASSIC_BAND_RIGHT = -5;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

export function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
    .pix-ap-root { position:relative; width:100%; height:100%; box-sizing:border-box; }
    /* The flex column lives on an INNER layer: ComfyUI writes display:block on
       the addDOMWidget root itself when a node is rebuilt or collapsed, and an
       inline style beats a class, so a flex column on the root silently dies
       after the first tab switch. */
    .pix-ap-inner { position:absolute; inset:0; display:flex; flex-direction:column;
      gap:6px; font:12px 'Segoe UI', sans-serif; box-sizing:border-box; }

    .pix-ap-band { display:flex; flex-direction:column; align-items:flex-end;
      gap:${VUE_ROW_GAP}px; }
    .pix-ap-band.floated { position:absolute; left:${CLASSIC_RSV_L}px;
      right:${CLASSIC_BAND_RIGHT}px; top:${CLASSIC_BAND_TOP}px;
      gap:${CLASSIC_ROW_GAP}px; z-index:2; pointer-events:none; }
    .pix-ap-band.floated > * { pointer-events:auto; }
    .pix-ap-bandrow { display:flex; align-items:center; gap:6px; }

    .pix-ap-gear { width:19px; height:19px; flex:0 0 auto; border-radius:4px;
      background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.14);
      display:flex; align-items:center; justify-content:center; cursor:pointer;
      padding:0; }
    .pix-ap-gear::before { content:""; display:block; width:12px; height:12px;
      background:#bbb;
      -webkit-mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
      mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat; }
    .pix-ap-gear:hover { border-color:${ACC}; }
    .pix-ap-gear:hover::before { background:${ACC}; }

    .pix-ap-seedwrap { display:flex; height:19px; flex:0 0 auto; border-radius:4px;
      overflow:hidden; border:1px solid rgba(255,255,255,.14); }
    .pix-ap-seed { background:rgba(255,255,255,.05); color:#c9c6c2;
      font:10.5px monospace; border:none; padding:0 8px; cursor:pointer;
      display:flex; align-items:center; }
    .pix-ap-seed:hover { color:${ACC}; }
    .pix-ap-seedmode { background:rgba(255,255,255,.05); color:#c9c6c2;
      font:10.5px monospace; border:none; border-left:1px solid rgba(255,255,255,.14);
      padding:0 7px; cursor:pointer; display:flex; align-items:center; }
    .pix-ap-seedmode.is-on { background:${ACC}; color:#fff;
      border-left-color:rgba(0,0,0,.3); }

    .pix-ap-seg { display:flex; height:19px; flex:0 0 auto; border-radius:4px;
      overflow:hidden; border:1px solid rgba(255,255,255,.14); }
    .pix-ap-seg button { background:rgba(255,255,255,.04); color:rgba(255,255,255,.6);
      border:none; font:10.5px 'Segoe UI', sans-serif; padding:0 8px; cursor:pointer;
      display:flex; align-items:center; }
    .pix-ap-seg button + button { border-left:1px solid rgba(255,255,255,.12); }
    .pix-ap-seg button:hover { color:#fff; }
    .pix-ap-seg button.is-on { background:${ACC}; color:#fff;
      border-left-color:rgba(0,0,0,.3); }

    .pix-ap-banner { display:flex; align-items:center; gap:8px; flex:0 0 auto;
      border-radius:5px; padding:6px 9px; font-size:11.5px; color:#e7e4e0;
      background:color-mix(in srgb, ${ACC} 10%, transparent);
      border:1px solid color-mix(in srgb, ${ACC} 34%, transparent); }
    /* The label takes the room and ellipsises; the hint never shrinks. This is
       what makes a wider node show more of the model name - a JS character cut
       would show the same truncated string at every width. */
    .pix-ap-banner .lbl { flex:1 1 auto; min-width:0; overflow:hidden;
      text-overflow:ellipsis; white-space:nowrap; }
    .pix-ap-banner .hint { margin-left:auto; padding-left:8px; color:#6f6c67;
      font-size:11px; flex:0 0 auto; }
    .pix-ap-banner.is-warn { background:rgba(224,163,58,.12);
      border-color:rgba(224,163,58,.4); }
    .pix-ap-banner.is-warn .lbl { color:#e0a33a; }
    .pix-ap-banner.is-mute { background:rgba(255,255,255,.03);
      border-color:rgba(255,255,255,.1); }
    .pix-ap-banner.is-mute .lbl { color:#a4a09a; }

    .pix-ap-caprow { display:flex; align-items:baseline; gap:10px; flex:0 0 auto; }
    .pix-ap-cap { font-size:10px; letter-spacing:.09em; text-transform:uppercase;
      color:${ACC}; flex:0 0 auto; }
    .pix-ap-expand { margin-left:auto; background:none; border:none; color:#6f6c67;
      font-size:11px; cursor:pointer; padding:0; font-family:'Segoe UI', sans-serif; }
    .pix-ap-expand:hover { color:${ACC}; }
    /* One line, always. Left to wrap it ran under the PROMPT label and the two
       collided; nowrap plus a shrinkable min-width means a long note
       ellipsises instead of pushing the row taller. */
    .pix-ap-meta { margin-left:auto; font:10.5px monospace; color:#6f6c67;
      flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis;
      white-space:nowrap; text-align:right; }
    .pix-ap-meta.is-error { color:#e0a33a; }
    /* No .is-stale rule here on purpose. Video Prompt marks a readout that no
       longer matches the node's current settings; porting that needs the
       matching stamp-and-compare in applyResult/renderFace, which this node
       does not have, and a CSS class nothing ever sets is just a promise the
       code does not keep. */

    .pix-ap-out { background:#191919; border:1px solid #343436;
      border-radius:4px; padding:6px 8px; color:#ddd9d4; font:11.5px/1.45 monospace;
      resize:none; outline:none; box-sizing:border-box; width:100%; }

    /* The idea box is TWO STACKED LAYERS so @tags can be coloured while you type.
       The dark surface and the border live on the WRAPPER; the backdrop underneath is
       the only VISIBLE text; the textarea on top has transparent text and a visible
       caret. One visible text layer means the two can never double or ghost - but
       their text COLUMNS must be identical or they wrap at different characters and
       the caret drifts further off with every wrapped line. scrollbar-gutter:stable
       on both is the first defence and syncColumns() measures the rest
       (prompt.md #18, house convention #26). */
    .pix-ap-ideawrap { position:relative; display:flex; box-sizing:border-box;
      flex:var(--pix-ap-idea-grow,360) 1 0; min-height:44px;
      background:#191919; border:1px solid #343436; border-radius:4px; }
    /* ONLY the idea box takes the accent on focus. The readout is readOnly, and
       a focus ring is the strongest "you can type here" cue there is. */
    .pix-ap-ideawrap:focus-within { border-color:${ACC}; }
    .pix-ap-ideabd { position:absolute; inset:0; padding:6px 8px; border:0;
      font:11.5px/1.45 monospace; color:#ddd9d4; white-space:pre-wrap;
      word-wrap:break-word; overflow:hidden; scrollbar-gutter:stable;
      pointer-events:none; box-sizing:border-box; }
    /* overflow-wrap MUST match .pix-ap-ideabd's. syncColumns equalises the two
       columns' WIDTH, and width parity is NOT wrap parity: the backdrop breaks a
       long unbroken token, a textarea defaults to overflow-wrap:normal and moves
       it whole to the next line, so the caret drifts a little further on every
       such token. Same gap found and fixed on Prompt (prompt.md #18); this node
       shares that backdrop, so it shares the bug. It does not reproduce on this
       machine only because a ComfyUI stylesheet happens to supply break-word. */
    .pix-ap-idea { flex:1 1 auto; width:100%; height:100%; box-sizing:border-box;
      background:transparent; color:transparent; caret-color:${ACC}; border:0;
      border-radius:4px; padding:6px 8px; font:11.5px/1.45 monospace; resize:none;
      outline:none; scrollbar-gutter:stable;
      white-space:pre-wrap; overflow-wrap:break-word; }
    /* ⚠️ color:transparent does NOT hide this layer while text is SELECTED.
       The browser paints selected text in the selection's own foreground colour,
       overriding it - CONFIRMED live: selecting in this box makes the textarea's
       own glyphs appear. Normally they land exactly on the backdrop's and nobody
       notices; where the two layers' metrics differ by even a fraction the offset
       ACCUMULATES along the line and you see the sentence twice, sliding apart to
       the right. That is the "ghosted font" report (2026-08-19), whose video shows
       "A woman in a fiery plume" doubled inside the selection.
       Zeroing the selection colour restores the invariant this design rests on -
       ONE visible layer, always. The highlight rectangle still paints, and the
       backdrop (position:absolute, so it paints ABOVE this in-flow textarea)
       supplies the visible text over it, so selecting looks completely normal.
       Do NOT "restore" a visible selection colour here. */
    .pix-ap-idea::selection { color:transparent; }
    .pix-ap-idea::-moz-selection { color:transparent; }

    /* NO expanded-preview box here, deliberately - see ai-prompt.md #21. One was
       built and removed the same day: this face already carries a banner, two
       caption rows, two text boxes, a grip and a button row, so on a 320x368 node
       the idea box is ALREADY under its own 44px minimum. A third box collapsed to
       an 11px sliver, and the only ways out were forcing the node taller than the
       user had made it or letting the buttons spill past the frame. The colours in
       the idea box already say whether a tag is real, which is the part that
       matters; what a slot ROLLED shows up in the generated prompt below. */

    /* Tags: opens the shared library. Deliberately a touch LARGER than the gear and
       the seed chip - it is the one control on this band a person reaches for while
       writing, and its height feeds the row arithmetic above (TAGS_H). */
    .pix-ap-tags { height:${TAGS_H}px; flex:0 0 auto; border-radius:4px; padding:0 13px;
      background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.14);
      color:#c9c6c2; font:11.5px 'Segoe UI', sans-serif; cursor:pointer;
      display:flex; align-items:center; gap:5px; }
    .pix-ap-tags:hover { background:${ACC}; border-color:${ACC}; color:#fff; }
    /* The PROMPT readout is a preview, not an input, so it wears Prompt
       Pixaroma's read-only surface (.pix-prm-expand): a LIGHTER, raised panel
       rather than the sunken dark field an editable box uses. Reported as
       "since text is on dark background look like is editable". Still
       selectable and copyable - cursor:text says so. */
    .pix-ap-out { flex:var(--pix-ap-out-grow,640) 1 0; min-height:64px;
      background:#2d2d2d; border-color:#3a3a3a; color:#d8d8d8; cursor:text; }
    .pix-ap-idea::placeholder { color:#5c5a57; }
    .pix-ap-out::placeholder { color:#7d7a76; }

    .pix-ap-grip { height:9px; flex:0 0 auto; display:flex; align-items:center;
      justify-content:center; cursor:ns-resize; }
    .pix-ap-grip i { display:block; width:34px; height:2px; border-radius:2px;
      background:#3d3d3f; }
    .pix-ap-grip:hover i { background:${ACC}; }

    .pix-ap-acts { display:flex; align-items:center; gap:6px; flex-wrap:wrap;
      flex:0 0 auto; }
    .pix-ap-btn { background:rgba(255,255,255,.05);
      border:1px solid rgba(255,255,255,.13); color:rgba(255,255,255,.7);
      border-radius:4px; padding:5px 11px; font:11.5px 'Segoe UI', sans-serif;
      cursor:pointer; box-sizing:border-box; user-select:none; }
    .pix-ap-btn:hover { background:${ACC}; border-color:${ACC}; color:#fff; }
    .pix-ap-btn:disabled, .pix-ap-btn:disabled:hover { opacity:.38;
      background:rgba(255,255,255,.05); border-color:rgba(255,255,255,.13);
      color:rgba(255,255,255,.7); cursor:default; }
    .pix-ap-btn.is-on, .pix-ap-btn.is-on:hover { background:${ACC};
      border-color:${ACC}; color:#fff; }
    .pix-ap-btn.is-on::before { content:"✓ "; }
    .pix-ap-btn.is-inert { opacity:.4; }
    .pix-ap-btn.is-flash, .pix-ap-btn.is-flash:hover { background:#3ec371;
      border-color:#3ec371; color:#fff; }
    .pix-ap-spacer { flex:1; }
    .pix-ap-primary { font-weight:600; padding:5px 18px; background:${ACC};
      border-color:${ACC}; color:#fff; }
    .pix-ap-primary:hover { filter:brightness(1.1); }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function flash(button, label) {
  if (!button) return;
  // Cache the ORIGINAL once and cancel any pending restore. Capturing it fresh
  // on every call meant a second click inside the 700ms window captured
  // "Copied" as the original, so the button read "Copied" for the rest of the
  // session - and not even green, so it just looked broken. Nothing in
  // renderFace rewrites button labels, so nothing ever put it right.
  // Reproduced here before fixing; the sibling node had already learned this.
  clearTimeout(button._pixFlashT);
  if (button._pixFlashOrig == null) button._pixFlashOrig = button.textContent;
  button.classList.add("is-flash");
  if (label) button.textContent = label;
  button._pixFlashT = setTimeout(() => {
    button.classList.remove("is-flash");
    if (button._pixFlashOrig != null) button.textContent = button._pixFlashOrig;
    button._pixFlashOrig = null;
    button._pixFlashT = null;
  }, 700);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // http on a LAN has no clipboard API. execCommand still works there.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

/** Write the two grow numbers the idea/prompt split rides on.
 *  Style ONLY, so this is safe to call from the load path (Vue Compat #18). */
export function applyShare(node) {
  const els = node?._pixApEls;
  if (!els?.inner) return;
  const st = readState(node);
  const share = st.idea_share;
  const ideaTotal = Math.round(share * 1000);
  els.inner.style.setProperty("--pix-ap-idea-grow", String(ideaTotal));
  els.inner.style.setProperty("--pix-ap-out-grow", String(Math.round((1 - share) * 1000)));
}

/**
 * Open the shared tag library, with Insert writing into THIS node's idea box.
 * The editor itself knows nothing about either node - it takes an accent, an
 * optional prefill and an onInsert.
 */
export function openTagLibrary(node, ideaEl, ctx) {
  openLibraryEditor(node, {
    accent: accentOf(node),
    // `sym` is "#" for a List tag (roll one line) and "@" for a snippet - the editor
    // decides from the card's own kind so Insert drops in the useful form.
    onInsert: (name, sym) => {
      // Re-resolve rather than trusting the element captured when the library opened:
      // Vue can rebuild the widget mid-session and Insert would write into a detached
      // textarea, then stamp that dead element's value into node.properties.
      const live = node._pixApEls?.idea || ideaEl;
      insertTagAt(live, ctx, name, sym);
    },
  });
}

/**
 * Paint the highlight backdrop under the idea textarea.
 *
 * DOM only, so it is safe from the load path. There is no expanded-preview box to
 * fill - see the CSS note above for why one was built and taken out again.
 */
function renderIdeaTags(node) {
  const els = node?._pixApEls;
  if (!els?.ideabd) return;
  els.ideabd.innerHTML = backdropHTML(els.idea.value);
}

function installGrip(node, grip, idea, out) {
  let active = false;
  let pid = null;

  const end = () => {
    if (!active) return;
    active = false;
    try { if (pid != null) grip.releasePointerCapture(pid); } catch (e) { /* gone */ }
    pid = null;
    // A drag ends on pointerup, and the pack-wide change net listens for click
    // and change - so without this the new height is silently lost on the next
    // open (convention #31).
    notifyGraphChanged();
  };

  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    active = true;
    pid = e.pointerId;
    try { grip.setPointerCapture(pid); } catch (e2) { /* not fatal */ }
  });

  grip.addEventListener("pointermove", (e) => {
    if (!active) return;
    // The buttons-up guard. A real mouse can lose its release - the pointer
    // leaves the viewport, another element takes capture - and without this
    // the grip follows the cursor forever. A synthetic drag CANNOT reproduce
    // that, so this is on principle, not on a repro (convention #20).
    if (!(e.buttons & 1)) { end(); return; }
    const top = idea.getBoundingClientRect().top;
    const bottom = out.getBoundingClientRect().bottom;
    const span = bottom - top;
    if (span <= 1) return;
    // A RATIO, never pixels: every rect here is in SCREEN pixels, which is
    // element pixels times the canvas zoom, so a stored pixel height would be
    // wrong at every zoom but the one it was set at. Dividing cancels it out.
    const share = Math.max(IDEA_SHARE_MIN,
      Math.min(IDEA_SHARE_MAX, (e.clientY - top) / span));
    writeState(node, { idea_share: share });
    applyShare(node);
  });

  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  grip.addEventListener("lostpointercapture", end);
  grip.addEventListener("dblclick", (e) => {
    e.preventDefault();
    writeState(node, { idea_share: IDEA_SHARE_DEFAULT });
    applyShare(node);
    notifyGraphChanged();
  });
}

// ---------------------------------------------------------------------------
// Band placement
// ---------------------------------------------------------------------------
/** Float the band into the slot band in Classic; leave it in flow otherwise.
 *  Wrapped so a frontend change costs the placement, never the node. */
export function placeBand(node) {
  const els = node?._pixApEls;
  if (!els?.band) return;
  try {
    const classic = !isVueNodes();
    els.band.classList.toggle("floated", classic);
  } catch (e) {
    els.band.classList.remove("floated");
  }
}

// ---------------------------------------------------------------------------
// Face
// ---------------------------------------------------------------------------
export function buildFace(node, openPanel, openIdeaEditor) {
  injectCSS();
  injectTagCSS();   // the token colours + the autocomplete popup, shared with Prompt

  const root = el("div", "pix-ap-root");
  const inner = el("div", "pix-ap-inner");
  root.appendChild(inner);

  // ---- the slot band -------------------------------------------------------
  const band = el("div", "pix-ap-band");

  const row1 = el("div", "pix-ap-bandrow");
  const gear = el("button", "pix-ap-gear");
  gear.title = "Settings: the model, the formula and how wired text is joined";
  gear.addEventListener("click", (e) => { e.stopPropagation(); openPanel(node); });
  const seedwrap = el("div", "pix-ap-seedwrap");
  const seed = el("button", "pix-ap-seed", "0");
  const seedmode = el("button", "pix-ap-seedmode", "F");
  seedwrap.append(seed, seedmode);
  row1.append(gear, seedwrap);

  // Row 2 is the Tags button, which the user asked to sit under the gear and the
  // seed. It also does the job the deliberately-empty row used to: it separates the
  // gear/seed cluster from the join segment below.
  const rowTags = el("div", "pix-ap-bandrow");
  const tagsBtn = el("button", "pix-ap-tags", "Tags");
  tagsBtn.title = "Your @tag library: reusable snippets, *category and #list slots. Shared with Prompt Pixaroma.";
  rowTags.appendChild(tagsBtn);

  const row2 = el("div", "pix-ap-bandrow");
  const seg = el("div", "pix-ap-seg");
  const segIdea = el("button", null, "Idea first");
  const segWired = el("button", null, "Wired first");
  seg.append(segIdea, segWired);
  row2.appendChild(seg);

  band.append(row1, rowTags, row2);
  inner.appendChild(band);

  // ---- banner --------------------------------------------------------------
  const banner = el("div", "pix-ap-banner");
  const bLabel = el("span", "lbl", "");
  const bHint = el("span", "hint", "");
  banner.append(bLabel, bHint);
  inner.appendChild(banner);

  // ---- idea ----------------------------------------------------------------
  const cap1 = el("div", "pix-ap-caprow");
  const expand = el("button", "pix-ap-expand", "Expand");
  expand.title = "Open the idea in a full-screen box";
  cap1.append(el("span", "pix-ap-cap", "Your idea"), expand);
  // Two layers: the backdrop is the visible text, the textarea on top owns the caret.
  const ideawrap = el("div", "pix-ap-ideawrap");
  const ideabd = el("div", "pix-ap-ideabd");
  const idea = el("textarea", "pix-ap-idea");
  idea.placeholder = "what you want, in plain words";
  idea.spellcheck = true;
  ideawrap.append(ideabd, idea);
  inner.append(cap1, ideawrap);

  const grip = el("div", "pix-ap-grip");
  grip.title = "Drag to change how the height is shared. Double-click to reset.";
  grip.appendChild(el("i"));
  inner.appendChild(grip);

  // ---- prompt --------------------------------------------------------------
  const cap2 = el("div", "pix-ap-caprow");
  const meta = el("span", "pix-ap-meta", "");
  cap2.append(el("span", "pix-ap-cap", "Prompt"), meta);
  const out = el("textarea", "pix-ap-out");
  out.readOnly = true;
  out.placeholder = "press Generate to write the text";
  inner.append(cap2, out);

  // ---- buttons -------------------------------------------------------------
  const acts = el("div", "pix-ap-acts");
  const reroll = el("button", "pix-ap-btn", "Re-roll");
  reroll.title = "Roll a new seed and run again, for a different answer";
  const copy = el("button", "pix-ap-btn", "Copy");
  copy.title = "Copy the text";
  const vram = el("button", "pix-ap-btn", "Free VRAM");
  const generate = el("button", "pix-ap-btn pix-ap-primary", "Generate");
  generate.title = "Run the workflow";
  acts.append(reroll, copy, vram, el("span", "pix-ap-spacer"), generate);
  inner.appendChild(acts);

  // ---- wiring --------------------------------------------------------------
  // The @tag layer. ctx is re-resolved per call, never captured: Vue can tear down
  // and rebuild a node's DOM widget mid-session (Vue Compat #5), and a stale closure
  // would write into a detached textarea.
  const acCtx = () => ({
    accent: () => accentOf(node),
    commit: (value) => { writeState(node, { idea: value }); renderFace(node); },
  });

  idea.addEventListener("input", () => {
    writeState(node, { idea: idea.value });
    renderFace(node);
    maybeAC(acCtx(), idea);
  });
  idea.addEventListener("keydown", (e) => {
    // The autocomplete gets first refusal. It deliberately does not claim
    // Ctrl/Cmd+Enter, so running the workflow from the idea box still works.
    if (acKeydown(e)) return;
    e.stopPropagation();
  });
  // Keep the visible layer scrolled with the invisible one, or the caret leaves the
  // text behind as soon as the idea is taller than the box.
  idea.addEventListener("scroll", () => {
    ideabd.scrollTop = idea.scrollTop;
    ideabd.scrollLeft = idea.scrollLeft;
  });
  // Belt for the column measurement: a theme stylesheet can land after the node was
  // built and change the scrollbar width without ever resizing the textarea, which
  // the ResizeObserver would not hear about.
  idea.addEventListener("focus", () => syncColumns(idea, ideabd));
  idea.addEventListener("blur", () => closeAC());
  out.addEventListener("keydown", (e) => e.stopPropagation());

  tagsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openTagLibrary(node, idea, acCtx());
  });

  expand.addEventListener("click", () => openIdeaEditor(node));

  // Themed, not window.prompt: Electron (ComfyUI Desktop) does not implement
  // that at all, so the chip was simply dead there with nothing shown.
  seed.addEventListener("click", async () => {
    const current = readState(node);
    const typed = await askName("Seed", "Type the seed number to use:",
      String(current.seed));
    if (typed == null) return;
    const value = parseInt(typed, 10);
    if (!Number.isFinite(value)) return;
    writeState(node, { seed: Math.max(0, value) });
    renderFace(node);
    notifyGraphChanged();
  });

  seedmode.addEventListener("click", () => {
    const current = readState(node);
    writeState(node, {
      seed_mode: current.seed_mode === SEED_RANDOM ? SEED_FIXED : SEED_RANDOM,
    });
    renderFace(node);
    notifyGraphChanged();
  });

  segIdea.addEventListener("click", () => {
    writeState(node, { order: ORDER_IDEA });
    renderFace(node);
    notifyGraphChanged();
  });
  segWired.addEventListener("click", () => {
    writeState(node, { order: ORDER_WIRED });
    renderFace(node);
    notifyGraphChanged();
  });

  reroll.addEventListener("click", () => {
    // In FIXED mode a re-roll has to CHANGE the seed, or nothing differs and
    // ComfyUI serves the cached answer - the button would look broken. That is
    // a deliberate user action, so dirtying the workflow is correct.
    //
    // In RANDOM mode it must NOT: seedForRun already rolls a fresh seed for
    // every run and ignores the stored one, so writing one here would change
    // nothing about the result while still marking a clean workflow modified.
    if (readState(node).seed_mode !== SEED_RANDOM) {
      writeState(node, { seed: rollSeed() });
      renderFace(node);
      notifyGraphChanged();
    }
    app.queuePrompt?.(0, 1);
  });

  copy.addEventListener("click", async () => {
    const text = readLast(node).text;
    if (!text) return;
    if (await copyText(text)) flash(copy, "Copied");
  });

  vram.addEventListener("click", () => {
    const current = readState(node);
    writeState(node, { release_model: !current.release_model });
    renderFace(node);
    notifyGraphChanged();
  });

  generate.addEventListener("click", () => app.queuePrompt?.(0, 1));

  // Measure from the WRAPPER, not the textarea: the textarea is now inset inside it,
  // so its top is a couple of pixels off and the drag would creep.
  installGrip(node, grip, ideawrap, out);

  node._pixApEls = {
    root, inner, band, banner, bLabel, bHint, idea, out, meta,
    seed, seedmode, seedwrap, seg, segIdea, segWired, copy, vram, gear,
    reroll, row1, row2, rowTags, tagsBtn, ideawrap, ideabd,
  };

  const widget = node.addDOMWidget(WIDGET_TYPE, WIDGET_TYPE, root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => WIDGET_MIN_H,
  });
  // BOTH flags: widget.options.serialize controls prompt inclusion, the
  // top-level widget.serialize controls workflow persistence. Setting only one
  // leaves this widget taking a widgets_values slot.
  widget.serialize = false;
  // No custom computeSize, and no getMaxHeight. A fill widget with a
  // computeSize is treated as FIXED height by legacy LiteGraph: the node
  // refuses to be dragged smaller and the content spills a few px past the
  // frame (nodes2-preview-fill.md).
  widget.computeLayoutSize = () => ({ minHeight: WIDGET_MIN_H, minWidth: 1 });
  applyAdaptiveCanvasOnly(widget);
  installCanvasZoomPassthrough(root);
  installNativeTextMenu(root);
  installNodeAccent(node, root);
  node._pixApFloorOff = installResizeFloor(root, () => WIDGET_MIN_H);
  node._pixApWidget = widget;

  // The two text columns must stay identical. Observe the TEXTAREA - never the
  // backdrop, whose padding syncColumns mutates, or it re-fires forever. A
  // ResizeObserver rather than onResize because that hook is not reliable for DOM
  // widgets (Vue Compat #13), and it also covers the renderer flip and the
  // textarea's own scrollbar appearing, which shrinks its content box.
  try {
    node._pixApColRO = new ResizeObserver(() => syncColumns(idea, ideabd));
    node._pixApColRO.observe(idea);
  } catch (e) { /* no observer: the focus listener still corrects it */ }

  applyShare(node);
  placeBand(node);
  renderFace(node);
  return widget;
}

export function destroyFace(node) {
  try { node._pixApFloorOff?.(); } catch (e) { /* gone */ }
  node._pixApFloorOff = null;
  try { node._pixApColRO?.disconnect(); } catch (e) { /* gone */ }
  node._pixApColRO = null;
  // The autocomplete popup and the library are body-level singletons, so a deleted
  // node must take its own down or they hang there pointing at nothing.
  try { closeAC(); } catch (e) { /* gone */ }
  try { closeLibraryEditorFor(node); } catch (e) { /* gone */ }
  const widget = node?._pixApWidget;
  if (widget && Array.isArray(node.widgets)) {
    const at = node.widgets.indexOf(widget);
    if (at >= 0) node.widgets.splice(at, 1);
  }
  node._pixApWidget = null;
  node._pixApEls = null;
}

// ---------------------------------------------------------------------------
// Repaint
// ---------------------------------------------------------------------------
export function renderFace(node) {
  const els = node?._pixApEls;
  if (!els) return;
  const st = readState(node);
  const clipWired = slotConnected(node, "clip");
  const textWired = slotConnected(node, "text");

  if (els.idea.value !== st.idea) els.idea.value = st.idea;
  // Style only (three CSS custom properties), so this is safe on the load path and
  // it means the gear's "show what the tags expand to" toggle takes effect without
  // the panel needing to know about the layout.
  applyShare(node);
  // The highlight has to follow every path that can change the idea - typing, an
  // Insert from the library, the full-screen editor, and a workflow load.
  renderIdeaTags(node);

  // ---- banner --------------------------------------------------------------
  els.banner.classList.remove("is-warn", "is-mute");
  // The full filename on the label itself, so a name too long for even a wide
  // node is still one hover away.
  els.bLabel.title = clipWired ? "" : (st.model || "");
  if (!clipWired && !st.model) {
    els.banner.classList.add("is-warn");
    els.bLabel.textContent = "No model";
    els.bHint.textContent = "text passes through";
    els.banner.title = "Nothing to write with, so the node hands its text "
      + "straight on. Pick a model from the gear.";
  } else {
    const name = clipWired ? "Model on wire" : shortModel(st.model);
    if (!st.formula.trim()) {
      els.banner.classList.add("is-mute");
      els.bLabel.textContent = name;
      els.bHint.textContent = willGenerate(node)
        ? "no formula · idea only" : "nothing to send";
      els.banner.title = "No formula, so the model gets your idea by itself.";
    } else {
      els.bLabel.textContent = name;
      els.bHint.textContent = wiredSummary(node);
      els.banner.title = "Formula, your idea and anything wired in.";
    }
  }

  // ---- band ---------------------------------------------------------------
  els.seed.textContent = String(displaySeed(node));
  els.seed.title = "The seed this run uses. Click to type one.";
  const random = st.seed_mode === SEED_RANDOM;
  els.seedmode.textContent = random ? "R" : "F";
  els.seedmode.classList.toggle("is-on", random);
  els.seedmode.title = random
    ? "Random: a new seed every Run, so it writes something different each time."
    : "Fixed: the same seed every Run, so an unchanged node is cached and Run "
      + "is instant.";
  els.reroll.title = random
    ? "Run again. Random mode already rolls a new seed every time, so this is "
      + "the same as Generate."
    : "Roll a new seed and run again, for a different answer.";

  // The join segment is only meaningful while text is wired, and a control
  // that does nothing is worse than no control. The band has spare rows, so
  // hiding it costs the node no height either way.
  els.row2.style.display = textWired ? "" : "none";
  els.segIdea.classList.toggle("is-on", st.order === ORDER_IDEA);
  els.segWired.classList.toggle("is-on", st.order === ORDER_WIRED);
  els.segIdea.title = "Your idea first, then the wired text.";
  els.segWired.title = "The wired text first, then your idea.";

  // ---- readout -------------------------------------------------------------
  // Read from node.properties, not a runtime field, so it is still here after
  // a workflow tab switch - which rebuilds every node object (core.mjs,
  // LAST_PROP). That also means renderFace on the load path restores it with
  // nothing extra to wire up.
  const last = readLast(node);
  els.out.value = last.text;
  els.copy.disabled = !last.text || last.error;
  els.meta.classList.toggle("is-error", last.error || last.muted);
  els.meta.textContent = last.meta;
  els.meta.title = last.meta;

  // ---- Free VRAM -----------------------------------------------------------
  els.vram.classList.toggle("is-on", st.release_model);
  els.vram.classList.toggle("is-inert", clipWired);
  els.vram.title = clipWired
    ? "Skipped while a model is wired in: that one belongs to the node feeding "
      + "it, so it is not this node's to unload."
    : st.release_model
      ? "On: the model is unloaded as soon as the text is written, so a video "
        + "model downstream gets the memory. In a chain, turn this on only for "
        + "the LAST node using this model."
      : "Off: the model stays loaded, so the next run is quicker.";

  placeBand(node);
  applyShare(node);
}

/** The result of a run, kept on node.properties so a workflow tab switch does
 *  not throw it away (core.mjs, LAST_PROP). It is outside the injected state,
 *  so it can neither reach Python nor change the node's cache signature. */
export function applyResult(node, payload, elapsed) {
  const bits = [];
  // The banner says WHICH model, so this line does not repeat it - it reports
  // only what the banner cannot know. The one thing worth shouting about is a
  // clip wire that was there in the UI but never reached Python, because
  // graphToPrompt drops an input whose origin node is muted or bypassed: the
  // banner would read "Model on wire" while a completely different model ran.
  if (payload?.used_clip === false && slotConnected(node, "clip")) {
    bits.push("the wired model was muted");
  }
  if (payload?.status) bits.push(payload.status);
  if (payload?.words != null) bits.push(payload.words + " words");
  const secs = payload?.seconds != null ? payload.seconds : elapsed;
  if (secs != null) bits.push(Number(secs).toFixed(1) + "s");
  writeLast(node, {
    text: String(payload?.text ?? ""),
    meta: bits.join(" · "),
    error: false,
    muted: payload?.used_clip === false && slotConnected(node, "clip"),
    seed: payload?.seed,
  });
  renderFace(node);
}

export function applyError(node, message) {
  // A whole-object write, so `muted` from an earlier successful run cannot
  // survive into a failure and paint the meta line for the wrong reason.
  writeLast(node, {
    text: String(message || "It did not run."),
    meta: "did not run",
    error: true,
    muted: false,
  });
  renderFace(node);
}
