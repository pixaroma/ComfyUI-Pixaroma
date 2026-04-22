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
export function renderIconHTML(id, color) {
  const safeId = /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : "";
  // Optional `color` arg: if a hex is given, the icon carries an
  // inline style="color:..." — rendered via background-color:
  // currentColor in the .pix-note-ic CSS rule. The caller passes
  // whatever color the A text-color picker currently has staged,
  // so "pick green → insert icon" yields a green icon (matches
  // Notion-like "picked color wins for new content" UX).
  //
  // If `color` is missing or invalid, no inline style is emitted —
  // the icon then inherits currentColor from its surroundings
  // (default editor text color = white-ish, or an ancestor span's
  // color if the caret was inside one).
  //
  // Trailing &nbsp; is the caret's landing character — without it,
  // Chrome sometimes fails to place the caret after an empty
  // inline-block span. Same trick the Button Design pills use.
  const hasColor = /^#[0-9a-f]{3,8}$/i.test(color || "");
  const style = hasColor ? ` style="color:${color}"` : "";
  return `<span data-ic="${safeId}" class="pix-note-ic"${style}></span>&nbsp;`;
}

// Popup picker. Mirrors openColorPop in toolbar.mjs (positioning,
// outside-click dismiss, mousedown-preventDefault to keep the
// editor's selection alive). Not exported — only _insertInlineIcon
// uses it.
function openIconPop(anchorBtn, icons, onPick) {
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
  } else {
    const grid = document.createElement("div");
    grid.className = "pix-note-iconswatches";
    for (const ic of icons) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "pix-note-iconswatch";
      tile.setAttribute("data-ic", ic.id);
      tile.title = ic.label;
      // mousedown prevents the editArea from losing focus + selection
      // when the user clicks a tile.
      tile.addEventListener("mousedown", (e) => e.preventDefault());
      tile.addEventListener("click", (e) => {
        e.stopPropagation();
        onPick(ic.id);
        close();
      });
      const glyph = document.createElement("span");
      glyph.className = "pix-note-ic";
      glyph.setAttribute("data-ic", ic.id);
      // No inline color — the glyph inherits currentColor from the
      // popup, which is set to the editor's default text color (see
      // .pix-note-iconpop in css.mjs). Matches the insert-time icon
      // color so the picker is WYSIWYG for what will actually land.
      tile.appendChild(glyph);
      grid.appendChild(tile);
    }
    pop.appendChild(grid);
  }

  document.body.appendChild(pop);

  const onDocDown = (e) => {
    if (!pop.contains(e.target) && e.target !== anchorBtn) close();
  };
  function close() {
    document.removeEventListener("mousedown", onDocDown, true);
    pop.remove();
  }
  // Defer attach by one tick so the click that opened us doesn't
  // immediately close us.
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
  const savedRange = (() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    if (!this._editArea.contains(r.commonAncestorContainer)) return null;
    return r.cloneRange();
  })();

  const icons = await ensureIcons();
  injectIconCSS();

  openIconPop(anchorBtn, icons, (id) => {
    if (savedRange) {
      this._editArea.focus();
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
    // Read the A text-color picker's currently-staged color and stamp
    // it onto the icon. Chrome does NOT apply a staged foreColor to
    // raw HTML inserted via execCommand("insertHTML") — the stage is
    // consumed by TYPED characters, not by programmatic inserts.
    // Without this read-and-stamp, picking green in the A picker and
    // then inserting an icon would give a white icon, which is a
    // surprise for the user. Empty string → no inline style, icon
    // inherits currentColor (default behaviour for unpicked state).
    const pickedColor = this._textColorBtn?.style
      .getPropertyValue("--pix-note-tbtn-tint")
      .trim() || "";
    document.execCommand(
      "insertHTML",
      false,
      renderIconHTML(id, pickedColor),
    );
    this._restageColors?.();
    this._dirty = true;
    this._refreshActiveStates?.();
  });
};
