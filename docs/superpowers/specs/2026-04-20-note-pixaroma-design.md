# Note Pixaroma — Design

**Date:** 2026-04-20
**Status:** Approved, ready for implementation planning
**Branch:** `Ioan`

## 1. Overview

`Note Pixaroma` is a new ComfyUI custom node — a pure visual annotation widget for documenting workflows inside ComfyUI. It replaces users' reliance on the built-in ComfyUI Note (markdown-based, hard to edit) with a professional WYSIWYG editor, preset Pixaroma branding, and a few Pixaroma-specific block types (model download button, YouTube link, Discord link).

- **Node name:** `Note Pixaroma`
- **Category:** `Pixaroma`
- **Inputs:** none
- **Outputs:** none (`OUTPUT_NODE = True`, `RETURN_TYPES = ()` — same pattern as `PixaromaLabel`)
- **Brand default:** Pixaroma orange `#f66744`, per-note overridable
- **Coexists** with built-in Note — different node, user picks which they want.

## 2. User Experience

### 2.1 On the canvas (read-mostly mode)

- Standard ComfyUI node chrome with title "Note Pixaroma" and the orange brand dot.
- Body renders the saved HTML content directly.
- Resizable by dragging the corner (width + height persisted).
- If content exceeds node height, a vertical scrollbar appears inside the node. Width wraps text.
- **Placeholder**: when content is empty, body shows `Add your workflow notes here…` in dim italic. Disappears on first edit save.
- **Edit button**: hidden until the pointer hovers the node. On hover, a small `✏ Edit` button fades in at the top-right of the node body. Clicking it opens the editor.
- **Double-click is a no-op** — intentional choice to prevent accidental editor opening when users are trying to drag/select the node.
- **No right-click menu entry** for editing — keeps editor entry strictly intentional.
- Clicks on in-body interactive elements (links, download/YouTube/Discord buttons) fire their action instead of dragging the node.
- Clicks on the node background still select/drag the node (standard ComfyUI behavior).

### 2.2 The editor (fullscreen overlay)

Opens when the user clicks the hover-reveal `✏ Edit` button.

**Shell:** same pattern as Label Pixaroma (fullscreen dim overlay, centered panel, logo + title in header, close button, Help/Cancel/Save in footer).

**Toolbar** (grouped left → right):

1. **Text style** — `B` Bold · `I` Italic · `U` Underline · `S` Strikethrough
2. **Headings** — `H1` · `H2` · `H3`
3. **Colors** — Text color (swatch picker + hex) · Highlight/background color
4. **Lists** — `• Bulleted` · `1. Numbered` · `☑ Checkbox`
5. **Inserts** — 🔗 Link · `{ }` Inline code · `⟨/⟩` Code block · `—` Separator
6. **Pixaroma blocks** — ⬇ Download · 🎥 YouTube · 💬 Discord
7. **View toggle** (far right) — `Code` ⇄ `Preview` (Preview is home/default)

**Editing model:** WYSIWYG via `contenteditable`. Select text → toolbar formats the selection. `Code` view shows the raw sanitized HTML source (same content, editable as text). Switching tabs preserves the content in both directions.

**Color swatches** (matching Label Pixaroma UX):
- First swatch is Pixaroma orange `#f66744`, plus black / white / grey / blue / green / red.
- Native color picker + hex input for anything else.

**Keyboard shortcuts** (inside editor only):
- Ctrl+B / Ctrl+I / Ctrl+U — bold / italic / underline
- Ctrl+S — save
- Esc — close (with "unsaved changes?" confirm if dirty)

## 3. The three "Pixaroma blocks"

Each inserted via its toolbar button. Once inserted, clicking the block in the editor pops a small dialog to edit its fields. Blocks behave as atomic inline elements inside `contenteditable` — they don't split mid-text.

### 3.1 ⬇ Download button

- **Fields:** Label (e.g. "Flux 2 Model"), URL (direct file link), Suggested folder (e.g. `models/diffusion_models/flux2`), Size hint (optional, e.g. "9.4 GB").
- **Render:** orange pill button `⬇ Flux 2 Model (9.4 GB)`.
- **Click behavior** (both in the editor preview and on the canvas):
  1. Opens URL in a new tab (`target="_blank"`, `rel="noopener noreferrer"`)
  2. Copies the Suggested folder path to the clipboard
  3. Shows a small toast: "Path copied — save the file there"
- **No backend download** — the server never writes to disk. Link-only, chosen for simplicity and zero security surface.

### 3.2 🎥 YouTube button

- **Fields:** Label (default "Pixaroma YouTube Channel"), URL (default `https://www.youtube.com/@pixaroma`).
- **Render:** chip/line with 🎥 icon + YouTube red accent + underlined link, matching the user's existing Resources footer style (`🎥 **Tutorials:** [Pixaroma YouTube Channel](…)`).
- **Click:** opens URL in a new tab.

