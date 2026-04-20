import { NoteEditor } from "./core.mjs";

// Range helpers are kept for future modal-backed buttons (e.g. link dialog)
// where focus genuinely leaves the edit area. For the current buttons,
// mousedown+preventDefault already keeps focus and selection intact.
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

const SWATCHES = [
  "#f66744","#ffffff","#111111","#888888","#4a90e2","#5bd45b","#e25b5b",
  "#b565e2","#00bcd4","#ff79c6","#f1c40f","#cccccc","#8b4513","#2c3e50",
];

function openColorPop(anchorBtn, currentColor, onPick, allowClear = false) {
  const pop = document.createElement("div");
  pop.className = "pix-note-colorpop";
  const rect = anchorBtn.getBoundingClientRect();
  pop.style.left = `${rect.left}px`;
  pop.style.top = `${rect.bottom + 4}px`;

  const sw = document.createElement("div");
  sw.className = "pix-note-swatches";
  SWATCHES.forEach((c) => {
    const s = document.createElement("div");
    s.className = "pix-note-swatch";
    s.style.background = c;
    if (c.toLowerCase() === (currentColor || "").toLowerCase()) s.classList.add("active");
    s.addEventListener("mousedown", (e) => e.preventDefault());
    s.addEventListener("click", (e) => { e.stopPropagation(); onPick(c); close(); });
    sw.appendChild(s);
  });
  pop.appendChild(sw);

  const row = document.createElement("div");
  row.className = "pix-note-colorrow";
  const picker = document.createElement("input");
  picker.type = "color";
  picker.value = /^#[0-9a-f]{6}$/i.test(currentColor || "") ? currentColor : "#f66744";
  picker.addEventListener("mousedown", (e) => e.stopPropagation());
  // Use `change` (fires once when native picker dialog closes) instead of
  // `input` (fires on every drag). Native picker steals focus from the
  // contenteditable; repeated live applies operate on a stale range.
  picker.addEventListener("change", () => { onPick(picker.value); hex.value = picker.value; });
  const hex = document.createElement("input");
  hex.type = "text";
  hex.value = currentColor || "";
  hex.placeholder = "#rrggbb";
  hex.addEventListener("mousedown", (e) => e.stopPropagation());
  hex.oninput = () => {
    const v = hex.value.startsWith("#") ? hex.value : `#${hex.value}`;
    if (/^#[0-9a-f]{6}$/i.test(v)) { onPick(v); picker.value = v; }
  };
  row.appendChild(picker);
  row.appendChild(hex);
  if (allowClear) {
    const cl = document.createElement("div");
    cl.className = "clearbtn";
    cl.title = "Clear";
    cl.addEventListener("mousedown", (e) => e.preventDefault());
    cl.addEventListener("click", (e) => { e.stopPropagation(); onPick(null); close(); });
    row.appendChild(cl);
  }
  pop.appendChild(row);

  document.body.appendChild(pop);

  const onDocClick = (e) => {
    if (!pop.contains(e.target) && e.target !== anchorBtn) close();
  };
  function close() {
    document.removeEventListener("mousedown", onDocClick, true);
    pop.remove();
  }
  setTimeout(() => document.addEventListener("mousedown", onDocClick, true), 0);
}

NoteEditor.prototype._buildToolbar = function () {
  const tb = this._toolbarEl;
  tb.innerHTML = "";
  this._activeChecks = [];

  const el = (tag, cls) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  };

  const makeBtn = (label, title, cls, onClick, queryCmd) => {
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
      this._refreshActiveStates();
    });
    if (queryCmd) {
      this._activeChecks.push(() => {
        let on = false;
        try { on = document.queryCommandState(queryCmd); } catch (e) {}
        b.classList.toggle("active", on);
      });
    }
    return b;
  };

  // Group 1 — text style
  const g1 = el("div", "pix-note-tgroup");
  // Bold uses a custom active check: queryCommandState("bold") returns true
  // inside H1/H2/H3 because those render bold by default, making the button
  // misleadingly light up. Walk up the DOM and only activate when a real
  // <b>/<strong> wraps the selection.
  const bBtn = makeBtn("<b>B</b>", "Bold (Ctrl+B)", "", () =>
    document.execCommand("bold"));
  this._activeChecks.push(() => {
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    let explicit = false;
    if (anchor && this._editArea?.contains(anchor)) {
      let n = anchor;
      while (n && n !== this._editArea) {
        if (n.nodeType === 1 && (n.tagName === "B" || n.tagName === "STRONG")) {
          explicit = true; break;
        }
        n = n.parentNode;
      }
    }
    bBtn.classList.toggle("active", explicit);
  });
  g1.appendChild(bBtn);
  g1.appendChild(makeBtn("<i>I</i>", "Italic (Ctrl+I)", "italic", () =>
    document.execCommand("italic"), "italic"));
  g1.appendChild(makeBtn("<span class='under'>U</span>", "Underline (Ctrl+U)", "", () =>
    document.execCommand("underline"), "underline"));
  g1.appendChild(makeBtn("<span class='strike'>S</span>", "Strikethrough", "", () =>
    document.execCommand("strikeThrough"), "strikeThrough"));
  tb.appendChild(g1);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Group 2 — headings
  const mkHeading = (tag, label) =>
    makeBtn(label, `Heading ${tag.toUpperCase()}`, "", () =>
      document.execCommand("formatBlock", false, tag)
    );
  const g2 = el("div", "pix-note-tgroup");
  const h1Btn = mkHeading("h1", "H1");
  const h2Btn = mkHeading("h2", "H2");
  const h3Btn = mkHeading("h3", "H3");
  g2.appendChild(h1Btn);
  g2.appendChild(h2Btn);
  g2.appendChild(h3Btn);
  // "¶" resets the current block back to a paragraph
  g2.appendChild(makeBtn("\u00b6", "Paragraph (reset heading)", "", () =>
    document.execCommand("formatBlock", false, "p")
  ));
  tb.appendChild(g2);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Heading active-state: queryCommandValue returns the current block tag
  // (e.g. "h1", "p"). Some browsers wrap it in angle brackets ("<h1>").
  const headingMap = { h1: h1Btn, h2: h2Btn, h3: h3Btn };
  this._activeChecks.push(() => {
    let block = "";
    try { block = (document.queryCommandValue("formatBlock") || "").toString(); } catch (e) {}
    block = block.toLowerCase().replace(/[<>]/g, "");
    for (const [tag, btn] of Object.entries(headingMap)) {
      btn.classList.toggle("active", block === tag);
    }
  });

  // Group 3 — colors
  const g3 = el("div", "pix-note-tgroup");

  const textColorBtn = el("button", "pix-note-tbtn");
  textColorBtn.type = "button";
  textColorBtn.textContent = "A";
  textColorBtn.title = "Text color";
  textColorBtn.style.fontWeight = "bold";
  textColorBtn.style.borderBottom = `3px solid ${SWATCHES[0]}`;
  textColorBtn.addEventListener("mousedown", (e) => e.preventDefault());
  textColorBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const r = saveRange(this._editArea);
    openColorPop(textColorBtn, null, (c) => {
      this._editArea.focus();
      restoreRange(r);
      // Force CSS output (<span style="color:...">) instead of legacy
      // <font color="..."> so headings and the sanitizer preserve the color.
      document.execCommand("styleWithCSS", false, true);
      if (c == null) {
        // "Clear" means reset to the body's default text color rather than
        // execCommand("removeFormat") which would strip bold/italic/etc too.
        document.execCommand("foreColor", false, "#e4e4e4");
      } else {
        document.execCommand("foreColor", false, c);
        textColorBtn.style.borderBottom = `3px solid ${c}`;
      }
      this._dirty = true;
      this._refreshActiveStates();
    }, true);
  });
  g3.appendChild(textColorBtn);

  const hiColorBtn = el("button", "pix-note-tbtn");
  hiColorBtn.type = "button";
  hiColorBtn.textContent = "\u25A0";
  hiColorBtn.title = "Highlight color";
  hiColorBtn.addEventListener("mousedown", (e) => e.preventDefault());
  hiColorBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const r = saveRange(this._editArea);
    openColorPop(hiColorBtn, null, (c) => {
      this._editArea.focus();
      restoreRange(r);
      document.execCommand("styleWithCSS", false, true);
      if (c == null) {
        // hiliteColor("transparent") creates a nested span instead of
        // unsetting the parent span/li's color, so the old highlight
        // persists. Walk the selection's ancestors + descendants and
        // directly strip inline background-color.
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const ca = sel.getRangeAt(0).commonAncestorContainer;
          const scope = ca.nodeType === 1 ? ca : ca.parentNode;
          const targets = new Set([scope, ...scope.querySelectorAll("*")]);
          let p = scope.parentNode;
          while (p && p !== this._editArea && p !== document.body) {
            targets.add(p); p = p.parentNode;
          }
          for (const el of targets) {
            if (el.style && el.style.backgroundColor) {
              el.style.backgroundColor = "";
              if (!el.getAttribute("style")) el.removeAttribute("style");
            }
          }
        }
      } else {
        document.execCommand("hiliteColor", false, c);
        hiColorBtn.style.color = c;
      }
      this._dirty = true;
      this._refreshActiveStates();
    }, true);
  });
  g3.appendChild(hiColorBtn);

  tb.appendChild(g3);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Group 4 — lists
  const g4 = el("div", "pix-note-tgroup");
  g4.appendChild(makeBtn("&bull; List", "Bulleted list", "", () =>
    document.execCommand("insertUnorderedList"), "insertUnorderedList"
  ));
  g4.appendChild(makeBtn("1. List", "Numbered list", "", () =>
    document.execCommand("insertOrderedList"), "insertOrderedList"
  ));
  tb.appendChild(g4);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Groups 2-7 added in later tasks.
  this._afterToolbarBuilt?.();

  // Reflect selection state into button `.active` classes.
  if (!this._selectionChangeHandler) {
    this._selectionChangeHandler = () => {
      // Only update when the selection is inside our edit area, else queries
      // reflect whatever other element has focus.
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (!this._editArea?.contains(sel.anchorNode)) return;
      this._refreshActiveStates();
    };
    document.addEventListener("selectionchange", this._selectionChangeHandler);
  }
};

NoteEditor.prototype._refreshActiveStates = function () {
  (this._activeChecks || []).forEach((fn) => fn());
};
