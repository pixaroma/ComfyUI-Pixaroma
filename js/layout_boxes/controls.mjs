// Layout Boxes Pixaroma - the controls both surfaces share (the node face and
// the big view): the shape chip, undo / redo / clear, and the numbered list of
// boxes with their type switch, words and description.
//
// Built ONCE per surface; sync() only flips classes and text, so a click never
// rebuilds the button it came from. The list is the one thing rebuilt, and only
// on a structural change (a box added, deleted, retyped, reordered, undone),
// never while typing - a rebuild would steal the field's focus mid-word.

import { passComfyShortcut } from "../shared/text_shortcuts.mjs";
import { followSpellcheck } from "../shared/spellcheck.mjs";
import { MAX_DESC, MAX_TEXT, inkOn, objTag, readState, rgbaOf } from "./core.mjs";
import {
  clearBoxes, deleteBox, redo, refresh, reorderBox, select, setField, setType, uiState, undo,
} from "./actions.mjs";
import { canvasDims } from "./source.mjs";

const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const ICON_UNDO = svg(`<path d="M9 7L4 12l5 5M4 12h9a6 6 0 010 12h-2" ${S} transform="translate(0,-3)"/>`);
const ICON_REDO = svg(`<path d="M15 7l5 5-5 5M20 12h-9a6 6 0 000 12h2" ${S} transform="translate(0,-3)"/>`);
const ICON_CLEAR = svg(`<path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" ${S}/>`);
const ICON_EXPAND = svg(`<path d="M4 10V4h6M20 14v6h-6M4 4l6 6M20 20l-6-6" ${S}/>`);
const ICON_UP = svg(`<path d="M6 15l6-6 6 6" ${S}/>`);
const ICON_DOWN = svg(`<path d="M6 9l6 6 6-6" ${S}/>`);

const FROM_TITLE = {
  picture: "The canvas has the shape of the background picture.",
  own: "The canvas shape comes from width and height.",
  wired: "The canvas shape comes from the width and height wired in.",
  run: "The wired width or height can't be read before Run, so the canvas uses the size from the last run.",
  unknown: "The wired width or height can't be read before Run, so the canvas uses the node's own numbers until you run once. Boxes are kept as parts of the canvas, so they stay right either way.",
};

function btn(cls, title, html) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.title = title;
  if (html) b.innerHTML = html;
  return b;
}

/** The canvas-shape chip. Returns sync(). */
export function buildShapeChip(host) {
  const chip = document.createElement("span");
  chip.className = "pix-lyb-chip";
  host.appendChild(chip);
  return (node) => {
    const d = canvasDims(node);
    const text = `${Math.round(d.w)} × ${Math.round(d.h)}`;
    if (chip.textContent !== text) chip.textContent = text;
    chip.classList.toggle("warn", d.from === "unknown");
    chip.title = FROM_TITLE[d.from] || "";
  };
}

/** Undo / Redo / Clear, plus the optional Expand and Gear. Returns sync(). */
export function buildActions(node, host, { onExpand = null, onGear = null } = {}) {
  const u = btn("pix-lyb-btn", "Undo the last change to the boxes (Ctrl+Z in the big view)", ICON_UNDO);
  const r = btn("pix-lyb-btn", "Redo (Ctrl+Y in the big view)", ICON_REDO);
  const c = btn("pix-lyb-btn", "Remove every box", ICON_CLEAR);
  u.addEventListener("click", (e) => { e.stopPropagation(); undo(node); });
  r.addEventListener("click", (e) => { e.stopPropagation(); redo(node); });
  c.addEventListener("click", (e) => { e.stopPropagation(); clearBoxes(node); });
  host.append(u, r, c);
  if (onExpand) {
    const x = btn("pix-lyb-btn", "Open a big view for careful drawing", ICON_EXPAND);
    x.addEventListener("click", (e) => { e.stopPropagation(); onExpand(); });
    host.appendChild(x);
  }
  if (onGear) {
    const g = btn("pix-lyb-btn pix-lyb-gear", "Settings", "");
    g.addEventListener("click", (e) => { e.stopPropagation(); onGear(); });
    host.appendChild(g);
  }
  return () => {
    const ui = uiState(node);
    u.disabled = !ui.undo.length;
    r.disabled = !ui.redo.length;
    c.disabled = !readState(node).boxes.length;
  };
}

