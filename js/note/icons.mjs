// Inline-icons module — list cache, per-icon CSS injection, label
// derivation, insert HTML rendering. Toolbar insertion + popup UI
// land in Phase 4 (blocks.mjs + toolbar.mjs edits).
//
// See docs/superpowers/specs/2026-04-21-note-inline-icons-design.md
// for the design rationale.

// NoteEditor is unused in Phase 2 but intentionally imported now —
// Phase 4 will extend NoteEditor.prototype at module-top of this
// file. Removing the import now only to re-add it would churn the
// circular-dep analysis documented in core.mjs::open().
import { NoteEditor } from "./core.mjs";
import { createPixaromaColorPicker } from "../shared/color_picker.mjs";

// Module-level cache. `null` = not yet fetched; `[]` = fetched empty;
// `[icons...]` = fetched with content. Survives across editor opens
// within the same browser session — reload to re-pick-up new SVGs
// the user drops into assets/icons/note/.
let _iconsCache = null;
// Single-flight guard so two concurrent ensureIcons() calls share one
// fetch instead of firing two network requests.
let _iconsPromise = null;
// One-time CSS injection guard — per-icon mask-image rules are
// appended to <head> exactly once per page load.
let _cssInjected = false;

// Fetch the icon list if we haven't already. Returns the cached array.
// Never throws. Error contract:
//   - HTTP 2xx with body {"icons": [...]}         → cache + return it.
//   - HTTP 2xx with body {"icons": []}            → cache [] + return it
//                                                     (genuine empty folder,
//                                                     sticky until reload).
//   - HTTP non-2xx / network error / bad JSON     → return [] for THIS call,
//                                                     leave cache null so
//                                                     the NEXT call retries.
// So callers can render "No icons found" immediately without try/catch,
// AND transient server hiccups don't permanently brick the picker.
export async function ensureIcons() {
  if (_iconsCache !== null) return _iconsCache;
  if (!_iconsPromise) {
    _iconsPromise = (async () => {
      try {
        const r = await fetch("/pixaroma/api/note/icons/list");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        _iconsCache = Array.isArray(j?.icons) ? j.icons : [];
        return _iconsCache;
      } catch (e) {
        // Transient failure (network error, HTTP 5xx, malformed JSON)
        // → leave _iconsCache as null so the NEXT ensureIcons() call
        // re-fetches. Clear _iconsPromise here too so subsequent
        // callers don't latch onto this rejected-but-caught promise.
        // A successful fetch returning {"icons": []} for a genuinely
        // empty folder DOES cache [] (fast path above), which is the
        // right behavior for intentional empties.
        console.warn("[pix-note/icons] list fetch failed, will retry on next open:", e);
        _iconsPromise = null;
        return [];
      }
    })();
  }
  return _iconsPromise;
}

// Build the per-icon CSS block. One rule per icon. CSS.escape the slug
// defensively — the backend already validates the slug regex, but
// defense-in-depth is cheap here.
export function buildIconCSS(icons) {
  return (icons || []).map((ic) => {
    const sel = `.pix-note-ic[data-ic="${CSS.escape(ic.id)}"]`;
    return `${sel}{` +
      `-webkit-mask-image:url(${ic.url});` +
      `mask-image:url(${ic.url});}`;
  }).join("\n");
}

// Create the <style id="pix-note-icon-css"> element once and populate
// it with per-icon rules. Idempotent — subsequent calls no-op. Safe
// to call on every editor open.
export function injectIconCSS() {
  if (_cssInjected) return;
  const icons = _iconsCache || [];
  if (icons.length === 0) return; // nothing to inject; retry on next call
  // getElementById branch handles hot-module-reload scenarios where a
  // previous page evaluation left a <style id="pix-note-icon-css"> in
  // <head> but the module-level _cssInjected guard was reset. Reuse
  // the existing element and overwrite textContent rather than
  // appending a duplicate node.
  let style = document.getElementById("pix-note-icon-css");
  if (!style) {
    style = document.createElement("style");
    style.id = "pix-note-icon-css";
    document.head.appendChild(style);
  }
  style.textContent = buildIconCSS(icons);
  _cssInjected = true;
}

