# Note Pixaroma — Inline Icons Design

**Date:** 2026-04-21
**Branch:** Ioan
**Status:** Approved, ready for implementation plan

## Problem

Notes currently support rich text, links, headings, lists, code blocks, tables, and branded pill blocks (Download / View Page / Read More / YouTube / Discord). There's no way to drop a small SVG decoration inline into a title or paragraph — e.g. a download icon next to "Download:", a star next to a highlighted note, a folder icon next to a filesystem path. Users have no lightweight option between "no icon" and "full Button Design pill".

## Goals

- One-click insert of a user-provided SVG icon inline into text at caret position.
- Icons scale with surrounding text size (bigger next to an H1, smaller next to body text).
- Icons default to Pixaroma orange (`#f66744`), re-colorable via the existing text-color picker.
- Drop-and-discover workflow: user drops new SVGs into a folder, they appear in the picker after reload.
- Zero new JS dependencies; round-trips through the sanitizer; persists across save/reload; renders cleanly both in the editor and on the canvas.

## Non-goals

- In-popup color picker at insert time — v1 always inserts orange; user re-colors via text-color picker if needed. Additive in v2 if demanded.
- Per-insert size variants (S / M / L) — v1 uses a single `1.2em` scale. Additive in v2.
- Pencil edit-in-place — icons are 1 character wide; delete + re-insert is simpler than a pencil hover target.
- Icon categories / folders inside `assets/icons/note/` — flat folder for v1; subfolders are additive if the library grows past ~50 icons.
- Icon search box in the popup — flat scrollable grid is enough for the expected v1 library size (≤30 icons).
- Icon multicolor support — mask-image rendering is single-color-tintable. Multicolor icons would require inline `<svg>` elements, a different data shape, and different sanitizer rules. Deferred.
- Auto-reload on new file drop — requires a file-watcher or polling. User reloads the browser.
- Cross-editor reuse (Paint Studio / Image Composer etc. using the same library) — scoped to Note Pixaroma for v1. Folder name `note/` reflects this scoping.

## Approach

### Storage & discovery

User-provided SVGs live in `assets/icons/note/`. The folder is drop-and-discover:

- User adds a new SVG file → reloads the browser → the icon appears in the picker.
- Removing a file → reload → the icon disappears from the picker. Any note that referenced that icon by `data-ic="<slug>"` renders as a solid 1.2em × 1.2em colored rectangle (no mask-image matches, so the `background-color: currentColor` fills the whole box). Ugly but deliberate — signals "missing icon" loudly so the user notices and fixes it. See the Edge Cases section below for the full rationale.
- Filename conventions: kebab-case, underscores also accepted as separators during label derivation. Mixed case allowed — uppercase acronym filenames like `CLIP.svg`, `GGUF.svg`, `LORA.svg`, `VAE.svg` are common and should render with their original casing. The slug used in `data-ic` is exactly the filename minus `.svg`, case preserved.
- Label derivation rules (for the picker tooltip):
  - Split the stem on `-` and `_`.
  - For each segment: if it's all-uppercase → keep as-is (preserves acronyms like CLIP / VAE / GGUF). Otherwise → lowercase.
  - Join with spaces.
  - Uppercase the first letter of the joined string.
  - Examples:
    - `download-model.svg` → "Download model"
    - `CLIP.svg` → "CLIP"
    - `model-v7.svg` → "Model v7"
    - `my_icon.svg` → "My icon"
    - `ai-brain.svg` → "Ai brain"

### Backend route

New `GET /pixaroma/api/note/icons/list` in `server_routes.py`:

```json
{
  "icons": [
    {
      "id": "download-model",
      "label": "Download model",
      "url": "/pixaroma/assets/icons/note/download-model.svg"
    },
    ...
  ]
}
```

Label derivation:
- Strip `.svg` extension.
- Replace `-` and `_` with space.
- Capitalize first letter. Rest stays lowercase.

Route implementation:
- Enumerate `*.svg` in `assets/icons/note/`.
- Use `_safe_path()` to resolve the folder path (reject `..` traversal).
- Sort alphabetically by label.
- Return `{"icons": [...]}`. On error or empty folder, return `{"icons": []}`.

SVG files themselves are served by the existing `/pixaroma/assets/{filename}` static route. If that route's current implementation doesn't already cover subfolders, extend it to allow `assets/icons/note/<filename>.svg` within the same `_safe_path()` scope.

### Frontend module & data flow

