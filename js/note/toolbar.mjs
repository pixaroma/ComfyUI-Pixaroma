import { NoteEditor } from "./core.mjs";
import {
  openPixaromaColorPickerPopup,
  openPixaromaCompactColorPickerPopup,
  PIXAROMA_PALETTE,
} from "../shared/color_picker.mjs";

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

// Normalise any CSS color string ("#abc", "#aabbcc", "rgb(…)", "rgba(…)",
// "blue", "transparent") to lowercase #rrggbb, or null when the colour is
// missing / fully transparent. Used by the cursor-mirror to turn an
// element's inline colour into a hex value the picker can display.
const _colorToHexTmp = (() => {
  const d = document.createElement("div");
  d.style.position = "absolute";
  d.style.visibility = "hidden";
  d.style.pointerEvents = "none";
  return d;
})();
function colorToHex(s) {
  if (!s) return null;
  const t = String(s).trim().toLowerCase();
  if (!t || t === "transparent" || t === "rgba(0, 0, 0, 0)") return null;
  // Fast path: already #rgb / #rrggbb
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^#[0-9a-f]{3}$/.test(t)) {
    return "#" + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
  }
  // Fast path: rgb()/rgba()
  let m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d*\.?\d+))?\)$/.exec(t);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    const h = (n) => parseInt(n, 10).toString(16).padStart(2, "0");
    return "#" + h(m[1]) + h(m[2]) + h(m[3]);
  }
  // Slow path: named colours, rgb%, etc — let the browser resolve.
  if (!_colorToHexTmp.isConnected) document.body.appendChild(_colorToHexTmp);
  _colorToHexTmp.style.color = "";
  _colorToHexTmp.style.color = s;
  const cs = window.getComputedStyle(_colorToHexTmp).color;
  m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d*\.?\d+))?\)$/.exec(cs || "");
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
  const h = (n) => parseInt(n, 10).toString(16).padStart(2, "0");
  return "#" + h(m[1]) + h(m[2]) + h(m[3]);
}

// 4 rows × 7 = 28 swatches, grouped by purpose so the rows read as a
// proper palette rather than a random grid. The CSS grid below lays them
// out in 7 columns so the row structure stays intact visually.
//
//   Row 1 — Neutrals: white through black, covers 90% of "just a note"
//           backgrounds and is where default (#111111) lives.
//   Row 2 — Bright accents: Pixaroma brand orange plus saturated hues,
//           most useful for text/highlight colour or for an attention-
//           grabbing note ("IMPORTANT").
//   Row 3 — ComfyUI-style muted: approximates the dusty tones from the
//           Vue canvas right-click 'Colors' menu, so Pixaroma notes can
//           colour-coordinate with the built-in node palette.
//   Row 4 — Modern soft / deep: pastels for calm light notes and deep
//           tones for rich dark notes.
export const SWATCHES = [
  // Row 1 — Neutrals
  "#ffffff","#d4d4d4","#888888","#555555","#2a2a2a","#111111","#000000",
  // Row 2 — Bright accents (Pixaroma brand first)
  "#f66744","#e74c3c","#f1c40f","#5bd45b","#00bcd4","#4a90e2","#b565e2",
  // Row 3 — ComfyUI-muted node colours
  "#a85848","#a66a3d","#a08147","#6f8e46","#537c90","#4c6db9","#a968c2",
  // Row 4 — Modern soft + deep
  "#ff79c6","#f4a261","#c9a96e","#3a5a40","#1e3a5f","#4a3d6b","#2c3e50",
];