### 3.3 💬 Discord button

- **Fields:** Label (default "Join Here"), URL (default `https://discord.com/invite/gggpkVgBf3`).
- **Render:** chip/line with 💬 icon + Discord blurple accent + underlined link, matching the user's existing Resources footer style (`💬 **Community Discord:** [Join Here](…)`).
- **Click:** opens URL in a new tab.

YouTube and Discord defaults are pre-filled so a single toolbar click inserts a ready-to-use Pixaroma link.

## 4. Content Model & Storage

### 4.1 Widget

A single hidden STRING widget named `note_json` on the node, holding a JSON string. Hidden via the existing `hideJsonWidget(node.widgets, "note_json")` helper from `js/shared/utils.mjs`.

### 4.2 Schema (v1)

```json
{
  "version": 1,
  "content": "<h1>…</h1><p>…</p>",
  "accentColor": "#f66744",
  "backgroundColor": "transparent",
  "width": 420,
  "height": 520
}
```

- `content` — sanitized HTML string (see §6).
- `accentColor` — per-note override of the `#f66744` default; drives Pixaroma-block button colors when user chooses to theme away from orange.
- `backgroundColor` — per-note node body background. `"transparent"` by default so it matches the ComfyUI theme.
- `width` / `height` — last-saved node dimensions, restored on workflow load.

### 4.3 Embedded Pixaroma blocks

Serialized as `<a>` tags with custom classes + data attributes. These survive `contenteditable` round-trip and sanitizer allowlisting:

```html
<a class="pix-note-dl" href="https://…"
   data-folder="models/diffusion_models/flux2"
   data-size="9.4 GB"
   target="_blank" rel="noopener noreferrer">⬇ Flux 2 Model</a>

<a class="pix-note-yt" href="https://www.youtube.com/@pixaroma"
   target="_blank" rel="noopener noreferrer">📺 Pixaroma YouTube Channel</a>

<a class="pix-note-discord" href="https://…"
   target="_blank" rel="noopener noreferrer">💬 Join Here</a>
```

### 4.4 Flow

- **Save**: `editor.innerHTML` → `sanitize()` → `JSON.stringify({version:1, content, …})` → written to `note_json` widget value via `saveCfg()` helper (pattern mirrored from Label).
- **Load**: widget value → `JSON.parse` → `sanitize(content)` → `container.innerHTML = sanitized`. Same path used for both the on-canvas body and the editor's Preview pane.

### 4.5 Backward compatibility

Not needed — this is a brand new node.

## 5. Architecture & File Layout

```
js/note/
├── index.js         # ComfyUI extension registration, setup/onDrawForeground, node lifecycle hooks
├── core.mjs         # NoteEditor class — constructor, open/close, _build UI, save
├── toolbar.mjs      # Toolbar construction + exec commands (bold, italic, headings, lists, colors, code, hr, link)
├── blocks.mjs       # Pixaroma block insert UI + field-edit dialogs (Download / YouTube / Discord)
├── render.mjs       # On-canvas DOM widget — renders saved HTML, installs hover Edit button, placeholder, scroll container
├── sanitize.mjs     # HTML allowlist sanitizer (see §6)
└── css.mjs          # All CSS as a string, injected once via injectCSS() on first editor open

nodes/
└── node_note.py     # PixaromaNote class — OUTPUT_NODE, no-op noop(), same shape as node_label.py
```

**Integration points:**
- `__init__.py` — merge `NODE_CLASS_MAPPINGS` / `NODE_DISPLAY_NAME_MAPPINGS` from `nodes/node_note.py`.
- No new backend routes. Nothing writes to disk. Content lives in the widget JSON inside the workflow `.json`.
- No new Python dependencies.
- No framework file modifications — all shared code reused read-only from `js/framework/` and `js/shared/`.

**Estimated size:** ~1200 lines JS total across 7 files (all under ~300 lines), ~25 lines of Python.

**Mixin pattern:** `NoteEditor` class defined in `core.mjs`; toolbar and block methods added via `NoteEditor.prototype.X = function () { … }` in `toolbar.mjs` and `blocks.mjs`. `index.js` side-effect imports all three before use. Pattern mirrors Paint/3D/Composer.

**Vue frontend compatibility** (from CLAUDE.md §Vue):
- The node uses `node.addDOMWidget` for the on-canvas body. Guard against widget teardown while the editor overlay is open (cache + re-lookup pattern).
- No `onDrawForeground` reliance for state change detection (the Vue frontend may not call it). Re-render is triggered from the save path, not from polling.
- Editor overlay uses the `overlay.isConnected` pattern to detect Vue-initiated teardown.

## 6. Security

### 6.1 Threat

