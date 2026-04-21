# Note Pixaroma — Code-view Readability & Edit-in-Place Pencils Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Note Pixaroma Code view scannable (syntax-colored + pretty-printed) and let the user re-edit any dialog-created block via a hover pencil, without opening Code view.

**Architecture:** New `codeview.mjs` module holds a hand-written HTML tokenizer + pretty-printer + overlay-under-transparent-textarea DOM builder. Dialogs in `blocks.mjs` gain optional `initialValues` + `title` params and three extraction helpers (`extractButtonValues`, `extractLinkValues`, `extractCodeValues`). A single reusable floating pencil element, added to `core.mjs` alongside the editor's `_editArea` construction, uses delegated `mouseover` to reposition over the nearest editable block; clicking it dispatches to the matching dialog pre-filled with values extracted from the target block.

**Tech Stack:** Vanilla JS ES modules (`.mjs` for non-entry files), no new dependencies. All work inside `js/note/`, plus one append to `CLAUDE.md` in the final task.

**Spec:** `docs/superpowers/specs/2026-04-21-note-code-readability-design.md` (approved 2026-04-21).

**Branch:** `Ioan`. Local commits only. Every commit uses the one-shot identity:
```
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "<msg>"
```
Never push without explicit user request.

**Note on file placement deviation from spec:** the spec listed `render.mjs` for the floating pencil, but `render.mjs` handles *on-canvas* rendering, while the pencil must live inside the editor overlay's `_editArea` (built in `core.mjs`). This plan puts the pencil DOM + hover delegation in `core.mjs` where the `_editArea` lifecycle is managed.

---

## File Structure

**New:**
- `js/note/codeview.mjs` (~250 lines) — tokenizer, pretty-printer, overlay builder

**Modified:**
- `js/note/core.mjs` — Code-toggle uses overlay builder; floating pencil DOM + hover delegation + click handler
- `js/note/blocks.mjs` — `initialValues` / `title` params on both dialogs; three extract helpers; one `dispatchBlockEdit` helper
- `js/note/toolbar.mjs` — `_promptLinkUrl` gains optional `presetUrl` arg (plain-link pencil round-trip)
- `js/note/css.mjs` — token colors + overlay container + floating pencil styles
- `CLAUDE.md` — two new "Note Pixaroma Patterns" entries (task 7 only)

## Verification Approach

This project has no test suite. Every task ends with manual verification in a real ComfyUI instance (the working directory already *is* the live install). Console-driven unit checks for pure functions (tokenizer, pretty-printer, extractors) run via DevTools.

**Every task ends with a local commit** using the one-shot identity. Seven commits total.

---

## Task 1: HTML tokenizer + pretty-printer (pure functions)

**Files:**
- Create: `js/note/codeview.mjs`

- [ ] **Step 1: Create `codeview.mjs` with the tokenizer, pretty-printer, and escape helper**

Write `D:\ComfyTest\ComfyUI-Easy-Install\ComfyUI\custom_nodes\ComfyUI-Pixaroma\js\note\codeview.mjs` with the full contents below:

