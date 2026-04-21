# Note Pixaroma — Insert Grid (table) Design

**Date:** 2026-04-21
**Branch:** Ioan
**Status:** Approved, ready for implementation plan

## Problem

Notes currently have no way to display tabular content (aspect-ratio reference tables, parameter sheets, step-by-step checklists with two or three columns). Users have to either paste prose or drop an image screenshot — neither edits well on the canvas.

## Goals

- One-click insert of a clean, dark-themed table (2–4 cols × 1–10 rows).
- Cells are directly typeable in the WYSIWYG editor (no per-cell dialog).
- Optional header row; off by default.
- Zero new dependencies; round-trips through the sanitizer; persists across save/reload.
- Renders cleanly in both the editor AND the on-canvas note body.

## Non-goals

- Drag-to-size grid picker (considered, rejected as unnecessary complexity).
- `colspan` / `rowspan` / cell-merging — power users can hand-edit Code view.
- Per-cell alignment or color pickers — default left-align / inherited color only.
- Add-row / add-column contextual buttons — deferred to a future spec.
- Pencil-edit for tables — different editing model (per-cell typing). Skipped for V1.
- Row/column resize handles — deferred.

## Approach

### Toolbar

A new "Insert grid" button (using existing `/pixaroma/assets/icons/ui/grid.svg`) placed in the Pixaroma group next to Button Design / YouTube / Discord in `js/note/toolbar.mjs`. Matches the style of the other three: icon-only, tooltip on hover, orange active background never (it's a one-shot insert, no active state).

### Insert dialog

Lives in `js/note/blocks.mjs` alongside the other block dialogs. Small floating modal anchored to the toolbar button:

- **Columns** — numeric stepper, 2–4, default 3
- **Rows** — numeric stepper, 1–10, default 3 (rows count does NOT include the header row)
- **First row as header** — pill toggle (reuses `.pix-note-toggle` style from Button Design), default OFF
- **Preview** — a tiny wireframe grid drawn from the current numbers (updates live); just CSS div boxes, not a real `<table>`
- Footer: Cancel / Insert

Same pattern as Button Design dialog: same background, same border, same button styles, same inline error row (unused here — no URL validation — but kept for consistency).

### Output HTML

```html
<table class="pix-note-grid">
  <thead>
    <tr><th><br></th><th><br></th><th><br></th></tr>
  </thead>
  <tbody>
    <tr><td><br></td><td><br></td><td><br></td></tr>
    <tr><td><br></td><td><br></td><td><br></td></tr>
    <tr><td><br></td><td><br></td><td><br></td></tr>
  </tbody>
</table>
```

- `<thead>` is only emitted when the header toggle is on; otherwise all rows go in `<tbody>`.
- Each cell contains `<br>` so contenteditable has a landing point for the caret (Chrome doesn't reliably let you click into a truly empty `<td>`).
- The `pix-note-grid` class is a marker for CSS scoping — future table variants can introduce other marker classes without breaking this one.

### Styling (`js/note/css.mjs`)

Dark theme, matches the editor's visual language:

- `table.pix-note-grid` — `border-collapse: collapse; width: 100%; table-layout: fixed; margin: 8px 0; font-size: 13px;` so columns share width equally and long content wraps inside its cell instead of stretching the table.
- `th, td` — `border: 1px solid #333; padding: 6px 8px; vertical-align: top; word-wrap: break-word;`
- `thead th` — `background: #1a1a1a; color: #fff; font-weight: 700; border-bottom: 2px solid ${BRAND};` — darker bg with brand-orange accent underline on the header row.
- `tbody tr td` — no background, inherits note's text color.
- Editor-only variant `.pix-note-editarea table.pix-note-grid td:focus, .pix-note-editarea table.pix-note-grid th:focus` — subtle orange outline when caret is inside a cell, so the user sees which cell has focus.

The CSS selectors scope both the on-canvas body AND the editor interior by prefixing with the two container classes (`.pix-note-body table.pix-note-grid` and `.pix-note-editarea table.pix-note-grid`), matching the pattern used for button pills.

### Sanitizer (`js/note/sanitize.mjs`)

Extend `ALLOWED_TAGS` with `table, thead, tbody, tr, th, td`. Extend `ALLOWED_CLASS_VALUES` with `pix-note-grid`.

No new attribute allowlist entries — tables don't need `colspan`/`rowspan` for V1. The existing `*` wildcard allows `class` + `style` on every tag, which is enough for the marker class + inherited inline styling (text alignment, color).

### Keyboard: Tab moves between cells

`contenteditable` doesn't handle Tab → next cell by default (it inserts a literal tab character or moves focus away from the note altogether). `js/note/core.mjs` `_keyBlock` gains a branch: if the selection is inside a `<td>` or `<th>`, intercept Tab:

- **Tab** → caret moves to the next cell in document order (tbody's next `<td>`, or first cell of next row, or stays in last cell).
- **Shift+Tab** → caret moves to the previous cell.
- If there IS no next/previous cell, swallow the Tab (don't escape the editor).
- Enter inside a cell keeps the browser default (adds a line within the cell).

### Code view pretty-print (`js/note/codeview.mjs`)

`<table>` gets added to `TOP_LEVEL_BLOCK_TAGS` so each inserted table renders on its own line with a blank line before and after. No further prettying — inner `<tr>` / `<td>` shapes stay inline on the same line (tables are verbose enough in HTML that breaking every tag to a new line would hurt more than help; top-level block separation is enough).

### On-canvas rendering

Existing `renderContent` in `js/note/render.mjs` uses `innerHTML = sanitize(...)`. Once the sanitizer allows `<table>` etc., tables render with no code change. The on-canvas CSS (scoped via `.pix-note-body`) styles them identically to the editor view.

### Saving + undo

Insertion uses the existing `insertAtSavedRange` pattern from the other block dialogs. Undo is automatic via the editor's manual `_history` (tracks `innerHTML` snapshots; one snapshot is taken on insert via the existing debounced-input path).

## Design decisions (locked)

- Approach A (steppers), NOT Approach B (drag-to-size).
- Header row DEFAULT OFF; toggle available.
- Max 4 columns × 10 rows.
- No pencil edit in V1; users type in cells directly.
- Tab moves between cells; Shift+Tab reverses. No other table shortcuts V1.

## File changes

**Modified:**
- `js/note/sanitize.mjs` — extend `ALLOWED_TAGS` + `ALLOWED_CLASS_VALUES` (~6 lines added)
- `js/note/css.mjs` — `.pix-note-grid` styles scoped to both `.pix-note-body` and `.pix-note-editarea` (~25 lines added)
- `js/note/blocks.mjs` — `makeGridDialog` helper + `NoteEditor.prototype._insertGridBlock` (~130 lines added)
- `js/note/toolbar.mjs` — new grid button in Pixaroma group (~15 lines added)
- `js/note/core.mjs` — `_keyBlock` gains Tab / Shift+Tab cell-navigation branch (~40 lines added)
- `js/note/codeview.mjs` — `TOP_LEVEL_BLOCK_TAGS` gains `"table"` (1 line)
- `CLAUDE.md` — one new "Note Pixaroma Patterns" entry for the grid conventions

**No new files.**

## Phasing — 3 commits

| # | Phase | Verifiable after this phase |
|---|---|---|
| 1 | Sanitizer allowlist + CSS + codeview block recognition | Paste `<table class="pix-note-grid">...</table>` in Code view, toggle Preview — renders as styled table. No insert UI yet. |
| 2 | Dialog + toolbar button + insert path | Toolbar shows grid button; click opens dialog; insert puts a working table in the note. Cells are typeable. |
| 3 | Tab / Shift+Tab cell navigation + CLAUDE.md entry | Tab inside a cell jumps to the next cell. CLAUDE.md has the new pattern entry. |

## Hard-won patterns to preserve

- Sanitizer remains the source of truth on what's allowed — adding `<table>` etc. is the ONLY way tables render; bypassing sanitizer is not a pattern (preserves security model).
- Insert dialog uses existing themed modal style; no `alert()`s (pattern #7).
- Insert bracketed through `insertAtSavedRange` so selection range is preserved around the modal (pattern #9).
- `_keyBlock` Tab intercept uses the same `e.stopImmediatePropagation()` guard used elsewhere so ComfyUI's workflow-tab shortcut doesn't fire (pattern #5's cousin).

## Open questions

None. Design is locked.
