# Note Pixaroma — Code Readability & Edit-in-Place Design

**Date:** 2026-04-21
**Branch:** Ioan
**Status:** Approved, ready for implementation plan

## Problem

Two pains surfaced after shipping Note Pixaroma:

1. **Code view is unreadable.** Raw HTML is rendered as one uniform wall of gray monospace text on continuous lines. Finding "the URL of the third button" means visually parsing `<span>`, `<a>`, `class=`, `href=`, `target=` tokens that all look identical. Top-level block boundaries are invisible.

2. **Editing an existing button/link means reaching for Code view.** There is no way to re-open the Button Design dialog for an already-inserted pill. The user has to locate the `<a class="pix-note-dl" href="…">` in the HTML wall and hand-edit it — which is exactly the pain point #1 makes worse.

## Goals

- Make Code view genuinely usable at a glance, with zero new dependencies and no risk to existing save/sanitize flow.
- Let the user edit any dialog-created block (button, YouTube link, Discord link, plain link, code block) without ever opening Code view, by reopening the originating dialog pre-filled with the block's current values.

## Non-goals (explicit)

- Minimap, line numbers, find/replace inside Code view.
- Block outline sidebar (raised during brainstorm, deferred to a future spec).
- Pencil-edit for headings, HR, lists, bold/italic — caret + toolbar already handle these well.
- Auto-reformat HTML as you type — pretty-print runs **only** on entering Code view.
- Changes to sanitizer allowlists, Python node, widget default, or save JSON shape.

## Approach

Two cooperating features, shipped in one branch, seven phases / seven local commits.

### A. Code-view syntax highlighting + pretty-print

**Overlay-under-transparent-textarea technique** — zero new JS dependencies, no contenteditable fragility. A colored `<pre>` sits under a transparent `<textarea>`; both share exact font, padding, line-height; on every `input` event the textarea's value is re-tokenized and the overlay re-rendered; the overlay scroll-syncs with the textarea.

```
┌─────────────────────────────┐
│  <pre class="pix-note-hl">  │  ← colored spans, pointer-events: none
│  [colored HTML with spans]  │
├─────────────────────────────┤   both sit in the same container,
│  <textarea .pix-note-raw>   │   same font, same padding, same
│  [transparent, editable]    │   line-height, same word-wrap
└─────────────────────────────┘
```

**Token color scheme** (drives `css.mjs`):

| Token | Example | Color | Rationale |
|---|---|---|---|
| Structural tags | `<p>`, `</a>`, `<span>` | `#555` dim gray | Noise — fades into background |
| Attribute names | `href=`, `class=`, `target=` | `#7a9cc6` muted blue | Rarely edited, recognizable |
| **Attribute values** | `"http://vvv/"`, `"pix-note-dl"` | **`#f66744` Pixaroma orange** | **What the user edits — pops** |
| Text content | words between tags | `#e4e4e4` bright white | Second most-edited |
| Pixaroma classes | `pix-note-dl`, `pix-note-btnblock` | `#f66744` + bold | Locates block boundaries instantly |
| Entities | `&nbsp;` | `#666` italic | Noise |

Attribute VALUES and Pixaroma classes share the brand orange so the two things the user edits most glow together.

**Pretty-print rules** (runs once, on entering Code view):

- Each top-level block goes on its own line. Top-level = direct child of body in a parsed DOM: `<p>`, `<h1>`, `<h2>`, `<h3>`, `<ul>`, `<ol>`, `<pre>`, `<blockquote>`, `<hr>`, `<span class="pix-note-btnblock">`.
- Exactly one blank line between top-level blocks so block boundaries are a visible gap.
- Inline tags (`<a>`, `<b>`, `<span style="…">`, `<em>`, `<strong>`, `<code>`) stay on their parent line — don't over-wrap.
- Content inside `<pre>` is preserved verbatim; we never touch user code.
- Leading/trailing whitespace and stray empty text nodes are collapsed.

**Editing behavior:** user types freely. **No reformat on keystroke** — reformatting fights the caret and is widely disliked. Pretty-print runs only on entering Code view. Exit Code view → sanitize → save.

### B. Edit-in-place pencils (main WYSIWYG editor)

Pencils appear in the **default editing view** (not Code, not Preview).

```
┌────────────────────────────────────────────┐
│  Some text before the button.              │
│                                            │
│  ╭─────────────────────╮      ┌──┐         │
│  │ 📥 Model Name vae ·24G│      │ ✏ │  ← hover pencil
│  ╰─────────────────────╯      └──┘         │
│  📁 Place in: ComfyUI/models/loras         │
│                                            │
│  More text.                                │
└────────────────────────────────────────────┘
```