Workflows are shared publicly (HuggingFace, Discord, PNG metadata). A malicious workflow with `<script>` inside a Note would execute in the victim's ComfyUI session — XSS with full DOM + cookie access.

### 6.2 Sanitization allowlist

Applied every time HTML enters the DOM (on save, on load, on Code-view apply).

**Tags allowed:** `h1 h2 h3 p br hr ul ol li b i u s strong em code pre span div a blockquote label`
Plus `input[type=checkbox]` for checkbox lists (disabled/non-interactive on the node face; interactive only inside the editor).

**Attributes allowed:**
- `class` — only values matching `pix-note-dl`, `pix-note-yt`, `pix-note-discord` (the three Pixaroma block classes). All other class values stripped. Text formatting uses native tags (`<b>`, `<i>`, `<u>`, `<s>`) or inline `style` (see below) — never classes.
- `style` — only `color`, `background-color`, `text-align` properties. Values validated against hex / named colors / known alignments.
- `href` — only `http://`, `https://`, `mailto:`. `javascript:` / `data:` / relative / missing → stripped.
- `data-folder`, `data-size` — on `pix-note-dl` only.
- `target`, `rel` — forced to `_blank` / `noopener noreferrer` on all anchors.
- `type="checkbox"`, `checked`, `disabled` on `input`.

**Stripped:** `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`, `<form>`, event handler attributes (`onclick`, `onerror`, `onload`, …), SVG event/animation, `srcdoc`, `formaction`, everything not explicitly allowed.

### 6.3 Implementation

`sanitize.mjs` parses the HTML into a detached `DocumentFragment` via `DOMParser` (not `innerHTML`), walks the tree, drops disallowed nodes and attributes in place, returns `fragment.innerHTML`. Hand-written (~80 lines); no external dependency (project has zero JS deps and we keep it that way). Manual review against the OWASP XSS Filter Evasion Cheat Sheet before release.

### 6.4 Code view

The "Code" tab shows raw sanitized HTML. The user may edit it freely. On save (or switching back to Preview), the content is re-sanitized. Attempting to save a `<script>` via Code view will silently strip it.

## 7. Out of Scope (v1)

Explicitly cut to keep v1 focused. Can revisit based on user demand.

- **Image embedding** — workflow JSON stays code-only.
- **Backend-driven model download** — link-only, no resume/tokens/progress/server fetch.
- **Tables, block quotes, callouts, find & replace, strikethrough beyond toolbar button** — "Full" tier from brainstorming.
- **Multi-column / side-by-side layouts** — single vertical flow only.
- **Template library / "save as preset"** — every note is one-off.
- **Live collaboration / cross-workflow sync** — content lives in the workflow JSON only.
- **Markdown import/export** — Code view is HTML, not markdown.
- **STRING output** — pure visual, like Label Pixaroma.

## 8. Testing Strategy

Project has no test suite or linting config. Verification is manual against a checklist — same pattern as every other Pixaroma editor.

**Functional checklist:**
- New Note node → placeholder visible → hover → Edit button appears
- Open editor → toolbar groups visible → each button functions on selected text
- Insert each of 9 insert types (link, inline code, code block, separator, download, YouTube, Discord, checkbox list, bullet list)
- Save → close → reopen editor → all content preserved
- Save workflow → reload workflow → Note content restored with correct size and colors
- Resize node → save → reload → size preserved
- Scrollbar appears when content exceeds node height; width wraps
- Click download button on node face → opens URL tab + copies folder to clipboard + shows toast
- Click YouTube/Discord on node face → opens correct URL
- Double-click on Note → no-op (editor does NOT open)
- Right-click on Note → no "Edit" menu item
- Custom accent color + background persist across reloads

**Security checklist:**
- Paste `<script>alert(1)</script>` into Code view → save → script stripped, not executed on reload
- Paste `<img src=x onerror=alert(1)>` → attribute stripped
- `href="javascript:alert(1)"` in Code view → stripped
- `<iframe src="https://evil.com">` → stripped
- All anchors in saved output have `rel="noopener noreferrer"`
- Sanitize a large corpus of benign HTML (ChatGPT output, markdown-rendered issues) and verify no corruption of legitimate content

**Vue frontend compatibility checklist:**
- Edit + save with Vue frontend enabled
- Close editor overlay via ComfyUI's tab switching → re-open editor → works
- Node deletion while editor open → editor closes cleanly

## 9. Open Questions

All blockers resolved with the user:

- ~~Discord URL~~ → `https://discord.com/invite/gggpkVgBf3`
- ~~YouTube label~~ → "Pixaroma YouTube Channel"
- ~~YouTube icon~~ → 🎥 (matches user's existing Resources footer style)

Only remaining uncertainty is the visual polish of the three Pixaroma blocks (pill vs. chip, icon placement, hover state, exact accent palette). That will be sketched for quick approval during implementation, before toolbar work begins.