```javascript
// Code view support: HTML tokenizer, pretty-printer, and the
// <pre>-overlay-under-<textarea> DOM builder used by core.mjs for the
// Code toggle. No external dependencies — the tokenizer is a narrow
// regex-driven scanner tuned for the sanitized HTML shapes our editor
// produces (no script, no comments, no DOCTYPE, no CDATA).

// Top-level block tags. Each of these goes on its own line with one
// blank line between them when we pretty-print. Inline tags (<a>, <b>,
// <span>, …) stay on their parent's line.
const TOP_LEVEL_BLOCK_TAGS = new Set([
  "p","h1","h2","h3","ul","ol","pre","blockquote","hr","div",
]);

// <span class="pix-note-btnblock"> is also treated as a top-level block
// because renderButtonHTML() emits it as a standalone unit — pretty-
// printing it on its own line keeps button blocks visually grouped.
function isTopLevelBlockNode(el) {
  if (el.nodeType !== 1) return false;
  const tag = el.tagName.toLowerCase();
  if (TOP_LEVEL_BLOCK_TAGS.has(tag)) return true;
  if (tag === "span" && el.classList.contains("pix-note-btnblock")) return true;
  return false;
}

// Tokenize sanitized HTML into a flat array of { type, text } tokens.
// The overlay renderer maps each type to a CSS class; css.mjs defines
// the color per class. Token types:
//
//   "tag-punct"   – "<", ">", "</", "/>"
//   "tag-name"    – element names inside brackets
//   "whitespace"  – any whitespace run inside a tag or between tokens
//   "attr-name"   – attribute name
//   "attr-equals" – literal "="
//   "attr-value"  – quoted attribute value (quotes included)
//   "pix-class"   – a single pix-note-* class token inside a class=""
//                    value — split out so it can be bold-orange
//   "text"        – plain text content between tags
//   "entity"      – "&nbsp;", "&amp;", …
//
// Any input character that doesn't match a known pattern falls through
// as plain "text" so we never drop user content even if the tokenizer
// encounters something weird.
export function tokenizeHTML(html) {
  const out = [];
  const src = String(html || "");
  // Scan for a tag opening, entity, or run of text.
  const chunkRe = /<\/?[a-zA-Z][^>]*>|&[a-zA-Z#][a-zA-Z0-9]*;|[^<&]+|./g;
  let m;
  while ((m = chunkRe.exec(src)) !== null) {
    const s = m[0];
    if (s.startsWith("</")) {
      emitCloseTag(out, s);
    } else if (s.startsWith("<") && s.endsWith(">")) {
      emitOpenTag(out, s);
    } else if (s.startsWith("&") && s.endsWith(";")) {
      out.push({ type: "entity", text: s });
    } else {
      out.push({ type: "text", text: s });
    }
  }
  return out;
}

function emitCloseTag(out, raw) {
  // raw: "</tagname>" — we split into punct + name + punct.
  const inner = raw.slice(2, -1).trim();
  out.push({ type: "tag-punct", text: "</" });
  if (inner) out.push({ type: "tag-name", text: inner });
  out.push({ type: "tag-punct", text: ">" });
}

function emitOpenTag(out, raw) {
  // raw: "<tagname attr1="val" attr2='v'>" or "<br/>"
  const selfClose = /\/\s*>$/.test(raw);
  const bodyEnd = selfClose ? raw.lastIndexOf("/") : raw.length - 1;
  const inner = raw.slice(1, bodyEnd);
  out.push({ type: "tag-punct", text: "<" });

  // Element name.
  const nameMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(inner);
  if (!nameMatch) {
    // Malformed — emit the whole rest as text so nothing is lost.
    out.push({ type: "text", text: inner });
    out.push({ type: "tag-punct", text: selfClose ? "/>" : ">" });
    return;
  }
  out.push({ type: "tag-name", text: nameMatch[1] });
  let rest = inner.slice(nameMatch[1].length);

  // Attribute scanner. Greedy: whitespace, name, optional (=, value).
  const attrRe = /(\s+)|([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
  let am;
  while ((am = attrRe.exec(rest)) !== null) {
    if (am[1]) {
      out.push({ type: "whitespace", text: am[1] });
      continue;
    }
    const name = am[2];
    const assign = am[3];
    const rawValue = am[4];
    out.push({ type: "attr-name", text: name });
    if (assign !== undefined) {
      const eqIdx = assign.indexOf("=");
      const beforeEq = assign.slice(0, eqIdx);
      const afterEq = assign.slice(eqIdx + 1, assign.length - (rawValue ? rawValue.length : 0));
      if (beforeEq) out.push({ type: "whitespace", text: beforeEq });
      out.push({ type: "attr-equals", text: "=" });
      if (afterEq) out.push({ type: "whitespace", text: afterEq });
      if (rawValue !== undefined) {
        emitAttrValue(out, name.toLowerCase(), rawValue);
      }
    }
  }

  out.push({ type: "tag-punct", text: selfClose ? "/>" : ">" });
}

function emitAttrValue(out, name, raw) {
  // Only class="…" gets the pix-note-* class split; everything else is
  // one "attr-value" token so URLs etc. highlight as a unit.
  if (name !== "class" || !/pix-note-/.test(raw)) {
    out.push({ type: "attr-value", text: raw });
    return;
  }
  // Split the class list while preserving the surrounding quote chars.
  const firstChar = raw[0];
  const lastChar = raw[raw.length - 1];
  const hasQuotes = (firstChar === '"' || firstChar === "'") && firstChar === lastChar;
  const quote = hasQuotes ? firstChar : "";
  const inner = hasQuotes ? raw.slice(1, -1) : raw;
  if (quote) out.push({ type: "attr-value", text: quote });
  const partRe = /(\s+)|(pix-note-[a-zA-Z0-9-]+)|([^\s]+)/g;
  let pm;
  while ((pm = partRe.exec(inner)) !== null) {
    if (pm[1]) out.push({ type: "whitespace", text: pm[1] });
    else if (pm[2]) out.push({ type: "pix-class", text: pm[2] });
    else if (pm[3]) out.push({ type: "attr-value", text: pm[3] });
  }
  if (quote) out.push({ type: "attr-value", text: quote });
}

// Pretty-print sanitized HTML:
//   - Each top-level block on its own line.
//   - Exactly one blank line between top-level blocks.
//   - Inline children (<a>, <span>, <b>, …) stay on their parent line.
//   - <pre> content is preserved verbatim (never touch user code).
//
// Runs once on entering Code view. Does NOT reformat as the user types.
export function prettyFormatHTML(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(
    `<!doctype html><body>${html}</body>`, "text/html"
  );
  const body = doc.body;
  const parts = [];
  for (const child of Array.from(body.childNodes)) {
    const piece = serializeBlock(child);
    if (piece !== null) parts.push(piece);
  }
  // One blank line between blocks = join with "\n\n".
  return parts.join("\n\n");
}

function serializeBlock(node) {
  if (node.nodeType === 3) {
    const t = node.textContent.trim();
    return t ? escapeText(t) : null;
  }
  if (node.nodeType !== 1) return null;
  // <pre> — preserve inner verbatim.
  if (node.tagName.toLowerCase() === "pre") {
    return node.outerHTML;
  }
  if (isTopLevelBlockNode(node)) {
    return node.outerHTML;
  }
  // Non-block top-level (rare after sanitize) — emit as-is.
  return node.outerHTML;
}

function escapeText(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
```

- [ ] **Step 2: Console check — tokenizer sanity**

Restart ComfyUI or hard-reload `http://127.0.0.1:8188/` to pick up the new module, then in DevTools:

```javascript
const m = await import("/extensions/ComfyUI-Pixaroma/note/codeview.mjs");
console.table(m.tokenizeHTML('<a class="pix-note-dl" href="http://x/">hi</a>'));
```

Expected output: a table with rows showing at least `tag-punct "<"`, `tag-name "a"`, `whitespace " "`, `attr-name "class"`, `attr-equals "="`, `attr-value "\""`, `pix-class "pix-note-dl"`, `attr-value "\""`, (whitespace), `attr-name "href"`, `attr-equals "="`, `attr-value "\"http://x/\""`, `tag-punct ">"`, `text "hi"`, `tag-punct "</"`, `tag-name "a"`, `tag-punct ">"`.

The pix-note-dl class must have type `pix-class`; the URL value must have type `attr-value`.

- [ ] **Step 3: Console check — pretty-print sanity**

```javascript
const m = await import("/extensions/ComfyUI-Pixaroma/note/codeview.mjs");
console.log(m.prettyFormatHTML('<p>one</p><p>two</p><span class="pix-note-btnblock"><a class="pix-note-dl" href="http://x/">d</a></span>'));
```

Expected output (exact newlines):
```
<p>one</p>

<p>two</p>

<span class="pix-note-btnblock"><a class="pix-note-dl" href="http://x/">d</a></span>
```

Three lines of content, each separated by exactly one blank line.

- [ ] **Step 4: Commit**

```bash
cd /d/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma
git add js/note/codeview.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): HTML tokenizer + pretty-printer for Code view"
```

---

## Task 2: Code-view overlay scaffolding (no colors yet)

**Files:**
- Modify: `js/note/codeview.mjs` — add `buildCodeViewDOM` + `renderTokensPlain`
- Modify: `js/note/core.mjs` — `_enterCodeView` / `_enterPreviewView` use the new overlay
- Modify: `js/note/css.mjs` — baseline overlay container styles

- [ ] **Step 1: Append overlay builder to `codeview.mjs`**

Append to `js/note/codeview.mjs`:

```javascript
// Build the Code-view DOM: a container wrapping a <pre> highlight overlay
// and an editable <textarea>. Both share the same font, padding, and
// line-height so the overlay spans align exactly with the text the
// user types. The textarea is transparent (color: transparent via CSS,
// caret stays visible via CSS caret-color); the overlay has
// pointer-events: none so clicks pass through to the textarea.
//
// Returns an object { root, textarea, overlay, setValue, destroy }.
//
// Caller wires:
//   - scroll sync (we set up the listener in attachScrollSync below)
//   - live re-render on `input` (task 3 plugs in the colored renderer)
//
// Task 2 uses renderTokensPlain: one text node, no colors. Task 3
// replaces it with renderTokensColored.
export function buildCodeViewDOM(initialHtml) {
  const root = document.createElement("div");
  root.className = "pix-note-codewrap";

  const overlay = document.createElement("pre");
  overlay.className = "pix-note-hl";
  overlay.setAttribute("aria-hidden", "true");
  root.appendChild(overlay);

  const textarea = document.createElement("textarea");
  textarea.className = "pix-note-raw";
  textarea.spellcheck = false;
  textarea.autocapitalize = "off";
  textarea.autocomplete = "off";
  textarea.setAttribute("wrap", "soft");
  root.appendChild(textarea);

  const formatted = prettyFormatHTML(initialHtml || "");
  textarea.value = formatted;
  renderTokensPlain(overlay, formatted);

  // Scroll sync — overlay follows the textarea, one direction only
  // (overlay has no scrollbar of its own thanks to overflow: hidden).
  const syncScroll = () => {
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
  };
  textarea.addEventListener("scroll", syncScroll, { passive: true });

  // Live re-render (plain text in task 2; replaced in task 3).
  const onInput = () => {
    renderTokensPlain(overlay, textarea.value);
  };
  textarea.addEventListener("input", onInput);

  const destroy = () => {
    textarea.removeEventListener("scroll", syncScroll);
    textarea.removeEventListener("input", onInput);
    root.remove();
  };

  return { root, textarea, overlay, destroy };
}

// Plain text renderer — used by task 2 scaffolding. Task 3 replaces
// this with renderTokensColored, which emits colored spans.
export function renderTokensPlain(overlay, text) {
  overlay.textContent = text + "\n"; // trailing newline so the last
                                     // line of textarea scroll lines
                                     // up with the overlay
}
```

- [ ] **Step 2: Baseline CSS for the code-view container**

Find the existing `.pix-note-codearea` rule in `js/note/css.mjs` (search for `pix-note-codearea`) and REPLACE it with the following block. The new rules keep textarea + overlay perfectly aligned:

```css
/* ── Code view: <pre> overlay under transparent <textarea> ─────────── */
.pix-note-codewrap {
  position: relative;
  flex: 1;
  margin: 8px 12px 0;
  background: #111111;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  overflow: hidden;
  min-height: 120px;
}
.pix-note-hl,
.pix-note-raw {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 10px 12px;
  border: 0;
  font-family: "Consolas", "Menlo", "Monaco", monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  tab-size: 2;
}
.pix-note-hl {
  pointer-events: none;
  color: #e4e4e4;
  background: transparent;
  overflow: hidden;
  z-index: 1;
}
.pix-note-raw {
  resize: none;
  color: transparent;
  background: transparent;
  caret-color: ${BRAND};
  outline: none;
  overflow: auto;
  z-index: 2;
}
.pix-note-raw::selection { background: rgba(246, 103, 68, 0.35); color: transparent; }

/* Kept for back-compat in case any other code still targets the old
   class. Unused visually once task 2 lands. */
.pix-note-codearea { display: none; }
```

Note: `${BRAND}` is the imported constant at the top of `css.mjs` — the existing file already uses it in other rules.

- [ ] **Step 3: Rewire `_enterCodeView` / `_enterPreviewView` in `core.mjs`**

In `js/note/core.mjs`, find the top of the file and add this import alongside the existing imports:

```javascript
import { buildCodeViewDOM } from "./codeview.mjs";
```

Then REPLACE the existing `_enterCodeView` (around line 628) and `_enterPreviewView` (around line 646) with:

```javascript
NoteEditor.prototype._enterCodeView = function () {
  if (this._mode === "code" || !this._editArea) return;
  const htmlNow = sanitize(this._editArea.innerHTML || "");
  this._editArea.style.display = "none";

  // Destroy any prior overlay — keeping one around would stale-scroll
  // when the user toggles Code→Preview→Code with edits in between.
  if (this._codeView) {
    this._codeView.destroy();
    this._codeView = null;
  }
  const cv = buildCodeViewDOM(htmlNow);
  this._editArea.parentElement.appendChild(cv.root);
  cv.textarea.addEventListener("input", () => { this._dirty = true; });
  this._codeView = cv;
  this._codeArea = cv.textarea; // back-compat alias; toolbar still reads ._codeArea

  this._mode = "code";
  cv.textarea.focus();
};

NoteEditor.prototype._enterPreviewView = function () {
  if (this._mode !== "code") { this._mode = "preview"; return; }
  const raw = this._codeView?.textarea.value || "";
  const clean = sanitize(raw);
  this._editArea.innerHTML = clean;
  this._normalizeEditArea?.(this._editArea);
  if (this._codeView) {
    this._codeView.destroy();
    this._codeView = null;
    this._codeArea = null;
  }
  this._editArea.style.display = "";
  this._mode = "preview";
  this._editArea.focus();
};
```

- [ ] **Step 4: Manual verify**

1. Hard-reload ComfyUI in the browser (Ctrl+F5).
2. Drop a Note Pixaroma node, click Edit, add a paragraph, a heading, and one Button Design pill.
3. Click **Code** toggle.

Expected: HTML now appears **pretty-printed** — each `<p>`, `<h1>`, `<span class="pix-note-btnblock">` on its own line with exactly one blank line between them. Text is plain white monospace (no colors yet). Caret shows as orange. Typing updates the visible text. Scrolling works.

4. Click **Preview** toggle. Content round-trips back to the WYSIWYG view unchanged.

5. Click **Code** again. Content still pretty-prints.

If any of those fail, fix before committing.

- [ ] **Step 5: Commit**

```bash
cd /d/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma
git add js/note/codeview.mjs js/note/core.mjs js/note/css.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): pretty-printed Code view with textarea-over-overlay scaffold"
```

---

## Task 3: Syntax highlighting (colored tokens, live on input)

**Files:**
- Modify: `js/note/codeview.mjs` — add `renderTokensColored`, use it in `buildCodeViewDOM`
- Modify: `js/note/css.mjs` — token color rules

- [ ] **Step 1: Add the colored token renderer in `codeview.mjs`**

Append this function to `js/note/codeview.mjs` (after `renderTokensPlain`):