**Interaction:**

- Hover a supported block → orange circular pencil fades in, absolutely-positioned at top-right of the block.
- Click pencil → matching dialog opens pre-filled with current values.
- Submit → target block's `outerHTML` is replaced with the freshly-rendered HTML, sanitized, saved; undo snapshot bracketed.
- Cancel → nothing changes.
- Click anywhere other than the pencil → normal contenteditable behavior (caret placement, text selection) unchanged.

**DOM strategy — single floating pencil, not per-block:**

- One reusable `<button class="pix-note-pencil" contenteditable="false">` DOM node, repositioned on hover.
- Delegated `mouseover`/`mouseout` on `_editArea` finds the nearest matching block via `e.target.closest(SELECTOR_LIST)` and positions the pencil over its top-right corner.
- `contenteditable="false"` prevents typing from landing in the pencil.
- 150 ms grace period on `mouseout` so moving from block toward pencil doesn't hide it.
- Pencil position recomputed on `scroll` of `_editArea` or window resize.

**Editable block types (scope):**

| Block | Selector | Dialog | Pre-fill extracts |
|---|---|---|---|
| Button pill | `span.pix-note-btnblock` | `makeButtonDesignDialog` | icon (`dl`/`vp`/`rm`), label text, href, size span text, folder-hint text |
| YouTube link | `a.pix-note-yt` | YouTube `makeDialog` | label text, href |
| Discord link | `a.pix-note-discord` | Discord `makeDialog` | label text, href |
| Plain link | `a` not matching any `.pix-note-*` class | Link prompt (`_promptLinkUrl`) | label text, href |
| Code block | `pre > code` | Code prompt (`_promptCodeBlock`) | inner code text |

**Dialog changes (`blocks.mjs`):**

- `makeDialog(anchorBtn, title, fields, onSubmit)` gets optional fifth arg `initialValues` (object keyed by field `name`). When a field has an initial value, its input renders pre-filled.
- `makeButtonDesignDialog(anchorBtn, onSubmit)` gets optional third arg `initialValues` (`{icon, label, url, size, sizeOn, folder, folderOn}`). When passed, dialog title switches from "Button Design" to "Edit Button"; all inputs + toggles + preview reflect the values; `touched` flags start as true so icon changes don't clobber explicit user choices.
- New extraction helpers:
  - `extractButtonValues(el)` — reads a `span.pix-note-btnblock` → `{icon, label, url, size, sizeOn, folder, folderOn}`
  - `extractLinkValues(el)` — reads any `<a>` → `{label, url}`
  - `extractCodeValues(el)` — reads a `pre > code` → `{code}`
- All three helpers return `null` if the element doesn't match expected shape.
- Zero duplication: same dialogs used by the toolbar "+" buttons, just with `initialValues` passed.

**Undo, sanitize, save:** unchanged flow. Pencil-replace brackets itself with `_snapBefore` / `_snapAfter` (same pattern as code-block insert, item 10 of existing Note patterns in CLAUDE.md). Sanitizer runs on save as today.

## Design decisions (locked during brainstorm)

- **Color scheme:** confirmed. Pixaroma orange for both attribute values and Pixaroma classes.
- **Blank line between top-level blocks:** yes, one blank line.
- **Pretty-print timing:** on enter only, not live.
- **Pencil location:** main WYSIWYG editor (where the user spends time), not a separate Preview mode.
- **Block scope for pencil:** 5 block types listed above. Headings / HR / lists / bold are out — caret + toolbar handles them.
- **Pencil UI:** single floating node, orange, circular, top-right of block, subtle fade-in. No shadow (matches existing "flat" visual direction).

## File structure

**New:**
- `js/note/codeview.mjs` (~250 lines) — `tokenizeHTML(html)`, `prettyFormatHTML(html)`, `buildCodeViewDOM(container, initialHtml)`, `renderTokens(preEl, tokens)`, `attachScrollSync(textarea, overlay)`. Pure functions + one DOM builder.

**Modified:**
- `js/note/core.mjs` — Code toggle calls `buildCodeViewDOM(...)` instead of emitting a plain textarea; retrieves current HTML from the textarea on toggle back; pencil click handler: `_snapBefore()` → extract → open dialog → on submit `target.outerHTML = rendered` → `_snapAfter()`. (~50 lines touched.)
- `js/note/render.mjs` — single floating pencil DOM + delegated hover; on-click dispatches to the right dialog. Fires only in the main editor, not in canvas-rendered preview. (~80 lines added.)
- `js/note/blocks.mjs` — `initialValues` + conditional title in `makeDialog` and `makeButtonDesignDialog`; `extractButtonValues`, `extractLinkValues`, `extractCodeValues` helpers. (~100 lines added.)
- `js/note/css.mjs` — token colors (`.pix-note-hl .tag`, `.attr-name`, `.attr-value`, `.text`, `.pix-class`, `.entity`); overlay container (`.pix-note-codewrap`, `.pix-note-hl`, `.pix-note-raw`); floating pencil (`.pix-note-pencil`). (~40 lines added.)