function field(cls, placeholder, title, value, max, onInput) {
  const inp = document.createElement("input");
  inp.className = cls;
  inp.type = "text";
  inp.placeholder = placeholder;
  inp.title = title;
  inp.value = value || "";
  inp.maxLength = max;
  followSpellcheck(inp);
  inp.addEventListener("input", () => onInput(inp.value));
  inp.addEventListener("keydown", (e) => {
    // Ctrl+S / Ctrl+Enter still reach ComfyUI (the value is already saved on
    // every keystroke); every other key stays in the field.
    if (passComfyShortcut(e, inp)) return;
    e.stopPropagation();
    if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); inp.blur(); }
  });
  return inp;
}

/** The big view's description: several lines, growing with the text. Enter
 *  finishes like a one-line field (a description is one paragraph). */
function area(placeholder, title, value, max, onInput) {
  const ta = document.createElement("textarea");
  ta.className = "pix-lyb-desc pix-lyb-area";
  ta.placeholder = placeholder;
  ta.title = title;
  ta.value = value || "";
  ta.maxLength = max;
  ta.rows = 2;
  followSpellcheck(ta);
  const fit = () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(140, Math.max(44, ta.scrollHeight + 2)) + "px";
  };
  ta.addEventListener("input", () => { onInput(ta.value); fit(); });
  ta.addEventListener("keydown", (e) => {
    if (passComfyShortcut(e, ta)) return;
    e.stopPropagation();
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Escape") { e.preventDefault(); ta.blur(); }
  });
  requestAnimationFrame(fit);
  return ta;
}

/** The numbered boxes, one row each. Rebuilt on structural changes only. */
export function renderList(node, host, { big = false } = {}) {
  const keep = host.scrollTop;     // a rebuild must not jump back to the top
  host.replaceChildren();
  const boxes = readState(node).boxes;
  const sel = uiState(node).sel;
  if (!boxes.length) {
    const h = document.createElement("div");
    h.className = "pix-lyb-hint";
    h.textContent = "Drag on the canvas to draw a box, then write what goes in it.";
    host.appendChild(h);
    return;
  }
  boxes.forEach((b, i) => {
    const row = document.createElement("div");
    row.className = "pix-lyb-row" + (i === sel ? " sel" : "");
    row.dataset.index = String(i);

    const badge = document.createElement("span");
    badge.className = "pix-lyb-badge";
    badge.textContent = String(i + 1);
    badge.style.background = rgbaOf(i);
    badge.style.color = inkOn(i);
    badge.title = `Box ${i + 1}: in a FLUX.3 prompt, write ${objTag(i)} to tie words to it (MOSS needs no tags)`;

    const kind = btn("pix-lyb-kind" + (b.type === "text" ? " text" : ""),
      b.type === "text"
        ? "Text box: holds exact words, like a sign or a title. Click for an object box."
        : "Object box: something in the picture. Click to make it a text box with exact words.",
      "");
    kind.textContent = b.type === "text" ? "Text" : "Obj";
    kind.addEventListener("click", (e) => {
      e.stopPropagation();
      const toText = b.type !== "text";
      setType(node, i, toText ? "text" : "obj");
      // the list was just rebuilt: the words are the next thing to type
      if (toText) focusRow(host, i);
    });

    const words = b.type === "text"
      ? field("pix-lyb-words", "exact words",
        "The exact words to write in this box. The model is asked to spell them as typed.",
        b.text, MAX_TEXT, (v) => setField(node, i, "text", v))
      : null;
    const descArgs = [b.type === "text" ? "what it looks like" : "what goes here",
      b.type === "text"
        ? "How the words look: the font, colour, where they are written. Optional."
        : "What goes in this box, like a red apple with a green leaf. One rich sentence works best.",
      b.desc, MAX_DESC, (v) => setField(node, i, "desc", v)];
    const del = btn("pix-lyb-del", "Delete this box", "×");
    del.addEventListener("click", (e) => { e.stopPropagation(); deleteBox(node, i); });

    row.append(badge, kind);
    if (big) {
      // two lines: the box's controls, then a description box that has room
      row.classList.add("big");
      if (words) row.appendChild(words);
      else {
        const tag = document.createElement("span");
        tag.className = "pix-lyb-tag";
        tag.textContent = objTag(i);
        tag.title = "FLUX.3: write this in your prompt to tie words to this box. MOSS needs no tags.";
        row.appendChild(tag);
      }
      const up = btn("pix-lyb-mini", "Move up: the box becomes one number lower (drawn further back)", ICON_UP);
      const dn = btn("pix-lyb-mini", "Move down: the box becomes one number higher (drawn in front)", ICON_DOWN);
      up.disabled = i === 0;
      dn.disabled = i === boxes.length - 1;
      up.addEventListener("click", (e) => { e.stopPropagation(); reorderBox(node, i, i - 1); });
      dn.addEventListener("click", (e) => { e.stopPropagation(); reorderBox(node, i, i + 1); });
      row.append(up, dn, del, area(...descArgs));
    } else {
      if (words) row.appendChild(words);
      row.append(field("pix-lyb-desc", ...descArgs), del);
    }

    row.addEventListener("focusin", () => select(node, i));
    row.addEventListener("pointerenter", () => { uiState(node).hover = i; refresh(node, false); });
    row.addEventListener("pointerleave", () => {
      if (uiState(node).hover === i) { uiState(node).hover = -1; refresh(node, false); }
    });
    host.appendChild(row);
  });
  host.scrollTop = keep;
}