NoteEditor.prototype._buildToolbar = function () {
  const tb = this._toolbarEl;
  tb.innerHTML = "";
  this._activeChecks = [];

  const el = (tag, cls) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  };

  // Build a tintable SVG mask-icon span for a toolbar button. The
  // icon's fill color comes from CSS custom property --pix-note-tbtn-
  // tint on the button element (set inline by color pickers to reflect
  // the current selection) or falls back to currentColor for plain
  // action buttons. `name` must match a CSS class suffix declared in
  // css.mjs — e.g. "text-color" → ".pix-note-icon-text-color".
  const makeMaskIcon = (name) => {
    const span = document.createElement("span");
    span.className = `pix-note-tbtn-maskicon pix-note-icon-${name}`;
    return span;
  };

  // Two-layer sibling of makeMaskIcon for color pickers. Outline stays
  // currentColor; drop takes --pix-note-tbtn-tint. Uses CSS ::before +
  // ::after so no extra inner DOM nodes are needed. See css.mjs
  // .pix-note-tbtn-maskicon-multi for the layered rendering.
  const makeMaskIconMulti = (name) => {
    const span = document.createElement("span");
    span.className = `pix-note-tbtn-maskicon-multi pix-note-icon-${name}`;
    return span;
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
  // Bold uses queryCommandState like italic/underline/strikethrough. It
  // correctly reflects both cases the user expects to see lit up:
  //   1. Explicit <b>/<strong> wrappers
  //   2. Headings (H1/H2/H3) — they render bold by default, matches Word /
  //      Google Docs / Notion behaviour where Bold is active in a heading
  //   3. <span style="font-weight:bold"> — the color pickers enable
  //      styleWithCSS=true globally, after which execCommand("bold")
  //      produces a span instead of a <b>. A tag-walk for B/STRONG would
  //      miss this and the icon would never light up after picking a
  //      text/highlight colour.
  const bBtn = makeBtn("<b>B</b>", "Bold (Ctrl+B)", "", () =>
    document.execCommand("bold"), "bold");
  g1.appendChild(bBtn);
  g1.appendChild(makeBtn("<i>I</i>", "Italic (Ctrl+I)", "italic", () =>
    document.execCommand("italic"), "italic"));
  g1.appendChild(makeBtn("<span class='under'>U</span>", "Underline (Ctrl+U)", "", () =>
    document.execCommand("underline"), "underline"));
  g1.appendChild(makeBtn("<span class='strike'>S</span>", "Strikethrough", "", () =>
    document.execCommand("strikeThrough"), "strikeThrough"));
  // Clear formatting — always-on orange icon button. Strips inline format
  // (bold/italic/underline/colors), unlinks anchors, unwraps <code>/<pre>
  // (execCommand leaves those alone), and demotes the current block
  // (heading) back to a paragraph. List items are left alone — removing a
  // bullet/numbered wrapper requires toggling the list button itself.
  const clearFmtLabel = `<img class="pix-note-tbtn-icon" src="/pixaroma/assets/icons/ui/clear-format.svg" draggable="false">`;
  g1.appendChild(makeBtn(clearFmtLabel, "Clear all formatting on selection", "pix-note-tbtn-accent", () => {
    const sel = window.getSelection();
    if (sel?.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const ca = range.commonAncestorContainer;
      const scope = ca.nodeType === 1 ? ca : ca.parentElement;
      const toUnwrap = new Set();
      const walkUp = (start) => {
        let n = start;
        while (n && n !== this._editArea) {
          if (n.nodeType === 1 && (n.tagName === "CODE" || n.tagName === "PRE")) {
            toUnwrap.add(n);
          }
          n = n.parentNode;
        }
      };
      walkUp(range.startContainer);
      walkUp(range.endContainer);
      if (scope?.querySelectorAll) {
        for (const el of scope.querySelectorAll("code, pre")) {
          if (range.intersectsNode(el)) toUnwrap.add(el);
        }
      }
      for (const el of toUnwrap) {
        const parent = el.parentNode;
        if (!parent) continue;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      }
      // Also unwrap any UL/OL intersected by the selection: promote every LI
      // to a P and drop the list wrapper. execCommand("removeFormat") doesn't
      // touch lists, so without this step a bulleted/numbered selection still
      // shows its bullets after Tx.
      const listsToUnwrap = new Set();
      const walkUpList = (start) => {
        let n = start;
        while (n && n !== this._editArea) {
          if (n.nodeType === 1 && (n.tagName === "UL" || n.tagName === "OL")) {
            listsToUnwrap.add(n);
          }
          n = n.parentNode;
        }
      };
      walkUpList(range.startContainer);
      walkUpList(range.endContainer);
      if (scope?.querySelectorAll) {
        for (const el of scope.querySelectorAll("ul, ol")) {
          if (range.intersectsNode(el)) listsToUnwrap.add(el);
        }
      }
      for (const list of listsToUnwrap) {
        const parent = list.parentNode;
        if (!parent) continue;
        const lis = Array.from(list.children).filter((c) => c.tagName === "LI");
        for (const li of lis) {
          const p = document.createElement("p");
          while (li.firstChild) p.appendChild(li.firstChild);
          parent.insertBefore(p, list);
        }
        parent.removeChild(list);
      }
    }
    document.execCommand("removeFormat");
    document.execCommand("unlink");
    // Demote headings / blockquotes into plain paragraphs by manual DOM
    // replacement. execCommand("formatBlock", false, "p") sometimes leaves
    // the heading wrapper intact or nests elements awkwardly, especially
    // after the list/code unwrap steps above have already mutated the DOM.
    const sel2 = window.getSelection();
    if (sel2?.rangeCount > 0) {
      const range2 = sel2.getRangeAt(0);
      const ca2 = range2.commonAncestorContainer;
      const scope2 = ca2.nodeType === 1 ? ca2 : ca2.parentElement;
      const blocks = new Set();
      const walkUpBlock = (start) => {
        let n = start;
        while (n && n !== this._editArea) {
          if (n.nodeType === 1 && /^(H1|H2|H3|BLOCKQUOTE)$/.test(n.tagName)) {
            blocks.add(n);
          }
          n = n.parentNode;
        }
      };
      walkUpBlock(range2.startContainer);
      walkUpBlock(range2.endContainer);
      if (scope2?.querySelectorAll) {
        for (const el of scope2.querySelectorAll("h1, h2, h3, blockquote")) {
          if (range2.intersectsNode(el)) blocks.add(el);
        }
      }
      for (const el of blocks) {
        const parent = el.parentNode;
        if (!parent) continue;
        const p = document.createElement("p");
        while (el.firstChild) p.appendChild(el.firstChild);
        parent.replaceChild(p, el);
      }
    }
  }));
  tb.appendChild(g1);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Group 2 — headings
  // Manual block rename instead of execCommand("formatBlock"). Chrome's
  // formatBlock has a known quirk: when the current paragraph contains
  // an inline-block element (our `.pix-note-ic`), formatBlock can split
  // the paragraph and emit the heading on a new line, leaving the icon
  // stranded in a separate `<p>`. Manual rename: find the top-level
  // block containing the caret, create a fresh element with the target
  // tag, transfer all children, replace in place. Mirror of the demote
  // path used by the clear-format button (lines 287-293 above).
  const mkHeading = (tag, label) =>
    makeBtn(label, `Heading ${tag.toUpperCase()}`, "", () => {
      const editArea = this._editArea;
      if (!editArea) return;
      // After Ctrl+Z, doUndo replaces innerHTML wholesale and the cursor
      // can land on a bare text node directly under editArea (no block
      // wrapper), which makes findTopBlock fail. Normalize first to wrap
      // any loose text/inline children in <p>.
      this._normalizeEditArea?.(editArea);
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      // Cursor inside a table cell? findTopBlock would walk up to the
      // <table> and replace it whole — the grid would visibly
      // disappear. Bail. The active-state hook below also greys these
      // buttons out so the click never reaches here normally; this
      // catch is for keyboard shortcuts / programmatic invocation.
      const inTableCell = (n) => {
        while (n && n !== editArea) {
          if (n.nodeType === 1 && (n.tagName === "TD" || n.tagName === "TH")) return true;
          n = n.parentNode;
        }
        return false;
      };
      if (inTableCell(range.startContainer)) return;
      // Walk up from the caret to the top-level block child of editArea.
      // Special case: if the start node IS editArea (happens after
      // doUndo + _placeCursorAtEnd, which collapses to editArea at
      // childNodes.length), pick the child at the relevant offset.
      const findTopBlock = (start, off) => {
        if (start === editArea) {
          // offset is the index in childNodes. Use the child to the LEFT
          // of the caret if there is one, else the one to the right.
          const idx = Math.min(off ?? 0, editArea.childNodes.length);
          const cand =
            editArea.childNodes[idx - 1] ||
            editArea.childNodes[idx] ||
            null;
          return (cand && cand.nodeType === 1) ? cand : null;
        }
        let n = start;
        while (n && n !== editArea) {
          if (n.parentNode === editArea && n.nodeType === 1) return n;
          n = n.parentNode;
        }
        return null;
      };
      const startBlock = findTopBlock(range.startContainer, range.startOffset);
      const endBlock   = findTopBlock(range.endContainer,   range.endOffset);
      if (!startBlock) return;
      // Collect every block touched by the selection (or just the one).
      const blocks = [];
      if (startBlock === endBlock || !endBlock) {
        blocks.push(startBlock);
      } else {
        let n = startBlock;
        while (n) {
          blocks.push(n);
          if (n === endBlock) break;
          n = n.nextSibling;
        }
      }
      this._snapBefore?.();
      const replacements = [];
      for (const b of blocks) {
        if (!b.parentNode) continue;
        // Already the right tag? Skip (saves an unneeded DOM swap).
        if (b.tagName.toLowerCase() === tag) {
          replacements.push(b);
          continue;
        }
        const fresh = document.createElement(tag);
        while (b.firstChild) fresh.appendChild(b.firstChild);
        b.parentNode.replaceChild(fresh, b);
        replacements.push(fresh);
      }
      // Restore selection: place caret at end of the last replaced block,
      // or span all replaced blocks if it was a multi-block selection.
      if (replacements.length > 0) {
        const newRange = document.createRange();
        if (replacements.length === 1) {
          newRange.selectNodeContents(replacements[0]);
          newRange.collapse(false);
        } else {
          newRange.setStart(replacements[0], 0);
          newRange.setEnd(replacements[replacements.length - 1],
            replacements[replacements.length - 1].childNodes.length);
        }
        sel.removeAllRanges();
        sel.addRange(newRange);
      }
      this._snapAfter?.();
      this._dirty = true;
    });
  const g2 = el("div", "pix-note-tgroup");
  const h1Btn = mkHeading("h1", "H1");
  const h2Btn = mkHeading("h2", "H2");
  const h3Btn = mkHeading("h3", "H3");
  g2.appendChild(h1Btn);
  g2.appendChild(h2Btn);
  g2.appendChild(h3Btn);
  // No paragraph-reset button — the Tx clear-format button in Group 1
  // already demotes headings back to paragraphs via its manual DOM unwrap.
  tb.appendChild(g2);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Heading active-state: queryCommandValue returns the current block tag
  // (e.g. "h1", "p"). Some browsers wrap it in angle brackets ("<h1>").
  // Also drives the disabled state — headings inside a table cell would
  // walk up to the <table> and replace it whole, so they're disabled
  // while the caret is in a cell.
  const headingMap = { h1: h1Btn, h2: h2Btn, h3: h3Btn };
  const HEADING_TITLE_DISABLED = "Headings can't be applied inside a table cell";
  for (const [tag, btn] of Object.entries(headingMap)) {
    btn.dataset.titleEnabled = `Heading ${tag.toUpperCase()}`;
  }
  this._activeChecks.push(() => {
    let block = "";
    try { block = (document.queryCommandValue("formatBlock") || "").toString(); } catch (e) {}
    block = block.toLowerCase().replace(/[<>]/g, "");
    // Detect cursor inside a table cell to drive disabled state.
    let inCell = false;
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    if (anchor && this._editArea?.contains(anchor)) {
      let n = anchor;
      while (n && n !== this._editArea) {
        if (n.nodeType === 1 && (n.tagName === "TD" || n.tagName === "TH")) {
          inCell = true; break;
        }
        n = n.parentNode;
      }
    }
    for (const [tag, btn] of Object.entries(headingMap)) {
      btn.classList.toggle("active", !inCell && block === tag);
      btn.disabled = inCell;
      btn.title = inCell ? HEADING_TITLE_DISABLED : btn.dataset.titleEnabled;
    }
  });

  // Group 3 — colors
  const g3 = el("div", "pix-note-tgroup");

  const textColorBtn = el("button", "pix-note-tbtn");
  textColorBtn.type = "button";
  textColorBtn.title = "Text color";
  textColorBtn.appendChild(makeMaskIconMulti("text-color"));
  // Expose on the editor instance so block-insert paths (grid, button,
  // YT, Discord, code) can re-stage the picked color after an
  // execCommand("insertHTML") splits the current inline formatting
  // context. See _restageColors() below.
  this._textColorBtn = textColorBtn;
  // No initial tint — icon falls back to currentColor (toolbar text
  // color) so it's immediately visible on the dark toolbar. The
  // _activeChecks mirror + openColorPop onPick below will setProperty
  // with the user's real color once anything actually happens.
  textColorBtn.addEventListener("mousedown", (e) => e.preventDefault());
  textColorBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const r = saveRange(this._editArea);
    openPixaromaCompactColorPickerPopup(textColorBtn, {
      initialColor: textColorBtn.style.getPropertyValue("--pix-note-tbtn-tint").trim() || null,
      // Same 3-row 12-column layout as the highlight + Bg pickers, but
      // with the transparent tile dimmed + unclickable: "no text colour"
      // doesn't apply here (text is always coloured). Users still revert
      // text to default via the Tx clear-format button (Group 1) or via
      // Reset (white) below.
      swatches: PIXAROMA_PALETTE.slice(0, 35),
      showClear: true,
      clearPosition: "last",
      clearDisabled: true,
      // Reset returns to the editor's default text colour (white) so
      // the user can quickly back out of a coloured pick without
      // re-picking the white swatch.
      resetColor: "#ffffff",
      onPick: (c) => {
        // Suppress the cursor-mirror briefly so a freshly-staged colour
        // doesn't get overwritten by the cursor's pre-pick context
        // colour on the next selectionchange.
        this._suppressMirrorUntil = Date.now() + 1000;
        this._editArea.focus();
        restoreRange(r);
        document.execCommand("styleWithCSS", false, true);
        if (c == null) {
          // Manual strip - directly remove inline `color` styles from
          // any element intersecting the current selection. We avoid
          // execCommand("foreColor", default) because Chrome's
          // styleWithCSS implementation can collapse / merge adjacent
          // same-color spans and accidentally clear color on content
          // OUTSIDE the selection. For a collapsed cursor we simply
          // unset the staged tint - typing afterwards picks up the
          // editor's default color via CSS inheritance.
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            if (!range.collapsed) {
              const ca = range.commonAncestorContainer;
              const scope = ca.nodeType === 1 ? ca : ca.parentNode;
              const targets = new Set([scope, ...(scope.querySelectorAll?.("*") || [])]);
              let p = scope.parentNode;
              while (p && p !== this._editArea && p !== document.body) {
                targets.add(p); p = p.parentNode;
              }
              for (const el of targets) {
                if (!range.intersectsNode(el)) continue;
                if (el.style && el.style.color) {
                  el.style.removeProperty("color");
                  if (!el.getAttribute("style")) el.removeAttribute("style");
                }
              }
            }
          }
          textColorBtn.style.removeProperty("--pix-note-tbtn-tint");
          // Clear sticky pick — back to "no explicit pick" state where
          // the cursor-mirror takes over the icon again.
          this._pickedFg = null;
        } else {
          document.execCommand("foreColor", false, c);
          textColorBtn.style.setProperty("--pix-note-tbtn-tint", c);
          // Sticky pick: lock the tint to this colour. Mirror skips
          // text-tint updates while _pickedFg is set, so the icon and
          // typing both stay on the picked colour until the user
          // explicitly picks something else.
          this._pickedFg = c;
        }
        this._dirty = true;
        this._refreshActiveStates();
      },
    });
  });
  g3.appendChild(textColorBtn);

  // Cursor-mirror is implemented in _mirrorPickerColors and driven by
  // the selectionchange handler at the bottom of _buildToolbar. Tint
  // follows the cursor's effective inline colour. The historical
  // pick-clobber bug is mitigated by _suppressMirrorUntil (1s window
  // after every pick), so a freshly-staged colour stays visible long
  // enough for the user to start typing — at which point the typed
  // text is wrapped in a span with the picked colour and subsequent
  // mirror runs read the picked colour from the new span.

  const hiColorBtn = el("button", "pix-note-tbtn");
  hiColorBtn.type = "button";
  hiColorBtn.title = "Highlight color";
  hiColorBtn.appendChild(makeMaskIconMulti("highlight-color"));
  // Exposed for _restageColors() — see textColorBtn comment above.
  this._hiColorBtn = hiColorBtn;
  hiColorBtn.addEventListener("mousedown", (e) => e.preventDefault());
  hiColorBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const r = saveRange(this._editArea);
    openPixaromaCompactColorPickerPopup(hiColorBtn, {
      initialColor: hiColorBtn.style.getPropertyValue("--pix-note-tbtn-tint").trim() || null,
      // 35 colors + transparent tile at last position = 36 = 3 clean
      // rows of 12. Same shape as the text + Bg pickers; transparent
      // is the only one of the three pickers where the tile is active
      // (highlights can be removed; text + Bg can't go transparent).
      swatches: PIXAROMA_PALETTE.slice(0, 35),
      showClear: true,
      clearPosition: "last",
      // Reset returns to "no highlight" (transparent), matching the
      // default state of the picker. Routes through the same null
      // branch as clicking the transparent tile.
      resetColor: null,
      onPick: (c) => {
        // Suppress mirror for 1s — same rationale as the text picker.
        this._suppressMirrorUntil = Date.now() + 1000;
        this._editArea.focus();
        restoreRange(r);
        document.execCommand("styleWithCSS", false, true);
        const sel = window.getSelection();
        const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;

        if (c == null) {
          // Reset / transparent. Stored-marks pattern (mirrors what
          // ProseMirror / Slate / Quill / Lexical do for "remove mark
          // at collapsed cursor"):
          //  - Range: strip bg from every element that intersects the
          //    selection (mirror of the text-color Clear path) — works
          //    immediately because the selection gives us a concrete
          //    target, no Chrome quirks.
          //  - Collapsed: stage a "clear next typed char" intent on
          //    `_stagedHiClear`. NO DOM mutation here — the typed char
          //    is intercepted in `_applyStagedHilite` and inserted as
          //    a sibling text node OUTSIDE the surrounding bg span.
          //    Earlier attempts (move-cursor-at-Reset, split-at-Reset)
          //    failed because `_applyStagedHilite` produces ONE span
          //    PER CHAR, so the "outermost bg ancestor" walk found a
          //    single-char span and Chrome merged subsequent typing
          //    back into the adjacent same-color sibling span.
          if (range && !range.collapsed) {
            const ca = range.commonAncestorContainer;
            const scope = ca.nodeType === 1 ? ca : ca.parentNode;
            const targets = new Set([scope, ...(scope.querySelectorAll?.("*") || [])]);
            let p = scope.parentNode;
            while (p && p !== this._editArea && p !== document.body) {
              targets.add(p); p = p.parentNode;
            }
            for (const el of targets) {
              if (!range.intersectsNode(el)) continue;
              if (el.style && el.style.backgroundColor) {
                el.style.backgroundColor = "";
                if (!el.getAttribute("style")) el.removeAttribute("style");
              }
            }
          }
          this._stagedHi = null;
          // Sticky like _pickedFg — stays true until the user picks a
          // colour or clicks Reset again. Survives caret moves (so a
          // user who clicks back into a highlight can still type
          // unhighlighted text without re-clicking Reset).
          this._stagedHiClear = true;
          hiColorBtn.style.removeProperty("--pix-note-tbtn-tint");
        } else {
          // Apply highlight. ALWAYS arm the JS stage (`this._stagedHi`)
          // so the next typed character lands inside a bg span,
          // regardless of what the selection looked like at pick time.
          // Earlier, only the collapsed branch armed the stage and the
          // range branch cleared it — meaning if the user accidentally
          // had a selection (drag-select, double-click word), the
          // pick was applied to the selection but subsequent typing
          // outside that selection got the prior colour.
          //
          // Range case ALSO calls execCommand for immediate visual
          // feedback on the selected text. The beforeinput handler
          // (see _applyStagedHilite + core.mjs wiring) consumes the
          // stage one-shot on the next text input.
          this._stagedHi = c;
          // Picking a colour cancels any pending clear-stage.
          this._stagedHiClear = false;
          if (range && !range.collapsed && this._editArea.contains(range.startContainer)) {
            document.execCommand("hiliteColor", false, c);
            // Pattern #21: hiliteColor on a non-collapsed range clears
            // any staged foreColor. Replay so they combine on subsequent
            // typing inside the just-highlighted region.
            const stagedFg = textColorBtn.style.getPropertyValue("--pix-note-tbtn-tint").trim();
            if (stagedFg) {
              try { document.execCommand("foreColor", false, stagedFg); } catch (e) {}
            }
          }
          hiColorBtn.style.setProperty("--pix-note-tbtn-tint", c);
        }
        this._dirty = true;
        this._refreshActiveStates();
      },
    });
  });
  g3.appendChild(hiColorBtn);

  // Cursor-mirror is shared with the text-color picker — see the
  // comment above textColorBtn. Walks up looking for an inline
  // background-color and mirrors it onto this button's tint.

  // Page background colour — affects the whole editor interior AND the
  // on-canvas node body after save (WYSIWYG). Uses the compact picker
  // (same shell as text + highlight). Reset and the visual default
  // both resolve to #111111. Pattern #4's null branch in onPick is
  // kept intact for backward compat with notes saved under the older
  // picker that had a transparent / Clear tile.
  const bgColorBtn = el("button", "pix-note-tbtn");
  bgColorBtn.type = "button";
  bgColorBtn.title = "Page background color";
  bgColorBtn.appendChild(makeMaskIconMulti("bg-color"));
  const refreshBgSwatch = () => {
    const c = this.cfg.backgroundColor;
    // Only tint the icon when the user has an explicit hex in play.
    // Unset (undefined), Cleared (null), and legacy "transparent" all
    // leave the icon at the toolbar's default currentColor so it
    // reads as "no override active".
    if (typeof c === "string" && c && c !== "transparent") {
      bgColorBtn.style.setProperty("--pix-note-tbtn-tint", c);
    } else {
      bgColorBtn.style.removeProperty("--pix-note-tbtn-tint");
    }
  };
  refreshBgSwatch();
  bgColorBtn.addEventListener("mousedown", (e) => e.preventDefault());
  bgColorBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openPixaromaCompactColorPickerPopup(bgColorBtn, {
      initialColor: this.cfg.backgroundColor || "#111111",
      // Same 3-row 12-column layout as text + highlight, with the
      // transparent tile dimmed + unclickable: a transparent node
      // background would let the canvas grid bleed through which is
      // never what the user wants. Reset returns to the dark default
      // (#111111). The Pattern #4 clear-override path is no longer
      // reachable from inside the picker — see Bg picker comment
      // above for the implication.
      swatches: PIXAROMA_PALETTE.slice(0, 35),
      showClear: true,
      clearPosition: "last",
      clearDisabled: true,
      resetColor: "#111111",
      onPick: (c) => {
        // c == null is no longer reachable from this picker (showClear
        // is false and resetColor is a hex), but the branch is kept so
        // any legacy code path that calls onPick(null) still routes to
        // the documented Pattern #4 clear-override behaviour.
        if (c == null) {
          this.cfg.backgroundColor = null;
          if (this.node) {
            this.node.color = null;
            this.node.bgcolor = null;
          }
        } else {
          this.cfg.backgroundColor = c;
        }
        this._applyEditAreaBg?.();
        refreshBgSwatch();
        this._dirty = true;
      },
    });
  });
  g3.appendChild(bgColorBtn);

  tb.appendChild(g3);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Shared color-picker factory for Btn + Ln (and Bg/Ac before them).
  // Returns a configured button that: reads cfg[cfgKey], sets the named
  // CSS var on editArea, shows a bottom-border swatch in the picker's
  // color, opens openColorPop on click, and is live-previewed via the
  // onChange. Factory moves construction logic out of G5/G6 wiring so
  // the two new pickers don't duplicate the Ac pattern five ways.
  const makeColorPicker = (iconName, title, cfgKey, cssVar, fallback) => {
    const btn = el("button", "pix-note-tbtn");
    btn.type = "button";
    btn.title = title;
    // Two-layer icon: factory pickers are always color pickers, so the
    // outline-stays-white-and-drop-takes-tint treatment is the right
    // default. Single-layer (makeMaskIcon) is only used for plain
    // action buttons like link / code / separator.
    btn.appendChild(makeMaskIconMulti(iconName));
    const refreshSwatch = () => {
      const c = this.cfg[cfgKey] || fallback;
      btn.style.setProperty("--pix-note-tbtn-tint", c);
    };
    const apply = () => {
      const c = this.cfg[cfgKey] || fallback;
      this._editArea?.style.setProperty(cssVar, c);
    };
    refreshSwatch();
    apply();
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      openPixaromaColorPickerPopup(btn, {
        initialColor: this.cfg[cfgKey] || fallback,
        showClear: false,
        resetColor: fallback,
        onPick: (c) => {
          // Btn / Ln have no Clear option (showClear: false), so c is
          // never null. Reset returns to `fallback` (the picker's
          // default Pixaroma orange), same as the previous behaviour.
          this.cfg[cfgKey] = c || fallback;
          apply();
          refreshSwatch();
          this._dirty = true;
        },
      });
    });
    return btn;
  };

  // Group 4 — lists
  const g4 = el("div", "pix-note-tgroup");
  g4.appendChild(makeBtn(
    '<span class="pix-note-tbtn-maskicon pix-note-icon-list-dot"></span>',
    "Bulleted list", "", () =>
    document.execCommand("insertUnorderedList"), "insertUnorderedList"
  ));
  g4.appendChild(makeBtn(
    '<span class="pix-note-tbtn-maskicon pix-note-icon-list-number"></span>',
    "Numbered list", "", () =>
    document.execCommand("insertOrderedList"), "insertOrderedList"
  ));
  tb.appendChild(g4);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Group 5 — inserts
  const g5 = el("div", "pix-note-tgroup");

  const linkBtn = makeBtn(
    '<span class="pix-note-tbtn-maskicon pix-note-icon-link"></span>',
    "Insert link", "", () => {
    const selText = window.getSelection()?.toString() || "";
    const savedRange = saveRange(this._editArea);
    this._promptLinkUrl(selText).then((result) => {
      if (!result) return;
      this._editArea.focus();
      restoreRange(savedRange);
      const { url, label } = result;
      document.execCommand(
        "insertHTML", false,
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
      );
      this._dirty = true;
      this._refreshActiveStates();
    });
  });
  g5.appendChild(linkBtn);

  const isSelectionInsideTag = (tagNames) => {
    const s = window.getSelection();
    const anchor = s?.anchorNode;
    if (!anchor || !this._editArea?.contains(anchor)) return false;
    let n = anchor;
    while (n && n !== this._editArea) {
      if (n.nodeType === 1 && tagNames.includes(n.tagName)) return true;
      n = n.parentNode;
    }
    return false;
  };

  // Code block is a toggle: if cursor is inside an existing <pre>, clicking
  // unwraps it back to a paragraph; otherwise it inserts a new block with
  // the placeholder pre-selected. Inline <code> was removed — one
  // code style keeps the allowed HTML shapes simple and predictable.
  const codeBlockBtn = makeBtn(
    '<span class="pix-note-tbtn-maskicon pix-note-icon-code"></span>',
    "Code block", "", () => {
    // Toggle off: unwrap the current <pre> (and any nested <code>) into a
    // plain paragraph containing its text.
    if (isSelectionInsideTag(["PRE"])) {
      const sel = window.getSelection();
      const anchor = sel?.anchorNode;
      let pre = null;
      let n = anchor;
      while (n && n !== this._editArea) {
        if (n.nodeType === 1 && n.tagName === "PRE") { pre = n; break; }
        n = n.parentNode;
      }
      if (pre?.parentNode) {
        this._snapBefore?.();
        const p = document.createElement("p");
        p.textContent = pre.textContent;
        pre.parentNode.replaceChild(p, pre);
        const r = document.createRange();
        r.selectNodeContents(p);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
        this._snapAfter?.();
      }
      return;
    }
    // Unwrap inline <code> before proceeding (leftover from older notes
    // that had inline code). Nesting <pre> inside <code> violates HTML
    // spec, so we can't just fall through — but silently no-oping on
    // click is user-hostile. Walk up from the anchor, find the nearest
    // inline <code>, unwrap it in place, then continue into the normal
    // insert path below.
    if (isSelectionInsideTag(["CODE"])) {
      const sel = window.getSelection();
      let n = sel?.anchorNode;
      let codeEl = null;
      while (n && n !== this._editArea) {
        if (n.nodeType === 1 && n.tagName === "CODE") { codeEl = n; break; }
        n = n.parentNode;
      }
      if (codeEl?.parentNode) {
        this._snapBefore?.();
        const parent = codeEl.parentNode;
        while (codeEl.firstChild) parent.insertBefore(codeEl.firstChild, codeEl);
        parent.removeChild(codeEl);
        this._snapAfter?.();
      }
    }
    // Safety net: wrap any loose text/inline nodes at the editArea root in
    // <p> before we capture block references. Without this, typing on a
    // fresh note leaves raw text as a direct editArea child, and
    // findTopBlock() returns null for it — the code-block insert then
    // silently appends instead of replacing.
    this._normalizeEditArea?.();
    // Walk up to the top-level block inside editArea. We capture BOTH
    // endpoints of the selection as direct element references before the
    // modal opens — restoring a Range after the modal's focus change is
    // unreliable on Chrome (intersectsNode sometimes misses the first
    // block), so we keep references instead.
    const findTopBlock = (node) => {
      if (!node) return null;
      if (node.nodeType !== 1) node = node.parentNode;
      while (node && node.parentNode !== this._editArea && node !== this._editArea) {
        node = node.parentNode;
      }
      return node && node.parentNode === this._editArea ? node : null;
    };
    let startBlock = null, endBlock = null, wasCollapsed = true;
    const sel0 = window.getSelection();
    if (sel0?.rangeCount > 0) {
      const r0 = sel0.getRangeAt(0);
      wasCollapsed = r0.collapsed;
      startBlock = findTopBlock(r0.startContainer);
      endBlock = findTopBlock(r0.endContainer);
    }
    // Collect code through a modal so the block is built as one clean
    // DOM insert — avoids the edge cases that came from letting the user
    // type directly inside a fresh <pre><code> (cursor escaping, nested
    // inserts, node-vanishing on save).
    // Trim the selected-text preview: Chrome's selection.toString() across
    // block boundaries injects newlines/spaces around block edges, which
    // otherwise shows as a stray leading blank inside the code modal.
    const rawSel = window.getSelection()?.toString() || "";
    const selText = rawSel.replace(/^[\s\uFEFF]+|[\s\uFEFF]+$/g, "");
    this._promptCodeBlock(selText).then((code) => {
      if (code == null) return;
      this._snapBefore?.();
      // Build the replacement nodes: <pre><code>…</code></pre> plus a
      // trailing empty <p> so the user has somewhere to type below.
      const pre = document.createElement("pre");
      const codeEl = document.createElement("code");
      codeEl.textContent = code;
      pre.appendChild(codeEl);
      const trailing = document.createElement("p");
      trailing.appendChild(document.createElement("br"));
      // Walk from startBlock to endBlock (inclusive) using direct element
      // references captured before the modal. If either reference became
      // detached (e.g. user clicked elsewhere between open and Insert),
      // fall back to append.
      const toReplace = [];
      if (
        !wasCollapsed &&
        startBlock?.parentNode === this._editArea &&
        endBlock?.parentNode === this._editArea
      ) {
        let n = startBlock;
        while (n) {
          toReplace.push(n);
          if (n === endBlock) break;
          n = n.nextElementSibling;
        }
      }
      if (toReplace.length > 0) {
        const first = toReplace[0];
        this._editArea.insertBefore(pre, first);
        this._editArea.insertBefore(trailing, pre.nextSibling);
        for (const b of toReplace) {
          if (b.parentNode === this._editArea) this._editArea.removeChild(b);
        }
      } else if (startBlock && startBlock.parentNode === this._editArea) {
        startBlock.parentNode.insertBefore(pre, startBlock.nextSibling);
        pre.parentNode.insertBefore(trailing, pre.nextSibling);
      } else {
        this._editArea.appendChild(pre);
        this._editArea.appendChild(trailing);
      }
      const r = document.createRange();
      r.selectNodeContents(trailing);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      this._editArea.focus();
      this._snapAfter?.();
      this._dirty = true;
      this._refreshActiveStates();
    });
  });
  g5.appendChild(codeBlockBtn);

  const sepBtn = makeBtn(
    '<span class="pix-note-tbtn-maskicon pix-note-icon-separator"></span>',
    "Horizontal separator", "", () => {},
  );
  sepBtn.onclick = (e) => {
    e.preventDefault();
    this._insertSeparatorBlock(sepBtn);
  };
  g5.appendChild(sepBtn);

  const gridIcon = `<img class="pix-note-tbtn-icon" src="/pixaroma/assets/icons/ui/grid.svg" draggable="false">`;
  const gridBtn = makeBtn(gridIcon, "Insert grid (table)", "", () => {});
  gridBtn.onclick = (e) => {
    e.preventDefault();
    this._insertGridBlock(gridBtn);
  };
  g5.appendChild(gridBtn);

  const iconInsertBtn = makeBtn(
    '<span class="pix-note-tbtn-maskicon pix-note-icon-icon-insert"></span>',
    "Insert icon",
    "",
    () => {},
  );
  iconInsertBtn.onclick = (e) => {
    e.preventDefault();
    this._insertInlineIcon(iconInsertBtn);
  };
  g5.appendChild(iconInsertBtn);

  // Toolbar Ln colour picker removed in the per-instance overhaul.
  // Each separator / grid / folder hint now carries its own inline
  // colour set inside its modal. cfg.lineColor + --pix-note-line are
  // still wired (render.mjs sets the var on the body) so any LEGACY
  // content authored before per-instance colours keeps rendering with
  // whatever lineColor was saved at the time.

  // Active-state for link / code block: walk up from selection anchor and
  // toggle .active when the matching ancestor exists.
  this._activeChecks.push(() => {
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    let inA = false, inPre = false;
    if (anchor && this._editArea?.contains(anchor)) {
      let n = anchor;
      while (n && n !== this._editArea) {
        if (n.nodeType === 1) {
          if (n.tagName === "A") inA = true;
          else if (n.tagName === "PRE") inPre = true;
        }
        n = n.parentNode;
      }
    }
    linkBtn.classList.toggle("active", inA);
    codeBlockBtn.classList.toggle("active", inPre);
  });

  tb.appendChild(g5);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Group 6 — Pixaroma blocks
  const g6 = el("div", "pix-note-tgroup");

  // Unified "Button Design" entry — opens the new centred modal where
  // the user picks per-instance colour, button type (Download / View
  // Page / Read More / no icon), label, URL, and an optional size
  // hint. Folder bundling is GONE — there's a dedicated "Insert
  // folder hint" entry next to this one for that.
  const bdIcon = `<img class="pix-note-tbtn-icon" src="/pixaroma/assets/icons/ui/button-design.svg" draggable="false">`;
  const bdBtn = makeBtn(bdIcon, "Insert button (Download / View Page / Read More / plain)", "", () => {});
  bdBtn.onclick = (e) => {
    e.preventDefault();
    this._insertButtonBlock(bdBtn);
  };
  g6.appendChild(bdBtn);

  // Standalone folder-hint inserter. Each instance carries its own
  // colour so it doesn't track the toolbar Ln picker.
  const fhIcon = `<img class="pix-note-tbtn-icon" src="/pixaroma/assets/icons/ui/folder.svg" draggable="false">`;
  const fhBtn = makeBtn(fhIcon, 'Insert folder hint ("Place in: ComfyUI/...")', "", () => {});
  fhBtn.onclick = (e) => {
    e.preventDefault();
    this._insertFolderHintBlock(fhBtn);
  };
  g6.appendChild(fhBtn);

  const ytIcon = `<img class="pix-note-tbtn-icon" src="/pixaroma/assets/icons/ui/youtube.svg" draggable="false">`;
  const ytBtn = makeBtn(ytIcon, "Insert YouTube link", "", () => {});
  ytBtn.onclick = (e) => {
    e.preventDefault();
    this._insertYouTubeBlock(ytBtn);
  };
  g6.appendChild(ytBtn);

  const dcIcon = `<img class="pix-note-tbtn-icon" src="/pixaroma/assets/icons/ui/discord.svg" draggable="false">`;
  const dcBtn = makeBtn(dcIcon, "Insert Discord link", "", () => {});
  dcBtn.onclick = (e) => {
    e.preventDefault();
    this._insertDiscordBlock(dcBtn);
  };
  g6.appendChild(dcBtn);

  tb.appendChild(g6);
  tb.appendChild(el("div", "pix-note-tsep"));

  // Right-aligned undo / redo. Flex spacer pushes this group to the end
  // of the toolbar so it sits opposite the editing controls on the left.
  const spacer = el("div", "pix-note-tspacer");
  tb.appendChild(spacer);
  const gURight = el("div", "pix-note-tgroup");
  const undoLabel = `<img class="pix-note-tbtn-icon" src="/pixaroma/assets/icons/ui/undo.svg" draggable="false">`;
  const redoLabel = `<img class="pix-note-tbtn-icon" src="/pixaroma/assets/icons/ui/redo.svg" draggable="false">`;
  gURight.appendChild(makeBtn(undoLabel, "Undo (Ctrl+Z)", "pix-note-tbtn-accent", () => {
    this.doUndo?.();
  }));
  gURight.appendChild(makeBtn(redoLabel, "Redo (Ctrl+Shift+Z)", "pix-note-tbtn-accent", () => {
    this.doRedo?.();
  }));
  tb.appendChild(gURight);

  // View toggle: WYSIWYG vs raw-HTML. Sits on the far right so users
  // can flip views without hunting for the button.
  const tog = el("div", "pix-note-viewtoggle");
  const codeBtn = document.createElement("button");
  codeBtn.type = "button";
  codeBtn.textContent = "Code";
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.textContent = "Preview";
  prevBtn.classList.add("active");
  tog.appendChild(codeBtn);
  tog.appendChild(prevBtn);
  tb.appendChild(tog);

  const switchTo = (mode) => {
    if (mode === "code") {
      codeBtn.classList.add("active"); prevBtn.classList.remove("active");
      this._enterCodeView?.();
    } else {
      prevBtn.classList.add("active"); codeBtn.classList.remove("active");
      this._enterPreviewView?.();
    }
  };
  codeBtn.addEventListener("mousedown", (e) => e.preventDefault());
  prevBtn.addEventListener("mousedown", (e) => e.preventDefault());
  codeBtn.onclick = () => switchTo("code");
  prevBtn.onclick = () => switchTo("preview");

  this._afterToolbarBuilt?.();

  // Reflect selection state into button `.active` classes, and keep
  // the user's picked text/highlight color "sticky" across selection
  // moves. Chrome wipes the execCommand-staged foreColor / hiliteColor
  // every time the caret moves (click into another cell, arrow keys,
  // Tab across cells, click through a block boundary after a grid
  // insert), so subsequent typing reverts to the default color unless
  // we re-stage on every caret move. The restage is a no-op when the
  // selection is a range (non-collapsed) — user is actively selecting,
  // we must not apply the picked color to their selection mid-drag.
  if (!this._selectionChangeHandler) {
    this._selectionChangeHandler = () => {
      // Only update when the selection is inside our edit area, else queries
      // reflect whatever other element has focus.
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (!this._editArea?.contains(sel.anchorNode)) return;
      this._refreshActiveStates();
      // Mirror first (updates tints to match the cursor's effective
      // colour), then re-stage so the just-mirrored tint is what
      // subsequent typing produces.
      this._mirrorPickerColors?.();
      this._restageColors?.();
    };
    document.addEventListener("selectionchange", this._selectionChangeHandler);
  }
};