**CLAUDE.md** — gets two new "Note Pixaroma Patterns (do not regress)" entries at the end (overlay-under-textarea technique; edit-in-place pencil delegation).

## Phasing — 7 local commits, each independently verifiable

| # | Phase | Verify after this phase | Commit touches |
|---|---|---|---|
| 1 | **Tokenizer + pretty-printer** — pure functions in `codeview.mjs`, no DOM yet | Console: `tokenizeHTML("<p>x</p>")` returns tokens; `prettyFormatHTML(rawHtml)` returns newlines between top-level blocks | `codeview.mjs` new |
| 2 | **Code view overlay scaffolding** — textarea-under-overlay DOM, scroll sync, pretty-print on enter. No colors yet — overlay is plain text | Open note → Code toggle → HTML is pretty-printed with blank lines between top-level blocks, still editable, scroll syncs, typing updates both layers | `codeview.mjs`, `core.mjs` |
| 3 | **Syntax highlighting** — color tokens, CSS, live re-tokenize on `input` | Same as phase 2 + URLs are orange, `pix-note-*` classes orange+bold, tags dim, attrs muted blue. Caret still visible (orange caret-color) | `codeview.mjs`, `css.mjs` |
| 4 | **Dialog `initialValues` + `title` plumbing** — extend `makeDialog` + `makeButtonDesignDialog`. No pencil yet | Console: open a dialog from toolbar with `initialValues` injected → dialog shows pre-filled, title says "Edit …" | `blocks.mjs` |
| 5 | **Value extraction helpers** — `extractButtonValues`, `extractLinkValues`, `extractCodeValues` | Console: pass a rendered block DOM → returns correct value object round-trippable through the dialog | `blocks.mjs` |
| 6 | **Floating pencil overlay** — single reusable DOM, hover delegation, positions over supported blocks. No click handler yet | Hover a button pill / YT link / Discord link / plain link / `<pre>` → orange pencil appears top-right; move away → hides after 150 ms | `render.mjs`, `css.mjs` |
| 7 | **Pencil click → edit flow + CLAUDE.md update** | Hover pencil → click → dialog opens pre-filled → submit → block updates in place → Ctrl+Z reverts. CLAUDE.md has two new entries | `core.mjs`, `render.mjs`, `CLAUDE.md` |

Each phase ends with a local commit using the one-shot identity `git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com"`. No push without explicit request.

## Manual verification plan

After all 7 phases, full regression pass:

1. Create a new note → default state still clean (`#111111` bg, no content).
2. Insert one of each: Button Design pill, YouTube link, Discord link, plain link, code block, H1/H2/H3, bullet list, HR, colored span.
3. **Code toggle:** view is pretty-printed, colored as designed, scroll works, edits save cleanly.
4. **Pencil-edit each block type:** hover → pencil appears → click → pre-filled dialog → change value → submit → block updates.
5. **Undo:** Ctrl+Z reverts a pencil-edit; Ctrl+Shift+Z / Ctrl+Y redoes.
6. **Sanitize still runs:** edit a pencil → submit a bad URL → inline error; submit a valid URL → saved output survives a reload.
7. **No regressions in existing patterns** (CLAUDE.md "Note Pixaroma Patterns" 1–14): link dialog still guards against empty host, invalid-href still unwraps not deletes, Ctrl+Z inside editor still doesn't escape to graph, paste still plain-text, etc.

## Hard-won patterns to preserve

All 14 existing "Note Pixaroma Patterns (do not regress)" from CLAUDE.md remain untouched by this work. Notable relevant ones:

- **#1 sanitizer unwraps on invalid href** — dialog submit path still rejects with inline error before sanitizer sees it.
- **#7 inline errors, not `alert()`** — dialog pre-fill doesn't change the error UX.
- **#9 capture range before modal** — N/A for pencil-edit (we're replacing, not inserting at caret), but still applies to toolbar "+" insertions.
- **#11 manual undo history** — pencil-replace brackets with `_snapBefore` / `_snapAfter`.
- **#14 default bg `#111111` in five places** — not touched.

## Open questions

None. Design is locked.
