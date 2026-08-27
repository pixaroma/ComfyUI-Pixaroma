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

// How many backslashes a body has immediately before a leading "#", or -1 when
// the body does not lead with a hash at all. This is what makes the clipboard
// encoding reversible: escaping only a BARE "#" is ambiguous, because a decoded
// "\#..." could equally be an escaped "#..." or an untouched "\#...", and the
// decoder has no way to tell. Counting the run and escaping the escape removes
// the ambiguity entirely.
function escapeLead(body) {
  let i = 0;
  while (body.charAt(i) === "\\") i += 1;
  return body.charAt(i) === OFF ? i : -1;
}

// One piece of text -> { text, enabled }. `text` is what the row shows and is
// never carrying the marker, so the row's box holds exactly the prompt.
function pieceToRow(piece) {
  const lead = piece.length - piece.trimStart().length;
  const indent = piece.slice(0, lead);
  const body = piece.slice(lead);
  // one or more backslashes before the hash: an ESCAPED prompt, still switched on
  if (escapeLead(body) > 0) return { text: indent + body.slice(1), enabled: true };
  if (body.charAt(0) === OFF) {
    let rest = body.slice(1);
    if (rest.charAt(0) === " ") rest = rest.slice(1);
    // the remainder carries its own escaping, so undo that too - without this a
    // switched-off row whose text starts with "#" came back with a stray
    // backslash baked into it on every Copy then Paste
    if (escapeLead(rest) > 0) rest = rest.slice(1);
    return { text: indent + rest, enabled: false };
  }
  return { text: piece, enabled: true };
}

// ...and back. A prompt the user genuinely wants to START with a hash is
// escaped, so it survives the round trip instead of switching itself off - and
// so is one that already starts with a backslash-hash, or the two cases would
// decode to the same thing.
function rowToPiece(row) {
  const text = typeof row.text === "string" ? row.text : "";
  const lead = text.length - text.trimStart().length;
  const indent = text.slice(0, lead);
  const body = text.slice(lead);
  const escaped = escapeLead(body) >= 0 ? "\\" + body : body;
  if (row.enabled === false) return indent + OFF + " " + escaped;
  return indent + escaped;
}

// The ONE conversion from an ENABLED row to the piece that is sent to Python,
// used by both the count on the node face and the graphToPrompt payload so the
// two can never disagree.
//
// It exists because "#" at the start of a piece means SWITCHED OFF down in the
// shared pipeline, which is right for text arriving on the wire or through
// Paste but wrong for a row: a row carries its own ON/OFF switch, so a person
// who types "#1 portrait" as an actual prompt - numbering a list is the obvious
// thing to do in a node like this - had that row silently refuse to run while
// its switch still read ON. Escaping here means Python unescapes it back and
// runs it, and the parity-critical pipeline is not touched at all.
//
// DELIBERATELY NOT rowToPiece: an encoder is only correct against its own
// decoder, and these two have different decoders. The clipboard's decoder is
// pieceToRow above, which counts the whole backslash run; Python's strips
// EXACTLY ONE backslash before a hash, so doubling here would send "\\#x" and
// have it arrive with the extra backslash still attached.
//
// It needs `trim` because Python's decoder is ANCHORED AT POSITION 0 while this
// escape sits after the row's indent, and only trimming brings the two into
// line. Escape unconditionally and a row of "  #tag" with Trim turned OFF
// arrives as "  \#tag": the strip never runs, so position 0 is a space, neither
// marker branch fires, and the backslash the user never typed ends up in the
// prompt. The first version of this function did exactly that.
//
// So escape ONLY when the escape will actually be undone:
//   trim ON  - always. The indent is stripped, "\#" lands at 0, Python unescapes.
//   trim OFF - only when the hash is ALREADY at 0. An indented hash needs no
//              protection, because Python's marker check will not fire on it
//              either (verified: "  #tag" with trim off runs as "  #tag").
export function rowToPrompt(text, trim = true) {
  const s = typeof text === "string" ? text : "";
  const lead = s.length - s.trimStart().length;
  const indent = s.slice(0, lead);
  const body = s.slice(lead);
  if (body.charAt(0) !== OFF) return s;
  if (!trim && lead > 0) return s;
  return indent + "\\" + body;
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

// Size every row box in ONE read pass and ONE write pass.
//
// The naive version reads scrollHeight and writes height per row, and each pair
// forces its own layout: MEASURED at 200 rows, a rebuild cost 2855ms of frozen
// UI. Writing all the "auto" heights first, then reading all the scrollHeights,
// then writing all the real heights, is three layouts instead of 400.
export function growAll(parts) {
  if (!parts?.rows) return;
  const tas = [...parts.rows.querySelectorAll(".pix-each-rowta")]
    .filter((ta) => ta.offsetParent !== null);   // never measure an unlaid-out box
  if (!tas.length) return;
  for (const ta of tas) ta.style.height = "auto";
  const heights = tas.map((ta) => Math.min(Math.max(ta.scrollHeight, 30), 140));
  tas.forEach((ta, i) => { ta.style.height = heights[i] + "px"; });
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