// Cursor-mirror: walk up from the caret to the nearest inline
// `style.color` (text picker tint) and `style.backgroundColor`
// (highlight picker tint). Found → set --pix-note-tbtn-tint to the
// matching hex on the button. Not found → remove the property so the
// icon falls back to currentColor (toolbar default). Skipped during
// the post-pick suppress window to avoid clobbering a fresh stage
// before the user types.
NoteEditor.prototype._mirrorPickerColors = function () {
  if (this._suppressMirrorUntil && Date.now() < this._suppressMirrorUntil) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  if (!this._editArea?.contains(sel.anchorNode)) return;
  // Range selections may span mixed colours — no single right answer
  // for the icon to display, so leave the tints alone.
  if (!sel.getRangeAt(0).collapsed) return;

  let el = sel.anchorNode;
  if (el && el.nodeType !== 1) el = el.parentElement;
  if (!el || !this._editArea.contains(el)) return;

  let fg = null, bg = null;
  let n = el;
  while (n && n !== this._editArea && n !== document.body) {
    if (n.style) {
      if (!fg && n.style.color) fg = n.style.color;
      if (!bg && n.style.backgroundColor) bg = n.style.backgroundColor;
    }
    if (fg && bg) break;
    n = n.parentElement;
  }

  const fgHex = colorToHex(fg);
  if (this._textColorBtn) {
    // Sticky pick (`_pickedFg`) locks the icon — match what subsequent
    // typing will produce regardless of the cursor's current parent
    // colour. Without the lock, after the suppress window expires the
    // icon would flip to the cursor's effective colour and
    // `_restageColors` would stage that colour, breaking the user's
    // explicit pick.
    if (this._pickedFg) {
      this._textColorBtn.style.setProperty("--pix-note-tbtn-tint", this._pickedFg);
    } else if (fgHex) {
      this._textColorBtn.style.setProperty("--pix-note-tbtn-tint", fgHex);
    } else {
      this._textColorBtn.style.removeProperty("--pix-note-tbtn-tint");
    }
  }

  const bgHex = colorToHex(bg);
  if (this._hiColorBtn) {
    // Pending pick (user picked a colour but hasn't typed yet) wins
    // over the cursor's effective bg. Otherwise the icon would flip
    // to whatever colour the user clicks into between pick and type
    // and the toolbar would lie about what the next character will
    // get.
    //
    // _stagedHiClear is the symmetric "no highlight" sticky flag set
    // by Reset / transparent. It must beat the cursor-bg mirror —
    // otherwise the icon flips back to the cursor's surrounding
    // highlight colour as soon as selectionchange fires after Reset.
    if (this._stagedHi) {
      this._hiColorBtn.style.setProperty("--pix-note-tbtn-tint", this._stagedHi);
    } else if (this._stagedHiClear) {
      this._hiColorBtn.style.removeProperty("--pix-note-tbtn-tint");
    } else if (bgHex) {
      this._hiColorBtn.style.setProperty("--pix-note-tbtn-tint", bgHex);
    } else {
      this._hiColorBtn.style.removeProperty("--pix-note-tbtn-tint");
    }
  }
};

