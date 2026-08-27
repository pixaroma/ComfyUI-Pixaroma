// Prompt Each Pixaroma - the Rows view: one box + toggle per prompt.
//
// ROWS ARE THE STATE (see core.mjs). The two converters below are ONLY for the
// places that genuinely deal in one block of text - Copy, Paste, and opening a
// workflow saved by the first build of this node. They must never be used to
// store the rows: a row may contain newlines of its own, and newline is the
// separator here, so a round trip through text tears such a row apart.
//
// In that text form a switched-off row is a line starting with "#", which is
// what makes Copy keep the switches and makes a pasted Save Text file skip its
// "# <date>" lines for free. The rules match nodes/_prompt_each_helpers.py:
// leading whitespace ignored, "\#" is an escaped literal hash, anything else
// starting with "#" is off.

import { splitText, SPLIT_BLANK } from "./expand.mjs";
import { el } from "./ui.mjs";

const OFF = "#";

// One piece of text -> { text, enabled }. `text` is what the row shows and is
// never carrying the marker, so the row's box holds exactly the prompt.
function pieceToRow(piece) {
  const lead = piece.length - piece.trimStart().length;
  const indent = piece.slice(0, lead);
  const body = piece.slice(lead);
  if (body.slice(0, 2) === "\\" + OFF) {
    return { text: indent + body.slice(1), enabled: true };
  }
  if (body.charAt(0) === OFF) {
    let rest = body.slice(1);
    if (rest.charAt(0) === " ") rest = rest.slice(1);
    return { text: indent + rest, enabled: false };
  }
  return { text: piece, enabled: true };
}

// ...and back. A prompt the user genuinely wants to START with a hash is
// escaped, so it survives the round trip instead of switching itself off.
function rowToPiece(row) {
  const text = typeof row.text === "string" ? row.text : "";
  const lead = text.length - text.trimStart().length;
  const indent = text.slice(0, lead);
  const body = text.slice(lead);
  const escaped = body.charAt(0) === OFF ? "\\" + body : body;
  if (row.enabled === false) return indent + OFF + " " + escaped;
  return indent + escaped;
}

export function textToRows(text, split) {
  const pieces = splitText(typeof text === "string" ? text : "", split);
  const rows = pieces.map(pieceToRow);
  // A brand new node has nothing typed: show one empty row rather than a blank
  // panel with no way in.
  if (!rows.length) return [{ text: "", enabled: true }];
  return rows;
}

export function rowsToText(rows, split) {
  const sep = split === SPLIT_BLANK ? "\n\n" : "\n";
  return (rows || []).map(rowToPiece).join(sep);
}

// ---------------------------------------------------------------------------
// the DOM
// ---------------------------------------------------------------------------

// Never measure a textarea that has no layout: in a non-active workflow tab the
// node is display:none, scrollHeight reads 0, and this would write a literal
// height:0px that nothing repairs (prompt-multi.md #17, the same bug twice).
function autoGrow(ta) {
  if (!ta || ta.offsetParent === null) return;
  ta.style.height = "auto";
  ta.style.height = Math.min(Math.max(ta.scrollHeight, 30), 140) + "px";
}

export function growAll(parts) {
  if (!parts?.rows) return;
  for (const ta of parts.rows.querySelectorAll(".pix-each-rowta")) autoGrow(ta);
}

// Rebuilds the row list. Called only on a STRUCTURAL change (add, delete,
// toggle, reorder, view switch) - never on a keystroke, which would steal focus
// mid-word. Typing writes state through `commit` without touching the DOM.
export function renderRows(parts, st, handlers) {
  const host = parts.rows;
  if (!host) return;
  host.innerHTML = "";
  const rows = Array.isArray(st.rows) && st.rows.length ? st.rows : [{ text: "", enabled: true }];

  rows.forEach((row, i) => {
    const el_ = el("div", "pix-each-row" + (row.enabled === false ? " is-off" : ""));
    el_.dataset.i = String(i);

    const head = el("div", "pix-each-rowhead");
    // draggable lives on the HANDLE, not the row: with it on the row the
    // browser makes the ROW the drag source, so a "did this start on the
    // handle" gate can never match and drag-selecting text inside the box
    // hijacks into a reorder (node UI convention #11).
    const handle = el("div", "pix-each-handle", "⋮⋮");
    handle.draggable = true;
    handle.title = "Drag to reorder";
    head.appendChild(handle);

    const tog = el("button", "pix-each-toggle" + (row.enabled === false ? "" : " on"),
      row.enabled === false ? "OFF" : "ON");
    tog.type = "button";
    tog.title = row.enabled === false
      ? "Switched off. This prompt is skipped."
      : "On. Click to skip this prompt without deleting it.";
    head.appendChild(tog);

    const num = el("span", "pix-each-rownum", String(i + 1));
    head.appendChild(num);

    const sp = el("span", "pix-each-rowsp");
    head.appendChild(sp);

    const del = el("button", "pix-each-del", "✕");
    del.type = "button";
    del.title = "Delete this prompt";
    head.appendChild(del);
    el_.appendChild(head);

    const ta = el("textarea", "pix-each-rowta");
    ta.value = row.text;
    ta.placeholder = "a prompt";
    ta.spellcheck = false;
    el_.appendChild(ta);

    handlers.wireRow(el_, i, { ta, tog, del, handle });
    host.appendChild(el_);
  });

  // SYNCHRONOUS, deliberately. Every row is already in the document, and reading
  // scrollHeight forces the layout we need anyway - so the heights are final by
  // the time this returns and the caller can size the node immediately. Doing it
  // in a requestAnimationFrame instead made the node's height depend on a frame
  // landing, which is exactly the kind of thing that half-fires.
  growAll(parts);
}