New file `js/note/icons.mjs` owns:
- Module-level cache: `let _icons = null` (null = not yet fetched).
- `ensureIcons()` — Promise-returning, fetches `/pixaroma/api/note/icons/list` if cache is null, else returns cached array.
- `buildIconCSS(icons)` — builds a CSS string `selector { mask-image: url(...) }` per icon, returns it.
- `injectIconCSS()` — idempotent; creates `<style id="pix-note-icon-css">` once, populates on first call.
- `renderIconHTML(id, color)` — returns the inline span string:
  ```js
  `<span data-ic="${id}" class="pix-note-ic" style="color:${color}"></span>`
  ```

Flow on first editor open:
1. `ensureIcons()` fetches the list.
2. `injectIconCSS()` creates the `<style>` tag with per-icon mask-image rules.
3. Toolbar button opens the picker popup, which reads from the cached list.

Subsequent opens in the same session reuse the cache — no refetch, no duplicate `<style>` tag.

### DOM shape of an inserted icon

```html
<span data-ic="download-model" class="pix-note-ic" style="color:#f66744"></span>
```

- `class="pix-note-ic"` — fixed class that provides size, alignment, and the `background-color: currentColor` layer for the mask.
- `data-ic="<slug>"` — identifies which icon. Consumed by a CSS attribute selector to pick the right `mask-image`.
- `style="color:<hex>"` — per-icon tint. `background-color: currentColor` in the base class pulls this into the mask fill. Default `#f66744` on insert; re-colored by `execCommand("foreColor")` when the icon is selected in the text-color picker.
- Empty element — content comes entirely from the CSS mask-image.

### CSS

Added to `injectCSS()` in `css.mjs`:

```css
.pix-note-ic {
  display: inline-block;
  width: 1.2em;
  height: 1.2em;
  vertical-align: -0.15em;
  background-color: currentColor;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  /* Prevent accidental caret landing inside the icon */
  -webkit-user-modify: read-only;
  user-select: none;
}
```

Per-icon rules are dynamically injected via `injectIconCSS()`:

```css
.pix-note-ic[data-ic="download-model"] {
  -webkit-mask-image: url(/pixaroma/assets/icons/note/download-model.svg);
  mask-image: url(/pixaroma/assets/icons/note/download-model.svg);
}
```

One rule per discovered icon. Grows with the folder. Rendered both in the editor's `.pix-note-editarea` scope AND in the on-canvas `.pix-note-body` scope because the rules use only the `.pix-note-ic` class, not a parent-scoped selector.

### Sanitizer additions (`sanitize.mjs`)

- `ALLOWED_CLASS_VALUES`: add `pix-note-ic`.
- `ALLOWED_ATTRS` for `<span>` (or equivalent): add `data-ic`.
- Validate `data-ic` value against `/^[A-Za-z0-9_-]{1,64}$/`. Mixed case intentionally allowed — acronym filenames (CLIP.svg, GGUF.svg, LORA.svg, VAE.svg) are part of the shipped library and must round-trip. Underscore allowed because label derivation accepts it as a word separator. On regex mismatch, strip the attribute but keep the span (degrades to a 1.2em colored rectangle per the Edge Cases section). Never silently delete the whole span — respects the unwrap-not-remove policy from Pattern #1.
- Do NOT validate that the slug corresponds to a real on-disk icon. Drop-and-discover means user A's note may reference an icon user B doesn't have; sanitizer has no way to know.
- `style` allowlist already covers `color` — no new CSS property needed.

### Toolbar button & picker popup

Location: Group 5 (inserts), between the Grid button and the Ln color picker. Matches the pattern of Link / Code / Separator / Grid which are also atomic inserts.

Button:
- New single-layer mask-icon `assets/icons/ui/icon-insert.svg` (user supplies; simple sparkle / icon glyph). Class: `pix-note-tbtn-maskicon pix-note-icon-icon-insert`.
- Title attribute: "Insert icon".
- No active state (one-shot insert; no selection context to reflect).

Popup (anchored under the button, same mechanics as `openColorPop` in `toolbar.mjs`):

```
┌───────────────────────────────┐
│ .pix-note-iconpop             │
│ ┌─┬─┬─┬─┬─┬─┬─┐               │
│ │▲│▼│★│♦│⚡│…│ │  ← 7 cols     │
│ ├─┼─┼─┼─┼─┼─┼─┤               │
│ │…│…│…│…│…│…│…│               │
│ └─┴─┴─┴─┴─┴─┴─┘               │
│ max-height 240px, overflow-y  │
└───────────────────────────────┘
```