// Apply a JS-staged highlight colour at the cursor before the next
// typed character lands. Wired up as a `beforeinput` listener on
// editArea (see core.mjs). Mirror of how Chrome handles foreColor
// staging natively for text-color: one-shot, consumed on first text
// input. If the cursor is already inside a span with the same bg
// (e.g. user picked, typed, kept typing in the same span), we skip
// the insertion to avoid pointless nesting.
NoteEditor.prototype._applyStagedHilite = function (e) {
  // Two stage modes:
  //  - _stagedHi (a hex string): apply this highlight on the next char
  //  - _stagedHiClear (true): escape the surrounding bg span on the
  //    next char so the typed text is NOT highlighted. Stored-marks
  //    pattern (ProseMirror / Slate / Quill / Lexical equivalent).
  if (!this._stagedHi && !this._stagedHiClear) return;
  if (e.inputType !== "insertText" && e.inputType !== "insertCompositionText") return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const r = sel.getRangeAt(0);
  if (!this._editArea?.contains(r.startContainer)) return;

  // Normalise the edit area so any loose text / inline / <br> nodes
  // that landed directly under editArea (e.g. after Chrome's native
  // backspace stripped a <p> wrapper) get re-wrapped in <p>. Range
  // positions survive the appendChild moves — the moved nodes are
  // still the same DOM nodes, just under a different parent. After
  // normalisation the cleanups + cursor-descent below all see a
  // well-formed structure with proper block wrappers.
  this._normalizeEditArea?.();

  // Range case: delete the selected content first so the insertion
  // happens at a collapsed point. The walk-up below then runs against
  // the post-deletion cursor location. Track wasNonCollapsed so the
  // matching-bg short-circuit further down can be skipped — see the
  // comment there for why.
  const wasNonCollapsed = !r.collapsed;
  if (wasNonCollapsed) r.deleteContents();

  // editArea-level cursor → descend into a child block. After
  // _placeCursorAtEnd (called on editor open) the cursor lives at
  // (editArea, childCount) — i.e. AT editArea, after the only empty
  // <p>. Without this descent, r.insertNode would place the span as
  // a sibling of the <p>, producing a stray newline ("test" lands on
  // line 2 of a brand-new note instead of line 1).
  if (r.startContainer === this._editArea) {
    const idx = r.startOffset;
    const children = this._editArea.childNodes;
    const target = children[idx - 1] || children[idx];
    if (target && target.nodeType === 1) {
      r.setStart(target, target.childNodes.length);
      r.collapse(true);
    }
  }

  // Empty-bg-span residue cleanup. After Ctrl+A + delete OR after
  // backspacing all content out of a highlighted span, the cursor
  // can land inside a now-empty `<span bg:colour></span>` residue.
  // If we leave it, the matching-bg short-circuit below returns
  // early "Chrome will extend this span naturally", but Chrome's
  // default insertion strips the empty inline element and inserts
  // plain text in the parent block — first-char-plain regression.
  // Walk up while parent is still an empty bg span and peel each
  // layer off, repositioning the range at each step. Runs
  // unconditionally — harmless no-op when there's no residue.
  {
    let p = r.startContainer.nodeType === 1
      ? r.startContainer
      : r.startContainer.parentElement;
    while (
      p &&
      p !== this._editArea &&
      p.nodeName === "SPAN" &&
      p.style?.backgroundColor &&
      p.childNodes.length === 0 &&
      p.parentNode
    ) {
      const parent = p.parentNode;
      const idx = Array.from(parent.childNodes).indexOf(p);
      parent.removeChild(p);
      r.setStart(parent, idx);
      r.collapse(true);
      p = parent;
    }
  }

  // Clear-stage path: insert the typed char OUTSIDE the surrounding
  // outermost bg span. Three sub-cases by cursor offset within the
  // span: at start → insert before; at end → insert after; in middle
  // → split the span and insert between halves. If there's no bg
  // ancestor, fall through to natural insertion (early return).
  if (this._stagedHiClear) {
    let n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    let bgAncestor = null;
    while (n && n !== this._editArea && n !== document.body) {
      if (n.style && n.style.backgroundColor) bgAncestor = n;
      n = n.parentElement;
    }
    if (!bgAncestor || !bgAncestor.parentNode) return;

    const parent = bgAncestor.parentNode;
    const measureRange = document.createRange();
    measureRange.selectNodeContents(bgAncestor);
    let measureOk = true;
    try { measureRange.setEnd(r.startContainer, r.startOffset); }
    catch (err) { measureOk = false; }
    const charsBefore = measureOk ? measureRange.toString().length : 0;
    const totalChars = bgAncestor.textContent.length;

    const data = typeof e.data === "string" ? e.data : "";
    // If a fg colour is staged (_pickedFg), wrap the typed char in a
    // colour span so it doesn't fall back to the editor's default
    // (white) — same rationale as the apply-branch fix below.
    let inserted, caretTarget, caretOffset;
    if (this._pickedFg) {
      const colorSpan = document.createElement("span");
      colorSpan.style.color = this._pickedFg;
      colorSpan.appendChild(document.createTextNode(data));
      inserted = colorSpan;
      caretTarget = colorSpan.firstChild;
      caretOffset = data.length;
    } else {
      inserted = document.createTextNode(data);
      caretTarget = inserted;
      caretOffset = data.length;
    }

    if (charsBefore <= 0) {
      parent.insertBefore(inserted, bgAncestor);
    } else if (charsBefore >= totalChars) {
      parent.insertBefore(inserted, bgAncestor.nextSibling);
    } else {
      // Split: extract from cursor to end of bgAncestor, re-wrap in a
      // sibling bg span. Inserted node lands between the two halves.
      const splitRange = document.createRange();
      splitRange.setStart(r.startContainer, r.startOffset);
      splitRange.setEnd(bgAncestor, bgAncestor.childNodes.length);
      const tailFrag = splitRange.extractContents();
      parent.insertBefore(inserted, bgAncestor.nextSibling);
      if (tailFrag.firstChild || tailFrag.textContent) {
        const tailSpan = document.createElement("span");
        tailSpan.style.backgroundColor = bgAncestor.style.backgroundColor;
        tailSpan.appendChild(tailFrag);
        parent.insertBefore(tailSpan, inserted.nextSibling);
      }
    }

    const newR = document.createRange();
    newR.setStart(caretTarget, caretOffset);
    newR.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newR);
    if (data) e.preventDefault();
    // Sticky: _stagedHiClear stays true (until user picks a colour or
    // hits Reset again). The next typed char re-runs this branch but
    // bgAncestor is now null (cursor in plain textNode) so it
    // early-returns and natural insertion takes over.
    return;
  }

  // Walk up to find the immediate bg-styled ancestor and check if its
  // colour matches the staged colour. Three outcomes:
  //  - Match + collapsed entry → short-circuit (Chrome extends span).
  //  - Match + just deleted → fall through to explicit insert; the
  //    matching residue may be empty and Chrome would strip it.
  //  - No match → escape the bg span before insert so the new staged
  //    span ends up as a SIBLING, not nested. Without escape, the new
  //    span lands inside the existing non-matching span and Chrome's
  //    rendering of nested same-area inline bg spans is unreliable
  //    (the user's bug: pick blue inside an orange span, type space,
  //    space stays orange-rendered even though structurally it's
  //    inside a blue inner span).
  let inMatchingBg = false;
  let bgAncestor = null;
  {
    let n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    while (n && n !== this._editArea && n !== document.body) {
      if (n.style && n.style.backgroundColor) {
        bgAncestor = n;
        const existing = colorToHex(n.style.backgroundColor);
        if (existing && existing.toLowerCase() === this._stagedHi.toLowerCase()) {
          inMatchingBg = true;
        }
        break;
      }
      n = n.parentElement;
    }
  }

  // Check if the matching bg span also matches the staged fg colour.
  // If user picked a new text colour while the cursor is inside an
  // existing highlight, the inner text node inherits the OLD fg from
  // the span - so MANUAL-EXTEND would silently keep typing in the
  // wrong colour. When fg differs, fall through to SPAN-INSERT below
  // so a fresh inner span gets the new colour applied.
  let fgMatches = true;
  if (inMatchingBg && this._pickedFg && bgAncestor) {
    const ancRaw = bgAncestor.style.color;
    const ancHex = ancRaw ? colorToHex(ancRaw) : null;
    if (!ancHex || ancHex.toLowerCase() !== this._pickedFg.toLowerCase()) {
      fgMatches = false;
    }
  }
  if (inMatchingBg && fgMatches && !wasNonCollapsed && r.startContainer.nodeType === 3) {
    // Cursor is inside a text node inside a matching bg span.
    // Chrome's native extension MISBEHAVES here for trailing
    // whitespace at inline boundaries: it empties the matching span
    // and merges the typed char (as &nbsp;) into the PREVIOUS
    // adjacent span. Confirmed via console logging.
    // Manually extend the text node and stop Chrome's default.
    //
    // Whitespace fix: if typing a regular space and the immediately-
    // preceding char is already space / nbsp, insert nbsp instead
    // so consecutive spaces stay visible. CSS `white-space: normal`
    // (default) collapses runs of regular spaces to one visible
    // space. Chrome's native handling injects nbsp via an
    // alternating pattern; we mimic the simpler "first regular,
    // rest nbsp" approach — line-wrap still works on the first
    // space of each run.
    let data = typeof e.data === "string" ? e.data : "";
    // Always convert typed space to nbsp inside a highlight span.
    // CSS white-space:normal collapses regular ASCII spaces at the
    // trailing edge of inline content, so the FIRST space typed in
    // a fresh bg span would visually disappear. nbsp does not
    // collapse and renders reliably. Trade-off: line-wrap cannot
    // break at these spaces - fine for short highlighted phrases.
    if (data === " ") data = " ";
    if (data) {
      r.startContainer.insertData(r.startOffset, data);
      const newR = document.createRange();
      newR.setStart(r.startContainer, r.startOffset + data.length);
      newR.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newR);
      e.preventDefault();
    }
    return;
  }

  // Escape a non-matching bg ancestor: position cursor outside it
  // (split if cursor is in the middle) so the upcoming insert places
  // the new staged span as a sibling. Same shape as the clear-stage
  // branch's escape logic.
  if (bgAncestor && !inMatchingBg && bgAncestor.parentNode) {
    const escParent = bgAncestor.parentNode;
    const escMeasure = document.createRange();
    escMeasure.selectNodeContents(bgAncestor);
    let escMeasureOk = true;
    try { escMeasure.setEnd(r.startContainer, r.startOffset); }
    catch (err) { escMeasureOk = false; }
    const escCharsBefore = escMeasureOk ? escMeasure.toString().length : 0;
    const escTotalChars = bgAncestor.textContent.length;
    const escParentIdx = Array.from(escParent.childNodes).indexOf(bgAncestor);
    const escNewR = document.createRange();
    if (escCharsBefore <= 0) {
      escNewR.setStart(escParent, escParentIdx);
    } else if (escCharsBefore >= escTotalChars) {
      escNewR.setStart(escParent, escParentIdx + 1);
    } else {
      const splitRange = document.createRange();
      splitRange.setStart(r.startContainer, r.startOffset);
      splitRange.setEnd(bgAncestor, bgAncestor.childNodes.length);
      const tailFrag = splitRange.extractContents();
      if (tailFrag.firstChild || tailFrag.textContent) {
        const tailSpan = document.createElement("span");
        tailSpan.style.backgroundColor = bgAncestor.style.backgroundColor;
        tailSpan.appendChild(tailFrag);
        escParent.insertBefore(tailSpan, bgAncestor.nextSibling);
      }
      escNewR.setStart(escParent, escParentIdx + 1);
    }
    escNewR.collapse(true);
    sel.removeAllRanges();
    sel.addRange(escNewR);
    // Refresh the working range — `r` is const, so re-fetch from sel
    // for the insert below. The block / <br>-cleanup also re-resolves
    // r.startContainer via sel.
  }
  // Re-fetch range in case escape moved it.
  const insertR = sel.getRangeAt(0);

  // Empty-block <br> filler cleanup. When the cursor sits inside an
  // empty <p><br></p> (Chrome's placeholder for an empty editable
  // block), our manual `insertNode(span)` would slot the span next
  // to the <br>, producing a stray newline ("test" on line 2 instead
  // of line 1 for a brand-new note). Same scenario right after a
  // Ctrl+A + delete: deleteContents can leave the block empty with a
  // fresh <br> filler. Strip the placeholder first so the span ends
  // up as the only child of the block. Chrome does this same cleanup
  // natively when typing into an empty contenteditable; we mirror it.
  {
    const block = insertR.startContainer.nodeType === 1
      ? insertR.startContainer
      : insertR.startContainer.parentElement;
    if (
      block &&
      block !== this._editArea &&
      block.childNodes.length === 1 &&
      block.firstChild.nodeName === "BR"
    ) {
      block.removeChild(block.firstChild);
      insertR.setStart(block, 0);
      insertR.collapse(true);
    }
  }

  // Build a new bg span around the typed character and short-circuit
  // the browser's default insertion. Chrome's beforeinput resolves
  // the insertion target as a STATIC range captured before our
  // handler fires (see InputEvent.getTargetRanges()), so modifying
  // the selection alone does NOT redirect the typed character — it
  // would land in the original (un-bg) text node and leave the
  // empty span we inserted as invisible litter. Manual insert +
  // preventDefault is the only reliable path.
  //
  // Apply _pickedFg too — Chrome's foreColor staging only takes
  // effect during its NATIVE insertion path; our preventDefault
  // bypasses it, so the manually-inserted span would otherwise have
  // bg only and the typed char would be the editor's default fg
  // (white). Subsequent chars route through the inMatchingBg
  // short-circuit + Chrome-extends-naturally path so they pick up
  // foreColor — producing a "first-char-white-rest-orange"
  // regression after Ctrl+A + type when both fg and bg are set.
  const span = document.createElement("span");
  span.style.backgroundColor = this._stagedHi;
  if (this._pickedFg) span.style.color = this._pickedFg;
  if (typeof e.data === "string" && e.data.length > 0) {
    // First-char-into-fresh-span: convert space to nbsp so it
    // doesnt visually collapse at the trailing edge of inline
    // content (same rationale as the manual-extend branch).
    span.textContent = e.data === " " ? " " : e.data;
    insertR.insertNode(span);
    const newR = document.createRange();
    newR.setStart(span.firstChild, e.data.length);
    newR.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newR);
    e.preventDefault();
  } else {
    // Composition start (no data yet) — insert an empty span and
    // place the caret inside. The browser owns the eventual text
    // insertion via its composition lifecycle.
    insertR.insertNode(span);
    const newR = document.createRange();
    newR.selectNodeContents(span);
    newR.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newR);
  }
  // Sticky pick: _stagedHi stays set across cursor moves and typing
  // sessions until the user picks a different colour or hits
  // Reset / transparent. Symmetrical with text-color's _pickedFg.
};

