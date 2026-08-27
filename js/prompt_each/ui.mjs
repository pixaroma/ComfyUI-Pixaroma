// Prompt Each Pixaroma - the node face.
//
// One numbered box, one row of buttons, and a count pill floated up into the
// empty band beside the slot dots. The pill costs no height there AND does not
// sit on the text - it was in the box's own corner first, and the overlap was
// the first thing the user spotted.
//
// CSS prefix is "pix-each-", verified unique across the pack. Convention #38:
// two nodes sharing a prefix share a namespace, and the winner is decided by
// whichever node happened to be created first - which is how Monitor silently
// restyled Prompt Multi's rows for weeks.

import { ACC } from "../shared/node_settings.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";

const CSS_ID = "pix-prompt-each-css";

// The body's floor, and it must be the height of ONE ROW - not a round number
// left over from an earlier layout. MEASURED: row 79 + the -6 it is pulled up by
// + gap 6 + action bar 23 + 8 of bottom padding = 110.
//
// It was still 118 (the old floor from when this node had a big textarea), and
// because contentHeight returns max(floor, measured), every ONE-ROW node was
// padded by 8px it did not need - which is exactly why a one-row node looked
// bottom-heavy while a two-row one, which clears the floor, looked right.
export const WIDGET_MIN_H = 110;

// The float offset, in px above the DOM widget's own top. MEASURED on this node
// rather than guessed. The band is TWO stacked rows, so it fills the dead space
// beside BOTH spare slot rows instead of crowding onto one:
//   Copy + Paste  land on the "index" row (node-local y 34)
//   the counter   lands on the "total" row (y 54), with the whole width to
//                 itself, which is what it needs when it reads
//                 "12 rows -> 48 prompts"
// MEASURED node-local, not derived: the slot dots are at y 14 / 34 / 54 and the
// DOM widget starts at y 76 (NOT 66 - that was `last_y`, which is not the same
// thing, and the 10px error put both band rows visibly 9px below their labels).
// A 17px row starting at 26 centres on "index"; the next, after a 3px gap,
// centres on "total".
// Calibrated to THIS slot layout (1 input / 3 outputs). Add or remove a slot and
// it must be re-measured - the recipe is in .claude/patterns/prompt-each.md.
//
// THE TWO RENDERERS NEED DIFFERENT OFFSETS, and an earlier comment here claiming
// one constant served both was simply wrong: it had been checked against the
// node FRAME (which it was inside, in both) instead of against the SLOTS (which
// is the actual requirement). MEASURED against the dots, at 1.5 zoom:
//   Classic    index 406 / total 436, band rows 406 / 436  -> delta 0
//   Nodes 2.0  index 403 / total 433, band rows 391 / 421  -> 12 screen px high,
//              which is 8 element px, uniform on both rows
// The slot PITCH is 20 element px in both, so only the start differs; the band's
// internal 3px gap is already right and must not be touched to compensate.
const BAND_TOP = -50;
const BAND_TOP_VUE = -42;
const BAND_RSV_L = 8;   // line up with the text box's left edge
const BAND_RSV_R = 76;  // keep clear of the prompt / index / total labels