```javascript
// Colored token renderer: tokenize `text` and emit one <span> per token
// with a class per type. Must be the ONLY child-setter on `overlay` so
// repeated renders don't leak DOM.
export function renderTokensColored(overlay, text) {
  // Tokenize the raw textarea contents (not sanitized — we want to color
  // even malformed drafts the user is mid-typing).
  const tokens = tokenizeHTML(text);
  // Build a fragment; swap in one go so we never paint half-updated
  // overlay state.
  const frag = document.createDocumentFragment();
  for (const t of tokens) {
    const span = document.createElement("span");
    span.className = "tk-" + t.type;
    span.textContent = t.text;
    frag.appendChild(span);
  }
  // Trailing newline space so the last visible line of the textarea
  // aligns with the overlay when the textarea has just scrolled.
  frag.appendChild(document.createTextNode("\n"));
  overlay.textContent = "";
  overlay.appendChild(frag);
}
```

- [ ] **Step 2: Swap `renderTokensPlain` → `renderTokensColored` in `buildCodeViewDOM`**

In `js/note/codeview.mjs` `buildCodeViewDOM`, change the two call sites from `renderTokensPlain` to `renderTokensColored`:

Before:
```javascript
  renderTokensPlain(overlay, formatted);
  // …
  const onInput = () => {
    renderTokensPlain(overlay, textarea.value);
  };
```

After:
```javascript
  renderTokensColored(overlay, formatted);
  // …
  const onInput = () => {
    renderTokensColored(overlay, textarea.value);
  };
```