NoteEditor.prototype._refreshActiveStates = function () {
  (this._activeChecks || []).forEach((fn) => fn());
};

// Re-stage the currently-picked text + highlight colors against the
// current selection. Called from block-insert paths after
// execCommand("insertHTML") of a block-level element (grid, code block,
// HR) — such inserts split the caret out of its current inline
// formatting context and silently drop any staged foreColor /
// hiliteColor. Without this, the user picks orange, inserts a grid,
// clicks into a cell, and typing is white until they re-pick orange.
//
// For inline inserts (button / YT / Discord pills), the helper is still
// safe to call: the stage is a no-op when no color has been picked yet,
// and a harmless re-apply of the same color when one has.
//
// Ordering mirrors the highlight-picker's Chrome-quirk fix (patterns
// #21): hiliteColor on a collapsed selection clears staged foreColor,
// so if both colors are set we apply highlight FIRST and foreground
// SECOND, leaving foreColor as the last-staged command.
NoteEditor.prototype._restageColors = function () {
  // Suppress for the same window the cursor-mirror uses. During the
  // ~1s after a pick, the picker's onPick has already direct-inserted
  // the bg span and replayed foreColor; restaging on top of that
  // re-triggers Chrome's hiliteColor-on-collapsed quirk and ends up
  // selecting the previously-highlighted region.
  if (this._suppressMirrorUntil && Date.now() < this._suppressMirrorUntil) return;
  const fg = this._textColorBtn?.style.getPropertyValue("--pix-note-tbtn-tint").trim();
  if (!fg) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  if (!this._editArea?.contains(sel.anchorNode)) return;
  // Must be collapsed — if it's a range, execCommand("foreColor") would
  // APPLY the picked color to the selection, overriding whatever the
  // user was trying to do (e.g. select text to bold it, or deliberately
  // not recolor it). Only stage against a caret.
  const r = sel.getRangeAt(0);
  if (!r.collapsed) return;
  try {
    document.execCommand("styleWithCSS", false, true);
    document.execCommand("foreColor", false, fg);
  } catch (e) {}
  // NOTE: hiliteColor restaging removed deliberately. With the mirror +
  // direct-DOM model, typed text inherits bg from the cursor's
  // containing span, so explicit hiliteColor staging is redundant. It
  // was actively harmful — execCommand("hiliteColor", c) on a collapsed
  // cursor inside an existing bg span expands the selection to wrap
  // the prior highlighted region, which the user then accidentally
  // overwrites by typing.
};

