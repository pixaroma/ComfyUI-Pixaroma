// Music Prompt Pixaroma - the node face.
//
// ONE DOM widget in both renderers, so a live renderer flip has nothing to swap
// and ComfyUI re-parents the element itself (video-prompt.md #13 - an
// onRendererChange rebuild was tried there, leaked a root per flip and was
// reverted).
//
// THE GEAR SITS IN THE BANNER, not in a floated slot band. AI Prompt floats its
// controls out over four empty slot rows because it has five inputs against one
// output; this node has TWO inputs against TWO outputs, so there is no dead
// space on the right to float into and nothing to measure. That is the whole
// reason none of ai-prompt.md #4's measured band constants appear here.
//
// ONE READOUT WITH A TAB, not two stacked boxes. The column already carries a
// banner, an idea box, two control rows, a tip, a tab row, a readout and a
// button row. AI Prompt built a third text box on a shorter column than this
// one and removed it the same day: on a node near its minimum the idea box was
// ALREADY under its own 44px floor, and the third child resolved to an 11px
// sliver holding 74px of content (ai-prompt.md #21). Caption and lyrics share
// one box and the segment picks which - both are generated either way.

import { app } from "/scripts/app.js";
import { pixAsset } from "../shared/api_url.mjs";
import { ACC, accentOf, installNodeAccent } from "../shared/node_settings.mjs";
// The @tag / *category / #list layer, shared with Prompt Pixaroma and AI Prompt so
// all three read the SAME library and colour it the same way (prompt.md #24/#25 -
// wildCat and listOf must stay the single source of "is this live").
import {
  acKeydown, backdropHTML, closeAC, injectTagCSS, insertTagAt,
  maybeAC, syncColumns,
} from "../prompt/tag_field.mjs";
import { openLibraryEditor, closeLibraryEditorFor } from "../prompt/library_editor.mjs";
import { applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { installNativeTextMenu } from "../shared/native_text_menu.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { notifyGraphChanged } from "../shared/graph_changed.mjs";
import {
  IDEA_SHARE_DEFAULT,
  IDEA_SHARE_MAX,
  IDEA_SHARE_MIN,
  MAX_SECONDS,
  MAX_VERSES,
  MIN_SECONDS,
  SECONDS_CHIPS,
  SEED_FIXED,
  SEED_RANDOM,
  VERSES_AUTO,
  VIEW_CAPTION,
  VIEW_LYRICS,
  WIDGET_MIN_H,
  displaySeed,
  readLast,
  readState,
  rollSeed,
  shortModel,
  slotConnected,
  songSummary,
  willGenerate,
  wiredSummary,
  writeLast,
  writeState,
} from "./core.mjs";

const CSS_ID = "pixaroma-music-prompt-css";
export const WIDGET_TYPE = "pixaroma_music_prompt";

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
    .pix-mp-root { position:relative; width:100%; height:100%; box-sizing:border-box; }
    /* The flex column lives on an INNER layer: ComfyUI writes display:block on
       the addDOMWidget root itself when a node is rebuilt or collapsed, and an
       inline style beats a class, so a flex column on the root silently dies
       after the first tab switch. */
    .pix-mp-inner { position:absolute; inset:0; display:flex; flex-direction:column;
      gap:6px; font:12px 'Segoe UI', sans-serif; box-sizing:border-box; }

    /* ---- banner ---------------------------------------------------------- */
    .pix-mp-banner { display:flex; align-items:center; gap:7px; flex:0 0 auto;
      border-radius:5px; padding:6px 9px; font-size:11.5px; color:#e7e4e0;
      background:color-mix(in srgb, ${ACC} 10%, transparent);
      border:1px solid color-mix(in srgb, ${ACC} 34%, transparent); }
    /* The label takes the room and ellipsises; the hint never shrinks. That is
       what makes a wider node show more of the model name - a JS character cut
       would show the same truncated string at every width (ai-prompt.md #11). */
    .pix-mp-banner .lbl { flex:1 1 auto; min-width:0; overflow:hidden;
      text-overflow:ellipsis; white-space:nowrap; }
    .pix-mp-banner .hint { color:#6f6c67; font-size:11px; flex:0 0 auto; }
    .pix-mp-banner.is-warn { background:rgba(224,163,58,.12);
      border-color:rgba(224,163,58,.4); }
    .pix-mp-banner.is-warn .lbl { color:#e0a33a; }
    .pix-mp-banner.is-mute { background:rgba(255,255,255,.03);
      border-color:rgba(255,255,255,.1); }
    .pix-mp-banner.is-mute .lbl { color:#a4a09a; }

    /* A bundled SVG as a mask, never the emoji: an emoji is drawn by the
       operating system, so it is a different shape and a different baseline on
       Windows, Mac and Linux (house convention #28). */
    .pix-mp-gear { width:19px; height:19px; flex:0 0 auto; border-radius:4px;
      background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.14);
      display:flex; align-items:center; justify-content:center; cursor:pointer;
      padding:0; }
    .pix-mp-gear::before { content:""; display:block; width:12px; height:12px;
      background:#bbb;
      -webkit-mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
      mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat; }
    .pix-mp-gear:hover { border-color:${ACC}; }
    .pix-mp-gear:hover::before { background:${ACC}; }

    /* ---- captions -------------------------------------------------------- */
    .pix-mp-caprow { display:flex; align-items:baseline; gap:10px; flex:0 0 auto; }
    /* The row carrying the seed chip centres instead, or a 21px control hangs
       off a text baseline. */
    .pix-mp-caprow.has-seed { align-items:center; gap:7px; }
    .pix-mp-cap { font-size:10px; letter-spacing:.09em; text-transform:uppercase;
      color:${ACC}; flex:0 0 auto; }
    .pix-mp-expand { margin-left:auto; background:none; border:none; color:#6f6c67;
      font-size:11px; cursor:pointer; padding:0; font-family:'Segoe UI', sans-serif; }
    .pix-mp-expand:hover { color:${ACC}; }
    /* One line, always: left to wrap it ran under the label and the two
       collided. nowrap plus a shrinkable min-width ellipsises instead. */
    .pix-mp-meta { margin-left:auto; font:10.5px monospace; color:#6f6c67;
      flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis;
      white-space:nowrap; text-align:right; }
    /* On the seed row the SEED does the filling, so the auto margin that would
       otherwise shove this (and Tags after it) to the right has no job. Leave
       it in and the seed cannot grow. This is also the row's only shrinkable
       item, which is deliberate: it is a label, so it ellipsises, while the
       controls beside it keep their size. */
    .pix-mp-caprow.has-seed .pix-mp-meta { margin-left:0; }
    .pix-mp-meta.is-error { color:#e0a33a; }

    /* ---- the two text boxes ---------------------------------------------- */
    .pix-mp-idea, .pix-mp-out { width:100%; box-sizing:border-box;
      border-radius:4px; padding:6px 8px; resize:none; outline:none; }
    /* The idea box is TWO STACKED LAYERS so @tags can be coloured while you
       type. The dark surface and the border live on the WRAPPER; the backdrop
       underneath is the only VISIBLE text; the textarea on top has transparent
       text and a visible caret. One visible text layer means the two can never
       double or ghost - but their text COLUMNS must be identical or they wrap
       at different characters and the caret drifts further off with every
       wrapped line. scrollbar-gutter:stable on both is the first defence and
       syncColumns() measures the rest (house convention #26, prompt.md #18).
       The line-height is stated EXPLICITLY on both: a div and a textarea do not
       have to resolve the keyword "normal" to the same number, and a half-pixel
       difference per line is the same drift by another route. */
    .pix-mp-ideawrap { position:relative; display:flex; box-sizing:border-box;
      flex:var(--pix-mp-idea-grow,340) 1 0; min-height:44px;
      background:#1d1d1d; border:1px solid #333; border-radius:4px; }
    /* ONLY the idea box takes the accent on focus. The readout is readOnly, and
       a focus ring is the strongest "you can type here" cue there is. */
    .pix-mp-ideawrap:focus-within { border-color:${ACC}; }
    .pix-mp-ideabd { position:absolute; inset:0; padding:6px 8px; border:0;
      font:12px/1.45 monospace; color:#e0e0e0; white-space:pre-wrap;
      word-wrap:break-word; overflow:hidden; scrollbar-gutter:stable;
      pointer-events:none; box-sizing:border-box; }
    /* overflow-wrap MUST match .pix-mp-ideabd's. syncColumns equalises the two
       columns' WIDTH, and width parity is NOT wrap parity: the backdrop breaks
       a long unbroken token where a textarea defaults to overflow-wrap:normal
       and moves it whole to the next line, so the caret drifts a little further
       on every such token. Same gap found and fixed on Prompt (prompt.md #18);
       this node shares that backdrop, so it would share the bug. */
    .pix-mp-idea { flex:1 1 auto; width:100%; height:100%; min-height:0;
      background:transparent; color:transparent; caret-color:${ACC};
      border:0; font:12px/1.45 monospace; scrollbar-gutter:stable;
      white-space:pre-wrap; overflow-wrap:break-word; }
    .pix-mp-idea::placeholder { color:#5c5a57; }
    /* A transparent text colour does NOT hide this layer while text is
       SELECTED: the browser paints selected text in the selection's own
       foreground colour and overrides it. Confirmed live on AI Prompt, whose
       idea box is this same two-layer field. Where the two layers' metrics
       differ at all the offset accumulates along the line and the sentence is
       drawn twice, sliding apart to the right - the "ghosted font" report of
       2026-08-19. Zeroing the selection colour keeps ONE visible text layer,
       which is the invariant the whole design rests on. The highlight
       rectangle still paints and the backdrop supplies the text over it.
       Same idiom as Note's code view. Do not restore a visible colour here. */
    .pix-mp-idea::selection { color:transparent; }
    .pix-mp-idea::-moz-selection { color:transparent; }
    /* Tags: opens the shared library, the same one Prompt Pixaroma uses. Sized
       to the Caption/Lyrics segment beside it (20px, not the sibling's 23px)
       because this row is tighter - it already carries the segment, the seed
       and the meta readout. */
    .pix-mp-tags { height:20px; flex:0 0 auto; border-radius:4px; padding:0 9px;
      background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.14);
      color:#c9c6c2; font:10.5px 'Segoe UI', sans-serif; cursor:pointer;
      display:flex; align-items:center; }
    .pix-mp-tags:hover { background:${ACC}; border-color:${ACC}; color:#fff; }
    /* The readout is a PREVIEW, not an input, so it wears Prompt Pixaroma's
       read-only surface: a LIGHTER, raised panel rather than the sunken dark
       field an editable box uses. A dark field beside an editable one reads as
       "type here", which was reported on the sibling. And NO focus accent - a
       focus ring is the strongest "you can type here" cue there is. Still
       selectable and copyable, which cursor:text says. */
    .pix-mp-out { flex:var(--pix-mp-out-grow,660) 1 0; min-height:64px;
      background:#2d2d2d; border:1px solid #3a3a3a; color:#d8d8d8;
      font:11.5px/1.45 monospace; cursor:text; }
    .pix-mp-out::placeholder { color:#7d7a76; }
    .pix-mp-out.is-error { color:#e0a33a; border-color:#7a5a20; }

    .pix-mp-grip { height:9px; flex:0 0 auto; display:flex; align-items:center;
      justify-content:center; cursor:ns-resize; }
    .pix-mp-grip i { display:block; width:34px; height:2px; border-radius:2px;
      background:#3d3d3f; }
    .pix-mp-grip:hover i { background:${ACC}; }

    /* ---- control rows ---------------------------------------------------- */
    .pix-mp-row { display:flex; align-items:center; gap:6px; flex:0 0 auto; }
    /* Not applicable rather than disabled: instrumental music has no verses or
       choruses to ask for, but the row keeps working so the settings survive a
       trip to Instrumental and back. Dimmed, never hidden - a row that vanishes
       changes the node's height on a click and is harder to find again. */
    .pix-mp-row.is-dim { opacity:.42; }
    .pix-mp-rowlbl { font-size:10px; letter-spacing:.09em; text-transform:uppercase;
      color:${ACC}; flex:0 0 auto; }
    /* The chips shrink together rather than wrapping: someone deliberately
       making the node narrower is asking for smaller controls, not a taller
       node. overflow:hidden is the backstop. */
    .pix-mp-chips { display:flex; gap:4px; flex:1 1 auto; min-width:0;
      flex-wrap:nowrap; overflow:hidden; }
    .pix-mp-chip { flex:1 1 0; min-width:26px; box-sizing:border-box;
      background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.14);
      border-radius:4px; color:rgba(255,255,255,.72); font-size:11px;
      padding:4px 5px; cursor:pointer; text-align:center; line-height:1.1;
      font-family:inherit; white-space:nowrap; overflow:hidden; }
    .pix-mp-chip:hover { border-color:${ACC}; color:#ddd; }
    .pix-mp-chip.is-on, .pix-mp-chip.is-on:hover { background:${ACC};
      border-color:${ACC}; color:#fff; }

    /* A toggle, not one of a set: it keeps its own width. */
    .pix-mp-tog { flex:0 0 auto; box-sizing:border-box;
      background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.14);
      border-radius:4px; color:rgba(255,255,255,.72); font-size:11px;
      padding:4px 8px; cursor:pointer; line-height:1.1; font-family:inherit;
      white-space:nowrap; }
    .pix-mp-tog:hover { border-color:${ACC}; color:#ddd; }
    .pix-mp-tog.is-on, .pix-mp-tog.is-on:hover { background:${ACC};
      border-color:${ACC}; color:#fff; }

    /* The seconds value, click to type. An inline field rather than a dialog:
       a native prompt is the one primitive a host can refuse, and it refuses
       SILENTLY - three "the button does nothing" reports on the sibling came
       from exactly that (ai-prompt.md #19 / #19c). */
    .pix-mp-secs { flex:0 0 auto; width:52px; box-sizing:border-box;
      background:#1d1d1d; border:1px solid #444; border-radius:4px;
      color:${ACC}; font:11px monospace; padding:4px 6px; text-align:center;
      cursor:text; outline:none; }
    .pix-mp-secs:hover { border-color:${ACC}; }
    .pix-mp-secs:focus { border-color:${ACC}; }

    /* ---- seed ------------------------------------------------------------ */
    /* THE SEED FILLS THE GAP, the way Voice / Instrumental fill their row -
       asked for directly ("tag to be right side and seed to adjust between
       like voice instrumental").
       ⚠️ IT MUST NEVER SHRINK. It did for one commit, and that was a real bug:
       an <input> carries an intrinsic ~20-character width, so killing that with
       seed.size = 1 and then making the WRAP the row's deficit valve
       (flex:0 1 auto) meant the wrap shrank under its own content and
       overflow:hidden clipped from the RIGHT - which is where the F/R button
       lives. Measured at the DEFAULT width: 4px of a 20px button, and nothing
       at all at MIN_W. Reported as "seed dissaprer Random i have to make it
       bigger to change", i.e. the mode could not be clicked at any normal size.
       A CONTROL is never the right thing to squeeze. The deficit belongs to
       .pix-mp-meta, which is a status LABEL and already ellipsises; min-width
       here is the floor that keeps the number and the button whole. */
    .pix-mp-seedwrap { display:flex; height:21px; flex:1 1 auto; min-width:72px;
      border-radius:4px;
      overflow:hidden; border:1px solid rgba(255,255,255,.14); }
    /* Fills the wrap rather than sizing to its digits: with the wrap growing
       there is no digit count to follow, which also retires the content-box
       override the old ch-width needed. seed.size = 1 in buildFace is still
       required, or the intrinsic width sets a floor flex cannot get under. */
    .pix-mp-seed { background:rgba(255,255,255,.05); color:#c9c6c2;
      font:10.5px monospace; border:none; padding:0 8px; cursor:text;
      display:flex; align-items:center; outline:none; min-width:0;
      flex:1 1 auto; text-align:center; }
    .pix-mp-seed:hover { color:${ACC}; }
    /* flex:0 0 auto so the F/R letter is never the thing that gets clipped when
       the wrap above gives up its slack - the seed NUMBER has room to spare, a
       one-letter button has none. */
    .pix-mp-seedmode { background:rgba(255,255,255,.05); color:#c9c6c2;
      font:10.5px monospace; border:none; flex:0 0 auto;
      border-left:1px solid rgba(255,255,255,.14);
      padding:0 7px; cursor:pointer; display:flex; align-items:center; }
    .pix-mp-seedmode.is-on { background:${ACC}; color:#fff;
      border-left-color:rgba(0,0,0,.3); }

    /* ---- tip ------------------------------------------------------------- */
    /* ⚠️ text-overflow on a FLEX CONTAINER does nothing for its children: they
       lay out at natural width and overflow:hidden then CLIPS whatever is on
       the end. That is how turning Bridge and Instr. on pushed the seed chip
       off the right of the node and out of sight (user-reported). The
       truncation has to live on the TEXT ITSELF, which is .pix-mp-tipv. */
    .pix-mp-tip { flex:0 0 auto; display:flex; align-items:center; gap:5px;
      color:#777; font-size:10px; line-height:1.3; min-width:0; }
    .pix-mp-tip b { color:${ACC}; font-weight:400; flex:0 0 auto; }
    .pix-mp-tipv { flex:0 1 auto; min-width:0; overflow:hidden;
      text-overflow:ellipsis; white-space:nowrap; }

    /* ---- the caption/lyrics segment -------------------------------------- */
    .pix-mp-seg { display:flex; height:20px; flex:0 0 auto; border-radius:4px;
      overflow:hidden; border:1px solid rgba(255,255,255,.14); }
    .pix-mp-seg button { background:rgba(255,255,255,.04);
      color:rgba(255,255,255,.6); border:none;
      font:10.5px 'Segoe UI', sans-serif; padding:0 10px; cursor:pointer;
      display:flex; align-items:center; }
    .pix-mp-seg button + button { border-left:1px solid rgba(255,255,255,.12); }
    .pix-mp-seg button:hover { color:#fff; }
    .pix-mp-seg button.is-on { background:${ACC}; color:#fff;
      border-left-color:rgba(0,0,0,.3); }

    /* ---- buttons --------------------------------------------------------- */
    /* wrap: the Nodes 2.0 body is narrower than Classic's, so a four-button row
       sized for Classic spills out of the right edge without this. */
    .pix-mp-acts { display:flex; align-items:center; gap:6px; flex-wrap:wrap;
      flex:0 0 auto; }
    .pix-mp-btn { background:rgba(255,255,255,.05);
      border:1px solid rgba(255,255,255,.13); color:rgba(255,255,255,.7);
      border-radius:4px; padding:5px 11px; font:11.5px 'Segoe UI', sans-serif;
      cursor:pointer; box-sizing:border-box; user-select:none; }
    .pix-mp-btn:hover { background:${ACC}; border-color:${ACC}; color:#fff; }
    .pix-mp-btn:disabled, .pix-mp-btn:disabled:hover { opacity:.38;
      background:rgba(255,255,255,.05); border-color:rgba(255,255,255,.13);
      color:rgba(255,255,255,.7); cursor:default; }
    .pix-mp-btn.is-on, .pix-mp-btn.is-on:hover { background:${ACC};
      border-color:${ACC}; color:#fff; }
    .pix-mp-btn.is-on::before { content:"✓ "; }
    /* Higher specificity than :hover, so the green wins while the cursor is
       still on the button after a click (house convention #1). */
    .pix-mp-btn.is-inert { opacity:.4; }
    .pix-mp-btn.is-flash, .pix-mp-btn.is-flash:hover { background:#3ec371;
      border-color:#3ec371; color:#fff; }
    .pix-mp-spacer { flex:1; }
    .pix-mp-primary { font-weight:600; padding:5px 18px; background:${ACC};
      border-color:${ACC}; color:#fff; }
    .pix-mp-primary:hover { filter:brightness(1.1); }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function flash(button, label) {
  if (!button) return;
  // Cache the ORIGINAL once and cancel any pending restore. Capturing it fresh
  // on every call means a second click inside the 700ms window captures
  // "Copied" as the original, and the button then reads "Copied" for the rest
  // of the session with no green - so it just looks broken. The sibling had to
  // fix exactly this; copy the helper, do not rewrite it (ai-prompt.md #12).
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

function copyText(text, button) {
  const done = () => flash(button, "Copied");
  if (!text) return;
  // navigator.clipboard is absent on a plain http LAN address, which is how a
  // lot of people reach their own ComfyUI, so there has to be a fallback for
  // WRITING (there is none for reading). Seed Pixaroma made the same call.
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallback(text, done));
    return;
  }
  fallback(text, done);
}

function fallback(text, done) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    done();
  } catch (_) { /* nothing sensible to say; the button simply does not flash */ }
}

/** Commit a typed number, or put the field back to the stored value. */
function commitNumber(field, current, lo, hi, apply) {
  const raw = String(field.value ?? field.textContent ?? "").replace(/[^0-9]/g, "");
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return apply(current);
  return apply(Math.max(lo, Math.min(hi, n)));
}

/**
 * Share the column height between the idea box and the readout.
 *
 * Style only, so it is safe to call on the load path - it can never write
 * node.size or node.properties and therefore cannot flag a clean workflow
 * modified (Vue Compat #18).
 */
export function applyShare(node) {
  const els = node?._pixMpEls;
  if (!els?.inner) return;
  const share = readState(node).idea_share;
  els.inner.style.setProperty("--pix-mp-idea-grow", String(Math.round(share * 1000)));
  els.inner.style.setProperty("--pix-mp-out-grow", String(Math.round((1 - share) * 1000)));
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
/**
 * Open the shared tag library, with Insert writing into THIS node's idea box.
 * The editor itself knows nothing about the node - it takes an accent, an
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
      const live = node._pixMpEls?.idea || ideaEl;
      insertTagAt(live, ctx, name, sym);
    },
  });
}

/**
 * Paint the highlight backdrop under the idea textarea.
 *
 * DOM only, so it is safe from the load path (Vue Compat #18).
 */
function renderIdeaTags(node) {
  const els = node?._pixMpEls;
  if (!els?.ideabd) return;
  els.ideabd.innerHTML = backdropHTML(els.idea.value);
}

export function buildFace(node, openPanel, openIdeaEditor) {
  injectCSS();
  injectTagCSS();   // the token colours + the autocomplete popup, shared with Prompt

  const root = el("div", "pix-mp-root");
  const inner = el("div", "pix-mp-inner");
  root.appendChild(inner);

  // ---- banner --------------------------------------------------------------
  const banner = el("div", "pix-mp-banner");
  const bLabel = el("span", "lbl", "");
  const bHint = el("span", "hint", "");
  const gear = el("button", "pix-mp-gear");
  gear.title = "Settings: the model, and what happens to it when the run finishes";
  gear.addEventListener("click", (e) => { e.stopPropagation(); openPanel(node); });
  banner.append(bLabel, bHint, gear);
  inner.appendChild(banner);

  // ---- idea ----------------------------------------------------------------
  const cap1 = el("div", "pix-mp-caprow");
  const expand = el("button", "pix-mp-expand", "Expand");
  expand.title = "Write the idea in a full-screen box";
  expand.addEventListener("click", (e) => {
    e.stopPropagation();
    openIdeaEditor(node);
  });
  cap1.append(el("span", "pix-mp-cap", "Your idea"), expand);
  // Two layers: the backdrop is the visible text, the textarea on top owns the
  // caret. See the CSS note for why the columns have to be kept identical.
  const ideawrap = el("div", "pix-mp-ideawrap");
  const ideabd = el("div", "pix-mp-ideabd");
  const idea = el("textarea", "pix-mp-idea");
  idea.placeholder = "a slow acoustic song about coming home in the rain";
  idea.spellcheck = true;
  ideawrap.append(ideabd, idea);
  inner.append(cap1, ideawrap);

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

  const grip = el("div", "pix-mp-grip");
  grip.title = "Drag to change how the height is shared. Double-click to reset.";
  grip.appendChild(el("i"));
  inner.appendChild(grip);

  // ---- length --------------------------------------------------------------
  const rowLen = el("div", "pix-mp-row");
  rowLen.appendChild(el("span", "pix-mp-rowlbl", "Length"));
  const lenChips = el("div", "pix-mp-chips");
  rowLen.appendChild(lenChips);
  const secs = el("input", "pix-mp-secs");
  secs.title = "Seconds. Set the SAME number on the music node: it treats this as "
    + "a ceiling, so a longer lyric is simply cut off part way through.";
  secs.addEventListener("focus", () => secs.select());
  secs.addEventListener("keydown", (e) => {
    // ComfyUI binds keys on the document; a field inside a node body has to
    // keep its own typing to itself.
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); secs.blur(); }
    if (e.key === "Escape") { e.preventDefault(); renderFace(node); secs.blur(); }
  });
  secs.addEventListener("blur", () => {
    commitNumber(secs, readState(node).seconds, MIN_SECONDS, MAX_SECONDS, (n) => {
      writeState(node, { seconds: n });
      renderFace(node);
      notifyGraphChanged();
    });
  });
  rowLen.appendChild(secs);
  inner.appendChild(rowLen);

  // ---- structure -----------------------------------------------------------
  const rowStruct = el("div", "pix-mp-row");
  rowStruct.appendChild(el("span", "pix-mp-rowlbl", "Verses"));
  const verseChips = el("div", "pix-mp-chips");
  rowStruct.appendChild(verseChips);
  const bridge = el("button", "pix-mp-tog", "Bridge");
  bridge.title = "Ask for a bridge: one different section, usually near the end.";
  bridge.addEventListener("click", (e) => {
    e.stopPropagation();
    writeState(node, { bridge: !readState(node).bridge });
    renderFace(node);
  });
  // "Break", not "Instr." - it sat next to the Instrumental MODE and the two
  // mean opposite-sized things: this asks for ONE section inside a sung song,
  // that one means no singing anywhere. The user called the pair confusing and
  // was right. The state key stays `instrumental`, so saved workflows are
  // untouched: this is a label, not a rename of the setting.
  const instr = el("button", "pix-mp-tog", "Break");
  instr.title = "Ask for one instrumental break inside the song, where the band "
    + "plays and nobody sings. It uses up singing time, so avoid it on a 30 "
    + "second song - in testing it cost the whole chorus.";
  instr.addEventListener("click", (e) => {
    e.stopPropagation();
    writeState(node, { instrumental: !readState(node).instrumental });
    renderFace(node);
  });
  rowStruct.append(bridge, instr);
  inner.appendChild(rowStruct);

  // ---- voice or instrumental ----------------------------------------------
  // A MODE, not another chip on the structure row, because it changes what the
  // node does rather than what it asks for: instrumental writes no lyrics at
  // all, so it runs the model ONCE and is about twice as fast. Putting it
  // beside Bridge and Instr. would have read as a third structure option, and
  // "Instr." (one instrumental SECTION) sitting next to "Instrumental" (no
  // singing anywhere) is exactly the confusion to avoid.
  const rowMode = el("div", "pix-mp-row");
  rowMode.appendChild(el("span", "pix-mp-rowlbl", "Music"));
  const modeChips = el("div", "pix-mp-chips");
  rowMode.appendChild(modeChips);
  inner.appendChild(rowMode);

  // ---- tip -----------------------------------------------------------------
  const tip = el("div", "pix-mp-tip");
  const tipK = el("b", null, "Song");
  const tipV = el("span", "pix-mp-tipv", "");
  tip.append(tipK, tipV);
  inner.appendChild(tip);

  // ---- readout -------------------------------------------------------------
  const cap2 = el("div", "pix-mp-caprow");
  const seg = el("div", "pix-mp-seg");
  const segCap = el("button", null, "Caption");
  segCap.title = "How the song should sound. Wire this to the music node's caption.";
  const segLyr = el("button", null, "Lyrics");
  segLyr.title = "The words that get sung. Wire this to the music node's lyrics.";
  seg.append(segCap, segLyr);
  const meta = el("span", "pix-mp-meta", "");
  cap2.append(seg, meta);
  const out = el("textarea", "pix-mp-out");
  out.readOnly = true;
  out.placeholder = "press Generate to write the song";
  inner.append(cap2, out);

  const showView = (view) => (e) => {
    e.stopPropagation();
    writeState(node, { view });
    renderFace(node);
  };
  segCap.addEventListener("click", showView(VIEW_CAPTION));
  segLyr.addEventListener("click", showView(VIEW_LYRICS));

  // ---- buttons -------------------------------------------------------------
  const acts = el("div", "pix-mp-acts");
  const reroll = el("button", "pix-mp-btn", "Re-roll");
  reroll.title = "Roll a new seed and run again, for a different song";
  reroll.addEventListener("click", (e) => {
    e.stopPropagation();
    // In FIXED mode a re-roll HAS to change the seed, or nothing differs and
    // ComfyUI serves the cached song - the button would look broken. That is a
    // deliberate user action, so dirtying the workflow is correct.
    //
    // In RANDOM mode it must NOT: seedForRun already rolls a fresh seed for
    // every run and ignores the stored one, so writing here would change
    // nothing about the result while still marking a clean workflow modified.
    if (readState(node).seed_mode !== SEED_RANDOM) {
      writeState(node, { seed: rollSeed() });
      renderFace(node);
    }
    app.queuePrompt?.(0, 1);
  });
  const copy = el("button", "pix-mp-btn", "Copy");
  copy.title = "Copy whichever of the two you are looking at";
  copy.addEventListener("click", (e) => {
    e.stopPropagation();
    copyText(out.value, copy);
  });
  // On the FACE rather than buried in settings, because it is a per-workflow
  // decision: off while you are only writing songs, on when this node sits in
  // front of a music model that wants the memory.
  const vram = el("button", "pix-mp-btn", "Free VRAM");
  vram.addEventListener("click", (e) => {
    e.stopPropagation();
    writeState(node, { release_model: !readState(node).release_model });
    renderFace(node);
  });
  const gen = el("button", "pix-mp-btn pix-mp-primary", "Generate");
  gen.title = "Queues the whole workflow, the same as pressing Run. Mute the music "
    + "part while you are writing, or every press renders a song too.";
  gen.addEventListener("click", (e) => {
    e.stopPropagation();
    app.queuePrompt?.(0, 1);
  });
  acts.append(reroll, copy, vram, el("span", "pix-mp-spacer"), gen);
  inner.appendChild(acts);

  // ---- seed, on the banner row of the buttons ------------------------------
  const seedwrap = el("div", "pix-mp-seedwrap");
  const seed = el("input", "pix-mp-seed");
  seed.title = "The seed. Click to type one.";
  // Kill the <input>'s intrinsic ~20-character width (ai-prompt.md #10), or it
  // sets a floor the flex cannot get under and the chip is a giant empty box
  // again. Flex sizes it from here on.
  seed.size = 1;
  seed.addEventListener("focus", () => seed.select());
  seed.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); seed.blur(); }
    if (e.key === "Escape") { e.preventDefault(); renderFace(node); seed.blur(); }
  });
  seed.addEventListener("blur", () => {
    commitNumber(seed, readState(node).seed, 0, Number.MAX_SAFE_INTEGER, (n) => {
      writeState(node, { seed: n });
      renderFace(node);
      notifyGraphChanged();
    });
  });
  const seedmode = el("button", "pix-mp-seedmode", "F");
  seedmode.addEventListener("click", (e) => {
    e.stopPropagation();
    const st = readState(node);
    writeState(node, {
      seed_mode: st.seed_mode === SEED_RANDOM ? SEED_FIXED : SEED_RANDOM,
    });
    renderFace(node);
  });
  seedwrap.append(seed, seedmode);

  // ---- tags, AFTER the seed on the same row -------------------------------
  // Where the user asked for it. It sits with the seed rather than up beside
  // the idea box because this row is the one that already carries the small
  // controls, and cap1 is the label-and-Expand line.
  const tagsBtn = el("button", "pix-mp-tags", "Tags");
  tagsBtn.title = "Your tag library: the same @tags Prompt Pixaroma uses";
  tagsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openTagLibrary(node, idea, acCtx());
  });
  // ON THE TAB ROW, between the Caption/Lyrics segment and the meta readout.
  //
  // It sat on the TIP line first, and the user reported the consequence:
  // turning Bridge and Instr. on made that line longer and pushed the seed off
  // the right of the node, out of sight. The CSS fix above stops the clipping,
  // but a line that GROWS with the settings was never the right home for a
  // control.
  //
  // The BUTTON row was the next try and measured worse: the row wrapped to two
  // lines (27px to 59px at the default width), and that height comes straight
  // out of the readout. This row holds two short buttons and a meta label that
  // already ellipsises, so it has the room, and the seed sits beside the answer
  // it produced.
  cap2.classList.add("has-seed");
  // Order matters and is the layout: segment, then the seed filling the gap,
  // then the status label, and Tags LAST so it sits hard against the right
  // edge - which is where it was asked to be.
  cap2.insertBefore(seedwrap, meta);
  cap2.appendChild(tagsBtn);

  // ---- mount ---------------------------------------------------------------
  const widget = node.addDOMWidget(WIDGET_TYPE, WIDGET_TYPE, root, {
    serialize: false,
    getMinHeight: () => WIDGET_MIN_H,
    hideOnZoom: false,
  });
  // ⚠️ TWO DIFFERENT FLAGS, and setting only one leaves a junk entry behind.
  // `widget.options.serialize` controls PROMPT inclusion; `widget.serialize`
  // (top level) controls WORKFLOW persistence, and LGraphNode.serialize reads
  // the top-level one. With only the option set the saved file carried
  // widgets_values [""] where the sibling's is [] - harmless today, but it is a
  // slot in an array that configure() walks positionally, which is exactly how
  // a later widget silently shifts everyone's values (Vue Compat #23).
  widget.serialize = false;
  // Adaptive, never a static true: canvasOnly hides the widget from the legacy
  // Parameters tab AND excludes it from the Nodes 2.0 body, so a fixed true
  // would leave the node an empty box in the new renderer (the house rule).
  applyAdaptiveCanvasOnly(widget);
  // Without this the mouse wheel stops zooming the canvas while the cursor is
  // over the node - nothing fails loudly, which is why seven nodes shipped
  // missing it (house convention #17).
  installCanvasZoomPassthrough(root);
  // Nodes 2.0 handles contextmenu on the node element, so without this a
  // right-click in the idea box opens the NODE menu and there is no way to
  // paste with the mouse (house convention #33).
  installNativeTextMenu(root);
  installNodeAccent(node, root);

  node._pixMpEls = {
    root, inner, banner, bLabel, bHint, gear, idea, ideawrap, ideabd, tagsBtn,
    grip, out, meta,
    lenChips, secs, verseChips, bridge, instr, modeChips, rowStruct, tip, tipV,
    seg, segCap, segLyr, seed, seedmode, seedwrap,
    acts, reroll, copy, vram, gen,
  };
  node._pixMpWidget = widget;

  installGrip(node, grip);
  // Pins a content floor ONLY while a resize handle is dragged, so the fixed
  // rows cannot be squashed out of the frame - and because it is gone the rest
  // of the time it never inflates node.size on a load (Nodes 2.0 recipe #2).
  node._pixMpFloorOff = installResizeFloor(root, () => WIDGET_MIN_H);

  // The two text columns must stay identical. Observe the TEXTAREA - never the
  // backdrop, whose padding syncColumns mutates, or it re-fires forever. A
  // ResizeObserver rather than onResize because that hook is not reliable for
  // DOM widgets (Vue Compat #13), and it also covers the renderer flip and the
  // textarea's own scrollbar appearing, which shrinks its content box.
  try {
    node._pixMpColRO = new ResizeObserver(() => syncColumns(idea, ideabd));
    node._pixMpColRO.observe(idea);
  } catch (e) { /* no observer: the focus listener still corrects it */ }

  applyShare(node);
  renderFace(node);
  return root;
}

/**
 * The grip: drag to move the line between the idea box and the readout.
 *
 * BOTH defences from house convention #20, because a real mouse can lose the
 * release (the pointer leaves the viewport, another element takes capture) and
 * the grip then follows the cursor forever. A synthetic event never reproduces
 * that, so a passing scripted test proves nothing here.
 */
function installGrip(node, grip) {
  let dragging = false;

  const end = () => {
    if (!dragging) return;          // idempotent: the guard can call this too
    dragging = false;
    // A drag ends on pointerup, and the pack-wide change net only listens for
    // click and change - so without this the new height is silently lost on
    // the next open (house convention #31 / #32).
    notifyGraphChanged();
  };

  grip.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    dragging = true;
    try { grip.setPointerCapture(e.pointerId); } catch (_) { /* older build */ }
  });

  grip.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    // The release can go missing; this is the same guard js/align relies on.
    if (!(e.buttons & 1)) { end(); return; }
    const els = node._pixMpEls;
    if (!els?.inner) return;
    const box = els.inner.getBoundingClientRect();
    if (box.height <= 0) return;
    // A RATIO, not pixels: a rect inside a node body is in SCREEN pixels
    // (element px times the canvas zoom), so a stored pixel height renders
    // wrong at every zoom but the one it was set at. Dividing by the box height
    // takes the zoom out of both sides.
    const share = (e.clientY - box.top) / box.height;
    writeState(node, {
      idea_share: Math.max(IDEA_SHARE_MIN, Math.min(IDEA_SHARE_MAX, share)),
    });
    applyShare(node);
  });

  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) {
    grip.addEventListener(ev, end);
  }

  grip.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    writeState(node, { idea_share: IDEA_SHARE_DEFAULT });
    applyShare(node);
    notifyGraphChanged();
  });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function paintChips(host, values, current, onPick, labelOf) {
  // Rebuilt rather than diffed: a handful of buttons, and a stale listener on a
  // reused node is a whole class of bug not worth opening for this.
  host.textContent = "";
  for (const value of values) {
    const chip = el("button", "pix-mp-chip", labelOf ? labelOf(value) : String(value));
    if (value === current) chip.classList.add("is-on");
    chip.addEventListener("click", (e) => { e.stopPropagation(); onPick(value); });
    host.appendChild(chip);
  }
}

export function renderFace(node) {
  const els = node?._pixMpEls;
  if (!els) return;
  const st = readState(node);
  const last = readLast(node);

  // ---- banner --------------------------------------------------------------
  const onWire = slotConnected(node, "clip");
  els.banner.classList.remove("is-warn", "is-mute");
  if (onWire) {
    els.bLabel.textContent = "Model on wire";
    els.bLabel.title = "A model is wired into the clip input, and it is used "
      + "instead of the one in the settings.";
  } else if (st.model) {
    els.bLabel.textContent = shortModel(st.model);
    els.bLabel.title = st.model;
  } else {
    els.bLabel.textContent = "No model - your text passes straight through";
    els.bLabel.title = "Pick one from the gear. Until then both outputs carry "
      + "your text unchanged, so the graph keeps working.";
    els.banner.classList.add("is-mute");
  }
  // Two runs on one load is the cost, and saying so before the user presses
  // anything is the point: it is the one surprising thing about this node.
  // Instrumental writes no lyrics, so it is ONE - and the count has to follow
  // the switch or it is telling the user the wrong price for what they picked.
  els.bHint.textContent = willGenerate(node)
    ? (st.no_vocals ? "1 run" : "2 runs")
    : wiredSummary(node);

  // ---- idea ----------------------------------------------------------------
  if (els.idea.value !== st.idea) els.idea.value = st.idea;
  // The highlight has to follow EVERY path that can change the idea - typing, an
  // Insert from the library, the full-screen editor, and a workflow load.
  renderIdeaTags(node);

  // ---- controls ------------------------------------------------------------
  const chipValues = SECONDS_CHIPS.slice();
  paintChips(els.lenChips, chipValues,
             chipValues.includes(st.seconds) ? st.seconds : null,
             (n) => {
               writeState(node, { seconds: n });
               renderFace(node);
             },
             (n) => `${n}s`);
  if (document.activeElement !== els.secs) els.secs.value = String(st.seconds);

  const verseValues = [VERSES_AUTO];
  for (let i = 1; i <= MAX_VERSES; i++) verseValues.push(i);
  paintChips(els.verseChips, verseValues, st.verses, (n) => {
    writeState(node, { verses: n });
    renderFace(node);
  }, (n) => (n === VERSES_AUTO ? "Auto" : String(n)));

  els.bridge.classList.toggle("is-on", st.bridge);
  els.instr.classList.toggle("is-on", st.instrumental);

  // Voice / Instrumental. paintChips gives it the same look as the verse and
  // length rows, so it reads as one of the node's pickers rather than a new
  // kind of control.
  paintChips(els.modeChips, [false, true], st.no_vocals, (v) => {
    writeState(node, { no_vocals: v });
    renderFace(node);
    notifyGraphChanged();
  }, (v) => (v ? "Instrumental" : "Voice"));

  // With no singing there are no sections to shape, so the structure row is
  // DIMMED rather than hidden: hiding it would make the node jump height on a
  // click, and a control that vanishes is harder to find again than one that
  // is visibly not applicable. It stays clickable, because an explicit choice
  // still wins here and the settings are kept for when Voice comes back.
  els.rowStruct.classList.toggle("is-dim", st.no_vocals);
  els.rowStruct.title = st.no_vocals
    ? "Instrumental music has no verses or choruses to ask for. These come back "
      + "when you switch to Voice."
    : "";

  // ---- tip + seed ----------------------------------------------------------
  els.tipV.textContent = songSummary(node);
  els.tip.title = st.verses
    ? "Verses are a request, not a promise: one and two come back exactly, three "
      + "sometimes returns two. Auto lets the length decide, which is the most "
      + "reliable way to run it."
    : "The length decides the shape: under forty seconds a verse and a chorus, "
      + "about a minute adds a second verse, about two minutes adds a bridge.";
  if (document.activeElement !== els.seed) {
    els.seed.value = String(displaySeed(node));
  }
  els.seedmode.textContent = st.seed_mode === SEED_RANDOM ? "R" : "F";
  els.seedmode.classList.toggle("is-on", st.seed_mode === SEED_RANDOM);
  els.seedmode.title = st.seed_mode === SEED_RANDOM
    ? "Random: a new seed every run, so every run is a different song."
    : "Fixed: the same seed every run, so an unchanged node is cached and Run is "
      + "instant.";

  // ---- readout -------------------------------------------------------------
  const showing = st.view === VIEW_LYRICS ? VIEW_LYRICS : VIEW_CAPTION;
  els.segCap.classList.toggle("is-on", showing === VIEW_CAPTION);
  els.segLyr.classList.toggle("is-on", showing === VIEW_LYRICS);
  const text = showing === VIEW_LYRICS ? last.lyrics : last.caption;
  if (els.out.value !== text) els.out.value = text;
  els.out.classList.toggle("is-error", last.error);
  els.meta.textContent = last.meta;
  els.meta.classList.toggle("is-error", last.error);
  els.meta.title = last.meta;

  // ---- buttons -------------------------------------------------------------
  els.copy.disabled = !text || last.error;
  els.vram.classList.toggle("is-on", st.release_model);
  els.vram.title = onWire
    ? "Ignored while a model is wired in: that one belongs to the loader you "
      + "placed, so it is not this node's to unload."
    : "Unload the model when this node finishes. In a chain it belongs only on "
      + "the last node using that model.";
  els.vram.classList.toggle("is-inert", onWire);
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
export function applyResult(node, payload, elapsed) {
  const words = (payload?.caption_words || 0) + (payload?.lyrics_words || 0);
  const bits = [];
  if (payload?.status) bits.push(String(payload.status));
  else if (payload?.generated) bits.push(`${words} words`);
  if (Number.isFinite(elapsed)) bits.push(`${elapsed}s`);
  writeLastFromPayload(node, payload, bits.join(" · "));
  renderFace(node);
}

function writeLastFromPayload(node, payload, meta) {
  // The UI reports the wire it SAW; graphToPrompt drops an input whose origin
  // node is muted or bypassed, so the banner can say "Model on wire" while
  // Python never received one. Fix the READOUT, not the wire check.
  const muted = slotConnected(node, "clip") && payload?.used_clip === false;
  writeLast(node, {
    caption: String(payload?.caption ?? ""),
    lyrics: String(payload?.lyrics ?? ""),
    meta: muted ? "the wired model was muted" : meta,
    error: false,
    muted,
    seed: payload?.seed,
  });
}

export function applyError(node, message) {
  writeLast(node, {
    caption: "",
    lyrics: String(message || "something went wrong"),
    meta: "failed",
    error: true,
    muted: false,
    seed: readState(node).seed,
  });
  // Send the reader to the box that actually holds the message.
  writeState(node, { view: VIEW_LYRICS });
  renderFace(node);
}

export function destroyFace(node) {
  try { node._pixMpFloorOff?.(); } catch (_) { /* already gone */ }
  node._pixMpFloorOff = null;
  try { node._pixMpColRO?.disconnect(); } catch (_) { /* already gone */ }
  node._pixMpColRO = null;
  // The autocomplete popup and the library are body-level singletons, so a
  // deleted node must take its own down or they hang there pointing at nothing.
  try { closeAC(); } catch (_) { /* already gone */ }
  try { closeLibraryEditorFor(node); } catch (_) { /* already gone */ }
  node._pixMpEls = null;
  node._pixMpWidget = null;
}

