import { NoteEditor } from "./core.mjs";

// Save and restore selection ranges so clicking a toolbar button doesn't
// blur the edit area and lose the user's text selection.
function saveRange(root) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.commonAncestorContainer)) return null;
  return r.cloneRange();
}

function restoreRange(range) {
  if (!range) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

NoteEditor.prototype._buildToolbar = function () {
  const tb = this._toolbarEl;
  tb.innerHTML = "";
  const el = (tag, cls) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  };

  const makeBtn = (label, title, cls, onClick) => {
    const b = el("button", `pix-note-tbtn ${cls || ""}`.trim());
    b.type = "button";
    b.innerHTML = label;
    b.title = title;
    // mousedown prevents the editArea from losing focus + selection
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    b.addEventListener("click", (e) => {
      e.preventDefault();
      const r = saveRange(this._editArea);
      this._editArea.focus();
      restoreRange(r);
      onClick(b);
      this._dirty = true;
    });
    return b;
  };

  // Group 1 — text style
  const g1 = el("div", "pix-note-tgroup");
  g1.appendChild(makeBtn("<b>B</b>", "Bold (Ctrl+B)", "", () =>
    document.execCommand("bold")));
  g1.appendChild(makeBtn("<i>I</i>", "Italic (Ctrl+I)", "italic", () =>
    document.execCommand("italic")));
  g1.appendChild(makeBtn("<span class='under'>U</span>", "Underline (Ctrl+U)", "", () =>
    document.execCommand("underline")));
  g1.appendChild(makeBtn("<span class='strike'>S</span>", "Strikethrough", "", () =>
    document.execCommand("strikeThrough")));
  tb.appendChild(g1);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Groups 2-7 added in later tasks.
  this._afterToolbarBuilt?.();
};