(Leave `renderTokensPlain` in the file — it's exported and might be useful as a fallback / for tests, but nothing calls it anymore.)

- [ ] **Step 3: Add token color CSS to `css.mjs`**

In `js/note/css.mjs`, right after the `.pix-note-raw::selection` rule added in task 2, append:

```css
/* Code-view syntax highlighting — see codeview.mjs tokenizeHTML for
   the full list of token types. Orange (brand) for the two things the
   user actually edits: attribute VALUES (URLs, labels) and pix-note-*
   classes. Everything else fades into the background. */
.pix-note-hl .tk-tag-punct   { color: #555; }
.pix-note-hl .tk-tag-name    { color: #555; }
.pix-note-hl .tk-attr-name   { color: #7a9cc6; }
.pix-note-hl .tk-attr-equals { color: #555; }
.pix-note-hl .tk-attr-value  { color: ${BRAND}; }
.pix-note-hl .tk-pix-class   { color: ${BRAND}; font-weight: 700; }
.pix-note-hl .tk-text        { color: #e4e4e4; }
.pix-note-hl .tk-entity      { color: #666; font-style: italic; }
.pix-note-hl .tk-whitespace  { /* no color — inherits */ }
```

- [ ] **Step 4: Manual verify**

1. Hard-reload ComfyUI.
2. Open a note with at least: a plain paragraph, a link, and one Button Design pill.
3. Click **Code**.

Expected visible coloring:
- All `<`, `>`, `</` punctuation → dim gray (barely visible against bg).
- Tag names (`p`, `a`, `span`) → dim gray.
- Attribute names (`href`, `class`, `target`, `rel`) → muted blue.
- URLs (the `"http://..."` string) → **Pixaroma orange**.
- Pixaroma classes (`pix-note-dl`, `pix-note-btnblock`, `pix-note-folderhint`) → **orange bold**.
- Text content between tags → bright white.
- `&nbsp;` → dimmer gray italic.

4. Type a new character inside the textarea. The colored overlay must update immediately on every keystroke — no flicker, no desync.

5. Scroll down past overflow. The overlay scrolls in perfect sync with the textarea.

6. Click **Preview**. Content round-trips.

- [ ] **Step 5: Commit**

```bash
cd /d/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma
git add js/note/codeview.mjs js/note/css.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): syntax-highlight Code view (orange for values + pix classes)"
```

---

## Task 4: Dialog `initialValues` + `title` plumbing

**Files:**
- Modify: `js/note/blocks.mjs` — extend `makeDialog` + `makeButtonDesignDialog` signatures

- [ ] **Step 1: Extend `makeDialog` signature in `blocks.mjs`**

Find the `makeDialog` function (around line 68). REPLACE its definition with the version below. Changes from the current definition:
- Fifth param `initialValues` (optional object) pre-fills input values by key.
- `title` is already a positional param, no change to signature.
- Return value unchanged.

```javascript
function makeDialog(anchorBtn, title, fields, onSubmit, initialValues) {
  const dlg = document.createElement("div");
  dlg.className = "pix-note-blockdlg";

  const rect = anchorBtn.getBoundingClientRect();
  dlg.style.left = `${Math.max(8, rect.left)}px`;
  dlg.style.top = `${rect.bottom + 6}px`;

  const h = document.createElement("h4");
  h.textContent = title;
  dlg.appendChild(h);

  const inputs = {};
  for (const [key, labelText, defaultVal, placeholder] of fields) {
    const row = document.createElement("div");
    row.className = "field";
    const lbl = document.createElement("label");
    lbl.className = "lbl";
    lbl.textContent = labelText;
    const inp = document.createElement("input");
    inp.type = "text";
    // initialValues wins over defaultVal — it's only passed when the
    // dialog opens from a pencil-edit, in which case we want the
    // block's actual current value, not the "fresh insert" default.
    const pre = (initialValues && Object.prototype.hasOwnProperty.call(initialValues, key))
      ? initialValues[key]
      : defaultVal;
    inp.value = pre || "";
    if (placeholder) inp.placeholder = placeholder;
    row.appendChild(lbl);
    row.appendChild(inp);
    dlg.appendChild(row);
    inputs[key] = inp;
  }

  const err = document.createElement("div");
  err.className = "pix-note-linkerr";
  dlg.appendChild(err);

  const footer = document.createElement("div");
  footer.className = "dlgfooter";
  const cancel = document.createElement("button");
  cancel.className = "pix-note-btn";
  cancel.textContent = "Cancel";
  const ok = document.createElement("button");
  ok.className = "pix-note-btn primary";
  // Button label reads "Update" when editing an existing block,
  // "Insert" when inserting a new one. Visual reminder that the
  // action replaces the block vs. appends a new one.
  ok.textContent = initialValues ? "Update" : "Insert";
  footer.appendChild(cancel);
  footer.appendChild(ok);
  dlg.appendChild(footer);

  document.body.appendChild(dlg);
  setTimeout(() => inputs[Object.keys(inputs)[0]]?.focus(), 10);

  function close() { dlg.remove(); document.removeEventListener("mousedown", onOutside, true); }
  const onOutside = (e) => { if (!dlg.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  cancel.onclick = close;
  ok.onclick = () => {
    const values = {};
    for (const k of Object.keys(inputs)) values[k] = inputs[k].value.trim();
    err.textContent = "";
    const showError = (msg) => { err.textContent = msg || ""; };
    const result = onSubmit(values, { showError });
    if (result !== false) close();
  };
  [...dlg.querySelectorAll("input")].forEach((i) =>
    i.addEventListener("keydown", (e) => { if (e.key === "Enter") ok.click(); })
  );
}
```

- [ ] **Step 2: Extend `makeButtonDesignDialog` signature**

Find `makeButtonDesignDialog` (around line 245). Make the following surgical edits:

Change the function signature line from:
```javascript
function makeButtonDesignDialog(anchorBtn, onSubmit) {
```
to:
```javascript
function makeButtonDesignDialog(anchorBtn, onSubmit, initialValues) {
```

Right after the existing `state` and `touched` declarations (around line 254-258), add:

```javascript
  // Editing an existing block: overlay initial values onto state and
  // mark both toggles as "touched" so a subsequent icon change doesn't
  // clobber the user's original choices.
  if (initialValues) {
    Object.assign(state, initialValues);
    touched.folderOn = true;
    touched.sizeOn = true;
  }
```

Change the header title from:
```javascript
  h.textContent = "Insert button";
```
to:
```javascript
  h.textContent = initialValues ? "Edit button" : "Insert button";
```

Change the footer Insert button label from:
```javascript
  ok.textContent = "Insert";
```
to:
```javascript
  ok.textContent = initialValues ? "Update" : "Insert";
```

Find the `refresh()` call at the bottom (`// Initial render` comment), and right BEFORE it, pre-populate the input fields when editing. Add this block:

```javascript
  // Pre-populate the three visible text inputs from state — these are
  // wired only to `state` on input, so the initial state values need
  // an explicit DOM write or the fields render empty even though the
  // preview reads state correctly.
  urlInput.value = state.url || "";
  labelInput.value = state.label || "";
  folderInput.value = state.folder || "";
  sizeInput.value = state.size || "";
  if (state.icon && state.icon !== "dl") setIcon(state.icon);
```

- [ ] **Step 3: Console check — makeDialog pre-fill**

```javascript
// From DevTools, with the editor closed: trigger a dummy dialog.
// We borrow the existing toolbar anchor for positioning.
const anchor = document.querySelector(".pix-note-tbtn") || document.body;
// Access the (unexported) makeDialog via the module — it's not exported
// so this check just verifies visually that pre-fill works via a
// block insert. Open the editor, click a button pill pencil in task 6
// — for now just skip the unit check and move on; task 5 tests the
// extraction round-trip.
```

(The extract helpers in task 5 give us the clean round-trip test. `makeDialog` is an internal of the module; we verify its pre-fill through the edit flow in task 7.)

- [ ] **Step 4: Manual verify — no regression on current insert flow**

1. Hard-reload ComfyUI.
2. Open a note, click the Button Design button in the toolbar → the dialog opens with header "Insert button", Insert button labeled "Insert". Fields empty. Click Cancel.
3. Click the YouTube block in the toolbar → dialog opens, header "Insert YouTube link", Insert button labeled "Insert". URL pre-fills as `https://www.youtube.com/@pixaroma`. Cancel.
4. Click Discord block → same, header "Insert Discord link", URL pre-fills as the Pixaroma discord invite. Cancel.
5. Insert a Button pill, a YouTube link, and a Discord link. All still render correctly on Save.

Regression gate: existing insert flows still work, no visible difference. The new params are dormant until task 6 calls them.

- [ ] **Step 5: Commit**

```bash
cd /d/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma
git add js/note/blocks.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): dialogs accept initialValues + title switches to 'Edit'"
```

---

## Task 5: Value-extraction helpers

**Files:**
- Modify: `js/note/blocks.mjs` — add and export `extractButtonValues`, `extractLinkValues`, `extractCodeValues`

- [ ] **Step 1: Add extract helpers at the bottom of `blocks.mjs`**

Append to `js/note/blocks.mjs` (below the existing `escapeHtml` function at the end of the file):

```javascript
// ── Extract value objects from rendered block DOM ─────────────────────
// Each helper returns the exact shape its matching dialog's onSubmit
// produces, so a round-trip (extract → pre-fill → submit → renderXxxHTML)
// is lossless. Returns null if the element doesn't match the expected
// shape — callers treat null as "no pencil for this block".

// Inverse of ICON_TO_CLASS — read the pill's class list to recover the
// icon id the user originally chose. Defaults to "dl" so unknown shapes
// at least round-trip as a Download pill.
const CLASS_TO_ICON = {
  "pix-note-dl": "dl",
  "pix-note-vp": "vp",
  "pix-note-rm": "rm",
};

export function extractButtonValues(el) {
  if (!el || el.nodeType !== 1) return null;
  if (!el.classList || !el.classList.contains("pix-note-btnblock")) return null;
  const a = el.querySelector(":scope > a");
  if (!a) return null;
  let icon = "dl";
  for (const c of a.classList) {
    if (CLASS_TO_ICON[c]) { icon = CLASS_TO_ICON[c]; break; }
  }
  // Size lives in a nested <span class="pix-note-btnsize">. Pull it
  // out (text only) before reading the pill label, then remove the
  // span from a temporary clone so label extraction sees only the
  // user's label text.
  const sizeSpan = a.querySelector(":scope > .pix-note-btnsize");
  const size = sizeSpan ? (sizeSpan.textContent || "").trim() : "";
  const sizeOn = !!(sizeSpan && size);
  const clone = a.cloneNode(true);
  const innerSize = clone.querySelector(":scope > .pix-note-btnsize");
  if (innerSize) innerSize.remove();
  const label = (clone.textContent || "").trim();
  // Folder hint is a sibling of the <a> inside the block wrapper. The
  // rendered text always has the "Place in: ComfyUI/" prefix; strip it
  // so we return the raw folder the user typed.
  const hint = el.querySelector(":scope > .pix-note-folderhint");
  const hintText = hint ? (hint.textContent || "").trim() : "";
  const prefix = "Place in: ComfyUI/";
  let folder = "";
  let folderOn = false;
  if (hintText.startsWith(prefix)) {
    folder = hintText.slice(prefix.length);
    folderOn = true;
  } else if (hintText) {
    // Legacy or manually-edited blocks — keep whatever's there.
    folder = hintText;
    folderOn = true;
  }
  return {
    icon,
    url: a.getAttribute("href") || "",
    label,
    folderOn,
    folder,
    sizeOn,
    size,
  };
}

// Dialog-shape for the generic makeDialog link fields. Also used for
// plain <a> (no pix-note-* class) and YT / Discord pencils.
export function extractLinkValues(el) {
  if (!el || el.nodeType !== 1 || el.tagName !== "A") return null;
  return {
    label: (el.textContent || "").trim(),
    url: el.getAttribute("href") || "",
  };
}

// Code block: accept <pre> (with or without child <code>). Returns the
// plain text the user originally typed.
export function extractCodeValues(el) {
  if (!el || el.nodeType !== 1 || el.tagName !== "PRE") return null;
  const code = el.querySelector(":scope > code");
  const text = (code ? code.textContent : el.textContent) || "";
  // Strip the trailing newline the insert path adds for rendering.
  return { code: text.replace(/\n$/, "") };
}
```

- [ ] **Step 2: Console check — round-trip a button block**

Reload and open DevTools. With the editor closed, create a tiny test block in memory:

```javascript
const m = await import("/extensions/ComfyUI-Pixaroma/note/blocks.mjs");
const tmp = document.createElement("div");
tmp.innerHTML = '<span class="pix-note-btnblock"><a class="pix-note-vp" href="https://example.com/" target="_blank" rel="noopener noreferrer">My Label<span class="pix-note-btnsize">9 GB</span></a><span class="pix-note-folderhint">Place in: ComfyUI/models/loras</span></span>';
const block = tmp.firstElementChild;
console.log(m.extractButtonValues(block));
```

Expected output:
```javascript
{
  icon: "vp",
  url: "https://example.com/",
  label: "My Label",
  folderOn: true,
  folder: "models/loras",
  sizeOn: true,
  size: "9 GB"
}
```

- [ ] **Step 3: Console check — link and code extract**

```javascript
const m = await import("/extensions/ComfyUI-Pixaroma/note/blocks.mjs");
const a = document.createElement("a");
a.href = "https://y.com/"; a.textContent = "hello";
console.log(m.extractLinkValues(a));    // → {label: "hello", url: "https://y.com/"}

const pre = document.createElement("pre");
pre.innerHTML = "<code>const x = 1;\n</code>";
console.log(m.extractCodeValues(pre));  // → {code: "const x = 1;"}
```

Both outputs must match exactly.

- [ ] **Step 4: Commit**

```bash
cd /d/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma
git add js/note/blocks.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): extractButton/Link/Code value helpers (dialog round-trip)"
```

---

## Task 6: Floating pencil + hover delegation (no click wiring yet)

**Files:**
- Modify: `js/note/core.mjs` — build pencil, attach `mouseover`/`mouseout`/`scroll` listeners on `_editArea`
- Modify: `js/note/css.mjs` — pencil styles

- [ ] **Step 1: Add pencil DOM + hover delegation to `core.mjs`**

In `js/note/core.mjs`, find the section where `this._editArea = editArea;` is set (around line 479). Immediately AFTER that line and BEFORE `this._mode = "preview";`, insert:

```javascript
    // Edit-in-place pencil — one reusable floating button that follows
    // the user's hover across editable blocks. See Task 6 of the Code
    // Readability plan for the full scope.
    this._installPencil(main, editArea);
```

Then append this method block to the end of `core.mjs` (after the last existing `NoteEditor.prototype.xxx = function () {};` definition in the file):

```javascript
// Floating pencil. Hover-delegation pattern: one reusable <button>
// positioned absolutely inside the editor's main container; we listen
// to mouseover/mouseout on editArea, find the closest editable block
// under the pointer via a single selector list, and reposition the
// pencil over the block's top-right corner. Task 6 ships the DOM and
// positioning; task 7 wires the click handler.
//
// The selector list MUST stay in sync with the dialog router in task 7
// (_dispatchBlockEdit). Any new editable block type needs to be added
// in both places.
const PENCIL_BLOCK_SELECTORS = [
  "span.pix-note-btnblock",
  "a.pix-note-yt",
  "a.pix-note-discord",
  "pre",
  // Plain anchors last so a Pixaroma-classed <a> matches above first.
  "a:not([class*='pix-note-'])",
].join(",");

NoteEditor.prototype._installPencil = function (main, editArea) {
  const pencil = document.createElement("button");
  pencil.type = "button";
  pencil.className = "pix-note-pencil";
  pencil.contentEditable = "false";
  pencil.setAttribute("aria-label", "Edit block");
  const icon = document.createElement("img");
  icon.src = "/pixaroma/assets/icons/layers/edit.svg";
  icon.draggable = false;
  pencil.appendChild(icon);
  pencil.style.display = "none";
  main.appendChild(pencil);
  this._pencil = pencil;
  this._pencilTarget = null;

  let hideTimer = null;
  const show = (target) => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    this._pencilTarget = target;
    this._repositionPencil();
    pencil.style.display = "";
  };
  const hide = () => {
    pencil.style.display = "none";
    this._pencilTarget = null;
  };
  const scheduleHide = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 150);
  };

  editArea.addEventListener("mouseover", (e) => {
    const t = e.target.closest?.(PENCIL_BLOCK_SELECTORS);
    if (!t || !editArea.contains(t)) return;
    show(t);
  });
  editArea.addEventListener("mouseout", (e) => {
    // Moving to the pencil itself should NOT hide it.
    const to = e.relatedTarget;
    if (to === pencil || pencil.contains(to)) return;
    scheduleHide();
  });
  pencil.addEventListener("mouseenter", () => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  });
  pencil.addEventListener("mouseleave", () => scheduleHide());

  // Recompute position on editArea scroll + window resize so the pencil
  // tracks its target during layout changes.
  editArea.addEventListener("scroll", () => this._repositionPencil());
  window.addEventListener("resize", this._onWindowResize = () => this._repositionPencil());
};

NoteEditor.prototype._repositionPencil = function () {
  const pencil = this._pencil;
  const target = this._pencilTarget;
  const main = pencil?.parentElement;
  if (!pencil || !target || !main) return;
  const mainRect = main.getBoundingClientRect();
  const tRect = target.getBoundingClientRect();
  // Bail if target scrolled out of view.
  if (tRect.bottom < mainRect.top || tRect.top > mainRect.bottom) {
    pencil.style.display = "none";
    return;
  }
  const top = tRect.top - mainRect.top + 4;
  const left = tRect.right - mainRect.left - 26;
  pencil.style.top = `${top}px`;
  pencil.style.left = `${left}px`;
};
```

Then find `NoteEditor.prototype._cleanup` (search for `_cleanup`) and inside it, add the resize-listener teardown. Near the existing event-handler cleanup lines, add:

```javascript
    if (this._onWindowResize) {
      window.removeEventListener("resize", this._onWindowResize);
      this._onWindowResize = null;
    }
```

- [ ] **Step 2: Pencil styles in `css.mjs`**

Append to `js/note/css.mjs` (at the end of the main CSS string, before the closing backtick):

```css
/* ── Edit-in-place floating pencil ────────────────────────────────── */
.pix-note-pencil {
  position: absolute;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: ${BRAND};
  color: #fff;
  cursor: pointer;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 120ms ease-out;
}
.pix-note-pencil[style*="display: none"] { opacity: 0; }
.pix-note-pencil:not([style*="display: none"]) { opacity: 0.95; }
.pix-note-pencil:hover { opacity: 1; }
.pix-note-pencil img {
  width: 12px;
  height: 12px;
  filter: brightness(0) invert(1);
  pointer-events: none;
}
/* Main container needs position:relative so absolute-positioned pencil
   resolves against it, not the viewport. The existing .pix-note-main
   rule may already have it — add if not. */
.pix-note-main { position: relative; }
```

If `.pix-note-main` already has `position: relative;` set in `css.mjs`, the duplicate rule is harmless (the later declaration wins, same value).

- [ ] **Step 3: Manual verify**

1. Hard-reload ComfyUI.
2. Open a note that contains: a Button Design pill, a YouTube block, a Discord block, a plain link, and a `<pre>` code block.
3. Move the mouse over the button pill → after a brief moment the orange pencil fades in at the top-right corner of the pill.
4. Move over each other block → pencil jumps to each one. Over plain paragraphs, H1/H2/H3 → **no pencil** (out of scope).
5. Move off a block → pencil hides after ~150 ms.
6. Move from a block *toward* the pencil → pencil stays visible (hover transfers correctly).
7. Click the pencil → nothing visibly happens (click handler not yet wired — expected).
8. Scroll the edit area → pencil tracks its target.
9. Resize the window → pencil tracks its target.
10. Close the editor and reopen → new pencil installs cleanly.

- [ ] **Step 4: Commit**

```bash
cd /d/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma
git add js/note/core.mjs js/note/css.mjs
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): floating pencil hover overlay on editable blocks"
```

---

## Task 7: Wire pencil click → edit flow + update CLAUDE.md

**Files:**
- Modify: `js/note/toolbar.mjs` — `_promptLinkUrl` gains optional `presetUrl` arg (for plain-link pencil parity)
- Modify: `js/note/blocks.mjs` — add `dispatchBlockEdit` that routes to the right dialog and replaces the block
- Modify: `js/note/core.mjs` — pencil click handler calls `dispatchBlockEdit`
- Modify: `CLAUDE.md` — two new Note Pixaroma Patterns entries

- [ ] **Step 0: Extend `_promptLinkUrl` to accept an optional preset URL**

In `js/note/toolbar.mjs`, find `NoteEditor.prototype._promptLinkUrl = function (presetLabel) {` (around line 802). Change the signature to:

```javascript
NoteEditor.prototype._promptLinkUrl = function (presetLabel, presetUrl) {
```

Then find the line that initializes the URL input value (around line 818):

```javascript
    urlInput.value = "https://";
```

Replace it with:

```javascript
    urlInput.value = presetUrl || "https://";
```

No other changes to `_promptLinkUrl` needed — all existing call sites pass only `presetLabel`, so `presetUrl` is `undefined` → falls back to `"https://"` (current behavior).

- [ ] **Step 1: Add `dispatchBlockEdit` in `blocks.mjs`**

Append to `js/note/blocks.mjs` (after the three extract helpers from task 5):

```javascript
// ── Pencil dispatcher: open the right dialog pre-filled, replace the
// target block on submit, bracket with undo snapshots. ───────────────
//
// `editor` is the NoteEditor instance (gives us _editArea, _snapBefore,
// _snapAfter, _promptLinkUrl, _promptCodeBlock, _dirty). `target` is
// the DOM element under the pencil.
NoteEditor.prototype._dispatchBlockEdit = function (target, anchorBtn) {
  if (!target || !this._editArea || !this._editArea.contains(target)) return;

  // Button Design block: span.pix-note-btnblock
  if (target.tagName === "SPAN" && target.classList.contains("pix-note-btnblock")) {
    const values = extractButtonValues(target);
    if (!values) return;
    makeButtonDesignDialog(anchorBtn, (v, ctx) => {
      const check = validateUrl(v.url);
      if (!check.ok) { ctx.showError(check.message); return false; }
      this._snapBefore?.();
      // renderButtonHTML returns "<span …>…</span>&nbsp;". When editing
      // we replace only the span, not the trailing &nbsp;; otherwise
      // consecutive pencil-edits would keep appending nbsp chars.
      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderButtonHTML(v);
      const newBlock = wrapper.querySelector(".pix-note-btnblock");
      if (newBlock) target.replaceWith(newBlock);
      this._snapAfter?.();
      this._dirty = true;
      return true;
    }, values);
    return;
  }

  // YouTube / Discord: a.pix-note-yt / a.pix-note-discord
  if (target.tagName === "A" && target.classList.contains("pix-note-yt")) {
    return openLinkEditor(this, target, "Edit YouTube link", "pix-note-yt", anchorBtn);
  }
  if (target.tagName === "A" && target.classList.contains("pix-note-discord")) {
    return openLinkEditor(this, target, "Edit Discord link", "pix-note-discord", anchorBtn);
  }

  // Plain link: <a> without any pix-note-* class. Reuse _promptLinkUrl
  // which already has the themed URL-validation UX.
  if (target.tagName === "A") {
    const current = extractLinkValues(target);
    this._editArea.focus();
    // Pass both label AND url as presets so the dialog round-trips the
    // existing link cleanly (step 0 extended _promptLinkUrl for this).
    this._promptLinkUrl(current.label, current.url).then((result) => {
      if (!result) return;
      this._snapBefore?.();
      target.setAttribute("href", result.url);
      target.textContent = result.label;
      this._snapAfter?.();
      this._dirty = true;
    });
    return;
  }

  // Code block: <pre>
  if (target.tagName === "PRE") {
    const current = extractCodeValues(target);
    this._promptCodeBlock(current?.code || "").then((code) => {
      if (code === null || code === undefined) return;
      this._snapBefore?.();
      const pre = document.createElement("pre");
      const codeEl = document.createElement("code");
      codeEl.textContent = code + (code.endsWith("\n") ? "" : "\n");
      pre.appendChild(codeEl);
      target.replaceWith(pre);
      this._snapAfter?.();
      this._dirty = true;
    });
    return;
  }
};

// YouTube + Discord pencils share one path: same dialog shape, same
// HTML output differing only in the pill class.
function openLinkEditor(editor, target, title, className, anchorBtn) {
  const values = extractLinkValues(target);
  makeDialog(
    anchorBtn,
    title,
    [
      ["label", "Label", "", ""],
      ["url", "URL", "", ""],
    ],
    (v, ctx) => {
      const check = validateUrl(v.url);
      if (!check.ok) { ctx.showError(check.message); return false; }
      editor._snapBefore?.();
      target.setAttribute("href", v.url);
      target.textContent = v.label || v.url;
      target.setAttribute("target", "_blank");
      target.setAttribute("rel", "noopener noreferrer");
      target.className = className;
      editor._snapAfter?.();
      editor._dirty = true;
    },
    values,
  );
}
```

- [ ] **Step 2: Wire pencil click in `core.mjs`**

In `js/note/core.mjs`, inside the `_installPencil` method you added in task 6, right before the final `editArea.addEventListener("scroll", …)` line, add the click handler:

```javascript
  pencil.addEventListener("mousedown", (e) => {
    // Prevent the editor from deselecting / re-placing the caret on
    // mousedown — we want the click to dispatch cleanly and any caret
    // change to be the dialog's doing.
    e.preventDefault();
    e.stopPropagation();
  });
  pencil.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const target = this._pencilTarget;
    if (!target) return;
    hide();
    this._dispatchBlockEdit?.(target, pencil);
  });
```

- [ ] **Step 3: Manual full-flow verify**

1. Hard-reload ComfyUI.
2. Create a note with one of each editable block: Button Design pill, YouTube link, Discord link, plain link, code block. Save.
3. Re-open the note (editor).
4. For each of the five blocks:
   - Hover → pencil appears.
   - Click pencil → matching dialog opens, title starts with "Edit", Insert button label reads "Update", fields pre-filled with current values.
   - Change one value and click Update → block updates in place. For the Button Design pill, the `&nbsp;` after the block must still be there (no duplicate, no missing).
   - **Ctrl+Z** → reverts to the pre-update value.
   - **Ctrl+Shift+Z** (or Ctrl+Y) → redoes.
5. Edit a button pill with an invalid URL (e.g. `https://`) → inline error appears in the dialog, dialog stays open. Fix the URL → Update succeeds.
6. Save the note → re-open → all edited blocks persist correctly.

- [ ] **Step 4: Update CLAUDE.md**

In `D:\ComfyTest\ComfyUI-Easy-Install\ComfyUI\custom_nodes\ComfyUI-Pixaroma\CLAUDE.md`, find the "Note Pixaroma Patterns (do not regress)" section. After the existing item #14 (the `#111111` default sync-point item), append:

```markdown
15. **Code view uses <pre>-overlay-under-transparent-<textarea>** — `js/note/codeview.mjs` `buildCodeViewDOM` layers a colored `<pre class="pix-note-hl">` (pointer-events: none) under a transparent `<textarea class="pix-note-raw">` that owns the caret + selection. Both MUST share identical font-family, font-size, line-height, padding, white-space, and word-break, or tokens desync from the caret. `.pix-note-raw { color: transparent; caret-color: ${BRAND}; }` hides the native textarea rendering while keeping the caret visible. Live re-tokenize on every `input` event via `renderTokensColored`. Pretty-print (`prettyFormatHTML`) runs **once on entering Code view** only — never on keystroke, because reformatting fights the caret and is widely disliked. Tokenizer output types live in `codeview.mjs` top comment and map to CSS classes `.pix-note-hl .tk-<type>` in `css.mjs`; adding a new token type requires editing both files.

16. **Edit-in-place pencil uses hover delegation with a single reusable floating button** — `js/note/core.mjs` `_installPencil` creates ONE `<button class="pix-note-pencil" contenteditable="false">` attached to the editor's `.pix-note-main` container, not one-per-block. A `mouseover` listener on `_editArea` uses `e.target.closest(PENCIL_BLOCK_SELECTORS)` to find the nearest editable ancestor and repositions the pencil. A 150 ms grace window on `mouseout` (cleared when the cursor enters the pencil itself) lets the user travel from block to pencil without the pencil disappearing. `contenteditable="false"` is critical — without it, typing can land inside the pencil. The selector list `PENCIL_BLOCK_SELECTORS` in core.mjs MUST stay in sync with `_dispatchBlockEdit` in blocks.mjs: add a new editable block type in BOTH places. Replacements bracket with `_snapBefore` / `_snapAfter`. For Button Design, replace only the `<span class="pix-note-btnblock">` — never the trailing `&nbsp;` — or consecutive edits compound whitespace. Validation (via `validateUrl`) returns `false` + `ctx.showError(msg)` to keep the dialog open on bad URL, same pattern as insert flow (pattern #7 above).
```

- [ ] **Step 5: Final commit**

```bash
cd /d/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma
git add js/note/blocks.mjs js/note/core.mjs js/note/toolbar.mjs CLAUDE.md
git -c user.name="pixaroma" -c user.email="pixaromadesign@gmail.com" commit -m "feat(note): pencil click opens pre-filled dialog, replaces block in place"
```

---

## Final regression verification (after all 7 commits)

Run this full pass before declaring done. Each bullet is a manual click-through:

- [ ] **Fresh node**: drop a new Note Pixaroma → title bar + body render in `#111111`, no content, placeholder text visible.
- [ ] **Bg picker**: open editor, change bg to a different color, save → whole node (title + body) recolors.
- [ ] **Code view**: pretty-printed, orange URLs, orange-bold pix-note-* classes, dim tags, muted attributes. Typing updates colors live. Scroll syncs.
- [ ] **Preview↔Code round-trip**: no content drift after toggling either direction twice.
- [ ] **Pencil on each block type**: Button Design / YouTube / Discord / plain link / code block. Dialog pre-fills with current values. "Update" submits. Ctrl+Z reverts. Ctrl+Y redoes.
- [ ] **Bad URL via pencil**: inline error shown, dialog stays open, typing not lost.
- [ ] **Save + reload**: pencil-edited blocks persist correctly.
- [ ] **Sanitizer**: editing a link in code view to a javascript: URL → after save, the anchor's text is preserved (unwrapped, not deleted — pattern #1).
- [ ] **Ctrl+Z in editor doesn't escape**: Ctrl+Z inside the editor never deletes the whole note from the graph (pattern #5).
- [ ] **Paste rich HTML**: pasted from a browser → comes in as plain text (pattern #12).
- [ ] **Toolbar active states**: place caret inside a bold word / heading / list → matching toolbar buttons light up orange.
- [ ] **Insert still works**: new Button Design / YT / Discord / link / code block inserts via toolbar all work as before, including inline URL errors.

When all pass, print a big DONE to signal the user it's ready for their manual testing pass.