// Derive a human-readable label from a filename stem. Mirror of the
// backend _derive_icon_label — kept in JS for client-only paths (e.g.
// re-labeling a pasted icon in the future). For v1 the labels come
// from the backend directly, so this is available but not called.
export function deriveLabel(stem) {
  const parts = String(stem || "").split(/[-_]/);
  const mapped = parts.map((p) => {
    if (p && p === p.toUpperCase() && /[A-Za-z]/.test(p)) return p;
    return p.toLowerCase();
  });
  const joined = mapped.join(" ").trim();
  if (!joined) return stem;
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

// Build the inline HTML for a single icon insertion. Kept pure so the
// Phase 4 insert handler can call it directly, and so Code view /
// future paste handlers can produce identical output.
//
// `id` must match the sanitizer slug regex. If it doesn't, we emit a
// span with the bad id stripped — sanitizer would do the same at save
// time, so pre-strip keeps the DOM consistent.
export function renderIconHTML(id, color, size) {
  const safeId = /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : "";
  // Optional `color` arg: hex string. If valid, emits inline
  // style="color:..." rendered via background-color: currentColor in
  // the .pix-note-ic CSS rule. If missing/invalid, no inline style is
  // emitted and the icon inherits currentColor.
  //
  // Optional `size` arg: one of "s" | "m" | "l" | "xl" (lowercase).
  // "m" or missing/invalid emits NO data-size attribute (default
  // 1.2em from the base .pix-note-ic rule). Keeps saved markup
  // minimal for the most common case.
  //
  // Trailing &nbsp; is the caret's landing character - without it,
  // Chrome sometimes fails to place the caret after an empty
  // inline-block span. Same trick the Button Design pills use.
  const hasColor = /^#[0-9a-f]{3,8}$/i.test(color || "");
  const style = hasColor ? ` style="color:${color}"` : "";
  const sizeAttr = (size === "s" || size === "l" || size === "xl")
    ? ` data-size="${size}"` : "";
  return `<span data-ic="${safeId}"${sizeAttr} class="pix-note-ic"${style}></span>&nbsp;`;
}

// Popup picker. Mirrors openColorPop in toolbar.mjs (positioning,
// outside-click dismiss, mousedown-preventDefault to keep the
// editor's selection alive). Hosts the color swatches + size pills +
// icon grid; passes the picked id to onPick when a glyph is clicked.
// Reads/writes editor._iconPickerColor and editor._iconPickerSize for
// session-sticky picker state (Pattern #29, design 2026-05-06).
function openIconPop(anchorBtn, icons, editor, onPick) {
  const pop = document.createElement("div");
  pop.className = "pix-note-iconpop";
  const rect = anchorBtn.getBoundingClientRect();
  pop.style.left = `${rect.left}px`;
  pop.style.top = `${rect.bottom + 4}px`;

  if (!icons || icons.length === 0) {
    const msg = document.createElement("div");
    msg.className = "pix-note-iconpop-empty";
    msg.innerHTML =
      'No icons found. Drop SVG files into ' +
      '<code>assets/icons/note/</code> and reload the browser.';
    pop.appendChild(msg);
    document.body.appendChild(pop);
    const onDocDown = (e) => {
      if (!pop.contains(e.target) && e.target !== anchorBtn) close();
    };
    function close() {
      document.removeEventListener("mousedown", onDocDown, true);
      pop.remove();
    }
    setTimeout(() => document.addEventListener("mousedown", onDocDown, true), 0);
    return;
  }

  // Pixaroma Color Picker (shared module). Live preview: each change
  // writes editor._iconPickerColor and re-tints the icon-grid glyphs
  // so the user sees what will land before clicking an icon. Click an
  // icon to commit (the apply step). showClear is intentionally OFF
  // here - icons need a concrete color to render via background-color.
  const cp = createPixaromaColorPicker({
    initialColor: editor._iconPickerColor || "#f66744",
    showClear: false,
    resetColor: "#f66744",
    onChange: (c) => {
      editor._iconPickerColor = c;
      repaintGrid();
    },
  });
  pop.appendChild(cp.element);

  // Size pills row
  const sizeRow = document.createElement("div");
  sizeRow.className = "pix-note-iconpop-size-row";
  const sizes = [
    { id: "s",  label: "S"  },
    { id: "m",  label: "M"  },
    { id: "l",  label: "L"  },
    { id: "xl", label: "XL" },
  ];
  const sizePills = [];
  for (const sz of sizes) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "pix-note-iconpop-size-pill";
    pill.textContent = sz.label;
    pill.setAttribute("data-size-id", sz.id);
    pill.addEventListener("mousedown", (e) => e.preventDefault());
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      editor._iconPickerSize = sz.id;
      refreshSizeSelection();
      repaintGrid();
    });
    sizeRow.appendChild(pill);
    sizePills.push(pill);
  }
  pop.appendChild(sizeRow);

  function refreshSizeSelection() {
    const cur = editor._iconPickerSize || "m";
    for (const p of sizePills) {
      p.classList.toggle("selected", p.getAttribute("data-size-id") === cur);
    }
  }

  // Icon grid
  const grid = document.createElement("div");
  grid.className = "pix-note-iconswatches";
  const gridTiles = [];
  for (const ic of icons) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "pix-note-iconswatch";
    tile.setAttribute("data-ic", ic.id);
    tile.title = ic.label;
    tile.addEventListener("mousedown", (e) => e.preventDefault());
    tile.addEventListener("click", (e) => {
      e.stopPropagation();
      onPick(ic.id);
      close();
    });
    const glyph = document.createElement("span");
    glyph.className = "pix-note-ic";
    glyph.setAttribute("data-ic", ic.id);
    tile.appendChild(glyph);
    grid.appendChild(tile);
    gridTiles.push(glyph);
  }
  pop.appendChild(grid);

  function repaintGrid() {
    const c = editor._iconPickerColor;
    const sz = editor._iconPickerSize || "m";
    for (const glyph of gridTiles) {
      if (c) glyph.style.color = c;
      else glyph.style.removeProperty("color");
      // Size driven via attribute so the existing CSS attribute
      // selectors handle sizing (DRY with the inserted markup).
      if (sz === "m") glyph.removeAttribute("data-size");
      else glyph.setAttribute("data-size", sz);
    }
  }

  refreshSizeSelection();
  repaintGrid();

  document.body.appendChild(pop);

  const onDocDown = (e) => {
    if (!pop.contains(e.target) && e.target !== anchorBtn) close();
  };
  function close() {
    document.removeEventListener("mousedown", onDocDown, true);
    cp.destroy();
    pop.remove();
  }
  setTimeout(() => document.addEventListener("mousedown", onDocDown, true), 0);
}

