// Inline-icons module — list cache, per-icon CSS injection, label
// derivation, insert HTML rendering. Toolbar insertion + popup UI
// land in Phase 4 (blocks.mjs + toolbar.mjs edits).
//
// See docs/superpowers/specs/2026-04-21-note-inline-icons-design.md
// for the design rationale.

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
// Never throws — on error, caches [] and returns it, so the UI can
// render "No icons found" without a try/catch at every call site.
export async function ensureIcons() {
  if (_iconsCache !== null) return _iconsCache;
  if (!_iconsPromise) {
    _iconsPromise = (async () => {
      try {
        const r = await fetch("/pixaroma/api/note/icons/list");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        _iconsCache = Array.isArray(j?.icons) ? j.icons : [];
      } catch (e) {
        console.warn("[pix-note/icons] list fetch failed, using empty:", e);
        _iconsCache = [];
      }
      return _iconsCache;
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
  const safeColor = /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#f66744";
  return `<span data-ic="${safeId}" class="pix-note-ic" ` +
    `style="color:${safeColor}"></span>`;
}