// NOTE: this string is a JS template literal, so a backtick anywhere inside it
// - including in a comment - terminates it and every Pixaroma node renders with
// zero widgets. Use "double quotes" in these comments, and run
// node --input-type=module --check after editing (CLAUDE.md convention #35).
const CSS = `
.pix-each-root {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 8px 8px 8px;
  box-sizing: border-box;
  font-family: inherit;
  color: #ddd;
  /* the floated band is absolutely positioned against this */
  position: relative;
}


/* The count pill lives in the empty band beside the slot dots, so it costs no
   height AND never sits on top of the text. It is floated up out of the widget
   flow into that dead space in BOTH renderers - measured, see placeBand.
   pointer-events:none on the band so the painted dots and labels underneath
   stay clickable and wireable; the band is first in the root so that if the
   float is ever removed it degrades to a strip ABOVE the box, not over it. */
/* align-items:stretch + a content-sized width is what makes the counter end
   exactly where Paste ends: the band is as wide as its widest row, and both
   rows take that width. When the counter reads something long it grows the band
   instead, and Copy/Paste simply stay their own size inside it. */
.pix-each-band {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: max-content;
  gap: 3px;
  flex-shrink: 0;
  min-width: 0;
}
.pix-each-band.floated {
  position: absolute;
  pointer-events: none;
  z-index: 2;
}
.pix-each-band.floated > * { pointer-events: auto; }

/* Copy and Paste ride in the band, so the two occasional actions cost no height
   and the main row is left to the three buttons people know from Prompt Stack. */
.pix-each-views { display: flex; gap: 3px; flex: 0 0 auto; }
.pix-each-viewpill {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 3px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  font: 10px sans-serif;
  padding: 2px 8px;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
.pix-each-viewpill:hover { border-color: ${ACC}; color: #ddd; }
.pix-each-viewpill:disabled, .pix-each-viewpill:disabled:hover {
  border-color: rgba(255,255,255,0.08); color: rgba(255,255,255,0.28); cursor: default;
}

/* ── the Rows view ───────────────────────────────────────────────────────── */
/* "flex: 0 1 auto" is the whole trick, and each of the three values was earned:
   basis AUTO so the box is its CONTENT height and the node can be grown to fit
   it (an earlier "1 1 0" made it always fill the leftover space, so it always
   showed a scrollbar and clipped the last row); grow 0 so a node bigger than
   its rows leaves trailing space instead of stretching this box, which would
   inflate the measure that grow-to-content reads back; shrink 1 + min-height 0
   + overflow-y auto so that when the node IS too small - reopened at a saved
   smaller size, or dragged down - this box scrolls INSTEAD of the body painting
   outside the node frame. A DOM widget in the Classic renderer is not clipped
   by the node, so "it just overflows" is not a graceful failure, it is 141px of
   rows and buttons drawn on the canvas below the node. The rows themselves keep
   flex-shrink:0, so the container scrolls and no row is ever crushed. */
/* Pulled UP into the slot area. LiteGraph starts the widget at node-local 76
   while the "total" label ends at 64, so without this there is 20px of nothing
   between the counter and the first row. -6 puts the rows at 70: half the gap
   back, and still 6px clear of the label above. contentHeight counts child
   margins, so this shortens the NODE rather than just moving content around. */
.pix-each-rows {
  margin-top: -6px;
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
/* BOTH declarations, and they defend different things: flex-shrink stops the
   row shrinking below its flex base, min-height stops an explicit height (from
   a page stylesheet, or ComfyUI's own collapsed-node resize probe) winning
   outright. Prompt Multi needed exactly this pair twice (prompt-multi.md #18). */
.pix-each-row {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-height: fit-content;
  gap: 4px;
  padding: 6px;
  border-radius: 4px;
  background: #232323;
  border: 1px solid #2e2e2e;
  transition: opacity 0.12s ease;
}
.pix-each-row.is-off { opacity: 0.45; }
.pix-each-rows.is-wired { opacity: 0.5; }
.pix-each-row.is-dragging { opacity: 0.4; }
.pix-each-row.is-drop-above { box-shadow: 0 -2px 0 0 ${ACC}; }
.pix-each-row.is-drop-below { box-shadow: 0 2px 0 0 ${ACC}; }

.pix-each-rowhead { display: flex; align-items: center; gap: 6px; min-height: 18px; }
.pix-each-rowsp { flex: 1; }
.pix-each-handle {
  cursor: grab; color: #888; font-size: 13px; line-height: 13px;
  user-select: none; padding: 0 1px; letter-spacing: -2px;
}
.pix-each-handle:hover { color: #ccc; }
.pix-each-handle:active { cursor: grabbing; }
.pix-each-rownum {
  font: 10px monospace; color: #6f6f6f; min-width: 14px;
  font-variant-numeric: tabular-nums; user-select: none;
}
.pix-each-toggle {
  min-width: 32px; height: 17px; border-radius: 9px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.15);
  cursor: pointer; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  font: 600 8.5px sans-serif; letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.65);
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.pix-each-toggle:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.35);
  color: #fff;
}
.pix-each-toggle.on { background: ${ACC}; border-color: ${ACC}; color: #fff; }
.pix-each-toggle.on:hover { filter: brightness(1.08); }
.pix-each-del {
  width: 17px; height: 17px; border-radius: 3px; flex-shrink: 0;
  background: transparent; border: none; color: #888;
  cursor: pointer; font-size: 12px; line-height: 12px; padding: 0;
}
.pix-each-del:hover {
  color: ${ACC};
  background: color-mix(in srgb, ${ACC} 12%, transparent);
}
.pix-each-rowta {
  width: 100%; min-height: 30px; max-height: 140px; resize: none;
  background: #1d1d1d; border: 1px solid #333; border-radius: 4px;
  color: #e0e0e0; font: 12px monospace; line-height: 1.4;
  padding: 5px 7px; outline: none; box-sizing: border-box;
  overflow-y: auto; white-space: pre-wrap; overflow-wrap: break-word;
}
.pix-each-rowta:focus { border-color: ${ACC}; }
.pix-each-rowta::placeholder { color: rgba(255,255,255,0.28); font-style: italic; }


.pix-each-count {
  flex: 0 0 auto;
  box-sizing: border-box;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  user-select: none;
  font: 10px sans-serif;
  letter-spacing: 0.02em;
  padding: 2px 7px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.10);
  color: rgba(255, 255, 255, 0.62);
  white-space: nowrap;
}
.pix-each-count b { color: ${ACC}; font-weight: 700; }
/* Nothing to run: the node will raise at Run time, so say so before that. */
.pix-each-count.is-empty { color: #d98a5c; border-color: rgba(217, 138, 92, 0.45); }
.pix-each-count.is-empty b { color: #d98a5c; }
/* The cap bit. Same treatment: it is a warning, not an error. */
.pix-each-count.is-capped { color: #d98a5c; border-color: rgba(217, 138, 92, 0.45); }

/* Action row mirrors Prompt Pack / Text: border-box, min-width 86, full accent
   hover, wraps rather than spilling out of the narrower Nodes 2.0 body. */
.pix-each-actions {
  display: flex;
  flex-wrap: wrap;
  flex-shrink: 0;
  gap: 4px;
  align-self: flex-start;
  user-select: none;
}
.pix-each-btn {
  box-sizing: border-box;
  min-width: 86px;
  user-select: none;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.78);
  cursor: pointer;
  font: 11px sans-serif;
  padding: 4px 12px;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
.pix-each-btn:hover {
  background: ${ACC};
  border-color: ${ACC};
  color: #fff;
}
.pix-each-btn:disabled,
.pix-each-btn:disabled:hover {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.28);
  cursor: default;
}
/* Higher specificity than :hover so the green wins while the cursor is still
   on the button after the click (node UI convention #2). */
.pix-each-btn.is-flashing,
.pix-each-btn.is-flashing:hover {
  background: #3ec371;
  border-color: #3ec371;
  color: #fff;
}

/* The gear is the LAST button in the row, which is where every other Pixaroma
   node puts it. Square, and it draws the bundled SVG as a mask rather than the
   gear emoji - an emoji is drawn by the operating system, so it is a different
   shape and baseline on Windows, Mac and Linux (convention #28). */
.pix-each-gear {
  min-width: 28px;
  padding: 4px 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.pix-each-gear::before {
  content: "";
  display: block;
  width: 14px;
  height: 14px;
  background: #bbb;
  -webkit-mask: url("/pixaroma/assets/icons/note/gear.svg") center/contain no-repeat;
  mask: url("/pixaroma/assets/icons/note/gear.svg") center/contain no-repeat;
}
.pix-each-gear:hover::before { background: #fff; }
`;