// Toolbar handler — opens the picker anchored to the button.
// Captures the saved range BEFORE the popup opens so the insert
// lands at the user's caret position (same pattern as
// _insertButtonBlock / _insertGridBlock in blocks.mjs).
//
// Does its own insert (not via insertAtSavedRange) to avoid a
// circular import between blocks.mjs and icons.mjs. Calls
// _restageColors() after the insert so surrounding text color
// stays sticky for the next keystroke (Pattern #25).
NoteEditor.prototype._insertInlineIcon = async function (anchorBtn) {
  if (!this._editArea) return;
  // Capture the caret position synchronously so the async fetch
  // below doesn't lose it (focus moves to the body while loading).
  // Honor any selection that lands inside editArea, including the
  // browser's default offset-0 selection on a freshly-opened note -
  // the cursor is visibly blinking there, so users expect the icon
  // to land at the cursor. Only fall back to "end of note" when the
  // selection is genuinely outside the editArea (focus elsewhere).
  const savedRange = (() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    if (!this._editArea.contains(r.commonAncestorContainer)) return null;
    return r.cloneRange();
  })();

  const icons = await ensureIcons();
  injectIconCSS();

  openIconPop(anchorBtn, icons, this, (id) => {
    // Build the insert range. Always normalize first so every root
    // child is a block element. Then resolve a target Range to a
    // position INSIDE a block (never at the editArea root - Chrome's
    // execCommand("insertHTML") at the root wraps the insert in a
    // new block, breaking the visible layout).
    this._normalizeEditArea?.(this._editArea);
    this._editArea.focus();

    let insertRange = null;
    if (savedRange) {
      let r = savedRange;
      if (r.startContainer === this._editArea) {
        const childCount = this._editArea.childNodes.length;
        if (r.startOffset >= childCount) {
          // Caret was at or past the END of editArea's children -
          // collapse to the END of the last block (where the cursor
          // visibly was). Range.collapse(false) = collapse to end.
          const target = this._editArea.lastElementChild;
          if (target) {
            const r2 = document.createRange();
            r2.selectNodeContents(target);
            r2.collapse(false);
            r = r2;
          }
        } else {
          // Caret was BEFORE childNodes[startOffset]. Place at the
          // START of that child block. Range.collapse(true) = start.
          const target = this._editArea.childNodes[r.startOffset];
          if (target && target.nodeType === 1) {
            const r2 = document.createRange();
            r2.selectNodeContents(target);
            r2.collapse(true);
            r = r2;
          }
        }
      }
      insertRange = r;
    } else {
      // No prior selection inside editArea. Drop the caret at the
      // end of the last block (or editArea itself if empty).
      const last = this._editArea.lastElementChild;
      const r = document.createRange();
      if (last) {
        r.selectNodeContents(last);
        r.collapse(false);
      } else {
        r.selectNodeContents(this._editArea);
        r.collapse(false);
      }
      insertRange = r;
    }

    // Direct DOM insertion (bypasses execCommand("insertHTML")) so
    // Chrome can't wrap our inline content in a new block. Mirrors
    // the Grid insert pattern (CLAUDE.md Note Pattern #26).
    const color = this._iconPickerColor || "";
    const size  = this._iconPickerSize  || "m";
    const tmpl = document.createElement("template");
    tmpl.innerHTML = renderIconHTML(id, color, size);
    const frag = tmpl.content;
    // Capture refs before insertNode (which empties the fragment).
    const lastInserted = frag.lastChild;
    insertRange.collapse(true);
    insertRange.insertNode(frag);

    // Place caret AFTER the inserted nodes (after the trailing nbsp).
    if (lastInserted) {
      const after = document.createRange();
      after.setStartAfter(lastInserted);
      after.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(after);
    }

    this._restageColors?.();
    this._dirty = true;
    this._refreshActiveStates?.();
  });
};