/** Mark the selected row without rebuilding the list. */
export function syncListSelection(node, host) {
  const sel = uiState(node).sel;
  for (const row of host.querySelectorAll(".pix-lyb-row")) {
    row.classList.toggle("sel", Number(row.dataset.index) === sel);
  }
}

/** A box was drawn or clicked: show its row and put the caret in it (the
 *  words for a text box, else the description). preventScroll, because a plain
 *  focus() also scrolls every ancestor, the graph canvas included. */
export function focusRow(host, index, scroller = null) {
  const row = host.querySelector(`.pix-lyb-row[data-index="${index}"]`);
  if (!row) return;
  const inp = row.querySelector(".pix-lyb-words") || row.querySelector(".pix-lyb-desc");
  if (scroller) {
    // The big view: the list never scrolls there, its side panel does (a
    // drawn box 12 left the caret in a row below the panel's edge). Only that
    // panel moves, never an ancestor. Again on the next frame: the row's
    // description box grows to its text one frame after it is built.
    const reveal = () => {
      const rr = row.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      if (rr.top < sr.top) scroller.scrollTop -= sr.top - rr.top + 8;
      else if (rr.bottom > sr.bottom) scroller.scrollTop += rr.bottom - sr.bottom + 8;
    };
    reveal();
    requestAnimationFrame(() => requestAnimationFrame(reveal));
  } else {
    const top = row.offsetTop - host.offsetTop;
    if (top < host.scrollTop || top + row.offsetHeight > host.scrollTop + host.clientHeight) {
      host.scrollTop = Math.max(0, top - 4);
    }
  }
  try { inp?.focus({ preventScroll: true }); } catch {}
}

/** The one-line reminder of how boxes reach the prompt. The tags are FLUX.3's
 *  only: MOSS-Image Layout Prompt adds the boxes itself, and a tag typed into a
 *  MOSS prompt lands in its caption as junk (a Discord report, 2026-10-27).
 *  Kept short on purpose: 250 px wide, the line has 280 at MIN_W (nowrap). */
export function buildFooter(host) {
  const f = document.createElement("div");
  f.className = "pix-lyb-foot";
  f.innerHTML = "FLUX.3 prompt: <b>&lt;obj_1&gt;</b>, <b>&lt;obj_2&gt;</b>… MOSS: no tags.";
  f.title = "FLUX.3 Layout Prompt ties the words around each tag to its box. "
    + "MOSS-Image Layout Prompt adds the boxes to your prompt itself, so write no tags there: "
    + "just describe the whole picture.";
  host.appendChild(f);
  return f;
}
