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

const CSS_ID = "pix-prompt-each-css";

// The float offset, in px above the DOM widget's own top. MEASURED on this node
// in BOTH renderers rather than guessed, and the same number works in each:
//   Classic:   widget top at node-local 66, slot rows at 14 / 34 / 54, so the
//              left half of 24..64 is dead space and -22 lands on the last row.
//   Nodes 2.0: slot rows at +32 / +52 / +72 from the node top, and -22 lands on
//              the same last row, horizontally clear of the labels (pill spans
//              x 80..142, the "total" label starts at 339).
// Calibrated to THIS slot layout (1 input / 3 outputs). Add or remove a slot and
// these must be re-measured - the recipe is in .claude/patterns/prompt-each.md.
const BAND_TOP = -22;
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
  padding: 6px 8px 8px 8px;
  box-sizing: border-box;
  font-family: inherit;
  color: #ddd;
  /* the floated band is absolutely positioned against this */
  position: relative;
}

/* The box grows with the node; it is the ONLY child allowed to shrink, and its
   floor is a real min-height rather than the flex automatic minimum, which any
   page stylesheet can delete with a "min-height:0" (convention #35). */
.pix-each-fieldwrap {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 72px;
}
/* attachLineNumbers inserts its own wrapper around the textarea, so the fill
   has to be handed down through it. */
.pix-each-fieldwrap > .pix-ln-wrap {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}
.pix-each-fieldwrap > .pix-ln-wrap > textarea { flex: 1 1 auto; min-height: 0; }

/* Interior matches Text / Prompt Pack / Prompt Multi exactly, so the pack reads
   as one design (node UI convention #3). */
.pix-each-ta {
  width: 100%;
  resize: none;
  background: #1d1d1d;
  border: 1px solid #333;
  border-radius: 4px;
  color: #e0e0e0;
  font: 12px monospace;
  line-height: 1.5;
  padding: 6px 8px;
  outline: none;
  box-sizing: border-box;
  overflow-y: auto;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
.pix-each-ta:focus { border-color: ${ACC}; }
.pix-each-ta::placeholder { color: rgba(255,255,255,0.32); font-style: italic; }
/* Wired: the box shows what arrived and stops taking typing. */
.pix-each-ta.is-wired { color: #9a9a9a; background: #202020; cursor: default; }

/* The count pill lives in the empty band beside the slot dots, so it costs no
   height AND never sits on top of the text. It is floated up out of the widget
   flow into that dead space in BOTH renderers - measured, see placeBand.
   pointer-events:none on the band so the painted dots and labels underneath
   stay clickable and wireable; the band is first in the root so that if the
   float is ever removed it degrades to a strip ABOVE the box, not over it. */
.pix-each-band {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  min-width: 0;
}
.pix-each-band.floated {
  position: absolute;
  pointer-events: none;
  z-index: 2;
}
.pix-each-band.floated > * { pointer-events: auto; }

.pix-each-count {
  flex: 0 0 auto;
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

const PLACEHOLDER =
  "One prompt per line.\n" +
  "Run once and you get one image per line.\n" +
  "\n" +
  "a [red|blue] car  ->  two prompts";

// Builds the DOM. Returns { root, ta, count, buttons } so index.js can wire it
// without querying selectors back out of the tree.
export function buildRoot() {
  const root = el("div", "pix-each-root");

  const fieldwrap = el("div", "pix-each-fieldwrap");
  const ta = el("textarea", "pix-each-ta");
  ta.placeholder = PLACEHOLDER;
  ta.spellcheck = false;
  fieldwrap.appendChild(ta);

  // The band is FIRST in the root so that, in whichever renderer cannot float
  // it, it degrades to a small strip above the box rather than on top of it.
  const band = el("div", "pix-each-band");
  const count = el("div", "pix-each-count");
  band.appendChild(count);
  root.appendChild(band);
  root.appendChild(fieldwrap);

  const actions = el("div", "pix-each-actions");
  const mk = (label, cls, title) => {
    const b = el("button", "pix-each-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (title) b.title = title;
    actions.appendChild(b);
    return b;
  };
  const copyBtn = mk("Copy all", null, "Copy every prompt to the clipboard");
  const replaceBtn = mk("Replace", null,
    "Paste over everything in the box. This is how you get a long list in at once.");
  const clearBtn = mk("Clear", null, "Empty the box");
  const gearBtn = mk("", "pix-each-gear", "Prompt Each settings");
  root.appendChild(actions);

  return { root, band, fieldwrap, ta, count, actions, copyBtn, replaceBtn, clearBtn, gearBtn };
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
      band.style.top = BAND_TOP + "px";
      band.style.left = BAND_RSV_L + "px";
      band.style.right = BAND_RSV_R + "px";
    } else {
      band.style.top = "";
      band.style.left = "";
      band.style.right = "";
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
  const noun = split === "blank" ? "block" : "line";

  count.classList.toggle("is-capped", !!truncated);

  if (wiredState === "replace") {
    count.classList.remove("is-empty");
    count.textContent = "using the wired text";
    count.title =
      "The prompts are coming from the node wired into the text input, so the "
      + "count is only known once the workflow runs.";
    return;
  }

  count.classList.toggle("is-empty", total === 0 && wiredState !== "add");

  if (wiredState === "add") {
    count.innerHTML = "";
    count.appendChild(el("b", null, String(total)));
    count.appendChild(document.createTextNode(" typed + the wired text"));
    count.title =
      "These " + total + " plus however many arrive on the text input. Settings "
      + "has a Replace option if you want only the wired ones.";
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

// `wiredState` is "replace", "add", or null when nothing is wired.
//
// In Replace mode the box goes read-only and dims: what is typed is NOT what
// runs, and an editable-looking box full of text that the node is ignoring is
// the kind of quiet lie that costs somebody an afternoon. The text is KEPT, not
// cleared, so unplugging the wire brings it straight back. Same wired-text lock
// Text Overlay already uses.
export function applyState(parts, st, wiredState) {
  const { ta } = parts;
  if (!ta) return;
  if (ta.value !== st.text) ta.value = st.text;
  const locked = wiredState === "replace";
  ta.readOnly = locked;
  ta.classList.toggle("is-wired", locked);
  ta.title = locked
    ? "Ignored while text is wired in: the prompts come from that node instead. "
      + "Unplug it, or switch to Add in the settings, to use what is typed here."
    : "";
}