// Themed URL prompt that matches the editor's dark modal style (same look as
// the unsaved-changes confirm dialog). Returns Promise<{url, label}|null>.
// If `presetLabel` is non-empty (user had text selected before clicking),
// it pre-fills the label field; otherwise the URL is used as the label.
NoteEditor.prototype._promptLinkUrl = function (presetLabel, presetUrl) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "pix-note-confirm-backdrop";
    const box = document.createElement("div");
    box.className = "pix-note-confirm-box";
    const title = document.createElement("div");
    title.className = "pix-note-confirm-title";
    title.textContent = "Insert link";

    const urlLbl = document.createElement("div");
    urlLbl.className = "pix-note-linklbl";
    urlLbl.textContent = "URL";
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "pix-note-linkinput";
    urlInput.value = presetUrl || "https://";

    const labelLbl = document.createElement("div");
    labelLbl.className = "pix-note-linklbl";
    labelLbl.textContent = "Label (what you'll see in the note)";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "pix-note-linkinput";
    labelInput.value = presetLabel || "";
    labelInput.placeholder = "Leave empty to show the URL";

    const err = document.createElement("div");
    err.className = "pix-note-linkerr";

    const actions = document.createElement("div");
    actions.className = "pix-note-confirm-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "pix-note-btn";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.className = "pix-note-btn primary";
    okBtn.textContent = "Insert";
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);

    box.appendChild(title);
    box.appendChild(urlLbl);
    box.appendChild(urlInput);
    box.appendChild(labelLbl);
    box.appendChild(labelInput);
    box.appendChild(err);
    box.appendChild(actions);
    backdrop.appendChild(box);
    (this._el || document.body).appendChild(backdrop);

    const finish = (v) => { backdrop.remove(); resolve(v); };
    cancelBtn.addEventListener("click", () => finish(null));
    okBtn.addEventListener("click", () => {
      const url = urlInput.value.trim();
      if (!url) { finish(null); return; }
      if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
        err.textContent = "URL must start with http://, https://, or mailto:";
        urlInput.focus();
        return;
      }
      // Fully parse so we reject URLs the sanitizer would later drop —
      // e.g. 'https://' with no host. Without this check users could hit
      // Insert on the default 'https://' placeholder, the anchor would
      // be written into the DOM, and save-time sanitization would later
      // throw on new URL() and strip the whole anchor.
      try {
        const u = new URL(url);
        if ((u.protocol === "http:" || u.protocol === "https:") && !u.hostname) {
          err.textContent = "URL must include a domain (e.g. example.com)";
          urlInput.focus();
          return;
        }
      } catch {
        err.textContent = "That doesn't look like a valid URL";
        urlInput.focus();
        return;
      }
      const label = labelInput.value.trim() || url;
      finish({ url, label });
    });
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) finish(null);
    });
    requestAnimationFrame(() => {
      // If we pre-filled the label (user had selection), focus URL first.
      // Otherwise also focus URL — it's the required field.
      urlInput.focus();
      urlInput.select();
    });
  });
};