- Container: `.pix-note-iconpop` — positioned absolute under the anchor button, 240px max-height, overflow-y auto, dark background matching `.pix-note-colorpop` (reuse similar CSS).
- Grid: `.pix-note-iconswatches` — CSS `grid-template-columns: repeat(7, 32px)`, 6px gap.
- Tile: `.pix-note-iconswatch` — 32×32 button, background the same dark toolbar color. Inside: a span rendered with the same `mask-image` technique, at 18×18, tinted `#f66744` so the picker shows insert-color. Hover → orange outline (like existing swatches). `title="<label>"` for browser tooltip.
- Empty state: when `icons.length === 0`, show a centered message "No icons found. Drop SVGs into `assets/icons/note/` and reload." No grid rendered.
- Dismiss: outside-click closes (same `onDocClick` pattern as `openColorPop`).

Wiring:
- `NoteEditor.prototype._insertInlineIcon = function(anchorBtn)` in `js/note/icons.mjs`.
- `saveRange(_editArea)` before opening popup.
- On tile click: focus edit area, restore range, `insertAtSavedRange(this, savedRange, renderIconHTML(id, "#f66744"))`. `insertAtSavedRange` already calls `_restageColors()` afterwards — surrounding text color stays sticky for the next keystroke.
- Close popup.

### Code view round-trip

No changes needed in `codeview.mjs`:
- Tokenizer handles `<span>` generically — it emits the opening tag, attributes, and closing tag as regular tokens.
- `prettyFormatHTML` treats `<span>` as inline and does not insert line breaks inside one — icons stay glued to the surrounding text.

Manual verification: insert icon → save → reopen → switch to Code view → the `<span data-ic="..." class="pix-note-ic" style="color:#f66744"></span>` should be visible and syntactically highlighted as a normal inline element.

### Paste behavior

The existing paste handler in `core.mjs` strips formatting and keeps plain text. An icon span pasted from elsewhere has no text content, so it effectively pastes as nothing. Acceptable for v1; additive fix later if users complain.

### Edge cases

- **Deleted icon file after note saved:** span stays in the DOM with its `data-ic` intact but no per-icon rule matches. Since the base class sets `background-color: currentColor` and no mask-image clips the box, the span renders as a solid 1.2em × 1.2em colored rectangle. Deliberately kept visible — a blank invisible gap would be worse (user wouldn't notice something's wrong). User sees the rectangle, deletes or re-inserts. v1 does not attempt to render a "broken icon" placeholder; the colored rectangle is the placeholder.
- **Backend route fails** (e.g. 500): `ensureIcons()` rejects, `_insertInlineIcon` catches and shows a short error toast "Could not load icon list". Toolbar button remains clickable — retry on next open.
- **Caret positioning after insert:** `execCommand("insertHTML")` places the caret immediately after the inserted span. Typing continues the surrounding paragraph (not stuck inside the empty span). `_restageColors` re-applies the picked text color for the next keystroke.
- **Icon in a link** (`<a href><icon></a>`): both sanitizer allow the combination. Rendered fine.
- **Icon in a heading:** `1.2em` scales with H1/H2/H3 font-size. Renders correctly.

## Failure modes summary

| Scenario | Behavior |
|---|---|
| Icon file deleted, note reloads | Colored 1.2em rectangle where icon was. User sees it and re-inserts. |
| Backend route fails | Error message when opening picker. Toolbar button still works on retry. |
| Empty folder | Picker shows "No icons found" message. |
| Malformed `data-ic` value in saved content | Sanitizer strips the attribute, span stays as empty 1.2em gap. |
| User pastes icon from outside the editor | Plain-texted (nothing pasted) per existing paste policy. |

## Testing (manual)

No test suite. Each phase of the plan documents manual verification steps.

Key scenarios:
1. Insert icon at caret in a paragraph → icon renders orange, 1.2em, baseline-aligned.
2. Insert icon in an H1 / H2 / H3 → scales proportionally with heading font-size.
3. Select icon + change text color to blue via picker → icon becomes blue.
4. Delete icon via backspace from right-of-icon position → removed in one keystroke.
5. Save note → close editor → reopen → icon still there.
6. Save note → refresh browser → icon renders on canvas body.
7. Switch to Code view → icon HTML is readable. Switch back → icon still renders.
8. Add a new SVG to the folder, reload browser, open editor → new icon appears in picker.
9. Empty folder or backend route failure → picker shows friendly message.