export function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const s = document.createElement("style");
  s.id = CSS_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Builds the DOM. Returns { root, ta, count, buttons } so index.js can wire it
// without querying selectors back out of the tree.
export function buildRoot() {
  const root = el("div", "pix-each-root");

  // The band floats into the slot dead space, so everything in it is free
  // height: the two occasional actions and the live count.
  const band = el("div", "pix-each-band");
  const views = el("div", "pix-each-views");
  const copyBtn = el("button", "pix-each-viewpill", "Copy");
  copyBtn.type = "button";
  copyBtn.title = "Copy every prompt to the clipboard, one per line";
  const pasteBtn = el("button", "pix-each-viewpill", "Paste");
  pasteBtn.type = "button";
  pasteBtn.title =
    "Replace every row with the clipboard, one prompt per line. This is how a "
    + "long list gets in from a spreadsheet or a text file.";
  views.appendChild(copyBtn);
  views.appendChild(pasteBtn);
  band.appendChild(views);
  const count = el("div", "pix-each-count");
  band.appendChild(count);
  root.appendChild(band);

  const rows = el("div", "pix-each-rows");
  root.appendChild(rows);

  // Three buttons and the gear, word for word Prompt Stack's, because people
  // already have the habit. Three plus the gear is also exactly what fits on one
  // line at the node's minimum width.
  const actions = el("div", "pix-each-actions");
  const mk = (label, cls, title) => {
    const b = el("button", "pix-each-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (title) b.title = title;
    actions.appendChild(b);
    return b;
  };
  const addBtn = mk("Add row", null, "Append an empty row at the end of the list");
  const clearAllBtn = mk("Clear all", null,
    "Empty the text in every row (keeps the rows and their switches)");
  const resetBtn = mk("Reset", null, "Reset to one empty row, switched on");
  const gearBtn = mk("", "pix-each-gear", "Prompt Each settings");
  root.appendChild(actions);

  return { root, band, views, rows, count, actions,
           copyBtn, pasteBtn, addBtn, clearAllBtn, resetBtn, gearBtn };
}

// Float the count band up into the slot dead space. Writes ONLY DOM
// style - never node.size, properties or slots - so it can never dirty a saved
// workflow (Vue Compat #18) and is safe to call on the load path.
export function placeBand(parts, floatIt) {
  const { band } = parts;
  if (!band) return;
  try {
    band.classList.toggle("floated", !!floatIt);
    if (floatIt) {
      // Read the renderer LIVE, never cached: the setting can flip under a live
      // node, and index.js re-calls this from onRendererChange for exactly that.
      band.style.top = (isVueNodes() ? BAND_TOP_VUE : BAND_TOP) + "px";
      band.style.left = BAND_RSV_L + "px";
      // a CEILING, not a width: the band sizes to its widest row so the counter
      // can end where Paste ends, and this only stops a long count running under
      // the prompt / index / total labels on the right.
      band.style.right = "";
      band.style.maxWidth = "calc(100% - " + (BAND_RSV_L + BAND_RSV_R) + "px)";
    } else {
      band.style.top = "";
      band.style.left = "";
      band.style.right = "";
      band.style.maxWidth = "";
    }
  } catch {
    // A future frontend that breaks the float should cost a tidy row, never the
    // node: leaving the band in flow is a complete, working fallback.
    band.classList.remove("floated");
  }
}

// The count pill. `pieces` is what was typed, `total` is what will run - showing
// both is the whole feedback loop for bracket expansion, because it is the only
// place a person can see that one line became six BEFORE pressing Run.
//
// When text is WIRED it says so instead of counting. The browser genuinely
// cannot know what will arrive on that wire - it is produced upstream at
// execution time - and a count that guessed would be worse than no count,
// because a number on screen reads as a fact.
export function updateCount(parts, result, split, wiredState) {
  const { count } = parts;
  if (!count) return;
  const { prompts, pieces, truncated } = result;
  const total = prompts.length;
  const noun = "row";   // they are rows on the face now, whatever the split is

  count.classList.toggle("is-capped", !!truncated);

  // The browser genuinely cannot know what will arrive on the wire - it is
  // produced upstream at execution time - and a guessed number would read as a
  // fact, so say what is known and stop there.
  count.classList.toggle("is-empty", total === 0 && !wiredState);

  if (wiredState) {
    count.innerHTML = "";
    count.appendChild(el("b", null, String(total)));
    count.appendChild(document.createTextNode(" here + the wired text"));
    count.title =
      "These " + total + " rows, then however many prompts arrive on the text "
      + "input. Press Reset if you want only the wired ones.";
    return;
  }

  if (total === 0) {
    count.textContent = "no prompts yet";
    count.title = "Type at least one prompt, or wire text into the node.";
    return;
  }
  const promptWord = total === 1 ? "prompt" : "prompts";
  if (pieces === total) {
    count.innerHTML = "";
    count.appendChild(el("b", null, String(total)));
    count.appendChild(document.createTextNode(" " + promptWord));
  } else {
    count.innerHTML = "";
    count.appendChild(
      document.createTextNode(pieces + " " + noun + (pieces === 1 ? "" : "s") + " → "),
    );
    count.appendChild(el("b", null, String(total)));
    count.appendChild(document.createTextNode(" " + promptWord));
  }
  count.title = truncated
    ? "Stopped at the limit in the node's settings. Raise it there to run more."
    : "This Run will produce " + total + " " + promptWord + ", one after another.";
}

// The wired input is ADDITIVE, so the rows are never ignored and never locked -
// this only clears any lock a previous build left on a live node.
export function applyState(parts, st, wiredState) {
  parts.rows.classList.remove("is-wired");
  for (const ta of parts.rows.querySelectorAll(".pix-each-rowta")) {
    if (ta.readOnly) ta.readOnly = false;
    if (ta.title) ta.title = "";
  }
}

// How tall the body actually needs to be.
//
// NOT the shared measureRootContent: that counts every laid-out child, and the
// count band is position:absolute, so it would add its own height to a node it
// takes no space in.
//
// scrollHeight, not offsetHeight, when a child is being SQUEEZED. The rows box
// is allowed to shrink and scroll so the body can never paint outside the node
// frame (a DOM widget in Classic is not clipped by the node), which means
// offsetHeight reports the space it was GIVEN, not the space it wants - and
// growing the node from that number is circular: it measures 254, decides it
// fits, and the scrollbar never goes away.
//
// Rounded to a 4px grid, because sub-pixel jitter in a grow-only path
// accumulates and would creep node.size bigger on every workflow switch.
export function contentHeight(root) {
  if (!root) return WIDGET_MIN_H;
  let h = 0;
  let count = 0;
  for (const child of root.children) {
    if (child.offsetParent === null) continue;
    if (getComputedStyle(child).position === "absolute") continue;
    const ccs = getComputedStyle(child);
    h += Math.max(child.offsetHeight, child.scrollHeight)
       + (parseFloat(ccs.marginTop) || 0) + (parseFloat(ccs.marginBottom) || 0);
    count += 1;
  }
  const cs = getComputedStyle(root);
  const gap = parseFloat(cs.rowGap || cs.gap) || 0;
  if (count > 1) h += gap * (count - 1);
  h += (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  return Math.max(WIDGET_MIN_H, Math.round(h / 4) * 4);
}