// Themed code-block prompt — multi-line textarea. Returns Promise<string|null>.
// Using a dialog instead of inserting a placeholder and letting the user type
// inside the contenteditable <pre><code> avoids a family of edge cases
// (cursor escaping the block, nested inserts, node-wiping on save).
NoteEditor.prototype._promptCodeBlock = function (presetCode) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "pix-note-confirm-backdrop";
    const box = document.createElement("div");
    box.className = "pix-note-confirm-box wide";
    const title = document.createElement("div");
    title.className = "pix-note-confirm-title";
    title.textContent = "Insert code block";
    const lbl = document.createElement("div");
    lbl.className = "pix-note-linklbl";
    lbl.textContent = "Paste or type your code (plain text, no formatting)";
    const ta = document.createElement("textarea");
    ta.className = "pix-note-codeinput";
    ta.rows = 10;
    ta.placeholder = "// your code here";
    ta.value = presetCode || "";
    const actions = document.createElement("div");
    actions.className = "pix-note-confirm-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "pix-note-btn";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.className = "pix-note-btn primary";
    okBtn.textContent = "Insert";
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    box.appendChild(title);
    box.appendChild(lbl);
    box.appendChild(ta);
    box.appendChild(actions);
    backdrop.appendChild(box);
    (this._el || document.body).appendChild(backdrop);
    const finish = (v) => { backdrop.remove(); resolve(v); };
    cancelBtn.addEventListener("click", () => finish(null));
    okBtn.addEventListener("click", () => {
      const v = ta.value;
      if (!v) { finish(null); return; }
      finish(v);
    });
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) finish(null);
    });
    requestAnimationFrame(() => { ta.focus(); });
  });
};
